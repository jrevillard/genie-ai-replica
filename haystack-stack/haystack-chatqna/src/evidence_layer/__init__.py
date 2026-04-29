"""
AMINA Evidence Layer.

A toggleable observability + synthetic-eval layer that captures
privacy-safe per-turn metadata and runs protocol-derived evals.

DEFAULT: OFF. Admin must explicitly enable via the admin UI.
When OFF, AMINA's runtime behavior is unchanged.

See docs/EVIDENCE_LAYER.md for the full lifecycle.
"""
from src.evidence_layer.config import (
    AMINA_EVIDENCE_LAYER_DEFAULT,
    AMINA_EVIDENCE_TRACE_ENABLED,
    AMINA_EVIDENCE_EVAL_ENABLED,
    AMINA_EVIDENCE_FAIL_OPEN,
    AMINA_EVIDENCE_HASH_SALT,
    AMINA_EVIDENCE_REPORTS_DIR,
    EvidenceState,
)
from src.evidence_layer.models import (
    EvidenceLayerStatus,
    EvidenceLayerToggleRequest,
    EvidenceTrace,
    EvidenceEvalCase,
    EvidenceEvalResult,
    EvidenceSummary,
    EvalProgress,
)

__all__ = [
    "AMINA_EVIDENCE_LAYER_DEFAULT",
    "AMINA_EVIDENCE_TRACE_ENABLED",
    "AMINA_EVIDENCE_EVAL_ENABLED",
    "AMINA_EVIDENCE_FAIL_OPEN",
    "AMINA_EVIDENCE_HASH_SALT",
    "AMINA_EVIDENCE_REPORTS_DIR",
    "EvidenceState",
    "EvidenceLayerStatus",
    "EvidenceLayerToggleRequest",
    "EvidenceTrace",
    "EvidenceEvalCase",
    "EvidenceEvalResult",
    "EvidenceSummary",
    "EvalProgress",
]
