/**
 * PlatformSideEffect — self-mounting bootstrap for gov-chat platform features.
 *
 * Side-effect import. Adding `import "./platform/PlatformSideEffect.jsx";`
 * to main.jsx wires all 9 platform modules into the AMINA frontend
 * without editing any existing files.
 *
 * What it does:
 *   1. Registers all platform components on window.AMINA_PLATFORM so
 *      existing components (App.jsx, AdminShell, ChatPage) can access
 *      them without import changes.
 *   2. Starts session keep-alive pings when AMINA_SID is present.
 *   3. Listens for hash routes #/reset-password/:token and
 *      #/verify-email/:token to render auth flow modals.
 *
 * All failures are silent — the rest of the app never blocks on this.
 */

import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";

import ChatFolders from "./components/ChatFolders";
import AnalyticsDashboard from "./components/AnalyticsDashboard";
import AdminSystemHealth from "./components/AdminSystemHealth";
import ServiceTreeBrowser from "./components/ServiceTreeBrowser";
import QueryRecommendations from "./components/QueryRecommendations";
import ConversationExport from "./components/ConversationExport";
import { ChatFeedbackDialog, InlineThumbFeedback } from "./components/ChatFeedback";
import {
  ForgotPasswordForm,
  ResetPasswordForm,
  EmailVerification,
  ChangePasswordForm,
} from "./components/AuthFlows";
import { sessionApi } from "./api/platformApi";
import "./utils/negationFilter";
import "./utils/streamingChat";
import ScoutDirectoryPanel from "../scouts/ScoutDirectoryPanel";
import { AlkaloSuggestionReviewPanel } from "../scouts/AlkaloSuggestionReview";
import "../scouts/AlkaloSuggestionReview";
import "../inbox/RoleInboxBell";

// ── Global registry ──────────────────────────────────────────────────

if (typeof window !== "undefined") {
  window.AMINA_PLATFORM = {
    ChatFolders,
    AnalyticsDashboard,
    AdminSystemHealth,
    ServiceTreeBrowser,
    QueryRecommendations,
    ConversationExport,
    ChatFeedbackDialog,
    InlineThumbFeedback,
    ForgotPasswordForm,
    ResetPasswordForm,
    EmailVerification,
    ChangePasswordForm,
    ScoutDirectoryPanel,
    AlkaloSuggestionReviewPanel,
  };
}

// ── Session keep-alive ───────────────────────────────────────────────

let _keepAliveTimer = null;

function startKeepAlive() {
  const sid = localStorage.getItem("AMINA_SID");
  if (!sid || _keepAliveTimer) return;

  const ping = () => sessionApi.keepAlive(sid).catch(() => {});
  ping();
  _keepAliveTimer = setInterval(ping, 60_000);

  window.addEventListener("beforeunload", () => {
    clearInterval(_keepAliveTimer);
    navigator.sendBeacon?.(
      `${import.meta.env.VITE_GOV_API_URL || "http://localhost:3000/api"}/sessions/${sid}/end`,
      ""
    );
  });
}

// ── Auth flow overlay (password reset / email verify) ────────────────

function AuthFlowOverlay() {
  const [route, setRoute] = useState(null);

  useEffect(() => {
    const check = () => {
      const hash = window.location.hash || "";
      const resetMatch = hash.match(/#\/reset-password\/(.+)/);
      const verifyMatch = hash.match(/#\/verify-email\/(.+)/);
      if (resetMatch) setRoute({ type: "reset", token: resetMatch[1] });
      else if (verifyMatch) setRoute({ type: "verify", token: verifyMatch[1] });
      else setRoute(null);
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);

  if (!route) return null;

  const close = () => {
    window.location.hash = "#/login";
    setRoute(null);
  };

  if (route.type === "reset") {
    return (
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
        background: "rgba(0,0,0,0.4)", zIndex: 10001,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <ResetPasswordForm token={route.token} onSuccess={close} />
      </div>
    );
  }

  if (route.type === "verify") {
    return (
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
        background: "rgba(0,0,0,0.4)", zIndex: 10001,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <EmailVerification token={route.token} />
      </div>
    );
  }

  return null;
}

// ── Self-mount ───────────────────────────────────────────────────────

try {
  startKeepAlive();

  const el = document.createElement("div");
  el.id = "amina-platform-root";
  document.body.appendChild(el);

  ReactDOM.createRoot(el).render(<AuthFlowOverlay />);

  console.log("[Platform] 9 gov-chat modules registered on window.AMINA_PLATFORM");
} catch (e) {
  console.warn("[Platform] bootstrap failed (non-fatal):", e);
}
