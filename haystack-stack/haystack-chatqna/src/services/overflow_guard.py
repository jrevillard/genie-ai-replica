"""
AMINA Care — Overflow Guard
============================
Last-resort safety net that sits between the AminaAgent and every
OpenAI-compatible client (amina-LoRA vLLM, Gemini, Groq, Mistral, GPT-4o-mini).

Goal: the conversation MUST continue even when a single turn would push the
prompt past the server's max_model_len. Chat history in memory.messages is
never touched — only the IN-FLIGHT prompt is shrunk, and the background
context_compactor picks up the slack on the next turn.

How it works:
  1. Pre-trim. Before firing the HTTP request, sum the char length of the
     message list. If it's above CHAR_CAP_PER_MODEL for this model, drop
     the oldest non-system turns until it fits.
  2. Retry on overflow. If the server still responds with a 400 / context-
     length error, drop the oldest non-system turn and retry. Repeat up to
     MAX_OVERFLOW_RETRIES times.
  3. Preserve the system prompt + the last user turn at minimum. We never
     send a request with fewer than those two messages.

Invariants:
  - Never touches memory.messages or Redis chat history.
  - Never edits existing files. Installed by overflow_guard_patch at import.
  - Completely transparent to callers: same signature, same return type.
  - Fail-open: if pre-trim / retry logic itself errors, the original call is
    still attempted.

The background context_compactor (src/services/context_compactor.py) handles
the summary side. When turns get dropped from the in-flight prompt, they are
still in memory.messages, and the compactor will fold them into the pinned
summary on the very next turn.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# ── Per-model char caps ──────────────────────────────────────────────────────
# These are CONSERVATIVE caps used by the pre-trim pass. Each is roughly 75%
# of the server's real token limit, translated to chars at 3.8 chars/token
# (Mistral-family tokenizer).
#
# Keys are matched as substrings against the `model` field of the completion
# call, so "models/amina-v2-final" → matches "amina".
CHAR_CAP_PER_MODEL: Dict[str, int] = {
    "amina":     28_000,   # ~7.3K tokens, server serves 10K
    "mistral":   24_000,   # ~6.3K tokens, mistral-7b ~8K
    "llama":    360_000,   # ~95K tokens, groq llama 3.3 128K
    "groq":     360_000,
    "gemini":  3_000_000,  # ~790K tokens, flash-lite 1M
    "gpt-4o":   360_000,   # 128K
}
DEFAULT_CHAR_CAP = 60_000   # ~16K tokens — safe floor for unknown models

# How many times to retry after a real overflow error from the server.
MAX_OVERFLOW_RETRIES = 6

# Never shrink the prompt below this many messages — we always keep the
# system prompt (if any) and the final user turn.
MIN_MESSAGES_FLOOR = 2


# ── Helpers ──────────────────────────────────────────────────────────────────

def _estimate_chars(messages: List[Dict[str, Any]]) -> int:
    total = 0
    for m in messages or []:
        c = m.get("content") if isinstance(m, dict) else None
        if c:
            total += len(str(c))
    return total


def _cap_for_model(model: str) -> int:
    if not model:
        return DEFAULT_CHAR_CAP
    m = model.lower()
    for key, cap in CHAR_CAP_PER_MODEL.items():
        if key in m:
            return cap
    return DEFAULT_CHAR_CAP


def _split_system_and_rest(messages: List[Dict[str, Any]]):
    """Return (leading_system_msgs, rest) — system messages at the start of
    the list are preserved verbatim; everything after them is trimable."""
    system_head: List[Dict[str, Any]] = []
    rest: List[Dict[str, Any]] = []
    seen_non_system = False
    for m in messages or []:
        role = m.get("role") if isinstance(m, dict) else None
        if role == "system" and not seen_non_system:
            system_head.append(m)
        else:
            seen_non_system = True
            rest.append(m)
    return system_head, rest


def _drop_oldest_user_turn(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Remove the oldest (user, assistant?) pair from `rest`, keeping the
    system head and the final user turn untouched. Returns a new list.

    If we can't find anything droppable, returns the list unchanged.
    """
    system_head, rest = _split_system_and_rest(messages)
    if len(rest) <= 1:
        return list(messages)  # nothing we can drop — only the current user turn

    # Drop the first message in `rest`. If the one after it is an assistant
    # reply to that dropped user turn, drop it too — they're a pair.
    dropped: List[Dict[str, Any]] = []
    dropped.append(rest[0])
    remainder = rest[1:]
    if remainder and isinstance(remainder[0], dict) and remainder[0].get("role") == "assistant":
        dropped.append(remainder[0])
        remainder = remainder[1:]

    if not remainder:
        # Everything after the system head was droppable EXCEPT we must keep
        # the last user message. If remainder is empty, we over-dropped —
        # restore the last one so the request stays valid.
        return list(messages)

    return system_head + remainder


