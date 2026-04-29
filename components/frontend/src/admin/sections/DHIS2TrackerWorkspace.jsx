/**
 * DHIS2TrackerWorkspace — the ops-canvas redesign of the legacy
 * "DHIS2 Tracker writeback" panel. Drops inside IntegrationsWorkspace
 * when the user selects the `dhis2-tracker` rail item.
 *
 * Sub-tabs:
 *   Config          · redacted view of /tracker/config env/config state
 *   Push patient    · dry-run + live push for a single patient
 *   Batch push      · up to 100 patients sequentially
 *   Tracker audit   · /tracker/audit log (filter by patient_id)
 *   Aggregate       · cross-reference /sync/history for context
 *   Discover        · /dhis2/discover live dataset listing
 */

import { useEffect, useMemo, useState } from "react";
import {
  Settings, Send, Layers, ClipboardList, Database,
  Compass, RefreshCw, Play, CheckCircle2, XCircle,
  ChevronDown, ChevronRight, Download, Search,
} from "lucide-react";

import {
  getConfig as getTrackerConfig,
  getAudit as getTrackerAudit,
  dryRun as trackerDryRun,
  pushPatient as trackerPush,
  pushBatch as trackerBatch,
  getAggregateHistory,
  getTrackerHistory,
  discoverDatasets,
  describeDataset,
} from "../dhis2TrackerApi.js";


// ── Helpers ──────────────────────────────────────────────

function fmtTs(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toISOString().replace("T", " ").slice(0, 19); }
  catch { return iso; }
}

function JsonBlock({ value, maxHeight = 240 }) {
  const s = useMemo(() => {
    if (value === undefined || value === null) return "(none)";
    try { return JSON.stringify(value, null, 2); }
    catch { return String(value); }
  }, [value]);
  return (
    <pre style={{
      fontFamily: "var(--a-font-mono)",
      fontSize: 11.5,
      lineHeight: 1.55,
      margin: 0,
      padding: 12,
      background: "var(--ops-paper-2)",
      border: "1px solid var(--ops-rule)",
      borderRadius: 6,
      color: "var(--ops-ink-2)",
      overflow: "auto",
      maxHeight,
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
    }}>{s}</pre>
  );
}


// ── Config tab ──────────────────────────────────────────

