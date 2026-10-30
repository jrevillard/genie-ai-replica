// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
//
// ragas-attribution-service — Story 8-6 (2026-10-23): the EVIDENCE layer
// behind the RAGAS failure attribution.
//
// The attribution matrix used to answer "where was the expected passage
// lost?" from data that could not answer it:
//
//   * the run stored 24 candidate KEYS but only 8 candidate TEXTS, each
//     truncated to 200 chars;
//   * the matrix matched the reference passage against those 8 truncated
//     texts with an 80-char prefix test.
//
// Both discards bias the same way — toward "not found" — so a passage the
// vector stage HAD surfaced (rank 9..24) was reported as "the expected
// passage is not retrievable", and the advisor told the curator to write
// content that was already indexed. Measured on the live El Salvador run
// (rr1792684450748-f9b8b1): 18 of 29 failures were attributed to a corpus
// gap that did not exist — every one of those passages was in the corpus.
//
// This service supplies the missing facts, and nothing else:
//
//   1. WHERE is the expected passage? (corpus / candidate pool / selected
//      contexts) — proven, not inferred.
//   2. HOW MUCH of it is there? (coverage fraction per tier)
//   3. WHERE would it have ranked? (the candidate-rank probe: the vector
//      rank of the carrier chunk, so "the dense stage missed it" becomes
//      "raise OKF_RAGAS_CANDIDATE_K from 24 to 32")
//
// Method, and why each part is there (all of it measured, 2026-10-23):
//
//   * CONTAINMENT probe (needle = 8 consecutive words of the passage, at
//     stride 4) finds candidate chunks cheaply in one AQL scan. 8 words is
//     deliberate: a 12-word needle straddles chunk boundaries and reports
//     FALSE ABSENCES — 17 of 29 passages looked absent at 12 words and
//     every one of them was present at 8.
//   * COVERAGE filter (token overlap >= 0.85 between the passage and the
//     chunk) keeps only chunks that really carry the passage. Containment
//     alone is too loose: one generic chunk matched 11 unrelated rows.
//     The 0.85 threshold sits in an empty band — true carriers score
//     96-100%, generic matches 40-65% — and the ladder is stable across
//     0.75-0.90. Validated against a non-circular ground truth (the
//     passage's rarest corpus tokens identify one chunk): 30/30.
//   * The carrier is looked up by KEY against the run's candidate_keys
//     (24) and context_keys (3), so "was it a candidate?" and "was it
//     selected?" are set membership — exact, not text matching.
//
// The corpus tier is the one that must never be wrong in the expensive
// direction: it is the verdict that sends a curator to write content. A
// passage with no carrier after the containment+coverage probe is reported
// as `corpus` ONLY with the probe method recorded alongside it, and rows
// in that state are also counted as UNFAIR QUESTIONS (see
// `collectEvidence`) — because a benchmark row whose expected passage is
// not in the corpus cannot be answered by the system it is measuring.
//
// Pure data, no judgement: this service returns FACTS. Turning facts into
// a stage and a recommendation is ragas-suite-service's matrix, which
// stays synchronous and side-effect free.

'use strict';

const frontmatterService = require('./frontmatter-service');
const { logger } = require('../shared-lib/logger');

// ---------- config ---------------------------------------------------------

// Words per containment needle. 8 is the measured sweet spot: long enough
// to be specific, short enough to survive a chunk boundary.
const PROBE_WINDOW_WORDS = 8;
// Words between needles. Denser than the passage (stride 4 over ~140-word
// passages) so a reformatted passage cannot hide between two needles.
const PROBE_STRIDE = 4;
// A chunk carries a passage only when it holds this much of it.
const COVERAGE_MIN = 0.85;
// Shortest passage that can be probed at all. Below this the passage is
// too short to identify a chunk, and the row is reported as UNPROVEN
// rather than as absent.
const MIN_NEEDLE_WORDS = 4;
// Guard on how many chunks one corpus scan may return. A needle that is
// generic enough to match hundreds of chunks is a signal the passage is
// boilerplate, not content — and it is reported, never silently dropped.
const MAX_PROBE_HITS = 600;
// Depth of the deep vector search used by the candidate-rank probe.
const RANK_PROBE_LIMIT = 2000;
// The rank probe re-embeds the query; if the embedding model changed since
// the run, the rank is approximate. The run's fidelity records the judge
// model but not an embedding model, so the caveat is carried in the
// recommendation text instead of being assumed away.
const RANK_PROBE_CAVEAT = 'ranked with the current embedding model — re-run the benchmark to confirm';

