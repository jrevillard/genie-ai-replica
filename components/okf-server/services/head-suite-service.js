// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
//
// head-suite-service — Story 1-8 MR-B (2026-10-08): test SUITES and
// run ANALYTICS for the OKF Head Tester / Routing Lab. Sits on top of
// head-test-service.routingTest (the two-leg simulation) and adds:
//
//   generateSuite(repoId, {n_positive, n_negative, n_negative_random})
//     ONE guided-JSON vLLM call given this repo's frontmatter + head
//     text + sibling head texts → positive queries (should route here),
//     confusable-sibling negatives (should route elsewhere), random
//     OFF-DOMAIN negatives (one per sampled unrelated topic) and META
//     noise queries about the system itself — plus deterministic
//     FORBIDDEN-derived negatives templated from the repo's own
//     forbidden list (no LLM). Persisted as a suite doc in
//     okf_head_test_runs.
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
// Origin channel (`source` — who authored the row; David 2026-10-08,
// "absolutely - all three"):
//   llm        — generator output (positives + confusable negatives)
//   forbidden  — templated from frontmatter.forbidden (must NOT route)
//   manual     — curator free-text
//   fallback   — code-level synthesis when the LLM omits/fails a class
// Evaluation class (`cls` — Story 1-8b, David 2026-10-09: "forbidden is
// forbidden — a hard contract, it should immediately score zero" +
// "the routing decision must be an affirmative claim"): every NEGATIVE
// row carries exactly one —
//   forbidden   — a frontmatter.forbidden query (veto gate)
//   confusable  — a competing repo's domain (only when siblings exist)
//   off-domain  — an unrelated domain from the random topic pool
//   meta        — noise about the retrieval system itself
// summarizeRun treats EVERY non-positive row as a negative; off-domain
// and meta rows are expected SUPPRESSED by the floor condition
// (ROUTE_HEAD_FLOOR) even in a one-repo universe.
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
// Story 1-8b — the OFF-DOMAIN RANDOM POOL (David: "MORE RANDOM
// adversarial negatives"). Deterministic list in code, far from any
// health domain; every generation call samples a random subset
// (n_negative_random) so no two suites probe the same noise.
const OFF_DOMAIN_TOPICS = [
  'geography',
  'sports',
  'cooking',
  'music',
  'astronomy',
  'motoring',
  'finance',
  'weather',
  'history',
  'fashion',
  'gaming',
  'agriculture',
  'maritime',
  'aviation',
  'literature',
  'physics',
  'pets',
  'architecture',
  'cinema',
  'gardening',
  'chess',
  'volcanoes',
  'sewing',
  'football'
];
// Deterministic fallback when the LLM omits the off-domain class —
// the class is NEVER empty (honest adversarial coverage without a model).
const OFF_DOMAIN_TEMPLATES = [
  'Give me a general overview of {topic}',
  'Latest news about {topic}',
  'What are the basic rules of {topic}?'
];
// Meta/noise fallbacks — queries about the retrieval system itself.
const META_TEMPLATES = [
  'What is the forbidden noise gate?',
  'How does the routing lab work?',
  'What does the head tester measure?'
];
const META_QUERY_COUNT = 3;

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

