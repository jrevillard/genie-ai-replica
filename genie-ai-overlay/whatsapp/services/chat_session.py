# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""ArangoDB-backed chat session storage for WhatsApp conversations.

Writes to the same `chatSessions` / `chatSessionMessages` collections used by
the web chat, with `type='whatsapp'` so the channel can be filtered. One
session per phone number; reused across messages.

The web chat backend (chat-session-service.js) sets `type='chat'` on its
sessions. This module sets `type='whatsapp'`. Existing rows without `type`
are treated as 'chat' by readers.
"""

from __future__ import annotations

import datetime
import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

ARANGO_URL = os.getenv("ARANGO_URL", "http://arangodb:8529")
ARANGO_DB = os.getenv("ARANGO_DB", "genie-ai")
ARANGO_USERNAME = os.getenv("ARANGO_USERNAME", "root")
ARANGO_PASSWORD = os.getenv("ARANGO_PASSWORD", "")

SESSIONS_COLLECTION = "chatSessions"
MESSAGES_COLLECTION = "chatSessionMessages"
TWINS_COLLECTION = "aiTwins"

_db = None
_default_twin_key: Optional[str] = None


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def get_db():
    """Lazy ArangoDB connection. Returns None if not configured (degraded mode)."""
    global _db
    if _db is not None:
        return _db
    if not ARANGO_PASSWORD:
        logger.warning("ARANGO_PASSWORD not set — WhatsApp chat sessions will not be persisted")
        return None
    try:
        from arango import ArangoClient
        client = ArangoClient(hosts=ARANGO_URL)
        db = client.db(ARANGO_DB, username=ARANGO_USERNAME, password=ARANGO_PASSWORD)
        db.version()  # fail fast on bad creds
        # Ensure collections exist (idempotent).
        for name in (SESSIONS_COLLECTION, MESSAGES_COLLECTION):
            if not db.has_collection(name):
                db.create_collection(name)
        _db = db
        logger.info("Arango chat-session storage connected url=%s db=%s", ARANGO_URL, ARANGO_DB)
        return db
    except Exception as exc:
        logger.exception("Arango connection failed: %s", exc)
        return None


def _get_default_twin_key(db) -> Optional[str]:
    """Look up the _key of the twin marked isDefault=true. Cached for the
    process lifetime. Refreshed on cache miss."""
    global _default_twin_key
    if _default_twin_key:
        return _default_twin_key
    try:
        cursor = db.aql.execute(
            "FOR t IN @@coll FILTER t.isDefault == true LIMIT 1 RETURN t._key",
            bind_vars={"@coll": TWINS_COLLECTION},
        )
        keys = list(cursor)
        if keys:
            _default_twin_key = str(keys[0])
            logger.info("Resolved default twin: %s", _default_twin_key)
            return _default_twin_key
    except Exception as exc:
        logger.warning("default twin lookup failed: %s", exc)
    return None


def _build_personality_prompt(personality: Optional[dict]) -> str:
    """Mirror of `buildPersonalityPromptFragment` in
    components/gov-chat-backend/services/ai-twin-service.js. Keep wording in
    sync — chat / call / WhatsApp must agree on the directive."""
    style = (personality or {}).get("languageStyle")
    length = (personality or {}).get("responseLength")
    if style not in {"slang", "casual", "professional"}:
        style = "slang"
    if length not in {"short", "medium", "long"}:
        length = "medium"
    # Wording mirrors components/gov-chat-backend/services/ai-twin-service.js.
    # Avoid role-play hints like "as a friend" — Llama 3.1 will invent a
    # fictional user partner and hallucinate dialogue.
    style_copy = {
        "slang": "use casual everyday language; contractions and short forms are fine; avoid formal jargon",
        "casual": "use a friendly conversational tone with full sentences; contractions are fine",
        "professional": "use formal precise language; full sentences; no contractions or slang",
    }[style]
    length_copy = {
        "short": "keep replies to 1-2 short sentences; no preamble",
        "medium": "keep replies moderately detailed, roughly 3-6 sentences",
        "long": "give thorough, multi-paragraph explanations with examples when helpful",
    }[length]
    return (
        "Style preferences for your reply (these modify HOW you respond — they do not change your role or what you do):\n"
        f"- Tone: {style_copy}.\n"
        f"- Length: {length_copy}."
    )


def get_default_twin_personality_prompt() -> Optional[str]:
    """Read the default twin's personality and return the LLM directive string.
    Returns None when Arango isn't available or no default twin is seeded."""
    db = get_db()
    if db is None:
        return None
    twin_id = _get_default_twin_key(db)
    if not twin_id:
        return None
    try:
        twin = db.collection(TWINS_COLLECTION).get(twin_id)
        if not twin:
            return None
        return _build_personality_prompt(twin.get("personality"))
    except Exception as exc:
        logger.warning("personality lookup failed for default twin: %s", exc)
        return None


def find_or_create_session(phone: str) -> Optional[str]:
    """Return the session _key for this phone, creating one if none exists.

    One perpetual session per phone (type='whatsapp'). Always linked to the
    project's default twin (the one carrying the WhatsApp phone number) so
    the session shows up under that twin's stats and can be replayed in the
    twin's voice.
    """
    db = get_db()
    if db is None or not phone:
        return None
    try:
        twin_id = _get_default_twin_key(db)

        cursor = db.aql.execute(
            "FOR s IN @@coll FILTER s.userId == @uid AND s.type == 'whatsapp' "
            "SORT s.createdAt DESC LIMIT 1 RETURN s",
            bind_vars={"@coll": SESSIONS_COLLECTION, "uid": str(phone)},
        )
        existing = list(cursor)
        if existing:
            session = existing[0]
            key = str(session["_key"])
            # Backfill twinId on legacy rows that were created before this change.
            if twin_id and not session.get("twinId"):
                try:
                    db.collection(SESSIONS_COLLECTION).update({"_key": key, "twinId": twin_id})
                    logger.info("Backfilled twinId on legacy session %s", key)
                except Exception as exc:
                    logger.warning("twinId backfill failed for %s: %s", key, exc)
            return key

        # Not found — create new with twinId set up front.
        now = _now_iso()
        meta = db.collection(SESSIONS_COLLECTION).insert({
            "userId": str(phone),
            "phoneNumber": str(phone),
            "type": "whatsapp",
            "createdAt": now,
            "updatedAt": now,
            "twinId": twin_id,
        })
        logger.info("Arango chat session created _key=%s phone=%s twinId=%s",
                    meta["_key"], phone, twin_id)
        return str(meta["_key"])
    except Exception as exc:
        logger.warning("find_or_create_session failed for %s: %s", phone, exc)
        return None


def append_message(session_id: Optional[str], role: str, content: str) -> None:
    """Append a single message to a chat session. Best-effort; swallows errors."""
    db = get_db()
    if db is None or not session_id:
        return
    text = (content or "").strip()
    if not text:
        return
    role_norm = "assistant" if role == "assistant" else "user"
    try:
        now = _now_iso()
        db.collection(MESSAGES_COLLECTION).insert({
            "sessionId": str(session_id),
            "role": role_norm,
            "content": text,
            "createdAt": now,
        })
        # Bump session updatedAt for "recent activity" sorting.
        db.collection(SESSIONS_COLLECTION).update({"_key": str(session_id), "updatedAt": now})
    except Exception as exc:
        logger.warning("append_message failed session=%s role=%s: %s", session_id, role_norm, exc)
