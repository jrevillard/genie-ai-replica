/**
 * PolicyReviewModal — caregiver-facing review-and-accept screen.
 *
 * Mounted by PolicyReviewBootstrap. Opens when the bootstrap detects
 * a click on a policy inbox item (source_id starts with "policy:").
 *
 * Lifecycle
 *   1. Open with { inboxId } — fetches GET /api/v1/policy/{inboxId}/details.
 *      - 401/403: closes immediately, posts an `amina:auth-required` window
 *        event so the existing auth flow can pick up.
 *      - 404: shows the not-available message.
 *      - already accepted: shows the accepted state directly.
 *   2. User must tick all 4 checkboxes (FRONTEND_CHECKBOX_WORDING_V1),
 *      type a signature (>=2 chars), and enter their PIN (4-8 digits).
 *      Submit POSTs { typed_signature, pin }.
 *   3. 200 / already_accepted -> accepted state; emits
 *      `amina:caregiver-inbox:refresh` so the bell badge re-counts.
 *      422 -> per-field validation. 401/403 -> auth flow. 404 -> gone.
 *      5xx/network -> banner + clear PIN, keep checkboxes + signature.
 *
 * Style: follows the dark caregiver-portal palette already used by
 * CaregiverInboxBell so it sits visually next to the bell.
 */

import { useEffect, useRef, useState } from "react";
import { fetchPolicyDetails, postPolicyAccept } from "./policyReviewApi.js";

// Mirrors the backend constant FRONTEND_CHECKBOX_WORDING_V1 in
// src/models/policy_review.py — when checkboxes are omitted from the
// POST body, the server records this exact wording in the audit log.
const CHECKBOXES = [
  "I have read and understood this policy.",
  "I understand my responsibilities.",
  "I agree to follow this policy.",
  "I understand non-compliance may affect access.",
];

const Z_INDEX = 9300;  // sits above the inbox panel (9260) but below ConsentGate (9999)

function _fmtDeadline(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
    });
  } catch { return ""; }
}

function _daysUntil(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso).getTime();
    if (!d) return null;
    const ms = d - Date.now();
    return Math.ceil(ms / 86400000);
  } catch { return null; }
}

