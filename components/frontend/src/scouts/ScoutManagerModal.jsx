/**
 * ScoutManagerModal — Alkalo-facing scout administration console.
 * ======================================================================
 *
 * Surfaces every scout endpoint that was already built into the backend
 * but unreachable from the UI for Alkalo (until the 2026-04-19 role
 * split moved scout ownership from VHW/clinician → Alkalo):
 *
 *   Tab 1 · Scouts
 *     • List of all scout profiles (name, age, village, badge, elder
 *       count, weekly mission progress).
 *     • Create a new scout (name, age, village).
 *     • Per-row Remove + "Assign elder" + "Log BP check" actions.
 *
 *   Tab 2 · Applications
 *     • Pending youth applications (submitted via /scout/apply).
 *     • Approve → creates the scout record, drops the application.
 *     • Reject  → records the reason, drops the application.
 *
 * Visual language matches SupplyLedgerModal / DualPathLedgerModal:
 * navy #0b1220 shell, slate cards, indigo primary buttons. The only
 * role allowed to open this modal is "alkalo" (and admin via
 * impersonation) — the write-gate on every endpoint enforces that
 * again backend-side.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listScouts,
  createScout,
  removeScout,
  assignElder,
  logCheck,
  listApplications,
  approveApplication,
  rejectApplication,
} from "./scoutApi.js";


const WRITE_ROLES = new Set(["alkalo", "admin"]);


function _readRole() {
  try { return localStorage.getItem("AMINA_ROLE") || "patient"; }
  catch { return "patient"; }
}


// ── shared styles (match Supply / DualPath modals) ───────────────────

const INPUT = {
  padding: "9px 11px",
  border: "1px solid rgba(148, 163, 184, 0.30)",
  borderRadius: 8,
  fontSize: 13,
  background: "rgba(15, 23, 42, 0.85)",
  color: "#f1f5f9",
  fontFamily: "inherit",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};


function Field({ label, children, span = 1 }) {
  return (
    <label style={{ gridColumn: `span ${span}`,
                    display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600,
                     textTransform: "uppercase", letterSpacing: 0.3 }}>
        {label}
      </span>
      {children}
    </label>
  );
}


function BadgePill({ badge }) {
  const c = badge?.current;
  if (!c) return null;
  const colors = {
    bronze: { bg: "rgba(202, 138, 4, 0.18)",  fg: "#fcd34d" },
    silver: { bg: "rgba(148, 163, 184, 0.20)", fg: "#e2e8f0" },
    gold:   { bg: "rgba(234, 179, 8, 0.22)",  fg: "#fde68a" },
    green:  { bg: "rgba(16, 185, 129, 0.18)", fg: "#6ee7b7" },
  };
  const pal = colors[c.color] || colors.bronze;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: "3px 10px", borderRadius: 999,
      background: pal.bg, color: pal.fg,
      border: `1px solid ${pal.fg}33`,
      fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
      textTransform: "uppercase",
    }}>{c.name}</span>
  );
}


function ElderChip({ elder }) {
  const flagColor =
    elder.flag === "red"    ? "#fca5a5"
  : elder.flag === "yellow" ? "#fcd34d"
                            : "#6ee7b7";
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      background: "rgba(15, 23, 42, 0.85)",
      border: "1px solid rgba(148, 163, 184, 0.20)",
      borderRadius: 8, padding: "4px 8px",
      fontSize: 11, color: "#e2e8f0",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: flagColor }} />
      <span style={{ fontWeight: 600 }}>{elder.name}</span>
      {elder.last_bp ? (
        <span style={{ color: "#94a3b8" }}>· {elder.last_bp}</span>
      ) : null}
    </div>
  );
}


function ScoutCard({ scout, canEdit, onRemove, onAssign, onLog, busyId }) {
  const busy = busyId === scout.scout_id;
  const elders = scout.elders_monitored || [];
  const mission = scout.this_week_mission;
  return (
    <div style={{
      background:   "rgba(30, 41, 59, 0.55)",
      border:       "1px solid rgba(148, 163, 184, 0.18)",
      borderRadius: 12, padding: "14px 16px",
      display: "flex", flexDirection: "column", gap: 10,
      opacity:    busy ? 0.55 : 1,
      transition: "opacity 160ms ease",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9" }}>
            {scout.name}, {scout.age ?? "—"}
          </div>
          <div style={{ fontSize: 12, color: "#cbd5e1", marginTop: 2 }}>
            {scout.village || "—"} · {scout.total_checks || 0} check-ins · {elders.length} elder{elders.length === 1 ? "" : "s"}
          </div>
          {/* Locality + availability help the Alkalo pick the right
              scout for a new elder. Only appear when the scout went
              through the new application flow. */}
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4,
                        display: "flex", flexWrap: "wrap", gap: 10 }}>
            {scout.locality ? <span>📍 {scout.locality}</span> : null}
            {scout.availability ? <span>🕑 {scout.availability}</span> : null}
          </div>
          <div style={{ display: "none" }}>{/* spacer preserved */}
          </div>
        </div>
        <BadgePill badge={scout.badge} />
      </div>

      {mission && (
        <div style={{ color: "#94a3b8", fontSize: 11,
                      background: "rgba(15, 23, 42, 0.55)",
                      padding: "6px 10px", borderRadius: 8,
                      border: "1px solid rgba(148, 163, 184, 0.18)" }}>
          🎯 <b style={{ color: "#e2e8f0" }}>{mission.title}</b>
          <span style={{ marginLeft: 6 }}>
            {mission.progress}/{mission.target}
          </span>
        </div>
      )}

      {elders.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {elders.slice(0, 4).map((e, i) => <ElderChip key={i} elder={e} />)}
          {elders.length > 4 ? (
            <span style={{ color: "#94a3b8", fontSize: 11, padding: "4px 6px" }}>
              +{elders.length - 4} more
            </span>
          ) : null}
        </div>
      )}

      {canEdit && (
        <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
          <button type="button" onClick={() => !busy && onAssign(scout)}
                  disabled={busy}
                  style={_ACTION_BTN("#bfdbfe", "rgba(96, 165, 250, 0.14)", "rgba(96, 165, 250, 0.35)")}>
            + Assign elder
          </button>
          <button type="button" onClick={() => !busy && onLog(scout)}
                  disabled={busy}
                  style={_ACTION_BTN("#fde68a", "rgba(234, 179, 8, 0.14)", "rgba(234, 179, 8, 0.35)")}>
            + Log BP check
          </button>
          <button type="button" onClick={() => !busy && onRemove(scout)}
                  disabled={busy}
                  style={_ACTION_BTN("#fecaca", "rgba(248, 113, 113, 0.14)", "rgba(248, 113, 113, 0.40)")}>
            Remove
          </button>
        </div>
      )}
    </div>
  );
}


