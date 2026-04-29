/**
 * Latin Mandinka → N'Ko (ߒߞߏ) script transliteration.
 *
 * Client-side display transformation. The stored/transmitted text stays
 * Latin; this is purely a rendering layer for patients who read N'Ko.
 *
 * N'Ko is RIGHT-TO-LEFT — wrap the output in a dir="rtl" container.
 */

// ── Digraph mappings (must be checked BEFORE single-character maps) ──

const DIGRAPHS = [
  ["ny", "\u07E2"],   // ߢ  (palatal nasal)
  ["ng", "\u07D2"],   // ߒ  (velar nasal, same as ŋ)
  ["ch", "\u07D7"],   // ߗ
  ["sh", "\u07DB"],   // ߛ  (approximate — Mandinka doesn't use sh often)
  ["nk", "\u07D2\u07DE"], // ŋk → ߒߞ
];

// ── Single-character maps ───────────────────────────────────────────

const CHAR_MAP = {
  // Vowels
  a: "\u07CA",   // ߊ
  e: "\u07CD",   // ߍ
  "\u025B": "\u07CD",  // ɛ → ߍ
  i: "\u07CC",   // ߌ
  o: "\u07CB",   // ߋ
  "\u0254": "\u07CF",  // ɔ → ߏ
  u: "\u07CE",   // ߎ

  // Consonants
  b: "\u07D3",   // ߓ
  c: "\u07D7",   // ߗ  (fallback for lone 'c')
  d: "\u07D8",   // ߘ
  f: "\u07DD",   // ߝ
  g: "\u07DC",   // ߜ
  h: "\u07E4",   // ߤ
  j: "\u07D6",   // ߖ
  k: "\u07DE",   // ߞ
  l: "\u07DF",   // ߟ
  m: "\u07E1",   // ߡ
  n: "\u07E3",   // ߣ
  "\u014B": "\u07D2",  // ŋ → ߒ
  "\u0272": "\u07E2",  // ɲ → ߢ
  p: "\u07D4",   // ߔ
  q: "\u07DE",   // ߞ  (fallback)
  r: "\u07D9",   // ߙ
  s: "\u07DB",   // ߛ
  t: "\u07D5",   // ߕ
  v: "\u07D3",   // ߓ  (no native v, approximate)
  w: "\u07E5",   // ߥ
  x: "\u07DE\u07DB",   // ks → ߞߛ
  y: "\u07E6",   // ߦ
  z: "\u07DB",   // ߛ  (approximate)
};

// ── Digit maps ──────────────────────────────────────────────────────

const DIGIT_MAP = {
  "0": "\u07C0",  // ߀
  "1": "\u07C1",  // ߁
  "2": "\u07C2",  // ߂
  "3": "\u07C3",  // ߃
  "4": "\u07C4",  // ߄
  "5": "\u07C5",  // ߅
  "6": "\u07C6",  // ߆
  "7": "\u07C7",  // ߇
  "8": "\u07C8",  // ߈
  "9": "\u07C9",  // ߉
};

// ── Preserve list — words kept in Latin script ──────────────────────
// Medical terms, place names, units, medication names that should NOT
// be transliterated. Compared case-insensitively.

const PRESERVE_SET = new Set([
  // Clinical acronyms & units
  "dka", "bp", "mg/dl", "mmol/l", "hba1c", "bmi", "hiv", "tb", "covid",
  "who", "efsth", "rch", "chw", "vhw",
  // Medication names
  "metformin", "amlodipine", "paracetamol", "insulin", "amoxicillin",
  "ibuprofen", "ors", "zinc", "act", "artemether", "lumefantrine",
  // Place names
  "banjul", "kanifing", "serekunda", "brikama", "farafenni",
  // Food names already in Mandinka
  "benachin", "domoda", "supakanja", "bissap", "attaya", "bouye", "moringa",
  // Technical terms
  "hyperglycemia", "ketoacidosis", "diabetic",
]);

/**
 * Check if a word should be kept in Latin script.
 */
function shouldPreserve(word) {
  const clean = word.replace(/[.,;:!?()\[\]"']/g, "").toLowerCase();
  if (PRESERVE_SET.has(clean)) return true;
  // Keep words with digits + units (e.g. "300", "mg/dL")
  if (/\d/.test(word)) return true;
  // Keep ALL-CAPS abbreviations (DKA, EFSTH, etc.)
  if (/^[A-Z]{2,}$/.test(word.replace(/[.,;:!?]/g, ""))) return true;
  return false;
}

/**
 * Transliterate a single word from Latin Mandinka to N'Ko.
 */
function transliterateWord(word) {
  if (!word) return word;

  // Extract leading/trailing punctuation
  const leadMatch = word.match(/^([.,;:!?()\[\]"']*)/);
  const trailMatch = word.match(/([.,;:!?()\[\]"']*)$/);
  const lead = leadMatch ? leadMatch[1] : "";
  const trail = trailMatch ? trailMatch[1] : "";
  const core = trail.length > 0
    ? word.slice(lead.length, -trail.length)
    : word.slice(lead.length);

  if (!core) return word;
  if (shouldPreserve(core)) return word;

  const lower = core.toLowerCase();
  let result = "";
  let idx = 0;

  while (idx < lower.length) {
    // Try digraphs first (longest match)
    let matched = false;
    for (const [latin, nko] of DIGRAPHS) {
      if (lower.startsWith(latin, idx)) {
        result += nko;
        idx += latin.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Single character
    const ch = lower[idx];
    if (CHAR_MAP[ch]) {
      result += CHAR_MAP[ch];
    } else if (DIGIT_MAP[ch]) {
      result += DIGIT_MAP[ch];
    } else {
      // Keep unknown characters as-is (spaces, punctuation, etc.)
      result += ch;
    }
    idx++;
  }

  return lead + result + trail;
}

/**
 * Transliterate a full text from Latin Mandinka to N'Ko script.
 *
 * @param {string} text - Latin-script Mandinka text
 * @returns {string} N'Ko transliteration (render with dir="rtl")
 */
export function toNko(text) {
  if (!text) return text;
  return text
    .split(/(\s+)/)
    .map(segment => /^\s+$/.test(segment) ? segment : transliterateWord(segment))
    .join("");
}

/**
 * Check if text appears to be Mandinka (heuristic).
 * Used to decide whether to offer the N'Ko toggle.
 */
export function looksLikeMandinka(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  const markers = ["be", "ka", "le", "la", "ye", "mu", "ko", "taa", "naa",
                    "kendeyaa", "nyinata", "domorola", "kuuraŋo", "sukkaroo"];
  let hits = 0;
  for (const m of markers) {
    if (lower.includes(m)) hits++;
  }
  return hits >= 3;
}
