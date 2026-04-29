/**
 * Dhis2TrackerPanel — admin UI for the DHIS2 Tracker patient-level writeback.
 *
 * Designed to be mounted two ways:
 *   1. As a full-screen overlay by Dhis2TrackerBootstrap (admin-only FAB → modal)
 *   2. As a sub-panel inside the AdminDashboard DHIS2 tab (future, if the
 *      host agrees to a 2-line edit adding a sub-route)
 *
 * Both paths render the same component; the only difference is the outer
 * shell. The panel is self-contained — auth token, API calls, audit poll,
 * and state management are all here.
 *
 * Tabs
 *   Config   — shows current Tracker config flags (program IDs, attribute
 *              map, orgunit count), with a health badge (GREEN / RED).
 *   Push     — pick a patient by search → preview (dry-run) → confirm push.
 *   Batch    — paste or multi-select up to 100 patient IDs → push.
 *   Audit    — recent TrackerPushAuditVertex rows, filterable by patient.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "./dhis2TrackerApi.js";

const TABS = [
  { key: "config",    label: "Config" },
  { key: "push",      label: "Push patient" },
  { key: "batch",     label: "Batch push" },
  { key: "audit",     label: "Tracker audit" },
  { key: "history",   label: "Aggregate history" },
  { key: "discover",  label: "Discover DHIS2" },
];


export default function Dhis2TrackerPanel({ token, onClose }) {
  const [tab, setTab] = useState("config");

  // When `onClose` is provided the panel lives inside a modal overlay
  // (Dhis2TrackerBootstrap). When it's absent the panel is mounted inline
  // as an admin tab — in that case strip the modal chrome (shadow,
  // floating radius, entry animation) so it fills the tab viewport
  // cleanly. The rendered tabs + tab bodies stay identical.
  const embedded = !onClose;

  return (
    <div
      role={embedded ? "region" : "dialog"}
      aria-label="DHIS2 Tracker — patient-level writeback"
      style={{
        width:        embedded ? "100%" : "min(960px, 100%)",
        maxHeight:    embedded ? "none" : "92vh",
        background:   "#fff",
        borderRadius: embedded ? 10 : 14,
        boxShadow:    embedded ? "0 1px 3px rgba(15,23,42,0.06)" : "0 28px 60px rgba(15,23,42,0.45)",
        overflow:     "hidden",
        display:      "flex",
        flexDirection:"column",
        fontFamily:   "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        animation:    embedded ? "none" : "amina-tracker-zoom 220ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <header style={{
        padding: "14px 20px",
        background: "linear-gradient(135deg, #1e3a8a, #0891b2)",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "0.2px" }}>
            DHIS2 Tracker writeback
          </div>
          <div style={{ fontSize: 11.5, opacity: 0.85, marginTop: 2 }}>
            Patient-level push into the national registry · admin only
          </div>
        </div>
        {onClose ? (
          <button type="button" onClick={onClose} aria-label="Close"
                  style={btnClose}>✕</button>
        ) : null}
      </header>

      <nav style={{
        display: "flex",
        gap: 4,
        padding: "0 12px",
        background: "#f8fafc",
        borderBottom: "1px solid #e2e8f0",
        overflowX: "auto",
      }}>
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <button key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              style={{
                border:     "none",
                background: "transparent",
                cursor:     "pointer",
                fontWeight: active ? 700 : 500,
                color:      active ? "#0f172a" : "#475569",
                padding:    "12px 14px",
                borderBottom: active ? "2px solid #0891b2" : "2px solid transparent",
                fontSize:   13,
                flexShrink: 0,
              }}>
              {t.label}
            </button>
          );
        })}
      </nav>

      <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px" }}>
        {tab === "config"    && <ConfigTab    token={token} />}
        {tab === "push"      && <PushTab      token={token} />}
        {tab === "batch"     && <BatchTab     token={token} />}
        {tab === "audit"     && <AuditTab     token={token} />}
        {tab === "history"   && <HistoryTab   token={token} />}
        {tab === "discover"  && <DiscoverTab  token={token} />}
      </div>

      <style>{`
        @keyframes amina-tracker-zoom {
          from { opacity: 0; transform: scale(0.96) translateY(12px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes amina-tracker-zoom { from, to { transform: none; opacity: 1; } }
        }
      `}</style>
    </div>
  );
}


// ── Config tab ───────────────────────────────────────────────────────────────

function ConfigTab({ token }) {
  const [cfg,     setCfg]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState("");

  const load = useCallback(async () => {
    setErr(""); setLoading(true);
    const r = await api.getConfig(token);
    setLoading(false);
    if (r._error) { setErr(r._error); return; }
    setCfg(r);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Loading />;
  if (err)     return <Error msg={err} onRetry={load} />;
  if (!cfg)    return null;

  const healthy = cfg.configured && cfg.enabled;
  const attrKeys = Object.keys(cfg.attribute_map || {});
  const deKeys   = Object.keys(cfg.data_element_map || {});

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span aria-hidden="true" style={{
          width: 10, height: 10, borderRadius: "50%",
          background: healthy ? "#10b981" : "#ef4444",
        }}/>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>
          {healthy ? "Tracker is fully configured + enabled" :
           cfg.enabled ? "Tracker enabled but mapping incomplete" :
           "Tracker disabled"}
        </div>
        <button type="button" onClick={load}
                style={btnGhost}>Refresh</button>
      </div>

      <ConfigRow label="Enabled flag"
                 value={String(cfg.enabled)}
                 ok={cfg.enabled} />
      <ConfigRow label="Tracker program ID"
                 value={cfg.program_id || "(not set)"}
                 ok={!!cfg.program_id}
                 hint="DHIS2_TRACKER_PROGRAM_ID" />
      <ConfigRow label="Program stage ID"
                 value={cfg.program_stage_id || "(not set)"}
                 ok={!!cfg.program_stage_id}
                 hint="DHIS2_TRACKER_PROGRAM_STAGE_ID" />
      <ConfigRow label="TEI type ID"
                 value={cfg.tei_type_id || "(not set)"}
                 ok={!!cfg.tei_type_id}
                 hint="DHIS2_TRACKER_TEI_TYPE_ID" />
      <ConfigRow label="Attribute map"
                 value={attrKeys.length ? `${attrKeys.length} mappings` : "(empty)"}
                 ok={attrKeys.length > 0}
                 hint="DHIS2_TRACKER_ATTRIBUTE_MAP (JSON)" />
      <ConfigRow label="Data element map"
                 value={deKeys.length ? `${deKeys.length} mappings` : "(empty)"}
                 ok={deKeys.length > 0}
                 hint="DHIS2_TRACKER_DATA_ELEMENT_MAP (JSON)" />
      <ConfigRow label="Org-unit map (shared with aggregate sync)"
                 value={`${cfg.orgunit_count || 0} entries`}
                 ok={(cfg.orgunit_count || 0) > 0}
                 hint="DHIS2_ORG_UNIT_MAP (JSON)" />

      {!healthy ? (
        <div style={{
          marginTop: 16,
          padding:   "12px 14px",
          background:"#fef3c7",
          border:    "1px solid #fde68a",
          borderRadius: 8,
          fontSize:  12.5,
          color:     "#78350f",
          lineHeight: 1.5,
        }}>
          <strong>To enable:</strong> set the env vars above in
          &nbsp;<code>haystack-stack/.env</code>&nbsp;(look for the <code>DHIS2_*</code>
          block) then restart <code>haystack-chatqna</code>. The server
          reads these via <code>src/config.py</code> on startup.
        </div>
      ) : null}

      <details style={{ marginTop: 18 }}>
        <summary style={{ cursor: "pointer", fontSize: 12, color: "#475569", fontWeight: 600 }}>
          Show raw mapping JSON
        </summary>
        <pre style={prePayload}>
{JSON.stringify({
  attribute_map:    cfg.attribute_map || {},
  data_element_map: cfg.data_element_map || {},
}, null, 2)}
        </pre>
      </details>
    </div>
  );
}


function ConfigRow({ label, value, ok, hint }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "220px 1fr auto",
      alignItems: "center",
      gap: 12,
      padding: "8px 0",
      borderBottom: "1px solid #f1f5f9",
    }}>
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "#0f172a" }}>{label}</div>
        {hint ? <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 2 }}>{hint}</div> : null}
      </div>
      <div style={{
        fontSize: 12,
        color: "#334155",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}>{value}</div>
      <span aria-hidden="true" style={{
        width: 8, height: 8, borderRadius: "50%",
        background: ok ? "#10b981" : "#ef4444",
      }}/>
    </div>
  );
}


// ── Push tab ─────────────────────────────────────────────────────────────────

function PushTab({ token }) {
  const [search,   setSearch]   = useState("");
  const [patients, setPatients] = useState([]);
  const [selected, setSelected] = useState(null);       // patient row
  const [force,    setForce]    = useState(false);
  const [preview,  setPreview]  = useState(null);
  const [pushResult, setPushResult] = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [pushing,  setPushing]  = useState(false);
  const [err,      setErr]      = useState("");
  const debounceRef = useRef(null);

  const loadPatients = useCallback(async (q) => {
    setLoading(true);
    const r = await api.listPatients(token, { search: q, limit: 30 });
    setLoading(false);
    setPatients(r.patients || []);
  }, [token]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadPatients(search), 250);
    return () => clearTimeout(debounceRef.current);
  }, [search, loadPatients]);

  const runDryRun = async () => {
    if (!selected) return;
    setErr(""); setPreview(null); setPushResult(null);
    const r = await api.dryRun(token, { patientId: selected.id, force });
    if (r._error || r.detail) { setErr(r._error || r.detail); return; }
    setPreview(r);
  };

  const runPush = async () => {
    if (!selected) return;
    if (!confirm(`Push ${selected.name || selected.id} to DHIS2 Tracker live?`)) return;
    setErr(""); setPushResult(null); setPushing(true);
    const r = await api.pushPatient(token, { patientId: selected.id, force });
    setPushing(false);
    if (r._error || r.detail) { setErr(r._error || r.detail); return; }
    setPushResult(r);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 18 }}>
      {/* LEFT — patient picker */}
      <aside>
        <label style={label}>Search patients</label>
        <input type="text" value={search}
               onChange={(e) => setSearch(e.target.value)}
               placeholder="Name, phone, email…"
               style={input} />
        <div style={{ marginTop: 10, maxHeight: 380, overflowY: "auto",
                      border: "1px solid #e2e8f0", borderRadius: 8 }}>
          {loading && patients.length === 0 ? (
            <Loading small />
          ) : patients.length === 0 ? (
            <div style={{ padding: 14, fontSize: 12, color: "#64748b" }}>
              No patients match.
            </div>
          ) : patients.map((p) => {
            const active = selected?.id === p.id;
            return (
              <button key={p.id} type="button"
                onClick={() => { setSelected(p); setPreview(null); setPushResult(null); }}
                style={{
                  width: "100%", textAlign: "left",
                  padding: "8px 10px",
                  background: active ? "#e0f2fe" : "#fff",
                  border: "none",
                  borderBottom: "1px solid #f1f5f9",
                  cursor: "pointer",
                  fontSize: 12.5,
                  fontWeight: active ? 600 : 500,
                  color: "#0f172a",
                  fontFamily: "inherit",
                }}>
                <div>{p.name || "(unnamed)"}</div>
                <div style={{ fontSize: 10.5, color: "#64748b" }}>
                  {p.id}  · {p.region || "—"}  · {p.age || "—"}y
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* RIGHT — action + preview/result */}
      <section>
        {!selected ? (
          <div style={{ fontSize: 13, color: "#64748b", paddingTop: 18 }}>
            Pick a patient from the list to build a Tracker payload.
          </div>
        ) : (
          <>
            <div style={{
              padding: 12,
              background: "#f8fafc",
              borderRadius: 8,
              border: "1px solid #e2e8f0",
              fontSize: 12.5,
            }}>
              <div><strong>Patient:</strong> {selected.name || "(unnamed)"} <code>{selected.id}</code></div>
              <div style={{ marginTop: 2, color: "#475569" }}>
                {selected.region || "—"} · {selected.age || "—"}y · {selected.gender || "—"}
              </div>
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 8,
                            marginTop: 14, fontSize: 12.5 }}>
              <input type="checkbox" checked={force}
                     onChange={(e) => setForce(e.target.checked)} />
              Bypass consent check <span style={{ color: "#64748b", marginLeft: 4 }}>
                (admin override)
              </span>
            </label>

            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button type="button" onClick={runDryRun} style={btnSecondary}>
                Preview (dry-run)
              </button>
              <button type="button" onClick={runPush}
                      disabled={pushing}
                      style={pushing ? btnPrimaryDisabled : btnPrimary}>
                {pushing ? "Pushing…" : "Push live"}
              </button>
            </div>

            {err ? (
              <div style={errorBox}>⚠ {err}</div>
            ) : null}

            {preview ? (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "#0f172a", marginBottom: 6 }}>
                  Dry-run payload
                </div>
                <pre style={prePayload}>{JSON.stringify(preview, null, 2)}</pre>
              </div>
            ) : null}

            {pushResult ? (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600,
                              color: pushResult.success ? "#065f46" : "#991b1b",
                              marginBottom: 6 }}>
                  {pushResult.success ? "✓ Pushed to DHIS2" : "✗ Push failed"}
                </div>
                <pre style={prePayload}>{JSON.stringify(pushResult, null, 2)}</pre>
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}


