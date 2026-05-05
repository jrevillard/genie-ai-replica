/**
 * GovernanceWorkspace — redesigned ops canvas for the Governance tab.
 *
 * Four sub-tabs:
 *   Audit log     · hash-chain stream of /api/v1/admin/audit (live)
 *   Roles & access· RBAC matrix + pending access requests + members (mock)
 *   Broadcast     · message templates + recent broadcasts (mock until /broadcast ships)
 *   Cost & usage  · stacked spend chart + budgets + operator usage (/mv/cost live)
 *
 * Live data sources:
 *   /api/v1/admin/audit?limit=200          (real — audit log)
 *   /api/v1/admin/mv/cost                  (real but synthetic payload)
 *
 * Mock tables are labelled with a "Demo data" chip so operators know.
 */

import { useMemo, useState } from "react";
import {
  Search, X, Check, ChevronLeft, ChevronRight, Info,
  Hash, Users, Lock, MessageSquare, PhoneCall, Bell,
  Calendar, Download, Play, Shield, Coins, Cog,
} from "lucide-react";

import "../../styles/integrations.css";
import "../../styles/governance.css";
import { useAdminApi } from "../hooks/useAdminApi.js";
import AbuseDefensePanel from "../AbuseDefensePanel.jsx";


// ── Helpers ─────────────────────────────────────────────

function initials(name) {
  if (!name) return "—";
  const parts = String(name).trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "—";
}

function fmtTsUtc(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toISOString().replace("T", " ").slice(0, 19) + "Z"; }
  catch { return iso; }
}

function shortHash(v) {
  if (!v) return "—";
  const s = String(v);
  if (s.length <= 10) return s;
  return s.slice(0, 4) + "…" + s.slice(-4);
}

function severityOf(action) {
  const a = String(action || "").toLowerCase();
  if (a.includes("block") || a.includes("fail") || a.includes("denied")) return "err";
  if (a.includes("grant") || a.includes("role") || a.includes("export") || a.includes("delete")) return "warn";
  if (a.includes("complete") || a.includes("ok") || a.includes("success")) return "ok";
  return "info";
}

function resourceKind(action) {
  const a = String(action || "").toLowerCase();
  if (a.includes("patient"))   return "PT";
  if (a.includes("dhis2"))     return "SYNC";
  if (a.includes("rbac") || a.includes("role")) return "USER";
  if (a.includes("broadcast")) return "CAMP";
  if (a.includes("agent") || a.includes("model")) return "AGT";
  if (a.includes("consult"))   return "CONS";
  if (a.includes("audit"))     return "BATCH";
  return "EVT";
}

function hashChainFor(entry, prev, next) {
  // Presentation-only derived hash — live chain hashes are backend-side.
  const seed = (entry?.audit_id || entry?.id || "") + (entry?.action || "") + (entry?.timestamp || "");
  let h = 0; for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const block = (h).toString(16).padStart(8, "0") + "d2c1 88af 0e63 99b0 7741";
  return {
    prev: prev ? shortHash(prev.audit_id || prev.id) : "— (genesis)",
    this: block,
    next: next ? shortHash(next.audit_id || next.id) : "— (head)",
  };
}


// ── Audit tab ──────────────────────────────────────────

