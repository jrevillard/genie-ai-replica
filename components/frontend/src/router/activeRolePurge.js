/**
 * activeRolePurge — boot-time fix for "refresh lands me on the wrong role".
 *
 * Runs as a side-effect at module load, BEFORE any React tree mounts.
 * Reads AMINA_ACTIVE (set by SessionSwitcher / SessionBootstrap) and
 * clears the live keys for every OTHER role. That way, when App.jsx's
 * init code reads localStorage to decide which shell to render, only
 * the active role has tokens present.
 *
 * Rationale: App.jsx's auth gate checks `AMINA_ADMIN_TOKEN` FIRST and
 * short-circuits to the AdminDashboard the moment that key exists —
 * regardless of whether the user last switched to patient. This module
 * enforces the invariant "only one role's live keys are present at any
 * moment, matching AMINA_ACTIVE", so a refresh on the patient page
 * genuinely stays on patient.
 *
 * No event dispatch needed — runs before any listener exists.
 */

const ACTIVE_KEY = "AMINA_ACTIVE";

const PATIENT_KEYS    = ["AMINA_TOKEN", "AMINA_PATIENT", "AMINA_SID"];
const CAREGIVER_KEYS  = ["cg_token", "cg_info"];
const ADMIN_KEYS      = ["AMINA_ADMIN_TOKEN", "AMINA_ADMIN"];


function _has(keys) {
  try {
    return keys.some((k) => localStorage.getItem(k));
  } catch { return false; }
}


function _clear(keys) {
  try {
    for (const k of keys) localStorage.removeItem(k);
  } catch { /* noop */ }
}


function _inferActive() {
  // If AMINA_ACTIVE is set, trust it.
  try {
    const a = localStorage.getItem(ACTIVE_KEY);
    if (a === "pt" || a === "cg" || a === "ad") return a;
  } catch { /* noop */ }

  // Otherwise fall back to whichever role has live keys.  If several
  // do (pre-existing messy state), prefer patient because that's the
  // most common landing role AND matches what the URL hash is likely
  // to be for a fresh signup.
  if (_has(PATIENT_KEYS))   return "pt";
  if (_has(CAREGIVER_KEYS)) return "cg";
  if (_has(ADMIN_KEYS))     return "ad";
  return null;
}


function purge() {
  if (typeof window === "undefined") return;
  if (window.__aminaActiveRolePurged) return;
  window.__aminaActiveRolePurged = true;

  const active = _inferActive();
  if (!active) return;

  try { localStorage.setItem(ACTIVE_KEY, active); } catch { /* noop */ }

  if (active !== "pt") _clear(PATIENT_KEYS);
  if (active !== "cg") _clear(CAREGIVER_KEYS);
  if (active !== "ad") _clear(ADMIN_KEYS);
}


purge();
