/**
 * AMINA Care — i18n initializer
 * ================================
 * Wires react-i18next with:
 *   - Four locales: en (English), ma (Mandinka), fr (French), ar (Arabic)
 *   - Browser language detection (navigator.language) falling back to en
 *   - Persistent choice in localStorage (AMINA_LANG)
 *   - Document-level RTL flip for Arabic via document.dir + data-attr
 *
 * Scope
 * -----
 * We intentionally DO NOT touch existing components (App.jsx, BeginnerShell,
 * BasicShell, EmergencyAlert, etc.) — their strings stay in English until
 * a future, scheduled retrofit. This module covers:
 *   - Layers added this session (Inbox, Forms, Scribe, ModelSwitchBanner)
 *   - Anything new going forward
 *
 * For components that ARE bilingual through the agent API (chat replies),
 * the language parameter still flows through the existing chat body's
 * `language` field. This file doesn't change that flow — it's UI-chrome
 * only.
 *
 * RTL handling
 * ------------
 * When the active language is RTL (ar), we set:
 *     document.documentElement.dir = "rtl"
 *     document.body.dataset.lang = "ar"
 * CSS in `i18n.css` keys off `body[data-lang="ar"]` (or `html[dir="rtl"]`)
 * to flip paddings/margins for our added components. Existing components
 * retain their LTR layout — they simply ignore the attribute. In practice
 * this means text in mode switchers and overlays reads RTL while the
 * shell chrome stays fixed — an acceptable MVP trade.
 */

import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import ma from "./locales/ma.json";
// fr.json + ar.json are kept on disk for future re-enable but are not
// imported or registered while the active picker is English + Mandinka.

export const SUPPORTED_LANGS = ["en", "ma"];
// No currently-active RTL language; kept as array so the RTL helpers in
// this file (`isRTL`, applyHtmlDirection) still work if Arabic is
// re-enabled later by adding "ar" to SUPPORTED_LANGS + the resources block.
export const RTL_LANGS       = [];
export const LANG_STORAGE    = "AMINA_LANG";

export const LANG_META = {
  en: { name: "English",   nativeName: "English",   flag: "🇬🇧" },
  ma: { name: "Mandinka",  nativeName: "Mandingka", flag: "🇬🇲" },
};


// Keep React on the happy path even if this module is imported on a
// server-rendering preview: bail cleanly when window is missing.
const isBrowser = typeof window !== "undefined";


i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { common: en },
      ma: { common: ma },
    },
    ns: ["common"],
    defaultNS: "common",
    fallbackLng: "en",
    supportedLngs: SUPPORTED_LANGS,
    nonExplicitSupportedLngs: true,
    interpolation: {
      escapeValue: false,            // React already escapes
    },
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      lookupLocalStorage: LANG_STORAGE,
      caches: ["localStorage"],
    },
    returnEmptyString: false,
  });


export function isRTL(lng) {
  return RTL_LANGS.includes(normalizeLng(lng));
}

export function normalizeLng(lng) {
  if (!lng) return "en";
  const short = String(lng).toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LANGS.includes(short) ? short : "en";
}


// Bind document-level dir + lang on every language change. Also set a
// `data-lang` attribute on <body> so our CSS hooks can target individual
// locales (e.g. force a different font for Arabic).
function applyHtmlDirection(lng) {
  if (!isBrowser || !document?.documentElement) return;
  const n = normalizeLng(lng);
  const rtl = isRTL(n);
  try {
    document.documentElement.dir = rtl ? "rtl" : "ltr";
    document.documentElement.lang = n;
    if (document.body) {
      document.body.dataset.lang = n;
      document.body.dataset.dir  = rtl ? "rtl" : "ltr";
    }
  } catch {
    /* noop */
  }
}

// Apply now (handles the initial detected language), and re-apply on every
// future language change.
if (isBrowser) {
  applyHtmlDirection(i18n.language);
  i18n.on("languageChanged", applyHtmlDirection);
}

/**
 * Change the active language. Persists to localStorage, flips document.dir,
 * fires the "amina:lang-changed" window event so non-React listeners can
 * react (e.g. analytics, body CSS overrides).
 */
export async function setLanguage(lng) {
  const n = normalizeLng(lng);
  try {
    await i18n.changeLanguage(n);
    if (isBrowser) {
      try { localStorage.setItem(LANG_STORAGE, n); } catch { /* ignore */ }
      window.dispatchEvent(new CustomEvent("amina:lang-changed", { detail: { lng: n } }));
    }
    return n;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("amina i18n: changeLanguage failed", e);
    return i18n.language;
  }
}

export default i18n;
