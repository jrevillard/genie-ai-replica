/**
 * RoleSwitcher — persistent floating pill that shows the current "acting as"
 * role and lets admins/operators flip between patient / clinician / vhw /
 * admin without diving into Settings → Role picker.
 *
 * Visibility
 *   - Hidden for plain patients (to stop it showing on real user devices).
 *   - Shown for clinician / vhw / admin / alkalo / imam / scout.
 *   - Admin sees the full list; non-admin can only flip between their own
 *     role and "patient" (you can't self-promote to admin via the UI).
 *
 * State
 *   - Reads/writes `localStorage.AMINA_ROLE` directly (same store as
 *     App.jsx state) and fires the storage event so App.jsx picks it up.
 *   - Also dispatches `amina:role-changed` for any non-React listeners.
 *
 * Position
 *   - Top-right, below the InboxBell (top:20 right:20, 46x46), at
 *     top:78 right:78 so it doesn't collide with the bell or the inbox
 *     panel slide-in (right-docked).
 *
 * This is additive: a new self-mounting bootstrap injects its own React
 * root into <body>. Existing App.jsx role-picker in Settings stays
 * unchanged — this is just a faster path.
 */

import { useCallback, useEffect, useRef, useState } from "react";

// Full 7-role matrix — matches the Settings "I am a..." picker in
// App.jsx so the floating switcher and the Settings picker stay in sync.
// Admin can impersonate any of these; non-admin operators can only flip
// between their own role and "patient" (read-only view of the patient UI).
const ROLES = [
  { id: "patient",   label: "Patient",    emoji: "👤", accent: "#64748b" },
  { id: "clinician", label: "Clinician",  emoji: "🩺", accent: "#0891b2" },
  { id: "vhw",       label: "VHW",        emoji: "🎒", accent: "#10b981" },
  { id: "alkalo",    label: "Alkalo",     emoji: "🪪", accent: "#f59e0b" },
  { id: "imam",      label: "Imam",       emoji: "🕌", accent: "#8b5cf6" },
  { id: "scout",     label: "Scout",      emoji: "🏅", accent: "#f97316" },
  { id: "admin",     label: "Admin",      emoji: "🔧", accent: "#ec4899" },
];


function readRole() {
  try {
    const stored = localStorage.getItem("AMINA_ROLE");
    if (stored) return stored;
    if (localStorage.getItem("cg_token")) return "clinician";
    return "patient";
  }
  catch { return "patient"; }
}


// True-admin detection: the switcher must stay visible for admin-patients
// even when their acting-role is "patient" (otherwise they get stuck in
// patient view with no way back). Sources of truth, in order:
//   - AMINA_ADMIN_TOKEN present  → classic /admin/login admin
//   - AMINA_TOKEN with role=admin → admin-patient (ADMIN_PATIENT_EMAILS set
//     server-side; JWT carries the claim and every /admin/* call is honored)
//   - AMINA_PATIENT email in the frontend allowlist → UI affordance only so
//     the pill stays reachable in dev even before the backend env is wired.
//     Clicking the pill still writes AMINA_ROLE + reloads; actual server-
//     side admin privileges depend on the JWT and therefore on the backend
//     ADMIN_PATIENT_EMAILS env var being set.
const ADMIN_PATIENT_EMAILS = new Set([
  "admin@demo.aminacare",
]);

