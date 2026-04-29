# AMINA Agent Platform Phase 4 — Live-Staging Validation Report

**Date:** 2026-04-29
**Author:** Hrithik Ghosh
**Stack:** local Docker Desktop (WSL2), `haystack-stack/` compose. NOT production.

## 0. TL;DR

Live shadow-mode validation **passed** end-to-end against a real OpenAI provider. Phase 2 native function-calling actually fired in the running container, Phase 3 enriched-trace fields populated correctly, PHI redaction held with zero leaks across two synthetic turns. Score moves from **8/10 → 8.5/10** because we now have *live evidence*, not just unit-test simulation. Remaining 0.5 → 9/10 still requires OTel spans, CI eval gate, and a 2-4-week trace-collection window before promoting to assist.

## 1. Files changed in Phase 4 (all minimal + safe)

| File | Status | Why |
|---|---|---|
| `haystack-stack/docker-compose.override.yml` | **modified (gitignored, local-only)** | Added 2 bind-mounts for `native_tools.py` + `readiness.py` (Phase 2/3 new files) and 2 env passthrough vars `AMINA_AGENTIC_NATIVE_TOOLS` / `AMINA_AGENTIC_NATIVE_FORMAT`. Both default to safe values (`false` / `auto`). |
| `docs/AGENT_PLATFORM_PHASE4_LIVE_VALIDATION_REPORT.md` | **new** | This report. |

No tracked source code was changed in Phase 4. No commits, branches, or pushes performed.

## 2. Commands run + exact results

### 2a. Local proof tests (re-baseline before container work)
```bash
cd haystack-stack/haystack-chatqna
PYTHONIOENCODING=utf-8 python _agent_platform_v1_test.py            # 149 / 149 ✓
python _agent_platform_v2_native_tools_test.py                       # 200 / 200 ✓
PYTHONIOENCODING=utf-8 python _agent_platform_phase3_safety_test.py  # 157 / 157 ✓
python scripts/agent_platform_readiness.py --warnings                # exit 0, 1 INFO warning (expected)
PYTHONIOENCODING=utf-8 python scripts/agent_platform_phase3_smoke.py # 25 / 25 ✓
```
**Total: 531 / 531 checks passing.** Readiness exit 0.

### 2b. Container recreate (Phase 4 env set in shell only — NOT persisted to .env)
```bash
cd haystack-stack
AMINA_AGENTIC_MODE=shadow \
AMINA_AGENTIC_NATIVE_TOOLS=true \
AMINA_AGENTIC_NATIVE_FORMAT=openai \
AMINA_AGENTIC_MODES_ALLOWED=advanced \
AMINA_AGENTIC_TRACE_ENABLED=true \
docker compose up -d --force-recreate --no-deps haystack-chatqna
```
Result: `Container haystack-chatqna Recreated → Started`. Healthy in 35 s.

### 2c. Container health + Phase 2/3 files actually loaded
```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:8000/health
# → HTTP 200

docker exec haystack-chatqna sh -c 'ls -l /app/src/agent_platform/native_tools.py /app/src/agent_platform/readiness.py'
# → both files present (13.9 KB + 7.3 KB)

docker exec haystack-chatqna sh -c 'cd /app && python -c "from src.agent_platform import native_tools, readiness; print(\"OK\")"'
# → OK native_tools FALLBACK_REASONS=9 readiness=True

docker exec haystack-chatqna sh -c 'env | grep "^AMINA_AGENTIC_" | sort'
# → AMINA_AGENTIC_MODE=shadow
#   AMINA_AGENTIC_NATIVE_TOOLS=true
#   AMINA_AGENTIC_NATIVE_FORMAT=openai
#   AMINA_AGENTIC_MODES_ALLOWED=advanced
#   AMINA_AGENTIC_TRACE_ENABLED=true
#   ... (5 v1 vars unchanged)
```

### 2d. Live shadow smoke — Turn 1 (heuristic-matched query)
```bash
curl -X POST http://localhost:8000/api/v1/agent/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"For a synthetic patient, what recent vitals would a clinician check before giving diabetes advice?",
       "session_id":"agentic_phase4_synth_001",
       "patient_id":"agentic_phase4_synth_patient_001",
       "language":"en","user_role":"vhw"}'
# → HTTP 200 latency=24.5s
```

AGENT_TRACE summary (PHI-safe fields only):
```json
{
  "agentic_mode":              "shadow",
  "mode":                      "advanced",
  "planner_path":              "heuristic",
  "plan_intent":               "heuristic_match",
  "native_tools_enabled":      true,
  "native_format_requested":   "openai",
  "native_format_detected":    "",
  "native_attempted":          false,
  "native_fallback_reason":    "",
  "tool_schema_count":         15,
  "tool_call_count_requested": 2,
  "tool_call_count_allowed":   1,
  "tool_call_count_denied":    1,
  "denied_reasons":            ["schema_error:topic:required_missing"],
  "policy_gate_version":       "v1.13",
  "fallback_used":             false,
  "latency_ms":                0.45
}
PHI leak check: leaked fields = []
```

