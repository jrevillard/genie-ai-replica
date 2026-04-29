/**
 * PrivacyPanel — patient-facing data sharing + DHIS2 referral inbox
 *
 * Patients can:
 *   1. See their current consent flags (4 scopes) and toggle them
 *   2. View incoming DHIS2 referrals from CHWs / Ministry of Health
 *   3. Acknowledge referrals
 *   4. See a consent change history (audit trail)
 *
 * Props:
 *   token   — patient JWT
 *   patient — { id, name, ... }
 *   onClose — close overlay
 */

import { useEffect, useState, useCallback } from "react";

const API = (window.AMINA_API || "http://localhost:8000").replace(/\/+$/, "");

function authH(token) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

// ── Design tokens (match CaregiverDirectory) ─────────────────────────────────
const C = {
  bg:        "#f8fafc",
  card:      "#ffffff",
  border:    "#e2e8f0",
  accent:    "#6366f1",
  accentBg:  "#eef2ff",
  green:     "#10b981",
  greenBg:   "#f0fdf4",
  amber:     "#f59e0b",
  amberBg:   "#fefce8",
  text:      "#0f172a",
  muted:     "#64748b",
  subtle:    "#94a3b8",
  danger:    "#ef4444",
};

// ── Scope metadata (patient-friendly language) ───────────────────────────────
const SCOPES = [
  {
    key:       "dhis2_aggregate",
    label:     "Anonymous health statistics",
    sub:       "Always on",
    locked:    true,
    summary:
      "AMINA Care shares daily counts of visits and health conditions with the Ministry of Health. " +
      "No names, phone numbers, or personal details are ever included — only anonymous totals per region.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/>
      </svg>
    ),
  },
  {
    key:       "dhis2_tracker",
    label:     "Share my health record with Ministry of Health",
    sub:       "Your choice",
    locked:    false,
    summary:
      "When ON, your consultations, conditions, and medications are shared with the Gambia Ministry of Health's " +
      "official health record system (DHIS2). This helps CHWs and doctors who see you in person access your " +
      "AMINA Care history. You can turn this off at any time.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/>
      </svg>
    ),
  },
  {
    key:       "fhir_export",
    label:     "Allow downloading my health record",
    sub:       "Your choice",
    locked:    false,
    summary:
      "When ON, you can download your complete health record as a standard medical file (HL7 FHIR). " +
      "Useful if you want to share your history with another clinic or doctor outside AMINA Care.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
    ),
  },
  {
    key:       "research",
    label:     "Help improve community health research",
    sub:       "Your choice",
    locked:    false,
    summary:
      "When ON, your anonymized health data may be used in AMINA Care research projects to improve care for " +
      "other Gambians. Your name, phone number, and location are never shared — only general patterns like " +
      "'how patients with diabetes responded to Ramadan'. This is completely optional.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v20M2 12h20"/><circle cx="12" cy="12" r="10"/>
      </svg>
    ),
  },
];

