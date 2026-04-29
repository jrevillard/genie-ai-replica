"""
agent_tokens_fix — raise the output-token ceiling so multi-point answers
don't truncate mid-list.

Why this exists
---------------
src/agent/amina_agent.py::_get_max_tokens returns a per-message output
cap (80 → 400) that's tuned for short CHW replies. When the patient asks
for a *care plan* — "how do I manage my diabetes?", "what should I do
about my blood pressure?" — Amina produces a 2-4 paragraph answer with a
numbered list of action steps. 400 tokens isn't enough: the reply cuts
off mid-list (e.g. "1. Monitor… 2. Take medication… 3." with no text
after the 3.).

The existing sentence-boundary trim at amina_agent.py:1729 only hides
the ragged edge — it doesn't buy more tokens, so the user still never
sees items 3-N.

What this does
--------------
Monkey-patches ``amina_agent._get_max_tokens`` with a superset rule:
    - Everything the original tier returned still applies.
    - When the message is a clear plan/list request OR the message is
      long enough that the reply will naturally be multi-point, return
      a larger cap (default 1000) so GPT-4o-mini has room to finish.
    - Tunable via env so ops can dial it back if billing complains.

Because _MODEL_BUDGETS is a function-local constant, patching
_get_max_tokens is the only additive lever for the "base" and "gemini"
paths without touching amina_agent.py. The "amina" (LoRA), "groq" and
"mistral" paths have fixed caps inside the tuple and are unaffected by
this file — if you need to raise those, switch the model_preference to
"base" or "gemini" for long-plan turns.

Env tunables
------------
    AMINA_MAX_TOKENS_PLAN       (default 1000) — cap when the message
                                   asks for a multi-point plan / list.
    AMINA_MAX_TOKENS_LONG       (default 600)  — cap for long messages
                                   (>=250 chars) that aren't explicit
                                   plan requests but tend to produce
                                   medium-length clinical answers.
    AMINA_MAX_TOKENS_STANDARD   (default 400)  — raised from 200.
    AMINA_MAX_TOKENS_SHORT      (default 250)  — raised from 150.
    AMINA_MAX_TOKENS_TINY       (default 100)  — raised from 80.

LoRA path (model_preference="amina")
------------------------------------
The LoRA budget tuple (_MODEL_BUDGETS["amina"]) lives inside a function
body, which makes it unreachable by attribute-patching. We instead
wrap ``self.amina_client.chat.completions.create`` — that runs AFTER
the hardcoded 900 cap and can override max_tokens on a per-call basis
when the latest user message reads as a plan request. LoRA's vLLM
backend has max_model_len=8192; with ~5K tokens of input headroom the
output can safely stretch to ~1500-2000 tokens before bumping the
context ceiling.

    AMINA_LORA_MAX_TOKENS_PLAN  (default 1500) — per-call override for
                                    plan requests when routed through
                                    the LoRA vLLM endpoint.
    AMINA_LORA_MAX_TOKENS_FLOOR (default 600)  — minimum max_tokens
                                    applied to ANY LoRA call, even for
                                    non-plan prompts. Stops 250-400
                                    caps from leaking in.

Translator path (EN ↔ MA)
-------------------------
translator.py hardcodes ``max_tokens=500`` for single translate() and
``max_tokens=1500`` for translate_batch(). A 1000-token English reply
from the bumped LLM path translates to ~1000-1500 Mandinka tokens, so
the single-call path truncates the Mandinka exactly where the English
reply USED to truncate. Wrap the translator's OpenAI/Gemma client with
the same upward-clamp shim so translate() can grow as the source grows.

    AMINA_TRANSLATOR_MAX_TOKENS_FLOOR  (default 2000) — floor applied
                                          to every translator LLM call.
                                          Never shrinks caller cap.
"""

from __future__ import annotations

import logging
import os
import re

log = logging.getLogger("agent_tokens_fix")


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default


