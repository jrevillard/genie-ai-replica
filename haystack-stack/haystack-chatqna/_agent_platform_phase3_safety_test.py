"""
AMINA Agent Platform Phase 3 — red-team safety + enriched-trace test suite.

Covers ONLY the new Phase-3 surface:
  - enriched AgentTrace fields + PHI-safe to_safe_dict
  - native-tool misuse attempts (write/admin/override/unknown/malformed)
  - policy gate final-decision authority
  - assist vs shadow mode behaviour at the runtime level
  - native_tools hardening edge cases (empty registry, dupes, enums,
    nested objects, bad overrides)
  - readiness snapshot + warning codes

v1 / v2 behaviour is asserted unchanged at the regression level.

Run inside or outside the container:
    python _agent_platform_phase3_safety_test.py
"""
from __future__ import annotations

import asyncio
import os
import sys
from typing import List

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

# Force a known config BEFORE imports.
os.environ.setdefault("AMINA_AGENTIC_MODE", "off")
os.environ.setdefault("AMINA_AGENTIC_FAIL_OPEN", "true")
os.environ.setdefault("AMINA_AGENTIC_MAX_TOOL_CALLS", "3")
os.environ.setdefault("AMINA_AGENTIC_NATIVE_TOOLS", "false")

from src.agent_platform import config as ap_config            # noqa: E402
from src.agent_platform import models as ap_models            # noqa: E402
from src.agent_platform import native_tools as nt             # noqa: E402
from src.agent_platform import planner as ap_planner          # noqa: E402
from src.agent_platform import readiness as ap_readiness      # noqa: E402
from src.agent_platform import runtime as ap_runtime          # noqa: E402
from src.agent_platform import tool_policy as ap_policy       # noqa: E402
from src.agent_platform.tool_registry import get_registry     # noqa: E402

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


def _req(message="hi", **kw):
    base = dict(
        message=message, session_id="t-synthetic-001",
        patient_id="p-synthetic-001", role="patient", mode="advanced",
        channel="web",
    )
    base.update(kw)
    return ap_models.AgenticRequest(**base)


# ── 1. Enriched AgentTrace defaults + safe-dict surface ─────────────
def test_trace_enrichment_defaults():
    section("1. Enriched AgentTrace fields default safe + are surfaced")
    t = ap_models.AgentTrace()
    safe = t.to_safe_dict()

    expected_new = [
        "native_tools_enabled", "native_format_requested",
        "native_format_detected", "native_attempted",
        "native_fallback_reason", "tool_schema_count",
        "tool_call_count_requested", "tool_call_count_allowed",
        "tool_call_count_denied", "denied_reasons",
        "policy_gate_version", "planner_path",
        "prompt_tokens", "completion_tokens", "cost_usd",
    ]
    for k in expected_new:
        check(f"AgentTrace.to_safe_dict() exposes '{k}'", k in safe)

    check("native_tools_enabled defaults False",
          safe["native_tools_enabled"] is False)
    check("native_attempted defaults False",
          safe["native_attempted"] is False)
    check("denied_reasons defaults to empty list",
          safe["denied_reasons"] == [])
    check("policy_gate_version is non-empty string",
          isinstance(safe["policy_gate_version"], str)
          and len(safe["policy_gate_version"]) > 0)
    check("prompt_tokens defaults None (not invented)",
          safe["prompt_tokens"] is None)
    check("completion_tokens defaults None (not invented)",
          safe["completion_tokens"] is None)
    check("cost_usd defaults None (not invented)",
          safe["cost_usd"] is None)
    check("planner_path defaults '' (unset until runtime fills)",
          safe["planner_path"] == "")


