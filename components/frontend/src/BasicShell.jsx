/**
 * BasicShell — clinical dashboard UI for literacy mode "basic".
 *
 * Mounted by LiteracyBootstrap.jsx as a sibling React root at z-index
 * 9000 when profile.current_mode === "basic". Same chrome family as
 * BeginnerShell but slightly denser: smaller tiles, more info per
 * card, three extra navigation entries under a new "LEARN" section
 * plus a "Dual-Path Care" entry in the "CARE" section.
 *
 *   ┌──────────┬──────────────────────────────────────┐
 *   │ CARE     │  Top bar                              │
 *   │  Over    ├──────────────────────────────────────┤
 *   │  Chat    │                                       │
 *   │  SOS     │   Overview OR embedded view           │
 *   │  Plan    │   (plan / advice / reminders /        │
 *   │  Advice  │    topics / events / dual-path)       │
 *   │  Rem     │                                       │
 *   │  DualP   │                                       │
 *   │          │                                       │
 *   │ LEARN    │                                       │
 *   │  Topics  │   Floating SOS FAB (bottom-right)     │
 *   │  Events  │                                       │
 *   │          │                                       │
 *   │ SUPPORT  │                                       │
 *   │  Find CG │                                       │
 *   │  Chat CG │                                       │
 *   │  Priv    │                                       │
 *   └──────────┴──────────────────────────────────────┘
 *
 * Overlays (chat, caregivers, privacy, SOS) reuse the same components
 * already built for BeginnerShell; they are self-contained experiences.
 *
 * Z-index:
 *   BasicShell root        9000
 *   BasicShell overlay     9100
 *   SOS fab                9150
 *   EmergencyAlert         9300
 */

import { useCallback, useEffect, useRef, useState } from "react";
import BeginnerChat       from "./BeginnerChat.jsx";
import CaregiverDirectory from "./CaregiverDirectory.jsx";
import CaregiverChat      from "./CaregiverChat.jsx";
import PrivacyPanel       from "./PrivacyPanel.jsx";
import EmergencyAlert     from "./EmergencyAlert.jsx";

const API = (window.AMINA_API || "http://localhost:8000").replace(/\/+$/, "");


// ── Design tokens (mirror BeginnerShell) ────────────────────────────────────

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
const SIDEBAR_W = 260;


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

function initials(name) {
  if (!name) return "·";
  const parts = String(name).trim().split(/\s+/).slice(0, 2);
  return parts.map(p => p[0]?.toUpperCase() || "").join("") || "·";
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


// ── Inline SVG icons ────────────────────────────────────────────────────────

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
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <path d="M12 9v4M12 17h.01"/>
    </svg>
  ),
  book: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
    </svg>
  ),
  calendar: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8"  y1="2" x2="8"  y2="6"/>
      <line x1="3"  y1="10" x2="21" y2="10"/>
    </svg>
  ),
  branch: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="3" x2="6" y2="15"/>
      <circle cx="18" cy="6" r="3"/>
      <circle cx="6"  cy="18" r="3"/>
      <path d="M18 9a9 9 0 0 1-9 9"/>
    </svg>
  ),
  arrow: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 5l7 7-7 7"/>
    </svg>
  ),
  check: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
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
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <path d="M12 9v4M12 17h.01"/>
    </svg>
  ),
  pill: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="10" width="20" height="8" rx="4"/>
      <line x1="12" y1="10" x2="12" y2="18"/>
    </svg>
  ),
  herbs: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21c0-6 4-12 10-12-1 6-4 12-10 12z"/>
      <path d="M12 21C12 15 8 9 2 9c1 6 4 12 10 12z"/>
      <line x1="12" y1="21" x2="12" y2="14"/>
    </svg>
  ),
};


// ── Nav structure ───────────────────────────────────────────────────────────

const NAV_SECTIONS = [
  {
    label: "Care",
    items: [
      { id: "overview",  label: "Overview",          icon: ICN.home,     kind: "view" },
      { id: "chat",      label: "Talk to AMINA",     icon: ICN.chat,     kind: "overlay" },
      { id: "sos",       label: "Emergency Alert",   icon: ICN.sos,      kind: "overlay", danger: true },
      { id: "plan",      label: "Care Plan",         icon: ICN.plan,     kind: "view" },
      { id: "advice",    label: "Today's Advice",    icon: ICN.sun,      kind: "view" },
      { id: "reminders", label: "Reminders",         icon: ICN.bell,     kind: "view" },
      { id: "dualPath",  label: "Dual-Path Care",    icon: ICN.branch,   kind: "view" },
    ],
  },
  {
    label: "Learn",
    items: [
      { id: "topics", label: "Choose a Topic",    icon: ICN.book,     kind: "view" },
      { id: "events", label: "Community Events",  icon: ICN.calendar, kind: "view" },
    ],
  },
  {
    label: "Support",
    items: [
      { id: "findCg",  label: "Find a Caregiver",    icon: ICN.users,  kind: "overlay" },
      { id: "chatCg",  label: "Chat with Caregiver", icon: ICN.cgChat, kind: "overlay" },
      { id: "privacy", label: "Privacy & Data",      icon: ICN.shield, kind: "overlay" },
    ],
  },
];

const NAV_TITLES = {
  overview:  "Overview",
  plan:      "Care Plan",
  advice:    "Today's Advice",
  reminders: "Reminders",
  topics:    "Choose a Topic",
  events:    "Community Events",
  dualPath:  "Dual-Path Care",
};


// ── Main shell ──────────────────────────────────────────────────────────────