function LabeledStat({ icon, label, value }) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 6,
      padding: "6px 8px", borderRadius: 8,
      background: "rgba(15, 23, 42, 0.60)",
      border: "1px solid rgba(148, 163, 184, 0.18)",
    }}>
      <span style={{ fontSize: 13 }}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700,
                      textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</div>
        <div style={{ fontSize: 12, color: "#e2e8f0", lineHeight: 1.4,
                      wordBreak: "break-word" }}>{value}</div>
      </div>
    </div>
  );
}


function _ACTION_BTN(fg, bg, border) {
  return {
    flex: "1 1 30%", padding: "7px 10px",
    background: bg, color: fg,
    border: `1px solid ${border}`, borderRadius: 8,
    fontSize: 11, fontWeight: 700, cursor: "pointer",
    display: "inline-flex", justifyContent: "center", alignItems: "center",
  };
}


// ── sub-forms: inline below the scout list ──────────────────────────

function CreateScoutForm({ onCancel, onSubmit, busy }) {
  const [name,   setName]   = useState("");
  const [age,    setAge]    = useState("");
  const [village, setV]     = useState("");
  const disabled = busy || !name.trim() || !age.trim();
  return (
    <FormShell busy={busy} disabled={disabled} onCancel={onCancel}
               submitLabel="Register scout"
               onSubmit={() => onSubmit({
                 name: name.trim(),
                 age: parseInt(age, 10) || 0,
                 village: village.trim() || "Kerewan",
               })}>
      <Field label="Scout name *" span={2}>
        <input style={INPUT} value={name} autoFocus
               onChange={(e) => setName(e.target.value)}
               placeholder="Lamin Jallow" />
      </Field>
      <Field label="Age (must be under 25) *">
        <input style={INPUT} type="number" min="10" max="24" value={age}
               onChange={(e) => setAge(e.target.value)}
               placeholder="17" />
      </Field>
      <Field label="Village">
        <input style={INPUT} value={village}
               onChange={(e) => setV(e.target.value)}
               placeholder="Kerewan" />
      </Field>
    </FormShell>
  );
}


