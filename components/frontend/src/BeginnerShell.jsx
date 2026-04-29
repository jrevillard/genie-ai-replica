/**
 * BeginnerShell — clinical dashboard UI for literacy mode "beginner".
 *
 * Mounted by LiteracyBootstrap.jsx as a sibling React root at z-index
 * 9000. Dark AMINA theme. Layout follows a medical portal pattern:
 *
 *   ┌──────────┬────────────────────────────────────────┐
 *   │          │  Top bar: title + patient chip          │
 *   │ Sidebar  ├────────────────────────────────────────┤
 *   │          │                                         │
 *   │  CARE    │   Overview — status cards               │
 *   │  · Over  │                                         │
 *   │  · Chat  │   ┌──────┐ ┌──────┐                    │
 *   │  · Plan  │   │ Plan │ │Today │                    │
 *   │  · Tip   │   └──────┘ └──────┘                    │
 *   │  · Rem   │   ┌──────┐ ┌──────┐                    │
 *   │          │   │ Rem  │ │ CG   │                    │
 *   │  SUPPORT │   └──────┘ └──────┘                    │
 *   │  · Find  │                                         │
 *   │  · CGC   │   Quick actions row                     │
 *   │  · Priv  │                                         │
 *   │          │                                         │
 *   │  [User]  │                                         │
 *   │  Signout │                                         │
 *   └──────────┴────────────────────────────────────────┘
 *
 * Chat + caregiver panels + privacy panel open as full-screen overlays
 * (they are full experiences with their own chrome). Embedded views
 * (plan / advice / reminders) render inside the content area.
 *
 * Z-index:
 *   EducationOnboardingGate  10000
 *   ConsentGate               9999
 *   BeginnerShell overlay     9100
 *   BeginnerShell root        9000
 *   mode badge                9998
 */

import { useEffect, useState, useCallback } from "react";
import BeginnerChat         from "./BeginnerChat.jsx";
import CaregiverDirectory   from "./CaregiverDirectory.jsx";
import CaregiverChat        from "./CaregiverChat.jsx";
import PrivacyPanel         from "./PrivacyPanel.jsx";
import EmergencyAlert       from "./EmergencyAlert.jsx";

const API = (window.AMINA_API || "http://localhost:8000").replace(/\/+$/, "");

// ── Design tokens (mirrors BeginnerChat.jsx / App.jsx) ──────────────────────

const T = {
  bg:         "#050810",
  bgSoft:     "#0a0f1f",
  surface:    "#0c1128",
  surface2:   "#111633",
  surface3:   "#161c3d",
  border:     "rgba(255,255,255,.07)",
  borderHi:   "rgba(129,140,248,.32)",
  text:       "#e2e8f0",
  textDim:    "#cbd5e1",
  muted:      "#94a3b8",
  subtle:     "#64748b",
  accent:     "#818cf8",
  accentDark: "#6366f1",
  accent2:    "#8b5cf6",
  cyan:       "#22d3ee",
  emerald:    "#34d399",
  amber:      "#fbbf24",
  rose:       "#fb7185",
  danger:     "#f87171",
  user:       "linear-gradient(135deg,#6366f1,#8b5cf6)",
};

const FONT = "'Outfit','DM Sans',ui-sans-serif,system-ui,-apple-system,sans-serif";
const SIDEBAR_W = 272;

// ── Session / storage helpers ───────────────────────────────────────────────

function getOrCreateSessionId() {
  try {
    const sid = localStorage.getItem("AMINA_SID");
    if (sid) return sid;
  } catch { /* ignore */ }
  const fresh =
    "sid_" + Date.now().toString(36) + "_" +
    Math.random().toString(36).slice(2, 10);
  try { localStorage.setItem("AMINA_SID", fresh); } catch { /* ignore */ }
  return fresh;
}

function getPatient() {
  try {
    return JSON.parse(localStorage.getItem("AMINA_PATIENT") || "null") || null;
  } catch {
    return null;
  }
}

function formatDate(d = new Date()) {
  try {
    return d.toLocaleDateString(undefined, {
      weekday: "long", month: "short", day: "numeric",
    });
  } catch {
    return "";
  }
}

function initials(name) {
  if (!name) return "·";
  const parts = String(name).trim().split(/\s+/).slice(0, 2);
  return parts.map(p => p[0]?.toUpperCase() || "").join("") || "·";
}

// ── Inline SVG icon set ─────────────────────────────────────────────────────

const ICN = {
  home: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12l9-9 9 9"/><path d="M5 10v10h14V10"/>
    </svg>
  ),
  chat: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  ),
  plan: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <path d="M14 2v6h6"/>
      <path d="M9 13h6M9 17h6M9 9h1"/>
    </svg>
  ),
  sun: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4.5"/>
      <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>
    </svg>
  ),
  bell: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
    </svg>
  ),
  users: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  cgChat: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-4 4V4a2 2 0 0 1 2-2z"/>
      <circle cx="12" cy="9" r="2.2"/>
      <path d="M8.5 14c.7-1.6 2-2.2 3.5-2.2s2.8.6 3.5 2.2"/>
    </svg>
  ),
  shield: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      <path d="M9 12l2 2 4-4"/>
    </svg>
  ),
  exit: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>
    </svg>
  ),
  sos: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <path d="M12 9v4M12 17h.01"/>
    </svg>
  ),
  sosBig: (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <path d="M12 9v4M12 17h.01"/>
    </svg>
  ),
  heart: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
    </svg>
  ),
  spark: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v6M12 16v6M2 12h6M16 12h6M5 5l4 4M15 15l4 4M5 19l4-4M15 9l4-4"/>
    </svg>
  ),
  arrow: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 5l7 7-7 7"/>
    </svg>
  ),
  check: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5"/>
    </svg>
  ),
  dot: (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
      <circle cx="4" cy="4" r="4"/>
    </svg>
  ),
  alert: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <path d="M12 9v4M12 17h.01"/>
    </svg>
  ),
  phone: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
    </svg>
  ),
};

