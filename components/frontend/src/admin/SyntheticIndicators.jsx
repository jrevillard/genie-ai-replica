/**
 * SyntheticIndicators — persistent visual reminders that all data
 * shown in the Observatory is synthetic.
 *
 * Components:
 *   <SyntheticBanner />          top sticky 36px amber banner
 *   <SyntheticFooter />          bottom sticky watermark strip
 *   <SyntheticPill compact? />   inline "🔶 Synthetic" badge
 *   <WatermarkBackdrop>          wraps data containers with diagonal
 *                                "SYNTHETIC DATA" repeated background
 *   <ChartSyntheticLabel />      bottom-right label for charts
 *
 * CSS class .synthetic-watermark also exposed for direct use on
 * existing containers without wrapping.
 *
 * Defense-in-depth principle: every screen the user can screenshot
 * needs the synthetic marker. These components are designed to be
 * impossible to dismiss, hide, or scroll out of view.
 */

import { AlertTriangle, Shield } from "lucide-react";


/* ─── one-shot CSS injection ──────────────────────────────────── */

const SI_CSS = `
@keyframes si-banner-pulse {
  0%, 100% { background-position: 0% 50%; }
  50%      { background-position: 100% 50%; }
}

/* ── top banner (sticky, top of viewport) ───────────── */
.si-banner {
  position: sticky; top: 0; left: 0; right: 0;
  z-index: 9000;
  height: 36px;
  background: linear-gradient(90deg,
    #FFA500 0%, #FFB733 25%, #FFA500 50%, #FFB733 75%, #FFA500 100%);
  background-size: 200% 100%;
  animation: si-banner-pulse 12s ease-in-out infinite;
  color: #1c1300;
  display: flex; align-items: center; justify-content: center;
  gap: 10px;
  font-size: 13px; font-weight: 700;
  letter-spacing: 0.02em;
  box-shadow: 0 2px 8px rgba(0,0,0,0.25);
  user-select: none;
  cursor: default;
  padding: 0 16px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.si-banner svg { flex: none; }
.si-banner-text {
  overflow: hidden; text-overflow: ellipsis;
}
.si-banner-tag {
  background: rgba(0,0,0,0.18);
  color: #1c1300;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  flex: none;
}
@media (max-width: 700px) {
  .si-banner { font-size: 11.5px; gap: 6px; }
  .si-banner-text-detail { display: none; }
  .si-banner-tag { font-size: 9px; padding: 2px 6px; }
}

/* ── bottom footer (sticky, bottom of viewport) ─────── */
.si-footer {
  position: sticky; bottom: 0; left: 0; right: 0;
  z-index: 9000;
  background: rgba(20, 14, 0, 0.92);
  backdrop-filter: blur(6px);
  border-top: 1px solid rgba(255, 165, 0, 0.30);
  color: rgba(255, 230, 180, 0.85);
  font-size: 11px; font-weight: 500;
  padding: 7px 14px;
  text-align: center;
  user-select: none;
  letter-spacing: 0.01em;
}
.si-footer b { color: #ffa500; font-weight: 700; }

/* ── inline "🔶 Synthetic" pill ──────────────────────── */
.si-pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 8px; border-radius: 999px;
  background: rgba(255, 165, 0, 0.10);
  color: #fdba74;
  border: 1px solid rgba(255, 165, 0, 0.32);
  font-size: 10px; font-weight: 700;
  letter-spacing: 0.05em; text-transform: uppercase;
  font-family: var(--a-font-ui);
  vertical-align: middle;
  white-space: nowrap;
}
.si-pill-compact {
  padding: 1px 6px;
  font-size: 9px;
  letter-spacing: 0.04em;
}
.si-pill-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: #ffa500;
  flex-shrink: 0;
}

/* ── diagonal watermark backdrop ─────────────────────── */
.synthetic-watermark {
  position: relative;
}
.synthetic-watermark::before {
  content: "SYNTHETIC DATA  ·  SYNTHETIC DATA  ·  SYNTHETIC DATA";
  position: absolute;
  inset: 0;
  display: flex; align-items: center; justify-content: center;
  transform: rotate(-22deg);
  font-size: 56px; font-weight: 900;
  color: rgba(255, 165, 0, 0.06);
  letter-spacing: 0.12em;
  pointer-events: none;
  z-index: 1;
  white-space: nowrap;
  overflow: hidden;
  user-select: none;
}
.synthetic-watermark > * {
  position: relative; z-index: 2;
}

/* ── chart label (bottom-right) ──────────────────────── */
.si-chart-label {
  position: absolute; bottom: 8px; right: 12px;
  z-index: 3;
  font-size: 10px;
  color: rgba(255, 165, 0, 0.55);
  letter-spacing: 0.04em;
  pointer-events: none;
  user-select: none;
  font-family: var(--a-font-ui);
  font-weight: 500;
}

/* ── card "synthetic" tag ────────────────────────────── */
.si-card-tag {
  font-size: 9.5px; color: rgba(255, 165, 0, 0.7);
  letter-spacing: 0.08em; text-transform: uppercase;
  font-weight: 600; margin-top: 2px;
  display: inline-flex; align-items: center; gap: 4px;
}
.si-card-tag::before {
  content: "🔶";
  font-size: 9px;
}
`;

if (typeof document !== "undefined" && !document.getElementById("amina-si-css")) {
  const s = document.createElement("style");
  s.id = "amina-si-css";
  s.textContent = SI_CSS;
  document.head.appendChild(s);
}


/* ─── components ──────────────────────────────────────────────── */

export function SyntheticBanner({ message }) {
  return (
    <div className="si-banner" role="status" aria-live="polite">
      <AlertTriangle size={15} />
      <span className="si-banner-tag">Synthetic</span>
      <span className="si-banner-text">
        {message || (
          <>
            SYNTHETIC DATA ENVIRONMENT
            <span className="si-banner-text-detail">
              {" "}— Architecture Demonstration Only — No Real Patient Data
            </span>
          </>
        )}
      </span>
    </div>
  );
}

export function SyntheticFooter() {
  return (
    <div className="si-footer" role="contentinfo">
      All data shown is <b>artificially generated</b> · Not for clinical
      or policy use · AMINA Architecture Demonstration
    </div>
  );
}

export function SyntheticPill({ compact = false, label = "Synthetic" }) {
  return (
    <span className={`si-pill${compact ? " si-pill-compact" : ""}`}>
      <span className="si-pill-dot" />
      {label}
    </span>
  );
}

export function ChartSyntheticLabel() {
  return (
    <span className="si-chart-label">
      Data: Synthetic (demonstration)
    </span>
  );
}

export function CardSyntheticTag() {
  return <div className="si-card-tag">synthetic</div>;
}

export function WatermarkBackdrop({ children, className = "", style }) {
  return (
    <div className={`synthetic-watermark ${className}`.trim()} style={style}>
      {children}
    </div>
  );
}

// Convenience wrapper: place inside any layout shell to add both
// the top banner and bottom footer at once.
export default function SyntheticIndicators({ children, message }) {
  return (
    <>
      <SyntheticBanner message={message} />
      {children}
      <SyntheticFooter />
    </>
  );
}
