# AMINA Agent Platform Phase 3 — Rollout, Observability, Red-Team Evals

**Status:** landed (additive on top of Phase 1 + Phase 2). **Default flags unchanged — zero behaviour change at install.**
**Depends on:** v1 (`AGENT_PLATFORM_V1.md`) + v2 (`AGENT_PLATFORM_V2_READONLY_ASSIST.md`).

---

## 0. What Phase 3 adds (and what it deliberately does NOT add)

| It adds | It does NOT add |
|---|---|
| **Enriched, PHI-safe trace fields** so a single trace line answers "was native tools meant to be on, did it fire, what fell back, and why?" | Any new mode. off / shadow / assist / strict from v1 are unchanged. |
| **A red-team safety test suite** (157 checks) covering write/admin/external misuse, ID overrides, malformed payloads, empty/dup registry, mixed valid/invalid calls. | New tools. The registry is unchanged. |
| **A readiness module + CLI** that snapshots config, registry, and risky-config warnings before a flag flip. | Live provider integration. All Phase 3 tooling is in-process or stub-driven. |
| **A smoke harness** that exercises every flag combination locally with synthetic IDs only. | A guarantee that LLM behaviour is correct in production — that requires a live staging test, which is `Path to 9/10 → live provider test`. |
| **Native-tools hardening**: explicit override now beats class-name sniff; bad/garbage overrides do NOT silently fall through; duplicate names dedupe; missing/non-dict parameters handled. | Anthropic / Bedrock / Ollama native tools. Out of scope per spec. |

**Critical safety guarantees (still): zero relaxation from v1/v2.**
- `V1_ALLOWED_RISKS` filter still removes write/admin/external tools before they reach the LLM.
- Deterministic policy gate still runs on every proposed call.
- `injected: True` schema fields still stripped before LLM exposure.
- `AMINA_AGENTIC_MODE=off` is still the master kill switch.
- `AMINA_AGENTIC_NATIVE_TOOLS=false` is still the Phase-2-specific kill switch.

---

## 1. Files added / modified in Phase 3

### New (purely additive)

| File | Purpose |
|---|---|
| `src/agent_platform/readiness.py` | Pure helper. `snapshot()` returns config + registry + native + warnings dict. |
| `scripts/agent_platform_readiness.py` | CLI wrapper around `readiness.snapshot()`. JSON + warnings output. Exit 0 unless an `error`-severity warning is present. |
| `scripts/agent_platform_phase3_smoke.py` | In-process smoke harness — 8 cases, 25 checks. Exercises every flag combo with synthetic IDs only; no live LLM. |
| `_agent_platform_phase3_safety_test.py` | 19 sections, 157 checks. Red-team coverage of native-tool misuse, trace PHI redaction, policy-gate authority, native-tools hardening edge cases. |
| `docs/AGENT_PLATFORM_PHASE3_ROLLOUT_AND_EVALS.md` | This document. |

### Modified (additive only — no v1/v2 logic altered)

| File | Diff | Why safe |
|---|---|---|
| `src/agent_platform/models.py` | Added Phase-3 fields to `AgentTrace` (all `Optional` / safe defaults); `to_safe_dict()` emits them. Added `POLICY_GATE_VERSION` constant. | Existing v1/v2 trace assertions (no `phone`/`patient_name`/`patient_id`/`message`/`raw` fields) are preserved — `to_safe_dict()` adds only safe primitives + lists of strings. |
| `src/agent_platform/runtime.py` | Populates the new trace fields during `_run`. No change to existing fields' values. | Only ADDS work in the same code path; the prepass result returned to callers is identical to v1/v2. |
| `src/agent_platform/planner.py` | `_try_native_tool_call` now logs unrecognised-format overrides at INFO and short-circuits empty payloads (no wasted roundtrip). | All paths still return `None` on any error; caller's fallback chain is unchanged. |
| `src/agent_platform/native_tools.py` | `detect_format` no longer silently sniffs after a garbage explicit override. `to_provider_neutral` dedupes duplicates and tolerates missing/non-dict parameters. Added `FALLBACK_REASONS` dict. | Stricter only in safe directions (refuse to assume); no breakage for valid inputs — verified by 200/200 v2 + 157/157 Phase-3 tests. |

---

## 2. Enriched trace fields

Every prepass turn now emits these alongside the v1/v2 fields. All are PHI-safe by construction.

