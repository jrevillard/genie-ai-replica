/**
 * formsApi — thin wrappers for symptom + prescription submissions.
 *
 * Submission flow: payloads are posted to /api/v1/inbox/send so each
 * submission becomes a searchable inbox item (source=system / kind=report
 * for symptoms, source=agent / kind=pdf for prescriptions). This mirrors
 * the caregiver-alert model where a human-initiated signal lands in the
 * same persistent queue as automated messages.
 *
 * We deliberately avoid a separate "symptom_reports" or "prescriptions"
 * table — one inbox-table with well-tagged items keeps the MVP querable
 * by source/kind without new schemas.
 */

import { API_BASE, captureFile, sendInboxItem } from "../inbox/inboxApi.js";

function authHeader() {
  const t = (typeof localStorage !== "undefined" && localStorage.getItem("AMINA_TOKEN")) || "";
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function patientId() {
  try {
    const p = JSON.parse(localStorage.getItem("AMINA_PATIENT") || "null");
    return p?.id || "";
  } catch { return ""; }
}

export async function submitSymptomReport({ symptoms, severity, duration, notes }) {
  const pid = patientId();
  if (!pid) return { _error: "not signed in" };

  const severityTier = (severity || "info").toLowerCase();
  const title = `Symptom report: ${(symptoms || "general").slice(0, 60)}`;
  const bodyLines = [
    symptoms ? `What: ${symptoms}` : "",
    duration ? `Duration: ${duration}` : "",
    notes    ? `Notes: ${notes}` : "",
  ].filter(Boolean);
  const body = bodyLines.join("\n");

  // First: inbox item so the patient sees the confirmation.
  const r = await sendInboxItem({
    patient_id: pid,
    kind:       "report",
    title,
    body,
    severity:   ["info","warning","emergency"].includes(severityTier) ? severityTier : "info",
    source:     "system",
    source_id:  `symptom:${Date.now()}`,
    metadata:   { form: "symptom", symptoms, severity: severityTier, duration, notes },
    ttl_days:   180,
  });
  if (r._error) return r;

  // Optionally: fire-and-forget forwarding to the agent so it registers
  // the symptom in clinical memory. Uses the existing /agent/chat endpoint
  // so we don't need a new route.
  try {
    await fetch(`${API_BASE}/api/v1/agent/chat`, {
      method:  "POST",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body:    JSON.stringify({
        message:   `I'm reporting new symptoms via the form: ${body}`,
        channel:   "form",
        user_role: "patient",
        intent:    "symptom_report_form",
        session_id: localStorage.getItem("AMINA_SID") || undefined,
      }),
    });
  } catch { /* non-fatal */ }

  // Poke the bell.
  window.dispatchEvent(new CustomEvent("amina:inbox:refresh"));
  return { ok: true, item: r.item };
}

export async function submitPrescription({ file, doctor, condition, notes }) {
  if (!file) return { _error: "no file" };
  if (!patientId()) return { _error: "not signed in" };

  const title = doctor ? `Prescription from Dr. ${doctor}` : "Prescription uploaded";
  const bodyLines = [
    condition ? `For: ${condition}` : "",
    notes     ? `Notes: ${notes}` : "",
  ].filter(Boolean);

  const r = await captureFile({
    file,
    title,
    body:    bodyLines.join("\n"),
    kind:    "pdf",
    source:  "agent",
    severity:"info",
    ttlDays: 365,
  });
  if (r._error) return r;

  // Nudge the agent so future chats know there's an active prescription.
  try {
    await fetch(`${API_BASE}/api/v1/agent/chat`, {
      method:  "POST",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body:    JSON.stringify({
        message:   `I uploaded a new prescription${doctor ? ` from Dr. ${doctor}` : ""}${condition ? ` for ${condition}` : ""}. Please acknowledge.`,
        channel:   "form",
        user_role: "patient",
        intent:    "prescription_upload",
        session_id: localStorage.getItem("AMINA_SID") || undefined,
      }),
    });
  } catch { /* non-fatal */ }

  window.dispatchEvent(new CustomEvent("amina:inbox:refresh"));
  return { ok: true, item: r.item, token: r.token };
}
