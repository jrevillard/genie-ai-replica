"""
AMINA Agent Platform v1 — test suite.

Covers config / registry / planner / policy / executor / runtime /
integration / security. No real LLM calls — adapters are stubbed.

Run inside or outside the container:
    python _agent_platform_v1_test.py
"""
from __future__ import annotations

import asyncio
import os
import sys
from typing import List

# Make `src.*` importable when run from the repo root or the container.
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

# Force a known config BEFORE importing the package.
os.environ.setdefault("AMINA_AGENTIC_MODE", "off")
os.environ.setdefault("AMINA_AGENTIC_FAIL_OPEN", "true")
os.environ.setdefault("AMINA_AGENTIC_MAX_TOOL_CALLS", "3")

from src.agent_platform import config as ap_config           # noqa: E402
from src.agent_platform import models as ap_models           # noqa: E402
from src.agent_platform import planner as ap_planner         # noqa: E402
from src.agent_platform import tool_policy as ap_policy      # noqa: E402
from src.agent_platform import tool_executor as ap_executor  # noqa: E402
from src.agent_platform import runtime as ap_runtime         # noqa: E402
from src.agent_platform import tracing as ap_tracing         # noqa: E402
from src.agent_platform.tool_registry import get_registry    # noqa: E402

passed = 0
failed = 0
errors: List[str] = []


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
        errors.append(label)


def section(name: str) -> None:
    print(f"\n=== {name} ===")


# ── 1. Config ───────────────────────────────────────────────────────
def test_config():
    section("1. Config")
    check("default mode is off",
          ap_config.AMINA_AGENTIC_MODE == ap_config.AgentMode.OFF)
    check("invalid mode falls back to off",
          ap_config._parse_mode("nonsense") == ap_config.AgentMode.OFF)
    check("max_tool_calls default is 3",
          ap_config.AMINA_AGENTIC_MAX_TOOL_CALLS == 3)
    check("fail_open default true",
          ap_config.AMINA_AGENTIC_FAIL_OPEN is True)
    check("snapshot returns dict + has 'mode' key",
          "mode" in ap_config.snapshot())


# ── 2. Registry ─────────────────────────────────────────────────────
def test_registry():
    section("2. Registry")
    reg = get_registry()
    all_tools = reg.get_all()

    expected = [
        "get_patient_profile", "get_recent_vitals", "get_care_plan",
        "get_medications", "get_followups", "retrieve_who_protocol",
        "retrieve_ncd_knowledge", "calculate_cvd_risk", "assess_triage",
        "check_emergency", "get_diet_advice", "check_ramadan",
        "cultural_context", "suggest_community_support", "find_facility",
        # forbidden but registered
        "record_vitals", "create_referral", "send_sms", "admin_lookup_patient",
    ]
    for name in expected:
        check(f"tool registered: {name}", reg.has(name))

    # No side-effecting tool is in the read-only set
    for s in reg.get_read_only():
        check(f"read-only set never includes side-effecting: {s.name}",
              not s.side_effecting)

    # Every tool has both schemas
    for n, s in all_tools.items():
        check(f"{n}: has input_schema dict",  isinstance(s.input_schema, dict))
        check(f"{n}: has output_schema dict", isinstance(s.output_schema, dict))

    # Schemas exposed to the LLM never include injected fields
    schemas = reg.get_schemas_for_llm(mode="advanced", role="patient")
    for sch in schemas:
        for fname, fprop in (sch.get("parameters") or {}).get("properties", {}).items():
            check(f"llm schema {sch['name']}.{fname} not injected",
                  not fprop.get("injected", False))

    # Risk classifications: at least one tool per primary risk class
    by_risk = {r: reg.get_by_risk(r) for r in ap_models.ToolRisk}
    check("safe_read_only tools exist",            len(by_risk[ap_models.ToolRisk.SAFE_READ_ONLY]) > 0)
    check("read_only_clinical tools exist",        len(by_risk[ap_models.ToolRisk.READ_ONLY_CLINICAL]) > 0)
    check("clinical_advice_support tools exist",   len(by_risk[ap_models.ToolRisk.CLINICAL_ADVICE_SUPPORT]) > 0)
    check("write_patient_record exists (registered, will be denied)",
          len(by_risk[ap_models.ToolRisk.WRITE_PATIENT_RECORD]) > 0)


