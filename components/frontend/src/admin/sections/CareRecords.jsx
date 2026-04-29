/**
 * CareRecords — the redesigned workspace for Care Records.
 *
 * Layout (inside the existing AdminShell's main pane):
 *   ┌────────────────────────────────────────────────┐
 *   │  Care Records  · sub                  [date][+]│  page head
 *   ├────────────────────────────────────────────────┤
 *   │  [stat] [stat] [stat] [stat]                   │  4 KPI cards w/ sparkline
 *   ├────────────────────────────────────────────────┤
 *   │  Consultations · Community · Knowledge [list]  │  section tabs
 *   │  [chips] [filters]          [search …]         │  toolbar
 *   │  ┌──────────────────────────────────────────┐  │
 *   │  │  ID │ Patient │ Date │ Triage │ … │ ⋯    │  │  data table
 *   │  └──────────────────────────────────────────┘  │
 *   └────────────────────────────────────────────────┘
 *
 * Reads live data:
 *   /api/v1/admin/consultations?limit=100   (5 min stale)
 *   /api/v1/admin/community
 *   /api/v1/admin/knowledge
 *
 * Row click opens the Patient 360 side-sheet for that patient_id.
 */

import { useMemo, useState } from "react";
import {
  Stethoscope, Pill, Activity, Users, BookOpen,
  Calendar, FileText, Plus, Download,
  Search, Filter, ChevronDown, Eye, Edit2,
  MoreHorizontal, ArrowUpRight, ArrowDownRight,
  List, LayoutGrid,
} from "lucide-react";

import "../../styles/care-records.css";
import { Button } from "../primitives/index.jsx";
import { useAdminApi } from "../hooks/useAdminApi.js";
import PatientDetailSheet from "./PatientDetailSheet.jsx";


// ── Helpers ─────────────────────────────────────────────────────

function initials(name) {
  if (!name) return "??";
  const parts = String(name).trim().split(/\s+/);
  const a = parts[0]?.[0] || "";
  const b = parts[1]?.[0] || "";
  return (a + b).toUpperCase() || "??";
}

const AVATAR_COLORS = [
  "#f472b6", "#818cf8", "#22d3ee", "#fbbf24", "#a78bfa",
  "#34d399", "#60a5fa", "#fb923c",
];
function avatarColor(id) {
  if (!id) return AVATAR_COLORS[0];
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function fmtDate(iso) {
  if (!iso) return { day: "—", time: "" };
  try {
    const d = new Date(iso);
    if (isNaN(d)) return { day: iso.slice(0, 10), time: "" };
    return {
      day: d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
      time: d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }),
    };
  } catch { return { day: iso.slice(0, 10), time: "" }; }
}

function triageClass(t) {
  const k = (t || "").toLowerCase();
  if (k === "emergency")  return "emergency";
  if (k === "facility")   return "facility";
  if (k === "chw_visit")  return "chw_visit";
  return "self_care";
}
function triageLabel(t) {
  const k = (t || "").toLowerCase();
  if (k === "emergency")  return "Emergency";
  if (k === "facility")   return "Facility";
  if (k === "chw_visit")  return "CHW Visit";
  return "Self-care";
}

function isSameDay(iso, ref) {
  if (!iso) return false;
  try {
    const d = new Date(iso);
    return d.toDateString() === ref.toDateString();
  } catch { return false; }
}


// ── Stat card ────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, delta, up, accent, spark }) {
  const maxSpark = Math.max(1, ...(spark || [1]));
  return (
    <div className="cr-stat" style={{ "--cr-accent": accent }}>
      <div className="cr-stat-label">
        <Icon size={12} strokeWidth={2.2} />
        <span>{label}</span>
      </div>
      <div className="cr-stat-value">{value}</div>
      <div className="cr-stat-delta">
        <span className={up === true ? "up" : up === false ? "down" : ""}>
          {up === true  ? <ArrowUpRight   size={11} /> :
           up === false ? <ArrowDownRight size={11} /> : null}
        </span>
        <span>{delta}</span>
      </div>
      {spark && spark.length > 0 && (
        <div className="cr-spark-row">
          {spark.map((v, i) => (
            <span key={i}
                  className="cr-spark-bar"
                  style={{
                    height: `${(v / maxSpark) * 100}%`,
                    "--cr-accent": accent,
                  }} />
          ))}
        </div>
      )}
    </div>
  );
}


