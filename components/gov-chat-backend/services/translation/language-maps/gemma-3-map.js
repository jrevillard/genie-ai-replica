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

module.exports = {
  modelName: 'gemma-3-4b-it',
  modelType: 'gemma',
  codeFormat: 'ISO-639-1',

  // Language code mappings from ISO 639-1 to ISO 639-1 (identity mapping)
  // Gemma-3 supports multilingual tasks via prompting
  languageMap: {
    // Original 11 languages
    en: 'en', // English
    ar: 'ar', // Arabic
    th: 'th', // Thai
    zh: 'zh', // Chinese
    de: 'de', // German
    fr: 'fr', // French
    id: 'id', // Indonesian
    es: 'es', // Spanish
    ru: 'ru', // Russian
    pt: 'pt', // Portuguese
    sw: 'sw', // Kiswahili

    // Newly added languages (total 34)
    am: 'am', // Amharic
    az: 'az', // Azerbaijani
    bn: 'bn', // Bengali
    fa: 'fa', // Persian (Farsi)
    ff: 'ff', // Fulah
    ha: 'ha', // Hausa
    jv: 'jv', // Javanese
    kk: 'kk', // Kazakh
    ku: 'ku', // Kurdish (Kurmanji)
    ml: 'ml', // Malayalam
    ms: 'ms', // Malay
    om: 'om', // Oromo
    pa: 'pa', // Punjabi
    ps: 'ps', // Pashto
    sd: 'sd', // Sindhi
    skr: 'skr', // Saraiki
    so: 'so', // Somali
    su: 'su', // Sundanese
    tr: 'tr', // Turkish
    ug: 'ug', // Uyghur
    ur: 'ur', // Urdu
    uz: 'uz', // Uzbek
    yo: 'yo', // Yoruba
    ckb: 'ckb', // Sorani Kurdish (34th language)

    // Newly added languages - Mandinka and Sesotho
    man: 'man', // Mandinka (ISO 639-2)
    mnk: 'mnk', // Mandinka (ISO 639-3)
    st: 'st' // Sesotho
  },

  // Language fallback chains for graceful degradation
  fallbackMap: {
    // West African languages fallback to Swahili (regional lingua franca)
    ff: 'sw',
    ha: 'sw',
    yo: 'sw',
    // South Asian fallbacks
    skr: 'ur',
    sd: 'ur',
    pa: 'ur',
    // Central Asian fallbacks
    kk: 'tr',
    uz: 'tr',
    ug: 'tr',
    // Southeast Asian fallbacks
    ms: 'id',
    su: 'id',
    jv: 'id',
    // Middle Eastern fallbacks
    ps: 'fa',
    ku: 'fa',
    ckb: 'ar', // Sorani → Arabic
    // Horn of Africa fallbacks
    om: 'sw',
    so: 'sw',
    // Other fallbacks
    am: 'en', // Amharic to English
    az: 'tr', // Azerbaijani to Turkish
    bn: 'en', // Bengali to English
    ml: 'en', // Malayalam to English
    // Newly added fallbacks
    man: 'en', // Mandinka to English
    mnk: 'en', // Mandinka (alternative code) to English
    st: 'en' // Sesotho to English
  },

  // Gemma-3 requires prompt-based translation
  promptTemplate: (sourceCode, targetCode, sourceLangName, targetLangName, text) => {
    return `Translate the following text from ${sourceLangName} to ${targetLangName}. Only return the translation, no explanation.\n\nText: ${text}`;
  },

  // Language names for prompt generation
  languageNames: {
    en: 'English',
    ar: 'Arabic',
    th: 'Thai',
    zh: 'Chinese',
    de: 'German',
    fr: 'French',
    id: 'Indonesian',
    es: 'Spanish',
    ru: 'Russian',
    pt: 'Portuguese',
    sw: 'Kiswahili',
    am: 'Amharic',
    az: 'Azerbaijani',
    bn: 'Bengali',
    fa: 'Persian',
    ff: 'Fulah',
    ha: 'Hausa',
    jv: 'Javanese',
    kk: 'Kazakh',
    ku: 'Kurdish',
    ml: 'Malayalam',
    ms: 'Malay',
    om: 'Oromo',
    pa: 'Punjabi',
    ps: 'Pashto',
    sd: 'Sindhi',
    skr: 'Saraiki',
    so: 'Somali',
    su: 'Sundanese',
    tr: 'Turkish',
    ug: 'Uyghur',
    ur: 'Urdu',
    uz: 'Uzbek',
    yo: 'Yoruba',
    ckb: 'Sorani Kurdish',
    // Newly added language names
    man: 'Mandinka',
    mnk: 'Mandinka',
    st: 'Sesotho'
  }
};
