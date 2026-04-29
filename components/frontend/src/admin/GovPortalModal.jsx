/**
 * GovPortalModal v4 — full-screen two-panel sign-in
 * ===================================================
 *
 * Layout: left brand panel + right auth card.
 *
 * Mode switch:
 *   "Phone & OTP"     [Live]    primary, default
 *   "Staff ID & NIN"  [Future]  GAMBIS-ready stub
 *
 * Phone flow (Live, 3-step):
 *   Step 1  phone + facility -> POST /observatory/phone/init
 *   Step 2  6-digit OTP      -> POST /observatory/phone/verify-otp
 *   Step 3  4-digit PIN      -> POST /observatory/phone/verify-pin
 *
 * Staff-ID flow (Future, stubbed against legacy /observatory/login):
 *   Staff ID + NIN + Password (+ optional council/reg)
 *
 * Test super-admin accounts (bypass RBAC):
 *   +2207770001 / PIN 1111 / Dr. Lamin Touray (DG)
 *   +2207770002 / PIN 2222 / Mariama Sanneh-Camara (PS)
 *   +2207770003 / PIN 3333 / Ousman Jallow (ICT)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  X, Lock, Landmark, Shield, ShieldCheck, CheckCircle2, ArrowRight,
  AlertTriangle, ChevronDown, Eye, EyeOff, KeyRound, Smartphone,
  IdCard, MessageSquare, Clock, Layers, Info, ArrowLeft,
} from "lucide-react";

import { Button } from "./primitives/index.jsx";
import { SyntheticBanner, SyntheticFooter } from "./SyntheticIndicators.jsx";
import { clearObservatoryConsent } from "../auth/signOut.js";


/* ─── constants ───────────────────────────────────────────────── */

const API = ((typeof window !== "undefined" && window.AMINA_API) || "http://localhost:8000")
  .replace(/\/+$/, "");

const COUNCIL_OPTIONS = [
  { value: "GNMC", label: "GNMC — Nursing & Midwifery" },
  { value: "GMDC", label: "GMDC — Medical & Dental" },
  { value: "GPC",  label: "GPC — Pharmacy" },
  { value: "AHPC", label: "AHPC — Allied Health" },
];

const OTP_TTL_SECONDS = 300;        // 5 min OTP expiry
const PIN_LENGTH = 4;
const OTP_LENGTH = 6;


/* ─── helpers ─────────────────────────────────────────────────── */

function fmtCountdown(secs) {
  if (secs <= 0) return "expired";
  const m = Math.floor(secs / 60);
  const s = String(secs % 60).padStart(2, "0");
  return `expires in ${m}:${s}`;
}

function maskPhone(p) {
  if (!p) return "··";
  const tail = p.replace(/\D/g, "").slice(-4);
  return tail || "··";
}

function normalizeGambianPhone(raw) {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.startsWith("220") && digits.length === 10) return "+" + digits;
  if (digits.length === 7) return "+220" + digits;
  if (digits.startsWith("00220")) return "+220" + digits.slice(5);
  return null;
}


/* ─── sub-components ──────────────────────────────────────────── */

// 5-stripe Gambian flag (red / white / blue / white / green, 2:1:4:1:2)
function GambianFlag({ height = 14, className = "" }) {
  const w = Math.round(height * 1.5);
  const u = height / 10;
  return (
    <span className={`gp-flag ${className}`} style={{
      display: "inline-block", width: w, height,
      borderRadius: 2, overflow: "hidden", flexShrink: 0,
      boxShadow: "0 0 0 1px rgba(255,255,255,0.18) inset",
    }} aria-hidden="true">
      <div style={{ height: u * 2, background: "#CE1126" }} />
      <div style={{ height: u,     background: "#fff"    }} />
      <div style={{ height: u * 4, background: "#0C1C8C" }} />
      <div style={{ height: u,     background: "#fff"    }} />
      <div style={{ height: u * 2, background: "#3A7728" }} />
    </span>
  );
}

function StatusPill({ kind = "ok", children }) {
  const palettes = {
    live:    { bg: "rgba(52,211,153,0.14)",  fg: "#6ee7b7", dot: "#34d399" },
    future:  { bg: "rgba(251,191,36,0.14)",  fg: "#fcd34d", dot: "#fbbf24" },
    info:    { bg: "rgba(96,165,250,0.14)",  fg: "#93c5fd", dot: "#60a5fa" },
    accent:  { bg: "rgba(167,139,250,0.14)", fg: "#c4b5fd", dot: "#a78bfa" },
  };
  const p = palettes[kind] || palettes.live;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "2px 9px", borderRadius: 999,
      background: p.bg, color: p.fg,
      fontSize: 9.5, fontWeight: 700, letterSpacing: "0.04em",
      textTransform: "uppercase",
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: p.dot }} />
      {children}
    </span>
  );
}

function StepBar({ current }) {
  // current: 1, 2, or 3
  const labels = ["Phone", "OTP", "PIN"];
  const items = [];
  for (let i = 0; i < 3; i++) {
    if (i > 0) {
      items.push(
        <span key={`l${i}`}
              className={`gp-stepbar-line${i + 1 <= current ? " gp-line-done" : ""}`} />
      );
    }
    const cls = i + 1 < current ? "gp-dot-done"
              : i + 1 === current ? "gp-dot-active"
              : "gp-dot-future";
    items.push(
      <span key={`s${i}`}
            className={`gp-stepbar-dot ${cls}`}
            data-step={i + 1}>
        {i + 1 < current ? "✓" : i + 1}
      </span>
    );
    items.push(
      <span key={`lbl${i}`}
            className={`gp-stepbar-label${i + 1 === current ? " gp-stepbar-label-active"
                                          : i + 1 < current ? " gp-stepbar-label-done" : ""}`}>
        {labels[i]}
      </span>
    );
  }
  return <div className="gp-stepbar">{items}</div>;
}

// Custom dark dropdown (replaces native <select> for cross-browser theming)
function DarkSelect({ value, onChange, placeholder, options, id }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="gp-dsel" style={{ position: "relative" }}>
      <button
        id={id}
        type="button"
        className={`gp-dsel-trigger${open ? " gp-dsel-open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span style={{ flex: 1, textAlign: "left",
                       opacity: selected ? 1 : 0.5,
                       overflow: "hidden", textOverflow: "ellipsis",
                       whiteSpace: "nowrap" }}>
          {selected ? selected.label : (placeholder || "Select…")}
        </span>
        <ChevronDown size={14} style={{
          opacity: 0.55, flexShrink: 0,
          transform: open ? "rotate(180deg)" : "rotate(0deg)",
          transition: "transform 200ms ease",
        }} />
      </button>
      {open && (
        <div className="gp-dsel-menu" role="listbox">
          {options.map((o) => (
            <div
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={`gp-dsel-option${o.value === value ? " gp-dsel-selected" : ""}`}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              <div className="gp-dsel-opt-main">{o.label}</div>
              {o.sub && <div className="gp-dsel-opt-sub">{o.sub}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Alert({ kind = "error", children }) {
  const palettes = {
    error:   { bg: "rgba(248,113,113,0.10)", br: "rgba(248,113,113,0.35)", fg: "#fecaca" },
    info:    { bg: "rgba(96,165,250,0.10)",  br: "rgba(96,165,250,0.35)",  fg: "#bfdbfe" },
    success: { bg: "rgba(52,211,153,0.10)",  br: "rgba(52,211,153,0.35)",  fg: "#a7f3d0" },
    warn:    { bg: "rgba(251,191,36,0.10)",  br: "rgba(251,191,36,0.35)",  fg: "#fde68a" },
  };
  const p = palettes[kind] || palettes.error;
  return (
    <div role={kind === "error" ? "alert" : "status"}
         className="gp-alert"
         style={{ background: p.bg, border: `1px solid ${p.br}`, color: p.fg }}>
      {children}
    </div>
  );
}


/* ─── CSS ─────────────────────────────────────────────────────── */

const MODAL_CSS = `
/* ── keyframes ───────────────────────────────────── */
@keyframes gp-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes gp-rise {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0);   }
}
@keyframes gp-slide-right {
  from { opacity: 0; transform: translateX(20px); }
  to   { opacity: 1; transform: translateX(0);    }
}
@keyframes gp-slide-left {
  from { opacity: 0; transform: translateX(-20px); }
  to   { opacity: 1; transform: translateX(0);     }
}
@keyframes gp-bounce-in {
  0%   { opacity: 0; transform: scale(0.3); }
  50%  { opacity: 1; transform: scale(1.08); }
  70%  { transform: scale(0.96); }
  100% { transform: scale(1); }
}
@keyframes gp-fade-up {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0);    }
}
@keyframes gp-shake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-5px); }
  40%, 80% { transform: translateX(5px); }
}
@keyframes gp-pop {
  0%   { transform: scale(1); }
  50%  { transform: scale(1.1); }
  100% { transform: scale(1); }
}
@keyframes gp-pulse-ring {
  0%, 100% { box-shadow: 0 0 0 0 rgba(167,139,250,0.35); }
  50%      { box-shadow: 0 0 0 6px rgba(167,139,250,0);   }
}

