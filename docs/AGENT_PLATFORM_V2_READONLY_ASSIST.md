# AMINA Agent Platform v2 — Native Function-Calling (Read-Only Assist)

**Status:** Phase 2 prep landed (additive); **default flag = `false`** (zero behaviour change).
**Depends on:** v1 (already shipped — see `AGENT_PLATFORM_V1.md`).
**Recommended rollout:** keep flag off until v1 is in `assist` on `advanced` for ≥2 weeks; then enable native tools for the same scope and observe traces for regressions.

---

## 0. What this is — and what it is not

| It IS | It IS NOT |
|---|---|
| An **additive** Phase-2 layer that lets the LLM planner use the provider's native tool-calling API (OpenAI tools, Gemini function declarations) instead of asking the LLM for a JSON blob in the message body. | A new agentic mode. Off / shadow / assist / strict from v1 are unchanged. |
| A **default-off** capability gated by `AMINA_AGENTIC_NATIVE_TOOLS=false`. | An autonomous multi-step tool loop. The hard cap of `AMINA_AGENTIC_MAX_TOOL_CALLS` (default 3) still applies. |
| A **fail-open** wrapper: any native-call exception falls back to the v1 JSON-string LLM planner, then to the no-tool fallback. | A bypass of the deterministic policy gate. Every call the LLM proposes — native or JSON — is still re-checked by `tool_policy.evaluate_plan`. |
| A **read-only** capability. The schemas exposed to the native API are exactly the ones in `V1_ALLOWED_RISKS` (filtered upstream by `registry.get_schemas_for_llm`). | A way to expose new tools. No new tools were added in Phase 2. |

**Critical safety guarantees inherited from v1 (NOT relaxed):**
1. Only tools in `V1_ALLOWED_RISKS = {SAFE_READ_ONLY, READ_ONLY_CLINICAL, CLINICAL_ADVICE_SUPPORT}` are ever exposed in the native payload.
2. `injected: True` schema fields (`patient_id`, `phone`, `medications`, `conditions`) are stripped by `ToolSpec.to_llm_schema()` before they ever reach the native adapter — verified by test 13.
3. The 13-check policy gate runs after parsing the LLM response. Native tool calls hit the same `evaluate_plan` path as JSON-string ones.
4. Heuristic planner runs FIRST. Native function-calling is only attempted if the heuristic returns no match AND a compatible LLM client is available AND the flag is on. Verified by test 9.
5. Setting `AMINA_AGENTIC_MODE=off` short-circuits everything before the flag is even consulted (runtime.py lines 56-58). One env var, total kill.

---

## 1. Architecture (delta from v1)

```
agentic_runtime_patch._patched_process_message
    └─ runtime.maybe_run_agentic_prepass
        └─ planner.plan
            ├─ _heuristic_plan          (always first — unchanged)
            └─ _llm_plan                (only if heuristic returned None)
                ├─ NEW: _try_native_tool_call    (Phase 2)
                │     └─ if AMINA_AGENTIC_NATIVE_TOOLS=true
                │       AND detect_format(client) ∈ {openai, gemini}:
                │         build_native_tools_payload(...)
                │         client.chat.completions.create(tools=..., tool_choice="auto")
                │         parse_native_tool_calls(response, ...)
                │     └─ on ANY exception: return None → caller falls through
                └─ existing JSON-string LLM call               (v1 — unchanged)
```

**Nothing else changes.** The policy gate, the executor, the tracer, the runtime, the assist `[AMINA_AGENTIC_CONTEXT]` injection — all v1 behaviour as documented in `AGENT_PLATFORM_V1.md`. The only edit to `planner.py` is one new helper function (`_try_native_tool_call`) plus a 6-line gate in `_llm_plan` that calls it. Everything else in this MR is a new file.

---

## 2. Files added / modified

### New (purely additive)

| File | Purpose |
|---|---|
| `src/agent_platform/native_tools.py` | Provider-neutral exporter + OpenAI/Gemini adapters (build payloads, parse responses). 290 lines, no I/O, no LLM call. |
| `_agent_platform_v2_native_tools_test.py` | 200 cases. Custom check-runner (matches v1 convention, NOT pytest discovery). |
| `docs/AGENT_PLATFORM_V2_READONLY_ASSIST.md` | This file. |

### Modified (additive only — no v1 logic changed)

| File | Diff |
|---|---|
| `src/agent_platform/config.py` | Added `AMINA_AGENTIC_NATIVE_TOOLS` (default `false`) and `AMINA_AGENTIC_NATIVE_FORMAT` (default `"auto"`); both surfaced in `snapshot()`. |
| `src/agent_platform/__init__.py` | Re-exported the two new env vars. |
| `src/agent_platform/planner.py` | Added one `from src.agent_platform import config as _ap_config` import; added the `_try_native_tool_call` helper (~70 lines, all new); added a 6-line gate in `_llm_plan` that delegates to the new helper when the flag is on. The original JSON-string code path is untouched and is the unconditional fallback. |

---

## 3. New env vars

