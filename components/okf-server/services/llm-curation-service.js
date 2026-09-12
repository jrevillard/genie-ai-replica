/**
 * services/llm-curation-service.js
 *
 * OKF import-time curation engine — Stage-1 fix D-B (issue #980) and the
 * autocorrect PROPOSE endpoint (D-L, issue #990). David's acceptance bar:
 * LLM-assisted must be far more accurate and complete than heuristics —
 * a real KH-L2 label auto-assigned per concept (bounded to the repo's
 * Subject Area), a proper type, and a description — slower is acceptable,
 * progress must be visible, and every decision must be logged
 * (spans + INFO decisions + OKF_CONVERSION_DEBUG transcripts).
 *
 * Contract:
 *   classification 'heuristics' -> zero LLM calls (labels stay a visible gap).
 *   classification 'llm'        -> LLM classifies type (TAXONOMY ALWAYS:
 *                                  clobbered), labels, describes every concept.
 *   classification 'hybrid'     -> heuristics type kept; LLM reviews only
 *                                  absent/'topic' placeholder types; LLM
 *                                  labels + describes everything.
 *   Fail-soft: any LLM failure degrades that concept to heuristics with
 *   curation.resolved_by='llm-error' — import NEVER blocks on the LLM.
 *   Bounded labels: a proposed label must be in the Subject Area's L2 list
 *   (or 'no_label') — the LLM can never invent knowledge-hierarchy entries.
 *
 * KH source of truth: `serviceCategories` (L1, nameEN) + `services`
 * (L2, categoryId). The repo's Subject Area is its `domain`, matched to L1
 * by slugified nameEN (verified live: domain 'Indonesia' -> L1 'Indonesia'
 * -> services History/Culture/Politics/...).
 */

const axios = require('axios');
const dbService = require('../shared-lib/db-connection-service');
const config = require('../config');
const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');

const TYPE_ENUM = ['topic', 'entity', 'process', 'event', 'source'];
const NO_LABEL = 'no_label';
const DEFAULT_LANES = 4;
const CURATION_TIMEOUT_MS = parseInt(process.env.OKF_CURATION_TIMEOUT_MS, 10) || 30000;
const BODY_SNIPPET_CHARS = 1200;

const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function debugEnabled() {
  return process.env.OKF_CONVERSION_DEBUG === '1';
}

/** Resolve the repo's Subject Area to its KH L1 + bounded L2 label list. */
async function resolveAreaContext(domain) {
  const db = await dbService.getConnection('default');
  const cats = await (await db.query('FOR c IN serviceCategories RETURN {key: c._key, name: c.nameEN}')).all();
  const hit = cats.find((c) => slugify(c.name) === slugify(domain));
  if (!hit) return null;
  const svcs = await (
    await db.query('FOR s IN services FILTER s.categoryId == @k SORT s.nameEN RETURN s.nameEN', {
      k: hit.key
    })
  ).all();
  return { key: hit.key, nameEN: hit.name, labels: svcs };
}

/** vLLM chat call — mirrors runLlmSummary's endpoint/bearer normalization
 * (concept-meta-service) with strict-JSON output and curation-sized limits. */
async function callVllm(messages, { timeoutMs = CURATION_TIMEOUT_MS } = {}) {
  const t0 = Date.now();
  const rawBase = config?.llm?.endpoint || process.env.VLLM_ENDPOINT;
  const model = config?.llm?.model || process.env.VLLM_MODEL_ID;
  if (!rawBase || !model) throw new Error('llm-not-configured');
  const base = rawBase.replace(/\/+$/, '').replace(/\/v1$/, '');
  const headers = {};
  const apiKey = process.env.VLLM_API_KEY || config?.llm?.apiKey;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const r = await axios.post(
    `${base}/v1/chat/completions`,
    { model, messages, temperature: 0.0, max_tokens: 300, response_format: { type: 'json_object' } },
    { timeout: timeoutMs, headers }
  );
  // DEBUG (David, 2026-09-08 "prove the LLM ran"): every call logs its
  // target, latency and token usage when OKF_CONVERSION_DEBUG=1.
  if (debugEnabled()) {
    logger.info(
      '[ llm-curation ] vLLM call OK ' +
        (r.data?.usage?.total_tokens != null ? 'tokens=' + r.data.usage.total_tokens + ' ' : '') +
        'in ' +
        (Date.now() - t0) +
        'ms model=' +
        model
    );
  }
  return (r.data?.choices?.[0]?.message?.content || '').trim();
}

