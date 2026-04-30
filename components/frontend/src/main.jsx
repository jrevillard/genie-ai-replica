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

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
