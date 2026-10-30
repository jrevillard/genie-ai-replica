/**
 * TranslateGemma Language Map
 *
 * Model: google/translategemma-4b-it
 * Code Format: ISO 639-1 (2-letter codes)
 * Model Type: gemma
 *
 * This is a purpose-built translation model that uses ISO 639-1 language codes.
 * Reference: https://huggingface.co/google/translategemma-4b-it
 *
 * The languages and the codes the model is asked for come from the language
 * registry (language-registry.json), the single source of the language list
 * shared with the chatqna service. This module only adds what is specific to
 * the model: its name, its type, its code format.
 *
 * Request format:
 * {
 *   role: "user",
 *   content: [{
 *     type: "text",
 *     source_lang_code: "en",  // ISO 639-1
 *     target_lang_code: "fr",  // ISO 639-1
 *     text: "Hello, world"
 *   }]
 * }
 */

const registry = require('./language-registry.json');

module.exports = {
  modelName: 'translategemma-4b-it',
  modelType: 'gemma',
  codeFormat: 'ISO-639-1',

  // Language code mappings from ISO 639-1 to ISO 639-1 (identity mapping for this model)
  // TranslateGemma supports 55 languages, we map our supported languages here
  languageMap: { ...registry.modelCodes['translategemma'] },

  // TranslateGemma uses structured chat format, not prompt templates
  promptTemplate: null
};
