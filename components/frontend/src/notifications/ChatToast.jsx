/**
 * ChatToast — single toast card pinned to the top-right of the
 * viewport. Stackable; each card auto-dismisses after `ttlMs`.
 *
 * Works for both patient and caregiver flows — the `variant`
 * prop controls palette (info, emergency, caregiver_ping, patient_ping)
 * so one component covers every notification surface.
 */

import { useEffect, useState } from "react";


const VARIANTS = {
  patient_ping:   { accent: "#60a5fa", label: "Message",    icon: "💬" },
  caregiver_ping: { accent: "#a78bfa", label: "Message",    icon: "💬" },
  emergency:      { accent: "#f87171", label: "EMERGENCY",  icon: "⚠"  },
  info:           { accent: "#6ee7b7", label: "Notification", icon: "🔔" },
};


export default function ChatToast({
  id, title, body, sender, variant = "info",
  ttlMs = 8000, onDismiss, onClick,
}) {
  const [dying, setDying] = useState(false);

  useEffect(() => {
    if (!ttlMs) return;
    const t = setTimeout(() => {
      setDying(true);
      setTimeout(() => onDismiss?.(id), 250);
    }, ttlMs);
    return () => clearTimeout(t);
  }, [ttlMs, id, onDismiss]);

  const meta = VARIANTS[variant] || VARIANTS.info;
  const emergency = variant === "emergency";

  return (
    <div
      role="status"
      aria-live={emergency ? "assertive" : "polite"}
      onClick={() => {
        onClick?.();
        setDying(true);
        setTimeout(() => onDismiss?.(id), 200);
      }}
      style={{
        width: "min(360px, calc(100vw - 40px))",
        padding: "12px 14px",
        background: emergency
          ? "linear-gradient(135deg, #7f1d1d 0%, #450a0a 100%)"
          : "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
        color: "#f1f5f9",
        borderRadius: 12,
        boxShadow: emergency
          ? "0 8px 24px rgba(248, 113, 113, 0.45), 0 0 0 1px rgba(248, 113, 113, 0.35)"
          : "0 12px 32px rgba(0, 0, 0, 0.40), 0 0 0 1px rgba(148, 163, 184, 0.20)",
        cursor: "pointer",
        fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        display: "flex", alignItems: "flex-start", gap: 10,
        pointerEvents: "auto",
        transform: dying ? "translateX(20px)" : "translateX(0)",
        opacity: dying ? 0 : 1,
        transition: "transform 250ms ease, opacity 250ms ease",
        animation: dying ? "none" : "amina-chat-toast-in 260ms cubic-bezier(0.22,1,0.36,1)",
      }}
    >
      <div style={{
        width: 32, height: 32, borderRadius: 8,
        background: `${meta.accent}28`,
        border: `1px solid ${meta.accent}77`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 16, flexShrink: 0,
      }}>{meta.icon}</div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
          textTransform: "uppercase",
          color: emergency ? "#fecaca" : meta.accent,
          marginBottom: 2,
        }}>{meta.label}{sender ? ` · ${sender}` : ""}</div>
        <div style={{
          fontSize: 13, fontWeight: 700,
          color: emergency ? "#fff" : "#f1f5f9",
          lineHeight: 1.3,
        }}>{title}</div>
        {body ? (
          <div style={{
            fontSize: 12, color: emergency ? "#fecaca" : "#cbd5e1",
            marginTop: 3, lineHeight: 1.45,
            display: "-webkit-box", WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical", overflow: "hidden",
          }}>{body}</div>
        ) : null}
      </div>

      <button type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDying(true);
                setTimeout(() => onDismiss?.(id), 200);
              }}
              aria-label="Dismiss notification"
              style={{
                background: "transparent", border: "none",
                color: "#94a3b8", cursor: "pointer",
                fontSize: 16, fontWeight: 700, padding: "0 2px",
                alignSelf: "flex-start", lineHeight: 1,
              }}>×</button>

      <style>{`
        @keyframes amina-chat-toast-in {
          from { opacity: 0; transform: translate3d(24px, -4px, 0); }
          to   { opacity: 1; transform: translate3d(0, 0, 0); }
        }
      `}</style>
    </div>
  );
}
