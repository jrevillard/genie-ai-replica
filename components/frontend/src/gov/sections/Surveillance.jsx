/**
 * Surveillance — condition-level anomaly detection.
 *
 * z-score = (recent 7d avg − baseline 49d avg) / baseline stdev.
 * z > 2σ flags an early-warning signal; z > 3σ escalates to alert.
 */

import { AlertTriangle, Activity, Info, ChevronDown } from "lucide-react";
import { useState } from "react";

import { useAdminApi } from "../../admin/hooks/useAdminApi.js";


function Sparkline({ data, width = 340, height = 52, stroke = "#1d4ed8", fill }) {
  if (!data || data.length === 0) return null;
  const max   = Math.max(...data, 1);
  const step  = width / (data.length - 1 || 1);
  const pts   = data.map((v, i) => [i * step, height - (v / max) * (height - 6) - 3]);
  const lineD = pts.map(([x, y], i) => (i === 0 ? "M" : "L") + `${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const areaD = fill ? `${lineD} L${width} ${height} L0 ${height} Z` : null;
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {areaD && <path d={areaD} fill={fill} />}
      <path d={lineD} fill="none" stroke={stroke} strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}


function sevOf(z) {
  if (z == null) return "unknown";
  if (z >= 3) return "alert";
  if (z >= 2) return "warn";
  return "ok";
}


export default function Surveillance({ period = "mtd" }) {
  const { data } = useAdminApi("/api/v1/gov/mv/surveillance", { refreshMs: 120000 });
  const [methodologyOpen, setMethodologyOpen] = useState(false);

  const conds      = data?.conditions || [];
  const anomalies  = conds.filter((c) => c.anomaly);
  const normalCnt  = conds.length - anomalies.length;

  return (
    <div className="gv-stack">
      {/* Ribbon */}
      <div className="gv-ribbon">
        <Info size={13} strokeWidth={2} />
        <span>
          <strong>8-week rolling baseline · 2σ threshold.</strong>{" "}
          Anomaly windows may also be triggered by a new CHW onboarding in a region
          (data influx, not a true clinical spike). Confirm on the ground before
          resource reallocation.
        </span>
      </div>

      {/* Summary strip */}
      <div className="gv-grid-3">
        <div className="gv-panel">
          <div className="gv-panel-body">
            <div style={{
              fontFamily: "var(--a-font-mono, ui-monospace)",
              fontSize: 10, letterSpacing: "0.20em",
              textTransform: "uppercase", color: "var(--gv-ink-3)",
              marginBottom: 10,
            }}>Conditions tracked</div>
            <div style={{
              fontFamily: "var(--a-font-mono, ui-monospace)",
              fontSize: 34, fontWeight: 600,
              color: "var(--gv-ink)", letterSpacing: "-0.01em", lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
            }}>{conds.length}</div>
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--gv-ink-3)" }}>
              Core NCD, maternal, and infectious-disease surveillance set.
            </div>
          </div>
        </div>

        <div className="gv-panel">
          <div className="gv-panel-body">
            <div style={{
              fontFamily: "var(--a-font-mono, ui-monospace)",
              fontSize: 10, letterSpacing: "0.20em",
              textTransform: "uppercase", color: "var(--gv-ink-3)",
              marginBottom: 10,
            }}>Nominal</div>
            <div style={{
              fontFamily: "var(--a-font-mono, ui-monospace)",
              fontSize: 34, fontWeight: 600,
              color: "var(--gv-ok)", letterSpacing: "-0.01em", lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
            }}>{normalCnt}</div>
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--gv-ink-3)" }}>
              Within 2σ of baseline — no action required.
            </div>
          </div>
        </div>

        <div className="gv-panel"
             style={anomalies.length > 0 ? {
               borderColor: "rgba(185, 28, 28, 0.40)",
               background: "linear-gradient(180deg, rgba(185,28,28,0.04), #fff)",
             } : {}}>
          <div className="gv-panel-body">
            <div style={{
              fontFamily: "var(--a-font-mono, ui-monospace)",
              fontSize: 10, letterSpacing: "0.20em",
              textTransform: "uppercase",
              color: anomalies.length > 0 ? "var(--gv-alert)" : "var(--gv-ink-3)",
              marginBottom: 10,
            }}>
              Active early-warning signals
            </div>
            <div style={{
              fontFamily: "var(--a-font-mono, ui-monospace)",
              fontSize: 34, fontWeight: 600,
              color: anomalies.length > 0 ? "var(--gv-alert)" : "var(--gv-ink-3)",
              letterSpacing: "-0.01em", lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
            }}>{anomalies.length}</div>
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--gv-ink-3)" }}>
              {anomalies.length > 0
                ? "Investigate clusters below before dispatch."
                : "No active signals over the baseline threshold."}
            </div>
          </div>
        </div>
      </div>

      {/* Active signals */}
      {anomalies.length > 0 && (
        <div className="gv-panel">
          <div className="gv-panel-head">
            <h2>
              <AlertTriangle size={14} strokeWidth={2.2}
                style={{ color: "var(--gv-alert)" }} />
              Active early-warning signals
              <span className="count">{anomalies.length} condition{anomalies.length === 1 ? "" : "s"}</span>
            </h2>
            <span className="gv-pill alert">
              <span className="dot" />
              Investigate
            </span>
          </div>
          <div className="gv-panel-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {anomalies.map((a) => {
              const sev = sevOf(a.z_score);
              return (
                <div key={a.condition} style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: 16, alignItems: "center",
                  padding: "14px 16px",
                  border: `1px solid ${sev === "alert" ? "rgba(185, 28, 28, 0.40)" : "rgba(180, 83, 9, 0.30)"}`,
                  background: sev === "alert" ? "#fef2f2" : "#fffbeb",
                  borderRadius: 10,
                }}>
                  <AlertTriangle size={20} strokeWidth={2}
                    style={{ color: sev === "alert" ? "var(--gv-alert)" : "var(--gv-warn)" }} />
                  <div>
                    <div style={{
                      fontSize: 14, fontWeight: 600, color: "var(--gv-ink)",
                      letterSpacing: "0.005em",
                    }}>
                      {a.condition}
                      <span style={{
                        marginLeft: 12,
                        fontFamily: "var(--a-font-mono, ui-monospace)",
                        fontSize: 12, color: sev === "alert" ? "var(--gv-alert)" : "var(--gv-warn)",
                        fontWeight: 600,
                      }}>
                        z = {a.z_score}σ
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--gv-ink-3)", marginTop: 3 }}>
                      Recent 7d avg <strong style={{ color: "var(--gv-ink)" }}>{a.recent_avg}</strong>{" "}
                      · baseline <strong style={{ color: "var(--gv-ink)" }}>{a.baseline_avg}</strong>
                    </div>
                    {a.action && (
                      <div style={{
                        marginTop: 6, fontSize: 12,
                        color: "var(--gv-ink-2)", lineHeight: 1.5,
                      }}>
                        {a.action}
                      </div>
                    )}
                  </div>
                  <button type="button" className="gv-btn blue">
                    Dispatch
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Condition grid */}
      <div className="gv-panel">
        <div className="gv-panel-head">
          <h2>
            Condition trends
            <span className="count">last 56 days</span>
          </h2>
          <div className="gv-panel-tools">
            <span className="gv-pill">
              <Activity size={10} strokeWidth={2.4} />
              8-week baseline
            </span>
          </div>
        </div>
        <div className="gv-panel-body">
          <div className="gv-cond-grid">
            {conds.map((c) => {
              const sev = sevOf(c.z_score);
              return (
                <div key={c.condition}
                     className={`gv-cond-card${sev === "alert" ? " alert" : ""}`}>
                  <div className="gv-cond-card-head">
                    <span className="gv-cond-name">{c.condition}</span>
                    {sev === "ok"
                      ? <span className="gv-pill ok"><span className="dot" />Nominal</span>
                      : sev === "warn"
                      ? <span className="gv-pill warn"><span className="dot" />z {c.z_score}σ</span>
                      : <span className="gv-pill alert"><span className="dot" />z {c.z_score}σ</span>}
                  </div>
                  <Sparkline
                    data={c.series_56d}
                    width={380}
                    height={58}
                    stroke={sev === "alert" ? "#b91c1c" : sev === "warn" ? "#b45309" : "#1d4ed8"}
                    fill={sev === "alert" ? "rgba(185, 28, 28, 0.08)"
                        : sev === "warn"  ? "rgba(180, 83, 9, 0.08)"
                        : "rgba(29, 78, 216, 0.08)"}
                  />
                  <div className="gv-cond-stats">
                    <span>7d <strong>{c.recent_avg}</strong></span>
                    <span>baseline <strong>{c.baseline_avg}</strong></span>
                  </div>
                </div>
              );
            })}
            {conds.length === 0 && (
              <div style={{
                gridColumn: "1 / -1",
                padding: 24, textAlign: "center",
                color: "var(--gv-ink-3)", fontSize: 13,
              }}>
                No surveillance data yet.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Methodology */}
      <div className="gv-panel">
        <button type="button"
                onClick={() => setMethodologyOpen((o) => !o)}
                style={{
                  width: "100%", padding: "14px 18px",
                  background: "var(--gv-card-soft)",
                  border: "none",
                  borderBottom: methodologyOpen ? "1px solid var(--gv-rule)" : "none",
                  display: "flex", justifyContent: "space-between",
                  alignItems: "center",
                  cursor: "pointer", fontFamily: "inherit",
                }}>
          <span style={{
            fontSize: 13, fontWeight: 600,
            color: "var(--gv-ink)",
          }}>Methodology &amp; notes</span>
          <ChevronDown size={14} strokeWidth={2}
            style={{
              color: "var(--gv-ink-3)",
              transform: methodologyOpen ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 200ms ease",
            }} />
        </button>
        {methodologyOpen && (
          <div className="gv-panel-body">
            <div style={{ fontSize: 13, color: "var(--gv-ink-2)", lineHeight: 1.65 }}>
              <p style={{ margin: "0 0 10px" }}>
                For each tracked condition we compute a z-score as{" "}
                <code style={{
                  fontFamily: "var(--a-font-mono, ui-monospace)",
                  fontSize: 12, padding: "1px 6px",
                  background: "var(--gv-paper-2)",
                  border: "1px solid var(--gv-rule)",
                  borderRadius: 3,
                }}>(recent_7d − baseline_49d_μ) / baseline_49d_σ</code>.{" "}
                Values above <strong>2σ</strong> raise an early-warning signal; above{" "}
                <strong>3σ</strong> the signal escalates to a red alert visible on the Regional map.
              </p>
              <p style={{ margin: 0 }}>
                Thresholds are intentionally conservative — district officers are expected
                to triangulate on the ground before resource reallocation. The baseline
                excludes public holidays and known outage windows. Raw anomaly
                calculations are available to authorised MoH staff on request.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
