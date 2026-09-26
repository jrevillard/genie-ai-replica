// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// OKF ingestion worker (Story 2.9.4, gap G10) — drains the per-concept
// `Pending` files docs the 2.9.1 orchestrator enqueues (defer_kick: the
// orchestrator NEVER kicks dataprep; THIS worker owns draining).
//
// PATTERN: reused verbatim from the codebase's proven worker —
// document-repository/src/workers/crawlWorker.js: a self-scheduling
// setTimeout poll loop (crash-safe per iteration, never overlaps itself),
// FILTER status=='Pending' SORT … LIMIT 1 (one job at a time — dataprep is
// single-flight), explicit status transitions with error capture. No Redis
// (decision D-D, 2.9.1): the queue IS the `files` collection.
//
// In-process timer, NOT a worker thread: crawlWorker isolates in a thread
// because page PROCESSING is CPU-heavy; this worker is pure I/O (one HTTP
// kick + AQL polls per job), so a thread would be ceremony.
//
// Exclusivity (D-G): the worker is the ONLY writer of index_status
// 'indexed'|'failed' on okf_concepts_meta (2.9.1 writes 'parsed' only).

const { aql } = require('arangojs');
const matter = require('gray-matter');
const dbService = require('../shared-lib/db-connection-service');
const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');
const { getMeter } = require('../shared-lib/metrics');
const auditService = require('../services/audit-service');
const { authedAxios } = require('../services/service-token');
const conceptMetaService = require('../services/concept-meta-service');
const config = require('../config');
const graphLifecycle = require('../services/graph-lifecycle-service');

const DEFAULT_INTERVAL_MS = 15000;
const DEFAULT_SWEEP_INTERVAL_MS = 3600000;
// Per-file terminal-state poll — env-tunable so tests run in milliseconds.
const JOB_POLL_MS = () => safeInt('OKF_INGEST_WORKER_JOB_POLL_MS', 5000);
const JOB_TIMEOUT_MS = () => safeInt('OKF_INGEST_WORKER_JOB_TIMEOUT_MS', 1800000); // 30 min (David, 2026-09-15: dataprep's per-doc retry path with 12-batch files + 2 retry rounds can take 9-13 min; 10 min JOB_TIMEOUT was producing false-positive "Concept ingestion timed out" audit rows even when dataprep finished successfully)

const meter = getMeter();
const jobsCounter = meter.createCounter('okf_ingest_worker_jobs_total', {
  description: 'OKF ingestion worker job outcomes'
});
function recordJob(outcome) {
  try {
    jobsCounter.add(1, { outcome });
  } catch {
    /* meter no-op when observability off */
  }
}

let _drainTimers = []; // one timer per drain lane (PARALLEL — see start())
let _sweepTimer = null;
let _sweeping = false;

const enabled = () => (process.env.OKF_INGEST_WORKER_ENABLED || 'true').toLowerCase() !== 'false';
const intervalMs = () => safeInt('OKF_INGEST_WORKER_INTERVAL_MS', DEFAULT_INTERVAL_MS);
const sweepIntervalMs = () => safeInt('OKF_INGEST_WORKER_SWEEP_INTERVAL_MS', DEFAULT_SWEEP_INTERVAL_MS);
// Claim strategy (spec #1020 §5.8 — defaults are today's behavior):
//   'fifo' = global oldest-first (the pre-2026-09-26 path, byte-for-byte);
//   'fair' = least in-flight repo first, oldest head as tiebreak (§5.2).
const claimStrategy = () => ((process.env.OKF_CLAIM_STRATEGY || 'fifo').toLowerCase() === 'fair' ? 'fair' : 'fifo');
// Per-repo in-flight cap (spec §5.3). 0 = unlimited (today). Only consulted
// by the fair strategy — fifo has no per-repo notion.
const repoIngestCap = () => safeIntOrZero('OKF_REPO_INGEST_CAP', 0);
// Kick-5xx backoff (spec #1020 §5.5). Base 0 = OFF (default — today's
// behavior: a failing kick re-enters the FIFO immediately). With base > 0,
// a 5xx or transport-failed kick parks the row for
// min(MAX, BASE × 2^(attempts-1)) + 0..25% jitter before it is claimable
// again — spreading the reaper's 8-attempt ceiling over ~1 h (base 60 s,
// cap 15 min) so a transient dataprep restart no longer converts healthy
// concepts into dead-letters (the live failure documented at the error
// path below). 429 is NEVER parked: slot-busy self-regulates against the
// flock slots; prompt retry is correct there.
const kickBackoffBaseMs = () => safeIntOrZero('OKF_KICK_BACKOFF_BASE_MS', 0);
const kickBackoffMaxMs = () => safeIntOrZero('OKF_KICK_BACKOFF_MAX_MS', 900000);
/** Park delay for a failed kick: exponential in the CURRENT attempt number
 * (job.ingest_attempts — the claim already bumped it), capped, jittered.
 * Returns null when backoff is disabled (base 0). */
function nextAttemptAfter(attempts) {
  const base = kickBackoffBaseMs();
  if (base <= 0) return null;
  const exp = Math.min(kickBackoffMaxMs(), base * Math.pow(2, Math.max(0, (attempts || 1) - 1)));
  const delay = Math.floor(exp * (1 + Math.random() * 0.25));
  return new Date(Date.now() + delay).toISOString();
}
// Size-adaptive job windows (spec #1020 §5.9, G-10). The flat 30-min window
// structurally aborts chunk-heavy concepts whose pipeline exceeds it — and
// WS5's next-kick retract then DESTROYS the paid in-flight work, restarting
// the concept from zero (measured: 17 timeout loops in 16 h on Indonesia's
// ~155-chunks/concept corpus, zero on the UK's ~10-chunk corpus). Adaptive
// mode (default OFF) scales the wait window with the concept's estimated
// chunk count instead; expiry becomes a liveness PROBE, not a kill.
const ADAPTIVE_WINDOWS = () => (process.env.OKF_JOB_WINDOW_ADAPTIVE || 'false').toLowerCase() === 'true';
const windowFloorMs = () => safeInt('OKF_JOB_WINDOW_FLOOR_MS', 1800000);
const windowMaxMs = () => safeInt('OKF_JOB_WINDOW_MAX_MS', 21600000);
const windowMsPerChunk = () => safeInt('OKF_JOB_WINDOW_SEC_PER_CHUNK_MS', 5000);
// Nominal dataprep chunk size (chars) for the bytes→chunks estimate; the
// real chunk_count from a prior attempt takes precedence when present.
const CHUNK_SIZE_ESTIMATE_CHARS = 500;
/** The wait window for ONE concept: adaptive = clamp(FLOOR, MAX,
 * estChunks × MS_PER_CHUNK × 1.5); flat = today's JOB_TIMEOUT_MS. */
function jobWindowMs(job) {
  if (!ADAPTIVE_WINDOWS()) return JOB_TIMEOUT_MS();
  const bodyLen = job && typeof job.body === 'string' ? job.body.length : 0;
  const estChunks = job && job.chunk_count > 0 ? job.chunk_count : Math.ceil(bodyLen / CHUNK_SIZE_ESTIMATE_CHARS);
  const raw = Math.ceil(estChunks * windowMsPerChunk() * 1.5);
  return Math.max(windowFloorMs(), Math.min(windowMaxMs(), raw));
}
/** Claim-staleness cutoff for BOTH claim strategies: how old an in-flight
 * claim must be before the row is considered dead-lane-reclaimable. In
 * adaptive mode this must scale with the LARGEST window — otherwise the
 * FIFO/fair scans would reclaim (and WS5-retract) a legitimately running
 * big concept at the flat 30-min mark. */
function claimStaleMs() {
  return ADAPTIVE_WINDOWS() ? windowMaxMs() : JOB_TIMEOUT_MS();
}

/** NaN-safe env int (the 2.9.1 maxConceptsFromEnv lesson). For the GRACE
 * variable 0 is a legitimate value (sweep immediately / test) — use
 * safeIntOrZero for it (review fix P10: a 0 was silently replaced by 1h). */