function suitePrompt(repo, fm, siblings, nPositive, nNegative, topics, nNearMiss) {
  const siblingText = siblings.length
    ? siblings.map((s) => `- "${s.name}"\n  ${String(s.text || '').slice(0, 400)}`).join('\n')
    : '(no other repository currently has a vectorized head)';
  // Confusable negatives need competitors to be confusable WITH — a solo
  // universe yields none (the class exists only when siblings exist).
  const nConfusable = siblings.length ? nNegative : 0;
  const forbiddenText = (fm.forbidden || []).join(', ') || '(none declared)';
  return `You are building a ROUTING TEST SUITE for one repository in a
multi-repository retrieval system. Each query will be embedded and the
system routes it to the repository whose "head" vector scores highest.
Good tags = the right repository wins; vague tags = routing bugs.

REPOSITORY UNDER TEST: "${repo.name}"
Its head text (what the router sees):
Topics: ${(fm.topic || []).join(', ')}
Entities: ${(fm.entity || []).join(', ')}
Scope: ${fm.scope || ''}
Explicitly NOT about: ${forbiddenText}
Summary: ${fm.summary || ''}

COMPETING REPOSITORIES (queries similar to their content but not to the
repository under test are the most valuable negative tests):
${siblingText}

Generate:
- ${nPositive} POSITIVE queries a real user would type when they want
  THIS repository's content. Use its topic/entity vocabulary. Vary the
  phrasing (question, keyword list, sentence). 5-15 words each.
- ${nConfusable} NEGATIVE queries that a user might MISTAKE for this
  repository's domain but actually belong to a COMPETING repository
  above. Set "expected_repo" to the EXACT competing repository name
  (empty string if there are no competitors). 5-15 words each.${
    nConfusable ? '' : '\n  There are NO competing repositories — return an empty "negative" array.'
  }
- ${nNearMiss} NEAR-MISS queries (the hardest negatives): use THIS
  repository's own vocabulary and adjacent topics, but ask for something
  it does NOT cover — a different intent (treatment, medications,
  providers, insurance, costs when the repo covers guidelines and
  prevention), an adjacent condition NOT in the entity list, or the
  wrong population. Example pattern: if the repo covers cancer
  SCREENING, a near miss is "best hospitals for cancer surgery".
- EXACTLY ONE query for EACH topic in this list. Every topic is a
  domain completely UNRELATED to this repository — a user asking about
  it must NEVER be routed here:
  ${topics.join(', ')}
- ${META_TEMPLATES.length} META/noise queries about the retrieval
  system itself (the routing lab, the head tester, the forbidden
  tags) — users probing the machinery rather than the content.
  Example: "${META_TEMPLATES[0]}"
- 5-8 KEYWORDS: single-domain terms strongly identifying THIS repository.

OUTPUT FORMAT (CRITICAL — the parser is strict, no synonyms):
  { "positive": [ {"query": "...", "reason": "<one sentence>"} ],
    "negative": [ {"query": "...", "expected_repo": "...", "reason": "<one sentence>"} ],
    "near_miss": [ {"query": "...", "reason": "<one sentence>"} ],
    "off_domain": [ {"topic": "<one topic from the list above>", "query": "...", "reason": "<one sentence>"} ],
    "meta": [ {"query": "...", "reason": "<one sentence>"} ],
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
    cls: 'forbidden',
    source: 'forbidden',
    expected_repo: null,
    reason: `derived from the repo's own forbidden tag "${tag}" — the head must not win it`
  }));
}

/**
 * RANDOM subset of the off-domain pool (fresh adversaries every
 * generation — the pool stays deterministic in code, the selection
 * does not).
 */