export default function BasicShell({ token, patientName = "" }) {
  const [nav, setNav]                 = useState("overview");
  const [overlay, setOverlay]         = useState(null); // chat|findCg|chatCg|privacy
  const [sosOpen, setSosOpen]         = useState(false);
  const [sosInitialReason, setSosIR]  = useState(null);
  const [toast, setToast]             = useState("");
  const toastTimer                    = useRef(null);

  const patient      = getPatient();
  const displayName  = patientName || patient?.name || "Friend";

  const showToast = useCallback((text) => {
    setToast(text || "");
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2400);
  }, []);

  const openSos = useCallback((reasonId = null) => {
    setSosIR(reasonId || null);
    setSosOpen(true);
  }, []);

  const closeSos = useCallback(() => {
    setSosOpen(false);
    setSosIR(null);
  }, []);

  const onNavClick = useCallback((item) => {
    if (item.kind === "overlay") {
      if (item.id === "sos") {
        openSos(null);
      } else {
        setOverlay(item.id);
      }
    } else {
      setNav(item.id);
      setOverlay(null);
    }
  }, [openSos]);

  const onLogout = useCallback(() => {
    try {
      localStorage.removeItem("AMINA_TOKEN");
      localStorage.removeItem("AMINA_PATIENT");
    } catch { /* noop */ }
    window.location.reload();
  }, []);

  // Escape closes SOS → overlay → nothing (mirrors BeginnerShell)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (sosOpen)    { closeSos(); return; }
      if (overlay)    { setOverlay(null); return; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlay, sosOpen, closeSos]);

  return (
    <div
      className="amina-basic-shell"
      style={{
        position: "fixed", inset: 0, zIndex: 9000,
        background:
          `radial-gradient(1100px 560px at 14% -10%, rgba(99,102,241,.10), transparent 60%),` +
          `radial-gradient(900px 500px at 108% 12%, rgba(139,92,246,.09), transparent 60%),` +
          T.bg,
        color: T.text,
        fontFamily: FONT,
        display: "flex",
        overflow: "hidden",
      }}
      data-literacy-ignore
    >
      {/* Keep the global literacy badge from overlapping the Sign-out button */}
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
            padding: "26px 34px 36px",
          }}
        >
          <div style={{ maxWidth: 1180, margin: "0 auto" }}>
            {nav === "overview" && (
              <Overview
                displayName={displayName}
                onOpenChat={() => setOverlay("chat")}
                onGoTo={setNav}
                onOpenOverlay={setOverlay}
                onOpenSos={() => openSos(null)}
              />
            )}
            {nav === "plan"      && <CarePlanView      onToast={showToast} />}
            {nav === "advice"    && <SeasonalView />}
            {nav === "reminders" && <RemindersView     patient={patient} onToast={showToast} />}
            {nav === "topics"    && <TopicsView        onOpenChat={() => setOverlay("chat")} />}
            {nav === "events"    && <EventsView />}
            {nav === "dualPath"  && <DualPathView      patient={patient} />}
          </div>
        </div>
      </div>

      {/* Floating SOS FAB — only surfaces while a chat overlay is open
          (home screen no longer carries the permanent red pulse). Also
          hidden while the SOS module itself is open. */}
      {!sosOpen && overlay === "chat" && <SosFab onClick={() => openSos(null)} />}

      {/* Overlays */}
      {overlay === "chat" && (
        <BeginnerChat
          token={token}
          patient={patient}
          mode="basic"
          onClose={() => setOverlay(null)}
          onRequestEmergency={(reasonId) => openSos(reasonId)}
        />
      )}
      {overlay === "findCg" && (
        <CaregiverDirectory onClose={() => setOverlay(null)} />
      )}
      {overlay === "chatCg" && (
        <CaregiverChat onClose={() => setOverlay(null)} />
      )}
      {overlay === "privacy" && (
        <PrivacyPanel onClose={() => setOverlay(null)} />
      )}
      {sosOpen && (
        <EmergencyAlert
          token={token}
          patient={patient}
          initialReasonId={sosInitialReason}
          onClose={closeSos}
        />
      )}

      <Toast text={toast} />
    </div>
  );
}


// ── Sidebar ────────────────────────────────────────────────────────────────