// Words that carry no retrieval signal. English: the corpus is Spanish, so
// these barely fire; they are here to drop English glue words that appear
// in the reference passages and in the document boilerplate.
const STOP = new Set(
  (
    'the a an of in on at to for and or is are was were be been being with from by as that this these those it its ' +
    'what which who whom how when where why do does did not no can could should would will shall may might must ' +
    'about into over under between during each any some all more most other such than then there here also very i ' +
    'you he she they we us our your their his her'
  )
    .split(' ')
    .filter(Boolean)
);

// ---------- text helpers ---------------------------------------------------

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function contentTokens(s) {
  return norm(s)
    .replace(/[^a-z0-9áéíóúñü ]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 2 && !STOP.has(w));
}

function tokenSet(s) {
  return new Set(contentTokens(s));
}

/** Fraction of a's tokens that appear in b. */
function coverage(a, b) {
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const t of a) if (b.has(t)) hit += 1;
  return hit / a.size;
}

/**
 * Containment needles for a passage: every PROBE_WINDOW_WORDS-word window,
 * stepping PROBE_STRIDE words.
 *
 * A passage SHORTER than the window gets the whole passage as one needle.
 * Without that, a short passage would produce no needle at all and would be
 * reported as absent from the corpus — a false ABSENCE, which is the one
 * verdict that must never be wrong in the expensive direction. The
 * specificity check downstream still has to pass, so a whole-passage needle
 * cannot match loosely.
 */
function needlesFor(passage) {
  const words = norm(passage).split(' ').filter(Boolean);
  const out = [];
  if (words.length < MIN_NEEDLE_WORDS) return out;
  if (words.length < PROBE_WINDOW_WORDS) {
    out.push(words.join(' '));
    return out;
  }
  for (let off = 0; off + PROBE_WINDOW_WORDS <= words.length; off += PROBE_STRIDE) {
    out.push(words.slice(off, off + PROBE_WINDOW_WORDS).join(' '));
  }
  return out;
}

// ---------- corpus probe ---------------------------------------------------

/**
 * Find, for every passage, the corpus chunks that CARRY it.
 *
 * One AQL scan per graph returns the chunks matching any needle, tagged
 * with the passage ids whose needles they matched. Coverage is applied
 * afterwards in JS (the token sets are needed for it).
 *
 * A passage may SPAN chunks — the reference passages are document-level
 * excerpts, not chunk-aligned. So coverage is measured over the UNION of
 * the chunks that carry parts of it, not over any single chunk: a
 * passage split across two chunks has no chunk with high coverage on its
 * own, and judging it per-chunk would report a false ABSENCE — the exact
 * failure this service exists to remove.
 *
 * @returns {{ byPassage: Map<string, Array<{key: string, coverage: number, tokens: Set}>>,
 *            truncated: boolean, matched: number }}
 */
