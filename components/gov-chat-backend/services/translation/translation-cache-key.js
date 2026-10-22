/**
 * Translation cache key + invalidation version.
 *
 * See CLAUDE.md (and AGENTS.md symlink) in this directory for the full cache
 * invalidation policy.
 *
 * The cache key has FIVE dimensions so the right change invalidates it:
 *   translation:<md5(content)>:<sourceLangCode>:<targetLangCode>:<modelId>:<logicVersion>
 *   - md5(content)     : source text change -> new hash -> new key (automatic)
 *   - sourceLangCode   : different source language (automatic)
 *   - targetLangCode   : different target language (automatic)
 *   - modelId          : switching the translation model -> new key (automatic)
 *   - logicVersion     : translation LOGIC change in source code -> bump manually
 *
 * The two language dimensions carry the MODEL-SPECIFIC code ("eng_Latn"), not
 * the canonical one ("en"): two languages the model is asked for with the same
 * code ("man" and "mnk" are both "dyu_Latn" in the NLLB map) are the same
 * request to the model, so they are the same translation and belong in the
 * same entry.
 *
 * A version number is never reused for a different key shape: the cache has no
 * TTL, so the entries a released deployment wrote stay in Redis forever, and a
 * version that deployment used has to keep meaning what it meant then.
 *
 * TRANSLATION_LOGIC_VERSION must be bumped whenever the translation OUTPUT for
 * the same (content, lang, model) could differ — e.g. changes to splitEdges,
 * normalizeInlineSpacing, the LLM prompt, edge/separator handling, or batching.
 * This avoids serving stale cached translations that predate the logic change
 * (the bug that cost a long debugging session: 254 stale pre-fix entries were
 * served until the cache was flushed).
 *
 * @param {string} docHash - md5 (or other stable hash) of the source markdown
 * @param {string} sourceLangCode - model-specific source language code
 * @param {string} targetLangCode - model-specific target language code
 * @param {string} modelId - translation model id (e.g. 'google/gemma-3-4b-it')
 * @returns {string} Redis key
 */
// Bump on any translation-logic change. 1 = edge-preservation + run-in
// normalize. 2 = GPU output budget sized from the prompt instead of the whole
// context window (MR !576) — the entries cached before it hold translations
// produced under the old budget, including CPU/NLLB text written under the GPU
// model id when a GPU request was rejected and fell back. The key embeds the
// model id of the *primary* backend, so nothing else invalidates them.
// 3 = the language boundary (issue #1097): the requested language is resolved
// against the language map before the request is built, the prompt names the
// language from the map only, and the key carries the model-specific codes —
// the source language joined the key (a translation cached for one source
// language was produced from that source), and two languages the model answers
// alike share one entry. The change went through interim version numbers on
// its branch, but none of them shipped: a released deployment's entries live
// in Redis forever, so the number a release uses keeps one meaning.
const TRANSLATION_LOGIC_VERSION = '3';

function translationCacheKey(docHash, sourceLang, targetLang, modelId) {
  return `translation:${docHash}:${sourceLang}:${targetLang}:${modelId || 'unknown'}:${TRANSLATION_LOGIC_VERSION}`;
}

module.exports = { translationCacheKey, TRANSLATION_LOGIC_VERSION };
