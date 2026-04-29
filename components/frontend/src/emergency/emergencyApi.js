/**
 * Emergency escalation API helpers.
 * All calls return { data } on success or { _error: ... } on failure —
 * never throws so UI can degrade gracefully.
 */

function _base() {
  const raw = (typeof window !== "undefined" && window.__AMINA_API_BASE__)
           || (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_BASE)
           || "http://localhost:8000";
  return String(raw).replace(/\/+$/, "");
}


function _patientAuth() {
  try {
    const tok = localStorage.getItem("AMINA_TOKEN") || "";
    return tok
      ? { "Authorization": `Bearer ${tok}`, "Content-Type": "application/json" }
      : { "Content-Type": "application/json" };
  } catch {
    return { "Content-Type": "application/json" };
  }
}


function _caregiverAuth() {
  try {
    const tok = localStorage.getItem("cg_token")
             || localStorage.getItem("AMINA_CG_TOKEN")
             || "";
    return tok
      ? { "Authorization": `Bearer ${tok}`, "Content-Type": "application/json" }
      : { "Content-Type": "application/json" };
  } catch {
    return { "Content-Type": "application/json" };
  }
}


function _adminAuth() {
  try {
    const tok = localStorage.getItem("AMINA_ADMIN_TOKEN") || "";
    return tok
      ? { "Authorization": `Bearer ${tok}`, "Content-Type": "application/json" }
      : { "Content-Type": "application/json" };
  } catch {
    return { "Content-Type": "application/json" };
  }
}


async function _wrap(promise) {
  try {
    const resp = await promise;
    let body = null;
    try { body = await resp.json(); } catch { /* noop */ }
    if (!resp.ok) {
      return { _error: (body && (body.detail?.message || body.detail || body.message))
                        || `HTTP ${resp.status}` };
    }
    return { data: body };
  } catch (e) {
    return { _error: e.message || String(e) };
  }
}


// ── Patient ────────────────────────────────────────────────────

export async function firePatientAlert(message, alertType = "emergency_triage") {
  return _wrap(fetch(`${_base()}/api/v1/emergency/alert`, {
    method: "POST", credentials: "include", headers: _patientAuth(),
    body: JSON.stringify({ message, alert_type: alertType }),
  }));
}


export async function fetchMyAlert() {
  return _wrap(fetch(`${_base()}/api/v1/emergency/for-me`,
                     { credentials: "include", headers: _patientAuth() }));
}


// ── Caregiver ──────────────────────────────────────────────────

export async function caregiverAck(alertId) {
  return _wrap(fetch(
    `${_base()}/api/v1/emergency/${encodeURIComponent(alertId)}/ack`,
    { method: "POST", credentials: "include", headers: _caregiverAuth(),
      body: JSON.stringify({}) },
  ));
}


export async function caregiverNotifyAuthorities(alertId, note = "") {
  return _wrap(fetch(
    `${_base()}/api/v1/emergency/${encodeURIComponent(alertId)}/notify-authorities`,
    { method: "POST", credentials: "include", headers: _caregiverAuth(),
      body: JSON.stringify({ note }) },
  ));
}


export async function caregiverResolve(alertId, reason = "") {
  return _wrap(fetch(
    `${_base()}/api/v1/emergency/${encodeURIComponent(alertId)}/resolve`,
    { method: "POST", credentials: "include", headers: _caregiverAuth(),
      body: JSON.stringify({ reason }) },
  ));
}


// ── Admin ──────────────────────────────────────────────────────

export async function adminListActive() {
  return _wrap(fetch(`${_base()}/api/v1/emergency/active`,
                     { credentials: "include", headers: _adminAuth() }));
}


export async function adminResolve(alertId, reason = "") {
  return _wrap(fetch(
    `${_base()}/api/v1/emergency/${encodeURIComponent(alertId)}/resolve`,
    { method: "POST", credentials: "include", headers: _adminAuth(),
      body: JSON.stringify({ reason }) },
  ));
}


// ── Public ─────────────────────────────────────────────────────

export async function fetchHospitals(region = "") {
  const u = new URL(`${_base()}/api/v1/emergency/hospitals`);
  if (region) u.searchParams.set("region", region);
  return _wrap(fetch(u.toString(), { credentials: "include" }));
}