function readIsTrueAdmin() {
  // Three independent branches — each wrapped in its own try/catch so
  // a failure in one (e.g. a malformed AMINA_TOKEN that atob can't
  // decode) doesn't short-circuit the others. Earlier version had a
  // single outer try/catch which meant any JWT parse exception
  // silently skipped the frontend email allowlist, causing the pill
  // to never appear for admin-patients in dev without the backend env.
  //
  // 1. Classic admin-console token → always show.
  try {
    if (localStorage.getItem("AMINA_ADMIN_TOKEN")) return true;
  } catch { /* localStorage access denied — fall through */ }

  // 2. Patient JWT with role=admin claim (server-side promotion via
  //    ADMIN_PATIENT_EMAILS). Works whenever the backend is properly
  //    configured; decoding is best-effort.
  try {
    const tok = localStorage.getItem("AMINA_TOKEN");
    if (tok) {
      const parts = tok.split(".");
      if (parts.length >= 2) {
        const pad = "=".repeat((4 - (parts[1].length % 4)) % 4);
        const b64 = (parts[1] + pad).replace(/-/g, "+").replace(/_/g, "/");
        const payload = JSON.parse(atob(b64));
        if (payload && payload.role === "admin") return true;
      }
    }
  } catch { /* malformed token — the next branch still runs */ }

  // 3. Frontend email allowlist — keeps the pill visible even when the
  //    backend env isn't set. Admin-patient flow depends on this.
  try {
    const patientRaw = localStorage.getItem("AMINA_PATIENT");
    if (patientRaw) {
      const email = (JSON.parse(patientRaw)?.email || "")
        .toString().trim().toLowerCase();
      if (ADMIN_PATIENT_EMAILS.has(email)) return true;
    }
  } catch { /* stored JSON corrupt — fall through */ }

  // 4. Last-ditch — any stringified email stored directly.
  try {
    const rawEmail = (localStorage.getItem("AMINA_PATIENT_EMAIL") || "")
      .toString().trim().toLowerCase();
    if (rawEmail && ADMIN_PATIENT_EMAILS.has(rawEmail)) return true;
  } catch { /* noop */ }

  return false;
}


