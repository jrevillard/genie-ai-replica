/**
 * Scout management API wrappers.
 * ------------------------------
 * All endpoints live under /api/v1/community/scout. The role gate on
 * the backend (SCOUT_WRITE = {alkalo, admin}) enforces who can call
 * the write endpoints; the helpers just forward the JWT + role hint.
 */

function _base() {
  const raw = (typeof window !== "undefined" && window.__AMINA_API_BASE__)
           || (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_BASE)
           || "http://localhost:8000";
  return String(raw).replace(/\/+$/, "");
}


function _auth() {
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


export async function listScouts() {
  const r = await fetch(`${_base()}/api/v1/community/scouts`,
                        { credentials: "include" });
  return _parse(r);
}


export async function createScout({ name, age, village }, role = "alkalo") {
  const r = await fetch(`${_base()}/api/v1/community/scout/create`, {
    method: "POST", credentials: "include", headers: _auth(),
    body: JSON.stringify({ name, age, village, role }),
  });
  return _parse(r);
}


export async function removeScout(scoutId, role = "alkalo") {
  const r = await fetch(
    `${_base()}/api/v1/community/scout/${encodeURIComponent(scoutId)}?role=${encodeURIComponent(role)}`,
    { method: "DELETE", credentials: "include", headers: _auth() },
  );
  return _parse(r);
}


export async function assignElder({ scout_id, elder_name, relation, age }, role = "alkalo") {
  // Backend takes scout_id as a query-string param (AssignElderReq body
  // only carries elder fields + role). Keep the helper's signature flat
  // so callers don't need to know.
  const r = await fetch(
    `${_base()}/api/v1/community/scout/assign?scout_id=${encodeURIComponent(scout_id || "default")}`,
    {
      method: "POST", credentials: "include", headers: _auth(),
      body: JSON.stringify({ elder_name, relation, age, role }),
    },
  );
  return _parse(r);
}


export async function logCheck({ scout_id, elder_name, bp, flag }, role = "alkalo") {
  const r = await fetch(
    `${_base()}/api/v1/community/scout/check?scout_id=${encodeURIComponent(scout_id || "default")}`,
    {
      method: "PUT", credentials: "include", headers: _auth(),
      body: JSON.stringify({ elder_name, bp, flag, role }),
    },
  );
  return _parse(r);
}


export async function listApplications(role = "alkalo") {
  const r = await fetch(
    `${_base()}/api/v1/community/scout/applications?role=${encodeURIComponent(role)}`,
    { credentials: "include", headers: _auth() },
  );
  return _parse(r);
}


export async function approveApplication(applicationId, role = "alkalo") {
  const r = await fetch(`${_base()}/api/v1/community/scout/applications/approve`, {
    method: "POST", credentials: "include", headers: _auth(),
    body: JSON.stringify({ app_id: applicationId, role }),
  });
  return _parse(r);
}


export async function rejectApplication(applicationId, reason = "", role = "alkalo") {
  const r = await fetch(`${_base()}/api/v1/community/scout/applications/reject`, {
    method: "POST", credentials: "include", headers: _auth(),
    body: JSON.stringify({ app_id: applicationId, role, reason }),
  });
  return _parse(r);
}
