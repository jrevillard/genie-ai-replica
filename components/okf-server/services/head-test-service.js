// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
//
// head-test-service — Story 1-8 (2026-10-08): the OKF Head Tester &
// Routing Lab backend. Three surfaces:
//
//   rebuildHead(repoId)      — re-run buildVectorizedHead from the
//                              CURRENT stored frontmatter (fixes a
//                              missing/stale head; publish is warn-only
//                              on a TEI outage, so heads can be absent).
//   routingTest(repoId, {})  — the two-leg simulation:
//     LEG A (head routing, works PRE-INGEST): cosine(query, head) for
//       the repo under test + every sibling with a head — INCLUDING
//       graph-less repos (a published-not-ingested repo has a head but
//       no graph; its winning the head leg IS the selectivity signal —
//       per David 2026-10-08: "it is just signalling; the query would
//       not be executed").
//     LEG B (chunk-probe replay, ground truth, needs graphs): replicates
//       the Story 1.3 production router exactly — same probe AQL, same
//       global top-40 merge, graph qualifies iff it contributes
//       >= ROUTE_MIN_CHUNKS chunks, floor = single best graph, any
//       probe failure after retry → degraded (mirrors retriever
//       genieai_retriever_arangodb.py:1694-1788).
//
// Formula experimentation (David: "get the best formula before
// ingestion"): the stored head.per_field vectors let the lab recompute
// the head score under alternate weights WITHOUT rebuilding the head.
//   formula = 'default'                    → use the STORED head.vector
//                                            (exact production parity;
//                                            the shape MR-D reads)
//   formula = 'uniform'                    → unweighted mean of the
//                                            present positive per-field
//                                            cosines
//   formula = {topic, entity, keyword, summary, scope, forbidden} →
//     weighted mean of positive per-field cosines, minus
//     w_forbidden × cosine(q, forbidden centroid) when w_forbidden > 0
//     and the centroid exists (needs a head rebuilt after the 1-8
//     forbidden-centroid fix).
//
// Embedding fidelity: chatqna embeds production queries WITH the
// model's query-instruction prefix ("Represent this sentence for
// searching relevant passages: " for BAAI/bge-large-en-v1.5 —
// genie-ai-overlay/core/embedding_query_prefix.py:28,36). The legacy
// probe scripts skipped the prefix (known fidelity gap); this service
// applies it, with an env override for deployer-specific models.

'use strict';

const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');
const dbService = require('../shared-lib/db-connection-service');

// Pull the sibling primitives from frontmatter-service rather than
// re-implementing them (teiEmbed already carries the credential chain,
// timeout and retry; buildVectorizedHead is the single head writer).
const frontmatterService = require('./frontmatter-service');
const repositoryService = require('./repository-service');

// ---------- embedding model / query-instruction prefix ----------

// Mirrors genie-ai-overlay/core/embedding_query_prefix.py (builtin
// table; trailing space is part of the protocol). Unknown models get
// NO prefix (the Python side behaves the same for unknown ids).
const QUERY_INSTRUCTIONS = {
  'bge-large-en-v1.5': 'Represent this sentence for searching relevant passages: ',
  'bge-base-en-v1.5': 'Represent this sentence for searching relevant passages: '
};

const EMBED_MODEL_ID = process.env.EMBEDDING_MODEL_ID || '';
// Deployer override for models outside the table: the full prefix
// string (empty string disables the prefix entirely).
const EMBED_QUERY_PREFIX_OVERRIDE = process.env.EMBED_QUERY_PREFIX_OVERRIDE || null;

function queryInstructionFor(modelId) {
  if (EMBED_QUERY_PREFIX_OVERRIDE !== null) return EMBED_QUERY_PREFIX_OVERRIDE;
  for (const [needle, instruction] of Object.entries(QUERY_INSTRUCTIONS)) {
    if (modelId && modelId.includes(needle)) return instruction;
  }
  return '';
}

// ---------- route knobs (defaults = production retriever config.py) ----------

