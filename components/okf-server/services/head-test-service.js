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
  if (!head || !Array.isArray(head.vector)) return { score: null, per_field: null };
  const perFieldCos = {};
  for (const f of POSITIVE_FIELDS.concat(['forbidden'])) {
    const v = head.per_field && head.per_field[f];
    perFieldCos[f] = Array.isArray(v) ? cosine(queryVec, v) : null;
  }
  if (formula === 'default' || formula === undefined || formula === null) {
    return {
      score: cosine(queryVec, head.vector),
      per_field: perFieldCos,
      formula_used: 'default(stored-vector)'
    };
  }
  // Recompute formulas need per_field vectors.
  const hasAny = POSITIVE_FIELDS.some((f) => perFieldCos[f] !== null);
  if (!hasAny) return { score: null, per_field: perFieldCos, formula_used: String(formula) };
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
  if (totalW === 0) return { score: null, per_field: perFieldCos, formula_used: String(formula) };
  let score = acc / totalW;
  const wf = typeof weights.forbidden === 'number' ? weights.forbidden : 0;
  if (wf > 0 && perFieldCos.forbidden !== null) {
    // Penalty: subtract when the query is CLOSE to what the repo
    // declares it is NOT about (clamped at 0 so an anti-aligned query
    // never earns a bonus).
    score -= wf * Math.max(0, perFieldCos.forbidden);
  }
  return { score, per_field: perFieldCos, formula_used: String(formula) };
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
      }
    }
    // Rank the head leg (nulls sink).
    const ranked = headRows.filter((r) => r.score !== null && r.score !== undefined).sort((a, b) => b.score - a.score);
    ranked.forEach((r, i) => {
      r.head_rank = i + 1;
    });
    const headWinner = ranked.length ? ranked[0] : null;
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
        probe: probeOutcome ? probeOutcome.per_repo[repoId] || null : null
      },
      siblings: sibDetail,
      verdict: {
        head_routing_winner: headWinner ? headWinner.repo_id : null,
        under_test_wins_head: !!(headWinner && headWinner.is_under_test),
        current_routing_winner: currentWinner,
        under_test_wins_current: !!(probeOutcome && probeOutcome.selected.includes(repoId)),
        margin,
        provenance: probeOutcome
          ? probeOutcome.degraded
            ? 'degraded'
            : probeOutcome.floor
              ? 'floor'
              : 'qualified'
          : 'head-only (no graph under test)'
      },
      fidelity: {
        algorithm: 'story-1.3-replay+v1',
        knobs: { ROUTE_TOP_K, ROUTE_MIN_CHUNKS, ROUTE_PROBE_TIMEOUT_MS, ROUTE_RETRY }
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

module.exports = {
  rebuildHead,
  routingTest,
  // test surface
  _internals: {
    cosine,
    scoreHead,
    qualifyProbes,
    queryInstructionFor,
    normalizeFormula,
    POSITIVE_FIELDS,
    DEFAULT_WEIGHTS
  }
};
