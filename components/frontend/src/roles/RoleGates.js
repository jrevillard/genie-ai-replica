/**
 * RoleGates — hide care-card buttons that don't belong to the current
 * acting role, per the 2026-04-19 role split.
 * ======================================================================
 *
 * Current role model in App.jsx is permissive:
 *   - Supply edit button appears for canEditCare        (clinician + vhw + admin)
 *   - Care-paths button appears for canEditCarePath    (clinician + admin)
 *   - Otherwise a locked-looking span replaces the button.
 *
 * Product has flipped the ownership:
 *   - Supply  → clinician + admin only. VHWs MUST NOT see the button
 *               because their personal stock doesn't match the clinic's
 *               dispense log.
 *   - Care paths → VHW + admin only. Clinicians see the summary but
 *                  don't log field visits.
 *
 * Since App.jsx is treated as read-only, we:
 *   1. Mirror the current AMINA_ROLE onto `<body data-amina-role="…">`
 *      every tick (cheap — polling + storage + amina:role-changed).
 *   2. Inject a single <style> block that hides the wrong-role buttons
 *      and the wrong-role locked span, using attribute selectors.
 *   3. Also cover the fallback "locked" span for Care paths so it
 *      disappears for clinicians (instead of appearing as a padlock
 *      they can't click).
 *
 * VHWs can still open the dual-path ledger because
 * DualPathLedgerHost's click interceptor also matches the locked-span
 * title. After this module, the locked span IS visible for VHW (we
 * intentionally don't hide it) — and our interceptor makes it
 * clickable.
 *
 * No backend calls, no React — just CSS + a tiny sync loop.
 */

const STYLE_ID = "amina-role-gates-style";
const ROLE_ATTR = "data-amina-role";


const CSS = `
/* ── Supply button: hide for VHW + patient (non-clinician field ops) ── */
body[${ROLE_ATTR}="vhw"]     button.ccard-edit-btn[title="Update medicine supply"],
body[${ROLE_ATTR}="scout"]   button.ccard-edit-btn[title="Update medicine supply"],
body[${ROLE_ATTR}="alkalo"]  button.ccard-edit-btn[title="Update medicine supply"],
body[${ROLE_ATTR}="imam"]    button.ccard-edit-btn[title="Update medicine supply"] {
  display: none !important;
}

/* ── Care paths: hide the ACTIVE button + the LOCKED span for
      clinician (clinician no longer owns care-path writes) ────────── */
body[${ROLE_ATTR}="clinician"] button.ccard-edit-btn[title="Update dual-path care"],
body[${ROLE_ATTR}="clinician"] span.ccard-edit-btn[title="Care path edits are locked to clinicians"] {
  display: none !important;
}

/* ── For VHW (now the owner of care-path), make the locked-style span
      look like a real clickable button. App.jsx still renders a
      disabled span because its canEditCarePath excludes vhw. Our
      click-interceptor turns it into an actual open-modal trigger;
      these rules just make it LOOK right. ───────────────────────── */
body[${ROLE_ATTR}="vhw"] span.ccard-edit-btn[title="Care path edits are locked to clinicians"] {
  opacity: 1 !important;
  cursor: pointer !important;
}
body[${ROLE_ATTR}="vhw"] span.ccard-edit-btn[title="Care path edits are locked to clinicians"]:hover {
  filter: brightness(1.15);
}
/* The padlock SVG inside the locked span — swap it visually for the
   pencil-edit icon used by the real button. SVG children aren't easy
   to rewrite purely in CSS, so we just dim the padlock and overlay an
   edit marker via a pseudo-element. */
body[${ROLE_ATTR}="vhw"] span.ccard-edit-btn[title="Care path edits are locked to clinicians"] svg {
  opacity: 0.0;
}
body[${ROLE_ATTR}="vhw"] span.ccard-edit-btn[title="Care path edits are locked to clinicians"]::before {
  content: "✎";
  font-size: 12px;
  margin-right: 4px;
  display: inline-block;
  color: inherit;
}

/* ── Patient (real) or admin-acting-as-patient: hide both by default
      so the card stays clean. The floating role-switcher still lets
      admin-patients flip personas. ───────────────────────────────── */
body[${ROLE_ATTR}="patient"] button.ccard-edit-btn[title="Update medicine supply"],
body[${ROLE_ATTR}="patient"] button.ccard-edit-btn[title="Update dual-path care"],
body[${ROLE_ATTR}="patient"] span.ccard-edit-btn[title="Care path edits are locked to clinicians"] {
  display: none !important;
}

/* ── Scout card "Manage" button — Alkalo-only per the 2026-04-19
      role split. App.jsx still renders it for VHW + clinician (its
      canEdit array includes both), so we hide theirs via CSS. For
      Alkalo, App.jsx renders NOTHING — ScoutManagerInjector.js
      creates the button dynamically. ──────────────────────────── */
body[${ROLE_ATTR}="vhw"]       .ccard-scout .ccard-bottom-row .ccard-edit-btn,
body[${ROLE_ATTR}="clinician"] .ccard-scout .ccard-bottom-row .ccard-edit-btn {
  display: none !important;
}

/* ── Bantaba "Manage circle" button — Alkalo + admin only per the
      2026-04-19 per-patient rewrite. App.jsx still renders it for
      {vhw, clinician, alkalo}, so we hide the vhw/clinician copy.
      For patient, App.jsx renders no button — BantabaManagerHost
      DOM-injects a "My circle" button instead. ───────────────── */
body[${ROLE_ATTR}="vhw"]       .ccard-bantaba .ccard-edit-row .ccard-edit-btn:not([id="amina-bantaba-patient-fab"]),
body[${ROLE_ATTR}="clinician"] .ccard-bantaba .ccard-edit-row .ccard-edit-btn:not([id="amina-bantaba-patient-fab"]) {
  display: none !important;
}
`;


function _readRole() {
  try { return localStorage.getItem("AMINA_ROLE") || "patient"; }
  catch { return "patient"; }
}


function _installStyle() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const tag = document.createElement("style");
  tag.id = STYLE_ID;
  tag.textContent = CSS;
  document.head.appendChild(tag);
}


function _syncAttr() {
  if (typeof document === "undefined") return;
  const role = _readRole();
  if (document.body.getAttribute(ROLE_ATTR) !== role) {
    document.body.setAttribute(ROLE_ATTR, role);
  }
}


function install() {
  if (typeof window === "undefined") return;
  if (window.__aminaRoleGatesInstalled) return;
  window.__aminaRoleGatesInstalled = true;

  const boot = () => {
    _installStyle();
    _syncAttr();
    // Poll — cheap, covers storage events from other tabs AND the
    // inline Settings picker in App.jsx.
    setInterval(_syncAttr, 500);
    window.addEventListener("storage", _syncAttr);
    window.addEventListener("amina:role-changed", _syncAttr);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
}


install();
