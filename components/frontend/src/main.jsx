import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import "./ConsentBootstrap.jsx";
import "./AdminPatientLiteracyOverride.jsx";
import "./LiteracyBootstrap.jsx";
import "./i18n/v2_optin.js";
import "./platform/PlatformSideEffect.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
