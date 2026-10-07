# Epic 1 Context: Unified Multi-Graph Grounding

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Make a single chat retrieval ground answers across the free-form `GRAPH` corpus AND every OKF repository the caller is authorized for, with per-hit provenance (`graph_name` / `repo_id` / `concept_id`) preserved end-to-end so a response can cite concepts from any source. The epic is operator-gated by retrieval mode (`legacy` / `okf_only` / `hybrid`, default `legacy`); the legacy single-graph path is byte-identical to today's retriever when fan-out is off, so Epic 1's merge cannot regress production chat.

## Stories

- Story 1.0: Retriever provenance materialization (fusion-time attribution; DONE 2026-09-21)
- Story 1.0b: Boundary probe — `graph_names` survives ChatQnA→retriever deployed (unit leg DONE 2026-09-20; live-deploy leg pending — LG-5 launch gate for 1.1)
- Story 1.1: Retriever multi-graph fan-out + RRF fusion
- Story 1.2: ChatQnA forwards the authorized graph set (BACKLOG — AC pinned 2026-09-21)
- Story 1.3: Graph Router — query-aware graph-set selection
- Story 1.4: Parallel fan-out — bounded concurrency + per-graph timeout + partial-failure
- Story 1.5: 2-level cross-graph RRF + size normalization
- Story 1.6: Fan-out observability spans
- Story 1.7: Retrieval mode governance — runtime config + engagement gate (IN-PROGRESS; ungated legs DONE 2026-09-20)
- Story 6.1b: Authz Resolver — token → authorized graph set (Epic 6 dependency; DONE 2026-09-20)
- Story 10.7: OKF Studio Retrieval card (Epic 10 consumer)

## Requirements & Constraints

- **Operator-gated engagement**: fan-out engages ONLY when `mode ∈ {okf_only, hybrid}` AND ≥1 OKF graph is serving. `legacy` mode, empty serving set, or empty carrier MUST skip the router, the authz enumeration, and every fan-out path — zero new latency, zero new failure modes on production chat.
- **Legacy invariant**: the single-graph path MUST be byte-identical to today's retriever — identical results AND identical spans. CI-asserted on seed fixtures.
- **Per-hit provenance**: every retrieval hit carries `graph_name`, `repo_id`, `concept_id`, plus `chunk_key`. Attribution at fusion time (per-leg fan-out already knows its graph; chunk `file_id` IS `concept_id` from content-only chunking) — no chunk-doc schema migration.
- **Authorization isolation**: caller scoped to repo A cannot see repo B's chunks; unauthorized repos contribute zero hits by construction (resolver filter), never by post-filtering.
- **Resilience**: per-leg error, missing graph, or timeout returns zero hits from that leg, logs at INFO, fusion proceeds with survivors — one sick repo cannot stall or fail a chat.
- **Carrier shape**: ChatQnA forwards `[GRAPH, OKF_<repo_a>_v<N_a>, ...]` whenever ≥1 OKF graph is authorized (legacy graph ALWAYS first; carrier exhaustive once non-empty); empty carrier = legacy path; single-element carrier = fan-out with one leg.
- **Concurrency bound**: parallel legs bounded by env-tunable semaphore (default 5); per-leg timeout env-tunable; hard caps on per-graph and global candidate pools.
- **i18n + docs are completion gates**: stories touching user-visible surfaces ship all 14 locales (ar, bn, de, en, es, fr, id, man, pt, ru, st, sw, th, zh — en.js source of truth) and update `site/content/en/docs/` (architecture §8.4/§8.5 retriever fan-out; knowledge-base mode governance) + dev-internal `docs/` notes.
- **8.1 seed fixtures must be born-right**: fixtures go through the real lifecycle (create → curate → publish → drain) so graphs/manifests are born with production names — no hand-seeded collections.

## Technical Decisions

### Three retrieval modes (operator-owned, default `legacy`)

