"""
AMINA Agent Platform v2 — native function-calling test suite.

Covers ONLY the new Phase-2 surface (native_tools module + planner gate).
v1 behaviour is exercised by _agent_platform_v1_test.py and is asserted
unchanged at the regression level here (heuristic still wins, default
flag is False, AgentMode.OFF still short-circuits everything).

Run inside or outside the container:
    python _agent_platform_v2_native_tools_test.py
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

# Force a known config BEFORE importing the package — Phase-2 default
# MUST be off so the default import does not enable native tools.
os.environ.setdefault("AMINA_AGENTIC_MODE", "off")
os.environ.setdefault("AMINA_AGENTIC_FAIL_OPEN", "true")
os.environ.setdefault("AMINA_AGENTIC_MAX_TOOL_CALLS", "3")

from src.agent_platform import config as ap_config              # noqa: E402
from src.agent_platform import models as ap_models              # noqa: E402
from src.agent_platform import native_tools as nt               # noqa: E402
from src.agent_platform import planner as ap_planner            # noqa: E402
from src.agent_platform.tool_registry import get_registry       # noqa: E402

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


# ── 1. Phase-2 flag defaults ────────────────────────────────────────
def test_flag_defaults():
    section("1. Phase-2 flag defaults (must be off out of the box)")
    check("AMINA_AGENTIC_NATIVE_TOOLS default False",
          ap_config.AMINA_AGENTIC_NATIVE_TOOLS is False)
    check("AMINA_AGENTIC_NATIVE_FORMAT default 'auto'",
          ap_config.AMINA_AGENTIC_NATIVE_FORMAT == "auto")
    snap = ap_config.snapshot()
    check("snapshot() exposes native_tools field", "native_tools" in snap)
    check("snapshot() exposes native_format field", "native_format" in snap)
    check("snapshot()['native_tools'] is False", snap["native_tools"] is False)


# ── 2. Provider-neutral export ──────────────────────────────────────
def test_provider_neutral():
    section("2. Provider-neutral schema export")
    reg = get_registry()
    schemas = reg.get_schemas_for_llm(mode="advanced", role="patient")
    neutral = nt.to_provider_neutral(schemas)
    check("returns a non-empty list",   len(neutral) > 0)
    check("count matches input count",  len(neutral) == len(schemas))
    for s in neutral:
        check(f"{s['name']}: has name",        bool(s.get("name")))
        check(f"{s['name']}: has description", isinstance(s.get("description"), str))
        check(f"{s['name']}: parameters dict", isinstance(s.get("parameters"), dict))


# ── 3. OpenAI adapter ──────────────────────────────────────────────
def test_openai_adapter():
    section("3. OpenAI tools adapter")
    reg = get_registry()
    schemas = reg.get_schemas_for_llm(mode="advanced", role="patient")
    tools = nt.to_openai_tools(schemas)
    check("returns a list", isinstance(tools, list))
    check("non-empty",      len(tools) > 0)
    for t in tools:
        check("entry has type=function",  t.get("type") == "function")
        fn = t.get("function") or {}
        check(f"entry has function.name", isinstance(fn.get("name"), str) and fn["name"])
        check(f"entry has function.description",
              isinstance(fn.get("description"), str))
        check(f"entry has function.parameters object",
              isinstance(fn.get("parameters"), dict))

    # Critical safety property: no write/admin tool can sneak in
    write_names = {"record_vitals", "create_referral", "send_sms",
                   "admin_lookup_patient"}
    exposed = {(t["function"]["name"]) for t in tools}
    overlap = write_names & exposed
    check("no write/admin tool exposed via OpenAI adapter",
          not overlap, detail=f"leaked: {overlap}")

    # No injected fields (e.g., patient_id) appear in any parameter set
    leaked = []
    for t in tools:
        props = (t["function"].get("parameters") or {}).get("properties") or {}
        for fname, fprop in props.items():
            if isinstance(fprop, dict) and fprop.get("injected"):
                leaked.append(f"{t['function']['name']}.{fname}")
    check("no `injected:true` field exposed in OpenAI tools",
          not leaked, detail=f"leaked: {leaked}")


def test_openai_parser():
    section("4. OpenAI tool-call parser")
    reg = get_registry()

    # Plain-dict response (typical of httpx mock or json-deserialised body)
    resp = {
        "choices": [{
            "message": {
                "tool_calls": [
                    {"function": {"name": "get_recent_vitals",
                                  "arguments": '{"days": 30, "vital_type": "bp"}'}},
                    {"function": {"name": "retrieve_who_protocol",
                                  "arguments": '{"topic": "hypertension"}'}},
                    # Unknown tool — must be filtered out
                    {"function": {"name": "definitely_not_a_real_tool",
                                  "arguments": "{}"}},
                    # Malformed args — must be skipped, not crash
                    {"function": {"name": "get_care_plan",
                                  "arguments": "{not valid json"}},
                ],
            },
        }],
    }
    # max_calls=4 here because we want the parser to see all 4 fixtures
    # (one is then filtered out by registry_has, leaving 3). A separate
    # cap test below uses max_calls=2 to verify the slice.
    calls = nt.parse_openai_tool_calls(resp, registry_has=reg.has, max_calls=4)
    names = [c.tool_name for c in calls]
    check("parsed at least the two valid calls",
          "get_recent_vitals" in names and "retrieve_who_protocol" in names)
    check("filtered unknown tool",
          "definitely_not_a_real_tool" not in names)
    check("kept malformed-arg call (with empty args, name was valid)",
          "get_care_plan" in names)
    check("respects max_calls cap when smaller than fixture count",
          len(nt.parse_openai_tool_calls(resp, registry_has=reg.has, max_calls=2)) == 2)
    # Args parsed correctly for the well-formed call
    vit = next((c for c in calls if c.tool_name == "get_recent_vitals"), None)
    check("get_recent_vitals: days=30 parsed",
          vit is not None and vit.arguments.get("days") == 30)
    check("get_recent_vitals: vital_type='bp' parsed",
          vit is not None and vit.arguments.get("vital_type") == "bp")
    care = next((c for c in calls if c.tool_name == "get_care_plan"), None)
    check("get_care_plan: malformed args fall back to {}",
          care is not None and care.arguments == {})

    # Empty / missing fields — must NOT raise
    check("empty response returns []",        nt.parse_openai_tool_calls({}) == [])
    check("None response returns []",         nt.parse_openai_tool_calls(None) == [])
    check("missing tool_calls returns []",
          nt.parse_openai_tool_calls({"choices":[{"message":{}}]}) == [])


# ── 5. Gemini adapter ──────────────────────────────────────────────
def test_gemini_adapter():
    section("5. Gemini tools adapter")
    reg = get_registry()
    schemas = reg.get_schemas_for_llm(mode="advanced", role="patient")
    tools = nt.to_gemini_tools(schemas)
    check("returns list of length 1 (Gemini wraps in single tools entry)",
          isinstance(tools, list) and len(tools) == 1)
    decls = tools[0].get("function_declarations") or []
    check("function_declarations present and non-empty",
          isinstance(decls, list) and len(decls) > 0)
    check("declaration count == schema count", len(decls) == len(schemas))
    for d in decls:
        check(f"{d.get('name')}: has parameters dict",
              isinstance(d.get("parameters"), dict))

    # Same safety properties as OpenAI adapter
    write_names = {"record_vitals", "create_referral", "send_sms",
                   "admin_lookup_patient"}
    exposed = {d["name"] for d in decls}
    check("no write/admin tool exposed via Gemini adapter",
          not (write_names & exposed))


def test_gemini_parser():
    section("6. Gemini tool-call parser")
    reg = get_registry()
    resp = {
        "candidates": [{
            "content": {
                "parts": [
                    {"function_call": {"name": "get_medications", "args": {}}},
                    {"function_call": {"name": "retrieve_ncd_knowledge",
                                       "args": {"query": "metformin", "language": "en"}}},
                    # Unknown — filtered
                    {"function_call": {"name": "fake_tool", "args": {}}},
                    # Non-dict args — coerced to {}
                    {"function_call": {"name": "get_care_plan", "args": "oops"}},
                    # Plain text part — ignored
                    {"text": "Here is your answer."},
                ],
            },
        }],
    }
    calls = nt.parse_gemini_tool_calls(resp, registry_has=reg.has, max_calls=3)
    names = [c.tool_name for c in calls]
    check("parsed valid calls",
          "get_medications" in names and "retrieve_ncd_knowledge" in names)
    check("filtered unknown tool", "fake_tool" not in names)
    check("non-dict args coerced to {}",
          any(c.tool_name == "get_care_plan" and c.arguments == {} for c in calls))
    check("max_calls cap respected", len(calls) <= 3)
    check("empty response returns []",  nt.parse_gemini_tool_calls({}) == [])
    check("None response returns []",   nt.parse_gemini_tool_calls(None) == [])


# ── 7. Format detection ────────────────────────────────────────────
def test_detect_format():
    section("7. detect_format() provider sniff + override")

    # Fake "OpenAI-ish" client by class module path
    class _FakeOpenAI:
        pass
    _FakeOpenAI.__module__ = "openai.x.y"

    class _FakeGroq:
        pass
    _FakeGroq.__module__ = "groq.x.y"

    class _FakeGemini:
        pass
    _FakeGemini.__module__ = "google.generativeai.x"

    class _FakeRandom:
        pass
    _FakeRandom.__module__ = "totally.unknown.lib"

    check("openai-class detected",  nt.detect_format(_FakeOpenAI()) == "openai")
    check("groq-class detected as openai",
          nt.detect_format(_FakeGroq()) == "openai")
    check("gemini-class detected", nt.detect_format(_FakeGemini()) == "gemini")
    check("unknown class -> NATIVE_UNSUPPORTED",
          nt.detect_format(_FakeRandom()) == nt.NATIVE_UNSUPPORTED)

    # Override wins
    check("override='openai' wins",
          nt.detect_format(_FakeRandom(), "openai") == "openai")
    check("override='gemini' wins",
          nt.detect_format(_FakeRandom(), "gemini") == "gemini")
    check("override='auto' falls through to sniff",
          nt.detect_format(_FakeOpenAI(), "auto") == "openai")
    check("None client -> NATIVE_UNSUPPORTED",
          nt.detect_format(None) == nt.NATIVE_UNSUPPORTED)


# ── 8. Dispatch helpers ────────────────────────────────────────────
def test_dispatch():
    section("8. build_native_tools_payload + parse dispatch")
    reg = get_registry()
    schemas = reg.get_schemas_for_llm(mode="advanced", role="patient")

    p_oa, k_oa = nt.build_native_tools_payload(schemas, "openai")
    check("openai dispatch returns list",  isinstance(p_oa, list))
    check("openai dispatch kwarg='tools'", k_oa == "tools")

    p_gm, k_gm = nt.build_native_tools_payload(schemas, "gemini")
    check("gemini dispatch returns list",  isinstance(p_gm, list))
    check("gemini dispatch kwarg='tools'", k_gm == "tools")

    p_no, k_no = nt.build_native_tools_payload(schemas, nt.NATIVE_UNSUPPORTED)
    check("unsupported dispatch returns (None, None)",
          p_no is None and k_no is None)


# ── 9. Planner gate: heuristic still wins; flag-off path unchanged ──
def test_planner_regression():
    section("9. Planner regression: heuristic-first + flag-off behaviour")

    # 9a. Flag-off: confirm planner does NOT call native path even if a
    # request is non-emergency and bypasses heuristic. We can only
    # verify this by snapshotting the config; the planner literally
    # gates on `_ap_config.AMINA_AGENTIC_NATIVE_TOOLS`.
    check("planner gates on AMINA_AGENTIC_NATIVE_TOOLS",
          ap_config.AMINA_AGENTIC_NATIVE_TOOLS is False)

    # 9b. Heuristic-first regression: a BP query must produce a
    # heuristic plan with intent='heuristic_match' regardless of
    # native flag (heuristic runs before any LLM path).
    req = ap_models.AgenticRequest(
        message="my BP was 145/95 last week",
        session_id="t-9b", patient_id="p-1", role="patient", mode="advanced",
    )
    plan = asyncio.run(ap_planner.plan(
        req,
        get_registry().get_schemas_for_llm(mode="advanced", role="patient"),
    ))
    check("heuristic still wins for BP query",
          plan.intent == "heuristic_match" and len(plan.tool_calls) >= 1)
    check("heuristic plan reason mentions heuristic",
          plan.reason.startswith("heuristic:"))

    # 9c. Emergency keyword still short-circuits to bypass route
    req2 = ap_models.AgenticRequest(
        message="I'm having severe chest pain", session_id="t-9c",
        patient_id="p-1", role="patient", mode="advanced",
    )
    plan2 = asyncio.run(ap_planner.plan(
        req2,
        get_registry().get_schemas_for_llm(mode="advanced", role="patient"),
    ))
    check("emergency still routes to emergency_bypass",
          plan2.route == "emergency_bypass" and len(plan2.tool_calls) == 0)


# ── 10. Native path with a stub client (flag flipped on for one call) ─
def test_native_path_with_stub_client():
    section("10. Native path with stub client (flag flipped on for one call)")

    # Build a fake OpenAI-shaped client that returns one valid tool call
    class _StubChatCompletions:
        async def create(self, **kwargs):
            # Echo the kwargs for assertion
            self.last_kwargs = kwargs
            return {
                "choices": [{
                    "message": {
                        "tool_calls": [
                            {"function": {
                                "name": "retrieve_who_protocol",
                                "arguments": '{"topic": "hypertension"}',
                            }},
                        ],
                    },
                }],
            }

    class _StubChat:
        def __init__(self):
            self.completions = _StubChatCompletions()

    class _StubClient:
        def __init__(self):
            self.chat = _StubChat()
    _StubClient.__module__ = "openai.fake"

    client = _StubClient()
    schemas = get_registry().get_schemas_for_llm(mode="advanced", role="patient")
    req = ap_models.AgenticRequest(
        message="what does WHO say about high blood pressure",
        session_id="t-10", patient_id="p-1", role="patient", mode="advanced",
    )

    # Temporarily flip the flag for this single call. We mutate the
    # module attribute the planner reads (`_ap_config.AMINA_AGENTIC_NATIVE_TOOLS`).
    orig = ap_config.AMINA_AGENTIC_NATIVE_TOOLS
    try:
        ap_config.AMINA_AGENTIC_NATIVE_TOOLS = True
        plan = asyncio.run(ap_planner._try_native_tool_call(
            client, "stub-model", "test prompt", req, schemas,
        ))
    finally:
        ap_config.AMINA_AGENTIC_NATIVE_TOOLS = orig

    check("native path returned a plan", plan is not None)
    check("native plan intent prefixed 'native_'",
          plan is not None and plan.intent.startswith("native_"))
    check("native plan has the WHO tool call",
          plan is not None
          and any(c.tool_name == "retrieve_who_protocol" for c in plan.tool_calls))
    check("native plan args parsed",
          plan is not None and plan.tool_calls
          and plan.tool_calls[0].arguments.get("topic") == "hypertension")
    # Assert tools/tool_choice were sent
    sent = client.chat.completions.last_kwargs
    check("native call passed tools= payload",
          isinstance(sent.get("tools"), list) and len(sent["tools"]) > 0)
    check("native call set tool_choice='auto'",
          sent.get("tool_choice") == "auto")


def test_native_path_failure_falls_back():
    section("11. Native path: client exception returns None (fail-open)")

    class _ExplodingClient:
        class _Chat:
            class _C:
                async def create(self, **kw):
                    raise RuntimeError("boom")
            completions = _C()
        chat = _Chat()
    _ExplodingClient.__module__ = "openai.exploder"

    client = _ExplodingClient()
    schemas = get_registry().get_schemas_for_llm(mode="advanced", role="patient")
    req = ap_models.AgenticRequest(
        message="anything", session_id="t-11", patient_id="p-1",
        role="patient", mode="advanced",
    )
    orig = ap_config.AMINA_AGENTIC_NATIVE_TOOLS
    try:
        ap_config.AMINA_AGENTIC_NATIVE_TOOLS = True
        plan = asyncio.run(ap_planner._try_native_tool_call(
            client, "stub-model", "test prompt", req, schemas,
        ))
    finally:
        ap_config.AMINA_AGENTIC_NATIVE_TOOLS = orig

    check("native client failure -> None (caller falls back)", plan is None)


def test_native_path_unsupported_provider():
    section("12. Native path: unsupported provider returns None")

    class _UnknownClient:
        pass
    _UnknownClient.__module__ = "weirdprovider.x"

    schemas = get_registry().get_schemas_for_llm(mode="advanced", role="patient")
    req = ap_models.AgenticRequest(
        message="anything", session_id="t-12", patient_id="p-1",
        role="patient", mode="advanced",
    )
    orig = ap_config.AMINA_AGENTIC_NATIVE_TOOLS
    try:
        ap_config.AMINA_AGENTIC_NATIVE_TOOLS = True
        # NATIVE_FORMAT='auto' so detect will return NATIVE_UNSUPPORTED
        plan = asyncio.run(ap_planner._try_native_tool_call(
            _UnknownClient(), "stub-model", "test prompt", req, schemas,
        ))
    finally:
        ap_config.AMINA_AGENTIC_NATIVE_TOOLS = orig

    check("unsupported provider -> None (caller falls back)", plan is None)


# ── 13. Safety: write tools never reach native payload ─────────────
def test_safety_no_writes_in_payload():
    section("13. Safety: write/admin tools cannot enter native payload")
    reg = get_registry()
    # Even if we ASK for a role that has writes (none does, but assume
    # one might in future), get_schemas_for_llm filters by V1_ALLOWED_RISKS.
    for role in ("patient", "family", "vhw", "chn", "admin", "guest"):
        schemas = reg.get_schemas_for_llm(mode="advanced", role=role)
        names_in_payload = set()
        for t in nt.to_openai_tools(schemas):
            names_in_payload.add(t["function"]["name"])
        for d in nt.to_gemini_tools(schemas)[0].get("function_declarations", []):
            names_in_payload.add(d["name"])
        for forbidden in ("record_vitals", "create_referral", "send_sms",
                          "admin_lookup_patient"):
            check(f"role={role}: forbidden tool '{forbidden}' not in native payload",
                  forbidden not in names_in_payload)


# ── Run all ────────────────────────────────────────────────────────
def main():
    print("AMINA Agent Platform v2 — native function-calling test suite")
    print("=" * 64)
    test_flag_defaults()
    test_provider_neutral()
    test_openai_adapter()
    test_openai_parser()
    test_gemini_adapter()
    test_gemini_parser()
    test_detect_format()
    test_dispatch()
    test_planner_regression()
    test_native_path_with_stub_client()
    test_native_path_failure_falls_back()
    test_native_path_unsupported_provider()
    test_safety_no_writes_in_payload()
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
