"""
AMINA Agent Platform Phase 3 — production-readiness snapshot.

Pure helper. Reads current env-driven config and the registry, returns
a JSON-friendly dict + a list of warnings for risky configs. No I/O,
no provider calls, no secrets.

Use cases:
  - One-shot CLI before promoting a flag (`scripts/agent_platform_readiness.py`).
  - Health endpoint or boot log.
  - Tests asserting "default install is safe".
"""
from __future__ import annotations

from typing import Dict, List

from src.agent_platform import config as _ap_config
from src.agent_platform.models import V1_ALLOWED_RISKS, ToolRisk
from src.agent_platform.tool_registry import get_registry


# Stable warning codes — operators can grep for these without parsing
# human-readable English. Keep the codes short and uppercase.
WARNING_CODES = {
    "NATIVE_ON_TRACE_OFF":           "AMINA_AGENTIC_NATIVE_TOOLS=true while AMINA_AGENTIC_TRACE_ENABLED=false — native calls won't be auditable.",
    "ASSIST_ALL_MODES_NO_SHADOW":    "AMINA_AGENTIC_MODE=assist with modes_allowed covering basic+beginner. Recommend a shadow run on advanced first.",
    "NATIVE_AUTO_IN_PROD":           "AMINA_AGENTIC_NATIVE_FORMAT=auto. In production, set explicitly to 'openai' or 'gemini' so a vendored client can't silently disable native tools.",
    "NATIVE_FORMAT_UNKNOWN":         "AMINA_AGENTIC_NATIVE_FORMAT is set but not 'auto' / 'openai' / 'gemini'. Native tools will be NATIVE_UNSUPPORTED for every request.",
    "FAIL_OPEN_OFF":                 "AMINA_AGENTIC_FAIL_OPEN=false. Any runtime error will be surfaced to the user instead of falling through to the original AminaAgent.",
    "STRICT_MODE_PLACEHOLDER":       "AMINA_AGENTIC_MODE=strict. v1 treats this as 'assist' with NO writes; safe but the label can mislead operators.",
    "MAX_TOOL_CALLS_HIGH":           "AMINA_AGENTIC_MAX_TOOL_CALLS exceeds 5. Higher caps multiply LLM cost, latency, and PHI exposure surface.",
    "NO_READONLY_TOOLS":             "Registry exposes zero V1_ALLOWED_RISKS tools — the agentic prepass will never produce a useful plan.",
    "WRITE_TOOLS_REGISTERED":        "Registered write/admin tools are present in the registry. They are denied by policy in v1; flagged here only as a reminder for Phase 5 confirmation-gated rollouts.",
}


def snapshot() -> Dict:
    """
    Build the readiness snapshot. Pure function; reads only env-derived
    config + the static registry. No PHI, no secrets, no API calls.
    """
    reg = get_registry()
    all_tools = reg.get_all()
    readonly = reg.get_read_only()
    write_like = [
        s for s in all_tools.values()
        if s.risk not in V1_ALLOWED_RISKS
    ]

    fmt = (_ap_config.AMINA_AGENTIC_NATIVE_FORMAT or "").strip().lower()
    is_known_fmt = fmt in ("auto", "openai", "gemini", "")

    snap = {
        "config": {
            "AMINA_AGENTIC_MODE":           _ap_config.AMINA_AGENTIC_MODE.value,
            "AMINA_AGENTIC_MODES_ALLOWED":  list(_ap_config.AMINA_AGENTIC_MODES_ALLOWED),
            "AMINA_AGENTIC_MAX_TOOL_CALLS": _ap_config.AMINA_AGENTIC_MAX_TOOL_CALLS,
            "AMINA_AGENTIC_TRACE_ENABLED":  _ap_config.AMINA_AGENTIC_TRACE_ENABLED,
            "AMINA_AGENTIC_FAIL_OPEN":      _ap_config.AMINA_AGENTIC_FAIL_OPEN,
            "AMINA_AGENTIC_PROVIDER":       _ap_config.AMINA_AGENTIC_PROVIDER,
            "AMINA_AGENTIC_NATIVE_TOOLS":   _ap_config.AMINA_AGENTIC_NATIVE_TOOLS,
            "AMINA_AGENTIC_NATIVE_FORMAT":  fmt or "auto",
        },
        "registry": {
            "total_tools":         len(all_tools),
            "read_only_tools":     len(readonly),
            "denied_tools":        len(write_like),
            "read_only_names":     sorted(s.name for s in readonly),
            "denied_names":        sorted(s.name for s in write_like),
        },
        "native": {
            "format_resolved":     fmt or "auto",
            "format_recognised":   is_known_fmt,
            "openai_supported":    True,   # always true in this build
            "gemini_supported":    True,   # best-effort per Phase 2 doc
        },
        "policy_gate_version":     "v1.13",
        "warnings": _warnings(),
        "ok":                       True,  # toggled below
    }
    snap["ok"] = not any(w["severity"] == "error" for w in snap["warnings"])
    return snap