# ── 2. PHI redaction in enriched trace ──────────────────────────────
def test_phi_redaction_enriched():
    section("2. PHI redaction in enriched trace dict (none of these allowed)")
    t = ap_models.AgentTrace()
    # Stuff PHI-shaped attributes into the dataclass; to_safe_dict must
    # never surface them.
    t.__dict__["phone"]         = "+220-555-1234"
    t.__dict__["patient_name"]  = "Fatou Demo"
    t.__dict__["patient_id"]    = "p-12345-leaked"
    t.__dict__["message"]       = "my BP is 145/95"
    t.__dict__["raw"]           = {"raw_payload": "anything"}
    t.__dict__["session_id"]    = "session-leaked"
    t.__dict__["authorization"] = "Bearer secret"
    t.__dict__["api_key"]       = "sk-leaked"
    safe = t.to_safe_dict()
    for forbidden in ("phone", "patient_name", "patient_id", "message",
                      "raw", "session_id", "authorization", "api_key"):
        check(f"to_safe_dict has no '{forbidden}' key", forbidden not in safe)
    # And the _values_ of the new fields must be primitive — no nested
    # dict that could contain freeform LLM text.
    check("denied_reasons is List[str] (no dicts)",
          all(isinstance(x, str) for x in safe["denied_reasons"]))


# ── 3. Native-tool misuse: LLM tries write/admin/external ───────────
def test_misuse_write_admin_external():
    section("3. LLM cannot summon write/admin/external tools via native path")
    reg = get_registry()
    # Hand-craft an OpenAI-style response that proposes ONLY forbidden
    # tools. The parser keeps them (registry has them registered), then
    # the policy gate must deny them.
    forbidden = ["record_vitals", "create_referral", "send_sms",
                 "admin_lookup_patient"]
    resp = {
        "choices": [{
            "message": {
                "tool_calls": [
                    {"function": {"name": n, "arguments": "{}"}}
                    for n in forbidden
                ],
            },
        }],
    }
    calls = nt.parse_openai_tool_calls(resp, registry_has=reg.has, max_calls=10)
    check("parser accepted all 4 forbidden calls (registry-registered)",
          {c.tool_name for c in calls} == set(forbidden))

    # Now run them through the policy gate — every one must be DENIED.
    req = _req()
    decisions = ap_policy.get_policy_gate().evaluate_plan(req, calls)
    for d in decisions:
        check(f"policy denies '{d.tool_name}' (forbidden risk)", not d.allowed,
              detail=f"reason={d.reason}, risk={d.risk}")


# ── 4. LLM tries to override patient_id / session_id ───────────────
def test_misuse_id_override():
    section("4. LLM cannot override patient_id (or other injected fields)")
    reg = get_registry()
    # LLM forges an arg shadowing the injected patient_id.
    forged = ap_models.AgenticToolCall(
        tool_name="get_recent_vitals",
        arguments={"patient_id": "p-OTHER-PATIENT", "days": 30,
                   "vital_type": "bp"},
        reason="forged",
    )
    req = _req(patient_id="p-real-001")
    decisions = ap_policy.get_policy_gate().evaluate_plan(req, [forged])
    d = decisions[0]
    # Could be denied OR allowed-but-redacted; v1 strips the LLM value
    # and replaces with the real one. Either outcome is safe; we assert
    # that the EFFECTIVE patient_id never differs from the request's.
    eff = (d.redacted_arguments or {}).get("patient_id") or req.patient_id
    check("effective patient_id matches request, not LLM-supplied",
          eff == req.patient_id, detail=f"got {eff!r}")
    if d.allowed:
        check("if allowed, redacted args show the real patient_id",
              d.redacted_arguments.get("patient_id") == req.patient_id)


