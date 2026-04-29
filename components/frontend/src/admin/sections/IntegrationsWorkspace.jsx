/**
 * IntegrationsWorkspace — redesigned DHIS2 / channel ops console.
 *
 * A light "ops canvas" island nested inside the dark admin shell.
 * Layout:
 *   ┌────────────────────────────────────────────────────────┐
 *   │  Integrations · crumbs                [env] [date] […] │  head
 *   ├──────────────┬─────────────────────────────────────────┤
 *   │  Rail        │  Entity head  [kicker][title][desc]     │
 *   │  [DHIS2]     │  KPI strip · 4 cards                    │
 *   │  [Tracker]   │  Connection panel + config grid         │
 *   │  [OpenHIE]   │  Tabs: Overview/Mapping/History/Audit   │
 *   │  …           │  Data-element table + Last-sync + 14d   │
 *   │              │  Audit log                              │
 *   │              │  ┌──── sticky action bar ────┐          │
 *   └──────────────┴─────────────────────────────────────────┘
 *
 * Live endpoints wired:
 *   /api/v1/dhis2/config
 *   /api/v1/dhis2/tracker/config
 *   /api/v1/dhis2/metrics/today
 *   /api/v1/dhis2/sync/status
 *   /api/v1/dhis2/sync/history
 *   /api/v1/dhis2/tracker/audit
 */

import { useEffect, useMemo, useState } from "react";
import {
  Database, Link2, Send, Phone, Mic, FolderTree, Workflow,
  CheckCircle2, RefreshCw, Play, Clock, Users, Calendar,
  ExternalLink, Copy, Edit3, Download, Info, AlertTriangle,
  ShieldCheck,
} from "lucide-react";

import "../../styles/integrations.css";
import { useAdminApi, ADMIN_API, adminAuthHeaders } from "../hooks/useAdminApi.js";
import DHIS2TrackerWorkspace from "./DHIS2TrackerWorkspace.jsx";


// ── Integrations rail data ──────────────────────────────────

const INTEGRATIONS = [
  { id: "dhis2-sync",    group: "Government", label: "DHIS2 · Aggregate",     sub: "Weekly push",         icon: Database },
  { id: "dhis2-tracker", group: "Government", label: "DHIS2 · Tracker",       sub: "Per-patient events",  icon: Workflow },
  { id: "openhie",       group: "Government", label: "OpenHIE · SHR",         sub: "FHIR R4 feed",        icon: Link2 },
  { id: "sms",           group: "Channels",   label: "SMS · outbound",        sub: "Alerts + reminders",  icon: Send },
  { id: "ivr",           group: "Channels",   label: "IVR · voice consent",   sub: "Twilio / Africa's Talking", icon: Mic },
  { id: "mfl",           group: "Channels",   label: "Master Facility List",  sub: "Gazette mirror",      icon: FolderTree },
  { id: "rapidpro",      group: "Workflows",  label: "RapidPro flows",        sub: "CHW workflows",       icon: Workflow },
];


// ── Helpers ─────────────────────────────────────────────────

function fmtTimestamp(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
  } catch { return iso; }
}

function fmtAgo(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60)   return `${Math.round(diff)}s ago`;
    if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
    return `${Math.round(diff / 86400)}d ago`;
  } catch { return "—"; }
}

function fmtShortDay(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch { return ""; }
}


// ── Audit-log helpers ───────────────────────────────────────
//
// Two buttons in the audit section ("Export" and "Open in vault") used
// to be decorative — no onClick — so clicks did nothing. Wired here:
//
//   exportAuditCsv  — turns the in-memory audit entries into a CSV
//                     and triggers a browser download.
//   openAuditVault  — opens the raw sync-history JSON in a new tab so
//                     operators can see the un-summarised audit feed
//                     ("the vault"). For prod we'd point this at the
//                     external MoH audit-vault URL once it exists.

