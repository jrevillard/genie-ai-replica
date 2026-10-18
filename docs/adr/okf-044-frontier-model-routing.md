# ADR okf-044: Frontier-model routing for OKF Studio admin operations AND RAG inference

**Status**: Proposed (David directive, 2026-10-18 — spec `okf-frontier-model-routing`; awaiting David's lookover before implementation)
**Date**: 2026-10-18
**Decision owners**: David (product), Winston-slot (architecture)
**Implements**: Story 8-7 (design phase), branch `feat/okf-server` (post-!560 merge)

## Context

Every GENIE.AI deployment leans on its local GPU model (vLLM + granite-class 8B) for two
very different kinds of work:

- **Administrative work** — import-time curation, ingestion labeling, Contextual
  Retrieval generation, head/tag generation, test-suite generation, RAGAS benchmark
  generation — each driving hundreds to thousands of judge calls that can pin the GPU
  for tens of minutes (measured: a 127-concept RAGAS generation ≈ 20 min of continuous
  judge load), competing with chat serving.
- **Inference work** — ChatQnA answering, the RAG the framework exists to provide.

David's directive (2026-10-18): add an option to configure a **remote frontier model**
and delegate to it, per operation: the heavy admin operations *and*, as a later
expansion, the basic inference service. **Scope revision after ADR review (same day)**:
v1 restricts to the **OKF admin operations**; inference is a **future expansion** (its
streaming complexity is the reason — the config-UI row ships disabled and labeled); the
**legacy ingestion pipeline is untouched** — the dataprep ingestion legs (labeling,
contextual) are deferred with a stated crossover: those legs live in the shared
dataprep service both pipelines execute, separable only by okf-originated request
tagging, which ships as the future-extension design. The config carries a URL, a model
list for selection, an access token, **both OpenAI and Anthropic APIs**, and a checkbox
per operation choosing what delegates. The configuration screen must make it very
clear what each option does. Embeddings, reranking, and (unchanged) translation stay on
the local GPU services — embeddings and reranking are dimension-coupled to the indexed
vectors; routing them breaks retrieval. If the frontier API is not configured (or a box
is unchecked), everything defaults to the local model exactly as today — the feature is
purely additive.

A full call-site map (three research passes, 2026-10-18) found: nine
`vllmChatCompletions` callers in okf-server, three more Node LLM helpers, three dataprep
LLM legs (labeling, contextual, graph-extraction), the RAGAS sidecar's per-job judge
factory, and the ChatQnA/translation env families. It also found a pre-existing bug
this work fixes: okf-server reads the container var `VLLM_LLM_MODEL_ID`, but compose
maps the host var to `VLLM_MODEL_ID` in-container — so every okf-server admin LLM call
sends the hardcoded granite default model string today, regardless of deployment
configuration.

## Decision

1. **Central LLM router in okf-server** (`llm-router` service). Every administrative
   LLM caller goes through `llmRouter.chat({ operation, messages, maxTokens,
   temperature, schema? })`. The router resolves `operation → provider`: frontier when
   the system config has a profile AND that operation's checkbox is on; otherwise the
   local vLLM (the cardinal default rule). Frontier errors retry, then degrade to local
   with a loud log — imports never block.
2. **Runtime config as an `okf_system_config` keyed doc** (`_key: 'frontier_model'`),
   cloning the proven retrieval-governance pattern (ADR-okf-039 D3): joi validation,
   optimistic concurrency, audited writes behind `requireRole('tools-admin')`, env
   defaults merged with the stored doc. Schema: provider type
   (`openai-compatible` | `anthropic`), base URL, access token (**write-only**: GET
   returns `token_configured`, audit diffs are token-masked), selected model + context
   window, and the per-operation delegation flags (admin set + inference).
3. **Two provider adapters**. `openai-compatible` covers OpenAI, vLLM, LiteLLM, and
   OpenRouter (Bearer, `/v1/chat/completions`, `GET /v1/models`). `anthropic` handles
   the native Messages API (two-header auth, top-level `system`, required `max_tokens`,
   no unconditional `temperature`, typed content blocks, cursor-paginated models list).
   Both normalize to `{ text, finishReason, usage }` and implement one schema-forced
   JSON operation with per-provider mechanics (OpenAI `json_schema` strict / Anthropic
   `output_config.format` / vLLM `json_object`), always with the existing parse+retry
   fallback underneath. Streaming arrives with the future inference expansion.
4. **Propagation (v1: RAGAS sidecar only)**: the sidecar takes per-request judge
   overrides through its existing job factory. The broader internal
   `GET /internal/llm-routing` pull for OPEA services (dataprep, chatqna) is designed
   but future-extension plumbing — the dataprep legs are deferred to keep the legacy
   ingestion pipeline untouched (the okf-originated tagging design ships with the
   spec). Graph extraction (vendored OPEA comps) stays local.
5. **Context-window adherence everywhere** (the RAGAS rule, generalized): every routed
   operation sizes its prompts from the selected model's configured window — the
   `RAGAS_JUDGE_CONTEXT_TOKENS`/`RAGAS_DOC_CHAR_CAP=auto` derivation is the worked
   example; the frontier profile carries the model's window and the router publishes
   per-leg budgets.
6. **The configuration screen explains every option** — each field and checkbox states,
   in plain language, what work it moves to the frontier model, what stays local, and
   the fallback behavior (the RAGAS help-panel / DsInfoTip discipline).

## Consequences

- Positive: heavy admin runs stop competing with chat serving; deployments without big
  GPUs can run frontier-quality RAG answering; okf-server's frozen-model-string bug
  dies (centralized resolution); operation routing is runtime-configurable without
  redeploys; the first OKF admin-config UI establishes the pattern for future system
  settings.
- Negative/risks: a token stored in ArangoDB (mitigated: write-only reads, masked
  audit, internal-collection access only); frontier TTFT/latency needs per-class
  timeout budgets (labels 120 s, generation legs 300–600 s, `Retry-After` honored);
  hosted-API rate limits — not GPU — govern throughput; routing the inference leg
  places a frontier round-trip in the user-facing chat path (mitigated by streaming +
  the always-available local default).
- Non-goals: routing embeddings, reranking, translation, or PII; graph extraction
  (v1); **inference/ChatQnA delegation in v1** (future expansion — streaming
  complexity; UI row disabled + labeled); **the dataprep ingestion legs in v1**
  (future expansion via okf-originated tagging — the legacy ingestion pipeline is
  untouched); multi-profile simultaneity (one active frontier profile in v1); vendor
  Batch APIs (phase 2); cost metering beyond logged usage events.

## References

- Spec: `_bmad-output/specs/spec-okf-frontier-model-routing/` (SPEC.md + companions:
  operations-routing, provider-adapters, config-and-ui, model-requirements,
  architecture-diagrams)
- Pattern precedent: `retrieval-config-service.js` (ADR-okf-039 D3),
  `docs/adr/okf-043-ragas-benchmarking-via-python-sidecar.md`
- Research (2026-10-18): call-site map, settings-UI patterns, provider API surface —
  summarized in the spec companions.