// Nav items — two sections, clinical-portal style
const NAV_SECTIONS = [
  {
    label: "Care",
    items: [
      { id: "overview",  label: "Overview",        icon: ICN.home,  kind: "view" },
      { id: "chat",      label: "Talk to AMINA",   icon: ICN.chat,  kind: "overlay" },
      { id: "sos",       label: "Emergency Alert", icon: ICN.sos,   kind: "overlay", danger: true },
      { id: "plan",      label: "Care Plan",       icon: ICN.plan,  kind: "view" },
      { id: "advice",    label: "Today's Advice",  icon: ICN.sun,   kind: "view" },
      { id: "reminders", label: "Reminders",       icon: ICN.bell,  kind: "view" },
    ],
  },
  {
    label: "Support",
    items: [
      { id: "findCg",  label: "Find a Caregiver",   icon: ICN.users,  kind: "overlay" },
      { id: "chatCg",  label: "Chat with Caregiver", icon: ICN.cgChat, kind: "overlay" },
      { id: "privacy", label: "Privacy & Data",     icon: ICN.shield, kind: "overlay" },
    ],
  },
];

const NAV_TITLES = {
  overview:  "Overview",
  plan:      "Care Plan",
  advice:    "Today's Advice",
  reminders: "Reminders",
};

// ── Main shell ──────────────────────────────────────────────────────────────

export default function BeginnerShell({ token, patientName = "" }) {
  const [nav, setNav]                 = useState("overview");
  const [overlay, setOverlay]         = useState(null); // chat|findCg|chatCg|privacy
  const [sosOpen, setSosOpen]         = useState(false);
  const [sosInitialReason, setSosIR]  = useState(null);
  const [toast, setToast]             = useState("");
  const patient                       = getPatient();
  const displayName                   = patientName || patient?.name || "friend";

  // Escape closes the top-most overlay (SOS first, then the main overlay)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (sosOpen) setSosOpen(false);
      else setOverlay(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sosOpen]);

  const openSos = useCallback((reasonId = null) => {
    setSosIR(reasonId || null);
    setSosOpen(true);
  }, []);
  const closeSos = useCallback(() => {
    setSosOpen(false);
    setSosIR(null);
  }, []);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  };

  const onLogout = () => {
    try {
      localStorage.removeItem("AMINA_TOKEN");
      localStorage.removeItem("AMINA_PATIENT");
      localStorage.removeItem("AMINA_SID");
    } catch { /* ignore */ }
    window.location.reload();
  };

  const onNavClick = (item) => {
    if (item.kind === "overlay") {
      if (item.id === "sos") {
        openSos(null);
      } else {
        setOverlay(item.id);
      }
    } else {
      setNav(item.id);
    }
  };

  return (
    <div
      className="amina-beginner-shell"
      style={{
        position: "fixed", inset: 0, zIndex: 9000,
        background:
          `radial-gradient(1200px 600px at 12% -10%, rgba(99,102,241,.12), transparent 60%),` +
          `radial-gradient(900px 500px at 110% 10%, rgba(139,92,246,.10), transparent 60%),` +
          T.bg,
        color: T.text,
        fontFamily: FONT,
        display: "flex",
        overflow: "hidden",
      }}
      data-literacy-ignore
    >
      {/* Move the global literacy mode badge away from the sidebar Sign out button.
          Center it horizontally at the bottom of the viewport so it no longer
          overlaps the sidebar footer. */}
      <style>{`
        #amina-literacy-badge {
          left: 50% !important;
          right: auto !important;
          transform: translateX(-50%) !important;
          bottom: 14px !important;
        }
      `}</style>

      <Sidebar
        nav={nav}
        overlay={overlay}
        sosOpen={sosOpen}
        onNavClick={onNavClick}
        displayName={displayName}
        patient={patient}
        onLogout={onLogout}
      />

      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex", flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <TopBar nav={nav} displayName={displayName} />

        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "28px 36px 40px",
          }}
        >
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
            {nav === "overview" && (
              <Overview
                displayName={displayName}
                onOpenChat={() => setOverlay("chat")}
                onGoTo={setNav}
                onOpenOverlay={setOverlay}
                onOpenSos={() => openSos(null)}
              />
            )}
            {nav === "plan" && (
              <CarePlanView onToast={showToast} />
            )}
            {nav === "advice" && (
              <SeasonalView />
            )}
            {nav === "reminders" && (
              <RemindersView patient={patient} onToast={showToast} />
            )}
          </div>
        </div>
      </div>

      {/* Overlays (chat / caregiver / privacy — mutually exclusive) */}
      {overlay === "chat" && (
        <BeginnerChat
          token={token}
          patient={patient}
          language="en"
          mode="beginner"
          onClose={() => setOverlay(null)}
          onRequestEmergency={(reasonId) => openSos(reasonId)}
        />
      )}
      {overlay === "findCg" && (
        <CaregiverDirectory token={token} patient={patient} onClose={() => setOverlay(null)} />
      )}
      {overlay === "chatCg" && (
        <CaregiverChat token={token} patientName={displayName} onClose={() => setOverlay(null)} />
      )}
      {overlay === "privacy" && (
        <PrivacyPanel token={token} patient={patient} onClose={() => setOverlay(null)} />
      )}

      {/* SOS stacks above whatever else is open (z-index 9300) */}
      {sosOpen && (
        <EmergencyAlert
          token={token}
          patient={patient}
          initialReasonId={sosInitialReason}
          onClose={closeSos}
        />
      )}

      {/* Floating SOS FAB — only surfaces while a chat overlay is open
          (home screen no longer carries the permanent red pulse). Also
          hidden while the SOS module itself is open. */}
      {!sosOpen && overlay === "chat" && (
        <SosFab onClick={() => openSos(null)} />
      )}

      {toast && <Toast text={toast} />}
    </div>
  );
}


