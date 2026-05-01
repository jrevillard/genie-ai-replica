/**
 * autoTranslator — whole-page DOM translation for legacy components.
 * ====================================================================
 *
 * Why this exists
 * ---------------
 * The canonical path for new components is react-i18next + per-string
 * `t("...")` wrapping. But Amina's legacy shells (App.jsx, BeginnerChat,
 * BeginnerShell, BasicShell, CaregiverPortal, EmergencyAlert,
 * AdminDashboard) contain thousands of hardcoded English strings across
 * 22 000+ lines of JSX. Wrapping each one would be a multi-week retrofit.
 *
 * This module observes the DOM and, when the active language is not
 * English, batch-translates every user-visible text node via the
 * existing `/api/v1/agent/translate/batch` endpoint (Redis-cached
 * server-side, 30-day TTL). Translations are also cached in
 * localStorage on the client. React re-renders are handled via a
 * MutationObserver — every text node committed by React is re-checked
 * and translated if necessary.
 *
 * Pattern used by:
 *   - WeGlot / TranslatePress (WordPress)
 *   - Crowdin In-Context
 *   - Google Translate Widget (legacy)
 *
 * Design constraints
 * ------------------
 *   - Never mutate the DOM when language is English (module is a no-op)
 *   - Preserve React's virtual DOM by tagging translated nodes with a
 *     data attribute on their parent element + tracking the original
 *     English for re-translation on language change.
 *   - Exclude: <input>, <textarea>, <script>, <style>, <code>, <pre>,
 *     [contenteditable="true"], [data-notranslate], the language picker
 *     itself, and any subtree with data-amina-notranslate.
 *   - Skip text nodes that are purely whitespace / numbers / emoji.
 *   - Rate-limited: at most one batch request per 250ms to coalesce the
 *     storm of mutations React emits during first paint.
 *   - Safe fallback: if translation fails, original English is preserved.
 */

import i18n from "./index.js";

const LS_PREFIX = "amina.autotr.v1.";

// DOM selectors that should never be translated
const EXCLUDE_SELECTORS = [
  "input", "textarea", "select", "option",
  "script", "style", "code", "pre", "kbd", "samp",
  "[contenteditable='true']",
  "[data-notranslate]",
  "[data-amina-notranslate]",
  "[aria-live]",                     // dynamic status regions (noisy)
  "#amina-language-picker-root",     // our own toggle UI
  "#amina-role-switcher-root",
  ".amina-lang-picker",              // defensive
].join(", ");

// Regexes used to skip text that isn't worth translating
const RX_WS_ONLY    = /^\s*$/;
const RX_NUMERIC    = /^\s*[\d.,:\-+/%*#$€£¥]+\s*$/;
const RX_EMOJI_ONLY = /^[\s\u2000-\u206F\u2700-\u27BF\u1F300-\u1F9FF\u1F600-\u1F64F\u1F400-\u1F4FF\u2600-\u26FF]+$/u;
const RX_HAS_LETTER = /[A-Za-z]/;

// Attributes we also translate (button/link title, aria-label, placeholder)
const TRANSLATABLE_ATTRS = ["placeholder", "aria-label", "title", "alt"];

// API config
const ENDPOINT = "/api/v1/agent/translate/batch";
function apiBase() {
  try {
    const w = typeof window !== "undefined" ? window.__AMINA_API_BASE__ : null;
    return w ? String(w).replace(/\/+$/, "") : "";
  } catch { return ""; }
}

// Singleton state
const state = {
  lang:     "en",
  cache:    {},                     // { en_text: translated_text }
  pending:  new Map(),              // en_text → Set<(translated) => void> callbacks
  timer:    null,
  observer: null,
  enabled:  false,
  lastFlushAt: 0,
};

function loadCache(lang) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + lang);
    return raw ? JSON.parse(raw) || {} : {};
  } catch { return {}; }
}
function saveCache(lang) {
  try { localStorage.setItem(LS_PREFIX + lang, JSON.stringify(state.cache)); }
  catch {}
}

