# AMINA Agent Platform v1 — bounded shadow / assist agentic runtime

**Status:** shipped 2026-04-27, **default mode = `off`** (zero behaviour change).
**Recommended rollout:** start in `shadow` on `advanced` mode only, observe traces for 2-4 weeks, promote to `assist` on `advanced` only, expand later if metrics support it.

---

## 0. What this is — and what it is not

| It IS | It IS NOT |
|---|---|
| A **separately-owned** agentic layer in `src/agent_platform/` | A rewrite of `AminaAgent` |
| A **bounded** planner that proposes 0-3 read-only tool calls | An autonomous multi-step planner |
| A **mandatory deterministic policy gate** in front of every tool execution | A LangGraph-style multi-agent orchestration |
| A **fail-open** wrapper around the existing `process_message` | A patient-facing "free agent" that can mutate records |
| A **shadow-first** observability + safety stack | A code-execution / browser / SMS / referral-creation system |
| A way to close the industry gap on tool schemas + function-call-style planning + per-turn tracing | A replacement for the existing emergency / medication / safety_consensus / Basic-Beginner / advanced-router stacks |

**Critical safety principle (from the spec):**

> The LLM may propose tool calls, but the backend policy gate decides what is allowed. Existing emergency handling, medication safety, guest/PHI rules, Basic/Beginner deterministic routing, RAG, policy review, STT/TTS, Telegram, and Meta channel behavior must remain intact.

Mode=off enforces all of the above by being a true no-op.

---

## 1. Architecture

```
HTTP request --------> agent_routes.py (process_message)
                                |
                                v
              agentic_runtime_patch._patched_process_message
                                |
                if AMINA_AGENTIC_MODE == off:
                    -> call ORIGINAL process_message, return
                                |  (otherwise)
                                v
              build AgenticRequest from kwargs / args
                                |
                                v
              runtime.maybe_run_agentic_prepass
                +----------------------------+
                |  planner.plan              |  heuristic FIRST, LLM optional
                |    (max 3 tool calls)      |  emergency keywords -> bypass
                +-------------+--------------+
                              |
                              v
                +----------------------------+
                |  tool_policy.evaluate_plan |  13 deterministic checks
                |    (FAIL-CLOSED, ALWAYS)   |  strips LLM-supplied patient_id
                +-------------+--------------+
                              |
            shadow:           |          assist:
            do not execute    |          execute approved (read-only) via adapters
                              v
                +----------------------------+
                |  tracing.emit              |  PHI-redacted JSON line
                +----------------------------+
                              |
                              v
              if assist:  prepend [AMINA_AGENTIC_CONTEXT] block to user message
              else:       leave kwargs untouched
                              |
                              v
        ORIGINAL process_message (LoRA / Groq / Gemini / OpenAI / safety stack runs here)
                              |
                              v
        attach trace metadata to result dict (non-breaking) and return
```

The wrapper is the **outermost** monkey-patch, so the chain becomes:

```
agentic_runtime_patch         (this -- outermost)
    └─ basic_beginner_chat_patch   (Basic/Beginner UX gate)
        └─ llm_provider_policy     (provider tracking + cascade)
            └─ guest_chat_patch    (guest-mode short-circuit)
                └─ AminaAgent.process_message  (UNCHANGED)
```

When `mode=off`, the patch's first line `return await _orig_process_message(...)` makes it a 0-µs pass-through.

---

## 2. Files in this package

```
src/agent_platform/
  __init__.py          -- public API surface
  config.py            -- env-driven config (AMINA_AGENTIC_*)
  models.py            -- typed dataclasses (no I/O)
  tool_schemas.py      -- JSON-shaped input/output schemas
  tool_registry.py     -- ToolSpec catalog + LLM schema export
  tool_policy.py       -- 13-check deterministic gate (FAIL-CLOSED)
  tool_executor.py     -- bounded async executor with timeouts
  planner.py           -- heuristic-first planner + optional LLM
  tracing.py           -- PHI-redacted trace emitter
  adapters.py          -- read-only bridges to existing orchestrator tools
  runtime.py           -- public maybe_run_agentic_prepass entrypoint

src/services/
  agentic_runtime_patch.py  -- monkey-patch wrapper installed at boot
```

