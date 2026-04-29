/**
 * PrivacyPolicyPopup — government privacy policy reminder.
 *
 * Shown on every admin LOGIN and every admin LOGOUT by
 * PrivacyPolicyBootstrap. Lightweight one-click ack so the operator
 * cannot use the platform without seeing the policy each session.
 *
 * Re-uses the existing /api/v1/observatory/disclaimer payload for the
 * canonical ministry-approved text, but falls back to a baked summary
 * if the endpoint is unavailable so the gate still functions offline.
 *
 * Acceptance is recorded server-side too via POST /observatory/consent
 * so we keep an audit trail of who saw the policy and when. The full
 * dual-checkbox ConsentGate still fires on actual gov portal access —
 * this popup is the lighter-touch session bookend.
 */

import { useEffect, useRef, useState } from "react";

const API = ((typeof window !== "undefined" && window.AMINA_API)
            || "http://localhost:8000").replace(/\/+$/, "");

const Z_INDEX = 9990;  // sits below the heavy ConsentGate (9999) on purpose

const FALLBACK_BULLETS = [
  "Data shown in the Government portal is synthetic, anonymised, or aggregated. It is not a record of any identified individual.",
  "Real patient health information must never be re-identified, exported in plain form, or shared outside the cleared MoH workflow.",
  "Every viewer action — query, export, download — is audit-logged with your session id. The audit log is reviewable by the data-protection officer.",
  "If a real PHI item is encountered in error, treat it as an incident: notify the data-protection officer and stop the activity immediately.",
];

