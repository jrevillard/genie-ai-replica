/**
 * AlkaloSuggestionReview — Alkalo reviews and acts on scout help
 * suggestions submitted by patients.
 *
 * Renders as a modal overlay. Shows pending suggestions with:
 *   - Person details (name, age, village)
 *   - Reason for the suggestion
 *   - Urgency level
 *   - Preferred scout (if specified)
 *   - Approve (assign to a scout) or Dismiss with resolution note
 *
 * Opens via "amina:open-suggestion-review" custom event or when an
 * Alkalo clicks a scout_suggestion inbox item.
 */

import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useState } from "react";


const OPEN_EVENT = "amina:open-suggestion-review";

const BASE = (() => {
  const raw = (typeof window !== "undefined" && window.__AMINA_API_BASE__)
           || (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_BASE)
           || "http://localhost:8000";
  return String(raw).replace(/\/+$/, "");
})();


function _auth() {
  try {
    const tok = localStorage.getItem("AMINA_ADMIN_TOKEN")
             || localStorage.getItem("AMINA_TOKEN")
             || "";
    return tok
      ? { "Authorization": `Bearer ${tok}`, "Content-Type": "application/json" }
      : { "Content-Type": "application/json" };
  } catch { return { "Content-Type": "application/json" }; }
}

function _readRole() {
  try { return localStorage.getItem("AMINA_ROLE") || "patient"; }
  catch { return "patient"; }
}


// ── API helpers ─────────────────────────────────────────────────────

