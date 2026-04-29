/**
 * ConsentGate — full-screen synthetic-data consent overlay
 * =========================================================
 *
 * Mandatory disclaimer + dual-checkbox gate that appears BEFORE
 * any Observatory access. Cannot be dismissed without explicit
 * acceptance of both clauses. Re-accept every browser session.
 *
 * Storage:
 *   - sessionStorage["amina_observatory_consent"] = consent_id
 *   - server-side audit + Redis-backed receipt (8h TTL) via
 *     POST /api/v1/observatory/consent
 *
 * Flow:
 *   1. parent renders <ConsentGate open onAccept={...} onCancel={...} />
 *   2. user reads disclaimer, ticks both boxes, clicks Proceed
 *   3. POST /observatory/consent -> 200 + receipt
 *   4. consent_id stored in sessionStorage; onAccept() fires
 *
 * Bypass-resistant:
 *   - No "remember me" -- every new session re-prompts
 *   - Cookie is session-scoped (cleared on browser close)
 *   - No persistent localStorage write
 *
 * Caller is responsible for routing logic (e.g. AdminShell:
 * if not consented, render <ConsentGate>; only after onAccept,
 * render <GovPortalModal>).
 */

import { useEffect, useState } from "react";
import {
  X, AlertTriangle, ShieldCheck, ArrowRight, ExternalLink, Info,
} from "lucide-react";

import { Button } from "./primitives/index.jsx";


const API = ((typeof window !== "undefined" && window.AMINA_API) || "http://localhost:8000")
  .replace(/\/+$/, "");

const STORAGE_KEY = "amina_observatory_consent";


// 5-stripe Gambian flag for the brand strip
function GambianFlag({ height = 22 }) {
  const w = Math.round(height * 1.5);
  const u = height / 10;
  return (
    <span style={{
      display: "inline-block", width: w, height,
      borderRadius: 2, overflow: "hidden", flexShrink: 0,
      boxShadow: "0 0 0 1px rgba(255,255,255,0.18) inset",
    }} aria-hidden="true">
      <div style={{ height: u * 2, background: "#CE1126" }} />
      <div style={{ height: u,     background: "#fff"    }} />
      <div style={{ height: u * 4, background: "#0C1C8C" }} />
      <div style={{ height: u,     background: "#fff"    }} />
      <div style={{ height: u * 2, background: "#3A7728" }} />
    </span>
  );
}


/* ─── helpers ──────────────────────────────────────────────────── */

export function getStoredConsentId() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function clearStoredConsent() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {}
}

// Verifies a stored consent_id is still server-side valid.
// Returns true/false. Failures default to false (re-prompt).
export async function verifyConsent(consentId) {
  if (!consentId) return false;
  try {
    const r = await fetch(
      `${API}/api/v1/observatory/consent/${encodeURIComponent(consentId)}`,
      { credentials: "include" },
    );
    if (!r.ok) return false;
    const d = await r.json();
    return d.valid === true;
  } catch {
    return false;
  }
}


/* ─── CSS (one-shot inject) ────────────────────────────────────── */

