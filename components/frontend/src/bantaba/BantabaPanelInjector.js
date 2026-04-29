/**
 * BantabaPanelInjector — polish the read-only Bantaba details panel.
 *
 * App.jsx renders a small details modal when activePanel === "bantaba"
 * with:
 *   • the three stat chips (Adherence / On track / Need support)
 *   • a MEMBERS · N heading
 *   • a member list with avatars + conditions + adherence pills
 *
 * The screenshot the user shared showed this exact panel. We rewrite
 * its members list (grouped by flag, progress bars, owner badge, "you"
 * indicator for the signed-in patient) + swap in per-patient circle
 * data so everyone sees THEIR own circle when the role is patient.
 *
 * Pure DOM mutation — no React coupling, no App.jsx changes.
 */

import { getBantaba, getMyBantaba } from "./bantabaApi.js";


const POLL_MS = 250;
const MARKER  = "data-amina-bantaba-version";
const MEMBERS_BLOCK_CLASS = "amina-bantaba-members-block";


function _readRole() {
  try { return localStorage.getItem("AMINA_ROLE") || "patient"; }
  catch { return "patient"; }
}


function _readPatientName() {
  try {
    const raw = localStorage.getItem("AMINA_PATIENT");
    if (raw) {
      const p = JSON.parse(raw);
      if (p && p.name) return String(p.name);
    }
  } catch { /* noop */ }
  return "";
}


function _esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