# Re-tunable at import time from environment
_TOK_PLAN     = _env_int("AMINA_MAX_TOKENS_PLAN",     1000)
_TOK_LONG     = _env_int("AMINA_MAX_TOKENS_LONG",     600)
_TOK_STANDARD = _env_int("AMINA_MAX_TOKENS_STANDARD", 400)
_TOK_SHORT    = _env_int("AMINA_MAX_TOKENS_SHORT",    250)
_TOK_TINY     = _env_int("AMINA_MAX_TOKENS_TINY",     100)

# LoRA-specific caps (vLLM endpoint, max_model_len=8192)
_LORA_TOK_PLAN  = _env_int("AMINA_LORA_MAX_TOKENS_PLAN",  1500)
_LORA_TOK_FLOOR = _env_int("AMINA_LORA_MAX_TOKENS_FLOOR", 600)

# Translator client floor (applies to both single + batch translate calls)
_TRANSLATOR_TOK_FLOOR = _env_int("AMINA_TRANSLATOR_MAX_TOKENS_FLOOR", 2000)


# Broader than the module's private _wants_detailed_plan. Matches the
# actual prompts patients send in the chat UI, e.g. "how can I manage my
# blood sugar", "what should I do about my BP", "care plan for me".
_PLAN_KEYWORDS = re.compile(
    r"\b(care plan|manage|management|managing|monitor|"
    r"watch out|warning sign|symptom[s]?|"
    r"what should|how (do|can|should) i|"
    r"step[s]? to|tips?|guide(line)?s?|routine|"
    r"list|plan|advice|recommend(ation)?s?|"
    r"do and don'?t|dos and don'?ts|avoid|"
    r"diet|nutrition|exercise|lifestyle|"
    r"prevent|complication[s]?|emergenc(y|ies))\b",
    re.IGNORECASE,
)

# "Give me N things" / explicit numbered-list hints.
_NUMBERED_HINT = re.compile(
    r"\b(\d+\s+(things|steps|ways|tips|points|rules)|"
    r"number(ed)? list|bullet[s]? point[s]?)\b",
    re.IGNORECASE,
)

_SIMPLE_ACKS = {
    "ok", "okay", "yes", "no", "thanks", "thank you", "good",
    "got it", "understood", "noted", "sure", "alright", "fine",
}


def _looks_like_plan_request(message: str) -> bool:
    """True when the reply is very likely to be multi-paragraph + a list."""
    if not message:
        return False
    if _NUMBERED_HINT.search(message):
        return True
    # Long messages + any plan keyword → near-certain multi-point answer.
    if len(message) >= 120 and _PLAN_KEYWORDS.search(message):
        return True
    # Short but explicit: "care plan", "how can I manage X".
    if _PLAN_KEYWORDS.search(message) and (
        "plan" in message.lower()
        or "manage" in message.lower()
        or "how can" in message.lower()
        or "how do" in message.lower()
        or "how should" in message.lower()
    ):
        return True
    return False


def _patched_get_max_tokens(message: str) -> int:
    """Drop-in replacement for amina_agent._get_max_tokens.

    Preserves the existing tiering philosophy (short ack → tiny budget)
    while guaranteeing enough room for multi-point clinical plans."""
    if not isinstance(message, str):
        message = str(message or "")

    msg = message.strip().lower()

    if len(msg) < 25 or msg in _SIMPLE_ACKS:
        return _TOK_TINY

    if _looks_like_plan_request(message):
        return _TOK_PLAN

    if len(msg) < 80:
        return _TOK_SHORT
    if len(msg) < 250:
        return _TOK_STANDARD
    return _TOK_LONG


def _extract_last_user_message(messages) -> str:
    """Pull the last user-role content out of an OpenAI messages list.

    LoRA's call site uses the shape:
        [{"role": "system", ...},
         {"role": "user",   ...},   ← prior turns
         {"role": "assistant", ...},
         {"role": "user",   ...}]   ← what we care about
    A prompt like 'Patient says: "how do I manage diabetes?"\\n\\nRespond as
    AMINA:' is the last user turn; scan it for plan keywords."""
    if not messages:
        return ""
    for m in reversed(messages):
        role = m.get("role") if isinstance(m, dict) else getattr(m, "role", None)
        if role == "user":
            content = m.get("content") if isinstance(m, dict) else getattr(m, "content", "")
            return content or ""
    return ""


