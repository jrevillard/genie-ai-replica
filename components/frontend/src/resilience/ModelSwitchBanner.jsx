/**
 * ModelSwitchBanner
 * ====================
 * Contextual prompt (AMINA's legacy approach) that surfaces when the
 * resilience layer had to route a reply through a different model than
 * the user's primary.
 *
 * Trigger
 *   window.dispatchEvent(new CustomEvent("amina:model_switched", {
 *     detail: { from, to, reason, kind, events }
 *   }))
 *
 * The event is fired by chatInterceptor.js after every /agent/chat response
 * whose `model_events` array contains at least one DOWN transition. Plain
 * "START" (user's preferred model answered on the first try) does NOT fire
 * the banner — we only surface actual switches.
 *
 * Behaviour
 *   - Top-center floating toast, auto-dismisses after 9s.
 *   - Stacks: multiple events render as a small vertical column.
 *   - Click → copies a debug string to clipboard (for support/QA).
 *   - Respects prefers-reduced-motion.
 *
 * Auth / billing events
 *   We explicitly DO NOT render for TOKEN / BILLING kinds — those are
 *   handled by the existing token-refresh UI, and a banner here would
 *   either duplicate the signal or give the impression the model was
 *   swapped (which never happens for auth-class errors).
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { modelAccent, modelLabel } from "./modelApi.js";

const DISMISS_MS = 9000;
const MAX_STACK  = 3;

export default function ModelSwitchBanner() {
  const [items, setItems] = useState([]);  // { id, from, to, reason, at }

  useEffect(() => {
    let nextId = 1;

    const onSwitch = (e) => {
      const d = e.detail || {};
      if (!d.to) return;
      if (d.kind && ["TOKEN", "BILLING"].includes(d.kind.toUpperCase())) return;
      const entry = {
        id:    nextId++,
        from:  d.from,
        to:    d.to,
        reason: d.reason || "unreachable",
        at:    Date.now(),
      };
      setItems((prev) => [entry, ...prev].slice(0, MAX_STACK));
      window.setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== entry.id));
      }, DISMISS_MS);
    };

    window.addEventListener("amina:model_switched", onSwitch);
    return () => window.removeEventListener("amina:model_switched", onSwitch);
  }, []);

  if (items.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position:   "fixed",
        top:        18,
        left:       "50%",
        transform:  "translateX(-50%)",
        zIndex:     9280,
        display:    "flex",
        flexDirection: "column",
        gap:        8,
        pointerEvents: "none",
        fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      {items.map((it) => (
        <BannerCard
          key={it.id}
          from={it.from}
          to={it.to}
          reason={it.reason}
          onDismiss={() =>
            setItems((prev) => prev.filter((x) => x.id !== it.id))
          }
        />
      ))}

      <style>{`
        @keyframes amina-banner-in {
          from { opacity: 0; transform: translateY(-8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes amina-banner-in { from, to { opacity: 1; transform: none; } }
        }
      `}</style>
    </div>
  );
}


function BannerCard({ from, to, reason, onDismiss }) {
  const { t } = useTranslation();
  const toAccent   = modelAccent(to);
  const fromLabel  = from ? modelLabel(from) : null;
  const toLabel    = modelLabel(to);
  const reasonText = prettyReason(reason, t);

  return (
    <div
      onClick={() => copyDebug({ from, to, reason })}
      style={{
        display:       "inline-flex",
        alignItems:    "center",
        gap:           10,
        padding:       "8px 14px 8px 12px",
        background:    "rgba(15, 23, 42, 0.94)",
        color:         "#fff",
        borderRadius:  999,
        fontSize:      "12.5px",
        boxShadow:     "0 8px 24px rgba(15, 23, 42, 0.35)",
        backdropFilter:"blur(6px)",
        border:        `1px solid ${toAccent}55`,
        pointerEvents: "auto",
        cursor:        "pointer",
        animation:     "amina-banner-in 220ms cubic-bezier(0.22, 1, 0.36, 1)",
        maxWidth:      "min(560px, 92vw)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width:        8, height: 8, borderRadius: "50%",
          background:   toAccent,
          boxShadow:    `0 0 0 3px ${toAccent}33`,
          flexShrink:   0,
        }}
      />
      <span>
        {fromLabel ? (
          <>
            <strong style={{ fontWeight: 600 }}>{fromLabel}</strong>
            <span style={{ opacity: 0.55 }}>{"  →  "}</span>
            <strong style={{ fontWeight: 600 }}>{toLabel}</strong>
          </>
        ) : (
          <>{t("modelBanner.noPrimary", { to: toLabel })}</>
        )}
        <span style={{ opacity: 0.7, marginLeft: 8, fontSize: "11.5px" }}>
          {reasonText}
        </span>
      </span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDismiss?.(); }}
        aria-label={t("common.dismiss")}
        style={{
          marginLeft:   6,
          width:        22, height: 22,
          display:      "inline-flex", alignItems: "center", justifyContent: "center",
          border:       "none",
          background:   "rgba(255,255,255,0.1)",
          color:        "#fff",
          borderRadius: 999,
          cursor:       "pointer",
          fontSize:     "11px",
          flexShrink:   0,
        }}
      >✕</button>
    </div>
  );
}


function prettyReason(r, t) {
  const trans = t || ((k) => k);
  if (!r) return trans("modelBanner.reason.unreachable");
  const s = String(r).toLowerCase();
  if (s.includes("timeout") || s.includes("timed_out")) return trans("modelBanner.reason.timedOut");
  if (s.includes("connection"))                         return trans("modelBanner.reason.cantReach");
  if (s.startsWith("http_5") || s === "http_500" || s === "http_502" ||
      s === "http_503" || s === "http_504")             return trans("modelBanner.reason.serviceError");
  if (s === "http_429" || s.includes("rate_limit"))     return trans("modelBanner.reason.rateLimited");
  if (s.includes("ssl") || s.includes("handshake"))     return trans("modelBanner.reason.networkError");
  return trans("modelBanner.reason.unreachable");
}


function copyDebug({ from, to, reason }) {
  try {
    const line = `model_switch  from=${from || "—"}  to=${to}  reason=${reason}  t=${new Date().toISOString()}`;
    if (navigator?.clipboard) navigator.clipboard.writeText(line).catch(() => {});
  } catch { /* no-op */ }
}
