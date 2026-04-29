/**
 * ReviewApplicationModal — centered approval popup for the People page.
 *
 * Replaces the inline expansion panel that lives at the bottom of the
 * applications table. The bootstrap installs a document capture-phase
 * click listener on the green ✓ button (`button.cr-row-action[title="Review & Approve"]`)
 * which:
 *   - calls e.stopImmediatePropagation() so React never sees the click
 *     and the inline panel is never expanded;
 *   - reads the registration_id from the first cell of the row;
 *   - dispatches `amina:approve-modal:open` with { rid, returnFocusEl }.
 *
 * This component listens for that event, fetches the full application
 * detail via /admin/applications/{rid}, and renders a centered modal
 * with sticky-footer action buttons.
 *
 * Submit logic mirrors People.jsx#reviewApp exactly:
 *   POST /api/v1/caregiver-v2/admin/review/{rid}
 *     { decision, note, rejection_reason?, skip_remaining, alkalo_phone? }
 *
 * The existing AdminReviewToast wraps fetch and shows a center-top
 * toast on success/failure, so this modal just closes on success.
 *
 * Dirty-tracking: outside-click closes only when the form is pristine.
 * Escape closes regardless. Cancel closes regardless.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { adminToken } from "./adminNotificationsApi.js";

const Z_INDEX = 9310;

const ROLE_LABELS_MAP = {
  vhw:    "VHW",
  cbc:    "CBC",
  chn:    "CHN",
  tba:    "TBA",
  family: "Family Caregiver",
  scout:  "Youth Scout",
  alkalo: "Alkalo",
};
const ROLE_COLORS = {
  vhw:    "#22c55e",
  cbc:    "#0ea5e9",
  chn:    "#a855f7",
  tba:    "#ec4899",
  family: "#f59e0b",
  scout:  "#06b6d4",
  alkalo: "#eab308",
};

function _base() {
  const raw = (typeof window !== "undefined" && window.AMINA_API)
           || (typeof window !== "undefined" && window.__AMINA_API_BASE__)
           || (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_BASE)
           || "http://localhost:8000";
  return String(raw).replace(/\/+$/, "");
}

function _headers() {
  const tok = adminToken()
            || (typeof localStorage !== "undefined" && (
                 localStorage.getItem("AMINA_ADMIN_TOKEN")
              || localStorage.getItem("AMINA_TOKEN")))
            || "";
  return tok
    ? { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
    });
  } catch { return "—"; }
}

function initials(name) {
  return (name || "")
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "").join("") || "?";
}

export default function ReviewApplicationModal({ rid, returnFocusEl, onClose }) {
  const [app,        setApp]        = useState(null);
  const [loadErr,    setLoadErr]    = useState("");
  const [note,       setNote]       = useState("");
  const [skipRest,   setSkipRest]   = useState(false);
  const [alkaloPh,   setAlkaloPh]   = useState("");
  const [auditOpen,  setAuditOpen]  = useState(false);
  const [busy,       setBusy]       = useState(false);
  const [submitErr,  setSubmitErr]  = useState("");
  const [confirmReject, setConfirmReject] = useState(false);
  const [rejReason,  setRejReason]  = useState("");

  const noteRef   = useRef(null);
  const cardRef   = useRef(null);

  const isPristine = useMemo(() => (
    !note.trim() && !skipRest && !alkaloPh.trim()
    && !confirmReject && !rejReason.trim()
  ), [note, skipRest, alkaloPh, confirmReject, rejReason]);

  // ── Fetch full application detail ─────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    if (!rid) return;
    fetch(`${_base()}/api/v1/caregiver-v2/admin/applications/${encodeURIComponent(rid)}`,
      { credentials: "include", headers: _headers() })
      .then(async (r) => {
        if (!r.ok) {
          throw new Error((await r.json().catch(() => ({}))).detail
                          || `Could not load application (${r.status})`);
        }
        return r.json();
      })
      .then((j) => { if (!cancelled) setApp(j); })
      .catch((e) => { if (!cancelled) setLoadErr(e.message || "Load failed"); });
    return () => { cancelled = true; };
  }, [rid]);

  // ── Focus management ──────────────────────────────────────────────
  useEffect(() => {
    if (app && noteRef.current) {
      try { noteRef.current.focus(); } catch { /* noop */ }
    }
  }, [app]);

  // Restore focus to the originating button on close.
  useEffect(() => {
    return () => {
      try { returnFocusEl?.focus?.(); } catch { /* noop */ }
    };
  }, [returnFocusEl]);

  // ── Escape closes regardless of dirty state ───────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && !busy) onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  // ── Submit (approve / request_info / reject) ──────────────────────
  const submit = useCallback(async (decision) => {
    if (busy || !app) return;
    setBusy(true);
    setSubmitErr("");
    try {
      const body = {
        decision,
        note: note || "",
        rejection_reason: decision === "reject" ? (rejReason || "Other") : undefined,
        skip_remaining: skipRest,
        alkalo_phone: alkaloPh || undefined,
      };
      const r = await fetch(
        `${_base()}/api/v1/caregiver-v2/admin/review/${encodeURIComponent(rid)}`,
        { method: "POST", credentials: "include", headers: _headers(),
          body: JSON.stringify(body) },
      );
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.detail?.message || j.detail || j.message || `HTTP ${r.status}`);
      }
      // The AdminReviewToast fetch interceptor already shows the toast.
      // We just close the modal — the Bell + table will auto-refresh
      // off `amina:admin-data:refresh` (dispatched by the toast).
      onClose?.();
    } catch (e) {
      setSubmitErr(e.message || "Request failed");
    } finally {
      setBusy(false);
    }
  }, [busy, app, rid, note, rejReason, skipRest, alkaloPh, onClose]);

  // ── Outside click handler (only closes if pristine) ───────────────
  const onBackdropClick = (e) => {
    if (busy) return;
    if (e.target !== e.currentTarget) return;
    if (!isPristine) {
      // Quick visual nudge — flash the card border
      const el = cardRef.current;
      if (el) {
        el.animate([
          { boxShadow: "0 0 0 0 rgba(248,113,113,0)" },
          { boxShadow: "0 0 0 4px rgba(248,113,113,0.45)" },
          { boxShadow: "0 0 0 0 rgba(248,113,113,0)" },
        ], { duration: 320, easing: "ease-out" });
      }
      return;
    }
    onClose?.();
  };

  if (!rid) return null;

  const status     = (app?.status || "pending").toLowerCase();
  const role       = app?.role || "";
  const roleColor  = ROLE_COLORS[role] || "#94a3b8";
  const roleLabel  = ROLE_LABELS_MAP[role] || role || "Caregiver";
  const chain      = app?.approval_chain || [];
  const audit      = app?.audit_log || [];
  const regData    = app?.registration_data || {};
  const needsAlkalo = chain.some((s) => s.step_name === "alkalo_confirmation" && !s.completed);

  return (
    <div
      onClick={onBackdropClick}
      role="presentation"
      style={{
        position: "fixed", inset: 0, zIndex: Z_INDEX,
        background: "rgba(2, 6, 23, 0.62)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "24px",
        fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        animation: "amina-rmodal-fade 160ms ease",
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="amina-rmodal-title"
        style={{
          width: "min(820px, 100%)",
          maxHeight: "min(86vh, 760px)",
          display: "flex", flexDirection: "column",
          background: "#0b1220",
          color: "#e2e8f0",
          border: "1px solid rgba(148, 163, 184, 0.18)",
          borderRadius: 14,
          boxShadow: "0 28px 56px rgba(2, 6, 23, 0.6)",
          animation: "amina-rmodal-pop 220ms cubic-bezier(0.22, 1, 0.36, 1)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "16px 22px",
          borderBottom: "1px solid rgba(148, 163, 184, 0.15)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12,
        }}>
          <div>
            <div id="amina-rmodal-title" style={{
              fontSize: 11.5, fontWeight: 800, letterSpacing: 0.6,
              textTransform: "uppercase", color: "#a78bfa",
            }}>
              Review application
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9", marginTop: 2 }}>
              {app?.full_name || (loadErr ? "Could not load" : "Loading…")}
            </div>
          </div>
          <button onClick={() => !busy && onClose?.()} type="button"
                  aria-label="Close"
                  style={btnIconClose}>×</button>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: "auto", padding: "18px 22px", flex: 1 }}>
          {loadErr ? (
            <div style={{
              padding: "12px 14px", borderRadius: 8,
              background: "rgba(127, 29, 29, 0.30)",
              border: "1px solid rgba(248, 113, 113, 0.40)",
              color: "#fecaca", fontSize: 13,
            }}>⚠ {loadErr}</div>
          ) : !app ? (
            <div style={{ color: "#94a3b8", fontSize: 13, textAlign: "center", padding: 32 }}>
              ⌛ Loading application…
            </div>
          ) : (
            <>
              {/* Identity row */}
              <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 16 }}>
                <div style={{
                  width: 52, height: 52, borderRadius: "50%",
                  background: `linear-gradient(135deg, ${roleColor}, #4338ca)`,
                  color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 17, fontWeight: 800, flexShrink: 0,
                }}>
                  {initials(app.full_name)}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    <span style={{
                      padding: "3px 9px", borderRadius: 6,
                      background: `${roleColor}24`, color: roleColor,
                      border: `1px solid ${roleColor}55`,
                      fontSize: 11, fontWeight: 700,
                    }}>{roleLabel}</span>
                    <span style={{
                      padding: "3px 9px", borderRadius: 6,
                      background: "rgba(148,163,184,0.16)", color: "#cbd5e1",
                      fontSize: 11, fontWeight: 700, fontFamily: "ui-monospace, monospace",
                    }}>{app.registration_id}</span>
                    <span style={{
                      padding: "3px 9px", borderRadius: 6, fontSize: 11, fontWeight: 700,
                      background: "rgba(99, 102, 241, 0.14)",
                      color: "#c7d2fe",
                      border: "1px solid rgba(129, 140, 248, 0.30)",
                    }}>{status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</span>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 13, color: "#cbd5e1" }}>
                    {app.phone || "—"}
                  </div>
                </div>
              </div>

              {/* Compact metadata grid */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                gap: 10, marginBottom: 18,
                padding: 12,
                background: "rgba(15, 23, 42, 0.55)",
                border: "1px solid rgba(148, 163, 184, 0.15)",
                borderRadius: 10,
              }}>
                <Meta label="Village"     value={app.village || "—"} />
                <Meta label="Region"      value={app.health_region || "—"} />
                <Meta label="Submitted"   value={fmtDate(app.submitted_at)} />
                {regData.alkalo_name    ? <Meta label="Alkalo"     value={regData.alkalo_name} /> : null}
                {regData.facility_name  ? <Meta label="Facility"   value={regData.facility_name} /> : null}
                {regData.employee_id    ? <Meta label="Employee ID" value={regData.employee_id} /> : null}
                {regData.relationship   ? <Meta label="Relationship" value={regData.relationship} /> : null}
                {regData.invite_status  ? <Meta label="Invite"     value={regData.invite_status} /> : null}
              </div>

              {/* Approval chain */}
              {chain.length > 0 && (
                <div style={{ marginBottom: 18 }}>
                  <div style={lblText}>Approval chain</div>
                  <div style={{
                    marginTop: 6, padding: 10,
                    background: "rgba(15, 23, 42, 0.55)",
                    border: "1px solid rgba(148, 163, 184, 0.15)",
                    borderRadius: 8,
                    display: "flex", flexWrap: "wrap", gap: 8,
                  }}>
                    {chain.map((step, idx) => (
                      <span key={idx} style={{
                        padding: "5px 10px", borderRadius: 999,
                        fontSize: 11, fontWeight: 600,
                        background: step.completed
                          ? "rgba(34, 197, 94, 0.16)"
                          : "rgba(148, 163, 184, 0.14)",
                        color: step.completed ? "#86efac" : "#94a3b8",
                        border: step.completed
                          ? "1px solid rgba(34, 197, 94, 0.35)"
                          : "1px solid rgba(148, 163, 184, 0.20)",
                      }}>
                        {step.completed ? "✓ " : ""}{(step.step_name || "").replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Alkalo phone (only when chain needs it) */}
              {needsAlkalo && (
                <div style={{ marginBottom: 14 }}>
                  <label style={lblText}>Alkalo phone (for SMS confirmation)</label>
                  <input
                    type="tel"
                    value={alkaloPh}
                    onChange={(e) => setAlkaloPh(e.target.value)}
                    placeholder="+220XXXXXXX"
                    style={inp}
                  />
                </div>
              )}

              {/* Admin note */}
              <div style={{ marginBottom: 14 }}>
                <label style={lblText} htmlFor="amina-rmodal-note">Admin note (optional)</label>
                <textarea
                  id="amina-rmodal-note"
                  ref={noteRef}
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Reasoning, follow-up steps, or context for the audit log…"
                  style={{ ...inp, resize: "vertical", minHeight: 70, fontFamily: "inherit" }}
                />
              </div>

              {/* Skip remaining */}
              <label style={{
                display: "flex", gap: 10, alignItems: "flex-start",
                padding: "10px 12px",
                background: "rgba(251, 191, 36, 0.08)",
                border: "1px solid rgba(251, 191, 36, 0.30)",
                borderRadius: 8, cursor: "pointer",
                marginBottom: 14,
              }}>
                <input type="checkbox" checked={skipRest}
                       onChange={(e) => setSkipRest(e.target.checked)}
                       style={{ marginTop: 2, accentColor: "#f59e0b" }} />
                <div>
                  <div style={{ color: "#fbbf24", fontWeight: 700, fontSize: 12.5 }}>
                    Admin override — skip remaining steps and activate immediately
                  </div>
                  <div style={{ color: "#fcd34d", fontSize: 11, marginTop: 2, opacity: 0.8 }}>
                    Use only when downstream steps are not applicable (e.g. patient-confirmation
                    on a manually-verified family caregiver).
                  </div>
                </div>
              </label>

              {/* Reject section (toggle) */}
              <details
                open={confirmReject}
                onToggle={(e) => setConfirmReject(e.target.open)}
                style={{
                  border: "1px solid rgba(248, 113, 113, 0.25)",
                  borderRadius: 8,
                  marginBottom: 14,
                  background: "rgba(127, 29, 29, 0.10)",
                }}>
                <summary style={{
                  cursor: "pointer", padding: "8px 12px",
                  fontSize: 12, color: "#fca5a5", fontWeight: 700,
                  listStyle: "none",
                }}>
                  ✕ Reject this application instead…
                </summary>
                <div style={{ padding: "8px 12px 12px" }}>
                  <label style={lblText}>Rejection reason</label>
                  <input value={rejReason}
                         onChange={(e) => setRejReason(e.target.value)}
                         placeholder="Cannot verify identity / Duplicate registration / Other…"
                         style={inp} />
                </div>
              </details>

              {/* Audit log (collapsed) */}
              {audit.length > 0 && (
                <details
                  open={auditOpen}
                  onToggle={(e) => setAuditOpen(e.target.open)}
                  style={{
                    marginBottom: 6,
                    border: "1px solid rgba(148, 163, 184, 0.15)",
                    borderRadius: 8, background: "rgba(15, 23, 42, 0.4)",
                  }}>
                  <summary style={{
                    cursor: "pointer", padding: "8px 12px",
                    color: "#94a3b8", fontSize: 12, fontWeight: 700,
                    listStyle: "none",
                  }}>
                    Audit log ({audit.length})
                  </summary>
                  <ul style={{ listStyle: "none", padding: "0 12px 12px", margin: 0 }}>
                    {audit.map((e, i) => (
                      <li key={i} style={{
                        padding: "6px 0",
                        borderTop: i ? "1px solid rgba(148,163,184,0.10)" : "none",
                        fontSize: 11.5, color: "#cbd5e1",
                      }}>
                        <div style={{ color: "#94a3b8", fontSize: 10.5,
                                       fontFamily: "ui-monospace, monospace" }}>
                          {fmtDate(e.ts)} · {e.by}
                        </div>
                        <div style={{ marginTop: 2 }}>
                          <span style={{ fontWeight: 700, color: "#e2e8f0" }}>
                            {(e.action || "").replace(/_/g, " ")}
                          </span>
                          {e.detail ? <> — {e.detail}</> : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {submitErr ? (
                <div style={{
                  marginTop: 10, padding: "8px 12px",
                  background: "rgba(127, 29, 29, 0.30)",
                  border: "1px solid rgba(248, 113, 113, 0.40)",
                  borderRadius: 8, color: "#fecaca", fontSize: 12.5,
                }}>⚠ {submitErr}</div>
              ) : null}
            </>
          )}
        </div>

        {/* Sticky footer */}
        <div style={{
          padding: "12px 22px",
          borderTop: "1px solid rgba(148, 163, 184, 0.15)",
          background: "rgba(11, 18, 32, 0.96)",
          display: "flex", justifyContent: "space-between", gap: 10,
          flexWrap: "wrap",
        }}>
          <button type="button" onClick={() => !busy && onClose?.()}
                  disabled={busy}
                  style={btnGhost}>
            Cancel
          </button>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {confirmReject ? (
              <button type="button" onClick={() => submit("reject")}
                      disabled={busy || !app || !rejReason.trim()}
                      style={busy || !app || !rejReason.trim() ? btnRejectDisabled : btnReject}>
                {busy ? "Submitting…" : "Confirm reject"}
              </button>
            ) : (
              <>
                <button type="button" onClick={() => submit("request_info")}
                        disabled={busy || !app}
                        style={btnAmber}>
                  {busy ? "…" : "Request more info"}
                </button>
                <button type="button" onClick={() => submit("approve")}
                        disabled={busy || !app}
                        style={busy || !app ? btnApproveDisabled : btnApprove}>
                  {busy ? "Submitting…"
                        : (needsAlkalo && !skipRest ? "Approve & send to Alkalo"
                                                    : "Approve & activate")}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes amina-rmodal-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes amina-rmodal-pop {
          from { transform: translateY(8px); opacity: 0; }
          to   { transform: translateY(0);   opacity: 1; }
        }
        details[open] > summary::after {
          content: "▾"; float: right; opacity: 0.6;
        }
        details:not([open]) > summary::after {
          content: "▸"; float: right; opacity: 0.6;
        }
      `}</style>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────
function Meta({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b",
                     textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</div>
      <div style={{ fontSize: 12.5, color: "#e2e8f0", fontWeight: 500, marginTop: 2 }}>{value}</div>
    </div>
  );
}

// ── Style tokens ──────────────────────────────────────────────────
const lblText = {
  fontSize: 11, fontWeight: 700, color: "#94a3b8",
  textTransform: "uppercase", letterSpacing: 0.6,
};
const inp = {
  width: "100%", boxSizing: "border-box",
  padding: "10px 12px", marginTop: 6,
  background: "rgba(15, 23, 42, 0.55)",
  border: "1px solid rgba(148, 163, 184, 0.30)",
  borderRadius: 8,
  color: "#f1f5f9", fontSize: 13, outline: "none",
};
const btnIconClose = {
  width: 30, height: 30, borderRadius: 8,
  border: "none", background: "rgba(255,255,255,0.08)",
  color: "#e2e8f0", fontSize: 18, cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
};
const btnGhost = {
  padding: "9px 14px", borderRadius: 8,
  background: "rgba(148, 163, 184, 0.15)",
  border: "1px solid rgba(148, 163, 184, 0.30)",
  color: "#e2e8f0", fontSize: 13, fontWeight: 600, cursor: "pointer",
};
const btnAmber = {
  padding: "9px 14px", borderRadius: 8,
  background: "rgba(251, 191, 36, 0.14)",
  border: "1px solid rgba(251, 191, 36, 0.45)",
  color: "#fbbf24", fontSize: 13, fontWeight: 700, cursor: "pointer",
};
const btnApprove = {
  padding: "9px 18px", borderRadius: 8, border: "none",
  background: "linear-gradient(135deg, #16a34a, #22c55e)",
  color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
  boxShadow: "0 4px 14px rgba(22, 163, 74, 0.40)",
};
const btnApproveDisabled = {
  ...btnApprove,
  background: "rgba(71, 85, 105, 0.40)", color: "#94a3b8",
  boxShadow: "none", cursor: "not-allowed",
};
const btnReject = {
  padding: "9px 16px", borderRadius: 8, border: "none",
  background: "linear-gradient(135deg, #dc2626, #b91c1c)",
  color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
};
const btnRejectDisabled = {
  ...btnReject,
  background: "rgba(71, 85, 105, 0.40)", color: "#94a3b8",
  boxShadow: "none", cursor: "not-allowed",
};