function AssignElderForm({ scout, onCancel, onSubmit, busy }) {
  const [name, setName]       = useState("");
  const [rel,  setRel]        = useState("grandmother");
  const [age,  setAge]        = useState("");
  const disabled = busy || !name.trim();
  return (
    <FormShell busy={busy} disabled={disabled} onCancel={onCancel}
               submitLabel={`Assign to ${scout.name}`}
               onSubmit={() => onSubmit({
                 scout_id:    scout.scout_id,
                 elder_name:  name.trim(),
                 relation:    rel,
                 age:         parseInt(age, 10) || 0,
               })}>
      <Field label="Elder name *" span={2}>
        <input style={INPUT} value={name} autoFocus
               onChange={(e) => setName(e.target.value)}
               placeholder="Grandmother Aminata" />
      </Field>
      <Field label="Relation">
        <select style={INPUT} value={rel} onChange={(e) => setRel(e.target.value)}>
          <option>grandmother</option><option>grandfather</option>
          <option>mother</option><option>father</option>
          <option>aunt</option><option>uncle</option>
          <option>neighbour</option><option>other</option>
        </select>
      </Field>
      <Field label="Age">
        <input style={INPUT} type="number" min="40" value={age}
               onChange={(e) => setAge(e.target.value)}
               placeholder="72" />
      </Field>
    </FormShell>
  );
}


function LogCheckForm({ scout, onCancel, onSubmit, busy }) {
  const elders = scout.elders_monitored || [];
  const [elderName, setElder] = useState(elders[0]?.name || "");
  const [bp,        setBp]    = useState("");
  const [flag,      setFlag]  = useState("green");
  const disabled = busy || !elderName.trim() || !bp.trim();
  return (
    <FormShell busy={busy} disabled={disabled} onCancel={onCancel}
               submitLabel={`Log BP check for ${scout.name}`}
               onSubmit={() => onSubmit({
                 scout_id:    scout.scout_id,
                 elder_name:  elderName.trim(),
                 bp:          bp.trim(),
                 flag,
               })}>
      <Field label="Elder *" span={2}>
        {elders.length > 0 ? (
          <select style={INPUT} value={elderName} onChange={(e) => setElder(e.target.value)}>
            {elders.map((e, i) => <option key={i} value={e.name}>{e.name}</option>)}
          </select>
        ) : (
          <input style={INPUT} value={elderName} autoFocus
                 onChange={(e) => setElder(e.target.value)}
                 placeholder="(no elders assigned yet)" />
        )}
      </Field>
      <Field label="BP reading *">
        <input style={INPUT} value={bp} onChange={(e) => setBp(e.target.value)}
               placeholder="135/85" />
      </Field>
      <Field label="Flag">
        <select style={INPUT} value={flag} onChange={(e) => setFlag(e.target.value)}>
          <option value="green">green — healthy</option>
          <option value="yellow">yellow — watch</option>
          <option value="red">red — urgent</option>
        </select>
      </Field>
    </FormShell>
  );
}