---

## 3. Env vars (DEFAULTS = SAFE)

| Var | Default | Effect |
|---|---|---|
| `AMINA_AGENTIC_MODE` | `off` | `off` \| `shadow` \| `assist` \| `strict` |
| `AMINA_AGENTIC_MODES_ALLOWED` | `advanced` | Comma list of UI modes that can run the prepass |
| `AMINA_AGENTIC_MAX_TOOL_CALLS` | `3` | Hard cap (planner + policy) |
| `AMINA_AGENTIC_MAX_PLANNING_ROUNDS` | `1` | One planner round per turn — no re-planning loops |
| `AMINA_AGENTIC_TRACE_ENABLED` | `true` | Emit JSON trace lines via stdlib logger |
| `AMINA_AGENTIC_FAIL_OPEN` | `true` | On any prepass error, fall back to the original |
| `AMINA_AGENTIC_PROVIDER` | `auto` | LLM provider preference for the (optional) LLM planner |

**Operator note:** the default `AMINA_AGENTIC_MODES_ALLOWED=advanced` deliberately scopes to Advanced mode only. Even if you set `AMINA_AGENTIC_MODE=assist`, Basic/Beginner traffic is **NOT** affected until you explicitly add those modes to `AMINA_AGENTIC_MODES_ALLOWED`.

---

## 4. Modes — recommended staged rollout

### Stage 0 — `off` (default)
```
AMINA_AGENTIC_MODE=off
```
Zero behaviour change. Everything routes through existing AminaAgent identically to before this phase shipped. Verified by integration test 8.

### Stage 1 — `shadow`, advanced only
```
AMINA_AGENTIC_MODE=shadow
AMINA_AGENTIC_MODES_ALLOWED=advanced
```
The planner runs, the policy gate evaluates every proposed tool call, the trace records what *would* have happened. Tools are NOT executed. The original AminaAgent reply is returned to the user verbatim.

**Run for 2-4 weeks.** Observe the trace JSON lines (look for the `AGENT_TRACE` log prefix). Validate:
- Plan intent distribution looks reasonable (no surprise category)
- Policy gate denial reasons are clean (no false `mode_not_allowed` / `auth_required` storms)
- Latency overhead < 50ms per turn (planner heuristic is ~µs; LLM planner if used is ~200ms)

### Stage 2 — `assist`, advanced only
```
AMINA_AGENTIC_MODE=assist
AMINA_AGENTIC_MODES_ALLOWED=advanced
```
Approved read-only tools execute. Their `safe_summary` outputs are concatenated into a `[AMINA_AGENTIC_CONTEXT]` block prepended to the user message. The LoRA / Groq / Gemini cascade then generates the response **with** that context. The existing safety stack (medication gate, safety_consensus, topic_anchor, etc.) **still runs after generation** — assist enriches input, never bypasses output validation.

**Run for 2-4 weeks.** Validate:
- Response quality measurably improves on patient-context queries ("my BP", "my care plan")
- No hallucination uplift from the injected context (compare with Stage 1 shadow traces)
- Tool-execution latency is bounded (default 5s timeout per tool, parallelised via asyncio.gather)

### Stage 3 — expand to `basic`, then `beginner`
```
AMINA_AGENTIC_MODE=assist
AMINA_AGENTIC_MODES_ALLOWED=advanced,basic
# ... later:
AMINA_AGENTIC_MODES_ALLOWED=advanced,basic,beginner
```
Only after Stage 2 metrics support it. The Basic/Beginner deterministic UX gate already runs **before** us, so simple greetings / vague tokens / personal-record requests never reach the agentic layer.

### Rollback
```
AMINA_AGENTIC_MODE=off
```
Zero downtime. The next request after the env var change reverts to pure original-AminaAgent behaviour.

---

## 5. The 13 policy gate checks (FAIL-CLOSED)

Every proposed tool call passes `PolicyGate.evaluate_one()`. ALL must pass; any failure → `PolicyDecision(allowed=False)`. If the gate code itself raises, the call is **denied** (never let the LLM bypass policy by tickling an exception).

