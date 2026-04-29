/**
 * ScoutDirectoryPanel — patient-facing youth scout browser.
 *
 * Visible to ALL patients regardless of tier. Shows:
 *   - Card grid of all village scouts with name, badge, availability
 *   - Click a card → expanded scout detail (elders, duty, greeting)
 *   - "Suggest Someone Needs Help" button → inline form
 *   - "My Suggestions" tab to track status of prior submissions
 *
 * No admin/write actions — those stay in ScoutManagerModal (Alkalo only).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";


const BASE = (() => {
  const raw = (typeof window !== "undefined" && window.__AMINA_API_BASE__)
           || (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_BASE)
           || "http://localhost:8000";
  return String(raw).replace(/\/+$/, "");
})();


function _auth() {
  try {
    const tok = localStorage.getItem("AMINA_TOKEN") || "";
    return tok
      ? { "Authorization": `Bearer ${tok}`, "Content-Type": "application/json" }
      : { "Content-Type": "application/json" };
  } catch {
    return { "Content-Type": "application/json" };
  }
}


// ── API helpers ─────────────────────────────────────────────────────

async function fetchScouts(village) {
  const q = village ? `?village=${encodeURIComponent(village)}` : "";
  const r = await fetch(`${BASE}/api/v1/scout-directory/list${q}`, {
    credentials: "include", headers: _auth(),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function fetchScoutDetail(scoutId) {
  const r = await fetch(`${BASE}/api/v1/scout-directory/scout/${encodeURIComponent(scoutId)}`, {
    credentials: "include", headers: _auth(),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function submitSuggestion(body) {
  const r = await fetch(`${BASE}/api/v1/scout-directory/suggest`, {
    method: "POST", credentials: "include", headers: _auth(),
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => null);
    throw new Error(d?.detail || `HTTP ${r.status}`);
  }
  return r.json();
}

async function fetchMySuggestions() {
  const r = await fetch(`${BASE}/api/v1/scout-directory/suggestions?status=`, {
    credentials: "include", headers: _auth(),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}


// ── Shared styles ───────────────────────────────────────────────────

const CARD = {
  background: "rgba(15, 23, 42, 0.75)",
  border: "1px solid rgba(148, 163, 184, 0.18)",
  borderRadius: 14,
  padding: "16px 18px",
  cursor: "pointer",
  transition: "border-color 0.15s, transform 0.12s",
};

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

const BTN_PRIMARY = {
  padding: "9px 20px",
  background: "linear-gradient(135deg, #6366f1, #818cf8)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  letterSpacing: 0.3,
};

const BTN_GHOST = {
  ...BTN_PRIMARY,
  background: "transparent",
  border: "1px solid rgba(148, 163, 184, 0.30)",
  color: "#94a3b8",
  fontWeight: 600,
};


// ── Badge pill ──────────────────────────────────────────────────────

function BadgePill({ badge, color }) {
  const colors = {
    bronze:   { bg: "rgba(202, 138, 4, 0.18)",  fg: "#fcd34d" },
    silver:   { bg: "rgba(148, 163, 184, 0.20)", fg: "#e2e8f0" },
    gold:     { bg: "rgba(234, 179, 8, 0.22)",   fg: "#fde68a" },
    platinum: { bg: "rgba(16, 185, 129, 0.18)",  fg: "#6ee7b7" },
  };
  const pal = colors[color] || colors.bronze;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: "3px 10px", borderRadius: 999,
      background: pal.bg, color: pal.fg,
      border: `1px solid ${pal.fg}33`,
      fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
      textTransform: "uppercase",
    }}>{badge}</span>
  );
}


// ── Availability dot ────────────────────────────────────────────────

function AvailDot({ status }) {
  const map = {
    available: { bg: "#10b981", label: "Available" },
    busy:      { bg: "#f59e0b", label: "Busy" },
    offline:   { bg: "#64748b", label: "Offline" },
  };
  const s = map[status] || map.available;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: s.bg }}>
      <span style={{
        width: 8, height: 8, borderRadius: "50%",
        background: s.bg, display: "inline-block",
        boxShadow: status === "available" ? `0 0 6px ${s.bg}80` : "none",
      }} />
      {s.label}
    </span>
  );
}


// ── Scout card ──────────────────────────────────────────────────────

function ScoutCard({ scout, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      style={{
        ...CARD,
        borderColor: hov ? "#6366f180" : CARD.border,
        transform: hov ? "translateY(-2px)" : "none",
      }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={() => onClick(scout.scout_id)}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9" }}>{scout.name}</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
            {scout.village}{scout.locality ? ` — ${scout.locality}` : ""} &middot; Age {scout.age}
          </div>
        </div>
        <AvailDot status={scout.availability} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <BadgePill badge={scout.badge} color={scout.badge_color} />
        <span style={{ fontSize: 11, color: "#64748b" }}>
          {scout.total_checks} check{scout.total_checks !== 1 ? "s" : ""} &middot; {scout.elders_count} elder{scout.elders_count !== 1 ? "s" : ""}
        </span>
      </div>
      {scout.availability_note && (
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6, fontStyle: "italic" }}>
          {scout.availability_note}
        </div>
      )}
    </div>
  );
}


// ── Scout detail overlay ────────────────────────────────────────────

function ScoutDetail({ scoutId, onBack }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchScoutDetail(scoutId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [scoutId]);

  if (loading) return <div style={{ color: "#94a3b8", padding: 24 }}>Loading scout details...</div>;
  if (!data) return <div style={{ color: "#f87171", padding: 24 }}>Scout not found.</div>;

  const badge = data.badge?.current || {};

  return (
    <div style={{ padding: "0 2px" }}>
      <button onClick={onBack} style={{ ...BTN_GHOST, marginBottom: 16, padding: "6px 14px", fontSize: 12 }}>
        &larr; Back to directory
      </button>

      <div style={{ ...CARD, cursor: "default" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#f1f5f9" }}>{data.name}</div>
            <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 2 }}>
              {data.village}{data.locality ? ` — ${data.locality}` : ""} &middot; Age {data.age}
            </div>
          </div>
          <AvailDot status={data.availability} />
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "12px 0" }}>
          <BadgePill badge={badge.name || "First Check"} color={badge.color || "bronze"} />
          {badge.reward && (
            <span style={{ fontSize: 11, color: "#94a3b8", fontStyle: "italic" }}>{badge.reward}</span>
          )}
        </div>

        {data.badge?.next && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>
              Progress to {data.badge.next.name}: {data.badge.progress_to_next || 0}%
            </div>
            <div style={{ height: 6, borderRadius: 3, background: "rgba(148,163,184,0.15)", overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 3,
                background: "linear-gradient(90deg, #6366f1, #818cf8)",
                width: `${data.badge.progress_to_next || 0}%`,
                transition: "width 0.3s",
              }} />
            </div>
          </div>
        )}

        {data.weekly_duty && (
          <div style={{
            background: "rgba(99, 102, 241, 0.08)", border: "1px solid rgba(99, 102, 241, 0.2)",
            borderRadius: 8, padding: "8px 12px", marginBottom: 12,
          }}>
            <div style={{ fontSize: 10, color: "#818cf8", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>
              This Week's Duty
            </div>
            <div style={{ fontSize: 13, color: "#e2e8f0" }}>{data.weekly_duty}</div>
          </div>
        )}

        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 8 }}>
          {data.total_checks} total check-in{data.total_checks !== 1 ? "s" : ""}
        </div>

        {data.elders && data.elders.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
              Elders Monitored ({data.elders.length})
            </div>
            {data.elders.map((e, i) => {
              const flagColors = { green: "#10b981", yellow: "#f59e0b", red: "#ef4444" };
              return (
                <div key={i} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "6px 0", borderBottom: i < data.elders.length - 1 ? "1px solid rgba(148,163,184,0.1)" : "none",
                }}>
                  <div>
                    <span style={{ fontSize: 13, color: "#e2e8f0" }}>{e.name}</span>
                    <span style={{ fontSize: 11, color: "#64748b", marginLeft: 6 }}>({e.relation})</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "#94a3b8" }}>{e.last_check}</span>
                    <span style={{
                      width: 8, height: 8, borderRadius: "50%",
                      background: flagColors[e.flag] || flagColors.green,
                    }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}


// ── Suggest help form ───────────────────────────────────────────────

function SuggestHelpForm({ onDone, onCancel, scouts }) {
  const [form, setForm] = useState({
    person_name: "", person_age: "", person_village: "",
    reason: "", urgency: "normal", preferred_scout_id: "",
  });
  const [submitting, setSub] = useState(false);
  const [error, setError] = useState("");
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.person_name.trim()) { setError("Please enter the person's name"); return; }
    if (!form.reason.trim()) { setError("Please explain why they need help"); return; }
    setSub(true);
    setError("");
    try {
      await submitSuggestion({
        person_name: form.person_name,
        person_age: parseInt(form.person_age) || 0,
        person_village: form.person_village,
        reason: form.reason,
        urgency: form.urgency,
        preferred_scout_id: form.preferred_scout_id,
      });
      onDone();
    } catch (e) {
      setError(e.message || "Submission failed");
    } finally {
      setSub(false);
    }
  };

  return (
    <div style={{ ...CARD, cursor: "default" }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9", marginBottom: 12 }}>
        Suggest Someone Needs Scout Help
      </div>
      <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16 }}>
        If you know an elder or someone in your village who could benefit from a youth scout's regular check-ins, let us know below. The Alkalo will review and assign a scout.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>Person's Name *</span>
          <input style={INPUT} value={form.person_name} onChange={e => set("person_name", e.target.value)} placeholder="e.g. Grandmother Fatou" />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>Age</span>
          <input style={INPUT} type="number" value={form.person_age} onChange={e => set("person_age", e.target.value)} placeholder="e.g. 72" />
        </label>
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>Village / Location</span>
        <input style={INPUT} value={form.person_village} onChange={e => set("person_village", e.target.value)} placeholder="e.g. Kerewan, near the mosque" />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>Why do they need help? *</span>
        <textarea style={{ ...INPUT, minHeight: 60, resize: "vertical" }} value={form.reason} onChange={e => set("reason", e.target.value)} placeholder="e.g. She lives alone and forgets to take her blood pressure medicine" />
      </label>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>Urgency</span>
          <select style={INPUT} value={form.urgency} onChange={e => set("urgency", e.target.value)}>
            <option value="low">Low — when convenient</option>
            <option value="normal">Normal</option>
            <option value="urgent">Urgent — needs attention soon</option>
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>Preferred Scout</span>
          <select style={INPUT} value={form.preferred_scout_id} onChange={e => set("preferred_scout_id", e.target.value)}>
            <option value="">Any available scout</option>
            {(scouts || []).filter(s => s.availability === "available").map(s => (
              <option key={s.scout_id} value={s.scout_id}>{s.name} — {s.village}</option>
            ))}
          </select>
        </label>
      </div>

      {error && <div style={{ color: "#f87171", fontSize: 12, marginBottom: 8 }}>{error}</div>}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button style={BTN_GHOST} onClick={onCancel}>Cancel</button>
        <button style={{ ...BTN_PRIMARY, opacity: submitting ? 0.6 : 1 }} onClick={submit} disabled={submitting}>
          {submitting ? "Submitting..." : "Submit Suggestion"}
        </button>
      </div>
    </div>
  );
}


// ── Suggestion list ─────────────────────────────────────────────────

function MySuggestions() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMySuggestions()
      .then(d => setItems(d.suggestions || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ color: "#94a3b8", fontSize: 13 }}>Loading...</div>;
  if (!items.length) return <div style={{ color: "#64748b", fontSize: 13 }}>No suggestions yet.</div>;

  const statusColors = { pending: "#f59e0b", resolved: "#10b981", rejected: "#ef4444" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map(s => (
        <div key={s.suggestion_id} style={{ ...CARD, cursor: "default", padding: "12px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>{s.person_name}</span>
            <span style={{
              fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5,
              color: statusColors[s.status] || "#94a3b8",
            }}>{s.status}</span>
          </div>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>
            {s.person_village && <span>{s.person_village} &middot; </span>}
            {s.urgency !== "normal" && <span style={{ color: s.urgency === "urgent" ? "#f59e0b" : "#64748b" }}>{s.urgency} &middot; </span>}
            {new Date(s.created_at).toLocaleDateString()}
          </div>
          <div style={{ fontSize: 12, color: "#cbd5e1", marginTop: 4 }}>{s.reason}</div>
          {s.resolution && (
            <div style={{ fontSize: 12, color: "#10b981", marginTop: 4 }}>Resolution: {s.resolution}</div>
          )}
        </div>
      ))}
    </div>
  );
}


// ── Main panel ──────────────────────────────────────────────────────

export default function ScoutDirectoryPanel({ onClose }) {
  const [tab, setTab]             = useState("directory");  // directory | suggest | mine
  const [scouts, setScouts]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [selectedId, setSelected] = useState(null);
  const [showSuccess, setSuccess] = useState(false);
  const [villageFilter, setVillage] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    fetchScouts(villageFilter || null)
      .then(d => setScouts(d.scouts || []))
      .catch(() => setScouts([]))
      .finally(() => setLoading(false));
  }, [villageFilter]);

  useEffect(() => { load(); }, [load]);

  const villages = useMemo(() => {
    const set = new Set(scouts.map(s => s.village).filter(Boolean));
    return [...set].sort();
  }, [scouts]);

  if (selectedId) {
    return (
      <div style={{ padding: 20 }}>
        <ScoutDetail scoutId={selectedId} onBack={() => setSelected(null)} />
      </div>
    );
  }

  return (
    <div style={{
      background: "rgba(11, 18, 32, 0.97)",
      borderRadius: 18,
      border: "1px solid rgba(148, 163, 184, 0.12)",
      overflow: "hidden",
      maxHeight: "80vh",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "16px 20px", borderBottom: "1px solid rgba(148,163,184,0.1)",
      }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: "#f1f5f9" }}>Youth Scout Directory</div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
            {scouts.length} scout{scouts.length !== 1 ? "s" : ""} in your area
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
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid rgba(148,163,184,0.1)" }}>
        {[
          { id: "directory", label: "Scouts" },
          { id: "suggest", label: "Suggest Help" },
          { id: "mine", label: "My Suggestions" },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setSuccess(false); }}
            style={{
              flex: 1, padding: "10px 0", border: "none",
              background: tab === t.id ? "rgba(99,102,241,0.1)" : "transparent",
              color: tab === t.id ? "#818cf8" : "#64748b",
              fontSize: 12, fontWeight: 700, cursor: "pointer",
              borderBottom: tab === t.id ? "2px solid #6366f1" : "2px solid transparent",
              textTransform: "uppercase", letterSpacing: 0.5,
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: 20, overflowY: "auto", flex: 1 }}>

        {/* ── Directory tab ── */}
        {tab === "directory" && (
          <>
            {villages.length > 1 && (
              <div style={{ marginBottom: 12 }}>
                <select
                  style={{ ...INPUT, maxWidth: 220 }}
                  value={villageFilter}
                  onChange={e => setVillage(e.target.value)}
                >
                  <option value="">All villages</option>
                  {villages.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            )}

            {loading ? (
              <div style={{ color: "#94a3b8", textAlign: "center", padding: 32 }}>Loading scouts...</div>
            ) : scouts.length === 0 ? (
              <div style={{ color: "#64748b", textAlign: "center", padding: 32 }}>
                No scouts found{villageFilter ? ` in ${villageFilter}` : ""}.
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
                {scouts.map(s => (
                  <ScoutCard key={s.scout_id} scout={s} onClick={setSelected} />
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Suggest tab ── */}
        {tab === "suggest" && (
          showSuccess ? (
            <div style={{ textAlign: "center", padding: 32 }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>&#10003;</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#10b981", marginBottom: 6 }}>Suggestion Submitted</div>
              <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 16 }}>
                Your Alkalo will review it and assign a scout if appropriate. You can track the status under "My Suggestions".
              </div>
              <button style={BTN_PRIMARY} onClick={() => { setSuccess(false); setTab("mine"); }}>
                View My Suggestions
              </button>
            </div>
          ) : (
            <SuggestHelpForm
              scouts={scouts}
              onDone={() => setSuccess(true)}
              onCancel={() => setTab("directory")}
            />
          )
        )}

        {/* ── My suggestions tab ── */}
        {tab === "mine" && <MySuggestions />}
      </div>
    </div>
  );
}
