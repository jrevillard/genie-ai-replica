/**
 * EmergencyAdminPage — #/admin/emergencies route (via AppRouter).
 *
 * Admin-scoped list of every unresolved emergency across the system,
 * ordered newest-first, with each alert's state timeline, hospital
 * dispatch log, and a one-click resolve button.
 */

import { useCallback, useEffect, useState } from "react";
import { adminListActive, adminResolve } from "./emergencyApi.js";


const STATE_COLOR = {
  pending:              { label: "PENDING",              bg: "#78350f", fg: "#fde68a" },
  caregiver_seen:       { label: "CAREGIVER SEEN",       bg: "#3730a3", fg: "#c7d2fe" },
  caregiver_responding: { label: "RESPONDING",           bg: "#14532d", fg: "#86efac" },
  authorities_notified: { label: "HOSPITAL ALERTED",     bg: "#064e3b", fg: "#6ee7b7" },
  hotline_prompted:     { label: "HOTLINE PROMPTED",     bg: "#7f1d1d", fg: "#fecaca" },
  admin_escalated:      { label: "ESCALATED",            bg: "#9a3412", fg: "#fed7aa" },
  resolved:             { label: "RESOLVED",             bg: "#334155", fg: "#cbd5e1" },
};


function _timeAgo(iso) {
  if (!iso) return "";
  try {
    const t = new Date(iso).getTime();
    const s = Math.floor((Date.now() - t) / 1000);
    if (s < 60)    return `${s}s ago`;
    if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return         `${Math.floor(s / 86400)}d ago`;
  } catch { return iso; }
}


