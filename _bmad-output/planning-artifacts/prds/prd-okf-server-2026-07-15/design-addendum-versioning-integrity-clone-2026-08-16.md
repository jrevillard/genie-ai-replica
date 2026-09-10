# OKF Server — Design Addendum: Versioning, Input Integrity, Unique Naming, Crawl Versions, Clone & Curate

**Date:** 2026-08-16 · **Status:** ACCEPTED (steward directives, David Forden, 2026-08-16)
**Amends:** [FR-11](prd.md) (versioning), [FR-25](prd.md) (in-app curation), ADR-okf-005 (versioning semantics), ADR-okf-021 (write path), ADR-okf-031 (okf_versions), epics 2.9.5/2.9.7/4.x
**Live baseline:** graph split + version/integrity assertions proven by the 2.9.1 dual-facility smoke (2026-08-16).

## Directives (as issued)

1. Use the `title:` and create a `tags:` tag to manage the version of the OKF; name the graph and bundle uniquely; maintain a repository of unique OKF repositories.
2. We must be able to manage the integrity of the input data.
3. When a crawl is associated with an OKF repository, a second crawl creates a **new version of the same repository**.
4. At the application level, a user must be able to **clone** and modify/curate OKF repositories.

## D-V1 — Version identity: the title + version-tag contract

Three version axes, never conflated:

| Axis | Field | Owner | Semantics |
|------|-------|-------|-----------|
| Concept identity | `title` (frontmatter) | Parser → `okf_concepts_meta.title` | The human identity of a concept. Preserved verbatim on every meta row; **asserted live** by the smoke (title present on every ingested concept). |
| Bundle format | `okf_version` (frontmatter, e.g. `"0.2"`) | Bundle author / producer | Which OKF FORMAT the bundle targets (parser/conformance contract). Carried on the repo doc and in bundle frontmatter (e.g. kenya `index.md`). |
| Data version | repo `version` → `bundle_version` | `mintVersion()` (2.9.7) | The repository's DATA version. Threaded onto **every** `okf_concepts_meta` row at ingest (and onto chunks/edges with 2.9.4). **Asserted live** by the smoke (`bundle_version` on every concept). |

**Version tag:** when a version is minted (publish, crawl, clone), the manifest's version identifier is also appended to the bundle's `tags:` as `okf:v{N}` (discoverable in-band in the content, not just in metadata). The parser keeps unknown frontmatter keys (ADR-okf-017 §6/§7), so `tags`/`okf_version` survive parsing today; the producer/editor (FR-25, Epic 7) owns writing them.

**Ingestion-identity triple** (the integrity key per concept): `(title, bundle_version, content_hash)` — all three are first-class on `okf_concepts_meta` and asserted by the smoke.

## D-V2 — Unique naming & the repository registry (constraints)

- `okf_repositories` is **the registry of unique OKF repositories**: unique `(name, domain, deleted_at)` — one registry entry per repository, ever (soft-delete keeps history; no duplicate identities).
- **One graph per repository**: `graph_name = OKF_{repo_id}`, minted at repo creation, unique by construction (repo_id unique). All of a repo's concepts, chunks, and edges live in that repo's graph — never the shared default graph (live-proven: the dual-facility smoke asserts OKF bundle chunks land in `OKF_{repo_id}_SOURCE` and ZERO leak into the default `GRAPH_SOURCE`).
- **Bundle uniqueness**: every per-concept `files` doc is stamped `repo_id` + `graph_name` at enqueue (sole-injector ACL labels `t:/r:/d:` alongside); `(repo_id, concept_id)` unique index on `okf_concepts_meta` — no duplicate concepts within a repo.
- Bundle files submitted for ingest are content-addressed: re-submitting identical content is absorbed by the content-hash dedup, never duplicated.

## D-V3 — Input-data integrity

1. **Per-concept content hash**: `content_hash = sha256(body)` on every meta row (2.9.2 writer). Re-ingest of an unchanged, already-indexed concept skips enqueue (`skipped_dedup`) — idempotent by construction, live-proven.
2. **Version manifests (2.9.7)**: every minted version snapshots an INSERT-only `okf_versions` manifest — concept list + per-concept hashes + source ref + curator + timestamp. The manifest is the integrity ledger: any later mutation of a concept is detectable against the manifest of the version that ingested it.
3. **Gates before publish**: PII scan (fail-closed) + conformance validation run on every concept at ingest; a version can only publish through the lifecycle gate with both recorded.
4. **Retraction integrity — two levels, never conflated**:
   - **Per-concept (single file)**: dataprep `retract_file(file_id, graph_name)` surgically deletes that file's chunks + orphaned edges from the file's OWN graph (unified `GRAPH` fallback — G5 fix, live-verified 2026-08-16: chunks physically removed, siblings untouched). This path is deliberately untouched by bundle-level retraction.
   - **Per-bundle (repository)**: a per-repo graph serves EXACTLY ONE bundle, so repo-level retraction is simply **dropping the graph** — `retractRepoGraph(repo_id)` (wired into repository delete) drops the named graph definition + the 4 `OKF_{repo_id}_*` collections and removes the repo's `okf_concepts_meta` rows + dangling files docs. Footgun guard: the graph name is read from the registry (immutable field) and anything not `OKF_*` — notably the free-form default `GRAPH` — is refused. Live-verified by the smoke (collections physically gone).

## D-V4 — Crawl versioning (re-crawl ⇒ new version)