function FormShell({ children, onCancel, onSubmit, submitLabel, busy, disabled }) {
  return (
    <div style={{
      background: "rgba(15, 23, 42, 0.70)",
      border: "1px solid rgba(148, 163, 184, 0.22)",
      borderRadius: 12, padding: "14px 16px", marginTop: 4,
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
        {children}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button type="button" onClick={onCancel} disabled={busy}
                style={{
                  flex: 1, padding: "10px 14px",
                  background: "rgba(30, 41, 59, 0.85)", color: "#e2e8f0",
                  border: "1px solid rgba(148, 163, 184, 0.30)", borderRadius: 8,
                  fontSize: 13, fontWeight: 600,
                  cursor: busy ? "not-allowed" : "pointer",
                }}>Cancel</button>
        <button type="button" onClick={onSubmit} disabled={disabled}
                style={{
                  flex: 1, padding: "10px 14px",
                  background: disabled ? "rgba(71, 85, 105, 0.70)"
                            : "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
                  color: "#fff", border: "none", borderRadius: 8,
                  fontSize: 13, fontWeight: 700,
                  cursor: disabled ? "not-allowed" : "pointer",
                  boxShadow: disabled ? "none" : "0 4px 14px rgba(99, 102, 241, 0.40)",
                }}>{busy ? "Saving…" : submitLabel}</button>
      </div>
    </div>
  );
}


// ── Applications tab ────────────────────────────────────────────────

function ApplicationRow({ app, canEdit, onApprove, onReject, busy }) {
  return (
    <div style={{
      background:   "rgba(30, 41, 59, 0.55)",
      border:       "1px solid rgba(148, 163, 184, 0.18)",
      borderRadius: 12, padding: "12px 14px",
      display: "flex", flexDirection: "column", gap: 6,
      opacity: busy ? 0.55 : 1,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>
            {app.name}, {app.age}
          </div>
          <div style={{ fontSize: 11, color: "#cbd5e1" }}>
            {app.village}{app.phone ? ` · ${app.phone}` : ""}
          </div>
        </div>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 999,
          background: "rgba(234, 179, 8, 0.20)", color: "#fde68a",
          textTransform: "uppercase", letterSpacing: 0.3,
          alignSelf: "flex-start",
        }}>pending</span>
      </div>

      {/* Locality + availability surfaced from the redesigned form —
          lets the Alkalo match the applicant with the right elders. */}
      {(app.locality || app.availability) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8,
                      marginTop: 4 }}>
          {app.locality && (
            <LabeledStat icon="📍" label="Lives at" value={app.locality} />
          )}
          {app.availability && (
            <LabeledStat icon="🕑" label="Free" value={app.availability} />
          )}
        </div>
      )}

      {app.reason && (
        <div style={{
          padding: "8px 10px", borderRadius: 8,
          background: "rgba(15, 23, 42, 0.70)",
          border: "1px solid rgba(148, 163, 184, 0.18)",
          color: "#e2e8f0", fontSize: 12, lineHeight: 1.5,
          fontStyle: "italic", marginTop: 2,
        }}>“{app.reason}”</div>
      )}

      {app.applied_at && (
        <div style={{ color: "#64748b", fontSize: 10 }}>
          Applied {new Date(app.applied_at).toLocaleString([], {
            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
          })}
          {app.applicant_id ? ` · from ${app.applicant_id}` : ""}
        </div>
      )}
      {canEdit && (
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button type="button" onClick={() => onApprove(app)} disabled={busy}
                  style={_ACTION_BTN("#6ee7b7", "rgba(16, 185, 129, 0.14)", "rgba(52, 211, 153, 0.35)")}>
            ✓ Approve
          </button>
          <button type="button" onClick={() => onReject(app)} disabled={busy}
                  style={_ACTION_BTN("#fecaca", "rgba(248, 113, 113, 0.14)", "rgba(248, 113, 113, 0.40)")}>
            ✕ Reject
          </button>
        </div>
      )}
    </div>
  );
}


// ── Main modal ──────────────────────────────────────────────────────