const ROUTE_TOP_K = parseInt(process.env.RETRIEVER_ROUTE_TOP_K || '40', 10);
const ROUTE_MIN_CHUNKS = parseInt(process.env.RETRIEVER_ROUTE_MIN_CHUNKS || '3', 10);
const ROUTE_PROBE_TIMEOUT_MS = parseInt(process.env.RETRIEVER_ROUTE_PROBE_TIMEOUT_MS || '2000', 10);
const ROUTE_RETRY = parseInt(process.env.RETRIEVER_ROUTE_RETRY || '1', 10);
// Story 1-8a (David 2026-10-08: "under no circumstances should 'fun in
// Indonesia' be routed to the NCD Information repo"): a head only CLAIMS a
// query when its score clears the forbidden centroid by this margin —
// forbidden-dominant and noise-floor queries are structurally suppressed
// regardless of universe size. Calibrated on NCD (2026-10-08): suppressed
// set spans avg−forbidden ∈ [−0.062, −0.008] (mental-health, nutrition,
// exercise, "fun in Indonesia"); selected set ≥ +0.024 ("genetic risk
// factors for cancer" — David: "probably in, given the tags"; on-topic
// positives +0.106..+0.122). Default 0.01 sits centered in the gap.
const ROUTE_HEAD_MARGIN = parseFloat(process.env.RETRIEVER_ROUTE_HEAD_MARGIN || '0.01');
// Story 1-8b (David 2026-10-09: "forbidden is forbidden — that is a hard
// contract, it should immediately score zero") — the gate hardens from one
// margin rule to a three-condition claim. Calibrated on NCD 2026-10-09
// (19-query probe, gate-probe-inner.js):
//   FLOOR: unrelated queries score 0.32-0.48 on ANY head ("capital of
//   France" 0.321, "forbidden noise gate" 0.407, "weather today" 0.484)
//   and the margin rule cannot see them (France claimed at +0.012). Legit
//   claims start at 0.614 → 0.55 sits mid-gap.
const ROUTE_HEAD_FLOOR = parseFloat(process.env.RETRIEVER_ROUTE_HEAD_FLOOR || '0.55');
//   VETO: a mixed-subject query (genetics+cancer 0.617, epidemiology+lung
//   0.619, exercise+asthma 0.638, incidence-trends 0.567) slips past the
//   averaged forbidden centroid but not its single dominant forbidden tag.
//   Legit claims never exceed 0.529 on any forbidden tag → 0.55 separates.
const ROUTE_FORBIDDEN_TAG_MAX = parseFloat(process.env.RETRIEVER_ROUTE_FORBIDDEN_TAG_MAX || '0.55');
const SIBLING_LIMIT = parseInt(process.env.OKF_HEAD_TEST_SIBLING_LIMIT || '20', 10);

// ---------- math helpers ----------

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return null;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return null;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const POSITIVE_FIELDS = ['topic', 'entity', 'keyword', 'summary', 'scope'];
const DEFAULT_WEIGHTS = { topic: 1.0, entity: 0.7, keyword: 0.5, summary: 0.5, scope: 0.3 };

/**
 * Head score for one repo against the query embedding, plus per-field
 * attribution. Returns {score, per_field, formula_used} — score is
 * null when no scoring basis exists (no head, or no per-field vectors
 * for a recompute formula).
 */
function scoreHead(head, queryVec, formula) {
  if (!head || !Array.isArray(head.vector)) return { score: null, per_field: null, tag_cosines: [] };
  const perFieldCos = {};
  for (const f of POSITIVE_FIELDS.concat(['forbidden'])) {
    const v = head.per_field && head.per_field[f];
    perFieldCos[f] = Array.isArray(v) ? cosine(queryVec, v) : null;
  }
  // Story 1-8b — per-tag forbidden cosines for the hard veto gate. Each
  // forbidden tag was embedded individually at head build time
  // (per_field.forbidden_vectors = [{tag, vector}]).
  const tagCosines = [];
  const forbiddenVectors = (head.per_field && head.per_field.forbidden_vectors) || [];
  if (Array.isArray(forbiddenVectors)) {
    for (const fv of forbiddenVectors) {
      if (!fv || typeof fv.tag !== 'string' || !Array.isArray(fv.vector)) continue;
      const c = cosine(queryVec, fv.vector);
      if (c !== null) tagCosines.push({ tag: fv.tag, cosine: c });
    }
  }
  if (formula === 'default' || formula === undefined || formula === null) {
    return {
      score: cosine(queryVec, head.vector),
      per_field: perFieldCos,
      tag_cosines: tagCosines,
      formula_used: 'default(stored-vector)'
    };
  }
  // Recompute formulas need per_field vectors.
  const hasAny = POSITIVE_FIELDS.some((f) => perFieldCos[f] !== null);
  if (!hasAny) return { score: null, per_field: perFieldCos, tag_cosines: tagCosines, formula_used: String(formula) };
  const weights =
    formula === 'uniform' ? { topic: 1, entity: 1, keyword: 1, summary: 1, scope: 1, forbidden: 0 } : formula; // caller-validated object
  let acc = 0;
  let totalW = 0;
  for (const f of POSITIVE_FIELDS) {
    const w = typeof weights[f] === 'number' && weights[f] >= 0 ? weights[f] : 0;
    if (perFieldCos[f] === null || w === 0) continue;
    acc += w * perFieldCos[f];
    totalW += w;
  }
  if (totalW === 0) return { score: null, per_field: perFieldCos, tag_cosines: tagCosines, formula_used: String(formula) };
  let score = acc / totalW;
  const wf = typeof weights.forbidden === 'number' ? weights.forbidden : 0;
  if (wf > 0 && perFieldCos.forbidden !== null) {
    // Penalty: subtract when the query is CLOSE to what the repo
    // declares it is NOT about (clamped at 0 so an anti-aligned query
    // never earns a bonus).
    score -= wf * Math.max(0, perFieldCos.forbidden);
  }
  return { score, per_field: perFieldCos, tag_cosines: tagCosines, formula_used: String(formula) };
}