| Field | Type | Meaning |
|---|---|---|
| `native_tools_enabled` | bool | Snapshot of `AMINA_AGENTIC_NATIVE_TOOLS` at turn-start. |
| `native_format_requested` | str | Operator's requested format (`""`, `"auto"`, `"openai"`, `"gemini"`). |
| `native_format_detected` | str | What `detect_format` resolved to (`"openai"`, `"gemini"`, or `""` if not attempted). |
| `native_attempted` | bool | True if the planner actually called the native path. |
| `native_fallback_reason` | str | Stable code from `native_tools.FALLBACK_REASONS` (`""` on success). |
| `tool_schema_count` | int | How many V1_ALLOWED_RISKS schemas were exposed to the LLM. |
| `tool_call_count_requested` | int | Total tool calls the planner proposed. |
| `tool_call_count_allowed` | int | After the policy gate. |
| `tool_call_count_denied` | int | After the policy gate. |
| `denied_reasons` | List[str] | Stable codes (`auth_required`, `mode_not_allowed`, ...). No human freeform text. |
| `policy_gate_version` | str | Bump-on-change version (`"v1.13"` today). |
| `planner_path` | str | One of `heuristic` / `json_native` / `json_string` / `fallback` / `unknown`. |
| `prompt_tokens` | int \| None | **None when upstream provider didn't surface — never invented.** |
| `completion_tokens` | int \| None | Same. |
| `cost_usd` | float \| None | Same. |

### Forbidden in trace (verified by tests)
- raw user message
- raw assistant answer
- phone number
- patient_id
- session_id (only `session_hash` / `patient_hash` — sha256[:10])
- access tokens, authorization headers, API keys
- full tool outputs (only `safe_summary` strings via the existing v1 path)

---

## 3. How to run everything

```bash
cd haystack-stack/haystack-chatqna

# Test suites (no real provider calls):
python _agent_platform_v1_test.py                              # 149 cases
python _agent_platform_v2_native_tools_test.py                 # 200 cases
python _agent_platform_phase3_safety_test.py                   # 157 cases
# Total: 506 cases.

# Operator tools:
python scripts/agent_platform_readiness.py                     # full snapshot + warnings
python scripts/agent_platform_readiness.py --warnings          # warnings only
python scripts/agent_platform_readiness.py --json              # JSON only (CI parsing)
python scripts/agent_platform_phase3_smoke.py                  # 8-case in-process smoke
python scripts/agent_platform_phase3_smoke.py --json           # smoke + structured event log

# Windows-specific (only if cp1252 console hits the v1 unicode arrows):
$env:PYTHONIOENCODING="utf-8"; python _agent_platform_v1_test.py
```

---

## 4. Recommended staged rollout

### Stage 0 — `off` baseline (default)

```
AMINA_AGENTIC_MODE=off
AMINA_AGENTIC_NATIVE_TOOLS=false
```

Zero change. `python scripts/agent_platform_readiness.py` should print `ok=true` with only the `WRITE_TOOLS_REGISTERED` info-severity reminder.

### Stage 1 — `shadow`, native tools disabled, advanced only

```
AMINA_AGENTIC_MODE=shadow
AMINA_AGENTIC_MODES_ALLOWED=advanced
AMINA_AGENTIC_NATIVE_TOOLS=false
```

Run for **2 weeks minimum**. Observe `AGENT_TRACE` log lines. Validate:
- `planner_path=heuristic` dominates; `json_string` only for non-keyword queries.
- `tool_call_count_allowed + tool_call_count_denied == tool_call_count_requested` (sanity).
- `denied_reasons` distribution looks reasonable (no `auth_required` storms).

### Stage 2 — `shadow`, native tools enabled, explicit format

```
AMINA_AGENTIC_MODE=shadow
AMINA_AGENTIC_MODES_ALLOWED=advanced
AMINA_AGENTIC_NATIVE_TOOLS=true
AMINA_AGENTIC_NATIVE_FORMAT=openai     # explicit, not "auto"
```

Run for **1 week minimum**. Validate from traces:
- `native_attempted=true` whenever the heuristic doesn't match.
- `native_fallback_reason=""` for ≥95% of native attempts.
- `tool_call_count_allowed` and `denied_reasons` distributions identical to Stage 1 within noise.

### Stage 3 — `assist`, advanced only

```
AMINA_AGENTIC_MODE=assist
AMINA_AGENTIC_MODES_ALLOWED=advanced
AMINA_AGENTIC_NATIVE_TOOLS=true
AMINA_AGENTIC_NATIVE_FORMAT=openai
```

Run for **2 weeks minimum**. Compare answer quality against Stage 1 (where the same tools were proposed but never executed). Look for:
- No new `medication_safety_block` / `safety_consensus` denials downstream — assist enriches input, never bypasses output validation.
- Latency overhead per turn < 200 ms p95.

### Stage 4 — Wider modes (only after Stage 3 proves out)

```
AMINA_AGENTIC_MODES_ALLOWED=advanced,basic       # eventually:
AMINA_AGENTIC_MODES_ALLOWED=advanced,basic,beginner
```

