# Sprint Change Proposal — OKF End-to-End Architecture Course Correction

**Date:** 2026-08-13 · **Branch:** `feat/okf-server` · **Scope:** Major · **Status:** Applied (2026-08-13) — see §6
**Workflow:** BMAD `correct-course` (Batch mode — all 25 decision points pre-confirmed by the user)
**Basis:** [okf-course-correction-2026-08-13.md](./okf-course-correction-2026-08-13.md) — four parallel verified deep-dives (write/read/control/test), 36 deduplicated gaps, the complete end-to-end architecture (§2), and the 25-point decision matrix (§3).

> **Predecessor:** the [2026-08-12 producer proposal](./sprint-change-proposal-2026-08-12.md) (Epic 7, applied). This proposal supersedes nothing in it; it adds the **connective tissue** the producer (and every other OKF consumer) depends on.

---

## 1. Issue Summary

**Trigger (architecture review, 2026-08-12/13).** The user directed a freeze on further OKF leaf-story development until the **whole end-to-end architecture is well-defined with no design flaws or omissions**:

> "I do not want to go into development with design flaws and stupid omissions of how the whole end-to-end architecture will look… this must be well defined in the stories." / "let's get all of the ideas on the table now and ideate the best possible approach. The design needs to be optimal from the outset."

Four independent deep-dives (write-side, read-side, control-plane, testing-context) converged on a single finding: **the OKF initiative is specified at the *capability* level but not at the *mechanism* level.** Every consumer assumes someone else owns the linchpin components — the **write-side orchestrator**, the **authz resolver**, the **graph-selection layer**, and the **cross-service transport for `graph_names`** — and none of those owners exist in any story.

**36 gaps survived deduplication (6 P0 blockers, 14 P1, 11 P2, 5 P3).** The 6 P0s are either **active defects shipping today** or **absolute blockers**:

| # | Gap (one line) | Why P0 |
|---|---|---|
| **G1** | No write-side orchestrator sequences parse→validate→PII→index→edges→meta | Nothing makes ingest work end-to-end |
| **G2** | `graph_names` list cannot cross the ChatQnA→retriever mega-service boundary (dynamic `__main__` drops custom fields) | The entire query vision has an unproven transport |
| **G3** | Cross-tenant read leak — any authed user lists/reads ALL repos across ALL tenants (`callerDomain` is a no-op filter) | Active security defect |
| **G4** | ACL labels (`t:`/`r:`/`d:`) silently dropped at ingest by `_finalize_chunk_labels` — isolation broken, test-masked | Active data-integrity defect |
| **G5** | `graph_name` not wired; retract deletes from the wrong graph (`GRAPH` vs `genie_graph` mismatch) | Active data-destruction defect |
| **G6** | No graph-selection layer — "authorized" treated as "relevant"; fan-out unbounded (~300+ round-trips @ 50 repos) | Blocks the multi-repo scaling goal |

**Evidence.** The course-correction document is repo-grounded throughout (dataprep loader already accepts per-request `graph_name` at `arangodb.py:1287`; the retriever already has `chunk_labels` filter machinery; the parser already emits links; `_finalize_chunk_labels` drops ACL prefixes at `genieai_dataprep_arangodb.py:1051-1104`; the document-repository async ingest lifecycle already exists). **The fixes are predominantly wiring + ownership + contract decisions, not greenfield rebuilds** — the substrate to fix most P0s already exists in the code.

**Decisions.** All 25 architecture decision points (D1–D25) were confirmed by the user (see §3 of the course-correction doc for the verbatim answers). This proposal applies them mechanically. Two program-level decisions (D24/D25) are reconciled in §5.1 — confirm at this gate.

---

## 2. Impact Analysis

### 2.1 Epic impact

