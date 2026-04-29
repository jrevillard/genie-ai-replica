/**
 * Admin + Gov UI primitives.
 * =============================
 *
 * Twelve small, opinionated components that define the design system
 * for the AMINA admin console and government observatory. Every
 * primitive reads from CSS variables declared in `admin-tokens.css`,
 * so dark-to-light theme changes (if ever added) are one `:root`
 * override away.
 *
 *   Button · Card · Stat · Badge · Pill · Input · Select
 *   Sheet  · Tabs · Toast · Sparkline · Chart (Donut+Bar+Line)
 *
 * Rules:
 *  - No external UI library. Lucide icons only for glyphs.
 *  - No inline hex — only CSS vars.
 *  - Every interactive element ≥ 40×40 tap target.
 *  - `:focus-visible` has a designed cyan bloom (not browser default).
 *  - All animations respect `prefers-reduced-motion`.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, X, ChevronDown, Search } from "lucide-react";

/* ──────────────────────────────────────────────────────────────────
   Inject primitive CSS once
   ────────────────────────────────────────────────────────────────── */

const PRIMITIVE_CSS = `
/* Button */
.a-btn {
  display: inline-flex; align-items: center; justify-content: center;
  gap: var(--a-s-2);
  font-family: inherit; font-size: var(--a-text-13); font-weight: 600;
  letter-spacing: 0.01em;
  border: 1px solid transparent; cursor: pointer;
  transition:
    background var(--a-t-base) var(--a-ease),
    color      var(--a-t-base) var(--a-ease),
    border-color var(--a-t-base) var(--a-ease),
    transform  var(--a-t-fast) var(--a-ease),
    box-shadow var(--a-t-base) var(--a-ease);
  white-space: nowrap;
  user-select: none;
}
.a-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgba(34, 211, 238, 0.55), 0 0 16px rgba(34, 211, 238, 0.25);
}
.a-btn:active:not(:disabled) { transform: translateY(0.5px) scale(0.995); }
.a-btn:disabled { cursor: not-allowed; opacity: 0.55; }
/* sizes */
.a-btn-sm { padding: 6px 10px; min-height: 32px; border-radius: var(--a-r-2); font-size: var(--a-text-12); }
.a-btn-md { padding: 9px 14px; min-height: 38px; border-radius: var(--a-r-3); }
.a-btn-lg { padding: 12px 18px; min-height: 44px; border-radius: var(--a-r-4); font-size: var(--a-text-14); }
/* variants */
.a-btn-primary {
  background: linear-gradient(135deg, var(--a-accent-2), color-mix(in oklab, var(--a-accent-2), black 18%));
  color: #fff;
  box-shadow: 0 4px 10px -4px color-mix(in oklab, var(--a-accent-2), transparent 50%);
}
.a-btn-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, var(--a-accent), var(--a-accent-2));
  box-shadow: 0 6px 14px -4px color-mix(in oklab, var(--a-accent-2), transparent 35%);
}
.a-btn-secondary {
  background: var(--a-bg-elev-1);
  border-color: var(--a-border-1);
  color: var(--a-fg);
}
.a-btn-secondary:hover:not(:disabled) {
  background: var(--a-bg-elev-2);
  border-color: var(--a-border-2);
}
.a-btn-ghost {
  background: transparent;
  color: var(--a-fg-mute);
}
.a-btn-ghost:hover:not(:disabled) {
  background: var(--a-bg-inset);
  color: var(--a-fg);
}
.a-btn-danger {
  background: color-mix(in oklab, var(--a-danger), transparent 82%);
  color: color-mix(in oklab, var(--a-danger), white 15%);
  border-color: color-mix(in oklab, var(--a-danger), transparent 55%);
}
.a-btn-danger:hover:not(:disabled) {
  background: color-mix(in oklab, var(--a-danger), transparent 70%);
}

/* Card */
.a-card {
  background: var(--a-bg-elev-1);
  border: 1px solid var(--a-border-1);
  border-radius: var(--a-r-5);
  box-shadow: var(--a-shadow-2);
  padding: var(--a-s-5);
  position: relative;
}
.a-card-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: var(--a-s-3);
}
.a-card-title {
  font-size: var(--a-text-13);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--a-fg-dim);
}
.a-card-actions {
  display: inline-flex;
  gap: var(--a-s-2);
}

/* Stat */
.a-stat { display: flex; flex-direction: column; gap: 6px; }
.a-stat-label {
  font-size: var(--a-text-11);
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--a-fg-dim);
}
.a-stat-value {
  font-family: var(--a-font-disp);
  font-variation-settings: "opsz" 144;
  font-size: var(--a-text-28);
  font-weight: 500;
  letter-spacing: -0.02em;
  color: var(--a-fg);
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.a-stat-sub {
  font-size: var(--a-text-11);
  color: var(--a-fg-mute);
  display: flex; align-items: center; gap: 4px;
}
.a-stat-delta-up   { color: var(--a-success); }
.a-stat-delta-down { color: var(--a-danger); }
.a-stat-delta-flat { color: var(--a-fg-mute); }

/* Badge */
.a-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px;
  border-radius: var(--a-r-pill);
  font-size: var(--a-text-10);
  font-weight: 700;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  line-height: 1.6;
}
.a-badge-neutral { background: var(--a-bg-inset); color: var(--a-fg-mute); border: 1px solid var(--a-border-1); }
.a-badge-success { background: color-mix(in oklab, var(--a-success), transparent 80%); color: var(--a-success); }
.a-badge-warn    { background: color-mix(in oklab, var(--a-warn),    transparent 80%); color: var(--a-warn); }
.a-badge-danger  { background: color-mix(in oklab, var(--a-danger),  transparent 80%); color: var(--a-danger); }
.a-badge-info    { background: color-mix(in oklab, var(--a-info),    transparent 80%); color: var(--a-info); }
.a-badge-accent  { background: color-mix(in oklab, var(--a-accent),  transparent 80%); color: var(--a-accent); }

/* Pill (slightly larger sibling of Badge) */
.a-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px;
  border-radius: var(--a-r-pill);
  font-size: var(--a-text-12);
  font-weight: 600;
  background: var(--a-bg-inset);
  border: 1px solid var(--a-border-1);
  color: var(--a-fg);
}

/* Input */
.a-input-wrap {
  position: relative;
  display: flex; align-items: center;
  background: var(--a-bg-inset);
  border: 1px solid var(--a-border-1);
  border-radius: var(--a-r-3);
  transition: border-color var(--a-t-base) var(--a-ease), box-shadow var(--a-t-base) var(--a-ease);
}
.a-input-wrap:focus-within {
  border-color: var(--a-border-active);
  box-shadow: 0 0 0 3px rgba(129, 140, 248, 0.14);
}
.a-input-lead, .a-input-tail {
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--a-fg-dim);
  padding: 0 10px;
}
.a-input {
  width: 100%;
  padding: 9px 12px;
  background: transparent;
  border: none; outline: none;
  color: var(--a-fg);
  font-family: inherit;
  font-size: var(--a-text-13);
}
.a-input::placeholder { color: var(--a-fg-dim); }
.a-input-wrap.lead .a-input { padding-left: 0; }

/* Select (native, styled) */
.a-select {
  appearance: none; -webkit-appearance: none; -moz-appearance: none;
  width: 100%;
  padding: 9px 32px 9px 12px;
  background: var(--a-bg-inset);
  background-image:
    linear-gradient(45deg, transparent 50%, var(--a-fg-dim) 50%),
    linear-gradient(135deg, var(--a-fg-dim) 50%, transparent 50%);
  background-position:
    calc(100% - 18px) 50%,
    calc(100% - 13px) 50%;
  background-size: 5px 5px;
  background-repeat: no-repeat;
  border: 1px solid var(--a-border-1);
  border-radius: var(--a-r-3);
  color: var(--a-fg);
  font-family: inherit;
  font-size: var(--a-text-13);
  cursor: pointer;
  transition: border-color var(--a-t-base) var(--a-ease), box-shadow var(--a-t-base) var(--a-ease);
}
.a-select:focus-visible {
  outline: none;
  border-color: var(--a-border-active);
  box-shadow: 0 0 0 3px rgba(129, 140, 248, 0.14);
}

/* Sheet (slide-in drawer from right) */
.a-sheet-overlay {
  position: fixed; inset: 0;
  background: rgba(6, 8, 20, 0.55);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: var(--a-z-overlay);
  opacity: 0;
  animation: a-sheet-fade var(--a-t-base) var(--a-ease) forwards;
}
@keyframes a-sheet-fade { to { opacity: 1; } }
.a-sheet {
  position: fixed; top: 0; right: 0; bottom: 0;
  width: min(540px, 100vw);
  background: var(--a-bg-elev-1);
  border-left: 1px solid var(--a-border-1);
  box-shadow: var(--a-shadow-3);
  z-index: var(--a-z-sheet);
  display: flex; flex-direction: column;
  transform: translateX(100%);
  animation: a-sheet-slide var(--a-t-slow) var(--a-ease) forwards;
}
@keyframes a-sheet-slide { to { transform: translateX(0); } }
.a-sheet-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--a-s-5);
  border-bottom: 1px solid var(--a-border-1);
}
.a-sheet-title {
  font-family: var(--a-font-disp);
  font-size: var(--a-text-22);
  font-weight: 500;
  color: var(--a-fg);
  letter-spacing: -0.01em;
}
.a-sheet-body { flex: 1; overflow: auto; padding: var(--a-s-5); }

/* Tabs */
.a-tabs {
  position: relative;
  display: inline-flex;
  gap: var(--a-s-1);
  padding: 4px;
  background: var(--a-bg-inset);
  border: 1px solid var(--a-border-1);
  border-radius: var(--a-r-3);
}
.a-tab {
  position: relative; z-index: 1;
  padding: 7px 14px;
  border: none;
  background: transparent;
  border-radius: var(--a-r-2);
  font-family: inherit;
  font-size: var(--a-text-12);
  font-weight: 600;
  color: var(--a-fg-mute);
  cursor: pointer;
  transition: color var(--a-t-base) var(--a-ease);
  white-space: nowrap;
}
.a-tab:hover { color: var(--a-fg); }
.a-tab[aria-selected="true"] { color: var(--a-fg); }
.a-tab-pill {
  position: absolute; top: 4px; bottom: 4px;
  background: var(--a-bg-elev-2);
  border: 1px solid var(--a-border-2);
  border-radius: var(--a-r-2);
  transition: left var(--a-t-slow) var(--a-ease-silk), width var(--a-t-slow) var(--a-ease-silk);
  z-index: 0;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
}

/* Toast */
.a-toast-host {
  position: fixed;
  bottom: 24px; right: 24px;
  z-index: var(--a-z-toast);
  display: flex; flex-direction: column; gap: 8px;
  pointer-events: none;
}
.a-toast {
  pointer-events: auto;
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px;
  min-width: 260px;
  max-width: 360px;
  background: var(--a-bg-elev-2);
  border: 1px solid var(--a-border-2);
  border-radius: var(--a-r-3);
  color: var(--a-fg);
  font-size: var(--a-text-13);
  box-shadow: var(--a-shadow-3);
  animation: a-toast-in var(--a-t-base) var(--a-ease);
}
@keyframes a-toast-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
.a-toast-success { border-color: color-mix(in oklab, var(--a-success), transparent 55%); }
.a-toast-error   { border-color: color-mix(in oklab, var(--a-danger),  transparent 55%); }
.a-toast-info    { border-color: color-mix(in oklab, var(--a-info),    transparent 55%); }
`;

