import { useState, useEffect, useRef } from "react";
import CaregiverChat from "./CaregiverChat";

const API = (window.AMINA_API || "http://localhost:8000").replace(/\/+$/, "");

// ── Transfer Request Modal ─────────────────────────────────────────────────
function TransferRequestModal({ patient, token, cgId, cgName, onClose }) {
  const [step, setStep]         = useState("form");   // form | review | done
  const [submitting, setSub]    = useState(false);
  const [result, setResult]     = useState(null);
  const [form, setForm]         = useState({
    reason: "",
    preferred_new_caregiver_specialty: "",
    preferred_new_region: "",
    additional_notes: "",
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.reason.trim()) return;
    setSub(true);
    try {
      const r = await fetch(`${API}/api/v1/patient/transfer-request`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          reason:                    form.reason,
          current_caregiver_id:      cgId || "",
          current_caregiver_name:    cgName || "",
          patient_full_name:         patient?.name || "",
          patient_age:               patient?.age ? String(patient.age) : "",
          patient_gender:            patient?.gender || "",
          patient_region:            patient?.region || "",
          patient_phone:             patient?.phone || "",
          preferred_new_caregiver_specialty: form.preferred_new_caregiver_specialty,
          preferred_new_region:      form.preferred_new_region,
          additional_notes:          form.additional_notes,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || "Submission failed");
      setResult(d);
      setStep("done");
    } catch (e) {
      alert(e.message);
    } finally {
      setSub(false);
    }
  };

  const downloadPDF = () => {
    if (!result?.form) return;
    const f      = result.form;
    const today  = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>AMINA — Caregiver Transfer Request</title>
<style>
  @page { size: A4; margin: 20mm 18mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Times New Roman", serif; font-size: 11pt; color: #0f172a; line-height: 1.55; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #0f172a; padding-bottom: 12px; margin-bottom: 16px; }
  .logo { font-size: 22pt; font-weight: 900; letter-spacing: -1px; color: #0f172a; }
  .logo span { color: #10b981; }
  .doc-meta { text-align: right; font-size: 9pt; color: #475569; }
  h1 { font-size: 14pt; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; border: 2px solid #0f172a; text-align: center; padding: 7px 0; margin-bottom: 14px; }
  .section { margin-bottom: 14px; }
  .section-title { font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: .8px; color: #475569; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; margin-bottom: 8px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 20px; }
  .field { margin-bottom: 7px; }
  .field label { font-size: 8.5pt; font-weight: 700; display: block; color: #475569; margin-bottom: 2px; }
  .field .val { border-bottom: 1px solid #94a3b8; min-height: 18px; font-size: 10.5pt; padding: 1px 2px; }
  .reason-box { border: 1px solid #94a3b8; min-height: 60px; padding: 6px; font-size: 10.5pt; white-space: pre-wrap; }
  .notice { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; padding: 8px 10px; font-size: 9pt; color: #334155; margin-bottom: 14px; }
  .sig-block { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; margin-top: 28px; }
  .sig-col label { font-size: 8.5pt; font-weight: 700; color: #475569; display: block; margin-bottom: 28px; }
  .sig-line { border-bottom: 1.5px solid #0f172a; height: 36px; margin-bottom: 4px; }
  .sig-name { font-size: 8pt; color: #64748b; }
  .sig-date-line { border-bottom: 1px solid #94a3b8; height: 20px; margin: 8px 0 3px; }
  .footer { margin-top: 20px; border-top: 1px solid #cbd5e1; padding-top: 8px; font-size: 8pt; color: #94a3b8; display: flex; justify-content: space-between; }
  .ref { font-size: 9pt; font-weight: 700; color: #0f172a; text-align: center; margin-bottom: 10px; }
</style></head><body>
<div class="header">
  <div><div class="logo">AM<span>I</span>NA</div><div style="font-size:9pt;color:#475569">AI Health Platform — The Gambia</div></div>
  <div class="doc-meta">Reference: <strong>${f.request_id}</strong><br/>Date: ${today}<br/>Status: ${f.status.toUpperCase()}</div>
</div>
<h1>Formal Caregiver Transfer Request</h1>
<div class="ref">Reference No: ${f.request_id}</div>
<div class="notice">
  ⚠ This form must be printed, signed by the patient, and submitted to the AMINA District Health Office (DHO)
  along with a valid identification document. Transfer will only take effect after admin approval.
</div>
<div class="section">
  <div class="section-title">Patient Information</div>
  <div class="grid2">
    <div class="field"><label>Full Name</label><div class="val">${f.patient_full_name || ""}</div></div>
    <div class="field"><label>Age</label><div class="val">${f.patient_age || ""}</div></div>
    <div class="field"><label>Gender</label><div class="val">${f.patient_gender || ""}</div></div>
    <div class="field"><label>Region / District</label><div class="val">${f.patient_region || ""}</div></div>
    <div class="field"><label>Phone Number</label><div class="val">${f.patient_phone || ""}</div></div>
    <div class="field"><label>Submission Date</label><div class="val">${today}</div></div>
  </div>
</div>
<div class="section">
  <div class="section-title">Current Caregiver</div>
  <div class="grid2">
    <div class="field"><label>Caregiver Name</label><div class="val">${f.current_caregiver_name || ""}</div></div>
    <div class="field"><label>Caregiver ID</label><div class="val">${f.current_caregiver_id || ""}</div></div>
  </div>
</div>
<div class="section">
  <div class="section-title">Reason for Transfer Request</div>
  <div class="reason-box">${(f.reason || "").replace(/</g, "&lt;")}</div>
</div>
<div class="section">
  <div class="section-title">Preference for New Caregiver (optional)</div>
  <div class="grid2">
    <div class="field"><label>Preferred Specialty</label><div class="val">${f.preferred_new_caregiver_specialty || ""}</div></div>
    <div class="field"><label>Preferred Region</label><div class="val">${f.preferred_new_region || ""}</div></div>
  </div>
  ${f.additional_notes ? `<div class="field" style="margin-top:6px"><label>Additional Notes</label><div class="reason-box" style="min-height:36px">${f.additional_notes.replace(/</g,"&lt;")}</div></div>` : ""}
</div>
<div class="sig-block">
  <div class="sig-col">
    <label>Patient Signature</label>
    <div class="sig-line"></div>
    <div class="sig-name">${f.patient_full_name || "Patient"}</div>
    <div class="sig-date-line"></div>
    <div class="sig-name">Date</div>
  </div>
  <div class="sig-col">
    <label>Current Caregiver Acknowledgement</label>
    <div class="sig-line"></div>
    <div class="sig-name">${f.current_caregiver_name || "Caregiver"}</div>
    <div class="sig-date-line"></div>
    <div class="sig-name">Date</div>
  </div>
  <div class="sig-col">
    <label>AMINA District Health Officer (DHO)</label>
    <div class="sig-line"></div>
    <div class="sig-name">Authorising Officer</div>
    <div class="sig-date-line"></div>
    <div class="sig-name">Date &amp; Stamp</div>
  </div>
</div>
<div class="footer">
  <span>AMINA AI Health Platform — The Gambia</span>
  <span>Ref: ${f.request_id} | Submitted: ${today}</span>
  <span>admin@amina.health</span>
</div>
</body></html>`;
    const w = window.open("", "_blank", "width=900,height=700");
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 600);
  };

  const inputStyle = {
    width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #d1d5db",
    fontSize: 13, fontFamily: "inherit", boxSizing: "border-box",
    outline: "none", resize: "vertical",
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 800,
      background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        background: "#fff", borderRadius: 16, width: "min(96vw, 520px)", maxHeight: "90vh",
        overflow: "hidden", display: "flex", flexDirection: "column",
        boxShadow: "0 20px 60px rgba(0,0,0,.2)",
      }}>
        {/* Header */}
        <div style={{
          padding: "18px 22px 14px", borderBottom: "1px solid #e5e7eb",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: "#0f172a" }}>Request Caregiver Transfer</div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
              {step === "done" ? "Request submitted" : "Fill in the form — print and sign offline"}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "#6b7280", fontSize: 20, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: "20px 22px", overflowY: "auto", flex: 1 }}>
          {step === "form" && (<>
            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#92400e", marginBottom: 16 }}>
              <strong>Note:</strong> This request requires admin approval. After submitting, download the PDF, print it, sign it, and bring it to your District Health Office (DHO) together with a valid ID.
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#374151", display: "block", marginBottom: 4 }}>
                Current Caregiver *
              </label>
              <input value={cgName || "(none linked)"} readOnly
                style={{ ...inputStyle, background: "#f9fafb", color: "#6b7280" }} />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#374151", display: "block", marginBottom: 4 }}>
                Reason for Transfer Request <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <textarea
                rows={4}
                placeholder="Explain why you would like to change your caregiver (e.g. moved to a different region, need a specialist, communication difficulties…)"
                value={form.reason}
                onChange={e => set("reason", e.target.value)}
                style={inputStyle}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: "#374151", display: "block", marginBottom: 4 }}>Preferred Specialty (optional)</label>
                <input
                  placeholder="e.g. Maternal Health"
                  value={form.preferred_new_caregiver_specialty}
                  onChange={e => set("preferred_new_caregiver_specialty", e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: "#374151", display: "block", marginBottom: 4 }}>Preferred Region (optional)</label>
                <input
                  placeholder="e.g. WCR"
                  value={form.preferred_new_region}
                  onChange={e => set("preferred_new_region", e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#374151", display: "block", marginBottom: 4 }}>Additional Notes (optional)</label>
              <textarea
                rows={2}
                placeholder="Any other information the admin team should know…"
                value={form.additional_notes}
                onChange={e => set("additional_notes", e.target.value)}
                style={inputStyle}
              />
            </div>

            <button
              onClick={submit}
              disabled={submitting || !form.reason.trim()}
              style={{
                width: "100%", padding: "11px 0", borderRadius: 10, border: "none",
                background: form.reason.trim() ? "#4f46e5" : "#e5e7eb",
                color: form.reason.trim() ? "#fff" : "#9ca3af",
                fontWeight: 700, fontSize: 14, cursor: form.reason.trim() ? "pointer" : "default",
                transition: "background .15s",
              }}
            >
              {submitting ? "Submitting…" : "Submit Transfer Request"}
            </button>
          </>)}

          {step === "done" && result && (<>
            <div style={{
              background: "#f0fdf4", border: "1px solid #bbf7d0",
              borderRadius: 10, padding: "14px 16px", marginBottom: 16,
            }}>
              <div style={{ fontWeight: 800, color: "#065f46", fontSize: 14, marginBottom: 4 }}>
                ✓ Request Submitted
              </div>
              <div style={{ fontSize: 12, color: "#065f46" }}>{result.message}</div>
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 6 }}>
                Reference: <strong>{result.request_id}</strong>
              </div>
            </div>

            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 16px", marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a", marginBottom: 6 }}>Next Steps</div>
              <ol style={{ paddingLeft: 16, fontSize: 12, color: "#374151", lineHeight: 1.7 }}>
                <li>Download and print the PDF form below.</li>
                <li>Sign the Patient signature block.</li>
                <li>Have your current caregiver acknowledge by signing their block.</li>
                <li>Submit the signed form to your nearest AMINA District Health Office (DHO).</li>
                <li>The admin team will assign a new caregiver and notify you.</li>
              </ol>
            </div>

            <button
              onClick={downloadPDF}
              style={{
                width: "100%", padding: "11px 0", borderRadius: 10, border: "none",
                background: "#0f172a", color: "#fff", fontWeight: 700, fontSize: 14,
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Download Transfer Form (PDF)
            </button>
          </>)}
        </div>
      </div>
    </div>
  );
}

// ── Invite Code Modal ─────────────────────────────────────────────────────────
function InviteCodeModal({ token, onClose }) {
  const [code, setCode]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied]   = useState(false);
  const [error, setError]     = useState("");

  const generate = async () => {
    setLoading(true); setError("");
    try {
      const r = await fetch(`${API}/api/v1/caregiver/invite`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ permissions: ["vitals", "medications", "consultations", "alerts"], note: "" }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || "Failed to generate code");
      setCode(d.invite_code);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const copy = () => {
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.6)",
      backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: "#fff", borderRadius: 20, width: "min(100%,420px)",
        boxShadow: "0 24px 60px rgba(0,0,0,.25)", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ background: "linear-gradient(135deg,#1e1b4b,#312e81)", padding: "22px 24px" }}>
          <div style={{ color: "#a5b4fc", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 4 }}>
            AMINA Care Programme
          </div>
          <div style={{ color: "#fff", fontWeight: 800, fontSize: 18 }}>Invite a Caregiver</div>
          <div style={{ color: "#818cf8", fontSize: 13, marginTop: 3 }}>
            Share this code with someone you trust — family member, CHW, or doctor.
          </div>
        </div>

        <div style={{ padding: "24px" }}>
          {!code ? (
            <>
              <p style={{ fontSize: 13, color: "#64748b", lineHeight: 1.6, marginBottom: 20 }}>
                Generate a one-time 6-character code. The caregiver uses it to register and get access to your health summary, vitals, medications, and consultations.
              </p>
              <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "12px 14px", marginBottom: 20, fontSize: 12, color: "#166534" }}>
                <strong>Permissions granted:</strong> View vitals, medications, consultations &amp; alerts. They cannot edit your data.
              </div>
              {error && (
                <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", color: "#ef4444", fontSize: 13, marginBottom: 14 }}>
                  {error}
                </div>
              )}
              <button
                onClick={generate} disabled={loading}
                style={{
                  width: "100%", padding: "12px 0", borderRadius: 10, border: "none",
                  background: "linear-gradient(135deg,#6366f1,#818cf8)",
                  color: "#fff", fontWeight: 700, fontSize: 14, cursor: loading ? "default" : "pointer",
                  opacity: loading ? .7 : 1,
                }}
              >
                {loading ? "Generating…" : "Generate Invite Code"}
              </button>
            </>
          ) : (
            <>
              <div style={{ textAlign: "center", marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 10 }}>
                  Your Invite Code
                </div>
                <div style={{
                  fontSize: 40, fontWeight: 900, letterSpacing: 10,
                  color: "#4f46e5", background: "#eef2ff",
                  borderRadius: 14, padding: "20px 24px",
                  border: "2px solid #c7d2fe", fontFamily: "monospace",
                }}>
                  {code}
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 10 }}>
                  Valid for 24 hours · One-time use
                </div>
              </div>
              <div style={{ background: "#fefce8", border: "1px solid #fde68a", borderRadius: 10, padding: "12px 14px", marginBottom: 16, fontSize: 12, color: "#92400e" }}>
                Share this code with your caregiver. They go to <strong>AMINA → Caregiver Login → Register with Invite Code</strong> and enter it to link to your account.
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  onClick={copy}
                  style={{
                    flex: 1, padding: "11px 0", borderRadius: 10,
                    border: "1.5px solid #c7d2fe", background: copied ? "#f0fdf4" : "#eef2ff",
                    color: copied ? "#15803d" : "#4f46e5", fontWeight: 700, fontSize: 13, cursor: "pointer",
                  }}
                >
                  {copied ? "✓ Copied!" : "Copy Code"}
                </button>
                <button
                  onClick={generate}
                  style={{
                    flex: 1, padding: "11px 0", borderRadius: 10,
                    border: "1.5px solid #e2e8f0", background: "#fff",
                    color: "#64748b", fontWeight: 600, fontSize: 13, cursor: "pointer",
                  }}
                >
                  New Code
                </button>
              </div>
              <button
                onClick={onClose}
                style={{
                  width: "100%", marginTop: 10, padding: "11px 0", borderRadius: 10, border: "none",
                  background: "linear-gradient(135deg,#6366f1,#818cf8)",
                  color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer",
                }}
              >
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PatientSidebar({ patient, token, onLogout, onNewChat, onSwitchThread, onDeleteThread, threads, sessionId, collapsed, onToggle, onFindCaregiver, onOpenPrivacy }) {
  const [history, setHistory]           = useState(null);
  const [loading, setLoading]           = useState(false);
  const [showCgChat, setShowCgChat]     = useState(false);
  const [cgUnread, setCgUnread]         = useState(0);
  const [cgId, setCgId]                 = useState(null);
  const [cgName, setCgName]             = useState(null);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showInviteModal, setShowInviteModal]     = useState(false);
  // Two-click confirm for the destructive "clear previous visits"
  // action. Mirrors the chat-clear button pattern used in App.jsx so
  // the UX is consistent — first click arms, second click within 3 s
  // actually hits the DELETE endpoint.
  const [clearPending, setClearPending] = useState(false);
  const [clearBusy,    setClearBusy]    = useState(false);
  const [clearNotice,  setClearNotice]  = useState("");
  const clearTimerRef = useRef(null);

  const refreshHistory = () => {
    if (!patient?.id || !token) return;
    setLoading(true);
    fetch(`${API}/api/v1/agent/patients/${patient.id}/history`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(d => { setHistory(d); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { refreshHistory(); /* eslint-disable-next-line */ }, [patient?.id, token]);

  // Destructive clear-history handler. Calls the patient-scoped
  // DELETE /agent/patients/{id}/history endpoint that wipes every
  // ConsultationRecord for this patient and resets the visit counter,
  // then re-fetches the sidebar history so the "(N)" count drops.
  const handleClearHistory = async () => {
    if (clearBusy) return;
    if ((history?.consultations || []).length === 0) {
      setClearNotice("No visits to clear");
      setTimeout(() => setClearNotice(""), 1800);
      return;
    }
    if (!clearPending) {
      setClearPending(true);
      setClearNotice("Click again to clear");
      try { clearTimeout(clearTimerRef.current); } catch { /* noop */ }
      clearTimerRef.current = setTimeout(() => {
        setClearPending(false);
        setClearNotice("");
      }, 3000);
      return;
    }
    setClearBusy(true);
    setClearPending(false);
    try {
      const r = await fetch(
        `${API}/api/v1/agent/patients/${encodeURIComponent(patient.id)}/history`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const j = r.ok ? await r.json().catch(() => ({})) : {};
      const n = Number.isFinite(j.deleted) ? j.deleted : null;
      if (r.ok) {
        setClearNotice(
          n != null
            ? `Cleared ${n} visit${n === 1 ? "" : "s"}`
            : "Visit history cleared",
        );
        refreshHistory();
      } else {
        setClearNotice("Clear failed — try again");
      }
    } catch {
      setClearNotice("Clear failed — check connection");
    } finally {
      setClearBusy(false);
      setTimeout(() => setClearNotice(""), 2800);
    }
  };

  // Load caregiver ID + poll unread count badge
  useEffect(() => {
    if (!token) return;
    let interval;
    const loadCg = async () => {
      try {
        const r = await fetch(`${API}/api/v1/patient/my-caregiver`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) return;
        const d = await r.json();
        setCgId(d.caregiver_id);
        setCgName(d.name || null);
      } catch { /* no caregiver */ }
    };
    const pollUnread = async (cgid) => {
      if (!cgid) return;
      try {
        const r = await fetch(
          `${API}/api/v1/direct-chat/unread-count?partner_id=${encodeURIComponent(cgid)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (r.ok) { const d = await r.json(); setCgUnread(d.unread || 0); }
      } catch { /* ignore */ }
    };
    loadCg().then(() => {
      interval = setInterval(() => { if (cgId) pollUnread(cgId); }, 8000);
    });
    return () => clearInterval(interval);
  }, [token, cgId]);

  if (!patient) return null;

  const profile = history?.patient || patient;
  const consultations = history?.consultations || [];
  const memories = history?.memories || [];
  const keyFacts = profile.key_facts || [];

  return (<>
    {collapsed && (
      <button className="sidebar-open-btn" onClick={onToggle} title="Open patient sidebar">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
      </button>
    )}
    <div className={`patient-sidebar ${collapsed ? "collapsed" : ""}`}>
      <button className="sidebar-close-btn" onClick={onToggle} title="Close sidebar">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>

      {/* Patient profile card */}
      <div className="sidebar-profile">
        <div className="sidebar-avatar">
          {(profile.name || "?")[0].toUpperCase()}
        </div>
        <div className="sidebar-name">{profile.name || "Patient"}</div>
        <div className="sidebar-meta">
          {profile.age ? `${profile.age}y` : ""}{" "}
          {profile.gender === "female" ? "\u2640" : profile.gender === "male" ? "\u2642" : ""}{" "}
          {profile.region || ""}
        </div>
        {profile.conditions && profile.conditions.length > 0 && (
          <div className="sidebar-conditions">
            {profile.conditions.map((c, i) => (
              <span key={i} className="sidebar-condition-tag">{c}</span>
            ))}
          </div>
        )}
        {profile.medications && profile.medications.length > 0 && (
          <div className="sidebar-meds">
            {(Array.isArray(profile.medications) ? profile.medications : []).map((m, i) => (
              <span key={i} className="sidebar-med-tag">
                {typeof m === "object" ? m.name : m}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Key facts */}
      {keyFacts.length > 0 && (
        <div className="sidebar-section">
          <h4 className="sidebar-section-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            Key Facts
          </h4>
          <ul className="sidebar-facts">
            {keyFacts.slice(0, 6).map((f, i) => (
              <li key={i} className={f.startsWith("Committed") ? "fact-commitment" : ""}>
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Conversations — local threads (last 5) */}
      <div className="sidebar-section">
        <h4 className="sidebar-section-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          Conversations
        </h4>

        {(!threads || threads.length === 0) ? (
          <div className="sidebar-empty">No conversations yet. Start chatting!</div>
        ) : (
          <div className="sidebar-visits">
            {threads.map((t) => {
              const isActive = t.sessionId === sessionId;
              const msgCount = (t.messages || []).length;
              const dateStr = t.updatedAt ? new Date(t.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
              return (
                <div
                  key={t.sessionId}
                  className={`sidebar-visit-card${isActive ? " visit-active" : ""}`}
                  style={{
                    cursor: "pointer", position: "relative",
                    background: isActive ? "rgba(99,102,241,0.12)" : undefined,
                    border: isActive ? "1px solid rgba(129,140,248,0.4)" : undefined,
                  }}
                  onClick={() => !isActive && onSwitchThread && onSwitchThread(t)}
                >
                  <div className="visit-date" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>{dateStr}{msgCount > 0 && <span style={{ marginLeft: 6, fontSize: 10, color: "#94a3b8" }}>{msgCount} msgs</span>}</span>
                    {isActive && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 999, background: "rgba(99,102,241,0.25)", color: "#c7d2fe", fontWeight: 700 }}>ACTIVE</span>}
                  </div>
                  <div className="visit-summary" style={{ fontSize: 12.5, lineHeight: 1.4 }}>{t.title || "New conversation"}</div>
                  {t.triageLevel && (
                    <span className={`visit-triage triage-${(t.triageLevel || "").toLowerCase()}`}>
                      {t.triageLevel}
                    </span>
                  )}
                  {!isActive && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onDeleteThread && onDeleteThread(t.sessionId); }}
                      title="Remove conversation"
                      style={{
                        position: "absolute", top: 6, right: 6,
                        width: 18, height: 18, padding: 0,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: "rgba(255,255,255,0.04)", border: "1px solid rgba(148,163,184,0.2)",
                        borderRadius: "50%", color: "#64748b", cursor: "pointer",
                        opacity: 0.5, transition: "opacity 150ms",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.color = "#ef4444"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; e.currentTarget.style.color = "#64748b"; }}
                    >
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Older visits from backend */}
      <div className="sidebar-section">
        <h4 className="sidebar-section-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
            Previous Visits ({consultations.length})
          </span>
          <button type="button" onClick={handleClearHistory} disabled={clearBusy}
            title={clearPending ? "Click again to clear" : "Clear visit history"}
            style={{
              width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center",
              padding: 0, border: `1px solid ${clearPending ? "#ef4444" : "rgba(148,163,184,0.35)"}`,
              borderRadius: "50%", background: clearPending ? "rgba(239,68,68,0.18)" : "rgba(255,255,255,0.04)",
              color: clearPending ? "#ef4444" : "#94a3b8", cursor: clearBusy ? "progress" : "pointer",
              opacity: clearBusy ? 0.5 : 1, transition: "all 160ms ease",
            }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
          </button>
        </h4>
        {clearNotice && (
          <div role="status" style={{ margin: "4px 0 8px", padding: "5px 9px", borderRadius: 6,
            background: clearPending ? "rgba(239,68,68,0.08)" : "rgba(52,211,153,0.08)",
            border: `1px solid ${clearPending ? "rgba(239,68,68,0.35)" : "rgba(52,211,153,0.35)"}`,
            color: clearPending ? "#ef4444" : "#34d399", fontSize: 11, fontWeight: 600 }}>
            {clearNotice}
          </div>
        )}
        {loading ? (
          <div className="sidebar-loading">Loading history...</div>
        ) : consultations.length === 0 ? (
          <div className="sidebar-empty" style={{ fontSize: 11, color: "#64748b" }}>No older visits recorded.</div>
        ) : (
          <div className="sidebar-visits">
            {consultations.map((c, i) => (
              <div key={i} className="sidebar-visit-card" style={{ opacity: 0.75 }}>
                <div className="visit-date">{c.date || "Unknown date"}</div>
                <div className="visit-summary" style={{ fontSize: 11.5 }}>{c.summary || "No summary available"}</div>
                {c.triage_level && (
                  <span className={`visit-triage triage-${(c.triage_level || "").toLowerCase()}`}>{c.triage_level}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="sidebar-actions">
        <button className="sidebar-btn sidebar-btn-new" onClick={onNewChat}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
          New Conversation
        </button>

        {/* Find a Caregiver */}
        <button
          className="sidebar-btn"
          onClick={onFindCaregiver}
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
            background: "linear-gradient(135deg,rgba(99,102,241,.12),rgba(129,140,248,.08))",
            border: "1.5px solid rgba(99,102,241,.35)", color: "#818cf8",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            Find a Caregiver
          </span>
          <span style={{ fontSize: 10, background: "rgba(99,102,241,.2)", color: "#818cf8", borderRadius: 10, padding: "1px 7px", fontWeight: 700 }}>New</span>
        </button>

        {/* Invite a Caregiver (private invite code) */}
        <button
          className="sidebar-btn"
          onClick={() => setShowInviteModal(true)}
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
            background: "linear-gradient(135deg,rgba(16,185,129,.1),rgba(5,150,105,.06))",
            border: "1.5px solid rgba(16,185,129,.35)", color: "#065f46",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="8.5" cy="7" r="4"/>
              <line x1="20" y1="8" x2="20" y2="14"/>
              <line x1="23" y1="11" x2="17" y2="11"/>
            </svg>
            Invite a Caregiver
          </span>
          <span style={{ fontSize: 10, background: "rgba(16,185,129,.15)", color: "#065f46", borderRadius: 10, padding: "1px 7px", fontWeight: 700 }}>Code</span>
        </button>

        {/* Privacy & Data Sharing (DHIS2 consent + referrals) */}
        <button
          className="sidebar-btn"
          onClick={onOpenPrivacy}
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
            background: "linear-gradient(135deg,rgba(124,58,237,.12),rgba(167,139,250,.08))",
            border: "1.5px solid rgba(124,58,237,.35)", color: "#6d28d9",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              <path d="M9 12l2 2 4-4"/>
            </svg>
            Privacy &amp; Data
          </span>
          <span style={{ fontSize: 10, background: "rgba(124,58,237,.15)", color: "#6d28d9", borderRadius: 10, padding: "1px 7px", fontWeight: 700 }}>New</span>
        </button>

        {/* Chat with Caregiver */}
        <button
          className="sidebar-btn"
          onClick={() => { setShowCgChat(true); setCgUnread(0); }}
          style={{
            background: cgUnread > 0 ? "#f0fdf4" : "#fff",
            border: `1.5px solid ${cgUnread > 0 ? "#10b981" : "#e5e7eb"}`,
            color: cgUnread > 0 ? "#065f46" : "#374151",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: 8, position: "relative",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            Chat with Caregiver
          </span>
          {cgUnread > 0 && (
            <span style={{
              background: "#10b981", color: "#fff", borderRadius: "50%",
              width: 20, height: 20, fontSize: 11, fontWeight: 700,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              {cgUnread > 9 ? "9+" : cgUnread}
            </span>
          )}
        </button>

        {/* Request Caregiver Transfer — only shown when linked to a caregiver */}
        {cgId && (
          <button
            className="sidebar-btn"
            onClick={() => setShowTransferModal(true)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
              background: "linear-gradient(135deg,rgba(239,68,68,.08),rgba(220,38,38,.04))",
              border: "1.5px solid rgba(239,68,68,.3)", color: "#dc2626",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <polyline points="16 3 22 3 22 9"/>
                <path d="M22 3l-6 6"/>
              </svg>
              Request Transfer
            </span>
            <span style={{ fontSize: 10, background: "rgba(239,68,68,.12)", color: "#dc2626", borderRadius: 10, padding: "1px 7px", fontWeight: 700 }}>Admin</span>
          </button>
        )}

        <button className="sidebar-btn sidebar-btn-logout" onClick={onLogout}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          Sign Out
        </button>
      </div>
    </div>

    {/* Caregiver Chat modal */}
    {showCgChat && (
      <CaregiverChat
        token={token}
        patientName={patient?.name}
        onClose={() => setShowCgChat(false)}
      />
    )}

    {/* Transfer Request modal */}
    {showTransferModal && (
      <TransferRequestModal
        patient={patient}
        token={token}
        cgId={cgId}
        cgName={cgName}
        onClose={() => setShowTransferModal(false)}
      />
    )}

    {/* Invite Code modal */}
    {showInviteModal && (
      <InviteCodeModal
        token={token}
        onClose={() => setShowInviteModal(false)}
      />
    )}
  </>);
}