| Epic | Impact |
|---|---|
| **NEW Epic 2.9 — Write-side Orchestration** | The trunk every OKF consumer hangs on. Sequences the ingest pipeline (G1), owns the meta writer (G9), the async worker (G10), bundle format (G11), graph_name wiring + retract fix (G5/G14), version minting (G26), source-sync store (G32), and retention sweep (G27). Extracts the ungated ACL-preserve fix (G4) as **Story 2.6a**. |
| **NEW Epic 8 — Test Infrastructure & Evaluation** | The deterministic fixture trinity (static crawl site + seed repos + golden queries) the user named as the highest-leverage testing investment (G20), plus multi-graph integration tests (G31), retrieval-quality eval (G30), and RRF parameter sweep (G21 tuning). |
| **Epic 1 (multi-graph grounding)** | Gated by bump (unchanged). Adds stories **1.0** (provenance materialization, G18), **1.0b** (boundary probe, G2), **1.3** (Graph Router, G6), **1.4** (parallel fan-out, G14), **1.5** (2-level RRF, G21), **1.6** (fan-out observability, G24/G35). ACs of 1.1/1.2 hardened (ACL on all `search_start`, per-graph labels, isolation test). |
| **Epic 2 (ingestion)** | Story 2.5 (bundle route) ACs clarified (async via worker, server-side `graph_name==OKF_{repo_id}` ownership assertion, extractMetadata fix). Story 2.6 split: **2.6a** (ACL-preserve, ungated) extracted; 2.6 keeps the gated graph-wiring + retract. Story 2.8 (PII) rescheduled as a **publish prerequisite** (lifecycle gate), not parallel. |
| **Epic 4 (curation/lifecycle)** | Story 4.1 adds optimistic concurrency (`If-Match`/409, G25) + first-class fields + label re-materialization (NEW **Story 4.1b**, G29). Stories 4.3–4.5 rewritten against the **lifecycle state machine** (ADR-030); `version` demoted to publish side-effect. |
| **Epic 5 (serving)** | Stories 5.1/5.2/5.5 ACs clarified: pre-Epic-1 single-graph fallback documented; get-concept = direct fetch (NOT retrieval); neighbors = single-repo-scoped traversal (G23). |
| **Epic 6 (governance)** | Story 6.1 gets the **default-deny + scope middleware** fix (G3/G15). NEW **Story 6.1b** = the Authz Resolver component (G8). Story 6.4 audit hardened (write-before-respond, hash chain, tenant field — G16). |
| **Epic 7 (producer)** | Story 7.2 dump-schema versioning AC (G34); Story 7.5 split — draft-quality eval only, retrieval-quality eval moves to Epic 8 (G30). |

**No rollback.** Stories 2.1–2.4 (done) are correct and stay. The substrate for every P0 fix exists. This is **Direct Adjustment**, not a replan.

### 2.2 Story impact — new stories (20)

**Epic 2.9 (9):** 2.9.1 ingest orchestrator+endpoint · 2.9.2 concepts_meta UPSERT writer · 2.9.3 `_LINKS_TO` edge writer · 2.9.4 ingestionWorker (Redis Streams) · 2.9.5 bundle zip+unzip+dedup · 2.9.6 graph_name wiring+retract fix · 2.9.7 okf_versions+mintVersion · 2.9.8 okf_sources writer · 2.9.9 retention/TTL sweep. **Plus 2.6a** (ACL-preserve, ungated extraction).
**Epic 1 (6):** 1.0 provenance materialization · 1.0b boundary probe · 1.3 Graph Router · 1.4 parallel fan-out · 1.5 2-level RRF · 1.6 fan-out observability.
**Epic 4 (1):** 4.1b concept-label re-materialization.
**Epic 6 (1):** 6.1b Authz Resolver.
**Epic 8 (5):** 8.1 fixture site+seed+golden queries · 8.2 multi-graph integration test · 8.3 retrieval-quality eval · 8.4 RRF parameter sweep · 8.5 OPEA-1.5 fallback shim (contingency — see §5.1).

**Updated ACs (15):** 1.1, 1.2, 2.3, 2.5, 2.6, 2.8, 3.2, 4.1, 4.3, 4.4, 4.5, 5.1, 5.2, 5.5, 6.1, 6.4, 7.2, 7.5.

### 2.3 Artifact conflicts (all amendable, none block)

