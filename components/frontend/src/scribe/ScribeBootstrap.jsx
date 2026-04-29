/**
 * ScribeBootstrap — self-mounting root for the scribe FAB + modals.
 * Same pattern as InboxBootstrap / ResilienceBootstrap.
 */

import { createRoot } from "react-dom/client";
import ScribeFab from "./ScribeFab.jsx";

const ROOT_ID = "amina-scribe-root";

function mountScribe() {
  if (typeof window === "undefined") return;
  if (window.__aminaScribeMounted) return;
  window.__aminaScribeMounted = true;

  const attach = () => {
    try {
      if (document.getElementById(ROOT_ID)) return;
      const host = document.createElement("div");
      host.id = ROOT_ID;
      document.body.appendChild(host);
      createRoot(host).render(<ScribeFab />);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("ScribeBootstrap mount failed:", e);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach);
  } else {
    attach();
  }
}

mountScribe();
