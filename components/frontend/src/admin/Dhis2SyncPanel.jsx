/**
 * DHIS2 Sync Admin Panel
 * =======================
 * Shows config status, live daily metrics, last sync, manual trigger + dry-run.
 * Part of the AMINA Care → DHIS2 integration roadmap (Phase 1 polish).
 */

import { useEffect, useState, useCallback } from "react";

const API = (window.AMINA_API || "http://localhost:8000").replace(/\/+$/, "");

function authH(token) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

const C = {
  card:   "#ffffff",
  border: "#e2e8f0",
  text:   "#0f172a",
  muted:  "#64748b",
  accent: "#6366f1",
  green:  "#10b981",
  red:    "#ef4444",
  amber:  "#f59e0b",
  bg:     "#f8fafc",
};

function StatusPill({ ok, label }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
      background: ok ? "#f0fdf4" : "#fef2f2",
      color:      ok ? "#15803d" : "#b91c1c",
      border: `1px solid ${ok ? "#bbf7d0" : "#fecaca"}`,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%",
        background: ok ? C.green : C.red,
      }} />
      {label}
    </span>
  );
}

function MetricBar({ label, value, max }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
        <span style={{ color: C.muted }}>{label}</span>
        <span style={{ color: C.text }}>{value}</span>
      </div>
      <div style={{ height: 6, background: C.bg, borderRadius: 4, overflow: "hidden" }}>
        <div style={{
          width: `${pct}%`, height: "100%",
          background: `linear-gradient(90deg,${C.accent},#818cf8)`,
          transition: "width .3s",
        }} />
      </div>
    </div>
  );
}