Basic/Beginner deterministic UX gate runs **before** the agentic layer, so this expansion is mostly cosmetic — it just unlocks the prepass for the rare advanced-shaped queries that slip through the Basic router.

---

## 5. Rollback

Two independent kill switches; either takes effect on the next request after a recreate. **Nothing in Phase 3 mutates persistent state**, so there is nothing else to undo.

| Switch | Effect |
|---|---|
| `AMINA_AGENTIC_NATIVE_TOOLS=false` | Disables Phase-2 native tools only. v1 JSON-string LLM planner resumes. Use when traces show native-format issues. |
| `AMINA_AGENTIC_MODE=off` | Disables the entire agent platform. Pure original-AminaAgent behaviour. Master kill. |

---

## 6. Safety boundaries — what Phase 3 (and earlier) cannot do

- Execute any non-`V1_ALLOWED_RISKS` tool. The schema filter blocks them at the LLM-exposure step; the policy gate denies them as a second layer.
- Mutate any patient record (no write tools wired).
- Send any external message (SMS / WhatsApp / Telegram) — no executors registered.
- Run autonomous multi-step loops — `max_planning_rounds=1`, `allow_recursive_tool_calls=False`.
- Surface raw PHI in any trace, prepass result attribute, or assist context block — verified by the 19 PHI-redaction checks in the Phase-3 suite.
- Surface invented token counts or costs — `prompt_tokens`/`completion_tokens`/`cost_usd` are `None` when unknown, never fabricated.

---

## 7. Evidence required to rate Phase 3 ≥ 8/10

| Area | Evidence | Status |
|---|---|---|
| Agentic platform features | 506/506 tests + 25/25 smoke pass with default-safe install | ✅ landed |
| Tool schemas / function-calling | OpenAI + Gemini adapters tested across enums + nested objects + dupes + empty registry | ✅ landed |
| Safety gating | 157-case red-team suite covering misuse vectors above | ✅ landed |
| Tracing / debuggability | 14 enriched fields, all PHI-safe, all populated by runtime | ✅ landed |
| Production readiness | Readiness CLI + 7 risky-config warnings + smoke harness + rollout doc | ✅ landed |

For the rating itself (which is operator judgement, not code), confirm:
1. `python scripts/agent_platform_readiness.py` returns exit 0 on the prod env with only known-safe warnings.
2. `python scripts/agent_platform_phase3_smoke.py` passes locally inside the production-bound container image (not just the host venv).
3. Stage 1 has run for ≥2 weeks with `denied_reasons` and `planner_path` distributions reviewed and signed off.

---

## 8. Path to 9/10 (deliberately deferred from Phase 3)

| Lever | Why it's a 9/10 lever |
|---|---|
| **OpenTelemetry spans** replacing the JSON log line | Lets traces correlate across services (frontend → gateway → haystack-chatqna → ArcadeDB) without ad-hoc grep. |
| **Live provider test in staging** | All Phase 3 tests stub the LLM. A 1-2-turn live OpenAI / Gemini / Groq test with `AMINA_AGENTIC_NATIVE_TOOLS=true` proves the wire format actually works against the real providers' current responses. |
| **Evals in CI** | The 506 tests run only when invoked. Wire `python _agent_platform_*_test.py` into the existing CI pipeline so a regression in agent_platform fails the build, not just `pytest`. |
| **Trace dashboard** | A 1-screen Grafana / Superset board over the AGENT_TRACE log fields would catch a bad rollout in minutes (denied_reason spike, native_fallback_reason spike). |
| **Confirmation-gated write tools for clinician/admin flows** | Promote `record_vitals` and `create_referral` from "registered, denied" to "registered, requires explicit per-call user confirmation". Patient chat would still NEVER touch them. This is Phase 5 in the v1 roadmap. |

---

## 9. Acceptance criteria — verified

1. ✅ v1 tests still pass (149/149).
2. ✅ v2 native-tools tests still pass (200/200).
3. ✅ Phase 3 safety/readiness tests pass (157/157).
4. ✅ Smoke harness passes (25/25) across all 8 flag combinations.
5. ✅ Native tools remain disabled by default (`AMINA_AGENTIC_NATIVE_TOOLS=false`).
6. ✅ Assist mode remains non-default (`AMINA_AGENTIC_MODE=off`).
7. ✅ No write/admin/external tools can execute (asserted across all 6 roles in v2 + denied across hand-rolled write/admin attempts in Phase 3).
8. ✅ Trace enrichment is PHI-redacted and tested (Phase 3 sections 1, 2, 19).
9. ✅ Smoke + readiness tooling present and exit-coded for CI.
10. ✅ Docs cover rollout, rollback, safety boundaries, and remaining-risk path to 9/10.