- **PRD** — capability-level; amend FR-18/FR-24/FR-5 consequences; add **FR-34** (async ingestion pipeline) + **FR-35** (query-aware graph selection); glossary (7 terms); non-goals (no dist. transaction; no cross-repo links v1); dependencies (D24); success metrics (launch gates); resolve open-questions Q2/Q7.
- **Architecture** — add §2.1 component map (5 new components), §2.2 collection model (first-class meta fields + okf_versions + okf_audit schema), §2.3 write path (7-step async pipeline), §2.4 read path (Graph Router); close §14 open items (versioning → D20, RRF → D15).
- **ADRs** — 12 new (okf-021..032) + 2 revisions (okf-012, okf-013). No conflicts with 001–020; they *elaborate* 012/013/014/017/018.
- **epics.md / sprint-status** — additive (new epics + stories); no renumbering of existing story IDs or GitLab labels.
- **CI/deployment** — no new vendors; Redis Streams (already used) + the existing document-repository async pattern. Epic 2.9 worker reuses NFR-R2.

### 2.4 Technical impact (grounded)

- **okf-server (Node):** NEW modules `services/ingest-service.js` (orchestrator), `workers/ingestion-worker.js` (Redis Streams), `services/authz-resolver.js`, `services/version-service.js`, `services/source-sync-service.js` (writer), `services/retention-service.js` (sweep). All import `shared-lib` (db-connection-service, logger, tracing, metrics) — **no reinvented connection management** (lesson from Story 2.1 review).
- **document-repository:** Story 2.5 bundle route (ready-for-dev) + the extractMetadata fix (graph_name/repo_id persistence). Stays a blob store.
- **dataprep (gated):** graph_name body-read fix, ACL-preserve (`_finalize_chunk_labels`), repo-level retract, additive metadata.
- **retriever (gated):** multi-graph fan-out, 2-level RRF, ACL on all `search_start`, provenance materialization.
- **ChatQnA (gated):** Graph Router + forward the selected (not all) graph set.
- **ArangoDB:** first-class `okf_concepts_meta` fields + unique index `(repo_id, concept_id)`; new `okf_versions`; `okf_audit` schema (tenant, actor_roles, prev_hash).

---

## 3. Recommended Approach

**Option 1 — Direct Adjustment (chosen):** add Epic 2.9 + Epic 8 + new stories in Epic 1/4/6, 12 new ADRs, targeted PRD/Architecture amendments, GitLab sync. **No rollback, no MVP replan** — the substrate exists; this is wiring + ownership + contracts. Effort: large but sequenced (Phase 1 P0 remediation first). Risk: **medium** — mitigated by the launch gates (§5.2) and the deterministic test fixtures (Epic 8).

**Scope classification: Major** → PM/Architect sign-off (this gate), then Developer execution.

---

## 4. Detailed Change Proposals

### 4.1 New ADRs (`docs/adr/okf-021..032.md`) + 2 revisions