function buildCurationPrompt(concept, areaLabels) {
  const system =
    'You are a knowledge-base curator. Answer with STRICT JSON only: ' +
    '{"type": one of ' +
    JSON.stringify(TYPE_ENUM) +
    ', ' +
    '"label": one of ' +
    JSON.stringify(areaLabels.concat([NO_LABEL])) +
    ', ' +
    '"summary": "one or two factual sentences describing this entry"}. ' +
    'The label MUST come from the provided list (use "' +
    NO_LABEL +
    '" if none fits) — ' +
    "never invent labels. The type is the entry's fundamental nature.";
  const user =
    'Title: ' +
    (concept.title || concept.concept_id) +
    '\n' +
    'Content:\n' +
    String(concept.body || '').slice(0, BODY_SNIPPET_CHARS);
  return {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  };
}

/** Parse + validate a curation response. Returns the SAFE subset only —
 * anything outside the bounded lists is dropped (bounded-growth rule). */
function parseCurationResponse(raw, areaLabels) {
  let j;
  try {
    j = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'unparseable' };
  }
  const type = TYPE_ENUM.includes(j.type) ? j.type : null;
  const label = areaLabels.includes(j.label) ? j.label : null;
  const summary = typeof j.summary === 'string' && j.summary.trim() ? j.summary.trim() : null;
  const proposedOutsideList = Boolean(j.label) && label === null;
  return { ok: true, type, label, summary, proposedOutsideList };
}

