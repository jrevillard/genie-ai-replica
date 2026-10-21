'use strict';

/**
 * A bounded, log-safe form of a caller-supplied language.
 *
 * The language travels in the request body, so it is attacker-controlled: a
 * log line must not carry it whole, nor carry the characters that could
 * forge one. The value is reduced to the characters a language name is made
 * of — letters, digits, underscore and hyphen — and cut to 32 characters.
 *
 * The chatqna service applies the same rule to the value it logs
 * (genie-ai-overlay/chatqna/genieai_chatqna.py, _language_display).
 *
 * @param {*} value - The value as it arrived from the caller.
 * @returns {string} At most 32 letters, digits, underscores or hyphens.
 */
function languageForLog(value) {
  if (typeof value !== 'string') return '<non-string>';
  const printable = value.replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 32);
  return printable || '<empty>';
}

module.exports = { languageForLog };
