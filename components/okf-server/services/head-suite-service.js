// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
//
// head-suite-service — Story 1-8 MR-B (2026-10-08): test SUITES and
// run ANALYTICS for the OKF Head Tester / Routing Lab. Sits on top of
// head-test-service.routingTest (the two-leg simulation) and adds:
//
//   generateSuite(repoId, {n_positive, n_negative})
//     ONE guided-JSON vLLM call given this repo's frontmatter + head
//     text + sibling head texts → positive queries (should route here)
//     and confusable-sibling negatives (should route elsewhere), plus
//     deterministic FORBIDDEN-derived negatives templated from the
//     repo's own forbidden list (the third negative kind — no LLM).
//     Persisted as a suite doc in okf_head_test_runs.
//   addQueries(repoId, suiteKey, {queries})
//     Curator free-text additions (kind positive|negative) — the
//     operator's own probes join the suite and every future run.
//   runSuite(repoId, suiteKey)
//     Executes every suite query through routingTest (include_probes
//     off — the run measures the HEAD leg, the pre-ingest signal),
//     aggregates pass rates / margins / steals, persists a run doc.
//   listRuns(repoId, {limit, kind})
//     Analytics history across tag cycles (kind filter run|suite|all).
//
// Negative-kind taxonomy (David 2026-10-08, "absolutely - all three"):
//   llm        — confusable-sibling queries from the generator
//   forbidden  — templated from frontmatter.forbidden (must NOT route)
//   manual     — curator free-text
//
// Honest-empty semantics: with no sibling heads in the universe a
// negative cannot fail-select (the under-test repo wins a one-repo
// race by default), so negative metrics are reported as null with the
// reason — never a fake 100%.

'use strict';

const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');
const dbService = require('../shared-lib/db-connection-service');

const frontmatterService = require('./frontmatter-service');
const repositoryService = require('./repository-service');
const headTestService = require('./head-test-service');

const HEAD_TEST_RUNS_COLLECTION = 'okf_head_test_runs';
// Sibling context for the LLM prompt (matches the lab's sibling bound).
const SIBLING_CONTEXT_LIMIT = 20;
// Deterministic forbidden-negative templates: {tag} is substituted.
const FORBIDDEN_TEMPLATES = [
  'What is the latest guidance on {tag}?',
  'Explain the national policy for {tag} in detail',
  'Give me statistics and recent data about {tag}'
];
const FORBIDDEN_DERIVED_MAX = 3;

let _runsCollectionEnsured = false;

// ---------- collection ----------

async function ensureCollection(db) {
  if (_runsCollectionEnsured) return;
  const existing = new Set((await db.listCollections()).map((c) => c.name));
  if (!existing.has(HEAD_TEST_RUNS_COLLECTION)) {
    await db.createCollection(HEAD_TEST_RUNS_COLLECTION);
    logger.info('head-suite.collection_created', { name: HEAD_TEST_RUNS_COLLECTION });
  }
  const col = db.collection(HEAD_TEST_RUNS_COLLECTION);
  const idx = (await col.indexes()).map((i) => i.fields.join(','));
  if (!idx.includes('repo_id')) {
    await col.ensureIndex({ type: 'persistent', fields: ['repo_id'] });
  }
  if (!idx.includes('created_at')) {
    await col.ensureIndex({ type: 'persistent', fields: ['created_at'] });
  }
  _runsCollectionEnsured = true;
}

// ---------- internals ----------

