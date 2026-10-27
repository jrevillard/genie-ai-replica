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

module.exports = {
  modelName: 'translategemma-4b-it',
  modelType: 'gemma',
  codeFormat: 'ISO-639-1',

  // Language code mappings from ISO 639-1 to ISO 639-1 (identity mapping for this model)
  // TranslateGemma supports 55 languages, we map our 41 languages here
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

    // Newly added languages (total 41)
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
    ckb: 'ckb', // Sorani Kurdish

    // Newly added languages - Mandinka and Sesotho
    man: 'man', // Mandinka (ISO 639-2)
    mnk: 'mnk', // Mandinka (ISO 639-3)
    st: 'st', // Sesotho
    hi: 'hi', // Hindi
    ja: 'ja', // Japanese
    ko: 'ko' // Korean
  },

  // TranslateGemma uses structured chat format, not prompt templates
  promptTemplate: null
};
