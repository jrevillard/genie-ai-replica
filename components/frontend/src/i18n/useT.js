/**
 * useT — drop-in i18n hook for legacy components.
 * ==================================================
 *
 * Why this exists
 * ---------------
 * The canonical path for new components is react-i18next + `en.json`/`ma.json`.
 * But the existing large shells (App.jsx, BeginnerChat, BeginnerShell,
 * BasicShell, CaregiverPortal, EmergencyAlert, AdminDashboard, …) contain
 * thousands of hardcoded English strings across 20k+ lines. Wiring each
 * one into `common.json` would be weeks of work and most strings are
 * rarely-seen edge-case labels.
 *
 * `useT` gives those components a minimal-integration path:
 *
 *   import { useT } from "./i18n/useT";
 *   function MyComponent() {
 *     const t = useT();
 *     return <button>{t("Send")}</button>;
 *   }
 *
 * No separate keys catalog: the English text IS the key. The hook
 * batches all strings collected at render time into a single call to
 * the existing `/api/v1/agent/translate/batch` endpoint (which is
 * Redis-cached per-string for 30 days server-side + localStorage-cached
 * on the client). When the language changes, components re-render and
 * pick up the new translations from the cache.
 *
 * Performance notes
 * -----------------
 *   - When lang === "en", `t(x)` is the identity function — zero cost.
 *   - Translations are cached in localStorage under `amina.useT.v1.<lang>`.
 *   - First render in a new language shows English, then flips to
 *     translated after the batch call resolves (~500ms typical). Subsequent
 *     renders hit the cache instantly.
 *   - A singleton queue coalesces per-tick translation requests across
 *     components so we make one HTTP call per language change, not N.
 */

import { useEffect, useMemo, useState, useCallback } from "react";
import i18n from "./index.js";

const LS_PREFIX = "amina.useT.v1.";   // + lang → dict
const ENDPOINT  = "/api/v1/agent/translate/batch";

// API base — mirrors what other modules use.
function apiBase() {
  try {
    const fromWin = (typeof window !== "undefined" && window.__AMINA_API_BASE__) || "";
    if (fromWin) return String(fromWin).replace(/\/+$/, "");
  } catch {}
  return ""; // same-origin
}

function loadCache(lang) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + lang);
    if (raw) return JSON.parse(raw) || {};
  } catch {}
  return {};
}
function saveCache(lang, dict) {
  try {
    localStorage.setItem(LS_PREFIX + lang, JSON.stringify(dict));
  } catch {}
}

// Global state shared across all useT() consumers so we don't make N
// parallel requests and so a translation resolved for one component
// instantly renders for all others that share the string.
const state = {
  caches:   {},                 // lang → { en_text: translated_text }
  pending:  new Set(),          // strings waiting to be translated (current lang)
  flushing: false,              // true while a batch request is in flight
  subs:     new Set(),          // subscriber callbacks for re-render
  curLang:  null,               // language the pending batch targets
};

function getCache(lang) {
  if (!state.caches[lang]) state.caches[lang] = loadCache(lang);
  return state.caches[lang];
}

function notify() {
  for (const fn of state.subs) {
    try { fn(); } catch {}
  }
}

