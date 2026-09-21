/**
 * Map-intent detection for the chat input (web twin of the mobile
 * `utils/geo_utils.dart` — keep the two in step; both have the same tests).
 *
 * Two forms:
 *  - bare  "show me the map" / "manchitro dekhao" / "মানচিত্র দেখাও": the user
 *    means THEIR area. There is no place to geocode, and the LLM has no map,
 *    so the caller runs the "Map my field" quick-help flow (field delineation
 *    around the resolved district; the map opens from the response metadata).
 *  - named "show me the map <place>": the caller opens the map via the geocoder.
 */

// "show/open [me] [the|a] map", Banglish, and the Bengali forms with optional
// "আমার" / "টা"; nothing after but punctuation.
const BARE_MAP_RE =
  /^(?:(?:please\s+)?(?:show|open)\s+(?:me\s+)?(?:the\s+|a\s+)?map|manchitro\s+dekhao|(?:আমার\s+)?(?:মানচিত্র|ম্যাপ)\s*(?:টা\s*)?দেখা[ওন])\s*[.!?।]*$/i;

const LEADING_PLACE_RE = /^(?:show me the map|manchitro dekhao|মানচিত্র দেখা[ওন])\s+(.+)$/i;
const TRAILING_PLACE_RE = /^(.+?)\s*(?:এর)?\s*মানচিত্র\s*দেখা[ওন]$/;

/**
 * @param {string} content
 * @returns {boolean} true for the bare form (no place named)
 */
export function isBareMapIntent(content) {
  return BARE_MAP_RE.test(String(content || '').trim());
}

/**
 * @param {string} content
 * @returns {string|null} the named place, or null for ordinary text and the bare form
 */
export function parseMapPlace(content) {
  const text = String(content || '').trim();
  const leading = text.match(LEADING_PLACE_RE);
  if (leading) return leading[1].trim();
  const trailing = text.match(TRAILING_PLACE_RE);
  return trailing ? trailing[1].trim() : null;
}
