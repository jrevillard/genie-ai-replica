/**
 * Dhis2TrackerBootstrap
 * =========================
 * Self-mounting admin-only floating button that opens the DHIS2 Tracker
 * panel (patient-level writeback) as a full-screen modal.
 *
 * Visibility rules
 *   - Only shows when `localStorage.AMINA_TOKEN` contains a JWT whose `role`
 *     claim is "admin". Patients + caregivers never see this FAB.
 *   - Hidden while another full-screen modal is already open (Inbox, Scribe,
 *     SMART consent, etc.) by relying on z-index stacking + the ESC key
 *     closing the topmost overlay.
 *
 * Position
 *   Bottom-right, z-index 9245 — slightly below the InboxBell (9250) and
 *   ChannelLinkFab (9250) so those stay on top for patient-side sessions,
 *   but above the regular shell.
 *
 * Idempotent via `window.__aminaTrackerMounted`.
 */

import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import Dhis2TrackerPanel from "./Dhis2TrackerPanel.jsx";


// ── JWT role sniffer (no verification; this is UI-only gating) ──────────────

function decodeJwtPayload(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const pad = "=".repeat((4 - (parts[1].length % 4)) % 4);
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/") + pad;
    const json = atob(b64);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function readAdminToken() {
  try {
    // The admin dashboard stores its JWT at AMINA_ADMIN_TOKEN (see
    // App.jsx line ~2357). Patient/caregiver tokens live at AMINA_TOKEN
    // — those should NEVER trigger the admin FAB, even if a JWT somehow
    // carries role=admin under the patient key. We check both so a dev
    // can still test by setting AMINA_TOKEN manually, but the canonical
    // source is the admin-specific key.
    const candidates = [
      localStorage.getItem("AMINA_ADMIN_TOKEN"),
      localStorage.getItem("AMINA_TOKEN"),
    ];
    for (const tok of candidates) {
      if (!tok) continue;
      const payload = decodeJwtPayload(tok);
      if (!payload) continue;
      if (payload.role !== "admin") continue;
      if (payload.exp && payload.exp * 1000 < Date.now()) continue;
      return tok;
    }
    return "";
  } catch {
    return "";
  }
}


// ── Overlay component ───────────────────────────────────────────────────────

function TrackerOverlay() {
  const [token, setToken] = useState(readAdminToken);
  const [open,  setOpen]  = useState(false);

  useEffect(() => {
    const sync = () => setToken(readAdminToken());
    window.addEventListener("storage", sync);
    window.addEventListener("amina:auth-changed", sync);
    const t = setInterval(sync, 2500);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("amina:auth-changed", sync);
      clearInterval(t);
    };
  }, []);

  // Close the modal on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  if (!token) return null;   // non-admin → no FAB

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label="Open DHIS2 Tracker admin panel"
        title="DHIS2 Tracker (admin)"
        style={{
          position:   "fixed",
          bottom:     20,
          right:      20,
          zIndex:     9245,
          display:    "inline-flex",
          alignItems: "center",
          gap:        8,
          padding:    "10px 16px 10px 12px",
          border:     "none",
          cursor:     "pointer",
          background: "linear-gradient(135deg, #1e3a8a, #0891b2)",
          color:      "#fff",
          borderRadius: 999,
          boxShadow:  "0 6px 20px rgba(15, 23, 42, 0.35)",
          fontSize:   13,
          fontWeight: 600,
          fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          transition: "transform 140ms ease, box-shadow 140ms ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "scale(1.05)";
          e.currentTarget.style.boxShadow = "0 8px 24px rgba(15, 23, 42, 0.45)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "scale(1)";
          e.currentTarget.style.boxShadow = "0 6px 20px rgba(15, 23, 42, 0.35)";
        }}
      >
        <span aria-hidden="true" style={{
          width: 22, height: 22, display: "inline-flex",
          alignItems: "center", justifyContent: "center",
          background: "rgba(255,255,255,0.22)",
          borderRadius: 999,
        }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2.4"
               strokeLinecap="round" strokeLinejoin="round"
               aria-hidden="true">
            <path d="M3 12h4l3-9 4 18 3-9h4" />
          </svg>
        </span>
        DHIS2 Tracker
      </button>

      {open ? (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}
          style={{
            position: "fixed", inset: 0, zIndex: 9296,
            background: "rgba(15, 23, 42, 0.65)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16,
            animation: "amina-tracker-fade 180ms ease",
          }}
        >
          <Dhis2TrackerPanel token={token} onClose={close} />
          <style>{`
            @keyframes amina-tracker-fade {
              from { opacity: 0; } to { opacity: 1; }
            }
          `}</style>
        </div>
      ) : null}
    </>
  );
}


// ── Self-mount ──────────────────────────────────────────────────────────────

const ROOT_ID = "amina-tracker-root";

function mountTracker() {
  if (typeof window === "undefined") return;
  if (window.__aminaTrackerMounted) return;
  window.__aminaTrackerMounted = true;

  const attach = () => {
    try {
      if (document.getElementById(ROOT_ID)) return;
      const host = document.createElement("div");
      host.id = ROOT_ID;
      document.body.appendChild(host);
      createRoot(host).render(<TrackerOverlay />);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("Dhis2TrackerBootstrap mount failed:", e);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach);
  } else {
    attach();
  }
}

mountTracker();
