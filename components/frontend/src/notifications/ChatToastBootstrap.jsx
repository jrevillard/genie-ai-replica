/**
 * ChatToastBootstrap — self-mounting root for ChatToastHost.
 * One React root, one instance per tab. Works for patient + caregiver
 * sessions (the host decides at poll time which role/partner to use).
 */

import { createRoot } from "react-dom/client";
import ChatToastHost from "./ChatToastHost.jsx";


const ROOT_ID = "amina-chat-toast-root";


function mount() {
  if (typeof window === "undefined") return;
  if (window.__aminaChatToastMounted) return;
  window.__aminaChatToastMounted = true;

  const attach = () => {
    try {
      if (document.getElementById(ROOT_ID)) return;
      const host = document.createElement("div");
      host.id = ROOT_ID;
      document.body.appendChild(host);
      createRoot(host).render(<ChatToastHost />);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("ChatToastBootstrap mount failed:", e);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach);
  } else {
    attach();
  }
}

mount();
