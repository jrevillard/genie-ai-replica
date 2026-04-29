/**
 * National Pulse — top-of-funnel aggregate view.
 * Four hero KPIs · 30-day consultation trend · top conditions ·
 * triage distribution. All aggregate, no PII.
 */

import { useMemo } from "react";
import { Users, Activity, UserCheck, TrendingUp, Info } from "lucide-react";

import { useAdminApi } from "../../admin/hooks/useAdminApi.js";


function fmt(n) {
  if (n == null) return "—";
  return Number(n).toLocaleString();
}


// ── Area chart for the 30-day trend ────────────────────

function AreaChart({ data, height = 220 }) {
  if (!data || data.length === 0) {
    return (
      <div style={{
        height, display: "flex", alignItems: "center", justifyContent: "center",
        color: "var(--gv-ink-3)", fontSize: 13,
      }}>No trend data yet.</div>
    );
  }
  const width = 800;
  const max   = Math.max(...data, 1);
  const step  = width / (data.length - 1 || 1);
  const pts   = data.map((v, i) => [i * step, height - 28 - (v / max) * (height - 60)]);
  const lineD = pts.map(([x, y], i) => (i === 0 ? `M${x} ${y}` : `L${x} ${y}`)).join(" ");
  const areaD = lineD + ` L${width} ${height - 28} L0 ${height - 28} Z`;

  // Pick 6 x-axis labels
  const axisIdx = Array.from({ length: 6 }, (_, i) => Math.round((i / 5) * (data.length - 1)));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
         width="100%" height={height} role="img" aria-label="30-day consultation trend">
      <defs>
        <linearGradient id="gvAreaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#1d4ed8" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0.00" />
        </linearGradient>
      </defs>
      {/* baseline */}
      <line x1="0" y1={height - 28} x2={width} y2={height - 28}
            stroke="#d4cdbc" strokeWidth="1" />
      {/* area */}
      <path d={areaD} fill="url(#gvAreaGrad)" />
      {/* line */}
      <path d={lineD} fill="none" stroke="#1d4ed8" strokeWidth="1.6"
            strokeLinejoin="round" strokeLinecap="round" />
      {/* last-point dot */}
      {pts.length > 0 && (
        <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]}
                r="3.5" fill="#1d4ed8" stroke="#fff" strokeWidth="1.5" />
      )}
      {/* x-axis labels */}
      {axisIdx.map((i) => (
        <text key={i}
              x={i * step}
              y={height - 8}
              textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}
              style={{
                fontFamily: "var(--a-font-mono, ui-monospace)",
                fontSize: 10,
                fill: "#94a3b8",
                letterSpacing: "0.04em",
              }}>
          D-{data.length - 1 - i}
        </text>
      ))}
    </svg>
  );
}


// ── Sparkline for KPI cards ────────────────────────────

