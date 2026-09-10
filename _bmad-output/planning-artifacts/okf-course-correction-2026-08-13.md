# OKF Course Correction v1.0 — Consolidated Architecture & Gap Remediation

**Author:** Chief Architect
**Inputs:** Write-side, Read-side, Control-plane, Testing-context gap reports (4 parallel verified deep-dives)
**Status:** For user sign-off on §3 Decision Points before any further OKF story work proceeds
**Date:** 2026-08-12

---

## 0. Executive Summary

Four independent deep-dives into the OKF architecture converged on a single finding: **the OKF initiative is specified at the *capability* level ("unified multi-graph grounding," "per-repo isolation," "trust-aware retrieval") but not at the *mechanism* level.** Every consumer assumes someone else owns the linchpin components — the write-side orchestrator, the authz resolver, the graph-selection layer, the cross-service transport for `graph_names`. None of those owners exist in any story.

Thirty-six (36) distinct gaps survived deduplication. Of those:

- **6 are P0 BLOCKERS** — they either prevent end-to-end OKF from functioning at all, or they are *active* security/data-integrity defects shipping today (cross-tenant read leak, wrong-graph retract, silently-dropped ACL labels).
- **14 are P1 CRITICAL** — each one blocks a named epic from shipping coherently.
- **11 are P2 HIGH** — silent failures, scaling walls, or compliance holes.
- **5 are P3 MEDIUM** — completeness gaps that will cause rework.

**The single most important recommendation:** freeze all further OKF leaf-story development (Stories 2.4+, Epic 1, Epic 4, Epic 5) until (a) the 6 P0 gaps have an owner story and a decided ADR, and (b) the 20 decision points in §3 are signed off. Building more leaves onto a tree with no trunk is the failure mode the user explicitly named: "I do not want to go into development with design flaws and stupid omissions."

The good news: the substrate to fix most P0s already exists in the code. Dataprep's loader already accepts per-request `graph_name` (`arangodb.py:1287`). The retriever already has the `chunk_labels` filter machinery. The parser already emits links. The fixes are predominantly **wiring + ownership + contract** decisions, not greenfield rebuilds.

---

## 1. Consolidated Gap Register (deduplicated, ranked)

Severity: **P0** = blocker / active defect · **P1** = critical, blocks an epic · **P2** = high, silent/scaling/compliance · **P3** = medium, rework risk.

