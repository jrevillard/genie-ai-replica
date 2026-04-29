/**
 * PlatformBootstrap
 * =================
 * Mounts gov-chat platform features into the AMINA React frontend.
 * Drop this component anywhere in the render tree (e.g. inside
 * LiteracyBootstrap or RoleSwitcherBootstrap) — it auto-activates
 * session keep-alive and makes all platform components available
 * via the window.AMINA_PLATFORM registry.
 *
 * UI components are lazily imported by the admin shell / chat page
 * via the exported helpers.
 */

import { useEffect } from "react";
import SessionKeepAlive from "./components/SessionKeepAlive";

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

// Expose all platform components on a global registry so any part
// of the existing AMINA frontend can import them without modifying
// existing files.
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
  };
}

export default function PlatformBootstrap({ children }) {
  const sid = localStorage.getItem("AMINA_SID");

  useEffect(() => {
    console.log("[PlatformBootstrap] mounted — 9 gov-chat modules active");
  }, []);

  return (
    <>
      {sid && <SessionKeepAlive sessionId={sid} />}
      {children}
    </>
  );
}

// Named re-exports for direct import
export {
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
};