// ── Batch tab ────────────────────────────────────────────────────────────────

function BatchTab({ token }) {
  const [raw,    setRaw]    = useState("");
  const [force,  setForce]  = useState(false);
  const [result, setResult] = useState(null);
  const [err,    setErr]    = useState("");
  const [busy,   setBusy]   = useState(false);

  const ids = useMemo(() => (
    raw.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean)
  ), [raw]);

  const run = async () => {
    setErr(""); setResult(null);
    if (ids.length === 0) { setErr("Paste at least one patient ID."); return; }
    if (ids.length > 100) { setErr("Batch max is 100 — trim the list."); return; }
    if (!confirm(`Push ${ids.length} patients live to DHIS2 Tracker?`)) return;
    setBusy(true);
    const r = await api.pushBatch(token, { patientIds: ids, force });
    setBusy(false);
    if (r._error || r.detail) { setErr(r._error || r.detail); return; }
    setResult(r);
  };

  return (
    <div>
      <label style={label}>Patient IDs</label>
      <textarea value={raw}
                onChange={(e) => setRaw(e.target.value)}
                placeholder="Paste patient IDs (one per line, or comma-separated). Max 100."
                rows={6}
                style={{ ...input, resize: "vertical",
                         fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }} />
      <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 4 }}>
        Parsed: {ids.length} ID{ids.length === 1 ? "" : "s"}
        {ids.length > 100 ? " (TOO MANY — max 100)" : ""}
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 8,
                      marginTop: 14, fontSize: 12.5 }}>
        <input type="checkbox" checked={force}
               onChange={(e) => setForce(e.target.checked)} />
        Bypass consent check for every patient
      </label>

      <button type="button" onClick={run}
              disabled={busy || ids.length === 0 || ids.length > 100}
              style={busy || ids.length === 0 || ids.length > 100 ? btnPrimaryDisabled : btnPrimary}
              >
        {busy ? "Pushing…" : `Push ${ids.length} patient${ids.length === 1 ? "" : "s"} live`}
      </button>

      {err ? <div style={errorBox}>⚠ {err}</div> : null}

      {result ? (
        <div style={{ marginTop: 16 }}>
          <BatchSummary result={result} />
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: "pointer", fontSize: 12, color: "#475569", fontWeight: 600 }}>
              Show raw batch result
            </summary>
            <pre style={prePayload}>{JSON.stringify(result, null, 2)}</pre>
          </details>
        </div>
      ) : null}
    </div>
  );
}


