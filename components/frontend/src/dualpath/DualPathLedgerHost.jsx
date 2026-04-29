/**
 * DualPathLedgerHost — hijacks the "Care paths" edit entry points and
 * opens the multi-entry ledger modal instead of App.jsx's single-record
 * Update Dual-Path Care form.
 *
 * We intercept TWO elements because App.jsx (lines 1227-1237) renders
 * different markup depending on the (old) canEditCarePath gate:
 *
 *   - <button title="Update dual-path care">        — when clinician/admin
 *   - <span   title="Care path edits are locked…">  — for everyone else
 *
 * After the 2026-04-19 role split, care paths are VHW-owned. App.jsx
 * still uses its old gate so VHW sees the disabled span. We intercept
 * BOTH targets so the ledger opens regardless of which element React
 * rendered — the per-role write gate is then enforced inside the modal.
 */

import { useCallback, useEffect, useState } from "react";
import DualPathLedgerModal from "./DualPathLedgerModal.jsx";


const TITLES = new Set([
  "update dual-path care",
  "care path edits are locked to clinicians",
]);
const OPEN_EVENT  = "amina:open-dualpath-ledger";


function installClickInterceptor() {
  if (typeof window === "undefined") return;
  if (window.__aminaDualpathLedgerInterceptor) return;
  window.__aminaDualpathLedgerInterceptor = true;

  const handler = (ev) => {
    let el = ev.target;
    while (el && el !== document) {
      if (el.nodeType === 1
          && (el.tagName === "BUTTON" || el.tagName === "SPAN")
          && TITLES.has((el.getAttribute("title") || "").toLowerCase())) {
        ev.preventDefault();
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

  document.addEventListener("click", handler, true);
}

installClickInterceptor();


export default function DualPathLedgerHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  if (!open) return null;
  return <DualPathLedgerModal onClose={close} />;
}
