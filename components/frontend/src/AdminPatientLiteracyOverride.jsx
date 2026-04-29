/**
 * AdminPatientLiteracyOverride — hardcodes the admin-patient account
 * to Advanced literacy mode so the onboarding gate never shows.
 *
 * Side-effect import. Imported once from main.jsx, before
 * LiteracyBootstrap, so that when LiteracyBootstrap polls
 * /api/v1/literacy/me on login it receives a rewritten response for
 * the admin-patient email.
 *
 * Mechanism:
 *   1. On module load, wrap window.fetch.
 *   2. If the logged-in patient email matches the admin-patient
 *      allowlist, any request to /api/v1/literacy/me returns a
 *      synthetic { current_mode: "advanced", needs_onboarding: false }
 *      payload without hitting the backend.
 *   3. All other fetches (including POSTs to /literacy/*) pass
 *      through untouched so admin flows still write through to
 *      the real backend.
 *
 * The admin-patient email is read at request time, so logging in
 * as a different patient immediately stops the override — no app
 * reload required.
 */

const ADMIN_PATIENT_EMAILS = new Set([
  "admin@demo.aminacare",
]);

const LITERACY_ME_PATH = "/api/v1/literacy/me";


function _adminPatientEmail() {
  try {
    const raw = localStorage.getItem("AMINA_PATIENT");
    if (!raw) return null;
    const email = (JSON.parse(raw)?.email || "").toString().trim().toLowerCase();
    return ADMIN_PATIENT_EMAILS.has(email) ? email : null;
  } catch {
    return null;
  }
}


function _matchesLiteracyMe(url) {
  if (!url) return false;
  try {
    const s = typeof url === "string" ? url : (url.url || String(url));
    return s.indexOf(LITERACY_ME_PATH) !== -1;
  } catch {
    return false;
  }
}


function _syntheticAdvancedResponse() {
  const payload = {
    current_mode: "advanced",
    declared_level: "literate",
    verified_level: "literate",
    needs_onboarding: false,
    onboarded_at: new Date().toISOString(),
    _source: "admin-patient-override",
  };
  return new Response(JSON.stringify(payload), {
    status: 200,
    statusText: "OK",
    headers: { "Content-Type": "application/json" },
  });
}


(function installAdminPatientLiteracyOverride() {
  if (typeof window === "undefined") return;
  if (window.__AMINA_ADMIN_PATIENT_LITERACY_OVERRIDE) return;
  window.__AMINA_ADMIN_PATIENT_LITERACY_OVERRIDE = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = function patchedFetch(input, init) {
    try {
      const method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
      if (method === "GET" && _matchesLiteracyMe(input) && _adminPatientEmail()) {
        return Promise.resolve(_syntheticAdvancedResponse());
      }
    } catch {
      /* fall through to the real fetch */
    }
    return originalFetch(input, init);
  };
})();
