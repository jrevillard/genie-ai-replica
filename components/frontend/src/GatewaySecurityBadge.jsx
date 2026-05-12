/**
 * GatewaySecurityBadge — self-mounting "🛡️ Jailbreak protection active" pill.
 *
 * Side-effect import: adding `import "./GatewaySecurityBadge.jsx"` to
 * main.jsx is enough to render the badge in the bottom-right corner
 * if the AMINA API gateway is reachable on :8443.
 *
 * Behaviour:
 *   * Polls GET http://localhost:8443/api/v1/public/security/status
 *     every 60s.
 *   * If the gateway is up AND jailbreak detection is enabled, shows
 *     a small pill with the active layer count + recent block count.
 *   * If the gateway is unreachable (404, timeout, network error),
 *     renders nothing — does NOT block or alarm. The existing demo
 *     flow (frontend :5174 → backend :8000) is unaffected by gateway
 *     status.
 *   * Click the badge to show layer detail in a small popover.
 *
 * Why a separate React root: App.jsx is read-only in this scope;
 * mounting a sibling root in <body> is the additive way to add UI
 * without editing the main layout. Same pattern as ConsentBootstrap.
 */

import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";


// Gateway base URL — derive from window so a deployed instance can
// override it. Defaults match docker-compose port mapping.
const GATEWAY_BASE = (
  (typeof window !== "undefined" && window.__AMINA_GATEWAY_URL) ||
  "http://localhost:8443"
).replace(/\/+$/, "");

const POLL_INTERVAL_MS = 60_000;
// Dismiss is intentionally session-scoped (not localStorage). The badge
// advertises that jailbreak protection is active - persistently hiding
// it would defeat the point of the indicator. A page refresh brings it
// back. Auto-clear any legacy persisted dismissal from older builds.
const STORAGE_KEY = "amina_gateway_badge_dismissed";
try { localStorage.removeItem(STORAGE_KEY); } catch {}


function fmtCount(n) {
  if (n == null) return "0";
  if (n < 1000) return String(n);
  return (n / 1000).toFixed(1) + "k";
}


