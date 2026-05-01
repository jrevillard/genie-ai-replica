/**
 * LLMProviderBadge — admin-scoped diagnostic badge.
 *
 * Watches /api/v1/agent/chat* responses (via a window.fetch wrapper)
 * and reads the X-LLM-* headers projected by
 * src/services/llm_provider_middleware.py:
 *
 *   X-LLM-Provider              groq|gemini|openai|amina-lora
 *   X-LLM-Preferred             groq|gemini|openai|amina-lora
 *   X-LLM-Fallback-Used         true|false
 *   X-LLM-Latency-Ms            integer ms
 *   X-LLM-Context               guest|auth
 *   X-LLM-Mode                  graceful|warn|strict
 *   X-LLM-Show-Badge            true|false   (operator hint)
 *   X-LLM-Provider-Error        first 120 chars of primary error, if any
 *
 * Visibility rules:
 *   - hidden for non-admin sessions (no AMINA_ADMIN_TOKEN)
 *   - hidden when X-LLM-Show-Badge is "false" AND no fallback occurred
 *   - shown subtly when fallback occurred (amber, "Fallback active")
 *   - shown success-style after successful LoRA-served calls (green)
 *
 * Auto-dismisses after 8 seconds of no new chat traffic. Click to
 * pin/unpin so an operator can snapshot the current state.
 *
 * NEVER shows technical errors to non-admin users — visibility is
 * gated by both the admin token AND the server's X-LLM-Show-Badge
 * header so the operator can override per environment.
 */

import { useEffect, useRef, useState } from "react";
import { adminToken } from "./adminNotificationsApi.js";

const Z_INDEX = 9265;
const HIDE_AFTER_MS = 8000;

const PROVIDER_TONE = {
  "amina-lora": { color: "#86efac", border: "rgba(34, 197, 94, 0.45)", label: "Amina LoRA"  },
  "groq":       { color: "#fcd34d", border: "rgba(251, 191, 36, 0.45)", label: "Groq"        },
  "gemini":     { color: "#7dd3fc", border: "rgba(125, 211, 252, 0.45)", label: "Gemini"      },
  "openai":     { color: "#c4b5fd", border: "rgba(196, 181, 253, 0.45)", label: "OpenAI"      },
  "mistral":    { color: "#fda4af", border: "rgba(253, 164, 175, 0.45)", label: "Mistral"     },
};

function _tone(provider) {
  return PROVIDER_TONE[provider] || { color: "#cbd5e1", border: "rgba(148,163,184,0.40)", label: provider || "?" };
}

