/**
 * Repair script leaks in translator output.
 *
 * The GPU translator (gemma-3-4b-it) occasionally emits a few codepoints from
 * a sibling Indic script inside an otherwise-Bengali word: "রাজशाहীতে" for
 * রাজশাহীতে (Devanagari शाह), "মাઇલ્ડউইજ" for মাইল্ডউইজ (Gujarati). The
 * Brahmic blocks are laid out in parallel, each letter at the same offset
 * from its block base, so a leaked letter maps to its Bengali counterpart by
 * subtracting the block base and adding Bengali's.
 *
 * A codepoint is mapped only when the parallel Bengali slot is assigned AND
 * is the same kind of character (letter, combining mark, digit, punctuation).
 * JS exposes no Unicode names, so category is the closest check available;
 * an unassigned slot fails the script test and the character is left as-is
 * rather than replaced with an unrelated letter. Blocks whose layout diverges
 * (Tamil lacks aspirates; Malayalam's vowel signs sit elsewhere) therefore
 * repair the shared letters and leave the rest alone.
 *
 * Applied only when the TARGET language is Bengali: these scripts are the
 * correct output for their own languages.
 *
 * Pure / synchronous, no dependencies — unit-testable.
 *
 * @param {string} text - translator output
 * @param {string} targetLang - target language code ('bn', 'bn-BD', ...)
 * @returns {string} text with leaked sibling-script letters mapped to Bengali
 */
const BENGALI_BASE = 0x0980;
const BENGALI_SCRIPT_RE = /\p{Script=Bengali}/u;

// Sibling blocks whose layout parallels Bengali. [base, script property].
const SIBLING_BLOCKS = [
  [0x0900, 'Devanagari'],
  [0x0a00, 'Gurmukhi'],
  [0x0a80, 'Gujarati'],
  [0x0b00, 'Oriya'],
  [0x0b80, 'Tamil'],
  [0x0c00, 'Telugu'],
  [0x0c80, 'Kannada'],
  [0x0d00, 'Malayalam']
];
const ANY_SIBLING_RE = new RegExp(SIBLING_BLOCKS.map(([, s]) => `\\p{Script=${s}}`).join('|'), 'u');

// Letters with no same-offset Bengali slot but an obvious Bengali spelling.
// Keyed by offset within the block (same for every sibling block).
const EXPLICIT_BY_OFFSET = new Map([
  [0x35, 0x09ac] // VA -> BENGALI LETTER BA (Bengali has no VA)
]);

function repairScriptLeak(text, targetLang) {
  if (typeof text !== 'string' || !text) return text;
  if (
    !String(targetLang || '')
      .toLowerCase()
      .startsWith('bn')
  )
    return text;
  if (!ANY_SIBLING_RE.test(text)) return text;

  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    const block = SIBLING_BLOCKS.find(([base]) => cp >= base && cp <= base + 0x7f);
    if (!block) {
      out += ch;
      continue;
    }
    const offset = cp - block[0];
    if (EXPLICIT_BY_OFFSET.has(offset)) {
      out += String.fromCodePoint(EXPLICIT_BY_OFFSET.get(offset));
      continue;
    }
    const candidate = String.fromCodePoint(BENGALI_BASE + offset);
    // Same category (letter/mark/digit) at the parallel slot is the closest
    // check available without Unicode names; unassigned slots fail the
    // script test and fall through untouched.
    out += BENGALI_SCRIPT_RE.test(candidate) && sameCategory(ch, candidate) ? candidate : ch;
  }
  return out;
}

const CATEGORY_RES = [/\p{L}/u, /\p{M}/u, /\p{Nd}/u, /\p{P}/u];
function sameCategory(a, b) {
  for (const re of CATEGORY_RES) {
    if (re.test(a) !== re.test(b)) return false;
  }
  return true;
}

module.exports = { repairScriptLeak };
