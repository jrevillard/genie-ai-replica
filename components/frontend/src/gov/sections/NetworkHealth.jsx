/**
 * Network Health — CHW capacity, certification, response time variance.
 *
 * The national network is only as strong as its weakest district.
 * This view exposes where CHW coverage or certification is slipping
 * and where response time variance is widening.
 */

import { UserCheck, Clock, Users, TrendingUp, Info } from "lucide-react";

import { useAdminApi } from "../../admin/hooks/useAdminApi.js";


function fmt(n) { return n != null ? n.toLocaleString() : "—"; }


function KpiTile({ icon: Icon, label, value, unit, sub, tone }) {
  const toneColor = tone === "ok"    ? "var(--gv-ok)"
                  : tone === "warn"  ? "var(--gv-warn)"
                  : tone === "alert" ? "var(--gv-alert)"
                  : "var(--gv-ink)";
  return (
    <div className="gv-kpi">
      <div className="gv-kpi-label">
        <Icon size={12} strokeWidth={2} />
        <span>{label}</span>
      </div>
      <div className="gv-kpi-value" style={{ color: toneColor }}>
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
      <div className="gv-kpi-meta">
        <span>{sub}</span>
      </div>
    </div>
  );
}


export default function NetworkHealth({ period = "mtd" }) {
  const { data } = useAdminApi("/api/v1/gov/mv/network-health", { refreshMs: 300000 });
  const regions = data?.regions || [];

  const totalChws = regions.reduce((s, r) => s + (r.chws_active    || 0), 0);
  const totalCert = regions.reduce((s, r) => s + (r.certified      || 0), 0);
  const totalDrop = regions.reduce((s, r) => s + (r.dropout_risk   || 0), 0);
  const avgResp   = regions.length
    ? regions.reduce((s, r) => s + (r.avg_response_min || 0), 0) / regions.length
    : 0;
  const certRate  = totalChws ? Math.round((totalCert / totalChws) * 100) : 0;
  const dropTone  = totalDrop === 0 ? "ok"
                  : totalDrop <= 3  ? "warn"
                  : "alert";

  return (
    <div className="gv-stack">
      {/* Ribbon */}
      <div className="gv-ribbon">
        <Info size={13} strokeWidth={2} />
        <span>
          <strong>CHW = Community Health Worker.</strong>{" "}
          A certified CHW has completed the MoH training package and is authorised to
          deliver first-line care in their catchment. Dropout risk is derived from
          session cadence, response time, and supervisor reviews.
        </span>
      </div>

      {/* KPI strip */}
      <div className="gv-kpi-row">
        <KpiTile
          icon={Users}
          label="Active CHWs"
          value={fmt(totalChws)}
          sub="across all regions"
        />
        <KpiTile
          icon={UserCheck}
          label="Certified"
          value={fmt(totalCert)}
          sub={`${certRate}% of the active network`}
          tone={certRate >= 75 ? "ok" : certRate >= 60 ? "warn" : "alert"}
        />
        <KpiTile
          icon={TrendingUp}
          label="Dropout risk"
          value={fmt(totalDrop)}
          sub={totalDrop > 0 ? "need refresher or check-in" : "none flagged"}
          tone={dropTone}
        />
        <KpiTile
          icon={Clock}
          label="Avg response"
          value={avgResp.toFixed(1)}
          unit="min"
          sub="first patient contact"
        />
      </div>

      {/* Per-region table */}
      <div className="gv-panel">
        <div className="gv-panel-head">
          <h2>
            Network by region
            <span className="count">{regions.length} regions reporting</span>
          </h2>
          <div className="gv-panel-tools">
            <span className="gv-pill">sorted by certification rate</span>
          </div>
        </div>
        <div className="gv-panel-body tight">
          <table className="gv-table">
            <thead>
              <tr>
                <th>Region</th>
                <th className="num">Active</th>
                <th className="num">Certified</th>
                <th className="num">Cert. rate</th>
                <th className="num">Dropout risk</th>
                <th className="num">Avg response</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {[...regions].sort((a, b) => {
                const ra = a.chws_active ? a.certified / a.chws_active : 0;
                const rb = b.chws_active ? b.certified / b.chws_active : 0;
                return rb - ra;
              }).map((r) => {
                const certPct = r.chws_active ? Math.round((r.certified / r.chws_active) * 100) : 0;
                const healthy = r.dropout_risk <= 1 && certPct >= 70;
                const caution = !healthy && (r.dropout_risk <= 2 || certPct >= 50);
                return (
                  <tr key={r.code}>
                    <td>
                      <span className="gv-pill" style={{ marginRight: 8 }}>{r.code}</span>
                      {r.name}
                    </td>
                    <td className="num">{r.chws_active}</td>
                    <td className="num">{r.certified}</td>
                    <td className="num">
                      <strong>{certPct}%</strong>
                    </td>
                    <td className="num" style={{
                      color: r.dropout_risk === 0 ? "var(--gv-ink-3)"
                           : r.dropout_risk <= 1 ? "var(--gv-warn)"
                           : "var(--gv-alert)",
                      fontWeight: r.dropout_risk >= 1 ? 600 : 400,
                    }}>
                      {r.dropout_risk}
                    </td>
                    <td className="num">{r.avg_response_min}m</td>
                    <td>
                      {healthy  ? <span className="gv-pill ok"><span className="dot" />Healthy</span>
                       : caution ? <span className="gv-pill warn"><span className="dot" />Monitor</span>
                       :           <span className="gv-pill alert"><span className="dot" />Needs attention</span>}
                    </td>
                  </tr>
                );
              })}
              {regions.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", color: "var(--gv-ink-3)", padding: 20 }}>
                    No network data available.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Disparity chart — response time bars */}
      <div className="gv-panel">
        <div className="gv-panel-head">
          <h2>
            Response-time disparity
            <span className="count">minutes to first patient contact</span>
          </h2>
          <div className="gv-panel-tools">
            <span className="gv-pill">lower is better</span>
          </div>
        </div>
        <div className="gv-panel-body">
          {regions.length > 0 ? (
            <div className="gv-hbar">
              {[...regions]
                .sort((a, b) => (a.avg_response_min || 0) - (b.avg_response_min || 0))
                .map((r) => {
                  const maxResp = Math.max(...regions.map((x) => x.avg_response_min || 0), 1);
                  const resp    = r.avg_response_min || 0;
                  const width   = Math.round((resp / maxResp) * 100);
                  const tone    = resp <= 8  ? "ok"
                                : resp <= 15 ? "warn"
                                : "alert";
                  return (
                    <div className="gv-hbar-row" key={r.code}>
                      <span className="gv-hbar-label">
                        <span style={{
                          fontFamily: "var(--a-font-mono, ui-monospace)",
                          fontSize: 10, marginRight: 8,
                          color: "var(--gv-ink-3)",
                        }}>{r.code}</span>
                        {r.name}
                      </span>
                      <span className="gv-hbar-value">{resp}m</span>
                      <div className="gv-hbar-track">
                        <div className={`gv-hbar-fill ${tone}`} style={{ width: `${width}%` }} />
                      </div>
                    </div>
                  );
                })}
            </div>
          ) : (
            <div style={{ textAlign: "center", color: "var(--gv-ink-3)", padding: 12 }}>
              No data.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
