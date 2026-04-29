/**
 * BantabaManagerBootstrap — self-mounting root for the Bantaba manager
 * modal + side-effect imports of the host wiring and panel injector.
 */

import { createRoot } from "react-dom/client";
import BantabaManagerHost from "./BantabaManagerHost.jsx";
import "./BantabaPanelInjector.js";  // side-effect: redesigned read panel


const ROOT_ID = "amina-bantaba-manager-root";

function mount() {
  if (typeof window === "undefined") return;
  if (window.__aminaBantabaManagerMounted) return;
  window.__aminaBantabaManagerMounted = true;

  const attach = () => {
    try {
      if (document.getElementById(ROOT_ID)) return;
      const host = document.createElement("div");
      host.id = ROOT_ID;
      document.body.appendChild(host);
      createRoot(host).render(<BantabaManagerHost />);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("BantabaManagerBootstrap mount failed:", e);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach);
  } else {
    attach();
  }
}

mount();