function Sidebar({ nav, overlay, sosOpen, onNavClick, displayName, onLogout }) {
  return (
    <aside
      style={{
        width: SIDEBAR_W,
        minWidth: SIDEBAR_W,
        background: `linear-gradient(180deg, ${T.bgSoft} 0%, ${T.bg} 100%)`,
        borderRight: `1px solid ${T.border}`,
        display: "flex", flexDirection: "column",
      }}
    >
      {/* Brand */}
      <div
        style={{
          padding: "20px 18px 14px",
          borderBottom: `1px solid ${T.border}`,
          display: "flex", alignItems: "center", gap: 11,
        }}
      >
        <div
          style={{
            width: 34, height: 34, borderRadius: 9,
            background: "linear-gradient(135deg,#6366f1,#8b5cf6,#22d3ee)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontWeight: 800, fontSize: 16,
          }}
        >
          A
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: 0.2, color: T.text }}>
            AMINA Care
          </div>
          <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>
            Patient portal
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "14px 12px", overflowY: "auto" }}>
        {NAV_SECTIONS.map((section, si) => (
          <div key={section.label} style={{ marginBottom: si === NAV_SECTIONS.length - 1 ? 0 : 14 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: 1.2,
                color: T.subtle,
                padding: "10px 10px 6px",
              }}
            >
              {section.label}
            </div>
            {section.items.map(item => {
              const active =
                (item.kind === "view"    && nav === item.id) ||
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
          padding: "12px 12px 16px",
          borderTop: `1px solid ${T.border}`,
          display: "flex", flexDirection: "column", gap: 10,
        }}
      >
        <div
          style={{
            padding: "10px 11px",
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: 11,
            display: "flex", alignItems: "center", gap: 10,
          }}
        >
          <div
            style={{
              width: 32, height: 32, borderRadius: 9,
              background: T.user,
              color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {initials(displayName)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 12, fontWeight: 700, color: T.text,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}
            >
              {displayName}
            </div>
            <div style={{ fontSize: 10, color: T.muted, display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ color: T.cyan, display: "flex" }}>{ICN.dot}</span>
              Basic mode
            </div>
          </div>
        </div>

        <button
          onClick={onLogout}
          data-literacy-ignore
          style={{
            all: "unset",
            cursor: "pointer",
            padding: "10px 12px",
            borderRadius: 10,
            background: "transparent",
            border: `1px solid ${T.border}`,
            color: T.muted,
            fontSize: 11, fontWeight: 600,
            display: "flex", alignItems: "center", gap: 10, justifyContent: "center",
            fontFamily: FONT,
            transition: "all .15s ease",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = "rgba(248,113,113,.4)";
            e.currentTarget.style.color = T.danger;
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = T.border;
            e.currentTarget.style.color = T.muted;
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
  const isDanger = !!danger;

  const base = {
    display: "flex", alignItems: "center", gap: 11,
    padding: "9px 11px",
    margin: "1px 0",
    borderRadius: 9,
    color: isDanger ? "#fecaca" : (active ? T.text : T.muted),
    background: active
      ? (isDanger ? "rgba(220,38,38,.18)" : "rgba(99,102,241,.14)")
      : (hover ? (isDanger ? "rgba(220,38,38,.10)" : "rgba(255,255,255,.03)") : "transparent"),
    border: `1px solid ${
      active
        ? (isDanger ? "rgba(220,38,38,.5)" : T.borderHi)
        : "transparent"
    }`,
    cursor: "pointer",
    fontSize: 12.5, fontWeight: active ? 700 : 500,
    transition: "all .12s ease",
    fontFamily: FONT,
  };

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={base}
    >
      <span
        style={{
          display: "flex",
          color: isDanger ? "#fca5a5" : (active ? T.accent : T.muted),
        }}
      >
        {icon}
      </span>
      <span style={{ flex: 1 }}>{label}</span>
    </div>
  );
}


// ── Top bar ────────────────────────────────────────────────────────────────

function TopBar({ nav, displayName }) {
  const title = NAV_TITLES[nav] || "Overview";
  return (
    <header
      style={{
        padding: "16px 34px",
        borderBottom: `1px solid ${T.border}`,
        background: `linear-gradient(180deg, rgba(12,17,40,.75), rgba(12,17,40,.35))`,
        backdropFilter: "blur(8px)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexShrink: 0,
      }}
    >
      <div>
        <div
          style={{
            fontSize: 10.5,
            color: T.muted,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 1.2,
            marginBottom: 3,
          }}
        >
          {formatDate()}
        </div>
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 800,
            color: T.text,
            letterSpacing: -0.2,
          }}
        >
          {title}
        </h1>
      </div>

      <div
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "7px 13px",
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: 999,
        }}
      >
        <div
          style={{
            width: 24, height: 24, borderRadius: "50%",
            background: T.user,
            color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, fontWeight: 700,
          }}
        >
          {initials(displayName)}
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, color: T.text }}>
          {displayName}
        </span>
      </div>
    </header>
  );
}


// ── Overview ────────────────────────────────────────────────────────────────

function Overview({ displayName, onOpenChat, onGoTo, onOpenOverlay, onOpenSos }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <HeroBanner displayName={displayName} onOpenChat={onOpenChat} onOpenSos={onOpenSos} />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 14,
        }}
      >
        <StatusCard
          title="Care Plan"
          subtitle="Daily actions for your condition"
          icon={ICN.plan}
          accent={T.accent}
          onClick={() => onGoTo("plan")}
        />
        <StatusCard
          title="Today's Advice"
          subtitle="Seasonal health tips"
          icon={ICN.sun}
          accent={T.amber}
          onClick={() => onGoTo("advice")}
        />
        <StatusCard
          title="Reminders"
          subtitle="Medicine + check-ins"
          icon={ICN.bell}
          accent={T.emerald}
          onClick={() => onGoTo("reminders")}
        />
        <StatusCard
          title="Dual-Path Care"
          subtitle="Traditional + modern"
          icon={ICN.branch}
          accent={T.cyan}
          onClick={() => onGoTo("dualPath")}
        />
        <StatusCard
          title="Choose a Topic"
          subtitle="Learn about your health"
          icon={ICN.book}
          accent={T.accent2}
          onClick={() => onGoTo("topics")}
        />
        <StatusCard
          title="Community Events"
          subtitle="Screenings near you"
          icon={ICN.calendar}
          accent={T.rose}
          onClick={() => onGoTo("events")}
        />
      </div>

      <QuickRow
        onOpenChat={onOpenChat}
        onFindCg={() => onOpenOverlay("findCg")}
        onChatCg={() => onOpenOverlay("chatCg")}
      />
    </div>
  );
}


