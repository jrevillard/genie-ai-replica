/**
 * LLMProviderBadgeBootstrap — self-mounting LLM badge for admin sessions.
 *
 * Wraps window.fetch (idempotent guard `__aminaLlmBadgeFetchWrapped`)
 * to observe responses to /api/v1/agent/chat* and dispatches an
 * `amina:llm-provider:snapshot` CustomEvent with the parsed X-LLM-*
 * headers. The host component (LLMProviderBadge) listens and renders
 * the floating badge, gated on admin auth.
 *
 * For SSE responses (chat-stream), the headers are present at the
 * initial response object before the body streams, so we read them
 * synchronously without consuming the stream.
 */

import { createRoot } from "react-dom/client";
import { LLMProviderBadgeHost } from "./LLMProviderBadge.jsx";

const ROOT_ID = "amina-llm-badge-root";

const CHAT_PATH_RE = /\/api\/v1\/agent\/chat(?:-stream)?(\?|$)/;

function _installFetchInterceptor() {
  if (typeof window === "undefined") return;
  if (window.__aminaLlmBadgeFetchWrapped) return;
  window.__aminaLlmBadgeFetchWrapped = true;

  const orig = window.fetch.bind(window);

  window.fetch = async function wrapped(input, init) {
    const resp = await orig(input, init);
    try {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      if (typeof url === "string" && CHAT_PATH_RE.test(url)) {
        const h = resp.headers;
        const provider_used = h.get("X-LLM-Provider");
        if (provider_used) {
          const snapshot = {
            provider_used,
            preferred:        h.get("X-LLM-Preferred")     || "",
            fallback_used:    h.get("X-LLM-Fallback-Used") === "true",
            latency_ms:       Number(h.get("X-LLM-Latency-Ms") || 0) || null,
            context:          h.get("X-LLM-Context")       || "",
            mode:             h.get("X-LLM-Mode")          || "",
            show_badge:       h.get("X-LLM-Show-Badge")    === "true",
            provider_error:   h.get("X-LLM-Provider-Error") || "",
          };
          window.dispatchEvent(new CustomEvent("amina:llm-provider:snapshot",
            { detail: snapshot }));
        }
      }
    } catch { /* never break the original call */ }
    return resp;
  };
}

function mount() {
  if (typeof window === "undefined") return;
  if (window.__aminaLlmBadgeMounted) return;
  window.__aminaLlmBadgeMounted = true;

  _installFetchInterceptor();

  const attach = () => {
    try {
      if (document.getElementById(ROOT_ID)) return;
      const host = document.createElement("div");
      host.id = ROOT_ID;
      document.body.appendChild(host);
      createRoot(host).render(<LLMProviderBadgeHost />);
    } catch (e) {
      console.warn("LLMProviderBadgeBootstrap mount failed:", e);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach);
  } else {
    attach();
  }
}

mount();

export default LLMProviderBadgeHost;
