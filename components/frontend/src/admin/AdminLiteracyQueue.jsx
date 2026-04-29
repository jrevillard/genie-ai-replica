/**
 * AMINA Care — Education Verification Queue (Admin Panel)
 * =========================================================
 * Rendered inside AdminDashboard under the "Verification" tab.
 *
 * Data flow:
 *   GET  /api/v1/literacy/admin/queue                     → list
 *   GET  /api/v1/literacy/admin/certificate/{cert_id}     → blob (preview)
 *   POST /api/v1/literacy/admin/approve/{patient_id}      { verified_level, note }
 *   POST /api/v1/literacy/admin/reject/{patient_id}       { note }
 *
 * Admin actions:
 *   - Approve at declared level (one click)
 *   - Approve at a lower level (custom select)
 *   - Reject with mandatory note
 *
 * Per the no-delete policy, rejected rows remain in the store and are
 * simply filtered out of the pending queue by the backend.
 */

import { useEffect, useState, useCallback } from "react";

const API = (window.AMINA_API || "http://localhost:8000").replace(/\/+$/, "");

const C = {
  card:    "#ffffff",
  border:  "#e2e8f0",
  text:    "#0f172a",
  muted:   "#64748b",
  accent:  "#6366f1",
  green:   "#10b981",
  red:     "#ef4444",
  amber:   "#f59e0b",
  bg:      "#f8fafc",
  blue:    "#0ea5e9",
};

const LEVEL_LABELS = {
  none:        "Never attended",
  lower_basic: "Lower Basic (1–6)",
  upper_basic: "Upper Basic (7–9)",
  senior_sec:  "Senior Secondary (10–12)",
  tertiary:    "Tertiary",
};

const LEVEL_ORDER = ["none", "lower_basic", "upper_basic", "senior_sec", "tertiary"];

const LEVEL_TO_MODE = {
  none:        "beginner",
  lower_basic: "beginner",
  upper_basic: "basic",
  senior_sec:  "advanced",
  tertiary:    "advanced",
};


function Pill({ color, bg, border, children }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        background: bg,
        color,
        border: `1px solid ${border}`,
      }}
    >
      {children}
    </span>
  );
}

function StatusPill({ status }) {
  if (status === "pending")  return <Pill color="#b45309" bg="#fffbeb" border="#fde68a">Pending</Pill>;
  if (status === "approved") return <Pill color="#15803d" bg="#f0fdf4" border="#bbf7d0">Approved</Pill>;
  if (status === "rejected") return <Pill color="#b91c1c" bg="#fef2f2" border="#fecaca">Rejected</Pill>;
  return <Pill color="#475569" bg="#f1f5f9" border="#e2e8f0">{status || "—"}</Pill>;
}