const CG_CSS = `
@keyframes cg-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes cg-rise {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0);    }
}
@keyframes cg-shake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-5px); }
  40%, 80% { transform: translateX(5px); }
}

.cg-overlay {
  position: fixed; inset: 0;
  background: var(--a-bg, #06080d);
  z-index: 96;
  overflow-y: auto;
  animation: cg-fade 240ms ease;
}
.cg-bg {
  position: fixed; inset: 0; pointer-events: none; z-index: -1;
  background:
    radial-gradient(900px 500px at 15% 12%, rgba(251,191,36,0.10), transparent 60%),
    radial-gradient(700px 400px at 85% 85%, rgba(248,113,113,0.06), transparent 60%);
}
.cg-frame {
  min-height: 100vh;
  display: grid; place-items: center;
  padding: 32px 22px;
}
.cg-card {
  width: 100%; max-width: 720px;
  background: linear-gradient(180deg,
    color-mix(in oklab, var(--a-bg-elev-1, #161c27), transparent 5%),
    color-mix(in oklab, var(--a-bg-elev-1, #11161f), transparent 5%));
  border: 1px solid var(--a-border-2);
  border-radius: 18px;
  box-shadow: 0 24px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.02) inset;
  overflow: hidden; position: relative;
  animation: cg-rise 320ms ease;
}
.cg-card::before {
  content: ""; position: absolute; inset: 0 0 auto 0; height: 3px;
  background: linear-gradient(90deg, #fbbf24 0%, #fb923c 50%, #f87171 100%);
}

/* Ministry header */
.cg-header {
  padding: 20px 28px 18px;
  display: flex; align-items: center; gap: 14px;
  border-bottom: 1px solid var(--a-border-1);
  background: linear-gradient(90deg,
    rgba(206,17,38,0.10) 0%, rgba(12,28,140,0.14) 50%, rgba(58,119,40,0.10) 100%);
}
.cg-header-text { display: flex; flex-direction: column; gap: 2px; }
.cg-header-ministry {
  font-size: 11px; letter-spacing: 0.22em;
  font-weight: 700; color: #fff; text-transform: uppercase;
}
.cg-header-sub {
  font-size: 10.5px; letter-spacing: 0.16em;
  color: var(--a-fg-dim); text-transform: uppercase; font-weight: 500;
}

/* Body */
.cg-body {
  padding: 26px 32px 8px;
  display: flex; flex-direction: column; gap: 18px;
}

.cg-warn {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 14px 16px;
  background: rgba(251,191,36,0.08);
  border: 1px solid rgba(251,191,36,0.30);
  border-radius: 12px;
}
.cg-warn-icon {
  width: 22px; height: 22px; color: #fcd34d; flex: none; margin-top: 1px;
}
.cg-warn-title {
  font-size: 13px; font-weight: 700; color: #fcd34d;
  letter-spacing: 0.05em; text-transform: uppercase;
}
.cg-warn-body {
  font-size: 13px; color: var(--a-fg); line-height: 1.55; margin-top: 4px;
}
.cg-warn-body b { color: #fcd34d; }

.cg-section-title {
  font-family: var(--a-font-disp);
  font-weight: 500; font-size: 17px;
  color: #fff; letter-spacing: -0.2px;
}

.cg-clauses {
  margin: 0; padding: 0; list-style: none;
  display: flex; flex-direction: column; gap: 10px;
}
.cg-clauses li {
  display: flex; gap: 10px;
  font-size: 13px; color: var(--a-fg-mute); line-height: 1.55;
}
.cg-clauses-num {
  flex: none; width: 22px; height: 22px;
  border-radius: 50%;
  background: rgba(167,139,250,0.14);
  color: #c4b5fd;
  font-size: 11px; font-weight: 700;
  font-family: var(--a-font-mono);
  display: grid; place-items: center;
}

/* Checkboxes */
.cg-checks {
  display: flex; flex-direction: column; gap: 12px;
  padding: 16px;
  background: var(--a-bg-inset);
  border: 1px solid var(--a-border-1);
  border-radius: 12px;
}
.cg-check {
  display: flex; align-items: flex-start; gap: 12px;
  cursor: pointer; user-select: none;
  padding: 4px;
  transition: background 140ms;
  border-radius: 6px;
}
.cg-check:hover { background: rgba(255,255,255,0.02); }

.cg-check-box {
  flex: none;
  width: 18px; height: 18px;
  border: 2px solid var(--a-border-2);
  border-radius: 5px;
  background: var(--a-bg);
  display: grid; place-items: center;
  transition: all 180ms ease;
  margin-top: 1px;
}
.cg-check-box-checked {
  border-color: #34d399;
  background: #34d399;
}
.cg-check-box-checked svg {
  color: #06080d;
  animation: cg-rise 200ms ease;
}
.cg-check-text {
  font-size: 13px;
  color: var(--a-fg);
  line-height: 1.55;
}
.cg-check-required {
  font-size: 10.5px;
  color: #fcd34d;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  font-weight: 600;
  margin-top: 4px;
}

.cg-actions {
  padding: 18px 32px 22px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-top: 1px solid var(--a-border-1);
  background: rgba(255,255,255,0.01);
}
.cg-actions-row {
  display: flex; align-items: center; gap: 10px;
}
.cg-cancel {
  background: transparent; border: 1px solid var(--a-border-1);
  color: var(--a-fg-mute); cursor: pointer;
  padding: 11px 18px; border-radius: 11px;
  font-size: 13px; font-weight: 500;
  font-family: var(--a-font-ui);
  transition: all 140ms;
}
.cg-cancel:hover { color: var(--a-fg); border-color: var(--a-border-2); }

.cg-proceed {
  flex: 1;
  padding: 13px 18px;
  border-radius: 11px; border: 0;
  background: linear-gradient(135deg, #6d4ce8 0%, #7c3aed 50%, #a78bfa 100%);
  color: #fff;
  font-size: 14px; font-weight: 600; letter-spacing: 0.2px;
  cursor: pointer;
  box-shadow: 0 8px 18px rgba(124,58,237,0.30);
  display: flex; align-items: center; justify-content: center; gap: 8px;
  transition: all 140ms ease;
  font-family: var(--a-font-ui);
}
.cg-proceed:disabled {
  opacity: 0.45; cursor: not-allowed; box-shadow: none;
}
.cg-proceed:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 12px 26px rgba(124,58,237,0.40);
}

.cg-disclaimer-link {
  font-size: 11.5px;
  color: var(--a-fg-dim);
  text-align: center;
  margin-top: 4px;
}
.cg-disclaimer-link a {
  color: #c4b5fd; text-decoration: none;
  border-bottom: 1px dashed rgba(167,139,250,0.40);
}

.cg-foot {
  font-size: 11px; color: var(--a-fg-dim);
  line-height: 1.55; padding: 14px 32px 18px;
  border-top: 1px solid var(--a-border-1);
  background: rgba(255,255,255,0.01);
}
.cg-foot b { color: var(--a-fg-mute); font-weight: 500; }

.cg-error {
  margin: 0 32px;
  padding: 10px 12px; border-radius: 10px;
  background: rgba(248,113,113,0.10);
  border: 1px solid rgba(248,113,113,0.35);
  color: #fecaca;
  font-size: 12.5px; font-weight: 500;
  animation: cg-shake 400ms ease;
}

.cg-x-close {
  position: absolute; top: 14px; right: 16px;
  background: transparent; border: 0;
  color: var(--a-fg-dim); cursor: pointer;
  width: 32px; height: 32px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  transition: all 140ms;
  z-index: 2;
}
.cg-x-close:hover {
  color: var(--a-fg); background: rgba(255,255,255,0.05);
}

@media (max-width: 600px) {
  .cg-body, .cg-actions, .cg-foot { padding-left: 22px; padding-right: 22px; }
  .cg-header { padding: 16px 22px; }
}
`;

