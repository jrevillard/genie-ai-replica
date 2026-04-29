/**
 * AdminNotificationBell — top-right alert for admins.
 *
 * Polls the three pending-action queues every 30s:
 *   - Caregiver approvals    (People > "CG approvals" tab)
 *   - Literacy verifications (People > "Literacy verify" tab)
 *   - Care transfers         (People > "Care transfers" tab)
 *
 * Each notification group is clickable. On click we:
 *   1. Dispatch a window event `amina:admin-nav` so any future
 *      first-class hook can pick it up cleanly.
 *   2. Fall back to DOM click-synthesis on the existing sidebar
 *      button (`.a-nav-item` whose label matches "People") and
 *      then the People-section tab (`.cr-tab` whose label matches
 *      the requested tab title). This keeps the bell additive —
 *      no edits to AdminShell or People.
 *
 * Styling matches the dark caregiver-portal palette so it sits
 * naturally above the People page's dark theme.
 */

import { useCallback, useEffect, useState } from "react";
import {
  adminToken,
  fetchPendingApprovals,
  fetchPendingLiteracy,
  fetchPendingTransfers,
} from "./adminNotificationsApi.js";

const POLL_MS = 30_000;
const Z_INDEX = 9270;

const GROUPS = [
  {
    key:      "approvals",
    title:    "Caregiver approvals",
    tabLabel: "CG approvals",
    fetcher:  fetchPendingApprovals,
    accent:   "#a78bfa",
  },
  {
    key:      "literacy",
    title:    "Literacy verifications",
    tabLabel: "Literacy verify",
    fetcher:  fetchPendingLiteracy,
    accent:   "#7dd3fc",
  },
  {
    key:      "transfers",
    title:    "Care transfers",
    tabLabel: "Care transfers",
    fetcher:  fetchPendingTransfers,
    accent:   "#fcd34d",
  },
];

// ── Navigation: dispatch event + DOM-synthesize as fallback ─────────
function navigateToPeopleTab(tabLabel) {
  try {
    window.dispatchEvent(new CustomEvent("amina:admin-nav",
      { detail: { section: "people", tabLabel } }));
  } catch { /* noop */ }

  // 1. Click the People sidebar button if we're not already there.
  const peopleNav = Array.from(document.querySelectorAll(".a-nav-item"))
    .find((b) => /people/i.test(b.textContent || ""));
  if (peopleNav && peopleNav.getAttribute("aria-current") !== "true") {
    peopleNav.click();
  }

  // 2. After the section mounts, click the requested tab.
  const tryTabClick = (attempt = 0) => {
    const btn = Array.from(document.querySelectorAll(".cr-tab"))
      .find((b) => (b.textContent || "").toLowerCase()
                     .includes(tabLabel.toLowerCase()));
    if (btn) { btn.click(); return; }
    if (attempt < 10) setTimeout(() => tryTabClick(attempt + 1), 80);
  };
  tryTabClick();
}

