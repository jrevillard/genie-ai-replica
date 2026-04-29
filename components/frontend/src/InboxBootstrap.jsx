/**
 * InboxBootstrap — self-mounting root for the Inbox + Forms overlay.
 *
 * Mirrors the pattern used by LiteracyBootstrap / ConsentBootstrap:
 *   - Inject our own <div id="amina-inbox-root"> into <body>.
 *   - Render <InboxBell /> + <FormDispatcher /> into it via createRoot.
 *   - Install the fetch interceptor so /agent/chat responses fire the
 *     suggest_form event.
 *
 * Visibility rules
 *   - Only shows if there is a logged-in patient (localStorage.AMINA_TOKEN
 *     + localStorage.AMINA_PATIENT present).
 *   - Re-evaluates on window `storage` events (login from another tab) and
 *     on a custom `amina:auth-changed` event which App.jsx *could* fire if
 *     it wanted — we don't require it, we also poll once per 2s for the
 *     first 30s after boot.
 *
 * Mount is idempotent: calling mountInboxBootstrap() more than once is safe.
 */

import { createRoot } from "react-dom/client";
import "./i18n/I18nBootstrap.jsx";              // side-effect: i18next init + language picker
import InboxBell       from "./inbox/InboxBell.jsx";
import FormDispatcher  from "./forms/FormDispatcher.jsx";
import { installChatInterceptor } from "./inbox/chatInterceptor.js";
import "./resilience/ResilienceBootstrap.jsx";   // side-effect: model-switch banner
import "./scribe/ScribeBootstrap.jsx";           // side-effect: ambient scribe FAB
import "./roles/RoleSwitcherBootstrap.jsx";      // side-effect: persistent role-switcher pill (operator/admin only)
// Dhis2TrackerBootstrap disabled — replaced by a proper tab inside
// AdminDashboard.jsx (see the "DHIS2 Tracker" nav entry). The bootstrap
// file remains on disk for future re-enable.

const ROOT_ID = "amina-inbox-root";

function hasPatientJWT() {
  try {
    return Boolean(
      localStorage.getItem("AMINA_TOKEN") &&
      localStorage.getItem("AMINA_PATIENT"),
    );
  } catch {
    return false;
  }
}

function OverlayApp() {
  // We deliberately don't gate internal components — InboxBell does its
  // own polling and handles 401s gracefully (unread=0). The outer gate
  // in mountInboxBootstrap() decides whether to mount at all.
  return (
    <>
      <InboxBell enabled={true} />
      <FormDispatcher />
    </>
  );
}

export function mountInboxBootstrap() {
  if (typeof window === "undefined") return;

  // Always install the interceptor — it does nothing until a chat call
  // actually happens, and it's safe pre-auth because the non-matching
  // calls pass through unchanged.
  installChatInterceptor();

  const render = () => {
    let root = document.getElementById(ROOT_ID);
    if (!hasPatientJWT()) {
      // Tear down if already mounted and user signed out.
      if (root && root.__aminaReactRoot) {
        try { root.__aminaReactRoot.unmount(); } catch { /* ignore */ }
        root.__aminaReactRoot = null;
      }
      return;
    }
    if (!root) {
      root = document.createElement("div");
      root.id = ROOT_ID;
      document.body.appendChild(root);
    }
    if (!root.__aminaReactRoot) {
      const r = createRoot(root);
      root.__aminaReactRoot = r;
      r.render(<OverlayApp />);
    }
  };

  // Initial render + re-check cadence for first 30s (covers typical
  // "load page → fill login → submit" flow).
  render();
  let ticks = 0;
  const interval = setInterval(() => {
    render();
    if (++ticks >= 15) clearInterval(interval);   // 15 * 2s = 30s
  }, 2000);

  // Respond to cross-tab login/logout and to explicit signal.
  window.addEventListener("storage", (e) => {
    if (!e.key || e.key.startsWith("AMINA_")) render();
  });
  window.addEventListener("amina:auth-changed", render);
}

// Auto-mount on import. Vite handles this as a side effect when the
// module is imported by main.jsx (via LiteracyBootstrap).
mountInboxBootstrap();