function HeroBanner({ displayName, onOpenChat, onOpenSos }) {
  return (
    <div
      style={{
        padding: "22px 24px",
        borderRadius: 16,
        background: `linear-gradient(135deg, rgba(99,102,241,.18), rgba(34,211,238,.12))`,
        border: `1px solid ${T.borderHi}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: 10.5,
            color: T.accent,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 1.2,
            marginBottom: 4,
          }}
        >
          Welcome back
        </div>
        <h2
          style={{
            margin: 0,
            fontSize: 24,
            fontWeight: 800,
            color: T.text,
            letterSpacing: -0.3,
          }}
        >
          Hello, {displayName}
        </h2>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: T.textDim, maxWidth: 640 }}>
          Ask AMINA a question, check your care plan, or browse health topics.
          In an emergency, use the red button.
        </p>
      </div>
      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
        <button
          onClick={onOpenChat}
          data-literacy-ignore
          style={{
            all: "unset",
            cursor: "pointer",
            padding: "11px 18px",
            borderRadius: 11,
            background: T.user,
            color: "#fff",
            fontSize: 13, fontWeight: 700,
            display: "inline-flex", alignItems: "center", gap: 8,
            fontFamily: FONT,
            boxShadow: "0 10px 24px rgba(99,102,241,.35)",
          }}
        >
          {ICN.chat} Talk to AMINA
        </button>
        <button
          onClick={onOpenSos}
          data-literacy-ignore
          style={{
            all: "unset",
            cursor: "pointer",
            padding: "11px 14px",
            borderRadius: 11,
            background: "rgba(220,38,38,.15)",
            border: "1px solid rgba(220,38,38,.5)",
            color: "#fecaca",
            fontSize: 12, fontWeight: 700,
            display: "inline-flex", alignItems: "center", gap: 7,
            fontFamily: FONT,
          }}
        >
          {ICN.sos} SOS
        </button>
      </div>
    </div>
  );
}


function StatusCard({ title, subtitle, icon, accent, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: 16,
        borderRadius: 13,
        background: hover
          ? `linear-gradient(180deg, ${T.surface2}, ${T.surface})`
          : T.surface,
        border: `1px solid ${hover ? T.borderHi : T.border}`,
        cursor: "pointer",
        transition: "all .15s ease",
        transform: hover ? "translateY(-1px)" : "none",
        display: "flex", flexDirection: "column", gap: 11,
        minHeight: 112,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <div
          style={{
            width: 32, height: 32, borderRadius: 9,
            background: `${accent}22`,
            color: accent,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {icon}
        </div>
        <div style={{ fontSize: 13, fontWeight: 800, color: T.text }}>
          {title}
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: T.muted, lineHeight: 1.5 }}>
        {subtitle}
      </div>
      <div
        style={{
          marginTop: "auto",
          display: "flex", alignItems: "center", gap: 5,
          fontSize: 11, color: accent, fontWeight: 700,
        }}
      >
        Open {ICN.arrow}
      </div>
    </div>
  );
}


function QuickRow({ onOpenChat, onFindCg, onChatCg }) {
  const items = [
    { label: "Talk to AMINA",      icon: ICN.chat,   onClick: onOpenChat },
    { label: "Find a Caregiver",   icon: ICN.users,  onClick: onFindCg },
    { label: "Chat with Caregiver", icon: ICN.cgChat, onClick: onChatCg },
  ];
  return (
    <div
      style={{
        padding: "14px 16px",
        borderRadius: 13,
        background: T.surface,
        border: `1px solid ${T.border}`,
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: T.subtle,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 1.2,
          marginRight: 6,
        }}
      >
        Quick actions
      </div>
      {items.map(it => (
        <button
          key={it.label}
          onClick={it.onClick}
          data-literacy-ignore
          style={{
            all: "unset",
            cursor: "pointer",
            padding: "8px 13px",
            borderRadius: 9,
            background: T.surface2,
            border: `1px solid ${T.border}`,
            color: T.textDim,
            fontSize: 12, fontWeight: 600,
            display: "inline-flex", alignItems: "center", gap: 7,
            fontFamily: FONT,
            transition: "all .12s ease",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = T.borderHi;
            e.currentTarget.style.color = T.text;
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = T.border;
            e.currentTarget.style.color = T.textDim;
          }}
        >
          {it.icon} {it.label}
        </button>
      ))}
    </div>
  );
}


// ── Care Plan view (hits /agent/care-plan) ──────────────────────────────────

function CarePlanView({ onToast }) {
  const [plan, setPlan]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [generating, setGen]  = useState(false);
  const sid                   = getOrCreateSessionId();

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
      const r = await fetch(
        `${API}/api/v1/agent/care-plan/${encodeURIComponent(sid)}/generate`,
        { method: "POST" },
      );
      if (!r.ok) {
        setError("Chat with AMINA first so she can learn about you, then come back.");
        return;
      }
      const d = await r.json();
      if (d.plan) { setPlan(d.plan); onToast && onToast("Care plan ready"); }
    } catch {
      setError("Could not make your care plan. Please try again.");
    } finally {
      setGen(false);
    }
  };

  if (loading) return <DarkCard title="Loading your care plan…" />;

  if (!plan) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <DarkCard
          title="No care plan yet"
          body="A care plan lists daily actions for your condition. AMINA can draft one once you've chatted with her a few times."
        />
        {error && <ErrorBox text={error} />}
        <PrimaryButton
          label={generating ? "Making your plan…" : "Make my care plan"}
          disabled={generating}
          onClick={generate}
        />
      </div>
    );
  }

  const sections = [];
  if (plan.daily_actions?.length)   sections.push(["Daily actions",    plan.daily_actions]);
  if (plan.weekly_goals?.length)    sections.push(["This week",        plan.weekly_goals]);
  if (plan.watch_for?.length)       sections.push(["Watch for",        plan.watch_for]);
  if (plan.medicines?.length)       sections.push(["Medicines",        plan.medicines]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {plan.summary && <DarkCard title="Summary" body={plan.summary} />}
      {sections.map(([label, items]) => (
        <DarkCard
          key={label}
          title={label}
          list={items.map(x => typeof x === "string" ? x : (x.text || x.name || JSON.stringify(x)))}
        />
      ))}
      <SecondaryButton
        label={generating ? "Updating…" : "Refresh my plan"}
        disabled={generating}
        onClick={generate}
      />
    </div>
  );
}


// ── Seasonal advice view (hits /community/seasonal) ─────────────────────────

function SeasonalView() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const patient               = getPatient();
  const region                = patient?.region || "Kanifing";

  useEffect(() => {
    setLoading(true); setError("");
    fetch(`${API}/api/v1/community/seasonal?region=${encodeURIComponent(region)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setData(d || null))
      .catch(() => setError("Could not load today's advice."))
      .finally(() => setLoading(false));
  }, [region]);

  if (loading) return <DarkCard title="Loading today's advice…" />;
  if (error)   return <ErrorBox text={error} />;
  if (!data)   return <DarkCard title="No advice available right now" body="Please check again later." />;

  const tips = Array.isArray(data.tips) ? data.tips : [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <DarkCard
        title={data.season_label || "Seasonal advice"}
        body={data.region_label ? `For ${data.region_label}` : `For ${region}`}
      />
      {tips.length > 0 ? (
        <DarkCard title="Health tips today" list={tips.map(t => typeof t === "string" ? t : (t.text || ""))} />
      ) : (
        <DarkCard title="No specific tips today" body="Drink water. Take your medicine. Rest if tired." />
      )}
    </div>
  );
}


// ── Reminders view (hits /reminder) ─────────────────────────────────────────

function RemindersView({ patient, onToast }) {
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const pid                   = patient?.id;

  const load = useCallback(() => {
    if (!pid) { setLoading(false); return; }
    setLoading(true); setError("");
    fetch(`${API}/api/v1/reminder/${encodeURIComponent(pid)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setItems(Array.isArray(d?.reminders) ? d.reminders : []))
      .catch(() => setError("Could not load reminders."))
      .finally(() => setLoading(false));
  }, [pid]);

  useEffect(() => { load(); }, [load]);

  if (!pid)     return <DarkCard title="Reminders" body="Log in to see your reminders." />;
  if (loading)  return <DarkCard title="Loading your reminders…" />;
  if (error)    return <ErrorBox text={error} />;
  if (!items.length) {
    return (
      <DarkCard
        title="No reminders yet"
        body="Ask AMINA to set a reminder for you — for example 'Remind me to take my pill every morning'."
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {items.map((r, i) => (
        <div
          key={i}
          style={{
            padding: "13px 15px",
            borderRadius: 11,
            background: T.surface,
            border: `1px solid ${T.border}`,
            display: "flex", alignItems: "center", gap: 12,
          }}
        >
          <div
            style={{
              width: 32, height: 32, borderRadius: 9,
              background: `${T.emerald}22`, color: T.emerald,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            {ICN.bell}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>
              {r.text || r.title || "Reminder"}
            </div>
            {(r.schedule || r.time) && (
              <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                {r.schedule || r.time}
              </div>
            )}
          </div>
        </div>
      ))}
      {onToast && null}
    </div>
  );
}


// ── Topics view (hardcoded library) ─────────────────────────────────────────

const TOPICS = [
  {
    id: "hypertension", title: "High Blood Pressure", accent: "#f87171",
    tagline: "Keep your pressure in a safe range every day.",
    points: [
      "Eat less salt — skip the salted fish and maggi cubes.",
      "Take your medicine every day, even when you feel fine.",
      "Walk 20 minutes most days to keep your heart strong.",
    ],
  },
  {
    id: "diabetes", title: "Diabetes", accent: "#fbbf24",
    tagline: "Balance your sugar to avoid long-term problems.",
    points: [
      "Cut sugary drinks — water is the best drink for you.",
      "Check your sugar when your clinician asks.",
      "Eat at regular times, don't skip meals.",
    ],
  },
  {
    id: "pregnancy", title: "Pregnancy", accent: "#f472b6",
    tagline: "Keep both you and your baby safe.",
    points: [
      "Go to the clinic for every check-up, even if you feel well.",
      "Take iron and folic acid every day.",
      "Sleep under a treated mosquito net.",
    ],
  },
  {
    id: "malaria", title: "Malaria", accent: "#60a5fa",
    tagline: "Prevent it and treat it fast.",
    points: [
      "Sleep under a treated net every night.",
      "Get tested quickly if you have fever — don't wait.",
      "Finish the full course of medicine.",
    ],
  },
  {
    id: "tb", title: "Tuberculosis (TB)", accent: "#22d3ee",
    tagline: "Six months of treatment cures TB.",
    points: [
      "Take every dose — missing days makes TB harder to cure.",
      "Cover your mouth when coughing.",
      "Make sure people you live with get checked.",
    ],
  },
  {
    id: "nutrition", title: "Eating for Health", accent: "#34d399",
    tagline: "Simple food choices that protect your body.",
    points: [
      "Fill half your plate with vegetables and fruits.",
      "Choose brown rice, millet or whole bread when you can.",
      "Limit fried food and bouillon cubes.",
    ],
  },
  {
    id: "child", title: "Child Health", accent: "#a78bfa",
    tagline: "Keep your child growing strong.",
    points: [
      "All vaccinations on time, at the clinic.",
      "Breastfeed for the first six months.",
      "Use ORS right away if your child has diarrhea.",
    ],
  },
  {
    id: "mental", title: "Feeling Better in Your Mind", accent: "#818cf8",
    tagline: "Your feelings matter too.",
    points: [
      "Talk to someone you trust if you feel heavy inside.",
      "Sleep 7–8 hours at night when you can.",
      "Prayer, walks and friends all help.",
    ],
  },
];


function TopicsView({ onOpenChat }) {
  const [selected, setSelected] = useState(null);

  if (selected) {
    const topic = TOPICS.find(t => t.id === selected);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <button
          onClick={() => setSelected(null)}
          data-literacy-ignore
          style={{
            all: "unset",
            cursor: "pointer",
            alignSelf: "flex-start",
            padding: "8px 14px",
            borderRadius: 9,
            background: T.surface2,
            border: `1px solid ${T.border}`,
            color: T.textDim,
            fontSize: 12, fontWeight: 600,
            fontFamily: FONT,
          }}
        >
          ← All topics
        </button>

        <div
          style={{
            padding: "22px 24px",
            borderRadius: 14,
            background: `linear-gradient(135deg, ${topic.accent}22, ${T.surface})`,
            border: `1px solid ${topic.accent}55`,
          }}
        >
          <div
            style={{
              fontSize: 10.5, color: topic.accent, fontWeight: 700,
              textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 6,
            }}
          >
            Topic
          </div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: T.text }}>
            {topic.title}
          </h2>
          <p style={{ margin: "8px 0 0", fontSize: 13, color: T.textDim, maxWidth: 640 }}>
            {topic.tagline}
          </p>
        </div>

        <DarkCard title="What you can do" list={topic.points} />

        <div
          style={{
            padding: "14px 16px",
            borderRadius: 12,
            background: T.surface,
            border: `1px solid ${T.border}`,
            display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: 12, flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>
              Have a question about {topic.title.toLowerCase()}?
            </div>
            <div style={{ fontSize: 11.5, color: T.muted, marginTop: 2 }}>
              Talk to AMINA and she'll explain it in your language.
            </div>
          </div>
          <button
            onClick={onOpenChat}
            data-literacy-ignore
            style={{
              all: "unset",
              cursor: "pointer",
              padding: "10px 16px",
              borderRadius: 10,
              background: T.user,
              color: "#fff",
              fontSize: 12, fontWeight: 700,
              display: "inline-flex", alignItems: "center", gap: 7,
              fontFamily: FONT,
            }}
          >
            {ICN.chat} Ask AMINA
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <DarkCard
        title="Choose a topic to learn about"
        body="Pick what you want to know more about. You can also ask AMINA any question directly."
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
          gap: 12,
        }}
      >
        {TOPICS.map(t => (
          <TopicTile key={t.id} topic={t} onClick={() => setSelected(t.id)} />
        ))}
      </div>
    </div>
  );
}


function TopicTile({ topic, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: 14,
        borderRadius: 12,
        background: hover ? T.surface2 : T.surface,
        border: `1px solid ${hover ? topic.accent + "55" : T.border}`,
        cursor: "pointer",
        transition: "all .12s ease",
        transform: hover ? "translateY(-1px)" : "none",
      }}
    >
      <div
        style={{
          width: 30, height: 30, borderRadius: 8,
          background: `${topic.accent}22`,
          color: topic.accent,
          display: "flex", alignItems: "center", justifyContent: "center",
          marginBottom: 11,
        }}
      >
        {ICN.book}
      </div>
      <div style={{ fontSize: 13.5, fontWeight: 800, color: T.text, marginBottom: 4 }}>
        {topic.title}
      </div>
      <div style={{ fontSize: 11.5, color: T.muted, lineHeight: 1.5 }}>
        {topic.tagline}
      </div>
    </div>
  );
}


// ── Community events view (hardcoded calendar) ──────────────────────────────

const EVENTS = [
  {
    id: "e1", title: "Free Blood Pressure Screening",
    date: "Sat 18 Apr",    time: "9:00 – 13:00",
    venue: "Kanifing Market Square",
    tag: "Screening", accent: "#f87171",
    note: "Walk in, no appointment needed.",
  },
  {
    id: "e2", title: "Childhood Vaccination Day",
    date: "Tue 21 Apr",    time: "8:30 – 12:00",
    venue: "Serrekunda Health Centre",
    tag: "Vaccines", accent: "#60a5fa",
    note: "For children aged 0–5. Bring the yellow card.",
  },
  {
    id: "e3", title: "Diabetes Support Group",
    date: "Wed 22 Apr",    time: "17:00 – 18:30",
    venue: "Bakau Community Hall",
    tag: "Support", accent: "#fbbf24",
    note: "Share food tips and hear from a nurse.",
  },
  {
    id: "e4", title: "Safe Motherhood Talk",
    date: "Fri 24 Apr",    time: "10:00 – 11:30",
    venue: "Banjul MCH Clinic",
    tag: "Maternal", accent: "#f472b6",
    note: "For pregnant women and new mothers.",
  },
  {
    id: "e5", title: "Mosquito Net Distribution",
    date: "Mon 27 Apr",    time: "9:00 – 15:00",
    venue: "Brikama District Office",
    tag: "Malaria", accent: "#22d3ee",
    note: "Free treated nets, one per household.",
  },
  {
    id: "e6", title: "Youth Mental Health Circle",
    date: "Sat 2 May",     time: "15:00 – 17:00",
    venue: "Fajara Youth Centre",
    tag: "Wellbeing", accent: "#818cf8",
    note: "Safe space to talk. Ages 15–25.",
  },
];


function EventsView() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <DarkCard
        title="What's happening near you"
        body="Free community health events in your region. Show up — no registration needed unless we say so."
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 12,
        }}
      >
        {EVENTS.map(ev => (
          <EventCard key={ev.id} event={ev} />
        ))}
      </div>
    </div>
  );
}


function EventCard({ event }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: 16,
        borderRadius: 13,
        background: hover ? T.surface2 : T.surface,
        border: `1px solid ${hover ? event.accent + "55" : T.border}`,
        transition: "all .12s ease",
        display: "flex", flexDirection: "column", gap: 10,
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignSelf: "flex-start",
          alignItems: "center",
          gap: 5,
          padding: "4px 10px",
          borderRadius: 999,
          background: `${event.accent}22`,
          color: event.accent,
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 0.6,
        }}
      >
        <span style={{ display: "flex" }}>{ICN.dot}</span>
        {event.tag}
      </div>

      <div style={{ fontSize: 14.5, fontWeight: 800, color: T.text, lineHeight: 1.35 }}>
        {event.title}
      </div>

      <div style={{ fontSize: 12, color: T.textDim, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ color: event.accent, display: "flex" }}>{ICN.calendar}</span>
          {event.date} · {event.time}
        </div>
        <div style={{ color: T.muted }}>{event.venue}</div>
      </div>

      {event.note && (
        <div
          style={{
            marginTop: 4,
            padding: "8px 10px",
            borderRadius: 8,
            background: T.bgSoft,
            border: `1px solid ${T.border}`,
            fontSize: 11.5,
            color: T.textDim,
            lineHeight: 1.5,
          }}
        >
          {event.note}
        </div>
      )}
    </div>
  );
}


// ── Dual-Path Care view (hits /api/v1/care/dualpath/{pid}) ──────────────────

function DualPathView({ patient }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const pid                   = patient?.id || getOrCreateSessionId();

  useEffect(() => {
    setLoading(true); setError("");
    fetch(`${API}/api/v1/care/dualpath/${encodeURIComponent(pid)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d)  { setError("Could not load dual-path care."); return; }
        setData(d);
      })
      .catch(() => setError("Could not load dual-path care."))
      .finally(() => setLoading(false));
  }, [pid]);

  if (loading) return <DarkCard title="Loading your dual-path care…" />;
  if (error)   return <ErrorBox text={error} />;
  if (!data)   return <DarkCard title="No dual-path data yet" body="Your clinician has not set this up for you." />;

  const trad = data.traditional_care || {};
  const mod  = data.modern_care      || {};
  const flag = data.interactions_flag || {};
  const prog = data.progress         || {};

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <DarkCard
        title="Your dual-path care"
        body="AMINA respects both traditional and modern care. This view shows both sides of your treatment, so nothing is hidden from either path."
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 12,
        }}
      >
        <PathCard
          title="Traditional care"
          accent={T.emerald}
          icon={ICN.herbs}
          practitioner={trad.practitioner}
          lines={[
            ...((trad.practices || []).map(p => ({ icon: ICN.check, text: p }))),
            trad.last_visit_days_ago != null
              ? { icon: ICN.dot, text: `Last visit ${trad.last_visit_days_ago} days ago` }
              : null,
            trad.notes ? { icon: ICN.dot, text: trad.notes } : null,
          ].filter(Boolean)}
        />
        <PathCard
          title="Modern care"
          accent={T.accent}
          icon={ICN.pill}
          practitioner={mod.facility}
          subtitle={mod.chw_name ? `CHW: ${mod.chw_name}` : ""}
          lines={[
            ...((mod.medications || []).map(m => ({ icon: ICN.pill, text: m }))),
            mod.last_visit_days_ago != null
              ? { icon: ICN.dot, text: `Last visit ${mod.last_visit_days_ago} days ago` }
              : null,
            mod.notes ? { icon: ICN.dot, text: mod.notes } : null,
          ].filter(Boolean)}
        />
      </div>

      {/* Interaction safety banner */}
      <div
        style={{
          padding: "14px 16px",
          borderRadius: 12,
          background: flag.safe
            ? "rgba(52,211,153,.08)"
            : "rgba(220,38,38,.10)",
          border: `1px solid ${
            flag.safe ? "rgba(52,211,153,.35)" : "rgba(220,38,38,.45)"
          }`,
          display: "flex", alignItems: "flex-start", gap: 12,
        }}
      >
        <div
          style={{
            width: 32, height: 32, borderRadius: 9, flexShrink: 0,
            background: flag.safe ? "rgba(52,211,153,.18)" : "rgba(220,38,38,.18)",
            color:      flag.safe ? T.emerald                : T.danger,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {flag.safe ? ICN.check : ICN.alert}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 12.5,
              fontWeight: 800,
              color: flag.safe ? T.emerald : T.danger,
              marginBottom: 3,
              textTransform: "uppercase",
              letterSpacing: 0.6,
            }}
          >
            {flag.safe ? "Both paths are safe together" : "Possible interaction — be careful"}
          </div>
          <div style={{ fontSize: 12.5, color: T.textDim, lineHeight: 1.5 }}>
            {flag.notes || "Your clinician has not written a note yet."}
          </div>
        </div>
      </div>

      {/* Progress */}
      {(prog.bp_current || prog.months_on_plan || prog.message) && (
        <DarkCard
          title="Your progress"
          body={prog.message || ""}
          list={[
            prog.bp_start && prog.bp_current
              ? `Blood pressure: ${prog.bp_start} → ${prog.bp_current}`
              : (prog.bp_current ? `Blood pressure: ${prog.bp_current}` : null),
            prog.months_on_plan != null ? `Months on plan: ${prog.months_on_plan}` : null,
          ].filter(Boolean)}
        />
      )}

      <div
        style={{
          padding: "11px 14px",
          borderRadius: 10,
          background: T.bgSoft,
          border: `1px solid ${T.border}`,
          fontSize: 11.5, color: T.muted, lineHeight: 1.55,
        }}
      >
        Only your clinician or community health worker can change this page.
        If anything is wrong, tell them at your next visit.
      </div>
    </div>
  );
}


