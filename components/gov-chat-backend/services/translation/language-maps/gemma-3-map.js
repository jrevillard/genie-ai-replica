/**
 * Gemma-3 Language Map
 *
 * Model: google/gemma-3-4b-it or google/gemma-3-1b-it
 * Code Format: ISO 639-1 (2-letter codes)
 * Model Type: gemma
 *
 * Gemma-3 is a general-purpose LLM that can be used for translation via prompt engineering.
 * It uses ISO 639-1 language codes.
 * Reference: https://huggingface.co/google/gemma-3-4b-it
 *
 * The languages, the codes the model is asked for and the language names all
 * come from the language registry (language-registry.json), the single source
 * of the language list shared with the chatqna service. This module only adds
 * what is specific to the model: its name, its type, its code format and the
 * prompt template.
 *
 * Request format:
 * {
 *   model: "google/gemma-3-4b-it",
 *   messages: [{
 *     role: "user",
 *     content: "Translate the following text from English to French. Only return the translation, no explanation.\n\nText: Hello"
 *   }],
 *   temperature: 0.3,
 *   max_tokens: 4096
 * }
 */

const registry = require('./language-registry.json');

// A registry without this model's table would spread into an empty map: the
// module would load, and every language would be refused at request time
// with nothing but a warning. Fail here instead, where the defect names
// itself.
const modelCodes = registry.modelCodes && registry.modelCodes['gemma-3'];
if (!modelCodes) {
  throw new Error('The language registry has no "gemma-3" model-code table — the shipped registry and this map disagree');
}

// Language names for prompt generation, from the registry's single source
const languageNames = Object.fromEntries(
  Object.entries(registry.languages).map(([code, language]) => [code, language.name])
);

module.exports = {
  modelName: 'gemma-3-4b-it',
  modelType: 'gemma',
  codeFormat: 'ISO-639-1',

  // Language code mappings from ISO 639-1 to ISO 639-1 (identity mapping)
  // Gemma-3 supports multilingual tasks via prompting
  languageMap: { ...modelCodes },

  // Gemma-3 requires prompt-based translation
  promptTemplate: (sourceCode, targetCode, sourceLangName, targetLangName, text) => {
    return `Translate the following text from ${sourceLangName} to ${targetLangName}. Only return the translation, no explanation.\n\nText: ${text}`;
  },

  languageNames
};