// ---------- query embedding ----------

/**
 * Embed a test query EXACTLY like production chatqna does: BGE
 * query-instruction prefix + the shared TEI endpoint (same credential
 * chain and retry as frontmatter-service.teiEmbed).
 */
async function embedQuery(query) {
  const prefix = queryInstructionFor(EMBED_MODEL_ID);
  const vecs = await frontmatterService.teiEmbed([prefix + query]);
  const v = vecs && vecs[0];
  if (!Array.isArray(v) || !v.length) {
    const err = new Error('TEI embed returned no vector for the test query');
    err.code = 'EMBED_EMPTY';
    err.status = 502;
    throw err;
  }
  return { vector: v, prefixed: prefix.length > 0, model: EMBED_MODEL_ID || 'unknown' };
}

// ---------- chunk-probe replay (LEG B) ----------

/**
 * Replay ONE production routing probe: top-k cosine scores over the
 * graph's _SOURCE collection (same AQL shape as the retriever,
 * genieai_retriever_arangodb.py:1721-1728). Per-repo retry per
 * ROUTE_RETRY; a per-probe timeout never fails the whole test — the
 * repo is marked errored and the aggregate may become 'degraded'
 * (production semantics).
 */
async function probeGraph(db, graphName, queryVec, k) {
  const aql =
    'FOR doc IN `' +
    graphName +
    '_SOURCE` ' +
    'LET s = APPROX_NEAR_COSINE(doc.embedding, @emb) ' +
    'SORT s DESC LIMIT @k RETURN s';
  let lastErr = null;
  for (let attempt = 0; attempt <= ROUTE_RETRY; attempt += 1) {
    try {
      const cursor = await Promise.race([
        db.query(aql, { emb: queryVec, k }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('probe timeout')), ROUTE_PROBE_TIMEOUT_MS))
      ]);
      const rows = await cursor.all();
      return { top_scores: rows.map((r) => (typeof r === 'number' ? r : Number(r)) || 0), error: null };
    } catch (err) {
      lastErr = err;
      logger.warn('head-test.probe.retry', {
        graph: graphName,
        attempt,
        error: err && err.message
      });
    }
  }
  return { top_scores: null, error: (lastErr && lastErr.message) || 'probe failed' };
}

/**
 * Merge per-graph probe scores into the production qualification:
 * global top-k by score; count per graph; qualified iff count >=
 * ROUTE_MIN_CHUNKS; floor = single best-count graph when nothing
 * qualifies (routing NEVER selects zero — retriever :1771-1774).
 */
function qualifyProbes(scored /* [{graph, repo_id, top_scores}] */) {
  const rows = [];
  for (const g of scored) {
    if (!g.top_scores) continue;
    for (const s of g.top_scores) rows.push({ repo_id: g.repo_id, score: s });
  }
  rows.sort((a, b) => b.score - a.score);
  const top = rows.slice(0, ROUTE_TOP_K);
  const counts = {};
  for (const r of top) counts[r.repo_id] = (counts[r.repo_id] || 0) + 1;
  const perRepo = {};
  for (const g of scored) {
    perRepo[g.repo_id] = {
      probed: !!g.top_scores,
      error: g.error || null,
      chunks_in_top: counts[g.repo_id] || 0
    };
  }
  const qualified = Object.keys(counts).filter((rid) => counts[rid] >= ROUTE_MIN_CHUNKS);
  let floor = null;
  if (!qualified.length) {
    let best = -1;
    for (const [rid, c] of Object.entries(counts)) {
      if (c > best) {
        best = c;
        floor = rid;
      }
    }
  }
  const selected = qualified.length ? qualified : floor ? [floor] : [];
  const anyError = scored.some((g) => !g.top_scores && g.error);
  return { per_repo: perRepo, qualified, floor, selected, degraded: anyError };
}

