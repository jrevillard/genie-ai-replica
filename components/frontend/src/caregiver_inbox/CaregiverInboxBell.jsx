/**
 * CaregiverInboxBell — floating bell for the caregiver portal.
 *
 * Appearance mirrors the patient InboxBell, but:
 *   - Auth: reads `AMINA_CG_TOKEN` (or any AMINA_TOKEN that decodes to
 *     role=caregiver), not the patient token.
 *   - Severity palette: items with severity='emergency' pulse red, not
 *     the amber warning variant.
 *   - Position: top-right in the caregiver portal (top:20 right:20) so
 *     it sits above the patient sidebar clock.
 *
 * Self-mounts only when a caregiver JWT is present. Invisible for pure
 * patient sessions.
 */

import { useCallback, useEffect, useState } from "react";
import {
  listCaregiverInbox,
  unreadCaregiverInbox,
  markCaregiverRead,
  markCaregiverAllRead,
  hasCaregiverToken,
} from "./caregiverInboxApi.js";


const POLL_MS = 15000;  // 15s — chat is polled every 3s by CaregiverChat;
                        // the bell is a slower background refresh.


function _fmtAge(iso) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!t) return "";
  const s = (Date.now() - t) / 1000;
  if (s < 60)       return `${Math.floor(s)}s ago`;
  if (s < 3600)     return `${Math.floor(s / 60)}m ago`;
  if (s < 86400)    return `${Math.floor(s / 3600)}h ago`;
  return            `${Math.floor(s / 86400)}d ago`;
}


function SeverityDot({ severity }) {
  const color = severity === "emergency" ? "#f87171"
              : severity === "warning"   ? "#fbbf24"
              : "#60a5fa";
  return (
    <span style={{
      display: "inline-block", width: 8, height: 8, borderRadius: "50%",
      background: color, marginRight: 8, flexShrink: 0,
    }} />
  );
}