export default function ScoutManagerModal({ onClose }) {
  const [role,     setRole]    = useState(_readRole);
  const [tab,      setTab]     = useState("scouts");   // "scouts" | "applications"
  const [scouts,   setScouts]  = useState([]);
  const [apps,     setApps]    = useState([]);
  const [status,   setStatus]  = useState("loading");  // loading|ok|error
  const [error,    setError]   = useState(null);

  const [showCreate, setShowCreate] = useState(false);
  const [assigning,  setAssigning]  = useState(null);  // scout obj
  const [logging,    setLogging]    = useState(null);  // scout obj
  const [busyId,     setBusyId]     = useState(null);
  const [mutating,   setMutating]   = useState(false);

  const canEdit = useMemo(() => WRITE_ROLES.has(role), [role]);

  useEffect(() => {
    const tick = () => setRole(_readRole());
    const t = setInterval(tick, 1500);
    window.addEventListener("amina:role-changed", tick);
    window.addEventListener("storage", tick);
    return () => {
      clearInterval(t);
      window.removeEventListener("amina:role-changed", tick);
      window.removeEventListener("storage", tick);
    };
  }, []);

  const reload = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const [sc, ap] = await Promise.all([
        listScouts().catch(() => ({ scouts: [] })),
        canEdit ? listApplications(role).catch(() => ({ applications: [] }))
                : Promise.resolve({ applications: [] }),
      ]);
      setScouts(sc?.scouts || []);
      setApps(ap?.applications || []);
      setStatus("ok");
    } catch (e) {
      setStatus("error");
      setError(e.message || String(e));
    }
  }, [canEdit, role]);

  useEffect(() => { reload(); }, [reload]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onCloseRef.current?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const notifyChanged = () => {
    try { window.dispatchEvent(new CustomEvent("amina:scouts-updated")); }
    catch { /* noop */ }
  };

  const _asRole = () => role === "admin" ? "alkalo" : role;

  const handleCreate = async (payload) => {
    setMutating(true);
    try {
      await createScout(payload, _asRole());
      setShowCreate(false);
      await reload();
      notifyChanged();
    } catch (e) {
      if (e.status === 409) setError(`A scout named "${payload.name}" already exists.`);
      else setError(e.message || String(e));
    } finally { setMutating(false); }
  };

  const handleRemove = async (scout) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Remove scout ${scout.name}? This cannot be undone.`)) return;
    setBusyId(scout.scout_id);
    try {
      await removeScout(scout.scout_id, _asRole());
      await reload();
      notifyChanged();
    } catch (e) { setError(e.message || String(e)); }
    finally   { setBusyId(null); }
  };

  const handleAssignSubmit = async (payload) => {
    setMutating(true);
    try {
      await assignElder(payload, _asRole());
      setAssigning(null);
      await reload();
      notifyChanged();
    } catch (e) { setError(e.message || String(e)); }
    finally    { setMutating(false); }
  };

  const handleLogSubmit = async (payload) => {
    setMutating(true);
    try {
      await logCheck(payload, _asRole());
      setLogging(null);
      await reload();
      notifyChanged();
    } catch (e) { setError(e.message || String(e)); }
    finally    { setMutating(false); }
  };

  const handleApprove = async (app) => {
    setBusyId(app.app_id || app.id);
    try {
      await approveApplication(app.app_id || app.id, _asRole());
      await reload();
      notifyChanged();
    } catch (e) { setError(e.message || String(e)); }
    finally    { setBusyId(null); }
  };

  const handleReject = async (app) => {
    // eslint-disable-next-line no-alert
    const reason = window.prompt(`Reject ${app.name}'s application? Reason (optional):`, "") || "";
    setBusyId(app.app_id || app.id);
    try {
      await rejectApplication(app.app_id || app.id, reason, _asRole());
      await reload();
      notifyChanged();
    } catch (e) { setError(e.message || String(e)); }
    finally    { setBusyId(null); }
  };

  const scoutCount = scouts.length;
  const pending    = apps.length;

  return (
    <div role="dialog" aria-modal="true" aria-label="Scout management"
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
         style={{
           position: "fixed", inset: 0, zIndex: 10000,
           background: "rgba(15, 23, 42, 0.55)",
           display: "flex", justifyContent: "center", alignItems: "flex-start",
           padding: "4vh 16px",
           fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
         }}>
      <div style={{
        width: "min(680px, 100%)", maxHeight: "92vh",
        background: "#0b1220", borderRadius: 16,
        boxShadow: "0 24px 60px rgba(0, 0, 0, 0.55)",
        overflow: "hidden", display: "flex", flexDirection: "column",
        border: "1px solid rgba(148, 163, 184, 0.15)",
      }}>
        {/* Header */}
        <div style={{
          padding: "16px 20px",
          borderBottom: "1px solid rgba(148, 163, 184, 0.15)",
          color: "#fff", display: "flex", alignItems: "flex-start", gap: 12,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Manage Youth Scouts</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
              Register scouts, assign elders to monitor, and review youth
              applications — Alkalo-owned under the new role split.
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
                  style={{ width: 30, height: 30, borderRadius: 8, border: "none",
                           background: "rgba(255,255,255,0.06)", color: "#e2e8f0",
                           cursor: "pointer", fontSize: 18, fontWeight: 700,
                           lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>

        {/* Tabs */}
        <div style={{
          display: "flex", gap: 0, padding: "10px 12px 0 12px",
          borderBottom: "1px solid rgba(148, 163, 184, 0.12)",
          background: "rgba(15, 23, 42, 0.35)",
        }}>
          {[
            { id: "scouts",       label: "Scouts",       count: scoutCount, icon: "🏅", accent: "#fbbf24" },
            { id: "applications", label: "Applications", count: pending,    icon: "📝", accent: "#60a5fa" },
          ].map((t) => {
            const active = t.id === tab;
            return (
              <button key={t.id} type="button" onClick={() => setTab(t.id)}
                      style={{
                        flex: 1, padding: "10px 6px",
                        background: "transparent", border: "none",
                        color: active ? "#fff" : "#94a3b8",
                        cursor: "pointer",
                        borderBottom: active ? `2px solid ${t.accent}` : "2px solid transparent",
                        fontSize: 12, fontWeight: 700,
                        display: "inline-flex", flexDirection: "column",
                        alignItems: "center", gap: 2,
                      }}>
                <span style={{ fontSize: 16 }}>{t.icon}</span>
                <span>{t.label}</span>
                <span style={{ fontSize: 10, color: active ? t.accent : "#64748b", fontWeight: 700 }}>
                  {t.count} {t.count === 1 ? "item" : "items"}
                </span>
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div style={{ padding: "14px 18px", overflow: "auto", flex: 1 }}>
          {status === "loading" && (
            <div style={{ padding: 24, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
              Loading…
            </div>
          )}
          {error && (
            <div style={{ padding: "10px 14px",
                          background: "rgba(248, 113, 113, 0.12)", color: "#fecaca",
                          border: "1px solid rgba(248, 113, 113, 0.35)",
                          borderRadius: 10, fontSize: 13, fontWeight: 600,
                          marginBottom: 10 }}>
              {error}
            </div>
          )}

          {tab === "scouts" && status === "ok" && (
            <>
              {scouts.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: "#94a3b8",
                              background: "rgba(30, 41, 59, 0.55)",
                              border: "1px dashed rgba(148, 163, 184, 0.30)",
                              borderRadius: 12, fontSize: 13 }}>
                  No scouts registered yet.
                  {canEdit ? " Register the first one below." : ""}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {scouts.map((s) => (
                    <div key={s.scout_id || s.name}>
                      <ScoutCard scout={s} canEdit={canEdit}
                                 onRemove={handleRemove}
                                 onAssign={setAssigning}
                                 onLog={setLogging}
                                 busyId={busyId} />
                      {assigning?.scout_id === s.scout_id && (
                        <AssignElderForm scout={s} busy={mutating}
                                         onCancel={() => setAssigning(null)}
                                         onSubmit={handleAssignSubmit} />
                      )}
                      {logging?.scout_id === s.scout_id && (
                        <LogCheckForm scout={s} busy={mutating}
                                      onCancel={() => setLogging(null)}
                                      onSubmit={handleLogSubmit} />
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div style={{ marginTop: 14 }}>
                {canEdit ? (
                  showCreate ? (
                    <CreateScoutForm busy={mutating}
                                     onCancel={() => setShowCreate(false)}
                                     onSubmit={handleCreate} />
                  ) : (
                    <button type="button" onClick={() => setShowCreate(true)}
                            style={{
                              width: "100%", padding: "12px 14px",
                              background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
                              color: "#fff", border: "none", borderRadius: 10,
                              fontSize: 13, fontWeight: 700, cursor: "pointer",
                              boxShadow: "0 4px 14px rgba(99, 102, 241, 0.40)",
                              display: "inline-flex", justifyContent: "center",
                              alignItems: "center", gap: 8,
                            }}>
                      + Register new scout
                    </button>
                  )
                ) : (
                  <div style={{
                    padding: "10px 12px", borderRadius: 10,
                    background: "rgba(30, 41, 59, 0.60)", color: "#94a3b8",
                    border: "1px solid rgba(148, 163, 184, 0.20)",
                    fontSize: 12, textAlign: "center",
                  }}>
                    Scout management is locked to the Alkalo role.
                  </div>
                )}
              </div>
            </>
          )}

          {tab === "applications" && status === "ok" && (
            <>
              {apps.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: "#94a3b8",
                              background: "rgba(30, 41, 59, 0.55)",
                              border: "1px dashed rgba(148, 163, 184, 0.30)",
                              borderRadius: 12, fontSize: 13 }}>
                  No pending applications.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {apps.map((a) => (
                    <ApplicationRow key={a.app_id || a.id}
                                    app={a} canEdit={canEdit}
                                    onApprove={handleApprove}
                                    onReject={handleReject}
                                    busy={busyId === (a.app_id || a.id)} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "10px 20px", borderTop: "1px solid rgba(148, 163, 184, 0.15)",
          background: "rgba(15, 23, 42, 0.65)",
          fontSize: 11, color: "#94a3b8",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span>acting as <b style={{ color: "#e2e8f0", textTransform: "capitalize" }}>{role}</b></span>
          <button type="button" onClick={onClose}
                  style={{
                    padding: "7px 14px",
                    background: "rgba(30, 41, 59, 0.85)", color: "#e2e8f0",
                    border: "1px solid rgba(148, 163, 184, 0.30)", borderRadius: 8,
                    fontSize: 12, fontWeight: 600, cursor: "pointer",
                  }}>Close</button>
        </div>
      </div>
    </div>
  );
}
