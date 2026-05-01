/**
 * CaregiverRegistrationWizard — multi-step registration for Gambian
 * community health worker roles: VHW, CHN, Family, Scout, CBC, TBA, Alkalo.
 *
 * 6 steps: Role → Personal info → Credentials → Privacy consent →
 *          PIN + Review → Confirmation
 *
 * Privacy step (step index 3) is wired in Phase 4. Its payload is
 * stashed in wizard state and forwarded to /caregiver-v2/register
 * as `privacy_consent`. Backend stores the pass-through field via
 * `registration_data` (no backend signature change required).
 */

import { useState, useRef } from "react";

import CaregiverPrivacyConsentStep from "../CaregiverPrivacyConsentStep";

const API = ((typeof window !== "undefined" && window.AMINA_API) || "http://localhost:8000")
  .replace(/\/+$/, "");

const INP = {
  width: "100%", boxSizing: "border-box",
  padding: "11px 13px",
  background: "rgba(15, 23, 42, 0.75)",
  border: "1px solid rgba(148, 163, 184, 0.30)",
  borderRadius: 10,
  color: "#f1f5f9", fontSize: 14, fontFamily: "inherit", outline: "none",
};

const BTN = {
  width: "100%", padding: "12px 16px",
  background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
  color: "#fff", border: "none", borderRadius: 10,
  fontSize: 14, fontWeight: 800, cursor: "pointer",
  boxShadow: "0 10px 24px rgba(99, 102, 241, 0.35)",
};

const BTN_GHOST = {
  width: "100%", padding: "11px 16px",
  background: "transparent",
  color: "#94a3b8", border: "1px solid rgba(148, 163, 184, 0.25)", borderRadius: 10,
  fontSize: 13, fontWeight: 600, cursor: "pointer",
};

const REGIONS = [
  "Greater Banjul", "West Coast", "North Bank", "Lower River",
  "Central River", "Upper River", "Kanifing",
];

const LANGUAGES = ["Mandinka", "Wolof", "Fula", "Jola", "Serahuli", "Manjago", "English"];

const RELATIONSHIPS = [
  { value: "spouse", label: "Spouse" },
  { value: "child", label: "Child" },
  { value: "parent", label: "Parent" },
  { value: "sibling", label: "Sibling" },
  { value: "grandchild", label: "Grandchild" },
  { value: "chw", label: "CHW / VHW" },
  { value: "friend", label: "Friend" },
  { value: "other", label: "Other" },
];

const ROLES = [
  {
    id: "vhw", icon: "🏥", label: "Village Health Worker",
    desc: "Selected by the Alkalo to serve as the village's primary health link. Completed the MoH 60-session training.",
  },
  {
    id: "chn", icon: "🩺", label: "Community Health Nurse",
    desc: "Formal health worker attached to a health facility. Supervises VHWs across a circuit of villages.",
  },
  {
    id: "family", icon: "👨‍👩‍👧", label: "Family Caregiver",
    desc: "Family member caring for a patient. Register with an invite code from your patient.",
  },
  {
    id: "scout", icon: "🌟", label: "Youth Health Scout",
    desc: "Young volunteer (15-25) helping elders with health readings and community health education.",
  },
  {
    id: "cbc", icon: "🤱", label: "Community Birth Companion",
    desc: "Community-selected birth companion supporting mothers through pregnancy and delivery.",
  },
  {
    id: "tba", icon: "👶", label: "Traditional Birth Attendant",
    desc: "Experienced traditional birth attendant with community recognition.",
  },
  {
    id: "alkalo", icon: "👑", label: "Village Head (Alkalo)",
    desc: "Village head with oversight of community health workers. Confirms VHW registrations.",
  },
];


function Field({ label, children, span = 1 }) {
  return (
    <label style={{ display: "block", gridColumn: `span ${span}`, marginBottom: 12 }}>
      <span style={{
        display: "block", fontSize: 11, fontWeight: 700, letterSpacing: 0.4,
        textTransform: "uppercase", color: "#94a3b8", marginBottom: 6,
      }}>{label}</span>
      {children}
    </label>
  );
}


function Err({ children }) {
  if (!children) return null;
  return (
    <div style={{
      padding: "9px 12px", marginBottom: 10,
      background: "rgba(248, 113, 113, 0.12)",
      border: "1px solid rgba(248, 113, 113, 0.40)",
      color: "#fecaca", borderRadius: 8,
      fontSize: 12, fontWeight: 600,
    }}>{children}</div>
  );
}


