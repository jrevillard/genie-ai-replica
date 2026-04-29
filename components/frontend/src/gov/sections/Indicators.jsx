/**
 * Indicators — WHO PEN · HEARTS · SDG3.
 *
 * Per-framework gauge rows with target line overlay. Aggregate-only
 * percentage indicators; values firm up on the first of each month.
 */

import { Target, Info, CheckCircle2, AlertCircle } from "lucide-react";

import { useAdminApi } from "../../admin/hooks/useAdminApi.js";


function gaugeTone(value, target) {
  if (value >= target)            return "ok";
  if (value >= target * 0.85)     return "warn";
  return "alert";
}


function IndicatorGauge({ label, value, target }) {
  const tone = gaugeTone(value, target);
  const pct  = Math.max(0, Math.min(100, value));
  return (
    <div className="gv-gauge">
      <span className="gv-gauge-label">{label}</span>
      <span className="gv-gauge-value">{value}%</span>
      <div className="gv-gauge-track">
        <div className={`gv-gauge-fill ${tone}`} style={{ width: `${pct}%` }} />
        <div className="gv-gauge-target"
             style={{ left: `${target}%` }}
             title={`Target ${target}%`} />
      </div>
      <div className="gv-gauge-caption">
        <span>0%</span>
        <span style={{ color: tone === "ok" ? "var(--gv-ok)"
                            : tone === "warn" ? "var(--gv-warn)"
                            : "var(--gv-alert)" }}>
          {tone === "ok" ? "on target" : tone === "warn" ? "below target" : "critical gap"}
          {" "}· target {target}%
        </span>
        <span>100%</span>
      </div>
    </div>
  );
}


function IndicatorFramework({ title, subtitle, rows, targetPct, sourceNote }) {
  const onTargetCount = rows.filter((r) => r.value >= targetPct).length;
  const overall = rows.length
    ? Math.round(rows.reduce((s, r) => s + r.value, 0) / rows.length)
    : 0;
  return (
    <div className="gv-panel">
      <div className="gv-panel-head">
        <h2>
          {title}
          <span className="count">target {targetPct}%</span>
        </h2>
        <span className="gv-pill blue">
          <Target size={10} strokeWidth={2.4} />
          {onTargetCount}/{rows.length} on target
        </span>
      </div>
      <div className="gv-panel-body">
        <div style={{
          fontSize: 12, color: "var(--gv-ink-3)",
          marginBottom: 14, lineHeight: 1.5,
        }}>
          {subtitle}
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{
            fontFamily: "var(--a-font-mono, ui-monospace)",
            fontSize: 10, letterSpacing: "0.20em",
            textTransform: "uppercase", color: "var(--gv-ink-3)",
            marginBottom: 4,
          }}>
            Framework average
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{
              fontFamily: "var(--a-font-mono, ui-monospace)",
              fontSize: 30, fontWeight: 600,
              color: overall >= targetPct ? "var(--gv-ok)"
                   : overall >= targetPct * 0.85 ? "var(--gv-warn)"
                   : "var(--gv-alert)",
              letterSpacing: "-0.01em", lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
            }}>
              {overall}%
            </span>
            {overall >= targetPct
              ? <CheckCircle2 size={16} strokeWidth={2} style={{ color: "var(--gv-ok)" }} />
              : <AlertCircle  size={16} strokeWidth={2} style={{ color: overall >= targetPct * 0.85 ? "var(--gv-warn)" : "var(--gv-alert)" }} />}
          </div>
        </div>
        <div>
          {rows.map((r) => (
            <IndicatorGauge key={r.label} label={r.label} value={r.value} target={targetPct} />
          ))}
          {rows.length === 0 && (
            <div style={{ padding: 12, fontSize: 12, color: "var(--gv-ink-3)", textAlign: "center" }}>
              No indicators available.
            </div>
          )}
        </div>
        {sourceNote && (
          <div style={{
            marginTop: 14, paddingTop: 12,
            borderTop: "1px dashed var(--gv-rule-2)",
            fontFamily: "var(--a-font-mono, ui-monospace)",
            fontSize: 10.5, color: "var(--gv-ink-3)",
            letterSpacing: "0.02em",
          }}>
            Source: {sourceNote}
          </div>
        )}
      </div>
    </div>
  );
}


export default function Indicators({ period = "mtd" }) {
  const { data } = useAdminApi("/api/v1/gov/mv/indicators", { refreshMs: 300000 });

  return (
    <div className="gv-stack">
      {/* Ribbon */}
      <div className="gv-ribbon">
        <Info size={13} strokeWidth={2} />
        <span>
          <strong>Values aggregated monthly</strong> from the clinic-side AMINA ledger
          and firm up on the first of each month. What you see mid-month is
          running-month-to-date. The vertical mark on each gauge denotes the framework's
          compliance target.
        </span>
      </div>

      {/* Three frameworks side-by-side */}
      <div className="gv-grid-3">
        <IndicatorFramework
          title="WHO PEN"
          subtitle="Package of Essential Noncommunicable disease interventions. Four core adherence screens."
          rows={data?.who_pen_adherence || []}
          targetPct={80}
          sourceNote="WHO PEN 2020 · adapted for Gambia primary care"
        />
        <IndicatorFramework
          title="HEARTS"
          subtitle="Cardiovascular disease management bundle — BP control, medication adherence, team-based care."
          rows={data?.hearts_adherence || []}
          targetPct={75}
          sourceNote="WHO HEARTS Technical Package · 2023 rev."
        />
        <IndicatorFramework
          title="SDG 3 · Maternal"
          subtitle="Sustainable Development Goal indicators for maternal and reproductive health."
          rows={data?.sdg3_maternal || []}
          targetPct={85}
          sourceNote="UN SDG 3.1 / 3.2 · Gambia NCD Strategy 2023-2027"
        />
      </div>

      {/* Notes */}
      <div className="gv-note">
        <strong>Reading this page.</strong> The number above each gauge list is the
        framework's average across its constituent indicators; the small vertical
        mark inside each gauge denotes the target compliance threshold. Green means
        on target, amber means below target but within 15% of it, red flags a
        critical gap that deserves district-level attention. Monthly methodology
        and raw denominators are available to authorised MoH staff on request.
      </div>
    </div>
  );
}