| # | Gap | Sev | Theme | Source(s) | Fix locus |
|---|-----|-----|-------|-----------|-----------|
| G1 | No write-side orchestrator — nothing sequences parse→validate→PII→index→edges→meta | **P0** | Write | W#1 | New Epic 2.9 + ADR-021 |
| G2 | `graph_names` list cannot cross ChatQnA→retriever mega-service boundary (dynamic `__main__` drops custom fields) | **P0** | Read | R#1 | ADR-023 + boundary-probe story |
| G3 | Cross-tenant read leak: any authed user lists/reads ALL repos across ALL tenants (`callerDomain` no-op filter) | **P0** | Control | C#1 | Story 6.1 update (default-deny) |
| G4 | ACL labels (`t:`/`r:`/`d:`) silently dropped at ingest by `_finalize_chunk_labels` — isolation broken, test-masked | **P0** | Write/Test | W#4, T#1 | Extract Story 2.6a (ungated) |
| G5 | `graph_name` not wired; retract deletes from wrong graph (`GRAPH` vs `genie_graph` mismatch) — active data destruction | **P0** | Write | W#3 | Story 2.14 + ADR-021 |
| G6 | No graph-selection layer — "authorized" treated as "relevant," fan-out unbounded (~300+ round-trips @ 50 repos) | **P0** | Read/Test | R#2, T#3 | New Story 1.3 + ADR-024 |
| G7 | Node↔Python handoff contract undefined — parser work discarded or frontmatter chunked as noise | **P1** | Write | W#2 | ADR-022 |
| G8 | No authz-resolver component owns token→`{graph_names, allowed_labels}` — linchpin of FR-18/FR-24 has no owner | **P1** | Read/Control | R#4, C#3 | New Story 6.1b + ADR-025 |
| G9 | `okf_concepts_meta` never created — `persistConformanceIssues` UPDATEs zero rows; `pii_state`/trust lost silently; test masks it | **P1** | Write/Control | W#5, C#10 | Story 2.13 + ADR-021 |
| G10 | Async ingestion worker doesn't exist — Story 2.5 "async" contract unsatisfiable; only `crawlWorker` exists | **P1** | Write | W#6 | Story 2.10 + ADR-021 |
| G11 | Bundle format undefined (zip/tar/concat?) + no cross-service transaction/compensation; re-ingest duplicates chunks | **P1** | Write | W#7 | Story 2.11 + ADR-021 |
| G12 | ACL `chunk_labels` filter bypassed for `search_start != "chunk"` (entity/edge paths) — latent cross-tenant leak, amplified by fan-out | **P1** | Read | R#3 | Story 1.1 bug-fix AC |
| G13 | Trust/staleness fields live in `okf_concepts_meta`, retriever only reads `_SOURCE` — "advisory trust" is non-functional at retrieval | **P1** | Read | R#5 | ADR-026 |
| G14 | Parallel fan-out asserted but undesigned — no `asyncio.gather`, no per-graph timeout, no partial-failure semantics | **P1** | Read | R#6 | ADR-013 revision + Story 1.4 |
| G15 | Global admin (`tools-admin` realm role) — FR-18 per-repo `admin` scope never enforced; steward in tenant A can delete tenant B's repo | **P1** | Control | C#2 | Story 6.1 update + ADR-025 |
| G16 | Audit integrity: best-effort swallow contradicts SM-4 "100%"; not tamper-evident; no `tenant` field; volume policy undefined | **P1** | Control | C#4 | Story 6.4 + ADR-029 |
| G17 | Lifecycle is a flat array, not a state machine; `version` misclassified as state; `remove` skips `deprecate`; two lifecycles unreconciled | **P1** | Control | C#5 | ADR-030 + Story 4.3 rewrite |
| G18 | Hidden 2.6→1.1 dependency: provenance fields (`repo_id`/`concept_id`/`graph_name`) not materialized on hits | **P1** | Read/Test | R#9, T#4 | New Story 1.0 |
| G19 | OPEA 1.5 bump (!277) is single point of failure for the entire query vision — no fallback, no slip date | **P1** | Test | T#2 | Fallback-shim Story + risk register |
| G20 | Zero deterministic test fixtures — no static crawl site, no seed repos, no golden queries; CI unverifiable | **P1** | Test | T#5 | New test-infra story |
| G21 | Cross-graph RRF mis-weights small repos — naive 2N-channel flatten; "tune empirically" with no testbed | **P2** | Read/Test | R#7, T#11 | ADR-027 + Story 1.5 |
| G22 | Cross-repo structural links neither supported nor rejected — parser will silently choose; traversal breaks at boundary | **P2** | Read | R#8 | ADR-028 + Story 2.3 AC |
| G23 | Serving API (5.1/5.2/5.5) under-specified vs multi-graph model — pre-Epic-1 fallback, get-vs-search read path, traversal scope, cursor pagination | **P2** | Read | R#9 | Story 5.1/5.2/5.5 AC adds |
| G24 | Empty/small repos silently return `[]` in fan-out — no diagnostic; fused result looks sparse, ops blind | **P2** | Read | R#10 | Story 1.6 observability |
| G25 | No optimistic concurrency on governance mutations — last-write-wins on publish/deprecate; lost updates, no audit row for loser | **P2** | Control | C#6 | Story 4.1/4.3 AC (If-Match / 409) |
| G26 | Version materialization: `bundle_version` threaded but never minted; no `okf_versions`; §13.2 open; citation pinning has no backing | **P2** | Control | C#7 | Story 2.15 + ADR-031 |
| G27 | Retention/TTL: no sweep worker, no schema, `retention` field dead; origin-deletion vs retention conflict untracked | **P2** | Control | C#8 | Story 2.17 + ADR-032 |
| G28 | PII/governance services absent; `pii_state` has no writer; publish gate depends on unbuilt Presidio integration | **P2** | Control | C#11 | Story 2.8 resequence + ADR-030 |
| G29 | Graph lifecycle re-index on edit — stale `chunk_labels` persist after label change; cross-repo move orphans chunks | **P2** | Test | T#8 | New Story 4.1b |
| G30 | Story 7.5 eval harness polices *draft* quality, not *retrieval* quality — two failure modes conflated | **P2** | Test | T#6 | New retrieval-eval story |
| G31 | No multi-graph retrieval integration test — only `rrf_fuse` unit tests exist | **P2** | Test | T#7 | New integration-test story |
| G32 | `okf_sources` collection ensured on boot, fully unused — source-sync (FR-2) has no backing store; admin UI blank columns | **P3** | Control | C#9 | Story 2.16 (or remove collection) |
| G33 | Crawl→ingest manual break + single-threaded worker = UX dead-end and throughput ceiling | **P3** | Test | T#9 | Story 7.2 AC + throughput note |
| G34 | `## Source:` dump format is an implicit, unversioned contract between crawler and producer | **P3** | Test | T#10 | Story 7.2 schema-version AC |
| G35 | No observability for graph selection & fan-out — can't diagnose precision/latency degradation | **P3** | Test | T#12 | Story 1.6 spans |
| G36 | No per-repo cost attribution — quotas (Story 7.5 guardrail) unenforceable | **P3** | Test | T#13 | Story 6.4 addendum |

**Source key:** W=Write-side, R=Read-side, C=Control-plane, T=Testing-context (gap numbers from the originating report).

---

## 2. The Complete End-to-End OKF Architecture (unambiguous)

This section defines every component, collection, contract, and data flow so that no story proceeds against an unstated assumption. Each subsection ends with the concrete sequence.

### 2.1 Component Map (who owns what)

| Component | Lives in | Owns | New? |
|-----------|----------|------|------|
| **Crawler** | `document-repository` (crawler.js, crawlWorker.js) | Fetching external sites → versioned crawl dump | Exists (needs schema-versioning) |
| **Producer** | `okf-server` (Epic 7) | Segments dump → drafts concept `.md` files into repo staging | Epic 7 (build) |
| **Write-side Orchestrator** (`ingestService`) | `okf-server` (NEW) | The ingest sequence: fetch bundle → parse per concept → upsert meta → conformance → PII → fan out to doc-repo → write edges → lifecycle transition | **NEW — Epic 2.9** |
| **Ingestion Worker** (`ingestionWorker`) | `okf-server` (NEW) | Drains `Pending` concept-index jobs (Redis Streams), calls doc-repo, reconciles orphans | **NEW — Story 2.10** |
| **Blob store / Dataprep caller** | `document-repository` | Stores bytes, calls dataprep, stays a dumb blob store (no OKF business logic) | Exists (needs `graph_name` threading) |
| **Chunker / Embedder** | `genie-ai-overlay/dataprep` | Per-concept chunking (frontmatter stripped), ACL label preservation, writes `_SOURCE`/`_HAS_SOURCE` | Exists (microservice wrapper needs `graph_name` fix) |
| **Parser** | `okf-server` (parser-service.js) | Frontmatter v0.2 + body + links extraction — pure function | Exists (needs contract) |
| **Conformance** | `okf-server` | Validates structure, records issues on `okf_concepts_meta` | Exists (needs UPSERT + writer) |
| **PII** | `okf-server` (NEW) | Presidio scan, `pii_state`, redaction | **NEW — Story 2.8** |
| **Authz Resolver** (`authz-resolver.js`) | `okf-server` governance (NEW) | Token → `{graph_names, allowed_labels, domains}`; per-graph label map | **NEW — Story 6.1b** |
| **Graph Router** | `genie-ai-overlay/chatqna` OR okf-server governance (DECISION §3.4) | Selects relevant graphs from authorized set (intelligent, not fan-out) | **NEW — Story 1.3** |
| **Retriever** | `genie-ai-overlay/retriever` | Per-graph dense+BM25, ACL filter (all `search_start`), parallel fan-out, 2-level RRF, provenance materialization | Exists (needs 6 changes) |
| **Serving API** | `okf-server` (Epic 5) | search / get-concept / neighbors — two read paths | Epic 5 |
| **Control Plane** | `okf-server` (Epics 3,4,6) | Repos CRUD, lifecycle state machine, version minting, audit, retention | Exists (needs 6 fixes) |

