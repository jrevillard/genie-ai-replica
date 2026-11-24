# Epic 1 Context: OPEA-free document capability layer (S3)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Give engineering and evaluation one GENIE-owned document capability contract — `search_knowledge` and `read_source` — implemented without OPEA (direct ArangoDB / TEI / vLLM / doc-repo / okf-server), whose query-path behavior deliberately reproduces the current pipeline so nothing drifts silently. The layer is born switchable: a deployment-level activation flag gates it, the legacy RAG path keeps serving unchanged, and every resolved target is authorized by construction. It also produces the V02 behavioral baseline, the V03 deployed-stack baseline and the V04 authorization map.

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
- Story 1.10: Attest the chart identity of the deployed baseline

## Requirements & Constraints

- **Behavior is frozen.** Before contract acceptance, the deployed query-path semantics are recorded as test-consumable fixtures: dense cosine, BM25 view, RRF fusion, label filter + post-filter, file_id enrichment, CAP-1 identity join (tolerated absent), reranking/evidence selection (strategy, top-N, thresholds, passage order, reranker-down). Deployed values are env-tunable — the port preserves them and exposes the same knobs.
- **Preparation is part of the record:** language detection across all supported locales, any-source-language → English translation before embedding (the embedding space is English-only), history/input bounds, `query_translation_status`. Failure classes stay distinct as deployed: translator unavailable, oversized input (422 `translation_input_too_long` with abstention — never an untranslated fallback), blank translation.
- **The embedding query-instruction prefix is mandatory** per embedding model, including models with intentionally no prefix (bge-m3, MiniLM) and deployer overrides — omitting it silently corrupts dense scores.
- **OPEA-free is enforced, not promised:** no `comps` imports, no OPEA service calls, no OPEA build-time downloads (including the OPEA translation image), from the first delivered stage; no new coupling that makes the deferred OPEA exit harder. Agent-facing contracts expose no OPEA representations; "OPEA-free" claims are scoped to the validated surface.
- **Contract semantics:** typed input/result/provenance/error per operation; per-operation timeout, result-size, cancellation; compatibility and versioning rules. Authorization failure, insufficient evidence, degraded availability and transient errors stay distinguishable. Provenance uses stable ids (legacy `file_id`; OKF `concept_id`/`repo_id`/`bundle_version`).
- **Authorization by construction:** access is user ∩ task over the registered toolset — the server-side registry is the authorization surface. The request carries a trusted caller context (user id + resolved authorized graph set), never a compressed search expression; model arguments never widen access, no raw AQL reaches the model, graph/repo identifiers are charset-guarded or resolved server-side. Resolution failure is fail-closed — the legacy fail-open window is not replicated — and degradation reports insufficiency, never confident data.
- **Retained data is in scope:** evidence across turns, session state and audit records get defined ownership and access rules; cross-user and cross-session identifier attempts are rejected; a permission change between turns invalidates retained-evidence reuse. Post-revocation visibility of earlier answers is a recorded decision.
- **Decision records, not tribal knowledge:** structural decisions carry status, owner, reviewers, alternatives, evidence, consequences, reconsideration triggers, and a traceability chain to the released version. Existing records are status-checked before reliance.
- **Gates:** V02 precedes design and contract acceptance; V04 (authorization/provenance/ownership map) is reviewed at acceptance — a divergence reopens the placement and authorization decisions explicitly; V05 (live API/SSE/error contract inventory + regression coverage) precedes the S3 compatibility gate; S3 exit needs V02/V04/V05 evidence recorded. Each new dependency clears license verification and a defaults audit before acceptance (`NOASSERTION` blocks). With the flag off, nothing agentic is reachable.

## Technical Decisions

- **Contract placement:** the capability module lives inside the new `agent-service` behind a stable internal API; okf-server remains the per-user read authority, unchanged. The BFF assembles the trusted caller context; the port queries only that set.
- **One new service, not a platform:** `components/agent-service` — Python 3.11, FastAPI, on the `pii-service` precedent: internal-only port, compose-standard block (cap drop, no-new-privileges, fluentd anchor, healthcheck, no host port), build/scan/promote CI triplet, ansible image entry, config-validator coverage. Ported tracing carries no `comps` hooks.
- **Clean-slate port, frozen behavior:** the query path is reimplemented, never shared — no shared library, no wrapping, no dual-mode code with the overlay (a shared lib would couple the paths and restructure the `comps`-vendoring build). Modern patterns (typed port/adapters, DI) encouraged; observable behavior frozen to the recorded semantics. Improvements are iteration-2 work; the duplication ends by deletion at the OPEA-exit initiative.
- **Preparation ownership sits with the loop, not the port:** the agent application layer prepares every query — including refined mid-loop queries — detecting language, translating to English as a budgeted auxiliary model call with cancellation propagation, applying bounds, recording status. The port requires prepared English queries and never calls vLLM; answer translation stays BFF-owned.
- **Enforcement lives in the executor:** `read_source` re-validates every resolved target (legacy `file_id` via doc-repo, OKF concept via the metadata join) against the request's authorized set, not by live-service lookup alone. The legacy corpus has no per-user ACL: in scope only when the authorized set includes the legacy graph.
- **CI gate shape:** a new tree-walking config-validator gate scans agent-path packages for `comps` imports and OPEA build-time downloads; its scope note records what grep cannot see (BFF runtime call graph), and the BFF leg is enforced by a routing-helper test. The gate is proven red once on a scratch branch.
- **Activation mechanism:** one deployment-level flag (compose replicas plus BFF routing) covers both request paths — streaming and non-streaming — through a single shared routing helper, with a test asserting the paths cannot disagree. The agentic path mints the same-shaped per-turn query document, so persistence, analytics and rollback continuity need no data change.
- **Config B is a mode of the same service:** the fixed no-agent pipeline (preparation → retrieval → reranking → selection → prompt → generation → verdict) runs single-pass through the same admission lane and budgets, so both configurations share backend and admission policy.
- **Observability and persistence unchanged:** tracing through the existing stack plus a run-start version handshake written into the query document at start, so cancelled or crashed runs keep attribution. No new store; session state stays in-request; tool results cross the port as bounded, structured data only, never an instruction channel.

## Cross-Story Dependencies

- **Hard ordering inside the epic:** the behavioral record (1.1) precedes the contract (1.5) and the port (1.6, 1.8), and its fixtures are the expected values for the equivalence suite (1.9). Story 1.3 hosts the gate (1.4) and the implementations (1.6–1.8); 1.10 attests the chart identity of the deployed baseline and closes the epic.
- **Parallel and cross-epic:** the deployed-stack baseline (1.2) has no code dependency, starts day one, and feeds the evaluation epic's reference measurement. The activation-flag mechanism shipped here is what the activation/rollback epic drives, and the evaluation epic reuses this epic's equivalence suite as its fixed-configuration driver.
