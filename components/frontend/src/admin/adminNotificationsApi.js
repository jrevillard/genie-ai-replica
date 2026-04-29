/**
 * Admin notifications API client.
 * --------------------------------
 * Polls the same admin endpoints People.jsx already consumes so the
 * bell badge stays in sync with the section tabs without any
 * cross-component coupling.
 *
 * Auth: AMINA_TOKEN that decodes to role=admin. The bell stays hidden
 * for any other role.
 */

function _base() {
  const raw = (typeof window !== "undefined" && window.__AMINA_API_BASE__)
           || (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_BASE)
           || "http://localhost:8000";
  return String(raw).replace(/\/+$/, "");
}

export function adminToken() {
  try {
    const tok = localStorage.getItem("AMINA_TOKEN");
    if (!tok) return "";
    const parts = tok.split(".");
    if (parts.length < 2) return "";
    const pad = "=".repeat((4 - (parts[1].length % 4)) % 4);
    const b64 = (parts[1] + pad).replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64));
    return payload?.role === "admin" ? tok : "";
  } catch {
    return "";
  }
}

function _headers() {
  const tok = adminToken();
  return tok
    ? { "Authorization": `Bearer ${tok}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

async function _fetchJson(path) {
  try {
    const r = await fetch(`${_base()}${path}`,
      { credentials: "include", headers: _headers() });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/** Returns { count, sample: [{id, label, subtext}] } for pending CG apps. */
export async function fetchPendingApprovals() {
  const j = await _fetchJson(
    "/api/v1/caregiver-v2/admin/applications?status=pending&limit=20");
  if (!j) return { count: 0, sample: [] };
  const apps = j.applications || [];
  return {
    count: j.status_counts?.pending ?? apps.length ?? 0,
    sample: apps.slice(0, 5).map((a) => ({
      id:      a.registration_id,
      label:   a.full_name || a.registration_id,
      subtext: `${a.role_label || a.role || "caregiver"} · ${a.phone || ""}`,
    })),
  };
}

/** Pending literacy verifications. */
export async function fetchPendingLiteracy() {
  const j = await _fetchJson("/api/v1/literacy/admin/queue?limit=20");
  if (!j) return { count: 0, sample: [] };
  const queue = j.queue || [];
  return {
    count: queue.length,
    sample: queue.slice(0, 5).map((q) => ({
      id:      q.patient_id,
      label:   q.patient_name || q.patient_id,
      subtext: `Declared: ${q.declared_level || "—"}`,
    })),
  };
}

/** Pending care-transfer requests. */
export async function fetchPendingTransfers() {
  const j = await _fetchJson("/api/v1/admin/transfer-requests");
  if (!j) return { count: 0, sample: [] };
  const reqs = (j.requests || []).filter(
    (r) => (r.status || "").toLowerCase() === "pending");
  return {
    count: j.pending ?? reqs.length,
    sample: reqs.slice(0, 5).map((r) => ({
      id:      r.request_id,
      label:   r.patient_name || r.request_id,
      subtext: `${r.from_caregiver_name || "?"} → ${r.to_caregiver_name || "?"}`,
    })),
  };
}
