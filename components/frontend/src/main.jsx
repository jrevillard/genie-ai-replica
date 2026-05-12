import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import "./ConsentBootstrap.jsx";
import "./AdminPatientLiteracyOverride.jsx";
import "./LiteracyBootstrap.jsx";
import "./i18n/v2_optin.js";
import "./platform/PlatformSideEffect.jsx";
// Phase 5 — warn-only re-consent gate for existing caregivers. Mounts
// its own React root in <body>; never blocks the portal. See module
// docstring for the full behavioural contract.
import "./CaregiverPrivacyReconsentBootstrap.jsx";
// API Gateway security badge — bottom-right pill that confirms the
// jailbreak-protection layer is active. Self-mounting; if the gateway
// is unreachable on :8443 the badge silently renders nothing, so the
// existing UNICC tester flow is unaffected.
import "./GatewaySecurityBadge.jsx";
// Site-wide copyright footer — "© 2026 Amina Care Project. Developed for
// humanitarian use. Submitted under GenIA for Good terms." Self-mounting,
// fixed-bottom, click-through (pointer-events:none) so it never blocks
// the chat input bar or any underlying form.
import "./CopyrightFooter.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
