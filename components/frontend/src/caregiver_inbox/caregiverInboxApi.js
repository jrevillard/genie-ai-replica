/**
 * Caregiver inbox + chat/emergency wrapper API.
 * ---------------------------------------------
 * Reads + writes on /api/v1/caregiver/*. All calls use the caregiver
 * JWT (localStorage AMINA_CG_TOKEN — same key CaregiverPortal uses) or
 * fall back to AMINA_TOKEN when it decodes to role=caregiver.
 *
 * Never throws — every function returns `{ data }` on success or
 * `{ _error: "..." }` on any failure so the UI can degrade gracefully.
 */

function _base() {
  const raw = (typeof window !== "undefined" && window.__AMINA_API_BASE__)
           || (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_BASE)
           || "http://localhost:8000";
  return String(raw).replace(/\/+$/, "");
}


function _caregiverToken() {
  try {
    const cg = localStorage.getItem("AMINA_CG_TOKEN");
    if (cg) return cg;
    // Fallback: an AMINA_TOKEN that decodes to role=caregiver.
    const tok = localStorage.getItem("AMINA_TOKEN");
    if (!tok) return "";
    const parts = tok.split(".");
    if (parts.length < 2) return "";
    const pad = "=".repeat((4 - (parts[1].length % 4)) % 4);
    const b64 = (parts[1] + pad).replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64));
    return payload?.role === "caregiver" ? tok : "";
  } catch {
    return "";
  }
}


function _headers() {
  const tok = _caregiverToken();
  return tok
    ? { "Authorization": `Bearer ${tok}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
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


export function hasCaregiverToken() {
  return !!_caregiverToken();
}


export async function listCaregiverInbox({ limit = 50, unreadOnly = false } = {}) {
  const u = new URL(`${_base()}/api/v1/caregiver/inbox/list`);
  u.searchParams.set("limit", String(limit));
  if (unreadOnly) u.searchParams.set("unread_only", "true");
  return _wrap(fetch(u.toString(), { credentials: "include", headers: _headers() }));
}


export async function unreadCaregiverInbox() {
  return _wrap(fetch(
    `${_base()}/api/v1/caregiver/inbox/unread-count`,
    { credentials: "include", headers: _headers() },
  ));
}


export async function markCaregiverRead(inboxId) {
  return _wrap(fetch(
    `${_base()}/api/v1/caregiver/inbox/${encodeURIComponent(inboxId)}/read`,
    { method: "POST", credentials: "include", headers: _headers() },
  ));
}


export async function markCaregiverAllRead() {
  return _wrap(fetch(
    `${_base()}/api/v1/caregiver/inbox/mark-all-read`,
    { method: "POST", credentials: "include", headers: _headers() },
  ));
}


// ── Chat + emergency wrappers ────────────────────────────────────────

export async function sendCaregiverChat(partnerId, text) {
  return _wrap(fetch(`${_base()}/api/v1/caregiver/chat/send`, {
    method: "POST", credentials: "include", headers: _headers(),
    body: JSON.stringify({ text, partner_id: partnerId }),
  }));
}


export async function sendEmergencyAlertToCaregivers(message, alertType = "emergency_triage") {
  // Patient-initiated — uses the patient AMINA_TOKEN, not the caregiver one.
  const tok = (() => {
    try { return localStorage.getItem("AMINA_TOKEN") || ""; }
    catch { return ""; }
  })();
  const headers = tok
    ? { "Authorization": `Bearer ${tok}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
  return _wrap(fetch(`${_base()}/api/v1/caregiver/emergency/send`, {
    method: "POST", credentials: "include", headers,
    body: JSON.stringify({ message, alert_type: alertType, severity: "emergency" }),
  }));
}
