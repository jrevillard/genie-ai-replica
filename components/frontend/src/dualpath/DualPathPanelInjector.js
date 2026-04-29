/**
 * DualPathPanelInjector — rewrite the Dual-Path Care side panel with
 * multi-entry ledger data.
 * ======================================================================
 *
 * Panel layout in App.jsx (~3745-3784):
 *   .plan-head-diet      (🌿 Traditional Path)  + .panel-rowblock
 *   .plan-head-meds      (🏥 Modern Path)        + .panel-rowblock
 *   .plan-summary        (✓ Bitter leaf tea ...)                ← Interaction
 *   .plan-head-priority  (Next Step)            + .panel-rowblock
 *   .plan-head-goals     (Medicine Supply)      + .panel-rowblock  (separate injector)
 *
 * We rewrite Traditional + Modern .panel-rowblocks to show all ledger
 * entries for each type, and append new synthetic "Interaction Log" and
 * "Progress Log" sections right after the Modern block so the full
 * ledger is visible without touching App.jsx. The legacy Interaction
 * plan-summary line is replaced with a richer tiled list.
 *
 * Trigger
 * -------
 * - 250ms polling (same cadence as SupplyPanelInjector).
 * - `amina:dualpath-updated` custom event from DualPathLedgerModal
 *   after every add/patch/delete — forces an immediate refresh.
 * - visibilitychange (tab return).
 */

import { listAllDualpath } from "./dualpathLedgerApi.js";


const POLL_MS     = 250;
const MARKER_ATTR = "data-amina-dualpath-version";
const INJECT_BODY = "amina-dualpath-injection";
const INJECT_EXTRA = "amina-dualpath-injection-extras";


function _readSessionId() {
  try {
    return localStorage.getItem("AMINA_SID")
        || localStorage.getItem("AMINA_ACTIVE_SESSION_ID")
        || localStorage.getItem("AMINA_SESSION_ID")
        || "";
  } catch {
    return "";
  }
}


function _esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


function _fmtDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString([], {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return ""; }
}


function _entryTile(inner, footer) {
  return `
    <div style="
      padding: 10px 12px;
      background: rgba(30, 41, 59, 0.55);
      border: 1px solid rgba(148, 163, 184, 0.18);
      border-radius: 10px;
      margin-bottom: 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    ">
      ${inner}
      ${footer ? `<div style="color:#64748b; font-size:10px; margin-top:2px;">${footer}</div>` : ""}
    </div>
  `;
}


function _renderTraditional(entries) {
  if (!entries.length) {
    return `<div style="color:#94a3b8; font-size:12px;">No traditional entries yet.</div>`;
  }
  return entries.map((e) => {
    const prs = (e.practices || []).map(_esc).join(", ") || "—";
    return _entryTile(`
      <div style="font-weight:700; color:#f1f5f9; font-size:13px;">
        ${_esc(e.practitioner) || "(unnamed practitioner)"}
      </div>
      <div style="color:#cbd5e1; font-size:12px;">${prs}</div>
      <div style="color:#94a3b8; font-size:11px;">
        Last visit ${e.last_visit_days_ago ?? "—"} day${e.last_visit_days_ago === 1 ? "" : "s"} ago
      </div>
      ${e.notes ? `<div style="color:#e2e8f0; font-size:12px;">${_esc(e.notes)}</div>` : ""}
    `, _fmtDate(e.logged_at));
  }).join("");
}


function _renderModern(entries) {
  if (!entries.length) {
    return `<div style="color:#94a3b8; font-size:12px;">No modern entries yet.</div>`;
  }
  return entries.map((e) => {
    const meds = (e.medications || []).map(_esc).join(", ") || "—";
    return _entryTile(`
      <div style="font-weight:700; color:#f1f5f9; font-size:13px;">
        ${_esc(e.facility) || "(unnamed facility)"}
      </div>
      ${e.chw_name ? `<div style="color:#cbd5e1; font-size:12px;">CHW · ${_esc(e.chw_name)}</div>` : ""}
      <div style="color:#cbd5e1; font-size:12px;">${meds}</div>
      <div style="color:#94a3b8; font-size:11px;">
        Last visit ${e.last_visit_days_ago ?? "—"} day${e.last_visit_days_ago === 1 ? "" : "s"} ago
      </div>
      ${e.notes ? `<div style="color:#e2e8f0; font-size:12px;">${_esc(e.notes)}</div>` : ""}
    `, _fmtDate(e.logged_at));
  }).join("");
}