// ---------- sibling loading ----------

/**
 * Every OTHER repo with a head (the head competition), regardless of
 * graph presence — graph-less siblings are legitimate head-leg
 * competitors (they signal selectivity without being searchable).
 * graph names come from ingested_graph_name (only ingested repos
 * have one).
 */
async function loadSiblings(db, underTestId) {
  const cursor = await db.query(
    'FOR r IN okf_repositories FILTER r._key != @me FILTER r.head != null ' +
      'SORT r.name RETURN KEEP(r, ["_key", "name", "lifecycle_state", "ingested_at", "ingested_graph_name", "version"])',
    { me: underTestId }
  );
  const rows = await cursor.all();
  return rows.map((r) => ({
    repo_id: r._key,
    name: r.name,
    lifecycle_state: r.lifecycle_state,
    serving: !!r.ingested_at,
    graph_name: r.ingested_graph_name || null
  }));
}

// ---------- public: rebuild ----------

async function rebuildHead(repoId, opts = {}) {
  return withSpan('okf.headtest.rebuild', async (span) => {
    span.setAttribute('okf.repo_id', repoId);
    // Authorization + existence go through the same pre-gate every
    // admin repo action uses (404 for foreign repos — anti-enumeration).
    await repositoryService.getById(repoId, { authz: opts.authz });
    const fm = await frontmatterService.readFrontmatterFromRepoDoc(repoId);
    if (!fm) {
      const err = new Error('repo has no stored frontmatter — save tags before rebuilding the head');
      err.code = 'NO_FRONTMATTER';
      err.status = 409;
      throw err;
    }
    const head = await frontmatterService.buildVectorizedHead(repoId, fm, {
      actor: opts.actor,
      version: opts.version
    });
    logger.info('head-test.rebuilt', { repo_id: repoId, dim: head.dim });
    return head;
  });
}

// ---------- public: routing test ----------

function normalizeFormula(raw) {
  if (raw === undefined || raw === null || raw === 'default') return 'default';
  if (raw === 'uniform') return 'uniform';
  if (raw && typeof raw === 'object') {
    const out = {};
    for (const f of POSITIVE_FIELDS.concat(['forbidden'])) {
      if (typeof raw[f] === 'number' && raw[f] >= 0) out[f] = raw[f];
    }
    return out;
  }
  const err = new Error(
    'formula must be "default", "uniform", or a {topic,entity,keyword,summary,scope,forbidden} weight object'
  );
  err.code = 'VALIDATION_ERROR';
  err.status = 400;
  throw err;
}

/**
 * POST /api/okf/repos/:id/routing-test — body:
 *   { query: string (required),
 *     formula?: 'default' | 'uniform' | {weights},
 *     include_probes?: boolean (default true),
 *     sibling_limit?: number (default 20) }
 */
