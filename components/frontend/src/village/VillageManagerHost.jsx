/**
 * VillageManagerHost — hijacks the VillageCard's edit button and
 * surfaces the professional Village manager modal for VHW / Alkalo /
 * Admin, in place of App.jsx's legacy single-field edit modal.
 *
 * Selector: button.ccard-edit-btn[title="Update village scoreboard"]
 * (App.jsx:1150). Same capture-phase trick as Supply + DualPath
 * interceptors — stop React's onClick from firing, fire our open-event.
 */

import { useCallback, useEffect, useState } from "react";
import VillageManagerModal from "./VillageManagerModal.jsx";


const TITLE_MATCH = "update village scoreboard";
const OPEN_EVENT  = "amina:open-village-manager";


function installClickInterceptor() {
  if (typeof window === "undefined") return;
  if (window.__aminaVillageManagerInterceptor) return;
  window.__aminaVillageManagerInterceptor = true;

  const handler = (ev) => {
    let el = ev.target;
    while (el && el !== document) {
      if (el.nodeType === 1
          && el.tagName === "BUTTON"
          && (el.getAttribute("title") || "").toLowerCase() === TITLE_MATCH) {
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


export default function VillageManagerHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  const close = useCallback(() => setOpen(false), []);
  if (!open) return null;
  return <VillageManagerModal onClose={close} />;
}
