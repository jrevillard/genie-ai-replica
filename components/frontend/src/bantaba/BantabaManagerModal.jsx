/**
 * BantabaManagerModal — professional health-circle management console.
 * ======================================================================
 *
 * Role model (2026-04-19 rewrite)
 * -------------------------------
 *   Patient      → "My Circle" view of THEIR own circle only. Can self-log
 *                  adherence on their own row. Cannot add/remove members,
 *                  cannot rename, cannot post highlight.
 *   Alkalo       → Full control on any circle in the village. Picks the
 *                  circle via the header chip (list of all circles).
 *   Admin        → Alkalo-equivalent via role-switcher impersonation.
 *   VHW/clinician → read-only (button hidden by RoleGates.css).
 *
 * Tabs
 * ----
 *   1. Members   — live stats hero + grouped list (On track / Needs support),
 *                  per-member adherence slider + quick-log, avatar grid
 *   2. Highlight — this-week message history + new entry (alkalo+)
 *   3. Settings  — rename circle, owner info, circle-id (alkalo+)
 *
 * Styling matches the other managers: navy #0b1220, slate tiles,
 * indigo CTA, amber banners.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getBantaba,
  getMyBantaba,
  listCircles,
  addMember,
  removeMember,
  logAdherence,
  updateHighlight,
  renameCircle,
  requestAddMember,
  requestAddMemberById,
  lookupPatientByAminaId,
  listAddRequests,
  approveAddRequest,
  rejectAddRequest,
} from "./bantabaApi.js";


// Gambian-centred relation vocabulary. Ordered so the most common
// family relations land at the top of the picker.
const RELATIONS = [
  { value: "grandmother",   label: "Grandmother" },
  { value: "grandfather",   label: "Grandfather" },
  { value: "mother",        label: "Mother" },
  { value: "father",        label: "Father" },
  { value: "sister",        label: "Sister" },
  { value: "brother",       label: "Brother" },
  { value: "aunt",          label: "Aunt" },
  { value: "uncle",         label: "Uncle" },
  { value: "cousin",        label: "Cousin" },
  { value: "spouse",        label: "Spouse" },
  { value: "co_wife",       label: "Co-wife" },
  { value: "brother_in_law",label: "Brother-in-law" },
  { value: "sister_in_law", label: "Sister-in-law" },
  { value: "niece",         label: "Niece" },
  { value: "nephew",        label: "Nephew" },
  { value: "compound_elder",label: "Compound elder" },
  { value: "compound_member", label: "Compound member" },
  { value: "neighbour",     label: "Neighbour" },
  { value: "friend",        label: "Close friend" },
  { value: "village_mate",  label: "Village mate" },
  { value: "other",         label: "Other" },
];


const FULL_WRITE = new Set(["alkalo", "admin"]);
const SELF_WRITE = new Set(["patient", "alkalo", "admin"]);


function _readRole() {
  try { return localStorage.getItem("AMINA_ROLE") || "patient"; }
  catch { return "patient"; }
}

function _readPatientName() {
  try {
    const raw = localStorage.getItem("AMINA_PATIENT");
    if (raw) {
      const p = JSON.parse(raw);
      if (p && p.name) return String(p.name);
    }
  } catch { /* noop */ }
  return "";
}


// ── shared primitives (identical palette to other managers) ──────────

