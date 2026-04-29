/**
 * DualPathLedgerModal — multi-entry Dual-Path Care ledger with 10-cap
 * per type (traditional / modern / interaction / progress).
 *
 * Visual language mirrors SupplyLedgerModal: navy #0b1220 shell, dark
 * slate entry cards, indigo primary button, amber limit banner, pill
 * status chips. Tabs at the top switch between the four sections; each
 * tab shows its own list + add form.
 *
 * Role gating (same rule as legacy /care/dualpath):
 *   - clinician / admin → full read + add + patch + delete.
 *   - everyone else     → read-only (edit / add controls hidden, with
 *                         an "ask a clinician" hint under the list).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DUALPATH_TYPES,
  listAllDualpath,
  addDualpath,
  patchDualpath,
  deleteDualpath,
} from "./dualpathLedgerApi.js";


// Care paths are VHW-owned (and admin impersonator). Clinician is removed —
// they read from the patient summary but don't log field visits.
// Default writers for any dual-path tab (modern, interaction, progress).
// Clinicians + VHWs were unified on 2026-04-30 ("both can update").
const WRITE_ROLES = new Set(["clinician", "vhw", "admin"]);

// Per-tab override — imams may update the *traditional* care path only
// (faith-based / herbal recommendations, dua, community elder advice).
// Backend mirror: CAREPATH_TRADITIONAL_WRITE_ROLES in care_routes.py.
const TRADITIONAL_WRITE_ROLES = new Set([...WRITE_ROLES, "imam"]);

function _writeRolesFor(tab) {
  return tab === "traditional" ? TRADITIONAL_WRITE_ROLES : WRITE_ROLES;
}


function _readRole() {
  try { return localStorage.getItem("AMINA_ROLE") || "patient"; }
  catch { return "patient"; }
}

function _readSessionId() {
  try {
    return localStorage.getItem("AMINA_SID")
        || localStorage.getItem("AMINA_ACTIVE_SESSION_ID")
        || localStorage.getItem("AMINA_SESSION_ID")
        || "";
  } catch {
    return "";
  }
}


const TAB_META = {
  traditional: { label: "Traditional", icon: "🌿", accent: "#a3e635" },
  modern:      { label: "Modern",      icon: "🏥", accent: "#c084fc" },
  interaction: { label: "Interaction", icon: "🧪", accent: "#60a5fa" },
  progress:    { label: "Progress",    icon: "📈", accent: "#fbbf24" },
};


// ── small UI primitives (match SupplyLedgerModal palette) ────────────

const INPUT_STYLE = {
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
    <label style={{ gridColumn: `span ${span}`, display: "flex",
                    flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600,
                     textTransform: "uppercase", letterSpacing: 0.3 }}>
        {label}
      </span>
      {children}
    </label>
  );
}


function CapBar({ count, cap }) {
  const pct = Math.min(100, Math.round((count / cap) * 100));
  const full = count >= cap;
  const fill = full ? "#f87171" : (pct >= 80 ? "#fb923c" : "#38bdf8");
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between",
                    fontSize: 11, color: "#94a3b8", fontWeight: 600,
                    textTransform: "uppercase", letterSpacing: 0.3,
                    marginBottom: 6 }}>
        <span>Entries</span>
        <span style={{ color: full ? "#f87171" : "#e2e8f0" }}>{count} / {cap}</span>
      </div>
      <div style={{ height: 5, background: "rgba(148, 163, 184, 0.18)",
                    borderRadius: 999, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: fill,
                      transition: "width 250ms cubic-bezier(0.22,1,0.36,1)" }} />
      </div>
    </div>
  );
}


// ── per-type entry summary blocks (used inside EntryCard) ────────────

function _listBullets(arr) {
  if (!arr || !arr.length) return null;
  return (
    <div style={{ color: "#cbd5e1", fontSize: 12 }}>
      {arr.map((x, i) => (
        <span key={i}>
          {i > 0 ? ", " : ""}{x}
        </span>
      ))}
    </div>
  );
}

function TraditionalBody({ e }) {
  return (
    <>
      {e.practitioner && (
        <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>
          {e.practitioner}
        </div>
      )}
      {_listBullets(e.practices)}
      <div style={{ color: "#94a3b8", fontSize: 11 }}>
        Last visit {e.last_visit_days_ago ?? "—"} day{e.last_visit_days_ago === 1 ? "" : "s"} ago
      </div>
      {e.notes ? <div style={{ color: "#e2e8f0", fontSize: 12, marginTop: 2 }}>{e.notes}</div> : null}
    </>
  );
}

function ModernBody({ e }) {
  return (
    <>
      {e.facility && (
        <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>
          {e.facility}
        </div>
      )}
      {e.chw_name && (
        <div style={{ color: "#cbd5e1", fontSize: 12 }}>CHW · {e.chw_name}</div>
      )}
      {_listBullets(e.medications)}
      <div style={{ color: "#94a3b8", fontSize: 11 }}>
        Last visit {e.last_visit_days_ago ?? "—"} day{e.last_visit_days_ago === 1 ? "" : "s"} ago
      </div>
      {e.notes ? <div style={{ color: "#e2e8f0", fontSize: 12, marginTop: 2 }}>{e.notes}</div> : null}
    </>
  );
}

function InteractionBody({ e }) {
  const safe = e.safe !== false;
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999,
          background: safe ? "rgba(16,185,129,0.14)" : "rgba(248,113,113,0.14)",
          color:      safe ? "#6ee7b7"                : "#fca5a5",
          border: `1px solid ${safe ? "rgba(52,211,153,0.35)" : "rgba(248,113,113,0.40)"}`,
          textTransform: "uppercase", letterSpacing: 0.3,
        }}>
          {safe ? "Safe together" : "Check interactions"}
        </span>
      </div>
      {e.notes ? <div style={{ color: "#e2e8f0", fontSize: 12, marginTop: 4 }}>{e.notes}</div> : null}
    </>
  );
}

function ProgressBody({ e }) {
  return (
    <>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>
        BP {e.bp_current || "—"}
      </div>
      <div style={{ color: "#cbd5e1", fontSize: 12 }}>
        {e.months_on_plan ?? 0} month{e.months_on_plan === 1 ? "" : "s"} on plan
      </div>
      {e.notes ? <div style={{ color: "#e2e8f0", fontSize: 12, marginTop: 2 }}>{e.notes}</div> : null}
    </>
  );
}

const BODIES = {
  traditional: TraditionalBody,
  modern:      ModernBody,
  interaction: InteractionBody,
  progress:    ProgressBody,
};


function EntryCard({ type_, e, index, canEdit, onEdit, onDelete, busyIndex }) {
  const Body = BODIES[type_];
  const busy = busyIndex === index;
  return (
    <div style={{
      background:   "rgba(30, 41, 59, 0.55)",
      border:       "1px solid rgba(148, 163, 184, 0.18)",
      borderRadius: 12,
      padding:      "12px 14px",
      display:      "flex", flexDirection: "column", gap: 6,
      opacity:      busy ? 0.55 : 1,
      transition:   "opacity 160ms ease",
    }}>
      <Body e={e} />
      {e.logged_at && (
        <div style={{ color: "#64748b", fontSize: 10, marginTop: 2 }}>
          Logged {new Date(e.logged_at).toLocaleString([], {
            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
          })}
          {e.edited_at ? " · edited" : ""}
        </div>
      )}

      {canEdit && (
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <button type="button" onClick={() => !busy && onEdit(index)} disabled={busy}
                  style={{
                    flex: 1, padding: "7px 10px",
                    background: "rgba(96, 165, 250, 0.14)", color: "#bfdbfe",
                    border: "1px solid rgba(96, 165, 250, 0.35)", borderRadius: 8,
                    fontSize: 11, fontWeight: 700,
                    cursor: busy ? "not-allowed" : "pointer",
                    display: "inline-flex", justifyContent: "center",
                    alignItems: "center", gap: 6,
                  }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            Edit
          </button>
          <button type="button" onClick={() => !busy && onDelete(index)} disabled={busy}
                  style={{
                    flex: 1, padding: "7px 10px",
                    background: "rgba(248, 113, 113, 0.14)", color: "#fecaca",
                    border: "1px solid rgba(248, 113, 113, 0.40)", borderRadius: 8,
                    fontSize: 11, fontWeight: 700,
                    cursor: busy ? "not-allowed" : "pointer",
                    display: "inline-flex", justifyContent: "center",
                    alignItems: "center", gap: 6,
                  }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}


// ── Per-type forms ───────────────────────────────────────────────────

function TraditionalForm({ initial, onCancel, onSubmit, submitLabel, busy }) {
  const [practitioner, setP]    = useState(initial?.practitioner ?? "");
  const [practices,    setPR]   = useState(Array.isArray(initial?.practices) ? initial.practices.join(", ") : (initial?.practices ?? ""));
  const [days,         setD]    = useState(String(initial?.last_visit_days_ago ?? ""));
  const [notes,        setN]    = useState(initial?.notes ?? "");
  const disabled = busy || !practitioner.trim();
  return (
    <FormShell busy={busy} disabled={disabled} onCancel={onCancel}
               onSubmit={() => onSubmit({
                 practitioner: practitioner.trim(),
                 practices:    practices,
                 last_visit_days_ago: parseInt(days, 10) || 0,
                 notes:        notes.trim(),
               })}
               submitLabel={submitLabel}>
      <Field label="Practitioner *" span={2}>
        <input style={INPUT_STYLE} value={practitioner}
               onChange={(e) => setP(e.target.value)} autoFocus
               placeholder="Local marabout" />
      </Field>
      <Field label="Practices (comma separated)" span={2}>
        <input style={INPUT_STYLE} value={practices}
               onChange={(e) => setPR(e.target.value)}
               placeholder="Prayers, bitter leaf tea" />
      </Field>
      <Field label="Last visit (days ago)">
        <input style={INPUT_STYLE} type="number" min="0" value={days}
               onChange={(e) => setD(e.target.value)} placeholder="9" />
      </Field>
      <Field label="Notes" span={2}>
        <textarea style={{ ...INPUT_STYLE, minHeight: 60, resize: "vertical" }}
                  value={notes} onChange={(e) => setN(e.target.value)} />
      </Field>
    </FormShell>
  );
}


function ModernForm({ initial, onCancel, onSubmit, submitLabel, busy }) {
  const [fac,   setF]  = useState(initial?.facility ?? "");
  const [chw,   setC]  = useState(initial?.chw_name ?? "");
  const [meds,  setM]  = useState(Array.isArray(initial?.medications) ? initial.medications.join(", ") : (initial?.medications ?? ""));
  const [days,  setD]  = useState(String(initial?.last_visit_days_ago ?? ""));
  const [notes, setN]  = useState(initial?.notes ?? "");
  const disabled = busy || !fac.trim();
  return (
    <FormShell busy={busy} disabled={disabled} onCancel={onCancel}
               onSubmit={() => onSubmit({
                 facility:    fac.trim(),
                 chw_name:    chw.trim(),
                 medications: meds,
                 last_visit_days_ago: parseInt(days, 10) || 0,
                 notes:       notes.trim(),
               })}
               submitLabel={submitLabel}>
      <Field label="Facility *" span={2}>
        <input style={INPUT_STYLE} value={fac} onChange={(e) => setF(e.target.value)}
               autoFocus placeholder="Kerewan Health Centre" />
      </Field>
      <Field label="CHW name" span={2}>
        <input style={INPUT_STYLE} value={chw} onChange={(e) => setC(e.target.value)}
               placeholder="VHW Mariama" />
      </Field>
      <Field label="Medications (comma separated)" span={2}>
        <input style={INPUT_STYLE} value={meds} onChange={(e) => setM(e.target.value)}
               placeholder="Amlodipine 5mg daily" />
      </Field>
      <Field label="Last visit (days ago)">
        <input style={INPUT_STYLE} type="number" min="0" value={days}
               onChange={(e) => setD(e.target.value)} placeholder="14" />
      </Field>
      <Field label="Notes" span={2}>
        <textarea style={{ ...INPUT_STYLE, minHeight: 60, resize: "vertical" }}
                  value={notes} onChange={(e) => setN(e.target.value)} />
      </Field>
    </FormShell>
  );
}


function InteractionForm({ initial, onCancel, onSubmit, submitLabel, busy }) {
  const [safe,  setS]  = useState(initial?.safe !== false);
  const [notes, setN]  = useState(initial?.notes ?? "");
  return (
    <FormShell busy={busy} disabled={busy} onCancel={onCancel}
               onSubmit={() => onSubmit({ safe, notes: notes.trim() })}
               submitLabel={submitLabel}>
      <Field label="Safe together?" span={2}>
        <select style={INPUT_STYLE} value={safe ? "safe" : "check"}
                onChange={(e) => setS(e.target.value === "safe")}>
          <option value="safe">Safe — no known interaction</option>
          <option value="check">Check — possible interaction</option>
        </select>
      </Field>
      <Field label="Interaction notes" span={2}>
        <textarea style={{ ...INPUT_STYLE, minHeight: 70, resize: "vertical" }}
                  value={notes} onChange={(e) => setN(e.target.value)}
                  placeholder="Bitter leaf tea has no known interaction with amlodipine." />
      </Field>
    </FormShell>
  );
}


function ProgressForm({ initial, onCancel, onSubmit, submitLabel, busy }) {
  const [bp,   setBp] = useState(initial?.bp_current ?? "");
  const [mos,  setMo] = useState(String(initial?.months_on_plan ?? ""));
  const [notes, setN] = useState(initial?.notes ?? "");
  const disabled = busy || !bp.trim();
  return (
    <FormShell busy={busy} disabled={disabled} onCancel={onCancel}
               onSubmit={() => onSubmit({
                 bp_current:     bp.trim(),
                 months_on_plan: parseInt(mos, 10) || 0,
                 notes:          notes.trim(),
               })}
               submitLabel={submitLabel}>
      <Field label="Current BP *">
        <input style={INPUT_STYLE} value={bp} onChange={(e) => setBp(e.target.value)}
               autoFocus placeholder="135/85" />
      </Field>
      <Field label="Months on plan">
        <input style={INPUT_STYLE} type="number" min="0" value={mos}
               onChange={(e) => setMo(e.target.value)} placeholder="3" />
      </Field>
      <Field label="Notes" span={2}>
        <textarea style={{ ...INPUT_STYLE, minHeight: 60, resize: "vertical" }}
                  value={notes} onChange={(e) => setN(e.target.value)} />
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


const FORMS = {
  traditional: TraditionalForm,
  modern:      ModernForm,
  interaction: InteractionForm,
  progress:    ProgressForm,
};


// ── Main component ──────────────────────────────────────────────────

export default function DualPathLedgerModal({ onClose }) {
  const [role, setRole] = useState(_readRole);
  const [sid,  setSid]  = useState(_readSessionId);
  const [tab,  setTab]  = useState("traditional");
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading");  // loading|ok|no-sid|error
  const [error, setError]   = useState(null);
  const [showAdd, setShowAdd]       = useState(false);
  const [editIndex, setEditIndex]   = useState(null);
  const [busyIndex, setBusyIndex]   = useState(null);
  const [mutating, setMutating]     = useState(false);

  // Tab-aware: imam gets write access on the traditional tab only.
  const canWrite = useMemo(() => _writeRolesFor(tab).has(role), [role, tab]);

  useEffect(() => {
    const tick = () => { setRole(_readRole()); setSid(_readSessionId()); };
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
    if (!sid) { setStatus("no-sid"); setData(null); return; }
    setStatus((s) => (data ? "ok" : "loading"));
    try {
      const d = await listAllDualpath(sid);
      setData(d); setStatus("ok"); setError(null);
    } catch (e) {
      setStatus("error"); setError(e.message || String(e));
    }
  }, [sid]); // eslint-disable-line

  useEffect(() => { reload(); }, [reload]);

  // Close on Escape
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onCloseRef.current?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const notifyPanel = () => {
    try { window.dispatchEvent(new CustomEvent("amina:dualpath-updated")); }
    catch { /* noop */ }
  };

  const handleAdd = async (payload) => {
    setMutating(true);
    try {
      await addDualpath(sid, tab, payload, role === "admin" ? "vhw" : role);
      await reload();
      setShowAdd(false);
      notifyPanel();
    } catch (e) {
      if (e.code === "LIMIT_REACHED") await reload();
      else setError(e.message || String(e));
    } finally { setMutating(false); }
  };

  const handlePatch = async (index, payload) => {
    setMutating(true); setBusyIndex(index);
    try {
      await patchDualpath(sid, tab, index, payload, role === "admin" ? "vhw" : role);
      await reload();
      setEditIndex(null);
      notifyPanel();
    } catch (e) { setError(e.message || String(e)); }
    finally { setMutating(false); setBusyIndex(null); }
  };

  const handleDelete = async (index) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete this ${TAB_META[tab].label.toLowerCase()} entry? This cannot be undone.`)) return;
    setBusyIndex(index);
    try {
      await deleteDualpath(sid, tab, index, role === "admin" ? "vhw" : role);
      await reload();
      if (editIndex === index) setEditIndex(null);
      notifyPanel();
    } catch (e) { setError(e.message || String(e)); }
    finally { setBusyIndex(null); }
  };

  const env = data ? data[tab] : null;
  const entries = env ? env.entries : [];
  const atCap = !!env?.limit_reached;

  // Reset ephemeral state when switching tab
  useEffect(() => {
    setShowAdd(false); setEditIndex(null); setBusyIndex(null); setError(null);
  }, [tab]);

  const Form = FORMS[tab];

  return (
    <div role="dialog" aria-modal="true" aria-label="Dual-path care ledger"
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
            <div style={{ fontSize: 16, fontWeight: 700 }}>Update Dual-Path Care</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
              Keep a running log across traditional, modern, interaction, and
              progress — each ledger holds up to 10 entries.
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
          {DUALPATH_TYPES.map((t) => {
            const meta = TAB_META[t];
            const active = t === tab;
            const count = data ? data[t].count : 0;
            return (
              <button key={t} type="button" onClick={() => setTab(t)}
                      style={{
                        flex: 1, padding: "10px 6px",
                        background: "transparent", border: "none",
                        color: active ? "#fff" : "#94a3b8",
                        cursor: "pointer",
                        borderBottom: active ? `2px solid ${meta.accent}` : "2px solid transparent",
                        fontSize: 12, fontWeight: 700,
                        display: "inline-flex", flexDirection: "column",
                        alignItems: "center", gap: 2, transition: "color 140ms ease",
                      }}>
                <span style={{ fontSize: 16 }}>{meta.icon}</span>
                <span>{meta.label}</span>
                <span style={{
                  fontSize: 10, color: active ? meta.accent : "#64748b",
                  fontWeight: 700,
                }}>
                  {count} entr{count === 1 ? "y" : "ies"}
                </span>
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div style={{ padding: "14px 18px", overflow: "auto", flex: 1 }}>
          {status === "no-sid" && (
            <div style={{ padding: 24, textAlign: "center", color: "#cbd5e1",
                          background: "rgba(30, 41, 59, 0.55)",
                          border: "1px dashed rgba(148, 163, 184, 0.30)",
                          borderRadius: 12 }}>
              Open a patient session from the sidebar first, then reopen the form.
            </div>
          )}
          {status === "loading" && (
            <div style={{ padding: 24, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
              Loading entries…
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

          {env && (
            <>
              <CapBar count={env.count} cap={env.cap} />

              {entries.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: "#94a3b8",
                              background: "rgba(30, 41, 59, 0.55)",
                              border: "1px dashed rgba(148, 163, 184, 0.30)",
                              borderRadius: 12, fontSize: 13 }}>
                  No {TAB_META[tab].label.toLowerCase()} entries yet.
                  {canWrite ? " Add the first one below." : ""}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {entries.map((e, i) => (
                    <div key={i}>
                      {editIndex === i ? (
                        <Form initial={e} submitLabel="Save changes" busy={mutating}
                              onCancel={() => setEditIndex(null)}
                              onSubmit={(p) => handlePatch(i, p)} />
                      ) : (
                        <EntryCard type_={tab} e={e} index={i} canEdit={canWrite}
                                   onEdit={setEditIndex} onDelete={handleDelete}
                                   busyIndex={busyIndex} />
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div style={{ marginTop: 14 }}>
                {atCap ? (
                  <div style={{
                    padding: "14px 16px", borderRadius: 12,
                    background: "rgba(251, 146, 60, 0.12)",
                    border: "1px solid rgba(251, 146, 60, 0.35)",
                    color: "#fed7aa", display: "flex", gap: 10, alignItems: "flex-start",
                  }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"
                         strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                      <line x1="12" y1="9" x2="12" y2="13"/>
                      <line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>
                        Limit reached ({env.count} / {env.cap})
                      </div>
                      <div style={{ fontSize: 12, marginTop: 3 }}>
                        Delete an existing entry before adding another.
                      </div>
                    </div>
                  </div>
                ) : canWrite ? (
                  showAdd ? (
                    <Form submitLabel={`Add ${TAB_META[tab].label.toLowerCase()} entry`}
                          busy={mutating}
                          onCancel={() => setShowAdd(false)}
                          onSubmit={handleAdd} />
                  ) : (
                    <button type="button" onClick={() => setShowAdd(true)}
                            style={{
                              width: "100%", padding: "12px 14px",
                              background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
                              color: "#fff", border: "none", borderRadius: 10,
                              fontSize: 13, fontWeight: 700, cursor: "pointer",
                              boxShadow: "0 4px 14px rgba(99, 102, 241, 0.40)",
                              display: "inline-flex", justifyContent: "center",
                              alignItems: "center", gap: 8,
                            }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                           stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                           strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"/>
                        <line x1="5" y1="12" x2="19" y2="12"/>
                      </svg>
                      Add {TAB_META[tab].label.toLowerCase()} entry ({env.cap_remaining} left)
                    </button>
                  )
                ) : (
                  <div style={{
                    padding: "10px 12px", borderRadius: 10,
                    background: "rgba(30, 41, 59, 0.60)", color: "#94a3b8",
                    border: "1px solid rgba(148, 163, 184, 0.20)",
                    fontSize: 12, textAlign: "center",
                  }}>
                    Care-path edits are locked to clinicians.
                  </div>
                )}
              </div>
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
