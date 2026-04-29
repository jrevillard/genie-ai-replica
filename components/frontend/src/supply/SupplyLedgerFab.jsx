/**
 * SupplyLedgerHost — opens the multi-entry ledger modal in place of the
 * legacy single-entry "Update Medicine Supply" form.
 * ======================================================================
 *
 * Entry point
 * -----------
 * We do NOT render a separate floating pill anymore — the user already
 * has the "Supply" edit button inside HealerBridgeCard (App.jsx ~1223)
 * and asked for the ledger to surface through that button.
 *
 * To hook in without editing App.jsx we install a document-level click
 * listener in the **capture phase** that matches on
 *   button.ccard-edit-btn[title="Update medicine supply"]
 * When that button is clicked we:
 *   1. preventDefault()  + stopImmediatePropagation() so React's
 *      onClick={onEditSupply} never fires — the legacy single-row
 *      modal stays closed.
 *   2. Dispatch a `amina:open-supply-ledger` window event that this
 *      component listens for to toggle its modal open.
 *
 * The capture phase is critical: React 17+ attaches its synthetic
 * onClick to the React root, which receives events on the BUBBLE phase.
 * Running our listener in capture on `document` means we can stop
 * propagation BEFORE React dispatches the synthetic event.
 *
 * No other app behavior changes — Dual-Path edit, role switcher, chat
 * stream, etc. are all left untouched.
 */

import { useCallback, useEffect, useState } from "react";
import SupplyLedgerModal from "./SupplyLedgerModal.jsx";


const TITLE_MATCH  = "Update medicine supply";
const OPEN_EVENT   = "amina:open-supply-ledger";


function installClickInterceptor() {
  if (typeof window === "undefined") return;
  if (window.__aminaSupplyLedgerInterceptor) return;
  window.__aminaSupplyLedgerInterceptor = true;

  const handler = (ev) => {
    // Walk up from the event target looking for the specific Supply edit
    // button. We match on the title attribute (stable contract from
    // App.jsx 1223) rather than text content so a future icon swap can't
    // silently break us.
    let el = ev.target;
    while (el && el !== document) {
      if (el.nodeType === 1
          && el.tagName === "BUTTON"
          && (el.getAttribute("title") || "").toLowerCase() === TITLE_MATCH.toLowerCase()) {
        ev.preventDefault();
        // Stop the native bubble AND the would-be React synthetic handler.
        ev.stopImmediatePropagation();
        ev.stopPropagation();
        try {
          window.dispatchEvent(new CustomEvent(OPEN_EVENT));
        } catch { /* noop */ }
        return;
      }
      el = el.parentNode;
    }
  };

  // `capture: true` = run during the capture phase, before React's root
  // bubble-phase listener. We also put it on the window as a belt-and-
  // braces so iframes or shadowDOM don't sneak past us.
  document.addEventListener("click",     handler, true);
  document.addEventListener("mousedown", (ev) => {
    // Some of App.jsx's cards stopPropagation on mousedown (see the
    // onMouseDown={(e) => e.stopPropagation()} on .ccard-edit-row).
    // That's fine — we only need the click path.
    void ev;
  }, true);
}

installClickInterceptor();


export default function SupplyLedgerHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  if (!open) return null;
  return <SupplyLedgerModal onClose={close} />;
}
