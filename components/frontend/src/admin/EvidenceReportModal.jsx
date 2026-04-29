/**
 * EvidenceReportModal — full-screen viewer for a synthetic eval report.
 *
 * Renders the structured JSON sidecar (aggregate cards + per-case
 * table). Falls back to rendering the markdown body verbatim when the
 * sidecar is missing (older reports). Always offers a one-click
 * markdown download.
 */

import { useEffect, useMemo, useState } from "react";
import {
  X, Download, ShieldCheck, AlertTriangle, ListChecks,
  CheckCircle2, XCircle, MinusCircle, FileText, Search,
} from "lucide-react";

import { Card, Stat, Badge, Pill, Button } from "./primitives/index.jsx";
import { adminAuthHeaders, ADMIN_API } from "./hooks/useAdminApi.js";

const REPORT_URL = (filename) =>
  `/api/v1/admin/evidence/eval/report/${encodeURIComponent(filename)}`;

function _fmtPct(v) {
  if (v == null) return "—";
  try { return `${(Number(v) * 100).toFixed(1)}%`; } catch { return "—"; }
}
function _fmtTs(ts) {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleString();
  } catch { return ts; }
}
function _scoreTone(v) {
  if (v == null) return "neutral";
  const pct = Number(v) * 100;
  if (pct >= 90) return "success";
  if (pct >= 70) return "info";
  if (pct >= 50) return "warn";
  return "danger";
}

function PassIcon({ ok }) {
  if (ok === true)  return <CheckCircle2 size={14} style={{ color: "var(--a-success)" }} />;
  if (ok === false) return <XCircle      size={14} style={{ color: "var(--a-danger)"  }} />;
  return <MinusCircle size={14} style={{ color: "var(--a-fg-dim)" }} />;
}