async function probeCorpus(db, graphs, passages) {
  const byPassage = new Map();
  const index = new Map(); // passage id -> needles
  for (const p of passages) {
    const needles = needlesFor(p.text);
    // A passage with no needle is UNPROVEN, not absent. It is recorded
    // as an empty carrier set, and the caller must not read that as a
    // corpus gap.
    byPassage.set(p.id, []);
    if (!needles.length) continue;
    index.set(p.id, needles);
  }
  if (!index.size) return { byPassage, truncated: false, matched: 0 };

  // The needles are flattened into one bind parameter: one collection scan
  // per graph, not one per passage.
  const flat = [];
  for (const [pid, needles] of index) {
    for (const needle of needles) flat.push({ pid, needle });
  }
  if (!flat.length) return { byPassage, truncated: false, matched: 0 };

  const byId = new Map(passages.map((p) => [p.id, p]));
  let truncated = false;
  let matched = 0;
  for (const graph of graphs) {
    let rows;
    try {
      rows = await (
        await db.query(
          `FOR c IN \`${graph}_SOURCE\` ` +
            'LET lc = LOWER(c.text) ' +
            'LET hits = (FOR x IN @probes FILTER CONTAINS(lc, x.needle) RETURN x.pid) ' +
            'FILTER LENGTH(hits) > 0 ' +
            'LIMIT @max ' +
            'RETURN { key: c._key, text: c.text, hits: hits }',
          { probes: flat, max: MAX_PROBE_HITS }
        )
      ).all();
    } catch (e) {
      // A graph that cannot be read (missing collection, permissions) must
      // not sink the whole attribution — it degrades that graph's rows to
      // "not proven present", which the caller reports honestly.
      logger.warn('ragas attribution: corpus probe failed', {
        graph,
        error: String(e && e.message).slice(0, 200)
      });
      continue;
    }
    matched += rows.length;
    for (const row of rows) {
      const chunkTokens = tokenSet(row.text);
      for (const pid of row.hits) {
        const passage = byId.get(pid);
        if (!passage) continue;
        const cov = coverage(passage.tokens, chunkTokens);
        const list = byPassage.get(pid);
        list.push({ key: row.key, coverage: cov, tokens: chunkTokens });
      }
    }
    if (rows.length >= MAX_PROBE_HITS) truncated = true;
  }
  for (const list of byPassage.values()) list.sort((a, b) => b.coverage - a.coverage);
  return { byPassage, truncated, matched };
}

/**
 * The chunks that together carry a passage, and how much of it they carry.
 *
 * The chunks are taken greedily from the best-covering one down, and the
 * union of their tokens is what counts: a passage is present when the
 * chunks that hold parts of it jointly cover enough of it. The chunks in
 * that set are the CARRIERS — the ones whose retrieval decides whether the
 * passage reaches the answer.
 */
function carriersFor(passage, matches) {
  if (!matches.length) return { present: false, coverage: 0, carriers: [] };
  const covered = new Set();
  const carriers = [];
  for (const m of matches) {
    for (const t of m.tokens) covered.add(t);
    carriers.push({ key: m.key, coverage: coverage(passage.tokens, covered) });
    // Stop once the union covers enough — the later chunks add nothing.
    if (carriers[carriers.length - 1].coverage >= COVERAGE_MIN) break;
  }
  const cov = coverage(passage.tokens, covered);
  return { present: cov >= COVERAGE_MIN, coverage: cov, carriers };
}

// ---------- evidence collection -------------------------------------------

/**
 * Collect, for every failing row, WHERE the expected passage went.
 *
 * Facts returned per row:
 *   passages      - how many reference passages the entry has
 *   carriers      - corpus chunks carrying each passage
 *   corpus_hits   - passages with a carrier somewhere in the corpus
 *   candidate_hits- passages whose carrier was in the run's candidate pool
 *   context_hits  - passages whose carrier was in the selected contexts
 *   candidate_keys/ context_keys - the run's own key sets (for the caller)
 *   truncated     - the corpus scan hit its guard (reported, never hidden)
 *
 * @param {object} db
 * @param {object} params
 * @param {Array}  params.rows     failing rows: { id, query, passages: string[] }
 * @param {string[]} params.graphs  graphs the run retrieved from
 */
