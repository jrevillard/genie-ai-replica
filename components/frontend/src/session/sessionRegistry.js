/**
 * sessionRegistry — side-by-side auth sessions for patient / caregiver
 * / admin in the same browser tab.
 *
 * Why this exists
 * ---------------
 * App.jsx already uses role-specific storage keys:
 *   PATIENT    → AMINA_TOKEN, AMINA_PATIENT, AMINA_SID
 *   CAREGIVER  → cg_token,    cg_info
 *   ADMIN      → AMINA_ADMIN_TOKEN, AMINA_ADMIN
 *
 * But nothing prevents `/auth/login/email` and `/caregiver/login` from
 * being EXCLUSIVE: the auth gate in App.jsx picks Caregiver if
 * cg_token is live, otherwise Patient. Users can't be signed into both
 * simultaneously from the same tab — switching requires a second
 * browser window.
 *
 * This registry adds stable "slot" copies of each session:
 *   AMINA_PT_SLOT  → {"token","patient","sid"}
 *   AMINA_CG_SLOT  → {"token","info"}
 *   AMINA_AD_SLOT  → {"token"}
 *
 * When the user clicks "Switch to X" in the SessionSwitcher pill, we:
 *   1. save their current active-role storage into its slot,
 *   2. remove the active keys for the old role,
 *   3. restore the target role's keys from its slot,
 *   4. set AMINA_ACTIVE = "pt" | "cg" | "ad",
 *   5. fire `amina:auth-changed` + reload — App.jsx re-renders with
 *      the new role's shell (patient dashboard / caregiver portal /
 *      admin console).
 *
 * A fetch interceptor writes slot copies on every successful login so
 * users don't have to manually save. Revocation of a single slot
 * (e.g. explicit logout from caregiver portal) only clears that slot.
 */

const SLOT_PT = "AMINA_PT_SLOT";
const SLOT_CG = "AMINA_CG_SLOT";
const SLOT_AD = "AMINA_AD_SLOT";
const ACTIVE  = "AMINA_ACTIVE";


function _read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}


function _write(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else               localStorage.setItem(key, JSON.stringify(value));
  } catch { /* noop */ }
}


// ── Slot introspection ────────────────────────────────────────────

export function getSlot(role) {
  if (role === "pt") return _read(SLOT_PT);
  if (role === "cg") return _read(SLOT_CG);
  if (role === "ad") return _read(SLOT_AD);
  return null;
}


export function listSlots() {
  return {
    pt: _read(SLOT_PT),
    cg: _read(SLOT_CG),
    ad: _read(SLOT_AD),
  };
}


export function getActive() {
  // Prefer the explicit AMINA_ACTIVE flag; fall back to reading live
  // keys so we handle the "first boot after legacy install" case.
  const flag = (() => { try { return localStorage.getItem(ACTIVE); } catch { return null; } })();
  if (flag === "pt" || flag === "cg" || flag === "ad") return flag;
  // Legacy sniff:
  try {
    if (localStorage.getItem("cg_token"))    return "cg";
    if (localStorage.getItem("AMINA_ADMIN_TOKEN")) return "ad";
    if (localStorage.getItem("AMINA_TOKEN") && localStorage.getItem("AMINA_PATIENT")) return "pt";
  } catch { /* noop */ }
  return null;
}


// ── Slot writes (called by fetch interceptor on login / manual save) ─

export function savePatientSlot({ token, patient, sid }) {
  if (!token || !patient) return;
  _write(SLOT_PT, { token, patient, sid: sid || "" });
  // Mirror to live keys if patient is the current/intended active.
  _mirrorIfActive("pt");
}


export function saveCaregiverSlot({ token, info }) {
  if (!token) return;
  _write(SLOT_CG, { token, info: info || {} });
  _mirrorIfActive("cg");
}


export function saveAdminSlot({ token }) {
  if (!token) return;
  _write(SLOT_AD, { token });
  _mirrorIfActive("ad");
}


function _mirrorIfActive(role) {
  const active = getActive();
  // If no active yet (first login), whatever we just saved becomes
  // active — that matches the old behaviour.
  if (!active) {
    _setActiveKeys(role);
  }
}


// ── Switch: copy slot → live keys, clear other live keys ───────────

