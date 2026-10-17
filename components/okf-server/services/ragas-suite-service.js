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

const COLLECTION = 'okf_head_test_runs'; // kinds: ragas_suite | ragas_run | ragas_explain

// ---------- config ---------------------------------------------------------

const RAGAS_URL = () => (process.env.OKF_RAGAS_URL || 'http://ragas-service:8090').replace(/\/+$/, '');
const RAGAS_TIMEOUT_MS = parseInt(process.env.OKF_RAGAS_TIMEOUT_MS || '600000', 10);
// Generation and evaluation are LONG jobs (minutes to hours for large
// suites), so they run sidecar-side as 202+poll background jobs — no HTTP
// connection is held open. This budget is the TOTAL job deadline the poller
// enforces (David's first generation outran the old 10-min held-open fetch
// while the GPU was 100% busy; async jobs are the durable fix).
const RAGAS_LONG_TIMEOUT_MS = parseInt(process.env.OKF_RAGAS_LONG_TIMEOUT_MS || '3600000', 10);
const RAGAS_JOB_POLL_MS = parseInt(process.env.OKF_RAGAS_JOB_POLL_MS || '3000', 10);
const TESTSET_SIZE_DEFAULT = Math.max(1, parseInt(process.env.OKF_RAGAS_TESTSET_SIZE_DEFAULT || '20', 10));
const MAX_ENTRIES = Math.max(1, parseInt(process.env.OKF_RAGAS_MAX_ENTRIES || '200', 10));
const RUN_CONCURRENCY = Math.max(1, parseInt(process.env.OKF_RAGAS_RUN_CONCURRENCY || '2', 10));
const CANDIDATE_K = Math.max(1, parseInt(process.env.OKF_RAGAS_CANDIDATE_K || '24', 10));
const TOP_N = Math.max(1, parseInt(process.env.OKF_RAGAS_TOP_N || process.env.RERANKER_TOP_N || '3', 10));
const MAX_CORPUS_CONCEPTS = Math.max(1, parseInt(process.env.OKF_RAGAS_MAX_CORPUS_CONCEPTS || '400', 10));
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
// deployment pins one, else the built-in default mirroring genieai_chatqna
// (grounded answering + honest abstention). The sha is recorded on the run
// so answer-leg drift is visible.
const ANSWER_SYSTEM_PROMPT =
  process.env.CHATQNA_SYSTEM_PROMPT ||
  'You are a knowledgeable assistant. Answer ONLY from the provided context. ' +
    'If the context does not contain the answer, say you cannot find the information ' +
    'in the available knowledge base — never invent facts.';

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
  'not available in',
  'knowledge base'
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
 * Poll a sidecar background job to completion (202 + poll — the same
 * contract this service itself exposes). RAGAS_LONG_TIMEOUT_MS is the TOTAL
 * job deadline; each individual HTTP call uses the short default budget, so
 * no connection is ever held open while the judge grinds. A vanished job
 * (404 — sidecar restarted) fails fast; transient poll errors retry until
 * the deadline.
 */