export default function EvidenceReportModal({ filename, onClose, autoLoadedSummary, autoLoadedFilename }) {
  // The card may pre-feed a freshly-completed summary so we render
  // instantly before the GET round-trip resolves.
  const [data, setData]   = useState(autoLoadedSummary
    ? { summary: autoLoadedSummary, results: autoLoadedSummary.results || [], markdown: null,
        filename_md: autoLoadedFilename || filename }
    : null);
  const [loading, setLoading] = useState(!autoLoadedSummary);
  const [err, setErr] = useState(null);
  const [filter, setFilter] = useState("");
  const [showOnlyFails, setShowOnlyFails] = useState(false);

  useEffect(() => {
    if (!filename) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const r = await fetch(`${ADMIN_API}${REPORT_URL(filename)}`, {
          headers: adminAuthHeaders(),
        });
        const j = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) {
          setErr(j.detail || `HTTP ${r.status}`);
        } else {
          setData(j);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled) setErr(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [filename]);

  // Esc to close
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose && onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const summary = data?.summary || null;
  const results = Array.isArray(data?.results) ? data.results : [];

  const filtered = useMemo(() => {
    let r = results;
    if (showOnlyFails) r = r.filter(x => !x.passed);
    if (filter) {
      const q = filter.toLowerCase();
      r = r.filter(x =>
           (x.case_id || "").toLowerCase().includes(q)
        || (x.domain  || "").toLowerCase().includes(q)
        || (x.severity|| "").toLowerCase().includes(q)
        || (x.reason  || "").toLowerCase().includes(q)
      );
    }
    return r;
  }, [results, filter, showOnlyFails]);

  const downloadMd = async () => {
    const fn = data?.filename_md || filename;
    if (!fn) return;
    try {
      const r = await fetch(`${ADMIN_API}${REPORT_URL(fn)}?raw=true`, {
        headers: adminAuthHeaders(),
      });
      if (!r.ok) return;
      const text = await r.text();
      const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = fn;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 800);
    } catch {}
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 2147483620,
      background: "rgba(6, 8, 20, 0.85)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24,
    }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose && onClose(); }}>
      <div style={{
        background: "var(--a-bg-elev-1)", border: "1px solid var(--a-border-2)",
        borderRadius: "var(--a-r-5)", width: "min(1100px, 100%)",
        maxHeight: "92vh", display: "flex", flexDirection: "column",
        boxShadow: "0 30px 80px -10px rgba(0,0,0,0.7)",
        color: "var(--a-fg)",
      }}>
        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 12,
                      padding: "16px 20px",
                      borderBottom: "1px solid var(--a-border-1)" }}>
          <FileText size={18} style={{ color: "var(--a-accent)" }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>
              Evidence Eval Report
            </div>
            <div style={{ fontSize: 11, color: "var(--a-fg-dim)",
                          fontFamily: "var(--a-font-mono)" }}>
              {data?.filename_md || filename || "—"}
            </div>
          </div>
          <Button variant="secondary" size="sm" leadIcon={Download}
            onClick={downloadMd} disabled={!data?.filename_md && !filename}>
            Download .md
          </Button>
          <button onClick={onClose} aria-label="Close"
            style={{ background: "transparent", border: 0, color: "var(--a-fg-mute)",
                     cursor: "pointer", padding: 8, marginLeft: 4 }}>
            <X size={18} />
          </button>
        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
          {loading && (
            <div style={{ padding: 30, color: "var(--a-fg-mute)", textAlign: "center" }}>
              Loading report…
            </div>
          )}
          {err && (
            <div style={{ padding: 14, color: "var(--a-fg)",
                          background: "rgba(248,113,113,0.08)",
                          border: "1px solid var(--a-danger)",
                          borderRadius: "var(--a-r-3)",
                          display: "flex", alignItems: "center", gap: 10 }}>
              <AlertTriangle size={16} style={{ color: "var(--a-danger)" }} />
              {err}
            </div>
          )}

          {summary && (
            <>
              {/* Aggregate */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
                             gap: 12, marginBottom: 16 }}>
                <Card>
                  <Stat label="Overall pass rate"
                    value={_fmtPct(summary.overall_pass_rate)}
                    sub={`${summary.passed || 0} / ${summary.total || 0} passed`} />
                  <div style={{ marginTop: 6 }}>
                    <Badge tone={_scoreTone(summary.overall_pass_rate)}>
                      {_scoreTone(summary.overall_pass_rate) === "success" ? "Healthy"
                       : _scoreTone(summary.overall_pass_rate) === "info"    ? "OK"
                       : _scoreTone(summary.overall_pass_rate) === "warn"    ? "Watch"
                       : "Needs review"}
                    </Badge>
                  </div>
                </Card>
                <Card>
                  <Stat label="Critical failures"
                    value={summary.critical_failures ?? 0}
                    sub={summary.critical_failures
                      ? "Review each before relying on the layer"
                      : "No critical regressions"} />
                </Card>
                <Card>
                  <Stat label="Emergency surface"
                    value={_fmtPct(summary.emergency_pass_rate)}
                    sub="EMERGENCY-tagged cases that surfaced emergency intent" />
                </Card>
                <Card>
                  <Stat label="Privacy guard (guests)"
                    value={_fmtPct(summary.privacy_pass_rate)}
                    sub="Guest cases that did not leak personal records" />
                </Card>
              </div>

              {/* Run meta */}
              <Card>
                <div style={{ display: "grid",
                               gridTemplateColumns: "repeat(4, 1fr)",
                               gap: 10, fontSize: 12 }}>
                  <div>
                    <div style={{ color: "var(--a-fg-dim)", fontSize: 11,
                                   textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      Started
                    </div>
                    <div>{_fmtTs(summary.started_at)}</div>
                  </div>
                  <div>
                    <div style={{ color: "var(--a-fg-dim)", fontSize: 11,
                                   textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      Finished
                    </div>
                    <div>{_fmtTs(summary.finished_at)}</div>
                  </div>
                  <div>
                    <div style={{ color: "var(--a-fg-dim)", fontSize: 11,
                                   textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      Duration
                    </div>
                    <div>{summary.duration_s != null ? `${summary.duration_s.toFixed(1)}s` : "—"}</div>
                  </div>
                  <div>
                    <div style={{ color: "var(--a-fg-dim)", fontSize: 11,
                                   textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      Medication safety
                    </div>
                    <div>{_fmtPct(summary.medication_safety_pass_rate)}</div>
                  </div>
                </div>
                {Array.isArray(summary.notes) && summary.notes.length > 0 && (
                  <div style={{ marginTop: 10, fontSize: 12,
                                 color: "var(--a-fg-mute)", display: "flex",
                                 flexWrap: "wrap", gap: 6 }}>
                    {summary.notes.map((n, i) => (
                      <Pill key={i}>{n}</Pill>
                    ))}
                  </div>
                )}
              </Card>

              {/* Per-case table */}
              {results.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ display: "flex", alignItems: "center",
                                 gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <ListChecks size={16} style={{ color: "var(--a-accent)" }} />
                      <strong>Per-case results</strong>
                      <Badge tone="neutral">{filtered.length}/{results.length}</Badge>
                    </div>
                    <div style={{ flex: 1 }} />
                    <label style={{ display: "flex", alignItems: "center",
                                     gap: 6, fontSize: 12, color: "var(--a-fg-mute)" }}>
                      <input type="checkbox" checked={showOnlyFails}
                        onChange={(e) => setShowOnlyFails(e.target.checked)} />
                      Failures only
                    </label>
                    <div style={{ position: "relative" }}>
                      <Search size={12} style={{ position: "absolute", left: 8,
                        top: "50%", transform: "translateY(-50%)",
                        color: "var(--a-fg-dim)" }} />
                      <input
                        placeholder="filter id / domain / reason"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        style={{
                          background: "var(--a-bg-elev-2)",
                          border: "1px solid var(--a-border-1)",
                          color: "var(--a-fg)",
                          borderRadius: "var(--a-r-2)",
                          padding: "6px 10px 6px 26px",
                          fontSize: 12, minWidth: 220,
                        }} />
                    </div>
                  </div>

                  <div style={{ overflow: "auto",
                                 border: "1px solid var(--a-border-1)",
                                 borderRadius: "var(--a-r-3)" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse",
                                     fontSize: 12, color: "var(--a-fg)" }}>
                      <thead style={{ background: "var(--a-bg-elev-2)",
                                       fontSize: 11,
                                       textTransform: "uppercase",
                                       letterSpacing: "0.08em",
                                       color: "var(--a-fg-dim)" }}>
                        <tr>
                          <th style={{ textAlign: "left", padding: "8px 10px" }}>ID</th>
                          <th style={{ textAlign: "left", padding: "8px 10px" }}>Domain</th>
                          <th style={{ textAlign: "left", padding: "8px 10px" }}>Severity</th>
                          <th style={{ textAlign: "center", padding: "8px 10px" }}>Pass</th>
                          <th style={{ textAlign: "center", padding: "8px 10px" }}>Triage</th>
                          <th style={{ textAlign: "center", padding: "8px 10px" }}>Emergency</th>
                          <th style={{ textAlign: "center", padding: "8px 10px" }}>Privacy</th>
                          <th style={{ textAlign: "left", padding: "8px 10px" }}>Reason</th>
                          <th style={{ textAlign: "right", padding: "8px 10px" }}>Latency</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((r, i) => (
                          <tr key={r.case_id || i}
                            style={{ borderTop: "1px solid var(--a-border-1)",
                                     background: i % 2 ? "var(--a-bg-elev-2)" : "transparent" }}>
                            <td style={{ padding: "8px 10px",
                                          fontFamily: "var(--a-font-mono)",
                                          fontSize: 11 }}>{r.case_id}</td>
                            <td style={{ padding: "8px 10px" }}>{r.domain}</td>
                            <td style={{ padding: "8px 10px" }}>
                              <Badge tone={
                                r.severity === "critical" ? "danger"
                                : r.severity === "high"   ? "warn"
                                : r.severity === "medium" ? "info"
                                :                            "neutral"
                              }>{r.severity}</Badge>
                            </td>
                            <td style={{ padding: "8px 10px", textAlign: "center" }}>
                              <PassIcon ok={r.passed} />
                            </td>
                            <td style={{ padding: "8px 10px", textAlign: "center" }}>
                              <PassIcon ok={r.triage_match} />
                            </td>
                            <td style={{ padding: "8px 10px", textAlign: "center" }}>
                              <PassIcon ok={r.emergency_check_passed} />
                            </td>
                            <td style={{ padding: "8px 10px", textAlign: "center" }}>
                              <PassIcon ok={r.privacy_check_passed} />
                            </td>
                            <td style={{ padding: "8px 10px",
                                          color: "var(--a-fg-mute)",
                                          maxWidth: 320, overflow: "hidden",
                                          textOverflow: "ellipsis",
                                          whiteSpace: "nowrap" }}
                                title={r.reason}>{r.reason}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right",
                                          fontVariantNumeric: "tabular-nums" }}>
                              {r.latency_ms != null ? `${Math.round(r.latency_ms)}ms` : "—"}
                            </td>
                          </tr>
                        ))}
                        {filtered.length === 0 && (
                          <tr><td colSpan={9} style={{ padding: 14,
                              textAlign: "center", color: "var(--a-fg-dim)" }}>
                            No matching cases.
                          </td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Markdown fallback (older reports without sidecar) */}
              {results.length === 0 && data?.markdown && (
                <pre style={{ marginTop: 16, background: "var(--a-bg-elev-2)",
                               border: "1px solid var(--a-border-1)",
                               borderRadius: "var(--a-r-3)", padding: 14,
                               fontSize: 11, color: "var(--a-fg)",
                               whiteSpace: "pre-wrap" }}>
                  {data.markdown}
                </pre>
              )}
            </>
          )}

          {!summary && !loading && data?.markdown && (
            <pre style={{ background: "var(--a-bg-elev-2)",
                           border: "1px solid var(--a-border-1)",
                           borderRadius: "var(--a-r-3)", padding: 14,
                           fontSize: 11, color: "var(--a-fg)",
                           whiteSpace: "pre-wrap" }}>
              {data.markdown}
            </pre>
          )}
        </div>

        {/* ── Footer ── */}
        <div style={{ padding: "10px 20px",
                       borderTop: "1px solid var(--a-border-1)",
                       fontSize: 11, color: "var(--a-fg-dim)",
                       display: "flex", alignItems: "center", gap: 8 }}>
          <ShieldCheck size={12} style={{ color: "var(--a-success)" }} />
          Synthetic protocol-derived cases. No real PHI is included in this report.
        </div>
      </div>
    </div>
  );
}
