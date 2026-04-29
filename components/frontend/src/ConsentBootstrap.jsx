/**
 * ConsentBootstrap — self-mounting training-consent gate.
 *
 * This module is a SIDE-EFFECT import. Adding it to main.jsx with a single
 * `import "./ConsentBootstrap.jsx"` is enough to wire the first-launch
 * training-consent gate into both the patient and caregiver flows.
 *
 * How it works:
 *   1. On module load, creates a dedicated <div id="amina-consent-gate-root">
 *      appended to <body>, and mounts its own React root into it.
 *   2. Polls localStorage for auth tokens (patient: "AMINA_TOKEN",
 *      caregiver: "cg_token"). Caregiver token takes priority if both
 *      are somehow present (caregiver portal is the active surface).
 *   3. When a token becomes available, calls
 *      GET /api/v1/training/consent/me/status.
 *      - If `needs_gate: true`, renders the matching ConsentGate.
 *      - If `decided`, renders nothing (invisible component).
 *   4. When the user makes a decision, the gate POSTs to the backend
 *      and then unmounts itself for the rest of the session.
 *
 * Why a separate React root?
 *   - App.jsx is read-only. Rather than editing App.jsx to mount the
 *     gate inside its tree, we mount a sibling root in <body>. A
 *     full-screen fixed overlay with high z-index behaves identically
 *     to a modal inside App.jsx from the user's perspective.
 */

import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import ConsentGate from "./ConsentGate.jsx";
import CaregiverConsentGate from "./CaregiverConsentGate.jsx";

const API = (window.AMINA_API || "http://localhost:8000").replace(/\/+$/, "");

// ── Auth state reader ────────────────────────────────────────────────────────

function readAuth() {
  try {
    // Caregiver portal takes priority if logged in
    const cgToken = localStorage.getItem("cg_token");
    if (cgToken) {
      let name = "";
      try {
        name = JSON.parse(localStorage.getItem("cg_info") || "null")?.name || "";
      } catch {}
      return { role: "caregiver", token: cgToken, name };
    }
    const pToken = localStorage.getItem("AMINA_TOKEN");
    if (pToken) {
      let name = "";
      try {
        name = JSON.parse(localStorage.getItem("AMINA_PATIENT") || "null")?.name || "";
      } catch {}
      return { role: "patient", token: pToken, name };
    }
  } catch {
    // localStorage unavailable (SSR, privacy mode) — silently bail
  }
  return null;
}


// ── React component ──────────────────────────────────────────────────────────

function ConsentBootstrapInner() {
  const [auth, setAuth]       = useState(readAuth);
  const [status, setStatus]   = useState(null); // { needs_gate, value, decided } | null
  const [doneThisSession, setDone] = useState(false);

  // Watch localStorage for login/logout (cross-tab + same-tab polling)
  useEffect(() => {
    const onStorage = () => setAuth(readAuth());
    window.addEventListener("storage", onStorage);
    const t = setInterval(() => {
      const next = readAuth();
      setAuth(prev => {
        if ((next?.token || "") === (prev?.token || "") &&
            (next?.role  || "") === (prev?.role  || "")) {
          return prev;
        }
        // Token changed → re-check status
        setDone(false);
        setStatus(null);
        return next;
      });
    }, 1500);
    return () => {
      window.removeEventListener("storage", onStorage);
      clearInterval(t);
    };
  }, []);

  // Fetch consent status whenever auth becomes available
  useEffect(() => {
    if (!auth || doneThisSession) {
      if (!auth) setStatus(null);
      return;
    }
    let cancelled = false;
    fetch(`${API}/api/v1/training/consent/me/status`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) setStatus(d); })
      .catch(() => { if (!cancelled) setStatus(null); });
    return () => { cancelled = true; };
  }, [auth, doneThisSession]);

  if (!auth || !status || !status.needs_gate || doneThisSession) return null;

  const handleClose = (_value) => setDone(true);

  if (auth.role === "caregiver") {
    return (
      <CaregiverConsentGate
        token={auth.token}
        actorName={auth.name}
        onClose={handleClose}
      />
    );
  }
  return (
    <ConsentGate
      token={auth.token}
      actorRole="patient"
      actorName={auth.name}
      onClose={handleClose}
    />
  );
}


// ── Self-mount (side-effect) ────────────────────────────────────────────────

(function bootstrap() {
  if (typeof window === "undefined") return;
  if (window.__AMINA_CONSENT_GATE_MOUNTED) return;
  window.__AMINA_CONSENT_GATE_MOUNTED = true;

  const mount = () => {
    try {
      if (document.getElementById("amina-consent-gate-root")) return;
      const host = document.createElement("div");
      host.id = "amina-consent-gate-root";
      document.body.appendChild(host);
      ReactDOM.createRoot(host).render(<ConsentBootstrapInner />);
    } catch (e) {
      // If anything goes wrong we fail silent — the rest of the app
      // must never be blocked by a gate-mount error.
      // eslint-disable-next-line no-console
      console.warn("ConsentBootstrap mount failed:", e);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();

export default ConsentBootstrapInner;