async function routingTest(repoId, payload = {}, opts = {}) {
  return withSpan('okf.headtest.routing_test', async (span) => {
    span.setAttribute('okf.repo_id', repoId);
    const query = typeof payload.query === 'string' ? payload.query.trim() : '';
    if (!query) {
      const err = new Error('query is required');
      err.code = 'VALIDATION_ERROR';
      err.status = 400;
      throw err;
    }
    const formula = normalizeFormula(payload.formula);
    const includeProbes = payload.include_probes !== false;
    const siblingLimit = Math.max(
      1,
      Math.min(parseInt(payload.sibling_limit || SIBLING_LIMIT, 10) || SIBLING_LIMIT, 50)
    );

    // 1. The repo under test (authz pre-gate like every admin action).
    const underTest = await repositoryService.getById(repoId, { authz: opts.authz });
    // 2. Embed with production fidelity.
    const emb = await embedQuery(query);
    span.setAttribute('okf.headtest.query_chars', query.length);

    // 3. Head leg (LEG A) — under test + every sibling with a head.
    const db = await dbService.getConnection();
    const siblings = await loadSiblings(db, repoId);

    const headRows = [];
    const utHead = scoreHead(underTest.head, emb.vector, formula);
    headRows.push({ repo_id: repoId, name: underTest.name, ...utHead, is_under_test: true });
    for (const s of siblings) {
      // Score filled from the batch head lookup below.
      headRows.push({
        repo_id: s.repo_id,
        name: s.name,
        score: null,
        per_field: null,
        tag_cosines: [],
        is_under_test: false
      });
    }
    // One AQL for every sibling head (cheaper than N document reads).
    if (siblings.length) {
      const cursor = await db.query(
        'FOR r IN okf_repositories FILTER r._key IN @ids RETURN {_key: r._key, head: r.head}',
        { ids: siblings.map((s) => s.repo_id) }
      );
      const headsById = {};
      for (const row of await cursor.all()) headsById[row._key] = row.head;
      for (let i = 1; i < headRows.length; i += 1) {
        const sc = scoreHead(headsById[headRows[i].repo_id], emb.vector, formula);
        headRows[i].score = sc.score;
        headRows[i].per_field = sc.per_field;
        headRows[i].tag_cosines = sc.tag_cosines || [];
      }
    }
    // Rank the head leg (nulls sink).
    const ranked = headRows.filter((r) => r.score !== null && r.score !== undefined).sort((a, b) => b.score - a.score);
    ranked.forEach((r, i) => {
      r.head_rank = i + 1;
    });
    // Story 1-8a/1-8b — the forbidden contract, three conditions. A repo
    // CLAIMS the head leg only when ALL of:
    //   floor  — score ≥ ROUTE_HEAD_FLOOR (off-domain noise can never win;
    //            the margin rule alone is blind to fully-unrelated queries).
    //   veto   — NO forbidden tag individually matches the query at/above
    //            ROUTE_FORBIDDEN_TAG_MAX ("forbidden is forbidden — a hard
    //            contract; it should immediately score zero").
    //   margin — the score still clears the averaged forbidden centroid.
    // Degradation: a head without forbidden data (pre-1-8b rebuild has no
    // per-tag vectors) skips the veto but still applies floor+margin —
    // the gate never silently suppresses on missing data.
    for (const r of ranked) {
      const forb = r.per_field ? r.per_field.forbidden : null;
      r.forbidden_cosine = typeof forb === 'number' ? forb : null;
      r.head_margin = r.forbidden_cosine !== null ? r.score - r.forbidden_cosine : null;
      const tags = Array.isArray(r.tag_cosines) ? r.tag_cosines : [];
      const worst = tags.reduce((a, t) => (!a || t.cosine > a.cosine ? t : a), null);
      r.max_tag_cosine = worst ? worst.cosine : null;
      // Story 1-8d — the nearest forbidden tag is named ALWAYS (not only on
      // veto) so margin-killed positives carry their attribution into run
      // rows and the improvement advice.
      r.max_tag = worst ? worst.tag : null;
      r.tag_veto = worst && worst.cosine >= ROUTE_FORBIDDEN_TAG_MAX ? worst.tag : null;
      r.floor_pass = r.score >= ROUTE_HEAD_FLOOR;
      const marginPass = r.forbidden_cosine === null || r.head_margin > ROUTE_HEAD_MARGIN;
      r.head_claimed = r.floor_pass && !r.tag_veto && marginPass;
      r.head_claim = !r.floor_pass
        ? 'floor'
        : r.tag_veto
          ? 'veto'
          : !marginPass
            ? 'margin'
            : 'claim';
    }
    const topRanked = ranked.length ? ranked[0] : null;
    const headWinner = topRanked && topRanked.head_claimed ? topRanked : null;
    const utRow = headRows[0];
    const bestOther = ranked.find((r) => !r.is_under_test) || null;
    const margin = utRow.score !== null && bestOther ? utRow.score - bestOther.score : utRow.score !== null ? 1 : null;

    // 4. Probe replay (LEG B) — only repos with graphs.
    let probeOutcome = null;
    let currentWinner = null;
    const probeTargets = [];
    if (underTest.ingested_graph_name) probeTargets.push({ repo_id: repoId, graph: underTest.ingested_graph_name });
    if (includeProbes) {
      for (const s of siblings) {
        if (!s.graph_name) continue;
        probeTargets.push({ repo_id: s.repo_id, graph: s.graph_name });
      }
    } else if (probeTargets.length === 0) {
      // no probes requested and under test has no graph
    }
    if (includeProbes && probeTargets.length) {
      const probed = await Promise.all(
        probeTargets.map(async (t) => {
          const p = await probeGraph(db, t.graph, emb.vector, ROUTE_TOP_K);
          return { repo_id: t.repo_id, graph: t.graph, top_scores: p.top_scores, error: p.error };
        })
      );
      probeOutcome = qualifyProbes(probed);
      currentWinner =
        probeOutcome.degraded && probeOutcome.selected.length
          ? probeOutcome.selected[0]
          : probeOutcome.selected.length
            ? probeOutcome.selected[0]
            : null;
      if (probeOutcome.degraded) currentWinner = 'degraded';
    } else if (!underTest.ingested_graph_name) {
      currentWinner = 'no-graph-under-test';
    }

    // 5. Assemble siblings (top N by head score first — the spec's
    //    sibling bound; graph-less siblings still listed, probe:null).
    const sibDetail = siblings.slice(0, siblingLimit).map((s) => {
      const row = headRows.find((h) => h.repo_id === s.repo_id);
      const pr = probeOutcome ? probeOutcome.per_repo[s.repo_id] : null;
      return {
        repo_id: s.repo_id,
        name: s.name,
        lifecycle_state: s.lifecycle_state,
        serving: s.serving,
        has_graph: !!s.graph_name,
        head_score: row ? row.score : null,
        head_rank: row ? row.head_rank : null,
        // 1-8a gate telemetry per sibling.
        forbidden_cosine: row && row.forbidden_cosine !== undefined ? row.forbidden_cosine : null,
        head_margin: row && row.head_margin !== undefined ? row.head_margin : null,
        head_claimed: !!(row && row.head_claimed),
        probe: pr
          ? {
              probed: pr.probed,
              error: pr.error,
              chunks_in_top: pr.chunks_in_top,
              qualified: probeOutcome.qualified.includes(s.repo_id)
            }
          : s.graph_name && !includeProbes
            ? { probed: false, error: null, chunks_in_top: null, qualified: null }
            : null
      };
    });

    const result = {
      query,
      embedded_with: (emb.model || 'unknown') + (emb.prefixed ? ' + query-instruction' : ' (no prefix)'),
      formula: typeof formula === 'string' ? formula : 'custom',
      under_test: {
        repo_id: repoId,
        name: underTest.name,
        lifecycle_state: underTest.lifecycle_state,
        has_graph: !!underTest.ingested_graph_name,
        head: {
          present: !!(underTest.head && underTest.head.vector),
          stale: !!(
            underTest.frontmatter &&
            underTest.frontmatter.updated_at &&
            underTest.head &&
            underTest.head.computed_at &&
            underTest.frontmatter.updated_at > underTest.head.computed_at
          ),
          version: underTest.head ? underTest.head.version : null,
          computed_at: underTest.head ? underTest.head.computed_at : null
        },
        head_score: utRow.score,
        head_rank: utRow.head_rank || null,
        per_field: utRow.per_field,
        // Story 1-8a/1-8b gate telemetry: does this head CLAIM the query,
        // and which condition decided (floor | veto | margin | claim).
        forbidden_cosine: utRow.forbidden_cosine !== undefined ? utRow.forbidden_cosine : null,
        head_margin: utRow.head_margin !== undefined ? utRow.head_margin : null,
        tag_veto: utRow.tag_veto || null,
        max_tag_cosine: utRow.max_tag_cosine !== undefined ? utRow.max_tag_cosine : null,
        floor_pass: !!utRow.floor_pass,
        head_claim: utRow.head_claim || null,
        head_claimed: !!utRow.head_claimed,
        probe: probeOutcome ? probeOutcome.per_repo[repoId] || null : null
      },
      siblings: sibDetail,
      verdict: {
        head_routing_winner: headWinner ? headWinner.repo_id : null,
        // Gated claim (1-8a): the top scorer must ALSO clear its forbidden
        // margin — a suppressed top scorer yields winner=null.
        under_test_wins_head: !!(headWinner && headWinner.is_under_test),
        head_suppressed: !!topRanked && !topRanked.head_claimed,
        current_routing_winner: currentWinner,
        under_test_wins_current: !!(probeOutcome && probeOutcome.selected.includes(repoId)),
        margin,
        provenance: probeOutcome
          ? probeOutcome.degraded
            ? 'degraded'
            : probeOutcome.floor
              ? 'floor'
              : 'qualified'
          : topRanked && !topRanked.head_claimed
            ? topRanked.head_claim === 'floor'
              ? 'head-suppressed (off-domain)'
              : topRanked.head_claim === 'veto'
                ? `head-suppressed (forbidden: ${topRanked.tag_veto})`
                : 'head-suppressed (forbidden/noise)'
            : 'head-only (no graph under test)'
      },
      fidelity: {
        algorithm: 'story-1.3-replay+v2',
        knobs: {
          ROUTE_TOP_K,
          ROUTE_MIN_CHUNKS,
          ROUTE_PROBE_TIMEOUT_MS,
          ROUTE_RETRY,
          ROUTE_HEAD_MARGIN,
          ROUTE_HEAD_FLOOR,
          ROUTE_FORBIDDEN_TAG_MAX
        }
      }
    };
    span.setAttribute('okf.headtest.head_winner', result.verdict.head_routing_winner || '');
    logger.info('head-test.routing_test.done', {
      repo_id: repoId,
      head_winner: result.verdict.head_routing_winner,
      head_rank_under_test: result.under_test.head_rank,
      current_winner: String(currentWinner)
    });
    return result;
  });
}