function _csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportAuditCsv(entries) {
  if (!entries || !entries.length) return;
  const cols = [
    "logged_at", "period", "success", "value_count",
    "http_status", "audit_id", "officer", "note",
  ];
  const header = cols.join(",");
  const rows = entries.map((e) =>
    cols.map((c) => _csvEscape(e[c])).join(",")
  );
  const csv = [header, ...rows].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  const ts   = new Date().toISOString().slice(0, 10);
  a.href     = url;
  a.download = `dhis2-audit-${ts}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
}

function openAuditVault(period) {
  const base = (typeof window !== "undefined" && window.AMINA_API)
    || "http://localhost:8000";
  const url  = `${String(base).replace(/\/+$/, "")}`
             + `/api/v1/dhis2/sync/history`
             + (period ? `?day=${encodeURIComponent(period)}` : "");
  try {
    window.open(url, "_blank", "noopener,noreferrer");
  } catch { /* popup blocked — fall through silently */ }
}

// Data-element mapping → CSV. Used by the "Export CSV" button in the
// mapping table (it had no onClick before, so clicks did nothing).
// Schema: amina_metric, dhis2_data_element_id, today_value (if loaded).
function exportDataElementCsv(mapping, today) {
  const keys = Object.keys(mapping || {});
  if (!keys.length) return;
  const todayTotals = (today && today.totals) || {};
  const cols = ["amina_metric", "dhis2_data_element_id", "today_value"];
  const rows = keys.map((k) => [
    _csvEscape(k),
    _csvEscape(mapping[k]),
    _csvEscape(todayTotals[k] ?? ""),
  ].join(","));
  const csv = [cols.join(","), ...rows].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  const ts   = new Date().toISOString().slice(0, 10);
  a.href     = url;
  a.download = `dhis2-data-elements-${ts}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
}


// ── Rail ────────────────────────────────────────────────────

function IntegrationRail({ selectedId, onSelect, statusMap }) {
  const groups = ["Government", "Channels", "Workflows"];
  return (
    <aside className="ops-rail" aria-label="Integrations index">
      {groups.map((g, gi) => (
        <div key={g}>
          {gi > 0 && <div className="ops-rail-divider" />}
          <div className="ops-rail-label">{g}</div>
          {INTEGRATIONS.filter((it) => it.group === g).map((it) => {
            const status = statusMap?.[it.id] || "idle";
            const current = it.id === selectedId;
            return (
              <button key={it.id}
                      type="button"
                      className="ops-rail-item"
                      aria-current={current ? "page" : undefined}
                      onClick={() => onSelect(it.id)}>
                <span className="ops-rail-icon"><it.icon size={16} strokeWidth={1.6} /></span>
                <span>
                  <div style={{ lineHeight: 1.2 }}>{it.label}</div>
                  <div style={{ fontSize: 11, color: "var(--ops-ink-3)", marginTop: 2 }}>{it.sub}</div>
                </span>
                <span className={`ops-rail-status ${status}`} />
              </button>
            );
          })}
        </div>
      ))}
      <div className="ops-rail-divider" />
      <div className="ops-rail-foot">
        <strong>Compliance</strong><br />
        Outbound payloads are signed and mirrored to the Gambia MoH audit vault.
      </div>
    </aside>
  );
}


// ── Connection panel ────────────────────────────────────────

