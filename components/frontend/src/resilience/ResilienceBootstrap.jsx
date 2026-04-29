/**
 * ResilienceBootstrap
 * ======================
 * Self-mounting root for ModelSwitchBanner. Mirrors the pattern used by
 * InboxBootstrap (own <div> appended to body, own React root).
 *
 * We do NOT bundle the banner into InboxBootstrap because:
 *   - The banner must be mounted even on the error/login screens where
 *     the inbox overlay is hidden (a model switch can happen on the
 *     *very first* chat the user sends, before the inbox would open).
 *   - Banner lifetime is totally independent of inbox auth state.
 *
 * Install is idempotent — importing this module more than once (HMR,
 * strict-mode double render, etc.) is a no-op.
 */

import { createRoot } from "react-dom/client";
import ModelSwitchBanner from "./ModelSwitchBanner.jsx";

const ROOT_ID = "amina-resilience-root";

function mountResilience() {
  if (typeof window === "undefined") return;
  if (window.__aminaResilienceMounted) return;
  window.__aminaResilienceMounted = true;

  const attach = () => {
    try {
      if (document.getElementById(ROOT_ID)) return;
      const host = document.createElement("div");
      host.id = ROOT_ID;
      document.body.appendChild(host);
      createRoot(host).render(<ModelSwitchBanner />);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("ResilienceBootstrap mount failed:", e);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach);
  } else {
    attach();
  }
}

// Auto-mount as side effect.
mountResilience();
