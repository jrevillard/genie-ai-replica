/**
 * RoleInboxBell — universal inbox bell for ALL roles.
 *
 * The existing InboxBell (patient) sits at top:490. This component
 * creates an inbox bell for non-patient roles (alkalo, vhw, clinician,
 * scout, admin, imam) that sits in the header area.
 *
 * For each role it:
 *   - Uses the same inbox backend (/api/v1/inbox/*)
 *   - Polls unread count every 20s
 *   - Shows the same InboxPanel slide-out drawer
 *   - Adds role-specific coloring to the bell
 *
 * Self-mounting: import this file and it auto-renders if the current
 * role is NOT patient (patient already has InboxBell).
 */

import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE = (() => {
  const raw = (typeof window !== "undefined" && window.__AMINA_API_BASE__)
           || (typeof window !== "undefined" && window.AMINA_API)
           || (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_BASE)
           || "http://localhost:8000";
  return String(raw).replace(/\/+$/, "");
})();

function _auth() {
  try {
    const tok = localStorage.getItem("AMINA_ADMIN_TOKEN")
             || localStorage.getItem("AMINA_TOKEN")
             || "";
    return tok ? { Authorization: `Bearer ${tok}` } : {};
  } catch { return {}; }
}

function _readRole() {
  try { return localStorage.getItem("AMINA_ROLE") || "patient"; }
  catch { return "patient"; }
}

const ROLE_COLORS = {
  alkalo:    { bg: "linear-gradient(135deg, #78350f 0%, #92400e 100%)", badge: "#f59e0b" },
  vhw:      { bg: "linear-gradient(135deg, #064e3b 0%, #065f46 100%)", badge: "#10b981" },
  clinician: { bg: "linear-gradient(135deg, #0c4a6e 0%, #0e7490 100%)", badge: "#06b6d4" },
  scout:    { bg: "linear-gradient(135deg, #7c2d12 0%, #9a3412 100%)", badge: "#f97316" },
  admin:    { bg: "linear-gradient(135deg, #701a75 0%, #86198f 100%)", badge: "#e879f9" },
  imam:     { bg: "linear-gradient(135deg, #3b0764 0%, #4c1d95 100%)", badge: "#a78bfa" },
};


// ── Inbox item card (compact) ──────────────────────────────────────