function StepIndicator({ current, total }) {
  return (
    <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 20 }}>
      {Array.from({ length: total }, (_, i) => (
        <div key={i} style={{
          width: i === current ? 28 : 10, height: 4, borderRadius: 2,
          background: i <= current
            ? "linear-gradient(135deg, #8b5cf6, #6366f1)"
            : "rgba(148, 163, 184, 0.2)",
          transition: "width 200ms ease, background 200ms ease",
        }} />
      ))}
    </div>
  );
}


function UploadField({ label, docKey, uploads, setUploads }) {
  const ref = useRef(null);
  const file = uploads[docKey];
  return (
    <Field label={label}>
      <input type="file" ref={ref} accept=".jpg,.jpeg,.png,.pdf"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) setUploads((u) => ({ ...u, [docKey]: f }));
        }}
      />
      <button type="button"
        onClick={() => ref.current?.click()}
        style={{
          ...INP, cursor: "pointer", textAlign: "left",
          color: file ? "#a78bfa" : "#64748b",
          border: file
            ? "1px solid rgba(139, 92, 246, 0.4)"
            : "1px solid rgba(148, 163, 184, 0.30)",
        }}>
        {file ? `✓ ${file.name} (${(file.size / 1024).toFixed(0)} KB)` : "Tap to upload (JPG, PNG, or PDF — max 5 MB)"}
      </button>
    </Field>
  );
}


// ── Step 1: Role Selection ────────────────────────────────────────────

function StepRole({ role, setRole, onNext }) {
  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", marginBottom: 4, textAlign: "center" }}>
        What is your role?
      </div>
      <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 18, textAlign: "center" }}>
        Select the role that best describes you
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {ROLES.map((r) => (
          <button key={r.id} type="button"
            onClick={() => { setRole(r.id); }}
            style={{
              padding: "14px 16px", borderRadius: 12, cursor: "pointer",
              background: role === r.id ? "rgba(99, 102, 241, 0.15)" : "rgba(15, 23, 42, 0.5)",
              border: role === r.id
                ? "1.5px solid rgba(139, 92, 246, 0.6)"
                : "1px solid rgba(148, 163, 184, 0.15)",
              textAlign: "left", display: "flex", gap: 12, alignItems: "flex-start",
              transition: "border 150ms, background 150ms",
            }}>
            <span style={{ fontSize: 22, lineHeight: "1" }}>{r.icon}</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{r.label}</div>
              <div style={{ fontSize: 11.5, color: "#94a3b8", lineHeight: 1.4, marginTop: 2 }}>
                {r.desc}
              </div>
            </div>
          </button>
        ))}
      </div>
      <div style={{ marginTop: 16 }}>
        <button style={{ ...BTN, opacity: role ? 1 : 0.5 }} disabled={!role} onClick={onNext}>
          Continue
        </button>
      </div>
    </div>
  );
}


// ── Step 2: Personal Information ──────────────────────────────────────