async function fetchSuggestions(status = "") {
  const role = _readRole();
  const q = new URLSearchParams();
  if (status) q.set("status", status);
  q.set("role", role);
  const r = await fetch(`${BASE}/api/v1/scout-directory/suggestions?${q}`, {
    credentials: "include", headers: _auth(),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function resolveSuggestion(id, resolution) {
  const r = await fetch(`${BASE}/api/v1/scout-directory/suggestions/${encodeURIComponent(id)}/resolve`, {
    method: "POST", credentials: "include", headers: _auth(),
    body: JSON.stringify({ resolution, role: _readRole() }),
  });
  if (!r.ok) { const d = await r.json().catch(() => null); throw new Error(d?.detail || `HTTP ${r.status}`); }
  return r.json();
}

async function fetchScouts() {
  const r = await fetch(`${BASE}/api/v1/scout-directory/list`, {
    credentials: "include", headers: _auth(),
  });
  if (!r.ok) return [];
  const d = await r.json();
  return d.scouts || [];
}

async function assignElder(scoutId, elderName, relation, age) {
  const r = await fetch(
    `${BASE}/api/v1/community/scout/assign?scout_id=${encodeURIComponent(scoutId)}`, {
    method: "POST", credentials: "include", headers: _auth(),
    body: JSON.stringify({ elder_name: elderName, relation, age: parseInt(age) || 60, role: _readRole() }),
  });
  if (!r.ok) { const d = await r.json().catch(() => null); throw new Error(d?.detail || `HTTP ${r.status}`); }
  return r.json();
}


// ── Styles ──────────────────────────────────────────────────────────

const CARD = {
  background: "rgba(15, 23, 42, 0.75)",
  border: "1px solid rgba(148, 163, 184, 0.15)",
  borderRadius: 14,
  padding: "16px 18px",
};

const INPUT = {
  padding: "8px 10px",
  border: "1px solid rgba(148, 163, 184, 0.25)",
  borderRadius: 8,
  fontSize: 13,
  background: "rgba(15, 23, 42, 0.85)",
  color: "#f1f5f9",
  fontFamily: "inherit",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const BTN = {
  padding: "7px 16px",
  border: "none",
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  letterSpacing: 0.3,
};


// ── Suggestion card ─────────────────────────────────────────────────

function SuggestionCard({ suggestion, scouts, onResolved }) {
  const [action, setAction]     = useState(null);   // "assign" | "dismiss"
  const [scoutId, setScoutId]   = useState(suggestion.preferred_scout_id || "");
  const [relation, setRelation] = useState("elder");
  const [resolution, setRes]    = useState("");
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState("");

  const urgColors = { low: "#64748b", normal: "#f59e0b", urgent: "#ef4444" };

  const handleAssign = async () => {
    if (!scoutId) { setError("Please select a scout"); return; }
    setBusy(true); setError("");
    try {
      await assignElder(scoutId, suggestion.person_name, relation, suggestion.person_age || 60);
      await resolveSuggestion(suggestion.suggestion_id, `Assigned to scout. Relation: ${relation}`);
      onResolved(suggestion.suggestion_id);
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const handleDismiss = async () => {
    if (!resolution.trim()) { setError("Please provide a reason"); return; }
    setBusy(true); setError("");
    try {
      await resolveSuggestion(suggestion.suggestion_id, resolution);
      onResolved(suggestion.suggestion_id);
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  return (
    <div style={{ ...CARD, marginBottom: 10 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9" }}>
            {suggestion.person_name}
          </div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
            {suggestion.person_village && <span>{suggestion.person_village} &middot; </span>}
            Age {suggestion.person_age || "unknown"}
          </div>
        </div>
        <span style={{
          fontSize: 10, fontWeight: 700, textTransform: "uppercase",
          letterSpacing: 0.5, padding: "3px 8px", borderRadius: 999,
          background: `${urgColors[suggestion.urgency] || urgColors.normal}20`,
          color: urgColors[suggestion.urgency] || urgColors.normal,
          border: `1px solid ${urgColors[suggestion.urgency] || urgColors.normal}40`,
        }}>{suggestion.urgency}</span>
      </div>

      {/* Reason */}
      <div style={{ fontSize: 13, color: "#cbd5e1", marginBottom: 6, lineHeight: 1.5 }}>
        {suggestion.reason}
      </div>

      {/* Meta */}
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 10 }}>
        Suggested by {suggestion.suggester_name || "a patient"} &middot; {new Date(suggestion.created_at).toLocaleDateString()}
        {suggestion.preferred_scout_id && (
          <span> &middot; Preferred scout: {scouts.find(s => s.scout_id === suggestion.preferred_scout_id)?.name || suggestion.preferred_scout_id}</span>
        )}
      </div>

      {/* Actions */}
      {!action && (
        <div style={{ display: "flex", gap: 8 }}>
          <button
            style={{ ...BTN, background: "linear-gradient(135deg, #10b981, #059669)", color: "#fff" }}
            onClick={() => setAction("assign")}
          >Assign to Scout</button>
          <button
            style={{ ...BTN, background: "transparent", border: "1px solid rgba(148,163,184,0.3)", color: "#94a3b8" }}
            onClick={() => setAction("dismiss")}
          >Dismiss</button>
        </div>
      )}

      {/* Assign form */}
      {action === "assign" && (
        <div style={{
          background: "rgba(16, 185, 129, 0.06)", border: "1px solid rgba(16, 185, 129, 0.15)",
          borderRadius: 10, padding: 12, marginTop: 6,
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600 }}>Assign to Scout</span>
              <select style={INPUT} value={scoutId} onChange={e => setScoutId(e.target.value)}>
                <option value="">Select scout...</option>
                {scouts.filter(s => s.availability === "available").map(s => (
                  <option key={s.scout_id} value={s.scout_id}>{s.name} — {s.village}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600 }}>Relation</span>
              <select style={INPUT} value={relation} onChange={e => setRelation(e.target.value)}>
                <option value="elder">Elder</option>
                <option value="grandmother">Grandmother</option>
                <option value="grandfather">Grandfather</option>
                <option value="neighbour">Neighbour</option>
                <option value="relative">Relative</option>
                <option value="friend">Friend</option>
              </select>
            </label>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button style={{ ...BTN, color: "#94a3b8", background: "transparent" }} onClick={() => setAction(null)}>Cancel</button>
            <button
              style={{ ...BTN, background: "#10b981", color: "#fff", opacity: busy ? 0.6 : 1 }}
              onClick={handleAssign} disabled={busy}
            >{busy ? "Assigning..." : "Confirm Assignment"}</button>
          </div>
        </div>
      )}

      {/* Dismiss form */}
      {action === "dismiss" && (
        <div style={{
          background: "rgba(148, 163, 184, 0.04)", border: "1px solid rgba(148, 163, 184, 0.12)",
          borderRadius: 10, padding: 12, marginTop: 6,
        }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 8 }}>
            <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600 }}>Resolution note</span>
            <textarea style={{ ...INPUT, minHeight: 50, resize: "vertical" }} value={resolution} onChange={e => setRes(e.target.value)} placeholder="e.g. Already being checked by another scout" />
          </label>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button style={{ ...BTN, color: "#94a3b8", background: "transparent" }} onClick={() => setAction(null)}>Cancel</button>
            <button
              style={{ ...BTN, background: "#64748b", color: "#fff", opacity: busy ? 0.6 : 1 }}
              onClick={handleDismiss} disabled={busy}
            >{busy ? "Submitting..." : "Dismiss Suggestion"}</button>
          </div>
        </div>
      )}

      {error && <div style={{ fontSize: 12, color: "#f87171", marginTop: 6 }}>{error}</div>}
    </div>
  );
}


// ── Main review panel ───────────────────────────────────────────────

function AlkaloSuggestionReviewPanel({ onClose }) {
  const [tab, setTab]         = useState("pending");
  const [items, setItems]     = useState([]);
  const [scouts, setScouts]   = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sugData, scoutData] = await Promise.all([
        fetchSuggestions(tab === "all" ? "" : tab),
        fetchScouts(),
      ]);
      setItems(sugData.suggestions || []);
      setScouts(scoutData);
    } catch { setItems([]); }
    setLoading(false);
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const onResolved = (id) => {
    setItems(prev => prev.filter(s => s.suggestion_id !== id));
  };

  const pending  = items.filter(s => s.status === "pending");
  const resolved = items.filter(s => s.status === "resolved");

  return (
    <div style={{
      background: "rgba(11, 18, 32, 0.97)",
      borderRadius: 18,
      border: "1px solid rgba(148, 163, 184, 0.12)",
      overflow: "hidden",
      maxHeight: "85vh",
      display: "flex",
      flexDirection: "column",
      width: "100%",
      maxWidth: 640,
    }}>
      {/* Header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "16px 20px",
        background: "linear-gradient(135deg, rgba(245,158,11,0.12), rgba(245,158,11,0.04))",
        borderBottom: "1px solid rgba(245,158,11,0.15)",
      }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#f1f5f9" }}>Scout Help Suggestions</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
            {pending.length} pending review{pending.length !== 1 ? "s" : ""}
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} style={{
            background: "none", border: "none", color: "#64748b",
            fontSize: 20, cursor: "pointer", padding: "4px 8px",
          }}>&times;</button>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid rgba(148,163,184,0.1)" }}>
        {[
          { id: "pending", label: `Pending (${pending.length})` },
          { id: "all", label: "All" },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              flex: 1, padding: "10px 0", border: "none",
              background: tab === t.id ? "rgba(245,158,11,0.08)" : "transparent",
              color: tab === t.id ? "#f59e0b" : "#64748b",
              fontSize: 12, fontWeight: 700, cursor: "pointer",
              borderBottom: tab === t.id ? "2px solid #f59e0b" : "2px solid transparent",
              textTransform: "uppercase", letterSpacing: 0.5,
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: 16, overflowY: "auto", flex: 1 }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 24, color: "#94a3b8" }}>Loading...</div>
        ) : items.length === 0 ? (
          <div style={{ textAlign: "center", padding: 32 }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>&#10003;</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#10b981" }}>All caught up</div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
              No {tab === "pending" ? "pending " : ""}suggestions to review.
            </div>
          </div>
        ) : (
          items.map(s => (
            s.status === "pending" ? (
              <SuggestionCard key={s.suggestion_id} suggestion={s} scouts={scouts} onResolved={onResolved} />
            ) : (
              <div key={s.suggestion_id} style={{ ...CARD, marginBottom: 8, opacity: 0.6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>{s.person_name}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#10b981" }}>
                    {s.status}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>{s.reason}</div>
                {s.resolution && (
                  <div style={{ fontSize: 12, color: "#10b981", marginTop: 4 }}>Resolution: {s.resolution}</div>
                )}
              </div>
            )
          ))
        )}
      </div>
    </div>
  );
}


// ── Host (listens for events, renders modal overlay) ────────────────

function AlkaloSuggestionReviewHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.openSuggestionReview = () => {
        try { window.dispatchEvent(new CustomEvent(OPEN_EVENT)); }
        catch { /* noop */ }
      };
    }
  }, []);

  const close = useCallback(() => setOpen(false), []);
  if (!open) return null;

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(0,0,0,0.55)", zIndex: 10002,
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20,
    }} onClick={e => { if (e.target === e.currentTarget) close(); }}>
      <AlkaloSuggestionReviewPanel onClose={close} />
    </div>
  );
}


// ── Self-mount ──────────────────────────────────────────────────────

function mount() {
  if (typeof window === "undefined") return;
  if (window.__aminaSuggestionReviewMounted) return;
  window.__aminaSuggestionReviewMounted = true;

  const el = document.createElement("div");
  el.id = "amina-suggestion-review-root";
  document.body.appendChild(el);
  createRoot(el).render(<AlkaloSuggestionReviewHost />);
}

try { mount(); } catch (e) { console.warn("[AlkaloSuggestionReview] mount failed:", e); }

export { AlkaloSuggestionReviewPanel };
export default AlkaloSuggestionReviewHost;
