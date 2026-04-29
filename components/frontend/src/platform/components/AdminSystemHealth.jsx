import { useState, useEffect, useCallback } from "react";
import { adminHealthApi } from "../api/platformApi";

const S = {
  container: { padding: 24, fontFamily: "inherit", maxWidth: 1200, margin: "0 auto" },
  tabs: { display: "flex", gap: 2, marginBottom: 20, borderBottom: "2px solid #e2e8f0" },
  tab: {
    padding: "10px 20px", cursor: "pointer", fontSize: 14, fontWeight: 500,
    color: "#64748b", border: "none", background: "none",
    borderBottom: "2px solid transparent", marginBottom: -2,
    transition: "all 0.15s",
  },
  tabActive: { color: "#1d4ed8", borderBottomColor: "#3b82f6" },
  card: {
    background: "#fff", borderRadius: 12, padding: 20, marginBottom: 16,
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: "1px solid #f1f5f9",
  },
  title: { fontSize: 15, fontWeight: 600, color: "#1e293b", marginBottom: 12 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 },
  stat: { padding: 12, background: "#f8fafc", borderRadius: 8 },
  statLabel: { fontSize: 11, color: "#94a3b8", textTransform: "uppercase" },
  statVal: { fontSize: 20, fontWeight: 700, color: "#1e293b", marginTop: 2 },
  dot: (color) => ({
    display: "inline-block", width: 8, height: 8, borderRadius: "50%",
    background: color, marginRight: 6,
  }),
  logRow: {
    padding: "8px 12px", borderBottom: "1px solid #f1f5f9", fontSize: 13,
    display: "flex", gap: 12, alignItems: "center",
  },
  logLevel: (level) => ({
    fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 4,
    background:
      level === "ERROR" ? "#fef2f2" : level === "WARNING" ? "#fffbeb" : "#f0fdf4",
    color:
      level === "ERROR" ? "#dc2626" : level === "WARNING" ? "#d97706" : "#16a34a",
  }),
  logTime: { color: "#94a3b8", fontSize: 11, minWidth: 140 },
  logMsg: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  filterBar: {
    display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap",
  },
  filterSelect: {
    padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 6,
    fontSize: 13, background: "#fff",
  },
  filterInput: {
    padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 6,
    fontSize: 13, flex: 1, minWidth: 180,
  },
  btn: {
    padding: "6px 14px", border: "none", borderRadius: 6, cursor: "pointer",
    fontSize: 13, fontWeight: 500,
  },
  btnPrimary: { background: "#3b82f6", color: "#fff" },
  btnDanger: { background: "#ef4444", color: "#fff" },
  btnSecondary: { background: "#f1f5f9", color: "#334155" },
  secMetric: {
    display: "flex", justifyContent: "space-between", padding: "10px 0",
    borderBottom: "1px solid #f1f5f9", fontSize: 14,
  },
  empty: { color: "#94a3b8", textAlign: "center", padding: 32 },
};

