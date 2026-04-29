"""
AMINA Care — Context Compactor (auto-refresh)
================================================
Keeps long-running conversations inside every model's client-side budget
by automatically compressing older turns into a pinned summary stored in
Redis. Works uniformly across AMINA LoRA, Gemini, Groq, Mistral, and
GPT-4o-mini — summaries are SHARED across models within a session so a
user can switch models mid-conversation without losing continuity.

How it works:
  1. On every turn, amina_agent (LoRA branch OR generic branch) calls
     `maybe_schedule_compaction()` with that model's char_budget.
  2. If the running char count exceeds the SOFT threshold (75% of budget),
     a background `asyncio.create_task` runs `compact_session()`.
  3. Compactor asks a small, fast model (Gemini 2.5 Flash Lite by default)
     to compress the OLDEST N turns into a ≤300-token clinical summary.
  4. Summary is saved to Redis `chat:summary:{session_id}` with 24h TTL
     (shared across all models for this session).
  5. On the NEXT turn, amina_agent reads the pinned summary via
     `get_summary_for_session()` and prepends it to the system prompt.
  6. The conversation continues indefinitely — older turns are compressed
     once, recent turns remain verbatim.

Key properties:
  - Async-first: compaction never blocks the user's current turn
  - Fail-safe: if summarizer is unavailable, the user still gets a response
  - Idempotent: multiple schedule() calls for the same session coalesce
  - Provider-agnostic: compactor uses fallback chain Gemini → Groq → GPT-4o-mini
  - Model-agnostic: same code path for LoRA, Gemini, Groq, GPT-4o-mini,
    Mistral — only char_budget differs per model
  - Cross-model continuity: summary is keyed by session_id, not model

Deployed in:
  - LoRA branch (20K budget, 15K soft trigger)
  - Generic branch — Gemini (22K budget, 16.5K trigger)
  - Generic branch — Base/GPT-4o-mini (18K budget, 13.5K trigger)
  - Generic branch — Groq (10K budget, 7.5K trigger)
  - Generic branch — Mistral (10K budget, 7.5K trigger)
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime
from typing import Any, List, Optional

from src.config import settings

logger = logging.getLogger(__name__)


# ── Thresholds ───────────────────────────────────────────────────────────────
# Ratios are of `char_budget` (the per-model client-side budget in chars).
# These match the 4:1 char:token rule for Mistral tokenizer which is what
# AMINA LoRA is based on.

_SOFT_THRESHOLD_RATIO = 0.75   # start background compaction
_HARD_THRESHOLD_RATIO = 0.90   # fallback: drop oldest non-pinned turns
_COMPACT_KEEP_TAIL    = 4      # keep this many recent turns verbatim
_COMPACT_MIN_TURNS    = 8      # need at least this many turns to bother
_SUMMARY_MAX_TOKENS   = 300    # summary output budget
_SUMMARY_TTL_SECONDS  = 24 * 3600

_IN_FLIGHT_KEY = "chat:compact_inflight:{sid}"   # prevents duplicate jobs
_SUMMARY_KEY   = "chat:summary:{sid}"
_VERSION_KEY   = "chat:summary_version:{sid}"

# Legacy key prefixes (pre-Phase B) — read-through compatibility for any
# sessions that were compacted before the rename. Never written to.
_LEGACY_SUMMARY_KEY = "lora:summary:{sid}"
_LEGACY_VERSION_KEY = "lora:summary_version:{sid}"

_SUMMARY_META_KEY   = "chat:summary_meta:{sid}"
_ACTIVE_TOKENS_KEY  = "conv:{sid}:active_tokens"


# ── Redis helpers ────────────────────────────────────────────────────────────

def _get_redis():
    import redis as _redis
    return _redis.Redis(
        host=settings.REDIS_HOST,
        port=settings.REDIS_PORT,
        decode_responses=True,
    )


# ── Token / char estimation ──────────────────────────────────────────────────

def estimate_tokens(text: str) -> int:
    """Cheap token estimate. Mistral tokenizer ≈ 3.8 chars per token.
    Close enough for threshold decisions."""
    if not text:
        return 0
    return max(1, len(text) // 4)


def _estimate_messages_chars(messages: List[Any]) -> int:
    """Sum of content lengths across a message list. Accepts the internal
    Message objects (with .content) or plain dicts."""
    total = 0
    for m in messages:
        c = getattr(m, "content", None)
        if c is None and isinstance(m, dict):
            c = m.get("content", "")
        if c:
            total += len(str(c))
    return total


# ── Summary retrieval (read path for amina_agent) ───────────────────────────

async def get_summary_for_session(session_id: str) -> Optional[str]:
    """Read the pinned compact summary for a session, if any.

    Called every turn from BOTH the LoRA branch and the generic branch to
    prepend continuity context to the system prompt. Returns None if no
    summary has been generated for this session yet.

    Cross-model: the summary is keyed by session_id, not by model name, so
    a user switching from Gemini → LoRA (or vice versa) preserves context.

    Back-compat: reads from the legacy `lora:summary:*` key if no value
    exists under the new `chat:summary:*` key (sessions compacted pre-Phase B).
    """
    if not session_id:
        return None
    try:
        r = _get_redis()
        val = r.get(_SUMMARY_KEY.format(sid=session_id))
        if val:
            return val
        # Legacy fallback
        legacy = r.get(_LEGACY_SUMMARY_KEY.format(sid=session_id))
        return legacy or None
    except Exception as e:
        logger.debug(f"compactor: summary read failed: {e}")
        return None


async def get_summary_version(session_id: str) -> int:
    """Current version of the compact summary (monotonic counter)."""
    if not session_id:
        return 0
    try:
        r = _get_redis()
        val = r.get(_VERSION_KEY.format(sid=session_id))
        return int(val) if val else 0
    except Exception:
        return 0


async def get_summary_meta(session_id: str) -> Optional[dict]:
    """Compaction metadata: range_count, tokens_before/after, trigger_type, etc.
    Used by prompt assembly to know how many messages the summary covers."""
    if not session_id:
        return None
    try:
        r = _get_redis()
        raw = r.get(_SUMMARY_META_KEY.format(sid=session_id))
        if raw:
            return json.loads(raw)
        # On Redis miss, try ArcadeDB
        return await _load_meta_from_arcadedb(session_id)
    except Exception as e:
        logger.debug(f"compactor: meta read failed: {e}")
        return None


async def get_active_token_count(session_id: str) -> int:
    """The token count the LLM will actually see on the next turn.
    Reads from the cached Redis key; recomputes on miss."""
    if not session_id:
        return 0
    try:
        r = _get_redis()
        val = r.get(_ACTIVE_TOKENS_KEY.format(sid=session_id))
        if val is not None:
            return int(val)
        return await _recompute_active_tokens(session_id)
    except Exception:
        return 0


# ── Schedule trigger (called every turn) ─────────────────────────────────────

def maybe_schedule_compaction(
    session_id: str,
    messages: List[Any],
    char_budget: int,
    patient_name: str = "",
) -> bool:
    """
    Inspect the running char count and kick off a background compaction
    task if the conversation is approaching the char_budget.

    Returns True if a compaction job was scheduled, False otherwise.

    This function MUST NOT block — the user's current turn is waiting on
    the LLM, not on us.
    """
    if not session_id or not messages:
        return False

    # Need enough turns for compaction to make sense
    if len(messages) < _COMPACT_MIN_TURNS:
        return False

    running_chars = _estimate_messages_chars(messages)
    soft_limit = int(char_budget * _SOFT_THRESHOLD_RATIO)
    if running_chars < soft_limit:
        return False

    # Dedup: if another compaction is already running for this session, skip
    try:
        r = _get_redis()
        key = _IN_FLIGHT_KEY.format(sid=session_id)
        if r.get(key):
            return False
        # Set a 5-minute in-flight lock
        r.setex(key, 300, "1")
    except Exception as e:
        logger.debug(f"compactor: in-flight check failed: {e}")
        return False

    # Fire-and-forget the compaction — we're inside an async handler
    # (amina_agent.process_message is async), so create_task is safe
    try:
        asyncio.create_task(
            compact_session(
                session_id=session_id,
                messages=list(messages),  # snapshot to avoid mutation
                char_budget=char_budget,
                patient_name=patient_name,
            )
        )
        logger.info(
            f"compactor: scheduled compaction for {session_id} "
            f"({running_chars}/{char_budget} chars, {len(messages)} turns)"
        )
        return True
    except Exception as e:
        logger.warning(f"compactor: schedule failed: {e}")
        _clear_inflight(session_id)
        return False


def _clear_inflight(session_id: str) -> None:
    try:
        r = _get_redis()
        r.delete(_IN_FLIGHT_KEY.format(sid=session_id))
    except Exception:
        pass


# ── Core compaction (background task) ───────────────────────────────────────

_SUMMARIZER_SYSTEM = (
    "You are a clinical conversation summarizer for AMINA Care, a Gambian "
    "community health programme. Compress the following patient–CHW "
    "conversation into a concise clinical summary of ≤300 tokens.\n\n"
    "PRESERVE:\n"
    "- Patient facts: conditions, medications, allergies, vitals mentioned\n"
    "- Commitments the patient made (e.g. 'I'll cut salt', 'I'll fast Monday')\n"
    "- Open clinical threads needing follow-up (e.g. 'BP recheck Friday')\n"
    "- Cultural context (Ramadan, family caregiver, cultural remedies used)\n"
    "- Emotional state if clinically relevant (anxiety, non-adherence reasons)\n\n"
    "DROP:\n"
    "- Greetings, small talk, repeated pleasantries\n"
    "- Verbose clinical reasoning by the CHW\n"
    "- Redundant re-statements of already-known facts\n\n"
    "FORMAT: A single paragraph, dense, factual. No bullet points. No preamble. "
    "Start directly with the clinical content."
)


async def compact_session(
    session_id: str,
    messages: List[Any],
    char_budget: int,
    patient_name: str = "",
) -> Optional[str]:
    """
    Background task: compress the oldest turns of a conversation into a
    pinned summary and save it to Redis.

    Returns the summary text on success, None on failure.
    """
    try:
        # Slice: compact everything EXCEPT the last N turns
        to_compact = messages[:-_COMPACT_KEEP_TAIL] if len(messages) > _COMPACT_KEEP_TAIL else []
        if len(to_compact) < (_COMPACT_MIN_TURNS - _COMPACT_KEEP_TAIL):
            logger.debug(f"compactor: not enough old turns to compact for {session_id}")
            return None

        transcript = _format_transcript(to_compact, patient_name=patient_name)
        if not transcript:
            return None

        # Pull in any existing summary — if one exists, fold it into the new one
        existing = await get_summary_for_session(session_id)
        if existing:
            transcript = (
                f"[PRIOR SUMMARY]\n{existing}\n\n[NEW TURNS TO MERGE]\n{transcript}"
            )

        summary, model_used = await _run_summarizer(transcript)
        if not summary:
            logger.warning(f"compactor: summarizer returned empty for {session_id}")
            return None

        compacted_count = len(to_compact)
        chars_before = _estimate_messages_chars(messages)

        _persist_summary(session_id, summary)

        trim_result = _trim_session_messages(session_id, compacted_count)
        chars_after = trim_result.get("chars_after", chars_before)
        tokens_before = chars_before // 4
        tokens_after = chars_after // 4

        version = await get_summary_version(session_id)
        _persist_summary_meta(session_id, {
            "range_count": compacted_count,
            "tokens_before": tokens_before,
            "tokens_after": tokens_after,
            "chars_before": chars_before,
            "chars_after": chars_after,
            "trigger_type": "auto",
            "summarizer_model": model_used or "",
            "created_at": datetime.now().isoformat(),
        })

        _update_active_tokens(session_id, tokens_after + estimate_tokens(summary))

        try:
            await _persist_to_arcadedb(
                session_id=session_id,
                summary=summary,
                version=version,
                range_count=compacted_count,
                tokens_before=tokens_before,
                tokens_after=tokens_after,
                chars_before=chars_before,
                chars_after=chars_after,
                trigger_type="auto",
                summarizer_model=model_used or "",
            )
        except Exception as _db_err:
            logger.warning(f"compactor: ArcadeDB persist non-fatal: {_db_err}")

        logger.info(
            f"compactor: compacted {compacted_count} turns for {session_id} "
            f"→ {len(summary)} char summary, tokens {tokens_before}→{tokens_after}"
        )
        return summary

    except Exception as e:
        logger.error(f"compactor: compact_session failed for {session_id}: {e}")
        return None
    finally:
        _clear_inflight(session_id)


def _format_transcript(messages: List[Any], patient_name: str = "") -> str:
    """Render a message list as a plain-text transcript for the summarizer."""
    lines: List[str] = []
    pname = patient_name or "Patient"
    for m in messages:
        role = getattr(m, "role", None) or (m.get("role") if isinstance(m, dict) else "user")
        content = getattr(m, "content", None) or (m.get("content", "") if isinstance(m, dict) else "")
        content = (content or "").strip()
        if not content:
            continue
        label = pname if role == "user" else "AMINA"
        # Cap each turn to avoid runaway prompts
        lines.append(f"{label}: {content[:800]}")
    return "\n".join(lines)


async def _run_summarizer(transcript: str) -> tuple:
    """
    Call the summarizer model. Uses AMINA's existing OpenAI-compatible
    client pool (Gemini 2.5 Flash Lite → Groq fallback → GPT-4o-mini).

    Returns (summary_text, model_used) on success, (None, None) on failure.
    """
    # Prefer Gemini Flash Lite for this task — fast, cheap, reliable
    # structured output. Fallback chain: gemini → groq → base.
    try:
        from openai import AsyncOpenAI
    except ImportError:
        logger.error("compactor: openai package not available")
        return None

    candidates = []

    # Gemini 2.5 Flash Lite (primary)
    if getattr(settings, "GOOGLE_API_KEY", ""):
        candidates.append((
            "gemini",
            AsyncOpenAI(
                api_key=settings.GOOGLE_API_KEY,
                base_url=settings.GEMINI_BASE_URL,
            ),
            "gemini-2.5-flash-lite",
        ))

    # Groq fallback (free tier, rate-limited)
    if getattr(settings, "GROQ_API_KEY", ""):
        candidates.append((
            "groq",
            AsyncOpenAI(
                api_key=settings.GROQ_API_KEY,
                base_url=settings.GROQ_BASE_URL,
            ),
            settings.GROQ_MODEL,
        ))

    # GPT-4o-mini last resort
    if getattr(settings, "OPENAI_API_KEY", ""):
        candidates.append((
            "openai",
            AsyncOpenAI(api_key=settings.OPENAI_API_KEY),
            "gpt-4o-mini",
        ))

    if not candidates:
        logger.warning("compactor: no summarizer model credentials configured")
        return None, None

    messages = [
        {"role": "system", "content": _SUMMARIZER_SYSTEM},
        {"role": "user",   "content": transcript[:20_000]},
    ]

    for provider, client, model in candidates:
        try:
            resp = await client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=0.2,
                max_tokens=_SUMMARY_MAX_TOKENS,
                timeout=20,
            )
            summary = (resp.choices[0].message.content or "").strip()
            if summary:
                logger.debug(f"compactor: summarizer [{provider}/{model}] returned {len(summary)} chars")
                return summary, f"{provider}/{model}"
        except Exception as e:
            logger.warning(f"compactor: {provider}/{model} failed: {e}")
            continue

    return None, None


def _persist_summary(session_id: str, summary: str) -> None:
    """Save summary + bump version counter."""
    try:
        r = _get_redis()
        r.setex(_SUMMARY_KEY.format(sid=session_id), _SUMMARY_TTL_SECONDS, summary)
        r.incr(_VERSION_KEY.format(sid=session_id))
        r.expire(_VERSION_KEY.format(sid=session_id), _SUMMARY_TTL_SECONDS)
    except Exception as e:
        logger.error(f"compactor: persist failed: {e}")


def _persist_summary_meta(session_id: str, meta: dict) -> None:
    """Store compaction metadata (range_count, token delta, trigger type)."""
    try:
        r = _get_redis()
        r.setex(
            _SUMMARY_META_KEY.format(sid=session_id),
            _SUMMARY_TTL_SECONDS,
            json.dumps(meta, default=str),
        )
    except Exception as e:
        logger.error(f"compactor: meta persist failed: {e}")


def _msg_content(m) -> str:
    """Robust content read — messages may be dicts OR dataclasses."""
    if isinstance(m, dict):
        return m.get("content", "") or ""
    return getattr(m, "content", "") or ""


def _trim_session_messages(session_id: str, compacted_count: int) -> dict:
    """Remove the first `compacted_count` messages from the Redis session.

    This is the fix for the core bug: background compaction now actually
    shrinks the session so the next prompt is smaller. New messages
    appended since the snapshot are preserved (they're at the tail).
    """
    if compacted_count <= 0:
        return {"trimmed": 0}
    try:
        r = _get_redis()
        raw = r.get(f"session:{session_id}")
        if not raw:
            return {"trimmed": 0}
        session = json.loads(raw)
        messages = session.get("messages", [])
        if compacted_count >= len(messages):
            return {"trimmed": 0}

        before_count = len(messages)
        before_chars = sum(len(_msg_content(m)) for m in messages)

        session["messages"] = messages[compacted_count:]
        r.setex(f"session:{session_id}", _SUMMARY_TTL_SECONDS, json.dumps(session, default=str))

        after_count = len(session["messages"])
        after_chars = sum(len(_msg_content(m)) for m in session["messages"])

        logger.info(
            f"compactor: trimmed session {session_id}: "
            f"{before_count}→{after_count} msgs, {before_chars}→{after_chars} chars"
        )
        return {
            "trimmed": before_count - after_count,
            "chars_before": before_chars,
            "chars_after": after_chars,
        }
    except Exception as e:
        logger.error(f"compactor: session trim failed for {session_id}: {e}")
        return {"trimmed": 0}


def _update_active_tokens(session_id: str, token_count: int) -> None:
    """Set the cached active-token count (what the LLM sees next turn)."""
    try:
        r = _get_redis()
        r.set(_ACTIVE_TOKENS_KEY.format(sid=session_id), str(token_count))
    except Exception as e:
        logger.debug(f"compactor: active_tokens update failed: {e}")


async def _recompute_active_tokens(session_id: str) -> int:
    """Recompute active tokens from current Redis session state + summary."""
    try:
        r = _get_redis()
        raw = r.get(f"session:{session_id}")
        if not raw:
            return 0
        session = json.loads(raw)
        messages = session.get("messages", [])
        msg_tokens = sum(estimate_tokens(_msg_content(m)) for m in messages)
        summary = r.get(_SUMMARY_KEY.format(sid=session_id))
        summary_tokens = estimate_tokens(summary) if summary else 0
        total = msg_tokens + summary_tokens
        _update_active_tokens(session_id, total)
        return total
    except Exception:
        return 0


async def _persist_to_arcadedb(
    session_id: str,
    summary: str,
    version: int,
    range_count: int,
    tokens_before: int,
    tokens_after: int,
    chars_before: int,
    chars_after: int,
    trigger_type: str,
    summarizer_model: str = "",
) -> Optional[str]:
    """Write a CompactionSummary vertex to ArcadeDB for durable audit."""
    try:
        from src.utils.arcade_client import async_command_sql
        summary_id = f"cs_{uuid.uuid4().hex[:12]}"
        safe_summary = summary.replace("'", "''")
        sql = (
            f"INSERT INTO CompactionSummary SET "
            f"id = '{summary_id}', "
            f"session_id = '{session_id}', "
            f"summary_text = '{safe_summary}', "
            f"version = {version}, "
            f"range_count = {range_count}, "
            f"tokens_before = {tokens_before}, "
            f"tokens_after = {tokens_after}, "
            f"chars_before = {chars_before}, "
            f"chars_after = {chars_after}, "
            f"trigger_type = '{trigger_type}', "
            f"summarizer_model = '{summarizer_model}', "
            f"created_at = '{datetime.now().isoformat()}'"
        )
        await async_command_sql(sql)
        logger.info(f"compactor: persisted summary {summary_id} to ArcadeDB for {session_id}")
        return summary_id
    except Exception as e:
        logger.warning(f"compactor: ArcadeDB write-through failed (non-fatal): {e}")
        return None


async def _load_meta_from_arcadedb(session_id: str) -> Optional[dict]:
    """On Redis miss, load the latest compaction metadata from ArcadeDB."""
    try:
        from src.utils.arcade_client import async_command_sql, extract_rows
        result = await async_command_sql(
            f"SELECT range_count, tokens_before, tokens_after, chars_before, "
            f"chars_after, trigger_type, created_at "
            f"FROM CompactionSummary "
            f"WHERE session_id = '{session_id}' "
            f"ORDER BY created_at DESC LIMIT 1"
        )
        rows = extract_rows(result)
        if rows:
            meta = dict(rows[0])
            _persist_summary_meta(session_id, meta)
            return meta
    except Exception as e:
        logger.debug(f"compactor: ArcadeDB meta load failed: {e}")
    return None


# ── Hard-cap failsafe ────────────────────────────────────────────────────────

def hard_cap_trim(
    messages: List[Any],
    char_budget: int,
    keep_tail: int = _COMPACT_KEEP_TAIL,
) -> List[Any]:
    """
    Last-resort trimmer: if the running char count exceeds the hard
    threshold AND no summary is available, drop the oldest non-tail
    messages until we fit. Called synchronously from the agent when
    compaction isn't ready yet.

    Input messages list is NOT mutated; returns a new list.
    """
    if not messages:
        return messages
    hard_limit = int(char_budget * _HARD_THRESHOLD_RATIO)
    total = _estimate_messages_chars(messages)
    if total <= hard_limit:
        return list(messages)

    # Always keep the last `keep_tail` messages verbatim
    tail = messages[-keep_tail:] if len(messages) > keep_tail else list(messages)
    head = messages[:-keep_tail] if len(messages) > keep_tail else []
    tail_chars = _estimate_messages_chars(tail)
    remaining_budget = hard_limit - tail_chars

    # Walk the head from NEWEST backward, keeping what fits
    kept_head: List[Any] = []
    for m in reversed(head):
        mc = len(getattr(m, "content", "") or (m.get("content", "") if isinstance(m, dict) else ""))
        if mc + _estimate_messages_chars(kept_head) > remaining_budget:
            break
        kept_head.insert(0, m)

    return kept_head + tail


# ── Stats / admin ────────────────────────────────────────────────────────────

async def get_compaction_stats(session_id: str) -> dict:
    """Return summary + version + active tokens + metadata for admin/UI."""
    r = _get_redis()
    try:
        summary  = r.get(_SUMMARY_KEY.format(sid=session_id))
        version  = r.get(_VERSION_KEY.format(sid=session_id))
        ttl      = r.ttl(_SUMMARY_KEY.format(sid=session_id))
        inflight = r.get(_IN_FLIGHT_KEY.format(sid=session_id))
        meta_raw = r.get(_SUMMARY_META_KEY.format(sid=session_id))
        active   = r.get(_ACTIVE_TOKENS_KEY.format(sid=session_id))
    except Exception as e:
        return {"error": str(e)}

    meta = {}
    if meta_raw:
        try:
            meta = json.loads(meta_raw)
        except Exception:
            pass

    active_tokens = int(active) if active else await get_active_token_count(session_id)

    return {
        "session_id":             session_id,
        "has_summary":            bool(summary),
        "summary":                (summary[:400] + "…") if summary and len(summary) > 400 else (summary or None),
        "summary_chars":          len(summary) if summary else 0,
        "version":                int(version) if version else 0,
        "ttl_seconds":            ttl if ttl and ttl > 0 else None,
        "in_flight":              bool(inflight),
        "active_tokens":          active_tokens,
        "compacted_message_count": meta.get("range_count", 0),
        "tokens_before":          meta.get("tokens_before"),
        "tokens_after":           meta.get("tokens_after"),
        "trigger_type":           meta.get("trigger_type"),
        "last_compact_at":        meta.get("created_at"),
        "summarizer_model":       meta.get("summarizer_model"),
    }