// ── Section tabs ────────────────────────────────────────────

const SECTION_TABS = [
  { id: "consultations", label: "Consultations",     icon: Stethoscope },
  { id: "community",     label: "Community records", icon: Users },
  { id: "knowledge",     label: "Knowledge base",    icon: BookOpen },
];

function SectionTabs({ value, onChange, counts, view, setView }) {
  return (
    <div className="cr-tabs" role="tablist" aria-label="Care records sections">
      {SECTION_TABS.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className="cr-tab"
        >
          <t.icon size={14} strokeWidth={2} />
          <span>{t.label}</span>
          <span className="cr-tab-count">{counts[t.id] ?? "—"}</span>
        </button>
      ))}
      <div className="cr-tabs-right">
        <div style={{
          display: "inline-flex", padding: 3, gap: 2,
          borderRadius: 10,
          background: "rgba(255, 255, 255, 0.03)",
          border: "1px solid var(--a-border-1)",
        }}>
          <button
            type="button"
            aria-selected={view === "list"}
            onClick={() => setView("list")}
            style={{
              padding: "5px 10px",
              border: "none",
              borderRadius: 7,
              background: view === "list" ? "rgba(129, 140, 248, 0.22)" : "transparent",
              color: view === "list" ? "var(--a-fg)" : "var(--a-fg-mute)",
              cursor: "pointer",
              display: "inline-flex", alignItems: "center",
              boxShadow: view === "list" ? "inset 0 0 0 1px rgba(129, 140, 248, 0.35)" : "none",
            }}
          >
            <List size={12} />
          </button>
          <button
            type="button"
            aria-selected={view === "grid"}
            onClick={() => setView("grid")}
            style={{
              padding: "5px 10px",
              border: "none",
              borderRadius: 7,
              background: view === "grid" ? "rgba(129, 140, 248, 0.22)" : "transparent",
              color: view === "grid" ? "var(--a-fg)" : "var(--a-fg-mute)",
              cursor: "pointer",
              display: "inline-flex", alignItems: "center",
              boxShadow: view === "grid" ? "inset 0 0 0 1px rgba(129, 140, 248, 0.35)" : "none",
            }}
          >
            <LayoutGrid size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}


// ── Toolbar ────────────────────────────────────────────────

function Toolbar({ filters, setFilters, search, setSearch }) {
  const toggle = (k) => setFilters((p) => ({ ...p, [k]: !p[k] }));
  return (
    <div className="cr-toolbar">
      <button type="button"
              className={"cr-chip" + (filters.urgent ? " on" : "")}
              onClick={() => toggle("urgent")}
              style={{ "--cr-chip-dot": "var(--a-danger)" }}>
        <span className="cr-chip-dot" />
        Urgent only
      </button>
      <button type="button"
              className={"cr-chip" + (filters.today ? " on" : "")}
              onClick={() => toggle("today")}>
        <Calendar size={11} strokeWidth={2} /> Today
      </button>
      <button type="button"
              className={"cr-chip" + (filters.chwOnly ? " on" : "")}
              onClick={() => toggle("chwOnly")}>
        <Users size={11} strokeWidth={2} /> CHW visits
      </button>
      <button type="button" className="cr-chip">
        <Filter size={11} strokeWidth={2} /> Triage
        <ChevronDown size={11} strokeWidth={2} />
      </button>

      <label className="cr-toolbar-search" aria-label="Search records">
        <Search size={13} strokeWidth={2} />
        <input
          placeholder="Search by ID, patient, or note…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>

      <button type="button"
              className="cr-row-action"
              title="Export"
              aria-label="Export"
              style={{ width: 32, height: 32 }}>
        <Download size={14} strokeWidth={2} />
      </button>
    </div>
  );
}