def _pretrim(
    messages: List[Dict[str, Any]],
    char_cap: int,
) -> List[Dict[str, Any]]:
    """Iteratively drop oldest user/assistant pairs until messages fit inside
    `char_cap`. Always keeps the system head and the final user turn."""
    if not messages:
        return messages

    trimmed = list(messages)
    guard = 0
    drops = 0
    while _estimate_chars(trimmed) > char_cap and len(trimmed) > MIN_MESSAGES_FLOOR:
        before_len = len(trimmed)
        trimmed = _drop_oldest_user_turn(trimmed)
        if len(trimmed) == before_len:
            break  # couldn't drop any more
        drops += 1
        guard += 1
        if guard > 50:
            break

    if drops:
        logger.warning(
            "overflow_guard: pre-trim dropped %d old turn(s) "
            "(chars %d → %d, cap %d)",
            drops,
            _estimate_chars(messages),
            _estimate_chars(trimmed),
            char_cap,
        )
    return trimmed


def _is_context_overflow_error(exc: BaseException) -> bool:
    """Heuristic: does this exception look like a server-side context-length
    rejection? We check common substrings from OpenAI, vLLM, Groq, Gemini."""
    if exc is None:
        return False
    msg = str(exc).lower()
    if not msg:
        return False
    needles = (
        "maximum context length",
        "context length",
        "context_length_exceeded",
        "context_length",
        "too many tokens",
        "token limit",
        "input is too long",
        "prompt is too long",
        "request too large",
        "exceeded the maximum",
        "max_tokens",
        "model's maximum",
    )
    return any(n in msg for n in needles)


# ── Wrapper installer ────────────────────────────────────────────────────────

def wrap_client_completions(client: Any, label: str = "") -> bool:
    """Patch a single AsyncOpenAI-compatible client so its
    `.chat.completions.create` does pre-trim + retry-on-overflow.

    Returns True if the patch was installed, False if the client shape was
    unexpected (in which case we leave it alone — fail-open).
    """
    try:
        completions = client.chat.completions
    except Exception as e:
        logger.debug("overflow_guard: client %s has no .chat.completions (%s)", label, e)
        return False

    original = getattr(completions, "create", None)
    if original is None or getattr(original, "_overflow_guard_wrapped", False):
        return False

    async def guarded_create(*args, **kwargs):
        # Pull the logical fields the guard cares about
        messages = kwargs.get("messages")
        model = kwargs.get("model", "") or ""
        if not isinstance(messages, list):
            return await original(*args, **kwargs)

        # --- Pre-trim pass ---------------------------------------------------
        try:
            cap = _cap_for_model(model)
            trimmed = _pretrim(messages, cap)
            if trimmed is not messages:
                kwargs["messages"] = trimmed
                messages = trimmed
        except Exception as e:
            logger.warning("overflow_guard: pre-trim raised, continuing with original: %s", e)

        # --- Attempt + retry-on-overflow ------------------------------------
        attempt = 0
        last_exc: Optional[BaseException] = None
        while attempt <= MAX_OVERFLOW_RETRIES:
            try:
                return await original(*args, **kwargs)
            except Exception as exc:
                if not _is_context_overflow_error(exc):
                    raise
                last_exc = exc
                attempt += 1
                if len(messages) <= MIN_MESSAGES_FLOOR:
                    break
                shrunk = _drop_oldest_user_turn(messages)
                if len(shrunk) == len(messages):
                    break
                logger.warning(
                    "overflow_guard [%s]: %s server rejected prompt (%s) — "
                    "dropping oldest turn and retrying (attempt %d/%d, "
                    "now %d msgs / %d chars)",
                    label, model, type(exc).__name__, attempt, MAX_OVERFLOW_RETRIES,
                    len(shrunk), _estimate_chars(shrunk),
                )
                messages = shrunk
                kwargs["messages"] = messages
                continue

        # If we ran out of retries, surface the last exception so the caller
        # can fall back to its own error path. memory.messages is untouched.
        logger.error(
            "overflow_guard [%s]: exhausted %d retries for model %s — "
            "re-raising last server error",
            label, MAX_OVERFLOW_RETRIES, model,
        )
        if last_exc is not None:
            raise last_exc
        # Should be unreachable
        return await original(*args, **kwargs)

    guarded_create._overflow_guard_wrapped = True  # type: ignore[attr-defined]
    guarded_create._original = original            # type: ignore[attr-defined]
    try:
        completions.create = guarded_create  # type: ignore[assignment]
        logger.info("overflow_guard: wrapped %s client (cap table active)", label or "<unnamed>")
        return True
    except Exception as e:
        logger.warning("overflow_guard: failed to set wrapper on %s: %s", label, e)
        return False