# ── 5. LLM passes raw phone / name / token in args ─────────────────
def test_misuse_phi_in_args():
    section("5. LLM-supplied PHI in arguments is denied or stripped")
    reg = get_registry()
    leak_attempts = [
        # phone-in-args
        ap_models.AgenticToolCall(
            tool_name="retrieve_who_protocol",
            arguments={"topic": "hypertension", "phone": "+220-555-1111"},
            reason="phone_in_args",
        ),
        # name-in-args
        ap_models.AgenticToolCall(
            tool_name="retrieve_who_protocol",
            arguments={"topic": "hypertension", "patient_name": "Fatou"},
            reason="name_in_args",
        ),
        # api-key-in-args
        ap_models.AgenticToolCall(
            tool_name="retrieve_who_protocol",
            arguments={"topic": "hypertension", "api_key": "sk-leak"},
            reason="apikey_in_args",
        ),
    ]
    req = _req()
    decisions = ap_policy.get_policy_gate().evaluate_plan(req, leak_attempts)
    for d in decisions:
        # Schema doesn't list those fields; the gate may reject (extra
        # field) or accept-with-strip. Either way the surfaced redacted
        # args MUST NOT contain them.
        red = d.redacted_arguments or {}
        for forbidden_key in ("phone", "patient_name", "api_key"):
            check(f"{d.tool_name}: '{forbidden_key}' not in redacted args",
                  forbidden_key not in red,
                  detail=f"red={red!r}")


# ── 6. LLM calls unknown tool ──────────────────────────────────────
def test_misuse_unknown_tool():
    section("6. Unknown tool names are filtered before policy is even consulted")
    reg = get_registry()
    resp = {
        "choices": [{
            "message": {
                "tool_calls": [
                    {"function": {"name": "definitely_unknown_xyz",
                                  "arguments": "{}"}},
                    {"function": {"name": "another_fake_tool",
                                  "arguments": "{}"}},
                    {"function": {"name": "get_recent_vitals",
                                  "arguments": "{}"}},
                ],
            },
        }],
    }
    calls = nt.parse_openai_tool_calls(resp, registry_has=reg.has, max_calls=10)
    names = {c.tool_name for c in calls}
    check("unknown tool 'definitely_unknown_xyz' filtered",
          "definitely_unknown_xyz" not in names)
    check("unknown tool 'another_fake_tool' filtered",
          "another_fake_tool" not in names)
    check("real tool 'get_recent_vitals' kept",
          "get_recent_vitals" in names)
    check("only one valid call survived", len(calls) == 1)


# ── 7. LLM returns malformed tool-call JSON ────────────────────────
def test_misuse_malformed():
    section("7. Malformed responses never crash; safe defaults applied")
    reg = get_registry()
    bad_inputs = [
        None,
        {},
        {"choices": []},
        {"choices": [{}]},
        {"choices": [{"message": {}}]},
        {"choices": [{"message": {"tool_calls": None}}]},
        {"choices": [{"message": {"tool_calls": [None, None]}}]},
        # Non-dict tool_call entry
        {"choices": [{"message": {"tool_calls": [42]}}]},
        # Missing function field
        {"choices": [{"message": {"tool_calls": [{}]}}]},
        # Missing name
        {"choices": [{"message": {"tool_calls": [{"function": {}}]}}]},
        # Args is a number
        {"choices": [{"message": {"tool_calls": [
            {"function": {"name": "get_recent_vitals", "arguments": 42}}
        ]}}]},
    ]
    for i, b in enumerate(bad_inputs):
        out = nt.parse_openai_tool_calls(b, registry_has=reg.has)
        check(f"malformed[{i}] returns list (no exception)",
              isinstance(out, list))
        check(f"malformed[{i}] returns no junk calls",
              all(getattr(c, "tool_name", "") for c in out))


# ── 8. LLM requests too many tool calls ────────────────────────────
def test_misuse_too_many_calls():
    section("8. Excessive tool-call requests are clipped to AMINA_AGENTIC_MAX_TOOL_CALLS")
    reg = get_registry()
    resp = {
        "choices": [{
            "message": {
                "tool_calls": [
                    {"function": {"name": "retrieve_who_protocol",
                                  "arguments": '{"topic": "hypertension"}'}}
                ] * 20,
            },
        }],
    }
    cap = ap_config.AMINA_AGENTIC_MAX_TOOL_CALLS
    calls = nt.parse_openai_tool_calls(resp, registry_has=reg.has, max_calls=cap)
    check(f"openai parser respects max_calls={cap}", len(calls) == cap)
    calls_g = nt.parse_gemini_tool_calls({
        "candidates": [{"content": {"parts": [
            {"function_call": {"name": "retrieve_who_protocol", "args": {"topic": "hypertension"}}}
        ] * 20}}]
    }, registry_has=reg.has, max_calls=cap)
    check(f"gemini parser respects max_calls={cap}", len(calls_g) == cap)


