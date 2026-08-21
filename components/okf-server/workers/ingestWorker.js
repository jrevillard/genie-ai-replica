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
const config = require('../config');

const DEFAULT_INTERVAL_MS = 15000;
const DEFAULT_SWEEP_INTERVAL_MS = 3600000;
// Per-file terminal-state poll — env-tunable so tests run in milliseconds.
const JOB_POLL_MS = () => safeInt('OKF_INGEST_WORKER_JOB_POLL_MS', 5000);
const JOB_TIMEOUT_MS = () => safeInt('OKF_INGEST_WORKER_JOB_TIMEOUT_MS', 600000); // 10 min (matches the smoke's proven drains)

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

let _drainTimer = null;
let _sweepTimer = null;
let _draining = false;
let _sweeping = false;

const enabled = () => (process.env.OKF_INGEST_WORKER_ENABLED || 'true').toLowerCase() !== 'false';
const intervalMs = () => safeInt('OKF_INGEST_WORKER_INTERVAL_MS', DEFAULT_INTERVAL_MS);
const sweepIntervalMs = () => safeInt('OKF_INGEST_WORKER_SWEEP_INTERVAL_MS', DEFAULT_SWEEP_INTERVAL_MS);

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
 * concept; the concept's own meta row is the queue. */
async function claimNextJob(db) {
  const rows = await (
    await db.query(aql`
    FOR m IN okf_concepts_meta
      FILTER m.index_status == 'parsed' AND m.repo_id != null
      SORT m.updated_at ASC
      LIMIT 1
      RETURN KEEP(m, ['repo_id', 'concept_id', 'graph_name', 'frontmatter', 'body', 'ingest_labels', 'bundle_version', 'updated_at'])
  `)
  ).all();
  return rows[0] || null;
}

/** Terminal-state poll of ONE concept — the okf-server concept-status callback
 * (dataprep → okf-server) transitions the meta row to 'indexed' | 'failed'.
 * The worker waits for that; a vanished/retracted concept is 'vanished'. */
async function waitForTerminal(db, repoId, conceptId) {
  const deadline = Date.now() + JOB_TIMEOUT_MS();
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
    if (row.index_status === 'failed') return { status: 'Ingestion Error', chunk_count: (row && row.chunk_count) || 0 };
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
  const job = await claimNextJob(db);
  if (!job) return { outcome: 'idle' };

  return withSpan('okf.ingest.worker.job', async (span) => {
    span.setAttribute('okf.concept_id', job.concept_id);
    span.setAttribute('okf.repo_id', job.repo_id);
    const startedAt = Date.now();
    const conceptId = job.concept_id;
    const fileId = conceptId; // the concept_id is the dataprep fileId (content-keyed)

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
          conceptId
        },
        { timeout: 30000 }
      );
    } catch (err) {
      const status = err && err.response && err.response.status;
      if (status === 429) {
        // Dataprep single-flight busy (another drain in flight) — back off to
        // the next poll cycle; never hammer, never transition states.
        logger.info('Ingest worker: dataprep busy (429) — backing off', { concept_id: conceptId });
        recordJob('busy');
        return { outcome: 'busy', concept_id: conceptId };
      }
      recordJob('error');
      logger.error('Ingest worker: dataprep POST failed', { concept_id: conceptId, error: err.message });
      return { outcome: 'error', concept_id: conceptId, error: err.message };
    }
    if (kick.status !== 200 && kick.status !== 202) {
      recordJob('error');
      logger.error('Ingest worker: dataprep rejected', { concept_id: conceptId, status: kick.status });
      return { outcome: 'error', concept_id: conceptId, error: `dataprep status ${kick.status}` };
    }

    // 2. Wait for the concept's terminal state — the okf-server concept-status
    //    callback (dataprep → okf-server) transitions the meta row to indexed|failed.
    const terminal = await waitForTerminal(db, job.repo_id, conceptId);
    const durationMs = Date.now() - startedAt;
    span.setAttribute('okf.ingest.worker.outcome', terminal.status);
    span.setAttribute('okf.ingest.worker.duration_ms', durationMs);

    // 3. Report (the callback owns the meta transition + the edge write — the
    //    worker only observes the outcome).
    const outcome = terminal.status === 'Ingested' ? 'ingested' : terminal.status === 'timeout' ? 'timeout' : 'failed';
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
        `Concept ingestion failed: ${terminal.status}`
      );
    } else if (outcome === 'timeout') {
      writeBundleIngestionLog(
        job.repo_id,
        conceptId,
        'WARN',
        'System',
        `Concept ingestion timed out (${JOB_TIMEOUT_MS() / 1000}s)`
      );
    }
    auditService
      .writeAudit({
        actor: 'okf-worker',
        action: `ingest.${outcome}`,
        repo_id: job.repo_id,
        source_ip: null
      })
      .catch(() => {
        /* best-effort */
      });
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

/** One drain cycle (guarded against overlap — the timer never stacks). */
async function _drainCycle() {
  if (_draining) return;
  _draining = true;
  try {
    await _processOneJob();
  } catch (err) {
    logger.error('Ingest worker cycle error', { error: err.message });
  } finally {
    _draining = false;
  }
}

function start() {
  if (!enabled()) {
    logger.info('Ingest worker DISABLED (OKF_INGEST_WORKER_ENABLED=false)');
    return;
  }
  const concurrency = safeInt('OKF_INGEST_CONCURRENCY', 1);
  if (concurrency > 1) {
    logger.warn(
      'OKF_INGEST_CONCURRENCY>1 requested — v1 runs SEQUENTIAL by design (dataprep single-flight); the value is accepted but not honored'
    );
  }
  logger.info('Ingest worker starting', {
    interval_ms: intervalMs(),
    sweep_interval_ms: sweepIntervalMs()
  });
  const poll = async () => {
    try {
      await _drainCycle();
    } finally {
      _drainTimer = setTimeout(poll, intervalMs());
    }
  };
  poll();
  const sweep = async () => {
    if (_sweeping) return;
    _sweeping = true;
    try {
      await _sweepOnce();
    } catch (err) {
      logger.error('Ingest worker sweep error', { error: err.message });
    } finally {
      _sweeping = false;
      _sweepTimer = setTimeout(sweep, sweepIntervalMs());
    }
  };
  _sweepTimer = setTimeout(sweep, sweepIntervalMs());
}

function stop() {
  if (_drainTimer) clearTimeout(_drainTimer);
  if (_sweepTimer) clearTimeout(_sweepTimer);
  _drainTimer = null;
  _sweepTimer = null;
}

module.exports = { start, stop, _processOneJob, _sweepOnce, claimNextJob };
