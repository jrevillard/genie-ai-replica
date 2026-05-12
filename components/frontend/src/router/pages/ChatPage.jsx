/**
 * ChatPage — #/chat route.
 *
 * Focused conversation view with Amina. Sends messages to the same
 * /api/v1/agent/chat endpoint the dashboard uses, but presents them in
 * a dedicated, distraction-free page rather than inside the cards
 * grid. Session id is resolved from localStorage (`AMINA_SID`) if the
 * user is signed in, otherwise a synthetic guest session id is minted
 * so anonymous visitors can also try a quick chat.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { navigate, currentAuthRole } from "../AppRouter.jsx";
import { streamChat } from "../../platform/utils/streamingChat.js";
import { useStickToBottom } from "../../utils/stickToBottom.js";


// Backend origin. Vite's dev server doesn't proxy /api — every other
// chat screen (BeginnerChat, App.jsx) uses the same pattern so we're
// consistent. window.AMINA_API can be injected at build/serve time.
const API = ((typeof window !== "undefined" && window.AMINA_API) || "http://localhost:8000")
  .replace(/\/+$/, "");


const INPUT = {
  flex: 1,
  padding: "12px 14px",
  background: "rgba(15, 23, 42, 0.90)",
  border: "1px solid rgba(148, 163, 184, 0.25)",
  borderRadius: 12,
  color: "#f1f5f9", fontSize: 14, fontFamily: "inherit", outline: "none",
};


function _sessionId() {
  try {
    const s = localStorage.getItem("AMINA_SID");
    if (s) return s;
  } catch { /* noop */ }
  const guest = "guest_" + Math.random().toString(36).slice(2, 10)
                + "_" + Math.floor(Date.now() / 1000);
  try { sessionStorage.setItem("AMINA_CHAT_GUEST_SID", guest); } catch { /* noop */ }
  return guest;
}


function _authHeaders() {
  try {
    const tok = localStorage.getItem("AMINA_TOKEN") || "";
    return tok
      ? { "Authorization": `Bearer ${tok}`, "Content-Type": "application/json" }
      : { "Content-Type": "application/json" };
  } catch {
    return { "Content-Type": "application/json" };
  }
}


function Bubble({ role, text }) {
  const me = role === "user";
  return (
    <div style={{
      display: "flex", justifyContent: me ? "flex-end" : "flex-start",
      marginBottom: 10,
    }}>
      <div style={{
        maxWidth: "min(78ch, 80%)",
        padding: "10px 14px",
        borderRadius: 14,
        background: me
          ? "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)"
          : "rgba(30, 41, 59, 0.75)",
        color: me ? "#fff" : "#e2e8f0",
        border: me ? "none" : "1px solid rgba(148, 163, 184, 0.20)",
        fontSize: 14, lineHeight: 1.55,
        whiteSpace: "pre-wrap", wordBreak: "break-word",
        boxShadow: me ? "0 8px 22px rgba(99, 102, 241, 0.30)"
                      : "0 4px 12px rgba(0, 0, 0, 0.25)",
      }}>
        {text}
      </div>
    </div>
  );
}