function GatewaySecurityBadge() {
  const [status, setStatus]       = useState(null);   // null = unknown, false = unreachable
  const [open, setOpen]           = useState(false);
  const [dismissed, setDismissed] = useState(false);   // session-only, not persisted

  // Poll status on mount + on interval. Increased timeout 3 s → 8 s
  // so slow networks / chilly cold-starts don't drop the badge into
  // the "unreachable" branch.
  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const probe = async () => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        const r = await fetch(`${GATEWAY_BASE}/api/v1/public/security/status`, {
          signal: ctrl.signal,
        });
        clearTimeout(t);
        if (!r.ok) throw new Error("non-200");
        const d = await r.json();
        if (!cancelled) setStatus(d);
      } catch {
        if (!cancelled) setStatus(false);
      }
    };

    probe();
    timer = setInterval(probe, POLL_INTERVAL_MS);
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, []);

  // Only ever hide the pill on explicit user dismissal. Previously the
  // pill stayed null while probing, while unreachable, or when the
  // server explicitly disabled the gateway — that meant users who hit
  // any network glitch saw NO security indicator at all. The pill is a
  // brand-level credibility marker; we now always render it, then
  // upgrade in place with live data once the probe completes.
  if (dismissed) return null;

  const ready     = status && typeof status === "object";
  const blocked60 = ready ? (status.stats?.last_60_min?.blocked ?? 0) : 0;
  const total60   = ready ? (status.stats?.last_60_min?.total ?? 0)   : 0;
  const patterns  = ready ? (status.jailbreak_pattern_count ?? 0)     : 0;
  const layers    = ready
    ? Object.entries(status.layers || {})
        .filter(([, v]) => v === true)
        .map(([k]) => k)
    : [];
  const phase     = ready ? status.phase : "checking";

  return (
    <div
      style={{
        position:    "fixed",
        // Anchor above the site-wide CopyrightFooter band (z-index 10002).
        // 52 px lifts the pill clear of the footer's two-line wrap height
        // on mobile and keeps the corner visually breathable.
        bottom:      52,
        right:       20,
        // Above the CopyrightFooter (z 10002) so the security pill is
        // always the front-most element in this corner. Truly fullscreen
        // takeover modals at 2147483600+ still cover us — intentional.
        zIndex:      10010,
        fontFamily:  "Geist, system-ui, sans-serif",
        fontSize:    12.5,
        userSelect:  "none",
        pointerEvents: "auto",
      }}
    >
      <div
        onClick={() => setOpen((v) => !v)}
        title={open ? "Click to collapse" : "Click for security details"}
        style={{
          display:        "inline-flex",
          alignItems:     "center",
          gap:            7,
          padding:        "7px 12px",
          // Slightly deeper green + thicker shadow so the pill reads as
          // a real interactive element rather than incidental UI.
          background:     "rgba(16, 122, 92, 0.95)",
          color:          "#d6fff0",
          border:         "1px solid rgba(110, 200, 170, 0.55)",
          borderRadius:   999,
          boxShadow:      "0 8px 22px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(110, 200, 170, 0.15) inset",
          cursor:         "pointer",
          backdropFilter: "blur(10px)",
          fontWeight:     500,
          // Tiny pulse-glow ring while still probing so the user gets
          // visual feedback that "something is happening" even if the
          // probe is slow on their connection.
          opacity:        ready ? 1 : 0.92,
        }}
      >
        <span aria-hidden="true">🛡️</span>
        <span>{ready ? "Jailbreak protection active" : "Security check…"}</span>
        {blocked60 > 0 && (
          <span
            style={{
              background: "rgba(255, 100, 100, 0.25)",
              color:      "#ffe0e0",
              borderRadius: 999,
              padding:    "1px 7px",
              fontSize:   11,
            }}
          >
            {fmtCount(blocked60)} blocked
          </span>
        )}
      </div>

      {open && (
        <div
          style={{
            marginTop:    8,
            padding:      "12px 14px",
            background:   "rgba(15, 23, 42, 0.96)",
            color:        "#e2e8f0",
            border:       "1px solid rgba(110, 200, 170, 0.4)",
            borderRadius: 10,
            maxWidth:     320,
            boxShadow:    "0 8px 22px rgba(0, 0, 0, 0.35)",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6, color: "#d6fff0" }}>
            AMINA API Gateway · {phase}
          </div>
          <div style={{ marginBottom: 8, opacity: 0.85 }}>
            {ready
              ? `${patterns} jailbreak patterns active. Every chat request through the public surface is screened before reaching the LLM.`
              : "Probing the gateway status endpoint… the pattern catalogue and live block-counter will appear when the probe completes."}
          </div>
          <div style={{ marginBottom: 6 }}>
            <strong style={{ color: "#a7f3d0" }}>Active layers:</strong>{" "}
            {layers.map((l) => l.replace(/^L(\d)_/, "L$1·")).join(", ") || "(updating)"}
          </div>
          <div style={{ marginBottom: 8, opacity: 0.8 }}>
            {ready
              ? `Last 60 min: ${total60} requests, ${blocked60} blocked.`
              : "Live metrics pending…"}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <a
              href={`${GATEWAY_BASE}/api/v1/public/security/status`}
              target="_blank"
              rel="noreferrer"
              style={{ color: "#7dd3fc", fontSize: 11 }}
            >
              raw status →
            </a>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDismissed(true);
              }}
              title="Hide for this session - reappears on page reload"
              style={{
                background:  "transparent",
                color:       "#94a3b8",
                border:      "none",
                cursor:      "pointer",
                fontSize:    11,
              }}
            >
              hide for now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


// ── Self-mount ──────────────────────────────────────────────────────

(function bootstrap() {
  if (typeof window === "undefined") return;
  if (window.__AMINA_GATEWAY_BADGE_MOUNTED) return;
  window.__AMINA_GATEWAY_BADGE_MOUNTED = true;

  const mount = () => {
    try {
      if (document.getElementById("amina-gateway-badge-root")) return;
      const host = document.createElement("div");
      host.id = "amina-gateway-badge-root";
      document.body.appendChild(host);
      ReactDOM.createRoot(host).render(<GatewaySecurityBadge />);
    } catch (e) {
      // Fail silent — never block the app on a badge mount error.
      // eslint-disable-next-line no-console
      console.warn("GatewaySecurityBadge mount failed:", e);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();

export default GatewaySecurityBadge;
