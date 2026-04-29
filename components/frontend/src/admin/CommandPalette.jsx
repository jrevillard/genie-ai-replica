/**
 * CommandPalette — ⌘K / Ctrl+K overlay.
 * ========================================
 *
 * Minimal Linear-style palette with fuzzy-ish filtering (substring +
 * word-prefix boost). No external dependency — about 120 lines. Arrow
 * keys navigate, Enter executes, Esc closes.
 *
 * Commands are passed in from the shell, so admin and gov can register
 * different vocabularies.
 *
 *   <CommandPalette commands={[
 *     { id: "nav:patients", title: "Go to Patients", hint: "gp", section: "Navigate", run: () => setTab("people") },
 *     ...
 *   ]}/>
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, CornerDownLeft } from "lucide-react";

const PALETTE_CSS = `
.a-cmdk-overlay {
  position: fixed; inset: 0;
  z-index: var(--a-z-palette);
  background: rgba(6, 8, 20, 0.60);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex; align-items: flex-start; justify-content: center;
  padding: 12vh 16px 24px;
  animation: a-cmdk-fade 180ms ease-out;
}
@keyframes a-cmdk-fade { from { opacity: 0; } to { opacity: 1; } }

.a-cmdk {
  width: min(640px, 100%);
  background: var(--a-bg-elev-1);
  border: 1px solid var(--a-border-2);
  border-radius: var(--a-r-5);
  box-shadow: var(--a-shadow-3);
  overflow: hidden;
  transform: translateY(8px) scale(0.98);
  animation: a-cmdk-slide 240ms var(--a-ease) forwards;
}
@keyframes a-cmdk-slide { to { transform: translateY(0) scale(1); } }

.a-cmdk-input-row {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--a-border-1);
}
.a-cmdk-input-row input {
  flex: 1; width: 100%;
  background: transparent; border: none; outline: none;
  color: var(--a-fg);
  font-family: inherit; font-size: 16px;
}
.a-cmdk-input-row input::placeholder { color: var(--a-fg-dim); }

.a-cmdk-list {
  max-height: 52vh; overflow: auto;
  padding: 6px;
}
.a-cmdk-section {
  padding: 12px 14px 4px;
  font-size: var(--a-text-10);
  font-weight: 700; letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--a-fg-dim);
}
.a-cmdk-item {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 12px;
  border-radius: var(--a-r-2);
  cursor: pointer;
  color: var(--a-fg-mute);
  font-size: var(--a-text-13);
  transition: background var(--a-t-fast) var(--a-ease), color var(--a-t-fast) var(--a-ease);
}
.a-cmdk-item[aria-selected="true"] {
  background: var(--a-bg-elev-2);
  color: var(--a-fg);
}
.a-cmdk-item-icon {
  width: 26px; height: 26px;
  display: grid; place-items: center;
  background: var(--a-bg-inset);
  border-radius: var(--a-r-2);
  flex-shrink: 0;
}
.a-cmdk-item-title { flex: 1; }
.a-cmdk-item-hint {
  font-family: var(--a-font-mono);
  font-size: var(--a-text-10);
  letter-spacing: 0.05em;
  color: var(--a-fg-dim);
  padding: 2px 6px;
  border: 1px solid var(--a-border-1);
  border-radius: 4px;
  background: var(--a-bg-inset);
}
.a-cmdk-empty {
  padding: 28px 14px;
  text-align: center;
  color: var(--a-fg-dim);
  font-size: var(--a-text-13);
}
.a-cmdk-foot {
  display: flex; align-items: center; gap: 16px;
  padding: 10px 18px;
  border-top: 1px solid var(--a-border-1);
  background: rgba(255, 255, 255, 0.01);
  color: var(--a-fg-dim);
  font-size: var(--a-text-11);
  letter-spacing: 0.04em;
}
.a-cmdk-kbd {
  padding: 2px 6px; border-radius: 4px;
  background: var(--a-bg-inset); border: 1px solid var(--a-border-1);
  font-family: var(--a-font-mono); font-size: 10px;
  color: var(--a-fg-mute);
}
`;

if (typeof document !== "undefined" && !document.getElementById("amina-cmdk-css")) {
  const s = document.createElement("style");
  s.id = "amina-cmdk-css";
  s.textContent = PALETTE_CSS;
  document.head.appendChild(s);
}


function score(cmd, q) {
  if (!q) return 1;
  const s = (cmd.title + " " + (cmd.hint || "") + " " + (cmd.section || "")).toLowerCase();
  const qq = q.toLowerCase();
  if (s.startsWith(qq))      return 1000;
  if (s.includes(" " + qq))  return 500;
  if (s.includes(qq))        return 100;
  // loose: every char of q appears in order
  let i = 0; for (const ch of s) { if (ch === qq[i]) i++; if (i === qq.length) return 10; }
  return 0;
}


export default function CommandPalette({ commands = [], open, onClose }) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef(null);
  const listRef  = useRef(null);

  useEffect(() => {
    if (open) {
      setQ(""); setIdx(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const filtered = useMemo(() => {
    if (!commands || commands.length === 0) return [];
    const scored = commands
      .map((c) => ({ ...c, _s: score(c, q) }))
      .filter((c) => c._s > 0)
      .sort((a, b) => b._s - a._s);
    // group by section preserving order
    const groups = [];
    const seen   = new Map();
    for (const c of scored) {
      const sec = c.section || "";
      if (!seen.has(sec)) {
        seen.set(sec, groups.length);
        groups.push({ section: sec, items: [c] });
      } else groups[seen.get(sec)].items.push(c);
    }
    return groups;
  }, [commands, q]);

  const flat = useMemo(() => filtered.flatMap((g) => g.items), [filtered]);

  useEffect(() => {
    setIdx((i) => Math.min(Math.max(0, i), Math.max(0, flat.length - 1)));
  }, [flat.length]);

  // scroll active into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-cmdk-index="${idx}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [idx]);

  const onKey = (e) => {
    if (e.key === "Escape")          { onClose && onClose(); }
    else if (e.key === "ArrowDown")  { e.preventDefault(); setIdx((i) => Math.min(i + 1, flat.length - 1)); }
    else if (e.key === "ArrowUp")    { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter")      {
      e.preventDefault();
      const c = flat[idx];
      if (c) { onClose && onClose(); requestAnimationFrame(() => c.run && c.run()); }
    }
  };

  if (!open) return null;

  return (
    <div className="a-cmdk-overlay" onClick={onClose}>
      <div className="a-cmdk" role="dialog" aria-modal="true"
           aria-label="Command palette"
           onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="a-cmdk-input-row">
          <Search size={16} style={{ color: "var(--a-fg-dim)" }} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setIdx(0); }}
            placeholder="Type a command or search…"
          />
          <span className="a-cmdk-kbd">ESC</span>
        </div>

        <div className="a-cmdk-list" ref={listRef}>
          {flat.length === 0 && (
            <div className="a-cmdk-empty">No matches. Try a different term.</div>
          )}
          {filtered.map((g, gi) => (
            <div key={g.section + gi}>
              {g.section && <div className="a-cmdk-section">{g.section}</div>}
              {g.items.map((cmd) => {
                const flatIdx = flat.indexOf(cmd);
                return (
                  <div
                    key={cmd.id}
                    data-cmdk-index={flatIdx}
                    className="a-cmdk-item"
                    aria-selected={flatIdx === idx}
                    onMouseEnter={() => setIdx(flatIdx)}
                    onClick={() => { onClose && onClose(); requestAnimationFrame(() => cmd.run && cmd.run()); }}
                    role="option"
                  >
                    <span className="a-cmdk-item-icon">
                      {cmd.icon ? <cmd.icon size={14} /> : <span style={{ fontSize: 12 }}>›</span>}
                    </span>
                    <span className="a-cmdk-item-title">{cmd.title}</span>
                    {cmd.hint && <span className="a-cmdk-item-hint">{cmd.hint}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="a-cmdk-foot">
          <span><span className="a-cmdk-kbd">↑↓</span> navigate</span>
          <span><span className="a-cmdk-kbd"><CornerDownLeft size={10} style={{ verticalAlign: "-1px" }} /></span> open</span>
          <span style={{ marginLeft: "auto" }}>
            <span className="a-cmdk-kbd">{navigator.platform.includes("Mac") ? "⌘K" : "Ctrl+K"}</span> anywhere
          </span>
        </div>
      </div>
    </div>
  );
}


/**
 * Hook: register ⌘K / Ctrl+K to open palette. Also accepts `g <letter>`
 * two-stroke quick-nav shortcuts (Linear-style).
 */
export function usePaletteHotkeys(onOpen, quickNav = {}) {
  useEffect(() => {
    let gPrimed = false;
    let gTimer  = null;
    const onKey = (e) => {
      // ignore typing inside inputs
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault(); onOpen && onOpen(); return;
      }
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault(); onOpen && onOpen(); return;
      }
      // quick-nav: `g` then letter
      if (!gPrimed && e.key.toLowerCase() === "g" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        gPrimed = true;
        clearTimeout(gTimer);
        gTimer = setTimeout(() => { gPrimed = false; }, 900);
        return;
      }
      if (gPrimed) {
        gPrimed = false;
        clearTimeout(gTimer);
        const fn = quickNav[e.key.toLowerCase()];
        if (fn) { e.preventDefault(); fn(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); clearTimeout(gTimer); };
  }, [onOpen, quickNav]);
}