function InboxRow({ item, onRead }) {
  const emergency = item.severity === "emergency";
  return (
    <button
      type="button"
      onClick={() => !item.read && onRead(item.inbox_id)}
      style={{
        all: "unset", cursor: item.read ? "default" : "pointer",
        display: "block", width: "100%",
        padding: "10px 14px",
        background: item.read
          ? "rgba(30, 41, 59, 0.30)"
          : (emergency
              ? "rgba(248, 113, 113, 0.12)"
              : "rgba(99, 102, 241, 0.10)"),
        borderBottom: "1px solid rgba(148, 163, 184, 0.15)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 4 }}>
        <SeverityDot severity={item.severity} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12, fontWeight: item.read ? 500 : 700,
            color: emergency ? "#fecaca" : "#f1f5f9",
            lineHeight: 1.3,
          }}>
            {item.title || "(no title)"}
          </div>
          {item.body ? (
            <div style={{
              fontSize: 11, color: item.read ? "#64748b" : "#cbd5e1",
              marginTop: 3, lineHeight: 1.4,
              overflow: "hidden", textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
            }}>
              {item.body}
            </div>
          ) : null}
          <div style={{ display: "flex", justifyContent: "space-between",
                        color: "#64748b", fontSize: 10, marginTop: 4 }}>
            <span>{_fmtAge(item.created_at)}</span>
            {!item.read ? (
              <span style={{ color: emergency ? "#f87171" : "#c7d2fe",
                             fontWeight: 700, letterSpacing: 0.3,
                             textTransform: "uppercase" }}>
                new
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </button>
  );
}


export default function CaregiverInboxBell() {
  const [visible, setVisible] = useState(hasCaregiverToken);
  const [unread,  setUnread]  = useState(0);
  const [hasEmergency, setHasEmergency] = useState(false);
  const [open,    setOpen]    = useState(false);
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(false);

  // Poll token presence + unread count.
  useEffect(() => {
    let cancelled = false;

    const pollToken = () => {
      const ok = hasCaregiverToken();
      if (!cancelled) setVisible(ok);
    };

    const pollUnread = async () => {
      if (!hasCaregiverToken()) return;
      const r = await unreadCaregiverInbox();
      if (cancelled) return;
      if (r.data) setUnread(Number(r.data.unread || 0));
    };

    pollToken();
    pollUnread();
    const t = setInterval(() => {
      pollToken();
      pollUnread();
    }, POLL_MS);

    window.addEventListener("amina:caregiver-inbox:refresh", pollUnread);
    window.addEventListener("storage", pollToken);

    return () => {
      cancelled = true;
      clearInterval(t);
      window.removeEventListener("amina:caregiver-inbox:refresh", pollUnread);
      window.removeEventListener("storage", pollToken);
    };
  }, []);

  // Load items the first time the panel opens (and on refresh events).
  const loadItems = useCallback(async () => {
    if (!hasCaregiverToken()) return;
    setLoading(true);
    const r = await listCaregiverInbox({ limit: 40 });
    setLoading(false);
    if (r.data) {
      const list = r.data.items || [];
      setItems(list);
      setHasEmergency(list.some((i) => !i.read && i.severity === "emergency"));
    }
  }, []);

  useEffect(() => {
    if (open) loadItems();
  }, [open, loadItems]);

  // Update emergency flag from unread items.
  useEffect(() => {
    setHasEmergency(items.some((i) => !i.read && i.severity === "emergency"));
  }, [items]);

  const onRead = async (id) => {
    await markCaregiverRead(id);
    setItems((xs) => xs.map((x) => x.inbox_id === id ? { ...x, read: true } : x));
    setUnread((n) => Math.max(0, n - 1));
  };

  const onMarkAll = async () => {
    await markCaregiverAllRead();
    setItems((xs) => xs.map((x) => ({ ...x, read: true })));
    setUnread(0);
    setHasEmergency(false);
  };

  if (!visible) return null;

  const pulse = hasEmergency || unread > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Caregiver inbox — ${unread} unread`}
        title={hasEmergency ? "Emergency alert pending" : "Inbox"}
        style={{
          position: "fixed", top: 20, right: 20, zIndex: 9260,
          width: 46, height: 46, borderRadius: "50%", border: "none",
          cursor: "pointer",
          background: hasEmergency
            ? "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)"
            : "linear-gradient(135deg, #1f2937 0%, #0f172a 100%)",
          color: "#fff",
          boxShadow: hasEmergency
            ? "0 0 0 4px rgba(220, 38, 38, 0.25), 0 8px 22px rgba(220, 38, 38, 0.55)"
            : "0 4px 14px rgba(15, 23, 42, 0.35)",
          animation: pulse ? "amina-cg-bell-pulse 1.6s ease-in-out infinite" : "none",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="2.2"
             strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        {unread > 0 && (
          <span style={{
            position: "absolute", top: -4, right: -4,
            background: hasEmergency ? "#fee2e2" : "#ef4444",
            color: hasEmergency ? "#7f1d1d" : "#fff",
            border: hasEmergency ? "2px solid #dc2626" : "2px solid #0b1220",
            borderRadius: 999, padding: "2px 6px",
            fontSize: 10, fontWeight: 800, minWidth: 18, textAlign: "center",
          }}>{unread > 99 ? "99+" : unread}</span>
        )}
      </button>

      {open && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
          style={{
            position: "fixed", inset: 0, zIndex: 9255,
            background: "rgba(15, 23, 42, 0.25)",
            display: "flex", justifyContent: "flex-end",
            fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          }}
        >
          <div style={{
            width: "min(380px, 100%)", height: "100vh",
            background: "#0b1220",
            borderLeft: "1px solid rgba(148, 163, 184, 0.18)",
            display: "flex", flexDirection: "column",
            boxShadow: "-12px 0 40px rgba(0,0,0,0.45)",
          }}>
            <div style={{
              padding: "14px 16px",
              borderBottom: "1px solid rgba(148, 163, 184, 0.15)",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <div>
                <div style={{ color: "#f1f5f9", fontSize: 14, fontWeight: 700 }}>
                  Caregiver inbox
                </div>
                <div style={{ color: "#94a3b8", fontSize: 11, marginTop: 2 }}>
                  {unread} unread{hasEmergency ? " · ⚠ emergency pending" : ""}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" onClick={onMarkAll}
                        disabled={!unread}
                        style={{
                          padding: "6px 10px",
                          background: unread ? "rgba(99, 102, 241, 0.16)"
                                             : "rgba(71, 85, 105, 0.30)",
                          color: unread ? "#c7d2fe" : "#64748b",
                          border: "1px solid rgba(129, 140, 248, 0.35)",
                          borderRadius: 8,
                          fontSize: 11, fontWeight: 700,
                          cursor: unread ? "pointer" : "not-allowed",
                        }}>Mark all read</button>
                <button type="button" onClick={() => setOpen(false)}
                        style={{
                          width: 28, height: 28, borderRadius: 8, border: "none",
                          background: "rgba(255,255,255,0.06)", color: "#e2e8f0",
                          cursor: "pointer", fontSize: 16, fontWeight: 700, lineHeight: 1,
                        }}>×</button>
              </div>
            </div>

            <div style={{ flex: 1, overflow: "auto" }}>
              {loading && (
                <div style={{ padding: 24, textAlign: "center",
                              color: "#94a3b8", fontSize: 12 }}>
                  Loading…
                </div>
              )}
              {!loading && items.length === 0 && (
                <div style={{ padding: 36, textAlign: "center", color: "#94a3b8",
                              fontSize: 12, lineHeight: 1.6 }}>
                  <div style={{ fontSize: 32, marginBottom: 6 }}>🔕</div>
                  Nothing here yet. Chat messages + emergency alerts from
                  your patient will appear in this inbox.
                </div>
              )}
              {items.map((x) => (
                <InboxRow key={x.inbox_id} item={x} onRead={onRead} />
              ))}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes amina-cg-bell-pulse {
          0%,100% { transform: scale(1); }
          50%     { transform: scale(1.06); }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes amina-cg-bell-pulse { 0%,100% { transform: none; } }
        }
      `}</style>
    </>
  );
}