export default function AdminNotificationBell() {
  const [visible, setVisible] = useState(() => Boolean(adminToken()));
  const [open,    setOpen]    = useState(false);
  const [counts,  setCounts]  = useState({});  // key -> {count, sample}
  const [loading, setLoading] = useState(false);

  const total = Object.values(counts).reduce((n, g) => n + (g?.count || 0), 0);

  const refresh = useCallback(async () => {
    if (!adminToken()) return;
    setLoading(true);
    const next = {};
    for (const g of GROUPS) {
      next[g.key] = await g.fetcher();
    }
    setCounts(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      const ok = Boolean(adminToken());
      if (cancelled) return;
      setVisible(ok);
      if (ok) refresh();
    };
    tick();
    const t = setInterval(tick, POLL_MS);
    const onStorage = () => tick();
    const onReview  = () => { if (!cancelled) refresh(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("amina:admin-data:refresh", onReview);
    return () => {
      cancelled = true;
      clearInterval(t);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("amina:admin-data:refresh", onReview);
    };
  }, [refresh]);

  if (!visible) return null;

  const pulse = total > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen((o) => { if (!o) refresh(); return !o; }); }}
        aria-label={`Admin notifications — ${total} pending`}
        title={total > 0
          ? `${total} pending action${total === 1 ? "" : "s"}`
          : "No pending actions"}
        style={{
          position: "fixed", top: 20, right: 80, zIndex: Z_INDEX,
          width: 46, height: 46, borderRadius: "50%", border: "none",
          cursor: "pointer",
          background: pulse
            ? "linear-gradient(135deg, #6366f1 0%, #4338ca 100%)"
            : "linear-gradient(135deg, #1f2937 0%, #0f172a 100%)",
          color: "#fff",
          boxShadow: pulse
            ? "0 0 0 4px rgba(99, 102, 241, 0.22), 0 8px 22px rgba(67, 56, 202, 0.55)"
            : "0 4px 14px rgba(15, 23, 42, 0.35)",
          animation: pulse ? "amina-admin-bell-pulse 1.6s ease-in-out infinite" : "none",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="2.2"
             strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        {total > 0 && (
          <span style={{
            position: "absolute", top: -4, right: -4,
            background: "#ef4444", color: "#fff",
            border: "2px solid #0b1220",
            borderRadius: 999, padding: "2px 6px",
            fontSize: 10, fontWeight: 800, minWidth: 18, textAlign: "center",
          }}>{total > 99 ? "99+" : total}</span>
        )}
      </button>

      {open && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
          style={{
            position: "fixed", inset: 0, zIndex: Z_INDEX - 1,
            background: "rgba(15, 23, 42, 0.32)",
            display: "flex", justifyContent: "flex-end",
            fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          }}
        >
          <aside style={{
            width: "min(420px, 100%)", height: "100vh",
            background: "#0b1220",
            borderLeft: "1px solid rgba(148, 163, 184, 0.18)",
            display: "flex", flexDirection: "column",
            boxShadow: "-12px 0 40px rgba(0,0,0,0.45)",
          }}>
            <header style={{
              padding: "14px 18px",
              borderBottom: "1px solid rgba(148, 163, 184, 0.15)",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <div>
                <div style={{ color: "#f1f5f9", fontSize: 14, fontWeight: 700 }}>
                  Admin notifications
                </div>
                <div style={{ color: "#94a3b8", fontSize: 11, marginTop: 2 }}>
                  {total === 0 ? "Nothing pending" : `${total} pending action${total === 1 ? "" : "s"}`}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" onClick={refresh} disabled={loading}
                        style={btnIcon} title="Refresh">
                  {loading ? "⋯" : "↻"}
                </button>
                <button type="button" onClick={() => setOpen(false)}
                        style={btnIcon} title="Close">✕</button>
              </div>
            </header>

            <div style={{ flex: 1, overflowY: "auto" }}>
              {GROUPS.map((g) => {
                const data = counts[g.key] || { count: 0, sample: [] };
                return (
                  <div key={g.key} style={{
                    padding: "14px 18px",
                    borderBottom: "1px solid rgba(148, 163, 184, 0.12)",
                  }}>
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      marginBottom: 6,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{
                          width: 8, height: 8, borderRadius: "50%",
                          background: g.accent, display: "inline-block",
                        }} />
                        <span style={{ color: "#f1f5f9", fontSize: 13, fontWeight: 700 }}>
                          {g.title}
                        </span>
                      </div>
                      <span style={{
                        background: data.count > 0 ? "rgba(239,68,68,0.18)" : "rgba(71, 85, 105, 0.30)",
                        color:      data.count > 0 ? "#fca5a5" : "#94a3b8",
                        border:     "1px solid rgba(148, 163, 184, 0.20)",
                        borderRadius: 999, padding: "2px 9px",
                        fontSize: 11, fontWeight: 700,
                      }}>{data.count}</span>
                    </div>

                    {data.sample.length > 0 && (
                      <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 8px" }}>
                        {data.sample.map((s) => (
                          <li key={s.id} style={{
                            padding: "5px 0", color: "#cbd5e1", fontSize: 12,
                            lineHeight: 1.4,
                          }}>
                            <div style={{ fontWeight: 600 }}>{s.label}</div>
                            <div style={{ color: "#94a3b8", fontSize: 11 }}>
                              {s.subtext}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        navigateToPeopleTab(g.tabLabel);
                        setOpen(false);
                      }}
                      disabled={data.count === 0}
                      style={{
                        marginTop: 6,
                        padding: "7px 12px", borderRadius: 8,
                        background: data.count > 0
                          ? "linear-gradient(135deg, #4f46e5, #6366f1)"
                          : "rgba(71, 85, 105, 0.35)",
                        color: data.count > 0 ? "#fff" : "#94a3b8",
                        border: "none",
                        fontSize: 12, fontWeight: 700,
                        cursor: data.count > 0 ? "pointer" : "not-allowed",
                        boxShadow: data.count > 0
                          ? "0 4px 12px rgba(79, 70, 229, 0.32)"
                          : "none",
                      }}
                    >
                      Review →
                    </button>
                  </div>
                );
              })}

              {!loading && total === 0 && (
                <div style={{ padding: 36, textAlign: "center",
                              color: "#94a3b8", fontSize: 12, lineHeight: 1.6 }}>
                  <div style={{ fontSize: 32, marginBottom: 6 }}>✓</div>
                  All caught up — no pending approvals or reviews.
                </div>
              )}
            </div>
          </aside>
        </div>
      )}

      <style>{`
        @keyframes amina-admin-bell-pulse {
          0%,100% { transform: scale(1); }
          50%     { transform: scale(1.06); }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes amina-admin-bell-pulse { 0%,100% { transform: none; } }
        }
      `}</style>
    </>
  );
}

const btnIcon = {
  width: 30, height: 30,
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  border: "none",
  background: "rgba(255,255,255,0.10)",
  color: "#e2e8f0",
  borderRadius: 8, fontSize: 14, cursor: "pointer",
  transition: "background 120ms ease",
};
