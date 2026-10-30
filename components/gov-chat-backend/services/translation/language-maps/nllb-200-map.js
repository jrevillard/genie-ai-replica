/**
 * NLLB-200 Language Map
 *
 * Model: facebook/nllb-200-distilled-600M
 * Code Format: FLORES-200 (language_script)
 * Model Type: nllb
 *
 * This model uses FLORES-200 language codes which combine language and script.
 * Full reference: https://huggingface.co/facebook/nllb-200-distilled-600M
 *
 * The languages and the codes the model is asked for come from the language
 * registry (language-registry.json), the single source of the language list
 * shared with the chatqna service. This module only adds what is specific to
 * the model: its name, its type, its code format.
 */

const registry = require('./language-registry.json');

// A registry without this model's table would spread into an empty map: the
// module would load, and every language would be refused at request time
// with nothing but a warning. Fail here instead, where the defect names
// itself.
const modelCodes = registry.modelCodes && registry.modelCodes['nllb-200'];
if (!modelCodes) {
  throw new Error('The language registry has no "nllb-200" model-code table — the shipped registry and this map disagree');
}

module.exports = {
  modelName: 'nllb-200-distilled-600M',
  modelType: 'nllb',
  codeFormat: 'FLORES-200',

  // Language code mappings from ISO 639-1 to FLORES-200 format
  languageMap: { ...modelCodes },

  // NLLB-200 does not use prompt templates (direct model call)
  promptTemplate: null
};
