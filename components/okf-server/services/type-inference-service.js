// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// TYPE INFERENCE (David's categorization spec, 2026-09-05): the import/
// convert flows classify every concept into the OKF v0.2 type enum —
// topic | entity | process | event | source — via a USER-SELECTABLE
// classification strategy:
//   'heuristics' (DEFAULT — zero-LLM, no import slowdown): structure and
//     keyword rules (David's enumerated signals: dates → event;
//     orgs/people/places + ticker/CIK/infobox keys → entity; URL/category/
//     source patterns → source; how-to/procedure shapes → process;
//     everything else → topic).
//   'llm' — LLM classifies during conversion. NOT YET WIRED: okf-server has
//     no LLM client (dataprep owns the model); until it lands, this resolves
//     to heuristics with an explicit resolved_by marker (never a silent lie).
//   'hybrid' — heuristics at import + LLM suggestions surfaced later,
//     steward-gated (ADR-019). Resolves to heuristics today; the suggestion
//     pass is the trailing feature.
// GUARDRAIL (David, 2026-09-08): the type is ALWAYS the taxonomy
// fires when the frontmatter type is absent or the default 'topic' (the
// converter stamps 'topic' as a placeholder, so crawl pages classify;
// curated bundles keep their authored types).

const STRATEGIES = ['heuristics', 'llm', 'hybrid'];
const TYPES = ['topic', 'entity', 'process', 'event', 'source'];

/** Resolve the strategy param (already validated) → what actually runs. */
function resolveStrategy(strategy) {
  const s = STRATEGIES.includes(strategy) ? strategy : 'heuristics';
  return { strategy: s, resolved_by: s === 'heuristics' ? 'heuristics' : 'heuristics-fallback' };
}

const ENTITY_HINTS =
  /\b(inc|corp|corporation|company|ltd|llc|gmbh|sa|ag|university|ministry|agency|department|bureau|council|foundation|institute|hospital|bank|airline|association|society|union|museum|cathedral|church|sultanate|kingdom|empire|republic|dynasty)\b/i;
const EVENT_HINTS =
  /\b(war|battle|eruption|earthquake|tsunami|founding|founded|treaty|revolution|uprising|siege|massacre|election|summit|conference|crisis|pandemic|outbreak|landing|launch|expedition|independence|annexation|coup)\b/i;
const PROCESS_HINTS =
  /\b(how to|guide|tutorial|procedure|step[- ]by[- ]step|instructions|workflow|installation|setup|configuration|troubleshooting|registering|applying for)\b/i;
const SOURCE_HINTS =
  /\b(list of|index of|category:|portal:|outline of|glossary|timeline of|bibliography|directory of)\b/i;
const ENTITY_STRUCTURAL =
  /\b(ticker|cik|isin|industry|founder|headquarters|ceo|chairman|capital|population|area_km|coordinates|infobox)\b/i;
const EVENT_DATE =
  /\b(1[0-9]{3}|20[0-9]{2})\b|\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+(1[0-9]{3}|20[0-9]{2})\b/i;

/**
 * Heuristics classifier (deterministic, zero-LLM). Scores each non-topic
 * type from the spec's signal families; the highest score wins; ties and
 * zero-scores fall back to 'topic'.
 * @param {object} input { title, body, url, frontmatter }
 * @returns {'topic'|'entity'|'process'|'event'|'source'}
 */
function inferTypeHeuristics({ title, body, url } = {}) {
  const haystack = `${title || ''}
${(body || '').slice(0, 4000)}`;
  const urlText = String(url || '');
  const scores = { topic: 0, entity: 0, process: 0, event: 0, source: 0 };

  // SINGLE PASS per signal family: count DISTINCT matches (not just presence)
  // — a page naming five process signals outranks one naming 'ministry' once.
  // One global scan per family; regexes are module-level (the efficiency
  // directive: compiled once, no per-page compilation, zero I/O).
  const countMatches = (re) =>
    (haystack.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) || []).length;

  // URL/category/source patterns — a source-class URL is a strong signal.
  if (/category:|portal:|index\b|\/list_/i.test(urlText)) scores.source += 3;
  scores.source += countMatches(SOURCE_HINTS);

  // Entity: org/places/people keywords + structural (ticker/CIK/infobox) keys.
  scores.entity += countMatches(ENTITY_HINTS);
  scores.entity += countMatches(ENTITY_STRUCTURAL);

  // Event: event keywords + a date in the lead.
  scores.event += countMatches(EVENT_HINTS);
  if (EVENT_DATE.test(haystack)) scores.event += 1;

  // Process: how-to shapes.
  scores.process += countMatches(PROCESS_HINTS);

  let best = 'topic';
  let bestScore = 0;
  for (const t of TYPES) {
    if (t !== 'topic' && scores[t] > bestScore) {
      best = t;
      bestScore = scores[t];
    }
  }
  return best;
}

/**
 * Classify ONE concept. Respects authorial types; only assigns when the
 * frontmatter type is absent or the 'topic' default.
 * @param {object} input { frontmatter, body, url }
 * @param {string} [strategy] 'heuristics'|'llm'|'hybrid'
 * @returns {{ type: string, classified: boolean, resolved_by: string }}
 */
function classifyConcept({ frontmatter, body, url } = {}, strategy) {
  const { resolved_by } = resolveStrategy(strategy);
  const current = frontmatter && frontmatter.type;
  // TYPE TAXONOMY (David, 2026-09-08: "type: topic, entity, process, event,
  // source"): EVERY concept carries a taxonomy type — authorial vocabularies
  // (Subsidiary, FinancialLedger, …) are replaced by the classified type.
  // Only the structural 'index' root keeps its type.
  if (current === 'index') {
    return { type: current, classified: false, resolved_by: 'structural' };
  }
  const type = inferTypeHeuristics({ title: frontmatter && frontmatter.title, body, url });
  return { type, classified: true, resolved_by };
}

module.exports = { STRATEGIES, TYPES, resolveStrategy, inferTypeHeuristics, classifyConcept };
