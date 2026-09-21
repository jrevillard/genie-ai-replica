/**
 * Repair script leaks in translator output.
 *
 * The GPU translator (gemma-3-4b-it) occasionally emits a few Devanagari
 * codepoints inside an otherwise-Bengali word: "রাজशाहীতে" for রাজশাহীতে
 * (Rajshahi), where শাহ came out as the Hindi शाह. Devanagari and Bengali are
 * sibling Brahmic blocks laid out in parallel exactly 0x80 apart, so each
 * leaked letter maps to its Bengali counterpart by a constant offset.
 *
 * Only codepoints whose Bengali slot is assigned are mapped (checked via
 * \p{Script=Bengali} on the candidate); the rest are left as-is rather than
 * replaced with an unrelated letter. The shared danda (U+0964) therefore stays
 * put, and the one letter with no parallel slot, VA, is mapped explicitly to
 * Bengali BA, which is how that sound is written.
 *
 * Applied only when the TARGET language is Bengali: Devanagari is the correct
 * output for Hindi/Marathi/Nepali targets.
 *
 * Pure / synchronous, no dependencies — unit-testable.
 *
 * @param {string} text - translator output
 * @param {string} targetLang - target language code ('bn', 'bn-BD', ...)
 * @returns {string} text with leaked Devanagari mapped to Bengali
 */
const DEVANAGARI_RE = /[ऀ-ॿ]/;
const BENGALI_SCRIPT_RE = /\p{Script=Bengali}/u;
const BLOCK_OFFSET = 0x80;

// DEVANAGARI LETTER VA -> BENGALI LETTER BA (Bengali has no distinct VA).
const EXPLICIT = new Map([[0x0935, 0x09ac]]);

function repairScriptLeak(text, targetLang) {
  if (typeof text !== 'string' || !text) return text;
  if (
    !String(targetLang || '')
      .toLowerCase()
      .startsWith('bn')
  )
    return text;
  if (!DEVANAGARI_RE.test(text)) return text;

  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp < 0x0900 || cp > 0x097f) {
      out += ch;
      continue;
    }
    if (EXPLICIT.has(cp)) {
      out += String.fromCodePoint(EXPLICIT.get(cp));
      continue;
    }
    const candidate = String.fromCodePoint(cp + BLOCK_OFFSET);
    out += BENGALI_SCRIPT_RE.test(candidate) ? candidate : ch;
  }
  return out;
}

module.exports = { repairScriptLeak };
