/**
 * RouterBootstrap — mounts AppRouter into its own React root and
 * installs the boot-time active-role purge. Self-mounting so we don't
 * touch main.jsx or App.jsx.
 *
 * IMPORTANT — purge runs as the VERY FIRST thing so App.jsx's init
 * reads a clean localStorage. That's why it lives at the top of the
 * chain (see activeRolePurge.js side-effect).
 */

import "./activeRolePurge.js";      // side-effect: clean cross-role keys BEFORE App.jsx inits
import { createRoot } from "react-dom/client";
import AppRouter from "./AppRouter.jsx";


const ROOT_ID = "amina-router-root";


function mount() {
  if (typeof window === "undefined") return;
  if (window.__aminaRouterMounted) return;
  window.__aminaRouterMounted = true;

  const attach = () => {
    try {
      if (!document.getElementById(ROOT_ID)) {
        const host = document.createElement("div");
        host.id = ROOT_ID;
        document.body.appendChild(host);
        createRoot(host).render(<AppRouter />);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("RouterBootstrap mount failed:", e);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach);
  } else {
    attach();
  }
}


mount();