function StepPersonal({ data, setData, role, onNext, onBack }) {
  const needsVillage = ["vhw", "cbc", "tba", "scout", "alkalo"].includes(role);
  const needsRegion = role !== "family";
  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", marginBottom: 14, textAlign: "center" }}>
        Personal Information
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
        <Field label="Full name" span={2}>
          <input style={INP} value={data.full_name || ""}
            onChange={(e) => setData({ ...data, full_name: e.target.value })}
            placeholder="Fatou Jallow" />
        </Field>
        <Field label="Phone" span={2}>
          <div style={{ display: "flex", gap: 8 }}>
            <select style={{ ...INP, flex: "0 0 150px" }}
              value={data._cc || "+220"}
              onChange={(e) => setData({ ...data, _cc: e.target.value })}>
              <option value="+220">🇬🇲 Gambia (+220)</option>
              <option value="+91">🇮🇳 India (+91)</option>
              <option value="+1">🇺🇸 USA (+1)</option>
            </select>
            <input style={{ ...INP, flex: 1 }}
              value={data._phone_local || ""}
              onChange={(e) => setData({ ...data, _phone_local: e.target.value.replace(/\D/g, "") })}
              placeholder="3110001" />
          </div>
        </Field>
        {needsVillage && (
          <Field label="Village" span={needsRegion ? 1 : 2}>
            <input style={INP} value={data.village || ""}
              onChange={(e) => setData({ ...data, village: e.target.value })}
              placeholder="Jambur" />
          </Field>
        )}
        {needsRegion && (
          <Field label="Health region" span={needsVillage ? 1 : 2}>
            <select style={INP} value={data.health_region || ""}
              onChange={(e) => setData({ ...data, health_region: e.target.value })}>
              <option value="">— Select region —</option>
              {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
        )}
        {role !== "family" && (
          <Field label="Languages spoken" span={2}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {LANGUAGES.map((lang) => {
                const sel = (data.languages_spoken || []).includes(lang);
                return (
                  <button key={lang} type="button"
                    onClick={() => {
                      const cur = data.languages_spoken || [];
                      setData({
                        ...data,
                        languages_spoken: sel ? cur.filter((l) => l !== lang) : [...cur, lang],
                      });
                    }}
                    style={{
                      padding: "5px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                      border: sel ? "1px solid rgba(139, 92, 246, 0.5)" : "1px solid rgba(148, 163, 184, 0.2)",
                      background: sel ? "rgba(99, 102, 241, 0.15)" : "transparent",
                      color: sel ? "#a78bfa" : "#94a3b8", cursor: "pointer",
                    }}>
                    {lang}
                  </button>
                );
              })}
            </div>
          </Field>
        )}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button style={BTN_GHOST} onClick={onBack}>Back</button>
        <button style={{ ...BTN, opacity: data.full_name && data._phone_local ? 1 : 0.5 }}
          disabled={!data.full_name || !data._phone_local} onClick={onNext}>
          Continue
        </button>
      </div>
    </div>
  );
}


// ── Step 3: Credentials (role-dependent) ──────────────────────────────

