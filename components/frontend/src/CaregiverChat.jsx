/**
 * CaregiverChat.jsx
 * =================
 * Patient-side direct chat with their assigned caregiver.
 *
 * Features:
 *  - Loads caregiver info (name, photo, specialization) on mount
 *  - Polls for new messages every 3 s when the panel is open
 *  - WhatsApp-style message status ticks:
 *      ✓   grey  = sent (stored on server)
 *      ✓✓  grey  = delivered (caregiver fetched the thread)
 *      ✓✓  blue  = read (caregiver opened the chat)
 *  - Toast notification after send: "Message sent ✓" / "Failed ✗"
 *  - "Waiting for caregiver…" hint when all messages are sent but not yet delivered
 *  - TTS: speaker button on caregiver messages reads them aloud
 *  - STT: microphone button in input bar transcribes voice to text
 */

import { useState, useEffect, useRef, useCallback } from "react";

const API = (window.AMINA_API || "http://localhost:8000").replace(/\/+$/, "");
const POLL_MS = 3000;

// ── Voice helpers ─────────────────────────────────────────────────────────────

function pickMimeType() {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"];
  for (const t of types) if (window.MediaRecorder?.isTypeSupported?.(t)) return t;
  return "";
}

async function ttsSpeak(text, onStart, onEnd) {
  try {
    // Pass the caregiver's UI language so the backend routes to the
    // right engine (Piper English / MMS Mandinka). Falls back to
    // English on localStorage miss.
    const lang = (() => {
      try { return localStorage.getItem("AMINA_LANG") || "en"; }
      catch { return "en"; }
    })();
    const r = await fetch(`${API}/api/v1/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, lang }),
    });
    if (!r.ok) { onEnd?.(); return null; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const au = new Audio(url);
    au.onended = () => { URL.revokeObjectURL(url); onEnd?.(); };
    au.onerror = () => { URL.revokeObjectURL(url); onEnd?.(); };
    onStart?.();
    await au.play();
    return au;
  } catch {
    onEnd?.();
    return null;
  }
}

async function sttTranscribe(blob, mime) {
  let ext = "bin";
  if ((mime || "").includes("webm")) ext = "webm";
  else if ((mime || "").includes("ogg")) ext = "ogg";
  const form = new FormData();
  form.append("file", blob, `mic.${ext}`);
  try {
    const r = await fetch(`${API}/api/v1/stt`, { method: "POST", body: form });
    if (!r.ok) return "";
    const d = await r.json();
    return d.transcript || d.text || "";
  } catch { return ""; }
}

// ── Tick component ────────────────────────────────────────────────────────────

function Ticks({ status }) {
  if (status === "read")      return <span style={{ color: "#53bdeb",  fontWeight: 700, fontSize: 13 }}>✓✓</span>;
  if (status === "delivered") return <span style={{ color: "#8696a0",  fontSize: 13 }}>✓✓</span>;
  if (status === "failed")    return <span style={{ color: "#dc2626",  fontSize: 13 }}>✗</span>;
  return                             <span style={{ color: "#8696a0",  fontSize: 13 }}>✓</span>;  // sent
}

// ── Status Toast ──────────────────────────────────────────────────────────────

function SendToast({ status, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, status === "failed" ? 4000 : 2000);
    return () => clearTimeout(t);
  }, [status]);

  const cfg = {
    sent:    { bg: "#f0fdf4", border: "#bbf7d0", color: "#15803d", text: "Message sent ✓" },
    failed:  { bg: "#fef2f2", border: "#fecaca", color: "#dc2626", text: "Failed to send ✗ — tap to retry" },
  }[status] || null;

  if (!cfg) return null;
  return (
    <div style={{
      position: "absolute", bottom: 72, left: "50%", transform: "translateX(-50%)",
      background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color,
      borderRadius: 8, padding: "7px 16px", fontSize: 13, fontWeight: 600,
      boxShadow: "0 2px 8px rgba(0,0,0,.12)", whiteSpace: "nowrap", zIndex: 10,
    }}>
      {cfg.text}
    </div>
  );
}

// ── Caregiver avatar ──────────────────────────────────────────────────────────

function CgAvatar({ photo, name, size = 40 }) {
  if (photo) {
    return (
      <img
        src={photo}
        alt={name}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
      />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: "linear-gradient(135deg,#10b981,#059669)",
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "#fff", fontWeight: 700, fontSize: size * 0.4,
    }}>
      {(name || "C")[0].toUpperCase()}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CaregiverChat({ token, patientName, onClose }) {
  const [caregiver, setCaregiver]   = useState(null);
  const [cgError, setCgError]       = useState("");
  const [messages, setMessages]     = useState([]);
  const [input, setInput]           = useState("");
  const [sending, setSending]       = useState(false);
  const [toast, setToast]           = useState(null);   // "sent" | "failed" | null
  const [loading, setLoading]       = useState(true);
  // TTS state
  const [ttsId, setTtsId]           = useState(null);   // message id currently playing
  const ttsAudioRef                 = useRef(null);
  // STT state
  const [recording, setRecording]   = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef                 = useRef(null);
  const chunksRef                   = useRef([]);
  const mimeRef                     = useRef("");
  const bottomRef                   = useRef(null);
  const pollRef                     = useRef(null);
  const inputRef                    = useRef(null);

  // ── Load caregiver info ───────────────────────────────────────────────────

  useEffect(() => {
    fetch(`${API}/api/v1/patient/my-caregiver`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => { setCaregiver(d); setLoading(false); })
      .catch(err => {
        setCgError(err === 404 ? "No caregiver linked to your account yet." : "Couldn't load caregiver info.");
        setLoading(false);
      });
  }, [token]);

  // ── Poll messages ─────────────────────────────────────────────────────────

  const fetchMessages = useCallback(async (cgId) => {
    if (!cgId) return;
    try {
      const r = await fetch(
        `${API}/api/v1/direct-chat/messages?partner_id=${encodeURIComponent(cgId)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!r.ok) return;
      const data = await r.json();
      setMessages(data.messages || []);
    } catch { /* ignore poll errors */ }
  }, [token]);

  useEffect(() => {
    if (!caregiver?.caregiver_id) return;
    fetchMessages(caregiver.caregiver_id);    // immediate first load

    // Mark as read when chat opens
    fetch(
      `${API}/api/v1/direct-chat/read?partner_id=${encodeURIComponent(caregiver.caregiver_id)}`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` } },
    ).catch(() => {});

    // Start polling
    pollRef.current = setInterval(() => fetchMessages(caregiver.caregiver_id), POLL_MS);
    return () => clearInterval(pollRef.current);
  }, [caregiver?.caregiver_id, fetchMessages, token]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── TTS: speak caregiver message ─────────────────────────────────────────

  const handleSpeak = async (msg) => {
    // If already playing this message, stop it
    if (ttsId === msg.id) {
      ttsAudioRef.current?.pause();
      ttsAudioRef.current = null;
      setTtsId(null);
      return;
    }
    // Stop any currently playing audio
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current = null;
    }
    setTtsId(msg.id);
    const au = await ttsSpeak(
      msg.text,
      () => {},
      () => setTtsId(null),
    );
    if (au) ttsAudioRef.current = au;
  };

  // ── STT: microphone recording ─────────────────────────────────────────────

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      const mime = pickMimeType();
      mimeRef.current = mime;
      chunksRef.current = [];
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (e) => { if (e.data?.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (!chunksRef.current.length) { setRecording(false); return; }
        setTranscribing(true);
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: mime || "application/octet-stream" });
        const text = await sttTranscribe(blob, mime);
        setTranscribing(false);
        if (text) {
          setInput(prev => prev ? `${prev} ${text}` : text);
          setTimeout(() => inputRef.current?.focus(), 50);
        }
      };
      recorder.start();
      setRecording(true);
    } catch {
      setRecording(false);
    }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  };

  const toggleRecording = () => {
    if (recording) stopRecording();
    else startRecording();
  };

  // ── Send message ──────────────────────────────────────────────────────────

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending || !caregiver?.caregiver_id) return;
    setInput("");
    setSending(true);

    // Optimistic UI: add with status "sent"
    const tmpId = `tmp_${Date.now()}`;
    const optimistic = {
      id: tmpId, sender_type: "patient", text,
      ts: Date.now() / 1000, status: "sent",
    };
    setMessages(prev => [...prev, optimistic]);

    try {
      const r = await fetch(`${API}/api/v1/direct-chat/send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text, partner_id: caregiver.caregiver_id }),
      });
      if (!r.ok) throw new Error("send failed");

      const data = await r.json();
      // Replace optimistic with server message
      setMessages(prev => prev.map(m => m.id === tmpId ? data.message : m));
      setToast("sent");
    } catch {
      // Mark optimistic as failed
      setMessages(prev => prev.map(m => m.id === tmpId ? { ...m, status: "failed" } : m));
      setToast("failed");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  // ── Waiting-for-caregiver hint ────────────────────────────────────────────

  const patientMsgs   = messages.filter(m => m.sender_type === "patient");
  const lastPatientMs = patientMsgs[patientMsgs.length - 1];
  const waitingHint   = lastPatientMs?.status === "sent";

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={styles.overlay}>
        <div style={styles.panel}>
          <div style={{ padding: 40, textAlign: "center", color: "#9ca3af" }}>
            Loading caregiver info…
          </div>
        </div>
      </div>
    );
  }

  if (cgError || !caregiver) {
    return (
      <div style={styles.overlay}>
        <div style={styles.panel}>
          <div style={{ padding: "20px 24px", borderBottom: "1px solid #f0f0f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 700 }}>Chat with Caregiver</span>
            <button onClick={onClose} style={styles.closeBtn}>✕</button>
          </div>
          <div style={{ padding: 40, textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>👩‍⚕️</div>
            <div style={{ fontWeight: 600, color: "#374151", marginBottom: 8 }}>No caregiver linked yet</div>
            <div style={{ color: "#6b7280", fontSize: 14 }}>
              {cgError || "Ask your caregiver to register using your invite code."}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={styles.panel}>

        {/* ── Header ── */}
        <div style={{
          background: "linear-gradient(135deg,#10b981,#059669)",
          padding: "14px 18px",
          display: "flex", alignItems: "center", gap: 12,
          borderRadius: "16px 16px 0 0",
        }}>
          <CgAvatar photo={caregiver.photo} name={caregiver.name} size={42} />
          <div style={{ flex: 1 }}>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: 16 }}>
              {caregiver.name}
            </div>
            <div style={{ color: "#d1fae5", fontSize: 12 }}>
              {caregiver.specialization || caregiver.relationship || "Your Caregiver"}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,.2)", border: "none",
            color: "#fff", borderRadius: 8, padding: "5px 10px",
            cursor: "pointer", fontSize: 13,
          }}>
            ✕ Close
          </button>
        </div>

        {/* ── Messages ── */}
        <div style={{
          flex: 1, overflowY: "auto", padding: "16px 16px 4px",
          background: "#f0fdf4",
        }}>
          {messages.length === 0 && (
            <div style={{ textAlign: "center", color: "#9ca3af", marginTop: 60, fontSize: 14 }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>👋</div>
              Say hello to {caregiver.name}!<br />
              <span style={{ fontSize: 12 }}>Messages are private between you and your caregiver.</span>
            </div>
          )}

          {messages.map((m) => {
            const isMe = m.sender_type === "patient";
            return (
              <div key={m.id} style={{
                display: "flex",
                justifyContent: isMe ? "flex-end" : "flex-start",
                marginBottom: 8,
              }}>
                {!isMe && (
                  <CgAvatar photo={caregiver.photo} name={caregiver.name} size={28} />
                )}
                <div style={{
                  maxWidth: "72%",
                  marginLeft: isMe ? 0 : 8,
                  marginRight: isMe ? 0 : 0,
                }}>
                  <div style={{ position: "relative" }} className="chat-bubble-wrap">
                    <div style={{
                      background: isMe ? "#10b981" : "#fff",
                      color: isMe ? "#fff" : "#111",
                      padding: "9px 13px",
                      borderRadius: isMe ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                      fontSize: 14, lineHeight: 1.5,
                      boxShadow: "0 1px 2px rgba(0,0,0,.08)",
                      opacity: m.status === "failed" ? 0.6 : 1,
                      paddingRight: !isMe ? 34 : undefined,
                    }}>
                      {m.text}
                    </div>
                    {/* TTS speaker button — only on caregiver messages */}
                    {!isMe && (
                      <button
                        onClick={() => handleSpeak(m)}
                        title={ttsId === m.id ? "Stop" : "Read aloud"}
                        style={{
                          position: "absolute", top: 6, right: 6,
                          background: ttsId === m.id ? "#10b981" : "rgba(0,0,0,.06)",
                          border: "none", borderRadius: "50%",
                          width: 24, height: 24,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          cursor: "pointer", fontSize: 12, color: ttsId === m.id ? "#fff" : "#6b7280",
                          transition: "background .15s",
                          flexShrink: 0,
                        }}
                      >
                        {ttsId === m.id ? "■" : "🔊"}
                      </button>
                    )}
                  </div>
                  {/* Timestamp + ticks */}
                  <div style={{
                    display: "flex", alignItems: "center",
                    justifyContent: isMe ? "flex-end" : "flex-start",
                    gap: 4, marginTop: 2,
                  }}>
                    <span style={{ fontSize: 10, color: "#9ca3af" }}>
                      {new Date(m.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    {isMe && <Ticks status={m.status} />}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Waiting hint */}
          {waitingHint && (
            <div style={{
              textAlign: "center", color: "#9ca3af", fontSize: 12, margin: "8px 0",
              padding: "6px 14px", background: "#fff", borderRadius: 20,
              marginLeft: "auto", marginRight: "auto",
              width: "fit-content", display: "flex", alignItems: "center", gap: 6,
              justifyContent: "center",
            }}>
              <span style={{ animation: "pulse 1.5s infinite" }}>⏳</span>
              Waiting for {caregiver.name} to receive your message…
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* ── Input ── */}
        <div style={{
          padding: "10px 14px", borderTop: "1px solid #e5e7eb",
          display: "flex", gap: 10, position: "relative", background: "#fff",
          borderRadius: "0 0 16px 16px",
        }}>
          {toast && <SendToast status={toast} onDone={() => setToast(null)} />}
          {/* Mic / STT button */}
          <button
            onClick={toggleRecording}
            disabled={transcribing}
            title={recording ? "Stop recording" : "Voice input"}
            style={{
              width: 44, height: 44, borderRadius: "50%", border: "none",
              background: recording ? "#dc2626" : transcribing ? "#f59e0b" : "#f3f4f6",
              color: recording ? "#fff" : transcribing ? "#fff" : "#6b7280",
              fontSize: recording ? 14 : 18,
              cursor: transcribing ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "background .15s", flexShrink: 0,
              animation: recording ? "micPulse 1s ease-in-out infinite" : "none",
            }}
          >
            {transcribing ? "…" : recording ? "■" : "🎤"}
          </button>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder={recording ? "Recording… tap ■ to stop" : transcribing ? "Transcribing…" : `Message ${caregiver.name}…`}
            disabled={recording || transcribing}
            style={{
              flex: 1, padding: "10px 14px", borderRadius: 24,
              border: `1.5px solid ${recording ? "#dc2626" : "#d1d5db"}`,
              fontSize: 14, outline: "none",
              background: recording ? "#fff5f5" : "#f9fafb",
              transition: "border-color .15s, background .15s",
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending || recording || transcribing}
            style={{
              width: 44, height: 44, borderRadius: "50%", border: "none",
              background: input.trim() && !sending && !recording && !transcribing ? "#10b981" : "#e5e7eb",
              color: input.trim() && !sending && !recording && !transcribing ? "#fff" : "#9ca3af",
              fontSize: 18, cursor: "pointer", display: "flex",
              alignItems: "center", justifyContent: "center",
              transition: "background .15s",
              flexShrink: 0,
            }}
          >
            {sending ? "…" : "➤"}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:.4 } }
        @keyframes micPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(220,38,38,.4) } 50% { box-shadow: 0 0 0 6px rgba(220,38,38,0) } }
        .chat-bubble-wrap button { opacity: 0; transition: opacity .15s; }
        .chat-bubble-wrap:hover button { opacity: 1; }
      `}</style>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  overlay: {
    position: "fixed", inset: 0,
    background: "rgba(0,0,0,.45)",
    display: "flex", alignItems: "flex-end", justifyContent: "flex-end",
    padding: 24, zIndex: 2000,
  },
  panel: {
    width: 400, height: "85vh", maxHeight: 680,
    display: "flex", flexDirection: "column",
    background: "#fff", borderRadius: 16,
    boxShadow: "0 20px 60px rgba(0,0,0,.25)",
    overflow: "hidden",
  },
  closeBtn: {
    background: "none", border: "none", fontSize: 18,
    cursor: "pointer", color: "#9ca3af", padding: 4,
  },
};
