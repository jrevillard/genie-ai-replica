/**
 * CaregiverInboxBootstrap — self-mounting root for the caregiver bell.
 * Same pattern as the patient InboxBootstrap, but guarded by the
 * caregiver token: we mount the React root regardless, and the bell
 * component itself decides whether to render (it's a no-op without a
 * caregiver JWT).
 *
 * Also installs a global helper window.__aminaCaregiverEmergencyAlert({
 *   message, alert_type }) so the legacy EmergencyAlert.jsx flow can
 * route its SOS through the new wrapper without us editing App.jsx.
 */

import { createRoot } from "react-dom/client";
import CaregiverInboxBell from "./CaregiverInboxBell.jsx";
import { sendEmergencyAlertToCaregivers } from "./caregiverInboxApi.js";


const ROOT_ID = "amina-caregiver-inbox-root";


// ── Fetch interceptor: co-fire caregiver inbox fanout on any emergency ─
//
// The legacy EmergencyAlert.jsx in App.jsx POSTs to
// /api/v1/caregiver/alert/send (SMS-only). We can't edit App.jsx, so
// we wrap window.fetch at module load: whenever that URL returns 200
// we also POST to /caregiver/emergency/send so the inbox fanout lights
// up every linked caregiver's bell in-app (SMS + inbox redundancy).
//
// Idempotent install — runs once per tab. Passthrough for every other
// URL, with the original fetch semantics preserved.

function _installEmergencyCoFire() {
  if (typeof window === "undefined") return;
  if (window.__aminaCaregiverEmergencyFetchWrapped) return;
  window.__aminaCaregiverEmergencyFetchWrapped = true;

  const orig = window.fetch.bind(window);

  window.fetch = async function wrappedFetch(input, init) {
    const url    = typeof input === "string" ? input : (input && input.url) || "";
    const method = ((init && init.method)
                    || (typeof input !== "string" && input && input.method)
                    || "GET").toUpperCase();

    // Let the original call run normally.
    const resp = await orig(input, init);

    // Co-fire only on successful POST to the legacy alert endpoint.
    if (method === "POST"
        && typeof url === "string"
        && url.indexOf("/api/v1/caregiver/alert/send") !== -1
        && resp && resp.ok) {
      try {
        // Extract the message from the original body so the inbox item
        // carries the same text the SMS carried.
        let bodyText = "Emergency alert";
        let alertType = "emergency_triage";
        if (init && init.body) {
          try {
            const parsed = JSON.parse(init.body);
            bodyText  = parsed.message    || bodyText;
            alertType = parsed.alert_type || alertType;
          } catch { /* noop */ }
        }
        // Fire-and-forget. Uses the patient AMINA_TOKEN.
        sendEmergencyAlertToCaregivers(bodyText, alertType)
          .catch(() => { /* silent — SMS path already succeeded */ });
      } catch { /* noop */ }
    }

    return resp;
  };
}


_installEmergencyCoFire();


function mount() {
  if (typeof window === "undefined") return;
  if (window.__aminaCaregiverInboxMounted) return;
  window.__aminaCaregiverInboxMounted = true;

  const attach = () => {
    try {
      if (!document.getElementById(ROOT_ID)) {
        const host = document.createElement("div");
        host.id = ROOT_ID;
        document.body.appendChild(host);
        createRoot(host).render(<CaregiverInboxBell />);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("CaregiverInboxBootstrap mount failed:", e);
    }
  };

  // Expose the emergency wrapper on window so EmergencyAlert.jsx can
  // co-fire (old SMS-only path + new inbox fanout). We don't replace
  // the existing call; we just add a parallel push so caregiver bells
  // light up even when SMS is flaky.
  try {
    window.__aminaCaregiverEmergencyAlert = async ({
      message, alertType = "emergency_triage",
    } = {}) => {
      if (!message || !String(message).trim()) return { _error: "message required" };
      return sendEmergencyAlertToCaregivers(message, alertType);
    };
  } catch { /* noop */ }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach);
  } else {
    attach();
  }
}

mount();