function shouldTranslateText(text) {
  if (!text) return false;
  if (RX_WS_ONLY.test(text))    return false;
  if (RX_NUMERIC.test(text))    return false;
  if (RX_EMOJI_ONLY.test(text)) return false;
  if (!RX_HAS_LETTER.test(text)) return false;
  if (text.length < 2)          return false;
  if (text.length > 1200)       return false;   // probably content body, expensive
  return true;
}

function isInsideExcludedSubtree(node) {
  if (!node) return true;
  let el = node.nodeType === 1 ? node : node.parentElement;
  while (el && el !== document.body) {
    try { if (el.matches && el.matches(EXCLUDE_SELECTORS)) return true; }
    catch {}
    el = el.parentElement;
  }
  return false;
}

/**
 * Walk the subtree rooted at `root` and collect text nodes + attribute
 * targets that still need translating. For each, either apply a cached
 * translation immediately, or queue it for the next batch flush.
 */
function scanAndTranslate(root) {
  if (!state.enabled) return;
  if (!root) return;
  if (isInsideExcludedSubtree(root)) return;

  // Text nodes
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (isInsideExcludedSubtree(node)) return NodeFilter.FILTER_REJECT;
        const t = node.nodeValue;
        if (!shouldTranslateText(t)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );
  let n;
  const nodesToWatch = [];
  while ((n = walker.nextNode())) nodesToWatch.push(n);
  for (const textNode of nodesToWatch) {
    applyOrQueue(textNode, "text");
  }

  // Attributes
  if (root.nodeType === 1) {
    for (const attr of TRANSLATABLE_ATTRS) {
      const els = root.querySelectorAll ? root.querySelectorAll(`[${attr}]`) : [];
      if (root.matches && root.matches(`[${attr}]`)) {
        applyOrQueueAttr(root, attr);
      }
      for (const el of els) {
        if (isInsideExcludedSubtree(el)) continue;
        applyOrQueueAttr(el, attr);
      }
    }
  }
}

function applyOrQueue(textNode, kind) {
  // Use a stable key: the ORIGINAL English text. We stash it on the
  // parent element on first sight so later renders can re-translate
  // the same node even if React commits a different text in the same
  // slot (it can't — React replaces the text node entirely — but
  // defensive anyway).
  const parent = textNode.parentNode;
  if (!parent) return;
  const key = textNode.__aminaTrOrig || textNode.nodeValue;
  if (!shouldTranslateText(key)) return;

  if (!textNode.__aminaTrOrig) textNode.__aminaTrOrig = key;

  const translated = state.cache[key];
  if (translated && translated !== key) {
    // Guard: only update if node still holds the original (i.e. not
    // already translated). Avoids clobbering a React-committed update.
    if (textNode.nodeValue === key || textNode.nodeValue === translated) {
      try { textNode.nodeValue = translated; } catch {}
    }
    return;
  }

  enqueue(key);
}

function applyOrQueueAttr(el, attr) {
  const orig = el.getAttribute(attr);
  if (!shouldTranslateText(orig)) return;

  // BUG-036 fix: the inner cache check used to be
  //   (dataset.aminaTrAttrOrig + "|" + attr) in state.cache
  // -- which always missed, because cache keys are stored under just
  // the original text (no "|attr" suffix). That meant every attribute
  // re-render re-translated the same string. Now the check uses the
  // same key shape as state.cache. Parens are explicit so future
  // precedence shifts can't quietly break it again.
  const origKey = el.dataset.aminaTrAttrOrig
    ? ((el.dataset.aminaTrAttrOrig in state.cache) ? el.dataset.aminaTrAttrOrig : orig)
    : orig;
  el.dataset.aminaTrAttrOrig = origKey;

  const translated = state.cache[origKey];
  if (translated && translated !== origKey) {
    if (el.getAttribute(attr) === origKey || el.getAttribute(attr) === translated) {
      try { el.setAttribute(attr, translated); } catch {}
    }
    return;
  }
  enqueue(origKey);
}

function enqueue(text) {
  if (state.cache[text]) return;                // already cached
  if (state.pending.has(text)) return;          // already queued
  state.pending.set(text, true);
  scheduleFlush();
}

function scheduleFlush() {
  if (state.timer) return;
  state.timer = setTimeout(flush, 250);  // coalesce React-commit storm
}