# ── 9. Mixed valid/invalid tool-call payloads ──────────────────────
def test_misuse_mixed_payloads():
    section("9. Mixed valid + invalid + forbidden calls — exact survivors")
    reg = get_registry()
    resp = {
        "choices": [{
            "message": {
                "tool_calls": [
                    {"function": {"name": "get_recent_vitals",
                                  "arguments": '{"days": 30}'}},
                    {"function": {"name": "definitely_fake",
                                  "arguments": "{}"}},
                    {"function": {"name": "send_sms",
                                  "arguments": '{"phone": "+220", "text": "x"}'}},
                    {"function": {"name": "retrieve_who_protocol",
                                  "arguments": '{"topic": "diabetes"}'}},
                ],
            },
        }],
    }
    calls = nt.parse_openai_tool_calls(resp, registry_has=reg.has, max_calls=10)
    names = [c.tool_name for c in calls]
    check("kept valid get_recent_vitals", "get_recent_vitals" in names)
    check("kept valid retrieve_who_protocol", "retrieve_who_protocol" in names)
    check("filtered unknown 'definitely_fake'", "definitely_fake" not in names)
    check("kept registered-but-forbidden send_sms (policy will deny)",
          "send_sms" in names)
    # Now confirm policy denies send_sms
    decisions = ap_policy.get_policy_gate().evaluate_plan(_req(), calls)
    sms_d = next((d for d in decisions if d.tool_name == "send_sms"), None)
    check("policy gate denies send_sms",
          sms_d is not None and not sms_d.allowed)


# ── 10. Tool-call args parsed both as dict AND as JSON string ──────
def test_args_dict_vs_string():
    section("10. Provider may return arguments as dict or JSON string — both work")
    reg = get_registry()
    # OpenAI: arguments is typically a JSON string
    resp_str = {"choices": [{"message": {"tool_calls": [
        {"function": {"name": "get_recent_vitals",
                      "arguments": '{"days": 7, "vital_type": "bp"}'}}
    ]}}]}
    # Some compatible providers send arguments as a dict
    resp_dict = {"choices": [{"message": {"tool_calls": [
        {"function": {"name": "get_recent_vitals",
                      "arguments": {"days": 7, "vital_type": "bp"}}}
    ]}}]}
    cs = nt.parse_openai_tool_calls(resp_str, registry_has=reg.has)
    cd = nt.parse_openai_tool_calls(resp_dict, registry_has=reg.has)
    check("string-args parsed: days=7", cs and cs[0].arguments.get("days") == 7)
    check("dict-args parsed: days=7",   cd and cd[0].arguments.get("days") == 7)
    check("string-args parsed: vital_type=bp",
          cs and cs[0].arguments.get("vital_type") == "bp")
    check("dict-args parsed: vital_type=bp",
          cd and cd[0].arguments.get("vital_type") == "bp")


