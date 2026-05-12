/**
 * BeginnerChat — full-feature chat view for the Beginner literacy shell.
 *
 * Feature parity with the chat in App.jsx:
 *   • Text chat        → POST /api/v1/agent/chat
 *   • STT voice input  → POST /api/v1/stt  (MediaRecorder + FormData)
 *   • TTS per bubble   → POST /api/v1/tts  (plays audio blob)
 *   • Translate bubble → POST /api/v1/agent/translate
 *   • Language toggle  → en / ma (English / Mandinka)
 *   • Model preference → amina / groq / mistral / gemini / base
 *   • Thumbs up/down   → POST /api/v1/agent/feedback
 *   • Regenerate       → chat with regenerate_hint
 *   • Copy text
 *   • WHO source links → sources[] rendered under assistant bubbles
 *   • Upload Rx photo  → POST /api/v1/agent/prescription (FormData "file")
 *   • Symptom form     → structured text → /agent/chat
 *   • Rx helper form   → structured text → /agent/chat
 *   • Download doctor sheet PDF → /agent/document/generate then /download/pdf
 *   • Resume session   → GET /api/v1/agent/session/resume on mount
 *
 * Design: AMINA dark theme (Outfit font, #050810 bg, #0c1128 surfaces,
 *          #818cf8 indigo accent).
 */

import { useEffect, useRef, useState, useCallback } from "react";

const API = (window.AMINA_API || "http://localhost:8000").replace(/\/+$/, "");

// ── Theme tokens (match AMINA) ──────────────────────────────────────────────

const T = {
  bg:         "#050810",
  bgSoft:     "#0a0f1f",
  surface:    "#0c1128",
  surface2:   "#111633",
  border:     "rgba(255,255,255,.08)",
  borderSoft: "rgba(255,255,255,.04)",
  text:       "#e2e8f0",
  muted:      "#94a3b8",
  subtle:     "#64748b",
  accent:     "#818cf8",
  accentDark: "#6366f1",
  user:       "linear-gradient(135deg,#6366f1,#8b5cf6)",
  bot:        "#0c1128",
  green:      "#10b981",
  amber:      "#f59e0b",
  red:        "#ef4444",
  pink:       "#ec4899",
};

const FONT = "'Outfit', 'DM Sans', ui-sans-serif, system-ui, sans-serif";

// ── Model options (mirror App.jsx) ──────────────────────────────────────────

const MODELS = [
  { id: "amina",   label: "AMINA 70B",    sub: "Disabled — maintenance", disabled: true,
    disabledReason: "AMINA LoRA is disabled for maintenance. The fine-tuned endpoint is offline; pick Mistral, Groq, Gemini, or GPT-4o mini in the meantime." },
  { id: "groq",    label: "Groq Mixtral", sub: "Fast" },
  { id: "mistral", label: "Mistral 7B",   sub: "Light" },
  { id: "gemini",  label: "Gemini Lite",  sub: "Google" },
  { id: "base",    label: "GPT-4o mini",  sub: "OpenAI" },
];

const LANGS = [
  { id: "en", label: "English" },
  { id: "ma", label: "Mandinka" },
];

// ── Utils ───────────────────────────────────────────────────────────────────

function pickMimeType() {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"];
  for (const t of types) if (window.MediaRecorder?.isTypeSupported?.(t)) return t;
  return "";
}

function getOrCreateSessionId() {
  try {
    const sid = localStorage.getItem("AMINA_SID");
    if (sid) return sid;
  } catch { /* ignore */ }
  const fresh = "sid_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  try { localStorage.setItem("AMINA_SID", fresh); } catch { /* ignore */ }
  return fresh;
}

// ── Inline icon set ─────────────────────────────────────────────────────────

const Ic = {
  back:    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>,
  send:    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></svg>,
  mic:     <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></svg>,
  stop:    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>,
  speaker: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a9 9 0 0 1 0 14"/></svg>,
  copy:    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>,
  translate:<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 8h14M9 4v4M4 20l4-10 4 10M6 16h4M14 14h8M18 12v2M15 20s2-2 3-5M21 20s-2-2-3-5"/></svg>,
  up:      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 10v12h10a2 2 0 0 0 2-1.7l1.4-8A2 2 0 0 0 18.4 10H14V4a2 2 0 0 0-4 0v6z"/></svg>,
  down:    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 14V2H7a2 2 0 0 0-2 1.7l-1.4 8A2 2 0 0 0 5.6 14H10v6a2 2 0 0 0 4 0v-6z"/></svg>,
  regen:   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16"/><path d="M3 21v-5h5"/></svg>,
  upload:  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/></svg>,
  pdf:     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>,
  list:    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>,
  pill:    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.5 20.5 20.5 10.5a5.5 5.5 0 0 0-7.78-7.78L2.72 12.72a5.5 5.5 0 0 0 7.78 7.78zM8.5 8.5l7 7"/></svg>,
  link:    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7L12 5"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7L12 19"/></svg>,
  close:   <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  trash:   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>,
};

// ── Main component ──────────────────────────────────────────────────────────

// ── SOS detection ───────────────────────────────────────────────────────────
// Map keywords found in chat text → reason id understood by EmergencyAlert.
// Order matters: more specific patterns first so stroke isn't swallowed by
// generic "weakness", etc.

