/**
 * Dual-Path Care Ledger API helpers.
 * -----------------------------------
 * Thin wrappers around /api/v1/care/dualpath_ledger/* — the multi-entry
 * version of /care/dualpath. Types: traditional | modern | interaction
 * | progress.
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


async function _parse(resp) {
  let body = null;
  try { body = await resp.json(); } catch { /* noop */ }
  if (!resp.ok) {
    const err = new Error(
      (body && (body.detail?.message || body.detail || body.message))
      || `HTTP ${resp.status}`,
    );
    err.status = resp.status;
    err.code   = body?.detail?.code || null;
    err.body   = body;
    throw err;
  }
  return body;
}


export const DUALPATH_TYPES = ["traditional", "modern", "interaction", "progress"];


export async function listAllDualpath(sessionId) {
  const r = await fetch(
    `${_base()}/api/v1/care/dualpath_ledger/${encodeURIComponent(sessionId)}`,
    { credentials: "include" },
  );
  return _parse(r);
}


export async function listDualpath(sessionId, type_) {
  const r = await fetch(
    `${_base()}/api/v1/care/dualpath_ledger/${encodeURIComponent(sessionId)}/${type_}`,
    { credentials: "include" },
  );
  return _parse(r);
}


export async function addDualpath(sessionId, type_, payload, role = "clinician") {
  const r = await fetch(
    `${_base()}/api/v1/care/dualpath_ledger/${encodeURIComponent(sessionId)}/${type_}/add`,
    {
      method:      "POST",
      credentials: "include",
      headers:     _authHeaders(),
      body:        JSON.stringify({ ...payload, role }),
    },
  );
  return _parse(r);
}


export async function patchDualpath(sessionId, type_, index, payload, role = "clinician") {
  const r = await fetch(
    `${_base()}/api/v1/care/dualpath_ledger/${encodeURIComponent(sessionId)}/${type_}/${index}`,
    {
      method:      "PATCH",
      credentials: "include",
      headers:     _authHeaders(),
      body:        JSON.stringify({ ...payload, role }),
    },
  );
  return _parse(r);
}


export async function deleteDualpath(sessionId, type_, index, role = "clinician") {
  const r = await fetch(
    `${_base()}/api/v1/care/dualpath_ledger/${encodeURIComponent(sessionId)}/${type_}/${index}?role=${encodeURIComponent(role)}`,
    {
      method:      "DELETE",
      credentials: "include",
      headers:     _authHeaders(),
    },
  );
  return _parse(r);
}
