/**
 * EmergencyEscalationWatcher — patient-side watcher that surfaces the
 * 199 hotline prompt when the backend auto-escalates their alert.
 *
 * Polls GET /api/v1/emergency/for-me every 12 s while a patient JWT is
 * present. When the response shows the latest alert has advanced to
 * `hotline_prompted` (backend timer fired — caregiver didn't respond
 * within T1 minutes), we render a persistent red banner with a big
 * "Call 199 now" button that `tel:` dial-outs.
 *
 * Also surfaces:
 *   - `authorities_notified`: green banner confirming hospitals alerted
 *   - `admin_escalated`:      amber banner confirming admin/regional
 *                              hospitals have been auto-notified
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchMyAlert } from "./emergencyApi.js";


const POLL_MS = 12000;


function _hasPatientJWT() {
  try {
    return !!(localStorage.getItem("AMINA_TOKEN")
           && localStorage.getItem("AMINA_PATIENT"));
  } catch { return false; }
}


function Banner({ state, alert, hotline, onDismiss }) {
  const isHotline   = state === "hotline_prompted";
  const isAuthNot   = state === "authorities_notified";
  const isAdmin     = state === "admin_escalated";
  if (!isHotline && !isAuthNot && !isAdmin) return null;

  const [bg, border, fg, tone] = isHotline
    ? ["linear-gradient(135deg, #7f1d1d 0%, #450a0a 100%)",
       "rgba(248, 113, 113, 0.55)", "#fff",
       "CALL EMERGENCY HOTLINE"]
    : isAuthNot
      ? ["linear-gradient(135deg, #065f46 0%, #064e3b 100%)",
         "rgba(52, 211, 153, 0.45)", "#fff",
         "HOSPITAL ALERTED"]
      : ["linear-gradient(135deg, #9a3412 0%, #7c2d12 100%)",
         "rgba(251, 146, 60, 0.50)", "#fff",
         "ESCALATED TO ADMIN"];

  return (
    <div role="alert" aria-live="assertive"
         style={{
           position: "fixed",
           top: 60,                                   // under the nav bar
           left: "50%", transform: "translateX(-50%)",
           zIndex: 10200,
           width: "min(560px, calc(100vw - 40px))",
           padding: "14px 18px",
           background: bg,
           border: `1px solid ${border}`,
           borderRadius: 14,
           boxShadow: "0 20px 50px rgba(127, 29, 29, 0.45), 0 0 0 1px rgba(248,113,113,0.25)",
           color: fg,
           display: "flex", alignItems: "center", gap: 14,
           fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
           animation: "amina-emergency-banner-in 240ms ease-out",
         }}>
      <div style={{
        width: 38, height: 38, borderRadius: 10,
        background: "rgba(255,255,255,0.10)",
        border: "1px solid rgba(255,255,255,0.28)",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: 20, flexShrink: 0,
      }}>⚠</div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5,
                      textTransform: "uppercase",
                      color: "rgba(255,255,255,0.80)" }}>{tone}</div>
        {isHotline && (
          <>
            <div style={{ fontSize: 15, fontWeight: 800, marginTop: 3 }}>
              Call {hotline?.number || "199"} now
            </div>
            <div style={{ fontSize: 12.5, marginTop: 4, opacity: 0.90,
                          lineHeight: 1.4 }}>
              Your caregiver hasn't responded yet. Please call the
              emergency hotline immediately and stay on the line.
            </div>
          </>
        )}
        {isAuthNot && (
          <>
            <div style={{ fontSize: 15, fontWeight: 800, marginTop: 3 }}>
              Local hospital has been alerted
            </div>
            <div style={{ fontSize: 12.5, marginTop: 4, opacity: 0.90 }}>
              Your caregiver notified nearby hospital(s). Help is being
              dispatched — stay calm and await contact.
            </div>
          </>
        )}
        {isAdmin && (
          <>
            <div style={{ fontSize: 15, fontWeight: 800, marginTop: 3 }}>
              Regional hospitals and admin notified
            </div>
            <div style={{ fontSize: 12.5, marginTop: 4, opacity: 0.90 }}>
              Your alert has been escalated beyond your caregiver to
              admin and every hospital in your region.
            </div>
          </>
        )}
      </div>

      {isHotline && (
        <a href={`tel:${hotline?.number || "199"}`}
           style={{
             padding: "11px 18px",
             background: "#fff", color: "#7f1d1d",
             border: "none", borderRadius: 10,
             fontSize: 14, fontWeight: 900,
             textDecoration: "none",
             boxShadow: "0 6px 16px rgba(0,0,0,0.40)",
             whiteSpace: "nowrap",
           }}>📞 Call {hotline?.number || "199"}</a>
      )}

      <button type="button" onClick={onDismiss}
              aria-label="Dismiss"
              style={{
                background: "rgba(255,255,255,0.14)",
                border: "1px solid rgba(255,255,255,0.28)",
                color: "#fff", borderRadius: 8,
                width: 28, height: 28, cursor: "pointer",
                fontSize: 14, fontWeight: 800, flexShrink: 0,
              }}>×</button>

      <style>{`
        @keyframes amina-emergency-banner-in {
          from { opacity: 0; transform: translate(-50%, -8px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>
    </div>
  );
}


export default function EmergencyEscalationWatcher() {
  const [alert, setAlert]       = useState(null);
  const [hotline, setHotline]   = useState({ number: "199", name: "Emergency Hotline" });
  const [dismissed, setDismissed] = useState(new Set());

  const poll = useCallback(async () => {
    if (!_hasPatientJWT()) { setAlert(null); return; }
    const r = await fetchMyAlert();
    if (r.data) {
      setAlert(r.data.alert || null);
      if (r.data.hotline) setHotline(r.data.hotline);
    }
  }, []);

  // Initial poll + every 12s + immediately after a fresh fire
  useEffect(() => {
    poll();
    const t = setInterval(poll, POLL_MS);
    const onAlertFired = () => setTimeout(poll, 500);
    window.addEventListener("amina:emergency:fired", onAlertFired);
    window.addEventListener("amina:auth-changed", poll);
    return () => {
      clearInterval(t);
      window.removeEventListener("amina:emergency:fired", onAlertFired);
      window.removeEventListener("amina:auth-changed", poll);
    };
  }, [poll]);

  const state = alert?.state;
  const shown = state && !dismissed.has(alert.alert_id)
             && ["hotline_prompted", "authorities_notified",
                 "admin_escalated"].includes(state);

  if (!shown) return null;

  return (
    <Banner state={state} alert={alert} hotline={hotline}
            onDismiss={() => setDismissed((s) => {
              const n = new Set(s);
              n.add(alert.alert_id);
              return n;
            })} />
  );
}