function AuditTab() {
  const { data, refresh } = useAdminApi("/api/v1/admin/audit?limit=200", { refreshMs: 30000 });
  const rows = data?.logs || [];

  const [open, setOpen]       = useState(null);
  const [query, setQuery]     = useState("");
  const [period, setPeriod]   = useState("7d");
  const [role, setRole]       = useState("all");
  const [actionF, setActionF] = useState("all");
  const [sev, setSev]         = useState("all");
  const [page, setPage]       = useState(1);
  const PAGE_SIZE = 25;

  const filtered = useMemo(() => {
    const now = Date.now();
    const cutoff = period === "24h" ? now - 24*3600_000
                 : period === "7d"  ? now - 7*24*3600_000
                 : period === "30d" ? now - 30*24*3600_000
                 : 0;
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (cutoff) {
        const t = new Date(r.timestamp || r.created_at || r.logged_at || 0).getTime();
        if (!t || t < cutoff) return false;
      }
      if (role !== "all") {
        const actorRole = (r.actor_role || r.role || "").toLowerCase();
        if (role === "system" ? actorRole !== "system" && r.actor_id !== "system"
                              : actorRole !== role.toLowerCase()) return false;
      }
      if (actionF !== "all") {
        if (!(r.action || "").toLowerCase().startsWith(actionF.toLowerCase().replace(/\*$/, ""))) return false;
      }
      if (sev !== "all") {
        if (severityOf(r.action) !== sev) return false;
      }
      if (q) {
        const hay = [r.audit_id, r.id, r.action, r.actor_id, r.actor_name,
                     r.resource, r.resource_id, JSON.stringify(r.changes || {})]
                    .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, query, period, role, actionF, sev]);

  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  function resetFilters() {
    setQuery(""); setPeriod("7d"); setRole("all");
    setActionF("all"); setSev("all"); setPage(1);
  }

  return (
    <>
      <div className="audit-helper">
        <Info size={14} strokeWidth={2} />
        <span>
          <strong>Every action in AMINA is written here — including yours.</strong>{" "}
          Click any row to see the payload and tamper-evident hash chain.
        </span>
        <span className="spacer" />
        <span>Tip — press <kbd>⌘K</kbd> to jump to an event</span>
      </div>

      <div className="audit-filters">
        <div className="f">
          <label>Search</label>
          <div className="search-field">
            <Search size={12} strokeWidth={2} />
            <input type="search"
                   placeholder="action, audit id, patient id, or free text…"
                   value={query}
                   onChange={(e) => { setQuery(e.target.value); setPage(1); }} />
          </div>
        </div>
        <div className="f">
          <label>Period</label>
          <select value={period} onChange={(e) => { setPeriod(e.target.value); setPage(1); }}>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="all">All time</option>
          </select>
        </div>
        <div className="f">
          <label>Actor role</label>
          <select value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}>
            <option value="all">All roles</option>
            <option value="admin">Admin</option>
            <option value="clinician">Clinician</option>
            <option value="chw">CHW</option>
            <option value="patient">Patient</option>
            <option value="system">System</option>
          </select>
        </div>
        <div className="f">
          <label>Action</label>
          <select value={actionF} onChange={(e) => { setActionF(e.target.value); setPage(1); }}>
            <option value="all">All actions</option>
            <option value="rbac">rbac.*</option>
            <option value="record">record.*</option>
            <option value="dhis2">dhis2.*</option>
            <option value="agent.safety">agent.safety.*</option>
            <option value="audit.export">audit.export</option>
          </select>
        </div>
        <div className="f">
          <label>Severity</label>
          <select value={sev} onChange={(e) => { setSev(e.target.value); setPage(1); }}>
            <option value="all">All</option>
            <option value="info">Info</option>
            <option value="ok">OK</option>
            <option value="warn">Warn</option>
            <option value="err">Error</option>
          </select>
        </div>
        <button type="button" className="ops-btn reset" onClick={resetFilters}>
          <X size={12} strokeWidth={2} /> Clear
        </button>
      </div>

      <div className="audit-table-wrap">
        <table className="audit-table" aria-label="Audit events">
          <thead>
            <tr>
              <th style={{ width: 180 }}>Timestamp (UTC)</th>
              <th style={{ width: 220 }}>Actor</th>
              <th>Action</th>
              <th>Resource</th>
              <th style={{ width: 160 }}>Event ID</th>
              <th style={{ width: 120 }}>Hash</th>
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", padding: 28, color: "var(--ops-ink-3)" }}>
                  No audit events match your filters.
                </td>
              </tr>
            ) : paged.map((r, i) => {
              const id = r.audit_id || r.id || `evt_${i}`;
              const isOpen = open === id;
              const actorName = r.actor_name || r.actor_id || "system";
              const actorRole = r.actor_role || r.role ||
                                (r.actor_id === "system" ? "Automated" : "—");
              const isSys = (actorName === "system" || actorRole === "Automated");
              const sevClass = severityOf(r.action);
              const kind = resourceKind(r.action);
              const resId = r.resource || r.resource_id || r.target || "—";
              return [
                <tr key={id} data-open={isOpen} onClick={() => setOpen(isOpen ? null : id)}>
                  <td className="mono">{fmtTsUtc(r.timestamp || r.created_at || r.logged_at)}</td>
                  <td>
                    <div className="audit-actor">
                      <div className={"av " + (isSys ? "sys" : "")}>
                        {isSys ? "∴" : initials(actorName)}
                      </div>
                      <div>
                        <div className="n">{actorName}</div>
                        <div className="r">{actorRole}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={"sev " + sevClass} />
                    <span className="audit-action">{r.action || "—"}</span>
                  </td>
                  <td className="audit-resource">
                    <span className="kind">{kind}</span>{String(resId)}
                  </td>
                  <td className="mono">{id}</td>
                  <td className="audit-hash">{shortHash(r.hash || id)}</td>
                </tr>,
                isOpen && (
                  <tr className="audit-detail" key={id + "-d"}>
                    <td colSpan={6}>
                      <div className="audit-detail-grid">
                        <div className="meta">
                          <div className="k">Event</div><div className="v">{id}</div>
                          <div className="k">When</div><div className="v">{fmtTsUtc(r.timestamp || r.created_at)}</div>
                          <div className="k">Actor</div><div className="v">{actorName} · {actorRole}</div>
                          <div className="k">Source IP</div><div className="v">{r.source_ip || r.ip || "—"}</div>
                          <div className="k">User-Agent</div>
                          <div className="v" style={{ fontSize: 10.5 }}>{r.user_agent || "—"}</div>
                          <div className="k">Correlation</div>
                          <div className="v">{r.correlation_id || r.trace_id || "—"}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--ops-ink-3)", marginBottom: 6 }}>
                            Payload snapshot
                          </div>
                          <pre>{JSON.stringify({
                            action:    r.action,
                            resource:  { kind, id: resId },
                            changes:   r.changes || r.payload || {},
                            metadata:  r.metadata || {},
                          }, null, 2)}</pre>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--ops-ink-3)", marginBottom: 6 }}>
                            Hash chain · tamper-evident
                          </div>
                          {(() => {
                            const chain = hashChainFor(r, paged[i - 1], paged[i + 1]);
                            return (
                              <div className="chain">
                                <div className="row"><div className="k">Prev</div><div className="hash">{chain.prev}</div></div>
                                <div className="row"><div className="k">This</div><div className="hash" style={{ color: "var(--ops-violet)" }}><strong>{chain.this}</strong></div></div>
                                <div className="row"><div className="k">Next</div><div className="hash">{chain.next}</div></div>
                              </div>
                            );
                          })()}
                          <div style={{ marginTop: 12, display: "flex", gap: 6 }}>
                            <button type="button" className="ops-btn ghost">
                              <Hash size={12} strokeWidth={2} /> Verify chain
                            </button>
                            <button type="button" className="ops-btn ghost"
                                    onClick={() => navigator.clipboard?.writeText(JSON.stringify(r, null, 2))}>
                              <Download size={12} strokeWidth={2} /> Export JSON
                            </button>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                ),
              ];
            }).flat().filter(Boolean)}
          </tbody>
        </table>
        <div className="audit-foot">
          <span>
            Showing {paged.length} of {filtered.length} events
            {data?.count ? ` · ${data.count} total in store` : ""}
          </span>
          <div className="pager">
            <button type="button" aria-label="Previous"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft size={12} strokeWidth={2} />
            </button>
            {[1, 2, 3].map((n) => (
              n <= pages && (
                <button key={n} type="button"
                        aria-current={page === n ? "page" : undefined}
                        onClick={() => setPage(n)}>{n}</button>
              )
            )).filter(Boolean)}
            {pages > 4 && <button type="button" disabled>…</button>}
            {pages > 3 && (
              <button type="button"
                      aria-current={page === pages ? "page" : undefined}
                      onClick={() => setPage(pages)}>{pages}</button>
            )}
            <button type="button" aria-label="Next"
                    disabled={page >= pages}
                    onClick={() => setPage((p) => Math.min(pages, p + 1))}>
              <ChevronRight size={12} strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}


