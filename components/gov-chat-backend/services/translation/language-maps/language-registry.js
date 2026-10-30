/**
 * The accessor every language map loads the registry through.
 *
 * language-registry.json is the single source of the supported languages,
 * shared with the chatqna service. The accessor is the one place that reads
 * it and the one place that fails when it and a map disagree: a registry
 * without a model's table would otherwise spread into an empty map — the
 * module would load, and every language would be refused at request time
 * with nothing but a warning. Failing at require time names the defect
 * instead.
 */

const registry = require('./language-registry.json');

/**
 * The codes a model is asked for, keyed by canonical language.
 *
 * @param {string} modelKey - The registry key of the model ('nllb-200',
 *   'gemma-3', 'translategemma' — the language-maps file names minus
 *   '-map.js').
 * @returns {object} The model's code table. Treat it as read-only: it is
 *   shared with every other map loaded in this process.
 * @throws {Error} When the registry has no table for the model.
 */
function modelCodes(modelKey) {
  const table = registry.modelCodes && registry.modelCodes[modelKey];
  if (!table) {
    throw new Error(
      `The language registry has no "${modelKey}" model-code table — the shipped registry and the language maps disagree`
    );
  }
  return table;
}

/**
 * The language names, keyed by canonical language code.
 *
 * @returns {object} A fresh map of code -> display name. The prompt builder
 *   names languages from it, so an entry without a non-empty name is a
 *   defect in the shipped registry and fails here rather than at request
 *   time.
 * @throws {Error} When a registry entry carries no name.
 */
function languageNames() {
  const names = {};
  for (const [code, language] of Object.entries(registry.languages)) {
    if (!language || typeof language.name !== 'string' || language.name.length === 0) {
      throw new Error(
        `The language registry has no name for "${code}" — the shipped registry and the language maps disagree`
      );
    }
    names[code] = language.name;
  }
  return names;
}

module.exports = {
  modelCodes,
  languageNames
};
