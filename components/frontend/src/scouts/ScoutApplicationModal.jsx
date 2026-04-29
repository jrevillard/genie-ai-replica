/**
 * ScoutApplicationModal — Gambian-culturally-aware youth scout
 * application form.
 *
 * Replaces the legacy single-column "Apply to become a scout" modal
 * (App.jsx ~3866) that only captured name/age/village/phone. The new
 * form gives the Alkalo everything they need to match scouts with the
 * RIGHT elders based on where the scout lives and when they are free:
 *
 *   - Full name          (matches the Amina account when possible)
 *   - Age                (12..24 validated client + server)
 *   - Village            (geocode — same as dashboard default)
 *   - Locality / compound — "Kerewan market area", "Compound near mosque"
 *   - Availability       — "After school Mon-Fri", "Weekends only"
 *   - Phone              — Alkalo can call before assigning
 *   - Why you want to be a scout — free-form, shown in the Alkalo inbox
 *
 * On submit we POST /community/scout/apply with the patient JWT so
 * the backend can stamp applicant_id on the application; that id
 * powers the notification chain (application-received → approved →
 * elder-assigned).
 */

import { useCallback, useEffect, useRef, useState } from "react";


const BASE = (() => {
  const raw = (typeof window !== "undefined" && window.__AMINA_API_BASE__)
           || (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_BASE)
           || "http://localhost:8000";
  return String(raw).replace(/\/+$/, "");
})();


function _auth() {
  try {
    const tok = localStorage.getItem("AMINA_TOKEN") || "";
    return tok
      ? { "Authorization": `Bearer ${tok}`, "Content-Type": "application/json" }
      : { "Content-Type": "application/json" };
  } catch {
    return { "Content-Type": "application/json" };
  }
}