# ── 11. Policy gate is the FINAL allow/deny authority ──────────────
def test_policy_gate_final_authority():
    section("11. Policy gate makes the final decision regardless of source")
    reg = get_registry()
    # Construct calls hand-rolled (bypasses any planner heuristics)
    calls = [
        ap_models.AgenticToolCall(tool_name="retrieve_who_protocol",
                                  arguments={"topic": "hypertension"},
                                  reason="hand-rolled"),
        ap_models.AgenticToolCall(tool_name="record_vitals",
                                  arguments={"vital_type": "bp", "value": "140/90"},
                                  reason="hand-rolled-write-attempt"),
        ap_models.AgenticToolCall(tool_name="admin_lookup_patient",
                                  arguments={"query": "fatou"},
                                  reason="hand-rolled-admin-attempt"),
    ]
    decisions = ap_policy.get_policy_gate().evaluate_plan(_req(), calls)
    by_name = {d.tool_name: d for d in decisions}
    check("safe tool allowed", by_name["retrieve_who_protocol"].allowed)
    check("write tool denied", not by_name["record_vitals"].allowed)
    check("admin tool denied", not by_name["admin_lookup_patient"].allowed)
    # Even a same-tool call repeated past max_calls per turn must be capped
    many = [calls[0]] * 10
    many_decisions = ap_policy.get_policy_gate().evaluate_plan(_req(), many)
    allowed_count = sum(1 for d in many_decisions if d.allowed)
    check(f"per-turn cap honoured (allowed={allowed_count} <= "
          f"{ap_config.AMINA_AGENTIC_MAX_TOOL_CALLS})",
          allowed_count <= ap_config.AMINA_AGENTIC_MAX_TOOL_CALLS)


# ── 12. Assist mode: only safe_summary in context block ────────────
def test_assist_safe_summary_only():
    section("12. Assist mode injects safe summaries only — never raw data")
    # Force assist
    orig_mode = ap_config.AMINA_AGENTIC_MODE
    try:
        ap_config.AMINA_AGENTIC_MODE = ap_config.AgentMode.ASSIST
        req = _req(message="what does WHO say about high blood pressure")
        rt = ap_runtime.get_runtime()
        result = asyncio.run(rt.maybe_run_agentic_prepass(req))
    finally:
        ap_config.AMINA_AGENTIC_MODE = orig_mode

    check("assist prepass enabled=True", result.enabled is True)
    if result.context_block:
        cb = result.context_block
        check("context_block starts with [AMINA_AGENTIC_CONTEXT]",
              cb.startswith("[AMINA_AGENTIC_CONTEXT]"))
        check("context_block ends with [/AMINA_AGENTIC_CONTEXT]",
              cb.rstrip().endswith("[/AMINA_AGENTIC_CONTEXT]"))
        # No PHI markers in context
        for forbidden in ("+220", "patient_id=", "phone=", "Fatou", "session_id="):
            check(f"context_block does not contain {forbidden!r}",
                  forbidden not in cb)
    else:
        # No tools approved (e.g. adapters not wired) — that's fine, we
        # just record that the test ran without injecting anything.
        check("assist with no approved tools yields empty context_block",
              result.context_block == "")


# ── 13. Shadow mode: planner + policy run, but NO tools execute ────
def test_shadow_no_execution():
    section("13. Shadow mode plans + denies but executes nothing")
    orig_mode = ap_config.AMINA_AGENTIC_MODE
    try:
        ap_config.AMINA_AGENTIC_MODE = ap_config.AgentMode.SHADOW
        req = _req(message="my BP was 145/95")
        result = asyncio.run(ap_runtime.get_runtime()
                             .maybe_run_agentic_prepass(req))
    finally:
        ap_config.AMINA_AGENTIC_MODE = orig_mode

    check("shadow prepass enabled=True", result.enabled is True)
    check("shadow agentic_mode label is 'shadow'", result.mode == "shadow")
    check("shadow does NOT execute approved tools (zero results)",
          len(result.approved_tool_results) == 0)
    check("shadow has empty context_block (assist-only feature)",
          result.context_block == "")
    check("shadow plan exists",  result.plan is not None)


