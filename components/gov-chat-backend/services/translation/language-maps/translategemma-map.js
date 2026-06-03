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
  modelName: "translategemma-4b-it",
  modelType: "gemma",
  codeFormat: "ISO-639-1",

  // Language code mappings from ISO 639-1 to ISO 639-1 (identity mapping for this model)
  // TranslateGemma supports 55 languages, we map our 34 languages here
  languageMap: {
    // Original 11 languages
    en: "en", // English
    ar: "ar", // Arabic
    th: "th", // Thai
    zh: "zh", // Chinese
    de: "de", // German
    fr: "fr", // French
    id: "id", // Indonesian
    es: "es", // Spanish
    ru: "ru", // Russian
    pt: "pt", // Portuguese
    sw: "sw", // Kiswahili

    // Newly added languages (total 34)
    am: "am", // Amharic
    az: "az", // Azerbaijani
    bn: "bn", // Bengali
    fa: "fa", // Persian (Farsi)
    ff: "ff", // Fulah
    ha: "ha", // Hausa
    jv: "jv", // Javanese
    kk: "kk", // Kazakh
    ku: "ku", // Kurdish (Kurmanji)
    ml: "ml", // Malayalam
    ms: "ms", // Malay
    om: "om", // Oromo
    pa: "pa", // Punjabi
    ps: "ps", // Pashto
    sd: "sd", // Sindhi
    skr: "skr", // Saraiki
    so: "so", // Somali
    su: "su", // Sundanese
    tr: "tr", // Turkish
    ug: "ug", // Uyghur
    ur: "ur", // Urdu
    uz: "uz", // Uzbek
    yo: "yo", // Yoruba
    ckb: "ckb", // Sorani Kurdish (34th language)

    // Newly added languages - Mandinka and Sesotho
    man: "man", // Mandinka (ISO 639-2)
    mnk: "mnk", // Mandinka (ISO 639-3)
    st: "st", // Sesotho
  },

  // Language fallback chains for graceful degradation
  fallbackMap: {
    // West African languages fallback to Swahili (regional lingua franca)
    ff: "sw",
    ha: "sw",
    yo: "sw",
    // South Asian fallbacks
    skr: "ur",
    sd: "ur",
    pa: "ur",
    // Central Asian fallbacks
    kk: "tr",
    uz: "tr",
    ug: "tr",
    // Southeast Asian fallbacks
    ms: "id",
    su: "id",
    jv: "id",
    // Middle Eastern fallbacks
    ps: "fa",
    ku: "fa",
    ckb: "ar", // Sorani → Arabic
    // Horn of Africa fallbacks
    om: "sw",
    so: "sw",
    // Other fallbacks
    am: "en", // Amharic to English
    az: "tr", // Azerbaijani to Turkish
    bn: "en", // Bengali to English
    ml: "en", // Malayalam to English
    // Newly added fallbacks
    man: "en", // Mandinka to English
    mnk: "en", // Mandinka (alternative code) to English
    st: "en", // Sesotho to English
  },

  // TranslateGemma uses structured chat format, not prompt templates
  promptTemplate: null,
};
