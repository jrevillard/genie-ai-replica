/**
 * modelApi — thin wrapper for the resilience endpoints.
 *
 * The chat request itself is NOT sent through this file. The chatInterceptor
 * transparently rewrites /api/v1/agent/chat to /agent/chat-resilient so
 * App.jsx's existing fetch logic keeps working untouched.
 *
 * This module is used by:
 *   - ModelSwitchBanner — listens for events, this module provides the
 *     display-name map.
 *   - An optional dev/admin tool (future) to GET /models/status or reset a
 *     model's cooldown.
 */

const API_BASE = (typeof window !== "undefined" && window.AMINA_API) || "http://localhost:8000";

function authHeader() {
  const t = (typeof localStorage !== "undefined" && localStorage.getItem("AMINA_TOKEN")) || "";
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/** GET /api/v1/models/status */
export async function getModelsStatus(preferred) {
  const q = preferred ? `?preferred=${encodeURIComponent(preferred)}` : "";
  try {
    const r = await fetch(`${API_BASE}/api/v1/models/status${q}`, { headers: authHeader() });
    if (!r.ok) return { _error: `HTTP ${r.status}` };
    return await r.json();
  } catch (e) {
    return { _error: String(e) };
  }
}

/** POST /api/v1/models/{model}/reset  — admin/dev. */
export async function resetModel(model) {
  try {
    const r = await fetch(
      `${API_BASE}/api/v1/models/${encodeURIComponent(model)}/reset`,
      { method: "POST", headers: authHeader() },
    );
    return await r.json();
  } catch (e) {
    return { _error: String(e) };
  }
}

/**
 * Human-friendly labels + colour accents used by the banner and the
 * status panel. Keep this in sync with KNOWN_MODELS in model_fallback.py.
 */
export const MODEL_LABELS = {
  amina:   { name: "Amina LoRA",  accent: "#0891b2" },
  base:    { name: "OpenAI GPT",  accent: "#10a37f" },
  gemini:  { name: "Gemini",      accent: "#1a73e8" },
  groq:    { name: "Groq",        accent: "#f55036" },
  mistral: { name: "Mistral",     accent: "#ff7000" },
};

export function modelLabel(id) {
  return (MODEL_LABELS[id] && MODEL_LABELS[id].name) || id || "Unknown";
}

export function modelAccent(id) {
  return (MODEL_LABELS[id] && MODEL_LABELS[id].accent) || "#64748b";
}

export { API_BASE };