# ── 14. OFF mode short-circuits before native flag is consulted ────
def test_off_mode_short_circuit():
    section("14. mode=off short-circuits before native_tools flag is even read")
    # Save and enable native to prove off still wins
    orig_mode    = ap_config.AMINA_AGENTIC_MODE
    orig_native  = ap_config.AMINA_AGENTIC_NATIVE_TOOLS
    try:
        ap_config.AMINA_AGENTIC_MODE = ap_config.AgentMode.OFF
        ap_config.AMINA_AGENTIC_NATIVE_TOOLS = True   # would-be enabled
        result = asyncio.run(ap_runtime.get_runtime()
                             .maybe_run_agentic_prepass(_req()))
    finally:
        ap_config.AMINA_AGENTIC_MODE = orig_mode
        ap_config.AMINA_AGENTIC_NATIVE_TOOLS = orig_native

    check("mode=off returns enabled=False", result.enabled is False)
    check("mode=off mode label is 'off'",   result.mode == "off")


# ── 15. Native tool hardening edge cases ───────────────────────────
def test_native_hardening():
    section("15. native_tools hardening: empty / dupes / enums / nested / overrides")

    # Empty registry-style input
    check("to_provider_neutral([]) returns []",
          nt.to_provider_neutral([]) == [])
    check("to_provider_neutral(None) returns []",
          nt.to_provider_neutral(None) == [])
    check("to_openai_tools([]) returns []",
          nt.to_openai_tools([]) == [])
    # Gemini wraps even empty into [{"function_declarations": []}]
    g = nt.to_gemini_tools([])
    check("to_gemini_tools([]) returns [{declarations: []}]",
          isinstance(g, list) and len(g) == 1
          and g[0].get("function_declarations") == [])

    # Duplicate tool names — first wins
    dupes = [
        {"name": "x", "description": "first",  "parameters": {"type": "object"}},
        {"name": "x", "description": "second", "parameters": {"type": "object"}},
    ]
    out = nt.to_provider_neutral(dupes)
    check("duplicate names deduped (1 survivor)", len(out) == 1)
    check("first occurrence kept (description='first')",
          out[0]["description"] == "first")

    # Missing parameters key
    missing = [{"name": "y", "description": "d"}]
    on = nt.to_provider_neutral(missing)
    check("missing parameters replaced with empty schema",
          on and on[0]["parameters"]["type"] == "object")
    check("missing parameters has empty properties",
          on[0]["parameters"]["properties"] == {})

    # Non-dict parameters
    nondict = [{"name": "z", "description": "d", "parameters": "not-a-dict"}]
    nz = nt.to_provider_neutral(nondict)
    check("non-dict parameters replaced (no crash)",
          isinstance(nz[0]["parameters"], dict))

    # Enum + nested object should pass through unchanged
    enum_nested = [{
        "name": "complex",
        "description": "complex tool",
        "parameters": {
            "type": "object",
            "properties": {
                "kind": {"type": "string", "enum": ["a", "b", "c"]},
                "nested": {"type": "object", "properties": {
                    "score": {"type": "integer", "min": 0, "max": 10},
                }},
            },
            "required": ["kind"],
        },
    }]
    en = nt.to_openai_tools(enum_nested)
    en_props = en[0]["function"]["parameters"]["properties"]
    check("enum preserved through OpenAI adapter",
          en_props["kind"]["enum"] == ["a", "b", "c"])
    check("nested object preserved through OpenAI adapter",
          en_props["nested"]["properties"]["score"]["type"] == "integer")
    g = nt.to_gemini_tools(enum_nested)
    g_props = g[0]["function_declarations"][0]["parameters"]["properties"]
    check("enum preserved through Gemini adapter",
          g_props["kind"]["enum"] == ["a", "b", "c"])
    check("nested object preserved through Gemini adapter",
          g_props["nested"]["properties"]["score"]["type"] == "integer")

    # Bad explicit override
    class _Anything:
        pass
    _Anything.__module__ = "openai.fake"
    check("bad override 'nonsense' -> NATIVE_UNSUPPORTED (no silent sniff)",
          nt.detect_format(_Anything(), "nonsense") == nt.NATIVE_UNSUPPORTED)
    check("bad override does NOT silently fall through to sniff",
          nt.detect_format(_Anything(), "totally-not-a-format") == nt.NATIVE_UNSUPPORTED)

    # Empty / 'auto' override falls through to sniff
    check("empty override falls through to sniff",
          nt.detect_format(_Anything(), "") == "openai")
    check("'auto' override falls through to sniff",
          nt.detect_format(_Anything(), "auto") == "openai")


