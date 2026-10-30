// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
//
// head-suite-service — Story 1-8 MR-B (2026-10-08): test SUITES and
// run ANALYTICS for the OKF Testing Lab. Sits on top of
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
const { isArangoNotFound } = require('./arango-errors');
const { withSpan } = require('../shared-lib/tracing');
const { createHash } = require('node:crypto');
const dbService = require('../shared-lib/db-connection-service');

const frontmatterService = require('./frontmatter-service');
const repositoryService = require('./repository-service');
const headTestService = require('./head-test-service');

const HEAD_TEST_RUNS_COLLECTION = 'okf_head_test_runs';
// Story 1-8f — per-class generation ceilings ("any number of tests for any
// type"). The LLM call is batched at GEN_BATCH rows per class per call, so
// these bound the DOC, not the model output.
const CLASS_MAX = { positive: 1000, negative: 500, random: 500, meta: 500, nearMiss: 500 };
const GEN_BATCH = 30;
// Story 1-8d — the advisor predicts the production gate LOCALLY (embed +
// cosine), so it can simulate tag-set changes before recommending them.
// These mirror retriever config.py / head-test-service.js (same env names,
// same defaults) — keep the three definitions in sync.
const GATE_MARGIN = parseFloat(process.env.RETRIEVER_ROUTE_HEAD_MARGIN || '0.01');
const GATE_FLOOR = parseFloat(process.env.RETRIEVER_ROUTE_HEAD_FLOOR || '0.55');
const GATE_TAG_MAX = parseFloat(process.env.RETRIEVER_ROUTE_FORBIDDEN_TAG_MAX || '0.55');
// Story 1-8e — ANTI-TREADMILL DAMPING (David 2026-10-09: the live cycle
// added one admin tag per advisor round for +1 suppressed negative each —
// "this type of gating must not become a long term full time job"). A tag
// that buys positives back is exempt (recovery, not noise-fitting); a tag
// that only suppresses negatives must clear a real margin, and one advisor
// run may add at most ADVISOR_MAX_ADDS tags so the curator re-evaluates
// between steps.
const ADVISOR_MIN_NEGATIVE_GAIN = Math.max(1, parseInt(process.env.OKF_ADVISOR_MIN_NEGATIVE_GAIN || '2', 10));
const ADVISOR_MAX_ADDS = Math.max(1, parseInt(process.env.OKF_ADVISOR_MAX_ADDS || '3', 10));
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
  'How does the testing lab work?',
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

