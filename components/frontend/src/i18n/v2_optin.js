/**
 * v2_optin.js — client-side opt-in for the v2 translation pipeline.
 *
 * When the localStorage flag `amina_use_v2` is set to "1" or "true",
 * every fetch this tab makes to /api/v1/agent/translate or
 * /api/v1/agent/translate/batch gets the header
 * `X-Translation-Pipeline: v2` injected. The backend's v1 shim
 * middleware (src/translation_v2/api/v1_compat.py) picks that up and
 * routes through the v2 Router for that single request — no backend
 * flag change required.
 *
 * This module is a side-effect import. Include it once from main.jsx;
 * it installs a fetch wrapper idempotently and is inert unless the
 * flag is set.
 *
 * DevTools console controls:
 *   window.__aminaUseV2(true)    enable v2 for this tab
 *   window.__aminaUseV2(false)   disable
 *   window.__aminaUseV2()        query current state
 *
 * Works for all five frontend translate call sites:
 *   - i18n/autoTranslator.js          (top English/Mandinka toggle)
 *   - i18n/useT.js                    (per-component translations)
 *   - BeginnerChat.jsx                (per-message "Mandinka" button)
 *   - App.jsx per-message translate   (classic shell)
 *   - App.jsx bulk translate          (classic shell)
 *
 * When the flag is OFF, this module is a no-op — fetch behaves exactly
 * as before. Disabled callers never pay even a header-check cost
 * outside the URL-match fast path.
 */

const LS_KEY = "amina_use_v2";
const HEADER_NAME = "X-Translation-Pipeline";
const HEADER_VALUE = "v2";

// Matches POST /api/v1/agent/translate and /api/v1/agent/translate/batch
// (with optional query string). Does NOT match /api/v1/agent/translate/anything-else.
const TRANSLATE_URL_RE = /\/api\/v1\/agent\/translate(?:\/batch)?(?:\?[^#]*)?(?:#.*)?$/;

function readFlag() {
  try {
    const v = window.localStorage.getItem(LS_KEY);
    return v === "1" || v === "true";
  } catch (_) {
    return false;
  }
}

function writeFlag(enabled) {
  try {
    if (enabled) {
      window.localStorage.setItem(LS_KEY, "1");
    } else {
      window.localStorage.removeItem(LS_KEY);
    }
  } catch (_) {
    /* private mode etc — ignore */
  }
}

function resourceUrl(resource) {
  if (typeof resource === "string") return resource;
  if (resource && typeof resource.url === "string") return resource.url;
  if (resource && typeof URL !== "undefined" && resource instanceof URL) {
    return resource.href;
  }
  return "";
}

function install() {
  if (typeof window === "undefined") return;
  if (typeof window.fetch !== "function") return;
  if (window.__aminaV2OptinInstalled) return;

  const origFetch = window.fetch.bind(window);

  window.fetch = function aminaV2PatchedFetch(resource, init) {
    if (!readFlag()) return origFetch(resource, init);
    const url = resourceUrl(resource);
    if (!TRANSLATE_URL_RE.test(url)) return origFetch(resource, init);

    try {
      // Path 1 — Request object: clone with header added
      if (typeof Request !== "undefined" && resource instanceof Request) {
        const headers = new Headers(resource.headers);
        headers.set(HEADER_NAME, HEADER_VALUE);
        const cloned = new Request(resource, { headers });
        return origFetch(cloned, init);
      }
      // Path 2 — string/URL + init: merge header into init.headers
      const nextInit = Object.assign({}, init || {});
      const headers = new Headers(nextInit.headers || {});
      headers.set(HEADER_NAME, HEADER_VALUE);
      nextInit.headers = headers;
      return origFetch(resource, nextInit);
    } catch (e) {
      // Any surprise in header-injection → fall back to untouched fetch.
      // Correctness of the app comes first; v2 opt-in is best-effort.
      return origFetch(resource, init);
    }
  };

  window.__aminaV2OptinInstalled = true;
  window.__aminaUseV2 = function aminaUseV2(enable) {
    if (typeof enable === "undefined") return readFlag();
    writeFlag(Boolean(enable));
    return readFlag();
  };

  // Quiet breadcrumb so devs can confirm the module loaded via DevTools.
  try {
    if (window.console && typeof window.console.debug === "function") {
      window.console.debug(
        "[amina] v2 translation opt-in installed. " +
        "Toggle with window.__aminaUseV2(true|false). Current:",
        readFlag()
      );
    }
  } catch (_) { /* ignore */ }
}

install();

export default { install, readFlag, writeFlag };