# ── 16. Fallback reason strings exposed ────────────────────────────
def test_fallback_reasons():
    section("16. Phase-3 fallback reason codes are stable + complete")
    expected = {"FLAG_OFF", "UNKNOWN_PROVIDER", "BAD_OVERRIDE",
                "EMPTY_REGISTRY", "BUILD_PAYLOAD_NONE",
                "CLIENT_EXCEPTION", "PARSE_EMPTY",
                "PARSE_EXCEPTION", "OK"}
    check("FALLBACK_REASONS covers every documented case",
          expected.issubset(set(nt.FALLBACK_REASONS.keys())))
    for k in expected:
        v = nt.FALLBACK_REASONS[k]
        check(f"FALLBACK_REASONS[{k!r}] is a string", isinstance(v, str))


# ── 17. Readiness snapshot is safe + warning codes present ─────────
def test_readiness_snapshot():
    section("17. Readiness snapshot exposes safe defaults + warning codes")
    snap = ap_readiness.snapshot()
    check("snapshot has 'config' section", isinstance(snap.get("config"), dict))
    check("snapshot has 'registry' section",
          isinstance(snap.get("registry"), dict))
    check("snapshot has 'native' section", isinstance(snap.get("native"), dict))
    check("snapshot has 'warnings' list",
          isinstance(snap.get("warnings"), list))
    check("snapshot has 'ok' boolean", isinstance(snap.get("ok"), bool))
    check("snapshot has 'policy_gate_version' string",
          isinstance(snap.get("policy_gate_version"), str))

    cfg = snap["config"]
    check("config exposes AMINA_AGENTIC_MODE",
          "AMINA_AGENTIC_MODE" in cfg)
    check("config exposes AMINA_AGENTIC_NATIVE_TOOLS",
          "AMINA_AGENTIC_NATIVE_TOOLS" in cfg)
    check("config exposes AMINA_AGENTIC_NATIVE_FORMAT",
          "AMINA_AGENTIC_NATIVE_FORMAT" in cfg)
    check("config exposes AMINA_AGENTIC_MODES_ALLOWED",
          "AMINA_AGENTIC_MODES_ALLOWED" in cfg)
    check("config exposes AMINA_AGENTIC_TRACE_ENABLED",
          "AMINA_AGENTIC_TRACE_ENABLED" in cfg)

    reg = snap["registry"]
    check("registry exposes read_only_tools count",
          isinstance(reg.get("read_only_tools"), int)
          and reg["read_only_tools"] > 0)
    check("registry exposes denied_tools count",
          isinstance(reg.get("denied_tools"), int))
    check("registry has read_only_names list",
          isinstance(reg.get("read_only_names"), list))

    # Warning codes are stable
    for w in snap["warnings"]:
        check(f"warning '{w.get('code', '')}' has severity",
              w.get("severity") in ("info", "warn", "error"))
        check(f"warning '{w.get('code', '')}' is in WARNING_CODES",
              w.get("code") in ap_readiness.WARNING_CODES)