function StepCredentials({ data, setData, role, uploads, setUploads, onNext, onBack }) {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 30 }, (_, i) => currentYear - i);

  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", marginBottom: 14, textAlign: "center" }}>
        {role === "family" ? "Patient Connection" : "Credentials & Experience"}
      </div>

      {/* VHW / CBC / TBA */}
      {["vhw", "cbc", "tba"].includes(role) && (
        <>
          <Field label="Who is your village Alkalo?">
            <input style={INP} value={data.alkalo_name || ""}
              onChange={(e) => setData({ ...data, alkalo_name: e.target.value })}
              placeholder="Alkalo Saidou Ceesay" />
          </Field>
          <Field label={`Years as ${role === "vhw" ? "VHW" : role === "cbc" ? "CBC" : "TBA"}`}>
            <input style={INP} type="number" value={data.years_experience ?? ""}
              onChange={(e) => setData({ ...data, years_experience: parseInt(e.target.value) || 0 })} />
          </Field>
          {role !== "tba" && (
            <>
              <Field label="Completed MoH 60-session training?">
                <div style={{ display: "flex", gap: 10 }}>
                  {[true, false].map((v) => (
                    <button key={String(v)} type="button"
                      onClick={() => setData({ ...data, training_completed: v })}
                      style={{
                        flex: 1, padding: "10px", borderRadius: 8, fontSize: 13, fontWeight: 700,
                        border: data.training_completed === v
                          ? "1.5px solid rgba(139, 92, 246, 0.6)"
                          : "1px solid rgba(148, 163, 184, 0.2)",
                        background: data.training_completed === v ? "rgba(99, 102, 241, 0.12)" : "transparent",
                        color: data.training_completed === v ? "#a78bfa" : "#94a3b8",
                        cursor: "pointer",
                      }}>
                      {v ? "Yes" : "No"}
                    </button>
                  ))}
                </div>
              </Field>
              {data.training_completed && (
                <Field label="Training year">
                  <select style={INP} value={data.training_year || ""}
                    onChange={(e) => setData({ ...data, training_year: parseInt(e.target.value) || 0 })}>
                    <option value="">— Select year —</option>
                    {years.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </Field>
              )}
            </>
          )}
          <UploadField label="Training certificate" docKey="training_certificate" uploads={uploads} setUploads={setUploads} />
          <UploadField label="Photo ID" docKey="photo_id" uploads={uploads} setUploads={setUploads} />
        </>
      )}

      {/* CHN */}
      {role === "chn" && (
        <>
          <Field label="Health facility name">
            <input style={INP} value={data.facility_name || ""}
              onChange={(e) => setData({ ...data, facility_name: e.target.value })}
              placeholder="Brikama Health Centre" />
          </Field>
          <Field label="MoH Employee ID">
            <input style={INP} value={data.employee_id || ""}
              onChange={(e) => setData({ ...data, employee_id: e.target.value })}
              placeholder="MOH-XXXXX" />
          </Field>
          <UploadField label="Nursing qualification" docKey="nursing_qualification" uploads={uploads} setUploads={setUploads} />
          <UploadField label="Photo ID" docKey="photo_id" uploads={uploads} setUploads={setUploads} />
        </>
      )}

      {/* Family */}
      {role === "family" && (
        <>
          <div style={{
            padding: "10px 12px", borderRadius: 10, marginBottom: 14,
            background: "rgba(99, 102, 241, 0.10)",
            border: "1px solid rgba(129, 140, 248, 0.35)",
            color: "#c7d2fe", fontSize: 12.5, lineHeight: 1.5,
          }}>
            Ask your patient to open their dashboard and tap "Invite Caregiver"
            to get a 6-character invite code, or skip this step and an admin
            will review your registration manually.
          </div>
          <Field label="Patient invite code (6 characters) — optional">
            <input style={INP} value={data.patient_invite_code || ""}
              onChange={(e) => setData({ ...data, patient_invite_code: e.target.value.toUpperCase().slice(0, 6) })}
              placeholder="AB12CD" maxLength={6} />
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
              Leave blank if you don't have one — admin approval still applies.
            </div>
          </Field>
          <Field label="Relationship to patient — optional">
            <select style={INP} value={data.relationship || ""}
              onChange={(e) => setData({ ...data, relationship: e.target.value })}>
              <option value="">— Select —</option>
              {RELATIONSHIPS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
              You can tell the admin during review if you skip this.
            </div>
          </Field>
          <Field label="Can you read English?">
            <div style={{ display: "flex", gap: 10 }}>
              {[true, false].map((v) => (
                <button key={String(v)} type="button"
                  onClick={() => setData({ ...data, can_read_english: v })}
                  style={{
                    flex: 1, padding: "10px", borderRadius: 8, fontSize: 13, fontWeight: 700,
                    border: data.can_read_english === v
                      ? "1.5px solid rgba(139, 92, 246, 0.6)"
                      : "1px solid rgba(148, 163, 184, 0.2)",
                    background: data.can_read_english === v ? "rgba(99, 102, 241, 0.12)" : "transparent",
                    color: data.can_read_english === v ? "#a78bfa" : "#94a3b8",
                    cursor: "pointer",
                  }}>
                  {v ? "Yes" : "No"}
                </button>
              ))}
            </div>
          </Field>
        </>
      )}

      {/* Scout */}
      {role === "scout" && (
        <>
          <Field label="Your age">
            <input style={INP} type="number" value={data.age ?? ""}
              onChange={(e) => setData({ ...data, age: parseInt(e.target.value) || 0 })}
              placeholder="Must be 15-25" />
          </Field>
          {data.age && data.age < 18 && (
            <>
              <Field label="Guardian name">
                <input style={INP} value={data.guardian_name || ""}
                  onChange={(e) => setData({ ...data, guardian_name: e.target.value })}
                  placeholder="Parent or guardian full name" />
              </Field>
              <Field label="Guardian phone">
                <input style={INP} value={data.guardian_phone || ""}
                  onChange={(e) => setData({ ...data, guardian_phone: e.target.value })}
                  placeholder="+220XXXXXXX" />
              </Field>
            </>
          )}
          <Field label="School name (optional)">
            <input style={INP} value={data.school_name || ""}
              onChange={(e) => setData({ ...data, school_name: e.target.value })}
              placeholder="Gambia Senior Secondary School" />
          </Field>
        </>
      )}

      {/* Alkalo */}
      {role === "alkalo" && (
        <>
          <Field label="Years as Alkalo">
            <input style={INP} type="number" value={data.years_experience ?? ""}
              onChange={(e) => setData({ ...data, years_experience: parseInt(e.target.value) || 0 })} />
          </Field>
          <Field label="District">
            <input style={INP} value={data.district || ""}
              onChange={(e) => setData({ ...data, district: e.target.value })}
              placeholder="Kombo North" />
          </Field>
          <Field label="VDC Chairman name (optional)">
            <input style={INP} value={data.vdc_chairman_name || ""}
              onChange={(e) => setData({ ...data, vdc_chairman_name: e.target.value })} />
          </Field>
          <UploadField label="Photo ID" docKey="photo_id" uploads={uploads} setUploads={setUploads} />
        </>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button style={BTN_GHOST} onClick={onBack}>Back</button>
        <button style={BTN} onClick={onNext}>Continue</button>
      </div>
    </div>
  );
}


// ── Step 4 (NEW): Privacy consent wrapper ─────────────────────────────
//
// Thin wrapper around CaregiverPrivacyConsentStep that:
//   • supplies the registered name from earlier wizard state, so the
//     digital-signature match works;
//   • on accept, stashes the emitted payload and advances the wizard;
//   • offers a Back button consistent with the other steps.
//
// Privacy: we never log the payload. The signature is hashed
// server-side (Phase 2 service); the wizard simply passes the payload
// through to /caregiver-v2/register.
function StepPrivacyConsent({ caregiverName, role, onComplete, onBack }) {
  return (
    <div>
      <CaregiverPrivacyConsentStep
        caregiverName={caregiverName}
        role={role}
        onComplete={onComplete}
        onCancel={onBack}
      />
    </div>
  );
}


// ── Read-only consent summary (rendered on the review step) ──────────
//
// Shows the user that consent was captured, without re-rendering any
// PHI-adjacent fields. We deliberately do NOT show the typed signature
// or the checkbox prose — only safe flags. Clicking "View full notice
// again" opens NoticeReviewModal below in disabled (read-only) mode.
function ConsentSummary({ consent, role, onViewNotice }) {
  if (!consent) return null;
  const isScout = (role || "").toLowerCase() === "scout";
  return (
    <div style={{
      padding: 14, borderRadius: 10, marginBottom: 14,
      background: "rgba(34, 197, 94, 0.08)",
      border: "1px solid rgba(34, 197, 94, 0.30)",
    }}>
      <div style={{
        fontSize: 11, fontWeight: 800, color: "#86efac",
        textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10,
      }}>
        Privacy consent
      </div>
      <Row label="Status" value="✓ Accepted" />
      <Row label="Notice version" value={consent.notice_version || "—"} />
      <Row
        label="Acknowledgements"
        value={`${consent.checkbox_count} of ${consent.checkbox_count} ticked`}
      />
      <Row
        label="Mandinka summary"
        value={consent.mandinka_viewed ? "Viewed" : "Not viewed"}
      />
      <Row label="Method" value={consent.method || "app"} />
      {isScout && (
        <Row
          label="Guardian consent"
          value={consent.guardian_consent ? "Provided" : "Missing"}
        />
      )}
      <button
        type="button"
        onClick={onViewNotice}
        style={{
          ...BTN_GHOST, marginTop: 10, padding: "8px 12px", fontSize: 12,
        }}
      >
        View full notice again
      </button>
    </div>
  );
}


// ── "View full notice again" modal — reuses Phase 3 component in
// disabled (read-only) mode. The component already supports
// `disabled={true}`: notice scroll + Mandinka toggle work, but every
// interactive consent control (checkboxes, signature input, accept
// button) is locked. No notice content is duplicated.
function NoticeReviewModal({ caregiverName, role, onClose }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Privacy notice — read-only review"
      style={{
        position: "fixed", inset: 0, zIndex: 9000,
        background: "rgba(2, 6, 23, 0.78)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 640, maxHeight: "92vh",
          overflowY: "auto",
          background: "rgba(15, 23, 42, 0.98)",
          border: "1px solid rgba(148, 163, 184, 0.30)",
          borderRadius: 14, padding: 16,
          boxShadow: "0 24px 60px rgba(0, 0, 0, 0.5)",
        }}
      >
        <div style={{
          display: "flex", justifyContent: "space-between",
          alignItems: "center", marginBottom: 10,
        }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#e2e8f0" }}>
            Privacy notice (read-only)
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ ...BTN_GHOST, width: "auto", padding: "6px 12px", fontSize: 12 }}
          >
            Close
          </button>
        </div>
        <CaregiverPrivacyConsentStep
          caregiverName={caregiverName}
          role={role}
          disabled={true}
          onCancel={onClose}
        />
      </div>
    </div>
  );
}