function ConfigTab({ cfg, onRefresh }) {
  const [rawOpen, setRawOpen] = useState(false);

  const configured = !!cfg?.configured;
  const enabled    = !!cfg?.enabled;

  const rows = [
    { k: "Enabled flag",     env: "",                                 v: enabled ? "true" : "false", ok: enabled },
    { k: "Tracker program ID",   env: "DHIS2_TRACKER_PROGRAM_ID",       v: cfg?.program_id,       ok: !!cfg?.program_id },
    { k: "Program stage ID",     env: "DHIS2_TRACKER_PROGRAM_STAGE_ID", v: cfg?.program_stage_id, ok: !!cfg?.program_stage_id },
    { k: "TEI type ID",          env: "DHIS2_TRACKER_TEI_TYPE_ID",      v: cfg?.tei_type_id,      ok: !!cfg?.tei_type_id },
    { k: "Attribute map",        env: "DHIS2_TRACKER_ATTRIBUTE_MAP (JSON)",
      v: cfg?.attribute_map && Object.keys(cfg.attribute_map).length
        ? `${Object.keys(cfg.attribute_map).length} entries` : "(empty)",
      ok: !!(cfg?.attribute_map && Object.keys(cfg.attribute_map).length) },
    { k: "Data element map",     env: "DHIS2_TRACKER_DATA_ELEMENT_MAP (JSON)",
      v: cfg?.data_element_map && Object.keys(cfg.data_element_map).length
        ? `${Object.keys(cfg.data_element_map).length} entries` : "(empty)",
      ok: !!(cfg?.data_element_map && Object.keys(cfg.data_element_map).length) },
    { k: "Org-unit map (shared with aggregate sync)", env: "DHIS2_ORG_UNIT_MAP (JSON)",
      v: cfg?.orgunit_count ? `${cfg.orgunit_count} entries` : "(empty)",
      ok: !!cfg?.orgunit_count },
  ];

  return (
    <>
      <div className="ops-section">
        <div className="ops-section-head">
          <h2>
            <span className={`ops-chip ${configured ? "ok" : "err"}`}>
              <span className="ops-chip-dot" />
              {configured ? "Tracker configured" : "Tracker disabled"}
            </span>
          </h2>
          <div className="ops-section-tools">
            <button type="button" className="ops-btn ghost" onClick={onRefresh}>
              <RefreshCw size={12} strokeWidth={2} /> Refresh
            </button>
          </div>
        </div>

        <div className="ops-panel">
          <table className="ops-table" aria-label="Tracker config">
            <thead>
              <tr>
                <th style={{ width: "38%" }}>Setting</th>
                <th>Value</th>
                <th style={{ width: 100 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.k}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{r.k}</div>
                    {r.env && (
                      <div style={{
                        fontFamily: "var(--a-font-mono)", fontSize: 11,
                        color: "var(--ops-ink-3)", marginTop: 3,
                      }}>{r.env}</div>
                    )}
                  </td>
                  <td className="mono">{r.v || <span className="dim">(not set)</span>}</td>
                  <td>
                    <span className={`ops-chip ${r.ok ? "ok" : "err"}`}>
                      <span className="ops-chip-dot" />
                      {r.ok ? "OK" : "missing"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {!configured && (
        <div className="ops-section">
          <div className="ops-panel" style={{
            background: "var(--ops-amber-soft)",
            borderColor: "rgba(180,83,9,0.20)",
            padding: 14,
            fontSize: 13,
            color: "var(--ops-amber)",
          }}>
            <strong>To enable:</strong> set the env vars above in{" "}
            <code style={{
              fontFamily: "var(--a-font-mono)", fontSize: 12,
              padding: "1px 5px", borderRadius: 3,
              background: "rgba(255,255,255,0.5)",
            }}>haystack-stack/.env</code>{" "}
            (look for the <code style={{
              fontFamily: "var(--a-font-mono)", fontSize: 12,
              padding: "1px 5px", borderRadius: 3,
              background: "rgba(255,255,255,0.5)",
            }}>DHIS2_*</code> block) then restart{" "}
            <code style={{
              fontFamily: "var(--a-font-mono)", fontSize: 12,
              padding: "1px 5px", borderRadius: 3,
              background: "rgba(255,255,255,0.5)",
            }}>haystack-chatqna</code>. The server reads these via{" "}
            <code style={{
              fontFamily: "var(--a-font-mono)", fontSize: 12,
              padding: "1px 5px", borderRadius: 3,
              background: "rgba(255,255,255,0.5)",
            }}>src/config.py</code> on startup.
          </div>
        </div>
      )}

      <div className="ops-section">
        <button type="button"
                className="ops-btn ghost"
                onClick={() => setRawOpen((o) => !o)}
                style={{ marginBottom: 10 }}>
          {rawOpen ? <ChevronDown size={12} strokeWidth={2} /> : <ChevronRight size={12} strokeWidth={2} />}
          {rawOpen ? "Hide" : "Show"} raw mapping JSON
        </button>
        {rawOpen && (
          <div className="ops-panel" style={{ padding: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <div style={{ fontSize: 10, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--ops-ink-3)", marginBottom: 6 }}>
                  attribute_map
                </div>
                <JsonBlock value={cfg?.attribute_map} />
              </div>
              <div>
                <div style={{ fontSize: 10, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--ops-ink-3)", marginBottom: 6 }}>
                  data_element_map
                </div>
                <JsonBlock value={cfg?.data_element_map} />
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}


// ── Push patient tab ───────────────────────────────────

function PushPatientTab() {
  const [patientId, setPatientId] = useState("");
  const [force, setForce]         = useState(false);
  const [busy, setBusy]           = useState(null);
  const [result, setResult]       = useState(null);

  async function run(kind) {
    if (!patientId.trim()) { setResult({ _error: "Please enter a patient ID." }); return; }
    setBusy(kind);
    setResult(null);
    const fn = kind === "dry" ? trackerDryRun : trackerPush;
    const r  = await fn(null, { patientId: patientId.trim(), force });
    setResult(r);
    setBusy(null);
  }

  const success = result && !result._error && (result.success !== false);

  return (
    <div className="ops-section">
      <div className="ops-section-head">
        <h2>Push a single patient</h2>
      </div>

      <div className="ops-panel" style={{ padding: 18 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: 10, alignItems: "center" }}>
          <input
            type="text"
            placeholder="patient_id e.g. PAT-42a9b1"
            value={patientId}
            onChange={(e) => setPatientId(e.target.value)}
            style={{
              height: 34, padding: "0 12px", borderRadius: 6,
              border: "1px solid var(--ops-rule-3)", background: "#fff",
              color: "var(--ops-ink)", fontFamily: "var(--a-font-mono)", fontSize: 13,
            }}
          />
          <label style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            fontSize: 12, color: "var(--ops-ink-2)",
          }}>
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
            Force (skip consent gate)
          </label>
          <button type="button" className="ops-btn"
                  disabled={!!busy}
                  onClick={() => run("dry")}>
            <CheckCircle2 size={12} strokeWidth={2} /> {busy === "dry" ? "Running…" : "Dry run"}
          </button>
          <button type="button" className="ops-btn primary"
                  disabled={!!busy}
                  onClick={() => run("push")}>
            <Play size={12} strokeWidth={2} /> {busy === "push" ? "Pushing…" : "Push live"}
          </button>
        </div>
      </div>

      {result && (
        <div style={{ marginTop: 14 }} className="ops-panel">
          <div style={{
            padding: "10px 14px", borderBottom: "1px solid var(--ops-rule)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {success ? (
                <CheckCircle2 size={16} strokeWidth={2} color="var(--ops-emerald)" />
              ) : (
                <XCircle size={16} strokeWidth={2} color="var(--ops-rose)" />
              )}
              <span style={{ fontWeight: 600, fontSize: 13 }}>
                {result._error ? "Error" : success ? "Success" : "Rejected"}
              </span>
              {result.tei_uid && (
                <span className="ops-chip info">
                  <span className="ops-chip-dot" />
                  TEI {result.tei_uid}
                </span>
              )}
            </div>
            {result._error && (
              <span style={{ color: "var(--ops-rose)", fontSize: 12 }}>{result._error}</span>
            )}
          </div>
          <div style={{ padding: 14 }}>
            <JsonBlock value={result} maxHeight={360} />
          </div>
        </div>
      )}
    </div>
  );
}


// ── Batch push tab ────────────────────────────────────

function BatchPushTab() {
  const [raw, setRaw]   = useState("");
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const ids = useMemo(() =>
    raw.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean),
    [raw]);

  async function run() {
    if (ids.length === 0) { setResult({ _error: "Paste 1–100 patient IDs above." }); return; }
    if (ids.length > 100) { setResult({ _error: "Max 100 patients per batch." });   return; }
    setBusy(true);
    setResult(null);
    const r = await trackerBatch(null, { patientIds: ids, force });
    setResult(r);
    setBusy(false);
  }

  return (
    <div className="ops-section">
      <div className="ops-section-head">
        <h2>Batch push <span className="count">· up to 100 patients per batch</span></h2>
      </div>

      <div className="ops-panel" style={{ padding: 16 }}>
        <textarea
          rows={6}
          placeholder="Paste patient IDs separated by commas, spaces, or newlines…"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          style={{
            width: "100%", boxSizing: "border-box",
            padding: 12, borderRadius: 6,
            border: "1px solid var(--ops-rule-3)", background: "#fff",
            fontFamily: "var(--a-font-mono)", fontSize: 12.5, lineHeight: 1.5,
            color: "var(--ops-ink)", resize: "vertical",
          }}
        />
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginTop: 12, gap: 12,
        }}>
          <div style={{ fontSize: 12, color: "var(--ops-ink-3)" }}>
            Parsed <strong style={{ color: "var(--ops-ink)" }}>{ids.length}</strong> / 100
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <label style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              fontSize: 12, color: "var(--ops-ink-2)",
            }}>
              <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
              Force (skip consent gate)
            </label>
            <button type="button" className="ops-btn primary"
                    disabled={busy || ids.length === 0 || ids.length > 100}
                    onClick={run}>
              <Play size={12} strokeWidth={2} /> {busy ? "Pushing…" : `Push ${ids.length} patients`}
            </button>
          </div>
        </div>
      </div>

      {result && (
        <div style={{ marginTop: 14 }} className="ops-panel">
          {result._error ? (
            <div className="ops-empty" style={{ color: "var(--ops-rose)" }}>{result._error}</div>
          ) : (
            <>
              <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--ops-rule)" }}>
                <span className="ops-chip ok">
                  <span className="ops-chip-dot" />
                  Pushed {result.ok ?? result.success_count ?? 0} / {result.total ?? ids.length}
                </span>
                {(result.failed ?? result.failure_count) > 0 && (
                  <span className="ops-chip err" style={{ marginLeft: 8 }}>
                    <span className="ops-chip-dot" />
                    {result.failed ?? result.failure_count} failed
                  </span>
                )}
              </div>
              <table className="ops-table" aria-label="Batch results">
                <thead>
                  <tr>
                    <th style={{ width: 180 }}>Patient ID</th>
                    <th style={{ width: 110 }}>Status</th>
                    <th>TEI / note</th>
                  </tr>
                </thead>
                <tbody>
                  {(result.results || result.entries || []).slice(0, 100).map((r, i) => (
                    <tr key={i}>
                      <td className="mono">{r.patient_id}</td>
                      <td>
                        <span className={`ops-chip ${r.success ? "ok" : "err"}`}>
                          <span className="ops-chip-dot" />
                          {r.success ? "OK" : "failed"}
                        </span>
                      </td>
                      <td className="mono" style={{ fontSize: 11.5 }}>
                        {r.tei_uid || r.error || r.reason || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}


// ── Tracker audit tab ──────────────────────────────────

function TrackerAuditTab() {
  const [filter, setFilter] = useState("");
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const r = await getTrackerAudit(null, { patientId: filter.trim(), limit: 100 });
    setEntries(r.entries || []);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="ops-section">
      <div className="ops-section-head">
        <h2>Tracker audit <span className="count">· {entries.length} entries</span></h2>
        <div className="ops-section-tools">
          <label style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            border: "1px solid var(--ops-rule-3)", borderRadius: 6,
            padding: "4px 10px", background: "#fff",
          }}>
            <Search size={12} strokeWidth={2} color="var(--ops-ink-3)" />
            <input
              placeholder="filter by patient_id…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load()}
              style={{
                border: "none", outline: "none", background: "transparent",
                fontFamily: "var(--a-font-mono)", fontSize: 12,
                color: "var(--ops-ink)", width: 200,
              }}
            />
          </label>
          <button type="button" className="ops-btn ghost" onClick={load}>
            <RefreshCw size={12} strokeWidth={2} /> Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="ops-panel"><div className="ops-empty">Loading audit…</div></div>
      ) : entries.length === 0 ? (
        <div className="ops-panel"><div className="ops-empty">No tracker audit entries.</div></div>
      ) : (
        <div className="ops-panel">
          <table className="ops-table" aria-label="Tracker audit">
            <thead>
              <tr>
                <th style={{ width: 170 }}>When</th>
                <th style={{ width: 150 }}>Patient</th>
                <th style={{ width: 170 }}>TEI</th>
                <th style={{ width: 90 }}>Success</th>
                <th>Operator / note</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={e.audit_id || i}>
                  <td className="mono">{fmtTs(e.logged_at || e.timestamp)}</td>
                  <td className="mono">{e.patient_id || "—"}</td>
                  <td className="mono">{e.tei_uid || "—"}</td>
                  <td>
                    <span className={`ops-chip ${e.success ? "ok" : "err"}`}>
                      <span className="ops-chip-dot" />
                      {e.success ? "OK" : "failed"}
                    </span>
                  </td>
                  <td className="mono" style={{ fontSize: 11.5 }}>
                    {e.triggered_by || e.error || e.note || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


// ── Aggregate history tab (cross-ref) ────────────────

function AggregateHistoryTab() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const r = await getAggregateHistory(null, { limit: 100 });
    setEntries(r.entries || []);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="ops-section">
      <div className="ops-section-head">
        <h2>Aggregate push history <span className="count">· {entries.length} entries</span></h2>
        <div className="ops-section-tools">
          <button type="button" className="ops-btn ghost" onClick={load}>
            <RefreshCw size={12} strokeWidth={2} /> Refresh
          </button>
          <button type="button" className="ops-btn ghost">
            <Download size={12} strokeWidth={2} /> Export CSV
          </button>
        </div>
      </div>

      {loading ? (
        <div className="ops-panel"><div className="ops-empty">Loading history…</div></div>
      ) : entries.length === 0 ? (
        <div className="ops-panel"><div className="ops-empty">No aggregate push history yet.</div></div>
      ) : (
        <div className="ops-panel">
          <table className="ops-table" aria-label="Aggregate history">
            <thead>
              <tr>
                <th style={{ width: 170 }}>When</th>
                <th style={{ width: 130 }}>Period</th>
                <th style={{ width: 90 }}>Success</th>
                <th style={{ width: 90 }} className="num">Values</th>
                <th>Operator / response</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={e.audit_id || i}>
                  <td className="mono">{fmtTs(e.logged_at || e.timestamp)}</td>
                  <td className="mono">{e.period || "—"}</td>
                  <td>
                    <span className={`ops-chip ${e.success ? "ok" : "err"}`}>
                      <span className="ops-chip-dot" />
                      {e.success ? "OK" : "failed"}
                    </span>
                  </td>
                  <td className="num">{e.value_count ?? "—"}</td>
                  <td className="mono" style={{ fontSize: 11.5 }}>
                    {e.triggered_by || (e.warnings?.length ? `${e.warnings.length} warnings` : "—")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


// ── Discover tab ─────────────────────────────────────

function DiscoverTab() {
  const [datasets, setDatasets] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail]     = useState(null);
  const [err, setErr]           = useState(null);

  async function load() {
    setLoading(true); setErr(null);
    const r = await discoverDatasets(null, { pageSize: 100 });
    if (r._error) { setErr(r._error); setDatasets([]); }
    else { setDatasets(r.datasets || []); }
    setLoading(false);
  }

  async function openDataset(id) {
    setSelected(id); setDetail(null);
    const r = await describeDataset(null, id);
    setDetail(r);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="ops-section">
      <div className="ops-section-head">
        <h2>Discover DHIS2 <span className="count">· live datasets on configured instance</span></h2>
        <div className="ops-section-tools">
          <button type="button" className="ops-btn ghost" onClick={load}>
            <RefreshCw size={12} strokeWidth={2} /> Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="ops-panel"><div className="ops-empty">Querying DHIS2 instance…</div></div>
      ) : err ? (
        <div className="ops-panel"><div className="ops-empty" style={{ color: "var(--ops-rose)" }}>
          Could not reach DHIS2: {err}
        </div></div>
      ) : datasets.length === 0 ? (
        <div className="ops-panel"><div className="ops-empty">No datasets returned.</div></div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 14 }}>
          <div className="ops-panel">
            <table className="ops-table" aria-label="Datasets">
              <thead>
                <tr>
                  <th>Dataset</th>
                  <th style={{ width: 130 }}>Period</th>
                  <th style={{ width: 120 }}>ID</th>
                </tr>
              </thead>
              <tbody>
                {datasets.map((d) => (
                  <tr key={d.id}
                      onClick={() => openDataset(d.id)}
                      style={{ cursor: "pointer", background: selected === d.id ? "var(--ops-paper-2)" : undefined }}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{d.displayName || d.name}</div>
                      <div style={{ fontSize: 11, color: "var(--ops-ink-3)" }}>{d.code || ""}</div>
                    </td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{d.periodType || "—"}</td>
                    <td className="mono">{d.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ops-panel" style={{ padding: 14 }}>
            {!selected ? (
              <div className="ops-empty">Select a dataset to inspect its data elements &amp; org units.</div>
            ) : !detail ? (
              <div className="ops-empty">Loading dataset detail…</div>
            ) : detail._error ? (
              <div className="ops-empty" style={{ color: "var(--ops-rose)" }}>{detail._error}</div>
            ) : (
              <>
                <div style={{ fontSize: 10, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--ops-ink-3)", marginBottom: 6 }}>
                  Dataset · {detail.id}
                </div>
                <div style={{
                  fontFamily: "var(--a-font-disp)", fontSize: 18,
                  color: "var(--ops-ink)", marginBottom: 10,
                }}>
                  {detail.displayName || detail.name}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--ops-ink-3)" }}>Data elements</div>
                    <div style={{ fontFamily: "var(--a-font-mono)", fontSize: 18, color: "var(--ops-ink)" }}>
                      {(detail.data_elements || detail.dataElements || []).length}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--ops-ink-3)" }}>Org units</div>
                    <div style={{ fontFamily: "var(--a-font-mono)", fontSize: 18, color: "var(--ops-ink)" }}>
                      {(detail.org_units || detail.orgUnits || []).length}
                    </div>
                  </div>
                </div>
                <JsonBlock value={detail} maxHeight={360} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


// ── Root ────────────────────────────────────────────

const SUB_TABS = [
  { id: "config",    label: "Config",           icon: Settings },
  { id: "push",      label: "Push patient",     icon: Send },
  { id: "batch",     label: "Batch push",       icon: Layers },
  { id: "audit",     label: "Tracker audit",    icon: ClipboardList },
  { id: "aggregate", label: "Aggregate history",icon: Database },
  { id: "discover",  label: "Discover DHIS2",   icon: Compass },
];

export default function DHIS2TrackerWorkspace() {
  const [tab, setTab] = useState("config");
  const [cfg, setCfg] = useState(null);

  async function refreshConfig() {
    const c = await getTrackerConfig(null);
    setCfg(c);
  }
  useEffect(() => { refreshConfig(); }, []);

  const configured = !!cfg?.configured;

  return (
    <section className="ops-workspace">
      <div className="ops-entity-head">
        <div>
          <div className="ops-entity-kicker">
            <span>DHIS2 · Tracker writeback</span>
            <span className={`ops-chip ${configured ? "ok" : "err"}`}>
              <span className="ops-chip-dot" />
              {configured ? "Configured" : "Disabled"}
            </span>
            <span className="ops-chip neutral">Phase 2 · admin only</span>
          </div>
          <h2 className="ops-entity-title">Patient-level push into the national registry</h2>
          <p className="ops-entity-desc">
            Pushes per-patient tracked entity instances, enrollments, and clinical events
            to the national DHIS2 Tracker program. Admins can dry-run a payload for any
            patient, push live (single or up to 100 at once), or cross-reference the
            tracker + aggregate audit logs.
          </p>
        </div>
        <div className="ops-entity-actions">
          <button type="button" className="ops-btn ghost" onClick={refreshConfig}>
            <RefreshCw size={12} strokeWidth={2} /> Refresh config
          </button>
        </div>
      </div>

      <div className="ops-tabs" role="tablist">
        {SUB_TABS.map((t) => (
          <button key={t.id}
                  type="button"
                  role="tab"
                  className="ops-tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}>
            <t.icon size={13} strokeWidth={2} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "config"    && <ConfigTab cfg={cfg} onRefresh={refreshConfig} />}
      {tab === "push"      && <PushPatientTab />}
      {tab === "batch"     && <BatchPushTab />}
      {tab === "audit"     && <TrackerAuditTab />}
      {tab === "aggregate" && <AggregateHistoryTab />}
      {tab === "discover"  && <DiscoverTab />}
    </section>
  );
}