/**
 * Story 1-8c — explain ONE query's gate outcome and, when it wrongly
 * CLAIMS, suggest forbidden tags that would exclude it. The teaching half
 * of the Lab loop: fail -> advice -> edit tags -> rebuild -> retest.
 * Reuses routingTest for the full verdict, then adds the suggestion.
 */
async function explainRouting(repoId, payload = {}, opts = {}) {
  const query = typeof payload.query === 'string' ? payload.query.trim() : '';
  if (!query) {
    const err = new Error('query is required');
    err.code = 'VALIDATION_ERROR';
    err.status = 400;
    throw err;
  }
  const result = await routingTest(repoId, { query, include_probes: false, formula: payload.formula }, opts);
  const ut = result.under_test || {};
  let suggestion = { tags: [], source: 'none', reason: '' };
  if (ut.head_claimed) {
    // It claims — the interesting case. LLM proposes 1-3 kebab-case
    // forbidden tags excluding this query's subject WITHOUT excluding the
    // declared scope. Deterministic empty fallback: the UI still teaches
    // ("no forbidden tag covers this subject — consider adding one").
    let fm = null;
    try {
      fm = await frontmatterService.readFrontmatterFromRepoDoc(repoId);
    } catch (e) {
      logger.warn('head-test.explain.fm_read_failed', { repo_id: repoId, error: e.message });
    }
    if (fm) {
      try {
        const prompt = `A retrieval repository must NOT route the query below, but its vectorized
head currently claims it (score ${ut.head_score != null ? ut.head_score.toFixed(3) : 'n/a'},
max forbidden-tag similarity ${ut.max_tag_cosine != null ? ut.max_tag_cosine.toFixed(3) : 'n/a'}).

REPOSITORY scope — topics: ${(fm.topic || []).join(', ')}; entities: ${(fm.entity || []).join(', ')};
already forbidden: ${(fm.forbidden || []).join(', ') || '(none)'}; summary: ${fm.summary || ''}

QUERY: ${query}

Propose 1-3 NEW forbidden tags (lowercase kebab-case, each 1-3 words) that
capture what this query is about and that the repository's scope genuinely
EXCLUDES. They must not overlap the already-forbidden list and must not
exclude the repository's own topics/entities. Respond with ONLY a JSON
object: {"tags": ["...", "..."]}`;
        const resp = await frontmatterService.vllmChatCompletions([{ role: 'user', content: prompt }], {
          maxTokens: 200,
          temperature: 0.2
        });
        const content = resp.data && resp.data.choices && resp.data.choices[0] && resp.data.choices[0].message;
        const parsed = (() => {
          const m = content && content.content && content.content.match(/\{[\s\S]*\}/);
          if (!m) return null;
          try {
            return JSON.parse(m[0]);
          } catch {
            return null;
          }
        })();
        const tags = (parsed && Array.isArray(parsed.tags) ? parsed.tags : [])
          .filter((t) => typeof t === 'string' && t.trim())
          .map((t) => t.trim().toLowerCase().replace(/\s+/g, '-'))
          .filter((t) => !(fm.forbidden || []).includes(t))
          .slice(0, 3);
        // Story 1-8d — mechanical guardrail before anything reaches the UI.
        const guard = await guardSuggestions(repoId, tags, opts);
        suggestion = guard.accepted.length
          ? { tags: guard.accepted, rejected: guard.rejected, source: 'llm', reason: 'suggested forbidden tags for this query\'s subject (guardrail-screened)' }
          : {
              tags: [],
              rejected: guard.rejected,
              source: guard.rejected.length ? 'guardrail' : 'none',
              reason: guard.rejected.length
                ? 'every proposal was screened out by the guardrail — the query matches the declared scope'
                : 'the model proposed no non-overlapping tags — review the query against the declared scope manually'
            };
      } catch (e) {
        logger.warn('head-test.explain.llm_failed', { repo_id: repoId, error: e.message });
        suggestion = {
          tags: [],
          rejected: [],
          source: 'none',
          reason: 'the suggestion model is unreachable — no forbidden tag matches this query; consider adding one for its subject'
        };
      }
    }
  }
  return { ...result, suggestion };
}

