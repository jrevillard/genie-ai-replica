/**
 * I18nBootstrap
 * =================
 * Self-mounting root for the language picker + side-effect bootstrap of
 * i18next (via `./index.js` import) and the RTL CSS helpers.
 *
 * Follows the same pattern as InboxBootstrap / ResilienceBootstrap /
 * ScribeBootstrap:
 *   - Imports i18n/index.js for its side effects (init, detector,
 *     document.dir sync).
 *   - Injects its own DOM node + React root (#amina-language-picker-root).
 *   - Idempotent via window.__aminaI18nMounted.
 */

import { createRoot } from "react-dom/client";
import "./index.js";              // side-effect: initializes i18next
import "./i18n.css";               // side-effect: Arabic font + RTL flips
import LanguagePicker from "./LanguagePicker.jsx";
import { startAutoTranslator } from "./autoTranslator.js";

const ROOT_ID = "amina-language-picker-root";

function mountI18n() {
  if (typeof window === "undefined") return;
  if (window.__aminaI18nMounted) return;
  window.__aminaI18nMounted = true;

  const attach = () => {
    try {
      if (document.getElementById(ROOT_ID)) return;
      const host = document.createElement("div");
      host.id = ROOT_ID;
      document.body.appendChild(host);
      createRoot(host).render(<LanguagePicker />);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("I18nBootstrap mount failed:", e);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach);
  } else {
    attach();
  }

  // Auto-translate legacy (un-wrapped) components. No-op when lang==="en".
  // Runs after the React app has mounted so the initial sweep sees real
  // rendered content.
  try {
    const kick = () => {
      try { startAutoTranslator(); } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("autoTranslator init failed:", e);
      }
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", kick);
    } else {
      // Let React finish its first commit before we start observing
      setTimeout(kick, 50);
    }
  } catch { /* noop */ }
}

mountI18n();
