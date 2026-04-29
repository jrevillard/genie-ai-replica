import { useState, useEffect } from "react";
import { analyticsApi, outcomesApi } from "../api/platformApi";

const S = {
  container: {
    padding: 24, maxWidth: 1200, margin: "0 auto", fontFamily: "inherit",
  },
  header: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    marginBottom: 24,
  },
  title: { fontSize: 20, fontWeight: 700, color: "#1e293b" },
  periodSelector: {
    display: "flex", gap: 4, background: "#f1f5f9", borderRadius: 8, padding: 3,
  },
  periodBtn: {
    padding: "6px 14px", border: "none", borderRadius: 6, cursor: "pointer",
    fontSize: 13, background: "transparent", color: "#64748b",
    transition: "all 0.15s",
  },
  periodActive: { background: "#fff", color: "#1e293b", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" },
  grid: {
    display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: 16, marginBottom: 24,
  },
  card: {
    background: "#fff", borderRadius: 12, padding: 20,
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: "1px solid #f1f5f9",
  },
  cardTitle: { fontSize: 12, color: "#94a3b8", textTransform: "uppercase", marginBottom: 4 },
  cardValue: { fontSize: 28, fontWeight: 700, color: "#1e293b" },
  cardChange: { fontSize: 12, marginTop: 4 },
  chartArea: {
    background: "#fff", borderRadius: 12, padding: 20,
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: "1px solid #f1f5f9",
    marginBottom: 16,
  },
  chartTitle: { fontSize: 14, fontWeight: 600, color: "#1e293b", marginBottom: 16 },
  bar: {
    display: "flex", alignItems: "flex-end", gap: 3, height: 120,
    padding: "0 4px",
  },
  barItem: {
    flex: 1, background: "#3b82f6", borderRadius: "4px 4px 0 0",
    minHeight: 4, transition: "height 0.3s",
  },
  heatRow: { display: "flex", gap: 2, marginBottom: 2 },
  heatCell: {
    width: 28, height: 28, borderRadius: 4, display: "flex",
    alignItems: "center", justifyContent: "center", fontSize: 10,
    color: "#fff", fontWeight: 600,
  },
  gauge: {
    width: 160, height: 80, margin: "0 auto", position: "relative",
  },
  gaugeLabel: {
    textAlign: "center", fontSize: 12, color: "#64748b", marginTop: 8,
  },
  row2: {
    display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16,
  },
  topQuery: {
    display: "flex", justifyContent: "space-between", padding: "8px 0",
    borderBottom: "1px solid #f1f5f9", fontSize: 13,
  },
  empty: { color: "#94a3b8", textAlign: "center", padding: 32, fontSize: 14 },
};

function TrendArrow({ value }) {
  if (!value && value !== 0) return null;
  const up = value >= 0;
  return (
    <span style={{ ...S.cardChange, color: up ? "#16a34a" : "#dc2626" }}>
      {up ? "▲" : "▼"} {Math.abs(value).toFixed(1)}%
    </span>
  );
}

