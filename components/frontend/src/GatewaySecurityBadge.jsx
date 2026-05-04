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
const STORAGE_KEY = "amina_gateway_badge_dismissed";


function fmtCount(n) {
  if (n == null) return "0";
  if (n < 1000) return String(n);
  return (n / 1000).toFixed(1) + "k";
}


function GatewaySecurityBadge() {
  const [status, setStatus]       = useState(null);   // null = unknown, false = unreachable
  const [open, setOpen]           = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
  });

  // Poll status on mount + on interval
  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const probe = async () => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 3000);
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

  // Bail conditions: dismissed by user, or gateway unreachable, or
  // gateway is up but explicitly disabled (returns 503 on public endpoints).
  if (dismissed) return null;
  if (status === null) return null;       // still probing
  if (status === false) return null;      // unreachable — silent
  if (!status.config?.gateway_enabled) return null;
  if (!status.config?.jailbreak_detection_enabled) return null;

  const blocked60 = status.stats?.last_60_min?.blocked ?? 0;
  const total60   = status.stats?.last_60_min?.total ?? 0;
  const patterns  = status.jailbreak_pattern_count ?? 0;
  const layers    = Object.entries(status.layers || {})
    .filter(([, v]) => v === true)
    .map(([k]) => k);

  return (
    <div
      style={{
        position:    "fixed",
        bottom:      14,
        right:       14,
        zIndex:      8000,
        fontFamily:  "Geist, system-ui, sans-serif",
        fontSize:    12,
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
          gap:            6,
          padding:        "6px 10px",
          background:     "rgba(15, 110, 86, 0.95)",
          color:          "#d6fff0",
          border:         "1px solid rgba(110, 200, 170, 0.4)",
          borderRadius:   999,
          boxShadow:      "0 6px 16px rgba(0, 0, 0, 0.25)",
          cursor:         "pointer",
          backdropFilter: "blur(8px)",
        }}
      >
        <span aria-hidden="true">🛡️</span>
        <span>Jailbreak protection active</span>
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
            AMINA API Gateway · {status.phase}
          </div>
          <div style={{ marginBottom: 8, opacity: 0.85 }}>
            {patterns} jailbreak patterns active. Every chat request through
            the public surface is screened before reaching the LLM.
          </div>
          <div style={{ marginBottom: 6 }}>
            <strong style={{ color: "#a7f3d0" }}>Active layers:</strong>{" "}
            {layers.map((l) => l.replace(/^L(\d)_/, "L$1·")).join(", ") || "none"}
          </div>
          <div style={{ marginBottom: 8, opacity: 0.8 }}>
            Last 60 min: {total60} requests, {blocked60} blocked.
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
                try { localStorage.setItem(STORAGE_KEY, "1"); } catch {}
                setDismissed(true);
              }}
              style={{
                background:  "transparent",
                color:       "#94a3b8",
                border:      "none",
                cursor:      "pointer",
                fontSize:    11,
              }}
            >
              dismiss
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
