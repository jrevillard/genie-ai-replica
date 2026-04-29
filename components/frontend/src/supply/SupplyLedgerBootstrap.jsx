/**
 * SupplyLedgerBootstrap — self-mounting root for SupplyLedgerFab.
 * Same pattern as RoleSwitcherBootstrap / InboxBootstrap: inject a
 * dedicated <div> into <body> and render the fab + modal inside it.
 */

import { createRoot } from "react-dom/client";
import SupplyLedgerHost from "./SupplyLedgerFab.jsx";
import "./SupplyPanelInjector.js";  // side-effect: rewrites Dual-Path Medicine-Supply block


const ROOT_ID = "amina-supply-ledger-root";

function mount() {
  if (typeof window === "undefined") return;
  if (window.__aminaSupplyLedgerMounted) return;
  window.__aminaSupplyLedgerMounted = true;

  const attach = () => {
    try {
      if (document.getElementById(ROOT_ID)) return;
      const host = document.createElement("div");
      host.id = ROOT_ID;
      document.body.appendChild(host);
      createRoot(host).render(<SupplyLedgerHost />);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("SupplyLedgerBootstrap mount failed:", e);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach);
  } else {
    attach();
  }
}

mount();
