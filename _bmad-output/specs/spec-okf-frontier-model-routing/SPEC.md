---
topic: Frontier-model routing for OKF Studio admin operations and RAG inference
created: 2026-10-18
status: design — awaiting David's lookover (no implementation until approved)
companions:
  - operations-routing.md
  - provider-adapters.md
  - config-and-ui.md
  - model-requirements.md
  - architecture-diagrams.md
sources: []
---

# Spec: Frontier-model routing (admin + inference)

## Why

Every OKF Studio feature and the RAG answering path lean on the deployment's local GPU
model. The heavy administrative operations (imports, labeling, contextual generation,
tag/head generation, test-suite and benchmark generation) each drive hundreds-to-thousands
of judge calls that pin the GPU for tens of minutes and compete with chat serving — and
deployments without a big GPU cannot offer frontier-quality RAG answering at all. A
configurable remote frontier model (OpenAI- or Anthropic-compatible), selectable per
operation, removes both limits while leaving the local-default behavior byte-identical
when unused.

## Capabilities

- **CAP-1 — Frontier provider profile (system config)**: An administrator configures one
  active frontier profile — provider type (`openai-compatible` | `anthropic`), base URL,
  write-only access token, model chosen from a fetched list (or entered), and the model's
  context window. Success: the profile saves, is validated (test-connection), and survives
  restarts; nothing else about the deployment changes until an operation is delegated.
- **CAP-2 — Per-operation delegation**: Each delegable operation has an explicit toggle.
  **v1 scope (David, 2026-10-18): OKF admin operations only** — import curation (with
  csv topics, link suggestions, topic-link authoring, manifest summary riding it), head
  tag generation (with autocorrect), test-suite generation, RAGAS benchmark generation
  (RAGAS run judging remains the open toggle). **Deferred, visible as disabled rows
  labeled "future extension"**: RAG inference (streaming complexity — deferred with the
  UI row present but disabled) and the dataprep ingestion legs (labeling, contextual —
  see Constraints for the crossover). Success: with a toggle off — or no profile at all
  — the operation runs identically to today on the local model.
- **CAP-3 — Central LLM router with local default**: okf-server administrative callers go
  through one router that resolves operation → provider, normalizes responses, and on
  frontier failure retries then degrades to local, loudly. Success: routing decisions are
  observable per call/job; a frontier outage never blocks an import.
- **CAP-4 — Provider adapters**: Two adapters implement chat, schema-forced JSON, and
  model listing for their family (streaming arrives with the future inference
  expansion). Success: the same router call works against vLLM, an OpenAI-compatible
  endpoint, and Anthropic-native with no caller changes.
- **CAP-5 — Propagation to the RAGAS sidecar**: the sidecar accepts per-request judge
  overrides through its existing job factory. Success: toggling RAGAS generation
  redirects the judge on the next generation with no container restart. (The broader
  OPEA-services pull — dataprep, chatqna — is future-extension plumbing, designed but
  not built in v1.)
- **CAP-6 — Context-window adherence**: Every routed operation sizes its prompts from the
  selected model's configured window. Success: switching judge/inference models never
  reintroduces context-overflow failures (the RAGAS derivation is the worked example).
- **CAP-7 — Secret-safe configuration**: The access token is write-only — never returned
  by GETs, never written to audit diffs or logs. Success: configured-token state is
  visible (`token_configured`) without the secret ever leaving storage except to the
  provider.
- **CAP-8 — Self-explaining configuration screen**: The config UI states, in plain
  language, what each field and every operation toggle does — what work moves, what
  stays local, and the fallback. Success: a new administrator can decide correctly
  without leaving the screen.

## Constraints

- **Cardinal default rule**: no profile / toggle off / frontier failure ⇒ local model,
  exactly today's behavior. Zero config = zero change (David, 2026-10-18).
- **v1 touches only okf-server-side and ragas-side operations** (David, 2026-10-18).
  The LEGACY ingestion pipeline is untouched. **Crossover, stated plainly**: the
  ingestion LLM legs (labeling, contextual generation) live in the shared dataprep
  service that BOTH pipelines execute — separable in principle (okf-server originates
  its ingest requests, so routing could tag okf-originated jobs only), but v1 defers
  the dataprep legs entirely to honor the no-legacy-impact rule; the future extension
  carries the okf-originated-only tagging design.
- **Inference (ChatQnA answering) is deferred** (David, 2026-10-18 — streaming and
  related complexity); its config-UI row is present but disabled and labeled a future
  extension.
- Embeddings and reranking are NEVER routed — dimension-coupled to the indexed vectors.
  Translation and PII are out of scope.
- Model-agnostic: nothing indexed on a specific frontier model; minimums and
  context-window requirements are documented per operation class (see
  model-requirements.md).
- Imports must never block on the frontier (existing fail-soft contracts preserved).
- Context-window rule: prompt sizing derives from the selected model's window
  (David, 2026-10-18).
- Config writes are `tools-admin`-gated, audited (token-masked), optimistic-concurrency
  safe — the retrieval-governance precedent.
- Timeouts are per-class (labels ~120 s; generation/suite legs 300–600 s; honor
  `Retry-After`).

## Non-goals

- Routing embeddings, reranking, translation, PII, or dataprep graph extraction (v1).
- **Inference/ChatQnA delegation in v1** (future expansion — streaming complexity; UI
  row shipped disabled).
- **Dataprep ingestion legs in v1** (labeling, contextual) — future expansion with
  okf-originated-only tagging; the legacy pipeline is untouched in v1.
- Multiple simultaneous frontier profiles (one active profile in v1).
- Vendor Batch APIs, cost metering/billing (logged usage events only).

## Success signal

With a frontier profile configured and every v1 toggle on: an import curation, a
head-tag generation, a test-suite generation, and a RAGAS benchmark generation all
complete against the frontier model — visible as delegated in logs/UI, sized to the
frontier window — while ingestion labeling, contextual generation, inference, and all
retrieval legs remain local and the legacy pipeline is byte-identical; then removing
the profile (or switching every toggle off) restores byte-identical local behavior
with no restart.
