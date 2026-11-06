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
// 250000 reflects a 65536-token window (~4 chars/token minus the prompt, batch
// and output reservations). Override per deployment when the served model
// differs; okf-server and dataprep must agree, which config-validator checks
// (AC8).
//
// WHY THIS IS A SEPARATE MODULE (2026-11-06): the ceiling was read from
// `process.env` inside ingest-service, so the two OTHER paths that must
// enforce it — the editor save (repository-controller) and the publish gate
// (lifecycle-service) — had no way to reach the same number without importing
// the whole import service (and with it a cycle: ingest-service ⇄ concept-meta-
// service). One module, one reader, one number.

/** Default ceiling when `OKF_MAX_CONCEPT_DOC_CHARS` is unset or unusable. */
const DEFAULT_MAX_CONCEPT_DOC_CHARS = 250000;

/**
 * Maximum characters in a single concept document.
 *
 * Read from the environment at CALL time (not module load) so a test can move
 * the ceiling without reloading the module, and so a deployment that changes
 * the variable takes effect on the next read.
 *
 * @returns {number} the effective ceiling in characters
 */
function maxConceptDocChars() {
  const raw = process.env.OKF_MAX_CONCEPT_DOC_CHARS;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_CONCEPT_DOC_CHARS;
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
   * @param {{concept_id?: string, chars?: number, ceiling?: number}} details structured facts
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
 * @param {{label: string, chars: number, ceiling: number, remedy?: string}} params
 * @returns {ConceptTooLargeError}
 */
function conceptTooLargeError({ label, chars, ceiling, remedy }) {
  const how = `${chars} characters, over the ${ceiling}-character ceiling`;
  const fix =
    remedy ||
    'Shorten the source, split it into smaller concepts, or raise OKF_MAX_CONCEPT_DOC_CHARS ' +
      "if the served model's context window allows a larger document.";
  return new ConceptTooLargeError(`${label} is ${how}. ${fix}`, {
    concept_id: label,
    chars,
    ceiling
  });
}

module.exports = {
  DEFAULT_MAX_CONCEPT_DOC_CHARS,
  maxConceptDocChars,
  ConceptTooLargeError,
  conceptTooLargeError
};