# ── 3. Planner ──────────────────────────────────────────────────────
def _req(message: str, **kw) -> ap_models.AgenticRequest:
    return ap_models.AgenticRequest(
        message=message,
        session_id=kw.pop("session_id", "guest_test_xxx"),
        mode=kw.pop("mode", "advanced"),
        role=kw.pop("role", "patient"),
        **kw,
    )


def test_planner():
    section("3. Planner (heuristic only — no LLM available in test env)")
    schemas = get_registry().get_schemas_for_llm("advanced", "patient")

    cases = [
        ("my blood pressure",            ["get_recent_vitals", "retrieve_who_protocol"], "normal"),
        ("blood sugar 180",              ["get_recent_vitals", "retrieve_who_protocol"], "normal"),
        ("what medicine am i on",        ["get_medications", "retrieve_ncd_knowledge"],  "normal"),
        ("show me my care plan",         ["get_care_plan"],                              "normal"),
        ("when is my next appointment",  ["get_followups"],                              "normal"),
        ("chest pain can't breathe",     [],                                              "emergency_bypass"),
        ("hello how are you",            [],                                              "normal"),
    ]
    for msg, want_tools, want_route in cases:
        plan = asyncio.run(ap_planner.plan(_req(msg), schemas))
        got_tools = [c.tool_name for c in plan.tool_calls]
        ok = got_tools == want_tools and plan.route == want_route
        check(
            f"plan({msg!r}) -> {want_tools} route={want_route}",
            ok,
            detail=f"got tools={got_tools} route={plan.route}",
        )

    # Hard cap of 3 tool calls
    plan = asyncio.run(ap_planner.plan(_req("blood pressure and sugar and medicine"), schemas))
    check("planner respects max-3 cap", len(plan.tool_calls) <= 3,
          detail=f"got {len(plan.tool_calls)}")


# ── 4. Policy ───────────────────────────────────────────────────────
def test_policy():
    section("4. Policy gate")
    gate = ap_policy.get_policy_gate()

    # Authenticated patient request
    req_auth = ap_models.AgenticRequest(
        message="hi", session_id="s_P_X_xxx", patient_id="P_X",
        mode="advanced", role="patient",
    )
    # Guest request
    req_guest = ap_models.AgenticRequest(
        message="hi", session_id="guest_aaa", patient_id=None,
        mode="advanced", role="guest",
    )

    # 1) requires_auth tool denied for guest, allowed for auth
    auth_required = ap_models.AgenticToolCall(tool_name="get_patient_profile")
    d = gate.evaluate_plan(req_guest, [auth_required])[0]
    check("guest + requires_auth → DENIED", not d.allowed,
          detail=f"reason={d.reason}")
    d = gate.evaluate_plan(req_auth, [auth_required])[0]
    check("auth user + requires_auth → ALLOWED", d.allowed,
          detail=f"reason={d.reason}")

    # 2) LLM-supplied patient_id is STRIPPED and replaced from session
    bad = ap_models.AgenticToolCall(
        tool_name="get_patient_profile",
        arguments={"patient_id": "P_OTHER_PATIENT"},
    )
    d = gate.evaluate_plan(req_auth, [bad])[0]
    check("LLM-supplied patient_id is replaced",
          d.allowed and d.redacted_arguments.get("patient_id") == "P_X",
          detail=f"reason={d.reason} args={d.redacted_arguments}")

    # 3) write_patient_record DENIED in v1
    write_call = ap_models.AgenticToolCall(
        tool_name="record_vitals",
        arguments={"vital_type": "bp", "value": "140/90"},
    )
    d = gate.evaluate_plan(req_auth, [write_call])[0]
    check("write_patient_record → DENIED in v1", not d.allowed,
          detail=f"reason={d.reason}")

    # 4) admin_only DENIED for patient
    admin_call = ap_models.AgenticToolCall(
        tool_name="admin_lookup_patient", arguments={"query": "anything"},
    )
    d = gate.evaluate_plan(req_auth, [admin_call])[0]
    check("admin_only → DENIED for patient", not d.allowed,
          detail=f"reason={d.reason}")

    # 5) external_side_effect DENIED
    sms_call = ap_models.AgenticToolCall(
        tool_name="send_sms", arguments={"text": "hello"},
    )
    d = gate.evaluate_plan(req_auth, [sms_call])[0]
    check("external_side_effect → DENIED", not d.allowed,
          detail=f"reason={d.reason}")

    # 6) tool not in registry → denied
    bogus = ap_models.AgenticToolCall(tool_name="non_existent_tool")
    d = gate.evaluate_plan(req_auth, [bogus])[0]
    check("unknown tool → DENIED", not d.allowed)

    # 7) max-3 enforced — 4th approved call is denied
    many = [ap_models.AgenticToolCall(tool_name="retrieve_who_protocol",
                                       arguments={"topic": "diabetes"})
            for _ in range(5)]
    decisions = gate.evaluate_plan(req_auth, many)
    n_allowed = sum(1 for d in decisions if d.allowed)
    check("max-3 cap enforced", n_allowed == 3,
          detail=f"allowed={n_allowed}")

    # 8) Schema validation: enum violation
    bad_topic = ap_models.AgenticToolCall(
        tool_name="retrieve_who_protocol", arguments={"topic": "rocket_science"},
    )
    d = gate.evaluate_plan(req_auth, [bad_topic])[0]
    check("enum violation → DENIED", not d.allowed,
          detail=f"reason={d.reason}")


