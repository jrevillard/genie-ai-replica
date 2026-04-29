import { useState, useEffect, useCallback } from "react";
import { foldersApi, conversationsApi } from "../api/platformApi";

const S = {
  panel: {
    background: "#f8fafc", borderRight: "1px solid #e2e8f0",
    width: 260, display: "flex", flexDirection: "column", height: "100%",
    fontFamily: "inherit", fontSize: 14,
  },
  header: {
    padding: "12px 16px", borderBottom: "1px solid #e2e8f0",
    display: "flex", justifyContent: "space-between", alignItems: "center",
    fontWeight: 600, fontSize: 15, color: "#1e293b",
  },
  addBtn: {
    background: "#3b82f6", color: "#fff", border: "none", borderRadius: 6,
    padding: "4px 10px", cursor: "pointer", fontSize: 13,
  },
  list: { flex: 1, overflowY: "auto", padding: "8px 0" },
  folder: {
    padding: "8px 16px", cursor: "pointer", display: "flex",
    alignItems: "center", gap: 8, borderLeft: "3px solid transparent",
    transition: "all 0.15s",
  },
  folderActive: {
    background: "#eff6ff", borderLeftColor: "#3b82f6", color: "#1d4ed8",
  },
  folderIcon: { fontSize: 16, opacity: 0.7 },
  folderName: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  count: {
    fontSize: 11, background: "#e2e8f0", borderRadius: 10, padding: "1px 7px",
    color: "#64748b",
  },
  actions: { display: "flex", gap: 4, opacity: 0 },
  actionBtn: {
    background: "none", border: "none", cursor: "pointer",
    fontSize: 12, padding: 2, color: "#94a3b8",
  },
  convItem: {
    padding: "6px 16px 6px 32px", cursor: "pointer", fontSize: 13,
    color: "#475569", overflow: "hidden", textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  shareModal: {
    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
    background: "rgba(0,0,0,0.4)", display: "flex",
    alignItems: "center", justifyContent: "center", zIndex: 9999,
  },
  shareBox: {
    background: "#fff", borderRadius: 12, padding: 24, width: 380,
    boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
  },
  input: {
    width: "100%", padding: "8px 12px", border: "1px solid #d1d5db",
    borderRadius: 6, fontSize: 14, marginBottom: 8, boxSizing: "border-box",
  },
  select: {
    width: "100%", padding: "8px 12px", border: "1px solid #d1d5db",
    borderRadius: 6, fontSize: 14, marginBottom: 12,
  },
  exportRow: {
    display: "flex", gap: 8, padding: "4px 16px 4px 32px",
  },
  exportBtn: {
    background: "none", border: "1px solid #d1d5db", borderRadius: 4,
    padding: "2px 8px", cursor: "pointer", fontSize: 11, color: "#64748b",
  },
};

export default function ChatFolders({ userId, onSelectConversation }) {
  const [folders, setFolders] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [activeFolder, setActiveFolder] = useState(null);
  const [conversations, setConversations] = useState({});
  const [newName, setNewName] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [shareTarget, setShareTarget] = useState(null);
  const [shareEmail, setShareEmail] = useState("");
  const [shareRole, setShareRole] = useState("viewer");

  const uid = userId || localStorage.getItem("AMINA_PATIENT") || "anonymous";

  const loadFolders = useCallback(async () => {
    try {
      const data = await foldersApi.list(uid);
      setFolders(Array.isArray(data) ? data : data?.folders || []);
    } catch (e) {
      console.warn("[ChatFolders] load failed:", e);
    }
  }, [uid]);

  useEffect(() => { loadFolders(); }, [loadFolders]);

  const toggleExpand = async (folderId) => {
    const isOpen = expanded[folderId];
    setExpanded((p) => ({ ...p, [folderId]: !isOpen }));
    setActiveFolder(folderId);
    if (!isOpen && !conversations[folderId]) {
      try {
        const data = await conversationsApi.list(uid, { folderId });
        setConversations((p) => ({
          ...p,
          [folderId]: Array.isArray(data) ? data : data?.conversations || [],
        }));
      } catch (e) {
        console.warn("[ChatFolders] conv load:", e);
      }
    }
  };

  const createFolder = async () => {
    if (!newName.trim()) return;
    try {
      await foldersApi.create({ name: newName.trim(), userId: uid });
      setNewName("");
      setShowCreate(false);
      loadFolders();
    } catch (e) {
      console.warn("[ChatFolders] create failed:", e);
    }
  };

  const deleteFolder = async (id) => {
    if (!confirm("Delete this folder?")) return;
    try {
      await foldersApi.remove(id, uid);
      loadFolders();
    } catch (e) {
      console.warn("[ChatFolders] delete failed:", e);
    }
  };

  const doShare = async () => {
    if (!shareEmail.trim() || !shareTarget) return;
    try {
      await foldersApi.share(shareTarget, uid, shareEmail.trim(), shareRole);
      setShareTarget(null);
      setShareEmail("");
    } catch (e) {
      console.warn("[ChatFolders] share failed:", e);
    }
  };

  const exportConv = async (convId, format) => {
    try {
      const data = await conversationsApi.exportConversation(convId, format);
      if (format === "json") {
        const blob = new Blob([JSON.stringify(data, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `conversation_${convId}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const url = URL.createObjectURL(data);
        const a = document.createElement("a");
        a.href = url;
        a.download = `conversation_${convId}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      console.warn("[ChatFolders] export failed:", e);
    }
  };

  return (
    <div style={S.panel}>
      <div style={S.header}>
        <span>Folders</span>
        <button style={S.addBtn} onClick={() => setShowCreate((p) => !p)}>
          + New
        </button>
      </div>

      {showCreate && (
        <div style={{ padding: "8px 16px", display: "flex", gap: 4 }}>
          <input
            style={{ ...S.input, marginBottom: 0, flex: 1 }}
            placeholder="Folder name..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createFolder()}
            autoFocus
          />
          <button style={S.addBtn} onClick={createFolder}>
            Add
          </button>
        </div>
      )}

      <div style={S.list}>
        {folders.map((f) => (
          <div key={f._id || f.id}>
            <div
              style={{
                ...S.folder,
                ...(activeFolder === (f._id || f.id) ? S.folderActive : {}),
              }}
              onClick={() => toggleExpand(f._id || f.id)}
              onMouseEnter={(e) => {
                const acts = e.currentTarget.querySelector("[data-acts]");
                if (acts) acts.style.opacity = 1;
              }}
              onMouseLeave={(e) => {
                const acts = e.currentTarget.querySelector("[data-acts]");
                if (acts) acts.style.opacity = 0;
              }}
            >
              <span style={S.folderIcon}>
                {expanded[f._id || f.id] ? "📂" : "📁"}
              </span>
              <span style={S.folderName}>{f.name}</span>
              {f.conversationCount > 0 && (
                <span style={S.count}>{f.conversationCount}</span>
              )}
              <span data-acts style={S.actions}>
                <button
                  style={S.actionBtn}
                  title="Share"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShareTarget(f._id || f.id);
                  }}
                >
                  🔗
                </button>
                <button
                  style={S.actionBtn}
                  title="Delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteFolder(f._id || f.id);
                  }}
                >
                  🗑
                </button>
              </span>
            </div>

            {expanded[f._id || f.id] &&
              (conversations[f._id || f.id] || []).map((c) => (
                <div key={c._id || c.id}>
                  <div
                    style={S.convItem}
                    onClick={() =>
                      onSelectConversation?.(c._id || c.id, c)
                    }
                  >
                    {c.title || c.name || "Untitled"}
                  </div>
                  <div style={S.exportRow}>
                    <button
                      style={S.exportBtn}
                      onClick={() => exportConv(c._id || c.id, "json")}
                    >
                      Export JSON
                    </button>
                    <button
                      style={S.exportBtn}
                      onClick={() => exportConv(c._id || c.id, "pdf")}
                    >
                      Export PDF
                    </button>
                  </div>
                </div>
              ))}
          </div>
        ))}
        {folders.length === 0 && (
          <div style={{ padding: "16px", color: "#94a3b8", textAlign: "center" }}>
            No folders yet
          </div>
        )}
      </div>

      {shareTarget && (
        <div style={S.shareModal} onClick={() => setShareTarget(null)}>
          <div style={S.shareBox} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>Share Folder</h3>
            <input
              style={S.input}
              placeholder="User email or ID..."
              value={shareEmail}
              onChange={(e) => setShareEmail(e.target.value)}
            />
            <select
              style={S.select}
              value={shareRole}
              onChange={(e) => setShareRole(e.target.value)}
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
              <option value="contributor">Contributor</option>
            </select>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                style={{ ...S.addBtn, background: "#94a3b8" }}
                onClick={() => setShareTarget(null)}
              >
                Cancel
              </button>
              <button style={S.addBtn} onClick={doShare}>
                Share
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
