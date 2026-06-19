/**
 * Split a markdown text-node value into structural edges and a translatable core.
 *
 * `lead` and `trail` are the leading/trailing characters that are NOT letters or
 * digits (whitespace AND punctuation — e.g. ": ", ". ", " - ", quotes). The
 * `core` is the word-bounded text between them.
 *
 * Why: a text node that adjoins inline markup often starts with structural
 * punctuation, e.g. `**Hive Selection**: Choose hives` parses into
 *   strong["Hive Selection"] + text[": Choose hives..."].
 * The translator model tends to DROP that leading ": " (and the backend trims
 * output), which collapses the rendered markdown from "Selection: Choose" into
 * "SelectionChoose". By translating only the `core` and re-applying the
 * original `lead`/`trail` verbatim, the structure is preserved deterministically
 * — the model never sees the edge characters, so it cannot drop or duplicate
 * them. (For nodes with no edge punctuation this is a no-op: lead/trail are "".)
 *
 * Unicode-aware: `\p{L}`/`\p{N}` treat accented letters (á, é, …) and digits as
 * core, not edges.
 *
 * @param {string} value - original text node value
 * @returns {{ lead: string, core: string, trail: string }}
 */
function splitEdges(value) {
  const m = (value || '').match(/^([^\p{L}\p{N}]*)([\s\S]*?)([^\p{L}\p{N}]*)$/u);
  return { lead: m[1], core: m[2], trail: m[3] };
}

module.exports = { splitEdges };
