/**
 * Detect words the translator left in a foreign Latin-script language.
 *
 * gemma-3-4b-it deterministically drops a Portuguese/Spanish word into
 * Bengali output for some sentences ("official" -> "oficiais", "expected" ->
 * "previstas"); the same input reproduces the same leak at every temperature,
 * so a blind retry cannot fix it. Naming the leaked word in the retry prompt
 * does (3/3 clean in measurement), which is what the caller uses this for.
 *
 * A Latin word in the output counts as a leak only when it does NOT appear in
 * the English source: tokens that are meant to stay Latin (BAMIS, BMD, RH,
 * Open-Meteo, place names, units) are in the source and therefore exempt, so
 * no hand-kept allow-list is needed. Markdown link destinations are skipped:
 * URLs are Latin by nature.
 *
 * Pure / synchronous - unit-testable.
 *
 * @param {string} source - the source (English) text
 * @param {string} output - the translated output
 * @returns {string[]} distinct leaked words, in order of first appearance
 */
const LINK_DESTINATION = /\]\([^)]*\)/g;
// Latin (incl. accented) OR any other non-Bengali, non-Latin letter run: the
// model has also dropped Arabic ("المياه" for "water") into Bengali output,
// which a Latin-only check cannot see.
const LATIN_WORD = /[A-Za-zÀ-ɏ]{3,}/g;
const OTHER_SCRIPT_WORD = /(?:(?!\p{Script=Bengali})(?!\p{Script=Latin})\p{L}){2,}/gu;

function findForeignWords(source, output) {
  if (typeof output !== 'string' || !output) return [];
  const sourceWords = new Set((String(source || '').match(LATIN_WORD) || []).map((w) => w.toLowerCase()));
  const seen = new Set();
  const leaked = [];
  const body = output.replace(LINK_DESTINATION, '');
  const candidates = [...(body.match(LATIN_WORD) || []), ...(body.match(OTHER_SCRIPT_WORD) || [])];
  for (const word of candidates) {
    const key = word.toLowerCase();
    if (sourceWords.has(key) || seen.has(key)) continue;
    seen.add(key);
    leaked.push(word);
  }
  return leaked;
}

/**
 * The retry instruction: names the leaked words so the model corrects them.
 * A generic "no Latin words" instruction did not cure the leak; naming did.
 * @param {string[]} words
 * @param {string} targetLangName - e.g. 'Bengali'
 * @returns {string}
 */
function foreignWordHint(words, targetLangName) {
  if (!words || !words.length) return '';
  const list = words.map((w) => `"${w}"`).join(', ');
  return (
    `A previous attempt wrongly left the word${words.length > 1 ? 's' : ''} ${list} untranslated; ` +
    `that is not ${targetLangName}. Translate every such word into ${targetLangName} script.`
  );
}

module.exports = { findForeignWords, foreignWordHint };
