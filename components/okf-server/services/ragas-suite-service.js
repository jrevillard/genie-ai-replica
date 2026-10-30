// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
//
// ragas-suite-service — Story 8-6 (2026-10-17, ADR-okf-043): RAGAS
// benchmark suites for the Testing Lab. Clones the head-suite-service skeleton
// (same okf_head_test_runs collection, same 202+poll job pattern, same
// honest-empty semantics) and adds the RAGAS-specific legs:
//
//   beginSuiteGeneration(repoId, {repo_ids[], testset_size,
//     query_distribution[], num_personas})
//     Concept bodies of the selected repos (1..N — the current repo alone
//     or with any number of related repos) feed the ragas-service sidecar's
//     TestsetGenerator; samples land as entries (query + reference answer
//     + reference passages). ASYNC: pre-minted key + poll (his pattern).
//   updateSuiteRows / addQueries / renameSuite / deleteSuite
//     Full management parity with existing suites — add, modify, remove,
//     FLIP in-scope/out-of-scope (the RAGAS analog of positive/negative).
//   beginRunSuite(repoId, suiteKey, {metrics[]})
//     Per entry: embed → per-repo AQL top-K → unified rerank → contexts;
//     answer via the guided-JSON vLLM seam ({answer, abstained}); then ONE
//     sidecar /evaluate over the selected metric catalog (default =
//     the harness-compatible four). Progress {phase, done, total}.
//   beginExplainFailures(repoId, suiteKey)
//     Mechanical attribution (the failure-attribution matrix) + ONE guarded
//     LLM advice call that may propose knob, repository (tags via the
//     existing guardrail, concept-content curation), and prompt changes.
//   exportSuiteXlsx / importSuiteXlsx / exportResultsXlsx
//     Byte passthroughs of the sidecar's xlsx endpoints (his formats).
//
// The run NEVER calls chatqna over HTTP (the Lab's philosophy — see
// head-test-service): retrieval is replayed against the same Arango _SOURCE
// collections + TEI + rerank the retriever uses, and the answer follows the
// chatqna system-prompt contract. fidelity knobs are recorded on the run.
//
// Sidecar absence degrades honestly: RAGAS_UNAVAILABLE (503) per route —
// the same contract as the Keycloak access-control 503.

'use strict';

const { logger } = require('../shared-lib/logger');
const { isArangoNotFound } = require('./arango-errors');
const { withSpan } = require('../shared-lib/tracing');
const { createHash } = require('node:crypto');
const dbService = require('../shared-lib/db-connection-service');

const frontmatterService = require('./frontmatter-service');
const repositoryService = require('./repository-service');
const headTestService = require('./head-test-service');
const modelConfigService = require('./model-config-service');
const ragasAttributionService = require('./ragas-attribution-service');
// Serve-mode calls hit chatqna, whose handler 401s ANY unauthenticated
// request (genieai_chatqna.py handle_request) — the same service-account
// bearer the doc-repo calls use authenticates the benchmark's serve leg.
const { getServiceToken } = require('./service-token');

const COLLECTION = 'okf_head_test_runs'; // kinds: ragas_suite | ragas_run | ragas_explain

// ---------- config ---------------------------------------------------------

const RAGAS_URL = () => (process.env.OKF_RAGAS_URL || 'http://ragas-service:8090').replace(/\/+$/, '');
const RAGAS_TIMEOUT_MS = parseInt(process.env.OKF_RAGAS_TIMEOUT_MS || '600000', 10);
// Generation and evaluation are LONG jobs (minutes to hours for large
// suites), so they run sidecar-side as 202+poll background jobs — no HTTP
// connection is held open. This budget is the poller's LIVENESS HORIZON —
// how long an UNREACHABLE sidecar is retried before the job record fails.
// A reachable, running job is never timed out (David 2026-10-18: never
// trash running work on a timer); cancellation is the user's call.
const RAGAS_LONG_TIMEOUT_MS = parseInt(process.env.OKF_RAGAS_LONG_TIMEOUT_MS || '3600000', 10);
const RAGAS_JOB_POLL_MS = parseInt(process.env.OKF_RAGAS_JOB_POLL_MS || '3000', 10);
const TESTSET_SIZE_DEFAULT = Math.max(1, parseInt(process.env.OKF_RAGAS_TESTSET_SIZE_DEFAULT || '20', 10));
const MAX_ENTRIES = Math.max(1, parseInt(process.env.OKF_RAGAS_MAX_ENTRIES || '200', 10));
const RUN_CONCURRENCY = Math.max(1, parseInt(process.env.OKF_RAGAS_RUN_CONCURRENCY || '2', 10));
const CANDIDATE_K = Math.max(1, parseInt(process.env.OKF_RAGAS_CANDIDATE_K || '24', 10));

/**
 * Whether this run was scored through the SERVED pipeline (chatqna) or
 * replayed inside okf-server (whatif). Three consumers read the same fact —
 * the per-row ladder, the rank probe and the env advice, which names a
 * DIFFERENT operative knob per mode — so it lives here, once.
 */
function isServeRun(runDoc) {
  return !!(runDoc && runDoc.payload && runDoc.payload.fidelity && runDoc.payload.fidelity.retrieval
    ? runDoc.payload.fidelity.retrieval.mode === 'serve'
    : false);
}
const TOP_N = Math.max(1, parseInt(process.env.OKF_RAGAS_TOP_N || process.env.RERANKER_TOP_N || '3', 10));
// Generation corpus budget in CHUNKS (the retrievable unit). Concepts
// average 3-4 published chunks, so 1600 ≈ the 400-concept corpus this
// replaces. Read per call — an operator can raise it for a big-corpus
// deployment without a rebuild (David 2026-10-21: "we have much larger
// corpuses to process than this").
const maxCorpusChunks = () => Math.max(1, parseInt(process.env.OKF_RAGAS_MAX_CORPUS_CHUNKS || '1600', 10));
const CONTEXT_CHARS = 2000; // per-context cap stored on run rows (xlsx uses answer_first_200 anyway)
const CONCEPT_BODY_CAP = parseInt(process.env.OKF_MAX_CONCEPT_DOC_CHARS || '200000', 10);

// The DECLARED serve posture, recorded on every run doc so the record is
// self-attributing: a mass-abstention run carries the configuration it ran
// with (2026-10-27: a K=54 pool blew the reranker's per-batch token cap and
// all 50 rows abstained — the run must name its own configuration, not
// present 50 judge-scored refusals as a 0-score benchmark). Defaults mirror
// the chatqna compose block's interpolation exactly; docker-compose forwards
// the same vars to okf-server, so the snapshot is the DECLARED deployment
// posture. Scope: the retrieval/rerank/abstention variables the advisor
// reasons about — traversal, blend and translation knobs are NOT snapshotted
// (record them when advice starts reasoning about them). chatqna remains the
// authoritative reader — this block only RECORDS what the deployment
// declared.
const servePosture = () => ({
  k: parseInt(process.env.RETRIEVER_ARANGO_K || '20', 10),
  fetch_k: parseInt(process.env.RETRIEVER_ARANGO_FETCH_K || '30', 10),
  score_threshold: parseFloat(process.env.RETRIEVER_ARANGO_SCORE_THRESHOLD || '0.2'),
  distance_threshold: parseFloat(process.env.RETRIEVER_ARANGO_DISTANCE_THRESHOLD || '1'),
  lambda_mult: parseFloat(process.env.RETRIEVER_ARANGO_LAMBDA_MULT || '0.5'),
  strategy: process.env.RERANKING_STRATEGY || 'slice',
  top_n: parseInt(process.env.RERANKER_TOP_N || '3', 10),
  threshold: parseFloat(process.env.RERANKING_THRESHOLD || '0.75'),
  enforce_abstention: (process.env.CHATQNA_ENFORCE_ABSTENTION || 'true') !== 'false'
});

// An abstention is NOT an answered row, even when the refusal carries text
// ("I cannot reliably answer this query because the retrieved documents
// exceed the reranker's input limit" is a string like any other). Judging a
// refusal burns the judge on noise and files a dead pipeline as a 0-score
// benchmark — 2026-10-27, all 50 rows of a live run.
const isAnswered = (r) => Boolean(r && !r.error && !r.abstained && r.answer);
// The answer leg's INITIAL token budget. It was hardcoded to 800, and a
// reasoning-capable judge burns 400-700 tokens BEFORE writing a word — so
// every answer hit the length cap, was thrown away, and was re-called at
// 3200 by the adaptive ladder. Two GLM calls per question, the first one
// entirely wasted, which halved the answer leg's rate and doubled its
// cost (live 2026-10-22: the answer leg fell from 10 questions/min to
// 2 as the harder questions arrived). max_tokens is a CAP, not a
// reservation — a model that needs less never pays for it, and the ladder
// still climbs for the ones that do.
const answerMaxTokens = () => Math.max(256, parseInt(process.env.OKF_RAGAS_ANSWER_MAX_TOKENS || '5000', 10));

const DEFAULT_METRICS = ['faithfulness', 'context_precision', 'context_recall', 'answer_relevancy'];
const EXTENDED_METRICS = [
  'context_utilization',
  'context_entities_recall',
  'factual_correctness',
  'answer_correctness',
  'answer_similarity',
  'noise_sensitivity'
];
const ALL_METRICS = [...DEFAULT_METRICS, ...EXTENDED_METRICS];

// failure-attribution thresholds (config-overridable per suite/run)
const FAIL_BELOW_DEFAULTS = {
  faithfulness: 0.6,
  context_precision: 0.5,
  context_recall: 0.5,
  answer_relevancy: 0.6,
  answer_correctness: 0.6,
  factual_correctness: 0.6,
  answer_similarity: 0.7,
  context_entities_recall: 0.5,
  context_utilization: 0.5,
  noise_sensitivity: 0.4 // fail ABOVE (lower is better)
};

// The answer leg's system prompt: the chatqna serving contract when the
// deployment pins one (CHATQNA_SYSTEM_PROMPT is forwarded to okf-server in
// compose for exactly this), else the VERBATIM genieai_chatqna built-in
// default. The benchmark must answer the way the deployed chat answers —
// a condensed paraphrase produced terse extractive answers ("101,746")
// that RAGAS answer_relevancy structurally punishes (reverse question
// generation from a bare number is generic), scoring factually-perfect
// rows red while the real chat answered the same question well
// (live-measured 2026-10-19: terse 0.415 vs chat-shaped 1.00 on the same
// question + contexts + judge). The sha is recorded on the run so
// answer-leg drift is visible.
function ANSWER_SYSTEM_PROMPT() {
  return (
    process.env.CHATQNA_SYSTEM_PROMPT ||
    'You are a friendly and polite information assistant.\n\n' +
      'Your task is to answer the user’s latest question using only the content provided from the knowledge base.\n\n' +
      '**Instructions:**\n' +
      '- Do not invent or assume information\n' +
      '- If the answer is not in the provided content, inform the user that the information is unavailable\n' +
      '- Use the user’s name, gender, age, preferences, and chat history to tailor and personalise your responses\n' +
      '- Keep answers informative but concise; provide detailed explanations\n' +
      '  only when necessary or explicitly requested\n\n' +
      'In line with the above instructions, generate a reply to the user’s latest\n' +
      'message in the chat history based on the relevant content provided.'
  );
}

// The abstention patterns are matched as SUBSTRINGS, so a bare
// 'knowledge base' flagged any legitimate answer that mentioned the
// knowledge base — a phrase the answer leg's OWN system prompt elicits
// ("using only the content provided from the knowledge base"). Such an
// answer was marked abstained, inflating n_abstained and misrouting its
// failures to the 'abstention contract' stage (2026-10-21 review F11).
// The abstention now needs the phrase in a NEGATED construction.
// ABSTENTION DETECTION — authoritative, not heuristic (David 2026-10-24,
// "fix it for ALL abstained queries": the benchmark reported 10 abstentions
// on rows the chat UI answered with full content and 99% confidence).
//
// The old matcher fired on 'not provide' / 'does not contain' / 'cannot find'
// ANYWHERE in the answer, so a complete answer that merely SAYS part of the
// question is not covered by the knowledge base ("The knowledge base does not
// provide additional specific characteristics…") was recorded as an
// abstention. That flag then (a) zeroed the row's answer metrics in the
// panel, (b) routed the attribution to the "abstention" stage, and (c) made
// the advisor recommend tightening the prompt. All three were wrong: the
// served path had answered.
//
// What counts as an abstention now:
//   - chatqna's own flag (the reranker-overflow branch sets abstained:true),
//   - an EMPTY answer (nothing was said),
//   - chatqna's own abstention sentinel, which PREFIXES the whole answer.
//
// A sentence about missing information inside an otherwise complete answer is
// a PARTIAL ANSWER, not an abstention.
const ABSTENT_SENTINEL = '[no relevant documents found]';

/** True when the SERVED chatqna response is an abstention.
 *
 * The authority is chatqna's OWN metadata — the same signals the citizen UI
 * uses (David 2026-10-24: "the chatqna will tell you when an answer is AI
 * generated and also the confidence level of the response"):
 *   - `abstained: true`   → chatqna declined (reranker-overflow branch)
 *   - `is_grounded:false` + no source documents → nothing was retrieved, so
 *     there was nothing to answer from
 *   - an EMPTY answer     → nothing was said
 *   - chatqna's own "[No Relevant Documents Found]" sentinel prefix
 *
 * What is NOT an abstention: a sentence inside a complete answer saying the
 * knowledge base does not cover one part of the question. The citizen path
 * shows such an answer in full (with its confidence badge) and so must the
 * benchmark — mislabelling it made 10 rows "abstentions" that the chat UI
 * answered with 99% confidence. */
function servedIsAbstention(meta, answer) {
  const flag = meta && meta.abstained;
  if (flag === true || flag === 'true') return true;
  const text = String(answer || '').trim();
  if (!text) return true;
  if (text.toLowerCase().startsWith(ABSTENT_SENTINEL)) return true;
  const docs = meta && meta.source_documents;
  if (Array.isArray(docs) && docs.length === 0 && meta && meta.is_grounded === false) return true;
  return false;
}

/** True when the whatif leg's guided-JSON answer is an abstention. */
function matchAbstention(answer, selfReported) {
  if (selfReported === true) return true;
  const text = String(answer || '').trim();
  if (!text) return true;
  return text.toLowerCase().startsWith(ABSTENT_SENTINEL);
}

let _collectionEnsured = false;

async function ensureCollection(db) {
  if (_collectionEnsured) return;
  const existing = new Set((await db.listCollections()).map((c) => c.name));
  if (!existing.has(COLLECTION)) {
    try {
      await db.createCollection(COLLECTION);
      logger.info('ragas-suite.collection_created', { name: COLLECTION });
    } catch (e) {
      // head-suite-service creates the same shared collection — a cold boot
      // can race it through the same await window. Losing that race is fine.
      if (!/conflict|duplicate|exists/i.test(String(e && e.message))) throw e;
    }
  }
  const col = db.collection(COLLECTION);
  const idx = (await col.indexes()).map((i) => i.fields.join(','));
  if (!idx.includes('repo_id')) await col.ensureIndex({ type: 'persistent', fields: ['repo_id'] });
  if (!idx.includes('created_at')) await col.ensureIndex({ type: 'persistent', fields: ['created_at'] });
  // Compound indexes for the ragas query shapes: listing filters repo_id +
  // kind (listRuns and the per-kind latest-run/latest-explain lookups); the
  // boot sweep and orphan reap filter kind + status with NO repo_id, which
  // would otherwise full-scan the shared okf_head_test_runs collection.
  if (!idx.includes('repo_id,kind')) await col.ensureIndex({ type: 'persistent', fields: ['repo_id', 'kind'] });
  if (!idx.includes('kind,status')) await col.ensureIndex({ type: 'persistent', fields: ['kind', 'status'] });
  _collectionEnsured = true;
}

// ---------- sidecar client -------------------------------------------------

function ragasSecret() {
  return process.env.RAGAS_INTERNAL_SECRET || process.env.OKF_INTERNAL_SECRET || '';
}

/**
 * Call the ragas-service sidecar. Network-class failures map to a typed
 * RAGAS_UNAVAILABLE (503) — the panel says so honestly; nothing hangs.
 */
async function sidecar(path, { method = 'POST', json, body, contentType, timeoutMs } = {}) {
  // Egress guard (review 2026-10-29): `path` is a hard-coded constant at
  // every call site — reject anything that could turn the fixed-base
  // concatenation into an arbitrary URL, so a future caller cannot.
  if (typeof path !== 'string' || path.includes('://')) {
    throw new Error(`ragas sidecar: rejected non-relative path: ${String(path).slice(0, 80)}`);
  }
  const headers = { 'X-RAGAS-Secret': ragasSecret() };
  let payload;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(json);
  } else if (body !== undefined) {
    headers['Content-Type'] = contentType || 'application/octet-stream';
    payload = body;
  }
  const budget = timeoutMs || RAGAS_TIMEOUT_MS;
  let resp;
  try {
    resp = await fetch(`${RAGAS_URL()}${path}`, {
      method,
      headers,
      body: payload,
      signal: AbortSignal.timeout(budget)
    });
  } catch (e) {
    // A timeout is NOT unreachability — the sidecar may still be working.
    // undici wraps the abort as TypeError("fetch failed") with the
    // TimeoutError on .cause; name it honestly so the operator reads
    // "timed out", not "service down".
    const cause = e.cause || e;
    const timedOut =
      e.name === 'TimeoutError' ||
      e.name === 'AbortError' ||
      cause.name === 'TimeoutError' ||
      cause.name === 'AbortError';
    const detail = timedOut
      ? `ragas-service timed out after ${Math.round(budget / 1000)}s (the job may still be running there)`
      : `ragas-service unreachable (${e.message})`;
    const err = new Error(detail);
    err.code = 'RAGAS_UNAVAILABLE';
    err.status = 503;
    throw err;
  }
  if (!resp.ok) {
    let detail = `HTTP ${resp.status}`;
    try {
      const j = await resp.json();
      detail = (j && (j.detail || (j.error && j.message))) || detail;
    } catch {
      /* non-JSON error body — keep the status line */
    }
    const err = new Error(`ragas-service: ${detail}`);
    err.code = resp.status === 503 ? 'RAGAS_UNAVAILABLE' : 'RAGAS_REQUEST_FAILED';
    err.status = resp.status >= 500 ? 502 : resp.status;
    throw err;
  }
  return resp;
}

/**
 * POST with a bounded transient-retry (2026-10-21 review F5): the job-submit
 * POSTs (generate-testset, evaluate) are the EXPENSIVE boundaries — by the
 * time /evaluate is called the whole answer phase has already run, and one
 * momentary RAGAS_UNAVAILABLE (sidecar busy at MAX_CONCURRENT_JOBS, keep-
 * alive reset, restart blip) discarded hours of computed answers. The poll
 * loop already tolerates transient errors to the liveness horizon; the POSTs
 * now retry 3x with backoff on RAGAS_UNAVAILABLE only — a 4xx is a real
 * request defect and propagates immediately.
 */
async function sidecarSubmitWithRetry(path, json, ctx = {}) {
  // Delays are env-tunable so tests run the full retry ladder in milliseconds
  // (OKF_RAGAS_SUBMIT_RETRY_DELAYS_MS — read per call, never cached).
  const raw = process.env.OKF_RAGAS_SUBMIT_RETRY_DELAYS_MS;
  const DELAYS_MS = raw
    ? raw
        .split(',')
        .map((v) => Math.max(0, parseInt(v, 10) || 0))
        .filter((v) => v >= 0)
    : [2000, 5000, 10000];
  let lastErr;
  for (let attempt = 0; attempt <= DELAYS_MS.length; attempt += 1) {
    try {
      return await sidecar(path, { json });
    } catch (e) {
      lastErr = e;
      if (e.code !== 'RAGAS_UNAVAILABLE' || attempt === DELAYS_MS.length) throw e;
      logger.warn('ragas-suite.sidecar_submit_retry', {
        path,
        attempt: attempt + 1,
        delay_ms: DELAYS_MS[attempt],
        reason: e.message,
        ...ctx
      });
      await new Promise((r) => setTimeout(r, DELAYS_MS[attempt]));
    }
  }
  throw lastErr;
}

/**
 * Poll a sidecar background job to completion (202 + poll — the same
 * contract this service itself exposes). Each individual HTTP call uses the
 * short default budget, so no connection is ever held open while the judge
 * grinds. A vanished job (404 — sidecar restarted) fails fast.
 *
 * RAGAS_LONG_TIMEOUT_MS is a LIVENESS HORIZON, not a kill switch (David,
 * 2026-10-18: "I do not want to trash work automatically"). A job that is
 * demonstrably alive — the poll just returned a non-terminal status — never
 * times out: the horizon rolls forward and we keep watching; only the
 * user's cancel ends a healthy long run. The horizon bounds only the
 * UNREACHABLE case: transient poll errors retry until it expires, then the
 * job record fails honestly (the sidecar is down, the result is
 * uncollectable either way).
 */
async function pollSidecarJob(jobId, { onProgress } = {}) {
  let horizon = Date.now() + RAGAS_LONG_TIMEOUT_MS;
  for (;;) {
    await sleepMs(RAGAS_JOB_POLL_MS);
    let job;
    try {
      const resp = await sidecar(`/jobs/${jobId}`, { method: 'GET' });
      job = await resp.json();
    } catch (e) {
      if (e.status === 404) {
        // A 404 after OUR OWN cancel is not a vanished job (2026-10-21 sidecar
        // review F3): the sidecar used to pop a cancelled job from its
        // registry, so the poller's next GET 404'd and the whole cancel
        // surfaced as "job vanished (sidecar restarted?)" — a failure for a
        // cancel that had actually worked. The sidecar now keeps cancelled
        // jobs until the TTL reap, but the caller may still have raced a
        // restart: report the truth either way.
        const err = new Error(
          `ragas-service job ${jobId} is unknown to the sidecar (it finished and was evicted, was never registered, or the sidecar restarted)`
        );
        err.code = 'RAGAS_UNAVAILABLE';
        err.status = 503;
        throw err;
      }
      if (Date.now() > horizon) throw e; // sidecar unreachable + out of horizon
      continue; // transient poll failure — the job may still be fine
    }
    // live progress (phase + done/total) — surfaced to the UI on every poll
    if (onProgress && job && job.progress) {
      try {
        onProgress(job.progress);
      } catch (e) {
        logger.warn('ragas-suite.progress_callback_failed', { job_id: jobId, error: e.message });
      }
    }
    if (job.status === 'done') return job.result;
    if (job.status === 'failed') {
      const err = new Error(`ragas-service: ${job.kind || 'job'} failed: ${job.error || 'unknown error'}`);
      err.code = 'RAGAS_REQUEST_FAILED';
      err.status = 502;
      throw err;
    }
    if (job.status === 'cancelled') {
      const err = new Error(`ragas-service: job ${jobId} was cancelled (suite deleted or caller gave up)`);
      err.code = 'RAGAS_JOB_CANCELLED';
      err.status = 502;
      throw err;
    }
    if (Date.now() > horizon) {
      // Alive but long-running: the successful poll above IS the liveness
      // proof, so extend the horizon and keep watching. Cancel is the
      // user's call (DELETE on the suite / job), not a timer's.
      logger.info('ragas-suite.long_job_alive', {
        job_id: jobId,
        status: job.status || 'running',
        horizon_s: Math.round(RAGAS_LONG_TIMEOUT_MS / 1000)
      });
      horizon = Date.now() + RAGAS_LONG_TIMEOUT_MS;
    }
  }
}

// Active sidecar jobs this process started, so abandonment can CANCEL them:
// a caller that gives up (suite deleted, worker failed) must stop paying the
// GPU — orphans kept the box at 100% for ~25 min before this existed
// (2026-10-17). job_id -> { kind, repo_id, suite_key, run_key? }
const activeSidecarJobs = new Map();

async function cancelSidecarJob(jobId, why) {
  if (!jobId) return;
  activeSidecarJobs.delete(jobId);
  try {
    await sidecar(`/jobs/${jobId}`, { method: 'DELETE' });
    logger.info('ragas-suite.sidecar_job_cancelled', { job_id: jobId, why });
  } catch (e) {
    // A 404 here means the job was ALREADY gone (cancelled earlier, evicted
    // by the retention window, or the sidecar restarted) — the cancel goal is
    // met, so it is a log line, not a warning that implies a live GPU burn
    // (2026-10-21 sidecar review F3).
    if (e.status === 404) {
      logger.info('ragas-suite.sidecar_job_cancel_noop', { job_id: jobId, why, error: e.message });
      return;
    }
    logger.warn('ragas-suite.sidecar_job_cancel_failed', { job_id: jobId, why, error: e.message });
  }
}

/**
 * Is this sidecar job still running?
 *
 * The liveness of a run was decided by an IN-MEMORY map, so a second
 * okf-server replica (or a restart) declared a live run dead — and
 * REWROTE its doc as failed while its judge leg kept paying the GPU. The
 * sidecar is the authority on whether the work is still happening: ask it.
 */
async function sidecarJobIsLive(jobId) {
  if (!jobId) return false;
  try {
    // A liveness PROBE must be quick: it runs inside the panel's poll and
    // inside the boot sweep, and neither may block on an unreachable
    // sidecar.
    const resp = await sidecar(`/jobs/${jobId}`, { method: 'GET', timeoutMs: 2000 });
    const job = await resp.json();
    return Boolean(job && (job.status === 'running' || job.status === 'pending'));
  } catch {
    // Unreachable sidecar, unknown job, evicted job — none of them prove
    // the work stopped, but none of them prove it is alive either. The
    // caller decides what to do with "unknown".
    return false;
  }
}

/** Cancel every active sidecar job belonging to a suite (best-effort). */
async function cancelSuiteJobs(suiteKey, why) {
  const jobIds = [...activeSidecarJobs.entries()]
    .filter(([, meta]) => meta && meta.suite_key === suiteKey)
    .map(([jid]) => jid);
  await Promise.all(jobIds.map((jid) => cancelSidecarJob(jid, why)));
}

/** Cancel the sidecar jobs of ONE run (best-effort) — a re-score cancel must
 * not take down a concurrent generation of the same suite. */
async function cancelRunJobs(runKey, why) {
  const jobIds = [...activeSidecarJobs.entries()]
    .filter(([, meta]) => meta && meta.run_key === runKey)
    .map(([jid]) => jid);
  await Promise.all(jobIds.map((jid) => cancelSidecarJob(jid, why)));
}

/**
 * Poll a sidecar job; on failure, cancel it (we are its only consumer — if
 * we are throwing, nobody is left to collect the result).
 */
async function pollSidecarJobOwned(jobId, meta, { onProgress } = {}) {
  activeSidecarJobs.set(jobId, meta);
  try {
    const result = await pollSidecarJob(jobId, { onProgress });
    activeSidecarJobs.delete(jobId);
    return result;
  } catch (e) {
    await cancelSidecarJob(jobId, `poller failed: ${e.code || e.message}`);
    throw e;
  }
}

// ---------- retrieval leg (Lab-internal replay) ---------------------------

// Four attempts with binary exponential backoff (0.5s..8s + jitter) —
// enough to outlive a gateway burst limiter without stalling a run.
const RERANK_RETRY_ATTEMPTS = 4;
const RERANK_RETRY_STATUSES = new Set([429, 502, 503, 504]);
// Ceiling for a server-provided Retry-After (review 2026-10-23): the
// server's number wins over our ladder, but never past 60s — an uncapped
// 'Retry-After: 3600' would sleep an hour per attempt.
const RETRY_AFTER_CAP_MS = 60000;
// 30s, matching teiEmbed's budget: a full batch is 32 texts of up to 2,000
// chars through a cross-encoder on a GPU that also serves chat. The old 15s
// aborted healthy-but-busy batches (live 2026-10-23, 2 of 100 rows) — and an
// abort used to be non-retryable on top.
const RERANK_TIMEOUT_MS = 30000;
// TEI rerankers cap batches (live 2026-10-18: "batch size 48 > maximum
// allowed batch size 32" — 24 candidates x 2 graphs 422'd EVERY probe and
// run row, surfacing as "unknown" answers). Client-side batching like
// teiEmbed's TEI_EMBED_CHUNK: every caller is bounded regardless of fanout.
const RERANK_BATCH = 32;
const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * How many rerank batch calls may be in flight at once (2026-10-23, David:
 * "the reranker is lightweight and there is no pressure on the GPU server;
 * benchmarks and curation will not be running while users are using the
 * system"). The batch calls are INDEPENDENT — the reranker scores
 * (query, text) pairs, and results reassemble by index — so overlapping them
 * changes transport only, never scores. 1 = the old polite sequential
 * behaviour; the default 3 turns a 6-batch pool from ~6 sequential round
 * trips into ~2 waves. Read per call so a deployment can turn it without
 * touching code, and clamped hard because a retry stampede helps nobody.
 */
function rerankConcurrency() {
  const n = parseInt(process.env.OKF_RAGAS_RERANK_CONCURRENCY || '3', 10);
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(n, 8));
}

