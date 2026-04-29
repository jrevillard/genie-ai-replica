/**
 * GovReportDocument — formal A4 summary report.
 *
 * Rendered as three independent A4 sheets so every page carries
 * its own classification strip, running head and page number.
 *
 *   Sheet 1 · Cover + Executive summary + Regional distribution
 *   Sheet 2 · Disease surveillance + Indicator compliance
 *   Sheet 3 · Field network + Methodology + Authorisation
 *
 * "Save as PDF" sets body.gr-printing and calls window.print().
 * page-break-after: always on each sheet gives a clean PDF with
 * three pages — the browser's native "Save as PDF" destination
 * keeps the visual fidelity.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Printer, X, FileDown, RefreshCw, ShieldCheck,
} from "lucide-react";

import "../styles/gov-report.css";
import { useAdminApi } from "../admin/hooks/useAdminApi.js";


// ── Helpers ────────────────────────────────────────

function todayIso() { return new Date().toISOString().slice(0, 10); }

function fmt(n) {
  if (n == null) return "—";
  return Number(n).toLocaleString();
}

function refNumber() {
  const d = new Date();
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, "");
  const seq = String(Math.floor(Math.random() * 9000) + 1000);
  return `AMINA-OBS-${ymd}-${seq}`;
}

function periodLabel(p) {
  return {
    wtd: "Week-to-date",
    mtd: "Month-to-date",
    qtd: "Quarter-to-date",
    ytd: "Year-to-date",
  }[p] || (p || "").toUpperCase();
}

function narrative(data) {
  if (!data.national) return "National observatory data is loading.";
  const np = data.national;
  const ocr = data.regional?.regions || [];
  const anomalies = (data.surveillance?.conditions || []).filter((c) => c.anomaly);
  const topRegion = [...ocr].sort((a, b) => (b.coverage_pct || 0) - (a.coverage_pct || 0))[0];
  const lowRegion = [...ocr].sort((a, b) => (a.coverage_pct || 0) - (b.coverage_pct || 0))[0];
  return `
    During the reporting period, AMINA Care recorded ${fmt(np.active_patients)} active
    patients across the network and served ${fmt(np.consults_mtd)} consultations through
    every care channel. Estimated population coverage stands at ${np.coverage_pct}%,
    delivered by ${fmt(np.chw_active)} field-certified community health workers.
    ${topRegion ? `Highest coverage was observed in ${topRegion.name} (${topRegion.coverage_pct}%);` : ""}
    ${lowRegion ? ` the lowest was ${lowRegion.name} (${lowRegion.coverage_pct}%).` : ""}
    ${anomalies.length
       ? `Surveillance flagged ${anomalies.length} condition${anomalies.length === 1 ? "" : "s"} above the 2σ baseline threshold — see Section 3.`
       : " No condition crossed the 2σ anomaly threshold this period."}
  `.trim().replace(/\s+/g, " ");
}


// ── Reusable page frame ─────────────────────────────

function SheetFrame({ page, totalPages, pRef, dateIso, children }) {
  return (
    <article className="gr-sheet">
      <div className="gr-class-strip">
        RESTRICTED · TIER 3 · AGGREGATE ONLY · NO PII
      </div>

      <div className="gr-running-head">
        <div className="gr-running-head-org">
          <span className="gr-running-head-mini-crest" aria-hidden="true" />
          <span>Ministry of Health · The Gambia</span>
        </div>
        <div className="gr-running-head-title">
          AMINA Observatory · Summary Report
        </div>
        <div className="gr-running-head-ref">
          {pRef} · {dateIso}
        </div>
      </div>

      <div className="gr-sheet-body">{children}</div>

      <div className="gr-page-foot">
        <span>Ref. {pRef}</span>
        <span className="mid">Page {page} of {totalPages}</span>
        <span className="right">RESTRICTED · TIER 3</span>
      </div>

      <div className="gr-class-strip bottom">
        RESTRICTED · TIER 3 · AGGREGATE ONLY · NO PII
      </div>
    </article>
  );
}


// ── Component ──────────────────────────────────────

export default function GovReportDocument({ open, period = "mtd", onClose }) {
  const pRef = useMemo(refNumber, []);
  const [today] = useState(todayIso());

  // Editable signature fields — sensible Gambian MoH defaults.
  const [preparedBy,   setPreparedBy]   = useState("");
  const [preparedRole, setPreparedRole] = useState("Health Data Analyst · Observatory Desk");
  const [reviewedBy,   setReviewedBy]   = useState("");
  const [reviewedRole, setReviewedRole] = useState("Director, Health Statistics & Information");
  const [approvedBy,   setApprovedBy]   = useState("");
  const [approvedRole, setApprovedRole] = useState("Permanent Secretary, Ministry of Health");
  const [prepDate, setPrepDate] = useState(today);
  const [revDate,  setRevDate]  = useState(today);
  const [appDate,  setAppDate]  = useState(today);

  // Live data
  const { data: national   } = useAdminApi(open ? "/api/v1/gov/mv/national-pulse" : "");
  const { data: regional   } = useAdminApi(open ? "/api/v1/gov/mv/regional"       : "");
  const { data: surveill   } = useAdminApi(open ? "/api/v1/gov/mv/surveillance"   : "");
  const { data: indicators } = useAdminApi(open ? "/api/v1/gov/mv/indicators"     : "");
  const { data: network    } = useAdminApi(open ? "/api/v1/gov/mv/network-health" : "");

  useEffect(() => {
    if (!open) return;
    const onEsc = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  if (!open) return null;

  function printPdf() {
    document.body.classList.add("gr-printing");
    setTimeout(() => {
      window.print();
      setTimeout(() => document.body.classList.remove("gr-printing"), 400);
    }, 60);
  }

  // Data derivations
  const execSummary = narrative({ national, regional, surveillance: surveill });
  const regions     = regional?.regions     || [];
  const conds       = surveill?.conditions  || [];
  const netRegions  = network?.regions      || [];

  const anomalies  = conds.filter((c) => c.anomaly);
  const normalConds = conds.length - anomalies.length;

  const totalChws = netRegions.reduce((s, r) => s + (r.chws_active || 0), 0);
  const totalCert = netRegions.reduce((s, r) => s + (r.certified   || 0), 0);
  const totalDrop = netRegions.reduce((s, r) => s + (r.dropout_risk || 0), 0);
  const avgResp   = netRegions.length
    ? netRegions.reduce((s, r) => s + (r.avg_response_min || 0), 0) / netRegions.length
    : 0;
  const certRate  = totalChws ? Math.round((totalCert / totalChws) * 100) : 0;

  const whoPen     = indicators?.who_pen_adherence || [];
  const hearts     = indicators?.hearts_adherence  || [];
  const sdg3       = indicators?.sdg3_maternal     || [];
  const avg        = (rows) => rows.length
    ? Math.round(rows.reduce((s, r) => s + r.value, 0) / rows.length) : null;
  const whoAvg     = avg(whoPen);
  const heartsAvg  = avg(hearts);
  const sdg3Avg    = avg(sdg3);

  const topRegions = [...regions]
    .sort((a, b) => (b.coverage_pct || 0) - (a.coverage_pct || 0));

  const TOTAL_PAGES = 3;

  return (
    <div className="gr-overlay" role="dialog" aria-modal="true" aria-label="Summary report preview">
      <div className="gr-toolbar">
        <div className="gr-toolbar-title">
          <span className="gr-toolbar-kicker">Draft report</span>
          <span>Review · sign · save as PDF</span>
        </div>
        <span className="gr-toolbar-spacer" />
        <span className="gr-toolbar-hint">{TOTAL_PAGES} pages · A4</span>
        <button type="button"
                className="gr-toolbar-btn"
                onClick={() => window.location.reload()}
                title="Refresh underlying data">
          <RefreshCw size={13} strokeWidth={2} /> Reload data
        </button>
        <button type="button"
                className="gr-toolbar-btn"
                onClick={onClose}>
          <X size={13} strokeWidth={2} /> Close
        </button>
        <button type="button"
                className="gr-toolbar-btn primary"
                onClick={printPdf}>
          <FileDown size={13} strokeWidth={2} /> Save as PDF
        </button>
      </div>

      <div className="gr-overlay-scroll">

        {/* ══════════════════════════════════════════════
             SHEET 1 — Cover · Exec summary · Regions
           ══════════════════════════════════════════════ */}
        <SheetFrame page={1} totalPages={TOTAL_PAGES} pRef={pRef} dateIso={today}>
          {/* Full masthead only on sheet 1 */}
          <div className="gr-masthead">
            <div className="gr-crest" aria-hidden="true">G</div>
            <div>
              <div className="gr-masthead-org">Ministry of Health · The Gambia</div>
              <div className="gr-masthead-dept">Directorate of Health Statistics &amp; Information</div>
            </div>
            <div className="gr-masthead-meta">
              <div>Ref. <strong>{pRef}</strong></div>
              <div>Issued <strong>{today}</strong></div>
              <div>Classification <strong>Tier 3</strong></div>
            </div>
          </div>

          <div className="gr-title-block">
            <div className="gr-title-kicker">National Health Observatory · Summary Report</div>
            <h1 className="gr-title">AMINA Care · Aggregate Clinical &amp; Operational Indicators</h1>
            <p className="gr-subtitle">
              Prepared under the AMINA Care national programme · Gambia NCD
              Strategy 2023-2027 · WHO HEARTS technical package reference.
            </p>
            <div className="gr-title-meta">
              <div>
                <div className="k">Period</div>
                <div className="v">{periodLabel(period)}</div>
              </div>
              <div>
                <div className="k">Date of issue</div>
                <div className="v">{today}</div>
              </div>
              <div>
                <div className="k">Report reference</div>
                <div className="v">{pRef}</div>
              </div>
              <div>
                <div className="k">Classification</div>
                <div className="v">Restricted · T3</div>
              </div>
            </div>
          </div>

          {/* §1 Executive summary */}
          <div className="gr-section">
            <div className="gr-section-h">
              <span className="gr-section-num">§1</span>
              <span className="gr-section-title">Executive summary</span>
              <span className="gr-section-sub">prepared {today}</span>
            </div>
            <p className="gr-p">{execSummary}</p>
            <div className="gr-kpi-grid">
              <div className="gr-kpi">
                <div className="k">Active patients</div>
                <div className="v">{fmt(national?.active_patients)}</div>
                <div className="sub">{periodLabel(period)}</div>
              </div>
              <div className="gr-kpi">
                <div className="k">Consultations</div>
                <div className="v">{fmt(national?.consults_mtd)}</div>
                <div className="sub">all channels</div>
              </div>
              <div className="gr-kpi">
                <div className="k">Active CHWs</div>
                <div className="v">{fmt(national?.chw_active)}</div>
                <div className="sub">field-certified</div>
              </div>
              <div className="gr-kpi">
                <div className="k">Coverage</div>
                <div className="v">
                  {national?.coverage_pct != null ? `${national.coverage_pct}%` : "—"}
                </div>
                <div className="sub">of eligible population</div>
              </div>
            </div>
          </div>

          {/* §2 Regional distribution */}
          <div className="gr-section">
            <div className="gr-section-h">
              <span className="gr-section-num">§2</span>
              <span className="gr-section-title">Regional distribution</span>
              <span className="gr-section-sub">{regions.length} regions reporting</span>
            </div>
            <p className="gr-p">
              Coverage is share of estimated eligible population that has had at
              least one consultation this period. Outbreak column flags regions
              with at least one tracked condition above 2σ of the 8-week baseline.
            </p>
            <table className="gr-table">
              <thead>
                <tr>
                  <th>Region</th>
                  <th className="num">Population</th>
                  <th className="num">Active</th>
                  <th>Coverage</th>
                  <th className="num">30d consults</th>
                  <th>Outbreak</th>
                </tr>
              </thead>
              <tbody>
                {topRegions.map((r) => (
                  <tr key={r.code}>
                    <td>
                      <strong>{r.name}</strong>{" "}
                      <span className="muted" style={{ fontFamily: "var(--a-font-mono, ui-monospace)" }}>
                        ({r.code})
                      </span>
                    </td>
                    <td className="num">{r.population_k}k</td>
                    <td className="num">{fmt(r.active_patients)}</td>
                    <td className="num">
                      <span className="gr-bar">
                        <span style={{ width: `${r.coverage_pct || 0}%` }} />
                      </span>
                      <strong>{r.coverage_pct}%</strong>
                    </td>
                    <td className="num">{fmt(r.consults_30d)}</td>
                    <td>
                      {r.anomaly
                        ? <span className="gr-status alert">Signal</span>
                        : <span className="gr-status ok">Nominal</span>}
                    </td>
                  </tr>
                ))}
                {regions.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", color: "#64748b", padding: 14 }}>
                      Regional data not available.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </SheetFrame>

        {/* ══════════════════════════════════════════════
             SHEET 2 — Surveillance · Indicators
           ══════════════════════════════════════════════ */}
        <SheetFrame page={2} totalPages={TOTAL_PAGES} pRef={pRef} dateIso={today}>
          {/* §3 Disease surveillance */}
          <div className="gr-section">
            <div className="gr-section-h">
              <span className="gr-section-num">§3</span>
              <span className="gr-section-title">Disease surveillance</span>
              <span className="gr-section-sub">8-week rolling baseline · 2σ threshold</span>
            </div>
            <p className="gr-p">
              For each tracked condition the z-score is{" "}
              <code style={{
                fontFamily: "var(--a-font-mono, ui-monospace)",
                fontSize: "8.5pt", padding: "0 4px",
                background: "#fbfaf6", border: "1px solid #e3ddd0", borderRadius: 2,
              }}>
                (recent_7d − baseline_49d_μ) / baseline_49d_σ
              </code>. Values above <strong>2σ</strong> raise an early-warning
              signal; above <strong>3σ</strong> the signal escalates to an alert.
              Anomaly windows may also be triggered by new CHW onboarding in a
              region (data influx, not a true clinical spike). Confirm on the
              ground before resource reallocation.
            </p>
            <table className="gr-table">
              <thead>
                <tr>
                  <th>Condition</th>
                  <th className="num">Recent 7d</th>
                  <th className="num">Baseline</th>
                  <th className="num">z-score</th>
                  <th>Status</th>
                  <th>Recommended action</th>
                </tr>
              </thead>
              <tbody>
                {conds.map((c) => (
                  <tr key={c.condition}>
                    <td><strong>{c.condition}</strong></td>
                    <td className="num">{c.recent_avg}</td>
                    <td className="num">{c.baseline_avg}</td>
                    <td className="num">
                      <strong style={{
                        color: c.z_score >= 3 ? "#b91c1c"
                             : c.z_score >= 2 ? "#b45309"
                             : "#0a1535",
                      }}>
                        {c.z_score}σ
                      </strong>
                    </td>
                    <td>
                      {c.z_score >= 3
                        ? <span className="gr-status alert">Alert</span>
                        : c.z_score >= 2
                        ? <span className="gr-status warn">Investigate</span>
                        : <span className="gr-status ok">Nominal</span>}
                    </td>
                    <td style={{ fontSize: "8.5pt", color: "#334155" }}>
                      {c.action || "Within expected range"}
                    </td>
                  </tr>
                ))}
                {conds.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", color: "#64748b", padding: 14 }}>
                      Surveillance data not available.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="gr-note">
              <strong>Summary.</strong> {conds.length} condition{conds.length === 1 ? "" : "s"} tracked;
              {" "}{normalConds} within baseline, {anomalies.length} above 2σ threshold.
              {anomalies.length > 0 && " Districts should confirm on the ground before dispatch."}
            </div>
          </div>

          {/* §4 Indicator compliance */}
          <div className="gr-section">
            <div className="gr-section-h">
              <span className="gr-section-num">§4</span>
              <span className="gr-section-title">Indicator compliance</span>
              <span className="gr-section-sub">WHO PEN · HEARTS · SDG 3</span>
            </div>
            <p className="gr-p">
              Framework averages are the arithmetic mean of constituent indicators
              for the reporting period. Values firm up on the first of each month;
              mid-month figures are month-to-date.
            </p>
            <table className="gr-table">
              <thead>
                <tr>
                  <th>Framework</th>
                  <th className="num">Target</th>
                  <th className="num">Average</th>
                  <th className="num">Indicators</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>WHO PEN · noncommunicable disease</strong></td>
                  <td className="num">80%</td>
                  <td className="num"><strong>{whoAvg != null ? `${whoAvg}%` : "—"}</strong></td>
                  <td className="num">{whoPen.length} scored</td>
                  <td>
                    {whoAvg == null ? <span className="gr-status warn">No data</span>
                      : whoAvg >= 80 ? <span className="gr-status ok">On target</span>
                      : whoAvg >= 68 ? <span className="gr-status warn">Below target</span>
                                     : <span className="gr-status alert">Critical gap</span>}
                  </td>
                </tr>
                <tr>
                  <td><strong>WHO HEARTS · cardiovascular</strong></td>
                  <td className="num">75%</td>
                  <td className="num"><strong>{heartsAvg != null ? `${heartsAvg}%` : "—"}</strong></td>
                  <td className="num">{hearts.length} scored</td>
                  <td>
                    {heartsAvg == null ? <span className="gr-status warn">No data</span>
                      : heartsAvg >= 75 ? <span className="gr-status ok">On target</span>
                      : heartsAvg >= 64 ? <span className="gr-status warn">Below target</span>
                                        : <span className="gr-status alert">Critical gap</span>}
                  </td>
                </tr>
                <tr>
                  <td><strong>SDG 3 · maternal &amp; reproductive</strong></td>
                  <td className="num">85%</td>
                  <td className="num"><strong>{sdg3Avg != null ? `${sdg3Avg}%` : "—"}</strong></td>
                  <td className="num">{sdg3.length} scored</td>
                  <td>
                    {sdg3Avg == null ? <span className="gr-status warn">No data</span>
                      : sdg3Avg >= 85 ? <span className="gr-status ok">On target</span>
                      : sdg3Avg >= 72 ? <span className="gr-status warn">Below target</span>
                                      : <span className="gr-status alert">Critical gap</span>}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </SheetFrame>

        {/* ══════════════════════════════════════════════
             SHEET 3 — Network · Methodology · Authorisation
           ══════════════════════════════════════════════ */}
        <SheetFrame page={3} totalPages={TOTAL_PAGES} pRef={pRef} dateIso={today}>
          {/* §5 Field network health */}
          <div className="gr-section">
            <div className="gr-section-h">
              <span className="gr-section-num">§5</span>
              <span className="gr-section-title">Field network health</span>
              <span className="gr-section-sub">CHW capacity &amp; certification</span>
            </div>
            <div className="gr-kpi-grid">
              <div className="gr-kpi">
                <div className="k">Active CHWs</div>
                <div className="v">{fmt(totalChws)}</div>
                <div className="sub">all regions</div>
              </div>
              <div className="gr-kpi">
                <div className="k">Certified</div>
                <div className="v">{fmt(totalCert)}</div>
                <div className="sub">{certRate}% of active</div>
              </div>
              <div className="gr-kpi">
                <div className="k">Dropout risk</div>
                <div className="v">{fmt(totalDrop)}</div>
                <div className="sub">need refresher</div>
              </div>
              <div className="gr-kpi">
                <div className="k">Avg response</div>
                <div className="v">{avgResp.toFixed(1)}m</div>
                <div className="sub">first contact</div>
              </div>
            </div>
            <table className="gr-table">
              <thead>
                <tr>
                  <th>Region</th>
                  <th className="num">Active</th>
                  <th className="num">Certified</th>
                  <th className="num">Cert. rate</th>
                  <th className="num">Dropout risk</th>
                  <th className="num">Avg response</th>
                </tr>
              </thead>
              <tbody>
                {netRegions.map((r) => {
                  const pct = r.chws_active ? Math.round((r.certified / r.chws_active) * 100) : 0;
                  return (
                    <tr key={r.code}>
                      <td>
                        <strong>{r.name}</strong>{" "}
                        <span className="muted" style={{ fontFamily: "var(--a-font-mono, ui-monospace)" }}>
                          ({r.code})
                        </span>
                      </td>
                      <td className="num">{r.chws_active}</td>
                      <td className="num">{r.certified}</td>
                      <td className="num"><strong>{pct}%</strong></td>
                      <td className="num" style={{
                        color: r.dropout_risk >= 2 ? "#b91c1c"
                             : r.dropout_risk >= 1 ? "#b45309"
                             : "#64748b",
                      }}>
                        {r.dropout_risk}
                      </td>
                      <td className="num">{r.avg_response_min}m</td>
                    </tr>
                  );
                })}
                {netRegions.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", color: "#64748b", padding: 14 }}>
                      Network data not available.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* §6 Methodology */}
          <div className="gr-section">
            <div className="gr-section-h">
              <span className="gr-section-num">§6</span>
              <span className="gr-section-title">Methodology &amp; data governance</span>
              <span className="gr-section-sub">summary</span>
            </div>
            <div className="gr-note">
              <strong>Data provenance.</strong> All figures are derived from the AMINA
              Care aggregated clinical ledger, refreshed from facility-side entries and
              CHW field submissions. No personally identifiable information is
              transmitted into, persisted by, or rendered from the Observatory.
              Aggregation thresholds comply with the Gambia Health Information Data
              Governance Policy § 4.2.
            </div>
            <div className="gr-note">
              <strong>Surveillance methodology.</strong> Early-warning signals use a
              7-day recent window against a 49-day rolling baseline. Z-scores above 2σ
              trigger an "Investigate" status; above 3σ an "Alert". Thresholds are
              intentionally conservative — district officers triangulate on the ground
              before resource reallocation.
            </div>
            <div className="gr-note">
              <strong>Audit &amp; reproducibility.</strong> Data-dictionary, raw
              denominators, and the full audit trail for every indicator are available
              to authorised MoH staff on request via the Observatory's audit facility.
              Methodology revisions follow the formal Gambia NCD Strategy change-control
              process.
            </div>
          </div>

          {/* §7 Authorisation */}
          <div className="gr-section gr-sig-block">
            <div className="gr-section-h">
              <span className="gr-section-num">§7</span>
              <span className="gr-section-title">Authorisation</span>
              <span className="gr-section-sub">three-signature workflow</span>
            </div>
            <p className="gr-sig-intro">
              This report has been prepared, reviewed and approved by the officers whose
              signatures appear below, under the authority of the Permanent Secretary,
              Ministry of Health. Alteration after approval requires a new reference
              number and a counter-signed addendum.
            </p>

            <div className="gr-sig-grid">
              {/* Prepared by */}
              <div className="gr-sig">
                <div className="gr-sig-role">Prepared by</div>
                <div className="gr-sig-line">
                  <input type="text"
                         className="gr-sig-input"
                         placeholder="[ Full name ]"
                         value={preparedBy}
                         onChange={(e) => setPreparedBy(e.target.value)} />
                </div>
                <div className="gr-sig-caption">
                  <div>
                    <div className="k">Title &amp; unit</div>
                    <div className="gr-sig-title-row">
                      <input type="text"
                             className="gr-sig-input title-input"
                             placeholder="e.g. Health Data Analyst"
                             value={preparedRole}
                             onChange={(e) => setPreparedRole(e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <div className="k">Date</div>
                    <div className="gr-sig-date-row">
                      <input type="date"
                             className="gr-sig-input date-input"
                             value={prepDate}
                             onChange={(e) => setPrepDate(e.target.value)} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Reviewed by */}
              <div className="gr-sig">
                <div className="gr-sig-role">Reviewed by</div>
                <div className="gr-sig-line">
                  <input type="text"
                         className="gr-sig-input"
                         placeholder="[ Full name ]"
                         value={reviewedBy}
                         onChange={(e) => setReviewedBy(e.target.value)} />
                </div>
                <div className="gr-sig-caption">
                  <div>
                    <div className="k">Title &amp; unit</div>
                    <div className="gr-sig-title-row">
                      <input type="text"
                             className="gr-sig-input title-input"
                             placeholder="e.g. Director of Statistics"
                             value={reviewedRole}
                             onChange={(e) => setReviewedRole(e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <div className="k">Date</div>
                    <div className="gr-sig-date-row">
                      <input type="date"
                             className="gr-sig-input date-input"
                             value={revDate}
                             onChange={(e) => setRevDate(e.target.value)} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Approved by */}
              <div className="gr-sig">
                <div className="gr-sig-role">Approved by</div>
                <div className="gr-sig-line">
                  <input type="text"
                         className="gr-sig-input"
                         placeholder="[ Full name ]"
                         value={approvedBy}
                         onChange={(e) => setApprovedBy(e.target.value)} />
                </div>
                <div className="gr-sig-caption">
                  <div>
                    <div className="k">Title &amp; unit</div>
                    <div className="gr-sig-title-row">
                      <input type="text"
                             className="gr-sig-input title-input"
                             placeholder="e.g. Permanent Secretary"
                             value={approvedRole}
                             onChange={(e) => setApprovedRole(e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <div className="k">Date</div>
                    <div className="gr-sig-date-row">
                      <input type="date"
                             className="gr-sig-input date-input"
                             value={appDate}
                             onChange={(e) => setAppDate(e.target.value)} />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="gr-stamp">
              <span>
                <strong>Official stamp</strong> · affix before filing
              </span>
              <span>
                <ShieldCheck size={11} strokeWidth={2.4}
                  style={{ verticalAlign: -1, marginRight: 4 }} />
                MoH seal required
              </span>
            </div>
          </div>
        </SheetFrame>

      </div>
    </div>
  );
}