// ── Step 5: PIN + Review ──────────────────────────────────────────────

function StepReview({
  data, role, uploads, pin, setPin, confirmed, setConfirmed,
  onSubmit, onBack, busy, error, uploadErrors, privacyConsent, onViewNotice,
}) {
  const roleLabel = ROLES.find((r) => r.id === role)?.label || role;
  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", marginBottom: 14, textAlign: "center" }}>
        Review & Create PIN
      </div>

      {/* Summary */}
      <div style={{
        padding: 14, borderRadius: 10, marginBottom: 14,
        background: "rgba(15, 23, 42, 0.6)",
        border: "1px solid rgba(148, 163, 184, 0.15)",
      }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: "#a78bfa", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
          Registration Summary
        </div>
        <Row label="Role" value={roleLabel} />
        <Row label="Name" value={data.full_name} />
        <Row label="Phone" value={`${data._cc || "+220"}${data._phone_local || ""}`} />
        {data.village && <Row label="Village" value={data.village} />}
        {data.health_region && <Row label="Region" value={data.health_region} />}
        {data.languages_spoken?.length > 0 && (
          <Row label="Languages" value={data.languages_spoken.join(", ")} />
        )}
        {data.alkalo_name && <Row label="Alkalo" value={data.alkalo_name} />}
        {data.facility_name && <Row label="Facility" value={data.facility_name} />}
        {data.employee_id && <Row label="Employee ID" value={data.employee_id} />}
        {data.patient_invite_code && <Row label="Invite code" value={data.patient_invite_code} />}
        {data.relationship && <Row label="Relationship" value={data.relationship} />}
        {data.age && <Row label="Age" value={data.age} />}
        {data.years_experience > 0 && <Row label="Experience" value={`${data.years_experience} years`} />}
        {Object.keys(uploads).length > 0 && (
          <Row label="Documents" value={Object.keys(uploads).map((k) => uploads[k]?.name || k).join(", ")} />
        )}
      </div>

      {/* Read-only privacy-consent summary (Phase 4) */}
      <ConsentSummary
        consent={privacyConsent}
        role={role}
        onViewNotice={onViewNotice}
      />

      {/* PIN */}
      <Field label="Choose a 4-digit PIN">
        <input style={{ ...INP, textAlign: "center", letterSpacing: 12, fontSize: 22, fontWeight: 800 }}
          type="password" value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          placeholder="• • • •" maxLength={4} />
      </Field>

      {/* Confirm */}
      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 14, cursor: "pointer" }}>
        <input type="checkbox" checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          style={{ marginTop: 3, accentColor: "#8b5cf6" }} />
        <span style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.5 }}>
          I confirm this information is correct and I understand my account
          requires approval before I can access patient data.
        </span>
      </label>

      <Err>{error}</Err>

      {/* BUG-021 fix: surface per-document upload failures so the
          caregiver can retry instead of seeing a fake success screen. */}
      {uploadErrors && uploadErrors.length > 0 && (
        <div style={{
          background: "#2a1a1a", border: "1px solid #d85a30",
          borderRadius: 8, padding: 14, margin: "12px 0",
        }}>
          <div style={{ color: "#d85a30", fontWeight: 700, marginBottom: 6, fontSize: 13 }}>
            Some documents did not upload:
          </div>
          {uploadErrors.map((err, i) => (
            <div key={i} style={{ color: "#ff9999", margin: "3px 0", fontSize: 12 }}>
              • {err.field}{err.fileName ? ` (${err.fileName})` : ""}: {err.error}
            </div>
          ))}
          <div style={{ color: "#999", fontSize: 11, marginTop: 6 }}>
            Tap "Register" again to retry the failed uploads.
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        <button style={BTN_GHOST} onClick={onBack} disabled={busy}>Back</button>
        <button
          style={{
            ...BTN,
            opacity: pin.length === 4 && confirmed && !busy ? 1 : 0.5,
            cursor: busy ? "not-allowed" : "pointer",
          }}
          disabled={pin.length !== 4 || !confirmed || busy}
          onClick={onSubmit}>
          {busy ? "Submitting…" : `Register as ${roleLabel}`}
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12.5 }}>
      <span style={{ color: "#64748b", fontWeight: 600 }}>{label}</span>
      <span style={{ color: "#e2e8f0", fontWeight: 500, textAlign: "right", maxWidth: "60%" }}>{value}</span>
    </div>
  );
}


