"""
AMINA Care — LLM Provider Policy + Tracking
============================================
Strict-additive monkey-patch on AminaAgent.process_message that adds:

  1. Three operator-controlled fallback modes:
       graceful → fall back silently (today's behaviour for guests)
       warn     → fall back, but tag the response so admin UI can flag it
       strict   → if model_preference=amina and LoRA is down, do not
                  fall back; raise 503 amina_lora_unavailable
  2. Cascade fallback for AUTHENTICATED users when their preferred
     provider fails (today only guests had this; authed got a 500).
  3. Per-request provider metadata:
       preferred_provider, provider_used, fallback_used,
       provider_error_summary, latency_ms, fallback_chain_attempts
     Set on a contextvar so the response middleware can read it,
     and copied into the result dict so callers see it inline too.
  4. Structured info-level log line per chat call.

Composes with guest_chat_patch — install order in
main_with_rag_tuning.py is:
  1. guest_chat_patch          (inner: short-circuits guest sessions)
  2. llm_provider_policy       (outer: cascade + tracking + strict)

The outer wrapper sees `user_role == "guest"` in the inner result and
records the guest provider metadata accordingly.

Env vars
--------
  LLM_FALLBACK_MODE          graceful | warn | strict       default: warn
  SHOW_LLM_PROVIDER_BADGE    true | false                   default: false
  AMINA_REQUIRE_LORA         true | false                   default: false
  AMINA_REQUIRE_LORA_FOR_GUEST  true | false                default: false
  LLM_FALLBACK_CHAIN         comma list of providers        default: groq,gemini,base
"""
from __future__ import annotations

import contextvars
import logging
import os
import time
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

logger = logging.getLogger("llm_provider_policy")

# ── Env-driven policy ─────────────────────────────────────────────
def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip().lower()

MODE                    = _env("LLM_FALLBACK_MODE",       "warn")     # graceful|warn|strict
SHOW_BADGE              = _env("SHOW_LLM_PROVIDER_BADGE", "false") == "true"
REQUIRE_LORA            = _env("AMINA_REQUIRE_LORA",      "false") == "true"
REQUIRE_LORA_FOR_GUEST  = _env("AMINA_REQUIRE_LORA_FOR_GUEST", "false") == "true"
_FALLBACK_CHAIN_ENV     = _env("LLM_FALLBACK_CHAIN",      "groq,gemini,base")

FALLBACK_CHAIN: List[str] = [
    p.strip() for p in _FALLBACK_CHAIN_ENV.split(",")
    if p.strip() and p.strip() != "amina"
]
if not FALLBACK_CHAIN:
    FALLBACK_CHAIN = ["groq", "gemini", "base"]


# BUG-045: deterministic local-only fallback. The chain today ends in
# "base" (which resolves to OpenAI -- the same provider that already
# failed if the key expired). When every LLM provider in the chain
# returns an error, callers SHOULD serve this canned safe-template
# advisory instead of bubbling a 500 to the user. The integration of
# this into the patched ``_orig_process_message`` flow is intentionally
# left as a follow-up because that surface is clinical-safety
# critical and deserves its own review; this constant + helper are
# the foundation. Use ``safe_template_response()`` from new code.
SAFE_TEMPLATE_PROVIDER = "safe_template"

_SAFE_TEMPLATE_TEXT = (
    "I want to help, but I am not able to answer this safely right now. "
    "Please contact your nearest health centre, your community health "
    "worker, or call 1025 (The Gambia health hotline) if this is urgent."
)


def safe_template_response() -> Dict[str, Any]:
    """Return the canned local-only fallback when every LLM provider
    in the chain has failed. Shape mirrors the agent's normal
    response so the caller can swap it in without restructuring."""
    return {
        "response": _SAFE_TEMPLATE_TEXT,
        "provider": SAFE_TEMPLATE_PROVIDER,
        "is_safe_template": True,
        "tools_used": [],
        "triage_level": "unknown",
        "is_emergency": False,
    }