/* ── full-screen overlay ─────────────────────────── */
.gp-overlay {
  position: fixed; inset: 0;
  background: var(--a-bg, #06080d);
  z-index: 95;
  overflow-y: auto;
  animation: gp-fade 220ms ease;
}
.gp-bg {
  position: fixed; inset: 0;
  pointer-events: none; z-index: -1;
  background:
    radial-gradient(1100px 600px at 12% 10%, rgba(124,58,237,0.12), transparent 60%),
    radial-gradient(900px 500px at 90% 95%, rgba(58,119,40,0.08), transparent 60%),
    radial-gradient(700px 400px at 95% 5%, rgba(206,17,38,0.06), transparent 60%);
}

/* ── frame: 2-panel grid ─────────────────────────── */
.gp-frame {
  min-height: 100vh;
  display: grid; grid-template-columns: 1.1fr 1fr;
  position: relative;
}
@media (max-width: 1100px) {
  .gp-frame { grid-template-columns: 1fr; }
}

/* ── close button (top-right of overlay, below sticky banner) ─── */
.gp-close {
  position: fixed; top: 50px; right: 22px; z-index: 8500;
  background: rgba(0,0,0,0.4); border: 1px solid var(--a-border-1);
  color: var(--a-fg-mute);
  width: 36px; height: 36px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 180ms;
  backdrop-filter: blur(8px);
}
.gp-close:hover { color: var(--a-fg); border-color: var(--a-border-2); }

/* ─────────────────────────────────────────────────── */
/* LEFT BRAND PANEL                                    */
/* ─────────────────────────────────────────────────── */
.gp-brand {
  position: relative; overflow: hidden;
  padding: 42px 56px 36px;
  display: flex; flex-direction: column; justify-content: space-between;
  gap: 36px;
  border-right: 1px solid var(--a-border-1);
}
.gp-brand::before {
  content: ""; position: absolute; inset: 0;
  background:
    radial-gradient(1000px 700px at 70% 30%, rgba(167,139,250,0.10), transparent 60%),
    linear-gradient(180deg, rgba(12,28,140,0.18), transparent 50%);
  pointer-events: none;
}
.gp-brand > * { position: relative; }

.gp-mast {
  display: flex; align-items: center; gap: 14px;
}
.gp-mast-text { display: flex; flex-direction: column; gap: 2px; }
.gp-mast-ministry {
  font-size: 10.5px; letter-spacing: 0.22em;
  font-weight: 700; color: #fff; text-transform: uppercase;
}
.gp-mast-country {
  font-size: 10.5px; letter-spacing: 0.16em;
  color: var(--a-fg-dim); text-transform: uppercase; font-weight: 500;
}

.gp-pillar {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 5px 12px 5px 8px; border-radius: 999px;
  background: rgba(167,139,250,0.10);
  border: 1px solid rgba(167,139,250,0.22);
  font-size: 11px; color: #c4b5fd; letter-spacing: 0.14em;
  text-transform: uppercase; font-weight: 600; width: fit-content;
}

.gp-h1 {
  font-family: var(--a-font-disp);
  font-variation-settings: "opsz" 144;
  font-weight: 300; font-size: 52px; letter-spacing: -1px;
  line-height: 1.02; margin: 18px 0 14px; color: #fff; max-width: 14ch;
}
.gp-h1 em {
  font-style: italic; color: #a78bfa; font-weight: 300;
}
.gp-lede {
  font-size: 14.5px; line-height: 1.65;
  color: var(--a-fg-mute); max-width: 46ch;
}
.gp-lede code {
  font-family: var(--a-font-mono); font-size: 12px;
  background: rgba(167,139,250,0.10); color: #c4b5fd;
  padding: 1px 6px; border-radius: 4px;
}

.gp-tiles {
  display: grid; grid-template-columns: repeat(2, 1fr);
  gap: 10px; max-width: 520px; margin-top: 18px;
}
.gp-tile {
  padding: 13px 14px;
  border: 1px solid var(--a-border-1); border-radius: 12px;
  background: rgba(12,17,24,0.5);
  display: flex; gap: 10px; align-items: flex-start;
  backdrop-filter: blur(4px);
}
.gp-tile-icon {
  flex: none; width: 14px; height: 14px;
  color: #a78bfa; margin-top: 2px;
}
.gp-tile-title {
  font-size: 11.5px; color: #fff; font-weight: 600; letter-spacing: 0.2px;
}
.gp-tile-body {
  font-size: 11px; color: var(--a-fg-dim);
  margin-top: 3px; line-height: 1.5;
}

.gp-brand-foot {
  display: flex; justify-content: space-between; align-items: flex-end;
  gap: 24px; padding-top: 22px;
  border-top: 1px solid var(--a-border-1);
  font-size: 10.5px; color: var(--a-fg-dim);
}
.gp-brand-foot-left {
  font-family: var(--a-font-mono); letter-spacing: 0.04em;
}
.gp-brand-foot-right {
  display: flex; gap: 14px;
  font-family: var(--a-font-mono);
}

@media (max-width: 1100px) {
  .gp-brand {
    padding: 30px 28px 22px;
    border-right: none; border-bottom: 1px solid var(--a-border-1);
  }
  .gp-h1 { font-size: 38px; max-width: 18ch; }
  .gp-tiles { max-width: none; }
}

/* ─────────────────────────────────────────────────── */
/* RIGHT AUTH PANEL                                    */
/* ─────────────────────────────────────────────────── */
.gp-auth {
  display: flex; align-items: center; justify-content: center;
  padding: 42px 48px;
}
@media (max-width: 1100px) { .gp-auth { padding: 24px 16px 36px; } }

.gp-card {
  width: 100%; max-width: 480px;
  background: linear-gradient(180deg,
    color-mix(in oklab, var(--a-bg-elev-1, #161c27), transparent 5%) 0%,
    color-mix(in oklab, var(--a-bg-elev-1, #11161f), transparent 5%) 100%);
  border: 1px solid var(--a-border-2);
  border-radius: 18px;
  box-shadow: 0 24px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.02) inset;
  overflow: hidden; position: relative;
  animation: gp-rise 320ms ease;
}
.gp-card::before {
  content: ""; position: absolute; inset: 0 0 auto 0; height: 2px;
  background: linear-gradient(90deg, #CE1126 0%, #0C1C8C 50%, #3A7728 100%);
  opacity: 0.65;
}

/* ── mode switch ─────────────────────────────────── */
.gp-mode-switch {
  margin: 18px 22px 0;
  display: flex; gap: 4px; padding: 4px; border-radius: 12px;
  background: var(--a-bg-inset);
  border: 1px solid var(--a-border-1);
}
.gp-mode-btn {
  flex: 1; padding: 9px 12px; border: 0; cursor: pointer;
  background: transparent; border-radius: 9px;
  font-size: 12px; color: var(--a-fg-dim); font-weight: 600;
  letter-spacing: 0.15px;
  display: flex; align-items: center; gap: 8px; justify-content: center;
  transition: all 180ms ease;
  font-family: var(--a-font-ui);
}
.gp-mode-btn:hover:not(.gp-mode-btn-on) {
  color: var(--a-fg);
}
.gp-mode-btn-on {
  background: var(--a-bg);
  color: #fff;
  box-shadow: inset 0 0 0 1px var(--a-border-2);
}
.gp-mode-btn svg { flex-shrink: 0; }

/* ── reality / future banner ─────────────────────── */
.gp-banner {
  margin: 10px 22px 0; padding: 9px 11px;
  border-radius: 10px;
  display: flex; gap: 8px; align-items: flex-start;
  font-size: 11.5px; color: var(--a-fg-mute); line-height: 1.5;
}
.gp-banner-info {
  border: 1px solid rgba(96,165,250,0.18);
  background: rgba(96,165,250,0.05);
}
.gp-banner-info svg { color: #93c5fd; }
.gp-banner-warn {
  border: 1px solid rgba(251,191,36,0.18);
  background: rgba(251,191,36,0.05);
}
.gp-banner-warn svg { color: #fcd34d; }
.gp-banner b { color: var(--a-fg); font-weight: 600; }
.gp-banner svg { flex: none; width: 13px; height: 13px; margin-top: 1px; }

/* ── padding container ───────────────────────────── */
.gp-pad {
  padding: 22px 22px 24px;
  display: flex; flex-direction: column; gap: 16px;
}

/* ── headers ─────────────────────────────────────── */
.gp-h2 {
  font-family: var(--a-font-disp);
  font-weight: 400; font-variation-settings: "opsz" 96;
  font-size: 21px; color: #fff;
  letter-spacing: -0.3px; line-height: 1.1;
  display: flex; align-items: center; gap: 10px;
}
.gp-h2 svg { width: 19px; height: 19px; color: #a78bfa; }
.gp-sub {
  font-size: 12.5px; color: var(--a-fg-dim);
  line-height: 1.55; margin-top: -4px;
}
.gp-sub b { color: var(--a-fg-mute); font-weight: 500; }

/* ── stepbar (Phone/OTP/PIN) ─────────────────────── */
.gp-stepbar {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border-radius: 10px;
  background: var(--a-bg-inset);
  border: 1px solid var(--a-border-1);
}
.gp-stepbar-dot {
  width: 18px; height: 18px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 700;
  font-family: var(--a-font-mono); flex: none;
  background: rgba(148,163,184,0.10);
  border: 1px solid var(--a-border-1);
  color: var(--a-fg-dim);
  transition: all 300ms ease;
}
.gp-dot-active {
  background: rgba(167,139,250,0.18);
  border-color: #a78bfa; color: #a78bfa;
  animation: gp-pulse-ring 2s ease infinite;
}
.gp-dot-done {
  background: rgba(52,211,153,0.14);
  border-color: rgba(52,211,153,0.40);
  color: #34d399;
}
.gp-stepbar-line {
  flex: 1; height: 1px;
  background: var(--a-border-1);
  transition: background 300ms ease;
}
.gp-line-done { background: rgba(52,211,153,0.40); }
.gp-stepbar-label {
  font-size: 11px; color: var(--a-fg-dim); font-weight: 500;
  transition: color 300ms;
}
.gp-stepbar-label-done { color: var(--a-fg-mute); }
.gp-stepbar-label-active { color: #fff; font-weight: 600; }

/* ── form fields ─────────────────────────────────── */
.gp-field {
  display: flex; flex-direction: column; gap: 6px;
}
.gp-field-label {
  font-size: 10.5px; color: var(--a-fg-dim);
  text-transform: uppercase; letter-spacing: 0.18em; font-weight: 700;
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px;
}
.gp-field-opt {
  color: var(--a-fg-dim); text-transform: none;
  letter-spacing: 0.02em; font-weight: 500; font-size: 10.5px;
}
.gp-input {
  background: var(--a-bg-inset);
  border: 1px solid var(--a-border-1); border-radius: 10px;
  color: var(--a-fg);
  font-size: 14px; padding: 11px 13px;
  font-family: var(--a-font-ui);
  outline: none; width: 100%; box-sizing: border-box;
  transition: border-color 140ms, background 140ms, box-shadow 140ms;
}
.gp-input:focus {
  border-color: rgba(167,139,250,0.50);
  box-shadow: 0 0 0 4px rgba(167,139,250,0.10);
  background: var(--a-bg);
}
.gp-input::placeholder { color: var(--a-fg-dim); opacity: 0.5; }
.gp-input.gp-mono {
  font-family: var(--a-font-mono); letter-spacing: 0.5px;
}
.gp-input-error {
  border-color: rgba(248,113,113,0.55) !important;
  box-shadow: 0 0 0 4px rgba(248,113,113,0.10) !important;
}

.gp-input-group {
  position: relative; display: flex; align-items: stretch;
}
.gp-input-prefix {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 0 12px;
  background: var(--a-bg);
  border: 1px solid var(--a-border-1); border-right: 0;
  border-radius: 10px 0 0 10px;
  font-family: var(--a-font-mono); font-size: 13px;
  color: var(--a-fg-mute); flex: none;
}
.gp-input-group .gp-input { border-radius: 0 10px 10px 0; flex: 1; }
.gp-input-suffix-btn {
  position: absolute; right: 6px; top: 50%;
  transform: translateY(-50%);
  background: transparent; border: 0; cursor: pointer;
  color: var(--a-fg-dim); width: 30px; height: 30px;
  border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  transition: all 140ms;
}
.gp-input-suffix-btn:hover {
  color: var(--a-fg); background: rgba(148,163,184,0.06);
}

.gp-hint {
  font-size: 11px; color: var(--a-fg-dim); line-height: 1.5;
}
.gp-hint code {
  font-family: var(--a-font-mono); font-size: 11px;
  color: #a78bfa; background: rgba(167,139,250,0.08);
  padding: 1px 5px; border-radius: 3px;
}
.gp-hint a, .gp-link {
  color: #c4b5fd; text-decoration: none;
  border-bottom: 1px dashed rgba(167,139,250,0.40);
  background: transparent; border-top: 0; border-left: 0; border-right: 0;
  cursor: pointer; padding: 0; font-size: inherit;
  font-family: inherit;
}
.gp-hint a:hover, .gp-link:hover { color: #fff; }

/* ── alert ───────────────────────────────────────── */
.gp-alert {
  padding: 10px 12px; border-radius: 10px;
  font-size: 12.5px; font-weight: 500; line-height: 1.45;
  animation: gp-shake 400ms ease;
}

/* ── OTP grid (6 cells) ──────────────────────────── */
.gp-otp-row {
  display: flex; gap: 8px; justify-content: space-between;
  margin: 4px 0 6px;
}
.gp-otp-cell {
  width: 100%; height: 54px; text-align: center;
  background: var(--a-bg-inset);
  border: 1px solid var(--a-border-1); border-radius: 10px;
  color: #fff;
  font-size: 22px; font-family: var(--a-font-mono);
  font-weight: 600; font-variant-numeric: tabular-nums;
  outline: none;
  transition: all 180ms;
}
.gp-otp-cell:focus {
  border-color: rgba(167,139,250,0.55);
  box-shadow: 0 0 0 4px rgba(167,139,250,0.10);
  background: var(--a-bg);
}
.gp-otp-filled {
  border-color: rgba(167,139,250,0.40);
  color: #a78bfa;
  animation: gp-pop 200ms ease;
}
.gp-otp-meta {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 11.5px; color: var(--a-fg-dim);
  font-family: var(--a-font-mono); margin-top: 6px;
}
.gp-otp-timer { color: #fcd34d; }
.gp-otp-timer-expired { color: #fb7185; }
.gp-otp-actions {
  display: flex; justify-content: space-between; align-items: center;
  margin-top: 8px;
}

/* ── PIN keypad (4 cells, masked) ────────────────── */
.gp-pin-row {
  display: flex; gap: 10px; justify-content: center;
  margin: 8px 0 6px;
}
.gp-pin-cell {
  width: 50px; height: 60px; text-align: center;
  background: var(--a-bg-inset);
  border: 1px solid var(--a-border-1); border-radius: 12px;
  color: #fff;
  font-size: 26px; font-family: var(--a-font-mono); font-weight: 600;
  outline: none;
  transition: all 180ms;
}
.gp-pin-cell:focus {
  border-color: rgba(167,139,250,0.55);
  box-shadow: 0 0 0 4px rgba(167,139,250,0.10);
  background: var(--a-bg);
}
.gp-pin-filled {
  border-color: rgba(167,139,250,0.40);
  animation: gp-pop 200ms ease;
}

/* ── primary CTA ─────────────────────────────────── */
.gp-cta {
  width: 100%; padding: 13px 16px;
  border-radius: 11px; border: 0;
  background: linear-gradient(135deg, #6d4ce8 0%, #7c3aed 50%, #a78bfa 100%);
  color: #fff;
  font-size: 14px; font-weight: 600; letter-spacing: 0.2px;
  cursor: pointer;
  box-shadow: 0 8px 18px rgba(124,58,237,0.30);
  display: flex; align-items: center; justify-content: center; gap: 8px;
  transition: all 140ms ease;
  font-family: var(--a-font-ui);
}
.gp-cta:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 12px 26px rgba(124,58,237,0.40);
}
.gp-cta:active { transform: translateY(0); }
.gp-cta:disabled {
  opacity: 0.55; cursor: not-allowed;
  box-shadow: none;
}

/* ── alt actions row ─────────────────────────────── */
.gp-alt {
  display: flex; justify-content: space-between; align-items: center;
  margin-top: 8px; gap: 10px; flex-wrap: wrap;
  font-size: 11.5px; color: var(--a-fg-dim);
}

/* ── row-2 (council + reg) ───────────────────────── */
.gp-row-2 {
  display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
}

/* ── dark dropdown (facility / council) ──────────── */
.gp-dsel-trigger {
  width: 100%; box-sizing: border-box;
  padding: 11px 13px;
  background: var(--a-bg-inset);
  border: 1px solid var(--a-border-1); border-radius: 10px;
  color: var(--a-fg); font-family: var(--a-font-ui); font-size: 14px;
  outline: none; cursor: pointer;
  display: flex; align-items: center; gap: 8px;
  transition: all 140ms;
}
.gp-dsel-trigger:hover, .gp-dsel-trigger:focus {
  border-color: rgba(167,139,250,0.50);
  background: var(--a-bg);
}
.gp-dsel-open {
  border-color: rgba(167,139,250,0.50);
  box-shadow: 0 0 0 4px rgba(167,139,250,0.10);
  background: var(--a-bg);
}
.gp-dsel-menu {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0;
  background: var(--a-bg-elev-1, #161c27);
  border: 1px solid var(--a-border-2); border-radius: 10px;
  overflow: hidden auto;
  max-height: 280px;
  z-index: 30;
  box-shadow: 0 12px 28px rgba(0,0,0,0.45);
  animation: gp-fade 120ms ease;
}
.gp-dsel-option {
  padding: 10px 13px; cursor: pointer;
  transition: background 120ms;
  border-bottom: 1px solid var(--a-border-1);
}
.gp-dsel-option:last-child { border-bottom: 0; }
.gp-dsel-option:hover { background: var(--a-bg-inset); }
.gp-dsel-selected {
  background: rgba(167,139,250,0.08);
}
.gp-dsel-opt-main {
  font-size: 13px; color: var(--a-fg);
}
.gp-dsel-selected .gp-dsel-opt-main { color: #c4b5fd; font-weight: 500; }
.gp-dsel-opt-sub {
  font-size: 10.5px; color: var(--a-fg-dim);
  margin-top: 2px; letter-spacing: 0.02em;
}

/* ── security strip (footer in card) ─────────────── */
.gp-secstrip {
  display: grid; grid-template-columns: repeat(4, 1fr);
  border-top: 1px solid var(--a-border-1);
}
.gp-secstrip > div {
  padding: 12px 14px;
  border-right: 1px solid var(--a-border-1);
  font-size: 10.5px; color: var(--a-fg-dim); line-height: 1.45;
}
.gp-secstrip > div:last-child { border-right: 0; }
.gp-secstrip svg {
  width: 13px; height: 13px;
  color: var(--a-fg-mute); margin-bottom: 6px;
}
.gp-secstrip b {
  color: var(--a-fg); font-weight: 600;
  font-size: 11px; display: block; margin-bottom: 2px;
}

/* ── success state ───────────────────────────────── */
.gp-success {
  padding: 30px 22px; text-align: center;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
}
.gp-success-emblem {
  width: 64px; height: 64px; border-radius: 50%;
  background: rgba(52,211,153,0.14);
  display: grid; place-items: center;
  color: #34d399; margin-bottom: 8px;
  animation: gp-bounce-in 500ms ease;
}
.gp-success-name {
  font-family: var(--a-font-disp); font-size: 19px;
  font-weight: 500; color: #fff;
  animation: gp-fade-up 400ms ease 200ms both;
}
.gp-success-role {
  font-size: 13px; color: var(--a-fg-mute);
  animation: gp-fade-up 400ms ease 350ms both;
}
.gp-success-meta {
  font-family: var(--a-font-mono);
  font-size: 11px; letter-spacing: 0.06em;
  color: var(--a-fg-dim); margin-top: 6px;
  animation: gp-fade-up 400ms ease 500ms both;
}
.gp-success-redirect {
  margin-top: 14px; font-size: 12px;
  color: var(--a-fg-dim);
  display: inline-flex; align-items: center; gap: 6px;
  animation: gp-fade-up 400ms ease 650ms both;
}

/* ── locked state ────────────────────────────────── */
.gp-locked {
  padding: 32px 22px; text-align: center;
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  animation: gp-shake 400ms ease;
}

/* ── dev hint banner ─────────────────────────────── */
.gp-dev-hint {
  margin-top: -2px;
  font-size: 10.5px; color: #6ee7b7;
  font-family: var(--a-font-mono);
  background: rgba(52,211,153,0.06);
  border: 1px dashed rgba(52,211,153,0.25);
  border-radius: 6px;
  padding: 6px 9px;
}

/* ── step transition wrapper ─────────────────────── */
.gp-step-fwd, .gp-step-back {
  display: flex; flex-direction: column; gap: 16px;
}
.gp-step-fwd  { animation: gp-slide-right 280ms ease-out; }
.gp-step-back { animation: gp-slide-left  280ms ease-out; }
.gp-step-fwd > .a-btn,
.gp-step-back > .a-btn {
  margin-top: 6px;
}

/* ── responsive smaller card ─────────────────────── */
@media (max-width: 1100px) {
  .gp-h2 { font-size: 19px; }
  .gp-h1 { font-size: 36px; }
}
`;

if (typeof document !== "undefined") {
  let _s = document.getElementById("amina-gp-css");
  if (!_s) {
    _s = document.createElement("style");
    _s.id = "amina-gp-css";
    document.head.appendChild(_s);
  }
  _s.textContent = MODAL_CSS;
}


/* ════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ════════════════════════════════════════════════════════════════ */

export default function GovPortalModal({ open, onClose }) {

  /* ── auth mode ──────────────────────────────────────────── */
  const [mode, setMode] = useState("phone");  // "phone" | "staff"

  /* ── facilities (loaded once on open) ───────────────────── */
  const [facilities, setFacilities] = useState([]);

  /* ── PHONE FLOW state ───────────────────────────────────── */
  const [phoneStep, setPhoneStep]       = useState(1);  // 1 | 2 | 3
  const [phoneStepDir, setPhoneStepDir] = useState("fwd");
  const [phone, setPhone]               = useState("");
  const [facility, setFacility]         = useState("");
  const [phoneSession, setPhoneSession] = useState("");
  const [phoneHint, setPhoneHint]       = useState("");
  const [otpDigits, setOtpDigits]       = useState(["", "", "", "", "", ""]);
  const [pinDigits, setPinDigits]       = useState(["", "", "", ""]);
  const [otpExpiresAt, setOtpExpiresAt] = useState(0);
  const [otpSecLeft, setOtpSecLeft]     = useState(0);
  const [devOtpEcho, setDevOtpEcho]     = useState("");
  const otpRefs                         = useRef([]);
  const pinRefs                         = useRef([]);

  /* ── STAFF-ID FLOW state (Future stub) ─────────────────── */
  const [staffId, setStaffId]         = useState("");
  const [staffNin, setStaffNin]       = useState("");
  const [staffPw, setStaffPw]         = useState("");
  const [showStaffPw, setShowStaffPw] = useState(false);
  const [staffCouncil, setStaffCouncil] = useState("");
  const [staffRegNum, setStaffRegNum]   = useState("");

  /* ── general ────────────────────────────────────────────── */
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState("");
  const [officer, setOfficer]   = useState(null);
  const [lockedMsg, setLockedMsg] = useState("");
  const [view, setView]         = useState("form");  // form | success | locked

  /* ── reset on open ──────────────────────────────────────── */
  useEffect(() => {
    if (!open) return;
    setMode("phone");
    setPhoneStep(1); setPhoneStepDir("fwd");
    setPhone(""); setFacility(""); setPhoneSession("");
    setPhoneHint(""); setOtpDigits(["","","","","",""]);
    setPinDigits(["","","",""]);
    setOtpExpiresAt(0); setOtpSecLeft(0); setDevOtpEcho("");
    setStaffId(""); setStaffNin(""); setStaffPw(""); setShowStaffPw(false);
    setStaffCouncil(""); setStaffRegNum("");
    setBusy(false); setError(""); setOfficer(null); setLockedMsg("");
    setView("form");
  }, [open]);

  /* ── ESC closes ─────────────────────────────────────────── */
  useEffect(() => {
    if (!open) return;
    const fn = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [open, onClose]);

  /* ── load facilities once ──────────────────────────────── */
  useEffect(() => {
    if (!open) return;
    if (facilities.length > 0) return;
    let cancelled = false;
    fetch(`${API}/api/v1/observatory/phone/facilities`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const list = (d.facilities || []).map((f) => ({
          value: f.id, label: f.name, sub: `${f.city} · ${f.region}`,
        }));
        setFacilities(list);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open, facilities.length]);

  /* ── OTP countdown ─────────────────────────────────────── */
  useEffect(() => {
    if (!otpExpiresAt) { setOtpSecLeft(0); return; }
    const tick = () => {
      const s = Math.max(0, Math.round((otpExpiresAt - Date.now()) / 1000));
      setOtpSecLeft(s);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [otpExpiresAt]);

  /* ── step transition helper ────────────────────────────── */
  const goStep = useCallback((n, dir = "fwd") => {
    setPhoneStepDir(dir); setPhoneStep(n); setError("");
  }, []);

  /* ─────────────────────────────────────────────────────────
     PHONE FLOW handlers
     ───────────────────────────────────────────────────────── */

  const submitPhoneInit = useCallback(async () => {
    const norm = normalizeGambianPhone(phone);
    if (!norm) {
      setError("Enter a valid Gambian phone number (+220 followed by 7 digits).");
      return;
    }
    setBusy(true); setError("");
    try {
      const r = await fetch(`${API}/api/v1/observatory/phone/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: norm,
          facility_id: facility || null,
        }),
      });
      const d = await r.json().catch(() => ({}));

      if (d.locked) {
        setLockedMsg(d.message || "Account locked.");
        setView("locked"); setBusy(false); return;
      }
      if (!r.ok) {
        const detail = d.detail || {};
        setError(detail.message || detail.code || d.message || "Could not start sign-in.");
        setBusy(false); return;
      }
      if (d.status === "otp_required") {
        setPhoneSession(d.session_id);
        setPhoneHint(d.phone_hint || maskPhone(norm));
        setOtpExpiresAt(Date.now() + (d.expires_in_seconds || OTP_TTL_SECONDS) * 1000);
        // Dev mode: auto-fill OTP if echoed
        if (d._dev_otp) {
          const arr = String(d._dev_otp).split("").slice(0, OTP_LENGTH);
          setOtpDigits(arr);
          setDevOtpEcho(d._dev_otp);
        } else {
          setOtpDigits(["","","","","",""]);
          setDevOtpEcho("");
        }
        goStep(2, "fwd");
        setBusy(false);
        // Focus first OTP cell shortly
        setTimeout(() => otpRefs.current[0]?.focus(), 100);
        return;
      }
      setError("Unexpected response from server.");
    } catch {
      setError("Network error -- check your connection.");
    } finally {
      setBusy(false);
    }
  }, [phone, facility, goStep]);

  const submitOtp = useCallback(async () => {
    const otp = otpDigits.join("");
    if (otp.length !== OTP_LENGTH) return;
    setBusy(true); setError("");
    try {
      const r = await fetch(`${API}/api/v1/observatory/phone/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: phoneSession, otp }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const detail = d.detail || {};
        setError(detail.message || "Invalid verification code.");
        setOtpDigits(["","","","","",""]);
        otpRefs.current[0]?.focus();
        setBusy(false); return;
      }
      if (d.status === "pin_required") {
        goStep(3, "fwd");
        setPinDigits(["","","",""]);
        setBusy(false);
        setTimeout(() => pinRefs.current[0]?.focus(), 100);
        return;
      }
      setError("Unexpected response from server.");
    } catch {
      setError("Network error -- check your connection.");
    } finally {
      setBusy(false);
    }
  }, [otpDigits, phoneSession, goStep]);

  const submitPin = useCallback(async () => {
    const pin = pinDigits.join("");
    if (pin.length !== PIN_LENGTH) return;
    setBusy(true); setError("");
    try {
      const r = await fetch(`${API}/api/v1/observatory/phone/verify-pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: phoneSession, pin }),
      });
      const d = await r.json().catch(() => ({}));

      if (d.locked) {
        setLockedMsg(d.message || "Locked.");
        setView("locked"); setBusy(false); return;
      }
      if (!r.ok) {
        const detail = d.detail || {};
        const left = detail.attempts_remaining;
        const baseMsg = detail.message || "Incorrect PIN.";
        setError(typeof left === "number"
          ? `${baseMsg} (${left} attempt${left === 1 ? "" : "s"} left)`
          : baseMsg);
        setPinDigits(["","","",""]);
        pinRefs.current[0]?.focus();
        setBusy(false); return;
      }
      if (d.token) {
        try {
          localStorage.setItem("AMINA_ADMIN_TOKEN", d.token);
          localStorage.setItem("AMINA_GOV_OFFICIAL", JSON.stringify(d.officer || {}));
        } catch {}
        // Re-prompt the policy gate every gov sign-in (covers the
        // sign-out-then-sign-back-in-within-same-tab case).
        clearObservatoryConsent();
        try { window.dispatchEvent(new CustomEvent("amina:auth-changed")); } catch {}
        setOfficer(d.officer || null);
        setView("success");
        setBusy(false);
        setTimeout(() => { window.location.hash = "#/gov"; }, 1300);
      }
    } catch {
      setError("Network error -- check your connection.");
    } finally {
      setBusy(false);
    }
  }, [pinDigits, phoneSession]);

  /* ── auto-submit OTP / PIN when complete ───────────────── */
  useEffect(() => {
    if (mode === "phone" && phoneStep === 2
        && otpDigits.every((d) => d.length === 1) && !busy) {
      submitOtp();
    }
  }, [otpDigits, phoneStep, mode, busy, submitOtp]);

  useEffect(() => {
    if (mode === "phone" && phoneStep === 3
        && pinDigits.every((d) => d.length === 1) && !busy) {
      submitPin();
    }
  }, [pinDigits, phoneStep, mode, busy, submitPin]);

  /* ── OTP / PIN cell handlers ───────────────────────────── */
  const handleCellChange = (digits, setDigits, refs, idx, value) => {
    if (!/^\d*$/.test(value)) return;
    const next = [...digits];
    next[idx] = value.slice(-1);
    setDigits(next);
    if (value && idx < digits.length - 1) refs.current[idx + 1]?.focus();
  };

  const handleCellKeyDown = (digits, refs, idx, e) => {
    if (e.key === "Backspace" && !digits[idx] && idx > 0) {
      refs.current[idx - 1]?.focus();
    }
  };

  const handleOtpPaste = (e) => {
    e.preventDefault();
    const txt = (e.clipboardData.getData("text") || "")
      .replace(/\D/g, "").slice(0, OTP_LENGTH);
    if (txt.length === OTP_LENGTH) {
      setOtpDigits(txt.split(""));
      otpRefs.current[OTP_LENGTH - 1]?.focus();
    }
  };

  const resendOtp = useCallback(async () => {
    if (busy || !phone) return;
    setBusy(true); setError("");
    try {
      const r = await fetch(`${API}/api/v1/observatory/phone/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: normalizeGambianPhone(phone) || phone,
          facility_id: facility || null,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (d.status === "otp_required") {
        setPhoneSession(d.session_id);
        setOtpExpiresAt(Date.now() + (d.expires_in_seconds || OTP_TTL_SECONDS) * 1000);
        setOtpDigits(["","","","","",""]);
        if (d._dev_otp) {
          setOtpDigits(String(d._dev_otp).split("").slice(0, OTP_LENGTH));
          setDevOtpEcho(d._dev_otp);
        }
      } else {
        setError(d.message || "Could not resend code.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }, [busy, phone, facility]);

  /* ─────────────────────────────────────────────────────────
     STAFF-ID FLOW handler (legacy /observatory/login)
     ───────────────────────────────────────────────────────── */

  const submitStaffLogin = useCallback(async () => {
    if (!staffId.trim() || !staffNin.trim() || staffPw.length < 8) return;
    setBusy(true); setError("");
    try {
      const r = await fetch(`${API}/api/v1/observatory/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staff_id: staffId.trim().toUpperCase(),
          nin:      staffNin.trim(),
          password: staffPw,
        }),
      });
      const d = await r.json().catch(() => ({}));

      if (d.locked) {
        setLockedMsg(d.message || "Account locked.");
        setView("locked"); setBusy(false); return;
      }
      if (!r.ok) {
        const detail = d.detail || {};
        setError(detail.message || d.message || "Sign-in failed.");
        setBusy(false); return;
      }
      // Either OTP-required (new flow) or direct token (legacy)
      if (d.token) {
        try {
          localStorage.setItem("AMINA_ADMIN_TOKEN", d.token);
          localStorage.setItem("AMINA_GOV_OFFICIAL", JSON.stringify(d.official || d.officer || {}));
        } catch {}
        // Re-prompt the policy gate every gov sign-in.
        clearObservatoryConsent();
        try { window.dispatchEvent(new CustomEvent("amina:auth-changed")); } catch {}
        setOfficer(d.official || d.officer || null);
        setView("success");
        setBusy(false);
        setTimeout(() => { window.location.hash = "#/gov"; }, 1300);
        return;
      }
      if (d.status === "otp_required") {
        // Staff-id flow ALSO yields OTP -- jump into the same OTP step
        setPhoneSession(d.session_id);
        setPhoneHint(d.phone_hint || "··");
        setOtpExpiresAt(Date.now() + (d.expires_in_seconds || OTP_TTL_SECONDS) * 1000);
        if (d._dev_otp) {
          setOtpDigits(String(d._dev_otp).split("").slice(0, OTP_LENGTH));
          setDevOtpEcho(d._dev_otp);
        }
        // Switch to phone-mode OTP step (the OTP UI is the same)
        setMode("phone");
        goStep(2, "fwd");
        setBusy(false);
        setTimeout(() => otpRefs.current[0]?.focus(), 100);
        return;
      }
      setError("Unexpected response from server.");
    } catch {
      setError("Network error -- check your connection.");
    } finally {
      setBusy(false);
    }
  }, [staffId, staffNin, staffPw, goStep]);

  /* ─────────────────────────────────────────────────────────
     RENDER
     ───────────────────────────────────────────────────────── */

  if (!open) return null;

  const phoneNorm = normalizeGambianPhone(phone);
  const canSubmitPhone = !!phoneNorm && !busy;
  const canSubmitStaff = !!staffId.trim() && !!staffNin.trim()
                          && staffPw.length >= 8 && !busy;

  return (
    <div className="gp-overlay">
      <div className="gp-bg" />
      <SyntheticBanner />
      <button type="button" className="gp-close"
              onClick={onClose} aria-label="Close sign-in">
        <X size={16} />
      </button>

      <div className="gp-frame">
        {/* ═══════════ LEFT BRAND PANEL ═══════════ */}
        <aside className="gp-brand">
          <div>
            <div className="gp-mast">
              <GambianFlag height={28} />
              <div className="gp-mast-text">
                <span className="gp-mast-ministry">Ministry of Health</span>
                <span className="gp-mast-country">
                  Republic of The Gambia · MoH ICT Unit
                </span>
              </div>
            </div>

            <h1 className="gp-h1">
              The NCD <em>Observatory</em>
            </h1>
            <p className="gp-lede">
              A national surveillance workspace for non-communicable
              diseases — built for the realities of MoH staff working from
              health centres, district offices, and field outposts across
              {" "}<code>Banjul</code>, <code>Kanifing</code>, and the
              regional councils.
            </p>

            <div className="gp-tiles">
              <div className="gp-tile">
                <Shield className="gp-tile-icon" size={14} />
                <div>
                  <div className="gp-tile-title">Aggregate-only access</div>
                  <div className="gp-tile-body">
                    No patient PII is shown to officers. Only de-identified
                    counts and indicators.
                  </div>
                </div>
              </div>
              <div className="gp-tile">
                <Clock className="gp-tile-icon" size={14} />
                <div>
                  <div className="gp-tile-title">Audited & time-bound</div>
                  <div className="gp-tile-body">
                    Every session is recorded. Sessions expire after 8 hours
                    of inactivity.
                  </div>
                </div>
              </div>
              <div className="gp-tile">
                <MessageSquare className="gp-tile-icon" size={14} />
                <div>
                  <div className="gp-tile-title">Works on basic phones</div>
                  <div className="gp-tile-body">
                    SMS-based OTP works on any handset. No smartphone or
                    app required.
                  </div>
                </div>
              </div>
              <div className="gp-tile">
                <Layers className="gp-tile-icon" size={14} />
                <div>
                  <div className="gp-tile-title">GAMBIS-ready</div>
                  <div className="gp-tile-body">
                    When the national digital ID API launches, we'll switch
                    on Staff-ID + NIN seamlessly.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="gp-brand-foot">
            <span className="gp-brand-foot-left">
              v0.7 · powered by AMINA Health Intelligence
            </span>
            <span className="gp-brand-foot-right">
              <span style={{ opacity: 0.7 }}>MoH ICT Unit</span>
              <span style={{ opacity: 0.7 }}>All systems green</span>
            </span>
          </div>
        </aside>

        {/* ═══════════ RIGHT AUTH PANEL ═══════════ */}
        <main className="gp-auth">
          <div className="gp-card">

            {/* mode switch (hidden during success/locked) */}
            {view === "form" && (
              <>
                <div className="gp-mode-switch" role="tablist"
                     aria-label="Authentication mode">
                  <button type="button" role="tab"
                          aria-pressed={mode === "phone"}
                          className={`gp-mode-btn${mode === "phone" ? " gp-mode-btn-on" : ""}`}
                          onClick={() => { setMode("phone"); setError(""); }}>
                    <Smartphone size={13} />
                    <span>Phone & OTP</span>
                    <StatusPill kind="live">Live</StatusPill>
                  </button>
                  <button type="button" role="tab"
                          aria-pressed={mode === "staff"}
                          className={`gp-mode-btn${mode === "staff" ? " gp-mode-btn-on" : ""}`}
                          onClick={() => { setMode("staff"); setError(""); }}>
                    <IdCard size={13} />
                    <span>Staff ID & NIN</span>
                    <StatusPill kind="future">Future</StatusPill>
                  </button>
                </div>

                {/* mode-aware reality note */}
                {mode === "phone" ? (
                  <div className="gp-banner gp-banner-info">
                    <Info />
                    <span>
                      <b>Current reality.</b> Most MoH staff don't yet have
                      digital portals or ministry-issued Staff IDs in
                      production. Phone + SMS OTP works today — and proves
                      identity in the Gambian context.
                    </span>
                  </div>
                ) : (
                  <div className="gp-banner gp-banner-warn">
                    <Info />
                    <span>
                      <b>Future-ready.</b> This flow goes live when Gambia's
                      GAMBIS national digital ID API publishes its endpoint.
                      Until then, NIN is validated by format only and Staff
                      IDs are checked against the internal MoH register.
                    </span>
                  </div>
                )}
              </>
            )}

            {/* ═════════ SUCCESS ═════════ */}
            {view === "success" && officer && (
              <div className="gp-success">
                <div className="gp-success-emblem">
                  <CheckCircle2 size={32} strokeWidth={2.2} />
                </div>
                <div className="gp-success-name">{officer.name}</div>
                <div className="gp-success-role">
                  {officer.title || officer.role}
                </div>
                <div className="gp-success-meta">
                  {officer.department || officer.ministry || "Ministry of Health"}
                  {" "}· {officer.staff_id}
                </div>
                <div className="gp-success-redirect">
                  <span>Entering Observatory</span>
                  <ArrowRight size={12} />
                </div>
              </div>
            )}

            {/* ═════════ LOCKED ═════════ */}
            {view === "locked" && (
              <div className="gp-locked">
                <AlertTriangle size={42} style={{ color: "#fcd34d" }} />
                <div style={{ fontSize: 17, fontWeight: 600, color: "#fff" }}>
                  Account Locked
                </div>
                <div style={{ fontSize: 13, color: "var(--a-fg-mute)",
                              lineHeight: 1.5, maxWidth: "32ch" }}>
                  {lockedMsg}
                </div>
                <Button variant="secondary" size="md"
                        onClick={() => { setView("form"); setError(""); }}>
                  Try again
                </Button>
              </div>
            )}

            {/* ═════════ FORM (PHONE MODE) ═════════ */}
            {view === "form" && mode === "phone" && (
              <section className="gp-pad">
                <div className="gp-h2">
                  <Landmark size={19} />
                  Sign in to the Observatory
                </div>
                <div className="gp-sub">
                  Enter the phone number registered with the
                  {" "}<b>MoH ICT Unit</b>. We'll send you a one-time
                  code and ask for your 4-digit PIN.
                </div>

                <StepBar current={phoneStep} />

                <div key={phoneStep}
                     className={phoneStepDir === "fwd" ? "gp-step-fwd" : "gp-step-back"}>

                  {error && <Alert kind="error">{error}</Alert>}

                  {/* ── STEP 1: phone + facility ── */}
                  {phoneStep === 1 && (
                    <>
                      <div className="gp-field">
                        <label className="gp-field-label">
                          Phone number
                          <span className="gp-field-opt">SMS will be sent to this number</span>
                        </label>
                        <div className="gp-input-group">
                          <span className="gp-input-prefix">
                            <GambianFlag height={12} />
                            +220
                          </span>
                          <input
                            className="gp-input gp-mono"
                            inputMode="tel"
                            placeholder="7 654 321"
                            value={phone.replace(/^\+220/, "")}
                            onChange={(e) => setPhone(e.target.value.replace(/[^\d ]/g, ""))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && canSubmitPhone) submitPhoneInit();
                            }}
                            autoFocus
                          />
                        </div>
                        <div className="gp-hint">
                          Test super-admins:{" "}
                          <code>+220 777 0001</code>{" / "}
                          <code>0002</code>{" / "}
                          <code>0003</code>
                        </div>
                      </div>

                      <div className="gp-field">
                        <label className="gp-field-label">
                          Facility or region
                          <span className="gp-field-opt">helps us route your session</span>
                        </label>
                        <DarkSelect
                          id="gp-facility"
                          value={facility}
                          onChange={setFacility}
                          placeholder="Select a facility (optional)…"
                          options={facilities}
                        />
                      </div>

                      <Button
                        variant="primary" size="lg"
                        onClick={submitPhoneInit}
                        loading={busy}
                        disabled={!canSubmitPhone}
                        leadIcon={MessageSquare}
                        className="gp-cta-wrap"
                      >
                        {busy ? "Sending OTP..." : "Send 6-digit OTP via SMS"}
                      </Button>

                      <div className="gp-alt">
                        <span>Rate-limited: 5 attempts per phone per hour.</span>
                        <button type="button" className="gp-link" disabled>
                          Lost access?
                        </button>
                      </div>
                    </>
                  )}

                  {/* ── STEP 2: OTP ── */}
                  {phoneStep === 2 && (
                    <>
                      <div className="gp-field">
                        <label className="gp-field-label">
                          One-time code
                          <span className="gp-field-opt">6 digits · sent by SMS</span>
                        </label>
                        <div className="gp-otp-row" onPaste={handleOtpPaste}>
                          {otpDigits.map((digit, i) => (
                            <input
                              key={i}
                              ref={(el) => { otpRefs.current[i] = el; }}
                              type="text"
                              inputMode="numeric"
                              maxLength={1}
                              className={`gp-otp-cell gp-mono${digit ? " gp-otp-filled" : ""}`}
                              value={digit}
                              onChange={(e) => handleCellChange(otpDigits, setOtpDigits, otpRefs, i, e.target.value)}
                              onKeyDown={(e) => handleCellKeyDown(otpDigits, otpRefs, i, e)}
                              aria-label={`Digit ${i + 1}`}
                            />
                          ))}
                        </div>

                        {devOtpEcho && (
                          <div className="gp-dev-hint">
                            DEV: OTP auto-filled ({devOtpEcho}). Hit verify or wait for auto-submit.
                          </div>
                        )}

                        <div className="gp-otp-meta">
                          <span>
                            Sent to <code>+220 ··· {phoneHint}</code>
                            {" · "}session{" "}
                            <code style={{ color: "var(--a-fg-dim)" }}>
                              {phoneSession.slice(-8)}
                            </code>
                          </span>
                          <span className={otpSecLeft <= 0
                            ? "gp-otp-timer-expired" : "gp-otp-timer"}>
                            {fmtCountdown(otpSecLeft)}
                          </span>
                        </div>

                        <div className="gp-otp-actions">
                          <button type="button" className="gp-link"
                                  onClick={() => goStep(1, "back")}>
                            <ArrowLeft size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />
                            Wrong number?
                          </button>
                          <button type="button" className="gp-link"
                                  onClick={resendOtp} disabled={busy}>
                            Resend code
                          </button>
                        </div>
                      </div>

                      <Button
                        variant="primary" size="lg"
                        onClick={submitOtp}
                        loading={busy}
                        disabled={otpDigits.some((d) => !d) || busy}
                        tailIcon={ArrowRight}
                      >
                        {busy ? "Verifying..." : "Verify code"}
                      </Button>
                    </>
                  )}

                  {/* ── STEP 3: PIN ── */}
                  {phoneStep === 3 && (
                    <>
                      <div className="gp-field">
                        <label className="gp-field-label">
                          4-digit PIN
                          <span className="gp-field-opt">set during onboarding</span>
                        </label>
                        <div className="gp-pin-row">
                          {pinDigits.map((digit, i) => (
                            <input
                              key={i}
                              ref={(el) => { pinRefs.current[i] = el; }}
                              type="password"
                              inputMode="numeric"
                              maxLength={1}
                              className={`gp-pin-cell gp-mono${digit ? " gp-pin-filled" : ""}`}
                              value={digit}
                              onChange={(e) => handleCellChange(pinDigits, setPinDigits, pinRefs, i, e.target.value)}
                              onKeyDown={(e) => handleCellKeyDown(pinDigits, pinRefs, i, e)}
                              autoFocus={i === 0}
                              aria-label={`PIN digit ${i + 1}`}
                            />
                          ))}
                        </div>
                        <div className="gp-hint" style={{ textAlign: "center", marginTop: 6 }}>
                          Forgot PIN? An ICT officer can reset it after voice verification.
                          {" "}<span className="gp-link">request reset</span>.
                        </div>
                      </div>

                      <Button
                        variant="primary" size="lg"
                        onClick={submitPin}
                        loading={busy}
                        disabled={pinDigits.some((d) => !d) || busy}
                        leadIcon={ShieldCheck}
                      >
                        {busy ? "Authenticating..." : "Enter the Observatory"}
                      </Button>

                      <div className="gp-alt" style={{ justifyContent: "center" }}>
                        <button type="button" className="gp-link"
                                onClick={() => goStep(2, "back")}>
                          <ArrowLeft size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />
                          Back to OTP
                        </button>
                      </div>
                    </>
                  )}

                </div>
              </section>
            )}

            {/* ═════════ FORM (STAFF-ID MODE) ═════════ */}
            {view === "form" && mode === "staff" && (
              <section className="gp-pad">
                <div className="gp-h2">
                  <IdCard size={19} />
                  Sign in with Staff ID
                </div>
                <div className="gp-sub">
                  Use your <b>Ministry-issued Staff ID</b>, your{" "}
                  <b>NIN from your GAMBIS card</b>, and your personal password.
                </div>

                {error && <Alert kind="error">{error}</Alert>}

                <div className="gp-field">
                  <label className="gp-field-label">
                    Staff ID
                    <span className="gp-field-opt">format <code>MOH-YYYY-NNNN</code></span>
                  </label>
                  <input
                    className="gp-input gp-mono"
                    placeholder="MOH-2024-0001"
                    value={staffId}
                    onChange={(e) => setStaffId(e.target.value.toUpperCase())}
                    autoFocus
                  />
                  <div className="gp-hint">
                    Test super-admins: <code>MOH-2024-0001</code> / <code>0002</code> / <code>0003</code>
                  </div>
                </div>

                <div className="gp-field">
                  <label className="gp-field-label">
                    National Identification Number (NIN)
                    <StatusPill kind="future">GAMBIS · stub</StatusPill>
                  </label>
                  <input
                    className="gp-input gp-mono"
                    placeholder="11-digit NIN"
                    maxLength={11}
                    inputMode="numeric"
                    value={staffNin}
                    onChange={(e) => setStaffNin(e.target.value.replace(/\D/g, "").slice(0, 11))}
                  />
                  <div className="gp-hint">
                    Your 11-digit NIN. First 6 digits encode your date of birth.
                  </div>
                </div>

                <div className="gp-field">
                  <label className="gp-field-label">Password</label>
                  <div style={{ position: "relative" }}>
                    <input
                      className="gp-input"
                      type={showStaffPw ? "text" : "password"}
                      placeholder="Min 8 characters"
                      value={staffPw}
                      onChange={(e) => setStaffPw(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && canSubmitStaff) submitStaffLogin();
                      }}
                      style={{ paddingRight: 42 }}
                    />
                    <button type="button"
                            className="gp-input-suffix-btn"
                            onClick={() => setShowStaffPw((v) => !v)}
                            aria-label={showStaffPw ? "Hide password" : "Show password"}>
                      {showStaffPw ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <div className="gp-hint">
                    Test super-admin password: <code>SuperGov2026!</code> / <code>2026@</code> / <code>2026#</code>
                  </div>
                </div>

                <div className="gp-row-2">
                  <div className="gp-field">
                    <label className="gp-field-label">Council</label>
                    <DarkSelect
                      value={staffCouncil}
                      onChange={setStaffCouncil}
                      placeholder="None"
                      options={[{ value: "", label: "None / not applicable" }, ...COUNCIL_OPTIONS]}
                    />
                  </div>
                  <div className="gp-field">
                    <label className="gp-field-label">
                      Registration{" "}
                      <span className="gp-field-opt">optional</span>
                    </label>
                    <input
                      className="gp-input gp-mono"
                      placeholder="YYYY-NNN"
                      value={staffRegNum}
                      onChange={(e) => setStaffRegNum(e.target.value.toUpperCase())}
                    />
                  </div>
                </div>

                <Button
                  variant="primary" size="lg"
                  onClick={submitStaffLogin}
                  loading={busy}
                  disabled={!canSubmitStaff}
                  leadIcon={ShieldCheck}
                >
                  {busy ? "Authenticating..." : "Enter the Observatory"}
                </Button>

                <div className="gp-alt">
                  <StatusPill kind="future">Stubbed verification</StatusPill>
                  <button type="button" className="gp-link" disabled>
                    Forgot password?
                  </button>
                </div>
              </section>
            )}

            {/* ── security strip (always at bottom of card) ── */}
            <div className="gp-secstrip">
              <div>
                <Lock size={13} />
                <b>Aggregate-only</b>
                No PII is exposed.
              </div>
              <div>
                <Clock size={13} />
                <b>8-hour sessions</b>
                Audited & revocable.
              </div>
              <div>
                <Shield size={13} />
                <b>Report misuse</b>
                MoH ICT Unit · 24/7.
              </div>
              <div>
                <Layers size={13} />
                <b>Powered by</b>
                AMINA Health Intelligence.
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
