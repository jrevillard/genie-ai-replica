/**
 * SessionBootstrap — mounts the SessionSwitcher pill + installs a
 * fetch interceptor that auto-saves login responses into their slots.
 *
 * The interceptor is additive: the existing AuthScreen already sets
 * the legacy live keys (AMINA_TOKEN, cg_token, AMINA_ADMIN_TOKEN), we
 * just shadow those writes into the slot copies so the switcher can
 * later swap between them without losing either session.
 */

import { createRoot } from "react-dom/client";
import SessionSwitcher from "./SessionSwitcher.jsx";
import {
  savePatientSlot, saveCaregiverSlot, saveAdminSlot, hydrateFromLive,
} from "./sessionRegistry.js";


const ROOT_ID = "amina-session-switcher-root";


// ── Fetch interceptor — snoops successful login responses ──────────

function _installLoginSnoop() {
  if (typeof window === "undefined") return;
  if (window.__aminaSessionLoginSnoop) return;
  window.__aminaSessionLoginSnoop = true;

  const orig = window.fetch.bind(window);

  window.fetch = async function sessionAwareFetch(input, init) {
    const url    = typeof input === "string" ? input : (input && input.url) || "";
    const method = ((init && init.method)
                    || (typeof input !== "string" && input && input.method)
                    || "GET").toUpperCase();

    const resp = await orig(input, init);

    if (method !== "POST" || typeof url !== "string" || !resp || !resp.ok) {
      return resp;
    }

    try {
      // Clone so we don't consume the body the caller is about to read.
      const clone = resp.clone();
      const body  = await clone.json().catch(() => null);
      if (!body) return resp;

      if (url.indexOf("/api/v1/auth/login/email") !== -1
       || url.indexOf("/api/v1/auth/signup/email") !== -1) {
        if (body.success && body.token && body.patient) {
          savePatientSlot({
            token:   body.token,
            patient: body.patient,
            sid:     body.session_id || "",
          });
        }
      } else if (url.indexOf("/api/v1/caregiver/login") !== -1
              || url.indexOf("/api/v1/caregiver/register") !== -1) {
        if (body.token) {
          saveCaregiverSlot({
            token: body.token,
            info:  {
              name:          body.name,
              caregiver_id:  body.caregiver_id,
              patient_id:    body.patient_id,
              permissions:   body.permissions,
              patient_count: body.patient_count,
            },
          });
        }
      } else if (url.indexOf("/api/v1/admin/login") !== -1
              || url.indexOf("/api/v1/admin/token") !== -1) {
        if (body.token) saveAdminSlot({ token: body.token });
      }
    } catch { /* noop */ }

    return resp;
  };
}


function mount() {
  if (typeof window === "undefined") return;
  if (window.__aminaSessionSwitcherMounted) return;
  window.__aminaSessionSwitcherMounted = true;

  _installLoginSnoop();

  const attach = () => {
    try {
      // Backfill slots from any legacy live keys that are already set
      // (e.g. a user who was logged in before this module shipped).
      hydrateFromLive();

      if (!document.getElementById(ROOT_ID)) {
        const host = document.createElement("div");
        host.id = ROOT_ID;
        document.body.appendChild(host);
        createRoot(host).render(<SessionSwitcher />);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("SessionBootstrap mount failed:", e);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach);
  } else {
    attach();
  }
}

mount();