function suitePrompt(repo, fm, siblings, nPositive, nNegative, topics, nNearMiss, nMeta = 3) {
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
- ${nMeta} META/noise queries about the retrieval
  system itself (the testing lab, the head tester, the forbidden
  tags) — users probing the machinery rather than the content.
  Example: "${META_TEMPLATES[0]}"
- 5-8 KEYWORDS: single-domain terms strongly identifying THIS repository.

UNIQUENESS (CRITICAL — duplicated queries are DISCARDED and the count comes
up short; 2026-10-10 live: one response returned the same query 3× and put
the same text in two classes):
- Every query string MUST be unique across the WHOLE response — no repeats
  within a class, and NEVER the same query in two different classes (one
  query cannot be both positive and negative).
- Vary substance, not just phrasing: each query asks about a DIFFERENT
  facet (a different entity, step, requirement, penalty, or intent).

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
  // Story 1-8f — the pool is finite (~dozens); "any number" of off-domain
  // rows means topics CYCLE when n exceeds the pool (the LLM + templates
  // vary the query per round). Shuffled draw for the first pass, then
  // cyclic continuation.
  const pool = OFF_DOMAIN_TOPICS.slice();
  const picked = [];
  while (picked.length < n && pool.length) {
    picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  let cursor = 0;
  while (picked.length < n && OFF_DOMAIN_TOPICS.length) {
    picked.push(OFF_DOMAIN_TOPICS[cursor % OFF_DOMAIN_TOPICS.length]);
    cursor += 1;
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
function metaQueries(llmMeta, nMeta = META_QUERY_COUNT) {
  const rows = (Array.isArray(llmMeta) ? llmMeta : [])
    .filter((m) => m && typeof m.query === 'string' && m.query.trim())
    .map((m) => ({
      query: m.query.trim(),
      kind: 'negative',
      cls: 'meta',
      source: 'llm',
      expected_repo: null,
      reason: 'noise/meta probe — the system itself, not repo content; must be floor-suppressed'
    }));
  // Story 1-8f — fill to the requested count (LLM rows first, then the
  // deterministic templates cycling); "any number" applies to meta too.
  const out = [];
  let i = 0;
  while (out.length < nMeta && i < rows.length) out.push(rows[i++]);
  let t = 0;
  while (out.length < nMeta && META_TEMPLATES.length) {
    const query = META_TEMPLATES[t % META_TEMPLATES.length];
    t += 1;
    if (out.some((r) => r.query === query)) {
      if (t > nMeta * 2) break; // all templates used; never fabricate dups
      continue;
    }
    out.push({
      query,
      kind: 'negative',
      cls: 'meta',
      source: 'fallback',
      expected_repo: null,
      reason: 'noise/meta probe — deterministic fallback; must be floor-suppressed'
    });
  }
  return out;
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

// 1-8e — the tuning identity of a run: which forbidden tag set produced
// this score. Stored on every run doc so the Lab's history can group runs
// by configuration; the hash (8 hex chars) is the display identity.
function tagsetOf(repo) {
  const forbidden = Array.isArray(repo.frontmatter && repo.frontmatter.forbidden)
    ? repo.frontmatter.forbidden.map(String)
    : [];
  const norm = forbidden.map((t) => t.toLowerCase()).sort();
  return {
    forbidden,
    hash: norm.length ? createHash('sha1').update(norm.join('|')).digest('hex').slice(0, 8) : 'empty'
  };
}

function loadSuiteDoc(db, repoId, suiteKey) {
  return db
    .collection(HEAD_TEST_RUNS_COLLECTION)
    .document(suiteKey)
    .catch((e) => {
      if (isArangoNotFound(e)) {
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
    // Story 1-8f — explicit 0 is a REQUEST (a positives-only suite), not a
    // missing value: zeroable() distinguishes absent (fallback) from 0.
    const zeroable = (v, fallback, max) => (v === 0 ? 0 : clampCount(v, fallback, max));
    const nPositive = zeroable(payload.n_positive, 8, CLASS_MAX.positive);
    // n_negative budgets the CONFUSABLE + FORBIDDEN classes only — the
    // random off-domain pool is sized separately by n_negative_random.
    // Story 1-8f (David: "we need to be able to generate any number of
    // tests for any type") — the old caps (20/15/12/8/10) silently ate his
    // n_positive=100. The caps now sit at a practical 1000-class ceiling;
    // the LLM call is BATCHED (GEN_BATCH rows per class per call) so a
    // large ask cannot blow the guided-JSON token budget.
    const nNegative = zeroable(payload.n_negative, 6, CLASS_MAX.negative);
    const nRandom = zeroable(payload.n_negative_random, 4, CLASS_MAX.random);
    const nMeta = zeroable(payload.n_meta, 3, CLASS_MAX.meta);
    const nNearMiss = zeroable(payload.n_near_miss, 4, CLASS_MAX.nearMiss);
    const suiteName = typeof payload.name === 'string' ? payload.name.trim().slice(0, 80) : '';
    const randomTopics = sampleTopics(nRandom);

    const db = await dbService.getConnection();
    await ensureCollection(db);
    const siblings = await loadSiblingContext(db, repoId);

    const llm = { positive: [], negative: [], off_domain: [], meta: [], near_miss: [], keywords: [] };
    // Provenance: the model the generation calls actually used (stamped
    // on each response by vllmChatCompletions) — kept for the suite doc.
    let lastGenModel = null;
    try {
      // temperature 0.7 (not the extraction default 0.0) — adversarial
      // negatives must VARY generation to generation. Story 1-8f: the ask
      // is BATCHED — GEN_BATCH rows per class per call, merging + deduping
      // until every class is satisfied, no progress, or a hard call guard.
      // One giant guided-JSON call truncates at the token budget (the
      // reason the old 20-positive cap existed).
      const norm = (s) =>
        String(s || '')
          .trim()
          .toLowerCase();
      const seen = {
        positive: new Set(),
        negative: new Set(),
        off_domain: new Set(),
        meta: new Set(),
        near_miss: new Set()
      };
      const takeNew = (rows, klass) => {
        const out = [];
        for (const r of Array.isArray(rows) ? rows : []) {
          const key = r && typeof r.query === 'string' ? norm(r.query) : '';
          if (!key || seen[klass].has(key)) continue;
          seen[klass].add(key);
          out.push(r);
        }
        return out;
      };
      const topicSeen = new Set();
      const takeTopics = (arr) => arr.filter((t) => !topicSeen.has(t) && topicSeen.add(t));
      const keywordsAdd = (arr) => {
        llm.keywords = [
          ...llm.keywords,
          ...(Array.isArray(arr) ? arr : []).filter((k) => typeof k === 'string' && k && !llm.keywords.includes(k))
        ];
      };
      const MAX_CALLS = 60;
      for (let call = 0; call < MAX_CALLS; call += 1) {
        const needP = nPositive - llm.positive.length;
        const needN = siblings.length ? nNegative - llm.negative.length : 0;
        const needNm = nNearMiss - llm.near_miss.length;
        const needM = nMeta - llm.meta.length;
        const needR = nRandom - llm.off_domain.length;
        if (needP <= 0 && needN <= 0 && needNm <= 0 && needM <= 0 && needR <= 0) break;
        const cP = Math.max(0, Math.min(needP, GEN_BATCH));
        const cN = Math.max(0, Math.min(needN, GEN_BATCH));
        const cNm = Math.max(0, Math.min(needNm, GEN_BATCH));
        const cM = Math.max(0, Math.min(needM, GEN_BATCH));
        const callTopics = takeTopics(sampleTopics(Math.max(needR, 0)));
        const rowsInCall = cP + cN + cNm + cM + callTopics.length;
        if (!rowsInCall) break;
        const callPrompt = suitePrompt(repo, fm, siblings, cP, cN, callTopics, cNm, cM);
        const resp = await frontmatterService.vllmChatCompletions([{ role: 'user', content: callPrompt }], {
          // ~34 tokens per row + JSON overhead, scaled to the chunk — a
          // fixed budget truncated large asks mid-JSON.
          maxTokens: Math.min(6000, 500 + 34 * rowsInCall),
          temperature: 0.7
        });
        if (resp.model) lastGenModel = resp.model;
        const content = resp.data && resp.data.choices && resp.data.choices[0] && resp.data.choices[0].message;
        const parsed = parseJsonObject(content && content.content);
        const before =
          llm.positive.length + llm.negative.length + llm.near_miss.length + llm.meta.length + llm.off_domain.length;
        if (parsed) {
          llm.positive.push(...takeNew(parsed.positive, 'positive'));
          llm.negative.push(...takeNew(parsed.negative, 'negative'));
          llm.near_miss.push(...takeNew(parsed.near_miss, 'near_miss'));
          llm.meta.push(...takeNew(parsed.meta, 'meta'));
          llm.off_domain.push(...takeNew(parsed.off_domain, 'off_domain'));
          keywordsAdd(parsed.keywords);
        }
        const after =
          llm.positive.length + llm.negative.length + llm.near_miss.length + llm.meta.length + llm.off_domain.length;
        if (after === before) {
          // No progress this call (LLM repeated/exhausted) — stop; the
          // per-class deterministic fallbacks fill the remainder honestly.
          logger.warn('head-suite.generate.no_progress', {
            repo_id: repoId,
            call,
            have: {
              p: llm.positive.length,
              n: llm.negative.length,
              nm: llm.near_miss.length,
              m: llm.meta.length,
              r: llm.off_domain.length
            },
            want: { p: nPositive, n: siblings.length ? nNegative : 0, nm: nNearMiss, m: nMeta, r: nRandom }
          });
          break;
        }
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
    const meta = metaQueries(llm.meta, nMeta);
    const nearMiss = nearMissQueries(llm.near_miss, fm, nNearMiss);

    // 1-8f2: the key can be PRE-MINTED (async generation — the HTTP
    // request returns 202 immediately and the UI polls for this key).
    const suiteKey = opts.suiteKey || `s${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
    const now = new Date().toISOString();
    // 1-8g — a corpus-based DEFAULT name ("<Repo> suite N", N = the running
    // count of this repo's suites) so the Saved-suites list is scannable
    // without renaming; the curator can always override it inline (the
    // 1-8f rename endpoint).
    let finalName = suiteName;
    if (!finalName) {
      const countRows = await (
        await db.query(
          `FOR d IN ${HEAD_TEST_RUNS_COLLECTION} FILTER d.repo_id == @rid && d.kind == 'suite' COLLECT WITH COUNT INTO n RETURN n`,
          { rid: repoId }
        )
      ).all();
      finalName = `${repo.name || 'Repository'} suite ${Number(countRows[0] || 0) + 1}`.slice(0, 80);
    }
    // 1-8g-h: the classes are assembled independently and DO overlap (live:
    // "Map the distribution of slaughterhouses across the country." landed
    // ×3 in one suite, 16/66 rows duplicated) — dedup by normalized text,
    // first occurrence wins, order preserved; a text that is already a
    // positive is dropped from the negatives entirely (a row can never sit
    // in both arrays — the same contradiction updateSuiteRows rejects).
    const normText = (s) =>
      String(s || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
    const seenPos = new Set();
    const dedupedPositives = positive.filter((q) => {
      const k = normText(q.query);
      if (seenPos.has(k)) return false;
      seenPos.add(k);
      return true;
    });
    const seenNeg = new Set();
    const dedupedNegatives = [
      ...llmNegatives,
      ...forbiddenDerivedQueries(fm),
      ...nearMiss,
      ...offDomain,
      ...meta
    ].filter((q) => {
      const k = normText(q.query);
      if (seenPos.has(k) || seenNeg.has(k)) return false;
      seenNeg.add(k);
      return true;
    });
    const suiteDoc = {
      _key: suiteKey,
      repo_id: repoId,
      kind: 'suite',
      suite_key: suiteKey,
      // Story 1-8f — the curator's name for the suite (optional; the key
      // remains the identity). Rendered in the Saved-suites table.
      // 1-8g — defaults to "<Repo> suite N" when the curator names nothing.
      name: finalName,
      repo_version: repo.version || null,
      head_version: repo.head ? repo.head.version || null : null,
      created_at: now,
      created_by: (opts.actor && opts.actor.user_id) || 'system',
      payload: {
        // Provenance: the model that generated this suite — the stamp from
        // the generation calls when they ran (covers named-config routing
        // too), else the deployment pin or the served model (base + key
        // travel together in deploymentDiscoveredModelId). 'vllm' survives
        // only when nothing answered at all.
        generator: lastGenModel ? `llm:${lastGenModel}` : 'none',
        sibling_names: siblings.map((s) => s.name),
        off_domain_topics: randomTopics,
        // Story 1-8d — the forbidden list this suite was generated against.
        // The UI flags "tags changed since generation" when it drifts (the
        // forbidden-derived rows go stale on any tag change).
        forbidden_snapshot: [...(fm.forbidden || [])],
        positive: dedupedPositives,
        negative: dedupedNegatives,
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
    span.setAttribute('okf.headsuite.positives', dedupedPositives.length);
    span.setAttribute('okf.headsuite.negatives', suiteDoc.payload.negative.length);
    span.setAttribute('okf.headsuite.offdomain', byClass['off-domain'] || 0);
    span.setAttribute('okf.headsuite.meta', byClass.meta || 0);
    span.setAttribute('okf.headsuite.nearmiss', byClass['near-miss'] || 0);
    logger.info('head-suite.generated', {
      repo_id: repoId,
      suite_key: suiteKey,
      positives: dedupedPositives.length,
      negatives: suiteDoc.payload.negative.length,
      by_class: byClass,
      off_domain_topics: randomTopics
    });
    return suiteDoc;
  });
}

// ---------- public: curator free-text additions ----------

// Story 1-8f2 — ASYNC generation. A large ask (100 positives) batches
// across several LLM calls and takes MINUTES; the synchronous request dies
// at the gateway long before (live 2026-10-09: the suite saved at minute 5
// while the browser had given up at 60s). beginSuiteGeneration pre-mints
// the key, kicks the worker DETACHED, and returns immediately; the UI
// polls GET /routing-testsuite/:key until the doc lands. One generation
// per repo at a time (a second begin while one is in flight is a 409).
const suiteGenInFlight = new Map(); // repo_id -> suite_key
// 1-8g-u: the last async generation FAILURE per repo — the poll consults
// it so a dead generation answers {status:'failed', error} instead of
// 404-ing forever (live 2026-10-11: a tag-less repo's generation died on
// the NO_FRONTMATTER guard in its first millisecond, `.finally()` cleared
// the in-flight marker, and every 3s poll logged "suite not found" until
// the UI timed out — the real error only ever reached the logs).
const suiteGenFailure = new Map(); // repo_id -> {suite_key, code, message, at}

// 1-8f2: is this (repo, key) pair a LIVE async generation? getSuite consults
// this before its 404 — a minted key that is still generating must answer
// {suite_key, status:'generating'} (the poll's keep-waiting signal), not
// SUITE_NOT_FOUND. Live 2026-10-09: every 2.5s poll of an in-flight key
// logged error-level "Unhandled OKF error … suite not found" and painted
// browser-console 404s for the whole ~107s a 100-positive ask took — an
// alarming false failure signal for the normal path.
function suiteGenerationInFlight(repoId, suiteKey) {
  return suiteGenInFlight.get(repoId) === suiteKey;
}

// 1-8g-u: did this (repo, key) pair DIE? getSuite answers the recorded
// failure terminally; beginSuiteGeneration clears it on the next attempt.
function suiteGenerationFailed(repoId, suiteKey) {
  const f = suiteGenFailure.get(repoId);
  return f && f.suite_key === suiteKey ? f : null;
}

/**
 * 1-8g-u: beginSuiteGeneration validates the SYNCHRONOUS preconditions
 * BEFORE minting a key (async — the controller awaits it): a tag-less repo
 * is told NOW with NO_FRONTMATTER (the UI points at the Frontmatter panel
 * + Suggest tags), not left polling a key whose generation died in its
 * first millisecond. generateSuite re-validates; this is the fast-fail
 * gate that keeps 202-and-poll honest for validation-class failures.
 */
async function beginSuiteGeneration(repoId, payload = {}, opts = {}) {
  const inflight = suiteGenInFlight.get(repoId);
  if (inflight) {
    const err = new Error('a suite generation is already running for this repository');
    err.code = 'GENERATION_IN_FLIGHT';
    err.status = 409;
    err.suite_key = inflight;
    // 1-8g-w: parity with RUN_IN_FLIGHT — the key rides `details` so the
    // client can adopt the in-flight generation.
    err.details = { suite_key: inflight };
    throw err;
  }
  const fm = await frontmatterService.readFrontmatterFromRepoDoc(repoId);
  if (!fm) {
    const err = new Error(
      'repo has no stored frontmatter — create head tags first (Frontmatter panel → Suggest tags), then generate a suite'
    );
    err.code = 'NO_FRONTMATTER';
    err.status = 409;
    throw err;
  }
  const suiteKey = `s${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
  suiteGenInFlight.set(repoId, suiteKey);
  suiteGenFailure.delete(repoId); // a fresh attempt supersedes the last failure
  const done = generateSuite(repoId, payload, { ...opts, suiteKey })
    .then((suite) => suite)
    .finally(() => suiteGenInFlight.delete(repoId));
  // The controller responds 202 without awaiting `done`; a hard failure
  // (DB down) means no doc ever lands — the poll reads the recorded
  // failure from suiteGenFailure (terminal, honest) instead of 404-ing.
  done.catch((e) => {
    suiteGenFailure.set(repoId, {
      suite_key: suiteKey,
      code: e.code || 'GENERATION_FAILED',
      message: e.message,
      at: new Date().toISOString()
    });
    logger.error('head-suite.generate.async_failed', { repo_id: repoId, suite_key: suiteKey, error: e.message });
  });
  return { suite_key: suiteKey, done };
}

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
    // 1-8g-h: a manual addition that duplicates an existing row (either
    // kind — a cross-kind dup is the very contradiction updateSuiteRows
    // rejects) is dropped, not appended; the response reports the count so
    // the curator is never silently ignored.
    const normText = (s) =>
      String(s || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
    const existing = new Set(
      [...(suite.payload.positive || []), ...(suite.payload.negative || [])].map((q) => normText(q.query))
    );
    const fresh = [];
    let duplicatesDropped = 0;
    for (const q of clean) {
      const k = normText(q.query);
      if (existing.has(k)) {
        duplicatesDropped += 1;
        continue;
      }
      existing.add(k);
      fresh.push(q);
    }
    suite.payload.positive.push(...fresh.filter((q) => q.kind === 'positive'));
    suite.payload.negative.push(...fresh.filter((q) => q.kind === 'negative'));
    await db.collection(HEAD_TEST_RUNS_COLLECTION).replace(suite._key, suite);
    logger.info('head-suite.queries_added', {
      repo_id: repoId,
      suite_key: suiteKey,
      added: fresh.length,
      duplicates_dropped: duplicatesDropped
    });
    return { ...suite, added: fresh.length, duplicates_dropped: duplicatesDropped };
  });
}

// ---------- public: load + edit rows (Story 1-8f — David: "the test suites
// need to be able to be saved, modified and rerun (of course)") ----------
// Suites already persist (kind:'suite' docs) and rerun by key; what was
// missing is LOADING one back into the Lab and EDITING its rows — until now
// a row could only be ADDED, so a mislabeled row (the HIV positive) was
// permanent noise and had to be duplicated with the other kind.

// 1-8g-r: the editor's caps DERIVE from the generator's own CLASS_MAX
// ceilings (Story 1-8f: "any number of tests for any type"). The old
// hand-picked 60/150 sat BELOW what the generator legally produces — a
// legitimate 100-positive suite could not be edited at all (every row
// edit 409'd; write-lock #2 of 2026-10-11, same class as 1-8g-p).
// Negatives merge the four negative classes, so the ceiling sums them.
const SUITE_ROW_CAPS = {
  positive: CLASS_MAX.positive,
  negative: CLASS_MAX.negative + CLASS_MAX.random + CLASS_MAX.meta + CLASS_MAX.nearMiss
};

async function getSuite(repoId, suiteKey, opts = {}) {
  return withSpan('okf.headsuite.get', async (span) => {
    span.setAttribute('okf.repo_id', repoId);
    await repositoryService.getById(repoId, { authz: opts.authz });
    const db = await dbService.getConnection();
    await ensureCollection(db);
    if (suiteGenerationInFlight(repoId, suiteKey)) {
      // minted + worker running — the doc persists only when generation ends
      span.setAttribute('okf.suite_status', 'generating');
      return { suite_key: suiteKey, status: 'generating' };
    }
    // 1-8g-u: a recorded generation failure answers TERMINALLY — the poll
    // stops and shows the real error, instead of 404-ing until timeout.
    const failed = suiteGenerationFailed(repoId, suiteKey);
    if (failed) {
      span.setAttribute('okf.suite_status', 'failed');
      return { suite_key: suiteKey, status: 'failed', error: { code: failed.code, message: failed.message } };
    }
    const suite = await loadSuiteDoc(db, repoId, suiteKey);
    if (suite.repo_id !== repoId) {
      const err = new Error(`suite ${suiteKey} not found for repo ${repoId}`);
      err.code = 'SUITE_NOT_FOUND';
      err.status = 404;
      throw err;
    }
    return suite;
  });
}

async function updateSuiteRows(repoId, suiteKey, payload = {}, opts = {}) {
  return withSpan('okf.headsuite.update_rows', async (span) => {
    span.setAttribute('okf.repo_id', repoId);
    await repositoryService.getById(repoId, { authz: opts.authz });
    const updates = Array.isArray(payload.updates) ? payload.updates : [];
    const removes = Array.isArray(payload.removes) ? payload.removes : [];
    const validRow = (q) =>
      q && typeof q.query === 'string' && q.query.trim() && (q.kind === 'positive' || q.kind === 'negative');
    // A REMOVE may target a MALFORMED row. Every writer today rejects
    // blank queries, but legacy suites predate that guard and hold one —
    // and the live case (2026-10-20, suite s1791908298011) held a row
    // with NO query key at all, so the UI's delete click sent only
    // {kind}. A delete gated by validRow write-locks the junk into the
    // suite forever. Only the kind must be valid; a remove whose query is
    // missing/blank matches exactly the missing/blank rows of that kind —
    // the junk being deleted and nothing else.
    const validRemove = (r) => r && (r.kind === 'positive' || r.kind === 'negative');
    const validUpdate = (u) =>
      u && validRow(u.match) && u.set && (u.set.kind === 'positive' || u.set.kind === 'negative');
    if (!updates.filter(validUpdate).length && !removes.filter(validRemove).length) {
      const err = new Error('updates[] ({match:{query,kind}, set:{kind}}) and/or removes[] ({query, kind}) required');
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
    const pos = suite.payload.positive || [];
    const neg = suite.payload.negative || [];
    // 1-8g-r: pre-edit sizes — the cap guard rejects only NET GROWTH past
    // the ceiling (an edit that keeps or shrinks an over-cap kind is
    // always allowed; an absolute-size check would write-lock legacy
    // oversized suites, the same deadlock class as 1-8g-p).
    const beforePos = pos.length;
    const beforeNeg = neg.length;
    let removed = 0;
    let relabeled = 0;
    // 1-8g-p — duplicates absorbed by flips + by the normalization sweep.
    let normalizedAway = 0;
    const norm = (s) =>
      String(s || '')
        .trim()
        .toLowerCase();

    // 1. Removes — every {query, kind} match goes, in BOTH arrays (a
    //    mislabeled kind:'negative' row can sit inside payload.positive).
    //    1-8g-p: ALL same-text copies go with it — the clicked row
    //    represents the TEXT (a pre-1-8g-h suite can hold it 3×; deleting
    //    one and leaving the twins re-triggered the duplicate guard on the
    //    next save and write-locked the suite).
    for (const r of removes.filter(validRemove)) {
      let matches = [];
      // Null-safe BOTH sides of the match: a legacy junk row may lack the
      // query key entirely, hold '', or hold whitespace — the request
      // mirror of that (missing/blank query) matches exactly those rows of
      // this kind, nothing else. Writers always trim real queries, so the
      // trimmed comparison loosens nothing for legitimate rows.
      const rq = typeof r.query === 'string' ? r.query.trim() : '';
      for (const arr of [pos, neg]) {
        matches = matches.concat(arr.filter((row) => String(row.query || '').trim() === rq && row.kind === r.kind));
      }
      for (const arr of [pos, neg]) {
        for (const m of matches) {
          const i = arr.indexOf(m);
          if (i >= 0) arr.splice(i, 1);
        }
      }
      normalizedAway += Math.max(0, matches.length - 1);
      removed += matches.length;
    }

    // 2. Updates — kind flips only (v1). The row MOVES to the array matching
    //    the TARGET kind — searched in BOTH arrays, because the mislabeled
    //    row (the whole reason this endpoint exists) sits in the WRONG array
    //    (a row with kind:'positive' inside payload.negative). cls is
    //    cleared (the class is the GENERATOR's assessment — a manually
    //    relabeled row has none). Flipping all exact duplicates is consistent.
    for (const u of updates.filter(validUpdate)) {
      const from = u.match.kind;
      const to = u.set.kind;
      if (from === to) continue;
      const dst = to === 'positive' ? pos : neg;
      // 1-8g-p: a flip INTO a kind that already GENUINELY holds the same
      // text (row.kind === to) would create the exact self-refuting
      // contradiction the guard below rejects — and before normalization
      // existed, pre-1-8g-h suites (generated with duplicate rows) were
      // WRITE-LOCKED: every single-row edit left a duplicate somewhere,
      // every request 409'd, nothing could ever be fixed through the API.
      // Refuse UP FRONT with the way out. Mislabeled rows in the
      // destination array (kind !== to — the very thing this endpoint
      // fixes) are EXCLUDED: they move with the flip, they are not
      // conflicting residents.
      const flipText = norm(u.match.query);
      if (dst.some((row) => norm(row.query) === flipText && row.kind === to)) {
        const err = new Error(
          `"${u.match.query.trim().slice(0, 80)}" already exists in the ${to} list — delete that copy first, then re-run the flip`
        );
        err.code = 'SUITE_CONTRADICTION';
        err.status = 409;
        throw err;
      }
      // The clicked row represents text+kind across BOTH arrays — a
      // pre-1-8g-h suite can hold the text duplicated, and a MISLABELED
      // copy (kind:'positive' inside payload.negative) is the same text
      // with the same kind. Move every copy out, land ONE flipped row;
      // the absorbed extras count as normalized duplicates (visible in
      // the log, never silent).
      const moved = [pos, neg]
        .map((arr) => arr.filter((row) => row.query === u.match.query.trim() && row.kind === from))
        .flat();
      for (const arr of [pos, neg]) {
        for (const m of moved) {
          const i = arr.indexOf(m);
          if (i >= 0) arr.splice(i, 1);
        }
      }
      normalizedAway += Math.max(0, moved.length - 1);
      dst.push({ ...moved[0], kind: to, cls: null });
      relabeled += 1;
    }

    // 3. 1-8g-p — normalize within-kind duplicates ON SAVE (keep the first
    //    copy). Legacy suites were generated before the 1-8g-h assembly
    //    dedup and carry duplicate rows; the old strict guard made them
    //    uneditable (deleting ONE copy still left the others → 409
    //    forever). Duplicate rows are interchangeable observations —
    //    dropping the extras IS the repair the curator's delete click
    //    already asked for; the log makes it visible, never silent.
    const dedupKind = (arr) => {
      const seen = new Set();
      const kept = [];
      for (const row of arr) {
        const k = norm(row.query);
        if (seen.has(k)) {
          normalizedAway += 1;
          continue;
        }
        seen.add(k);
        kept.push(row);
      }
      return kept;
    };
    const dedupedPos = dedupKind(pos);
    const dedupedNeg = dedupKind(neg);
    if (normalizedAway) {
      logger.info('head-suite.rows_normalized', {
        repo_id: repoId,
        suite_key: suiteKey,
        duplicates_dropped: normalizedAway,
        positives: dedupedPos.length,
        negatives: dedupedNeg.length
      });
    }

    // 4. Invariants — no contradiction (same text in BOTH arrays makes every
    //    run self-refuting; which kind to keep is the CURATOR's call, not
    //    ours — the flip pre-validation above names the copy to delete
    //    first). The within-kind duplicate check is now a backstop only —
    //    step 3 makes it unreachable. Caps as a sanity backstop.
    const contradiction = dedupedPos.find((r) => dedupedNeg.some((n) => norm(n.query) === norm(r.query)));
    if (contradiction) {
      const err = new Error(
        `query is both positive and negative: "${contradiction.query.slice(0, 80)}" — delete one of the two rows to resolve`
      );
      err.code = 'SUITE_CONTRADICTION';
      err.status = 409;
      throw err;
    }
    const dupIn = (arr) => arr.some((r, i) => arr.findIndex((x) => norm(x.query) === norm(r.query)) !== i);
    if (dupIn(dedupedPos) || dupIn(dedupedNeg)) {
      const err = new Error('duplicate query text within one kind after the update');
      err.code = 'SUITE_DUPLICATE';
      err.status = 409;
      throw err;
    }
    if (
      (dedupedPos.length > SUITE_ROW_CAPS.positive && dedupedPos.length > beforePos) ||
      (dedupedNeg.length > SUITE_ROW_CAPS.negative && dedupedNeg.length > beforeNeg)
    ) {
      const err = new Error(
        `suite row cap exceeded (positive ≤ ${SUITE_ROW_CAPS.positive}, negative ≤ ${SUITE_ROW_CAPS.negative})`
      );
      err.code = 'SUITE_CAP';
      err.status = 409;
      throw err;
    }

    suite.payload.positive = dedupedPos;
    suite.payload.negative = dedupedNeg;
    suite.updated_at = new Date().toISOString();
    suite.updated_by = (opts.actor && opts.actor.user_id) || 'system';
    await db.collection(HEAD_TEST_RUNS_COLLECTION).replace(suite._key, suite);
    span.setAttribute('okf.headsuite.relabeled', relabeled);
    span.setAttribute('okf.headsuite.removed', removed);
    span.setAttribute('okf.headsuite.duplicates_dropped', normalizedAway);
    logger.info('head-suite.rows_updated', {
      repo_id: repoId,
      suite_key: suiteKey,
      relabeled,
      removed,
      duplicates_dropped: normalizedAway,
      positives: dedupedPos.length,
      negatives: dedupedNeg.length
    });
    return suite;
  });
}

// Story 1-8f — name a suite (optional at generation; renamable after).
async function renameSuite(repoId, suiteKey, payload = {}, opts = {}) {
  return withSpan('okf.headsuite.rename', async (span) => {
    span.setAttribute('okf.repo_id', repoId);
    await repositoryService.getById(repoId, { authz: opts.authz });
    const name = typeof payload.name === 'string' ? payload.name.trim().slice(0, 80) : '';
    if (!name) {
      const err = new Error('name (1-80 chars) is required');
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
    const was = suite.name || '';
    suite.name = name;
    suite.updated_at = new Date().toISOString();
    suite.updated_by = (opts.actor && opts.actor.user_id) || 'system';
    await db.collection(HEAD_TEST_RUNS_COLLECTION).replace(suite._key, suite);
    logger.info('head-suite.renamed', { repo_id: repoId, suite_key: suiteKey, was, name });
    return suite;
  });
}

// ---------- public: delete (1-8g) ----------

async function deleteSuite(repoId, suiteKey, opts = {}) {
  return withSpan('okf.headsuite.delete', async (span) => {
    span.setAttribute('okf.repo_id', repoId);
    await repositoryService.getById(repoId, { authz: opts.authz });
    const db = await dbService.getConnection();
    await ensureCollection(db);
    if (suiteGenerationInFlight(repoId, suiteKey)) {
      const err = new Error('a generation is in flight for this suite — wait for it to land');
      err.code = 'GENERATION_IN_FLIGHT';
      err.status = 409;
      throw err;
    }
    // 1-8g-w: a run executing for this suite pins its rows — deleting the
    // suite mid-run made the worker write a failed doc for a deleted suite.
    if (suiteRunInFlight.has(suiteKey)) {
      const err = new Error('a run is executing for this suite — wait for it to land before deleting');
      err.code = 'RUN_IN_FLIGHT';
      err.status = 409;
      err.details = { run_key: suiteRunInFlight.get(suiteKey) };
      throw err;
    }
    const suite = await loadSuiteDoc(db, repoId, suiteKey);
    if (suite.repo_id !== repoId) {
      const err = new Error(`suite ${suiteKey} not found for repo ${repoId}`);
      err.code = 'SUITE_NOT_FOUND';
      err.status = 404;
      throw err;
    }
    // Runs of a deleted suite are meaningless without it — remove both.
    // Advisor/explain docs (kind != 'run') stay: audit trail.
    await db.collection(HEAD_TEST_RUNS_COLLECTION).remove(suiteKey);
    const runRows = await (
      await db.query(
        `FOR d IN ${HEAD_TEST_RUNS_COLLECTION} FILTER d.repo_id == @rid && d.suite_key == @k && d.kind == 'run' REMOVE d IN ${HEAD_TEST_RUNS_COLLECTION} RETURN OLD`,
        { rid: repoId, k: suiteKey }
      )
    ).all();
    logger.info('head-suite.deleted', { repo_id: repoId, suite_key: suiteKey, runs_removed: runRows.length });
    return { deleted: true, suite_key: suiteKey, runs_removed: runRows.length };
  });
}

// ---------- public: corpus probe (1-8g — the click-test) ----------
//
// David, 2026-10-10 ("it passed the head test … then the chatbot answers
// from general knowledge — why?"): the head verdict asserts DOMAIN match,
// never CORPUS COVERAGE. The probe closes that gap per query: embed →
// top-K chunks from the repo's ingested corpus → the SAME TEI rerank the
// pipeline grounds on → an honest coverage verdict, persisted on the
// suite row and shown in the Lab.
//
// Verdict bands calibrated live 2026-10-10 against the remote bge
// reranker: true match 0.94-0.95, related-but-not-answering 0.05-0.13,
// garbage 0.00002.

const PROBE_TOP_K = 24;
const PROBE_TEXT_CAP = 4000; // rerankers truncate ~512 tokens; bound the body
const PROBE_TIMEOUT_MS = 15000;

function probeVerdict(topScore) {
  if (topScore == null) return 'unknown';
  if (topScore >= 0.5) return 'answerable';
  if (topScore >= 0.15) return 'weak';
  return 'unanswerable';
}

// 1-8g (David): "the analysis of unanswerable queries must state exactly
// why it is unanswerable". Deterministic evidence-based reason built from
// the rerank-best chunk: the score gap PLUS whether the corpus even
// mentions the question's terms (topical overlap vs no coverage at all).
const PROBE_STOPWORDS = new Set([
  'what',
  'are',
  'the',
  'how',
  'often',
  'should',
  'for',
  'of',
  'in',
  'a',
  'an',
  'is',
  'do',
  'does',
  'to',
  'and',
  'with',
  'on',
  'at',
  'by',
  'from',
  'can',
  'be',
  'it',
  'this',
  'that',
  'which',
  'when',
  'who',
  'whom',
  'list',
  'give',
  'tell',
  'about',
  'there',
  'any',
  'have',
  'has',
  'was',
  'were',
  'adults',
  'people',
  'patients',
  'user',
  'users',
  'please',
  'me',
  'my',
  'i',
  'you',
  'your',
  'their',
  'they',
  'its',
  'new',
  'latest',
  'current',
  'best'
]);

function probeReason(verdict, topScore, best, query) {
  const preview = best && best.text ? best.text.replace(/\s+/g, ' ').trim().slice(0, 140) : '';
  if (verdict === 'unknown') return 'no rerank score — the corpus ranking could not be evaluated';
  if (verdict === 'answerable') {
    return `Best chunk scores ${topScore} (≥ 0.5 answer bar)` + (preview ? ` — "${preview}"` : '');
  }
  // Content-term overlap between the question and the best candidate.
  const terms = String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !PROBE_STOPWORDS.has(w));
  const hay = (best && best.text ? best.text : '').toLowerCase();
  const overlap = terms.filter((t) => hay.includes(t));
  if (verdict === 'weak') {
    if (overlap.length >= 2) {
      return (
        `Best chunk scores only ${topScore} (needs ≥ 0.5). The corpus discusses ${overlap.slice(0, 3).join(', ')} ` +
        `but the closest content — "${preview}" — does not answer this specific question`
      );
    }
    return `Best chunk scores only ${topScore} (needs ≥ 0.5); the closest content — "${preview}" — is only loosely related`;
  }
  // unanswerable
  if (overlap.length >= 2) {
    return (
      `The corpus mentions ${overlap.slice(0, 3).join(', ')} but no chunk answers this question: ` +
      `the best candidate ("${preview}") scores just ${topScore} where an answer needs ≥ 0.5`
    );
  }
  return (
    `No corpus content matches this question — the best candidate scores just ${topScore}` +
    (preview ? ` ("${preview}")` : '')
  );
}

/**
 * 1-8g — ONE rerank call through the SAME endpoint the pipeline grounds on.
 * The remote TEI's nginx 401s by client fingerprint: aiohttp (the reranker
 * service) passes anonymously, node fetch does not — send the Bearer token
 * explicitly when configured (live 2026-10-10: anonymous node fetch → HTTP
 * 401 on every call). Returns the decoded score array; throws on failure.
 *
 * 1-8g-o (live 2026-10-10): the remote TEI also rate-limits bursty probe
 * pools with HTTP 429 — David's Run All came back with 19/116 rows
 * 'unknown', every note "rerank failed: HTTP 429", while the individual
 * probes that followed (1-at-a-time) all succeeded. The batch embeds never
 * failed (teiEmbed already retries) — only the bare rerank call had no
 * retry. Retry the transient statuses with jittered backoff (a burst token
 * bucket refills in ~1s, so the next attempt lands); Retry-After wins when
 * the server sends it. Timeouts are NOT retried — a hanging endpoint must
 * stay bounded at PROBE_TIMEOUT_MS per attempt, not 3×.
 */
const RERANK_RETRY_STATUSES = new Set([429, 502, 503, 504]);
const RERANK_RETRY_ATTEMPTS = 3;
const RERANK_RETRY_BASE_MS = 600;

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rerankTexts(query, texts) {
  const rerankUrl = process.env.OKF_RERANK_ENDPOINT || '';
  if (!rerankUrl) {
    const err = new Error('rerank endpoint not configured (OKF_RERANK_ENDPOINT)');
    err.code = 'RERANK_NOT_CONFIGURED';
    throw err;
  }
  const rerankToken = process.env.OKF_RERANK_TOKEN || '';
  const headers = { 'Content-Type': 'application/json' };
  if (rerankToken) headers.Authorization = `Bearer ${rerankToken}`;
  for (let attempt = 1; attempt <= RERANK_RETRY_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
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
        if (err.retryable && attempt >= RERANK_RETRY_ATTEMPTS) {
          err.message = `HTTP ${resp.status} after ${RERANK_RETRY_ATTEMPTS} attempts`;
        }
        throw err;
      }
      const decoded = await resp.json();
      if (!Array.isArray(decoded)) throw new Error('unexpected rerank response shape');
      return decoded;
    } catch (e) {
      if (e.retryable === true && attempt < RERANK_RETRY_ATTEMPTS) {
        const delay = e.retryAfterMs || RERANK_RETRY_BASE_MS * attempt + Math.floor(Math.random() * 250);
        logger.warn('head-suite.rerank_retry', {
          attempt,
          status: e.status,
          delay_ms: delay,
          texts: texts.length
        });
        await sleepMs(delay);
        continue;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('rerank failed: retry loop exited unexpectedly'); // defensive, unreachable
}

/**
 * 1-8g — the LIGHT probe: embed → top-K from the repo's ingested corpus →
 * rerank → coverage verdict. This is the per-row core of probeSuiteQuery
 * WITHOUT the panel extras (head leg, reference files, top-chunk table) —
 * the shape persisted as lastProbe and stamped onto run results. Never
 * throws: any failure degrades to verdict 'unknown' with an honest note.
 */
async function probeQueryLight(db, graphName, query) {
  const at = new Date().toISOString();
  const probe = { at, query, docs: 0, top_score: null, verdict: 'unknown' };
  try {
    // 1. Embed (same TEI + BGE query-prefix contract as routing).
    const embeddings = await frontmatterService.teiEmbed([query]);
    const emb = Array.isArray(embeddings) && embeddings[0];
    if (!emb) {
      probe.note = 'query embedding failed';
      return probe;
    }

    // 2. Top-K chunks from THIS repo's ingested corpus.
    const rows = (
      await (
        await db.query(
          `FOR c IN \`${graphName}_SOURCE\` ` +
            'LET s = APPROX_NEAR_COSINE(c.embedding, @emb) ' +
            'SORT s DESC LIMIT @k ' +
            'RETURN { text: c.text, score: s }',
          { emb, k: PROBE_TOP_K }
        )
      ).all()
    ).map((r) => ({ text: String(r.text || '').slice(0, PROBE_TEXT_CAP), score: Number(r.score) || 0 }));
    probe.docs = rows.length;
    if (!rows.length) {
      probe.verdict = 'unanswerable'; // empty corpus cannot answer
      probe.note = 'no chunks in the ingested corpus';
      return probe;
    }

    // 3. Rerank through the pipeline's endpoint.
    let best = null;
    try {
      const decoded = await rerankTexts(
        query,
        rows.map((r) => r.text)
      );
      let top = 0;
      for (const r of decoded) {
        const s = Number(r && r.score) || 0;
        if (!best || s > top) {
          top = s;
          best = rows[Number(r && r.index)] || null;
        }
      }
      probe.top_score = Number(top.toFixed(4));
      probe.verdict = probeVerdict(probe.top_score);
      probe.reason = probeReason(probe.verdict, probe.top_score, best, query);
    } catch (e) {
      probe.note = e.code === 'RERANK_NOT_CONFIGURED' ? e.message : `rerank failed: ${e.message}`;
      // 1-8g-o: an 'unknown' row must be diagnosable from the logs too —
      // the note lives on the row, this warn lives in VictoriaLogs.
      logger.warn('head-suite.probe_rerank_failed', { query: String(query).slice(0, 120), error: e.message });
    }
  } catch (e) {
    probe.note = `probe failed: ${e.message}`;
  }
  return probe;
}

async function probeSuiteQuery(repoId, suiteKey, payload = {}, opts = {}) {
  return withSpan('okf.headsuite.probe', async (span) => {
    span.setAttribute('okf.repo_id', repoId);
    const query = typeof payload.query === 'string' ? payload.query.trim() : '';
    if (!query) {
      const err = new Error('query is required');
      err.code = 'VALIDATION_ERROR';
      err.status = 400;
      throw err;
    }
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
    const graphName = repo.ingested_graph_name;
    if (!graphName) {
      const err = new Error('the repository has no ingested corpus — publish and ingest first');
      err.code = 'REPO_NOT_INGESTED';
      err.status = 409;
      throw err;
    }

    // 1. Embed the query (same TEI + BGE query-prefix contract as routing).
    const embeddings = await frontmatterService.teiEmbed([query]);
    const emb = Array.isArray(embeddings) && embeddings[0];
    if (!emb) {
      const err = new Error('query embedding failed');
      err.code = 'PROBE_EMBED_FAILED';
      err.status = 502;
      throw err;
    }

    // 2. Top-K chunks from THIS repo's ingested corpus (file_ids ride along
    //    for the reference-files summary).
    const rows = (
      await (
        await db.query(
          `FOR c IN \`${graphName}_SOURCE\` ` +
            'LET s = APPROX_NEAR_COSINE(c.embedding, @emb) ' +
            'SORT s DESC LIMIT @k ' +
            'RETURN { text: c.text, score: s, file_ids: c.file_ids || [] }',
          { emb, k: PROBE_TOP_K }
        )
      ).all()
    ).map((r) => ({
      text: String(r.text || '').slice(0, PROBE_TEXT_CAP),
      score: Number(r.score) || 0,
      file_ids: Array.isArray(r.file_ids) ? r.file_ids : []
    }));

    const at = new Date().toISOString();
    const t0 = Date.now();
    const probe = { at, query, docs: rows.length, top_score: null, verdict: 'unknown' };
    let rerankTop = [];

    // 3b. The HEAD verdict for the same query — the summary panel shows
    // BOTH legs (domain routing AND corpus coverage) in one view. This is
    // the full answer to "passed the head test but the chatbot fails":
    // the head leg and the corpus leg, side by side.
    let head = null;
    try {
      const rt = await headTestService.routingTest(repoId, { query }, { authz: opts.authz });
      const ut = rt && rt.under_test;
      if (ut) {
        head = {
          claimed: ut.head_claimed === true,
          claim: ut.head_claim || null,
          score:
            typeof ut.score === 'number'
              ? Number(ut.score.toFixed(4))
              : typeof ut.similarity === 'number'
                ? Number(ut.similarity.toFixed(4))
                : null
        };
      }
    } catch (e) {
      head = { claimed: null, claim: null, score: null, note: e.message };
    }

    // 3. Rerank through the SAME endpoint the pipeline grounds on.
    if (!rows.length) {
      probe.verdict = 'unanswerable'; // empty corpus cannot answer
      probe.note = 'no chunks in the ingested corpus';
    } else {
      try {
        const decoded = await rerankTexts(
          query,
          rows.map((r) => r.text)
        );
        const top = decoded.reduce((m, r) => Math.max(m, Number(r && r.score) || 0), 0);
        probe.top_score = Number(top.toFixed(4));
        probe.verdict = probeVerdict(probe.top_score);
        // 1-8g (David): state EXACTLY why a query is unanswerable/weak —
        // the rerank-best chunk is the evidence. Keep it rerank-ordered.
        rerankTop = decoded
          .slice()
          .sort((a, b) => (Number(b && b.score) || 0) - (Number(a && a.score) || 0))
          .map((r) => ({
            score: Number(Number(r && r.score).toFixed(4)),
            text: rows[Number(r && r.index)] ? rows[Number(r && r.index)].text : '',
            file_ids: (rows[Number(r && r.index)] && rows[Number(r && r.index)].file_ids) || []
          }));
        probe.reason = probeReason(probe.verdict, probe.top_score, rerankTop[0], query);
      } catch (e) {
        logger.error('head-suite.probe.rerank_failed', { repo_id: repoId, suite_key: suiteKey, error: e.message });
        probe.note = e.code === 'RERANK_NOT_CONFIGURED' ? e.message : `rerank failed: ${e.message}`;
      }
    }

    // 3c. Reference FILES for the top chunks (David: "a summary of the
    // query stats — number of chunks and reference files etc." must be
    // displayed). Resolved to file names via the files collection.
    const chunkTop = (rerankTop.length ? rerankTop : rows.slice(0, 8)).slice(0, 8);
    const fileRefs = {};
    for (const c of chunkTop) {
      for (const fid of c.file_ids || []) {
        if (!fileRefs[fid]) fileRefs[fid] = { id: fid, chunks: 0 };
        fileRefs[fid].chunks += 1;
      }
    }
    const fileIds = Object.keys(fileRefs);
    if (fileIds.length) {
      try {
        const fRows = await (
          await db.query('FOR f IN files FILTER f._id IN @ids RETURN { id: f._id, name: f.file_name }', {
            ids: fileIds
          })
        ).all();
        for (const f of fRows) {
          if (fileRefs[f.id] && f.name) fileRefs[f.id].name = f.name;
        }
      } catch (e) {
        logger.error('head-suite.probe.file_lookup_failed', { repo_id: repoId, error: e.message });
      }
    }
    const files = fileIds.map((id) => ({
      id,
      name: fileRefs[id].name || id,
      chunks: fileRefs[id].chunks
    }));

    // 4. Persist on EVERY matching row (positives and negatives share text
    //    space only by contradiction-check, so match both) and return.
    let touched = 0;
    for (const arr of [suite.payload.positive, suite.payload.negative]) {
      for (const row of arr || []) {
        if (row && typeof row.query === 'string' && row.query.trim() === query) {
          row.lastProbe = probe;
          touched += 1;
        }
      }
    }
    if (touched) {
      suite.updated_at = at;
      await db.collection(HEAD_TEST_RUNS_COLLECTION).replace(suite._key, suite);
    }
    span.setAttribute('okf.probe.verdict', probe.verdict);
    span.setAttribute('okf.probe.top_score', probe.top_score == null ? -1 : probe.top_score);
    logger.info('head-suite.probed', {
      repo_id: repoId,
      suite_key: suiteKey,
      query: query.slice(0, 120),
      docs: probe.docs,
      top_score: probe.top_score,
      verdict: probe.verdict,
      rows_updated: touched
    });
    return {
      suite_key: suiteKey,
      ...probe,
      head,
      elapsed_ms: Date.now() - t0,
      files,
      top_chunks: chunkTop.map((c) => ({
        score: c.score,
        preview: c.text.slice(0, 200),
        file_ids: c.file_ids || [],
        file: (c.file_ids || []).map((fid) => (fileRefs[fid] && fileRefs[fid].name) || fid).join(', ') || null
      }))
    };
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
    // 1-8g-x (David: "the UI should show a progress bar for the run"): the
    // worker reports {phase, done, total} through opts.reportProgress — the
    // async caller (beginRunSuite) throttles it into the placeholder doc so
    // the poll renders a REAL bar, not a fake animation. Phase-boundary
    // reports are awaited; per-item reports are fire-and-forget.
    const report = async (progress) => {
      if (!opts.reportProgress) return;
      try {
        await opts.reportProgress(progress);
      } catch (e) {
        logger.warn('head-suite.run.progress_report_failed', { suite_key: suiteKey, error: e.message });
      }
    };
    await report({ phase: 'routing', done: 0, total: all.length });
    // 1-8g-v: the head legs run 4-WAY concurrent (the probe pool's pattern)
    // — a 200-row suite took ~40-60s SERIAL just for the head legs (live:
    // Indonesia History 100+100 blew the gateway's 60s on its own); the
    // pool writes results[i] BY INDEX so order always matches the suite.
    const results = new Array(all.length);
    const RUN_CONCURRENCY = 4;
    const runQueue = all.map((q, i) => ({ q, i }));
    let headDone = 0;
    const runWorker = async () => {
      for (;;) {
        const item = runQueue.shift();
        if (!item) return;
        const { q, i } = item;
        try {
          const r = await headTestService.routingTest(repoId, { query: q.query, include_probes: false }, opts);
          results[i] = {
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
            max_tag: r.under_test.max_tag || null,
            max_tag_cosine:
              r.under_test.max_tag_cosine !== undefined && r.under_test.max_tag_cosine !== null
                ? r.under_test.max_tag_cosine
                : null,
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
          };
        } catch (e) {
          results[i] = {
            query: q.query,
            kind: q.kind,
            cls: q.cls || null,
            source: q.source || 'llm',
            expected_repo: q.expected_repo || null,
            error: e.message
          };
        }
        headDone += 1;
        if (opts.reportProgress) {
          opts.reportProgress({ phase: 'routing', done: headDone, total: all.length }).catch(() => {});
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(RUN_CONCURRENCY, runQueue.length) }, runWorker));

    // 1-8g (David): Run All fills the Corpus column — every row is ALSO
    // probed against the live corpus (embed → top-K → the pipeline's
    // rerank → coverage verdict). The light probes ride each result; the
    // verdicts persist on the suite rows so a reload keeps the chips.
    // Default ON; opt out with {probe:false}. A repo without an ingested
    // corpus has nothing to probe — the leg skips cleanly.
    if (opts.probe !== false && repo.ingested_graph_name) {
      const graphName = repo.ingested_graph_name;
      const t0 = Date.now();
      const PROBE_CONCURRENCY = 4;
      const queue = all.slice();
      const probeTotal = new Set(all.map((q) => q.query)).size;
      await report({ phase: 'corpus', done: 0, total: probeTotal });
      const probeMap = new Map();
      const worker = async () => {
        for (;;) {
          const q = queue.shift();
          if (!q) return;
          if (probeMap.has(q.query)) continue; // same text can sit in both arrays
          probeMap.set(q.query, await probeQueryLight(db, graphName, q.query));
          if (opts.reportProgress) {
            opts.reportProgress({ phase: 'corpus', done: probeMap.size, total: probeTotal }).catch(() => {});
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, queue.length) }, worker));
      for (const r of results) {
        const p = probeMap.get(r.query);
        if (p) {
          r.probe = {
            at: p.at,
            docs: p.docs,
            top_score: p.top_score,
            verdict: p.verdict,
            reason: p.reason || null,
            note: p.note || null
          };
        }
      }
      // Persist the verdicts on the suite rows (a later Load keeps the chips).
      let touched = 0;
      for (const arr of [suite.payload.positive, suite.payload.negative]) {
        for (const row of arr || []) {
          const p = row && probeMap.get(row.query);
          if (p) {
            row.lastProbe = p;
            touched += 1;
          }
        }
      }
      if (touched) {
        suite.updated_at = new Date().toISOString();
        await db.collection(HEAD_TEST_RUNS_COLLECTION).replace(suite._key, suite);
      }
      span.setAttribute('okf.headsuite.probe_rows', probeMap.size);
      logger.info('head-suite.run_probed', {
        repo_id: repoId,
        suite_key: suiteKey,
        probed: probeMap.size,
        elapsed_ms: Date.now() - t0
      });
    }

    const summary = summarizeRun(results);
    // 1-8g-v: async runs hand the key in (the placeholder doc was saved at
    // begin); sync callers (tests) let it mint as before.
    const runKey = opts.runKey || `r${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
    const runDoc = {
      _key: runKey,
      repo_id: repoId,
      kind: 'run',
      suite_key: suiteKey,
      repo_version: repo.version || null,
      head_version: repo.head ? repo.head.version || null : null,
      // 1-8e — the forbidden tag set this run evaluated against (the TUNING
      // IDENTITY). Same-tags reruns are bit-stable (verified 2026-10-09: 0
      // flipped rows across same-head runs), so a pass_rate change between
      // runs means the TAG SET changed — the history renders this so the
      // curator compares like with like instead of seeing phantom
      // regressions while tuning.
      tagset: tagsetOf(repo),
      // 1-8g-w: the run's identity is its MINT time (== the _key epoch);
      // completion must not reorder history. Async callers pass the
      // placeholder's created_at through.
      created_at: opts.startedAt || new Date().toISOString(),
      created_by: (opts.actor && opts.actor.user_id) || 'system',
      payload: {
        suite_created_at: suite.created_at,
        sibling_names: suite.payload.sibling_names || [],
        results,
        summary
      }
    };
    // 1-8g-w (live 2026-10-11, Indonesia Suite 1 ×2): the async path's
    // placeholder already occupies this _key — save() is an INSERT and
    // threw "unique constraint violated" AFTER all ~60s of work, and the
    // catch converted both completed runs to status:'failed'. The key was
    // handed in → REPLACE the placeholder; sync callers still INSERT.
    try {
      if (opts.runKey) {
        await db.collection(HEAD_TEST_RUNS_COLLECTION).replace(runKey, runDoc);
      } else {
        await db.collection(HEAD_TEST_RUNS_COLLECTION).save(runDoc);
      }
    } catch (e) {
      logger.error('head-suite.run.persist_failed', {
        repo_id: repoId,
        suite_key: suiteKey,
        run_key: runKey,
        error: e.message
      });
      const err = new Error(`run results were computed but the final save failed: ${e.message}`);
      err.code = 'RUN_PERSIST_FAILED';
      throw err;
    }
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

// ---------- 1-8g-v — ASYNC suite runs (David: "runs like this on a large
// repo will always take longer than 60 seconds"). Live 2026-10-11: a
// 100+100 suite on Indonesia History finished server-side at ~70s but the
// gateway 504'd at 60s TWICE — the results existed, the curator never saw
// them. The generation pattern (mint key → placeholder doc → detached
// worker → poll) applied to runs: the placeholder carries status:'running'
// and the final doc replaces it; a failed worker replaces it with
// status:'failed' + the error. One run per suite at a time.

const suiteRunInFlight = new Map(); // suite_key -> run_key

function suiteRunRunning(suiteKey, runKey) {
  return suiteRunInFlight.get(suiteKey) === runKey;
}

async function beginRunSuite(repoId, suiteKey, opts = {}) {
  const db = await dbService.getConnection();
  await ensureCollection(db);
  // validate the suite BEFORE minting (sync 404/409 — no phantom keys)
  const suite = await loadSuiteDoc(db, repoId, suiteKey);
  if (suite.repo_id !== repoId) {
    const err = new Error(`suite ${suiteKey} not found for repo ${repoId}`);
    err.code = 'SUITE_NOT_FOUND';
    err.status = 404;
    throw err;
  }
  const inflight = suiteRunInFlight.get(suiteKey);
  if (inflight) {
    const err = new Error('a run is already executing for this suite');
    err.code = 'RUN_IN_FLIGHT';
    err.status = 409;
    err.run_key = inflight;
    // 1-8g-w: error-handler serializes `details` for client errors — the
    // client needs the run_key to ADOPT the in-flight run (resume polling)
    // instead of dead-ending in an error (David, live 2026-10-11).
    err.details = { run_key: inflight };
    throw err;
  }
  const runKey = `r${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
  suiteRunInFlight.set(suiteKey, runKey);
  const placeholder = {
    _key: runKey,
    repo_id: repoId,
    kind: 'run',
    status: 'running',
    suite_key: suiteKey,
    created_at: new Date().toISOString(),
    created_by: (opts.actor && opts.actor.user_id) || 'system',
    payload: {}
  };
  try {
    await db.collection(HEAD_TEST_RUNS_COLLECTION).save(placeholder);
  } catch (e) {
    // 1-8g-w: the lock is set BEFORE this awaited save — a failure here
    // used to leak the Map entry and lock the suite (RUN_IN_FLIGHT) until
    // process restart, with no placeholder doc behind the 409's run_key.
    suiteRunInFlight.delete(suiteKey);
    throw e;
  }
  logger.info('head-suite.run_started', {
    repo_id: repoId,
    suite_key: suiteKey,
    run_key: runKey,
    positives: Array.isArray(suite.payload && suite.payload.positive) ? suite.payload.positive.length : 0,
    negatives: Array.isArray(suite.payload && suite.payload.negative) ? suite.payload.negative.length : 0
  });
  // 1-8g-x: the worker's progress reports land in the placeholder doc
  // (throttled — a 200-probe run would otherwise hammer the DB) so the
  // poll can render a real bar. Write failures never fail the run.
  const PROGRESS_WRITE_MIN_MS = 2000;
  let lastProgressWrite = 0;
  const reportProgress = async (progress) => {
    const now = Date.now();
    if (now - lastProgressWrite < PROGRESS_WRITE_MIN_MS) return;
    lastProgressWrite = now;
    await db
      .collection(HEAD_TEST_RUNS_COLLECTION)
      .update(runKey, { progress, updated_at: new Date().toISOString() })
      .catch((e) => {
        logger.warn('head-suite.run.progress_write_failed', { run_key: runKey, error: e.message });
      });
  };
  const done = runSuite(repoId, suiteKey, { ...opts, runKey, startedAt: placeholder.created_at, reportProgress })
    .then((runDoc) => runDoc)
    .catch(async (e) => {
      // Replace the placeholder with the honest terminal failure. 1-8g-w:
      // keep the MINT time (created_at is the run's identity — the failure
      // must not reorder history), and never leak a numeric driver code
      // (the Arango driver sets e.code=409 on write conflicts, which
      // overrode RUN_FAILED in both live failures).
      const code = typeof e.code === 'string' && e.code ? e.code : 'RUN_FAILED';
      const failDoc = {
        ...placeholder,
        status: 'failed',
        error: { code, message: e.message }
      };
      await db
        .collection(HEAD_TEST_RUNS_COLLECTION)
        .replace(runKey, failDoc)
        .catch((dbErr) => {
          // 1-8g-w: a swallowed failure here silently left status:'running'
          // forever (getRunSuite now reaps orphans lazily, but log it).
          logger.error('head-suite.run.fail_persist_failed', {
            repo_id: repoId,
            suite_key: suiteKey,
            run_key: runKey,
            error: dbErr.message
          });
        });
      throw e;
    })
    .finally(() => suiteRunInFlight.delete(suiteKey));
  done.catch((e) =>
    logger.error('head-suite.run.async_failed', {
      repo_id: repoId,
      suite_key: suiteKey,
      run_key: runKey,
      error: e.message
    })
  );
  return { run_key: runKey, done };
}

async function getRunSuite(repoId, suiteKey, runKey) {
  const db = await dbService.getConnection();
  await ensureCollection(db);
  if (suiteRunRunning(suiteKey, runKey)) {
    // 1-8g-x: the live envelope carries the persisted progress ({phase,
    // done, total}) so the UI's bar moves; the doc may briefly predate the
    // first report (ms window between lock-set and placeholder-save).
    const live = await loadSuiteDoc(db, repoId, runKey).catch(() => null);
    return { run_key: runKey, suite_key: suiteKey, status: 'running', progress: (live && live.progress) || null };
  }
  const doc = await loadSuiteDoc(db, repoId, runKey); // same collection
  if (doc.repo_id !== repoId || doc.suite_key !== suiteKey) {
    const err = new Error(`run ${runKey} not found for suite ${suiteKey}`);
    err.code = 'RUN_NOT_FOUND';
    err.status = 404;
    throw err;
  }
  if (doc.status === 'running') {
    // 1-8g-w: a 'running' DOC with no live lock is an orphan — the worker
    // died without writing its terminal state (crash, or the failure
    // replace itself failed). Reap lazily so the poll TERMINATES with the
    // truth instead of spinning forever on a ghost.
    const failDoc = {
      ...doc,
      status: 'failed',
      error: {
        code: 'RUN_INTERRUPTED',
        message: 'the run was interrupted (worker died or the server restarted) — start a new run'
      }
    };
    await db
      .collection(HEAD_TEST_RUNS_COLLECTION)
      .replace(doc._key, failDoc)
      .catch(() => {});
    return { run_key: runKey, suite_key: suiteKey, status: 'failed', error: failDoc.error };
  }
  if (doc.status === 'failed') {
    return { run_key: runKey, suite_key: suiteKey, status: 'failed', error: doc.error || null };
  }
  return doc;
}

// ---------- 1-8g-w: interrupted-run sweep ----------
//
// The in-flight lock is per-process; after a restart EVERY status:'running'
// doc is an orphan (the worker died with the process, getRunSuite's lazy
// reap only fires when someone polls THAT run). One-shot at boot, mirroring
// crawl-conversion-service.sweepInterruptedOnce(): dead runs become honest
// failures instead of immortal ghosts in the runs history.
async function sweepInterruptedRuns() {
  const db = await dbService.getConnection();
  await ensureCollection(db);
  const cursor = await db.query(
    `FOR d IN ${HEAD_TEST_RUNS_COLLECTION} FILTER d.kind == 'run' && d.status == 'running' UPDATE d WITH ` +
      `{ status: 'failed', error: { code: 'RUN_INTERRUPTED', message: 'the server restarted while this run was executing — start a new run' } } ` +
      `IN ${HEAD_TEST_RUNS_COLLECTION} RETURN OLD`
  );
  const reaped = await cursor.all();
  if (reaped.length) {
    logger.warn('head-suite.run.sweep_interrupted', {
      reaped: reaped.length,
      run_keys: reaped.map((d) => d._key)
    });
  }
  return reaped.length;
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
      '"name", "repo_version", "head_version", "tagset", "created_at", "created_by"]), ' +
      // 1-8g-w: the lifecycle fields ride the listing so the UI can badge
      // Running/Failed rows (a 'running' placeholder was indistinguishable
      // from a dead run) and find the in-flight run to re-attach to.
      '{ status: d.status || null, error: HAS(d, "error") ? d.error : null, ' +
      'summary: HAS(d.payload, "summary") ? d.payload.summary : null, ' +
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
// In-flight explains, keyed by suite. Separate from suiteRunInFlight: a run
// and an explain may legitimately overlap (you can explain the previous run
// while the next one executes), but two explains of the same suite would
// double-charge the shared embedding node for identical work.
const explainInFlight = new Map();

/**
 * 1-8g-y — ASYNC Explain failures (202 + poll), mirroring beginRunSuite.
 *
 * Explain fans out over the SHARED REMOTE GPU node (ai.assembly.govstack
 * global): one embed per failing negative inside guardSuggestions, plus an
 * LLM pass. That is minutes of remote work behind a synchronous POST, so the
 * gateway timed it out while the job kept running — the curator saw a spinner,
 * no local GPU activity (the work is not local), and then a 504 with no
 * result. The run endpoint solved exactly this with 202 + poll; explain needs
 * the same shape.
 *
 * The suite AND a prior run are validated synchronously so the common
 * mistakes stay instant 404s rather than becoming a 202 that fails later.
 */
async function beginExplainFailures(repoId, suiteKey, opts = {}) {
  const db = await dbService.getConnection();
  await ensureCollection(db);
  const suite = await loadSuiteDoc(db, repoId, suiteKey);
  if (suite.repo_id !== repoId) {
    const err = new Error(`suite ${suiteKey} not found for repo ${repoId}`);
    err.code = 'SUITE_NOT_FOUND';
    err.status = 404;
    throw err;
  }
  const runs = await (
    await db.query(
      'FOR r IN okf_head_test_runs FILTER r.repo_id == @k && r.suite_key == @s && r.kind == "run" ' +
        'SORT r.created_at DESC LIMIT 1 RETURN r._key',
      { k: repoId, s: suiteKey }
    )
  ).all();
  if (!runs.length) {
    const err = new Error(`no run found for suite ${suiteKey} — run the suite first`);
    err.code = 'RUN_NOT_FOUND';
    err.status = 404;
    throw err;
  }
  const inflight = explainInFlight.get(suiteKey);
  if (inflight) {
    const err = new Error('an explain is already running for this suite');
    err.code = 'EXPLAIN_IN_FLIGHT';
    err.status = 409;
    // Same shape as RUN_IN_FLIGHT: the client adopts the in-flight job and
    // keeps polling instead of dead-ending on the error.
    err.details = { run_key: inflight };
    throw err;
  }
  const runKey = `x${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
  explainInFlight.set(suiteKey, runKey);
  const placeholder = {
    _key: runKey,
    repo_id: repoId,
    kind: 'explain',
    status: 'running',
    suite_key: suiteKey,
    created_at: new Date().toISOString(),
    created_by: (opts.actor && opts.actor.user_id) || 'system',
    payload: {}
  };
  try {
    await db.collection(HEAD_TEST_RUNS_COLLECTION).save(placeholder);
  } catch (e) {
    // The lock is set BEFORE this awaited save; leaking it would wedge the
    // suite behind a permanent EXPLAIN_IN_FLIGHT with no doc behind the key.
    explainInFlight.delete(suiteKey);
    throw e;
  }
  logger.info('head-suite.explain_started', { repo_id: repoId, suite_key: suiteKey, run_key: runKey });
  const done = explainSuiteFailures(repoId, suiteKey, { ...opts, runKey })
    .catch(async (e) => {
      // The placeholder must reach a terminal state or the poll hangs on
      // 'running' forever. Keep the mint time (it is the job's identity) and
      // never leak a numeric driver code — the Arango driver sets e.code=409
      // on write conflicts, which would mask the real error (same trap as
      // beginRunSuite).
      const code = typeof e.code === 'string' && e.code ? e.code : 'EXPLAIN_FAILED';
      await db
        .collection(HEAD_TEST_RUNS_COLLECTION)
        .update(runKey, {
          status: 'failed',
          error: { code, message: e.message },
          updated_at: new Date().toISOString()
        })
        .catch((dbErr) => {
          logger.error('head-suite.explain.fail_persist_failed', {
            repo_id: repoId,
            suite_key: suiteKey,
            run_key: runKey,
            error: dbErr.message
          });
        });
      throw e;
    })
    .finally(() => explainInFlight.delete(suiteKey));
  done.catch((e) =>
    logger.error('head-suite.explain.async_failed', {
      repo_id: repoId,
      suite_key: suiteKey,
      run_key: runKey,
      error: e.message
    })
  );
  return { run_key: runKey, done };
}

/**
 * 1-8g-y — the async explain's poll. `{status:'running'}` keep waiting,
 * `{status:'failed', error}`, or the finished advice in `payload`.
 */
async function getExplainFailures(repoId, suiteKey, runKey) {
  const db = await dbService.getConnection();
  await ensureCollection(db);
  if (explainInFlight.get(suiteKey) === runKey) {
    // The live envelope comes from the Map, not the doc, so the very first
    // poll after the 202 cannot read a placeholder that has not landed yet.
    return { run_key: runKey, kind: 'explain', status: 'running', payload: {} };
  }
  let doc;
  try {
    doc = await db.collection(HEAD_TEST_RUNS_COLLECTION).document(runKey);
  } catch (err) {
    // Same not-found discriminator the rest of the codebase uses — the
    // driver surfaces 404 as errorNum 1202/1204 depending on the path.
    const code = err && (err.errorNum || err.statusCode || err.code);
    if (code === 404 || code === 1202 || code === 1204) {
      const e = new Error(`explain run ${runKey} not found`);
      e.code = 'RUN_NOT_FOUND';
      e.status = 404;
      throw e;
    }
    throw err;
  }
  if (doc.repo_id !== repoId || doc.suite_key !== suiteKey) {
    // Anti-enumeration: a key from another repo is "not found", not 403.
    const e = new Error(`explain run ${runKey} not found`);
    e.code = 'RUN_NOT_FOUND';
    e.status = 404;
    throw e;
  }
  return {
    run_key: doc._key,
    kind: 'explain',
    status: doc.status || 'done',
    payload: doc.payload || {},
    error: doc.error || null,
    created_at: doc.created_at,
    updated_at: doc.updated_at
  };
}

async function explainSuiteFailures(repoId, suiteKey, opts = {}) {
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
    const failing = (run.payload.results || []).filter((q) => q && q.kind && q.kind !== 'positive' && q.head_claimed);
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
    // Terminal write for the advice doc, in ONE place, so every exit below
    // persists. In the async path (opts.runKey set) this UPDATES the
    // placeholder minted by beginExplainFailures; otherwise it saves a fresh
    // doc exactly as before.
    //
    // It has to be a helper rather than a block at the bottom: the
    // "nothing to explain" branch returns early, and it used to return
    // straight past the persist — which under the async path would leave the
    // placeholder 'running' forever and the client polling a job that had
    // already finished.
    const finalize = async (status, error) => {
      const terminal = { status, updated_at: new Date().toISOString(), payload: out };
      if (error) terminal.error = error;
      try {
        if (opts.runKey) {
          await db.collection(HEAD_TEST_RUNS_COLLECTION).update(opts.runKey, terminal);
        } else {
          await db.collection(HEAD_TEST_RUNS_COLLECTION).save({
            _key: `x${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
            repo_id: repoId,
            kind: 'explain',
            suite_key: suiteKey,
            run_key: out.run_key,
            created_at: new Date().toISOString(),
            created_by: (opts.actor && opts.actor.user_id) || 'system',
            ...terminal
          });
        }
      } catch (e) {
        logger.warn('head-suite.explain.persist_failed', { repo_id: repoId, error: e.message });
      }
    };
    if (!failing.length && !positiveKills.length) {
      out.note = 'no failures in the latest run — nothing to explain';
      // Only the ASYNC path needs a terminal write here — a caller that
      // invoked this directly already has `out` in hand and the long-standing
      // contract is that an empty result persists nothing. A placeholder with
      // no terminal write, by contrast, would poll 'running' forever.
      if (opts.runKey) await finalize('done');
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
          // 800, not 300 (live 2026-10-20): 300 starves a thinking model on
          // rung one by construction and is tight even for the JSON alone —
          // the adaptive ladder rescues it, but every rung is a full model
          // round trip; start where the answer actually fits.
          maxTokens: 800,
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
        out.note =
          'the suggestion model is unreachable — review the failing queries against the declared scope manually';
      }
      // Story 1-8d — the mechanical guardrail (self-subject + duplicate +
      // VETO-IMPACT simulation against this run's own positive queries).
      // A screened-out proposal NEVER reaches the UI chips.
      if (suggestionTags.length) {
        const headTestService = require('./head-test-service');
        const positiveQueries = (run.payload.results || [])
          .filter((q) => q && q.kind === 'positive')
          .map((q) => q.query)
          .filter(Boolean);
        const guard = await headTestService.guardSuggestions(repoId, suggestionTags, {
          ...opts,
          positiveQueries
        });
        out.suggested_tags = guard.accepted;
        out.rejected = guard.rejected;
        out.source = guard.accepted.length ? 'llm' : 'guardrail';
      }
    } else {
      out.note = 'no wrongly-claimed negatives — the failures are suppressed positives (see removal_suggestions)';
    }
    // Story 1-8d — explicit positive-improvement advice (David: "the
    // feedback needs to make recommendations to improve the pass level on
    // positives"). Veto kills name the tag to remove/narrow; margin kills
    // name the nearest forbidden tag.
    if (positiveKills.length) {
      const removalTags = removalSuggestions.map((r) => r.tag);
      out.improvements =
        marginKilled.length > 0
          ? `To improve the positive pass rate: remove or narrow ${removalTags.join(', ') || 'the nearest forbidden tags'} (vetoing positives), and review the forbidden tags nearest to the ${marginKilled.length} margin-killed positive${marginKilled.length > 1 ? 's' : ''} — their centroid contribution is suppressing in-scope queries.`
          : `To improve the positive pass rate: remove or narrow ${removalTags.join(', ') || 'the vetoing forbidden tags'} — they suppress in-scope queries.`;
    }
    // Story 1-8d — persist the advice so cycles are auditable.
    await finalize('done');
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

/**
 * Story 1-8d — the COMPREHENSIVE advisor (David: "the advisor output must
 * be comprehensive and consider all types of queries based on the query set
 * in the test suite... across multiple suites and cycles of tests").
 *
 * Unlike the per-run explain, this aggregates the queries of the last N
 * runs (every class), embeds them ONCE, and SIMULATES candidate tag-set
 * configurations against the production gate rules (floor + per-tag veto +
 * centroid margin) before recommending anything:
 *   - additions come from ONE LLM call over the failing queries of every
 *     class, then survive the veto-impact simulation (kill 0 positives);
 *   - removal candidates come ONLY from the loop's own recent writes
 *     (frontmatter_history) — curator-declared originals are never
 *     proposed for removal;
 *   - greedy acceptance with a hard constraint: a configuration that loses
 *     a single previously-passing positive is rejected.
 * Output: current vs predicted scorecard per class, the exact tag changes,
 * per-query effects, and the persisted advice doc (kind:'advisor').
 */
async function recommendTagSet(repoId, payload = {}, opts = {}) {
  return withSpan('okf.headsuite.recommend', async (span) => {
    span.setAttribute('okf.repo_id', repoId);
    const runLimit = Math.max(1, Math.min(parseInt(payload.run_limit, 10) || 5, 20));
    const db = await dbService.getConnection();
    await ensureCollection(db);
    const repo = await repositoryService.getById(repoId, { authz: opts.authz });
    const fm = await frontmatterService.readFrontmatterFromRepoDoc(repoId);
    const head = repo.head;
    if (!head || !Array.isArray(head.vector)) {
      const err = new Error('repo has no vectorized head — rebuild it before asking for advice');
      err.code = 'NO_HEAD';
      err.status = 409;
      throw err;
    }

    // 1. Queries of the last N runs, deduped by text, labeled by class.
    const runs = await (
      await db.query(
        'FOR r IN okf_head_test_runs FILTER r.repo_id == @k && r.kind == "run" SORT r.created_at DESC LIMIT @n RETURN r',
        { k: repoId, n: runLimit }
      )
    ).all();
    const byText = new Map();
    for (const r of runs) {
      for (const q of r.payload.results || []) {
        if (!q || !q.query || !q.kind) continue;
        const key = q.query.trim().toLowerCase();
        if (!byText.has(key))
          byText.set(key, {
            query: q.query,
            kind: q.kind,
            cls: q.cls || null,
            claimed: !!q.head_claimed,
            // 1-8g-s: the corpus verdict rides along — a negative failure
            // the corpus ANSWERS is a row problem (positive in disguise),
            // not a tag problem. Without this the advisor was blind to
            // exactly the evidence the Lab's Corpus column shows.
            probe: q.probe || null
          });
      }
    }
    const queries = [...byText.values()];
    if (!queries.length) {
      const err = new Error('no runs found — run a suite first');
      err.code = 'RUN_NOT_FOUND';
      err.status = 404;
      throw err;
    }

    // 2. Embed everything once — through the GATE's embedding contract
    //    (BGE query-instruction prefix; 1-8g-b: bare teiEmbed here put the
    //    simulation in a different vector space than the live gate and the
    //    scorecard's "Now" diverged wholesale from the real runs). Tag
    //    vectors: reuse the head's stored per-tag forbidden vectors where
    //    present (exact); embed fresh otherwise (same TEI path the head
    //    build uses).
    const qmeta = await headTestService.embedQueryBatch(queries.map((q) => q.query));
    const qvecs = qmeta.vectors;
    const headTagVectors = new Map();
    for (const fv of (head.per_field && head.per_field.forbidden_vectors) || []) {
      if (fv && typeof fv.tag === 'string' && Array.isArray(fv.vector)) headTagVectors.set(fv.tag, fv.vector);
    }
    const ownVectors = [];
    for (const f of ['topic', 'entity', 'keyword', 'summary', 'scope']) {
      if (Array.isArray(head.per_field && head.per_field[f])) ownVectors.push(head.per_field[f]);
    }
    const cos = (a, b) => {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return null;
      let d = 0,
        na = 0,
        nb = 0;
      for (let i = 0; i < a.length; i += 1) {
        d += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
      }
      return na && nb ? d / (Math.sqrt(na) * Math.sqrt(nb)) : null;
    };
    const centroid = (vectors) => {
      const dim = vectors[0].length;
      const acc = new Array(dim).fill(0);
      for (const v of vectors) for (let i = 0; i < dim; i += 1) acc[i] += v[i];
      return acc.map((x) => x / vectors.length);
    };
    const predict = (qv, tags, tagVecMap) => {
      const score = cos(qv, head.vector);
      if (score === null || score < GATE_FLOOR) return { claimed: false, why: 'floor' };
      const vecs = tags.map((t) => tagVecMap.get(t)).filter(Array.isArray);
      if (vecs.length) {
        for (const tv of vecs) {
          const c = cos(qv, tv);
          if (c !== null && c >= GATE_TAG_MAX) return { claimed: false, why: 'veto' };
        }
        const c = cos(qv, centroid(vecs));
        if (c !== null && score - c <= GATE_MARGIN) return { claimed: false, why: 'margin' };
      }
      return { claimed: true, why: null, score };
    };

    const evalConfig = async (tags) => {
      const newTags = tags.filter((t) => !headTagVectors.has(t));
      if (newTags.length) {
        const vecs = await frontmatterService.teiEmbed(newTags);
        newTags.forEach((t, i) => headTagVectors.set(t, vecs[i]));
      }
      const tagVecMap = new Map();
      for (const t of tags) if (headTagVectors.has(t)) tagVecMap.set(t, headTagVectors.get(t));
      const per = queries.map((q, i) => ({ ...q, ...predict(qvecs[i], tags, tagVecMap) }));
      const sc = { positive_claimed: 0, positive_total: 0, negative_suppressed: 0, negative_total: 0, by_cls: {} };
      for (const p of per) {
        if (p.kind === 'positive') {
          sc.positive_total += 1;
          if (p.claimed) sc.positive_claimed += 1;
        } else {
          sc.negative_total += 1;
          if (!p.claimed) sc.negative_suppressed += 1;
          const k = p.cls || 'confusable';
          sc.by_cls[k] = sc.by_cls[k] || { suppressed: 0, total: 0 };
          sc.by_cls[k].total += 1;
          if (!p.claimed) sc.by_cls[k].suppressed += 1;
        }
      }
      sc.score = sc.negative_suppressed + sc.positive_claimed * 2; // positives weigh double
      return { scorecard: sc, per };
    };

    const current = [...(fm.forbidden || [])];
    const before = await evalConfig(current);
    const goldPositives = before.per.filter((p) => p.kind === 'positive' && p.claimed);

    // 3. LLM proposals — additions ONLY for the classes a forbidden tag can
    //    legitimately exclude. 1-8g-d (live on Slaugherhouse): confusable
    //    rows belong to the sibling-SELECT leg (this repo must NOT veto
    //    them — the sibling should win them) and meta rows describe the Lab
    //    itself — a meta query once proposed "query-selection-process" and
    //    the simulation ACCEPTED it into a head. Positives are handled by
    //    removal/narrowing, never by adds.
    const ADD_LLM_CLASSES = new Set(['off-domain', 'forbidden', 'near-miss']);
    const failing = before.per.filter((p) => (p.kind === 'positive' ? !p.claimed : p.claimed));
    const failingForAdds = failing.filter((p) => p.kind === 'negative' && (!p.cls || ADD_LLM_CLASSES.has(p.cls)));
    // 1-8g-s — the corpus lever: a negative failure whose probe verdict is
    // answerable/weak is a ROW problem, not a tag problem — the ingested
    // corpus ANSWERS the query, so the row is a positive in disguise (the
    // tags and the corpus disagree, and the corpus is ground truth for
    // coverage). The advisor surfaces a flip recommendation with the
    // evidence; the UI applies it through the normal row flip. (Live
    // 2026-10-11, David: 3 answerable near-miss fails on NCD Information
    // and the advisor said nothing — it had NO row lever and never read
    // the probe verdicts; forbidden-tag adds can't fix near-misses by
    // design, their subjects ARE this repo's vocabulary.)
    const rowActions = failing
      .filter((p) => p.kind === 'negative' && p.probe && ['answerable', 'weak'].includes(p.probe.verdict))
      .slice(0, 10)
      .map((p) => ({
        query: p.query,
        cls: p.cls || null,
        action: 'flip',
        to_kind: 'positive',
        verdict: p.probe.verdict,
        top_score: p.probe.top_score,
        reason: `the corpus answers this query (rerank ${p.probe.top_score}, ${p.probe.verdict}) — it is a positive in disguise, not a routing failure`
      }));
    // The honest remainder: negative failures with NO corpus grounding —
    // a forbidden tag cannot fix them (the competitor must win them) and
    // the corpus does not support a flip either. Counted, never silently
    // dropped: the silence David saw is the bug this works against.
    const ungroundedNegativeFails = failing.filter(
      (p) => p.kind === 'negative' && (!p.probe || !['answerable', 'weak'].includes(p.probe.verdict))
    ).length;
    let llmAdds = [];
    try {
      const prompt = `A retrieval repository's routing test suite fails some queries across classes.

REPOSITORY scope — topics: ${(fm.topic || []).join(', ')}; entities: ${(fm.entity || []).join(', ')};
already forbidden: ${current.join(', ') || '(none)'}; summary: ${fm.summary || ''}

FAILING QUERIES (label — what went wrong):
${failingForAdds.map((q) => `- [${q.kind}${q.cls ? '/' + q.cls : ''}] ${q.query}`).join('\n')}

For the NEGATIVE queries that were wrongly claimed: propose UP TO 6 NEW
forbidden tags (lowercase kebab-case, 1-3 words) that exclude their
subjects. They must be NARROW domain tags (a broad clinical compound vetoes
half a corpus), must not overlap the already-forbidden list, and must not
exclude the repository's own topics/entities. Do NOT propose anything for
positive queries — those are fixed by REMOVING over-broad tags, not adding.
Respond with ONLY: {"add": ["...", "..."]}`;
      const resp = await frontmatterService.vllmChatCompletions([{ role: 'user', content: prompt }], {
        // 800, not 300 (live 2026-10-20): same reasoning as the batch-advice
        // call — start where the JSON answer actually fits so a thinking
        // model saves a ladder rung and a plain model never truncates.
        maxTokens: 800,
        temperature: 0.2
      });
      const content = resp.data && resp.data.choices && resp.data.choices[0] && resp.data.choices[0].message;
      const parsed = parseJsonObject(content && content.content);
      llmAdds = ((parsed && parsed.add) || [])
        .filter((t) => typeof t === 'string' && t.trim())
        .map((t) => t.trim().toLowerCase().replace(/\s+/g, '-'))
        .filter((t) => !current.includes(t))
        .slice(0, 6);
    } catch (e) {
      logger.warn('head-suite.recommend.llm_failed', { repo_id: repoId, error: e.message });
    }

    // 4. Removal candidates: the loop's own recent writes only (frontmatter
    //    history shapes minus the FIRST entry = the baseline lineage).
    const history = Array.isArray(repo.frontmatter_history) ? repo.frontmatter_history : [];
    const loopWritten = new Set();
    for (const h of history.slice(0, 5)) {
      for (const t of (h.shape && h.shape.forbidden) || []) loopWritten.add(String(t).toLowerCase());
    }
    const baseline =
      (history[history.length - 1] &&
        history[history.length - 1].shape &&
        history[history.length - 1].shape.forbidden) ||
      [];
    const removalCandidates = current.filter((t) => loopWritten.has(String(t).toLowerCase()) && !baseline.includes(t));

    // 5. Greedy search with the hard positive constraint.
    const working = [...current];
    const applied = { add: [], remove: [] };
    let dampedAdds = 0; // 1-8e: candidates skipped by the noise-fit guard
    const firstRejection = new Map(); // tag -> reason class (drives the retry pass)
    let best = before;
    const considerAdd = async (tag) => {
      if (working.includes(tag)) return null;
      const reject = (reason) => {
        if (!firstRejection.has(tag)) firstRejection.set(tag, reason);
        return { tag, rejected: reason };
      };
      if (applied.add.length >= ADVISOR_MAX_ADDS)
        return reject(`add cap reached (${ADVISOR_MAX_ADDS} per advisor run)`);
      const trial = await evalConfig([...working, tag]);
      const gainsPositives = trial.scorecard.positive_claimed > best.scorecard.positive_claimed;
      const losesPositive = trial.scorecard.positive_claimed < best.scorecard.positive_claimed;
      const negativeGain = trial.scorecard.negative_suppressed - best.scorecard.negative_suppressed;
      if (losesPositive) return reject('would suppress positive tests');
      if (negativeGain <= 0 && !gainsPositives) return reject('no predicted improvement');
      // 1-8e damping: a negatives-only gain must clear ADVISOR_MIN_NEGATIVE_GAIN —
      // a tag that buys exactly one suppressed negative on the current corpus is
      // noise-fitting (it will under-perform on queries the suite has not seen).
      if (!gainsPositives && negativeGain < ADVISOR_MIN_NEGATIVE_GAIN) {
        dampedAdds += 1;
        return reject(
          `suppresses only ${negativeGain} negative(s) — below the ${ADVISOR_MIN_NEGATIVE_GAIN}-gain noise-fit guard`
        );
      }
      working.push(tag);
      applied.add.push(tag);
      firstRejection.delete(tag);
      best = trial;
      return { tag, accepted: true, by_cls: trial.scorecard.by_cls };
    };
    const considerRemove = async (tag) => {
      const trial = await evalConfig(working.filter((t) => t !== tag));
      const gainsPositives = trial.scorecard.positive_claimed > best.scorecard.positive_claimed;
      const losesNegatives = trial.scorecard.negative_suppressed < best.scorecard.negative_suppressed;
      if (!gainsPositives || losesNegatives)
        return { tag, rejected: gainsPositives ? 'un-suppresses other negatives' : 'no positive gain' };
      const idx = working.indexOf(tag);
      if (idx >= 0) working.splice(idx, 1);
      applied.remove.push(tag);
      best = trial;
      return { tag, accepted: true };
    };
    const addResults = [];
    for (const tag of llmAdds) addResults.push(await considerAdd(tag));
    const removeResults = [];
    for (const tag of removalCandidates) removeResults.push(await considerRemove(tag));
    // second pass — interactions between accepted changes. Only 'no predicted
    // improvement' rejections are order-dependent (a later acceptance can
    // unlock a gain); damping and cap verdicts are final — retrying them
    // would double-count damped_adds and burn embeds re-deriving the same
    // rejection (caught by the 1-8e unit test).
    for (const tag of llmAdds.filter(
      (t) => !working.includes(t) && firstRejection.get(t) === 'no predicted improvement'
    ))
      addResults.push(await considerAdd(tag));

    // 6. 1-8g-c (live: 23 positive veto-kills, remove=[] forever): a tag the
    //    advisor may NOT auto-remove (curator original, or the sliding
    //    history window rotated the baseline away) can still be THE fix.
    //    Simulate the config WITHOUT it and surface the gain as a BLOCKED
    //    removal — tell the operator the one action that recovers positives
    //    instead of silently omitting it. Reason is a CODE (the UI
    //    translates): 'curator_original' | 'history_rotated'.
    const blockedRemovals = [];
    for (const tag of current) {
      if (removalCandidates.includes(tag)) continue;
      const trial = await evalConfig(current.filter((t) => t !== tag));
      const gain = trial.scorecard.positive_claimed - before.scorecard.positive_claimed;
      if (gain <= 0) continue;
      blockedRemovals.push({
        tag,
        predicted_positive_gain: gain,
        predicted_negative_loss: Math.max(
          0,
          before.scorecard.negative_suppressed - trial.scorecard.negative_suppressed
        ),
        predicted_score: trial.scorecard.score,
        reason: loopWritten.has(String(tag).toLowerCase()) ? 'history_rotated' : 'curator_original'
      });
    }
    blockedRemovals.sort((a, b) => b.predicted_positive_gain - a.predicted_positive_gain);

    // 7. Narrow options: a blocked removal whose cost is re-admitted
    //    negatives can often be REPLACED — remove the broad tag, add one of
    //    the already-proposed narrow candidates instead. Simulated as a
    //    PAIR against the current config; the best pair per blocked tag is
    //    surfaced when it strictly dominates (positives up, negatives not
    //    re-admitted). No extra LLM call — reuses llmAdds.
    const narrowOptions = [];
    for (const blocked of blockedRemovals) {
      if (!blocked.predicted_negative_loss || !llmAdds.length) continue;
      const base = current.filter((t) => t !== blocked.tag);
      let bestPair = null;
      for (const candidate of llmAdds) {
        if (base.includes(candidate)) continue;
        const trial = await evalConfig([...base, candidate]);
        const gainsPos = trial.scorecard.positive_claimed - before.scorecard.positive_claimed;
        const losesNeg = before.scorecard.negative_suppressed - trial.scorecard.negative_suppressed > 0;
        if (gainsPos <= 0 || losesNeg) continue;
        if (!bestPair || trial.scorecard.score > bestPair.predicted_score) {
          bestPair = {
            remove: blocked.tag,
            add: candidate,
            predicted_positive_gain: gainsPos,
            predicted_negative_loss: 0,
            predicted_score: trial.scorecard.score
          };
        }
      }
      if (bestPair) narrowOptions.push(bestPair);
    }

    const out = {
      repo_id: repoId,
      runs_considered: runs.length,
      queries_considered: queries.length,
      // 1-8g-b: the scope the scorecard aggregated — the UI renders it so
      // "which suite / which tag set am I looking at" is never a guess.
      scope: {
        suites: [...new Set(runs.map((r) => r.suite_key).filter(Boolean))],
        runs: runs.map((r) => ({
          run_key: r._key,
          suite_key: r.suite_key,
          created_at: r.created_at,
          tagset: r.tagset || null
        })),
        embedding_prefixed: qmeta.prefixed,
        embedding_model: qmeta.model
      },
      current_scorecard: before.scorecard,
      recommended_scorecard: best.scorecard,
      changes: { add: applied.add, remove: applied.remove },
      add_eval: addResults,
      remove_eval: removeResults,
      // 1-8g-c: the removals the advisor may not auto-apply, with their
      // predicted gains — and the narrow pairs that recover positives
      // without re-admitting negatives.
      blocked_removals: blockedRemovals,
      narrow_options: narrowOptions,
      // 1-8g-s: row-level recommendations from the corpus leg — flips for
      // negatives the corpus answers; plus the count of ungrounded
      // negative fails the advisor deliberately does NOT touch.
      row_actions: rowActions,
      ungrounded_negative_fails: ungroundedNegativeFails,
      gold_positives: goldPositives.length,
      note:
        applied.add.length || applied.remove.length
          ? 'apply the changes, rebuild the head, re-run the suite — predicted scorecard above'
          : rowActions.length
            ? `no tag-set change predicts an improvement — but ${rowActions.length} failing negative${rowActions.length === 1 ? '' : 's'} ${rowActions.length === 1 ? 'is' : 'are'} grounded in the corpus: flip ${rowActions.length === 1 ? 'it' : 'them'} to positives (row actions below)`
            : blockedRemovals.length
              ? 'no auto-applicable change predicts an improvement — the blocked removals below are what recovers the positives'
              : ungroundedNegativeFails
                ? `no tag-set change predicts an improvement — ${ungroundedNegativeFails} negative fail${ungroundedNegativeFails === 1 ? '' : 's'} have no corpus grounding and no safe tag lever (the competitor must win them)`
                : 'no tag-set change predicts an improvement — the remaining fails are curator tradeoffs or need head-topic growth',
      damped_adds: dampedAdds,
      damping: { min_negative_gain: ADVISOR_MIN_NEGATIVE_GAIN, max_adds: ADVISOR_MAX_ADDS }
    };
    try {
      await db.collection(HEAD_TEST_RUNS_COLLECTION).save({
        _key: `a${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
        repo_id: repoId,
        kind: 'advisor',
        created_at: new Date().toISOString(),
        created_by: (opts.actor && opts.actor.user_id) || 'system',
        payload: out
      });
    } catch (e) {
      logger.warn('head-suite.recommend.persist_failed', { repo_id: repoId, error: e.message });
    }
    span.setAttribute('okf.headsuite.queries', queries.length);
    span.setAttribute('okf.headsuite.add', applied.add.length);
    span.setAttribute('okf.headsuite.remove', applied.remove.length);
    logger.info('head-suite.recommend.done', {
      repo_id: repoId,
      queries: queries.length,
      add: applied.add,
      remove: applied.remove,
      blocked_removals: blockedRemovals.map((b) => b.tag),
      narrow_options: narrowOptions.length,
      row_actions: rowActions.length,
      ungrounded_negative_fails: ungroundedNegativeFails,
      score: `${before.scorecard.score} -> ${best.scorecard.score}`
    });
    return out;
  });
}

// 2026-10-20 — the advisor's async wrapper (202 + poll). Live: with a
// thinking model active, the comprehensive advisor takes MINUTES — embed
// every query of the recent runs, gate simulation, and an LLM call that
// climbs the adaptive ladder toward its ceiling — behind ONE synchronous
// POST the gateway killed it at ~60s ("The upstream server is timing
// out") while the server worked on to an answer nobody saw. Same
// DB-backed job shape as beginExplainFailures (1-8g-y): placeholder doc
// in the runs collection, an in-flight lock per repo, and a poll whose
// every path reaches a terminal state.
const recommendInFlight = new Map(); // repo_id -> job key

async function beginRecommendTagSet(repoId, payload = {}, opts = {}) {
  const db = await dbService.getConnection();
  await ensureCollection(db);
  // Synchronous pre-flight so the instant mistakes (no head, no runs)
  // stay 404/409 instead of becoming a 202 that fails on the first poll.
  const repo = await repositoryService.getById(repoId, { authz: opts.authz });
  if (!repo.head || !Array.isArray(repo.head.vector)) {
    const err = new Error('repo has no vectorized head — rebuild it before asking for advice');
    err.code = 'NO_HEAD';
    err.status = 409;
    throw err;
  }
  const runRows = await (
    await db.query(
      'FOR r IN okf_head_test_runs FILTER r.repo_id == @k && r.kind == "run" SORT r.created_at DESC LIMIT 1 RETURN r._key',
      { k: repoId }
    )
  ).all();
  if (!runRows.length) {
    const err = new Error('no runs found — run a suite first');
    err.code = 'RUN_NOT_FOUND';
    err.status = 404;
    throw err;
  }
  const inflight = recommendInFlight.get(repoId);
  if (inflight) {
    const err = new Error('an advisor run is already running for this repository');
    err.code = 'RECOMMEND_IN_FLIGHT';
    err.status = 409;
    // Same shape as RUN_IN_FLIGHT / EXPLAIN_IN_FLIGHT: the client adopts
    // the in-flight job and keeps polling instead of dead-ending.
    err.details = { job_key: inflight };
    throw err;
  }
  const jobKey = `a${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
  recommendInFlight.set(repoId, jobKey);
  const placeholder = {
    _key: jobKey,
    repo_id: repoId,
    kind: 'recommend',
    status: 'running',
    created_at: new Date().toISOString(),
    created_by: (opts.actor && opts.actor.user_id) || 'system',
    payload: {}
  };
  try {
    await db.collection(HEAD_TEST_RUNS_COLLECTION).save(placeholder);
  } catch (e) {
    // The lock is set BEFORE this awaited save; leaking it would wedge the
    // repo behind a permanent RECOMMEND_IN_FLIGHT with no doc behind the key.
    recommendInFlight.delete(repoId);
    throw e;
  }
  logger.info('head-suite.recommend_started', { repo_id: repoId, job_key: jobKey });
  const done = recommendTagSet(repoId, payload, opts)
    .then(async (result) => {
      await db
        .collection(HEAD_TEST_RUNS_COLLECTION)
        .update(jobKey, { status: 'done', updated_at: new Date().toISOString(), payload: result })
        .catch((dbErr) =>
          logger.error('head-suite.recommend.done_persist_failed', {
            repo_id: repoId,
            job_key: jobKey,
            error: dbErr.message
          })
        );
      return result;
    })
    .catch(async (e) => {
      // The placeholder must reach a terminal state or the poll hangs on
      // 'running' forever. Never leak a numeric driver code (the Arango
      // driver sets e.code=409 on conflicts, masking the real error).
      const code = typeof e.code === 'string' && e.code ? e.code : 'RECOMMEND_FAILED';
      await db
        .collection(HEAD_TEST_RUNS_COLLECTION)
        .update(jobKey, { status: 'failed', error: { code, message: e.message }, updated_at: new Date().toISOString() })
        .catch((dbErr) =>
          logger.error('head-suite.recommend.fail_persist_failed', {
            repo_id: repoId,
            job_key: jobKey,
            error: dbErr.message
          })
        );
      throw e;
    })
    .finally(() => recommendInFlight.delete(repoId));
  done.catch((e) =>
    logger.error('head-suite.recommend.async_failed', { repo_id: repoId, job_key: jobKey, error: e.message })
  );
  return { job_key: jobKey, done };
}

/** 2026-10-20 — the async advisor's poll: {status:'running'} keep waiting,
 * {status:'failed', error}, or the finished advice in `payload`. */
async function getRecommendJob(repoId, jobKey) {
  const db = await dbService.getConnection();
  await ensureCollection(db);
  if (recommendInFlight.get(repoId) === jobKey) {
    // The live envelope comes from the Map, not the doc, so the very first
    // poll after the 202 cannot read a placeholder that has not landed yet.
    return { job_key: jobKey, kind: 'recommend', status: 'running', payload: {} };
  }
  let doc;
  try {
    doc = await db.collection(HEAD_TEST_RUNS_COLLECTION).document(jobKey);
  } catch (err) {
    // Same not-found discriminator the rest of the codebase uses — the
    // driver surfaces 404 as errorNum 1202/1204 depending on the path.
    const code = err && (err.errorNum || err.statusCode || err.code);
    if (code === 404 || code === 1202 || code === 1204) {
      const e = new Error(`advisor job ${jobKey} not found`);
      e.code = 'JOB_NOT_FOUND';
      e.status = 404;
      throw e;
    }
    throw err;
  }
  if (doc.repo_id !== repoId || doc.kind !== 'recommend') {
    // Anti-enumeration: a key from another repo is "not found", not 403.
    const e = new Error(`advisor job ${jobKey} not found`);
    e.code = 'JOB_NOT_FOUND';
    e.status = 404;
    throw e;
  }
  return doc;
}

module.exports = {
  generateSuite,
  beginSuiteGeneration,
  suiteGenerationInFlight,
  suiteGenerationFailed,
  addQueries,
  getSuite,
  updateSuiteRows,
  beginRunSuite,
  getRunSuite,
  suiteRunRunning,
  sweepInterruptedRuns,
  renameSuite,
  deleteSuite,
  probeSuiteQuery,
  probeVerdict,
  probeReason,
  runSuite,
  probeQueryLight,
  listRuns,
  explainSuiteFailures,
  beginExplainFailures,
  getExplainFailures,
  recommendTagSet,
  beginRecommendTagSet,
  getRecommendJob,
  // test surface — ONLY the helpers the specs actually drive; the suite
  // generators are exercised through the public generateSuite/runSuite
  // boundaries.
  _internals: {
    summarizeRun,
    nearMissQueries
  }
};