export default function PolicyReviewModal({ inboxId, onClose }) {
  const [phase,    setPhase]    = useState("loading"); // loading|review|accepted|gone|error
  const [details,  setDetails]  = useState(null);
  const [errBoot,  setErrBoot]  = useState("");
  const [showMandinka, setShowMandinka] = useState(false);

  const [checked,   setChecked]   = useState([false, false, false, false]);
  const [signature, setSignature] = useState("");
  const [pin,       setPin]       = useState("");
  const [submitting,    setSubmitting]    = useState(false);
  const [fieldErrors,   setFieldErrors]   = useState({});
  const [submitError,   setSubmitError]   = useState("");
  const sigRef = useRef(null);

  // ── Boot: fetch policy details ────────────────────────────────────
  // Component is keyed on inboxId by the bootstrap, so this effect
  // runs exactly once per open — initial phase is already "loading".
  useEffect(() => {
    let cancelled = false;
    if (!inboxId) return;
    fetchPolicyDetails(inboxId).then((r) => {
      if (cancelled) return;
      if (r.data) {
        setDetails(r.data);
        if (r.data.is_already_accepted) {
          setPhase("accepted");
        } else if (r.data.is_policy_review === false) {
          // Item is not a policy-review (e.g. a chat ping that happens
          // to share an inbox row). Just close — the user already saw
          // the regular inbox card.
          onClose?.();
        } else {
          setPhase("review");
        }
        return;
      }
      // Error path
      if (r._status === 401 || r._status === 403) {
        try { window.dispatchEvent(new Event("amina:auth-required")); } catch { /* noop */ }
        onClose?.();
        return;
      }
      if (r._status === 404) {
        setPhase("gone");
        return;
      }
      setErrBoot(r._error || "Could not load policy.");
      setPhase("error");
    });
    return () => { cancelled = true; };
  }, [inboxId, onClose]);

  // ── Escape closes when not submitting ────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && !submitting) onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  const allChecked = checked.every(Boolean);
  const sigOk      = signature.trim().length >= 2;
  const pinOk      = /^\d{4,8}$/.test(pin);
  const canSubmit  = allChecked && sigOk && pinOk && !submitting;

  function toggleCheck(i) {
    setChecked((xs) => xs.map((v, idx) => (idx === i ? !v : v)));
  }

  async function handleSubmit(e) {
    e?.preventDefault?.();
    if (!canSubmit) return;
    setSubmitting(true);
    setFieldErrors({});
    setSubmitError("");

    const r = await postPolicyAccept(inboxId, signature.trim(), pin);

    setSubmitting(false);

    if (r.data) {
      setDetails((d) => d ? { ...d, is_already_accepted: true,
                              action_completed_at: r.data.accepted_at || d.action_completed_at } : d);
      setPhase("accepted");
      try { window.dispatchEvent(new Event("amina:caregiver-inbox:refresh")); } catch { /* noop */ }
      try { window.dispatchEvent(new Event("amina:policy:accepted")); } catch { /* noop */ }
      return;
    }

    // Error mapping per spec
    const status = r._status;
    if (status === 401 || status === 403) {
      try { window.dispatchEvent(new Event("amina:auth-required")); } catch { /* noop */ }
      onClose?.();
      return;
    }
    if (status === 404) {
      setPhase("gone");
      return;
    }
    if (status === 422) {
      const fe = {};
      const detail = r._payload?.detail;
      const lines = Array.isArray(detail) ? detail : [];
      for (const item of lines) {
        const loc = Array.isArray(item?.loc) ? item.loc : [];
        const field = String(loc[loc.length - 1] || "");
        const msg   = String(item?.msg || "Invalid value");
        if (field) fe[field] = msg;
      }
      // Map server fields to UI fields. Backend may report typed_signature,
      // pin, or — in legacy mode — checkboxes.
      const out = {};
      if (fe.typed_signature) out.signature = fe.typed_signature;
      if (fe.typed_name)      out.signature = fe.typed_name;
      if (fe.pin)             out.pin       = fe.pin;
      // Surface unmapped server messages as a top-level banner.
      const unmapped = Object.entries(fe)
        .filter(([k]) => !["typed_signature", "typed_name", "pin"].includes(k))
        .map(([k, v]) => `${k}: ${v}`).join(" · ");
      if (unmapped) setSubmitError(unmapped);
      setFieldErrors(out);
      // Don't clear inputs — user can correct.
      return;
    }
    // 5xx / network: keep checkboxes + signature, clear PIN, banner.
    setPin("");
    setSubmitError(
      r._error
      || (status >= 500 ? "Server error — please try again." : "Could not submit. Please try again."),
    );
  }

  // ── Backdrop ──────────────────────────────────────────────────────
  const backdrop = (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose?.(); }}
      style={{
        position: "fixed", inset: 0, zIndex: Z_INDEX,
        background: "rgba(2, 6, 23, 0.62)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "24px",
        fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        animation: "amina-policy-fade 160ms ease",
      }}
    >
      {renderCard()}
      <style>{`
        @keyframes amina-policy-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes amina-policy-slide {
          from { transform: translateY(8px); opacity: 0; }
          to   { transform: translateY(0);   opacity: 1; }
        }
      `}</style>
    </div>
  );

  function renderCard() {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Policy review"
        style={{
          width: "min(560px, 100%)",
          maxHeight: "90vh", overflow: "auto",
          background: "#0b1220",
          color: "#e2e8f0",
          border: "1px solid rgba(148, 163, 184, 0.18)",
          borderRadius: 14,
          boxShadow: "0 24px 48px rgba(2, 6, 23, 0.55)",
          animation: "amina-policy-slide 200ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {phase === "loading"  && renderLoading()}
        {phase === "error"    && renderError()}
        {phase === "gone"     && renderGone()}
        {phase === "accepted" && renderAccepted()}
        {phase === "review"   && renderReview()}
      </div>
    );
  }

  function renderLoading() {
    return (
      <div style={{ padding: 36, textAlign: "center", color: "#94a3b8" }}>
        <div style={{ fontSize: 26, marginBottom: 8 }}>⌛</div>
        Loading policy…
      </div>
    );
  }

  function renderError() {
    return (
      <div style={{ padding: 28 }}>
        <div style={{ color: "#fecaca", fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
          Could not load this policy.
        </div>
        <div style={{ color: "#cbd5e1", fontSize: 12.5, marginBottom: 16 }}>
          {errBoot}
        </div>
        <div style={{ textAlign: "right" }}>
          <button onClick={onClose} style={btnGhost}>Close</button>
        </div>
      </div>
    );
  }

  function renderGone() {
    return (
      <div style={{ padding: 28 }}>
        <div style={{ color: "#fcd34d", fontSize: 22, marginBottom: 8 }}>📂</div>
        <div style={{ color: "#fde68a", fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
          Policy no longer available
        </div>
        <div style={{ color: "#cbd5e1", fontSize: 12.5, marginBottom: 16, lineHeight: 1.5 }}>
          This policy is no longer available, or is not assigned to this account.
        </div>
        <div style={{ textAlign: "right" }}>
          <button onClick={onClose} style={btnGhost}>Close</button>
        </div>
      </div>
    );
  }

  function renderAccepted() {
    const when = _fmtDeadline(details?.action_completed_at);
    return (
      <div style={{ padding: 28 }}>
        <div style={{ color: "#86efac", fontSize: 26, marginBottom: 8 }}>✓</div>
        <div style={{ color: "#bbf7d0", fontSize: 16, fontWeight: 700, marginBottom: 6 }}>
          Policy already accepted
        </div>
        <div style={{ color: "#cbd5e1", fontSize: 13, marginBottom: 4 }}>
          {details?.title || ""}
        </div>
        {when ? (
          <div style={{ color: "#94a3b8", fontSize: 11.5, marginBottom: 16 }}>
            Accepted {when}
          </div>
        ) : null}
        <div style={{ textAlign: "right" }}>
          <button onClick={onClose} style={btnPrimary}>Close</button>
        </div>
      </div>
    );
  }

  function renderReview() {
    const dl       = details?.action_deadline || "";
    const dlText   = _fmtDeadline(dl);
    const days     = _daysUntil(dl);
    const overdue  = days != null && days < 0;
    const m_title  = details?.mandinka_title || "";
    const m_body   = details?.mandinka_body  || "";
    const hasMandinka = Boolean(m_title || m_body);

    return (
      <form onSubmit={handleSubmit} noValidate>
        {/* Header */}
        <div style={{
          padding: "18px 22px",
          background: "linear-gradient(135deg, #0f766e 0%, #0891b2 100%)",
          borderRadius: "14px 14px 0 0",
          color: "#fff",
        }}>
          <div style={{ fontSize: 11, opacity: 0.85, letterSpacing: 0.6,
                        textTransform: "uppercase", fontWeight: 700 }}>
            Action required · Policy review
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, marginTop: 4, lineHeight: 1.3 }}>
            {details?.title || "(untitled policy)"}
          </div>
          {dlText ? (
            <div style={{ fontSize: 12, marginTop: 6, opacity: 0.95 }}>
              Deadline: {dlText}
              {days != null ? (
                <span style={{
                  marginLeft: 8, padding: "2px 7px", borderRadius: 999,
                  fontSize: 11, fontWeight: 700,
                  background: overdue ? "#7f1d1d" : (days <= 3 ? "#92400e" : "rgba(255,255,255,0.18)"),
                  color: "#fff",
                }}>
                  {overdue
                    ? `${Math.abs(days)}d overdue`
                    : (days === 0 ? "due today" : `${days}d left`)}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Body */}
        <div style={{ padding: "18px 22px" }}>
          <div style={{
            color: "#e2e8f0", fontSize: 13.5, lineHeight: 1.6,
            whiteSpace: "pre-wrap", marginBottom: 14,
          }}>
            {details?.body || ""}
          </div>

          {hasMandinka ? (
            <div style={{ marginBottom: 14 }}>
              <button type="button"
                      onClick={() => setShowMandinka((s) => !s)}
                      style={{
                        all: "unset", cursor: "pointer",
                        color: "#7dd3fc", fontSize: 12, fontWeight: 600,
                        textDecoration: "underline",
                      }}>
                {showMandinka ? "Hide Mandinka translation" : "Show Mandinka translation"}
              </button>
              {showMandinka ? (
                <div style={{
                  marginTop: 8, padding: 12,
                  background: "rgba(15, 23, 42, 0.55)",
                  borderRadius: 8, fontSize: 13, lineHeight: 1.55,
                  color: "#e0f2fe",
                }}>
                  {m_title ? (
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>{m_title}</div>
                  ) : null}
                  {m_body ? (
                    <div style={{ whiteSpace: "pre-wrap" }}>{m_body}</div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Checkboxes */}
          <div style={{ marginBottom: 12 }}>
            {CHECKBOXES.map((label, i) => (
              <label key={i} style={{
                display: "flex", alignItems: "flex-start", gap: 10,
                padding: "8px 4px", cursor: "pointer", fontSize: 13,
                color: "#cbd5e1",
              }}>
                <input
                  type="checkbox"
                  checked={checked[i]}
                  onChange={() => toggleCheck(i)}
                  style={{ marginTop: 2, accentColor: "#14b8a6", flexShrink: 0 }}
                />
                <span style={{ lineHeight: 1.5 }}>{label}</span>
              </label>
            ))}
          </div>

          {/* Signature */}
          <div style={{ marginBottom: 12 }}>
            <label style={lblText}>Type your full name as your signature</label>
            <input
              ref={sigRef}
              type="text"
              autoComplete="name"
              value={signature}
              onChange={(e) => { setSignature(e.target.value);
                                 setFieldErrors((f) => ({ ...f, signature: "" })); }}
              placeholder="e.g. Fatou Jallow"
              style={{
                ...inp,
                borderColor: fieldErrors.signature ? "#f87171" : "rgba(148,163,184,0.30)",
              }}
            />
            {fieldErrors.signature ? (
              <div style={errText}>{fieldErrors.signature}</div>
            ) : null}
          </div>

          {/* PIN */}
          <div style={{ marginBottom: 8 }}>
            <label style={lblText}>Enter your PIN to confirm</label>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={pin}
              onChange={(e) => { setPin(e.target.value.replace(/\D/g, "").slice(0, 8));
                                 setFieldErrors((f) => ({ ...f, pin: "" })); }}
              placeholder="••••"
              style={{
                ...inp, letterSpacing: 4, textAlign: "center",
                borderColor: fieldErrors.pin ? "#f87171" : "rgba(148,163,184,0.30)",
              }}
            />
            {fieldErrors.pin ? (
              <div style={errText}>{fieldErrors.pin}</div>
            ) : null}
          </div>

          {submitError ? (
            <div style={{
              marginTop: 10, padding: "8px 12px",
              background: "rgba(127, 29, 29, 0.35)",
              border: "1px solid rgba(248, 113, 113, 0.4)",
              borderRadius: 8, color: "#fecaca", fontSize: 12.5, lineHeight: 1.5,
            }}>
              ⚠ {submitError}
            </div>
          ) : null}

          {/* Actions */}
          <div style={{ marginTop: 18, display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button"
                    onClick={onClose}
                    disabled={submitting}
                    style={btnGhost}>
              Cancel
            </button>
            <button type="submit"
                    disabled={!canSubmit}
                    style={canSubmit ? btnPrimary : btnPrimaryDisabled}>
              {submitting ? "Submitting…" : "Accept policy"}
            </button>
          </div>
        </div>
      </form>
    );
  }

  if (!inboxId) return null;
  return backdrop;
}

// ── style tokens ────────────────────────────────────────────────────
const inp = {
  width: "100%", boxSizing: "border-box",
  padding: "10px 12px", marginTop: 6,
  background: "rgba(15, 23, 42, 0.55)",
  border: "1px solid rgba(148, 163, 184, 0.30)",
  borderRadius: 8,
  color: "#f1f5f9", fontSize: 13.5, outline: "none",
  fontFamily: "inherit",
};
const lblText = { fontSize: 11.5, color: "#94a3b8", fontWeight: 600,
                  textTransform: "uppercase", letterSpacing: 0.6 };
const errText = { fontSize: 11.5, color: "#fca5a5", marginTop: 5 };
const btnGhost = {
  padding: "9px 14px", borderRadius: 8,
  background: "rgba(148, 163, 184, 0.15)",
  border: "1px solid rgba(148, 163, 184, 0.30)",
  color: "#e2e8f0", fontSize: 13, fontWeight: 600, cursor: "pointer",
};
const btnPrimary = {
  padding: "9px 16px", borderRadius: 8,
  background: "linear-gradient(135deg, #0f766e, #14b8a6)",
  border: "none", color: "#fff", fontSize: 13, fontWeight: 700,
  cursor: "pointer",
  boxShadow: "0 4px 12px rgba(20,184,166,0.32)",
};
const btnPrimaryDisabled = {
  ...btnPrimary,
  background: "rgba(71, 85, 105, 0.40)",
  color: "#94a3b8", boxShadow: "none", cursor: "not-allowed",
};
