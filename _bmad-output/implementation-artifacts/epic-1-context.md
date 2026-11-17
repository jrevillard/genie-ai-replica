# Epic 1 Context: OPEA-free document capability layer (S3)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Give GENIE a knowledge-access boundary it owns outright: a typed, versioned document capability contract (`search_knowledge`, `read_source`) whose first implementation reaches ArangoDB, TEI and vLLM directly — never ChatQnA, the OPEA retriever, or any `comps`-built service — so a future agent loop can search and read the knowledge base without inheriting OPEA. The epic exists to make the OPEA exit a bounded, provable migration rather than a rewrite: the current pipeline's query-path semantics are recorded as a verifiable reference first, then reimplemented clean-slate with behavior frozen to that reference and proven per-behavior by an equivalence suite. Authorization is structural, not disciplinary — the port queries only the per-request authorized graph set handed to it by the BFF, so model-generated arguments cannot widen access. The service ships dark and born switchable: the activation flag mechanism lands here (Epic 3 owns the operational choreography), and the deployed-stack baseline is captured on a parallel track from day one so the later evaluation has a real reference instead of an assumption.

## Stories

- Story 1.1: Record the OPEA query-path behavioral contract (V02)
- Story 1.2: Baseline the deployed stack (V03)
- Story 1.3: Stand up `components/agent-service`, deployable and switchable
- Story 1.4: Enforce OPEA-free with a CI gate
- Story 1.5: Define the document capability contract (with V04 acceptance)
- Story 1.6: Implement `search_knowledge` — OPEA-free, behavior frozen
- Story 1.7: Implement `read_source` and the authorization executor
- Story 1.8: Implement the input-preparation module
- Story 1.9: Behavioral equivalence suite (E01 runway) and V05 inventory

## Requirements & Constraints

**Contract shape.** Every operation declares typed input, result, provenance and error semantics; per-operation timeout, result-size and cancellation semantics; and explicit compatibility/versioning rules. The error taxonomy must keep authorization failure, insufficient evidence, degraded availability and transient errors mutually distinguishable — no operation may return one where another is meant. Insufficient evidence is a *successful answer type*, not an error.

**Provenance identifiers.** Legacy sources carry `file_id`. OKF concepts carry `concept_id` + `repo_id` + `bundle_version` plus `source: 'okf-concept'`, resolved by an exact join on `okf_concepts_meta` — never by parsing a graph name.

**Authorization by construction.** The port receives a structured trusted caller context from the BFF (user id + resolved authorized graph set + task restrictions), never a compressed search string. Effective permission is the intersection of user and task over the registered toolset; the server-side registry *is* the authorization surface. Enforcement lives in the port's executor. Failure to resolve authorization yields an error or insufficiency — never a wider corpus; the legacy fail-open path is not replicated. `read_source` re-validates every resolved target against the request's authorized set, not merely against a live lookup. Legacy `file_id` values are in scope only when the authorized set includes the legacy graph. No raw AQL from model-generated arguments; caller-supplied graph/repo identifiers are charset-validated or resolved server-side.

**OPEA-free is structural.** Agent-path code lives outside `genie-ai-overlay/`. No `comps` imports, no OPEA service calls, no OPEA build-time downloads — enforced by CI from the first delivered stage. The OPEA translation image is inside the ban. "OPEA-free" may be claimed only for the explicitly validated scope.

**Behavior preservation.** The port reproduces the recorded semantics: dense cosine retrieval (brute-force default), the BM25 view, RRF fusion, label filtering with defense-in-depth post-filter, `file_id` enrichment, CAP-1 identity join with tolerated absence, and the full reranking/evidence-selection stage (strategy variants, top-N, thresholds, selected-passage order, reranker-down behavior). Retrieval parameters are env-tunable values, not constants — the port exposes the same knobs with the same names. The embedding request honors the model-specific query-instruction contract, including models with an intentionally absent prefix and deployer overrides.

**Query preparation lives on the loop side.** The port's input contract requires a prepared English query and never calls vLLM. The application layer detects language, translates any supported locale to English before every search (including mid-loop refined queries), applies history/input bounds, and records a translation status. Failure classes behave distinctly and consistently with the contract taxonomy: translator unavailable, oversized input (explicit 422 `translation_input_too_long` with abstention — not an untranslated fallback), and blank translation. One hardcoded fallback across classes is a defect.