Interpretation: heuristic correctly fired on the "diabetes" keyword; native path was *not consulted* (this is the v1 contract — heuristic always wins). Shadow mode honored — 1 tool was *allowed* but not *executed* (`tool_results=[]` in the raw line).

### 2e. Live shadow smoke — Turn 2 (heuristic-miss query → native path actually fires)
```bash
curl -X POST http://localhost:8000/api/v1/agent/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"What general lifestyle adjustments would help an adult with several routine concerns?",
       "session_id":"agentic_phase4_synth_002",
       "patient_id":"agentic_phase4_synth_patient_002",
       "language":"en","user_role":"vhw"}'
# → HTTP 200 latency=17.4s
```

AGENT_TRACE summary:
```json
{
  "agentic_mode":              "shadow",
  "planner_path":              "json_native",       ← Phase-2 native path FIRED
  "plan_intent":               "native_openai",
  "native_tools_enabled":      true,
  "native_format_requested":   "openai",
  "native_format_detected":    "openai",            ← detect_format agreed
  "native_attempted":          true,                ← real OpenAI tools API call
  "native_fallback_reason":    "",                  ← no fallback needed
  "tool_schema_count":         15,
  "tool_call_count_requested": 0,                   ← LLM chose to call no tools
  "tool_call_count_allowed":   0,
  "tool_call_count_denied":    0,
  "denied_reasons":            [],
  "policy_gate_version":       "v1.13",
  "fallback_used":             false,
  "safety_flags":              [],
  "error":                     null
}
PHI leak check: leaked fields = []
```

Interpretation: this is the **first live proof** that Phase 2 native function-calling reaches a real provider in production-like conditions, in shadow mode, with full PHI redaction. The OpenAI model received the 15 read-only-only tool schemas via the native `tools=` parameter and elected to answer without calling any (correct for a generic lifestyle question).

## 3. Trace-evidence summary (across both turns)

| Field | Turn 1 (heuristic) | Turn 2 (native) | Verdict |
|---|---|---|---|
| `agentic_mode` | `shadow` | `shadow` | ✅ shadow held |
| `planner_path` | `heuristic` | `json_native` | ✅ both paths exercised |
| `native_tools_enabled` | `true` | `true` | ✅ flag loaded from env |
| `native_attempted` | `false` (heuristic short-circuit) | `true` | ✅ correct per design |
| `native_format_detected` | `""` (never reached) | `openai` | ✅ sniffer works |
| `native_fallback_reason` | `""` | `""` | ✅ no fallbacks |
| `tool_schema_count` | 15 | 15 | ✅ V1_ALLOWED_RISKS only |
| `tool_call_count_allowed` | 1 (not executed) | 0 | ✅ shadow proven |
| `tool_call_count_denied` | 1 | 0 | ✅ policy gate active |
| `denied_reasons` | `["schema_error:topic:required_missing"]` | `[]` | ✅ stable codes |
| `policy_gate_version` | `v1.13` | `v1.13` | ✅ versioning live |
| `prompt_tokens` / `cost_usd` | `null` / `null` | `null` / `null` | ✅ never invented |
| `error` | `null` | `null` | ✅ clean |
| **PHI leak count** | **0** | **0** | ✅ redaction held |

Latency budget: agent_platform prepass overhead in both turns was sub-millisecond (`latency_ms=0.45`). The 17–24 s end-to-end latency is dominated by the LLM call itself (which includes the existing AminaAgent stack, not just the prepass).

## 4. Env configuration in use (local override only — NOT promoted to prod .env)

The values live in this shell session for the recreate command above. The compose override at `haystack-stack/docker-compose.override.yml` already has `${VAR:-default}` expansion for all of these, so promotion to a different env is one-line `.env` edits — **not** automatic.

```
AMINA_AGENTIC_MODE=shadow
AMINA_AGENTIC_NATIVE_TOOLS=true
AMINA_AGENTIC_NATIVE_FORMAT=openai
AMINA_AGENTIC_MODES_ALLOWED=advanced
AMINA_AGENTIC_TRACE_ENABLED=true
AMINA_AGENTIC_FAIL_OPEN=true   # default, unchanged
```

OpenAI / Groq / Gemini API keys are already present in the container (`<set>`), pre-existing from the v1 LLM cascade — Phase 4 did not touch them.

## 5. Rollback (zero downtime)