function _avatarColor(name) {
  let h = 0;
  for (const c of String(name || "?")) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h}, 62%, 48%)`;
}


function _findPanel() {
  // We fingerprint the panel by looking for a ".plan-modal" that
  // contains a stat block labeled "ADHERENCE" (unique to the Bantaba
  // details modal in App.jsx ~line 3568).
  const modals = document.querySelectorAll(".plan-modal");
  for (const m of modals) {
    const txt = m.textContent || "";
    if (/ADHERENCE/.test(txt) && /ON TRACK/.test(txt) && /NEED SUPPORT/.test(txt)) {
      return m;
    }
  }
  return null;
}


function _groupMembers(members) {
  const onTrack = [], watch = [], support = [];
  for (const m of members) {
    const wk = Number(m.adherence_week ?? 0);
    const tg = Number(m.adherence_target ?? 7) || 7;
    const pct = tg ? wk / tg : 0;
    if (pct >= 0.85)      onTrack.push(m);
    else if (pct >= 0.60) watch.push(m);
    else                  support.push(m);
  }
  return { onTrack, watch, support };
}


function _renderMember(m, selfName) {
  const wk  = Number(m.adherence_week ?? 0);
  const tg  = Number(m.adherence_target ?? 7) || 7;
  const pct = Math.round(100 * Math.min(wk, tg) / tg);
  const color = pct >= 85 ? "#6ee7b7"
              : pct >= 60 ? "#fcd34d"
                          : "#fca5a5";
  const bg = pct >= 85 ? "rgba(16,185,129,0.14)"
           : pct >= 60 ? "rgba(234,179,8,0.14)"
                       : "rgba(248,113,113,0.14)";
  const isOwner = !!m.is_owner;
  const isSelf = selfName && (m.name || "").trim().toLowerCase() === selfName;
  const border = isSelf
    ? "1px solid rgba(129, 140, 248, 0.55)"
    : "1px solid rgba(148, 163, 184, 0.18)";
  const cardBg = isSelf
    ? "rgba(99, 102, 241, 0.10)"
    : "rgba(30, 41, 59, 0.55)";

  return `
    <div style="
      padding: 10px 12px; background:${cardBg}; border:${border};
      border-radius:10px; margin-bottom:6px;
      display:flex; align-items:center; gap:10px;
    ">
      <div style="
        width:30px; height:30px; border-radius:50%;
        background:${_avatarColor(m.name)}; color:#fff;
        font-weight:700; font-size:12px;
        display:flex; align-items:center; justify-content:center;
        flex-shrink:0;
      ">${_esc((m.name || "?")[0]?.toUpperCase())}</div>
      <div style="flex:1; min-width:0;">
        <div style="font-weight:700; color:#f1f5f9; font-size:13px;
                    display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
          <span>${_esc(m.name || "(unnamed)")}</span>${m.age ? `<span style="color:#94a3b8; font-weight:500;">, ${m.age}</span>` : ""}
          ${isOwner ? `<span style="
            font-size:9px; padding:2px 6px; border-radius:999px;
            background: rgba(99, 102, 241, 0.25); color:#c7d2fe;
            border:1px solid rgba(129, 140, 248, 0.45);
            font-weight:700; letter-spacing:0.3px; text-transform:uppercase;
          ">Owner</span>` : ""}
          ${isSelf ? `<span style="
            font-size:9px; padding:2px 6px; border-radius:999px;
            background: rgba(129, 140, 248, 0.30); color:#e0e7ff;
            font-weight:700; letter-spacing:0.3px; text-transform:uppercase;
          ">You</span>` : ""}
        </div>
        ${(m.conditions || []).length > 0
          ? `<div style="color:#cbd5e1; font-size:11px; margin-top:2px;">${_esc((m.conditions || []).join(" · "))}</div>`
          : `<div style="color:#64748b; font-size:11px; font-style:italic; margin-top:2px;">no conditions recorded</div>`
        }
        <div style="height:4px; margin-top:6px;
                    background:rgba(148,163,184,0.18);
                    border-radius:999px; overflow:hidden;">
          <div style="height:100%; width:${pct}%; background:${color};"></div>
        </div>
      </div>
      <div style="
        padding: 3px 10px; border-radius: 999px;
        background:${bg}; color:${color}; border:1px solid ${color}55;
        font-size:11px; font-weight:700; letter-spacing:0.3px;
        white-space:nowrap;
      ">${wk}/${tg}</div>
    </div>
  `;
}


function _renderGroup(title, members, tint, selfName) {
  if (!members.length) return "";
  return `
    <div style="margin-top:10px;">
      <div style="
        color:${tint}; font-size:10px; font-weight:700;
        letter-spacing:0.4px; text-transform:uppercase;
        margin-bottom:5px;
      ">${title} · ${members.length}</div>
      ${members.map((m) => _renderMember(m, selfName)).join("")}
    </div>
  `;
}


function _ensureRedesignedMembers(panel, data, selfName) {
  // Rather than mutate App.jsx's existing structure, we INSERT a
  // redesigned members block as a sibling and hide the original so the
  // panel looks like a professionally rebuilt piece.
  const body = panel.querySelector(".plan-modal-body");
  if (!body) return;

  const members = data.members || [];
  const { onTrack, watch, support } = _groupMembers(members);

  let block = body.querySelector(`.${MEMBERS_BLOCK_CLASS}`);
  if (!block) {
    block = document.createElement("div");
    block.className = MEMBERS_BLOCK_CLASS;
    block.setAttribute("data-amina", "bantaba-members");
    // Insert after the stats/badge row — look for the "MEMBERS · N"
    // legacy heading and place ourselves there, hiding the legacy list.
    const labelNode = Array.from(body.querySelectorAll("span, div"))
      .find((el) => /MEMBERS\s*·\s*\d+/i.test((el.textContent || "").trim()));
    const anchor = labelNode ? labelNode.closest(".plan-block") || labelNode : body.firstChild;
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(block, anchor.nextSibling);
    } else {
      body.appendChild(block);
    }
    // Hide the legacy members list (it lives between the count label
    // and the "This week" highlight). We walk siblings and hide any
    // `.plan-member` or `.bantaba-member` nodes.
    body.querySelectorAll(".plan-member, .bantaba-member").forEach((n) => {
      n.style.display = "none";
    });
    // Also hide the legacy "MEMBERS · N" label if we found one.
    if (labelNode) labelNode.style.display = "none";
  }

  block.innerHTML = `
    <div style="
      display:flex; align-items:center; gap:8px;
      margin-bottom:8px;
    ">
      <span style="
        font-size:11px; font-weight:700; letter-spacing:0.4px;
        color:#e0e7ff; text-transform:uppercase;
        padding:3px 10px; border-radius:999px;
        background: rgba(99, 102, 241, 0.20);
        border:1px solid rgba(129, 140, 248, 0.45);
      ">Members · ${members.length}</span>
      ${data.owner_name
        ? `<span style="color:#94a3b8; font-size:11px;">
             Owner: <b style="color:#e2e8f0;">${_esc(data.owner_name)}</b>
           </span>`
        : ""}
    </div>
    ${_renderGroup("On track",      onTrack, "#6ee7b7", selfName)}
    ${_renderGroup("Watch",         watch,   "#fcd34d", selfName)}
    ${_renderGroup("Needs support", support, "#fca5a5", selfName)}
  `;
}


let _lastVer = null;

async function _scan(force = false) {
  const panel = _findPanel();
  if (!panel) { _lastVer = null; return; }

  const role  = _readRole();
  const mySub = (() => {
    try {
      const raw = localStorage.getItem("AMINA_PATIENT");
      if (raw) return JSON.parse(raw)?.id || "";
    } catch { /* noop */ }
    return "";
  })();

  // Patient sees their own circle. Alkalo/admin/others see the circle
  // the panel was opened against (the default shared one for demo).
  let data;
  try {
    if (role === "patient" && mySub) {
      data = await getMyBantaba();
    } else {
      data = await getBantaba("default");
    }
  } catch (err) {
    if (role === "patient" && mySub) {
      const pname = _readPatientName() || "You";
      data = {
        circle_id: mySub, name: `${pname}'s Circle`,
        owner_name: pname, members: [{ id: "m1", name: pname,
          age: 0, conditions: [], adherence_week: 0,
          adherence_target: 7, is_owner: true }],
      };
    } else {
      return;
    }
  }

  const sig = `${data.circle_id || ""}|${(data.members || []).map((m) =>
    `${m.id}:${m.adherence_week}:${m.name}`).join(",")}|${data.name}`;
  if (!force && sig === _lastVer) return;
  _lastVer = sig;

  const selfName = _readPatientName().trim().toLowerCase();
  _ensureRedesignedMembers(panel, data, selfName);
  panel.setAttribute(MARKER, sig);
}


function install() {
  if (typeof window === "undefined") return;
  if (window.__aminaBantabaInjectorInstalled) return;
  window.__aminaBantabaInjectorInstalled = true;

  setInterval(() => _scan(false), POLL_MS);

  window.addEventListener("amina:bantaba-updated", () => {
    _lastVer = null;
    _scan(true);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") _scan(true);
  });
}


install();