function PathCard({ title, accent, icon, practitioner, subtitle, lines }) {
  return (
    <div
      style={{
        padding: 16,
        borderRadius: 13,
        background: T.surface,
        border: `1px solid ${accent}44`,
        display: "flex", flexDirection: "column", gap: 11,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <div
          style={{
            width: 34, height: 34, borderRadius: 10,
            background: `${accent}22`,
            color: accent,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {icon}
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 10,
              color: accent,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 1.2,
            }}
          >
            {title}
          </div>
          <div
            style={{
              fontSize: 14, fontWeight: 800, color: T.text,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}
          >
            {practitioner || "Not set"}
          </div>
          {subtitle && (
            <div style={{ fontSize: 11, color: T.muted, marginTop: 1 }}>
              {subtitle}
            </div>
          )}
        </div>
      </div>

      {lines.length > 0 && (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 7,
          }}
        >
          {lines.map((ln, i) => (
            <li
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                fontSize: 12, color: T.textDim, lineHeight: 1.55,
              }}
            >
              <span style={{ color: accent, display: "flex", marginTop: 2 }}>{ln.icon}</span>
              <span>{ln.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


// ── Primitive cards / buttons / toast ───────────────────────────────────────

function DarkCard({ title, body, list }) {
  return (
    <div
      style={{
        padding: "16px 18px",
        borderRadius: 13,
        background: T.surface,
        border: `1px solid ${T.border}`,
      }}
    >
      {title && (
        <div style={{ fontSize: 14, fontWeight: 800, color: T.text, marginBottom: body || list ? 8 : 0 }}>
          {title}
        </div>
      )}
      {body && (
        <div style={{ fontSize: 12.5, color: T.textDim, lineHeight: 1.55 }}>
          {body}
        </div>
      )}
      {list && list.length > 0 && (
        <ul
          style={{
            margin: "10px 0 0",
            padding: 0,
            listStyle: "none",
            display: "flex", flexDirection: "column", gap: 7,
          }}
        >
          {list.map((line, i) => (
            <li
              key={i}
              style={{
                display: "flex", alignItems: "flex-start", gap: 8,
                fontSize: 12.5, color: T.textDim, lineHeight: 1.55,
              }}
            >
              <span style={{ color: T.accent, marginTop: 2, display: "flex" }}>{ICN.check}</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


function ErrorBox({ text }) {
  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: 11,
        background: "rgba(220,38,38,.10)",
        border: "1px solid rgba(220,38,38,.35)",
        color: "#fecaca",
        fontSize: 12.5,
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
        cursor: disabled ? "not-allowed" : "pointer",
        padding: "12px 18px",
        borderRadius: 11,
        background: disabled ? "rgba(99,102,241,.4)" : T.user,
        color: "#fff",
        fontSize: 13, fontWeight: 700,
        display: "inline-flex", alignItems: "center", gap: 8,
        fontFamily: FONT,
        textAlign: "center", justifyContent: "center",
        boxShadow: disabled ? "none" : "0 10px 24px rgba(99,102,241,.30)",
      }}
    >
      {label}
    </button>
  );
}


function SecondaryButton({ label, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      data-literacy-ignore
      style={{
        all: "unset",
        cursor: disabled ? "not-allowed" : "pointer",
        padding: "10px 16px",
        borderRadius: 10,
        background: T.surface2,
        border: `1px solid ${T.border}`,
        color: T.textDim,
        fontSize: 12, fontWeight: 600,
        display: "inline-flex", alignItems: "center", gap: 8,
        alignSelf: "flex-start",
        fontFamily: FONT,
      }}
    >
      {label}
    </button>
  );
}


function SosFab({ onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <>
      <button
        onClick={onClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        data-literacy-ignore
        style={{
          // Top-right while a chat overlay is open. Pushed down to
          // top:90 so we sit BELOW the chat header (which carries the
          // language pills + model picker on the right at ~y=14-58).
          position: "fixed",
          right: 24,
          top: 90,
          zIndex: 9150,
          width: "auto",
          padding: "12px 18px",
          borderRadius: 999,
          background: "linear-gradient(135deg,#dc2626,#b91c1c)",
          color: "#fff",
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: 0.3,
          border: "none",
          cursor: "pointer",
          display: "inline-flex", alignItems: "center", gap: 8,
          boxShadow: hover
            ? "0 24px 56px rgba(220,38,38,.55), 0 0 0 6px rgba(220,38,38,.18)"
            : "0 16px 36px rgba(220,38,38,.45), 0 0 0 3px rgba(220,38,38,.14)",
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
          0%, 100% { box-shadow: 0 16px 36px rgba(220,38,38,.45), 0 0 0 3px rgba(220,38,38,.14); }
          50%      { box-shadow: 0 20px 46px rgba(220,38,38,.55), 0 0 0 10px rgba(220,38,38,.08); }
        }
      `}</style>
    </>
  );
}


function Toast({ text }) {
  if (!text) return null;
  return (
    <div
      data-literacy-ignore
      style={{
        position: "fixed",
        left: "50%",
        bottom: 28,
        transform: "translateX(-50%)",
        padding: "11px 18px",
        borderRadius: 999,
        background: "rgba(12,17,40,.95)",
        border: `1px solid ${T.borderHi}`,
        color: T.text,
        fontSize: 12.5, fontWeight: 700,
        boxShadow: "0 14px 36px rgba(0,0,0,.45)",
        zIndex: 9200,
        fontFamily: FONT,
      }}
    >
      {text}
    </div>
  );
}