| Var | Default | Effect |
|---|---|---|
| `AMINA_AGENTIC_NATIVE_TOOLS` | `false` | Master switch for Phase 2. When `false`, the new helper is never called; v1 behaviour is byte-for-byte identical. |
| `AMINA_AGENTIC_NATIVE_FORMAT` | `auto` | Override the provider sniff. Recognised values: `openai` (also covers Groq / OpenAI-compatible endpoints), `gemini`. Anything else (including `auto`) triggers the class-path sniffer. |

All v1 env vars (`AMINA_AGENTIC_MODE`, `AMINA_AGENTIC_MODES_ALLOWED`, `AMINA_AGENTIC_MAX_TOOL_CALLS`, etc.) are unchanged.

---

## 4. Recommended staged rollout

### Stage 0 — `AMINA_AGENTIC_NATIVE_TOOLS=false` (default)

Zero behaviour change. v1's existing JSON-string LLM planner runs as before. You can ship this code at any point regardless of v1's current rollout stage — no flag flip required.

### Stage 1 — Pre-requisite: v1 must already be in `assist` on `advanced`

Do NOT enable native tools while v1 is still in `shadow`. Native tools change *how* the LLM proposes calls, not *whether* they execute, so you want a stable assist baseline first.

### Stage 2 — Enable native tools, advanced only

```bash
export AMINA_AGENTIC_MODE=assist
export AMINA_AGENTIC_MODES_ALLOWED=advanced
export AMINA_AGENTIC_NATIVE_TOOLS=true
# Optional explicit format (otherwise auto-sniff):
# export AMINA_AGENTIC_NATIVE_FORMAT=openai

cd haystack-stack
docker compose up -d --force-recreate haystack-chatqna
```

### Stage 3 — Observe traces for ≥2 weeks

```bash
docker logs -f haystack-chatqna 2>&1 \
  | grep --line-buffered AGENT_TRACE \
  | sed 's/^.*AGENT_TRACE //' | jq .
```

Compare to your Stage-1 (v1 assist) baseline:
- `plan_intent` distribution should now show `native_openai` / `native_gemini` instead of `llm_match` for the LLM-fallback cases. Heuristic-match counts should be unchanged (heuristic still runs first).
- `tool_decisions` should be similar — same tools, same risk classes, same allowed/denied ratio. If the native LLM proposes more *forbidden* tools than the JSON LLM did, the policy gate will deny them; you'll see this as a higher denied-count.
- `latency_ms` should be ≤ baseline. Native tool-calling typically reduces planner roundtrips (no JSON re-serialisation cost in the message body) but adds a small parsing tax.

### Stage 4 — Expand to `basic` / `beginner`

Same rollout as v1: only after Stage 3 metrics support it, add modes to `AMINA_AGENTIC_MODES_ALLOWED`. Phase 2 introduces no new mode-allow-list logic — the same v1 gate applies.

---

## 5. Rollback

Two independent kill switches, in order of blast radius:

| Switch | Effect | When to use |
|---|---|---|
| `AMINA_AGENTIC_NATIVE_TOOLS=false` | Disables native tools only. v1 JSON-string LLM planner resumes. | Native-specific issue (parsing bug, provider rate-limit, format drift). Usually preferred. |
| `AMINA_AGENTIC_MODE=off` | Disables the entire agent platform. Pure original-AminaAgent behaviour. | v1 issue, or worst-case Phase-2 issue you can't isolate. |

Either rollback takes effect on the next request after a recreate. No data is mutated by Phase 2 — there is nothing to roll back besides the flag.

---

## 6. Safety boundaries — what Phase 2 cannot do

The native-tools layer is a pure transformation + dispatch layer. It cannot:

| Operation | Why it's blocked |
|---|---|
| Execute any tool | Execution is the executor's job; the policy gate runs first. Native tool calls are dataclass instances — the LLM cannot trigger execution by emitting them. |
| Expose write/admin tools to the LLM | `registry.get_schemas_for_llm` filters by `V1_ALLOWED_RISKS` BEFORE the schemas reach the native adapter. Verified by test 13 across all roles (patient/family/vhw/chn/admin/guest). |
| Inject `patient_id` / `phone` / `medications` etc. | `ToolSpec.to_llm_schema()` strips fields with `injected: True`. Verified by test 3. |
| Bypass the 13 policy checks | Parsed `AgenticToolCall` objects flow through `runtime._run` → `_policy.evaluate_plan` exactly like JSON-parsed ones. |
| Make more than `AMINA_AGENTIC_MAX_TOOL_CALLS` calls | Both adapter parsers (`parse_openai_tool_calls`, `parse_gemini_tool_calls`) honour `max_calls`. Verified by tests 4 + 6. |
| Survive a partially-malformed response | Each parsed call is wrapped in a try/except — a single bad entry is skipped, not propagated. Verified by test 4 (malformed-args fixture) + test 11 (RuntimeError from client). |
| Run on an unsupported provider | `detect_format` returns `NATIVE_UNSUPPORTED` → `_try_native_tool_call` returns `None` → caller falls back. Verified by test 12. |

