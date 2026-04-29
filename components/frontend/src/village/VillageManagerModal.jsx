/**
 * VillageManagerModal — professional Village scoreboard management
 * ======================================================================
 *
 * Replaces the legacy single-field edit modal (App.jsx:3437-3477) with
 * a polished dual-tab experience for Alkalo (+ admin impersonator) and
 * VHW (pillars only):
 *
 *   Tab 1 · Pillars
 *     • All 5 pillars listed as cards with emoji, progress bar, and a
 *       colour-graded zone tag (green ≥80%, amber 50-79%, red <50%).
 *     • Inline Edit form: score slider-like number input (0..max) + a
 *       multi-line detail field + Save — hits /village/pillar.
 *     • Live total-score recompute preview as the user drags a score.
 *
 *   Tab 2 · Alkalo Notes
 *     • Full list of historical alkalo_notes (capped at 10 on the
 *       backend) with timestamp + who added them.
 *     • Add-a-new-note form (multi-line) — hits /village/alkalo-note.
 *     • Gated to alkalo / admin (matches backend gate).
 *
 * Styling matches SupplyLedgerModal / DualPathLedgerModal / ScoutManagerModal:
 * navy #0b1220, slate cards, indigo primary CTA, amber warning banner.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVillage, updatePillar, addAlkaloNote } from "./villageApi.js";


const PILLAR_WRITE = new Set(["vhw", "alkalo", "admin"]);
const NOTE_WRITE   = new Set(["alkalo", "admin"]);


// Pillar visual identity — keeps the details view + edit view aligned.
// Fallback for any unexpected pillar id keeps the UI stable.
const PILLAR_META = {
  screening:  { icon: "🩺", accent: "#38bdf8" },
  adherence:  { icon: "💊", accent: "#a78bfa" },
  diet:       { icon: "🥗", accent: "#4ade80" },
  youth:      { icon: "🏅", accent: "#fbbf24" },
  emergency:  { icon: "🚑", accent: "#f87171" },
};
const FALLBACK_META = { icon: "⭐", accent: "#94a3b8" };


function _readRole() {
  try { return localStorage.getItem("AMINA_ROLE") || "patient"; }
  catch { return "patient"; }
}


// ── shared primitives ────────────────────────────────────────────────

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


function _zone(pct) {
  if (pct >= 80) return { color: "#6ee7b7", label: "Strong" };
  if (pct >= 50) return { color: "#fcd34d", label: "Watch" };
  return              { color: "#fca5a5", label: "At risk" };
}


// ── pillar card ─────────────────────────────────────────────────────

function PillarCard({ pillar, canEdit, editing, onStartEdit, onCancelEdit,
                      onSave, saving }) {
  const meta = PILLAR_META[pillar.id] || FALLBACK_META;
  const max  = pillar.max || 20;
  const pct  = Math.round(100 * (pillar.score ?? 0) / max);
  const zone = _zone(pct);

  if (editing) {
    return (
      <PillarEditForm pillar={pillar} meta={meta}
                      busy={saving}
                      onCancel={onCancelEdit}
                      onSave={onSave} />
    );
  }

  return (
    <div style={{
      background:   "rgba(30, 41, 59, 0.55)",
      border:       `1px solid ${meta.accent}33`,
      borderRadius: 12,
      padding:      "14px 16px",
      display:      "flex", flexDirection: "column", gap: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: `${meta.accent}24`,
          border: `1px solid ${meta.accent}55`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 16,
        }}>{meta.icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>
            {pillar.name}
          </div>
          <div style={{ fontSize: 11, color: zone.color,
                        fontWeight: 700, letterSpacing: 0.3,
                        textTransform: "uppercase" }}>
            {zone.label} · {pct}%
          </div>
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0" }}>
          {pillar.score ?? 0}<span style={{ color: "#94a3b8", fontSize: 11 }}> / {max}</span>
        </div>
      </div>

      <div style={{
        height: 6, background: "rgba(148, 163, 184, 0.18)",
        borderRadius: 999, overflow: "hidden",
      }}>
        <div style={{
          height: "100%", width: `${pct}%`,
          background: meta.accent,
          transition: "width 250ms cubic-bezier(0.22,1,0.36,1)",
        }} />
      </div>

      {pillar.detail ? (
        <div style={{ color: "#cbd5e1", fontSize: 12, lineHeight: 1.5 }}>
          {pillar.detail}
        </div>
      ) : null}

      {canEdit && (
        <div style={{ display: "flex", marginTop: 2 }}>
          <button type="button" onClick={() => onStartEdit(pillar.id)}
                  style={{
                    padding: "7px 12px",
                    background: "rgba(96, 165, 250, 0.14)", color: "#bfdbfe",
                    border: "1px solid rgba(96, 165, 250, 0.35)", borderRadius: 8,
                    fontSize: 12, fontWeight: 700, cursor: "pointer",
                    display: "inline-flex", alignItems: "center", gap: 6,
                  }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2.2"
                 strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            Update score
          </button>
        </div>
      )}
    </div>
  );
}


function PillarEditForm({ pillar, meta, busy, onCancel, onSave }) {
  const [score,  setScore]  = useState(String(pillar.score ?? 0));
  const [detail, setDetail] = useState(pillar.detail || "");
  const max = pillar.max || 20;
  const n   = Math.max(0, Math.min(max, parseInt(score, 10) || 0));
  const pct = Math.round(100 * n / max);
  const zone = _zone(pct);
  const disabled = busy;

  return (
    <div style={{
      background: "rgba(15, 23, 42, 0.70)",
      border: `1px solid ${meta.accent}66`,
      borderRadius: 12, padding: "14px 16px",
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: `${meta.accent}24`,
          border: `1px solid ${meta.accent}55`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 16,
        }}>{meta.icon}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>
            Update: {pillar.name}
          </div>
          <div style={{ fontSize: 11, color: zone.color,
                        fontWeight: 700, letterSpacing: 0.3,
                        textTransform: "uppercase" }}>
            Preview · {zone.label} · {pct}%
          </div>
        </div>
      </div>

      {/* Live preview bar */}
      <div style={{
        height: 6, background: "rgba(148, 163, 184, 0.18)",
        borderRadius: 999, overflow: "hidden",
      }}>
        <div style={{ height: "100%", width: `${pct}%`,
                      background: meta.accent,
                      transition: "width 160ms ease" }} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
        <Field label={`Score (0..${max})`}>
          <input style={INPUT} type="number" min="0" max={max} value={score}
                 autoFocus onChange={(e) => setScore(e.target.value)} />
        </Field>
        <Field label="Range">
          <input style={{ ...INPUT, background: "rgba(30,41,59,0.7)",
                          color: "#94a3b8" }}
                 readOnly value={`0–${max}`} />
        </Field>
        <Field label="Detail (what's driving this score?)" span={2}>
          <textarea style={{ ...INPUT, minHeight: 70, resize: "vertical" }}
                    value={detail}
                    onChange={(e) => setDetail(e.target.value)}
                    placeholder="e.g. 62% of adults 35+ screened this month." />
        </Field>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
        <button type="button" onClick={onCancel} disabled={busy}
                style={{
                  flex: 1, padding: "10px 14px",
                  background: "rgba(30, 41, 59, 0.85)", color: "#e2e8f0",
                  border: "1px solid rgba(148, 163, 184, 0.30)", borderRadius: 8,
                  fontSize: 13, fontWeight: 600,
                  cursor: busy ? "not-allowed" : "pointer",
                }}>Cancel</button>
        <button type="button"
                onClick={() => !disabled && onSave(pillar.id, n, detail)}
                disabled={disabled}
                style={{
                  flex: 1, padding: "10px 14px",
                  background: disabled ? "rgba(71, 85, 105, 0.70)"
                            : "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
                  color: "#fff", border: "none", borderRadius: 8,
                  fontSize: 13, fontWeight: 700,
                  cursor: disabled ? "not-allowed" : "pointer",
                  boxShadow: disabled ? "none" : "0 4px 14px rgba(99, 102, 241, 0.40)",
                }}>
          {busy ? "Saving…" : "Save pillar"}
        </button>
      </div>
    </div>
  );
}