/** Lane-bounded worker pool. Never more than `lanes` concurrent LLM calls. */
async function runPool(items, lanes, worker) {
  let next = 0;
  const n = Math.max(1, Math.min(lanes, items.length));
  const runners = Array.from({ length: n }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

/**
 * Import-time curation pass over every parsed concept of a repo.
 * @returns {Promise<{method, total, curated, labeled, described, typed, fallbacks}>}
 * Caller wires onProgress into the repo progress payload (BuildProgressCard).
 */
/** Deterministic keyword labeler (David's heuristics ruling, 2026-09-08):
 * match the concept's own words against the Subject Area's KH L2 service
 * names — zero LLM, fully reproducible. Distinctive tokens only (no
 * stopwords/short words); the label with the most token hits wins, ties go
 * to the first. No hit → no label (an honest gap, visible in the counters). */
function keywordLabelFor(meta, areaLabels) {
  const STOP = new Set([
    'the',
    'and',
    'of',
    'for',
    'with',
    'from',
    'service',
    'services',
    'general',
    'other',
    'management',
    'information'
  ]);
  const text = (
    (meta.title || '') +
    '\n' +
    (meta.summary || '') +
    '\n' +
    String(meta.body || '').slice(0, 4000)
  ).toLowerCase();
  const tokens = new Set(String(text).match(/[a-z]{4,}/g) || []);
  let best = null;
  let bestHits = 0;
  for (const label of areaLabels) {
    const words =
      String(label)
        .toLowerCase()
        .match(/[a-z]{4,}/g) || [];
    let hits = 0;
    for (const w of words) {
      if (!STOP.has(w) && tokens.has(w)) hits += 1;
      else if (!STOP.has(w) && w.length >= 6) {
        // prefix hit for inflections (financ*/govern*/entit* — plural, -ing, -ion)
        for (const t of tokens) {
          if (t.startsWith(w.slice(0, 5))) {
            hits += 1;
            break;
          }
        }
      }
      if (hits > bestHits) {
        bestHits = hits;
        best = label;
      }
    }
  }
  return bestHits > 0 ? best : null;
}

async function curateRepoConcepts(repo, { classification, lanes, onProgress } = {}) {
  const mode = classification === 'llm' || classification === 'hybrid' ? classification : 'heuristics';
  const stats = { method: mode, total: 0, curated: 0, labeled: 0, described: 0, typed: 0, fallbacks: 0 };
  const db = await dbService.getConnection('default');
  const rows = await (
    await db.query(
      'FOR m IN okf_concepts_meta FILTER m.repo_id == @r AND m.index_status != "rejected" SORT m.concept_id RETURN m',
      { r: repo.repo_id }
    )
  ).all();
  stats.total = rows.length;
  const area = await resolveAreaContext(repo.domain);
  const areaLabels = area ? area.labels : [];
  const areaOk = Boolean(area) && areaLabels.length > 0;
  if (mode === 'heuristics') {
    // HEURISTICS LABELS (David's ruling, 2026-09-08): keyword-match the
    // Subject Area's KH L2 services — deterministic, zero-LLM, reproducible;
    // no match stays an honest visible gap. Rows already carrying labels
    // (authorial) are never touched.
    if (rows.length === 0 || !areaOk) {
      if (!areaOk) {
        logger.warn(
          'OKF heuristics labeling: no KH L2 labels for the Subject Area — skipped (repo=' + repo.repo_id + ')'
        );
      }
      if (onProgress) onProgress({ ...stats });
      return stats;
    }
    const work = rows.filter((m) => !m.is_index && !(Array.isArray(m.labels) && m.labels.length > 0));
    await runPool(work, parseInt(process.env.OKF_CURATION_LANES, 10) || lanes || DEFAULT_LANES, async (meta) => {
      const label = keywordLabelFor(meta, areaLabels);
      stats.curated += 1;
      if (label) {
        try {
          await applyDecision(
            db,
            repo,
            meta,
            { label, summary: null, type: null, typeApplied: false, resolved_by: 'keyword-match' },
            mode
          );
          stats.labeled += 1;
        } catch (e) {
          logger.warn('OKF heuristics labeling: apply failed for ' + meta.concept_id + ': ' + e.message);
        }
      }
    });
    logger.info(
      'OKF heuristics labeling complete: total=' +
        stats.total +
        ' labeled=' +
        stats.labeled +
        ' (repo=' +
        repo.repo_id +
        ' area=' +
        (area ? area.nameEN : 'none') +
        ')'
    );
    if (onProgress) onProgress({ ...stats, final: true }); // bypasses the caller's throttle
    return stats;
  }
  if (!areaOk) {
    logger.warn(
      'OKF curation: repo Subject Area has no KH L2 labels — labeling skipped as a visible gap' +
        ' (repo=' +
        repo.repo_id +
        ' domain=' +
        JSON.stringify(repo.domain) +
        ')'
    );
  }

  const work = rows.filter((m) => !m.is_index);
  const laneCount = parseInt(process.env.OKF_CURATION_LANES, 10) || lanes || DEFAULT_LANES;
  let done = 0;
  const passT0 = Date.now();

  await withSpan('okf.llm.curation', async (span) => {
    span.setAttribute('okf.repo_id', repo.repo_id);
    span.setAttribute('okf.curation.mode', mode);
    span.setAttribute('okf.curation.concepts', work.length);
    span.setAttribute('okf.curation.lanes', laneCount);
    span.setAttribute('okf.curation.area', area ? area.nameEN : 'none');

    await runPool(work, laneCount, async (meta) => {
      const t0 = Date.now();
      const decision = await curateOne(meta, { mode, areaLabels, areaOk });
      if (debugEnabled()) {
        logger.info(
          '[ llm-curation ] ' +
            meta.concept_id +
            ' → label=' +
            (decision.label || NO_LABEL) +
            ' described=' +
            (decision.summary ? 'yes' : 'no') +
            ' type=' +
            (decision.typeApplied ? decision.type : 'authorial-kept') +
            ' resolved_by=' +
            decision.resolved_by +
            ' in ' +
            (Date.now() - t0) +
            'ms'
        );
      }
      try {
        await applyDecision(db, repo, meta, decision, mode);
      } catch (e) {
        logger.warn('OKF curation: apply failed for ' + meta.concept_id + ': ' + e.message);
        decision.resolved_by = 'apply-error';
      }
      stats.curated += 1;
      if (decision.label) stats.labeled += 1;
      if (decision.summary) stats.described += 1;
      if (decision.typeApplied) stats.typed += 1;
      if (decision.resolved_by === 'llm-error' || decision.resolved_by === 'llm-unparseable') stats.fallbacks += 1;
      done += 1;
      if (onProgress) onProgress({ ...stats, done });
    });
  });

  logger.info(
    'OKF curation complete: method=' +
      mode +
      ' took=' +
      (Date.now() - passT0) +
      'ms total=' +
      stats.total +
      ' labeled=' +
      stats.labeled +
      ' described=' +
      stats.described +
      ' typed=' +
      stats.typed +
      ' fallbacks=' +
      stats.fallbacks +
      ' (repo=' +
      repo.repo_id +
      ' area=' +
      (area ? area.nameEN : 'none') +
      ')'
  );
  if (onProgress) onProgress({ ...stats, final: true }); // bypasses the caller's throttle
  return stats;
}

/** Curate a single concept. Pure decision + LLM call; no writes. */
async function curateOne(meta, { mode, areaLabels, areaOk }) {
  const decision = {
    type: null,
    typeApplied: false,
    label: null,
    summary: null,
    method: mode,
    resolved_by: 'llm',
    label_source: 'none'
  };
  if (!areaOk) {
    decision.resolved_by = 'no-subject-area-labels';
    return decision;
  }
  try {
    const { messages } = buildCurationPrompt(meta, areaLabels);
    if (debugEnabled()) {
      logger.debug('[curation:prompt] ' + meta.concept_id + ' :: ' + JSON.stringify(messages));
    }
    const raw = await withSpan('okf.llm.curation.concept', async (span) => {
      span.setAttribute('okf.concept_id', meta.concept_id);
      span.setAttribute('okf.curation.mode', mode);
      return callVllm(messages);
    });
    if (debugEnabled()) {
      logger.debug('[curation:response] ' + meta.concept_id + ' :: ' + String(raw).slice(0, 2000));
    }
    const parsed = parseCurationResponse(raw, areaLabels);
    if (!parsed.ok) {
      decision.resolved_by = 'llm-unparseable';
      return decision;
    }
    // TYPE TAXONOMY (David, 2026-09-08: "type: topic, entity, process, event,
    // source"): EVERY concept carries a taxonomy type — the LLM verdict
    // replaces authorial vocabularies (Subsidiary, FinancialLedger, …).
    // Only the structural 'index' root keeps its type.
    if (parsed.type && mode === 'llm' && meta.type !== 'index') {
      decision.type = parsed.type;
      decision.typeApplied = true;
    }
    // Label: bounded to the area list by parseCurationResponse.
    if (parsed.label) {
      decision.label = parsed.label;
      decision.label_source = 'llm';
    }
    decision.summary = parsed.summary;
    return decision;
  } catch (e) {
    logger.warn('OKF curation: LLM call failed for ' + meta.concept_id + ' — falling back: ' + e.message);
    decision.resolved_by = 'llm-error';
    return decision;
  }
}

/** Persist one decision. Recomposes ingest_labels through the single
 * authority so the drain sees the label (lazy require: ingest-service
 * requires this module for wiring — cycle broken at call time, house style). */
async function applyDecision(db, repo, meta, decision) {
  const { composeIngestLabels } = require('./ingest-service');
  const patch = {
    curation: { method: decision.method, resolved_by: decision.resolved_by, label_source: decision.label_source }
  };
  if (decision.typeApplied) patch.type = decision.type;
  if (decision.summary) patch.summary = decision.summary;
  if (decision.label) {
    patch.labels = [decision.label];
    patch.ingest_labels = composeIngestLabels(repo, [decision.label]);
  }
  await db.collection('okf_concepts_meta').update(meta._key, patch);
}

/**
 * D-L propose — autocorrect PROPOSE for one concept (concept_id) or the whole
 * repo (concept_id null). Returns {before, after, changes[]} with from-empty
 * support: a concept with NO frontmatter yields before={} and after=the full
 * correct frontmatter proposal. Mode-aware per David: heuristics proposes
 * mechanical fixes only; llm/hybrid propose curated type/label/summary too.
 */
async function proposeFrontmatter(repo, concept_id, { classification } = {}) {
  const mode = classification === 'llm' || classification === 'hybrid' ? classification : 'heuristics';
  const db = await dbService.getConnection('default');
  // Bind vars MUST match the query text: the repo-wide pass (concept_id null)
  // omits the @c filter, and ArangoDB rejects a query that declares binds the
  // text never uses ("bind parameter 'c' was not declared") — the repo-wide
  // autocorrect proposal 500'd on exactly that (live, 2026-09-12; the unit
  // mocks never execute AQL so they couldn't see it).
  const query = concept_id
    ? 'FOR m IN okf_concepts_meta FILTER m.repo_id == @r AND m.concept_id == @c SORT m.concept_id RETURN m'
    : 'FOR m IN okf_concepts_meta FILTER m.repo_id == @r SORT m.concept_id RETURN m';
  const bindVars = concept_id ? { r: repo.repo_id, c: concept_id } : { r: repo.repo_id };
  const rows = await (await db.query(query, bindVars)).all();
  if (concept_id && rows.length === 0) return null;

  const area = mode === 'heuristics' ? null : await resolveAreaContext(repo.domain);
  const areaLabels = area ? area.labels : [];
  const proposals = [];
  for (const meta of rows) {
    const before = meta.frontmatter || {};
    const after = { ...before };
    const changes = [];
    const push = (field, value, reason) => {
      if (value === null || value === undefined) return;
      if (JSON.stringify(before[field]) === JSON.stringify(value)) return;
      after[field] = value;
      changes.push({ field, before: before[field] === undefined ? null : before[field], after: value, reason });
    };
    // Mechanical corrections (always — superset of Story #978).
    if (!after.type) push('type', 'topic', 'MISSING_TYPE');
    if (!after.title) {
      const m = String(meta.body || '').match(/^#{1,2}\s+(.+?)\s*$/m);
      push('title', m ? m[1].trim() : meta.title || meta.concept_id, 'MISSING_TITLE');
    }
    if (!Array.isArray(after.sources)) push('sources', [], 'MISSING_SOURCES');
    // Curated corrections (llm/hybrid — the D-L point: from-empty means the
    // proposal is the WHOLE correct frontmatter, not just placeholders).
    if (mode !== 'heuristics' && areaLabels.length > 0) {
      const decision = await curateOne(meta, { mode, areaLabels, areaOk: true });
      if (decision.type) push('type', decision.type, 'CURATED_TYPE');
      if (decision.label) push('labels', [decision.label], 'CURATED_LABEL');
      if (decision.summary) push('summary', decision.summary, 'CURATED_SUMMARY');
    }
    proposals.push({ concept_id: meta.concept_id, before, after, changes });
  }
  return concept_id ? proposals[0] || null : proposals;
}

module.exports = {
  resolveAreaContext,
  curateRepoConcepts,
  proposeFrontmatter,
  parseCurationResponse,
  buildCurationPrompt,
  TYPE_ENUM,
  NO_LABEL
};