### 2.2 Collection Model (final)

**Per-repo graph (created on first ingest, dropped on retire):**
- `OKF_{repo_id}_SOURCE` — chunks. Fields: `text`, `embedding`, `file_id`, `chunk_labels` (incl. `t:`/`r:`/`d:` ACL), `concept_id`, `repo_id`, `bundle_version`, `trust_tier` (denormalized — G13), `source_type`.
- `OKF_{repo_id}_HAS_SOURCE` — edge: chunk → source doc.
- `OKF_{repo_id}_LINKS_TO` — edge: concept → concept (within-repo only in v1 — G22).
- `OKF_{repo_id}_ENTITY` — (optional) concept entities. Carries `chunk_labels` if used; ACL enforced on all paths (G12).

**Shared control-plane collections:**
- `okf_repositories` — repo record. Add: `version` (minted on publish), `delete_after`, `retention` (schema'd), `okf_version` (validated against content).
- `okf_concepts_meta` — **first-class indexed fields** (G9/G10): `repo_id`, `concept_id`, `title`, `type`, `tags[]`, `labels[]`, `summary`, `frontmatter`, `content_hash`, `lifecycle_status` (`draft|stable|deprecated`), `index_status` (`parsed|indexed|failed`), `trust_tier`, `stale_after`, `verified`, `pii_state`, `bundle_version`, `last_good_index_at`. Unique index `(repo_id, concept_id)`.
- `okf_versions` (NEW — G26): keyed `[repo_id, bundle_version]`, immutable manifest (concept list + hashes).
- `okf_sources` (NEW writer — G32): `repo_id`, `last_commit_sha`, `last_sync_at`, `origin_reachable`, `last_error`.
- `okf_audit` (schema fix — G16): add `tenant`, `actor_roles[]`; index `tenant` + compound `(repo_id, ts)`; hash-chain field `prev_hash`.

### 2.3 Write Path — Ingestion (async, per-concept, idempotent)

This is the answer to the user's concern: **"Async ingestion pattern (store → pending → worker → dataprep → graph creation)."**

```
[1] Steward triggers publish  →  POST /api/okf/repos/:repo_id/ingest
        │   (okf-server Orchestrator)
        ▼
[2] Orchestrator resolves repo → derives:
        graph_name = "OKF_" + repo_id
        ACL labels = [t:<tenant>, r:<repo_id>, d:<domain>]   (from okf_repositories)
        bundle_version = mintVersion(repo_id)   (only on publish transition — G26)
        │
        ▼
[3] Orchestrator fetches + unzips bundle (zip of *.md concept files — G11)
        │
        ▼
[4] FOR EACH concept file (sequential, cheap Node work):
        a. parser-service.parse(file) → {frontmatter, body, links[], concept_id}
        b. UPSERT okf_concepts_meta:                    ← G9 fix (writer now exists)
             title/type/tags/summary (first-class),
             content_hash, lifecycle_status, trust_tier, stale_after,
             bundle_version, index_status='parsed', pii_state='unknown'
        c. conformance-service.run() → UPSERT issues onto meta   (was silent no-op)
        d. pii-service.scan(body) → set pii_state, redact if hit   (G28)
        e. content-hash dedup: if hash unchanged AND index_status='indexed' → skip
        f. ELSE: enqueue per-concept index job → Redis Streams
             payload: { repo_id, concept_id, body(stripped), graph_name,
                        file_labels:[t:,r:,d:], bundle_version }
             create/update files doc: dataprep.status='Pending'
        │
        ▼  (HTTP request returns 202 Accepted here — no blocking on dataprep)
[5] ingestionWorker (concurrency 1 — dataprep serializes anyway; configurable):
        polls files FILTER dataprep.status=='Pending'
        FOR each job:
          i.  doc-repo._ingestFileById({ base64, graph_name,        ← G5 fix
                 file_labels:[t:,r:,d:], concept_id, repo_id,
                 bundle_version })
         ii.  dataprep (microservice reads graph_name from BODY — G5 fix):
                - chunks per-concept body (frontmatter already stripped)
                - _finalize_chunk_labels PRESERVES t:/r:/d: prefixes  ← G4 fix
                - writes OKF_{repo_id}_SOURCE + _HAS_SOURCE
         iii. Orchestrator writes OKF_{repo_id}_LINKS_TO edges       ← G7 fix
                from concept_id → linked concept_ids (within-repo, validated — G22)
         iv.  UPSERT okf_concepts_meta: index_status='indexed',
                last_good_index_at=now(), trust_tier denormalized onto chunks
          v.  on failure: status='Failed' + DLQ + audit row
        │
        ▼
[6] Orchestrator sweeper (scheduled): reconcile orphan chunks
        (chunks whose concept_id has no okf_concepts_meta → retract)
        │
        ▼
[7] All concepts indexed → lifecycle transition (state machine — G17):
        validate → review (auto on conformance pass)
        repo.lifecycle_state updated, audit row written (write-before-respond — G16)
```

**Key properties:**
- HTTP ingest call **never blocks** on dataprep (G10 satisfied).
- Idempotent re-ingest via content-hash (G11).
- No distributed transaction — **compensation via sweeper** + per-concept `index_status` (G11).
- ACL labels are injected by the orchestrator (the only component that knows repo→tenant/domain), and **preserved end-to-end** (G4).

### 2.4 Read Path — The Graph Router (intelligent selection, not dumb fan-out)

This is the answer to the user's concern: **"Intelligent graph selection (not dumb fan-out) — how does the graph router work?"** and **"Label-based query routing."**

The current design (Story 1.1) goes straight from *authorized* → *fan out to ALL*. That is authorization-as-selection and it cannot scale (G6). The fix inserts an explicit **Graph Router** between authz and retrieval.

```
[1] Chat request arrives at ChatQnA with caller's OIDC token
        │
        ▼
[2] AUTHZ RESOLVER  (okf-server governance — G8, new component)
        token claims → resolveOkfScopes() →
          { graph_names: [OKF_repoA, OKF_repoB, ...],   // authorized set
            per_graph_labels: { OKF_repoA: [t:t1, r:repoA, d:domA],
                                 OKF_repoB: [t:t1, r:repoB, d:domB] },
            domains: [domA, domB] }
        (cached per-session; runs on every search — budget its latency)
        │
        ▼
[3] GRAPH ROUTER  (new — Story 1.3)   ← THE INTELLIGENT LAYER
        Input:  query text, authorized graph_names (from [2])
        Steps:
          (a) Domain binding: detect query domain
                — service-category classifier (existing infra), OR
                — match query against okf_repositories.domain
                → near-free exact-match cut. A health query → health repos only.
          (b) Repo-metadata BM25 (one AQL over okf_concepts_meta):
                query vs repo title/type/tags/summary
                → rank candidate repos by metadata relevance
          (c) [Optional v2] Repo-centroid similarity
                (lift existing ARANGO_NUM_CENTROIDS to repo granularity)
          (d) Selection: take top-K candidate repos, INTERSECT with authorized set,
                cap at MAX_FANOUT_GRAPHS (default 5 — §3.5).
          (e) Emit selection rationale as span attributes (G35).
        Output: SELECTED graph set (subset of authorized) + selection reason
        Latency budget: <20ms (§3.6) — this MUST be gated, not "tuned later."
        │
        ▼
[4] RETRIEVER invoke()  (rewired — G2, G6, G12, G14, G18, G21)
        - graph_names passed via DECIDED transport (§3.3) — boundary-proven
        - parallel fan-out: asyncio.gather + Semaphore(MAX_FANOUT_GRAPHS)   ← G14
        - per-graph timeout + skip-on-timeout (log, continue, fuse survivors)
        - per-graph error policy: errored repo contributes zero hits, NOT a 500
        - ACL: chunk_labels filter applied on ALL search_start modes          ← G12
          using per_graph_labels map (per-graph, NOT global union)             ← G8
        - each hit MATERIALIZES graph_name/repo_id/concept_id                  ← G18
        - empty/undersized repos emit structured "0 (undersized)" signal       ← G24
        │
        ▼
[5] FUSION  (2-level RRF — G21)
        - Level 1: within-graph RRF (dense ⊕ BM25) per graph → per-graph top-K
        - Level 2: cross-graph RRF across per-graph top-K,
          weighted by per-graph size/confidence (small-repo normalization)
        │
        ▼
[6] Trust annotation  (G13)
        - trust_tier/stale_after already denormalized on _SOURCE at index time
        - staleness computed at QUERY time: CURRENT_DATE() >= stale_after
        - annotate hits (advisory) OR filter (configurable) — §3.7
        │
        ▼
[7] Serve → agent. Each hit carries provenance for grounding + audit.
```

**How labels drive selection:** Labels serve two distinct purposes, never conflated:
1. **ACL enforcement** (`t:`/`r:`/`d:` prefixes) — applied as `chunk_labels` filter *inside* each graph at retrieval time. Per-graph parameterized (repo A's chunks carry `r:repoA`, repo B's carry `r:repoB`), never a global union (G8).
2. **Selection signal** — the repo's `domain`, and concept `tags`/`type` (first-class on `okf_concepts_meta`), feed the Graph Router's domain-binding and metadata-BM25 steps. This is what makes selection *intelligent*: a query tagged "health" binds to health-domain repos before any chunk is read.

### 2.5 Multi-Repo Scale to 50+ Repos

The fan-out is bounded by **three independent mechanisms**, none of which exist today:

1. **Selection cap** (Graph Router, §2.4[3]) — only relevant graphs are opened. Target: 50 candidate repos → ≤5 selected. This is the order-of-magnitude cut.
2. **Concurrency budget** — `Semaphore(MAX_FANOUT_GRAPHS)` bounds simultaneous ArangoDB load regardless of selection size.
3. **Per-graph timeout + skip** — one cold/small/sick repo cannot stall the query.

Combined with 2-level RRF (size-normalized) and selection-latency gate (<20ms), p95 stays inside NFR-PR1 (≤300ms). **A pre-implementation latency benchmark (p95 vs graph count) is a launch gate, not a "tune later" item** (G6). Spans emit `graphs_selected`, `graphs_traversed`, `per_graph_latency_ms`, `per_graph_hit_count` so degradation is diagnosable (G35).

### 2.6 Crawler → OKF Repo (the user's testing plan)

This is the answer to the user's concern: **"Crawler → OKF repo creation."**

```
[1] Crawl job (SITE_PRESETS or custom URL set)
      crawlWorker polls, fetches pages
      writes dump in VERSIONED schema: OKF_CRAWL_DUMP_v1               ← G34
        format: header + ## Source: <url> blocks (contract documented)
        │
        ▼
[2] Post-crawl trigger (idempotent, decoupled from worker success — G33)
      fires on crawl_job.status='Succeeded'
      → invokes Producer (Epic 7)
        │
        ▼
[3] Producer segments dump on ## Source: blocks                      ← G34
      → drafts concept .md files (frontmatter v0.2 + body + links)
      → writes to repo staging area (status=draft)
      → Presidio/ClamAV scan drafts
        │
        ▼
[4] Steward reviews drafts (Epic 4 admin UI)
      approves/rejects/edits concept drafts
        │
        ▼
[5] Publish → triggers Orchestrator ingest (§2.3)
```

**Testing plan (deterministic — G20, the highest-leverage testing investment):**
- **Static HTML fixture site** (3–5 pages, committed, served via fixture container in CI) — replaces live-site crawl dependency.
- **Seed script** creating 3 known OKF repos (`OKF_REPO_HEALTH`, `OKF_REPO_AGRI`, `OKF_REPO_LEGAL`) with 5–10 known concepts each, known labels, known ACL prefixes.
- **Golden-query file** mapping queries → expected concept IDs per repo (ground truth for selection + retrieval eval).
- **Dump-format round-trip test** (producer test asserting correct segmentation).

This fixture trinity unblocks G20, G30, G31, and makes the user's "verify the strategy is solid" goal actually measurable.

### 2.7 Serving API Clarifications (G23)

- **5.1 search** — pre-Epic-1 fallback = single-graph (the legacy free-form corpus only). Document this. Multi-graph fan-out activates when Epic 1 lands. Cursor pagination = deterministic re-rank with stable sort key (not stateful cursors — NFR-R1 stateless); document the re-index caveat.
- **5.2 get-concept** — this is a **direct fetch** from `okf_concepts_meta` + document-repository (the `.md` source), NOT retrieval. A concept is N chunks; `get` returns the concept, not a chunk. Two read paths, explicitly documented.
- **5.5 neighbors** — **single-repo-scoped** traversal (`OKF_{repo}_LINKS_TO`). Agents select a repo first (via search or explicit `repo_id`), then traverse. Multi-graph traversal fusion is out of scope for v1 (G22 closed as "reject cross-repo links").

---

## 3. Architecture Decision Points (require user sign-off)

These are the decisions that shape everything downstream. Each is gated: the stories that depend on it cannot be written coherently until it is made. **Recommended** options are marked; the user may override.

### Write-side

| # | Decision | Options | Recommended | Unblocks |
|---|----------|---------|-------------|----------|
| D1 | Orchestrator home | (a) okf-server `ingestService` (b) doc-repo | **(a)** — doc-repo stays a blob store; OKF business logic lives in okf-server | G1, Epic 2.9 |
| D2 | Bundle format | (a) zip of `.md` (b) tar (c) per-concept calls | **(a) zip** — atomic upload, server unzips | G11 |
| D3 | Node↔Python handoff | (a) send pre-parsed `concept_bodies[]` in dataprep request (b) send raw, let docling chunk frontmatter | **(a)** — preserves parser work, clean chunks | G7, ADR-022 |
| D4 | `_LINKS_TO` edge writer | (a) Orchestrator writes directly to Arango post-index (b) dataprep writes from `links[]` it receives | **(a)** — keeps dataprep focused on chunking | G7 |
| D5 | Async pattern | (a) Redis Streams + worker (concurrency 1) (b) sync-per-concept with timeout+429 | **(a)** — matches NFR-R2, durable, DLQ | G10 |
| D6 | Transaction strategy | (a) accept no dist. transaction; sweeper reconciles orphans (b) saga | **(a)** — simpler, fits async model | G11 |

### Read-side

| # | Decision | Options | Recommended | Unblocks |
|---|----------|---------|-------------|----------|
| D7 | `graph_names` transport across mega-service boundary | (a) add to `GenieEmbedDoc` + boundary probe (likely dropped) (b) encode in `search_start` alongside labels (brittle @ 50+) (c) extend `label_contract.py` to carry graph list | **Probe first.** If dropped (expected), use (c) — extend `label_contract` cleanly. Do NOT use (b) at scale. | G2, ADR-023 |
| D8 | Graph selection algorithm (v1) | (a) domain binding + repo-metadata BM25 (b) repo-centroid similarity (c) lightweight classifier | **(a)** — uses existing data, near-free, order-of-magnitude cut | G6, Story 1.3 |
| D9 | `MAX_FANOUT_GRAPHS` budget | value: 3 / 5 / 10 | **5** — balances coverage vs latency | G6, G14 |
| D10 | Selection latency budget | value | **≤20ms** — must be a gate, not aspirational | G6 |
| D11 | Trust locality | (a) denormalize `trust_tier` on `_SOURCE` at index + compute `stale_after` at query (b) AQL join `okf_concepts_meta` at query (c) advisory annotation only | **(a) hybrid** — cheap reads, fresh staleness | G13, ADR-026 |
| D12 | Trust enforcement | (a) advisory annotate (b) configurable filter | **(a) advisory v1**, (b) later — scope FR-29 honestly | G13 |
| D13 | Cross-repo structural links | (a) reject at parse (within-repo only) (b) support via shared edge collection | **(a) reject v1** — simplest, matches single-repo traversal | G22 |
| D14 | Graph Router home | (a) ChatQnA (b) okf-server governance | **(a) ChatQnA** — it's on the hot path and already calls retriever; but authz resolver stays in okf-server | G6, G8 |
| D15 | Cross-graph RRF | (a) 2-level hierarchy (within→cross) with size weight (b) flat 2N-channel | **(a)** | G21, ADR-027 |

### Control-plane

| # | Decision | Options | Recommended | Unblocks |
|---|----------|---------|-------------|----------|
| D16 | Authz scope encoding | (a) `okf:{tenant}:{repo}:{read\|admin}` scope string (b) custom claim (c) Keycloak role mapper | **(a) scope string** — matches FR-18; document mapper | G8, G15, ADR-025 |
| D17 | Authz resolver cache | (a) per-request (b) per-session | **(b) per-session** — hot path; revoke on token refresh | G8 |
| D18 | Audit failure mode | (a) write-before-respond for governance; best-effort for serving (b) all best-effort | **(a)** — SM-4 for governance, volume-tolerant for serving | G16, ADR-029 |
| D19 | Tamper-evidence | (a) hash chain + root publication (b) write-locked DB user (no UPDATE/DELETE) (c) both | **(c) both** — public-sector compliance | G16 |
| D20 | Versioning granularity (resolves §13.2) | (a) repo-level `bundle_version` integer (b) per-concept | **(a) repo-level** — minted on publish, threaded onto chunks/edges/meta | G26, ADR-031 |
| D21 | Serving status rule | served iff `repo.lifecycle_state='published'` AND `concept.lifecycle_status ∈ {stable, deprecated}` | **as stated** | G17, G28 |
| D22 | PII gating | (a) publish prerequisite (blocking) (b) parallel story | **(a) blocking prerequisite** — NFR-P1 | G28 |
| D23 | Cursor pagination | (a) deterministic re-rank + stable sort (b) stateful server cursors | **(a)** — preserves NFR-R1 stateless | G23 |

### Program-level

| # | Decision | Options | Recommended | Unblocks |
|---|----------|---------|-------------|----------|
| D24 | OPEA 1.5 slip date | concrete date | **set a date** — if !277 not merged by then, fallback shim ships | G19, T#2 |
| D25 | Fallback shim | (a) serial fan-out shim behind `graph_names` plural interface on current base (b) none | **(a)** — unblocks Epic 1 testing now | G19 |

---

## 4. Existing Stories Requiring Updates

Each row: story → what changes → which gap(s) it closes.

### Epic 1 (Multi-graph retrieval)
| Story | Change | Closes |
|-------|--------|--------|
| **1.1** | (a) Add AC: boundary probe asserts `graph_names` arrives at `invoke()`. (b) Add AC: ACL `chunk_labels` filter applied on `search_start ∈ {node, edge}`, not just `chunk` — bug fix. (c) Add dependency: "Requires Story 2.6a (ACL preserve) + Story 1.0 (provenance materialization)." (d) Add AC: per-graph contribution counts emitted. (e) Add AC: unauthorized repo contributes zero hits in fused result. | G2, G4, G12, G18, G24 |
| **1.2** | (a) Name the resolver component (Story 6.1b). (b) Require per-graph label parameterization (`graph_name → labels` map, not flat list). (c) Add isolation test: caller scoped to repo A cannot read repo-B chunks. | G8, G15 |
| **1.0** (new — see §5) | Materialize `graph_name`/`repo_id`/`concept_id` on every hit. Pin as 1.1 dependency. | G18 |

### Epic 2 (Ingestion / write-side)
| Story | Change | Closes |
|-------|--------|--------|
| **2.3** (parser) | Add AC: reject cross-repo link targets at parse (validate `concept_id` within same `repo_id`); emit conformance issue on violation. Clarify "closed namespace = within one repo." | G22 |
| **2.4** (bundle) | Rescope: bundle = zip of `.md`; this story defines the zip contract + server unzip. Move per-concept fan-out to Epic 2.9 orchestrator. | G11 |
| **2.5** (doc-repo bundle route) | (a) Make explicit: async via Redis Streams worker (Story 2.10) OR sync-per-concept with documented timeout — pick one (§3 D5). (b) Add server-side assertion `graph_name === 'OKF_'+repo_id` (reject ownership mismatch as 4xx, not format-only). (c) Thread `graph_name` + ACL `file_labels` into `_ingestFileById` payload. | G5, G10 |
| **2.6** (graph wiring + retract) | (a) **Extract** the ACL-preserve fix into Story 2.6a (ungated, additive). (b) Implement `retractRepoGraph` dropping the 4 `OKF_{repo_id}_*` collections. (c) Fix dataprep microservice: read `graph_name` from request body at `:191` and `:292`. (d) Unify fallback constant. | G4, G5 |
| **2.8** (PII) | Reschedule as **publish prerequisite** (lifecycle gate), not parallel. Add `pii_state` writer on `okf_concepts_meta`. | G28 |

### Epic 3 (Admin UI)
| Story | Change | Closes |
|-------|--------|--------|
| **3.2** (repo dashboard) | Add AC: "last sync / health" column reads from `okf_sources` (Story 2.16 must land first or column is explicitly blank-stubbed). | G32 |

### Epic 4 (Curation / lifecycle)
| Story | Change | Closes |
|-------|--------|--------|
| **4.1** (concept CRUD) | (a) Add optimistic concurrency: expose `_rev`, accept `If-Match`, return 409 on mismatch. (b) Add concept-label re-materialization on edit (Story 4.1b). (c) First-class `title/type/tags/summary` fields. | G9, G25, G29 |
| **4.3–4.5** (transitions/version) | Rewrite against the lifecycle state machine (ADR-030): explicit `TRANSITIONS` map, auto vs human gates, transition endpoints, `repo.transition` audit rows. Demote `version` to publish side-effect. | G17, G26 |

### Epic 5 (Serving)
| Story | Change | Closes |
|-------|--------|--------|
| **5.1** (search) | (a) Define pre-Epic-1 single-graph fallback. (b) Cursor = deterministic re-rank + stable sort. (c) Hard dependency on Epic 1 for fan-out. | G23 |
| **5.2** (get-concept) | Name the read path: direct fetch from `okf_concepts_meta` + doc-repo; NOT retrieval. | G23 |
| **5.5** (neighbors) | State single-repo scope; agents select repo first. | G22, G23 |

### Epic 6 (Governance / authz)
| Story | Change | Closes |
|-------|--------|--------|
| **6.1** (authz) | (a) Default-deny: undefined domain → empty list + 404 on foreign repos (not full catalog). (b) `requireScope('okf:read')` middleware. (c) Replace global `tools-admin` with `requireRepoScope(repo_id, 'admin')`. (d) Resolve scope claims from token in `auth.js`. | G3, G15 |
| **6.4** (audit) | (a) Write-before-respond for governance; best-effort for serving. (b) Add `tenant` + `actor_roles` fields + indexes. (c) Hash chain. (d) Define audit-worthy serving actions + volume policy. | G16 |

### Epic 7 (Producer)
| Story | Change | Closes |
|-------|--------|--------|
| **7.2** (post-crawl trigger) | (a) Idempotent + decoupled (already). (b) Define dump schema `OKF_CRAWL_DUMP_v1` + version check. (c) Round-trip segmentation test. | G33, G34 |
| **7.5** (eval) | Clarify scope: draft-quality only. Split retrieval-quality eval into separate story (§5). Add per-repo cost-tagging AC. | G30, G36 |

---

## 5. New Stories & ADRs Required

### New ADRs (all require user sign-off on §3 decisions)

| ADR | Title | Decision source |
|-----|-------|-----------------|
| **ADR-okf-021** | Write-side orchestration — ingest sequence, bundle format, transaction strategy | D1, D2, D6 |
| **ADR-okf-022** | Node↔Python dataprep handoff contract — pre-parsed concept bodies | D3 |
| **ADR-okf-023** | `graph_names` transport across the mega-service boundary | D7 |
| **ADR-okf-024** | Graph selection — router design, algorithm, MAX_FANOUT, latency gate | D8, D9, D10, D14 |
| **ADR-okf-025** | Authz resolver — token→graph-set, per-graph labels, scope encoding, cache | D16, D17 |
| **ADR-okf-026** | Trust locality & staleness — denormalize + query-time computation | D11, D12 |
| **ADR-okf-027** | Cross-graph RRF — 2-level hierarchy + size normalization | D15 |
| **ADR-okf-028** | Cross-repo structural link policy — reject in v1 | D13 |
| **ADR-okf-029** | Audit integrity — write-before-respond, hash chain, tenant field, tamper-evidence | D18, D19 |
| **ADR-okf-030** | Lifecycle state machine — transitions, auto vs human gates, status reconciliation | D21 |
| **ADR-okf-031** | Versioning strategy — repo-level `bundle_version` (resolves §13.2) | D20 |
| **ADR-okf-032** | Retention & TTL — schema, sweep worker, deletion_reason discriminator | — |
| **ADR-okf-012 (revision)** | Cross-graph fusion, selection gate, transport constraint; close §14 open items | — |
| **ADR-okf-013 (revision)** | Parallel fan-out concurrency, per-graph timeout, partial-failure/error policy | — |

### New Stories (grouped by home epic)

**New Epic 2.9 — Write-side Orchestration** (the trunk everything hangs on)
- **Story 2.9.1**: `ingestService` + `POST /api/okf/repos/:repo_id/ingest` — the full sequence (§2.3). Calls parser → UPSERT meta → conformance → PII → enqueue. → G1
- **Story 2.9.2**: `okf_concepts_meta` writer + `UPSERT` (replace filter-and-UPDATE); demote the test that masks the gap; add no-prior-doc assertion. → G9
- **Story 2.9.3**: `_LINKS_TO` edge writer (orchestrator post-index, within-repo validated). → G7, G22
- **Story 2.10**: `ingestionWorker` — Redis Streams, drains `Pending`, concurrency 1 (configurable), DLQ, orphan-chunk sweeper. → G10
- **Story 2.11**: Bundle format (zip) + server unzip + per-concept fan-out + content-hash dedup. → G11
- **Story 2.13**: (covered by 2.9.2) concept-meta writer with first-class fields. → G9, G10(concept)
- **Story 2.14**: `graph_name` wiring end-to-end (doc-repo payload + dataprep microservice body-read + unified fallback + retract fix). → G5
- **Story 2.15**: `okf_versions` collection + `mintVersion()` on publish + immutable manifest. → G26
- **Story 2.16**: `okf_sources` writer (source-sync) — `last_commit_sha`, `last_sync_at`, `origin_reachable`. → G32
- **Story 2.17**: Retention/TTL sweep worker + `deletion_reason` discriminator. → G27
- **Story 2.6a** (extracted, ungated): `_finalize_chunk_labels` ACL-preserve fix + regression test. → G4

**Epic 1 additions**
- **Story 1.0**: Retriever materializes `graph_name`/`repo_id`/`concept_id` on every hit. Pin as 1.1 dependency. → G18
- **Story 1.0b**: Boundary probe — POST `/v1/retrieval` with `graph_names=[G1,G2]`; assert `invoke()` receives both. → G2
- **Story 1.3**: Query-aware graph-set selection — design spike (pick algorithm, justify, bound <20ms) then implementation. AC: seed 4 repos / 3 domains, assert only relevant graphs traversed. → G6
- **Story 1.4**: Parallel fan-out — `asyncio.gather` + `Semaphore(MAX_FANOUT_GRAPHS)` + per-graph timeout/skip + error policy. → G14
- **Story 1.5**: 2-level cross-graph RRF + size/confidence weight. → G21
- **Story 1.6**: Fan-out observability spans (`graphs_selected`, `graphs_traversed`, `per_graph_latency_ms`, `per_graph_hit_count`). → G24, G35

**Epic 4 additions**
- **Story 4.1b**: Concept-label re-materialization on edit (recompute `chunk_labels`, re-index, ACL-freshness test). → G29

**Epic 6 additions**
- **Story 6.1b**: Authz resolver component (`authz-resolver.js`) — token → `{graph_names, per_graph_labels, domains}`, per-session cache. → G8

**Test-infra (cross-cutting — recommend a new Epic 8 or fold into Epic 1)**
- **Story 8.1**: Static HTML fixture site (committed, CI container) + seed script (3 repos × 5–10 concepts) + golden-query file. → G20
- **Story 8.2**: Multi-graph retrieval integration test (cross-graph query, provenance, ACL exclusion, size-ratio sweep). → G31
- **Story 8.3**: Retrieval-quality eval harness (recall@k, precision@k, MRR, cross-graph citation correctness) — distinct from Story 7.5. → G30
- **Story 8.4**: RRF parameter-sweep harness (varies `k` + per-graph weights against seed fixtures). → G21, G11(tuning)
- **Story 8.5**: OPEA 1.5 fallback shim (serial fan-out behind `graph_names` plural interface on current base). → G19

---

## 6. Sequencing & Launch Gates

**Phase 0 — Freeze + Decide (this week):**
No further OKF leaf-story work until §3 decisions D1–D25 are signed off and ADRs 021–032 are drafted. Rationale: G1, G2, G6, G8 are trunk decisions; building leaves first is the named failure mode.

**Phase 1 — P0 remediation (unblocks everything):**
1. Story 2.6a (ACL preserve) — **highest priority, ungated.** The load-bearing wall.
2. Story 2.14 (graph_name wiring + retract fix) — active data destruction.
3. Story 6.1 update (default-deny + scope middleware) — active cross-tenant leak.
4. Story 2.9.1 + 2.9.2 (orchestrator + meta writer) — end-to-end ingest becomes possible.
5. Story 1.0b (boundary probe) — determines the entire read-side transport shape.

**Phase 2 — Foundation (unblocks Epic 1/4/5):**
Stories 1.0, 1.3, 2.10, 2.11, 6.1b, 8.1 (fixtures). ADRs 022–028.

**Phase 3 — Scale + Harden:**
Stories 1.4, 1.5, 1.6, 2.15–2.17, 4.1b, 8.2–8.4. ADRs 029–032.

**Launch gates (must pass before any pilot):**
- p95 search latency vs graph-count benchmark inside NFR-PR1 at `MAX_FANOUT_GRAPHS` (G6).
- Isolation test: caller scoped to repo A cannot retrieve repo-B chunks in a fused result (G8/G15).
- ACL-preserve regression green (G4).
- Audit write-before-respond verified for a governance action under ArangoDB failure (G16).
- Boundary probe: `graph_names` survives ChatQnA→retriever in the deployed mega-service, not just in-process (G2).

---

## 7. User Concerns — Explicit Cross-Reference

| User concern | Addressed in | Key mechanism |
|--------------|--------------|---------------|
| **Intelligent graph selection (not dumb fan-out) — how does the graph router work?** | §2.4[3], ADR-024, Story 1.3, D8–D10 | Graph Router component: domain binding + repo-metadata BM25 → intersect with authorized set → cap at `MAX_FANOUT_GRAPHS` (5), <20ms gate |
| **Async ingestion (store → pending → worker → dataprep → graph)** | §2.3, ADR-021, Stories 2.9.1/2.10, D5/D6 | POST ingest → 202 + `Pending` files doc → Redis Streams → `ingestionWorker` (concurrency 1) → doc-repo → dataprep → graph creation → `Indexed`; sweeper reconciles orphans |
| **Label-based query routing (how labels drive graph selection)** | §2.4[2–3], ADR-025, Story 6.1b | Two roles: (1) ACL `t:/r:/d:` → per-graph `chunk_labels` filter at retrieval; (2) concept `tags`/`type` + repo `domain` → Graph Router selection signals |
| **Crawler → OKF repo creation (testing plan)** | §2.6, Stories 8.1/7.2, G20/G33/G34 | Versioned dump → idempotent post-crawl trigger → producer segments → steward review → publish → ingest; deterministic fixture site + seed repos + golden queries |
| **Multi-repo query traversal scaling to 50+ repos** | §2.5, Stories 1.3/1.4/1.5/1.6, D9 | Three bounds: selection cap (50→≤5), `Semaphore` concurrency, per-graph timeout+skip; 2-level size-normalized RRF; latency benchmark gate |

---

## 8. Bottom Line

The OKF architecture has the right *ingredients* — per-repo graphs, ACL labels, trust fields, a parser, a conformance service, a proven retriever — but it is missing the *connective tissue*: the orchestrator that sequences ingest, the authz resolver that translates tokens into graph sets, the graph router that selects relevant graphs, and the boundary-proven transport that carries selection across the mega-service.

Six P0 gaps are either active defects (cross-tenant read leak, wrong-graph retract, dropped ACL labels) or absolute blockers (no orchestrator, no graph-selection, broken transport). None of them are refinements — they are missing or broken load-bearing walls.

**Recommended immediate action:** sign off on §3 decision points, draft ADRs 021–032, and land Phase 1 (P0 remediation) before any further leaf story ships. The fixes are predominantly wiring and ownership decisions — the substrate to implement them already exists in the code.