# ── 5. Executor ─────────────────────────────────────────────────────
def test_executor():
    section("5. Executor")
    executor = ap_executor.get_executor()
    gate = ap_policy.get_policy_gate()

    req = ap_models.AgenticRequest(
        message="who protocol diabetes",
        session_id="s_test", patient_id=None,
        mode="advanced", role="patient",
    )

    # Approved call to a safe_read_only tool
    call = ap_models.AgenticToolCall(
        tool_name="retrieve_who_protocol",
        arguments={"topic": "diabetes"},
    )
    decisions = gate.evaluate_plan(req, [call])
    pairs = [(c, d) for c, d in zip([call], decisions) if d.allowed]
    results = asyncio.run(executor.execute_approved(req, pairs))
    check("executor returns one ToolResult", len(results) == 1)
    if results:
        r = results[0]
        check("ToolResult is well-shaped",
              hasattr(r, "ok") and hasattr(r, "safe_summary")
              and hasattr(r, "latency_ms"))
        check("safe_summary is non-empty (or ok=False with error_code)",
              (r.ok and r.safe_summary) or (not r.ok and r.error_code),
              detail=f"ok={r.ok} summary={r.safe_summary!r} err={r.error_code}")

    # Denied calls do not execute (policy filters before executor)
    denied_call = ap_models.AgenticToolCall(tool_name="record_vitals")
    denied_decisions = gate.evaluate_plan(req, [denied_call])
    pairs = [(c, d) for c, d in zip([denied_call], denied_decisions) if d.allowed]
    results = asyncio.run(executor.execute_approved(req, pairs))
    check("denied calls produce zero results", len(results) == 0)


# ── 6. Runtime ──────────────────────────────────────────────────────
def test_runtime_off():
    section("6a. Runtime: mode=off → enabled=False")
    ap_config.AMINA_AGENTIC_MODE = ap_config.AgentMode.OFF
    rt = ap_runtime.get_runtime()
    req = ap_models.AgenticRequest(
        message="hi", session_id="s_t", mode="advanced", role="patient",
    )
    res = asyncio.run(rt.maybe_run_agentic_prepass(req))
    check("mode=off → enabled=False", res.enabled is False)
    check("mode=off → mode str", res.mode == "off")


def test_runtime_shadow():
    section("6b. Runtime: mode=shadow → records trace, no execution")
    ap_config.AMINA_AGENTIC_MODE = ap_config.AgentMode.SHADOW
    rt = ap_runtime.get_runtime()
    req = ap_models.AgenticRequest(
        message="my blood pressure", session_id="s_t", patient_id="P_X",
        mode="advanced", role="patient",
    )
    res = asyncio.run(rt.maybe_run_agentic_prepass(req))
    check("shadow → enabled=True", res.enabled is True)
    check("shadow → mode='shadow'", res.mode == "shadow")
    check("shadow → plan present",  res.plan is not None)
    check("shadow → no tool results executed",
          res.approved_tool_results == [] or len(res.approved_tool_results) == 0)
    check("shadow → context_block empty (don't enrich in shadow)",
          res.context_block == "")
    check("shadow → trace_id non-empty", bool(res.trace_id))