export default function PrivacyPolicyPopup({ phase, onClose }) {
  // phase: "login" | "logout"
  const [bullets, setBullets] = useState(FALLBACK_BULLETS);
  const [version, setVersion] = useState("");
  const [busy, setBusy]       = useState(false);
  const ackBtnRef             = useRef(null);

  // ── Boot: try to fetch the canonical ministry text ────────────────
  // The /observatory/disclaimer payload exposes one of:
  //   - bullets:          string[]
  //   - consent_clauses:  string[]   (current API shape)
  //   - sections:         {heading, body}[]   (long-form fallback)
  // We try them in that order so the popup adapts to whichever shape
  // the running observatory_disclaimer service emits.
  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/api/v1/observatory/disclaimer`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((j) => {
        if (cancelled || !j) return;
        let next = null;
        if (Array.isArray(j.bullets) && j.bullets.length) {
          next = j.bullets;
        } else if (Array.isArray(j.consent_clauses) && j.consent_clauses.length) {
          // Pair the one-line summary (if present) with the explicit clauses
          // so the popup carries both the headline and the user obligations.
          next = [];
          if (typeof j.summary === "string" && j.summary.trim()) {
            next.push(j.summary.trim());
          }
          for (const c of j.consent_clauses) {
            if (typeof c === "string" && c.trim()) next.push(c.trim());
          }
        } else if (Array.isArray(j.sections) && j.sections.length) {
          next = j.sections.slice(0, 4)
            .map((s) => `${s.heading || ""}: ${s.body || ""}`.trim())
            .filter(Boolean);
        }
        if (next && next.length) setBullets(next);
        if (j.version) setVersion(String(j.version));
      })
      .catch(() => { /* keep fallback */ });
    return () => { cancelled = true; };
  }, []);

  // ── Focus the ack button when the dialog opens ────────────────────
  useEffect(() => {
    try { ackBtnRef.current?.focus?.(); } catch { /* noop */ }
  }, []);

  // ── Escape closes ────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const ack = async () => {
    if (busy) return;
    setBusy(true);
    // Best-effort audit ping. Don't block the UI on failure — the
    // user has already SEEN the policy, which is the required outcome.
    try {
      await fetch(`${API}/api/v1/observatory/consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          accepted_synthetic:   true,
          accepted_no_real_use: true,
          context: phase === "logout" ? "logout_reminder" : "login_reminder",
        }),
      }).catch(() => { /* noop */ });
    } finally {
      setBusy(false);
      onClose?.();
    }
  };

  const isLogout = phase === "logout";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="amina-pp-title"
      style={{
        position: "fixed", inset: 0, zIndex: Z_INDEX,
        background: "rgba(2, 6, 23, 0.72)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "24px",
        fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        animation: "amina-pp-fade 180ms ease",
      }}
    >
      <div style={{
        width: "min(640px, 100%)",
        maxHeight: "min(86vh, 720px)",
        display: "flex", flexDirection: "column",
        background: "#0b1220",
        color: "#e2e8f0",
        border: "1px solid rgba(148, 163, 184, 0.20)",
        borderRadius: 14,
        boxShadow: "0 28px 56px rgba(2, 6, 23, 0.65)",
        overflow: "hidden",
        animation: "amina-pp-pop 220ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}>
        {/* Ministry header strip */}
        <div style={{
          padding: "14px 22px",
          background: "linear-gradient(135deg, #0c1c8c 0%, #3a7728 100%)",
          color: "#fff",
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 10, marginBottom: 4,
          }}>
            <GambianFlag height={18} />
            <div style={{
              fontSize: 11, fontWeight: 800, letterSpacing: 0.7,
              textTransform: "uppercase", opacity: 0.95,
            }}>
              Republic of The Gambia · Ministry of Health
            </div>
          </div>
          <div id="amina-pp-title" style={{ fontSize: 17, fontWeight: 800, letterSpacing: 0.2 }}>
            {isLogout ? "Session ending — privacy reminder" : "Government privacy policy"}
          </div>
          <div style={{ fontSize: 12, opacity: 0.92, marginTop: 4, lineHeight: 1.5 }}>
            {isLogout
              ? "Before you sign out, please confirm you have not retained any synthetic-data exports outside this session."
              : "You are about to access the AMINA Observatory. Please review the data-handling rules for every session."}
            {version ? <> · v{version}</> : null}
          </div>
        </div>

        {/* Scrollable bullets */}
        <div style={{ overflowY: "auto", padding: "16px 22px", flex: 1 }}>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {bullets.map((b, i) => (
              <li key={i} style={{
                display: "flex", gap: 10, alignItems: "flex-start",
                padding: "8px 0",
                borderTop: i ? "1px solid rgba(148, 163, 184, 0.10)" : "none",
                fontSize: 13, lineHeight: 1.55, color: "#cbd5e1",
              }}>
                <span style={{
                  flexShrink: 0, marginTop: 4,
                  width: 6, height: 6, borderRadius: "50%",
                  background: "#22c55e",
                }} />
                <span>{b}</span>
              </li>
            ))}
          </ul>

          <div style={{
            marginTop: 14, padding: "10px 12px",
            background: "rgba(99, 102, 241, 0.10)",
            border: "1px solid rgba(129, 140, 248, 0.30)",
            borderRadius: 8,
            color: "#c7d2fe", fontSize: 12, lineHeight: 1.55,
          }}>
            <strong>Audit:</strong> Confirming this notice is logged with your
            session id and timestamp. Full legal disclaimer available at{" "}
            <a href="#/admin/disclaimer"
               style={{ color: "#a5b4fc", textDecoration: "underline" }}
               onClick={(e) => e.stopPropagation()}>
              /admin/disclaimer
            </a>.
          </div>
        </div>

        {/* Sticky footer */}
        <div style={{
          padding: "12px 22px",
          borderTop: "1px solid rgba(148, 163, 184, 0.15)",
          background: "rgba(11, 18, 32, 0.96)",
          display: "flex", justifyContent: "flex-end", gap: 8,
          flexWrap: "wrap",
        }}>
          <button
            ref={ackBtnRef}
            type="button"
            onClick={ack}
            disabled={busy}
            style={{
              padding: "10px 22px", borderRadius: 8, border: "none",
              background: busy
                ? "rgba(71, 85, 105, 0.40)"
                : "linear-gradient(135deg, #16a34a, #22c55e)",
              color: busy ? "#94a3b8" : "#fff",
              fontSize: 13, fontWeight: 700, cursor: busy ? "not-allowed" : "pointer",
              boxShadow: busy ? "none" : "0 4px 14px rgba(22, 163, 74, 0.40)",
            }}>
            {busy ? "Recording…" : (isLogout ? "Sign out — I understand" : "I understand · Continue")}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes amina-pp-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes amina-pp-pop {
          from { transform: translateY(8px); opacity: 0; }
          to   { transform: translateY(0);   opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ── Gambian flag (matches ConsentGate.jsx) ─────────────────────────
function GambianFlag({ height = 18 }) {
  const w = Math.round(height * 1.5);
  const u = height / 10;
  return (
    <span aria-hidden="true" style={{
      display: "inline-block", width: w, height,
      borderRadius: 2, overflow: "hidden", flexShrink: 0,
      boxShadow: "0 0 0 1px rgba(255,255,255,0.18) inset",
    }}>
      <div style={{ height: u * 2, background: "#CE1126" }} />
      <div style={{ height: u,     background: "#fff"    }} />
      <div style={{ height: u * 4, background: "#0C1C8C" }} />
      <div style={{ height: u,     background: "#fff"    }} />
      <div style={{ height: u * 2, background: "#3A7728" }} />
    </span>
  );
}