function sampleTopics(n) {
  const pool = OFF_DOMAIN_TOPICS.slice();
  const picked = [];
  while (picked.length < n && pool.length) {
    picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return picked;
}

/**
 * Off-domain rows (cls 'off-domain', Story 1-8b): one query per SAMPLED
 * topic. LLM-authored where the model answered for the topic, code-level
 * template synthesis for every topic it skipped/omitted — the class is
 * NEVER empty. These rows are expected to be suppressed by the FLOOR
 * condition (ROUTE_HEAD_FLOOR), not by the forbidden veto.
 */
function offDomainQueries(llmOffDomain, topics) {
  const byTopic = new Map();
  for (const r of Array.isArray(llmOffDomain) ? llmOffDomain : []) {
    if (r && typeof r.query === 'string' && r.query.trim() && typeof r.topic === 'string' && r.topic.trim()) {
      byTopic.set(r.topic.trim().toLowerCase(), r.query.trim());
    }
  }
  return topics.map((topic, i) => {
    const llmQuery = byTopic.get(topic.toLowerCase());
    if (llmQuery) {
      return {
        query: llmQuery,
        kind: 'negative',
        cls: 'off-domain',
        source: 'llm',
        topic,
        expected_repo: null,
        reason: `unrelated domain (${topic}) — the floor gate must suppress it`
      };
    }
    return {
      query: OFF_DOMAIN_TEMPLATES[i % OFF_DOMAIN_TEMPLATES.length].replace('{topic}', topic),
      kind: 'negative',
      cls: 'off-domain',
      source: 'fallback',
      topic,
      expected_repo: null,
      reason: `unrelated domain (${topic}) — deterministic fallback; the floor gate must suppress it`
    };
  });
}

/**
 * Meta/noise rows (cls 'meta', Story 1-8b): queries about the retrieval
 * system itself. LLM-authored when provided, deterministic fallback
 * otherwise — the class is NEVER empty. Expected floor-suppressed.
 */
function metaQueries(llmMeta) {
  const rows = (Array.isArray(llmMeta) ? llmMeta : [])
    .filter((m) => m && typeof m.query === 'string' && m.query.trim())
    .slice(0, META_QUERY_COUNT)
    .map((m) => ({
      query: m.query.trim(),
      kind: 'negative',
      cls: 'meta',
      source: 'llm',
      expected_repo: null,
      reason: 'noise/meta probe — the system itself, not repo content; must be floor-suppressed'
    }));
  if (rows.length) return rows;
  return META_TEMPLATES.map((query) => ({
    query,
    kind: 'negative',
    cls: 'meta',
    source: 'fallback',
    expected_repo: null,
    reason: 'noise/meta probe — deterministic fallback; must be floor-suppressed'
  }));
}

/**
 * Near-miss rows (cls 'near-miss', Story 1-8c): queries using the repo's
 * OWN vocabulary for something it does NOT cover — wrong intent, adjacent
 * condition, wrong population. The hardest negative class. LLM-authored
 * when provided; deterministic fallback templated from the repo's ENTITIES
 * with wrong-intent frames so the class is never empty.
 */
const NEAR_MISS_TEMPLATES = [
  'Best hospitals for {entity} surgery',
  'Medication costs for {entity} treatment',
  'Insurance coverage for {entity} care',
  'Support groups for {entity} patients and families',
  'Clinical trials recruiting {entity} patients'
];

function nearMissQueries(llmNearMiss, fm, n) {
  const rows = (Array.isArray(llmNearMiss) ? llmNearMiss : [])
    .filter((m) => m && typeof m.query === 'string' && m.query.trim())
    .slice(0, n)
    .map((m) => ({
      query: m.query.trim(),
      kind: 'negative',
      cls: 'near-miss',
      source: 'llm',
      expected_repo: null,
      reason: m.reason || 'near-miss: repo vocabulary, out-of-scope intent — the head must not win it'
    }));
  if (rows.length >= n) return rows;
  const entities = (Array.isArray(fm.entity) ? fm.entity : []).filter((e) => typeof e === 'string' && e.trim());
  for (let i = 0; rows.length < n && entities.length; i += 1) {
    const entity = entities[i % entities.length];
    const query = NEAR_MISS_TEMPLATES[(i + entities.length) % NEAR_MISS_TEMPLATES.length].replace('{entity}', entity);
    if (rows.some((r) => r.query.toLowerCase() === query.toLowerCase())) continue;
    rows.push({
      query,
      kind: 'negative',
      cls: 'near-miss',
      source: 'fallback',
      expected_repo: null,
      reason: `near-miss: ${entity} vocabulary, out-of-scope intent (deterministic fallback)`
    });
  }
  return rows;
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
    // n_negative budgets the CONFUSABLE + FORBIDDEN classes only — the
    // random off-domain pool is sized separately by n_negative_random.
    const nNegative = clampCount(payload.n_negative, 6, 15);
    const nRandom = clampCount(payload.n_negative_random, 4, 12);
    // Story 1-8c — user-controlled class sizes (David: "give the lab user
    // the ability to control the number of test queries").
    const nMeta = clampCount(payload.n_meta, 3, 8);
    const nNearMiss = clampCount(payload.n_near_miss, 4, 10);
    const randomTopics = sampleTopics(nRandom);

    const db = await dbService.getConnection();
    await ensureCollection(db);
    const siblings = await loadSiblingContext(db, repoId);

    const prompt = suitePrompt(repo, fm, siblings, nPositive, nNegative, randomTopics, nNearMiss);
    let llm = { positive: [], negative: [], off_domain: [], meta: [], near_miss: [], keywords: [] };
    try {
      // temperature 0.7 (not the extraction default 0.0) — adversarial
      // negatives must VARY generation to generation; 2200 max tokens —
      // four row classes per call now.
      const resp = await frontmatterService.vllmChatCompletions([{ role: 'user', content: prompt }], {
        maxTokens: 2200,
        temperature: 0.7
      });
      const content = resp.data && resp.data.choices && resp.data.choices[0] && resp.data.choices[0].message;
      const parsed = parseJsonObject(content && content.content);
      if (parsed) {
        llm = {
          positive: Array.isArray(parsed.positive) ? parsed.positive : [],
          negative: Array.isArray(parsed.negative) ? parsed.negative : [],
          off_domain: Array.isArray(parsed.off_domain) ? parsed.off_domain : [],
          meta: Array.isArray(parsed.meta) ? parsed.meta : [],
          near_miss: Array.isArray(parsed.near_miss) ? parsed.near_miss : [],
          keywords: Array.isArray(parsed.keywords) ? parsed.keywords : []
        };
      }
    } catch (e) {
      // The forbidden-derived + fallback negatives + curator additions
      // still make a usable suite; record the failure honestly.
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
    const llmNegatives = siblings.length
      ? llm.negative
          .filter((p) => p && typeof p.query === 'string' && p.query.trim())
          .slice(0, nNegative)
          .map((p) => ({
            query: p.query.trim(),
            kind: 'negative',
            cls: 'confusable',
            source: 'llm',
            expected_repo: typeof p.expected_repo === 'string' ? p.expected_repo.trim() : null,
            reason: p.reason || ''
          }))
      : [];
    const offDomain = offDomainQueries(llm.off_domain, randomTopics);
    const meta = metaQueries(llm.meta).slice(0, nMeta);
    const nearMiss = nearMissQueries(llm.near_miss, fm, nNearMiss);

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
        off_domain_topics: randomTopics,
        // Story 1-8d — the forbidden list this suite was generated against.
        // The UI flags "tags changed since generation" when it drifts (the
        // forbidden-derived rows go stale on any tag change).
        forbidden_snapshot: [...(fm.forbidden || [])],
        positive,
        negative: [...llmNegatives, ...forbiddenDerivedQueries(fm), ...nearMiss, ...offDomain, ...meta],
        keywords: llm.keywords.filter((k) => typeof k === 'string'),
        notes: []
      }
    };
    await db.collection(HEAD_TEST_RUNS_COLLECTION).save(suiteDoc);
    const byClass = suiteDoc.payload.negative.reduce((m, q) => {
      const k = q.cls || 'confusable';
      m[k] = (m[k] || 0) + 1;
      return m;
    }, {});
    span.setAttribute('okf.headsuite.positives', positive.length);
    span.setAttribute('okf.headsuite.negatives', suiteDoc.payload.negative.length);
    span.setAttribute('okf.headsuite.offdomain', byClass['off-domain'] || 0);
    span.setAttribute('okf.headsuite.meta', byClass.meta || 0);
    span.setAttribute('okf.headsuite.nearmiss', byClass['near-miss'] || 0);
    logger.info('head-suite.generated', {
      repo_id: repoId,
      suite_key: suiteKey,
      positives: positive.length,
      negatives: suiteDoc.payload.negative.length,
      by_class: byClass,
      off_domain_topics: randomTopics
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
          cls: q.cls || null,
          source: q.source || 'llm',
          expected_repo: q.expected_repo || null,
          head_score: r.under_test.head_score,
          head_rank: r.under_test.head_rank,
          forbidden_cosine: r.under_test.forbidden_cosine !== undefined ? r.under_test.forbidden_cosine : null,
          head_margin: r.under_test.head_margin !== undefined ? r.under_test.head_margin : null,
          head_claim: r.under_test.head_claim || null,
          tag_veto: r.under_test.tag_veto || null,
          head_claimed:
            r.under_test.head_claimed === undefined || r.under_test.head_claimed === null
              ? null
              : !!r.under_test.head_claimed,
          suppress_reason: suppressReason(q, r.under_test),
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
          cls: q.cls || null,
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
 * Story 1-8b — WHY a negative was suppressed, in the curator's terms
 * (the Lab teaches which knob — and which tag — to adjust):
 *   head_claim 'floor' → 'off-domain' (ROUTE_HEAD_FLOOR suppressed noise)
 *   head_claim 'veto'  → 'forbidden:<tag>' (ROUTE_FORBIDDEN_TAG_MAX veto)
 * Positive rows, non-suppressed rows and legacy rows (no gate data) → null.
 */
function suppressReason(q, ut) {
  if (!q || !ut || q.kind === 'positive' || ut.head_claimed !== false) return null;
  if (ut.head_claim === 'floor') return 'off-domain';
  if (ut.head_claim === 'veto') return `forbidden:${ut.tag_veto}`;
  return null;
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
 *   1-8b: EVERY non-positive row is a negative — cls ∈ forbidden |
 *   confusable | off-domain | meta (manual rows carry no cls but keep
 *   kind='negative'); off-domain and meta rows are expected suppressed
 *   via the floor condition even in a one-repo universe.
 *   avg_margin over positives, null when no siblings (margin==1 is the
 *   solo-race artifact, not a quality signal).
 *   steals: positives lost, grouped by the winning sibling.
 */
function summarizeRun(results) {
  const done = results.filter((r) => !r.error);
  const positives = done.filter((r) => r.kind === 'positive');
  const negatives = done.filter((r) => r.kind !== 'positive');
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

/**
 * Story 1-8c — BATCH advice for a suite run's failures (David: gating
 * must never become a per-query full-time job). Loads the LATEST run of
 * the suite, collects every negative-classified query that CLAIMED, and
 * makes ONE LLM call proposing a consolidated set of new forbidden tags
 * covering all failing subjects. Per-query notes explain each failure.
 */
async function explainSuiteFailures(repoId, suiteKey, _opts = {}) {
  return withSpan('okf.headsuite.explain_failures', async (span) => {
    span.setAttribute('okf.repo_id', repoId);
    const db = await dbService.getConnection();
    await ensureCollection(db);
    const runs = await (
      await db.query(
        'FOR r IN okf_head_test_runs FILTER r.repo_id == @k && r.suite_key == @s && r.kind == "run" ' +
          'SORT r.created_at DESC LIMIT 1 RETURN r',
        { k: repoId, s: suiteKey }
      )
    ).all();
    const run = runs[0];
    if (!run) {
      const err = new Error(`no run found for suite ${suiteKey} — run the suite first`);
      err.code = 'RUN_NOT_FOUND';
      err.status = 404;
      throw err;
    }
    const failing = (run.payload.results || []).filter(
      (q) => q && q.kind && q.kind !== 'positive' && q.head_claimed
    );
    // Story 1-8d — the loop must see BOTH failure kinds. Killed positives
    // are the over-suppression signature: aggregate their veto attribution
    // so the advice is tag REMOVAL (one-click in the Lab), not addition.
    const positiveKills = (run.payload.results || []).filter(
      (q) => q && q.kind === 'positive' && q.head_claimed === false
    );
    const vetoCounts = {};
    const marginKilled = [];
    for (const q of positiveKills) {
      if (q.tag_veto) vetoCounts[q.tag_veto] = (vetoCounts[q.tag_veto] || 0) + 1;
      else marginKilled.push(q.query);
    }
    const removalSuggestions = Object.entries(vetoCounts)
      .map(([tag, killed]) => ({ tag, killed }))
      .sort((a, b) => b.killed - a.killed);
    const fm = await frontmatterService.readFrontmatterFromRepoDoc(repoId);
    const out = {
      suite_key: suiteKey,
      run_key: run._key || run.suite_key,
      run_created_at: run.created_at,
      failing_count: failing.length,
      failing_queries: failing.map((q) => ({ query: q.query, cls: q.cls || null, head_claim: q.head_claim || null })),
      suggested_tags: [],
      rejected: [],
      removal_suggestions: removalSuggestions,
      positive_failures: {
        count: positiveKills.length,
        veto_counts: vetoCounts,
        margin_killed: marginKilled.length
      },
      source: 'none',
      note: ''
    };
    if (!failing.length && !positiveKills.length) {
      out.note = 'no failures in the latest run — nothing to explain';
      return out;
    }
    let suggestionTags = [];
    if (failing.length) {
      try {
        const prompt = `A retrieval repository's routing test suite has failing NEGATIVE queries:
each one is WRONGLY routed to this repository and must be excluded.

REPOSITORY scope — topics: ${(fm.topic || []).join(', ')}; entities: ${(fm.entity || []).join(', ')};
already forbidden: ${(fm.forbidden || []).join(', ') || '(none)'}; summary: ${fm.summary || ''}

FAILING QUERIES:
${failing.map((q, i) => `${i + 1}. ${q.query}`).join('\n')}

Propose UP TO 5 NEW forbidden tags (lowercase kebab-case, 1-3 words each)
that together cover EVERY failing query's subject, that the repository's
scope genuinely EXCLUDES, that do not overlap the already-forbidden list,
and that do not exclude the repository's own topics/entities. Prefer broad
subject tags over query-specific ones. Respond with ONLY a JSON object:
{"tags": ["...", "..."], "notes": "<one sentence covering rationale>"}`;
        const resp = await frontmatterService.vllmChatCompletions([{ role: 'user', content: prompt }], {
          maxTokens: 300,
          temperature: 0.2
        });
        const content = resp.data && resp.data.choices && resp.data.choices[0] && resp.data.choices[0].message;
        const parsed = parseJsonObject(content && content.content);
        suggestionTags = ((parsed && parsed.tags) || [])
          .filter((t) => typeof t === 'string' && t.trim())
          .map((t) => t.trim().toLowerCase().replace(/\s+/g, '-'))
          .filter((t) => !(fm.forbidden || []).includes(t))
          .slice(0, 5);
        if (parsed && typeof parsed.notes === 'string') out.note = parsed.notes;
      } catch (e) {
        logger.warn('head-suite.explain.llm_failed', { repo_id: repoId, suite_key: suiteKey, error: e.message });
        out.note = 'the suggestion model is unreachable — review the failing queries against the declared scope manually';
      }
      // Story 1-8d — the mechanical guardrail (self-subject + duplicate
      // screening). Prompt constraints alone failed in the 2026-10-09
      // poisoning; a screened-out proposal NEVER reaches the UI chips.
      if (suggestionTags.length) {
        const headTestService = require('./head-test-service');
        const guard = await headTestService.guardSuggestions(repoId, suggestionTags, opts);
        out.suggested_tags = guard.accepted;
        out.rejected = guard.rejected;
        out.source = guard.accepted.length ? 'llm' : 'guardrail';
      }
    } else {
      out.note = 'no wrongly-claimed negatives — the failures are suppressed positives (see removal_suggestions)';
    }
    // Story 1-8d — persist the advice so cycles are auditable.
    try {
      await db.collection(HEAD_TEST_RUNS_COLLECTION).save({
        _key: `x${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
        repo_id: repoId,
        kind: 'explain',
        suite_key: suiteKey,
        run_key: out.run_key,
        created_at: new Date().toISOString(),
        created_by: (opts.actor && opts.actor.user_id) || 'system',
        payload: out
      });
    } catch (e) {
      logger.warn('head-suite.explain.persist_failed', { repo_id: repoId, error: e.message });
    }
    span.setAttribute('okf.headsuite.failing', failing.length);
    span.setAttribute('okf.headsuite.positive_kills', positiveKills.length);
    span.setAttribute('okf.headsuite.suggested', out.suggested_tags.length);
    span.setAttribute('okf.headsuite.removals', removalSuggestions.length);
    logger.info('head-suite.explain_failures.done', {
      repo_id: repoId,
      suite_key: suiteKey,
      failing: failing.length,
      positive_kills: positiveKills.length,
      suggested: out.suggested_tags.length,
      removals: removalSuggestions.length
    });
    return out;
  });
}

module.exports = {
  generateSuite,
  addQueries,
  runSuite,
  listRuns,
  explainSuiteFailures,
  // test surface
  _internals: {
    suitePrompt,
    summarizeRun,
    suppressReason,
    forbiddenDerivedQueries,
    offDomainQueries,
    metaQueries,
    nearMissQueries,
    sampleTopics,
    OFF_DOMAIN_TOPICS,
    OFF_DOMAIN_TEMPLATES,
    META_TEMPLATES,
    parseJsonObject,
    clampCount,
    HEAD_TEST_RUNS_COLLECTION
  }
};
