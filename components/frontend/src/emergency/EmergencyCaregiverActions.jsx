/**
 * EmergencyCaregiverActions — floating action strip that appears for a
 * caregiver whenever an unresolved emergency alert exists for any of
 * their linked patients.
 *
 * Surfaces two one-click actions:
 *   ✓ I'm responding    → POST /emergency/{id}/ack
 *   🏥 Notify authorities → POST /emergency/{id}/notify-authorities
 *
 * We detect relevant alerts by reading the caregiver's OWN inbox —
 * any unread inbox item with source_id = "emergency:{alert_id}" + a
 * severity of "emergency". On click, we call the action and
 * optimistically mark the local state so the strip dismisses.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { caregiverAck, caregiverNotifyAuthorities } from "./emergencyApi.js";
import { listCaregiverInbox, markCaregiverRead, hasCaregiverToken }
  from "../caregiver_inbox/caregiverInboxApi.js";


const POLL_MS = 10000;


function _extractAlertId(item) {
  // source_id = "emergency:{alert_id}"
  const s = item?.source_id || "";
  if (s.startsWith("emergency:")) return s.slice("emergency:".length);
  // Or via metadata
  try {
    const meta = typeof item?.metadata === "string"
      ? JSON.parse(item.metadata) : (item.metadata || {});
    return meta.alert_id || null;
  } catch { return null; }
}


export default function EmergencyCaregiverActions() {
  const [alert, setAlert] = useState(null);        // {alert_id, title, inbox_id}
  const [busy,  setBusy]  = useState(null);        // "ack" | "authorities" | null
  const [dismissed, setDismissed] = useState(new Set());

  const poll = useCallback(async () => {
    if (!hasCaregiverToken()) { setAlert(null); return; }
    const r = await listCaregiverInbox({ limit: 20, unreadOnly: false });
    if (!r.data) return;
    const items = (r.data.items || []).filter((i) =>
      i.severity === "emergency" && !i.read && _extractAlertId(i));
    const top = items[0] || null;
    if (!top) { setAlert(null); return; }
    const alertId = _extractAlertId(top);
    if (dismissed.has(alertId)) { setAlert(null); return; }
    setAlert({
      alert_id: alertId,
      title:    top.title || "Emergency alert",
      inbox_id: top.inbox_id,
      body:     top.body || "",
    });
  }, [dismissed]);

  useEffect(() => {
    poll();
    const t = setInterval(poll, POLL_MS);
    const onInbox = () => poll();
    window.addEventListener("amina:caregiver-inbox:refresh", onInbox);
    window.addEventListener("amina:auth-changed", onInbox);
    return () => {
      clearInterval(t);
      window.removeEventListener("amina:caregiver-inbox:refresh", onInbox);
      window.removeEventListener("amina:auth-changed", onInbox);
    };
  }, [poll]);

  const act = async (kind) => {
    if (!alert || busy) return;
    setBusy(kind);
    if (kind === "ack") {
      await caregiverAck(alert.alert_id);
    } else if (kind === "authorities") {
      // eslint-disable-next-line no-alert
      const note = window.prompt(
        "Optional note to hospitals (nature of emergency):", "",
      ) || "";
      await caregiverNotifyAuthorities(alert.alert_id, note);
    }
    // Mark the inbox item read too so the bell badge drops.
    if (alert.inbox_id) await markCaregiverRead(alert.inbox_id);
    setDismissed((s) => { const n = new Set(s); n.add(alert.alert_id); return n; });
    setAlert(null);
    setBusy(null);
  };

  if (!alert) return null;

  return (
    <div role="alert" aria-live="assertive"
         style={{
           position: "fixed",
           top: 60, left: "50%", transform: "translateX(-50%)",
           zIndex: 10200,
           width: "min(620px, calc(100vw - 32px))",
           padding: "14px 16px",
           background: "linear-gradient(135deg, #7f1d1d 0%, #450a0a 100%)",
           border: "1px solid rgba(248, 113, 113, 0.55)",
           borderRadius: 14,
           boxShadow: "0 20px 50px rgba(127, 29, 29, 0.45)",
           color: "#fff",
           fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
           display: "flex", alignItems: "center", gap: 12,
           animation: "amina-cg-em-in 240ms ease-out",
         }}>
      <div style={{
        width: 40, height: 40, borderRadius: 10,
        background: "rgba(255,255,255,0.12)",
        border: "1px solid rgba(255,255,255,0.30)",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: 20, flexShrink: 0,
      }}>⚠</div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5,
                      textTransform: "uppercase",
                      color: "rgba(255,255,255,0.80)" }}>
          Patient emergency
        </div>
        <div style={{ fontSize: 14, fontWeight: 800, marginTop: 2 }}>
          {alert.title}
        </div>
        {alert.body ? (
          <div style={{ fontSize: 12, opacity: 0.85, marginTop: 3,
                        display: "-webkit-box", WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {alert.body}
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={() => act("ack")}
                disabled={!!busy}
                style={{
                  padding: "9px 13px", borderRadius: 10,
                  background: "rgba(255,255,255,0.14)",
                  color: "#fff",
                  border: "1px solid rgba(255,255,255,0.40)",
                  fontWeight: 800, fontSize: 12.5,
                  cursor: busy ? "not-allowed" : "pointer",
                }}>✓ I'm responding</button>
        <button type="button" onClick={() => act("authorities")}
                disabled={!!busy}
                style={{
                  padding: "9px 13px", borderRadius: 10,
                  background: "#fff",
                  color: "#7f1d1d",
                  border: "none",
                  fontWeight: 900, fontSize: 12.5,
                  cursor: busy ? "not-allowed" : "pointer",
                  boxShadow: "0 6px 16px rgba(0,0,0,0.35)",
                }}>🏥 Notify hospitals</button>
      </div>

      <style>{`
        @keyframes amina-cg-em-in {
          from { opacity: 0; transform: translate(-50%, -10px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>
    </div>
  );
}