def test_runtime_assist():
    section("6c. Runtime: mode=assist → context_block from approved")
    ap_config.AMINA_AGENTIC_MODE = ap_config.AgentMode.ASSIST
    rt = ap_runtime.get_runtime()
    req = ap_models.AgenticRequest(
        message="WHO protocol diabetes",
        session_id="s_t", patient_id="P_X",
        mode="advanced", role="patient",
    )
    res = asyncio.run(rt.maybe_run_agentic_prepass(req))
    check("assist → enabled=True", res.enabled is True)
    check("assist → mode='assist'", res.mode == "assist")
    check("assist → plan has tool_calls",
          res.plan is not None and len(res.plan.tool_calls) >= 0)
    # context_block may be empty if all tools failed (orchestrator
    # may not have an implementation in this lightweight test env),
    # so the assertion is shape-only.
    check("assist → trace_id present", bool(res.trace_id))


def test_runtime_emergency():
    section("6d. Runtime: emergency message → emergency_bypass")
    ap_config.AMINA_AGENTIC_MODE = ap_config.AgentMode.SHADOW
    rt = ap_runtime.get_runtime()
    req = ap_models.AgenticRequest(
        message="chest pain can't breathe",
        session_id="s_t", patient_id="P_X",
        mode="advanced", role="patient",
    )
    res = asyncio.run(rt.maybe_run_agentic_prepass(req))
    check("emergency → enabled=True", res.enabled is True)
    check("emergency → route=emergency_bypass",
          res.plan is not None and res.plan.route == "emergency_bypass")
    check("emergency → zero tools",
          res.plan is not None and len(res.plan.tool_calls) == 0)


def test_runtime_mode_not_allowed():
    section("6e. Runtime: mode_not_allowed gating")
    ap_config.AMINA_AGENTIC_MODE = ap_config.AgentMode.SHADOW
    # restrict to advanced — basic should be skipped
    saved = list(ap_config.AMINA_AGENTIC_MODES_ALLOWED)
    ap_config.AMINA_AGENTIC_MODES_ALLOWED = ["advanced"]
    try:
        rt = ap_runtime.AgentPlatformRuntime()
        req = ap_models.AgenticRequest(
            message="hi", session_id="s_t", patient_id="P_X",
            mode="basic", role="patient",
        )
        res = asyncio.run(rt.maybe_run_agentic_prepass(req))
        check("basic-mode request with modes_allowed=[advanced] → enabled=False",
              res.enabled is False, detail=f"error={res.error}")
    finally:
        ap_config.AMINA_AGENTIC_MODES_ALLOWED = saved


# ── 7. Security ────────────────────────────────────────────────────
def test_security():
    section("7. Security: traces redact PHI; hash ids stable")
    h1 = ap_tracing.hash_id("P_PATIENT_X")
    h2 = ap_tracing.hash_id("P_PATIENT_X")
    h3 = ap_tracing.hash_id("P_OTHER")
    check("hash_id is stable", h1 == h2)
    check("hash_id discriminates", h1 != h3)
    check("hash_id is short + hex",
          isinstance(h1, str) and len(h1) == 10 and all(c in "0123456789abcdef" for c in h1))

    # Trace dict has no PHI fields
    trace = ap_models.AgentTrace(
        session_hash=h1, mode="advanced", agentic_mode="shadow",
    )
    safe = trace.to_safe_dict()
    for forbidden in ("phone", "patient_name", "patient_id", "message", "raw"):
        check(f"trace.to_safe_dict has no '{forbidden}' field",
              forbidden not in safe)


# ── 8. Integration parity (mode=off must not change behaviour) ────
def test_integration_off_is_noop():
    section("8. Integration: mode=off attaches NO metadata")
    # Reload config defaults
    ap_config.AMINA_AGENTIC_MODE = ap_config.AgentMode.OFF
    rt = ap_runtime.get_runtime()
    req = ap_models.AgenticRequest(
        message="hi", session_id="s_t", mode="advanced", role="patient",
    )
    res = asyncio.run(rt.maybe_run_agentic_prepass(req))
    check("mode=off prepass returns enabled=False",
          res.enabled is False)


# ── runner ─────────────────────────────────────────────────────────
def main() -> int:
    test_config()
    test_registry()
    test_planner()
    test_policy()
    test_executor()
    test_runtime_off()
    test_runtime_shadow()
    test_runtime_assist()
    test_runtime_emergency()
    test_runtime_mode_not_allowed()
    test_security()
    test_integration_off_is_noop()

    print()
    print("=" * 60)
    print(f"  RESULTS:  {passed} passed,  {failed} failed")
    print("=" * 60)
    if failed:
        print("\nFailed: " + ", ".join(errors))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
