/**
 * SupplyPanelInjector — expand the "Medicine Supply" block inside the
 * Dual-Path Care side panel to show every ledger entry.
 * ======================================================================
 *
 * The block is rendered by App.jsx (~line 3775) as:
 *   <div class="plan-block">
 *     <div class="plan-block-head plan-head-goals">Medicine Supply</div>
 *     <div class="panel-rowblock">
 *       <div><strong>{supply.medicine}</strong> — {days} days remaining</div>
 *       <div>{supply.where_to_refill}</div>
 *     </div>
 *   </div>
 *
 * The supply object comes from /api/v1/community/all and only surfaces
 * medications[0], so new ledger entries added via the SupplyLedgerModal
 * never show here. We can't edit App.jsx, so:
 *
 *   1. A lightweight polling loop (250ms) scans the DOM for the block.
 *   2. When present, we fetch /api/v1/care/supply_ledger/{sid} and
 *      render ALL entries into the existing .panel-rowblock, preserving
 *      the visual language (dark chips, white text, muted sub-text).
 *   3. A version token on the row lets us skip re-rendering when the
 *      ledger hasn't changed.
 *   4. The SupplyLedgerModal fires `amina:ledger-updated` after every
 *      mutation — we listen for it and force-invalidate the version so
 *      the panel refreshes immediately even if it's already open.
 *   5. If React unmounts/remounts the panel, the next polling tick
 *      re-injects.
 *
 * Zero coupling to React — plain DOM. Safe no-op if the block never
 * renders (e.g. patient view, or session has no supply).
 */

import { listLedger } from "./supplyLedgerApi.js";


const HEAD_CLASS  = "plan-head-goals";
const HEAD_LABEL  = "medicine supply";
const ROW_CLASS   = "panel-rowblock";
const LEDGER_CLASS = "amina-ledger-injection";
const POLL_MS      = 250;


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


function _fmtStatus(med) {
  if (med.in_stock === false)   return { label: "Out of stock", color: "#fca5a5" };
  if (med.critical_stock)       return { label: "Critical",      color: "#fca5a5" };
  if (med.low_stock)            return { label: "Low",           color: "#fcd34d" };
  return                                 { label: "In stock",    color: "#6ee7b7" };
}


function _escape(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


function _renderHtml(meds) {
  if (!meds.length) {
    return `<div style="color:#94a3b8;font-size:12px;">No medicines on record.</div>`;
  }
  const rows = meds.map((m) => {
    const st     = _fmtStatus(m);
    const name   = _escape(m.name || "(unnamed)");
    const days   = m.days_remaining ?? "—";
    const refill = _escape(m.refill_location || "");
    const cost   = _escape(m.cost_per_pack || "");
    const tabs   = m.tablets_remaining ?? 0;
    const meta = [
      (refill ? refill : null),
      (cost   ? cost   : null),
      `${tabs} tablet${tabs === 1 ? "" : "s"} on hand`,
    ].filter(Boolean).join("  ·  ");
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
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
          <div style="font-weight:700; color:#f1f5f9; font-size:13px;">${name}</div>
          <span style="
            font-size:10px; font-weight:700; letter-spacing:0.3px;
            text-transform:uppercase; color:${st.color};
          ">${st.label}</span>
        </div>
        <div style="color:#cbd5e1; font-size:12px;">
          <strong>${days}</strong> day${days === 1 ? "" : "s"} remaining
        </div>
        ${meta ? `<div style="color:#94a3b8; font-size:11px;">${meta}</div>` : ""}
      </div>
    `;
  }).join("");

  // Footer line acts as the running counter + nods at the 10-cap so the
  // panel viewer can see the ledger size at a glance without opening
  // the modal.
  return `
    <div class="${LEDGER_CLASS}">
      ${rows}
      <div style="color:#64748b; font-size:11px; margin-top:6px; text-align:right;">
        ${meds.length} of 10 entries
      </div>
    </div>
  `;
}


let _lastVersion = null;

async function _injectInto(row, force) {
  const sid = _readSessionId();
  if (!sid) return;

  const existingVer = row.getAttribute("data-amina-ledger-version") || "";
  if (!force && existingVer && existingVer === _lastVersion) return;

  let env;
  try { env = await listLedger(sid); }
  catch { return; /* silent — panel keeps the App.jsx fallback */ }

  // Version = updated_at + count so we re-render exactly when the
  // ledger changes. Stable strings keep polling cheap.
  const ver = `${env.updated_at || ""}::${env.count || 0}`;
  if (!force && ver === existingVer) return;

  row.innerHTML = _renderHtml(env.medications || []);
  row.setAttribute("data-amina-ledger-version", ver);
  _lastVersion = ver;
}


function _scan(force = false) {
  // Find every "Medicine Supply" header in the DOM. Normally there's
  // only one (Dual-Path Care panel); we tolerate more for safety.
  const heads = document.querySelectorAll(`.${HEAD_CLASS}`);
  heads.forEach((head) => {
    const text = (head.textContent || "").trim().toLowerCase();
    if (text !== HEAD_LABEL) return;

    // Walk siblings to find the .panel-rowblock — it's the very next
    // element in the current layout, but being defensive helps us
    // survive a future layout tweak.
    let row = head.nextElementSibling;
    while (row && !row.classList?.contains(ROW_CLASS)) {
      row = row.nextElementSibling;
    }
    if (!row) return;
    _injectInto(row, force);
  });
}


function install() {
  if (typeof window === "undefined") return;
  if (window.__aminaSupplyPanelInjectorInstalled) return;
  window.__aminaSupplyPanelInjectorInstalled = true;

  // 1. Polling scan — picks up panel open/close + React re-renders.
  setInterval(() => _scan(false), POLL_MS);

  // 2. Immediate refresh after any ledger mutation. The modal fires
  //    this custom event after add / patch / delete.
  window.addEventListener("amina:ledger-updated", () => {
    _lastVersion = null; // force next scan to re-render
    _scan(true);
  });

  // 3. Also refresh on tab return (users sometimes edit in another tab).
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") _scan(true);
  });
}


install();
