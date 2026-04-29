/**
 * InboxBell — floating bell icon with unread badge.
 *
 * Position:  top-right of viewport, z-index 9250 (sits alongside the
 *            ChannelLinkFab at 9250 but does NOT overlap visually — the
 *            FAB is bottom-right, this is top-right).
 *
 * Accessibility:
 *   - role=button, aria-label with live unread count.
 *   - Badge has aria-live="polite" so screen readers announce increments.
 *   - Respects `prefers-reduced-motion` (no pulse animation when set).
 *
 * Style language matches BeginnerShell / BasicShell: teal gradient,
 * rounded-pill hover, soft shadow. Clinical, not game-y.
 */

import { useTranslation } from "react-i18next";
import { useInbox } from "./useInbox.js";
import InboxPanel from "./InboxPanel.jsx";

export default function InboxBell({ enabled = true }) {
  const { t } = useTranslation();
  const inbox = useInbox({ enabled });
  if (!enabled) return null;

  return (
    <>
      <button
        type="button"
        aria-label={inbox.unread > 0
          ? t("inbox.ariaLabel.bell", { count: inbox.unread })
          : t("inbox.ariaLabel.bellNone")}
        onClick={() => inbox.setOpen((o) => !o)}
        style={{
          // Vertical stack on the right edge, docked in the empty area
          // below the "Today & Care" / "Dual-Path Care" cards so the top
          // of the viewport isn't cluttered. All 4 floating controls
          // (InboxBell, RoleSwitcher, LanguagePicker, ScribeFab) follow
          // the same pattern: right:20 with ~58px vertical spacing.
          position:      "fixed",
          top:           490,
          right:         20,
          width:         46,
          height:        46,
          border:        "none",
          cursor:        "pointer",
          zIndex:        9250,
          background:    "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
          color:         "#fff",
          borderRadius:  "50%",
          boxShadow:     "0 4px 14px rgba(15, 23, 42, 0.25)",
          display:       "inline-flex",
          alignItems:    "center",
          justifyContent:"center",
          fontSize:      "18px",
          transition:    "transform 140ms ease, box-shadow 140ms ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "scale(1.05)";
          e.currentTarget.style.boxShadow = "0 6px 20px rgba(15, 23, 42, 0.35)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "scale(1)";
          e.currentTarget.style.boxShadow = "0 4px 14px rgba(15, 23, 42, 0.25)";
        }}
      >
        {/* bell glyph */}
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
             aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>

        {inbox.unread > 0 ? (
          <span
            aria-live="polite"
            style={{
              position:      "absolute",
              top:           -3,
              right:         -3,
              minWidth:      20,
              height:        20,
              padding:       "0 5px",
              background:    "#ef4444",
              color:         "#fff",
              fontSize:      "11px",
              fontWeight:    700,
              borderRadius:  10,
              display:       "inline-flex",
              alignItems:    "center",
              justifyContent:"center",
              boxShadow:     "0 0 0 2px #0f172a",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {inbox.unread > 99 ? "99+" : inbox.unread}
          </span>
        ) : null}

        {/* pulse ring — hidden when reduced motion is preferred */}
        {inbox.unread > 0 ? (
          <span
            aria-hidden="true"
            style={{
              position:     "absolute",
              inset:        -4,
              borderRadius: "50%",
              border:       "2px solid rgba(239, 68, 68, 0.55)",
              animation:    "amina-inbox-pulse 2.2s ease-out infinite",
              pointerEvents:"none",
            }}
          />
        ) : null}
      </button>

      <InboxPanel
        open={inbox.open}
        onClose={() => inbox.setOpen(false)}
        items={inbox.items}
        unread={inbox.unread}
        loading={inbox.loading}
        error={inbox.error}
        onMarkRead={inbox.markRead}
        onMarkAllRead={inbox.markAllRead}
        onRefresh={inbox.refresh}
      />

      <style>{`
        @keyframes amina-inbox-pulse {
          0%   { transform: scale(1);   opacity: 0.6; }
          70%  { transform: scale(1.4); opacity: 0;   }
          100% { transform: scale(1.4); opacity: 0;   }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes amina-inbox-pulse { from, to { opacity: 0; } }
        }
      `}</style>
    </>
  );
}
