/**
 * VillageManagerBootstrap — self-mounting root for the Village manager
 * modal + side-effect import of the details-panel injector.
 */

import { createRoot } from "react-dom/client";
import VillageManagerHost from "./VillageManagerHost.jsx";
import "./VillagePanelInjector.js";   // side-effect: upgrades read-only village panel


const ROOT_ID = "amina-village-manager-root";

function mount() {
  if (typeof window === "undefined") return;
  if (window.__aminaVillageManagerMounted) return;
  window.__aminaVillageManagerMounted = true;

  const attach = () => {
    try {
      if (document.getElementById(ROOT_ID)) return;
      const host = document.createElement("div");
      host.id = ROOT_ID;
      document.body.appendChild(host);
      createRoot(host).render(<VillageManagerHost />);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("VillageManagerBootstrap mount failed:", e);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach);
  } else {
    attach();
  }
}

mount();