| ADR | Title | Decision source | Closes |
|---|---|---|---|
| **okf-021** | Write-side orchestration — ingest sequence, bundle=zip, no dist. transaction (sweeper reconciles) | D1, D2, D6 | G1, G10, G11 |
| **okf-022** | Node↔Python dataprep handoff — send pre-parsed `concept_bodies[]` (frontmatter stripped) | D3 | G7 |
| **okf-023** | `graph_names` transport across the mega-service boundary — probe `GenieEmbedDoc`, else extend `label_contract` (NOT `search_start` encoding at scale); documents the fallback-shim contingency | D7, D25 | G2 |
| **okf-024** | Graph selection — Graph Router in ChatQnA; domain binding + repo-metadata BM25; `MAX_FANOUT_GRAPHS=5` (configurable); ≤20ms latency gate | D8, D9, D10, D14 | G6 |
| **okf-025** | Authz resolver — token→`{graph_names, per_graph_labels, domains}`; `okf:{tenant}:{repo}:{read\|admin}` scope; per-session cache | D16, D17 | G8, G15 |
| **okf-026** | Trust locality & staleness — denormalize `trust_tier` on `_SOURCE` at index + compute `stale_after` at query; advisory v1 | D11, D12 | G13 |
| **okf-027** | Cross-graph RRF — 2-level hierarchy (within→cross) with per-graph size/confidence weight | D15 | G21 |
| **okf-028** | Cross-repo structural link policy — reject at parse in v1 (within-repo only) | D13 | G22 |
| **okf-029** | Audit integrity — write-before-respond for governance (best-effort for serving); hash chain + write-locked DB user; `tenant`+`actor_roles` fields | D18, D19 | G16 |
| **okf-030** | Lifecycle state machine — explicit `TRANSITIONS` map, auto vs human gates, status reconciliation; `version` = publish side-effect | D21 | G17 |
| **okf-031** | Versioning — repo-level `bundle_version` integer minted on publish, threaded onto chunks/edges/meta; immutable `okf_versions` manifest (resolves PRD §13.2 / arch §14) | D20 | G26 |
| **okf-032** | Retention & TTL — schema'd `retention`/`delete_after`, sweep worker, `deletion_reason` discriminator (origin-delete vs TTL vs retire) | — | G27 |
| **okf-012 (revision)** | Multi-graph grounding — add selection gate (router before fan-out), transport constraint (okf-023), close §14 RRF/versioning items | — | G6, G14 |
| **okf-013 (revision)** | Graph-name wiring — add parallel fan-out concurrency (`Semaphore`), per-graph timeout+skip, partial-failure/error policy (errored repo = zero hits, not 500) | — | G14 |

### 4.2 PRD (`prd-okf-server-2026-07-15/prd.md`)

| Section | Change |
|---|---|
| §3 Glossary | Add: **Write-side Orchestrator**, **Ingestion Worker**, **Graph Router**, **Authz Resolver**, **`bundle_version`** (repo-level), **`MAX_FANOUT_GRAPHS`**, **ACL labels (dual role: ACL enforcement vs selection signal)**, **`okf_concepts_meta.index_status`**. |
| §4.2 FR-5/6/8 consequences | Reference the async orchestrator pipeline (FR-34) + idempotent content-hash re-ingest + orphan sweeper. |
| §4.4 (new) **FR-34** | Async ingestion pipeline: `POST …/ingest` → 202 + `Pending` files doc → Redis Streams → ingestionWorker (concurrency 1, configurable) → doc-repo → dataprep → graph creation → `Indexed`; sweeper reconciles orphans; idempotent content-hash re-ingest. Realizes the store→pending→worker→graph model. |
| §4.4 (new) **FR-35** | Query-aware graph selection (Graph Router): the retriever grounds only in **relevant + authorized** graphs, selected via domain binding + repo-metadata BM25, intersected with the authorized set, capped at `MAX_FANOUT_GRAPHS` (default 5), selection latency ≤20ms. Realizes the multi-repo scaling requirement (D8–D10). |
| §4.4 FR-24 consequences | Add: selection precedes fan-out (FR-35); ACL per-graph via `per_graph_labels` (not global union); unauthorized repo contributes zero hits. |
| §4.6 FR-18 consequences | Add: default-deny (undefined domain → empty set + 404 on foreign repos); per-repo `admin` scope (not global `tools-admin`); Authz Resolver (Story 6.1b) owns token→graph-set. |
| §5 Non-Goals | Add: **no distributed transaction** (compensation via sweeper + per-concept `index_status`); **no cross-repo structural links in v1** (reject at parse, D13). |
| §6 Scope | Add Epic 2.9 (orchestration) + Epic 8 (test infra) to in-scope. |
| §7 Metrics | Add **launch gates** as SM sub-criteria: (a) p95 latency vs graph-count benchmark inside NFR-PR1 at `MAX_FANOUT_GRAPHS`; (b) isolation test (repo-A caller cannot read repo-B chunks); (c) ACL-preserve regression green; (d) audit write-before-respond under ArangoDB failure; (e) boundary probe (`graph_names` survives ChatQnA→retriever deployed, not just in-process). |
| §10 Dependencies | Clarify D24: **wait for the OPEA 1.5 bump merge — no slip date, no fallback shim built now** (contingency documented in ADR-023/Story 8.5). |
| §13 Open Questions | **Resolve** Q2 (versioning → repo-level `bundle_version`, ADR-031) and Q7 (RRF → 2-level + size weight, tuned via Story 8.4). Keep the rest. |