async function flushPending() {
  if (state.flushing) return;
  const lang = state.curLang;
  if (!lang || lang === "en") { state.pending.clear(); return; }

  const toSend = Array.from(state.pending);
  state.pending.clear();
  if (toSend.length === 0) return;

  state.flushing = true;
  try {
    const texts = {};
    toSend.forEach((t) => { texts[t] = t; });
    const base = apiBase();
    const resp = await fetch(`${base}${ENDPOINT}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ texts, source: "en", target: lang }),
    });
    if (resp.ok) {
      const data = await resp.json();
      const translations = (data && data.translations) || {};
      const cache = getCache(lang);
      let changed = false;
      for (const key of Object.keys(translations)) {
        const val = translations[key];
        if (val && val !== cache[key]) {
          cache[key] = val;
          changed = true;
        }
      }
      if (changed) {
        saveCache(lang, cache);
        notify();
      }
    }
  } catch (e) {
    // Silent — fall back to English renders.
    // eslint-disable-next-line no-console
    console.debug("useT: batch translate failed", e);
  } finally {
    state.flushing = false;
    // If more strings piled up while the request was in flight, flush them.
    if (state.pending.size > 0) {
      setTimeout(flushPending, 0);
    }
  }
}

function queueTranslate(lang, text) {
  if (!text || lang === "en") return;
  if (state.curLang !== lang) {
    // Language changed mid-flight — reset pending set
    state.pending.clear();
    state.curLang = lang;
  }
  const cache = getCache(lang);
  if (cache[text]) return;   // already translated
  if (state.pending.has(text)) return;
  state.pending.add(text);
  // Debounce flush: coalesce all strings queued in this tick
  if (!state.flushing) {
    Promise.resolve().then(() => {
      // Still same tick? flush.
      if (state.pending.size > 0) flushPending();
    });
  }
}


/**
 * Hook returning a translator function.
 *
 *   const t = useT();
 *   return <button>{t("Send")}</button>;
 *
 * `t(text)` returns the translated string for the current active
 * language, or the original text if:
 *   - current language is English
 *   - translation is not yet cached (first render — will fill in shortly)
 *   - the translation service is unavailable
 *
 * Second argument `fallback` is used if provided instead of the original
 * text — useful when the English literal contains placeholders the
 * translator shouldn't see:
 *
 *   t("Hello, {{name}}", "Hello, friend")
 */
export function useT() {
  const [, bump] = useState(0);

  // Subscribe to language + cache-updated events
  useEffect(() => {
    const rerender = () => bump((n) => n + 1);
    state.subs.add(rerender);
    const onLang = () => rerender();
    if (typeof window !== "undefined") {
      window.addEventListener("amina:lang-changed", onLang);
    }
    i18n.on("languageChanged", onLang);
    return () => {
      state.subs.delete(rerender);
      if (typeof window !== "undefined") {
        window.removeEventListener("amina:lang-changed", onLang);
      }
      i18n.off("languageChanged", onLang);
    };
  }, []);

  const lang = (i18n.language || "en").split(/[-_]/)[0];
  const cache = lang === "en" ? null : getCache(lang);

  return useCallback(
    (text, fallback) => {
      const src = typeof text === "string" ? text : String(text ?? "");
      if (!src || lang === "en") return src;
      const cached = cache && cache[src];
      if (cached) return cached;
      // Queue for background translation; return English until it arrives
      queueTranslate(lang, src);
      return fallback != null ? fallback : src;
    },
    [lang, cache]
  );
}


/**
 * Read the current active language short code (en / ma).
 */
export function useLang() {
  const [lang, setLang] = useState(
    ((typeof window !== "undefined" && i18n.language) || "en").split(/[-_]/)[0]
  );
  useEffect(() => {
    const onChange = () =>
      setLang(((i18n.language) || "en").split(/[-_]/)[0]);
    i18n.on("languageChanged", onChange);
    if (typeof window !== "undefined") {
      window.addEventListener("amina:lang-changed", onChange);
    }
    return () => {
      i18n.off("languageChanged", onChange);
      if (typeof window !== "undefined") {
        window.removeEventListener("amina:lang-changed", onChange);
      }
    };
  }, []);
  return lang;
}


/**
 * Non-hook helper for use inside event handlers / callbacks where hooks
 * can't be called. Returns cached translation if present, otherwise the
 * original — and queues a background fetch so the next render hits the
 * cache.
 */
export function tSync(text) {
  const lang = ((typeof window !== "undefined" && i18n.language) || "en").split(/[-_]/)[0];
  if (!text || lang === "en") return text;
  const cache = getCache(lang);
  if (cache[text]) return cache[text];
  queueTranslate(lang, text);
  return text;
}
