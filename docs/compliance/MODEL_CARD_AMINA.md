# AMINA — Model / System Card

**Audience:** clinical reviewer, ML reviewer, ministry liaison.
**Scope:** the composite AMINA system, not a single model. Individual model providers have their own cards.

---

## 1. System description

AMINA is a multi-model NCD support assistant with deterministic safety guardrails. It does NOT depend on a single LLM. It composes an LLM cascade with deterministic policy gates, a heuristic planner, an opt-in agentic prepass, retrieval-augmented generation (RAG), STT/TTS, and channel adapters.

## 2. LLM cascade (in default order)

| Tier | Provider / model | Role |
|---|---|---|
| 1 | **AMINA Mistral (LoRA fine-tuned, vLLM)** when up | clinical-tone NCD answers in EN+MA |
| 2 | **Mistral cloud (`open-mistral-7b`)** | OpenAI-compatible fallback |
| 3 | **Groq (mixtral / llama)** | low-latency fallback |
| 4 | **Gemini** | additional fallback |
| 5 | **OpenAI (`gpt-4o-mini` default)** | safety-net fallback |

Cascade behaviour controlled by `LLM_FALLBACK_CHAIN` and `LLM_FALLBACK_MODE`. With `mode=warn`, a tier failure is logged and the next tier runs; with `mode=strict`, the user sees an explicit error.

## 3. Local LoRA role

- LoRA fine-tune is the AMINA-style answer specialist. Trained on curated conversation pairs for hypertension / diabetes / asthma / COPD / CVD-risk / Mandinka.
- Most recent training run: 414 steps over 3 epochs, final loss ≈ 1.72, clean adapter export ([adapter_model.safetensors](../../) on the training server).
- Hosted via vLLM behind Tailscale Funnel; reachable through `AMINA_MISTRAL_BASE_URL`. When the endpoint is down, cascade auto-falls-through.
- LoRA is currently set OFF for maintenance per `docker-compose.override.yml` line 92 — the cascade therefore starts at tier 2 (Mistral cloud) until the LoRA endpoint is healthy.

## 4. Supported languages + known limitations

| Language | Status | Known issues |
|---|---|---|
| English | full | none specific to AMINA |
| Mandinka | beta | latent-space coverage thinner than English; periodic regression checks needed; emergency keyword list bilingual but operator must extend with local dialect |
| Other Gambian languages (Pulaar, Wolof, Jola, Serer) | not supported | will fall back to English answer with a "switch language" suggestion |

## 5. Intended users + roles

See [CLINICAL_SAFETY_CASE.md §1](CLINICAL_SAFETY_CASE.md#1-intended-use). Roles: `patient`, `family`, `vhw`, `chn`, `admin`, `guest`. Each role has a tool allow-list enforced by `agent_platform/tool_policy.py`.

## 6. Safety guardrails

- **Heuristic-first planner**: emergencies short-circuit the LLM entirely.
- **13-check policy gate**: every proposed tool call passes a deterministic gate before execution.
- **Read-only-only execution in v1**: write/admin/external tools are registered for shadow comparison but DENIED at execution.
- **PHI de-identification** before LLM round-trip ([phi_deid.py](../../haystack-stack/haystack-chatqna/src/services/phi_deid.py)).
- **Multi-model safety consensus** on ambiguous content ([safety_consensus.py](../../haystack-stack/haystack-chatqna/src/services/safety_consensus.py)).
- **Post-generation safety contract** ([safety_contract.py](../../haystack-stack/haystack-chatqna/src/services/safety_contract.py)).
- **Topic anchor + drift control** for safety-critical topics.
- **Refusal patterns** for medication-dose-change, diagnosis, mental-health crisis intervention.
- **PHI-redacted tracing**: `AgentTrace.to_safe_dict()` red-team-tested across 19 PHI fields.

## 7. Evaluation status

| Suite | Cases | Result |
|---|---|---|
| `_agent_platform_v1_test.py` | 149 | 149 / 149 ✓ |
| `_agent_platform_v2_native_tools_test.py` | 200 | 200 / 200 ✓ |
| `_agent_platform_phase3_safety_test.py` | 157 | 157 / 157 ✓ |
| `scripts/agent_platform_phase3_smoke.py` | 25 | 25 / 25 ✓ |
| Live-shadow validation (Phase 4) | 2 turns | both HTTP 200; native path fired in turn 2; 0 PHI leaks |

Outstanding evals (Phase 4-roadmap):
- A 300+ scenario clinical-content eval (currently aspirational; partial coverage in `evidence_layer/eval_cases.py`).
- A live A/B comparing assist-mode answer quality vs shadow baseline.
- A Mandinka-only eval suite with native-speaker review.

## 8. Bias / fairness considerations

- **Language**: EN → MA degradation risk (see §4).
- **Literacy**: Beginner / Basic / Advanced UX modes designed to absorb literacy variance; literacy-mode flag set per session ([literacy_routes.py](../../haystack-stack/haystack-chatqna/src/api/literacy_routes.py)).
- **Region**: care-plan + facility-finder defaults assume Gambia administrative regions. Other geographies require config.
- **Gender**: clinical defaults match WHO PEN; specific gender-affirming care is not in scope for v1.
- **Age**: no children under 13 (see [PRIVACY_NOTICE.md §8](PRIVACY_NOTICE.md#8-children)).
- **Disability**: voice + text + multichannel mitigates many accessibility gaps; screen-reader compatibility on the web frontend has not been formally audited.

## 9. Monitoring plan

| Signal | Source | Cadence |
|---|---|---|
| `AGENT_TRACE` line per turn | stdout logs | continuous |
| Evidence-layer eval reports | `evidence_reports/` (opt-in) | per session when enabled |
| LLM-provider error rate | per-call exceptions in `llm_provider_policy.py` | continuous |
| Safety-consensus disagreement rate | service log | weekly |
| Triage distribution by region / language | observatory dashboard | monthly |
| Caregiver-alert false-positive / false-negative | manual review | monthly |
| Native function-calling fallback reasons | `AGENT_TRACE.native_fallback_reason` | continuous |

## 10. Versioning + change control

- **System version**: tracked by git commit + the four phase docs (v1 / v2 / Phase3 / Phase4).
- **Model versions**: pinned via env (`OPENAI_MODEL`, `GEMINI_MODEL`, `MISTRAL_MODEL`, etc.) and visible in `agent_platform/readiness.py` snapshot.
- **Policy gate version**: stamped on every trace line as `policy_gate_version` (currently `v1.13`); bump on any change to the policy check set.
- **Tool registry version**: implicit in the registry file. Adding / removing a tool requires updating the v1 / v2 docs + corresponding tests.
- **Channel adapter version**: each adapter is versioned by its module path; breaking changes require a new adapter file (additive-only rule).

## 11. Linked controls

- MODEL-001 .. MODEL-008 in [COMPLIANCE_CONTROL_MATRIX.md](COMPLIANCE_CONTROL_MATRIX.md).