### 4.3 Architecture (`architecture.md`)

| Section | Change |
|---|---|
| §2.1 (new) | **Component map** — who owns what: Crawler (doc-repo), Producer (okf-server Epic 7), **Write-side Orchestrator (NEW)**, **Ingestion Worker (NEW)**, Blob store (doc-repo), Chunker/Embedder (dataprep), Parser (okf-server, exists), Conformance (exists), PII (NEW Story 2.8), **Authz Resolver (NEW)**, **Graph Router (NEW, ChatQnA)**, Retriever (exists, 6 changes), Serving (Epic 5), Control plane (exists, 6 fixes). |
| §2.2 (new) | **Collection model (final)** — first-class `okf_concepts_meta` fields (`title/type/tags/summary/content_hash/lifecycle_status/index_status/trust_tier/stale_after/verified/pii_state/bundle_version/last_good_index_at`) + unique index `(repo_id, concept_id)`; `_SOURCE` gets denormalized `trust_tier`+`concept_id`+`repo_id`+`bundle_version`; NEW `okf_versions`; `okf_audit` adds `tenant`/`actor_roles`/`prev_hash`. |
| §2.3 (new) | **Write path** — the 7-step async ingestion sequence (trigger → resolve → unzip → per-concept parse/UPSERT/conformance/PII/dedup/enqueue → worker drains Pending → sweeper → lifecycle transition). HTTP returns 202 (never blocks on dataprep). |
| §2.4 (new) | **Read path — Graph Router** — authz resolver → graph router (domain binding + repo-metadata BM25 → intersect authorized → cap `MAX_FANOUT_GRAPHS`) → retriever fan-out (parallel, per-graph timeout, ACL on all modes) → 2-level RRF → trust annotation → serve. Latency budget <20ms selection. |
| §3 | Reference §2.4 (selection precedes fan-out); note FR-35. |
| §6 | Rewire step 4 (store+scan) + step 6 (index) to reference the orchestrator (§2.3) + async worker. |
| §8.1 | Add the new okf-server modules (ingest-service, ingestion-worker, authz-resolver, version-service, source-sync, retention). |
| §8.4/8.5 | Reference okf-012/013 revisions (parallel fan-out, per-graph timeout, Graph Router in ChatQnA). |
| §14 Open items | **Close**: versioning → repo-level (ADR-031); RRF → 2-level + size weight (ADR-027, tuned Story 8.4). Keep: repo_id format, domain node level, retention defaults. |

### 4.4 Epics (`epics.md`) — new epics + stories + AC updates

**NEW Epic 2.9: Write-side Orchestration** (ungated Node trunk; 2.9.6 graph-wiring dataprep leg gated). *Closes G1, G4, G5, G7, G9, G10, G11, G26, G27, G32.*
- **2.9.1** `ingestService` + `POST /api/okf/repos/:repo_id/ingest` — the full sequence (§2.3): resolve repo → derive `graph_name`/ACL labels/`bundle_version` → unzip → per-concept parse/UPSERT/conformance/PII/dedup/enqueue → 202. → G1
- **2.9.2** `okf_concepts_meta` UPSERT writer + first-class fields + unique index `(repo_id, concept_id)`; replace filter-and-UPDATE; no-prior-doc assertion. → G9
- **2.9.3** `_LINKS_TO` edge writer (orchestrator post-index, within-repo validated — rejects cross-repo targets per ADR-028). → G7, G22
- **2.9.4** `ingestionWorker` — Redis Streams, drains `Pending`, concurrency 1 (configurable), DLQ, orphan-chunk sweeper. → G10
- **2.9.5** Bundle format = zip of `.md` + server unzip + per-concept fan-out + content-hash dedup. → G11
- **2.9.6** `graph_name` wiring end-to-end (doc-repo payload + dataprep body-read + unified fallback + retract fix — drops the 4 `OKF_{repo_id}_*` collections). **Gated by bump.** → G5
- **2.9.7** `okf_versions` collection + `mintVersion()` on publish + immutable manifest. → G26
- **2.9.8** `okf_sources` writer (source-sync backing store) — `last_commit_sha`, `last_sync_at`, `origin_reachable`. → G32
- **2.9.9** Retention/TTL sweep worker + `deletion_reason` discriminator. → G27