/** Same TEI rerank contract as head-suite's rerankTexts (env-shared).
 * Batches at RERANK_BATCH and remaps chunk-local indices to global ones.
 * Batches run up to rerankConcurrency() at a time; per-batch retry keeps its
 * jittered backoff (retryDelayMs randomises, so parallel retries do not
 * synchronise into a stampede). */
async function rerankTexts(query, texts) {
  const rerankUrl = process.env.OKF_RERANK_ENDPOINT || '';
  if (!rerankUrl) {
    const err = new Error('rerank endpoint not configured (OKF_RERANK_ENDPOINT)');
    err.code = 'RERANK_NOT_CONFIGURED';
    throw err;
  }
  const headers = { 'Content-Type': 'application/json' };
  const token = process.env.OKF_RERANK_TOKEN || '';
  if (token) headers.Authorization = `Bearer ${token}`;
  const batches = [];
  for (let offset = 0; offset < texts.length; offset += RERANK_BATCH) {
    batches.push({ offset, batch: texts.slice(offset, offset + RERANK_BATCH) });
  }
  const concurrency = rerankConcurrency();
  const started = Date.now();
  logger.info('ragas-suite.rerank.start', {
    texts: texts.length,
    batches: batches.length,
    concurrency
  });

  async function rerankBatch(batch) {
    let decoded;
    let attempts = 0;
    for (let attempt = 1; attempt <= RERANK_RETRY_ATTEMPTS; attempt += 1) {
      attempts = attempt;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), RERANK_TIMEOUT_MS);
      try {
        const resp = await fetch(rerankUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ query, texts: batch }),
          signal: controller.signal
        });
        if (!resp.ok) {
          const err = new Error(`HTTP ${resp.status}`);
          err.status = resp.status;
          err.retryable = RERANK_RETRY_STATUSES.has(resp.status);
          const ra = Number(resp.headers && resp.headers.get && resp.headers.get('retry-after'));
          if (Number.isFinite(ra) && ra > 0) err.retryAfterMs = ra * 1000;
          throw err;
        }
        decoded = await resp.json();
        if (!Array.isArray(decoded)) throw new Error('unexpected rerank response shape');
        break;
      } catch (e) {
        // Our own RERANK_TIMEOUT_MS abort (Node fetch rejects with a
        // DOMException, name AbortError / code 20) is transient by
        // definition — the endpoint was busy, not wrong. Live 2026-10-23:
        // 2 of 100 rows died on exactly this at a 6x-bigger pool because an
        // abort carried no retryable marker and sailed straight through.
        if (e && (e.name === 'AbortError' || e.code === 20 || e.code === 'ABORT_ERR')) {
          e.retryable = true;
        }
        if (e.retryable === true && attempt < RERANK_RETRY_ATTEMPTS) {
          await sleepMs(retryDelayMs(e, attempt));
          continue;
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    }
    return { decoded, attempts };
  }

  // Worker pool over the batch list: each worker takes the next batch index
  // when it frees up, so a slow batch never idles the other workers. Results
  // land in decodedByBatch[i] — batch order is preserved regardless of
  // completion order.
  const decodedByBatch = new Array(batches.length);
  let retries = 0;
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next;
      if (i >= batches.length) return;
      next += 1;
      const { decoded, attempts } = await rerankBatch(batches[i].batch);
      retries += attempts - 1;
      decodedByBatch[i] = decoded;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) || 1 }, worker));

  // chunk-local indices -> global indices before merging
  const merged = [];
  batches.forEach(({ offset, batch }, i) => {
    for (const r of decodedByBatch[i] || []) {
      const idx = Number(r && r.index);
      if (Number.isInteger(idx) && idx >= 0 && idx < batch.length) {
        merged.push({ index: idx + offset, score: Number(r && r.score) || 0 });
      }
    }
  });
  logger.info('ragas-suite.rerank.done', {
    texts: texts.length,
    batches: batches.length,
    concurrency,
    retries,
    wall_ms: Date.now() - started
  });
  return merged;
}

// ---------- serve mode (the benchmark measures the SERVED system) ----------
//
// 2026-10-23, David: "the RAGAS responses MUST equal the UI responses or they
// are useless." The default answer leg is no longer a parallel replay: it is
// the SAME chatqna call a citizen's question takes, with one benchmark
// opt-in (include_contexts) that makes chatqna echo the served chunk text on
// each source document. The retrieval replay survives as the explicit
// "whatif" mode for knob experiments, and every run records which mode
// served it.
//
// Equality shape: same endpoint, same payload, chatqna's own sampling
// (temperature 0.01 — near-greedy), so the benchmark answer is what the UI
// would show for the same question, not a lookalike from another assembly.

const SERVE_URL = () => process.env.OKF_RAGAS_SERVE_URL || 'http://chatqna-xeon-backend-server:8888/v1/chatqna';