**Tainted data.** Tool results cross the port as structured data with typed fields, stable ids and bounded sizes. The port defines no free-form instruction channel.

**Dependency adoption.** Before any runtime or dependency is adopted: exact-version license verification (unread license or NOASSERTION counts as unverified and blocks), Apache-2.0-compatible selections, and a defaults audit for default telemetry and default cloud export. Developer-preview status requires an explicit operational-risk acceptance.

**Operational shape.** The agent service runs at exactly one replica (flag-gated 0/1) with flock-slot admission lanes; document-tool calls dispatch serially, one in flight. No new stores, no new persistence shapes, no new host ports.

## Technical Decisions

- **Hexagonal layering.** Port (the document capability contract) + adapters (ArangoDB, TEI embed/rerank, okf-server, doc-repo) + application layer (loop, budgets, cancellation, citation verification, event shaping). The Node BFF owns the client SSE dialect; nothing about the frontend contract leaks past it.
- **One new Python service.** `components/agent-service` — Python 3.11, FastAPI, internal-only port, patterned on the existing non-overlay Python service precedent (not the OPEA overlay). Image `genie-ai-agent-server`, env prefix `AGENT_*`. Module layout: `app/` (host, health, internal API), `capabilities/` (the port: operations, executor, authz context, provenance, limits), `agent/` (loop, runtime seam, budgets), `obs/` (tracing), `tests/`.
- **okf-server stays the per-user read authority**, unchanged. No second authorization or knowledge-governance layer is introduced.
- **Clean-slate port, not a wrapper.** No shared library with the overlay, no wrapping, no dual-mode code. Modern patterns are encouraged; behavior is frozen to the recorded reference in this iteration. The bounded duplication is retired later by deletion, never by merging.
- **Admission-lane primitive is foundational work here.** The no-agent mode (config B's complete fixed answer pipeline: preparation → retrieval → reranking → selection → context/prompt construction → one fixed generation → verdict and result assembly) is implemented service-side in this epic, sharing the same admission primitive and budgets as the agent path, so the later evaluation attributes its delta to the agent alone.
- **Activation is one deployment-level flag** covering compose replicas and BFF routing for *both* request paths (streaming and non-streaming). The branch lives in one shared routing helper both entries call, with a test asserting the two paths cannot disagree — per-entrypoint edits are what half-activated deployments look like. The agentic path mints the same-shaped `queries` document so persistence, analytics and rollback continuity work without data changes.
- **Configuration convention.** Compose `environment:` blocks are hand-wired (no `env_file`); every new variable is documented in the root `env` template and covered by the config-validator suite.
- **Observability.** The overlay tracing pattern is ported *minus* its `comps` hooks — the ported file must itself pass the OPEA-free gate — with the fluentd logging anchor and the `OTEL_SERVICE_NAME` compose↔source pair convention. Timestamps are UTC ISO everywhere persisted.
- **Decision records.** Structural decisions land as ADRs with status, date, owner, reviewers, evidence, consequences, replacement costs and reconsideration triggers; superseded records are preserved and linked; each has one canonical home. Existing ADRs are status-checked before reliance — a `Proposed` record is not an accepted one.

## Cross-Story Dependencies

- The V02 behavioral record (1.1) is the input to the implementation stories (1.6, 1.8) and to the equivalence suite (1.9) — no port work starts before it exists.
- The contract (1.5) gates both operation implementations (1.6, 1.7); its acceptance consumes the V04 authorization/provenance/ownership map, and a divergence there reopens the placement and authorization decisions rather than just the story.
- The service skeleton (1.3) must exist before the CI gate (1.4) has packages to scan; the gate's scope note records that it cannot see the BFF's runtime call graph, which a routing-helper test covers instead.
- The baseline (1.2) runs in parallel from day one with no code dependency; it feeds the later evaluation epic as its reference input.
- The V05 inventory of the live API/SSE/error contract surface lands in 1.9 and gates the stage-exit compatibility check; gaps become pre-exit work items rather than silent debt.
- Epic boundary: this epic ships the activation-flag *mechanism*; operational activation, rollback rehearsals and rollout records are Epic 3's. The equivalence suite and no-agent mode here are the evaluation runway Epic 4 drives.