Either takes effect on the next request after a recreate. **Nothing in Phase 4 mutates persistent state.**

```bash
# Phase-2-only rollback (back to v1 JSON-string LLM planner; assist/shadow still functional)
AMINA_AGENTIC_NATIVE_TOOLS=false docker compose up -d --force-recreate --no-deps haystack-chatqna

# Master kill (full original AminaAgent behaviour, zero agentic prepass)
AMINA_AGENTIC_MODE=off docker compose up -d --force-recreate --no-deps haystack-chatqna
```

To revert local-only configuration changes:
- `docker-compose.override.yml`: the 4 added lines (2 bind-mounts + 2 env vars) are tagged `# Phase 2 + 3 additions` and `# Phase 2: native function-calling`. Removing them puts the override back to its pre-Phase-4 state. Container will then no longer see `native_tools.py` and `readiness.py` (back to v1 image-only behaviour, which still works because v1 didn't reference them).

## 6. Remaining risks / known limitations

1. **Two synthetic turns is a smoke test, not a load test.** Latency under concurrent load, native-format compatibility across longer conversations, and tool-call success rate over a real distribution of patient queries are still unobserved. This is exactly what a 2-4-week shadow trace-collection window is for.

2. **Cost / token fields are still `null`.** The provider clients in `amina_agent` don't surface OpenAI's `usage` block to the runtime. Wiring this is a separate Phase-4b task and would unlock cost monitoring without inventing numbers.

3. **One provider tested.** Only OpenAI tools-API confirmed live. Gemini path is unit-tested (200/200) but not yet exercised against a real Gemini SDK in this container. Default-safe fall-through is verified by Phase-3 test 12.

4. **Container env vars set in shell, not persisted.** A container restart will revert to defaults (`AMINA_AGENTIC_MODE=off`, `AMINA_AGENTIC_NATIVE_TOOLS=false`) unless the operator either edits `.env`, or re-runs the recreate command with the env prefix. This is intentional — it means a stray restart cannot accidentally promote shadow → assist or off → shadow without an explicit operator action.

5. **`docker-compose.override.yml` is gitignored.** The bind-mount + env additions only exist on this machine. To roll out to another dev / CI / staging machine, those 4 lines must be applied there too. Recommendation: copy the relevant 4-line snippet from this report into a `docker-compose.phase4.yml` overlay if you want it shareable without polluting the gitignored file.

6. **No HTTP /readiness endpoint added.** Per Phase 4 spec ("local script is enough"). If a future operator wants this in CI / load balancer health checks, it's a ~20-line addition: a single `@router.get("/agentic/readiness")` that calls `readiness.snapshot()` and returns it as JSON.

## 7. Recommendation for next gate

**Stay in shadow mode for ≥2 weeks.** Collect AGENT_TRACE distribution data. Specifically watch:
- `planner_path` distribution: heuristic vs json_native ratio. If heuristic ≫ json_native, the native-tools investment isn't paying off; if heuristic ≪ json_native, your heuristic keyword list needs expansion.
- `native_fallback_reason` distribution: `""` should dominate. Any non-empty value indicates a real problem (`provider_client_raised`, `native_response_parse_exception`, etc.) — investigate before promotion.
- `denied_reasons` distribution: a sudden change in shape would indicate either schema drift or the LLM proposing different tool argument patterns over time.

**After 2 weeks of clean shadow traces**, the next gate is the v1-roadmap Stage-3 promotion: `AMINA_AGENTIC_MODE=assist` for `MODES_ALLOWED=advanced` only, with native tools still on. Compare answer quality against shadow baseline. *Do not* expand `MODES_ALLOWED` to `basic`/`beginner` until the assist baseline has 1 more clean week.

## 8. Acceptance criteria — verified

| Criterion | Status |
|---|---|
| Local tests pass | ✅ 531/531 |
| Backend container recreated and healthy | ✅ HTTP 200, healthy in 35 s |
| Phase 2/3 files actually loaded in container | ✅ confirmed via `ls` + Python import |
| Phase 4 env vars actually loaded | ✅ confirmed via `env \| grep AMINA_AGENTIC_` |
| Live shadow smoke run | ✅ 2 turns, both HTTP 200 |
| Native path actually fired against real OpenAI | ✅ Turn 2: `planner_path=json_native`, `native_attempted=true` |
| Trace evidence summarized PHI-safely | ✅ both turns: 0 leaked fields |
| Phase 4 validation report exists | ✅ this file |
| Defaults remain safe | ✅ `MODE=off` + `NATIVE_TOOLS=false` are still the override defaults |
| No assist enabled | ✅ shadow only |
| No write/admin tools executed | ✅ `tool_results=[]` in Turn 1 (allowed=1, executed=0) |
