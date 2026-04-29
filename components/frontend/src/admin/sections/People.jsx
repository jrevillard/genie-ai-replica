/**
 * People — redesigned workspace for Patients, CHWs/caregivers, Literacy
 * verification, and Care transfers.
 *
 * Mirrors CareRecords.jsx structure (page head → stats → section tabs
 * → toolbar → data table) and reuses the same `.cr-*` classes declared
 * in `care-records.css`.
 *
 * Live endpoints:
 *   /api/v1/admin/patients?limit=100              (patients)
 *   /api/v1/admin/caregivers-directory            (CHWs + caregivers)
 *   /api/v1/literacy/admin/queue?limit=200        (verification queue)
 *   /api/v1/admin/transfer-requests               (care transfers)
 *
 * Patient row click opens the Patient 360 side-sheet.
 */

import { useMemo, useState } from "react";
import {
  Users, UserCheck, UserPlus, BookOpen, ArrowLeftRight,
  Phone, MapPin, ShieldCheck, Plus, Download, Filter,
  Search, ChevronDown, Eye, MoreHorizontal,
  ArrowUpRight, ArrowDownRight, Calendar, Mic,
  Check, X, ChevronUp, FileText, ClipboardList,
} from "lucide-react";

import "../../styles/care-records.css";
import { Button } from "../primitives/index.jsx";
import { useAdminApi, adminAuthHeaders, ADMIN_API } from "../hooks/useAdminApi.js";
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
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d)) return iso.slice(0, 10);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch { return iso.slice(0, 10); }
}


// Map literacy level → triage-style badge class
//   verified (evidence on file)        → self_care (green, routine)
//   guardian-assisted / partial        → chw_visit  (cyan, review)
//   voice-only / unverified            → facility   (amber, watch)
function literacyClass(level) {
  const k = (level || "").toLowerCase();
  if (k.includes("verified") || k === "literate" || k === "high")   return "self_care";
  if (k.includes("guardian") || k === "partial" || k === "medium")  return "chw_visit";
  if (k.includes("voice")    || k === "illiterate" || k === "low")  return "facility";
  return "chw_visit";
}
function literacyLabel(level) {
  const k = (level || "").toLowerCase();
  if (!k) return "Unknown";
  if (k === "literate")    return "Verified";
  if (k === "partial")     return "Guardian";
  if (k === "illiterate")  return "Voice-first";
  if (k === "high")        return "Verified";
  if (k === "medium")      return "Guardian";
  if (k === "low")         return "Voice-first";
  return k.charAt(0).toUpperCase() + k.slice(1);
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
  { id: "patients",   label: "Patients",          icon: Users },
  { id: "caregivers", label: "CHWs & caregivers", icon: UserCheck },
  { id: "approvals",  label: "CG approvals",      icon: ClipboardList },
  { id: "literacy",   label: "Literacy verify",   icon: BookOpen },
  { id: "transfers",  label: "Care transfers",    icon: ArrowLeftRight },
];

function SectionTabs({ value, onChange, counts }) {
  return (
    <div className="cr-tabs" role="tablist" aria-label="People sections">
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
    </div>
  );
}


// ── Toolbar ────────────────────────────────────────────────

