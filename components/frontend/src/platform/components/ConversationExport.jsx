import { useState } from "react";
import { conversationsApi } from "../api/platformApi";

const S = {
  overlay: {
    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
    background: "rgba(0,0,0,0.35)", display: "flex",
    alignItems: "center", justifyContent: "center", zIndex: 10000,
  },
  dialog: {
    background: "#fff", borderRadius: 16, padding: 28, width: 380,
    boxShadow: "0 20px 60px rgba(0,0,0,0.2)", fontFamily: "inherit",
  },
  title: { fontSize: 17, fontWeight: 600, color: "#1e293b", marginBottom: 20 },
  option: {
    padding: "14px 16px", border: "1px solid #e2e8f0", borderRadius: 10,
    marginBottom: 10, cursor: "pointer", display: "flex",
    alignItems: "center", gap: 12, transition: "all 0.15s",
  },
  optionActive: { borderColor: "#3b82f6", background: "#eff6ff" },
  optIcon: { fontSize: 24 },
  optLabel: { fontWeight: 500, fontSize: 14, color: "#1e293b" },
  optDesc: { fontSize: 12, color: "#64748b" },
  btns: { display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 },
  btn: {
    padding: "8px 18px", borderRadius: 8, border: "none", fontSize: 13,
    fontWeight: 600, cursor: "pointer",
  },
  btnPrimary: { background: "#3b82f6", color: "#fff" },
  btnGhost: { background: "#f1f5f9", color: "#334155" },
  status: { fontSize: 13, color: "#16a34a", marginTop: 12, textAlign: "center" },
};

export default function ConversationExport({ conversationId, conversationTitle, onClose }) {
  const [format, setFormat] = useState("json");
  const [exporting, setExporting] = useState(false);
  const [done, setDone] = useState(false);

  const doExport = async () => {
    setExporting(true);
    try {
      if (format === "json") {
        const data = await conversationsApi.exportConversation(conversationId, "json");
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${conversationTitle || "conversation"}_${conversationId}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const blob = await conversationsApi.exportConversation(conversationId, "pdf");
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${conversationTitle || "conversation"}_${conversationId}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      }
      setDone(true);
      setTimeout(() => onClose?.(), 1500);
    } catch (e) {
      console.warn("[Export] failed:", e);
      alert("Export failed. Please try again.");
    }
    setExporting(false);
  };

  const formats = [
    { key: "json", icon: "{ }", label: "JSON", desc: "Structured data, machine-readable" },
    { key: "pdf", icon: "📄", label: "PDF", desc: "Formatted document for printing/sharing" },
  ];

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.dialog} onClick={(e) => e.stopPropagation()}>
        <div style={S.title}>Export Conversation</div>

        {formats.map((f) => (
          <div
            key={f.key}
            style={{ ...S.option, ...(format === f.key ? S.optionActive : {}) }}
            onClick={() => setFormat(f.key)}
          >
            <span style={S.optIcon}>{f.icon}</span>
            <div>
              <div style={S.optLabel}>{f.label}</div>
              <div style={S.optDesc}>{f.desc}</div>
            </div>
          </div>
        ))}

        {done && <div style={S.status}>Download started!</div>}

        <div style={S.btns}>
          <button style={{ ...S.btn, ...S.btnGhost }} onClick={onClose}>
            Cancel
          </button>
          <button
            style={{ ...S.btn, ...S.btnPrimary }}
            onClick={doExport}
            disabled={exporting}
          >
            {exporting ? "Exporting..." : `Export as ${format.toUpperCase()}`}
          </button>
        </div>
      </div>
    </div>
  );
}
