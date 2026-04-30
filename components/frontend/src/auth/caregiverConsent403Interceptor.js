/**
 * caregiverConsent403Interceptor — Phase 6.7 hard-403 listener.
 * ==============================================================
 *
 * Phase 7 will flip `AMINA_CAREGIVER_PRIVACY_REQUIRED=true` and certain
 * patient-data caregiver routes will start returning HTTP 403 with
 *
 *     { "detail": {
 *         "error":          "consent_required",
 *         "code":           "caregiver_privacy_consent_required",
 *         "notice_version": "1.0",
 *         "submit_url":     "/api/v1/caregiver/privacy/consent",
 *         "status_url":     "/api/v1/caregiver/privacy/status"
 *       } }
 *
 * for any caregiver who has not accepted the current notice. Without
 * this interceptor a caregiver mid-flight when enforcement flips
 * would just see a generic toast / network error and not understand
 * what to do. Phase 5 already ships a soft re-consent modal driven
 * by `/privacy/status`; Phase 6.7 wires the same modal to the hard
 * path: any caregiver fetch that returns the 403/code combo above
 * dispatches `amina:caregiver-consent-required` on `window`, which
 * `CaregiverPrivacyReconsentBootstrap.jsx` listens for and forces
 * the modal open.
 *
 * Behaviour contract:
 *   1. Mounts ONCE per page-load (idempotent install guard).
 *   2. Wraps `window.fetch` with a thin proxy. Pass-through on every
 *      call — never blocks, never retries, never mutates the
 *      request, never reads the response body of non-403 responses.
 *   3. On a 403 to a path containing `/api/v1/caregiver/`, peeks at
 *      the JSON body via `response.clone().json()` (so the original
 *      response object is still consumable by the caller). If the
 *      `code` matches `caregiver_privacy_consent_required`, fires
 *      `amina:caregiver-consent-required` once. The original
 *      response is still returned unchanged — callers handle the
 *      403 normally; the modal is purely additive UX.
 *   4. Only operates while a `cg_token` is present in localStorage —
 *      patients/admins are never affected.
 *
 * Privacy posture:
 *   - Never console-logs the response body, the URL query string,
 *     the JWT token, or any caregiver identifier.
 *   - The dispatched event carries no payload (the bootstrap
 *     re-fetches `/privacy/status` after it receives the event,
 *     which is the canonical ground-truth signal).
 *   - Pass-through behaviour means a misbehaving body parse never
 *     blocks the user's response.
 */

const INSTALLED_FLAG = "__aminaCgConsent403InterceptorInstalled";
const EVENT_NAME     = "amina:caregiver-consent-required";
const TOKEN_KEY      = "cg_token";
const PATH_NEEDLE    = "/api/v1/caregiver/";
const CONSENT_CODE   = "caregiver_privacy_consent_required";


function _hasCaregiverToken() {
  try { return !!localStorage.getItem(TOKEN_KEY); }
  catch { return false; }
}

function _looksLikeCaregiverPath(input) {
  // input is the first arg to fetch — string, URL, or Request.
  try {
    if (typeof input === "string")     return input.includes(PATH_NEEDLE);
    if (input && typeof input.url === "string") return input.url.includes(PATH_NEEDLE);
    if (input && typeof input.toString === "function") {
      return String(input).includes(PATH_NEEDLE);
    }
  } catch { /* fall through */ }
  return false;
}

async function _isConsentRequired403(response) {
  if (!response || response.status !== 403) return false;
  // Clone before reading so the caller's `response.json()` still works.
  let body = null;
  try {
    body = await response.clone().json();
  } catch {
    return false; // 403 with non-JSON body — let the caller handle it.
  }
  // Backend shape: { detail: { code: "caregiver_privacy_consent_required", ... } }
  const code = body && body.detail && body.detail.code;
  return code === CONSENT_CODE;
}


export function installCaregiverConsent403Interceptor() {
  if (typeof window === "undefined") return;
  if (window[INSTALLED_FLAG]) return;
  window[INSTALLED_FLAG] = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async function aminaCaregiverConsent403Aware(input, init) {
    const response = await originalFetch(input, init);
    // Cheap fast-path: only do the work when there's a caregiver
    // session AND the URL looks like a caregiver-side request.
    if (!_hasCaregiverToken())          return response;
    if (!_looksLikeCaregiverPath(input)) return response;
    if (response.status !== 403)         return response;

    // Best-effort consent-code check. Any failure here is silent —
    // the original response is still returned unchanged.
    try {
      const isConsent = await _isConsentRequired403(response);
      if (isConsent) {
        try {
          window.dispatchEvent(new CustomEvent(EVENT_NAME));
        } catch { /* noop */ }
      }
    } catch { /* noop */ }

    return response;
  };
}


// Self-install on import.
installCaregiverConsent403Interceptor();