1. Tool name exists in registry.
2. Risk class ∈ `V1_ALLOWED_RISKS = {safe_read_only, read_only_clinical, clinical_advice_support}`.
3. `side_effecting` is `False`.
4. UI mode (`advanced` / `basic` / `beginner`) ∈ tool's `allowed_modes`.
5. Role (`patient` / `family` / `vhw` / `chn` / `admin` / `guest`) ∈ tool's `allowed_roles`.
6. Auth present if `tool.requires_auth=True`.
7. Emergency rules: if `request.is_emergency`, only `emergency_allowed=True` tools pass.
8. Arguments validate against `input_schema` (type / min / max / enum / max_length).
9. `patient_id` (and other `injected: True` fields) come from server session — any LLM-supplied value is **stripped + replaced** with the request-context value.
10. `patient_id` in the redacted args must equal `request.patient_id` (cross-account access blocked).
11. `approved_so_far < max_tool_calls_per_turn` (default 3).
12-13. Covered by check (2) — `admin_only`, `write_patient_record`, `external_side_effect`, `forbidden_patient_facing` all fall outside `V1_ALLOWED_RISKS` and are denied.

---

## 6. Tools available in v1

| Tool | Risk | Auth required? | Mode |
|---|---|---|---|
| `get_patient_profile` | read_only_clinical | yes | all |
| `get_recent_vitals` | read_only_clinical | yes | all |
| `get_care_plan` | read_only_clinical | yes | all |
| `get_medications` | read_only_clinical | yes | all |
| `get_followups` | read_only_clinical | yes | all |
| `retrieve_who_protocol` | safe_read_only | no | all |
| `retrieve_ncd_knowledge` | safe_read_only | no | all |
| `calculate_cvd_risk` | clinical_advice_support | yes | all |
| `assess_triage` | clinical_advice_support | no | all |
| `check_emergency` | clinical_advice_support | no (emergency_allowed) | all |
| `get_diet_advice` | clinical_advice_support | no | all |
| `check_ramadan` | clinical_advice_support | yes | all |
| `cultural_context` | safe_read_only | no | all |
| `suggest_community_support` | safe_read_only | no | all |
| `find_facility` | safe_read_only | no | all |

**Registered for shadow comparison + future phases — but DENIED for execution in v1:**

| Tool | Risk | Why denied in v1 |
|---|---|---|
| `record_vitals` | write_patient_record | side-effecting / mutation |
| `create_referral` | external_side_effect | side-effecting / mutation |
| `send_sms` | external_side_effect | side-effecting / external |
| `admin_lookup_patient` | admin_only | role-restricted, not patient-facing |

---

## 7. Tracing — PHI-redacted by construction

`tracing.emit(trace)` writes one JSON line per turn at INFO level via the stdlib logger. Sample:

```
AGENT_TRACE {"trace_id":"abc1234","session_hash":"7b9f0a2c1d","mode":"advanced","agentic_mode":"shadow","channel":"web","domain_hint":"vitals_bp","planner_used":true,"plan_intent":"heuristic_match","tool_decisions":[{"tool_name":"get_recent_vitals","allowed":true,"reason":"ok","risk":"read_only_clinical"},{"tool_name":"retrieve_who_protocol","allowed":true,"reason":"ok","risk":"safe_read_only"}],"tool_results":[],"provider":"","fallback_used":false,"safety_flags":[],"latency_ms":1.7,"error":null,"timestamp":"2026-04-27T10:11:12"}
```

**NEVER includes:**
- raw user message
- phone number
- patient name
- full patient_id (only `session_hash` / `patient_hash` — sha256[:10])
- access tokens / app secrets
- full tool outputs (only `safe_summary` strings)

The `to_safe_dict()` method in `models.py:AgentTrace` is the only sanctioned path; the test suite asserts these fields are absent.

---

## 8. How to enable / observe / rollback

### Enable shadow mode
```bash
# In your env (host) BEFORE recreating the container:
export AMINA_AGENTIC_MODE=shadow
export AMINA_AGENTIC_MODES_ALLOWED=advanced

cd haystack-stack
docker compose up -d --force-recreate haystack-chatqna
```