// ── Consent toggle card ──────────────────────────────────────────────────────
function ConsentCard({ scope, value, locked, onToggle, loading }) {
  return (
    <div style={{
      background: C.card, borderRadius: 14, border: `1px solid ${C.border}`,
      padding: 18, marginBottom: 12,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10, flexShrink: 0,
          background: value ? C.accentBg : "#f1f5f9",
          color: value ? C.accent : C.muted,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {scope.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{scope.label}</div>
            {locked ? (
              <div style={{
                padding: "3px 10px", borderRadius: 20, fontSize: 10, fontWeight: 700,
                background: C.greenBg, color: "#15803d", border: "1px solid #bbf7d0",
                textTransform: "uppercase", letterSpacing: ".5px", flexShrink: 0,
              }}>Always on</div>
            ) : (
              <button
                onClick={() => !loading && onToggle(!value)}
                disabled={loading}
                style={{
                  position: "relative",
                  width: 44, height: 24, borderRadius: 12,
                  background: value ? C.accent : "#cbd5e1",
                  border: "none", cursor: loading ? "default" : "pointer",
                  flexShrink: 0,
                  transition: "background .2s",
                  opacity: loading ? 0.6 : 1,
                }}
                aria-pressed={value}
                aria-label={`Toggle ${scope.label}`}
              >
                <div style={{
                  position: "absolute", top: 2, left: value ? 22 : 2,
                  width: 20, height: 20, borderRadius: "50%",
                  background: "#fff",
                  transition: "left .2s",
                  boxShadow: "0 1px 3px rgba(0,0,0,.2)",
                }} />
              </button>
            )}
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2, marginBottom: 8 }}>{scope.sub}</div>
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>{scope.summary}</div>
        </div>
      </div>
    </div>
  );
}

// ── Referral card ─────────────────────────────────────────────────────────────
function ReferralCard({ referral, onAcknowledge, acking }) {
  const isAcked = referral.acknowledged;
  return (
    <div style={{
      background: C.card, borderRadius: 14,
      border: `1px solid ${isAcked ? C.border : "#c7d2fe"}`,
      boxShadow: isAcked ? "none" : "0 2px 8px rgba(99,102,241,.08)",
      padding: 16, marginBottom: 10,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10, flexShrink: 0,
          background: isAcked ? "#f1f5f9" : C.accentBg,
          color: isAcked ? C.muted : C.accent,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>
            Message from your health worker
          </div>
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, marginBottom: 8 }}>
            {referral.summary || "No details provided."}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{
              fontSize: 10, fontWeight: 700, color: C.subtle, textTransform: "uppercase", letterSpacing: ".5px",
            }}>
              {referral.event_date || "Date unknown"}
            </span>
            <span style={{
              fontSize: 10, fontWeight: 700, color: C.subtle,
            }}>·</span>
            <span style={{
              fontSize: 10, fontWeight: 700,
              color: (referral.status === "COMPLETED") ? "#15803d" :
                     (referral.status === "ACTIVE") ? C.accent : C.muted,
              textTransform: "uppercase", letterSpacing: ".5px",
            }}>{referral.status || "PENDING"}</span>
          </div>
        </div>
        {!isAcked && (
          <button
            onClick={() => onAcknowledge(referral.referral_id)}
            disabled={acking}
            style={{
              padding: "6px 12px", borderRadius: 8, border: "none",
              background: C.accent, color: "#fff",
              fontSize: 11, fontWeight: 700, cursor: acking ? "default" : "pointer",
              opacity: acking ? 0.6 : 1, flexShrink: 0,
            }}
          >
            {acking ? "…" : "Got it"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── History row ───────────────────────────────────────────────────────────────
function HistoryRow({ entry }) {
  const prettyScope = SCOPES.find(s => s.key === entry.scope)?.label || entry.scope;
  const when = (() => {
    try {
      return new Date(entry.logged_at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
    } catch { return entry.logged_at; }
  })();
  const action = entry.new_value ? "Granted" : "Revoked";
  const actionColor = entry.new_value ? "#15803d" : C.danger;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "10px 14px", borderBottom: `1px solid ${C.border}`, fontSize: 12,
    }}>
      <div style={{
        padding: "3px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700,
        background: entry.new_value ? "#f0fdf4" : "#fef2f2",
        color: actionColor, textTransform: "uppercase", letterSpacing: ".5px",
        flexShrink: 0,
      }}>{action}</div>
      <div style={{ flex: 1, color: C.text }}>{prettyScope}</div>
      <div style={{ color: C.subtle, fontSize: 11, flexShrink: 0 }}>{when}</div>
    </div>
  );
}

// ── Main overlay ──────────────────────────────────────────────────────────────
export default function PrivacyPanel({ token, patient, onClose }) {
  const [flags, setFlags]           = useState(null);
  const [version, setVersion]       = useState(0);
  const [referrals, setReferrals]   = useState([]);
  const [history, setHistory]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [tab, setTab]               = useState("privacy"); // privacy | messages | history
  const [saving, setSaving]         = useState({});         // { scope: bool }
  const [acking, setAcking]         = useState({});
  const [toast, setToast]           = useState("");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [c, r, h] = await Promise.all([
        fetch(`${API}/api/v1/consent/me`,             { headers: authH(token) }).then(r => r.ok ? r.json() : null),
        fetch(`${API}/api/v1/dhis2/pull/my-referrals`, { headers: authH(token) }).then(r => r.ok ? r.json() : { referrals: [] }),
        fetch(`${API}/api/v1/consent/me/history`,      { headers: authH(token) }).then(r => r.ok ? r.json() : { history: [] }),
      ]);
      if (c) { setFlags(c.flags || {}); setVersion(c.version || 0); }
      setReferrals(r?.referrals || []);
      setHistory(h?.history || []);
    } catch { /* soft-fail */ }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const toggleScope = async (scope, value) => {
    setSaving(prev => ({ ...prev, [scope]: true }));
    try {
      const r = await fetch(`${API}/api/v1/consent/me`, {
        method:  "POST",
        headers: authH(token),
        body:    JSON.stringify({ scope, value, reason: "updated via privacy panel" }),
      });
      if (r.ok) {
        setFlags(prev => ({ ...prev, [scope]: value }));
        setVersion(v => v + 1);
        setToast(value ? "Saved — sharing is now on" : "Saved — sharing is now off");
        setTimeout(() => setToast(""), 3000);
        // Refresh history
        fetch(`${API}/api/v1/consent/me/history`, { headers: authH(token) })
          .then(r => r.ok ? r.json() : null)
          .then(d => d && setHistory(d.history || []));
      } else {
        setToast("Could not save — please try again");
        setTimeout(() => setToast(""), 3000);
      }
    } catch {
      setToast("Network error");
      setTimeout(() => setToast(""), 3000);
    } finally {
      setSaving(prev => ({ ...prev, [scope]: false }));
    }
  };

  const acknowledgeReferral = async (refId) => {
    setAcking(prev => ({ ...prev, [refId]: true }));
    try {
      const r = await fetch(`${API}/api/v1/dhis2/pull/my-referrals/${refId}/ack`, {
        method: "POST", headers: authH(token),
      });
      if (r.ok) {
        setReferrals(prev => prev.map(x => x.referral_id === refId ? { ...x, acknowledged: true } : x));
      }
    } catch { /* silent */ }
    finally { setAcking(prev => ({ ...prev, [refId]: false })); }
  };

  const unackCount = referrals.filter(r => !r.acknowledged).length;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 750,
      background: "#f8fafc", display: "flex", flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{
        background: "linear-gradient(135deg,#1e1b4b,#312e81)",
        padding: "20px 28px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <div>
          <div style={{ color: "#a5b4fc", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 4 }}>
            AMINA Care Programme
          </div>
          <div style={{ color: "#fff", fontWeight: 800, fontSize: 20 }}>Privacy &amp; Data</div>
          <div style={{ color: "#818cf8", fontSize: 13, marginTop: 2 }}>
            Control how your health data is shared. Your choices, always.
          </div>
        </div>
        <button onClick={onClose} style={{
          background: "rgba(255,255,255,.1)", border: "none", borderRadius: 10,
          color: "#fff", padding: "8px 16px", cursor: "pointer", fontWeight: 600, fontSize: 13,
        }}>✕ Close</button>
      </div>

      {/* Tabs */}
      <div style={{
        display: "flex", gap: 4, padding: "12px 28px 0", background: "#fff",
        borderBottom: `1px solid ${C.border}`, flexShrink: 0,
      }}>
        {[
          ["privacy",  "Privacy settings", null],
          ["messages", "Messages",         unackCount > 0 ? unackCount : null],
          ["history",  "History",          null],
        ].map(([k, label, badge]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            style={{
              padding: "10px 16px", border: "none", background: "none",
              color: tab === k ? C.accent : C.muted,
              borderBottom: tab === k ? `2px solid ${C.accent}` : "2px solid transparent",
              fontWeight: tab === k ? 700 : 500, fontSize: 13, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 8,
              marginBottom: -1,
            }}
          >
            {label}
            {badge !== null && (
              <span style={{
                background: C.accent, color: "#fff", borderRadius: "50%",
                minWidth: 18, height: 18, fontSize: 10, fontWeight: 700,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                padding: "0 5px",
              }}>{badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px" }}>
        {loading && (
          <div style={{ textAlign: "center", color: C.muted, padding: 60 }}>Loading…</div>
        )}

        {/* Privacy tab */}
        {!loading && tab === "privacy" && (
          <div style={{ maxWidth: 720, margin: "0 auto" }}>
            <div style={{
              background: C.accentBg, border: `1px solid #c7d2fe`,
              borderRadius: 12, padding: "14px 16px", marginBottom: 16,
              fontSize: 13, color: "#4338ca", lineHeight: 1.6,
            }}>
              <strong>Your data, your choice.</strong> AMINA Care is built to protect your privacy.
              You can change these settings at any time. Version {version}.
            </div>
            {SCOPES.map(scope => (
              <ConsentCard
                key={scope.key}
                scope={scope}
                value={scope.locked ? true : !!flags?.[scope.key]}
                locked={scope.locked}
                loading={!!saving[scope.key]}
                onToggle={(v) => toggleScope(scope.key, v)}
              />
            ))}
          </div>
        )}

        {/* Messages tab */}
        {!loading && tab === "messages" && (
          <div style={{ maxWidth: 720, margin: "0 auto" }}>
            {referrals.length === 0 ? (
              <div style={{
                textAlign: "center", color: C.muted, padding: "60px 20px",
                background: C.card, borderRadius: 14, border: `1px dashed ${C.border}`,
              }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>📭</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 4 }}>No messages yet</div>
                <div style={{ fontSize: 12 }}>
                  When a health worker creates a follow-up or referral for you in the Ministry of Health system,
                  it will appear here.
                </div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
                  {referrals.length} message{referrals.length !== 1 ? "s" : ""} · {unackCount} unread
                </div>
                {referrals.map(r => (
                  <ReferralCard
                    key={r.referral_id}
                    referral={r}
                    onAcknowledge={acknowledgeReferral}
                    acking={!!acking[r.referral_id]}
                  />
                ))}
              </>
            )}
          </div>
        )}

        {/* History tab */}
        {!loading && tab === "history" && (
          <div style={{ maxWidth: 720, margin: "0 auto" }}>
            {history.length === 0 ? (
              <div style={{
                textAlign: "center", color: C.muted, padding: "60px 20px",
                background: C.card, borderRadius: 14, border: `1px dashed ${C.border}`,
              }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>🔒</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 4 }}>No changes yet</div>
                <div style={{ fontSize: 12 }}>
                  When you change a privacy setting, a record is kept here for your reference.
                </div>
              </div>
            ) : (
              <div style={{
                background: C.card, borderRadius: 14, border: `1px solid ${C.border}`, overflow: "hidden",
              }}>
                {history.map((entry, i) => <HistoryRow key={i} entry={entry} />)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: "#0f172a", color: "#fff",
          padding: "12px 20px", borderRadius: 10, fontSize: 13, fontWeight: 600,
          boxShadow: "0 8px 32px rgba(0,0,0,.25)",
          animation: "fadeIn .2s",
          zIndex: 800,
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}