if (typeof document !== "undefined" && !document.getElementById("amina-cg-css")) {
  const s = document.createElement("style");
  s.id = "amina-cg-css";
  s.textContent = CG_CSS;
  document.head.appendChild(s);
}


/* ─── component ───────────────────────────────────────────────── */

export default function ConsentGate({
  open,
  onAccept,
  onCancel,
  onShowDisclaimer,
}) {
  const [acceptedSynthetic, setAcceptedSynthetic]   = useState(false);
  const [acceptedNoRealUse, setAcceptedNoRealUse]   = useState(false);
  const [busy, setBusy]                             = useState(false);
  const [error, setError]                           = useState("");

  // Reset on open
  useEffect(() => {
    if (open) {
      setAcceptedSynthetic(false);
      setAcceptedNoRealUse(false);
      setBusy(false);
      setError("");
    }
  }, [open]);

  // ESC closes (cancel)
  useEffect(() => {
    if (!open) return;
    const fn = (e) => { if (e.key === "Escape") onCancel?.(); };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [open, onCancel]);

  if (!open) return null;

  const canProceed = acceptedSynthetic && acceptedNoRealUse && !busy;

  const proceed = async () => {
    if (!canProceed) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`${API}/api/v1/observatory/consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          accepted_synthetic:   acceptedSynthetic,
          accepted_no_real_use: acceptedNoRealUse,
        }),
      });
      const d = await r.json().catch(() => ({}));

      if (!r.ok) {
        const detail = d.detail || {};
        setError(detail.message || "Could not record consent.");
        setBusy(false);
        return;
      }

      try {
        sessionStorage.setItem(STORAGE_KEY, d.consent_id);
      } catch {}
      setBusy(false);
      onAccept?.(d.consent_id, d.receipt);
    } catch {
      setError("Network error -- check your connection and try again.");
      setBusy(false);
    }
  };

  return (
    <div className="cg-overlay">
      <div className="cg-bg" />

      <div className="cg-frame">
        <div className="cg-card">

          {onCancel && (
            <button type="button" className="cg-x-close"
                    onClick={onCancel} aria-label="Cancel">
              <X size={16} />
            </button>
          )}

          {/* Ministry header */}
          <div className="cg-header">
            <GambianFlag height={26} />
            <div className="cg-header-text">
              <span className="cg-header-ministry">Ministry of Health · The Gambia</span>
              <span className="cg-header-sub">
                NCD Observatory · Architecture Demonstration
              </span>
            </div>
          </div>

          {/* Body */}
          <div className="cg-body">
            <div className="cg-warn">
              <AlertTriangle className="cg-warn-icon" />
              <div>
                <div className="cg-warn-title">Important Notice</div>
                <div className="cg-warn-body">
                  This system contains <b>SYNTHETIC DATA ONLY</b>.
                  No real patient information is stored, displayed, or
                  processed in this demonstration environment.
                </div>
              </div>
            </div>

            <div>
              <div className="cg-section-title" style={{ marginBottom: 8 }}>
                What you are about to access
              </div>
              <p style={{
                fontSize: 13, color: "var(--a-fg-mute)", lineHeight: 1.6,
                margin: 0,
              }}>
                All patient names, health readings, consultation records,
                facility statistics, and demographic data shown in this
                system are <b style={{ color: "var(--a-fg)" }}>artificially
                generated</b> for the sole purpose of demonstrating the
                AMINA NCD Observatory architecture.
              </p>
            </div>

            <div>
              <div className="cg-section-title" style={{ marginBottom: 12 }}>
                By proceeding, you acknowledge and agree
              </div>
              <ol className="cg-clauses">
                <li>
                  <span className="cg-clauses-num">1</span>
                  <span>
                    All data within this system is synthetic and does not
                    represent any real individual, community, or health
                    facility in The Gambia or elsewhere.
                  </span>
                </li>
                <li>
                  <span className="cg-clauses-num">2</span>
                  <span>
                    No clinical, policy, or operational decisions should
                    be made based on any data displayed in this system.
                  </span>
                </li>
                <li>
                  <span className="cg-clauses-num">3</span>
                  <span>
                    You are viewing a <b style={{ color: "var(--a-fg)" }}>
                    technical architecture demonstration</b>, not a
                    production health surveillance system.
                  </span>
                </li>
                <li>
                  <span className="cg-clauses-num">4</span>
                  <span>
                    Screenshots or exports must be clearly labeled as
                    "SYNTHETIC DATA" if shared externally.
                  </span>
                </li>
                <li>
                  <span className="cg-clauses-num">5</span>
                  <span>
                    This demonstration complies with the principles of
                    The Gambia's health data governance framework and
                    WHO guidelines on health information systems.
                  </span>
                </li>
              </ol>
            </div>

            <div className="cg-checks">
              <label className="cg-check">
                <span className={`cg-check-box${acceptedSynthetic ? " cg-check-box-checked" : ""}`}>
                  {acceptedSynthetic && (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" strokeWidth="3.5"
                         strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </span>
                <input type="checkbox"
                       checked={acceptedSynthetic}
                       onChange={(e) => setAcceptedSynthetic(e.target.checked)}
                       style={{ position: "absolute", opacity: 0, pointerEvents: "none" }} />
                <span className="cg-check-text">
                  I understand that <b>ALL data in this system is synthetic</b>{" "}
                  and this is an architecture demonstration only.
                </span>
              </label>

              <label className="cg-check">
                <span className={`cg-check-box${acceptedNoRealUse ? " cg-check-box-checked" : ""}`}>
                  {acceptedNoRealUse && (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" strokeWidth="3.5"
                         strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </span>
                <input type="checkbox"
                       checked={acceptedNoRealUse}
                       onChange={(e) => setAcceptedNoRealUse(e.target.checked)}
                       style={{ position: "absolute", opacity: 0, pointerEvents: "none" }} />
                <span className="cg-check-text">
                  I agree <b>not to interpret, cite, or use</b> any data
                  shown as representing real health statistics of The Gambia.
                </span>
              </label>

              <div style={{
                fontSize: 10.5, color: "#fcd34d",
                letterSpacing: "0.06em", textTransform: "uppercase",
                fontWeight: 600, marginTop: 2, opacity: 0.85,
              }}>
                Both checkboxes required to proceed
              </div>
            </div>
          </div>

          {error && <div className="cg-error">{error}</div>}

          {/* Actions */}
          <div className="cg-actions">
            <div className="cg-actions-row">
              <button type="button" className="cg-cancel" onClick={onCancel}>
                Cancel
              </button>
              <button type="button"
                      className="cg-proceed"
                      onClick={proceed}
                      disabled={!canProceed}>
                {busy ? "Recording consent..." : (
                  <>
                    Proceed to Observatory Login
                    <ArrowRight size={14} />
                  </>
                )}
              </button>
            </div>
            <div className="cg-disclaimer-link">
              {onShowDisclaimer ? (
                <>
                  Read the{" "}
                  <a href="#" onClick={(e) => { e.preventDefault(); onShowDisclaimer(); }}>
                    full legal disclaimer <ExternalLink size={10} style={{ verticalAlign: "-1px" }} />
                  </a>
                </>
              ) : (
                <span style={{ opacity: 0.6 }}>
                  Full legal disclaimer available at <code>/observatory/disclaimer</code>
                </span>
              )}
            </div>
          </div>

          <div className="cg-foot">
            For inquiries about real NCD data, contact{" "}
            <b>MoH Directorate of Health Services</b> or the{" "}
            <b>WHO Gambia Country Office</b>. Your consent is recorded for
            audit purposes (timestamp, IP address) and expires when this
            browser session ends.
          </div>
        </div>
      </div>
    </div>
  );
}
