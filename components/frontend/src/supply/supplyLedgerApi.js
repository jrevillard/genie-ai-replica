/**
 * Supply Ledger API helpers.
 * ---------------------------
 * Thin wrappers around the /api/v1/care/supply_ledger endpoints mounted
 * by src/api/supply_ledger_routes.py. The functions all return the full
 * ledger envelope so the modal can re-render from a single source of
 * truth after every mutation:
 *
 *   { medications, count, cap, cap_remaining, limit_reached,
 *     updated_at, updated_by }
 *
 * Auth
 * ----
 * Every write call carries `Authorization: Bearer <AMINA_ADMIN_TOKEN ||
 * AMINA_TOKEN>` so the backend's effective-role resolver can honor
 * admin / admin-patient impersonation. Reads are public (no header).
 */

function _base() {
  const raw = (typeof window !== "undefined" && window.__AMINA_API_BASE__)
           || (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_BASE)
           || "http://localhost:8000";
  return String(raw).replace(/\/+$/, "");
}


function _authHeaders() {
  try {
    const tok = localStorage.getItem("AMINA_ADMIN_TOKEN")
             || localStorage.getItem("AMINA_TOKEN")
             || "";
    return tok
      ? { "Authorization": `Bearer ${tok}`, "Content-Type": "application/json" }
      : { "Content-Type": "application/json" };
  } catch {
    return { "Content-Type": "application/json" };
  }
}


async function _parseOrThrow(resp) {
  let body = null;
  try { body = await resp.json(); } catch { /* fall-through */ }
  if (!resp.ok) {
    const err = new Error(
      (body && (body.detail?.message || body.detail || body.message))
      || `HTTP ${resp.status}`
    );
    err.status = resp.status;
    err.code   = body?.detail?.code || null;
    err.body   = body;
    throw err;
  }
  return body;
}


export async function listLedger(sessionId) {
  const r = await fetch(
    `${_base()}/api/v1/care/supply_ledger/${encodeURIComponent(sessionId)}`,
    { credentials: "include" },
  );
  return _parseOrThrow(r);
}


export async function addLedgerEntry(sessionId, payload, role = "clinician") {
  const r = await fetch(
    `${_base()}/api/v1/care/supply_ledger/${encodeURIComponent(sessionId)}/add`,
    {
      method:      "POST",
      credentials: "include",
      headers:     _authHeaders(),
      body:        JSON.stringify({ ...payload, role }),
    },
  );
  return _parseOrThrow(r);
}


export async function patchLedgerEntry(sessionId, index, payload, role = "clinician") {
  const r = await fetch(
    `${_base()}/api/v1/care/supply_ledger/${encodeURIComponent(sessionId)}/medications/${index}`,
    {
      method:      "PATCH",
      credentials: "include",
      headers:     _authHeaders(),
      body:        JSON.stringify({ ...payload, role }),
    },
  );
  return _parseOrThrow(r);
}


export async function deleteLedgerEntry(sessionId, index, role = "clinician") {
  const r = await fetch(
    `${_base()}/api/v1/care/supply_ledger/${encodeURIComponent(sessionId)}/medications/${index}?role=${encodeURIComponent(role)}`,
    {
      method:      "DELETE",
      credentials: "include",
      headers:     _authHeaders(),
    },
  );
  return _parseOrThrow(r);
}