export default function Dhis2SyncPanel({ token }) {
  const [config, setConfig]   = useState(null);
  const [todayMetrics, setTM] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [dayInput, setDayInput] = useState("");
  const [result, setResult]   = useState(null);
  const [error, setError]     = useState("");

  const fetchAll = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [c, m, s] = await Promise.all([
        fetch(`${API}/api/v1/dhis2/config`,         { headers: authH(token) }).then(r => r.ok ? r.json() : null),
        fetch(`${API}/api/v1/dhis2/metrics/today`,  { headers: authH(token) }).then(r => r.ok ? r.json() : null),
        fetch(`${API}/api/v1/dhis2/sync/status`,    { headers: authH(token) }).then(r => r.ok ? r.json() : null),
      ]);
      setConfig(c); setTM(m); setLastSync(s);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const runAction = async (endpoint, label) => {
    setRunning(true); setError(""); setResult(null);
    try {
      const r = await fetch(`${API}/api/v1/dhis2/${endpoint}`, {
        method: "POST",
        headers: authH(token),
        body: JSON.stringify(dayInput ? { day: dayInput } : {}),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error || "Request failed");
      setResult({ label, data: d });
      fetchAll();
    } catch (e) { setError(e.message); }
    finally { setRunning(false); }
  };

  if (loading && !config) {
    return <div style={{ color: C.muted, padding: 40, textAlign: "center" }}>Loading DHIS2 status…</div>;
  }

  const cfg = config || {};
  const configured = !!cfg.configured;
  const orgUnitCount = Object.keys(cfg.orgunit_mapping || {}).length;
  const deCount      = Object.keys(cfg.dataelement_mapping || {}).length;

  const totals = todayMetrics?.totals || {};
  const maxMetric = Math.max(1, ...Object.values(totals));
  const ls = lastSync?.last_sync;

  const prettyDate = (iso) => {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      return d.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
    } catch { return iso; }
  };

  return (
    <div style={{ fontFamily: "Outfit, sans-serif", color: C.text }}>
      <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 6 }}>DHIS2 Integration</h2>
      <p style={{ color: C.muted, fontSize: 14, marginBottom: 24 }}>
        AMINA Care → Gambia MoH health information system · Aggregate push (Phase 1)
      </p>

      {/* Config status card */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 16,
        padding: 20, marginBottom: 20, boxShadow: "0 1px 3px rgba(0,0,0,.04)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 4 }}>
              Configuration
            </div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{cfg.base_url || "(not set)"}</div>
          </div>
          <StatusPill ok={configured} label={configured ? "CONFIGURED" : "NOT CONFIGURED"} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, fontSize: 13 }}>
          <div>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>Auth</div>
            <div>{cfg.auth_method || "none"}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>Dataset</div>
            <div>{cfg.dataset_id || "—"}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>Org Units</div>
            <div>{orgUnitCount} mapped</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>Data Elements</div>
            <div>{deCount} of {(cfg.metric_keys || []).length}</div>
          </div>
        </div>
      </div>

      {/* Two-column layout: live metrics + last sync */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
        {/* Live metrics */}
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 16,
          padding: 20,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 800 }}>Today's Metrics (live)</div>
            <div style={{ fontSize: 11, color: C.muted }}>
              {todayMetrics?.period ? `period ${todayMetrics.period}` : ""}
            </div>
          </div>
          {(cfg.metric_keys || []).map(k => (
            <MetricBar
              key={k}
              label={k.replace("AMINA_", "").replace(/_/g, " ")}
              value={totals[k] || 0}
              max={maxMetric}
            />
          ))}
        </div>

        {/* Last sync */}
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 16,
          padding: 20,
        }}>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 14 }}>Last Sync</div>
          {ls ? (
            <>
              <div style={{ marginBottom: 12 }}>
                <StatusPill ok={ls.ok} label={ls.ok ? "SUCCESS" : "FAILED"} />
              </div>
              <div style={{ display: "grid", gap: 10, fontSize: 13 }}>
                <div>
                  <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>When</div>
                  <div>{prettyDate(ls.at)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>Period pushed</div>
                  <div>{ls.period || "—"}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>Values</div>
                  <div>{ls.value_count}</div>
                </div>
                {ls.warnings && ls.warnings.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10, color: C.amber, fontWeight: 700, textTransform: "uppercase" }}>Warnings</div>
                    <ul style={{ margin: 0, paddingLeft: 16, color: "#92400e", fontSize: 12 }}>
                      {ls.warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div style={{ color: C.muted, fontSize: 13 }}>No syncs recorded yet.</div>
          )}
        </div>
      </div>

      {/* Action bar */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 16,
        padding: 20, marginBottom: 20,
      }}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 14 }}>Manual Actions</div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>
              Day to sync (optional)
            </div>
            <input
              type="date"
              value={dayInput}
              onChange={e => setDayInput(e.target.value)}
              style={{
                padding: "9px 12px", borderRadius: 8,
                border: `1px solid ${C.border}`, fontSize: 13, fontFamily: "inherit",
              }}
            />
          </div>
          <button
            onClick={() => runAction("sync/dry-run", "Dry run")}
            disabled={running}
            style={{
              padding: "10px 18px", borderRadius: 10, border: `1px solid ${C.accent}`,
              background: "#eef2ff", color: C.accent, fontWeight: 700, fontSize: 13,
              cursor: running ? "default" : "pointer",
              marginTop: 20,
            }}
          >
            {running ? "Running…" : "Dry Run"}
          </button>
          <button
            onClick={() => runAction("sync/manual", "Manual sync")}
            disabled={running || !configured}
            title={configured ? "" : "DHIS2 not configured — set env vars first"}
            style={{
              padding: "10px 18px", borderRadius: 10, border: "none",
              background: configured
                ? `linear-gradient(135deg,${C.accent},#818cf8)`
                : "#cbd5e1",
              color: "#fff", fontWeight: 700, fontSize: 13,
              cursor: (running || !configured) ? "default" : "pointer",
              marginTop: 20,
            }}
          >
            {running ? "Pushing…" : "Push Now"}
          </button>
          <button
            onClick={fetchAll}
            disabled={running}
            style={{
              padding: "10px 18px", borderRadius: 10, border: `1px solid ${C.border}`,
              background: "#fff", color: C.muted, fontWeight: 600, fontSize: 13,
              cursor: "pointer", marginTop: 20,
            }}
          >
            Refresh
          </button>
        </div>
        {!configured && (
          <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 8,
            background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", fontSize: 12 }}>
            Set <code>DHIS2_BASE_URL</code>, <code>DHIS2_USERNAME</code>+<code>DHIS2_PASSWORD</code> (or <code>DHIS2_API_TOKEN</code>), plus org-unit and data-element mappings in the backend <code>.env</code> file, then restart <code>haystack-chatqna</code>.
            See <code>docs/DHIS2_INTEGRATION.md</code>.
          </div>
        )}
      </div>

      {/* Result display */}
      {error && (
        <div style={{
          background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12,
          padding: "12px 16px", marginBottom: 16, color: C.red, fontSize: 13,
        }}>
          {error}
        </div>
      )}
      {result && (
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 16,
          padding: 20,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 800 }}>{result.label} result</div>
            <button onClick={() => setResult(null)} style={{
              background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 18,
            }}>×</button>
          </div>
          <pre style={{
            background: "#0f172a", color: "#e2e8f0",
            padding: 14, borderRadius: 8, fontSize: 11, overflowX: "auto",
            maxHeight: 400, margin: 0,
          }}>
            {JSON.stringify(result.data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