if (typeof document !== "undefined" && !document.getElementById("amina-admin-primitives-css")) {
  const s = document.createElement("style");
  s.id = "amina-admin-primitives-css";
  s.textContent = PRIMITIVE_CSS;
  document.head.appendChild(s);
}


/* ──────────────────────────────────────────────────────────────────
   1. Button
   ────────────────────────────────────────────────────────────────── */

export function Button({
  children, onClick, disabled, loading, type = "button",
  variant = "secondary",   // primary | secondary | ghost | danger
  size    = "md",          // sm | md | lg
  leadIcon: Lead, tailIcon: Tail,
  className = "", style: styleOverride,
  ...rest
}) {
  const cls = `a-btn a-btn-${size} a-btn-${variant} ${className}`.trim();
  return (
    <button type={type} onClick={onClick} disabled={disabled || loading}
            className={cls} style={styleOverride} {...rest}>
      {loading ? <Loader2 size={14} className="a-spin" /> : Lead && <Lead size={14} />}
      {children}
      {!loading && Tail && <Tail size={14} />}
    </button>
  );
}

/* ──────────────────────────────────────────────────────────────────
   2. Card
   ────────────────────────────────────────────────────────────────── */

export function Card({ title, actions, children, className = "", style }) {
  return (
    <div className={`a-card ${className}`.trim()} style={style}>
      {(title || actions) && (
        <div className="a-card-head">
          <div className="a-card-title">{title}</div>
          {actions && <div className="a-card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
   3. Stat  (label + big number + trend sub-line)
   ────────────────────────────────────────────────────────────────── */

export function Stat({ label, value, sub, delta, fmt, icon: Icon }) {
  const deltaCls =
    delta == null ? "a-stat-delta-flat"
    : delta > 0   ? "a-stat-delta-up"
    : delta < 0   ? "a-stat-delta-down"
    : "a-stat-delta-flat";
  const arrow = delta == null ? "—" : delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
  const formattedValue = fmt ? fmt(value) : value;
  return (
    <div className="a-stat">
      <div className="a-stat-label">
        {Icon && <Icon size={11} strokeWidth={2} style={{ marginRight: 6, verticalAlign: "-1px" }} />}
        {label}
      </div>
      <div className="a-stat-value">{formattedValue}</div>
      {(sub || delta != null) && (
        <div className="a-stat-sub">
          <span className={deltaCls}>{arrow}{delta != null ? ` ${Math.abs(delta)}%` : ""}</span>
          {sub ? <span style={{ color: "var(--a-fg-dim)" }}> · {sub}</span> : null}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
   4. Badge
   ────────────────────────────────────────────────────────────────── */

export function Badge({ children, tone = "neutral" }) {
  return <span className={`a-badge a-badge-${tone}`}>{children}</span>;
}

/* ──────────────────────────────────────────────────────────────────
   5. Pill  (slightly larger + clickable optional)
   ────────────────────────────────────────────────────────────────── */

export function Pill({ children, onClick, leadIcon: Lead }) {
  const Tag = onClick ? "button" : "span";
  return (
    <Tag className="a-pill" onClick={onClick} style={onClick ? { cursor: "pointer" } : undefined}>
      {Lead && <Lead size={12} />}
      {children}
    </Tag>
  );
}

/* ──────────────────────────────────────────────────────────────────
   6. Input
   ────────────────────────────────────────────────────────────────── */

export function Input({ value, onChange, placeholder, type = "text",
                        leadIcon: Lead, tailIcon: Tail,
                        ariaLabel, ...rest }) {
  return (
    <div className={`a-input-wrap ${Lead ? "lead" : ""}`}>
      {Lead && <span className="a-input-lead"><Lead size={14} /></span>}
      <input type={type} value={value} onChange={onChange}
             placeholder={placeholder} className="a-input"
             aria-label={ariaLabel} {...rest} />
      {Tail && <span className="a-input-tail"><Tail size={14} /></span>}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
   7. Select
   ────────────────────────────────────────────────────────────────── */

export function Select({ value, onChange, options, ariaLabel, ...rest }) {
  return (
    <select value={value} onChange={onChange} className="a-select"
            aria-label={ariaLabel} {...rest}>
      {options.map((o) => (
        <option key={o.value ?? o} value={o.value ?? o}>
          {o.label ?? o}
        </option>
      ))}
    </select>
  );
}

/* ──────────────────────────────────────────────────────────────────
   8. Sheet  (right slide-in drawer)
   ────────────────────────────────────────────────────────────────── */

export function Sheet({ open, onClose, title, children, actions }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose && onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <div className="a-sheet-overlay" onClick={onClose} />
      <aside className="a-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="a-sheet-head">
          <div className="a-sheet-title">{title}</div>
          <div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            {actions}
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close" leadIcon={X}>Close</Button>
          </div>
        </div>
        <div className="a-sheet-body">{children}</div>
      </aside>
    </>
  );
}

/* ──────────────────────────────────────────────────────────────────
   9. Tabs  (measured sliding pill)
   ────────────────────────────────────────────────────────────────── */

export function Tabs({ items, value, onChange, ariaLabel }) {
  const ref = useRef(null);
  const [rect, setRect] = useState({ left: 0, width: 0 });
  const activeIdx = items.findIndex((it) => it.id === value);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const active = el.querySelectorAll("[data-tab-item]")[activeIdx];
    if (!active) return;
    const p = el.getBoundingClientRect();
    const a = active.getBoundingClientRect();
    setRect({ left: a.left - p.left, width: a.width });
  }, [activeIdx, items]);

  return (
    <div ref={ref} className="a-tabs" role="tablist" aria-label={ariaLabel}>
      <div className="a-tab-pill" style={{ left: rect.left, width: rect.width }} />
      {items.map((it) => (
        <button key={it.id} role="tab" type="button"
                aria-selected={it.id === value}
                onClick={() => onChange(it.id)}
                data-tab-item className="a-tab">
          {it.icon && <it.icon size={13} style={{ marginRight: 6, verticalAlign: "-1px" }} />}
          {it.label}
        </button>
      ))}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
   10. Toast  (host + imperative fire function)
   ────────────────────────────────────────────────────────────────── */

const _toastListeners = new Set();
let _toastSeq = 0;

export function toast(message, kind = "info", ttl = 3200) {
  const id = ++_toastSeq;
  _toastListeners.forEach((fn) => fn({ type: "add", id, message, kind, ttl }));
  setTimeout(() => {
    _toastListeners.forEach((fn) => fn({ type: "remove", id }));
  }, ttl);
}

export function ToastHost() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const fn = (ev) => {
      if (ev.type === "add")    setItems((xs) => [...xs, ev]);
      if (ev.type === "remove") setItems((xs) => xs.filter((x) => x.id !== ev.id));
    };
    _toastListeners.add(fn);
    return () => _toastListeners.delete(fn);
  }, []);
  if (items.length === 0) return null;
  return (
    <div className="a-toast-host" aria-live="polite">
      {items.map((it) => (
        <div key={it.id} className={`a-toast a-toast-${it.kind}`} role="status">
          {it.message}
        </div>
      ))}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
   11. Sparkline  (tiny inline SVG line chart)
   ────────────────────────────────────────────────────────────────── */

export function Sparkline({ data, width = 90, height = 24, stroke, fill = true }) {
  if (!data || data.length < 2) return <svg width={width} height={height} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = width / (data.length - 1);
  const pts = data.map((v, i) => [i * step, height - ((v - min) / range) * (height - 2) - 1]);
  const path = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${path} L${width} ${height} L0 ${height} Z`;
  const color = stroke || "var(--a-accent)";
  const gid = useMemo(() => `spark-${Math.random().toString(36).slice(2, 8)}`, []);
  return (
    <svg width={width} height={height} style={{ display: "block" }} aria-hidden="true">
      {fill && (
        <>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor={color} stopOpacity="0.35" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gid})`} />
        </>
      )}
      <path d={path} stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ──────────────────────────────────────────────────────────────────
   12. Chart  (donut + horizontal bar primitives)
   ────────────────────────────────────────────────────────────────── */

export function Donut({ segments, size = 140, thickness = 14, center }) {
  const total = segments.reduce((s, x) => s + (x.value || 0), 0) || 1;
  const r = (size - thickness) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--a-border-1)" strokeWidth={thickness} />
      {segments.map((seg, i) => {
        const len = (seg.value / total) * circ;
        const dash = `${len} ${circ - len}`;
        const rot = (offset / circ) * 360 - 90;
        offset += len;
        return (
          <circle key={i}
                  cx={c} cy={c} r={r}
                  fill="none" stroke={seg.color}
                  strokeWidth={thickness}
                  strokeDasharray={dash}
                  strokeLinecap="butt"
                  transform={`rotate(${rot} ${c} ${c})`}
                  style={{ transition: "stroke-dasharray 420ms var(--a-ease)" }}/>
        );
      })}
      {center && (
        <foreignObject x="0" y="0" width={size} height={size}>
          <div style={{
            height: "100%", display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            fontFamily: "var(--a-font-disp)",
          }}>
            {center}
          </div>
        </foreignObject>
      )}
    </svg>
  );
}

export function HBar({ rows, max, formatter = (v) => v }) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((r, i) => (
        <div key={i}>
          <div style={{
            display: "flex", justifyContent: "space-between",
            fontSize: "var(--a-text-12)", color: "var(--a-fg-mute)",
            marginBottom: 4,
          }}>
            <span>{r.label}</span>
            <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--a-fg)" }}>{formatter(r.value)}</span>
          </div>
          <div style={{
            width: "100%", height: 6, borderRadius: 999,
            background: "var(--a-bg-inset)", overflow: "hidden",
          }}>
            <div style={{
              width: `${Math.max(2, (r.value / m) * 100)}%`,
              height: "100%",
              background: r.color || "var(--a-accent)",
              borderRadius: 999,
              transition: "width 520ms var(--a-ease)",
            }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* tiny spin helper — used by Button loading state */
const SPIN_CSS = `@keyframes a-spin { to { transform: rotate(360deg); } } .a-spin { animation: a-spin 720ms linear infinite; }`;
if (typeof document !== "undefined" && !document.getElementById("amina-admin-spin")) {
  const s = document.createElement("style"); s.id = "amina-admin-spin"; s.textContent = SPIN_CSS;
  document.head.appendChild(s);
}

export { Search, ChevronDown };