export default function LLMProviderBadge({ snapshot, onDismiss, pinned, onTogglePin }) {
  if (!snapshot) return null;
  const t = _tone(snapshot.provider_used);
  const fallback = snapshot.fallback_used === true || snapshot.fallback_used === "true";
  const isError  = !!snapshot.provider_error;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: 18, right: 18,
        zIndex: Z_INDEX,
        minWidth: 250, maxWidth: 360,
        padding: "10px 14px",
        background: "rgba(11, 18, 32, 0.92)",
        border: `1px solid ${t.border}`,
        borderRadius: 12,
        color: "#e2e8f0",
        fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        fontSize: 12, lineHeight: 1.45,
        boxShadow: "0 14px 28px rgba(2, 6, 23, 0.55), 0 0 0 1px rgba(148,163,184,0.10) inset",
        backdropFilter: "blur(8px)",
        animation: "amina-llmbadge-rise 220ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        gap: 10, marginBottom: 6,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: t.color, display: "inline-block",
            boxShadow: `0 0 8px ${t.color}aa`,
          }} />
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.6,
                          textTransform: "uppercase", color: t.color }}>
            {fallback ? "Fallback active" : (isError ? "Provider error" : "Active provider")}
          </span>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={onTogglePin} title={pinned ? "Unpin" : "Pin badge"}
                  style={btnTiny}>
            {pinned ? "📌" : "📍"}
          </button>
          <button onClick={onDismiss} title="Dismiss" aria-label="Dismiss"
                  style={btnTiny}>✕</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 10px",
                     fontSize: 11.5 }}>
        <span style={{ color: "#94a3b8" }}>Used:</span>
        <span style={{ color: t.color, fontWeight: 700 }}>{t.label}</span>

        <span style={{ color: "#94a3b8" }}>Preferred:</span>
        <span style={{ color: "#cbd5e1" }}>{snapshot.preferred || "—"}</span>

        <span style={{ color: "#94a3b8" }}>Mode:</span>
        <span style={{ color: "#cbd5e1" }}>{snapshot.mode || "—"}</span>

        <span style={{ color: "#94a3b8" }}>Latency:</span>
        <span style={{ color: "#cbd5e1" }}>
          {snapshot.latency_ms != null ? `${snapshot.latency_ms} ms` : "—"}
        </span>

        <span style={{ color: "#94a3b8" }}>Context:</span>
        <span style={{ color: "#cbd5e1" }}>{snapshot.context || "—"}</span>
      </div>

      {snapshot.provider_error ? (
        <div style={{
          marginTop: 8, padding: "6px 8px", borderRadius: 6,
          background: "rgba(127, 29, 29, 0.30)",
          border: "1px solid rgba(248, 113, 113, 0.30)",
          color: "#fecaca", fontSize: 11, lineHeight: 1.45,
          wordBreak: "break-word",
        }}>
          ⚠ {snapshot.provider_error}
        </div>
      ) : null}

      <style>{`
        @keyframes amina-llmbadge-rise {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

const btnTiny = {
  width: 22, height: 22, borderRadius: 6, border: "none",
  background: "rgba(148, 163, 184, 0.12)", color: "#cbd5e1",
  fontSize: 10, cursor: "pointer", lineHeight: 1,
  display: "inline-flex", alignItems: "center", justifyContent: "center",
};

// ── Host (driven by fetch interceptor) ─────────────────────────────
export function LLMProviderBadgeHost() {
  const [visible, setVisible] = useState(() => Boolean(adminToken()));
  const [snapshot, setSnapshot] = useState(null);
  const [pinned, setPinned]     = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    const onAuthChange = () => setVisible(Boolean(adminToken()));
    window.addEventListener("storage", onAuthChange);
    window.addEventListener("amina:auth-changed", onAuthChange);
    return () => {
      window.removeEventListener("storage", onAuthChange);
      window.removeEventListener("amina:auth-changed", onAuthChange);
    };
  }, []);

  useEffect(() => {
    const onSnapshot = (e) => {
      const s = e?.detail || null;
      if (!s) return;
      // Honor server's "show badge" hint: hide if false AND no fallback.
      const serverWantsBadge = s.show_badge === true || s.show_badge === "true";
      const fallback = s.fallback_used === true || s.fallback_used === "true";
      if (!serverWantsBadge && !fallback && !s.provider_error) return;
      setSnapshot(s);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (!pinned) {
        timerRef.current = setTimeout(() => setSnapshot(null), HIDE_AFTER_MS);
      }
    };
    window.addEventListener("amina:llm-provider:snapshot", onSnapshot);
    return () => window.removeEventListener("amina:llm-provider:snapshot", onSnapshot);
  }, [pinned]);

  // BUG-037 verified-safe: this is the valid shorthand for
  //   useEffect(() => { return () => { ...cleanup... }; }, []);
  // The outer arrow is the effect (no setup); the inner arrow is the
  // cleanup React stores and runs on unmount. The audit misread it as
  // "cleanup runs on mount" -- it does not. Do NOT restructure into
  // a setup-with-cleanup form: there is no setup work to do here.
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  if (!visible || !snapshot) return null;
  return (
    <LLMProviderBadge
      snapshot={snapshot}
      pinned={pinned}
      onTogglePin={() => setPinned((p) => !p)}
      onDismiss={() => { setSnapshot(null); setPinned(false); }}
    />
  );
}