function BatchSummary({ result }) {
  const results = Array.isArray(result.results) ? result.results : [];
  const ok = results.filter(r => r.success).length;
  const fail = results.length - ok;
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10,
      padding: 12, background: "#f8fafc",
      border: "1px solid #e2e8f0", borderRadius: 8,
    }}>
      <StatCard label="Total"   value={results.length} />
      <StatCard label="OK"      value={ok}   tone="ok" />
      <StatCard label="Failed"  value={fail} tone={fail ? "bad" : "neutral"} />
    </div>
  );
}


function StatCard({ label, value, tone = "neutral" }) {
  const color = tone === "ok" ? "#065f46" : tone === "bad" ? "#991b1b" : "#0f172a";
  return (
    <div>
      <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase",
                    letterSpacing: 0.5, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 22, color, fontWeight: 700,
                    fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}


// ── Audit tab ────────────────────────────────────────────────────────────────

function AuditTab({ token }) {
  const [rows,    setRows]    = useState([]);
  const [filter,  setFilter]  = useState("");
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState("");

  const load = useCallback(async () => {
    setErr(""); setLoading(true);
    const r = await api.getAudit(token, { patientId: filter.trim(), limit: 100 });
    setLoading(false);
    if (r._error) { setErr(r._error); return; }
    // Server responds with { total, filter, entries } per dhis2_routes.py
    setRows(r.entries || r.audit || []);
  }, [token, filter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <input type="text" value={filter}
               onChange={(e) => setFilter(e.target.value)}
               placeholder="Filter by patient_id"
               style={{ ...input, flex: 1, maxWidth: 320 }} />
        <button type="button" onClick={load} style={btnSecondary}>Refresh</button>
      </div>

      {err ? <div style={errorBox}>⚠ {err}</div> : null}
      {loading ? <Loading /> : null}

      {!loading && rows.length === 0 ? (
        <div style={{
          padding:  "28px 20px",
          textAlign:"center",
          background: "#f8fafc",
          border:   "1px solid #e2e8f0",
          borderRadius: 8,
          color:    "#64748b",
          fontSize: 13,
        }}>
          No tracker push attempts yet.
        </div>
      ) : (
        <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
          <div style={headerRow}>
            <span>When</span>
            <span>Patient</span>
            <span>TEI</span>
            <span>Events</span>
            <span>Kind</span>
            <span>Status</span>
          </div>
          {rows.map((r, i) => (
            <div key={r.audit_id || i} style={dataRow}>
              <span style={mono}>{shortDate(r.logged_at)}</span>
              <span style={mono}>{r.patient_id}</span>
              <span style={mono}>{(r.tei_uid || "—").slice(0, 11)}</span>
              <span style={{ textAlign: "center" }}>{r.events_count ?? 0}</span>
              <span>{r.dry_run ? "dry-run" : r.forced ? "forced" : "live"}</span>
              <span style={{
                color: r.success ? "#065f46" : "#991b1b", fontWeight: 600,
              }}>{r.success ? "OK" : "FAIL"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function shortDate(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(undefined, {
    dateStyle: "short", timeStyle: "short",
  }); } catch { return iso.slice(0, 16); }
}


// ── Shared primitives ───────────────────────────────────────────────────────

function Loading({ small }) {
  return (
    <div style={{
      padding: small ? 12 : 24,
      textAlign: "center",
      color: "#94a3b8",
      fontSize: 12.5,
    }}>Loading…</div>
  );
}

function Error({ msg, onRetry }) {
  return (
    <div style={errorBox}>
      ⚠ {msg}
      {onRetry ? (
        <button type="button" onClick={onRetry}
                style={{ ...btnGhost, marginLeft: 10 }}>Retry</button>
      ) : null}
    </div>
  );
}


// ── History tab — aggregate push audit with date filters ───────────────────

function HistoryTab({ token }) {
  const [rows,    setRows]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [since,   setSince]   = useState("");       // YYYY-MM-DD
  const [until,   setUntil]   = useState("");
  const [successFilter, setSuccessFilter] = useState("");  // "" | "true" | "false"
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState("");

  const load = useCallback(async () => {
    setErr(""); setLoading(true);
    const s = successFilter === "" ? null : successFilter === "true";
    // Send date-only strings as ISO — ArcadeDB does lexicographic compare
    // and both "2024-01-15" < "2024-06-01" lexicographically == chronologically.
    const r = await api.getAggregateHistory(token, {
      limit:   100,
      since:   since || "",
      until:   until || "",
      success: s,
    });
    setLoading(false);
    if (r._error) { setErr(r._error); return; }
    setRows(r.entries || []);
    setTotal(r.total || 0);
  }, [token, since, until, successFilter]);

  useEffect(() => { load(); }, [load]);

  const [expanded, setExpanded] = useState(null);   // audit_id of open row

  return (
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap",
                    alignItems: "flex-end", marginBottom: 12 }}>
        <div>
          <div style={filterLabel}>Since</div>
          <input type="date" value={since} onChange={(e) => setSince(e.target.value)}
                 style={{ ...input, maxWidth: 150 }} />
        </div>
        <div>
          <div style={filterLabel}>Until</div>
          <input type="date" value={until} onChange={(e) => setUntil(e.target.value)}
                 style={{ ...input, maxWidth: 150 }} />
        </div>
        <div>
          <div style={filterLabel}>Status</div>
          <select value={successFilter} onChange={(e) => setSuccessFilter(e.target.value)}
                  style={{ ...input, maxWidth: 130 }}>
            <option value="">Any</option>
            <option value="true">Success</option>
            <option value="false">Failure</option>
          </select>
        </div>
        <button type="button" onClick={load} style={btnSecondary}>Refresh</button>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 11.5, color: "#64748b" }}>
          Showing {rows.length} / {total} matches
        </div>
      </div>

      {err ? <div style={errorBox}>⚠ {err}</div> : null}
      {loading ? <Loading /> : null}

      {!loading && rows.length === 0 ? (
        <div style={{
          padding: "30px 20px", textAlign: "center",
          background: "#f8fafc", border: "1px solid #e2e8f0",
          borderRadius: 8, color: "#64748b", fontSize: 13,
        }}>
          No aggregate pushes match the filters.
        </div>
      ) : (
        <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
          <div style={historyHeader}>
            <span>When</span>
            <span>Period</span>
            <span>Action</span>
            <span>Values</span>
            <span>Status</span>
            <span>By</span>
            <span></span>
          </div>
          {rows.map((r, i) => {
            const isOpen = expanded === (r.audit_id || i);
            const dhis = r.dhis2_response || {};
            const inner = (dhis.response || {});
            const ic = inner.importCount || {};
            const confl = (inner.conflicts || [])[0]?.value || "";
            return (
              <div key={r.audit_id || i}>
                <div style={historyRow}
                     onClick={() => setExpanded(isOpen ? null : (r.audit_id || i))}
                     role="button" aria-expanded={isOpen}>
                  <span style={mono}>{shortDate(r.logged_at)}</span>
                  <span style={mono}>{r.period || "—"}</span>
                  <span>{r.push_action || "push"}</span>
                  <span style={{ textAlign: "center",
                                  fontVariantNumeric: "tabular-nums" }}>
                    {r.value_count || 0}
                  </span>
                  <span style={{
                    color: r.success ? "#065f46" : "#991b1b", fontWeight: 600,
                  }}>{r.success ? "OK" : "FAIL"}</span>
                  <span style={{ fontSize: 11, color: "#64748b" }}>
                    {r.triggered_by || "—"}
                  </span>
                  <span style={{ color: "#64748b", fontSize: 11 }}>
                    {isOpen ? "▾" : "▸"}
                  </span>
                </div>
                {isOpen ? (
                  <div style={{
                    padding: "10px 14px", background: "#f8fafc",
                    borderBottom: "1px solid #e2e8f0",
                  }}>
                    <div style={{ display: "grid",
                                   gridTemplateColumns: "1fr 1fr", gap: 12,
                                   fontSize: 12 }}>
                      <div>
                        <div style={subhead}>Totals</div>
                        <pre style={{ ...prePayload, maxHeight: 180 }}>
{JSON.stringify(r.totals || {}, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <div style={subhead}>DHIS2 response</div>
                        {dhis.httpStatus ? (
                          <div style={{ fontSize: 12, color: "#334155", marginBottom: 4 }}>
                            <strong>{dhis.httpStatus}</strong> ({dhis.httpStatusCode})
                            &nbsp;imp={ic.imported || 0} / upd={ic.updated || 0} /
                            &nbsp;ign={ic.ignored || 0}
                          </div>
                        ) : null}
                        {confl ? (
                          <div style={{
                            padding: "6px 8px", background: "#fef2f2",
                            color: "#991b1b", borderRadius: 4,
                            fontSize: 11.5, marginBottom: 6,
                          }}>
                            {confl}
                          </div>
                        ) : null}
                        <pre style={{ ...prePayload, maxHeight: 180 }}>
{JSON.stringify(dhis, null, 2)}
                        </pre>
                      </div>
                    </div>
                    {(r.warnings || []).length > 0 ? (
                      <details style={{ marginTop: 8 }}>
                        <summary style={{ fontSize: 12, color: "#475569",
                                           cursor: "pointer", fontWeight: 600 }}>
                          Warnings ({r.warnings.length})
                        </summary>
                        <pre style={{ ...prePayload, maxHeight: 100 }}>
{JSON.stringify(r.warnings, null, 2)}
                        </pre>
                      </details>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


// ── Discover tab — live DHIS2 schema explorer ──────────────────────────────

function DiscoverTab({ token }) {
  const [mapping, setMapping] = useState(null);
  const [datasets, setDatasets] = useState([]);
  const [pickedId, setPickedId] = useState("");
  const [datasetDetail, setDatasetDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState("");

  useEffect(() => {
    (async () => {
      setErr(""); setLoading(true);
      const [m, d] = await Promise.all([
        api.getCurrentMapping(token),
        api.discoverDatasets(token, { pageSize: 50 }),
      ]);
      setLoading(false);
      if (m._error) setErr(m._error);
      else setMapping(m);
      if (!d._error) {
        setDatasets(d.datasets || []);
        if (m?.dataset_id && !pickedId) setPickedId(m.dataset_id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!pickedId) return;
    (async () => {
      const d = await api.describeDataset(token, pickedId);
      setDatasetDetail(d);
    })();
  }, [token, pickedId]);

  if (loading) return <Loading />;

  const suggestedMap = buildSuggestedMap(mapping, datasetDetail);

  return (
    <div>
      {err ? <div style={errorBox}>⚠ {err}</div> : null}

      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#0f172a",
                    marginBottom: 6 }}>
        Current wiring
      </div>
      <div style={{ padding: "10px 12px", background: "#f8fafc",
                     border: "1px solid #e2e8f0", borderRadius: 8,
                     fontSize: 12, marginBottom: 16 }}>
        <div><strong>Base URL:</strong> <code>{mapping?.base_url || "—"}</code></div>
        <div style={{ marginTop: 3 }}>
          <strong>Aggregate dataset:</strong> <code>{mapping?.dataset_id || "—"}</code>
        </div>
        <div style={{ marginTop: 3 }}>
          <strong>Tracker enabled:</strong>{" "}
          <span style={{ color: mapping?.tracker_enabled ? "#065f46" : "#991b1b",
                         fontWeight: 600 }}>
            {String(Boolean(mapping?.tracker_enabled))}
          </span>
          {mapping?.tracker_enabled ? (
            <>
              {" · Program "}<code>{mapping.tracker_program_id || "—"}</code>
            </>
          ) : null}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr",
                     gap: 18 }}>
        <div>
          <label style={label}>Pick a dataset to inspect</label>
          <select value={pickedId} onChange={(e) => setPickedId(e.target.value)}
                  style={input}>
            <option value="">— select —</option>
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.period_type})  · {d.id}
              </option>
            ))}
          </select>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
            {datasets.length} datasets found on the live instance.
          </div>
        </div>
        <div>
          <label style={label}>Current dataset detail</label>
          {datasetDetail && !datasetDetail._error ? (
            <div style={{ padding: "10px 12px", background: "#f8fafc",
                           border: "1px solid #e2e8f0", borderRadius: 8,
                           fontSize: 12 }}>
              <div><strong>{datasetDetail.name}</strong></div>
              <div style={{ color: "#64748b", marginTop: 3 }}>
                period: {datasetDetail.period_type} · elements:{" "}
                {(datasetDetail.data_elements || []).length} · org units:{" "}
                {(datasetDetail.org_units || []).length}
              </div>
            </div>
          ) : datasetDetail?._error ? (
            <div style={errorBox}>{datasetDetail._error}</div>
          ) : (
            <div style={{ color: "#64748b", fontSize: 12 }}>
              (pick one from the left)
            </div>
          )}
        </div>
      </div>

      {datasetDetail && !datasetDetail._error ? (
        <div style={{ marginTop: 18 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr",
                         gap: 18 }}>
            <div>
              <div style={subhead}>Data elements ({(datasetDetail.data_elements || []).length})</div>
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 8,
                             maxHeight: 280, overflowY: "auto" }}>
                {(datasetDetail.data_elements || []).map((e) => (
                  <div key={e.id} style={elementRow}>
                    <code style={{ fontSize: 11, color: "#475569" }}>{e.id}</code>
                    <span style={{ fontSize: 12 }}>{e.name}</span>
                    <span style={{ fontSize: 10.5, color: "#94a3b8" }}>
                      {e.value_type || "-"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div style={subhead}>Assigned org units ({(datasetDetail.org_units || []).length})</div>
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 8,
                             maxHeight: 280, overflowY: "auto" }}>
                {(datasetDetail.org_units || []).map((ou) => (
                  <div key={ou.id} style={elementRow}>
                    <code style={{ fontSize: 11, color: "#475569" }}>{ou.id}</code>
                    <span style={{ fontSize: 12 }}>{ou.name}</span>
                    <span style={{ fontSize: 10.5, color: "#94a3b8" }}>{ou.code || "-"}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {suggestedMap ? (
            <div style={{ marginTop: 18 }}>
              <div style={subhead}>Suggested DHIS2_DATA_ELEMENT_MAP for this dataset</div>
              <pre style={prePayload}>{JSON.stringify(suggestedMap, null, 2)}</pre>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>
                Copy this JSON into{" "}
                <code>haystack-stack/.env</code> (or the compose override)
                &nbsp;as{" "}
                <code>DHIS2_DATA_ELEMENT_MAP</code>
                &nbsp;and restart{" "}
                <code>haystack-chatqna</code>. The order follows AMINA's
                11-metric taxonomy; edit to taste.
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}


function buildSuggestedMap(mapping, datasetDetail) {
  if (!datasetDetail?.data_elements?.length) return null;
  const AMINA_METRICS = [
    "AMINA_CONS_TOTAL", "AMINA_CONS_EMERGENCY", "AMINA_CONS_URGENT",
    "AMINA_CONS_ROUTINE", "AMINA_NCD_HTN", "AMINA_NCD_DM",
    "AMINA_NCD_ASTHMA", "AMINA_MCH", "AMINA_MENTAL_HEALTH",
    "AMINA_CG_ALERTS", "AMINA_SAFETY_BLOCKS",
  ];
  const out = {};
  const elts = datasetDetail.data_elements;
  AMINA_METRICS.forEach((m, i) => {
    if (elts[i]) out[m] = elts[i].id;
  });
  return out;
}


// ── Style tokens ─────────────────────────────────────────────────────────────

const label = {
  display: "block",
  fontSize: 12.5,
  fontWeight: 600,
  color: "#0f172a",
  marginBottom: 6,
};
const input = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 12.5,
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  outline: "none",
  fontFamily: "inherit",
};
const btnBase = {
  padding: "8px 14px",
  borderRadius: 8,
  fontWeight: 600,
  fontSize: 12.5,
  border: "none",
  cursor: "pointer",
};
const btnPrimary = {
  ...btnBase,
  background: "linear-gradient(135deg, #1e3a8a, #0891b2)",
  color: "#fff",
};
const btnPrimaryDisabled = {
  ...btnBase,
  background: "#94a3b8",
  color: "#fff",
  cursor: "not-allowed",
};
const btnSecondary = {
  ...btnBase,
  background: "#fff",
  color: "#0f172a",
  border: "1px solid #cbd5e1",
};
const btnGhost = {
  ...btnBase,
  background: "transparent",
  color: "#0891b2",
  padding: "4px 10px",
  fontWeight: 500,
  fontSize: 11.5,
};
const btnClose = {
  width: 28, height: 28, display: "inline-flex",
  alignItems: "center", justifyContent: "center",
  background: "rgba(255,255,255,0.2)", color: "#fff",
  border: "none", cursor: "pointer",
  borderRadius: 6, fontSize: 13,
};
const errorBox = {
  marginTop: 12,
  padding: "10px 12px",
  background: "#fef2f2",
  border: "1px solid #fecaca",
  color: "#991b1b",
  borderRadius: 6,
  fontSize: 12.5,
};
const prePayload = {
  marginTop: 8,
  padding: "10px 12px",
  background: "#0f172a",
  color: "#e2e8f0",
  border: "1px solid #1e293b",
  borderRadius: 8,
  fontSize: 11,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
  lineHeight: 1.5,
  overflowX: "auto",
  maxHeight: 320,
};
const headerRow = {
  display: "grid",
  gridTemplateColumns: "150px 150px 140px 70px 90px 80px",
  gap: 8,
  padding: "8px 12px",
  background: "#f8fafc",
  borderBottom: "1px solid #e2e8f0",
  fontSize: 11,
  fontWeight: 600,
  color: "#475569",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};
const dataRow = {
  display: "grid",
  gridTemplateColumns: "150px 150px 140px 70px 90px 80px",
  gap: 8,
  padding: "8px 12px",
  borderBottom: "1px solid #f1f5f9",
  fontSize: 12,
  color: "#334155",
  alignItems: "center",
};
const mono = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
  fontSize: 11,
  color: "#475569",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

// History + Discover tab styles
const filterLabel = {
  fontSize: 10.5,
  color: "#64748b",
  marginBottom: 3,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  fontWeight: 600,
};
const historyHeader = {
  display: "grid",
  gridTemplateColumns: "150px 100px 90px 70px 80px 1fr 30px",
  gap: 8,
  padding: "8px 12px",
  background: "#f8fafc",
  borderBottom: "1px solid #e2e8f0",
  fontSize: 11,
  fontWeight: 600,
  color: "#475569",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};
const historyRow = {
  display: "grid",
  gridTemplateColumns: "150px 100px 90px 70px 80px 1fr 30px",
  gap: 8,
  padding: "8px 12px",
  borderBottom: "1px solid #f1f5f9",
  fontSize: 12,
  color: "#334155",
  alignItems: "center",
  cursor: "pointer",
};
const subhead = {
  fontSize: 11,
  fontWeight: 700,
  color: "#0f172a",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginBottom: 6,
};
const elementRow = {
  display: "grid",
  gridTemplateColumns: "110px 1fr 60px",
  gap: 8,
  padding: "6px 10px",
  borderBottom: "1px solid #f1f5f9",
  alignItems: "center",
};