function _readPatient() {
  try {
    const raw = localStorage.getItem("AMINA_PATIENT");
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}


const INPUT = {
  padding: "9px 11px",
  border: "1px solid rgba(148, 163, 184, 0.30)",
  borderRadius: 8,
  fontSize: 13,
  background: "rgba(15, 23, 42, 0.85)",
  color: "#f1f5f9",
  fontFamily: "inherit",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};


function Field({ label, hint, children, span = 1 }) {
  return (
    <label style={{ gridColumn: `span ${span}`,
                    display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600,
                     textTransform: "uppercase", letterSpacing: 0.3 }}>
        {label}
      </span>
      {children}
      {hint ? (
        <span style={{ color: "#64748b", fontSize: 10, marginTop: 2,
                       fontStyle: "italic", lineHeight: 1.4 }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}


export default function ScoutApplicationModal({ onClose }) {
  const profile = _readPatient();
  const [name,         setName]         = useState(profile?.name || "");
  const [age,          setAge]          = useState(profile?.age ? String(profile.age) : "");
  const [village,      setVillage]      = useState(profile?.region || "Kerewan");
  const [locality,     setLocality]     = useState("");
  const [availability, setAvailability] = useState("");
  const [phone,        setPhone]        = useState(profile?.phone && !profile.phone.startsWith("nophone_") ? profile.phone : "");
  const [reason,       setReason]       = useState("");

  const [busy,   setBusy]   = useState(false);
  const [error,  setError]  = useState(null);
  const [done,   setDone]   = useState(false);

  // Validation: age 12..24, name + reason required, locality + availability required
  const ageNum = parseInt(age, 10) || 0;
  const ageOk  = ageNum >= 12 && ageNum <= 24;
  const disabled = busy
    || !name.trim()
    || !ageOk
    || !village.trim()
    || !locality.trim()
    || !availability.trim()
    || !reason.trim();

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onCloseRef.current?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = useCallback(async () => {
    if (disabled) return;
    setBusy(true); setError(null);
    try {
      const resp = await fetch(`${BASE}/api/v1/community/scout/apply`, {
        method: "POST",
        credentials: "include",
        headers: _auth(),
        body: JSON.stringify({
          name:         name.trim(),
          age:          ageNum,
          village:      village.trim(),
          phone:        phone.trim(),
          locality:     locality.trim(),
          availability: availability.trim(),
          reason:       reason.trim(),
        }),
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = (body && (body.detail?.message || body.detail || body.message))
                 || "Could not submit application";
        throw new Error(msg);
      }
      setDone(true);
      // Refresh the inbox bell so the ack notification pops promptly.
      try { window.dispatchEvent(new CustomEvent("amina:inbox:refresh")); }
      catch { /* noop */ }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [disabled, name, ageNum, village, phone, locality, availability, reason]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Youth scout application"
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
         style={{
           position: "fixed", inset: 0, zIndex: 10000,
           background: "rgba(15, 23, 42, 0.55)",
           display: "flex", justifyContent: "center", alignItems: "flex-start",
           padding: "4vh 16px",
           fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
         }}>
      <div style={{
        width: "min(640px, 100%)", maxHeight: "92vh",
        background: "#0b1220", borderRadius: 16,
        boxShadow: "0 24px 60px rgba(0, 0, 0, 0.55)",
        overflow: "hidden", display: "flex", flexDirection: "column",
        border: "1px solid rgba(148, 163, 184, 0.15)",
      }}>
        {/* Header */}
        <div style={{
          padding: "16px 20px",
          borderBottom: "1px solid rgba(148, 163, 184, 0.15)",
          color: "#fff",
          display: "flex", alignItems: "flex-start", gap: 12,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: "rgba(251, 191, 36, 0.18)",
            border: "1px solid rgba(251, 191, 36, 0.40)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, flexShrink: 0,
          }}>🏅</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>
              Apply to become a Youth Scout
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4, lineHeight: 1.5 }}>
              Youth Scouts check on elders in their compound and village,
              log BP readings, and earn badges. Your Alkalo will review
              your application and assign elders based on where you live
              and when you are free.
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
                  style={{ width: 30, height: 30, borderRadius: 8, border: "none",
                           background: "rgba(255,255,255,0.06)", color: "#e2e8f0",
                           cursor: "pointer", fontSize: 18, fontWeight: 700,
                           lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: "16px 20px", overflow: "auto", flex: 1,
                      display: "flex", flexDirection: "column", gap: 12 }}>
          {done ? (
            <div style={{
              padding: 22, borderRadius: 12, textAlign: "center",
              background: "rgba(16, 185, 129, 0.12)", color: "#a7f3d0",
              border: "1px solid rgba(52, 211, 153, 0.40)",
            }}>
              <div style={{ fontSize: 32, marginBottom: 6 }}>✓</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#d1fae5" }}>
                Your application is with the Alkalo.
              </div>
              <div style={{ fontSize: 12, marginTop: 6, color: "#a7f3d0",
                            lineHeight: 1.5 }}>
                You will receive a notification when the Alkalo decides.
                Once approved, they will assign elders for you to check on.
              </div>
              <button type="button" onClick={onClose}
                      style={{
                        marginTop: 16, padding: "9px 18px",
                        background: "rgba(15, 23, 42, 0.7)", color: "#e2e8f0",
                        border: "1px solid rgba(148, 163, 184, 0.30)", borderRadius: 8,
                        fontSize: 12, fontWeight: 600, cursor: "pointer",
                      }}>Close</button>
            </div>
          ) : (
            <>
              {error && (
                <div style={{
                  padding: "10px 14px",
                  background: "rgba(248, 113, 113, 0.12)", color: "#fecaca",
                  border: "1px solid rgba(248, 113, 113, 0.35)",
                  borderRadius: 10, fontSize: 13, fontWeight: 600,
                }}>{error}</div>
              )}

              {/* Section: Identity */}
              <Section title="About you">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
                  <Field label="Full name *" span={2}
                         hint="Use the name your neighbours and Alkalo know you by.">
                    <input style={INPUT} value={name} autoFocus
                           onChange={(e) => setName(e.target.value)}
                           placeholder="Lamin Ceesay" />
                  </Field>
                  <Field label="Age *" hint="Must be 12 to 24.">
                    <input style={INPUT} type="number" min="12" max="24"
                           value={age} onChange={(e) => setAge(e.target.value)}
                           placeholder="17" />
                  </Field>
                  <Field label="Phone (optional)"
                         hint="So the Alkalo can reach you before assigning elders.">
                    <input style={INPUT} value={phone}
                           onChange={(e) => setPhone(e.target.value)}
                           placeholder="+220 300 1234" />
                  </Field>
                </div>
                {!ageOk && age ? (
                  <div style={{ color: "#fcd34d", fontSize: 11, marginTop: 4 }}>
                    Scouts must be between 12 and 24 years old.
                  </div>
                ) : null}
              </Section>

              {/* Section: Where + when */}
              <Section title="Where you live & when you can help"
                       hint="The Alkalo uses this to assign you elders who live nearby and can be reached when you are free.">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
                  <Field label="Village *">
                    <input style={INPUT} value={village}
                           onChange={(e) => setVillage(e.target.value)}
                           placeholder="Kerewan" />
                  </Field>
                  <Field label="Compound / locality *"
                         hint="Landmark an elder would use to find you.">
                    <input style={INPUT} value={locality}
                           onChange={(e) => setLocality(e.target.value)}
                           placeholder="Compound near the main mosque" />
                  </Field>
                  <Field label="Availability *" span={2}
                         hint="When can you visit the elders you'll monitor?">
                    <input style={INPUT} value={availability}
                           onChange={(e) => setAvailability(e.target.value)}
                           placeholder="After school Mon–Fri, all day Sat" />
                  </Field>
                </div>
              </Section>

              {/* Section: Motivation */}
              <Section title="Why do you want to be a scout?"
                       hint="Write from the heart — this is what your Alkalo will read.">
                <Field label="Your reason *">
                  <textarea style={{ ...INPUT, minHeight: 100, resize: "vertical" }}
                            value={reason} onChange={(e) => setReason(e.target.value)}
                            placeholder="My grandmother has hypertension and I want to make sure she and her neighbours take their medicine. I also want to earn the Heart Watcher badge." />
                </Field>
              </Section>

              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <button type="button" onClick={onClose} disabled={busy}
                        style={{
                          flex: 1, padding: "10px 14px",
                          background: "rgba(30, 41, 59, 0.85)", color: "#e2e8f0",
                          border: "1px solid rgba(148, 163, 184, 0.30)", borderRadius: 8,
                          fontSize: 13, fontWeight: 600,
                          cursor: busy ? "not-allowed" : "pointer",
                        }}>Cancel</button>
                <button type="button" onClick={submit} disabled={disabled}
                        style={{
                          flex: 2, padding: "10px 14px",
                          background: disabled ? "rgba(71, 85, 105, 0.70)"
                                    : "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)",
                          color: "#0b1220", border: "none", borderRadius: 8,
                          fontSize: 13, fontWeight: 800,
                          cursor: disabled ? "not-allowed" : "pointer",
                          boxShadow: disabled ? "none" : "0 4px 14px rgba(251, 191, 36, 0.40)",
                        }}>
                  {busy ? "Sending to Alkalo…" : "Submit application"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}


function Section({ title, hint, children }) {
  return (
    <div style={{
      background: "rgba(30, 41, 59, 0.45)",
      border: "1px solid rgba(148, 163, 184, 0.18)",
      borderRadius: 12, padding: "12px 14px",
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0",
                      textTransform: "uppercase", letterSpacing: 0.4 }}>
          {title}
        </div>
        {hint ? (
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3,
                        lineHeight: 1.5 }}>
            {hint}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}
