// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
//
// concept-ceiling — the SINGLE authority on the maximum size of one concept
// document (the plan's §4: "compute it once … rather than letting each service
// derive independently — two derivations are two things to drift").
//
// Contextual Retrieval truncates a document's context to a budget derived from
// the serving model's window; a document larger than that budget has its deep
// chunks embedded against a description of its start. The ceiling is the same
// number, so "over the ceiling" and "will be truncated" are the same condition
// — which is why the remedy is to split rather than discover the truncation at
// query time.
//
// 250000 is sized for the default 65536-token window. MEASURED 2026-11-06 in
// the running container: the derived per-chunk document-context budget on that
// window is ~219 700 characters (254 prompt + 2106 batch + 8192 output tokens
// reserved), so a concept AT the ceiling has its document context truncated.
// The gap is tracked as #1588: the ceiling is a STATIC literal and the budget
// is DISCOVERED at runtime, so no config-validator check can keep them in
// step — only an operator can, by hand, against the window their endpoint
// actually serves.
//
// #1205 (2026-11-16, ruling: SELF-DISCOVERY) closes that gap: the ceiling is
// now DERIVED from the serving-model window the SAME endpoint dataprep reads
// (/v1/models, cached, stale-served), so the number is right on every
// deployment instead of right on one. The derivation lives in
// services/contextual-budget-mirror.js (dataprep's formula, mirrored and
// pinned by a config-validator check) and the window comes from
// services/llm-window.js (dataprep's discovery tiers, mirrored).
//
// THE LADDER (deliberately NOT dataprep's fail-closed guess):
//   1. operator pin   — OKF_MAX_CONCEPT_DOC_CHARS, uncapped (a deliberate
//                       operator statement is never overruled).
//   2. derived        — the window dataprep reads, minus dataprep's own
//                       reservations, in characters.
//   3. last-known     — the last derived value, kept across endpoint
//                       failures (stale beats broken: an endpoint blip must
//                       not silently widen the ceiling).
//   4. static default — 250000, with a loud warning.
//
// Why not dataprep's 2048-token guess: that guess is right for SIZING A
// REQUEST (a budget that fits nowhere fails visibly) and wrong for a WRITE
// CEILING — a guess-derived ceiling would refuse nearly every import during
// an endpoint blip, and on a small-window deployment it would refuse
// everything, always. The write ceiling fails conservative-but-usable.
//
// WHY THIS IS A SEPARATE MODULE (2026-11-06): the ceiling was read from
// `process.env` inside ingest-service, so the two OTHER paths that must
// enforce it — the editor save (repository-controller) and the publish gate
// (lifecycle-service) — had no way to reach the same number without importing
// the whole import service (and with it a cycle: ingest-service ⇄ concept-meta-
// service). One module, one reader, one number.

const { deriveCeiling } = require('./contextual-budget-mirror');
const llmWindow = require('./llm-window');
const { logger } = require('../shared-lib/logger');

/** Default ceiling when `OKF_MAX_CONCEPT_DOC_CHARS` is unset or unusable. */
const DEFAULT_MAX_CONCEPT_DOC_CHARS = 250000;

/** Where the effective ceiling came from — the refusal names it, so a
 * curator knows WHICH lever moves the number. */
const CEILING_SOURCES = {
  OPERATOR_PIN: 'operator-pin',
  DERIVED: 'discovered-from-window',
  LAST_KNOWN: 'last-known-derived',
  STATIC_DEFAULT: 'static-default'
};

/** The last derived ceiling — kept across endpoint failures so a blip does
 * not silently widen the gate (stale beats broken). */
let lastKnownDerived = null;