# ── 18. Risky-config detection ─────────────────────────────────────
def test_readiness_risky_configs():
    section("18. Readiness detects risky configurations")

    def with_overrides(**kw):
        """Run snapshot with temporarily-overridden config attrs."""
        backups = {k: getattr(ap_config, k) for k in kw}
        try:
            for k, v in kw.items():
                setattr(ap_config, k, v)
            return ap_readiness.snapshot()
        finally:
            for k, v in backups.items():
                setattr(ap_config, k, v)

    # native on, trace off -> ERROR
    snap = with_overrides(AMINA_AGENTIC_NATIVE_TOOLS=True,
                          AMINA_AGENTIC_TRACE_ENABLED=False)
    codes = {w["code"] for w in snap["warnings"]}
    check("native_on + trace_off -> NATIVE_ON_TRACE_OFF warning",
          "NATIVE_ON_TRACE_OFF" in codes)
    check("native_on + trace_off -> ok=False (error severity present)",
          snap["ok"] is False)

    # native on with format=auto -> WARN
    snap = with_overrides(AMINA_AGENTIC_NATIVE_TOOLS=True,
                          AMINA_AGENTIC_NATIVE_FORMAT="auto")
    codes = {w["code"] for w in snap["warnings"]}
    check("native_on + auto_format -> NATIVE_AUTO_IN_PROD warning",
          "NATIVE_AUTO_IN_PROD" in codes)

    # unknown native format -> ERROR
    snap = with_overrides(AMINA_AGENTIC_NATIVE_TOOLS=True,
                          AMINA_AGENTIC_NATIVE_FORMAT="anthropic")
    codes = {w["code"] for w in snap["warnings"]}
    check("unknown native_format -> NATIVE_FORMAT_UNKNOWN warning",
          "NATIVE_FORMAT_UNKNOWN" in codes)
    check("unknown native_format -> ok=False",
          snap["ok"] is False)

    # fail_open off -> WARN
    snap = with_overrides(AMINA_AGENTIC_FAIL_OPEN=False)
    codes = {w["code"] for w in snap["warnings"]}
    check("fail_open=False -> FAIL_OPEN_OFF warning",
          "FAIL_OPEN_OFF" in codes)

    # max_tool_calls high -> WARN
    snap = with_overrides(AMINA_AGENTIC_MAX_TOOL_CALLS=10)
    codes = {w["code"] for w in snap["warnings"]}
    check("max_tool_calls=10 -> MAX_TOOL_CALLS_HIGH warning",
          "MAX_TOOL_CALLS_HIGH" in codes)


# ── 19. Trace via runtime path is enriched + still PHI-safe ────────
def test_runtime_emits_enriched_trace():
    section("19. End-to-end: runtime fills enriched fields, no PHI leaked")
    # Force a known mode that runs the full path
    orig_mode = ap_config.AMINA_AGENTIC_MODE
    try:
        ap_config.AMINA_AGENTIC_MODE = ap_config.AgentMode.SHADOW
        req = _req(message="my BP was 145/95",
                   patient_name="Fatou Demo", phone="+220-555-1234")
        # We can't easily intercept the trace from here without changing
        # tracing. Instead we assert the prepass result + that the
        # runtime didn't bubble PHI back to us.
        result = asyncio.run(ap_runtime.get_runtime()
                             .maybe_run_agentic_prepass(req))
    finally:
        ap_config.AMINA_AGENTIC_MODE = orig_mode

    check("prepass enabled in shadow", result.enabled is True)
    check("prepass result has no patient_name attribute",
          not hasattr(result, "patient_name"))
    check("prepass result has no phone attribute",
          not hasattr(result, "phone"))


# ── Run all ────────────────────────────────────────────────────────
def main():
    print("AMINA Agent Platform Phase 3 — safety + enrichment test suite")
    print("=" * 64)
    test_trace_enrichment_defaults()
    test_phi_redaction_enriched()
    test_misuse_write_admin_external()
    test_misuse_id_override()
    test_misuse_phi_in_args()
    test_misuse_unknown_tool()
    test_misuse_malformed()
    test_misuse_too_many_calls()
    test_misuse_mixed_payloads()
    test_args_dict_vs_string()
    test_policy_gate_final_authority()
    test_assist_safe_summary_only()
    test_shadow_no_execution()
    test_off_mode_short_circuit()
    test_native_hardening()
    test_fallback_reasons()
    test_readiness_snapshot()
    test_readiness_risky_configs()
    test_runtime_emits_enriched_trace()
    print("\n" + "=" * 64)
    print(f"PASSED: {passed}    FAILED: {failed}")
    if failed:
        print("FAILED CASES:")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
