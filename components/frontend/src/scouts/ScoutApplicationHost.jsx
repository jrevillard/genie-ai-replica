/**
 * ScoutApplicationHost — hijacks the "Become a Health Scout" quick-tile
 * in App.jsx (class `quick-tile-scout-apply`) and opens our richer
 * ScoutApplicationModal with locality + availability + reason fields.
 *
 * Legacy App.jsx modal still exists; we just never let the click reach
 * the React handler, so our modal wins.
 */

import { useCallback, useEffect, useState } from "react";
import ScoutApplicationModal from "./ScoutApplicationModal.jsx";


const OPEN_EVENT = "amina:open-scout-application";


function installClickInterceptor() {
  if (typeof window === "undefined") return;
  if (window.__aminaScoutApplyInterceptor) return;
  window.__aminaScoutApplyInterceptor = true;

  const handler = (ev) => {
    let el = ev.target;
    while (el && el !== document) {
      if (el.nodeType === 1 && el.classList?.contains("quick-tile-scout-apply")) {
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

installClickInterceptor();


export default function ScoutApplicationHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  const close = useCallback(() => setOpen(false), []);
  if (!open) return null;
  return <ScoutApplicationModal onClose={close} />;
}