/** Read the operator's explicit pin, or null. */
function operatorPin() {
  const raw = process.env.OKF_MAX_CONCEPT_DOC_CHARS;
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const parsed = parseInt(String(raw).trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * The effective ceiling AND where it came from.
 *
 * Read at CALL time (not module load) so a test can move the ceiling
 * without reloading the module, and so a deployment that changes the
 * variable takes effect on the next read.
 *
 * @returns {{ceiling:number, source:string, window:number|null, derived:number|null}}
 */
function effectiveCeiling() {
  const pin = operatorPin();
  if (pin !== null) {
    return { ceiling: pin, source: CEILING_SOURCES.OPERATOR_PIN, window: null, derived: null };
  }

  const window = llmWindow.currentWindow();
  if (window.window) {
    const derived = deriveCeiling(window.window);
    if (derived.fits) {
      lastKnownDerived = derived.ceiling;
      return {
        ceiling: derived.ceiling,
        source: CEILING_SOURCES.DERIVED,
        window: window.window,
        derived: derived.ceiling
      };
    }
    // The window cannot hold the reservations: dataprep serves RAW chunks
    // there (no contextualization, no truncation), so there is no ceiling
    // to derive. The static default applies — with a warning, because a
    // deployment on a small window deserves to know its ceiling is a
    // fallback rather than a derivation.
    logger.warn('ceiling.window_too_small', {
      window_tokens: window.window,
      reserved_tokens: derived.terms.total,
      note: 'the serving-model window cannot hold the context reservations — dataprep serves raw chunks there (no truncation), so the static ceiling applies'
    });
  }

  if (lastKnownDerived) {
    return {
      ceiling: lastKnownDerived,
      source: CEILING_SOURCES.LAST_KNOWN,
      window: window.window,
      derived: lastKnownDerived
    };
  }

  return {
    ceiling: DEFAULT_MAX_CONCEPT_DOC_CHARS,
    source: CEILING_SOURCES.STATIC_DEFAULT,
    window: window.window,
    derived: null
  };
}

/**
 * Maximum characters in a single concept document.
 *
 * @returns {number} the effective ceiling in characters
 */
function maxConceptDocChars() {
  return effectiveCeiling().ceiling;
}

/**
 * The refusal every ceiling-enforcing path shares.
 *
 * One class, one code, one message shape — the import path, the editor save
 * and the publish gate all answer the SAME question ("this document is over
 * the limit") with the SAME answer, so a curator who hits it in one surface
 * recognises it in the others. The remedy is always named: shorten the source,
 * split it, or raise the ceiling if the served model's window allows it.
 *
 * `status` is 409 (Conflict) rather than 413: the request is well-formed, it
 * conflicts with the current state of the resource — and 409 is the house code
 * for a write refused because of the state it targets (the publish gate's
 * frontmatter gate uses it for the same reason).
 */
class ConceptTooLargeError extends Error {
  /**
   * @param {string} message the full refusal text (names the size, the ceiling, the remedy)
   * @param {{concept_id?: string, chars?: number, ceiling?: number, ceiling_source?: string}} details structured facts
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'ConceptTooLargeError';
    this.code = 'CONCEPT_TOO_LARGE';
    this.status = 409;
    this.details = details;
  }
}

/**
 * Build the refusal for one over-ceiling document.
 *
 * @param {{label: string, chars: number, ceiling: number, remedy?: string, ceiling_source?: string}} params
 * @returns {ConceptTooLargeError}
 */
function conceptTooLargeError({ label, chars, ceiling, remedy, ceiling_source }) {
  const how = `${chars} characters, over the ${ceiling}-character ceiling`;
  const fix =
    remedy ||
    'Shorten the source, split it into smaller concepts, or raise OKF_MAX_CONCEPT_DOC_CHARS ' +
      "if the served model's context window allows a larger document.";
  // The SOURCE rides the refusal (#1205): since the ceiling is now derived,
  // the number alone does not say which lever moves it — the operator pin,
  // the discovered window, or the static fallback. The caller may pass it
  // (a path that already knows); otherwise it is read from the same
  // effective ceiling the number came from — no network, no drift.
  const source = ceiling_source || effectiveCeiling().source;
  const details = { concept_id: label, chars, ceiling };
  if (source) details.ceiling_source = source;
  return new ConceptTooLargeError(`${label} is ${how} (${source}). ${fix}`, details);
}

module.exports = {
  CEILING_SOURCES,
  DEFAULT_MAX_CONCEPT_DOC_CHARS,
  effectiveCeiling,
  maxConceptDocChars,
  ConceptTooLargeError,
  conceptTooLargeError,
  operatorPin,
  _resetForTesting: () => {
    lastKnownDerived = null;
  }
};
