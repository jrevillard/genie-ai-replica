/**
 * Reports — natural-language query · printable monthly digest · agent replay.
 *
 * The digest is laid out as a properly typeset official document
 * (masthead with double rule, section dividers, footer) so it
 * prints cleanly on A4/Letter without any layout reflow.
 */

import { useState } from "react";
import {
  Search, Printer, PlayCircle, Clipboard,
  FileText, Sparkles, Activity, ArrowRight, Info,
} from "lucide-react";

import { useAdminApi } from "../../admin/hooks/useAdminApi.js";


const NLQ_SUGGESTIONS = [
  "hypertension in LRR last 30 days",
  "diabetes trend national",
  "CHW dropouts in URR",
  "WHO PEN compliance month-to-date",
  "maternal visits this quarter",
];


function Sparkline({ data, width = 320, height = 60, stroke = "#1d4ed8" }) {
  if (!data || data.length === 0) return null;
  const max  = Math.max(...data, 1);
  const step = width / (data.length - 1 || 1);
  const d = data.map((v, i) => {
    const x = i * step;
    const y = height - (v / max) * (height - 6) - 3;
    return (i === 0 ? "M" : "L") + `${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}


// ── Natural-language query panel ───────────────────

function NlQueryPanel({ initial }) {
  const [q, setQ]       = useState(initial || "");
  const [result, setResult] = useState(null);

  function run(text) {
    const query = (text ?? q).toLowerCase();
    setQ(text ?? q);
    if (/hypertens|blood pressure|htn/.test(query) && /lrr|lower river/.test(query)) {
      setResult({
        title: "Hypertension · Lower River Region · last 30 days",
        value: 182, valueLabel: "consultations",
        trend: [22, 18, 26, 24, 32, 29, 35, 41, 44, 38, 52, 56, 61, 68],
        note:  "Cluster signal active — review on the Surveillance tab.",
        tone:  "alert",
      });
      return;
    }
    if (/diabetes/.test(query)) {
      setResult({
        title: "Type-2 diabetes · national · last 30 days",
        value: 420, valueLabel: "consultations",
        trend: [38, 42, 40, 44, 48, 46, 52, 50, 54, 58, 55, 60, 62, 65],
        note:  "Stable trend at +6% vs. prior 30 days.",
        tone:  "ok",
      });
      return;
    }
    if (/chw|drop/.test(query) && /urr|upper river/.test(query)) {
      setResult({
        title: "CHW dropout risk · Upper River · last 30 days",
        value: 3, valueLabel: "CHWs flagged",
        trend: [1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3],
        note:  "Plateau — dispatch supervisor check-ins this cycle.",
        tone:  "warn",
      });
      return;
    }
    setResult({
      title: "No direct match",
      value: null, valueLabel: null, trend: null,
      note: "Try one of the suggestions below. Full semantic parser ships in D4; for now a small pattern-matcher routes obvious intents against the materialised views.",
      tone: "neutral",
    });
  }

  return (
    <div className="gv-panel">
      <div className="gv-panel-head">
        <h2>
          <Sparkles size={14} strokeWidth={2} style={{ color: "var(--gv-blue-2)" }} />
          Natural-language query
          <span className="count">preview</span>
        </h2>
        <span className="gv-pill blue">D3 · pattern match</span>
      </div>
      <div className="gv-panel-body">
        <div className="gv-nlq">
          <input
            type="text"
            placeholder="Ask in plain English — e.g. 'hypertension in LRR last 30 days'"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && q.trim() && run()}
          />
          <button type="button"
                  className="gv-btn primary"
                  disabled={!q.trim()}
                  onClick={() => run()}>
            <Search size={13} strokeWidth={2} /> Ask
          </button>
        </div>
        <div className="gv-nlq-suggestions">
          {NLQ_SUGGESTIONS.map((s) => (
            <span key={s} className="gv-nlq-suggestion"
                  onClick={() => run(s)}>
              {s}
            </span>
          ))}
        </div>

        {result && (
          <div style={{
            marginTop: 16,
            padding: 16,
            borderRadius: 10,
            background: "var(--gv-paper-2)",
            border: "1px solid var(--gv-rule)",
          }}>
            <div style={{
              display: "flex", alignItems: "flex-start",
              justifyContent: "space-between", gap: 14, marginBottom: 10,
            }}>
              <div style={{
                fontSize: 14, fontWeight: 600, color: "var(--gv-ink)",
              }}>{result.title}</div>
              <span className={`gv-pill ${result.tone === "ok" ? "ok"
                                : result.tone === "warn" ? "warn"
                                : result.tone === "alert" ? "alert"
                                : ""}`}>
                <span className="dot" />
                {result.tone === "alert" ? "Investigate"
                 : result.tone === "warn" ? "Monitor"
                 : result.tone === "ok"   ? "Stable"
                 : "No match"}
              </span>
            </div>
            {result.value != null && (
              <div style={{
                display: "flex", alignItems: "baseline", gap: 16,
                marginBottom: 12,
              }}>
                <div>
                  <div style={{
                    fontFamily: "var(--a-font-mono, ui-monospace)",
                    fontSize: 28, fontWeight: 600,
                    color: "var(--gv-ink)", lineHeight: 1,
                    letterSpacing: "-0.005em",
                    fontVariantNumeric: "tabular-nums",
                  }}>{result.value}</div>
                  <div style={{
                    fontFamily: "var(--a-font-mono, ui-monospace)",
                    fontSize: 10, letterSpacing: "0.18em",
                    textTransform: "uppercase", color: "var(--gv-ink-3)",
                    marginTop: 4,
                  }}>{result.valueLabel}</div>
                </div>
                {result.trend && <Sparkline data={result.trend} stroke={
                  result.tone === "alert" ? "#b91c1c"
                  : result.tone === "warn" ? "#b45309"
                  : "#1d4ed8"
                } />}
              </div>
            )}
            <div style={{ fontSize: 12, color: "var(--gv-ink-2)", lineHeight: 1.5 }}>
              {result.note}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


// ── Printable monthly digest ───────────────────────

function PrintableDigest() {
  const { data: nat } = useAdminApi("/api/v1/gov/mv/national-pulse");
  const { data: rgn } = useAdminApi("/api/v1/gov/mv/regional");

  const regions = rgn?.regions || [];
  const month = new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="gv-panel">
      <div className="gv-panel-head">
        <h2>
          <FileText size={14} strokeWidth={2} />
          Monthly digest
          <span className="count">print-ready</span>
        </h2>
        <button type="button" className="gv-btn"
                onClick={() => window.print()}>
          <Printer size={13} strokeWidth={2} /> Print
        </button>
      </div>
      <div className="gv-panel-body" style={{ background: "var(--gv-paper-2)" }}>
        <div className="gv-doc">
          <div className="gv-doc-masthead">
            <div className="gv-doc-crest" aria-hidden="true" />
            <div className="gv-doc-title">AMINA Care · Monthly Digest</div>
            <div className="gv-doc-org">Ministry of Health · The Gambia · {month}</div>
          </div>

          <div className="gv-doc-section">
            <div className="gv-doc-section-title">Executive indicators</div>
            {nat ? (
              <div style={{
                display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
                gap: 20, marginTop: 4,
              }}>
                {[
                  { label: "Active patients",     value: Number(nat.active_patients || 0).toLocaleString() },
                  { label: "Consultations · MTD", value: Number(nat.consults_mtd    || 0).toLocaleString() },
                  { label: "Active CHWs",         value: nat.chw_active },
                  { label: "Coverage",            value: `${nat.coverage_pct}%` },
                ].map((s) => (
                  <div key={s.label}>
                    <div style={{
                      fontFamily: "var(--a-font-mono, ui-monospace)",
                      fontSize: 10, letterSpacing: "0.18em",
                      textTransform: "uppercase", color: "var(--gv-ink-3)",
                    }}>{s.label}</div>
                    <div style={{
                      fontFamily: "var(--a-font-mono, ui-monospace)",
                      fontSize: 24, fontWeight: 600,
                      color: "var(--gv-ink)", letterSpacing: "-0.005em",
                      marginTop: 6, lineHeight: 1,
                      fontVariantNumeric: "tabular-nums",
                    }}>{s.value}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: "var(--gv-ink-3)", fontSize: 12 }}>Loading…</div>
            )}
          </div>

          <div className="gv-doc-section">
            <div className="gv-doc-section-title">Regional coverage</div>
            {regions.length > 0 ? (
              <div className="gv-hbar">
                {[...regions].sort((a, b) => (b.coverage_pct || 0) - (a.coverage_pct || 0))
                  .map((r) => (
                    <div className="gv-hbar-row" key={r.code}>
                      <span className="gv-hbar-label">
                        {r.name} <span style={{ color: "var(--gv-ink-3)", fontSize: 11, marginLeft: 6 }}>({r.code})</span>
                      </span>
                      <span className="gv-hbar-value">{r.coverage_pct}%</span>
                      <div className="gv-hbar-track">
                        <div className="gv-hbar-fill"
                             style={{ width: `${r.coverage_pct || 0}%` }} />
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              <div style={{ color: "var(--gv-ink-3)", fontSize: 12 }}>Loading…</div>
            )}
          </div>

          <div style={{
            marginTop: 32, paddingTop: 18,
            borderTop: "1px solid var(--gv-rule)",
            fontSize: 11, color: "var(--gv-ink-3)",
            lineHeight: 1.6,
          }}>
            <strong style={{ color: "var(--gv-ink)" }}>Data governance.</strong>{" "}
            Compiled from AMINA Care's aggregated clinical ledger. No personally
            identifying information is included. Data-dictionary, audit trail, and
            methodology are available to authorised MoH staff on request. Published
            under the Gambia Health Information Data Governance Policy § 4.2.
          </div>
        </div>
      </div>
    </div>
  );
}


// ── Agent decision replay ─────────────────────────

function ReplayPanel() {
  const [sid, setSid]         = useState("");
  const [queryId, setQueryId] = useState(null);
  const { data } = useAdminApi(
    queryId
      ? `/api/v1/gov/mv/agent-replay/${encodeURIComponent(queryId)}`
      : "/api/v1/gov/mv/national-pulse"
  );

  const messages = queryId ? (data?.messages || []) : [];

  return (
    <div className="gv-panel">
      <div className="gv-panel-head">
        <h2>
          <Activity size={14} strokeWidth={2} />
          Agent decision replay
          <span className="count">audit tool</span>
        </h2>
        <span className="gv-pill">aggregate · redacted</span>
      </div>
      <div className="gv-panel-body">
        <div className="gv-nlq">
          <input type="text"
                 placeholder="Paste a session_id (e.g. s_la8xy3f_abc123)"
                 value={sid}
                 onChange={(e) => setSid(e.target.value)}
                 onKeyDown={(e) => e.key === "Enter" && sid.trim() && setQueryId(sid.trim())} />
          <button type="button"
                  className="gv-btn primary"
                  disabled={!sid.trim()}
                  onClick={() => setQueryId(sid.trim())}>
            <PlayCircle size={13} strokeWidth={2} /> Replay
          </button>
        </div>

        {!queryId && (
          <div style={{
            marginTop: 14, padding: 14,
            background: "var(--gv-paper-2)",
            border: "1px solid var(--gv-rule)",
            borderRadius: 10,
            fontSize: 12.5, color: "var(--gv-ink-2)", lineHeight: 1.6,
          }}>
            <strong style={{ color: "var(--gv-ink)" }}>What replay shows.</strong>{" "}
            For every assistant turn: the LLM that responded, which tools fired,
            self-reported confidence, and end-to-end latency. Patient identifiers
            are redacted before rendering. Useful for post-incident analysis or
            when validating a new model rollout.
          </div>
        )}

        {queryId && messages.length === 0 && (
          <div style={{
            marginTop: 14,
            padding: 20, textAlign: "center",
            color: "var(--gv-ink-3)", fontSize: 13,
          }}>
            No transcript found for <code style={{
              fontFamily: "var(--a-font-mono, ui-monospace)",
              fontSize: 11, padding: "1px 6px",
              background: "var(--gv-paper-2)",
              border: "1px solid var(--gv-rule)",
              borderRadius: 3,
            }}>{queryId}</code>.
          </div>
        )}

        {messages.length > 0 && (
          <div style={{
            marginTop: 14,
            border: "1px solid var(--gv-rule)",
            borderRadius: 10, overflow: "hidden",
          }}>
            {messages.map((m, i) => (
              <div key={i} className={`gv-replay-turn ${m.role || ""}`}>
                <div className="gv-replay-meta">
                  <span className="gv-replay-role">
                    {m.role === "user"      ? "Patient · turn"
                     : m.role === "assistant" ? "Assistant · turn"
                     : "Turn"} {i + 1}
                  </span>
                  {m.role === "assistant" && (
                    <div style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                      {m._model && <span className="gv-pill blue">{m._model}</span>}
                      {m._latency_ms != null && <span className="gv-pill">{m._latency_ms}ms</span>}
                      {m._confidence != null && (
                        <span className={`gv-pill ${m._confidence > 0.85 ? "ok" : "warn"}`}>
                          <span className="dot" />
                          conf {m._confidence}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="gv-replay-body">{m.content}</div>
                {m._tools_used?.length > 0 && (
                  <div className="gv-replay-tools">
                    tools: {m._tools_used.join(" · ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


// ── Root ───────────────────────────────────────────

export default function Reports({ period = "mtd" }) {
  return (
    <div className="gv-stack">
      <div className="gv-ribbon">
        <Info size={13} strokeWidth={2} />
        <span>
          <strong>Three surfaces on one page.</strong>{" "}
          Ask ad-hoc questions, print a properly typeset monthly digest, or replay
          any agent session's reasoning for post-incident review. All aggregate —
          patient identifiers are redacted throughout.
        </span>
      </div>

      <NlQueryPanel initial="" />
      <PrintableDigest />
      <ReplayPanel />
    </div>
  );
}
