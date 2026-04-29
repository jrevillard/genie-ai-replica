/**
 * ScoutManagerHost — surfaces the Scout Manager modal for Alkalo.
 *
 * App.jsx only renders the card-level "Manage" button when
 *   canEdit = ["vhw","clinician"].includes(userRole)
 * Alkalo is NOT in that set, so for Alkalo the button simply doesn't
 * exist in the DOM. We can't edit App.jsx, so this module:
 *
 *   1. Runs a lightweight 250ms scanner that, when the current role is
 *      alkalo, finds the scout card (`.ccard-scout .ccard-bottom-row`)
 *      and appends a synthetic "Manage scouts" button if one isn't
 *      already there.
 *   2. Clicks on that synthetic button fire the open-event that opens
 *      our React-rooted ScoutManagerModal.
 *   3. Non-alkalo roles get their injected button removed if the role
 *      flips (e.g. admin impersonates patient mid-session).
 *
 * For VHW / clinician, RoleGates.js already hides the App.jsx-rendered
 * Manage button via CSS — so this injector only adds UI for Alkalo,
 * nothing else.
 */

import { useCallback, useEffect, useState } from "react";
import ScoutManagerModal from "./ScoutManagerModal.jsx";


const OPEN_EVENT  = "amina:open-scout-manager";
const INJECT_ID   = "amina-scout-manager-fab";


function _readRole() {
  try { return localStorage.getItem("AMINA_ROLE") || "patient"; }
  catch { return "patient"; }
}


function _removeInjection() {
  const existing = document.getElementById(INJECT_ID);
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
}


function _injectInto(row) {
  if (!row || document.getElementById(INJECT_ID)) return;
  const btn = document.createElement("button");
  btn.id = INJECT_ID;
  btn.type = "button";
  btn.className = "ccard-edit-btn";
  btn.setAttribute("aria-label", "Manage youth scouts");
  btn.innerHTML = `
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2.5"
         stroke-linecap="round" stroke-linejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
    <span>Manage</span>
  `;
  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    try { window.dispatchEvent(new CustomEvent(OPEN_EVENT)); }
    catch { /* noop */ }
  });
  row.appendChild(btn);
}


function _scan() {
  if (typeof document === "undefined") return;
  const role = _readRole();
  if (role !== "alkalo" && role !== "admin") {
    _removeInjection();
    return;
  }
  // Find the scout card's bottom-row. App.jsx renders it as
  //   <div class="ccard-bottom-row" onMouseDown=stopPropagation>
  // inside the <button class="ccard ccard-scout">.
  const card = document.querySelector(".ccard-scout");
  if (!card) { _removeInjection(); return; }
  const row = card.querySelector(".ccard-bottom-row");
  if (!row) return;
  _injectInto(row);
}


function install() {
  if (typeof window === "undefined") return;
  if (window.__aminaScoutInjectorInstalled) return;
  window.__aminaScoutInjectorInstalled = true;
  setInterval(_scan, 250);
  window.addEventListener("amina:role-changed", _scan);
  window.addEventListener("storage", _scan);
}

install();


// React root that listens for the open event.
export default function ScoutManagerHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  const close = useCallback(() => setOpen(false), []);
  if (!open) return null;
  return <ScoutManagerModal onClose={close} />;
}
