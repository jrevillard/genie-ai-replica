# OKF Fan-Out Course-Correction — 2026-09-20

**Trigger:** David's directive — before executing Epic 1, validate the Epic 1 story
assumptions (written 2026-08-13, amended 2026-09-10) against what the last two weeks of
build/import/ingest/workflow work actually changed. All findings below are verified
against code on `feat/okf-server` with file:line citations.

**Standing context:** OPEA 1.5 is carried by this branch (rebased 2026-09-10;
`genie-ai-overlay/retriever/Dockerfile-retriever_genie-ai:4` → `OPEA_VERSION="v1.5"`).
No external merge is pending or in scope. Everything below lands additively on
`feat/okf-server`.

---

## 1. The fan-out decision metadata — authoritative inventory (the critical piece)

What the graph-selection code path will actually query, per artifact:

### 1.1 `workingGraphName(repo)` — the graph-name authority
`components/okf-server/services/graph-lifecycle-service.js` (tested in
`__tests__/graph-lifecycle-service.test.js:65-77`):
- Draft repo (version N building): graph is **born** `OKF_<slug>_v{N+1}`.
- Serving repo (`lifecycle_state === 'publish'`): graph is `OKF_<slug>_v{N}`.
- `ingested_at` set = drained/Ingested lane truth.

**Consequence for Epic 1:** the story-1.1 wording "`GRAPH` + caller's `OKF_{repo_id}` set"
is **stale**. There is no stable `OKF_{repo_id}` name — serving graph names are
**versioned** (`OKF_<slug>_v<ingested_version>`) and change on every publish→drain cycle.
The authz resolver (6.1b) must compute graph names from the **repo doc** at resolution
time via `workingGraphName`, never from a static per-repo constant, and never from the
manifest's stamped `version` (see 1.3).

### 1.2 `okf_repositories` — the serving-truth + graph-name source
Fields the resolver/router need (kept in `buildManifestDoc`'s repo KEEP plus lifecycle
fields): `repo_id, name, slug, domain, okf_tag, cloned_from, summary_override,
lifecycle_state, version, ingested_at, ingested_version, metrics`.

**Serving truth = `lifecycle_state === 'publish' && ingested_at`** — the same predicate
that buckets the Ingested lane in the frontend (`store/modules/okf.js` `laneFor`). This
predicate — NOT manifest presence — decides whether a repo contributes a graph.

### 1.3 `okf_bundle_manifest` — the discovery corpus (and its two traps)
Written at settle (`writeManifest`, concept-meta-service.js:691), refreshed at mint
(version-service.js:401). Carries: `repo_id, name, domain, okf_tag, version, root_id,
concepts[] {id,title,type,is_index,index_status,chunk_count,labels[]},
links[] {from,to,weight,source:'author'}, summary_stats {concept_count,root_*,
indexed_count,rejected_count,link_count}, summary_text (lazy LLM), cloned_from`.

**Trap 1 — retracted repos keep their manifest BY DESIGN**
(graph-retract-service.js:38: "a retracted repository stays visible and editable";
only DELETE purges it, :222-235). `discoverRepos` (concept-meta-service.js:728-765)
scans **all** manifests with **no lifecycle join** — it will score retracted repos that
have **no serving graph**. For the chat-path router this wastes selection slots against
`MAX_FANOUT_GRAPHS=5` and can evict a live repo. → **Amendment A** (§2).

**Trap 2 — version skew during re-publish.** The manifest's `version` is stamped at
settle/mint. During a re-publish window (drain building `v{N+1}` while `v{N}` serves)
the manifest may reflect the NEW version while the repo doc's `ingested_version` still
pins the OLD serving graph. → Graph names come from the **repo doc only** (1.1, 1.2);
manifest `version` is display/skew-diagnostic metadata, never a router input.

### 1.4 Discovery scoring (already live, reused by 1.3)
`discoverRepos({tokens, labels, domain}, {k})` — label overlap ×3 (both sides
lowercased, review P6), name+domain token match ×1, k clamped 1..50, domain filter
excludes null-domain manifests (review P9). Output `{repo_id,name,domain,summary_text,score}`.
It is a full-collection scan per call — fine at current repo counts, but the ≤20ms
router gate (1.3) needs a **selection-level cache** (manifests only change at
settle/mint — invalidate on write, or short TTL). → **Amendment E** (§2).

### 1.5 Authorization scopes (write-side exists; read-side resolver does not)
`callerAuthz` (repository-controller.js:62-78): super-admin wildcard / per-user repo
scope list → `authorizedRepoIds`. This is the **same source** the 6.1b read-side
resolver extracts into a token→`{graph_names, per_graph_labels, domains}` endpoint.
Today nothing resolves graphs for the read path (grep: no retrieval-config, no
`okf_system_config`, no resolver endpoint).