async function collectEvidence(db, { rows, graphs }) {
  const passages = [];
  for (const row of rows) {
    for (const text of row.passages || []) {
      const normText = norm(text);
      if (!normText) continue;
      passages.push({
        id: `${row.id}#${passages.length}`,
        rowId: row.id,
        text: normText,
        tokens: tokenSet(normText)
      });
    }
  }

  const probe = await probeCorpus(db, graphs || [], passages);
  const byPassage = probe.byPassage;

  const byRow = new Map();
  for (const row of rows) {
    const own = passages.filter((p) => p.rowId === row.id);
    const carriers = [];
    let probeable = 0;
    for (const p of own) {
      const needles = needlesFor(p.text);
      const res = carriersFor(p, byPassage.get(p.id) || []);
      if (needles.length) probeable += 1;
      carriers.push({
        passage_id: p.id,
        // Only a passage whose chunks jointly cover enough of it counts as
        // present. A passage that matches a needle but whose content is
        // otherwise absent is NOT present — that is the false-positive the
        // coverage union is there to prevent.
        present: res.present,
        probeable: needles.length > 0,
        coverage: res.coverage,
        chunks: res.carriers.map((c) => ({ key: c.key, coverage: c.coverage }))
      });
    }
    byRow.set(row.id, {
      passages: own.length,
      // How many passages the probe could actually judge. A row with no
      // probeable passage is UNPROVEN — never "proven absent".
      probeable_passages: probeable,
      carriers,
      corpus_hits: carriers.filter((c) => c.present).length,
      truncated: probe.truncated,
      matched_chunks: probe.matched
    });
  }

  return {
    byRow,
    truncated: probe.truncated,
    matched_chunks: probe.matched,
    method: `containment(${PROBE_WINDOW_WORDS}-word needles, stride ${PROBE_STRIDE}) + token coverage >= ${COVERAGE_MIN}`
  };
}

// ---------- candidate-rank probe ------------------------------------------

/**
 * Where would the carrier chunk have ranked for this query?
 *
 * This is what turns "the dense stage missed it" into an instruction. The
 * run retrieved the top CANDIDATE_K (24) chunks per graph; the probe
 * re-embeds the query and searches deeper, so the carrier's rank is
 * visible. Measured on the live run: four carriers sat at ranks 26, 27,
 * 28 and 65 — three of them one step outside the candidate pool.
 *
 * Best-effort: if the embedding service or the search fails, the stage
 * still stands and only the rank is missing.
 */
async function probeCandidateRank(db, { graphs, query, carrierKey }) {
  if (!query || !carrierKey || !graphs || !graphs.length) return null;
  let emb;
  try {
    const embeddings = await frontmatterService.teiEmbed([query]);
    emb = Array.isArray(embeddings) ? embeddings[0] : null;
  } catch (e) {
    logger.warn('ragas attribution: rank probe embedding failed', {
      error: String(e && e.message).slice(0, 200)
    });
    return null;
  }
  if (!emb) return null;

  for (const graph of graphs) {
    try {
      const rows = await (
        await db.query(
          `FOR c IN \`${graph}_SOURCE\` ` +
            'LET s = APPROX_NEAR_COSINE(c.embedding, @emb) ' +
            'SORT s DESC LIMIT @lim ' +
            'RETURN { key: c._key, score: s }',
          { emb, lim: RANK_PROBE_LIMIT }
        )
      ).all();
      const pos = rows.findIndex((r) => r.key === carrierKey);
      if (pos >= 0) {
        return { rank: pos + 1, searched: rows.length, graph, score: rows[pos].score, caveat: RANK_PROBE_CAVEAT };
      }
    } catch (e) {
      logger.warn('ragas attribution: rank probe search failed', {
        graph,
        error: String(e && e.message).slice(0, 200)
      });
    }
  }
  return null;
}

module.exports = {
  COVERAGE_MIN,
  PROBE_STRIDE,
  PROBE_WINDOW_WORDS,
  RANK_PROBE_CAVEAT,
  collectEvidence,
  coverage,
  needlesFor,
  norm,
  probeCandidateRank,
  tokenSet
};
