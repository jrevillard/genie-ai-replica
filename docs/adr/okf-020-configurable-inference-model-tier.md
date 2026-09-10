# ADR okf-020: Configurable inference model tier (internal vLLM OR frontier API)

- **Status**: Proposed
- **Date**: 2026-08-12
- **Decision owners**: Genie.ai Dev (architect)

## Context

The AI-driven producer ([ADR-okf-019](okf-019-ai-driven-okf-producer.md)) and any future OKF Server inference need an LLM. Today the framework's inference is a **single sovereign path**: `ibm-granite/granite-4.1-8b` via vLLM (OpenAI-compatible), consumed by dataprep labeling/Contextual Retrieval and chat. The dataprep LLM surface funnels through one OpenAI-compatible chokepoint, `_build_vllm_client()` ([genieai_dataprep_arangodb.py:207](../../genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py)), and the retriever already has an env-gated hosted-OpenAI branch as precedent.

A product decision (2026-08-12) directs the producer's model tier to be **configurable per deployment**: internal granite-4.1-8b (vLLM, OpenAI-compatible) **or** a frontier model via API key, multi-provider — **Anthropic, xAI/Grok, Gemini, OpenAI** — with the default remaining internal/sovereign. The producer is Node-side (ADR-okf-019), so the abstraction's primary home is Node; `core/llm_provider.py` cannot be imported by it.

Two sovereignty/supply-chain constraints bind the design: NFR-S1 (air-gappable; no egress except declared sources) — a frontier API call is **egress by definition**; and NFR-S5 (blocking container scan + CycloneDX SBOM) — new provider SDKs enlarge the image and the supply-chain surface. Also, only the OpenAI-compatible wire shape is established in-repo: vLLM/OpenAI/xAI share `chat.completions.create` + `response_format={"type":"json_object"}`; **Anthropic and Gemini do not** (different SDK + message format; no native guided-JSON), so they require adapters or the producer's strict-JSON contract silently misfires.

## Decision

**Add a Node-side, multi-provider model client (`components/okf-server/services/model-client/`) that resolves the active inference tier from configuration, with internal vLLM as the default and frontier providers as an explicit, sovereignty-gated opt-in.**

1. **Provider registry.** `OKF_PRODUCER_MODEL_PROVIDER` ∈ `{internal, openai, xai, anthropic, gemini}` (default `internal`). Each provider has `{base_url, api_key_env, default_model, sdk, json_mode_strategy}`. Keys are resolved via `os`/`process.env[api_key_env]` — **never** inlined in code or the committed `env` template.

2. **Internal tier = OpenAI-compatible vLLM.** `internal` builds the OpenAI client against `VLLM_ENDPOINT/v1` + `VLLM_API_KEY` + `VLLM_MODEL_ID` (reuses the existing sovereign path; mirrors the dataprep `_build_vllm_client` contract, including `response_format={"type":"json_object"}` guided JSON validated on granite-4.1-8b).

3. **Frontier tiers.** `openai` and `xai` are OpenAI-compatible (point the same client at their `base_url`). `anthropic` (`@anthropic-ai/sdk`) and `gemini` (`@google/generative-ai`) use provider SDKs with **adapters**: normalize the response to a common `{content, usage}` shape, pass `system` as a top-level param (Anthropic), and enforce strict-JSON via a **tool envelope** (forced `tool_use` with a JSON schema) for Anthropic and `response_mime_type=application/json` for Gemini — because both lack native `response_format={"type":"json_object"}`. The fallback/retry discipline dataprep uses (batch → per-item → raw) is mirrored.

4. **Sovereignty gate (fail-closed).** `LLM_EXTERNAL_EGRESS_ENABLED` (default `0`). At provider resolution, if the active provider is not `internal` **and** the gate is not `1`, the service **refuses to start** (or refuses that provider and falls back to `internal` with a loud WARN) and logs the provider + egress destination at startup. This makes external egress an explicit, auditable deployment decision and preserves NFR-S1/air-gap.

5. **Scope: producer + future OKF inference only.** Dataprep and the retriever stay **internal-vLLM-only** (their labeling/retrieval paths are not made multi-provider here). A Python `genie-ai-overlay/core/llm_provider.py` that unifies dataprep/retriever's existing vLLM + OpenAI branches is a **related future opportunity**, explicitly **out of scope** for this course correction (it touches the gated OPEA 1.5 base) — tracked, not built.

6. **Config + secrets + supply chain.** Provider keys live only in `.env`/Ansible vault (`deploy/ansible/group_vars/*/vault.yml`), referenced by name. New npm deps (`@anthropic-ai/sdk`, `@google/generative-ai`; `openai` already implied) flow through the **blocking** `scan:okf-server` CI gate + CycloneDX SBOM (ADR-0001) and join the config-validator env coverage. The selector in the UI names the tier only — **API keys are never held in the browser/Vuex/localStorage** (deployment-wide server-side env, with optional per-repo steward override resolved server-side).

## Alternatives considered

| Alternative | Status |
|---|---|
| Internal granite-only (no frontier) | Rejected by product directive — caps concept-draft quality; the producer is the one place a frontier model adds clear value. Kept as the **default** tier. |
| Python `core/llm_provider.py` as the single abstraction | Deferred — would unify dataprep/retriever too, but it is **gated by the OPEA 1.5 bump** and the producer is Node (cannot import it). Two parallel impls sharing only the env-schema contract would drift; build the Node client now and revisit Python later. |
| Frontier-only (replace internal) | Rejected — breaks sovereignty/air-gap by default. Internal must remain the default. |
| Per-call / per-user API keys in the browser | Rejected — credential-exposure risk. Keys are deployment-wide server-side. |

## Consequences

- **Positive**: deploy-time quality/sovereignty dial; internal default keeps air-gap intact; OpenAI-compatible providers work with near-zero call-site logic; the producer is model-agnostic.
- **Negative**: Anthropic/Gemini adapters are non-trivial (wire format + guided-JSON emulation); new npm deps enlarge the image + supply-chain surface; a misconfigured provider without the gate could egress crawled content; the JSON-discipline assumptions tuned for vLLM continuous batching may behave differently against rate-limited frontier APIs.
- **Mitigations**: fail-closed sovereignty gate; adapters isolated in one module; blocking scan + SBOM for new deps; schema-validation + retry/fallback on all JSON paths; per-provider cost/throughput telemetry; ADR pins the shared env-schema contract so a future Python impl can conform.

## References

PRD §4.9 (FR-31), §9, §13; [Sprint Change Proposal 2026-08-12](../../_bmad-output/planning-artifacts/sprint-change-proposal-2026-08-12.md); [ADR-okf-019](okf-019-ai-driven-okf-producer.md); [ADR-okf-001](okf-001-okf-server-component-and-stack.md); dataprep LLM chokepoint [genieai_dataprep_arangodb.py:207](../../genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py); retriever OpenAI branch `genieai_retriever_arangodb.py:189-206`; CLAUDE.md (VLLM_API_KEY/endpoint convention; guided-JSON validation on granite-4.1-8b).
