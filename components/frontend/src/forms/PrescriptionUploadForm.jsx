/**
 * PrescriptionUploadForm — modal for uploading a prescription scan/PDF.
 * Shares visual language with SymptomReportForm.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { submitPrescription } from "./formsApi.js";

const ACCEPTED = "application/pdf,image/jpeg,image/png,image/heic";
const MAX_BYTES = 20 * 1024 * 1024;

// BUG-044: enforce file type client-side. The `accept` attribute is a
// UI hint that browsers honour for the file-picker but DO NOT enforce
// for drag-drop or direct programmatic uploads. We validate the
// File.type (MIME) against the same allow-list, with an extension
// fallback for HEIC files served without a recognised MIME.
const _ACCEPTED_MIMES = new Set(ACCEPTED.split(",").map(s => s.trim()));
const _ACCEPTED_EXTS = [".pdf", ".jpg", ".jpeg", ".png", ".heic"];
function _isAcceptedFile(f) {
  if (!f) return false;
  if (f.type && _ACCEPTED_MIMES.has(f.type)) return true;
  const name = (f.name || "").toLowerCase();
  return _ACCEPTED_EXTS.some(ext => name.endsWith(ext));
}

export default function PrescriptionUploadForm({ open, mode = "basic", prefill = {}, onClose, onSubmitted }) {
  const { t } = useTranslation();
  const [file,      setFile]      = useState(null);
  const [doctor,    setDoctor]    = useState(prefill.doctor || "");
  const [condition, setCondition] = useState(prefill.condition || "");
  const [notes,     setNotes]     = useState(prefill.notes || "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const dropRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const scale = mode === "beginner" ? 1.15 : mode === "advanced" ? 0.95 : 1.0;

  const pickFile = (f) => {
    if (!f) return;
    if (!_isAcceptedFile(f)) {
      // BUG-044: reject .exe / unknown types at the client so the user
      // gets immediate feedback instead of a confusing backend rejection.
      // i18n key may not exist yet -- fall back to the literal English string.
      setError(
        t("forms.prescription.error.badType") ||
        "Only PDF or image files (JPG / PNG / HEIC) are allowed."
      );
      return;
    }
    if (f.size > MAX_BYTES) { setError(t("forms.prescription.error.tooLarge")); return; }
    setError(""); setFile(f);
  };

  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation();
    const f = e.dataTransfer?.files?.[0];
    if (f) pickFile(f);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) { setError(t("forms.prescription.error.chooseFile")); return; }
    setSubmitting(true); setError("");
    const r = await submitPrescription({ file, doctor, condition, notes });
    setSubmitting(false);
    if (r._error) { setError(r._error); return; }
    onSubmitted?.(r.item);
    onClose?.();
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9270,
        background: "rgba(15, 23, 42, 0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "16px",
        animation: "amina-form-fade 180ms ease",
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        role="dialog"
        aria-label={t("forms.prescription.title")}
        style={{
          width:         "min(480px, 100%)",
          maxHeight:     "90vh",
          background:    "#fff",
          borderRadius:  "14px",
          boxShadow:     "0 24px 60px rgba(15, 23, 42, 0.35)",
          overflow:      "hidden",
          display:       "flex",
          flexDirection: "column",
          fontFamily:    "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          animation:     "amina-form-zoom 220ms cubic-bezier(0.22, 1, 0.36, 1)",
          fontSize:      `${14 * scale}px`,
        }}
      >
        <header style={{
          padding: "16px 20px",
          background: "linear-gradient(135deg, #0f766e, #0891b2)",
          color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: `${15 * scale}px`, fontWeight: 700 }}>
              {t("forms.prescription.title")}
            </div>
            <div style={{ fontSize: `${11 * scale}px`, opacity: 0.85, marginTop: 2 }}>
              {t("forms.prescription.subtitle")}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label={t("common.close")} style={closeBtn}>✕</button>
        </header>

        <div style={{ padding: "18px 20px", overflowY: "auto" }}>
          <div
            ref={dropRef}
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = "#0f766e"; }}
            onDragLeave={(e) => { e.currentTarget.style.borderColor = "#cbd5e1"; }}
            onDrop={handleDrop}
            onClick={() => dropRef.current?.querySelector("input")?.click()}
            style={{
              border:       "2px dashed #cbd5e1",
              borderRadius: 10,
              padding:      "24px 16px",
              textAlign:    "center",
              background:   "#f8fafc",
              cursor:       "pointer",
              transition:   "border-color 120ms ease",
            }}
          >
            <input
              type="file" accept={ACCEPTED}
              onChange={(e) => pickFile(e.target.files?.[0])}
              style={{ display: "none" }}
            />
            {file ? (
              <>
                <div style={{ fontSize: `${28 * scale}px` }}>📎</div>
                <div style={{ fontWeight: 600, color: "#0f172a", marginTop: 6 }}>{file.name}</div>
                <div style={{ fontSize: `${11 * scale}px`, color: "#64748b", marginTop: 2 }}>
                  {Math.round(file.size / 1024)} KB · {file.type || "file"}
                </div>
                <div style={{ fontSize: `${11 * scale}px`, color: "#0f766e", marginTop: 8 }}>
                  {t("forms.prescription.replaceHint")}
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: `${28 * scale}px` }}>📄</div>
                <div style={{ fontWeight: 600, color: "#0f172a", marginTop: 6 }}>
                  {t("forms.prescription.uploadHint")}
                </div>
                <div style={{ fontSize: `${11 * scale}px`, color: "#64748b", marginTop: 4 }}>
                  {t("forms.prescription.privacyHint")}
                </div>
              </>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
            <div>
              <label style={labelStyle(scale)}>
                {t("forms.prescription.fields.doctor")}
                <span style={{ fontWeight: 400, opacity: 0.6, marginLeft: 4 }}>
                  ({t("common.optional")})
                </span>
              </label>
              <input
                type="text" value={doctor}
                onChange={(e) => setDoctor(e.target.value)}
                placeholder={t("forms.prescription.fields.doctor.placeholder")}
                style={inputStyle(scale)}
              />
            </div>
            <div>
              <label style={labelStyle(scale)}>
                {t("forms.prescription.fields.condition")}
                <span style={{ fontWeight: 400, opacity: 0.6, marginLeft: 4 }}>
                  ({t("common.optional")})
                </span>
              </label>
              <input
                type="text" value={condition}
                onChange={(e) => setCondition(e.target.value)}
                placeholder={t("forms.prescription.fields.condition.placeholder")}
                style={inputStyle(scale)}
              />
            </div>
          </div>

          <label style={labelStyle(scale)}>
            {t("forms.prescription.fields.notes")}
            <span style={{ fontWeight: 400, opacity: 0.6, marginLeft: 4 }}>
              ({t("common.optional")})
            </span>
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("forms.prescription.fields.notes.placeholder")}
            rows={2}
            style={inputStyle(scale)}
          />

          {error ? (
            <div style={{
              marginTop: 10, padding: "8px 10px", background: "#fef2f2",
              color: "#991b1b", borderRadius: 6, fontSize: `${12 * scale}px`,
            }}>⚠ {error}</div>
          ) : null}
        </div>

        <footer style={{
          padding: "14px 20px", borderTop: "1px solid #e2e8f0",
          display: "flex", justifyContent: "flex-end", gap: 10,
        }}>
          <button type="button" onClick={onClose} disabled={submitting}
                  style={secondaryBtn(scale)}>{t("common.cancel")}</button>
          <button type="submit" disabled={submitting || !file}
                  style={primaryBtn(scale, submitting || !file)}>
            {submitting
              ? t("forms.prescription.actions.submitting")
              : t("forms.prescription.actions.submit")}
          </button>
        </footer>

        <style>{`
          @keyframes amina-form-fade { from { opacity: 0; } to { opacity: 1; } }
          @keyframes amina-form-zoom {
            from { opacity: 0; transform: scale(0.96) translateY(8px); }
            to   { opacity: 1; transform: scale(1) translateY(0); }
          }
        `}</style>
      </form>
    </div>
  );
}

const labelStyle = (s) => ({
  display:     "block",
  fontSize:    `${12.5 * s}px`,
  fontWeight:  600,
  color:       "#0f172a",
  marginTop:   10,
  marginBottom:6,
});

const inputStyle = (s) => ({
  width:        "100%",
  padding:      "10px 12px",
  fontSize:     `${13 * s}px`,
  fontFamily:   "inherit",
  border:       "1px solid #cbd5e1",
  borderRadius: 8,
  outline:      "none",
  resize:       "vertical",
  background:   "#fff",
});

const primaryBtn = (s, disabled) => ({
  padding:      "10px 18px",
  border:       "none",
  background:   disabled ? "#94a3b8" : "linear-gradient(135deg, #0f766e, #14b8a6)",
  color:        "#fff",
  fontWeight:   600,
  fontSize:     `${13 * s}px`,
  borderRadius: 8,
  cursor:       disabled ? "not-allowed" : "pointer",
  boxShadow:    disabled ? "none" : "0 2px 6px rgba(20,184,166,0.35)",
});

const secondaryBtn = (s) => ({
  padding:      "10px 18px",
  border:       "1px solid #cbd5e1",
  background:   "#fff",
  color:        "#475569",
  fontSize:     `${13 * s}px`,
  borderRadius: 8,
  cursor:       "pointer",
});

const closeBtn = {
  width: 28, height: 28, border: "none", cursor: "pointer",
  background: "rgba(255,255,255,0.18)", color: "#fff",
  borderRadius: 6, fontSize: "13px",
};
