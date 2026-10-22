'use strict';

/**
 * A bounded, log-safe form of a caller-supplied language.
 *
 * The language travels in the request body, so it is attacker-controlled: a
 * log line must not carry it whole, nor carry the characters that could
 * forge one. The value is trimmed, then cut to 32 characters, then reduced to
 * the characters a language name is made of — letters, digits, underscore and
 * hyphen. The trim comes first so that a language the caller padded with
 * spaces still names itself in the log: a value that logs as empty cannot be
 * correlated with the lines of the other service.
 *
 * The chatqna service applies the same rule to the value it logs
 * (genie-ai-overlay/chatqna/genieai_chatqna.py, _language_display).
 *
 * @param {*} value - The value as it arrived from the caller.
 * @returns {string} At most 32 letters, digits, underscores or hyphens.
 */
function languageForLog(value) {
  if (typeof value !== 'string') return '<non-string>';
  const printable = value
    .trim()
    .slice(0, 32)
    .replace(/[^\p{L}\p{N}_-]/gu, '');
  return printable || '<empty>';
}

module.exports = { languageForLog };