export default function AdminLiteracyQueue({ token }) {
  const [rows, setRows]             = useState([]);
  const [loading, setLoading]       = useState(false);
  const [msg, setMsg]               = useState("");
  const [preview, setPreview]       = useState(null);    // { url, mime, filename }
  const [busyPid, setBusyPid]       = useState(null);
  const [approveLevel, setApproveLevel] = useState({});  // { [pid]: level }
  const [notes, setNotes]           = useState({});      // { [pid]: string }
  const [rejectMode, setRejectMode] = useState({});      // { [pid]: bool }

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const fetchQueue = useCallback(() => {
    setLoading(true);
    fetch(`${API}/api/v1/literacy/admin/queue?limit=200`, { headers })
      .then(r => r.json())
      .then(d => setRows(d.queue || []))
      .catch(() => setMsg("Could not load verification queue."))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  // Revoke preview blob URL on unmount / change
  useEffect(() => {
    return () => {
      if (preview && preview.url) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  const openCertificate = async (certId) => {
    try {
      const r = await fetch(`${API}/api/v1/literacy/admin/certificate/${encodeURIComponent(certId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) { setMsg(`Could not fetch certificate (HTTP ${r.status})`); return; }
      const blob = await r.blob();
      const mime = blob.type || "application/octet-stream";
      const url  = URL.createObjectURL(blob);
      if (preview && preview.url) URL.revokeObjectURL(preview.url);
      setPreview({ url, mime, certId });
    } catch (e) {
      setMsg(`Could not fetch certificate: ${e.message}`);
    }
  };

  const approve = async (pid, declaredLevel) => {
    const level = approveLevel[pid] || declaredLevel;
    if (!level) { setMsg("Pick a verified level first."); return; }
    setBusyPid(pid);
    try {
      const r = await fetch(`${API}/api/v1/literacy/admin/approve/${encodeURIComponent(pid)}`, {
        method: "POST", headers,
        body: JSON.stringify({ verified_level: level, note: notes[pid] || "" }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || "approve failed");
      setMsg(`✓ Approved ${pid} at ${LEVEL_LABELS[level] || level} → mode "${LEVEL_TO_MODE[level] || "beginner"}"`);
      fetchQueue();
    } catch (e) { setMsg(`Error: ${e.message}`); }
    finally { setBusyPid(null); }
  };

  const reject = async (pid) => {
    const note = (notes[pid] || "").trim();
    if (!note) { setMsg("A rejection reason is required."); return; }
    setBusyPid(pid);
    try {
      const r = await fetch(`${API}/api/v1/literacy/admin/reject/${encodeURIComponent(pid)}`, {
        method: "POST", headers,
        body: JSON.stringify({ note }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || "reject failed");
      setMsg(`Rejected ${pid}`);
      setRejectMode(prev => ({ ...prev, [pid]: false }));
      fetchQueue();
    } catch (e) { setMsg(`Error: ${e.message}`); }
    finally { setBusyPid(null); }
  };

  return (
    <div className="ad-section">
      <div className="ad-toolbar" style={{ alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Education Verification ({rows.length})</h2>
        <button className="ad-btn" onClick={fetchQueue} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.6, marginTop: 4 }}>
        Patients awaiting literacy-mode verification. Approving at a higher
        level unlocks a richer UI; unverified users are kept in <strong>Beginner</strong> mode
        as a safe floor.
      </p>

      {msg && (
        <div className="ad-msg" onClick={() => setMsg("")} style={{ marginBottom: 12 }}>
          {msg} (click to dismiss)
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div className="ad-loading">Loading…</div>
      ) : rows.length === 0 ? (
        <div
          style={{
            padding: 24, background: C.bg, border: `1px dashed ${C.border}`,
            borderRadius: 12, color: C.muted, textAlign: "center",
          }}
        >
          No patients pending verification. 🎉
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {rows.map(row => {
            const pid           = row.patient_id;
            const declared      = row.declared_level;
            const declaredLabel = LEVEL_LABELS[declared] || declared || "—";
            const allowedLevels = LEVEL_ORDER.filter(
              l => LEVEL_ORDER.indexOf(l) <= LEVEL_ORDER.indexOf(declared),
            );
            const chosenLevel = approveLevel[pid] || declared || "";
            const projMode    = LEVEL_TO_MODE[chosenLevel] || "beginner";
            const isRejecting = !!rejectMode[pid];
            const busy        = busyPid === pid;

            return (
              <div
                key={pid}
                style={{
                  background: C.card, border: `1px solid ${C.border}`,
                  borderRadius: 14, padding: 16,
                  boxShadow: "0 1px 4px rgba(15,23,42,.04)",
                }}
              >
                {/* Row header */}
                <div
                  style={{
                    display: "flex", alignItems: "flex-start",
                    justifyContent: "space-between", gap: 12, marginBottom: 10,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>
                      {row.patient_name || "(no name)"}
                    </div>
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 2, fontFamily: "monospace" }}>
                      {pid}
                    </div>
                  </div>
                  <StatusPill status={row.status || "pending"} />
                </div>

                {/* Declared vs current */}
                <div
                  style={{
                    display: "flex", flexWrap: "wrap", gap: 16,
                    fontSize: 12, color: C.text, marginBottom: 12,
                  }}
                >
                  <div>
                    <div style={{ color: C.muted, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: ".5px" }}>
                      Declared level
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{declaredLabel}</div>
                  </div>
                  <div>
                    <div style={{ color: C.muted, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: ".5px" }}>
                      Current mode
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2, color: C.blue }}>
                      {row.current_mode || "beginner"}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: C.muted, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: ".5px" }}>
                      Certificate
                    </div>
                    <div style={{ fontSize: 14, marginTop: 2 }}>
                      {row.certificate ? (
                        <button
                          onClick={() => openCertificate(row.certificate.cert_id)}
                          style={{
                            background: "none", border: "none", padding: 0,
                            color: C.accent, fontWeight: 700, cursor: "pointer",
                            fontSize: 13, textDecoration: "underline",
                          }}
                        >
                          View {row.certificate.filename || "certificate"}
                        </button>
                      ) : (
                        <span style={{ color: C.muted, fontStyle: "italic" }}>None uploaded</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Reject mode */}
                {isRejecting ? (
                  <div
                    style={{
                      background: "#fef2f2", border: `1px solid #fecaca`,
                      borderRadius: 10, padding: 12,
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#b91c1c", marginBottom: 6 }}>
                      Reject verification
                    </div>
                    <textarea
                      placeholder="Required: explain why (e.g., certificate unreadable, doesn't match declared level)…"
                      value={notes[pid] || ""}
                      onChange={e => setNotes(prev => ({ ...prev, [pid]: e.target.value }))}
                      rows={3}
                      style={{
                        width: "100%", padding: 10, fontSize: 13,
                        border: `1px solid ${C.border}`, borderRadius: 8,
                        resize: "vertical",
                      }}
                    />
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <button
                        className="ad-btn"
                        onClick={() => {
                          setRejectMode(prev => ({ ...prev, [pid]: false }));
                        }}
                        disabled={busy}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => reject(pid)}
                        disabled={busy}
                        style={{
                          padding: "8px 14px", borderRadius: 8,
                          background: C.red, border: "none", color: "#fff",
                          fontWeight: 700, fontSize: 13, cursor: "pointer",
                        }}
                      >
                        {busy ? "Rejecting…" : "Confirm reject"}
                      </button>
                    </div>
                  </div>
                ) : (
                  // Approve / reject actions
                  <div
                    style={{
                      display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center",
                      background: C.bg, border: `1px solid ${C.border}`,
                      borderRadius: 10, padding: 12,
                    }}
                  >
                    <label style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
                      Approve at:
                    </label>
                    <select
                      value={chosenLevel}
                      onChange={e => setApproveLevel(prev => ({ ...prev, [pid]: e.target.value }))}
                      disabled={busy}
                      style={{
                        padding: "7px 10px", fontSize: 13,
                        border: `1px solid ${C.border}`, borderRadius: 8, background: "#fff",
                      }}
                    >
                      {allowedLevels.map(l => (
                        <option key={l} value={l}>{LEVEL_LABELS[l]}</option>
                      ))}
                    </select>

                    <span
                      style={{
                        fontSize: 11, color: C.muted, fontWeight: 600,
                      }}
                    >
                      → mode <strong style={{ color: C.blue }}>{projMode}</strong>
                    </span>

                    <input
                      type="text"
                      placeholder="Note (optional)"
                      value={notes[pid] || ""}
                      onChange={e => setNotes(prev => ({ ...prev, [pid]: e.target.value }))}
                      style={{
                        flex: "1 1 180px", padding: "8px 10px", fontSize: 13,
                        border: `1px solid ${C.border}`, borderRadius: 8, minWidth: 160,
                      }}
                    />

                    <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
                      <button
                        onClick={() => setRejectMode(prev => ({ ...prev, [pid]: true }))}
                        disabled={busy}
                        style={{
                          padding: "8px 14px", borderRadius: 8,
                          background: "#fff", border: `1px solid ${C.red}`,
                          color: C.red, fontWeight: 700, fontSize: 13, cursor: "pointer",
                        }}
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => approve(pid, declared)}
                        disabled={busy}
                        style={{
                          padding: "8px 14px", borderRadius: 8,
                          background: C.green, border: "none",
                          color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer",
                        }}
                      >
                        {busy ? "Saving…" : "Approve"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Certificate preview modal */}
      {preview && (
        <div
          onClick={() => { URL.revokeObjectURL(preview.url); setPreview(null); }}
          style={{
            position: "fixed", inset: 0, zIndex: 10001,
            background: "rgba(15,23,42,.82)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 24, cursor: "zoom-out",
          }}
          role="dialog"
          aria-modal="true"
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: C.card, borderRadius: 14,
              maxWidth: "92vw", maxHeight: "92vh", overflow: "auto",
              boxShadow: "0 20px 60px rgba(0,0,0,.4)",
              cursor: "default",
            }}
          >
            <div
              style={{
                padding: "12px 16px", borderBottom: `1px solid ${C.border}`,
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700 }}>Certificate preview</div>
              <button
                onClick={() => { URL.revokeObjectURL(preview.url); setPreview(null); }}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: C.muted, fontSize: 20, fontWeight: 700, padding: 0,
                }}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div style={{ padding: 16 }}>
              {preview.mime.startsWith("image/") ? (
                <img
                  src={preview.url}
                  alt="certificate"
                  style={{ maxWidth: "86vw", maxHeight: "78vh", display: "block" }}
                />
              ) : preview.mime === "application/pdf" ? (
                <iframe
                  src={preview.url}
                  title="certificate"
                  style={{ width: "86vw", height: "78vh", border: "none" }}
                />
              ) : (
                <div style={{ color: C.muted, padding: 16 }}>
                  Preview not supported for this file type.{" "}
                  <a href={preview.url} download>Download instead</a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