function MiniBarChart({ data, color = "#3b82f6" }) {
  if (!data || data.length === 0) return <div style={S.empty}>No data</div>;
  const max = Math.max(...data.map((d) => d.value || 0), 1);
  return (
    <div>
      <div style={S.bar}>
        {data.map((d, i) => (
          <div
            key={i}
            style={{
              ...S.barItem,
              height: `${((d.value || 0) / max) * 100}%`,
              background: color,
            }}
            title={`${d.label || i}: ${d.value}`}
          />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#94a3b8", marginTop: 4 }}>
        {data.length > 0 && <span>{data[0].label}</span>}
        {data.length > 1 && <span>{data[data.length - 1].label}</span>}
      </div>
    </div>
  );
}

function SatisfactionGauge({ score }) {
  const pct = Math.min(Math.max(score || 0, 0), 100);
  const color = pct >= 80 ? "#16a34a" : pct >= 60 ? "#eab308" : "#dc2626";
  return (
    <div>
      <div style={S.gauge}>
        <svg viewBox="0 0 160 80" style={{ width: "100%", height: "100%" }}>
          <path d="M 10 75 A 65 65 0 0 1 150 75" fill="none" stroke="#e2e8f0" strokeWidth="12" strokeLinecap="round" />
          <path
            d="M 10 75 A 65 65 0 0 1 150 75"
            fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * 204} 204`}
          />
          <text x="80" y="70" textAnchor="middle" fontSize="22" fontWeight="700" fill="#1e293b">
            {pct.toFixed(0)}
          </text>
        </svg>
      </div>
      <div style={S.gaugeLabel}>Satisfaction Score</div>
    </div>
  );
}

function Heatmap({ data }) {
  if (!data || data.length === 0) return <div style={S.empty}>No heatmap data</div>;
  const getColor = (val) => {
    if (val >= 4) return "#16a34a";
    if (val >= 3) return "#65a30d";
    if (val >= 2) return "#eab308";
    if (val >= 1) return "#f97316";
    return "#dc2626";
  };
  return (
    <div>
      {data.slice(0, 7).map((row, ri) => (
        <div key={ri} style={S.heatRow}>
          <span style={{ width: 60, fontSize: 11, color: "#64748b", lineHeight: "28px" }}>
            {row.label || `Row ${ri}`}
          </span>
          {(row.values || []).slice(0, 8).map((v, ci) => (
            <div key={ci} style={{ ...S.heatCell, background: getColor(v) }}>
              {v?.toFixed?.(1) || v}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function AnalyticsDashboard() {
  const [period, setPeriod] = useState("monthly");
  const [dashData, setDashData] = useState(null);
  const [heatmap, setHeatmap] = useState(null);
  const [gaugeScore, setGaugeScore] = useState(null);
  const [engagement, setEngagement] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.allSettled([
      analyticsApi.dashboard(period).catch(() => null),
      analyticsApi.satisfactionHeatmap(period).catch(() => null),
      analyticsApi.satisfactionGauge(period).catch(() => null),
      outcomesApi.engagementTrend(90).catch(() => null),
    ]).then(([dash, heat, gauge, eng]) => {
      setDashData(dash.status === "fulfilled" ? dash.value : null);
      setHeatmap(heat.status === "fulfilled" ? heat.value : null);
      setGaugeScore(gauge.status === "fulfilled" ? gauge.value : null);
      setEngagement(eng.status === "fulfilled" ? eng.value : null);
      setLoading(false);
    });
  }, [period]);

  const metrics = dashData?.metrics || dashData || {};
  const kpis = [
    { label: "Total Queries", value: metrics.totalQueries ?? metrics.total_queries ?? "—", change: metrics.queryChange },
    { label: "Unique Users", value: metrics.uniqueUsers ?? metrics.unique_users ?? "—", change: metrics.userChange },
    { label: "Avg Response Time", value: metrics.avgResponseTime ? `${metrics.avgResponseTime}ms` : "—", change: metrics.responseTimeChange },
    { label: "Satisfaction", value: metrics.satisfaction ? `${metrics.satisfaction}%` : "—", change: metrics.satisfactionChange },
  ];

  const engBuckets = (engagement?.buckets || []).map((b) => ({
    label: b.week_start?.slice(5) || "",
    value: b.total_messages || 0,
  }));

  const topQueries = metrics.topQueries || metrics.top_queries || [];

  if (loading) {
    return (
      <div style={S.container}>
        <div style={S.empty}>Loading analytics...</div>
      </div>
    );
  }

  return (
    <div style={S.container}>
      <div style={S.header}>
        <span style={S.title}>Analytics Dashboard</span>
        <div style={S.periodSelector}>
          {["daily", "weekly", "monthly", "all"].map((p) => (
            <button
              key={p}
              style={{ ...S.periodBtn, ...(period === p ? S.periodActive : {}) }}
              onClick={() => setPeriod(p)}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div style={S.grid}>
        {kpis.map((k, i) => (
          <div key={i} style={S.card}>
            <div style={S.cardTitle}>{k.label}</div>
            <div style={S.cardValue}>{k.value}</div>
            <TrendArrow value={k.change} />
          </div>
        ))}
      </div>

      <div style={S.row2}>
        <div style={S.chartArea}>
          <div style={S.chartTitle}>Engagement Trend (Weekly)</div>
          <MiniBarChart data={engBuckets} color="#3b82f6" />
        </div>

        <div style={S.chartArea}>
          <div style={S.chartTitle}>Satisfaction</div>
          <SatisfactionGauge score={gaugeScore?.score ?? metrics.satisfaction ?? 0} />
        </div>
      </div>

      <div style={S.row2}>
        <div style={S.chartArea}>
          <div style={S.chartTitle}>Satisfaction Heatmap</div>
          <Heatmap data={heatmap?.data || heatmap?.rows || []} />
        </div>

        <div style={S.chartArea}>
          <div style={S.chartTitle}>Top Queries</div>
          {topQueries.length > 0 ? (
            topQueries.slice(0, 8).map((q, i) => (
              <div key={i} style={S.topQuery}>
                <span>{q.text || q.query || q}</span>
                <span style={{ color: "#94a3b8" }}>{q.count || ""}</span>
              </div>
            ))
          ) : (
            <div style={S.empty}>No query data</div>
          )}
        </div>
      </div>

      {metrics.categoryDistribution && (
        <div style={S.chartArea}>
          <div style={S.chartTitle}>Category Distribution</div>
          <MiniBarChart
            data={Object.entries(metrics.categoryDistribution).map(([k, v]) => ({
              label: k,
              value: v,
            }))}
            color="#8b5cf6"
          />
        </div>
      )}
    </div>
  );
}
