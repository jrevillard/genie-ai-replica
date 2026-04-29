/**
 * Policy review API client.
 * -------------------------
 * Talks to the Phase 6.3 endpoints under /api/v1/policy/*.
 *
 * Auth: caregiver JWT (AMINA_CG_TOKEN, falling back to any AMINA_TOKEN
 * that decodes to role=caregiver) — same rules as caregiverInboxApi.js
 * so the modal works wherever the caregiver inbox bell is mounted.
 *
 * Never throws — every function returns { data } on 2xx, or
 * { _error, _status, _payload } on 4xx/5xx/network so the UI can
 * branch on status (401/403/404/422/5xx) without try/catch.
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
      const msg = (body && (body.detail?.message || body.detail || body.message))
                  || `HTTP ${resp.status}`;
      return { _error: typeof msg === "string" ? msg : JSON.stringify(msg),
               _status: resp.status, _payload: body };
    }
    return { data: body };
  } catch (e) {
    return { _error: e.message || String(e), _status: 0 };
  }
}

export function hasCaregiverToken() {
  return !!_caregiverToken();
}

/** GET /api/v1/policy/{inbox_id}/details — returns the policy view payload. */
export async function fetchPolicyDetails(inboxId) {
  return _wrap(fetch(
    `${_base()}/api/v1/policy/${encodeURIComponent(inboxId)}/details`,
    { credentials: "include", headers: _headers() },
  ));
}

/**
 * POST /api/v1/policy/{inbox_id}/accept — submits the canonical shape
 * { typed_signature, pin }. The backend stores a client_gated audit
 * marker (FRONTEND_CHECKBOX_WORDING_V1) when checkboxes are omitted.
 */
export async function postPolicyAccept(inboxId, typedSignature, pin) {
  return _wrap(fetch(
    `${_base()}/api/v1/policy/${encodeURIComponent(inboxId)}/accept`,
    {
      method: "POST",
      credentials: "include",
      headers: _headers(),
      body: JSON.stringify({ typed_signature: typedSignature, pin }),
    },
  ));
}

/** Heuristic — true iff this inbox row is a policy-review item. */
export function isPolicyReviewItem(item) {
  if (!item) return false;
  const sid = String(item.source_id || "");
  return sid.startsWith("policy:");
}