function parseJsonObject(text) {
  const m = text && text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

/**
 * Sibling head CONTEXT for the generator prompt: name + head.text for
 * every other repo with a head (graph-less included — they compete on
 * the head leg). Cap at SIBLING_CONTEXT_LIMIT.
 */
async function loadSiblingContext(db, underTestId) {
  const cursor = await db.query(
    'FOR r IN okf_repositories FILTER r._key != @me FILTER r.head != null ' +
      'SORT r.name LIMIT @cap RETURN { repo_id: r._key, name: r.name, text: r.head.text || "" }',
    { me: underTestId, cap: SIBLING_CONTEXT_LIMIT }
  );
  return cursor.all();
}

function suitePrompt(repo, fm, siblings, nPositive, nNegative) {
  const siblingText = siblings.length
    ? siblings.map((s) => `- "${s.name}"\n  ${String(s.text || '').slice(0, 400)}`).join('\n')
    : '(no other repository currently has a vectorized head)';
  return `You are building a ROUTING TEST SUITE for one repository in a
multi-repository retrieval system. Each query will be embedded and the
system routes it to the repository whose "head" vector scores highest.
Good tags = the right repository wins; vague tags = routing bugs.

REPOSITORY UNDER TEST: "${repo.name}"
Its head text (what the router sees):
Topics: ${(fm.topic || []).join(', ')}
Entities: ${(fm.entity || []).join(', ')}
Scope: ${fm.scope || ''}
Explicitly NOT about: ${(fm.forbidden || []).join(', ')}
Summary: ${fm.summary || ''}

COMPETING REPOSITORIES (queries similar to their content but not to the
repository under test are the most valuable negative tests):
${siblingText}

Generate:
- ${nPositive} POSITIVE queries a real user would type when they want
  THIS repository's content. Use its topic/entity vocabulary. Vary the
  phrasing (question, keyword list, sentence). 5-15 words each.
- ${nNegative} NEGATIVE queries that a user might MISTAKE for this
  repository's domain but actually belong to a COMPETING repository
  above. Set "expected_repo" to the EXACT competing repository name
  (empty string if there are no competitors). 5-15 words each.
- 5-8 KEYWORDS: single-domain terms strongly identifying THIS repository.

OUTPUT FORMAT (CRITICAL — the parser is strict, no synonyms):
  { "positive": [ {"query": "...", "reason": "<one sentence>"} ],
    "negative": [ {"query": "...", "expected_repo": "...", "reason": "<one sentence>"} ],
    "keywords": ["...", "..."] }
Use the EXACT field names shown. Output ONLY the JSON object, no prose,
no markdown fences.`;
}

/**
 * Deterministic forbidden-derived negatives (negative kind 'forbidden'):
 * templated from the repo's OWN forbidden list — queries the head must
 * NOT win. No LLM involved; honest even when the model is unreachable.
 */
function forbiddenDerivedQueries(fm) {
  const tags = Array.isArray(fm.forbidden) ? fm.forbidden : [];
  return tags.slice(0, FORBIDDEN_DERIVED_MAX).map((tag, i) => ({
    query: FORBIDDEN_TEMPLATES[i % FORBIDDEN_TEMPLATES.length].replace('{tag}', tag),
    kind: 'negative',
    source: 'forbidden',
    expected_repo: null,
    reason: `derived from the repo's own forbidden tag "${tag}" — the head must not win it`
  }));
}

function clampCount(value, fallback, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function loadSuiteDoc(db, repoId, suiteKey) {
  return db
    .collection(HEAD_TEST_RUNS_COLLECTION)
    .document(suiteKey)
    .catch((e) => {
      if (e && (e.code === 404 || e.statusCode === 404 || /not found/i.test(e.message || ''))) {
        const err = new Error(`suite ${suiteKey} not found for repo ${repoId}`);
        err.code = 'SUITE_NOT_FOUND';
        err.status = 404;
        throw err;
      }
      throw e;
    });
}

// ---------- public: generate ----------

async function generateSuite(repoId, payload = {}, opts = {}) {
  return withSpan('okf.headsuite.generate', async (span) => {
    span.setAttribute('okf.repo_id', repoId);
    const repo = await repositoryService.getById(repoId, { authz: opts.authz });
    const fm = await frontmatterService.readFrontmatterFromRepoDoc(repoId);
    if (!fm) {
      const err = new Error('repo has no stored frontmatter — save tags before generating a suite');
      err.code = 'NO_FRONTMATTER';
      err.status = 409;
      throw err;
    }
    const nPositive = clampCount(payload.n_positive, 8, 20);
    const nNegative = clampCount(payload.n_negative, 6, 15);

    const db = await dbService.getConnection();
    await ensureCollection(db);
    const siblings = await loadSiblingContext(db, repoId);

    const prompt = suitePrompt(repo, fm, siblings, nPositive, nNegative);
    let llm = { positive: [], negative: [], keywords: [] };
    try {
      const resp = await frontmatterService.vllmChatCompletions([{ role: 'user', content: prompt }], {
        maxTokens: 1500
      });
      const content = resp.data && resp.data.choices && resp.data.choices[0] && resp.data.choices[0].message;
      const parsed = parseJsonObject(content && content.content);
      if (parsed) {
        llm = {
          positive: Array.isArray(parsed.positive) ? parsed.positive : [],
          negative: Array.isArray(parsed.negative) ? parsed.negative : [],
          keywords: Array.isArray(parsed.keywords) ? parsed.keywords : []
        };
      }
    } catch (e) {
      // The forbidden-derived negatives + curator additions still make a
      // usable suite; record the failure honestly.
      logger.warn('head-suite.generate.llm_failed', { repo_id: repoId, error: e.message });
    }

    const positive = llm.positive
      .filter((p) => p && typeof p.query === 'string' && p.query.trim())
      .slice(0, nPositive)
      .map((p) => ({
        query: p.query.trim(),
        kind: 'positive',
        source: 'llm',
        reason: p.reason || ''
      }));
    const llmNegatives = llm.negative
      .filter((p) => p && typeof p.query === 'string' && p.query.trim())
      .slice(0, nNegative)
      .map((p) => ({
        query: p.query.trim(),
        kind: 'negative',
        source: 'llm',
        expected_repo: typeof p.expected_repo === 'string' ? p.expected_repo.trim() : null,
        reason: p.reason || ''
      }));

    const suiteKey = `s${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
    const now = new Date().toISOString();
    const suiteDoc = {
      _key: suiteKey,
      repo_id: repoId,
      kind: 'suite',
      suite_key: suiteKey,
      repo_version: repo.version || null,
      head_version: repo.head ? repo.head.version || null : null,
      created_at: now,
      created_by: (opts.actor && opts.actor.user_id) || 'system',
      payload: {
        generator: `llm:${process.env.VLLM_LLM_MODEL_ID || 'vllm'}`,
        sibling_names: siblings.map((s) => s.name),
        positive,
        negative: [...llmNegatives, ...forbiddenDerivedQueries(fm)],
        keywords: llm.keywords.filter((k) => typeof k === 'string'),
        notes: []
      }
    };
    await db.collection(HEAD_TEST_RUNS_COLLECTION).save(suiteDoc);
    span.setAttribute('okf.headsuite.positives', positive.length);
    span.setAttribute('okf.headsuite.negatives', suiteDoc.payload.negative.length);
    logger.info('head-suite.generated', {
      repo_id: repoId,
      suite_key: suiteKey,
      positives: positive.length,
      negatives: suiteDoc.payload.negative.length
    });
    return suiteDoc;
  });
}

// ---------- public: curator free-text additions ----------

async function addQueries(repoId, suiteKey, payload = {}, opts = {}) {
  return withSpan('okf.headsuite.add_queries', async (span) => {
    span.setAttribute('okf.repo_id', repoId);
    await repositoryService.getById(repoId, { authz: opts.authz });
    const queries = Array.isArray(payload.queries) ? payload.queries : [];
    const clean = queries
      .filter(
        (q) => q && typeof q.query === 'string' && q.query.trim() && (q.kind === 'positive' || q.kind === 'negative')
      )
      .slice(0, 50)
      .map((q) => ({
        query: q.query.trim(),
        kind: q.kind,
        source: 'manual',
        expected_repo: typeof q.expected_repo === 'string' ? q.expected_repo.trim() : null,
        reason: q.reason || ''
      }));
    if (!clean.length) {
      const err = new Error('queries[] with {query, kind: positive|negative} is required');
      err.code = 'VALIDATION_ERROR';
      err.status = 400;
      throw err;
    }
    const db = await dbService.getConnection();
    await ensureCollection(db);
    const suite = await loadSuiteDoc(db, repoId, suiteKey);
    if (suite.repo_id !== repoId) {
      const err = new Error(`suite ${suiteKey} not found for repo ${repoId}`);
      err.code = 'SUITE_NOT_FOUND';
      err.status = 404;
      throw err;
    }
    suite.payload.positive.push(...clean.filter((q) => q.kind === 'positive'));
    suite.payload.negative.push(...clean.filter((q) => q.kind === 'negative'));
    await db.collection(HEAD_TEST_RUNS_COLLECTION).replace(suite._key, suite);
    logger.info('head-suite.queries_added', { repo_id: repoId, suite_key: suiteKey, added: clean.length });
    return suite;
  });
}

// ---------- public: run ----------

async function runSuite(repoId, suiteKey, opts = {}) {
  return withSpan('okf.headsuite.run', async (span) => {
    span.setAttribute('okf.repo_id', repoId);
    const repo = await repositoryService.getById(repoId, { authz: opts.authz });
    const db = await dbService.getConnection();
    await ensureCollection(db);
    const suite = await loadSuiteDoc(db, repoId, suiteKey);
    if (suite.repo_id !== repoId) {
      const err = new Error(`suite ${suiteKey} not found for repo ${repoId}`);
      err.code = 'SUITE_NOT_FOUND';
      err.status = 404;
      throw err;
    }

    const all = [...suite.payload.positive.map((q) => ({ ...q })), ...suite.payload.negative.map((q) => ({ ...q }))];
    const results = [];
    for (const q of all) {
      try {
        const r = await headTestService.routingTest(repoId, { query: q.query, include_probes: false }, opts);
        results.push({
          query: q.query,
          kind: q.kind,
          source: q.source || 'llm',
          expected_repo: q.expected_repo || null,
          head_score: r.under_test.head_score,
          head_rank: r.under_test.head_rank,
          forbidden_cosine: r.under_test.forbidden_cosine !== undefined ? r.under_test.forbidden_cosine : null,
          head_margin: r.under_test.head_margin !== undefined ? r.under_test.head_margin : null,
          head_claimed:
            r.under_test.head_claimed === undefined || r.under_test.head_claimed === null
              ? null
              : !!r.under_test.head_claimed,
          winner: r.verdict.head_routing_winner,
          winner_name:
            r.verdict.head_routing_winner === repoId
              ? r.under_test.name
              : (r.siblings.find((s) => s.repo_id === r.verdict.head_routing_winner) || {}).name || null,
          under_test_wins_head: r.verdict.under_test_wins_head,
          margin: r.verdict.margin,
          sibling_count: r.siblings.length,
          top_competitors: r.siblings.slice(0, 3).map((s) => ({ name: s.name, head_score: s.head_score })),
          error: null
        });
      } catch (e) {
        results.push({
          query: q.query,
          kind: q.kind,
          source: q.source || 'llm',
          expected_repo: q.expected_repo || null,
          error: e.message
        });
      }
    }

    const summary = summarizeRun(results);
    const runKey = `r${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
    const runDoc = {
      _key: runKey,
      repo_id: repoId,
      kind: 'run',
      suite_key: suiteKey,
      repo_version: repo.version || null,
      head_version: repo.head ? repo.head.version || null : null,
      created_at: new Date().toISOString(),
      created_by: (opts.actor && opts.actor.user_id) || 'system',
      payload: {
        suite_created_at: suite.created_at,
        sibling_names: suite.payload.sibling_names || [],
        results,
        summary
      }
    };
    await db.collection(HEAD_TEST_RUNS_COLLECTION).save(runDoc);
    span.setAttribute('okf.headsuite.pass_rate', summary.pass_rate);
    logger.info('head-suite.run', {
      repo_id: repoId,
      suite_key: suiteKey,
      run_key: runKey,
      pass_rate: summary.pass_rate,
      steals: summary.steals.length
    });
    return runDoc;
  });
}

/**
 * Pass criteria + honest-empty semantics:
 *   positive → under_test_wins_head === true
 *   negative → under_test_wins_head === false, but ONLY evaluatable when
 *              the run saw at least one sibling (a one-repo universe
 *              a race against nobody — reported as null, not 100%.
 *   1-8a (David 2026-10-08: "under no circumstances … this should NEVER
 *   happen"): the forbidden/noise GATE makes negatives meaningful in ANY
 *   universe — a negative passes when the head does not CLAIM the query
 *   (head_claimed === false), which works solo. Legacy results without
 *   head_claimed fall back to the sibling-gated rank semantics.
 *   avg_margin over positives, null when no siblings (margin==1 is the
 *   solo-race artifact, not a quality signal).
 *   steals: positives lost, grouped by the winning sibling.
 */
function summarizeRun(results) {
  const done = results.filter((r) => !r.error);
  const positives = done.filter((r) => r.kind === 'positive');
  const negatives = done.filter((r) => r.kind === 'negative');
  const siblingCount = done.length ? Math.max(...done.map((r) => r.sibling_count || 0)) : 0;
  const posPassed = positives.filter((r) => r.under_test_wins_head).length;
  // Gate-era negatives are evaluatable solo; legacy (head_claimed null)
  // only with siblings.
  const negEvaluatable = negatives.filter((r) => r.head_claimed !== null || (r.sibling_count || 0) > 0);
  const negPassed = negEvaluatable.filter((r) =>
    r.head_claimed !== null ? r.head_claimed === false : !r.under_test_wins_head
  ).length;
  const evaluatable = positives.length + negEvaluatable.length;
  const margins = positives.filter((r) => (r.sibling_count || 0) > 0).map((r) => r.margin);

  const stealMap = new Map();
  for (const r of positives) {
    if (!r.under_test_wins_head && r.winner_name) {
      stealMap.set(r.winner_name, (stealMap.get(r.winner_name) || 0) + 1);
    }
  }

  return {
    n_queries: results.length,
    n_errors: results.length - done.length,
    sibling_count: siblingCount,
    positive_total: positives.length,
    positive_passed: posPassed,
    positive_pass_rate: positives.length ? posPassed / positives.length : null,
    negative_total: negatives.length,
    negative_evaluatable: negEvaluatable.length,
    negative_passed: negPassed,
    negative_pass_rate: negEvaluatable.length ? negPassed / negEvaluatable.length : null,
    pass_rate: evaluatable ? (posPassed + negPassed) / evaluatable : null,
    avg_margin: margins.length ? margins.reduce((a, b) => a + b, 0) / margins.length : null,
    steals: [...stealMap.entries()].map(([by_repo, count]) => ({ by_repo, count }))
  };
}

// ---------- public: list ----------

async function listRuns(repoId, payload = {}) {
  const limit = clampCount(payload.limit, 20, 100);
  const kind = ['run', 'suite', 'all'].includes(payload.kind) ? payload.kind : 'run';
  const db = await dbService.getConnection();
  await ensureCollection(db);
  // Bind @kind ONLY when the filter clause is present — Arango rejects
  // unused bind parameters (caught live by the MR-B smoke: kind=all 500'd
  // with "bind parameter 'kind' was not declared in the query").
  const kindFilter = kind === 'all' ? '' : 'FILTER d.kind == @kind ';
  const bindVars = { rid: repoId, lim: limit };
  if (kind !== 'all') bindVars.kind = kind;
  const cursor = await db.query(
    `FOR d IN ${HEAD_TEST_RUNS_COLLECTION} FILTER d.repo_id == @rid ` +
      kindFilter +
      'SORT d.created_at DESC LIMIT @lim RETURN MERGE(KEEP(d, ["_key", "repo_id", "kind", "suite_key", ' +
      '"repo_version", "head_version", "created_at", "created_by"]), ' +
      '{ summary: HAS(d.payload, "summary") ? d.payload.summary : null, ' +
      'positives: HAS(d.payload, "positive") ? LENGTH(d.payload.positive) : null, ' +
      'negatives: HAS(d.payload, "negative") ? LENGTH(d.payload.negative) : null })',
    bindVars
  );
  return cursor.all();
}

module.exports = {
  generateSuite,
  addQueries,
  runSuite,
  listRuns,
  // test surface
  _internals: {
    suitePrompt,
    summarizeRun,
    forbiddenDerivedQueries,
    parseJsonObject,
    clampCount,
    HEAD_TEST_RUNS_COLLECTION
  }
};
