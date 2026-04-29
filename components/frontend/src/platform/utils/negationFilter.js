/**
 * negationFilter — client-side negation-aware symptom keyword check.
 *
 * Replaces naive `keywords.some(k => text.includes(k))` with a check
 * that strips negated symptom mentions before matching.
 *
 *   "I feel dizzy"            → true  (affirmed)
 *   "I'm not feeling dizzy"   → false (negated)
 *   "no more headache"        → false (negated)
 *   "the pain is gone"        → false (resolved)
 *   "im not feeling dizzy now thanks" → false
 *
 * Usage:
 *   import { hasAffirmedSymptom } from "./platform/utils/negationFilter";
 *   const shouldSuggest = hasAffirmedSymptom(chatInput, SYMPTOM_TRIGGERS);
 */

const NEGATION_WORDS = new Set([
  "no", "not", "never", "none", "without", "nor",
  "dont", "don't", "doesn't", "doesnt", "didn't", "didnt",
  "isn't", "isnt", "aren't", "arent", "wasn't", "wasnt",
  "weren't", "werent", "won't", "wont", "wouldn't", "wouldnt",
  "can't", "cant", "cannot", "couldn't", "couldnt",
  "shouldn't", "shouldnt", "haven't", "havent", "hasn't", "hasnt",
]);

const RESOLUTION_RE = new RegExp(
  [
    "\\b(?:no\\s+(?:more|longer))\\b",
    "\\b(?:is|are|am|was|were|feeling)\\s+(?:gone|over|better|fine|okay|ok|good|great|resolved|cleared)\\b",
    "\\b(?:went\\s+away|cleared\\s+up|stopped|subsided|eased|relieved)\\b",
    "\\b(?:used\\s+to\\s+(?:have|feel|get|experience))\\b",
    "\\b(?:don'?t|do\\s+not|doesn'?t|does\\s+not)\\s+(?:have|feel|get|experience)\\b",
    "\\b(?:i'?m\\s+(?:not|no\\s+longer))\\b",
    "\\b(?:free\\s+(?:of|from))\\b",
    "\\bnot\\s+(?:feeling|having|experiencing)\\b",
  ].join("|"),
  "i"
);

const WELLBEING_RE = new RegExp(
  [
    "\\b(?:i'?m\\s+(?:fine|good|great|okay|ok|well|better|alright))",
    "(?:feeling\\s+(?:fine|good|great|okay|ok|well|better|alright))",
    "(?:i\\s+feel\\s+(?:fine|good|great|okay|ok|well|better|alright))",
    "(?:no\\s+(?:issues?|problems?|complaints?|concerns?|worries?))",
    "(?:thank|thanks\\b)",
  ].join("|"),
  "i"
);

/**
 * Check if `keyword` at position `kwPos` in `text` is negated.
 */
function isNegated(text, keyword, kwPos) {
  // Check 4-word window before the keyword
  const prefix = text.slice(Math.max(0, kwPos - 30), kwPos);
  const words = prefix.trim().split(/\s+/);
  const lastFour = words.slice(-4);

  for (const w of lastFour) {
    // Normalize contractions: "im" → "i'm", etc.
    const norm = w.replace(/['']/g, "'").toLowerCase();
    if (NEGATION_WORDS.has(norm)) return true;
  }

  return false;
}

/**
 * Returns true only if at least one keyword appears AND is not negated.
 *
 * @param {string} text      — user input (will be lowercased)
 * @param {string[]} keywords — symptom keyword list
 * @returns {boolean}
 */
export function hasAffirmedSymptom(text, keywords) {
  if (!text || !keywords?.length) return false;

  const t = text.trim().toLowerCase();
  if (t.length < 4) return false;

  // Whole-message wellbeing / resolution → no symptoms
  if (WELLBEING_RE.test(t)) return false;
  if (RESOLUTION_RE.test(t)) return false;

  for (const kw of keywords) {
    const pos = t.indexOf(kw.toLowerCase());
    if (pos === -1) continue;
    if (!isNegated(t, kw, pos)) return true;
  }

  return false;
}

/**
 * Returns the list of keywords that are affirmed (non-negated).
 */
export function extractAffirmedSymptoms(text, keywords) {
  if (!text || !keywords?.length) return [];

  const t = text.trim().toLowerCase();
  if (t.length < 4) return [];

  if (WELLBEING_RE.test(t)) return [];
  if (RESOLUTION_RE.test(t)) return [];

  const affirmed = [];
  for (const kw of keywords) {
    const pos = t.indexOf(kw.toLowerCase());
    if (pos === -1) continue;
    if (!isNegated(t, kw, pos)) affirmed.push(kw);
  }
  return affirmed;
}

// Register globally so App.jsx can pick it up without an import edit
if (typeof window !== "undefined") {
  window.AMINA_NEGATION = { hasAffirmedSymptom, extractAffirmedSymptoms };
}
