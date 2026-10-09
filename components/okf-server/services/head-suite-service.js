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
    const suiteDoc = {
      _key: suiteKey,
      repo_id: repoId,
      kind: 'suite',
      suite_key: suiteKey,
      // Story 1-8f — the curator's name for the suite (optional; the key
      // remains the identity). Rendered in the Saved-suites table.
      name: suiteName,
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

// Story 1-8f2 — ASYNC generation. A large ask (100 positives) batches
// across several LLM calls and takes MINUTES; the synchronous request dies
// at the gateway long before (live 2026-10-09: the suite saved at minute 5
// while the browser had given up at 60s). beginSuiteGeneration pre-mints
// the key, kicks the worker DETACHED, and returns immediately; the UI
// polls GET /routing-testsuite/:key until the doc lands. One generation
// per repo at a time (a second begin while one is in flight is a 409).
const suiteGenInFlight = new Map(); // repo_id -> suite_key

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

function beginSuiteGeneration(repoId, payload = {}, opts = {}) {
  const inflight = suiteGenInFlight.get(repoId);
  if (inflight) {
    const err = new Error('a suite generation is already running for this repository');
    err.code = 'GENERATION_IN_FLIGHT';
    err.status = 409;
    err.suite_key = inflight;
    throw err;
  }
  const suiteKey = `s${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
  suiteGenInFlight.set(repoId, suiteKey);
  const done = generateSuite(repoId, payload, { ...opts, suiteKey })
    .then((suite) => suite)
    .finally(() => suiteGenInFlight.delete(repoId));
  // The controller responds 202 without awaiting `done`; a hard failure
  // (DB down) means no doc ever lands — the UI's poll times out with an
  // honest message. Log it here so the failure is visible.
  done.catch((e) =>
    logger.error('head-suite.generate.async_failed', { repo_id: repoId, suite_key: suiteKey, error: e.message })
  );
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
    suite.payload.positive.push(...clean.filter((q) => q.kind === 'positive'));
    suite.payload.negative.push(...clean.filter((q) => q.kind === 'negative'));
    await db.collection(HEAD_TEST_RUNS_COLLECTION).replace(suite._key, suite);
    logger.info('head-suite.queries_added', { repo_id: repoId, suite_key: suiteKey, added: clean.length });
    return suite;
  });
}

// ---------- public: load + edit rows (Story 1-8f — David: "the test suites
// need to be able to be saved, modified and rerun (of course)") ----------
// Suites already persist (kind:'suite' docs) and rerun by key; what was
// missing is LOADING one back into the Lab and EDITING its rows — until now
// a row could only be ADDED, so a mislabeled row (the HIV positive) was
// permanent noise and had to be duplicated with the other kind.

const SUITE_ROW_CAPS = { positive: 60, negative: 150 };

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
    const validUpdate = (u) =>
      u && validRow(u.match) && u.set && (u.set.kind === 'positive' || u.set.kind === 'negative');
    if (!updates.filter(validUpdate).length && !removes.filter(validRow).length) {
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
    let removed = 0;
    let relabeled = 0;

    // 1. Removes — every exact {query, kind} match goes.
    for (const r of removes.filter(validRow)) {
      const target = r.kind === 'positive' ? pos : neg;
      const idx = target.findIndex((row) => row.query === r.query.trim() && row.kind === r.kind);
      if (idx >= 0) {
        target.splice(idx, 1);
        removed += 1;
      }
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
      const idxIn = (arr) => arr.findIndex((row) => row.query === u.match.query.trim() && row.kind === from);
      let idx = idxIn(pos);
      let srcArr = pos;
      if (idx < 0) {
        idx = idxIn(neg);
        srcArr = neg;
      }
      if (idx < 0) continue;
      const [row] = srcArr.splice(idx, 1);
      dst.push({ ...row, kind: to, cls: null });
      relabeled += 1;
    }

    // 3. Invariants — no contradiction (same text in BOTH arrays makes every
    //    run self-refuting) and no text duplicated within an array (the run
    //    would count it twice); caps as a sanity backstop.
    const norm = (s) =>
      String(s || '')
        .trim()
        .toLowerCase();
    const contradiction = pos.find((r) => neg.some((n) => norm(n.query) === norm(r.query)));
    if (contradiction) {
      const err = new Error(`query is both positive and negative: "${contradiction.query.slice(0, 80)}"`);
      err.code = 'SUITE_CONTRADICTION';
      err.status = 409;
      throw err;
    }
    const dupIn = (arr) => arr.some((r, i) => arr.findIndex((x) => norm(x.query) === norm(r.query)) !== i);
    if (dupIn(pos) || dupIn(neg)) {
      const err = new Error('duplicate query text within one kind after the update');
      err.code = 'SUITE_DUPLICATE';
      err.status = 409;
      throw err;
    }
    if (pos.length > SUITE_ROW_CAPS.positive || neg.length > SUITE_ROW_CAPS.negative) {
      const err = new Error(
        `suite row cap exceeded (positive ≤ ${SUITE_ROW_CAPS.positive}, negative ≤ ${SUITE_ROW_CAPS.negative})`
      );
      err.code = 'SUITE_CAP';
      err.status = 409;
      throw err;
    }

    suite.payload.positive = pos;
    suite.payload.negative = neg;
    suite.updated_at = new Date().toISOString();
    suite.updated_by = (opts.actor && opts.actor.user_id) || 'system';
    await db.collection(HEAD_TEST_RUNS_COLLECTION).replace(suite._key, suite);
    span.setAttribute('okf.headsuite.relabeled', relabeled);
    span.setAttribute('okf.headsuite.removed', removed);
    logger.info('head-suite.rows_updated', {
      repo_id: repoId,
      suite_key: suiteKey,
      relabeled,
      removed,
      positives: pos.length,
      negatives: neg.length
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
      // 1-8e — the forbidden tag set this run evaluated against (the TUNING
      // IDENTITY). Same-tags reruns are bit-stable (verified 2026-10-09: 0
      // flipped rows across same-head runs), so a pass_rate change between
      // runs means the TAG SET changed — the history renders this so the
      // curator compares like with like instead of seeing phantom
      // regressions while tuning.
      tagset: tagsetOf(repo),
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
      '"name", "repo_version", "head_version", "tagset", "created_at", "created_by"]), ' +
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
          byText.set(key, { query: q.query, kind: q.kind, cls: q.cls || null, claimed: !!q.head_claimed });
      }
    }
    const queries = [...byText.values()];
    if (!queries.length) {
      const err = new Error('no runs found — run a suite first');
      err.code = 'RUN_NOT_FOUND';
      err.status = 404;
      throw err;
    }

    // 2. Embed everything once. Tag vectors: reuse the head's stored
    //    per-tag forbidden vectors where present (exact); embed fresh
    //    otherwise (same TEI path the head build uses).
    const qvecs = await frontmatterService.teiEmbed(queries.map((q) => q.query));
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

    // 3. LLM proposals — additions for EVERY failing class, removals are
    //    only sourced from the loop's own recent writes.
    const failing = before.per.filter((p) => (p.kind === 'positive' ? !p.claimed : p.claimed));
    let llmAdds = [];
    try {
      const prompt = `A retrieval repository's routing test suite fails some queries across classes.

REPOSITORY scope — topics: ${(fm.topic || []).join(', ')}; entities: ${(fm.entity || []).join(', ')};
already forbidden: ${current.join(', ') || '(none)'}; summary: ${fm.summary || ''}

FAILING QUERIES (label — what went wrong):
${failing.map((q) => `- [${q.kind}${q.cls ? '/' + q.cls : ''}] ${q.query}`).join('\n')}

For the NEGATIVE queries that were wrongly claimed: propose UP TO 6 NEW
forbidden tags (lowercase kebab-case, 1-3 words) that exclude their
subjects. They must be NARROW domain tags (a broad clinical compound vetoes
half a corpus), must not overlap the already-forbidden list, and must not
exclude the repository's own topics/entities. Do NOT propose anything for
positive queries — those are fixed by REMOVING over-broad tags, not adding.
Respond with ONLY: {"add": ["...", "..."]}`;
      const resp = await frontmatterService.vllmChatCompletions([{ role: 'user', content: prompt }], {
        maxTokens: 300,
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

    const out = {
      repo_id: repoId,
      runs_considered: runs.length,
      queries_considered: queries.length,
      current_scorecard: before.scorecard,
      recommended_scorecard: best.scorecard,
      changes: { add: applied.add, remove: applied.remove },
      add_eval: addResults,
      remove_eval: removeResults,
      gold_positives: goldPositives.length,
      note:
        applied.add.length || applied.remove.length
          ? 'apply the changes, rebuild the head, re-run the suite — predicted scorecard above'
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
      score: `${before.scorecard.score} -> ${best.scorecard.score}`
    });
    return out;
  });
}

module.exports = {
  generateSuite,
  beginSuiteGeneration,
  suiteGenerationInFlight,
  addQueries,
  getSuite,
  updateSuiteRows,
  renameSuite,
  runSuite,
  listRuns,
  explainSuiteFailures,
  recommendTagSet,
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