function Toolbar({ tab, filters, setFilters, search, setSearch }) {
  const toggle = (k) => setFilters((p) => ({ ...p, [k]: !p[k] }));
  return (
    <div className="cr-toolbar">
      {tab === "patients" && (
        <>
          <button type="button"
                  className={"cr-chip" + (filters.needsVerify ? " on" : "")}
                  onClick={() => toggle("needsVerify")}
                  style={{ "--cr-chip-dot": "var(--a-warn, #fbbf24)" }}>
            <span className="cr-chip-dot" />
            Needs verification
          </button>
          <button type="button"
                  className={"cr-chip" + (filters.seenThisWeek ? " on" : "")}
                  onClick={() => toggle("seenThisWeek")}>
            <Calendar size={11} strokeWidth={2} /> Seen this week
          </button>
          <button type="button"
                  className={"cr-chip" + (filters.voiceFirst ? " on" : "")}
                  onClick={() => toggle("voiceFirst")}>
            <Mic size={11} strokeWidth={2} /> Voice-first
          </button>
          <button type="button" className="cr-chip">
            <MapPin size={11} strokeWidth={2} /> Region
            <ChevronDown size={11} strokeWidth={2} />
          </button>
          <button type="button" className="cr-chip">
            <Filter size={11} strokeWidth={2} /> Condition
            <ChevronDown size={11} strokeWidth={2} />
          </button>
        </>
      )}

      {tab === "caregivers" && (
        <>
          <button type="button"
                  className={"cr-chip" + (filters.onShift ? " on" : "")}
                  onClick={() => toggle("onShift")}
                  style={{ "--cr-chip-dot": "var(--a-success, #34d399)" }}>
            <span className="cr-chip-dot" />
            On shift
          </button>
          <button type="button" className="cr-chip">
            <MapPin size={11} strokeWidth={2} /> Region
            <ChevronDown size={11} strokeWidth={2} />
          </button>
          <button type="button" className="cr-chip">
            <Filter size={11} strokeWidth={2} /> Specialization
            <ChevronDown size={11} strokeWidth={2} />
          </button>
        </>
      )}

      {tab === "literacy" && (
        <>
          <button type="button"
                  className={"cr-chip" + (filters.pending ? " on" : "")}
                  onClick={() => toggle("pending")}
                  style={{ "--cr-chip-dot": "var(--a-warn, #fbbf24)" }}>
            <span className="cr-chip-dot" />
            Pending only
          </button>
          <button type="button" className="cr-chip">
            <Filter size={11} strokeWidth={2} /> Declared level
            <ChevronDown size={11} strokeWidth={2} />
          </button>
        </>
      )}

      {tab === "transfers" && (
        <>
          <button type="button"
                  className={"cr-chip" + (filters.pending ? " on" : "")}
                  onClick={() => toggle("pending")}
                  style={{ "--cr-chip-dot": "var(--a-warn, #fbbf24)" }}>
            <span className="cr-chip-dot" />
            Pending only
          </button>
          <button type="button" className="cr-chip">
            <MapPin size={11} strokeWidth={2} /> Region
            <ChevronDown size={11} strokeWidth={2} />
          </button>
        </>
      )}

      <label className="cr-toolbar-search" aria-label="Search people">
        <Search size={13} strokeWidth={2} />
        <input
          placeholder={
            tab === "patients"   ? "Search by name, phone, or ID…" :
            tab === "caregivers" ? "Search caregivers…" :
            tab === "literacy"   ? "Search patient ID or name…" :
                                   "Search by patient or caregiver…"
          }
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


// ── Patients table ────────────────────────────────────────

function PatientsTable({ rows, onRowClick }) {
  if (rows.length === 0) {
    return (
      <div className="cr-table-wrap">
        <div className="cr-empty">No patients match your filters.</div>
      </div>
    );
  }
  return (
    <div className="cr-table-wrap">
      <table className="cr-table" aria-label="Patients">
        <thead>
          <tr>
            <th style={{ width: 140 }}>ID</th>
            <th>Name</th>
            <th style={{ width: 140 }}>Phone</th>
            <th style={{ width: 60 }}>Age</th>
            <th style={{ width: 90 }}>Gender</th>
            <th style={{ width: 130 }}>Region</th>
            <th>Conditions</th>
            <th style={{ width: 130 }}>Literacy</th>
            <th style={{ width: 70, textAlign: "right" }}>Visits</th>
            <th style={{ width: 100, textAlign: "right" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p, i) => {
            const name = p.name || "—";
            const lc = literacyClass(p.literacy || p.literacy_level);
            const ll = literacyLabel(p.literacy || p.literacy_level);
            const conditions = Array.isArray(p.conditions) ? p.conditions : [];
            return (
              <tr key={p.id || i}
                  style={{ "--cr-d": `${i * 30}ms` }}
                  onClick={() => p.id && onRowClick && onRowClick(p.id)}>
                <td className="cr-cell-id">{p.id || "—"}</td>
                <td>
                  <div className="cr-cell-patient">
                    <div className="cr-patient-avatar"
                         style={{
                           background: `linear-gradient(135deg, ${avatarColor(p.id)}, #4338ca)`,
                         }}>
                      {initials(name)}
                    </div>
                    <div>
                      <div className="cr-patient-name">{name}</div>
                      <div className="cr-patient-meta">{p.id || "—"}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <div className="cr-date-day">{p.phone || p.email || "—"}</div>
                </td>
                <td style={{ fontVariantNumeric: "tabular-nums" }}>{p.age || "—"}</td>
                <td style={{ textTransform: "capitalize" }}>{p.gender || "—"}</td>
                <td style={{ textTransform: "capitalize" }}>
                  {(p.region || "—").toString().replace(/_/g, " ")}
                </td>
                <td>
                  <div className="cr-tool-pills">
                    {conditions.slice(0, 3).map((c) => (
                      <span key={c} className="cr-tool-pill">
                        {String(c).replace(/_/g, " ")}
                      </span>
                    ))}
                    {conditions.length === 0 && <span className="cr-patient-meta">—</span>}
                  </div>
                </td>
                <td>
                  <span className={`cr-triage ${lc}`}>
                    <span className="d" />
                    {ll}
                  </span>
                </td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {p.consultation_count ?? p.visits ?? 0}
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <div className="cr-row-actions">
                    <button type="button" className="cr-row-action" title="View 360"
                            onClick={() => p.id && onRowClick(p.id)}>
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
        <span>Showing {rows.length} patient{rows.length === 1 ? "" : "s"}</span>
      </div>
    </div>
  );
}


// ── Caregivers table ───────────────────────────────────────

function CaregiversTable({ rows }) {
  if (rows.length === 0) {
    return (
      <div className="cr-table-wrap">
        <div className="cr-empty">No caregivers in directory yet.</div>
      </div>
    );
  }
  return (
    <div className="cr-table-wrap">
      <table className="cr-table" aria-label="Caregivers directory">
        <thead>
          <tr>
            <th style={{ width: 180 }}>ID</th>
            <th>Name</th>
            <th style={{ width: 180 }}>Specialization</th>
            <th style={{ width: 160 }}>Region</th>
            <th style={{ width: 160 }}>Phone</th>
            <th style={{ width: 100, textAlign: "right" }}>Patients</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c, i) => {
            const name = c.name || "—";
            const cid  = c.caregiver_id || c.id || "—";
            return (
              <tr key={cid} style={{ "--cr-d": `${i * 30}ms`, cursor: "default" }}>
                <td className="cr-cell-id">{cid}</td>
                <td>
                  <div className="cr-cell-patient">
                    <div className="cr-patient-avatar"
                         style={{
                           background: `linear-gradient(135deg, ${avatarColor(cid)}, #4338ca)`,
                         }}>
                      {initials(name)}
                    </div>
                    <div>
                      <div className="cr-patient-name">{name}</div>
                      <div className="cr-patient-meta">{c.role || "Caregiver"}</div>
                    </div>
                  </div>
                </td>
                <td style={{ textTransform: "capitalize" }}>
                  {(c.specialization || "General").replace(/_/g, " ")}
                </td>
                <td style={{ textTransform: "capitalize" }}>
                  {(c.region || "—").toString().replace(/_/g, " ")}
                </td>
                <td>{c.phone || "—"}</td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {c.patient_count ?? c.assigned_patients ?? 0}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="cr-table-foot">
        <span>Showing {rows.length} caregiver{rows.length === 1 ? "" : "s"}</span>
      </div>
    </div>
  );
}


// ── Literacy queue table ──────────────────────────────────

const LITERACY_LEVELS = [
  { value: "none",        label: "None" },
  { value: "lower_basic", label: "Lower Basic" },
  { value: "upper_basic", label: "Upper Basic" },
  { value: "senior_sec",  label: "Senior Secondary" },
  { value: "tertiary",    label: "Tertiary" },
];

function LiteracyTable({ rows, onRowClick, onRefresh }) {
  const [expanded, setExpanded]       = useState(null);
  const [verifyLevel, setVerifyLevel] = useState({});
  const [note, setNote]               = useState({});
  const [busy, setBusy]               = useState(null);
  const [msg, setMsg]                 = useState("");
  const [docPreview, setDocPreview]   = useState(null);

  async function approveVerification(pid, declaredLevel) {
    const level = verifyLevel[pid] || declaredLevel || "lower_basic";
    setBusy(pid);
    try {
      const r = await fetch(`${ADMIN_API}/api/v1/literacy/admin/approve/${pid}`, {
        method: "POST", headers: adminAuthHeaders(),
        body: JSON.stringify({ verified_level: level, note: note[pid] || "" }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `Error ${r.status}`);
      setMsg(`${pid} verified as ${level}.`);
      setExpanded(null);
      onRefresh?.();
    } catch (e) { setMsg(`Failed: ${e.message}`); }
    setBusy(null);
  }

  async function rejectVerification(pid) {
    const reason = prompt("Reason for rejection:");
    if (reason === null) return;
    setBusy(pid);
    try {
      const r = await fetch(`${ADMIN_API}/api/v1/literacy/admin/reject/${pid}`, {
        method: "POST", headers: adminAuthHeaders(),
        body: JSON.stringify({ note: reason || "Rejected by admin" }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `Error ${r.status}`);
      setMsg(`${pid} rejected.`);
      onRefresh?.();
    } catch (e) { setMsg(`Failed: ${e.message}`); }
    setBusy(null);
  }

  async function viewDocument(certId, filename) {
    try {
      const r = await fetch(`${ADMIN_API}/api/v1/literacy/admin/certificate/${certId}`, {
        headers: adminAuthHeaders(),
      });
      if (!r.ok) throw new Error(`Error ${r.status}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const mime = blob.type || "";
      if (mime.startsWith("image/") || mime === "application/pdf") {
        setDocPreview({ url, mime, filename: filename || certId });
      } else {
        const a = document.createElement("a");
        a.href = url; a.download = filename || certId; a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) { setMsg(`Failed to load document: ${e.message}`); }
  }

  if (rows.length === 0) {
    return (
      <div className="cr-table-wrap">
        <div className="cr-empty">No patients pending verification.</div>
      </div>
    );
  }
  return (
    <div className="cr-table-wrap">
      {msg && (
        <div onClick={() => setMsg("")} style={{
          padding: "8px 14px", margin: "0 0 10px", borderRadius: 8, cursor: "pointer",
          background: msg.startsWith("Failed") ? "rgba(239,68,68,.12)" : "rgba(34,197,94,.12)",
          color: msg.startsWith("Failed") ? "#f87171" : "#4ade80",
          fontSize: 12, fontWeight: 600,
        }}>{msg} (click to dismiss)</div>
      )}

      {docPreview && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(0,0,0,.75)", display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => { URL.revokeObjectURL(docPreview.url); setDocPreview(null); }}>
          <div style={{
            background: "#0d1026", borderRadius: 14, padding: 16, maxWidth: "90vw", maxHeight: "90vh",
            border: "1px solid rgba(255,255,255,.1)", display: "flex", flexDirection: "column", gap: 10,
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#a78bfa" }}>
                {docPreview.filename}
              </span>
              <button onClick={() => { URL.revokeObjectURL(docPreview.url); setDocPreview(null); }}
                style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 18 }}>
                ✕
              </button>
            </div>
            {docPreview.mime.startsWith("image/") ? (
              <img src={docPreview.url} alt="Certificate" style={{ maxWidth: "80vw", maxHeight: "75vh", borderRadius: 8 }} />
            ) : (
              <iframe src={docPreview.url} title="Certificate" style={{ width: "80vw", height: "75vh", border: "none", borderRadius: 8 }} />
            )}
          </div>
        </div>
      )}

      <table className="cr-table" aria-label="Literacy verification queue">
        <thead>
          <tr>
            <th style={{ width: 140 }}>Patient ID</th>
            <th>Name</th>
            <th style={{ width: 160 }}>Declared level</th>
            <th style={{ width: 120 }}>Status</th>
            <th style={{ width: 140 }}>Submitted</th>
            <th style={{ width: 240, textAlign: "right" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const pid  = r.patient_id;
            const name = r.patient_name || "—";
            const lc = literacyClass(r.declared_level);
            const ll = literacyLabel(r.declared_level);
            const status = (r.status || "pending").toLowerCase();
            const isPending = status === "pending";
            const isExp = expanded === pid;
            const statusClass = status === "verified" || status === "approved" ? "self_care"
                              : status === "rejected" ? "emergency"
                              : "facility";
            const cert = r.certificate;
            return (
              <tr key={pid || i}
                  style={{ "--cr-d": `${i * 30}ms` }}
                  onClick={() => pid && onRowClick && onRowClick(pid)}>
                <td className="cr-cell-id">{pid || "—"}</td>
                <td>
                  <div className="cr-cell-patient">
                    <div className="cr-patient-avatar"
                         style={{
                           background: `linear-gradient(135deg, ${avatarColor(pid)}, #4338ca)`,
                         }}>
                      {initials(name)}
                    </div>
                    <div>
                      <div className="cr-patient-name">{name}</div>
                      <div className="cr-patient-meta">{pid || "—"}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <span className={`cr-triage ${lc}`}>
                    <span className="d" />
                    {ll}
                  </span>
                </td>
                <td>
                  <span className={`cr-triage ${statusClass}`}>
                    <span className="d" />
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </span>
                </td>
                <td>
                  <div className="cr-date-day">{fmtDate(r.submitted_at || r.created_at)}</div>
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <div className="cr-row-actions" style={{ gap: 6 }}>
                    <button type="button" className="cr-row-action" title="View patient"
                            onClick={() => pid && onRowClick(pid)}>
                      <Eye size={14} strokeWidth={2} />
                    </button>
                    {cert && cert.cert_id && (
                      <button type="button" className="cr-row-action" title={`View document: ${cert.filename || "certificate"}`}
                              style={{ color: "#818cf8" }}
                              onClick={() => viewDocument(cert.cert_id, cert.filename)}>
                        <FileText size={14} strokeWidth={2} />
                      </button>
                    )}
                    <button type="button"
                            style={{
                              padding: "4px 10px", borderRadius: 6, border: "none", cursor: "pointer",
                              background: isPending ? "rgba(34,197,94,.15)" : "rgba(148,163,184,.08)",
                              color: isPending ? "#4ade80" : "#64748b",
                              fontSize: 11, fontWeight: 700, fontFamily: "inherit",
                              display: "inline-flex", alignItems: "center", gap: 4,
                            }}
                            onClick={() => isPending && setExpanded(isExp ? null : pid)}>
                      <Check size={12} strokeWidth={2.5} />
                      {isPending ? "Verify" : "Verified"}
                    </button>
                    {isPending && (
                      <button type="button"
                              style={{
                                padding: "4px 10px", borderRadius: 6, border: "none", cursor: "pointer",
                                background: "rgba(239,68,68,.12)", color: "#f87171",
                                fontSize: 11, fontWeight: 700, fontFamily: "inherit",
                                display: "inline-flex", alignItems: "center", gap: 4,
                              }}
                              onClick={() => rejectVerification(pid)}>
                        <X size={12} strokeWidth={2.5} />
                        Reject
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {expanded && (() => {
        const r = rows.find(row => row.patient_id === expanded);
        if (!r) return null;
        const cert = r.certificate;
        return (
          <div style={{
            margin: "0 0 12px", padding: 16, borderRadius: 10,
            background: "rgba(99,102,241,.04)", border: "1px solid rgba(99,102,241,.15)",
          }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#a78bfa", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 10 }}>
              Verify Literacy — {r.patient_name || r.patient_id}
            </div>

            <div style={{ marginBottom: 10, fontSize: 13, color: "#cbd5e1", lineHeight: 1.6 }}>
              <strong style={{ color: "#94a3b8" }}>Declared level:</strong>{" "}
              {literacyLabel(r.declared_level)}
              {cert && cert.cert_id && (
                <span style={{ marginLeft: 14 }}>
                  <button onClick={() => viewDocument(cert.cert_id, cert.filename)}
                    style={{
                      background: "rgba(129,140,248,.1)", border: "1px solid rgba(129,140,248,.25)",
                      borderRadius: 6, padding: "3px 10px", color: "#818cf8", fontSize: 12,
                      fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                    }}>
                    <FileText size={12} strokeWidth={2} style={{ verticalAlign: "middle", marginRight: 4 }} />
                    View uploaded document
                  </button>
                </span>
              )}
              {r.has_certificate === false && (
                <span style={{ marginLeft: 14, fontSize: 11, color: "#64748b", fontStyle: "italic" }}>
                  No document uploaded
                </span>
              )}
            </div>

            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", display: "block", marginBottom: 4 }}>Verified Level *</label>
              <select
                value={verifyLevel[r.patient_id] || r.declared_level || ""}
                onChange={e => setVerifyLevel(s => ({ ...s, [r.patient_id]: e.target.value }))}
                style={{
                  width: "100%", padding: "9px 12px", borderRadius: 8,
                  border: "1px solid rgba(255,255,255,.15)", background: "#0d1026",
                  color: "#e2e8f0", fontSize: 13, fontFamily: "inherit", outline: "none",
                  WebkitAppearance: "none", appearance: "none",
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                  backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center",
                  paddingRight: 32,
                }}
              >
                {LITERACY_LEVELS.map(lv => (
                  <option key={lv.value} value={lv.value} style={{ background: "#0d1026", color: "#e2e8f0" }}>
                    {lv.label}{lv.value === r.declared_level ? " [declared]" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", display: "block", marginBottom: 4 }}>Admin Note (optional)</label>
              <textarea
                rows={2}
                placeholder="Verification notes…"
                value={note[r.patient_id] || ""}
                onChange={e => setNote(n => ({ ...n, [r.patient_id]: e.target.value }))}
                style={{
                  width: "100%", padding: "8px 12px", borderRadius: 8,
                  border: "1px solid rgba(255,255,255,.15)", background: "#0d1026",
                  color: "#e2e8f0", fontSize: 13, fontFamily: "inherit", resize: "vertical", outline: "none",
                }}
              />
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => approveVerification(r.patient_id, r.declared_level)}
                disabled={busy === r.patient_id}
                style={{
                  padding: "9px 20px", borderRadius: 8, border: "none",
                  background: "linear-gradient(135deg,#22c55e,#16a34a)",
                  color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {busy === r.patient_id ? "Processing…" : "Verify Patient"}
              </button>
              <button
                onClick={() => setExpanded(null)}
                style={{
                  padding: "9px 16px", borderRadius: 8,
                  border: "1px solid rgba(255,255,255,.1)", background: "transparent",
                  color: "#94a3b8", fontWeight: 600, fontSize: 13, cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        );
      })()}

      <div className="cr-table-foot">
        <span>Showing {rows.length} pending review{rows.length === 1 ? "" : "s"}</span>
      </div>
    </div>
  );
}


// ── Transfers table ────────────────────────────────────────

function TransfersTable({ rows, caregivers, onRowClick, onRefresh }) {
  const [expanded, setExpanded]         = useState(null);
  const [selectedCg, setSelectedCg]     = useState({});
  const [note, setNote]                 = useState({});
  const [declineNote, setDeclineNote]   = useState({});
  const [busy, setBusy]                 = useState(null);
  const [msg, setMsg]                   = useState("");

  const API = ((typeof window !== "undefined" && window.AMINA_API) || "http://localhost:8000").replace(/\/+$/, "");
  function _headers() {
    try {
      const tok = localStorage.getItem("AMINA_ADMIN_TOKEN") || localStorage.getItem("AMINA_TOKEN") || "";
      return tok ? { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
    } catch { return { "Content-Type": "application/json" }; }
  }

  async function approveTransfer(rid) {
    const cgId = selectedCg[rid];
    if (!cgId) return;
    setBusy(rid);
    try {
      const r = await fetch(`${API}/api/v1/admin/transfer-requests/${rid}/approve`, {
        method: "POST", headers: _headers(),
        body: JSON.stringify({ new_caregiver_id: cgId, admin_note: note[rid] || "" }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `Error ${r.status}`);
      setMsg(`Transfer ${rid} approved.`);
      setExpanded(null);
      onRefresh?.();
    } catch (e) { setMsg(`Failed: ${e.message}`); }
    setBusy(null);
  }

  async function declineTransfer(rid) {
    setBusy(rid);
    try {
      const r = await fetch(`${API}/api/v1/admin/transfer-requests/${rid}/decline`, {
        method: "POST", headers: _headers(),
        body: JSON.stringify({ reason: declineNote[rid] || "Declined by admin" }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `Error ${r.status}`);
      setMsg(`Transfer ${rid} declined.`);
      setExpanded(null);
      onRefresh?.();
    } catch (e) { setMsg(`Failed: ${e.message}`); }
    setBusy(null);
  }

  if (rows.length === 0) {
    return (
      <div className="cr-table-wrap">
        <div className="cr-empty">No care-transfer requests to review.</div>
      </div>
    );
  }
  return (
    <div className="cr-table-wrap">
      {msg && (
        <div onClick={() => setMsg("")} style={{
          padding: "8px 14px", margin: "0 0 10px", borderRadius: 8, cursor: "pointer",
          background: msg.startsWith("Failed") ? "rgba(239,68,68,.12)" : "rgba(34,197,94,.12)",
          color: msg.startsWith("Failed") ? "#f87171" : "#4ade80",
          fontSize: 12, fontWeight: 600,
        }}>{msg} (click to dismiss)</div>
      )}
      <table className="cr-table" aria-label="Care transfers">
        <thead>
          <tr>
            <th style={{ width: 140 }}>Ref</th>
            <th>Patient</th>
            <th style={{ width: 180 }}>From</th>
            <th style={{ width: 180 }}>To</th>
            <th style={{ width: 120 }}>Status</th>
            <th style={{ width: 140 }}>Submitted</th>
            <th style={{ width: 240, textAlign: "right" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((tr, i) => {
            const status = (tr.status || "pending").toLowerCase();
            const isPending = status === "pending";
            const isExp = expanded === tr.request_id;
            const statusClass = status === "approved" ? "self_care"
                              : status === "declined" || status === "rejected" ? "emergency"
                              : "facility";
            const patientName = tr.patient_full_name || tr.patient_name || tr.patient_id || "—";
            return (
              <tr key={tr.request_id || i}
                  style={{ "--cr-d": `${i * 30}ms` }}>
                <td className="cr-cell-id">{tr.request_id || "—"}</td>
                <td>
                  <div className="cr-cell-patient">
                    <div className="cr-patient-avatar"
                         style={{
                           background: `linear-gradient(135deg, ${avatarColor(tr.patient_id)}, #4338ca)`,
                         }}>
                      {initials(patientName)}
                    </div>
                    <div>
                      <div className="cr-patient-name">{patientName}</div>
                      <div className="cr-patient-meta">{tr.patient_id || "—"}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <div className="cr-patient-name">{tr.current_caregiver_name || "—"}</div>
                  <div className="cr-patient-meta">{tr.current_caregiver_id || ""}</div>
                </td>
                <td>
                  <div className="cr-patient-name">{tr.new_caregiver_name || "— (pending)"}</div>
                  <div className="cr-patient-meta">{tr.new_caregiver_id || ""}</div>
                </td>
                <td>
                  <span className={`cr-triage ${statusClass}`}>
                    <span className="d" />
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </span>
                </td>
                <td>
                  <div className="cr-date-day">{fmtDate(tr.submitted_at)}</div>
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <div className="cr-row-actions" style={{ gap: 6 }}>
                    <button type="button" className="cr-row-action" title="View patient"
                            onClick={() => tr.patient_id && onRowClick?.(tr.patient_id)}>
                      <Eye size={14} strokeWidth={2} />
                    </button>
                    <button type="button"
                            style={{
                              padding: "4px 10px", borderRadius: 6, border: "none", cursor: isPending ? "pointer" : "default",
                              background: isPending ? "rgba(34,197,94,.15)" : "rgba(148,163,184,.08)",
                              color: isPending ? "#4ade80" : "#64748b",
                              fontSize: 11, fontWeight: 700, fontFamily: "inherit",
                              display: "inline-flex", alignItems: "center", gap: 4,
                            }}
                            onClick={() => isPending && setExpanded(isExp ? null : tr.request_id)}>
                      <Check size={12} strokeWidth={2.5} />
                      {isPending ? "Approve" : status.charAt(0).toUpperCase() + status.slice(1)}
                    </button>
                    {isPending && (
                      <button type="button"
                              style={{
                                padding: "4px 10px", borderRadius: 6, border: "none", cursor: "pointer",
                                background: "rgba(239,68,68,.12)", color: "#f87171",
                                fontSize: 11, fontWeight: 700, fontFamily: "inherit",
                                display: "inline-flex", alignItems: "center", gap: 4,
                              }}
                              onClick={() => {
                                if (confirm(`Decline transfer ${tr.request_id} for ${patientName}?`)) {
                                  declineTransfer(tr.request_id);
                                }
                              }}>
                        <X size={12} strokeWidth={2.5} />
                        Decline
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {expanded && (() => {
        const tr = rows.find(r => r.request_id === expanded);
        if (!tr) return null;
        return (
          <div style={{
            margin: "0 0 12px", padding: 16, borderRadius: 10,
            background: "rgba(99,102,241,.04)", border: "1px solid rgba(99,102,241,.15)",
          }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#a78bfa", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 10 }}>
              Approve Transfer — {tr.patient_full_name || tr.patient_id}
            </div>

            <div style={{ marginBottom: 10, fontSize: 13, color: "#cbd5e1", lineHeight: 1.6 }}>
              <strong style={{ color: "#94a3b8" }}>Reason:</strong> {tr.reason}
            </div>

            {(tr.preferred_new_caregiver_specialty || tr.preferred_new_region) && (
              <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                {tr.preferred_new_caregiver_specialty && (
                  <span style={{ padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: "rgba(99,102,241,.08)", color: "#818cf8" }}>
                    Preferred: {tr.preferred_new_caregiver_specialty}
                  </span>
                )}
                {tr.preferred_new_region && (
                  <span style={{ padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: "rgba(99,102,241,.08)", color: "#818cf8" }}>
                    Region: {tr.preferred_new_region}
                  </span>
                )}
              </div>
            )}

            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", display: "block", marginBottom: 4 }}>Assign New Caregiver *</label>
              <select
                value={selectedCg[tr.request_id] || ""}
                onChange={e => setSelectedCg(s => ({ ...s, [tr.request_id]: e.target.value }))}
                style={{
                  width: "100%", padding: "9px 12px", borderRadius: 8,
                  border: "1px solid rgba(255,255,255,.15)", background: "#0d1026",
                  color: "#e2e8f0", fontSize: 13, fontFamily: "inherit", outline: "none",
                  WebkitAppearance: "none", appearance: "none",
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                  backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center",
                  paddingRight: 32,
                }}
              >
                <option value="" style={{ background: "#0d1026", color: "#94a3b8" }}>— choose a caregiver —</option>
                {(caregivers || []).map(cg => (
                  <option key={cg.caregiver_id || cg.id} value={cg.caregiver_id || cg.id}
                          style={{ background: "#0d1026", color: "#e2e8f0" }}>
                    {cg.name} — {cg.specialization || "General"} ({cg.region || "?"})
                    {(cg.caregiver_id || cg.id) === tr.current_caregiver_id ? " [current]" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", display: "block", marginBottom: 4 }}>Admin Note (optional)</label>
              <textarea
                rows={2}
                placeholder="Reason for approval or instructions…"
                value={note[tr.request_id] || ""}
                onChange={e => setNote(n => ({ ...n, [tr.request_id]: e.target.value }))}
                style={{
                  width: "100%", padding: "8px 12px", borderRadius: 8,
                  border: "1px solid rgba(255,255,255,.15)", background: "#0d1026",
                  color: "#e2e8f0", fontSize: 13, fontFamily: "inherit", resize: "vertical", outline: "none",
                }}
              />
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => approveTransfer(tr.request_id)}
                disabled={busy === tr.request_id || !selectedCg[tr.request_id]}
                style={{
                  padding: "9px 20px", borderRadius: 8, border: "none",
                  background: selectedCg[tr.request_id] ? "linear-gradient(135deg,#22c55e,#16a34a)" : "rgba(255,255,255,.05)",
                  color: selectedCg[tr.request_id] ? "#fff" : "#475569",
                  fontWeight: 700, fontSize: 13, cursor: selectedCg[tr.request_id] ? "pointer" : "default",
                  fontFamily: "inherit",
                }}
              >
                {busy === tr.request_id ? "Processing…" : "Approve & Link Caregiver"}
              </button>
              <button
                onClick={() => setExpanded(null)}
                style={{
                  padding: "9px 16px", borderRadius: 8,
                  border: "1px solid rgba(255,255,255,.1)", background: "transparent",
                  color: "#94a3b8", fontWeight: 600, fontSize: 13, cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        );
      })()}

      <div className="cr-table-foot">
        <span>Showing {rows.length} transfer{rows.length === 1 ? "" : "s"}</span>
      </div>
    </div>
  );
}


// ── Caregiver Approvals table ─────────────────────────────────────────

const ROLE_COLORS = {
  vhw: "#4ade80", cbc: "#f472b6", chn: "#38bdf8", tba: "#fb923c",
  family: "#c084fc", scout: "#fbbf24", alkalo: "#94a3b8",
};
const ROLE_LABELS_MAP = {
  vhw: "VHW", cbc: "CBC", chn: "CHN", tba: "TBA",
  family: "Family", scout: "Scout", alkalo: "Alkalo",
};
const APPROVAL_STATUS_CLASS = {
  pending: "facility", admin_reviewed: "facility", alkalo_approved: "self_care",
  active: "self_care", rejected: "emergency", suspended: "emergency",
  more_info_needed: "facility",
};

function ApprovalsTable({ rows, onRefresh }) {
  const [expanded, setExpanded] = useState(null);
  const [note, setNote]         = useState({});
  const [rejReason, setRejReason] = useState({});
  const [skipRemaining, setSkipRemaining] = useState({});
  const [alkaloPhone, setAlkaloPhone] = useState({});
  const [busy, setBusy]         = useState(null);
  const [msg, setMsg]           = useState("");
  const [docPreview, setDocPreview] = useState(null);

  const API_BASE = ((typeof window !== "undefined" && window.AMINA_API) || "http://localhost:8000").replace(/\/+$/, "");
  function _headers() {
    try {
      const tok = localStorage.getItem("AMINA_ADMIN_TOKEN") || localStorage.getItem("AMINA_TOKEN") || "";
      return tok ? { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
    } catch { return { "Content-Type": "application/json" }; }
  }

  async function reviewApp(rid, decision) {
    setBusy(rid);
    try {
      const body = {
        decision,
        note: note[rid] || "",
        rejection_reason: decision === "reject" ? (rejReason[rid] || "Other") : undefined,
        skip_remaining: skipRemaining[rid] || false,
        alkalo_phone: alkaloPhone[rid] || undefined,
      };
      const r = await fetch(`${API_BASE}/api/v1/caregiver-v2/admin/review/${rid}`, {
        method: "POST", headers: _headers(), body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `Error ${r.status}`);
      const label = decision === "approve" ? "Approved" : decision === "reject" ? "Rejected" : "Info requested";
      setMsg(`${rid}: ${label}.`);
      setExpanded(null);
      onRefresh?.();
    } catch (e) { setMsg(`Failed: ${e.message}`); }
    setBusy(null);
  }

  async function viewDocument(rid, docKey) {
    try {
      const tok = localStorage.getItem("AMINA_ADMIN_TOKEN") || localStorage.getItem("AMINA_TOKEN") || "";
      const r = await fetch(`${API_BASE}/api/v1/caregiver-v2/admin/document/${rid}/${docKey}`, {
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      });
      if (!r.ok) throw new Error(`Error ${r.status}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const mime = blob.type || "";
      if (mime.startsWith("image/") || mime === "application/pdf") {
        setDocPreview({ url, mime, filename: `${rid}_${docKey}` });
      } else {
        const a = document.createElement("a");
        a.href = url; a.download = `${rid}_${docKey}`; a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) { setMsg(`Failed to load document: ${e.message}`); }
  }

  if (rows.length === 0) {
    return (
      <div className="cr-table-wrap">
        <div className="cr-empty">No caregiver applications to review.</div>
      </div>
    );
  }

  return (
    <div className="cr-table-wrap">
      {msg && (
        <div onClick={() => setMsg("")} style={{
          padding: "8px 14px", margin: "0 0 10px", borderRadius: 8, cursor: "pointer",
          background: msg.startsWith("Failed") ? "rgba(239,68,68,.12)" : "rgba(34,197,94,.12)",
          color: msg.startsWith("Failed") ? "#f87171" : "#4ade80",
          fontSize: 12, fontWeight: 600,
        }}>{msg} (click to dismiss)</div>
      )}

      {docPreview && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(0,0,0,.75)", display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => { URL.revokeObjectURL(docPreview.url); setDocPreview(null); }}>
          <div style={{
            background: "#0d1026", borderRadius: 14, padding: 16, maxWidth: "90vw", maxHeight: "90vh",
            border: "1px solid rgba(255,255,255,.1)", display: "flex", flexDirection: "column", gap: 10,
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#a78bfa" }}>{docPreview.filename}</span>
              <button onClick={() => { URL.revokeObjectURL(docPreview.url); setDocPreview(null); }}
                style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 18 }}>
                ✕
              </button>
            </div>
            {docPreview.mime.startsWith("image/") ? (
              <img src={docPreview.url} alt="Document" style={{ maxWidth: "80vw", maxHeight: "75vh", borderRadius: 8 }} />
            ) : (
              <iframe src={docPreview.url} title="Document" style={{ width: "80vw", height: "75vh", border: "none", borderRadius: 8 }} />
            )}
          </div>
        </div>
      )}

      <table className="cr-table" aria-label="Caregiver applications">
        <thead>
          <tr>
            <th style={{ width: 110 }}>Reg ID</th>
            <th>Name</th>
            <th style={{ width: 90 }}>Role</th>
            <th style={{ width: 140 }}>Village / Region</th>
            <th style={{ width: 130 }}>Status</th>
            <th style={{ width: 80 }}>Docs</th>
            <th style={{ width: 120 }}>Submitted</th>
            <th style={{ width: 160, textAlign: "right" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((app, i) => {
            const rid = app.registration_id;
            const status = (app.status || "pending").toLowerCase();
            const isPending = status === "pending" || status === "more_info_needed";
            const isExp = expanded === rid;
            const roleColor = ROLE_COLORS[app.role] || "#94a3b8";
            const roleLabel = ROLE_LABELS_MAP[app.role] || app.role;
            const statusClass = APPROVAL_STATUS_CLASS[status] || "facility";
            const docs = app.uploaded_documents || {};
            const docCount = Object.keys(docs).length;
            return (
              <tr key={rid || i} style={{ "--cr-d": `${i * 30}ms` }}>
                <td className="cr-cell-id">{rid || "—"}</td>
                <td>
                  <div className="cr-cell-patient">
                    <div className="cr-patient-avatar"
                      style={{ background: `linear-gradient(135deg, ${roleColor}, #4338ca)` }}>
                      {initials(app.full_name || "")}
                    </div>
                    <div>
                      <div className="cr-patient-name">{app.full_name || "—"}</div>
                      <div className="cr-patient-meta">{app.phone || "—"}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <span style={{
                    padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700,
                    background: `${roleColor}18`, color: roleColor, border: `1px solid ${roleColor}30`,
                  }}>{roleLabel}</span>
                </td>
                <td>
                  <div className="cr-patient-name" style={{ fontSize: 12 }}>{app.village || "—"}</div>
                  <div className="cr-patient-meta">{app.health_region || ""}</div>
                </td>
                <td>
                  <span className={`cr-triage ${statusClass}`}>
                    <span className="d" />
                    {status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                  </span>
                </td>
                <td style={{ textAlign: "center" }}>
                  {docCount > 0 ? (
                    <span style={{ color: "#4ade80", fontSize: 12, fontWeight: 700 }}>
                      {docCount} ✓
                    </span>
                  ) : (
                    <span style={{ color: "#f87171", fontSize: 12, fontWeight: 700 }}>—</span>
                  )}
                </td>
                <td>
                  <div className="cr-date-day">{fmtDate(app.submitted_at)}</div>
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <div className="cr-row-actions">
                    {Object.keys(docs).map((dk) => (
                      <button key={dk} type="button" className="cr-row-action" title={`View ${dk}`}
                        style={{ color: "#818cf8" }}
                        onClick={() => viewDocument(rid, dk)}>
                        <FileText size={14} strokeWidth={2} />
                      </button>
                    ))}
                    {isPending && (
                      <>
                        <button type="button" className="cr-row-action" title="Review & Approve"
                          style={{ color: "#4ade80" }}
                          onClick={() => setExpanded(isExp ? null : rid)}>
                          {isExp ? <ChevronUp size={14} strokeWidth={2} /> : <Check size={14} strokeWidth={2.5} />}
                        </button>
                        <button type="button" className="cr-row-action" title="Reject"
                          style={{ color: "#f87171" }}
                          onClick={() => {
                            const reason = prompt("Reason for rejection:");
                            if (reason !== null) {
                              setRejReason((s) => ({ ...s, [rid]: reason || "Other" }));
                              reviewApp(rid, "reject");
                            }
                          }}>
                          <X size={14} strokeWidth={2.5} />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {expanded && (() => {
        const app = rows.find((r) => r.registration_id === expanded);
        if (!app) return null;
        const rid = app.registration_id;
        const chain = app.approval_chain || [];
        const docs = app.uploaded_documents || {};
        const regData = app.registration_data || {};
        const needsAlkalo = chain.some((s) => s.step_name === "alkalo_confirmation" && !s.completed);
        return (
          <div style={{
            margin: "0 0 12px", padding: 16, borderRadius: 10,
            background: "rgba(99,102,241,.04)", border: "1px solid rgba(99,102,241,.15)",
          }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#a78bfa", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 12 }}>
              Review — {app.full_name} ({ROLE_LABELS_MAP[app.role] || app.role})
            </div>

            {/* Applicant info */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
              <InfoItem label="Phone" value={app.phone} />
              <InfoItem label="Village" value={app.village || "—"} />
              <InfoItem label="Region" value={app.health_region || "—"} />
              {regData.alkalo_name && <InfoItem label="Alkalo" value={regData.alkalo_name} />}
              {regData.facility_name && <InfoItem label="Facility" value={regData.facility_name} />}
              {regData.employee_id && <InfoItem label="Employee ID" value={regData.employee_id} />}
              {regData.years_experience > 0 && <InfoItem label="Experience" value={`${regData.years_experience} years`} />}
              {regData.training_completed !== undefined && (
                <InfoItem label="MoH Training" value={regData.training_completed ? `Yes (${regData.training_year || "?"})` : "No"} />
              )}
              {regData.languages_spoken?.length > 0 && (
                <InfoItem label="Languages" value={regData.languages_spoken.join(", ")} />
              )}
              {regData.relationship && <InfoItem label="Relationship" value={regData.relationship} />}
              {regData.age && <InfoItem label="Age" value={regData.age} />}
            </div>

            {/* Documents */}
            {Object.keys(docs).length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 6 }}>DOCUMENTS</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {Object.entries(docs).map(([dk, d]) => (
                    <button key={dk} onClick={() => viewDocument(rid, dk)}
                      style={{
                        background: "rgba(129,140,248,.1)", border: "1px solid rgba(129,140,248,.25)",
                        borderRadius: 6, padding: "5px 12px", color: "#818cf8", fontSize: 12,
                        fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                        display: "flex", alignItems: "center", gap: 4,
                      }}>
                      <FileText size={12} strokeWidth={2} />
                      {dk.replace(/_/g, " ")}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Approval chain progress */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 6 }}>APPROVAL CHAIN</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {chain.map((step, idx) => (
                  <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                    <span style={{
                      width: 18, height: 18, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                      background: step.completed ? "rgba(34,197,94,.15)" : "rgba(148,163,184,.1)",
                      color: step.completed ? "#4ade80" : "#64748b", fontSize: 10, fontWeight: 800,
                      border: step.completed ? "1px solid rgba(34,197,94,.3)" : "1px solid rgba(148,163,184,.2)",
                    }}>
                      {step.completed ? "✓" : idx + 1}
                    </span>
                    <span style={{ color: step.completed ? "#94a3b8" : "#e2e8f0", fontWeight: step.completed ? 500 : 700 }}>
                      {step.step_name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                    </span>
                    {step.completed && step.completed_at && (
                      <span style={{ color: "#475569", fontSize: 10 }}>{fmtDate(step.completed_at)}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Alkalo phone for VHW/CBC */}
            {needsAlkalo && (
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", display: "block", marginBottom: 4 }}>
                  Alkalo Phone (for SMS confirmation)
                </label>
                <input
                  value={alkaloPhone[rid] || ""}
                  onChange={(e) => setAlkaloPhone((s) => ({ ...s, [rid]: e.target.value }))}
                  placeholder="+220XXXXXXX"
                  style={{
                    width: "100%", padding: "9px 12px", borderRadius: 8,
                    border: "1px solid rgba(255,255,255,.15)", background: "#0d1026",
                    color: "#e2e8f0", fontSize: 13, fontFamily: "inherit", outline: "none",
                  }}
                />
              </div>
            )}

            {/* Admin note */}
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", display: "block", marginBottom: 4 }}>Admin Note</label>
              <textarea
                rows={2}
                placeholder="Review notes…"
                value={note[rid] || ""}
                onChange={(e) => setNote((n) => ({ ...n, [rid]: e.target.value }))}
                style={{
                  width: "100%", padding: "8px 12px", borderRadius: 8,
                  border: "1px solid rgba(255,255,255,.15)", background: "#0d1026",
                  color: "#e2e8f0", fontSize: 13, fontFamily: "inherit", resize: "vertical", outline: "none",
                }}
              />
            </div>

            {/* Skip remaining checkbox */}
            <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, cursor: "pointer" }}>
              <input type="checkbox" checked={skipRemaining[rid] || false}
                onChange={(e) => setSkipRemaining((s) => ({ ...s, [rid]: e.target.checked }))}
                style={{ accentColor: "#f59e0b" }} />
              <span style={{ fontSize: 12, color: "#fbbf24", fontWeight: 600 }}>
                Admin override — skip remaining steps and activate immediately
              </span>
            </label>

            {/* Action buttons */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={() => reviewApp(rid, "approve")}
                disabled={busy === rid}
                style={{
                  padding: "9px 20px", borderRadius: 8, border: "none",
                  background: "linear-gradient(135deg,#22c55e,#16a34a)",
                  color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
                }}>
                {busy === rid ? "Processing…" : needsAlkalo && !skipRemaining[rid] ? "Approve & Send to Alkalo" : "Approve & Activate"}
              </button>
              <button
                onClick={() => reviewApp(rid, "request_info")}
                disabled={busy === rid}
                style={{
                  padding: "9px 16px", borderRadius: 8,
                  border: "1px solid rgba(251,191,36,.3)", background: "rgba(251,191,36,.08)",
                  color: "#fbbf24", fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
                }}>
                Request More Info
              </button>
              <button
                onClick={() => setExpanded(null)}
                style={{
                  padding: "9px 16px", borderRadius: 8,
                  border: "1px solid rgba(255,255,255,.1)", background: "transparent",
                  color: "#94a3b8", fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
                }}>
                Cancel
              </button>
            </div>

            {/* Audit log */}
            {app.audit_log?.length > 0 && (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,.06)" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 6 }}>AUDIT LOG</div>
                {app.audit_log.map((entry, idx) => (
                  <div key={idx} style={{ fontSize: 11, color: "#64748b", lineHeight: 1.6 }}>
                    <span style={{ color: "#475569" }}>{fmtDate(entry.ts)}</span>
                    {" — "}
                    <span style={{ color: "#94a3b8" }}>{entry.detail}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      <div className="cr-table-foot">
        <span>Showing {rows.length} application{rows.length === 1 ? "" : "s"}</span>
      </div>
    </div>
  );
}

function InfoItem({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#475569", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 500 }}>{value}</div>
    </div>
  );
}


// ── Root ──────────────────────────────────────────────

export default function People() {
  const [tab, setTab]         = useState("patients");
  const [filters, setFilters] = useState({
    needsVerify: false, seenThisWeek: false, voiceFirst: false,
    onShift: false, pending: false,
  });
  const [search, setSearch]   = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState(null);

  const { data: pRes } = useAdminApi("/api/v1/admin/patients?limit=100",    { refreshMs: 60000 });
  const { data: cRes } = useAdminApi("/api/v1/admin/caregivers-directory", { refreshMs: 60000 });
  const { data: lRes, refresh: refreshLiteracy } = useAdminApi("/api/v1/literacy/admin/queue?limit=200", { refreshMs: 30000 });
  const { data: tRes, refresh: refreshTransfers } = useAdminApi("/api/v1/admin/transfer-requests",    { refreshMs: 30000 });
  const { data: aRes, refresh: refreshApprovals } = useAdminApi("/api/v1/caregiver-v2/admin/applications", { refreshMs: 30000 });

  const patients   = pRes?.patients   || [];
  const caregivers = cRes?.caregivers || [];
  const litQueue   = lRes?.queue      || [];
  const transfers  = tRes?.requests   || [];
  const cgApps     = aRes?.applications || [];
  const transfersPending = tRes?.pending ?? transfers.filter((t) =>
    (t.status || "").toLowerCase() === "pending").length;
  const approvalsPending = aRes?.status_counts?.pending ?? cgApps.filter((a) =>
    (a.status || "").toLowerCase() === "pending").length;

  // Filter patients
  const filteredPatients = useMemo(() => {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    return patients.filter((p) => {
      if (filters.voiceFirst) {
        const lc = literacyClass(p.literacy || p.literacy_level);
        if (lc !== "facility") return false;
      }
      if (filters.needsVerify) {
        const lvl = (p.literacy || p.literacy_level || "").toLowerCase();
        if (lvl === "literate" || lvl === "verified" || lvl === "high") return false;
      }
      if (filters.seenThisWeek) {
        const last = p.last_visit_at || p.updated_at || p.created_at;
        if (!last || new Date(last) < weekAgo) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        const hay = [p.id, p.name, p.phone, p.email, p.region,
                     (p.conditions || []).join(" ")].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [patients, filters, search]);

  const filteredCaregivers = useMemo(() => {
    return caregivers.filter((c) => {
      if (filters.onShift && !c.on_shift) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = [c.caregiver_id, c.id, c.name, c.specialization, c.region, c.phone]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [caregivers, filters, search]);

  const filteredLiteracy = useMemo(() => {
    return litQueue.filter((r) => {
      if (filters.pending && (r.status || "").toLowerCase() !== "pending") return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = [r.patient_id, r.patient_name, r.declared_level, r.status]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [litQueue, filters, search]);

  const filteredTransfers = useMemo(() => {
    return transfers.filter((tr) => {
      if (filters.pending && (tr.status || "").toLowerCase() !== "pending") return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = [tr.request_id, tr.patient_id, tr.patient_full_name, tr.patient_name,
                     tr.current_caregiver_name, tr.new_caregiver_name]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [transfers, filters, search]);

  const filteredApprovals = useMemo(() => {
    return cgApps.filter((a) => {
      if (filters.pending && (a.status || "").toLowerCase() !== "pending") return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = [a.registration_id, a.full_name, a.phone, a.village, a.role]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [cgApps, filters, search]);

  // Stats
  const stats = useMemo(() => {
    const verifiedCount = patients.filter((p) =>
      literacyClass(p.literacy || p.literacy_level) === "self_care").length;
    const verifiedPct = patients.length
      ? Math.round((verifiedCount / patients.length) * 100) : 0;

    const regionCounts = {};
    for (const p of patients) {
      const k = (p.region || "unknown").toString();
      regionCounts[k] = (regionCounts[k] || 0) + 1;
    }
    const spark = Object.values(regionCounts).slice(0, 12);
    while (spark.length < 6) spark.push(1);

    const onShiftCount = caregivers.filter((c) => c.on_shift).length;

    return { verifiedCount, verifiedPct, spark, onShiftCount };
  }, [patients, caregivers]);

  const counts = {
    patients:   patients.length,
    caregivers: caregivers.length,
    approvals:  approvalsPending,
    literacy:   litQueue.filter((r) => (r.status || "pending").toLowerCase() === "pending").length,
    transfers:  transfersPending,
  };

  const dateStr = new Date().toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric",
  });

  return (
    <div className="cr-workspace">
      {/* Page head */}
      <div className="cr-head">
        <div className="cr-head-left">
          <h1 className="cr-title">People <em>&amp; care team</em></h1>
          <p className="cr-sub">Patients · CHWs &amp; caregivers · literacy verification · transfers</p>
        </div>
        <div className="cr-head-actions">
          <div className="cr-date-chip">
            <Calendar size={12} />
            <span>{dateStr}</span>
          </div>
          <Button variant="secondary" size="md" leadIcon={ArrowLeftRight}>
            Transfer
          </Button>
          <Button variant="primary" size="md" leadIcon={UserPlus}>
            Add person
          </Button>
        </div>
      </div>

      {/* Stat strip */}
      <div className="cr-stats">
        <StatCard
          label="Patients registered"
          icon={Users}
          value={patients.length}
          delta={patients.length > 0 ? "live directory" : "no records yet"}
          up={patients.length > 0}
          accent="rgba(129, 140, 248, 0.85)"
          spark={stats.spark}
        />
        <StatCard
          label="CHWs & caregivers"
          icon={UserCheck}
          value={caregivers.length}
          delta={`${stats.onShiftCount} on shift`}
          up={caregivers.length > 0}
          accent="rgba(34, 211, 238, 0.85)"
          spark={stats.spark}
        />
        <StatCard
          label="Literacy verified"
          icon={ShieldCheck}
          value={`${stats.verifiedPct}%`}
          delta={`${stats.verifiedCount} of ${patients.length} patients`}
          up={stats.verifiedPct >= 50}
          accent="rgba(52, 211, 153, 0.85)"
          spark={stats.spark}
        />
        <StatCard
          label="Transfers pending"
          icon={ArrowLeftRight}
          value={transfersPending}
          delta={transfersPending > 0 ? "awaiting review" : "all clear"}
          up={transfersPending === 0}
          accent="rgba(251, 191, 36, 0.85)"
          spark={stats.spark}
        />
      </div>

      {/* Section tabs */}
      <SectionTabs value={tab} onChange={setTab} counts={counts} />

      {/* Toolbar */}
      <Toolbar tab={tab} filters={filters} setFilters={setFilters}
               search={search} setSearch={setSearch} />

      {/* Body */}
      {tab === "patients"   && <PatientsTable   rows={filteredPatients}   onRowClick={setSelectedPatientId} />}
      {tab === "caregivers" && <CaregiversTable rows={filteredCaregivers} />}
      {tab === "approvals"  && <ApprovalsTable  rows={filteredApprovals}  onRefresh={refreshApprovals} />}
      {tab === "literacy"   && <LiteracyTable   rows={filteredLiteracy}   onRowClick={setSelectedPatientId} onRefresh={refreshLiteracy} />}
      {tab === "transfers"  && <TransfersTable  rows={filteredTransfers}  onRowClick={setSelectedPatientId} caregivers={caregivers} onRefresh={refreshTransfers} />}

      {/* Patient 360 drill-in */}
      <PatientDetailSheet
        patientId={selectedPatientId}
        onClose={() => setSelectedPatientId(null)}
      />
    </div>
  );
}
