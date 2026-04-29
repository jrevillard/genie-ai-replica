/**
 * ScribeReview — editable SOAP note draft.
 *
 * Displays the auto-generated SOAP sections with edit fields, allows the
 * clinician to sign (optional name), and finalizes → PDF → inbox item.
 *
 * Props:
 *   open:       boolean
 *   session:    current session (with soap_draft populated)
 *   onFinalized: (artifacts) => void    // receives {inbox_item, file_token,...}
 *   onClose:     () => void
 */

import { useEffect, useMemo, useState } from "react";
import * as api from "./scribeApi.js";

export default function ScribeReview({ open, session, onFinalized, onClose }) {
  const initial = useMemo(() => session?.soap_draft || {}, [session]);
  const [title,      setTitle]      = useState(initial.title || "Home visit");
  const [subjective, setSubjective] = useState(initial.subjective || "");
  const [objective,  setObjective]  = useState(initial.objective  || "");
  const [assessment, setAssessment] = useState(initial.assessment || "");
  const [plan,       setPlan]       = useState(initial.plan       || "");
  const [flags,      setFlags]      = useState(Array.isArray(initial.flags) ? initial.flags : []);
  const [signedBy,   setSignedBy]   = useState("");
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState("");

  useEffect(() => {
    // Re-seed on a new session
    setTitle(initial.title || "Home visit");
    setSubjective(initial.subjective || "");
    setObjective(initial.objective || "");
    setAssessment(initial.assessment || "");
    setPlan(initial.plan || "");
    setFlags(Array.isArray(initial.flags) ? initial.flags : []);
    setSignedBy("");
    setError("");
  }, [initial]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape" && !saving) onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, saving, onClose]);

  if (!open || !session) return null;

  const handleSign = async () => {
    setError(""); setSaving(true);
    const r = await api.finalizeSession(session.session_id, {
      title, subjective, objective, assessment, plan, flags,
    }, signedBy);
    setSaving(false);
    if (r._error || !r.ok) {
      setError(r._error || r.detail || "could not save");
      return;
    }
    // Ask inbox to refresh so the new item shows up immediately.
    window.dispatchEvent(new CustomEvent("amina:inbox:refresh"));
    onFinalized?.(r);
  };

  const removeFlag = (i) => setFlags(flags.filter((_, idx) => idx !== i));
  const addFlag = () => {
    const v = (prompt("Add a red-flag / follow-up note") || "").trim();
    if (v) setFlags([...flags, v.slice(0, 120)]);
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose?.(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 9290,
        background: "rgba(15, 23, 42, 0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
        animation: "amina-scribe-fade 180ms ease",
      }}
    >
      <div
        role="dialog"
        aria-label="Review SOAP draft"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(720px, 100%)",
          maxHeight: "92vh",
          display: "flex", flexDirection: "column",
          background: "#fff",
          borderRadius: 16,
          boxShadow: "0 24px 60px rgba(15,23,42,0.45)",
          overflow: "hidden",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          animation: "amina-scribe-zoom 220ms cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        <header style={{
          padding: "16px 20px",
          background: "linear-gradient(135deg, #0f766e, #0891b2)",
          color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Review SOAP draft</div>
            <div style={{ fontSize: 11.5, opacity: 0.85, marginTop: 2 }}>
              Edit anything. Signing saves a PDF into the patient inbox.
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
                  disabled={saving}
                  style={btnClose}>✕</button>
        </header>

        <div style={{ padding: "18px 22px", overflowY: "auto" }}>
          <label style={label}>Visit title</label>
          <input type="text" value={title} onChange={e => setTitle(e.target.value)}
                 style={input} />

          {session.transcript_preview ? (
            <details style={{
              marginTop: 14, background: "#f8fafc",
              border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px",
            }}>
              <summary style={{ cursor: "pointer", fontSize: 12, color: "#475569", fontWeight: 600 }}>
                Show transcript preview
              </summary>
              <div style={{
                marginTop: 8, fontSize: 12, color: "#334155",
                whiteSpace: "pre-wrap", maxHeight: 120, overflowY: "auto",
              }}>{session.transcript_preview}</div>
            </details>
          ) : null}

          <SoapField name="Subjective" value={subjective} onChange={setSubjective} rows={3}
                     hint="What the patient reports — symptoms, concerns, duration, triggers." />
          <SoapField name="Objective"  value={objective}  onChange={setObjective}  rows={3}
                     hint="Observations, vitals, signs. Flag unverified values with {?}." />
          <SoapField name="Assessment" value={assessment} onChange={setAssessment} rows={3}
                     hint="Clinical impression. Provisional only — clinician confirms." />
          <SoapField name="Plan"       value={plan}       onChange={setPlan}       rows={3}
                     hint="Next steps, referrals, meds, follow-up schedule." />

          <label style={label}>Red flags / follow-up</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {flags.length === 0 ? (
              <span style={{ fontSize: 12, color: "#94a3b8" }}>No flags.</span>
            ) : flags.map((f, i) => (
              <span key={i} style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "4px 10px", background: "#fef3c7", color: "#92400e",
                border: "1px solid #fde68a", borderRadius: 999, fontSize: 12,
              }}>
                ⚠ {f}
                <button type="button" onClick={() => removeFlag(i)}
                        aria-label={`Remove flag ${f}`}
                        style={{ border: "none", background: "transparent",
                                 cursor: "pointer", fontSize: 12, color: "#92400e" }}>✕</button>
              </span>
            ))}
            <button type="button" onClick={addFlag}
                    style={{
                      border: "1px dashed #cbd5e1", background: "transparent",
                      color: "#64748b", borderRadius: 999, padding: "4px 10px",
                      fontSize: 12, cursor: "pointer",
                    }}>+ add</button>
          </div>

          <label style={{ ...label, marginTop: 18 }}>Sign as (optional)</label>
          <input type="text" placeholder="Nurse / clinician name"
                 value={signedBy} onChange={e => setSignedBy(e.target.value)}
                 style={input} />

          {error ? (
            <div style={{
              marginTop: 10, padding: "8px 10px",
              background: "#fef2f2", color: "#991b1b",
              borderRadius: 6, fontSize: 12,
            }}>⚠ {error}</div>
          ) : null}
        </div>

        <footer style={{
          padding: "14px 22px", borderTop: "1px solid #e2e8f0",
          display: "flex", justifyContent: "flex-end", gap: 10,
          background: "#f8fafc",
        }}>
          <button type="button" onClick={onClose} disabled={saving}
                  style={btnSecondary}>Back</button>
          <button type="button" onClick={handleSign}
                  disabled={saving || !subjective.trim()}
                  style={saving || !subjective.trim() ? btnPrimaryDisabled : btnPrimary}>
            {saving ? "Saving…" : "Sign & save to inbox"}
          </button>
        </footer>
      </div>

      <style>{`
        @keyframes amina-scribe-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes amina-scribe-zoom {
          from { opacity: 0; transform: scale(0.96) translateY(10px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}


function SoapField({ name, value, onChange, hint, rows = 2 }) {
  return (
    <>
      <label style={{ ...label, marginTop: 14 }}>{name}</label>
      <textarea
        rows={rows}
        value={value}
        placeholder={hint}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...input, resize: "vertical" }}
      />
      <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 3 }}>{hint}</div>
    </>
  );
}


const label = {
  display: "block",
  fontSize: 12.5,
  fontWeight: 600,
  color: "#0f172a",
  marginBottom: 6,
};
const input = {
  width: "100%",
  padding: "9px 11px",
  fontSize: 13,
  fontFamily: "inherit",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  outline: "none",
  background: "#fff",
};
const btnBase = {
  padding: "10px 18px",
  borderRadius: 8,
  fontWeight: 600,
  fontSize: 13,
  border: "none",
  cursor: "pointer",
};
const btnPrimary = {
  ...btnBase,
  background: "linear-gradient(135deg, #0f766e, #14b8a6)",
  color: "#fff",
  boxShadow: "0 2px 6px rgba(20,184,166,0.35)",
};
const btnPrimaryDisabled = {
  ...btnBase,
  background: "#94a3b8",
  color: "#fff",
  cursor: "not-allowed",
};
const btnSecondary = {
  ...btnBase,
  background: "#fff",
  color: "#475569",
  border: "1px solid #cbd5e1",
};
const btnClose = {
  width: 28, height: 28, display: "inline-flex",
  alignItems: "center", justifyContent: "center",
  border: "none", background: "rgba(255,255,255,0.18)",
  color: "#fff", borderRadius: 6, cursor: "pointer",
  fontSize: 13,
};
