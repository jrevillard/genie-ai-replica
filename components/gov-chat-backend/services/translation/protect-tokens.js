/**
 * Shield tokens the translator must copy verbatim: swap them for numbered
 * placeholders before translation, restore them after.
 *
 * gemma-3-4b-it mangles proper nouns on Indic targets - "Prithvi-EO-2.0" came
 * back as "প্রithvi-ইও-২.০", "NASA" as "নাসাহ" - and a leak inside a name
 * cannot be repaired afterwards (there is no correct Bengali for it). The
 * model DOES copy placeholders faithfully (5/5 tokens in every measured run),
 * so the names never enter the model at all.
 *
 * Protected: acronyms (BMD, NASA, RH), tokens containing a digit (SEAS5,
 * Sen1Floods11, Prithvi-EO-2.0), and hyphenated tokens that start with a
 * capital (Open-Meteo, Sentinel-2). NOT protected: ordinary hyphenated English
 * ("cloud-free", "well-drained") - that must be translated - and single
 * capitalised words: "Sapahar" is kept by the prompt's place-name rule, and
 * shielding every sentence-initial word would starve the model of context.
 * Markdown link destinations are already Latin by nature and skipped.
 *
 * Pure / synchronous - unit-testable.
 */
const { NAMES_BN } = require('./place-names-bn');

const LINK_DESTINATION = /\]\([^)]*\)/g;
// Acronym | has a digit | Capitalised-and-hyphenated. Word-bounded so "RH" in
// "RHythm" is not shielded.
const PROTECTED_TOKEN =
  /\b(?:[A-Z]{2,}[A-Za-z0-9.-]*|[A-Za-z][A-Za-z.-]*\d[A-Za-z0-9.-]*|[A-Z][a-z0-9]*-[A-Za-z0-9.-]+)\b/g;
// Known place names, longest first so "Cox's Bazar" wins over a prefix.
const PLACE_NAME = new RegExp(
  `\\b(?:${[...NAMES_BN.keys()]
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})\\b`,
  'g'
);
const PLACEHOLDER = (i) => `⟦${i}⟧`; // ⟦i⟧ - never produced by the model on its own
// Either bracket on either side: the model has echoed a marker as "⟧0⟧"
// (closing bracket twice), which a strict "⟦0⟧" match let through to the
// farmer's screen. Neither codepoint occurs in real Bengali or English text,
// so the loose form cannot collide with prose.
const PLACEHOLDER_RE = /[⟦⟧](\d+)[⟦⟧]/g;
// Anything marker-shaped, including one the model cut off ("⟦12" with no
// close): must never reach the UI, whichever path produced it.
const STRAY_MARKER_RE = /[⟦⟧]\d*[⟦⟧]?/g;

/**
 * @param {string} text
 * @returns {{ text: string, tokens: string[] }} shielded text + restore table
 */
function protectTokens(text) {
  if (typeof text !== 'string' || !text) return { text, tokens: [] };
  const tokens = [];
  // Keep link destinations out of the scan by shielding them first as a unit.
  const links = [];
  let work = text.replace(LINK_DESTINATION, (m) => {
    links.push(m);
    // Marker built only from private-use codepoints: PROTECTED_TOKEN (letters/
    // digits) can never match inside it, so the shield is not itself shielded.
    return `\ue000${'\ue001'.repeat(links.length)}\ue002`;
  });
  work = work.replace(PROTECTED_TOKEN, (m) => {
    // Pure numbers / percentages are copied fine and must stay readable to the
    // model (units follow them): only shield when there is a letter.
    if (!/[A-Za-z]/.test(m)) return m;
    tokens.push(m);
    return PLACEHOLDER(tokens.length - 1);
  });
  // Place names second: a name inside an already-shielded token is gone by now.
  work = work.replace(PLACE_NAME, (m) => {
    tokens.push(m);
    return PLACEHOLDER(tokens.length - 1);
  });
  work = work.replace(/\ue000(\ue001+)\ue002/g, (_, n) => links[n.length - 1]);
  return { text: work, tokens };
}

/**
 * @param {string} text translator output
 * @param {string[]} tokens from protectTokens
 * @param {string} [targetLang] - for 'bn', known place names are restored in
 *   Bengali (place-names-bn.js); everything else comes back verbatim.
 * @returns {string}
 */
function restoreTokens(text, tokens, targetLang = '') {
  if (typeof text !== 'string' || !tokens || !tokens.length) return text;
  const bengali = String(targetLang).toLowerCase().startsWith('bn');
  let dropped = false;
  const restored = text.replace(PLACEHOLDER_RE, (m, i) => {
    const original = tokens[Number(i)];
    // No entry for this index: the model invented the marker (the prompt shows
    // it one) or renumbered it. Returning `m` printed a literal "⟦0⟧" in the
    // answer, so drop it instead — a missing name reads better than a marker,
    // and the sentence around it is already translated.
    if (original === undefined) {
      dropped = true;
      return '';
    }
    return bengali && NAMES_BN.has(original) ? NAMES_BN.get(original) : original;
  });
  return dropped ? tidyGaps(restored) : restored;
}

/** Close the hole a dropped marker leaves: doubled space, space before punctuation. */
function tidyGaps(text) {
  return text.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([,.;:!?।])/g, '$1');
}

/**
 * Remove every placeholder from text that has no restore table at all (a unit
 * translated without shielding), and tidy the gaps.
 * @param {string} text
 * @returns {string}
 */
function stripUnresolved(text) {
  if (typeof text !== 'string' || !/[\u27e6\u27e7]/.test(text)) return text;
  return tidyGaps(text.replace(STRAY_MARKER_RE, ''));
}

/**
 * Delta filter for a streamed unit that has no restore table: drops any
 * placeholder the model invents. A marker can straddle two deltas ("\u27e6" in one,
 * "0\u27e7" in the next), so an unterminated "\u27e6<digits>" tail is held back until
 * the next delta completes it or `flush()` discards it.
 *
 * @param {(delta: string) => void} emit downstream token sink
 * @returns {{ push: (delta: string) => void, flush: () => void }}
 */
function createMarkerScrubber(emit) {
  let pending = '';
  const push = (delta) => {
    pending = (pending + String(delta ?? '')).replace(PLACEHOLDER_RE, '');
    const open = Math.max(pending.lastIndexOf('\u27e6'), pending.lastIndexOf('\u27e7'));
    // Hold back only a genuine partial marker: "\u27e6" followed by digits alone.
    const cut = open !== -1 && /^[\u27e6\u27e7]\d*$/.test(pending.slice(open)) ? open : pending.length;
    const out = pending.slice(0, cut);
    pending = pending.slice(cut);
    if (out) emit(out);
  };
  const flush = () => {
    const out = pending.replace(STRAY_MARKER_RE, '');
    pending = '';
    if (out) emit(out);
  };
  return { push, flush };
}

/** Prompt sentence explaining the placeholders to the model. */
const PLACEHOLDER_INSTRUCTION =
  'Tokens like ⟦0⟧ are placeholders for names that must not be translated: copy each one exactly where it stands, do not translate, reorder or remove them.';

module.exports = { protectTokens, restoreTokens, stripUnresolved, createMarkerScrubber, PLACEHOLDER_INSTRUCTION };
