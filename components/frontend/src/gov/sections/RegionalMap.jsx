/**
 * Regions — schematic map of The Gambia's seven administrative regions.
 *
 * The real borders are very narrow and elongated; a literal rendering
 * is hard to read at dashboard scale. This schematic preserves the
 * west-to-east arrangement along the Gambia River while giving each
 * region a clickable, legible shape.
 */

import { useMemo, useState } from "react";
import { MapPin, Users, TrendingUp, Activity, AlertTriangle } from "lucide-react";

import { useAdminApi } from "../../admin/hooks/useAdminApi.js";


// Schematic positions — viewBox 520 × 260
const REGION_SHAPES = {
  BJL: { x: 52,  y: 155, r: 18, label: "Banjul"        },
  KMC: { x: 84,  y: 160, r: 26, label: "Kanifing"      },
  WCR: { x: 118, y: 200, r: 48, label: "West Coast"    },
  NBR: { x: 190, y: 100, r: 56, label: "North Bank"    },
  LRR: { x: 228, y: 195, r: 42, label: "Lower River"   },
  CRR: { x: 324, y: 150, r: 60, label: "Central River" },
  URR: { x: 450, y: 155, r: 56, label: "Upper River"   },
};


function Sparkline({ data, width = 180, height = 36, stroke = "#1d4ed8" }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data, 1);
  const step = width / (data.length - 1 || 1);
  const d = data.map((v, i) => {
    const x = i * step;
    const y = height - (v / max) * (height - 6) - 3;
    return (i === 0 ? "M" : "L") + `${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.4"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}


function coverageFill(pct) {
  // Five-step choropleth from pale blue to deep blue
  if (pct >= 80) return "#1e3a8a";
  if (pct >= 60) return "#2563eb";
  if (pct >= 40) return "#60a5fa";
  if (pct >= 20) return "#93c5fd";
  return "#dbeafe";
}


export default function RegionalMap({ period = "mtd" }) {
  const { data } = useAdminApi("/api/v1/gov/mv/regional", { refreshMs: 60000 });
  const regions  = data?.regions || [];
  const [selected, setSelected] = useState(null);

  const byCode = useMemo(() => {
    const m = {};
    regions.forEach((r) => { m[r.code] = r; });
    return m;
  }, [regions]);

  const sel = selected ? byCode[selected] : null;
  const anomalies = regions.filter((r) => r.anomaly);

  return (
    <div className="gv-stack">
      {/* Ribbon */}
      <div className="gv-ribbon">
        <MapPin size={13} strokeWidth={2} />
        <span>
          <strong>Seven regions · {regions.length ? regions.length : "—"} reporting.</strong>{" "}
          Coverage is share of estimated eligible population that has had at least one
          consultation this period. Click any region for drill-in detail.
        </span>
        {anomalies.length > 0 && (
          <>
            <span className="sep">·</span>
            <span className="gv-pill alert">
              <AlertTriangle size={10} strokeWidth={2.4} />
              {anomalies.length} outbreak signal{anomalies.length === 1 ? "" : "s"}
            </span>
          </>
        )}
      </div>

      <div className="gv-grid-62">
        {/* Left — map + legend */}
        <div className="gv-panel">
          <div className="gv-panel-head">
            <h2>
              The Gambia · by region
              <span className="count">choropleth · coverage %</span>
            </h2>
            <div className="gv-panel-tools">
              <span className="gv-pill">W → E along the Gambia river</span>
            </div>
          </div>
          <div className="gv-panel-body">
            <div className="gv-map">
              <svg viewBox="0 0 520 260" width="100%" height="100%"
                   role="img" aria-label="Schematic map of The Gambia">
                {/* River Gambia */}
                <defs>
                  <linearGradient id="gvRiver" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%"   stopColor="#38bdf8" stopOpacity="0.55" />
                    <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.25" />
                  </linearGradient>
                </defs>
                <path d="M 18 165 Q 120 158, 220 170 T 500 162"
                      stroke="url(#gvRiver)" strokeWidth="10"
                      fill="none" strokeLinecap="round" />
                <text x="490" y="180"
                      style={{
                        fontFamily: "var(--a-font-mono, ui-monospace)",
                        fontSize: 8, fill: "#0e7490",
                        letterSpacing: "0.12em", textAnchor: "end",
                      }}>Gambia River</text>

                {/* Regions */}
                {Object.entries(REGION_SHAPES).map(([code, s]) => {
                  const r = byCode[code];
                  if (!r) return (
                    <g key={code}>
                      <circle cx={s.x} cy={s.y} r={s.r}
                              fill="#eeeae0"
                              stroke="#d4cdbc" strokeWidth="1" />
                      <text x={s.x} y={s.y + 4} textAnchor="middle"
                            style={{ fontSize: 9, fill: "#94a3b8",
                                     fontFamily: "var(--a-font-ui, sans-serif)" }}>
                        {s.label}
                      </text>
                    </g>
                  );
                  const fill  = coverageFill(r.coverage_pct || 0);
                  const isSel = selected === code;
                  return (
                    <g key={code} onClick={() => setSelected(isSel ? null : code)}
                       style={{ cursor: "pointer" }}>
                      <circle cx={s.x} cy={s.y} r={s.r}
                              fill={fill}
                              fillOpacity={isSel ? 1 : 0.88}
                              stroke={isSel ? "#0a1535"
                                    : r.anomaly ? "#b91c1c"
                                    : "rgba(10, 21, 53, 0.15)"}
                              strokeWidth={isSel ? 2.5 : r.anomaly ? 2 : 1}
                              style={{ transition: "all 220ms ease" }} />
                      {r.anomaly && (
                        <circle cx={s.x + s.r - 8} cy={s.y - s.r + 8} r="5"
                                fill="#b91c1c" stroke="#fff" strokeWidth="1.5">
                          <title>Outbreak signal — see Surveillance</title>
                        </circle>
                      )}
                      <text x={s.x} y={s.y - 2} textAnchor="middle"
                            style={{
                              fontSize: 11, fontWeight: 700,
                              fill: r.coverage_pct >= 40 ? "#fff" : "#0a1535",
                              fontFamily: "var(--a-font-ui, sans-serif)",
                              pointerEvents: "none",
                            }}>
                        {s.label}
                      </text>
                      <text x={s.x} y={s.y + 11} textAnchor="middle"
                            style={{
                              fontSize: 10,
                              fill: r.coverage_pct >= 40 ? "rgba(255,255,255,0.88)" : "#475569",
                              fontFamily: "var(--a-font-mono, ui-monospace)",
                              pointerEvents: "none",
                            }}>
                        {r.coverage_pct}%
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
            <div className="gv-map-legend">
              <span>Coverage</span>
              <span className="swatches">
                {["#dbeafe", "#93c5fd", "#60a5fa", "#2563eb", "#1e3a8a"].map((c) => (
                  <span key={c} className="sw" style={{ background: c }} />
                ))}
              </span>
              <span>0% — 100%</span>
              {anomalies.length > 0 && (
                <span style={{ marginLeft: 18 }}>
                  <span style={{
                    display: "inline-block", width: 8, height: 8,
                    borderRadius: "50%", background: "#b91c1c",
                    verticalAlign: -1, marginRight: 4,
                  }} />
                  Outbreak signal (above 2σ)
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right — selected region detail OR ranked list */}
        {sel ? (
          <div className="gv-panel">
            <div className="gv-panel-head">
              <h2>
                {sel.name}
                <span className="count">{sel.code}</span>
              </h2>
              {sel.anomaly
                ? <span className="gv-pill alert"><AlertTriangle size={10} strokeWidth={2.4} />Outbreak</span>
                : <span className="gv-pill ok"><span className="dot" />Nominal</span>}
            </div>
            <div className="gv-panel-body">
              <div className="gv-grid-2" style={{ marginBottom: 18 }}>
                <div>
                  <div style={{
                    fontFamily: "var(--a-font-mono, ui-monospace)",
                    fontSize: 10, letterSpacing: "0.18em",
                    textTransform: "uppercase", color: "var(--gv-ink-3)",
                    marginBottom: 4,
                  }}>Population</div>
                  <div style={{
                    fontFamily: "var(--a-font-mono, ui-monospace)",
                    fontSize: 22, color: "var(--gv-ink)",
                    letterSpacing: "-0.005em", fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                  }}>
                    {sel.population_k?.toLocaleString()}<span style={{ fontSize: 13, color: "var(--gv-ink-3)", marginLeft: 4 }}>k</span>
                  </div>
                </div>
                <div>
                  <div style={{
                    fontFamily: "var(--a-font-mono, ui-monospace)",
                    fontSize: 10, letterSpacing: "0.18em",
                    textTransform: "uppercase", color: "var(--gv-ink-3)",
                    marginBottom: 4,
                  }}>Active patients</div>
                  <div style={{
                    fontFamily: "var(--a-font-mono, ui-monospace)",
                    fontSize: 22, color: "var(--gv-ink)",
                    letterSpacing: "-0.005em", fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                  }}>
                    {sel.active_patients?.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div style={{
                    fontFamily: "var(--a-font-mono, ui-monospace)",
                    fontSize: 10, letterSpacing: "0.18em",
                    textTransform: "uppercase", color: "var(--gv-ink-3)",
                    marginBottom: 4,
                  }}>Coverage</div>
                  <div style={{
                    fontFamily: "var(--a-font-mono, ui-monospace)",
                    fontSize: 22, color: "var(--gv-ink)",
                    letterSpacing: "-0.005em", fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                  }}>
                    {sel.coverage_pct}<span style={{ fontSize: 14, color: "var(--gv-ink-3)" }}>%</span>
                  </div>
                </div>
                <div>
                  <div style={{
                    fontFamily: "var(--a-font-mono, ui-monospace)",
                    fontSize: 10, letterSpacing: "0.18em",
                    textTransform: "uppercase", color: "var(--gv-ink-3)",
                    marginBottom: 4,
                  }}>CHW density</div>
                  <div style={{
                    fontFamily: "var(--a-font-mono, ui-monospace)",
                    fontSize: 22, color: "var(--gv-ink)",
                    letterSpacing: "-0.005em", fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                  }}>
                    {sel.chw_density_per_10k}
                    <span style={{ fontSize: 12, color: "var(--gv-ink-3)", marginLeft: 4 }}>/ 10k</span>
                  </div>
                </div>
              </div>

              <div style={{
                fontFamily: "var(--a-font-mono, ui-monospace)",
                fontSize: 10, letterSpacing: "0.18em",
                textTransform: "uppercase", color: "var(--gv-ink-3)",
                marginBottom: 6,
              }}>Consultations · last 14 days</div>
              <Sparkline data={sel.trend_14d || []} width={400} height={60} />
              <div style={{ marginTop: 8, fontSize: 12, color: "var(--gv-ink-3)" }}>
                {sel.consults_30d?.toLocaleString()} total in last 30 days
              </div>

              <button type="button"
                      className="gv-btn ghost"
                      style={{ marginTop: 16 }}
                      onClick={() => setSelected(null)}>
                ← Back to ranked list
              </button>
            </div>
          </div>
        ) : (
          <div className="gv-panel">
            <div className="gv-panel-head">
              <h2>
                Regions
                <span className="count">ranked by coverage</span>
              </h2>
            </div>
            <div className="gv-panel-body tight">
              <table className="gv-table">
                <thead>
                  <tr>
                    <th>Region</th>
                    <th className="num">Pop</th>
                    <th className="num">Coverage</th>
                    <th className="num">Consults 30d</th>
                  </tr>
                </thead>
                <tbody>
                  {[...regions].sort((a, b) => (b.coverage_pct || 0) - (a.coverage_pct || 0))
                    .map((r) => (
                      <tr key={r.code}
                          onClick={() => setSelected(r.code)}
                          style={{ cursor: "pointer" }}>
                        <td>
                          <span className="gv-pill" style={{ marginRight: 8 }}>{r.code}</span>
                          {r.name}
                          {r.anomaly && (
                            <AlertTriangle size={12} strokeWidth={2.4}
                              style={{ color: "var(--gv-alert)", marginLeft: 8, verticalAlign: -2 }} />
                          )}
                        </td>
                        <td className="num">{r.population_k}k</td>
                        <td className="num">
                          <strong>{r.coverage_pct}%</strong>
                        </td>
                        <td className="num">{r.consults_30d?.toLocaleString()}</td>
                      </tr>
                    ))}
                  {regions.length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ textAlign: "center", color: "var(--gv-ink-3)", padding: 20 }}>
                        No regional data available.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
