// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
//
// ragas-suite-service — Story 8-6 (2026-10-17, ADR-okf-043): RAGAS
// benchmark suites for the OKF Lab. Clones the head-suite-service skeleton
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
const { withSpan } = require('../shared-lib/tracing');
const { createHash } = require('node:crypto');
const dbService = require('../shared-lib/db-connection-service');

const frontmatterService = require('./frontmatter-service');
const repositoryService = require('./repository-service');
const headTestService = require('./head-test-service');
const modelConfigService = require('./model-config-service');

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
const TOP_N = Math.max(1, parseInt(process.env.OKF_RAGAS_TOP_N || process.env.RERANKER_TOP_N || '3', 10));
// Generation corpus budget in CHUNKS (the retrievable unit). Concepts
// average 3-4 published chunks, so 1600 ≈ the 400-concept corpus this
// replaces. Read per call — an operator can raise it for a big-corpus
// deployment without a rebuild (David 2026-10-21: "we have much larger
// corpuses to process than this").
const maxCorpusChunks = () => Math.max(1, parseInt(process.env.OKF_RAGAS_MAX_CORPUS_CHUNKS || '1600', 10));
const CONTEXT_CHARS = 2000; // per-context cap stored on run rows (xlsx uses answer_first_200 anyway)
const CONCEPT_BODY_CAP = parseInt(process.env.OKF_MAX_CONCEPT_DOC_CHARS || '200000', 10);

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
const ABSTENT_PATTERNS = [
  'cannot find',
  "can't find",
  'does not contain',
  'not contain',
  'no information',
  'not provide',
  "doesn't provide",
  'do not have',
  "don't have",
  'unable to find',
  'no relevant information',
  'not available in'
];
const ABSTENT_NEGATED_KB = [
  'not in the knowledge base',
  'not in this knowledge base',
  'no knowledge base',
  'knowledge base does not',
  'knowledge base contains no',
  'knowledge base has no',
  'knowledge base is empty',
  'not found in the knowledge base'
];

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