function safeInt(name, fallback) {
  const parsed = parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function safeIntOrZero(name, fallback) {
  const parsed = parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

async function getDb() {
  return dbService.getConnection('default');
}

/** Re-serialize a concept's stored markdown (frontmatter + body) — the same
 * gray-matter serializer the orchestrator uses (ADR-021 4f round-trip). */
function markdownFor(input) {
  return matter.stringify(input.body || '', input.frontmatter || {});
}

/** Oldest concept awaiting chunking: an okf_concepts_meta row at
 * index_status='parsed' (the orchestrator left it parsed; 'rejected' concepts
 * are excluded by construction — the ingest hard-gate never enqueues them).
 * Story 4.8-amend: content-only chunking — no doc-repo files doc exists for a
 * concept; the concept's own meta row is the queue.
 *
 * CLAIM STAMP (live-fixed 2026-09-03): the claim also stamps
 * worker_claimed_at + ingest_attempts on the row. These are the reaper's ONLY
 * signals — a WAITING row is never reaped no matter how deep the backlog gets
 * (the age-based rule mass-killed crawl backlogs: ~20 drains/hour vs a
 * 1550-row queue means every head row is >1h old for days). updated_at is
 * deliberately NOT touched here: it is the FIFO order key.
 *
 * WORKFLOW GATE (David, 2026-09-04: "MUST NOT be ingested until they have
 * passed those stages"; boundary corrected 2026-09-04 — the drain arms at
 * the INGEST transition, not approve): only concepts of a repo whose RAG
 * drain is ARMED (rag_drain_active — written by the lifecycle ingest
 * transition; publish writes it false) are claimed. A pre-ingest repo's
 * parsed rows are INVISIBLE to the worker: import does not enqueue dataprep
 * work; RAG preparation starts only at the ingest transition. */
async function claimNextJob(db) {
  const rows = await (
    await db.query(aql`
    FOR m IN okf_concepts_meta
      FILTER m.index_status == 'parsed' AND m.repo_id != null
      // WORKFLOW GATE: only repos whose RAG drain is armed (ingest transition).
      LET repo = DOCUMENT('okf_repositories', m.repo_id)
      FILTER repo != null AND repo.deleted_at == null AND repo.rag_drain_active == true
      // Lanes claim in parallel: a row claimed within the last JOB_TIMEOUT is
      // in-flight on another lane — never double-claim it. A STALE claim
      // (past the drain window) belongs to a dead lane and is reclaimable.
      FILTER m.worker_claimed_at == null OR DATE_TIMESTAMP(m.worker_claimed_at) < DATE_NOW() - ${claimStaleMs()}
      // Kick-backoff gate (spec #1020 §5.5): a row parked by a 5xx backoff is
      // not claimable until its next_attempt_after. Inert until the first
      // backoff write (all rows have the field null/absent).
      FILTER m.next_attempt_after == null OR DATE_TIMESTAMP(m.next_attempt_after) <= DATE_NOW()
      SORT m.updated_at ASC
      LIMIT 1
      RETURN KEEP(m, ['repo_id', 'concept_id', 'graph_name', 'frontmatter', 'body', 'ingest_labels', 'bundle_version', 'updated_at', 'last_good_index_at', 'reindex_retry', 'chunk_count'])
  `)
  ).all();
  if (!rows[0]) return null;
  await _stampClaim(db, rows[0].repo_id, rows[0].concept_id);
  return rows[0];
}

/** Stamp the claim on a claimed row (best-effort — a failed stamp must not
 * block the drain; the row simply keeps its previous claim state). */
async function _stampClaim(db, repoId, conceptId) {
  try {
    await db.query(
      aql`
      FOR m IN okf_concepts_meta
        FILTER m.repo_id == ${repoId} AND m.concept_id == ${conceptId}
        UPDATE m WITH {
          worker_claimed_at: DATE_ISO8601(DATE_NOW()),
          ingest_attempts: (m.ingest_attempts == null ? 0 : m.ingest_attempts) + 1
        } IN okf_concepts_meta
    `,
      {}
    );
  } catch (err) {
    logger.warn('Ingest worker: claim stamp failed (non-fatal)', { concept_id: conceptId, error: err.message });
  }
}

/** FAIR CLAIM (spec #1020 §5.2, strategy OKF_CLAIM_STRATEGY=fair) — the
 * cross-repo-starvation remediation. One FUSED statement does repo selection,
 * row selection AND the claim stamp as a single all-or-nothing transaction:
 *
 *   1. Repo pick: least IN-FLIGHT first (claimed rows within the job window),
 *      oldest head as tiebreak — a newly armed small repo is picked as soon as
 *      any big repo's in-flight count exceeds it. Per-repo cap enforced here
 *      (OKF_REPO_INGEST_CAP, 0 = unlimited).
 *   2. Row pick: the repo's oldest CLAIMABLE parsed row (unclaimed / stale
 *      claim / backoff expired).
 *   3. Claim stamp in the same statement.
 *
 * ATOMICITY (§5.1): one AQL query = one implicit transaction. On the RocksDB
 * engine a concurrent write to the same document raises error 1200 which
 * ABORTS THE LOSER'S ENTIRE QUERY (nothing written) — so the read+write here
 * is a correct CAS across processes; the loser retries on a fresh snapshot.
 * This is what makes multi-worker scale-out safe (the in-process mutex stays,
 * redundant-but-harmless in this mode). */
async function claimNextJobFair(db) {
  const cap = repoIngestCap();
  const run = async () => {
    const rows = await (
      await db.query(aql`
      LET timeout = DATE_NOW() - ${claimStaleMs()}
      // WORKFLOW GATE (same as fifo): only repos whose RAG drain is armed.
      LET armed = (
        FOR r IN okf_repositories
          FILTER r.rag_drain_active == true AND r.deleted_at == null
          RETURN r.repo_id
      )
      // Repo selection: least in-flight first, oldest head as tiebreak,
      // per-repo cap (${cap} = 0 → unlimited). depth = the repo's whole
      // parsed backlog (observability, spec §5.7).
      LET pick = FIRST(
        FOR m IN okf_concepts_meta
          FILTER m.index_status == 'parsed' AND m.repo_id IN armed
          FILTER m.next_attempt_after == null OR DATE_TIMESTAMP(m.next_attempt_after) <= DATE_NOW()
          COLLECT r = m.repo_id AGGREGATE
            inFlight = SUM((m.worker_claimed_at != null && DATE_TIMESTAMP(m.worker_claimed_at) >= timeout) ? 1 : 0),
            oldest = MIN(m.updated_at),
            depth = COUNT()
          FILTER ${cap} <= 0 OR inFlight < ${cap}
          SORT inFlight ASC, oldest ASC
          LIMIT 1
          RETURN { repo: r, in_flight: inFlight, queue_depth: depth }
      )
      FILTER pick != null
      // Row claim inside the winning repo: oldest claimable row.
      LET cand = FIRST(
        FOR m IN okf_concepts_meta
          FILTER m.repo_id == pick.repo AND m.index_status == 'parsed'
          FILTER m.worker_claimed_at == null OR DATE_TIMESTAMP(m.worker_claimed_at) < timeout
          FILTER m.next_attempt_after == null OR DATE_TIMESTAMP(m.next_attempt_after) <= DATE_NOW()
          SORT m.updated_at ASC
          LIMIT 1
          RETURN m
      )
      FILTER cand != null
      UPDATE cand WITH {
        worker_claimed_at: DATE_ISO8601(DATE_NOW()),
        ingest_attempts: (cand.ingest_attempts == null ? 0 : cand.ingest_attempts) + 1
      } IN okf_concepts_meta
      RETURN {
        job: KEEP(NEW, ['repo_id', 'concept_id', 'graph_name', 'frontmatter', 'body', 'ingest_labels', 'bundle_version', 'updated_at', 'last_good_index_at', 'reindex_retry', 'chunk_count']),
        repo_in_flight: pick.in_flight,
        repo_queue_depth: pick.queue_depth,
        claim_wait_ms: DATE_NOW() - DATE_TIMESTAMP(NEW.updated_at)
      }
    `)
    ).all();
    return rows[0] || null;
  };
  try {
    const out = await run();
    if (!out) return null;
    logger.info('Ingest worker: fair claim', {
      strategy: 'fair',
      repo_id: out.job.repo_id,
      concept_id: out.job.concept_id,
      repo_in_flight: out.repo_in_flight,
      repo_queue_depth: out.repo_queue_depth,
      claim_wait_ms: out.claim_wait_ms
    });
    return out.job;
  } catch (err) {
    if (err && err.errorNum === 1200) {
      // Write-write conflict: another WORKER claimed the same head row between
      // our snapshot and the UPDATE. Nothing was written (the loser's whole
      // query aborted) — retry once on the fresh snapshot; a second collision
      // waits for the next poll (another lane's cycle will have advanced the
      // queue by then).
      logger.warn('Ingest worker: fair claim write-conflict (1200) — retrying on fresh snapshot', {
        error: err.message
      });
      const out = await run();
      return out ? out.job : null;
    }
    throw err;
  }
}

/** Refresh the repo's rag_ingestion progress record (best-effort). Called
 * after every terminal concept state while the drain is armed. When the repo
 * has no parsed rows left, the record completes ('failed' wins over
 * 'completed' — a failed concept must be re-ingested before the mint's
 * all-indexed gate will ever pass). */
async function _refreshRagIngestion(db, repoId) {
  try {
    const [parsed, indexed, failed] = await Promise.all([
      conceptMetaService.countByIndexStatus(repoId, 'parsed'),
      conceptMetaService.countByIndexStatus(repoId, 'indexed'),
      conceptMetaService.countByIndexStatus(repoId, 'failed')
    ]);
    if (parsed > 0) {
      // ARANGODB GOTCHA (live-caught 2026-09-12, David's 0/997 card): update()
      // keys are LITERAL attribute names — a dotted key like
      // 'rag_ingestion.concepts_done' is stored as a FLAT attribute with that
      // exact name, NOT as a nested path. Every progress refresh was landing
      // in invisible flat attributes while the nested record the dashboard
      // reads stayed at concepts_done: 0. MERGE the nested object server-side.
      //
      // FUSED CHECK+WRITE (spec #1020 §5.4 race 3): the previous shape was
      // document-read → JS guard → update — a TOCTOU gap where a mid-drain
      // retract could disarm the repo between the read and the write, and
      // this late refresh then resurrected 'draining' over the honest
      // 'cancelled' record (the documented Bali wedge). One conditional
      // statement checks rag_drain_active AND writes in the same transaction:
      // a disarmed repo matches ZERO rows → nothing is written, ever.
      await db.query(aql`
      FOR r IN okf_repositories
        FILTER r._key == ${repoId} AND r.rag_drain_active == true
        UPDATE r WITH {
          rag_ingestion: MERGE(r.rag_ingestion || {}, {
            status: 'draining',
            concepts_done: ${indexed},
            concepts_total: ${indexed + parsed + failed},
            error: null
          })
        } IN okf_repositories
      `);
      return;
    }
    // No parsed rows — the drain reached its end state. SETTLE UNCONDITIONALLY
    // (P0 wedge, David 2026-09-09: "having it fail and stall silently is NOT
    // ACCEPTABLE"). A partial failure used to stop HERE — record-only, drain
    // still armed, worker exits, no settle ever fires → rag_ingestion stuck
    // 'draining', rag_drain_active stuck true, retract impossible (it needs
    // ingested_at), repo bricked for re-ingest (Kenya v9). Now every terminal
    // state settles: promote + serving flags via _settleIngest (which also
    // finalizes the rag_ingestion record), then the record is augmented with
    // the FAILED concept ids so the state is honest AND recoverable — the
    // designed loop (retract → ingest) requeues everything for a full re-drain.
    const repo = await db.collection('okf_repositories').document(repoId);
    if (!repo || !repo.rag_drain_active) return; // disarmed / already settled
    const lifecycleService = require('../services/lifecycle-service');
    await lifecycleService._settleIngest(db, repo, { sub: 'okf-worker' });
    // _settleIngest OWNS the terminal rag_ingestion record (status, finished_at,
    // failed_concepts, error — written from live counts). The legacy failed-only
    // annotation that used to run here re-patched the record from the STALE
    // pre-settle `repo` snapshot and resurrected status 'draining' over the
    // settled record (probe-verified 2026-09-13) — removed; the warn + log
    // mirror below keep the failure VISIBLE without corrupting the record.
    if (failed > 0) {
      writeBundleIngestionLog(
        repoId,
        'repo',
        'WARN',
        'System',
        'Drain finished with failures (serving partial): ' + failed + ' concept(s) failed to index — re-ingest them'
      );
      logger.warn('Ingest worker: drain finished with FAILED concepts — settled, serving partial', {
        repo_id: repoId,
        failed
      });
    }
  } catch (err) {
    logger.warn('Ingest worker: rag_ingestion refresh failed (non-fatal)', { repo_id: repoId, error: err.message });
    writeBundleIngestionLog(repoId, 'repo', 'WARN', 'System', 'rag_ingestion progress refresh failed: ' + err.message);
  }
}

/** Terminal-state poll of ONE concept — the okf-server concept-status callback
 * (dataprep → okf-server) transitions the meta row to 'indexed' | 'failed'.
 * The worker waits for that; a vanished/retracted concept is 'vanished'.
 * windowMs = the concept's wait window (§5.9: size-adaptive, default the
 * flat JOB_TIMEOUT_MS). */
async function waitForTerminal(db, repoId, conceptId, windowMs) {
  const deadline = Date.now() + (windowMs || JOB_TIMEOUT_MS());
  for (;;) {
    await new Promise((r) => setTimeout(r, JOB_POLL_MS()));
    const rows = await (
      await db.query(aql`
      FOR m IN okf_concepts_meta FILTER m.repo_id == ${repoId} AND m.concept_id == ${conceptId}
        RETURN KEEP(m, ['index_status', 'last_error', 'chunk_count'])
    `)
    ).all();
    const row = rows[0];
    if (!row) return { status: 'vanished', chunk_count: 0 }; // removed mid-drain
    if (row.index_status === 'indexed') return { status: 'Ingested', chunk_count: (row && row.chunk_count) || 0 };
    if (row.index_status === 'failed')
      return {
        status: 'Ingestion Error',
        chunk_count: (row && row.chunk_count) || 0,
        last_error: row.last_error || null
      };
    if (Date.now() > deadline) return { status: 'timeout', chunk_count: 0 };
  }
}

// Bundle-ingestion-log mirror (Story 4.8-amend ingestion_log visibility fix,
// David's 3rd-time directive, 2026-08-20): dataprep's _write_ingestion_log
// keys log entries on file_id=concept_id (no per-concept files doc exists for
// content-only chunking) — those entries are NOT visible in the UI's
// FileDetailsDialog, which only shows logs keyed on a real files doc. The
// worker's mirror posts ingestion-log entries to doc-repo keyed on the BUNDLE
// ZIP's file_id, with the concept_id embedded in the message — the UI's
// bundle-zip panel then shows the per-concept ingest progress (Started /
// Ingested / Ingestion Error).
const _bundleFileCache = new Map(); // repo_id -> bundle file_id (one bundle per repo)
/** Story #978 lifecycle: publish SUPERSEDES the old bundle zip — the worker's
 * cache must not keep pointing at a deleted doc (its ingestion-log mirror
 * would 404 forever). Called by bundle-export-service after a supersede. */
function invalidateBundleCache(repoId) {
  _bundleFileCache.delete(repoId);
}
async function getBundleFileId(repoId) {
  const cached = _bundleFileCache.get(repoId);
  if (cached) return cached;
  // The bundle zip is the only doc-repo artifact with is_bundle=true for the repo.
  // Doc-repo returns { data: [...], pagination: {...} } (no `items`/`files` key).
  const resp = await authedAxios.get(
    `${config.documentRepository.url}/api/files?repo_id=${encodeURIComponent(repoId)}&is_bundle=true&limit=1`
  );
  const body = resp && resp.data;
  const items = Array.isArray(body) ? body : (body && (body.data || body.items || body.files)) || [];
  const bundle = items[0];
  if (!bundle || !bundle.file_id) {
    throw new Error(`Bundle zip not found in doc-repo for repo_id=${repoId}`);
  }
  _bundleFileCache.set(repoId, bundle.file_id);
  return bundle.file_id;
}

/** Best-effort ingestion-log mirror — never fatal to the worker (a doc-repo
 * hiccup must not block chunking). Errors are logged + swallowed. */
async function writeBundleIngestionLog(repoId, conceptId, level, stage, message) {
  try {
    const bundleFileId = await getBundleFileId(repoId);
    await authedAxios.post(
      `${config.documentRepository.url}/api/files/${encodeURIComponent(bundleFileId)}/ingestion-log`,
      { level, stage, message: `[${conceptId}] ${message}` },
      { timeout: 10000 }
    );
  } catch (err) {
    // Winston console formatter STRIPS metadata fields — the diagnosis
    // (status + body) must live IN the message string or the failure is
    // invisible in logs (live-caught: "mirror failed" with no cause).
    const status = err && err.response && err.response.status;
    const body = err && err.response && err.response.data ? JSON.stringify(err.response.data).substring(0, 200) : '';
    logger.warn(
      `Bundle ingestion-log mirror failed (non-fatal): [${repoId}/${conceptId}] ` +
        `status=${status || 'n/a'} err=${err.message}${body ? ' body=' + body : ''}`
    );
  }
}

/**
 * Drain ONE concept awaiting chunking (content-only, Story 4.8-amend). The job
 * is an okf_concepts_meta row at index_status='parsed'. The worker POSTs the
 * concept's markdown DIRECTLY to dataprep (no doc-repo files doc — the bundle
 * zip is the only doc-repo artifact); dataprep's completion callback routes to
 * the okf-server concept-status endpoint, which transitions the meta row to
 * 'indexed'/'failed' + writes the concept's edges. The worker waits for that.
 * Returns the outcome: 'ingested' | 'failed' | 'busy' | 'error' | 'timeout'.
 */
async function _processOneJob() {
  const db = await getDb();
  const job = await claimNextSerialized(db);
  if (!job) return { outcome: 'idle' };

  // PRE-FLIGHT (2026-09-25, David's directive): jobs are idempotent only when
  // the graph they target is in a consistent state. Two failure modes:
  //   (a) GRAPH MISSING — retract (or a manual graph drop) wiped the graph
  //       between the previous claim and this one. concepts_done is a lie
  //       against an absent graph.
  //   (b) GRAPH EXISTS BUT UNDERPOPULATED — dataprep's ensure-graph on the
  //       first POST of a new drain recreates an empty collection, then the
  //       worker sees "graph exists" and resumes against a stale concepts_done
  //       count from the prior drain (live-caught 2026-09-25: 442 claimed,
  //       3+27 docs in graph). Same liar.
  // Both modes reset the repo's concepts_done + requeue the meta rows, then
  // FALL THROUGH so the next POST ingests this concept into the (re)created
  // graph (case a) or the partial graph (case b). The original dead-letter
  // design comment at :746-749 is preserved for unrelated GRAPH-GONE
  // dead-lettering — this pre-flight is the JOB-CLAIM-TIME analogue.
  const expectedGraph = job.graph_name || `OKF_${job.repo_id}`;
  // G-2 fix (#1022): graphExists is ASYNC — the pre-2026-09-26 code omitted the
  // await, so `!Promise` was always false and this entire reset branch was dead
  // code in production (the jest stub `async () => true` masked it).
  if (!(await graphLifecycle.graphExists(db, expectedGraph))) {
    logger.warn('[INGEST-WORKER] graph missing at process time — recreating + resetting drain', {
      repo_id: job.repo_id,
      expected_graph: expectedGraph,
      concept_id: job.concept_id
    });
    try {
      // G-3 fix (#1023): dotted keys ('rag_ingestion.concepts_done') are stored
      // as FLAT attributes, never nested paths — the exact gotcha documented in
      // _refreshRagIngestion below (:156-161). Read-modify-write the nested
      // object so the reset actually reaches the record the dashboard reads.
      const current = await db
        .collection('okf_repositories')
        .document(job.repo_id)
        .catch(() => null);
      if (current) {
        await db.collection('okf_repositories').update(job.repo_id, {
          rag_ingestion: Object.assign({}, current.rag_ingestion || {}, {
            concepts_done: 0,
            last_reset_reason: 'graph_missing_at_resume',
            last_reset_at: new Date().toISOString()
          }),
          updated_at: new Date().toISOString()
        });
      }
    } catch (e) {
      logger.warn('[INGEST-WORKER] reset concepts_done failed', {
        repo_id: job.repo_id,
        err: e.message
      });
    }
    try {
      await db.query(aql`
        FOR m IN okf_concepts_meta
          FILTER m.repo_id == ${job.repo_id} AND m.graph_name == ${expectedGraph}
          UPDATE m WITH {
            index_status: 'parsed',
            worker_claimed_at: null,
            ingest_attempts: 0,
            last_error: null,
            next_attempt_after: null
          } IN okf_concepts_meta
      `);
    } catch (e) {
      logger.warn('[INGEST-WORKER] reset meta rows failed', {
        repo_id: job.repo_id,
        expected_graph: expectedGraph,
        err: e.message
      });
    }
    logger.info('[INGEST-WORKER] reset complete; proceeding with recreate + re-ingest', {
      repo_id: job.repo_id,
      expected_graph: expectedGraph
    });
  }
  // NOTE: an "underpopulated" pre-flight (graph exists but SOURCE/ENTITY counts
  // < concepts_done) was attempted here (David's directive, 2026-09-25). It
  // RACE-CONDITIONED in production: multiple parallel lanes + the timing gap
  // between dataprep's chunk write and the callback that flips the meta row
  // produced false-positive resets every few seconds, wiping real progress.
  // Removed (2026-09-25). The missing-graph branch above catches the user's
  // actual worry (graph absent); for underpopulated, rely on the existing
  // settle path's doc-count cross-check (see _settleIngest -> promoteGraph).

  return withSpan('okf.ingest.worker.job', async (span) => {
    span.setAttribute('okf.concept_id', job.concept_id);
    span.setAttribute('okf.repo_id', job.repo_id);
    const startedAt = Date.now();
    const conceptId = job.concept_id;
    const fileId = conceptId; // the concept_id is the dataprep fileId (content-keyed)

    // 0. ALWAYS RETRACT (WS5, David, 2026-09-25): idempotent re-ingest.
    //    dataprep "appends, never replaces" — a concept that fails mid-POST
    //    leaves partial chunks behind; the next attempt's POST without a
    //    retract would append a duplicate set (live-caught first-failure
    //    chunk residue). The pre-2026-09 guard key `job.last_good_index_at`
    //    only fired for re-indexed concepts, missing the FIRST-attempt
    //    partial-failure case. Always retract — dataprep's retract is a
    //    no-op when no chunks exist for the fileId (idempotent), so the
    //    cost is one extra HTTP call per concept on the success path.
    //    Best-effort: a retract failure logs and proceeds to the POST (the
    //    existing re-index fallback).
    try {
      await authedAxios.post(
        `${config.dataprep.url}/v1/dataprep/retract_file`,
        { fileId, graphName: job.graph_name || `OKF_${job.repo_id}` },
        { timeout: 30000 }
      );
      if (job.last_good_index_at) {
        logger.info('Ingest worker: re-index retract done (stale chunks cleared)', { concept_id: conceptId });
      }
    } catch (err) {
      const intent = job.last_good_index_at ? 're-index retract' : 'pre-POST retract';
      logger.warn(`Ingest worker: ${intent} failed (proceeding): [${conceptId}] ${err.message}`);
      writeBundleIngestionLog(
        job.repo_id,
        conceptId,
        'WARN',
        'System',
        `${intent} failed (proceeding): ` + err.message
      );
    }

    // 1. POST the concept's markdown DIRECTLY to dataprep (content-only).
    //    Re-serialize from the stored meta row (frontmatter + body).
    const conceptMd = markdownFor({ frontmatter: job.frontmatter || {}, body: job.body || '' });
    let kick;
    // NOTE (2026-08-21): the worker no longer mirrors "started"/"completed"
    // System entries — dataprep's own per-stage logs (System/Chunking/
    // Contextualization/Labeling/Graph, prefixed with the concept file name)
    // mirror to the bundle zip directly. The worker mirror remains ONLY for
    // verdicts dataprep cannot report itself: its own POST failures,
    // dataprep-side failure statuses, and drain timeouts.
    try {
      kick = await authedAxios.post(
        `${config.dataprep.url}${config.dataprep.ingestPath}`,
        {
          fileId,
          // The concept's original filename (e.g. 'ecitizen_digital_payments.md')
          // is mirrored into the bundle zip's ingestion log so the bundle's
          // UI Ingestion Log tab is traceable to the source concept file
          // (David's 4th-time directive, 2026-08-20).
          fileName: `${conceptId.replace(/^concepts\//, '')}.md`,
          fileBase64: Buffer.from(conceptMd).toString('base64'),
          fileType: 'text/markdown',
          fileLabels: Array.isArray(job.ingest_labels) ? job.ingest_labels : [],
          graphName: job.graph_name || `OKF_${job.repo_id}`,
          bundleVersion: job.bundle_version != null ? job.bundle_version : null,
          conceptId,
          // EXPLICIT callback identity (David, 2026-08-31): born-right graph
          // names carry repo name+version — dataprep must never parse the
          // repo_id out of a name.
          repoId: job.repo_id
        },
        { timeout: 30000 }
      );
    } catch (err) {
      const status = err && err.response && err.response.status;
      if (status === 429) {
        // Dataprep single-flight busy (another drain in flight) — back off to
        // the next poll cycle; never hammer, never transition states.
        // CLAIM CLEAR (reaper-fairness, 2026-09-13): the row was claimed but
        // never kicked — leaving the claim stamped would age it past the
        // reaper's grace window during a saturated multi-hour drain and get
        // the concept dead-lettered as "stuck" while perfectly healthy.
        try {
          await conceptMetaService.upsertConceptMeta(
            job.repo_id,
            { concept_id: conceptId, repo_id: job.repo_id },
            { patch: { worker_claimed_at: null } }
          );
        } catch {
          /* best-effort */
        }
        logger.info('Ingest worker: dataprep busy (429) — backing off', { concept_id: conceptId });
        recordJob('busy');
        return { outcome: 'busy', concept_id: conceptId };
      }
      // 2-9-5 atomicity pass (2026-08-24): TOUCH the row (the patch stamps
      // updated_at) so claimNextJob's SORT updated_at ASC advances to the NEXT
      // concept next cycle — a poison concept must never starve the queue
      // head-of-line. The row stays 'parsed' and is retried on a later cycle.
      try {
        // §5.5 kick backoff: transport failure = dataprep unreachable — park
        // the row when backoff is enabled (disabled by default: null → no-op).
        const parked = nextAttemptAfter(job.ingest_attempts);
        await conceptMetaService.upsertConceptMeta(
          job.repo_id,
          { concept_id: conceptId, repo_id: job.repo_id },
          {
            patch: {
              last_worker_error: `dataprep POST failed: ${err.message}`.slice(0, 500),
              // CLEAR the claim (live-fixed 2026-09-03): the touch above moves
              // the row to the FIFO BACK, so its legitimate retry is the whole
              // queue away — but the reaper measures claim age. A stale claim
              // on an errored row is NOT a lost drain; returning it to the
              // unclaimed pool lets a lane re-claim it long before the grace
              // window. (Live: 10 healthy rows dead-lettered after dataprep
              // was briefly not-ready at worker start.)
              worker_claimed_at: null,
              ...(parked ? { next_attempt_after: parked } : {})
            }
          }
        );
      } catch {
        /* best-effort — the error log below still records it */
      }
      recordJob('error');
      logger.error('Ingest worker: dataprep POST failed', { concept_id: conceptId, error: err.message });
      // DIRECTIVE (David, 2026-09-04): EVERY drain failure reaches the
      // ingestion log — silent catch-and-continue is banned in the drain path.
      writeBundleIngestionLog(job.repo_id, conceptId, 'ERROR', 'System', 'dataprep kick failed: ' + err.message);
      return { outcome: 'error', concept_id: conceptId, error: err.message };
    }
    if (kick.status !== 200 && kick.status !== 202) {
      try {
        // §5.5 kick backoff: only a 5xx dataprep parks the row (the service
        // is failing) — a 4xx is a deterministic rejection, prompt retry
        // preserves the reaper's attempt accounting for it.
        const parked = kick.status >= 500 ? nextAttemptAfter(job.ingest_attempts) : null;
        await conceptMetaService.upsertConceptMeta(
          job.repo_id,
          { concept_id: conceptId, repo_id: job.repo_id },
          {
            patch: {
              last_worker_error: `dataprep status ${kick.status}`.slice(0, 500),
              worker_claimed_at: null, // claim cleared — see the POST-failed path
              ...(parked ? { next_attempt_after: parked } : {})
            }
          }
        );
      } catch {
        /* best-effort */
      }
      recordJob('error');
      logger.error('Ingest worker: dataprep rejected', { concept_id: conceptId, status: kick.status });
      writeBundleIngestionLog(
        job.repo_id,
        conceptId,
        'ERROR',
        'System',
        'dataprep rejected the concept (status ' + kick.status + ')'
      );
      return { outcome: 'error', concept_id: conceptId, error: `dataprep status ${kick.status}` };
    }

    // 2. Wait for the concept's terminal state — the okf-server concept-status
    //    callback (dataprep → okf-server) transitions the meta row to indexed|failed.
    const window = jobWindowMs(job);
    const terminal = await waitForTerminal(db, job.repo_id, conceptId, window);
    const durationMs = Date.now() - startedAt;
    span.setAttribute('okf.ingest.worker.outcome', terminal.status);
    span.setAttribute('okf.ingest.worker.duration_ms', durationMs);

    // CLAIM CLEAR on timeout (reaper-fairness, 2026-09-13): a timed-out wait
    // leaves the row 'parsed' with a claim that would age past the reaper's
    // grace window and dead-letter it as "stuck" — but the row may simply be
    // a large document still draining dataprep-side. Clearing the claim
    // returns it to the unclaimed pool (immediately reclaimable — claims go
    // stale after JOB_TIMEOUT_MS) so the reaper only ever catches TRUE
    // mid-drain process deaths.
    if (terminal.status === 'timeout') {
      // DEDUPE GUARD (David, 2026-09-15): the worker gave up at JOB_TIMEOUT_MS
      // but dataprep's per-doc retry path with 12-batch files can legitimately
      // take 9-13 minutes (live-captured). The next worker cycle would otherwise
      // re-enqueue a concept dataprep already finished, producing more HTTP 409
      // WRITE_CONFLICTs on _ENTITY and a duplicate-ingest storm (live: same
      // file_id completed 3x in 60s before this fix). Re-read the row's
      // CURRENT index_status; if dataprep flipped it during the wait, treat as
      // ingested and do NOT clear the claim (which would re-enqueue).
      try {
        const currentRows = await (
          await db.query(aql`
          FOR m IN okf_concepts_meta FILTER m.repo_id == ${job.repo_id} AND m.concept_id == ${conceptId}
            RETURN KEEP(m, ['index_status', 'chunk_count'])
          `)
        ).all();
        const current = currentRows[0];
        if (current && (current.index_status === 'indexed' || current.index_status === 'failed')) {
          logger.info('Ingest worker: timeout but dataprep already settled — accepting outcome (no requeue)', {
            repo_id: job.repo_id,
            concept_id: conceptId,
            index_status: current.index_status,
            chunk_count: current.chunk_count
          });
          return {
            outcome: current.index_status === 'indexed' ? 'ingested' : 'failed',
            concept_id: conceptId,
            chunk_count: current.chunk_count || 0,
            last_error: null
          };
        }
        // Genuine timeout (dataprep never flipped the row). §5.9 expiry =
        // PROBE, not kill: in adaptive mode ask dataprep whether the
        // ingestion task is still alive before letting the next cycle
        // WS5-retract the paid in-flight work.
        let taskAlive = false;
        if (ADAPTIVE_WINDOWS()) {
          try {
            const probe = await authedAxios.post(
              `${config.dataprep.url}/v1/dataprep/task_status`,
              { fileId },
              { timeout: 10000 }
            );
            taskAlive = !!(probe.data && probe.data.alive);
          } catch (probeErr) {
            logger.warn('Ingest worker: task liveness probe failed — treating task as dead', {
              repo_id: job.repo_id,
              concept_id: conceptId,
              error: probeErr.message
            });
          }
        }
        if (taskAlive) {
          // DEFER (spec §5.9): park the row for another window, clear the
          // claim, and re-kick NOTHING — the in-flight run's callback flips
          // the row out of 'parsed' on its own (the dedupe guard above
          // already accepts that outcome). WS5's retract is never reached
          // while the park holds, so no live work is destroyed. If the task
          // dies anyway, the park expires after one window and the drain
          // resumes — the reaper's attempt ceiling still bounds total churn.
          try {
            await conceptMetaService.upsertConceptMeta(
              job.repo_id,
              { concept_id: conceptId, repo_id: job.repo_id },
              {
                patch: {
                  worker_claimed_at: null,
                  next_attempt_after: new Date(Date.now() + window).toISOString()
                }
              }
            );
          } catch {
            /* best-effort */
          }
          recordJob('deferred');
          logger.info('Ingest worker: window expired but dataprep task ALIVE — deferred, no retract/re-kick', {
            repo_id: job.repo_id,
            concept_id: conceptId,
            window_ms: window
          });
          return { outcome: 'deferred', concept_id: conceptId };
        }
        // Dead/unknown task (or adaptive off) — release the claim so the row
        // is reclaimable for the next cycle. The next kick's WS5 retract is
        // then CORRECT: nothing alive to destroy.
        await conceptMetaService.upsertConceptMeta(
          job.repo_id,
          { concept_id: conceptId, repo_id: job.repo_id },
          { patch: { worker_claimed_at: null } }
        );
      } catch {
        /* best-effort */
      }
    }

    // 3. Report (the callback owns the meta transition + the edge write — the
    //    worker only observes the outcome).
    const outcome = terminal.status === 'Ingested' ? 'ingested' : terminal.status === 'timeout' ? 'timeout' : 'failed';

    // D4-b SELF-HEAL (review decision 2026-08-24): a RE-INDEX that retracted
    // the old chunks and then FAILED leaves the concept with ZERO chunks —
    // previously-valid content was destroyed (blind+edge findings). Reset the
    // meta row to 'parsed' ONCE so the next worker cycle retries the ingest
    // (restoring the chunks); the reindex_retry guard prevents an infinite
    // poison-concept loop — a second consecutive failure dead-letters.
    if (outcome === 'failed' && job.last_good_index_at && !job.reindex_retry) {
      try {
        await conceptMetaService.upsertConceptMeta(
          job.repo_id,
          { concept_id: conceptId, repo_id: job.repo_id },
          { patch: { index_status: 'parsed', reindex_retry: true, worker_claimed_at: null } }
        );
        logger.warn('Ingest worker: re-index failed after retract — reset to parsed for ONE retry', {
          concept_id: conceptId,
          repo_id: job.repo_id
        });
      } catch (err) {
        logger.error('Ingest worker: re-index retry reset failed', { concept_id: conceptId, error: err.message });
      }
    }
    recordJob(outcome);
    // Mirror ONLY failure/timeout verdicts — dataprep's per-stage logs (incl.
    // the System start/complete lines) already mirror to the bundle zip;
    // a worker "completed" entry would duplicate them.
    if (outcome === 'failed') {
      writeBundleIngestionLog(
        job.repo_id,
        conceptId,
        'ERROR',
        'System',
        'Concept ingestion failed: ' + terminal.status + (terminal.last_error ? ' — ' + terminal.last_error : '')
      );
    } else if (outcome === 'timeout') {
      writeBundleIngestionLog(
        job.repo_id,
        conceptId,
        'WARN',
        'System',
        `Concept ingestion timed out (${Math.round(window / 1000)}s window)`
      );
    }
    auditService
      .writeAudit({
        actor: 'okf-worker',
        action: `ingest.${outcome}`,
        repo_id: job.repo_id,
        source_ip: null,
        concept_id: conceptId,
        description:
          outcome === 'indexed'
            ? 'Concept "' + conceptId + '" indexed into the repository graph'
            : 'Concept "' + conceptId + '" ingest ' + outcome
      })
      .catch(() => {
        /* best-effort */
      });
    // RAG-INGESTION PROGRESS (import ≠ RAG boundary, 2026-09-04): the drain
    // runs only while ARMED (approved repos); refresh the repo's
    // rag_ingestion record after every terminal state so the dashboard shows
    // live progress — and complete it when the repo has no parsed rows left.
    await _refreshRagIngestion(db, job.repo_id);
    logger.info('Ingest worker job finished', {
      concept_id: conceptId,
      repo_id: job.repo_id,
      outcome,
      chunks: terminal.chunk_count,
      duration_ms: durationMs
    });
    if (terminal.status === 'vanished') {
      recordJob('vanished');
      logger.info('Ingest worker: concept vanished mid-drain', { concept_id: conceptId });
      return { outcome: 'vanished', concept_id: conceptId };
    }
    return { outcome, concept_id: conceptId, chunks: terminal.chunk_count };
  });
}

/**
 * Sweep orphans (test hook): OKF files docs whose okf_concepts_meta row is
 * gone (e.g. a partial bundle retract removed meta but left the files doc) —
 * retract via doc-repo (graph-aware since the G5 fix) and remove the doc.
 *
 * SAFETY (live-caught run 14): a GRACE WINDOW (default 1h) skips fresh docs —
 * an in-flight ingest/write sequence must never be reaped mid-run, and the
 * meta-row check is only trustworthy once the writer has had time to settle.
 * Victims are logged IN THE MESSAGE STRING (the console log formatter strips
 * structured metadata fields — a silent sweep is unauditable).
 */
async function _sweepOnce() {
  const db = await getDb();
  const graceMs = safeIntOrZero('OKF_INGEST_WORKER_SWEEP_GRACE_MS', 3600000);
  // REVIEW FIX (critical, 2026-08-17): the orphan predicate previously read
  // `f.originalFileName` — a field that is NEVER persisted (doc-repo folds it
  // into `file_name`), so EVERY healthy OKF file matched as an orphan and the
  // sweep retracted live chunks after the grace window (run-14's killer). The
  // concept_id derives from `file_name` (strip .md; match the parser's bare-id
  // form) and the grace filter REQUIRES a valid uploaded_date (AQL null<number
  // is TRUE — a missing date must fail safe, never fail open).
  const orphans = await (
    await db.query(aql`
    FOR f IN files
      FILTER f.repo_id != null AND f.dataprep.status != 'Pending'
      // WS1 (David, 2026-09-25): bundle zips (is_bundle=true) are NEVER orphans
      // in the OKF content-only chunking model. They're the per-version
      // ingestion artifact — they MUST live as long as the version itself
      // (live-forever policy, see plan §WS3). The pre-2026-09 sweep matched
      // bundles because bundles are per-repo docs whose file_name does NOT
      // match any okf_concepts_meta.concept_id (no .md stripping); the only
      // fix is an explicit is_bundle exclusion. Without this guard the hourly
      // sweep deleted all 4 ingested repos' bundle zips within ~1h.
      FILTER (f.is_bundle == null OR f.is_bundle == false)
      FILTER f.uploaded_date != null AND f.uploaded_date != '' AND DATE_TIMESTAMP(f.uploaded_date) < DATE_NOW() - ${graceMs}
      FILTER LENGTH(FOR m IN okf_concepts_meta FILTER m.repo_id == f.repo_id AND m.concept_id == SUBSTRING(f.file_name, 0, LENGTH(f.file_name) - 3) LIMIT 1 RETURN 1) == 0
      LIMIT 10
      RETURN KEEP(f, ['file_id', 'file_name', 'repo_id'])
  `)
  ).all();
  const victims = [];
  let cleaned = 0;
  for (const f of orphans) {
    try {
      await authedAxios.post(`${config.documentRepository.url}/api/files/${f.file_id}/retract`, {}, { timeout: 30000 });
    } catch (err) {
      const status = err && err.response && err.response.status;
      if (status !== 404 && status !== 500) {
        logger.warn(`Ingest worker sweep: retract failed for ${f.file_id} (${err.message})`);
        continue;
      }
      // already retracted / nothing to retract — still remove the doc below
    }
    await db.query(aql`FOR x IN files FILTER x.file_id == ${f.file_id} REMOVE x IN files`);
    victims.push(f.file_name || f.file_id);
    cleaned += 1;
  }
  if (cleaned > 0) logger.info(`Ingest worker sweep cleaned ${cleaned} orphan(s): ${victims.join(', ')}`);
  return { cleaned, victims };
}

/**
 * Reap stuck 'parsed' meta rows (2-9-5 atomicity pass, 2026-08-24).
 *
 * WHY: settle fires only when ZERO parsed rows remain and mintVersion's D1
 * gate refuses while any parsed row exists — a concept whose drain died
 * without a terminal callback (okf-server restart between kick and callback,
 * dataprep crash, repeated POST errors with the row touched out of the queue
 * head) would block BOTH forever, with no retry deadline and no visibility.
 *
 * Semantics history: the ORIGINAL rule (any parsed row older than grace)
 * mass-killed healthy crawl backlogs — the worker is SEQUENTIAL (1 concept
 * per interval + drain time), so a 340-concept crawl waits hours in the
 * queue and its untouched tail sailed past the 1h window — 145 red 'failed'
 * dots across the usa-gov/wikipedia crawl repos, all "reaper dead-letter",
 * zero actual content failures. The 2026-09-02 HEAD-STAGNATION rule (only
 * the FIFO head may reap, by age) ALSO false-positived.
 *
 * CLAIM-STAMP SEMANTICS (second fix, 2026-09-03 — the head-window rule ALSO
 * false-positived: at ~20 drains/hour vs a 1500-row crawl backlog the queue
 * HEAD stays >1h old for DAYS, so even head-only reaping killed 3 rows per
 * hourly sweep, live-verified 05:26→08:33). Age of the ROW is meaningless;
 * the only true "stuck" signals are claim state:
 *   1. DIED MID-DRAIN — the row was claimed (worker_claimed_at set) and is
 *      still 'parsed' past the grace window: the process died between kick
 *      and callback (restart/crash), or the callback is lost forever.
 *   2. POISON LOOP — the row has been claimed too many times
 *      (ingest_attempts >= OKF_INGEST_WORKER_MAX_CLAIMS, default 8): every
 *      attempt ends in timeout/error and re-claim. Dead-letter unblocks the
 *      mint D1 gate with a visible last_error (recovery = re-ingest).
 * WAITING rows (never claimed, or claimed recently) are immune regardless of
 * backlog depth — updated_at (the FIFO key) is never consulted.
 *
 * @returns {Promise<{reaped: number, victims: string[]}>}
 */
async function _reapStuckParsed() {
  const db = await getDb();
  const graceMs = safeIntOrZero('OKF_INGEST_WORKER_REAP_GRACE_MS', 3600000);
  const maxClaims = Math.max(1, safeIntOrZero('OKF_INGEST_WORKER_MAX_CLAIMS', 8));
  const stuck = await (
    await db.query(aql`
    FOR m IN okf_concepts_meta
      FILTER m.index_status == 'parsed'
      FILTER
        (m.worker_claimed_at != null AND m.worker_claimed_at != '' AND DATE_TIMESTAMP(m.worker_claimed_at) < DATE_NOW() - ${graceMs})
        OR (m.ingest_attempts != null AND m.ingest_attempts >= ${maxClaims})
      LIMIT 10
      RETURN KEEP(m, ['repo_id', 'concept_id', 'worker_claimed_at', 'ingest_attempts'])
  `)
  ).all();
  const victims = [];
  for (const m of stuck) {
    try {
      await conceptMetaService.upsertConceptMeta(
        m.repo_id,
        { concept_id: m.concept_id, repo_id: m.repo_id },
        {
          patch: {
            index_status: 'failed',
            last_error:
              'ingest drain stuck — no terminal callback within the grace window (reaper dead-letter; recovery = re-ingest)'
          }
        }
      );
      victims.push(`${m.repo_id}/${m.concept_id}`);
      writeBundleIngestionLog(
        m.repo_id,
        m.concept_id,
        'ERROR',
        'System',
        'Concept dead-lettered by the stuck-parsed reaper (claim-stale past grace, or too many claims)'
      );
    } catch (err) {
      logger.warn(`Ingest worker reaper: failed to dead-letter ${m.repo_id}/${m.concept_id} (${err.message})`);
    }
  }
  if (victims.length > 0) {
    logger.warn(`Ingest worker reaper dead-lettered ${victims.length} stuck-parsed concept(s): ${victims.join(', ')}`);
  }
  return { reaped: victims.length, victims };
}

/**
 * (b) SELF-TERMINATION (David, 2026-09-04: "a conversion/drain that discovers
 * its repo or graph is gone must log the error AND self-terminate — never
 * linger"): 'parsed' rows whose repository doc is missing or soft-deleted can
 * never be claimed (the claim gate joins okf_repositories) and would sit in
 * the queue forever. Dead-letter them TERMINALLY with the reason; the
 * ingestion-log mirror attempt is best-effort (the bundle zip is usually gone
 * with the repo — the miss is logged inside the mirror).
 * GRAPH-GONE is deliberately NOT dead-lettered here: dataprep re-creates a
 * missing working graph on the next kick, so failed concepts stay recoverable
 * via re-ingest (D4-b); the failure is already terminal + visible per concept.
 * @returns {Promise<{dead: number, victims: string[]}>}
 */
async function _deadLetterOrphanedRows() {
  const db = await getDb();
  const orphans = await (
    await db.query(aql`
    FOR m IN okf_concepts_meta
      FILTER m.index_status == 'parsed'
      LET repo = DOCUMENT('okf_repositories', m.repo_id)
      FILTER repo == null OR repo.deleted_at != null
      LIMIT 50
      RETURN KEEP(m, ['repo_id', 'concept_id'])
  `)
  ).all();
  const victims = [];
  for (const m of orphans) {
    try {
      await conceptMetaService.upsertConceptMeta(
        m.repo_id,
        { concept_id: m.concept_id, repo_id: m.repo_id },
        {
          patch: {
            index_status: 'failed',
            last_error: 'repository deleted before the drain ran — concept row orphaned (terminal; not recoverable)',
            worker_claimed_at: null
          }
        }
      );
      victims.push(m.repo_id + '/' + m.concept_id);
      writeBundleIngestionLog(
        m.repo_id,
        m.concept_id,
        'ERROR',
        'System',
        'Concept dead-lettered: its repository was deleted before the drain ran'
      );
    } catch (err) {
      logger.warn('Ingest worker: orphan dead-letter failed', {
        repo_id: m.repo_id,
        concept_id: m.concept_id,
        error: err.message
      });
    }
  }
  if (victims.length > 0) {
    logger.warn(
      'Ingest worker dead-lettered ' +
        victims.length +
        ' orphaned concept row(s) (repository gone): ' +
        victims.join(', ')
    );
  }
  return { dead: victims.length, victims };
}

/**
 * SETTLE RECONCILIATION (live wedge 2026-09-13, David: "31 hours and still
 * not drained"): the settle check runs ONLY as a side-effect of a job's
 * terminal state — but the last 'parsed' rows of a drain can be transitioned
 * by someone else (the sweep's reaper dead-letter, a lost callback, an
 * okf-server restart). When that happens no job ever completes again, the
 * empty queue is never re-examined, and an ARMED repo sits 'draining'
 * forever — ingested_at never set, retract impossible (www-gov-uk-full-crawl:
 * 922 indexed / 75 reaper-dead-lettered / 0 parsed, stuck 19:55 → 31h+).
 *
 * Every sweep (and worker start) re-examines every ARMED repo: zero parsed
 * rows → run the SAME settle path a finishing job would have run. Idempotent
 * (_settleIngest honors rag_drain_active, and _refreshRagIngestion returns
 * for disarmed repos).
 * @returns {Promise<{reconciled: number, repos: string[]}>}
 */
async function _reconcileArmedRepos() {
  const db = await getDb();
  const armed = await (
    await db.query(aql`
    FOR r IN okf_repositories
      FILTER r.rag_drain_active == true AND r.deleted_at == null
      LET parsedCount = LENGTH(FOR m IN okf_concepts_meta FILTER m.repo_id == r.repo_id AND m.index_status == 'parsed' LIMIT 1 RETURN 1)
      FILTER parsedCount == 0
      RETURN KEEP(r, ['repo_id'])
  `)
  ).all();
  for (const r of armed) {
    logger.info('Ingest worker reconcile: armed repo has an empty queue — running the settle check', {
      repo_id: r.repo_id
    });
    await _refreshRagIngestion(db, r.repo_id);
  }
  return { reconciled: armed.length, repos: armed.map((r) => r.repo_id) };
}

/** One drain cycle for ONE lane — each lane self-serializes (its poll awaits
 * the cycle before re-arming), so lanes never overlap themselves; separate
 * lanes run concurrently by design. */
async function _drainCycle() {
  try {
    await _processOneJob();
  } catch (err) {
    logger.error('Ingest worker cycle error', { error: err.message });
    // DIRECTIVE (a): a claim/engine failure must not be invisible to the repos
    // it stalls — mirror the error to every ARMED repo (cap 5; the mirror is
    // best-effort and logs its own failures).
    try {
      const db = await getDb();
      const armed = await (
        await db.query(aql`
        FOR r IN okf_repositories
          FILTER r.rag_drain_active == true AND r.deleted_at == null
          SORT r.updated_at ASC
          LIMIT 5
          RETURN KEEP(r, ['repo_id'])
      `)
      ).all();
      for (const r of armed) {
        writeBundleIngestionLog(
          r.repo_id,
          'worker',
          'ERROR',
          'System',
          'Ingest worker cycle failed (drain stalled): ' + err.message
        );
      }
    } catch {
      /* the error log above already records it */
    }
  }
}

/** Drain lanes (PARALLEL, David 2026-09-03: "repositories are independent
 * units of work and MUST run in parallel and utilize the machine resources
 * as much as possible", capped by configuration). Each lane loops
 * claim → dataprep → wait-terminal independently; a lane blocked on a slow
 * drain no longer starves the others. Requires the dataprep side to accept
 * concurrent ingests (DATAPREP_INGEST_CONCURRENCY) — otherwise the extra
 * lanes just cycle through 429 backoffs. */
function laneCount() {
  return Math.max(1, safeInt('OKF_INGEST_CONCURRENCY', 1));
}

/** In-process claim mutex (Node is single-threaded): the claim READ + STAMP
 * must complete for one lane before the next lane claims, or two lanes could
 * pick the same row. One okf-server container is assumed (multi-process
 * deployments would need a DB-side atomic claim — the `fair` strategy's fused
 * statement IS that claim; the mutex stays as a cheap belt-and-braces that
 * also keeps `fifo` single-container-safe). */
let _claimChain = Promise.resolve();
function claimNextSerialized(db) {
  const run = _claimChain.then(() => (claimStrategy() === 'fair' ? claimNextJobFair(db) : claimNextJob(db)));
  _claimChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function start() {
  if (!enabled()) {
    logger.info('Ingest worker DISABLED (OKF_INGEST_WORKER_ENABLED=false)');
    return;
  }
  const lanes = laneCount();
  logger.info('Ingest worker starting', {
    interval_ms: intervalMs(),
    sweep_interval_ms: sweepIntervalMs(),
    lanes,
    claim_strategy: claimStrategy(),
    repo_ingest_cap: repoIngestCap()
  });
  // One self-scheduling loop per lane; a lane busy draining simply misses
  // ticks (its timer fires only after its cycle settles). POLL-CYCLE TIMEOUT
  // (David, 2026-09-15): a wedged concept (dataprep 429 storm, network
  // hang, broken future) must NOT poison the lane forever. Race the cycle
  // against OKF_INGEST_WORKER_CYCLE_TIMEOUT_MS (default 30 min = 2x
  // JOB_TIMEOUT_MS); on timeout, log loudly + release any claim the cycle
  // owned + re-schedule. The next cycle's claim reaper clears the stale row.
  const cycleTimeoutMs = () =>
    // §5.9 LOCKSTEP: in adaptive mode a lane's cycle legitimately spans the
    // largest window (the lane cannot know the claimed job's size before
    // claiming) — the flat cycle cap must never force-release a lane whose
    // job is still inside its window (desync → overlap risk).
    Math.max(safeInt('OKF_INGEST_WORKER_CYCLE_TIMEOUT_MS', 1800000), ADAPTIVE_WINDOWS() ? windowMaxMs() : 0);
  _drainTimers = [];
  for (let lane = 0; lane < lanes; lane++) {
    const poll = async () => {
      try {
        let timeoutHandle;
        const timeoutPromise = new Promise((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error('Ingest worker cycle timeout')), cycleTimeoutMs());
        });
        try {
          await Promise.race([_drainCycle(), timeoutPromise]);
        } finally {
          clearTimeout(timeoutHandle);
        }
      } catch (err) {
        logger.error('Ingest worker: cycle exceeded timeout OR threw — releasing lane', {
          lane,
          error_name: err && err.name,
          error_message: err && err.message
        });
        // Best-effort: we don't know which row was active here — the next
        // claimNextJob will pick the freshest stale-claim row first (FILTER
        // clause orders by updated_at ASC).
      } finally {
        const i = _drainTimers.indexOf(poll);
        _drainTimers[i >= 0 ? i : _drainTimers.length] = setTimeout(poll, intervalMs());
      }
    };
    poll();
  }
  const sweep = async () => {
    if (_sweeping) return;
    _sweeping = true;
    try {
      // RECONCILE FIRST (2026-09-13 wedge fix): settle any ARMED repo whose
      // queue reached zero outside a job completion (reaper dead-letter,
      // lost callback, restart) BEFORE the reaper runs — the reaper must
      // never be the last writer leaving a repo armed forever.
      await _reconcileArmedRepos();
      await _sweepOnce();
      await _reapStuckParsed();
      await _deadLetterOrphanedRows();
    } catch (err) {
      logger.error('Ingest worker sweep error', { error: err.message });
    } finally {
      _sweeping = false;
      _sweepTimer = setTimeout(sweep, sweepIntervalMs());
    }
  };
  _sweepTimer = setTimeout(sweep, sweepIntervalMs());
  // STARTUP RECONCILE: a restart between the last terminal transition and a
  // settle (or with the queue emptied by the reaper) must settle on boot, not
  // wait up to an hour for the first sweep.
  _reconcileArmedRepos().catch((err) => {
    logger.warn('Ingest worker startup reconcile failed (non-fatal — the sweep retries)', { error: err.message });
  });
}

function stop() {
  for (const t of _drainTimers || []) clearTimeout(t);
  _drainTimers = [];
  if (_sweepTimer) clearTimeout(_sweepTimer);
  _sweepTimer = null;
}

module.exports = {
  start,
  stop,
  _processOneJob,
  _sweepOnce,
  _reapStuckParsed,
  _deadLetterOrphanedRows,
  _reconcileArmedRepos,
  _refreshRagIngestion,
  claimNextJob,
  getBundleFileId,
  invalidateBundleCache,
  jobWindowMs
};
