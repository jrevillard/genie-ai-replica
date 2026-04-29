/**
 * InboxPanel — right-hand drawer listing inbox items.
 *
 * Behaviour
 *   - Fixed position, slides in from the right (380px wide on desktop,
 *     full-width on narrow screens).
 *   - Closes on Escape, outside-click, or X button.
 *   - "Mark all read" button top-right, enabled only when unread > 0.
 *   - Empty state with a gentle explainer so first-time users know what
 *     will appear here.
 *   - Locked to z-index 9260 — sits ABOVE the ChannelLinkFab (9250) but
 *     BELOW ConsentGate (9999) / OnboardingGate (10000).
 */

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import InboxItemCard from "./InboxItemCard.jsx";

export default function InboxPanel({
  open, onClose, items, unread, loading, error,
  onMarkRead, onMarkAllRead, onRefresh,
}) {
  const { t } = useTranslation();
  const panelRef = useRef(null);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* click-outside backdrop */}
      <div
        onClick={onClose}
        style={{
          position:   "fixed",
          inset:      0,
          background: "rgba(15, 23, 42, 0.25)",
          zIndex:     9259,
          animation:  "amina-inbox-fade 180ms ease",
        }}
      />

      <aside
        ref={panelRef}
        role="dialog"
        aria-label="Amina inbox"
        style={{
          position:     "fixed",
          top:          0,
          right:        0,
          bottom:       0,
          width:        "min(380px, 100vw)",
          zIndex:       9260,
          background:   "#ffffff",
          boxShadow:    "-12px 0 32px rgba(15, 23, 42, 0.18)",
          display:      "flex",
          flexDirection:"column",
          animation:    "amina-inbox-slide 240ms cubic-bezier(0.22, 1, 0.36, 1)",
          fontFamily:   "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        {/* Header — teal gradient matching ChannelLinkFab */}
        <header style={{
          padding:    "16px 18px",
          background: "linear-gradient(135deg, #0f766e, #0891b2)",
          color:      "#fff",
          display:    "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: "15px", fontWeight: 700, letterSpacing: "0.2px" }}>
              {t("inbox.title")}
            </div>
            <div style={{ fontSize: "11.5px", opacity: 0.85, marginTop: 2 }}>
              {unread > 0
                ? t("inbox.subtitle.unread", { count: unread })
                : t("inbox.subtitle.empty")}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={onRefresh}
              disabled={loading}
              title={t("inbox.actions.refresh")}
              aria-label={t("inbox.actions.refresh")}
              style={btnIcon}
            >
              {loading ? "⋯" : "↻"}
            </button>
            <button
              onClick={onMarkAllRead}
              disabled={unread === 0}
              title={t("inbox.actions.markAllRead")}
              aria-label={t("inbox.actions.markAllRead")}
              style={{ ...btnIcon, opacity: unread === 0 ? 0.4 : 1 }}
            >
              ✓
            </button>
            <button
              onClick={onClose}
              title={t("common.close")}
              aria-label={t("inbox.actions.close")}
              style={btnIcon}
            >
              ✕
            </button>
          </div>
        </header>

        {/* Error */}
        {error ? (
          <div style={{
            padding: "10px 14px", background: "#fef2f2", color: "#991b1b",
            fontSize: "12px", borderBottom: "1px solid #fecaca",
          }}>
            ⚠ {error}
          </div>
        ) : null}

        {/* List or empty state */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {items.length === 0 && !loading ? (
            <div style={{
              padding:    "40px 24px",
              textAlign:  "center",
              color:      "#64748b",
              fontSize:   "13.5px",
              lineHeight: 1.5,
            }}>
              <div style={{ fontSize: "36px", marginBottom: 8 }}>📬</div>
              <div style={{ fontWeight: 600, color: "#0f172a", marginBottom: 4 }}>
                {t("inbox.empty.heading")}
              </div>
              {t("inbox.empty.body")}
            </div>
          ) : (
            items.map((it) => (
              <InboxItemCard
                key={it.inbox_id}
                item={it}
                onMarkRead={onMarkRead}
              />
            ))
          )}
        </div>

        <style>{`
          @keyframes amina-inbox-slide {
            from { transform: translateX(100%); }
            to   { transform: translateX(0); }
          }
          @keyframes amina-inbox-fade {
            from { opacity: 0; }
            to   { opacity: 1; }
          }
          aside[aria-label="Amina inbox"] button:hover:not(:disabled) {
            background: rgba(255,255,255,0.22) !important;
          }
        `}</style>
      </aside>
    </>
  );
}

const btnIcon = {
  width:        30,
  height:       30,
  display:      "inline-flex",
  alignItems:   "center",
  justifyContent: "center",
  border:       "none",
  background:   "rgba(255,255,255,0.14)",
  color:        "#fff",
  borderRadius: "6px",
  fontSize:     "14px",
  cursor:       "pointer",
  transition:   "background 120ms ease",
};