function _setActiveKeys(role) {
  try {
    localStorage.setItem(ACTIVE, role);

    // Clear ONLY the OTHER roles' live keys. Keeping the target role's
    // keys intact during the transition avoids a race where a polling
    // listener (InboxBootstrap / CaregiverInboxBell) observes an empty
    // state mid-switch and tears down the UI.
    if (role !== "pt") _clearLivePatient();
    if (role !== "cg") _clearLiveCaregiver();
    if (role !== "ad") _clearLiveAdmin();

    if (role === "pt") {
      const s = _read(SLOT_PT);
      if (s) {
        // setItem is an upsert — if the key is already set to the same
        // value, this is effectively a no-op.
        localStorage.setItem("AMINA_TOKEN",   s.token);
        localStorage.setItem("AMINA_PATIENT", JSON.stringify(s.patient));
        if (s.sid) localStorage.setItem("AMINA_SID", s.sid);
      }
    } else if (role === "cg") {
      const s = _read(SLOT_CG);
      if (s) {
        localStorage.setItem("cg_token", s.token);
        localStorage.setItem("cg_info",  JSON.stringify(s.info || {}));
      }
    } else if (role === "ad") {
      const s = _read(SLOT_AD);
      if (s) {
        localStorage.setItem("AMINA_ADMIN_TOKEN", s.token);
        localStorage.setItem("AMINA_ADMIN",       "true");
      }
    }

    // Force listeners (InboxBootstrap, CaregiverInboxBell, etc.) to
    // re-evaluate their gates AFTER live keys have settled. Same-tab
    // `localStorage.setItem` does NOT emit a `storage` event — this is
    // the canonical hook for them.
    try {
      window.dispatchEvent(new CustomEvent("amina:auth-changed",
                                            { detail: { role } }));
    } catch { /* noop */ }
  } catch { /* noop */ }
}


function _clearLivePatient() {
  try {
    localStorage.removeItem("AMINA_TOKEN");
    localStorage.removeItem("AMINA_PATIENT");
    localStorage.removeItem("AMINA_SID");
  } catch { /* noop */ }
}

function _clearLiveCaregiver() {
  try {
    localStorage.removeItem("cg_token");
    localStorage.removeItem("cg_info");
  } catch { /* noop */ }
}

function _clearLiveAdmin() {
  try {
    localStorage.removeItem("AMINA_ADMIN_TOKEN");
    localStorage.removeItem("AMINA_ADMIN");
  } catch { /* noop */ }
}


export function switchTo(role, { reload = true } = {}) {
  if (!getSlot(role)) return false;
  _setActiveKeys(role);
  try {
    window.dispatchEvent(new CustomEvent("amina:auth-changed",
                                          { detail: { role } }));
  } catch { /* noop */ }
  if (reload) {
    // Defer a tick so any pending setState from the click fires first.
    setTimeout(() => {
      try { window.location.reload(); } catch { /* noop */ }
    }, 50);
  }
  return true;
}


// ── Revoke a single slot (does NOT touch other slots) ──────────────

export function forgetSlot(role, { reload = true } = {}) {
  if (role === "pt") _write(SLOT_PT, null);
  if (role === "cg") _write(SLOT_CG, null);
  if (role === "ad") _write(SLOT_AD, null);
  // If we just forgot the active slot, fall back to whichever other
  // slot exists — patient preferred (it's the default experience).
  if (getActive() === role) {
    const slots = listSlots();
    const next = slots.pt ? "pt"
               : slots.cg ? "cg"
               : slots.ad ? "ad"
               : null;
    if (next) switchTo(next, { reload });
    else {
      // No slots left — fully sign out.
      try {
        _clearLivePatient(); _clearLiveCaregiver(); _clearLiveAdmin();
        localStorage.removeItem(ACTIVE);
      } catch { /* noop */ }
      if (reload) {
        setTimeout(() => { try { window.location.reload(); } catch { /* noop */ } }, 50);
      }
    }
  }
}


// ── Migration: if we arrive on a tab with old-style live keys but no
// slots, back-fill the slots so the switcher has something to offer.
export function hydrateFromLive() {
  if (!_read(SLOT_PT)) {
    try {
      const tok = localStorage.getItem("AMINA_TOKEN");
      const pat = localStorage.getItem("AMINA_PATIENT");
      const sid = localStorage.getItem("AMINA_SID");
      if (tok && pat) _write(SLOT_PT, { token: tok, patient: JSON.parse(pat), sid: sid || "" });
    } catch { /* noop */ }
  }
  if (!_read(SLOT_CG)) {
    try {
      const tok = localStorage.getItem("cg_token");
      const info = localStorage.getItem("cg_info");
      if (tok) _write(SLOT_CG, { token: tok, info: info ? JSON.parse(info) : {} });
    } catch { /* noop */ }
  }
  if (!_read(SLOT_AD)) {
    try {
      const tok = localStorage.getItem("AMINA_ADMIN_TOKEN");
      if (tok) _write(SLOT_AD, { token: tok });
    } catch { /* noop */ }
  }
  // Set AMINA_ACTIVE if not already.
  if (!localStorage.getItem(ACTIVE)) {
    const g = getActive();
    if (g) try { localStorage.setItem(ACTIVE, g); } catch { /* noop */ }
  }
}


// ── JWT decode helper for the pill display name ────────────────────

export function decodeDisplayName(role) {
  const s = getSlot(role);
  if (!s) return null;
  try {
    if (role === "pt") return s.patient?.name || "Patient";
    if (role === "cg") return s.info?.name    || "Caregiver";
    if (role === "ad") return "Admin";
  } catch { /* noop */ }
  return null;
}