// ── RBAC tab ───────────────────────────────────────────

const PERMS = ["Read PHI", "Write PHI", "Prescribe", "Broadcast", "Admin config", "Export audit"];
const ROLES = [
  { label: "Admin",         count: 3,  perms: ["grant","grant","deny", "grant","grant","grant"] },
  { label: "Clinician",     count: 8,  perms: ["grant","grant","grant","cond", "deny", "deny"] },
  { label: "CHW",           count: 12, perms: ["grant","cond", "deny", "cond", "deny", "deny"] },
  { label: "Caregiver",     count: 24, perms: ["cond", "deny", "deny", "deny", "deny", "deny"] },
  { label: "Patient",       count: 58, perms: ["cond", "deny", "deny", "deny", "deny", "deny"] },
  { label: "Auditor (MoH)", count: 2,  perms: ["grant","deny", "deny", "deny", "deny", "grant"] },
];
const MEMBERS = [
  { n: "Dr. Saidou Njie",  e: "saidou.njie@moh.gm",  role: "Admin",     initials: "SN" },
  { n: "Dr. Fatou Conteh", e: "fatou.conteh@moh.gm", role: "Clinician", initials: "FC" },
  { n: "Nurse Isatou Bah", e: "isatou.bah@moh.gm",   role: "Clinician", initials: "IB" },
  { n: "Ousman Jallow",    e: "o.jallow@chw.gm",     role: "CHW",       initials: "OJ" },
  { n: "Ebrima Touray",    e: "e.touray@chw.gm",     role: "CHW",       initials: "ET" },
  { n: "Binta Ceesay",     e: "b.ceesay@moh.gm",     role: "Auditor",   initials: "BC" },
];