/** Cancel every active sidecar job belonging to a suite (best-effort). */
async function cancelSuiteJobs(suiteKey, why) {
  const jobIds = [...activeSidecarJobs.entries()]
    .filter(([, meta]) => meta && meta.suite_key === suiteKey)
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

const RERANK_RETRY_ATTEMPTS = 3;
const RERANK_RETRY_STATUSES = new Set([429, 502, 503, 504]);
const RERANK_TIMEOUT_MS = 15000;
// TEI rerankers cap batches (live 2026-10-18: "batch size 48 > maximum
// allowed batch size 32" — 24 candidates x 2 graphs 422'd EVERY probe and
// run row, surfacing as "unknown" answers). Client-side batching like
// teiEmbed's TEI_EMBED_CHUNK: every caller is bounded regardless of fanout.
const RERANK_BATCH = 32;
const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Same TEI rerank contract as head-suite's rerankTexts (env-shared).
 * Batches at RERANK_BATCH and remaps chunk-local indices to global ones. */
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
  const merged = [];
  for (let offset = 0; offset < texts.length; offset += RERANK_BATCH) {
    const batch = texts.slice(offset, offset + RERANK_BATCH);
    let decoded;
    for (let attempt = 1; attempt <= RERANK_RETRY_ATTEMPTS; attempt += 1) {
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
        if (e.retryable === true && attempt < RERANK_RETRY_ATTEMPTS) {
          await sleepMs(retryDelayMs(e, attempt));
          continue;
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    }
    // chunk-local indices -> global indices before merging
    for (const r of decoded) {
      const i = Number(r && r.index);
      if (Number.isInteger(i) && i >= 0 && i < batch.length) {
        merged.push({ index: i + offset, score: Number(r && r.score) || 0 });
      }
    }
  }
  return merged;
}

function retryDelayMs(e, attempt) {
  return e.retryAfterMs || 500 * attempt + Math.floor(Math.random() * 250);
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
    candidate_keys: perGraph.slice(0, 24).map((c) => c.key),
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
    { maxTokens: 800, temperature: 0.0, service: 'ragas_answers' }
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
  const abstained = (parsed && parsed.abstained === true) || matchAbstention(answer);
  return { answer, abstained };
}

function matchAbstention(answer) {
  const a = String(answer || '').toLowerCase();
  if (!a) return true;
  if (ABSTENT_PATTERNS.some((p) => a.includes(p))) return true;
  // The knowledge-base phrasing only counts when NEGATED (see F11).
  return ABSTENT_NEGATED_KB.some((p) => a.includes(p));
}

/** What the run's fidelity block records about the ANSWER leg — mirrors the
 * openai-only guard the answer call itself applies, so the record never
 * claims a config steered answers when it couldn't. */
async function answerFidelity() {
  try {
    const ovr = await modelConfigService.resolveModelOverride({ service: 'ragas_answers' });
    if (ovr && ovr.provider === 'openai') {
      return { source: 'config', config: ovr.config_name, model: ovr.model };
    }
  } catch {
    /* resolution failure — the deployment answerer applies */
  }
  return { source: 'deployment-chat', config: null, model: process.env.VLLM_LLM_MODEL_ID || null };
}

// ---------- suite generation ----------------------------------------------

function loadDoc(db, key, code, what) {
  return db
    .collection(COLLECTION)
    .document(key)
    .catch((e) => {
      if (e && (e.code === 404 || e.statusCode === 404 || /not found/i.test(e.message || ''))) {
        const err = new Error(`${what} ${key} not found`);
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
  if (!inflight || inflight !== runKey) {
    const err = new Error('no such run is executing for this suite');
    err.code = 'NO_RUN_IN_FLIGHT';
    err.status = 409;
    throw err;
  }
  userCancelledRun.add(runKey);
  await cancelSuiteJobs(suiteKey, `run cancelled by user (${runKey})`);
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
    const gen = await pollSidecarJobOwned(
      genStarted.job_id,
      {
        kind: 'generate-testset',
        repo_id: repoId,
        suite_key: opts.suiteKey
      },
      {
        // live KG/synthesis counts land on the generating envelope (getSuite)
        onProgress: (p) => genProgress.set(opts.suiteKey, p)
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
    if (now - lastProgressWrite < PROGRESS_WRITE_MIN_MS) return;
    lastProgressWrite = now;
    await db
      .collection(COLLECTION)
      .update(runKey, { progress, updated_at: new Date().toISOString() })
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
    judge_model: payload.judge_model || null
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
    const erroredRows = results.filter((r) => r.error).length;
    const answeredRows = results.length - erroredRows;
    // A user cancel observed by the workers routes through beginRunSuite's
    // catch (userCancelledRun relabel) so the doc lands status 'cancelled'
    // exactly like a judge-phase cancel — never as failed or done.
    if (userCancelledRun.has(opts.runKey)) {
      const cancelled = new Error('run cancelled by user');
      cancelled.code = 'RAGAS_JOB_CANCELLED';
      throw cancelled;
    }
    if (abortErr || answeredRows === 0) {
      const firstErr = (results.find((r) => r.error && r.error.code !== 'SKIPPED_RUN_ABORTED') || {}).error || {
        code: 'ANSWER_LEG_FAILED',
        message: 'every answer failed'
      };
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
          fidelity: {
            retrieval: {
              algorithm: 'per-graph APPROX_NEAR_COSINE + unified rerank',
              candidate_k: CANDIDATE_K,
              top_n: TOP_N,
              graphs: graphNames
            },
            judge: null,
            answers: await answerFidelity()
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
    const samples = entries.map((e, i) => ({
      user_input: e.query,
      retrieved_contexts: results[i].contexts,
      response: results[i].answer,
      reference: e.reference_answer || '',
      reference_contexts: e.reference_passages || []
    }));
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
    // sidecar returns rows in sample order (EvaluationDataset preserves it)
    for (let i = 0; i < results.length; i += 1) {
      const q = perQuery[i] || {};
      results[i].metrics = q || {};
      delete results[i].metrics.user_input;
      delete results[i].metrics.retrieved_contexts;
      delete results[i].metrics.response;
      delete results[i].metrics.reference;
      results[i].ragas_nan = q.ragas_nan === 'ALL_NAN';
    }
    // Judge COVERAGE (2026-10-21 sidecar review F2): the sidecar averages the
    // rows that scored and nulls the ones that failed, so a judge that died
    // on half the rows still produced a healthy-looking mean over the
    // survivors. The run records the per-metric scored-row count so the
    // panel can say "12 of 20 rows measured" instead of presenting a partial
    // average as the benchmark.
    const judgeCoverage = evaluation.coverage && typeof evaluation.coverage === 'object' ? evaluation.coverage : null;
    const measuredRows = judgeCoverage
      ? Math.max(0, ...Object.values(judgeCoverage).map((v) => Number(v) || 0))
      : perQuery.filter((q) => q && q.ragas_nan !== 'ALL_NAN').length;
    const summary = summarizeRun(suite, results, opts.metrics);
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
        // average is not a benchmark result (sidecar review F2).
        coverage: {
          measured_rows: measuredRows,
          total_rows: results.length,
          per_metric: judgeCoverage
        },
        fidelity: {
          retrieval: {
            algorithm: 'per-graph APPROX_NEAR_COSINE + unified rerank',
            candidate_k: CANDIDATE_K,
            top_n: TOP_N,
            graphs: graphNames
          },
          prompt: {
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
          answers: await answerFidelity()
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
  if (typeof opts.reportProgress === 'function') await opts.reportProgress(progress);
}

function sha256(s) {
  return createHash('sha256')
    .update(String(s || ''))
    .digest('hex')
    .slice(0, 16);
}

function summarizeRun(suite, results, metrics) {
  const thresholds = { ...FAIL_BELOW_DEFAULTS, ...((suite.payload && suite.payload.thresholds) || {}) };
  const entries = suite.payload.entries;
  const byId = new Map(entries.map((e) => [e.id, e]));
  const n = results.length;
  let nErrors = 0;
  let nAbstained = 0;
  const failing = [];
  for (const r of results) {
    if (r.error) nErrors += 1;
    if (r.abstained) nAbstained += 1;
    const e = byId.get(r.id) || {};
    const fails = [];
    for (const m of metrics) {
      const v = r.metrics ? r.metrics[m] : null;
      if (v === null || v === undefined || v !== v) continue;
      const t = thresholds[m];
      if (t === undefined) continue;
      if (m === 'noise_sensitivity' ? v > t : v < t) fails.push(m);
    }
    if (fails.length && !e.oos) failing.push({ id: r.id, query: r.query, fails });
  }
  const means = {};
  for (const m of metrics) {
    const vals = results.map((r) => (r.metrics ? r.metrics[m] : null)).filter((v) => typeof v === 'number' && v === v);
    means[m] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }
  return {
    n,
    n_errors: nErrors,
    n_abstained: nAbstained,
    n_evaluable: results.filter((r) => !(byId.get(r.id) || {}).oos).length,
    metrics: means,
    failing_count: failing.length,
    failing: failing.slice(0, 100)
  };
}

async function getRunSuite(repoId, suiteKey, runKey) {
  const db = await dbService.getConnection();
  await ensureCollection(db);
  if (runInFlight.get(suiteKey) === runKey) {
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
    return { run_key: runKey, suite_key: suiteKey, status: 'failed', error: doc.error || null };
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
      'HAS(d.payload.fidelity.judge, "pick") ? d.payload.fidelity.judge.pick : null })',
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

/** The failure-attribution matrix, mechanically computed from run evidence. */
function attributeFailures(suite, runDoc) {
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
    if (!failed.length) continue;
    const passages = (e.reference_passages || []).map((p) => norm(p));
    const contexts = (r.contexts || []).map((c) => norm(c));
    const candidates = (r.candidates || []).map((c) => norm(c));
    const passageInContexts = passages.some((p) => p && contexts.some((c) => c.includes(p.slice(0, 80))));
    const passageInCandidates = passages.some((p) => p && candidates.some((c) => c.includes(p.slice(0, 80))));
    let stage;
    let recommendation;
    if (r.ragas_nan) {
      stage = 'judge';
      recommendation =
        'judge failure, not pipeline failure — verify RAGAS_JUDGE_* (reasoning-token budget, non-JSON judge, missing embed model)';
    } else if (!r.contexts || !r.contexts.length) {
      stage = 'routing';
      recommendation = 'nothing was retrieved — check the repo is published and its graph drained';
    } else if (failed.includes('context_recall') && !passageInContexts && passageInCandidates) {
      stage = 'reranker';
      recommendation =
        'the expected passage was a candidate but not selected — reranker dropped it (RERANKER_TOP_N / strategy)';
    } else if (failed.includes('context_recall') && !passageInContexts) {
      stage = 'corpus';
      recommendation = 'the expected passage is not retrievable — re-curate the concept or regenerate this entry';
    } else if (
      failed.includes('faithfulness') ||
      failed.includes('factual_correctness') ||
      failed.includes('answer_correctness')
    ) {
      stage = 'llm';
      recommendation =
        'the answer drifts from the retrieved context — tighten CHATQNA_SYSTEM_PROMPT grounding or reassess the model minimums';
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
        'context recall passed — the reference content WAS retrieved; the entity-recall miss comes from the judge’s entity extraction, not missing content. Treat as judge noise unless a stronger judge model reproduces it.';
    } else if (failed.includes('context_entities_recall')) {
      stage = 'corpus';
      recommendation = 'key entities of the reference are unretrievable — enrich entity mentions in the concept';
    } else {
      stage = 'pipeline';
      recommendation = 'metric below threshold — inspect the row detail';
    }
    attributions.push({ id: r.id, query: r.query, fails: failed, stage, recommendation });
  }
  return attributions;
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
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
    const attributions = attributeFailures(suite, runDoc);
    explainProgress.set(suiteKey, { phase: 'advising', started_ms: Date.now(), failing: attributions.length });
    try {
      // ONE guided-JSON advice call; tag suggestions pass the existing guardrail.
      let advice = {
        source: 'none',
        note: 'no LLM advice (attribution only)',
        knob_changes: [],
        repo_tag_changes: [],
        content_curation: [],
        prompt_tweaks: []
      };
      if (attributions.length) {
        try {
          const resp = await frontmatterService.vllmChatCompletions(
            [
              {
                role: 'system',
                content:
                  'You are a RAG pipeline tuning advisor. Given benchmark failures with stage attributions, ' +
                  'propose concrete actions. Respond as JSON: {"knob_changes": ["..."], "repo_tag_changes": ["..."], ' +
                  '"content_curation": [{"concept": "...", "gap": "..."}], "prompt_tweaks": ["..."]}. ' +
                  'Every item must name the surface it changes. Do not invent failures.'
              },
              {
                role: 'user',
                content: JSON.stringify({
                  repo: suite.name,
                  metrics: runDoc.metrics,
                  summary: runDoc.payload.summary,
                  attributions: attributions.slice(0, 40)
                })
              }
            ],
            // The advisor rides the judge's model config (memlog 90: a frontier
            // judge gives better advice; same service family as scoring).
            { maxTokens: 1200, temperature: 0.2, service: 'ragas_judge' }
          );
          const content =
            resp && resp.data && resp.data.choices && resp.data.choices[0] && resp.data.choices[0].message
              ? resp.data.choices[0].message.content
              : null;
          const match = content && typeof content === 'string' ? content.match(/\{[\s\S]*\}/) : null;
          if (match) {
            const parsed = JSON.parse(match[0]);
            advice = {
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
          attributions,
          advice
        }
      };
      await db.collection(COLLECTION).save(doc);
      span.setAttribute('okf.ragas.failing', attributions.length);
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
    const cursor = await db.query(
      `FOR d IN ${COLLECTION} FILTER d.kind == "ragas_run" AND d.status == "running" RETURN KEEP(d, ["_key", "suite_key"])`
    );
    const rows = await cursor.all();
    let swept = 0;
    for (const r of rows) {
      if (liveKeys.has(r._key)) continue;
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
  sweepInterruptedRuns
};