---

## 7. Test evidence

Both suites run on host Python (matches existing v1 convention; not pytest-discovered):

```bash
# v2 — new in this MR
cd haystack-stack/haystack-chatqna
python _agent_platform_v2_native_tools_test.py
# → PASSED: 200    FAILED: 0

# v1 — regression check (run with PYTHONIOENCODING=utf-8 on Windows
# because v1 prints arrow chars; the issue is in v1's print, not its
# logic, and is unaffected by Phase 2)
PYTHONIOENCODING=utf-8 python _agent_platform_v1_test.py
# → 149 passed,  0 failed
```

What the v2 suite covers (13 sections, 200 cases):

| # | Section | Asserts |
|---|---|---|
| 1 | Phase-2 flag defaults | `AMINA_AGENTIC_NATIVE_TOOLS=false`, `AMINA_AGENTIC_NATIVE_FORMAT="auto"`, `snapshot()` exposes both |
| 2 | Provider-neutral export | Schemas pass through with name/description/parameters preserved |
| 3 | OpenAI adapter | Correct `{"type":"function", "function":{...}}` shape; no write/admin tools; no `injected:true` fields |
| 4 | OpenAI parser | Valid calls parsed; unknown filtered; malformed args coerced to `{}`; max_calls cap respected; tolerates empty/None response |
| 5 | Gemini adapter | Correct `[{"function_declarations":[...]}]` shape; safety properties identical to OpenAI |
| 6 | Gemini parser | Same coverage as OpenAI parser, plus non-dict args coerced |
| 7 | Format detection | OpenAI / Groq → `openai`; Gemini → `gemini`; unknown → `NATIVE_UNSUPPORTED`; explicit override wins; None client safe |
| 8 | Dispatch helpers | `build_native_tools_payload` / `parse_native_tool_calls` route correctly per format |
| 9 | Planner regression | Flag default off; heuristic still wins for BP query; emergency still bypasses |
| 10 | Native path with stub client | Plan returned with `intent="native_openai"`; correct args parsed; `tools=` and `tool_choice="auto"` actually sent |
| 11 | Fail-open on client exception | Client `RuntimeError` → helper returns `None` (caller falls back) |
| 12 | Fail-open on unsupported provider | Unknown class → helper returns `None` (caller falls back) |
| 13 | Safety: no writes ever in native payload | For every role (patient, family, vhw, chn, admin, guest), verify `record_vitals`, `create_referral`, `send_sms`, `admin_lookup_patient` are absent from both OpenAI and Gemini payloads |

---

## 8. Acceptance criteria — verified

1. ✅ Existing v1 tests still pass (149/149).
2. ✅ New v2 native-tools tests pass (200/200).
3. ✅ Native function-calling is present but disabled by default (test 1).
4. ✅ No write/admin/external tools can execute via the native path (tests 3, 5, 13 — schema filtering; downstream policy gate is the second layer).
5. ✅ Rollback remains a single env var: `AMINA_AGENTIC_MODE=off` (master) or `AMINA_AGENTIC_NATIVE_TOOLS=false` (Phase-2 only).
6. ✅ All Phase-2 changes are additive: 1 new module, 1 new test file, 1 new doc, plus minimal additive edits to `config.py`, `__init__.py`, `planner.py` (no existing v1 logic altered, no public API changed).

---

## 9. Non-goals — explicitly NOT in Phase 2

- New tools (none added; only the v1 read-only set is exposed).
- Multi-step / recursive tool calls (still capped at `AMINA_AGENTIC_MAX_PLANNING_ROUNDS=1`).
- Streaming tool-call deltas (we wait for the full response).
- A non-OpenAI / non-Gemini provider integration (e.g. Anthropic native tools). Adding one is a ~80-line change: a new `to_<provider>_tools` + `parse_<provider>_tool_calls` pair plus an entry in `detect_format` and `build_native_tools_payload`. The v2 test suite gives a template.
- Changes to the assist context-block injection (still v1's `[AMINA_AGENTIC_CONTEXT]` shape).
- Changes to tracing fields or PHI redaction (still v1's `AgentTrace.to_safe_dict`). Phase 2 emits `plan_intent="native_openai"` or `"native_gemini"` instead of `"llm_match"` when the native path succeeds, but no new fields are added to the trace.

---

## 10. Roadmap (post-v2)

| Phase | What |
|---|---|
| 3 | OpenTelemetry spans replacing the JSON log line (carried over from v1 roadmap) |
| 4 | Read-only production rollout (assist + native tools for `advanced,basic,beginner`) |
| 5 | Confirmation-gated write tools (`record_vitals`, `create_referral`) — every write requires explicit user confirmation surfaced to the UI; native tools layer needs no change here, only registry risk-class promotion + UI plumbing |
| 6 | Sandboxed tool execution for admin / eval jobs only |
| 7 | Eval harness with 300+ golden scenarios — replays through native-tools assist mode and scores against held-out clinical truth |
