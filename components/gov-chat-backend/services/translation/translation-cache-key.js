/**
 * Translation cache key + invalidation version.
 *
 * See CLAUDE.md (and AGENTS.md symlink) in this directory for the full cache
 * invalidation policy.
 *
 * The cache key has FOUR dimensions so the right change invalidates it:
 *   translation:<md5(content)>:<targetLang>:<modelId>:<logicVersion>
 *   - md5(content)  : source text change -> new hash -> new key (automatic)
 *   - targetLang    : different target language (automatic)
 *   - modelId       : switching the translation model -> new key (automatic)
 *   - logicVersion  : translation LOGIC change in source code -> bump manually
 *
 * TRANSLATION_LOGIC_VERSION must be bumped whenever the translation OUTPUT for
 * the same (content, lang, model) could differ — e.g. changes to splitEdges,
 * normalizeInlineSpacing, the LLM prompt, edge/separator handling, or batching.
 * This avoids serving stale cached translations that predate the logic change
 * (the bug that cost a long debugging session: 254 stale pre-fix entries were
 * served until the cache was flushed).
 *
 * @param {string} docHash - md5 (or other stable hash) of the source markdown
 * @param {string} targetLang - target language code
 * @param {string} modelId - translation model id (e.g. 'google/gemma-3-4b-it')
 * @returns {string} Redis key
 */
// Bump on any translation-logic change. 1 = edge-preservation + run-in normalize.
const TRANSLATION_LOGIC_VERSION = '1';

function translationCacheKey(docHash, targetLang, modelId) {
  return `translation:${docHash}:${targetLang}:${modelId || 'unknown'}:${TRANSLATION_LOGIC_VERSION}`;
}

module.exports = { translationCacheKey, TRANSLATION_LOGIC_VERSION };