// ── Floating SOS action button ──────────────────────────────────────────────

function SosFab({ onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <>
      <button
        onClick={onClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        data-literacy-ignore
        aria-label="Emergency alert"
        title="Emergency alert"
        style={{
          all: "unset",
          cursor: "pointer",
          // Top-right while a chat overlay is open. Pushed down to
          // top:90 so we sit BELOW the chat header (which carries the
          // language pills + model picker on the right at ~y=14-58).
          position: "fixed",
          right: 24, top: 90,
          zIndex: 9150,
          padding: "14px 22px 14px 18px",
          borderRadius: 999,
          background: `linear-gradient(135deg, #dc2626, #ef4444)`,
          color: "#fff",
          fontSize: 14, fontWeight: 800,
          letterSpacing: ".4px",
          display: "flex", alignItems: "center", gap: 10,
          boxShadow: hover
            ? "0 26px 60px rgba(220,38,38,.55), 0 0 0 6px rgba(220,38,38,.18)"
            : "0 18px 40px rgba(220,38,38,.45), 0 0 0 3px rgba(220,38,38,.14)",
          transform: hover ? "translateY(-2px)" : "translateY(0)",
          transition: "all .18s ease",
          fontFamily: FONT,
          animation: "amina-sos-pulse 2.4s ease-in-out infinite",
        }}
      >
        <span style={{ display: "flex" }}>{ICN.sosBig}</span>
        Emergency
      </button>
      <style>{`
        @keyframes amina-sos-pulse {
          0%, 100% { box-shadow: 0 18px 40px rgba(220,38,38,.45), 0 0 0 3px rgba(220,38,38,.14); }
          50%      { box-shadow: 0 22px 50px rgba(220,38,38,.55), 0 0 0 10px rgba(220,38,38,.08); }
        }
      `}</style>
    </>
  );
}


// ── Sidebar ─────────────────────────────────────────────────────────────────

function Sidebar({ nav, overlay, sosOpen, onNavClick, displayName, patient, onLogout }) {
  return (
    <aside
      style={{
        width: SIDEBAR_W,
        flexShrink: 0,
        background: "rgba(10,15,31,.72)",
        backdropFilter: "blur(14px)",
        borderRight: `1px solid ${T.border}`,
        display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Brand */}
      <div
        style={{
          padding: "22px 22px 20px",
          borderBottom: `1px solid ${T.border}`,
          display: "flex", alignItems: "center", gap: 12,
        }}
      >
        <div
          style={{
            width: 40, height: 40, borderRadius: 12,
            background: T.user,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff",
            boxShadow: "0 8px 24px rgba(99,102,241,.45)",
          }}
        >
          {ICN.heart}
        </div>
        <div>
          <div
            style={{
              fontSize: 10, fontWeight: 700, letterSpacing: "2px",
              textTransform: "uppercase", color: T.muted,
            }}
          >
            AMINA Care
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.text, lineHeight: 1.2 }}>
            Patient Portal
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav
        style={{
          flex: 1,
          overflow: "auto",
          padding: "18px 14px",
          display: "flex", flexDirection: "column", gap: 4,
        }}
      >
        {NAV_SECTIONS.map((section, si) => (
          <div key={section.label} style={{ marginBottom: si === 0 ? 14 : 0 }}>
            <div
              style={{
                fontSize: 10, fontWeight: 700, letterSpacing: "1.8px",
                textTransform: "uppercase", color: T.subtle,
                padding: "10px 10px 8px",
              }}
            >
              {section.label}
            </div>
            {section.items.map(item => {
              const active =
                (item.kind === "view"    && nav === item.id && !overlay && !sosOpen) ||
                (item.kind === "overlay" && item.id === "sos" && sosOpen) ||
                (item.kind === "overlay" && item.id !== "sos" && overlay === item.id);
              return (
                <NavItem
                  key={item.id}
                  icon={item.icon}
                  label={item.label}
                  active={active}
                  danger={item.danger}
                  onClick={() => onNavClick(item)}
                />
              );
            })}
          </div>
        ))}
      </nav>

      {/* User footer */}
      <div
        style={{
          padding: "14px 14px 18px",
          borderTop: `1px solid ${T.border}`,
          display: "flex", flexDirection: "column", gap: 10,
        }}
      >
        <div
          style={{
            padding: "12px 12px",
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: 12,
            display: "flex", alignItems: "center", gap: 12,
          }}
        >
          <div
            style={{
              width: 36, height: 36, borderRadius: 10,
              background: T.user,
              color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 13, fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {initials(displayName)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 13, fontWeight: 700, color: T.text,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}
            >
              {displayName}
            </div>
            <div style={{ fontSize: 11, color: T.muted, display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ color: T.emerald, display: "flex" }}>{ICN.dot}</span>
              Beginner mode
            </div>
          </div>
        </div>

        <button
          onClick={onLogout}
          data-literacy-ignore
          style={{
            all: "unset",
            cursor: "pointer",
            padding: "11px 14px",
            borderRadius: 10,
            background: "transparent",
            border: `1px solid ${T.border}`,
            color: T.muted,
            fontSize: 12, fontWeight: 600,
            display: "flex", alignItems: "center", gap: 10, justifyContent: "center",
            fontFamily: FONT,
            transition: "all .15s ease",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.color = T.danger;
            e.currentTarget.style.borderColor = "rgba(248,113,113,.35)";
            e.currentTarget.style.background = "rgba(248,113,113,.06)";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color = T.muted;
            e.currentTarget.style.borderColor = T.border;
            e.currentTarget.style.background = "transparent";
          }}
        >
          {ICN.exit} Sign out
        </button>
      </div>
    </aside>
  );
}

function NavItem({ icon, label, active, danger, onClick }) {
  const [hover, setHover] = useState(false);
  const accent = danger ? T.danger : T.accent;
  const ring   = danger ? "rgba(248,113,113,.35)" : T.borderHi;
  const activeBg = danger
    ? "linear-gradient(90deg, rgba(248,113,113,.16), rgba(248,113,113,.04))"
    : "linear-gradient(90deg, rgba(129,140,248,.18), rgba(139,92,246,.08))";
  const idleFg = danger
    ? (hover ? T.danger : "#fca5a5")
    : (hover ? T.textDim : T.muted);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-literacy-ignore
      style={{
        all: "unset",
        cursor: "pointer",
        padding: "10px 12px",
        borderRadius: 10,
        display: "flex", alignItems: "center", gap: 11,
        fontSize: 13, fontWeight: danger ? 700 : 600,
        color: active ? T.text : idleFg,
        background: active
          ? activeBg
          : (hover
              ? (danger ? "rgba(248,113,113,.06)" : "rgba(255,255,255,.03)")
              : "transparent"),
        border: active ? `1px solid ${ring}` : "1px solid transparent",
        transition: "all .15s ease",
        fontFamily: FONT,
        position: "relative",
      }}
    >
      <span
        style={{
          display: "flex",
          color: active || danger ? accent : "currentColor",
        }}
      >
        {icon}
      </span>
      <span>{label}</span>
      {active && (
        <span
          style={{
            position: "absolute", right: 10,
            color: accent, display: "flex",
          }}
        >
          {ICN.dot}
        </span>
      )}
    </button>
  );
}


// ── Top bar ─────────────────────────────────────────────────────────────────

function TopBar({ nav, displayName }) {
  return (
    <header
      style={{
        padding: "18px 36px",
        borderBottom: `1px solid ${T.border}`,
        background: "rgba(12,17,40,.45)",
        backdropFilter: "blur(14px)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 16,
        flexShrink: 0,
      }}
    >
      <div>
        <div
          style={{
            fontSize: 10, fontWeight: 700, letterSpacing: "1.8px",
            textTransform: "uppercase", color: T.subtle,
            marginBottom: 4,
          }}
        >
          Patient portal
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, color: T.text }}>
          {NAV_TITLES[nav] || "Overview"}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            padding: "8px 14px",
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: 999,
            fontSize: 12, fontWeight: 600, color: T.muted,
            display: "flex", alignItems: "center", gap: 8,
          }}
        >
          <span style={{ color: T.accent, display: "flex" }}>{ICN.spark}</span>
          {formatDate()}
        </div>
        <div
          style={{
            padding: "7px 14px 7px 8px",
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: 999,
            display: "flex", alignItems: "center", gap: 10,
          }}
        >
          <div
            style={{
              width: 28, height: 28, borderRadius: "50%",
              background: T.user, color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 700,
            }}
          >
            {initials(displayName)}
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.text, lineHeight: 1.1 }}>
              {displayName}
            </div>
            <div style={{ fontSize: 10, color: T.muted }}>Patient</div>
          </div>
        </div>
      </div>
    </header>
  );
}


