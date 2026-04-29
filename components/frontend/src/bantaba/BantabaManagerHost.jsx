/**
 * BantabaManagerHost — single control surface for the Bantaba circle.
 *
 *   1. Click interceptor on the legacy App.jsx "Manage circle" button
 *      (title="Manage Bantaba Circle") — opens OUR modal instead of
 *      App.jsx's single-field edit modal.
 *   2. Patient button injector — App.jsx only renders the Manage
 *      button for {vhw, clinician, alkalo} (line 2751 canEdit gate).
 *      Patients would never see it. When role === "patient", we DOM-
 *      inject a "My Circle" button into the .ccard-bantaba card so
 *      the patient can open their own circle modal.
 *   3. Auto-init on patient login — as soon as a patient JWT is
 *      available, POST /bantaba/mine once to create the circle keyed
 *      on the patient's id, auto-named "{patient}'s Circle". The
 *      backend is idempotent; we just call it on first detection of
 *      AMINA_TOKEN with role !== "admin" (patients include admin-
 *      patients whose JWT carries role=admin but have sub=P_*).
 */

import { useCallback, useEffect, useState } from "react";
import BantabaManagerModal from "./BantabaManagerModal.jsx";
import { initMyBantaba } from "./bantabaApi.js";


const TITLE_MATCH = "manage bantaba circle";
const OPEN_EVENT  = "amina:open-bantaba-manager";
const PATIENT_BTN_ID = "amina-bantaba-patient-fab";
const AUTO_INIT_KEY  = "amina:bantaba-auto-init-done";


function _readRole() {
  try { return localStorage.getItem("AMINA_ROLE") || "patient"; }
  catch { return "patient"; }
}


function _readTokenSub() {
  try {
    const tok = localStorage.getItem("AMINA_TOKEN");
    if (!tok) return "";
    const parts = tok.split(".");
    if (parts.length < 2) return "";
    const pad = "=".repeat((4 - (parts[1].length % 4)) % 4);
    const b64 = (parts[1] + pad).replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64));
    return payload?.sub || "";
  } catch { return ""; }
}


// ── 1. Click interceptor ────────────────────────────────────────────

function installClickInterceptor() {
  if (typeof window === "undefined") return;
  if (window.__aminaBantabaInterceptor) return;
  window.__aminaBantabaInterceptor = true;

  const handler = (ev) => {
    let el = ev.target;
    while (el && el !== document) {
      if (el.nodeType === 1
          && el.tagName === "BUTTON"
          && (el.getAttribute("title") || "").toLowerCase() === TITLE_MATCH) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        ev.stopPropagation();
        try { window.dispatchEvent(new CustomEvent(OPEN_EVENT)); }
        catch { /* noop */ }
        return;
      }
      el = el.parentNode;
    }
  };

  document.addEventListener("click", handler, true);
}


// ── 2. Patient-button injector ──────────────────────────────────────

function _removePatientBtn() {
  const existing = document.getElementById(PATIENT_BTN_ID);
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
}


function _injectPatientBtn(card) {
  if (document.getElementById(PATIENT_BTN_ID)) return;
  // The patient variant of BantabaCard has no edit-row — create one.
  let row = card.querySelector(".ccard-edit-row");
  if (!row) {
    row = document.createElement("div");
    row.className = "ccard-edit-row";
    row.addEventListener("mousedown", (e) => e.stopPropagation());
    card.appendChild(row);
  }
  const btn = document.createElement("button");
  btn.id = PATIENT_BTN_ID;
  btn.type = "button";
  btn.className = "ccard-edit-btn";
  btn.setAttribute("aria-label", "Open my Bantaba circle");
  btn.innerHTML = `
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2.5"
         stroke-linecap="round" stroke-linejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
    <span>My circle</span>
  `;
  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    try { window.dispatchEvent(new CustomEvent(OPEN_EVENT)); }
    catch { /* noop */ }
  });
  row.appendChild(btn);
}


function _scanPatientInjection() {
  if (typeof document === "undefined") return;
  const role = _readRole();
  if (role !== "patient") { _removePatientBtn(); return; }
  const card = document.querySelector(".ccard-bantaba");
  if (!card) { _removePatientBtn(); return; }
  _injectPatientBtn(card);
}


// ── 3. Auto-init on login ───────────────────────────────────────────

async function _maybeAutoInit() {
  const sub = _readTokenSub();
  if (!sub) return;
  const flag = `${AUTO_INIT_KEY}:${sub}`;
  if (sessionStorage.getItem(flag)) return;
  try {
    await initMyBantaba();
    sessionStorage.setItem(flag, "1");
    // Panel injector / card poll will pick up the renamed circle.
    try { window.dispatchEvent(new CustomEvent("amina:bantaba-updated")); }
    catch { /* noop */ }
  } catch { /* silent — user may not be a patient */ }
}


function install() {
  if (typeof window === "undefined") return;
  if (window.__aminaBantabaHostInstalled) return;
  window.__aminaBantabaHostInstalled = true;

  installClickInterceptor();

  // Patient button sync + auto-init polling (both low cost, same cadence)
  setInterval(() => {
    _scanPatientInjection();
    _maybeAutoInit();
  }, 400);
  window.addEventListener("amina:role-changed", _scanPatientInjection);
  window.addEventListener("storage", _scanPatientInjection);
}

install();


// ── React root — opens the modal on demand ─────────────────────────

export default function BantabaManagerHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  const close = useCallback(() => setOpen(false), []);
  if (!open) return null;
  return <BantabaManagerModal onClose={close} />;
}