### Observe traces
```bash
docker logs -f haystack-chatqna | grep AGENT_TRACE
# or pipe to jq for structured viewing:
docker logs -f haystack-chatqna 2>&1 | grep --line-buffered AGENT_TRACE | sed 's/^.*AGENT_TRACE //' | jq .
```

### Promote to assist (advanced only)
```bash
export AMINA_AGENTIC_MODE=assist
docker compose up -d --force-recreate haystack-chatqna
```

### Rollback
```bash
export AMINA_AGENTIC_MODE=off
docker compose up -d --force-recreate haystack-chatqna
```

`AMINA_AGENTIC_FAIL_OPEN=true` (default) means even a runtime crash is invisible to users — the wrapper catches and falls through to the original.

---

## 9. Validation results (shipped 2026-04-27)

| Suite | Cases | Result |
|---|---|---|
| `_agent_platform_v1_test.py` (this phase) | 149 | **149 / 149 passed** |
| `_basic_beginner_router_test.py` (regression) | 104 | **104 / 104 passed** |
| `_meta_shared_pipeline_test.py` (regression) | 45 | **45 / 45 passed** |
| `_policy_review_test.py` (regression) | 55 | **55 / 55 passed** |
| Live `mode=off` parity check | 1 | **No `agentic_*` keys in response, no agentic headers** |

`py_compile` clean on all 12 new files. Boot logs show the patch installs across all 4 uvicorn workers.

---

## 10. Non-goals — explicitly NOT implemented in v1

- Autonomous multi-step / recursive planner
- LangGraph / LangChain dependency
- Native provider function-calling (Phase 2)
- Browser automation / web tool
- Code interpreter for patient chat
- Write tools executing (registered, denied by policy)
- External messaging (SMS, WhatsApp send)
- Medication / care-plan / vitals mutation
- Referral creation
- OpenTelemetry spans (Phase 3)
- Eval harness with golden scenarios (Phase 7)
- Frontend UI changes
- Telegram / Meta channel changes
- Basic/Beginner router rewrite

---

## 11. Roadmap (post-v1)

| Phase | What |
|---|---|
| 2 | Native provider function-calling (OpenAI / Gemini / Groq) — the LLM proposes tool calls in JSON via the providers' tool-use APIs |
| 3 | OpenTelemetry spans replacing the current JSON log line |
| 4 | Read-only production rollout (assist mode for `advanced,basic,beginner`) |
| 5 | Confirmation-gated write tools (record_vitals, create_referral) — every write requires explicit user confirmation surfaced to the UI |
| 6 | Sandboxed tool execution for admin / eval jobs only (never patient-facing) |
| 7 | Eval harness with 300+ golden scenarios — replays through assist mode and scores against held-out clinical truth |

---

## 12. Acceptance criteria — verified

1. ✅ `AMINA_AGENTIC_MODE=off` → ZERO behaviour change (test 8 + live round-trip confirmed)
2. ✅ Agent Platform v1 lives in a separate package (`src/agent_platform/`)
3. ✅ Planner cannot execute tools (`planner.plan` returns `AgenticPlan`; only the executor runs anything)
4. ✅ Policy gate is mandatory (every call goes through `evaluate_plan` before the executor sees it)
5. ✅ Only read-only tools execute in v1 (`V1_ALLOWED_RISKS` enforces this; tests prove write/admin/external denied)
6. ✅ Traces are PHI-redacted (test 7 asserts no `phone`, `patient_name`, `patient_id`, `message`, `raw` fields)
7. ✅ Shadow mode never alters the original response (test 6b)
8. ✅ Assist mode injects `[AMINA_AGENTIC_CONTEXT]` and the existing safety stack still runs (wrapper does not bypass `process_message`)
9. ✅ All new tests pass (149/149)
10. ✅ Existing tests pass (204/204 across 3 suites)
11. ✅ App boots correctly with `mode=off` (default)
12. ✅ App boots correctly even if the patch import fails (try/except in `main_with_rag_tuning.py`)
