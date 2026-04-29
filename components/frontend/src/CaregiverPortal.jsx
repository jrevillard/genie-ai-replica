/**
 * AMINA Caregiver Portal — redesigned 2026-04
 * Modern sidebar layout · dark nav · card-based content
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { toNko } from "./utils/nkoTransliterate";
import { setLanguage as i18nSetLanguage } from "./i18n/index.js";

const API = window.AMINA_API || "http://localhost:8000";

// ── Design tokens ──────────────────────────────────────────────────────────────
const C = {
  sidebar:      "#0f172a",
  sidebarHover: "rgba(255,255,255,.06)",
  sidebarActive:"rgba(16,185,129,.18)",
  accent:       "#10b981",
  accentDark:   "#059669",
  bg:           "#f1f5f9",
  card:         "#ffffff",
  border:       "#e2e8f0",
  text:         "#0f172a",
  muted:        "#64748b",
  subtle:       "#94a3b8",
  danger:       "#ef4444",
  warning:      "#f59e0b",
  info:         "#6366f1",
};

const TRIAGE_META = {
  // WHO consultation-level triage values (stored in DB)
  EMERGENCY:  { color: "#ef4444", bg: "#fef2f2", label: "Emergency"  },
  FACILITY:   { color: "#f97316", bg: "#fff7ed", label: "Facility"   },
  CHW_VISIT:  { color: "#f59e0b", bg: "#fffbeb", label: "CHW Visit"  },
  SELF_CARE:  { color: "#10b981", bg: "#f0fdf4", label: "Stable"     },
  // Legacy / BP-derived values
  ELEVATED:   { color: "#f59e0b", bg: "#fffbeb", label: "Elevated"   },
  MONITOR:    { color: "#6366f1", bg: "#eef2ff", label: "Monitor"    },
  STABLE:     { color: "#10b981", bg: "#f0fdf4", label: "Stable"     },
};

// Priority ranking for patient sorting (higher = more urgent)
const TRIAGE_PRIORITY = { EMERGENCY: 4, FACILITY: 3, CHW_VISIT: 2, ELEVATED: 2, SELF_CARE: 1, MONITOR: 1, STABLE: 0 };

const SEV_META = {
  info:      { color: "#6366f1", bg: "#eef2ff", label: "Info",      icon: "ℹ" },
  warning:   { color: "#f59e0b", bg: "#fffbeb", label: "Warning",   icon: "⚠" },
  emergency: { color: "#ef4444", bg: "#fef2f2", label: "Emergency", icon: "🚨" },
};

// ── Caregiver UI strings (English baseline — batch-translated to Mandinka) ────
const CG_UI_STRINGS_EN = {
  ask_amina: "Ask AMINA",
  type_msg: "Ask about your patient…",
  send: "Send",
  thinking: "AMINA is thinking…",
  no_patient: "Select a patient first",
  patients: "Patients",
  summary: "Summary",
  vitals: "Vitals",
  alerts: "Alerts",
  insights: "Insights",
  chat: "Chat",
  dashboard: "Dashboard",
  search_patients: "Search patients…",
  logout: "Log out",
  new_chat: "New chat",
  history: "Chat History",
  compact: "Compact",
  translate: "Translate",
  english: "English",
  mandinka: "Mandinka",
  copy: "Copy",
  copied: "Copied",
  voice: "Voice",
  stop: "Stop",
  listening: "Listening…",
  processing_voice: "Processing voice…",
  connection_error: "Connection error. Please try again.",
  use_as_alert: "Use as patient alert",
  model: "Model",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

function timeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function Avatar({ name, photo, size = 36, fontSize }) {
  const fs = fontSize || Math.round(size * 0.38);
  if (photo) return (
    <img src={photo} alt={name}
      style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
  );
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: "linear-gradient(135deg,#10b981,#059669)",
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "#fff", fontWeight: 700, fontSize: fs, userSelect: "none",
    }}>
      {(name || "?")[0].toUpperCase()}
    </div>
  );
}

function Badge({ text, color, bg }) {
  return (
    <span style={{
      background: bg || `${color}18`, color: color,
      borderRadius: 6, padding: "2px 9px",
      fontSize: 11, fontWeight: 700, letterSpacing: ".4px", textTransform: "uppercase",
    }}>
      {text}
    </span>
  );
}

function TriageBadge({ status }) {
  const m = TRIAGE_META[status] || { color: C.muted, bg: "#f1f5f9", label: status || "Unknown" };
  return <Badge text={m.label} color={m.color} bg={m.bg} />;
}

function SevBadge({ severity }) {
  const m = SEV_META[severity] || { color: C.muted, bg: "#f1f5f9", label: severity };
  return <Badge text={m.label} color={m.color} bg={m.bg} />;
}

// ── Clinical Briefing Card ─────────────────────────────────────────────────────

function parseBriefing(text) {
  // Strip leading/trailing --- separators
  const cleaned = text.replace(/^---+\s*/m, "").replace(/\s*---+\s*$/m, "").trim();

  const SECTION_KEYS = [
    "Current Status",
    "Key Concerns",
    "Medication Status",
    "Symptom Trends",
    "Behavioural & Lifestyle Signals",
    "Recommended Actions",
  ];

  const result = { title: "", sections: [] };

  // Extract title (first **bold** line)
  const titleMatch = cleaned.match(/\*\*Clinical Briefing[^*]*\*\*/);
  result.title = titleMatch ? titleMatch[0].replace(/\*\*/g, "").trim() : "Clinical Briefing";

  // Split into sections by **Header**
  const parts = cleaned.split(/\*\*([^*]+)\*\*/g);
  let i = 1;
  while (i < parts.length) {
    const heading = parts[i].trim();
    const body = (parts[i + 1] || "").trim();
    if (SECTION_KEYS.includes(heading)) {
      result.sections.push({ heading, body });
    }
    i += 2;
  }

  return result;
}

function parseBullets(text) {
  return text
    .split("\n")
    .map(l => l.replace(/^[-•*]\s*/, "").replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean);
}