// ── Overview — status dashboard ─────────────────────────────────────────────

function Overview({ displayName, onOpenChat, onGoTo, onOpenOverlay, onOpenSos }) {
  const [plan, setPlan]         = useState(null);
  const [planLoading, setPL]    = useState(true);
  const [seasonal, setSeasonal] = useState(null);
  const [seasLoading, setSL]    = useState(true);
  const [rem, setRem]           = useState(null);
  const [cgStatus, setCgStatus] = useState(null);
  const sid                     = getOrCreateSessionId();

  useEffect(() => {
    // Care plan
    fetch(`${API}/api/v1/agent/care-plan/${encodeURIComponent(sid)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setPlan(d && d.exists && d.plan ? d.plan : null))
      .catch(() => {})
      .finally(() => setPL(false));

    // Seasonal
    fetch(`${API}/api/v1/community/all?session_id=${encodeURIComponent(sid)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setSeasonal((d && d.seasonal) || null))
      .catch(() => {})
      .finally(() => setSL(false));

    // Reminders (local cache)
    try {
      const p = JSON.parse(localStorage.getItem("AMINA_NOTIF_PREFS") || "null");
      if (p) setRem(p);
    } catch {}

    // Caregiver status — best-effort
    fetch(`${API}/api/v1/caregiver/active?session_id=${encodeURIComponent(sid)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setCgStatus(d || null))
      .catch(() => {});
  }, [sid]);

  const planTopItem = (() => {
    if (!plan) return null;
    const pool = plan.priorities || plan.goals || plan.monitoring;
    if (!Array.isArray(pool) || pool.length === 0) return null;
    const x = pool[0];
    return typeof x === "string" ? x : (x.text || x.title || null);
  })();

  const seasonName = seasonal?.season?.name;
  const seasonEmoji = seasonal?.season?.emoji || "🌤️";
  const firstTip = (() => {
    const arr = seasonal?.all_tips || seasonal?.ramadan_tips;
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const x = arr[0];
    return typeof x === "string" ? x : (x.text || x.tip || null);
  })();

  const remOn = !!rem;
  const remChannel = rem
    ? (rem.whatsapp ? `WhatsApp to ${rem.whatsapp}` :
       rem.email    ? `Email to ${rem.email}`      :
       rem.browser  ? "On this device"             : "Active")
    : null;

  const cgActive = cgStatus?.active || cgStatus?.caregiver;
  const cgName = cgActive?.name || cgStatus?.name || null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Hero */}
      <section
        style={{
          padding: "26px 30px",
          background:
            `linear-gradient(135deg, rgba(99,102,241,.18), rgba(139,92,246,.10) 55%, transparent),` +
            T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: 22,
          boxShadow: "0 0 0 1px rgba(129,140,248,.12), 0 20px 50px rgba(99,102,241,.18)",
          display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 240 }}>
          <div
            style={{
              fontSize: 11, fontWeight: 700, letterSpacing: "1.6px",
              textTransform: "uppercase", color: T.accent, marginBottom: 8,
            }}
          >
            Welcome back
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: T.text, lineHeight: 1.2 }}>
            Hello, {displayName}
          </div>
          <div style={{ fontSize: 14, color: T.muted, marginTop: 10, lineHeight: 1.6, maxWidth: 540 }}>
            Here's a quick look at your care. Talk to AMINA anytime in English
            or Mandinka — by voice or text.
          </div>
        </div>
        <button
          onClick={onOpenChat}
          data-literacy-ignore
          style={{
            all: "unset",
            cursor: "pointer",
            padding: "14px 22px",
            borderRadius: 14,
            background: T.user,
            color: "#fff",
            fontSize: 14, fontWeight: 700,
            display: "flex", alignItems: "center", gap: 10,
            boxShadow: "0 16px 40px rgba(99,102,241,.45)",
            fontFamily: FONT,
          }}
        >
          {ICN.chat} Start a conversation {ICN.arrow}
        </button>
      </section>

      {/* Status cards */}
      <SectionLabel>Status</SectionLabel>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))",
          gap: 16,
        }}
      >
        <StatusCard
          iconBg="rgba(139,92,246,.12)"
          iconRing="rgba(139,92,246,.35)"
          iconColor="#c4b5fd"
          icon={ICN.plan}
          label="Care plan"
          status={
            planLoading ? { tone: "muted", text: "Loading…" } :
            plan ? { tone: "good", text: "Ready" } :
                   { tone: "warn", text: "Not started" }
          }
          title={plan ? "Your plan is ready" : "No care plan yet"}
          body={
            planTopItem
              ? `Top priority: ${planTopItem}`
              : "Chat with AMINA for a few minutes, then come back here to generate your plan."
          }
          cta={{ label: plan ? "View plan" : "Go to plan", onClick: () => onGoTo("plan") }}
        />

        <StatusCard
          iconBg="rgba(251,191,36,.12)"
          iconRing="rgba(251,191,36,.35)"
          iconColor="#fcd34d"
          icon={ICN.sun}
          label="Today's advice"
          status={
            seasLoading ? { tone: "muted", text: "Loading…" } :
            seasonal ? { tone: "good", text: seasonName || "Today" } :
                       { tone: "muted", text: "No tips" }
          }
          title={seasonName ? `${seasonEmoji} ${seasonName}` : "Seasonal health tips"}
          body={
            firstTip || "During the hot dry season, drink water often and rest in the shade from 11 a.m. to 3 p.m."
          }
          cta={{ label: "See all tips", onClick: () => onGoTo("advice") }}
        />

        <StatusCard
          iconBg="rgba(52,211,153,.12)"
          iconRing="rgba(52,211,153,.35)"
          iconColor="#6ee7b7"
          icon={ICN.bell}
          label="Reminders"
          status={
            remOn ? { tone: "good", text: "On" } : { tone: "warn", text: "Off" }
          }
          title={remOn ? "Daily reminders are on" : "Turn on daily reminders"}
          body={
            remOn
              ? (remChannel || "AMINA will check in with you every day.")
              : "One tap to get a gentle daily nudge about your health and medicine."
          }
          cta={{ label: remOn ? "Manage" : "Turn on", onClick: () => onGoTo("reminders") }}
        />

        <StatusCard
          iconBg="rgba(34,211,238,.12)"
          iconRing="rgba(34,211,238,.35)"
          iconColor="#67e8f9"
          icon={ICN.users}
          label="Caregiver"
          status={
            cgName ? { tone: "good", text: "Connected" } : { tone: "muted", text: "None" }
          }
          title={cgName ? `Connected to ${cgName}` : "No caregiver yet"}
          body={
            cgName
              ? "You can message your caregiver directly anytime."
              : "Find a trusted clinician near you to help with your care."
          }
          cta={{
            label: cgName ? "Chat now" : "Find caregiver",
            onClick: () => onOpenOverlay(cgName ? "chatCg" : "findCg"),
          }}
        />
      </div>

      {/* Quick actions */}
      <SectionLabel>Quick actions</SectionLabel>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
        }}
      >
        <QuickAction
          icon={ICN.chat}
          label="Log a symptom"
          sub="Open the symptom form in chat"
          onClick={onOpenChat}
        />
        <QuickAction
          icon={ICN.plan}
          label="Prescription helper"
          sub="Upload a photo or type a medicine"
          onClick={onOpenChat}
        />
        <QuickAction
          icon={ICN.cgChat}
          label="Ask your caregiver"
          sub="Send a direct message"
          onClick={() => onOpenOverlay("chatCg")}
        />
        <QuickAction
          icon={ICN.shield}
          label="Review my data"
          sub="See what's stored about you"
          onClick={() => onOpenOverlay("privacy")}
        />
      </div>

      {/* Emergency strip */}
      <EmergencyStrip onSos={onOpenSos} />
    </div>
  );
}


// ── Status card ─────────────────────────────────────────────────────────────

function StatusCard({ icon, iconBg, iconRing, iconColor, label, status, title, body, cta }) {
  const [hover, setHover] = useState(false);
  const toneColor = {
    good:  T.emerald,
    warn:  T.amber,
    muted: T.subtle,
    danger: T.danger,
  }[status?.tone || "muted"];

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: "20px 22px",
        background: T.surface,
        border: `1px solid ${hover ? T.borderHi : T.border}`,
        borderRadius: 18,
        display: "flex", flexDirection: "column", gap: 16,
        transition: "all .18s ease",
        boxShadow: hover
          ? "0 16px 40px rgba(0,0,0,.45), 0 0 0 1px rgba(129,140,248,.18)"
          : "0 6px 18px rgba(0,0,0,.2)",
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 38, height: 38, borderRadius: 11,
              background: iconBg,
              border: `1px solid ${iconRing}`,
              color: iconColor,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            {icon}
          </div>
          <div
            style={{
              fontSize: 10, fontWeight: 700, letterSpacing: "1.4px",
              textTransform: "uppercase", color: T.muted,
            }}
          >
            {label}
          </div>
        </div>
        {status && (
          <div
            style={{
              fontSize: 11, fontWeight: 700,
              color: toneColor,
              padding: "4px 10px",
              background: "rgba(255,255,255,.03)",
              border: `1px solid ${toneColor}33`,
              borderRadius: 999,
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            <span style={{ display: "flex" }}>{ICN.dot}</span>
            {status.text}
          </div>
        )}
      </div>

      {/* Title + body */}
      <div>
        <div style={{ fontSize: 16, fontWeight: 700, color: T.text, lineHeight: 1.3, marginBottom: 6 }}>
          {title}
        </div>
        <div
          style={{
            fontSize: 13, color: T.muted, lineHeight: 1.55,
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {body}
        </div>
      </div>

      {/* CTA */}
      {cta && (
        <button
          onClick={cta.onClick}
          data-literacy-ignore
          style={{
            all: "unset",
            cursor: "pointer",
            padding: "10px 14px",
            borderRadius: 10,
            background: "rgba(129,140,248,.1)",
            border: `1px solid ${T.borderHi}`,
            color: T.accent,
            fontSize: 12, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: 10,
            fontFamily: FONT,
            transition: "all .15s ease",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = "rgba(129,140,248,.18)";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "rgba(129,140,248,.1)";
          }}
        >
          {cta.label} {ICN.arrow}
        </button>
      )}
    </div>
  );
}


// ── Quick action chip ───────────────────────────────────────────────────────

function QuickAction({ icon, label, sub, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-literacy-ignore
      style={{
        all: "unset",
        cursor: "pointer",
        padding: "14px 16px",
        background: hover ? T.surface2 : T.surface,
        border: `1px solid ${hover ? T.borderHi : T.border}`,
        borderRadius: 14,
        display: "flex", alignItems: "center", gap: 12,
        transition: "all .15s ease",
        fontFamily: FONT,
      }}
    >
      <div
        style={{
          width: 34, height: 34, borderRadius: 10,
          background: "rgba(129,140,248,.1)",
          border: `1px solid ${T.border}`,
          color: T.accent,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.text, lineHeight: 1.2 }}>
          {label}
        </div>
        <div
          style={{
            fontSize: 11, color: T.muted, marginTop: 3,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}
        >
          {sub}
        </div>
      </div>
      <span style={{ color: T.subtle, display: "flex" }}>{ICN.arrow}</span>
    </button>
  );
}


function EmergencyStrip({ onSos }) {
  return (
    <div
      style={{
        padding: "18px 22px",
        background:
          `linear-gradient(135deg, rgba(248,113,113,.10), rgba(248,113,113,.02)),` +
          T.surface,
        border: `1px solid rgba(248,113,113,.32)`,
        borderRadius: 16,
        display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
      }}
    >
      <div
        style={{
          width: 40, height: 40, borderRadius: 11,
          background: "rgba(248,113,113,.14)",
          border: "1px solid rgba(248,113,113,.35)",
          color: T.danger,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {ICN.alert}
      </div>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>
          Need help right now?
        </div>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 3, lineHeight: 1.5 }}>
          Send an instant alert to your caregivers and see how to call 199.
        </div>
      </div>
      <button
        onClick={onSos}
        data-literacy-ignore
        style={{
          all: "unset",
          cursor: "pointer",
          padding: "11px 18px",
          borderRadius: 12,
          background: `linear-gradient(135deg, #dc2626, #ef4444)`,
          color: "#fff",
          fontSize: 13, fontWeight: 800,
          letterSpacing: ".3px",
          display: "flex", alignItems: "center", gap: 8,
          boxShadow: "0 14px 32px rgba(220,38,38,.4)",
          fontFamily: FONT,
        }}
      >
        {ICN.alert} Send Emergency Alert
      </button>
    </div>
  );
}


function SectionLabel({ children }) {
  return (
    <div
      style={{
        fontSize: 10, fontWeight: 700, letterSpacing: "1.8px",
        textTransform: "uppercase", color: T.subtle,
        padding: "0 2px",
      }}
    >
      {children}
    </div>
  );
}


// ── Care plan view (embedded) ───────────────────────────────────────────────

function CarePlanView({ onToast }) {
  const [plan, setPlan]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [generating, setGen]    = useState(false);
  const sid                     = getOrCreateSessionId();

  const load = useCallback(() => {
    setLoading(true); setError("");
    fetch(`${API}/api/v1/agent/care-plan/${encodeURIComponent(sid)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setPlan(d && d.exists && d.plan ? d.plan : null))
      .catch(() => setError("Could not load your care plan."))
      .finally(() => setLoading(false));
  }, [sid]);

  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    setGen(true); setError("");
    try {
      const r = await fetch(`${API}/api/v1/agent/care-plan/${encodeURIComponent(sid)}/generate`, {
        method: "POST",
      });
      if (!r.ok) {
        setError("Please talk to AMINA first so she can learn about you, then come back here.");
        return;
      }
      const d = await r.json();
      if (d.plan) {
        setPlan(d.plan);
        onToast && onToast("Your care plan is ready");
      }
    } catch {
      setError("Could not make your care plan. Please try again.");
    } finally {
      setGen(false);
    }
  };

  if (loading) return <DarkCard title="Loading your care plan…" />;

  if (!plan) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <DarkCard
          title="You don't have a care plan yet"
          body="Your care plan is a list of things to do for your health. AMINA can make one for you after you talk to her for a few minutes."
        />
        {error && <ErrorBox text={error} />}
        <PrimaryButton
          label={generating ? "Making your plan…" : "Make my care plan now"}
          disabled={generating}
          onClick={generate}
        />
      </div>
    );
  }

  const sections = [];
  if (plan.priorities?.length)    sections.push({ title: "Most important right now", items: plan.priorities });
  if (plan.goals?.length)         sections.push({ title: "Your goals", items: plan.goals });
  if (plan.monitoring?.length)    sections.push({ title: "Things to watch", items: plan.monitoring });
  if (plan.diet?.length)          sections.push({ title: "What to eat", items: plan.diet });
  if (plan.exercise?.length)      sections.push({ title: "Moving your body", items: plan.exercise });
  if (plan.warning_signs?.length) sections.push({ title: "Warning signs — see a nurse", items: plan.warning_signs, danger: true });

  if (sections.length === 0) {
    return (
      <DarkCard
        title="Your care plan is ready"
        body={typeof plan === "string" ? plan : "Talk to AMINA to learn more about it."}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {sections.map((s, i) => (
        <div
          key={i}
          style={{
            background: s.danger ? "rgba(248,113,113,.06)" : T.surface,
            border: `1px solid ${s.danger ? "rgba(248,113,113,.32)" : T.border}`,
            borderRadius: 16,
            padding: "20px 22px",
          }}
        >
          <div
            style={{
              fontSize: 10, fontWeight: 700, letterSpacing: "1.4px",
              textTransform: "uppercase",
              color: s.danger ? T.danger : T.accent,
              marginBottom: 12,
            }}
          >
            {s.title}
          </div>
          <ul style={{ margin: 0, paddingLeft: 22, lineHeight: 1.7, color: T.textDim }}>
            {s.items.map((it, j) => (
              <li key={j} style={{ fontSize: 14, marginBottom: 6 }}>
                {typeof it === "string" ? it : (it.text || it.title || JSON.stringify(it))}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}


// ── Seasonal view (embedded) ────────────────────────────────────────────────

function SeasonalView() {
  const [seasonal, setSeasonal] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const sid                     = getOrCreateSessionId();

  useEffect(() => {
    fetch(`${API}/api/v1/community/all?session_id=${encodeURIComponent(sid)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setSeasonal((d && d.seasonal) || null))
      .catch(() => setError("Could not load today's advice."))
      .finally(() => setLoading(false));
  }, [sid]);

  if (loading) return <DarkCard title="Loading today's advice…" />;
  if (error)   return <ErrorBox text={error} />;
  if (!seasonal) {
    return (
      <DarkCard
        title="No seasonal tips right now"
        body="Come back later — AMINA updates this every day."
      />
    );
  }

  const tips = Array.isArray(seasonal.all_tips) && seasonal.all_tips.length
    ? seasonal.all_tips
    : Array.isArray(seasonal.ramadan_tips) ? seasonal.ramadan_tips : [];

  const season = seasonal.season || {};
  const headline = `${season.emoji || "🌤️"}  ${season.name || "Today"}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          background:
            `linear-gradient(135deg, rgba(251,191,36,.16), rgba(251,191,36,.03)),` +
            T.surface,
          border: `1px solid rgba(251,191,36,.32)`,
          borderRadius: 20,
          padding: "26px 26px",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 26, fontWeight: 800, color: T.amber, marginBottom: 6 }}>
          {headline}
        </div>
        {seasonal.date && (
          <div style={{ fontSize: 12, color: T.muted, fontWeight: 600 }}>
            {seasonal.date}
          </div>
        )}
      </div>

      {tips.length === 0 ? (
        <DarkCard
          title="Stay cool and drink water"
          body="During the hot dry season, drink water often, rest in the shade between 11 a.m. and 3 p.m., and eat soft fruits like watermelon and mango."
        />
      ) : (
        tips.map((t, i) => (
          <div
            key={i}
            style={{
              background: T.surface,
              border: `1px solid ${T.border}`,
              borderRadius: 14,
              padding: "18px 22px",
              fontSize: 14, lineHeight: 1.65, color: T.textDim,
            }}
          >
            {typeof t === "string" ? t : (t.text || t.tip || JSON.stringify(t))}
          </div>
        ))
      )}
    </div>
  );
}


// ── Reminders view (embedded) ───────────────────────────────────────────────

function RemindersView({ patient, onToast }) {
  const [busy, setBusy]     = useState(false);
  const [done, setDone]     = useState(false);
  const [error, setError]   = useState("");
  const sid                 = getOrCreateSessionId();

  const pickChannel = useCallback(() => {
    if (patient?.phone) return { kind: "whatsapp", label: `WhatsApp to ${patient.phone}`, value: patient.phone };
    if (patient?.email) return { kind: "email",    label: `Email to ${patient.email}`,    value: patient.email };
    return { kind: "browser", label: "On this device", value: true };
  }, [patient]);

  const chosen = pickChannel();

  const turnOn = async () => {
    setBusy(true); setError("");
    try {
      if (chosen.kind === "browser" && "Notification" in window) {
        try { await Notification.requestPermission(); } catch { /* ignore */ }
      }
      const channels = {};
      channels[chosen.kind] = chosen.value;
      const r = await fetch(`${API}/api/v1/agent/notifications/preferences`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sid,
          channels,
          frequency: "daily",
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      try {
        localStorage.setItem("AMINA_NOTIF_PREFS", JSON.stringify({
          [chosen.kind]: chosen.value, frequency: "daily",
        }));
      } catch { /* ignore */ }
      setDone(true);
      onToast && onToast("Reminders are on");
    } catch {
      setError("Could not turn on reminders. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div
        style={{
          background:
            `linear-gradient(135deg, rgba(52,211,153,.14), rgba(52,211,153,.03)),` +
            T.surface,
          border: `1px solid rgba(52,211,153,.32)`,
          borderRadius: 20, padding: "34px 26px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 68, height: 68, borderRadius: "50%",
            background: "rgba(52,211,153,.16)",
            color: T.emerald,
            margin: "0 auto 16px",
            display: "flex", alignItems: "center", justifyContent: "center",
            border: "1px solid rgba(52,211,153,.35)",
          }}
        >
          {ICN.check}
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, color: T.emerald }}>
          Reminders are on
        </div>
        <div style={{ fontSize: 13, color: T.muted, marginTop: 8, lineHeight: 1.55 }}>
          {chosen.label}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <DarkCard
        title="Get daily health reminders"
        body="AMINA will send you a gentle reminder each day to check your health and take your medicine."
      />

      <div
        style={{
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: 14, padding: "18px 22px",
          display: "flex", alignItems: "center", gap: 16,
        }}
      >
        <div
          style={{
            width: 44, height: 44, borderRadius: 11,
            background: "rgba(52,211,153,.12)",
            border: "1px solid rgba(52,211,153,.32)",
            color: T.emerald,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {ICN.bell}
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 10, fontWeight: 700, color: T.muted,
              textTransform: "uppercase", letterSpacing: "1.2px",
            }}
          >
            We will send reminders via
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginTop: 3 }}>
            {chosen.label}
          </div>
        </div>
      </div>

      {error && <ErrorBox text={error} />}

      <PrimaryButton
        label={busy ? "Turning on…" : "Turn on reminders"}
        disabled={busy}
        onClick={turnOn}
      />
    </div>
  );
}


// ── Shared small components ─────────────────────────────────────────────────

function DarkCard({ title, body }) {
  return (
    <div
      style={{
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: 16,
        padding: "22px 24px",
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: body ? 10 : 0 }}>
        {title}
      </div>
      {body && (
        <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.65 }}>
          {body}
        </div>
      )}
    </div>
  );
}

function ErrorBox({ text }) {
  return (
    <div
      style={{
        background: "rgba(248,113,113,.07)",
        border: `1px solid rgba(248,113,113,.32)`,
        color: T.danger,
        borderRadius: 12,
        padding: "13px 18px",
        fontSize: 13, fontWeight: 600, lineHeight: 1.55,
      }}
    >
      {text}
    </div>
  );
}

function PrimaryButton({ label, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      data-literacy-ignore
      style={{
        all: "unset",
        width: "100%",
        textAlign: "center",
        padding: "15px 22px",
        borderRadius: 14,
        background: disabled ? T.surface2 : T.user,
        color: "#fff",
        fontSize: 14, fontWeight: 700,
        cursor: disabled ? "default" : "pointer",
        boxShadow: disabled ? "none" : "0 14px 36px rgba(99,102,241,.4)",
        opacity: disabled ? .6 : 1,
        boxSizing: "border-box",
        fontFamily: FONT,
      }}
    >
      {label}
    </button>
  );
}

function Toast({ text }) {
  return (
    <div
      style={{
        position: "fixed", bottom: 28, left: "50%",
        transform: "translateX(-50%)",
        background: T.surface2, color: T.text,
        border: `1px solid ${T.borderHi}`,
        padding: "13px 22px", borderRadius: 12,
        fontSize: 13, fontWeight: 600,
        boxShadow: "0 20px 60px rgba(0,0,0,.55)",
        zIndex: 9200,
        fontFamily: FONT,
      }}
      data-literacy-ignore
    >
      {text}
    </div>
  );
}