| Mode | Legacy `GRAPH` | OKF serving graphs |
|---|---|---|
| `legacy` (default) | Served, byte-for-byte today's path | Ignored |
| `okf_only` | Ignored | Served |
| `hybrid` | Served (constant baseline) | Served + fused |

Engagement gate is a WHITELIST — only `okf_only` / `hybrid` engage; corrupted mode values cannot switch fan-out on. `okf_only` with zero serving graphs yields zero OKF contribution + a structured warning, never a silent legacy fallback.

### Runtime configuration in ArangoDB

`okf_system_config` collection (one doc, `_key='retrieval'`) holds the live retrieval configuration; env vars are only the boot default. Shape: `mode` (enum), `max_fanout_graphs` (1..20, default 5), `spine_max_hops` (1..3, default 2), `extracted_hop_cap` (1..3, default 1), `candidate_cap_per_graph` (1..200, default 50), `candidate_cap_global` (1..1000, default 200), plus `revision` / `updated_at` / `updated_by`. Effective config = env defaults overlaid field-by-field with the governed row (the row never has to exist; `legacy` needs no row). Read response surfaces `source: 'env-defaults' | 'database'`. Read path uses ≤30s TTL cache + last-known-good on failure; write path is `tools-admin` scoped, validates mode/caps, bumps revision, audits before→after to `okf_audit_logs`.

### Serving view & graph-name authority

Serving truth = `lifecycle_state === 'publish' && ingested_at && !deleted_at` (same predicate as the frontend `laneFor` Ingested lane). Graph names come from `workingGraphName(repo)` — versioned `OKF_<slug>_v<N>` from the repo doc, NEVER static `OKF_{repo_id}` and NEVER the manifest's stamped `version` (skews during re-publish window). Retracted repos cannot occupy fan-out slots.

### Carrier across the OPEA mega-service

The deployed ChatQnA drops custom fields. The proven `label_contract.encode_filter_labels` / `decode_filter_labels` on a `::labels:` segment of `search_start` is extended with a parallel `::graphs:<comma-separated>` segment. Both segments coexist and are peeled order-insensitively at the retriever decode point. ChatQnA encodes in `align_inputs`; retriever decodes before any `search_start` reads. Live-deploy probe is the LG-5 launch gate for 1.1.

### Tiered option-(d) fan-out inside each OKF graph

- **Tier 1 (high prior)**: chunk's `concept_id` attribute → indexed join to concept-root vertex → walk `source='author'` edges ≤ `spine_max_hops`.
- **Tier 2 (bounded)**: entity-level `LINKS_TO` / `HAS_SOURCE` expansion ≤ `extracted_hop_cap`, capped per concept.
- Every candidate carries `{graph_name, repo_id, concept_id, hop, edge_provenance: vector|bm25|author|parser|label}`.

### Authz Resolver (6.1b)

`GET /api/okf/authz/graphs` returns `{graph_names[], per_graph_labels{}, domains{}, repos[{...}], superadmin, generated_at, ttl_seconds}` — read-scoped. Per-graph label-map shape ships with `null` values today (no label-ACL source yet — documented seam). Serving-set query memoized in-process with ≤30s TTL; `_resetServingCache()` exported for tests. Read-side resolver and write-side `callerAuthz` share ONE scope-parsing implementation.

### Router selection cache

Discovery scores cached at the selection layer (manifests only change at settle/mint — invalidate on write, or short TTL) to hold the ≤20ms router gate. In-scan LLM `summary_text` stays lazy/off-path (label overlap + tokens suffice; summary is augmentation only).

### Per-leg resilience primitives (decisions from 1.0)

- Full per-leg extraction of the retriever's single-graph body (vector ANN + BM25 hybrid + traversal) — byte-equivalent to the legacy path; no leg-level optimization that sacrifices RAG accuracy on the existing baseline.
- `asyncio.wait_for(per-leg, timeout=FANOUT_PER_GRAPH_TIMEOUT_MS/1000)` — skip-on-timeout, log at INFO, count as `fan_out.per_graph.failures`.
- `asyncio.Semaphore(FANOUT_MAX_GRAPHS)` bounds in-flight legs.
- No Pydantic mutation; legacy `invoke()` becomes a thin wrapper calling a private `_invoke_against_graph(graph_name, input, input_dict)` helper.

