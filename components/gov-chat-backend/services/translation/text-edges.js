/**
 * Split a markdown text-node value into a leading edge, a translatable core, and
 * a trailing edge — so structural characters survive translation.
 *
 * - `lead` = leading non-letter/non-digit chars (whitespace AND punctuation, e.g.
 *   ": ", " ", "«", quotes). The translator model drops leading structure, so it
 *   is stripped, the core translated, and `lead` re-applied verbatim.
 * - `trail` = trailing WHITESPACE only. The model trims trailing whitespace, so
 *   it is stripped and re-applied.
 * - `core` = everything between — INCLUDING any trailing punctuation (".", "?",
 *   closing quotes). Trailing punctuation stays in the core on purpose: the
 *   model keeps/produces sentence-ending punctuation, so re-applying it would
 *   double it ("word.."). Keeping it in the core means the model sees it and
 *   preserves a single copy.
 *
 * Why leading ≠ trailing: empirically the model DROPS leading edge chars (e.g.
 * the ": " after `**bold**`, collapsing "Heading: text" → "Headingtext") but
 * KEEPS/adds trailing punctuation. So lead is fully preserved (whitespace +
 * punctuation) while trail preserves only whitespace.
 *
 * Unicode-aware (`\p{L}`/`\p{N}`): accented letters (á, é, …) and digits count
 * as core, not edges.
 *
 * @param {string} value - original text node value
 * @returns {{ lead: string, core: string, trail: string }}
 */
function splitEdges(value) {
  const src = value || '';
  const lead = (src.match(/^[^\p{L}\p{N}]*/u) || [''])[0];
  const after = src.slice(lead.length);
  const trail = (after.match(/\s*$/) || [''])[0];
  const core = after.slice(0, after.length - trail.length);
  return { lead, core, trail };
}

module.exports = { splitEdges };
