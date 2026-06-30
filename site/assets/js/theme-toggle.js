// Theme persistence hook (Task 5).
//
// Docsy's vendor dark-mode.js (Bootstrapped from twbs/examples color-modes) reads
// the OS preference and a UI toggle, persisting the value in localStorage under
// the key `td-color-theme` and applying it to <html> as the `data-bs-theme`
// attribute (Bootstrap 5.3 color modes — values: "light" | "dark" | "auto").
//
// This script is a no-op safety net for two real failure modes:
//   1. Docsy's UI dark-mode toggle is disabled by a config drift — we still
//      honour an explicit user choice.
//   2. The user closes the tab on dark and reopens before Docsy's async module
//      loads — the inline IIFE below applies the stored theme synchronously on
//      parse, eliminating the flash-of-light-content (FOLC).
//
// It targets `data-bs-theme` (Docsy's actual mechanism, verified against the
// pinned module cfc902046af7), not the legacy `data-theme` or `html.dark`.

(function () {
  const STORAGE_KEY = 'td-color-theme';   // align with Docsy's own key
  const HTML = document.documentElement;

  function apply(theme) {
    if (theme === 'dark' || theme === 'light') {
      HTML.setAttribute('data-bs-theme', theme);
    }
  }

  // 1. No-FOLC inline apply — runs synchronously before body paints.
  //    Only override the system preference when the user has chosen explicitly.
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') {
      apply(stored);
    }
  } catch (_) {
    // localStorage may be unavailable (private mode); fall back to system.
  }

  // 2. Mutation observer — if Docsy's toggle UI changes data-bs-theme at runtime,
  //    persist the new value so the next page load honours it. Idempotent:
  //    writing back the same value Docsy already set is a no-op.
  function startObserver() {
    if (typeof MutationObserver === 'undefined') return;
    let writing = false;  // reentrancy guard
    const obs = new MutationObserver(function (mutations) {
      if (writing) return;
      for (const m of mutations) {
        if (m.attributeName !== 'data-bs-theme') continue;
        const current = HTML.getAttribute('data-bs-theme');
        if (current === 'dark' || current === 'light') {
          writing = true;
          try { localStorage.setItem(STORAGE_KEY, current); } catch (_) {}
          writing = false;
        }
      }
    });
    obs.observe(HTML, { attributes: true, attributeFilter: ['data-bs-theme'] });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }
})();
