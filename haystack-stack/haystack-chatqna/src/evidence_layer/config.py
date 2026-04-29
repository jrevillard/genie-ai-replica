"""
Evidence Layer — environment-driven configuration.

Defaults are conservative: layer is OFF, fail-open is true so chat
keeps working even if anything in this package raises.
"""
from __future__ import annotations

import os
from enum import Enum


def _envflag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


class EvidenceState(str, Enum):
    OFF       = "off"
    LOADING   = "loading"
    ON        = "on"
    REVERTING = "reverting"
    ERROR     = "error"


# Default startup state. Admin toggle is what flips it on; this is just
# the bootstrap value when no Redis/state is found.
AMINA_EVIDENCE_LAYER_DEFAULT = (
    os.getenv("AMINA_EVIDENCE_LAYER_DEFAULT", "off").strip().lower()
)
if AMINA_EVIDENCE_LAYER_DEFAULT not in {s.value for s in EvidenceState}:
    AMINA_EVIDENCE_LAYER_DEFAULT = "off"

# Per-feature kill switches. Even when the layer is ON, ops can disable
# individual subsystems via env without admin-UI churn.
AMINA_EVIDENCE_TRACE_ENABLED = _envflag("AMINA_EVIDENCE_TRACE_ENABLED", True)
AMINA_EVIDENCE_EVAL_ENABLED  = _envflag("AMINA_EVIDENCE_EVAL_ENABLED",  True)

# Persistence backend. "redis" prefers Redis with file fallback;
# "file" forces JSONL only; "none" disables persistence.
AMINA_EVIDENCE_STORE = os.getenv("AMINA_EVIDENCE_STORE", "redis").strip().lower()
if AMINA_EVIDENCE_STORE not in ("redis", "file", "none"):
    AMINA_EVIDENCE_STORE = "redis"

# Fail-open: any exception in the layer must NOT break the chat.
AMINA_EVIDENCE_FAIL_OPEN = _envflag("AMINA_EVIDENCE_FAIL_OPEN", True)

# Stable salt used to hash session_id / patient_id before they leave the
# process. NEVER include the salt in any output. If unset we still hash —
# but a stable per-deploy salt is recommended for cross-trace joins.
AMINA_EVIDENCE_HASH_SALT = os.getenv("AMINA_EVIDENCE_HASH_SALT", "amina-evidence-v1")

# Directory for markdown reports + JSONL traces. Container path; the
# host can bind-mount this for persistence.
AMINA_EVIDENCE_REPORTS_DIR = os.getenv(
    "AMINA_EVIDENCE_REPORTS_DIR", "/app/reports/evidence",
)

# Cap synthetic eval runtime per case so a stuck model can't lock the
# admin out. Per-turn timeout (seconds).
AMINA_EVIDENCE_EVAL_TIMEOUT_S = float(os.getenv("AMINA_EVIDENCE_EVAL_TIMEOUT_S", "30"))

# Trim long fields when emitting JSONL so a single trace can never
# explode disk.
AMINA_EVIDENCE_MAX_FIELD_LEN = int(os.getenv("AMINA_EVIDENCE_MAX_FIELD_LEN", "1024"))

# Bounded parallelism for the eval runner. Conservative default (2) so
# Groq/Gemini rate limits don't trip during a 47-case sweep.
AMINA_EVIDENCE_EVAL_CONCURRENCY = max(1, int(
    os.getenv("AMINA_EVIDENCE_EVAL_CONCURRENCY", "2")
))

# Redis state keys. Prefixed so they never collide with chat state.
REDIS_STATE_KEY                = "amina:evidence:state"
REDIS_LAST_CHANGED_BY_KEY      = "amina:evidence:last_changed_by"
REDIS_LAST_CHANGED_AT_KEY      = "amina:evidence:last_changed_at"
REDIS_LAST_ENABLED_BY_KEY      = "amina:evidence:last_enabled_by"
REDIS_LAST_EVAL_SCORE_KEY      = "amina:evidence:last_eval_score"
REDIS_LAST_REPORT_PATH_KEY     = "amina:evidence:last_report_path"
REDIS_RECENT_TRACES_KEY        = "amina:evidence:recent_traces"   # list, capped
REDIS_RECENT_TRACES_MAX        = 200

# Eval-progress keys (transient — cleared on boot via state._reset_eval_state)
REDIS_EVAL_PROGRESS_KEY        = "amina:evidence:eval_progress"   # JSON blob
REDIS_EVAL_CANCEL_KEY          = "amina:evidence:eval_cancel"     # "1" if cancel requested