// ── Step 6: Confirmation ──────────────────────────────────────────────

function StepConfirmation({ regId, role, phone, onDone }) {
  const roleLabel = ROLES.find((r) => r.id === role)?.label || role;
  const timeout = { vhw: 14, cbc: 14, chn: 7, tba: 14, family: 3, scout: 7, alkalo: 14 }[role] || 14;

  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginBottom: 6 }}>
        Registration Submitted!
      </div>
      <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6, marginBottom: 20 }}>
        Your application to join AMINA as a <strong style={{ color: "#a78bfa" }}>{roleLabel}</strong> has been received.
        We will review it within <strong style={{ color: "#e2e8f0" }}>{timeout} days</strong>.
      </div>

      <div style={{
        padding: 16, borderRadius: 12, marginBottom: 18,
        background: "rgba(99, 102, 241, 0.08)",
        border: "1px solid rgba(99, 102, 241, 0.25)",
      }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: "#64748b", textTransform: "uppercase", marginBottom: 6 }}>
          Your registration ID
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, color: "#a78bfa", letterSpacing: 2 }}>
          {regId}
        </div>
      </div>

      <div style={{
        padding: 12, borderRadius: 10,
        background: "rgba(34, 197, 94, 0.08)",
        border: "1px solid rgba(34, 197, 94, 0.25)",
        color: "#86efac", fontSize: 12.5, lineHeight: 1.5, marginBottom: 18,
      }}>
        We will SMS you at <strong>{phone}</strong> when your account is approved.
        {role === "family" && (
          <><br />Your patient will receive a notification to confirm your relationship.</>
        )}
      </div>

      <button style={BTN} onClick={onDone}>Done</button>
    </div>
  );
}