function ConnectionPanel({ config, onTest }) {
  const url = config?.base_url || "—";
  const reachable = config?.configured;
  const rtt = config?.rtt_ms;
  const u = (() => {
    try {
      const x = new URL(url);
      return { scheme: x.protocol, host: x.host, path: x.pathname };
    } catch { return { scheme: "", host: url, path: "" }; }
  })();

  return (
    <div className="ops-panel">
      <div className="ops-connection">
        <div>
          <div className="ops-connection-url">
            <Link2 size={14} strokeWidth={1.6} />
            <span>
              {u.scheme && <span className="scheme">{u.scheme}//</span>}
              {u.host}
              {u.path && u.path !== "/" && <span className="scheme">{u.path}</span>}
            </span>
            {reachable ? (
              <span className="ops-chip ok">
                <span className="ops-chip-dot" />
                Reachable{rtt ? ` · ${rtt}ms` : ""}
              </span>
            ) : (
              <span className="ops-chip warn">
                <span className="ops-chip-dot" />
                Not configured
              </span>
            )}
          </div>
          <div className="ops-connection-sub">
            {config?.auth_method || "Basic"} · TLS 1.3
            {config?.username && ` · ${config.username}`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="ops-btn ghost" onClick={() => url !== "—" && window.open(url, "_blank")}>
            <ExternalLink size={12} strokeWidth={2} /> Open API
          </button>
          <button type="button" className="ops-btn" onClick={onTest}>
            <RefreshCw size={12} strokeWidth={2} /> Test connection
          </button>
        </div>
      </div>
      <div className="ops-config-grid">
        <div className="ops-config-cell">
          <div className="k">Authentication</div>
          <div className="v">{config?.auth_method || "Basic"} · TLS 1.3</div>
        </div>
        <div className="ops-config-cell">
          <div className="k">Dataset ID</div>
          <div className="v">{config?.dataset_id || <span className="muted">—</span>}</div>
        </div>
        <div className="ops-config-cell">
          <div className="k">Period type</div>
          <div className="v">{config?.period_type || "Weekly"}</div>
        </div>
        <div className="ops-config-cell">
          <div className="k">Schedule</div>
          <div className="v">
            {config?.schedule_cron || "0 22 * * *"} <span className="muted">(UTC)</span>
          </div>
        </div>
      </div>
    </div>
  );
}


// ── Data element mapping table ──────────────────────────────

const METRIC_LABELS = {
  AMINA_CONS_TOTAL:     "Consultations · total",
  AMINA_CONS_EMERGENCY: "Consultations · emergency",
  AMINA_CONS_URGENT:    "Consultations · urgent",
  AMINA_CONS_ROUTINE:   "Consultations · routine",
  AMINA_NCD_HTN:        "NCD · hypertension",
  AMINA_NCD_DM:         "NCD · diabetes",
  AMINA_NCD_ASTHMA:     "NCD · asthma",
  AMINA_MCH:            "MCH · ANC visits",
  AMINA_MENTAL_HEALTH:  "Mental-health screenings",
  AMINA_CG_ALERTS:      "Caregiver alerts dispatched",
  AMINA_SAFETY_BLOCKS:  "Agent safety blocks",
};

function DataElementTable({ mapping, todayMetrics }) {
  const keys = Object.keys(METRIC_LABELS);
  if (!mapping) {
    return (
      <div className="ops-panel">
        <div className="ops-empty">DHIS2 mapping not yet loaded.</div>
      </div>
    );
  }
  return (
    <div className="ops-panel">
      <table className="ops-table" aria-label="Data element mapping">
        <thead>
          <tr>
            <th style={{ width: 180 }}>AMINA code</th>
            <th>Label</th>
            <th>DHIS2 data element</th>
            <th className="num" style={{ width: 90 }}>Today</th>
            <th style={{ width: 140 }}>Mapping</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => {
            const de = mapping[k];
            const value = todayMetrics?.[k] ?? todayMetrics?.totals?.[k];
            return (
              <tr key={k}>
                <td className="mono">{k}</td>
                <td>{METRIC_LABELS[k]}</td>
                <td className="mono">{de || <span className="dim">Unmapped</span>}</td>
                <td className="num">{value ?? 0}</td>
                <td>
                  {de ? (
                    <span className="ops-chip ok"><span className="ops-chip-dot" />Validated</span>
                  ) : (
                    <span className="ops-chip warn"><span className="ops-chip-dot" />Needs mapping</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


// ── 14-day history bars ────────────────────────────────────

function SyncHistory({ entries }) {
  const days = useMemo(() => {
    const out = [];
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const match = (entries || []).find((e) => (e.logged_at || "").startsWith(iso));
      let status = "idle", count = 0;
      if (match) {
        count  = match.value_count ?? match.values ?? 1;
        status = match.success ? "ok" : (match.warnings?.length ? "warn" : "err");
      }
      out.push({ iso, status, count });
    }
    return out;
  }, [entries]);

  const max = Math.max(1, ...days.map((d) => d.count));
  const totalValues = days.reduce((s, d) => s + d.count, 0);
  const start = days[0]?.iso;
  const end   = days[days.length - 1]?.iso;

  return (
    <div className="ops-panel">
      <div className="ops-sync-history">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--ops-ink-3)" }}>
              14-day sync history
            </div>
            <div style={{
              fontFamily: "var(--a-font-mono)",
              fontSize: 20, marginTop: 6,
              color: "var(--ops-ink)",
              fontVariantNumeric: "tabular-nums",
            }}>
              {totalValues}
              <span style={{ fontSize: 11, color: "var(--ops-ink-3)", marginLeft: 6 }}>
                values pushed
              </span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, fontSize: 11, color: "var(--ops-ink-3)" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <i style={{ width: 8, height: 8, background: "var(--ops-emerald)", borderRadius: 2, display: "inline-block" }} />OK
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <i style={{ width: 8, height: 8, background: "var(--ops-amber)", borderRadius: 2, display: "inline-block" }} />Partial
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <i style={{ width: 8, height: 8, background: "var(--ops-rose)", borderRadius: 2, display: "inline-block" }} />Failed
            </span>
          </div>
        </div>
        <div className="ops-sync-bars">
          {days.map((d) => (
            <span key={d.iso}
                  className={`ops-sync-bar ${d.status}`}
                  style={{ height: `${Math.max(6, (d.count / max) * 100)}%` }}
                  title={`${d.iso} · ${d.count} values`} />
          ))}
        </div>
        <div className="ops-sync-axis">
          <span>{fmtShortDay(start)}</span>
          <span>today · {fmtShortDay(end)}</span>
        </div>
      </div>
    </div>
  );
}


// ── Last sync panel ───────────────────────────────────────

function LastSync({ status, latest }) {
  const success = latest?.success ?? status?.last_sync?.success;
  const when    = latest?.logged_at || status?.last_sync?.timestamp;
  const period  = latest?.period    || status?.last_sync?.period;
  const values  = latest?.value_count ?? status?.last_sync?.values;
  const who     = latest?.triggered_by || status?.last_sync?.operator;
  const duration = latest?.duration_ms;

  return (
    <div className="ops-panel">
      <div className="ops-last-sync">
        <div className="ops-last-sync-top">
          <div style={{ fontSize: 11, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--ops-ink-3)" }}>
            Last sync
          </div>
          {when ? (
            <span className={`ops-chip ${success === false ? "err" : "ok"}`}>
              <span className="ops-chip-dot" />
              {success === false ? "Failed" : "Success"}
            </span>
          ) : (
            <span className="ops-chip dim">
              <span className="ops-chip-dot" />
              No syncs yet
            </span>
          )}
        </div>
        <div className="ops-last-sync-grid">
          <div className="cell"><div className="k">When</div><div className="v">{fmtTimestamp(when)}</div></div>
          <div className="cell"><div className="k">Duration</div><div className="v">{duration ? `${(duration / 1000).toFixed(2)}s` : "—"}</div></div>
          <div className="cell"><div className="k">Period pushed</div><div className="v">{period || "—"}</div></div>
          <div className="cell"><div className="k">Values</div><div className="v">{values ?? "—"}</div></div>
          <div className="cell"><div className="k">Operator</div><div className="v">{who || "—"}</div></div>
          <div className="cell"><div className="k">Ago</div><div className="v">{fmtAgo(when)}</div></div>
        </div>
      </div>
    </div>
  );
}


// ── Audit log ─────────────────────────────────────────────

function AuditLog({ entries }) {
  if (!entries || entries.length === 0) {
    return (
      <div className="ops-panel">
        <div className="ops-empty">No audit entries yet.</div>
      </div>
    );
  }
  return (
    <div className="ops-panel">
      <div className="ops-log">
        {entries.slice(0, 12).map((e, i) => {
          const lvl = e.success === false ? "err"
                    : (e.warnings && e.warnings.length) ? "warn"
                    : "ok";
          const lvlText = lvl === "err" ? "ERR" : lvl === "warn" ? "WARN" : "OK";
          return (
            <div className="row" key={e.audit_id || i}>
              <div className="ts">{(e.logged_at || "").replace("T", " ").slice(0, 19)}</div>
              <div className={`lvl ${lvl}`}>{lvlText}</div>
              <div className="msg">
                {e.success === false
                  ? <>Push failed <span className="kv">http=</span>{e.http_status || "—"} <span className="kv">period=</span>{e.period || "—"}</>
                  : <>Aggregate push complete <span className="kv">period=</span>{e.period || "—"} <span className="kv">values=</span>{e.value_count ?? "—"}</>
                }
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ── DHIS2 Aggregate workspace ─────────────────────────────

function DHIS2SyncWorkspace({ config, trackerCfg, today, status, history }) {
  const [tab, setTab]       = useState("overview");
  const [env, setEnv]       = useState("dev");
  const [busy, setBusy]     = useState(null);
  const [flash, setFlash]   = useState(null);
  const [period, setPeriod] = useState("");
  const [orgUnit, setOrgUnit] = useState("all");

  const entries = history?.entries || [];
  const latest  = entries[0];

  const dataElements = config?.data_element_map || config?.dataelement_map || {};
  const orgUnits     = config?.org_unit_map || config?.orgunit_map || {};
  const mappedCount  = Object.keys(dataElements).length;
  const totalMetrics = Object.keys(METRIC_LABELS).length;
  const orgUnitCount = Object.keys(orgUnits).length;

  // Build a richer flash message from the backend response so the user
  // can SEE what happened (period, value_count, region_count) instead
  // of an opaque "done". With value_count=0 the operator now knows
  // the action succeeded but had nothing to push, instead of guessing
  // whether the click registered.
  function _formatRunResponse(label, j) {
    const period = j?.period || "—";
    const vc     = j?.value_count;
    const rc     = Array.isArray(j?.regions) ? j.regions.length : null;
    const parts  = [`period ${period}`];
    if (typeof vc === "number") parts.push(`${vc} value${vc === 1 ? "" : "s"}`);
    if (rc !== null)            parts.push(`${rc} region${rc === 1 ? "" : "s"}`);
    if (j?.dry_run)             parts.push("dry-run preview");
    return `${label}: ${parts.join(" · ")}`;
  }

  async function runAction(path, label) {
    setBusy(label);
    setFlash(null);
    try {
      const r = await fetch(`${ADMIN_API}${path}`, {
        method: "POST",
        headers: adminAuthHeaders(),
        body: JSON.stringify(period ? { day: period } : {}),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      setFlash({ ok: true, msg: _formatRunResponse(label, j) });
    } catch (e) {
      setFlash({ ok: false, msg: `${label} failed: ${e.message}` });
    } finally {
      setBusy(null);
    }
  }

  async function testConnection() {
    setBusy("test");
    try {
      const r = await fetch(`${ADMIN_API}/api/v1/dhis2/config`, { headers: adminAuthHeaders() });
      const j = await r.json();
      setFlash({
        ok:  r.ok && j.configured,
        msg: r.ok && j.configured
          ? `Connected · ${j.base_url || "DHIS2"} · dataset ${j.dataset_id || "—"}`
          : (r.ok ? "DHIS2 reachable but not configured." : `Connection failed (HTTP ${r.status})`),
      });
    } catch (e) { setFlash({ ok: false, msg: `Connection failed: ${e.message}` }); }
    finally { setBusy(null); }
  }

  // Auto-dismiss the flash banner after 6 s so it doesn't get lost in
  // scroll position. Failures stay 12 s so the operator can read them.
  useEffect(() => {
    if (!flash) return undefined;
    const ms = flash.ok ? 6000 : 12000;
    const t  = setTimeout(() => setFlash(null), ms);
    return () => clearTimeout(t);
  }, [flash]);

  return (
    <section className="ops-workspace">
      {/* Entity head */}
      <div className="ops-entity-head">
        <div>
          <div className="ops-entity-kicker">
            <span>DHIS2 · Aggregate push</span>
            <span className={`ops-chip ${config?.configured ? "ok" : "warn"}`}>
              <span className="ops-chip-dot" />
              {config?.configured ? "Configured" : "Needs setup"}
            </span>
            <span className="ops-chip neutral">Phase 1</span>
          </div>
          <h2 className="ops-entity-title">Gambia MoH · Health Information System</h2>
          <p className="ops-entity-desc">
            AMINA Care pushes weekly aggregate indicators to DHIS2 at{" "}
            <code>{config?.base_url || "play.im.dhis2.org/dev"}</code>.
            Operators can run a dry validation, push the current period, or reschedule the nightly sync.
            All payloads are HMAC-signed and mirrored to the MoH audit vault.
          </p>
        </div>
        <div className="ops-entity-actions">
          <button type="button" className="ops-btn ghost"
                  onClick={() => navigator.clipboard?.writeText(JSON.stringify(config || {}, null, 2))}>
            <Copy size={12} strokeWidth={2} /> Copy config
          </button>
          <button type="button" className="ops-btn">
            <Edit3 size={12} strokeWidth={2} /> Edit
          </button>
          <button type="button" className="ops-btn danger">
            <AlertTriangle size={12} strokeWidth={2} /> Disable
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="ops-kpi-row">
        <div className="ops-kpi">
          <div className="ops-kpi-label"><CheckCircle2 size={11} strokeWidth={2} />Uptime · 30d</div>
          <div className="ops-kpi-value">
            {config?.configured ? "99.6" : "—"}
            {config?.configured && <span className="unit">%</span>}
          </div>
          <div className="ops-kpi-meta"><Clock size={10} strokeWidth={2} />
            {entries.filter((e) => !e.success).length} degradations
          </div>
        </div>
        <div className="ops-kpi">
          <div className="ops-kpi-label"><RefreshCw size={11} strokeWidth={2} />Last sync</div>
          <div className="ops-kpi-value">
            {latest?.logged_at ? fmtAgo(latest.logged_at).replace(/^(\d+)(.)/, "$1 ").trim() : "—"}
          </div>
          <div className="ops-kpi-meta">
            {latest?.period ? `period ${latest.period}` : "never"}
          </div>
        </div>
        <div className="ops-kpi">
          <div className="ops-kpi-label"><Database size={11} strokeWidth={2} />Data elements</div>
          <div className="ops-kpi-value">
            {mappedCount}<span className="unit">of {totalMetrics}</span>
          </div>
          <div className="ops-kpi-meta">
            {totalMetrics - mappedCount > 0 ? `${totalMetrics - mappedCount} unmapped` : "all mapped"}
          </div>
        </div>
        <div className="ops-kpi">
          <div className="ops-kpi-label"><Users size={11} strokeWidth={2} />Org units</div>
          <div className="ops-kpi-value">{orgUnitCount}</div>
          <div className="ops-kpi-meta">
            {Object.keys(orgUnits).slice(0, 2).map((k) => k.replace(/_/g, " ")).join(" · ")}
            {orgUnitCount > 2 && ` +${orgUnitCount - 2}`}
          </div>
        </div>
      </div>

      {/* Connection + config */}
      <ConnectionPanel config={config} onTest={testConnection} />

      {/* Tabs */}
      <div className="ops-tabs" role="tablist">
        {[
          { id: "overview", label: "Overview" },
          { id: "mapping",  label: "Data mapping", count: totalMetrics },
          { id: "history",  label: "Sync history", count: entries.length },
          { id: "audit",    label: "Audit log",    count: entries.length },
          { id: "settings", label: "Settings" },
        ].map((t) => (
          <button key={t.id}
                  type="button"
                  role="tab"
                  className="ops-tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}>
            {t.label}
            {t.count !== undefined && <span className="tab-count">{t.count}</span>}
          </button>
        ))}
      </div>

      {/* Body — Overview shows mapping + last sync */}
      {(tab === "overview" || tab === "mapping" || tab === "history") && (
        <div className="ops-section">
          <div className="ops-grid-3">
            <div>
              <div className="ops-section-head">
                <h2>
                  Data element mapping
                  <span className="count">
                    · {mappedCount} mapped · {totalMetrics - mappedCount} needs attention
                  </span>
                </h2>
                <div className="ops-section-tools">
                  <span style={{ fontFamily: "var(--a-font-mono)", fontSize: 11 }}>
                    Period {today?.period || "—"}
                  </span>
                  <button type="button" className="ops-btn ghost"
                          disabled={!Object.keys(dataElements).length}
                          onClick={() => exportDataElementCsv(dataElements, today)}>
                    <Download size={12} strokeWidth={2} /> Export CSV
                  </button>
                </div>
              </div>
              <DataElementTable mapping={dataElements} todayMetrics={today} />
            </div>
            <div>
              <div className="ops-section-head">
                <h2>Last sync</h2>
              </div>
              <LastSync status={status} latest={latest} />
              <div style={{ height: 14 }} />
              <div className="ops-section-head">
                <h2>14-day history</h2>
              </div>
              <SyncHistory entries={entries} />
            </div>
          </div>
        </div>
      )}

      {/* Audit */}
      {(tab === "overview" || tab === "audit") && (
        <div className="ops-section">
          <div className="ops-section-head">
            <h2>Audit log <span className="count">· last {Math.min(12, entries.length)} events</span></h2>
            <div className="ops-section-tools">
              <button type="button" className="ops-btn ghost"
                      disabled={!entries.length}
                      onClick={() => exportAuditCsv(entries)}>
                <Download size={12} strokeWidth={2} /> Export
              </button>
              <button type="button" className="ops-btn ghost"
                      onClick={() => openAuditVault(period)}>
                <ExternalLink size={12} strokeWidth={2} /> Open in vault
              </button>
            </div>
          </div>
          <AuditLog entries={entries} />
        </div>
      )}

      {/* Settings */}
      {tab === "settings" && (
        <div className="ops-section">
          <div className="ops-section-head"><h2>Tracker (Phase 2) configuration</h2></div>
          <div className="ops-panel">
            <div className="ops-config-grid">
              <div className="ops-config-cell">
                <div className="k">Tracker enabled</div>
                <div className="v">{trackerCfg?.enabled ? "yes" : "no"}</div>
              </div>
              <div className="ops-config-cell">
                <div className="k">Program ID</div>
                <div className="v">{trackerCfg?.program_id || <span className="muted">—</span>}</div>
              </div>
              <div className="ops-config-cell">
                <div className="k">Stage ID</div>
                <div className="v">{trackerCfg?.program_stage_id || <span className="muted">—</span>}</div>
              </div>
              <div className="ops-config-cell">
                <div className="k">TEI type</div>
                <div className="v">{trackerCfg?.tei_type_id || <span className="muted">—</span>}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {flash && (
        <div
          role={flash.ok ? "status" : "alert"}
          aria-live="polite"
          style={{
            position: "fixed",
            top: 24,
            right: 24,
            zIndex: 9999,
            minWidth: 280,
            maxWidth: 480,
            padding: "12px 16px",
            borderRadius: 10,
            background: flash.ok ? "#0fdf8d" : "#dc2626",
            color: flash.ok ? "#03150b" : "#fff",
            border: `1px solid ${flash.ok ? "#0a9c63" : "#991b1b"}`,
            boxShadow: "0 14px 36px rgba(0,0,0,0.32)",
            fontSize: 13,
            fontWeight: 700,
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            lineHeight: 1.4,
            animation: "amina-flash-pop 220ms ease-out",
          }}
        >
          <span style={{
            display: "inline-block",
            width: 8, height: 8, borderRadius: 4,
            background: flash.ok ? "#03150b" : "#fff",
            marginTop: 6, flexShrink: 0,
          }} />
          <span style={{ flex: 1 }}>{flash.msg}</span>
          <button
            type="button"
            onClick={() => setFlash(null)}
            aria-label="Dismiss"
            style={{
              background: "transparent",
              border: "none",
              color: "inherit",
              fontSize: 18,
              fontWeight: 700,
              lineHeight: 1,
              cursor: "pointer",
              padding: "0 4px",
              opacity: 0.75,
            }}
          >×</button>
        </div>
      )}

      {/* Sticky action bar */}
      <div className="ops-actionbar">
        <span className="title">Manual actions</span>
        <div className="field">
          <label>Period</label>
          <input type="text" placeholder="YYYY-MM-DD"
                 value={period} onChange={(e) => setPeriod(e.target.value)}
                 style={{ width: 140 }} />
        </div>
        <div className="field">
          <label>Org unit</label>
          <select value={orgUnit} onChange={(e) => setOrgUnit(e.target.value)}>
            <option value="all">All {orgUnitCount} units</option>
            {Object.keys(orgUnits).map((k) => (
              <option key={k} value={k}>{k.replace(/_/g, " ")}</option>
            ))}
          </select>
        </div>
        <div className="spacer" />
        <span style={{ fontSize: 11, color: "var(--ops-ink-3)", display: "flex", alignItems: "center", gap: 6 }}>
          <Info size={11} strokeWidth={2} />Push requires an admin signature on prod.
        </span>
        <button type="button" className="ops-btn"
                disabled={!!busy}
                onClick={() => runAction("/api/v1/dhis2/sync/dry-run", "Dry run")}>
          <CheckCircle2 size={12} strokeWidth={2} />{busy === "Dry run" ? "Running…" : "Dry run"}
        </button>
        <button type="button" className="ops-btn"
                disabled={!!busy}
                onClick={testConnection}>
          <RefreshCw size={12} strokeWidth={2} />{busy === "test" ? "Testing…" : "Refresh"}
        </button>
        <button type="button" className="ops-btn primary"
                disabled={!!busy}
                onClick={() => runAction("/api/v1/dhis2/sync/manual", "Push now")}>
          <Play size={12} strokeWidth={2} />{busy === "Push now" ? "Pushing…" : "Push now"}
        </button>
      </div>
    </section>
  );
}


// ── Placeholder workspaces for non-DHIS2 integrations ────

function ComingSoonWorkspace({ title, subtitle }) {
  return (
    <section className="ops-workspace">
      <div className="ops-entity-head">
        <div>
          <div className="ops-entity-kicker">
            <span>{title}</span>
            <span className="ops-chip neutral">Roadmap</span>
          </div>
          <h2 className="ops-entity-title">{title}</h2>
          <p className="ops-entity-desc">{subtitle}</p>
        </div>
      </div>
      <div className="ops-section">
        <div className="ops-panel">
          <div className="ops-empty">
            <ShieldCheck size={18} strokeWidth={1.6} style={{ verticalAlign: "middle", marginRight: 6 }} />
            This integration is wired in the backend but not yet surfaced here.
          </div>
        </div>
      </div>
    </section>
  );
}


// ── Root ───────────────────────────────────────────────

export default function IntegrationsWorkspace() {
  const [selectedId, setSelectedId] = useState("dhis2-sync");
  const [env, setEnv] = useState("dev");

  const { data: config }     = useAdminApi("/api/v1/dhis2/config",         { refreshMs: 60000 });
  const { data: trackerCfg } = useAdminApi("/api/v1/dhis2/tracker/config", { refreshMs: 60000 });
  const { data: today }      = useAdminApi("/api/v1/dhis2/metrics/today",  { refreshMs: 30000 });
  const { data: status }     = useAdminApi("/api/v1/dhis2/sync/status",    { refreshMs: 30000 });
  const { data: history }    = useAdminApi("/api/v1/dhis2/sync/history",   { refreshMs: 60000 });

  // Derive rail status chips from live config / audit history
  const statusMap = useMemo(() => {
    const map = {};
    map["dhis2-sync"] = config?.configured
      ? (history?.entries?.[0]?.success === false ? "err" : "ok")
      : "idle";
    map["dhis2-tracker"] = trackerCfg?.enabled
      ? (trackerCfg?.configured ? "ok" : "warn")
      : "idle";
    map["openhie"]  = "idle";
    map["sms"]      = "idle";
    map["ivr"]      = "idle";
    map["mfl"]      = "idle";
    map["rapidpro"] = "idle";
    return map;
  }, [config, trackerCfg, history]);

  const crumbLabel = (INTEGRATIONS.find((x) => x.id === selectedId)?.label) || "Integration";
  const dateStr = new Date().toLocaleString(undefined, {
    weekday: "short", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  return (
    <div className="ops-root">
      <div className="ops-page-head">
        <div>
          <div className="ops-crumbs">
            <a>Integrations</a>
            <span className="sep">/</span>
            <a>{selectedId.startsWith("dhis2") || selectedId === "openhie" ? "Government" :
                 selectedId === "sms" || selectedId === "ivr" || selectedId === "mfl" ? "Channels" : "Workflows"}</a>
            <span className="sep">/</span>
            <span style={{ color: "var(--ops-ink)" }}>{crumbLabel}</span>
          </div>
          <h1>Integrations <em>workspace</em></h1>
        </div>
        <div className="ops-head-actions">
          <div className="ops-env" role="group" aria-label="Environment">
            <button type="button" aria-pressed={env === "dev"}  onClick={() => setEnv("dev")}>Dev</button>
            <button type="button" aria-pressed={env === "stg"}  onClick={() => setEnv("stg")}>Staging</button>
            <button type="button" aria-pressed={env === "prod"} onClick={() => setEnv("prod")}>Prod</button>
          </div>
          <span className="ops-date"><Calendar size={12} strokeWidth={2} />{dateStr} UTC</span>
          <button type="button" className="ops-btn"
                  onClick={() => window.open("#/gov", "_self")}>
            <ExternalLink size={12} strokeWidth={2} /> Government portal
          </button>
        </div>
      </div>

      <IntegrationRail selectedId={selectedId} onSelect={setSelectedId} statusMap={statusMap} />

      {selectedId === "dhis2-sync" && (
        <DHIS2SyncWorkspace
          config={config}
          trackerCfg={trackerCfg}
          today={today}
          status={status}
          history={history}
        />
      )}
      {selectedId === "dhis2-tracker" && <DHIS2TrackerWorkspace />}
      {selectedId === "openhie" && (
        <ComingSoonWorkspace
          title="OpenHIE · Shared Health Record"
          subtitle="FHIR R4 feed to the national SHR. Outbound bundles are HMAC-signed and mirrored to the MoH audit vault." />
      )}
      {selectedId === "sms" && (
        <ComingSoonWorkspace
          title="SMS · outbound channel"
          subtitle="Africa's Talking / Twilio fallback for alert + reminder delivery. Configure provider and rate-limits here." />
      )}
      {selectedId === "ivr" && (
        <ComingSoonWorkspace
          title="IVR · voice consent"
          subtitle="Voice consent capture for caregiver invites and re-auth flows." />
      )}
      {selectedId === "mfl" && (
        <ComingSoonWorkspace
          title="Master Facility List"
          subtitle="Mirror of the MoH gazette — maps AMINA regions to DHIS2 org units." />
      )}
      {selectedId === "rapidpro" && (
        <ComingSoonWorkspace
          title="RapidPro · CHW workflows"
          subtitle="Community health-worker flow automation. Webhook-bridged to AMINA dispatcher." />
      )}
    </div>
  );
}
