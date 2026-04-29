/**
 * ScoutManagerBootstrap — self-mounting root for the Alkalo scout
 * manager (modal + DOM-injected card button).
 */

import { createRoot } from "react-dom/client";
import ScoutManagerHost from "./ScoutManagerHost.jsx";
import ScoutApplicationHost from "./ScoutApplicationHost.jsx";
import ScoutDirectoryHost from "./ScoutDirectoryHost.jsx";


const ROOT_ID = "amina-scout-manager-root";
const APPLY_ROOT_ID = "amina-scout-apply-root";
const DIR_ROOT_ID = "amina-scout-directory-root";

function mount() {
  if (typeof window === "undefined") return;
  if (window.__aminaScoutManagerMounted) return;
  window.__aminaScoutManagerMounted = true;

  const attach = () => {
    try {
      if (document.getElementById(ROOT_ID)) return;
      const host = document.createElement("div");
      host.id = ROOT_ID;
      document.body.appendChild(host);
      createRoot(host).render(<ScoutManagerHost />);

      // Second root: the patient scout-application modal. Separate
      // host so the ApplyModal can open even when ScoutManagerHost's
      // alkalo-only button injector is hidden.
      if (!document.getElementById(APPLY_ROOT_ID)) {
        const applyHost = document.createElement("div");
        applyHost.id = APPLY_ROOT_ID;
        document.body.appendChild(applyHost);
        createRoot(applyHost).render(<ScoutApplicationHost />);
      }

      if (!document.getElementById(DIR_ROOT_ID)) {
        const dirHost = document.createElement("div");
        dirHost.id = DIR_ROOT_ID;
        document.body.appendChild(dirHost);
        createRoot(dirHost).render(<ScoutDirectoryHost />);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("ScoutManagerBootstrap mount failed:", e);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach);
  } else {
    attach();
  }
}

mount();