### Env-var surface

Retriever: `RETRIEVER_FANOUT_ENABLED` (default `"true"` in code — NOT YET documented in root `env` template), `RETRIEVER_FANOUT_MAX_GRAPHS` (5), `RETRIEVER_FANOUT_PER_GRAPH_TIMEOUT_MS` (2000), `RETRIEVER_FANOUT_CANDIDATE_CAP_PER_GRAPH` (50), `RETRIEVER_FANOUT_CANDIDATE_CAP_GLOBAL` (200), `RETRIEVER_FANOUT_SPINE_MAX_HOPS` (2), `RETRIEVER_FANOUT_EXTRACTED_HOP_CAP` (1). Companion `OKF_RETRIEVAL_*` env vars (boot defaults for the runtime config) are similarly missing from the root `env` template — both gaps close as part of this epic. CI must assert the off-state.

**Open question — deployment default for `RETRIEVER_FANOUT_ENABLED`**: code default is `"true"`; the user's standing rule (legacy path MUST NOT be disturbed) suggests the deployment default should be `"false"` so the retriever's off-state is the CI-asserted byte-identical path until an operator opts in via the runtime config. Confirm before merging 1-1.

## UX & Interaction Patterns

- **OKF Studio Retrieval card (10.7)**: mode selector (three explicit radios with consequence text), live serving-graph count + effective-config revision, cap/parameter editors (under "Advanced"), audit trail from `okf_audit_logs`. Operable while serving traffic (≤30s TTL = live effect). Built with DS primitives + existing admin-dashboard paradigms (tabs/dialogs/httpService, Options API, Vuex). Every change is an audited `PUT` with before→after confirmation.
- **Per-chunk provenance in chat response**: graph_name + repo name rendered in the Studio card so the user can audit which repository each grounded fact came from. Reranker selection span carries `graph_name + repo_id` attributes.
- **User-visible copy** lives under the `okf.*` i18n tree across all 14 locales (en.js source of truth).

## Cross-Story Dependencies

- **Story 1.0 DONE** feeds 1.1's per-leg `attach_provenance` and 1.2's chat-side acceptance.
- **Story 1.0b unit leg DONE**; live-deploy leg is the LG-5 launch gate that 1.1 cannot merge without going GREEN.
- **Story 1.7 ungated legs DONE** (env defaults, `okf_system_config`, GET/PUT `/api/okf/retrieval-config`, 15 tests green). Remaining: read-side TTL cache in chatqna/retriever (Wave R4), legacy CI invariant (Wave R4), 10.7 Studio card with i18n ×14 + site-docs gates (Wave R6).
- **Story 6.1b DONE** — Epic 6 but Epic 1's gate; chat forwarder (1.2) and Graph Router (1.3) consume it.
- **Build order**: 1.7 legs → 6.1b → 1.0b → 1.0 → 1.1 → 1.4 → 1.5 → 1.2 → 1.3 → 1.6 → 10.7, with 8.1 fixtures pulled alongside Wave R4.
- **Chat-side resolver cache (1.2)** MUST use the same ≤30s TTL as `authz/graphs` (6.1b) so fan-out graph set and resolver graph set never disagree for >30s.
- **Tier-1 indexed join** depends on a persistent index on `SOURCE.concept_id` at drain time (ADR-039 ingest-side completion item, additive).
- **Author edges** must carry the curator's label (anchor text / link kind) at settle/mint; concept-root vertices need `title`/`labels` enrichment.
- **Story 8.4 (RAGAS eval + size/weight tuning)** gates `k` + RRF weights for 1.5.
- **Story 8.6 (eval harness)** gates the `label_federation` opt-in default flip (currently off).