### 1.6 Chunk provenance fields
Content-only chunking (WP-C): **chunk `file_id == concept_id`**
(ingest-service.js:1109). Chunk docs live in `<GRAPH>_SOURCE`; the graph name is
therefore ambient per fan-out leg — in multi-graph mode, each per-graph search already
knows its graph, so Story 1.0's provenance materialization is a **fusion-time**
attribution (`graph_name` from the leg, `repo_id` derived from the resolver's
graph→repo map, `concept_id` from `chunk.file_id`), not a chunk-doc write. Simpler than
the story's original framing. → **Amendment C** (§2).

### 1.7 Label-contract carrier (1.0b's proven pattern)
chatqna encodes filter labels into `search_start`
(genieai_chatqna.py:906-928 "DATA CONTRACT"); the retriever decodes via
`genie-ai-overlay/core/label_contract.py` (copied into the image,
Dockerfile-retriever:89-90). `genieai_api_protocol.py` is an overlay-owned file
(Dockerfile:99) — extending it additively is possible. The 1.0b probe decides
empirically whether `graph_names` rides the same encode or a new proto field.

---

## 2. Amendments to Epic 1 stories (all are plan corrections, not scope changes)

**A — Discovery must be serving-aware (affects 1.3 + resolver).**
`discoverRepos` gains a lifecycle join (or a serving-only variant used by the chat
path): join `okf_bundle_manifest.repo_id → okf_repositories`, score only
`lifecycle_state==='publish' && ingested_at`. Retracted repos stop occupying fan-out
slots. (Trap 1.)

**B — Graph set = versioned serving names resolved from the repo doc (affects 1.1,
1.2, 6.1b).** Resolver computes `workingGraphName(repo)` per authorized, serving repo
at request time; cache TTL ≤30s bounds the re-publish skew; the retriever tolerates a
graph that vanished between resolution and traversal (retract/re-publish race) as
zero-hit, not an error. (Trap 2.)

**C — Story 1.0 provenance is fusion-time attribution (simplification).**
`graph_name` per fan-out leg + repo from the resolver map + `concept_id` from
`chunk.file_id`. No chunk-schema change needed. (§1.6.)

**D — Per-graph label map source pinned (affects 6.1b/1.2).** The label ACL continues
to ride the existing `search_start` label-contract per graph; the resolver emits
per-graph label sets from the same scope source as `callerAuthz` — one carrier
mechanism, now parameterized per leg.

**E — Router selection cache (affects 1.3).** Discovery scores are cached at the
selection layer (invalidate on manifest write/mint) to hold the ≤20ms gate; the
in-scan LLM `summary_text` stays lazy/off-path (label overlap + tokens suffice for
selection; summary is augmentation only).

**F — 8.1 seed fixtures must be born-right.** Fixtures go through the real lifecycle
(create → curate → publish → drain) so graphs/manifests are born with production
names — no hand-seeded collections (no-dirty-hacks rule; the smoke harness per story
extends `check-okf-repo.js`-style physical assertions).

**G — Legacy-path regression guard gets teeth (1.1/1.7 CI).** `legacy` mode +
single-graph calls assert identical results AND spans vs pre-Epic-1 on seed fixtures —
the ADR-039 D8 invariant, CI-asserted, extending the existing smoke harness.

**H — i18n and docs are completion gates (per David, 2026-09-20).** Every story that
touches user-visible surfaces (10.7 card, any toast/label) ships all 14 locales
(ar,bn,de,en,es,fr,id,man,pt,ru,st,sw,th,zh) with en.js as source of truth, and updates
`site/content/en/docs/` (architecture §8.4/§8.5 retriever fan-out; knowledge-base for
mode governance) + dev-internal `docs/` notes before it can be marked done.

---

## 3. Confirmed-unbuilt (validated 2026-09-20, no [BUMP] blocker in-branch)

| Story | Evidence of absence |
|---|---|
| 1.0 provenance | single-graph path returns raw chunks, no attribution |
| 1.0b boundary probe | no `graph_names` anywhere in retriever/chatqna |
| 1.1 fan-out | `genieai_retriever_arangodb.py:785` single `graph_name` |
| 1.2 chatqna forwarding | `genieai_chatqna.py:927` forwards `search_start` only; backend BFF has no graph concept |
| 1.3 router | no router module; discovery endpoint exists (reusable) |
| 1.4 parallel fan-out | no gather/semaphore/timeout in retriever |
| 1.5 2-level RRF | `rrf_fuse` (line 137) is within-graph dense⊕BM25 only |
| 1.6 spans | no fan-out spans in retriever |
| 1.7 config legs | no `okf_system_config`, no `/retrieval-config` in okf-server |
| 6.1b resolver | only write-side `callerAuthz`; no token→graph-set read path |
| 10.7 Studio card | no retrieval controls in StudioTab |

Build order (recorded in sprint-status.yaml): **1.7 legs → 6.1b → 1.0b → 1.0 → 1.1 →
1.4 → 1.5 → 1.2 → 1.3 → 1.6 → 10.7**, with 8.1 fixtures pulled alongside Wave R4.