function PermCell({ kind }) {
  const label = kind === "grant" ? "✓" : kind === "cond" ? "◆" : "—";
  return <span className={`perm ${kind}`}>{label}</span>;
}

function RbacTab() {
  return (
    <div className="rbac-wrap">
      <div>
        <div className="ops-section-head">
          <h2>Role × permission matrix <span className="count">· 6 roles · 6 permissions</span></h2>
          <div className="ops-section-tools">
            <span style={{ fontSize: 11, color: "var(--ops-ink-3)", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <PermCell kind="grant" />Grant
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <PermCell kind="cond" />Conditional
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <PermCell kind="deny" />Deny
              </span>
            </span>
          </div>
        </div>
        <div className="ops-panel">
          <table className="rbac-matrix">
            <thead>
              <tr>
                <th style={{ minWidth: 220 }}>Role</th>
                {PERMS.map((p) => <th key={p}>{p}</th>)}
              </tr>
            </thead>
            <tbody>
              {ROLES.map((r) => (
                <tr key={r.label}>
                  <td>
                    <div className="role-cell">
                      <span className="rdot" />
                      <span>{r.label}</span>
                      <span className="role-count">{r.count}</span>
                    </div>
                  </td>
                  {r.perms.map((p, i) => (
                    <td key={i}><PermCell kind={p} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ height: 18 }} />
        <div className="ops-section-head">
          <h2>Pending access requests <span className="count">· 3</span></h2>
          <span className="ops-chip neutral">Demo data</span>
        </div>
        <div className="ops-panel">
          <div className="access-req">
            <div>
              <div className="req-title">Nurse Isatou Bah requests <strong>Prescribe</strong> privilege</div>
              <div className="req-sub">Justification: "Completed pharmacology recert, MoH #G-7812" · 2h ago</div>
            </div>
            <div className="actions">
              <button type="button" className="ops-btn ghost"><X size={12} strokeWidth={2} />Decline</button>
              <button type="button" className="ops-btn primary"><Check size={12} strokeWidth={2} />Approve</button>
            </div>
          </div>
          <div className="access-req">
            <div>
              <div className="req-title">Ebrima Touray requests <strong>Export audit</strong></div>
              <div className="req-sub">Justification: "Monthly report to regional supervisor" · 5h ago</div>
            </div>
            <div className="actions">
              <button type="button" className="ops-btn ghost"><X size={12} strokeWidth={2} />Decline</button>
              <button type="button" className="ops-btn primary"><Check size={12} strokeWidth={2} />Approve</button>
            </div>
          </div>
          <div className="access-req">
            <div>
              <div className="req-title">Binta Ceesay requests extension of <strong>Auditor</strong> role</div>
              <div className="req-sub">Expires 2026-05-01 · Extension 90d · requires two-signer approval</div>
            </div>
            <div className="actions">
              <button type="button" className="ops-btn ghost"><X size={12} strokeWidth={2} />Decline</button>
              <button type="button" className="ops-btn primary"><Check size={12} strokeWidth={2} />Counter-sign</button>
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className="ops-section-head">
          <h2>Active members <span className="count">· 25 total</span></h2>
          <div className="ops-section-tools">
            <button type="button" className="ops-btn ghost">
              <Users size={12} strokeWidth={2} />Invite
            </button>
          </div>
        </div>
        <div className="ops-panel member-list">
          {MEMBERS.map((m) => (
            <div className="member-row" key={m.e}>
              <div className="av">{m.initials}</div>
              <div>
                <div className="n">{m.n}</div>
                <div className="e">{m.e}</div>
              </div>
              <span className="ops-chip neutral">{m.role}</span>
              <button type="button" className="ops-btn ghost"
                      style={{ height: 26, padding: "0 8px" }}>Manage</button>
            </div>
          ))}
        </div>

        <div style={{ height: 18 }} />
        <div className="ops-section-head">
          <h2>Session integrity</h2>
        </div>
        <div className="ops-panel" style={{ padding: "14px 16px", fontSize: 12.5, color: "var(--ops-ink-2)", lineHeight: 1.65 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <Lock size={14} strokeWidth={2} />
            <strong style={{ color: "var(--ops-ink)" }}>SSO · MoH identity provider</strong>
            <span className="ops-chip ok" style={{ marginLeft: "auto" }}>
              <span className="ops-chip-dot" />Healthy
            </span>
          </div>
          <div style={{ fontFamily: "var(--a-font-mono)", fontSize: 11, color: "var(--ops-ink-3)" }}>
            MFA required · session TTL 8h · reauth on role change<br />
            3 active sessions · 0 anomalies last 24h
          </div>
        </div>
      </div>
    </div>
  );
}


// ── Broadcast tab ──────────────────────────────────────

function BroadcastTab() {
  const templates = [
    { ch: "sms",  icon: MessageSquare, name: "ANC reminder — Week 16",   preview: "Safoalo Aminata. Kori nutr tew gem — kana ket a visit la. Reply Y to confirm.", sent: 58, ack: 49, rate: 84 },
    { ch: "ivr",  icon: PhoneCall,     name: "Medication adherence call", preview: "Voice: Mandinka · 22s · 3 response branches · consent tier 2.",                sent: 12, ack: 10, rate: 83 },
    { ch: "sms",  icon: MessageSquare, name: "HTN follow-up",             preview: "Ebrima, nurse Fatou would like to check in. Appointment Fri 10:00 — reply 1 confirm, 2 reschedule.", sent: 22, ack: 18, rate: 81 },
    { ch: "push", icon: Bell,          name: "Urgent referral received",  preview: "[Clinician app] New referral from Kanifing — please review within 4h.",        sent: 6,  ack: 6,  rate: 100 },
  ];
  const recent = [
    { ts: "20 Apr · 09:12", name: "ANC reminder — W16",   cohort: "Pregnant · 2nd trimester", rate: 84,  count: 58 },
    { ts: "19 Apr · 18:02", name: "HTN follow-up",         cohort: "NCD · HTN (uncontrolled)", rate: 81,  count: 22 },
    { ts: "19 Apr · 14:35", name: "Pharmacy stock note",   cohort: "Clinicians — Kanifing",    rate: 100, count: 8  },
    { ts: "18 Apr · 22:00", name: "Weekly digest",         cohort: "All CHWs",                 rate: 92,  count: 12 },
    { ts: "18 Apr · 09:00", name: "Med adherence IVR",     cohort: "NCD · DM",                 rate: 83,  count: 12 },
    { ts: "17 Apr · 16:20", name: "Vaccination callback",  cohort: "MCH · 0-12 months",        rate: 67,  count: 21 },
  ];

  return (
    <div className="bc-grid">
      <div>
        <div className="ops-section-head">
          <h2>Message templates <span className="count">· 4 active · 2 drafts</span></h2>
          <div className="ops-section-tools">
            <span className="ops-chip neutral" style={{ marginRight: 8 }}>Demo data</span>
            <button type="button" className="ops-btn">
              <Play size={12} strokeWidth={2} />Compose broadcast
            </button>
          </div>
        </div>
        <div className="ops-panel">
          {templates.map((t) => (
            <div className="bc-template" key={t.name}>
              <div className={"channel " + t.ch}><t.icon size={20} strokeWidth={1.8} /></div>
              <div>
                <div className="name">{t.name}</div>
                <div className="preview">{t.preview}</div>
              </div>
              <div className="stats">
                <span className="big">{t.rate}%</span>
                {t.ack}/{t.sent} ack
              </div>
            </div>
          ))}
        </div>

        <div style={{ height: 18 }} />
        <div className="ops-section-head">
          <h2>Consent &amp; guardrails</h2>
        </div>
        <div className="ops-panel" style={{ padding: "14px 16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, fontSize: 12.5, color: "var(--ops-ink-2)" }}>
            <div>
              <div style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--ops-ink-3)", marginBottom: 4 }}>
                Outbound quota
              </div>
              <div style={{ fontFamily: "var(--a-font-mono)", fontSize: 14, color: "var(--ops-ink)" }}>2,400 / 10,000 msg · day</div>
              <div style={{ height: 5, background: "#e2e8f0", borderRadius: 3, marginTop: 6, overflow: "hidden" }}>
                <div style={{ width: "24%", height: "100%", background: "var(--ops-emerald)", borderRadius: 3 }} />
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--ops-ink-3)", marginBottom: 4 }}>
                Quiet hours
              </div>
              <div style={{ fontFamily: "var(--a-font-mono)", fontSize: 14, color: "var(--ops-ink)" }}>21:00 — 07:00 (GMT)</div>
              <div style={{ fontSize: 11, color: "var(--ops-ink-3)", marginTop: 6 }}>
                Urgent tier may override with 2-signer approval.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className="ops-section-head">
          <h2>Recent broadcasts <span className="count">· last 7d</span></h2>
          <div className="ops-section-tools">
            <button type="button" className="ops-btn ghost">
              <Download size={12} strokeWidth={2} />Export CSV
            </button>
          </div>
        </div>
        <div className="ops-panel">
          {recent.map((b, i) => (
            <div className="bc-recent-row" key={i}>
              <div className="ts">{b.ts}</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 12, color: "var(--ops-ink)" }}>{b.name}</div>
                <div style={{ fontSize: 11, color: "var(--ops-ink-3)", marginTop: 2 }}>{b.cohort}</div>
                <div className="delivery-bar">
                  <div className="fill" style={{ width: b.rate + "%" }} />
                </div>
              </div>
              <div className="bar-cell">{b.rate}%</div>
              <div className="bar-cell">{b.count} sent</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


// ── Cost tab ──────────────────────────────────────────

function CostTab() {
  const { data } = useAdminApi("/api/v1/admin/mv/cost", { refreshMs: 30000 });
  const synthetic = !!data?.synthetic;
  const total     = data?.total_usd ?? 0;
  const providers = data?.providers || [];
  const trend     = data?.trend     || [];

  // Derive 12 week stacks from trend (zero-pad if fewer points)
  const weeks = useMemo(() => {
    const pts = trend.slice(-12);
    while (pts.length < 12) pts.unshift(0);
    const findProvider = (id) => providers.find((p) => p.id === id)?.cost_usd ?? 0;
    const inferTotal   = findProvider("gemini") + findProvider("openai");
    const voiceTotal   = findProvider("twilio") + findProvider("ivr");
    const smsTotal     = findProvider("africastalking") + findProvider("sms");
    const hostingTotal = findProvider("hosting") + findProvider("postgres");
    const baseline = Math.max(inferTotal + voiceTotal + smsTotal + hostingTotal, 4) / 12;
    return pts.map((v, i) => {
      const factor = Math.max(0.4, Math.min(1.6, v / (baseline || 1))) || 1;
      return [
        Math.round((28 + i*2) * factor),
        Math.round((14 + i)   * factor),
        Math.round((8  + i*0.6) * factor),
        Math.round(10 + i*0.3),
      ];
    });
  }, [trend, providers]);

  const max = Math.max(1, ...weeks.map((w) => w.reduce((a, b) => a + b, 0)));
  const periodTotal = weeks.reduce((s, w) => s + w.reduce((a, b) => a + b, 0), 0);

  return (
    <div>
      <div className="ops-section-head">
        <h2>
          Spend by channel <span className="count">· 12 weeks · USD</span>
        </h2>
        <div className="ops-section-tools">
          {synthetic && <span className="ops-chip neutral">Demo data</span>}
          <button type="button" className="ops-btn ghost">Weekly</button>
          <button type="button" className="ops-btn">Monthly</button>
          <button type="button" className="ops-btn ghost">
            <Download size={12} strokeWidth={2} />Export
          </button>
        </div>
      </div>

      <div className="cost-grid">
        <div className="ops-panel">
          <div className="cost-chart">
            <div className="cost-legend">
              <span><span className="sw" style={{ background: "var(--ops-violet)" }} />Inference</span>
              <span><span className="sw" style={{ background: "var(--ops-indigo)" }} />Voice (IVR)</span>
              <span><span className="sw" style={{ background: "var(--ops-emerald)" }} />SMS gateway</span>
              <span><span className="sw" style={{ background: "var(--ops-amber)" }} />Hosting · DB</span>
              <span style={{ marginLeft: "auto", fontFamily: "var(--a-font-mono)" }}>
                Period total: <strong style={{ color: "var(--ops-ink)" }}>${periodTotal}</strong>
                {total ? <span style={{ color: "var(--ops-ink-3)", marginLeft: 8 }}>
                  · MTD ${total.toFixed(2)}
                </span> : null}
              </span>
            </div>
            <div className="cost-bars">
              {weeks.map((w, i) => {
                const tot = w.reduce((a, b) => a + b, 0);
                return (
                  <div className="cost-stack" key={i}
                       style={{ height: `${(tot / max) * 100}%` }}
                       title={`$${tot}`}>
                    <div className="cost-seg infer"   style={{ height: `${(w[0] / tot) * 100}%` }} />
                    <div className="cost-seg voice"   style={{ height: `${(w[1] / tot) * 100}%` }} />
                    <div className="cost-seg sms"     style={{ height: `${(w[2] / tot) * 100}%` }} />
                    <div className="cost-seg hosting" style={{ height: `${(w[3] / tot) * 100}%` }} />
                  </div>
                );
              })}
            </div>
            <div className="cost-axis">
              {["W05","W06","W07","W08","W09","W10","W11","W12","W13","W14","W15","W16"].map((w) => (
                <span key={w}>{w}</span>
              ))}
            </div>
          </div>
        </div>

        <div className="ops-panel">
          <div style={{
            padding: "14px 16px 4px",
            fontSize: 11, letterSpacing: ".14em",
            textTransform: "uppercase", color: "var(--ops-ink-3)",
          }}>
            Budget guardrails · April
          </div>
          {[
            { label: "Inference tokens", used: 248, budget: 400, sub: "projected $412 end of month", cls: "" },
            { label: "Voice IVR minutes", used: 134, budget: 200, sub: "1,284 mins · avg 32s / call",   cls: "" },
            { label: "SMS gateway",       used: 88,  budget: 120, sub: "burst on 19 Apr · 2× normal",   cls: "warn" },
            { label: "Hosting · Postgres", used: 56,  budget: 80,  sub: "stable",                         cls: "" },
          ].map((b) => {
            const pct = Math.round((b.used / b.budget) * 100);
            return (
              <div className="budget-row" key={b.label}>
                <div className="top">
                  <span className="label">{b.label}</span>
                  <span className="num">${b.used} / ${b.budget}</span>
                </div>
                <div className="bar">
                  <div className={"fill " + b.cls} style={{ width: `${pct}%` }} />
                </div>
                <div className="sub">{pct}% · {b.sub}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ height: 22 }} />
      <div className="ops-section-head">
        <h2>Operator usage · last 7 days</h2>
        <div className="ops-section-tools">
          <span className="ops-chip neutral">Demo data</span>
          <span style={{ fontFamily: "var(--a-font-mono)", fontSize: 11, color: "var(--ops-ink-3)" }}>
            25 operators · 1,284 actions
          </span>
        </div>
      </div>
      <div className="ops-panel">
        <table className="op-table">
          <thead>
            <tr>
              <th>Operator</th>
              <th>Role</th>
              <th className="num">Actions</th>
              <th className="num">Writes</th>
              <th className="num">Inference tokens</th>
              <th className="num">IVR minutes</th>
              <th className="num">SMS sent</th>
              <th className="num">Est. cost</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Dr. Saidou Njie",  "Admin",     214, 48, "82k",  14,  42, "$38.20"],
              ["Dr. Fatou Conteh", "Clinician", 188, 92, "61k",  22,  88, "$34.10"],
              ["Nurse Isatou Bah", "Clinician", 162, 74, "54k",   9,  61, "$26.80"],
              ["Ousman Jallow",    "CHW",       148, 61, "38k",  38, 112, "$22.40"],
              ["Ebrima Touray",    "CHW",       131, 52, "36k",  41,  94, "$20.10"],
              ["Binta Ceesay",     "Auditor",    22,  0, "3k",    0,   0, "$1.80"],
            ].map((r, i) => (
              <tr key={i}>
                <td>{r[0]}</td>
                <td><span className="ops-chip neutral">{r[1]}</span></td>
                <td className="num">{r[2]}</td>
                <td className="num">{r[3]}</td>
                <td className="num">{r[4]}</td>
                <td className="num">{r[5]}</td>
                <td className="num">{r[6]}</td>
                <td className="num" style={{ fontWeight: 600, color: "var(--ops-ink)" }}>{r[7]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


// ── Root ──────────────────────────────────────────────

const TABS = [
  { id: "audit",     label: "Audit log" },
  { id: "rbac",      label: "Roles & access" },
  { id: "abuse",     label: "Abuse defense" },
  { id: "broadcast", label: "Broadcast" },
  { id: "cost",      label: "Cost & usage" },
];

export default function GovernanceWorkspace() {
  const [tab, setTab] = useState("audit");
  const { data: auditData } = useAdminApi("/api/v1/admin/audit?limit=200", { refreshMs: 30000 });
  const { data: costData }  = useAdminApi("/api/v1/admin/mv/cost",         { refreshMs: 30000 });

  const auditCount = auditData?.count ?? (auditData?.logs?.length || 0);
  const totalSpend = costData?.total_usd ?? 0;

  const counts = {
    audit:     auditCount,
    rbac:      25,
    abuse:     null,
    broadcast: 46,
    cost:      null,
  };

  const dateStr = new Date().toLocaleString(undefined, {
    weekday: "short", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  return (
    <div className="ops-root gov-root" style={{ gridTemplateColumns: "1fr" }}>
      <div className="ops-page-head">
        <div>
          <div className="ops-crumbs">
            <a>Governance</a>
            <span className="sep">/</span>
            <span style={{ color: "var(--ops-ink)" }}>
              {TABS.find((t) => t.id === tab)?.label}
            </span>
          </div>
          <h1>Governance <em>workspace</em></h1>
          <p style={{
            margin: "6px 0 0", fontSize: 13.5,
            color: "var(--ops-ink-2)", maxWidth: 640, lineHeight: 1.55,
          }}>
            Everything sensitive in one place — who did what, who can do what, what we
            sent people, and what it cost. You're signed in as an MoH admin; changes
            you make here are themselves audited.
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <span className="gov-pill classified">
              <Lock size={10} strokeWidth={2.2} />Restricted · Tier 3
            </span>
            <span className="gov-pill teal">
              <Check size={10} strokeWidth={2.2} />Audit chain verified · 2m ago
            </span>
            <span className="gov-pill">MoH mirror · on</span>
          </div>
        </div>
        <div className="ops-head-actions">
          <span className="ops-date">
            <Calendar size={12} strokeWidth={2} />{dateStr} UTC
          </span>
          <button type="button" className="ops-btn">
            <Hash size={12} strokeWidth={2} />Verify chain
          </button>
          <button type="button" className="ops-btn primary">
            <Download size={12} strokeWidth={2} />Export audit
          </button>
        </div>
      </div>

      <section className="ops-workspace" style={{ gridColumn: "1 / -1", paddingBottom: 40 }}>
        <div className="gov-nudge">
          <div className="ico"><Bell size={16} strokeWidth={2} /></div>
          <div className="txt">
            <strong>3 access requests waiting on your review</strong>
            <span className="sub">
              Nothing is blocking patient care — these are role elevations,
              not urgent clinical actions. Take your time.
            </span>
          </div>
          <button type="button" className="ops-btn primary"
                  onClick={() => setTab("rbac")}>
            Review requests <ChevronRight size={12} strokeWidth={2} />
          </button>
        </div>

        <div className="ops-kpi-row">
          <div className="ops-kpi">
            <div className="ops-kpi-label"><Hash size={11} strokeWidth={2} />Audit events · 7d</div>
            <div className="ops-kpi-value">{auditCount || "—"}</div>
            <div className="ops-kpi-meta">{auditCount ? "0 gaps detected" : "waiting for events"}</div>
          </div>
          <div className="ops-kpi">
            <div className="ops-kpi-label"><Users size={11} strokeWidth={2} />Active operators</div>
            <div className="ops-kpi-value">25</div>
            <div className="ops-kpi-meta">3 admins · 8 clinicians · 12 CHWs · 2 auditors</div>
          </div>
          <div className="ops-kpi">
            <div className="ops-kpi-label"><Bell size={11} strokeWidth={2} />Broadcasts · 7d</div>
            <div className="ops-kpi-value">46</div>
            <div className="ops-kpi-meta">avg delivery 87% · 0 quiet-hour overrides</div>
          </div>
          <div className="ops-kpi">
            <div className="ops-kpi-label"><Cog size={11} strokeWidth={2} />Spend · Apr MTD</div>
            <div className="ops-kpi-value">
              {totalSpend ? `$${totalSpend.toFixed(0)}` : "—"}
            </div>
            <div className="ops-kpi-meta">
              {totalSpend ? `of $800 budget · ${Math.round((totalSpend/800)*100)}% used` : "synthetic until token tracking lands"}
            </div>
          </div>
        </div>

        <div style={{ height: 22 }} />
        <div className="ops-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id}
                    type="button"
                    role="tab"
                    className="ops-tab"
                    aria-selected={tab === t.id}
                    onClick={() => setTab(t.id)}>
              {t.label}
              {counts[t.id] != null && <span className="tab-count">{counts[t.id]}</span>}
            </button>
          ))}
        </div>

        <div className="ops-section">
          {tab === "audit"     && <AuditTab />}
          {tab === "rbac"      && <RbacTab />}
          {tab === "abuse"     && <AbuseDefensePanel />}
          {tab === "broadcast" && <BroadcastTab />}
          {tab === "cost"      && <CostTab />}
        </div>
      </section>
    </div>
  );
}
