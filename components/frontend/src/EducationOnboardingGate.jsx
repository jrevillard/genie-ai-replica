/**
 * EducationOnboardingGate — blocking post-login onboarding modal.
 *
 * Shown on first launch for any patient whose LiteracyProfile has no
 * declared level yet (`needs_onboarding: true` from /literacy/me).
 * Cannot be dismissed — user must pick a level and (for Upper Basic+)
 * upload a certificate to proceed. Mounted as a sibling React root via
 * LiteracyBootstrap.jsx so no edits to App.jsx are required.
 *
 * Flow:
 *   1. Patient picks an education level card.
 *   2. If the level requires a certificate, a file picker is shown.
 *      (Optional for "never attended" / "lower basic".)
 *   3. Submit:
 *        POST /api/v1/literacy/me/declare      { level }
 *        POST /api/v1/literacy/me/certificate  (multipart: declared_level, file)
 *   4. On success, calls onDone() — LiteracyBootstrap refetches /literacy/me
 *      and unmounts the gate.
 *
 * Safe-floor: all users start in Beginner mode regardless of their
 * declared level. The declared level only unlocks a higher mode after
 * admin verification.
 *
 * Props:
 *   token          — patient JWT (required)
 *   patientName    — display name for greeting (optional)
 *   onDone()       — called after successful submission
 */

import { useEffect, useState } from "react";

const API = (window.AMINA_API || "http://localhost:8000").replace(/\/+$/, "");

const C = {
  overlay:  "rgba(15, 23, 42, 0.78)",
  card:     "#ffffff",
  text:     "#0f172a",
  muted:    "#64748b",
  accent:   "#0ea5e9",
  accentBg: "#ecfeff",
  border:   "#e2e8f0",
  green:    "#10b981",
  amber:    "#f59e0b",
  red:      "#dc2626",
};

const LEVELS = [
  {
    id:    "none",
    icon:  "🌱",
    title: "I never attended school",
    desc:  "That's okay — AMINA will help with simple pictures and voice.",
    cert:  false,
    mode:  "beginner",
  },
  {
    id:    "lower_basic",
    icon:  "🏫",
    title: "Lower Basic (Grades 1–6)",
    desc:  "Primary school up to Grade 6.",
    cert:  false,
    mode:  "beginner",
  },
  {
    id:    "upper_basic",
    icon:  "📘",
    title: "Upper Basic (Grades 7–9)",
    desc:  "Junior secondary school.",
    cert:  true,
    mode:  "basic",
  },
  {
    id:    "senior_sec",
    icon:  "📗",
    title: "Senior Secondary (Grades 10–12)",
    desc:  "High school / WASSCE.",
    cert:  true,
    mode:  "advanced",
  },
  {
    id:    "tertiary",
    icon:  "🎓",
    title: "University / College / Vocational",
    desc:  "Tertiary education.",
    cert:  true,
    mode:  "advanced",
  },
];

const MODE_LABEL = {
  beginner: "Beginner — big buttons, simple words, voice help",
  basic:    "Basic — simplified layout with larger text",
  advanced: "Advanced — the full AMINA experience",
};


