/**
 * Village scoreboard API wrappers.
 * --------------------------------
 * All endpoints live under /api/v1/community/village*. Backend gate
 * after the 2026-04-19 role split:
 *   VILLAGE_WRITE = {vhw, alkalo, admin}
 * Alkalo-notes are additionally gated to {alkalo, admin} at the route
 * level (the regional scoreboard pillar edits are shared with VHW).
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


export async function getVillage(village = "Kerewan") {
  const r = await fetch(
    `${_base()}/api/v1/community/village?village=${encodeURIComponent(village)}`,
    { credentials: "include" },
  );
  return _parse(r);
}


export async function updatePillar({ pillar_id, score, detail, village = "Kerewan" }, role = "alkalo") {
  const r = await fetch(
    `${_base()}/api/v1/community/village/pillar?village=${encodeURIComponent(village)}`,
    {
      method: "PUT",
      credentials: "include",
      headers: _auth(),
      body: JSON.stringify({ pillar_id, score, detail: detail || "", role }),
    },
  );
  return _parse(r);
}


export async function addAlkaloNote(note, role = "alkalo", village = "Kerewan") {
  const r = await fetch(
    `${_base()}/api/v1/community/village/alkalo-note?village=${encodeURIComponent(village)}`,
    {
      method: "POST",
      credentials: "include",
      headers: _auth(),
      body: JSON.stringify({ note, role }),
    },
  );
  return _parse(r);
}
