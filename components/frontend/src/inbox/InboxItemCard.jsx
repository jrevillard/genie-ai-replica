/**
 * InboxItemCard — single inbox row.
 * Clinical-professional card with severity-coloured left stripe, kind icon,
 * unread dot, timestamp, body (2 lines clamped), and optional download button.
 */

import { useMemo } from "react";
import { downloadUrl } from "./inboxApi";

const KIND_ICONS = {
  pdf:            "📄",
  alert:          "⚠️",
  report:         "📊",
  notification:   "🔔",
  reminder:       "⏰",
  caregiver_ping: "🧑‍⚕️",
  email:          "📧",
};

const SEVERITY_STRIPES = {
  info:      "#14b8a6",  // teal
  warning:   "#f59e0b",  // amber
  emergency: "#ef4444",  // red
};

function timeAgo(iso) {
  if (!iso) return "";
  try {
    const then = new Date(iso).getTime();
    const sec  = Math.round((Date.now() - then) / 1000);
    if (sec < 60)    return `${sec}s ago`;
    if (sec < 3600)  return `${Math.floor(sec / 60)}m ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return "";
  }
}

function formatSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024)      return `${bytes} B`;
  if (bytes < 1024*1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 104857.6) / 10} MB`;
}

export default function InboxItemCard({ item, onOpen, onMarkRead }) {
  const stripe = SEVERITY_STRIPES[item.severity] || SEVERITY_STRIPES.info;
  const icon   = KIND_ICONS[item.kind] || "📬";
  const ts     = useMemo(() => timeAgo(item.created_at), [item.created_at]);

  const handleClick = () => {
    if (!item.read) onMarkRead?.(item.inbox_id);
    onOpen?.(item);
  };

  return (
    <div
      onClick={handleClick}
      style={{
        display:      "flex",
        gap:          "12px",
        padding:      "12px 14px",
        borderLeft:   `3px solid ${stripe}`,
        background:   item.read ? "#ffffff" : "#f0fdfa",
        borderBottom: "1px solid #e5e7eb",
        cursor:       "pointer",
        transition:   "background 120ms ease",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "#f8fafc"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = item.read ? "#ffffff" : "#f0fdfa"; }}
    >
      <div style={{ fontSize: "18px", lineHeight: 1, marginTop: 2 }}>{icon}</div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8,
        }}>
          <div style={{
            fontWeight:    item.read ? 500 : 700,
            color:         "#0f172a",
            fontSize:      "13.5px",
            overflow:      "hidden",
            textOverflow:  "ellipsis",
            whiteSpace:    "nowrap",
          }}>
            {item.title || "(untitled)"}
          </div>
          <div style={{
            fontSize: "11px", color: "#94a3b8", flexShrink: 0, fontVariantNumeric: "tabular-nums",
          }}>{ts}</div>
        </div>

        {item.body ? (
          <div style={{
            fontSize:    "12.5px",
            color:       "#475569",
            marginTop:   "3px",
            lineHeight:  1.4,
            display:     "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow:    "hidden",
          }}>{item.body}</div>
        ) : null}

        {item.attachment?.token ? (
          <div style={{ marginTop: "8px", display: "flex", gap: 8, alignItems: "center" }}>
            <a
              href={downloadUrl(item.attachment.token)}
              download={item.attachment.name || "attachment"}
              onClick={(e) => e.stopPropagation()}
              style={{
                display:          "inline-flex",
                alignItems:       "center",
                gap:              6,
                padding:          "5px 10px",
                background:       "linear-gradient(135deg, #0f766e, #14b8a6)",
                color:            "#fff",
                fontSize:         "11.5px",
                fontWeight:       600,
                borderRadius:     "6px",
                textDecoration:   "none",
                boxShadow:        "0 1px 3px rgba(20,184,166,0.3)",
              }}
            >
              ⬇  Download
            </a>
            <span style={{ fontSize: "11px", color: "#64748b" }}>
              {item.attachment.name}  ·  {formatSize(item.attachment.size)}
            </span>
          </div>
        ) : null}
      </div>

      {!item.read ? (
        <div style={{
          width:        "8px",
          height:       "8px",
          borderRadius: "50%",
          background:   stripe,
          flexShrink:   0,
          marginTop:    "6px",
        }} />
      ) : null}
    </div>
  );
}
