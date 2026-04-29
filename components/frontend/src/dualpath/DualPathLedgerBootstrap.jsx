/**
 * DualPathLedgerBootstrap — self-mounting root for DualPathLedgerHost
 * + side-effect import of DualPathPanelInjector.
 */

import { createRoot } from "react-dom/client";
import DualPathLedgerHost from "./DualPathLedgerHost.jsx";
import "./DualPathPanelInjector.js";  // side-effect: rewrites Dual-Path Care side panel


const ROOT_ID = "amina-dualpath-ledger-root";

function mount() {
  if (typeof window === "undefined") return;
  if (window.__aminaDualpathLedgerMounted) return;
  window.__aminaDualpathLedgerMounted = true;

  const attach = () => {
    try {
      if (document.getElementById(ROOT_ID)) return;
      const host = document.createElement("div");
      host.id = ROOT_ID;
      document.body.appendChild(host);
      createRoot(host).render(<DualPathLedgerHost />);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("DualPathLedgerBootstrap mount failed:", e);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach);
  } else {
    attach();
  }
}

mount();
