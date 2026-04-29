/**
 * CaregiverDirectory — patient-facing caregiver browse + application flow
 *
 * Props:
 *   token        {string}  patient JWT
 *   patient      {object}  { id, name, phone, age, gender, region, conditions, medications }
 *   onClose      {fn}      close the directory overlay
 */

import { useEffect, useState, useCallback } from "react";

const API = (window.AMINA_API || "http://localhost:8000").replace(/\/+$/, "");

function authH(token) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:        "#f8fafc",
  card:      "#ffffff",
  border:    "#e2e8f0",
  accent:    "#6366f1",
  accentBg:  "#eef2ff",
  green:     "#10b981",
  greenBg:   "#f0fdf4",
  text:      "#0f172a",
  muted:     "#64748b",
  subtle:    "#94a3b8",
  danger:    "#ef4444",
};

// Region labels
const REGIONS = {
  banjul: "Banjul Metro",
  wcr:    "West Coast Region",
  nbr:    "North Bank Region",
  lrr:    "Lower River Region",
  crr:    "Central River Region",
  urr:    "Upper River Region",
};

// Specialty colour map
const SPEC_COLORS = {
  "Maternal & Child Health":      { bg: "#fdf4ff", border: "#e879f9", text: "#a21caf" },
  "Chronic Disease Management":   { bg: "#eff6ff", border: "#60a5fa", text: "#1d4ed8" },
  "HIV/AIDS & Infectious Disease":{ bg: "#fff7ed", border: "#fb923c", text: "#c2410c" },
  "Elderly Care & Palliative Support": { bg: "#f0fdf4", border: "#4ade80", text: "#15803d" },
  "Nutrition, WASH & Malnutrition":    { bg: "#fefce8", border: "#facc15", text: "#a16207" },
  "Community Mental Health":           { bg: "#f0f9ff", border: "#38bdf8", text: "#0369a1" },
  "Reproductive & Sexual Health":      { bg: "#fff1f2", border: "#fb7185", text: "#be123c" },
  "Paediatric & School Health":        { bg: "#f5f3ff", border: "#a78bfa", text: "#6d28d9" },
};

function specStyle(s) {
  return SPEC_COLORS[s] || { bg: "#f8fafc", border: "#94a3b8", text: "#475569" };
}

