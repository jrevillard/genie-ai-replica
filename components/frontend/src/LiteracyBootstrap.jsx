/**
 * LiteracyBootstrap — self-mounting literacy-mode + education onboarding.
 *
 * Side-effect import. Adding `import "./LiteracyBootstrap.jsx";` to
 * main.jsx is enough to wire the entire literacy system into the
 * patient app without editing App.jsx.
 *
 * What it does:
 *   1. Imports LiteracyShell.css so the mode-driven style rules are
 *      always loaded.
 *   2. Creates a dedicated <div id="amina-literacy-root"> appended to
 *      <body> and mounts its own React root into it.
 *   3. Watches localStorage for the patient JWT (key: AMINA_TOKEN).
 *      (Caregivers don't get a literacy mode — they are operators,
 *      not patients, and already run the full caregiver portal.)
 *   4. When a patient token is available, calls GET /api/v1/literacy/me:
 *        - Sets document.body.dataset.literacyMode to current_mode.
 *        - If `needs_onboarding: true`, renders <EducationOnboardingGate />
 *          as a blocking modal (z-index 10000, above ConsentGate's 9999).
 *        - Renders a small mode badge in the corner so the user and
 *          admin QA can see which mode is active.
 *   5. Re-polls /literacy/me after the onboarding gate is submitted so
 *      the mode updates live.
 *
 * All failures are silent — the rest of the app never blocks on this.
 */

import { useEffect, useState, useCallback } from "react";
import ReactDOM from "react-dom/client";
import EducationOnboardingGate from "./EducationOnboardingGate.jsx";
import BeginnerShell from "./BeginnerShell.jsx";
import BasicShell    from "./BasicShell.jsx";
import ChannelLinkFab from "./ChannelLinkFab.jsx";
import "./InboxBootstrap.jsx";   // side-effect: mounts inbox bell + form dispatcher
import "./LiteracyShell.css";

const API = (window.AMINA_API || "http://localhost:8000").replace(/\/+$/, "");

const MODE_BADGE_TEXT = {
  beginner: "Beginner mode",
  basic:    "Basic mode",
  advanced: "Advanced mode",
};

// ── Auth reader ─────────────────────────────────────────────────────────────

function readPatientAuth() {
  try {
    // Literacy applies to patients only. Skip if caregiver is active.
    if (localStorage.getItem("cg_token")) return null;
    const token = localStorage.getItem("AMINA_TOKEN");
    if (!token) return null;
    let name = "";
    try {
      name = JSON.parse(localStorage.getItem("AMINA_PATIENT") || "null")?.name || "";
    } catch {}
    return { token, name };
  } catch {
    return null;
  }
}


// ── Body attribute helper ───────────────────────────────────────────────────

function applyBodyMode(mode) {
  try {
    if (!mode) {
      document.body.removeAttribute("data-literacy-mode");
      return;
    }
    document.body.dataset.literacyMode = mode;
  } catch {
    /* noop */
  }
}


// ── Mode badge ──────────────────────────────────────────────────────────────

function ModeBadge({ mode }) {
  if (!mode) return null;
  return (
    <div id="amina-literacy-badge" data-literacy-ignore>
      {MODE_BADGE_TEXT[mode] || mode}
    </div>
  );
}


// ── Main component ──────────────────────────────────────────────────────────

function LiteracyBootstrapInner() {
  const [auth, setAuth]           = useState(readPatientAuth);
  const [profile, setProfile]     = useState(null);   // /literacy/me response
  const [loaded, setLoaded]       = useState(false);

  const fetchProfile = useCallback(async (tok) => {
    if (!tok) { setProfile(null); return; }
    try {
      const r = await fetch(`${API}/api/v1/literacy/me`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (!r.ok) { setProfile(null); return; }
      const j = await r.json();
      setProfile(j);
      applyBodyMode(j.current_mode || "beginner");
    } catch {
      setProfile(null);
    } finally {
      setLoaded(true);
    }
  }, []);

  // Watch localStorage — login/logout + cross-tab
  useEffect(() => {
    const onStorage = () => setAuth(readPatientAuth());
    window.addEventListener("storage", onStorage);
    const t = setInterval(() => {
      const next = readPatientAuth();
      setAuth(prev => {
        const a = next?.token || "";
        const b = prev?.token || "";
        if (a === b) return prev;
        setProfile(null);
        setLoaded(false);
        return next;
      });
    }, 1500);
    return () => {
      window.removeEventListener("storage", onStorage);
      clearInterval(t);
    };
  }, []);

  // Fetch profile whenever auth changes
  useEffect(() => {
    if (!auth) {
      applyBodyMode(null);
      setProfile(null);
      setLoaded(false);
      return;
    }
    fetchProfile(auth.token);
  }, [auth, fetchProfile]);

  // Re-poll every 60s so admin approvals flip the mode live
  useEffect(() => {
    if (!auth) return;
    const t = setInterval(() => fetchProfile(auth.token), 60_000);
    return () => clearInterval(t);
  }, [auth, fetchProfile]);

  // No patient token → nothing to render
  if (!auth) return null;
  if (!loaded) return null;

  // Onboarding gate — blocks until the patient declares a level
  if (profile && profile.needs_onboarding) {
    return (
      <EducationOnboardingGate
        token={auth.token}
        patientName={auth.name}
        onDone={() => fetchProfile(auth.token)}
      />
    );
  }

  // Beginner mode — replace the entire patient UI with the simplified
  // BeginnerShell (big tiles, no sidebar, no community, no caregiver
  // invite). Still renders the mode badge alongside so users and QA
  // can see which mode is active.
  if (profile && profile.current_mode === "beginner") {
    return (
      <>
        <BeginnerShell
          token={auth.token}
          patientName={auth.name}
        />
        <ModeBadge mode="beginner" />
        <ChannelLinkFab />
      </>
    );
  }

  // Basic mode — replace the patient UI with the denser BasicShell,
  // which keeps every beginner feature and adds Choose-a-Topic,
  // Community Events, and Dual-Path Care on top.
  if (profile && profile.current_mode === "basic") {
    return (
      <>
        <BasicShell
          token={auth.token}
          patientName={auth.name}
        />
        <ModeBadge mode="basic" />
        <ChannelLinkFab />
      </>
    );
  }

  // Advanced mode — the full Amina UI is already rendering in the main
  // React root (#root) underneath this literacy root (#amina-literacy-root).
  // We deliberately render nothing over it except the corner mode badge,
  // so the patient gets every clinician-grade feature untouched.
  if (profile && profile.current_mode === "advanced") {
    return (
      <>
        <ModeBadge mode="advanced" />
        <ChannelLinkFab />
      </>
    );
  }

  // Unknown / missing mode — fail open to the full App with a badge.
  return (
    <>
      <ModeBadge mode={profile?.current_mode} />
      <ChannelLinkFab />
    </>
  );
}


// ── Self-mount (side-effect) ────────────────────────────────────────────────

(function bootstrap() {
  if (typeof window === "undefined") return;
  if (window.__AMINA_LITERACY_MOUNTED) return;
  window.__AMINA_LITERACY_MOUNTED = true;

  const mount = () => {
    try {
      if (document.getElementById("amina-literacy-root")) return;
      const host = document.createElement("div");
      host.id = "amina-literacy-root";
      document.body.appendChild(host);
      ReactDOM.createRoot(host).render(<LiteracyBootstrapInner />);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("LiteracyBootstrap mount failed:", e);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();

export default LiteracyBootstrapInner;
