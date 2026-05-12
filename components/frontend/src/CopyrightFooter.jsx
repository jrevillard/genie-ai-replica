/**
 * CopyrightFooter — self-mounting site-wide footer.
 *
 * Side-effect import: adding `import "./CopyrightFooter.jsx"` to main.jsx
 * is enough to render the standard credit line on every route
 * (home/login/signup/chat overlays, the patient/caregiver dashboards
 * rendered by App.jsx, AdminShell, GovShell, DisclaimerPage).
 * Current text: "© 2026 Amina Care Project. Developed for humanitarian
 * use. Submitted under GenIA for Good terms." (update FOOTER_TEXT below.)
 *
 * Why a separate React root mounted on <body>: the same pattern used by
 * GatewaySecurityBadge. Single import, zero edits to any page component
 * or to AppRouter. Auto-survives any future route additions.
 *
 * Visual contract:
 *   - Fixed bottom strip, ~22 px tall, full width
 *   - Translucent dark backdrop matching the AMINA theme
 *   - `pointer-events: none` so it never intercepts clicks. Forms,
 *     chat input bars, and modals at the bottom of pages remain fully
 *     interactive — the footer is purely visual.
 *   - z-index sits above page content but below the GatewaySecurityBadge
 *     and any toast/modal layers.
 */

import ReactDOM from "react-dom/client";


// Centralised copy. The credit line is split into three segments so the
// brand can be visually emphasised over the descriptor — same content
// the user supplied, just laid out for modern portfolio-style typography.
const BRAND_LINE      = "© 2026 · Amina Care Project";
const PURPOSE_LINE    = "Developed for humanitarian use";
const SUBMISSION_LINE = "Submitted under GenIA for Good terms";


function CopyrightFooter() {
  return (
    <footer
      role="contentinfo"
      aria-label="Site credits"
      style={{
        position:       "fixed",
        left:           0,
        right:          0,
        // Hug the viewport bottom but respect iOS home-indicator + any
        // browser safe-area inset. On desktop this resolves to 0.
        bottom:         0,
        padding:        "6px 18px max(6px, env(safe-area-inset-bottom)) 18px",
        // No backdrop band, no border, no blur — fully ambient watermark.
        // Underlying chat bubbles / form fields show through. The dim
        // colour + text-shadow combo carries legibility over any
        // background (dark overlay, light dashboard, gradients).
        background:     "transparent",
        // Click-through. Footer never intercepts focus on a chat
        // textarea, a Send button, or any other interactive element
        // that may sit in the same visual band on small viewports.
        pointerEvents:  "none",
        userSelect:     "none",
        fontFamily:     "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        // Above routine page overlays (AppRouter overlay 9800, App.jsx
        // full-screen modals 9999, CaregiverPortal 9999, AdminLiteracyQueue
        // 10001). Truly fullscreen takeover modals (EvidenceLayerCard
        // 2147483600+) intentionally still cover the footer.
        zIndex:         10002,
      }}
    >
      <div
        style={{
          display:        "flex",
          flexWrap:       "wrap",
          justifyContent: "center",
          alignItems:     "baseline",
          columnGap:      14,
          rowGap:         1,
          // Cap at 700 px and centre. This guarantees the footer text
          // never extends to the bottom-right corner where the
          // GatewaySecurityBadge floats (bottom 48 px, right 14 px), so
          // the two fixed elements have spatial separation even with
          // overlapping z-index ranges.
          maxWidth:       700,
          margin:         "0 auto",
          // Subtle drop-shadow for legibility over any underlying surface.
          textShadow:     "0 1px 2px rgba(0, 0, 0, 0.55)",
          letterSpacing:  "0.02em",
        }}
      >
        <span style={{
          fontSize:    10.5,
          fontWeight:  500,
          color:       "rgba(203, 213, 225, 0.72)",   // slate-300 @ 72%
          whiteSpace:  "nowrap",
        }}>
          {BRAND_LINE}
        </span>
        <span style={{
          fontSize: 10,
          color:    "rgba(148, 163, 184, 0.62)",      // slate-400 @ 62%
        }}>
          {PURPOSE_LINE}
          <span aria-hidden="true" style={{ margin: "0 8px", opacity: 0.4 }}>·</span>
          {SUBMISSION_LINE}
        </span>
      </div>
    </footer>
  );
}


// ── Self-mount ──────────────────────────────────────────────────────

(function bootstrap() {
  if (typeof window === "undefined") return;
  if (window.__AMINA_COPYRIGHT_FOOTER_MOUNTED) return;
  window.__AMINA_COPYRIGHT_FOOTER_MOUNTED = true;

  const mount = () => {
    try {
      if (document.getElementById("amina-copyright-footer-root")) return;
      const host = document.createElement("div");
      host.id = "amina-copyright-footer-root";
      document.body.appendChild(host);
      ReactDOM.createRoot(host).render(<CopyrightFooter />);
    } catch (e) {
      // Fail silent — never block the app on a footer mount error.
      // eslint-disable-next-line no-console
      console.warn("CopyrightFooter mount failed:", e);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();

export default CopyrightFooter;