// ── Alkalo notes tab ────────────────────────────────────────────────

function NoteTile({ note }) {
  return (
    <div style={{
      background:   "rgba(30, 41, 59, 0.55)",
      border:       "1px solid rgba(148, 163, 184, 0.18)",
      borderRadius: 10, padding: "10px 12px",
      display: "flex", flexDirection: "column", gap: 4,
    }}>
      <div style={{ color: "#e2e8f0", fontSize: 13, lineHeight: 1.5 }}>
        {note.note}
      </div>
      {note.at && (
        <div style={{ color: "#64748b", fontSize: 10 }}>
          {new Date(note.at).toLocaleString([], {
            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
          })}
        </div>
      )}
    </div>
  );
}


function AddNoteForm({ onSubmit, onCancel, busy }) {
  const [note, setNote] = useState("");
  const disabled = busy || !note.trim();
  return (
    <div style={{
      background: "rgba(15, 23, 42, 0.70)",
      border: "1px solid rgba(148, 163, 184, 0.22)",
      borderRadius: 12, padding: "14px 16px",
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <Field label="Alkalo note (observation, priority, guidance)">
        <textarea style={{ ...INPUT, minHeight: 80, resize: "vertical" }}
                  value={note} autoFocus
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="The village will focus on screening this month. We need two more VHWs." />
      </Field>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={onCancel} disabled={busy}
                style={{
                  flex: 1, padding: "10px 14px",
                  background: "rgba(30, 41, 59, 0.85)", color: "#e2e8f0",
                  border: "1px solid rgba(148, 163, 184, 0.30)", borderRadius: 8,
                  fontSize: 13, fontWeight: 600,
                  cursor: busy ? "not-allowed" : "pointer",
                }}>Cancel</button>
        <button type="button"
                onClick={() => !disabled && onSubmit(note.trim())}
                disabled={disabled}
                style={{
                  flex: 1, padding: "10px 14px",
                  background: disabled ? "rgba(71, 85, 105, 0.70)"
                            : "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
                  color: "#fff", border: "none", borderRadius: 8,
                  fontSize: 13, fontWeight: 700,
                  cursor: disabled ? "not-allowed" : "pointer",
                  boxShadow: disabled ? "none" : "0 4px 14px rgba(99, 102, 241, 0.40)",
                }}>
          {busy ? "Posting…" : "Add note"}
        </button>
      </div>
    </div>
  );
}


// ── main modal ──────────────────────────────────────────────────────

export default function VillageManagerModal({ onClose }) {
  const [role, setRole]         = useState(_readRole);
  const [data, setData]         = useState(null);
  const [status, setStatus]     = useState("loading");
  const [error, setError]       = useState(null);
  const [tab, setTab]           = useState("pillars");
  const [editPillar, setEditPillar] = useState(null);
  const [showAdd,    setShowAdd]    = useState(false);
  const [saving,     setSaving]     = useState(false);

  const canEditPillar = useMemo(() => PILLAR_WRITE.has(role), [role]);
  const canAddNote    = useMemo(() => NOTE_WRITE.has(role),   [role]);

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
    setStatus((s) => (data ? "ok" : "loading"));
    try {
      const d = await getVillage();
      setData(d); setStatus("ok"); setError(null);
    } catch (e) {
      setStatus("error");
      setError(e.message || String(e));
    }
  }, []); // eslint-disable-line

  useEffect(() => { reload(); }, [reload]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onCloseRef.current?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const notifyChanged = () => {
    try { window.dispatchEvent(new CustomEvent("amina:village-updated")); }
    catch { /* noop */ }
  };

  const savePillar = async (pillarId, score, detail) => {
    setSaving(true);
    try {
      await updatePillar({ pillar_id: pillarId, score, detail }, role === "admin" ? "alkalo" : role);
      setEditPillar(null);
      await reload();
      notifyChanged();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const submitNote = async (note) => {
    setSaving(true);
    try {
      await addAlkaloNote(note, role === "admin" ? "alkalo" : role);
      setShowAdd(false);
      await reload();
      notifyChanged();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const pillars = data?.pillars || [];
  const notes   = data?.alkalo_notes || [];
  const total   = data?.score ?? 0;
  const maxTotal = data?.max_score ?? 100;
  const totalPct = Math.round(100 * total / maxTotal);
  const totalZone = _zone(totalPct);

  return (
    <div role="dialog" aria-modal="true" aria-label="Village scoreboard manager"
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
        {/* Header with village hero score */}
        <div style={{
          padding: "16px 20px",
          borderBottom: "1px solid rgba(148, 163, 184, 0.15)",
          color: "#fff",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>
                {data?.village || "Village"} Scoreboard
              </div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
                {data
                  ? <>
                      {data.region} · Rank #{data.regional_rank} of {data.regional_total}
                      {data.leading_village ? ` · Leading ${data.leading_village.name} @ ${data.leading_village.score}` : ""}
                    </>
                  : "Loading village data…"}
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close"
                    style={{ width: 30, height: 30, borderRadius: 8, border: "none",
                             background: "rgba(255,255,255,0.06)", color: "#e2e8f0",
                             cursor: "pointer", fontSize: 18, fontWeight: 700,
                             lineHeight: 1, flexShrink: 0 }}>×</button>
          </div>

          {data && (
            <div style={{
              marginTop: 12,
              padding: "10px 14px",
              background: "rgba(30, 41, 59, 0.55)",
              border: "1px solid rgba(148, 163, 184, 0.20)",
              borderRadius: 12,
              display: "flex", alignItems: "center", gap: 16,
            }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: totalZone.color }}>
                  {total}
                </div>
                <div style={{ fontSize: 13, color: "#94a3b8" }}>/ {maxTotal}</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600,
                              textTransform: "uppercase", letterSpacing: 0.3,
                              marginBottom: 4 }}>
                  Overall village score
                </div>
                <div style={{ height: 6, background: "rgba(148, 163, 184, 0.18)",
                              borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${totalPct}%`,
                                background: totalZone.color,
                                transition: "width 250ms" }} />
                </div>
              </div>
              <div style={{
                fontSize: 11, fontWeight: 700,
                color: data.trend === "up" ? "#6ee7b7"
                     : data.trend === "down" ? "#fca5a5" : "#94a3b8",
                padding: "4px 10px",
                background: "rgba(15, 23, 42, 0.7)",
                border: "1px solid rgba(148, 163, 184, 0.20)",
                borderRadius: 999,
                textTransform: "uppercase", letterSpacing: 0.3,
              }}>
                {data.trend === "up" ? "↑" : data.trend === "down" ? "↓" : "→"} {data.delta_from_last_month > 0 ? "+" : ""}{data.delta_from_last_month}
              </div>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={{
          display: "flex", padding: "10px 12px 0 12px",
          borderBottom: "1px solid rgba(148, 163, 184, 0.12)",
          background: "rgba(15, 23, 42, 0.35)",
        }}>
          {[
            { id: "pillars", label: "Pillars",      icon: "📊", count: pillars.length, accent: "#60a5fa" },
            { id: "notes",   label: "Alkalo notes", icon: "📝", count: notes.length,   accent: "#fbbf24" },
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
              Loading village…
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

          {tab === "pillars" && status === "ok" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {pillars.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: "#94a3b8",
                              background: "rgba(30, 41, 59, 0.55)",
                              border: "1px dashed rgba(148, 163, 184, 0.30)",
                              borderRadius: 12, fontSize: 13 }}>
                  No pillars configured yet.
                </div>
              ) : (
                pillars.map((p) => (
                  <PillarCard key={p.id}
                              pillar={p}
                              canEdit={canEditPillar}
                              editing={editPillar === p.id}
                              saving={saving && editPillar === p.id}
                              onStartEdit={setEditPillar}
                              onCancelEdit={() => setEditPillar(null)}
                              onSave={savePillar} />
                ))
              )}
              {!canEditPillar && (
                <div style={{
                  padding: "10px 12px", borderRadius: 10,
                  background: "rgba(30, 41, 59, 0.60)", color: "#94a3b8",
                  border: "1px solid rgba(148, 163, 184, 0.20)",
                  fontSize: 12, textAlign: "center", marginTop: 4,
                }}>
                  Switch to VHW / Alkalo / Admin to update pillar scores.
                </div>
              )}
            </div>
          )}

          {tab === "notes" && status === "ok" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {notes.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: "#94a3b8",
                              background: "rgba(30, 41, 59, 0.55)",
                              border: "1px dashed rgba(148, 163, 184, 0.30)",
                              borderRadius: 12, fontSize: 13 }}>
                  No alkalo notes yet.
                  {canAddNote ? " Add the first observation below." : ""}
                </div>
              ) : (
                notes.slice().reverse().map((n, i) => <NoteTile key={i} note={n} />)
              )}

              <div style={{ marginTop: 6 }}>
                {canAddNote ? (
                  showAdd ? (
                    <AddNoteForm busy={saving}
                                 onCancel={() => setShowAdd(false)}
                                 onSubmit={submitNote} />
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
                      + Add new alkalo note
                    </button>
                  )
                ) : (
                  <div style={{
                    padding: "10px 12px", borderRadius: 10,
                    background: "rgba(30, 41, 59, 0.60)", color: "#94a3b8",
                    border: "1px solid rgba(148, 163, 184, 0.20)",
                    fontSize: 12, textAlign: "center",
                  }}>
                    Only Alkalo (or admin) can post notes.
                  </div>
                )}
              </div>
            </div>
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