export default function ChatPage() {
  const role = currentAuthRole();
  const sid  = useRef(_sessionId()).current;
  const [messages, setMessages] = useState(() => [{
    role: "assistant",
    text: role === "patient"
      ? `Welcome back! I'm Amina. Ask me about your medications, today's care plan, or anything health-related.`
      : `Hi — I'm Amina. I can answer questions on diabetes, blood pressure, medications, diet, and more. How can I help you today?`,
  }]);
  const [draft,    setDraft]    = useState(() => {
    // Home page can seed a sample prompt via sessionStorage.
    try {
      const seeded = sessionStorage.getItem("AMINA_CHAT_SEED");
      if (seeded) { sessionStorage.removeItem("AMINA_CHAT_SEED"); return seeded; }
    } catch { /* noop */ }
    return "";
  });
  const [busy,     setBusy]     = useState(false);
  const scrollerRef             = useRef(null);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    // Append the user message AND an empty assistant bubble that tokens
    // will fill in progressively. Streaming = first character lands in
    // ~500ms instead of ~1.5s of blank silence on the non-stream path.
    setMessages((xs) => [
      ...xs,
      { role: "user", text },
      { role: "assistant", text: "" },
    ]);
    setBusy(true);

    let acc = "";
    let receivedAny = false;

    const replaceLastAssistant = (newText) => {
      setMessages((xs) => {
        const last = xs[xs.length - 1];
        if (last && last.role === "assistant") {
          return [...xs.slice(0, -1), { role: "assistant", text: newText }];
        }
        return xs;
      });
    };

    try {
      await streamChat({
        baseUrl: API,
        headers: _authHeaders(),
        body: { session_id: sid, message: text, user_role: role || null },
        onToken: (chunk) => {
          acc += chunk;
          receivedAny = true;
          replaceLastAssistant(acc);
        },
        onDone: (meta) => {
          // Some pipelines deliver the final, post-policy text in `done`.
          // Prefer it when it differs from what we accumulated from tokens.
          const finalText = meta?.response || meta?.message || meta?.reply;
          if (finalText && String(finalText) !== acc) {
            replaceLastAssistant(String(finalText));
          } else if (!receivedAny) {
            replaceLastAssistant(
              "Sorry — I couldn't reach the care server just now. Please try again in a moment."
            );
          }
        },
        onError: (err) => {
          if (!receivedAny) {
            const msg = typeof err === "string" && err && err.length < 240
              ? err
              : "Sorry — Amina isn't reachable right now. Please try again in a moment.";
            replaceLastAssistant(msg);
          }
        },
      });
    } catch {
      if (!receivedAny) {
        replaceLastAssistant(
          "Network trouble — let's try that again when you're back online."
        );
      }
    } finally {
      setBusy(false);
    }
  }, [draft, busy, sid, role]);

  // Stick to bottom on new messages — but only if the user was already at
  // the bottom. If they scrolled up to re-read, don't yank them.
  useStickToBottom(scrollerRef, [messages, busy]);

  return (
    <div style={{
      maxWidth: 840, margin: "0 auto", padding: "26px 18px 16px 18px",
      height: "100%", display: "flex", flexDirection: "column",
    }}>
      <header style={{
        display: "flex", alignItems: "center", gap: 14,
        paddingBottom: 14,
        borderBottom: "1px solid rgba(148, 163, 184, 0.18)",
      }}>
        <div style={{
          width: 52, height: 52, borderRadius: "50%",
          background: "radial-gradient(circle at 30% 30%, #a78bfa, #4f46e5 60%, #312e81)",
          boxShadow: "0 8px 22px rgba(99, 102, 241, 0.40)",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          color: "#fff", fontWeight: 800, fontSize: 22,
        }}>A</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>Amina</div>
          <div style={{ fontSize: 12, color: "#a7f3d0" }}>● Online</div>
        </div>
        {role && (
          <button type="button" onClick={() => navigate("#/")}
                  style={{
                    padding: "7px 12px", borderRadius: 8,
                    background: "rgba(30, 41, 59, 0.75)",
                    border: "1px solid rgba(148, 163, 184, 0.30)",
                    color: "#e2e8f0", fontSize: 12, fontWeight: 600,
                    cursor: "pointer",
                  }}>← Back to dashboard</button>
        )}
      </header>

      <div ref={scrollerRef} style={{
        flex: 1, minHeight: 240, overflow: "auto",
        padding: "18px 4px",
        // Industry-standard scroll-container polish — see utils/stickToBottom.js.
        overscrollBehavior: "contain",
        scrollbarGutter: "stable",
        scrollbarWidth: "thin",
        scrollbarColor: "rgba(148, 163, 184, 0.25) transparent",
      }}>
        {messages.map((m, i) => <Bubble key={i} role={m.role} text={m.text} />)}
        {busy && (
          <div style={{ color: "#94a3b8", fontSize: 13, padding: "4px 14px",
                        fontStyle: "italic" }}>
            Amina is thinking…
          </div>
        )}
      </div>

      <div style={{
        display: "flex", gap: 10, alignItems: "flex-end",
        padding: "12px 0 8px 0",
        borderTop: "1px solid rgba(148, 163, 184, 0.18)",
      }}>
        <textarea rows={1} style={{ ...INPUT, resize: "none", minHeight: 46 }}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder={busy ? "Waiting for Amina…" : "Ask about medication, symptoms, a care plan…"} />
        <button type="button" onClick={send}
                disabled={!draft.trim() || busy}
                style={{
                  padding: "12px 18px",
                  background: busy || !draft.trim()
                    ? "rgba(71, 85, 105, 0.70)"
                    : "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
                  color: "#fff", border: "none", borderRadius: 12,
                  fontSize: 14, fontWeight: 800,
                  cursor: busy || !draft.trim() ? "not-allowed" : "pointer",
                  boxShadow: busy || !draft.trim() ? "none"
                          : "0 6px 16px rgba(99, 102, 241, 0.40)",
                }}>Send</button>
      </div>

      {!role && (
        <div style={{
          padding: "10px 12px", marginTop: 10,
          background: "rgba(99, 102, 241, 0.08)",
          border: "1px solid rgba(129, 140, 248, 0.30)",
          borderRadius: 10, color: "#c7d2fe",
          fontSize: 12, textAlign: "center",
        }}>
          Chatting as a guest. <a href="#/login"
                                  onClick={(e) => { e.preventDefault(); navigate("#/login"); }}
                                  style={{ color: "#ddd6fe", fontWeight: 700 }}>Sign in</a>{" "}
          to save your conversation history.
        </div>
      )}
    </div>
  );
}
