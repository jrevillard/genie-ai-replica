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

// The longest a requested language may be. A language code the maps carry is
// a few characters long; the bound keeps a caller from making the service
// work on a megabyte of text that only ever fails the lookup.
const MAX_LANGUAGE_LENGTH = 32;

/**
 * Normalizes a caller-supplied language.
 *
 * The value is trimmed, then cut to a bounded length, then lower-cased: the
 * language travels in the request body, and a body may be large, so the
 * normalization itself has to cost a bounded amount. The trim comes first so
 * that a language the caller padded with spaces still names itself — a
 * language cut before it is trimmed is a language that disappears, and the
 * request is then answered in English without ever being refused.
 *
 * @param {*} value - The language as it arrived from the caller.
 * @returns {string} The canonical (trimmed, lower-case) language code, or ''
 *   when no language was asked for. A value that is not a string is not a
 *   language: it normalizes to '' like an absent one.
 */
function normalizeRequestedLanguage(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, MAX_LANGUAGE_LENGTH).toLowerCase();
}

module.exports = { normalizeRequestedLanguage };
