/**
 * ScoutDirectoryHost — patient-facing scout directory launcher.
 *
 * Listens for the "amina:open-scout-directory" custom event and renders
 * the ScoutDirectoryPanel as a full-screen modal overlay. Injects a
 * "Youth Scouts" quick-tile into the patient dashboard matching the
 * exact CSS pattern of My Care Plan / Notifications tiles.
 */

import { useCallback, useEffect, useState } from "react";
import ScoutDirectoryPanel from "./ScoutDirectoryPanel.jsx";


const OPEN_EVENT = "amina:open-scout-directory";

const BASE = (() => {
  const raw = (typeof window !== "undefined" && window.__AMINA_API_BASE__)
           || (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_BASE)
           || "http://localhost:8000";
  return String(raw).replace(/\/+$/, "");
})();


function _injectCSS() {
  if (typeof document === "undefined") return;
  if (document.getElementById("amina-scout-dir-css")) return;
  const style = document.createElement("style");
  style.id = "amina-scout-dir-css";
  style.textContent = `
    .quick-tile-scout-directory {
      border-color: rgba(99, 102, 241, 0.28);
    }
    .quick-tile-scout-directory:hover:not(:disabled) {
      border-color: rgba(99, 102, 241, 0.52);
      background: linear-gradient(135deg, rgba(99,102,241,0.10), rgba(99,102,241,0.02));
    }
    .quick-tile-scout-directory .quick-tile-icon {
      background: rgba(99, 102, 241, 0.14);
      color: #818cf8;
    }
    .quick-tile-scout-directory.quick-tile-has-data {
      background: linear-gradient(135deg, rgba(99,102,241,0.08), rgba(99,102,241,0.02));
    }
  `;
  document.head.appendChild(style);
}


function injectQuickTile() {
  if (typeof window === "undefined") return;
  if (window.__aminaScoutDirTileInjected) return;
  window.__aminaScoutDirTileInjected = true;

  _injectCSS();

  const inject = () => {
    const container = document.querySelector(".quick-tiles, .quick-tiles-grid, [data-quick-tiles]");
    if (!container) {
      setTimeout(inject, 2000);
      return;
    }
    if (container.querySelector(".quick-tile-scout-directory")) return;

    const tile = document.createElement("button");
    tile.className = "quick-tile quick-tile-scout-directory";
    tile.setAttribute("data-testid", "quick-tile-scout-directory");
    tile.innerHTML = `
      <div class="quick-tile-icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
      </div>
      <div class="quick-tile-body">
        <div class="quick-tile-title">Youth Scouts</div>
        <div class="quick-tile-sub" id="amina-scout-tile-sub">Browse scouts &amp; suggest help</div>
      </div>
      <svg class="quick-tile-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
    `;
    tile.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { window.dispatchEvent(new CustomEvent(OPEN_EVENT)); }
      catch { /* noop */ }
    });

    const scoutApply = container.querySelector(".quick-tile-scout-apply");
    if (scoutApply) {
      scoutApply.parentNode.insertBefore(tile, scoutApply);
    } else {
      container.appendChild(tile);
    }

    _fetchScoutPreview(tile);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", inject);
  } else {
    setTimeout(inject, 1500);
  }
}


async function _fetchScoutPreview(tile) {
  try {
    const r = await fetch(`${BASE}/api/v1/scout-directory/list`, {
      credentials: "include",
    });
    if (!r.ok) return;
    const d = await r.json();
    const scouts = d.scouts || [];
    const available = scouts.filter(s => s.availability === "available").length;
    const sub = tile.querySelector("#amina-scout-tile-sub");
    if (sub && scouts.length > 0) {
      sub.textContent = `${scouts.length} scout${scouts.length !== 1 ? "s" : ""} · ${available} available`;
      tile.classList.add("quick-tile-has-data");
    }
  } catch { /* noop */ }
}


injectQuickTile();


export default function ScoutDirectoryHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.openScoutDirectory = () => {
        try { window.dispatchEvent(new CustomEvent(OPEN_EVENT)); }
        catch { /* noop */ }
      };
    }
  }, []);

  const close = useCallback(() => setOpen(false), []);

  if (!open) return null;

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(0,0,0,0.55)", zIndex: 10001,
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20,
    }} onClick={e => { if (e.target === e.currentTarget) close(); }}>
      <div style={{ width: "100%", maxWidth: 700, maxHeight: "90vh" }}>
        <ScoutDirectoryPanel onClose={close} />
      </div>
    </div>
  );
}