const INPUT = {
  padding: "9px 11px",
  border: "1px solid rgba(148, 163, 184, 0.30)",
  borderRadius: 8, fontSize: 13,
  background: "rgba(15, 23, 42, 0.85)",
  color: "#f1f5f9", fontFamily: "inherit",
  outline: "none", width: "100%", boxSizing: "border-box",
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


function _avatarColor(name, i) {
  // Deterministic hue from the name — keeps the avatars stable between
  // renders (no flicker when the list re-sorts or re-groups).
  let h = 0;
  for (const c of String(name || "?")) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h}, 62%, 48%)`;
}


function AdherencePill({ member }) {
  const wk  = Number(member.adherence_week ?? 0);
  const tgt = Number(member.adherence_target ?? 7) || 7;
  const pct = Math.round(100 * Math.min(wk, tgt) / tgt);
  const color = pct >= 85 ? "#6ee7b7"
              : pct >= 60 ? "#fcd34d"
                          : "#fca5a5";
  const bg = pct >= 85 ? "rgba(16,185,129,0.14)"
           : pct >= 60 ? "rgba(234,179,8,0.14)"
                       : "rgba(248,113,113,0.14)";
  return (
    <span style={{
      padding: "3px 10px", borderRadius: 999,
      background: bg, color, border: `1px solid ${color}55`,
      fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
      whiteSpace: "nowrap",
    }}>{wk}/{tgt}</span>
  );
}


// ── member row ──────────────────────────────────────────────────────

function MemberRow({ member, index, canManage, canSelfLog, selfRow,
                      editing, logging, onEdit, onLogSubmit, onCancelEdit,
                      onStartLog, onRemove, busyId }) {
  const busy = busyId === member.id;
  const isOwner = !!member.is_owner;
  return (
    <div style={{
      background:   selfRow ? "rgba(99, 102, 241, 0.12)" : "rgba(30, 41, 59, 0.55)",
      border:       selfRow ? "1px solid rgba(129, 140, 248, 0.55)"
                            : "1px solid rgba(148, 163, 184, 0.18)",
      borderRadius: 12, padding: "12px 14px",
      display: "flex", flexDirection: "column", gap: 8,
      opacity: busy ? 0.55 : 1, transition: "opacity 160ms ease",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: "50%",
          background: _avatarColor(member.name, index),
          color: "#fff", fontWeight: 700, fontSize: 13,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>{(member.name || "?")[0]?.toUpperCase()}</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9",
                        display: "flex", alignItems: "center", gap: 6 }}>
            {member.name || "(unnamed)"}{member.age ? `, ${member.age}` : ""}
            {isOwner && (
              <span title="Circle owner" style={{
                fontSize: 10, padding: "2px 6px", borderRadius: 999,
                background: "rgba(99, 102, 241, 0.20)", color: "#c7d2fe",
                border: "1px solid rgba(129, 140, 248, 0.40)",
                fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase",
              }}>Owner</span>
            )}
            {selfRow && (
              <span style={{
                fontSize: 10, padding: "2px 6px", borderRadius: 999,
                background: "rgba(129, 140, 248, 0.25)", color: "#e0e7ff",
                fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase",
              }}>You</span>
            )}
          </div>
          {(member.conditions || []).length > 0 && (
            <div style={{ fontSize: 12, color: "#cbd5e1", marginTop: 2 }}>
              {(member.conditions || []).join(" · ")}
            </div>
          )}
          {!(member.conditions || []).length && (
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2,
                          fontStyle: "italic" }}>
              no conditions recorded
            </div>
          )}
        </div>

        <AdherencePill member={member} />
      </div>

      {logging && (
        <LogAdherenceInline member={member}
                            onCancel={onCancelEdit}
                            onSubmit={onLogSubmit}
                            busy={busy} />
      )}

      {!logging && (canManage || canSelfLog) && (
        <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
          {canSelfLog && (
            <button type="button" onClick={() => onStartLog(member.id)} disabled={busy}
                    style={_ACTION_BTN("#bfdbfe", "rgba(96, 165, 250, 0.14)", "rgba(96, 165, 250, 0.35)")}>
              Log adherence
            </button>
          )}
          {canManage && !isOwner && (
            <button type="button" onClick={() => onRemove(member)} disabled={busy}
                    style={_ACTION_BTN("#fecaca", "rgba(248, 113, 113, 0.14)", "rgba(248, 113, 113, 0.40)")}>
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function _ACTION_BTN(fg, bg, border) {
  return {
    flex: "1 1 40%", padding: "7px 10px",
    background: bg, color: fg,
    border: `1px solid ${border}`, borderRadius: 8,
    fontSize: 11, fontWeight: 700, cursor: "pointer",
    display: "inline-flex", justifyContent: "center", alignItems: "center",
  };
}


function LogAdherenceInline({ member, onCancel, onSubmit, busy }) {
  const tgt = Number(member.adherence_target ?? 7) || 7;
  const [val, setVal] = useState(String(member.adherence_week ?? 0));
  const n = Math.max(0, Math.min(tgt, parseInt(val, 10) || 0));
  const pct = Math.round(100 * n / tgt);
  const disabled = busy;
  return (
    <div style={{
      background: "rgba(15, 23, 42, 0.70)",
      border: "1px solid rgba(148, 163, 184, 0.22)",
      borderRadius: 10, padding: 10, marginTop: 2,
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input type="range" min="0" max={tgt} value={n}
               onChange={(e) => setVal(e.target.value)}
               style={{ flex: 1, accentColor: "#6366f1" }} />
        <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9",
                      minWidth: 60, textAlign: "right" }}>
          {n}/{tgt} <span style={{ color: "#94a3b8", fontSize: 11 }}>({pct}%)</span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={onCancel} disabled={busy}
                style={{
                  flex: 1, padding: "8px 12px",
                  background: "rgba(30, 41, 59, 0.85)", color: "#e2e8f0",
                  border: "1px solid rgba(148, 163, 184, 0.30)", borderRadius: 8,
                  fontSize: 12, fontWeight: 600,
                  cursor: busy ? "not-allowed" : "pointer",
                }}>Cancel</button>
        <button type="button" onClick={() => !disabled && onSubmit(member.id, n)}
                disabled={disabled}
                style={{
                  flex: 1, padding: "8px 12px",
                  background: disabled ? "rgba(71, 85, 105, 0.70)"
                            : "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
                  color: "#fff", border: "none", borderRadius: 8,
                  fontSize: 12, fontWeight: 700,
                  cursor: disabled ? "not-allowed" : "pointer",
                }}>{busy ? "Saving…" : "Save adherence"}</button>
      </div>
    </div>
  );
}


// ── Patient "request to add" form ────────────────────────────────
// Clinical + Gambian-culturally-aware: structured name / age /
// conditions, a relation picker grounded in compound/village life,
// and a required reason field that becomes the note the Alkalo reads
// when deciding. Optional phone so the Alkalo can reach out in person
// before approving.

function RequestAddForm({ onCancel, onSubmit, onSubmitById, busy }) {
  const [mode, setMode] = useState("id");
  const [aminaId, setAminaId] = useState("");
  const [lookupResult, setLookupResult] = useState(null);
  const [lookupError, setLookupError] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);

  const [name,      setName]      = useState("");
  const [age,       setAge]       = useState("");
  const [relation,  setRelation]  = useState("grandmother");
  const [cond,      setCond]      = useState("");
  const [reason,    setReason]    = useState("");
  const [phone,     setPhone]     = useState("");

  const handleLookup = async () => {
    const id = aminaId.trim();
    if (!id) return;
    setLookupBusy(true);
    setLookupError("");
    setLookupResult(null);
    try {
      const result = await lookupPatientByAminaId(id);
      setLookupResult(result);
    } catch (e) {
      setLookupError(e.message || "Patient not found. Check the AMINA ID and try again.");
    } finally {
      setLookupBusy(false);
    }
  };

  const disabledManual = busy || !name.trim() || !relation.trim() || !reason.trim();
  const disabledById = busy || !lookupResult || !relation.trim() || !reason.trim();

  const TAB = (label, value) => (
    <button type="button" onClick={() => { setMode(value); setLookupResult(null); setLookupError(""); }}
            style={{
              flex: 1, padding: "8px 10px", fontSize: 12, fontWeight: 600,
              background: mode === value ? "rgba(99, 102, 241, 0.25)" : "rgba(30, 41, 59, 0.60)",
              color: mode === value ? "#c7d2fe" : "#94a3b8",
              border: mode === value ? "1px solid rgba(129, 140, 248, 0.45)" : "1px solid rgba(148, 163, 184, 0.18)",
              borderRadius: 8, cursor: "pointer",
            }}>{label}</button>
  );

  return (
    <div style={{
      background: "rgba(15, 23, 42, 0.70)",
      border: "1px solid rgba(148, 163, 184, 0.22)",
      borderRadius: 12, padding: "14px 16px",
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{
        padding: "10px 12px", borderRadius: 10,
        background: "rgba(99, 102, 241, 0.10)",
        border: "1px solid rgba(129, 140, 248, 0.35)",
        color: "#c7d2fe", fontSize: 12, lineHeight: 1.5,
      }}>
        <b style={{ color: "#e0e7ff" }}>Your Alkalo will approve.</b>{" "}
        {mode === "id"
          ? <>Enter the person's <b>AMINA ID</b> (shown on their profile) to link their account to your circle.</>
          : <>Tell them who this person is and why they should be in your circle. For example: <i>"My grandmother Aminata reminds me to take my blood pressure medicine every evening."</i></>
        }
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        {TAB("🔗 Use AMINA ID", "id")}
        {TAB("✍️ Enter manually", "manual")}
      </div>

      {mode === "id" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Field label="Their AMINA ID *" span={2}>
            <div style={{ display: "flex", gap: 6 }}>
              <input style={{ ...INPUT, flex: 1, fontFamily: "monospace", letterSpacing: 1, textTransform: "uppercase" }}
                     value={aminaId} autoFocus
                     onChange={(e) => { setAminaId(e.target.value); setLookupResult(null); setLookupError(""); }}
                     onKeyDown={(e) => e.key === "Enter" && handleLookup()}
                     placeholder="AMINA-A3F7B2C1" />
              <button type="button" onClick={handleLookup}
                      disabled={lookupBusy || !aminaId.trim()}
                      style={{
                        padding: "8px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700,
                        background: lookupBusy || !aminaId.trim() ? "rgba(71, 85, 105, 0.70)" : "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
                        color: "#fff", border: "none", cursor: lookupBusy ? "wait" : "pointer",
                        minWidth: 70,
                      }}>{lookupBusy ? "…" : "Look up"}</button>
            </div>
          </Field>

          {lookupError && (
            <div style={{
              padding: "8px 12px", borderRadius: 8,
              background: "rgba(239, 68, 68, 0.12)", border: "1px solid rgba(239, 68, 68, 0.35)",
              color: "#fca5a5", fontSize: 12,
            }}>{lookupError}</div>
          )}

          {lookupResult && (
            <div style={{
              padding: "10px 12px", borderRadius: 10,
              background: "rgba(34, 197, 94, 0.10)", border: "1px solid rgba(34, 197, 94, 0.35)",
              color: "#86efac", fontSize: 13,
              display: "flex", flexDirection: "column", gap: 4,
            }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>✓ {lookupResult.name}</div>
              <div style={{ color: "#a7f3d0", fontSize: 12 }}>
                {lookupResult.age ? `Age ${lookupResult.age}` : ""}
                {lookupResult.age && lookupResult.conditions?.length ? " · " : ""}
                {(lookupResult.conditions || []).join(", ")}
                {lookupResult.region ? ` · ${lookupResult.region}` : ""}
              </div>
              <div style={{ color: "#6ee7b7", fontSize: 11, fontFamily: "monospace" }}>
                {lookupResult.amina_id}
              </div>
            </div>
          )}

          {lookupResult && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
              <Field label="Relation *">
                <select style={INPUT} value={relation}
                        onChange={(e) => setRelation(e.target.value)}>
                  {RELATIONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </Field>
              <div />
              <Field label="Why should they be in your circle? *" span={2}>
                <textarea style={{ ...INPUT, minHeight: 70, resize: "vertical" }}
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder="She reminds me to take my medicine every evening." />
              </Field>
            </div>
          )}

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
                    onClick={() => !disabledById && onSubmitById({
                      candidate_amina_id: aminaId.trim(),
                      relation,
                      reason: reason.trim(),
                    })}
                    disabled={disabledById}
                    style={{
                      flex: 1, padding: "10px 14px",
                      background: disabledById ? "rgba(71, 85, 105, 0.70)"
                                : "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
                      color: "#fff", border: "none", borderRadius: 8,
                      fontSize: 13, fontWeight: 700,
                      cursor: disabledById ? "not-allowed" : "pointer",
                      boxShadow: disabledById ? "none" : "0 4px 14px rgba(99, 102, 241, 0.40)",
                    }}>{busy ? "Sending…" : "Send request to Alkalo"}</button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
            <Field label="Their name *" span={2}>
              <input style={INPUT} value={name} autoFocus
                     onChange={(e) => setName(e.target.value)}
                     placeholder="Awa Ceesay" />
            </Field>
            <Field label="Age">
              <input style={INPUT} type="number" min="0" value={age}
                     onChange={(e) => setAge(e.target.value)}
                     placeholder="48" />
            </Field>
            <Field label="Relation *">
              <select style={INPUT} value={relation}
                      onChange={(e) => setRelation(e.target.value)}>
                {RELATIONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Conditions (comma separated)" span={2}>
              <input style={INPUT} value={cond}
                     onChange={(e) => setCond(e.target.value)}
                     placeholder="hypertension, diabetes" />
            </Field>
            <Field label="Why should they be in your circle? *" span={2}>
              <textarea style={{ ...INPUT, minHeight: 90, resize: "vertical" }}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="She reminds me to take my medicine, and I help her walk to the clinic every Thursday." />
            </Field>
            <Field label="Their phone (optional)" span={2}>
              <input style={INPUT} value={phone}
                     onChange={(e) => setPhone(e.target.value)}
                     placeholder="+220 300 0000" />
            </Field>
          </div>

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
                    onClick={() => !disabledManual && onSubmit({
                      candidate_name:       name.trim(),
                      candidate_age:        parseInt(age, 10) || 0,
                      candidate_conditions: cond.split(",").map((c) => c.trim()).filter(Boolean),
                      relation:             relation,
                      reason:               reason.trim(),
                      phone:                phone.trim(),
                    })}
                    disabled={disabledManual}
                    style={{
                      flex: 1, padding: "10px 14px",
                      background: disabledManual ? "rgba(71, 85, 105, 0.70)"
                                : "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
                      color: "#fff", border: "none", borderRadius: 8,
                      fontSize: 13, fontWeight: 700,
                      cursor: disabledManual ? "not-allowed" : "pointer",
                      boxShadow: disabledManual ? "none" : "0 4px 14px rgba(99, 102, 241, 0.40)",
                    }}>{busy ? "Sending…" : "Send request to Alkalo"}</button>
          </div>
        </>
      )}
    </div>
  );
}


// ── Alkalo Requests tab row ─────────────────────────────────────

function RequestRow({ req, onApprove, onReject, busy }) {
  const relation = (RELATIONS.find((r) => r.value === req.relation)?.label) || req.relation || "—";
  return (
    <div style={{
      background:   "rgba(30, 41, 59, 0.55)",
      border:       "1px solid rgba(148, 163, 184, 0.18)",
      borderRadius: 12, padding: "12px 14px",
      display: "flex", flexDirection: "column", gap: 8,
      opacity: busy ? 0.55 : 1,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>
            {req.candidate_name}{req.candidate_age ? `, ${req.candidate_age}` : ""}
          </div>
          <div style={{ fontSize: 11, color: "#cbd5e1", marginTop: 2 }}>
            <b style={{ color: "#e2e8f0" }}>{relation}</b>
            {" · requested by "}
            <b style={{ color: "#e2e8f0" }}>{req.requester_name || req.requester_id}</b>
          </div>
          {(req.candidate_conditions || []).length > 0 && (
            <div style={{ fontSize: 11, color: "#cbd5e1", marginTop: 2 }}>
              {(req.candidate_conditions || []).join(" · ")}
            </div>
          )}
        </div>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 999,
          background: "rgba(251, 191, 36, 0.18)", color: "#fde68a",
          textTransform: "uppercase", letterSpacing: 0.3,
          alignSelf: "flex-start", whiteSpace: "nowrap",
        }}>pending</span>
      </div>

      {req.reason ? (
        <div style={{
          padding: "8px 10px", borderRadius: 8,
          background: "rgba(15, 23, 42, 0.70)",
          border: "1px solid rgba(148, 163, 184, 0.15)",
          color: "#e2e8f0", fontSize: 12, lineHeight: 1.5, fontStyle: "italic",
        }}>"{req.reason}"</div>
      ) : null}

      <div style={{ display: "flex", justifyContent: "space-between",
                    color: "#64748b", fontSize: 10 }}>
        <span>
          {req.phone ? <>📞 {req.phone} · </> : null}
          {req.created_at ? new Date(req.created_at).toLocaleString([], {
            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
          }) : ""}
        </span>
        <span>circle <code style={{ fontFamily: "ui-monospace, monospace" }}>
          {req.requester_circle_id}</code></span>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
        <button type="button" onClick={() => onApprove(req)} disabled={busy}
                style={_ACTION_BTN("#6ee7b7", "rgba(16, 185, 129, 0.14)",
                                   "rgba(52, 211, 153, 0.35)")}>
          ✓ Approve & add
        </button>
        <button type="button" onClick={() => onReject(req)} disabled={busy}
                style={_ACTION_BTN("#fecaca", "rgba(248, 113, 113, 0.14)",
                                   "rgba(248, 113, 113, 0.40)")}>
          ✕ Reject
        </button>
      </div>
    </div>
  );
}


function AddMemberForm({ onCancel, onSubmit, busy }) {
  const [name, setName]       = useState("");
  const [age,  setAge]        = useState("");
  const [cond, setCond]       = useState("");
  const disabled = busy || !name.trim();
  return (
    <div style={{
      background: "rgba(15, 23, 42, 0.70)",
      border: "1px solid rgba(148, 163, 184, 0.22)",
      borderRadius: 12, padding: "14px 16px",
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
        <Field label="Member name *" span={2}>
          <input style={INPUT} value={name} autoFocus
                 onChange={(e) => setName(e.target.value)}
                 placeholder="Awa Ceesay" />
        </Field>
        <Field label="Age">
          <input style={INPUT} type="number" min="0" value={age}
                 onChange={(e) => setAge(e.target.value)} placeholder="48" />
        </Field>
        <Field label="Conditions (comma separated)">
          <input style={INPUT} value={cond}
                 onChange={(e) => setCond(e.target.value)}
                 placeholder="hypertension, diabetes" />
        </Field>
      </div>
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
                onClick={() => !disabled && onSubmit({
                  name: name.trim(), age: parseInt(age, 10) || 0,
                  conditions: cond.split(",").map((c) => c.trim()).filter(Boolean),
                })}
                disabled={disabled}
                style={{
                  flex: 1, padding: "10px 14px",
                  background: disabled ? "rgba(71, 85, 105, 0.70)"
                            : "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
                  color: "#fff", border: "none", borderRadius: 8,
                  fontSize: 13, fontWeight: 700,
                  cursor: disabled ? "not-allowed" : "pointer",
                  boxShadow: disabled ? "none" : "0 4px 14px rgba(99, 102, 241, 0.40)",
                }}>{busy ? "Adding…" : "Add member"}</button>
      </div>
    </div>
  );
}


// ── main modal ──────────────────────────────────────────────────────

export default function BantabaManagerModal({ onClose }) {
  const [role, setRole]         = useState(_readRole);
  const [patientName]           = useState(_readPatientName);
  const [data,   setData]       = useState(null);
  const [status, setStatus]     = useState("loading");
  const [error,  setError]      = useState(null);
  const [tab,    setTab]        = useState("members");
  const [showAdd, setShowAdd]   = useState(false);
  const [loggingId, setLoggingId] = useState(null);
  const [busyId,  setBusyId]    = useState(null);
  const [mutating, setMutating] = useState(false);
  const [circles,  setCircles]  = useState([]);  // alkalo picker
  const [circleId, setCircleId] = useState(null);  // selected circle id
  const [renameVal, setRenameVal] = useState("");
  const [hlVal,     setHlVal]     = useState("");
  const [showRequest, setShowRequest] = useState(false);   // patient form open?
  const [requestBanner, setRequestBanner] = useState(null); // "Sent!" flash
  const [requests, setRequests] = useState([]);             // alkalo pending inbox

  const canFull = useMemo(() => FULL_WRITE.has(role), [role]);
  const canSelf = useMemo(() => SELF_WRITE.has(role), [role]);
  const isPatient = role === "patient";

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

  // Initial load — patient gets their own circle; alkalo/admin pick
  // from the list (default to first circle).
  const loadCircleById = useCallback(async (id) => {
    setStatus((s) => (data ? "ok" : "loading"));
    try {
      const d = await getBantaba(id);
      setData(d); setCircleId(d.circle_id || id); setStatus("ok"); setError(null);
      setRenameVal(d.name || "");
      setHlVal(d.this_week_highlight || "");
    } catch (e) {
      setStatus("error"); setError(e.message || String(e));
    }
  }, []);  // eslint-disable-line

  const bootstrap = useCallback(async () => {
    setStatus("loading"); setError(null);
    try {
      if (isPatient) {
        const mine = await getMyBantaba();
        setData(mine); setCircleId(mine.circle_id);
        setRenameVal(mine.name || ""); setHlVal(mine.this_week_highlight || "");
        setStatus("ok");
      } else {
        // alkalo/admin/other → list + open the first non-default circle,
        // falling back to "default" for demo seed visibility.
        let list = [];
        try { list = (await listCircles(role === "admin" ? "alkalo" : role))?.circles || []; }
        catch { list = []; }
        setCircles(list);
        const first = list.find((c) => c.circle_id !== "default") || list[0];
        const pickId = first?.circle_id || "default";
        await loadCircleById(pickId);
      }
    } catch (e) {
      setStatus("error");
      setError(e.message || String(e));
    }
  }, [isPatient, role, loadCircleById]);

  useEffect(() => { bootstrap(); }, [bootstrap]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onCloseRef.current?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const reload = useCallback(async () => {
    if (!circleId) return;
    await loadCircleById(circleId);
  }, [circleId, loadCircleById]);

  const notify = () => {
    try { window.dispatchEvent(new CustomEvent("amina:bantaba-updated")); }
    catch { /* noop */ }
  };

  const asRole = () => role === "admin" ? "alkalo" : role;

  const handleAdd = async (payload) => {
    setMutating(true);
    try {
      await addMember(circleId, payload, asRole());
      setShowAdd(false);
      await reload();
      notify();
    } catch (e) { setError(e.message || String(e)); }
    finally    { setMutating(false); }
  };

  // Patient path: send a request (goes to Alkalo inbox).
  const handleRequestAdd = async (payload) => {
    setMutating(true);
    try {
      await requestAddMember(payload);
      setShowRequest(false);
      setRequestBanner(
        `Request sent to your Alkalo. They will review and add ${payload.candidate_name}.`
      );
      setTimeout(() => setRequestBanner(null), 6000);
    } catch (e) { setError(e.message || String(e)); }
    finally    { setMutating(false); }
  };

  // Patient path: send request using AMINA ID (linked account).
  const handleRequestAddById = async (payload) => {
    setMutating(true);
    try {
      const result = await requestAddMemberById(payload);
      setShowRequest(false);
      const candidateName = result?.candidate?.name || "the person";
      setRequestBanner(
        `Request sent to your Alkalo. They will review and add ${candidateName} (linked account).`
      );
      setTimeout(() => setRequestBanner(null), 6000);
    } catch (e) { setError(e.message || String(e)); }
    finally    { setMutating(false); }
  };

  // Alkalo inbox actions.
  const loadRequests = useCallback(async () => {
    if (!canFull) return;
    try {
      const resp = await listAddRequests("pending", asRole());
      setRequests(resp?.requests || []);
    } catch { /* silent — the tab will just show "no pending" */ }
  }, [canFull]);  // eslint-disable-line

  useEffect(() => {
    if (tab === "requests") loadRequests();
  }, [tab, loadRequests]);

  const handleApproveRequest = async (req) => {
    setBusyId(req.req_id);
    try {
      await approveAddRequest(req.req_id, asRole());
      await loadRequests();
      // If the approval targeted the currently-open circle, refresh it.
      if (req.requester_circle_id === circleId) await reload();
      notify();
    } catch (e) { setError(e.message || String(e)); }
    finally    { setBusyId(null); }
  };

  const handleRejectRequest = async (req) => {
    // eslint-disable-next-line no-alert
    const reason = window.prompt(
      `Reject ${req.candidate_name}? Reason for the patient (optional):`,
      "",
    );
    if (reason === null) return;
    setBusyId(req.req_id);
    try {
      await rejectAddRequest(req.req_id, reason || "", asRole());
      await loadRequests();
      notify();
    } catch (e) { setError(e.message || String(e)); }
    finally    { setBusyId(null); }
  };

  const handleRemove = async (member) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Remove ${member.name} from the circle?`)) return;
    setBusyId(member.id);
    try {
      await removeMember(circleId, member.id, asRole());
      await reload();
      notify();
    } catch (e) { setError(e.message || String(e)); }
    finally    { setBusyId(null); }
  };

  const handleLog = async (memberId, value) => {
    setBusyId(memberId); setMutating(true);
    try {
      await logAdherence(circleId, { member_id: memberId, adherence_week: value }, asRole());
      setLoggingId(null);
      await reload();
      notify();
    } catch (e) { setError(e.message || String(e)); }
    finally    { setBusyId(null); setMutating(false); }
  };

  const handleHighlight = async () => {
    const text = hlVal.trim();
    if (!text) return;
    setMutating(true);
    try {
      await updateHighlight(circleId, text, asRole());
      await reload();
      notify();
    } catch (e) { setError(e.message || String(e)); }
    finally    { setMutating(false); }
  };

  const handleRename = async () => {
    const n = renameVal.trim();
    if (!n) return;
    setMutating(true);
    try {
      await renameCircle(circleId, n, asRole());
      await reload();
      notify();
    } catch (e) { setError(e.message || String(e)); }
    finally    { setMutating(false); }
  };

  // ── derive stats ─────────────────────────────────────────────────
  const members = data?.members || [];
  const pct = data?.adherence_pct ?? (() => {
    if (!members.length) return 0;
    const got  = members.reduce((s, m) => s + Number(m.adherence_week ?? 0), 0);
    const want = members.reduce((s, m) => s + (Number(m.adherence_target ?? 7) || 7), 0);
    return want ? Math.round(100 * got / want) : 0;
  })();
  const onTrack      = members.filter((m) => {
    const wk = Number(m.adherence_week ?? 0);
    const tg = Number(m.adherence_target ?? 7) || 7;
    return wk / tg >= 0.85;
  });
  const needSupport  = members.filter((m) => {
    const wk = Number(m.adherence_week ?? 0);
    const tg = Number(m.adherence_target ?? 7) || 7;
    return wk / tg < 0.60;
  });

  const selfName = (patientName || "").trim().toLowerCase();
  const isSelfRow = (m) => isPatient && selfName && (m.name || "").trim().toLowerCase() === selfName;

  const canLogMember = (m) => {
    if (canFull) return true;
    if (isPatient && isSelfRow(m)) return true;
    return false;
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Bantaba circle manager"
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
         style={{
           position: "fixed", inset: 0, zIndex: 10000,
           background: "rgba(15, 23, 42, 0.55)",
           display: "flex", justifyContent: "center", alignItems: "flex-start",
           padding: "4vh 16px",
           fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
         }}>
      <div style={{
        width: "min(720px, 100%)", maxHeight: "92vh",
        background: "#0b1220", borderRadius: 16,
        boxShadow: "0 24px 60px rgba(0, 0, 0, 0.55)",
        overflow: "hidden", display: "flex", flexDirection: "column",
        border: "1px solid rgba(148, 163, 184, 0.15)",
      }}>
        {/* Header */}
        <div style={{
          padding: "16px 20px",
          borderBottom: "1px solid rgba(148, 163, 184, 0.15)",
          color: "#fff",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>
                {data?.name || "Bantaba Circle"}
              </div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
                {data
                  ? <>{data.village} · Week {data.streak_weeks || 1}
                     {data.next_checkin_display ? ` · Next checkin ${data.next_checkin_display}` : ""}
                     {data.owner_name ? ` · Owner ${data.owner_name}` : ""}</>
                  : "Loading circle…"}
              </div>
              {isPatient && circleId && (
                <div style={{
                  marginTop: 6, display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "4px 10px", borderRadius: 8,
                  background: "rgba(99, 102, 241, 0.12)",
                  border: "1px solid rgba(129, 140, 248, 0.30)",
                }}>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>Your AMINA ID:</span>
                  <code style={{
                    fontSize: 12, fontWeight: 700, color: "#c7d2fe",
                    letterSpacing: 1, fontFamily: "monospace",
                  }}>AMINA-{(circleId || "").toUpperCase()}</code>
                  <button type="button" title="Copy AMINA ID"
                          onClick={(e) => {
                            e.stopPropagation();
                            try {
                              navigator.clipboard.writeText(`AMINA-${(circleId || "").toUpperCase()}`);
                              const btn = e.currentTarget;
                              btn.textContent = "✓";
                              setTimeout(() => { btn.textContent = "Copy"; }, 1500);
                            } catch { /* noop */ }
                          }}
                          style={{
                            fontSize: 10, padding: "2px 8px", borderRadius: 6,
                            background: "rgba(129, 140, 248, 0.20)", color: "#e0e7ff",
                            border: "1px solid rgba(129, 140, 248, 0.35)",
                            cursor: "pointer", fontWeight: 600,
                          }}>Copy</button>
                </div>
              )}
            </div>
            <button type="button" onClick={onClose} aria-label="Close"
                    style={{ width: 30, height: 30, borderRadius: 8, border: "none",
                             background: "rgba(255,255,255,0.06)", color: "#e2e8f0",
                             cursor: "pointer", fontSize: 18, fontWeight: 700,
                             lineHeight: 1, flexShrink: 0 }}>×</button>
          </div>

          {/* Circle picker for alkalo/admin */}
          {!isPatient && circles.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <Field label="Circle">
                <select style={INPUT} value={circleId || ""}
                        onChange={(e) => loadCircleById(e.target.value)}>
                  {circles.map((c) => (
                    <option key={c.circle_id} value={c.circle_id}>
                      {c.name} · {c.members} {c.members === 1 ? "member" : "members"} ({c.circle_id})
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}

          {/* Hero stats */}
          {data && (
            <div style={{
              marginTop: 12,
              display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8,
            }}>
              <HeroStat value={`${pct}%`} label="Adherence"
                        color={pct >= 85 ? "#6ee7b7" : pct >= 60 ? "#fcd34d" : "#fca5a5"} />
              <HeroStat value={onTrack.length} label="On track" color="#6ee7b7" />
              <HeroStat value={needSupport.length} label="Need support" color="#fca5a5" />
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
            { id: "members",   label: "Members",   icon: "👥", count: members.length,  accent: "#60a5fa" },
            { id: "highlight", label: "Highlight", icon: "⭐", count: (data?.this_week_highlight ? 1 : 0), accent: "#fbbf24" },
            ...(canFull ? [{ id: "requests", label: "Requests", icon: "📨", count: requests.length, accent: "#f87171" }] : []),
            ...(canFull ? [{ id: "settings",  label: "Settings",  icon: "⚙", count: 0, accent: "#a78bfa" }] : []),
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
                {t.id !== "settings" && (
                  <span style={{ fontSize: 10, color: active ? t.accent : "#64748b", fontWeight: 700 }}>
                    {t.count} {t.count === 1 ? "item" : "items"}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div style={{ padding: "14px 18px", overflow: "auto", flex: 1 }}>
          {status === "loading" && (
            <div style={{ padding: 24, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
              Loading circle…
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

          {tab === "members" && status === "ok" && (
            <>
              {members.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: "#94a3b8",
                              background: "rgba(30, 41, 59, 0.55)",
                              border: "1px dashed rgba(148, 163, 184, 0.30)",
                              borderRadius: 12, fontSize: 13 }}>
                  No members yet.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {members.map((m, i) => (
                    <MemberRow key={m.id} member={m} index={i}
                               canManage={canFull}
                               canSelfLog={canLogMember(m)}
                               selfRow={isSelfRow(m)}
                               logging={loggingId === m.id}
                               onEdit={() => {}}
                               onStartLog={setLoggingId}
                               onCancelEdit={() => setLoggingId(null)}
                               onLogSubmit={handleLog}
                               onRemove={handleRemove}
                               busyId={busyId} />
                  ))}
                </div>
              )}

              <div style={{ marginTop: 14 }}>
                {requestBanner && (
                  <div style={{
                    marginBottom: 10, padding: "10px 14px", borderRadius: 10,
                    background: "rgba(16, 185, 129, 0.12)", color: "#a7f3d0",
                    border: "1px solid rgba(52, 211, 153, 0.40)",
                    fontSize: 12, fontWeight: 600,
                  }}>
                    ✓ {requestBanner}
                  </div>
                )}

                {canFull ? (
                  showAdd ? (
                    <AddMemberForm busy={mutating}
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
                            }}>+ Add member</button>
                  )
                ) : isPatient ? (
                  showRequest ? (
                    <RequestAddForm busy={mutating}
                                    onCancel={() => setShowRequest(false)}
                                    onSubmit={handleRequestAdd}
                                    onSubmitById={handleRequestAddById} />
                  ) : (
                    <button type="button" onClick={() => setShowRequest(true)}
                            style={{
                              width: "100%", padding: "12px 14px",
                              background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
                              color: "#fff", border: "none", borderRadius: 10,
                              fontSize: 13, fontWeight: 700, cursor: "pointer",
                              boxShadow: "0 4px 14px rgba(99, 102, 241, 0.40)",
                              display: "inline-flex", justifyContent: "center",
                              alignItems: "center", gap: 8,
                            }}>+ Request to add someone</button>
                  )
                ) : (
                  <div style={{
                    padding: "10px 12px", borderRadius: 10,
                    background: "rgba(30, 41, 59, 0.60)", color: "#94a3b8",
                    border: "1px solid rgba(148, 163, 184, 0.20)",
                    fontSize: 12, textAlign: "center",
                  }}>
                    Only Alkalo can add members.
                  </div>
                )}
              </div>
            </>
          )}

          {tab === "requests" && canFull && status === "ok" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{
                padding: "10px 12px", borderRadius: 10,
                background: "rgba(99, 102, 241, 0.08)",
                border: "1px solid rgba(129, 140, 248, 0.30)",
                color: "#c7d2fe", fontSize: 12, lineHeight: 1.5,
              }}>
                Patients ask you to add people to their Bantaba circle.
                Read the reason — if it fits, approve and the person is
                added to the requester's circle. Reject to close the
                request (with an optional note to the patient).
              </div>

              {requests.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: "#94a3b8",
                              background: "rgba(30, 41, 59, 0.55)",
                              border: "1px dashed rgba(148, 163, 184, 0.30)",
                              borderRadius: 12, fontSize: 13 }}>
                  No pending add-member requests.
                </div>
              ) : (
                requests.map((r) => (
                  <RequestRow key={r.req_id} req={r}
                              busy={busyId === r.req_id}
                              onApprove={handleApproveRequest}
                              onReject={handleRejectRequest} />
                ))
              )}
            </div>
          )}

          {tab === "highlight" && status === "ok" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{
                padding: "14px 16px", borderRadius: 12,
                background: "rgba(251, 191, 36, 0.08)",
                border: "1px solid rgba(251, 191, 36, 0.25)",
                color: "#fde68a",
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                              letterSpacing: 0.3, color: "#fbbf24" }}>
                  This week's highlight
                </div>
                <div style={{ fontSize: 14, color: "#f1f5f9", marginTop: 6,
                              fontStyle: data?.this_week_highlight ? "normal" : "italic" }}>
                  {data?.this_week_highlight || "No highlight yet."}
                </div>
              </div>

              {canFull ? (
                <>
                  <Field label="New highlight">
                    <textarea style={{ ...INPUT, minHeight: 80, resize: "vertical" }}
                              value={hlVal}
                              onChange={(e) => setHlVal(e.target.value)}
                              placeholder="Awa tried less oil in her domoda, Ramatoulie walked every day." />
                  </Field>
                  <button type="button"
                          onClick={handleHighlight}
                          disabled={mutating || !hlVal.trim()}
                          style={{
                            padding: "10px 14px",
                            background: (mutating || !hlVal.trim())
                              ? "rgba(71, 85, 105, 0.70)"
                              : "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
                            color: "#fff", border: "none", borderRadius: 8,
                            fontSize: 13, fontWeight: 700,
                            cursor: (mutating || !hlVal.trim()) ? "not-allowed" : "pointer",
                            boxShadow: mutating ? "none" : "0 4px 14px rgba(99, 102, 241, 0.40)",
                          }}>
                    {mutating ? "Posting…" : "Update highlight"}
                  </button>
                </>
              ) : (
                <div style={{
                  padding: "10px 12px", borderRadius: 10,
                  background: "rgba(30, 41, 59, 0.60)", color: "#94a3b8",
                  border: "1px solid rgba(148, 163, 184, 0.20)",
                  fontSize: 12, textAlign: "center",
                }}>
                  Only Alkalo can post the weekly highlight.
                </div>
              )}
            </div>
          )}

          {tab === "settings" && canFull && status === "ok" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Field label="Circle name">
                <input style={INPUT} value={renameVal}
                       onChange={(e) => setRenameVal(e.target.value)}
                       placeholder="Awa's Circle" />
              </Field>
              <button type="button"
                      onClick={handleRename}
                      disabled={mutating || !renameVal.trim() || renameVal === data?.name}
                      style={{
                        padding: "10px 14px",
                        background: (mutating || !renameVal.trim() || renameVal === data?.name)
                          ? "rgba(71, 85, 105, 0.70)"
                          : "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
                        color: "#fff", border: "none", borderRadius: 8,
                        fontSize: 13, fontWeight: 700,
                        cursor: (mutating || !renameVal.trim() || renameVal === data?.name)
                          ? "not-allowed" : "pointer",
                      }}>
                {mutating ? "Saving…" : "Rename circle"}
              </button>

              <div style={{
                marginTop: 10, padding: "10px 14px",
                background: "rgba(30, 41, 59, 0.55)",
                border: "1px solid rgba(148, 163, 184, 0.18)",
                borderRadius: 10,
              }}>
                <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700,
                              textTransform: "uppercase", letterSpacing: 0.3 }}>
                  Owner
                </div>
                <div style={{ fontSize: 13, color: "#f1f5f9", marginTop: 2 }}>
                  {data?.owner_name || "—"}
                </div>
                <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700,
                              textTransform: "uppercase", letterSpacing: 0.3, marginTop: 10 }}>
                  Circle ID
                </div>
                <div style={{ fontSize: 11, color: "#cbd5e1",
                              fontFamily: "ui-monospace, monospace", marginTop: 2 }}>
                  {data?.circle_id || "—"}
                </div>
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


function HeroStat({ value, label, color }) {
  return (
    <div style={{
      background: "rgba(30, 41, 59, 0.55)",
      border: "1px solid rgba(148, 163, 184, 0.20)",
      borderRadius: 12, padding: "10px 12px",
      display: "flex", flexDirection: "column", alignItems: "center",
    }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || "#f1f5f9" }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700,
                    textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </div>
    </div>
  );
}
