/**
 * Bantaba API wrappers — per-patient circles.
 * -------------------------------------------
 * Endpoints:
 *   GET    /community/bantaba?circle_id=...        (public read)
 *   GET    /community/bantaba/mine                 (JWT-resolved)
 *   POST   /community/bantaba/mine                 (idempotent init)
 *   POST   /community/bantaba/members              (alkalo/admin)
 *   DELETE /community/bantaba/members/{id}         (alkalo/admin)
 *   PUT    /community/bantaba/adherence            (alkalo anywhere, patient on own row)
 *   PUT    /community/bantaba/highlight            (alkalo/admin)
 *   PUT    /community/bantaba/rename               (alkalo/admin)
 *   GET    /community/bantaba/list?role=alkalo     (alkalo picker)
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
    err.body   = body;
    throw err;
  }
  return body;
}


const _cid = (id) => encodeURIComponent(id || "default");


export async function getBantaba(circleId = "default") {
  const r = await fetch(`${_base()}/api/v1/community/bantaba?circle_id=${_cid(circleId)}`,
                        { credentials: "include", headers: _auth() });
  return _parse(r);
}


export async function getMyBantaba() {
  const r = await fetch(`${_base()}/api/v1/community/bantaba/mine`,
                        { credentials: "include", headers: _auth() });
  return _parse(r);
}


export async function initMyBantaba() {
  const r = await fetch(`${_base()}/api/v1/community/bantaba/mine`, {
    method: "POST", credentials: "include", headers: _auth(),
  });
  return _parse(r);
}


export async function listCircles(role = "alkalo") {
  const r = await fetch(
    `${_base()}/api/v1/community/bantaba/list?role=${encodeURIComponent(role)}`,
    { credentials: "include", headers: _auth() },
  );
  return _parse(r);
}


export async function addMember(circleId, { name, age, conditions }, role = "alkalo") {
  const r = await fetch(
    `${_base()}/api/v1/community/bantaba/members?circle_id=${_cid(circleId)}`,
    {
      method: "POST", credentials: "include", headers: _auth(),
      body: JSON.stringify({ name, age, conditions: conditions || [], role }),
    },
  );
  return _parse(r);
}


export async function removeMember(circleId, memberId, role = "alkalo") {
  const r = await fetch(
    `${_base()}/api/v1/community/bantaba/members/${encodeURIComponent(memberId)}`
    + `?circle_id=${_cid(circleId)}&role=${encodeURIComponent(role)}`,
    { method: "DELETE", credentials: "include", headers: _auth() },
  );
  return _parse(r);
}


export async function logAdherence(circleId, { member_id, adherence_week }, role = "alkalo") {
  const r = await fetch(
    `${_base()}/api/v1/community/bantaba/adherence?circle_id=${_cid(circleId)}`,
    {
      method: "PUT", credentials: "include", headers: _auth(),
      body: JSON.stringify({ member_id, adherence_week, role }),
    },
  );
  return _parse(r);
}


export async function updateHighlight(circleId, highlight, role = "alkalo") {
  const r = await fetch(
    `${_base()}/api/v1/community/bantaba/highlight?circle_id=${_cid(circleId)}`,
    {
      method: "PUT", credentials: "include", headers: _auth(),
      body: JSON.stringify({ highlight, role }),
    },
  );
  return _parse(r);
}


export async function renameCircle(circleId, newName, role = "alkalo") {
  const r = await fetch(
    `${_base()}/api/v1/community/bantaba/rename?circle_id=${_cid(circleId)}`,
    {
      method: "PUT", credentials: "include", headers: _auth(),
      body: JSON.stringify({ new_name: newName, role }),
    },
  );
  return _parse(r);
}


// ── Patient → Alkalo "add member" request queue ──────────────────

export async function requestAddMember({
  candidate_name, candidate_age, candidate_conditions,
  relation, reason, phone,
}) {
  const r = await fetch(`${_base()}/api/v1/community/bantaba/members/request`, {
    method: "POST", credentials: "include", headers: _auth(),
    body: JSON.stringify({
      candidate_name, candidate_age, candidate_conditions,
      relation, reason, phone: phone || "",
    }),
  });
  return _parse(r);
}


// ── AMINA ID lookup + request-by-id ─────────────────────────────────

export async function lookupPatientByAminaId(aminaId) {
  const r = await fetch(
    `${_base()}/api/v1/patient/lookup/${encodeURIComponent(aminaId)}`,
    { credentials: "include", headers: _auth() },
  );
  return _parse(r);
}

export async function requestAddMemberById({
  candidate_amina_id, relation, reason,
}) {
  const r = await fetch(`${_base()}/api/v1/bantaba/members/request-by-id`, {
    method: "POST", credentials: "include", headers: _auth(),
    body: JSON.stringify({ candidate_amina_id, relation, reason }),
  });
  return _parse(r);
}

export async function getMyAminaId() {
  const r = await fetch(`${_base()}/api/v1/patient/amina-id`, {
    credentials: "include", headers: _auth(),
  });
  return _parse(r);
}


export async function listAddRequests(status = "pending", role = "alkalo") {
  const r = await fetch(
    `${_base()}/api/v1/community/bantaba/requests?status=${encodeURIComponent(status)}&role=${encodeURIComponent(role)}`,
    { credentials: "include", headers: _auth() },
  );
  return _parse(r);
}


export async function approveAddRequest(reqId, role = "alkalo") {
  const r = await fetch(
    `${_base()}/api/v1/community/bantaba/requests/${encodeURIComponent(reqId)}/approve`,
    {
      method: "POST", credentials: "include", headers: _auth(),
      body: JSON.stringify({ role }),
    },
  );
  return _parse(r);
}


export async function rejectAddRequest(reqId, reason = "", role = "alkalo") {
  const r = await fetch(
    `${_base()}/api/v1/community/bantaba/requests/${encodeURIComponent(reqId)}/reject`,
    {
      method: "POST", credentials: "include", headers: _auth(),
      body: JSON.stringify({ role, reason }),
    },
  );
  return _parse(r);
}