// Story 1-8d — the MECHANICAL suggestion guardrail. A proposed forbidden
// tag must not match the repository's own subject: cosine vs ANY topic/
// entity/keyword vector at/above GUARD_SELF_SUBJECT rejects it. This exists
// because prompt-only constraints failed in production: the 3-cycle
// poisoning (2026-10-09) applied 'lung-cancer' — the repo's OWN entity tag
// — and positives collapsed 7/8 -> 2/8. Near-duplicates of already-forbidden
// tags are rejected too (nothing new to learn).
const GUARD_SELF_SUBJECT = parseFloat(process.env.OKF_GUARD_SELF_SUBJECT || '0.55');
const GUARD_DUPLICATE_FORBIDDEN = parseFloat(process.env.OKF_GUARD_DUPLICATE_FORBIDDEN || '0.9');

/**
 * Screen candidate forbidden tags against the repo's own head vectors AND,
 * when positive test queries are supplied, against the vetoes they would
 * cause. The impact simulation is the decisive guard: a candidate that
 * would suppress even ONE gold positive test is rejected regardless of how
 * sensible its embedding looks ("cardiovascular-pharmacology" vetoes half
 * a clinical corpus at the 0.55 bar). Returns
 * {accepted: [tag], rejected: [{tag, reason}]} — accepted entries are
 * still suggestions; the curator confirms via the chip flow.
 */
