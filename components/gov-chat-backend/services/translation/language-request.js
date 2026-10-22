/**
 * The language the caller asked for, in one canonical form.
 *
 * The language travels in the request body, so it is caller-controlled. Two
 * callers read the same field — the query service (which forwards it to
 * OPEA) and the query routes (which translate the answer into it) — and each
 * used to normalize it its own way: one kept the case, the other lower-cased
 * it. The same request then carried two different spellings of one language,
 * and only one of them matched the language maps.
 *
 * This module is the single place that decides what a requested language
 * looks like. The canonical form is the one the language maps are keyed in:
 * lower case, trimmed.
 */

/**
 * Normalizes a caller-supplied language.
 *
 * @param {*} value - The language as it arrived from the caller.
 * @returns {string} The canonical (trimmed, lower-case) language code, or ''
 *   when no language was asked for. A value that is not a string is not a
 *   language: it normalizes to '' like an absent one.
 */
function normalizeRequestedLanguage(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

module.exports = { normalizeRequestedLanguage };
