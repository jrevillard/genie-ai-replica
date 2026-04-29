"""Feature flag registry for the v2 translation pipeline.

All flags default OFF. The legacy pipeline remains the only live path
until a tech lead explicitly flips flags per environment. Per-request
overrides (e.g. via HTTP header) will be layered on top of these
defaults in Step 3, without mutating the process-wide values here.
"""
from __future__ import annotations

import os


def _env_bool(name: str, default: bool) -> bool:
    """Parse a boolean env var. Accepts 1/0, true/false, yes/no, on/off."""
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


USE_V2_TRANSLATION_PIPELINE: bool = _env_bool("USE_V2_TRANSLATION_PIPELINE", False)

USE_V2_TM_CACHE: bool = _env_bool("USE_V2_TM_CACHE", False)
USE_V2_GLOSSARY: bool = _env_bool("USE_V2_GLOSSARY", False)
USE_V2_RAG: bool = _env_bool("USE_V2_RAG", False)
USE_V2_QE: bool = _env_bool("USE_V2_QE", False)
USE_V2_SHADOW_MODE: bool = _env_bool("USE_V2_SHADOW_MODE", False)

# Stage 8 — bridge polish. Runs the glossary word-boundary substitution
# on LLM output too (not just NLLB output). Catches English medical
# terms the LLM leaks through despite being in the prompt snippet.
# Cheap (<1ms), idempotent, reversible by flipping the flag.
USE_V2_BRIDGE_POLISH: bool = _env_bool("USE_V2_BRIDGE_POLISH", False)

# When True, text classified as PII-bearing is force-routed to the local
# provider (NLLB) regardless of primary/fallback config. Keeps PII off
# cloud APIs without sacrificing translation quality for named entities
# (no masking, no placeholders).
USE_V2_PII_LOCAL_ROUTING: bool = _env_bool("USE_V2_PII_LOCAL_ROUTING", False)

V2_PRIMARY_PROVIDER: str = os.getenv("V2_PRIMARY_PROVIDER", "openai")
V2_FALLBACK_PROVIDER: str = os.getenv("V2_FALLBACK_PROVIDER", "nllb")

# Fire the fallback provider in parallel on N% of requests; log
# disagreements. Never affects the returned result. 0 = disabled.
V2_SHADOW_PERCENT: int = max(0, min(100, int(os.getenv("V2_SHADOW_PERCENT", "0") or "0")))

# Step 7 — frontend-transparent v1 shim.
# When True, POST /api/v1/agent/translate and /translate/batch are
# transparently routed through the v2 Router by a middleware in
# main_with_translation_v2.py. Response shape is byte-identical to v1,
# so no frontend changes are required. Per-request opt-in via the
# `X-Translation-Pipeline: v2` header works even when this flag is False.
USE_V2_FOR_V1_ENDPOINTS: bool = _env_bool("USE_V2_FOR_V1_ENDPOINTS", False)

# When True, src.services.translator.get_translator() is monkey-patched
# to return a v2-backed proxy. Catches every internal caller of the
# legacy translator (e.g., agent/chat's response translation,
# prescription analysis), not just the two public v1 translate
# endpoints that USE_V2_FOR_V1_ENDPOINTS covers. Falls back to legacy
# on v2 error so chat is never broken by a v2 bug.
USE_V2_FOR_LEGACY_TRANSLATOR: bool = _env_bool("USE_V2_FOR_LEGACY_TRANSLATOR", False)

# ── RAG pipeline (Step 4) ─────────────────────────────────────────────
V2_RAG_EMBED_URL: str = os.getenv("V2_RAG_EMBED_URL", "http://tei:80")
V2_RAG_EMBED_MODEL: str = os.getenv("V2_RAG_EMBED_MODEL", "intfloat/multilingual-e5-large")
V2_RAG_CHUNK_SIZE_CHARS: int = int(os.getenv("V2_RAG_CHUNK_SIZE_CHARS", "2400") or "2400")
V2_RAG_CHUNK_OVERLAP_CHARS: int = int(os.getenv("V2_RAG_CHUNK_OVERLAP_CHARS", "400") or "400")
V2_RAG_MIN_CHUNK_CHARS: int = int(os.getenv("V2_RAG_MIN_CHUNK_CHARS", "100") or "100")
V2_RAG_SCANNED_TEXT_THRESHOLD: int = int(os.getenv("V2_RAG_SCANNED_TEXT_THRESHOLD", "50") or "50")

# Step 5 — PDF Q&A generation
V2_RAG_DEFAULT_STRATEGY: str = os.getenv("V2_RAG_DEFAULT_STRATEGY", "answer_then_translate")
V2_RAG_DEFAULT_K: int = int(os.getenv("V2_RAG_DEFAULT_K", "5") or "5")
V2_RAG_QE_THRESHOLD: float = float(os.getenv("V2_RAG_QE_THRESHOLD", "0.5") or "0.5")


def snapshot() -> dict[str, object]:
    """Return current flag values — for logging/diagnostics."""
    return {
        "USE_V2_TRANSLATION_PIPELINE": USE_V2_TRANSLATION_PIPELINE,
        "USE_V2_TM_CACHE": USE_V2_TM_CACHE,
        "USE_V2_GLOSSARY": USE_V2_GLOSSARY,
        "USE_V2_RAG": USE_V2_RAG,
        "USE_V2_QE": USE_V2_QE,
        "USE_V2_SHADOW_MODE": USE_V2_SHADOW_MODE,
        "USE_V2_BRIDGE_POLISH": USE_V2_BRIDGE_POLISH,
        "USE_V2_PII_LOCAL_ROUTING": USE_V2_PII_LOCAL_ROUTING,
        "USE_V2_FOR_V1_ENDPOINTS": USE_V2_FOR_V1_ENDPOINTS,
        "USE_V2_FOR_LEGACY_TRANSLATOR": USE_V2_FOR_LEGACY_TRANSLATOR,
        "V2_PRIMARY_PROVIDER": V2_PRIMARY_PROVIDER,
        "V2_FALLBACK_PROVIDER": V2_FALLBACK_PROVIDER,
        "V2_SHADOW_PERCENT": V2_SHADOW_PERCENT,
    }
