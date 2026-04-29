/**
 * PrivacyPolicyBootstrap — auto-opens the government privacy policy
 * popup on every admin LOGIN and every admin LOGOUT.
 *
 * Trigger logic
 * -------------
 * 1. On page load: if AMINA_TOKEN already decodes to role=admin AND
 *    we have not yet shown the popup this browser session, show it
 *    once. This covers cold starts where the user is already signed in.
 * 2. Whenever the AMINA_TOKEN value changes (login / logout / token
 *    refresh):
 *      - none → admin token   → show popup (login)
 *      - admin token → none   → show popup (logout)
 *      - admin token → other  → show popup (logout) so the prior session
 *        gets a clear close-out
 * 3. Each transition also clears `sessionStorage.amina_observatory_consent`
 *    so the heavy ConsentGate re-prompts on the next gov portal click.
 *
 * Storage
 * -------
 * - `sessionStorage.amina_privacy_popup_seen` — flag for the cold-start
 *   case so we don't re-popup on every router-driven re-mount in the
 *   same logged-in session. Cleared on logout transition.
 *
 * Mount is idempotent. Wired by RoleSwitcherBootstrap.
 */

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import PrivacyPolicyPopup from "./PrivacyPolicyPopup.jsx";

const ROOT_ID         = "amina-privacy-popup-root";
const ADMIN_TOKEN_KEY = "AMINA_ADMIN_TOKEN";
const ADMIN_FLAG_KEY  = "AMINA_ADMIN";
// Legacy/alternate paths for completeness — observatory phone-auth and
// the email-allowlist path can both produce admin sessions.
const FALLBACK_TOKEN_KEYS = ["AMINA_TOKEN"];
const ADMIN_ROLES = new Set([
  "admin", "super_admin", "staff_admin", "observatory_admin", "moh_admin",
]);
const SEEN_KEY        = "amina_privacy_popup_seen";
const GOV_CONSENT_KEY = "amina_observatory_consent";

function _decodeRole(tok) {
  if (!tok) return "";
  try {
    const parts = tok.split(".");
    if (parts.length < 2) return "";
    const pad = "=".repeat((4 - (parts[1].length % 4)) % 4);
    const b64 = (parts[1] + pad).replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64));
    return String(payload?.role || "");
  } catch {
    return "";
  }
}

/**
 * An admin session is any one of:
 *   1. AMINA_ADMIN === "true" AND AMINA_ADMIN_TOKEN present
 *      (matches the App.jsx admin gate at line 2998-3008)
 *   2. AMINA_TOKEN whose JWT role ∈ ADMIN_ROLES
 *      (covers the gov phone-auth super_admin path)
 *
 * Returns the token string we'll use as the "session id" for transition
 * tracking, or "" if no admin session.
 */
function _adminToken() {
  try {
    const adminTok = localStorage.getItem(ADMIN_TOKEN_KEY) || "";
    const adminFlag = localStorage.getItem(ADMIN_FLAG_KEY);
    if (adminTok && adminFlag === "true") return adminTok;
    for (const k of FALLBACK_TOKEN_KEYS) {
      const tok = localStorage.getItem(k) || "";
      if (tok && ADMIN_ROLES.has(_decodeRole(tok))) return tok;
    }
    return "";
  } catch {
    return "";
  }
}

function _clearGovConsent() {
  try { sessionStorage.removeItem(GOV_CONSENT_KEY); } catch { /* noop */ }
}

function _markSeen() {
  try { sessionStorage.setItem(SEEN_KEY, "1"); } catch { /* noop */ }
}

function _clearSeen() {
  try { sessionStorage.removeItem(SEEN_KEY); } catch { /* noop */ }
}

function _hasSeen() {
  try { return sessionStorage.getItem(SEEN_KEY) === "1"; } catch { return false; }
}

// ── Host component ────────────────────────────────────────────────
function PrivacyPolicyHost() {
  // Lazy initializer: cold-start case is decided once per mount based
  // on initial token + sessionStorage flag, never inside an effect.
  const [phase, setPhase] = useState(() => {
    const tok = _adminToken();
    return tok && !_hasSeen() ? "login" : "";
  });

  useEffect(() => {
    let prev = _adminToken();

    const tick = () => {
      const cur = _adminToken();
      if (cur === prev) return;
      _clearGovConsent();
      if (!prev && cur) {
        setPhase("login");
      } else if (prev && !cur) {
        _clearSeen();
        setPhase("logout");
      } else {
        // admin token replaced (rotation) — treat as a logout-of-old.
        _clearSeen();
        setPhase("logout");
      }
      prev = cur;
    };

    const t = setInterval(tick, 1500);
    const onStorage = (e) => {
      if (!e.key
          || e.key === ADMIN_TOKEN_KEY
          || e.key === ADMIN_FLAG_KEY
          || FALLBACK_TOKEN_KEYS.includes(e.key)) {
        tick();
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("amina:auth-changed", tick);

    return () => {
      clearInterval(t);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("amina:auth-changed", tick);
    };
  }, []);

  if (!phase) return null;

  const onClose = () => {
    if (phase === "login") _markSeen();
    setPhase("");
  };

  return <PrivacyPolicyPopup phase={phase} onClose={onClose} />;
}

// ── Self-mount ────────────────────────────────────────────────────
function mount() {
  if (typeof window === "undefined") return;
  if (window.__aminaPrivacyPopupMounted) return;
  window.__aminaPrivacyPopupMounted = true;

  const attach = () => {
    try {
      if (document.getElementById(ROOT_ID)) return;
      const host = document.createElement("div");
      host.id = ROOT_ID;
      document.body.appendChild(host);
      createRoot(host).render(<PrivacyPolicyHost />);
    } catch (e) {
      console.warn("PrivacyPolicyBootstrap mount failed:", e);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach);
  } else {
    attach();
  }
}

mount();

export default PrivacyPolicyHost;