export default function RoleSwitcher() {
  const [role, setRole] = useState(readRole);
  const [isTrueAdmin, setIsTrueAdmin] = useState(readIsTrueAdmin);
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  // Cross-tab sync + same-tab state probing — the in-app Settings picker
  // still writes to localStorage, so we mirror changes from there too.
  // Also re-read the JWT admin flag on each tick so a just-completed login
  // flips the switcher on without a page reload.
  useEffect(() => {
    const sync = () => {
      setRole(readRole());
      setIsTrueAdmin(readIsTrueAdmin());
    };
    window.addEventListener("storage", sync);
    window.addEventListener("amina:role-changed", sync);
    const t = setInterval(sync, 1500);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("amina:role-changed", sync);
      clearInterval(t);
    };
  }, []);

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [open]);

  const change = useCallback((newRole) => {
    setRole(newRole);
    setOpen(false);
    try {
      const prev = localStorage.getItem("AMINA_ROLE");
      localStorage.setItem("AMINA_ROLE", newRole);
      window.dispatchEvent(new CustomEvent("amina:role-changed",
                                            { detail: { role: newRole } }));

      // App.jsx reads AMINA_ROLE once at mount and only listens to its
      // own inline Settings role-picker button. That means card
      // visibility, edit permissions, dashboard panels, and role-gated
      // features will NOT update until the app re-initialises. Force a
      // reload so every feature gate (canEditCare, canEditCarePath,
      // role-pinned cards, VHW/Scout fetches, …) re-computes with the
      // new acting-role. State we care about (auth token, selected
      // session, language) lives in localStorage so it survives reload.
      if (prev !== newRole) {
        // Defer one tick so the dropdown-close animation flushes and the
        // storage write is definitely committed before navigation.
        setTimeout(() => {
          try { window.location.reload(); } catch { /* noop */ }
        }, 60);
      }
    } catch { /* noop */ }
  }, []);

  // Visibility rule:
  //  - True admin (JWT role=admin, incl. admin-patient): ALWAYS visible,
  //    even when acting-role=patient, so they can switch back out.
  //  - Non-admin operator acting as patient: hidden (real patient device).
  //  - Non-admin operator acting as themselves: visible (can toggle to
  //    patient simulation and back).
  if (!isTrueAdmin && role === "patient") return null;

  const meta = ROLES.find(r => r.id === role) || ROLES[0];

  return (
    <div ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Acting as ${meta.label} — click to switch role`}
        title={`Acting as ${meta.label} — click to switch`}
        style={{
          // Row 2 of the right-side stack:
          // [InboxBell 490] [RoleSwitcher 548] [LanguagePicker 606] [ScribeFab 664]
          //
          // z-index layering (floating UI):
          //    9800 — AppRouter overlay (home/login/chat/signup pages)
          //    9850 — floating pills (RoleSwitcher, LanguagePicker, InboxBell…)
          //    9900 — floating pill DROPDOWNS (selection menus)
          //    9999 — ConsentGate
          //   10000 — Onboarding gate + modals
          //
          // Previously this was at 10050, which sat ABOVE the
          // LanguagePicker dropdown (9252) and captured every click
          // inside the overlapping region of the dropdown — selecting
          // a language fell through to this pill's role-switch
          // handler which then called window.location.reload(). 9850
          // keeps the pill visible above the app overlay without
          // stealing clicks from sibling dropdowns opened over it.
          position:    "fixed",
          top:         548,
          right:       20,
          zIndex:      9850,
          display:     "inline-flex",
          alignItems:  "center",
          gap:         6,
          padding:     "6px 10px 6px 8px",
          border:      "none",
          cursor:      "pointer",
          background:  "linear-gradient(135deg, #1f2937 0%, #111827 100%)",
          color:       "#fff",
          borderRadius: 999,
          boxShadow:   `0 4px 14px rgba(15, 23, 42, 0.3), 0 0 0 2px ${meta.accent}55`,
          fontSize:    12,
          fontFamily:  "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          transition:  "transform 140ms ease, box-shadow 140ms ease",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.04)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
      >
        <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>{meta.emoji}</span>
        <span style={{ fontWeight: 600 }}>{meta.label}</span>
        <span aria-hidden="true" style={{ opacity: 0.65, fontSize: 10, marginLeft: 2 }}>
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label="Switch acting role"
          style={{
            // 7 rows × ~42px + header ~60px = ~354px tall. Pill is at
            // top:548 — dropdown opens UPWARD so the list floats above
            // the pill, staying inside the empty right-column area and
            // never clipping off the bottom of the viewport.
            position:    "fixed",
            top:         "auto",
            bottom:      "calc(100vh - 540px)",
            right:       20,
            // 9900 — one tier above all floating pills (9850) so the
            // menu items win the hit-test wherever the dropdown
            // overlaps another pill's bounding box.
            zIndex:      9900,
            minWidth:    210,
            background:  "#fff",
            borderRadius: 12,
            boxShadow:   "0 12px 32px rgba(15, 23, 42, 0.22)",
            overflow:    "hidden",
            border:      "1px solid #e2e8f0",
            fontFamily:  "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
            animation:   "amina-role-in 180ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          <div style={{
            padding: "10px 14px",
            background: "linear-gradient(135deg, #1f2937, #334155)",
            color: "#fff",
          }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Switch role</div>
            <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>
              {isTrueAdmin
                ? (role === "patient"
                    ? "Admin (acting as patient): pick any role to switch back."
                    : "Admin: impersonate any role to test flows.")
                : "You are currently logged in for operations."}
            </div>
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {ROLES.map((r) => {
              const active = r.id === role;
              // Admin (true JWT admin OR currently acting as admin) can
              // pick any role. Non-admin users can only flip between their
              // operator role and "patient" (a read-only simulation).
              const isAdminUser = isTrueAdmin || role === "admin";
              const disabled = !isAdminUser && r.id !== role && r.id !== "patient";
              return (
                <li key={r.id} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    disabled={disabled}
                    onClick={() => !disabled && change(r.id)}
                    style={{
                      width:       "100%",
                      display:     "flex",
                      alignItems:  "center",
                      gap:         12,
                      padding:     "10px 14px",
                      border:      "none",
                      background:  active ? "#f0f9ff" : "#fff",
                      color:       "#0f172a",
                      cursor:      disabled ? "not-allowed" : "pointer",
                      textAlign:   "left",
                      fontSize:    13,
                      borderBottom: "1px solid #f1f5f9",
                      fontFamily:  "inherit",
                      opacity:     disabled ? 0.35 : 1,
                    }}
                  >
                    <span aria-hidden="true" style={{ fontSize: 18 }}>{r.emoji}</span>
                    <span style={{ flex: 1, fontWeight: active ? 700 : 500 }}>
                      {r.label}
                    </span>
                    {active ? (
                      <span aria-hidden="true" style={{ color: r.accent, fontWeight: 700 }}>✓</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <style>{`
        @keyframes amina-role-in {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes amina-role-in { from, to { opacity: 1; transform: none; } }
        }
      `}</style>
    </div>
  );
}