// ── Main Wizard ───────────────────────────────────────────────────────

export default function CaregiverRegistrationWizard({ onDone }) {
  // Internal step indices (0-based):
  //   0 = Role, 1 = Personal, 2 = Credentials,
  //   3 = Privacy consent (Phase 4), 4 = PIN + Review, 5 = Confirmation
  const [step, setStep]                 = useState(0);
  const [role, setRole]                 = useState("");
  const [data, setData]                 = useState({ _cc: "+220" });
  const [uploads, setUploads]           = useState({});
  const [pin, setPin]                   = useState("");
  const [confirmed, setConfirmed]       = useState(false);
  const [busy, setBusy]                 = useState(false);
  const [error, setError]               = useState("");
  const [regId, setRegId]               = useState("");
  const [uploadErrors, setUploadErrors] = useState([]);   // BUG-021
  const [privacyConsent, setPrivacyConsent] = useState(null);
  const [showNoticeModal, setShowNoticeModal] = useState(false);

  // BUG-022 fix: synchronous double-submit lock. React state updates
  // are batched, so a second click landing in the same microtask sees
  // busy=false. A ref update is synchronous and closes that window.
  const submitLockRef = useRef(false);

  const phone = `${data._cc || "+220"}${data._phone_local || ""}`;

  async function handleSubmit() {
    if (submitLockRef.current || busy) return;
    submitLockRef.current = true;
    setBusy(true); setError(""); setUploadErrors([]);
    try {
      // Adapter (Phase 4): forward the captured consent payload in the
      // shape the Phase 3 step emits, plus a server-side timestamp.
      // The signature is hashed by the Phase 2 backend service before
      // storage; we never log or store the raw value here.
      const consentForBackend = privacyConsent
        ? {
            ...privacyConsent,
            consent_timestamp: new Date().toISOString(),
          }
        : null;

      const body = {
        role,
        full_name: data.full_name,
        phone,
        pin,
        village: data.village || undefined,
        health_region: data.health_region || undefined,
        alkalo_name: data.alkalo_name || undefined,
        years_experience: data.years_experience || undefined,
        training_completed: data.training_completed ?? undefined,
        training_year: data.training_year || undefined,
        languages_spoken: data.languages_spoken || undefined,
        facility_name: data.facility_name || undefined,
        employee_id: data.employee_id || undefined,
        patient_invite_code: data.patient_invite_code || undefined,
        relationship: data.relationship || undefined,
        can_read_english: data.can_read_english ?? undefined,
        age: data.age || undefined,
        guardian_name: data.guardian_name || undefined,
        guardian_phone: data.guardian_phone || undefined,
        school_name: data.school_name || undefined,
        district: data.district || undefined,
        vdc_chairman_name: data.vdc_chairman_name || undefined,
        privacy_consent: consentForBackend || undefined,
      };

      const r = await fetch(`${API}/api/v1/caregiver-v2/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await r.json().catch(() => ({}));
      if (!r.ok) {
        const errs = result.detail?.errors || [result.detail || "Registration failed"];
        setError(Array.isArray(errs) ? errs.join("; ") : String(errs));
        return;  // finally{} resets busy + lock
      }

      const rid = result.registration_id;
      setRegId(rid);

      // BUG-021 fix: previously every upload error was swallowed via
      // `.catch(() => {})`, so a CHW could see "registration successful"
      // while their identity / training docs never made it to the
      // server. Surface failures into uploadErrors and DO NOT advance
      // to the success screen if any uploads failed.
      const failures = [];
      for (const [docKey, file] of Object.entries(uploads)) {
        if (!file) continue;
        const fd = new FormData();
        fd.append("doc_key", docKey);
        fd.append("file", file);
        try {
          const upR = await fetch(`${API}/api/v1/caregiver-v2/upload-doc/${rid}`, {
            method: "POST",
            body: fd,
          });
          if (!upR.ok) {
            let detail = `${upR.status} ${upR.statusText}`;
            try {
              const j = await upR.json();
              if (j && j.detail) detail = String(j.detail).slice(0, 200);
            } catch (_) { /* non-JSON body */ }
            failures.push({ field: docKey, fileName: file.name, error: detail });
          }
        } catch (upErr) {
          failures.push({
            field: docKey,
            fileName: file.name,
            error: "Upload failed -- check your internet connection and try again.",
          });
          // eslint-disable-next-line no-console
          console.error(`[UPLOAD] ${docKey} failed:`, upErr.message || upErr);
        }
      }

      if (failures.length > 0) {
        setUploadErrors(failures);
        setError(
          `Registration saved but ${failures.length} document upload` +
          `${failures.length === 1 ? "" : "s"} failed. Please retry the uploads.`
        );
        // Stay on the current step; do NOT show the success screen.
        return;
      }

      setStep(5);
    } catch (e) {
      setError(e.message || "Network error");
    } finally {
      submitLockRef.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      {step < 5 && <StepIndicator current={step} total={5} />}
      {step === 0 && (
        <StepRole role={role} setRole={setRole} onNext={() => setStep(1)} />
      )}
      {step === 1 && (
        <StepPersonal data={data} setData={setData} role={role}
          onNext={() => setStep(2)} onBack={() => setStep(0)} />
      )}
      {step === 2 && (
        <StepCredentials data={data} setData={setData} role={role}
          uploads={uploads} setUploads={setUploads}
          onNext={() => setStep(3)} onBack={() => setStep(1)} />
      )}
      {step === 3 && (
        <StepPrivacyConsent
          caregiverName={data.full_name || ""}
          role={role}
          onComplete={(payload) => {
            setPrivacyConsent(payload);
            setStep(4);
          }}
          onBack={() => setStep(2)}
        />
      )}
      {step === 4 && (
        <StepReview data={data} role={role} uploads={uploads}
          pin={pin} setPin={setPin}
          confirmed={confirmed} setConfirmed={setConfirmed}
          onSubmit={handleSubmit} onBack={() => setStep(3)}
          busy={busy} error={error} uploadErrors={uploadErrors}
          privacyConsent={privacyConsent}
          onViewNotice={() => setShowNoticeModal(true)} />
      )}
      {step === 5 && (
        <StepConfirmation regId={regId} role={role} phone={phone}
          onDone={() => onDone ? onDone() : window.location.hash = "#/"} />
      )}
      {showNoticeModal && (
        <NoticeReviewModal
          caregiverName={data.full_name || ""}
          role={role}
          onClose={() => setShowNoticeModal(false)}
        />
      )}
    </>
  );
}
