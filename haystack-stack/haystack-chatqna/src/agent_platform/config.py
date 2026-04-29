"""
AMINA Agent Platform v1 — env-driven config.

CRITICAL:
- Default AMINA_AGENTIC_MODE is "off" (zero behaviour change).
- Invalid env values are logged and fall back to "off".
- Hard limits are NOT overridable per-request.
"""
from __future__ import annotations

import logging
import os
from enum import Enum
from typing import List

logger = logging.getLogger("agent_platform.config")


class AgentMode(Enum):
    OFF    = "off"      # default — runtime returns enabled=False, no work
    SHADOW = "shadow"   # planner + policy run; trace only; original response unchanged
    ASSIST = "assist"   # approved read-only tool results injected as context
    STRICT = "strict"   # placeholder; in v1 behaves like assist with NO writes


def _parse_mode(raw: str) -> AgentMode:
    raw = (raw or "off").strip().lower()
    try:
        return AgentMode(raw)
    except ValueError:
        logger.error(
            "Invalid AMINA_AGENTIC_MODE=%r; falling back to OFF", raw,
        )
        return AgentMode.OFF


def _parse_bool(raw: str, default: bool = True) -> bool:
    if raw is None:
        return default
    return str(raw).strip().lower() in {"true", "1", "yes", "on"}


def _parse_int(raw: str, default: int) -> int:
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


def _parse_csv(raw: str, default: List[str]) -> List[str]:
    if not raw:
        return list(default)
    return [s.strip().lower() for s in raw.split(",") if s.strip()]


# ── Public env-driven config ─────────────────────────────────────────
AMINA_AGENTIC_MODE: AgentMode = _parse_mode(os.getenv("AMINA_AGENTIC_MODE"))
AMINA_AGENTIC_MODES_ALLOWED: List[str] = _parse_csv(
    os.getenv("AMINA_AGENTIC_MODES_ALLOWED"),
    ["advanced", "basic", "beginner"],
)
AMINA_AGENTIC_MAX_TOOL_CALLS: int = _parse_int(
    os.getenv("AMINA_AGENTIC_MAX_TOOL_CALLS"), 3,
)
AMINA_AGENTIC_MAX_PLANNING_ROUNDS: int = _parse_int(
    os.getenv("AMINA_AGENTIC_MAX_PLANNING_ROUNDS"), 1,
)
AMINA_AGENTIC_TRACE_ENABLED: bool = _parse_bool(
    os.getenv("AMINA_AGENTIC_TRACE_ENABLED"), True,
)
AMINA_AGENTIC_FAIL_OPEN: bool = _parse_bool(
    os.getenv("AMINA_AGENTIC_FAIL_OPEN"), True,
)
AMINA_AGENTIC_PROVIDER: str = (os.getenv("AMINA_AGENTIC_PROVIDER") or "auto").strip().lower()

# ── Phase 2: native provider function-calling (DEFAULT OFF) ─────────
#
# When AMINA_AGENTIC_NATIVE_TOOLS=true, the LLM planner attempts to use
# the provider's native tool-calling API (OpenAI / OpenAI-compatible such
# as Groq, or Gemini function declarations) to propose tool calls
# instead of asking for a JSON blob in the message body.
#
# Safety guarantees preserved regardless of the value:
#   - Only tools in V1_ALLOWED_RISKS are ever exposed to the LLM
#     (registry.get_schemas_for_llm already filters writes/admin out).
#   - The deterministic policy gate still runs on every proposed call.
#   - Heuristic planner still runs FIRST and short-circuits on match.
#   - On any native-call exception, the planner falls back to the
#     existing JSON-string LLM path (and then to no-tool fallback).
#   - Setting AMINA_AGENTIC_MODE=off short-circuits everything before
#     this flag is even consulted, so it remains the master kill-switch.
AMINA_AGENTIC_NATIVE_TOOLS: bool = _parse_bool(
    os.getenv("AMINA_AGENTIC_NATIVE_TOOLS"), False,
)
# Optional override for which native format to emit. "auto" sniffs the
# active provider from amina_agent. Explicit values: "openai" (also covers
# Groq / OpenAI-compatible endpoints) or "gemini".
AMINA_AGENTIC_NATIVE_FORMAT: str = (
    os.getenv("AMINA_AGENTIC_NATIVE_FORMAT") or "auto"
).strip().lower()


# ── Hard limits — NOT overridable per request ────────────────────────
PLANNER_HARD_LIMITS = {
    "max_tool_calls_per_turn":              AMINA_AGENTIC_MAX_TOOL_CALLS,
    "max_planning_rounds":                  AMINA_AGENTIC_MAX_PLANNING_ROUNDS,
    "max_repair_attempts":                  1,
    "allow_recursive_tool_calls":           False,
    "allow_tool_calls_after_final_answer":  False,
    "emergency_bypasses_planner":           True,
    "guest_users_can_access_personal_tools": False,
    "planner_timeout_ms":                   3000,
    "tool_timeout_ms":                      5000,
}


def snapshot() -> dict:
    """Return a JSON-serialisable snapshot of the active config (no secrets)."""
    return {
        "mode":                  AMINA_AGENTIC_MODE.value,
        "modes_allowed":         list(AMINA_AGENTIC_MODES_ALLOWED),
        "max_tool_calls":        AMINA_AGENTIC_MAX_TOOL_CALLS,
        "max_planning_rounds":   AMINA_AGENTIC_MAX_PLANNING_ROUNDS,
        "trace_enabled":         AMINA_AGENTIC_TRACE_ENABLED,
        "fail_open":             AMINA_AGENTIC_FAIL_OPEN,
        "provider":              AMINA_AGENTIC_PROVIDER,
        "native_tools":          AMINA_AGENTIC_NATIVE_TOOLS,
        "native_format":         AMINA_AGENTIC_NATIVE_FORMAT,
        "hard_limits":           dict(PLANNER_HARD_LIMITS),
    }
