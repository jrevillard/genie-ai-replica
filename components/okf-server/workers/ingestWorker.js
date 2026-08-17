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
const dbService = require('../shared-lib/db-connection-service');
const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');
const { getMeter } = require('../shared-lib/metrics');
const conceptMetaService = require('../services/concept-meta-service');
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

/** concept_id from the files doc the orchestrator enqueued
 * (originalFileName = '<concept_id>.md' — 2.9.1 4f). The parser's
 * conceptIdFromPath strips ONLY the .md suffix (no prefix — live-verified run
 * 9: the zip entry 'index.md' → concept_id 'index'). Null when unshaped. */
function conceptIdFromFileName(fileName) {
  if (typeof fileName !== 'string' || !fileName.endsWith('.md')) return null;
  const base = fileName.replace(/\.md$/, '');
  return base || null;
}

async function getDb() {
  return dbService.getConnection('default');
}

/** Oldest Pending OKF files doc (repo_id present = orchestrator-enqueued;
 * the single-document facility — no repo_id — keeps manual/UI kicks). */
async function claimNextJob(db) {
  const rows = await (
    await db.query(aql`
    FOR f IN files
      FILTER f.dataprep.status == 'Pending' AND f.repo_id != null
      SORT f.uploaded_date ASC
      LIMIT 1
      RETURN KEEP(f, ['file_id', 'file_name', 'originalFileName', 'repo_id', 'graph_name', 'uploaded_date'])
  `)
  ).all();
  return rows[0] || null;
}

/** Terminal-state poll of ONE file (doc-repo owns the status machine). */
async function waitForTerminal(db, fileId) {
  const deadline = Date.now() + JOB_TIMEOUT_MS();
  for (;;) {
    await new Promise((r) => setTimeout(r, JOB_POLL_MS()));
    const rows = await (
      await db.query(aql`
      FOR f IN files FILTER f.file_id == ${fileId}
        RETURN KEEP(f, ['dataprep', 'chunk_count'])
    `)
    ).all();
    const row = rows[0];
    const status = row && row.dataprep && row.dataprep.status;
    if (status === 'Ingested' || status === 'Ingestion Error' || status === 'Killed') {
      return { status, chunk_count: (row && row.chunk_count) || 0 };
    }
    // The doc vanished (deleted mid-drain, e.g. bundle retract) or was
    // retracted by someone else — nothing to wait for, nothing to transition.
    if (!row || status === 'retracted' || status === 'Retracted') {
      return { status: 'vanished', chunk_count: 0 };
    }
    if (Date.now() > deadline) return { status: 'timeout', chunk_count: 0 };
  }
}

/** Transition the concept's meta row — the worker's EXCLUSIVE writes. */
async function transitionMeta(repoId, conceptId, patch) {
  // MINIMAL upsert (no frontmatter AND no body ⇒ patch-only, never clobbers
  // the 4b full-write fields — same guarded path conformance uses).
  await conceptMetaService.upsertConceptMeta(repoId, { concept_id: conceptId }, { patch });
}

/**
 * Drain ONE Pending OKF file (test hook). Returns the outcome:
 * 'ingested' | 'failed' | 'busy' | 'error' | 'timeout'.
 */
async function _processOneJob() {
  const db = await getDb();
  const job = await claimNextJob(db);
  if (!job) return { outcome: 'idle' };

  return withSpan('okf.ingest.worker.job', async (span) => {
    span.setAttribute('okf.file_id', job.file_id);
    span.setAttribute('okf.repo_id', job.repo_id);
    const startedAt = Date.now();

    // 1. Kick doc-repo's per-file ingest (okf-service token; 30s cap).
    let kick;
    try {
      kick = await authedAxios.post(
        `${config.documentRepository.url}/api/files/${job.file_id}/ingest`,
        {},
        { timeout: 30000 }
      );
    } catch (err) {
      const status = err && err.response && err.response.status;
      if (status === 429) {
        // Dataprep single-flight busy (another drain in flight) — back off to
        // the next poll cycle; never hammer, never transition states.
        logger.info('Ingest worker: dataprep busy (429) — backing off', { file_id: job.file_id });
        recordJob('busy');
        return { outcome: 'busy', file_id: job.file_id };
      }
      recordJob('error');
      logger.error('Ingest worker: kick failed', { file_id: job.file_id, error: err.message });
      return { outcome: 'error', file_id: job.file_id, error: err.message };
    }
    if (kick.status !== 200) {
      recordJob('error');
      logger.error('Ingest worker: kick rejected', { file_id: job.file_id, status: kick.status });
      return { outcome: 'error', file_id: job.file_id, error: `kick status ${kick.status}` };
    }

    // 2. Wait for the file's terminal state (doc-repo's machine).
    const terminal = await waitForTerminal(db, job.file_id);
    const durationMs = Date.now() - startedAt;
    span.setAttribute('okf.ingest.worker.outcome', terminal.status);
    span.setAttribute('okf.ingest.worker.duration_ms', durationMs);

    // 3. Transition the meta row (worker-exclusive states; D-G).
    // REVIEW FIX (2026-08-17, run-14): `originalFileName` is NEVER persisted on
// files docs (doc-repo folds it into `file_name`) — reading it first made the
// transition target the WRONG concept_id (undefined→job.file_name is correct,
// but the precedence hid it). file_name is the persisted truth, always.
const conceptId = conceptIdFromFileName(job.file_name);
    const finish = (outcome, extra) => {
      recordJob(outcome);
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
        file_id: job.file_id,
        repo_id: job.repo_id,
        concept_id: conceptId,
        outcome,
        chunks: terminal.chunk_count,
        duration_ms: durationMs,
        ...extra
      });
      return { outcome, file_id: job.file_id, concept_id: conceptId, chunks: terminal.chunk_count, ...extra };
    };

    if (terminal.status === 'Ingested') {
      if (conceptId) {
        try {
          await transitionMeta(job.repo_id, conceptId, {
            index_status: 'indexed',
            last_good_index_at: new Date().toISOString()
          });
        } catch (err) {
          logger.error('Ingest worker: indexed transition failed', {
            repo_id: job.repo_id,
            concept_id: conceptId,
            error: err.message
          });
        }
      }
      return finish('ingested');
    }
    if (terminal.status === 'timeout') {
      return finish('timeout');
    }
    if (terminal.status === 'vanished') {
      // File removed/retracted mid-drain (e.g. bundle retract) — no transition.
      recordJob('vanished');
      logger.info('Ingest worker: file vanished mid-drain', { file_id: job.file_id });
      return { outcome: 'vanished', file_id: job.file_id };
    }
    // Ingestion Error | Killed → dead-letter: 'failed' (+ the files doc already
    // carries doc-repo's error state). Recovery = re-ingest (4e hash-dedup).
    if (conceptId) {
      try {
        await transitionMeta(job.repo_id, conceptId, {
          index_status: 'failed',
          last_error: `${terminal.status} (chunks=${terminal.chunk_count})`
        });
      } catch (err) {
        logger.error('Ingest worker: failed transition errored', {
          repo_id: job.repo_id,
          concept_id: conceptId,
          error: err.message
        });
      }
    }
    return finish('failed', { terminal: terminal.status });
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

module.exports = { start, stop, _processOneJob, _sweepOnce, conceptIdFromFileName };
