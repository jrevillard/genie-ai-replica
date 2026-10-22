/**
 * The lookups a language map answers.
 *
 * Both backends ship a map of the same shape — the languages and the code
 * the model is asked for — and they answer the same questions
 * about it. The rules that keep a caller-supplied value from being handed
 * out as a language live here, so the two backends cannot answer them
 * differently:
 *
 * - an inherited key ('constructor', 'toString') is not a language: it is
 *   looked up as an own property only;
 * - a language mapped to an empty code is not a code the model can be asked
 *   for: the empty code would reach the model as an empty string. The map
 *   carries the language, so this one is a defect in the shipped map rather
 *   than a language the caller may not ask for.
 *
 * The lookups answer with null or false rather than throwing, so each
 * backend keeps its own wording in the log line it writes — and so each
 * backend decides what an empty mapping means.
 */

/**
 * The code the model is asked for, for a canonical language.
 *
 * @param {object|null} languageMap - The shipped language map.
 * @param {string} isoCode - The canonical language code.
 * @returns {string|null} The model-specific code, or null when the map does
 *   not map the language.
 */
function ownLanguageCode(languageMap, isoCode) {
  const codes = languageMap ? languageMap.languageMap : null;
  if (!codes || !Object.prototype.hasOwnProperty.call(codes, isoCode)) {
    return null;
  }
  return codes[isoCode] || null;
}

/**
 * Whether the map carries the language at all.
 *
 * The answer separates the two ways a language can be missing from the map:
 * a language the map does not carry is a language the caller asked for that
 * the model cannot be asked for, while a language the map carries but maps to
 * an empty code is a defect in the shipped map. They are not the same
 * failure, and they are not the same fault.
 *
 * @param {object|null} languageMap - The shipped language map.
 * @param {string} isoCode - The canonical language code.
 * @returns {boolean} True when the map carries the language.
 */
function hasOwnLanguage(languageMap, isoCode) {
  const codes = languageMap ? languageMap.languageMap : null;
  return Boolean(codes) && Object.prototype.hasOwnProperty.call(codes, isoCode);
}

/**
 * The languages the map supports.
 *
 * A copy: the map is the backend's own table, and a caller that mutates the
 * returned object would change which languages the backend accepts.
 *
 * @param {object|null} languageMap - The shipped language map.
 * @returns {object} A copy of the language table.
 */
function supportedLanguages(languageMap) {
  const codes = languageMap ? languageMap.languageMap : null;
  return codes ? { ...codes } : {};
}

module.exports = {
  ownLanguageCode,
  hasOwnLanguage,
  supportedLanguages
};