A crawl (Epic 7 producer / `crawlWorker`) associated with an OKF repository does NOT create a new repository on subsequent crawls — the registry stays unique (D-V2). Instead:

- **First crawl**: ingests into the repo; mints version N (manifest snapshot).
- **Every subsequent crawl of the same origin**: `mintVersion(repo_id)` → **N+1** (same `repo_id`, same `OKF_{repo_id}` graph). The new `bundle_version` is stamped on all newly written meta rows/chunks/edges; unchanged concepts (same `content_hash`, `index_status='indexed'`) are skipped by dedup — the version diff IS what changed.
- Each crawl's manifest (D-V3.2) is the crawl's integrity record: `source_ref` = the crawl origin, so versions are traceable to the crawl that produced them.

## D-V5 — Clone & curate at the application level

A steward can **clone** an OKF repository — **an end-user feature in the Admin Dashboard, incorporated into OKF repository authoring** — not merely a backend API:

### Backend semantics (Story 4.8)

- Clone creates a NEW repository: new `repo_id`, new `OKF_{repo_id}` graph, new registry entry (D-V2), `lifecycle_state='draft'`.
- The clone copies the source's concepts + meta (title/version/content-hash triple preserved) and records lineage: `cloned_from: { repo_id, version }`.
- The clone is then **curated** through the existing in-app authoring path (FR-25: editor, lifecycle, review gate — Epic 4 stories 4.2–4.4): modify concepts, re-run the full ingest pipeline (parse → meta → conformance → PII → dedup → enqueue), mint its own versions.
- Upstream updates never propagate automatically; a steward may diff against `cloned_from` versions (FR-11 steward diff) and cherry-pick.

### Admin Dashboard end-user feature (Story 3.9 + 3.2 amendment — THE AUTHORING ENTRY)

Clone is a **first-class authoring action in the OKF Admin Dashboard**, exactly parallel to "Create repository":

1. **Entry points** — the "Clone" action appears in EVERY place a steward can author a repo:
   - the **OKF Repositories tab** (Story 3.1) as a toolbar action **and** a per-repo row action;
   - the **repository details dialog** (Story 3.2 — `OkfRepositoryDialog.vue`) as a primary action beside Create/Edit;
   - the **OKF Studio** (Story 3.4/3.5) as the "start from a template/existing repo" step of the authoring wizard.
2. **Clone flow (a modal — DS primitives, Options API, Vuex `okf` module — the existing admin-dashboard patterns)**:
   - **Source selector**: pick any repository the steward can read (`okf:*:*:read` scope; foreign/missing 404s identically — anti-enumeration from 6.1).
   - **Target identity**: pre-filled name/domain (default `<source> (clone)` + the same domain), validated against the unique `(name, domain)` registry — a duplicate target is rejected 409 `DUPLICATE_REPO` in-app before the request.
   - **Confirm + progress**: on confirm → `POST /api/okf/repos/:source_id/clone` (admin scope) → 202 → the new repo appears in the list at `draft`; the clone is ready to author immediately.
   - **Lineage surfacing**: the details view shows `Cloned from <source> · version <vN>` (a read of `cloned_from`) — the steward always knows the origin.
3. **Role gating**: clone is an admin mutation (mirrors Create — `tools-admin`/admin; Kong + OKF Server both enforce); the read-side source selector is `read`-scoped. i18n: `okf.clone.*` keys across all active locales (the 3.3 i18n discipline).
4. **The authoring loop the feature enables** (the end-user workflow to document + smoke):
   `Clone a published repo → modify/curate concepts in the editor (4.2) → run validation + PII → review-gate → publish (4.3/4.4) → mint the clone's own version (2.9.7) → cite (repo, version, concept)` — the original is NEVER touched.
5. **Smoke obligation**: the dual-facility smoke extends with a **clone phase** — clone the kenya repo via the API, assert the new repo + graph + copied meta + `cloned_from` lineage, then assert the ORIGINAL's chunks/edges are untouched (isolation), and a modified concept in the clone re-indexes into the CLONE's graph only.

## Implementation mapping

| Capability | Status |
|------------|--------|
| Unique registry + `(name,domain,deleted_at)` | Live (2.2) |
| One graph per repo; per-repo collection writes; zero cross-graph leakage | Live 2026-08-16 (2.9.6 pulled forward; smoke-asserted) |
| `title` + `bundle_version` + `content_hash` on every meta row | Live; **smoke-asserted 2026-08-16** |
| Content-hash idempotent re-ingest | Live (2.9.1 4e; smoke-asserted) |
| Wrong-graph retract fix | Live 2026-08-16 |
| `mintVersion()` + `okf_versions` manifests + crawl-triggered versions + `okf:v{N}` tag | **Story 2.9.7** (extended by D-V1/D-V4) |
| Chunk/edge `bundle_version` stamps | **Story 2.9.4** |
| `tags:`/`okf_version` frontmatter written by producer/editor | **Epic 7 / FR-25** (parser already preserves them) |
| Repository clone (endpoint + lineage + copy) | **New story 4.5 (Epic 4)** — see epics addendum |
| Ingestion worker (drains Pending; owns indexed/failed) | **Story 2.9.4** |

## Smoke obligations (standing)

The dual-facility smoke (`data/okf/smoke-test/run-smoke.js`) now permanently asserts: unique per-repo graph creation, zero cross-graph leakage, `title` + `bundle_version` on every meta row, content-hash idempotency, and both ingestion facilities end-to-end. New versioning stories extend these assertions (manifest presence after mintVersion, clone lineage on 4.5).