if MODE not in ("graceful", "warn", "strict"):
    logger.warning("[llm_policy] unknown LLM_FALLBACK_MODE=%r, defaulting to warn", MODE)
    MODE = "warn"

# Contextvar — one per request. The middleware reads this to project
# the metadata onto X-LLM-* response headers.
provider_meta_var: contextvars.ContextVar[Optional[Dict[str, Any]]] = (
    contextvars.ContextVar("amina_provider_meta", default=None)
)

# Public read-only config snapshot (used by /llm/policy diagnostic route)
def policy_snapshot() -> Dict[str, Any]:
    return {
        "mode":                       MODE,
        "show_badge":                 SHOW_BADGE,
        "require_lora":               REQUIRE_LORA,
        "require_lora_for_guest":     REQUIRE_LORA_FOR_GUEST,
        "fallback_chain":             FALLBACK_CHAIN,
        "default_preference":         _default_pref(),
    }


# ── Helpers ───────────────────────────────────────────────────────
_PROVIDER_LABELS = {
    "amina":   "amina-lora",
    "groq":    "groq",
    "gemini":  "gemini",
    "mistral": "mistral",
    "base":    "openai",
}

def _label(pref: Optional[str]) -> str:
    return _PROVIDER_LABELS.get((pref or "").lower(), pref or "default")


def _default_pref() -> str:
    return "amina" if _env("USE_FINETUNED_MODEL", "").lower() == "true" else "base"


def _is_amina(pref: Optional[str]) -> bool:
    return (pref or "").lower() == "amina"


def _attempt_chain(pref: str, is_guest: bool) -> List[str]:
    """Return the ordered list of providers to try."""
    pref_l = pref.lower()
    # Strict + amina + (require_lora OR (guest + require_lora_for_guest)) → no fallback
    require = REQUIRE_LORA or (is_guest and REQUIRE_LORA_FOR_GUEST)
    if MODE == "strict" and _is_amina(pref_l) and require:
        return [pref_l]
    chain = [pref_l]
    for p in FALLBACK_CHAIN:
        if p not in chain:
            chain.append(p)
    return chain


# ── Patch ─────────────────────────────────────────────────────────
_INSTALLED = False
_orig_process_message = None


