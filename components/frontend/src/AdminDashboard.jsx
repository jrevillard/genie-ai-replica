import { useState, useEffect, useCallback } from "react";
import Dhis2SyncPanel from "./admin/Dhis2SyncPanel";
import AdminLiteracyQueue from "./admin/AdminLiteracyQueue.jsx";
import Dhis2TrackerPanel from "./admin/Dhis2TrackerPanel.jsx";

const API = (window.AMINA_API || "http://localhost:8000").replace(/\/+$/, "");

export default function AdminDashboard({ token, onLogout, embedded = false, initialTab, hideTabs = [] }) {
  const [tab, setTab] = useState(initialTab || "overview");
  const [stats, setStats] = useState(null);
  const [patients, setPatients] = useState([]);
  const [consultations, setConsultations] = useState([]);
  const [community, setCommunity] = useState([]);
  const [knowledge, setKnowledge] = useState([]);
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [editPatient, setEditPatient] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [msg, setMsg] = useState("");

  // ── Transfer state ──
  const [transfers, setTransfers]           = useState([]);
  const [transferPending, setTransferPending] = useState(0);
  const [cgDirectory, setCgDirectory]       = useState([]);
  const [expandedTransfer, setExpandedTransfer] = useState(null);
  const [selectedNewCg, setSelectedNewCg]   = useState({});   // { [rid]: caregiver_id }
  const [approveNote, setApproveNote]       = useState({});   // { [rid]: note }
  const [declineReason, setDeclineReason]   = useState({});
  const [respondingRid, setRespondingRid]   = useState(null);

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const fetchStats = useCallback(() => {
    fetch(`${API}/api/v1/admin/stats`, { headers }).then(r => r.json()).then(setStats).catch(() => {});
  }, [token]);

  const fetchPatients = useCallback((q = "") => {
    setLoading(true);
    fetch(`${API}/api/v1/admin/patients?limit=100&search=${encodeURIComponent(q)}`, { headers })
      .then(r => r.json()).then(d => { setPatients(d.patients || []); setLoading(false); }).catch(() => setLoading(false));
  }, [token]);

  const fetchConsultations = useCallback(() => {
    fetch(`${API}/api/v1/admin/consultations?limit=50`, { headers }).then(r => r.json()).then(d => setConsultations(d.consultations || [])).catch(() => {});
  }, [token]);

  const fetchCommunity = useCallback(() => {
    fetch(`${API}/api/v1/admin/community`, { headers }).then(r => r.json()).then(d => setCommunity(d.records || [])).catch(() => {});
  }, [token]);

  const fetchKnowledge = useCallback(() => {
    fetch(`${API}/api/v1/admin/knowledge`, { headers }).then(r => r.json()).then(d => setKnowledge(d.sources || [])).catch(() => {});
  }, [token]);

  const fetchAudit = useCallback(() => {
    fetch(`${API}/api/v1/admin/audit?limit=100`, { headers }).then(r => r.json()).then(d => setAudit(d.logs || [])).catch(() => {});
  }, [token]);

  const fetchTransfers = useCallback(() => {
    fetch(`${API}/api/v1/admin/transfer-requests`, { headers })
      .then(r => r.json())
      .then(d => { setTransfers(d.requests || []); setTransferPending(d.pending || 0); })
      .catch(() => {});
  }, [token]);

  const fetchCgDirectory = useCallback(() => {
    fetch(`${API}/api/v1/admin/caregivers-directory`, { headers })
      .then(r => r.json())
      .then(d => setCgDirectory(d.caregivers || []))
      .catch(() => {});
  }, [token]);

  const approveTransfer = async (rid) => {
    const cgId = selectedNewCg[rid];
    if (!cgId) { setMsg("Please select a new caregiver before approving."); return; }
    setRespondingRid(rid);
    try {
      const r = await fetch(`${API}/api/v1/admin/transfer-requests/${rid}/approve`, {
        method: "POST", headers,
        body: JSON.stringify({ new_caregiver_id: cgId, admin_note: approveNote[rid] || "" }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || "Approval failed");
      setMsg(`✓ Transfer ${rid} approved — patient assigned to ${d.new_caregiver_name}`);
      fetchTransfers();
      setExpandedTransfer(null);
    } catch (e) { setMsg(`Error: ${e.message}`); }
    finally { setRespondingRid(null); }
  };

  const declineTransfer = async (rid) => {
    setRespondingRid(rid);
    try {
      const r = await fetch(`${API}/api/v1/admin/transfer-requests/${rid}/decline`, {
        method: "POST", headers,
        body: JSON.stringify({ reason: declineReason[rid] || "" }),
      });
      if (!r.ok) throw new Error("Decline failed");
      setMsg(`Transfer ${rid} declined.`);
      fetchTransfers();
      setExpandedTransfer(null);
    } catch (e) { setMsg(`Error: ${e.message}`); }
    finally { setRespondingRid(null); }
  };

  useEffect(() => { fetchStats(); fetchTransfers(); }, [fetchStats, fetchTransfers]);
  useEffect(() => {
    if (tab === "patients") fetchPatients(search);
    if (tab === "consultations") fetchConsultations();
    if (tab === "community") fetchCommunity();
    if (tab === "knowledge") fetchKnowledge();
    if (tab === "audit") fetchAudit();
    if (tab === "transfers") { fetchTransfers(); fetchCgDirectory(); }
  }, [tab]);

  const deletePatient = async (pid) => {
    if (!confirm(`Delete patient ${pid}? This will also delete their consultations and memories.`)) return;
    const r = await fetch(`${API}/api/v1/admin/patients/${pid}`, { method: "DELETE", headers });
    const d = await r.json();
    setMsg(d.deleted ? `Deleted ${pid}` : "Delete failed");
    fetchPatients(search); fetchStats();
  };

  const updatePatient = async () => {
    if (!editPatient) return;
    const r = await fetch(`${API}/api/v1/admin/patients/${editPatient}`, { method: "PUT", headers, body: JSON.stringify(editForm) });
    const d = await r.json();
    setMsg(d.updated ? `Updated ${editPatient}` : d.error || "Update failed");
    setEditPatient(null); fetchPatients(search);
  };

  const deleteConsultation = async (cid) => {
    if (!confirm(`Delete consultation ${cid}?`)) return;
    await fetch(`${API}/api/v1/admin/consultations/${cid}`, { method: "DELETE", headers });
    setMsg(`Deleted consultation ${cid}`);
    fetchConsultations(); fetchStats();
  };

  const openEdit = (p) => {
    setEditPatient(p.id);
    setEditForm({ name: p.name || "", age: p.age || 0, gender: p.gender || "other", region: p.region || "Kanifing", phone: p.phone || "", email: p.email || "", conditions: p.conditions || [], preferred_language: p.preferred_language || "english" });
  };

  const StatCard = ({ label, value, color }) => (
    <div className="ad-stat">
      <div className="ad-stat-val" style={{ color }}>{value}</div>
      <div className="ad-stat-label">{label}</div>
    </div>
  );

  // When embedded inside the new AdminShell, the outer shell owns the
  // sidebar + topbar + sign-out — we render only the content pane with
  // a local tab bar filtered by the `hideTabs` list.
  const ALL_TABS = [
    ["overview", "Overview"], ["patients", "Patients"],
    ["consultations", "Consultations"], ["community", "Community"],
    ["knowledge", "Knowledge Base"], ["audit", "Audit Log"],
    ["dhis2", "DHIS2 Sync"], ["dhis2tracker", "DHIS2 Tracker"],
    ["verify", "Verification"], ["transfers", "Transfers"],
  ];
  const visibleTabs = ALL_TABS.filter(([k]) => !hideTabs.includes(k));

  return (
    <div className="ad-page" style={embedded ? { background: "transparent" } : undefined}>
      {!embedded && (
        <div className="ad-sidebar">
          <div className="ad-brand">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2"><path d="M3 12h4l3-9 4 18 3-9h4"/></svg>
            <span>AMINA Admin</span>
          </div>
          <nav className="ad-nav">
            {[["overview","Overview"],["patients","Patients"],["consultations","Consultations"],["community","Community"],["knowledge","Knowledge Base"],["audit","Audit Log"],["dhis2","DHIS2 Sync"],["dhis2tracker","DHIS2 Tracker"],["verify","Verification"]].map(([k,l]) => (
              <button key={k} className={`ad-nav-btn${tab === k ? " on" : ""}`} onClick={() => setTab(k)}>{l}</button>
            ))}
            <button
              className={`ad-nav-btn${tab === "transfers" ? " on" : ""}`}
              onClick={() => setTab("transfers")}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
            >
              <span>Transfers</span>
              {transferPending > 0 && (
                <span style={{
                  background: "#ef4444", color: "#fff", borderRadius: "50%",
                  width: 18, height: 18, fontSize: 10, fontWeight: 800,
                  display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>{transferPending > 9 ? "9+" : transferPending}</span>
              )}
            </button>
          </nav>
          <button className="ad-logout" onClick={onLogout}>Sign Out</button>
        </div>
      )}

      {embedded && visibleTabs.length > 1 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
          {visibleTabs.map(([k, l]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              style={{
                padding: "6px 12px",
                border: "1px solid var(--a-border-1, rgba(148,163,184,0.16))",
                borderRadius: 999,
                background: tab === k ? "color-mix(in oklab, var(--a-accent-2, #6366f1), transparent 75%)" : "transparent",
                color: tab === k ? "var(--a-fg, #f1f5f9)" : "var(--a-fg-mute, #94a3b8)",
                fontSize: 12, fontWeight: 600, cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {l}{k === "transfers" && transferPending > 0 ? ` · ${transferPending}` : ""}
            </button>
          ))}
        </div>
      )}

      <div className="ad-main" style={embedded ? { padding: 0 } : undefined}>
        {msg && <div className="ad-msg" onClick={() => setMsg("")}>{msg} (click to dismiss)</div>}

        {/* Overview */}
        {tab === "overview" && stats && (
          <div className="ad-section">
            <h2>Dashboard Overview</h2>
            <div className="ad-stats-grid">
              <StatCard label="Patients" value={stats.patients} color="#818cf8" />
              <StatCard label="Consultations" value={stats.consultations} color="#4ade80" />
              <StatCard label="Community Records" value={stats.community_records} color="#fbbf24" />
              <StatCard label="Knowledge Chunks" value={stats.knowledge_chunks} color="#f87171" />
              <StatCard label="Medical Entities" value={stats.entities} color="#a78bfa" />
              <StatCard label="Patient Memories" value={stats.memories} color="#38bdf8" />
            </div>
          </div>
        )}

        {/* Patients */}
        {tab === "patients" && (
          <div className="ad-section">
            <div className="ad-toolbar">
              <h2>Patients ({patients.length})</h2>
              <input className="ad-search" placeholder="Search by name, phone, or ID..." value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === "Enter" && fetchPatients(search)} />
              <button className="ad-btn" onClick={() => fetchPatients(search)}>Search</button>
            </div>
            {loading ? <div className="ad-loading">Loading...</div> : (
              <div className="ad-table-wrap">
                <table className="ad-table">
                  <thead><tr><th>ID</th><th>Name</th><th>Phone</th><th>Age</th><th>Gender</th><th>Region</th><th>Conditions</th><th>Visits</th><th>Actions</th></tr></thead>
                  <tbody>
                    {patients.map(p => (
                      <tr key={p.id}>
                        <td className="ad-id">{p.id}</td>
                        <td>{p.name || "-"}</td>
                        <td>{p.phone || p.email || "-"}</td>
                        <td>{p.age || "-"}</td>
                        <td>{p.gender || "-"}</td>
                        <td>{(p.region || "").replace("_", " ")}</td>
                        <td>{(Array.isArray(p.conditions) ? p.conditions : []).join(", ") || "-"}</td>
                        <td>{p.consultation_count || 0}</td>
                        <td className="ad-actions">
                          <button className="ad-btn-sm ad-edit" onClick={() => openEdit(p)}>Edit</button>
                          <button className="ad-btn-sm ad-del" onClick={() => deletePatient(p.id)}>Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Edit Patient Modal */}
        {editPatient && (
          <div className="ad-modal-overlay" onMouseDown={e => e.target === e.currentTarget && setEditPatient(null)}>
            <div className="ad-modal">
              <h3>Edit Patient: {editPatient}</h3>
              <div className="ad-modal-form">
                <label>Name<input value={editForm.name} onChange={e => setEditForm({...editForm, name: e.target.value})} /></label>
                <label>Age<input type="number" value={editForm.age} onChange={e => setEditForm({...editForm, age: parseInt(e.target.value) || 0})} /></label>
                <label>Gender<select value={editForm.gender} onChange={e => setEditForm({...editForm, gender: e.target.value})}><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></label>
                <label>Region<input value={editForm.region} onChange={e => setEditForm({...editForm, region: e.target.value})} /></label>
                <label>Phone<input value={editForm.phone} onChange={e => setEditForm({...editForm, phone: e.target.value})} /></label>
                <label>Email<input value={editForm.email} onChange={e => setEditForm({...editForm, email: e.target.value})} /></label>
                <label>Language<select value={editForm.preferred_language} onChange={e => setEditForm({...editForm, preferred_language: e.target.value})}><option value="english">English</option><option value="mandinka">Mandinka</option></select></label>
              </div>
              <div className="ad-modal-actions">
                <button className="ad-btn" onClick={updatePatient}>Save Changes</button>
                <button className="ad-btn ad-btn-cancel" onClick={() => setEditPatient(null)}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* Consultations */}
        {tab === "consultations" && (
          <div className="ad-section">
            <h2>Consultations ({consultations.length})</h2>
            <div className="ad-table-wrap">
              <table className="ad-table">
                <thead><tr><th>ID</th><th>Patient</th><th>Date</th><th>Triage</th><th>Summary</th><th>Tools</th><th>Actions</th></tr></thead>
                <tbody>
                  {consultations.map(c => (
                    <tr key={c.id}>
                      <td className="ad-id">{c.id}</td>
                      <td>{c.patient_id}</td>
                      <td>{(c.started_at || "").slice(0, 16)}</td>
                      <td><span className={`ad-triage ad-triage-${(c.triage_level || "").toLowerCase()}`}>{c.triage_level || "-"}</span></td>
                      <td className="ad-summary">{c.summary || "-"}</td>
                      <td className="ad-tools">{(Array.isArray(c.tools_used) ? c.tools_used : []).join(", ")}</td>
                      <td><button className="ad-btn-sm ad-del" onClick={() => deleteConsultation(c.id)}>Delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Community */}
        {tab === "community" && (
          <div className="ad-section">
            <h2>Community Data ({community.length})</h2>
            <div className="ad-cards">
              {community.map((c, i) => (
                <div key={i} className="ad-card">
                  <pre className="ad-json">{JSON.stringify(c, null, 2).slice(0, 500)}</pre>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Knowledge Base */}
        {tab === "knowledge" && (
          <div className="ad-section">
            <h2>Knowledge Base</h2>
            <div className="ad-table-wrap">
              <table className="ad-table">
                <thead><tr><th>Source Document</th><th>Chunks</th></tr></thead>
                <tbody>
                  {knowledge.map((k, i) => (
                    <tr key={i}>
                      <td>{k.source}</td>
                      <td className="ad-num">{k.chunks}</td>
                    </tr>
                  ))}
                  <tr className="ad-total"><td><strong>Total</strong></td><td className="ad-num"><strong>{knowledge.reduce((s, k) => s + k.chunks, 0)}</strong></td></tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Audit Log */}
        {tab === "audit" && (
          <div className="ad-section">
            <h2>Audit Log ({audit.length})</h2>
            <div className="ad-cards">
              {audit.length === 0 ? <p className="ad-empty">No audit logs yet.</p> : audit.map((a, i) => (
                <div key={i} className="ad-card">
                  <pre className="ad-json">{JSON.stringify(a, null, 2).slice(0, 400)}</pre>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── DHIS2 Sync ── */}
        {tab === "dhis2" && (
          <div className="ad-section">
            <Dhis2SyncPanel token={token} />
          </div>
        )}

        {/* ── DHIS2 Tracker (patient-level writeback + history + live discovery) ── */}
        {tab === "dhis2tracker" && (
          <div className="ad-section">
            <Dhis2TrackerPanel token={token} />
          </div>
        )}

        {/* ── Education Verification ── */}
        {tab === "verify" && (
          <AdminLiteracyQueue token={token} />
        )}

        {/* ── Transfers ── */}
        {tab === "transfers" && (
          <div className="ad-section">
            <div className="ad-toolbar" style={{ marginBottom: 20 }}>
              <h2>Caregiver Transfer Requests ({transfers.length})</h2>
              {transferPending > 0 && (
                <span style={{
                  padding: "4px 12px", borderRadius: 20,
                  background: "rgba(239,68,68,.12)", color: "#f87171",
                  fontSize: 12, fontWeight: 700,
                }}>{transferPending} pending</span>
              )}
              <button className="ad-btn" onClick={() => { fetchTransfers(); fetchCgDirectory(); }}>Refresh</button>
            </div>

            {transfers.length === 0 && (
              <p className="ad-empty">No transfer requests yet. They will appear here when patients submit them.</p>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {transfers.map(tr => {
                const isPending   = tr.status === "pending";
                const isExpanded  = expandedTransfer === tr.request_id;
                const statusColor = isPending ? "#f59e0b" : tr.status === "approved" ? "#22c55e" : "#f87171";
                const statusBg    = isPending ? "rgba(245,158,11,.1)" : tr.status === "approved" ? "rgba(34,197,94,.08)" : "rgba(239,68,68,.08)";

                return (
                  <div key={tr.request_id} style={{
                    background: "rgba(255,255,255,.02)", border: `1px solid ${isPending ? "rgba(245,158,11,.25)" : "rgba(255,255,255,.06)"}`,
                    borderRadius: 14, overflow: "hidden",
                  }}>
                    {/* Card header — always visible */}
                    <div
                      style={{
                        padding: "16px 20px", display: "flex", alignItems: "center",
                        gap: 14, cursor: "pointer",
                        background: isExpanded ? "rgba(99,102,241,.04)" : "transparent",
                      }}
                      onClick={() => setExpandedTransfer(isExpanded ? null : tr.request_id)}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                          <span style={{ fontWeight: 800, fontSize: 14, color: "#f1f5f9" }}>
                            {tr.patient_full_name || tr.patient_id}
                          </span>
                          <span style={{
                            padding: "2px 10px", borderRadius: 20, fontSize: 10, fontWeight: 700,
                            textTransform: "uppercase", background: statusBg, color: statusColor,
                          }}>{tr.status}</span>
                        </div>
                        <div style={{ fontSize: 12, color: "#64748b" }}>
                          <span>From: <strong style={{ color: "#94a3b8" }}>{tr.current_caregiver_name || "—"}</strong></span>
                          {tr.new_caregiver_name && (
                            <span style={{ marginLeft: 12 }}>→ New: <strong style={{ color: "#818cf8" }}>{tr.new_caregiver_name}</strong></span>
                          )}
                          <span style={{ marginLeft: 12, color: "#475569" }}>Ref: {tr.request_id}</span>
                          <span style={{ marginLeft: 12, color: "#475569" }}>{tr.submitted_at ? new Date(tr.submitted_at).toLocaleDateString("en-GB") : ""}</span>
                        </div>
                      </div>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2.5" strokeLinecap="round"
                        style={{ transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform .2s", flexShrink: 0 }}>
                        <polyline points="6 9 12 15 18 9"/>
                      </svg>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div style={{ padding: "0 20px 20px", borderTop: "1px solid rgba(255,255,255,.04)" }}>

                        {/* Patient details */}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, margin: "16px 0 12px" }}>
                          {[
                            ["Patient ID", tr.patient_id],
                            ["Age", tr.patient_age || "—"],
                            ["Gender", tr.patient_gender || "—"],
                            ["Region", tr.patient_region || "—"],
                            ["Phone", tr.patient_phone || "—"],
                            ["Submitted", tr.submitted_at ? new Date(tr.submitted_at).toLocaleString("en-GB") : "—"],
                          ].map(([label, val]) => (
                            <div key={label} style={{ background: "rgba(255,255,255,.02)", borderRadius: 8, padding: "8px 12px" }}>
                              <div style={{ fontSize: 9, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 3 }}>{label}</div>
                              <div style={{ fontSize: 12, color: "#cbd5e1", fontWeight: 600 }}>{val}</div>
                            </div>
                          ))}
                        </div>

                        {/* Reason */}
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 6 }}>Reason for Transfer</div>
                          <div style={{ background: "rgba(245,158,11,.05)", border: "1px solid rgba(245,158,11,.15)", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#e2e8f0", lineHeight: 1.6 }}>
                            {tr.reason || "—"}
                          </div>
                        </div>

                        {/* Preferences */}
                        {(tr.preferred_new_caregiver_specialty || tr.preferred_new_region) && (
                          <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
                            {tr.preferred_new_caregiver_specialty && (
                              <div style={{ background: "rgba(99,102,241,.06)", border: "1px solid rgba(99,102,241,.15)", borderRadius: 8, padding: "8px 14px", fontSize: 12, color: "#818cf8" }}>
                                Preferred specialty: <strong>{tr.preferred_new_caregiver_specialty}</strong>
                              </div>
                            )}
                            {tr.preferred_new_region && (
                              <div style={{ background: "rgba(99,102,241,.06)", border: "1px solid rgba(99,102,241,.15)", borderRadius: 8, padding: "8px 14px", fontSize: 12, color: "#818cf8" }}>
                                Preferred region: <strong>{tr.preferred_new_region}</strong>
                              </div>
                            )}
                          </div>
                        )}

                        {tr.additional_notes && (
                          <div style={{ marginBottom: 12, fontSize: 12, color: "#64748b" }}>
                            <span style={{ fontWeight: 700 }}>Additional notes: </span>{tr.additional_notes}
                          </div>
                        )}

                        {/* Admin action — only for pending */}
                        {isPending && (
                          <div style={{ background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.06)", borderRadius: 10, padding: "14px 16px", marginTop: 4 }}>
                            <div style={{ fontSize: 11, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 12 }}>Admin Action</div>

                            {/* New caregiver selector */}
                            <div style={{ marginBottom: 10 }}>
                              <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", display: "block", marginBottom: 5 }}>Select New Caregiver *</label>
                              <select
                                value={selectedNewCg[tr.request_id] || ""}
                                onChange={e => setSelectedNewCg(s => ({ ...s, [tr.request_id]: e.target.value }))}
                                style={{
                                  width: "100%", padding: "9px 12px", borderRadius: 8,
                                  border: "1px solid rgba(255,255,255,.08)",
                                  background: "rgba(255,255,255,.04)", color: "#e2e8f0",
                                  fontSize: 13, fontFamily: "inherit", outline: "none",
                                }}
                              >
                                <option value="">— choose a caregiver —</option>
                                {cgDirectory.map(cg => (
                                  <option key={cg.caregiver_id} value={cg.caregiver_id}>
                                    {cg.name} — {cg.specialization || "General"} ({cg.region || "?"})
                                    {cg.caregiver_id === tr.current_caregiver_id ? " [current]" : ""}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div style={{ marginBottom: 12 }}>
                              <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", display: "block", marginBottom: 5 }}>Admin Note (optional)</label>
                              <textarea
                                rows={2}
                                placeholder="Reason for approval or any instructions for the patient…"
                                value={approveNote[tr.request_id] || ""}
                                onChange={e => setApproveNote(n => ({ ...n, [tr.request_id]: e.target.value }))}
                                style={{
                                  width: "100%", padding: "8px 12px", borderRadius: 8,
                                  border: "1px solid rgba(255,255,255,.08)",
                                  background: "rgba(255,255,255,.04)", color: "#e2e8f0",
                                  fontSize: 13, fontFamily: "inherit", resize: "vertical", outline: "none",
                                }}
                              />
                            </div>

                            <div style={{ display: "flex", gap: 10 }}>
                              <button
                                onClick={() => approveTransfer(tr.request_id)}
                                disabled={respondingRid === tr.request_id || !selectedNewCg[tr.request_id]}
                                style={{
                                  flex: 1, padding: "9px 0", borderRadius: 8, border: "none",
                                  background: selectedNewCg[tr.request_id] ? "linear-gradient(135deg,#22c55e,#16a34a)" : "rgba(255,255,255,.05)",
                                  color: selectedNewCg[tr.request_id] ? "#fff" : "#475569",
                                  fontWeight: 700, fontSize: 13, cursor: selectedNewCg[tr.request_id] ? "pointer" : "default",
                                  fontFamily: "inherit",
                                }}
                              >
                                {respondingRid === tr.request_id ? "Processing…" : "✓ Approve & Link"}
                              </button>

                              <div style={{ flex: 1 }}>
                                <textarea
                                  rows={1}
                                  placeholder="Decline reason…"
                                  value={declineReason[tr.request_id] || ""}
                                  onChange={e => setDeclineReason(n => ({ ...n, [tr.request_id]: e.target.value }))}
                                  style={{
                                    width: "100%", padding: "8px 10px", borderRadius: 8,
                                    border: "1px solid rgba(239,68,68,.2)",
                                    background: "rgba(239,68,68,.04)", color: "#e2e8f0",
                                    fontSize: 12, fontFamily: "inherit", resize: "none", outline: "none",
                                    marginBottom: 6,
                                  }}
                                />
                                <button
                                  onClick={() => declineTransfer(tr.request_id)}
                                  disabled={respondingRid === tr.request_id}
                                  style={{
                                    width: "100%", padding: "8px 0", borderRadius: 8,
                                    border: "1px solid rgba(239,68,68,.3)", background: "rgba(239,68,68,.06)",
                                    color: "#f87171", fontWeight: 700, fontSize: 13,
                                    cursor: "pointer", fontFamily: "inherit",
                                  }}
                                >✕ Decline</button>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Resolved state */}
                        {!isPending && (
                          <div style={{
                            background: tr.status === "approved" ? "rgba(34,197,94,.06)" : "rgba(239,68,68,.06)",
                            border: `1px solid ${tr.status === "approved" ? "rgba(34,197,94,.2)" : "rgba(239,68,68,.2)"}`,
                            borderRadius: 10, padding: "12px 16px", marginTop: 4, fontSize: 13,
                          }}>
                            {tr.status === "approved"
                              ? <>✓ Approved — patient linked to <strong style={{ color: "#4ade80" }}>{tr.new_caregiver_name}</strong> on {tr.resolved_at ? new Date(tr.resolved_at).toLocaleDateString("en-GB") : "—"}</>
                              : <>✕ Declined on {tr.resolved_at ? new Date(tr.resolved_at).toLocaleDateString("en-GB") : "—"}{tr.admin_note ? ` — "${tr.admin_note}"` : ""}</>
                            }
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      <style>{ADMIN_CSS}</style>
    </div>
  );
}

const ADMIN_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap');
.ad-page{display:flex;height:100vh;background:#050810;font-family:'Outfit',sans-serif;color:#e2e8f0;overflow:hidden}
.ad-page *{box-sizing:border-box;margin:0;padding:0}
.ad-sidebar{width:240px;background:rgba(12,17,40,.95);border-right:1px solid rgba(255,255,255,.06);display:flex;flex-direction:column;padding:24px 16px;flex-shrink:0}
.ad-brand{display:flex;align-items:center;gap:10px;font-size:16px;font-weight:800;color:#e2e8f0;margin-bottom:32px;padding:0 8px}
.ad-nav{display:flex;flex-direction:column;gap:4px;flex:1}
.ad-nav-btn{padding:10px 14px;border-radius:10px;border:none;background:transparent;color:#64748b;font-size:13px;font-weight:600;font-family:'Outfit',sans-serif;cursor:pointer;text-align:left;transition:all .2s}
.ad-nav-btn:hover{background:rgba(255,255,255,.03);color:#94a3b8}
.ad-nav-btn.on{background:rgba(99,102,241,.1);color:#818cf8}
.ad-logout{padding:10px 14px;border-radius:10px;border:1px solid rgba(239,68,68,.2);background:transparent;color:#f87171;font-size:12px;font-weight:600;font-family:'Outfit',sans-serif;cursor:pointer;transition:all .2s;margin-top:auto}
.ad-logout:hover{background:rgba(239,68,68,.06)}
.ad-main{flex:1;overflow-y:auto;padding:32px}
.ad-msg{padding:12px 16px;margin-bottom:20px;border-radius:10px;background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.15);color:#4ade80;font-size:13px;cursor:pointer}
.ad-section h2{font-size:20px;font-weight:800;margin-bottom:20px;color:#f1f5f9}
.ad-stats-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px}
.ad-stat{padding:24px 20px;border-radius:16px;background:rgba(12,17,40,.8);border:1px solid rgba(255,255,255,.06)}
.ad-stat-val{font-size:32px;font-weight:900;margin-bottom:6px}
.ad-stat-label{font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.5px}
.ad-toolbar{display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap}
.ad-toolbar h2{margin-bottom:0;flex:0 0 auto}
.ad-search{flex:1;min-width:200px;padding:10px 16px;border-radius:10px;border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.03);color:#e2e8f0;font-size:13px;font-family:'Outfit',sans-serif;outline:none}
.ad-search:focus{border-color:rgba(99,102,241,.4)}
.ad-search::placeholder{color:#475569}
.ad-btn{padding:8px 18px;border-radius:10px;border:none;background:linear-gradient(135deg,#6366f1,#4f46e5);color:white;font-size:13px;font-weight:700;font-family:'Outfit',sans-serif;cursor:pointer;transition:all .2s}
.ad-btn:hover{filter:brightness(1.1)}
.ad-btn-cancel{background:rgba(255,255,255,.06);color:#94a3b8}
.ad-loading{padding:40px;text-align:center;color:#64748b}
.ad-table-wrap{overflow-x:auto;border-radius:12px;border:1px solid rgba(255,255,255,.06)}
.ad-table{width:100%;border-collapse:collapse;font-size:13px}
.ad-table th{padding:12px 14px;background:rgba(255,255,255,.03);text-align:left;font-weight:700;color:#94a3b8;text-transform:uppercase;font-size:10px;letter-spacing:.5px;border-bottom:1px solid rgba(255,255,255,.06)}
.ad-table td{padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.03)}
.ad-table tr:hover{background:rgba(99,102,241,.03)}
.ad-id{font-family:monospace;font-size:11px;color:#64748b}
.ad-summary{max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#94a3b8;font-size:12px}
.ad-tools{font-size:11px;color:#64748b;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ad-num{text-align:right;font-weight:700;font-variant-numeric:tabular-nums}
.ad-total{background:rgba(255,255,255,.03)}
.ad-total td{border-top:2px solid rgba(99,102,241,.2)}
.ad-actions{display:flex;gap:6px}
.ad-btn-sm{padding:5px 12px;border-radius:6px;border:1px solid rgba(255,255,255,.06);background:transparent;font-size:11px;font-weight:600;font-family:'Outfit',sans-serif;cursor:pointer;transition:all .2s}
.ad-edit{color:#818cf8;border-color:rgba(99,102,241,.2)}
.ad-edit:hover{background:rgba(99,102,241,.08)}
.ad-del{color:#f87171;border-color:rgba(239,68,68,.2)}
.ad-del:hover{background:rgba(239,68,68,.06)}
.ad-triage{padding:3px 8px;border-radius:6px;font-size:10px;font-weight:700;text-transform:uppercase}
.ad-triage-emergency{background:rgba(239,68,68,.12);color:#f87171}
.ad-triage-facility{background:rgba(245,158,11,.12);color:#fbbf24}
.ad-triage-chw_visit{background:rgba(59,130,246,.12);color:#60a5fa}
.ad-triage-self_care{background:rgba(34,197,94,.08);color:#4ade80}
.ad-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(350px,1fr));gap:12px}
.ad-card{border-radius:12px;border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.02);padding:14px;overflow:hidden}
.ad-json{font-size:11px;color:#94a3b8;white-space:pre-wrap;word-break:break-all;font-family:'Fira Code',monospace;line-height:1.6}
.ad-empty{color:#475569;font-size:13px;padding:20px}
.ad-modal-overlay{position:fixed;inset:0;z-index:200;background:rgba(5,8,16,.8);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px}
.ad-modal{max-width:480px;width:100%;background:rgba(12,17,40,.95);border:1px solid rgba(255,255,255,.06);border-radius:20px;padding:28px;box-shadow:0 24px 64px rgba(0,0,0,.6)}
.ad-modal h3{font-size:18px;font-weight:800;margin-bottom:20px}
.ad-modal-form{display:flex;flex-direction:column;gap:12px}
.ad-modal-form label{display:flex;flex-direction:column;gap:5px;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px}
.ad-modal-form input,.ad-modal-form select{padding:10px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.03);color:#e2e8f0;font-size:14px;font-family:'Outfit',sans-serif;outline:none}
.ad-modal-form input:focus,.ad-modal-form select:focus{border-color:rgba(99,102,241,.4)}
.ad-modal-form select option{background:#0c1128;color:#e2e8f0}
.ad-modal-actions{display:flex;gap:10px;margin-top:20px;justify-content:flex-end}
@media(max-width:768px){
  .ad-sidebar{width:60px;padding:16px 8px}
  .ad-brand span,.ad-nav-btn{font-size:0;overflow:hidden}
  .ad-nav-btn{padding:10px;text-align:center}
  .ad-main{padding:16px}
}
`;
