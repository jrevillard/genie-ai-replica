/**
 * SymptomReportForm — modal form for reporting symptoms.
 * Rendered by FormDispatcher when `suggest_form === "symptom"` fires from
 * a chat response, OR when the patient clicks "Report symptom" from any
 * shell quick-action.
 *
 * Literacy-aware sizing: props.mode can be "beginner"|"basic"|"advanced"
 * to scale font/spacing; defaults to "basic".
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { submitSymptomReport } from "./formsApi.js";

const SEVERITY_KEYS = [
  { value: "info",      key: "mild" },
  { value: "warning",   key: "moderate" },
  { value: "emergency", key: "severe" },
];

const DURATION_KEYS = [
  "lessThanHour",
  "fewHours",
  "sinceYesterday",
  "severalDays",
  "weekOrMore",
];

export default function SymptomReportForm({ open, mode = "basic", prefill = {}, onClose, onSubmitted }) {
  const { t } = useTranslation();
  const SEVERITY_OPTIONS = useMemo(() => SEVERITY_KEYS.map(o => ({
    value: o.value,
    label: t(`forms.symptom.severity.${o.key}`),
    hint:  t(`forms.symptom.severity.${o.key}.hint`),
  })), [t]);
  const DURATION_PRESETS = useMemo(() => DURATION_KEYS.map(k => ({
    key:   k,
    label: t(`forms.symptom.duration.${k}`),
  })), [t]);
  const [symptoms, setSymptoms] = useState(prefill.symptoms || "");
  const [severity, setSeverity] = useState(prefill.severity || "info");
  const [duration, setDuration] = useState(prefill.duration || "");
  const [notes,    setNotes]    = useState(prefill.notes    || "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const firstFieldRef = useRef(null);

  useEffect(() => {
    if (open && firstFieldRef.current) firstFieldRef.current.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const scale = mode === "beginner" ? 1.15 : mode === "advanced" ? 0.95 : 1.0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!symptoms.trim()) { setError(t("forms.symptom.error.describe")); return; }
    setError(""); setSubmitting(true);
    const r = await submitSymptomReport({ symptoms, severity, duration, notes });
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
        aria-label={t("forms.symptom.title")}
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
              {t("forms.symptom.title")}
            </div>
            <div style={{ fontSize: `${11 * scale}px`, opacity: 0.85, marginTop: 2 }}>
              {t("forms.symptom.subtitle")}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label={t("common.close")}
                  style={closeBtn}>✕</button>
        </header>

        <div style={{ padding: "18px 20px", overflowY: "auto" }}>
          <label style={labelStyle(scale)}>
            {t("forms.symptom.fields.what")} <span style={{ color: "#ef4444" }}>*</span>
          </label>
          <textarea
            ref={firstFieldRef}
            value={symptoms}
            onChange={(e) => setSymptoms(e.target.value)}
            placeholder={t("forms.symptom.fields.what.hint")}
            rows={3}
            style={inputStyle(scale)}
          />

          <label style={labelStyle(scale)}>{t("forms.symptom.fields.severity")}</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            {SEVERITY_OPTIONS.map((o) => {
              const active = severity === o.value;
              return (
                <button
                  type="button"
                  key={o.value}
                  onClick={() => setSeverity(o.value)}
                  style={{
                    padding:      "10px 8px",
                    borderRadius: 8,
                    border:       active ? "2px solid #0f766e" : "2px solid #e2e8f0",
                    background:   active ? "#f0fdfa" : "#fff",
                    color:        active ? "#0f172a" : "#475569",
                    fontWeight:   active ? 700 : 500,
                    textAlign:    "center",
                    cursor:       "pointer",
                    transition:   "all 120ms ease",
                    fontSize:     `${13 * scale}px`,
                  }}
                >
                  <div>{o.label}</div>
                  <div style={{ fontSize: `${10 * scale}px`, opacity: 0.75, marginTop: 2 }}>
                    {o.hint}
                  </div>
                </button>
              );
            })}
          </div>

          <label style={labelStyle(scale)}>{t("forms.symptom.fields.duration")}</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {DURATION_PRESETS.map((d) => {
              const active = duration === d.label;
              return (
                <button
                  type="button"
                  key={d.key}
                  onClick={() => setDuration(d.label)}
                  style={{
                    padding:      "6px 12px",
                    borderRadius: 16,
                    border:       active ? "1.5px solid #0f766e" : "1px solid #cbd5e1",
                    background:   active ? "#0f766e" : "#fff",
                    color:        active ? "#fff" : "#475569",
                    fontWeight:   500,
                    fontSize:     `${12 * scale}px`,
                    cursor:       "pointer",
                    transition:   "all 120ms ease",
                  }}
                >{d.label}</button>
              );
            })}
          </div>

          <label style={labelStyle(scale)}>{t("forms.symptom.fields.notes")}</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("forms.symptom.fields.notes.hint")}
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
          <button type="submit" disabled={submitting || !symptoms.trim()}
                  style={primaryBtn(scale, submitting || !symptoms.trim())}>
            {submitting
              ? t("forms.symptom.actions.submitting")
              : t("forms.symptom.actions.submit")}
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
  marginTop:   12,
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