// ── Caregiver card ─────────────────────────────────────────────────────────────
function CaregiverCard({ cg, onApply, myApplication }) {
  const ss = specStyle(cg.specialization);
  const applied = myApplication?.caregiver_id === cg.caregiver_id;
  const appStatus = applied ? myApplication.status : null;

  return (
    <div style={{
      background: C.card, borderRadius: 16,
      border: `1px solid ${applied ? C.accent : C.border}`,
      boxShadow: applied ? `0 0 0 2px ${C.accent}30` : "0 1px 4px rgba(0,0,0,.06)",
      overflow: "hidden", display: "flex", flexDirection: "column",
      transition: "box-shadow .2s, border-color .2s",
    }}>
      {/* Header */}
      <div style={{ padding: "20px 20px 0" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 12 }}>
          {/* Avatar */}
          <div style={{
            width: 52, height: 52, borderRadius: 14, flexShrink: 0,
            background: `linear-gradient(135deg,${ss.border},${ss.text})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontWeight: 800, fontSize: 20,
          }}>
            {cg.name.split(" ").map(w => w[0]).join("").slice(0, 2)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: C.text, marginBottom: 3 }}>{cg.name}</div>
            <div style={{
              display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600,
              background: ss.bg, border: `1px solid ${ss.border}`, color: ss.text,
            }}>{cg.specialization}</div>
          </div>
        </div>

        {/* Bio */}
        <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, margin: "0 0 12px", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {cg.bio}
        </p>

        {/* Tags */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 12 }}>
          {(cg.specialty_tags || []).slice(0, 4).map(t => (
            <span key={t} style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 12, background: ss.bg, color: ss.text }}>
              {t}
            </span>
          ))}
        </div>
      </div>

      {/* Meta strip */}
      <div style={{
        display: "flex", gap: 0,
        borderTop: `1px solid ${C.border}`, marginTop: "auto",
      }}>
        {[
          { label: "Region",      value: REGIONS[cg.region] || cg.region?.toUpperCase() },
          { label: "Experience",  value: `${cg.years_experience} yrs` },
          { label: "Languages",   value: (cg.languages || []).join(", ") },
        ].map((item, i) => (
          <div key={i} style={{
            flex: 1, padding: "10px 12px",
            borderRight: i < 2 ? `1px solid ${C.border}` : "none",
          }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: C.subtle, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 2 }}>{item.label}</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.text, lineHeight: 1.3 }}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* Action button */}
      <div style={{ padding: "12px 16px", borderTop: `1px solid ${C.border}` }}>
        {appStatus === "accepted" ? (
          <div style={{ textAlign: "center", color: C.green, fontWeight: 700, fontSize: 13 }}>
            ✓ Application Accepted — this caregiver will contact you
          </div>
        ) : appStatus === "pending" ? (
          <div style={{ textAlign: "center", color: C.accent, fontWeight: 600, fontSize: 12 }}>
            ⏳ Application Pending — awaiting caregiver response
          </div>
        ) : appStatus === "declined" ? (
          <div style={{ textAlign: "center", color: C.danger, fontWeight: 600, fontSize: 12 }}>
            ✕ Application Declined — you may apply to another caregiver
          </div>
        ) : (
          <button
            onClick={() => onApply(cg)}
            style={{
              width: "100%", padding: "10px 0", borderRadius: 10, border: "none",
              background: `linear-gradient(135deg,${C.accent},#818cf8)`,
              color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer",
              transition: "opacity .15s",
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = ".88"}
            onMouseLeave={e => e.currentTarget.style.opacity = "1"}
          >
            Apply to {cg.name.split(" ")[0]}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Application form modal ─────────────────────────────────────────────────────
function ApplicationForm({ caregiver, patient, token, onSuccess, onClose }) {
  const [form, setForm] = useState({
    primary_concern:         "",
    health_conditions:       patient?.conditions?.join(", ") || "",
    current_medications:     patient?.medications?.join(", ") || "",
    preferred_contact:       "phone",
    emergency_contact_name:  "",
    emergency_contact_phone: "",
    additional_notes:        "",
    patient_full_name:       patient?.name || "",
    patient_age:             patient?.age ? String(patient.age) : "",
    patient_gender:          patient?.gender || "",
    patient_region:          patient?.region || "",
    patient_phone:           patient?.phone || "",
  });
  const [step, setStep]           = useState(1);  // 1=form 2=review 3=submitted
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted]   = useState(null);
  const [error, setError]           = useState("");

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const validate = () => {
    if (!form.primary_concern.trim())
      return "Please describe your primary health concern.";
    if (!form.emergency_contact_name.trim())
      return "Please provide an emergency contact name.";
    if (!form.emergency_contact_phone.trim())
      return "Please provide an emergency contact phone number.";
    return null;
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) { setError(err); return; }
    setError("");
    setSubmitting(true);
    try {
      const r = await fetch(`${API}/api/v1/cg-apply/apply`, {
        method: "POST",
        headers: authH(token),
        body: JSON.stringify({
          caregiver_id:            caregiver.caregiver_id,
          primary_concern:         form.primary_concern,
          health_conditions:       form.health_conditions.split(",").map(s => s.trim()).filter(Boolean),
          current_medications:     form.current_medications.split(",").map(s => s.trim()).filter(Boolean),
          preferred_contact:       form.preferred_contact,
          emergency_contact_name:  form.emergency_contact_name,
          emergency_contact_phone: form.emergency_contact_phone,
          additional_notes:        form.additional_notes,
          patient_full_name:       form.patient_full_name,
          patient_age:             form.patient_age,
          patient_gender:          form.patient_gender,
          patient_region:          form.patient_region,
          patient_phone:           form.patient_phone,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "Submission failed");
      setSubmitted(data);
      setStep(3);
      onSuccess?.(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  // ── PDF generation ───────────────────────────────────────────────────────────
  const generatePDF = (appData) => {
    const f     = appData?.form || {};
    const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
    const html  = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>AMINA Caregiver Application — ${f.app_id || ""}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Georgia', serif; color: #1e293b; background: #fff; padding: 40px; font-size: 13px; line-height: 1.6; }
  @page { size: A4; margin: 25mm 20mm; }
  .header { display: flex; align-items: center; gap: 20px; border-bottom: 3px solid #6366f1; padding-bottom: 18px; margin-bottom: 24px; }
  .logo { width: 48px; height: 48px; background: linear-gradient(135deg,#6366f1,#818cf8); border-radius: 12px; display: flex; align-items: center; justify-content: center; color:#fff; font-weight: 900; font-size: 22px; flex-shrink:0; }
  .title { flex: 1; }
  .title h1 { font-size: 20px; font-weight: 800; color: #1e293b; margin-bottom: 2px; }
  .title p  { font-size: 12px; color: #64748b; }
  .ref-box  { background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px 16px; text-align: right; }
  .ref-box .ref-label { font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: .5px; }
  .ref-box .ref-id    { font-size: 16px; font-weight: 800; color: #6366f1; }
  .section { margin-bottom: 22px; }
  .section-title { font-size: 12px; font-weight: 700; color: #6366f1; text-transform: uppercase; letter-spacing: .8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 12px; }
  table.info { width: 100%; border-collapse: collapse; }
  table.info td { padding: 6px 10px; vertical-align: top; }
  table.info td.label { font-weight: 700; color: #475569; width: 28%; font-size: 12px; }
  table.info td.value { color: #1e293b; }
  table.info tr:nth-child(even) td { background: #f8fafc; }
  .concern-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px; font-style: italic; color: #1e293b; line-height: 1.7; }
  .notes-box   { background: #fefce8; border: 1px solid #fde68a; border-radius: 8px; padding: 14px; color: #1e293b; line-height: 1.7; }
  .sig-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 24px; margin-top: 8px; }
  .sig-block { text-align: center; }
  .sig-role  { font-size: 11px; font-weight: 700; color: #6366f1; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 4px; }
  .sig-name  { font-size: 13px; font-weight: 700; color: #1e293b; margin-bottom: 40px; }
  .sig-line  { border-top: 2px solid #cbd5e1; margin: 0 10px 6px; }
  .sig-label { font-size: 10px; color: #94a3b8; }
  .declaration { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; font-size: 12px; color: #475569; line-height: 1.7; margin-bottom: 20px; }
  .status-chip { display: inline-block; background: #fef9c3; border: 1px solid #fde68a; color: #a16207; border-radius: 20px; padding: 3px 12px; font-size: 11px; font-weight: 700; }
  .footer { border-top: 1px solid #e2e8f0; padding-top: 12px; font-size: 10px; color: #94a3b8; text-align: center; margin-top: 32px; }
</style>
</head><body>
<div class="header">
  <div class="logo">A</div>
  <div class="title">
    <h1>AMINA Care — Caregiver Application Form</h1>
    <p>Republic of The Gambia · Community Health Programme · Formal Application Document</p>
  </div>
  <div class="ref-box">
    <div class="ref-label">Reference</div>
    <div class="ref-id">${f.app_id || "—"}</div>
    <div style="font-size:11px;color:#64748b;margin-top:2px;">${today}</div>
  </div>
</div>

<div class="section">
  <div class="section-title">1. Patient Information</div>
  <table class="info">
    <tr><td class="label">Full Name</td><td class="value">${f.patient_full_name || "—"}</td><td class="label">Patient ID</td><td class="value">${f.patient_id || "—"}</td></tr>
    <tr><td class="label">Age</td><td class="value">${f.patient_age || "—"}</td><td class="label">Gender</td><td class="value">${f.patient_gender || "—"}</td></tr>
    <tr><td class="label">Region</td><td class="value">${f.patient_region || "—"}</td><td class="label">Contact</td><td class="value">${f.patient_phone || "—"}</td></tr>
  </table>
</div>

<div class="section">
  <div class="section-title">2. Requested Caregiver</div>
  <table class="info">
    <tr><td class="label">Name</td><td class="value">${f.caregiver_name || "—"}</td><td class="label">Caregiver ID</td><td class="value">${f.caregiver_id || "—"}</td></tr>
    <tr><td class="label">Specialization</td><td class="value">${f.caregiver_specialization || "—"}</td><td class="label">Region</td><td class="value">${(f.caregiver_region || "").toUpperCase() || "—"}</td></tr>
  </table>
</div>

<div class="section">
  <div class="section-title">3. Clinical Background</div>
  <table class="info">
    <tr><td class="label">Health Conditions</td><td class="value" colspan="3">${(f.health_conditions || []).join(", ") || "None declared"}</td></tr>
    <tr><td class="label">Current Medications</td><td class="value" colspan="3">${(f.current_medications || []).join(", ") || "None declared"}</td></tr>
    <tr><td class="label">Preferred Contact</td><td class="value" colspan="3">${f.preferred_contact || "—"}</td></tr>
  </table>
</div>

<div class="section">
  <div class="section-title">4. Reason for Application</div>
  <div class="concern-box">${f.primary_concern || "—"}</div>
</div>

${f.additional_notes ? `
<div class="section">
  <div class="section-title">5. Additional Notes</div>
  <div class="notes-box">${f.additional_notes}</div>
</div>` : ""}

<div class="section">
  <div class="section-title">${f.additional_notes ? "6" : "5"}. Emergency Contact</div>
  <table class="info">
    <tr><td class="label">Name</td><td class="value">${f.emergency_contact_name || "—"}</td><td class="label">Phone</td><td class="value">${f.emergency_contact_phone || "—"}</td></tr>
  </table>
</div>

<div class="section">
  <div class="section-title">Declaration</div>
  <div class="declaration">
    I, <strong>${f.patient_full_name || "the patient"}</strong>, hereby apply to be enrolled under the care of
    <strong>${f.caregiver_name || "the above-named caregiver"}</strong> through the AMINA Community Health Programme.
    I confirm that all information provided in this form is accurate and complete to the best of my knowledge.
    I understand that my health information will be accessible to my assigned caregiver in accordance with the
    programme's data protection policy and that I may withdraw consent at any time by contacting the district health office.
  </div>

  <div class="sig-grid">
    <div class="sig-block">
      <div class="sig-role">Patient</div>
      <div class="sig-name">${f.patient_full_name || "—"}</div>
      <div class="sig-line"></div>
      <div class="sig-label">Signature &amp; Date</div>
    </div>
    <div class="sig-block">
      <div class="sig-role">Caregiver</div>
      <div class="sig-name">${f.caregiver_name || "—"}</div>
      <div class="sig-line"></div>
      <div class="sig-label">Signature &amp; Date</div>
    </div>
    <div class="sig-block">
      <div class="sig-role">Supervising Authority</div>
      <div class="sig-name">District Health Officer</div>
      <div class="sig-line"></div>
      <div class="sig-label">Signature, Stamp &amp; Date</div>
    </div>
  </div>
</div>

<div class="footer">
  AMINA Care Programme · Ministry of Health, Republic of The Gambia · Application ref: ${f.app_id || "—"} · Generated ${today}
  <br/>This document must be signed by all three parties and submitted to the district health office within 30 days.
</div>
</body></html>`;

    const win = window.open("", "_blank", "width=860,height=1100");
    if (!win) { alert("Please allow pop-ups for this site to download the form."); return; }
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 600);
  };

  // ── Render steps ─────────────────────────────────────────────────────────────
  const FieldLabel = ({ text, required }) => (
    <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 5 }}>
      {text}{required && <span style={{ color: C.danger }}> *</span>}
    </div>
  );

  const Input = ({ value, onChange, placeholder, type = "text", disabled }) => (
    <input type={type} value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder} disabled={disabled}
      style={{
        width: "100%", padding: "9px 12px", borderRadius: 8,
        border: `1px solid ${C.border}`, background: disabled ? "#f8fafc" : "#fff",
        fontSize: 13, color: C.text, outline: "none",
        fontFamily: "inherit",
      }}
    />
  );

  const Textarea = ({ value, onChange, placeholder, rows = 3 }) => (
    <textarea value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder} rows={rows}
      style={{
        width: "100%", padding: "9px 12px", borderRadius: 8,
        border: `1px solid ${C.border}`, background: "#fff",
        fontSize: 13, color: C.text, outline: "none",
        fontFamily: "inherit", resize: "vertical",
      }}
    />
  );

  const Select = ({ value, onChange, children }) => (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{
        width: "100%", padding: "9px 12px", borderRadius: 8,
        border: `1px solid ${C.border}`, background: "#fff",
        fontSize: 13, color: C.text, outline: "none", fontFamily: "inherit",
      }}
    >
      {children}
    </select>
  );

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 800,
      background: "rgba(0,0,0,.6)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      padding: "5vh 16px", overflowY: "auto",
    }}>
      <div style={{
        background: C.card, borderRadius: 20, width: "100%", maxWidth: 640,
        boxShadow: "0 24px 80px rgba(0,0,0,.25)", overflow: "hidden",
      }}>
        {/* Modal header */}
        <div style={{
          background: "linear-gradient(135deg,#1e1b4b,#312e81)",
          padding: "24px 28px", position: "relative",
        }}>
          <button onClick={onClose} style={{
            position: "absolute", top: 16, right: 16,
            background: "rgba(255,255,255,.1)", border: "none", borderRadius: 8,
            color: "#fff", width: 32, height: 32, cursor: "pointer", fontSize: 16,
          }}>✕</button>
          <div style={{ color: "#c7d2fe", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 6 }}>
            Caregiver Application
          </div>
          <div style={{ color: "#fff", fontWeight: 800, fontSize: 18 }}>Apply to {caregiver.name}</div>
          <div style={{ color: "#a5b4fc", fontSize: 13, marginTop: 4 }}>{caregiver.specialization}</div>

          {/* Steps */}
          <div style={{ display: "flex", gap: 6, marginTop: 18 }}>
            {["Details", "Review", "Done"].map((label, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{
                  width: 24, height: 24, borderRadius: "50%",
                  background: step > i + 1 ? C.green : step === i + 1 ? "#fff" : "rgba(255,255,255,.2)",
                  color: step > i + 1 ? "#fff" : step === i + 1 ? C.accent : "rgba(255,255,255,.5)",
                  fontSize: 11, fontWeight: 800,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {step > i + 1 ? "✓" : i + 1}
                </div>
                <span style={{ fontSize: 11, color: step === i + 1 ? "#fff" : "rgba(255,255,255,.5)", fontWeight: step === i + 1 ? 700 : 400 }}>
                  {label}
                </span>
                {i < 2 && <div style={{ width: 24, height: 1, background: "rgba(255,255,255,.2)" }} />}
              </div>
            ))}
          </div>
        </div>

        {/* Step 1 — Form */}
        {step === 1 && (
          <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 18 }}>

            <div style={{ background: C.accentBg, borderRadius: 10, padding: "12px 16px", fontSize: 12, color: C.accent, fontWeight: 600 }}>
              Fill in the details below. Your information is pre-filled from your profile where available — please review and correct if needed.
            </div>

            {/* Patient details */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <FieldLabel text="Full Name" required />
                <Input value={form.patient_full_name} onChange={v => set("patient_full_name", v)} placeholder="Your full name" />
              </div>
              <div>
                <FieldLabel text="Phone Number" required />
                <Input value={form.patient_phone} onChange={v => set("patient_phone", v)} placeholder="+220..." />
              </div>
              <div>
                <FieldLabel text="Age" />
                <Input value={form.patient_age} onChange={v => set("patient_age", v)} placeholder="e.g. 34" />
              </div>
              <div>
                <FieldLabel text="Gender" />
                <Input value={form.patient_gender} onChange={v => set("patient_gender", v)} placeholder="e.g. Female" />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <FieldLabel text="Region / Village" />
                <Input value={form.patient_region} onChange={v => set("patient_region", v)} placeholder="e.g. Brikama, WCR" />
              </div>
            </div>

            {/* Clinical */}
            <div>
              <FieldLabel text="Primary reason for seeking a dedicated caregiver" required />
              <Textarea value={form.primary_concern} onChange={v => set("primary_concern", v)}
                placeholder="Describe your main health concern or why you need caregiver support…" rows={3} />
            </div>

            <div>
              <FieldLabel text="Current health conditions (comma-separated)" />
              <Input value={form.health_conditions} onChange={v => set("health_conditions", v)}
                placeholder="e.g. Hypertension, Type 2 diabetes" />
            </div>

            <div>
              <FieldLabel text="Current medications (comma-separated)" />
              <Input value={form.current_medications} onChange={v => set("current_medications", v)}
                placeholder="e.g. Amlodipine 5mg, Metformin 500mg" />
            </div>

            <div>
              <FieldLabel text="Preferred method of contact" required />
              <Select value={form.preferred_contact} onChange={v => set("preferred_contact", v)}>
                <option value="phone">Phone call</option>
                <option value="sms">SMS message</option>
                <option value="in_person">In-person home visit</option>
              </Select>
            </div>

            {/* Emergency contact */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <FieldLabel text="Emergency contact name" required />
                <Input value={form.emergency_contact_name} onChange={v => set("emergency_contact_name", v)} placeholder="e.g. Fatou Jallow" />
              </div>
              <div>
                <FieldLabel text="Emergency contact phone" required />
                <Input value={form.emergency_contact_phone} onChange={v => set("emergency_contact_phone", v)} placeholder="+220..." />
              </div>
            </div>

            <div>
              <FieldLabel text="Additional notes (optional)" />
              <Textarea value={form.additional_notes} onChange={v => set("additional_notes", v)}
                placeholder="Anything else the caregiver should know…" rows={2} />
            </div>

            {error && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", color: C.danger, fontSize: 13 }}>
                {error}
              </div>
            )}

            <button onClick={() => { const err = validate(); if (err) { setError(err); return; } setError(""); setStep(2); }}
              style={{
                padding: "12px 0", borderRadius: 10, border: "none",
                background: `linear-gradient(135deg,${C.accent},#818cf8)`,
                color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer",
              }}>
              Review Application →
            </button>
          </div>
        )}

        {/* Step 2 — Review */}
        {step === 2 && (
          <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4 }}>Review your application before submitting</div>

            {[
              ["Full Name",           form.patient_full_name],
              ["Phone",               form.patient_phone],
              ["Age / Gender",        `${form.patient_age} / ${form.patient_gender}`],
              ["Region",              form.patient_region],
              ["Primary Concern",     form.primary_concern],
              ["Conditions",          form.health_conditions || "None"],
              ["Medications",         form.current_medications || "None"],
              ["Preferred Contact",   form.preferred_contact],
              ["Emergency Contact",   `${form.emergency_contact_name} — ${form.emergency_contact_phone}`],
            ].map(([label, value]) => (
              <div key={label} style={{ display: "flex", gap: 12, padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ width: 140, flexShrink: 0, fontSize: 12, fontWeight: 700, color: C.muted }}>{label}</div>
                <div style={{ flex: 1, fontSize: 13, color: C.text, lineHeight: 1.5 }}>{value || "—"}</div>
              </div>
            ))}

            <div style={{ background: "#fefce8", border: "1px solid #fde68a", borderRadius: 8, padding: "12px 14px", fontSize: 12, color: "#a16207" }}>
              By submitting this application, you consent to sharing your health information with {caregiver.name} for the purpose of receiving caregiver support through the AMINA programme.
            </div>

            {error && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", color: C.danger, fontSize: 13 }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setStep(1)} style={{
                flex: 1, padding: "11px 0", borderRadius: 10,
                border: `1px solid ${C.border}`, background: "#fff",
                color: C.text, fontWeight: 600, fontSize: 13, cursor: "pointer",
              }}>← Edit</button>
              <button onClick={handleSubmit} disabled={submitting} style={{
                flex: 2, padding: "11px 0", borderRadius: 10, border: "none",
                background: submitting ? "#a5b4fc" : `linear-gradient(135deg,${C.accent},#818cf8)`,
                color: "#fff", fontWeight: 700, fontSize: 13, cursor: submitting ? "default" : "pointer",
              }}>
                {submitting ? "Submitting…" : "Submit Application"}
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — Success */}
        {step === 3 && submitted && (
          <div style={{ padding: "32px 28px", display: "flex", flexDirection: "column", alignItems: "center", gap: 18, textAlign: "center" }}>
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: C.greenBg, border: `2px solid ${C.green}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>
              ✓
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 18, color: C.text, marginBottom: 6 }}>Application Submitted!</div>
              <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6 }}>
                {submitted.message}
              </div>
            </div>
            <div style={{ background: "#f1f5f9", borderRadius: 10, padding: "10px 16px", width: "100%" }}>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 2 }}>Reference number</div>
              <div style={{ fontWeight: 800, fontSize: 16, color: C.accent }}>{submitted.app_id}</div>
            </div>

            <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6 }}>
              Please also download and print the form below. Both you and {caregiver.name} need to sign it along with the district health officer, and submit to the district health office.
            </div>

            <div style={{ display: "flex", gap: 10, width: "100%" }}>
              <button onClick={() => generatePDF(submitted)} style={{
                flex: 1, padding: "12px 0", borderRadius: 10, border: `1px solid ${C.accent}`,
                background: C.accentBg, color: C.accent, fontWeight: 700, fontSize: 13, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Download PDF Form
              </button>
              <button onClick={onClose} style={{
                flex: 1, padding: "12px 0", borderRadius: 10, border: "none",
                background: `linear-gradient(135deg,${C.accent},#818cf8)`,
                color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer",
              }}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Transfer-required modal ────────────────────────────────────────────────────
function TransferRequiredModal({ activeCaregiver, targetCaregiver, onClose, onGoToTransfer }) {
  const steps = [
    {
      n: 1,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
      ),
      title: "Open your Caregiver panel",
      desc: 'In the left sidebar, click "My Caregiver" to view your current care relationship.',
    },
    {
      n: 2,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
          <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
        </svg>
      ),
      title: 'Click "Request Transfer"',
      desc: "You'll find the transfer button at the bottom of your current caregiver's card.",
    },
    {
      n: 3,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
      ),
      title: "Fill out the transfer form",
      desc: "Explain your reason for requesting a transfer. This is reviewed by the AMINA Care team.",
    },
    {
      n: 4,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
      ),
      title: "Apply once transfer is approved",
      desc: "After your transfer is processed, return here to apply to your chosen caregiver.",
    },
  ];

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 900,
      background: "rgba(15,23,42,0.65)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: "#fff", borderRadius: 20, width: "min(100%, 520px)",
        boxShadow: "0 24px 60px rgba(0,0,0,.22)", overflow: "hidden",
        animation: "cgSlideUp .28s cubic-bezier(.34,1.56,.64,1)",
      }}>
        {/* Header */}
        <div style={{
          background: "linear-gradient(135deg,#fef3c7,#fefce8)",
          borderBottom: "1px solid #fde68a",
          padding: "22px 24px 18px",
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12, flexShrink: 0,
              background: "linear-gradient(135deg,#f59e0b,#d97706)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16, color: "#92400e", marginBottom: 4 }}>
                You already have an active caregiver
              </div>
              <div style={{ fontSize: 13, color: "#b45309", lineHeight: 1.5 }}>
                You're currently under the care of <strong>{activeCaregiver?.name || "a caregiver"}</strong>.
                To switch to {targetCaregiver ? <><strong>{targetCaregiver.name}</strong></> : "a new caregiver"},
                you need to request a formal transfer first.
              </div>
            </div>
          </div>
        </div>

        {/* Steps */}
        <div style={{ padding: "20px 24px" }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 14 }}>
            How to switch caregivers
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {steps.map(s => (
              <div key={s.n} style={{
                display: "flex", alignItems: "flex-start", gap: 12,
                padding: "12px 14px", borderRadius: 12,
                background: "#f8fafc", border: "1px solid #e2e8f0",
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 10, flexShrink: 0,
                  background: "linear-gradient(135deg,#6366f1,#4f46e5)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#fff",
                }}>{s.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 2 }}>
                    <span style={{
                      fontSize: 9, fontWeight: 800, color: "#6366f1",
                      background: "#eef2ff", border: "1px solid #c7d2fe",
                      borderRadius: 5, padding: "1px 5px", letterSpacing: ".3px",
                    }}>STEP {s.n}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>{s.title}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div style={{
          display: "flex", gap: 10, padding: "0 24px 22px",
        }}>
          <button onClick={onClose} style={{
            flex: 1, padding: "11px 0", borderRadius: 10,
            border: "1.5px solid #e2e8f0", background: "#fff",
            color: "#64748b", fontWeight: 600, fontSize: 13, cursor: "pointer",
            transition: "all .15s",
          }}
            onMouseEnter={e => { e.currentTarget.style.background = "#f8fafc"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "#fff"; }}
          >
            Keep Browsing
          </button>
          <button onClick={onGoToTransfer} style={{
            flex: 2, padding: "11px 0", borderRadius: 10,
            border: "none", background: "linear-gradient(135deg,#6366f1,#4f46e5)",
            color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
            transition: "filter .15s",
          }}
            onMouseEnter={e => { e.currentTarget.style.filter = "brightness(1.1)"; }}
            onMouseLeave={e => { e.currentTarget.style.filter = "none"; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
            </svg>
            Go to Transfer Request
          </button>
        </div>
      </div>
      <style>{`@keyframes cgSlideUp { from { opacity:0; transform:translateY(18px) scale(.97); } to { opacity:1; transform:translateY(0) scale(1); } }`}</style>
    </div>
  );
}

// ── Main CaregiverDirectory component ─────────────────────────────────────────
export default function CaregiverDirectory({ token, patient, onClose }) {
  const [caregivers, setCaregivers]       = useState([]);
  const [loading, setLoading]             = useState(true);
  const [regionFilter, setRegionFilter]   = useState("");
  const [specFilter, setSpecFilter]       = useState("");
  const [myApps, setMyApps]               = useState([]);
  const [applyTarget, setApplyTarget]     = useState(null);
  const [activeCaregivers, setActiveCaregivers] = useState([]);  // patient's current caregivers
  const [transferBlock, setTransferBlock] = useState(null);      // { activeCaregiver, targetCaregiver }

  const fetchDirectory = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (regionFilter) params.set("region", regionFilter);
      if (specFilter)   params.set("specialty", specFilter);
      const r = await fetch(`${API}/api/v1/cg-apply/directory?${params}`, { headers: authH(token) });
      if (r.ok) setCaregivers((await r.json()).caregivers || []);
    } catch { }
    finally { setLoading(false); }
  }, [token, regionFilter, specFilter]);

  const fetchMyApps = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/v1/cg-apply/my-application`, { headers: authH(token) });
      if (r.ok) setMyApps((await r.json()).applications || []);
    } catch { }
  }, [token]);

  const fetchActiveCaregivers = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/v1/caregiver/list`, { headers: authH(token) });
      if (r.ok) {
        const d = await r.json();
        setActiveCaregivers((d.caregivers || []).filter(cg => !cg.is_revoked));
      }
    } catch { }
  }, [token]);

  useEffect(() => {
    fetchDirectory();
    fetchMyApps();
    fetchActiveCaregivers();
  }, [fetchDirectory, fetchMyApps, fetchActiveCaregivers]);

  // Intercept apply — if patient has an active caregiver, show transfer modal instead
  const handleApply = (caregiver) => {
    if (activeCaregivers.length > 0) {
      setTransferBlock({ activeCaregiver: activeCaregivers[0], targetCaregiver: caregiver });
    } else {
      setApplyTarget(caregiver);
    }
  };

  // Map app by caregiver_id for quick lookup
  const appByCaregiver = {};
  myApps.forEach(a => { appByCaregiver[a.caregiver_id || ""] = a; });

  // Current status card
  const pendingApp = myApps.find(a => a.status === "pending");
  const acceptedApp = myApps.find(a => a.status === "accepted");

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 700,
      background: "#f8fafc", display: "flex", flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{
        background: "linear-gradient(135deg,#1e1b4b,#312e81)",
        padding: "20px 28px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <div>
          <div style={{ color: "#a5b4fc", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 4 }}>
            AMINA Care Programme
          </div>
          <div style={{ color: "#fff", fontWeight: 800, fontSize: 20 }}>Find a Caregiver</div>
          <div style={{ color: "#818cf8", fontSize: 13, marginTop: 2 }}>Browse community health workers and submit a formal application</div>
        </div>
        <button onClick={onClose} style={{
          background: "rgba(255,255,255,.1)", border: "none", borderRadius: 10,
          color: "#fff", padding: "8px 16px", cursor: "pointer", fontWeight: 600, fontSize: 13,
        }}>✕ Close</button>
      </div>

      {/* Status banner */}
      {acceptedApp && (
        <div style={{ background: "#f0fdf4", borderBottom: `1px solid #bbf7d0`, padding: "12px 28px", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 18 }}>✓</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#15803d" }}>Application Accepted</div>
            <div style={{ fontSize: 12, color: "#166534" }}>
              {acceptedApp.caregiver_name} ({acceptedApp.caregiver_specialization}) has accepted your application. They will contact you shortly.
            </div>
          </div>
        </div>
      )}
      {!acceptedApp && pendingApp && (
        <div style={{ background: "#eef2ff", borderBottom: `1px solid #c7d2fe`, padding: "12px 28px", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 18 }}>⏳</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#4338ca" }}>Application Pending</div>
            <div style={{ fontSize: 12, color: "#4f46e5" }}>
              Your application to {pendingApp.caregiver_name} is awaiting their response. Ref: {pendingApp.app_id}
            </div>
          </div>
        </div>
      )}

      {/* Active caregiver notice */}
      {activeCaregivers.length > 0 && (
        <div style={{
          padding: "11px 28px", background: "#fefce8",
          borderBottom: "1px solid #fde68a",
          display: "flex", alignItems: "center", gap: 10,
          fontSize: 13, color: "#92400e", flexShrink: 0,
        }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span>
            You're currently under <strong>{activeCaregivers[0]?.name}</strong>.
            You can browse caregivers, but applying requires a <strong>transfer request</strong> first — clicking Apply will walk you through the steps.
          </span>
        </div>
      )}

      {/* Filters */}
      <div style={{ padding: "16px 28px", background: "#fff", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 12, flexShrink: 0 }}>
        <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, color: C.text, background: "#fff", fontFamily: "inherit" }}>
          <option value="">All Regions</option>
          {Object.entries(REGIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={specFilter} onChange={e => setSpecFilter(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, color: C.text, background: "#fff", fontFamily: "inherit" }}>
          <option value="">All Specializations</option>
          {Object.keys(SPEC_COLORS).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 13, color: C.muted, alignSelf: "center" }}>
          {loading ? "Loading…" : `${caregivers.length} caregiver${caregivers.length !== 1 ? "s" : ""} available`}
        </div>
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
        {loading ? (
          <div style={{ textAlign: "center", color: C.muted, padding: 60 }}>Loading caregivers…</div>
        ) : caregivers.length === 0 ? (
          <div style={{ textAlign: "center", color: C.muted, padding: 60 }}>No caregivers found matching your filters.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 20 }}>
            {caregivers.map(cg => (
              <CaregiverCard
                key={cg.caregiver_id}
                cg={cg}
                onApply={handleApply}
                myApplication={appByCaregiver[cg.caregiver_id]}
              />
            ))}
          </div>
        )}
      </div>

      {/* Application form modal */}
      {applyTarget && (
        <ApplicationForm
          caregiver={applyTarget}
          patient={patient}
          token={token}
          onClose={() => setApplyTarget(null)}
          onSuccess={() => { setApplyTarget(null); fetchMyApps(); }}
        />
      )}

      {/* Transfer-required modal */}
      {transferBlock && (
        <TransferRequiredModal
          activeCaregiver={transferBlock.activeCaregiver}
          targetCaregiver={transferBlock.targetCaregiver}
          onClose={() => setTransferBlock(null)}
          onGoToTransfer={() => { setTransferBlock(null); onClose(); }}
        />
      )}
    </div>
  );
}