// ── Consultations table ───────────────────────────────────

function ConsultationsTable({ rows, onRowClick }) {
  if (rows.length === 0) {
    return (
      <div className="cr-table-wrap">
        <div className="cr-empty">No consultations match your filters.</div>
      </div>
    );
  }
  return (
    <div className="cr-table-wrap">
      <table className="cr-table" aria-label="Consultations">
        <thead>
          <tr>
            <th style={{ width: 140 }}>ID</th>
            <th>Patient</th>
            <th style={{ width: 140 }}>Date</th>
            <th style={{ width: 130 }}>Triage</th>
            <th>Summary</th>
            <th style={{ width: 200 }}>Tools</th>
            <th style={{ width: 120, textAlign: "right" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const d = fmtDate(r.started_at);
            const tk = triageClass(r.triage_level);
            const tl = triageLabel(r.triage_level);
            const patientName = r.patient_name || r.patient_id || "—";
            return (
              <tr key={r.id || i}
                  style={{ "--cr-d": `${i * 36}ms` }}
                  onClick={() => r.patient_id && onRowClick && onRowClick(r.patient_id)}>
                <td className="cr-cell-id">{r.id}</td>
                <td>
                  <div className="cr-cell-patient">
                    <div className="cr-patient-avatar"
                         style={{
                           background: `linear-gradient(135deg, ${avatarColor(r.patient_id)}, #4338ca)`,
                         }}>
                      {initials(patientName)}
                    </div>
                    <div>
                      <div className="cr-patient-name">{patientName}</div>
                      <div className="cr-patient-meta">{r.patient_id || "—"}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <div className="cr-date-day">{d.day}</div>
                  {d.time && <div className="cr-date-time">{d.time}</div>}
                </td>
                <td>
                  <span className={`cr-triage ${tk}`}>
                    <span className="d" />
                    {tl}
                  </span>
                </td>
                <td>
                  <div className="cr-summary">
                    {r.summary || r.symptoms_reported || "—"}
                  </div>
                </td>
                <td>
                  <div className="cr-tool-pills">
                    {(r.tools_used || []).slice(0, 4).map((t) => (
                      <span key={t} className="cr-tool-pill">
                        {String(t).replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <div className="cr-row-actions">
                    <button type="button" className="cr-row-action" title="View"
                            onClick={() => r.patient_id && onRowClick(r.patient_id)}>
                      <Eye size={14} strokeWidth={2} />
                    </button>
                    <button type="button" className="cr-row-action" title="More">
                      <MoreHorizontal size={14} strokeWidth={2} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="cr-table-foot">
        <span>Showing {rows.length} consultation{rows.length === 1 ? "" : "s"}</span>
      </div>
    </div>
  );
}


// ── Community records list ──────────────────────────────

function CommunityList({ rows }) {
  if (rows.length === 0) {
    return (
      <div className="cr-table-wrap">
        <div className="cr-empty">No community records found.</div>
      </div>
    );
  }
  return (
    <div className="cr-table-wrap">
      <table className="cr-table" aria-label="Community records">
        <thead>
          <tr>
            <th style={{ width: 100 }}>Session</th>
            <th style={{ width: 200 }}>Traditional care</th>
            <th style={{ width: 200 }}>Modern care</th>
            <th>Interaction flag</th>
            <th>Progress</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const d = r.data || {};
            const trad = d.traditional_care || {};
            const mod  = d.modern_care || {};
            const flag = d.interactions_flag || {};
            const prog = d.progress || {};
            return (
              <tr key={i} style={{ "--cr-d": `${i * 36}ms` }}>
                <td className="cr-cell-id">{r.session_id || `#${i + 1}`}</td>
                <td>
                  <div className="cr-patient-name">{trad.practitioner || "—"}</div>
                  <div className="cr-patient-meta">
                    {(trad.practices || []).slice(0, 2).join(" · ") || "no practices listed"}
                  </div>
                </td>
                <td>
                  <div className="cr-patient-name">{mod.facility || "—"}</div>
                  <div className="cr-patient-meta">
                    {(mod.medications || []).slice(0, 2).join(" · ") || "no medications"}
                  </div>
                </td>
                <td>
                  <span className={`cr-triage ${flag.safe ? "self_care" : "facility"}`}>
                    <span className="d" />
                    {flag.safe ? "Safe" : "Review"}
                  </span>
                  <div className="cr-patient-meta" style={{ marginTop: 4, maxWidth: 280 }}>
                    {flag.notes || "—"}
                  </div>
                </td>
                <td>
                  <div className="cr-summary">
                    {prog.message || "—"}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="cr-table-foot">
        <span>Showing {rows.length} community record{rows.length === 1 ? "" : "s"}</span>
      </div>
    </div>
  );
}


// ── Knowledge base list ────────────────────────────────

function KnowledgeList({ sources }) {
  if (!sources || sources.length === 0) {
    return (
      <div className="cr-table-wrap">
        <div className="cr-empty">No knowledge sources indexed yet.</div>
      </div>
    );
  }
  const total = sources.reduce((s, x) => s + (x.chunks || 0), 0);
  return (
    <div className="cr-table-wrap">
      <table className="cr-table" aria-label="Knowledge base">
        <thead>
          <tr>
            <th>Source</th>
            <th style={{ width: 140, textAlign: "right" }}>Chunks</th>
            <th style={{ width: 180 }}>Coverage</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s, i) => {
            const pct = total ? (s.chunks / total) * 100 : 0;
            return (
              <tr key={s.source} style={{ "--cr-d": `${i * 30}ms`, cursor: "default" }}>
                <td>
                  <div className="cr-patient-name">{s.source}</div>
                  <div className="cr-patient-meta">
                    {s.source.toLowerCase().endsWith(".pdf") ? "PDF guideline"
                     : s.source.toLowerCase().endsWith(".txt") ? "text corpus"
                     : "document"}
                  </div>
                </td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {s.chunks?.toLocaleString()}
                </td>
                <td>
                  <div style={{
                    width: "100%", height: 5, borderRadius: 999,
                    background: "rgba(255, 255, 255, 0.04)", overflow: "hidden",
                  }}>
                    <div style={{
                      width: `${Math.max(3, pct)}%`,
                      height: "100%",
                      background: "linear-gradient(90deg, #818cf8, #f472b6)",
                      borderRadius: 999,
                    }} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="cr-table-foot">
        <span>{sources.length} source{sources.length === 1 ? "" : "s"} · {total.toLocaleString()} chunks total</span>
      </div>
    </div>
  );
}


// ── Root ──────────────────────────────────────────────

export default function CareRecords() {
  const [tab, setTab]         = useState("consultations");
  const [view, setView]       = useState("list");
  const [filters, setFilters] = useState({ urgent: false, today: false, chwOnly: false });
  const [search, setSearch]   = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState(null);

  const { data: cRes } = useAdminApi("/api/v1/admin/consultations?limit=100", { refreshMs: 30000 });
  const { data: mRes } = useAdminApi("/api/v1/admin/community");
  const { data: kRes } = useAdminApi("/api/v1/admin/knowledge");

  const consultations = cRes?.consultations || [];
  const community     = mRes?.records        || [];
  const knowledge     = kRes?.sources        || [];

  // Filter consultations
  const filteredConsults = useMemo(() => {
    const today = new Date();
    return consultations.filter((r) => {
      const t = (r.triage_level || "").toLowerCase();
      if (filters.urgent  && t !== "emergency" && t !== "facility") return false;
      if (filters.chwOnly && t !== "chw_visit")                    return false;
      if (filters.today   && !isSameDay(r.started_at, today))      return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = [
          r.id, r.patient_id, r.patient_name, r.summary,
          r.symptoms_reported, (r.tools_used || []).join(" "),
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [consultations, filters, search]);

  // Stats
  const stats = useMemo(() => {
    const today = new Date();
    const todayCount = consultations.filter((r) => isSameDay(r.started_at, today)).length;
    const urgentCount = consultations.filter((r) => {
      const t = (r.triage_level || "").toLowerCase();
      return t === "emergency" || t === "facility";
    }).length;
    const chwCount = consultations.filter((r) =>
      (r.triage_level || "").toLowerCase() === "chw_visit").length;
    const selfCareCount = consultations.filter((r) =>
      (r.triage_level || "").toLowerCase() === "self_care").length;

    const daySpark = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (11 - i));
      return consultations.filter((r) => isSameDay(r.started_at, d)).length;
    });

    return { todayCount, urgentCount, chwCount, selfCareCount, daySpark };
  }, [consultations]);

  const counts = {
    consultations: consultations.length,
    community:     community.length,
    knowledge:     knowledge.length,
  };

  const dateStr = new Date().toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric",
  });

  return (
    <div className="cr-workspace">
      {/* Page head */}
      <div className="cr-head">
        <div className="cr-head-left">
          <h1 className="cr-title">Care <em>Records</em></h1>
          <p className="cr-sub">Consultations · community records · knowledge base</p>
        </div>
        <div className="cr-head-actions">
          <div className="cr-date-chip">
            <Calendar size={12} />
            <span>{dateStr}</span>
          </div>
          <Button variant="secondary" size="md" leadIcon={FileText}>
            Templates
          </Button>
          <Button variant="primary" size="md" leadIcon={Plus}>
            New consultation
          </Button>
        </div>
      </div>

      {/* Stat strip */}
      <div className="cr-stats">
        <StatCard
          label="Consultations today"
          icon={Stethoscope}
          value={stats.todayCount}
          delta={stats.todayCount > 0 ? "active day" : "no consults yet"}
          up={stats.todayCount > 0}
          accent="rgba(129, 140, 248, 0.85)"
          spark={stats.daySpark}
        />
        <StatCard
          label="Urgent open"
          icon={Activity}
          value={stats.urgentCount}
          delta={`${stats.urgentCount} facility+emergency`}
          up={stats.urgentCount === 0}
          accent="rgba(244, 114, 182, 0.85)"
          spark={stats.daySpark}
        />
        <StatCard
          label="CHW visits"
          icon={Users}
          value={stats.chwCount}
          delta="field visits logged"
          up={true}
          accent="rgba(34, 211, 238, 0.85)"
          spark={stats.daySpark}
        />
        <StatCard
          label="Self-care"
          icon={Pill}
          value={stats.selfCareCount}
          delta="resolved at home"
          up={true}
          accent="rgba(251, 191, 36, 0.85)"
          spark={stats.daySpark}
        />
      </div>

      {/* Section tabs + view toggle */}
      <SectionTabs value={tab} onChange={setTab} counts={counts} view={view} setView={setView} />

      {/* Toolbar — only for Consultations tab (others don't need the filters) */}
      {tab === "consultations" && (
        <Toolbar filters={filters} setFilters={setFilters} search={search} setSearch={setSearch} />
      )}

      {/* Body */}
      {tab === "consultations" && (
        <ConsultationsTable rows={filteredConsults} onRowClick={setSelectedPatientId} />
      )}
      {tab === "community"  && <CommunityList rows={community} />}
      {tab === "knowledge"  && <KnowledgeList sources={knowledge} />}

      {/* Patient 360 drill-in (opened from row click) */}
      <PatientDetailSheet
        patientId={selectedPatientId}
        onClose={() => setSelectedPatientId(null)}
      />
    </div>
  );
}