async function pollSidecarJob(jobId) {
  const deadline = Date.now() + RAGAS_LONG_TIMEOUT_MS;
  for (;;) {
    await sleepMs(RAGAS_JOB_POLL_MS);
    let job;
    try {
      const resp = await sidecar(`/jobs/${jobId}`, { method: 'GET' });
      job = await resp.json();
    } catch (e) {
      if (e.status === 404) {
        const err = new Error(`ragas-service job ${jobId} vanished (sidecar restarted mid-job?)`);
        err.code = 'RAGAS_UNAVAILABLE';
        err.status = 503;
        throw err;
      }
      if (Date.now() > deadline) throw e; // network-class failure + out of time
      continue; // transient poll failure — the job may still be fine
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
    if (Date.now() > deadline) {
      const err = new Error(
        `ragas-service job ${jobId} still ${job.status || 'running'} after ${Math.round(RAGAS_LONG_TIMEOUT_MS / 1000)}s — polling gave up (the job may still finish there)`
      );
      err.code = 'RAGAS_JOB_TIMEOUT';
      err.status = 503;
      throw err;
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
async function pollSidecarJobOwned(jobId, meta) {
  activeSidecarJobs.set(jobId, meta);
  try {
    const result = await pollSidecarJob(jobId);
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
const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Same TEI rerank contract as head-suite's rerankTexts (env-shared). */
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
  for (let attempt = 1; attempt <= RERANK_RETRY_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RERANK_TIMEOUT_MS);
    try {
      const resp = await fetch(rerankUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, texts }),
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
      const decoded = await resp.json();
      if (!Array.isArray(decoded)) throw new Error('unexpected rerank response shape');
      return decoded;
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
  throw new Error('rerank failed: retry loop exited unexpectedly'); // defensive
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

/** The answer leg: chatqna-shaped prompt + guided-JSON {answer, abstained}. */
async function generateAnswer(query, contexts) {
  const contextBlock = contexts.map((c, i) => `[${i + 1}] ${c}`).join('\n\n');
  const user =
    `Context:\n${contextBlock || '(no context retrieved)'}\n\nQuestion: ${query}\n\n` +
    'Answer the question using ONLY the context above. If the context does not contain ' +
    'the answer, set abstained=true and say you cannot find the information.\n' +
    'Respond as JSON: {"answer": "<your answer>", "abstained": <true|false>}';
  const resp = await frontmatterService.vllmChatCompletions(
    [
      { role: 'system', content: ANSWER_SYSTEM_PROMPT },
      { role: 'user', content: user }
    ],
    { maxTokens: 800, temperature: 0.0 }
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
  return ABSTENT_PATTERNS.some((p) => a.includes(p));
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

/** Concept bodies of the selected repos → sidecar documents (bounded). */
async function buildCorpusDocuments(db, repoIds) {
  const docs = [];
  for (const rid of repoIds) {
    const rows = await (
      await db.query(
        'FOR m IN okf_concepts_meta FILTER m.repo_id == @rid AND m.index_status != "rejected" ' +
          'SORT m.concept_id LIMIT @lim ' +
          'RETURN { concept_id: m.concept_id, title: m.title, body: m.body }',
        { rid, lim: MAX_CORPUS_CONCEPTS }
      )
    ).all();
    for (const r of rows) {
      const body = String(r.body || '').slice(0, CONCEPT_BODY_CAP);
      if (!body.trim()) continue;
      docs.push({
        page_content: body,
        metadata: { repo_id: rid, concept_id: r.concept_id, title: r.title || r.concept_id }
      });
    }
  }
  return docs;
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
  genInFlight.set(repoId, suiteKey);
  genFailure.delete(repoId);
  const done = generateSuite(
    repoId,
    { ...payload, repo_ids: repoIds, testset_size: testsetSize },
    { ...opts, suiteKey }
  )
    .then((suite) => suite)
    .finally(() => genInFlight.delete(repoId));
  done.catch((e) => {
    genFailure.set(repoId, {
      suite_key: suiteKey,
      code: e.code || 'GENERATION_FAILED',
      message: e.message,
      at: new Date().toISOString()
    });
    logger.error('ragas-suite.generate.async_failed', { repo_id: repoId, suite_key: suiteKey, error: e.message });
  });
  return { suite_key: suiteKey, done };
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
    const docs = await buildCorpusDocuments(db, repoIds);
    if (!docs.length) {
      const err = new Error('no concept bodies found for the selected repositories — ingest first');
      err.code = 'NO_CORPUS';
      err.status = 409;
      throw err;
    }
    // 202 + poll: the sidecar starts a background job and we poll it — no
    // connection is held open for the (potentially hour-long) generation.
    const genResp = await sidecar('/generate-testset', {
      json: {
        documents: docs,
        testset_size: clampCount(payload.testset_size, 1, MAX_ENTRIES),
        query_distribution: Array.isArray(payload.query_distribution) ? payload.query_distribution : null,
        num_personas: clampCount(payload.num_personas, 1, 10)
      }
    });
    const genStarted = await genResp.json();
    const gen = await pollSidecarJobOwned(genStarted.job_id, {
      kind: 'generate-testset',
      repo_id: repoId,
      suite_key: opts.suiteKey
    });
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
      reference_passages: (Array.isArray(s.reference_contexts) ? s.reference_contexts : []).map((c) =>
        String(c).slice(0, 500)
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
        repos: repos.map((r) => ({ id: r.repo_id || r._key, name: r.name })),
        dimensions: {
          testset_size: entries.length,
          requested_size: payload.testset_size,
          query_distribution: payload.query_distribution || null,
          num_personas: payload.num_personas || 3
        },
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
    return { suite_key: suiteKey, status: 'generating' };
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
        e.reference_passages = m.reference_passages.map((p) => String(p).slice(0, 500));
      if (typeof m.source_doc === 'string') e.source_doc = m.source_doc;
      if (typeof m.difficulty === 'string') e.difficulty = m.difficulty;
      if (m.flip_oos !== undefined) {
        e.oos = m.flip_oos === true;
        if (e.oos) e.reference_passages = [];
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
          ? q.reference_passages.map((p) => String(p).slice(0, 500))
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
    suite.payload.entries = suite.payload.entries.slice(0, ROW_CAPS.entries);
    suite.updated_at = new Date().toISOString();
    await db.collection(COLLECTION).replace(suite._key, suite);
    span.setAttribute('okf.ragas.added', fresh.length);
    return { suite, added: fresh.length, duplicates_dropped: duplicatesDropped };
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
    reportProgress
  })
    .then((runDoc) => runDoc)
    .catch(async (e) => {
      const code = typeof e.code === 'string' && e.code ? e.code : 'RUN_FAILED';
      const failDoc = { ...placeholder, status: 'failed', error: { code, message: e.message } };
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
    async function worker() {
      for (;;) {
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
            error: { code: err.code || 'ENTRY_FAILED', message: err.message }
          };
        }
        doneCount += 1;
        await report(opts, { phase: 'retrieval', done: doneCount, total });
      }
    }
    await Promise.all(Array.from({ length: Math.min(RUN_CONCURRENCY, entries.length) }, worker));

    // score with the sidecar
    await report(opts, { phase: 'judge', done: 0, total: 1 });
    const samples = entries.map((e, i) => ({
      user_input: e.query,
      retrieved_contexts: results[i].contexts,
      response: results[i].answer,
      reference: e.reference_answer || '',
      reference_contexts: e.reference_passages || []
    }));
    const evalStarted = await sidecar('/evaluate', { json: { samples, metrics: opts.metrics } });
    const evalStartedBody = await evalStarted.json();
    const evaluation = await pollSidecarJobOwned(evalStartedBody.job_id, {
      kind: 'evaluate',
      repo_id: repoId,
      suite_key: suiteKey,
      run_key: opts.runKey
    });
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
        fidelity: {
          retrieval: {
            algorithm: 'per-graph APPROX_NEAR_COSINE + unified rerank',
            candidate_k: CANDIDATE_K,
            top_n: TOP_N,
            graphs: graphNames
          },
          prompt: {
            system_prompt_sha: sha256(ANSWER_SYSTEM_PROMPT),
            source: process.env.CHATQNA_SYSTEM_PROMPT ? 'CHATQNA_SYSTEM_PROMPT' : 'builtin-default'
          },
          judge: { model: evaluation.model || null, embed_model: null }
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
      'entries: HAS(d.payload, "entries") ? LENGTH(d.payload.entries) : null })',
    { rid: repoId, kinds, lim: limit }
  );
  return cursor.all();
}

// ---------- explain / advise ----------------------------------------------

const explainInFlight = new Map(); // suite_key -> explain_key

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
    return { run_key: runKey, suite_key: suiteKey, status: 'running' };
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
          { maxTokens: 1200, temperature: 0.2 }
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
  });
}

function arr(v) {
  return Array.isArray(v) ? v.map((x) => String(x)).slice(0, 20) : [];
}

// ---------- xlsx passthrough ----------------------------------------------

async function exportSuiteXlsx(repoId, suiteKey) {
  const suite = await getSuite(repoId, suiteKey);
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
    const probe = { at, id: entry.id, docs: 0, top_score: null, verdict: 'unknown', note: '' };
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
  beginSuiteGeneration,
  generateSuite,
  getSuite,
  updateSuiteRows,
  addQueries,
  renameSuite,
  deleteSuite,
  beginRunSuite,
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
