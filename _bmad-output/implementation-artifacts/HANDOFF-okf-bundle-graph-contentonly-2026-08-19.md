# HANDOFF — OKF bundle graph + content-only chunking + bad-file gate (continue in a FRESH context)

**When:** 2026-08-19 · **Branch:** `feat/okf-server` (repo `d:\ITU-Gitlab`; local test build `C:\Dev\builds\main`, compose project `main`). User: David Forden.
**The previous session ran out of context mid-implementation. Read this file FIRST, then continue.**

## The approved plan (the source of truth)
`C:\Users\David Forden\.claude\plans\encapsulated-tinkering-quiche.md` — "Correct the OKF bundle ingestion: structured rooted graph, bundle-zip-only doc-repo, bad-file gate". The user APPROVED it. There are 3 work packages: A (bad-file gate) ✅ DONE + committed, B (rooted named graph) ✅ DONE + committed, C (content-only chunking) 🔶 IN PROGRESS.

## Committed so far on `feat/okf-server` (all pushed):
- `5265c8d` **WP-A**: conformance hard/warning split (MISSING_TYPE + BAD_ACTOR_PREFIX = hard errors) → rejected at ingest (`index_status='rejected'`, `summary.rejected++`, never chunked); publish gate enforced in `mintVersion` (refuses when a concept is non-indexed / non-conformant / PII-flagged or the repo PII scan is incomplete). okf-server 325/325.
- `b0b28dc` **WP-B**: dataprep `_ensure_graph_collections` now registers the NAMED gharial graph (ENTITY -(_HAS_SOURCE)-> SOURCE + ENTITY -(_LINKS_TO)-> ENTITY) so the retriever's `has_graph` guard passes; `is_index` root marker on meta row + ENTITY vertex. okf-server 327/327.

## WP-C (content-only chunking) — IN PROGRESS, uncommitted. Current state:
**Goal:** only the bundle zip is a doc-repo file; concepts are graph content chunked directly to dataprep (no per-concept files docs). User decision: content-only. Constraints: single-file ingestion UNTOUCHED; every change documented.

### Already implemented (uncommitted — DO NOT redo, but VERIFY each is coherent):
1. `config.js` — added `dataprep.url` (env `DATAPREP_URL`, default `http://dataprep-arango-service:5000` + `ingestPath`) and `internal.secret` (env `OKF_INTERNAL_SECRET`, empty ⇒ fail-closed).
2. `index.js` — mounts `app.use('/api/okf/internal', internalRoutes)` BEFORE the authed `/api/okf` router.
3. `routes/internal-routes.js` (NEW) + `controllers/internal-controller.js` (NEW) — `POST /api/okf/internal/concepts/:concept_id/status`, secret-gated (`x-okf-internal-secret`), resolves the repo via `getConceptMetaFromAnyRepo`, transitions meta to `indexed` (+`last_good_index_at`+`chunk_count`) or `failed` (+`last_error`), and writes edges on success.
4. `concept-meta-service.js` — `buildMetaDoc` now stores `body` + `ingest_labels` (from 4b opts); NEW `getConceptMetaFromAnyRepo(concept_id)` (LIMIT 2, null when absent/ambiguous); `applyUpdate` protects `rejected` from downgrade to `parsed`.
5. `ingest-service.js` — 4b passes `ingest_labels`; 4f is now CONTENT-ONLY (`summary.enqueued += 1`, NO doc-repo POST); 4g (bundle-zip store) is the ONLY doc-repo artifact.
6. `workers/ingestWorker.js` — claim = meta rows at `index_status='parsed'`; `_processOneJob` POSTs the concept's markdown DIRECTLY to dataprep `/v1/dataprep/ingest_file` (`fileId=concept_id`, `conceptId`, `graphName`, `bundleVersion`, `fileLabels=ingest_labels`); `waitForTerminal` polls the META row for `indexed|failed`; the okf-server callback owns the transition + edges (worker only observes). `module.exports = { start, stop, _processOneJob, _sweepOnce, claimNextJob }`. NOTE: the sweeper still targets legacy files docs (harmless; a meta-level stuck-parsed sweeper is deferred).
7. dataprep: `DocRepoIngestPayload` + `ArangoDBDataprepRequestFromDocRepo` gained `conceptId`; the loader request threads it; chunk metadata stamps `concept_id`; `_update_doc_status(..., concept_id=...)` routes the OKF-concept callback to the okf-server internal endpoint + sends `X-OKF-Internal-Secret`; `OKF_SERVER_URL` env added.