async function flush() {
  state.timer = null;
  if (!state.enabled) { state.pending.clear(); return; }
  if (state.pending.size === 0) return;

  const batch = Array.from(state.pending.keys()).slice(0, 200);
  for (const t of batch) state.pending.delete(t);

  const texts = {};
  batch.forEach((s) => { texts[s] = s; });

  try {
    const resp = await fetch(`${apiBase()}${ENDPOINT}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts, source: "en", target: state.lang }),
    });
    if (resp.ok) {
      const data = await resp.json();
      const translations = (data && data.translations) || {};
      let any = false;
      for (const k of Object.keys(translations)) {
        const v = translations[k];
        if (v && v !== k && v !== state.cache[k]) {
          state.cache[k] = v;
          any = true;
        }
      }
      if (any) {
        saveCache(state.lang);
        // Re-scan the whole body: any text node holding an untranslated
        // original will now pick up the cached translation.
        scanAndTranslate(document.body);
      }
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.debug("autoTranslator: batch failed", e);
  }

  // Drain remaining pending on next tick if we hit the 200-cap
  if (state.pending.size > 0) scheduleFlush();
}


/**
 * Observe DOM mutations anywhere under <body> and translate new text.
 */
function startObserver() {
  if (state.observer) return;
  state.observer = new MutationObserver((muts) => {
    if (!state.enabled) return;
    for (const m of muts) {
      if (m.type === "childList") {
        for (const n of m.addedNodes) {
          scanAndTranslate(n);
        }
      } else if (m.type === "characterData") {
        const node = m.target;
        if (node && node.nodeType === 3) {
          // A text node's content changed — if React re-wrote it to the
          // original English, translate again. We detect this by
          // comparing the current value to the previously-recorded
          // "original" stashed on the node.
          if (!node.__aminaTrOrig) node.__aminaTrOrig = node.nodeValue;
          applyOrQueue(node, "text");
        }
      } else if (m.type === "attributes") {
        const el = m.target;
        if (el && el.nodeType === 1 && TRANSLATABLE_ATTRS.includes(m.attributeName)) {
          applyOrQueueAttr(el, m.attributeName);
        }
      }
    }
  });
  state.observer.observe(document.body, {
    childList:        true,
    subtree:          true,
    characterData:    true,
    attributes:       true,
    attributeFilter:  TRANSLATABLE_ATTRS,
  });
}

function stopObserver() {
  if (state.observer) {
    try { state.observer.disconnect(); } catch {}
    state.observer = null;
  }
}


/**
 * Revert every translated node back to its original English. Used on
 * language change from non-English → English.
 */
function revertToOriginals() {
  try {
    const walker = document.createTreeWalker(
      document.body, NodeFilter.SHOW_TEXT, null
    );
    let n;
    while ((n = walker.nextNode())) {
      if (n.__aminaTrOrig && n.nodeValue !== n.__aminaTrOrig) {
        try { n.nodeValue = n.__aminaTrOrig; } catch {}
      }
    }
    const attrEls = document.querySelectorAll("[data-amina-tr-attr-orig]");
    attrEls.forEach((el) => {
      for (const attr of TRANSLATABLE_ATTRS) {
        const orig = el.dataset.aminaTrAttrOrig;
        if (orig && el.hasAttribute(attr)) {
          try { el.setAttribute(attr, orig); } catch {}
        }
      }
    });
  } catch {}
}


export function startAutoTranslator() {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const apply = () => {
    const lang = ((i18n.language) || "en").split(/[-_]/)[0];
    if (lang === state.lang) return;

    // Language actually changed — tear down old state, switch
    if (state.lang !== "en") revertToOriginals();
    state.lang    = lang;
    state.cache   = lang === "en" ? {} : loadCache(lang);
    state.pending.clear();
    if (state.timer) { clearTimeout(state.timer); state.timer = null; }

    if (lang === "en") {
      state.enabled = false;
      stopObserver();
      return;
    }

    state.enabled = true;
    startObserver();
    // Initial sweep of everything on screen
    if (document.body) scanAndTranslate(document.body);
  };

  // Initial apply + listen for future changes
  apply();
  i18n.on("languageChanged", apply);
  window.addEventListener("amina:lang-changed", apply);
}
