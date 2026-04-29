/**
 * Evidence Layer — admin toggle card.
 * =====================================
 *
 * Privacy-safe observability + synthetic-eval layer with a hard
 * admin toggle. Rendered inside AgentLab.
 *
 * Toggle lifecycle:
 *   off  --enable--> loading  --warmup-->  on
 *   on   --disable--> reverting --flush--> off
 *   *    --error-->  error    (admin clears via Disable)
 *
 * Eval lifecycle (when ON):
 *   click "Run Synthetic Eval"    → POST /eval/run-synthetic (returns immediately)
 *                                    backend runs in a background task
 *   poll /eval/progress every 1.5s → progress bar + counters + cancel button
 *   on done                       → toast + auto-open polished ReportModal
 *
 * UX rules:
 *   - Default: OFF
 *   - Loading screen during enable; revert screen during disable
 *   - Toast prompts on success / error
 *   - Reports list shows last 5 runs; click to open in ReportModal
 *   - Cancel button mid-eval (best-effort)
 *
 * Patient/CHW UIs are unaffected. This card lives in admin-only AgentLab.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ShieldCheck, ShieldOff, Activity, Beaker, FileText,
  Loader2, AlertTriangle, CheckCircle2, X, StopCircle, History,
} from "lucide-react";

import { Card, Button, Badge, Pill, Stat } from "./primitives/index.jsx";
import { adminAuthHeaders, ADMIN_API } from "./hooks/useAdminApi.js";
import EvidenceReportModal from "./EvidenceReportModal.jsx";

// ─────────────────────────────────────────────────────────────────
// Endpoints
// ─────────────────────────────────────────────────────────────────
const STATUS_URL    = "/api/v1/admin/evidence/status";
const ENABLE_URL    = "/api/v1/admin/evidence/enable";
const DISABLE_URL   = "/api/v1/admin/evidence/disable";
const RUN_URL       = "/api/v1/admin/evidence/eval/run-synthetic";
const PROGRESS_URL  = "/api/v1/admin/evidence/eval/progress";
const CANCEL_URL    = "/api/v1/admin/evidence/eval/cancel";
const REPORTS_URL   = "/api/v1/admin/evidence/eval/reports";

const STATUS_POLL_MS   = 8000;     // steady state
const TOGGLE_POLL_MS   = 700;      // during enable/disable transition
const PROGRESS_POLL_MS = 1500;     // during eval run
const TOGGLE_TIMEOUT_MS = 30000;

// ─────────────────────────────────────────────────────────────────
// Fetch helpers
// ─────────────────────────────────────────────────────────────────
async function _get(url) {
  try {
    const r = await fetch(`${ADMIN_API}${url}`, { headers: adminAuthHeaders() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { error: j.detail || `HTTP ${r.status}` };
    return j;
  } catch (e) {
    return { error: String(e) };
  }
}
async function _post(url) {
  try {
    const r = await fetch(`${ADMIN_API}${url}`, {
      method: "POST",
      headers: adminAuthHeaders(),
      body: "{}",
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { error: j.detail || `HTTP ${r.status}` };
    return j;
  } catch (e) {
    return { error: String(e) };
  }
}

// ─────────────────────────────────────────────────────────────────
// Display helpers
// ─────────────────────────────────────────────────────────────────
function _stateTone(state) {
  if (state === "on")        return "success";
  if (state === "off")       return "neutral";
  if (state === "loading")   return "info";
  if (state === "reverting") return "warn";
  if (state === "error")     return "danger";
  return "neutral";
}
function _stateLabel(state) {
  if (state === "on")        return "Active";
  if (state === "off")       return "Off";
  if (state === "loading")   return "Loading…";
  if (state === "reverting") return "Reverting…";
  if (state === "error")     return "Error";
  return state || "Unknown";
}
function _fmtTs(ts) {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleString();
  } catch { return ts; }
}
function _fmtPct(v) {
  if (v == null) return "—";
  try { return `${(Number(v) * 100).toFixed(1)}%`; } catch { return "—"; }
}
function _scoreTone(v) {
  if (v == null) return "neutral";
  const pct = Number(v) * 100;
  if (pct >= 90) return "success";
  if (pct >= 70) return "info";
  if (pct >= 50) return "warn";
  return "danger";
}

// ─────────────────────────────────────────────────────────────────
// Modals
// ─────────────────────────────────────────────────────────────────
function TransitionModal({ kind }) {
  if (!kind) return null;
  const isLoading = kind === "loading";
  const title = isLoading
    ? "Loading AMINA Evidence Layer…"
    : "Reverting AMINA Evidence Layer…";
  const body = isLoading
    ? "Preparing privacy-safe tracing and synthetic NCD eval checks."
    : "Stopping trace capture and returning AMINA to normal runtime mode.";
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 2147483600,
      background: "rgba(6, 8, 20, 0.78)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        background: "var(--a-bg-elev-1)", border: "1px solid var(--a-border-2)",
        borderRadius: "var(--a-r-5)", padding: 32, minWidth: 380, maxWidth: 520,
        boxShadow: "0 20px 60px -10px rgba(0,0,0,0.6)",
        textAlign: "center", color: "var(--a-fg)",
      }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
          <Loader2 size={42}
            style={{ color: "var(--a-accent)", animation: "a-spin 1.1s linear infinite" }} />
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--a-fg-mute)", lineHeight: 1.5 }}>{body}</div>
      </div>
      <style>{`@keyframes a-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function Toast({ tone = "success", message, onClose }) {
  if (!message) return null;
  const accent = tone === "danger"  ? "var(--a-danger)"
              : tone === "warn"    ? "var(--a-warn)"
              : tone === "info"    ? "var(--a-info)"
              :                       "var(--a-success)";
  const Icon = tone === "danger" ? AlertTriangle : CheckCircle2;
  return (
    <div style={{
      position: "fixed", right: 24, bottom: 24, zIndex: 2147483640,
      background: "var(--a-bg-elev-2)", border: `1px solid ${accent}`,
      borderRadius: "var(--a-r-3)", padding: "12px 14px",
      display: "flex", alignItems: "center", gap: 10,
      color: "var(--a-fg)", maxWidth: 460,
      boxShadow: "0 10px 24px -8px rgba(0,0,0,0.6)",
    }}>
      <Icon size={18} style={{ color: accent, flexShrink: 0 }} />
      <div style={{ flex: 1, fontSize: 13, lineHeight: 1.4 }}>{message}</div>
      <button onClick={onClose} aria-label="Dismiss"
        style={{ background: "transparent", border: 0, color: "var(--a-fg-mute)",
                 cursor: "pointer", padding: 4 }}>
        <X size={14} />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Inline progress bar (during eval)
// ─────────────────────────────────────────────────────────────────
function EvalProgressPanel({ progress, onCancel, busy }) {
  if (!progress || !progress.running) return null;
  const total = progress.total || 0;
  const done = progress.done || 0;
  const pct = total > 0 ? Math.round((100.0 * done) / total) : 0;
  return (
    <div style={{
      marginTop: 12,
      background: "var(--a-bg-elev-2)",
      border: "1px solid var(--a-border-1)",
      borderRadius: "var(--a-r-3)",
      padding: 14,
    }}>
      <div style={{ display: "flex", alignItems: "center",
                     gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <Loader2 size={14}
          style={{ color: "var(--a-accent)",
                   animation: "a-spin 1.2s linear infinite" }} />
        <strong style={{ fontSize: 13 }}>Synthetic eval in progress</strong>
        <Badge tone="info">{done}/{total} ({pct}%)</Badge>
        {progress.cancel_requested && <Badge tone="warn">Cancelling…</Badge>}
        <div style={{ flex: 1 }} />
        <Button variant="secondary" size="sm" leadIcon={StopCircle}
          onClick={onCancel} disabled={busy || progress.cancel_requested}>
          {progress.cancel_requested ? "Cancelling…" : "Cancel eval"}
        </Button>
      </div>

      <div style={{
        height: 8, background: "var(--a-bg-elev-1)",
        borderRadius: 999, overflow: "hidden",
        border: "1px solid var(--a-border-1)",
      }}>
        <div style={{
          width: `${pct}%`, height: "100%",
          background: "linear-gradient(90deg, var(--a-accent), var(--a-info))",
          transition: "width 600ms ease-out",
        }} />
      </div>

      <div style={{ marginTop: 10, display: "flex",
                     gap: 14, fontSize: 12,
                     color: "var(--a-fg-mute)", flexWrap: "wrap" }}>
        <div>Passed so far: <strong style={{ color: "var(--a-success)" }}>
          {progress.passed || 0}</strong></div>
        <div>Failed: <strong style={{ color: "var(--a-danger)" }}>
          {progress.failed || 0}</strong></div>
        <div>Critical failures: <strong style={{
          color: progress.critical_failures ? "var(--a-danger)" : "var(--a-fg)" }}>
          {progress.critical_failures || 0}</strong></div>
        {progress.current_case_id && (
          <div>Current: <code style={{ color: "var(--a-fg)" }}>
            {progress.current_case_id}</code></div>
        )}
      </div>
      <style>{`@keyframes a-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Reports history
// ─────────────────────────────────────────────────────────────────
function ReportsListPanel({ reports, onOpen }) {
  if (!reports || reports.length === 0) return null;
  return (
    <div style={{
      marginTop: 12,
      background: "var(--a-bg-elev-2)",
      border: "1px solid var(--a-border-1)",
      borderRadius: "var(--a-r-3)",
      padding: 14,
    }}>
      <div style={{ display: "flex", alignItems: "center",
                     gap: 8, marginBottom: 10 }}>
        <History size={14} style={{ color: "var(--a-accent)" }} />
        <strong style={{ fontSize: 13 }}>Recent eval reports</strong>
        <Badge tone="neutral">{reports.length}</Badge>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {reports.slice(0, 5).map((r) => (
          <button key={r.filename_md} onClick={() => onOpen(r.filename_md)}
            style={{
              display: "flex", alignItems: "center", gap: 12,
              background: "var(--a-bg-elev-1)",
              border: "1px solid var(--a-border-1)",
              borderRadius: "var(--a-r-2)",
              padding: "8px 10px", cursor: "pointer",
              color: "var(--a-fg)", textAlign: "left",
              fontFamily: "inherit",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.borderColor = "var(--a-border-2)";
              e.currentTarget.style.background = "var(--a-bg-elev-2)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.borderColor = "var(--a-border-1)";
              e.currentTarget.style.background = "var(--a-bg-elev-1)";
            }}>
            <FileText size={14} style={{ color: "var(--a-fg-mute)", flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontFamily: "var(--a-font-mono)",
                             color: "var(--a-fg)", overflow: "hidden",
                             textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.filename_md}
              </div>
              <div style={{ fontSize: 11, color: "var(--a-fg-dim)" }}>
                {_fmtTs(r.finished_at || r.mtime)}
              </div>
            </div>
            {r.score != null
              ? <Badge tone={_scoreTone(r.score)}>{_fmtPct(r.score)}</Badge>
              : <Badge tone="neutral">no score</Badge>}
            {r.critical_failures > 0 && (
              <Badge tone="danger">{r.critical_failures} crit</Badge>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Main card
// ─────────────────────────────────────────────────────────────────
export default function EvidenceLayerCard() {
  const [status,  setStatus]  = useState(null);
  const [progress, setProgress] = useState({ running: false });
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState(null);
  const [transition, setTransition] = useState(null);
  const [toast,   setToast]   = useState(null);
  const [reportFilename, setReportFilename] = useState(null);
  const [autoFedSummary, setAutoFedSummary] = useState(null);

  const lastEvalIdRef = useRef(null);
  const everSawRunningRef = useRef(false);

  // ── Status poll ───────────────────────────────────────────────
  const refreshStatus = useCallback(async () => {
    const j = await _get(STATUS_URL);
    if (j.error) { setErr(j.error); setLoading(false); return null; }
    setStatus(j); setErr(null); setLoading(false);
    return j;
  }, []);

  // ── Reports refresh ───────────────────────────────────────────
  const refreshReports = useCallback(async () => {
    const j = await _get(REPORTS_URL);
    if (j.error) return;
    setReports(Array.isArray(j.reports) ? j.reports : []);
  }, []);

  // ── Progress poll ─────────────────────────────────────────────
  const refreshProgress = useCallback(async () => {
    const j = await _get(PROGRESS_URL);
    if (j.error) return null;
    setProgress(j);
    return j;
  }, []);

  // ── Initial load ──────────────────────────────────────────────
  useEffect(() => {
    refreshStatus();
    refreshProgress();
    refreshReports();
  }, [refreshStatus, refreshProgress, refreshReports]);

  // ── Steady-state poll for status + progress ───────────────────
  useEffect(() => {
    const fast = progress?.running;
    const tickMs = fast ? PROGRESS_POLL_MS : STATUS_POLL_MS;
    const t = setInterval(() => {
      refreshStatus();
      refreshProgress();
    }, tickMs);
    return () => clearInterval(t);
  }, [progress?.running, refreshStatus, refreshProgress]);

  // ── Auto-open report modal when an eval just completed ─────────
  useEffect(() => {
    if (progress?.running) {
      everSawRunningRef.current = true;
      lastEvalIdRef.current = progress.eval_id || lastEvalIdRef.current;
      return;
    }
    // running just turned false — and we previously saw it true
    if (everSawRunningRef.current && progress && !progress.running) {
      everSawRunningRef.current = false;
      const fs = progress.final_summary;
      if (fs) {
        const path = progress.final_report_path || "";
        const filename = path.split(/[\\/]/).pop();
        const pct = fs.overall_pass_rate != null
          ? `${(fs.overall_pass_rate * 100).toFixed(1)}%` : "n/a";
        const tone = progress.cancelled
          ? "warn"
          : (fs.critical_failures && fs.critical_failures > 0) ? "warn" : "success";
        const verb = progress.cancelled ? "cancelled" : "complete";
        setToast({
          tone,
          message: `Synthetic eval ${verb}: ${fs.passed}/${fs.total} passed (${pct}). `
                 + `Critical failures: ${fs.critical_failures || 0}. Report ready.`,
        });
        if (filename) {
          setAutoFedSummary(fs);
          setReportFilename(filename);
        }
        refreshReports();
        refreshStatus();
      } else if (progress.error) {
        setToast({ tone: "danger", message: `Eval failed: ${progress.error}` });
      }
    }
  }, [progress, refreshReports, refreshStatus]);

  // ── Toggle: enable ────────────────────────────────────────────
  const pollUntilState = useCallback(async (terminalSet, timeoutMs = TOGGLE_TIMEOUT_MS) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const j = await _get(STATUS_URL);
      if (j && !j.error && terminalSet.has(j.state)) return j;
      await new Promise(r => setTimeout(r, TOGGLE_POLL_MS));
    }
    return null;
  }, []);

  const handleEnable = useCallback(async () => {
    setTransition("loading"); setErr(null);
    const r = await _post(ENABLE_URL);
    if (r.error) {
      setTransition(null);
      setToast({ tone: "danger", message: `Enable failed: ${r.error}` });
      await refreshStatus(); return;
    }
    const final = await pollUntilState(new Set(["on", "error"]));
    setTransition(null);
    if (final && final.state === "on") {
      setStatus(final);
      setToast({
        tone: "success",
        message: "Evidence Layer enabled. Patient and CHW chats now generate privacy-safe traces.",
      });
      refreshReports();
    } else if (final && final.state === "error") {
      setStatus(final);
      setToast({ tone: "danger",
        message: `Enable failed: ${final.error || "warmup error"}` });
    } else {
      setToast({ tone: "warn", message: "Enable timed out — check backend logs." });
      await refreshStatus();
    }
  }, [pollUntilState, refreshStatus, refreshReports]);

  const handleDisable = useCallback(async () => {
    setTransition("reverting"); setErr(null);
    const r = await _post(DISABLE_URL);
    if (r.error) {
      setTransition(null);
      setToast({ tone: "danger", message: `Disable failed: ${r.error}` });
      await refreshStatus(); return;
    }
    const final = await pollUntilState(new Set(["off", "error"]));
    setTransition(null);
    if (final && final.state === "off") {
      setStatus(final);
      setToast({ tone: "success",
        message: "Evidence Layer disabled. AMINA is back to normal runtime behavior." });
    } else if (final && final.state === "error") {
      setStatus(final);
      setToast({ tone: "danger",
        message: `Disable failed: ${final.error || "flush error"}` });
    } else {
      setToast({ tone: "warn", message: "Disable timed out — check backend logs." });
      await refreshStatus();
    }
  }, [pollUntilState, refreshStatus]);

  // ── Eval: kick + cancel ───────────────────────────────────────
  const handleRunEval = useCallback(async () => {
    setToast({ tone: "info",
      message: "Synthetic eval started — running in the background." });
    const r = await _post(RUN_URL);
    if (r.error) {
      setToast({ tone: "danger", message: `Eval failed: ${r.error}` });
      return;
    }
    if (r.progress) setProgress(r.progress);
    everSawRunningRef.current = true;
    lastEvalIdRef.current = r.eval_id;
    refreshProgress();
  }, [refreshProgress]);

  const handleCancelEval = useCallback(async () => {
    const r = await _post(CANCEL_URL);
    if (r.error) {
      setToast({ tone: "danger", message: `Cancel failed: ${r.error}` });
      return;
    }
    setToast({ tone: "warn",
      message: "Cancellation requested — already-dispatched cases will finish." });
    refreshProgress();
  }, [refreshProgress]);

  const openReport = useCallback((filename) => {
    setAutoFedSummary(null);   // force fresh GET for browsed reports
    setReportFilename(filename);
  }, []);
  const closeReport = useCallback(() => {
    setReportFilename(null);
    setAutoFedSummary(null);
  }, []);

  // ── Derived ────────────────────────────────────────────────────
  const state = status?.state || "off";
  const isOn  = state === "on";
  const isOff = state === "off";
  const busy  = transition != null;
  const evalRunning = progress?.running === true;

  const latestReport = reports && reports[0];
  const lastScore = status?.last_eval_score ?? latestReport?.score ?? null;

  // ── Render ─────────────────────────────────────────────────────
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "flex-start",
                     justifyContent: "space-between", gap: 16, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {isOn
            ? <ShieldCheck size={20} style={{ color: "var(--a-success)" }} />
            : <ShieldOff   size={20} style={{ color: "var(--a-fg-mute)" }} />}
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--a-fg)" }}>
              Evidence Layer
            </div>
            <div style={{ fontSize: 11, color: "var(--a-fg-dim)" }}>
              Privacy-safe traces + synthetic NCD evals · Admin-controlled
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {evalRunning && <Badge tone="info">Eval running</Badge>}
          <Badge tone={_stateTone(state)}>{_stateLabel(state)}</Badge>
        </div>
      </div>

      <div style={{ fontSize: 12, color: "var(--a-fg-mute)",
                     lineHeight: 1.55, marginBottom: 14 }}>
        Captures privacy-safe traces and runs synthetic protocol evals.
        <strong style={{ color: "var(--a-fg)" }}> Does not store raw patient conversations.</strong>
        {" "}Used to validate NCD safety, privacy, provider latency, and fallback behavior.
        When OFF, AMINA runs normally and capture stops.
      </div>

      {err && (
        <div style={{ background: "rgba(248,113,113,0.08)",
                       border: "1px solid var(--a-danger)", color: "var(--a-fg)",
                       borderRadius: "var(--a-r-3)", padding: 10, marginBottom: 12,
                       fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <AlertTriangle size={14} style={{ color: "var(--a-danger)" }} />
          {err}
        </div>
      )}

      {status?.error && state === "error" && (
        <div style={{ background: "rgba(248,113,113,0.08)",
                       border: "1px solid var(--a-danger)", color: "var(--a-fg)",
                       borderRadius: "var(--a-r-3)", padding: 10, marginBottom: 12,
                       fontSize: 12, fontFamily: "var(--a-font-mono)" }}>
          {status.error}
        </div>
      )}

      <div style={{ display: "grid",
                     gridTemplateColumns: "repeat(4, 1fr)",
                     gap: 10, marginBottom: 14 }}>
        <Stat label="Current state"   value={_stateLabel(state)} />
        <Stat label="Last enabled by" value={status?.last_enabled_by || "—"} />
        <Stat label="Last changed"    value={_fmtTs(status?.last_changed_at)} />
        <Stat label="Last eval score" value={_fmtPct(lastScore)} />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {isOff && (
          <Button variant="primary" leadIcon={ShieldCheck}
            onClick={handleEnable} disabled={busy || loading}>
            Enable Evidence Layer
          </Button>
        )}
        {isOn && (
          <>
            <Button variant="secondary" leadIcon={ShieldOff}
              onClick={handleDisable} disabled={busy || evalRunning}>
              Disable
            </Button>
            <Button variant="secondary" leadIcon={Beaker}
              onClick={handleRunEval} disabled={busy || evalRunning}>
              {evalRunning ? "Running…" : "Run Synthetic Eval"}
            </Button>
            {latestReport && !evalRunning && (
              <Button variant="ghost" leadIcon={FileText}
                onClick={() => openReport(latestReport.filename_md)}>
                View Latest Report
              </Button>
            )}
          </>
        )}
        {state === "error" && (
          <Button variant="secondary" leadIcon={ShieldOff}
            onClick={handleDisable} disabled={busy}>
            Reset to Off
          </Button>
        )}
        {(state === "loading" || state === "reverting") && (
          <Pill>
            <Activity size={12} style={{ marginRight: 6, color: "var(--a-accent)" }} />
            transitioning · {state}
          </Pill>
        )}
        <div style={{ flex: 1 }} />
        <Pill>backend: {status?.persistence_backend || "—"}</Pill>
        <Pill>recent traces: {status?.trace_count_recent ?? 0}</Pill>
      </div>

      <EvalProgressPanel progress={progress}
        onCancel={handleCancelEval} busy={busy} />

      {!evalRunning && reports.length > 0 && (
        <ReportsListPanel reports={reports} onOpen={openReport} />
      )}

      <TransitionModal kind={transition} />
      <Toast tone={toast?.tone} message={toast?.message}
        onClose={() => setToast(null)} />
      {reportFilename && (
        <EvidenceReportModal
          filename={reportFilename}
          autoLoadedSummary={autoFedSummary}
          autoLoadedFilename={reportFilename}
          onClose={closeReport}
        />
      )}
    </Card>
  );
}
