/**
 * NLLB-200 Language Map
 *
 * Model: facebook/nllb-200-distilled-600M
 * Code Format: FLORES-200 (language_script)
 * Model Type: nllb
 *
 * This model uses FLORES-200 language codes which combine language and script.
 * Full reference: https://huggingface.co/facebook/nllb-200-distilled-600M
 */

module.exports = {
  modelName: "nllb-200-distilled-600M",
  modelType: "nllb",
  codeFormat: "FLORES-200",

  // Language code mappings from ISO 639-1 to FLORES-200 format
  languageMap: {
    // Original 11 languages
    en: "eng_Latn", // English
    ar: "arb_Arab", // Arabic (Modern Standard)
    th: "tha_Thai", // Thai
    zh: "zho_Hans", // Chinese (Simplified)
    de: "deu_Latn", // German
    fr: "fra_Latn", // French
    id: "ind_Latn", // Indonesian
    es: "spa_Latn", // Spanish
    ru: "rus_Cyrl", // Russian
    pt: "por_Latn", // Portuguese
    sw: "swh_Latn", // Kiswahili

    // Newly added languages (total 34)
    am: "amh_Ethi", // Amharic
    az: "azj_Latn", // Azerbaijani (North/Latin)
    bn: "ben_Beng", // Bengali
    ckb: "ckb_Arab", // Sorani Kurdish (34th language)
    fa: "pes_Arab", // Persian (Farsi)
    ff: "fuv_Latn", // Fulah (Fulfulde)
    ha: "hau_Latn", // Hausa
    jv: "jav_Latn", // Javanese
    kk: "kaz_Cyrl", // Kazakh
    ku: "kmr_Latn", // Kurdish (Kurmanji/Latin)
    ml: "mal_Mlym", // Malayalam
    ms: "zsm_Latn", // Malay (uses zsm code)
    om: "gaz_Latn", // Oromo (West Central)
    pa: "pan_Guru", // Punjabi (Gurmukhi script)
    ps: "pbt_Arab", // Pashto
    sd: "snd_Arab", // Sindhi
    skr: "skr_Arab", // Saraiki
    so: "som_Latn", // Somali
    su: "sun_Latn", // Sundanese
    tr: "tur_Latn", // Turkish
    ug: "uig_Arab", // Uyghur
    ur: "urd_Arab", // Urdu
    uz: "uzn_Latn", // Uzbek (Northern/Latin)
    yo: "yor_Latn", // Yoruba

    // Newly added languages - Mandinka and Sesotho
    man: "dyu_Latn", // Mandinka (using Dyula as linguistic proxy - Mande language family)
    mnk: "dyu_Latn", // Mandinka (alternative ISO code - maps to same Dyula proxy)
    st: "sot_Latn", // Sesotho (Southern Sotho)
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
    ckb: "ar", // Sorani Kurdish → Arabic
    // Horn of Africa fallbacks
    om: "sw",
    so: "sw",
    // Other fallbacks
    am: "en", // Amharic to English
    az: "tr", // Azerbaijani to Turkish
    bn: "en", // Bengali to English
    ml: "en", // Malayalam to English
    // Newly added fallbacks
    man: "en", // Mandinka to English (proxy language may have quality issues)
    mnk: "en", // Mandinka (alternative code) to English
    st: "en", // Sesotho to English
  },

  // NLLB-200 does not use prompt templates (direct model call)
  promptTemplate: null,
};
