/**
 * EmergencyBootstrap — self-mounting root for the escalation overlays.
 *
 * Three things happen here:
 *   1. Mount <EmergencyEscalationWatcher />  — patient-side 199 banner
 *   2. Mount <EmergencyCaregiverActions />   — caregiver-side action strip
 *   3. Install a window.fetch interceptor that, on any successful POST
 *      to the legacy `/api/v1/caregiver/alert/send` endpoint (used by
 *      EmergencyAlert.jsx on Advanced, Basic, and Beginner shells),
 *      co-fires `POST /api/v1/emergency/alert` so the escalation state
 *      machine kicks in regardless of which UI triggered the alarm.
 *
 * Purely additive — no edits to App.jsx, EmergencyAlert.jsx, or any
 * legacy emergency surface.
 */

import { createRoot } from "react-dom/client";
import EmergencyEscalationWatcher   from "./EmergencyEscalationWatcher.jsx";
import EmergencyCaregiverActions    from "./EmergencyCaregiverActions.jsx";


const ROOT_ID = "amina-emergency-overlays-root";


// ── Legacy alert interceptor ───────────────────────────────────────

function _installLegacyAlertInterceptor() {
  if (typeof window === "undefined") return;
  if (window.__aminaEmergencyInterceptor) return;
  window.__aminaEmergencyInterceptor = true;

  const orig = window.fetch.bind(window);

  window.fetch = async function emergencyAwareFetch(input, init) {
    const url    = typeof input === "string" ? input : (input && input.url) || "";
    const method = ((init && init.method)
                    || (typeof input !== "string" && input && input.method)
                    || "GET").toUpperCase();

    const resp = await orig(input, init);

    if (method === "POST"
        && typeof url === "string"
        && url.indexOf("/api/v1/caregiver/alert/send") !== -1
        && resp && resp.ok) {
      try {
        // Parse the original body — it carries {message, alert_type, …}.
        let bodyObj = {};
        if (init && init.body) {
          try { bodyObj = JSON.parse(init.body); } catch { /* noop */ }
        }
        const message    = bodyObj.message    || "Emergency alert";
        const alert_type = bodyObj.alert_type || "emergency_triage";

        // Fire the new escalation endpoint with the patient JWT.
        const tok = (() => {
          try { return localStorage.getItem("AMINA_TOKEN") || ""; }
          catch { return ""; }
        })();
        if (tok) {
          const base = (() => {
            const i = url.indexOf("/api/v1/");
            return i >= 0 ? url.slice(0, i) : "";
          })();
          orig(`${base}/api/v1/emergency/alert`, {
            method: "POST",
            credentials: "include",
            headers: {
              "Authorization": `Bearer ${tok}`,
              "Content-Type":  "application/json",
            },
            body: JSON.stringify({ message, alert_type }),
          }).then(() => {
            try {
              window.dispatchEvent(new CustomEvent("amina:emergency:fired"));
            } catch { /* noop */ }
          }).catch(() => { /* silent */ });
        }
      } catch { /* noop — never block the primary alert flow */ }
    }

    return resp;
  };
}


function mount() {
  if (typeof window === "undefined") return;
  if (window.__aminaEmergencyMounted) return;
  window.__aminaEmergencyMounted = true;

  _installLegacyAlertInterceptor();

  const attach = () => {
    try {
      if (!document.getElementById(ROOT_ID)) {
        const host = document.createElement("div");
        host.id = ROOT_ID;
        document.body.appendChild(host);
        createRoot(host).render(
          <>
            <EmergencyEscalationWatcher />
            <EmergencyCaregiverActions />
          </>,
        );
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("EmergencyBootstrap mount failed:", e);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach);
  } else {
    attach();
  }
}

mount();
