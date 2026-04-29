"""
AMINA Agent Platform v1 — PHI-redacted trace sink.

Logs structured JSON traces via the standard Python logger. Optional
ArcadeDB persistence is left as a TODO (Phase 3 will add OpenTelemetry).

CRITICAL — never log:
  - raw user message
  - phone number
  - patient name
  - full patient_id (use a hash)
  - tokens / API keys / app secrets
  - full tool outputs (only safe_summary)

Helpers below provide the only sanctioned ways to surface identifiers.
"""
from __future__ import annotations

import hashlib
import json
import logging
from typing import Optional

from src.agent_platform.config import AMINA_AGENTIC_TRACE_ENABLED
from src.agent_platform.models import AgentTrace

logger = logging.getLogger("agent_platform.trace")


def hash_id(value: Optional[str]) -> str:
    """Stable, non-reversible short identifier for a session_id / patient_id."""
    if not value:
        return ""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:10]


def emit(trace: AgentTrace) -> None:
    if not AMINA_AGENTIC_TRACE_ENABLED:
        return
    safe = trace.to_safe_dict()
    try:
        # One JSON line per trace — easy for log aggregators to parse.
        logger.info("AGENT_TRACE %s", json.dumps(safe, separators=(",", ":")))
    except Exception:  # pragma: no cover
        # Last-ditch: structured failure that still doesn't include PHI.
        logger.warning("AGENT_TRACE_LOG_FAILED trace_id=%s", trace.trace_id)
