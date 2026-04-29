/**
 * LegacyFallback — a deliberate archive disclosure for the v0 admin
 * panels that still live under each redesigned workspace.
 *
 * Replaces the bare ghost-button toggle. When collapsed, shows a
 * proper disclosure card with a kicker, title, and subtitle so the
 * reader understands WHY these legacy panels are still accessible.
 * When expanded, wraps the embedded AdminDashboard in an archive
 * frame — a dark container with a top ribbon marked "LEGACY VIEW"
 * so the dark-themed embed doesn't visually bleed into the new
 * light ops canvas above it.
 *
 *   <LegacyFallback
 *     kicker="Archive"
 *     title="Legacy DHIS2 panels"
 *     subtitle="Original sync & tracker console — kept for verification
 *               and edge-case workflows."
 *   >
 *     <AdminDashboard ... />
 *   </LegacyFallback>
 */

import { useState } from "react";
import { Archive, ChevronDown, Minimize2 } from "lucide-react";

import "../../styles/legacy-fallback.css";


export default function LegacyFallback({
  kicker  = "Archive",
  title   = "Legacy admin panels",
  subtitle = "Original v0 admin console — kept here for verification and edge-case workflows.",
  defaultOpen = false,
  children,
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="legacy-wrap">
      <button
        type="button"
        className="legacy-disclosure"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="legacy-disclosure-icon" aria-hidden="true">
          <Archive size={18} strokeWidth={1.6} />
        </span>
        <span className="legacy-disclosure-text">
          <span className="legacy-disclosure-title">
            <span className="legacy-disclosure-kicker">{kicker}</span>
            <span>{title}</span>
          </span>
          <span className="legacy-disclosure-sub">{subtitle}</span>
        </span>
        <span className="legacy-disclosure-cta" aria-hidden="true">
          {open ? "Hide" : "Reveal"}
          <ChevronDown size={12} strokeWidth={2.2} />
        </span>
      </button>

      {open && (
        <div className="legacy-archive" role="region" aria-label={`${title} — archive view`}>
          <div className="legacy-archive-ribbon">
            <span className="legacy-archive-ribbon-label">Legacy view</span>
            <span className="legacy-archive-ribbon-note">
              Preserved for parity · all write-paths still functional
            </span>
            <span className="legacy-archive-ribbon-spacer" />
            <button
              type="button"
              className="legacy-archive-ribbon-close"
              onClick={() => setOpen(false)}
              aria-label="Collapse legacy view"
            >
              <Minimize2 size={11} strokeWidth={2.2} />
              Collapse
            </button>
          </div>
          <div className="legacy-archive-inner">
            <div className="legacy-archive-surface">
              {children}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
