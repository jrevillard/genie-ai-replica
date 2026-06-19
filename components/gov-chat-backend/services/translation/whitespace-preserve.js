/**
 * Re-apply the leading/trailing whitespace of `original` onto `translated`.
 *
 * The translation backend trims model output (see gpu-translate-backend
 * callVllmService `.trim()`). For markdown text nodes that adjoin inline
 * markup, that edge whitespace is structural — losing it collapses
 * "**Hive Selection:** Choose hives" into "**Selección de Hive**Elige colmenas".
 * This restores it so the remark AST reassembles with correct spacing.
 *
 * @param {string} original - original text node value (may have edge whitespace)
 * @param {string} translated - trimmed translation produced for that node
 * @returns {string} translated text wrapped in the original's edge whitespace
 */
function withOriginalWhitespace(original, translated) {
  const src = original || '';
  const lead = /^\s*/.exec(src)[0];
  // Match trailing whitespace on the remainder AFTER the lead, so a
  // whitespace-only node isn't counted twice (lead + trail overlap).
  const trail = /\s*$/.exec(src.slice(lead.length))[0];
  return lead + (translated || '') + trail;
}

module.exports = { withOriginalWhitespace };
