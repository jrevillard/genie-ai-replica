"""Translation v3.5 configuration -- env-driven, all defaults safe.

When ``AMINA_TRANSLATION_V4_ENABLED`` is False (default), every other
flag in this module is irrelevant -- the pipeline never runs.
"""
from __future__ import annotations

import os


def _bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    return default


def _float_env(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    try:
        return float(raw) if raw else default
    except ValueError:
        return default


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    try:
        return int(raw) if raw else default
    except ValueError:
        return default


# Master flag. When False, pipeline.translate() returns None immediately
# and the existing v1 path handles the call -- zero behaviour change.
AMINA_TRANSLATION_V4_ENABLED: bool = _bool_env("AMINA_TRANSLATION_V4_ENABLED", False)

# Per-sentence serve thresholds (overall score from Stage 5).
V4_SERVE_MANDINKA_THRESHOLD: float  = _float_env("V4_SERVE_MANDINKA_THRESHOLD", 0.80)
V4_SERVE_BILINGUAL_THRESHOLD: float = _float_env("V4_SERVE_BILINGUAL_THRESHOLD", 0.60)

# Hard block: any sentence with clinical_safety below this serves English
# regardless of overall score. Matches Stage 7 router policy.
V4_CLINICAL_SAFETY_BLOCK: float = _float_env("V4_CLINICAL_SAFETY_BLOCK", 0.50)

# Back-translation (Stage 4). When circularity matters more than cost,
# turn this off via env -- pipeline degrades to phrasebank + corrector.
V4_BACK_TRANSLATION_ENABLED: bool       = _bool_env("V4_BACK_TRANSLATION_ENABLED", True)
V4_BACK_TRANSLATION_TEMPERATURE: float  = _float_env("V4_BACK_TRANSLATION_TEMPERATURE", 0.3)

# Phrasebank coverage at or above this auto-wins Stage 2 (no LLM call,
# no back-translation -- the phrase bank is native-validated).
V4_PHRASEBANK_COVERAGE_THRESHOLD: float = _float_env("V4_PHRASEBANK_COVERAGE_THRESHOLD", 0.80)

# Hard latency cap. If a translation exceeds this, telemetry flags it
# and the next call skips back-translation. The user is never blocked.
V4_MAX_LATENCY_MS: int = _int_env("V4_MAX_LATENCY_MS", 3500)

# Telemetry: log-only in v3.5; ArcadeDB persistence is v4.2 work.
V4_TELEMETRY_ENABLED: bool = _bool_env("V4_TELEMETRY_ENABLED", True)


# ── v4.2 additions ───────────────────────────────────────────────────
# These knobs ONLY matter when ``AMINA_TRANSLATION_V4_ENABLED`` is on.

# NLLB-200 sidecar (PART 1 docker-compose.nllb.yml).
NLLB_API_URL:    str  = os.getenv("NLLB_API_URL", "http://nllb-translate:7860").rstrip("/")
NLLB_ENABLED:    bool = _bool_env("NLLB_ENABLED", True)
NLLB_TIMEOUT_MS: int  = _int_env("NLLB_TIMEOUT_MS", 10_000)

# Stage 3 -- Bambara -> Mandinka adapter. Independent flag so we can
# turn the adapter off (e.g. for an A/B test of "raw NLLB Bambara")
# without disabling the engine itself.
BAMBARA_ADAPTER_ENABLED: bool = _bool_env("BAMBARA_ADAPTER_ENABLED", True)

# When True, Stage 4 prefers NLLB for back-translation when the forward
# engine was the LLM -- this is the cross-model circularity fix.
# When False (or when NLLB is unavailable) Stage 4 keeps v3.5 behaviour
# (same LLM, raised temperature).
V4_BACK_TRANSLATION_PREFER_NLLB: bool = _bool_env("V4_BACK_TRANSLATION_PREFER_NLLB", True)

# Persist per-call telemetry to ArcadeDB ``TranslationMetric`` vertex
# in addition to the structured log line. Fire-and-forget; failures
# never block the response path.
V4_TELEMETRY_ARCADEDB: bool = _bool_env("V4_TELEMETRY_ARCADEDB", True)


def snapshot() -> dict:
    """Single source of truth for `/health` / debug introspection."""
    return {
        "v4_enabled":                       AMINA_TRANSLATION_V4_ENABLED,
        "serve_mandinka_threshold":         V4_SERVE_MANDINKA_THRESHOLD,
        "serve_bilingual_threshold":        V4_SERVE_BILINGUAL_THRESHOLD,
        "clinical_safety_block":            V4_CLINICAL_SAFETY_BLOCK,
        "back_translation_enabled":         V4_BACK_TRANSLATION_ENABLED,
        "back_translation_temperature":     V4_BACK_TRANSLATION_TEMPERATURE,
        "phrasebank_coverage_threshold":    V4_PHRASEBANK_COVERAGE_THRESHOLD,
        "max_latency_ms":                   V4_MAX_LATENCY_MS,
        "telemetry_enabled":                V4_TELEMETRY_ENABLED,
        # v4.2
        "nllb_api_url":                     NLLB_API_URL,
        "nllb_enabled":                     NLLB_ENABLED,
        "nllb_timeout_ms":                  NLLB_TIMEOUT_MS,
        "bambara_adapter_enabled":          BAMBARA_ADAPTER_ENABLED,
        "back_translation_prefer_nllb":     V4_BACK_TRANSLATION_PREFER_NLLB,
        "telemetry_arcadedb":               V4_TELEMETRY_ARCADEDB,
    }
