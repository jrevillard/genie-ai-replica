/**
 * AMINA Care — Inbox API client
 * ================================
 * Thin wrapper around /api/v1/inbox/* endpoints. Reads JWT from
 * `localStorage.AMINA_TOKEN` (the same key App.jsx sets on login).
 *
 * Used by:
 *   - useInbox()         — polling + state management
 *   - InboxItemCard      — mark-read on click
 *   - ChatInterceptor    — pushes agent PDFs into the inbox post-response
 *
 * Never throws. Every call returns either a data object or { _error: "..." }
 * so callers can render a soft error without a crash.
 */

const API_BASE = (typeof window !== "undefined" && window.AMINA_API) || "http://localhost:8000";

// Caregiver sessions store their JWT under `cg_token` and validate against
// /api/v1/caregiver/inbox/*. Patient sessions use AMINA_TOKEN against
// /api/v1/inbox/*. The two token spaces are NOT interchangeable.
function _isCaregiverSession() {
  if (typeof localStorage === "undefined") return false;
  try {
    const role = localStorage.getItem("AMINA_ROLE") || "patient";
    if (role !== "clinician" && role !== "caregiver") return false;
    return !!localStorage.getItem("cg_token");
  } catch { return false; }
}

function authHeader() {
  if (typeof localStorage === "undefined") return {};
  if (_isCaregiverSession()) {
    const cg = localStorage.getItem("cg_token") || "";
    return cg ? { Authorization: `Bearer ${cg}` } : {};
  }
  const t = localStorage.getItem("AMINA_TOKEN") || "";
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function _inboxBase() {
  return _isCaregiverSession()
    ? `${API_BASE}/api/v1/caregiver/inbox`
    : `${API_BASE}/api/v1/inbox`;
}

async function safeJson(r) {
  try { return await r.json(); }
  catch { return { _error: `HTTP ${r.status}` }; }
}

/** GET /inbox/list */
export async function listInbox({ limit = 50, offset = 0, unread = false, kind = "" } = {}) {
  const q = new URLSearchParams();
  q.set("limit",  String(limit));
  q.set("offset", String(offset));
  if (unread) q.set("unread", "true");
  if (kind)   q.set("kind",   kind);
  try {
    const r = await fetch(`${_inboxBase()}/list?${q}`, {
      headers: authHeader(),
    });
    if (!r.ok) return { items: [], count: 0, unread: 0, _error: `HTTP ${r.status}` };
    return await r.json();
  } catch (e) {
    return { items: [], count: 0, unread: 0, _error: String(e) };
  }
}

/** GET /inbox/unread-count — cheap, safe to poll every 20s. */
export async function unreadCount() {
  try {
    const r = await fetch(`${_inboxBase()}/unread-count`, {
      headers: authHeader(),
    });
    if (!r.ok) return 0;
    const d = await r.json();
    return Number(d.unread || 0);
  } catch {
    return 0;
  }
}

/** POST /inbox/{id}/read */
export async function markRead(inboxId) {
  try {
    const r = await fetch(`${_inboxBase()}/${encodeURIComponent(inboxId)}/read`, {
      method: "POST",
      headers: authHeader(),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** POST /inbox/mark-all-read */
export async function markAllRead() {
  try {
    const r = await fetch(`${_inboxBase()}/mark-all-read`, {
      method: "POST",
      headers: authHeader(),
    });
    const d = await safeJson(r);
    return Number(d.updated || 0);
  } catch {
    return 0;
  }
}

/** POST /inbox/send — for frontend-initiated pushes (e.g. capturing an
 *  agent-emitted PDF into the patient's inbox). */
export async function sendInboxItem(payload) {
  try {
    const r = await fetch(`${API_BASE}/api/v1/inbox/send`, {
      method:  "POST",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    return await safeJson(r);
  } catch (e) {
    return { _error: String(e) };
  }
}

/** POST /inbox/capture-file (multipart). File is uploaded + the inbox item
 *  that references it is created in one atomic call. */
export async function captureFile({ file, title, body = "", kind = "pdf", source = "agent", severity = "info", ttlDays = 60 }) {
  try {
    const fd = new FormData();
    fd.append("file",      file);
    fd.append("title",     title);
    fd.append("body",      body);
    fd.append("kind",      kind);
    fd.append("source",    source);
    fd.append("severity",  severity);
    fd.append("ttl_days",  String(ttlDays));
    const r = await fetch(`${API_BASE}/api/v1/inbox/capture-file`, {
      method:  "POST",
      headers: authHeader(),
      body:    fd,
    });
    return await safeJson(r);
  } catch (e) {
    return { _error: String(e) };
  }
}

/**
 * Build a browser-downloadable URL from a file token.
 * The endpoint does NOT require JWT — token IS the auth — so this URL
 * is safe to stick in an <a download> or share on a channel.
 */
export function downloadUrl(token) {
  if (!token) return "";
  return `${API_BASE}/api/v1/inbox/file/${encodeURIComponent(token)}`;
}

export { API_BASE };