async def _patched_process_message(self, *args, **kwargs):
    # Resolve the args we care about positionally too.
    def _arg(name: str, idx: int, default=None):
        if name in kwargs:
            return kwargs[name]
        if len(args) > idx:
            return args[idx]
        return default

    pref_in     = _arg("model_preference", 8, None) or _default_pref()
    session_id  = _arg("session_id",       1, "") or ""
    is_guest_sid = isinstance(session_id, str) and session_id.startswith("guest_")

    meta: Dict[str, Any] = {
        "preferred_provider":      _label(pref_in),
        "provider_used":           None,
        "fallback_used":           False,
        "provider_error_summary":  None,
        "latency_ms":              0,
        "context":                 "guest" if is_guest_sid else "auth",
        "mode":                    MODE,
        "fallback_chain_attempts": [],
    }
    provider_meta_var.set(meta)

    started = time.perf_counter()
    chain   = _attempt_chain(pref_in, is_guest_sid)
    last_err: Optional[Exception] = None

    for idx, attempt in enumerate(chain):
        kwargs2 = dict(kwargs)
        kwargs2["model_preference"] = attempt
        try:
            result = await _orig_process_message(self, *args, **kwargs2)
        except HTTPException:
            # Preserve API errors verbatim — they're already shaped.
            raise
        except Exception as e:
            err = (str(e) or e.__class__.__name__)[:200]
            last_err = e
            meta["fallback_chain_attempts"].append(
                {"provider": _label(attempt), "result": "error", "error": err}
            )
            result = None
        else:
            # The agent swallows internal LLM/connection errors and returns
            # a canned apology dict with a populated `error` field instead
            # of raising. Detect that and treat it as an attempt failure so
            # we still cascade through the fallback chain.
            if (
                isinstance(result, dict)
                and (result.get("error") or "")
                and not result.get("is_emergency", False)
            ):
                err = str(result.get("error"))[:200]
                last_err = RuntimeError(err)
                meta["fallback_chain_attempts"].append(
                    {"provider": _label(attempt), "result": "swallowed_error", "error": err}
                )
                result = None

        if result is None:
            if idx == 0:
                # Primary preference failed.
                if (
                    MODE == "strict"
                    and _is_amina(attempt)
                    and (REQUIRE_LORA or (is_guest_sid and REQUIRE_LORA_FOR_GUEST))
                ):
                    meta["provider_error_summary"] = err
                    meta["latency_ms"] = int((time.perf_counter() - started) * 1000)
                    logger.warning(
                        "[llm_policy] strict-mode lora-down: pref=%s err=%s",
                        meta["preferred_provider"], err,
                    )
                    raise HTTPException(
                        status_code=503,
                        detail={
                            "code":               "amina_lora_unavailable",
                            "message":            "Amina model is temporarily unavailable. Please try again later.",
                            "preferred_provider": meta["preferred_provider"],
                        },
                    )
                meta["provider_error_summary"] = err
                logger.warning(
                    "[llm_policy] preferred=%s failed (%s) — trying fallback",
                    meta["preferred_provider"], err,
                )
                continue
            else:
                logger.warning(
                    "[llm_policy] fallback %s failed (%s)",
                    _label(attempt), err,
                )
                continue

        # ── Success ────────────────────────────────────────────────
        # If guest_chat_patch served the call, it returns user_role="guest".
        # In that case the actual provider used is decided by the inner
        # patch (groq with gemini fallback). We tag accordingly.
        served_by_guest_path = isinstance(result, dict) and result.get("user_role") == "guest"
        if served_by_guest_path:
            actual = "groq"  # guest patch's primary; close enough for ops
            # If the inner patch logged a different provider it'll show in
            # the haystack-chatqna log line — the badge just needs to know
            # "fallback was used" which we set below.
            meta["provider_used"] = _label(actual)
        else:
            meta["provider_used"] = _label(attempt)
        meta["fallback_used"] = (
            meta["provider_used"] != meta["preferred_provider"]
        )
        meta["latency_ms"] = int((time.perf_counter() - started) * 1000)
        meta["fallback_chain_attempts"].append(
            {"provider": meta["provider_used"], "result": "success"}
        )

        # Inline metadata in result so callers reading the body get it too.
        if isinstance(result, dict):
            result["provider_meta"] = meta

        logger.info(
            "[llm_policy] mode=%s ctx=%s preferred=%s used=%s fallback=%s latency=%dms",
            MODE, meta["context"], meta["preferred_provider"],
            meta["provider_used"], meta["fallback_used"], meta["latency_ms"],
        )
        return result

    # All providers in the chain failed.
    meta["latency_ms"] = int((time.perf_counter() - started) * 1000)
    if last_err:
        meta["provider_error_summary"] = (str(last_err) or last_err.__class__.__name__)[:200]
    logger.error(
        "[llm_policy] all providers failed: chain=%s last_err=%s",
        chain, meta["provider_error_summary"],
    )
    raise HTTPException(
        status_code=503,
        detail={
            "code":               "all_providers_unavailable",
            "message":            "All chat providers are temporarily unavailable. Please try again later.",
            "preferred_provider": meta["preferred_provider"],
        },
    )


def install() -> None:
    global _INSTALLED, _orig_process_message
    if _INSTALLED:
        return
    try:
        from src.agent.amina_agent import AminaAgent
    except ImportError as e:
        logger.warning("llm_provider_policy: AminaAgent not available: %s", e)
        return
    _orig_process_message = AminaAgent.process_message
    AminaAgent.process_message = _patched_process_message
    _INSTALLED = True
    logger.info(
        "llm_provider_policy installed: mode=%s require_lora=%s chain=%s",
        MODE, REQUIRE_LORA, FALLBACK_CHAIN,
    )


install()