function _renderInteractions(entries) {
  if (!entries.length) {
    return `<div style="color:#94a3b8; font-size:12px;">No interaction checks yet.</div>`;
  }
  return entries.map((e) => {
    const safe = e.safe !== false;
    const pill = `
      <span style="
        display:inline-flex; align-items:center;
        padding: 3px 9px; border-radius: 999px;
        background: ${safe ? "rgba(16,185,129,0.14)" : "rgba(248,113,113,0.14)"};
        color:      ${safe ? "#6ee7b7" : "#fca5a5"};
        border:1px solid ${safe ? "rgba(52,211,153,0.35)" : "rgba(248,113,113,0.40)"};
        font-size: 10px; font-weight: 700; letter-spacing: 0.3px;
        text-transform: uppercase;
      ">${safe ? "Safe together" : "Check interactions"}</span>
    `;
    return _entryTile(
      `${pill}${e.notes ? `<div style="color:#e2e8f0; font-size:12px; margin-top:4px;">${_esc(e.notes)}</div>` : ""}`,
      _fmtDate(e.logged_at),
    );
  }).join("");
}


function _renderProgress(entries) {
  if (!entries.length) {
    return `<div style="color:#94a3b8; font-size:12px;">No progress entries yet.</div>`;
  }
  return entries.map((e) => {
    return _entryTile(`
      <div style="font-weight:700; color:#f1f5f9; font-size:13px;">
        BP ${_esc(e.bp_current) || "—"}
      </div>
      <div style="color:#cbd5e1; font-size:12px;">
        ${e.months_on_plan ?? 0} month${e.months_on_plan === 1 ? "" : "s"} on plan
      </div>
      ${e.notes ? `<div style="color:#e2e8f0; font-size:12px;">${_esc(e.notes)}</div>` : ""}
    `, _fmtDate(e.logged_at));
  }).join("");
}


function _counter(env) {
  return `
    <div style="color:#64748b; font-size:11px; margin-top:6px; text-align:right;">
      ${env.count} of ${env.cap} entries
    </div>
  `;
}


function _ensureExtraSections(modernBlock, interactionHtml, progressHtml) {
  // Find (or create) a synthetic sibling that hosts the Interaction
  // Log + Progress Log blocks. Keeping them in one container makes
  // cleanup + version-tagging simple.
  let extras = modernBlock.parentElement?.querySelector(`.${INJECT_EXTRA}`);
  if (!extras) {
    extras = document.createElement("div");
    extras.className = INJECT_EXTRA;
    modernBlock.parentElement.insertBefore(extras, modernBlock.nextSibling);
  }
  extras.innerHTML = `
    <div class="plan-block">
      <div class="plan-block-head plan-head-nudge">⚗ Interaction Log</div>
      <div class="panel-rowblock ${INJECT_BODY}">${interactionHtml}</div>
    </div>
    <div class="plan-block">
      <div class="plan-block-head plan-head-priority">📈 Progress Log</div>
      <div class="panel-rowblock ${INJECT_BODY}">${progressHtml}</div>
    </div>
  `;
}


let _lastVer = null;

async function _scan(force = false) {
  // Look for the Traditional Path header as the anchor — presence of
  // that element means the Dual-Path Care side panel is currently open.
  const tradHead = document.querySelector(".plan-head-diet");
  if (!tradHead) {
    _lastVer = null;  // panel not visible — reset so re-open reloads
    return;
  }

  const sid = _readSessionId();
  if (!sid) return;

  const tradBlock = tradHead.closest(".plan-block");
  if (!tradBlock) return;
  const existingVer = tradBlock.getAttribute(MARKER_ATTR) || "";
  if (!force && existingVer && existingVer === _lastVer) return;

  let data;
  try { data = await listAllDualpath(sid); }
  catch { return; }

  const ver = `${data?.traditional?.updated_at || ""}::`
            + `${data?.traditional?.count ?? 0}.${data?.modern?.count ?? 0}.`
            + `${data?.interaction?.count ?? 0}.${data?.progress?.count ?? 0}`;
  if (!force && ver === existingVer) return;

  // Traditional .panel-rowblock
  const tradRow = tradBlock.querySelector(".panel-rowblock");
  if (tradRow) {
    tradRow.innerHTML = _renderTraditional(data.traditional.entries)
                      + _counter(data.traditional);
  }

  // Modern .panel-rowblock
  const modHead  = document.querySelector(".plan-head-meds");
  const modBlock = modHead ? modHead.closest(".plan-block") : null;
  const modRow   = modBlock ? modBlock.querySelector(".panel-rowblock") : null;
  if (modRow) {
    modRow.innerHTML = _renderModern(data.modern.entries)
                     + _counter(data.modern);
  }

  // Extra sections: Interaction Log + Progress Log appended after Modern
  if (modBlock) {
    _ensureExtraSections(
      modBlock,
      _renderInteractions(data.interaction.entries) + _counter(data.interaction),
      _renderProgress(data.progress.entries)        + _counter(data.progress),
    );
  }

  tradBlock.setAttribute(MARKER_ATTR, ver);
  _lastVer = ver;
}


function install() {
  if (typeof window === "undefined") return;
  if (window.__aminaDualpathPanelInjectorInstalled) return;
  window.__aminaDualpathPanelInjectorInstalled = true;

  setInterval(() => _scan(false), POLL_MS);

  window.addEventListener("amina:dualpath-updated", () => {
    _lastVer = null;
    _scan(true);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") _scan(true);
  });
}


install();