// Decode one Python-repr token chunk (data: b'...') — the same rules the
// backend's parseChatQnASSELine applies: hex escapes, \n/\t/\r, quote
// unescaping, control-char strip. Order matters: \\ before \x.
function decodePyRepr(content, quote) {
  const BS = '\x00BS\x00';
  const out = content
    .replace(/\\\\/g, BS)
    .replace(/(?:\\x([0-9a-fA-F]{2}))+/g, (m) => {
      const hex = m.replace(/\\x/g, '');
      return Buffer.from(hex, 'hex').toString('utf8');
    })
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(quote === "'" ? /\\'/g : /\\"/g, quote === '"' ? '"' : "'");
  // Restore the backslash sentinel BEFORE the control-char strip — the
  // sentinel's \x00 markers sit INSIDE the strip range, so stripping first
  // eats them and leaves literal 'BS' in the answer (the exact order the
  // backend's parseChatQnASSELine applies; drifted in review 2026-10-23).
  // eslint-disable-next-line no-control-regex -- mirror the backend's strip
  return out.replace(new RegExp(BS, 'g'), '\\').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

// Bounded like every sibling leg (rerank 30s abort, teiEmbed 30s, vllm 60s+):
// undici's bodyTimeout only fires on SILENCE between chunks, so without an
// overall budget a keepalive-trickling stream would wedge the worker — and
// runInFlight (cleared only when the run promise settles) — until the
// process restarts. A served answer can stream for a while on a shared GPU,
// hence the generous 5-minute ceiling.
const SERVE_TIMEOUT_MS = 300000;

async function serveAnswer(query, graphs) {
  // chatqna 401s unauthenticated calls before body parse — attach the
  // okf-server service-account bearer (same token the doc-repo calls use).
  // Unconfigured deployments still get the 401, loudly (service-token warns).
  const token = await getServiceToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVE_TIMEOUT_MS);
  const markOwnAbortRetryable = (e) => {
    // Our own budget abort is transient by definition (the endpoint was
    // busy, not wrong) — same classification the rerank leg applies.
    if (e && (e.name === 'AbortError' || e.code === 20 || e.code === 'ABORT_ERR')) {
      e.retryable = true;
    }
    throw e;
  };
  // The FAN-OUT CARRIER (live 2026-10-23, rr1792774608075-8d3d95): without
  // it chatqna falls back to the LEGACY retrieval path — the first serve
  // run measured 96/100 abstentions with zero contexts because the legacy
  // graph holds nothing for OKF concepts. The UI's backend attaches
  // authorized_graph_names + exclude_legacy to every citizen call
  // (query-service _attachFanoutCarrier); the benchmark replicates that
  // carrier, scoped to the SUITE'S graphs — the corpus the suite tests.
  // Same keys, same retriever fan-out: the served pipeline, measured over
  // the corpus it is being benchmarked on.
  const context =
    graphs && graphs.length
      ? { mode: 'okf_only', authorized_graph_names: [...new Set(graphs)], exclude_legacy: true }
      : undefined;
  try {
    let resp;
    try {
      resp = await fetch(SERVE_URL(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          messages: query,
          stream: true,
          include_contexts: true,
          ...(context ? { context } : {})
        }),
        signal: controller.signal
      });
    } catch (e) {
      throw markOwnAbortRetryable(e);
    }
    if (!resp.ok) {
      const err = new Error(`chatqna HTTP ${resp.status}`);
      err.status = resp.status;
      err.retryable = resp.status === 429 || resp.status >= 500;
      throw err;
    }
    const decoder = new TextDecoder();
    let answer = '';
    let meta = null;
    let buffer = '';
    try {
      for await (const chunk of resp.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          if (data.startsWith('{')) {
            try {
              const obj = JSON.parse(data);
              if (obj && obj.type === 'metadata') meta = obj;
            } catch {
              // not the metadata event — ignore
            }
            continue;
          }
          const m = data.match(/^b(['"])([\s\S]*)\1$/);
          if (m) {
            const decoded = decodePyRepr(m[2], m[1]);
            // vLLM's terminal usage-only frame (choices:[] + usage) is
            // transport metadata the orchestrator forwards like a token —
            // the judge would score the raw JSON as answer content. Dropped
            // here too even though chatqna strips it at the source: the
            // benchmark must stay safe against an older chatqna image.
            if (decoded.trim().startsWith('{')) {
              try {
                const obj = JSON.parse(decoded);
                if (obj && typeof obj === 'object' && 'usage' in obj && !(obj.choices && obj.choices.length)) continue;
              } catch {
                // not JSON — ordinary answer content
              }
            }
            answer += decoded;
          }
        }
      }
    } catch (e) {
      throw markOwnAbortRetryable(e);
    }
    if (!meta) {
      // The stream ended without the metadata event — the contract broke
      // (proxy cut the stream, chatqna died post-tokens). Recording this as
      // a zero-context success would mislabel the row 'routing' and keep the
      // run "valid" with garbage scores; name the infra error instead.
      const err = new Error('chatqna SSE stream ended without the metadata event');
      err.retryable = true;
      throw err;
    }
    const docs = meta.source_documents || [];
    const contexts = docs.map((d) => String(d.text || '')).filter(Boolean);
    if (docs.length && !contexts.length) {
      // Documents came back but none carried text — the deployed chatqna
      // predates include_contexts (pydantic drops the unknown field and the
      // metadata event omits 'text'). Loud config error, not a silent
      // all-zero context-metric run blamed on publishing.
      throw new Error(
        'chatqna returned source documents without served chunk texts — include_contexts unsupported (chatqna image older than okf-server?)'
      );
    }
    // chatqna's metadata is the authority on abstention: the normal path
    // carries no 'abstained' key (the reranker-overflow branch sets it
    // true), and a real KB-empty refusal is prefixed with chatqna's own
    // sentinel. A text scan for phrases like "does not provide" is NOT an
    // abstention signal — it mislabels partial answers (David 2026-10-24).
    const abstained = servedIsAbstention(meta, answer.trim());
    return {
      answer: answer.trim(),
      abstained,
      abstention_reason: meta.abstention_reason || '',
      confidence: meta.confidence_score !== undefined ? meta.confidence_score : null,
      // chatqna's own grounding work (David 2026-10-24: "the chatqna will
      // tell you when an answer is AI generated and also the confidence
      // level of the response"; the UI renders the same badge from the same
      // metadata, and lists the related documents). The benchmark records
      // them so the panel and the advisor reason about the SAME evidence
      // the citizen saw — not about a text-pattern guess.
      self_confidence:
        meta.self_confidence !== undefined && meta.self_confidence !== null ? meta.self_confidence : null,
      retrieval_confidence: meta.retrieval_confidence_score !== undefined ? meta.retrieval_confidence_score : null,
      is_grounded: Boolean(meta.is_grounded),
      related_documents: docs.length,
      // The SERVED contexts — the exact chunks the model answered from.
      contexts,
      // chatqna speaks in document ids (file_id == concept_id for OKF chunks),
      // not graph chunk keys. The ladder's delivered tier is decided by text
      // containment for serve rows; these ids are recorded for forensics.
      context_keys: docs.map((d) => String(d.document_id || '')),
      source_documents: docs
    };
  } finally {
    clearTimeout(timer);
  }
}

function retryDelayMs(e, attempt) {
  // Binary exponential backoff (David, 2026-10-23): 0.5s, 1s, 2s, ... capped
  // at 8s, jittered so parallel batches do not synchronise into a stampede.
  // The server's own Retry-After wins when it sends one — a rate limiter
  // that says "come back in 3s" knows better than our ladder — but CAPPED:
  // a limiter that says "come back in an hour" must not park the benchmark
  // (or an interactive caller) for an hour per attempt.
  if (e.retryAfterMs) return Math.min(RETRY_AFTER_CAP_MS, e.retryAfterMs);
  return Math.min(8000, 500 * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 250);
}

/**
 * Multi-repo retrieval: embed once, top-K per selected repo's _SOURCE,
 * unified rerank over the union, top-N contexts. Mirrors the retriever's
 * per-graph fan-out; per-repo attribution is kept on every candidate.
 */
async function retrieveContexts(db, graphNames, query, emb) {
  const perGraph = [];
  for (const g of graphNames) {
    const rows = await (
      await db.query(
        `FOR c IN \`${g}_SOURCE\` ` +
          'LET s = APPROX_NEAR_COSINE(c.embedding, @emb) ' +
          'SORT s DESC LIMIT @k ' +
          'RETURN { key: c._key, text: c.text, score: s }',
        { emb, k: CANDIDATE_K }
      )
    ).all();
    for (const r of rows) perGraph.push({ ...r, graph: g });
  }
  if (!perGraph.length) {
    return { contexts: [], context_keys: [], candidate_keys: [], candidates: [] };
  }
  const ranked = await rerankTexts(
    query,
    perGraph.map((r) => String(r.text || '').slice(0, CONTEXT_CHARS))
  );
  const order = [...ranked]
    .map((r) => ({ i: Number(r && r.index), score: Number(r && r.score) || 0 }))
    .filter((r) => Number.isInteger(r.i) && r.i >= 0 && r.i < perGraph.length)
    .sort((a, b) => b.score - a.score);
  const selected = order.slice(0, TOP_N).map((o) => ({ ...perGraph[o.i], rerank_score: o.score }));
  return {
    contexts: selected.map((s) => String(s.text || '').slice(0, CONTEXT_CHARS)),
    context_keys: selected.map((s) => s.key),
    // The recorded candidate pool MUST be the pool the dense search
    // actually returned. It used to be a hardcoded top-24 slice of a pool
    // whose size is OKF_RAGAS_CANDIDATE_K — so the moment an operator
    // raised that knob (which is exactly what the advisor tells them to
    // do) the run searched K chunks but RECORDED 24, and the evidence
    // ladder answered "was the passage in the dense pool?" against the
    // wrong pool: a carrier at rank 28 of a 192-pool was reported as
    // never having been retrieved. The advice would then look as if it
    // had not worked.
    candidate_keys: perGraph.map((c) => c.key),
    candidates: perGraph.slice(0, 8).map((c) => String(c.text || '').slice(0, 200))
  };
}

/** The answer leg: the chatqna serving shape (relevant content + the user's
 * question + the chat system contract) with a JSON envelope for the
 * {answer, abstained} flags. The user message deliberately mirrors how
 * genieai_chatqna presents context to the model — benchmark fidelity to the
 * deployed chat IS the point (see ANSWER_SYSTEM_PROMPT above). */
async function generateAnswer(query, contexts) {
  const contextBlock = contexts.map((c, i) => `[${i + 1}] ${c}`).join('\n\n');
  const user =
    `Relevant content from the knowledge base:\n${contextBlock || '(no content retrieved)'}\n\n` +
    `The user’s latest question: ${query}\n\n` +
    'Generate your reply to the user per your instructions, then return it as JSON:\n' +
    '{"answer": "<your reply to the user>", "abstained": <true|false>}\n' +
    'Set abstained=true only when the relevant content does not contain the answer.';
  const resp = await frontmatterService.vllmChatCompletions(
    [
      { role: 'system', content: ANSWER_SYSTEM_PROMPT() },
      { role: 'user', content: user }
    ],
    // 'ragas_answers' (David 2026-10-20): the answer leg measures the
    // DEPLOYED answerer by default — it follows an ACTIVE model config only
    // when that config is explicitly checked for benchmark answers. When it
    // is, the benchmark measures the configured model instead (and the run's
    // fidelity block says so). Openai-wire only, like every okf-server leg.
    { maxTokens: answerMaxTokens(), temperature: 0.0, service: 'ragas_answers' }
  );
  const content =
    resp && resp.data && resp.data.choices && resp.data.choices[0] && resp.data.choices[0].message
      ? resp.data.choices[0].message.content
      : null;
  let parsed = null;
  try {
    parsed = typeof content === 'string' ? JSON.parse(content.match(/\{[\s\S]*\}/)[0]) : null;
  } catch {
    /* unparseable answer contract — fall through with parsed null */
  }
  const answer = parsed && typeof parsed.answer === 'string' ? parsed.answer : String(content || '');
  // The guided-JSON contract carries the model's own abstained flag; the
  // text fallback only covers an empty answer or chatqna's sentinel.
  const abstained = matchAbstention(answer, parsed && parsed.abstained === true);
  return { answer, abstained };
}

/** What the run's fidelity block records about the ANSWER leg.
 *
 * SERVE mode answers through the citizen pipeline (chatqna), which serves
 * the DEPLOYMENT chat model. The `ragas_answers` config is consulted ONLY
 * by the WHATIF answer leg (`generateAnswer`); the served call carries no
 * model at all. Recording the config in serve mode therefore claimed a
 * model that never answered — live 2026-10-25, a serve run recorded
 * "glm-5.3-flash" while the answers came from the deployment chat model.
 * The record must say what answered.
 *
 * The deployment model is read from the env: the containers carry
 * VLLM_MODEL_ID, and VLLM_LLM_MODEL_ID is the deployment's other spelling
 * of the same knob (8-7 found the two names out of step). */
async function answerFidelity(opts = {}) {
  const deploymentChat = async () => ({
    source: 'deployment-chat',
    config: null,
    // The deployment chat model under the !631 policy: pin > /v1/models
    // discovery (services/vllm-model-cache.js) — null only when nothing
    // answers (#1181).
    model: (await require('./vllm-model-cache').discoverVllmModelId(process.env.VLLM_ENDPOINT)) || null
  });
  if (opts.serveMode) return deploymentChat();
  try {
    const ovr = await modelConfigService.resolveModelOverride({ service: 'ragas_answers' });
    if (ovr && ovr.provider === 'openai') {
      return { source: 'config', config: ovr.config_name, model: ovr.model };
    }
  } catch {
    /* resolution failure — the deployment answerer applies */
  }
  return deploymentChat();
}

// ---------- suite generation ----------------------------------------------

function loadDoc(db, key, code, what) {
  return db
    .collection(COLLECTION)
    .document(key)
    .catch((e) => {
      if (isArangoNotFound(e)) {
        // `what` already names the key (every call site passes it), so the
        // key is NOT appended again — the old message read "run rrX for suite
        // rsY rrX not found" (David saw it in the console, 2026-10-25).
        const err = new Error(`${what} not found`);
        err.code = code;
        err.status = 404;
        throw err;
      }
      throw e;
    });
}

/** Published corpus CHUNKS of the selected repos → sidecar documents.
 *
 * The generation corpus is the `<graph>_SOURCE` chunk texts — the same unit
 * the run leg retrieves (live 2026-10-19: feeding concept bodies made the
 * synthesizer's reference_contexts whole documents, which were then truncated
 * to 500 chars at storage — often the WRONG section of the concept for the
 * question it grounded — and could never be matched by top-N chunk retrieval
 * anyway. Every entity-recall row of a 20-question suite failed at 0.10–0.50
 * while context_recall sat at 1.0 and the answers were correct: the metrics
 * were comparing unlike units. Questions are now synthesized from retrievable
 * chunks and the stored references are those chunks — reference-based metrics
 * and the advisor's passage-containment evidence compare chunk-to-chunk.
 * Repos without a drained graph contribute nothing: their content is not
 * retrievable, so benchmarking it measured fantasy.
 *
 * 2026-10-21 (David: "we have much larger corpuses to process than this"):
 * over the OKF_RAGAS_MAX_CORPUS_CHUNKS budget the selection is an EVEN SPREAD across
 * the chunk-key space, not the first-N prefix — first-N benchmarks the
 * oldest-ingested slice and calls it a suite (live: a capped run's node
 * filter silently totalled exactly 1600 with no trace on the suite). The
 * stride sample carries the whole corpus's character at the same cost, is
 * deterministic and reproducible, and the truncation is RETURNED as
 * coverage accounting ({total, used} per graph) for the suite doc to
 * record — a capped corpus is a decision the suite must show, never a
 * silent one. */
async function buildCorpusDocuments(db, repoIds) {
  const docs = [];
  const coverage = [];
  for (const rid of repoIds) {
    for (const g of await graphNamesFor(db, [rid])) {
      const countRows = await (
        await db.query(`FOR c IN \`${g}_SOURCE\` FILTER c.text != null COLLECT WITH COUNT INTO n RETURN n`)
      ).all();
      const total = Number(countRows[0] || 0);
      if (!total) continue;
      let rows;
      if (total <= maxCorpusChunks()) {
        rows = await (
          await db.query(
            `FOR c IN \`${g}_SOURCE\` FILTER c.text != null SORT c._key LIMIT @lim ` +
              'RETURN { key: c._key, text: c.text }',
            { lim: maxCorpusChunks() }
          )
        ).all();
      } else {
        const keys = (
          await (await db.query(`FOR c IN \`${g}_SOURCE\` FILTER c.text != null SORT c._key RETURN c._key`)).all()
        ).map(String);
        const stride = total / maxCorpusChunks();
        const picked = [...new Set(Array.from({ length: maxCorpusChunks() }, (_, i) => keys[Math.floor(i * stride)]))];
        rows = await (
          await db.query(
            `FOR c IN \`${g}_SOURCE\` FILTER c._key IN @keys SORT c._key RETURN { key: c._key, text: c.text }`,
            { keys: picked }
          )
        ).all();
      }
      let used = 0;
      for (const r of rows) {
        const text = String(r.text || '').slice(0, CONCEPT_BODY_CAP);
        if (!text.trim()) continue;
        docs.push({ page_content: text, metadata: { repo_id: rid, graph: g, chunk_key: r.key } });
        used += 1;
      }
      coverage.push({ repo_id: rid, graph: g, total, used });
      if (used < total) {
        logger.info('ragas-suite.corpus_capped', { repo_id: rid, graph: g, used, total });
      }
    }
  }
  return { docs, coverage };
}

async function graphNamesFor(db, repoIds) {
  const names = [];
  for (const rid of repoIds) {
    const rows = await (
      await db.query(
        'FOR m IN okf_concepts_meta FILTER m.repo_id == @rid AND m.graph_name != null ' +
          'COLLECT g = m.graph_name RETURN g',
        { rid }
      )
    ).all();
    if (rows.length) names.push(rows[0]);
  }
  return names;
}

const genInFlight = new Map(); // repo_id -> suite_key
const genFailure = new Map(); // repo_id -> {suite_key, code, message, at}
const genProgress = new Map(); // suite_key -> live sidecar progress {phase, done, total}

async function beginSuiteGeneration(repoId, payload = {}, opts = {}) {
  const inflight = genInFlight.get(repoId);
  if (inflight) {
    const err = new Error('a benchmark-suite generation is already running for this repository');
    err.code = 'GENERATION_IN_FLIGHT';
    err.status = 409;
    err.details = { suite_key: inflight };
    throw err;
  }
  const repoIds = normalizeRepoIds(repoId, payload.repo_ids);
  for (const rid of repoIds) {
    await repositoryService.getById(rid, { authz: opts.authz }); // 404 now, not mid-poll
  }
  const testsetSize = clampCount(
    payload.testset_size !== undefined ? payload.testset_size : TESTSET_SIZE_DEFAULT,
    1,
    MAX_ENTRIES
  );
  const suiteKey = `rs${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
  // Reserve the lock SYNCHRONOUSLY after the awaits (2026-10-21 review F12):
  // the check-then-set straddled the awaited repo lookups, so a double-click
  // (or two clients) passed the check twice and started TWO GPU generations
  // — the second overwrote the first's key and the first finisher's
  // .finally deleted the lock while the second still ran.
  if (genInFlight.has(repoId)) {
    const err = new Error('a benchmark-suite generation is already running for this repository');
    err.code = 'GENERATION_IN_FLIGHT';
    err.status = 409;
    err.details = { suite_key: genInFlight.get(repoId) };
    throw err;
  }
  genInFlight.set(repoId, suiteKey);
  // Seed the phase immediately so the synthetic list row (and any adoption)
  // has something to show before the sidecar's first poll lands.
  genProgress.set(suiteKey, { phase: 'building-knowledge-graph' });
  genFailure.delete(repoId);
  const done = generateSuite(
    repoId,
    { ...payload, repo_ids: repoIds, testset_size: testsetSize },
    {
      ...opts,
      suiteKey,
      // 8-7: an explicit judge pick from the Generate dialog rides the opts
      judge_config_key: payload.judge_config_key || null,
      judge_model: payload.judge_model || null
    }
  )
    .then((suite) => suite)
    .finally(() => {
      // Key-scoped release: a finisher never deletes a DIFFERENT
      // generation's lock (2026-10-21 review F12).
      if (genInFlight.get(repoId) === suiteKey) genInFlight.delete(repoId);
      genProgress.delete(suiteKey);
    });
  done.catch((e) => {
    // A user cancel must surface AS a cancel: the sidecar drops the job on
    // DELETE, so the poller's next contact is a 404 that would otherwise
    // read as "vanished (sidecar restarted?)" — misleading in the UI.
    const userCancelled = userCancelledGen.delete(suiteKey);
    genFailure.set(repoId, {
      suite_key: suiteKey,
      code: userCancelled ? 'RAGAS_JOB_CANCELLED' : e.code || 'GENERATION_FAILED',
      message: userCancelled ? 'generation cancelled by user' : e.message,
      at: new Date().toISOString()
    });
    logger.error('ragas-suite.generate.async_failed', {
      repo_id: repoId,
      suite_key: suiteKey,
      cancelled: userCancelled,
      error: e.message
    });
  });
  return { suite_key: suiteKey, done };
}

const userCancelledGen = new Set(); // suite_keys the user asked to stop
const userCancelledRun = new Set(); // run_keys the user asked to stop

/**
 * User-initiated RUN cancel (David 2026-10-18: kill controls for suite
 * generation AND benchmarks). Cancels the evaluate sidecar job (the GPU
 * drains within one in-flight batch) and records the honest reason; the
 * detached worker observes the terminal status and persists
 * status:'cancelled' with RAGAS_JOB_CANCELLED.
 */
async function cancelSuiteRun(repoId, suiteKey, runKey) {
  const inflight = runInFlight.get(suiteKey);
  const isRun = Boolean(inflight) && inflight === runKey;
  // A RE-SCORE is a run too — it lives in its own map (the source run is
  // never touched), so the cancel must look for it there as well. Without
  // this a re-score was uncancellable: the endpoint answered 409 "no such
  // run is executing" while the judge leg kept paying the GPU (David
  // 2026-10-25: "I cannot stop the re-scoring!!!").
  const isRescore = rescoreInFlight.has(runKey);
  if (!isRun && !isRescore) {
    const err = new Error('no such run is executing for this suite');
    err.code = 'NO_RUN_IN_FLIGHT';
    err.status = 409;
    throw err;
  }
  userCancelledRun.add(runKey);
  if (isRescore) {
    // Cancel THIS re-score's sidecar job only — a concurrent generation or
    // run of the same suite must not be killed by a re-score cancel.
    await cancelRunJobs(runKey, `re-score cancelled by user (${runKey})`);
  } else {
    // Cancel THIS run's sidecar job only. Cancelling by SUITE also killed a
    // concurrent RE-SCORE of the same suite (its judge job is registered
    // against the same suite key) — so cancelling one run silently killed
    // the other, and the re-score landed as cancelled.
    await cancelRunJobs(runKey, `run cancelled by user (${runKey})`);
  }
  logger.info('ragas-suite.run_cancelled_by_user', { repo_id: repoId, suite_key: suiteKey, run_key: runKey });
  return { cancelled: true, run_key: runKey };
}

/**
 * User-initiated generation cancel (David 2026-10-18: the user must be able
 * to cancel/kill a generation whenever they like, from the UI). Cancels the
 * in-flight generation's sidecar job — the GPU stops within one in-flight
 * LLM batch (cooperative cancel_event) — and records the honest reason.
 */
async function cancelSuiteGeneration(repoId) {
  const suiteKey = genInFlight.get(repoId);
  if (!suiteKey) {
    const err = new Error('no benchmark-suite generation is running for this repository');
    err.code = 'NO_GENERATION_IN_FLIGHT';
    err.status = 409;
    throw err;
  }
  userCancelledGen.add(suiteKey);
  await cancelSuiteJobs(suiteKey, 'cancelled by user');
  logger.info('ragas-suite.generation_cancelled_by_user', { repo_id: repoId, suite_key: suiteKey });
  return { cancelled: true, suite_key: suiteKey };
}

function normalizeRepoIds(primary, listed) {
  const ids = [primary, ...(Array.isArray(listed) ? listed : [])].map((r) => String(r || '').trim()).filter(Boolean);
  return [...new Set(ids)];
}

function clampCount(v, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

async function generateSuite(repoId, payload = {}, opts = {}) {
  return withSpan('okf.ragas.generate', async (span) => {
    span.setAttribute('okf.repo_id', repoId);
    const db = await dbService.getConnection();
    await ensureCollection(db);
    const repoIds = payload.repo_ids || [repoId];
    const { docs, coverage } = await buildCorpusDocuments(db, repoIds);
    if (!docs.length) {
      const err = new Error(
        'no published corpus chunks for the selected repositories — publish and let ingestion drain first'
      );
      err.code = 'NO_CORPUS';
      err.status = 409;
      throw err;
    }
    // 8-7 model configs: the generation judge resolves picked > active >
    // env. An explicit pick that no longer resolves THROWS (the user chose
    // it); no pick silently uses the active config or the env default.
    const judgeOverride = await modelConfigService.resolveModelOverride({
      config_key: opts.judge_config_key,
      model: opts.judge_model,
      service: 'ragas_judge'
    });
    // An override without a model is unusable — the env judge applies and
    // the suite's fidelity records the EFFECTIVE judge.
    const effectiveJudge = judgeOverride && judgeOverride.model ? judgeOverride : null;
    // The EFFECTIVE judge goes into the live progress envelope (live
    // 2026-10-21): the panel's judge dropdown shows the SELECTION, and for
    // an in-flight generation that selection is reset to "deployment
    // default" (the suite doc does not exist yet) — so the operator saw
    // "default" (the active GLM config) while the run was actually on a
    // different, explicitly picked endpoint. The run now NAMES the model it
    // is using, from the first tick.
    const effectiveJudgeFidelity = modelConfigService.judgeFidelity(effectiveJudge);
    genProgress.set(opts.suiteKey, {
      ...(genProgress.get(opts.suiteKey) || {}),
      judge: effectiveJudgeFidelity,
      // The pick AS MADE, so the panel can show the RUNNING generation's
      // model in its picker instead of the one it remembers: the dropdown
      // and the "actually using" line must never disagree (David 2026-10-25).
      judge_pick: { config_key: opts.judge_config_key || null, model: opts.judge_model || null }
    });
    // 202 + poll: the sidecar starts a background job and we poll it — no
    // connection is held open for the (potentially hour-long) generation.
    const genResp = await sidecarSubmitWithRetry(
      '/generate-testset',
      {
        documents: docs,
        testset_size: clampCount(payload.testset_size, 1, MAX_ENTRIES),
        query_distribution: Array.isArray(payload.query_distribution) ? payload.query_distribution : null,
        num_personas: clampCount(payload.num_personas, 1, 10),
        judge: effectiveJudge
          ? {
              provider: effectiveJudge.provider,
              base_url: effectiveJudge.base_url,
              model: effectiveJudge.model,
              api_key: effectiveJudge.api_key
            }
          : null
      },
      { repo_id: repoId }
    );
    const genStarted = await genResp.json();
    // Cancel-race guard (same shape as the evaluate submit): a user cancel
    // landing between the sidecar POST and the poll registration finds no
    // registered job to cancel — the generation would run uncancelled for
    // the whole KG build. Kill the fresh job and honour the cancel.
    if (userCancelledGen.has(opts.suiteKey)) {
      await cancelSidecarJob(genStarted.job_id, 'generation cancelled by user (landed during submit)');
      const cancelled = new Error('generation cancelled by user');
      cancelled.code = 'RAGAS_JOB_CANCELLED';
      throw cancelled;
    }
    const gen = await pollSidecarJobOwned(
      genStarted.job_id,
      {
        kind: 'generate-testset',
        repo_id: repoId,
        suite_key: opts.suiteKey
      },
      {
        // live KG/synthesis counts land on the generating envelope (getSuite).
        // MERGED, not replaced: the envelope also carries the effective
        // judge, and a sidecar progress tick must not wipe it (the panel
        // shows the model the run is actually using).
        onProgress: (p) => genProgress.set(opts.suiteKey, { ...(genProgress.get(opts.suiteKey) || {}), ...p })
      }
    );
    genProgress.delete(opts.suiteKey);
    const samples = Array.isArray(gen.samples) ? gen.samples : [];
    if (!samples.length) {
      const err = new Error('the generator produced no samples (judge/embedder logs have the cause)');
      err.code = 'GENERATION_EMPTY';
      err.status = 502;
      throw err;
    }
    const now = new Date().toISOString();
    const entries = samples.slice(0, MAX_ENTRIES).map((s, i) => ({
      id: `new-${i + 1}`,
      query: String(s.user_input || '').trim(),
      reference_answer: String(s.reference || ''),
      // Reference passages stored WHOLE (capped at CONTEXT_CHARS, the run
      // leg's per-context cap — a published chunk fits intact). The old
      // 500-char slice cut them mid-table and often kept the WRONG section
      // of the concept for the question it grounded: entity-recall then
      // compared the wrong section's entities against correctly-retrieved
      // chunks (2026-10-19: every entity-recall row of a 20-question suite
      // failed at 0.10–0.50 with context_recall at 1.0).
      reference_passages: (Array.isArray(s.reference_contexts) ? s.reference_contexts : []).map((c) =>
        String(c).slice(0, CONTEXT_CHARS)
      ),
      source_doc: '',
      language: '',
      difficulty: [s.query_style, s.query_length].filter(Boolean).join('/') || '',
      persona: s.persona_name || '',
      synthesizer: s.synthesizer_name || '',
      oos: false,
      source: 'llm'
    }));
    const repos = await Promise.all(repoIds.map((rid) => repositoryService.getById(rid, { authz: opts.authz })));
    const suiteDoc = {
      _key: opts.suiteKey,
      repo_id: repoId,
      kind: 'ragas_suite',
      suite_key: opts.suiteKey,
      repo_ids: repoIds,
      name: payload.name || defaultSuiteName(repos[0], now),
      created_at: now,
      created_by: (opts.actor && opts.actor.user_id) || 'system',
      payload: {
        generator: `ragas:${gen.generator && gen.generator.model}`,
        // Judge memory (David 2026-10-21: the model selection must survive
        // leaving and re-entering the dialog, not reset to the deployment
        // default). judge_pick is the selection AS MADE in the Generate
        // dialog (nulls = deployment default was chosen) — the panel's
        // restore source; judge is the resolved judge that actually
        // generated the suite (the fidelity record).
        judge_pick: { config_key: opts.judge_config_key || null, model: opts.judge_model || null },
        judge: modelConfigService.judgeFidelity(effectiveJudge),
        repos: repos.map((r) => ({ id: r.repo_id || r._key, name: r.name })),
        dimensions: {
          testset_size: entries.length,
          requested_size: payload.testset_size,
          // The questions that were LOST and WHY (live 2026-10-21: 35 of
          // 100 were dropped to upstream 429s and the panel said nothing —
          // the user could not tell a short suite from a throttled one).
          dropped: Number.isFinite(gen.dropped) ? gen.dropped : 0,
          dropped_reasons: gen.dropped_reasons || {},
          query_distribution: payload.query_distribution || null,
          num_personas: payload.num_personas || 3
        },
        // Coverage accounting: what slice of each repo's published corpus
        // the suite is actually grounded in. Equal when under the budget;
        // used < total means the corpus was capped — show it, never hide it.
        corpus_coverage: coverage,
        // Knowledge-graph nodes whose judge call died after the retries
        // (2026-10-22: a server-dropped connection at node 1074/1075 ended
        // a 74-minute run). The run CONTINUES on a degraded node — the
        // count travels with the suite so the degradation is never silent.
        kg_failures: gen.kg_failures || {},
        metrics_config: [...DEFAULT_METRICS],
        entries
      }
    };
    await db.collection(COLLECTION).save(suiteDoc);
    span.setAttribute('okf.ragas.entries', entries.length);
    span.setAttribute('okf.ragas.repos', repoIds.length);
    logger.info('ragas-suite.generated', {
      repo_id: repoId,
      suite_key: opts.suiteKey,
      entries: entries.length,
      repos: repoIds
    });
    return suiteDoc;
  });
}

function defaultSuiteName(repo, now) {
  const base = (repo && repo.name ? repo.name : 'Repo').replace(/\s+/g, ' ').trim();
  return `${base} benchmark ${String(now || '').slice(0, 10)}`;
}

// ---------- suite reads / management --------------------------------------

async function getSuite(repoId, suiteKey) {
  const db = await dbService.getConnection();
  await ensureCollection(db);
  const inflight = genInFlight.get(repoId);
  if (inflight === suiteKey) {
    const envelope = { suite_key: suiteKey, status: 'generating' };
    const prog = genProgress.get(suiteKey);
    if (prog) envelope.progress = prog;
    return envelope;
  }
  const failed = genFailure.get(repoId);
  if (failed && failed.suite_key === suiteKey) {
    return { suite_key: suiteKey, status: 'failed', error: { code: failed.code, message: failed.message } };
  }
  const doc = await loadDoc(db, suiteKey, 'SUITE_NOT_FOUND', `suite ${suiteKey} for repo ${repoId}`);
  if (doc.repo_id !== repoId || doc.kind !== 'ragas_suite') {
    const err = new Error(`suite ${suiteKey} not found for repo ${repoId}`);
    err.code = 'SUITE_NOT_FOUND';
    err.status = 404;
    throw err;
  }
  return doc;
}

const ROW_CAPS = { entries: MAX_ENTRIES };

/** Parity with updateSuiteRows: modify fields, FLIP in-scope/out-of-scope, remove. */
async function updateSuiteRows(repoId, suiteKey, payload = {}, opts = {}) {
  return withSpan('okf.ragas.update_rows', async (span) => {
    span.setAttribute('okf.repo_id', repoId);
    const db = await dbService.getConnection();
    await ensureCollection(db);
    const suite = await loadSuite(db, repoId, suiteKey);
    const entries = suite.payload.entries;
    const modifications = Array.isArray(payload.modifications) ? payload.modifications : [];
    let modified = 0;
    for (const m of modifications) {
      const idx = entries.findIndex((e) => e.id === m.id);
      if (idx === -1) continue;
      const e = entries[idx];
      if (typeof m.query === 'string' && m.query.trim()) e.query = m.query.trim();
      if (typeof m.reference_answer === 'string') e.reference_answer = m.reference_answer;
      if (Array.isArray(m.reference_passages))
        e.reference_passages = m.reference_passages.map((p) => String(p).slice(0, CONTEXT_CHARS));
      if (typeof m.source_doc === 'string') e.source_doc = m.source_doc;
      if (typeof m.difficulty === 'string') e.difficulty = m.difficulty;
      if (m.flip_oos !== undefined) {
        const wasOos = e.oos === true;
        e.oos = m.flip_oos === true;
        // Flipping a row OUT of scope parks its reference passages in
        // `_oos_reference_passages` (not deleted) so flipping it BACK
        // restores them — the old code CLEARED them irreversibly, so a row
        // returned to scope measured against an empty reference and every
        // later run degraded silently (2026-10-21 review F8).
        if (e.oos) {
          if (!wasOos) e._oos_reference_passages = Array.isArray(e.reference_passages) ? e.reference_passages : [];
          e.reference_passages = [];
        } else if (wasOos && Array.isArray(e._oos_reference_passages)) {
          e.reference_passages = e._oos_reference_passages;
          delete e._oos_reference_passages;
        }
      }
      modified += 1;
    }
    const removed = new Set(Array.isArray(payload.remove_ids) ? payload.remove_ids : []);
    const before = entries.length;
    suite.payload.entries = entries.filter((e) => !removed.has(e.id));
    const nRemoved = before - suite.payload.entries.length;
    if (suite.payload.entries.length > ROW_CAPS.entries)
      suite.payload.entries = suite.payload.entries.slice(0, ROW_CAPS.entries);
    if (!modified && !nRemoved) {
      const err = new Error('no matching modifications or removals');
      err.code = 'VALIDATION_ERROR';
      err.status = 400;
      throw err;
    }
    if (!suite.payload.entries.length) {
      const err = new Error('a suite cannot become empty — delete it instead');
      err.code = 'VALIDATION_ERROR';
      err.status = 400;
      throw err;
    }
    suite.updated_at = new Date().toISOString();
    suite.updated_by = (opts.actor && opts.actor.user_id) || 'system';
    await db.collection(COLLECTION).replace(suite._key, suite);
    span.setAttribute('okf.ragas.modified', modified);
    span.setAttribute('okf.ragas.removed', nRemoved);
    return suite;
  });
}

/** Manual additions — {query, reference_answer?, reference_passages?, oos?}. */
async function addQueries(repoId, suiteKey, payload = {}, _opts = {}) {
  return withSpan('okf.ragas.add_queries', async (span) => {
    span.setAttribute('okf.repo_id', repoId);
    const db = await dbService.getConnection();
    await ensureCollection(db);
    const suite = await loadSuite(db, repoId, suiteKey);
    const queries = Array.isArray(payload.queries) ? payload.queries : [];
    const clean = queries
      .filter((q) => q && typeof q.query === 'string' && q.query.trim())
      .slice(0, 100)
      .map((q) => ({
        query: q.query.trim(),
        reference_answer: typeof q.reference_answer === 'string' ? q.reference_answer : '',
        reference_passages: Array.isArray(q.reference_passages)
          ? q.reference_passages.map((p) => String(p).slice(0, CONTEXT_CHARS))
          : [],
        source_doc: typeof q.source_doc === 'string' ? q.source_doc : '',
        language: '',
        difficulty: 'manual',
        persona: '',
        synthesizer: '',
        oos: q.oos === true,
        source: 'manual'
      }));
    if (!clean.length) {
      const err = new Error('queries[] with {query} is required');
      err.code = 'VALIDATION_ERROR';
      err.status = 400;
      throw err;
    }
    const norm = (s) =>
      String(s || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
    const existing = new Set(suite.payload.entries.map((e) => norm(e.query)));
    const fresh = [];
    let duplicatesDropped = 0;
    for (const q of clean) {
      const k = norm(q.query);
      if (existing.has(k)) {
        duplicatesDropped += 1;
        continue;
      }
      existing.add(k);
      fresh.push(q);
    }
    let nextId = suite.payload.entries.reduce((mx, e) => {
      const m = /^new-(\d+)$/.exec(e.id || '');
      return m ? Math.max(mx, parseInt(m[1], 10)) : mx;
    }, 0);
    for (const q of fresh) {
      nextId += 1;
      q.id = `new-${nextId}`;
      suite.payload.entries.push(q);
    }
    // The cap keeps the FIRST rows — appending then slicing silently dropped
    // exactly the NEW queries while the response still said "added: N"
    // (2026-10-21 review F7). The newest additions win the last slots; the
    // overflow is reported, never silently swallowed.
    const overflow = Math.max(0, suite.payload.entries.length - ROW_CAPS.entries);
    if (overflow > 0) {
      suite.payload.entries = suite.payload.entries.slice(suite.payload.entries.length - ROW_CAPS.entries);
    }
    suite.updated_at = new Date().toISOString();
    await db.collection(COLLECTION).replace(suite._key, suite);
    span.setAttribute('okf.ragas.added', fresh.length);
    return {
      suite,
      added: Math.max(0, fresh.length - overflow),
      duplicates_dropped: duplicatesDropped,
      dropped_over_cap: overflow
    };
  });
}

async function renameSuite(repoId, suiteKey, payload = {}, opts = {}) {
  const db = await dbService.getConnection();
  await ensureCollection(db);
  const suite = await loadSuite(db, repoId, suiteKey);
  const name = typeof payload.name === 'string' ? payload.name.trim().slice(0, 120) : '';
  if (!name) {
    const err = new Error('name is required');
    err.code = 'VALIDATION_ERROR';
    err.status = 400;
    throw err;
  }
  suite.name = name;
  suite.updated_at = new Date().toISOString();
  suite.updated_by = (opts.actor && opts.actor.user_id) || 'system';
  await db.collection(COLLECTION).replace(suite._key, suite);
  return suite;
}

async function deleteSuite(repoId, suiteKey) {
  // A suite still GENERATING has no doc yet — deleting it means cancelling
  // the sidecar job (the worker will fail and record genFailure; nothing
  // persists). The GPU stops the moment we cancel.
  if (genInFlight.get(repoId) === suiteKey) {
    await cancelSuiteJobs(suiteKey, 'suite deleted while generating');
    logger.info('ragas-suite.deleted_generating', { repo_id: repoId, suite_key: suiteKey });
    return { deleted: suiteKey, cancelled_generation: true };
  }
  const db = await dbService.getConnection();
  await ensureCollection(db);
  await loadSuite(db, repoId, suiteKey); // 404 now if the suite does not exist
  if (runInFlight.get(suiteKey)) {
    const err = new Error('a run is executing for this suite — wait for it to finish');
    err.code = 'RUN_IN_FLIGHT';
    err.status = 409;
    err.details = { run_key: runInFlight.get(suiteKey) };
    throw err;
  }
  await cancelSuiteJobs(suiteKey, 'suite deleted');
  const cursor = await db.query(
    `FOR d IN ${COLLECTION} FILTER d.repo_id == @rid AND d.suite_key == @sk REMOVE d IN ${COLLECTION}`,
    { rid: repoId, sk: suiteKey }
  );
  await cursor.all();
  logger.info('ragas-suite.deleted', { repo_id: repoId, suite_key: suiteKey });
  return { deleted: suiteKey };
}

/**
 * Delete ONE run of a suite (David 2026-10-24: "we need the ability to
 * delete previous runs in the UI"). Cascades the run's explain docs — an
 * orphaned ragas_explain would keep advising on a run nobody can open.
 * A RUNNING run is refused: cancel it first, deleting the doc under a live
 * worker would leave the run promise writing into a vanished document.
 */
async function deleteRun(repoId, suiteKey, runKey) {
  // A live RE-SCORE is executing too — deleting its doc mid-flight would
  // leave the panel polling a key that no longer exists (the 404 spiral).
  if (runInFlight.get(suiteKey) === runKey || rescoreInFlight.has(runKey)) {
    const err = new Error('this run is executing — cancel it first');
    err.code = 'RUN_IN_FLIGHT';
    err.status = 409;
    err.details = { run_key: runKey };
    throw err;
  }
  // An explain still advising on this run would save its doc AFTER the cascade
  // and recreate the orphan this delete exists to remove. Wait for it (same
  // contract as deleteSuite's RUN_IN_FLIGHT).
  const inflight = explainInFlight.get(suiteKey);
  if (inflight && inflight.run_key === runKey) {
    const err = new Error('an explain is running for this run — wait for it to finish');
    err.code = 'EXPLAIN_IN_FLIGHT';
    err.status = 409;
    err.details = { run_key: runKey, explain_key: inflight.explain_key };
    throw err;
  }
  const db = await dbService.getConnection();
  await ensureCollection(db);
  const doc = await loadDoc(db, runKey, 'RUN_NOT_FOUND', `run ${runKey}`);
  if (doc.repo_id !== repoId || doc.suite_key !== suiteKey || doc.kind !== 'ragas_run') {
    const err = new Error(`run ${runKey} not found for suite ${suiteKey}`);
    err.code = 'RUN_NOT_FOUND';
    err.status = 404;
    throw err;
  }
  // The run doc + every explain doc authored for it, in one statement.
  const cursor = await db.query(
    `FOR d IN ${COLLECTION} FILTER d.repo_id == @rid AND d.suite_key == @sk AND (d._key == @rk OR (d.kind == 'ragas_explain' AND d.payload.run_key == @rk)) REMOVE d IN ${COLLECTION}`,
    { rid: repoId, sk: suiteKey, rk: runKey }
  );
  const removed = await cursor.all();
  logger.info('ragas-suite.run_deleted', {
    repo_id: repoId,
    suite_key: suiteKey,
    run_key: runKey,
    removed: removed.length
  });
  return { deleted: runKey, removed_docs: removed.length };
}

/**
 * Re-score a FINISHED run with a different judge (David 2026-10-24: "so you
 * are giving me the ability to re-score the same benchmark with a different
 * judge … so long as we know which judge was used for each run and the runs
 * are separate").
 *
 * The answers are NOT regenerated: the source run's stored answers, served
 * contexts, references and reference passages are reused verbatim, so the ONLY
 * thing that changes between the two runs is the judge. That matters — vLLM
 * is only near-greedy, and two runs of the same prompt churned 100/100
 * answers, which would confound a judge comparison with answer churn.
 *
 * The result is a NEW run doc (its own key, its own fidelity block naming
 * the judge, `rescore_of` pointing at the source). The source run is never
 * modified.
 */
async function rescoreRun(repoId, suiteKey, runKey, opts = {}, ctx = {}) {
  const db = await dbService.getConnection();
  await ensureCollection(db);
  const source = await loadDoc(db, runKey, 'RUN_NOT_FOUND', `run ${runKey}`);
  if (source.repo_id !== repoId || source.suite_key !== suiteKey || source.kind !== 'ragas_run') {
    const err = new Error(`run ${runKey} not found for suite ${suiteKey}`);
    err.code = 'RUN_NOT_FOUND';
    err.status = 404;
    throw err;
  }
  if (source.status !== 'done') {
    const err = new Error('only a finished run can be re-scored');
    err.code = 'RUN_NOT_DONE';
    err.status = 409;
    throw err;
  }
  const suite = await loadSuite(db, repoId, suiteKey);
  const entries = (suite.payload && suite.payload.entries) || [];
  const byId = new Map(entries.map((e) => [e.id, e]));
  const srcResults = (source.payload && source.payload.results) || [];
  if (!srcResults.length) {
    const err = new Error('this run has no rows to re-score');
    err.code = 'RUN_EMPTY';
    err.status = 409;
    throw err;
  }
  // The metrics to re-score: the source run's own set unless narrowed.
  const requested = Array.isArray(opts.metrics) && opts.metrics.length ? opts.metrics : source.metrics;
  const metrics = requested.filter((m) => ALL_METRICS.includes(m));
  if (!metrics.length) {
    const err = new Error('no known metrics selected');
    err.code = 'VALIDATION_ERROR';
    err.status = 400;
    throw err;
  }
  // The judge: picked > active > env (same chain as a run).
  const judgeOverride = await modelConfigService.resolveModelOverride({
    config_key: opts.judge_config_key,
    model: opts.judge_model,
    service: 'ragas_judge'
  });
  const effectiveJudge = judgeOverride && judgeOverride.model ? judgeOverride : null;
  const newRunKey = `rr${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
  const startedAt = new Date().toISOString();
  // A re-score IS a run: it gets a run doc IMMEDIATELY, with status 'running',
  // so the panel can list it, watch its progress and cancel it (David
  // 2026-10-25: "it also cannot be tracked and does not connect to the UI with
  // a progress bar… I cannot stop the re-scoring"). Before this the doc was
  // written only at the END of the judge leg, so every poll 404'd on a key
  // that did not exist yet, and the cancel endpoint could not find the run.
  const placeholder = {
    _key: newRunKey,
    repo_id: repoId,
    kind: 'ragas_run',
    status: 'running',
    suite_key: suiteKey,
    created_at: startedAt,
    created_by: (ctx.actor && ctx.actor.user_id) || 'system',
    metrics,
    payload: {
      // The lineage is visible from the FIRST poll, not only once the run
      // lands: this run re-scored that one.
      fidelity: {
        rescore_of: runKey,
        // The judge that is scoring it, from the FIRST poll. The panel's
        // history row reads the judge from payload.fidelity.judge, so
        // without it the operator watches a blank judge for the whole
        // (hours-long) judge leg — right after choosing one.
        judge: {
          ...modelConfigService.judgeFidelity(effectiveJudge),
          pick: { config_key: opts.judge_config_key || null, model: opts.judge_model || null }
        },
        // The note says "the selected judge", NOT "a different judge": the
        // re-score dialog prefills the source run's own judge, so the
        // default re-score is a SAME-judge re-score (a reproducibility
        // check). Claiming "different" was false, and the advisor's
        // second-judge verdict is built on it.
        rescore_note: `re-scoring ${runKey} with the selected judge — the answers are identical`
      }
    }
  };
  await db.collection(COLLECTION).save(placeholder);
  // The progress is written into the run DOC — the panel polls the doc, and
  // the doc is the only place that survives more than one okf-server
  // process. Throttled, like the run path's progress write.
  const PROGRESS_WRITE_MIN_MS = 2000;
  let lastProgressWrite = 0;
  const report = (p) => {
    const now = Date.now();
    // The judge's FIRST report is not throttled — the panel must be able to
    // name the model the re-score is using from the first tick (David
    // 2026-10-25).
    const force = Boolean(p && p.force);
    if (!force && now - lastProgressWrite < PROGRESS_WRITE_MIN_MS) return;
    lastProgressWrite = now;
    const body = { ...(p || {}) };
    delete body.force;
    db.collection(COLLECTION)
      .update(newRunKey, { progress: body, updated_at: new Date().toISOString() })
      .catch((e) => logger.warn('ragas-suite.rescore.progress_write_failed', { run_key: newRunKey, error: e.message }));
  };
  rescoreInFlight.set(newRunKey, { source_run_key: runKey });
  // A re-score is a JUDGE-only operation: the answers are copied verbatim.
  const results = srcResults.map((r) => ({ ...r, metrics: {} }));
  // The sidecar answers in SAMPLE ORDER, and the sample list EXCLUDES rows
  // with no answer (a failed row has nothing to judge). per_query must
  // therefore be mapped back through the ORIGINAL row index — index-aligning
  // it against `results` directly shifts every row after the first dropped
  // one, which silently scores the wrong answer against the wrong query.
  // An abstained refusal is not an answer — re-scoring must not submit it
  // to the judge either (same contract as the run path's isAnswered gate;
  // 2026-10-27: a re-score of the all-abstention run re-burned the judge
  // on 50 refusals).
  const scorable = results.map((r, i) => ({ r, i })).filter(({ r }) => isAnswered(r));
  if (!scorable.length) {
    // The source run's answers were all abstentions (or errors): there is
    // nothing to re-judge. Fail the re-score loudly instead of submitting an
    // empty dataset — the source run's own record already carries the
    // diagnosis (MASS_ABSTENTION).
    const err = new Error(
      'no scorable rows — every row of the source run abstained or errored, so there is nothing to re-judge; fix the cause recorded on the source run and RE-RUN (not re-score)'
    );
    err.code = 'NO_SCORABLE_ROWS';
    err.status = 409;
    throw err;
  }
  const samples = scorable.map(({ r }) => {
    const e = byId.get(r.id) || {};
    return {
      user_input: r.query,
      retrieved_contexts: r.contexts || [],
      response: r.answer,
      reference: e.reference_answer || '',
      reference_contexts: e.reference_passages || []
    };
  });
  const done = (async () => {
    try {
      const started = await sidecarSubmitWithRetry(
        '/evaluate',
        {
          samples,
          metrics,
          judge: effectiveJudge
            ? {
                provider: effectiveJudge.provider,
                base_url: effectiveJudge.base_url,
                model: effectiveJudge.model,
                api_key: effectiveJudge.api_key
              }
            : null
        },
        { repo_id: repoId, suite_key: suiteKey, run_key: newRunKey }
      );
      const body = await started.json();
      // The sidecar job id goes into the DOC (not only into memory): it is
      // how a second replica — or a restarted server — can tell that this
      // re-score is still being judged instead of declaring it interrupted
      // and rewriting its doc as failed.
      await db
        .collection(COLLECTION)
        .update(newRunKey, { sidecar_job_id: body.job_id })
        .catch((e) => logger.warn('ragas-suite.rescore.job_id_write_failed', { run_key: newRunKey, error: e.message }));
      // A cancel that landed while the SUBMIT was still in flight: the sidecar
      // job is not registered yet, so the cancel endpoint had nothing to
      // delete. Honour the intent here rather than letting the judge leg run
      // to the end for a run the user already stopped.
      if (userCancelledRun.has(newRunKey)) {
        await cancelSidecarJob(body.job_id, `re-score cancelled by user (${newRunKey})`);
        const cancelled = new Error('re-score cancelled by user');
        cancelled.code = 'RAGAS_JOB_CANCELLED';
        throw cancelled;
      }
      const evaluation = await pollSidecarJobOwned(
        body.job_id,
        {
          kind: 'evaluate',
          repo_id: repoId,
          suite_key: suiteKey,
          run_key: newRunKey
        },
        {
          // The sidecar's rows-done/rows-total becomes the re-score's
          // progress (the panel polls it while the judge leg runs). The
          // FIRST tick carries the judge and the pick, so the panel names
          // the model the re-score is using and its picker adopts it
          // (David 2026-10-25).
          onProgress: (p) =>
            report({
              phase: 'judge',
              done: Number(p && p.done) || 0,
              total: Number(p && p.total) || samples.length,
              force: true,
              judge: modelConfigService.judgeFidelity(effectiveJudge),
              judge_pick: { config_key: opts.judge_config_key || null, model: opts.judge_model || null }
            })
        }
      );
      const perQuery = Array.isArray(evaluation.per_query) ? evaluation.per_query : [];
      if (perQuery.length !== scorable.length) {
        logger.warn('ragas-suite.rescore.row_count_mismatch', {
          run_key: newRunKey,
          submitted: scorable.length,
          returned: perQuery.length
        });
      }
      // Map back through the ORIGINAL row index (see `scorable` above).
      scorable.forEach(({ i }, k) => {
        const q = perQuery[k] || {};
        results[i].metrics = q || {};
        delete results[i].metrics.user_input;
        delete results[i].metrics.retrieved_contexts;
        delete results[i].metrics.response;
        delete results[i].metrics.reference;
        results[i].ragas_nan = q.ragas_nan === 'ALL_NAN';
        results[i].judged = true;
      });
      // The rows the re-score did NOT hand to the judge carry no score.
      const resubmitted = new Set(scorable.map((s) => s.i));
      for (let i = 0; i < results.length; i += 1) {
        if (resubmitted.has(i)) continue;
        results[i].metrics = {};
        results[i].judged = false;
      }
      const summary = summarizeRun(suite, results, metrics);
      // The banner's coverage figure, computed over the IN-SCOPE population
      // (the same rule the run path uses) — without this block a re-score
      // could never raise the invalid-run banner, because the banner reads
      // payload.coverage.
      const measuredRows = Object.keys(summary.coverage || {}).length
        ? Math.max(0, ...Object.values(summary.coverage).map((c) => Number(c && c.scored) || 0))
        : 0;
      const judgeFid = modelConfigService.judgeFidelity(effectiveJudge);
      const newDoc = {
        _key: newRunKey,
        repo_id: repoId,
        kind: 'ragas_run',
        status: 'done',
        suite_key: suiteKey,
        created_at: startedAt,
        created_by: (ctx.actor && ctx.actor.user_id) || 'system',
        repo_ids: source.repo_ids || [],
        metrics,
        payload: {
          suite_created_at: suite.created_at,
          entries: entries.map((e) => ({
            id: e.id,
            query: e.query,
            oos: e.oos,
            reference_answer: e.reference_answer,
            reference_passages: e.reference_passages
          })),
          results,
          summary,
          // The same coverage block the run path writes. Without it the
          // invalid-run banner's coverage branch can never fire for a
          // re-score — and a re-score that measured only part of the suite
          // is exactly the case the banner exists for (a second judge that
          // scores fewer rows).
          coverage: {
            measured_rows: measuredRows,
            total_rows: summary.n_evaluable,
            per_metric: summary.coverage
          },
          fidelity: {
            // The SAME retrieval as the source run — the answers were not
            // regenerated, only re-judged.
            retrieval: (source.payload && source.payload.fidelity && source.payload.fidelity.retrieval) || null,
            judge: {
              ...judgeFid,
              pick: { config_key: opts.judge_config_key || null, model: opts.judge_model || null }
            },
            // The lineage: this run re-scored that one.
            rescore_of: runKey,
            rescore_note: `re-scored ${runKey} with the selected judge — the answers are identical`
          }
        }
      };
      await db.collection(COLLECTION).replace(newRunKey, newDoc);
      logger.info('ragas-suite.run_rescored', {
        repo_id: repoId,
        suite_key: suiteKey,
        run_key: newRunKey,
        source_run_key: runKey,
        judge: judgeFid.model || judgeFid.source,
        metrics: metrics.join(',')
      });
      return newDoc;
    } catch (e) {
      // The re-score must LEAVE A DOC behind whatever happened — a run the
      // panel cannot find is the 404 spiral this whole path was built to
      // avoid. A user cancel lands as 'cancelled' (never 'failed': the same
      // rule the run path follows), anything else as 'failed'.
      const cancelled = e.code === 'RAGAS_JOB_CANCELLED' || userCancelledRun.has(newRunKey);
      await db
        .collection(COLLECTION)
        .replace(newRunKey, {
          ...placeholder,
          status: cancelled ? 'cancelled' : 'failed',
          error: cancelled
            ? { code: 'RAGAS_JOB_CANCELLED', status: null, message: 're-score cancelled by user' }
            : { code: e.code || 'RESCORE_FAILED', status: e.status || null, message: e.message }
        })
        .catch((persistErr) =>
          logger.error('ragas-suite.rescore.terminal_persist_failed', {
            run_key: newRunKey,
            error: persistErr.message
          })
        );
      throw e;
    } finally {
      rescoreInFlight.delete(newRunKey);
      // The cancel flag is a process-lifetime Set, and the re-score path
      // added to it (the shared cancel route adds the key it was given)
      // without ever removing it — one leaked entry per cancelled re-score.
      userCancelledRun.delete(newRunKey);
    }
  })();
  done.catch((e) => {
    // A cancel is not a failure: it gets its own log line so an operator
    // reading the log does not read it as a broken re-score.
    if (e && e.code === 'RAGAS_JOB_CANCELLED') {
      logger.info('ragas-suite.rescore.cancelled_by_user', {
        repo_id: repoId,
        suite_key: suiteKey,
        run_key: newRunKey
      });
      return;
    }
    logger.error('ragas-suite.rescore.async_failed', {
      repo_id: repoId,
      suite_key: suiteKey,
      run_key: newRunKey,
      error: e.message
    });
  });
  return { run_key: newRunKey, source_run_key: runKey, status: 'running', done };
}

async function loadSuite(db, repoId, suiteKey) {
  const doc = await loadDoc(db, suiteKey, 'SUITE_NOT_FOUND', `suite ${suiteKey} for repo ${repoId}`);
  if (doc.repo_id !== repoId || doc.kind !== 'ragas_suite') {
    const err = new Error(`suite ${suiteKey} not found for repo ${repoId}`);
    err.code = 'SUITE_NOT_FOUND';
    err.status = 404;
    throw err;
  }
  return doc;
}

// ---------- run ------------------------------------------------------------

const runInFlight = new Map(); // suite_key -> run_key

async function beginRunSuite(repoId, suiteKey, payload = {}, opts = {}) {
  const db = await dbService.getConnection();
  await ensureCollection(db);
  const suite = await loadSuite(db, repoId, suiteKey);
  const metrics = normalizeMetrics(payload.metrics);
  const inflight = runInFlight.get(suiteKey);
  if (inflight) {
    const err = new Error('a run is already executing for this suite');
    err.code = 'RUN_IN_FLIGHT';
    err.status = 409;
    err.details = { run_key: inflight };
    throw err;
  }
  const runKey = `rr${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
  runInFlight.set(suiteKey, runKey);
  const placeholder = {
    _key: runKey,
    repo_id: repoId,
    kind: 'ragas_run',
    status: 'running',
    suite_key: suiteKey,
    created_at: new Date().toISOString(),
    created_by: (opts.actor && opts.actor.user_id) || 'system',
    payload: {}
  };
  try {
    await db.collection(COLLECTION).save(placeholder);
  } catch (e) {
    runInFlight.delete(suiteKey);
    throw e;
  }
  logger.info('ragas-suite.run_started', {
    repo_id: repoId,
    suite_key: suiteKey,
    run_key: runKey,
    entries: suite.payload.entries.length
  });
  const PROGRESS_WRITE_MIN_MS = 2000;
  let lastProgressWrite = 0;
  const reportProgress = async (progress) => {
    const now = Date.now();
    // The judge's FIRST report is not throttled: it is the one the panel
    // needs to name the model the run is scoring with, and the throttle
    // would drop it exactly when the retrieval leg was fast (the panel then
    // showed a picker that disagreed with the running job — David
    // 2026-10-25).
    const force = Boolean(progress && progress.force);
    if (!force && now - lastProgressWrite < PROGRESS_WRITE_MIN_MS) return;
    lastProgressWrite = now;
    const body = { ...(progress || {}) };
    delete body.force;
    await db
      .collection(COLLECTION)
      .update(runKey, { progress: body, updated_at: new Date().toISOString() })
      .catch((e) => logger.warn('ragas-suite.run.progress_write_failed', { run_key: runKey, error: e.message }));
  };
  const done = runSuite(repoId, suiteKey, {
    ...opts,
    runKey,
    metrics,
    startedAt: placeholder.created_at,
    reportProgress,
    // 8-7: an explicit judge pick from the Run dialog rides the opts
    judge_config_key: payload.judge_config_key || null,
    judge_model: payload.judge_model || null,
    // 2026-10-23: 'whatif' opts into the Lab's retrieval replay; the default
    // (undefined/'serve') measures the served system through chatqna.
    mode: payload.mode || null
  })
    .then((runDoc) => runDoc)
    .catch(async (e) => {
      // a user cancel must surface AS a cancel, not as the post-cancel 404
      const userCancelled = userCancelledRun.delete(runKey);
      const code = userCancelled ? 'RAGAS_JOB_CANCELLED' : typeof e.code === 'string' && e.code ? e.code : 'RUN_FAILED';
      const failDoc = {
        ...placeholder,
        status: 'cancelled',
        error: { code, message: userCancelled ? 'run cancelled by user' : e.message }
      };
      if (!userCancelled) failDoc.status = 'failed';
      await db
        .collection(COLLECTION)
        .replace(runKey, failDoc)
        .catch((dbErr) =>
          logger.error('ragas-suite.run.fail_persist_failed', { run_key: runKey, error: dbErr.message })
        );
      throw e;
    })
    .finally(() => runInFlight.delete(suiteKey));
  done.catch((e) =>
    logger.error('ragas-suite.run.async_failed', {
      repo_id: repoId,
      suite_key: suiteKey,
      run_key: runKey,
      error: e.message
    })
  );
  return { run_key: runKey, done };
}

function normalizeMetrics(requested) {
  const want = Array.isArray(requested) && requested.length ? requested : DEFAULT_METRICS;
  const valid = want.filter((m) => ALL_METRICS.includes(m));
  const metrics = valid.length ? [...new Set([...DEFAULT_METRICS, ...valid])] : [...DEFAULT_METRICS];
  return metrics;
}

async function runSuite(repoId, suiteKey, opts = {}) {
  return withSpan('okf.ragas.run', async (span) => {
    span.setAttribute('okf.repo_id', repoId);
    const db = await dbService.getConnection();
    await ensureCollection(db);
    const suite = await loadSuite(db, repoId, suiteKey);
    const repoIds = suite.repo_ids && suite.repo_ids.length ? suite.repo_ids : [repoId];
    const graphNames = await graphNamesFor(db, repoIds);
    if (!graphNames.length) {
      const err = new Error('no ingested graphs for the selected repositories — publish and wait for the drain first');
      err.code = 'NO_GRAPH';
      err.status = 409;
      throw err;
    }
    const entries = suite.payload.entries;
    const results = [];
    let doneCount = 0;
    const total = entries.length;
    await report(opts, { phase: 'retrieval', done: 0, total });
    let cursorIdx = 0;
    // TERMINAL answer-leg errors abort the run (David 2026-10-21: "do not
    // allow this thing to keep blundering forward when it is getting
    // errors"). A 4xx (except 429 rate-limit) fails EVERY row identically —
    // marching on just repackages a broken benchmark as a zero-score "done"
    // run. First terminal error wins; unattempted rows are recorded SKIPPED.
    let abortErr = null;
    // Terminal = a hard client error (except 429 rate-limit). BOTH error
    // shapes count: axios carries .response.status, while fetch-wrapped
    // callers (rerankTexts) throw err.status with no .response — missing
    // the fetch shape let terminal reranker 401/404/422 march the run on.
    const statusOfErr = (err) =>
      (err && err.response && err.response.status) || (typeof (err && err.status) === 'number' ? err.status : null);
    const isTerminal = (err) => {
      const s = statusOfErr(err);
      return typeof s === 'number' && s >= 400 && s < 500 && s !== 429;
    };
    // SERVE by default (2026-10-23): the benchmark measures the served
    // system. `mode: 'whatif'` opts back into the Lab's retrieval replay.
    const serveMode = (opts.mode || 'serve') !== 'whatif';
    if (serveMode) {
      logger.info('ragas-suite.run_mode_serve', {
        repo_id: repoId,
        suite_key: suiteKey,
        run_key: opts.runKey,
        serve_url: SERVE_URL()
      });
    }
    async function worker() {
      for (;;) {
        if (abortErr) return;
        // User cancel during the answer phase (2026-10-21 review F1): the
        // cancel route only marks userCancelledRun + cancels sidecar jobs —
        // no evaluate job exists yet in this phase, so without this check a
        // "cancelled" run ground through every answer AND the judge leg and
        // landed as done.
        if (userCancelledRun.has(opts.runKey)) return;
        const i = cursorIdx++;
        if (i >= entries.length) return;
        const e = entries[i];
        try {
          if (serveMode) {
            // SERVE: the question goes through the citizen's own pipeline.
            // No parallel retrieval — the served contexts ARE the contexts.
            const served = await serveAnswer(e.query, graphNames);
            results[i] = {
              id: e.id,
              query: e.query,
              contexts: served.contexts,
              context_keys: served.context_keys,
              candidate_keys: served.context_keys,
              candidates: [],
              answer: served.answer,
              abstained: served.abstained,
              abstention_reason: served.abstained ? served.abstention_reason || 'answer contract' : '',
              confidence: served.confidence,
              // The grounding evidence the citizen UI showed for this answer
              // (its confidence badge + related documents). The advisor and
              // the panel read these instead of guessing from the prose.
              self_confidence: served.self_confidence,
              retrieval_confidence: served.retrieval_confidence,
              is_grounded: served.is_grounded,
              related_documents: served.related_documents,
              error: null
            };
          } else {
            const embeddings = await frontmatterService.teiEmbed([e.query]);
            const emb = Array.isArray(embeddings) && embeddings[0];
            if (!emb) throw new Error('query embedding failed');
            const retrieved = await retrieveContexts(db, graphNames, e.query, emb);
            const gen = await generateAnswer(e.query, retrieved.contexts);
            results[i] = {
              id: e.id,
              query: e.query,
              contexts: retrieved.contexts,
              context_keys: retrieved.context_keys,
              candidate_keys: retrieved.candidate_keys,
              candidates: retrieved.candidates,
              answer: gen.answer,
              abstained: gen.abstained,
              abstention_reason: gen.abstained ? 'answer contract' : '',
              error: null
            };
          }
        } catch (err) {
          results[i] = {
            id: e.id,
            query: e.query,
            contexts: [],
            context_keys: [],
            candidate_keys: [],
            candidates: [],
            answer: '',
            abstained: false,
            abstention_reason: '',
            error: {
              code: err.code || 'ENTRY_FAILED',
              status: statusOfErr(err),
              message: err.message
            }
          };
          if (isTerminal(err) && !abortErr) {
            abortErr = err;
            logger.error('ragas-suite.run_answer_leg_aborted', {
              repo_id: repoId,
              suite_key: suiteKey,
              run_key: opts.runKey,
              status: statusOfErr(err),
              message: err.message
            });
          }
        }
        doneCount += 1;
        await report(opts, { phase: 'retrieval', done: doneCount, total });
      }
    }
    await Promise.all(Array.from({ length: Math.min(RUN_CONCURRENCY, entries.length) }, worker));

    // COMPLETENESS SWEEP (David, 2026-10-23: "we must have complete
    // benchmarks"). A row whose retrieval or answer call died on a transient
    // infra error (429, timeout) makes the whole run INVALID — the panel
    // banners it and the means are over a subset. Before declaring the run
    // done, retry every errored row ONCE, sequentially: the burst that
    // killed it (2 questions x N calls racing the gateway limiter) is over
    // by now, and a sequential single-flight retry is the politest possible
    // shape. A row that fails again keeps its error and still counts against
    // validity — honesty is not traded away for completeness.
    const erroredIdx = results.reduce((acc, r, i) => (r && r.error ? [...acc, i] : acc), []);
    if (erroredIdx.length && !abortErr && !userCancelledRun.has(opts.runKey)) {
      logger.info('ragas-suite.run_completeness_sweep', {
        repo_id: repoId,
        suite_key: suiteKey,
        run_key: opts.runKey,
        retrying: erroredIdx.length
      });
      for (const i of erroredIdx) {
        // Same per-row cancel check the worker loop has (review F1 class):
        // a cancel during the sweep must stop it here, not after every
        // remaining retry has hit the shared endpoint.
        if (userCancelledRun.has(opts.runKey)) break;
        const e = entries[i];
        try {
          let row;
          if (serveMode) {
            const served = await serveAnswer(e.query, graphNames);
            row = {
              contexts: served.contexts,
              context_keys: served.context_keys,
              candidate_keys: served.context_keys,
              answer: served.answer,
              abstained: served.abstained,
              abstention_reason: served.abstained ? served.abstention_reason || 'answer contract' : '',
              confidence: served.confidence
            };
          } else {
            const embeddings = await frontmatterService.teiEmbed([e.query]);
            const emb = Array.isArray(embeddings) && embeddings[0];
            if (!emb) throw new Error('query embedding failed');
            const retrieved = await retrieveContexts(db, graphNames, e.query, emb);
            const gen = await generateAnswer(e.query, retrieved.contexts);
            row = {
              contexts: retrieved.contexts,
              context_keys: retrieved.context_keys,
              candidate_keys: retrieved.candidate_keys,
              candidates: retrieved.candidates,
              answer: gen.answer,
              abstained: gen.abstained,
              abstention_reason: gen.abstained ? 'answer contract' : ''
            };
          }
          results[i] = {
            id: e.id,
            query: e.query,
            ...row,
            error: null
          };
          logger.info('ragas-suite.run_sweep_recovered', {
            repo_id: repoId,
            run_key: opts.runKey,
            row_id: e.id
          });
        } catch (err) {
          // Keep the ORIGINAL error (it is the forensically honest one — the
          // sweep's failure would just repeat it); note the sweep happened.
          results[i].error.sweep_retried = true;
          logger.warn('ragas-suite.run_sweep_failed_again', {
            repo_id: repoId,
            run_key: opts.runKey,
            row_id: e.id,
            message: String(err && err.message).slice(0, 200)
          });
        }
        // The row was already counted done when it errored in the worker
        // phase — re-report the same progress as a heartbeat, never more:
        // incrementing again would publish done > total (104/100).
        await report(opts, { phase: 'retrieval', done: doneCount, total });
      }
    }

    // Fill any gaps left by an abort, then FAIL LOUD: a run whose answers
    // failed is never a scored "done" run — zeros are not results. Judge
    // only the rows that produced an answer; if none did (or a terminal
    // error aborted the run), write status 'failed' with the cause and keep
    // the partial rows for forensics.
    for (let i = 0; i < entries.length; i += 1) {
      if (!results[i]) {
        results[i] = {
          id: entries[i].id,
          query: entries[i].query,
          contexts: [],
          context_keys: [],
          candidate_keys: [],
          candidates: [],
          answer: '',
          abstained: false,
          abstention_reason: '',
          error: {
            code: 'SKIPPED_RUN_ABORTED',
            status: null,
            message: 'not attempted — run aborted on a terminal error'
          }
        };
      }
    }
    // The IN-SCOPE population is the counting population — out-of-scope
    // control entries abstain BY DESIGN and must not inflate the abstention
    // rate or fire the mass-abstention gate (same rule as summarizeRun's
    // documented denominator).
    const inScopeIds = new Set(entries.filter((e) => e.oos).map((e) => e.id));
    const inScopeRows = results.filter((r) => r && !inScopeIds.has(r.id));
    const erroredRows = inScopeRows.filter((r) => r.error).length;
    const abstainedRows = inScopeRows.filter((r) => r && r.abstained).length;
    const answeredRows = inScopeRows.filter(isAnswered).length;
    // The dominant abstention reason, for the failed-run envelope — the
    // operator reads the run doc and goes to the cause, not to the rows.
    const dominantReason = (() => {
      const counts = {};
      for (const r of inScopeRows) {
        if (r && r.abstained) {
          const key = r.abstention_reason || 'answer contract';
          counts[key] = (counts[key] || 0) + 1;
        }
      }
      const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      return best ? best[0] : '';
    })();
    // A user cancel observed by the workers routes through beginRunSuite's
    // catch (userCancelledRun relabel) so the doc lands status 'cancelled'
    // exactly like a judge-phase cancel — never as failed or done.
    if (userCancelledRun.has(opts.runKey)) {
      const cancelled = new Error('run cancelled by user');
      cancelled.code = 'RAGAS_JOB_CANCELLED';
      throw cancelled;
    }
    if (abortErr || answeredRows === 0) {
      // Three ways here: a terminal abort, every row erroring at the
      // pipeline level, or EVERY ROW ABSTAINING. The third is not a set of
      // failed answers — it is one pipeline-wide condition (a reranker
      // input-budget 422 under a raised candidate pool, a down model
      // endpoint) expressed N times, and the envelope must name it as such
      // (2026-10-27: 50 refusals were judged and filed as a 0-score run).
      const abstentionOnly = abstainedRows > 0 && erroredRows === 0;
      const firstErr =
        (results.find((r) => r.error && r.error.code !== 'SKIPPED_RUN_ABORTED') || {}).error ||
        (abstentionOnly
          ? {
              code: 'MASS_ABSTENTION',
              status: null,
              message:
                `all ${abstainedRows} of ${inScopeRows.length} in-scope rows abstained — ` +
                (serveMode
                  ? 'the serving pipeline delivered no answers '
                  : "the answer leg produced no answers (whatif mode — the abstention contract is okf-server's own) ") +
                `(dominant reason: "${dominantReason}"). This is a pipeline/configuration condition, ` +
                'not a benchmark result: fix the cause the reasons name, then run again.'
            }
          : {
              code: 'ANSWER_LEG_FAILED',
              message: 'every answer failed'
            });
      // Top-level `error` is the READ contract for failed runs — getRunSuite
      // strips a failed doc to {run_key, suite_key, status, error} and the
      // panel renders that envelope's error.
      const runError = {
        code: firstErr.code,
        status: firstErr.status || null,
        message: firstErr.message,
        failed_rows: erroredRows,
        total,
        aborted: Boolean(abortErr)
      };
      const failedDoc = {
        _key: opts.runKey,
        repo_id: repoId,
        kind: 'ragas_run',
        status: 'failed',
        suite_key: suiteKey,
        created_at: opts.startedAt,
        created_by: (opts.actor && opts.actor.user_id) || 'system',
        repo_ids: repoIds,
        metrics: opts.metrics,
        error: runError,
        payload: {
          suite_created_at: suite.created_at,
          entries: entries.map((e) => ({ id: e.id, query: e.query, oos: e.oos })),
          results,
          summary: null,
          error: runError,
          abstained: { count: abstainedRows, rate: inScopeRows.length ? abstainedRows / inScopeRows.length : 0 },
          fidelity: {
            retrieval: serveMode
              ? {
                  algorithm: 'SERVED — chatqna /v1/chatqna',
                  mode: 'serve',
                  serve_url: SERVE_URL(),
                  graphs: graphNames,
                  posture: servePosture()
                }
              : {
                  algorithm: 'per-graph APPROX_NEAR_COSINE + unified rerank',
                  mode: 'whatif',
                  candidate_k: CANDIDATE_K,
                  top_n: TOP_N,
                  graphs: graphNames
                },
            judge: null,
            answers: await answerFidelity({ serveMode })
          }
        }
      };
      await db.collection(COLLECTION).replace(opts.runKey, failedDoc);
      span.setAttribute('okf.ragas.failed_rows', erroredRows);
      logger.error('ragas-suite.run_failed', {
        repo_id: repoId,
        suite_key: suiteKey,
        run_key: opts.runKey,
        failed_rows: erroredRows,
        total,
        aborted: Boolean(abortErr),
        cause: firstErr.message
      });
      return failedDoc;
    }

    // score with the sidecar — 8-7 model configs: the scoring judge resolves
    // picked > active > env (same chain as generation).
    await report(opts, { phase: 'judge', done: 0, total: 1 });
    const judgeOverride = await modelConfigService.resolveModelOverride({
      config_key: opts.judge_config_key,
      model: opts.judge_model,
      service: 'ragas_judge'
    });
    // An override without a model is unusable (the sidecar validation would
    // fail every judge leg) — the env judge applies, and the run's fidelity
    // records the EFFECTIVE judge, not the unusable pick.
    const effectiveJudge = judgeOverride && judgeOverride.model ? judgeOverride : null;
    // Name the judge in the progress envelope, with the pick as made: the
    // panel shows "Judging with <model>" and adopts the pick into its own
    // picker, so the dropdown and the running job can never disagree
    // (David 2026-10-25).
    await report(opts, {
      phase: 'judge',
      done: 0,
      total: 1,
      force: true,
      judge: modelConfigService.judgeFidelity(effectiveJudge),
      judge_pick: { config_key: opts.judge_config_key || null, model: opts.judge_model || null }
    });
    // Judge ONLY the rows that produced an answer. A row with no answer has
    // nothing to judge: submitting it makes the sidecar score an EMPTY
    // response, which comes back as ZEROS on the context and answer metrics
    // — and zeros are numbers, so they land in the means and depress them.
    // The run path's own comment says "Judge only the rows that produced an
    // answer" (:2287), its sibling re-score path filters the same way
    // (:1770), and a passing test encodes the same intent
    // (ragas-suite-service.test.js:2353-2397). The payload contradicted all
    // three: it submitted every row.
    //
    // The sidecar answers in SAMPLE order, so per_query must be mapped back
    // through the ORIGINAL row index — aligning it against `results`
    // directly shifts every row after the first dropped one, which scores the
    // wrong answer against the wrong query.
    const scorable = results.map((r, i) => ({ r, i })).filter(({ r }) => isAnswered(r));
    const samples = scorable.map(({ r, i }) => {
      const e = entries[i];
      return {
        user_input: e.query,
        retrieved_contexts: r.contexts,
        response: r.answer,
        reference: e.reference_answer || '',
        reference_contexts: e.reference_passages || []
      };
    });
    const evalStarted = await sidecarSubmitWithRetry(
      '/evaluate',
      {
        samples,
        metrics: opts.metrics,
        // An override without a model falls back to the env judge
        judge: effectiveJudge
          ? {
              provider: effectiveJudge.provider,
              base_url: effectiveJudge.base_url,
              model: effectiveJudge.model,
              api_key: effectiveJudge.api_key
            }
          : null
      },
      { repo_id: repoId, suite_key: suiteKey, run_key: opts.runKey }
    );
    const evalStartedBody = await evalStarted.json();
    // The sidecar job id goes into the DOC: it is how a second replica — or
    // a restarted server — can tell that this run is still being judged
    // instead of declaring it interrupted and rewriting its doc as failed.
    await db
      .collection(COLLECTION)
      .update(opts.runKey, { sidecar_job_id: evalStartedBody.job_id })
      .catch((e) => logger.warn('ragas-suite.run.job_id_write_failed', { run_key: opts.runKey, error: e.message }));
    // Cancel-race guard (live 2026-10-23): a cancel that lands between the
    // pre-judge check above and this submission finds NOTHING in
    // activeSidecarJobs to cancel (the job is not registered until
    // pollSidecarJobOwned runs) — so the evaluate job would run UNCANCELLED
    // for hours of judge calls while the run doc already says cancelled.
    // Re-check here, after the submit: if the user cancelled meanwhile, kill
    // the job we just created and honour the cancel.
    if (userCancelledRun.has(opts.runKey)) {
      await cancelSidecarJob(evalStartedBody.job_id, 'run cancelled by user (landed during judge submit)');
      const cancelled = new Error('run cancelled by user');
      cancelled.code = 'RAGAS_JOB_CANCELLED';
      throw cancelled;
    }
    const evaluation = await pollSidecarJobOwned(
      evalStartedBody.job_id,
      {
        kind: 'evaluate',
        repo_id: repoId,
        suite_key: suiteKey,
        run_key: opts.runKey
      },
      {
        // the sidecar's rows-done/rows-total becomes the run's judge-phase
        // progress (David 2026-10-18: per-phase progress bars)
        onProgress: (p) =>
          report(opts, {
            phase: 'judge',
            done: Number(p && p.done) || 0,
            total: Number(p && p.total) || total
          })
      }
    );
    const perQuery = Array.isArray(evaluation.per_query) ? evaluation.per_query : [];
    // The sidecar returns rows in SAMPLE order (EvaluationDataset preserves
    // it), and the sample list EXCLUDES the rows with no answer — so
    // per_query is mapped back through the ORIGINAL row index (see
    // `scorable` above). Aligning it against `results` directly would shift
    // every row after the first dropped one.
    scorable.forEach(({ i }, k) => {
      const q = perQuery[k] || {};
      results[i].metrics = q || {};
      delete results[i].metrics.user_input;
      delete results[i].metrics.retrieved_contexts;
      delete results[i].metrics.response;
      delete results[i].metrics.reference;
      results[i].ragas_nan = q.ragas_nan === 'ALL_NAN';
      // Handed to the judge — so this row WAS judged. The flag separates
      // "judged and the judge could not measure it" (metrics all null) from
      // "never handed to the judge" (no answer): two states the panel and
      // the guide must not conflate.
      results[i].judged = true;
    });
    // The rows that were NOT submitted carry no score at all — empty
    // metrics, so the mean excludes them and the coverage counts them as
    // NOT measured. They are never a zero.
    const submitted = new Set(scorable.map((s) => s.i));
    for (let i = 0; i < results.length; i += 1) {
      if (submitted.has(i)) continue;
      results[i].metrics = {};
      results[i].judged = false;
      results[i].ragas_nan = false;
    }
    // Judge COVERAGE (2026-10-21 sidecar review F2): the sidecar averages the
    // rows that scored and nulls the ones that failed, so a judge that died
    // on half the rows still produced a healthy-looking mean over the
    // survivors. The run records the per-metric scored-row count so the
    // panel can say "12 of 20 rows measured" instead of presenting a partial
    // average as the benchmark.
    const judgeCoverage = evaluation.coverage && typeof evaluation.coverage === 'object' ? evaluation.coverage : null;
    const summary = summarizeRun(suite, results, opts.metrics);
    // The banner's coverage figure: how many rows the BEST-covered metric
    // measured. It is computed over the IN-SCOPE population — the sidecar's
    // own coverage counts every row it was handed, including the
    // out-of-scope controls, so using it directly would make a fully
    // measured metric look partial whenever the suite holds a control.
    // One metric at 21/100 does NOT raise the banner; only a suite where NO
    // metric covered every row does.
    const measuredRows = Object.keys(summary.coverage || {}).length
      ? Math.max(0, ...Object.values(summary.coverage).map((c) => Number(c && c.scored) || 0))
      : judgeCoverage
        ? Math.max(0, ...Object.values(judgeCoverage).map((v) => Number(v) || 0))
        : perQuery.filter((q) => q && q.ragas_nan !== 'ALL_NAN').length;
    const runDoc = {
      _key: opts.runKey,
      repo_id: repoId,
      kind: 'ragas_run',
      status: 'done',
      suite_key: suiteKey,
      created_at: opts.startedAt,
      created_by: (opts.actor && opts.actor.user_id) || 'system',
      repo_ids: repoIds,
      metrics: opts.metrics,
      // The last progress, including the judge it was scored with — the
      // final write is a full replace, so it has to travel with the doc.
      progress: opts.lastProgress || null,
      payload: {
        suite_created_at: suite.created_at,
        entries: entries.map((e) => ({
          id: e.id,
          query: e.query,
          oos: e.oos,
          reference_answer: e.reference_answer,
          reference_passages: e.reference_passages
        })),
        results,
        summary,
        // How much of the suite the judge actually measured — a partial
        // average is not a benchmark result (sidecar review F2). The
        // denominator is the IN-SCOPE row count, so an out-of-scope control
        // cannot make a fully measured run look partial.
        coverage: {
          measured_rows: measuredRows,
          total_rows: summary.n_evaluable,
          per_metric: judgeCoverage
        },
        // Abstentions travelled on the rows only; surfacing the count and
        // rate at payload level (the in-scope population) makes a
        // partially-abstaining run legible without re-deriving from 50
        // rows. The advisor's grounding gate derives its own count from the
        // rows (runFacts.abstentions) — this field is the run-level RECORD,
        // not yet a consumer input.
        abstained: { count: abstainedRows, rate: inScopeRows.length ? abstainedRows / inScopeRows.length : 0 },
        fidelity: {
          retrieval: serveMode
            ? {
                algorithm: 'SERVED — chatqna /v1/chatqna (the citizen pipeline), include_contexts opt-in',
                mode: 'serve',
                serve_url: SERVE_URL(),
                graphs: graphNames,
                posture: servePosture()
              }
            : {
                algorithm: 'per-graph APPROX_NEAR_COSINE + unified rerank',
                mode: 'whatif',
                candidate_k: CANDIDATE_K,
                top_n: TOP_N,
                graphs: graphNames
              },
          prompt: serveMode
            ? {
                system_prompt_sha: null,
                source: 'chatqna serving prompt (CHATQNA_SYSTEM_PROMPT as deployed)'
              }
            : {
                system_prompt_sha: sha256(ANSWER_SYSTEM_PROMPT()),
                source: process.env.CHATQNA_SYSTEM_PROMPT ? 'CHATQNA_SYSTEM_PROMPT' : 'builtin-default'
              },
          judge: {
            ...modelConfigService.judgeFidelity(effectiveJudge),
            sidecar_reported_model: evaluation.model || null,
            embed_model: null,
            // The selection AS MADE in the Run dialog (nulls = deployment
            // default) — the panel's restore source, distinct from the
            // resolved fidelity fields above.
            pick: { config_key: opts.judge_config_key || null, model: opts.judge_model || null }
          },
          // Which model answered (David 2026-10-20): the deployment's chat
          // by default; a config explicitly checked for benchmark answers
          // takes over — and the benchmark then measures THAT model.
          answers: await answerFidelity({ serveMode })
        }
      }
    };
    await db.collection(COLLECTION).replace(opts.runKey, runDoc);
    span.setAttribute('okf.ragas.n', results.length);
    logger.info('ragas-suite.run_done', {
      repo_id: repoId,
      suite_key: suiteKey,
      run_key: opts.runKey,
      n: results.length
    });
    return runDoc;
  });
}

async function report(opts, progress) {
  // Keep the last progress on the run's own opts: the final document is a
  // full REPLACE, so without this the panel's "Judging with <model>" line
  // and the run's progress envelope vanish when the run lands (David
  // 2026-10-25).
  if (opts && typeof opts === 'object') {
    const body = { ...(progress || {}) };
    delete body.force;
    opts.lastProgress = body;
  }
  if (typeof opts.reportProgress === 'function') await opts.reportProgress(progress);
}

function sha256(s) {
  return createHash('sha256')
    .update(String(s || ''))
    .digest('hex')
    .slice(0, 16);
}

/**
 * Was this row handed to the judge?
 *
 * A row the run path never submitted was NEVER JUDGED — it carries no score,
 * so it is left out of the averages and never counted as a zero. The flag is
 * written at submit time; the numeric-metric test is the fallback for runs
 * stored before the flag existed.
 */
function rowWasJudged(r) {
  if (r && typeof r.judged === 'boolean') return r.judged;
  const m = (r && r.metrics) || {};
  return Object.keys(m).some((k) => typeof m[k] === 'number' && m[k] === m[k]);
}

/**
 * The run's summary — computed over ONE population.
 *
 * The population is the IN-SCOPE rows. An out-of-scope row is a control:
 * deliberately unanswerable, kept for contrast, "never counted as a failure,
 * a control and not a result" (the guide). It must therefore sit in NONE of
 * the four buckets, in NONE of the means, and in NONE of the coverage
 * denominators. Mixing the two populations is what made the panel's outcome
 * bar misreport which rows failed: n_errors and n_abstained counted
 * out-of-scope rows while n_evaluable and failing_count did not, and the
 * panel's client-side subtraction (failing_count − n_abstained) subtracted
 * a decline that was never judged in the first place.
 *
 * The four buckets now partition the in-scope rows exactly, each row in
 * exactly one:
 *   error     — the pipeline failed; no answer; never judged
 *   abstained — the answerer declined; NEVER judged (2026-10-27: an
 *               abstention is not an answer — the refusal is not submitted
 *               to the judge, so n_abstained_unjudged equals n_abstained on
 *               every post-change run; pre-change runs may carry judged
 *               abstentions, which the column still distinguishes)
 *   failing   — judged, a metric below its threshold, not a decline
 *   answered  — judged (or answerable), no metric below its threshold
 */
function summarizeRun(suite, results, metrics) {
  const thresholds = { ...FAIL_BELOW_DEFAULTS, ...((suite.payload && suite.payload.thresholds) || {}) };
  const entries = suite.payload.entries;
  const byId = new Map(entries.map((e) => [e.id, e]));
  const n = results.length;
  const inScope = results.filter((r) => !(byId.get(r.id) || {}).oos);
  const nOos = results.length - inScope.length;
  let nErrors = 0;
  let nAbstained = 0;
  // A decline was HISTORICALLY two states: arrived with no answer (never
  // judged — no score, out of the averages, coverage-reducing) or arrived
  // with refusal text (was judged; its zeros polluted the averages). Since
  // 2026-10-27 a decline is NEVER judged — an abstention is not an answer —
  // so every post-change abstention is the unjudged state and
  // n_abstained_unjudged equals n_abstained. Pre-change runs keep the
  // distinction this column was built for.
  let nAbstainedUnjudged = 0;
  let nFailing = 0;
  let nAnswered = 0;
  const failing = [];
  for (const r of inScope) {
    const m = r.metrics || {};
    const fails = [];
    for (const metric of metrics) {
      const v = m[metric];
      if (v === null || v === undefined || v !== v) continue;
      const t = thresholds[metric];
      if (t === undefined) continue;
      if (metric === 'noise_sensitivity' ? v > t : v < t) fails.push(metric);
    }
    const judged = rowWasJudged(r);
    if (r.error) {
      nErrors += 1;
      continue;
    }
    if (r.abstained) {
      nAbstained += 1;
      if (!judged) nAbstainedUnjudged += 1;
      // A decline has its own column: it is neither a pass nor an error.
      // Even when it was judged and its context metrics came back 0, it is
      // NOT in the failing bucket.
      continue;
    }
    if (fails.length) {
      nFailing += 1;
      failing.push({ id: r.id, query: r.query, fails });
      continue;
    }
    nAnswered += 1;
  }
  const means = {};
  const coverage = {};
  for (const m of metrics) {
    const vals = inScope.map((r) => (r.metrics ? r.metrics[m] : null)).filter((v) => typeof v === 'number' && v === v);
    means[m] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    // HOW MANY ROWS the judge actually scored for this metric. A mean over
    // a fifth of the rows is not this run's score for that metric, and the
    // panel has to be able to say so: a re-score with MiniMax-M3 produced
    // context_entities_recall for 21 of 100 rows (the metric's entity
    // extraction does not survive that model family) and the comparison
    // read as a like-for-like delta over the whole run.
    // The denominator is the IN-SCOPE population, so an out-of-scope control
    // cannot make a fully measured metric look partial.
    coverage[m] = { scored: vals.length, total: inScope.length };
  }
  return {
    n,
    n_errors: nErrors,
    n_abstained: nAbstained,
    n_abstained_unjudged: nAbstainedUnjudged,
    n_evaluable: inScope.length,
    n_oos: nOos,
    // The four buckets, computed here so the panel never has to subtract
    // across populations.
    n_failed: nFailing,
    n_answered: nAnswered,
    metrics: means,
    coverage,
    // The thresholds THIS run was scored under. A later comparison must
    // judge this run against the bar it was actually measured against —
    // the suite's thresholds may have been edited since.
    thresholds,
    failing_count: nFailing,
    // The list is capped (the advisor reads it); the COUNT is not, and the
    // panel reads the count. The cap is why failing_count and failing.length
    // can disagree past 100 failing rows.
    failing: failing.slice(0, 100)
  };
}

async function getRunSuite(repoId, suiteKey, runKey) {
  const db = await dbService.getConnection();
  await ensureCollection(db);
  // A re-score is live in its own map — without this the poll fell through
  // to the doc branch, found a 'running' doc and declared it INTERRUPTED
  // (the "the worker died" verdict), which is exactly wrong.
  if (runInFlight.get(suiteKey) === runKey || rescoreInFlight.has(runKey)) {
    const live = await loadDoc(db, runKey, 'RUN_NOT_FOUND', `run ${runKey}`).catch(() => null);
    return { run_key: runKey, suite_key: suiteKey, status: 'running', progress: (live && live.progress) || null };
  }
  const doc = await loadDoc(db, runKey, 'RUN_NOT_FOUND', `run ${runKey} for suite ${suiteKey}`);
  if (doc.repo_id !== repoId || doc.suite_key !== suiteKey) {
    const err = new Error(`run ${runKey} not found for suite ${suiteKey}`);
    err.code = 'RUN_NOT_FOUND';
    err.status = 404;
    throw err;
  }
  if (doc.status === 'running') {
    // This process does not have it in flight — but the SIDECAR may still
    // be judging it (another replica owns it, or this server restarted
    // mid-leg). Ask the sidecar before declaring the work dead: the old
    // behaviour rewrote a LIVE run's doc as failed while its judge leg kept
    // paying the GPU.
    if (await sidecarJobIsLive(doc.sidecar_job_id)) {
      return { run_key: runKey, suite_key: suiteKey, status: 'running', progress: doc.progress || null };
    }
    const failDoc = {
      ...doc,
      status: 'failed',
      error: {
        code: 'RUN_INTERRUPTED',
        message: 'the run was interrupted (worker died or the server restarted) — start a new run'
      }
    };
    await db
      .collection(COLLECTION)
      .replace(doc._key, failDoc)
      .catch(() => {});
    return { run_key: runKey, suite_key: suiteKey, status: 'failed', error: failDoc.error };
  }
  if (doc.status === 'failed') {
    return {
      run_key: runKey,
      suite_key: suiteKey,
      status: 'failed',
      error: doc.error || null,
      abstained: (doc.payload && doc.payload.abstained) || null
    };
  }
  return doc;
}

async function listRuns(repoId, payload = {}) {
  const limit = clampCount(payload.limit, 20, 100);
  const kind = ['ragas_run', 'ragas_suite', 'all'].includes(payload.kind) ? payload.kind : 'ragas_run';
  const db = await dbService.getConnection();
  await ensureCollection(db);
  const kinds = kind === 'all' ? ['ragas_run', 'ragas_suite'] : [kind];
  const cursor = await db.query(
    `FOR d IN ${COLLECTION} FILTER d.repo_id == @rid AND d.kind IN @kinds ` +
      'SORT d.created_at DESC LIMIT @lim RETURN MERGE(KEEP(d, ["_key", "repo_id", "kind", "suite_key", ' +
      '"name", "repo_ids", "created_at", "created_by", "metrics"]), ' +
      '{ status: d.status || null, error: HAS(d, "error") ? d.error : null, progress: d.progress || null, ' +
      'summary: HAS(d.payload, "summary") ? d.payload.summary : null, ' +
      'entries: HAS(d.payload, "entries") ? LENGTH(d.payload.entries) : null, ' +
      // The run's judge pick as made (judge memory, 2026-10-21) — the panel
      // restores its selector from the latest run of the loaded suite.
      'judge_pick: HAS(d, "payload") && HAS(d.payload, "fidelity") && HAS(d.payload.fidelity, "judge") && ' +
      'HAS(d.payload.fidelity.judge, "pick") ? d.payload.fidelity.judge.pick : null, ' +
      // The judge that scored this run, BY NAME (David 2026-10-24: "display
      // the JUDGE in the run column instead of the cryptic key") + the
      // re-score lineage (which run this one re-scored).
      'judge_model: HAS(d, "payload") && HAS(d.payload, "fidelity") && HAS(d.payload.fidelity, "judge") ? ' +
      '(d.payload.fidelity.judge.model || null) : null, ' +
      'judge_config: HAS(d, "payload") && HAS(d.payload, "fidelity") && HAS(d.payload.fidelity, "judge") ? ' +
      '(d.payload.fidelity.judge.config || null) : null, ' +
      'judge_source: HAS(d, "payload") && HAS(d.payload, "fidelity") && HAS(d.payload.fidelity, "judge") ? ' +
      '(d.payload.fidelity.judge.source || null) : null, ' +
      'rescore_of: HAS(d, "payload") && HAS(d.payload, "fidelity") ? ' +
      '(d.payload.fidelity.rescore_of || null) : null })',
    { rid: repoId, kinds, lim: limit }
  );
  const rows = await cursor.all();
  // A generation in flight has NO doc in the collection (the suite persists
  // only on completion), so a collection-only list orphaned it from every UI
  // surface after a page refresh — the panel reloaded the previous suite,
  // showed no progress, and a second Generate attempt 409'd (live incident
  // 2026-10-18). Surface the live generation as a synthetic newest row so
  // the list — and any loadSuite on it — can adopt it (progress + Cancel).
  const inflight = genInFlight.get(repoId);
  if (inflight && (kind === 'all' || kind === 'ragas_suite')) {
    rows.unshift({
      _key: inflight,
      repo_id: repoId,
      kind: 'ragas_suite',
      suite_key: inflight,
      name: null,
      created_at: new Date().toISOString(),
      status: 'generating',
      error: null,
      progress: genProgress.get(inflight) || null,
      summary: null,
      entries: null
    });
  }
  return rows;
}

// ---------- explain / advise ----------------------------------------------

const explainInFlight = new Map(); // suite_key -> explain_key
const rescoreInFlight = new Map(); // new run_key -> {source_run_key} (re-score legs)
// Explain progress (David 2026-10-21: "clicked explain… the UX is terrible as
// it does not show a progress bar"). The explain is ONE advisor LLM call that
// a reasoning judge can legitimately think over for minutes (live: MiniMax
// starved 1200→4800→19200 reasoning tokens before writing advice — the
// adaptive ladder doing its job, invisibly). The map carries the phase +
// start time so the poll envelope can render "advisor thinking, N failing
// rows, X elapsed" instead of a dead button.
const explainProgress = new Map(); // suite_key -> {phase, started_ms, failing}

async function beginExplainFailures(repoId, suiteKey, payload = {}, opts = {}) {
  const db = await dbService.getConnection();
  await ensureCollection(db);
  await loadSuite(db, repoId, suiteKey);
  const runKey =
    typeof payload.run_key === 'string' && payload.run_key ? payload.run_key : await latestRunKey(db, repoId, suiteKey);
  if (!runKey) {
    const err = new Error('no run to explain — run the suite first');
    err.code = 'NO_RUN';
    err.status = 409;
    throw err;
  }
  const inflight = explainInFlight.get(suiteKey);
  if (inflight) {
    const err = new Error('an explain is already running for this suite');
    err.code = 'EXPLAIN_IN_FLIGHT';
    err.status = 409;
    err.details = { run_key: inflight.run_key, explain_key: inflight.explain_key };
    throw err;
  }
  const explainKey = `rx${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
  explainInFlight.set(suiteKey, { explain_key: explainKey, run_key: runKey });
  const done = explainFailures(repoId, suiteKey, runKey, { ...opts, explainKey })
    .then((doc) => doc)
    .finally(() => explainInFlight.delete(suiteKey));
  done.catch((e) =>
    logger.error('ragas-suite.explain.async_failed', { repo_id: repoId, suite_key: suiteKey, error: e.message })
  );
  return { run_key: runKey, explain_key: explainKey, done };
}

async function latestRunKey(db, repoId, suiteKey) {
  const rows = await (
    await db.query(
      `FOR d IN ${COLLECTION} FILTER d.repo_id == @rid AND d.suite_key == @sk AND d.kind == "ragas_run" AND d.status == "done" ` +
        'SORT d.created_at DESC LIMIT 1 RETURN d._key',
      { rid: repoId, sk: suiteKey }
    )
  ).all();
  return rows.length ? rows[0] : null;
}

async function getExplainFailures(repoId, suiteKey, runKey) {
  const db = await dbService.getConnection();
  await ensureCollection(db);
  const inflight = explainInFlight.get(suiteKey);
  if (inflight && inflight.run_key === runKey) {
    const prog = explainProgress.get(suiteKey) || null;
    return {
      run_key: runKey,
      suite_key: suiteKey,
      status: 'running',
      progress: prog
        ? {
            phase: prog.phase,
            failing: typeof prog.failing === 'number' ? prog.failing : null,
            elapsed_s: Math.round((Date.now() - prog.started_ms) / 1000)
          }
        : null
    };
  }
  const rows = await (
    await db.query(
      `FOR d IN ${COLLECTION} FILTER d.repo_id == @rid AND d.suite_key == @sk AND d.kind == "ragas_explain" AND d.payload.run_key == @rk ` +
        'SORT d.created_at DESC LIMIT 1 RETURN d',
      { rid: repoId, sk: suiteKey, rk: runKey }
    )
  ).all();
  if (!rows.length) {
    const err = new Error(`no explain found for run ${runKey}`);
    err.code = 'EXPLAIN_NOT_FOUND';
    err.status = 404;
    throw err;
  }
  return rows[0];
}

/**
 * The failure-attribution matrix.
 *
 * `evidence` (from ragas-attribution-service) says WHERE the expected
 * passage went; this says what that MEANS. The two are separate on
 * purpose: the evidence is facts about the corpus, this is the judgement.
 *
 * The evidence ladder (each step is a place the passage can be lost):
 *
 *   retrieved   the passage reached the selected contexts — the pipeline
 *               found it; whatever failed is downstream (answer, judge).
 *   reranker    the passage was in the candidate pool but the reranker cut
 *               it — raise RERANKER_TOP_N / change the strategy.
 *   vector-recall
 *               the passage is in the corpus but the dense top-K never
 *               surfaced it — raise OKF_RAGAS_CANDIDATE_K (the rank probe
 *               says how far) or improve the embedding.
 *   corpus      the passage is NOT in the corpus. The question is then
 *               UNANSWERABLE AS ASKED: the benchmark row expects content
 *               the system was never given. It measures the benchmark, not
 *               the assistant — so it is reported as an unfair question and
 *               is never turned into content-curation work.
 *
 * The order matters: the DEEPEST loss wins, because the deepest loss is
 * the one that must be fixed first (a passage the dense stage never
 * surfaced cannot be rescued by a bigger rerank window).
 */
/**
 * The run that scored the SAME ANSWERS with a DIFFERENT judge: the
 * re-score of this run, or the run this run re-scored.
 *
 * Only a LINEAGE-linked sibling can be compared row by row — an unrelated
 * run scored its own answers, so its per-row scores say nothing about this
 * one's. The re-score is the only cheap way to get a second judge's verdict
 * over identical answers and contexts (no retrieval, no re-generation).
 */
async function loadSecondJudgeRun(db, repoId, suiteKey, runKey, runDoc) {
  const parent = (runDoc.payload && runDoc.payload.fidelity && runDoc.payload.fidelity.rescore_of) || '';
  const rows = await (
    await db.query(
      `FOR d IN ${COLLECTION} FILTER d.repo_id == @rid AND d.suite_key == @sk AND d.kind == "ragas_run" ` +
        'AND d.status == "done" AND d._key != @rk AND (d.payload.fidelity.rescore_of == @rk OR d._key == @parent) ' +
        'SORT d.created_at DESC LIMIT 1 RETURN d',
      { rid: repoId, sk: suiteKey, rk: runKey, parent }
    )
  ).all();
  return rows.length ? rows[0] : null;
}

/**
 * How the two judges differ on the rows THIS judge failed.
 *
 * The advisor used to ASSERT "a second judge disagrees on roughly half of
 * these rows" from a hardcoded string. That was true of ONE offline
 * measurement and silently became a lie for every other run — David
 * 2026-10-25: "If you have hard coded strings then fucking fix it". The
 * comparison is now computed from the sibling run's own scores.
 */
function compareJudges(suite, runDoc, secondDoc) {
  const judgeOf = (doc) => {
    const f = (doc.payload && doc.payload.fidelity && doc.payload.fidelity.judge) || null;
    return (f && (f.model || f.config)) || 'an unnamed judge';
  };
  // The judge's IDENTITY, or null when the run did not record one. Two runs
  // whose judge is UNKNOWN are not the same judge — the comparison must not
  // claim they are.
  const judgeIdentity = (doc) => {
    const f = (doc.payload && doc.payload.fidelity && doc.payload.fidelity.judge) || null;
    if (!f) return null;
    return f.model || f.config || f.source || null;
  };
  if (!secondDoc) {
    return { source: 'none', second_judge: null, second_run_key: null, per_metric: {}, total: null, metrics: [] };
  }
  const thisJudgeId = judgeIdentity(runDoc);
  const otherJudgeId = judgeIdentity(secondDoc);
  const otherJudge = judgeOf(secondDoc);
  // The SAME judge scored both runs. That is a REPRODUCIBILITY check, not a
  // second opinion — the re-score dialog prefills the source run's own
  // judge, so this is the DEFAULT re-score. Reporting "a second judge
  // cleared 0 of 67" would attribute the judge's agreement with itself to
  // judge disagreement.
  if (thisJudgeId && otherJudgeId && thisJudgeId === otherJudgeId) {
    return {
      source: 'same-judge',
      second_judge: otherJudge,
      second_run_key: secondDoc._key,
      per_metric: {},
      total: null,
      metrics: []
    };
  }
  // EACH run is judged under the thresholds IT was scored under. The
  // re-score reads the suite's current thresholds; the source run was
  // scored under the thresholds of its day. Applying today's bar to both
  // would judge the sibling against a threshold it never saw. Runs stored
  // before the thresholds were recorded fall back to the suite's.
  const thresholdsOf = (doc) => ({
    ...FAIL_BELOW_DEFAULTS,
    ...((doc.payload && doc.payload.summary && doc.payload.summary.thresholds) ||
      (doc.payload && doc.payload.thresholds) ||
      (suite.payload && suite.payload.thresholds) ||
      {})
  });
  const mineThresholds = thresholdsOf(runDoc);
  const theirsThresholds = thresholdsOf(secondDoc);
  const metrics = (runDoc.metrics || []).filter((m) => (secondDoc.metrics || []).includes(m));
  const secondById = new Map((secondDoc.payload.results || []).map((r) => [r.id, r]));
  // null = not measured, true = failed, false = passed.
  const verdict = (r, m, thresholds) => {
    const v = r.metrics ? r.metrics[m] : null;
    if (typeof v !== 'number' || v !== v) return null;
    const t = thresholds[m];
    if (t === undefined) return null;
    return (m === 'noise_sensitivity' ? v > t : v < t) ? true : false;
  };
  const perMetric = {};
  // The TOTAL counts ROWS, not (row, metric) pairs: a row that failed two
  // metrics is ONE row, and the sentence says "rows".
  const total = { failed_here: 0, cleared: 0, kept_failing: 0, not_measured: 0 };
  for (const r of runDoc.payload.results || []) {
    const other = secondById.get(r.id);
    if (!other) continue;
    // The metrics THIS judge failed this row on.
    const failedHere = metrics.filter((m) => verdict(r, m, mineThresholds) === true);
    if (!failedHere.length) continue;
    total.failed_here += 1;
    // The sibling's verdict on the same metrics.
    const theirs = failedHere.map((m) => verdict(other, m, theirsThresholds));
    // The row is cleared only if the sibling passed EVERY metric this
    // judge failed it on; it kept failing if the sibling failed any of
    // them; otherwise the sibling could not measure the rest.
    let rowState;
    if (theirs.some((t) => t === true)) rowState = 'kept_failing';
    else if (theirs.every((t) => t === false)) rowState = 'cleared';
    else rowState = 'not_measured';
    total[rowState] += 1;
    for (const m of failedHere) {
      const bucket = (perMetric[m] = perMetric[m] || { failed_here: 0, cleared: 0, kept_failing: 0, not_measured: 0 });
      bucket.failed_here += 1;
      const t = verdict(other, m, theirsThresholds);
      if (t === null) bucket.not_measured += 1;
      else if (t === false) bucket.cleared += 1;
      else bucket.kept_failing += 1;
    }
  }
  return {
    source: 'sibling',
    second_judge: otherJudge,
    second_run_key: secondDoc._key,
    per_metric: perMetric,
    total,
    metrics
  };
}

/**
 * The sentence the advisor uses about a second judge — COMPUTED from the
 * sibling run, never asserted. With no sibling there is nothing to say,
 * and saying so is the honest answer: the operator can re-score the run
 * with another judge to find out.
 */
function secondJudgeSentence(comparison, metric) {
  if (!comparison || comparison.source === 'none') {
    return 'No second judge has scored this run yet: re-score it with another judge to find out whether this is judge harshness or a real failure.';
  }
  if (comparison.source === 'same-judge') {
    return (
      `The SAME judge (${comparison.second_judge}) re-scored this run's answers, so this measures judge STABILITY, not a second opinion — ` +
      'it cannot tell judge harshness from a real failure. Re-score it with a DIFFERENT judge to answer that question.'
    );
  }
  const judge = comparison.second_judge || 'the other judge';
  if (metric) {
    // Never fall back to the ALL-metric total under a metric's name: the
    // numbers would be about every metric while the sentence named one.
    const m = comparison.per_metric[metric];
    if (!m) {
      const measured = (comparison.metrics || []).includes(metric);
      return measured
        ? `This judge failed no ${metric} rows, so there is nothing for the other judge to disagree about.`
        : `The second judge (${judge}) did not score ${metric} at all, so there is nothing to compare on that metric.`;
    }
    if (!m.failed_here) {
      return `A second judge (${judge}) scored the same answers but did not fail any of the ${metric} rows this one failed — treat these rows as unproven, and do NOT tighten the prompt, the corpus or a retrieval knob for them.`;
    }
    return (
      `A second judge (${judge}) scored the same answers: it cleared ${m.cleared} of the ${m.failed_here} rows this judge failed on ${metric}` +
      `, and ${m.kept_failing} still failed` +
      (m.not_measured ? ` (${m.not_measured} it could not measure at all)` : '') +
      '. Treat the cleared rows as unproven judge disagreement rather than as judge noise: check the reference answer against the corpus, and do NOT tighten the prompt, the corpus or a retrieval knob for them.'
    );
  }
  const t = comparison.total;
  if (!t || !t.failed_here) {
    return `A second judge (${judge}) scored the same answers but did not fail any of the rows this one failed — treat these rows as unproven, and do NOT tighten the prompt, the corpus or a retrieval knob for them.`;
  }
  return (
    `A second judge (${judge}) scored the same answers: it cleared ${t.cleared} of the ${t.failed_here} rows this judge failed` +
    `, and ${t.kept_failing} still failed` +
    (t.not_measured ? ` (${t.not_measured} it could not measure at all)` : '') +
    '. Treat the cleared rows as unproven judge disagreement rather than as judge noise: check the reference answer against the corpus, and do NOT tighten the prompt, the corpus or a retrieval knob for them.'
  );
}

function attributeFailures(suite, runDoc, evidence, judgeComparison) {
  const thresholds = { ...FAIL_BELOW_DEFAULTS, ...((suite.payload && suite.payload.thresholds) || {}) };
  const entriesById = new Map(suite.payload.entries.map((e) => [e.id, e]));
  const attributions = [];
  for (const r of runDoc.payload.results || []) {
    const e = entriesById.get(r.id) || {};
    if (e.oos) continue;
    const m = r.metrics || {};
    const failed = Object.entries(thresholds)
      .filter(([name, t]) => {
        const v = m[name];
        if (typeof v !== 'number' || v !== v) return false;
        return name === 'noise_sensitivity' ? v > t : v < t;
      })
      .map(([name]) => name);
    // A row that produced NO answer is not scored, so it has no failing
    // metric — but it still needs attribution: it is the row that failed at
    // retrieval or in the answer leg, and that is the first thing the
    // operator must know.
    //
    // Since 2026-10-27 an abstained row is NEVER judged (an abstention is
    // not an answer), so it arrives here with no metrics of its own. Stage
    // it 'abstention' from its own flag — falling through to the
    // unmeasured branch would send the operator to "check the judge
    // endpoint" when the judge never saw the row, and would leave the
    // abstention-contract advice below unreachable on every post-change
    // run. (Old runs that judged their abstentions keep the
    // answer_relevancy-based staging further down.)
    if (r.abstained) {
      const reason = r.abstention_reason || '';
      attributions.push({
        id: r.id,
        query: r.query,
        fails: [],
        stage: 'abstention',
        recommendation:
          'the row abstained' +
          (reason ? ` (reason: "${reason}")` : '') +
          ' — there was no answer to judge. Fix the cause the reason names; if abstentions are widespread the run itself fails as MASS_ABSTENTION with the diagnosis',
        evidence: { abstained: true, abstention_reason: reason, contexts_delivered: (r.contexts || []).length }
      });
      continue;
    }
    //
    // A row that produced an answer and was JUDGED and MEASURED and failed
    // nothing has nothing to say. A row that was handed to the judge and
    // came back with NO metric at all is a different thing — the judge could
    // not measure it — and it was previously dropped here, so the advisor
    // never mentioned it while the coverage said it was unmeasured.
    const measurable = Object.keys(m).some((k) => typeof m[k] === 'number' && m[k] === m[k]);
    if (!failed.length && !r.error && r.answer && measurable) continue;

    // Where the expected passage went — proven against the corpus, not
    // inferred from the run's truncated candidate texts. The ladder only
    // explains a RECALL failure: if recall passed, the passage WAS found,
    // so the failure is downstream and the ladder has nothing to say.
    const ev = evidence && evidence.byRow ? evidence.byRow.get(r.id) : null;
    const serveMode = isServeRun(runDoc);
    // Index-aligned with the evidence builder's carriers: collectEvidence
    // (ragas-attribution-service) drops passages whose norm() is empty, so a
    // whitespace-only entry kept by a bare filter(Boolean) would shift every
    // later carriers[idx]/passages[idx] pair — the serve ladder pairs the
    // two lists BY INDEX and would test the wrong passage's text.
    const rowPassages = (e.reference_passages || []).filter((p) => norm(p));
    const ladder = ev ? retrievalLadder(ev, r, rowPassages, serveMode) : null;
    const recallFailed = failed.includes('context_recall');
    const ladderStage = recallFailed ? ladder && ladder.stage : null;

    let stage;
    let recommendation;
    if (r.ragas_nan) {
      stage = 'judge';
      recommendation =
        'judge failure, not pipeline failure — verify RAGAS_JUDGE_* (reasoning-token budget, non-JSON judge, missing embed model)';
    } else if (r.error) {
      // The row's retrieval leg itself THREW (live 2026-10-23: 4x HTTP 429
      // rate-limit and 2x aborted calls on the shared endpoint — contexts and
      // candidate_keys both empty). This is NOT routing: the repo was
      // published and drained, and "check the repo is published" sent the
      // operator somewhere wrong. The honest stage names the infrastructure,
      // and these rows are exactly the ones that make a run INVALID (the
      // banner counts them), so the recommendation says re-run.
      stage = 'retrieval-error';
      recommendation = `the retrieval call failed before anything was retrieved (${(r.error && (r.error.message || r.error.code)) || 'unknown error'}) — this row has no answer and no score; re-run the benchmark (quieter endpoint or lower run concurrency), it is not a retrieval or content defect`;
    } else if (!r.contexts || !r.contexts.length) {
      stage = 'routing';
      recommendation = 'nothing was retrieved — check the repo is published and its graph drained';
    } else if (ladderStage === 'corpus' || (ladder && ladder.stage === 'corpus')) {
      // The passage is not in the corpus at all. This is a benchmark defect,
      // not a system defect — the assistant cannot retrieve content that
      // was never indexed. Never propose retrieval work for it.
      //
      // The verdict is honoured EVEN WHEN context_recall passed. The ladder
      // proves the passage's absence from the corpus (it was probeable and
      // its content was confirmed missing) — a fact about the corpus, not a
      // judge metric. context_recall passing only says the reference
      // ANSWER's sentences are attributable to whatever was retrieved (other
      // documents may state the same facts); it does not put the expected
      // passage in the corpus. Measured 2026-10-25: 5 rows (new-17, new-29,
      // new-78, new-95, new-96) had ladder=corpus while being staged
      // "judge" or "llm" — so the advisor was told to treat them as judge
      // noise or to tighten the prompt for content the system was never
      // given. Gating the corpus verdict on a recall failure hid exactly
      // the rows the evidence pass was built to find.
      stage = 'corpus';
      recommendation =
        'the expected passage is not in the indexed corpus — this row asks about content the system was never given, so it measures the benchmark, not the assistant. Regenerate this entry against the current corpus; only curate the concept if that content was deliberately removed.';
    } else if (ladderStage === 'vector-recall') {
      stage = 'vector-recall';
      // Serve rows were answered by chatqna's OWN retriever — OKF_RAGAS_CANDIDATE_K
      // only governs the whatif replay, so recommending it for a serve row
      // prescribes a no-op. The rank probe still runs (it says where the
      // passage sat in the OKF replay index — a hint, not the served
      // pipeline's own ranking), but the advice must name the real surface.
      if (serveMode) {
        recommendation = ladder.rank
          ? `the expected passage IS in the corpus but chatqna's served retriever did not deliver it — in the OKF replay index it ranks #${ladder.rank} of ${ladder.searched} (${ladder.caveat}; a hint, not the served pipeline's own ranking). Raise the retriever's candidate count in the chatqna deployment (or rerun this suite in whatif mode to experiment with OKF_RAGAS_CANDIDATE_K), or improve the retrieval query.`
          : `the expected passage IS in the corpus but chatqna's served retriever did not deliver it — raise the retriever's candidate count in the chatqna deployment, or improve the retrieval query.`;
      } else {
        recommendation = ladder.rank
          ? `the expected passage IS in the corpus but the dense top-${CANDIDATE_K} never surfaced it — it ranks #${ladder.rank} of ${ladder.searched}. Raise OKF_RAGAS_CANDIDATE_K to at least ${ladder.rank} (${ladder.caveat}), or improve the retrieval query.`
          : `the expected passage IS in the corpus but the dense top-${CANDIDATE_K} never surfaced it — raise OKF_RAGAS_CANDIDATE_K or improve the retrieval query.`;
      }
    } else if (ladderStage === 'reranker') {
      stage = 'reranker';
      recommendation =
        'the expected passage WAS a retrieval candidate but the reranker cut it — raise RERANKER_TOP_N / OKF_RAGAS_TOP_N or change the rerank strategy';
    } else if (ladderStage === 'retrieved') {
      // The passage reached the answer. Whatever failed is downstream:
      // either the judge scored the coverage harshly, or the passage is
      // only partially covered by the selected chunks. Either way this is
      // NOT a retrieval failure and NOT a content gap.
      stage = 'retrieved';
      recommendation =
        'the expected passage WAS retrieved and delivered to the model — the recall miss is about coverage or the judge, not about finding the content. Inspect the row detail; do not curate content for it.';
    } else if (
      failed.includes('faithfulness') ||
      failed.includes('factual_correctness') ||
      failed.includes('answer_correctness')
    ) {
      // A GROUNDED answer that loses on claim-matching is not a grounding
      // defect (David 2026-10-24: the advisor told us to "tighten grounding"
      // on rows whose answers were verbatim-correct — new-26's "23 mg" was
      // in the context, in the reference AND in the answer, and still scored
      // factual_correctness 0.20). Faithfulness is the metric that says
      // "the answer drifted"; if it PASSED, the answer is grounded and the
      // gap is the judge's claim matching. Only a faithfulness failure
      // licenses the grounding advice.
      const faithPassed =
        typeof m.faithfulness === 'number' &&
        m.faithfulness === m.faithfulness &&
        m.faithfulness >= (thresholds.faithfulness || 0.6);
      // The SERVED evidence can also contradict the judge: chatqna's LLM
      // self-grade says the documents support the answer (the confidence
      // badge the citizen saw) and the related documents came back — while
      // the judge says the claims drift. That disagreement is a JUDGE
      // finding, not a prompt defect.
      const selfHigh =
        typeof r.self_confidence === 'number' && r.self_confidence === r.self_confidence && r.self_confidence >= 0.8;
      const servedGrounded = r.is_grounded === true && Number(r.related_documents || 0) > 0;
      if (faithPassed || (selfHigh && servedGrounded)) {
        stage = 'judge';
        recommendation =
          'the answer IS grounded in the retrieved context (faithfulness ' +
          `${typeof m.faithfulness === 'number' ? m.faithfulness.toFixed(2) : 'n/a'}` +
          (selfHigh ? `, chatqna self-grade ${r.self_confidence.toFixed(2)}` : '') +
          ') — the gap is judge claim-matching, not a prompt defect. ' +
          // The second-judge verdict is COMPUTED from the sibling re-score
          // (same answers, different judge), never asserted. It used to be
          // a hardcoded "disagrees on roughly half of these rows" — true of
          // one offline measurement and a lie for every other run.
          secondJudgeSentence(judgeComparison, 'factual_correctness');
      } else {
        stage = 'llm';
        recommendation =
          'the answer drifts from the retrieved context — tighten CHATQNA_SYSTEM_PROMPT grounding or reassess the model minimums';
      }
    } else if (failed.includes('answer_relevancy') && r.abstained) {
      stage = 'abstention';
      recommendation = 'the model abstained on an answerable query — abstention contract too strict for this entry';
    } else if (failed.includes('answer_relevancy') || failed.includes('answer_similarity')) {
      stage = 'llm';
      recommendation = 'answer shape/language mismatch vs the reference — check prompt specificity and language';
    } else if (
      failed.includes('context_precision') ||
      failed.includes('context_utilization') ||
      failed.includes('noise_sensitivity')
    ) {
      stage = 'reranker';
      recommendation = 'noise ranked above signal — rerank weights/strategy';
    } else if (failed.includes('context_entities_recall') && !failed.includes('context_recall')) {
      // Live 2026-10-19 (chunk-reference verification run): the reference
      // chunk was retrieved VERBATIM (every reference token present, context
      // recall 1.0) and entity recall still scored 0.4–0.5 — the judge's two
      // entity-extraction calls disagree with each other. Attribute to the
      // judge, not the corpus: telling a curator to "enrich entity mentions"
      // for content that was retrieved character-for-character is wasted work.
      stage = 'judge';
      recommendation =
        'context recall passed and the expected passage WAS delivered — yet the reference answer’s entity strings are absent from the retrieved context. ' +
        // The second-judge verdict is COMPUTED from the sibling re-score
        // (same answers, different judge), never asserted — it used to be a
        // hardcoded "reproduces this on most of these rows".
        secondJudgeSentence(judgeComparison, 'context_entities_recall') +
        ' Regenerate the reference answer against the corpus; do NOT tune the RAG, the corpus or a retrieval knob for this row.';
    } else if (failed.includes('context_entities_recall')) {
      stage = 'corpus';
      recommendation = 'key entities of the reference are unretrievable — enrich entity mentions in the concept';
    } else {
      // No metric failed AND no metric could be measured: the row produced
      // no answer at all, so it was never judged (the run judges only the
      // rows that produced an answer). Saying "metric below threshold"
      // would be false — there is no metric and no threshold behind it.
      if (!r.answer) {
        stage = 'answer';
        recommendation =
          'this row produced no answer, so it was never judged — it carries no score and is left out of the averages; re-run the benchmark, and if it keeps happening look at the answer leg for this entry';
      } else if (!measurable) {
        // The row WAS handed to the judge and the judge returned nothing
        // measurable for it. It is not a failure of the pipeline and not a
        // threshold breach — the judge could not measure this row.
        stage = 'unmeasured';
        recommendation =
          'the judge could not measure this row — it came back with no metric at all, so the row carries no score and is left out of the averages. Check the judge endpoint and the metric set; if it keeps happening on the same rows, the judge cannot handle that shape of answer';
      } else {
        stage = 'pipeline';
        recommendation = 'metric below threshold — inspect the row detail';
      }
    }
    attributions.push({
      id: r.id,
      query: r.query,
      fails: failed,
      stage,
      recommendation,
      // The evidence behind the verdict, so a reader can check the call
      // instead of taking it on trust.
      evidence: ladder
        ? {
            passages: ladder.passages,
            probeable_passages: ladder.probeable,
            in_corpus: ladder.inCorpus,
            in_candidates: ladder.inCandidates,
            in_contexts: ladder.inContexts,
            // The SERVED grounding evidence (chatqna's own work): the
            // confidence badge the citizen saw, the LLM self-grade, and the
            // number of related documents that came back with the answer.
            // A row with a high self-grade and related documents is NOT a
            // grounding problem, whatever the judge scored.
            confidence: r.confidence === undefined ? null : r.confidence,
            self_confidence: r.self_confidence === undefined ? null : r.self_confidence,
            is_grounded: r.is_grounded === undefined ? null : r.is_grounded,
            related_documents: r.related_documents === undefined ? null : r.related_documents,
            // Whether the LADDER decided this row's stage. It only does so
            // for a RECALL failure — when recall passed, the passage was
            // effectively found and the metric that failed (precision,
            // faithfulness, ...) explains the row on its own. Without this
            // flag the counts look contradictory: a row can show
            // in_contexts=0 and still be a "reranker" verdict, because the
            // judge credited the content as covered by other chunks.
            ladder_applied: ladderStage != null,
            // WHERE THE EXPECTED PASSAGE ACTUALLY WENT — always, not only
            // when the ladder decided the stage. The ladder is computed for
            // every failing row; without this field its verdict is
            // discarded whenever context_recall passed, and the only
            // remaining signal is the context_recall proxy — which measures
            // whether the reference ANSWER's sentences are attributable to
            // the contexts, NOT whether the expected passage was delivered.
            ladder_stage: ladder.stage || null,
            carrier_chunk: ladder.carrierKey || null,
            candidate_rank: ladder.rank || null,
            corpus_matched_chunks: ev.matched_chunks,
            method: evidence.method
          }
        : null,
      // A row whose expected passage is not in the corpus is an unfair
      // question: it cannot be answered by the system it is measuring.
      unfair_question: !!(ladder && ladder.stage === 'corpus')
    });
  }
  return attributions;
}

/**
 * The configuration adjustment cycle (David 2026-10-27): concrete, per-
 * component ENVIRONMENT changes derived mechanically from the attribution,
 * so a steward can improve the RAGAS scores by configuration — apply, re-run
 * the suite, explain again, iterate.
 *
 * MECHANICAL, deliberately. The advisor LLM proved it cannot hold an output
 * shape reliably (live 2026-10-27: an intermittent object-shape answer was
 * coerced to "[object Object]" and silently lost 4 of 4 advice items), and it
 * violated its own no-knob-change rule on judge-staged rows 3 times out of 5
 * on the granite run. These rules read the SAME evidence the attribution
 * proved — the stage, the failed metrics, and the replay rank the ladder
 * probe observed — so every recommendation is checkable against the explain
 * doc's own attribution rows, and none can contradict them.
 *
 * Every entry carries what the operator needs to ACT: the env var and the
 * value to set, the metrics it targets, WHY the change moves them, the
 * TRADE-OFF (what it costs the other metrics — David: "if there is a trade
 * off between improving any specific metric vs others, then this trade off is
 * to be explained"), how to apply it, and how to verify the effect.
 *
 * Rows staged "corpus" and "judge" get an explicit NO-CHANGE entry — the
 * honest answer for them is benchmark-side work (regenerate the entry, audit
 * the reference answer), and saying so prevents the config-knob hunting the
 * advisor previously prescribed for those rows.
 *
 * @param {object} p
 * @param {Array} p.attributions  attributeFailures rows (stage, fails,
 *   evidence.candidate_rank per row)
 * @param {object} p.runFacts  the run-level facts (rows, abstentions,
 *   mean_answer_chars) — the guard against over-constraining prescriptions
 * @param {string} p.mode  'serve' | 'whatif' — WHICH candidate cut the
 *   measured failure actually passed through. A serve run was answered by
 *   chatqna's own retriever (RETRIEVER_ARANGO_K on chatqna, compose default
 *   20, unknowable from okf-server); a whatif run replayed retrieval inside
 *   okf-server (OKF_RAGAS_CANDIDATE_K — the run's OWN value arrives in
 *   p.candidateK, recorded on the run doc at scoring time). Prescribing the
 *   serve knob for a whatif failure sends the operator to a surface that
 *   never influenced the measured run — the re-run could not improve no
 *   matter what they set.
 * @param {number} [p.candidateK]  the run doc's recorded whatif cut
 *   (fidelity.retrieval.candidate_k); falls back to the module's CANDIDATE_K.
 * @returns {Array} env-change entries
 */
function buildEnvAdvice({ attributions, runFacts, mode, candidateK }) {
  const rows = attributions || [];
  // rows: null, NOT rows.length — the failing-row count is not the run's row
  // count, and R3's headroom argument would be computed from the wrong
  // population.
  const facts = runFacts || { rows: null, abstentions: 0, mean_answer_chars: null };
  const out = [];
  const idsOf = (stage) => rows.filter((r) => r.stage === stage).map((r) => r.id);
  // Production attribution rows carry `fails` (see attributeFailures) — not
  // `failed`. A rule that reads a field the rows never had is a rule that
  // never fires.
  const failedAny = (r, names) => (r.fails || []).some((f) => names.includes(f));
  const isWhatif = mode === 'whatif';
  // The recommendation's headroom formula, named once — R1's target and the
  // escalation filter must agree by construction, not by two copies.
  const withHeadroom = (rank) => Math.ceil(rank * 1.25);

  // ---- R1: the candidate pool is too small for the observed ranks ----------
  // A vector-recall row means the expected passage IS in the index but the
  // operative candidate cut never delivered it. WHICH cut is operative
  // depends on the run's retrieval mode (see @param mode). The replay probe
  // OBSERVED the rank, so the recommendation is a number, not a vibe: K must
  // exceed the deepest observed rank with ~25% headroom, and the fetch pool
  // stays a FLOOR above the candidate cut (a floor, not a target — an
  // operator's deliberately larger hybrid-tuning pool must never be lowered
  // by applying this advice).
  const CUT = isWhatif
    ? {
        env: 'OKF_RAGAS_CANDIDATE_K',
        def: candidateK || CANDIDATE_K,
        surface: 'okf-server (whatif replay)',
        assumed: false
      }
    : {
        env: 'RETRIEVER_ARANGO_K',
        // The run's OWN recorded posture is the declared cut; the fallback
        // default stays labelled as an assumption (runs scored before the
        // posture record existed carry no posture block).
        def: (facts.declared_posture && facts.declared_posture.k) || 20,
        surface:
          "chatqna (the served pipeline — chatqna forwards it in every retriever request; the retriever service's own copy is inert)",
        // No recorded posture → state the assumption in the text instead of
        // asserting it as fact (altitude review, 2026-10-27).
        assumed: !(facts.declared_posture && facts.declared_posture.k)
      };
  const vectorRecall = rows.filter((r) => r.stage === 'vector-recall' && r.evidence && r.evidence.candidate_rank);
  // Derive the deep ROWS first, then project the ranks — one predicate, not
  // two copies that can drift (simplification review, 2026-10-27).
  const deepRows = vectorRecall.filter((r) => r.evidence.candidate_rank > CUT.def);
  if (deepRows.length) {
    const maxRank = Math.max(...deepRows.map((r) => r.evidence.candidate_rank));
    const kTarget = withHeadroom(maxRank);
    const poolChanges = [{ env: CUT.env, to: kTarget, note: `deepest observed rank #${maxRank} + 25% headroom` }];
    if (!isWhatif) {
      poolChanges.push({
        env: 'RETRIEVER_ARANGO_FETCH_K',
        to: `>= ${kTarget + 10}`,
        note: 'FLOOR, not a target — raise it if the deployment runs a larger pool; never lower one'
      });
    }
    out.push({
      id: 'retriever-candidate-pool',
      component: isWhatif ? 'okf-server (benchmark replay)' : 'chatqna (retriever request) + retriever-arango',
      changes: poolChanges,
      rows: deepRows.map((r) => r.id),
      targets: ['context_recall', 'context_entities_recall', 'factual_correctness', 'answer_correctness'],
      why:
        `The expected passage of ${deepRows.length} row(s) IS in the vector index but its replay rank ` +
        `(deepest #${maxRank}) exceeds the operative candidate cut (${CUT.assumed ? 'assumed default ' : ''}${CUT.def}` +
        `${CUT.assumed ? ' — read the live value off the chatqna container' : ''}) — the reranker ` +
        `never saw it, so no downstream tuning can recover it. The cut lives on ${CUT.surface}.`,
      trade_off:
        'A larger pool costs retrieval latency (more vectors fetched and scored) and reranker load ' +
        '(more candidates to score per query). Marginal context_precision/noise_sensitivity risk: more ' +
        'candidates can slip past the reranker as noise. GPU memory is unaffected — this is search ' +
        'depth, not model size. HARD CEILING — the reranker input budget: the whole pool is scored per ' +
        "query under the reranker's per-batch token cap (compose sets --max-batch-tokens 8192; at ~180 " +
        'tokens/chunk that is a ceiling near K=40). A K beyond it makes TEI reject every batch (422) and ' +
        'the deployment mass-abstains — measured live 2026-10-27. Raise the cap on the reranker host ' +
        'FIRST, or keep K under the ceiling.',
      apply: isWhatif
        ? 'Set OKF_RAGAS_CANDIDATE_K on okf-server (compose/env template; under Ansible, group_vars) and ' +
          'recreate okf-server. The replay rank is exact for this mode — the knob you are setting is the ' +
          'knob the measured run used.'
        : 'Set RETRIEVER_ARANGO_K (and the fetch floor) in .env (or the deployment env template), then ' +
          'recreate chatqna (docker compose up -d --force-recreate <chatqna service>; under Ansible, set ' +
          'the vars in group_vars and re-run the deploy tag). The replay rank is a HINT from the OKF ' +
          'replay index, not the served pipeline — treat the change as a hypothesis the re-run confirms.',
      verify:
        'Re-run this suite and compare stage_counts: the vector-recall count should fall. Watch ' +
        'context_precision and noise_sensitivity in the same run — a rise means the extra candidates ' +
        'are arriving as noise and the reranker posture (see the reranker entry) needs tightening.'
    });
    // Escalation: when the K the evidence demands crosses ~100, the net is
    // being widened, not fixed — the honest lever stops being the cut and
    // becomes the index itself. (withHeadroom = 1.25 × rank, so a K target
    // of 100 is rank 80.)
    const ESCALATION_K = 100;
    if (kTarget >= ESCALATION_K) {
      out.push({
        id: 'embedding-escalation',
        component: 'embedding (TEI) + dataprep re-index',
        changes: [
          {
            env: 'EMBEDDING_MODEL_ID',
            to: '<a stronger retrieval embedding model>',
            note: 'LAST RESORT — see trade-off'
          }
        ],
        rows: deepRows.filter((r) => withHeadroom(r.evidence.candidate_rank) >= ESCALATION_K).map((r) => r.id),
        targets: ['context_recall', 'context_entities_recall'],
        why:
          `At least one expected passage ranks #${maxRank} — the query and the passage do not land near ` +
          `each other in the current embedding space. Pushing K that deep retrieves mostly noise; a ` +
          `stronger retrieval embedding closes the distance instead of widening the net.`,
        trade_off:
          'Changing EMBEDDING_MODEL_ID invalidates every existing chunk vector: the FULL corpus must be ' +
          're-indexed (retract + re-ingest through dataprep), embeddings for all repos recompute on the ' +
          "GPU, and answer_relevancy's embedder should move with it for consistency. Hours of GPU time " +
          'and a deployment-wide change — do it only after the K raise provably fails.',
        apply:
          'Only after the K raise fails to recover these rows: set EMBEDDING_MODEL_ID (and the reranker/' +
          'answer embedders consistently), then re-ingest every published repo so vectors rebuild.',
        verify:
          "After re-ingest, re-run the suite; the vector-recall rows' replay ranks should drop below the " +
          'candidate cut. Confirm answer_relevancy did not regress (its embedder changed with it).'
      });
    }
  }

  // ---- R2: the reranker posture — ONE entry, both directions ---------------
  // The ladder semantics decide the direction, and they are NOT symmetric.
  // Stage 'reranker' carries TWO production meanings (attributeFailures
  // stages both paths 'reranker'), and conflating them is an F3-class
  // inversion (repeat review #1, 2026-10-27):
  //   * LADDER gate-cut rows — evidence.ladder_applied true, the per-row
  //     recommendation says "raise RERANKER_TOP_N": the gate CUT the
  //     expected passage — the LOOSEN direction;
  //   * NOISE-path rows — the per-row recommendation says "noise ranked
  //     above signal": the TIGHTEN direction. These are caught by METRIC
  //     (noise_sensitivity/context_precision), whatever their stage.
  // A 'retrieved'-stage row is neither: its expected passage was DELIVERED,
  // so its failure is answer-side (R3) or judge-side (R5), and turning the
  // gate for it would only churn the other rows. Judge/corpus-staged rows
  // are excluded from BOTH directions — the no-change entries own them, and
  // one table cannot tell a row "no configuration change" and "tighten"
  // (repeat review #3). A reranker-staged row failing ONLY
  // context_utilization is the noise path without a tighten metric — it
  // takes NO posture prescription rather than an inverted one; its per-row
  // recommendation already names the lever.
  const tightenRows = rows.filter(
    (r) => failedAny(r, ['noise_sensitivity', 'context_precision']) && r.stage !== 'judge' && r.stage !== 'corpus'
  );
  const loosenRows = rows.filter(
    (r) => r.stage === 'reranker' && r.evidence && r.evidence.ladder_applied && !tightenRows.includes(r)
  );
  if (tightenRows.length || loosenRows.length) {
    const both = tightenRows.length > 0 && loosenRows.length > 0;
    // The three-state posture resolved ONCE (simplification review): changes,
    // targets and why all key off `dir` instead of three synchronized
    // ternary chains.
    const dir = both ? 'both' : loosenRows.length ? 'loosen' : 'tighten';
    // The direction travels as a FIELD, not as prose in the value slot — the
    // UI renders `ENV = to` as a code pair, and an instruction sentence in
    // `to` would read as a config value (altitude review, 2026-10-27).
    const POSTURE = {
      both: [
        {
          env: 'RERANKER_TOP_N',
          direction: 'either',
          note: 'raise for the gate-cut rows; lower for the noise rows — pick ONE, then re-measure'
        },
        {
          env: 'RERANKING_THRESHOLD',
          direction: 'either',
          note: 'lower admits more (gate-cut rows); raise drops weak chunks (noise rows)'
        }
      ],
      loosen: [
        { env: 'RERANKER_TOP_N', direction: 'raise', note: 'the gate must stop cutting the expected passage' },
        { env: 'RERANKING_THRESHOLD', direction: 'lower', note: 'admit chunks the cutoff is dropping' }
      ],
      tighten: [
        { env: 'RERANKER_TOP_N', direction: 'lower', note: 'fewer chunks reach the context' },
        { env: 'RERANKING_THRESHOLD', direction: 'raise', note: 'drop chunks scoring below it' }
      ]
    };
    // Which knobs the run's DECLARED strategy actually reads
    // (genieai_tei_reranker.py:453-559): slice obeys TOP_N; threshold and
    // slice_threshold obey THRESHOLD; adaptive and knee_threshold turn their
    // own gates and read NEITHER — a knob turn under them is dead (David,
    // live 2026-10-27: the advisor prescribed TOP_N/threshold on an adaptive
    // deployment and the operator burned a benchmark cycle discovering it).
    const STRATEGY_KNOBS = {
      slice: ['RERANKER_TOP_N'],
      threshold: ['RERANKING_THRESHOLD'],
      slice_threshold: ['RERANKER_TOP_N', 'RERANKING_THRESHOLD'],
      adaptive: [],
      knee_threshold: []
    };
    const declaredStrategy = (facts.declared_posture && facts.declared_posture.strategy) || null;
    const liveKnobs = declaredStrategy ? STRATEGY_KNOBS[declaredStrategy] || null : null;
    let changes = POSTURE[dir];
    if (liveKnobs && liveKnobs.length === 0) {
      // The active strategy reads NEITHER knob — the honest prescription is
      // the strategy switch itself, never a knob turn that cannot land.
      changes = [
        {
          env: 'RERANKING_STRATEGY',
          direction: 'switch',
          to: 'slice or slice_threshold',
          note:
            `${declaredStrategy} reads neither RERANKER_TOP_N nor RERANKING_THRESHOLD — switching ` +
            'the strategy is the lever; a knob turn under it is dead'
        }
      ];
    } else if (liveKnobs) {
      changes = changes.filter((c) => liveKnobs.includes(c.env));
    }
    const WHY = {
      both: () =>
        `This run fails BOTH ways: ${loosenRows.length} row(s) had the expected passage CUT by the gate ` +
        `(reranker stage — the passage was a candidate the reranker dropped) and ${tightenRows.length} ` +
        `row(s) had noise REACH the context (noise_sensitivity/context_precision failures). The same ` +
        `knob gates both — a looser gate recovers the first and admits more of the second.`,
      loosen: () =>
        `${loosenRows.length} row(s) had the expected passage cut by the reranker — it WAS a candidate ` +
        `and the gate dropped it, so the context never carried it.`,
      tighten: () =>
        `${tightenRows.length} row(s) rank noise above signal — the reranker is the last gate before ` +
        `context assembly and it let weak chunks through.`
    };
    const TARGETS = {
      both: ['noise_sensitivity', 'context_precision', 'context_recall', 'factual_correctness'],
      loosen: ['context_recall', 'factual_correctness'],
      tighten: ['noise_sensitivity', 'context_precision']
    };
    out.push({
      id: 'reranker-posture',
      component: 'chatqna (rerank stage) + reranker service',
      changes,
      rows: [...new Set([...tightenRows, ...loosenRows].map((r) => r.id))],
      targets: TARGETS[dir],
      why:
        (declaredStrategy
          ? `This run declared RERANKING_STRATEGY=${declaredStrategy} — under it ` +
            (liveKnobs && liveKnobs.length
              ? `${liveKnobs.join(' and ')} is the knob that actually bites` +
                (liveKnobs.length === 1 ? '; the other knob below is inert and is not prescribed' : '')
              : 'NEITHER RERANKER_TOP_N nor RERANKING_THRESHOLD bites, so the prescription below is the strategy switch, not a knob turn') +
            '. '
          : '') + WHY[dir](),
      trade_off:
        'THE central completeness-vs-noise trade-off of RAG configuration. Loosening (raise TOP_N / lower ' +
        'threshold) recovers gate-cut passages — context_recall and the facts they carried — but admits ' +
        'more noise: noise_sensitivity and context_precision pay. Tightening buys precision at exactly ' +
        'those completeness costs. Which knob bites depends on RERANKING_STRATEGY: slice obeys ' +
        'RERANKER_TOP_N literally; threshold and slice_threshold obey RERANKING_THRESHOLD; adaptive and ' +
        'knee_threshold turn their own gates and may ignore both — read the strategy first, or the ' +
        'turned knob is dead (a docs defect a previous release fixed; do not reintroduce it by trust). ' +
        'When this entry carries both directions, pick ONE, re-run, and read both metric groups before ' +
        'turning it further.',
      // Deployment-INDEPENDENT on purpose (altitude review, 2026-10-27): this
      // code cannot read chatqna's env, so it states the read-first rule
      // instead of one deployment's live values, which would be a false
      // claim everywhere else and would rot even where it was true.
      apply: declaredStrategy
        ? `This run declared RERANKING_STRATEGY=${declaredStrategy} — ${
            liveKnobs && liveKnobs.length
              ? `turn ${liveKnobs.join(' / ')} in the chosen direction`
              : 'switch RERANKING_STRATEGY to slice or slice_threshold first (under the current strategy no knob turn lands)'
          }, recreate chatqna, and note the old value so the re-run can be compared against a known starting point.`
        : 'Read RERANKING_STRATEGY, RERANKER_TOP_N and RERANKING_THRESHOLD off the chatqna container FIRST ' +
          '(which knob bites depends on the strategy: slice obeys TOP_N literally, threshold/adaptive obey ' +
          'the threshold), turn it in the chosen direction, recreate chatqna, and note the old value so the ' +
          're-run can be compared against a known starting point.',
      verify:
        'Re-run the suite. The turned direction should show fewer of the rows it serves (gate-cut or ' +
        'noise); the OPPOSITE metric group is the price — if it rises more than the first fell, revert: ' +
        'this corpus is at the tension point, not on the wrong side of it.'
    });
  }

  // ---- R3: the grounding contract of the answer leg ------------------------
  const llmRows = rows.filter((r) => r.stage === 'llm' && failedAny(r, ['faithfulness']));
  if (llmRows.length) {
    const abst = facts.abstentions || 0;
    const chars = facts.mean_answer_chars;
    out.push({
      id: 'grounding-prompt',
      component: 'chatqna (answer leg)',
      changes: [
        {
          env: 'CHATQNA_SYSTEM_PROMPT',
          to: '<current deployment prompt> + an attribution clause: "Use only facts stated in the provided context; if an element of the question is not covered by the context, say it is not covered rather than inferring."',
          note: 'the deployment pins its own prompt — extend it, do not replace it'
        }
      ],
      rows: llmRows.map((r) => r.id),
      targets: ['faithfulness', 'factual_correctness'],
      why:
        `${llmRows.length} row(s) drifted from the delivered context (faithfulness failed on an llm-staged ` +
        `row — the model bridged or inferred beyond the chunks). The headroom is measured, not assumed: ` +
        `${abst} abstention(s)${facts.rows ? ` out of ${facts.rows} rows` : ''} and mean answer length ` +
        `${chars == null ? 'unrecorded' : chars.toLocaleString('en-US')} chars ` +
        `— the contract is not over-constraining today, so tightening it has room to land.`,
      trade_off:
        'Grounding clauses suppress inference, which is exactly what multi-part synthesis needs: expect ' +
        'shorter, more hedged answers (brevity/coverage risk) and, if overdone, abstentions on answerable ' +
        'questions — answer_relevancy and coverage pay for faithfulness. This is why the entry is gated ' +
        'on run_facts: with 0 abstentions the run can afford it; a run already abstaining should NOT ' +
        'tighten further (see the abstention entry).',
      apply:
        'Extend CHATQNA_SYSTEM_PROMPT on chatqna (the deployment already pins one — the compose forwards it) ' +
        'and recreate chatqna. Change ONE clause per iteration; a prompt is a config surface with a ' +
        'continuum of settings, not a switch.',
      verify:
        'Re-run the suite: the llm-stage faithfulness failures should fall. Watch the abstention count and ' +
        'mean answer length in run_facts of the NEW run — if abstentions appear or answers shrink ' +
        'materially, the clause over-constrained and should be softened.'
    });
  }

  // ---- R4: the abstention contract -----------------------------------------
  const abstentionRows = rows.filter(
    // Attribution rows carry no `abstained` flag — the stage is where the
    // abstention verdict lives (attributeFailures stages a declined row
    // 'abstention'). Reading r.abstained here would always be undefined.
    (r) => r.stage === 'abstention'
  );
  if (abstentionRows.length && (facts.abstentions || 0) > 0) {
    out.push({
      id: 'abstention-contract',
      component: 'chatqna (answer leg)',
      changes: [
        {
          env: 'CHATQNA_ABSTENTION_INSTRUCTIONS',
          to: '<soften the decline criteria — answer when the context supports any part of the question>',
          note: 'override of the built-in abstention prompt'
        },
        {
          env: 'CHATQNA_ENFORCE_ABSTENTION',
          to: 'keep true',
          note: 'disable the enforcement only as a diagnostic, never as the fix'
        }
      ],
      rows: abstentionRows.map((r) => r.id),
      targets: ['answer_relevancy', 'context_utilization'],
      why:
        `The run abstained on ${facts.abstentions} row(s) and ${abstentionRows.length} of them failed ` +
        `answer_relevancy — the model declined on question(s) the context could have partially answered. ` +
        `That is a COVERAGE loss, not a grounding one.`,
      trade_off:
        'Loosening abstention raises coverage (more answered rows) but admits unsupported answers on ' +
        'questions the context genuinely cannot support — faithfulness and factual_correctness pay, and ' +
        'in a public-sector deployment an unsupported answer costs more than a decline. Loosen toward ' +
        '"answer the supported parts", never toward "always answer".',
      apply:
        'Set CHATQNA_ABSTENTION_INSTRUCTIONS on chatqna with softened decline criteria and recreate it. ' +
        "Keep CHATQNA_ENFORCE_ABSTENTION=true — the enforcement flag is the contract's backbone.",
      verify:
        'Re-run the suite: the abstention stage count should fall while faithfulness holds. If faithfulness ' +
        'failures appear on newly-answered rows, the loosening went too far.'
    });
  }

  // ---- R5: the explicit NO-CHANGE entries ----------------------------------
  const corpusRows = idsOf('corpus');
  if (corpusRows.length) {
    out.push({
      id: 'no-env-change-corpus',
      component: 'benchmark entry (not the pipeline)',
      changes: [],
      rows: corpusRows,
      targets: [],
      why:
        `${corpusRows.length} row(s) ask about content that is not in the indexed corpus at all. NO ` +
        `environment change can retrieve what was never indexed — this row measures the benchmark, not ` +
        `the assistant.`,
      trade_off:
        'None applies: the honest action is benchmark-side. Regenerate the entry against the current ' +
        'corpus; only author the missing concept if that content was deliberately removed and is wanted.',
      apply: 'No configuration change. Regenerate this suite entry (the row operation exists on the panel).',
      verify:
        'After regeneration, the row should retrieve its own reference passage; its stage on the next explain should not be corpus.'
    });
  }
  const judgeRows = idsOf('judge');
  if (judgeRows.length) {
    out.push({
      id: 'no-env-change-judge',
      component: 'benchmark entry (not the pipeline)',
      changes: [],
      rows: judgeRows,
      targets: [],
      why:
        `${judgeRows.length} row(s) failed on metric-side findings — the answer IS grounded in the ` +
        `delivered context (faithfulness passed) and the failure lives in the judge's claim or entity ` +
        `matching. Tuning any environment variable for these rows optimises the pipeline against a ` +
        `judge artefact, not against the citizen's experience.`,
      trade_off:
        'Applying a knob here trades real pipeline quality for a score: any change that moves these rows ' +
        'would move them by perturbing behaviour the grounded rows depend on. The honest lever is the ' +
        'reference answer (audit it against the corpus, regenerate the entry), not the configuration.',
      apply:
        'No configuration change. Audit the reference answers of these rows against the corpus; regenerate entries whose references drifted.',
      verify:
        'After the reference audit/regeneration, re-run: these rows should pass or move to a pipeline stage. If they stay judge-staged across a regenerated reference AND a second judge agrees, the metric itself is the finding.'
    });
  }

  return out;
}

/**
 * Walk the evidence ladder for one row and report where the expected
 * passage was lost. `r` is the run row (it carries the candidate_keys and
 * context_keys the run actually used).
 */
function retrievalLadder(ev, r, passages, serveMode) {
  const candidateKeys = new Set(r.candidate_keys || []);
  const contextKeys = new Set(r.context_keys || []);
  // Serve rows: the delivered tier is decided by text containment, because
  // chatqna speaks in document ids, not chunk keys.
  const ctxNorms = serveMode ? (r.contexts || []).map(norm) : null;
  let inCorpus = 0;
  let inCandidates = 0;
  let inContexts = 0;
  let probeable = 0;
  let carrierKey = null;
  (ev.carriers || []).forEach((c, idx) => {
    if (!c.probeable) return;
    probeable += 1;
    // Only a passage PROVEN present in the corpus counts — a passage that
    // matched a needle but whose content is absent is not in the corpus.
    if (!c.present) return;
    inCorpus += 1;
    if (serveMode) {
      // The served pipeline's only visible pool IS the delivered set: a
      // passage that arrived was past every earlier tier of that pipeline;
      // one that did not is a serving-retrieval miss (the rank probe says
      // where it sat). The reranker tier is not observable from outside
      // chatqna and never fires in serve mode.
      if (passageInContexts(passages ? passages[idx] : null, ctxNorms)) {
        inCandidates += 1;
        inContexts += 1;
      }
      return;
    }
    // A passage counts as "in a tier" when ANY chunk carrying it is in
    // that tier — the passage may span several chunks.
    const hits = c.chunks.filter((ch) => candidateKeys.has(ch.key));
    if (hits.length) {
      inCandidates += 1;
      carrierKey = carrierKey || hits[0].key;
      if (hits.some((ch) => contextKeys.has(ch.key))) inContexts += 1;
    }
  });
  const total = ev.passages || 0;
  let stage;
  if (total === 0) stage = null;
  // A row whose passages could not be probed is UNPROVEN, not proven
  // absent — it must never be reported as a corpus gap.
  else if (probeable === 0) stage = 'unproven';
  else if (inCorpus === 0) stage = 'corpus';
  else if (inCandidates === 0) stage = 'vector-recall';
  else if (inContexts === 0) stage = 'reranker';
  else stage = 'retrieved';
  // The rank probe (when it ran) says where the carrier WOULD have landed
  // in the dense ranking — the actionable number for a vector-recall miss.
  const rank = ev.rank && ev.rank_owner === r.id ? ev.rank : null;
  return {
    stage,
    passages: total,
    probeable,
    inCorpus,
    inCandidates,
    inContexts,
    carrierKey,
    rank: rank ? rank.rank : null,
    searched: rank ? rank.searched : null,
    caveat: rank ? rank.caveat : null
  };
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Verbatim containment of a passage inside the SERVED contexts.
 *
 * Serve rows record chatqna's document ids, not graph chunk keys, so the
 * delivered tier cannot be decided by key membership. Containment is decided
 * by two 8-word needles per passage (start and middle): if either appears
 * verbatim in a served context, the model saw content carrying the passage.
 * A context need only contain ONE needle — chunks are cut mid-passage all
 * the time, and demanding both would miss exactly the boundary case.
 */
function passageInContexts(passage, ctxNorms) {
  if (!passage || !ctxNorms || !ctxNorms.length) return false;
  const words = norm(passage).split(' ').filter(Boolean);
  if (words.length < 4) return false;
  const needles = [];
  if (words.length <= 8) {
    needles.push(words.join(' '));
  } else {
    needles.push(words.slice(0, 8).join(' '));
    const mid = Math.max(1, Math.floor(words.length / 2) - 4);
    needles.push(words.slice(mid, mid + 8).join(' '));
  }
  return ctxNorms.some((ctx) => needles.some((n) => ctx.includes(n)));
}

/**
 * Collect the retrieval evidence for the rows that failed, then rank-probe
 * the ones where the DENSE stage was the culprit.
 *
 * The rank probe is what makes the recommendation actionable: "the dense
 * top-24 missed it" becomes "it ranks #26 of 1075 — raise
 * OKF_RAGAS_CANDIDATE_K to 26+". It re-embeds the query and searches
 * deeper than the run did, so it is best-effort: a failure leaves the
 * stage standing and only the rank missing.
 */
async function collectAttributionEvidence(db, suite, runDoc) {
  const entriesById = new Map(
    (suite.payload && suite.payload.entries ? suite.payload.entries : []).map((e) => [e.id, e])
  );
  const thresholds = { ...FAIL_BELOW_DEFAULTS, ...((suite.payload && suite.payload.thresholds) || {}) };
  const failing = [];
  for (const r of runDoc.payload.results || []) {
    const e = entriesById.get(r.id) || {};
    if (e.oos) continue;
    const m = r.metrics || {};
    const failed = Object.entries(thresholds).some(([name, t]) => {
      const v = m[name];
      if (typeof v !== 'number' || v !== v) return false;
      return name === 'noise_sensitivity' ? v > t : v < t;
    });
    if (!failed) continue;
    failing.push({
      id: r.id,
      query: r.query,
      passages: (e.reference_passages || []).filter(Boolean)
    });
  }
  if (!failing.length) {
    return { byRow: new Map(), method: 'no failing rows', truncated: false, matched_chunks: 0 };
  }

  // The graphs the RUN used — not the ones the repo has now. A repo
  // re-drained between generation and this run would otherwise be probed
  // against a corpus the run never saw.
  const graphs =
    (runDoc.payload &&
    runDoc.payload.fidelity &&
    runDoc.payload.fidelity.retrieval &&
    Array.isArray(runDoc.payload.fidelity.retrieval.graphs) &&
    runDoc.payload.fidelity.retrieval.graphs.length
      ? runDoc.payload.fidelity.retrieval.graphs
      : null) || (await graphNamesFor(db, suite.repo_ids || [suite.repo_id]));

  const evidence = await ragasAttributionService.collectEvidence(db, { rows: failing, graphs });
  if (evidence.truncated) {
    logger.warn('ragas attribution: corpus probe hit its chunk guard — carrier coverage may be incomplete', {
      suite_key: suite.suite_key,
      matched_chunks: evidence.matched_chunks
    });
  }

  // Rank-probe the rows where the dense stage lost the passage: the rank
  // is the actionable half of "the vector search missed it".
  const serveMode = isServeRun(runDoc);
  for (const row of failing) {
    const ev = evidence.byRow.get(row.id);
    if (!ev) continue;
    // Only passages PROVEN present in the corpus have a meaningful rank.
    const present = (ev.carriers || []).filter((c) => c.present);
    if (!present.length) continue;
    const runRow = runDoc.payload.results.find((r) => r.id === row.id) || {};
    let lost;
    if (serveMode) {
      // Serve rows: probe when the SERVED set did not deliver the passage
      // (text containment — the doc ids chatqna returns are not chunk keys).
      const ctxNorms = (runRow.contexts || []).map(norm);
      const delivered = (row.passages || []).some((p) => passageInContexts(p, ctxNorms));
      if (delivered) continue;
      lost = present.flatMap((c) => c.chunks)[0];
    } else {
      const candidateKeys = new Set(runRow.candidate_keys || []);
      // Only probe rows the dense stage actually lost — a passage that WAS a
      // candidate was lost by the reranker, and the candidate rank is noise.
      lost = present.flatMap((c) => c.chunks).find((ch) => !candidateKeys.has(ch.key));
    }
    if (!lost) continue;
    const rank = await ragasAttributionService.probeCandidateRank(db, {
      graphs,
      query: row.query,
      carrierKey: lost.key
    });
    if (rank) {
      ev.rank = rank;
      ev.rank_owner = row.id;
    }
  }
  // The rank belongs to the row that owns it; attributeFailures reads it
  // from the evidence row, so carry it into the ladder there.
  return evidence;
}

/**
 * Pack the attributions the advisor will read.
 *
 * The payload used to be capped at 40 rows while a run can attribute 100+,
 * so the advisor saw a third of the failures and said so itself. It now
 * packs as many rows as fit a character budget and NAMES the rows that did
 * not — a silent cap is the thing that made the advisor's advice
 * unverifiable.
 *
 * Each row is sent SLIMMED to what the advisor reasons over (the stage, the
 * failing metrics, the evidence COUNTS and a shortened recommendation). The
 * full row — including the matched passage texts — stays in the explain doc
 * for the panel. Measured on a 100-row run: 87 KB full, 40 KB slimmed, so
 * every attributed row fits comfortably.
 */
function packAttributions(attributions, budget = 120000) {
  const slim = (a) => ({
    id: a.id,
    stage: a.stage,
    fails: a.fails || [],
    unfair_question: a.unfair_question,
    query: String(a.query || '').slice(0, 200),
    recommendation: String(a.recommendation || '').slice(0, 240),
    evidence: a.evidence
      ? {
          passages: (a.evidence.passages || []).length,
          in_corpus: a.evidence.in_corpus,
          in_candidates: a.evidence.in_candidates,
          in_contexts: a.evidence.in_contexts,
          ladder_stage: a.evidence.ladder_stage,
          candidate_rank: a.evidence.candidate_rank,
          carrier_chunk: a.evidence.carrier_chunk
        }
      : null
  });
  const included = [];
  const omitted = [];
  let used = 0;
  for (const a of attributions) {
    const row = slim(a);
    const size = JSON.stringify(row).length;
    if (used + size > budget) {
      omitted.push({ id: a.id, stage: a.stage, fails: a.fails || [] });
      continue;
    }
    included.push(row);
    used += size;
  }
  return { included, omitted, bytes: used };
}

async function explainFailures(repoId, suiteKey, runKey, opts = {}) {
  return withSpan('okf.ragas.explain', async (span) => {
    span.setAttribute('okf.repo_id', repoId);
    const db = await dbService.getConnection();
    await ensureCollection(db);
    const suite = await loadSuite(db, repoId, suiteKey);
    const runDoc = await loadDoc(db, runKey, 'RUN_NOT_FOUND', `run ${runKey}`);
    if (runDoc.repo_id !== repoId || runDoc.suite_key !== suiteKey || runDoc.kind !== 'ragas_run') {
      const err = new Error(`run ${runKey} not found for suite ${suiteKey}`);
      err.code = 'RUN_NOT_FOUND';
      err.status = 404;
      throw err;
    }
    // The evidence pass (Story 8-6, 2026-10-23): prove WHERE each expected
    // passage went, against the corpus itself, before blaming any tier.
    // This is what stops a content-curation instruction for content that is
    // already indexed — the advisor's most expensive mistake.
    explainProgress.set(suiteKey, { phase: 'probing', started_ms: Date.now(), failing: 0 });
    const evidence = await collectAttributionEvidence(db, suite, runDoc);
    // The second judge, if one exists: the re-score of this run (or the run
    // it re-scored) scored the SAME answers with a different judge, so its
    // per-row verdicts can be compared row by row. This is what the advisor
    // used to ASSERT from a hardcoded string.
    const secondJudgeRun = await loadSecondJudgeRun(db, repoId, suiteKey, runKey, runDoc);
    const judgeComparison = compareJudges(suite, runDoc, secondJudgeRun);
    const attributions = attributeFailures(suite, runDoc, evidence, judgeComparison);
    explainProgress.set(suiteKey, { phase: 'advising', started_ms: Date.now(), failing: attributions.length });
    // The run-level facts the advisor must read before it prescribes anything
    // (David 2026-10-24): how many rows abstained and how long the answers
    // are. Without these it prescribed "tighten grounding" on a run that was
    // already over-constraining the model. They are computed HERE, once, and
    // stored on the explain doc as well as sent to the advisor: the advice
    // cites them ("run_facts show 0 abstentions and mean_answer_chars of
    // 717"), so the reader has to be able to check them.
    // The retrieval mode decides WHICH candidate cut the env advice names
    // (serve → chatqna's RETRIEVER_ARANGO_K, whatif → OKF_RAGAS_CANDIDATE_K).
    const serveMode = isServeRun(runDoc);
    // The run's OWN whatif cut, recorded at scoring time — the env advice
    // prescribes headroom over the cut that ACTUALLY gated this run, not
    // over a hardcoded default that an override would falsify (altitude
    // review, 2026-10-27).
    const runCandidateK =
      runDoc.payload && runDoc.payload.fidelity && runDoc.payload.fidelity.retrieval
        ? runDoc.payload.fidelity.retrieval.candidate_k || CANDIDATE_K
        : CANDIDATE_K;
    const runFacts = {
      rows: (runDoc.payload.results || []).length,
      abstentions: (runDoc.payload.results || []).filter((r) => r.abstained).length,
      mean_answer_chars: Math.round(
        (runDoc.payload.results || []).reduce((a, r) => a + String(r.answer || '').length, 0) /
          Math.max(1, (runDoc.payload.results || []).length)
      ),
      abstained_rows: (runDoc.payload.results || [])
        .filter((r) => r.abstained)
        .map((r) => r.id)
        .slice(0, 20),
      // The DECLARED retrieval posture the run recorded — R1 prescribes
      // against the cut the deployment actually declared, not against an
      // assumed default (2026-10-27: the advice said "assumed default 20"
      // on a doc whose run had recorded k=54).
      declared_posture:
        (runDoc.payload &&
          runDoc.payload.fidelity &&
          runDoc.payload.fidelity.retrieval &&
          runDoc.payload.fidelity.retrieval.posture) ||
        null,
      stage_counts: attributions.reduce((acc, a) => {
        acc[a.stage] = (acc[a.stage] || 0) + 1;
        return acc;
      }, {}),
      // The second judge's verdict, COMPUTED — the advisor may cite it, and
      // the reader can check it against the sibling run.
      judge_comparison: judgeComparison
    };
    try {
      // The configuration adjustment cycle (David 2026-10-27): concrete env
      // changes generated MECHANICALLY from the attribution — never by the
      // LLM, which cannot hold a shape and once prescribed retrieval knobs
      // for judge-staged rows. Computed ONCE here and re-attached after the
      // LLM success path below REPLACES the advice object — without that
      // re-attach, the section would appear only on runs where the advisor
      // FAILED (2026-10-27 review F1), the exact inverse of the guarantee.
      const envChanges = buildEnvAdvice({
        attributions,
        runFacts,
        mode: serveMode ? 'serve' : 'whatif',
        candidateK: runCandidateK
      });
      // ONE guided-JSON advice call; tag suggestions pass the existing guardrail.
      let advice = {
        source: 'none',
        note: 'no LLM advice (attribution only)',
        knob_changes: [],
        repo_tag_changes: [],
        content_curation: [],
        prompt_tweaks: [],
        // Present even when the LLM call fails, so the operator always has
        // the config lever the evidence supports.
        env_changes: envChanges
      };
      if (attributions.length) {
        try {
          // Resolve the advisor's model ONCE: the run's own judge when it was
          // picked (so the advice comes from the model that produced the
          // scores), else the env judge (explicit null). David 2026-10-24:
          // the advisor silently failed with "advice failed" because it rode
          // the ACTIVE config — GLM on api.z.ai, rate-limited, three 429s.
          const runJudge = (runDoc.payload.fidelity && runDoc.payload.fidelity.judge) || null;
          const runPick = runJudge && runJudge.pick ? runJudge.pick : null;
          let advisorConfig = null;
          if (runPick && runPick.config_key) {
            const resolved = await modelConfigService.resolveModelOverride({
              config_key: runPick.config_key,
              model: runPick.model || undefined,
              service: 'ragas_judge'
            });
            if (resolved) advisorConfig = resolved;
          }
          const ADVISOR_SYSTEM_PROMPT =
            'You are a RAG pipeline tuning advisor. Given benchmark failures with stage attributions, ' +
            'propose concrete actions. Respond as JSON: {"knob_changes": ["..."], "repo_tag_changes": ["..."], ' +
            '"content_curation": [{"concept": "...", "gap": "..."}], "prompt_tweaks": ["..."]}. ' +
            'Every item must name the surface it changes. Do not invent failures. ' +
            // The stage is proven against the corpus, and the advisor
            // must respect it: a stage of "vector-recall" or "reranker"
            // means the content EXISTS and the retrieval pipeline lost
            // it — the answer is a knob (candidate pool, top-N), never
            // new content. A stage of "corpus" means the expected
            // passage is not indexed at all: that row is an unfair
            // question (it measures the benchmark, not the assistant),
            // so the action is to regenerate the entry, not to author
            // content for it. Only propose content_curation for rows
            // whose stage is "corpus".
            'Propose content_curation ONLY for rows whose stage is "corpus"; ' +
            'for "vector-recall" and "reranker" propose a knob change instead. ' +
            // David 2026-10-24: the advisor prescribed "tighten
            // CHATQNA_SYSTEM_PROMPT grounding" on ~30 rows of a run
            // whose answers were already grounded, and never saw that
            // the prompt had pushed abstentions up and answers 44%
            // shorter. The run-level facts are in the payload below —
            // READ them before prescribing anything.
            'RULES: ' +
            // Rule (1) said "say it needs a stronger judge to confirm". That
            // is how the advisor told David to dismiss ~30 rows that a
            // second judge had ALREADY reproduced on (2026-10-25). The rows
            // are unproven, not dismissed: the lever is the reference
            // answer, never the RAG.
            '(1) A row with stage "judge" means the answer is grounded in the delivered context and the failure is a metric-side finding. ' +
            'Do NOT propose a prompt tweak, a content change or a knob change for it; say the reference answer must be checked against the corpus. ' +
            'Do NOT call it judge noise — the second judge (see run_facts.judge_comparison) cleared part of these rows, so they are unproven rather than dismissed. ' +
            '(2) A row with stage "abstention" means the model declined — the abstention contract may be too strict; that is a COVERAGE argument, not a grounding one. ' +
            '(3) Only rows staged "llm" justify a grounding change, and only when their faithfulness actually failed. ' +
            '(4) Check run_facts.abstentions against run_facts.rows: if a large share of rows abstained, the prompt is OVER-CONSTRAINING — ' +
            'recommend restoring coverage (answer every part the context supports, keep the facts) instead of tightening grounding. ' +
            '(5) Check run_facts.mean_answer_chars: if answers are very short, completeness is being lost — recommend coverage, not brevity. ' +
            '(6) Every prompt_tweak must name the rows it is based on and the evidence behind them. ' +
            // David 2026-10-25: a judge that could not score a metric on
            // most rows "reproduced" the low score on the few it did
            // score — which read as confirmation. A metric the judge did
            // not score on a row says NOTHING about that row.
            '(7) Check summary.coverage: a metric scored on fewer rows than the run has is UNMEASURED on the rest. ' +
            'Never prescribe a change for a row whose metric the judge did not score — say the metric was not measured. ' +
            // The advisor named the rows it could not see (46 of 86 on one
            // run) and asked for them to be marked. Say so instead.
            '(8) If attributions_omitted is not empty, say how many failing rows had no stage attribution in the payload and ' +
            'prescribe nothing for them — their stage is unknown, not benign. ' +
            // The second judge's verdict is computed from the sibling
            // re-score — the advisor must not assert one of its own.
            '(9) Use run_facts.judge_comparison for the second judge: if its source is "none", NO second judge has scored this run, ' +
            'so say the row is unproven and that re-scoring with another judge would settle it. If its source is "sibling", ' +
            'quote its cleared/kept_failing counts and never assert a proportion you were not given. ' +
            // David 2026-10-27: the env changes are GENERATED from the
            // attribution, mechanically, and attached to the advice outside
            // this prompt. The advisor once prescribed retrieval knobs for 25
            // judge-staged rows (rule-1 violation) and cannot hold an output
            // shape reliably — it never touches this section. The rule does
            // NOT claim the payload carries them (it does not — review F7):
            // a model told "you were shown X" when it was not may invent X.
            '(10) Environment-change recommendations are generated by the system from the attribution and ' +
            'attached separately; you are NOT shown them and must NOT produce any. Do not emit environment ' +
            'variables, knob names or configuration values in any of your four lists — your advice covers ' +
            'the non-configuration surfaces (reference answers, benchmark entries, curation) that the ' +
            'mechanical rules cannot see.';
          const advisorAttributions = packAttributions(attributions);
          const advisorUserPayload = JSON.stringify({
            repo: suite.name,
            metrics: runDoc.metrics,
            summary: runDoc.payload.summary,
            // The run-level facts the advisor must read before it
            // prescribes anything (David 2026-10-24): how many rows
            // abstained and how long the answers are. Without these it
            // prescribed "tighten grounding" on a run that was already
            // over-constraining the model.
            run_facts: runFacts,
            // EVERY attributed row, or a named account of what did not fit.
            // The payload used to cap at 40 attributions while the run had
            // 86, so 46 rows reached the advisor with NO evidence — and the
            // advisor said so itself ("46 summary-listed failures from
            // new-53 through new-100 for which no row-level stage
            // attribution appears in the supplied payload"). The operator
            // would have seen failures with no advice and no explanation.
            attributions: advisorAttributions.included,
            // What did not fit, named — never a silent cap.
            attributions_omitted: advisorAttributions.omitted
          });
          const resp = await frontmatterService
            .vllmChatCompletions(
              [
                {
                  role: 'system',
                  content: ADVISOR_SYSTEM_PROMPT
                },
                {
                  role: 'user',
                  content: advisorUserPayload
                }
              ],
              // The advisor rides the RUN's judge (David 2026-10-24): it must
              // interpret the scores with the model that produced them — and
              // that also keeps it off the rate-limited ACTIVE config, which
              // silently returned "advice failed" after three 429s. An explicit
              // null means "use the env judge".
              { maxTokens: 1200, temperature: 0.2, service: 'ragas_judge', config: advisorConfig }
            )
            .catch(async (primaryErr) => {
              // The run's judge is rate-limited or down → fall back to the env
              // judge so the operator still gets advice.
              logger.warn('ragas-suite.advisor_judge_fallback', {
                suite_key: suiteKey,
                run_key: runKey,
                error: primaryErr && primaryErr.message
              });
              return frontmatterService.vllmChatCompletions(
                [
                  { role: 'system', content: ADVISOR_SYSTEM_PROMPT },
                  { role: 'user', content: advisorUserPayload }
                ],
                { maxTokens: 1200, temperature: 0.2, service: 'ragas_judge', config: null }
              );
            });
          const content =
            resp && resp.data && resp.data.choices && resp.data.choices[0] && resp.data.choices[0].message
              ? resp.data.choices[0].message.content
              : null;
          const match = content && typeof content === 'string' ? content.match(/\{[\s\S]*\}/) : null;
          if (match) {
            const parsed = JSON.parse(match[0]);
            // SPREAD, not replace: `env_changes` is owned by the initializer
            // above and survives every advisor outcome by construction —
            // the earlier re-attach-per-branch shape was exactly how a
            // silent drop would be re-introduced (review F1 + altitude
            // review #6, 2026-10-27).
            const llmAdvice = {
              source: 'llm',
              knob_changes: arr(parsed.knob_changes),
              repo_tag_changes: arr(parsed.repo_tag_changes),
              content_curation: Array.isArray(parsed.content_curation)
                ? parsed.content_curation
                    .slice(0, 20)
                    .map((c) => ({ concept: String(c.concept || ''), gap: String(c.gap || '') }))
                : [],
              prompt_tweaks: arr(parsed.prompt_tweaks),
              note: ''
            };
            // The knob GUARD is mechanical, not a prompt instruction — the
            // same house principle as the content-curation guard below
            // (altitude review #4, 2026-10-27): the advisor was told (rule
            // 10) not to emit configuration values and violated its own
            // stage rules 3 times out of 5 on the granite run, so an
            // instruction is not a control. An LLM item that names a
            // deployment env knob is DROPPED and the drop is counted into
            // the note — it would contradict the mechanical env_changes
            // table sitting next to it. The pattern is a GENERIC
            // SCREAMING_SNAKE token (≥2 underscore-separated uppercase
            // segments), not a prefix list — rule 10 forbids ALL environment
            // names, and a prefix list rots with every new var (repeat
            // review #5). A negated mention ("X is fine as-is") is dropped
            // too: conservative by design, and the note says so.
            const KNOB_TOKEN = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/;
            let droppedKnobs = 0;
            for (const key of ['knob_changes', 'prompt_tweaks']) {
              const before = llmAdvice[key].length;
              llmAdvice[key] = llmAdvice[key].filter((item) => !KNOB_TOKEN.test(item));
              droppedKnobs += before - llmAdvice[key].length;
            }
            if (droppedKnobs) {
              llmAdvice.note =
                `dropped ${droppedKnobs} advice item(s) that named environment knobs — ` +
                'configuration changes are generated mechanically in the Environment changes table';
            }
            advice = { ...advice, ...llmAdvice };
            // Guard the content-curation suggestions against the proven
            // evidence (2026-10-23). A curator is asked to WRITE content, so
            // this is the expensive kind of advice: sending someone to
            // author a passage that is already indexed is pure waste — and
            // the pre-fix matrix did exactly that for 18 of 29 rows.
            //
            // The guard is MECHANICAL, not a prompt instruction:
            //   * no row was PROVEN to have a corpus gap -> the advisor has
            //     no licence to propose content work at all;
            //   * a proposal that names a row whose stage is NOT "corpus" is
            //     dropped, because it is proposing content for a retrieval
            //     failure — where the content demonstrably exists.
            // The advisor writes about concepts, not row ids, so a proposal
            // is not REQUIRED to name a row.
            const corpusGapRows = attributions.filter((a) => a.stage === 'corpus' && a.unfair_question);
            const nonCorpusRows = attributions.filter((a) => a.stage !== 'corpus');
            const kept = [];
            const dropped = [];
            for (const item of advice.content_curation) {
              const text = `${item.concept} ${item.gap}`.toLowerCase();
              const namesNonCorpusRow = nonCorpusRows.some((a) => {
                const id = String(a.id || '').toLowerCase();
                const q = String(a.query || '')
                  .toLowerCase()
                  .slice(0, 40);
                return (id && text.includes(id)) || (q.length > 12 && text.includes(q));
              });
              if (namesNonCorpusRow) {
                dropped.push(`${item.concept} — ${item.gap}`);
                continue;
              }
              if (!corpusGapRows.length) {
                dropped.push(`${item.concept} — ${item.gap}`);
                continue;
              }
              kept.push(item);
            }
            advice.content_curation = kept;
            if (dropped.length) {
              advice.rejected_curation = dropped.map((d) => `${d} — no proven corpus gap behind it`);
              // COMPOSE, not overwrite — the knob guard may have set a note
              // already, and silently eating its drop count defeats the
              // "says so" guarantee (repeat review #4, 2026-10-27).
              advice.note = [
                advice.note,
                `dropped ${dropped.length} content-curation suggestion(s) that no proven corpus gap supports`
              ]
                .filter(Boolean)
                .join('; ');
            }
          }
        } catch (e) {
          advice.note = `LLM advice failed (${e.message}) — mechanical attribution stands`;
        }
      }
      // Guard the tag suggestions through the existing machinery.
      explainProgress.set(suiteKey, { phase: 'guarding', started_ms: Date.now(), failing: attributions.length });
      if (advice.repo_tag_changes.length) {
        try {
          const guarded = await headTestService.guardSuggestions(repoId, advice.repo_tag_changes.slice(0, 10), {
            positiveQueries: suite.payload.entries.filter((e) => !e.oos).map((e) => e.query)
          });
          advice.repo_tag_changes = guarded.accepted || [];
          advice.rejected_tags = (guarded.rejected || []).map((r) => `${r.tag} — ${r.reason}`);
        } catch (e) {
          advice.rejected_tags = [`guardrail unavailable (${e.message}) — treat tag suggestions as unvetted`];
        }
      }

      const doc = {
        _key: opts.explainKey,
        repo_id: repoId,
        kind: 'ragas_explain',
        suite_key: suiteKey,
        created_at: new Date().toISOString(),
        created_by: (opts.actor && opts.actor.user_id) || 'system',
        payload: {
          run_key: runKey,
          run_created_at: runDoc.created_at,
          failing_count: attributions.length,
          // Rows whose expected passage is not in the indexed corpus. These
          // are UNFAIR QUESTIONS: the system cannot answer content it was
          // never given, so they measure the benchmark, not the assistant.
          // They are counted separately so an operator can tell a real
          // regression from a stale benchmark entry.
          unfair_count: attributions.filter((a) => a.unfair_question).length,
          unfair_ids: attributions.filter((a) => a.unfair_question).map((a) => a.id),
          // The stage histogram — the one number that says whether the
          // pipeline or the corpus is at fault.
          stage_counts: attributions.reduce((acc, a) => {
            acc[a.stage] = (acc[a.stage] || 0) + 1;
            return acc;
          }, {}),
          // The facts the advice CITES. Without them stored here, the advice
          // says "run_facts show 0 abstentions and mean_answer_chars of 717"
          // and the reader has no way to check either number.
          run_facts: runFacts,
          attributions,
          advice
        }
      };
      await db.collection(COLLECTION).save(doc);
      span.setAttribute('okf.ragas.failing', attributions.length);
      span.setAttribute('okf.ragas.unfair', attributions.filter((a) => a.unfair_question).length);
      return doc;
    } finally {
      explainProgress.delete(suiteKey);
    }
  });
}

function arr(v) {
  return Array.isArray(v) ? v.map((x) => String(x)).slice(0, 20) : [];
}

// ---------- xlsx passthrough ----------------------------------------------

async function exportSuiteXlsx(repoId, suiteKey) {
  const suite = await getSuite(repoId, suiteKey);
  // A generating or failed suite has no payload (getSuite returns the
  // envelope) — exporting it dereferenced undefined and answered a raw 500
  // (2026-10-21 review F14). Say what is wrong instead.
  if (!suite.payload || !Array.isArray(suite.payload.entries)) {
    const err = new Error(
      suite.status === 'generating'
        ? 'the suite is still generating — export it once generation finishes'
        : 'the suite has no exportable content'
    );
    err.code = 'SUITE_NOT_EXPORTABLE';
    err.status = 409;
    throw err;
  }
  const resp = await sidecar('/xlsx/export-suite', {
    json: { name: suite.name || 'benchmark-suite', entries: suite.payload.entries }
  });
  return {
    body: Buffer.from(await resp.arrayBuffer()),
    filename: `${String(suite.name || 'benchmark-suite')
      .replace(/[^\w.-]+/g, '_')
      .slice(0, 60)}.xlsx`
  };
}

async function importSuiteXlsx(repoId, bytes, opts = {}) {
  return withSpan('okf.ragas.import_suite', async (span) => {
    span.setAttribute('okf.repo_id', repoId);
    const resp = await sidecar('/xlsx/import-suite', { body: bytes, contentType: 'application/octet-stream' });
    const parsed = await resp.json();
    const entries = (parsed.entries || []).slice(0, MAX_ENTRIES);
    if (!entries.length) {
      const err = new Error('no entries found in the workbook');
      err.code = 'VALIDATION_ERROR';
      err.status = 400;
      throw err;
    }
    const repo = await repositoryService.getById(repoId, { authz: opts.authz });
    const now = new Date().toISOString();
    const suiteKey = `rs${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
    const suiteDoc = {
      _key: suiteKey,
      repo_id: repoId,
      kind: 'ragas_suite',
      suite_key: suiteKey,
      repo_ids: [repoId],
      name: `Imported benchmark ${now.slice(0, 10)}`,
      created_at: now,
      created_by: (opts.actor && opts.actor.user_id) || 'system',
      payload: {
        generator: 'import:xlsx',
        repos: [{ id: repoId, name: repo.name }],
        dimensions: { testset_size: entries.length, source: 'xlsx-import' },
        metrics_config: [...DEFAULT_METRICS],
        entries: entries.map((e) => ({ ...e, source: 'manual' })),
        import_meta: { skipped_no_query: parsed.n_skipped_no_query || 0 }
      }
    };
    const db = await dbService.getConnection();
    await ensureCollection(db);
    await db.collection(COLLECTION).save(suiteDoc);
    span.setAttribute('okf.ragas.imported', entries.length);
    logger.info('ragas-suite.imported', { repo_id: repoId, suite_key: suiteKey, entries: entries.length });
    return suiteDoc;
  });
}

async function exportResultsXlsx(repoId, payload = {}) {
  const db = await dbService.getConnection();
  await ensureCollection(db);
  const runKeys = (Array.isArray(payload.run_keys) ? payload.run_keys : []).filter((k) => typeof k === 'string');
  if (!runKeys.length) {
    const err = new Error('run_keys[] is required');
    err.code = 'VALIDATION_ERROR';
    err.status = 400;
    throw err;
  }
  const suiteKey = typeof payload.suite_key === 'string' ? payload.suite_key : '';
  if (!suiteKey) {
    const err = new Error('suite_key is required');
    err.code = 'VALIDATION_ERROR';
    err.status = 400;
    throw err;
  }
  const suite = await loadSuite(db, repoId, suiteKey);
  const runs = [];
  for (const rk of runKeys.slice(0, 10)) {
    const doc = await loadDoc(db, rk, 'RUN_NOT_FOUND', `run ${rk}`);
    if (doc.repo_id !== repoId || doc.suite_key !== suiteKey || doc.kind !== 'ragas_run') {
      const err = new Error(`run ${rk} not found for suite ${suiteKey}`);
      err.code = 'RUN_NOT_FOUND';
      err.status = 404;
      throw err;
    }
    runs.push({
      label: String(rk),
      params: {
        metrics: doc.metrics,
        judge: (doc.payload.fidelity && doc.payload.fidelity.judge && doc.payload.fidelity.judge.model) || ''
      },
      note: `created ${doc.created_at}`,
      results: doc.payload.results,
      summary: doc.payload.summary
    });
  }
  const resp = await sidecar('/xlsx/export-results', {
    json: {
      suite: { name: suite.name, entries: suite.payload.entries },
      runs
    }
  });
  return {
    body: Buffer.from(await resp.arrayBuffer()),
    filename: `benchmark-results-${suiteKey}.xlsx`
  };
}

// ---------- boot sweep -----------------------------------------------------

async function sweepInterruptedRuns() {
  try {
    const db = await dbService.getConnection();
    await ensureCollection(db);
    const liveKeys = new Set([...runInFlight.values()]);
    // A RE-SCORE lives in its own map (rescoreInFlight), so a sweep that
    // only knew about runInFlight declared every live re-score interrupted
    // at boot — while its judge leg kept paying the GPU. The sidecar is the
    // authority: a job it still reports as running is NOT interrupted.
    const rescoreKeys = new Set(rescoreInFlight.keys());
    const cursor = await db.query(
      `FOR d IN ${COLLECTION} FILTER d.kind == "ragas_run" AND d.status == "running" RETURN KEEP(d, ["_key", "suite_key", "sidecar_job_id"])`
    );
    const rows = await cursor.all();
    let swept = 0;
    for (const r of rows) {
      if (liveKeys.has(r._key) || rescoreKeys.has(r._key)) continue;
      if (await sidecarJobIsLive(r.sidecar_job_id)) continue;
      await db
        .collection(COLLECTION)
        .replace(r._key, {
          ...(await db.collection(COLLECTION).document(r._key)),
          status: 'failed',
          error: { code: 'RUN_INTERRUPTED', message: 'interrupted by a server restart — start a new run' }
        })
        .catch(() => {});
      swept += 1;
    }
    if (swept) logger.info('ragas-suite.boot_sweep', { swept });
  } catch (e) {
    logger.warn('ragas-suite.boot_sweep_failed', { error: e.message });
  }
}

// ---------- per-entry probe (management parity) ---------------------------

/**
 * The click-test for a RAGAS entry: the retrieval leg only (embed →
 * multi-repo top-K → rerank → contexts + top score + verdict), persisted
 * as lastProbe on the entry. Deliberately NOT the judge leg — a click must
 * be cheap; the run owns scoring.
 */
async function probeEntry(repoId, suiteKey, payload = {}, opts = {}) {
  return withSpan('okf.ragas.probe', async (span) => {
    span.setAttribute('okf.repo_id', repoId);
    const db = await dbService.getConnection();
    await ensureCollection(db);
    const suite = await loadSuite(db, repoId, suiteKey);
    const id = typeof payload.id === 'string' ? payload.id : '';
    const entry = suite.payload.entries.find((e) => e.id === id);
    if (!entry) {
      const err = new Error(`entry ${id} not found in suite ${suiteKey}`);
      err.code = 'ENTRY_NOT_FOUND';
      err.status = 404;
      throw err;
    }
    const repoIds = suite.repo_ids && suite.repo_ids.length ? suite.repo_ids : [repoId];
    const graphNames = await graphNamesFor(db, repoIds);
    const at = new Date().toISOString();
    // verdict: answerable | weak | unanswerable | error. 'error' means the
    // probe itself failed (embed/HTTP/Arango) — NEVER leave the factory
    // default 'unknown' standing: a swallowed failure read as a scoring
    // result cost a live debugging round (2026-10-18, seven probes showed
    // "unknown" while the note said "HTTP 422").
    const probe = { at, id: entry.id, docs: 0, top_score: null, verdict: 'error', note: '' };
    try {
      const embeddings = await frontmatterService.teiEmbed([entry.query]);
      const emb = Array.isArray(embeddings) && embeddings[0];
      if (!emb) {
        probe.note = 'query embedding failed';
      } else if (!graphNames.length) {
        probe.verdict = 'unanswerable';
        probe.note = 'no ingested graphs for the selected repositories';
      } else {
        const retrieved = await retrieveContexts(db, graphNames, entry.query, emb);
        probe.docs = retrieved.context_keys.length;
        probe.contexts = retrieved.contexts.slice(0, 5).map((c) => c.slice(0, 200));
        probe.context_keys = retrieved.context_keys;
        if (!probe.docs) {
          probe.verdict = 'unanswerable';
          probe.note = 'no chunks retrieved';
        } else {
          const passages = (entry.reference_passages || []).map((p) => norm(p));
          const hit = passages.some((p) => p && retrieved.contexts.some((c) => norm(c).includes(p.slice(0, 80))));
          probe.verdict = hit ? 'answerable' : 'weak';
          probe.note = hit
            ? 'expected passage present in the selected contexts'
            : 'expected passage not in the selected contexts';
        }
      }
    } catch (e) {
      probe.note = `probe failed: ${e.message}`;
    }
    entry.lastProbe = probe;
    suite.updated_at = at;
    suite.updated_by = (opts.actor && opts.actor.user_id) || 'system';
    await db.collection(COLLECTION).replace(suite._key, suite);
    span.setAttribute('okf.ragas.probe_verdict', probe.verdict);
    return probe;
  });
}

module.exports = {
  ALL_METRICS,
  DEFAULT_METRICS,
  rerankTexts,
  beginSuiteGeneration,
  cancelSuiteGeneration,
  generateSuite,
  getSuite,
  updateSuiteRows,
  addQueries,
  renameSuite,
  deleteSuite,
  deleteRun,
  rescoreRun,
  beginRunSuite,
  cancelSuiteRun,
  runSuite,
  getRunSuite,
  listRuns,
  beginExplainFailures,
  explainFailures,
  getExplainFailures,
  probeEntry,
  exportSuiteXlsx,
  importSuiteXlsx,
  exportResultsXlsx,
  sweepInterruptedRuns,
  // Exported for the unit test that pins WHICH model the run claims
  // answered (the serve mode recorded a model that never answered —
  // David, 2026-10-25).
  answerFidelity,
  // Exported for the unit test that pins the COMPUTED second-judge
  // comparison (the advisor used to assert a second judge's verdict from
  // a hardcoded string).
  compareJudges,
  // Exported so the lookup can be exercised against a store: the mock's AQL
  // dispatcher used to fall through to an empty result for this query, so
  // the advisor's headline behaviour (a second judge's verdict computed from
  // the real sibling re-score) was never proven end to end.
  loadSecondJudgeRun,
  secondJudgeSentence,
  attributeFailures,
  buildEnvAdvice,
  // Exported so the summary's population rule (in-scope rows only) and its
  // four buckets can be pinned by a test: the panel used to derive them
  // itself, across two populations, and misreported which rows failed.
  summarizeRun,
  // Exported so the sidecar()'s egress guard (review 2026-10-29 wave 2) can
  // be pinned by a test — a malicious path must be rejected before any fetch.
  sidecar
};