function downloadBriefingPDF(text, patientName) {
  const { title, sections } = parseBriefing(text);
  const now = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });

  const sectionHtml = sections.map(({ heading, body }) => {
    const items = parseBullets(body);
    const isNumbered = heading === "Recommended Actions";
    const listTag = isNumbered ? "ol" : "ul";
    const listItems = items.map(it => `<li>${it}</li>`).join("");
    return `
      <div class="section">
        <div class="section-heading">${heading}</div>
        ${items.length > 1
          ? `<${listTag} class="item-list">${listItems}</${listTag}>`
          : `<p class="body-text">${body.replace(/\n/g, "<br>")}</p>`
        }
      </div>`;
  }).join("");

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>${title}</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 32px 40px; color: #0f172a; font-size: 13px; }
  .header { background: linear-gradient(135deg,#0f172a,#1e293b); color:#fff; border-radius:10px; padding:24px 28px; margin-bottom:24px; display:flex; justify-content:space-between; align-items:flex-start; }
  .header-title { font-size:20px; font-weight:800; letter-spacing:-.3px; margin-bottom:4px; }
  .header-sub { font-size:12px; opacity:.7; }
  .header-date { font-size:11px; opacity:.6; text-align:right; }
  .badge { display:inline-block; background:#10b981; color:#fff; border-radius:20px; padding:3px 12px; font-size:11px; font-weight:700; letter-spacing:.5px; margin-top:6px; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px; }
  .section { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:16px 20px; break-inside:avoid; }
  .section-full { grid-column:1/-1; }
  .section-heading { font-size:11px; font-weight:800; color:#10b981; letter-spacing:.8px; text-transform:uppercase; margin-bottom:10px; padding-bottom:6px; border-bottom:2px solid #e2e8f0; }
  .body-text { margin:0; line-height:1.7; color:#334155; }
  .item-list { margin:0; padding-left:18px; color:#334155; }
  .item-list li { margin-bottom:6px; line-height:1.6; }
  ol.item-list li { font-weight:500; }
  .footer { margin-top:28px; padding-top:14px; border-top:1px solid #e2e8f0; font-size:11px; color:#94a3b8; text-align:center; }
  @media print { body { padding:20px 24px; } }
</style>
</head>
<body>
<div class="header">
  <div>
    <div class="header-title">${title}</div>
    <div class="header-sub">AMINA AI · Caregiver Clinical Briefing</div>
    <div class="badge">CONFIDENTIAL</div>
  </div>
  <div class="header-date">Generated<br>${now}</div>
</div>
<div class="grid">
  ${sections.map(({ heading, body }, idx) => {
    const items = parseBullets(body);
    const isNumbered = heading === "Recommended Actions";
    const full = ["Current Status", "Recommended Actions"].includes(heading) ? ' section-full' : '';
    const listTag = isNumbered ? "ol" : "ul";
    const listItems = items.map(it => `<li>${it}</li>`).join("");
    return `<div class="section${full}">
      <div class="section-heading">${heading}</div>
      ${items.length > 1
        ? `<${listTag} class="item-list">${listItems}</${listTag}>`
        : `<p class="body-text">${body.replace(/\n/g, "<br>")}</p>`
      }
    </div>`;
  }).join("")}
</div>
<div class="footer">This briefing is generated by AMINA AI and is intended for the assigned caregiver only. Not a substitute for clinical judgment.</div>
</body>
</html>`;

  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 400);
}

const SECTION_ICONS = {
  "Current Status":                "⬤",
  "Key Concerns":                  "⚠",
  "Medication Status":             "💊",
  "Symptom Trends":                "📈",
  "Behavioural & Lifestyle Signals": "🔍",
  "Recommended Actions":           "✅",
};

const SECTION_COLORS = {
  "Current Status":                { accent: "#10b981", bg: "#f0fdf4" },
  "Key Concerns":                  { accent: "#ef4444", bg: "#fef2f2" },
  "Medication Status":             { accent: "#6366f1", bg: "#eef2ff" },
  "Symptom Trends":                { accent: "#f59e0b", bg: "#fffbeb" },
  "Behavioural & Lifestyle Signals": { accent: "#0ea5e9", bg: "#f0f9ff" },
  "Recommended Actions":           { accent: "#059669", bg: "#ecfdf5" },
};

function BriefingSection({ heading, body }) {
  const { accent, bg } = SECTION_COLORS[heading] || { accent: "#64748b", bg: "#f8fafc" };
  const icon = SECTION_ICONS[heading] || "▸";
  const items = parseBullets(body);
  const isNumbered = heading === "Recommended Actions";

  return (
    <div style={{
      background: bg, border: `1px solid ${accent}30`,
      borderLeft: `3px solid ${accent}`,
      borderRadius: 8, padding: "14px 16px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
        <span style={{ fontSize: 13 }}>{icon}</span>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".7px", textTransform: "uppercase", color: accent }}>
          {heading}
        </span>
      </div>
      {items.length > 1 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {items.map((item, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, color: "#1e293b", lineHeight: 1.55 }}>
              <span style={{ color: accent, fontWeight: 700, flexShrink: 0, minWidth: 16 }}>
                {isNumbered ? `${i + 1}.` : "•"}
              </span>
              <span>{item}</span>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 13, color: "#1e293b", lineHeight: 1.65 }}>{body}</p>
      )}
    </div>
  );
}

function ClinicalBriefingCard({ text, patientName }) {
  let parsed;
  try { parsed = parseBriefing(text); } catch { parsed = { title: "Clinical Briefing", sections: [] }; }
  const { title, sections } = parsed;
  const now = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  // Split into 2-col grid: full-width for status + actions, 2-col for rest
  const fullWidth = ["Current Status", "Recommended Actions"];

  return (
    <div style={{
      background: "#fff", borderRadius: 12, overflow: "hidden",
      boxShadow: "0 4px 20px rgba(0,0,0,.10)", width: "100%", maxWidth: 760,
    }}>
      {/* Header */}
      <div style={{
        background: "linear-gradient(135deg,#0f172a,#1e293b)",
        padding: "18px 22px", display: "flex", justifyContent: "space-between", alignItems: "flex-start",
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", letterSpacing: "-.2px" }}>
            {title}
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>
            AMINA AI · Caregiver Clinical Briefing
          </div>
          <div style={{
            display: "inline-block", marginTop: 8,
            background: "#10b981", color: "#fff", borderRadius: 20,
            padding: "2px 10px", fontSize: 10, fontWeight: 700, letterSpacing: ".6px",
          }}>CONFIDENTIAL</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, color: "#64748b" }}>Generated</div>
          <div style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>{now}</div>
          <button
            onClick={() => downloadBriefingPDF(text, patientName)}
            style={{
              marginTop: 8, background: "#10b981", border: "none", color: "#fff",
              borderRadius: 6, padding: "6px 12px", fontSize: 11, fontWeight: 700,
              cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
            }}
          >
            ↓ Download PDF
          </button>
        </div>
      </div>

      {/* Sections */}
      <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
        {sections.length === 0 ? (
          <p style={{ color: "#64748b", fontSize: 13 }}>{text}</p>
        ) : (
          (() => {
            const rows = [];
            let pairBuf = [];
            sections.forEach((sec, idx) => {
              if (fullWidth.includes(sec.heading)) {
                if (pairBuf.length) {
                  rows.push(<div key={`pair-${idx}`} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {pairBuf.map((s, j) => <BriefingSection key={j} {...s} />)}
                  </div>);
                  pairBuf = [];
                }
                rows.push(<BriefingSection key={idx} {...sec} />);
              } else {
                pairBuf.push(sec);
                if (pairBuf.length === 2) {
                  rows.push(<div key={`pair-${idx}`} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {pairBuf.map((s, j) => <BriefingSection key={j} {...s} />)}
                  </div>);
                  pairBuf = [];
                }
              }
            });
            if (pairBuf.length) {
              rows.push(<div key="pair-last" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {pairBuf.map((s, j) => <BriefingSection key={j} {...s} />)}
              </div>);
            }
            return rows;
          })()
        )}
      </div>

      {/* Footer */}
      <div style={{
        borderTop: "1px solid #e2e8f0", padding: "10px 18px",
        fontSize: 10, color: "#94a3b8", textAlign: "center",
      }}>
        For assigned caregiver use only — not a substitute for clinical judgment
      </div>
    </div>
  );
}

// ── Suggestion Card (structured AMINA responses) ──────────────────────────────

function isStructuredResponse(text) {
  if (!text) return false;
  const numberedItems = (text.match(/^\s*\d+\.\s/gm) || []).length;
  const boldHeaders   = (text.match(/\*\*[^*]+\*\*/g) || []).length;
  const bulletLines   = (text.match(/^\s*[-•*]\s/gm) || []).length;
  return numberedItems >= 3 || boldHeaders >= 2 || bulletLines >= 5;
}

const _FORMAT_ACTIONS = ["report", "content_gen"];
const _FORMAT_REQUEST_KW = [
  "generate", "create", "write", "prepare", "draft", "compose",
  "make me a", "give me a", "produce", "build",
];
const _FORMAT_TYPE_KW = [
  "report", "summary", "briefing", "overview", "assessment", "analysis",
  "care plan", "treatment plan", "action plan",
  "speech", "essay", "document", "presentation", "letter",
  "guideline", "handout", "poster", "formatted",
];

function shouldFormatAsCard(action, prevUserMsg) {
  if (_FORMAT_ACTIONS.includes(action)) return true;
  if (!prevUserMsg) return false;
  const lower = prevUserMsg.toLowerCase();
  const hasAction = _FORMAT_REQUEST_KW.some(k => lower.includes(k));
  const hasType = _FORMAT_TYPE_KW.some(k => lower.includes(k));
  return hasAction && hasType;
}

function renderPlainMd(text) {
  if (!text) return text;
  const lines = text.split("\n");
  const elements = [];
  let bulletGroup = [];
  let key = 0;

  const flushBullets = () => {
    if (!bulletGroup.length) return;
    elements.push(
      <ul key={`ul-${key++}`} style={{ margin: "4px 0", paddingLeft: 18, listStyle: "disc" }}>
        {bulletGroup.map((b, j) => (
          <li key={j} style={{ marginBottom: 2 }}>{renderMdInline(b)}</li>
        ))}
      </ul>
    );
    bulletGroup = [];
  };

  for (const line of lines) {
    const bm = line.match(/^\s*[-•*]\s+(.*)/);
    const nm = line.match(/^\s*(\d+)[\.\)]\s+(.*)/);
    if (bm) {
      bulletGroup.push(bm[1]);
    } else {
      flushBullets();
      if (nm) {
        elements.push(
          <div key={`n-${key++}`} style={{ display: "flex", gap: 6, marginBottom: 2 }}>
            <span style={{ fontWeight: 600, color: "#0d9488", flexShrink: 0 }}>{nm[1]}.</span>
            <span>{renderMdInline(nm[2])}</span>
          </div>
        );
      } else if (line.trim()) {
        elements.push(<div key={`p-${key++}`} style={{ marginBottom: 2 }}>{renderMdInline(line)}</div>);
      } else {
        elements.push(<div key={`br-${key++}`} style={{ height: 6 }} />);
      }
    }
  }
  flushBullets();
  return elements;
}

function stripMd(s) {
  if (!s) return "";
  return s.replace(/\*\*([^*]*)\*\*/g, "$1").replace(/\*([^*]*)\*/g, "$1").trim();
}

function renderMdInline(s) {
  if (!s) return null;
  const parts = [];
  let key = 0;
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) parts.push(<span key={key++}>{s.slice(last, m.index)}</span>);
    if (m[1]) parts.push(<strong key={key++}>{m[1]}</strong>);
    else if (m[2]) parts.push(<em key={key++}>{m[2]}</em>);
    last = re.lastIndex;
  }
  if (last < s.length) parts.push(<span key={key++}>{s.slice(last)}</span>);
  return parts.length ? parts : s;
}

function parseSuggestion(text) {
  if (!text) return { intro: "", items: [] };
  try {
    const lines = text.split("\n");
    let intro = "";
    const sections = [];
    let currentSection = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed) {
        if (currentSection) currentSection.bodyLines.push("");
        continue;
      }

      const numberedMatch = trimmed.match(/^(\d+)[\.\)]\s+(.*)/);

      if (numberedMatch) {
        const num = numberedMatch[1];
        let rest = numberedMatch[2].trim();

        let heading = "";
        let bodyStart = rest;

        const boldMatch = rest.match(/^\*\*([^*]+)\*\*[:\s\-]*(.*)/);
        if (boldMatch) {
          heading = boldMatch[1].replace(/[:\s]+$/, "").trim();
          bodyStart = boldMatch[2].trim();
        }

        currentSection = { num, heading, bodyLines: [] };
        if (bodyStart) currentSection.bodyLines.push(bodyStart);
        sections.push(currentSection);
        continue;
      }

      const boldHeaderMatch = trimmed.match(/^\*\*([^*]+)\*\*[:\s\-]*(.*)/);
      if (boldHeaderMatch && !currentSection) {
        const heading = boldHeaderMatch[1].replace(/[:\s]+$/, "").trim();
        const bodyStart = boldHeaderMatch[2].trim();
        currentSection = { num: String(sections.length + 1), heading, bodyLines: [] };
        if (bodyStart) currentSection.bodyLines.push(bodyStart);
        sections.push(currentSection);
        continue;
      }

      if (currentSection) {
        currentSection.bodyLines.push(trimmed);
      } else {
        if (!intro && trimmed.length > 10) {
          intro = stripMd(trimmed);
        } else if (intro && trimmed.length > 5) {
          currentSection = { num: "1", heading: "", bodyLines: [trimmed] };
          sections.push(currentSection);
        }
      }
    }

    const items = sections.map((s, idx) => ({
      num: s.num || String(idx + 1),
      heading: stripMd(s.heading || ""),
      body: s.bodyLines
        .map(l => stripMd(l))
        .join("\n")
        .replace(/^\n+|\n+$/g, "")
        .trim(),
    })).filter(s => s.heading || s.body);

    if (items.length === 0) {
      const nonEmpty = text.split("\n").map(l => stripMd(l.trim())).filter(Boolean);
      nonEmpty.forEach((l, i) => items.push({ num: String(i + 1), heading: "", body: l }));
    }

    return { intro, items };
  } catch {
    return { intro: "", items: [{ num: "1", heading: "", body: stripMd(text) }] };
  }
}

function downloadSuggestionPDF(text, patientName, topic) {
  const { intro, items } = parseSuggestion(text);
  const now = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
  const title = topic || `AMINA Recommendations${patientName ? ` — ${patientName}` : ""}`;

  const escHtml = (s) => (s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  const bodyToHtml = (body) => {
    if (!body) return "";
    const lines = body.split("\n");
    const parts = [];
    let inUl = false;
    for (const line of lines) {
      const bm = line.match(/^\s*[-•*]\s+(.*)/);
      if (bm) {
        if (!inUl) { parts.push("<ul>"); inUl = true; }
        parts.push(`<li>${escHtml(bm[1])}</li>`);
      } else {
        if (inUl) { parts.push("</ul>"); inUl = false; }
        if (line.trim()) parts.push(`<p>${escHtml(line)}</p>`);
      }
    }
    if (inUl) parts.push("</ul>");
    return parts.join("");
  };

  const itemsHtml = items.map(({ num, heading, body }) => `
    <div class="item">
      <div class="item-num">${escHtml(num)}</div>
      <div class="item-body">
        ${heading ? `<div class="item-head">${escHtml(heading)}</div>` : ""}
        <div class="item-text">${bodyToHtml(body)}</div>
      </div>
    </div>`).join("");

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>${title}</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 32px 40px; color: #0f172a; font-size: 13px; }
  .header { background: linear-gradient(135deg,#0d9488,#0f766e); color:#fff; border-radius:10px; padding:22px 28px; margin-bottom:22px; display:flex; justify-content:space-between; align-items:flex-start; }
  .header-title { font-size:18px; font-weight:800; letter-spacing:-.3px; margin-bottom:4px; }
  .header-sub { font-size:11px; opacity:.75; }
  .header-date { font-size:11px; opacity:.65; text-align:right; }
  .intro { background:#f0fdfa; border-left:3px solid #0d9488; border-radius:0 6px 6px 0; padding:10px 16px; margin-bottom:18px; font-size:13px; color:#134e4a; line-height:1.6; }
  .item { display:flex; gap:14px; align-items:flex-start; margin-bottom:14px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:14px 18px; break-inside:avoid; }
  .item-num { background:#0d9488; color:#fff; border-radius:50%; width:26px; height:26px; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:800; flex-shrink:0; }
  .item-head { font-size:13px; font-weight:700; color:#0f172a; margin-bottom:4px; }
  .item-text { font-size:13px; color:#334155; line-height:1.65; }
  .footer { margin-top:24px; padding-top:12px; border-top:1px solid #e2e8f0; font-size:11px; color:#94a3b8; text-align:center; }
  @media print { body { padding:20px 24px; } }
</style>
</head>
<body>
<div class="header">
  <div>
    <div class="header-title">${title}</div>
    <div class="header-sub">AMINA AI · Caregiver Recommendations</div>
  </div>
  <div class="header-date">Generated<br>${now}</div>
</div>
${intro ? `<div class="intro">${intro}</div>` : ""}
${itemsHtml}
<div class="footer">Generated by AMINA AI for caregiver reference. Not a substitute for clinical judgment.</div>
</body>
</html>`;

  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 400);
}

function renderBodyContent(body) {
  if (!body) return null;
  const lines = body.split("\n");
  const elements = [];
  let bulletGroup = [];

  const flushBullets = () => {
    if (bulletGroup.length === 0) return;
    elements.push(
      <ul key={`bl-${elements.length}`} style={{ margin: "6px 0 4px 0", paddingLeft: 18, listStyle: "disc" }}>
        {bulletGroup.map((b, j) => (
          <li key={j} style={{ fontSize: 13, color: "#334155", lineHeight: 1.65, marginBottom: 2 }}>
            {renderMdInline(b)}
          </li>
        ))}
      </ul>
    );
    bulletGroup = [];
  };

  for (const line of lines) {
    const bulletMatch = line.match(/^\s*[-•*]\s+(.*)/);
    if (bulletMatch) {
      bulletGroup.push(bulletMatch[1]);
    } else {
      flushBullets();
      if (line.trim()) {
        elements.push(
          <div key={`ln-${elements.length}`} style={{ marginBottom: 3 }}>
            {renderMdInline(line)}
          </div>
        );
      }
    }
  }
  flushBullets();
  return elements;
}

// ── CgAminaBubble — wraps plain AMINA text with typewriter animation ────────
function CgAminaBubble({ text, isSystem, hasMarkdown, isNew, lang, nkoMode, sourceLang: msgSourceLang }) {
  const [typed, setTyped] = useState(false);
  const [translated, setTranslated] = useState(null);
  const [showTranslated, setShowTranslated] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [copied, setCopied] = useState(false);
  const shouldAnimate = isNew && !typed && !isSystem;

  const sourceLang = msgSourceLang || "en";
  const otherLang = sourceLang === "en" ? "ma" : "en";
  const otherLabel = otherLang === "ma" ? "Mandinka" : "English";

  async function toggleTranslate() {
    if (translated !== null) { setShowTranslated(v => !v); return; }
    setTranslating(true);
    try {
      const r = await fetch(`${API}/api/v1/agent/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, source: sourceLang, target: otherLang }),
      });
      if (r.ok) {
        const d = await r.json();
        if (d.translated) { setTranslated(d.translated); setShowTranslated(true); }
      }
    } catch {}
    setTranslating(false);
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(displayText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  const _rawDisplay = showTranslated && translated ? translated : text;
  const currentlyMandinka = sourceLang === "ma" ? !showTranslated : showTranslated;
  const useNko = nkoMode && currentlyMandinka && !isSystem;
  const displayText = useNko ? toNko(_rawDisplay) : _rawDisplay;
  const displayDir = useNko ? "rtl" : "ltr";

  return (
    <div>
      <div dir={displayDir} style={{
        maxWidth: "75%", padding: "11px 15px", borderRadius: 12, fontSize: 14, lineHeight: 1.6,
        background: isSystem ? "#f1f5f9" : "#fff",
        color: isSystem ? C.muted : C.text,
        borderBottomLeftRadius: 3,
        boxShadow: isSystem ? "none" : "0 1px 3px rgba(0,0,0,.08)",
        fontStyle: isSystem ? "italic" : "normal",
        whiteSpace: "pre-wrap",
        ...(useNko ? { fontFamily: "Noto Sans NKo, serif", textAlign: "right" } : {}),
      }}>
        {shouldAnimate
          ? <CgTypeWriter text={displayText} speed={18} onDone={() => setTyped(true)} />
          : hasMarkdown && !showTranslated ? renderPlainMd(displayText) : displayText}
      </div>
      {!isSystem && (
        <div style={{ display: "flex", gap: 2, marginTop: 4 }}>
          <button onClick={toggleTranslate} disabled={translating}
            style={{
              background: showTranslated ? "rgba(16,185,129,.12)" : "none",
              border: `1px solid ${showTranslated ? C.accent : C.border}`,
              borderRadius: 5, padding: "2px 8px", fontSize: 11, cursor: "pointer",
              color: showTranslated ? C.accent : C.muted, fontWeight: 500,
              display: "flex", alignItems: "center", gap: 4, transition: "all .2s",
            }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 8l6 6"/><path d="M4 14l6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="M22 22l-5-10-5 10"/><path d="M14 18h6"/></svg>
            {translating ? "…" : showTranslated ? (sourceLang === "en" ? "English" : "Mandinka") : otherLabel}
          </button>
          <button onClick={handleCopy}
            style={{
              background: "none", border: `1px solid ${C.border}`, borderRadius: 5,
              padding: "2px 8px", fontSize: 11, cursor: "pointer", color: C.muted,
              fontWeight: 500, display: "flex", alignItems: "center", gap: 4,
            }}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── TypeWriter — character-by-character reveal with blinking cursor ──────────
function CgTypeWriter({ text, speed = 18, onDone }) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  const idx = useRef(0);
  const raf = useRef(null);
  const last = useRef(0);

  useEffect(() => {
    idx.current = 0;
    setDisplayed("");
    setDone(false);
    last.current = performance.now();

    const step = (now) => {
      const elapsed = now - last.current;
      if (elapsed >= speed) {
        const chars = Math.min(Math.floor(elapsed / speed), 3);
        const next = Math.min(idx.current + chars, text.length);
        idx.current = next;
        setDisplayed(text.slice(0, next));
        last.current = now;
        if (next >= text.length) { setDone(true); onDone?.(); return; }
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [text]);

  return <>{displayed}{!done && <span style={{ animation: "cg-blink .8s infinite", color: C.accent, marginLeft: 2 }}>|</span>}</>;
}

// ── Typing dots — shown while AMINA is thinking ─────────────────────────────
function CgTypingDots() {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 14, animation: "cg-msgUp .3s ease both" }}>
      <div style={{
        width: 28, height: 28, borderRadius: "50%", background: `linear-gradient(135deg, ${C.accent}, ${C.accentDark})`,
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#fff",
        fontWeight: 700, marginRight: 8, flexShrink: 0,
      }}>A</div>
      <div style={{
        padding: "11px 15px", borderRadius: 12, borderBottomLeftRadius: 3, background: "#fff",
        boxShadow: "0 1px 3px rgba(0,0,0,.08)", display: "flex", gap: 5, alignItems: "center",
      }}>
        {[0, 0.2, 0.4].map((d, i) => (
          <div key={i} style={{
            width: 7, height: 7, borderRadius: "50%", background: C.accent,
            animation: `cg-bounce 1.2s infinite`, animationDelay: `${d}s`,
          }} />
        ))}
      </div>
    </div>
  );
}

function SuggestionCard({ text, patientName }) {
  try {
    const { intro, items } = parseSuggestion(text);
    const now = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

    const topic = intro
      ? intro.replace(/^(here are|certainly[!,]|sure[!,])\s*/i, "").replace(/for\s+\w+\s*/i, "").trim()
      : "";

    return (
      <div style={{
        background: "#fff", borderRadius: 12, overflow: "hidden",
        boxShadow: "0 4px 20px rgba(0,0,0,.09)", width: "100%", maxWidth: 720,
      }}>
        {/* Header */}
        <div style={{
          background: "linear-gradient(135deg,#0d9488,#0f766e)",
          padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "flex-start",
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#fff", letterSpacing: "-.2px" }}>
              AMINA Recommendations{patientName ? ` — ${patientName}` : ""}
            </div>
            {topic && (
              <div style={{ fontSize: 11, color: "#99f6e4", marginTop: 3, maxWidth: 380 }}>
                {topic.charAt(0).toUpperCase() + topic.slice(1)}
              </div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <div style={{ fontSize: 10, color: "#99f6e4" }}>{now}</div>
            <button
              onClick={() => downloadSuggestionPDF(text, patientName, `AMINA Recommendations — ${patientName || "Patient"}`)}
              style={{
                background: "rgba(255,255,255,.18)", border: "1px solid rgba(255,255,255,.35)",
                color: "#fff", borderRadius: 6, padding: "5px 11px",
                fontSize: 11, fontWeight: 700, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 5,
              }}
            >
              ↓ Download PDF
            </button>
          </div>
        </div>

        {/* Intro */}
        {intro && (
          <div style={{
            background: "#f0fdfa", borderBottom: "1px solid #ccfbf1",
            padding: "10px 18px", fontSize: 13, color: "#134e4a", lineHeight: 1.6,
          }}>
            {intro}
          </div>
        )}

        {/* Items */}
        <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map(({ num, heading, body }, i) => (
            <div key={i} style={{
              display: "flex", gap: 13, alignItems: "flex-start",
              background: "#f8fafc", border: "1px solid #e2e8f0",
              borderLeft: "3px solid #0d9488", borderRadius: 8, padding: "12px 14px",
            }}>
              <div style={{
                background: "#0d9488", color: "#fff", borderRadius: "50%",
                width: 26, height: 26, display: "flex", alignItems: "center",
                justifyContent: "center", fontSize: 12, fontWeight: 800, flexShrink: 0,
              }}>
                {num}
              </div>
              <div style={{ flex: 1 }}>
                {heading && (
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 3 }}>
                    {heading}
                  </div>
                )}
                <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.65 }}>
                  {renderBodyContent(body)}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          borderTop: "1px solid #e2e8f0", padding: "8px 18px",
          fontSize: 10, color: "#94a3b8", textAlign: "center",
        }}>
          AMINA AI — for caregiver reference only
        </div>
      </div>
    );
  } catch {
    return (
      <div style={{
        maxWidth: "75%", padding: "11px 15px", borderRadius: 12, fontSize: 14,
        lineHeight: 1.6, background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.08)",
        borderBottomLeftRadius: 3, whiteSpace: "pre-wrap",
      }}>
        {text}
      </div>
    );
  }
}

// ── Content Generation Form (inline chat form) ─────────────────────────────────

function ContentGenForm({ form, onSubmit }) {
  const [selectedFormat, setSelectedFormat] = useState(form.detected_format || "speech");
  const [selectedScope, setSelectedScope] = useState(form.detected_scope || "general");
  const [selectedTopics, setSelectedTopics] = useState(
    form.detected_topic ? [form.detected_topic] : []
  );
  const [selectedLength, setSelectedLength] = useState("standard");
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const toggleTopic = (t) => {
    setSelectedTopics(prev =>
      prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]
    );
  };

  const handleSubmit = () => {
    setSubmitted(true);
    onSubmit({
      format: selectedFormat,
      scope: selectedScope,
      topics: selectedTopics,
      length: selectedLength,
      notes,
    });
  };

  if (submitted) {
    return (
      <div style={{
        background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12,
        padding: "16px 20px", width: "100%", maxWidth: 720,
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <span style={{ fontSize: 18 }}>&#9989;</span>
        <span style={{ fontSize: 13, color: "#065f46", fontWeight: 600 }}>
          Generating your content... Please wait.
        </span>
      </div>
    );
  }

  const radioStyle = (active) => ({
    padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
    cursor: "pointer", border: `1.5px solid ${active ? C.accent : C.border}`,
    background: active ? "#ecfdf5" : "#fff", color: active ? "#065f46" : C.text,
    transition: "all .15s",
  });

  const chipStyle = (active) => ({
    padding: "5px 12px", borderRadius: 20, fontSize: 11, fontWeight: 600,
    cursor: "pointer", border: `1.5px solid ${active ? "#0d9488" : C.border}`,
    background: active ? "#f0fdfa" : "#fff", color: active ? "#0f766e" : C.muted,
    transition: "all .15s", userSelect: "none",
  });

  return (
    <div style={{
      background: "#fff", borderRadius: 12, overflow: "hidden",
      boxShadow: "0 4px 20px rgba(0,0,0,.09)", width: "100%", maxWidth: 720,
    }}>
      {/* Header */}
      <div style={{
        background: "linear-gradient(135deg,#6366f1,#4f46e5)",
        padding: "14px 20px", display: "flex", alignItems: "center", gap: 10,
      }}>
        <span style={{ fontSize: 18 }}>&#9997;&#65039;</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#fff" }}>Content Generator</div>
          <div style={{ fontSize: 11, color: "#c7d2fe" }}>
            Fill in the details below and AMINA will generate professional content for you
          </div>
        </div>
      </div>

      <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 18 }}>
        {/* Format */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 8 }}>
            Content Format
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {(form.format_options || []).map(f => {
              const key = typeof f === "string" ? f : f.key;
              const label = typeof f === "string" ? f : f.label;
              return (
                <div key={key} onClick={() => setSelectedFormat(key)} style={radioStyle(selectedFormat === key)}>
                  {label}
                </div>
              );
            })}
          </div>
        </div>

        {/* Scope */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 8 }}>
            Scope
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {(form.scope_options || []).map(s => {
              const key = typeof s === "string" ? s : s.key;
              const label = typeof s === "string" ? s : s.label;
              const displayLabel = key === "patient_specific"
                ? `For ${form.patient_name || "this patient"}`
                : label;
              return (
                <div key={key} onClick={() => setSelectedScope(key)} style={radioStyle(selectedScope === key)}>
                  {displayLabel}
                </div>
              );
            })}
          </div>
        </div>

        {/* NCD Topics */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 4 }}>
            Health Topics <span style={{ fontWeight: 400, color: C.muted }}>(select one or more)</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            {(form.ncd_topics || []).map(t => {
              const label = typeof t === "string" ? t : t;
              return (
                <div key={label} onClick={() => toggleTopic(label)} style={chipStyle(selectedTopics.includes(label))}>
                  {selectedTopics.includes(label) ? "\u2713 " : ""}{label}
                </div>
              );
            })}
          </div>
        </div>

        {/* Length */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 8 }}>
            Length
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {(form.length_options || []).map(l => {
              const key = typeof l === "string" ? l : l.key;
              const label = typeof l === "string" ? l : l.label;
              return (
                <div key={key} onClick={() => setSelectedLength(key)}
                  style={{
                    ...radioStyle(selectedLength === key),
                    padding: "10px 16px",
                  }}>
                  {label}
                </div>
              );
            })}
          </div>
        </div>

        {/* Notes */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6 }}>
            Special Requirements <span style={{ fontWeight: 400, color: C.muted }}>(optional)</span>
          </div>
          <textarea
            value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="E.g. use simple language, include local context, focus on prevention..."
            rows={3}
            style={{
              width: "100%", borderRadius: 8, border: `1px solid ${C.border}`,
              padding: "10px 14px", fontSize: 13, resize: "vertical",
              outline: "none", fontFamily: "inherit",
            }}
          />
        </div>

        {/* Submit */}
        <button onClick={handleSubmit} style={{
          background: "linear-gradient(135deg,#6366f1,#4f46e5)",
          color: "#fff", border: "none", borderRadius: 10,
          padding: "12px 24px", fontSize: 14, fontWeight: 700,
          cursor: "pointer", alignSelf: "flex-end",
          boxShadow: "0 2px 8px rgba(99,102,241,.3)",
        }}>
          Generate Content
        </button>
      </div>
    </div>
  );
}

// ── Patient Removal — pre-made reasons ────────────────────────────────────────

const REMOVAL_REASONS = [
  { code: 0, label: "Patient has recovered and no longer requires caregiver support" },
  { code: 1, label: "Patient relocated outside the caregiver's service area" },
  { code: 2, label: "Patient or family requested removal from the care programme" },
  { code: 3, label: "Duplicate registration — patient is already registered under another caregiver" },
  { code: 4, label: "Patient is deceased (attach certified death certificate)" },
  { code: 5, label: "Caregiver capacity limit reached — patient being transferred to another caregiver" },
  { code: 6, label: "Patient consistently non-compliant and declined further engagement (3+ documented attempts)" },
  { code: 7, label: "Other (see additional notes below)" },
];

// ── PDF generator ─────────────────────────────────────────────────────────────

function generateRemovalPDF(form, caregiverInfo) {
  const {
    ref_num, submitted_at, reason_text, custom_note, additional_notes,
    caregiver_name, caregiver_title, caregiver_phone, caregiver_id,
    patient_name, patient_age, patient_gender, patient_region, patient_id,
  } = form;

  const dateStr = new Date(submitted_at).toLocaleDateString("en-GB", {
    day: "2-digit", month: "long", year: "numeric",
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Patient Removal Authorisation — ${ref_num}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: "Times New Roman", Times, serif; font-size: 11pt; color: #111; background: #fff; }
  @page { size: A4; margin: 22mm 20mm 25mm 20mm; }
  @media print { body { margin: 0; } }

  /* Header */
  .header { display: flex; align-items: flex-start; justify-content: space-between; border-bottom: 3px solid #0f172a; padding-bottom: 12px; margin-bottom: 18px; }
  .logo-block { display: flex; flex-direction: column; }
  .logo-name { font-size: 22pt; font-weight: 900; letter-spacing: -1px; color: #0f172a; }
  .logo-sub  { font-size: 8pt; color: #475569; margin-top: 2px; letter-spacing: 1.5px; text-transform: uppercase; }
  .ref-block { text-align: right; }
  .ref-label { font-size: 7.5pt; color: #64748b; text-transform: uppercase; letter-spacing: 1px; }
  .ref-num   { font-size: 13pt; font-weight: 700; color: #0f172a; font-family: monospace; }

  /* Title */
  .doc-title { text-align: center; margin: 0 0 18px; }
  .doc-title h1 { font-size: 15pt; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: 1px; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; padding: 8px 0; }
  .doc-title .sub { font-size: 8.5pt; color: #64748b; margin-top: 5px; }

  /* Sections */
  .section { margin-bottom: 16px; }
  .section-title { font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #0f172a; background: #f1f5f9; padding: 5px 10px; border-left: 4px solid #0f172a; margin-bottom: 8px; }

  /* Info table */
  table.info { width: 100%; border-collapse: collapse; }
  table.info td { padding: 5px 8px; border: 1px solid #cbd5e1; font-size: 10pt; vertical-align: top; }
  table.info td.label { width: 35%; background: #f8fafc; font-weight: 600; color: #374151; }

  /* Reason box */
  .reason-box { border: 1.5px solid #0f172a; border-radius: 4px; padding: 10px 14px; background: #f8fafc; margin-bottom: 8px; }
  .reason-box .check { font-size: 12pt; margin-right: 6px; }
  .reason-text { font-size: 10.5pt; font-weight: 600; color: #0f172a; }

  /* Note box */
  .note-box { border: 1px solid #cbd5e1; border-radius: 4px; padding: 10px 14px; min-height: 50px; font-size: 10pt; white-space: pre-wrap; background: #fff; }
  .note-box.empty { color: #94a3b8; font-style: italic; }

  /* Declaration */
  .declaration { border: 1px solid #94a3b8; border-radius: 4px; padding: 10px 14px; font-size: 9.5pt; color: #374151; background: #fffbeb; line-height: 1.5; margin-bottom: 18px; }

  /* Signature blocks */
  .sig-row { display: flex; gap: 14px; margin-top: 6px; page-break-inside: avoid; }
  .sig-block { flex: 1; border: 1px solid #cbd5e1; border-radius: 6px; padding: 14px 12px 10px; background: #fafafa; }
  .sig-role { font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #64748b; margin-bottom: 3px; }
  .sig-name  { font-size: 9pt; font-weight: 600; color: #0f172a; margin-bottom: 10px; }
  .sig-line  { border-bottom: 1.5px solid #0f172a; height: 36px; margin-bottom: 4px; }
  .sig-label { font-size: 8pt; color: #64748b; }
  .date-line { border-bottom: 1px solid #94a3b8; height: 22px; margin: 8px 0 4px; }

  /* Stamp area */
  .stamp-box { border: 2px dashed #94a3b8; border-radius: 6px; height: 60px; display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 9pt; font-style: italic; margin-top: 6px; }

  /* Footer */
  .footer { margin-top: 20px; border-top: 1px solid #e2e8f0; padding-top: 8px; display: flex; justify-content: space-between; font-size: 7.5pt; color: #94a3b8; }

  /* Instruction box */
  .instruction { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 4px; padding: 8px 12px; font-size: 9pt; color: #1e40af; margin-top: 10px; line-height: 1.5; }
</style>
</head>
<body>

<!-- Header -->
<div class="header">
  <div class="logo-block">
    <div class="logo-name">✦ AMINA</div>
    <div class="logo-sub">AI Health Intelligence · Gambia</div>
  </div>
  <div class="ref-block">
    <div class="ref-label">Reference Number</div>
    <div class="ref-num">${ref_num}</div>
    <div style="font-size:8pt;color:#64748b;margin-top:3px">Date: ${dateStr}</div>
  </div>
</div>

<!-- Title -->
<div class="doc-title">
  <h1>Patient Removal Authorisation Form</h1>
  <div class="sub">This form must be completed, signed, and retained in the patient's care record. All removals require dual authorisation.</div>
</div>

<!-- Section 1: Patient Information -->
<div class="section">
  <div class="section-title">1. Patient Information</div>
  <table class="info">
    <tr><td class="label">Full Name</td><td>${patient_name}</td><td class="label">Patient ID</td><td>${patient_id}</td></tr>
    <tr><td class="label">Age</td><td>${patient_age || "—"}</td><td class="label">Gender</td><td>${patient_gender || "—"}</td></tr>
    <tr><td class="label">Region / District</td><td colspan="3">${patient_region || "—"}</td></tr>
  </table>
</div>

<!-- Section 2: Requesting Caregiver -->
<div class="section">
  <div class="section-title">2. Requesting Caregiver</div>
  <table class="info">
    <tr><td class="label">Full Name</td><td>${caregiver_name}</td><td class="label">Designation</td><td>${caregiver_title || "—"}</td></tr>
    <tr><td class="label">Caregiver ID</td><td>${caregiver_id}</td><td class="label">Contact</td><td>${caregiver_phone || "—"}</td></tr>
  </table>
</div>

<!-- Section 3: Reason for Removal -->
<div class="section">
  <div class="section-title">3. Reason for Removal</div>
  <div class="reason-box">
    <span class="check">☑</span>
    <span class="reason-text">${reason_text}</span>
  </div>
  ${custom_note ? `<div style="margin-top:6px;font-size:9pt;font-weight:600;color:#374151;margin-bottom:4px;">Additional Details (Caregiver's Own Words):</div><div class="note-box">${custom_note}</div>` : ""}
</div>

<!-- Section 4: Additional Notes -->
<div class="section">
  <div class="section-title">4. Additional Clinical / Administrative Notes</div>
  <div class="note-box ${additional_notes ? "" : "empty"}">${additional_notes || "No additional notes provided."}</div>
</div>

<!-- Section 5: Declaration -->
<div class="section">
  <div class="section-title">5. Declaration</div>
  <div class="declaration">
    I, <strong>${caregiver_name}</strong>, hereby declare that the information provided in this form is accurate and complete to the best of my knowledge. I confirm that this request for patient removal has been made in good faith and in accordance with the AMINA Care Programme guidelines, patient rights, and applicable health data protection regulations.
    <br/><br/>
    I understand that this removal will be recorded in the patient's permanent care log and that the patient will be notified as per programme policy. I acknowledge that falsification of this form may result in disciplinary action.
  </div>
</div>

<!-- Section 6: Signatures -->
<div class="section">
  <div class="section-title">6. Authorisation Signatures</div>

  <div class="sig-row">
    <!-- Caregiver -->
    <div class="sig-block">
      <div class="sig-role">Requesting Caregiver</div>
      <div class="sig-name">${caregiver_name}<br/><span style="font-weight:400;color:#64748b">${caregiver_title || "Caregiver"}</span></div>
      <div class="sig-line"></div>
      <div class="sig-label">Signature</div>
      <div class="date-line"></div>
      <div class="sig-label">Date (DD/MM/YYYY)</div>
    </div>

    <!-- Supervising Authority -->
    <div class="sig-block">
      <div class="sig-role">Supervising Authority</div>
      <div class="sig-name">&nbsp;<br/><span style="font-weight:400;color:#94a3b8;font-style:italic">District Health Officer / Programme Supervisor</span></div>
      <div class="sig-line"></div>
      <div class="sig-label">Signature</div>
      <div class="date-line"></div>
      <div class="sig-label">Date (DD/MM/YYYY)</div>
    </div>

    <!-- Witness -->
    <div class="sig-block">
      <div class="sig-role">Witness</div>
      <div class="sig-name">&nbsp;<br/><span style="font-weight:400;color:#94a3b8;font-style:italic">Name &amp; Designation</span></div>
      <div class="sig-line"></div>
      <div class="sig-label">Signature</div>
      <div class="date-line"></div>
      <div class="sig-label">Date (DD/MM/YYYY)</div>
    </div>
  </div>

  <!-- Official Stamp -->
  <div style="margin-top:14px;">
    <div style="font-size:8.5pt;font-weight:600;color:#374151;margin-bottom:6px;">Official Stamp / Seal (Health Facility)</div>
    <div class="stamp-box">Place official stamp / seal here</div>
  </div>
</div>

<!-- Instructions -->
<div class="instruction">
  <strong>IMPORTANT INSTRUCTIONS:</strong><br/>
  1. Print two copies — one for the district health office and one for the caregiver's records.<br/>
  2. All three signatories must sign before removal is confirmed in the system.<br/>
  3. Return a signed copy to the AMINA programme coordinator or upload a scan to confirm via the portal.<br/>
  4. Reference number <strong>${ref_num}</strong> must appear on all correspondence related to this removal.
</div>

<!-- Footer -->
<div class="footer">
  <span>AMINA Care Programme · The Gambia</span>
  <span>Ref: ${ref_num} · Generated: ${dateStr}</span>
  <span>CONFIDENTIAL — Health Record</span>
</div>

</body>
</html>`;

  const win = window.open("", "_blank", "width=900,height=1200");
  if (!win) { alert("Please allow pop-ups to download the form."); return; }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 600);
}

// ── RemovePatientModal ────────────────────────────────────────────────────────

function RemovePatientModal({ patient, caregiverInfo, token, onClose, onConfirmed }) {
  const [step, setStep]               = useState("form");   // "form" | "preview" | "done"
  const [reasonCode, setReasonCode]   = useState(null);
  const [customNote, setCustomNote]   = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");
  const [cgFullName, setCgFullName]   = useState(caregiverInfo?.name || "");
  const [cgTitle, setCgTitle]         = useState(caregiverInfo?.specialization || "");
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState("");
  const [formData, setFormData]       = useState(null);     // returned by API
  const [refNum, setRefNum]           = useState("");

  const isOther = reasonCode === 7;
  const canSubmit = reasonCode !== null && (!isOther || customNote.trim().length > 0);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true); setError("");
    try {
      const r = await fetch(`${API}/api/v1/caregiver/remove-patient`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id:          patient.patient_id || patient.id,
          reason_code:         reasonCode,
          custom_note:         customNote,
          additional_notes:    additionalNotes,
          caregiver_full_name: cgFullName,
          caregiver_title:     cgTitle,
        }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.detail || "Submission failed. Please try again."); return; }
      setFormData(data.form);
      setRefNum(data.ref_num);
      setStep("preview");
    } catch {
      setError("Connection error. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadAndConfirm = () => {
    generateRemovalPDF(formData, caregiverInfo);
    setStep("done");
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(15,23,42,.7)", zIndex: 9999,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div style={{
        background: "#fff", borderRadius: 14, width: "100%", maxWidth: 620,
        maxHeight: "92vh", overflowY: "auto",
        boxShadow: "0 24px 60px rgba(0,0,0,.3)",
      }}>
        {/* Modal header */}
        <div style={{
          padding: "18px 24px", borderBottom: "1px solid #e2e8f0",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: step === "done" ? "#f0fdf4" : step === "preview" ? "#fffbeb" : "#fef2f2",
          borderRadius: "14px 14px 0 0",
          position: "sticky", top: 0, zIndex: 10,
        }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: "#0f172a" }}>
              {step === "form"    && "Remove Patient from Panel"}
              {step === "preview" && "Download Authorisation Form"}
              {step === "done"    && "Form Downloaded — Next Steps"}
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
              {step === "form"    && `Removing ${patient.name || "this patient"} requires a signed authorisation form`}
              {step === "preview" && `Reference: ${refNum}`}
              {step === "done"    && "Your form has been generated. Please follow the instructions below."}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 20, lineHeight: 1, padding: 4 }}>✕</button>
        </div>

        <div style={{ padding: "24px 24px 20px" }}>

          {/* ── STEP 1: Form ── */}
          {step === "form" && (
            <>
              {/* Warning banner */}
              <div style={{
                background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8,
                padding: "10px 14px", marginBottom: 20, display: "flex", gap: 10,
              }}>
                <span style={{ fontSize: 18, flexShrink: 0 }}>⚠</span>
                <div style={{ fontSize: 12, color: "#b91c1c", lineHeight: 1.5 }}>
                  <strong>This action is not immediate.</strong> Removing a patient requires a printed authorisation form signed by you, a supervising authority, and a witness before the removal is confirmed in the system.
                </div>
              </div>

              {/* Patient info strip */}
              <div style={{
                background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8,
                padding: "10px 14px", marginBottom: 20, display: "flex", gap: 12, alignItems: "center",
              }}>
                <div style={{
                  width: 40, height: 40, borderRadius: "50%",
                  background: "linear-gradient(135deg,#ef4444,#b91c1c)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#fff", fontWeight: 800, fontSize: 16, flexShrink: 0,
                }}>
                  {(patient.name || "?")[0].toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{patient.name}</div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>
                    {[patient.age ? `Age ${patient.age}` : null, patient.gender, patient.region].filter(Boolean).join(" · ")}
                  </div>
                </div>
              </div>

              {/* Caregiver details (editable for the form) */}
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontWeight: 700, fontSize: 12, color: "#0f172a", marginBottom: 10, textTransform: "uppercase", letterSpacing: ".5px" }}>Your Details (as they will appear on the form)</div>
                <div style={{ display: "flex", gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 11, color: "#64748b", fontWeight: 600, display: "block", marginBottom: 4 }}>Full Name</label>
                    <input value={cgFullName} onChange={e => setCgFullName(e.target.value)}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: 7, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none", fontFamily: "inherit" }}
                      placeholder="Your full name" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 11, color: "#64748b", fontWeight: 600, display: "block", marginBottom: 4 }}>Designation / Title</label>
                    <input value={cgTitle} onChange={e => setCgTitle(e.target.value)}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: 7, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none", fontFamily: "inherit" }}
                      placeholder="e.g. Community Health Worker" />
                  </div>
                </div>
              </div>

              {/* Reason selection */}
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontWeight: 700, fontSize: 12, color: "#0f172a", marginBottom: 10, textTransform: "uppercase", letterSpacing: ".5px" }}>Reason for Removal <span style={{ color: "#ef4444" }}>*</span></div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {REMOVAL_REASONS.map(r => (
                    <label key={r.code} style={{
                      display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer",
                      padding: "9px 12px", borderRadius: 8,
                      border: `1.5px solid ${reasonCode === r.code ? "#ef4444" : "#e2e8f0"}`,
                      background: reasonCode === r.code ? "#fef2f2" : "#fafafa",
                      transition: "all .15s",
                    }}>
                      <input type="radio" name="reason" value={r.code}
                        checked={reasonCode === r.code}
                        onChange={() => setReasonCode(r.code)}
                        style={{ marginTop: 2, accentColor: "#ef4444", flexShrink: 0 }} />
                      <span style={{ fontSize: 13, color: "#1e293b", lineHeight: 1.4, fontWeight: reasonCode === r.code ? 600 : 400 }}>
                        {r.label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Custom note (shown when "Other" is selected) */}
              {isOther && (
                <div style={{ marginBottom: 18 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".5px" }}>
                    Custom Reason <span style={{ color: "#ef4444" }}>*</span>
                    <span style={{ fontWeight: 400, color: "#64748b", textTransform: "none", letterSpacing: 0, fontSize: 11, marginLeft: 6 }}>— please be specific and factual</span>
                  </label>
                  <textarea value={customNote} onChange={e => setCustomNote(e.target.value)}
                    rows={4} placeholder="Describe the specific reason for removal in detail…"
                    style={{
                      width: "100%", padding: "10px 12px", borderRadius: 8,
                      border: `1.5px solid ${customNote.trim() ? "#e2e8f0" : "#ef4444"}`,
                      fontSize: 13, fontFamily: "inherit", resize: "vertical", outline: "none",
                      lineHeight: 1.5,
                    }} />
                  {!customNote.trim() && <div style={{ fontSize: 11, color: "#ef4444", marginTop: 4 }}>This field is required when selecting "Other".</div>}
                </div>
              )}

              {/* Additional notes */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".5px" }}>
                  Additional Clinical / Administrative Notes
                  <span style={{ fontWeight: 400, color: "#64748b", textTransform: "none", letterSpacing: 0, fontSize: 11, marginLeft: 6 }}>— optional</span>
                </label>
                <textarea value={additionalNotes} onChange={e => setAdditionalNotes(e.target.value)}
                  rows={3} placeholder="Any relevant clinical context, transfer details, or administrative notes…"
                  style={{
                    width: "100%", padding: "10px 12px", borderRadius: 8,
                    border: "1.5px solid #e2e8f0", fontSize: 13, fontFamily: "inherit", resize: "vertical", outline: "none", lineHeight: 1.5,
                  }} />
              </div>

              {error && (
                <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#b91c1c", marginBottom: 14 }}>
                  {error}
                </div>
              )}

              {/* Action buttons */}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button onClick={onClose} style={{
                  padding: "9px 20px", borderRadius: 8, border: "1.5px solid #e2e8f0",
                  background: "#fff", fontSize: 13, cursor: "pointer", color: "#64748b", fontWeight: 600,
                }}>Cancel</button>
                <button onClick={handleSubmit} disabled={!canSubmit || submitting} style={{
                  padding: "9px 22px", borderRadius: 8, border: "none",
                  background: canSubmit && !submitting ? "#ef4444" : "#fca5a5",
                  color: "#fff", fontSize: 13, fontWeight: 700, cursor: canSubmit && !submitting ? "pointer" : "default",
                  transition: "background .15s",
                }}>
                  {submitting ? "Generating Form…" : "Generate Authorisation Form →"}
                </button>
              </div>
            </>
          )}

          {/* ── STEP 2: Preview / Download ── */}
          {step === "preview" && formData && (
            <>
              <div style={{
                background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8,
                padding: "12px 16px", marginBottom: 20, display: "flex", gap: 12, alignItems: "flex-start",
              }}>
                <span style={{ fontSize: 22, flexShrink: 0 }}>📋</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#92400e" }}>Authorisation form ready</div>
                  <div style={{ fontSize: 12, color: "#78350f", marginTop: 3, lineHeight: 1.5 }}>
                    Click <strong>"Download &amp; Print Form"</strong> below. The print dialog will open automatically.
                    The patient is <strong>not removed yet</strong> — the form must be signed by all three parties first.
                  </div>
                </div>
              </div>

              {/* Form summary card */}
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden", marginBottom: 20 }}>
                <div style={{ background: "#0f172a", padding: "12px 16px", color: "#fff" }}>
                  <div style={{ fontWeight: 800, fontSize: 13 }}>Patient Removal Authorisation Form</div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>Ref: {refNum}</div>
                </div>
                <div style={{ padding: "14px 16px", background: "#f8fafc" }}>
                  {[
                    ["Patient",    formData.patient_name],
                    ["Reason",     formData.reason_text],
                    ["Caregiver",  `${formData.caregiver_name} (${formData.caregiver_title || "—"})`],
                    ["Date",       new Date(formData.submitted_at).toLocaleDateString("en-GB", { day:"2-digit", month:"long", year:"numeric" })],
                  ].map(([label, val]) => (
                    <div key={label} style={{ display: "flex", gap: 10, marginBottom: 8, fontSize: 12 }}>
                      <span style={{ fontWeight: 600, color: "#64748b", width: 90, flexShrink: 0 }}>{label}</span>
                      <span style={{ color: "#0f172a" }}>{val}</span>
                    </div>
                  ))}
                  {formData.custom_note && (
                    <div style={{ display: "flex", gap: 10, marginBottom: 8, fontSize: 12 }}>
                      <span style={{ fontWeight: 600, color: "#64748b", width: 90, flexShrink: 0 }}>Note</span>
                      <span style={{ color: "#0f172a", fontStyle: "italic" }}>{formData.custom_note}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Required signatures reminder */}
              <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                {["Requesting Caregiver", "Supervising Authority", "Witness"].map((role, i) => (
                  <div key={i} style={{
                    flex: 1, border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px",
                    textAlign: "center", background: "#fafafa",
                  }}>
                    <div style={{ fontSize: 18, marginBottom: 4 }}>✍</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: ".5px" }}>{role}</div>
                    <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>Signature required</div>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button onClick={() => setStep("form")} style={{
                  padding: "9px 18px", borderRadius: 8, border: "1.5px solid #e2e8f0",
                  background: "#fff", fontSize: 13, cursor: "pointer", color: "#64748b", fontWeight: 600,
                }}>← Edit Form</button>
                <button onClick={handleDownloadAndConfirm} style={{
                  padding: "9px 22px", borderRadius: 8, border: "none",
                  background: "#f59e0b", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 7,
                }}>
                  <span>⬇</span> Download &amp; Print Form
                </button>
              </div>
            </>
          )}

          {/* ── STEP 3: Done ── */}
          {step === "done" && (
            <>
              <div style={{
                textAlign: "center", padding: "10px 0 20px",
              }}>
                <div style={{ fontSize: 48, marginBottom: 14 }}>📄</div>
                <div style={{ fontWeight: 800, fontSize: 16, color: "#0f172a", marginBottom: 6 }}>Form Downloaded Successfully</div>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 20, lineHeight: 1.6, maxWidth: 420, margin: "0 auto 20px" }}>
                  Your authorisation form (Ref: <strong>{refNum}</strong>) has been generated.
                  The patient is <strong>not yet removed</strong> from your panel.
                </div>
              </div>

              {/* Next steps */}
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden", marginBottom: 20 }}>
                <div style={{ background: "#0f172a", padding: "10px 16px", color: "#fff", fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: ".5px" }}>Next Steps</div>
                {[
                  { icon: "🖨", step: "Print the downloaded form — 2 copies recommended." },
                  { icon: "✍", step: "Sign the form yourself in the 'Requesting Caregiver' box." },
                  { icon: "🏥", step: "Obtain signature from a supervising authority (District Health Officer or Programme Supervisor)." },
                  { icon: "👁", step: "Have a witness sign and date the form." },
                  { icon: "🏛", step: "Submit one signed copy to the district health office. Keep one for your records." },
                  { icon: "💻", step: `Confirm removal in this portal using reference number: ${refNum}` },
                ].map((item, i) => (
                  <div key={i} style={{
                    display: "flex", gap: 12, padding: "10px 16px",
                    borderBottom: i < 5 ? "1px solid #f1f5f9" : "none",
                    background: i % 2 === 0 ? "#fff" : "#f8fafc",
                  }}>
                    <span style={{ fontSize: 16, flexShrink: 0 }}>{item.icon}</span>
                    <span style={{ fontSize: 12, color: "#374151", lineHeight: 1.5 }}>{item.step}</span>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button onClick={() => generateRemovalPDF(formData, caregiverInfo)} style={{
                  padding: "9px 18px", borderRadius: 8, border: "1.5px solid #e2e8f0",
                  background: "#fff", fontSize: 13, cursor: "pointer", color: "#64748b", fontWeight: 600,
                  display: "flex", alignItems: "center", gap: 6,
                }}>⬇ Download Again</button>
                <button onClick={onClose} style={{
                  padding: "9px 22px", borderRadius: 8, border: "none",
                  background: "#10b981", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
                }}>Done</button>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}

// ── Citation Bar ──────────────────────────────────────────────────────────────

function CitationBar({ citations }) {
  if (!citations || citations.length === 0) return null;
  return (
    <div style={{
      display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8,
      padding: "8px 12px",
      background: "#f8fafc", borderRadius: 8,
      border: "1px solid #e2e8f0",
    }}>
      <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, letterSpacing: ".5px",
        textTransform: "uppercase", alignSelf: "center", marginRight: 2 }}>
        Sources
      </span>
      {citations.map((c, i) => (
        <a key={i} href={c.url} target="_blank" rel="noopener noreferrer"
          title={`${c.title} — ${c.section}`}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "3px 10px", borderRadius: 20, textDecoration: "none",
            background: `${c.color}15`, border: `1px solid ${c.color}40`,
            color: c.color, fontSize: 11, fontWeight: 700,
            transition: "background .15s",
          }}
          onMouseEnter={e => e.currentTarget.style.background = `${c.color}28`}
          onMouseLeave={e => e.currentTarget.style.background = `${c.color}15`}
        >
          <span style={{
            width: 16, height: 16, borderRadius: "50%",
            background: c.color, color: "#fff",
            display: "inline-flex", alignItems: "center",
            justifyContent: "center", fontSize: 9, fontWeight: 800, flexShrink: 0,
          }}>
            {c.source.slice(0, 1)}
          </span>
          {c.source} {c.year}
        </a>
      ))}
    </div>
  );
}

// ── Shared input styles ────────────────────────────────────────────────────────
const inp = {
  width: "100%", padding: "10px 14px", borderRadius: 8,
  border: `1.5px solid ${C.border}`, fontSize: 14, outline: "none",
  fontFamily: "inherit", boxSizing: "border-box", color: C.text,
  background: "#fff", transition: "border-color .15s",
};

// ── Alert intent detection ─────────────────────────────────────────────────────
function detectAlertIntent(text) {
  if (!text || text.trim().endsWith("?")) return null;
  const t = text.toLowerCase().trim();
  if (!/^(send|alert|warn|notify|remind|tell|message|forward|push|flag)\b/.test(t)) return null;
  if (/(emergency|urgent|critical|immediately|hospital|call\s*(112|911|999|ambulance))/i.test(t))
    return { severity: "emergency" };
  if (/(warn|warning|danger|caution|careful|risk)/i.test(t))
    return { severity: "warning" };
  return { severity: "info" };
}

const ALERT_TEMPLATES = [
  { label: "💊 Medications",  severity: "info",
    message: "Friendly reminder: please take your prescribed medications today as scheduled." },
  { label: "🩸 BP Check",     severity: "warning",
    message: "Please check and record your blood pressure today. If it's above 140/90 mmHg, contact us right away." },
  { label: "📅 Appointment",  severity: "info",
    message: "You have an upcoming health appointment. Please attend and bring your medications list." },
  { label: "🥗 Diet",         severity: "info",
    message: "Remember to follow your prescribed diet today — limit salt and sugar as discussed." },
  { label: "🚨 Seek Care",    severity: "emergency",
    message: "Please seek medical attention immediately. Go to the nearest health facility or call emergency services." },
];

// ── Modals ─────────────────────────────────────────────────────────────────────

function ModalShell({ onClose, children, width = 500 }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(15,23,42,.6)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 2000, padding: 20,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: "#fff", borderRadius: 16, width, maxWidth: "100%",
        maxHeight: "92vh", overflowY: "auto",
        boxShadow: "0 24px 80px rgba(0,0,0,.3)",
      }}>
        {children}
      </div>
    </div>
  );
}

function ModalHeader({ title, onClose }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "20px 24px", borderBottom: `1px solid ${C.border}`,
    }}>
      <div style={{ fontWeight: 700, fontSize: 16, color: C.text }}>{title}</div>
      <button onClick={onClose} style={{
        background: "#f1f5f9", border: "none", color: C.muted,
        borderRadius: 8, width: 32, height: 32, cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 18, lineHeight: 1,
      }}>✕</button>
    </div>
  );
}

function Btn({ onClick, disabled, color = C.accent, outline, children, style = {} }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: "10px 20px", borderRadius: 8, fontWeight: 600, fontSize: 14,
      cursor: disabled ? "default" : "pointer", transition: "opacity .15s",
      opacity: disabled ? 0.55 : 1,
      border: outline ? `1.5px solid ${C.border}` : "none",
      background: outline ? "#fff" : color,
      color: outline ? C.text : "#fff",
      ...style,
    }}>{children}</button>
  );
}

function SendAlertModal({ patientName, patientId, token, onClose, onSent }) {
  const [message, setMessage]         = useState("");
  const [severity, setSeverity]       = useState("info");
  const [useTelegram, setUseTelegram] = useState(false);
  const [loading, setLoading]         = useState(false);
  const [err, setErr]                 = useState("");

  const handleSend = async () => {
    if (!message.trim()) { setErr("Message is required"); return; }
    setLoading(true); setErr("");
    try {
      const r = await fetch(`${API}/api/v1/caregiver/send-patient-alert`, {
        method: "POST", headers: authHeaders(token),
        body: JSON.stringify({ patient_id: patientId, message: message.trim(), severity, use_telegram: useTelegram }),
      });
      if (!r.ok) { const d = await r.json(); setErr(d.detail || "Failed"); return; }
      const data = await r.json();
      onSent({ ...data.alert, sent_at: new Date().toISOString() });
    } catch { setErr("Connection error."); }
    finally { setLoading(false); }
  };

  const m = SEV_META[severity];

  return (
    <ModalShell onClose={onClose} width={500}>
      <ModalHeader title={`Send Alert — ${patientName || "Patient"}`} onClose={onClose} />
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 18 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 8 }}>Severity</div>
          <div style={{ display: "flex", gap: 8 }}>
            {Object.entries(SEV_META).map(([key, sm]) => (
              <button key={key} onClick={() => setSeverity(key)} style={{
                flex: 1, padding: "10px 8px", borderRadius: 10, cursor: "pointer",
                border: `2px solid ${severity === key ? sm.color : C.border}`,
                background: severity === key ? sm.bg : "#fafafa",
                color: severity === key ? sm.color : C.muted,
                fontWeight: severity === key ? 700 : 400, fontSize: 13, textAlign: "center",
              }}>
                <div style={{ fontSize: 16, marginBottom: 2 }}>{sm.icon}</div>
                <div style={{ fontWeight: 700 }}>{sm.label}</div>
              </button>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 8 }}>Message</div>
          <textarea value={message} onChange={e => setMessage(e.target.value)} rows={4}
            placeholder="Type your message to the patient…"
            style={{ ...inp, resize: "vertical" }} />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 14, color: C.muted }}>
          <input type="checkbox" checked={useTelegram} onChange={e => setUseTelegram(e.target.checked)} style={{ width: 16, height: 16 }} />
          Also push to patient's Telegram
        </label>
        {err && <div style={{ color: C.danger, fontSize: 13, background: "#fef2f2", padding: "8px 12px", borderRadius: 8 }}>{err}</div>}
        <div style={{ display: "flex", gap: 10 }}>
          <Btn outline onClick={onClose} style={{ flex: 1 }}>Cancel</Btn>
          <Btn onClick={handleSend} disabled={loading || !message.trim()} color={m.color} style={{ flex: 2 }}>
            {loading ? "Sending…" : `Send ${m.label}`}
          </Btn>
        </div>
      </div>
    </ModalShell>
  );
}

function AddRuleModal({ patientId, patientName, token, onClose, onCreated }) {
  const [label, setLabel]           = useState("");
  const [message, setMessage]       = useState("");
  const [severity, setSeverity]     = useState("info");
  const [frequency, setFrequency]   = useState("daily");
  const [sendTime, setSendTime]     = useState("09:00");
  const [intervalHours, setIntervalHours] = useState(4);
  const [loading, setLoading]       = useState(false);
  const [err, setErr]               = useState("");

  const handleCreate = async () => {
    if (!label.trim() || !message.trim()) { setErr("Label and message are required"); return; }
    setLoading(true); setErr("");
    try {
      const r = await fetch(`${API}/api/v1/caregiver/alert-rules`, {
        method: "POST", headers: authHeaders(token),
        body: JSON.stringify({ patient_id: patientId, label: label.trim(), message: message.trim(), severity, frequency,
          send_time: frequency !== "hourly" ? sendTime : null,
          interval_hours: frequency === "hourly" ? intervalHours : null,
        }),
      });
      if (!r.ok) { const d = await r.json(); setErr(d.detail || "Failed"); return; }
      const data = await r.json();
      onCreated(data.rule);
    } catch { setErr("Connection error."); }
    finally { setLoading(false); }
  };

  const sel = { ...inp, padding: "10px 12px" };

  return (
    <ModalShell onClose={onClose} width={520}>
      <ModalHeader title={`New Automated Rule — ${patientName || "Patient"}`} onClose={onClose} />
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
        {[
          { lbl: "Rule Label", el: <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Morning Medication Reminder" style={inp} /> },
          { lbl: "Message", el: <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3} placeholder="e.g. Good morning! Please take your medications." style={{ ...inp, resize: "vertical" }} /> },
        ].map(({ lbl, el }) => (
          <div key={lbl}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 7 }}>{lbl}</div>
            {el}
          </div>
        ))}
        <div style={{ display: "flex", gap: 12 }}>
          {[
            { lbl: "Severity", el: <select value={severity} onChange={e => setSeverity(e.target.value)} style={sel}><option value="info">Info</option><option value="warning">Warning</option><option value="emergency">Emergency</option></select> },
            { lbl: "Frequency", el: <select value={frequency} onChange={e => setFrequency(e.target.value)} style={sel}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="hourly">Every N hours</option></select> },
          ].map(({ lbl, el }) => (
            <div key={lbl} style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 7 }}>{lbl}</div>
              {el}
            </div>
          ))}
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 7 }}>
            {frequency !== "hourly" ? "Send Time" : "Interval (hours)"}
          </div>
          {frequency !== "hourly"
            ? <input type="time" value={sendTime} onChange={e => setSendTime(e.target.value)} style={inp} />
            : <input type="number" min={1} max={72} value={intervalHours} onChange={e => setIntervalHours(parseInt(e.target.value) || 1)} style={inp} />
          }
        </div>
        {err && <div style={{ color: C.danger, fontSize: 13, background: "#fef2f2", padding: "8px 12px", borderRadius: 8 }}>{err}</div>}
        <div style={{ display: "flex", gap: 10 }}>
          <Btn outline onClick={onClose} style={{ flex: 1 }}>Cancel</Btn>
          <Btn onClick={handleCreate} disabled={loading || !label.trim() || !message.trim()} style={{ flex: 2 }}>
            {loading ? "Creating…" : "Create Rule"}
          </Btn>
        </div>
      </div>
    </ModalShell>
  );
}

function AlertRuleRow({ rule, isLast, onDelete }) {
  const [confirming, setConfirming] = useState(false);
  const m = SEV_META[rule.severity] || SEV_META.info;
  const freq = rule.frequency === "daily" ? `Daily · ${rule.send_time}`
    : rule.frequency === "weekly" ? `Weekly · ${rule.send_time}`
    : `Every ${rule.interval_hours}h`;

  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 14,
      padding: "14px 0", borderBottom: isLast ? "none" : `1px solid ${C.border}`,
    }}>
      <div style={{
        width: 8, height: 8, borderRadius: "50%",
        background: m.color, marginTop: 7, flexShrink: 0,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: C.text }}>{rule.label}</div>
        <div style={{ fontSize: 13, color: C.muted, margin: "3px 0", lineHeight: 1.5 }}>{rule.message}</div>
        <div style={{ fontSize: 11, color: C.subtle }}>
          {freq} · {rule.fire_count || 0} sent
          {rule.last_fired_at && ` · Last ${timeAgo(rule.last_fired_at)}`}
        </div>
      </div>
      <SevBadge severity={rule.severity} />
      {confirming ? (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: C.danger, fontWeight: 600 }}>Delete?</span>
          <button onClick={onDelete} style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: C.danger, color: "#fff", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>Yes</button>
          <button onClick={() => setConfirming(false)} style={{ padding: "4px 10px", borderRadius: 6, border: `1.5px solid ${C.border}`, background: "#fff", fontSize: 12, cursor: "pointer" }}>No</button>
        </div>
      ) : (
        <button onClick={() => setConfirming(true)} style={{
          padding: "4px 12px", borderRadius: 6, border: `1.5px solid #fecaca`,
          background: "#fff", color: C.danger, fontSize: 12, cursor: "pointer",
          fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0,
        }}>Remove</button>
      )}
    </div>
  );
}

function UpgradeModal({ currentLimit, patientCount, onConfirm, onClose }) {
  const [selected, setSelected] = useState(null);
  const [custom, setCustom]     = useState("");
  const tiers = [25, 50, 100].filter(t => t > currentLimit);

  const handleConfirm = () => {
    const val = selected === "custom" ? parseInt(custom, 10) : selected;
    if (!val || val < patientCount) return;
    onConfirm(val);
  };

  return (
    <ModalShell onClose={onClose} width={420}>
      <ModalHeader title="Upgrade Patient Limit" onClose={onClose} />
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 6 }}>
          Currently using {patientCount} of {currentLimit} slots
        </div>
        {tiers.map(t => (
          <button key={t} onClick={() => { setSelected(t); setCustom(""); }} style={{
            padding: "14px 16px", borderRadius: 10, border: `2px solid ${selected === t ? C.accent : C.border}`,
            background: selected === t ? "#f0fdf4" : "#fff",
            cursor: "pointer", textAlign: "left", fontWeight: 600, fontSize: 14, color: C.text,
          }}>
            Up to {t} patients
            <span style={{ float: "right", color: C.subtle, fontWeight: 400, fontSize: 13 }}>
              {t === 25 ? "Standard" : t === 50 ? "Professional" : "Enterprise"}
            </span>
          </button>
        ))}
        <button onClick={() => setSelected("custom")} style={{
          padding: "14px 16px", borderRadius: 10, border: `2px solid ${selected === "custom" ? C.accent : C.border}`,
          background: selected === "custom" ? "#f0fdf4" : "#fff",
          cursor: "pointer", textAlign: "left", fontWeight: 600, fontSize: 14, color: C.text,
        }}>Custom limit</button>
        {selected === "custom" && (
          <input type="number" min={Math.max(patientCount, currentLimit + 1)}
            placeholder={`Min ${Math.max(patientCount, currentLimit + 1)}`}
            value={custom} onChange={e => setCustom(e.target.value)} style={inp} />
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <Btn outline onClick={onClose} style={{ flex: 1 }}>Cancel</Btn>
          <Btn onClick={handleConfirm} disabled={!selected || (selected === "custom" && !custom)} style={{ flex: 2 }}>
            Confirm Upgrade
          </Btn>
        </div>
      </div>
    </ModalShell>
  );
}

function QuickAlertPanel({ patientName, patientId, token, initial, onSent, onChatInstead, onClose }) {
  const [severity, setSeverity]     = useState(initial?.severity || "info");
  const [message, setMessage]       = useState(initial?.message || "");
  const [useTelegram, setUseTelegram] = useState(false);
  const [sending, setSending]       = useState(false);
  const [err, setErr]               = useState("");
  const m = SEV_META[severity] || SEV_META.info;

  const handleSend = async () => {
    if (!message.trim()) { setErr("Message is required."); return; }
    setSending(true); setErr("");
    try {
      const r = await fetch(`${API}/api/v1/caregiver/send-patient-alert`, {
        method: "POST", headers: authHeaders(token),
        body: JSON.stringify({ patient_id: patientId, message: message.trim(), severity, use_telegram: useTelegram }),
      });
      if (!r.ok) { const d = await r.json(); setErr(d.detail || "Failed"); return; }
      const data = await r.json();
      onSent({ ...data.alert, sent_at: new Date().toISOString() });
    } catch { setErr("Connection error."); }
    finally { setSending(false); }
  };

  return (
    <div style={{
      border: `2px solid ${m.color}`, borderRadius: 12,
      background: m.bg, padding: 16, marginBottom: 10,
      boxShadow: `0 4px 20px ${m.color}22`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: m.color }}>{m.icon} Alert — {patientName || "Patient"}</div>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: C.muted }}>✕</button>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {Object.entries(SEV_META).map(([key, sm]) => (
          <button key={key} onClick={() => setSeverity(key)} style={{
            flex: 1, padding: "6px", borderRadius: 7, cursor: "pointer", fontSize: 12,
            border: `1.5px solid ${severity === key ? sm.color : C.border}`,
            background: severity === key ? `${sm.color}18` : "#fff",
            color: severity === key ? sm.color : C.muted,
            fontWeight: severity === key ? 700 : 400,
          }}>{sm.icon} {sm.label}</button>
        ))}
      </div>
      <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3}
        placeholder="Type your message to the patient…"
        style={{ ...inp, resize: "vertical", marginBottom: 8 }} />
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.muted, marginBottom: 10, cursor: "pointer" }}>
        <input type="checkbox" checked={useTelegram} onChange={e => setUseTelegram(e.target.checked)} />
        Also push to patient's Telegram
      </label>
      {err && <div style={{ color: C.danger, fontSize: 12, marginBottom: 8 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        {onChatInstead && (
          <Btn outline onClick={onChatInstead} style={{ flex: 1, padding: "8px" }}>💬 Chat instead</Btn>
        )}
        <Btn onClick={handleSend} disabled={sending || !message.trim()} color={m.color} style={{ flex: 2, padding: "8px" }}>
          {sending ? "Sending…" : `Send ${m.label}`}
        </Btn>
      </div>
    </div>
  );
}

// ── Login Screen ───────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }) {
  const [phone, setPhone]     = useState("");
  const [pin, setPin]         = useState("");
  const [err, setErr]         = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setErr(""); setLoading(true);
    try {
      const r = await fetch(`${API}/api/v1/caregiver/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim(), pin: pin.trim() }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || data.error || "Login failed");
      onLogin(data.token, data);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", fontFamily: "system-ui,-apple-system,sans-serif" }}>
      {/* Left panel — branding */}
      <div style={{
        width: "42%", background: "linear-gradient(160deg,#0f172a 0%,#064e3b 100%)",
        display: "flex", flexDirection: "column", justifyContent: "center",
        padding: "60px 52px", position: "relative", overflow: "hidden",
      }}>
        {/* Decorative circles */}
        <div style={{ position: "absolute", top: -80, right: -80, width: 300, height: 300, borderRadius: "50%", background: "rgba(16,185,129,.1)" }} />
        <div style={{ position: "absolute", bottom: -60, left: -60, width: 200, height: 200, borderRadius: "50%", background: "rgba(16,185,129,.07)" }} />

        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 48 }}>
            <div style={{
              width: 48, height: 48, borderRadius: 14,
              background: "linear-gradient(135deg,#10b981,#059669)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 22,
            }}>🩺</div>
            <div>
              <div style={{ color: "#fff", fontWeight: 800, fontSize: 22, letterSpacing: "-.3px" }}>AMINA</div>
              <div style={{ color: "#6ee7b7", fontSize: 12 }}>Caregiver Portal</div>
            </div>
          </div>

          <div style={{ color: "#fff", fontWeight: 700, fontSize: 30, lineHeight: 1.2, marginBottom: 16 }}>
            Care better,<br />together.
          </div>
          <div style={{ color: "#94a3b8", fontSize: 14, lineHeight: 1.7, marginBottom: 40 }}>
            Monitor patients, send alerts, and coordinate care — all from one secure dashboard.
          </div>

          {[
            { icon: "🏥", text: "Real-time patient health summaries" },
            { icon: "🔔", text: "Smart alerts & automated reminders" },
            { icon: "💬", text: "Direct messaging with patients" },
            { icon: "🧠", text: "AI-powered clinical insights" },
          ].map(({ icon, text }) => (
            <div key={text} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: "rgba(16,185,129,.2)",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15,
              }}>{icon}</div>
              <span style={{ color: "#cbd5e1", fontSize: 13 }}>{text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel — form */}
      <div style={{
        flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
        background: "#f8fafc", padding: 40,
      }}>
        <div style={{ width: "100%", maxWidth: 380 }}>
          <div style={{ marginBottom: 36 }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: C.text, marginBottom: 6 }}>Sign in</div>
            <div style={{ fontSize: 14, color: C.muted }}>Enter your credentials to access your patients.</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: C.text, display: "block", marginBottom: 7 }}>
                Phone number
              </label>
              <input type="tel" placeholder="+91 9876543210" value={phone}
                onChange={e => setPhone(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleLogin()}
                style={{ ...inp, fontSize: 15 }} />
            </div>

            <div>
              <label style={{ fontSize: 13, fontWeight: 600, color: C.text, display: "block", marginBottom: 7 }}>
                4-digit PIN
              </label>
              <input type="password" maxLength={4} placeholder="••••" value={pin}
                onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                onKeyDown={e => e.key === "Enter" && handleLogin()}
                style={{ ...inp, fontSize: 26, letterSpacing: 10 }} />
            </div>

            {err && (
              <div style={{
                background: "#fef2f2", border: "1px solid #fecaca",
                color: C.danger, borderRadius: 8, padding: "10px 14px", fontSize: 13,
              }}>{err}</div>
            )}

            <button onClick={handleLogin} disabled={loading || !phone || pin.length !== 4} style={{
              width: "100%", padding: "13px", borderRadius: 10, border: "none",
              background: loading || !phone || pin.length !== 4
                ? C.border : `linear-gradient(135deg,${C.accent},${C.accentDark})`,
              color: loading || !phone || pin.length !== 4 ? C.muted : "#fff",
              fontSize: 15, fontWeight: 700, cursor: "pointer",
              boxShadow: loading || !phone || pin.length !== 4 ? "none" : "0 4px 14px rgba(16,185,129,.35)",
              transition: "all .2s",
            }}>
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </div>

          <p style={{ textAlign: "center", fontSize: 12, color: C.subtle, marginTop: 28 }}>
            No account? Ask the patient to share an invite code.<br />
            Supported: 🇬🇲 Gambia · 🇮🇳 India · 🇨🇴 Colombia
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Sidebar nav items ──────────────────────────────────────────────────────────

const NAV = [
  { id: "summary",      label: "Overview",     icon: "⊞" },
  { id: "insights",     label: "Insights",     icon: "◈" },
  { id: "panel",        label: "Panel",        icon: "◧" },
  { id: "alerts",       label: "Alerts",       icon: "◉" },
  { id: "messages",     label: "Messages",     icon: "◫" },
  { id: "chat",         label: "Ask AMINA",    icon: "✦" },
  { id: "profile",      label: "Patient Info", icon: "◷" },
  { id: "wellbeing",    label: "My Wellbeing", icon: "◎" },
  { id: "applications", label: "Applications", icon: "◑" },
];

// ── Dashboard ──────────────────────────────────────────────────────────────────

function Dashboard({ token, caregiverInfo, onLogout }) {
  // Inject keyframe animations (compact spin + notice fade) once on mount
  useEffect(() => {
    const id = "cg-portal-keyframes";
    if (!document.getElementById(id)) {
      const s = document.createElement("style");
      s.id = id;
      s.textContent = `
        @keyframes cg-compact-spin {
          0%   { transform: rotate(0deg)   scale(1);    opacity: 1; }
          40%  { transform: rotate(180deg) scale(1.15); opacity: 0.7; }
          70%  { transform: rotate(340deg) scale(0.9);  opacity: 0.5; }
          100% { transform: rotate(360deg) scale(1);    opacity: 1; }
        }
        @keyframes notice-fade {
          0%   { opacity: 0; transform: translateY(-6px); }
          15%  { opacity: 1; transform: translateY(0); }
          75%  { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes cg-blink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
        @keyframes cg-bounce { 0%,60%,100% { transform: translateY(0); } 30% { transform: translateY(-5px); } }
        @keyframes cg-msgUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `;
      document.head.appendChild(s);
    }
  }, []);

  const [tab, setTab]               = useState("summary");
  const [patients, setPatients]     = useState([]);
  const [selectedPid, setSelectedPid] = useState(null);
  const [capacity, setCapacity]     = useState({ count: 0, limit: 10 });
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [summary, setSummary]       = useState(null);
  const [alerts, setAlerts]         = useState([]);
  const [alertRules, setAlertRules] = useState([]);
  const [showSendAlert, setShowSendAlert] = useState(false);
  const [showAddRule, setShowAddRule]     = useState(false);
  const [loading, setLoading]       = useState(true);
  const [insights, setInsights]     = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [chatMsgs, setChatMsgs]     = useState([]);
  const [chatInput, setChatInput]   = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  // AMINA LoRA disabled for maintenance — silently migrate any cached "amina" pref.
  const [cgModelPref, setCgModelPref]         = useState(() => {
    const cached = localStorage.getItem("CG_MODEL_PREF") || "base";
    return cached === "amina" ? "mistral" : cached;
  });
  const [cgIsCompacting, setCgIsCompacting]   = useState(false);
  const [cgFreedOffset, setCgFreedOffset]     = useState(0);
  const [cgCompactToast, setCgCompactToast]   = useState(null);
  const [cgModelSwitchNotice, setCgModelSwitchNotice] = useState("");
  const cgSessionRef = useRef(`cg_${Date.now()}_${Math.random().toString(36).slice(2,7)}`);
  const [quickAlert, setQuickAlert] = useState(null);
  const chatEndRef = useRef(null);

  // ── Language / translation state ─────────────────────────────────────────────
  const [cgLang, setCgLang] = useState(() => localStorage.getItem("AMINA_LANG") || "en");
  const [cgNkoMode, setCgNkoMode] = useState(false);
  const [cgUiTranslations, setCgUiTranslations] = useState({});

  useEffect(() => {
    localStorage.setItem("CG_LANG", cgLang);
    i18nSetLanguage(cgLang);
  }, [cgLang]);

  useEffect(() => {
    if (cgLang === "en") { setCgUiTranslations({}); return; }
    const cacheKey = `CG_UI_TRANSLATIONS_${cgLang}`;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) { setCgUiTranslations(JSON.parse(cached)); return; }
    } catch {}
    (async () => {
      try {
        const r = await fetch(`${API}/api/v1/agent/translate/batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texts: CG_UI_STRINGS_EN, source: "en", target: cgLang }),
        });
        if (r.ok) {
          const d = await r.json();
          if (d.translations) {
            setCgUiTranslations(d.translations);
            localStorage.setItem(cacheKey, JSON.stringify(d.translations));
          }
        }
      } catch {}
    })();
  }, [cgLang]);

  const t = (key) => cgUiTranslations[key] || CG_UI_STRINGS_EN[key] || key;

  // ── Chat history persistence ──────────────────────────────────────────────────
  const [cgChatHistory, setCgChatHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem("CG_CHAT_HISTORY") || "[]"); } catch { return []; }
  });
  const [cgShowHistory, setCgShowHistory] = useState(false);
  const _cgHistoryKey = "CG_CHAT_HISTORY";
  const _cgMaxHistory = 50;

  const saveChatSession = useCallback((msgs, patientName, sessionId) => {
    if (!msgs || msgs.length < 2) return;
    const firstUser = msgs.find(m => m.role === "user")?.text || "";
    const preview = firstUser.slice(0, 80) || "Chat session";
    const entry = {
      id: sessionId || `hist_${Date.now()}`,
      ts: Date.now(),
      patientName: patientName || "Unknown",
      patientId: selectedPid,
      preview,
      msgCount: msgs.length,
      model: cgModelPref,
      messages: msgs,
    };
    setCgChatHistory(prev => {
      const updated = [entry, ...prev.filter(h => h.id !== entry.id)].slice(0, _cgMaxHistory);
      try { localStorage.setItem(_cgHistoryKey, JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, [selectedPid, cgModelPref]);

  const deleteChatRecord = useCallback((recordId) => {
    setCgChatHistory(prev => {
      const updated = prev.filter(h => h.id !== recordId);
      try { localStorage.setItem(_cgHistoryKey, JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, []);

  const loadChatRecord = useCallback((record) => {
    if (chatMsgs.length >= 2) {
      saveChatSession(chatMsgs, summary?.name, cgSessionRef.current);
    }
    setChatMsgs(record.messages || []);
    setCgFreedOffset(0);
    cgSessionRef.current = record.id;
    if (record.patientId && record.patientId !== selectedPid) {
      setSelectedPid(record.patientId);
    }
    setCgShowHistory(false);
  }, [chatMsgs, summary, selectedPid, saveChatSession]);

  // ── Voice state ──────────────────────────────────────────────────────────────
  const [voiceRec, setVoiceRec]       = useState(false);   // recording in progress
  const [voiceProc, setVoiceProc]     = useState(false);   // STT/TTS processing
  const [voiceErr, setVoiceErr]       = useState("");
  const [voiceLive, setVoiceLive]     = useState("");      // live transcript preview
  const recorderRef   = useRef(null);
  const chunksRef     = useRef([]);
  const mimeRef       = useRef("");
  const audioCtxRef   = useRef(null);
  const ttsAudioRef   = useRef(null);                      // current TTS playback

  const [cgMessages, setCgMessages]     = useState([]);
  const [cgMsgInput, setCgMsgInput]     = useState({});
  const [cgMsgSending, setCgMsgSending] = useState({});
  const [cgUnreadTotal, setCgUnreadTotal] = useState(0);
  const cgMsgEndRef = useRef(null);

  // ── Patient removal ──────────────────────────────────────────────────────────
  const [showRemoveModal, setShowRemoveModal] = useState(false);

  // ── Tier 1+2+3 state ─────────────────────────────────────────────────────────
  const [panelData, setPanelData]           = useState(null);   // { priority_queue, heatmap, … }
  const [clusterAlerts, setClusterAlerts]   = useState([]);     // OutbreakAlert[]
  const [panelLoading, setPanelLoading]     = useState(false);
  const [criMap, setCriMap]                 = useState({});     // { patient_id: { cri, cri_label } }
  const [criTipOpen, setCriTipOpen]         = useState(false);  // CRI click tooltip
  const criTipRef                           = useRef(null);      // popover container ref
  const [emergencyBanner, setEmergencyBanner] = useState([]);   // EMERGENCY patients for top banner
  const notifiedEmergencyRef                = useRef(new Set()); // already-notified patient IDs

  // ── Tier 4+5+6 state ─────────────────────────────────────────────────────────
  const [carePlan, setCarePlan]             = useState(null);   // CarePlan for selectedPid
  const [carePlanLoading, setCarePlanLoading] = useState(false);
  const [burnoutData, setBurnoutData]       = useState(null);   // BurnoutRisk for this caregiver
  const [perfReport, setPerfReport]         = useState(null);   // 7-day performance report
  const [perfLoading, setPerfLoading]       = useState(false);
  const [outcomeMap, setOutcomeMap]         = useState({});     // { patient_id: OutcomeSummary }

  // ── Applications state ───────────────────────────────────────────────────────
  const [applications, setApplications]       = useState([]);
  const [appsLoading, setAppsLoading]         = useState(false);
  const [respondingId, setRespondingId]       = useState(null);
  const [respondNote, setRespondNote]         = useState("");
  const [showRespondFor, setShowRespondFor]   = useState(null);  // app_id being reviewed

  const [profileSaving, setProfileSaving]   = useState(false);
  const [profileErr, setProfileErr]         = useState("");
  const [profileOk, setProfileOk]           = useState(false);
  const [profileForm, setProfileForm]       = useState({ name: "", bio: "", specialization: "", profile_photo: "" });
  const photoInputRef = useRef(null);
  const [showCgProfile, setShowCgProfile]       = useState(false);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const profileDropdownRef = useRef(null);

  // ── Data fetching ────────────────────────────────────────────────────────────

  const fetchPatients = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/v1/caregiver/patients`, { headers: authHeaders(token) });
      if (!r.ok) return;
      const data = await r.json();
      const pts = data.patients || [];
      setPatients(pts);
      setCapacity({ count: data.count, limit: data.limit });
      if (!selectedPid && pts.length) setSelectedPid(pts[0].patient_id);

      // Batch-fetch CRI for all patients in the background
      pts.forEach(p => {
        fetch(`${API}/api/v1/caregiver/predictions/${p.patient_id}`, { headers: authHeaders(token) })
          .then(res => res.ok ? res.json() : null)
          .then(d => {
            if (!d) return;
            setCriMap(prev => ({ ...prev, [p.patient_id]: { cri: d.cri, cri_label: d.cri_label, proactive: d.proactive_message } }));
          })
          .catch(() => {});
      });

      // Emergency notifications
      const emergencyPts = pts.filter(p => p.triage_status === "EMERGENCY");
      if (emergencyPts.length) {
        setEmergencyBanner(emergencyPts);
        emergencyPts.forEach(p => {
          if (notifiedEmergencyRef.current.has(p.patient_id)) return;
          notifiedEmergencyRef.current.add(p.patient_id);
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            new Notification("⚠️ AMINA Emergency Alert", {
              body: `${p.name} requires immediate emergency attention.`,
              icon: "/amina.svg",
              tag: `emergency-${p.patient_id}`,
            });
          }
        });
      }
    } catch (e) { console.error(e); }
  }, [token, selectedPid]);

  const fetchDashboard = useCallback(async () => {
    if (!selectedPid) return;
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/v1/caregiver/dashboard?pid=${selectedPid}`, { headers: authHeaders(token) });
      if (!r.ok) throw new Error("Failed");
      setSummary(await r.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [token, selectedPid]);

  const fetchAlerts = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/v1/caregiver/alerts`, { headers: authHeaders(token) });
      if (r.ok) setAlerts((await r.json()).alerts || []);
    } catch {}
  }, [token]);

  const fetchAlertRules = useCallback(async () => {
    if (!selectedPid) return;
    try {
      const r = await fetch(`${API}/api/v1/caregiver/alert-rules?pid=${selectedPid}`, { headers: authHeaders(token) });
      if (r.ok) setAlertRules((await r.json()).rules || []);
    } catch {}
  }, [token, selectedPid]);

  const fetchInsights = useCallback(async (pid) => {
    setInsightsLoading(true); setInsights(null);
    try {
      const r = await fetch(`${API}/api/v1/caregiver/insights?pid=${pid}`, { headers: authHeaders(token) });
      if (r.ok) setInsights(await r.json());
    } catch (e) { console.error(e); }
    finally { setInsightsLoading(false); }
  }, [token]);

  const fetchPanel = useCallback(async () => {
    setPanelLoading(true);
    try {
      const [panelRes, alertRes] = await Promise.all([
        fetch(`${API}/api/v1/caregiver/panel`,          { headers: authHeaders(token) }),
        fetch(`${API}/api/v1/caregiver/cluster-alerts`, { headers: authHeaders(token) }),
      ]);
      if (panelRes.ok)  setPanelData(await panelRes.json());
      if (alertRes.ok) setClusterAlerts((await alertRes.json()).alerts || []);
    } catch (e) { console.error("fetchPanel:", e); }
    finally { setPanelLoading(false); }
  }, [token]);

  // Fetch CRI for a single patient (called when patient is selected)
  const fetchPatientCri = useCallback(async (pid) => {
    if (!pid || criMap[pid]) return;
    try {
      const r = await fetch(`${API}/api/v1/caregiver/predictions/${pid}`, { headers: authHeaders(token) });
      if (!r.ok) return;
      const d = await r.json();
      setCriMap(prev => ({ ...prev, [pid]: { cri: d.cri, cri_label: d.cri_label, proactive: d.proactive_message } }));
    } catch {}
  }, [token, criMap]);

  // ── Tier 4: care plan ────────────────────────────────────────────────────────
  const fetchCarePlan = useCallback(async (pid) => {
    if (!pid) return;
    setCarePlanLoading(true);
    try {
      const r = await fetch(`${API}/api/v1/caregiver/care-plan/${pid}`, { headers: authHeaders(token) });
      if (r.ok) setCarePlan(await r.json());
      else setCarePlan(null);
    } catch { setCarePlan(null); }
    finally { setCarePlanLoading(false); }
  }, [token]);

  const doCarePlanTask = async (pid, taskId, action, note = "") => {
    try {
      const r = await fetch(`${API}/api/v1/caregiver/care-plan/${pid}/task/${taskId}/${action}`, {
        method: "POST", headers: authHeaders(token),
        body: JSON.stringify({ note }),
      });
      if (r.ok) fetchCarePlan(pid);
    } catch {}
  };

  // ── Tier 5: burnout + performance ───────────────────────────────────────────
  const fetchBurnout = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/v1/caregiver/burnout-risk`, { headers: authHeaders(token) });
      if (r.ok) setBurnoutData(await r.json());
    } catch {}
  }, [token]);

  const fetchPerfReport = useCallback(async () => {
    setPerfLoading(true);
    try {
      const [bRes, pRes] = await Promise.all([
        fetch(`${API}/api/v1/caregiver/burnout-risk`,  { headers: authHeaders(token) }),
        fetch(`${API}/api/v1/caregiver/performance`,   { headers: authHeaders(token) }),
      ]);
      if (bRes.ok) setBurnoutData(await bRes.json());
      if (pRes.ok) setPerfReport(await pRes.json());
    } catch {}
    finally { setPerfLoading(false); }
  }, [token]);

  // ── Applications ─────────────────────────────────────────────────────────────
  const fetchApplications = useCallback(async () => {
    setAppsLoading(true);
    try {
      const r = await fetch(`${API}/api/v1/cg-apply/incoming`, { headers: authHeaders(token) });
      if (r.ok) setApplications((await r.json()).applications || []);
    } catch { }
    finally { setAppsLoading(false); }
  }, [token]);

  const respondToApplication = async (appId, decision) => {
    setRespondingId(appId);
    try {
      const r = await fetch(`${API}/api/v1/cg-apply/respond/${appId}`, {
        method: "POST", headers: authHeaders(token),
        body: JSON.stringify({ decision, note: respondNote }),
      });
      if (r.ok) {
        await fetchApplications();
        if (decision === "accept") fetchPatients();
        setShowRespondFor(null);
        setRespondNote("");
      }
    } catch { }
    finally { setRespondingId(null); }
  };

  // ── Tier 6: patient outcomes ─────────────────────────────────────────────────
  const fetchOutcome = useCallback(async (pid) => {
    if (!pid || outcomeMap[pid]) return;
    try {
      const r = await fetch(`${API}/api/v1/caregiver/outcomes/${pid}`, { headers: authHeaders(token) });
      if (r.ok) {
        const d = await r.json();
        if (d.has_data) setOutcomeMap(prev => ({ ...prev, [pid]: d }));
      }
    } catch {}
  }, [token, outcomeMap]);

  const fetchCgMessages = useCallback(async () => {
    if (!selectedPid) return;
    try {
      const r = await fetch(`${API}/api/v1/direct-chat/messages?partner_id=${encodeURIComponent(selectedPid)}`, { headers: authHeaders(token) });
      if (!r.ok) return;
      const data = await r.json();
      setCgMessages(prev => {
        const others = prev.filter(x => x.pid !== selectedPid);
        return [...others, { pid: selectedPid, messages: data.messages || [] }];
      });
      setCgUnreadTotal((data.messages || []).filter(m => m.sender_type === "patient" && m.status !== "read").length);
    } catch {}
  }, [token, selectedPid]);

  const markCgRead = useCallback(async () => {
    if (!selectedPid) return;
    try {
      await fetch(`${API}/api/v1/direct-chat/read?partner_id=${encodeURIComponent(selectedPid)}`, { method: "POST", headers: authHeaders(token) });
      setCgUnreadTotal(0);
      await fetchCgMessages();
    } catch {}
  }, [token, selectedPid, fetchCgMessages]);

  const sendCgMessage = async (pid) => {
    const text = (cgMsgInput[pid] || "").trim();
    if (!text) return;
    setCgMsgInput(prev => ({ ...prev, [pid]: "" }));
    setCgMsgSending(prev => ({ ...prev, [pid]: true }));
    const tmpId = `tmp_${Date.now()}`;
    setCgMessages(prev => prev.map(x => x.pid !== pid ? x : {
      ...x, messages: [...x.messages, { id: tmpId, sender_type: "caregiver", text, ts: Date.now() / 1000, status: "sent" }],
    }));
    try {
      const r = await fetch(`${API}/api/v1/direct-chat/send`, {
        method: "POST", headers: authHeaders(token),
        body: JSON.stringify({ text, partner_id: pid }),
      });
      if (!r.ok) throw new Error();
      const data = await r.json();
      setCgMessages(prev => prev.map(x => x.pid !== pid ? x : {
        ...x, messages: x.messages.map(m => m.id === tmpId ? data.message : m),
      }));
    } catch {
      setCgMessages(prev => prev.map(x => x.pid !== pid ? x : {
        ...x, messages: x.messages.map(m => m.id === tmpId ? { ...m, status: "failed" } : m),
      }));
    } finally { setCgMsgSending(prev => ({ ...prev, [pid]: false })); }
  };

  const saveProfile = async () => {
    setProfileSaving(true); setProfileErr(""); setProfileOk(false);
    try {
      const r = await fetch(`${API}/api/v1/caregiver/profile`, {
        method: "PUT", headers: authHeaders(token), body: JSON.stringify(profileForm),
      });
      const d = await r.json();
      if (!r.ok) { setProfileErr(d.detail || "Save failed"); return; }
      setProfileOk(true);
      setTimeout(() => setProfileOk(false), 3000);
    } catch { setProfileErr("Connection error."); }
    finally { setProfileSaving(false); }
  };

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1_000_000) { setProfileErr("Photo must be under 1 MB."); return; }
    const reader = new FileReader();
    reader.onload = ev => setProfileForm(f => ({ ...f, profile_photo: ev.target.result }));
    reader.readAsDataURL(file);
  };

  const handleUpgrade = async (newLimit) => {
    try {
      const r = await fetch(`${API}/api/v1/caregiver/limit`, {
        method: "PUT", headers: authHeaders(token), body: JSON.stringify({ limit: newLimit }),
      });
      if (r.ok) { setCapacity(c => ({ ...c, limit: newLimit })); setShowUpgrade(false); }
    } catch (e) { console.error(e); }
  };

  // ── Helper: attach AMINA message with citations ──────────────────────────────
  const pushAminaMsg = (data, extraFields = {}) => {
    const msg = {
      role:      "amina",
      text:      data.response || data.message || "Sorry, no response.",
      canAlert:  true,
      citations: data.citations || [],
      isNew:     true,
      ...extraFields,
    };
    setChatMsgs(prev => [...prev, msg]);
    return msg;
  };

  // ── Text chat ─────────────────────────────────────────────────────────────────
  const _autoTranslateIfNeeded = async (text) => {
    if (cgLang !== "ma" || !text) return text;
    try {
      const r = await fetch(`${API}/api/v1/agent/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, source: "en", target: "ma" }),
      });
      if (r.ok) {
        const d = await r.json();
        if (d.translated) return d.translated;
      }
    } catch {}
    return text;
  };

  const sendChatRaw = async (msg) => {
    setChatMsgs(prev => [...prev, { role: "user", text: msg }]);
    setChatLoading(true);
    try {
      const r = await fetch(`${API}/api/v1/caregiver/chat`, {
        method: "POST", headers: authHeaders(token),
        body: JSON.stringify({
          message: msg,
          patient_id: selectedPid,
          model_preference: cgModelPref,
          session_id: cgSessionRef.current,
        }),
      });
      const data = await r.json();

      if (data.switched_patient && data.resolved_patient_id && data.resolved_patient_id !== selectedPid) {
        setSelectedPid(data.resolved_patient_id);
        setCgFreedOffset(0);
        const translatedResp = await _autoTranslateIfNeeded(data.response || "No response.");
        setChatMsgs([
          { role: "amina", text: `Switching to ${data.resolved_patient_name || "the patient you asked about"}…`, system: true, isNew: true },
          { role: "amina", text: translatedResp, canAlert: true, citations: data.citations || [], isNew: true, sourceLang: cgLang === "ma" ? "ma" : "en" },
        ]);
        fetchDashboard(); fetchAlerts(); fetchInsights(data.resolved_patient_id);
      } else {
        const translatedResp = await _autoTranslateIfNeeded(data.response || data.message || "Sorry, no response.");
        data.response = translatedResp;
        pushAminaMsg(data, {
          action: data.action || null,
          content_form: data.content_form || null,
          sourceLang: cgLang === "ma" ? "ma" : "en",
        });
      }
    } catch {
      setChatMsgs(prev => [...prev, { role: "amina", text: "Connection error. Please try again." }]);
    } finally { setChatLoading(false); }
  };

  // ── Voice chat ────────────────────────────────────────────────────────────────
  const _pickMime = () => {
    for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"])
      if (window.MediaRecorder?.isTypeSupported?.(t)) return t;
    return "";
  };

  const _playTTS = (base64wav) => {
    if (!base64wav) return;
    try {
      if (ttsAudioRef.current) { ttsAudioRef.current.pause(); ttsAudioRef.current = null; }
      const bytes  = Uint8Array.from(atob(base64wav), c => c.charCodeAt(0));
      const blob   = new Blob([bytes], { type: "audio/wav" });
      const url    = URL.createObjectURL(blob);
      const audio  = new Audio(url);
      ttsAudioRef.current = audio;
      audio.play().catch(() => {});
      audio.onended = () => URL.revokeObjectURL(url);
    } catch {}
  };

  const _submitVoiceBlob = async (blob, mime) => {
    setVoiceProc(true);
    let ext = "bin";
    if ((mime || "").includes("webm")) ext = "webm";
    else if ((mime || "").includes("ogg")) ext = "ogg";

    const form = new FormData();
    form.append("file",       blob, `cg_voice.${ext}`);
    form.append("patient_id", selectedPid || "");
    // token goes in Authorization header (no Content-Type override for multipart)
    try {
      const r = await fetch(`${API}/api/v1/caregiver/voice-chat`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "Voice processing failed");

      // Show transcript as user bubble
      if (data.transcript) {
        setChatMsgs(prev => [...prev, { role: "user", text: data.transcript, isTranscript: true }]);
      }
      // Show AMINA response with citations (auto-translate if Mandinka)
      const voiceResp = await _autoTranslateIfNeeded(data.response || data.message || "");
      if (voiceResp) data.response = voiceResp;
      pushAminaMsg(data, { sourceLang: cgLang === "ma" ? "ma" : "en" });
      // Play TTS
      if (data.has_audio && data.audio_b64) _playTTS(data.audio_b64);

      setVoiceLive("");
    } catch (e) {
      setVoiceErr(e.message || "Voice failed — please try typing instead.");
      setChatMsgs(prev => [...prev, { role: "amina", text: "Couldn't process voice — please try again." }]);
    } finally {
      setVoiceProc(false);
      setChatLoading(false);
    }
  };

  const startVoice = async () => {
    setVoiceErr(""); setVoiceLive("");
    const mime = _pickMime();
    mimeRef.current = mime;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      // Visualiser analyser (optional — just for animation hook)
      const ac  = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = ac;

      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recorderRef.current = rec;
      chunksRef.current   = [];

      rec.ondataavailable = e => { if (e.data?.size > 0) chunksRef.current.push(e.data); };
      rec.onstart  = () => setVoiceRec(true);
      rec.onstop   = async () => {
        setVoiceRec(false);
        setChatLoading(true);
        stream.getTracks().forEach(t => t.stop());
        if (audioCtxRef.current) { audioCtxRef.current.close(); audioCtxRef.current = null; }
        const blob = new Blob(chunksRef.current, { type: mime || "application/octet-stream" });
        await _submitVoiceBlob(blob, mime);
      };
      rec.start(500);
    } catch {
      setVoiceErr("Microphone access denied — please allow microphone in browser settings.");
    }
  };

  const stopVoice = () => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  };

  const stopTTS = () => {
    if (ttsAudioRef.current) { ttsAudioRef.current.pause(); ttsAudioRef.current = null; }
  };

  const sendChat = async () => {
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;
    setChatInput("");
    const intent = detectAlertIntent(msg);
    if (intent && selectedPid) {
      setQuickAlert({ severity: intent.severity, message: msg, chatInsteadMsg: msg });
      return;
    }
    await sendChatRaw(msg);
  };

  // ── Effects ──────────────────────────────────────────────────────────────────

  // Request browser notification permission on first load
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // Close CRI tooltip on outside click (ignore clicks on the CRI trigger spans themselves)
  useEffect(() => {
    if (!criTipOpen) return;
    const handler = (e) => {
      const inPopover = criTipRef.current && criTipRef.current.contains(e.target);
      const onTrigger = e.target.closest("[data-cri-trigger]");
      if (!inPopover && !onTrigger) setCriTipOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [criTipOpen]);

  useEffect(() => {
    fetchPatients().finally(() => setLoading(false));
    fetchPanel();
    fetchBurnout();
    fetchApplications();
  }, [token]);
  useEffect(() => {
    if (!selectedPid) { setLoading(false); return; }
    fetchDashboard(); fetchAlerts(); fetchAlertRules(); fetchInsights(selectedPid);
    fetchPatientCri(selectedPid);
    fetchCarePlan(selectedPid);
    fetchOutcome(selectedPid);
    const iv = setInterval(() => { fetchDashboard(); fetchAlerts(); fetchAlertRules(); }, 60000);
    return () => clearInterval(iv);
  }, [selectedPid]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMsgs]);
  useEffect(() => { cgMsgEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [cgMessages]);
  useEffect(() => {
    if (!selectedPid) return;
    fetchCgMessages();
    const iv = setInterval(fetchCgMessages, 4000);
    return () => clearInterval(iv);
  }, [selectedPid, fetchCgMessages]);

  // Close profile dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (profileDropdownRef.current && !profileDropdownRef.current.contains(e.target)) {
        setProfileDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Load caregiver profile
  useEffect(() => {
    fetch(`${API}/api/v1/caregiver/profile`, { headers: authHeaders(token) })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setProfileForm({ name: d.name || "", bio: d.bio || "", specialization: d.specialization || "", profile_photo: d.profile_photo || "" }); });
  }, [token]);

  const selectedPatient = patients.find(p => p.patient_id === selectedPid);
  const alertCount = alerts.length;
  const unreadCount = cgUnreadTotal;

  // ── Caregiver profile modal ─────────────────────────────────────────────────
  const CgProfileModal = showCgProfile && (
    <ModalShell onClose={() => setShowCgProfile(false)} width={480}>
      <div style={{
        background: "linear-gradient(135deg,#0f172a,#064e3b)",
        padding: "28px 24px 24px",
        borderRadius: "16px 16px 0 0",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
        position: "relative",
      }}>
        <button onClick={() => setShowCgProfile(false)} style={{
          position: "absolute", top: 14, right: 16,
          background: "rgba(255,255,255,.15)", border: "none", color: "#fff",
          borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontSize: 13,
        }}>✕</button>
        <div style={{ position: "relative" }}>
          <Avatar name={profileForm.name || caregiverInfo?.name} photo={profileForm.profile_photo} size={80} />
          <button onClick={() => photoInputRef.current?.click()} style={{
            position: "absolute", bottom: 0, right: 0, width: 26, height: 26,
            borderRadius: "50%", border: "none", background: C.accent, color: "#fff",
            fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          }}>✏</button>
        </div>
        <input ref={photoInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handlePhotoChange} />
        <div style={{ textAlign: "center" }}>
          <div style={{ color: "#fff", fontWeight: 700, fontSize: 17 }}>{profileForm.name || caregiverInfo?.name || "Your Profile"}</div>
          <div style={{ color: "#6ee7b7", fontSize: 13 }}>{profileForm.specialization || "Caregiver"}</div>
        </div>
      </div>
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
        {[
          { lbl: "Full Name", key: "name", type: "input", placeholder: "Your full name" },
          { lbl: "Specialization / Role", key: "specialization", type: "input", placeholder: "e.g. Community Health Worker, Nurse" },
          { lbl: "Bio", key: "bio", type: "textarea", placeholder: "Tell patients about your experience and how you support them." },
        ].map(({ lbl, key, type, placeholder }) => (
          <div key={key}>
            <label style={{ fontSize: 12, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", display: "block", marginBottom: 7 }}>{lbl}</label>
            {type === "textarea"
              ? <textarea value={profileForm[key]} onChange={e => setProfileForm(f => ({ ...f, [key]: e.target.value }))} placeholder={placeholder} rows={3} style={{ ...inp, resize: "vertical" }} />
              : <input value={profileForm[key]} onChange={e => setProfileForm(f => ({ ...f, [key]: e.target.value }))} placeholder={placeholder} style={inp} />
            }
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "10px 14px" }}>
          <span style={{ fontSize: 15 }}>📸</span>
          <span style={{ fontSize: 13, color: C.text, flex: 1 }}>Profile photo shown to patients. <span style={{ color: C.subtle }}>Max 1 MB</span></span>
          <button onClick={() => photoInputRef.current?.click()} style={{ padding: "5px 14px", borderRadius: 7, border: `1.5px solid ${C.accent}`, background: "#fff", color: C.accent, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
            {profileForm.profile_photo ? "Change" : "Upload"}
          </button>
        </div>
        {profileErr && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: C.danger, borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>{profileErr}</div>}
        {profileOk  && <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#15803d", borderRadius: 8, padding: "8px 12px", fontSize: 13, fontWeight: 600 }}>✅ Profile saved!</div>}
        <div style={{ display: "flex", gap: 10 }}>
          <Btn outline onClick={() => setShowCgProfile(false)} style={{ flex: 1 }}>Cancel</Btn>
          <Btn onClick={saveProfile} disabled={profileSaving} style={{ flex: 2 }}>
            {profileSaving ? "Saving…" : "Save Profile"}
          </Btn>
        </div>
      </div>
    </ModalShell>
  );

  // ── Sorted patient list ───────────────────────────────────────────────────────
  const sortedPatients = [...patients].sort((a, b) => {
    const pa = TRIAGE_PRIORITY[a.triage_status] ?? 0;
    const pb = TRIAGE_PRIORITY[b.triage_status] ?? 0;
    if (pb !== pa) return pb - pa;
    // Within same tier, sort by CRI descending
    const ca = criMap[a.patient_id]?.cri ?? 0;
    const cb = criMap[b.patient_id]?.cri ?? 0;
    return cb - ca;
  });

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "system-ui,-apple-system,sans-serif" }}>

      {/* ── Emergency banner ── */}
      {emergencyBanner.length > 0 && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
          background: "linear-gradient(90deg,#b91c1c,#ef4444)",
          color: "#fff", padding: "10px 20px",
          display: "flex", alignItems: "center", gap: 12,
          boxShadow: "0 2px 12px rgba(239,68,68,.5)",
          animation: "slideDown .3s ease",
        }}>
          <span style={{ fontSize: 20, flexShrink: 0 }}>🚨</span>
          <div style={{ flex: 1 }}>
            <span style={{ fontWeight: 800, fontSize: 13, letterSpacing: ".3px" }}>AMINA EMERGENCY ALERT — </span>
            <span style={{ fontSize: 13 }}>
              {emergencyBanner.map(p => p.name).join(", ")}
              {emergencyBanner.length === 1 ? " requires" : " require"} immediate attention. Please respond now.
            </span>
          </div>
          <button
            onClick={() => { setSelectedPid(emergencyBanner[0].patient_id); setTab("summary"); setEmergencyBanner([]); }}
            style={{ background: "rgba(255,255,255,.2)", border: "1px solid rgba(255,255,255,.4)", color: "#fff", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}
          >View Patient</button>
          <button
            onClick={() => setEmergencyBanner([])}
            style={{ background: "none", border: "none", color: "rgba(255,255,255,.8)", fontSize: 18, cursor: "pointer", lineHeight: 1, flexShrink: 0 }}
          >✕</button>
        </div>
      )}

      {/* ── CRI tooltip popup (fixed, clears sidebar overflow clipping) ── */}
      {criTipOpen && (
        <div ref={criTipRef} style={{
          position: "fixed", left: 252, top: 120, width: 240, zIndex: 400,
          background: "#1e293b", border: "1px solid #334155",
          borderRadius: 10, padding: "14px 16px",
          boxShadow: "0 8px 28px rgba(0,0,0,.5)",
        }}>
          <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
            Clinical Risk Index (CRI)
          </div>
          <div style={{ color: "#94a3b8", fontSize: 11, lineHeight: 1.65, marginBottom: 10 }}>
            A 0–100 score calculated by AMINA from vitals, medication adherence,
            consultation history, and social determinants of health (SDOH).
            Higher score = more clinically urgent.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              { range: "85–100", label: "Critical",  color: "#ef4444" },
              { range: "65–84",  label: "High Risk", color: "#f97316" },
              { range: "45–64",  label: "Moderate",  color: "#6366f1" },
              { range: "0–44",   label: "Low Risk",  color: "#10b981" },
            ].map(({ range, label, color }) => (
              <div key={range} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
                <span style={{ color: "#cbd5e1", fontSize: 11 }}>
                  <strong style={{ color }}>{range}</strong> — {label}
                </span>
              </div>
            ))}
          </div>
          <div style={{ color: "#475569", fontSize: 10, marginTop: 10, borderTop: "1px solid #334155", paddingTop: 8 }}>
            Patients ranked by triage level, then CRI within each tier.
          </div>
        </div>
      )}

      {showUpgrade && <UpgradeModal currentLimit={capacity.limit} patientCount={capacity.count} onConfirm={handleUpgrade} onClose={() => setShowUpgrade(false)} />}
      {CgProfileModal}

      {/* ── Sidebar ── */}
      <div style={{
        width: 240, background: C.sidebar, display: "flex", flexDirection: "column",
        flexShrink: 0, position: "sticky", top: 0, height: "100vh", overflowY: "auto",
      }}>
        {/* Logo */}
        <div style={{ padding: "22px 20px 16px", borderBottom: "1px solid rgba(255,255,255,.07)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: "linear-gradient(135deg,#10b981,#059669)",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17,
            }}>🩺</div>
            <div>
              <div style={{ color: "#fff", fontWeight: 800, fontSize: 15 }}>AMINA</div>
              <div style={{ color: "#475569", fontSize: 11 }}>Caregiver Portal</div>
            </div>
          </div>
        </div>

        {/* Patient selector */}
        <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,.07)" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 8 }}>
            Active Patient
          </div>

          {patients.length === 0 ? (
            <div style={{ color: "#64748b", fontSize: 12 }}>No patients yet</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {sortedPatients.map((p, idx) => {
                const active = p.patient_id === selectedPid;
                const tm = TRIAGE_META[p.triage_status] || {};
                const cri = criMap[p.patient_id];
                const criColor = !cri ? "#64748b"
                  : cri.cri >= 85 ? "#ef4444"
                  : cri.cri >= 65 ? "#f97316"
                  : cri.cri >= 45 ? "#6366f1"
                  : "#10b981";
                const isEmergency = p.triage_status === "EMERGENCY";
                const outcome = outcomeMap[p.patient_id];
                const trajIcon = !outcome ? null
                  : outcome.overall_trajectory === "improving"  ? "↑"
                  : outcome.overall_trajectory === "declining"  ? "↓"
                  : outcome.overall_trajectory === "stable"     ? "→"
                  : null;
                const trajColor = !outcome ? null
                  : outcome.overall_trajectory === "improving"  ? "#10b981"
                  : outcome.overall_trajectory === "declining"  ? "#ef4444"
                  : "#94a3b8";
                // Priority divider after last EMERGENCY patient
                const prevTier = idx > 0 ? (TRIAGE_PRIORITY[sortedPatients[idx - 1].triage_status] ?? 0) : null;
                const thisTier = TRIAGE_PRIORITY[p.triage_status] ?? 0;
                const showDivider = idx > 0 && prevTier !== thisTier;
                return (
                  <div key={p.patient_id}>
                    {showDivider && (
                      <div style={{ margin: "4px 0 4px", borderTop: "1px solid rgba(255,255,255,.06)" }} />
                    )}
                    <button onClick={() => { setSelectedPid(p.patient_id); setTab("summary"); setChatMsgs([]); setCgFreedOffset(0); }}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "8px 10px", borderRadius: 8, border: isEmergency ? "1px solid rgba(239,68,68,.35)" : "none",
                        cursor: "pointer",
                        background: active ? "rgba(16,185,129,.18)" : isEmergency ? "rgba(239,68,68,.08)" : "transparent",
                        width: "100%", textAlign: "left", transition: "background .15s",
                      }}
                      onMouseEnter={e => { if (!active) e.currentTarget.style.background = isEmergency ? "rgba(239,68,68,.14)" : C.sidebarHover; }}
                      onMouseLeave={e => { if (!active) e.currentTarget.style.background = isEmergency ? "rgba(239,68,68,.08)" : "transparent"; }}
                    >
                      <div style={{ position: "relative", flexShrink: 0 }}>
                        <Avatar name={p.name} size={30} />
                        {cri && cri.cri >= 65 && (
                          <div style={{
                            position: "absolute", top: -3, right: -3,
                            width: 10, height: 10, borderRadius: "50%",
                            background: criColor, border: "1.5px solid #0f172a",
                            animation: "pulse 1.5s ease-in-out infinite",
                          }} />
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: active ? "#fff" : isEmergency ? "#fca5a5" : "#cbd5e1", fontSize: 13, fontWeight: active || isEmergency ? 600 : 400, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                          {isEmergency && <span style={{ fontSize: 10, marginRight: 4 }}>🚨</span>}
                          {p.name}
                        </div>
                        <div style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 1 }}>
                          {p.triage_status && (
                            <span style={{ fontSize: 10, color: tm.color || "#64748b", fontWeight: 600 }}>{tm.label || p.triage_status}</span>
                          )}
                          {/* CRI pill — click to open explanation popup */}
                          <span
                            data-cri-trigger="1"
                            onClick={e => { e.stopPropagation(); setCriTipOpen(o => !o); }}
                            style={{
                              fontSize: 9, fontWeight: 700, letterSpacing: ".3px",
                              color: criColor,
                              background: `${criColor}22`,
                              border: `1px solid ${criColor}44`,
                              borderRadius: 20, padding: "1px 5px",
                              cursor: "pointer", userSelect: "none",
                            }}
                          >{cri ? `CRI ${cri.cri.toFixed(0)}` : "CRI —"}</span>
                          {trajIcon && (
                            <span style={{ fontSize: 10, color: trajColor, fontWeight: 800 }} title={`Outcome: ${outcome.overall_trajectory}`}>{trajIcon}</span>
                          )}
                        </div>
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: "12px 12px" }}>
          {NAV.map(item => {
            const active = tab === item.id;
            const pendingAppsCount = applications.filter(a => a.status === "pending").length;
            const burnoutBadge = burnoutData && (burnoutData.burnout_label === "critical" || burnoutData.burnout_label === "high");
            const badge = item.id === "alerts" && alertCount > 0 ? alertCount
              : item.id === "messages" && unreadCount > 0 ? unreadCount
              : item.id === "panel" && clusterAlerts.filter(a => a.severity === "emergency").length > 0
                ? clusterAlerts.filter(a => a.severity === "emergency").length
              : item.id === "applications" && pendingAppsCount > 0 ? pendingAppsCount
              : item.id === "wellbeing" && burnoutBadge ? "!"
              : null;
            return (
              <button key={item.id}
                onClick={() => { setTab(item.id); if (item.id === "messages") markCgRead(); if (item.id === "panel") fetchPanel(); if (item.id === "applications") fetchApplications(); if (item.id === "wellbeing") fetchPerfReport(); }}
                style={{
                  display: "flex", alignItems: "center", gap: 10, width: "100%",
                  padding: "9px 12px", borderRadius: 8, border: "none", cursor: "pointer",
                  background: active ? C.sidebarActive : "transparent",
                  marginBottom: 2, transition: "background .15s",
                  borderLeft: active ? `3px solid ${C.accent}` : "3px solid transparent",
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = C.sidebarHover; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = active ? C.sidebarActive : "transparent"; }}
              >
                <span style={{ fontSize: 16, color: active ? C.accent : "#475569", width: 18, textAlign: "center" }}>{item.icon}</span>
                <span style={{ fontSize: 13, color: active ? "#e2e8f0" : "#94a3b8", fontWeight: active ? 600 : 400, flex: 1 }}>
                  {item.label}
                </span>
                {badge && (
                  <span style={{
                    background: item.id === "messages" ? C.accent : C.danger,
                    color: "#fff", borderRadius: 20, fontSize: 10, fontWeight: 700,
                    padding: "1px 7px", minWidth: 18, textAlign: "center",
                  }}>{badge > 99 ? "99+" : badge}</span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Capacity bar */}
        <div style={{ padding: "12px 16px", borderTop: "1px solid rgba(255,255,255,.07)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: "#475569" }}>Patients: {capacity.count}/{capacity.limit}</span>
            <button onClick={() => setShowUpgrade(true)} style={{
              background: "none", border: "none", color: C.accent,
              fontSize: 11, fontWeight: 600, cursor: "pointer",
            }}>Upgrade</button>
          </div>
          <div style={{ height: 4, background: "rgba(255,255,255,.08)", borderRadius: 2 }}>
            <div style={{
              height: "100%", borderRadius: 2, transition: "width .4s",
              width: `${Math.min(100, (capacity.count / capacity.limit) * 100)}%`,
              background: capacity.count / capacity.limit > 0.9 ? C.danger : C.accent,
            }} />
          </div>
        </div>

        {/* Sidebar sign-out — minimal, just an icon at very bottom */}
        <div style={{ padding: "10px 16px", borderTop: "1px solid rgba(255,255,255,.06)" }}>
          <button onClick={onLogout} style={{
            width: "100%", padding: "8px", borderRadius: 7, cursor: "pointer",
            background: "transparent", border: "1px solid rgba(255,255,255,.07)",
            color: "#475569", fontSize: 12, fontWeight: 500, display: "flex",
            alignItems: "center", justifyContent: "center", gap: 7,
            transition: "all .15s",
          }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(239,68,68,.12)"; e.currentTarget.style.color = "#f87171"; e.currentTarget.style.borderColor = "rgba(239,68,68,.2)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#475569"; e.currentTarget.style.borderColor = "rgba(255,255,255,.07)"; }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Sign out
          </button>
        </div>
      </div>

      {/* ── Main area ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: C.bg }}>

        {/* Top bar */}
        <div style={{
          background: "#fff", borderBottom: `1px solid ${C.border}`,
          padding: "0 28px", display: "flex", alignItems: "center", justifyContent: "space-between",
          height: 60, flexShrink: 0,
          boxShadow: "0 1px 0 rgba(0,0,0,.06)",
        }}>
          {/* Left — breadcrumb */}
          <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
            {/* Page section */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 18, color: C.muted, lineHeight: 1 }}>
                {NAV.find(n => n.id === tab)?.icon || "⊞"}
              </span>
              <span style={{ fontSize: 15, fontWeight: 700, color: C.text, letterSpacing: "-.2px" }}>
                {NAV.find(n => n.id === tab)?.label || "Dashboard"}
              </span>
            </div>

            {/* Divider + patient breadcrumb */}
            {summary?.name && (
              <>
                <span style={{ margin: "0 12px", color: C.border, fontSize: 20, lineHeight: 1 }}>›</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Avatar name={summary.name} size={22} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.muted }}>
                    {summary.name}
                  </span>
                  {summary.age && (
                    <span style={{
                      fontSize: 11, color: C.subtle, background: "#f1f5f9",
                      padding: "2px 8px", borderRadius: 20, fontWeight: 500,
                    }}>Age {summary.age}</span>
                  )}
                  {summary.conditions?.slice(0,2).map((c, i) => (
                    <span key={i} style={{
                      fontSize: 11, color: "#92400e", background: "#fffbeb",
                      border: "1px solid #fde68a", padding: "2px 8px", borderRadius: 20, fontWeight: 500,
                    }}>{c}</span>
                  ))}
                </div>
              </>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* Triage pill */}
            {summary?.triage_status && (() => {
              const tm = TRIAGE_META[summary.triage_status] || {};
              return (
                <div style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "4px 12px", borderRadius: 20,
                  background: tm.bg || "#f1f5f9",
                  border: `1px solid ${tm.color}30`,
                }}>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: tm.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: tm.color, letterSpacing: ".3px" }}>
                    {tm.label || summary.triage_status}
                  </span>
                </div>
              );
            })()}

            {/* Remove Patient shortcut — always visible when a patient is selected */}
            {selectedPid && summary?.name && (
              <button
                onClick={() => setShowRemoveModal(true)}
                title="Remove patient from your panel"
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "6px 13px", borderRadius: 8, cursor: "pointer",
                  border: "1.5px solid #fca5a5", background: "#fff5f5",
                  color: "#dc2626", fontWeight: 600, fontSize: 12,
                  transition: "all .15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "#fee2e2"; e.currentTarget.style.borderColor = "#ef4444"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "#fff5f5"; e.currentTarget.style.borderColor = "#fca5a5"; }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <line x1="23" y1="11" x2="17" y2="11"/>
                </svg>
                Remove Patient
              </button>
            )}

            {/* Send Alert button (alerts tab only) */}
            {tab === "alerts" && selectedPid && (
              <button onClick={() => setShowSendAlert(true)} style={{
                display: "flex", alignItems: "center", gap: 7,
                padding: "7px 16px", borderRadius: 8, border: "none",
                background: "#fef2f2", color: C.danger, fontWeight: 600, fontSize: 13,
                cursor: "pointer", transition: "background .15s",
              }}
                onMouseEnter={e => e.currentTarget.style.background = "#fee2e2"}
                onMouseLeave={e => e.currentTarget.style.background = "#fef2f2"}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                Send Alert
              </button>
            )}

            {/* Divider */}
            <div style={{ width: 1, height: 22, background: C.border, margin: "0 2px" }} />

            {/* Profile dropdown trigger */}
            <div ref={profileDropdownRef} style={{ position: "relative" }}>
              <button
                onClick={() => setProfileDropdownOpen(o => !o)}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "5px 8px 5px 5px", borderRadius: 10,
                  border: `1.5px solid ${profileDropdownOpen ? C.accent : "transparent"}`,
                  background: profileDropdownOpen ? "#f0fdf4" : "transparent",
                  cursor: "pointer", transition: "all .15s",
                }}
                onMouseEnter={e => { if (!profileDropdownOpen) { e.currentTarget.style.background = "#f8fafc"; e.currentTarget.style.borderColor = C.border; } }}
                onMouseLeave={e => { if (!profileDropdownOpen) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; } }}
              >
                <div style={{ position: "relative" }}>
                  <Avatar name={profileForm.name || caregiverInfo?.name} photo={profileForm.profile_photo} size={32} />
                  <div style={{ position: "absolute", bottom: 0, right: 0, width: 9, height: 9, borderRadius: "50%", background: "#22c55e", border: "2px solid #fff" }} />
                </div>
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text, lineHeight: 1.3, whiteSpace: "nowrap" }}>
                    {profileForm.name || caregiverInfo?.name || "Caregiver"}
                  </div>
                  <div style={{ fontSize: 11, color: C.muted, lineHeight: 1 }}>
                    {profileForm.specialization || "Caregiver"}
                  </div>
                </div>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2.5" strokeLinecap="round" style={{ marginLeft: 1, transform: profileDropdownOpen ? "rotate(180deg)" : "none", transition: "transform .2s" }}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>

              {/* Dropdown panel */}
              {profileDropdownOpen && (
                <div style={{
                  position: "absolute", top: "calc(100% + 8px)", right: 0,
                  width: 240, background: "#fff", borderRadius: 12,
                  border: `1px solid ${C.border}`,
                  boxShadow: "0 10px 40px rgba(0,0,0,.12)",
                  zIndex: 500, overflow: "hidden",
                }}>
                  {/* Profile info header */}
                  <div style={{
                    padding: "16px 16px 12px",
                    borderBottom: `1px solid ${C.border}`,
                    display: "flex", alignItems: "center", gap: 12,
                  }}>
                    <div style={{ position: "relative" }}>
                      <Avatar name={profileForm.name || caregiverInfo?.name} photo={profileForm.profile_photo} size={44} />
                      <div style={{
                        position: "absolute", bottom: 1, right: 1,
                        width: 10, height: 10, borderRadius: "50%",
                        background: "#22c55e", border: "2px solid #fff",
                      }} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: C.text, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                        {profileForm.name || caregiverInfo?.name || "Caregiver"}
                      </div>
                      <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>
                        {profileForm.specialization || "Healthcare Worker"}
                      </div>
                      {burnoutData && (
                        <div style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          marginTop: 5, padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600,
                          background: burnoutData.burnout_label === "critical" ? "#fee2e2"
                                    : burnoutData.burnout_label === "high"     ? "#fef3c7"
                                    : burnoutData.burnout_label === "moderate" ? "#fef9c3"
                                    : "#f0fdf4",
                          color:     burnoutData.burnout_label === "critical" ? "#dc2626"
                                    : burnoutData.burnout_label === "high"     ? "#d97706"
                                    : burnoutData.burnout_label === "moderate" ? "#ca8a04"
                                    : "#16a34a",
                        }}>
                          <span>{burnoutData.burnout_label === "critical" ? "🔴" : burnoutData.burnout_label === "high" ? "🟠" : burnoutData.burnout_label === "moderate" ? "🟡" : "🟢"}</span>
                          Workload: {burnoutData.burnout_label}
                        </div>
                      )}
                      {profileForm.bio && (
                        <div style={{ fontSize: 11, color: C.subtle, marginTop: 4, lineHeight: 1.4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                          {profileForm.bio}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ padding: "8px 8px" }}>
                    <button onClick={() => { setShowCgProfile(true); setProfileDropdownOpen(false); }} style={{
                      width: "100%", padding: "9px 12px", borderRadius: 8, border: "none",
                      background: "transparent", cursor: "pointer", textAlign: "left",
                      display: "flex", alignItems: "center", gap: 10,
                      color: C.text, fontSize: 13, fontWeight: 500,
                      transition: "background .12s",
                    }}
                      onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <span style={{ fontSize: 16 }}>✏️</span>
                      Edit Profile
                    </button>
                  </div>

                  {/* Sign out */}
                  <div style={{ padding: "0 8px 8px" }}>
                    <div style={{ height: 1, background: C.border, margin: "0 4px 8px" }} />
                    <button onClick={onLogout} style={{
                      width: "100%", padding: "9px 12px", borderRadius: 8, border: "none",
                      background: "transparent", cursor: "pointer", textAlign: "left",
                      display: "flex", alignItems: "center", gap: 10,
                      color: "#ef4444", fontSize: 13, fontWeight: 500,
                      transition: "background .12s",
                    }}
                      onMouseEnter={e => e.currentTarget.style.background = "#fef2f2"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                      Sign out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: 28 }}>

          {/* ── Overview ── */}
          {tab === "summary" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {loading ? (
                <div style={{ textAlign: "center", padding: 80, color: C.subtle }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
                  Loading patient overview…
                </div>
              ) : !summary ? (
                <div style={{ textAlign: "center", padding: 80, color: C.muted }}>
                  {patients.length === 0 ? "No patients linked yet." : "Select a patient from the sidebar."}
                </div>
              ) : (
                <>
                  {/* Vitals row */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16 }}>
                    {[
                      { label: "Blood Pressure", value: summary.latest_bp, color: C.danger },
                      { label: "Blood Glucose",  value: summary.latest_glucose, color: C.warning },
                      { label: "Consultations",  value: summary.recent_consultations?.length || 0, color: C.info },
                      { label: "Active Meds",    value: summary.medications?.length || 0, color: C.accent },
                    ].map(({ label, value, color }) => (
                      <div key={label} style={{
                        background: "#fff", borderRadius: 12, padding: "18px 20px",
                        borderTop: `3px solid ${color}`,
                        boxShadow: "0 1px 3px rgba(0,0,0,.06)",
                      }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 8 }}>{label}</div>
                        <div style={{ fontSize: 24, fontWeight: 800, color: C.text }}>{value || "—"}</div>
                        {summary.last_updated && <div style={{ fontSize: 11, color: C.subtle, marginTop: 4 }}>{timeAgo(summary.last_updated)}</div>}
                      </div>
                    ))}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                    {/* Medications */}
                    <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 14 }}>💊 Active Medications</div>
                      {!summary.medications?.length ? (
                        <div style={{ color: C.subtle, fontSize: 13 }}>None on record</div>
                      ) : (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {summary.medications.map((m, i) => (
                            <span key={i} style={{
                              background: "#f0fdf4", border: "1px solid #bbf7d0",
                              color: "#15803d", borderRadius: 20, padding: "4px 12px", fontSize: 12, fontWeight: 500,
                            }}>{m}</span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Conditions */}
                    <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 14 }}>🩺 Conditions</div>
                      {!summary.conditions?.length ? (
                        <div style={{ color: C.subtle, fontSize: 13 }}>None on record</div>
                      ) : (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {summary.conditions.map((c, i) => (
                            <span key={i} style={{
                              background: "#fffbeb", border: "1px solid #fde68a",
                              color: "#92400e", borderRadius: 20, padding: "4px 12px", fontSize: 12, fontWeight: 500,
                            }}>{c}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Recent consultations */}
                  {summary.recent_consultations?.length > 0 && (
                    <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 16 }}>📋 Recent Consultations</div>
                      {summary.recent_consultations.map((c, i) => {
                        const tm = TRIAGE_META[c.triage_level] || {};
                        return (
                          <div key={i} style={{
                            display: "flex", alignItems: "flex-start", gap: 14,
                            padding: "10px 0", borderBottom: i < summary.recent_consultations.length - 1 ? `1px solid ${C.border}` : "none",
                          }}>
                            <div style={{ width: 8, height: 8, borderRadius: "50%", background: tm.color || C.border, marginTop: 6, flexShrink: 0 }} />
                            <div style={{ flex: 1, fontSize: 13, color: C.text, lineHeight: 1.5 }}>{c.summary || "Consultation"}</div>
                            {c.triage_level && <Badge text={c.triage_level} color={tm.color || C.muted} bg={tm.bg} />}
                            <div style={{ fontSize: 11, color: C.subtle, whiteSpace: "nowrap" }}>{timeAgo(c.started_at)}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Insights ── */}
          {tab === "insights" && (
            <div>
              {insightsLoading ? (
                <div style={{ textAlign: "center", padding: 80, color: C.muted }}>
                  <div style={{ fontSize: 36, marginBottom: 16 }}>🧠</div>
                  Analyzing {summary?.name || "patient"}'s consultations…
                </div>
              ) : !insights ? (
                <div style={{ textAlign: "center", padding: 80, color: C.muted }}>
                  Could not load insights.
                  <button onClick={() => fetchInsights(selectedPid)} style={{
                    display: "block", margin: "14px auto", padding: "8px 20px",
                    borderRadius: 8, border: `1.5px solid ${C.border}`, cursor: "pointer", background: "#fff",
                  }}>Retry</button>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  <div style={{ background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: C.text, marginBottom: 12 }}>
                      AMINA Analysis — Last {insights.total_analyzed} Consultations
                    </div>
                    <p style={{ color: C.muted, lineHeight: 1.7, fontSize: 14, marginBottom: 16 }}>{insights.narrative}</p>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                      {Object.entries(insights.triage_summary || {}).map(([level, count]) => count > 0 && (
                        <span key={level} style={{
                          padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                          background: TRIAGE_META[level]?.bg || "#f1f5f9",
                          color: TRIAGE_META[level]?.color || C.muted,
                        }}>{count}× {level.replace("_", " ")}</span>
                      ))}
                    </div>
                    <div style={{ fontSize: 11, color: C.subtle }}>
                      Generated {new Date(insights.generated_at).toLocaleString()}
                      <button onClick={() => fetchInsights(selectedPid)} style={{ marginLeft: 10, background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 11, fontWeight: 600 }}>Refresh</button>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                    {[
                      { key: "health_trends",       title: "Health Trends",       color: C.accent },
                      { key: "key_symptoms",         title: "Key Symptoms",        color: C.warning },
                      { key: "medication_signals",   title: "Medication Signals",  color: C.info   },
                      { key: "risk_flags",           title: "Risk Flags",          color: C.danger  },
                    ].map(({ key, title, color }) => insights[key]?.length > 0 && (
                      <div key={key} style={{
                        background: "#fff", borderRadius: 12, padding: 20,
                        boxShadow: "0 1px 3px rgba(0,0,0,.06)",
                        borderTop: `3px solid ${color}`,
                      }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color, marginBottom: 12 }}>{title}</div>
                        <ul style={{ margin: 0, paddingLeft: 18, color: C.text, fontSize: 13, lineHeight: 2 }}>
                          {insights[key].map((item, i) => <li key={i}>{item}</li>)}
                        </ul>
                      </div>
                    ))}
                  </div>

                  {insights.recommendations?.length > 0 && (
                    <div style={{ background: "#f0fdf4", borderRadius: 12, padding: 20, border: "1px solid #bbf7d0" }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: "#065f46", marginBottom: 12 }}>✅ Recommendations</div>
                      <ul style={{ margin: 0, paddingLeft: 18, color: C.text, fontSize: 13, lineHeight: 2 }}>
                        {insights.recommendations.map((r, i) => <li key={i}>{r}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Alerts ── */}
          {tab === "alerts" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {showSendAlert && (
                <SendAlertModal patientName={summary?.name} patientId={selectedPid} token={token}
                  onClose={() => setShowSendAlert(false)}
                  onSent={a => { setAlerts(prev => [a, ...prev]); setShowSendAlert(false); }} />
              )}
              {showAddRule && (
                <AddRuleModal patientId={selectedPid} patientName={summary?.name} token={token}
                  onClose={() => setShowAddRule(false)}
                  onCreated={rule => { setAlertRules(prev => [rule, ...prev]); setShowAddRule(false); }} />
              )}

              {/* Automated rules */}
              <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>Automated Rules</div>
                  <Btn onClick={() => setShowAddRule(true)} disabled={!selectedPid} style={{ padding: "7px 14px", fontSize: 12 }}>+ Add Rule</Btn>
                </div>
                {alertRules.length === 0 ? (
                  <div style={{ color: C.subtle, fontSize: 13, padding: "10px 0" }}>No rules yet. Add one to schedule recurring reminders.</div>
                ) : alertRules.map((rule, i) => (
                  <AlertRuleRow key={rule.rule_id} rule={rule} isLast={i === alertRules.length - 1}
                    onDelete={async () => {
                      try {
                        const r = await fetch(`${API}/api/v1/caregiver/alert-rules/${rule.rule_id}`, { method: "DELETE", headers: authHeaders(token) });
                        if (r.ok) setAlertRules(prev => prev.filter(x => x.rule_id !== rule.rule_id));
                      } catch {}
                    }} />
                ))}
              </div>

              {/* Sent log */}
              <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: C.text, marginBottom: 16 }}>Sent Alert Log</div>
                {alerts.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "24px 0", color: C.subtle, fontSize: 13 }}>No alerts sent yet.</div>
                ) : alerts.map((a, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "flex-start", gap: 12,
                    padding: "12px 0", borderBottom: i < alerts.length - 1 ? `1px solid ${C.border}` : "none",
                  }}>
                    <SevBadge severity={a.severity} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, color: C.text, marginBottom: 3 }}>{a.message}</div>
                      <div style={{ fontSize: 11, color: C.subtle }}>
                        {timeAgo(a.created_at || a.sent_at)} · {a.alert_type?.replace(/_/g, " ") || "manual"}
                        {a.telegram_sent && <span style={{ marginLeft: 8, color: C.info }}>✈ Telegram</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Messages ── */}
          {tab === "messages" && (() => {
            const thread = cgMessages.find(x => x.pid === selectedPid)?.messages || [];
            const inputVal = cgMsgInput[selectedPid] || "";
            const busy = cgMsgSending[selectedPid] || false;
            return (
              <div style={{
                background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,.06)",
                display: "flex", flexDirection: "column", height: "calc(100vh - 160px)",
              }}>
                {/* Thread header */}
                <div style={{
                  padding: "14px 20px", borderBottom: `1px solid ${C.border}`,
                  display: "flex", alignItems: "center", gap: 12,
                }}>
                  {selectedPid ? (
                    <>
                      <Avatar name={summary?.name} size={36} />
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{summary?.name || "Patient"}</div>
                        <div style={{ fontSize: 11, color: C.muted }}>Direct message</div>
                      </div>
                      <button onClick={markCgRead} style={{
                        marginLeft: "auto", padding: "5px 12px", borderRadius: 7,
                        border: `1.5px solid ${C.border}`, background: "#fff",
                        color: C.muted, fontSize: 12, cursor: "pointer",
                      }}>Mark read</button>
                    </>
                  ) : (
                    <div style={{ color: C.subtle, fontSize: 13 }}>Select a patient to view messages</div>
                  )}
                </div>

                {/* Messages */}
                <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", background: "#f8fafc" }}>
                  {!selectedPid ? (
                    <div style={{ textAlign: "center", marginTop: 80, color: C.subtle }}>Select a patient first.</div>
                  ) : thread.length === 0 ? (
                    <div style={{ textAlign: "center", marginTop: 80, color: C.subtle }}>
                      <div style={{ fontSize: 36, marginBottom: 12 }}>💬</div>
                      No messages yet. Send one below.
                    </div>
                  ) : thread.map(m => {
                    const isMe = m.sender_type === "caregiver";
                    return (
                      <div key={m.id} style={{ display: "flex", justifyContent: isMe ? "flex-end" : "flex-start", marginBottom: 10 }}>
                        {!isMe && <Avatar name={summary?.name} size={26} />}
                        <div style={{ maxWidth: "68%", marginLeft: isMe ? 0 : 8 }}>
                          <div style={{
                            background: isMe ? C.accent : "#fff",
                            color: isMe ? "#fff" : C.text,
                            padding: "10px 14px", borderRadius: isMe ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                            fontSize: 14, lineHeight: 1.5,
                            boxShadow: "0 1px 3px rgba(0,0,0,.08)",
                            opacity: m.status === "failed" ? 0.6 : 1,
                          }}>{m.text}</div>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: isMe ? "flex-end" : "flex-start", gap: 4, marginTop: 3 }}>
                            <span style={{ fontSize: 10, color: C.subtle }}>{new Date(m.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                            {isMe && (
                              m.status === "read"      ? <span style={{ color: "#53bdeb", fontSize: 12, fontWeight: 700 }}>✓✓</span>
                            : m.status === "delivered" ? <span style={{ color: C.subtle, fontSize: 12 }}>✓✓</span>
                            : m.status === "failed"    ? <span style={{ color: C.danger, fontSize: 12 }}>✗</span>
                            :                            <span style={{ color: C.subtle, fontSize: 12 }}>✓</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={cgMsgEndRef} />
                </div>

                {/* Input */}
                <div style={{ padding: "12px 16px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 10 }}>
                  <input value={inputVal}
                    onChange={e => setCgMsgInput(prev => ({ ...prev, [selectedPid]: e.target.value }))}
                    onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendCgMessage(selectedPid)}
                    placeholder={selectedPid ? `Message ${summary?.name || "patient"}…` : "Select a patient first"}
                    disabled={!selectedPid}
                    style={{ ...inp, borderRadius: 24, flex: 1 }} />
                  <button onClick={() => sendCgMessage(selectedPid)} disabled={!inputVal.trim() || busy || !selectedPid}
                    style={{
                      width: 44, height: 44, borderRadius: "50%", border: "none",
                      background: (inputVal.trim() && !busy && selectedPid) ? C.accent : C.border,
                      color: (inputVal.trim() && !busy && selectedPid) ? "#fff" : C.muted,
                      fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                    }}>{busy ? "…" : "➤"}</button>
                </div>
              </div>
            );
          })()}

          {/* ── Ask AMINA ── */}
          {tab === "chat" && (
            <div style={{
              background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,.06)",
              display: "flex", flexDirection: "column", height: "calc(100vh - 160px)",
            }}>
              {/* ── Chat header ── */}
              <div style={{ borderBottom: `1px solid ${C.border}` }}>
                <div style={{
                  padding: "14px 20px",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{t("ask_amina")}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>Caregiver mode · context-aware clinical assistant</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {/* History toggle */}
                    <button
                      onClick={() => setCgShowHistory(prev => !prev)}
                      title={t("history")}
                      style={{
                        width: 30, height: 30, borderRadius: "50%",
                        border: `1.5px solid ${cgShowHistory ? C.accent : C.border}`,
                        background: cgShowHistory ? "#ecfdf5" : "#fff",
                        color: cgShowHistory ? C.accent : C.muted, cursor: "pointer",
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        transition: "all 150ms ease",
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                      </svg>
                    </button>
                    {/* New chat */}
                    <button
                      onClick={() => {
                        if (chatMsgs.length >= 2) saveChatSession(chatMsgs, summary?.name, cgSessionRef.current);
                        setChatMsgs([]);
                        setCgFreedOffset(0);
                        cgSessionRef.current = `cg_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
                        setCgShowHistory(false);
                      }}
                      title={t("new_chat")}
                      style={{
                        width: 30, height: 30, borderRadius: "50%",
                        border: `1.5px solid ${C.border}`, background: "#fff",
                        color: C.muted, cursor: "pointer",
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        transition: "all 150ms ease",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.accent; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                      </svg>
                    </button>
                    {selectedPid && (
                      <Btn onClick={() => setQuickAlert({ severity: "info", message: "", chatInsteadMsg: null })}
                        outline style={{ padding: "6px 14px", fontSize: 12 }}>
                        🔔 Send Alert
                      </Btn>
                    )}
                    {/* Language toggle */}
                    <div style={{
                      display: "flex", borderRadius: 7, overflow: "hidden",
                      border: `1.5px solid ${C.border}`, height: 30,
                    }}>
                      <button onClick={() => setCgLang("en")} style={{
                        padding: "0 10px", fontSize: 11, fontWeight: cgLang === "en" ? 700 : 500, cursor: "pointer",
                        border: "none", background: cgLang === "en" ? C.accent : "#fff",
                        color: cgLang === "en" ? "#fff" : C.muted, transition: "all .2s",
                      }}>English</button>
                      <button onClick={() => setCgLang("ma")} style={{
                        padding: "0 10px", fontSize: 11, fontWeight: cgLang === "ma" ? 700 : 500, cursor: "pointer",
                        border: "none", borderLeft: `1px solid ${C.border}`,
                        background: cgLang === "ma" ? C.accent : "#fff",
                        color: cgLang === "ma" ? "#fff" : C.muted, transition: "all .2s",
                      }}>Mandinka</button>
                    </div>
                    {/* NKo script toggle */}
                    <button
                      onClick={() => setCgNkoMode(p => !p)}
                      title={cgNkoMode ? "Switch back to Latin script" : "Show Mandinka in N'Ko script (ߒߞߏ)"}
                      style={{
                        width: 30, height: 30, borderRadius: "50%", cursor: "pointer",
                        border: `1.5px solid ${cgNkoMode ? C.accent : C.border}`,
                        background: cgNkoMode ? "rgba(16,185,129,.15)" : "#fff",
                        color: cgNkoMode ? C.accent : C.muted,
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        transition: "all .2s",
                      }}
                    >
                      <span style={{ fontFamily: "Noto Sans NKo, serif", fontSize: 11, fontWeight: 700 }}>ߒߞߏ</span>
                    </button>
                  </div>
                </div>
                {/* ── Model bar ── */}
                {(() => {
                  const cgModels = [
                    { key: "base",    label: "GPT-4o mini",      sub: "OpenAI · General purpose",     color: "#64748b" },
                    { key: "gemini",  label: "Gemini 2.5 Lite",  sub: "Google · Fast & free",          color: "#818cf8" },
                    { key: "groq",    label: "Llama 3.3 70B",    sub: "Groq · Fast open source",      color: "#f59e0b" },
                    { key: "mistral", label: "Mistral 7B",       sub: "Mistral AI · Free tier",       color: "#06b6d4" },
                    { key: "amina",   label: "AMINA LoRA",       sub: "Disabled for maintenance",     color: "#64748b", disabled: true, disabledReason: "AMINA LoRA is disabled for maintenance. The fine-tuned endpoint is offline; use Mistral, Groq, Gemini, or GPT-4o mini in the meantime." },
                  ];
                  const cgActive = cgModels.find(m => m.key === cgModelPref) || cgModels[0];
                  const CG_TOKEN_LIMITS = { amina: 10240, groq: 128000, mistral: 32768, gemini: 1000000, base: 128000 };
                  const cgLimit = CG_TOKEN_LIMITS[cgModelPref] || 128000;
                  const cgRawTokens = chatMsgs.reduce((a, m) => a + Math.ceil((m.text || "").length / 3.5), 0);
                  const cgEstTokens = Math.max(0, cgRawTokens - cgFreedOffset);
                  const cgPct = Math.min(1, cgEstTokens / cgLimit);
                  const cgDanger = cgPct > 0.85;
                  const cgColor = cgDanger ? "#ef4444" : "#f97316";
                  const cgR = 9, cgCx = 13, cgCy = 13;
                  const cgCirc = 2 * Math.PI * cgR;
                  const cgOffset = cgCirc * (1 - cgPct);
                  const cgLabel = { amina: "10K", groq: "128K", mistral: "32K", gemini: "1M", base: "128K" }[cgModelPref] || "128K";
                  const handleCgCompact = async () => {
                    if (cgIsCompacting) return;
                    const KEEP = 4;
                    if (chatMsgs.length <= KEEP) {
                      setCgIsCompacting(true);
                      setCgModelSwitchNotice(
                        `Nothing to compact — only ${chatMsgs.length} message${chatMsgs.length === 1 ? "" : "s"}`,
                      );
                      setTimeout(() => { setCgIsCompacting(false); setCgModelSwitchNotice(""); }, 1800);
                      return;
                    }
                    setCgIsCompacting(true);
                    const head = chatMsgs.slice(0, chatMsgs.length - KEEP);
                    const localFreedTotal = head.reduce((a, m) => a + Math.ceil((m.text || "").length / 3.5), 0);
                    const newlyFreed = Math.max(0, localFreedTotal - cgFreedOffset);
                    if (newlyFreed < 1) {
                      setCgModelSwitchNotice("Already compacted — send more messages first");
                      setTimeout(() => { setCgIsCompacting(false); setCgModelSwitchNotice(""); }, 1800);
                      return;
                    }
                    let serverDropped = null;
                    try {
                      const r = await fetch(
                        `${API}/api/v1/agent/compactor/trigger/${encodeURIComponent(cgSessionRef.current)}`,
                        { method: "POST", credentials: "include", headers: authHeaders(token) },
                      );
                      if (r.ok) {
                        const j = await r.json();
                        serverDropped = Number.isFinite(j.dropped) ? j.dropped : null;
                      }
                    } catch { /* backend unavailable — local estimate is used */ }
                    const droppedMsgs = serverDropped != null ? serverDropped : head.length;
                    setCgFreedOffset(localFreedTotal);
                    setCgCompactToast({ freed: newlyFreed, dropped: droppedMsgs });
                    setTimeout(() => setCgCompactToast(null), 4500);
                    setCgIsCompacting(false);
                  };
                  return (
                    <div style={{
                      padding: "6px 16px 8px",
                      display: "flex", alignItems: "center", gap: 8,
                      borderTop: `1px solid ${C.border}`, background: "#f8fafc",
                    }}>
                      {/* Model dropdown */}
                      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                        <select
                          value={cgModelPref}
                          disabled={chatLoading}
                          onChange={e => {
                            const next = e.target.value;
                            const nextModel = cgModels.find(m => m.key === next);
                            const nextLabel = nextModel?.label || next;
                            // Reject disabled models (e.g. LoRA in maintenance).
                            if (nextModel?.disabled) {
                              setCgModelSwitchNotice(
                                nextModel.disabledReason || `${nextLabel} is currently disabled.`
                              );
                              setTimeout(() => setCgModelSwitchNotice(""), 4500);
                              return;
                            }
                            setCgModelPref(next);
                            localStorage.setItem("CG_MODEL_PREF", next);
                            if (chatMsgs.length > 0) {
                              if (chatMsgs.length >= 2) saveChatSession(chatMsgs, summary?.name, cgSessionRef.current);
                              setChatMsgs([]);
                              setCgFreedOffset(0);
                              cgSessionRef.current = `cg_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
                              setCgModelSwitchNotice(`New chat · ${nextLabel}`);
                              setTimeout(() => setCgModelSwitchNotice(""), 2500);
                            }
                          }}
                          style={{
                            appearance: "none", WebkitAppearance: "none",
                            background: "rgba(255,255,255,0.8)",
                            border: `1px solid ${cgActive.color}44`,
                            borderRadius: 8, padding: "4px 28px 4px 10px",
                            color: cgActive.color, fontSize: 11, fontWeight: 700,
                            fontFamily: "inherit", cursor: "pointer",
                            outline: "none", transition: "all .15s",
                            opacity: chatLoading ? 0.4 : 1,
                            minWidth: 130,
                          }}
                        >
                          {cgModels.map(m => (
                            <option
                              key={m.key}
                              value={m.key}
                              disabled={!!m.disabled}
                              title={m.disabled ? m.disabledReason : undefined}
                            >
                              {m.label}{m.disabled ? " (disabled — maintenance)" : ""}
                            </option>
                          ))}
                        </select>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
                          stroke={cgActive.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                          style={{ position: "absolute", right: 8, pointerEvents: "none", opacity: chatLoading ? 0.4 : 1 }}>
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </div>
                      {/* Sub label */}
                      <span style={{ fontSize: 10, color: C.muted, fontWeight: 500, whiteSpace: "nowrap" }}>{cgActive.sub}</span>
                      {/* Context ring + compact */}
                      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                        <span style={{
                          fontSize: 10, fontWeight: 700, fontFamily: "monospace",
                          color: cgDanger ? "#ef4444" : cgPct > 0 ? "#f97316" : C.muted,
                          transition: "color 0.3s", whiteSpace: "nowrap",
                        }}>
                          {Math.round(cgPct * 100)}%<span style={{ color: "#94a3b8", fontWeight: 500 }}>/{cgLabel}</span>
                        </span>
                        <button
                          onClick={handleCgCompact}
                          disabled={cgIsCompacting}
                          title={`${Math.round(cgPct * 100)}% of ${cgLabel} context used · Click to compact`}
                          style={{
                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                            width: 32, height: 32, borderRadius: "50%",
                            border: "1px solid rgba(249,115,22,0.35)",
                            background: "rgba(249,115,22,0.08)",
                            cursor: cgIsCompacting ? "wait" : "pointer",
                            padding: 0, flexShrink: 0, transition: "background 0.2s, transform 0.15s",
                          }}
                        >
                          <svg width="26" height="26" viewBox="0 0 26 26" style={{
                            display: "block",
                            animation: cgIsCompacting ? "cg-compact-spin 0.9s cubic-bezier(.4,0,.2,1) forwards" : "none",
                          }}>
                            <circle cx={cgCx} cy={cgCy} r={cgR} fill="none" stroke="rgba(249,115,22,0.25)" strokeWidth="2.5"/>
                            <circle cx={cgCx} cy={cgCy} r={cgR} fill="none" stroke={cgColor} strokeWidth="2.5"
                              strokeLinecap="round" strokeDasharray={cgCirc} strokeDashoffset={cgOffset}
                              style={{
                                transform: "rotate(-90deg)", transformOrigin: `${cgCx}px ${cgCy}px`,
                                transition: "stroke-dashoffset 0.5s cubic-bezier(.4,0,.2,1), stroke 0.3s",
                                filter: cgDanger ? "drop-shadow(0 0 4px #ef4444)" : "drop-shadow(0 0 3px #f9731680)",
                              }}
                            />
                            <path d="M14 4l-5 8h4l-1 9 6-10h-4z" fill={cgColor}
                              opacity={cgIsCompacting ? 0.4 : 1} style={{ transition: "opacity .3s" }}/>
                          </svg>
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div style={{ flex: 1, overflowY: "auto", padding: 20, background: "#f8fafc" }}>
                {/* ── Chat History Panel ── */}
                {cgShowHistory && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      marginBottom: 12,
                    }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
                        Chat History
                        <span style={{ fontWeight: 400, color: C.muted, marginLeft: 6, fontSize: 11 }}>
                          {cgChatHistory.length} saved
                        </span>
                      </div>
                      <button onClick={() => setCgShowHistory(false)} style={{
                        background: "none", border: "none", color: C.muted, cursor: "pointer",
                        fontSize: 12, fontWeight: 600, padding: "4px 8px",
                      }}>Back to chat</button>
                    </div>
                    {cgChatHistory.length === 0 && (
                      <div style={{
                        textAlign: "center", color: C.subtle, marginTop: 40, fontSize: 13,
                      }}>
                        <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.5 }}>&#128203;</div>
                        No saved chats yet. Start a conversation and click
                        <strong> + New Chat</strong> to save it here.
                      </div>
                    )}
                    {cgChatHistory.map(record => {
                      const date = new Date(record.ts);
                      const timeStr = date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
                        + " " + date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
                      const modelLabel = { base: "GPT-4o", gemini: "Gemini", groq: "Llama", mistral: "Mistral", amina: "LoRA" }[record.model] || record.model;
                      return (
                        <div key={record.id} style={{
                          display: "flex", alignItems: "center", gap: 12,
                          padding: "12px 14px", borderRadius: 10,
                          background: "#fff", border: `1px solid ${C.border}`,
                          marginBottom: 6, cursor: "pointer",
                          transition: "border-color .15s, box-shadow .15s",
                        }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.boxShadow = "0 2px 8px rgba(16,185,129,.12)"; }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.boxShadow = "none"; }}
                          onClick={() => loadChatRecord(record)}
                        >
                          <div style={{
                            width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                            background: "linear-gradient(135deg,#10b981,#059669)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            color: "#fff", fontSize: 14, fontWeight: 800,
                          }}>
                            {(record.patientName || "?")[0].toUpperCase()}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 2 }}>
                              {record.patientName || "Unknown Patient"}
                            </div>
                            <div style={{
                              fontSize: 12, color: C.muted,
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>
                              {record.preview}
                            </div>
                            <div style={{ fontSize: 10, color: C.subtle, marginTop: 3, display: "flex", gap: 8 }}>
                              <span>{timeStr}</span>
                              <span>{record.msgCount} msgs</span>
                              <span style={{
                                background: "#f1f5f9", borderRadius: 4, padding: "0 5px",
                                fontWeight: 600, fontSize: 9,
                              }}>{modelLabel}</span>
                            </div>
                          </div>
                          <button
                            onClick={e => { e.stopPropagation(); deleteChatRecord(record.id); }}
                            title="Delete this chat"
                            style={{
                              width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                              border: `1px solid transparent`, background: "transparent",
                              color: C.subtle, cursor: "pointer",
                              display: "inline-flex", alignItems: "center", justifyContent: "center",
                              transition: "all 150ms ease",
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = "#fef2f2"; e.currentTarget.style.color = C.danger; e.currentTarget.style.borderColor = "#fca5a5"; }}
                            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.subtle; e.currentTarget.style.borderColor = "transparent"; }}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>
                            </svg>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {!cgShowHistory && <>
                {/* Model switch notice */}
                {cgModelSwitchNotice && (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 7,
                    margin: "0 auto 12px", padding: "6px 14px", borderRadius: 20,
                    background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.15)",
                    color: "#6366f1", fontSize: 11, fontWeight: 600,
                    width: "fit-content", animation: "notice-fade 2.5s ease forwards",
                  }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.09"/></svg>
                    {cgModelSwitchNotice}
                  </div>
                )}
                {/* Compact toast */}
                {cgCompactToast && (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8,
                    margin: "0 auto 12px", padding: "8px 16px", borderRadius: 10,
                    background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)",
                    color: "#059669", fontSize: 12, fontWeight: 600,
                    width: "fit-content", animation: "notice-fade 4s ease forwards",
                  }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                    <div>
                      <span style={{ fontWeight: 700 }}>Context Compacted</span>
                      <span style={{ fontWeight: 500, marginLeft: 6, color: "#047857" }}>
                        Freed ≈{cgCompactToast.freed.toLocaleString()} tokens · {cgCompactToast.dropped} message{cgCompactToast.dropped === 1 ? "" : "s"} compacted
                      </span>
                    </div>
                  </div>
                )}
                {/* Tier 1 — CRI proactive alert banner */}
                {selectedPid && criMap[selectedPid] && criMap[selectedPid].cri >= 65 && (
                  <div style={{
                    display: "flex", alignItems: "flex-start", gap: 10,
                    padding: "10px 14px", borderRadius: 10, marginBottom: 12,
                    background: criMap[selectedPid].cri >= 85 ? "#fef2f2" : "#fffbeb",
                    border: `1px solid ${criMap[selectedPid].cri >= 85 ? "#fca5a5" : "#fcd34d"}`,
                  }}>
                    <span style={{ fontSize: 18, flexShrink: 0 }}>{criMap[selectedPid].cri >= 85 ? "🔴" : "🟡"}</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 12,
                        color: criMap[selectedPid].cri >= 85 ? "#b91c1c" : "#92400e" }}>
                        CRI {criMap[selectedPid].cri.toFixed(0)}/100 — {criMap[selectedPid].cri_label?.toUpperCase()}
                      </div>
                      {criMap[selectedPid].proactive && (
                        <div style={{ fontSize: 12, color: "#374151", marginTop: 2 }}>{criMap[selectedPid].proactive}</div>
                      )}
                    </div>
                  </div>
                )}

                {/* Tier 3 — Cluster outbreak alert banner */}
                {clusterAlerts.filter(a => a.severity === "emergency").length > 0 && (
                  <div style={{
                    display: "flex", alignItems: "flex-start", gap: 10,
                    padding: "10px 14px", borderRadius: 10, marginBottom: 12,
                    background: "#fef2f2", border: "1px solid #fca5a5",
                  }}>
                    <span style={{ fontSize: 18, flexShrink: 0 }}>🚨</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 12, color: "#b91c1c" }}>
                        OUTBREAK ALERT — {clusterAlerts.filter(a => a.severity === "emergency").length} emergency pattern(s) detected in your panel
                      </div>
                      {clusterAlerts.filter(a => a.severity === "emergency").map((a, i) => (
                        <div key={i} style={{ fontSize: 12, color: "#374151", marginTop: 2 }}>
                          {a.confirmed_cases} suspected {a.disease.replace(/_/g, " ")} in {a.region} — {a.action_required}
                        </div>
                      ))}
                      <button onClick={() => setTab("panel")} style={{
                        marginTop: 6, fontSize: 11, color: "#b91c1c", background: "none",
                        border: "none", cursor: "pointer", padding: 0, textDecoration: "underline",
                      }}>View Panel →</button>
                    </div>
                  </div>
                )}

                {chatMsgs.length === 0 && !voiceRec && !voiceProc && (
                  <div style={{ textAlign: "center", color: C.subtle, marginTop: 40 }}>
                    <div style={{ fontSize: 36, marginBottom: 12 }}>✦</div>
                    <div style={{ fontSize: 14, marginBottom: 6 }}>Ask anything about {summary?.name || "the patient"}.</div>
                    <div style={{ fontSize: 12 }}>Type or hold 🎙 to speak · Sources cited from WHO, ADA & clinical guidelines</div>
                  </div>
                )}

                {/* Live voice transcript preview */}
                {(voiceRec || voiceProc) && (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                    background: voiceRec ? "#fff7ed" : "#f0fdf4",
                    border: `1px solid ${voiceRec ? "#fed7aa" : "#bbf7d0"}`,
                    borderRadius: 10, marginBottom: 12,
                  }}>
                    <div style={{
                      width: 10, height: 10, borderRadius: "50%",
                      background: voiceRec ? "#f97316" : "#10b981",
                      animation: "pulse 1s infinite",
                    }} />
                    <span style={{ fontSize: 13, color: voiceRec ? "#9a3412" : "#065f46", flex: 1 }}>
                      {voiceRec ? (voiceLive || "Listening…") : "Processing voice…"}
                    </span>
                    {voiceRec && (
                      <button onClick={stopVoice} style={{
                        background: "#f97316", border: "none", color: "#fff",
                        borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer",
                      }}>Stop</button>
                    )}
                  </div>
                )}

                {chatMsgs.map((m, i) => {
                  const prevUserMsg = m.role === "amina" ? (chatMsgs.slice(0, i).reverse().find(x => x.role === "user")?.text || null) : null;
                  const isContentForm = m.role === "amina" && m.action === "content_form" && m.content_form;
                  const isBriefing   = !isContentForm && m.role === "amina" && m.text && m.text.includes("Clinical Briefing");
                  const wantsCard    = shouldFormatAsCard(m.action, prevUserMsg);
                  const isSuggestion = !isContentForm && !isBriefing && m.role === "amina" && !m.system && m.text && wantsCard && isStructuredResponse(m.text);
                  const isCard       = isBriefing || isSuggestion;
                  const isTranscript = m.isTranscript;
                  const hasMarkdown  = !isCard && !isContentForm && m.role === "amina" && !m.system && m.text && /\*\*|^\s*[-•*]\s|^\s*\d+\.\s/m.test(m.text);
                  return (
                    <div key={i} style={{
                      display: "flex", flexDirection: "column",
                      alignItems: m.role === "user" ? "flex-end" : "flex-start",
                      marginBottom: isCard || isContentForm ? 20 : 14,
                      animation: m.isNew ? "cg-msgUp .3s ease both" : "none",
                    }}>
                      {/* User bubble */}
                      {m.role === "user" && (
                        <div style={{
                          maxWidth: "75%", padding: "11px 15px", borderRadius: 12, fontSize: 14, lineHeight: 1.6,
                          background: C.accent, color: "#fff",
                          borderBottomRightRadius: 3,
                          boxShadow: "0 1px 3px rgba(0,0,0,.08)",
                          display: "flex", alignItems: "flex-start", gap: 7,
                        }}>
                          {isTranscript && <span style={{ fontSize: 12, opacity: .75, flexShrink: 0, marginTop: 2 }}>🎙</span>}
                          <span>{m.text}</span>
                        </div>
                      )}

                      {/* AMINA bubbles */}
                      {m.role === "amina" && (
                        isContentForm ? (
                          <ContentGenForm
                            form={m.content_form}
                            onSubmit={(formData) => {
                              const parts = [];
                              parts.push(`Format: ${formData.format}`);
                              parts.push(`Scope: ${formData.scope}`);
                              if (formData.topics.length) parts.push(`Topics: ${formData.topics.join(", ")}`);
                              parts.push(`Length: ${formData.length}`);
                              if (formData.notes) parts.push(`Notes: ${formData.notes}`);
                              sendChatRaw(`[Content Request] ${parts.join(" | ")}`);
                            }}
                          />
                        ) : isBriefing ? (
                          <>
                            <ClinicalBriefingCard text={m.text} patientName={summary?.name} />
                            {m.citations?.length > 0 && <CitationBar citations={m.citations} />}
                          </>
                        ) : isSuggestion ? (
                          <>
                            <SuggestionCard text={m.text} patientName={summary?.name} />
                            {m.citations?.length > 0 && <CitationBar citations={m.citations} />}
                          </>
                        ) : (
                          <CgAminaBubble text={m.text} isSystem={!!m.system} hasMarkdown={hasMarkdown} isNew={!!m.isNew} lang={cgLang} nkoMode={cgNkoMode} sourceLang={m.sourceLang || "en"} />
                        )
                      )}

                      {/* Alert button — plain bubbles only */}
                      {m.role === "amina" && m.canAlert && selectedPid && !isCard && !isContentForm && (
                        <button onClick={() => setQuickAlert({ severity: "info", message: m.text.slice(0, 400), chatInsteadMsg: null })}
                          style={{
                            marginTop: 4, background: "none", border: `1px solid ${C.border}`,
                            borderRadius: 6, color: C.muted, fontSize: 11, cursor: "pointer",
                            padding: "3px 10px", fontWeight: 500,
                          }}>📢 {t("use_as_alert")}</button>
                      )}
                    </div>
                  );
                })}
                {chatLoading && !voiceProc && <CgTypingDots />}
                <div ref={chatEndRef} />
                </>}
              </div>

              {/* Input area */}
              <div style={{ borderTop: `1px solid ${C.border}` }}>
                {voiceErr && (
                  <div style={{ padding: "8px 16px", fontSize: 12, color: "#b91c1c", background: "#fef2f2", borderBottom: `1px solid ${C.border}` }}>
                    {voiceErr}
                    <button onClick={() => setVoiceErr("")} style={{ marginLeft: 8, background: "none", border: "none", color: "#b91c1c", cursor: "pointer", fontWeight: 700 }}>✕</button>
                  </div>
                )}
                {!quickAlert && selectedPid && (
                  <div style={{ padding: "8px 16px", display: "flex", gap: 6, overflowX: "auto", borderBottom: `1px solid ${C.border}`, scrollbarWidth: "none" }}>
                    <span style={{ fontSize: 11, color: C.subtle, whiteSpace: "nowrap", alignSelf: "center", marginRight: 4 }}>Quick:</span>
                    {ALERT_TEMPLATES.map((t, i) => (
                      <button key={i} onClick={() => setQuickAlert({ severity: t.severity, message: t.message, chatInsteadMsg: null })}
                        style={{
                          whiteSpace: "nowrap", padding: "4px 12px", borderRadius: 20,
                          border: `1.5px solid ${C.border}`, background: "#fafafa",
                          color: C.muted, fontSize: 12, cursor: "pointer", fontWeight: 500,
                        }}>{t.label}</button>
                    ))}
                  </div>
                )}
                {quickAlert && selectedPid && (
                  <div style={{ padding: "12px 16px 0" }}>
                    <QuickAlertPanel patientName={summary?.name} patientId={selectedPid} token={token}
                      initial={{ severity: quickAlert.severity, message: quickAlert.message }}
                      onSent={a => {
                        setAlerts(prev => [a, ...prev]); setQuickAlert(null);
                        setChatMsgs(prev => [...prev, { role: "amina", text: `✅ Alert sent to ${summary?.name || "patient"}: "${a.message?.slice(0, 80)}…"`, canAlert: false }]);
                      }}
                      onChatInstead={quickAlert.chatInsteadMsg ? async () => { const msg = quickAlert.chatInsteadMsg; setQuickAlert(null); await sendChatRaw(msg); } : null}
                      onClose={() => setQuickAlert(null)} />
                  </div>
                )}
                <div style={{ padding: "12px 16px", display: "flex", gap: 8, alignItems: "center" }}>
                  <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && !voiceRec && sendChat()}
                    placeholder={voiceRec ? t("listening") : voiceProc ? t("processing_voice") : quickAlert ? "Quick alert open above…" : t("type_msg")}
                    disabled={voiceRec || voiceProc}
                    style={{ ...inp, flex: 1, opacity: voiceRec || voiceProc ? .5 : 1 }} />

                  {/* Mic button */}
                  <button
                    onMouseDown={startVoice}
                    onMouseUp={stopVoice}
                    onTouchStart={e => { e.preventDefault(); startVoice(); }}
                    onTouchEnd={e => { e.preventDefault(); stopVoice(); }}
                    disabled={voiceProc || chatLoading}
                    title={voiceRec ? "Release to send" : "Hold to speak"}
                    style={{
                      width: 42, height: 42, borderRadius: "50%", border: "none", flexShrink: 0,
                      background: voiceRec ? "#f97316" : voiceProc ? C.border : C.accent,
                      color: "#fff", fontSize: 17, cursor: voiceProc ? "default" : "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      boxShadow: voiceRec ? "0 0 0 4px rgba(249,115,22,.3)" : "none",
                      transition: "all .15s",
                    }}>
                    {voiceProc ? "⟳" : voiceRec ? "⏹" : "🎙"}
                  </button>

                  <Btn onClick={sendChat} disabled={!chatInput.trim() || chatLoading || voiceRec || voiceProc} style={{ padding: "10px 20px" }}>{t("send")}</Btn>
                </div>
              </div>
            </div>
          )}

          {/* ── Patient Info ── */}
          {/* ── Panel view (Tier 3) ── */}
          {tab === "panel" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

              {/* Header row */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 20, color: C.text }}>Patient Panel</div>
                  <div style={{ fontSize: 13, color: C.muted }}>
                    {panelData
                      ? `${panelData.panel_size} patients · ranked by CRI × SDOH × urgency`
                      : "Loading panel intelligence…"}
                  </div>
                </div>
                <button onClick={fetchPanel} disabled={panelLoading} style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "8px 16px",
                  borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff",
                  fontSize: 13, cursor: panelLoading ? "default" : "pointer", color: C.muted,
                }}>
                  {panelLoading ? "Refreshing…" : "↻ Refresh"}
                </button>
              </div>

              {/* Outbreak alert cards */}
              {clusterAlerts.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>Outbreak Signals</div>
                  {clusterAlerts.map((a, i) => {
                    const sev = a.severity === "emergency" ? { bg: "#fef2f2", border: "#fca5a5", color: "#b91c1c", icon: "🚨" }
                             : a.severity === "alert"     ? { bg: "#fffbeb", border: "#fcd34d", color: "#92400e", icon: "⚠" }
                             : { bg: "#f0f9ff", border: "#bae6fd", color: "#0369a1", icon: "ℹ" };
                    return (
                      <div key={i} style={{
                        background: sev.bg, border: `1px solid ${sev.border}`,
                        borderRadius: 10, padding: "12px 16px",
                        display: "flex", gap: 12, alignItems: "flex-start",
                      }}>
                        <span style={{ fontSize: 20, flexShrink: 0 }}>{sev.icon}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: 13, color: sev.color, textTransform: "capitalize" }}>
                            {a.disease.replace(/_/g, " ")} — {a.severity.toUpperCase()}
                          </div>
                          <div style={{ fontSize: 12, color: "#374151", marginTop: 2 }}>
                            {a.confirmed_cases} case(s) · Region: {a.region} · Confidence: {(a.confidence * 100).toFixed(0)}%
                          </div>
                          <div style={{ fontSize: 12, color: "#374151", marginTop: 4 }}>{a.action_required}</div>
                          {a.matched_symptoms?.length > 0 && (
                            <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                              {a.matched_symptoms.map((s, j) => (
                                <span key={j} style={{
                                  fontSize: 10, padding: "2px 8px", borderRadius: 20,
                                  background: `${sev.color}18`, color: sev.color, fontWeight: 600,
                                }}>{s}</span>
                              ))}
                            </div>
                          )}
                          {a.who_reportable && (
                            <div style={{ marginTop: 4, fontSize: 11, color: "#0078d4", fontWeight: 700 }}>
                              WHO REPORTABLE
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Priority queue */}
              {panelLoading && !panelData && (
                <div style={{ textAlign: "center", padding: 60, color: C.subtle }}>Loading panel intelligence…</div>
              )}
              {panelData && (
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 10 }}>Priority Queue</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {panelData.priority_queue?.map((p, i) => {
                      const riskColor = p.composite_score >= 0.7 ? "#ef4444"
                                     : p.composite_score >= 0.5 ? "#f59e0b"
                                     : p.composite_score >= 0.3 ? "#6366f1" : "#10b981";
                      return (
                        <div key={p.patient_id} style={{
                          background: "#fff", borderRadius: 10, padding: "14px 18px",
                          boxShadow: "0 1px 3px rgba(0,0,0,.06)",
                          border: `1px solid ${i === 0 ? riskColor + "40" : C.border}`,
                          display: "flex", gap: 14, alignItems: "flex-start",
                          cursor: "pointer",
                        }}
                          onClick={() => { setSelectedPid(p.patient_id); setTab("summary"); }}
                        >
                          {/* Rank */}
                          <div style={{
                            width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                            background: i === 0 ? riskColor : "#f1f5f9",
                            color: i === 0 ? "#fff" : C.muted,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontWeight: 800, fontSize: 13,
                          }}>{p.rank}</div>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{p.patient_name}</span>
                              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20,
                                background: riskColor + "18", color: riskColor, fontWeight: 700 }}>
                                CRI {p.cri.toFixed(0)}
                              </span>
                              <span style={{ fontSize: 11, color: C.muted }}>
                                {p.region} · SDOH: {p.sdoh_label}
                              </span>
                            </div>
                            <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{p.recommended_action}</div>
                            {p.top_flags?.length > 0 && (
                              <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                                {p.top_flags.map((f, j) => (
                                  <span key={j} style={{
                                    fontSize: 10, padding: "2px 8px", borderRadius: 20,
                                    background: "#fef3c7", color: "#92400e", fontWeight: 500,
                                  }}>{f}</span>
                                ))}
                              </div>
                            )}
                          </div>
                          {/* Composite score bar */}
                          <div style={{ width: 48, flexShrink: 0 }}>
                            <div style={{ fontSize: 18, fontWeight: 800, color: riskColor, textAlign: "right" }}>
                              {(p.composite_score * 100).toFixed(0)}
                            </div>
                            <div style={{ fontSize: 9, color: C.subtle, textAlign: "right" }}>score</div>
                            <div style={{
                              height: 4, borderRadius: 2, background: "#e2e8f0", marginTop: 4,
                            }}>
                              <div style={{
                                height: "100%", borderRadius: 2,
                                width: `${p.composite_score * 100}%`,
                                background: riskColor,
                              }} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Heatmap */}
              {panelData?.heatmap?.length > 0 && (
                <div style={{ background: "#fff", borderRadius: 12, padding: "18px 20px", boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 12 }}>Regional Risk Heatmap</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                    {panelData.heatmap.map((h, i) => {
                      const lvlColor = h.alert_level === "red" ? "#ef4444"
                                     : h.alert_level === "orange" ? "#f59e0b"
                                     : h.alert_level === "yellow" ? "#eab308" : "#10b981";
                      return (
                        <div key={i} style={{
                          flex: "1 1 140px", borderRadius: 10, padding: "12px 14px",
                          background: lvlColor + "12", border: `1px solid ${lvlColor}30`,
                        }}>
                          <div style={{ fontWeight: 700, fontSize: 13, color: lvlColor, textTransform: "capitalize" }}>
                            {h.region}
                          </div>
                          <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
                            {h.patient_count} patient(s) · {h.high_risk_count} high-risk
                          </div>
                          {h.dominant_symptom !== "none" && (
                            <div style={{ fontSize: 11, color: "#374151", marginTop: 2 }}>
                              Top symptom: {h.dominant_symptom}
                            </div>
                          )}
                          <div style={{
                            marginTop: 8, display: "inline-block",
                            fontSize: 10, fontWeight: 700, padding: "2px 8px",
                            borderRadius: 20, background: lvlColor, color: "#fff",
                            textTransform: "uppercase", letterSpacing: ".4px",
                          }}>{h.alert_level}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

            </div>
          )}

          {tab === "profile" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 800 }}>
              {!summary ? (
                <div style={{ textAlign: "center", padding: 80, color: C.subtle }}>
                  {loading ? "Loading…" : "Select a patient from the sidebar."}
                </div>
              ) : (
                <>
                  {/* Identity card */}
                  <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
                    <div style={{
                      background: "linear-gradient(135deg,#0f172a,#064e3b)",
                      padding: "24px 28px", display: "flex", alignItems: "center", gap: 20,
                    }}>
                      <Avatar name={summary.name} size={64} />
                      <div style={{ flex: 1 }}>
                        <div style={{ color: "#fff", fontWeight: 800, fontSize: 22 }}>{summary.name}</div>
                        <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 4 }}>
                          {[summary.age ? `Age ${summary.age}` : null, summary.gender, summary.region].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                      <TriageBadge status={summary.triage_status} />
                      <button
                        onClick={() => setShowRemoveModal(true)}
                        title="Remove this patient from your panel"
                        style={{
                          display: "flex", alignItems: "center", gap: 6,
                          padding: "7px 14px", borderRadius: 8, cursor: "pointer",
                          background: "rgba(239,68,68,.15)", border: "1px solid rgba(239,68,68,.35)",
                          color: "#fca5a5", fontSize: 12, fontWeight: 700,
                          transition: "background .15s", flexShrink: 0,
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = "rgba(239,68,68,.28)"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "rgba(239,68,68,.15)"; }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                          <line x1="17" y1="11" x2="23" y2="11"/>
                        </svg>
                        Remove Patient
                      </button>
                    </div>
                    {(summary.latest_bp || summary.latest_glucose) && (
                      <div style={{ display: "flex", borderTop: `1px solid ${C.border}` }}>
                        {summary.latest_bp && (
                          <div style={{ flex: 1, padding: "16px 24px", borderRight: `1px solid ${C.border}` }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 6 }}>Blood Pressure</div>
                            <div style={{ fontSize: 22, fontWeight: 800, color: C.danger }}>{summary.latest_bp}</div>
                          </div>
                        )}
                        {summary.latest_glucose && (
                          <div style={{ flex: 1, padding: "16px 24px" }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 6 }}>Blood Glucose</div>
                            <div style={{ fontSize: 22, fontWeight: 800, color: C.warning }}>{summary.latest_glucose}</div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                    <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 14 }}>🩺 Conditions</div>
                      {summary.conditions?.length > 0
                        ? <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{summary.conditions.map((c, i) => <span key={i} style={{ background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", borderRadius: 20, padding: "4px 12px", fontSize: 12 }}>{c}</span>)}</div>
                        : <div style={{ color: C.subtle, fontSize: 13 }}>None recorded</div>
                      }
                    </div>
                    <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 14 }}>💊 Medications</div>
                      {summary.medications?.length > 0
                        ? <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{summary.medications.map((m, i) => <span key={i} style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#15803d", borderRadius: 20, padding: "4px 12px", fontSize: 12 }}>{m}</span>)}</div>
                        : <div style={{ color: C.subtle, fontSize: 13 }}>None recorded</div>
                      }
                    </div>
                  </div>

                  {/* ── Tier 4: Care Plan ── */}
                  <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>🗂 Care Plan</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {carePlan && (
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <div style={{ width: 80, height: 5, borderRadius: 10, background: "#e2e8f0", overflow: "hidden" }}>
                              <div style={{ width: `${carePlan.completion_pct || 0}%`, height: "100%", background: carePlan.completion_pct >= 80 ? "#10b981" : carePlan.completion_pct >= 40 ? "#f59e0b" : "#6366f1", borderRadius: 10 }} />
                            </div>
                            <span style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>{(carePlan.completion_pct || 0).toFixed(0)}%</span>
                          </div>
                        )}
                        <button onClick={() => fetchCarePlan(selectedPid)} disabled={carePlanLoading}
                          style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: "#f8fafc", fontSize: 11, cursor: "pointer", color: C.text }}>
                          {carePlanLoading ? "…" : "Refresh"}
                        </button>
                      </div>
                    </div>

                    {carePlanLoading && <div style={{ color: C.subtle, fontSize: 13, textAlign: "center", padding: 20 }}>Loading care plan…</div>}

                    {!carePlanLoading && !carePlan && (
                      <div style={{ color: C.subtle, fontSize: 13, padding: "12px 0" }}>
                        No care plan yet — generate a clinical report in the Ask AMINA tab to create one automatically.
                      </div>
                    )}

                    {!carePlanLoading && carePlan && carePlan.items?.length > 0 && (() => {
                      const priorityOrder = { immediate: 0, urgent: 1, routine: 2 };
                      const sorted = [...carePlan.items].sort((a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3));
                      const overdue = sorted.filter(t => t.status === "overdue");
                      const pending = sorted.filter(t => t.status === "pending");
                      const done    = sorted.filter(t => t.status === "completed" || t.status === "skipped");

                      const TaskRow = ({ item }) => {
                        const prColor = item.priority === "immediate" ? "#ef4444" : item.priority === "urgent" ? "#f59e0b" : "#6366f1";
                        const isOverdue = item.status === "overdue";
                        const isDone    = item.status === "completed" || item.status === "skipped";
                        return (
                          <div style={{
                            display: "flex", alignItems: "flex-start", gap: 10,
                            padding: "10px 0", borderBottom: `1px solid ${C.border}`,
                            opacity: isDone ? 0.55 : 1,
                          }}>
                            <div style={{ paddingTop: 2, flexShrink: 0 }}>
                              {isDone ? (
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round">
                                  <polyline points="20 6 9 17 4 12"/>
                                </svg>
                              ) : (
                                <div style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${isOverdue ? "#ef4444" : C.border}`, background: "transparent" }} />
                              )}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 500, color: C.text, lineHeight: 1.4 }}>{item.description}</div>
                              <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
                                <span style={{ fontSize: 10, fontWeight: 700, color: prColor, background: `${prColor}18`, padding: "1px 6px", borderRadius: 6 }}>
                                  {item.priority}
                                </span>
                                <span style={{ fontSize: 10, color: C.muted }}>{item.category}</span>
                                {item.due_date && (
                                  <span style={{ fontSize: 10, color: isOverdue ? "#ef4444" : C.muted, fontWeight: isOverdue ? 700 : 400 }}>
                                    {isOverdue ? "⚠ overdue · " : "Due "}
                                    {item.due_date}
                                  </span>
                                )}
                                {item.responsible && <span style={{ fontSize: 10, color: C.muted }}>— {item.responsible}</span>}
                              </div>
                            </div>
                            {!isDone && (
                              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                                <button onClick={() => doCarePlanTask(selectedPid, item.task_id, "complete")}
                                  style={{ padding: "3px 8px", borderRadius: 5, border: "1px solid #bbf7d0", background: "#f0fdf4", color: "#16a34a", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
                                  Done
                                </button>
                                <button onClick={() => doCarePlanTask(selectedPid, item.task_id, "skip")}
                                  style={{ padding: "3px 8px", borderRadius: 5, border: `1px solid ${C.border}`, background: "#f8fafc", color: C.muted, fontSize: 11, cursor: "pointer" }}>
                                  Skip
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      };

                      return (
                        <>
                          {overdue.length > 0 && (
                            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 12, color: "#dc2626", fontWeight: 600 }}>
                              ⚠ {overdue.length} overdue task{overdue.length > 1 ? "s" : ""} — attend to these first
                            </div>
                          )}
                          {[...overdue, ...pending].map(item => <TaskRow key={item.task_id} item={item} />)}
                          {done.length > 0 && (
                            <details style={{ marginTop: 8 }}>
                              <summary style={{ fontSize: 12, color: C.muted, cursor: "pointer", userSelect: "none" }}>
                                {done.length} completed / skipped task{done.length > 1 ? "s" : ""}
                              </summary>
                              <div style={{ marginTop: 6 }}>
                                {done.map(item => <TaskRow key={item.task_id} item={item} />)}
                              </div>
                            </details>
                          )}
                        </>
                      );
                    })()}
                  </div>

                  {/* ── Tier 6: Outcome Trajectory ── */}
                  {outcomeMap[selectedPid] && (() => {
                    const out = outcomeMap[selectedPid];
                    const d30 = out.deltas?.find(d => d.days === 30);
                    const traj = out.overall_trajectory;
                    const trajCol = traj === "improving" ? "#10b981" : traj === "declining" ? "#ef4444" : "#6366f1";
                    return (
                      <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 12 }}>📈 Longitudinal Outcome</div>
                        <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
                          <div>
                            <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 4 }}>30-day trajectory</div>
                            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                              <span style={{ fontSize: 26, fontWeight: 800, color: trajCol }}>
                                {traj === "improving" ? "↑" : traj === "declining" ? "↓" : "→"}
                              </span>
                              <span style={{ fontSize: 14, fontWeight: 700, color: trajCol, textTransform: "capitalize" }}>{traj}</span>
                            </div>
                            {d30 && d30.baseline_cri != null && (
                              <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                                {d30.baseline_date} → now: CRI {d30.baseline_cri} → {d30.current_cri}
                                <span style={{ marginLeft: 4, fontWeight: 700, color: trajCol }}>
                                  ({d30.delta > 0 ? "+" : ""}{d30.delta})
                                </span>
                              </div>
                            )}
                          </div>
                          {out.sparkline?.length > 0 && (() => {
                            const pts = out.sparkline;
                            const maxC = Math.max(...pts.map(p => p.cri), 1);
                            const minC = Math.min(...pts.map(p => p.cri));
                            const W = 160, H = 40, PAD = 4;
                            const xStep = (W - PAD * 2) / Math.max(1, pts.length - 1);
                            const yScale = (c) => PAD + (H - PAD * 2) * (1 - (c - minC) / (maxC - minC || 1));
                            const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${PAD + i * xStep},${yScale(p.cri)}`).join(" ");
                            return (
                              <svg width={W} height={H} style={{ overflow: "visible" }}>
                                <polyline points={pts.map((p, i) => `${PAD + i * xStep},${yScale(p.cri)}`).join(" ")}
                                  fill="none" stroke={trajCol} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                {pts.length > 0 && (
                                  <circle cx={PAD + (pts.length - 1) * xStep} cy={yScale(pts[pts.length-1].cri)} r="3" fill={trajCol} />
                                )}
                              </svg>
                            );
                          })()}
                        </div>
                        {out.interpretation && (
                          <div style={{ fontSize: 12, color: C.muted, marginTop: 10, lineHeight: 1.6 }}>{out.interpretation}</div>
                        )}
                        <div style={{ fontSize: 10, color: C.subtle, marginTop: 6 }}>Based on {out.snapshot_count} CRI snapshots · first recorded {out.first_recorded}</div>
                      </div>
                    );
                  })()}

                  {summary.recent_consultations?.length > 0 && (
                    <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 16 }}>📋 Consultation History</div>
                      {summary.recent_consultations.map((c, i) => {
                        const tm = TRIAGE_META[c.triage_level] || {};
                        return (
                          <div key={i} style={{
                            display: "flex", alignItems: "flex-start", gap: 14, padding: "10px 0",
                            borderBottom: i < summary.recent_consultations.length - 1 ? `1px solid ${C.border}` : "none",
                          }}>
                            <div style={{ width: 8, height: 8, borderRadius: "50%", background: tm.color || C.border, marginTop: 6, flexShrink: 0 }} />
                            <div style={{ flex: 1, fontSize: 13, color: C.text }}>{c.summary || "Consultation"}</div>
                            {c.triage_level && <Badge text={c.triage_level} color={tm.color} bg={tm.bg} />}
                            <div style={{ fontSize: 11, color: C.subtle }}>{timeAgo(c.started_at)}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Wellbeing tab (Tier 5) ── */}
          {tab === "wellbeing" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 860 }}>

              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 18, color: C.text }}>My Wellbeing</div>
                  <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>Burnout risk, workload analysis, and 7-day performance — powered by AMINA</div>
                </div>
                <button onClick={fetchPerfReport} disabled={perfLoading}
                  style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", fontSize: 13, cursor: "pointer", color: C.text }}>
                  {perfLoading ? "Loading…" : "Refresh"}
                </button>
              </div>

              {perfLoading && !burnoutData && (
                <div style={{ textAlign: "center", padding: 60, color: C.muted, fontSize: 14 }}>Analysing your workload…</div>
              )}

              {burnoutData && (() => {
                const score = burnoutData.burnout_score ?? 0;
                const label = burnoutData.burnout_label ?? "ok";
                const scoreColor = label === "critical" ? "#ef4444" : label === "high" ? "#f97316" : label === "moderate" ? "#f59e0b" : "#10b981";
                const scoreBg    = label === "critical" ? "#fef2f2" : label === "high" ? "#fff7ed" : label === "moderate" ? "#fffbeb" : "#f0fdf4";
                const SEV_COLORS = { high: "#ef4444", medium: "#f97316", low: "#f59e0b" };

                return (
                  <>
                    {/* ── Burnout score card ── */}
                    <div style={{ background: "#fff", borderRadius: 14, padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,.07)", border: `1px solid ${scoreColor}30` }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 24, flexWrap: "wrap" }}>
                        {/* Score ring */}
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                          <div style={{
                            width: 96, height: 96, borderRadius: "50%",
                            background: `conic-gradient(${scoreColor} ${score * 3.6}deg, #e2e8f0 0deg)`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            boxShadow: `0 0 0 4px #fff, 0 0 0 6px ${scoreColor}40`,
                          }}>
                            <div style={{ width: 72, height: 72, borderRadius: "50%", background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                              <span style={{ fontSize: 22, fontWeight: 900, color: scoreColor, lineHeight: 1 }}>{score}</span>
                              <span style={{ fontSize: 9, color: C.muted, fontWeight: 600, letterSpacing: ".5px" }}>/100</span>
                            </div>
                          </div>
                          <div style={{ marginTop: 10, padding: "3px 12px", borderRadius: 20, background: scoreBg, border: `1px solid ${scoreColor}40` }}>
                            <span style={{ fontSize: 11, fontWeight: 800, color: scoreColor, textTransform: "uppercase", letterSpacing: ".6px" }}>{label}</span>
                          </div>
                        </div>
                        {/* Message + bar */}
                        <div style={{ flex: 1, minWidth: 200 }}>
                          <div style={{ fontWeight: 700, fontSize: 15, color: C.text, marginBottom: 6 }}>Burnout Risk Assessment</div>
                          <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.65, marginBottom: 14 }}>{burnoutData.burnout_message}</div>
                          {/* Score bar */}
                          <div style={{ height: 8, borderRadius: 8, background: "#e2e8f0", overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${score}%`, borderRadius: 8, background: `linear-gradient(90deg, #10b981, ${scoreColor})`, transition: "width .6s ease" }} />
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.subtle, marginTop: 4 }}>
                            <span>Low risk</span><span>Moderate</span><span>High</span><span>Critical</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* ── 7-day performance stats ── */}
                    {perfReport && (
                      <div style={{ background: "#fff", borderRadius: 14, padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,.07)" }}>
                        <div style={{ fontWeight: 700, fontSize: 15, color: C.text, marginBottom: 4 }}>7-Day Performance</div>
                        <div style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>
                          {new Date(perfReport.period_start).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} — {new Date(perfReport.period_end).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                          {[
                            { label: "Patients Managed",  value: perfReport.patients_managed,   icon: "👥" },
                            { label: "Visits Completed",  value: perfReport.visits_completed,   icon: "🏠" },
                            { label: "SOAP Notes",        value: perfReport.soap_notes_created, icon: "📋" },
                            { label: "Care Tasks Done",   value: perfReport.care_tasks_done,    icon: "✅" },
                          ].map(({ label, value, icon }) => (
                            <div key={label} style={{ background: C.bg, borderRadius: 10, padding: "14px 16px", textAlign: "center" }}>
                              <div style={{ fontSize: 20, marginBottom: 6 }}>{icon}</div>
                              <div style={{ fontSize: 24, fontWeight: 800, color: C.text }}>{value ?? "—"}</div>
                              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{label}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ── Caseload + tasks + activity ── */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                      {/* Caseload */}
                      <div style={{ background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,.07)" }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 14 }}>Caseload Complexity</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                          {[
                            { label: "Total Patients",   value: burnoutData.caseload?.total_patients },
                            { label: "High Risk",        value: burnoutData.caseload?.high_risk_count,   color: "#f97316" },
                            { label: "Critical",         value: burnoutData.caseload?.critical_count,    color: "#ef4444" },
                            { label: "Avg CRI Score",    value: burnoutData.caseload?.avg_cri != null ? burnoutData.caseload.avg_cri.toFixed(1) : "—" },
                            { label: "Regions Covered",  value: burnoutData.caseload?.region_spread },
                            { label: "Complexity Score", value: burnoutData.caseload?.complexity_score != null ? `${(burnoutData.caseload.complexity_score * 100).toFixed(0)}%` : "—" },
                          ].map(({ label, value, color }) => (
                            <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ fontSize: 12, color: C.muted }}>{label}</span>
                              <span style={{ fontSize: 13, fontWeight: 700, color: color || C.text }}>{value ?? "—"}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Tasks + Activity */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                        <div style={{ background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,.07)", flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 14 }}>Task Completion</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                            {[
                              { label: "Overdue Tasks",      value: burnoutData.tasks?.overdue_count,       color: burnoutData.tasks?.overdue_count > 0 ? "#ef4444" : null },
                              { label: "Completed (7 days)", value: burnoutData.tasks?.completed_last_7d },
                              { label: "Completion Rate",    value: burnoutData.tasks?.completion_rate_7d != null ? `${(burnoutData.tasks.completion_rate_7d * 100).toFixed(0)}%` : "—" },
                            ].map(({ label, value, color }) => (
                              <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ fontSize: 12, color: C.muted }}>{label}</span>
                                <span style={{ fontSize: 13, fontWeight: 700, color: color || C.text }}>{value ?? "—"}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div style={{ background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,.07)", flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 14 }}>Activity (7 days)</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                            {[
                              { label: "Visits",       value: burnoutData.activity?.visits_last_7d },
                              { label: "SOAP Notes",   value: burnoutData.activity?.soap_notes_last_7d },
                              { label: "Last Active",  value: burnoutData.activity?.last_activity_date || "—" },
                              { label: "Days Inactive",value: burnoutData.activity?.days_since_activity, color: burnoutData.activity?.inactivity_flag ? "#ef4444" : null },
                            ].map(({ label, value, color }) => (
                              <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ fontSize: 12, color: C.muted }}>{label}</span>
                                <span style={{ fontSize: 13, fontWeight: 700, color: color || C.text }}>{value ?? "—"}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* ── Risk factors ── */}
                    {burnoutData.risk_factors?.length > 0 && (
                      <div style={{ background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,.07)" }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 14 }}>Risk Factors</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                          {burnoutData.risk_factors.map((rf, i) => (
                            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 14px", borderRadius: 8, background: C.bg }}>
                              <div style={{ width: 8, height: 8, borderRadius: "50%", background: SEV_COLORS[rf.severity] || C.muted, flexShrink: 0, marginTop: 4 }} />
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{rf.factor}</div>
                                <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{rf.detail}</div>
                              </div>
                              <span style={{ fontSize: 10, fontWeight: 700, color: SEV_COLORS[rf.severity] || C.muted, background: `${SEV_COLORS[rf.severity] || "#94a3b8"}18`, padding: "2px 8px", borderRadius: 20, flexShrink: 0, textTransform: "uppercase" }}>
                                {rf.severity}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ── Recommendations ── */}
                    {burnoutData.recommendations?.length > 0 && (
                      <div style={{ background: "linear-gradient(135deg, #f0fdf4, #ecfdf5)", border: "1px solid #bbf7d0", borderRadius: 14, padding: 20 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: "#065f46", marginBottom: 12 }}>💡 AMINA Recommendations</div>
                        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 7 }}>
                          {burnoutData.recommendations.map((r, i) => (
                            <li key={i} style={{ fontSize: 13, color: "#047857", lineHeight: 1.6 }}>{r}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* ── Performance highlights + improvement areas ── */}
                    {perfReport && (perfReport.highlights?.length > 0 || perfReport.improvement_areas?.length > 0) && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                        {perfReport.highlights?.length > 0 && (
                          <div style={{ background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,.07)" }}>
                            <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 12 }}>🌟 Highlights</div>
                            <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 7 }}>
                              {perfReport.highlights.map((h, i) => (
                                <li key={i} style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>{h}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {perfReport.improvement_areas?.length > 0 && (
                          <div style={{ background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,.07)" }}>
                            <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 12 }}>📈 Areas to Improve</div>
                            <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 7 }}>
                              {perfReport.improvement_areas.map((a, i) => (
                                <li key={i} style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>{a}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}

          {/* ── Applications tab ── */}
          {tab === "applications" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 860 }}>
              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 18, color: C.text }}>Patient Applications</div>
                  <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>Patients who have applied to join your panel via the AMINA directory</div>
                </div>
                <button onClick={fetchApplications} disabled={appsLoading}
                  style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", fontSize: 13, cursor: "pointer", color: C.text }}>
                  {appsLoading ? "Refreshing…" : "Refresh"}
                </button>
              </div>

              {appsLoading && <div style={{ textAlign: "center", color: C.muted, padding: 40 }}>Loading applications…</div>}

              {!appsLoading && applications.length === 0 && (
                <div style={{ background: "#fff", borderRadius: 12, padding: 40, textAlign: "center", boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>◑</div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: C.text, marginBottom: 6 }}>No applications yet</div>
                  <div style={{ fontSize: 13, color: C.muted }}>When patients apply to you via the AMINA caregiver directory, their applications will appear here.</div>
                </div>
              )}

              {applications.map(app => {
                const isPending  = app.status === "pending";
                const isAccepted = app.status === "accepted";
                const isDeclined = app.status === "declined";
                const reviewing  = showRespondFor === app.app_id;

                const statusColor = isAccepted ? "#10b981" : isDeclined ? "#ef4444" : "#6366f1";
                const statusBg    = isAccepted ? "#f0fdf4" : isDeclined ? "#fef2f2" : "#eef2ff";
                const statusLabel = isAccepted ? "Accepted" : isDeclined ? "Declined" : "Pending";

                return (
                  <div key={app.app_id} style={{ background: "#fff", borderRadius: 14, boxShadow: "0 1px 4px rgba(0,0,0,.07)", overflow: "hidden", border: `1px solid ${isPending ? "#c7d2fe" : C.border}` }}>
                    {/* Card header */}
                    <div style={{ padding: "18px 22px", display: "flex", alignItems: "flex-start", gap: 16 }}>
                      <div style={{
                        width: 48, height: 48, borderRadius: 12, flexShrink: 0,
                        background: "linear-gradient(135deg,#6366f1,#818cf8)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: "#fff", fontWeight: 800, fontSize: 18,
                      }}>
                        {(app.patient_full_name || "?").split(" ").map(w => w[0]).join("").slice(0, 2)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                          <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>{app.patient_full_name || "Unknown Patient"}</div>
                          <span style={{
                            fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 20,
                            background: statusBg, color: statusColor,
                          }}>{statusLabel}</span>
                        </div>
                        <div style={{ display: "flex", gap: 12, fontSize: 12, color: C.muted, flexWrap: "wrap" }}>
                          {app.patient_age && <span>Age {app.patient_age}</span>}
                          {app.patient_gender && <span>· {app.patient_gender}</span>}
                          {app.patient_region && <span>· {app.patient_region}</span>}
                          {app.patient_phone && <span>· {app.patient_phone}</span>}
                        </div>
                        <div style={{ fontSize: 11, color: C.subtle, marginTop: 4 }}>
                          Ref: {app.app_id} · Submitted {new Date(app.submitted_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                        </div>
                      </div>
                    </div>

                    {/* Application details */}
                    <div style={{ borderTop: `1px solid ${C.border}`, padding: "14px 22px", display: "flex", flexDirection: "column", gap: 10 }}>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 4 }}>Primary Concern</div>
                        <div style={{ fontSize: 13, color: C.text, lineHeight: 1.6, background: "#f8fafc", borderRadius: 8, padding: "8px 12px" }}>{app.primary_concern || "Not specified"}</div>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 4 }}>Health Conditions</div>
                          <div style={{ fontSize: 13, color: C.text }}>{(app.health_conditions || []).join(", ") || "None declared"}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 4 }}>Current Medications</div>
                          <div style={{ fontSize: 13, color: C.text }}>{(app.current_medications || []).join(", ") || "None declared"}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 4 }}>Preferred Contact</div>
                          <div style={{ fontSize: 13, color: C.text, textTransform: "capitalize" }}>{app.preferred_contact || "—"}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 4 }}>Emergency Contact</div>
                          <div style={{ fontSize: 13, color: C.text }}>{app.emergency_contact_name ? `${app.emergency_contact_name} · ${app.emergency_contact_phone}` : "—"}</div>
                        </div>
                      </div>

                      {app.additional_notes && (
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 4 }}>Additional Notes</div>
                          <div style={{ fontSize: 12, color: C.muted, fontStyle: "italic" }}>{app.additional_notes}</div>
                        </div>
                      )}
                    </div>

                    {/* Action area */}
                    {isPending && (
                      <div style={{ borderTop: `1px solid ${C.border}`, padding: "14px 22px" }}>
                        {reviewing ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                              Response note (optional — sent to patient)
                            </div>
                            <textarea
                              value={respondNote}
                              onChange={e => setRespondNote(e.target.value)}
                              placeholder="e.g. Welcome to my panel — I will contact you within 48 hours to arrange a first visit."
                              rows={2}
                              style={{
                                width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${C.border}`,
                                fontSize: 13, fontFamily: "inherit", resize: "vertical", outline: "none",
                              }}
                            />
                            <div style={{ display: "flex", gap: 8 }}>
                              <button onClick={() => { setShowRespondFor(null); setRespondNote(""); }}
                                style={{ padding: "9px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", fontSize: 13, cursor: "pointer", color: C.text }}>
                                Cancel
                              </button>
                              <button
                                onClick={() => respondToApplication(app.app_id, "decline")}
                                disabled={respondingId === app.app_id}
                                style={{
                                  flex: 1, padding: "9px 0", borderRadius: 8, border: "none",
                                  background: "#fef2f2", color: "#ef4444", fontWeight: 700, fontSize: 13, cursor: "pointer",
                                }}>
                                {respondingId === app.app_id ? "…" : "Decline"}
                              </button>
                              <button
                                onClick={() => respondToApplication(app.app_id, "accept")}
                                disabled={respondingId === app.app_id}
                                style={{
                                  flex: 2, padding: "9px 0", borderRadius: 8, border: "none",
                                  background: "linear-gradient(135deg,#10b981,#34d399)",
                                  color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer",
                                }}>
                                {respondingId === app.app_id ? "Processing…" : "Accept — Add to Panel"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: "flex", gap: 8 }}>
                            <button onClick={() => { setShowRespondFor(app.app_id); setRespondNote(""); }}
                              style={{
                                flex: 1, padding: "10px 0", borderRadius: 8, border: "none",
                                background: "linear-gradient(135deg,#6366f1,#818cf8)",
                                color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer",
                              }}>
                              Review &amp; Respond
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {!isPending && (
                      <div style={{ borderTop: `1px solid ${C.border}`, padding: "10px 22px", fontSize: 12, color: C.muted }}>
                        {isAccepted ? `✓ Accepted — patient added to your panel on ${app.responded_at ? new Date(app.responded_at).toLocaleDateString("en-GB") : "—"}` : `✕ Declined on ${app.responded_at ? new Date(app.responded_at).toLocaleDateString("en-GB") : "—"}`}
                        {app.caregiver_response_note && <span style={{ marginLeft: 8, fontStyle: "italic" }}>"{app.caregiver_response_note}"</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

        </div>
      </div>

      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
        @keyframes slideDown { from { transform: translateY(-100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .4; } }
      `}</style>

      {/* Remove Patient Modal */}
      {showRemoveModal && selectedPid && (
        <RemovePatientModal
          patient={{
            patient_id: selectedPid,
            id: selectedPid,
            name:   summary?.name   || "",
            age:    summary?.age    || "",
            gender: summary?.gender || "",
            region: summary?.region || "",
          }}
          caregiverInfo={caregiverInfo}
          token={token}
          onClose={() => setShowRemoveModal(false)}
          onConfirmed={() => {
            setShowRemoveModal(false);
            // Refresh patient list after confirmed removal
            fetchPatients();
            setSelectedPid(null);
            setSummary(null);
          }}
        />
      )}
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────────

export default function CaregiverPortal({ onLogout: notifyParentLogout } = {}) {
  const [token, setToken]           = useState(() => localStorage.getItem("cg_token") || "");
  const [caregiverInfo, setCaregiverInfo] = useState(() => {
    try { return JSON.parse(localStorage.getItem("cg_info") || "null"); } catch { return null; }
  });

  const handleLogin = (token, info) => {
    localStorage.setItem("cg_token", token);
    localStorage.setItem("cg_info", JSON.stringify(info));
    setToken(token); setCaregiverInfo(info);
  };

  const handleLogout = () => {
    localStorage.removeItem("cg_token");
    localStorage.removeItem("cg_info");
    setToken(""); setCaregiverInfo(null);
    if (notifyParentLogout) notifyParentLogout();
  };

  if (!token) return <LoginScreen onLogin={handleLogin} />;
  return <Dashboard token={token} caregiverInfo={caregiverInfo} onLogout={handleLogout} />;
}