**Story 2.6a (extracted, UNGATED — highest P0 priority):** `_finalize_chunk_labels` ACL-preserve fix (`t:`/`r:`/`d:` prefixes preserved, not dropped) + regression test. The load-bearing wall for OKF isolation. → G4

**NEW Epic 8: Test Infrastructure & Evaluation** (cross-cutting; unblocks G20/G30/G31).
- **8.1** Static HTML fixture site (committed, CI container) + seed script (3 repos × 5–10 concepts) + golden-query file. → G20
- **8.2** Multi-graph retrieval integration test (cross-graph query, provenance, ACL exclusion, size-ratio sweep). → G31
- **8.3** Retrieval-quality eval harness (recall@k, precision@k, MRR, cross-graph citation correctness) — distinct from Story 7.5 draft-quality. → G30
- **8.4** RRF parameter-sweep harness (varies `k` + per-graph weights against seed fixtures). → G21
- **8.5** OPEA-1.5 fallback shim — serial fan-out behind plural `graph_names` on the current base. **Contingency only — not built unless Epic 1 is ungated before the bump merges** (§5.1). → G19

**Epic 1 additions (gated):**
- **1.0** Retriever materializes `graph_name`/`repo_id`/`concept_id` on every hit. Pin as 1.1 dependency. → G18
- **1.0b** Boundary probe — `POST /v1/retrieval` with `graph_names=[G1,G2]`; assert `invoke()` receives both **deployed**, not just in-process. → G2
- **1.3** Graph Router — design spike (pick algorithm, justify, bound <20ms) then implementation; AC: seed 4 repos / 3 domains, assert only relevant graphs traversed. → G6
- **1.4** Parallel fan-out — `asyncio.gather` + `Semaphore(MAX_FANOUT_GRAPHS)` + per-graph timeout/skip + error policy. → G14
- **1.5** 2-level cross-graph RRF + size/confidence weight. → G21
- **1.6** Fan-out observability spans (`graphs_selected`, `graphs_traversed`, `per_graph_latency_ms`, `per_graph_hit_count`). → G24, G35

**Epic 4 addition:** **4.1b** concept-label re-materialization on edit (recompute `chunk_labels`, re-index, ACL-freshness test). → G29

**Epic 6 addition:** **6.1b** Authz Resolver (`authz-resolver.js`) — token → `{graph_names, per_graph_labels, domains}`, per-session cache. → G8

**AC updates (summary — full ACs at create-story time):**
- **1.1** — boundary-probe AC; ACL on `search_start ∈ {node, edge}` (bug fix); deps on 2.6a + 1.0; per-graph contribution counts; unauthorized repo = zero hits.
- **1.2** — name the resolver (6.1b); per-graph label map (not flat list); isolation test.
- **2.3** — reject cross-repo link targets at parse (ADR-028); conformance issue on violation.
- **2.5** — async via worker (2.9.4); server-side `graph_name===OKF_{repo_id}` ownership assertion (4xx on mismatch); extractMetadata graph_name/repo_id persistence.
- **2.6** — ACL-preserve extracted to 2.6a; `retractRepoGraph` drops 4 collections; dataprep body-read fix; unify fallback constant.
- **2.8** — reschedule as publish prerequisite (lifecycle gate); `pii_state` writer on meta.
- **3.2** — "last sync/health" column reads `okf_sources` (2.9.8) or blank-stubbed.
- **4.1** — optimistic concurrency (`If-Match`/409); first-class fields; label re-materialization (4.1b).
- **4.3–4.5** — rewrite against lifecycle state machine (ADR-030); `version` = publish side-effect.
- **5.1** — pre-Epic-1 single-graph fallback; cursor = deterministic re-rank + stable sort.
- **5.2** — direct fetch from `okf_concepts_meta` + doc-repo (NOT retrieval).
- **5.5** — single-repo-scoped traversal; agents select repo first.
- **6.1** — default-deny; `requireScope('okf:read')`; `requireRepoScope(repo_id,'admin')` replaces global `tools-admin`.
- **6.4** — write-before-respond (governance); `tenant`+`actor_roles`; hash chain.
- **7.2** — versioned dump schema `OKF_CRAWL_DUMP_v1` + round-trip segmentation test.
- **7.5** — draft-quality eval only (retrieval-quality → 8.3); per-repo cost-tagging.