def _wrap_lora_create(create_fn):
    """Return an async wrapper around client.chat.completions.create that
    enforces plan/floor caps when the LoRA endpoint is the target.

    Never REDUCES max_tokens — always clamps upward so existing callers
    that deliberately pass a small cap (e.g. summarisers) aren't
    clobbered. The floor only kicks in above the caller's value when the
    caller sent a conservative small number."""
    _already_wrapped = getattr(create_fn, "_agent_tokens_fix_wrapped", False)
    if _already_wrapped:
        return create_fn

    async def _wrapped(*args, **kwargs):
        try:
            messages    = kwargs.get("messages") or (args[1] if len(args) > 1 else None)
            caller_cap  = kwargs.get("max_tokens")
            last_user   = _extract_last_user_message(messages)
            wants_plan  = _looks_like_plan_request(last_user)

            target = _LORA_TOK_PLAN if wants_plan else _LORA_TOK_FLOOR
            # Clamp upward only — never shrink an explicit caller cap.
            effective = max(caller_cap or 0, target)
            if caller_cap != effective:
                kwargs["max_tokens"] = effective
                log.info(
                    "lora_tokens_fix: bumped max_tokens %s → %d (plan=%s, "
                    "msg_len=%d)",
                    caller_cap, effective, wants_plan, len(last_user or ""),
                )
        except Exception as e:
            # Never let the wrapper break a real LLM call.
            log.debug("lora_tokens_fix wrapper non-fatal error: %s", e)

        return await create_fn(*args, **kwargs)

    _wrapped._agent_tokens_fix_wrapped = True  # type: ignore[attr-defined]
    return _wrapped


def _wrap_translator_create(create_fn):
    """Clamp-upward wrapper around translator.client.chat.completions.create.

    Unlike the LoRA wrapper, translators don't care about plan-intent —
    the bottleneck is always 'does the OUTPUT have room for the full
    translation of whatever the caller sent'. So a flat floor is enough.
    """
    if getattr(create_fn, "_agent_tokens_fix_wrapped", False):
        return create_fn

    async def _wrapped(*args, **kwargs):
        try:
            caller_cap = kwargs.get("max_tokens")
            effective  = max(caller_cap or 0, _TRANSLATOR_TOK_FLOOR)
            if caller_cap != effective:
                kwargs["max_tokens"] = effective
                log.info(
                    "translator_tokens_fix: bumped max_tokens %s → %d",
                    caller_cap, effective,
                )
        except Exception as e:
            log.debug("translator_tokens_fix wrapper non-fatal error: %s", e)
        return await create_fn(*args, **kwargs)

    _wrapped._agent_tokens_fix_wrapped = True  # type: ignore[attr-defined]
    return _wrapped


def _patch_translator_client(translator) -> bool:
    """Wrap the OpenAI/Gemma client on a Translator instance. Returns
    True if a patch was applied, False if already wrapped or missing."""
    client = getattr(translator, "client", None)
    if client is None:
        return False
    try:
        create_fn = client.chat.completions.create
    except AttributeError:
        log.warning("translator_tokens_fix: client missing chat.completions.create")
        return False

    if getattr(create_fn, "_agent_tokens_fix_wrapped", False):
        return False

    client.chat.completions.create = _wrap_translator_create(create_fn)  # type: ignore[assignment]
    return True


def _patch_amina_client(agent) -> bool:
    """Wrap the LoRA vLLM client on a single AminaAgent instance.

    Returns True if a patch was applied, False if the instance had no
    amina_client (LoRA disabled) or was already patched."""
    client = getattr(agent, "amina_client", None)
    if client is None:
        return False
    try:
        create_fn = client.chat.completions.create
    except AttributeError:
        log.warning("lora_tokens_fix: amina_client missing chat.completions.create")
        return False

    if getattr(create_fn, "_agent_tokens_fix_wrapped", False):
        return False

    client.chat.completions.create = _wrap_lora_create(create_fn)  # type: ignore[assignment]
    return True


