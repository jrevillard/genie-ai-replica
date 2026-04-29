/**
 * PatientDetailSheet — the Patient 360 side-sheet.
 *
 * Renders in the AdminShell when the admin clicks a patient row.
 * Pulls /api/v1/admin/mv/patient/:id/360 which returns:
 *   profile · vitals (bp / glucose / weight timelines) ·
 *   consultations · care_team
 *
 * Vitals charts are pure SVG (Sparkline primitive) so the sheet stays
 * light-weight (no chart library needed here).
 */

import {
  Phone, MapPin, Pill as PillIcon, UserCircle,
  ClipboardList, HeartPulse, Users, Clock,
} from "lucide-react";

import {
  Sheet, Card, Stat, Badge, Pill, Sparkline,
} from "../primitives/index.jsx";
import { useAdminApi } from "../hooks/useAdminApi.js";


function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch { return iso; }
}


export default function PatientDetailSheet({ patientId, onClose }) {
  const url = patientId ? `/api/v1/admin/mv/patient/${patientId}/360` : null;
  const { data, loading, error } = useAdminApi(url || "/api/v1/admin/mv/command-center"); // dummy URL when closed

  if (!patientId) return null;

  const profile = data?.profile || {};
  const vitals  = data?.vitals  || {};
  const consults = data?.consultations || [];
  const team    = data?.care_team || [];

  const bpSystolic = (vitals.bp || []).map((p) => p[0]);
  const bpLatest   = (vitals.bp || [])[vitals.bp?.length - 1];

  return (
    <Sheet open={!!patientId} onClose={onClose}
           title={profile.name || patientId}
           actions={data?.synthetic && <Badge tone="neutral">Demo data</Badge>}>
      {loading && !data && (
        <div style={{ color: "var(--a-fg-dim)", fontSize: 13, padding: 20, textAlign: "center" }}>
          Loading patient file…
        </div>
      )}
      {error && !data && (
        <div style={{ color: "var(--a-danger)", fontSize: 13, padding: 20, textAlign: "center" }}>
          Could not load this patient: {error}
        </div>
      )}

      {data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Profile card */}
          <Card>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
              <div style={{
                width: 56, height: 56, borderRadius: "50%",
                background: "linear-gradient(135deg, var(--a-accent-2), color-mix(in oklab, var(--a-accent-2), black 30%))",
                color: "#fff", fontWeight: 700, fontSize: 22,
                display: "grid", placeItems: "center",
                flexShrink: 0,
                boxShadow: "0 6px 14px color-mix(in oklab, var(--a-accent-2), transparent 60%)",
              }}>
                {(profile.name || "?").charAt(0)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{
                  fontSize: "var(--a-text-18)", fontWeight: 700,
                  color: "var(--a-fg)",
                }}>
                  {profile.name || patientId}
                </div>
                <div style={{
                  display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap",
                }}>
                  {profile.age != null && <Pill leadIcon={UserCircle}>{profile.age}y · {profile.gender || "—"}</Pill>}
                  {profile.region && <Pill leadIcon={MapPin}>{profile.region}</Pill>}
                  {profile.phone && <Pill leadIcon={Phone}>{profile.phone}</Pill>}
                </div>
                {(profile.conditions?.length > 0 || profile.medications?.length > 0 || profile.allergies?.length > 0) && (
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6,
                                fontSize: 12, color: "var(--a-fg-mute)" }}>
                    {profile.conditions?.length > 0 && (
                      <div><strong style={{ color: "var(--a-fg)" }}>Conditions:</strong> {profile.conditions.join(", ")}</div>
                    )}
                    {profile.medications?.length > 0 && (
                      <div><strong style={{ color: "var(--a-fg)" }}>Medications:</strong> {profile.medications.map((m) => m.name || m).join(", ")}</div>
                    )}
                    {profile.allergies?.length > 0 && (
                      <div><strong style={{ color: "var(--a-fg)" }}>Allergies:</strong> {profile.allergies.join(", ")}</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </Card>

          {/* Vitals timeline */}
          <Card title="Vitals" actions={<Pill leadIcon={HeartPulse}>12 readings</Pill>}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
              <div>
                <Stat
                  label="Blood pressure"
                  value={bpLatest ? `${bpLatest[0]}/${bpLatest[1]}` : "—"}
                  sub="latest reading"
                />
                {bpSystolic.length > 1 && (
                  <div style={{ marginTop: 8 }}>
                    <Sparkline data={bpSystolic} width={160} height={36} stroke="var(--a-danger)" />
                  </div>
                )}
              </div>
              <div>
                <Stat
                  label="Glucose (mmol/L)"
                  value={vitals.glucose?.length ? vitals.glucose[vitals.glucose.length - 1].toFixed(1) : "—"}
                  sub="latest reading"
                />
                {vitals.glucose?.length > 1 && (
                  <div style={{ marginTop: 8 }}>
                    <Sparkline data={vitals.glucose} width={160} height={36} stroke="var(--a-accent)" />
                  </div>
                )}
              </div>
              <div>
                <Stat
                  label="Weight (kg)"
                  value={vitals.weight?.length ? vitals.weight[vitals.weight.length - 1].toFixed(1) : "—"}
                  sub="latest reading"
                />
                {vitals.weight?.length > 1 && (
                  <div style={{ marginTop: 8 }}>
                    <Sparkline data={vitals.weight} width={160} height={36} stroke="var(--a-success)" />
                  </div>
                )}
              </div>
            </div>
          </Card>

          {/* Consultations */}
          <Card title="Consultations" actions={<Pill leadIcon={ClipboardList}>{consults.length}</Pill>}>
            {consults.length === 0 && (
              <div style={{ padding: 14, textAlign: "center", color: "var(--a-fg-dim)", fontSize: 13 }}>
                No consultations recorded yet.
              </div>
            )}
            {consults.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {consults.map((c) => {
                  const tone =
                    c.triage === "emergency" ? "danger"
                    : c.triage === "facility" ? "warn"
                    : c.triage === "chw_visit" ? "info"
                    : "success";
                  return (
                    <div key={c.id} style={{
                      padding: 12, borderRadius: 10,
                      border: "1px solid var(--a-border-1)", background: "var(--a-bg-inset)",
                      display: "flex", gap: 10, alignItems: "flex-start",
                    }}>
                      <Badge tone={tone}>{c.triage?.replace("_", " ") || "log"}</Badge>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: "var(--a-fg)", fontWeight: 500 }}>
                          {c.summary}
                        </div>
                        <div style={{
                          display: "flex", gap: 8, marginTop: 4, fontSize: 11.5,
                          color: "var(--a-fg-dim)",
                        }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <Clock size={10} /> {fmtDate(c.date)}
                          </span>
                          {c.tools?.length > 0 && (
                            <span>· tools: {c.tools.join(", ")}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Care team */}
          <Card title="Care team" actions={<Pill leadIcon={Users}>{team.length}</Pill>}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {team.map((m, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: 10, borderRadius: 10,
                  border: "1px solid var(--a-border-1)", background: "var(--a-bg-inset)",
                }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: "50%",
                    background: "var(--a-bg-elev-2)",
                    display: "grid", placeItems: "center",
                    color: "var(--a-fg-mute)", fontSize: 13, fontWeight: 700,
                  }}>
                    {(m.name || "?").charAt(0)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--a-fg)" }}>{m.name}</div>
                    <div style={{ fontSize: 11, color: "var(--a-fg-dim)" }}>{m.role}</div>
                  </div>
                  {m.phone && <Pill leadIcon={Phone}>{m.phone}</Pill>}
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </Sheet>
  );
}