**FR coverage map:** add FR-34 → Epic 2.9; FR-35 → Epic 1 (Story 1.3).

### 4.5 `sprint-status-okf-server.yaml` — additions

Add Epic 2.9 block (2.9.1–2.9.9 + 2.6a), Epic 1 additions (1.0, 1.0b, 1.3, 1.4, 1.5, 1.6), 4.1b, 6.1b, and a new Epic 8 block (8.1–8.5) — all `backlog` (2.6a = `backlog` but marked **P0/highest priority/ungated**). Annotate 2.5/2.6/2.8/6.1 with their AC updates.

### 4.6 GitLab sync

- Create labels **`okf-server::epic-2.9`** + **`okf-server::epic-8`** (scope `okf-server`).
- Create ~20 new story issues (the new stories above) labeled `type::story`/`status::backlog`/`prd::okf-server`/`okf-server::epic-X`, with P0/P1 severity labels on the P0 stories (2.6a, 2.9.1, 2.9.2, 6.1 update, 1.0b, 2.9.6).
- Update board #118 with the two new epic columns.
- Post an MR note on !278 summarizing the course correction.

---

## 5. Implementation Handoff

### 5.1 Decision reconciliation — confirm at this gate

**D24 (OPEA 1.5 slip date) + D25 (fallback shim).** The user answered "D24: wait until merge" and "D25: (a) fallback shim." These are in tension: if we wait for the merge (no slip date), the fallback shim's trigger never fires. **My reconciliation (confirm):** D24 governs — **wait for the bump merge; no slip date; no fallback shim is built now.** The (a) shim *design* is documented as a **contingency** in ADR-023 + Story 8.5, activated ONLY if the team later decides to ungate Epic 1 before the merge. This honors both answers and the standing directive ("do not proceed with anything dependent on the OPEA 1.5 bump until merged").

