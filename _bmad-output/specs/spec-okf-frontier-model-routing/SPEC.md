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
- **CAP-2 — Per-operation delegation**: Each delegable operation has an explicit toggle —
  admin set (import curation, ingestion labeling, contextual-retrieval generation, head
  tag generation, test-suite generation, RAGAS benchmark generation; optionally RAGAS run
  judging) plus RAG inference (ChatQnA answering). Success: with a toggle off — or no
  profile at all — the operation runs identically to today on the local model.
- **CAP-3 — Central LLM router with local default**: okf-server administrative callers go
  through one router that resolves operation → provider, normalizes responses, and on
  frontier failure retries then degrades to local, loudly. Success: routing decisions are
  observable per call/job; a frontier outage never blocks an import and never takes chat
  down (local default resumes).
- **CAP-4 — Provider adapters**: Two adapters implement chat, streaming (inference leg),
  schema-forced JSON, and model listing for their family. Success: the same router call
  works against vLLM, an OpenAI-compatible endpoint, and Anthropic-native with no caller
  changes.
- **CAP-5 — Propagation to OPEA services**: Python services (dataprep, chatqna) resolve
  the routing from okf-server's internal endpoint with a TTL cache, defaulting to their
  env/local config. Success: toggling labeling or inference takes effect within the TTL
  without container restarts; okf-server unreachable ⇒ local behavior.
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
- Embeddings and reranking are NEVER routed — dimension-coupled to the indexed vectors.
  Translation and PII are out of scope.
- Model-agnostic: nothing indexed on a specific frontier model; minimums and
  context-window requirements are documented per operation class (see
  model-requirements.md).
- Imports must never block on the frontier (existing fail-soft contracts preserved);
  chat must never lose its local fallback.
- Context-window rule: prompt sizing derives from the selected model's window
  (David, 2026-10-18).
- Config writes are `tools-admin`-gated, audited (token-masked), optimistic-concurrency
  safe — the retrieval-governance precedent.
- Timeouts are per-class (labels ~120 s; generation/suite legs 300–600 s; honor
  `Retry-After`); frontier inference streams.

## Non-goals

- Routing embeddings, reranking, translation, PII, or dataprep graph extraction (v1).
- Multiple simultaneous frontier profiles (one active profile in v1).
- Vendor Batch APIs, cost metering/billing (logged usage events only).

## Success signal

With a frontier profile configured and every toggle on: an import (curation + labeling +
contextual), a head-tag generation, a test-suite generation, a RAGAS benchmark
generation, and a chat query all complete against the frontier model — visible as
delegated in logs/UI, sized to the frontier window — while embeddings, reranking, and
retrieval remain local; then removing the profile (or switching every toggle off)
restores byte-identical local behavior with no restart.