function HealthTab() {
  const [health, setHealth] = useState(null);
  const [diag, setDiag] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.allSettled([
      adminHealthApi.systemHealth().catch(() => null),
    ]).then(([h]) => {
      setHealth(h.status === "fulfilled" ? h.value : null);
      setLoading(false);
    });
  }, []);

  const runDiag = async () => {
    setDiag("running...");
    try {
      const r = await adminHealthApi.runDiagnostics();
      setDiag(r);
    } catch (e) {
      setDiag({ error: e.message });
    }
  };

  if (loading) return <div style={S.empty}>Loading system health...</div>;

  const h = health || {};
  const services = h.services || h.components || {};

  return (
    <div>
      <div style={S.card}>
        <div style={S.title}>System Status</div>
        <div style={S.grid}>
          <div style={S.stat}>
            <div style={S.statLabel}>Overall</div>
            <div style={S.statVal}>
              <span style={S.dot(h.status === "healthy" ? "#16a34a" : "#eab308")} />
              {h.status || "Unknown"}
            </div>
          </div>
          <div style={S.stat}>
            <div style={S.statLabel}>Uptime</div>
            <div style={S.statVal}>{h.uptime || "—"}</div>
          </div>
          <div style={S.stat}>
            <div style={S.statLabel}>CPU</div>
            <div style={S.statVal}>{h.cpu || h.cpuUsage || "—"}</div>
          </div>
          <div style={S.stat}>
            <div style={S.statLabel}>Memory</div>
            <div style={S.statVal}>{h.memory || h.memoryUsage || "—"}</div>
          </div>
        </div>
      </div>

      {Object.keys(services).length > 0 && (
        <div style={S.card}>
          <div style={S.title}>Services</div>
          {Object.entries(services).map(([name, status]) => (
            <div key={name} style={S.secMetric}>
              <span>{name}</span>
              <span>
                <span
                  style={S.dot(
                    status === "up" || status === "healthy" || status === true
                      ? "#16a34a"
                      : "#dc2626"
                  )}
                />
                {typeof status === "object" ? status.status || "—" : String(status)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={S.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={S.title}>Diagnostics</div>
          <button style={{ ...S.btn, ...S.btnPrimary }} onClick={runDiag}>
            Run Diagnostics
          </button>
        </div>
        {diag && (
          <pre style={{ background: "#f8fafc", padding: 12, borderRadius: 8, fontSize: 12, overflow: "auto", maxHeight: 200 }}>
            {typeof diag === "string" ? diag : JSON.stringify(diag, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

function LogsTab() {
  const [logs, setLogs] = useState([]);
  const [level, setLevel] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const opts = {};
      if (level) opts.level = level;
      if (search) opts.search = search;
      const data = await adminHealthApi.searchLogs(opts);
      setLogs(Array.isArray(data) ? data : data?.logs || data?.results || []);
    } catch (e) {
      console.warn("[Logs] load failed:", e);
    }
    setLoading(false);
  }, [level, search]);

  useEffect(() => { load(); }, []);

  const rollover = async () => {
    if (!confirm("Rollover logs?")) return;
    try {
      await adminHealthApi.rolloverLogs();
      load();
    } catch (e) {
      console.warn("[Logs] rollover failed:", e);
    }
  };

  return (
    <div>
      <div style={S.filterBar}>
        <select style={S.filterSelect} value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="">All Levels</option>
          <option value="ERROR">Error</option>
          <option value="WARNING">Warning</option>
          <option value="INFO">Info</option>
        </select>
        <input
          style={S.filterInput}
          placeholder="Search logs..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
        />
        <button style={{ ...S.btn, ...S.btnPrimary }} onClick={load}>
          Search
        </button>
        <button style={{ ...S.btn, ...S.btnSecondary }} onClick={rollover}>
          Rollover
        </button>
      </div>

      <div style={S.card}>
        {loading && <div style={S.empty}>Loading...</div>}
        {!loading && logs.length === 0 && <div style={S.empty}>No logs found</div>}
        {logs.slice(0, 100).map((log, i) => (
          <div key={i} style={S.logRow}>
            <span style={S.logLevel(log.level || "INFO")}>{log.level || "INFO"}</span>
            <span style={S.logTime}>{log.timestamp || log.time || ""}</span>
            <span style={S.logMsg}>{log.message || log.msg || JSON.stringify(log)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SecurityTab() {
  const [metrics, setMetrics] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);

  useEffect(() => {
    adminHealthApi.securityMetrics().then(setMetrics).catch(() => {});
  }, []);

  const runScan = async () => {
    setScanning(true);
    try {
      const r = await adminHealthApi.runSecurityScan();
      setScanResult(r);
    } catch (e) {
      setScanResult({ error: e.message });
    }
    setScanning(false);
  };

  const m = metrics || {};
  const items = [
    { label: "Failed Logins (24h)", value: m.failedLogins ?? m.failed_logins ?? "—" },
    { label: "Suspicious Activities", value: m.suspiciousActivities ?? m.suspicious ?? "—" },
    { label: "Active Sessions", value: m.activeSessions ?? m.active_sessions ?? "—" },
    { label: "Token Refresh Rate", value: m.tokenRefreshRate ?? "—" },
    { label: "Last Scan", value: m.lastScan ?? m.last_scan ?? "Never" },
  ];

  return (
    <div>
      <div style={S.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={S.title}>Security Metrics</div>
          <button
            style={{ ...S.btn, ...S.btnDanger }}
            onClick={runScan}
            disabled={scanning}
          >
            {scanning ? "Scanning..." : "Run Security Scan"}
          </button>
        </div>
        {items.map((item, i) => (
          <div key={i} style={S.secMetric}>
            <span style={{ color: "#475569" }}>{item.label}</span>
            <span style={{ fontWeight: 600 }}>{item.value}</span>
          </div>
        ))}
      </div>

      {scanResult && (
        <div style={S.card}>
          <div style={S.title}>Scan Results</div>
          <pre style={{ background: "#f8fafc", padding: 12, borderRadius: 8, fontSize: 12, overflow: "auto", maxHeight: 300 }}>
            {JSON.stringify(scanResult, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function AdminSystemHealth() {
  const [tab, setTab] = useState("health");

  const tabs = [
    { key: "health", label: "System Health" },
    { key: "logs", label: "Logs" },
    { key: "security", label: "Security" },
  ];

  return (
    <div style={S.container}>
      <div style={S.tabs}>
        {tabs.map((t) => (
          <button
            key={t.key}
            style={{ ...S.tab, ...(tab === t.key ? S.tabActive : {}) }}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "health" && <HealthTab />}
      {tab === "logs" && <LogsTab />}
      {tab === "security" && <SecurityTab />}
    </div>
  );
}
