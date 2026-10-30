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

const { modelCodes } = require('./language-registry');

module.exports = {
  modelName: 'nllb-200-distilled-600M',
  modelType: 'nllb',
  codeFormat: 'FLORES-200',

  // Language code mappings from ISO 639-1 to FLORES-200 format
  languageMap: { ...modelCodes('nllb-200') },

  // NLLB-200 does not use prompt templates (direct model call)
  promptTemplate: null
};