**Epic 2.9 numbering.** The orchestrator epic gets sub-numbered stories **2.9.1–2.9.9** (cleaner than the course-correction doc's mixed 2.9.x/2.1x); the ungated ACL fix stays **2.6a**. Confirm acceptable.

**P0 freeze.** Per the course correction, leaf-story dev (2.5+) was frozen until the P0 gaps had owners + ADRs. **Applying this proposal lifts the freeze** — every P0 then has an owner story + a decided ADR. Phase 1 (P0 remediation: 2.6a → 2.9.6 → 6.1 → 2.9.1/2.9.2 → 1.0b) proceeds immediately for the ungated items; gated P0s (2.9.6, 1.0b) wait for the bump.

### 5.2 Launch gates (must pass before any pilot)

1. p95 search latency vs graph-count benchmark inside NFR-PR1 at `MAX_FANOUT_GRAPHS` (G6).
2. Isolation test: repo-A caller cannot retrieve repo-B chunks in a fused result (G8/G15).
3. ACL-preserve regression green (G4).
4. Audit write-before-respond verified for a governance action under ArangoDB failure (G16).
5. Boundary probe: `graph_names` survives ChatQnA→retriever **deployed**, not just in-process (G2).

### 5.3 Scope & routing

**Major** — PM/Architect sign-off at this gate, then **Developer** execution. On approval I will, in order: write ADRs okf-021..032 + revise okf-012/013 → update PRD → update architecture → update epics → update sprint-status → GitLab sync → commit + push + monitor pipeline to green. Detailed per-story specs are then produced one-at-a-time by `bmad-create-story` starting with the P0 ungated items (2.6a, then 6.1 authz fix, then 2.9.1).

---

## Appendix A — BMAD `correct-course` checklist status

- **§1 Trigger/context:** Done (36 gaps + 25 user-confirmed decisions; repo-grounded evidence in the course-correction doc).
- **§2 Epic impact:** Done (new Epic 2.9 + Epic 8; new stories in Epic 1/4/6; AC updates across 1/2/3/4/5/6/7).
- **§3 Artifact conflicts:** Done (PRD/arch/ADRs/epics — all amendable; no rollback; no existing ID/label renumbering).
- **§4 Path forward:** Done (Direct Adjustment; substrate exists).
- **§5 Proposal components:** Done (§4 above).
- **§6 Final review/handoff:** **Action-needed** — awaiting explicit approval (this gate); sprint-status + GitLab mutations deferred to post-approval.

## Appendix B — Items to confirm at approval

1. **D24/D25 reconciliation** (§5.1): wait for merge, no shim built now, shim design documented as contingency — agree?
2. **Epic 2.9 sub-numbering** (2.9.1–2.9.9) acceptable, or keep the course-correction doc's literal numbering?
3. **Epic 8 (test infra)** as a new epic (vs folding into Epic 1) — agree?
4. Apply all 12 ADRs + PRD/arch/epics/sprint-status edits + GitLab sync in one batch after approval — agree?

---

## 6. Applied (2026-08-13)

**Approved** ("Approve — apply everything (Recommended)") + D24/D25 confirmed ("wait, shim as contingency only"). Applied to `feat/okf-server` + GitLab.

**BMAD artifacts updated (commit `0780ad779`):**
- **12 new ADRs** (`docs/adr/okf-021..032.md`) + revisions to `okf-012`/`okf-013` (all 25 decisions D1–D25 recorded).
- **PRD** — new FR-34 (async ingestion pipeline) + FR-35 (query-aware graph selection); glossary (8 terms); non-goals (no dist. transaction; no cross-repo links v1); launch gates LG-1..LG-5; resolved open Qs (versioning D20/ADR-031, RRF D15/ADR-027); D24 clarified in §10.
- **Architecture** — consolidated end-to-end section (component map, collection model, 7-step async write path, Graph Router read path); §3 read-path reference; §6 write-path reference; §8.1 new modules; §14 open items closed.
- **epics.md** — new Epic 2.9 (stories 2.9.1–2.9.9 + extracted ungated 2.6a), new Epic 8 (8.1–8.5), new stories 1.0/1.0b/1.3/1.4/1.5/1.6/4.1b/6.1b; updated ACs across all 7 epics; FR coverage map (FR-34/35).
- **sprint-status-okf-server.yaml** — Epic 1 additions, Epic 2.9 block, 4.1b, 6.1b, Epic 8 block + annotations.

**GitLab updated:** labels `okf-server::epic-2.9` (id 379) + `okf-server::epic-8` (id 380) created; **23 story issues created — #916–#938** (Epic 2.9: #916–#925; Epic 1: #926–#931; 4.1b #932, 6.1b #933; Epic 8: #934–#938) — labeled `type::story`/`status::backlog`/`prd::okf-server`/`okf-server::epic-X`; MR !278 note posted (id 36923).

**Pipeline:** MR !278 head pipeline **#6070 GREEN** — 71/71 jobs success, 0 failures (commit `0780ad779`).

**Next (dev resumes):** ungated P0 remediation in order — **Story 2.6a** (ACL-preserve, #916) → **Story 6.1 authz fix** (default-deny, #885) → **2.9.1 + 2.9.2** (orchestrator + meta writer). Gated work (Epic 1, 2.9.6) waits for the OPEA 1.5 bump (!277) to merge. Each story is created via `bmad-create-story` then dev'd through the BMAD forward workflow.
