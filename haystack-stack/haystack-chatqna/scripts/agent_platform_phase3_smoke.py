#!/usr/bin/env python3
"""
AMINA Agent Platform Phase 3 — local smoke harness.

Imports the in-process agent_platform runtime (no live HTTP needed)
and exercises every meaningful flag combination against a synthetic
patient. Designed for staging validation BEFORE flipping a flag in
prod.

What it covers:
  - off mode      → enabled=False
  - shadow mode   → enabled=True, no executions
  - assist mode   → enabled=True, may execute approved read-only tools
  - native tools disabled → planner uses heuristic / JSON-string LLM
  - native tools enabled  → planner attempts native, falls back if
    no compatible client (which is normal in this synthetic harness)
  - explicit AMINA_AGENTIC_NATIVE_FORMAT=openai
  - PHI redaction proof: prepass result has no patient_name/phone/etc.

NO real PHI is used. NO live LLM is called. Synthetic ids only.

Usage:
    python scripts/agent_platform_phase3_smoke.py
    python scripts/agent_platform_phase3_smoke.py --json
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys

_HERE   = os.path.dirname(os.path.abspath(__file__))
_PARENT = os.path.dirname(_HERE)
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)

# Force-known config BEFORE imports.
os.environ.setdefault("AMINA_AGENTIC_FAIL_OPEN", "true")
os.environ.setdefault("AMINA_AGENTIC_TRACE_ENABLED", "true")
os.environ.setdefault("AMINA_AGENTIC_MAX_TOOL_CALLS", "3")

from src.agent_platform import config as ap_config              # noqa: E402
from src.agent_platform import models as ap_models              # noqa: E402
from src.agent_platform import readiness as ap_readiness        # noqa: E402
from src.agent_platform import runtime as ap_runtime            # noqa: E402

passed = 0
failed = 0
events = []


def emit(ev: dict):
    """Append a structured event for JSON mode."""
    events.append(ev)


def check(label: str, ok: bool, detail: str = "") -> None:
    global passed, failed
    if ok:
        passed += 1
        print(f"  [PASS] {label}")
    else:
        failed += 1
        msg = f"  [FAIL] {label}"
        if detail:
            msg += f" -- {detail}"
        print(msg)
    emit({"check": label, "ok": ok, "detail": detail})


def section(name: str) -> None:
    print(f"\n=== {name} ===")
    emit({"section": name})


def _synthetic_request(message="my BP was 145/95 last week"):
    """Synthetic-only patient. Names/IDs are obviously fake."""
    return ap_models.AgenticRequest(
        message=message,
        session_id="smoke-session-synthetic-001",
        patient_id="smoke-patient-synthetic-001",
        patient_name="SMOKE_TEST_NOT_REAL",
        phone="+000-555-SMOKE",
        role="patient",
        mode="advanced",
        channel="smoke-cli",
    )


def _set(mode=None, native=None, fmt=None):
    """Override config attrs in-place. Returns the previous values."""
    backup = {
        "AMINA_AGENTIC_MODE":          ap_config.AMINA_AGENTIC_MODE,
        "AMINA_AGENTIC_NATIVE_TOOLS":  ap_config.AMINA_AGENTIC_NATIVE_TOOLS,
        "AMINA_AGENTIC_NATIVE_FORMAT": ap_config.AMINA_AGENTIC_NATIVE_FORMAT,
    }
    if mode is not None:
        ap_config.AMINA_AGENTIC_MODE = mode
    if native is not None:
        ap_config.AMINA_AGENTIC_NATIVE_TOOLS = native
    if fmt is not None:
        ap_config.AMINA_AGENTIC_NATIVE_FORMAT = fmt
    return backup


def _restore(backup):
    for k, v in backup.items():
        setattr(ap_config, k, v)


def _run(req):
    """Run prepass and surface the parts useful to operators."""
    return asyncio.run(ap_runtime.get_runtime().maybe_run_agentic_prepass(req))


def _summarise(label: str, result) -> dict:
    """Operator-friendly summary of a prepass result."""
    summary = {
        "label":              label,
        "enabled":            result.enabled,
        "mode":               result.mode,
        "trace_id":           result.trace_id or None,
        "plan_intent":        getattr(result.plan, "intent", None) if result.plan else None,
        "plan_reason":        getattr(result.plan, "reason", None) if result.plan else None,
        "tool_calls_proposed":
            len(result.plan.tool_calls) if result.plan else 0,
        "tool_results_executed": len(result.approved_tool_results),
        "denied_count":       len(result.denied_tool_calls),
        "context_block_present": bool(result.context_block),
        "error":              result.error,
    }
    print(f"  ↳ {label}: " + json.dumps(summary, default=str))
    emit({"summary": summary})
    return summary


# ── Cases ──────────────────────────────────────────────────────────
def case_off():
    section("Case 1: AMINA_AGENTIC_MODE=off")
    bk = _set(mode=ap_config.AgentMode.OFF)
    try:
        r = _run(_synthetic_request())
        s = _summarise("off", r)
        check("off → enabled=False", r.enabled is False)
        check("off → no plan",        r.plan is None)
        check("off → no tools executed", s["tool_results_executed"] == 0)
    finally:
        _restore(bk)


def case_shadow():
    section("Case 2: AMINA_AGENTIC_MODE=shadow (planner+policy run, no execution)")
    bk = _set(mode=ap_config.AgentMode.SHADOW)
    try:
        r = _run(_synthetic_request("my BP was 145/95 last week"))
        s = _summarise("shadow", r)
        check("shadow → enabled=True", r.enabled is True)
        check("shadow → executed nothing", s["tool_results_executed"] == 0)
        check("shadow → trace_id present", bool(r.trace_id))
        check("shadow → plan exists", r.plan is not None)
        check("shadow → no PHI on result obj",
              not hasattr(r, "patient_name") and not hasattr(r, "phone"))
    finally:
        _restore(bk)


def case_assist_native_off():
    section("Case 3: AMINA_AGENTIC_MODE=assist, AMINA_AGENTIC_NATIVE_TOOLS=false")
    bk = _set(mode=ap_config.AgentMode.ASSIST, native=False)
    try:
        r = _run(_synthetic_request("my BP was 145/95 last week"))
        s = _summarise("assist+native_off", r)
        check("assist → enabled=True", r.enabled is True)
        check("assist → trace_id present", bool(r.trace_id))
        check("assist → no PHI on result obj",
              not hasattr(r, "patient_name") and not hasattr(r, "phone"))
        # If any tool executed, summary must NOT contain raw PHI
        if r.context_block:
            for forbidden in ("SMOKE_TEST_NOT_REAL", "+000-555-SMOKE"):
                check(f"context_block free of {forbidden!r}",
                      forbidden not in r.context_block)
    finally:
        _restore(bk)


def case_assist_native_on():
    section("Case 4: AMINA_AGENTIC_MODE=assist, AMINA_AGENTIC_NATIVE_TOOLS=true")
    bk = _set(mode=ap_config.AgentMode.ASSIST, native=True)
    try:
        r = _run(_synthetic_request("my BP was 145/95 last week"))
        s = _summarise("assist+native_on", r)
        check("assist+native → enabled=True", r.enabled is True)
        # In-process harness: no real LLM client, so heuristic wins or
        # native attempt falls through. Either is correct + safe.
        check("assist+native → no PHI on result obj",
              not hasattr(r, "patient_name") and not hasattr(r, "phone"))
    finally:
        _restore(bk)


def case_explicit_native_format_openai():
    section("Case 5: AMINA_AGENTIC_NATIVE_FORMAT=openai (explicit)")
    bk = _set(mode=ap_config.AgentMode.ASSIST, native=True, fmt="openai")
    try:
        r = _run(_synthetic_request("what does WHO say about hypertension"))
        s = _summarise("native_format=openai", r)
        check("explicit openai format → still enabled", r.enabled is True)
        check("explicit openai format → trace_id present", bool(r.trace_id))
    finally:
        _restore(bk)


def case_explicit_native_format_unknown():
    section("Case 6: AMINA_AGENTIC_NATIVE_FORMAT=anthropic (unsupported in build)")
    bk = _set(mode=ap_config.AgentMode.ASSIST, native=True, fmt="anthropic")
    try:
        r = _run(_synthetic_request("any greeting"))
        s = _summarise("native_format=anthropic", r)
        check("unknown format → planner falls back, still enabled",
              r.enabled is True)
        check("unknown format → no PHI on result obj",
              not hasattr(r, "patient_name"))
    finally:
        _restore(bk)


def case_emergency_bypass():
    section("Case 7: emergency keyword still bypasses agentic layer")
    bk = _set(mode=ap_config.AgentMode.ASSIST, native=True)
    try:
        r = _run(_synthetic_request("I'm having severe chest pain"))
        s = _summarise("emergency_assist", r)
        # Emergency route: plan exists but tool_calls == 0
        check("emergency → plan exists", r.plan is not None)
        if r.plan:
            check("emergency → zero tool calls",
                  len(r.plan.tool_calls) == 0)
            check("emergency → route is emergency_bypass",
                  r.plan.route == "emergency_bypass")
    finally:
        _restore(bk)


def case_readiness_snapshot():
    section("Case 8: readiness snapshot at smoke-time is safe")
    snap = ap_readiness.snapshot()
    print("  ↳ readiness ok:", snap["ok"], "warnings:", len(snap["warnings"]))
    emit({"readiness_ok": snap["ok"], "warning_count": len(snap["warnings"])})
    check("readiness 'config' section present",
          isinstance(snap.get("config"), dict))
    check("readiness 'registry' has read-only tools",
          snap.get("registry", {}).get("read_only_tools", 0) > 0)
    check("policy_gate_version exposed",
          isinstance(snap.get("policy_gate_version"), str))


# ── Main ───────────────────────────────────────────────────────────
def main():
    p = argparse.ArgumentParser(
        description="AMINA Agent Platform Phase 3 smoke harness")
    p.add_argument("--json", action="store_true",
                   help="Emit JSON of all events at the end (for CI parsers)")
    args = p.parse_args()

    print("AMINA Agent Platform Phase 3 — smoke harness")
    print("=" * 64)

    case_off()
    case_shadow()
    case_assist_native_off()
    case_assist_native_on()
    case_explicit_native_format_openai()
    case_explicit_native_format_unknown()
    case_emergency_bypass()
    case_readiness_snapshot()

    print("\n" + "=" * 64)
    print(f"PASSED: {passed}    FAILED: {failed}")

    if args.json:
        print("\n--- JSON EVENTS ---")
        json.dump(events, sys.stdout, indent=2, default=str)
        sys.stdout.write("\n")

    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
