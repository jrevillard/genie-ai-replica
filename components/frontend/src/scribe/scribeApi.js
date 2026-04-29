/**
 * scribeApi — thin fetch wrappers for /api/v1/scribe/*.
 * Reads AMINA_TOKEN from localStorage; every call is scoped by the
 * patient resolved on the server from the JWT + patient_id body.
 */

const API_BASE = (typeof window !== "undefined" && window.AMINA_API) || "http://localhost:8000";

function authHeader() {
  const t = (typeof localStorage !== "undefined" && localStorage.getItem("AMINA_TOKEN")) || "";
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function safeJson(r) {
  try { return await r.json(); }
  catch { return { _error: `HTTP ${r.status}` }; }
}

/** POST /scribe/start */
export async function startSession({ patientId, language = "en", titleHint = "" }) {
  try {
    const r = await fetch(`${API_BASE}/api/v1/scribe/start`, {
      method: "POST",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({ patient_id: patientId, language, title_hint: titleHint }),
    });
    return await safeJson(r);
  } catch (e) {
    return { _error: String(e) };
  }
}

/** GET /scribe/{id} */
export async function getSession(sessionId) {
  try {
    const r = await fetch(`${API_BASE}/api/v1/scribe/${encodeURIComponent(sessionId)}`, {
      headers: authHeader(),
    });
    return await safeJson(r);
  } catch (e) {
    return { _error: String(e) };
  }
}

/** POST /scribe/{id}/chunk  (multipart) */
export async function uploadChunk(sessionId, blob) {
  try {
    const fd = new FormData();
    fd.append("chunk", blob, "chunk.webm");
    const r = await fetch(`${API_BASE}/api/v1/scribe/${encodeURIComponent(sessionId)}/chunk`, {
      method: "POST",
      headers: authHeader(),
      body: fd,
    });
    return await safeJson(r);
  } catch (e) {
    return { _error: String(e) };
  }
}

/** POST /scribe/{id}/finish */
export async function finishSession(sessionId) {
  try {
    const r = await fetch(`${API_BASE}/api/v1/scribe/${encodeURIComponent(sessionId)}/finish`, {
      method: "POST",
      headers: authHeader(),
    });
    return await safeJson(r);
  } catch (e) {
    return { _error: String(e) };
  }
}

/** POST /scribe/{id}/finalize */
export async function finalizeSession(sessionId, draft, signedByName = "") {
  try {
    const r = await fetch(`${API_BASE}/api/v1/scribe/${encodeURIComponent(sessionId)}/finalize`, {
      method: "POST",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({ ...draft, signed_by_name: signedByName }),
    });
    return await safeJson(r);
  } catch (e) {
    return { _error: String(e) };
  }
}

export { API_BASE };
