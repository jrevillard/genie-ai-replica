'use strict';

// Story 2.4b — the fail-soft whole-answer translation core, ONE home for the
// two consumers (the streaming terminal's non-relay branch in
// routes/query-routes.js and the non-streaming JSON consumer in
// services/agent-json-result.js): one translator call, the empty-result rule
// (a translation that returned nothing never replaces the answer) and the
// error catch. Everything delivery-mode specific stays at the call sites —
// the success handling (a `translation` frame vs the delivered-text
// replacement), the latching and the logging vocabulary.

/**
 * Translate one whole answer, fail-soft: a translator that is missing, fails
 * or returns nothing never raises and never returns a replacement — the
 * caller keeps its original text and reports the failure its own way.
 *
 * @param {Object|null} translator - The request-resolved translator.
 * @param {string} text - The answer to translate.
 * @returns {Promise<{text: string|null, failed: boolean, error: Error|null}>}
 *   `text` is the translation, null when the translation failed or came back
 *   empty; `failed` distinguishes an attempted-and-failed translation from a
 *   skipped one; `error` carries the failure (null on the empty result).
 */
async function translateWholeAnswer(translator, text) {
  try {
    if (!translator) {
      throw new Error('no translator was prepared for the requested language');
    }
    const translated = await translator.translate(text);
    if (!translated || !translated.trim()) {
      return { text: null, failed: true, error: null };
    }
    return { text: translated, failed: false, error: null };
  } catch (error) {
    return { text: null, failed: true, error };
  }
}

module.exports = { translateWholeAnswer };