function AlertCard({ alert, onResolve, busy }) {
  const color = STATE_COLOR[alert.state] || STATE_COLOR.pending;
  const hospitals = alert.dispatch_log || [];
  const transitions = alert.transitions || [];
  return (
    <div style={{
      background: "rgba(15, 23, 42, 0.85)",
      border: "1px solid rgba(148, 163, 184, 0.22)",
      borderRadius: 14, padding: "16px 18px",
      display: "flex", flexDirection: "column", gap: 12,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#fff" }}>
            {alert.patient_name || alert.patient_id}
          </div>
          <div style={{ fontSize: 12, color: "#cbd5e1", marginTop: 4 }}>
            {alert.region ? `Region: ${alert.region} · ` : ""}
            Fired {_timeAgo(alert.created_at)}
          </div>
        </div>
        <span style={{
          padding: "4px 10px", borderRadius: 999,
          background: color.bg, color: color.fg,
          fontSize: 10, fontWeight: 800, letterSpacing: 0.4,
          textTransform: "uppercase", flexShrink: 0,
        }}>{color.label}</span>
      </div>

      {alert.message && (
        <div style={{
          padding: "10px 12px",
          background: "rgba(30, 41, 59, 0.70)",
          border: "1px solid rgba(148, 163, 184, 0.18)",
          borderRadius: 10,
          color: "#e2e8f0", fontSize: 13, lineHeight: 1.5,
          fontStyle: "italic",
        }}>"{alert.message}"</div>
      )}

      {/* Hospital dispatch log */}
      {hospitals.length > 0 && (
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4,
                        textTransform: "uppercase", color: "#94a3b8",
                        marginBottom: 6 }}>
            Hospital dispatch ({hospitals.length})
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {hospitals.map((h, i) => (
              <span key={i} style={{
                padding: "5px 10px", borderRadius: 8,
                background: "rgba(16, 185, 129, 0.14)",
                color: "#6ee7b7",
                border: "1px solid rgba(52, 211, 153, 0.30)",
                fontSize: 11, fontWeight: 700,
              }}>🏥 {h.hospital_name}
                <span style={{ color: "#94a3b8", fontWeight: 500, marginLeft: 6 }}>
                  {h.phone}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Transition timeline */}
      {transitions.length > 0 && (
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4,
                        textTransform: "uppercase", color: "#94a3b8",
                        marginBottom: 6 }}>Timeline</div>
          <ol style={{
            listStyle: "none", padding: 0, margin: 0,
            display: "flex", flexDirection: "column", gap: 4,
          }}>
            {transitions.slice().reverse().slice(0, 6).map((t, i) => (
              <li key={i} style={{ display: "flex", gap: 8,
                                    fontSize: 11.5, color: "#cbd5e1" }}>
                <span style={{ color: "#64748b", flexShrink: 0 }}>
                  {_timeAgo(t.at)}
                </span>
                <span>
                  {STATE_COLOR[t.to]?.label || t.to.toUpperCase()}
                  {t.by ? <span style={{ color: "#64748b" }}> · {t.by}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {alert.state !== "resolved" && (
        <button type="button" onClick={() => onResolve(alert)}
                disabled={busy === alert.alert_id}
                style={{
                  padding: "9px 14px", borderRadius: 10,
                  background: "rgba(52, 211, 153, 0.18)",
                  color: "#a7f3d0",
                  border: "1px solid rgba(52, 211, 153, 0.40)",
                  fontSize: 12.5, fontWeight: 800,
                  cursor: busy === alert.alert_id ? "not-allowed" : "pointer",
                  alignSelf: "flex-start",
                }}>
          {busy === alert.alert_id ? "Resolving…" : "✓ Mark resolved"}
        </button>
      )}
    </div>
  );
}


export default function EmergencyAdminPage() {
  const [alerts, setAlerts]     = useState([]);
  const [status, setStatus]     = useState("loading");
  const [error, setError]       = useState(null);
  const [busy, setBusy]         = useState(null);

  const load = useCallback(async () => {
    setStatus((s) => (alerts.length ? "ok" : "loading"));
    const r = await adminListActive();
    if (r._error) { setStatus("error"); setError(r._error); return; }
    setAlerts(r.data?.alerts || []);
    setStatus("ok"); setError(null);
  }, [alerts.length]); // eslint-disable-line

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const onResolve = async (alert) => {
    // eslint-disable-next-line no-alert
    const reason = window.prompt(
      `Mark ${alert.patient_name}'s emergency resolved? Reason (optional):`,
      "",
    );
    if (reason === null) return;
    setBusy(alert.alert_id);
    await adminResolve(alert.alert_id, reason || "");
    setBusy(null);
    await load();
  };

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "28px 18px 60px 18px" }}>
      <header style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4,
                      textTransform: "uppercase", color: "#a78bfa" }}>
          Admin console
        </div>
        <h1 style={{ fontSize: 26, margin: "4px 0 0 0", color: "#fff",
                     fontWeight: 800 }}>
          Active emergencies
        </h1>
        <p style={{ fontSize: 13, color: "#94a3b8", marginTop: 6,
                    maxWidth: 640, lineHeight: 1.55 }}>
          Unresolved SOS alerts across every patient. Auto-refreshes
          every 15 s. Alerts auto-escalate here once 60 minutes pass
          without caregiver resolution — you'll also receive a push
          in your inbox.
        </p>
      </header>

      {status === "loading" && (
        <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>
          Loading…
        </div>
      )}

      {error && (
        <div style={{
          padding: "10px 14px", borderRadius: 10,
          background: "rgba(248, 113, 113, 0.12)",
          border: "1px solid rgba(248, 113, 113, 0.40)",
          color: "#fecaca", fontSize: 13, fontWeight: 600,
          marginBottom: 12,
        }}>{error}</div>
      )}

      {status === "ok" && alerts.length === 0 && (
        <div style={{
          padding: 40, textAlign: "center",
          background: "rgba(30, 41, 59, 0.60)",
          border: "1px dashed rgba(148, 163, 184, 0.30)",
          borderRadius: 14, color: "#cbd5e1",
        }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🕊</div>
          No active emergencies. Everyone's accounted for.
        </div>
      )}

      {status === "ok" && alerts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {alerts.map((a) => (
            <AlertCard key={a.alert_id} alert={a}
                       onResolve={onResolve} busy={busy} />
          ))}
        </div>
      )}
    </div>
  );
}