const REASON_PATTERNS = [
  { id: "chest_pain", rx: /\b(chest\s*(pain|pressure|tight|heavy|squeez)|heart\s*attack|pain.*(chest|heart))\b/i },
  { id: "breathing",  rx: /\b(can(?:'| no)?t\s*breathe|cannot\s*breathe|difficulty\s*breath|shortness\s*of\s*breath|gasp|choking|suffocat|wheez)\b/i },
  { id: "stroke",     rx: /\b(stroke|face\s*droop|arm\s*weak|slurred\s*speech|can(?:'|no)?t\s*speak|sudden\s*numb|thunderclap|worst\s*headache|vision\s*loss|can(?:'|no)?t\s*see)\b/i },
  { id: "bleeding",   rx: /\b(bleeding\s*heav|heavy\s*bleed|blood\s*won(?:'|)t\s*stop|hemorrhag|gushing\s*blood|bleeding\s*a\s*lot)\b/i },
  { id: "fainted",    rx: /\b(fainted|unconscious|passed\s*out|collapsed|not\s*breathing|seizure|convuls|unresponsive|blacked\s*out)\b/i },
];

// Explicit SOS intent in the user's text
const SOS_INTENT_RX = /\b(send\s+(an?\s+)?(emergency\s+)?alert|alert\s+(my|the)\s*(caregiver|family|nurse)|call\s+for\s+help|send\s+help|i\s+need\s+help\s+now|emergency\s+alert|sos\b|panic\s*button)\b/i;

function detectReason(text) {
  if (!text) return null;
  for (const p of REASON_PATTERNS) {
    if (p.rx.test(text)) return p.id;
  }
  return null;
}

function detectSosIntent(text) {
  return !!text && SOS_INTENT_RX.test(text);
}


export default function BeginnerChat({ token, patient, language: initialLang, mode, onClose, onRequestEmergency }) {
  const [msgs, setMsgs]           = useState([]);
  const [input, setInput]         = useState("");
  const [busy, setBusy]           = useState(false);
  const [err, setErr]             = useState("");
  const [lang, setLang]           = useState(initialLang || localStorage.getItem("AMINA_LANG") || "en");
  // AMINA LoRA disabled for maintenance -- default to Mistral and silently
  // migrate any cached "amina" preference so beginner users aren't stuck
  // waiting for the dead LoRA endpoint to time out.
  const [model, setModel]         = useState(() => {
    const cached = localStorage.getItem("AMINA_MODEL_PREF") || "mistral";
    return cached === "amina" ? "mistral" : cached;
  });
  const [modelOpen, setModelOpen] = useState(false);
  const [rec, setRec]             = useState(false);
  const [recSec, setRecSec]       = useState(0);
  const [showSymptom, setShowSymptom] = useState(false);
  const [showRx, setShowRx]           = useState(false);
  const [docBusy, setDocBusy]         = useState(false);
  const [chatPdfBusy, setChatPdfBusy] = useState(false);
  const [ttsPlayingId, setTtsPlayingId] = useState(null);

  const sessionIdRef  = useRef(getOrCreateSessionId());
  const endRef        = useRef(null);
  const recorderRef   = useRef(null);
  const chunksRef     = useRef([]);
  const timerRef      = useRef(null);
  const audioRef      = useRef(null);
  const fileInputRef  = useRef(null);

  // Persist lang/model
  useEffect(() => { try { localStorage.setItem("AMINA_LANG", lang); } catch {} }, [lang]);
  useEffect(() => { try { localStorage.setItem("AMINA_MODEL_PREF", model); } catch {} }, [model]);

  // Resume session on mount
  useEffect(() => {
    let cancel = false;
    fetch(`${API}/api/v1/agent/session/resume`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancel || !d) return;
        if (d.session_id) {
          sessionIdRef.current = d.session_id;
          try { localStorage.setItem("AMINA_SID", d.session_id); } catch {}
        }
        if (Array.isArray(d.messages) && d.messages.length > 0) {
          setMsgs(d.messages.slice(-20).map(m => ({
            role:    m.role,
            content: m.content,
            sources: m.sources || [],
          })));
        } else {
          setMsgs([{
            role: "assistant",
            content: lang === "ma"
              ? "I be ñaadii? I be mennu kontibali? N y'i maakoyi la ding."
              : "Hello! I'm AMINA. You can ask me anything about your health — I'm here to help you.",
          }]);
        }
      })
      .catch(() => {});
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (endRef.current) endRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, busy]);

  // ── Send a message ────────────────────────────────────────────────────────

  const sendText = useCallback(async (text, regenerateHint = null, replaceLastAssistant = false) => {
    const t = (text || "").trim();
    if (!t) return;
    setErr("");

    // SOS detection on the user side — explicit intent OR emergency keywords.
    const userReason = detectReason(t);
    const userWantsSos = detectSosIntent(t);

    if (!replaceLastAssistant) {
      setMsgs(p => [...p, { role: "user", content: t }]);
    } else {
      setMsgs(p => p.slice(0, -1));
    }

    // If the user explicitly asked to send an alert, surface the action
    // card right away — no need to wait for the model round-trip.
    if (userWantsSos || userReason) {
      const suggestedId = userReason || "other";
      setMsgs(p => {
        // Avoid stacking multiple cards if the last item is already a prompt
        if (p.length && p[p.length - 1].role === "sos_prompt") return p;
        return [...p, {
          role:       "sos_prompt",
          reasonId:   suggestedId,
          source:     userWantsSos ? "explicit" : "symptom",
          userText:   t,
        }];
      });
    }

    setBusy(true);
    try {
      const r = await fetch(`${API}/api/v1/agent/chat`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          // Tells the backend's basic_beginner_chat_patch to apply
          // the deterministic UX gate. Header is ignored when absent.
          ...(mode ? { "X-AMINA-Mode": String(mode) } : {}),
        },
        body: JSON.stringify({
          message:          t,
          session_id:       sessionIdRef.current,
          patient_id:       patient?.id || null,
          patient_name:     patient?.name || null,
          language:         lang,
          user_role:        null,
          regenerate_hint:  regenerateHint,
          model_preference: model,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setMsgs(p => [...p, {
        role:         "assistant",
        content:      d.response || "I'm sorry, please try again.",
        sources:      d.sources || [],
        triage_level: d.triage_level,
        is_emergency: d.is_emergency,
        tools_used:   d.tools_used,
      }]);

      // Backend asked the frontend to export the chat as a PDF (user
      // said something like "send me a pdf of our chat"). Trigger the
      // download immediately — the acknowledgement bubble above is
      // already in the transcript, so by the time the PDF is fetched
      // it will include AMINA's confirmation turn.
      if (d.export_action && d.export_action.type === "download_chat_pdf") {
        setTimeout(() => { downloadChatTranscript(); }, 350);
      }

      // Backend flagged an emergency — offer the alert action, using
      // whatever reason we could infer from the user's own message (fall
      // back to "other"). Skip if we already injected one above.
      if (d.is_emergency) {
        setMsgs(p => {
          const last = p[p.length - 1];
          const prev = p[p.length - 2];
          if (prev && prev.role === "sos_prompt") return p;
          if (last && last.role === "sos_prompt") return p;
          const inferred = userReason || detectReason(d.response || "") || "other";
          return [...p, {
            role:       "sos_prompt",
            reasonId:   inferred,
            source:     "agent",
            userText:   t,
          }];
        });
      }
    } catch (e) {
      setErr(lang === "ma" ? "Ñinnu maati jusu." : "Could not reach AMINA. Please check your connection.");
    } finally {
      setBusy(false);
    }
  }, [token, patient, lang, model, mode]);

  const handleSend = () => {
    const t = input.trim();
    if (!t || busy) return;
    setInput("");
    sendText(t);
  };

  // ── STT recording ─────────────────────────────────────────────────────────

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const mime = pickMimeType();
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: mime || "audio/webm" });
        chunksRef.current = [];
        if (blob.size < 800) { setRec(false); return; }
        setBusy(true);
        const form = new FormData();
        const ext = (mime || "").includes("ogg") ? "ogg" : "webm";
        form.append("file", blob, `mic.${ext}`);
        try {
          const r = await fetch(`${API}/api/v1/stt`, { method: "POST", body: form });
          const d = r.ok ? await r.json() : null;
          const text = (d?.transcript || d?.text || "").trim();
          if (text) {
            setInput("");
            await sendText(text);
          } else {
            setErr(lang === "ma" ? "N m'a moyi." : "I didn't catch that — please try again.");
          }
        } catch {
          setErr("STT failed.");
        } finally {
          setBusy(false);
        }
      };
      recorderRef.current = recorder;
      recorder.start(500);
      setRec(true);
      setRecSec(0);
      timerRef.current = setInterval(() => setRecSec(s => s + 1), 1000);
    } catch {
      setErr(lang === "ma" ? "Microphone tinnaa." : "Microphone permission denied.");
    }
  };

  const stopRec = () => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setRec(false);
    setRecSec(0);
  };

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (audioRef.current) { try { audioRef.current.pause(); } catch {} }
  }, []);

  // ── TTS per bubble ────────────────────────────────────────────────────────

  const playTTS = async (idx, text) => {
    try {
      if (audioRef.current) { try { audioRef.current.pause(); } catch {} audioRef.current = null; }
      setTtsPlayingId(idx);
      // Pull the active site language so the beginner bubbles speak in
      // the same voice the user selected. Falls back to English on
      // localStorage miss — matches the main chat's ttsPlay defaults.
      const lang = (() => {
        try { return localStorage.getItem("AMINA_LANG") || "en"; }
        catch { return "en"; }
      })();
      const r = await fetch(`${API}/api/v1/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, lang }),
      });
      if (!r.ok) throw new Error("tts failed");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { setTtsPlayingId(null); URL.revokeObjectURL(url); };
      audio.onerror = () => { setTtsPlayingId(null); URL.revokeObjectURL(url); };
      await audio.play();
    } catch {
      setTtsPlayingId(null);
      setErr("Voice unavailable.");
    }
  };

  // ── Translate bubble ──────────────────────────────────────────────────────

  const translateMsg = async (idx) => {
    const m = msgs[idx];
    if (!m) return;
    const source = lang;
    const target = lang === "en" ? "ma" : "en";
    try {
      const r = await fetch(`${API}/api/v1/agent/translate`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: m.content, source, target }),
      });
      if (!r.ok) throw new Error();
      const d = await r.json();
      if (d.translated) {
        setMsgs(p => p.map((x, i) => i === idx
          ? { ...x, content: d.translated, _translated: target }
          : x));
      }
    } catch {
      setErr("Translation failed.");
    }
  };

  // ── Feedback ──────────────────────────────────────────────────────────────

  const sendFeedback = async (idx, rating) => {
    setMsgs(p => p.map((x, i) => i === idx ? { ...x, _vote: rating } : x));
    try {
      await fetch(`${API}/api/v1/agent/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id:    sessionIdRef.current,
          message_index: idx,
          rating,
        }),
      });
    } catch { /* silent */ }
  };

  const regenerate = async (idx) => {
    const asst = msgs[idx];
    if (!asst || asst.role !== "assistant") return;
    // Find the user message that prompted this reply.
    let userIdx = -1;
    for (let i = idx - 1; i >= 0; i--) {
      if (msgs[i].role === "user") { userIdx = i; break; }
    }
    if (userIdx < 0) return;
    const lastUser = msgs[userIdx].content;
    // Slice off the user message + assistant + anything in-between so
    // sendText can re-append exactly one user bubble and then the new
    // assistant reply. The previous slice(0, idx) kept the original
    // user message, then sendText appended it again — producing a
    // duplicate user bubble in basic/beginner regenerate.
    setMsgs(p => p.slice(0, userIdx));
    await sendText(lastUser, "please try a different explanation");
  };

  // ── Upload prescription photo ─────────────────────────────────────────────

  const onFilePicked = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    setErr("");
    setMsgs(p => [...p, {
      role: "user",
      content: `📷 ${lang === "ma" ? "N ye rx foto kii" : "Uploaded a prescription photo"}: ${f.name}`,
    }]);
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", f, f.name);
      form.append("session_id", sessionIdRef.current);
      form.append("language", lang || "en");
      const r = await fetch(`${API}/api/v1/agent/prescription`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (d.is_prescription) {
        const lines = [];
        if (Array.isArray(d.medication_summary) && d.medication_summary.length) {
          lines.push("**" + (lang === "ma" ? "Jatiba min y'i fulalento:" : "Medicines I see:") + "**");
          lines.push(...d.medication_summary.map(s => "• " + s));
        }
        if (d.guidance) { lines.push(""); lines.push(d.guidance); }
        setMsgs(p => [...p, { role: "assistant", content: lines.join("\n") }]);
      } else {
        setMsgs(p => [...p, {
          role: "assistant",
          content: d.reason || (lang === "ma"
            ? "M'a je a ko rx foto le mu."
            : "That doesn't look like a prescription. Please upload a clear photo."),
        }]);
      }
    } catch {
      setErr("Could not read the photo.");
    } finally {
      setBusy(false);
    }
  };

  // ── Doctor sheet PDF ──────────────────────────────────────────────────────

  const downloadDoctorSheet = async () => {
    setDocBusy(true);
    setErr("");
    try {
      const g = await fetch(`${API}/api/v1/agent/document/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionIdRef.current,
          doc_type:   "consultation_summary",
          format:     "preview",
          language:   lang || "en",
          // Fallback messages — backend uses these when Redis session is
          // short (e.g. after abuse-defense terminated the session without
          // persisting the user-visible exchange to memory).
          messages:   (msgs || [])
            .filter((m) => m && m.content)
            .map((m) => ({ role: m.role || "user", content: m.content })),
        }),
      });
      if (!g.ok) throw new Error("generate failed");
      const url = `${API}/api/v1/agent/document/${encodeURIComponent(sessionIdRef.current)}/download/pdf?doc_type=consultation_summary&language=${encodeURIComponent(lang || "en")}`;
      window.open(url, "_blank", "noopener");
    } catch {
      setErr(lang === "ma"
        ? "PDF buka dinke. Diyaata AMINA koi kon fo."
        : "Could not prepare the doctor sheet. Please chat with AMINA first.");
    } finally {
      setDocBusy(false);
    }
  };

  // ── Chat transcript PDF ───────────────────────────────────────────────────

  const downloadChatTranscript = async () => {
    if (chatPdfBusy) return;
    setChatPdfBusy(true);
    setErr("");
    try {
      const r = await fetch(`${API}/api/v1/agent/chat/export-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id:   sessionIdRef.current,
          patient_name: patient?.name || "",
          language:     lang,
        }),
      });
      if (!r.ok) throw new Error("export failed");
      const blob = await r.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `amina_chat_${(sessionIdRef.current || "transcript").slice(0, 16)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch {
      setErr(lang === "ma"
        ? "PDF buka dinke. I si a koi kon fo."
        : "Could not export the chat. Please try again after chatting with AMINA.");
    } finally {
      setChatPdfBusy(false);
    }
  };

  // ── Clear conversation ────────────────────────────────────────────────────

  const clearChat = () => {
    setMsgs([{
      role: "assistant",
      content: lang === "ma"
        ? "A laarali. Mennu kontibali?"
        : "All cleared. What can I help you with?",
    }]);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9100,
        background: T.bg, color: T.text, fontFamily: FONT,
        display: "flex", flexDirection: "column",
      }}
      data-literacy-ignore
    >
      {/* Header */}
      <div
        style={{
          padding: "14px 18px",
          background: T.surface, borderBottom: `1px solid ${T.border}`,
          display: "flex", alignItems: "center", gap: 12,
          flexShrink: 0,
        }}
      >
        <IconButton onClick={onClose} aria="Back">
          {Ic.back}
        </IconButton>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".8px", color: T.muted, textTransform: "uppercase" }}>
            AMINA Care
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>
            {lang === "ma" ? "N ka fo" : "Talk to AMINA"}
          </div>
        </div>

        {/* Language pills */}
        <div style={{ display: "flex", background: T.bgSoft, borderRadius: 999, padding: 3, border: `1px solid ${T.border}` }}>
          {LANGS.map(l => (
            <button
              key={l.id}
              onClick={() => setLang(l.id)}
              data-literacy-ignore
              style={{
                padding: "6px 12px", borderRadius: 999, border: "none",
                background: lang === l.id ? T.accent : "transparent",
                color:      lang === l.id ? "#fff"    : T.muted,
                fontFamily: FONT, fontSize: 12, fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {l.label}
            </button>
          ))}
        </div>

        {/* Model picker */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setModelOpen(v => !v)}
            data-literacy-ignore
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 12px", borderRadius: 12,
              background: T.bgSoft, border: `1px solid ${T.border}`,
              color: T.text, fontFamily: FONT, fontSize: 12, fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: T.accent }} />
            {MODELS.find(m => m.id === model)?.label || model}
            <span style={{ color: T.subtle, fontSize: 10 }}>▾</span>
          </button>
          {modelOpen && (
            <div
              style={{
                position: "absolute", top: "100%", right: 0, marginTop: 6,
                background: T.surface2, border: `1px solid ${T.border}`,
                borderRadius: 12, minWidth: 200,
                boxShadow: "0 14px 40px rgba(0,0,0,.5)",
                zIndex: 10, overflow: "hidden",
              }}
            >
              {MODELS.map(m => (
                <button
                  key={m.id}
                  onClick={() => {
                    if (m.disabled) {
                      // Refuse to switch to disabled models (e.g. LoRA in maintenance)
                      // -- show the reason inline as an error, keep dropdown open
                      // briefly so the user can read it.
                      setErr(m.disabledReason || `${m.label} is currently disabled.`);
                      setTimeout(() => setErr(""), 4500);
                      setModelOpen(false);
                      return;
                    }
                    setModel(m.id); setModelOpen(false);
                  }}
                  data-literacy-ignore
                  disabled={!!m.disabled}
                  title={m.disabled ? m.disabledReason : undefined}
                  style={{
                    width: "100%", padding: "10px 14px",
                    background: model === m.id ? "rgba(129,140,248,.14)" : "transparent",
                    border: "none", color: m.disabled ? T.muted : T.text, textAlign: "left",
                    fontFamily: FONT, fontSize: 13,
                    cursor: m.disabled ? "not-allowed" : "pointer",
                    opacity: m.disabled ? 0.55 : 1,
                    display: "flex", flexDirection: "column", gap: 2,
                    borderBottom: `1px solid ${T.borderSoft}`,
                  }}
                >
                  <span style={{ fontWeight: 700 }}>{m.label}</span>
                  <span style={{ fontSize: 11, color: T.muted }}>{m.sub}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <IconButton onClick={clearChat} aria="Clear chat" title="Clear">
          {Ic.trash}
        </IconButton>
      </div>

      {/* Message list */}
      <div
        style={{
          flex: 1, overflowY: "auto",
          padding: "22px 18px 12px",
        }}
      >
        <div style={{ maxWidth: 780, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>
          {msgs.map((m, i) => {
            if (m.role === "sos_prompt") {
              return (
                <SosPromptCard
                  key={i}
                  reasonId={m.reasonId}
                  source={m.source}
                  onSend={() => {
                    if (onRequestEmergency) onRequestEmergency(m.reasonId);
                  }}
                  onDismiss={() => setMsgs(p => p.map((x, j) => j === i ? { ...x, _dismissed: true } : x))}
                  dismissed={!!m._dismissed}
                />
              );
            }
            return (
              <Bubble
                key={i}
                idx={i}
                msg={m}
                ttsPlaying={ttsPlayingId === i}
                onTTS={() => playTTS(i, m.content)}
                onCopy={() => { try { navigator.clipboard.writeText(m.content); } catch {} }}
                onTranslate={() => translateMsg(i)}
                onVote={(r) => sendFeedback(i, r)}
                onRegen={() => regenerate(i)}
              />
            );
          })}
          {busy && (
            <div
              style={{
                alignSelf: "flex-start", maxWidth: "78%",
                padding: "14px 18px", borderRadius: 18,
                background: T.surface, border: `1px solid ${T.border}`,
                color: T.muted, fontSize: 14, fontStyle: "italic",
                display: "flex", alignItems: "center", gap: 10,
              }}
            >
              <Dots />
              {lang === "ma" ? "AMINA i miirali…" : "AMINA is thinking…"}
            </div>
          )}
          {err && (
            <div
              style={{
                alignSelf: "center",
                padding: "10px 16px",
                background: "rgba(239,68,68,.14)",
                border: "1px solid rgba(239,68,68,.35)",
                color: "#fca5a5", borderRadius: 12, fontSize: 13, fontWeight: 600,
              }}
            >
              {err}
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      {/* Quick actions row */}
      <div
        style={{
          padding: "10px 18px 2px",
          display: "flex", gap: 8, flexWrap: "wrap",
          borderTop: `1px solid ${T.border}`,
          background: T.bgSoft,
        }}
      >
        <Chip onClick={() => setShowSymptom(true)} icon={Ic.list}>
          {lang === "ma" ? "Kuuran seedeyaa" : "Symptom form"}
        </Chip>
        <Chip onClick={() => setShowRx(true)} icon={Ic.pill}>
          {lang === "ma" ? "Jatiba seedeyaa" : "Prescription helper"}
        </Chip>
        <Chip onClick={() => fileInputRef.current?.click()} icon={Ic.upload}>
          {lang === "ma" ? "Rx foto kii" : "Upload Rx photo"}
        </Chip>
        <Chip onClick={downloadDoctorSheet} icon={Ic.pdf} busy={docBusy}>
          {docBusy ? "…" : (lang === "ma" ? "Doctor sheet PDF" : "Doctor sheet PDF")}
        </Chip>
        <Chip onClick={downloadChatTranscript} icon={Ic.pdf} busy={chatPdfBusy}>
          {chatPdfBusy ? "…" : (lang === "ma" ? "Kacaa PDF" : "Download chat (PDF)")}
        </Chip>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={onFilePicked}
        />
      </div>

      {/* Composer */}
      <div
        style={{
          padding: "12px 18px 18px",
          background: T.bgSoft,
          display: "flex", gap: 10, alignItems: "flex-end",
          borderTop: `1px solid ${T.borderSoft}`,
        }}
      >
        <button
          onClick={rec ? stopRec : startRec}
          disabled={busy && !rec}
          data-literacy-ignore
          aria-label={rec ? "Stop recording" : "Start recording"}
          style={{
            width: 54, height: 54, borderRadius: 16,
            background: rec ? T.red : T.surface,
            border: `1px solid ${rec ? T.red : T.border}`,
            color: rec ? "#fff" : T.accent,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", flexShrink: 0,
            boxShadow: rec ? "0 0 0 4px rgba(239,68,68,.25)" : "none",
            transition: "all .15s ease",
          }}
        >
          {rec ? Ic.stop : Ic.mic}
        </button>

        <div style={{ flex: 1, position: "relative" }}>
          {rec ? (
            <div
              style={{
                minHeight: 54, padding: "18px 18px",
                background: T.surface, border: `1px solid ${T.red}`,
                borderRadius: 16, display: "flex", alignItems: "center", gap: 12,
                color: T.red, fontWeight: 700, fontSize: 14,
              }}
            >
              <span style={{
                display: "inline-block", width: 10, height: 10, borderRadius: "50%",
                background: T.red, animation: "pulse 1s infinite",
              }} />
              {lang === "ma" ? "N ka a moyi…" : "Listening…"} {recSec > 0 && `(${recSec}s)`}
            </div>
          ) : (
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={lang === "ma" ? "I la ñininkali sebe…" : "Type your question…"}
              disabled={busy}
              rows={1}
              data-literacy-ignore
              style={{
                width: "100%", minHeight: 54, maxHeight: 160,
                padding: "16px 18px",
                background: T.surface, color: T.text,
                border: `1px solid ${T.border}`, borderRadius: 16,
                fontFamily: FONT, fontSize: 16, lineHeight: 1.4,
                resize: "none", outline: "none",
              }}
              onFocus={e => e.currentTarget.style.borderColor = T.accent}
              onBlur={e  => e.currentTarget.style.borderColor = T.border}
            />
          )}
        </div>

        <button
          onClick={handleSend}
          disabled={busy || !input.trim() || rec}
          data-literacy-ignore
          aria-label="Send"
          style={{
            width: 54, height: 54, borderRadius: 16,
            background: (!input.trim() || busy || rec) ? T.subtle : T.user,
            border: "none", color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: (!input.trim() || busy || rec) ? "default" : "pointer",
            boxShadow: (!input.trim() || busy || rec) ? "none" : "0 8px 22px rgba(99,102,241,.45)",
            flexShrink: 0,
          }}
        >
          {Ic.send}
        </button>
      </div>

      {/* Modals */}
      {showSymptom && (
        <SymptomForm
          lang={lang}
          onClose={() => setShowSymptom(false)}
          onSubmit={(text) => { setShowSymptom(false); sendText(text); }}
        />
      )}
      {showRx && (
        <RxForm
          lang={lang}
          onClose={() => setShowRx(false)}
          onSubmit={(text) => { setShowRx(false); sendText(text); }}
        />
      )}

      <style>{`
        @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .4 } }
        @keyframes bounce { 0%,80%,100% { transform: translateY(0); opacity: .5 } 40% { transform: translateY(-6px); opacity: 1 } }
      `}</style>
    </div>
  );
}


// ── SOS prompt card (inline, injected by detection logic in sendText) ──────

const SOS_REASON_LABELS = {
  chest_pain: { label: "Chest pain",               emoji: "💔" },
  breathing:  { label: "Trouble breathing",        emoji: "🫁" },
  stroke:     { label: "Possible stroke signs",    emoji: "🧠" },
  bleeding:   { label: "Heavy bleeding",           emoji: "🩸" },
  fainted:    { label: "Unconscious / fainted",    emoji: "😵" },
  other:      { label: "An urgent problem",        emoji: "🚨" },
};

function SosPromptCard({ reasonId, source, onSend, onDismiss, dismissed }) {
  const meta = SOS_REASON_LABELS[reasonId] || SOS_REASON_LABELS.other;
  const title = source === "explicit"
    ? "Send an emergency alert now?"
    : "I'm detecting a possible emergency";
  const body = source === "explicit"
    ? `I can alert your caregivers right now with the reason "${meta.label.toLowerCase()}". Confirm below if you want me to send it.`
    : `Based on what you told me, this sounds serious. Would you like me to alert your caregivers with the reason "${meta.label.toLowerCase()}"?`;

  if (dismissed) {
    return (
      <div
        style={{
          alignSelf: "stretch",
          padding: "10px 14px",
          background: "rgba(255,255,255,.03)",
          border: `1px dashed ${T.border}`,
          borderRadius: 12,
          color: T.muted,
          fontSize: 12, fontWeight: 600,
          textAlign: "center",
        }}
      >
        Emergency alert dismissed
      </div>
    );
  }

  return (
    <div
      style={{
        alignSelf: "stretch",
        padding: "18px 20px",
        background:
          `linear-gradient(135deg, rgba(239,68,68,.12), rgba(239,68,68,.02)),` +
          T.surface,
        border: `1px solid rgba(239,68,68,.38)`,
        borderRadius: 16,
        display: "flex", flexDirection: "column", gap: 14,
        boxShadow: "0 12px 32px rgba(239,68,68,.18)",
      }}
      data-literacy-ignore
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            width: 44, height: 44, borderRadius: 12,
            background: "rgba(239,68,68,.14)",
            border: "1px solid rgba(239,68,68,.38)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 24,
            flexShrink: 0,
          }}
          aria-hidden="true"
        >
          {meta.emoji}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 10, fontWeight: 800, letterSpacing: "1.4px",
              textTransform: "uppercase", color: "#fca5a5", marginBottom: 4,
            }}
          >
            AMINA · Emergency assist
          </div>
          <div style={{ fontSize: 15, fontWeight: 800, color: T.text, lineHeight: 1.25 }}>
            {title}
          </div>
        </div>
      </div>

      <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.55 }}>
        {body}
      </div>

      <div
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "10px 12px",
          background: "rgba(239,68,68,.08)",
          border: "1px solid rgba(239,68,68,.24)",
          borderRadius: 10,
          fontSize: 12, fontWeight: 700, color: "#fca5a5",
        }}
      >
        <span>Reason:</span>
        <span style={{ color: T.text }}>{meta.emoji} {meta.label}</span>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          onClick={onSend}
          data-literacy-ignore
          style={{
            all: "unset",
            cursor: "pointer",
            flex: "1 1 200px",
            padding: "13px 18px",
            textAlign: "center",
            borderRadius: 12,
            background: "linear-gradient(135deg,#dc2626,#ef4444)",
            color: "#fff",
            fontSize: 13, fontWeight: 800,
            letterSpacing: ".3px",
            boxShadow: "0 14px 32px rgba(220,38,38,.4)",
            fontFamily: FONT,
          }}
        >
          Send Emergency Alert
        </button>
        <button
          onClick={onDismiss}
          data-literacy-ignore
          style={{
            all: "unset",
            cursor: "pointer",
            padding: "13px 18px",
            textAlign: "center",
            borderRadius: 12,
            border: `1px solid ${T.border}`,
            color: T.muted,
            fontSize: 12, fontWeight: 700,
            fontFamily: FONT,
          }}
        >
          Not now
        </button>
      </div>
    </div>
  );
}


// ── Message bubble ──────────────────────────────────────────────────────────

function Bubble({ idx, msg, ttsPlaying, onTTS, onCopy, onTranslate, onVote, onRegen }) {
  const isUser = msg.role === "user";
  return (
    <div
      style={{
        alignSelf: isUser ? "flex-end" : "flex-start",
        maxWidth: "82%",
        display: "flex", flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        gap: 6,
      }}
    >
      <div
        style={{
          padding: "14px 18px",
          borderRadius: 20,
          borderTopRightRadius: isUser ? 6 : 20,
          borderTopLeftRadius:  isUser ? 20 : 6,
          background: isUser ? T.user : T.surface,
          color:      isUser ? "#fff" : T.text,
          border:     isUser ? "none" : `1px solid ${T.border}`,
          fontSize:   15, lineHeight: 1.55,
          whiteSpace: "pre-wrap", wordBreak: "break-word",
          boxShadow:  isUser ? "0 6px 18px rgba(99,102,241,.35)" : "0 2px 10px rgba(0,0,0,.25)",
        }}
      >
        {msg.is_emergency && (
          <div
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "3px 10px", borderRadius: 999,
              background: "rgba(239,68,68,.15)", color: "#fca5a5",
              fontSize: 11, fontWeight: 800, marginBottom: 8,
              border: "1px solid rgba(239,68,68,.35)",
            }}
          >
            ⚠ EMERGENCY
          </div>
        )}
        {msg.content}

        {/* Sources */}
        {!isUser && Array.isArray(msg.sources) && msg.sources.length > 0 && (
          <div
            style={{
              marginTop: 12, paddingTop: 10,
              borderTop: `1px solid ${T.border}`,
              display: "flex", flexDirection: "column", gap: 6,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 800, color: T.muted, textTransform: "uppercase", letterSpacing: ".6px" }}>
              Sources
            </div>
            {msg.sources.map((s, i) => (
              <a
                key={i}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  color: T.accent, fontSize: 12, fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                {Ic.link}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.org ? `[${s.org}] ` : ""}{s.title || s.url}
                </span>
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Per-bubble action row */}
      {!isUser && (
        <div style={{ display: "flex", gap: 4, alignItems: "center", padding: "0 4px" }}>
          <MiniBtn onClick={onTTS} active={ttsPlaying} title="Listen">{Ic.speaker}</MiniBtn>
          <MiniBtn onClick={onCopy} title="Copy">{Ic.copy}</MiniBtn>
          <MiniBtn onClick={onTranslate} title="Translate">{Ic.translate}</MiniBtn>
          <MiniBtn onClick={() => onVote(1)}  active={msg._vote === 1}  title="Helpful">{Ic.up}</MiniBtn>
          <MiniBtn onClick={() => onVote(-1)} active={msg._vote === -1} title="Not helpful">{Ic.down}</MiniBtn>
          <MiniBtn onClick={onRegen} title="Regenerate">{Ic.regen}</MiniBtn>
        </div>
      )}
    </div>
  );
}

function MiniBtn({ children, onClick, active, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      data-literacy-ignore
      style={{
        background: active ? "rgba(129,140,248,.18)" : "transparent",
        border: `1px solid ${active ? T.accent : "transparent"}`,
        color: active ? T.accent : T.subtle,
        width: 30, height: 30, borderRadius: 8,
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", transition: "all .12s ease",
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.color = T.text; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.color = T.subtle; }}
    >
      {children}
    </button>
  );
}


// ── Small helpers ───────────────────────────────────────────────────────────

function IconButton({ children, onClick, aria, title }) {
  return (
    <button
      onClick={onClick}
      aria-label={aria}
      title={title || aria}
      data-literacy-ignore
      style={{
        background: T.bgSoft, border: `1px solid ${T.border}`,
        color: T.text, width: 40, height: 40, borderRadius: 12,
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

function Chip({ children, onClick, icon, busy }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      data-literacy-ignore
      style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        padding: "9px 14px", borderRadius: 999,
        background: T.surface, color: T.text,
        border: `1px solid ${T.border}`,
        fontFamily: FONT, fontSize: 13, fontWeight: 600,
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.6 : 1,
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = T.accent}
      onMouseLeave={e => e.currentTarget.style.borderColor = T.border}
    >
      <span style={{ color: T.accent, display: "flex" }}>{icon}</span>
      {children}
    </button>
  );
}

function Dots() {
  return (
    <span style={{ display: "inline-flex", gap: 4 }}>
      {[0, 1, 2].map(i => (
        <span
          key={i}
          style={{
            width: 6, height: 6, borderRadius: "50%", background: T.accent,
            animation: `bounce 1.2s infinite`, animationDelay: `${i * 0.16}s`,
          }}
        />
      ))}
    </span>
  );
}


// ── Symptom form modal ─────────────────────────────────────────────────────

function SymptomForm({ lang, onClose, onSubmit }) {
  const [f, setF] = useState({
    main: "", location: "", duration: "", severity: "5",
    onset: "", triggers: "", relief: "", associated: "", tried: "",
  });
  const up = (k, v) => setF(prev => ({ ...prev, [k]: v }));

  const submit = () => {
    if (!f.main.trim()) return;
    const text = `I have ${f.main}, located at ${f.location || "—"}, for ${f.duration || "—"}, severity ${f.severity}/10, started when ${f.onset || "—"}, worse when ${f.triggers || "—"}, better when ${f.relief || "—"}, also feeling ${f.associated || "—"}, I have tried ${f.tried || "—"}. Please assess this and tell me what to do.`;
    onSubmit(text);
  };

  return (
    <FormModal title={lang === "ma" ? "Kuuran seedeyaa" : "Symptom Details"} onClose={onClose} onSubmit={submit} canSubmit={!!f.main.trim()}>
      <Field label="Main symptom *" value={f.main} onChange={v => up("main", v)} placeholder="e.g., headache" />
      <Field label="Where on your body" value={f.location} onChange={v => up("location", v)} placeholder="e.g., forehead" />
      <Field label="How long" value={f.duration} onChange={v => up("duration", v)} placeholder="e.g., 2 days" />
      <Field label="Severity (1–10)" value={f.severity} onChange={v => up("severity", v)} placeholder="5" />
      <Field label="When did it start" value={f.onset} onChange={v => up("onset", v)} />
      <Field label="What makes it worse" value={f.triggers} onChange={v => up("triggers", v)} />
      <Field label="What makes it better" value={f.relief} onChange={v => up("relief", v)} />
      <Field label="Other symptoms" value={f.associated} onChange={v => up("associated", v)} />
      <Field label="What you have tried" value={f.tried} onChange={v => up("tried", v)} />
    </FormModal>
  );
}

function RxForm({ lang, onClose, onSubmit }) {
  const [f, setF] = useState({ name: "", dosage: "", frequency: "", duration: "", notes: "" });
  const up = (k, v) => setF(prev => ({ ...prev, [k]: v }));

  const submit = () => {
    if (!f.name.trim()) return;
    const text = `I was prescribed ${f.name} ${f.dosage || ""} ${f.frequency || ""} for ${f.duration || "—"} (${f.notes || "no notes"}). Please tell me how to take it safely and any warnings I should know.`;
    onSubmit(text);
  };

  return (
    <FormModal title={lang === "ma" ? "Jatiba seedeyaa" : "Prescription Details"} onClose={onClose} onSubmit={submit} canSubmit={!!f.name.trim()}>
      <Field label="Medicine name *" value={f.name} onChange={v => up("name", v)} placeholder="e.g., Amoxicillin" />
      <Field label="Dosage" value={f.dosage} onChange={v => up("dosage", v)} placeholder="e.g., 500 mg" />
      <Field label="How often" value={f.frequency} onChange={v => up("frequency", v)} placeholder="e.g., 3 times a day" />
      <Field label="For how long" value={f.duration} onChange={v => up("duration", v)} placeholder="e.g., 7 days" />
      <Field label="Notes" value={f.notes} onChange={v => up("notes", v)} placeholder="e.g., take with food" />
    </FormModal>
  );
}

function FormModal({ title, children, onClose, onSubmit, canSubmit }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9200,
        background: "rgba(0,0,0,.72)", backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
      }}
      role="dialog" aria-modal="true"
      data-literacy-ignore
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: T.surface, color: T.text,
          border: `1px solid ${T.border}`, borderRadius: 20,
          width: "100%", maxWidth: 520, maxHeight: "92vh",
          display: "flex", flexDirection: "column",
          boxShadow: "0 24px 72px rgba(0,0,0,.6)",
          fontFamily: FONT,
        }}
      >
        <div
          style={{
            padding: "18px 22px",
            borderBottom: `1px solid ${T.border}`,
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}
        >
          <div style={{ fontSize: 17, fontWeight: 800 }}>{title}</div>
          <IconButton onClick={onClose} aria="Close">{Ic.close}</IconButton>
        </div>
        <div style={{ padding: "18px 22px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
          {children}
        </div>
        <div style={{ padding: "14px 22px 18px", borderTop: `1px solid ${T.border}`, display: "flex", gap: 10 }}>
          <button
            onClick={onClose}
            data-literacy-ignore
            style={{
              flex: 1, padding: "12px 16px", borderRadius: 12,
              background: "transparent", color: T.muted,
              border: `1px solid ${T.border}`,
              fontFamily: FONT, fontSize: 14, fontWeight: 700, cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={!canSubmit}
            data-literacy-ignore
            style={{
              flex: 1.4, padding: "12px 16px", borderRadius: 12,
              background: canSubmit ? T.user : T.subtle,
              color: "#fff", border: "none",
              fontFamily: FONT, fontSize: 14, fontWeight: 800,
              cursor: canSubmit ? "pointer" : "default",
              boxShadow: canSubmit ? "0 6px 18px rgba(99,102,241,.4)" : "none",
            }}
          >
            Ask AMINA
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: ".5px" }}>
        {label}
      </span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || ""}
        data-literacy-ignore
        style={{
          padding: "11px 14px",
          background: T.bgSoft, color: T.text,
          border: `1px solid ${T.border}`, borderRadius: 10,
          fontFamily: FONT, fontSize: 14, outline: "none",
        }}
        onFocus={e => e.currentTarget.style.borderColor = T.accent}
        onBlur={e  => e.currentTarget.style.borderColor = T.border}
      />
    </label>
  );
}