function InboxItem({ item, onRead }) {
  const sevColors = { info: "#14b8a6", warning: "#f59e0b", emergency: "#ef4444" };
  const kindIcons = {
    pdf: "\u{1F4C4}", alert: "⚠️", report: "\u{1F4CA}",
    notification: "\u{1F514}", reminder: "⏰",
    caregiver_ping: "\u{1F9D1}‍⚕️", email: "\u{1F4E7}",
    scout_suggestion: "\u{1F50D}", chat_summary: "\u{1F4AC}",
  };
  const age = _timeAgo(item.created_at);

  return (
    <div
      onClick={() => { if (!item.read) onRead(item.inbox_id); }}
      style={{
        display: "flex", gap: 10, padding: "10px 14px", cursor: "pointer",
        borderBottom: "1px solid rgba(148,163,184,0.08)",
        background: item.read ? "transparent" : "rgba(99,102,241,0.04)",
        transition: "background 0.15s",
      }}
    >
      <div style={{
        width: 3, borderRadius: 2, flexShrink: 0, alignSelf: "stretch",
        background: sevColors[item.severity] || sevColors.info,
      }} />
      <div style={{ fontSize: 18, flexShrink: 0, marginTop: 2 }}>
        {kindIcons[item.kind] || "\u{1F514}"}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: item.read ? 500 : 700,
          color: "#e2e8f0", marginBottom: 2,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{item.title}</div>
        <div style={{
          fontSize: 11, color: "#94a3b8", lineHeight: 1.4,
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}>{item.body}</div>
        <div style={{ fontSize: 10, color: "#64748b", marginTop: 3 }}>{age}</div>
      </div>
      {!item.read && (
        <div style={{
          width: 8, height: 8, borderRadius: "50%",
          background: "#6366f1", flexShrink: 0, alignSelf: "center",
        }} />
      )}
    </div>
  );
}


// ── Panel ───────────────────────────────────────────────────────────

function RoleInboxPanel({ open, onClose, items, unread, loading, onRead, onReadAll, onRefresh }) {
  if (!open) return null;
  const role = _readRole();

  return (
    <div style={{
      position: "fixed", top: 0, right: 0, bottom: 0,
      width: "min(380px, 92vw)",
      background: "#0b1220", borderLeft: "1px solid rgba(148,163,184,0.1)",
      zIndex: 9260, display: "flex", flexDirection: "column",
      animation: "amina-role-inbox-slide 240ms ease",
      boxShadow: "-8px 0 30px rgba(0,0,0,0.3)",
    }}>
      {/* Header */}
      <div style={{
        padding: "16px 18px", display: "flex", justifyContent: "space-between",
        alignItems: "center", borderBottom: "1px solid rgba(148,163,184,0.1)",
        background: ROLE_COLORS[role]?.bg || ROLE_COLORS.admin.bg,
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#f1f5f9" }}>Inbox</div>
          {unread > 0 && (
            <div style={{ fontSize: 11, color: "rgba(241,245,249,0.7)", marginTop: 1 }}>
              {unread} unread
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={onRefresh} title="Refresh" style={_headerBtn}>{"↻"}</button>
          {unread > 0 && (
            <button onClick={onReadAll} title="Mark all read" style={_headerBtn}>{"✓"}</button>
          )}
          <button onClick={onClose} title="Close" style={_headerBtn}>{"✕"}</button>
        </div>
      </div>

      {/* Items */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: "center", color: "#64748b" }}>Loading...</div>
        ) : items.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>{"\u{1F4EC}"}</div>
            <div style={{ fontSize: 13, color: "#64748b" }}>No messages yet</div>
          </div>
        ) : (
          items.map(item => (
            <InboxItem key={item.inbox_id} item={item} onRead={onRead} />
          ))
        )}
      </div>
    </div>
  );
}

const _headerBtn = {
  background: "rgba(255,255,255,0.1)", border: "none", color: "#f1f5f9",
  width: 30, height: 30, borderRadius: "50%", cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
  fontSize: 14,
};


// ── Main bell + hook ────────────────────────────────────────────────

function RoleInboxBellComponent() {
  const [role, setRole]     = useState(_readRole());
  const [open, setOpen]     = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems]   = useState([]);
  const [loading, setLoad]  = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    const check = () => setRole(_readRole());
    const iv = setInterval(check, 2000);
    window.addEventListener("amina:role-changed", check);
    return () => { clearInterval(iv); window.removeEventListener("amina:role-changed", check); };
  }, []);

  const pollUnread = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/v1/inbox/unread-count`, { headers: _auth() });
      if (r.ok) { const d = await r.json(); setUnread(Number(d.unread || 0)); }
    } catch { /* noop */ }
  }, []);

  useEffect(() => {
    if (role === "patient") return;
    pollUnread();
    timerRef.current = setInterval(pollUnread, 20_000);
    return () => clearInterval(timerRef.current);
  }, [role, pollUnread]);

  const refresh = useCallback(async () => {
    setLoad(true);
    try {
      const r = await fetch(`${API_BASE}/api/v1/inbox/list?limit=50`, { headers: _auth() });
      if (r.ok) { const d = await r.json(); setItems(d.items || []); setUnread(d.unread || 0); }
    } catch { /* noop */ }
    setLoad(false);
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const markRead = useCallback(async (id) => {
    try {
      await fetch(`${API_BASE}/api/v1/inbox/${encodeURIComponent(id)}/read`, {
        method: "POST", headers: _auth(),
      });
      setItems(prev => prev.map(i => i.inbox_id === id ? { ...i, read: true } : i));
      setUnread(prev => Math.max(0, prev - 1));
    } catch { /* noop */ }
  }, []);

  const markAllRead = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/api/v1/inbox/mark-all-read`, {
        method: "POST", headers: _auth(),
      });
      setItems(prev => prev.map(i => ({ ...i, read: true })));
      setUnread(0);
    } catch { /* noop */ }
  }, []);

  if (role === "patient") return null;

  const colors = ROLE_COLORS[role] || ROLE_COLORS.admin;

  return (
    <>
      <button
        type="button"
        aria-label={`Inbox${unread > 0 ? ` (${unread} unread)` : ""}`}
        onClick={() => setOpen(o => !o)}
        style={{
          position: "fixed", top: 20, right: 20,
          width: 44, height: 44, border: "none", cursor: "pointer",
          zIndex: 9250, background: colors.bg, color: "#fff",
          borderRadius: "50%", boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          transition: "transform 140ms ease",
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.08)"; }}
        onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; }}
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>

        {unread > 0 && (
          <span style={{
            position: "absolute", top: -3, right: -3,
            minWidth: 20, height: 20, padding: "0 5px",
            background: colors.badge, color: "#fff",
            fontSize: 11, fontWeight: 700, borderRadius: 10,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 0 0 2px #0f172a",
          }}>
            {unread > 99 ? "99+" : unread}
          </span>
        )}

        {unread > 0 && (
          <span aria-hidden="true" style={{
            position: "absolute", inset: -4, borderRadius: "50%",
            border: `2px solid ${colors.badge}88`,
            animation: "amina-role-inbox-pulse 2.2s ease-out infinite",
            pointerEvents: "none",
          }} />
        )}
      </button>

      <RoleInboxPanel
        open={open}
        onClose={() => setOpen(false)}
        items={items}
        unread={unread}
        loading={loading}
        onRead={markRead}
        onReadAll={markAllRead}
        onRefresh={refresh}
      />

      <style>{`
        @keyframes amina-role-inbox-slide {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        @keyframes amina-role-inbox-pulse {
          0%   { transform: scale(1);   opacity: 0.6; }
          70%  { transform: scale(1.4); opacity: 0;   }
          100% { transform: scale(1.4); opacity: 0;   }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes amina-role-inbox-pulse { from, to { opacity: 0; } }
        }
      `}</style>
    </>
  );
}


function _timeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}


// ── Self-mount ──────────────────────────────────────────────────────

function mount() {
  if (typeof window === "undefined") return;
  if (window.__aminaRoleInboxMounted) return;
  window.__aminaRoleInboxMounted = true;

  const el = document.createElement("div");
  el.id = "amina-role-inbox-root";
  document.body.appendChild(el);
  createRoot(el).render(<RoleInboxBellComponent />);
}

try { mount(); } catch (e) { console.warn("[RoleInboxBell] mount failed:", e); }

export default RoleInboxBellComponent;
