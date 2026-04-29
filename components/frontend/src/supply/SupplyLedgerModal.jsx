/**
 * SupplyLedgerModal — multi-entry medicine supply editor with 10-cap.
 * ======================================================================
 *
 * What this is
 * ------------
 * A self-contained modal rendered in its own React root (no coupling to
 * App.jsx). It reads the session id the user is currently viewing from
 * `localStorage.AMINA_ACTIVE_SESSION_ID` (the key App.jsx sets each
 * time it activates a session) and edits the supply ledger via the
 * additive /api/v1/care/supply_ledger/* endpoints.
 *
 * UX rules
 * --------
 *  • Cap at 10 entries. Above the list we render a "3 / 10 saved"
 *    progress bar; when at cap, the add-form is replaced with a
 *    plainly-worded "Limit reached — delete an entry to add another"
 *    banner so there's no silent append-then-409 failure.
 *  • Every existing entry surfaces its in-stock / low / critical flag
 *    as a coloured pill, plus days_remaining + refill location.
 *  • Edit + Delete buttons per row are gated on the acting role being
 *    `clinician` / `admin` (VHW + scout / alkalo / imam / patient etc.
 *    get a read-only view). The role is the same `AMINA_ROLE` that
 *    App.jsx + RoleSwitcher speak to, so no extra plumbing.
 *  • Add form is gated on the wider SUPPLY_WRITE set (clinician, vhw,
 *    admin) so VHW field stocktakes still work.
 *  • All writes carry the current JWT — the backend's effective-role
 *    resolver (shared with /care/supply) validates admin impersonation.
 *
 * Styling
 * -------
 * Inline styles only — no stylesheet coupling so the modal can't get
 * collateral damage from future App.css edits. The palette matches the
 * app's slate/blue tones used elsewhere (role pill, inbox panel).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listLedger,
  addLedgerEntry,
  patchLedgerEntry,
  deleteLedgerEntry,
} from "./supplyLedgerApi.js";


// Supply is clinician-owned (and admin impersonator). VHW is removed —
// field volunteers should not edit the facility's dispense log.
const WRITE_ROLES = new Set(["clinician", "admin"]);
const EDIT_ROLES  = new Set(["clinician", "admin"]);


function _readRole() {
  try { return localStorage.getItem("AMINA_ROLE") || "patient"; }
  catch { return "patient"; }
}


function _readSessionId() {
  // App.jsx persists the active session id under "AMINA_SID"
  // (App.jsx:1402). We also tolerate the longer form / older keys in
  // case a future refactor renames it — keeps the modal portable.
  try {
    return localStorage.getItem("AMINA_SID")
        || localStorage.getItem("AMINA_ACTIVE_SESSION_ID")
        || localStorage.getItem("AMINA_SESSION_ID")
        || "";
  } catch {
    return "";
  }
}


function StatusPill({ med }) {
  // Dark-surface palette — tuned for the navy modal background so pills
  // stay legible without overwhelming the entry card beside them.
  let bg = "rgba(16, 185, 129, 0.14)", fg = "#6ee7b7",
      border = "rgba(52, 211, 153, 0.35)", label = "In stock";
  if (med.in_stock === false) {
    bg = "rgba(248, 113, 113, 0.14)"; fg = "#fca5a5";
    border = "rgba(248, 113, 113, 0.40)"; label = "Out of stock";
  } else if (med.critical_stock) {
    bg = "rgba(248, 113, 113, 0.14)"; fg = "#fca5a5";
    border = "rgba(248, 113, 113, 0.40)"; label = "Critical";
  } else if (med.low_stock) {
    bg = "rgba(251, 191, 36, 0.14)"; fg = "#fcd34d";
    border = "rgba(251, 191, 36, 0.40)"; label = "Low";
  }
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: "3px 10px", borderRadius: 999,
      background: bg, color: fg, border: `1px solid ${border}`,
      fontSize: 11, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase",
    }}>{label}</span>
  );
}


function CapBar({ count, cap }) {
  const pct = Math.min(100, Math.round((count / cap) * 100));
  const full = count >= cap;
  const fill = full ? "#f87171" : (pct >= 80 ? "#fb923c" : "#38bdf8");
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        display: "flex", justifyContent: "space-between",
        fontSize: 11, color: "#94a3b8", fontWeight: 600,
        letterSpacing: 0.3, textTransform: "uppercase", marginBottom: 6,
      }}>
        <span>Ledger capacity</span>
        <span style={{ color: full ? "#f87171" : "#e2e8f0" }}>
          {count} / {cap}
        </span>
      </div>
      <div style={{
        height: 6, background: "rgba(148, 163, 184, 0.18)",
        borderRadius: 999, overflow: "hidden",
      }}>
        <div style={{
          height: "100%", width: `${pct}%`, background: fill,
          transition: "width 250ms cubic-bezier(0.22, 1, 0.36, 1)",
        }} />
      </div>
    </div>
  );
}


function EntryCard({ med, index, canEdit, onEdit, onDelete, busyIndex }) {
  const busy = busyIndex === index;
  return (
    <div style={{
      background:   "rgba(30, 41, 59, 0.55)",
      border:       "1px solid rgba(148, 163, 184, 0.18)",
      borderRadius: 12,
      padding:      "14px 16px",
      display:      "flex", flexDirection: "column", gap: 10,
      opacity:      busy ? 0.55 : 1,
      transition:   "opacity 160ms ease",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 15, fontWeight: 700, color: "#f1f5f9",
            wordBreak: "break-word",
          }}>
            {med.name || "(unnamed)"}
          </div>
          {(med.dosage || med.frequency) && (
            <div style={{ fontSize: 12, color: "#cbd5e1", marginTop: 2 }}>
              {[med.dosage, med.frequency].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
        <StatusPill med={med} />
      </div>

      <div style={{
        display: "grid", gridTemplateColumns: "repeat(2, 1fr)",
        gap: "8px 18px", fontSize: 12, color: "#e2e8f0",
      }}>
        <div>
          <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600,
                        textTransform: "uppercase", letterSpacing: 0.3 }}>
            Tablets
          </div>
          <div style={{ fontWeight: 600 }}>
            {med.tablets_remaining ?? 0}
            {med.tablets_per_day > 1 ? ` · ${med.tablets_per_day}/day` : ""}
          </div>
        </div>
        <div>
          <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600,
                        textTransform: "uppercase", letterSpacing: 0.3 }}>
            Days left
          </div>
          <div style={{ fontWeight: 600 }}>
            {med.days_remaining ?? "—"}
          </div>
        </div>
        {med.refill_location ? (
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600,
                          textTransform: "uppercase", letterSpacing: 0.3 }}>
              Refill at
            </div>
            <div style={{ fontWeight: 600 }}>{med.refill_location}</div>
          </div>
        ) : null}
        {med.cost_per_pack ? (
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 600,
                          textTransform: "uppercase", letterSpacing: 0.3 }}>
              Cost
            </div>
            <div style={{ fontWeight: 600 }}>{med.cost_per_pack}</div>
          </div>
        ) : null}
      </div>

      {canEdit && (
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button
            type="button"
            onClick={() => !busy && onEdit(index)}
            disabled={busy}
            style={{
              flex: 1, padding: "8px 12px",
              background: "rgba(96, 165, 250, 0.14)", color: "#bfdbfe",
              border: "1px solid rgba(96, 165, 250, 0.35)", borderRadius: 8,
              fontSize: 12, fontWeight: 700,
              cursor: busy ? "not-allowed" : "pointer",
              display: "inline-flex", justifyContent: "center",
              alignItems: "center", gap: 6,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            Edit
          </button>
          <button
            type="button"
            onClick={() => !busy && onDelete(index)}
            disabled={busy}
            style={{
              flex: 1, padding: "8px 12px",
              background: "rgba(248, 113, 113, 0.14)", color: "#fecaca",
              border: "1px solid rgba(248, 113, 113, 0.40)", borderRadius: 8,
              fontSize: 12, fontWeight: 700,
              cursor: busy ? "not-allowed" : "pointer",
              display: "inline-flex", justifyContent: "center",
              alignItems: "center", gap: 6,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
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


function Field({ label, children, span = 1 }) {
  return (
    <label style={{ gridColumn: `span ${span}`, display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600,
                     textTransform: "uppercase", letterSpacing: 0.3 }}>
        {label}
      </span>
      {children}
    </label>
  );
}


const INPUT_STYLE = {
  padding: "9px 11px",
  border: "1px solid rgba(148, 163, 184, 0.30)",
  borderRadius: 8,
  fontSize: 13,
  background: "rgba(15, 23, 42, 0.85)",
  color: "#f1f5f9",
  fontFamily: "inherit",
  outline: "none",
};


function EntryForm({ initial, onCancel, onSubmit, submitLabel, busy }) {
  const [name,  setName]  = useState(initial?.name            ?? "");
  const [tabs,  setTabs]  = useState(String(initial?.tablets_remaining ?? ""));
  const [cost,  setCost]  = useState(initial?.cost_per_pack   ?? "");
  const [loc,   setLoc]   = useState(initial?.refill_location ?? "");
  const [stock, setStock] = useState(initial?.in_stock !== false);

  const disabled = busy || !name.trim();

  // Dosage, frequency, and tablets-per-day were removed from the form
  // per product — clinicians surface those via the chat / plan flow
  // instead. We omit them from the payload too so the backend doesn't
  // clobber any pre-existing values on edit (Pydantic models here use
  // Optional[...] = None; missing keys = leave as-is).
  const submit = () => {
    if (disabled) return;
    onSubmit({
      medication_name:   name.trim(),
      tablets_remaining: parseInt(tabs, 10) || 0,
      cost_per_pack:     cost.trim(),
      refill_location:   loc.trim(),
      in_stock:          !!stock,
    });
  };

  return (
    <div style={{
      background: "rgba(15, 23, 42, 0.70)",
      border: "1px solid rgba(148, 163, 184, 0.22)",
      borderRadius: 12, padding: "14px 16px", marginTop: 4,
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
        <Field label="Medicine name *" span={2}>
          <input style={INPUT_STYLE} value={name}
                 onChange={(e) => setName(e.target.value)} autoFocus
                 placeholder="Amlodipine" />
        </Field>
        <Field label="Tablets remaining" span={2}>
          <input style={INPUT_STYLE} type="number" min="0" value={tabs}
                 onChange={(e) => setTabs(e.target.value)}
                 placeholder="30" />
        </Field>
        <Field label="Cost per pack" span={2}>
          <input style={INPUT_STYLE} value={cost}
                 onChange={(e) => setCost(e.target.value)}
                 placeholder="20 dalasi / 30 tablets" />
        </Field>
        <Field label="Refill location" span={2}>
          <input style={INPUT_STYLE} value={loc}
                 onChange={(e) => setLoc(e.target.value)}
                 placeholder="Kerewan Health Centre" />
        </Field>
        <label style={{
          gridColumn: "1 / -1", display: "inline-flex",
          alignItems: "center", gap: 8, fontSize: 13, color: "#e2e8f0",
          userSelect: "none", cursor: "pointer",
        }}>
          <input type="checkbox" checked={stock}
                 onChange={(e) => setStock(e.target.checked)} />
          In stock at the refill location
        </label>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button type="button" onClick={onCancel} disabled={busy}
                style={{
                  flex: 1, padding: "10px 14px",
                  background: "rgba(30, 41, 59, 0.85)", color: "#e2e8f0",
                  border: "1px solid rgba(148, 163, 184, 0.30)", borderRadius: 8,
                  fontSize: 13, fontWeight: 600,
                  cursor: busy ? "not-allowed" : "pointer",
                }}>
          Cancel
        </button>
        <button type="button" onClick={submit} disabled={disabled}
                style={{
                  flex: 1, padding: "10px 14px",
                  background: disabled ? "rgba(71, 85, 105, 0.70)"
                            : "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
                  color: "#fff", border: "none", borderRadius: 8,
                  fontSize: 13, fontWeight: 700,
                  cursor: disabled ? "not-allowed" : "pointer",
                  boxShadow: disabled ? "none" : "0 4px 14px rgba(99, 102, 241, 0.40)",
                }}>
          {busy ? "Saving…" : submitLabel}
        </button>
      </div>
    </div>
  );
}


export default function SupplyLedgerModal({ onClose }) {
  const [role, setRole]           = useState(_readRole);
  const [sid,  setSid]            = useState(_readSessionId);
  const [state, setState]         = useState({ status: "idle", data: null, error: null });
  const [editIndex, setEditIndex] = useState(null);
  const [showAdd,   setShowAdd]   = useState(false);
  const [busyIndex, setBusyIndex] = useState(null);
  const [addBusy,   setAddBusy]   = useState(false);
  const [patchBusy, setPatchBusy] = useState(false);

  const canAdd  = useMemo(() => WRITE_ROLES.has(role), [role]);
  const canEdit = useMemo(() => EDIT_ROLES.has(role),  [role]);

  // Live role + session sync (in case user changes role from RoleSwitcher
  // while the modal is open — unlikely but cheap to cover).
  useEffect(() => {
    const tick = () => { setRole(_readRole()); setSid(_readSessionId()); };
    tick();
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
    if (!sid) { setState({ status: "no-sid", data: null, error: null }); return; }
    setState((s) => ({ ...s, status: s.data ? "ok" : "loading" }));
    try {
      const env = await listLedger(sid);
      setState({ status: "ok", data: env, error: null });
    } catch (e) {
      setState({ status: "error", data: null, error: e.message || String(e) });
    }
  }, [sid]);

  useEffect(() => { reload(); }, [reload]);

  // Tell the Dual-Path Medicine Supply panel injector to refresh so the
  // side-panel reflects every add / edit / delete without waiting for
  // the next poll tick. Safe no-op if the injector never mounted.
  const _notifyLedgerUpdated = () => {
    try { window.dispatchEvent(new CustomEvent("amina:ledger-updated")); }
    catch { /* noop */ }
  };

  const handleAdd = async (payload) => {
    setAddBusy(true);
    try {
      const env = await addLedgerEntry(sid, payload, role === "admin" ? "clinician" : role);
      setState({ status: "ok", data: env, error: null });
      setShowAdd(false);
      _notifyLedgerUpdated();
    } catch (e) {
      if (e.code === "LIMIT_REACHED") {
        // Refresh to show the capped state + banner.
        await reload();
      } else {
        setState((s) => ({ ...s, error: e.message || String(e) }));
      }
    } finally {
      setAddBusy(false);
    }
  };

  const handlePatch = async (index, payload) => {
    setPatchBusy(true);
    setBusyIndex(index);
    try {
      const env = await patchLedgerEntry(sid, index, payload, role === "admin" ? "clinician" : role);
      setState({ status: "ok", data: env, error: null });
      setEditIndex(null);
      _notifyLedgerUpdated();
    } catch (e) {
      setState((s) => ({ ...s, error: e.message || String(e) }));
    } finally {
      setPatchBusy(false);
      setBusyIndex(null);
    }
  };

  const handleDelete = async (index) => {
    const med = state.data?.medications?.[index];
    const label = med?.name ? `"${med.name}"` : "this entry";
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
    setBusyIndex(index);
    try {
      const env = await deleteLedgerEntry(sid, index, role === "admin" ? "clinician" : role);
      setState({ status: "ok", data: env, error: null });
      if (editIndex === index) setEditIndex(null);
      _notifyLedgerUpdated();
    } catch (e) {
      setState((s) => ({ ...s, error: e.message || String(e) }));
    } finally {
      setBusyIndex(null);
    }
  };

  // Close on Escape
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onCloseRef.current?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const env  = state.data;
  const meds = env?.medications || [];
  const atCap = !!env?.limit_reached;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Medicine supply ledger"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(15, 23, 42, 0.5)",
        display: "flex", justifyContent: "center", alignItems: "flex-start",
        padding: "5vh 16px",
        fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <div style={{
        width: "min(620px, 100%)",
        maxHeight: "90vh",
        background: "#0b1220",
        borderRadius: 16,
        boxShadow: "0 24px 60px rgba(0, 0, 0, 0.55)",
        overflow: "hidden",
        display: "flex", flexDirection: "column",
        border: "1px solid rgba(148, 163, 184, 0.15)",
      }}>
        {/* Header — matches the existing "Update Medicine Supply" form */}
        <div style={{
          padding: "16px 20px",
          borderBottom: "1px solid rgba(148, 163, 184, 0.15)",
          color: "#fff",
          display: "flex", alignItems: "flex-start", gap: 12,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>
              Update Medicine Supply
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
              Keeps a ledger of this patient&rsquo;s medicines — add, edit, or
              remove entries. Existing records are preserved.
            </div>
          </div>
          <button type="button" onClick={onClose}
                  aria-label="Close"
                  style={{
                    width: 30, height: 30, borderRadius: 8, border: "none",
                    background: "rgba(255,255,255,0.06)", color: "#e2e8f0",
                    cursor: "pointer", fontSize: 18, fontWeight: 700, lineHeight: 1,
                    flexShrink: 0,
                  }}>
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "16px 20px", overflow: "auto", flex: 1 }}>
          {state.status === "no-sid" && (
            <div style={{
              padding: 24, textAlign: "center",
              color: "#cbd5e1", background: "rgba(30, 41, 59, 0.55)",
              border: "1px dashed rgba(148, 163, 184, 0.30)", borderRadius: 12,
            }}>
              Open a patient session from the sidebar first, then reopen
              the form.
            </div>
          )}

          {state.status === "loading" && (
            <div style={{ padding: 24, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
              Loading medicines…
            </div>
          )}

          {/* Error banner — shows whenever state.error is set, regardless of
              state.status. Previously gated on `state.status === "error"`,
              but handleAdd / handlePatch / handleDelete only set the
              `error` field on failure (status stayed "ok"), so add/edit/
              delete failures were swallowed silently — the user clicked
              "Add medicine", the backend returned 403/etc., and the
              modal showed nothing. Now any non-empty `state.error`
              surfaces here. */}
          {state.error && (
            <div style={{
              padding: "12px 14px",
              background: "rgba(248, 113, 113, 0.12)", color: "#fecaca",
              border: "1px solid rgba(248, 113, 113, 0.35)", borderRadius: 10,
              fontSize: 13, fontWeight: 600,
              marginBottom: 10,
            }}>
              {state.error}
            </div>
          )}

          {env && (
            <>
              <CapBar count={env.count} cap={env.cap} />

              {meds.length === 0 && (
                <div style={{
                  padding: 24, textAlign: "center", color: "#94a3b8",
                  background: "rgba(30, 41, 59, 0.55)",
                  border: "1px dashed rgba(148, 163, 184, 0.30)",
                  borderRadius: 12, fontSize: 13,
                }}>
                  No medications yet. {canAdd ? "Add the first one below." : ""}
                </div>
              )}

              {meds.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {meds.map((med, i) => (
                    <div key={`${i}-${med.name || ""}`}>
                      {editIndex === i ? (
                        <EntryForm
                          initial={med}
                          submitLabel="Save changes"
                          busy={patchBusy}
                          onCancel={() => setEditIndex(null)}
                          onSubmit={(payload) => handlePatch(i, payload)}
                        />
                      ) : (
                        <EntryCard
                          med={med}
                          index={i}
                          canEdit={canEdit}
                          onEdit={setEditIndex}
                          onDelete={handleDelete}
                          busyIndex={busyIndex}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Add section */}
              <div style={{ marginTop: 16 }}>
                {atCap ? (
                  <div style={{
                    padding: "14px 16px", borderRadius: 12,
                    background: "rgba(251, 146, 60, 0.12)",
                    border: "1px solid rgba(251, 146, 60, 0.35)",
                    color: "#fed7aa",
                    display: "flex", gap: 10, alignItems: "flex-start",
                  }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                         style={{ flexShrink: 0, marginTop: 1 }}>
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                      <line x1="12" y1="9" x2="12" y2="13"/>
                      <line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>
                        Ledger limit reached ({env.count} / {env.cap})
                      </div>
                      <div style={{ fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>
                        Delete an existing entry before adding a new medicine.
                        {canEdit
                          ? ""
                          : " Ask a clinician to clear space if you need another entry."}
                      </div>
                    </div>
                  </div>
                ) : canAdd ? (
                  showAdd ? (
                    <EntryForm
                      submitLabel="Add medicine"
                      busy={addBusy}
                      onCancel={() => setShowAdd(false)}
                      onSubmit={handleAdd}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowAdd(true)}
                      style={{
                        width: "100%", padding: "12px 14px",
                        background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
                        color: "#fff", border: "none", borderRadius: 10,
                        fontSize: 13, fontWeight: 700, cursor: "pointer",
                        boxShadow: "0 4px 14px rgba(99, 102, 241, 0.40)",
                        display: "inline-flex", justifyContent: "center",
                        alignItems: "center", gap: 8,
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                           stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5"  x2="12" y2="19"/>
                        <line x1="5"  y1="12" x2="19" y2="12"/>
                      </svg>
                      Add medicine ({env.cap_remaining} left)
                    </button>
                  )
                ) : (
                  <div style={{
                    padding: "10px 12px", borderRadius: 10,
                    background: "rgba(30, 41, 59, 0.60)", color: "#94a3b8",
                    border: "1px solid rgba(148, 163, 184, 0.20)",
                    fontSize: 12, textAlign: "center",
                  }}>
                    Switch to a clinician / VHW role to add or edit entries.
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "10px 20px",
          borderTop: "1px solid rgba(148, 163, 184, 0.15)",
          background: "rgba(15, 23, 42, 0.65)",
          fontSize: 11, color: "#94a3b8",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span>
            {env?.updated_by
              ? <>Last update by <b style={{ color: "#e2e8f0", textTransform: "capitalize" }}>{env.updated_by}</b></>
              : "No recorded updates"}
          </span>
          <button type="button" onClick={onClose}
                  style={{
                    padding: "7px 14px",
                    background: "rgba(30, 41, 59, 0.85)", color: "#e2e8f0",
                    border: "1px solid rgba(148, 163, 184, 0.30)", borderRadius: 8,
                    fontSize: 12, fontWeight: 600, cursor: "pointer",
                  }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
