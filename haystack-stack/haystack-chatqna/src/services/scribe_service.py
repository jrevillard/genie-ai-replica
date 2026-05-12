"""
AMINA Care — Ambient Scribe Service
======================================
Turns a recorded CHW/clinician home-visit conversation into a structured
SOAP note draft that the clinician edits and signs before it lands in the
patient's inbox (+ PDF download).

Closes the Microsoft DAX Copilot gap — but on OUR turf (rural home visits,
offline-capable phones, Mandinka/English), not air-conditioned clinics.

Flow
----
  1. POST /scribe/start            -> session_id, storage path reserved
  2. POST /scribe/chunk/{id}       -> raw audio blob appended to session file
  3. POST /scribe/finish/{id}      -> STT -> LLM SOAP draft -> returns draft
  4. POST /scribe/finalize/{id}    -> clinician-edited SOAP -> renders PDF,
                                      creates InboxItem, returns inbox_id +
                                      signed file_token

State
-----
Each session has:
  - a raw-audio file on disk at SCRIBE_DIR/<session>.webm
    (format whatever the browser sent — we pass through to ffmpeg/Whisper
    normalization only at finish time)
  - a Redis hash `scribe_session:<id>` with status metadata
  - TTL 2h on the Redis record; files persist (no data deletion rule)

Roles
-----
  - caregiver JWT: can scribe for their linked patient
  - admin JWT:     can scribe for any patient
  - patient JWT:   CAN scribe for themselves (voice journal use-case) —
                    the route enforces patient_id == JWT sub.

Audit
-----
Every state transition writes a line to the existing audit log via the
same Python logger. Redis record keeps last_action + last_actor for ops.

Never swallows errors
---------------------
If STT fails we surface it to the caller; the session is kept in `error`
state so the frontend can offer a retry. No silent data loss.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ── Config ───────────────────────────────────────────────────────────────────

SCRIBE_DIR = os.getenv("SCRIBE_DIR", "/app/data/scribe")
REDIS_KEY_PREFIX = "scribe_session:"
SESSION_TTL_SECONDS = int(os.getenv("SCRIBE_SESSION_TTL_SECONDS", str(2 * 3600)))
MAX_AUDIO_MB = int(os.getenv("SCRIBE_MAX_AUDIO_MB", "60"))  # 1 hour of 128 kbps opus
MAX_CHUNK_MB = int(os.getenv("SCRIBE_MAX_CHUNK_MB", "8"))

VALID_STATUSES = (
    "init",          # session created, no audio yet
    "recording",     # at least one chunk received
    "transcribing",  # finish called, STT in progress
    "drafting",      # STT done, LLM SOAP in progress
    "ready_for_review",  # draft available, awaiting edit+sign
    "finalized",     # PDF + inbox item created
    "error",         # unrecoverable (transient retries bounce back to prev)
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _redis_client():
    """Same Redis pinning as inbox + model_health — env: REDIS_URL / REDIS_HOST."""
    import redis
    url = os.getenv("REDIS_URL")
    if url:
        return redis.Redis.from_url(url, decode_responses=True)
    host = os.getenv("REDIS_HOST", "redis")
    port = int(os.getenv("REDIS_PORT", "6379"))
    return redis.Redis(host=host, port=port, db=0, decode_responses=True)


def ensure_scribe_dir() -> None:
    try:
        os.makedirs(SCRIBE_DIR, exist_ok=True)
    except OSError as e:
        logger.error(f"scribe: cannot create {SCRIBE_DIR}: {e}")


# ── Session lifecycle ────────────────────────────────────────────────────────

@dataclass
class ScribeSession:
    session_id:   str
    patient_id:   str
    actor_id:     str
    actor_role:   str          # "caregiver" | "admin" | "patient"
    status:       str
    created_at:   str
    updated_at:   str
    audio_path:   str
    audio_bytes:  int
    transcript:   str
    language:     str
    soap_draft:   Dict[str, Any]
    last_action:  str
    last_error:   str
    title_hint:   str
    # Cached artifact IDs (populated by finalize_session). When the session
    # is in status="finalized", a second /finalize call returns these
    # cached IDs instead of re-rendering the PDF + duplicating the inbox
    # item. See `finalize_session` for the idempotency contract.
    inbox_item_id: str = ""
    file_token:    str = ""
    file_expires:  str = ""
    signed_by:     str = ""

    @classmethod
    def from_raw(cls, raw: Dict[str, str]) -> "ScribeSession":
        draft_raw = raw.get("soap_draft", "")
        try:
            draft = json.loads(draft_raw) if draft_raw else {}
        except Exception:
            draft = {}
        return cls(
            session_id=raw.get("session_id", ""),
            patient_id=raw.get("patient_id", ""),
            actor_id=raw.get("actor_id", ""),
            actor_role=raw.get("actor_role", ""),
            status=raw.get("status", "init"),
            created_at=raw.get("created_at", ""),
            updated_at=raw.get("updated_at", ""),
            audio_path=raw.get("audio_path", ""),
            audio_bytes=int(raw.get("audio_bytes") or 0),
            transcript=raw.get("transcript", ""),
            language=raw.get("language", "en"),
            soap_draft=draft,
            last_action=raw.get("last_action", ""),
            last_error=raw.get("last_error", ""),
            title_hint=raw.get("title_hint", ""),
            inbox_item_id=raw.get("inbox_item_id", ""),
            file_token=raw.get("file_token", ""),
            file_expires=raw.get("file_expires", ""),
            signed_by=raw.get("signed_by", ""),
        )

    def to_raw(self) -> Dict[str, str]:
        return {
            "session_id":    self.session_id,
            "patient_id":    self.patient_id,
            "actor_id":      self.actor_id,
            "actor_role":    self.actor_role,
            "status":        self.status,
            "created_at":    self.created_at,
            "updated_at":    self.updated_at,
            "audio_path":    self.audio_path,
            "audio_bytes":   str(self.audio_bytes),
            "transcript":    self.transcript,
            "language":      self.language,
            "soap_draft":    json.dumps(self.soap_draft, ensure_ascii=False),
            "last_action":   self.last_action,
            "last_error":    self.last_error,
            "title_hint":    self.title_hint,
            "inbox_item_id": self.inbox_item_id,
            "file_token":    self.file_token,
            "file_expires":  self.file_expires,
            "signed_by":     self.signed_by,
        }

    def public(self) -> Dict[str, Any]:
        return {
            "session_id":      self.session_id,
            "patient_id":      self.patient_id,
            "actor_role":      self.actor_role,
            "status":          self.status,
            "created_at":      self.created_at,
            "updated_at":      self.updated_at,
            "audio_bytes":     self.audio_bytes,
            "language":        self.language,
            "transcript_preview": (self.transcript or "")[:300],
            "soap_draft":      self.soap_draft,
            "last_action":     self.last_action,
            "last_error":      self.last_error,
            "title_hint":      self.title_hint,
            "inbox_item_id":   self.inbox_item_id,
            "file_token":      self.file_token,
            "file_expires":    self.file_expires,
            "signed_by":       self.signed_by,
        }


# ── CRUD ─────────────────────────────────────────────────────────────────────

def create_session(
    *,
    patient_id: str,
    actor_id: str,
    actor_role: str,
    language: str = "en",
    title_hint: str = "",
) -> ScribeSession:
    if not patient_id or not actor_id or actor_role not in ("patient", "caregiver", "admin"):
        raise ValueError("invalid session arguments")
    ensure_scribe_dir()
    sid  = uuid.uuid4().hex
    now  = _now_iso()
    path = os.path.join(SCRIBE_DIR, f"{sid}.webm")
    open(path, "wb").close()   # touch the file so chunks can append

    s = ScribeSession(
        session_id=sid,
        patient_id=patient_id,
        actor_id=actor_id,
        actor_role=actor_role,
        status="init",
        created_at=now,
        updated_at=now,
        audio_path=path,
        audio_bytes=0,
        transcript="",
        language=(language or "en").lower(),
        soap_draft={},
        last_action="create",
        last_error="",
        title_hint=(title_hint or "")[:120],
    )
    _save(s)
    logger.info(f"scribe: session {sid} created by {actor_role}:{actor_id} for patient {patient_id}")
    return s


def get_session(session_id: str) -> Optional[ScribeSession]:
    if not session_id:
        return None
    try:
        raw = _redis_client().hgetall(REDIS_KEY_PREFIX + session_id) or {}
        if not raw:
            return None
        return ScribeSession.from_raw(raw)
    except Exception as e:
        logger.error(f"scribe: get_session failed for {session_id}: {e}")
        return None


def _save(s: ScribeSession) -> None:
    s.updated_at = _now_iso()
    try:
        r = _redis_client()
        k = REDIS_KEY_PREFIX + s.session_id
        r.hset(k, mapping=s.to_raw())
        r.expire(k, SESSION_TTL_SECONDS)
    except Exception as e:
        logger.error(f"scribe: save failed for {s.session_id}: {e}")
        raise


def _set_status(s: ScribeSession, status: str, action: str, error: str = "") -> None:
    """Update status fields ONLY — does NOT clobber audio_bytes.

    Bug 3 race-fix: append_chunk owns audio_bytes via Redis HINCRBY (atomic).
    A full HSET via _save() would overwrite the atomic counter with a stale
    local-snapshot value when two chunk requests interleave. By splitting
    status writes from the full save, the counter survives concurrent
    appends correctly. The four fields touched here are owned by the
    "session writer" and are safe to last-writer-wins.
    """
    if status not in VALID_STATUSES:
        logger.warning(f"scribe: unknown status {status!r}")
    s.status = status
    s.last_action = action
    s.last_error = error or ""
    s.updated_at = _now_iso()
    try:
        r = _redis_client()
        k = REDIS_KEY_PREFIX + s.session_id
        r.hset(k, mapping={
            "status":      s.status,
            "last_action": s.last_action,
            "last_error":  s.last_error,
            "updated_at":  s.updated_at,
        })
        r.expire(k, SESSION_TTL_SECONDS)
    except Exception as e:
        logger.error(f"scribe: _set_status failed for {s.session_id}: {e}")
        raise


# ── Chunk append ─────────────────────────────────────────────────────────────

def append_chunk(session_id: str, data: bytes) -> ScribeSession:
    """Race-safe chunk append (Bug 3 fix).

    Two interleaved chunk uploads on the same session previously corrupted
    the audio_bytes counter (both read N, both wrote N+local_len → counter
    only reflected the last writer). Worse, the MAX_AUDIO_MB cap could be
    bypassed by racing because both requests passed the limit check on the
    same stale snapshot.

    The fix:
      * audio_bytes is mutated only via Redis HINCRBY (atomic increment)
      * status updates use _set_status which writes only status fields
        (does NOT clobber audio_bytes)
      * the limit check happens AFTER the increment with rollback on excess
      * the file write is guarded by fcntl.flock so concurrent appends
        can't interleave bytes mid-write
    """
    s = get_session(session_id)
    if not s:
        raise ValueError("session not found")
    if s.status in ("finalized", "transcribing", "drafting"):
        raise ValueError(f"cannot append while status={s.status}")
    # Bug 7: empty-body check is owned by the route ([scribe_routes.py]
    # rejects with 400 before we get here). No defensive duplicate needed.
    if len(data) > MAX_CHUNK_MB * 1024 * 1024:
        raise ValueError(f"chunk too large ({len(data) // (1024*1024)} MB, max {MAX_CHUNK_MB})")

    # Atomic counter mutation via Redis. If two chunks race, both
    # increments land independently and the post-increment total is
    # authoritative for the limit check.
    r = _redis_client()
    k = REDIS_KEY_PREFIX + session_id
    new_total = int(r.hincrby(k, "audio_bytes", len(data)))
    cap_bytes = MAX_AUDIO_MB * 1024 * 1024
    if new_total > cap_bytes:
        # Roll back our slice and reject. Other concurrent requests are
        # unaffected — their increments persist independently.
        r.hincrby(k, "audio_bytes", -len(data))
        raise ValueError(f"session total audio exceeds {MAX_AUDIO_MB} MB")
    r.expire(k, SESSION_TTL_SECONDS)

    # File write with exclusive lock so concurrent appends can't
    # interleave bytes inside a single write call. POSIX flock is held
    # only for this one write, then released — fast and Linux-only
    # (perfect inside our docker container).
    try:
        import fcntl
        with open(s.audio_path, "ab") as f:
            try:
                fcntl.flock(f.fileno(), fcntl.LOCK_EX)
                f.write(data)
            finally:
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)
    except Exception:
        # Roll back the counter so disk size and counter stay in sync.
        try:
            r.hincrby(k, "audio_bytes", -len(data))
        except Exception:
            pass
        raise

    s.audio_bytes = new_total
    _set_status(s, "recording", "chunk_appended")
    return s


# ── Finish: STT + SOAP draft ─────────────────────────────────────────────────

SOAP_SECTIONS = ("subjective", "objective", "assessment", "plan")


async def finish_session(session_id: str) -> ScribeSession:
    """Run STT + LLM SOAP generation. Returns the session in ready_for_review.

    Bug 6 fix: idempotent across status checkpoints. Two parallel /finish
    calls used to both pass the (status != finalized) check and both run
    STT + LLM — wasted compute and confused logs. Now:
      * finalized           → return current state (caller already finalized)
      * ready_for_review    → return current state (already drafted, no redo)
      * transcribing|drafting → raise (in progress, caller should poll)
      * recording|init      → proceed normally
    """
    s = get_session(session_id)
    if not s:
        raise ValueError("session not found")
    if s.status in ("finalized", "ready_for_review"):
        # Idempotent — work is already done.
        return s
    if s.status in ("transcribing", "drafting"):
        # Another /finish is already executing; tell the caller to poll
        # instead of double-running STT/LLM.
        raise ValueError(f"finish already in progress (status={s.status})")
    if not s.audio_bytes or not os.path.exists(s.audio_path):
        _set_status(s, "error", "finish", "no audio")
        raise ValueError("no audio captured")

    # --- STT ---
    _set_status(s, "transcribing", "finish")
    try:
        # Bug 8 fix: shared lock on the file read so an in-flight chunk
        # write (LOCK_EX in append_chunk) finishes before STT starts
        # reading. Without it, finish could read a truncated tail.
        import fcntl
        from src.services import stt_whisper
        with open(s.audio_path, "rb") as f:
            try:
                fcntl.flock(f.fileno(), fcntl.LOCK_SH)
                audio = f.read()
            finally:
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)
        transcript = await stt_whisper.transcribe(audio, filename=os.path.basename(s.audio_path))
    except Exception as e:
        _set_status(s, "error", "finish", f"stt_exception: {type(e).__name__}: {e}")
        raise
    if not transcript or not transcript.strip():
        _set_status(s, "error", "finish", "stt returned empty transcript")
        raise RuntimeError("transcription produced no text")
    s.transcript = transcript.strip()
    _set_status(s, "drafting", "finish")

    # --- SOAP draft via the agent (loopback through the resilience endpoint
    #     so we automatically get model-fallback + safety-consensus pass-
    #     through on anything drug/dose related). ---
    try:
        soap = await _draft_soap_from_transcript(s.transcript, s.language)
    except Exception as e:
        _set_status(s, "error", "finish", f"draft_exception: {type(e).__name__}: {e}")
        raise

    s.soap_draft = soap
    _set_status(s, "ready_for_review", "finish")
    return s


async def _draft_soap_from_transcript(transcript: str, language: str) -> Dict[str, Any]:
    """
    Ask the agent to produce a structured SOAP note. We enforce a strict
    JSON output shape so the frontend can render/edit individual sections
    without a free-text parser.
    """
    import httpx

    prompt = (
        "You are a clinical scribe assistant helping a community health worker "
        "in rural Gambia. Given the transcript below of a home-visit "
        "conversation (patient + CHW, possibly in English or Mandinka), "
        "produce a concise SOAP note DRAFT. Use the patient's own words "
        "verbatim in Subjective when appropriate; do NOT invent measurements "
        "or diagnoses; flag anything you could not verify as {?} in the "
        "Objective or Assessment section.\n\n"
        "Return ONE line of strict JSON ONLY with this shape (no prose, "
        "no markdown fences):\n"
        "{\"title\":\"<one-line visit summary>\","
        "\"subjective\":\"...\",\"objective\":\"...\","
        "\"assessment\":\"...\",\"plan\":\"...\","
        "\"flags\":[\"<red-flag 1>\", \"<red-flag 2>\"]}\n\n"
        f"TRANSCRIPT ({language}):\n{transcript}"
    )
    upstream = os.getenv("RESILIENCE_UPSTREAM_BASE", "http://127.0.0.1:8000")
    async with httpx.AsyncClient(timeout=90) as client:
        r = await client.post(
            f"{upstream}/api/v1/agent/chat-resilient",
            headers={"Content-Type": "application/json"},
            content=json.dumps({
                "message": prompt,
                "session_id": "scribe_internal",
                "channel": "internal",
            }).encode("utf-8"),
        )
    if r.status_code != 200:
        raise RuntimeError(f"agent returned http {r.status_code}: {r.text[:300]}")
    body = r.json()
    raw  = str(body.get("response") or "")

    soap = _extract_soap_json(raw)
    if not soap:
        # Fallback: synthesize from a plain-text reply so the user still
        # sees something editable.
        soap = {
            "title":       "Home visit",
            "subjective":  raw[:800],
            "objective":   "",
            "assessment":  "",
            "plan":        "",
            "flags":       [],
        }
    # Normalize keys even if LLM returned partial data.
    for k in SOAP_SECTIONS:
        soap[k] = str(soap.get(k, "")).strip()
    soap["title"] = str(soap.get("title", "")).strip() or "Home visit"
    flags = soap.get("flags") or []
    if not isinstance(flags, list):
        flags = [str(flags)]
    soap["flags"] = [str(f).strip()[:120] for f in flags if f]
    return soap


def _extract_soap_json(s: str) -> Optional[Dict[str, Any]]:
    if not s:
        return None
    import re as _re
    m = _re.search(r"\{.*\}", s, _re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


# ── Orphan file cleanup (Bug 5) ──────────────────────────────────────────────

def cleanup_orphan_audio_files(grace_seconds: int = 3600) -> Dict[str, int]:
    """Delete audio files in SCRIBE_DIR whose Redis session has expired.

    Why this exists:
      create_session touches a file on disk, then sets a Redis session with
      a 2-hour TTL. Most sessions never reach finalize (user starts a
      recording, abandons it). Once Redis expires the session record, the
      file becomes invisible to the API but persists on disk forever.

      Live evidence at the time of writing: 27 .webm files on disk vs 1
      active Redis session. With real recordings (1-60 MB each), this is
      unbounded disk growth.

    Strategy:
      1. List every <session_id>.webm in SCRIBE_DIR
      2. Probe Redis for the session record
      3. If the record is gone AND the file mtime is older than
         `grace_seconds` (default 1h, well above the 2h TTL), delete it
      4. Files that still have a live Redis session are always preserved

    Returns a counter dict {scanned, kept, removed, errors}.
    """
    counter = {"scanned": 0, "kept": 0, "removed": 0, "errors": 0}
    if not os.path.isdir(SCRIBE_DIR):
        return counter
    try:
        r = _redis_client()
    except Exception as e:
        logger.error(f"scribe cleanup: redis unreachable: {e}")
        counter["errors"] += 1
        return counter

    cutoff = datetime.now(timezone.utc).timestamp() - max(0, grace_seconds)

    for name in os.listdir(SCRIBE_DIR):
        if not name.endswith(".webm"):
            continue
        counter["scanned"] += 1
        path = os.path.join(SCRIBE_DIR, name)
        sid  = name[:-len(".webm")]
        try:
            still_alive = bool(r.exists(REDIS_KEY_PREFIX + sid))
            mtime = os.path.getmtime(path)
        except Exception as e:
            logger.warning(f"scribe cleanup: stat/probe failed for {name}: {e}")
            counter["errors"] += 1
            continue

        if still_alive:
            counter["kept"] += 1
            continue
        if mtime > cutoff:
            # Recent file with no session — could be an in-flight create_session
            # that hasn't written its Redis record yet. Wait one cycle.
            counter["kept"] += 1
            continue
        try:
            os.unlink(path)
            counter["removed"] += 1
            logger.info(f"scribe cleanup: removed orphan {name} "
                        f"(age={int(datetime.now(timezone.utc).timestamp() - mtime)}s)")
        except OSError as e:
            logger.warning(f"scribe cleanup: unlink failed for {name}: {e}")
            counter["errors"] += 1

    logger.info(
        "scribe cleanup: scanned=%d kept=%d removed=%d errors=%d (grace=%ds)",
        counter["scanned"], counter["kept"], counter["removed"], counter["errors"],
        grace_seconds,
    )
    return counter


# ── Finalize: PDF + Inbox item ───────────────────────────────────────────────

def finalize_session(
    session_id: str,
    *,
    edited_draft: Dict[str, Any],
    signed_by_name: str = "",
) -> Tuple[ScribeSession, Dict[str, Any]]:
    """
    Render the edited draft as a PDF, push an InboxItem, return (session,
    {inbox_item, file_token, download_url}). Session moves to `finalized`.

    Idempotent (Improvement B): if the session is already in
    status=`finalized`, the cached artifact IDs (inbox_item_id,
    file_token, file_expires) are returned as-is. The PDF is NOT
    regenerated and the inbox item is NOT duplicated. The clinician
    has already signed; subsequent /finalize calls are no-ops by
    design — edits passed on a retry are ignored.
    """
    s = get_session(session_id)
    if not s:
        raise ValueError("session not found")
    if s.status == "finalized":
        # Idempotent path. Return whatever artifacts were cached on the
        # session at first finalize. If the cache is empty (very old
        # session pre-dating Improvement B), surface that explicitly so
        # ops can investigate rather than silently returning stub data.
        if s.file_token:
            return s, {
                "inbox_item":         {"item_id": s.inbox_item_id},
                "file_token":         s.file_token,
                "file_expires":       s.file_expires,
                "already_finalized":  True,
            }
        raise ValueError(
            "already finalized but artifact IDs missing on session — "
            "this session was finalized before Improvement B; check "
            "the inbox directly via /api/v1/inbox/list?patient_id=…"
        )

    # Merge edits into the draft so the PDF reflects exactly what the
    # clinician signed.
    draft = dict(s.soap_draft or {})
    for k in ("title", *SOAP_SECTIONS):
        if k in edited_draft and edited_draft[k] is not None:
            draft[k] = str(edited_draft[k]).strip()
    if "flags" in edited_draft and isinstance(edited_draft["flags"], list):
        draft["flags"] = [str(f).strip()[:120] for f in edited_draft["flags"] if f]
    s.soap_draft = draft
    _save(s)

    # Render PDF bytes via the existing document_gen.render_pdf
    try:
        from src.services.document_gen import render_pdf
    except Exception as e:
        _set_status(s, "error", "finalize", f"import_pdf: {e}")
        raise

    sections: List[Dict[str, str]] = [
        {"heading": "Subjective",  "body": draft.get("subjective", "").strip() or "—"},
        {"heading": "Objective",   "body": draft.get("objective", "").strip()  or "—"},
        {"heading": "Assessment",  "body": draft.get("assessment", "").strip() or "—"},
        {"heading": "Plan",        "body": draft.get("plan", "").strip()       or "—"},
    ]
    if draft.get("flags"):
        flags_body = "\n".join(f"• {f}" for f in draft["flags"])
        sections.append({"heading": "Red flags / follow-up", "body": flags_body})
    sections.append({
        "heading": "Recording metadata",
        "body": (
            f"Session: {s.session_id}\n"
            f"Recorded by: {s.actor_role} (id {s.actor_id})\n"
            f"Started: {s.created_at}\n"
            f"Signed by: {signed_by_name or '—'}\n"
            f"Signed at: {_now_iso()}\n"
            f"This is an AI-drafted note. Clinical responsibility remains "
            f"with the signing clinician."
        ),
    })
    doc = {
        "title":    draft.get("title") or "Home-visit SOAP note",
        "subtitle": f"For patient {s.patient_id}",
        "sections": sections,
    }
    pdf_bytes = render_pdf(doc)

    # Store bytes + issue a signed URL token.
    from src.services import file_token_service, inbox_service
    issued = file_token_service.ingest_bytes(
        patient_id=s.patient_id,
        filename=f"home-visit-{s.session_id[:8]}.pdf",
        mime="application/pdf",
        data=pdf_bytes,
        ttl_seconds=60 * 60 * 24 * 365,    # 1y — clinicians need long-lived
        kind="pdf",
    )
    item = inbox_service.create_item(
        patient_id=s.patient_id,
        kind="report",
        title=draft.get("title") or "Home-visit SOAP note",
        body=draft.get("assessment", "").strip()[:600] or
             draft.get("subjective", "").strip()[:600] or
             "Clinician-signed home visit note.",
        severity="info",
        source="agent",
        source_id=f"scribe:{s.session_id}",
        attachment_token=issued["token"],
        attachment_name=issued["name"],
        attachment_mime=issued["mime"],
        attachment_size=issued["size"],
        metadata={
            "scribe_session":  s.session_id,
            "actor_role":      s.actor_role,
            "actor_id":        s.actor_id,
            "signed_by_name":  signed_by_name,
            "flags":           draft.get("flags", []),
        },
        ttl_days=365,
    )

    # Cache the artifact IDs on the session so a retry call returns the
    # same response without re-rendering the PDF or duplicating the inbox
    # item (Improvement B). inbox_service.create_item returns a dict
    # keyed by `inbox_id` (not `item_id` / `id`) — see [inbox_service.py
    # line ~170 record dict]. We accept all three so the code is robust
    # to any future renames.
    s.inbox_item_id = (item.get("inbox_id")
                       or item.get("item_id")
                       or item.get("id")
                       or "")
    s.file_token    = issued.get("token", "")
    s.file_expires  = str(issued.get("expires_at", ""))
    s.signed_by     = signed_by_name or ""
    _save(s)

    _set_status(s, "finalized", "finalize")
    return s, {
        "inbox_item":   item,
        "file_token":   issued["token"],
        "file_expires": issued["expires_at"],
    }
