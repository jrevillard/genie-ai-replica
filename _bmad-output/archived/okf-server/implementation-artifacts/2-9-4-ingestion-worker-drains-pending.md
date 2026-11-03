---
baseline_commit: 17cfcf609
---
# Story 2.9.4: `ingestWorker` — drains Pending OKF files (G10)

Status: done

Story key: `2-9-4-ingestion-worker-drains-pending` | GitLab: TBD on close-out
Epic: 2.9 (Write-side Orchestration) | Branch: `feat/okf-server`
FRs: **FR-34** (async pipeline completion), NFR-R2 | Gap: **G10 (P1)** | ADRs: okf-021 (D5/D6)

> **Steward directive (2026-08-16): "no reinventing the wheel — there is a perfectly good approach for workers implemented in the codebase already."** The precedent is `document-repository/src/workers/crawlWorker.js`: a self-scheduling `setTimeout` poll loop, `FILTER status=='Pending' SORT … LIMIT 1` (one job at a time — natural single-flight), explicit status transitions with error capture. This worker reuses that pattern verbatim. **No Redis** (decision D-D, carried from 2.9.1: ADR-021:11's "Redis Streams" misstates the code; the epic AC itself says the worker polls `files`).

## Story

As an **SRE**,
I want **an async worker that drains the per-concept `Pending` files docs the 2.9.1 orchestrator enqueues**,
so that **ingest never blocks the API, indexing actually completes without manual kicks, and failures land in a recoverable dead-letter state**.

## Acceptance Criteria

1. **`workers/ingestWorker.js` (okf-server, NEW)** — crawlWorker pattern:
   - `start()` → self-scheduling poll (`setTimeout(poll, INTERVAL)` in `finally` — crash-safe per iteration, never overlaps itself).
   - Job query (direct AQL, shared db-connection): `FOR f IN files FILTER f.dataprep.status == 'Pending' AND f.repo_id != null SORT f.uploaded_date ASC LIMIT 1` — **OKF docs only** (`repo_id` present); the existing single-document facility (no repo_id) keeps its manual/UI kick semantics untouched.
   - Per job: kick via `authedAxios.post` doc-repo `POST /api/files/:id/ingest` (okf-server service token — rights live since 2.9.1), 30s timeout. **429 → skip the cycle** (dataprep single-flight busy — another drain in flight; back off to the next poll, never hammer).
   - Poll the file to terminal (`Ingested | Ingestion Error | Killed`, 5s interval, 10-min cap), then transition the meta row (worker is the EXCLUSIVE owner of `indexed|failed` — D-G):
     - `Ingested` → `upsertConceptMeta` MINIMAL patch `{ index_status: 'indexed', last_good_index_at: <now> }`
     - `Ingestion Error | Killed` → `{ index_status: 'failed', last_error: <message> }` — this IS the dead-letter record (the files doc already carries dataprep error state; recovery = re-ingest, which the 4e hash-dedup makes idempotent).
   - concept_id derivation: files doc `originalFileName` (`<concept_id>.md` per 2.9.1 4f) → `concepts/<name>`; missing/unshaped → log + skip the meta transition (the files doc still drains).
   - MELT: `okf.ingest.worker.job` span attrs (file_id, repo_id, outcome, duration) + `okf_ingest_worker_jobs_total{outcome=ingested|failed|error}` counter; audit row per terminal transition (actor `okf-worker`).
2. **Orphan sweeper (same module, second slower timer)**: OKF files docs whose `okf_concepts_meta` row is missing (meta removed, files doc alive — e.g. partial bundle retract) → retract via doc-repo + remove the files doc. Interval env-gated; single pass per tick.
3. **Bootstrap**: `index.js` `require.main` block starts the worker after `app.listen` when `OKF_INGEST_WORKER_ENABLED !== 'false'` (default ON — this is okf-server's core function; opt-out env). In-process timer, NOT a Worker thread — the crawlWorker uses a thread only because page processing is CPU-heavy; this worker is pure I/O (HTTP + AQL), so the thread would be ceremony (deviation documented here).
4. **Env (empty-default, wired through docker-compose + env template + deploy/ansible env.j2)**: `OKF_INGEST_WORKER_ENABLED` (default `true`), `OKF_INGEST_WORKER_INTERVAL_MS` (default `15000`), `OKF_INGEST_WORKER_SWEEP_INTERVAL_MS` (default `3600000`), `OKF_INGEST_CONCURRENCY` (accepted + logged; v1 is sequential by design — dataprep single-flight; >1 warns).
5. **Tests (Jest, unit)**: oldest-first OKF-only claim; non-OKF Pending ignored; 429 skip (no transition, no crash); success → indexed + last_good_index_at; failure → failed + last_error; kick transport error → job error path (files doc untouched by worker — doc-repo owns its state machine); sweeper orphan cleanup; disabled flag prevents start. Test hooks `_processOneJob` / `_sweepOnce` exported (no timer in tests).
6. **Smoke (live gate)**: the manual sequential drain is REPLACED by waiting for the worker: zip ingest → wait → assert all 6 files `Ingested` AND meta rows `index_status='indexed'` + `last_good_index_at` set (first live proof of the worker's transition); then re-ingest the SAME concepts via the service (in-container module call — TTL-proof) → assert `skipped_dedup=6, enqueued=0` — **the first live proof of the 2.9.1 4e dedup rule** (unchanged hash + now-indexed). Both retraction phases remain asserted.

## Dev Notes (anchors, verified)

- Precedent: `document-repository/src/workers/crawlWorker.js` (poll loop :70-114, status transitions :356-366, error capture :297-353); bootstrap precedent `server.js:75-97` (thread isolation = CPU rationale, not applicable here).
- Kick route: `fileRoutes.js` `POST /:fileId/ingest` allows `okf-service` (live since 2.9.1 run 8); authedAxios + 401-retry live (`services/service-token.js`).
- Meta transition: `conceptMetaService.upsertConceptMeta` MINIMAL path (`isMinimalInput` — no frontmatter AND no body ⇒ patch-only, never clobbers — `concept-meta-service.js`), guarded exactly like conformance's persist.
- Files-doc shape: `repo_id`, `graph_name`, `originalFileName` (`<concept_id>.md`), `dataprep.status` ∈ Pending/Ingesting/Ingested/Ingestion Error/Killed/retracted (doc-repo's machine — the worker only READS it and kicks).
- The 2.9.1 smoke already proved: sequential worker-paced draining works (runs 3–8 did it manually with the same kick + poll-to-terminal).

## Scope boundary (do NOT build)

Redis Streams/ioredis (D-D) · worker-thread isolation (CPU rationale absent) · concurrency >1 (dataprep is single-flight) · lifecycle transitions (4.3) · mintVersion (2.9.7) · chunk-level retry policies beyond re-ingest.

## Tasks

- [x] T1 `workers/ingestWorker.js` (AC 1,2) + unit tests (16 green)
- [x] T2 Bootstrap + env wiring (compose + env template + ansible) (AC 3,4)
- [x] T3 Smoke: worker-paced drain + indexed/dedup assertions (AC 6); live run to exit 0
- [x] T4 Suites (okf-server 260/260, doc-repo 426/426, overlay 670/670), lint/format; close-out

## Dev Agent Record

**Final live gate (run 12): exit 0 — 41 PASS / 0 FAIL.** Worker drained all 6 bundle concepts Ingested with zero manual kicks; all 6 meta rows `parsed→indexed` + `last_good_index_at` stamped; **DEDUP LIVE: re-ingest of unchanged+indexed concepts → skipped_dedup=6, enqueued=0, zero new files docs** (the first live proof of 2.9.1's 4e rule); index_status never downgraded; isolation + both retraction levels still green.

**Live-caught bugs across runs 9–11 (all fixed + regression-tested):**
1. Worker's concept_id derivation assumed a `concepts/` prefix — the REAL parser strips only `.md` (my unit-test mock misled the derivation; live data exposed 6 bare vs 4 prefixed rows). Fixed: bare ids.
2. **doc-repo poisoned files on transient 429** — `_ingestFileById` called `_markIngestFailure` on dataprep-busy before rethrowing, permanently failing files the worker would have retried (console-verified: "Rejected … System busy" → "Ingest failed"). Fixed: 429 = transient, file stays Pending, rethrow. Contrast-pinned in tests (429 → no failure mark; real error → mark).
3. **content_hash was not mode-invariant** — zip-entry bodies and concepts[] bodies differ by markdown round-trip whitespace, so identical content hashed differently and dedup never fired. Fixed: canonical hash (trimmed body) in the 2.9.2 writer.
4. Smoke race eliminated: facility A now drains ALONE before the zip ingest (no single-flight contention by construction).

**Runtime note:** the ~13-min smoke is the real pipeline (dataprep single-flight + per-chunk contextual-retrieval LLM calls), not test scaffolding. Local speed levers (opt-in): `OKF_INGEST_WORKER_INTERVAL_MS=5000`, `CONTEXTUAL_RETRIEVAL_ENABLED=false`.
