/**
 * VillagePanelInjector — professional upgrade of the read-only Village
 * details panel rendered by App.jsx (`activePanel === "village"`,
 * lines ~3599-3639).
 *
 * What this does:
 *   1. Detects when the Village details modal is mounted (via the
 *      panel's headline "Village Scoreboard" + known class markers).
 *   2. Rewrites each pillar row with a coloured icon, coloured progress
 *      bar, and a zone tag (green ≥80%, amber 50-79%, red <50%). The
 *      legacy plain-text detail stays but gets styled.
 *   3. Appends an "Alkalo Notes" section showing every recorded note
 *      (the backend stores up to 10 — currently invisible in the UI).
 *   4. Re-runs on `amina:village-updated` events (fired by
 *      VillageManagerModal after every save) and on tab-return via
 *      visibilitychange.
 *
 * Purely DOM-level — no React coupling, no App.jsx edits.
 */

import { getVillage } from "./villageApi.js";


const POLL_MS    = 250;
const MARKER     = "data-amina-village-version";
const NOTES_CLASS = "amina-village-notes-injected";


const PILLAR_META = {
  screening: { icon: "🩺", accent: "#38bdf8" },
  adherence: { icon: "💊", accent: "#a78bfa" },
  diet:      { icon: "🥗", accent: "#4ade80" },
  youth:     { icon: "🏅", accent: "#fbbf24" },
  emergency: { icon: "🚑", accent: "#f87171" },
};
const FALLBACK = { icon: "⭐", accent: "#94a3b8" };


function _esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


function _zone(pct) {
  if (pct >= 80) return { color: "#6ee7b7", label: "Strong" };
  if (pct >= 50) return { color: "#fcd34d", label: "Watch" };
  return              { color: "#fca5a5", label: "At risk" };
}


function _findPanel() {
  // The village details modal is one of several .plan-modal panels.
  // We target it by a heading that mentions "Village" (App.jsx renders
  // the village name as the headline). Scope the query tightly so we
  // don't accidentally poke other open panels.
  const modals = document.querySelectorAll(".plan-modal");
  for (const m of modals) {
    const head = m.querySelector(".plan-modal-headline");
    if (!head) continue;
    const txt = (head.textContent || "").trim();
    // Headlines in App.jsx for this modal look like "Kerewan · North Bank" etc.
    // We infer by checking the body for the ".panel-pillar" className — a
    // class only used in the village details panel.
    if (m.querySelector(".panel-pillar")) {
      return m;
    }
  }
  return null;
}


function _rewritePillars(panel, pillars) {
  const rows = panel.querySelectorAll(".panel-pillar");
  rows.forEach((row) => {
    // Try to find the pillar this row represents by matching its
    // displayed name against the data we got from the API.
    const nameEl = row.querySelector(".panel-pillar-name");
    const text = (nameEl?.textContent || "").trim().toLowerCase();
    const match = pillars.find((p) => (p.name || "").toLowerCase() === text);
    if (!match) return;
    const meta = PILLAR_META[match.id] || FALLBACK;
    const max  = match.max || 20;
    const pct  = Math.round(100 * (match.score ?? 0) / max);
    const zone = _zone(pct);

    // Skip if already injected for this version.
    if (row.getAttribute(MARKER) === `${match.score}.${max}.${(match.detail || "").length}`) return;
    row.setAttribute(MARKER, `${match.score}.${max}.${(match.detail || "").length}`);

    row.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px;">
        <div style="
          width:30px; height:30px; border-radius:8px;
          background:${meta.accent}22;
          border:1px solid ${meta.accent}55;
          display:flex; align-items:center; justify-content:center;
          font-size:15px; flex-shrink:0;
        ">${meta.icon}</div>
        <div style="flex:1; min-width:0;">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:6px;">
            <span class="panel-pillar-name" style="font-weight:700; color:#f1f5f9; font-size:13px;">${_esc(match.name)}</span>
            <span style="font-size:11px; color:${zone.color}; font-weight:700;
                         text-transform:uppercase; letter-spacing:0.3px;">
              ${zone.label} · ${pct}%
            </span>
          </div>
          <div style="height:5px; background:rgba(148,163,184,0.18);
                      border-radius:999px; overflow:hidden; margin-top:4px;">
            <div style="height:100%; width:${pct}%; background:${meta.accent};"></div>
          </div>
          ${match.detail
            ? `<div style="color:#cbd5e1; font-size:12px; line-height:1.5; margin-top:6px;">${_esc(match.detail)}</div>`
            : ""}
          <div style="color:#64748b; font-size:11px; margin-top:3px;">
            Score: <b style="color:#e2e8f0;">${match.score ?? 0} / ${max}</b>
          </div>
        </div>
      </div>
    `;
  });
}


function _ensureNotesSection(panel, notes) {
  const body = panel.querySelector(".plan-modal-body");
  if (!body) return;

  let section = body.querySelector(`.${NOTES_CLASS}`);
  if (!section) {
    section = document.createElement("div");
    section.className = `${NOTES_CLASS} plan-block`;
    body.appendChild(section);
  }

  if (!notes || notes.length === 0) {
    section.innerHTML = `
      <div class="plan-block-head plan-head-nudge">📝 Alkalo Notes</div>
      <div class="panel-rowblock" style="color:#94a3b8; font-size:12px;">
        No alkalo observations recorded yet.
      </div>
    `;
    return;
  }

  const tiles = notes.slice().reverse().map((n) => `
    <div style="
      padding:10px 12px;
      background: rgba(30, 41, 59, 0.55);
      border: 1px solid rgba(148, 163, 184, 0.18);
      border-radius:10px;
      margin-bottom:8px;
    ">
      <div style="color:#e2e8f0; font-size:12px; line-height:1.5;">${_esc(n.note || "")}</div>
      ${n.at ? `<div style="color:#64748b; font-size:10px; margin-top:4px;">
        ${_esc(new Date(n.at).toLocaleString([], { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" }))}
      </div>` : ""}
    </div>
  `).join("");

  section.innerHTML = `
    <div class="plan-block-head plan-head-nudge">📝 Alkalo Notes</div>
    <div class="panel-rowblock">
      ${tiles}
      <div style="color:#64748b; font-size:11px; margin-top:6px; text-align:right;">
        ${notes.length} of 10 notes
      </div>
    </div>
  `;
}


let _lastVer = null;

async function _scan(force = false) {
  const panel = _findPanel();
  if (!panel) {
    _lastVer = null; // panel not visible — reset so re-open reloads
    return;
  }

  let data;
  try { data = await getVillage(); }
  catch { return; }

  // Version: pillar-score signature + notes count
  const sig = (data.pillars || [])
    .map((p) => `${p.id}:${p.score}`).join(",")
    + `|notes:${(data.alkalo_notes || []).length}`;
  if (!force && sig === _lastVer) return;
  _lastVer = sig;

  _rewritePillars(panel, data.pillars || []);
  _ensureNotesSection(panel, data.alkalo_notes || []);
}


function install() {
  if (typeof window === "undefined") return;
  if (window.__aminaVillageInjectorInstalled) return;
  window.__aminaVillageInjectorInstalled = true;

  setInterval(() => _scan(false), POLL_MS);

  window.addEventListener("amina:village-updated", () => {
    _lastVer = null;
    _scan(true);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") _scan(true);
  });
}


install();