export default function EducationOnboardingGate({ token, patientName = "", onDone }) {
  const [selected, setSelected]   = useState(null);      // level id
  const [file, setFile]           = useState(null);
  const [busy, setBusy]           = useState(false);
  const [error, setError]         = useState("");
  const [toast, setToast]         = useState("");

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const chosen = LEVELS.find(l => l.id === selected) || null;
  const needsCert = !!(chosen && chosen.cert);

  const onFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) { setFile(null); return; }
    const ok = ["image/jpeg", "image/jpg", "image/png", "image/webp", "application/pdf"];
    if (!ok.includes(f.type)) {
      setError("Please upload a JPG, PNG, WEBP, or PDF file.");
      setFile(null);
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      setError("File is too large (max 5 MB).");
      setFile(null);
      return;
    }
    setError("");
    setFile(f);
  };

  const submit = async () => {
    if (!selected) { setError("Please choose one option."); return; }
    if (needsCert && !file) {
      setError("A certificate is required for this level. You can take a photo of it with your phone.");
      return;
    }
    if (!token) { setError("Not signed in."); return; }

    setBusy(true);
    setError("");
    try {
      // Step 1 — declare level
      const rDecl = await fetch(`${API}/api/v1/literacy/me/declare`, {
        method:  "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization:  `Bearer ${token}`,
        },
        body: JSON.stringify({ level: selected }),
      });
      if (!rDecl.ok) {
        let msg = `Could not save (HTTP ${rDecl.status}).`;
        try {
          const j = await rDecl.json();
          if (j && j.detail) msg = String(j.detail);
        } catch {}
        throw new Error(msg);
      }

      // Step 2 — certificate upload (if provided)
      if (file) {
        const form = new FormData();
        form.append("declared_level", selected);
        form.append("file", file, file.name);
        const rCert = await fetch(`${API}/api/v1/literacy/me/certificate`, {
          method:  "POST",
          headers: { Authorization: `Bearer ${token}` },
          body:    form,
        });
        if (!rCert.ok) {
          let msg = `Could not upload certificate (HTTP ${rCert.status}).`;
          try {
            const j = await rCert.json();
            if (j && j.detail) msg = String(j.detail);
          } catch {}
          throw new Error(msg);
        }
      }

      setToast(
        needsCert
          ? "Thank you — an admin will review your certificate soon."
          : "Thank you — you can start using AMINA now."
      );
      setTimeout(() => { onDone && onDone(); }, 1200);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: C.overlay, backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20, pointerEvents: "auto",
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="amina-edu-gate-title"
    >
      <div
        style={{
          background: C.card, borderRadius: 22,
          width: "100%", maxWidth: 620,
          maxHeight: "92vh", overflow: "auto",
          boxShadow: "0 24px 72px rgba(0,0,0,.4)",
          animation: "fadeIn .25s ease-out",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "26px 28px 22px",
            background: "linear-gradient(135deg,#0c4a6e,#0ea5e9)",
            color: "#fff",
          }}
        >
          <div
            style={{
              fontSize: 11, fontWeight: 700, letterSpacing: ".8px",
              textTransform: "uppercase", color: "#bae6fd", marginBottom: 6,
            }}
          >
            AMINA Care · Let's set up your experience
          </div>
          <div
            id="amina-edu-gate-title"
            style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.25 }}
          >
            {patientName ? `Welcome, ${patientName}! ` : "Welcome! "}
            How much school have you finished?
          </div>
          <div style={{ fontSize: 13, color: "#e0f2fe", marginTop: 8, lineHeight: 1.55 }}>
            This helps AMINA talk to you in a way that feels right. There are
            no wrong answers — every level is welcome here.
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "18px 22px 22px" }}>
          {/* Level cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {LEVELS.map(l => {
              const active = selected === l.id;
              return (
                <button
                  key={l.id}
                  onClick={() => { setSelected(l.id); setError(""); }}
                  disabled={busy}
                  style={{
                    textAlign: "left",
                    display: "flex", alignItems: "flex-start", gap: 14,
                    padding: "14px 16px",
                    border: `2px solid ${active ? C.accent : C.border}`,
                    background: active ? C.accentBg : "#fff",
                    borderRadius: 14, cursor: busy ? "default" : "pointer",
                    transition: "all .15s ease",
                    boxShadow: active ? "0 4px 14px rgba(14,165,233,.18)" : "none",
                  }}
                >
                  <div style={{ fontSize: 28, lineHeight: 1, marginTop: 2 }}>{l.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 15, fontWeight: 700, color: C.text,
                        marginBottom: 3,
                      }}
                    >
                      {l.title}
                    </div>
                    <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
                      {l.desc}
                    </div>
                    {l.cert && (
                      <div
                        style={{
                          fontSize: 11, fontWeight: 700, color: C.amber,
                          marginTop: 6, display: "inline-block",
                          background: "#fffbeb",
                          border: "1px solid #fde68a",
                          borderRadius: 6, padding: "2px 8px",
                        }}
                      >
                        Certificate required
                      </div>
                    )}
                  </div>
                  <div
                    style={{
                      width: 22, height: 22, borderRadius: 11,
                      border: `2px solid ${active ? C.accent : C.border}`,
                      background: active ? C.accent : "#fff",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0, marginTop: 4,
                    }}
                  >
                    {active && (
                      <span style={{ color: "#fff", fontSize: 13, fontWeight: 900 }}>✓</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Certificate upload */}
          {chosen && (
            <div
              style={{
                marginTop: 16,
                padding: 16,
                background: "#f8fafc",
                border: `1px solid ${C.border}`,
                borderRadius: 14,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 6 }}>
                {needsCert ? "Upload your certificate" : "Upload a certificate (optional)"}
              </div>
              <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.55, marginBottom: 10 }}>
                {needsCert
                  ? "You can take a clear photo of your school certificate with your phone. JPG, PNG, WEBP or PDF, max 5 MB."
                  : "If you have one, you can upload it later from settings. JPG, PNG, WEBP or PDF, max 5 MB."}
              </div>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={onFile}
                disabled={busy}
                style={{
                  display: "block", width: "100%", fontSize: 13,
                  padding: 8, background: "#fff",
                  border: `1px dashed ${C.border}`, borderRadius: 10,
                }}
              />
              {file && (
                <div
                  style={{
                    marginTop: 8, fontSize: 12, color: C.green, fontWeight: 600,
                  }}
                >
                  ✓ {file.name} ({Math.round(file.size / 1024)} KB)
                </div>
              )}
            </div>
          )}

          {/* Mode preview */}
          {chosen && (
            <div
              style={{
                marginTop: 14,
                padding: "12px 14px",
                background: C.accentBg,
                border: "1px solid #bae6fd",
                borderRadius: 12,
                fontSize: 12, color: "#075985", lineHeight: 1.55,
              }}
            >
              <strong>You'll start in Beginner mode</strong> until an admin
              verifies your education. Once verified, AMINA will switch to{" "}
              <strong>{MODE_LABEL[chosen.mode]}</strong>.
            </div>
          )}

          {/* Error */}
          {error && (
            <div
              style={{
                marginTop: 12, padding: "10px 12px",
                background: "#fef2f2", border: `1px solid #fecaca`,
                color: C.red, borderRadius: 10,
                fontSize: 12, fontWeight: 600, lineHeight: 1.5,
              }}
            >
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            onClick={submit}
            disabled={busy || !selected}
            style={{
              marginTop: 16, width: "100%",
              padding: "15px 18px", borderRadius: 14,
              background: (!selected || busy) ? "#cbd5e1" : C.accent,
              border: "none", color: "#fff",
              fontWeight: 800, fontSize: 15,
              cursor: (busy || !selected) ? "default" : "pointer",
              boxShadow: (!selected || busy) ? "none" : "0 6px 18px rgba(14,165,233,.35)",
            }}
          >
            {busy ? "Saving…" : needsCert ? "Submit for review" : "Continue"}
          </button>

          <div
            style={{
              marginTop: 10, fontSize: 11, color: C.muted,
              textAlign: "center", lineHeight: 1.5,
            }}
          >
            You can change this any time from <strong>Privacy &amp; Data</strong> settings.
          </div>

          {toast && (
            <div
              style={{
                marginTop: 14, padding: "11px 14px", borderRadius: 10,
                background: "#0f172a", color: "#fff",
                fontSize: 12, fontWeight: 700, textAlign: "center",
              }}
            >
              {toast}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
