/**
 * ConsentGate — first-launch training-consent modal.
 *
 * Shown once per actor, until a decision (yes OR not-now) is recorded
 * on the backend. The modal renders as a full-screen portal overlay
 * that visually and functionally blocks the app beneath until the
 * user chooses. Decisions are persisted via:
 *
 *   POST /api/v1/training/consent/me   { value: bool, reason: str }
 *
 * Props (all optional except token):
 *   token        — bearer JWT (patient or caregiver)
 *   actorRole    — "patient" | "caregiver"   (default: "patient")
 *   actorName    — display name              (optional greeting)
 *   headline     — override main headline     (optional)
 *   subhead      — override subhead           (optional)
 *   onClose(v)   — called with the chosen boolean after save succeeds
 */

import { useEffect, useState } from "react";

const API = (window.AMINA_API || "http://localhost:8000").replace(/\/+$/, "");

const C = {
  overlay:  "rgba(15, 23, 42, 0.72)",
  card:     "#ffffff",
  text:     "#0f172a",
  muted:    "#64748b",
  accent:   "#6366f1",
  accentBg: "#eef2ff",
  border:   "#e2e8f0",
  green:    "#10b981",
  red:      "#dc2626",
};

const DEFAULT_HEADLINE = {
  patient:   "Help AMINA learn from our conversations?",
  caregiver: "Help AMINA learn from caregiver conversations?",
};

const DEFAULT_SUBHEAD = {
  patient:
    "We want to be transparent about how your health conversations may be used to make AMINA better for other Gambians.",
  caregiver:
    "Your questions about your loved one can help improve how AMINA supports other caregivers in The Gambia.",
};


export default function ConsentGate({
  token,
  actorRole = "patient",
  actorName = "",
  headline,
  subhead,
  onClose,
}) {
  const [busy, setBusy]       = useState(false);
  const [expanded, setExp]    = useState(false);
  const [toast, setToast]     = useState("");
  const [hidden, setHidden]   = useState(false);

  // Lock body scroll while the gate is up
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const submit = async (value) => {
    if (!token) {
      setToast("Not signed in — cannot save.");
      setTimeout(() => setToast(""), 3000);
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`${API}/api/v1/training/consent/me`, {
        method:  "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization:  `Bearer ${token}`,
        },
        body: JSON.stringify({
          value,
          reason: value ? "opted in at first launch" : "declined at first launch",
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setToast(
        value
          ? "Thank you — you're helping AMINA learn."
          : "Got it — no training data will be collected."
      );
      setTimeout(() => {
        setHidden(true);
        onClose && onClose(value);
      }, 900);
    } catch (e) {
      setToast("Could not save — please try again.");
      setTimeout(() => setToast(""), 3000);
    } finally {
      setBusy(false);
    }
  };

  if (hidden) return null;

  const hdr = headline || DEFAULT_HEADLINE[actorRole] || DEFAULT_HEADLINE.patient;
  const sub = subhead  || DEFAULT_SUBHEAD[actorRole]  || DEFAULT_SUBHEAD.patient;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: C.overlay, backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20, pointerEvents: "auto",
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="amina-consent-gate-title"
    >
      <div
        style={{
          background: C.card, borderRadius: 20,
          width: "100%", maxWidth: 540,
          boxShadow: "0 20px 60px rgba(0,0,0,.35)",
          overflow: "hidden",
          animation: "fadeIn .25s ease-out",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "28px 28px 20px",
            background: "linear-gradient(135deg,#1e1b4b,#312e81)",
            color: "#fff",
          }}
        >
          <div
            style={{
              fontSize: 11, fontWeight: 700, letterSpacing: ".8px",
              textTransform: "uppercase", color: "#a5b4fc", marginBottom: 6,
            }}
          >
            AMINA Care · Your data, your choice
          </div>
          <div
            id="amina-consent-gate-title"
            style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.25 }}
          >
            {hdr}
          </div>
          <div style={{ fontSize: 13, color: "#c7d2fe", marginTop: 8, lineHeight: 1.55 }}>
            {actorName ? `${actorName}, ` : ""}{sub}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 28px 24px" }}>
          <div
            style={{
              background: C.accentBg, border: `1px solid #c7d2fe`,
              borderRadius: 12, padding: "14px 16px", marginBottom: 16,
              fontSize: 13, color: "#4338ca", lineHeight: 1.6,
            }}
          >
            If you agree, <strong>anonymized copies</strong> of your future conversations with
            AMINA may be used to improve the AMINA model for everyone in The Gambia. Your
            name, phone number and exact location are <strong>never</strong> included. You can
            change your mind at any time from <strong>Privacy &amp; Data</strong> settings.
          </div>

          <button
            onClick={() => setExp(v => !v)}
            style={{
              background: "none", border: "none", padding: 0, cursor: "pointer",
              color: C.accent, fontSize: 13, fontWeight: 600, marginBottom: 10,
            }}
          >
            {expanded ? "Hide details ▴" : "What exactly is shared? ▾"}
          </button>

          {expanded && (
            <div
              style={{
                fontSize: 12, color: C.muted, lineHeight: 1.7,
                background: "#f8fafc", borderRadius: 10, padding: 14,
                border: `1px solid ${C.border}`, marginBottom: 16,
              }}
            >
              <Row icon="✓" color={C.green}>
                Only message text and topic tags (diabetes, diet, medication, etc.).
              </Row>
              <Row icon="✓" color={C.green}>
                Your ID is <strong>hashed (SHA-256)</strong> before being written — the original ID never leaves the database.
              </Row>
              <Row icon="✓" color={C.green}>
                Turns you flag with a 👎 or tag as "wrong info" are <strong>never</strong> used for training.
              </Row>
              <Row icon="✗" color={C.red}>
                Never: your name, phone number, village, or any personal identifier.
              </Row>
              <Row icon="✗" color={C.red} last>
                Never: photos, voice recordings, or location data.
              </Row>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button
              onClick={() => submit(false)}
              disabled={busy}
              style={{
                flex: 1, padding: "14px 16px", borderRadius: 12,
                background: "#f1f5f9", border: `1px solid ${C.border}`,
                color: C.text, fontWeight: 700, fontSize: 14,
                cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
              }}
            >
              Not now
            </button>
            <button
              onClick={() => submit(true)}
              disabled={busy}
              style={{
                flex: 1.4, padding: "14px 16px", borderRadius: 12,
                background: C.accent, border: "none",
                color: "#fff", fontWeight: 700, fontSize: 14,
                cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1,
                boxShadow: "0 4px 14px rgba(99,102,241,.35)",
              }}
            >
              {busy ? "Saving…" : "Yes, help AMINA learn"}
            </button>
          </div>

          <div
            style={{
              fontSize: 11, color: C.muted, textAlign: "center",
              marginTop: 14, lineHeight: 1.5,
            }}
          >
            You can revoke this choice any time from <strong>Privacy &amp; Data</strong> in your sidebar.
          </div>

          {toast && (
            <div
              style={{
                marginTop: 14, padding: "10px 14px", borderRadius: 10,
                background: "#0f172a", color: "#fff",
                fontSize: 12, fontWeight: 600, textAlign: "center",
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


function Row({ icon, color, last, children }) {
  return (
    <div
      style={{
        display: "flex", gap: 10, marginBottom: last ? 0 : 10,
      }}
    >
      <span style={{ color, fontSize: 16, lineHeight: 1, minWidth: 14 }}>{icon}</span>
      <div>{children}</div>
    </div>
  );
}