def apply() -> None:
    """Install both patches: message-length heuristic (base/gemini) and
    LoRA vLLM client wrapper. Idempotent."""
    try:
        from src.agent import amina_agent as _aa
    except Exception as e:
        log.error("agent_tokens_fix: could not import amina_agent: %s", e)
        return

    # (1) Base / Gemini path — replace the module-level cap function.
    _aa._get_max_tokens = _patched_get_max_tokens  # type: ignore[attr-defined]
    log.info(
        "✅ agent_tokens_fix active — caps: tiny=%d short=%d standard=%d "
        "long=%d plan=%d",
        _TOK_TINY, _TOK_SHORT, _TOK_STANDARD, _TOK_LONG, _TOK_PLAN,
    )

    # (2) LoRA path — wrap the vLLM client. Patch both (a) any already-
    # created singleton and (b) AminaAgent.__init__ so future instances
    # are wrapped too. The singleton in get_agent() is lazy, so (b) is
    # what catches first-call-wins production traffic.
    _original_init = _aa.AminaAgent.__init__

    def _patched_init(self, *a, **kw):
        _original_init(self, *a, **kw)
        try:
            if _patch_amina_client(self):
                log.info("✅ lora_tokens_fix active on new AminaAgent "
                         "— plan=%d floor=%d", _LORA_TOK_PLAN, _LORA_TOK_FLOOR)
        except Exception as e:
            log.warning("lora_tokens_fix init hook non-fatal error: %s", e)

    # Don't double-wrap __init__ on re-apply.
    if not getattr(_aa.AminaAgent.__init__, "_agent_tokens_fix_init_wrapped", False):
        _patched_init._agent_tokens_fix_init_wrapped = True  # type: ignore[attr-defined]
        _aa.AminaAgent.__init__ = _patched_init  # type: ignore[method-assign]

    # Patch existing singleton if one was created before apply() ran.
    existing = getattr(_aa, "_agent_instance", None)
    if existing is not None:
        try:
            if _patch_amina_client(existing):
                log.info("✅ lora_tokens_fix active on existing singleton "
                         "— plan=%d floor=%d", _LORA_TOK_PLAN, _LORA_TOK_FLOOR)
        except Exception as e:
            log.warning("lora_tokens_fix singleton-patch non-fatal error: %s", e)

    # (3) Translator path — wrap the OpenAI/Gemma client so EN↔MA calls
    # don't truncate long multi-point translations. Same strategy as
    # LoRA: patch Translator.__init__ for future instances AND patch
    # any existing singleton.
    try:
        from src.services import translator as _tr
    except Exception as e:
        log.warning("translator_tokens_fix: could not import translator: %s", e)
        return

    _original_tr_init = _tr.Translator.__init__

    def _patched_tr_init(self, *a, **kw):
        _original_tr_init(self, *a, **kw)
        try:
            if _patch_translator_client(self):
                log.info("✅ translator_tokens_fix active on new Translator "
                         "— floor=%d", _TRANSLATOR_TOK_FLOOR)
        except Exception as e:
            log.warning("translator_tokens_fix init hook non-fatal error: %s", e)

    if not getattr(_tr.Translator.__init__, "_agent_tokens_fix_init_wrapped", False):
        _patched_tr_init._agent_tokens_fix_init_wrapped = True  # type: ignore[attr-defined]
        _tr.Translator.__init__ = _patched_tr_init  # type: ignore[method-assign]

    existing_tr = getattr(_tr, "_translator", None)
    if existing_tr is not None:
        try:
            if _patch_translator_client(existing_tr):
                log.info("✅ translator_tokens_fix active on existing singleton "
                         "— floor=%d", _TRANSLATOR_TOK_FLOOR)
        except Exception as e:
            log.warning("translator_tokens_fix singleton-patch non-fatal error: %s", e)