### Tests already updated + green:
- `ingest-service.test.js` — content-only assertions (labels/bundle_version ride the 4b opts; no doc-repo POST; bundle-zip store is the only POST; slug tests assert parser paths). okf-server **322/322** green at last full run.
- `ingest-worker.test.js` — rewritten for content-only (dataprep POST + meta poll; worker does NOT transition/write edges). 12/12 green.
- `internal-controller.test.js` (NEW) — secret-gate 401, Ingested→indexed+edges, Error→failed, 400, 404. 5/5 green.

## What REMAINS in WP-C (do these next):
1. **Compose env** — add `OKF_INTERNAL_SECRET` (same value) to BOTH `okf-server` + `dataprep-arango-service` + `DATAPREP_URL` to okf-server in `docker-compose.yaml`. This is REQUIRED for the live callback to authenticate (fail-closed otherwise).
2. **dataprep pytest** — the `test_conceptid_threads_into_the_loader_request` test was JUST added; run the overlay pytest to confirm. (Overlay venv: `cd genie-ai-overlay && source .venv/bin/activate && python -m pytest tests/test_dataprep_graph_name.py -v` — note the local Windows box has NO python3; the venv may not exist locally → the overlay suite is validated in the container/CI or use the container's python.)
3. **Smoke rework (happy + sad paths — user REQUIRED both)**:
   - Create `data/okf/smoke-test/kenya-bundle-clean/` + `.zip` (the 5 conforming concepts, NO `bad_concept.md`). The existing `kenya-bundle/` (with `bad_concept.md`) is the SAD path.
   - `run-smoke.js`: after the zip ingest assert (a) the doc-repo `files` collection contains ONLY the bundle zip (no per-concept docs — content-only!), (b) happy-path concepts' chunks carry `concept_id` + the named graph + `is_index` on the `index` root, (c) sad-path `bad_concept` is REJECTED (0 chunks, `index_status='rejected'`, 2 issues), (d) mint REFUSES the sad repo (publish gate) + SUCCEEDS for the happy repo. The existing smoke phases (drain, version, edges, clone) MUST be updated because concepts are no longer files docs — the drain now waits on the meta row / dataprep callback.
   - The `only` cleanup + the CRUD-only removals already work; keep the 3 cleanup modes.
4. **Rebuild + live run**: `cd /c/Dev/builds/main && git stash push -u -m pre && git fetch /d/ITU-Gitlab feat/okf-server && git reset --hard FETCH_HEAD && git stash pop && docker compose build okf-server document-repository dataprep-arango-service && docker compose up -d --force-recreate --no-deps okf-server document-repository dataprep-arango-service` + cp fixtures + `node data/okf/smoke-test/mint-tokens.mjs "$LOCALAPPDATA/Temp/okf-smoke-tokens.json"` + run `OKF_SMOKE_CLEANUP=none` (user inspects) then `OKF_SMOKE_CLEANUP=only`. Exit 0 required.
5. **Commit WP-C** when green, then **document everything** (user directive): the story `4-8-repository-clone-curated-forks.md` Dev Agent Record + File List + Change Log, sprint-status-okf-server.yaml, GitLab issue #971 (evidence comment + status), and the memory `project_291-fix-handoff.md`. Push `feat/okf-server`.

## Standing context (from memory — read the memory files + `_bmad-output/project-context.md`):
- Smoke integrity: success criteria up front, exit non-zero on failure, NEVER claim a pass unless real. Every story extends the smoke + re-runs live.
- Additive-first (R5) for pre-OKF code; single-file ingestion MUST stay untouched.
- Tokens are 5-min TTL; user-token calls EARLY; the drain/cleanup use the okf-server SERVICE token (re-mint <3 min, never hoisted); MSYS2_ARG_CONV_EXCL='*' for docker exec paths; MSYS /tmp path mangling (use `$LOCALAPPDATA/Temp`).
- The kenya bundle `index.md` is the ROOT (`type: index`, links to the 4 data files); the data files back-link. `bad_concept.md` = MISSING_TYPE + BAD_ACTOR_PREFIX.
- No Co-Authored-By in commits; no commits/pushes to `main` (feat/okf-server only).
- The two untracked `_bmad-output/planning-artifacts/…2026-08-18.md` + `docs/agricultural-data/` are NOT this work — leave them.

## Verification checklist before you call it done:
- okf-server jest green (incl. the new internal-controller + worker + ingest tests), doc-repo jest regression (untouched), overlay pytest (conceptId + callback routing).
- Live smoke `none` → inspect → `only`, BOTH happy (clean) + sad (bad_concept) bundles, exit 0, ZERO OKF_* artifacts after `only`.
- All docs updated (story + sprint + GitLab #971 + memory); feat/okf-server pushed.
