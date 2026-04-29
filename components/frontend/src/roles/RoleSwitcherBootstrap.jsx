/**
 * RoleSwitcherBootstrap — self-mounting root for the floating role pill.
 * Same pattern as InboxBootstrap / ResilienceBootstrap / ScribeBootstrap.
 *
 * Also pulls in SupplyLedgerBootstrap as a side-effect import — the
 * admin-patient (and clinician) medicine-supply ledger adds a floating
 * button + modal that sits beside the role pill. Chaining the import
 * here keeps the bootstrap graph shallow: main.jsx → LiteracyBootstrap
 * → InboxBootstrap → RoleSwitcherBootstrap → SupplyLedgerBootstrap.
 */

import "../router/RouterBootstrap.jsx";             // side-effect: boot-time role purge + hash router overlay (Home/Login/Signup/Chat pages)
import "../inbox/InboxAuthWatcher.js";              // side-effect: fire amina:auth-changed on token change (fixes same-tab post-30s login)
import "../session/SessionBootstrap.jsx";           // side-effect: multi-session slots + SessionSwitcher pill (top-left)
import "./RoleGates.js";                            // side-effect: CSS that hides wrong-role buttons
import "../supply/SupplyLedgerBootstrap.jsx";      // side-effect: supply-ledger modal + panel injector
import "../dualpath/DualPathLedgerBootstrap.jsx";  // side-effect: dual-path ledger modal + panel injector
import "../scouts/ScoutManagerBootstrap.jsx";      // side-effect: Alkalo scout manager modal + card injector
import "../village/VillageManagerBootstrap.jsx";   // side-effect: Village scoreboard manager + details-panel injector
import "../bantaba/BantabaManagerBootstrap.jsx";   // side-effect: per-patient Bantaba circle manager + panel redesign
import "../caregiver_inbox/CaregiverInboxBootstrap.jsx"; // side-effect: caregiver-scoped inbox bell (auto-hides for patient tokens)
import "../policy/PolicyReviewBootstrap.jsx";           // side-effect: caregiver policy-review modal (opens on click of policy:* inbox items)
import "../admin/AdminNotificationBootstrap.jsx";       // side-effect: admin notification bell (CG approvals, literacy verify, care transfers)
import "../notifications/ChatToastBootstrap.jsx";       // side-effect: chat + emergency toast pop-ups (patient + caregiver)
import "../emergency/EmergencyBootstrap.jsx";           // side-effect: patient 199 banner + caregiver action strip + escalation fetch interceptor
import { createRoot } from "react-dom/client";
import RoleSwitcher from "./RoleSwitcher.jsx";

const ROOT_ID = "amina-role-switcher-root";

function mount() {
  if (typeof window === "undefined") return;
  if (window.__aminaRoleSwitcherMounted) return;
  window.__aminaRoleSwitcherMounted = true;

  const attach = () => {
    try {
      if (document.getElementById(ROOT_ID)) return;
      const host = document.createElement("div");
      host.id = ROOT_ID;
      document.body.appendChild(host);
      createRoot(host).render(<RoleSwitcher />);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("RoleSwitcherBootstrap mount failed:", e);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach);
  } else {
    attach();
  }
}

mount();
