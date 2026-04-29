/**
 * signOut — comprehensive sign-out for admin / government / observatory
 * sessions, plus a small helper to clear the observatory consent
 * receipt on sign-IN so the policy gate re-prompts on every sign-in.
 *
 * Why this file exists
 * --------------------
 * Sign-out points across the app were historically partial:
 *   - GovShell.jsx's "Sign out" button only navigated to #/login and
 *     left every token in localStorage, so the user was effectively
 *     still signed in (next visit to /admin or /gov saw the tokens
 *     and skipped the login screen).
 *   - AppRouter.jsx's onLogout cleared AMINA_TOKEN + AMINA_ADMIN_TOKEN
 *     but left AMINA_ADMIN ("true"/"false") flag, AMINA_GOV_OFFICIAL,
 *     and never cleared sessionStorage.amina_observatory_consent.
 *   - The Phase-3 fix the user remembered was the per-session-only
 *     consent storage, but it survives sign-out within the same tab,
 *     so the policy gate didn't re-prompt on the next sign-in.
 *
 * What signOutAdminAndGov() does
 * ------------------------------
 *   1. Clears every admin / staff / observatory token in localStorage:
 *        AMINA_ADMIN_TOKEN, AMINA_ADMIN, AMINA_GOV_OFFICIAL.
 *   2. If AMINA_TOKEN's JWT decodes to an admin-class role, clears
 *      that too (covers the admin-patient path where AMINA_TOKEN is
 *      itself the staff JWT). Plain patient AMINA_TOKEN is left alone
 *      so the patient app keeps working when the user pops back.
 *   3. Clears sessionStorage.amina_observatory_consent so the
 *      ConsentGate re-fires on next gov-portal click.
 *   4. Clears sessionStorage.amina_privacy_popup_seen so the
 *      PrivacyPolicyBootstrap shows the popup again on next sign-in.
 *   5. Fires `amina:auth-changed` so any subscribers
 *      (PrivacyPolicyBootstrap, RoleSwitcher) notice the transition
 *      and reset their own cached state without waiting for the
 *      1.5-second poll tick.
 *
 * What clearObservatoryConsent() does
 * -----------------------------------
 * Just (3) above. Call it from successful sign-IN paths so that even
 * if the user signs back in within the same tab (sessionStorage
 * survives intra-tab logout/login), the policy gate re-prompts.
 *
 * Both functions are no-ops on SSR / non-browser contexts and never
 * raise — every storage call is wrapped in try/catch.
 */

const ADMIN_ROLES = new Set([
  "admin", "super_admin", "staff_admin",
  "observatory_admin", "moh_admin",
]);

function _decodeRole(tok) {
  if (!tok) return "";
  try {
    const parts = tok.split(".");
    if (parts.length < 2) return "";
    const pad = "=".repeat((4 - (parts[1].length % 4)) % 4);
    const b64 = (parts[1] + pad).replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64));
    return String(payload?.role || "").toLowerCase();
  } catch {
    return "";
  }
}

export function clearObservatoryConsent() {
  if (typeof sessionStorage === "undefined") return;
  try { sessionStorage.removeItem("amina_observatory_consent"); } catch {}
  try { sessionStorage.removeItem("amina_privacy_popup_seen");  } catch {}
}

export function signOutAdminAndGov() {
  if (typeof window === "undefined") return;

  // ── 1. Admin / staff / gov tokens ────────────────────────────────
  try { localStorage.removeItem("AMINA_ADMIN_TOKEN"); } catch {}
  try { localStorage.removeItem("AMINA_ADMIN"); }       catch {}
  try { localStorage.removeItem("AMINA_GOV_OFFICIAL"); } catch {}

  // ── 2. AMINA_TOKEN — only clear if it carries an admin-class JWT ─
  // The admin-patient path stores the same JWT in AMINA_TOKEN; clearing
  // it here unsigns the staff session. A plain patient JWT is left
  // alone so the patient surface keeps working.
  try {
    const tok = localStorage.getItem("AMINA_TOKEN") || "";
    if (tok && ADMIN_ROLES.has(_decodeRole(tok))) {
      localStorage.removeItem("AMINA_TOKEN");
      localStorage.removeItem("AMINA_PATIENT");
      localStorage.removeItem("AMINA_PATIENT_EMAIL");
    }
  } catch {}

  // ── 3. Observatory consent + popup-seen (per-session flags) ─────
  clearObservatoryConsent();

  // ── 4. Notify subscribers immediately, don't wait for poll tick ─
  try {
    window.dispatchEvent(new CustomEvent("amina:auth-changed"));
  } catch {}
}
