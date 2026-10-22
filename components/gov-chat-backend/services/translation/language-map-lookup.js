/**
 * The lookups a language map answers.
 *
 * Both backends ship a map of the same shape — the languages, the code the
 * model is asked for, the fallbacks — and they answer the same questions
 * about it. The rules that keep a caller-supplied value from being handed
 * out as a language live here, so the two backends cannot answer them
 * differently:
 *
 * - an inherited key ('constructor', 'toString') is not a language: it is
 *   looked up as an own property only;
 * - a language mapped to an empty code is not a language either: the empty
 *   code would reach the model as an empty string.
 *
 * The lookups answer with null or false rather than throwing, so each
 * backend keeps its own wording in the log line it writes.
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
 * The language a fallback names.
 *
 * @param {object|null} fallbackMap - The shipped fallback map.
 * @param {string} isoCode - The canonical language code.
 * @returns {string|null} The fallback language, or null when the map names
 *   none for it.
 */
function ownFallbackLanguage(fallbackMap, isoCode) {
  if (!fallbackMap || !Object.prototype.hasOwnProperty.call(fallbackMap, isoCode)) {
    return null;
  }
  return fallbackMap[isoCode] || null;
}

/**
 * Whether the backend can be asked for a language at all.
 *
 * @param {object|null} languageMap - The shipped language map.
 * @param {string} isoCode - The canonical language code.
 * @returns {boolean} True when the map maps the language to a usable code.
 */
function isLanguageSupported(languageMap, isoCode) {
  const codes = languageMap ? languageMap.languageMap : null;
  if (!codes || !Object.prototype.hasOwnProperty.call(codes, isoCode)) {
    return false;
  }
  // The two answers have to agree: ownLanguageCode refuses a language mapped
  // to an empty code, so this one refuses it too. Otherwise the resolution
  // chain walks on a language the backend cannot ask the model for.
  return Boolean(codes[isoCode]);
}

/**
 * Whether a code is one the model answers to.
 *
 * The codes the service hands to the backend are the ones the map produces.
 * A code the map does not produce is not a language the model can be asked
 * for, and saying so is what lets the caller check the codes on the way here.
 *
 * @param {object|null} languageMap - The shipped language map.
 * @param {string} code - A model-specific language code.
 * @returns {boolean} True when the map produces that code.
 */
function isModelLanguageCode(languageMap, code) {
  const codes = languageMap ? languageMap.languageMap : null;
  if (!codes || typeof code !== 'string' || code === '') {
    return false;
  }
  return Object.values(codes).includes(code);
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
  ownFallbackLanguage,
  isLanguageSupported,
  isModelLanguageCode,
  supportedLanguages
};
