/**
 * dhis2TrackerApi — thin wrappers for /api/v1/dhis2/tracker/*.
 *
 * All endpoints require an admin JWT. This module reads the active admin
 * token from localStorage.AMINA_TOKEN (AuthScreen stores it there for
 * admin + patient alike) OR accepts an explicit `token` argument the
 * embedding panel can pass in — useful when the AdminDashboard already
 * holds the token in component state.
 */

const API_BASE = (typeof window !== "undefined" && window.AMINA_API) || "http://localhost:8000";

function authHeader(explicit) {
  const t = explicit ||
    (typeof localStorage !== "undefined" && localStorage.getItem("AMINA_TOKEN")) ||
    "";
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function safeJson(r) {
  try { return await r.json(); }
  catch { return { _error: `HTTP ${r.status}` }; }
}

/** GET /dhis2/tracker/config — current Tracker configuration, redacted. */
export async function getConfig(token) {
  try {
    const r = await fetch(`${API_BASE}/api/v1/dhis2/tracker/config`, {
      headers: authHeader(token),
    });
    return r.ok ? r.json() : { _error: `HTTP ${r.status}`, _status: r.status };
  } catch (e) {
    return { _error: String(e) };
  }
}

/** GET /dhis2/tracker/audit?patient_id=&limit= — recent push attempts. */
export async function getAudit(token, { patientId = "", limit = 50 } = {}) {
  try {
    const q = new URLSearchParams();
    q.set("limit", String(limit));
    if (patientId) q.set("patient_id", patientId);
    const r = await fetch(`${API_BASE}/api/v1/dhis2/tracker/audit?${q}`, {
      headers: authHeader(token),
    });
    return r.ok ? r.json() : { _error: `HTTP ${r.status}` };
  } catch (e) {
    return { _error: String(e) };
  }
}

/** POST /dhis2/tracker/dry-run — renders TEI + enrollment + event payloads. */
export async function dryRun(token, { patientId, force = false }) {
  try {
    const r = await fetch(`${API_BASE}/api/v1/dhis2/tracker/dry-run`, {
      method:  "POST",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body:    JSON.stringify({ patient_id: patientId, force }),
    });
    return await safeJson(r);
  } catch (e) {
    return { _error: String(e) };
  }
}

/** POST /dhis2/tracker/push — live push for a single patient. */
export async function pushPatient(token, { patientId, force = false }) {
  try {
    const r = await fetch(`${API_BASE}/api/v1/dhis2/tracker/push`, {
      method:  "POST",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body:    JSON.stringify({ patient_id: patientId, force }),
    });
    return await safeJson(r);
  } catch (e) {
    return { _error: String(e) };
  }
}

/** POST /dhis2/tracker/batch — up to 100 patients sequentially. */
export async function pushBatch(token, { patientIds, force = false }) {
  try {
    const r = await fetch(`${API_BASE}/api/v1/dhis2/tracker/batch`, {
      method:  "POST",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body:    JSON.stringify({ patient_ids: patientIds, force }),
    });
    return await safeJson(r);
  } catch (e) {
    return { _error: String(e) };
  }
}

/**
 * Helper — list patients from the admin directory. Uses the existing
 * /api/v1/admin/patients endpoint that AdminDashboard.jsx already
 * consumes; we just reuse the same payload.
 */
export async function listPatients(token, { search = "", limit = 100 } = {}) {
  try {
    const q = new URLSearchParams();
    q.set("limit", String(limit));
    if (search) q.set("search", search);
    const r = await fetch(`${API_BASE}/api/v1/admin/patients?${q}`, {
      headers: authHeader(token),
    });
    if (!r.ok) return { _error: `HTTP ${r.status}`, patients: [] };
    const body = await r.json();
    return { patients: body.patients || [] };
  } catch (e) {
    return { _error: String(e), patients: [] };
  }
}


// ─── History + Discovery (cross-phase: aggregate + tracker) ────────────────

/** GET /dhis2/sync/history — aggregate push audit log with filters. */
export async function getAggregateHistory(token, {
  limit = 50, since = "", until = "", success = null, period = "",
} = {}) {
  try {
    const q = new URLSearchParams();
    q.set("limit", String(limit));
    if (since)  q.set("since",  since);
    if (until)  q.set("until",  until);
    if (period) q.set("period", period);
    if (success === true || success === false) {
      q.set("success", success ? "true" : "false");
    }
    const r = await fetch(`${API_BASE}/api/v1/dhis2/sync/history?${q}`, {
      headers: authHeader(token),
    });
    return r.ok ? r.json() : { _error: `HTTP ${r.status}`, entries: [] };
  } catch (e) {
    return { _error: String(e), entries: [] };
  }
}

/** GET /dhis2/sync/history/tracker — patient-level audit log with filters. */
export async function getTrackerHistory(token, {
  limit = 50, since = "", until = "", success = null, patientId = "",
} = {}) {
  try {
    const q = new URLSearchParams();
    q.set("limit", String(limit));
    if (since)     q.set("since",      since);
    if (until)     q.set("until",      until);
    if (patientId) q.set("patient_id", patientId);
    if (success === true || success === false) {
      q.set("success", success ? "true" : "false");
    }
    const r = await fetch(`${API_BASE}/api/v1/dhis2/sync/history/tracker?${q}`, {
      headers: authHeader(token),
    });
    return r.ok ? r.json() : { _error: `HTTP ${r.status}`, entries: [] };
  } catch (e) {
    return { _error: String(e), entries: [] };
  }
}

/** GET /dhis2/discover — list live datasets on the configured DHIS2 instance. */
export async function discoverDatasets(token, { pageSize = 50 } = {}) {
  try {
    const r = await fetch(
      `${API_BASE}/api/v1/dhis2/discover?page_size=${pageSize}`,
      { headers: authHeader(token) },
    );
    return r.ok ? r.json() : { _error: `HTTP ${r.status}`, datasets: [] };
  } catch (e) {
    return { _error: String(e), datasets: [] };
  }
}

/** GET /dhis2/discover/dataset/{id} — data elements + org units for a dataset. */
export async function describeDataset(token, datasetId) {
  try {
    const r = await fetch(
      `${API_BASE}/api/v1/dhis2/discover/dataset/${encodeURIComponent(datasetId)}`,
      { headers: authHeader(token) },
    );
    return r.ok ? r.json() : { _error: `HTTP ${r.status}` };
  } catch (e) {
    return { _error: String(e) };
  }
}

/** GET /dhis2/mapping/current — mapping currently in force (env-derived). */
export async function getCurrentMapping(token) {
  try {
    const r = await fetch(`${API_BASE}/api/v1/dhis2/mapping/current`, {
      headers: authHeader(token),
    });
    return r.ok ? r.json() : { _error: `HTTP ${r.status}` };
  } catch (e) {
    return { _error: String(e) };
  }
}

/** POST /dhis2/sync/manual — trigger a live push for a given day (YYYY-MM-DD). */
export async function triggerAggregatePush(token, { day = "" } = {}) {
  try {
    const r = await fetch(`${API_BASE}/api/v1/dhis2/sync/manual`, {
      method: "POST",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify(day ? { day } : {}),
    });
    return r.ok ? r.json() : { _error: `HTTP ${r.status}` };
  } catch (e) {
    return { _error: String(e) };
  }
}

/** POST /dhis2/sync/dry-run — preview aggregate payload for a day. */
export async function dryRunAggregate(token, { day = "" } = {}) {
  try {
    const r = await fetch(`${API_BASE}/api/v1/dhis2/sync/dry-run`, {
      method: "POST",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify(day ? { day } : {}),
    });
    return r.ok ? r.json() : { _error: `HTTP ${r.status}` };
  } catch (e) {
    return { _error: String(e) };
  }
}

export { API_BASE };