async function guardSuggestions(repoId, candidates, opts = {}) {
  const list = (Array.isArray(candidates) ? candidates : []).filter((t) => typeof t === 'string' && t.trim());
  if (!list.length) return { accepted: [], rejected: [] };
  const repositoryService = require('./repository-service');
  const repo = await repositoryService.getById(repoId, { authz: opts.authz });
  const head = repo && repo.head;
  const ownVectors = [];
  if (head && head.per_field) {
    for (const f of POSITIVE_FIELDS) {
      if (Array.isArray(head.per_field[f])) ownVectors.push(head.per_field[f]);
    }
  }
  const existingForbidden =
    head && head.per_field && Array.isArray(head.per_field.forbidden_vectors) ? head.per_field.forbidden_vectors : [];
  const positiveQueries = Array.isArray(opts.positiveQueries) ? opts.positiveQueries.filter(Boolean) : [];
  const positiveVectors = positiveQueries.length ? await frontmatterService.teiEmbed(positiveQueries.map((q) => q.query || q)) : [];
  const vecs = await frontmatterService.teiEmbed(list);
  const accepted = [];
  const rejected = [];
  list.forEach((tag, i) => {
    const v = vecs && vecs[i];
    if (!Array.isArray(v)) {
      rejected.push({ tag, reason: 'embedding failed — cannot verify against the repository scope' });
      return;
    }
    let worst = null;
    for (const ov of ownVectors) {
      const c = cosine(v, ov);
      if (c !== null && (!worst || c > worst.cosine)) worst = { cosine: c };
    }
    if (worst && worst.cosine >= GUARD_SELF_SUBJECT) {
      rejected.push({
        tag,
        reason: `too close to the repository's own subject (similarity ${worst.cosine.toFixed(2)} >= ${GUARD_SELF_SUBJECT})`
      });
      return;
    }
    // Veto-impact simulation — the 2026-10-09 poisoning guard.
    if (positiveVectors.length) {
      const killed = [];
      positiveVectors.forEach((qv, qi) => {
        const c = cosine(v, qv);
        if (c !== null && c >= ROUTE_FORBIDDEN_TAG_MAX) killed.push(positiveQueries[qi].query || positiveQueries[qi]);
      });
      if (killed.length) {
        rejected.push({
          tag,
          reason: `would suppress ${killed.length} positive test${killed.length > 1 ? 's' : ''} (e.g. "${String(killed[0]).slice(0, 60)}")`
        });
        return;
      }
    }
    let dup = null;
    for (const fv of existingForbidden) {
      const c = fv && Array.isArray(fv.vector) ? cosine(v, fv.vector) : null;
      if (c !== null && (dup === null || c > dup)) dup = c;
    }
    if (dup !== null && dup >= GUARD_DUPLICATE_FORBIDDEN) {
      rejected.push({ tag, reason: 'already covered by an existing forbidden tag' });
      return;
    }
    accepted.push(tag);
  });
  return { accepted, rejected };
}

module.exports = {
  rebuildHead,
  routingTest,
  explainRouting,
  guardSuggestions,
  // test surface
  _internals: {
    cosine,
    scoreHead,
    qualifyProbes,
    queryInstructionFor,
    normalizeFormula,
    POSITIVE_FIELDS,
    DEFAULT_WEIGHTS,
    GUARD_SELF_SUBJECT,
    GUARD_DUPLICATE_FORBIDDEN
  }
};
