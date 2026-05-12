/**
 * streamingChat — SSE-based streaming chat client for AMINA.
 *
 * Replaces the synchronous fetch→JSON→render cycle with progressive
 * token-by-token rendering via Server-Sent Events.
 *
 * Usage:
 *   import { streamChat } from "./platform/utils/streamingChat";
 *
 *   await streamChat({
 *     baseUrl: "http://localhost:8000",
 *     body: { message, session_id, ... },
 *     onToken: (text) => appendToCurrentBubble(text),
 *     onDone: (metadata) => finalizeMessage(metadata),
 *     onError: (err) => showError(err),
 *   });
 *
 * Falls back to standard /agent/chat if streaming fails.
 */

/**
 * @param {Object} opts
 * @param {string} opts.baseUrl - API base URL
 * @param {Object} opts.body - AgentChatRequest body
 * @param {Object} [opts.headers] - extra headers (e.g. Authorization)
 * @param {(text: string) => void} opts.onToken - called per token chunk
 * @param {(meta: Object) => void} opts.onDone - called with full metadata
 * @param {(err: string) => void} opts.onError - called on error
 * @param {AbortSignal} [opts.signal] - optional abort signal
 */
export async function streamChat({ baseUrl, body, headers, onToken, onDone, onError, signal }) {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/v1/agent/chat-stream`;
  const mergedHeaders = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    ...(headers || {}),
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: mergedHeaders,
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      // Fall back to non-streaming endpoint
      return fallbackChat({ baseUrl, body, headers, onToken, onDone, onError });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      let eventType = null;
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          const dataStr = line.slice(6);
          try {
            const data = JSON.parse(dataStr);
            if (eventType === "token" && data.text) {
              onToken(data.text);
            } else if (eventType === "done") {
              onDone(data);
            } else if (eventType === "error") {
              onError(data.error || "Unknown streaming error");
            }
          } catch {
            // Non-JSON data line, skip
          }
          eventType = null;
        }
      }
    }
  } catch (err) {
    if (err.name === "AbortError") return;
    console.warn("[streamChat] SSE failed, falling back:", err.message);
    return fallbackChat({ baseUrl, body, headers, onToken, onDone, onError });
  }
}

/**
 * Fallback: standard POST /agent/chat with simulated streaming.
 */
async function fallbackChat({ baseUrl, body, headers, onToken, onDone, onError }) {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/v1/agent/chat`;
  const mergedHeaders = { "Content-Type": "application/json", ...(headers || {}) };

  try {
    const r = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: mergedHeaders,
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      onError(`Error (${r.status})`);
      return;
    }

    const data = await r.json();
    if (!data.response) {
      onError("Empty response from server");
      return;
    }

    // Simulate streaming by emitting words progressively
    const words = data.response.split(" ");
    for (let i = 0; i < words.length; i += 3) {
      const chunk = words.slice(i, i + 3).join(" ");
      onToken(i === 0 ? chunk : " " + chunk);
      await new Promise((r) => setTimeout(r, 15));
    }

    onDone(data);
  } catch (err) {
    onError(err.message || "Network error");
  }
}

// Register globally
if (typeof window !== "undefined") {
  window.AMINA_STREAMING = { streamChat };
}