function Sparkline({ data, width = 140, height = 30, stroke = "#1d4ed8" }) {
  if (!data || data.length === 0) return null;
  const max  = Math.max(...data, 1);
  const step = width / (data.length - 1 || 1);
  const d = data.map((v, i) => {
    const x = i * step;
    const y = height - (v / max) * (height - 4) - 2;
    return (i === 0 ? "M" : "L") + `${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg className="gv-kpi-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.4"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}


// ── KPI tile ────────────────────────────────────────────

function KpiTile({ icon: Icon, label, value, unit, delta, deltaDir, sub, spark }) {
  return (
    <div className="gv-kpi">
      <div className="gv-kpi-label">
        <Icon size={12} strokeWidth={2} />
        <span>{label}</span>
      </div>
      <div className="gv-kpi-value">
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
      <div className="gv-kpi-meta">
        {delta != null && (
          <span className={`delta ${deltaDir || "flat"}`}>
            {deltaDir === "up" ? "▲" : deltaDir === "down" ? "▼" : "—"} {delta}
          </span>
        )}
        <span>{sub}</span>
      </div>
      {spark && spark.length > 0 && (
        <Sparkline data={spark} width={200} height={32} />
      )}
    </div>
  );
}


// ── Donut (triage mix) ─────────────────────────────────

function Donut({ segments, size = 110, thickness = 14 }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r   = size / 2 - thickness / 2;
  const c   = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r}
              fill="none" stroke="var(--gv-paper-3)" strokeWidth={thickness} />
      {segments.map((s, i) => {
        const dash = (s.value / total) * c;
        const offset = c - acc;
        acc += dash;
        return (
          <circle key={i}
                  cx={size / 2} cy={size / 2} r={r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={thickness}
                  strokeDasharray={`${dash} ${c - dash}`}
                  strokeDashoffset={offset}
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                  strokeLinecap="butt" />
        );
      })}
    </svg>
  );
}


// ── Root ────────────────────────────────────────────────

export default function NationalPulse({ period = "mtd" }) {
  const { data, loading } = useAdminApi("/api/v1/gov/mv/national-pulse", { refreshMs: 60000 });

  const top       = data?.top_conditions || [];
  const triage    = data?.triage || [];
  const trend     = data?.consult_trend_30d || [];
  const triageTotal = triage.reduce((s, x) => s + x.value, 0);
  const trendSum  = useMemo(() => trend.reduce((s, v) => s + v, 0), [trend]);
  const recent7   = trend.slice(-7).reduce((s, v) => s + v, 0);
  const prior7    = trend.slice(-14, -7).reduce((s, v) => s + v, 0);
  const weekDelta = prior7 ? Math.round(((recent7 - prior7) / prior7) * 100) : 0;
  const weekDir   = weekDelta > 0 ? "up" : weekDelta < 0 ? "down" : "flat";

  const topMax = Math.max(...top.map((x) => x.value || 0), 1);

  return (
    <div className="gv-stack">
      {/* ── Authority ribbon ──────────────── */}
      <div className="gv-ribbon">
        <Info size={13} strokeWidth={2} />
        <span>
          <strong>Aggregate-only view.</strong> No patient names, phones, or identifiable
          fields are transmitted. Thresholds and cohort sizes comply with the Gambia
          Health Information Data Governance Policy § 4.2.
        </span>
        <span className="sep">·</span>
        <span>Period: {period.toUpperCase()} · refreshed 60s</span>
      </div>

      {/* ── Hero KPI strip ────────────────── */}
      <div className="gv-kpi-row">
        <KpiTile
          icon={Users}
          label="Active patients"
          value={fmt(data?.active_patients)}
          delta={weekDelta ? `${Math.abs(weekDelta)}%` : null}
          deltaDir={weekDir}
          sub={`vs prior 7d · ${period.toUpperCase()}`}
          spark={trend.slice(-14)}
        />
        <KpiTile
          icon={Activity}
          label="Consultations"
          value={fmt(data?.consults_mtd)}
          delta={trend.length >= 7 ? `${recent7}` : null}
          deltaDir="flat"
          sub="last 7 days · all channels"
          spark={trend}
        />
        <KpiTile
          icon={UserCheck}
          label="Active CHWs"
          value={fmt(data?.chw_active)}
          sub="field-certified"
        />
        <KpiTile
          icon={TrendingUp}
          label="Coverage"
          value={data?.coverage_pct != null ? data.coverage_pct : "—"}
          unit="%"
          sub="of eligible population"
        />
      </div>

      {/* ── 30-day trend + top conditions + triage ──────── */}
      <div className="gv-grid-62">
        <div className="gv-panel">
          <div className="gv-panel-head">
            <h2>
              Consultations
              <span className="count">30-day rolling</span>
            </h2>
            <div className="gv-panel-tools">
              <span className="gv-pill blue">
                <span className="dot" />
                {fmt(trendSum)} total
              </span>
            </div>
          </div>
          <div className="gv-panel-body">
            <div className="gv-chart-total">{fmt(trendSum)}</div>
            <div className="gv-chart-caption">Total · last 30 days</div>
            <div style={{ marginTop: 16 }}>
              <AreaChart data={trend} height={220} />
            </div>
          </div>
        </div>

        <div className="gv-stack">
          <div className="gv-panel">
            <div className="gv-panel-head">
              <h2>Top conditions <span className="count">MTD</span></h2>
            </div>
            <div className="gv-panel-body">
              <div className="gv-hbar">
                {top.map((c) => (
                  <div className="gv-hbar-row" key={c.label}>
                    <span className="gv-hbar-label">{c.label}</span>
                    <span className="gv-hbar-value">{c.value.toLocaleString()}</span>
                    <div className="gv-hbar-track">
                      <div className="gv-hbar-fill"
                           style={{ width: `${Math.round((c.value / topMax) * 100)}%` }} />
                    </div>
                  </div>
                ))}
                {top.length === 0 && (
                  <div style={{ fontSize: 12, color: "var(--gv-ink-3)", textAlign: "center", padding: 12 }}>
                    No condition data yet.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="gv-panel">
            <div className="gv-panel-head">
              <h2>Triage mix</h2>
              <span className="gv-pill">{triageTotal}% acuity</span>
            </div>
            <div className="gv-panel-body">
              <div className="gv-donut-wrap">
                <div style={{ position: "relative", width: 110, height: 110 }}>
                  <Donut
                    segments={triage.length ? triage : [{ value: 1, color: "var(--gv-paper-3)" }]}
                    size={110}
                    thickness={14}
                  />
                  <div style={{
                    position: "absolute", inset: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <div className="gv-donut-center">{triageTotal}%</div>
                  </div>
                </div>
                <div className="gv-donut-legend">
                  {triage.map((s) => (
                    <div className="gv-donut-legend-row" key={s.label}>
                      <span className="swatch" style={{ background: s.color }} />
                      <span className="label">{s.label}</span>
                      <span className="value">{s.value}%</span>
                    </div>
                  ))}
                  {triage.length === 0 && (
                    <div style={{ fontSize: 12, color: "var(--gv-ink-3)" }}>—</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {!data && !loading && (
        <div className="gv-note">
          <strong>Observatory backend not reachable.</strong> Set{" "}
          <code>CHATQNA_ADMIN_MV_OPEN=true</code> for development, or sign in
          with an MoH account to load the national pulse.
        </div>
      )}
    </div>
  );
}
