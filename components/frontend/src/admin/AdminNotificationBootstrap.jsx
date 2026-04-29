/**
 * AdminNotificationBootstrap — self-mounting admin notification bell.
 *
 * Same additive pattern as CaregiverInboxBootstrap / PolicyReviewBootstrap.
 * Mounts the bell into a fresh <div id="amina-admin-bell-root">.
 *
 * Visibility is gated inside <AdminNotificationBell />: it only renders
 * when AMINA_TOKEN decodes to role=admin. Mounting unconditionally is
 * safe for non-admin sessions (no DOM, no API calls).
 *
 * Wired by RoleSwitcherBootstrap.jsx with a single side-effect import.
 */

import { createRoot } from "react-dom/client";
import AdminNotificationBell from "./AdminNotificationBell.jsx";
import "./AdminReviewToast.jsx";          // side-effect: center-top approve/reject toast + fetch interceptor
import "./ReviewApplicationBootstrap.jsx"; // side-effect: centered approval modal (replaces People.jsx inline-expand panel)
import "./PrivacyPolicyBootstrap.jsx";     // side-effect: gov privacy policy popup on every admin login + logout
import "./LLMProviderBadgeBootstrap.jsx";  // side-effect: admin-only LLM provider/fallback badge driven by X-LLM-* headers

const ROOT_ID = "amina-admin-bell-root";

function mount() {
  if (typeof window === "undefined") return;
  if (window.__aminaAdminBellMounted) return;
  window.__aminaAdminBellMounted = true;

  const attach = () => {
    try {
      if (document.getElementById(ROOT_ID)) return;
      const host = document.createElement("div");
      host.id = ROOT_ID;
      document.body.appendChild(host);
      createRoot(host).render(<AdminNotificationBell />);
    } catch (e) {
      console.warn("AdminNotificationBootstrap mount failed:", e);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach);
  } else {
    attach();
  }
}

mount();

export default AdminNotificationBell;