def _warnings() -> List[Dict]:
    """
    Emit a list of warnings keyed by stable code so callers can filter
    or assert on them. Each entry has:
        {"code": str, "severity": "info"|"warn"|"error", "message": str}
    Severity is purely advisory; no warning short-circuits anything.
    """
    out: List[Dict] = []
    cfg = _ap_config

    fmt = (cfg.AMINA_AGENTIC_NATIVE_FORMAT or "").strip().lower()
    fmt_recognised = fmt in ("", "auto", "openai", "gemini")

    if cfg.AMINA_AGENTIC_NATIVE_TOOLS and not cfg.AMINA_AGENTIC_TRACE_ENABLED:
        out.append({
            "code":     "NATIVE_ON_TRACE_OFF",
            "severity": "error",
            "message":  WARNING_CODES["NATIVE_ON_TRACE_OFF"],
        })
    if cfg.AMINA_AGENTIC_NATIVE_TOOLS and fmt in ("", "auto"):
        out.append({
            "code":     "NATIVE_AUTO_IN_PROD",
            "severity": "warn",
            "message":  WARNING_CODES["NATIVE_AUTO_IN_PROD"],
        })
    if cfg.AMINA_AGENTIC_NATIVE_TOOLS and not fmt_recognised:
        out.append({
            "code":     "NATIVE_FORMAT_UNKNOWN",
            "severity": "error",
            "message":  WARNING_CODES["NATIVE_FORMAT_UNKNOWN"],
        })
    # Assist on every UI mode is allowed — but only after a shadow run.
    # We can't observe whether a shadow was run, so we warn by config.
    modes = set(m.lower() for m in cfg.AMINA_AGENTIC_MODES_ALLOWED)
    expansive = modes >= {"advanced", "basic", "beginner"}
    is_assist = cfg.AMINA_AGENTIC_MODE.value == "assist"
    if is_assist and expansive:
        out.append({
            "code":     "ASSIST_ALL_MODES_NO_SHADOW",
            "severity": "warn",
            "message":  WARNING_CODES["ASSIST_ALL_MODES_NO_SHADOW"],
        })
    if not cfg.AMINA_AGENTIC_FAIL_OPEN:
        out.append({
            "code":     "FAIL_OPEN_OFF",
            "severity": "warn",
            "message":  WARNING_CODES["FAIL_OPEN_OFF"],
        })
    if cfg.AMINA_AGENTIC_MODE.value == "strict":
        out.append({
            "code":     "STRICT_MODE_PLACEHOLDER",
            "severity": "info",
            "message":  WARNING_CODES["STRICT_MODE_PLACEHOLDER"],
        })
    if cfg.AMINA_AGENTIC_MAX_TOOL_CALLS > 5:
        out.append({
            "code":     "MAX_TOOL_CALLS_HIGH",
            "severity": "warn",
            "message":  WARNING_CODES["MAX_TOOL_CALLS_HIGH"],
        })

    reg = get_registry()
    if not reg.get_read_only():
        out.append({
            "code":     "NO_READONLY_TOOLS",
            "severity": "error",
            "message":  WARNING_CODES["NO_READONLY_TOOLS"],
        })
    write_like = [
        s for s in reg.get_all().values()
        if s.risk not in V1_ALLOWED_RISKS
    ]
    if write_like:
        out.append({
            "code":     "WRITE_TOOLS_REGISTERED",
            "severity": "info",
            "message":  WARNING_CODES["WRITE_TOOLS_REGISTERED"],
        })

    return out


__all__ = ["snapshot", "WARNING_CODES"]
