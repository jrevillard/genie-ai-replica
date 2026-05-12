import { useEffect, useRef, useState, useCallback, useMemo } from "react";
// import AuthScreen from "./AuthScreen"; // OLD login — disabled, using router LoginPage instead
import PatientSidebar from "./PatientSidebar";
import AdminDashboard from "./AdminDashboard";
import CaregiverPortal from "./CaregiverPortal";
import CaregiverDirectory from "./CaregiverDirectory";
import PrivacyPanel from "./PrivacyPanel";
import { toNko } from "./utils/nkoTransliterate";
import { getThreads, getThread, getActiveThreadId, setActiveThreadId, saveThread, deleteThread } from "./utils/conversationStore";
import { useStickToBottom } from "./utils/stickToBottom.js";

// Professional smooth waveform avatar
function AvatarPlaceholder({ size = 170, isSpeaking = false, audioAnalyser = null }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const dataRef = useRef(null);
  const waveRef = useRef(new Array(60).fill(0));
  const logoOpacity = useRef(1);
  const speakingState = useRef(false);
  const lastAudioTime = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const cn = size / 2;
    const radius = size * 0.45;

    if (audioAnalyser) {
      dataRef.current = new Uint8Array(audioAnalyser.frequencyBinCount);
    }

    const draw = (timestamp) => {
      ctx.clearRect(0, 0, size, size);

      // Get audio level
      let level = 0;
      if (audioAnalyser && dataRef.current) {
        audioAnalyser.getByteFrequencyData(dataRef.current);
        const data = dataRef.current;
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        level = sum / data.length / 255;
      }

      // Track speaking state
      const hasAudio = isSpeaking && level > 0.01;
      if (hasAudio) {
        lastAudioTime.current = timestamp;
        speakingState.current = true;
      } else if (timestamp - lastAudioTime.current > 400) {
        speakingState.current = false;
      }

      // Logo opacity
      const targetOpacity = speakingState.current ? 0 : 1;
      logoOpacity.current += (targetOpacity - logoOpacity.current) * 0.1;

      // Generate smooth wave points
      const numPoints = 60;
      const effectiveLevel = speakingState.current ? Math.max(level, 0.35) : 0;
      
      for (let i = 0; i < numPoints; i++) {
        const centerDist = Math.abs(i - numPoints / 2) / (numPoints / 2);
        const envelope = Math.pow(1 - centerDist, 1.2);
        
        if (speakingState.current) {
          const t = timestamp / 90;
          const wave1 = Math.sin(t + i * 0.35);
          const wave2 = Math.sin(t * 1.4 + i * 0.2);
          const wave3 = Math.sin(t * 0.6 + i * 0.5);
          const combined = (wave1 * 0.45 + wave2 * 0.35 + wave3 * 0.2);
          const target = effectiveLevel * envelope * (0.4 + Math.abs(combined) * 0.6);
          waveRef.current[i] += (target - waveRef.current[i]) * 0.18;
        } else {
          waveRef.current[i] *= 0.88;
        }
      }

      // === MAIN CIRCLE ===
      const mainGrad = ctx.createRadialGradient(cn - radius * 0.2, cn - radius * 0.3, 0, cn, cn, radius);
      mainGrad.addColorStop(0, "#ff2d95");
      mainGrad.addColorStop(0.4, "#e020ff");
      mainGrad.addColorStop(0.75, "#9d2fff");
      mainGrad.addColorStop(1, "#7c3aed");
      
      ctx.beginPath();
      ctx.arc(cn, cn, radius, 0, Math.PI * 2);
      ctx.fillStyle = mainGrad;
      ctx.fill();

      // Clip for inner content
      ctx.save();
      ctx.beginPath();
      ctx.arc(cn, cn, radius - 1, 0, Math.PI * 2);
      ctx.clip();

      // === SMOOTH WAVEFORM ===
      const waveActive = waveRef.current.some(v => v > 0.01);
      
      if (waveActive) {
        const totalWidth = radius * 1.85;
        const startX = cn - totalWidth / 2;
        const maxHeight = radius * 0.75;

        // Create gradient for the waveform fill
        const waveGradTop = ctx.createLinearGradient(0, cn - maxHeight, 0, cn);
        waveGradTop.addColorStop(0, "rgba(255, 50, 220, 0.95)");
        waveGradTop.addColorStop(0.3, "rgba(255, 80, 150, 0.9)");
        waveGradTop.addColorStop(0.6, "rgba(255, 150, 50, 0.85)");
        waveGradTop.addColorStop(1, "rgba(255, 220, 50, 0.8)");

        const waveGradBottom = ctx.createLinearGradient(0, cn, 0, cn + maxHeight);
        waveGradBottom.addColorStop(0, "rgba(255, 220, 50, 0.8)");
        waveGradBottom.addColorStop(0.4, "rgba(255, 150, 50, 0.85)");
        waveGradBottom.addColorStop(0.7, "rgba(255, 80, 150, 0.9)");
        waveGradBottom.addColorStop(1, "rgba(255, 50, 220, 0.95)");

        // Draw top wave (smooth curve)
        ctx.beginPath();
        ctx.moveTo(startX, cn);
        
        for (let i = 0; i < numPoints; i++) {
          const x = startX + (i / (numPoints - 1)) * totalWidth;
          const height = waveRef.current[i] * maxHeight;
          const y = cn - height;
          
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            // Smooth curve using quadratic bezier
            const prevX = startX + ((i - 1) / (numPoints - 1)) * totalWidth;
            const prevHeight = waveRef.current[i - 1] * maxHeight;
            const prevY = cn - prevHeight;
            const cpX = (prevX + x) / 2;
            ctx.quadraticCurveTo(prevX, prevY, cpX, (prevY + y) / 2);
          }
        }
        // Close the path back to center line
        ctx.lineTo(startX + totalWidth, cn);
        ctx.lineTo(startX, cn);
        ctx.closePath();
        
        // Glow effect
        ctx.shadowColor = "rgba(255, 100, 150, 0.8)";
        ctx.shadowBlur = 15;
        ctx.fillStyle = waveGradTop;
        ctx.fill();

        // Draw bottom wave (mirrored)
        ctx.beginPath();
        ctx.moveTo(startX, cn);
        
        for (let i = 0; i < numPoints; i++) {
          const x = startX + (i / (numPoints - 1)) * totalWidth;
          const height = waveRef.current[i] * maxHeight;
          const y = cn + height;
          
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            const prevX = startX + ((i - 1) / (numPoints - 1)) * totalWidth;
            const prevHeight = waveRef.current[i - 1] * maxHeight;
            const prevY = cn + prevHeight;
            const cpX = (prevX + x) / 2;
            ctx.quadraticCurveTo(prevX, prevY, cpX, (prevY + y) / 2);
          }
        }
        ctx.lineTo(startX + totalWidth, cn);
        ctx.lineTo(startX, cn);
        ctx.closePath();
        
        ctx.fillStyle = waveGradBottom;
        ctx.fill();

        // Draw edge lines for definition
        ctx.shadowBlur = 8;
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        // Top edge line
        ctx.beginPath();
        for (let i = 0; i < numPoints; i++) {
          const x = startX + (i / (numPoints - 1)) * totalWidth;
          const height = waveRef.current[i] * maxHeight;
          const y = cn - height;
          if (i === 0) ctx.moveTo(x, y);
          else {
            const prevX = startX + ((i - 1) / (numPoints - 1)) * totalWidth;
            const prevY = cn - waveRef.current[i - 1] * maxHeight;
            const cpX = (prevX + x) / 2;
            ctx.quadraticCurveTo(prevX, prevY, cpX, (prevY + y) / 2);
          }
        }
        const edgeGradTop = ctx.createLinearGradient(0, cn - maxHeight, 0, cn);
        edgeGradTop.addColorStop(0, "rgba(255, 100, 255, 1)");
        edgeGradTop.addColorStop(1, "rgba(255, 200, 100, 1)");
        ctx.strokeStyle = edgeGradTop;
        ctx.stroke();

        // Bottom edge line
        ctx.beginPath();
        for (let i = 0; i < numPoints; i++) {
          const x = startX + (i / (numPoints - 1)) * totalWidth;
          const height = waveRef.current[i] * maxHeight;
          const y = cn + height;
          if (i === 0) ctx.moveTo(x, y);
          else {
            const prevX = startX + ((i - 1) / (numPoints - 1)) * totalWidth;
            const prevY = cn + waveRef.current[i - 1] * maxHeight;
            const cpX = (prevX + x) / 2;
            ctx.quadraticCurveTo(prevX, prevY, cpX, (prevY + y) / 2);
          }
        }
        const edgeGradBottom = ctx.createLinearGradient(0, cn, 0, cn + maxHeight);
        edgeGradBottom.addColorStop(0, "rgba(255, 200, 100, 1)");
        edgeGradBottom.addColorStop(1, "rgba(255, 100, 255, 1)");
        ctx.strokeStyle = edgeGradBottom;
        ctx.stroke();

        ctx.shadowBlur = 0;

        // Center line - cyan glow
        ctx.beginPath();
        ctx.moveTo(cn - radius * 0.9, cn);
        ctx.lineTo(cn + radius * 0.9, cn);
        const lineGrad = ctx.createLinearGradient(cn - radius * 0.9, cn, cn + radius * 0.9, cn);
        lineGrad.addColorStop(0, "rgba(0, 200, 255, 0)");
        lineGrad.addColorStop(0.1, "rgba(0, 230, 255, 0.9)");
        lineGrad.addColorStop(0.5, "rgba(100, 255, 255, 1)");
        lineGrad.addColorStop(0.9, "rgba(0, 230, 255, 0.9)");
        lineGrad.addColorStop(1, "rgba(0, 200, 255, 0)");
        ctx.strokeStyle = lineGrad;
        ctx.lineWidth = 2.5;
        ctx.shadowColor = "rgba(0, 220, 255, 1)";
        ctx.shadowBlur = 12;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // === LOGO ===
      if (logoOpacity.current > 0.01) {
        ctx.globalAlpha = logoOpacity.current;
        ctx.fillStyle = "#fff";
        ctx.font = `700 ${radius * 0.85}px "Outfit", system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(255, 255, 255, 0.6)";
        ctx.shadowBlur = 15;
        ctx.fillText("A", cn, cn);
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }

      ctx.restore();

      // Top highlight
      const hl = ctx.createRadialGradient(cn - radius * 0.3, cn - radius * 0.4, 0, cn, cn, radius);
      hl.addColorStop(0, "rgba(255, 255, 255, 0.15)");
      hl.addColorStop(0.4, "rgba(255, 255, 255, 0.03)");
      hl.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.beginPath();
      ctx.arc(cn, cn, radius, 0, Math.PI * 2);
      ctx.fillStyle = hl;
      ctx.fill();

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [size, isSpeaking, audioAnalyser]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size, borderRadius: "50%" }}
    />
  );
}

// Utility functions
function pickMimeType() {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"];
  for (const t of types) if (window.MediaRecorder?.isTypeSupported?.(t)) return t;
  return "";
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
const timeNow = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// ── Reminder helpers ─────────────────────────────────────────────
const REMINDERS_KEY = "AMINA_FOLLOWUPS";

function loadReminders() {
  try {
    const raw = localStorage.getItem(REMINDERS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    // Drop reminders whose date has already passed (older than 2 hours)
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    return arr.filter((r) => new Date(r.when).getTime() > cutoff);
  } catch {
    return [];
  }
}

function saveReminder(whenStr, note) {
  const current = loadReminders();
  // Dedup by date+note
  if (current.some((r) => r.when === whenStr && r.note === note)) return current;
  const next = [...current, { when: whenStr, note, created: new Date().toISOString() }];
  next.sort((a, b) => new Date(a.when) - new Date(b.when));
  localStorage.setItem(REMINDERS_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("amina-reminders-changed"));
  return next;
}

function removeReminder(whenStr, note) {
  const next = loadReminders().filter((r) => !(r.when === whenStr && r.note === note));
  localStorage.setItem(REMINDERS_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("amina-reminders-changed"));
  return next;
}

function buildICS(whenStr, note) {
  // whenStr format: "YYYY-MM-DD HH:MM"
  const dt = new Date(whenStr.replace(" ", "T"));
  if (isNaN(dt.getTime())) return null;
  const fmt = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const end = new Date(dt.getTime() + 30 * 60 * 1000);
  const uid = `amina-${dt.getTime()}@amina.health`;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Amina//Follow-up//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(dt)}`,
    `DTEND:${fmt(end)}`,
    "SUMMARY:Amina — Health follow-up",
    `DESCRIPTION:${note || "Check in with Amina about your health."}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

function downloadICS(whenStr, note) {
  const ics = buildICS(whenStr, note);
  if (!ics) return;
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `amina-followup-${whenStr.replace(/[^\d]/g, "")}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatFollowupDisplay(whenStr) {
  // "2026-04-08 09:00" → "Mon, Apr 8 · 09:00"
  try {
    const dt = new Date(whenStr.replace(" ", "T"));
    if (isNaN(dt.getTime())) return whenStr;
    const day = dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    const time = dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return `${day} · ${time}`;
  } catch {
    return whenStr;
  }
}

const VAD_THR = 0.04, VAD_DUR = 1800, VAD_MIN = 800;

const INTRO = "Isama jang! I be di? I'm Amina — your trusted health companion.";
const WELCOME = "I help with diabetes, blood pressure, heart health, medications, and diet — with advice that fits your life here in The Gambia. What can I help you with today?";

// ── UI string keys for translation ──
const UI_STRINGS_EN = {
  intro: INTRO,
  welcome: WELCOME,
  listen_intro: "Listen to introduction",
  or_topic: "or choose a topic",
  press_space: "Or press Space to start talking",
  home: "Home",
  plan: "Plan",
  my_care_plan: "My Care Plan",
  view_plan: "View your personalised plan",
  generating: "Generating…",
  plan_help: "Amina builds it from our chat",
  setup_notifications: "Setup Notifications",
  notifications: "Notifications",
  manage_channels: "Tap to manage channels",
  channels_list: "WhatsApp, Telegram, SMS, Email",
  upload_rx: "Upload Rx",
  rx: "Rx",
  symptom: "Symptom",
  send: "Send",
  type_msg: "Type your message or ask about your medication...",
  todays_swap: "SWAP",
  upcoming_checkins: "Upcoming check-ins",
  anonymous: "Anonymous",
  online: "Online",
  listening: "Listening...",
  thinking: "Thinking...",
  speaking: "Speaking...",
  ready: "Ready",
  language_en: "English",
  language_ma: "Mandinka",
  bilingual_mode: "Show both languages",
  open_symptom_form: "Open Symptom Form",
  enter_rx_details: "Enter Rx Details",
  upload_photo: "Upload Photo",
  symptom_hint: "Sounds like a symptom — want to fill a quick form so Amina can assess better?",
  open_form: "Open form",
};

const TAGS = [
  { label: "🩺 Diabetes", prompt: "I have diabetes. What should I watch out for and how can I manage my blood sugar?" },
  { label: "❤️ Blood Pressure", prompt: "I have high blood pressure. What lifestyle changes and foods can help?" },
  { label: "💊 Medications", prompt: "Can you help me understand my medications and when to take them?" },
  { label: "🥗 Diet & Nutrition", prompt: "What local foods are good for managing my condition? I eat a lot of benachin and domoda." },
  { label: "📋 My Care Plan", prompt: "Can you create a care plan for me based on my health conditions?" },
  { label: "🏥 Find Facility", prompt: "Where is the nearest health facility I can visit for a check-up?" },
];

function genSessionId() { return "s_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8); }

// ── Session cookie helpers ──
function readCookie(name) {
  const m = document.cookie.match("(^|;)\\s*" + name + "\\s*=\\s*([^;]+)");
  return m ? decodeURIComponent(m.pop()) : null;
}
function initialSessionId() {
  // Prefer cookie (set by backend) → localStorage fallback → new
  const fromCookie = readCookie("amina_session");
  if (fromCookie) return fromCookie;
  const fromStorage = localStorage.getItem("AMINA_SID");
  if (fromStorage) return fromStorage;
  return genSessionId();
}

let audioOK = false;

async function ttsPlay(base, text, lang, onStart, onEnd, sourceLang) {
  try {
    const r = await fetch(`${base.replace(/\/+$/, "")}/api/v1/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `lang` selects the synth engine on the backend:
      //   "en" → Piper (voice-tts)
      //   "ma" → MMS   (voice-tts-mnk)  with EN→MA translation first
      //
      // `source_lang` tells the backend what language the `text` is
      // ALREADY in. Critical for the case where Amina replied in
      // Mandinka (source_lang="ma") and the user clicks speaker while
      // still in Mandinka mode — without this hint, _ensure_mandinka
      // would re-translate already-Mandinka text through an EN→MA LLM
      // pass and produce mangled synthesis output.
      body: JSON.stringify({
        text,
        lang:        lang || "en",
        source_lang: sourceLang || "en",
      }),
    });
    if (!r.ok) { onEnd?.(); return null; }

    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const au = new Audio(url);
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const src = ac.createMediaElementSource(au);
    const an = ac.createAnalyser();
    an.fftSize = 256;
    an.smoothingTimeConstant = 0.8;
    src.connect(an);
    an.connect(ac.destination);

    au.onended = () => { URL.revokeObjectURL(url); ac.close(); onEnd?.(); };
    au.onerror = () => { URL.revokeObjectURL(url); ac.close(); onEnd?.(); };

    onStart?.(an);
    await au.play();
    return au;
  } catch { onEnd?.(); return null; }
}

function Spk({ text, base, auto, onSS, onSE, label, lang, sourceLang }) {
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const audioRef = useRef(null);
  const didAuto = useRef(false);

  async function play() {
    audioOK = true;
    if (playing && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setPlaying(false);
      onSE?.();
      return;
    }

    setLoading(true);
    const au = await ttsPlay(base, text, lang,
      (an) => { setLoading(false); setPlaying(true); onSS?.(an); },
      () => { setPlaying(false); onSE?.(); },
      sourceLang,
    );
    if (au) audioRef.current = au;
    else setLoading(false);
  }

  useEffect(() => {
    if (auto && audioOK && !didAuto.current) {
      didAuto.current = true;
      setTimeout(play, 500);
    }
  }, [auto]);

  useEffect(() => () => { if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; } }, []);

  return (
    <button onClick={play} className={`spk ${playing ? "spk-on" : ""}`}>
      {loading ? <div className="spk-spin" /> : playing ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" /><path d="M15.54 8.46a5 5 0 010 7.07" /></svg>
      )}
      {label && <span className="spk-label">{label}</span>}
    </button>
  );
}

function MicRing({ analyser, on }) {
  const ref = useRef(null);
  const raf = useRef(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    const sz = c.width, cn = sz / 2, ir = 26, mh = 14, n = 32;
    let da = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;

    const draw = () => {
      ctx.clearRect(0, 0, sz, sz);
      if (on) {
        const g = ctx.createRadialGradient(cn, cn, ir - 2, cn, cn, ir + mh + 6);
        g.addColorStop(0, "rgba(99,102,241,0.15)");
        g.addColorStop(1, "rgba(99,102,241,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cn, cn, ir + mh + 6, 0, Math.PI * 2);
        ctx.fill();
      }
      if (analyser && on && da) analyser.getByteFrequencyData(da);

      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        let h = 2;
        if (analyser && on && da) h = clamp((da[Math.floor((i / n) * da.length)] / 255) * mh, 2, mh);
        ctx.beginPath();
        ctx.moveTo(cn + Math.cos(a) * ir, cn + Math.sin(a) * ir);
        ctx.lineTo(cn + Math.cos(a) * (ir + h), cn + Math.sin(a) * (ir + h));
        ctx.strokeStyle = on ? `rgba(99,102,241,${0.4 + (h / mh) * 0.6})` : "rgba(148,163,184,0.08)";
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.stroke();
      }
      raf.current = requestAnimationFrame(draw);
    };
    draw();
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [analyser, on]);

  return <canvas ref={ref} width={88} height={88} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />;
}

function TypeWriter({ text, speed = 18, onDone }) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  const idx = useRef(0);
  const raf = useRef(null);
  const last = useRef(0);

  useEffect(() => {
    idx.current = 0;
    setDisplayed("");
    setDone(false);
    last.current = performance.now();

    const step = (now) => {
      const elapsed = now - last.current;
      if (elapsed >= speed) {
        const chars = Math.min(Math.floor(elapsed / speed), 3);
        const next = Math.min(idx.current + chars, text.length);
        idx.current = next;
        setDisplayed(text.slice(0, next));
        last.current = now;
        if (next >= text.length) { setDone(true); onDone?.(); return; }
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [text]);

  return <>{displayed}{!done && <span className="cursor">|</span>}</>;
}

const TRIAGE_COLORS = {
  EMERGENCY: { bg: "#7f1d1d", border: "#dc2626", text: "#fca5a5", label: "Emergency" },
  FACILITY: { bg: "#78350f", border: "#d97706", text: "#fde68a", label: "Visit Facility" },
  CHW_VISIT: { bg: "#1e3a5f", border: "#3b82f6", text: "#93c5fd", label: "CHW Visit" },
  SELF_CARE: { bg: "#14532d", border: "#22c55e", text: "#86efac", label: "Self-Care" },
};

function FollowupBadge({ followup }) {
  // Emergency followups are static ("Immediate - Call 199 ..."), not schedulable
  const isEmergency = /immediate|199|EFSTH/i.test(followup);
  const isDate = /\d{4}-\d{2}-\d{2}/.test(followup);
  const [saved, setSaved] = useState(() =>
    isDate && loadReminders().some((r) => r.when === followup)
  );
  const [showMenu, setShowMenu] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!showMenu) return;
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setShowMenu(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showMenu]);

  if (isEmergency || !isDate) {
    return <span className="followup-badge">Follow-up: {followup}</span>;
  }

  const display = formatFollowupDisplay(followup);

  const handleSave = () => {
    saveReminder(followup, "Health check-in with Amina");
    setSaved(true);
    setShowMenu(false);
  };
  const handleDownload = () => {
    downloadICS(followup, "Health check-in with Amina");
    setShowMenu(false);
  };
  const handleRemove = () => {
    removeReminder(followup, "Health check-in with Amina");
    setSaved(false);
    setShowMenu(false);
  };

  return (
    <span className="followup-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`followup-btn ${saved ? "followup-btn-saved" : ""}`}
        onClick={() => setShowMenu((s) => !s)}
        title={saved ? "Reminder saved — click to manage" : "Click to set a reminder"}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          {saved
            ? <><path d="M20 6L9 17l-5-5" /></>
            : <><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>
          }
        </svg>
        <span>{saved ? "Reminder set: " : "Follow-up: "}{display}</span>
      </button>
      {showMenu && (
        <div className="followup-menu" onMouseDown={(e) => e.stopPropagation()}>
          {!saved && (
            <button type="button" className="followup-menu-item" onClick={handleSave}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
              <span>Save reminder</span>
            </button>
          )}
          {saved && (
            <button type="button" className="followup-menu-item" onClick={handleRemove}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" /></svg>
              <span>Remove reminder</span>
            </button>
          )}
          <button type="button" className="followup-menu-item" onClick={handleDownload}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
            <span>Add to calendar (.ics)</span>
          </button>
        </div>
      )}
    </span>
  );
}

// ── Structured response detection + formatted card (mirrors CaregiverPortal) ──

function _isStructuredResponse(text) {
  if (!text) return false;
  const numberedItems = (text.match(/^\s*\d+\.\s/gm) || []).length;
  const boldHeaders   = (text.match(/\*\*[^*]+\*\*/g) || []).length;
  const bulletLines   = (text.match(/^\s*[-•*]\s/gm) || []).length;
  return numberedItems >= 3 || boldHeaders >= 2 || bulletLines >= 5;
}

function _parseBriefingSections(text) {
  const lines = text.split("\n");
  let title = "";
  const sections = [];
  let cur = null;
  for (const line of lines) {
    const headMatch = line.match(/^#{1,3}\s+(.+)/) || line.match(/^\*\*(.+?)\*\*/);
    if (headMatch) {
      if (!title) { title = headMatch[1].trim(); continue; }
      if (cur) sections.push(cur);
      cur = { heading: headMatch[1].trim(), body: "" };
    } else if (cur) {
      cur.body += (cur.body ? "\n" : "") + line;
    } else if (line.trim()) {
      if (!title) title = line.trim();
      else {
        cur = { heading: "", body: line };
      }
    }
  }
  if (cur) sections.push(cur);
  if (!title) title = "AMINA Health Advice";
  return { title, sections };
}

function _parseBullets(text) {
  return text
    .split("\n")
    .map(l => l.replace(/^[-•*]\s*/, "").replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean);
}

function _parseNumberedItems(text) {
  const intro = [];
  const items = [];
  const lines = text.split("\n");
  let started = false;
  for (const line of lines) {
    const numMatch = line.match(/^\s*(\d+)\.\s*(?:\*\*(.+?)\*\*[:\s]*)?(.*)$/);
    if (numMatch) {
      started = true;
      items.push({ num: numMatch[1], heading: (numMatch[2] || "").trim(), body: (numMatch[3] || "").trim() });
    } else if (!started && line.trim()) {
      intro.push(line.trim());
    } else if (started && line.trim() && items.length > 0) {
      items[items.length - 1].body += " " + line.trim();
    }
  }
  if (items.length === 0) {
    _parseBullets(text)
      .forEach((l, i) => items.push({ num: String(i + 1), heading: "", body: l }));
  }
  return { intro: intro.join(" "), items };
}

function _downloadAdvicePDF(text, title) {
  const { intro, items } = _parseNumberedItems(text);
  const now = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
  const pdfTitle = title || "AMINA Health Advice";

  const itemsHtml = items.map(({ num, heading, body }) => `
    <div class="item">
      <div class="item-num">${num}</div>
      <div class="item-body">
        ${heading ? `<div class="item-head">${heading}</div>` : ""}
        <div class="item-text">${body.replace(/\n/g, "<br>")}</div>
      </div>
    </div>`).join("");

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>${pdfTitle}</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; margin:0; padding:32px 40px; color:#0f172a; font-size:13px; }
  .header { background:linear-gradient(135deg,#0f172a,#1e293b); color:#fff; border-radius:10px; padding:22px 28px; margin-bottom:22px; display:flex; justify-content:space-between; align-items:flex-start; }
  .header-title { font-size:18px; font-weight:800; letter-spacing:-.3px; margin-bottom:4px; }
  .header-sub { font-size:11px; opacity:.75; }
  .header-date { font-size:11px; opacity:.65; text-align:right; }
  .badge { display:inline-block; background:#10b981; color:#fff; border-radius:20px; padding:3px 12px; font-size:11px; font-weight:700; margin-top:6px; }
  .intro { background:#f0f9ff; border-left:3px solid #6366f1; border-radius:0 6px 6px 0; padding:10px 16px; margin-bottom:18px; font-size:13px; color:#1e293b; line-height:1.6; }
  .item { display:flex; gap:14px; align-items:flex-start; margin-bottom:14px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:14px 18px; break-inside:avoid; }
  .item-num { background:#6366f1; color:#fff; border-radius:50%; width:26px; height:26px; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:800; flex-shrink:0; }
  .item-head { font-size:13px; font-weight:700; color:#0f172a; margin-bottom:4px; }
  .item-text { font-size:13px; color:#334155; line-height:1.65; }
  .footer { margin-top:24px; padding-top:12px; border-top:1px solid #e2e8f0; font-size:11px; color:#94a3b8; text-align:center; }
  @media print { body { padding:20px 24px; } }
</style></head><body>
<div class="header">
  <div>
    <div class="header-title">${pdfTitle}</div>
    <div class="header-sub">AMINA AI · Health Advice</div>
    <div class="badge">CONFIDENTIAL</div>
  </div>
  <div class="header-date">Generated<br>${now}</div>
</div>
${intro ? `<div class="intro">${intro}</div>` : ""}
${itemsHtml}
<div class="footer">Generated by AMINA AI. Not a substitute for professional medical advice.</div>
</body></html>`;

  const w = window.open("", "_blank");
  if (!w) { alert("Please allow pop-ups to download the advice."); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 400);
}

function AdviceCard({ text, dir, fontStyle }) {
  const isBriefing = text && text.includes("Clinical Briefing");
  const { title, sections } = isBriefing ? _parseBriefingSections(text) : { title: "", sections: [] };
  const { intro, items } = !isBriefing ? _parseNumberedItems(text) : { intro: "", items: [] };
  const now = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const SECTION_ICONS = { "Patient Information": "👤", "Current Status": "📋", "Clinical Findings": "🔬", "Recommendations": "✅", "Recommended Actions": "✅", "Follow-up Plan": "📅", "Warning Signs": "⚠️", "Diet": "🥗", "Medication": "💊", "References": "📚" };

  if (isBriefing) {
    return (
      <div className="advice-card" dir={dir} style={fontStyle}>
        <div className="advice-card-header">
          <div>
            <div className="advice-card-title">{title}</div>
            <div style={{ fontSize: 10, color: "#94a3b8" }}>AMINA AI · Clinical Briefing</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <span style={{ fontSize: 10, color: "#94a3b8" }}>{now}</span>
            <button className="advice-dl-btn" onClick={() => _downloadAdvicePDF(text, title)}>↓ PDF</button>
          </div>
        </div>
        <div className="advice-card-body">
          {sections.map((s, i) => (
            <div key={i} className="advice-section">
              <div className="advice-section-head">{SECTION_ICONS[s.heading] || "📌"} {s.heading || "Details"}</div>
              <div className="advice-section-text">{s.body}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="advice-card advice-card-suggest" dir={dir} style={fontStyle}>
      <div className="advice-card-header advice-card-header-suggest">
        <div>
          <div className="advice-card-title">AMINA Recommendations</div>
          {intro && <div style={{ fontSize: 11, color: "#99f6e4", marginTop: 2, maxWidth: 340 }}>{intro.length > 80 ? intro.slice(0, 80) + "…" : intro}</div>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <span style={{ fontSize: 10, color: "#99f6e4" }}>{now}</span>
          <button className="advice-dl-btn" onClick={() => _downloadAdvicePDF(text, "AMINA Health Recommendations")}>↓ PDF</button>
        </div>
      </div>
      {intro && <div className="advice-card-intro">{intro}</div>}
      <div className="advice-card-body">
        {items.map((it, i) => (
          <div key={i} className="advice-item">
            <div className="advice-item-num">{it.num}</div>
            <div>
              {it.heading && <div className="advice-item-head">{it.heading}</div>}
              <div className="advice-item-text">{it.body}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Msg({ msg, base, auto, onSS, onSE, onOpenSymptomForm, onOpenRxForm, uiLang, onRegenerate, msgIndex, nkoMode }) {
  // Summary turns are the output of token compaction: they sit in the
  // conversation as a compressed "what came before" marker. They're
  // neither user nor assistant — render them as a centred divider-style
  // block so the history continuity is visible at a glance.
  if (msg.role === "summary") {
    return (
      <div className="msg-summary" role="note" aria-label="Compacted earlier context">
        <div className="msg-summary-rule" />
        <div className="msg-summary-body">
          <div className="msg-summary-kicker">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 12 12 12 12 4" /><path d="M12 12 4 20" />
            </svg>
            <span>
              Previous context
              {typeof msg.compacted === "number" && msg.compacted > 0
                ? ` · ${msg.compacted} message${msg.compacted === 1 ? "" : "s"} compacted`
                : ""}
            </span>
          </div>
          <div className="msg-summary-text">{msg.content}</div>
        </div>
        <div className="msg-summary-rule" />
      </div>
    );
  }

  const isUser = msg.role === "user";
  const [typed, setTyped] = useState(false);
  const shouldAnimate = !isUser && msg.isNew && !typed;
  const triage = !isUser && msg.triage_level ? TRIAGE_COLORS[msg.triage_level] : null;
  const showSupport = !isUser && Array.isArray(msg.tools_used) && msg.tools_used.includes("suggest_community_support");
  const showNudge = !isUser && Array.isArray(msg.tools_used) && msg.tools_used.includes("get_lifestyle_nudge");
  const journey = !isUser ? msg.journey_callback : null;
  const anniversary = !isUser ? msg.anniversary : null;
  const vhwEndorsement = !isUser ? msg.referral_consumed : null;
  const suggestForm = !isUser ? msg.suggest_form : null;

  // Per-message translation (inline toggle under each assistant bubble)
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState(null);  // "up" | "down" | null
  const [showReasonPicker, setShowReasonPicker] = useState(false);
  const [feedbackReason, setFeedbackReason] = useState(null);
  const [feedbackThanks, setFeedbackThanks] = useState(false);
  const [translated, setTranslated] = useState(null);   // the translated text
  const [showTranslated, setShowTranslated] = useState(false);
  const [translating, setTranslating] = useState(false);

  const sourceLang = msg.source_language || "en";
  const otherLang = sourceLang === "en" ? "ma" : "en";
  const otherLangLabel = otherLang === "ma" ? "Mandinka" : "English";

  async function toggleTranslate() {
    // If we already have a translation, just flip the view
    if (translated !== null) {
      setShowTranslated((v) => !v);
      return;
    }
    // Use the original English from the backend if available (instant, no API call)
    if (sourceLang === "ma" && msg.english_original) {
      setTranslated(msg.english_original);
      setShowTranslated(true);
      return;
    }
    setTranslating(true);
    try {
      const r = await fetch(`${base.replace(/\/+$/, "")}/api/v1/agent/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: msg.content, source: sourceLang, target: otherLang }),
      });
      if (r.ok) {
        const d = await r.json();
        if (d.translated) {
          setTranslated(d.translated);
          setShowTranslated(true);
        }
      }
    } catch { /* silent */ }
    setTranslating(false);
  }

  const _rawDisplay = showTranslated && translated ? translated : msg.content;
  const displayText = nkoMode && uiLang === "ma" && !isUser ? toNko(_rawDisplay) : _rawDisplay;
  const displayDir = nkoMode && uiLang === "ma" && !isUser ? "rtl" : "ltr";

  if (msg._streaming && !msg.content) {
    return (
      <div className="msg-row">
        <div className="avatar-sm"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l3-9 4 18 3-9h4"/></svg></div>
        <div className="bubble-ai">
          <div className="typing-dots">{[0, 0.2, 0.4].map((d, i) => <div key={i} className="typing-dot" style={{ animationDelay: `${d}s` }} />)}</div>
        </div>
      </div>
    );
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(displayText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked */ }
  }

  function submitFeedback(kind, reason = null, comment = null) {
    // Fire-and-forget telemetry (best-effort)
    try {
      fetch(`${base.replace(/\/+$/, "")}/api/v1/agent/feedback`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message_index: msgIndex,
          rating: kind === "up" ? 1 : -1,
          reason,
          comment,
          message_preview: msg.content?.slice(0, 300),
          session_id: msg.session_id || null,
          intention: msg.intention || null,
          tools_used: msg.tools_used || [],
          language: msg.source_language || "en",
        }),
      }).catch(() => {});
    } catch { /* ignore */ }
  }

  function handleFeedback(kind) {
    // Toggle off if clicking the same thumb
    if (feedback === kind) {
      setFeedback(null);
      setShowReasonPicker(false);
      return;
    }
    setFeedback(kind);
    if (kind === "up") {
      submitFeedback("up");
      setFeedbackThanks(true);
      setTimeout(() => setFeedbackThanks(false), 1800);
      setShowReasonPicker(false);
    } else {
      // Open the reason picker — don't log yet
      setShowReasonPicker(true);
    }
  }

  function chooseReason(reasonKey) {
    setFeedbackReason(reasonKey);
    setShowReasonPicker(false);
    submitFeedback("down", reasonKey);
    setFeedbackThanks(true);
    setTimeout(() => setFeedbackThanks(false), 1800);
    // Remember this for smart regenerate
    if (typeof window !== "undefined") {
      window.__amina_last_downvote = { msgIndex, reason: reasonKey, at: Date.now() };
    }
  }

  return (
    <div className="msg-row" style={{ justifyContent: isUser ? "flex-end" : "flex-start" }}>
      {!isUser && <div className="avatar-sm"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l3-9 4 18 3-9h4"/></svg></div>}
      <div style={{ maxWidth: "75%" }}>
        {/* Emergency banner */}
        {msg.is_emergency && (
          <div className="emergency-banner">
            <span style={{ fontSize: 16 }}>🚨</span>
            <span>EMERGENCY — Call 199 immediately</span>
          </div>
        )}
        {showSupport && (
          <div className="support-banner">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            <span>Community support suggested</span>
          </div>
        )}
        {showNudge && (
          <div className="nudge-banner">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
            <span>One-Spoon Swap</span>
          </div>
        )}
        {vhwEndorsement && (
          <div className="vhw-banner" title={`Referred by ${vhwEndorsement.vhw_name}`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s-8-4.5-8-11.8A5.5 5.5 0 0 1 12 4a5.5 5.5 0 0 1 8 6.2c0 7.3-8 11.8-8 11.8z"/></svg>
            <span>CHW referral · {vhwEndorsement.vhw_name}</span>
          </div>
        )}
        {journey && (
          <div className={`journey-banner ${journey.celebration ? "journey-good" : "journey-warn"}`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              {journey.celebration
                ? <><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></>
                : <><path d="M12 8v4M12 16h.01"/><circle cx="12" cy="12" r="10"/></>
              }
            </svg>
            <span>{journey.months}-month {journey.type === "bp_journey" ? "BP" : "Sugar"} journey · {journey.delta > 0 ? "−" : "+"}{Math.abs(journey.delta)}</span>
          </div>
        )}
        {anniversary && !journey && (
          <div className="anniversary-banner">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
            <span>{anniversary.label} together · {anniversary.interaction_count} check-ins</span>
          </div>
        )}
        <div className={isUser ? "bubble-user" : msg.is_emergency ? "bubble-ai bubble-emergency" : "bubble-ai"} dir={displayDir} style={displayDir === "rtl" ? { fontFamily: "Noto Sans NKo, serif", textAlign: "right" } : {}}>
            {shouldAnimate
              ? <TypeWriter text={displayText} speed={18} onDone={() => setTyped(true)} />
              : displayText}
          </div>
        {!isUser && !msg.is_emergency && msg.content && (
          <div className="msg-actions">
            <button
              type="button"
              className="msg-action-btn"
              onClick={handleCopy}
              title="Copy message"
              aria-label="Copy"
            >
              {copied ? (
                <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span>Copied</span></>
              ) : (
                <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span>Copy</span></>
              )}
            </button>
            <button
              type="button"
              className={`msg-action-btn ${showTranslated ? "msg-action-btn-on" : ""}`}
              onClick={toggleTranslate}
              disabled={translating}
              title={`Translate to ${otherLangLabel}`}
              aria-label="Translate"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 8l6 6"/><path d="M4 14l6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="M22 22l-5-10-5 10"/><path d="M14 18h6"/></svg>
              <span>{translating ? "…" : showTranslated ? (sourceLang === "en" ? "English" : "Mandinka") : otherLangLabel}</span>
            </button>
            <button
              type="button"
              className={`msg-action-btn msg-action-icon ${feedback === "up" ? "msg-action-btn-good" : ""}`}
              onClick={() => handleFeedback("up")}
              title="Helpful"
              aria-label="Helpful"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill={feedback === "up" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
            </button>
            <button
              type="button"
              className={`msg-action-btn msg-action-icon ${feedback === "down" ? "msg-action-btn-bad" : ""}`}
              onClick={() => handleFeedback("down")}
              title="Not helpful"
              aria-label="Not helpful"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill={feedback === "down" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>
            </button>
            {onRegenerate && (
              <button
                type="button"
                className="msg-action-btn msg-action-icon"
                onClick={() => onRegenerate(msgIndex, feedbackReason)}
                title={feedbackReason ? `Regenerate (using feedback: ${feedbackReason.replace("_", " ")})` : "Regenerate response"}
                aria-label="Regenerate"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill={feedbackReason ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              </button>
            )}
          </div>
        )}
        {showReasonPicker && !isUser && (
          <div className="reason-picker">
            <div className="reason-picker-title">What was wrong?</div>
            <div className="reason-picker-grid">
              {[
                { k: "too_generic",   l: "Too generic" },
                { k: "wrong_info",    l: "Wrong info" },
                { k: "too_long",      l: "Too long" },
                { k: "too_short",     l: "Too short" },
                { k: "wrong_language",l: "Too complex" },
                { k: "not_cultural",  l: "Not Gambian enough" },
                { k: "missed_question", l: "Missed my question" },
                { k: "other",         l: "Other" },
              ].map((r) => (
                <button
                  key={r.k}
                  type="button"
                  className="reason-pick"
                  onClick={() => chooseReason(r.k)}
                >{r.l}</button>
              ))}
            </div>
            <button
              type="button"
              className="reason-picker-skip"
              onClick={() => { setShowReasonPicker(false); submitFeedback("down"); }}
            >Skip — just log a thumbs down</button>
          </div>
        )}
        {feedbackThanks && !isUser && (
          <div className={`feedback-thanks ${feedback === "up" ? "feedback-thanks-good" : "feedback-thanks-bad"}`}>
            {feedback === "up" ? "✓ Thanks — logged as helpful" :
              feedbackReason ? `✓ Logged · tap regenerate to retry with "${feedbackReason.replace("_", " ")}" fix` :
              "✓ Logged"}
          </div>
        )}
        {suggestForm === "symptom" && onOpenSymptomForm && (
          <button className="form-cta-btn form-cta-symptom" onClick={onOpenSymptomForm}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            <span>Open Symptom Form</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </button>
        )}
        {suggestForm === "prescription" && onOpenRxForm && (
          <div className="form-cta-row">
            <button className="form-cta-btn form-cta-rx" onClick={onOpenRxForm}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12h6m-3-3v6M21 15V7a2 2 0 0 0-2-2h-4l-2-2H8L6 5H5a2 2 0 0 0-2 2v8"/><path d="M3 15h18v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4Z"/></svg>
              <span>Enter Rx Details</span>
            </button>
            <button className="form-cta-btn form-cta-rx-upload" onClick={() => document.querySelector('input[type="file"][accept*="image"]')?.click()}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <span>Upload Photo</span>
            </button>
          </div>
        )}
        {!isUser && Array.isArray(msg.sources) && msg.sources.length > 0 && (
          <div className="msg-sources">
            <div className="msg-sources-label">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
              <span>Sources</span>
            </div>
            <div className="msg-sources-list">
              {msg.sources.map((s, i) => (
                <a key={i} className="msg-source-link" href={s.url} target="_blank" rel="noopener noreferrer" title={s.title}>
                  <span className="msg-source-org">{s.org}</span>
                  <span className="msg-source-title">{s.title}</span>
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                </a>
              ))}
            </div>
          </div>
        )}
        <div className="msg-meta" style={{ justifyContent: isUser ? "flex-end" : "flex-start" }}>
          <span className="msg-time">{msg.time}</span>
          {triage && (
            <span className="triage-badge" style={{ background: triage.bg, borderColor: triage.border, color: triage.text }}>
              {triage.label}
            </span>
          )}
          {!isUser && msg.followup && <FollowupBadge followup={msg.followup} />}
          {!isUser && msg.content && <Spk text={msg.content} base={base} auto={auto && msg.isNew} onSS={onSS} onSE={onSE} lang={uiLang} sourceLang={msg.source_language || "en"} />}
        </div>
      </div>
      {isUser && <div className="avatar-user"><svg width="13" height="13" viewBox="0 0 24 24" fill="#a5b4fc"><path d="M12 1a4 4 0 00-4 4v7a4 4 0 008 0V5a4 4 0 00-4-4z" /><path d="M19 10v2a7 7 0 01-14 0v-2" stroke="#a5b4fc" strokeWidth="1.5" fill="none" /></svg></div>}
    </div>
  );
}

function Typing() {
  return (
    <div className="msg-row">
      <div className="avatar-sm"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l3-9 4 18 3-9h4"/></svg></div>
      <div className="bubble-ai">
        <div className="typing-dots">{[0, 0.2, 0.4].map((d, i) => <div key={i} className="typing-dot" style={{ animationDelay: `${d}s` }} />)}</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// COMMUNITY FEATURE CARDS — the 5 pillars of AMINA's social layer
// ═══════════════════════════════════════════════════════════════

function BantabaCard({ data, onOpen, canEdit, onEdit }) {
  if (!data) return <CardSkeleton title="Bantaba Circle" />;
  const members = data.members || [];
  const initials = members.slice(0, 6).map((m) => m.name?.[0] || "?").join("");
  return (
    <button className="ccard ccard-bantaba" onClick={onOpen}>
      <div className="ccard-head">
        <span className="ccard-badge ccard-badge-bantaba">BANTABA · WEEK {data.streak_weeks}</span>
        {data.adherence_pct >= 85 && <span className="ccard-pill ccard-pill-good">On track</span>}
      </div>
      <div className="ccard-title">{data.name}</div>
      <div className="ccard-sub">{data.village} · {members.length} members · checkin {data.next_checkin_display}</div>
      <div className="ccard-ring-row">
        <div className="ccard-ring" style={{ "--pct": data.adherence_pct }}>
          <div className="ccard-ring-inner">
            <div className="ccard-ring-val">{data.adherence_pct}<span>%</span></div>
            <div className="ccard-ring-label">adherence</div>
          </div>
        </div>
        <div className="ccard-avatars">
          {members.slice(0, 6).map((m, i) => (
            <div key={i} className="ccard-avatar" style={{ background: `hsl(${(i*60+20)%360},55%,48%)` }}>{m.name?.[0] || "?"}</div>
          ))}
          {members.length > 6 && <div className="ccard-avatar ccard-avatar-more">+{members.length - 6}</div>}
        </div>
      </div>
      {data.this_week_highlight && (
        <div className="ccard-highlight">"{data.this_week_highlight}"</div>
      )}
      <UpdatedBadge data={data} />
      {canEdit && (
        <div className="ccard-edit-row" onMouseDown={(e) => e.stopPropagation()}>
          <button className="ccard-edit-btn" onClick={onEdit} title="Manage Bantaba Circle">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            <span>Manage circle</span>
          </button>
        </div>
      )}
    </button>
  );
}

function MyCircleCard({ data, onOpen }) {
  if (!data) return null;
  const members = data.members || [];
  const adherence = data.adherence_pct ?? (members.length
    ? Math.round(100 * members.reduce((s, m) => s + Math.min(m.adherence_week || 0, m.adherence_target || 7), 0)
        / members.reduce((s, m) => s + (m.adherence_target || 7), 0))
    : 0);
  return (
    <button className="ccard ccard-bantaba" style={{ borderColor: "rgba(129,140,248,0.45)" }} onClick={onOpen}>
      <div className="ccard-head">
        <span className="ccard-badge" style={{ background: "rgba(99,102,241,0.18)", color: "#c7d2fe", border: "1px solid rgba(129,140,248,0.35)" }}>MY CIRCLE</span>
        {members.length <= 1 && <span className="ccard-pill" style={{ background: "rgba(234,179,8,0.18)", color: "#fcd34d", border: "1px solid rgba(234,179,8,0.3)" }}>Add members</span>}
      </div>
      <div className="ccard-title">{data.name || "My Circle"}</div>
      <div className="ccard-sub">{data.village || "Kerewan"} · {members.length} member{members.length !== 1 ? "s" : ""}</div>
      <div className="ccard-ring-row">
        <div className="ccard-ring" style={{ "--pct": adherence }}>
          <div className="ccard-ring-inner">
            <div className="ccard-ring-val">{adherence}<span>%</span></div>
            <div className="ccard-ring-label">adherence</div>
          </div>
        </div>
        <div className="ccard-avatars">
          {members.slice(0, 6).map((m, i) => (
            <div key={i} className="ccard-avatar" style={{ background: `hsl(${(i * 60 + 200) % 360},55%,48%)` }}>{m.name?.[0] || "?"}</div>
          ))}
          {members.length > 6 && <div className="ccard-avatar ccard-avatar-more">+{members.length - 6}</div>}
        </div>
      </div>
      {/* <div className="ccard-edit-row" onMouseDown={(e) => e.stopPropagation()}>
        <button className="ccard-edit-btn" onClick={(e) => { e.stopPropagation(); onOpen(); }} title="Open my circle">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <span>My circle</span>
        </button>
      </div> */}
    </button>
  );
}

function ScoutCard({ data, onOpen, canEdit, onEdit, scoutList, activeScoutId, onSwitchScout, isScoutRole }) {
  if (!data) return <CardSkeleton title="Youth Scout" />;
  const { badge, this_week_mission: mission } = data;
  const missionPct = mission ? Math.round(100 * mission.progress / mission.target) : 0;
  return (
    <button className="ccard ccard-scout" onClick={onOpen}>
      <div className="ccard-head">
        <span className="ccard-badge ccard-badge-scout">YOUTH SCOUT · RANK #{data.rank_in_village}</span>
        <span className={`ccard-pill ccard-pill-${badge?.current?.color || "bronze"}`}>{badge?.current?.name}</span>
      </div>
      <div className="ccard-title">{data.name}, {data.age}</div>
      <div className="ccard-sub">{data.village} · {data.total_checks} check-ins · {data.elders_monitored?.length || 0} elders</div>

      {badge?.next && (
        <div className="scout-progress">
          <div className="scout-progress-head">
            <span>Progress to <strong>{badge.next.name}</strong></span>
            <span>{badge.progress_to_next}%</span>
          </div>
          <div className="scout-bar"><div className="scout-bar-fill" style={{ width: `${badge.progress_to_next}%` }}></div></div>
        </div>
      )}

      {mission && (
        <div className="scout-mission">
          <div className="scout-mission-head">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            <span>This week's mission</span>
            <span className="scout-mission-count">{mission.progress}/{mission.target}</span>
          </div>
          <div className="scout-mission-title">{mission.title}</div>
          <div className="scout-bar"><div className="scout-bar-fill scout-bar-fill-gold" style={{ width: `${missionPct}%` }}></div></div>
        </div>
      )}

      {/* Bottom action row — compact, side by side */}
      <div className="ccard-bottom-row" onMouseDown={(e) => e.stopPropagation()}>
        {scoutList && scoutList.length > 1 && (canEdit || isScoutRole) && (
          <select className="scout-select-mini" value={activeScoutId} onChange={(e) => onSwitchScout && onSwitchScout(e.target.value)}>
            {scoutList.map((s) => (
              <option key={s.scout_id || s.name} value={s.scout_id || "default"}>
                {s.name} · {s.total_checks || 0}
              </option>
            ))}
          </select>
        )}
        {canEdit && (
          <button className="ccard-edit-btn" onClick={onEdit}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            <span>Manage</span>
          </button>
        )}
      </div>
    </button>
  );
}

function VillageCard({ data, onOpen, canEdit, onEdit }) {
  if (!data) return <CardSkeleton title="Village Score" />;
  const pct = Math.round(100 * data.score / data.max_score);
  return (
    <button className="ccard ccard-village" onClick={onOpen}>
      <div className="ccard-head">
        <span className="ccard-badge ccard-badge-village">VILLAGE · {data.region?.toUpperCase()}</span>
        <span className={`ccard-pill ccard-pill-${data.trend === "up" ? "good" : data.trend === "down" ? "warn" : ""}`}>
          {data.trend === "up" ? "↑" : data.trend === "down" ? "↓" : "→"} {data.delta_from_last_month > 0 ? "+" : ""}{data.delta_from_last_month} this month
        </span>
      </div>
      <div className="ccard-title">{data.village}</div>
      <div className="ccard-sub">Rank #{data.regional_rank} of {data.regional_total} in region</div>

      <div className="village-score-row">
        <div className="village-big-score">
          <div className="village-score-val">{data.score}</div>
          <div className="village-score-max">/ {data.max_score}</div>
        </div>
        <div className="village-pillars">
          {data.pillars?.map((p) => (
            <div key={p.id} className="village-pillar" title={p.detail}>
              <div className="village-pillar-name">{p.name}</div>
              <div className="village-pillar-bar">
                <div className="village-pillar-fill" style={{ width: `${100*p.score/p.max}%` }}></div>
              </div>
              <div className="village-pillar-val">{p.score}/{p.max}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="village-leader">Leading: <strong>{data.leading_village?.name}</strong> at {data.leading_village?.score}</div>
      {canEdit && (
        <div className="ccard-edit-row" onMouseDown={(e) => e.stopPropagation()}>
          <button className="ccard-edit-btn" onClick={onEdit} title="Update village scoreboard">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            <span>Update scores</span>
          </button>
        </div>
      )}
    </button>
  );
}

function SeasonalCard({ data, onOpen }) {
  if (!data) return <CardSkeleton title="Seasonal Rhythm" />;
  const tip = data.featured_tip || {};
  return (
    <button className="ccard ccard-seasonal" onClick={onOpen}>
      <div className="ccard-head">
        <span className="ccard-badge ccard-badge-seasonal">{data.season?.emoji} {data.season?.name?.toUpperCase()}</span>
        <span className="ccard-date">{data.date}</span>
      </div>
      <div className="seasonal-tip">
        <div className="seasonal-tip-icon">{tip.icon}</div>
        <div className="seasonal-tip-text">{tip.tip}</div>
      </div>
      {data.is_ramadan && (
        <div className="seasonal-ramadan">
          <span className="seasonal-ramadan-badge">🌙 RAMADAN ACTIVE</span>
          <span>Timing-adjusted advice available — tap to open</span>
        </div>
      )}
      <div className="seasonal-footer">Tap for all {data.all_tips?.length || 0} {data.season?.name?.toLowerCase()} tips</div>
    </button>
  );
}

function HealerBridgeCard({ data, onOpen, canEdit, canEditCarePath, onEditSupply, onEditDualPath }) {
  if (!data) return <CardSkeleton title="Care Bridge" />;
  const safe = data.interactions_flag?.safe;
  return (
    <button className="ccard ccard-bridge" onClick={onOpen}>
      <div className="ccard-head">
        <span className="ccard-badge ccard-badge-bridge">DUAL-PATH CARE</span>
        {safe ? (
          <span className="ccard-pill ccard-pill-good">Safe together</span>
        ) : (
          <span className="ccard-pill ccard-pill-warn">Check interactions</span>
        )}
      </div>
      <div className="bridge-paths">
        <div className="bridge-path bridge-path-traditional">
          <div className="bridge-path-head">🌿 Traditional</div>
          <div className="bridge-path-name">{data.traditional_care?.practitioner}</div>
          <div className="bridge-path-meta">{data.traditional_care?.last_visit_days_ago}d ago</div>
        </div>
        <div className="bridge-plus">+</div>
        <div className="bridge-path bridge-path-modern">
          <div className="bridge-path-head">🏥 Modern</div>
          <div className="bridge-path-name">{data.modern_care?.chw_name}</div>
          <div className="bridge-path-meta">{data.modern_care?.last_visit_days_ago}d ago</div>
        </div>
      </div>
      {data.progress?.message && (
        <div className="bridge-progress">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
          <span><strong>{data.progress.bp_start} → {data.progress.bp_current}</strong> over {data.progress.months_on_plan} months</span>
        </div>
      )}
      {data.supply?.days_remaining <= 7 && (
        <div className="bridge-supply-warn">
          ⚠ {data.supply.medicine} — only {data.supply.days_remaining} days left
        </div>
      )}
      {canEdit && (
        <div className="ccard-edit-row" onMouseDown={(e) => e.stopPropagation()}>
          <button className="ccard-edit-btn" onClick={onEditSupply} title="Update medicine supply">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            <span>Supply</span>
          </button>
          {canEditCarePath ? (
            <button className="ccard-edit-btn" onClick={onEditDualPath} title="Update dual-path care">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              <span>Care paths</span>
            </button>
          ) : (
            <span className="ccard-edit-btn" title="Care path edits are locked to clinicians" style={{ opacity: 0.55, cursor: "not-allowed" }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              <span>Care paths</span>
            </span>
          )}
        </div>
      )}
    </button>
  );
}

function UpdatedBadge({ data }) {
  if (!data?.updated_at) return null;
  const ago = Math.round((Date.now() - new Date(data.updated_at).getTime()) / 60000);
  const label = ago < 1 ? "just now" : ago < 60 ? `${ago}m ago` : ago < 1440 ? `${Math.round(ago/60)}h ago` : `${Math.round(ago/1440)}d ago`;
  return (
    <div className="ccard-updated">
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <span>{label}{data.updated_by ? ` · ${data.updated_by}` : ""}</span>
    </div>
  );
}

function CardSkeleton({ title }) {
  return (
    <div className="ccard ccard-skel">
      <div className="ccard-head"><span className="ccard-badge ccard-badge-skel">{title?.toUpperCase()}</span></div>
      <div className="ccard-skel-line" style={{ width: "70%" }}></div>
      <div className="ccard-skel-line" style={{ width: "90%" }}></div>
      <div className="ccard-skel-line" style={{ width: "50%" }}></div>
    </div>
  );
}

function Toggle({ label, on, flip }) {
  return (
    <div className="toggle-row">
      <span>{label}</span>
      <button onClick={flip} className="toggle" style={{ background: on ? "var(--accent)" : "rgba(255,255,255,0.08)" }}>
        <div className="toggle-knob" style={{ transform: on ? "translateX(18px)" : "translateX(2px)" }} />
      </button>
    </div>
  );
}

export default function App() {
  const [base, setBase] = useState(() => {
    // Resolution order:
    //   1. VOICE_BASE_URL in localStorage IF it isn't a stale dev URL
    //      (legacy local builds cached "http://127.0.0.1:8000" — we must
    //      ignore that on prod or every fetch hits the wrong origin).
    //   2. window.AMINA_API — set by index.html from VITE_API_URL at build.
    //   3. http://localhost:8000 dev fallback (npm run dev).
    const stored = localStorage.getItem("VOICE_BASE_URL");
    if (stored && !/127\.0\.0\.1|localhost/.test(stored)) return stored;
    if (typeof window !== "undefined" && window.AMINA_API) return window.AMINA_API;
    return "http://localhost:8000";
  });
  const [rec, setRec] = useState(false);
  const [status, setStatus] = useState("idle");
  const [live, setLive] = useState("");
  // ── Auth state ──
  const [authToken, setAuthToken] = useState(() => localStorage.getItem("AMINA_TOKEN") || null);
  const [authPatient, setAuthPatient] = useState(() => {
    try { return JSON.parse(localStorage.getItem("AMINA_PATIENT") || "null"); } catch { return null; }
  });

  const handleLogin = (token, patient, sid) => {
    setAuthToken(token);
    setAuthPatient(patient);
    localStorage.setItem("AMINA_TOKEN", token);
    localStorage.setItem("AMINA_PATIENT", JSON.stringify(patient));
    if (sid) {
      setSessionId(sid);
      localStorage.setItem("AMINA_SID", sid);
    }
    setMsgs([]);
  };

  const handleLogout = () => {
    fetch(`${base.replace(/\/+$/, "")}/api/v1/agent/session/${sessionId}/end`, { method: "POST" }).catch(() => {});
    setAuthToken(null);
    setAuthPatient(null);
    setCommunity(null);
    localStorage.removeItem("AMINA_TOKEN");
    localStorage.removeItem("AMINA_PATIENT");
    localStorage.removeItem("AMINA_SID");
    setMsgs([]);
    setSessionId(genSessionId());
  };

  // ── App state ──
  const [err, setErr] = useState("");
  const [sec, setSec] = useState(0);
  const [health, setHealth] = useState(null);
  const [micAn, setMicAn] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [silence, setSilence] = useState(0);
  const [autoStop, setAutoStop] = useState(true);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [msgs, setMsgs] = useState([]);
  const [isCompacting, setIsCompacting] = useState(false);
  const [modelSwitchNotice, setModelSwitchNotice] = useState("");
  const [compactToast, setCompactToast] = useState(null);
  const [freedOffset, _setFreedOffset] = useState(() => {
    try { return parseInt(sessionStorage.getItem(`amina_compact_offset_${sessionId}`) || '0', 10) || 0; } catch { return 0; }
  });
  const setFreedOffset = (v) => {
    _setFreedOffset(v);
    try { sessionStorage.setItem(`amina_compact_offset_${sessionId}`, String(v)); } catch {}
  };
  // Two-click confirm for destructive "Clear conversation" action.
  // First click → sets pending for 3 s (button turns red, label "Click again to clear").
  // Second click within the window → actually runs clearChat().
  const [clearPending, setClearPending] = useState(false);
  const clearPendingTimerRef = useRef(null);
  const [nkoMode, setNkoMode] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [micOk, setMicOk] = useState("prompt");
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [lastTriage, setLastTriage] = useState(null);
  // Phase D.5 (revised 2026-05-05) — abuse-defense session lock state.
  // Set by _finalize() when backend returns session_action ∈ {session_terminate,
  // terminate, cooldown}. Disables the chat input + shows a lock banner with
  // a "Start New Conversation" button. Cleared when user starts a new chat.
  const [abuseLock, setAbuseLock] = useState({ active: false, kind: null, duration: null, since: 0 });
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(localStorage.getItem("VOICE_MIC_DEVICE_ID") || "");
  const [avatarSpeaking, setAvatarSpeaking] = useState(false);
  const [ttsAnalyser, setTtsAnalyser] = useState(null);
  const [uploadingRx, setUploadingRx] = useState(false);
  const rxInputRef = useRef(null);
  const [chatInput, setChatInput] = useState("");
  // AMINA LoRA is currently disabled for maintenance. If the cached
  // preference is "amina", silently migrate to "mistral" so the user
  // doesn't get stuck with a model that always falls back.
  const [modelPref, setModelPref] = useState(() => {
    const cached = localStorage.getItem("AMINA_MODEL_PREF") || "mistral";
    return cached === "amina" ? "mistral" : cached;
  });
  const [language, setLanguage] = useState(localStorage.getItem("AMINA_LANG") || "en");
  const [userRole, setUserRole] = useState(localStorage.getItem("AMINA_ROLE") || "patient");
  const [showCareEdit, setShowCareEdit] = useState(null); // "supply" | "dualpath" | null
  const [docPreview, setDocPreview] = useState(null);  // generated document JSON
  const [docLoading, setDocLoading] = useState(false);
  // PDF (chat-transcript) button gets a separate busy flag so it can lock
  // itself the moment the user clicks until the browser starts the download.
  // Pre-fix, double-clicking fired two parallel exports; now the second
  // click is a no-op while the first is in flight.
  const [pdfDownloading, setPdfDownloading] = useState(false);
  const [docFeedback, setDocFeedback] = useState(null); // "up" | "down" | null
  const [docDownloading, setDocDownloading] = useState(null); // "pdf" | "docx" | null
  const [careEditData, setCareEditData] = useState({});
  const [careSaving, setCareSaving] = useState(false);
  const [communityForm, setCommunityForm] = useState({});
  const [scoutList, setScoutList] = useState([]);
  const [activeScoutId, setActiveScoutId] = useState("default");
  const [showScoutApply, setShowScoutApply] = useState(false);
  const [scoutApplyForm, setScoutApplyForm] = useState({ name: "", age: "", village: "Kerewan", phone: "" });
  const [scoutApplyResult, setScoutApplyResult] = useState(null);
  const [uiTranslations, setUiTranslations] = useState({});
  const [langPromptShown, setLangPromptShown] = useState(false);  // session-scoped
  const [showLangPrompt, setShowLangPrompt] = useState(false);
  const [showRxHelper, setShowRxHelper] = useState(false);
  const [rxForm, setRxForm] = useState({ name: "", dosage: "", frequency: "", duration: "", notes: "" });
  const [anonymous, setAnonymous] = useState(localStorage.getItem("VOICE_ANONYMOUS") === "1");
  const [dailyNudge, setDailyNudge] = useState(null);
  const [nudgeLoading, setNudgeLoading] = useState(false);
  const [reminders, setReminders] = useState(() => loadReminders());
  const [carePlan, setCarePlan] = useState(() => {
    try { return JSON.parse(localStorage.getItem("AMINA_CARE_PLAN") || "null"); } catch { return null; }
  });
  const [carePlanOpen, setCarePlanOpen] = useState(false);
  const [carePlanLoading, setCarePlanLoading] = useState(false);
  const [showNotifPrefs, setShowNotifPrefs] = useState(false);
  const [notifSaved, setNotifSaved] = useState(() => !!localStorage.getItem("AMINA_NOTIF_PREFS"));
  const [notifForm, setNotifForm] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("AMINA_NOTIF_PREFS") || "null") || {
        whatsapp: "", telegram: "", email: "", sms: "", browser: false, frequency: "as_scheduled",
      };
    } catch { return { whatsapp: "", telegram: "", email: "", sms: "", browser: false, frequency: "as_scheduled" }; }
  });
  const [community, setCommunity] = useState(null);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [activePanel, setActivePanel] = useState(null);  // modal expansion of a card
  const [showSymptomForm, setShowSymptomForm] = useState(false);
  const [symptomForm, setSymptomForm] = useState({
    main: "", location: "", duration: "", severity: "5",
    onset: "", triggers: "", relief: "", associated: "", tried: "",
  });

  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const mimeRef = useRef("");
  const audioCtxRef = useRef(null);
  const vadRef = useRef(null);
  const stoppedRef = useRef(false);
  const endRef = useRef(null);

  const onSpeakStart = (an) => { setAvatarSpeaking(true); setTtsAnalyser(an); };
  const onSpeakEnd = () => { setAvatarSpeaking(false); setTtsAnalyser(null); };

  // Replay the most recent Amina reply in the requested language. Called
  // from the English / Mandinka language toggle so flipping the button
  // repeats the last thing Amina said in the newly-selected voice.
  //
  // Clicking the toggle is an explicit user gesture — that's enough to
  // unlock audio on every modern browser, so we flip `audioOK` ourselves
  // instead of gating on a previous speaker-button click. We also stop
  // any currently-playing tts audio first so an in-flight English reply
  // doesn't stomp over the new Mandinka playback.
  const replayLastReplyInLang = useCallback((targetLang) => {
    try {
      const last = [...msgs].reverse().find((m) => m && m.role === "assistant" && m.content);
      if (!last) return;
      audioOK = true;
      // Stop any <audio> elements the Spk component spawned.
      try {
        document.querySelectorAll("audio").forEach((a) => {
          try { a.pause(); a.currentTime = 0; } catch { /* noop */ }
        });
      } catch { /* noop */ }
      onSpeakEnd();  // clear the "speaking" indicator so the fresh call can set it
      // Pass source_language so the backend doesn't double-translate an
      // already-Mandinka message. `last.source_language` is set at the
      // moment the reply arrived from /agent/chat — it reflects whatever
      // language the user was in when Amina generated that specific turn.
      ttsPlay(
        base, last.content, targetLang,
        onSpeakStart, onSpeakEnd,
        last.source_language || "en",
      );
    } catch { /* noop — replay is best-effort */ }
  }, [msgs, base]);

  useEffect(() => { localStorage.setItem("VOICE_BASE_URL", base); }, [base]);
  useEffect(() => { localStorage.setItem("VOICE_MIC_DEVICE_ID", selectedDevice || ""); }, [selectedDevice]);
  useEffect(() => { localStorage.setItem("VOICE_ANONYMOUS", anonymous ? "1" : "0"); }, [anonymous]);
  useEffect(() => { localStorage.setItem("AMINA_LANG", language); }, [language]);
  useEffect(() => { localStorage.setItem("AMINA_MODEL_PREF", modelPref); }, [modelPref]);
  useEffect(() => { localStorage.setItem("AMINA_ROLE", userRole); }, [userRole]);
  useEffect(() => { if (sessionId) localStorage.setItem("AMINA_SID", sessionId); }, [sessionId]);

  // Fetch batch translations when language changes to Mandinka
  useEffect(() => {
    if (language === "en") {
      setUiTranslations({});
      return;
    }
    const cacheKey = `AMINA_UI_TRANSLATIONS_${language}`;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        const sampleKey = Object.keys(parsed)[0];
        if (sampleKey && parsed[sampleKey] !== UI_STRINGS_EN[sampleKey]) {
          setUiTranslations(parsed);
          return;
        }
        localStorage.removeItem(cacheKey);
      }
    } catch { /* ignore corrupt cache */ }

    (async () => {
      try {
        const r = await fetch(`${base.replace(/\/+$/, "")}/api/v1/agent/translate/batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texts: UI_STRINGS_EN, source: "en", target: language }),
        });
        if (!r.ok) {
          console.error("Translation API error:", r.status, await r.text().catch(() => ""));
          return;
        }
        const d = await r.json();
        if (d.translations) {
          setUiTranslations(d.translations);
          localStorage.setItem(cacheKey, JSON.stringify(d.translations));
        }
      } catch (e) {
        console.error("Translation fetch failed:", e);
      }
    })();
  }, [language, base]);

  // i18n helper
  const t = (key) => uiTranslations[key] || UI_STRINGS_EN[key] || key;
  // Stick the chat to the bottom on new messages — but only when the user
  // was already there; don't yank them mid-read of older messages.
  useStickToBottom(endRef, [msgs, processing, live]);

  useEffect(() => {
    (async () => {
      try {
        if (navigator.permissions?.query) {
          try {
            const r = await navigator.permissions.query({ name: "microphone" });
            if (r.state === "granted") { setMicOk("granted"); await enumDevices(); return; }
          } catch {}
        }
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
        setMicOk("granted");
        await enumDevices();
      } catch { setMicOk("denied"); }
    })();
    navigator.mediaDevices.addEventListener("devicechange", enumDevices);
    return () => navigator.mediaDevices.removeEventListener("devicechange", enumDevices);
  }, []);

  async function enumDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const mics = all.filter((d) => d.kind === "audioinput");
      setDevices(mics);
      setSelectedDevice((prev) => {
        const saved = prev || localStorage.getItem("VOICE_MIC_DEVICE_ID") || "";
        return saved && mics.some((x) => x.deviceId === saved) ? saved : mics[0]?.deviceId || "";
      });
    } catch { setDevices([]); setSelectedDevice(""); }
  }

  const startTimer = () => { setSec(0); timerRef.current = setInterval(() => setSec((s) => s + 1), 1000); };
  const stopTimer = () => { if (timerRef.current) clearInterval(timerRef.current); timerRef.current = null; };

  async function sttCall(blob, mime) {
    let ext = "bin";
    if ((mime || "").includes("webm")) ext = "webm";
    else if ((mime || "").includes("ogg")) ext = "ogg";
    const form = new FormData();
    form.append("file", blob, `mic.${ext}`);
    try {
      const r = await fetch(`${base.replace(/\/+$/, "")}/api/v1/stt`, { method: "POST", body: form });
      if (!r.ok) return "";
      const d = await r.json();
      return d.transcript || d.text || "";
    } catch { return ""; }
  }

  function startVAD(analyser, onSilence) {
    const data = new Uint8Array(analyser.frequencyBinCount);
    let silenceStart = null, hadSound = false;
    const startTime = Date.now();

    const check = () => {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const level = sum / data.length / 255;

      if (level > VAD_THR) { silenceStart = null; hadSound = true; setSilence(0); }
      else {
        if (!silenceStart) silenceStart = Date.now();
        const ms = Date.now() - silenceStart;
        if (hadSound && Date.now() - startTime > VAD_MIN) {
          setSilence(Math.min(ms / VAD_DUR, 1));
          if (ms >= VAD_DUR) { setSilence(0); onSilence(); return; }
        }
      }
      vadRef.current = requestAnimationFrame(check);
    };
    check();
  }

  function stopVAD() { if (vadRef.current) { cancelAnimationFrame(vadRef.current); vadRef.current = null; } setSilence(0); }

  function buildHistory() { return msgs.map((m) => ({ role: m.role, content: m.content })); }

  // OLD textChat (RAG-only, kept for reference):
  // async function textChat(text, history) {
  //   const r = await fetch(`${base.replace(/\/+$/, "")}/api/v1/text-chat`, {
  //     method: "POST", headers: { "Content-Type": "application/json" },
  //     body: JSON.stringify({ text, history }),
  //   });
  //   const d = JSON.parse(await r.text());
  //   if (d.answer) setMsgs((p) => [...p, { role: "assistant", content: d.answer, time: timeNow(), isNew: true }]);
  // }

  async function textChat(text, regenerateHint = null) {
    setProcessing(true);
    setErr("");
    const chatBody = {
      message: text,
      session_id: sessionId,
      patient_id: authPatient?.id || null,
      patient_name: authPatient?.name || null,
      language,
      user_role: userRole !== "patient" ? userRole : null,
      regenerate_hint: regenerateHint,
      model_preference: modelPref,
    };

    const _finalize = (d) => {
      if (d.triage_level) setLastTriage(d.triage_level);
      if (d.export_action && d.export_action.type === "download_chat_pdf") {
        setTimeout(() => { downloadChatTranscript(); }, 350);
      }
      if (d.suggest_notifications && !notifSaved) {
        setTimeout(() => setShowNotifPrefs(true), 600);
      }
      if (d.suggest_language_switch === "ma" && !langPromptShown && language !== "ma") {
        setTimeout(() => setShowLangPrompt(true), 500);
        setLangPromptShown(true);
      }

      // Phase D.5 (revised 2026-05-05) — abuse-defense session lock.
      // Behaviour the user asked for: when the backend says the session
      // is over (session_action ∈ {session_terminate, terminate}), the
      // chat history STAYS visible (so the user can read what AMINA
      // told them), but the input is LOCKED so they can't keep typing
      // in this session. They must click "New Conversation" or the
      // existing Clear button to start fresh.
      //
      // For "cooldown" (the user is mid-lockout — already had cool-down
      // activated earlier), we lock the input too so they can't keep
      // sending messages until the timer expires.
      if (d.session_action === "session_terminate" ||
          d.session_action === "terminate" ||
          d.session_action === "cooldown") {
        const cdMin = d.cooldown_remaining_s
          ? Math.max(1, Math.round(d.cooldown_remaining_s / 60))
          : 0;
        const friendlyDuration = cdMin > 0
          ? (cdMin >= 60 * 24
              ? Math.round(cdMin / (60 * 24)) + " day" + (cdMin >= 60 * 48 ? "s" : "")
              : cdMin >= 60
                ? Math.round(cdMin / 60) + " hour" + (cdMin >= 120 ? "s" : "")
                : cdMin + " minute" + (cdMin === 1 ? "" : "s"))
          : null;
        // Setting state.lockReason puts the input bar into the locked
        // mode (see input-render gate further down). status="terminated"
        // prevents accidental retries from any in-flight typewriter.
        setStatus("terminated");
        setAbuseLock({
          active:    true,
          kind:      d.session_action,
          duration:  friendlyDuration,
          since:     Date.now(),
        });
      }
    };

    // Try SSE streaming if available
    if (window.AMINA_STREAMING) {
      let streamIdx = null;
      try {
        // Insert placeholder bubble for progressive rendering
        setMsgs((p) => { streamIdx = p.length; return [...p, {
          role: "assistant", content: "", time: timeNow(), isNew: true,
          _streaming: true,
        }]; });

        await window.AMINA_STREAMING.streamChat({
          baseUrl: base,
          body: chatBody,
          onToken: (chunk) => {
            setMsgs((p) => {
              const updated = [...p];
              const idx = updated.findIndex((m) => m._streaming);
              if (idx >= 0) updated[idx] = { ...updated[idx], content: updated[idx].content + chunk };
              return updated;
            });
          },
          onDone: (d) => {
            setMsgs((p) => {
              const updated = [...p];
              const idx = updated.findIndex((m) => m._streaming);
              if (idx >= 0) updated[idx] = {
                role: "assistant", content: d.response, time: timeNow(), isNew: true,
                source_language: d.detected_language === "ma" ? "ma" : "en",
                english_original: d.english_original || null,
                triage_level: d.triage_level, is_emergency: d.is_emergency,
                followup: d.followup, tools_used: d.tools_used,
                suggest_form: d.suggest_form, suggest_notifications: d.suggest_notifications,
                journey_callback: d.journey_callback,
                anniversary: d.anniversary,
                vitals_trend: d.vitals_trend,
                referral_consumed: d.referral_consumed,
                session_id: sessionId,
                intention: d.intention,
                was_regenerated: regenerateHint != null,
                sources: d.sources || [],
              };
              return updated;
            });
            _finalize(d);
          },
          onError: (err) => { setStatus("error"); setErr(err); },
        });
        setStatus("idle");
        setProcessing(false);
        return;
      } catch {
        // Remove placeholder, fall through to standard fetch
        setMsgs((p) => p.filter((m) => !m._streaming));
      }
    }

    // Standard non-streaming fallback
    try {
      const r = await fetch(`${base.replace(/\/+$/, "")}/api/v1/agent/chat`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chatBody),
      });
      const x = await r.text();
      if (!r.ok) { setStatus("error"); setErr(`Error (${r.status}): ${x}`); setProcessing(false); return; }
      const d = JSON.parse(x);
      if (d.response) {
        setMsgs((p) => [...p, {
          role: "assistant", content: d.response, time: timeNow(), isNew: true,
          source_language: d.detected_language === "ma" ? "ma" : "en",
          english_original: d.english_original || null,
          triage_level: d.triage_level, is_emergency: d.is_emergency,
          followup: d.followup, tools_used: d.tools_used,
          suggest_form: d.suggest_form, suggest_notifications: d.suggest_notifications,
          journey_callback: d.journey_callback,
          anniversary: d.anniversary,
          vitals_trend: d.vitals_trend,
          referral_consumed: d.referral_consumed,
          session_id: sessionId,
          intention: d.intention,
          was_regenerated: regenerateHint != null,
          sources: d.sources || [],
        }]);
        _finalize(d);
      }
      setStatus("idle");
    } catch { setStatus("error"); setErr("Network error."); }
    setProcessing(false);
  }

  async function saveNotifPrefs() {
    const channels = {};
    if (notifForm.whatsapp.trim()) channels.whatsapp = notifForm.whatsapp.trim();
    if (notifForm.telegram.trim()) channels.telegram = notifForm.telegram.trim();
    if (notifForm.email.trim()) channels.email = notifForm.email.trim();
    if (notifForm.sms.trim()) channels.sms = notifForm.sms.trim();
    if (notifForm.browser) channels.browser = true;
    if (Object.keys(channels).length === 0) {
      setErr("Please enable at least one channel.");
      return;
    }
    // If browser notifications picked, ask permission
    if (notifForm.browser && "Notification" in window) {
      try { await Notification.requestPermission(); } catch { /* ignore */ }
    }
    // Save locally
    localStorage.setItem("AMINA_NOTIF_PREFS", JSON.stringify(notifForm));
    setNotifSaved(true);
    // POST to backend (best-effort)
    try {
      await fetch(`${base.replace(/\/+$/, "")}/api/v1/agent/notifications/preferences`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, channels, frequency: notifForm.frequency }),
      });
    } catch { /* non-fatal */ }
    setShowNotifPrefs(false);
    // Confirmation message in chat
    const chans = Object.keys(channels).map((c) => c.charAt(0).toUpperCase() + c.slice(1)).join(", ");
    setMsgs((p) => [...p, {
      role: "assistant", time: timeNow(), isNew: false,
      content: `Done — I'll send your follow-up reminders via ${chans}. You can change this anytime in Settings.`,
    }]);
  }

  function skipNotifPrefs() {
    setShowNotifPrefs(false);
    // Remember they declined, so we don't ask again this browser session
    setNotifSaved(true);
  }

  // Supply stock-take: VHWs + clinicians.
  // Care path (dual-path) treatment planning: clinicians only — VHWs see
  // the card read-only. `admin` bypasses both gates (super-role, matches
  // care_routes.SUPPLY_WRITE_ROLES / CAREPATH_WRITE_ROLES).
  const canEditCare     = ["clinician", "vhw", "admin"].includes(userRole);
  const canEditCarePath = ["clinician",        "admin"].includes(userRole);

  async function generateDocument(docType = "consultation_summary") {
    if (msgs.length < 2) {
      setErr("Chat with Amina first so she has something to document.");
      return;
    }
    setDocLoading(true);
    setDocFeedback(null);
    try {
      const cached = await fetch(`${base.replace(/\/+$/, "")}/api/v1/agent/document/${sessionId}?doc_type=${encodeURIComponent(docType)}`, { credentials: "include" });
      if (cached.ok) {
        const c = await cached.json();
        if (c.exists && c.document) { setDocPreview(c.document); setDocLoading(false); return; }
      }
    } catch {}
    try {
      const r = await fetch(`${base.replace(/\/+$/, "")}/api/v1/agent/document/generate`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        // Pass the message list from local state as a fallback. The backend
        // primarily reads from Redis, but uses this when abuse-defense
        // short-circuits the agent (so the user-visible exchange never
        // got persisted) or when the session has expired.
        body: JSON.stringify({
          session_id: sessionId,
          doc_type: docType,
          format: "preview",
          language: language || "en",
          messages: (msgs || [])
            .filter((m) => m && m.content)
            .map((m) => ({ role: m.role || "user", content: m.content })),
        }),
      });
      if (r.ok) {
        const d = await r.json();
        setDocPreview(d);
      } else {
        const t = await r.text();
        setErr(t);
      }
    } catch (e) { setErr(String(e)); }
    setDocLoading(false);
  }

  async function downloadDoc(fmt) {
    if (!docPreview || docDownloading) return;
    setDocDownloading(fmt);
    const docType = docPreview.doc_type || "consultation_summary";
    const apiBase = base.replace(/\/+$/, "");
    try {
      let r = await fetch(`${apiBase}/api/v1/agent/document/${sessionId}/download/${fmt}?doc_type=${encodeURIComponent(docType)}&language=${encodeURIComponent(language || "en")}`, { credentials: "include" });
      if (r.status === 404) {
        r = await fetch(`${apiBase}/api/v1/agent/document/generate`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          // Pass local message state for the same reason as generateDocument:
          // abuse-defense responses never persist server-side.
          body: JSON.stringify({
            session_id: sessionId,
            doc_type: docType,
            format: fmt,
            language: language || "en",
            messages: (msgs || [])
              .filter((m) => m && m.content)
              .map((m) => ({ role: m.role || "user", content: m.content })),
          }),
        });
      }
      if (!r.ok) { setErr(`Download failed (${r.status})`); return; }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `amina_${docType}.${fmt}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { setErr(String(e)); } finally { setDocDownloading(null); }
  }

  // Download the raw chat transcript as a business-style PDF.
  // Triggered either by the explicit chat-export UI button or
  // automatically when the backend returns export_action from /agent/chat
  // (user typed "send me a pdf of our chat" or similar).
  async function downloadChatTranscript() {
    // Guard against double-click — second click is a no-op while the
    // first request is still in flight.
    if (pdfDownloading) return;
    if (!sessionId || msgs.length < 1) {
      setErr("No conversation to export yet. Chat with AMINA first.");
      return;
    }
    setPdfDownloading(true);
    try {
      const payload = {
        session_id:   sessionId,
        patient_name: authPatient?.name || "",
        language,
        messages: msgs.map(m => ({ role: m.role, content: m.content, ...(m.sources ? { sources: m.sources } : {}) })),
      };
      const r = await fetch(`${base.replace(/\/+$/, "")}/api/v1/agent/chat/export-pdf`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        let detail = "";
        try { const j = await r.json(); detail = j.detail || ""; } catch { /* not json */ }
        throw new Error(detail || `Server error (${r.status})`);
      }
      const blob = await r.blob();
      if (!blob || blob.size < 100) throw new Error("Empty PDF received");
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `amina_chat_${(sessionId || "transcript").slice(0, 16)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (e) {
      console.error("PDF export failed:", e);
      setErr(e.message || "Could not export the chat. Please try again.");
    } finally {
      // Always release the lock, even on error, so the user can retry.
      // Short delay so the spinner is visible even on instant cache hits.
      setTimeout(() => setPdfDownloading(false), 350);
    }
  }

  async function submitCommunityForm(endpoint, body) {
    setCareSaving(true);
    try {
      // Extract _method before sending — don't leak it to backend
      const method = body._method || "POST";
      const cleanBody = { ...body, role: userRole };
      delete cleanBody._method;

      const r = await fetch(`${base.replace(/\/+$/, "")}/api/v1/community/${endpoint}`, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cleanBody),
      });
      if (!r.ok) {
        const t = await r.text();
        setErr(typeof t === "string" && t.startsWith("{") ? JSON.parse(t).detail || t : t);
      } else {
        // Re-fetch community data to reflect changes, THEN close modal
        await fetchCommunity();
        setActivePanel(null);
        setCommunityForm({});
      }
    } catch (e) { setErr(String(e)); }
    setCareSaving(false);
  }

  async function openSupplyEdit() {
    try {
      const r = await fetch(`${base.replace(/\/+$/, "")}/api/v1/care/supply/${sessionId}`, { credentials: "include" });
      if (r.ok) {
        const d = await r.json();
        const med = (d.medications || [])[0] || {};
        setCareEditData({
          medication_name: med.name || "Amlodipine",
          tablets_remaining: med.tablets_remaining != null ? String(med.tablets_remaining) : "18",
          cost_per_pack: med.cost_per_pack || "20 dalasi / 30 tablets",
          refill_location: med.refill_location || "Kerewan clinic",
          in_stock: med.in_stock !== false,
        });
        setShowCareEdit("supply");
      } else {
        // Seed with defaults if API fails
        setCareEditData({
          medication_name: "Amlodipine", tablets_remaining: "18",
          cost_per_pack: "20 dalasi / 30 tablets", refill_location: "Kerewan clinic", in_stock: true,
        });
        setShowCareEdit("supply");
      }
    } catch {
      setCareEditData({
        medication_name: "Amlodipine", tablets_remaining: "18",
        cost_per_pack: "20 dalasi / 30 tablets", refill_location: "Kerewan clinic", in_stock: true,
      });
      setShowCareEdit("supply");
    }
  }

  async function openDualPathEdit() {
    // Default values in case API fails
    const defaults = {
      trad_practitioner: "Local marabout",
      trad_practices: "Prayers for wellbeing, Bitter leaf tea",
      trad_last_visit: "9", trad_notes: "",
      mod_facility: "Kerewan Health Centre", mod_chw: "VHW Mariama",
      mod_meds: "Amlodipine 5mg daily", mod_last_visit: "14", mod_notes: "",
      interaction_safe: true, interaction_notes: "Bitter leaf tea has no known interaction with amlodipine.",
      bp_current: "135/85", months_on_plan: "3",
    };
    try {
      const r = await fetch(`${base.replace(/\/+$/, "")}/api/v1/care/dualpath/${sessionId}`, { credentials: "include" });
      if (r.ok) {
        const d = await r.json();
        setCareEditData({
          trad_practitioner: d.traditional_care?.practitioner || defaults.trad_practitioner,
          trad_practices: Array.isArray(d.traditional_care?.practices) ? d.traditional_care.practices.join(", ") : defaults.trad_practices,
          trad_last_visit: String(d.traditional_care?.last_visit_days_ago ?? defaults.trad_last_visit),
          trad_notes: d.traditional_care?.notes || "",
          mod_facility: d.modern_care?.facility || defaults.mod_facility,
          mod_chw: d.modern_care?.chw_name || defaults.mod_chw,
          mod_meds: Array.isArray(d.modern_care?.medications) ? d.modern_care.medications.join(", ") : defaults.mod_meds,
          mod_last_visit: String(d.modern_care?.last_visit_days_ago ?? defaults.mod_last_visit),
          mod_notes: d.modern_care?.notes || "",
          interaction_safe: d.interactions_flag?.safe !== false,
          interaction_notes: d.interactions_flag?.notes || defaults.interaction_notes,
          bp_current: d.progress?.bp_current || defaults.bp_current,
          months_on_plan: String(d.progress?.months_on_plan ?? defaults.months_on_plan),
        });
      } else {
        setCareEditData(defaults);
      }
    } catch {
      setCareEditData(defaults);
    }
    setShowCareEdit("dualpath");
  }

  async function saveCareEdit() {
    setCareSaving(true);
    try {
      const b = base.replace(/\/+$/, "");
      // The backend resolves the EFFECTIVE role from the JWT, not the
      // body. Admin JWT lets `role` act as an impersonation hint;
      // non-admin JWTs can't self-promote via the body. Prefer the
      // dedicated admin token when present so admins keep their bypass
      // powers regardless of their currently-selected impersonated role.
      const careAuthHeaders = (() => {
        const tok = localStorage.getItem("AMINA_ADMIN_TOKEN")
                 || localStorage.getItem("AMINA_TOKEN")
                 || "";
        return tok ? { "Authorization": `Bearer ${tok}`, "Content-Type": "application/json" }
                   : { "Content-Type": "application/json" };
      })();
      if (showCareEdit === "supply") {
        const sr = await fetch(`${b}/api/v1/care/supply/${sessionId}`, {
          method: "PUT", credentials: "include",
          headers: careAuthHeaders,
          body: JSON.stringify({
            medication_name: careEditData.medication_name,
            tablets_remaining: parseInt(careEditData.tablets_remaining) || 0,
            cost_per_pack: careEditData.cost_per_pack,
            refill_location: careEditData.refill_location,
            in_stock: careEditData.in_stock,
            role: userRole,
          }),
        });
        if (!sr.ok) {
          const t = await sr.text();
          setErr("Supply save failed: " + t);
          setCareSaving(false);
          return;
        }
      } else if (showCareEdit === "dualpath") {
        // Dual-path treatment planning is clinician + admin only. Guard
        // client-side so VHWs (and any non-privileged role) get a clear
        // message without firing 4 silent 403s at the backend.
        if (!["clinician", "admin"].includes(userRole)) {
          setErr("Care path edits are locked to clinicians. Ask a clinician to update the treatment plan.");
          setCareSaving(false);
          return;
        }
        const dp = [
          {
            label: "traditional",
            url: `${b}/api/v1/care/dualpath/${sessionId}/traditional`,
            body: {
              practitioner: careEditData.trad_practitioner,
              practices: careEditData.trad_practices.split(",").map((s) => s.trim()).filter(Boolean),
              last_visit_days_ago: parseInt(careEditData.trad_last_visit) || 0,
              notes: careEditData.trad_notes,
              role: userRole,
            },
          },
          {
            label: "modern",
            url: `${b}/api/v1/care/dualpath/${sessionId}/modern`,
            body: {
              facility: careEditData.mod_facility,
              chw_name: careEditData.mod_chw,
              medications: careEditData.mod_meds.split(",").map((s) => s.trim()).filter(Boolean),
              last_visit_days_ago: parseInt(careEditData.mod_last_visit) || 0,
              notes: careEditData.mod_notes,
              role: userRole,
            },
          },
          {
            label: "interaction",
            url: `${b}/api/v1/care/dualpath/${sessionId}/interaction`,
            body: {
              safe: careEditData.interaction_safe,
              notes: careEditData.interaction_notes,
              role: userRole,
            },
          },
        ];
        if (careEditData.bp_current) {
          dp.push({
            label: "progress",
            url: `${b}/api/v1/care/dualpath/${sessionId}/progress`,
            body: {
              bp_current: careEditData.bp_current,
              months_on_plan: parseInt(careEditData.months_on_plan) || undefined,
              role: userRole,
            },
          });
        }
        // Serialize each PUT + check response. Bail on the FIRST failure
        // so the modal stays open (previously every PUT fired blindly and
        // silent 403s or 500s left the UI showing stale data after the
        // modal closed).
        for (const step of dp) {
          const r = await fetch(step.url, {
            method: "PUT", credentials: "include",
            headers: careAuthHeaders,
            body: JSON.stringify(step.body),
          });
          if (!r.ok) {
            const t = await r.text().catch(() => "");
            setErr(`Care path "${step.label}" save failed (${r.status}): ${t.slice(0, 200) || r.statusText}`);
            setCareSaving(false);
            return;
          }
        }
      }
      // Refresh community data — await so card updates before modal closes
      await fetchCommunity();
      setShowCareEdit(null);
    } catch (e) {
      setErr("Failed to save: " + String(e));
    }
    setCareSaving(false);
  }

  function regenerateFromIndex(assistantIdx, hint = null) {
    // Find the user message that prompted this assistant reply
    let userMsg = null;
    for (let i = assistantIdx - 1; i >= 0; i--) {
      if (msgs[i].role === "user") {
        userMsg = msgs[i].content;
        break;
      }
    }
    if (!userMsg || processing || rec) return;
    // Drop the assistant message being regenerated
    setMsgs((p) => p.slice(0, assistantIdx));
    setStatus("processing");
    // Fall back to any recent downvote if no explicit hint given
    const effectiveHint = hint || (
      window.__amina_last_downvote &&
      window.__amina_last_downvote.msgIndex === assistantIdx &&
      Date.now() - window.__amina_last_downvote.at < 60000
        ? window.__amina_last_downvote.reason
        : null
    );
    textChat(userMsg, effectiveHint);
  }

  function handleTag(tag) {
    audioOK = true;
    setMsgs([{ role: "user", content: tag.prompt, time: timeNow() }]);
    setStatus("processing");
    textChat(tag.prompt);
  }

  function sendTextMessage() {
    const text = chatInput.trim();
    if (!text || processing || rec) return;
    audioOK = true;
    setMsgs((p) => [...p, { role: "user", content: text, time: timeNow() }]);
    setChatInput("");
    setStatus("processing");
    textChat(text);
  }

  async function regenerateCarePlan() {
    if (msgs.length < 2) {
      setErr("Chat with Amina a bit first — she needs something to tailor to.");
      return;
    }
    setCarePlanLoading(true);
    setErr("");
    try {
      const r = await fetch(
        `${base.replace(/\/+$/, "")}/api/v1/agent/care-plan/${sessionId}/generate`,
        { method: "POST" },
      );
      if (r.ok) {
        const d = await r.json();
        if (d.plan) {
          setCarePlan(d.plan);
          localStorage.setItem("AMINA_CARE_PLAN", JSON.stringify(d.plan));
          setCarePlanOpen(true);
        }
      } else {
        const t = await r.text();
        setErr(`Care plan failed: ${t}`);
      }
    } catch {
      setErr("Could not generate care plan (network error).");
    }
    setCarePlanLoading(false);
  }

  async function loadExistingCarePlan() {
    try {
      const r = await fetch(`${base.replace(/\/+$/, "")}/api/v1/agent/care-plan/${sessionId}`);
      if (r.ok) {
        const d = await r.json();
        if (d.exists && d.plan) {
          setCarePlan(d.plan);
          localStorage.setItem("AMINA_CARE_PLAN", JSON.stringify(d.plan));
        }
      }
    } catch { /* silent */ }
  }

  useEffect(() => { loadExistingCarePlan(); }, [sessionId]);  // load cached plan for current session

  async function fetchNudge() {
    setNudgeLoading(true);
    try {
      const r = await fetch(`${base.replace(/\/+$/, "")}/api/v1/agent/nudge`);
      if (r.ok) {
        const d = await r.json();
        setDailyNudge(d);
      }
    } catch { /* silent */ }
    setNudgeLoading(false);
  }

  useEffect(() => { fetchNudge(); }, []);  // load one nudge on mount

  async function fetchCommunity() {
    setCommunityLoading(true);
    try {
      const sid = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : "";
      const tok = localStorage.getItem("AMINA_TOKEN") || "";
      const hdrs = tok ? { "Authorization": `Bearer ${tok}` } : {};
      const r = await fetch(`${base.replace(/\/+$/, "")}/api/v1/community/all${sid}`, { credentials: "include", headers: hdrs });
      if (r.ok) {
        const d = await r.json();
        setCommunity(d);
      }
    } catch { /* silent */ }
    setCommunityLoading(false);
  }

  useEffect(() => { fetchCommunity(); }, [authToken]);

  async function fetchScoutList() {
    try {
      const r = await fetch(`${base.replace(/\/+$/, "")}/api/v1/community/scouts`);
      if (r.ok) {
        const d = await r.json();
        setScoutList(d.scouts || []);
      }
    } catch { /* silent */ }
  }

  useEffect(() => {
    if (userRole === "vhw" || userRole === "scout") fetchScoutList();
  }, [userRole]);

  async function submitScoutApplication() {
    const age = parseInt(scoutApplyForm.age);
    if (!scoutApplyForm.name.trim()) { setErr("Name is required"); return; }
    if (!age || age < 1) { setErr("Please enter your age"); return; }
    if (age >= 25) { setScoutApplyResult({ ok: false, msg: "Youth scouts must be under 25 years old. You are not eligible." }); return; }
    if (age < 12) { setScoutApplyResult({ ok: false, msg: "You must be at least 12 years old to apply." }); return; }
    try {
      const r = await fetch(`${base.replace(/\/+$/, "")}/api/v1/community/scout/apply`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: scoutApplyForm.name, age, village: scoutApplyForm.village || "Kerewan", phone: scoutApplyForm.phone }),
      });
      if (r.ok) {
        const d = await r.json();
        setScoutApplyResult({ ok: true, msg: d.message || "Application submitted!" });
      } else {
        const t = await r.text();
        try { setScoutApplyResult({ ok: false, msg: JSON.parse(t).detail }); } catch { setScoutApplyResult({ ok: false, msg: t }); }
      }
    } catch (e) { setScoutApplyResult({ ok: false, msg: String(e) }); }
  }

  // ── Thread persistence: restore active thread on mount ──
  const _threadRestored = useRef(false);
  useEffect(() => {
    if (_threadRestored.current) return;
    _threadRestored.current = true;
    const activeId = getActiveThreadId();
    if (activeId) {
      const thread = getThread(activeId);
      if (thread && thread.messages && thread.messages.length > 0) {
        setMsgs(thread.messages.map((m) => ({ ...m, isNew: false })));
        if (activeId !== sessionId) {
          setSessionId(activeId);
          localStorage.setItem("AMINA_SID", activeId);
        }
        if (thread.triageLevel) setLastTriage(thread.triageLevel);
        return;
      }
    }
    // Fallback: warm-start from backend if no local thread
    (async () => {
      try {
        const r = await fetch(`${base.replace(/\/+$/, "")}/api/v1/agent/session/resume`, {
          credentials: "include",
        });
        if (!r.ok) return;
        const d = await r.json();
        if (d.session_id && d.session_id !== sessionId) {
          setSessionId(d.session_id);
        }
        if (!d.is_new && Array.isArray(d.messages) && d.messages.length > 0) {
          const restored = d.messages.map((m) => ({
            role: m.role,
            content: m.content,
            time: m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—",
            tools_used: m.tools_used || [],
            isNew: false,
          }));
          setMsgs(restored);
        }
        if (d.care_plan) {
          setCarePlan(d.care_plan);
          localStorage.setItem("AMINA_CARE_PLAN", JSON.stringify(d.care_plan));
        }
      } catch { /* silent */ }
    })();
  }, []);

  // ── Auto-save current thread + refresh sidebar in one atomic step ──
  useEffect(() => {
    if (msgs.length > 0 && sessionId) {
      saveThread(sessionId, msgs, lastTriage);
      setSidebarThreads(getThreads());
    }
  }, [msgs, sessionId, lastTriage]);

  // Keep reminders list in sync with FollowupBadge saves/removes
  useEffect(() => {
    const refresh = () => setReminders(loadReminders());
    window.addEventListener("amina-reminders-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("amina-reminders-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  function showNudgeInChat() {
    if (!dailyNudge) return;
    audioOK = true;
    const text = `${dailyNudge.title}: ${dailyNudge.action}\n\n${dailyNudge.why}`;
    setMsgs((p) => [...p, {
      role: "assistant", content: text, time: timeNow(), isNew: true,
      tools_used: ["get_lifestyle_nudge"],
    }]);
  }

  function submitSymptomForm() {
    const s = symptomForm;
    if (!s.main.trim()) { setErr("Please describe the main symptom."); return; }
    const parts = [`I have ${s.main.trim()}`];
    if (s.location.trim()) parts.push(`located at ${s.location.trim()}`);
    if (s.duration.trim()) parts.push(`for ${s.duration.trim()}`);
    parts.push(`severity ${s.severity}/10`);
    if (s.onset.trim()) parts.push(`started when ${s.onset.trim()}`);
    if (s.triggers.trim()) parts.push(`worse when ${s.triggers.trim()}`);
    if (s.relief.trim()) parts.push(`better when ${s.relief.trim()}`);
    if (s.associated.trim()) parts.push(`also feeling ${s.associated.trim()}`);
    if (s.tried.trim()) parts.push(`I have tried ${s.tried.trim()}`);
    const message = parts.join(", ") + ". Please assess this and tell me what to do.";
    setShowSymptomForm(false);
    setSymptomForm({ main: "", location: "", duration: "", severity: "5", onset: "", triggers: "", relief: "", associated: "", tried: "" });
    audioOK = true;
    setMsgs((p) => [...p, { role: "user", content: message, time: timeNow() }]);
    setStatus("processing");
    textChat(message);
  }

  // Detect short symptom mentions in chat input and suggest the form
  const SYMPTOM_TRIGGERS = useMemo(() => [
    "pain", "ache", "hurts", "hurting", "sore", "fever", "cough",
    "dizzy", "dizziness", "tired", "weak", "weakness", "nausea",
    "vomit", "swelling", "numb", "tingling", "itching", "rash",
    "bleeding", "short of breath", "headache", "stomach",
  ], []);
  const shouldSuggestForm = useMemo(() => {
    const t = chatInput.trim().toLowerCase();
    if (t.length < 4 || t.split(" ").length > 15) return false;
    if (window.AMINA_NEGATION) return window.AMINA_NEGATION.hasAffirmedSymptom(t, SYMPTOM_TRIGGERS);
    return SYMPTOM_TRIGGERS.some((k) => t.includes(k));
  }, [chatInput, SYMPTOM_TRIGGERS]);

  function submitRxForm() {
    const { name, dosage, frequency, duration, notes } = rxForm;
    if (!name.trim()) { setErr("Medication name is required."); return; }
    const parts = [`I was prescribed ${name.trim()}`];
    if (dosage.trim()) parts.push(dosage.trim());
    if (frequency.trim()) parts.push(frequency.trim());
    if (duration.trim()) parts.push(`for ${duration.trim()}`);
    if (notes.trim()) parts.push(`(${notes.trim()})`);
    const message = parts.join(" ") + ". Please tell me how to take it safely and any warnings I should know.";
    setShowRxHelper(false);
    setRxForm({ name: "", dosage: "", frequency: "", duration: "", notes: "" });
    audioOK = true;
    setMsgs((p) => [...p, { role: "user", content: message, time: timeNow() }]);
    setStatus("processing");
    textChat(message);
  }

  async function uploadPrescription(file) {
    if (!file) return;
    audioOK = true;
    setErr("");
    setUploadingRx(true);
    setStatus("processing");

    // Show an immediate "user uploaded" bubble
    setMsgs((p) => [...p, {
      role: "user",
      content: `📎 Uploaded prescription: ${file.name}`,
      time: timeNow(),
    }]);

    try {
      const form = new FormData();
      form.append("file", file, file.name);
      form.append("session_id", sessionId);
      form.append("language", language);

      const r = await fetch(`${base.replace(/\/+$/, "")}/api/v1/agent/prescription`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const txt = await r.text();
      if (!r.ok) {
        setStatus("error");
        setErr(`Upload failed (${r.status}): ${txt}`);
        setUploadingRx(false);
        return;
      }
      const d = JSON.parse(txt);

      if (!d.is_prescription) {
        const reason = d.reason || "This does not look like a prescription.";
        setMsgs((p) => [...p, {
          role: "assistant",
          content: `I couldn't read this as a prescription. ${reason}\n\nPlease try again with a clearer photo of the prescription.`,
          time: timeNow(),
          isNew: true,
        }]);
      } else {
        const medLines = (d.medication_summary || []).map((m) => `• ${m}`).join("\n");
        const langNote = d.detected_language === "ma" ? "(Prescription read in Mandinka)\n" : "";
        const header = medLines ? `${langNote}Prescription received:\n${medLines}\n\n` : langNote;
        setMsgs((p) => [...p, {
          role: "assistant",
          content: header + (d.guidance || ""),
          // Match textChat — content language, not UI mode.
          source_language: d.detected_language === "ma" ? "ma" : "en",
          time: timeNow(),
          isNew: true,
          tools_used: ["analyze_prescription"],
        }]);
        // If Rx was Mandinka and UI is English, offer to switch
        if (d.suggest_language_switch === "ma" && !langPromptShown && language !== "ma") {
          setTimeout(() => setShowLangPrompt(true), 700);
          setLangPromptShown(true);
        }
      }
      setStatus("idle");
    } catch {
      setStatus("error");
      setErr("Network error uploading prescription.");
    }
    setUploadingRx(false);
  }

  function onRxFilePick(e) {
    const f = e.target.files?.[0];
    if (f) uploadPrescription(f);
    e.target.value = "";  // allow re-upload of same file
  }

  const doStop = useCallback(() => { if (!recorderRef.current) return; setStatus("processing"); recorderRef.current.stop(); }, []);

  const startRecording = useCallback(async () => {
    audioOK = true;
    setErr("");
    setLive("");
    setStatus("listening");
    stoppedRef.current = false;

    try {
      const mime = pickMimeType();
      mimeRef.current = mime;

      const constraints = selectedDevice
        ? { deviceId: { exact: selectedDevice }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        : { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: constraints }); }
      catch { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }

      const ac = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = ac;
      const src = ac.createMediaStreamSource(stream);
      const analyser = ac.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;
      src.connect(analyser);
      setMicAn(analyser);

      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => { if (e.data?.size > 0) chunksRef.current.push(e.data); };

      recorder.onstart = () => {
        setRec(true);
        startTimer();
        // Recording safety guards (fixes runaway buffer that blew up STT):
        //   - HARD_CAP_MS  : auto-stop after 5 min so onstop blob stays sane
        //   - PARTIAL_WIN  : partial transcripts use only last 10s of audio
        //   - in-flight    : skip new partial if previous is still processing
        const recStart = Date.now();
        const HARD_CAP_MS = 5 * 60 * 1000;
        const PARTIAL_WIN_CHUNKS = Math.max(1, Math.ceil(10_000 / 500));  // ~10s @ 500ms slices
        let partialInFlight = false;
        const iv = setInterval(async () => {
          // Hard cap: stop the recorder if we've gone past 5 min
          if (Date.now() - recStart >= HARD_CAP_MS) {
            if (!stoppedRef.current && recorderRef.current?.state === "recording") {
              stoppedRef.current = true;
              doStop();
            }
            return;
          }
          if (partialInFlight) return;
          if (!chunksRef.current.length) return;
          // Sliding window: only send the last ~10s, not the full buffer
          const recent = chunksRef.current.slice(-PARTIAL_WIN_CHUNKS);
          partialInFlight = true;
          setTranscribing(true);
          try {
            const t = await sttCall(new Blob([...recent], { type: mime || "application/octet-stream" }), mime);
            if (t) setLive(t);
          } catch { /* swallow -- partial is best-effort */ }
          finally {
            setTranscribing(false);
            partialInFlight = false;
          }
        }, 3000);
        recorder._iv = iv;

        if (autoStop) {
          startVAD(analyser, () => {
            if (!stoppedRef.current && recorderRef.current?.state === "recording") { stoppedRef.current = true; doStop(); }
          });
        }
      };

      recorder.onstop = async () => {
        stopTimer();
        stopVAD();
        setRec(false);
        setMicAn(null);
        if (recorder._iv) clearInterval(recorder._iv);
        stream.getTracks().forEach((t) => t.stop());
        if (audioCtxRef.current) { audioCtxRef.current.close(); audioCtxRef.current = null; }

        const blob = new Blob(chunksRef.current, { type: mime || "application/octet-stream" });
        setProcessing(true);
        setStatus("processing");
        setTranscribing(true);

        const transcript = await sttCall(blob, mime);
        setTranscribing(false);

        if (transcript) {
          setLive(transcript);
          setMsgs((p) => [...p, { role: "user", content: transcript, time: timeNow() }]);
          await voiceChat(blob, mime);
        } else { setProcessing(false); setStatus("idle"); setLive(""); }
      };

      recorder.start(500);
    } catch { setRec(false); setStatus("error"); setErr("Mic permission denied."); }
  }, [base, selectedDevice, autoStop, doStop]);

  const stopRecording = useCallback(() => { stoppedRef.current = true; doStop(); }, [doStop]);

  // OLD voiceChat (RAG-only, kept for reference):
  // async function voiceChat(blob, mime) {
  //   const form = new FormData();
  //   form.append("file", blob, `mic.${ext}`);
  //   form.append("history", JSON.stringify(buildHistory()));
  //   const r = await fetch(`${base.replace(/\/+$/, "")}/api/v1/voice-chat`, { method: "POST", body: form });
  //   const d = JSON.parse(await r.text());
  //   if (d.answer) setMsgs((p) => [...p, { role: "assistant", content: d.answer, time: timeNow(), isNew: true }]);
  // }

  async function voiceChat(blob, mime) {
    setProcessing(true);
    setErr("");
    setLive("");

    let ext = "bin";
    if ((mime || "").includes("webm")) ext = "webm";
    else if ((mime || "").includes("ogg")) ext = "ogg";

    const form = new FormData();
    form.append("file", blob, `mic.${ext}`);
    form.append("session_id", sessionId);

    try {
      const r = await fetch(`${base.replace(/\/+$/, "")}/api/v1/agent/voice-chat`, { method: "POST", body: form });
      const t = await r.text();
      if (!r.ok) { setStatus("error"); setErr(`Error (${r.status}): ${t}`); setProcessing(false); return; }
      const d = JSON.parse(t);
      if (d.response) {
        setMsgs((p) => [...p, {
          role: "assistant", content: d.response, time: timeNow(), isNew: true,
          triage_level: d.triage_level, is_emergency: d.is_emergency,
          followup: d.followup, tools_used: d.tools_used,
        }]);
        if (d.triage_level) setLastTriage(d.triage_level);
      }
      setStatus("idle");
    } catch { setStatus("error"); setErr("Network error."); }
    setProcessing(false);
  }

  async function checkHealth() {
    setErr("");
    setHealth(null);
    try {
      const r = await fetch(`${base.replace(/\/+$/, "")}/health`);
      if (!r.ok) throw 0;
      setHealth(true);
    } catch { setHealth(false); setErr("Health check failed."); }
  }

  function clearChat() {
    // End the current agent session (fire-and-forget) — the backend
    // drops Redis session state + fires analytics/audit events. Running
    // before we mint the new session_id means the old session closes
    // cleanly.
    fetch(`${base.replace(/\/+$/, "")}/api/v1/agent/session/${sessionId}/end`, { method: "POST" }).catch(() => {});
    setMsgs([]); setLive(""); setErr(""); setStatus("idle"); setLastTriage(null);
    setFreedOffset(0);
    setSessionId(genSessionId());
    // Phase D.5 — clear any abuse-defense session lock so the new
    // conversation starts unlocked.
    setAbuseLock({ active: false, kind: null, duration: null, since: 0 });
    // Reset any in-flight confirm + cancel the pending timer so the
    // Clear button returns to its resting state immediately.
    setClearPending(false);
    try { clearTimeout(clearPendingTimerRef.current); } catch { /* noop */ }
    clearPendingTimerRef.current = null;
  }

  // Two-click destructive-action gate — inspired by Gmail's "Undo
  // send" bar. First invocation primes a 3-second confirm window; the
  // second click within that window actually runs clearChat(). Keeps
  // the UX unobtrusive (no modal) while preventing single-click
  // accidents that vaporise the whole thread.
  function handleClearClick() {
    if (msgs.length === 0 && !live && !err) {
      // Nothing to clear — skip straight past the confirm and just
      // mint a fresh session so the user's next message starts clean.
      clearChat();
      setModelSwitchNotice("New chat started");
      setTimeout(() => setModelSwitchNotice(""), 1800);
      return;
    }
    if (!clearPending) {
      setClearPending(true);
      setModelSwitchNotice("Click again to clear conversation");
      try { clearTimeout(clearPendingTimerRef.current); } catch { /* noop */ }
      clearPendingTimerRef.current = setTimeout(() => {
        setClearPending(false);
        setModelSwitchNotice("");
      }, 3000);
      return;
    }
    const droppedCount = msgs.length;
    clearChat();
    setModelSwitchNotice(
      `Cleared ${droppedCount} message${droppedCount === 1 ? "" : "s"} · new session`,
    );
    setTimeout(() => setModelSwitchNotice(""), 2600);
  }

  useEffect(() => {
    const handler = (e) => {
      // Skip when typing in any input/textarea or when the modal is open
      const t = e.target;
      const isTyping = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (isTyping || showRxHelper || showSymptomForm) return;
      if (e.code === "Space" && t === document.body) {
        e.preventDefault();
        if (rec) stopRecording();
        else startRecording();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [rec, startRecording, stopRecording, showRxHelper, showSymptomForm]);

  const statusColor = { idle: "#64748b", listening: "#818cf8", processing: "#eab308", error: "#ef4444" }[status] || "#64748b";
  const hasContent = msgs.length > 0 || rec || processing;

  const [sidebarThreads, setSidebarThreads] = useState(() => getThreads());

  const [sidebarOpen, setSidebarOpen] = useState(true);

  // ── Admin dashboard check ──
  const [isAdmin, setIsAdmin] = useState(() => localStorage.getItem("AMINA_ADMIN") === "true");
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem("AMINA_ADMIN_TOKEN") || null);

  // ── Caregiver directory overlay ──
  const [showCgDirectory, setShowCgDirectory] = useState(false);

  // ── Privacy & Data overlay (DHIS2 consent + referrals) ──
  const [showPrivacyPanel, setShowPrivacyPanel] = useState(false);

  // ── Caregiver role check ──
  const [isCaregiverMode, setIsCaregiverMode] = useState(() => {
    const tok = localStorage.getItem("cg_token");
    if (!tok) return false;
    try {
      const payload = JSON.parse(atob(tok.split(".")[1]));
      return payload.role === "caregiver" && payload.exp * 1000 > Date.now();
    } catch { return false; }
  });

  const handleCaregiverLogin = () => setIsCaregiverMode(true);
  const handleCaregiverLogout = () => {
    setIsCaregiverMode(false);
    localStorage.removeItem("cg_token");
    localStorage.removeItem("cg_info");
    localStorage.setItem("AMINA_ROLE", "patient");
    try { window.dispatchEvent(new CustomEvent("amina:role-changed", { detail: { role: "patient" } })); } catch {}
  };

  // ── Patient alert notifications ──
  const [emergencyAlert, setEmergencyAlert] = useState(null);   // { message, from_caregiver }
  const [toastAlerts, setToastAlerts]       = useState([]);     // [{ id, message, severity, from_caregiver }]

  // Track which alert_ids we've already surfaced so successive
  // ?clear=false polls don't re-fire the same toast/overlay every 10s.
  const seenAlertIdsRef = useRef(new Set());

  useEffect(() => {
    // Run whenever a patient session is active. Don't gate on
    // isCaregiverMode - if cg_token lingers in localStorage from an
    // unclean logout, this useEffect would never start, and a real
    // patient logged into this tab would silently miss every caregiver
    // alert. The render path below already routes caregiver mode to the
    // CaregiverPortal, so this hook only ever paints alerts on the
    // patient-rendered view.
    if (!authToken || !authPatient) return;
    const API_BASE = window.AMINA_API || "http://localhost:8000";

    // IMPORTANT: poll with clear=false. The previous clear=true behaviour
    // consumed the alert on the first poll - so if the patient's tab was
    // open and polling silently for the 10s before they looked at it,
    // the alert flashed through a 8s toast and was gone. With clear=false
    // the alert persists in redis, the toast keeps showing on every poll
    // (deduped by alert_id), and we explicitly POST /alerts/read when
    // the user dismisses or acknowledges. Any inbox/bell consumer can
    // also mirror these into a persistent record.
    const poll = async () => {
      try {
        const r = await fetch(`${API_BASE}/api/v1/patient/alerts/pending?clear=false`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!r.ok) return;
        const data = await r.json();
        if (!data.alerts?.length) return;

        for (const alert of data.alerts) {
          const aid = alert.alert_id;
          if (!aid || seenAlertIdsRef.current.has(aid)) continue;
          seenAlertIdsRef.current.add(aid);
          // eslint-disable-next-line no-console
          console.log("[AMINA] caregiver alert received:", aid, alert.severity, alert.from_caregiver, alert.message);
          if (alert.severity === "emergency") {
            setEmergencyAlert(alert);
          } else {
            const id = `${Date.now()}_${Math.random()}`;
            setToastAlerts(prev => [...prev, { ...alert, id }]);
            // Long-lived toast - user will see it across tab-switches.
            setTimeout(() => setToastAlerts(prev => prev.filter(t => t.id !== id)), 60000);
          }
        }
      } catch (e) { /* silent */ }
    };

    poll(); // immediate first poll
    const interval = setInterval(poll, 10000);
    return () => clearInterval(interval);
  }, [authToken, authPatient]);

  // Acknowledge alerts on the server (clears redis queue) when the
  // patient dismisses the emergency overlay or closes a toast. This
  // is the only path that drains the queue now that polling is
  // non-destructive - so future polls stop re-firing this alert.
  const acknowledgeAlerts = useCallback(async () => {
    if (!authToken) return;
    const API_BASE = window.AMINA_API || "http://localhost:8000";
    try {
      await fetch(`${API_BASE}/api/v1/patient/alerts/read`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      });
    } catch { /* silent */ }
  }, [authToken]);

  // ── Auth gate ──
  if (!authToken || !authPatient) {
    // Caregiver already logged in
    if (isCaregiverMode) {
      return <CaregiverPortal onLogout={handleCaregiverLogout} />;
    }
    // Admin already logged in
    if (isAdmin && adminToken) {
      return <AdminDashboard token={adminToken} onLogout={() => {
        setIsAdmin(false); setAdminToken(null);
        localStorage.removeItem("AMINA_ADMIN"); localStorage.removeItem("AMINA_ADMIN_TOKEN");
      }} />;
    }
    // Old AuthScreen disabled — route to new LoginPage via AppRouter.
    // AuthScreen component + import kept for reference but never rendered.
    if (typeof window !== "undefined" && !window.location.hash.startsWith("#/login")) {
      window.location.hash = "#/login";
    }
    return null;
  }

  // If caregiver is logged in, show caregiver portal
  if (isCaregiverMode) {
    return <CaregiverPortal onLogout={handleCaregiverLogout} />;
  }

  // If admin is logged in, show admin dashboard
  if (isAdmin && adminToken) {
    return <AdminDashboard token={adminToken} onLogout={() => {
      setIsAdmin(false); setAdminToken(null);
      localStorage.removeItem("AMINA_ADMIN"); localStorage.removeItem("AMINA_ADMIN_TOKEN");
    }} />;
  }

  return (
    <div className={`page ${sidebarOpen ? "" : "sidebar-hidden"}`}>
      <div className="bg-grid" />
      <div className="orb orb1" />
      <div className="orb orb2" />

      {/* ── Emergency Alert Overlay ── */}
      {emergencyAlert && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(185,28,28,0.97)",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          padding: 32, textAlign: "center",
          animation: "pulse 1.5s infinite",
        }}>
          <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.85} }`}</style>
          <div style={{ fontSize: 72, marginBottom: 16 }}>🚨</div>
          <div style={{ color: "#fff", fontSize: 28, fontWeight: 800, marginBottom: 12 }}>
            EMERGENCY ALERT
          </div>
          <div style={{ color: "#fca5a5", fontSize: 16, marginBottom: 8, fontWeight: 600 }}>
            From your caregiver: {emergencyAlert.from_caregiver}
          </div>
          <div style={{
            background: "rgba(0,0,0,.3)", borderRadius: 12,
            padding: "20px 28px", maxWidth: 480, marginBottom: 28,
            color: "#fff", fontSize: 17, lineHeight: 1.6,
          }}>
            {emergencyAlert.message}
          </div>
          <div style={{ color: "#fca5a5", fontSize: 14, marginBottom: 28 }}>
            ⚕️ Please respond immediately or contact emergency services.
          </div>
          <div style={{ display: "flex", gap: 14 }}>
            <a
              href="tel:112"
              style={{
                padding: "14px 28px", borderRadius: 10, background: "#fff",
                color: "#b91c1c", fontWeight: 800, fontSize: 16,
                textDecoration: "none",
              }}
            >
              📞 Call Emergency (112)
            </a>
            <button
              onClick={() => { setEmergencyAlert(null); acknowledgeAlerts(); }}
              style={{
                padding: "14px 28px", borderRadius: 10, background: "rgba(255,255,255,.2)",
                color: "#fff", fontWeight: 700, fontSize: 16, border: "2px solid rgba(255,255,255,.4)",
                cursor: "pointer",
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* ── Alert Toasts (top-center, max z-index so no shell can cover them) ── */}
      {toastAlerts.length > 0 && (
        <div style={{
          position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)",
          zIndex: 2147483646,    // one below browser-reserved max
          display: "flex", flexDirection: "column", gap: 10,
          width: "min(560px, calc(100vw - 32px))",
          pointerEvents: "auto",
        }}>
          {toastAlerts.map(t => (
            <div key={t.id} style={{
              background: t.severity === "warning"
                ? "linear-gradient(135deg, #b45309 0%, #92400e 100%)"
                : "linear-gradient(135deg, #1e40af 0%, #1e3a5f 100%)",
              color: "#fff", borderRadius: 14,
              padding: "16px 18px",
              boxShadow: "0 12px 36px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.12)",
              display: "flex", gap: 14, alignItems: "flex-start",
              animation: "aminaAlertSlideIn .35s ease",
              border: t.severity === "warning"
                ? "2px solid rgba(251,191,36,.55)"
                : "2px solid rgba(96,165,250,.45)",
            }}>
              <style>{`
                @keyframes aminaAlertSlideIn {
                  from { transform: translateY(-32px); opacity: 0; }
                  to   { transform: none;             opacity: 1; }
                }
              `}</style>
              <span style={{ fontSize: 28, flexShrink: 0, lineHeight: 1 }}>
                {t.severity === "warning" ? "⚠️" : "💬"}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontWeight: 800, fontSize: 11, letterSpacing: ".12em",
                  textTransform: "uppercase", opacity: 0.9, marginBottom: 4,
                }}>
                  {t.severity === "warning" ? "Health alert" : "New message"} · {t.from_caregiver}
                </div>
                <div style={{ fontSize: 15, lineHeight: 1.45, fontWeight: 500 }}>
                  {t.message}
                </div>
              </div>
              <button
                onClick={() => {
                  setToastAlerts(prev => prev.filter(x => x.id !== t.id));
                  acknowledgeAlerts();
                }}
                aria-label="Dismiss alert"
                style={{
                  background: "rgba(255,255,255,.18)", border: "none",
                  color: "#fff", cursor: "pointer",
                  width: 30, height: 30, borderRadius: "50%",
                  fontSize: 18, lineHeight: 1, padding: 0, flexShrink: 0,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Caregiver directory overlay */}
      {showCgDirectory && (
        <CaregiverDirectory
          token={authToken}
          patient={authPatient}
          onClose={() => setShowCgDirectory(false)}
        />
      )}

      {/* Privacy & Data overlay */}
      {showPrivacyPanel && (
        <PrivacyPanel
          token={authToken}
          patient={authPatient}
          onClose={() => setShowPrivacyPanel(false)}
        />
      )}

      {/* Patient sidebar — conversation history + profile */}
      <PatientSidebar
        patient={authPatient}
        token={authToken}
        sessionId={sessionId}
        collapsed={!sidebarOpen}
        threads={sidebarThreads}
        onToggle={() => setSidebarOpen(prev => !prev)}
        onLogout={handleLogout}
        onFindCaregiver={() => setShowCgDirectory(true)}
        onOpenPrivacy={() => setShowPrivacyPanel(true)}
        onNewChat={() => {
          if (msgs.length > 0) saveThread(sessionId, msgs, lastTriage);
          fetch(`${base.replace(/\/+$/, "")}/api/v1/agent/session/${sessionId}/end`, { method: "POST" }).catch(() => {});
          setMsgs([]); setLive(""); setErr(""); setStatus("idle"); setLastTriage(null);
          // Phase D.5 — sidebar New Chat also clears any abuse lock.
          setAbuseLock({ active: false, kind: null, duration: null, since: 0 });
          const newSid = `s_${authPatient.id}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
          setSessionId(newSid);
          localStorage.setItem("AMINA_SID", newSid);
          setActiveThreadId(newSid);
          setSidebarThreads(getThreads());
          fetch(`${base.replace(/\/+$/, "")}/api/v1/agent/patients/${authPatient.id}/start-session`, { method: "POST" }).catch(() => {});
        }}
        onSwitchThread={(thread) => {
          if (!thread || thread.sessionId === sessionId) return;
          if (msgs.length > 0) saveThread(sessionId, msgs, lastTriage);
          const restored = (thread.messages || []).map((m) => ({ ...m, isNew: false }));
          setMsgs(restored);
          setLive(""); setErr(""); setStatus("idle");
          setLastTriage(thread.triageLevel || null);
          setSessionId(thread.sessionId);
          localStorage.setItem("AMINA_SID", thread.sessionId);
          setActiveThreadId(thread.sessionId);
          setSidebarThreads(getThreads());
          setSidebarOpen(false);
        }}
        onDeleteThread={(threadSessionId) => {
          if (threadSessionId === sessionId) return;
          const remaining = deleteThread(threadSessionId);
          setSidebarThreads(remaining);
        }}
      />

      <div className="layout">
        {/* Header */}
        <header className="header">
          <div className="header-inner">
            <div className="brand">
              <div className="brand-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l3-9 4 18 3-9h4"/></svg></div>
              <div className="brand-text">
                <span className="brand-name">Amina</span>
                <span className="brand-status">
                  <i className="status-dot" style={{ background: avatarSpeaking ? "#818cf8" : rec ? "#34d399" : processing ? "#eab308" : "#22c55e" }} />
                  {avatarSpeaking ? "Speaking" : rec ? "Listening" : processing ? "Thinking" : "Online"}
                </span>
              </div>
            </div>
            <div className="header-actions">
              {userRole && userRole !== "patient" && (
                <span className={`role-badge role-badge-${userRole}`} title={`You are acting as ${userRole}`}>
                  {userRole === "clinician" && "🩺 Clinician"}
                  {userRole === "alkalo" && "⚖ Alkalo"}
                  {userRole === "vhw" && "⚕ VHW"}
                  {userRole === "imam" && "☪ Imam"}
                  {userRole === "scout" && "🏅 Scout"}
                </span>
              )}
              {anonymous && (
                <span className="anon-badge" title="Anonymous mode is on — no phone or ID is sent.">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  Anonymous
                </span>
              )}
              <button onClick={clearChat} className="header-btn" title="New Chat">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
              </button>
              <button onClick={() => setShowSettings(!showSettings)} className="header-btn">{showSettings ? "✕" : "⚙"}</button>
            </div>
          </div>
        </header>

        {/* Settings */}
        {showSettings && (
          <div className="settings-wrap">
            <div className="settings">
              <label className="settings-label">Gateway URL</label>
              <div className="settings-row">
                <input value={base} onChange={(e) => setBase(e.target.value)} className="settings-input" />
                <button onClick={checkHealth} className="settings-btn">{health === true ? "✓" : health === false ? "✕" : "Test"}</button>
              </div>
              <div className="settings-section">
                <label className="settings-label">Microphone</label>
                <div className="settings-row">
                  <div className="select-wrap">
                    <select value={selectedDevice} onChange={(e) => setSelectedDevice(e.target.value)} className="settings-input settings-select" disabled={rec || processing || micOk !== "granted" || devices.length === 0}>
                      {devices.length === 0 ? (
                        <option value="">{micOk !== "granted" ? "Permission required" : "No microphones"}</option>
                      ) : devices.map((d, i) => (
                        <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>
                      ))}
                    </select>
                    <span className="select-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg></span>
                  </div>
                  <button onClick={enumDevices} className="settings-btn" disabled={rec || processing}>Refresh</button>
                </div>
              </div>
              <Toggle label="Auto-stop on silence" on={autoStop} flip={() => setAutoStop(!autoStop)} />
              <Toggle label="Auto-speak responses" on={autoSpeak} flip={() => setAutoSpeak(!autoSpeak)} />
              <Toggle label="Anonymous mode" on={anonymous} flip={() => setAnonymous(!anonymous)} />
              <div className="settings-section">
                <label className="settings-label">I am a...</label>
                <div className="role-picker">
                  {[
                    { id: "patient", label: "Patient", icon: "👤" },
                    { id: "clinician", label: "Clinician", icon: "🩺" },
                    { id: "vhw", label: "VHW", icon: "⚕" },
                    { id: "alkalo", label: "Alkalo", icon: "⚖" },
                    { id: "imam", label: "Imam", icon: "☪" },
                    { id: "scout", label: "Scout", icon: "🏅" },
                  ].map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className={`role-pick-btn ${userRole === r.id ? "role-pick-active" : ""}`}
                      onClick={() => setUserRole(r.id)}
                    >
                      <span className="role-pick-icon">{r.icon}</span>
                      <span>{r.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-section">
                <label className="settings-label">Follow-up notifications</label>
                <button
                  className="settings-btn"
                  style={{ width: "100%", justifyContent: "center" }}
                  onClick={() => { setShowNotifPrefs(true); setShowSettings(false); }}
                >
                  {notifSaved ? "Manage notification channels" : "Set up notifications"}
                </button>
              </div>
              {anonymous && (
                <div className="anon-hint">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  <span>No phone or ID is sent. Your chat stays anonymous.</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Main Content — 3-column dashboard */}
        <div className="main">
          <div className="dashboard">
            {/* LEFT SIDEBAR — Community */}
            <aside className="sidebar sidebar-left">
              <div className="sidebar-head">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                <span>COMMUNITY</span>
              </div>
              {community?.my_circle && <MyCircleCard data={community.my_circle} onOpen={() => setActivePanel("my_circle")} />}
              <BantabaCard data={community?.bantaba} onOpen={() => setActivePanel("bantaba")} canEdit={["vhw","clinician","alkalo"].includes(userRole)} onEdit={() => setActivePanel("edit_bantaba")} />
              <VillageCard data={community?.village} onOpen={() => setActivePanel("village")} canEdit={["vhw","alkalo"].includes(userRole)} onEdit={() => setActivePanel("edit_village")} />
              <ScoutCard data={community?.scout} onOpen={() => setActivePanel("scout")} canEdit={["vhw","clinician"].includes(userRole)} onEdit={() => setActivePanel("edit_scout")} scoutList={scoutList} activeScoutId={activeScoutId} onSwitchScout={(sid) => { setActiveScoutId(sid); fetchCommunity(); }} isScoutRole={userRole === "scout"} />
            </aside>

            {/* CENTER — chat / welcome */}
            <div className="center">
          {!hasContent ? (
            <div className="welcome">
              <div className="welcome-section">
                <div className="avatar-wrapper">
                  <AvatarPlaceholder size={170} isSpeaking={avatarSpeaking} audioAnalyser={ttsAnalyser} />
                </div>
              </div>

              <div className="welcome-section"><span className="badge"><i className="badge-dot" />AI Health Assistant</span></div>
              <div className="welcome-section"><h1 className="title">Hi, I'm <span className="highlight">Amina</span> <span className="wave">👋</span></h1></div>
              <div className="welcome-section"><p className="description">{WELCOME}</p></div>
              <div className="welcome-section"><Spk text={INTRO + " " + WELCOME} base={base} onSS={onSpeakStart} onSE={onSpeakEnd} label={t("listen_intro")} lang={language} /></div>

              {/* Quick-action tiles: Care Plan + Notifications + Scout (unified) */}
              <div className="welcome-section">
                <div className="quick-tiles">
                  <button
                    className={`quick-tile quick-tile-plan ${carePlan ? "quick-tile-has-data" : ""}`}
                    onClick={() => carePlan ? setCarePlanOpen(true) : regenerateCarePlan()}
                    disabled={carePlanLoading}
                  >
                    <div className="quick-tile-icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/><line x1="9" y1="9" x2="10" y2="9"/></svg>
                    </div>
                    <div className="quick-tile-body">
                      <div className="quick-tile-title">My Care Plan</div>
                      <div className="quick-tile-sub">
                        {carePlanLoading ? "Generating…" : carePlan ? "View your personalised plan" : "Amina builds it from our chat"}
                      </div>
                    </div>
                    <svg className="quick-tile-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                  </button>

                  <button
                    className={`quick-tile quick-tile-notif ${notifSaved ? "quick-tile-has-data" : ""}`}
                    onClick={() => setShowNotifPrefs(true)}
                  >
                    <div className="quick-tile-icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                    </div>
                    <div className="quick-tile-body">
                      <div className="quick-tile-title">{notifSaved ? "Notifications" : "Setup Notifications"}</div>
                      <div className="quick-tile-sub">
                        {notifSaved ? "Tap to manage channels" : "WhatsApp, Telegram, SMS, Email"}
                      </div>
                    </div>
                    <svg className="quick-tile-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                  </button>

                  {userRole === "patient" && (
                    <button className="quick-tile quick-tile-scout-apply" onClick={() => setShowScoutApply(true)}>
                      <div className="quick-tile-icon" style={{ background: "rgba(245,158,11,0.14)", color: "#fcd34d" }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                      </div>
                      <div className="quick-tile-body">
                        <div className="quick-tile-title">Become a Health Scout</div>
                        <div className="quick-tile-sub">Youth under 25 can monitor elders' health</div>
                      </div>
                      <svg className="quick-tile-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                    </button>
                  )}
                </div>
              </div>

              {reminders.length > 0 && (
                <div className="welcome-section">
                  <div className="reminders-strip">
                    <div className="reminders-head">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                      <span>Upcoming check-ins</span>
                      <span className="reminders-count">{reminders.length}</span>
                    </div>
                    <div className="reminders-list">
                      {reminders.slice(0, 3).map((r, i) => (
                        <div key={i} className="reminder-row">
                          <span className="reminder-when">{formatFollowupDisplay(r.when)}</span>
                          <span className="reminder-note">{r.note}</span>
                          <button
                            className="reminder-remove"
                            onClick={() => removeReminder(r.when, r.note)}
                            title="Remove reminder"
                          >✕</button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {dailyNudge && (
                <div className="welcome-section">
                  <div className="nudge-card" onClick={showNudgeInChat} title="Tap to open in chat">
                    <div className="nudge-header">
                      <div className="nudge-badge">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                        <span>{dailyNudge.weekday || "TODAY"}'S SWAP</span>
                      </div>
                      {dailyNudge.focus_label && (
                        <span className="nudge-focus-chip" title="How this was chosen">{dailyNudge.focus_label}</span>
                      )}
                    </div>
                    <div className="nudge-title">{dailyNudge.title}</div>
                    <div className="nudge-action">{dailyNudge.action}</div>
                    <div className="nudge-why">{dailyNudge.why}</div>
                    {dailyNudge.selection_reason && (
                      <div className="nudge-reason">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                        <span>{dailyNudge.selection_reason}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="welcome-section"><div className="divider"><span>{t("or_topic")}</span></div></div>
              <div className="welcome-section">
                <div className="tags">{TAGS.map((t) => <button key={t.label} onClick={() => handleTag(t)} className="tag">{t.label}</button>)}</div>
              </div>
              <div className="welcome-section">
                <div className="hint">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M12 1a4 4 0 00-4 4v7a4 4 0 008 0V5a4 4 0 00-4-4z" /><path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" /></svg>
                  <span>{t("press_space")}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="chat-container">
              <div className="chat">
                <div className="chat-header">
                  <button
                    onClick={clearChat}
                    className="chat-back-btn"
                    title="Back to home (ends this session)"
                    disabled={rec || processing}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
                    <span>{t("home")}</span>
                  </button>
                  <div className="chat-avatar">
                    <AvatarPlaceholder size={44} isSpeaking={avatarSpeaking} audioAnalyser={ttsAnalyser} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="chat-name">Amina</div>
                    <div className="chat-status" style={{ color: avatarSpeaking ? "#818cf8" : rec ? "#34d399" : processing ? "#eab308" : "#64748b" }}>
                      {avatarSpeaking ? t("speaking") : rec ? t("listening") : processing ? t("thinking") : t("online")}
                    </div>
                  </div>
                  <div className="lang-toggle" title="Switch whole site language">
                    <button
                      className={`lang-btn ${language === "en" ? "lang-btn-active" : ""}`}
                      onClick={() => { setLanguage("en"); replayLastReplyInLang("en"); }}
                      disabled={processing || rec}
                    >English</button>
                    <button
                      className={`lang-btn ${language === "ma" ? "lang-btn-active" : ""}`}
                      onClick={() => { setLanguage("ma"); replayLastReplyInLang("ma"); }}
                      disabled={processing || rec}
                    >Mandinka</button>
                  </div>
                  <button
                    className={`chat-plan-btn ${nkoMode ? "nko-active" : ""}`}
                    onClick={() => setNkoMode(p => !p)}
                    title={nkoMode ? "Switch back to Latin script" : "Show Mandinka in N'Ko script (ߒߞߏ)"}
                    style={nkoMode ? {
                      background: "rgba(16,185,129,0.15)",
                      borderColor: "#10b981",
                      color: "#10b981",
                    } : {}}
                  >
                    <span style={{ fontFamily: "Noto Sans NKo, serif", fontSize: 12, fontWeight: 700 }}>ߒߞߏ</span>
                  </button>
                  <button
                    className="chat-plan-btn"
                    onClick={() => carePlan ? setCarePlanOpen(true) : regenerateCarePlan()}
                    disabled={carePlanLoading || processing || rec}
                    title={carePlan ? "Open care plan" : "Generate care plan from this chat"}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <span>{carePlanLoading ? "…" : "Plan"}</span>
                  </button>
                  <button
                    className="chat-plan-btn"
                    onClick={() => generateDocument()}
                    disabled={docLoading || processing || rec || msgs.length < 2}
                    title="Generate a document from this conversation"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    <span>{docLoading ? "…" : "Doc"}</span>
                  </button>
                  <button
                    className="chat-plan-btn"
                    onClick={handleClearClick}
                    disabled={processing || rec}
                    title={clearPending ? "Click again to confirm" : "Clear conversation history"}
                    style={clearPending ? { background: "rgba(239,68,68,0.15)", borderColor: "#ef4444", color: "#ef4444" } : {}}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                    <span>{clearPending ? "Sure?" : "Clear"}</span>
                  </button>
                </div>

                {/* One-time Mandinka-intent prompt */}
                {showLangPrompt && (
                  <div className="lang-prompt">
                    <div className="lang-prompt-icon">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 8l6 6"/><path d="M4 14l6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="M22 22l-5-10-5 10"/><path d="M14 18h6"/></svg>
                    </div>
                    <div className="lang-prompt-body">
                      <div className="lang-prompt-title">Switch the site to Mandinka?</div>
                      <div className="lang-prompt-sub">It looks like you prefer Mandinka. I can switch the whole chat and interface — you can flip back any time.</div>
                    </div>
                    <div className="lang-prompt-actions">
                      <button
                        className="lang-prompt-btn lang-prompt-btn-primary"
                        onClick={() => { setLanguage("ma"); setShowLangPrompt(false); }}
                      >Switch to Mandinka</button>
                      <button
                        className="lang-prompt-btn lang-prompt-btn-ghost"
                        onClick={() => setShowLangPrompt(false)}
                      >Keep English</button>
                    </div>
                  </div>
                )}

                {modelSwitchNotice && (
                  <div className="model-switch-notice">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.09"/></svg>
                    <span>{modelSwitchNotice}</span>
                  </div>
                )}
                {compactToast && (
                  <div className="compact-toast">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                    <div className="compact-toast-text">
                      <span className="compact-toast-title">Context Compacted</span>
                      <span className="compact-toast-detail">Reduced ≈{compactToast.freed.toLocaleString()} tokens · {compactToast.dropped} message{compactToast.dropped === 1 ? "" : "s"} summarized</span>
                    </div>
                  </div>
                )}
                <div className="messages">
                  {msgs.map((m, i) => <Msg key={i} msgIndex={i} msg={m} base={base} auto={autoSpeak && m.isNew && m.role === "assistant"} onSS={onSpeakStart} onSE={onSpeakEnd} onOpenSymptomForm={() => setShowSymptomForm(true)} onOpenRxForm={() => setShowRxHelper(true)} onRegenerate={regenerateFromIndex} uiLang={language} nkoMode={nkoMode} />)}
                  {rec && live && <div className="msg-row" style={{ justifyContent: "flex-end" }}><div className="bubble-live">{live}{transcribing && <span className="cursor">|</span>}</div></div>}
                  {rec && !live && <div className="msg-row" style={{ justifyContent: "flex-end" }}><div className="bubble-listening">Listening...</div></div>}
                  {!rec && transcribing && <div className="msg-row" style={{ justifyContent: "flex-end" }}><div className="bubble-listening">Transcribing<span className="cursor">|</span></div></div>}
                  {processing && !msgs.some((m) => m._streaming) && <Typing />}
                  <div ref={endRef} />
                </div>
              </div>
            </div>
          )}
            </div>

            {/* RIGHT SIDEBAR — Context & Today */}
            <aside className="sidebar sidebar-right">
              <div className="sidebar-head">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <span>TODAY &amp; CARE</span>
              </div>
              <SeasonalCard data={community?.seasonal} onOpen={() => setActivePanel("seasonal")} />
              <HealerBridgeCard data={community?.healer_bridge} onOpen={() => setActivePanel("healer")} canEdit={canEditCare} canEditCarePath={canEditCarePath} onEditSupply={openSupplyEdit} onEditDualPath={openDualPathEdit} />
            </aside>
          </div>
        </div>

        {/* Error */}
        {err && (
          <div className="error-wrap">
            <div className="error">
              <span>⚠</span>
              <span style={{ flex: 1 }}>{err}</span>
              <button onClick={() => setErr("")} className="error-close">✕</button>
            </div>
          </div>
        )}

        {/* Bottom Bar */}
        <div className="bottom-bar">
          <div className="bottom-inner">
            {silence > 0 && <div className="silence-bar"><div className="silence-track"><div className="silence-fill" style={{ width: `${silence * 100}%` }} /></div></div>}

            {/* Symptom form suggestion banner */}
            {shouldSuggestForm && !processing && !rec && (
              <div className="symptom-hint" onClick={() => setShowSymptomForm(true)}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
                <span>Sounds like a symptom — want to fill a quick form so Amina can assess better?</span>
                <button className="symptom-hint-btn">Open form</button>
              </div>
            )}

            {/* Phase D.5 — abuse-defense session lock banner. */}
            {abuseLock.active && (
              <div
                role="status"
                aria-live="polite"
                style={{
                  margin: "8px 0",
                  padding: "12px 16px",
                  background: "rgba(220, 38, 38, 0.08)",
                  border: "1px solid rgba(220, 38, 38, 0.35)",
                  borderRadius: "8px",
                  color: "#fca5a5",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ flex: "1 1 auto", fontSize: "0.92rem", lineHeight: "1.4" }}>
                  <strong style={{ color: "#fecaca" }}>This conversation has ended.</strong>
                  <span style={{ marginLeft: 6, opacity: 0.85 }}>
                    {abuseLock.kind === "session_terminate" &&
                      "Start a new conversation when you're ready. The chat history above stays visible for your reference."}
                    {abuseLock.kind === "terminate" && abuseLock.duration &&
                      `AMINA will be available again in about ${abuseLock.duration}. For urgent emergencies, dial 199.`}
                    {abuseLock.kind === "terminate" && !abuseLock.duration &&
                      "Please come back later. For urgent emergencies, dial 199."}
                    {abuseLock.kind === "cooldown" && abuseLock.duration &&
                      `Cool-down active — about ${abuseLock.duration} remaining. For urgent emergencies, dial 199.`}
                    {abuseLock.kind === "cooldown" && !abuseLock.duration &&
                      "Cool-down active. For urgent emergencies, dial 199."}
                  </span>
                </div>
                {/* Only offer "New Conversation" for the soft session_terminate.
                    During a real cool-down (terminate / cooldown) the user
                    must wait the timer out — starting a new session would
                    just trigger the cool-down notice again on their first
                    message anyway. */}
                {abuseLock.kind === "session_terminate" && (
                  <button
                    onClick={() => {
                      // Drop old session server-side, mint a new one,
                      // wipe the input, clear the lock. History stays.
                      const oldSid = sessionId;
                      fetch(
                        `${base.replace(/\/+$/, "")}/api/v1/agent/session/${oldSid}/end`,
                        { method: "POST" }
                      ).catch(() => {});
                      setMsgs([]);
                      setLive("");
                      setErr("");
                      setStatus("idle");
                      setLastTriage(null);
                      setFreedOffset(0);
                      setSessionId(genSessionId());
                      setChatInput("");
                      setAbuseLock({ active: false, kind: null, duration: null, since: 0 });
                    }}
                    style={{
                      flex: "0 0 auto",
                      padding: "8px 14px",
                      background: "rgba(220, 38, 38, 0.18)",
                      border: "1px solid rgba(220, 38, 38, 0.45)",
                      borderRadius: "6px",
                      color: "#fecaca",
                      cursor: "pointer",
                      fontSize: "0.88rem",
                      fontWeight: 500,
                    }}
                  >
                    New Conversation
                  </button>
                )}
              </div>
            )}

            {/* Text Chat Row */}
            <div className="chat-input-row">
              <input
                type="text"
                className="chat-input"
                placeholder={abuseLock.active ? "This conversation has ended" : t("type_msg")}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") sendTextMessage(); }}
                disabled={processing || rec || abuseLock.active}
              />
              <button
                className="chat-send-btn"
                onClick={sendTextMessage}
                disabled={!chatInput.trim() || processing || rec || abuseLock.active}
                title="Send"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
              </button>
              <button
                className="chat-rx-btn"
                onClick={() => setShowSymptomForm(true)}
                disabled={processing || rec || abuseLock.active}
                title="Describe symptoms with a guided form"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                <span>Symptom</span>
              </button>
              <button
                className="chat-rx-btn"
                onClick={() => setShowRxHelper(true)}
                disabled={processing || rec || abuseLock.active}
                title="Enter prescription details manually"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12h6m-3-3v6M21 15V7a2 2 0 0 0-2-2h-4l-2-2H8L6 5H5a2 2 0 0 0-2 2v8" /><path d="M3 15h18v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4Z" /></svg>
                <span>Rx</span>
              </button>
              <button
                className="chat-rx-btn"
                onClick={() => downloadChatTranscript()}
                disabled={processing || rec || msgs.length < 2 || pdfDownloading}
                title={pdfDownloading ? "Preparing PDF…" : "Download chat as PDF"}
                aria-busy={pdfDownloading || undefined}
                style={pdfDownloading ? { opacity: 0.65, cursor: "wait" } : undefined}
              >
                {pdfDownloading ? (
                  // Inline spinner while the PDF is being prepared so the
                  // user can see at a glance that their click was received.
                  // Uses the existing global `spin` keyframe (see end of file).
                  <svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5"
                    strokeLinecap="round" strokeLinejoin="round"
                    style={{ animation: "spin 0.85s linear infinite" }}
                  >
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                )}
                <span>{pdfDownloading ? "Preparing…" : "PDF"}</span>
              </button>
            </div>

            {/* ── Model selector dropdown ── */}
            {(() => {
              const models = [
                { key: "amina",   label: "AMINA LoRA",       sub: "Disabled for maintenance",     color: "#64748b", disabled: true, disabledReason: "AMINA LoRA is disabled for maintenance. The fine-tuned endpoint is offline; use Mistral, Groq, Gemini, or GPT-4o mini in the meantime." },
                { key: "groq",    label: "Llama 3.3 70B",    sub: "Groq · Fast open source",      color: "#f59e0b" },
                { key: "mistral", label: "Mistral 7B",       sub: "Mistral AI · Free tier",       color: "#06b6d4" },
                { key: "gemini",  label: "Gemini 2.5 Lite",  sub: "Google · Fast & free",          color: "#818cf8" },
                { key: "base",    label: "GPT-4o mini",      sub: "OpenAI · General purpose",     color: "#64748b" },
              ];
              const active = models.find(m => m.key === modelPref) || models[0];
              const TOKEN_LIMITS = { amina: 10240, groq: 128000, mistral: 32768, gemini: 1000000, base: 128000 };
              const ctxLimit = TOKEN_LIMITS[modelPref] || 128000;
              const rawTokens = msgs.reduce((a, m) => a + Math.ceil((m.content || "").length / 3.5), 0);
              const estTokens = Math.max(0, rawTokens - freedOffset);
              const ctxPct = Math.min(1, estTokens / ctxLimit);
              const ctxDanger = ctxPct > 0.85;
              const ctxColor = ctxDanger ? "#ef4444" : "#f97316";
              const ctxR = 9, ctxCx = 13, ctxCy = 13;
              const ctxCirc = 2 * Math.PI * ctxR;
              const ctxOffset = ctxCirc * (1 - ctxPct);
              const ctxLabel = { amina: "10K", groq: "128K", mistral: "32K", gemini: "1M", base: "128K" }[modelPref] || "128K";
              // Compact — AMINA's legacy approach: chat history stays fully visible,
              // backend context is compressed so the LLM doesn't overflow.
              // The ring drops to reflect freed tokens; messages stay put.
              const handleCompact = async () => {
                if (isCompacting) return;
                const KEEP = 4;
                if (msgs.length <= KEEP) {
                  setIsCompacting(true);
                  setModelSwitchNotice(
                    `Nothing to compact — only ${msgs.length} message${msgs.length === 1 ? "" : "s"}`,
                  );
                  setTimeout(() => {
                    setIsCompacting(false);
                    setModelSwitchNotice("");
                  }, 1800);
                  return;
                }
                setIsCompacting(true);
                const head = msgs.slice(0, msgs.length - KEEP);
                const localFreedTotal = head.reduce(
                  (a, m) => a + Math.ceil((m.content || "").length / 3.5), 0,
                );
                const newlyFreed = Math.max(0, localFreedTotal - freedOffset);
                if (newlyFreed < 1) {
                  setModelSwitchNotice("Already compacted — send more messages first");
                  setTimeout(() => { setIsCompacting(false); setModelSwitchNotice(""); }, 1800);
                  return;
                }
                let serverDropped = null;
                let serverReduced = null;
                try {
                  const r = await fetch(
                    `${base.replace(/\/+$/, "")}/api/v1/agent/compactor/trigger/${encodeURIComponent(sessionId)}`,
                    { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" } },
                  );
                  if (r.ok) {
                    const j = await r.json();
                    serverDropped = Number.isFinite(j.messages_summarized) ? j.messages_summarized
                      : Number.isFinite(j.dropped) ? j.dropped : null;
                    serverReduced = Number.isFinite(j.tokens_reduced) ? j.tokens_reduced : null;
                  }
                } catch { /* backend unavailable — local estimate is used */ }
                const droppedMsgs = serverDropped != null ? serverDropped : head.length;
                const reducedToks = serverReduced != null ? serverReduced : newlyFreed;
                setFreedOffset(localFreedTotal);
                setCompactToast({ freed: reducedToks, dropped: droppedMsgs });
                setTimeout(() => setCompactToast(null), 4500);
                setIsCompacting(false);
              };
              return (
                <div style={{ padding: "4px 12px 6px", display: "flex", alignItems: "center", gap: 8 }}>
                  {/* Model dropdown */}
                  <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                    <select
                      value={modelPref}
                      disabled={processing || rec}
                      onChange={e => {
                        const next = e.target.value;
                        if (next === modelPref) return;
                        const nextModel = models.find(m => m.key === next);
                        const nextLabel = nextModel?.label || next;
                        // Refuse to switch to a disabled model (e.g. LoRA
                        // in maintenance). Surface the disabledReason so
                        // the user knows why and can pick another.
                        if (nextModel?.disabled) {
                          setModelSwitchNotice(
                            nextModel.disabledReason || `${nextLabel} is currently disabled.`
                          );
                          setTimeout(() => setModelSwitchNotice(""), 4500);
                          return;
                        }
                        // Mid-conversation model switch — preserve msgs AND
                        // sessionId. The backend keeps full conversation
                        // state in Redis keyed by session_id; passing the
                        // new model_preference on the next turn is enough
                        // for the LLM to continue the same thread. Follows
                        // AMINA's legacy threading approach: no new chat,
                        // same history, new voice answering.
                        setModelPref(next);
                        if (msgs.length > 0) {
                          setModelSwitchNotice(`Continuing with ${nextLabel}`);
                          setTimeout(() => setModelSwitchNotice(""), 2500);
                        }
                      }}
                      style={{
                        appearance: "none", WebkitAppearance: "none",
                        background: "rgba(255,255,255,0.04)",
                        border: `1px solid ${active.color}44`,
                        borderRadius: 8, padding: "4px 28px 4px 10px",
                        color: active.color, fontSize: 11, fontWeight: 700,
                        fontFamily: "inherit", cursor: "pointer",
                        outline: "none", transition: "all .15s",
                        opacity: processing || rec ? 0.4 : 1,
                        minWidth: 130,
                      }}
                    >
                      {models.map(m => (
                        <option
                          key={m.key}
                          value={m.key}
                          disabled={!!m.disabled}
                          title={m.disabled ? m.disabledReason : undefined}
                        >
                          {m.label}{m.disabled ? " (disabled — maintenance)" : ""}
                        </option>
                      ))}
                    </select>
                    <svg
                      width="10" height="10" viewBox="0 0 24 24"
                      fill="none" stroke={active.color} strokeWidth="2.5"
                      strokeLinecap="round" strokeLinejoin="round"
                      style={{ position: "absolute", right: 8, pointerEvents: "none", opacity: processing || rec ? 0.4 : 1 }}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                  {/* Sub label */}
                  <span style={{ fontSize: 10, color: "#475569", fontWeight: 500, whiteSpace: "nowrap" }}>{active.sub}</span>
                  {/* ── Context usage label + compact button ── */}
                  <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, fontFamily: "monospace",
                      color: ctxDanger ? "#ef4444" : ctxPct > 0 ? "#f97316" : "#475569",
                      transition: "color 0.3s",
                      whiteSpace: "nowrap",
                    }}>
                      {Math.round(ctxPct * 100)}%<span style={{ color: "#334155", fontWeight: 500 }}>/{ctxLabel}</span>
                    </span>
                  <button
                    onClick={handleCompact}
                    disabled={isCompacting}
                    title={`${Math.round(ctxPct * 100)}% of ${ctxLabel} context used · Click to reduce context`}
                    className="compact-btn"
                  >
                    <svg width="26" height="26" viewBox="0 0 26 26" style={{
                      display: "block",
                      animation: isCompacting ? "compact-spin 0.9s cubic-bezier(.4,0,.2,1) forwards" : "none",
                    }}>
                      {/* Track ring */}
                      <circle cx={ctxCx} cy={ctxCy} r={ctxR} fill="none" stroke="rgba(249,115,22,0.25)" strokeWidth="2.5"/>
                      {/* Fill ring — grows clockwise */}
                      <circle
                        cx={ctxCx} cy={ctxCy} r={ctxR}
                        fill="none" stroke={ctxColor} strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeDasharray={ctxCirc}
                        strokeDashoffset={ctxOffset}
                        style={{
                          transform: "rotate(-90deg)",
                          transformOrigin: `${ctxCx}px ${ctxCy}px`,
                          transition: "stroke-dashoffset 0.5s cubic-bezier(.4,0,.2,1), stroke 0.3s",
                          filter: ctxDanger ? "drop-shadow(0 0 4px #ef4444)" : "drop-shadow(0 0 3px #f9731680)",
                        }}
                      />
                      {/* Lightning bolt icon — always visible */}
                      <path
                        d="M14 4l-5 8h4l-1 9 6-10h-4z"
                        fill={ctxColor}
                        opacity={isCompacting ? 0.4 : 1}
                        style={{ transition: "opacity .3s" }}
                      />
                    </svg>
                  </button>

                  {/* Clear conversation — two-click confirm. Sits
                      next to Compact since both affect thread state;
                      styled in danger-red only when the confirm window
                      is open to keep visual noise low in the resting
                      state. */}
                  <button
                    onClick={handleClearClick}
                    disabled={processing || rec}
                    title={clearPending
                      ? "Click again to clear the conversation"
                      : "Clear conversation history"}
                    aria-label={clearPending
                      ? "Click again to confirm clearing the conversation"
                      : "Clear conversation history"}
                    className="clear-btn"
                    style={{
                      width: 26, height: 26,
                      padding: 0, marginLeft: 2,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: `1.5px solid ${clearPending ? "#ef4444" : "rgba(148,163,184,0.35)"}`,
                      borderRadius: "50%",
                      background: clearPending
                        ? "rgba(239,68,68,0.15)"
                        : "rgba(255,255,255,0.04)",
                      color: clearPending ? "#ef4444" : "#94a3b8",
                      cursor: (processing || rec) ? "not-allowed" : "pointer",
                      transition: "all 160ms ease",
                      opacity: (processing || rec) ? 0.4 : 1,
                    }}
                    onMouseEnter={(e) => {
                      if (!(processing || rec)) {
                        e.currentTarget.style.background = clearPending
                          ? "rgba(239,68,68,0.25)"
                          : "rgba(255,255,255,0.08)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = clearPending
                        ? "rgba(239,68,68,0.15)"
                        : "rgba(255,255,255,0.04)";
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" strokeWidth="2"
                         strokeLinecap="round" strokeLinejoin="round"
                         aria-hidden="true">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6" />
                      <path d="M14 11v6" />
                      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                  </div>
                </div>
              );
            })()}

            <div className="bottom-row">
              <div className="bottom-card bottom-left">
                <div className="bottom-label">Status</div>
                <div className="bottom-status"><span className="bottom-dot" style={{ background: statusColor }} /><span style={{ color: statusColor, fontWeight: 700 }}>{status === "idle" ? "Ready" : status === "listening" ? fmt(sec) : status === "processing" ? "Thinking..." : "Error"}</span></div>
              </div>

              <div className="mic-wrapper">
                <div className={`mic-glow ${rec ? "mic-glow-active" : ""}`} />
                <div className="mic-container">
                  <div className="mic-ring"><MicRing analyser={micAn} on={rec} /></div>
                  <button onClick={rec ? stopRecording : startRecording} disabled={micOk !== "granted" || processing} className={`mic-btn ${rec ? "mic-btn-rec" : ""}`}>
                    {rec ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M12 1a4 4 0 00-4 4v7a4 4 0 008 0V5a4 4 0 00-4-4z" /><path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" stroke="white" strokeWidth="1.5" fill="none" /></svg>
                    )}
                  </button>
                </div>
              </div>

              <div className="bottom-card bottom-right">
                <div className="bottom-label">Prescription</div>
                <button
                  className="rx-upload-btn"
                  onClick={() => rxInputRef.current?.click()}
                  disabled={uploadingRx || processing || rec}
                  title="Upload a photo of your prescription"
                >
                  {uploadingRx ? (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="rx-spin"><path d="M21 12a9 9 0 1 1-6.2-8.5" /></svg>
                      <span>Analyzing...</span>
                    </>
                  ) : (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                      <span>{t("upload_rx")}</span>
                    </>
                  )}
                </button>
                <input
                  ref={rxInputRef}
                  type="file"
                  accept="image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif"
                  onChange={onRxFilePick}
                  style={{ display: "none" }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* My Care Plan Panel */}
        {carePlanOpen && carePlan && (
          <div className="rx-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) { setCarePlanOpen(false); } }}>
            <div className="plan-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="plan-modal-header">
                <div className="plan-title-wrap">
                  <div className="plan-title-row">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <span className="plan-modal-title">My Care Plan</span>
                  </div>
                  {carePlan.generated_at && (
                    <span className="plan-generated">
                      Updated {new Date(carePlan.generated_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                </div>
                <div className="plan-modal-actions">
                  <button className="plan-regen-btn" onClick={regenerateCarePlan} disabled={carePlanLoading}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                    <span>{carePlanLoading ? "Updating…" : "Regenerate"}</span>
                  </button>
                  <button className="rx-modal-close" onClick={() => setCarePlanOpen(false)}>✕</button>
                </div>
              </div>

              <div className="plan-modal-body">
                {carePlan.personal_summary && (
                  <div className="plan-summary">{carePlan.personal_summary}</div>
                )}

                {Array.isArray(carePlan.top_priorities) && carePlan.top_priorities.length > 0 && (
                  <div className="plan-block">
                    <div className="plan-block-head plan-head-priority">This week — priorities</div>
                    <ol className="plan-priority-list">
                      {carePlan.top_priorities.map((p, i) => (
                        <li key={i}><span className="plan-num">{i + 1}</span>{p}</li>
                      ))}
                    </ol>
                  </div>
                )}

                {Array.isArray(carePlan.goals) && carePlan.goals.length > 0 && (
                  <div className="plan-block">
                    <div className="plan-block-head plan-head-goals">Goals</div>
                    <ul className="plan-list">
                      {carePlan.goals.slice(0, 6).map((g, i) => <li key={i}>{g}</li>)}
                    </ul>
                  </div>
                )}

                {Array.isArray(carePlan.monitoring) && carePlan.monitoring.length > 0 && (
                  <div className="plan-block">
                    <div className="plan-block-head plan-head-monitor">What to track</div>
                    <div className="plan-rows">
                      {carePlan.monitoring.slice(0, 6).map((m, i) => (
                        <div key={i} className="plan-row">
                          <span className="plan-row-task">{m.task || m}</span>
                          {m.frequency && <span className="plan-row-freq">{m.frequency}</span>}
                          {m.notes && <span className="plan-row-note">{m.notes}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {Array.isArray(carePlan.diet) && carePlan.diet.length > 0 && (
                  <div className="plan-block">
                    <div className="plan-block-head plan-head-diet">Diet</div>
                    <ul className="plan-list">
                      {carePlan.diet.slice(0, 6).map((d, i) => <li key={i}>{d}</li>)}
                    </ul>
                  </div>
                )}

                {Array.isArray(carePlan.exercise) && carePlan.exercise.length > 0 && (
                  <div className="plan-block">
                    <div className="plan-block-head plan-head-exercise">Movement</div>
                    <div className="plan-rows">
                      {carePlan.exercise.map((e, i) => (
                        <div key={i} className="plan-row">
                          <span className="plan-row-task">{e.task || e}</span>
                          {e.frequency && <span className="plan-row-freq">{e.frequency}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {Array.isArray(carePlan.medications_schedule) && carePlan.medications_schedule.length > 0 && (
                  <div className="plan-block">
                    <div className="plan-block-head plan-head-meds">Medications</div>
                    <div className="plan-rows">
                      {carePlan.medications_schedule.map((m, i) => (
                        <div key={i} className="plan-row">
                          <span className="plan-row-task">{m.name}</span>
                          <span className="plan-row-freq">{m.timing} · {m.frequency}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {Array.isArray(carePlan.warning_signs) && carePlan.warning_signs.length > 0 && (
                  <div className="plan-block plan-block-warn">
                    <div className="plan-block-head plan-head-warn">Warning signs — act fast</div>
                    <ul className="plan-list">
                      {carePlan.warning_signs.slice(0, 6).map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Notification Preferences Modal */}
        {showNotifPrefs && (
          <div className="rx-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) skipNotifPrefs(); }}>
            <div className="rx-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="rx-modal-header">
                <div>
                  <div className="rx-modal-title">Stay in Touch</div>
                  <div className="rx-modal-subtitle">Pick how you'd like me to send your follow-up reminders. You can choose more than one.</div>
                </div>
                <button className="rx-modal-close" onClick={skipNotifPrefs}>✕</button>
              </div>
              <div className="rx-modal-body">
                <label className="notif-row">
                  <div className="notif-label">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="#25D366" stroke="none"><path d="M17.5 14.4l-2.3-.8a.7.7 0 00-.7.2l-1 1.2a9 9 0 01-4.5-4.5l1.2-1a.7.7 0 00.2-.7l-.8-2.3a.7.7 0 00-.7-.5H7a.7.7 0 00-.7.8c.3 5 4.3 9 9.3 9.3a.7.7 0 00.8-.7v-1.2a.7.7 0 00-.5-.7z"/></svg>
                    <span>WhatsApp</span>
                  </div>
                  <input type="tel" className="notif-input" placeholder="+220 ..." value={notifForm.whatsapp} onChange={(e) => setNotifForm({ ...notifForm, whatsapp: e.target.value })} />
                </label>
                <label className="notif-row">
                  <div className="notif-label">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="#229ED9" stroke="none"><path d="M22 2L2 10l7 3 3 7 10-18zM10 13l-2-1 10-5-8 6z"/></svg>
                    <span>Telegram</span>
                  </div>
                  <input type="text" className="notif-input" placeholder="@username" value={notifForm.telegram} onChange={(e) => setNotifForm({ ...notifForm, telegram: e.target.value })} />
                </label>
                <label className="notif-row">
                  <div className="notif-label">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                    <span>Email</span>
                  </div>
                  <input type="email" className="notif-input" placeholder="you@example.com" value={notifForm.email} onChange={(e) => setNotifForm({ ...notifForm, email: e.target.value })} />
                </label>
                <label className="notif-row">
                  <div className="notif-label">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                    <span>Phone (SMS)</span>
                  </div>
                  <input type="tel" className="notif-input" placeholder="+220 ..." value={notifForm.sms} onChange={(e) => setNotifForm({ ...notifForm, sms: e.target.value })} />
                </label>
                <label className="notif-row notif-row-toggle">
                  <div className="notif-label">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                    <span>Browser notification</span>
                  </div>
                  <input type="checkbox" className="notif-checkbox" checked={notifForm.browser} onChange={(e) => setNotifForm({ ...notifForm, browser: e.target.checked })} />
                </label>
                <label className="rx-field" style={{ marginTop: 4 }}>
                  <span className="rx-field-label">How often</span>
                  <select className="rx-field-input" value={notifForm.frequency} onChange={(e) => setNotifForm({ ...notifForm, frequency: e.target.value })}>
                    <option value="as_scheduled">Only when a follow-up is scheduled</option>
                    <option value="daily">Daily check-in</option>
                    <option value="weekly">Weekly summary</option>
                  </select>
                </label>
              </div>
              <div className="rx-modal-footer">
                <button className="rx-modal-cancel" onClick={skipNotifPrefs}>Not now</button>
                <button className="rx-modal-submit" onClick={saveNotifPrefs}>Save preferences</button>
              </div>
            </div>
          </div>
        )}

        {/* Community EDIT Modals */}
        {activePanel === "edit_bantaba" && (
          <div className="rx-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) { setActivePanel(null); } }}>
            <div className="rx-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="rx-modal-header">
                <div><div className="rx-modal-title">Manage Bantaba Circle</div><div className="rx-modal-subtitle">Add member, log adherence, or update the weekly highlight.</div></div>
                <button className="rx-modal-close" onClick={() => setActivePanel(null)}>✕</button>
              </div>
              <div className="rx-modal-body">
                <div className="care-edit-section">
                  <div className="care-edit-section-head">Add Member</div>
                  <div className="rx-field-row">
                    <label className="rx-field" style={{ flex: 2 }}><span className="rx-field-label">Name</span><input type="text" className="rx-field-input" value={communityForm.memberName || ""} onChange={(e) => setCommunityForm({ ...communityForm, memberName: e.target.value })} /></label>
                    <label className="rx-field" style={{ flex: 1 }}><span className="rx-field-label">Age</span><input type="number" className="rx-field-input" value={communityForm.memberAge || ""} onChange={(e) => setCommunityForm({ ...communityForm, memberAge: e.target.value })} /></label>
                  </div>
                  <label className="rx-field"><span className="rx-field-label">Conditions (comma separated)</span><input type="text" className="rx-field-input" placeholder="diabetes, hypertension" value={communityForm.memberConditions || ""} onChange={(e) => setCommunityForm({ ...communityForm, memberConditions: e.target.value })} /></label>
                  <button className="rx-modal-submit" style={{ marginTop: 6, width: "100%" }} disabled={!communityForm.memberName || careSaving} onClick={() => submitCommunityForm("bantaba/members", { name: communityForm.memberName, age: parseInt(communityForm.memberAge) || 30, conditions: (communityForm.memberConditions || "").split(",").map((s) => s.trim()).filter(Boolean) })}>Add member</button>
                </div>
                <div className="care-edit-section">
                  <div className="care-edit-section-head">Update Weekly Highlight</div>
                  <label className="rx-field"><span className="rx-field-label">This week's highlight</span><input type="text" className="rx-field-input" placeholder="Awa tried less oil in her domoda" value={communityForm.highlight || ""} onChange={(e) => setCommunityForm({ ...communityForm, highlight: e.target.value })} /></label>
                  <button className="rx-modal-submit" style={{ marginTop: 6, width: "100%" }} disabled={!communityForm.highlight || careSaving} onClick={() => submitCommunityForm("bantaba/highlight", { highlight: communityForm.highlight, _method: "PUT" })}>Save highlight</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activePanel === "edit_village" && (
          <div className="rx-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) { setActivePanel(null); } }}>
            <div className="rx-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="rx-modal-header">
                <div><div className="rx-modal-title">Update Village Scoreboard</div><div className="rx-modal-subtitle">{userRole === "alkalo" ? "Add Alkalo notes to the village record." : "Update pillar scores for the village."}</div></div>
                <button className="rx-modal-close" onClick={() => setActivePanel(null)}>✕</button>
              </div>
              <div className="rx-modal-body">
                {userRole === "alkalo" ? (
                  <div className="care-edit-section">
                    <div className="care-edit-section-head">Alkalo Note</div>
                    <label className="rx-field"><span className="rx-field-label">Your note to the village</span><input type="text" className="rx-field-input" placeholder="Focus on screening this month..." value={communityForm.alkaloNote || ""} onChange={(e) => setCommunityForm({ ...communityForm, alkaloNote: e.target.value })} /></label>
                    <button className="rx-modal-submit" style={{ marginTop: 6, width: "100%" }} disabled={!communityForm.alkaloNote || careSaving} onClick={() => submitCommunityForm("village/alkalo-note", { note: communityForm.alkaloNote })}>Save note</button>
                  </div>
                ) : (
                  <div className="care-edit-section">
                    <div className="care-edit-section-head">Update a Pillar Score</div>
                    <div className="rx-field-row">
                      <label className="rx-field" style={{ flex: 2 }}>
                        <span className="rx-field-label">Pillar</span>
                        <select className="rx-field-input" value={communityForm.pillarId || "screening"} onChange={(e) => setCommunityForm({ ...communityForm, pillarId: e.target.value })}>
                          <option value="screening">Screening rate</option>
                          <option value="adherence">Medication adherence</option>
                          <option value="diet">Dietary improvement</option>
                          <option value="youth">Youth engagement</option>
                          <option value="emergency">Emergency response</option>
                        </select>
                      </label>
                      <label className="rx-field" style={{ flex: 1 }}>
                        <span className="rx-field-label">Score (0-20)</span>
                        <input type="number" min="0" max="20" className="rx-field-input" value={communityForm.pillarScore || ""} onChange={(e) => setCommunityForm({ ...communityForm, pillarScore: e.target.value })} />
                      </label>
                    </div>
                    <label className="rx-field"><span className="rx-field-label">Detail / notes</span><input type="text" className="rx-field-input" value={communityForm.pillarDetail || ""} onChange={(e) => setCommunityForm({ ...communityForm, pillarDetail: e.target.value })} /></label>
                    <button className="rx-modal-submit" style={{ marginTop: 6, width: "100%" }} disabled={!communityForm.pillarScore || careSaving} onClick={() => submitCommunityForm("village/pillar", { pillar_id: communityForm.pillarId || "screening", score: parseInt(communityForm.pillarScore) || 0, detail: communityForm.pillarDetail || "", _method: "PUT" })}>Update pillar</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activePanel === "edit_scout" && (
          <div className="rx-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) { setActivePanel(null); } }}>
            <div className="rx-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="rx-modal-header">
                <div><div className="rx-modal-title">Manage Youth Scouts</div><div className="rx-modal-subtitle">Create scouts, assign elders, and log BP check results.</div></div>
                <button className="rx-modal-close" onClick={() => setActivePanel(null)}>✕</button>
              </div>
              <div className="rx-modal-body">
                <div className="care-edit-section">
                  <div className="care-edit-section-head">Register New Scout</div>
                  <div className="rx-field-row">
                    <label className="rx-field" style={{ flex: 2 }}><span className="rx-field-label">Scout name</span><input type="text" className="rx-field-input" placeholder="Lamin Ceesay" value={communityForm.scoutName || ""} onChange={(e) => setCommunityForm({ ...communityForm, scoutName: e.target.value })} /></label>
                    <label className="rx-field" style={{ flex: 1 }}><span className="rx-field-label">Age</span><input type="number" className="rx-field-input" placeholder="18" value={communityForm.scoutAge || ""} onChange={(e) => setCommunityForm({ ...communityForm, scoutAge: e.target.value })} /></label>
                  </div>
                  <label className="rx-field"><span className="rx-field-label">Village</span><input type="text" className="rx-field-input" placeholder="Kerewan" value={communityForm.scoutVillage || "Kerewan"} onChange={(e) => setCommunityForm({ ...communityForm, scoutVillage: e.target.value })} /></label>
                  <button className="rx-modal-submit" style={{ marginTop: 6, width: "100%" }} disabled={!communityForm.scoutName || careSaving} onClick={() => submitCommunityForm("scout/create", { name: communityForm.scoutName, age: parseInt(communityForm.scoutAge) || 18, village: communityForm.scoutVillage || "Kerewan" })}>Register scout</button>
                </div>
                {scoutList.length > 0 && (
                  <div className="care-edit-section">
                    <div className="care-edit-section-head">Remove Scout</div>
                    <div className="rx-field-row">
                      <label className="rx-field" style={{ flex: 2 }}>
                        <select className="rx-field-input" value={communityForm.removeScoutId || ""} onChange={(e) => setCommunityForm({ ...communityForm, removeScoutId: e.target.value })}>
                          <option value="">Select scout to remove...</option>
                          {scoutList.map((s) => (
                            <option key={s.scout_id || s.name} value={s.scout_id || ""}>{s.name}, {s.age}</option>
                          ))}
                        </select>
                      </label>
                      <button className="ccard-edit-btn" style={{ background: "rgba(239,68,68,0.14)", borderColor: "rgba(239,68,68,0.3)", color: "#fca5a5", padding: "8px 12px" }} disabled={!communityForm.removeScoutId || careSaving} onClick={async () => {
                        if (!communityForm.removeScoutId) return;
                        setCareSaving(true);
                        try {
                          await fetch(`${base.replace(/\/+$/, "")}/api/v1/community/scout/${communityForm.removeScoutId}?role=${userRole}`, { method: "DELETE", credentials: "include" });
                          await fetchCommunity();
                          await fetchScoutList();
                          setCommunityForm({ ...communityForm, removeScoutId: "" });
                        } catch {}
                        setCareSaving(false);
                      }}>Remove</button>
                    </div>
                  </div>
                )}
                <div className="care-edit-section">
                  <div className="care-edit-section-head">Assign Elder to Scout</div>
                  <div className="rx-field-row">
                    <label className="rx-field" style={{ flex: 2 }}><span className="rx-field-label">Elder name</span><input type="text" className="rx-field-input" value={communityForm.elderName || ""} onChange={(e) => setCommunityForm({ ...communityForm, elderName: e.target.value })} /></label>
                    <label className="rx-field" style={{ flex: 1 }}><span className="rx-field-label">Age</span><input type="number" className="rx-field-input" value={communityForm.elderAge || ""} onChange={(e) => setCommunityForm({ ...communityForm, elderAge: e.target.value })} /></label>
                  </div>
                  <label className="rx-field"><span className="rx-field-label">Relation</span><input type="text" className="rx-field-input" placeholder="grandmother, uncle, neighbour" value={communityForm.elderRelation || ""} onChange={(e) => setCommunityForm({ ...communityForm, elderRelation: e.target.value })} /></label>
                  <button className="rx-modal-submit" style={{ marginTop: 6, width: "100%" }} disabled={!communityForm.elderName || careSaving} onClick={() => submitCommunityForm("scout/assign", { elder_name: communityForm.elderName, relation: communityForm.elderRelation || "relative", age: parseInt(communityForm.elderAge) || 60 })}>Assign elder</button>
                </div>
                <div className="care-edit-section">
                  <div className="care-edit-section-head">Log Elder BP Check</div>
                  <div className="rx-field-row">
                    <label className="rx-field" style={{ flex: 2 }}><span className="rx-field-label">Elder name</span><input type="text" className="rx-field-input" value={communityForm.checkElderName || ""} onChange={(e) => setCommunityForm({ ...communityForm, checkElderName: e.target.value })} /></label>
                    <label className="rx-field" style={{ flex: 1 }}><span className="rx-field-label">BP reading</span><input type="text" className="rx-field-input" placeholder="145/92" value={communityForm.checkBP || ""} onChange={(e) => setCommunityForm({ ...communityForm, checkBP: e.target.value })} /></label>
                  </div>
                  <label className="rx-field">
                    <span className="rx-field-label">Status flag</span>
                    <select className="rx-field-input" value={communityForm.checkFlag || "green"} onChange={(e) => setCommunityForm({ ...communityForm, checkFlag: e.target.value })}>
                      <option value="green">Green — normal</option>
                      <option value="yellow">Yellow — needs attention</option>
                      <option value="red">Red — urgent</option>
                    </select>
                  </label>
                  <button className="rx-modal-submit" style={{ marginTop: 6, width: "100%" }} disabled={!communityForm.checkElderName || !communityForm.checkBP || careSaving} onClick={() => submitCommunityForm("scout/check", { elder_name: communityForm.checkElderName, bp: communityForm.checkBP, flag: communityForm.checkFlag || "green", _method: "PUT" })}>Log check</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Community Feature Detail Panels */}
        {activePanel === "bantaba" && community?.bantaba && (
          <div className="rx-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) { setActivePanel(null); } }}>
            <div className="plan-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="plan-modal-header">
                <div className="plan-title-wrap">
                  <div className="plan-title-row" style={{ color: "#a78bfa" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/></svg>
                    <span className="plan-modal-title">{community.bantaba.name}</span>
                  </div>
                  <span className="plan-generated">{community.bantaba.village} · Week {community.bantaba.streak_weeks} · Next checkin {community.bantaba.next_checkin_display}</span>
                </div>
                <button className="rx-modal-close" onClick={() => setActivePanel(null)}>✕</button>
              </div>
              <div className="plan-modal-body">
                <div className="panel-stat-grid">
                  <div className="panel-stat"><div className="panel-stat-val">{community.bantaba.adherence_pct}%</div><div className="panel-stat-lbl">adherence</div></div>
                  <div className="panel-stat"><div className="panel-stat-val">{community.bantaba.members_on_track}</div><div className="panel-stat-lbl">on track</div></div>
                  <div className="panel-stat"><div className="panel-stat-val">{community.bantaba.members_need_support}</div><div className="panel-stat-lbl">need support</div></div>
                </div>
                <div className="plan-block">
                  <div className="plan-block-head plan-head-goals">Members · {community.bantaba.members.length}</div>
                  <div className="panel-member-list">
                    {community.bantaba.members.map((m, i) => (
                      <div key={i} className="panel-member">
                        <div className="panel-member-avatar" style={{ background: `hsl(${(i*60+20)%360},55%,48%)` }}>{m.name?.[0]}</div>
                        <div className="panel-member-info">
                          <div className="panel-member-name">{m.name}<span className="panel-member-age">, {m.age}</span></div>
                          <div className="panel-member-cond">{(m.conditions || []).join(", ") || "no conditions recorded"}</div>
                        </div>
                        {m.adherence_target > 0 && (
                          <div className={`panel-member-score ${m.adherence_week >= m.adherence_target * 0.85 ? "ok" : m.adherence_week < m.adherence_target * 0.6 ? "low" : "mid"}`}>
                            {m.adherence_week}/{m.adherence_target}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                {community.bantaba.this_week_highlight && (
                  <div className="plan-summary">This week: {community.bantaba.this_week_highlight}</div>
                )}
              </div>
            </div>
          </div>
        )}

        {activePanel === "my_circle" && community?.my_circle && (
          <div className="rx-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) { setActivePanel(null); } }}>
            <div className="plan-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="plan-modal-header">
                <div className="plan-title-wrap">
                  <div className="plan-title-row" style={{ color: "#818cf8" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/></svg>
                    <span className="plan-modal-title">{community.my_circle.name || "My Circle"}</span>
                  </div>
                  <span className="plan-generated">{community.my_circle.village || "Kerewan"} · {(community.my_circle.members || []).length} member{(community.my_circle.members || []).length !== 1 ? "s" : ""}</span>
                </div>
                <button className="rx-modal-close" onClick={() => setActivePanel(null)}>✕</button>
              </div>
              <div className="plan-modal-body">
                <div className="plan-block">
                  <div className="plan-block-head plan-head-goals">Members · {(community.my_circle.members || []).length}</div>
                  <div className="panel-member-list">
                    {(community.my_circle.members || []).map((m, i) => (
                      <div key={i} className="panel-member">
                        <div className="panel-member-avatar" style={{ background: `hsl(${(i * 60 + 200) % 360},55%,48%)` }}>{m.name?.[0]}</div>
                        <div className="panel-member-info">
                          <div className="panel-member-name">{m.name}{m.age ? <span className="panel-member-age">, {m.age}</span> : null}{m.is_owner && <span style={{ fontSize: 9, marginLeft: 6, padding: "1px 6px", borderRadius: 999, background: "rgba(99,102,241,0.2)", color: "#c7d2fe", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3 }}>Owner</span>}</div>
                          <div className="panel-member-cond">{(m.conditions || []).join(", ") || "no conditions recorded"}</div>
                        </div>
                        {(m.adherence_target || 0) > 0 && (
                          <div className={`panel-member-score ${(m.adherence_week || 0) >= (m.adherence_target || 7) * 0.85 ? "ok" : (m.adherence_week || 0) < (m.adherence_target || 7) * 0.6 ? "low" : "mid"}`}>
                            {m.adherence_week || 0}/{m.adherence_target || 7}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                  <button className="rx-modal-submit" style={{ flex: 1 }} onClick={() => { setActivePanel(null); try { window.dispatchEvent(new CustomEvent("amina:open-bantaba-manager")); } catch {} }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
                    Request to add someone
                  </button>
                </div>
                {(community.my_circle.members || []).length <= 1 && (
                  <div className="plan-summary" style={{ marginTop: 8, color: "#94a3b8", fontSize: 12 }}>Your circle is just you for now. Add family or friends — they'll be approved by your village Alkalo.</div>
                )}
              </div>
            </div>
          </div>
        )}

        {activePanel === "village" && community?.village && (
          <div className="rx-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) { setActivePanel(null); } }}>
            <div className="plan-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="plan-modal-header">
                <div className="plan-title-wrap">
                  <div className="plan-title-row" style={{ color: "#06b6d4" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/></svg>
                    <span className="plan-modal-title">{community.village.village} Village Score</span>
                  </div>
                  <span className="plan-generated">{community.village.region} Region · Rank #{community.village.regional_rank} of {community.village.regional_total}</span>
                </div>
                <button className="rx-modal-close" onClick={() => setActivePanel(null)}>✕</button>
              </div>
              <div className="plan-modal-body">
                <div className="village-hero">
                  <div className="village-hero-score">{community.village.score}</div>
                  <div className="village-hero-max">/ {community.village.max_score}</div>
                  <div className="village-hero-delta">
                    {community.village.trend === "up" ? "↑" : community.village.trend === "down" ? "↓" : "→"} {community.village.delta_from_last_month > 0 ? "+" : ""}{community.village.delta_from_last_month} this month
                  </div>
                </div>
                <div className="plan-block">
                  <div className="plan-block-head plan-head-monitor">5 Pillars of Health</div>
                  <div className="panel-pillars">
                    {community.village.pillars.map((p) => (
                      <div key={p.id} className="panel-pillar">
                        <div className="panel-pillar-top">
                          <div className="panel-pillar-name">{p.name}</div>
                          <div className="panel-pillar-score">{p.score}<span>/{p.max}</span></div>
                        </div>
                        <div className="village-pillar-bar"><div className="village-pillar-fill" style={{ width: `${100*p.score/p.max}%` }}></div></div>
                        <div className="panel-pillar-detail">{p.detail}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="plan-summary">To Alkallo: {community.village.message_to_alkallo}</div>
              </div>
            </div>
          </div>
        )}

        {activePanel === "scout" && community?.scout && (
          <div className="rx-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) { setActivePanel(null); } }}>
            <div className="plan-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="plan-modal-header">
                <div className="plan-title-wrap">
                  <div className="plan-title-row" style={{ color: "#f59e0b" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                    <span className="plan-modal-title">{community.scout.name}'s Scout Profile</span>
                  </div>
                  <span className="plan-generated">{community.scout.village} · Rank #{community.scout.rank_in_village} of {community.scout.total_scouts_in_village} scouts · {community.scout.total_checks} total checks</span>
                </div>
                <button className="rx-modal-close" onClick={() => setActivePanel(null)}>✕</button>
              </div>
              <div className="plan-modal-body">
                <div className="plan-block">
                  <div className="plan-block-head plan-head-priority">Badge Progress</div>
                  <div className="panel-badges">
                    {["first_check","heart_watcher","village_scout","amina_ambassador"].map((id, i) => {
                      const names = ["First Check","Heart Watcher","Village Scout Leader","AMINA Ambassador"];
                      const achieved = community.scout.badge?.current?.id === id || ["first_check","heart_watcher","village_scout","amina_ambassador"].indexOf(community.scout.badge?.current?.id) >= i;
                      return (
                        <div key={id} className={`panel-badge ${achieved ? "panel-badge-on" : ""}`}>
                          <div className="panel-badge-icon">{achieved ? "★" : "○"}</div>
                          <div className="panel-badge-name">{names[i]}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="plan-block">
                  <div className="plan-block-head plan-head-goals">Elders You Monitor</div>
                  <div className="panel-member-list">
                    {community.scout.elders_monitored.map((e, i) => (
                      <div key={i} className="panel-member">
                        <div className={`panel-flag panel-flag-${e.flag}`}></div>
                        <div className="panel-member-info">
                          <div className="panel-member-name">{e.name}<span className="panel-member-age">, {e.age}</span></div>
                          <div className="panel-member-cond">BP {e.last_bp} · {e.last_check} · {e.relation}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activePanel === "seasonal" && community?.seasonal && (
          <div className="rx-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) { setActivePanel(null); } }}>
            <div className="plan-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="plan-modal-header">
                <div className="plan-title-wrap">
                  <div className="plan-title-row" style={{ color: "#22c55e" }}>
                    <span style={{ fontSize: 18 }}>{community.seasonal.season?.emoji}</span>
                    <span className="plan-modal-title">{community.seasonal.season?.name}</span>
                  </div>
                  <span className="plan-generated">{community.seasonal.date} · {community.seasonal.month}</span>
                </div>
                <button className="rx-modal-close" onClick={() => setActivePanel(null)}>✕</button>
              </div>
              <div className="plan-modal-body">
                {community.seasonal.is_ramadan && (
                  <div className="plan-block">
                    <div className="plan-block-head plan-head-priority">🌙 Ramadan Guidance</div>
                    <div className="panel-tips">
                      {community.seasonal.ramadan_tips.map((t, i) => (
                        <div key={i} className="panel-tip">
                          <span className="panel-tip-icon">{t.icon}</span>
                          <span>{t.tip}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="plan-block">
                  <div className="plan-block-head plan-head-diet">Season Tips</div>
                  <div className="panel-tips">
                    {community.seasonal.all_tips.map((t, i) => (
                      <div key={i} className="panel-tip">
                        <span className="panel-tip-icon">{t.icon}</span>
                        <span>{t.tip}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activePanel === "healer" && community?.healer_bridge && (
          <div className="rx-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) { setActivePanel(null); } }}>
            <div className="plan-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="plan-modal-header">
                <div className="plan-title-wrap">
                  <div className="plan-title-row" style={{ color: "#ec4899" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.93 4.93l4.24 4.24"/><path d="M14.83 9.17l4.24-4.24"/><path d="M14.83 14.83l4.24 4.24"/><path d="M9.17 14.83l-4.24 4.24"/><circle cx="12" cy="12" r="4"/></svg>
                    <span className="plan-modal-title">Dual-Path Care</span>
                  </div>
                  <span className="plan-generated">Traditional + Modern working together</span>
                </div>
                <button className="rx-modal-close" onClick={() => setActivePanel(null)}>✕</button>
              </div>
              <div className="plan-modal-body">
                {community.healer_bridge.progress && (
                  <div className="plan-summary">{community.healer_bridge.progress.message}</div>
                )}
                <div className="plan-block">
                  <div className="plan-block-head plan-head-diet">🌿 Traditional Path</div>
                  <div className="panel-rowblock">
                    <div><strong>Practitioner:</strong> {community.healer_bridge.traditional_care.practitioner}</div>
                    <div><strong>Practices:</strong> {community.healer_bridge.traditional_care.practices.join(", ")}</div>
                    <div><strong>Last visit:</strong> {community.healer_bridge.traditional_care.last_visit_days_ago} days ago</div>
                  </div>
                </div>
                <div className="plan-block">
                  <div className="plan-block-head plan-head-meds">🏥 Modern Path</div>
                  <div className="panel-rowblock">
                    <div><strong>Facility:</strong> {community.healer_bridge.modern_care.facility}</div>
                    <div><strong>CHW:</strong> {community.healer_bridge.modern_care.chw_name}</div>
                    <div><strong>Medications:</strong> {community.healer_bridge.modern_care.medications.join(", ")}</div>
                    <div><strong>Last visit:</strong> {community.healer_bridge.modern_care.last_visit_days_ago} days ago</div>
                  </div>
                </div>
                {community.healer_bridge.interactions_flag && (
                  <div className={community.healer_bridge.interactions_flag.safe ? "plan-summary" : "plan-block-warn"} style={{ padding: "10px 12px" }}>
                    {community.healer_bridge.interactions_flag.safe ? "✓ " : "⚠ "}{community.healer_bridge.interactions_flag.notes}
                  </div>
                )}
                <div className="plan-block">
                  <div className="plan-block-head plan-head-priority">Next Step</div>
                  <div className="panel-rowblock">{community.healer_bridge.next_action}</div>
                </div>
                {community.healer_bridge.supply && (
                  <div className="plan-block">
                    <div className="plan-block-head plan-head-goals">Medicine Supply</div>
                    <div className="panel-rowblock">
                      <div><strong>{community.healer_bridge.supply.medicine}</strong> — {community.healer_bridge.supply.days_remaining} days remaining</div>
                      <div>{community.healer_bridge.supply.where_to_refill}</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Document Preview Modal */}
        {docPreview && (
          <div className="rx-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) { setDocPreview(null); } }}>
            <div className="plan-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="plan-modal-header">
                <div className="plan-title-wrap">
                  <div className="plan-title-row">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <span className="plan-modal-title">{docPreview.title}</span>
                  </div>
                  <span className="plan-generated">{docPreview.subtitle}</span>
                </div>
                <div className="plan-modal-actions">
                  <button className="doc-action-btn doc-action-dl" onClick={() => downloadDoc("pdf")} disabled={!!docDownloading} title="Download PDF" style={docDownloading === "pdf" ? { opacity: 0.6 } : {}}>
                    {docDownloading === "pdf" ? <span className="btn-spinner" /> : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>}
                    <span>{docDownloading === "pdf" ? "…" : "PDF"}</span>
                  </button>
                  <button className="doc-action-btn doc-action-dl" onClick={() => downloadDoc("docx")} disabled={!!docDownloading} title="Download Word" style={docDownloading === "docx" ? { opacity: 0.6 } : {}}>
                    {docDownloading === "docx" ? <span className="btn-spinner" /> : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>}
                    <span>{docDownloading === "docx" ? "…" : "DOCX"}</span>
                  </button>
                  <button
                    className={`doc-action-btn ${docFeedback === "up" ? "doc-action-good" : ""}`}
                    onClick={() => setDocFeedback(docFeedback === "up" ? null : "up")}
                    title="Good document"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill={docFeedback === "up" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
                  </button>
                  <button
                    className={`doc-action-btn ${docFeedback === "down" ? "doc-action-bad" : ""}`}
                    onClick={() => setDocFeedback(docFeedback === "down" ? null : "down")}
                    title="Needs improvement"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill={docFeedback === "down" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>
                  </button>
                  <button className="plan-regen-btn" onClick={() => { setDocPreview(null); generateDocument(docPreview.doc_type); }} disabled={docLoading}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                    <span>Regenerate</span>
                  </button>
                  <button className="rx-modal-close" onClick={() => setDocPreview(null)}>✕</button>
                </div>
              </div>
              <div className="plan-modal-body">
                {docPreview.sections?.map((s, i) => (
                  <div key={i} className="doc-section">
                    <div className="doc-section-head">{s.heading}</div>
                    <div className="doc-section-body">{s.content}</div>
                  </div>
                ))}
                {docPreview.recommendations?.length > 0 && (
                  <div className="doc-section">
                    <div className="doc-section-head">Recommendations</div>
                    <ol className="doc-recs">
                      {docPreview.recommendations.map((r, i) => <li key={i}>{r}</li>)}
                    </ol>
                  </div>
                )}
                {docPreview.follow_up && (
                  <div className="doc-section">
                    <div className="doc-section-head">Follow-up Plan</div>
                    <div className="doc-section-body">{docPreview.follow_up}</div>
                  </div>
                )}
                {docPreview.disclaimer && (
                  <div className="doc-disclaimer">{docPreview.disclaimer}</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Scout Application Modal (patients) */}
        {showScoutApply && (
          <div className="rx-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) { setShowScoutApply(false); setScoutApplyResult(null);; } }}>
            <div className="rx-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="rx-modal-header">
                <div>
                  <div className="rx-modal-title">Apply to Become a Health Scout</div>
                  <div className="rx-modal-subtitle">Youth under 25 can volunteer to monitor elders' health in their village. A VHW will review your application.</div>
                </div>
                <button className="rx-modal-close" onClick={() => { setShowScoutApply(false); setScoutApplyResult(null); }}>✕</button>
              </div>
              <div className="rx-modal-body">
                {scoutApplyResult ? (
                  <div className={scoutApplyResult.ok ? "scout-apply-success" : "scout-apply-fail"}>
                    {scoutApplyResult.ok ? "✓ " : "✗ "}{scoutApplyResult.msg}
                  </div>
                ) : (
                  <>
                    <label className="rx-field">
                      <span className="rx-field-label">Your name <span className="rx-req">*</span></span>
                      <input type="text" className="rx-field-input" placeholder="Lamin Ceesay" value={scoutApplyForm.name} onChange={(e) => setScoutApplyForm({ ...scoutApplyForm, name: e.target.value })} autoFocus />
                    </label>
                    <div className="rx-field-row">
                      <label className="rx-field" style={{ flex: 1 }}>
                        <span className="rx-field-label">Age <span className="rx-req">*</span></span>
                        <input type="number" className="rx-field-input" placeholder="18" min="12" max="24" value={scoutApplyForm.age} onChange={(e) => setScoutApplyForm({ ...scoutApplyForm, age: e.target.value })} />
                      </label>
                      <label className="rx-field" style={{ flex: 1 }}>
                        <span className="rx-field-label">Village</span>
                        <input type="text" className="rx-field-input" value={scoutApplyForm.village} onChange={(e) => setScoutApplyForm({ ...scoutApplyForm, village: e.target.value })} />
                      </label>
                    </div>
                    <label className="rx-field">
                      <span className="rx-field-label">Phone number (optional)</span>
                      <input type="tel" className="rx-field-input" placeholder="+220..." value={scoutApplyForm.phone} onChange={(e) => setScoutApplyForm({ ...scoutApplyForm, phone: e.target.value })} />
                    </label>
                    <div className="scout-apply-note">
                      You must be between 12 and 24 years old. A Village Health Worker will review your application and contact you.
                    </div>
                  </>
                )}
              </div>
              {!scoutApplyResult && (
                <div className="rx-modal-footer">
                  <button className="rx-modal-cancel" onClick={() => setShowScoutApply(false)}>Cancel</button>
                  <button className="rx-modal-submit" onClick={submitScoutApplication} disabled={!scoutApplyForm.name.trim() || !scoutApplyForm.age}>Submit application</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Care Edit Modal (Supply / Dual-Path) — clinician/VHW only */}
        {showCareEdit && (
          <div className="rx-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowCareEdit(null); }}>
            <div className="rx-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="rx-modal-header">
                <div>
                  <div className="rx-modal-title">
                    {showCareEdit === "supply" ? "Update Medicine Supply" : "Update Dual-Path Care"}
                  </div>
                  <div className="rx-modal-subtitle">
                    {showCareEdit === "supply"
                      ? "Update stock levels, refill location, and availability for this patient."
                      : "Update traditional + modern care details, interaction safety, and progress."}
                  </div>
                </div>
                <button className="rx-modal-close" onClick={() => setShowCareEdit(null)}>✕</button>
              </div>
              <div className="rx-modal-body">
                {showCareEdit === "supply" && (
                  <>
                    <label className="rx-field">
                      <span className="rx-field-label">Medication name</span>
                      <input type="text" className="rx-field-input" value={careEditData.medication_name || ""} onChange={(e) => setCareEditData({ ...careEditData, medication_name: e.target.value })} />
                    </label>
                    <div className="rx-field-row">
                      <label className="rx-field" style={{ flex: 1 }}>
                        <span className="rx-field-label">Tablets remaining</span>
                        <input type="number" className="rx-field-input" value={careEditData.tablets_remaining ?? ""} onChange={(e) => setCareEditData({ ...careEditData, tablets_remaining: e.target.value })} />
                      </label>
                      <label className="rx-field" style={{ flex: 1 }}>
                        <span className="rx-field-label">In stock?</span>
                        <select className="rx-field-input" value={careEditData.in_stock ? "yes" : "no"} onChange={(e) => setCareEditData({ ...careEditData, in_stock: e.target.value === "yes" })}>
                          <option value="yes">Yes - in stock</option>
                          <option value="no">No - out of stock</option>
                        </select>
                      </label>
                    </div>
                    <label className="rx-field">
                      <span className="rx-field-label">Cost per pack</span>
                      <input type="text" className="rx-field-input" placeholder="e.g. 20 dalasi / 30 tablets" value={careEditData.cost_per_pack || ""} onChange={(e) => setCareEditData({ ...careEditData, cost_per_pack: e.target.value })} />
                    </label>
                    <label className="rx-field">
                      <span className="rx-field-label">Refill location</span>
                      <input type="text" className="rx-field-input" placeholder="e.g. Kerewan clinic" value={careEditData.refill_location || ""} onChange={(e) => setCareEditData({ ...careEditData, refill_location: e.target.value })} />
                    </label>
                  </>
                )}
                {showCareEdit === "dualpath" && (
                  <>
                    <div className="care-edit-section">
                      <div className="care-edit-section-head">🌿 Traditional Path</div>
                      <label className="rx-field">
                        <span className="rx-field-label">Practitioner</span>
                        <input type="text" className="rx-field-input" value={careEditData.trad_practitioner || ""} onChange={(e) => setCareEditData({ ...careEditData, trad_practitioner: e.target.value })} />
                      </label>
                      <label className="rx-field">
                        <span className="rx-field-label">Practices (comma separated)</span>
                        <input type="text" className="rx-field-input" placeholder="Prayers, Bitter leaf tea" value={careEditData.trad_practices || ""} onChange={(e) => setCareEditData({ ...careEditData, trad_practices: e.target.value })} />
                      </label>
                      <div className="rx-field-row">
                        <label className="rx-field" style={{ flex: 1 }}>
                          <span className="rx-field-label">Last visit (days ago)</span>
                          <input type="number" className="rx-field-input" value={careEditData.trad_last_visit ?? ""} onChange={(e) => setCareEditData({ ...careEditData, trad_last_visit: e.target.value })} />
                        </label>
                      </div>
                      <label className="rx-field">
                        <span className="rx-field-label">Notes</span>
                        <input type="text" className="rx-field-input" value={careEditData.trad_notes || ""} onChange={(e) => setCareEditData({ ...careEditData, trad_notes: e.target.value })} />
                      </label>
                    </div>
                    <div className="care-edit-section">
                      <div className="care-edit-section-head">🏥 Modern Path</div>
                      <label className="rx-field">
                        <span className="rx-field-label">Facility</span>
                        <input type="text" className="rx-field-input" value={careEditData.mod_facility || ""} onChange={(e) => setCareEditData({ ...careEditData, mod_facility: e.target.value })} />
                      </label>
                      <label className="rx-field">
                        <span className="rx-field-label">CHW name</span>
                        <input type="text" className="rx-field-input" value={careEditData.mod_chw || ""} onChange={(e) => setCareEditData({ ...careEditData, mod_chw: e.target.value })} />
                      </label>
                      <label className="rx-field">
                        <span className="rx-field-label">Medications (comma separated)</span>
                        <input type="text" className="rx-field-input" value={careEditData.mod_meds || ""} onChange={(e) => setCareEditData({ ...careEditData, mod_meds: e.target.value })} />
                      </label>
                      <label className="rx-field">
                        <span className="rx-field-label">Last visit (days ago)</span>
                        <input type="number" className="rx-field-input" value={careEditData.mod_last_visit ?? ""} onChange={(e) => setCareEditData({ ...careEditData, mod_last_visit: e.target.value })} />
                      </label>
                      <label className="rx-field">
                        <span className="rx-field-label">Notes</span>
                        <input type="text" className="rx-field-input" value={careEditData.mod_notes || ""} onChange={(e) => setCareEditData({ ...careEditData, mod_notes: e.target.value })} />
                      </label>
                    </div>
                    <div className="care-edit-section">
                      <div className="care-edit-section-head">⚗ Herb-Drug Interaction Check</div>
                      <div className="rx-field-row">
                        <label className="rx-field" style={{ flex: 1 }}>
                          <span className="rx-field-label">Safe together?</span>
                          <select className="rx-field-input" value={careEditData.interaction_safe ? "safe" : "unsafe"} onChange={(e) => setCareEditData({ ...careEditData, interaction_safe: e.target.value === "safe" })}>
                            <option value="safe">Safe — no known interaction</option>
                            <option value="unsafe">Warning — potential interaction</option>
                          </select>
                        </label>
                      </div>
                      <label className="rx-field">
                        <span className="rx-field-label">Interaction notes</span>
                        <input type="text" className="rx-field-input" value={careEditData.interaction_notes || ""} onChange={(e) => setCareEditData({ ...careEditData, interaction_notes: e.target.value })} />
                      </label>
                    </div>
                    <div className="care-edit-section">
                      <div className="care-edit-section-head">📈 Progress</div>
                      <div className="rx-field-row">
                        <label className="rx-field" style={{ flex: 1 }}>
                          <span className="rx-field-label">Current BP</span>
                          <input type="text" className="rx-field-input" placeholder="e.g. 135/85" value={careEditData.bp_current || ""} onChange={(e) => setCareEditData({ ...careEditData, bp_current: e.target.value })} />
                        </label>
                        <label className="rx-field" style={{ flex: 1 }}>
                          <span className="rx-field-label">Months on plan</span>
                          <input type="number" className="rx-field-input" value={careEditData.months_on_plan ?? ""} onChange={(e) => setCareEditData({ ...careEditData, months_on_plan: e.target.value })} />
                        </label>
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div className="rx-modal-footer">
                <button className="rx-modal-cancel" onClick={() => setShowCareEdit(null)}>Cancel</button>
                <button className="rx-modal-submit" onClick={saveCareEdit} disabled={careSaving}>
                  {careSaving ? "Saving..." : "Save changes"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Symptom Form Modal */}
        {showSymptomForm && (
          <div className="rx-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) { setShowSymptomForm(false); } }}>
            <div className="rx-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="rx-modal-header">
                <div>
                  <div className="rx-modal-title">Describe Your Symptom</div>
                  <div className="rx-modal-subtitle">A few details help Amina assess you properly. Only the first field is required.</div>
                </div>
                <button className="rx-modal-close" onClick={() => setShowSymptomForm(false)}>✕</button>
              </div>
              <div className="rx-modal-body">
                <label className="rx-field">
                  <span className="rx-field-label">Main symptom <span className="rx-req">*</span></span>
                  <input type="text" className="rx-field-input" placeholder="e.g. chest pain, headache, dizziness" value={symptomForm.main} onChange={(e) => setSymptomForm({ ...symptomForm, main: e.target.value })} autoFocus />
                </label>
                <div className="rx-field-row">
                  <label className="rx-field" style={{ flex: 1 }}>
                    <span className="rx-field-label">Where on body</span>
                    <input type="text" className="rx-field-input" placeholder="e.g. left chest" value={symptomForm.location} onChange={(e) => setSymptomForm({ ...symptomForm, location: e.target.value })} />
                  </label>
                  <label className="rx-field" style={{ flex: 1 }}>
                    <span className="rx-field-label">How long</span>
                    <input type="text" className="rx-field-input" placeholder="e.g. 2 days" value={symptomForm.duration} onChange={(e) => setSymptomForm({ ...symptomForm, duration: e.target.value })} />
                  </label>
                </div>
                <label className="rx-field">
                  <span className="rx-field-label">Severity: <span className="rx-sev-val">{symptomForm.severity}/10</span></span>
                  <input type="range" min="1" max="10" className="rx-severity" value={symptomForm.severity} onChange={(e) => setSymptomForm({ ...symptomForm, severity: e.target.value })} />
                  <div className="rx-sev-scale"><span>mild</span><span>moderate</span><span>severe</span></div>
                </label>
                <label className="rx-field">
                  <span className="rx-field-label">When did it start / what were you doing</span>
                  <input type="text" className="rx-field-input" placeholder="e.g. after breakfast, while walking" value={symptomForm.onset} onChange={(e) => setSymptomForm({ ...symptomForm, onset: e.target.value })} />
                </label>
                <div className="rx-field-row">
                  <label className="rx-field" style={{ flex: 1 }}>
                    <span className="rx-field-label">Makes it worse</span>
                    <input type="text" className="rx-field-input" placeholder="e.g. walking, eating" value={symptomForm.triggers} onChange={(e) => setSymptomForm({ ...symptomForm, triggers: e.target.value })} />
                  </label>
                  <label className="rx-field" style={{ flex: 1 }}>
                    <span className="rx-field-label">Makes it better</span>
                    <input type="text" className="rx-field-input" placeholder="e.g. resting, water" value={symptomForm.relief} onChange={(e) => setSymptomForm({ ...symptomForm, relief: e.target.value })} />
                  </label>
                </div>
                <label className="rx-field">
                  <span className="rx-field-label">Other things you feel</span>
                  <input type="text" className="rx-field-input" placeholder="e.g. sweating, nausea, dizziness" value={symptomForm.associated} onChange={(e) => setSymptomForm({ ...symptomForm, associated: e.target.value })} />
                </label>
                <label className="rx-field">
                  <span className="rx-field-label">What have you tried</span>
                  <input type="text" className="rx-field-input" placeholder="e.g. paracetamol, rest" value={symptomForm.tried} onChange={(e) => setSymptomForm({ ...symptomForm, tried: e.target.value })} />
                </label>
              </div>
              <div className="rx-modal-footer">
                <button className="rx-modal-cancel" onClick={() => setShowSymptomForm(false)}>Cancel</button>
                <button className="rx-modal-submit" onClick={submitSymptomForm} disabled={!symptomForm.main.trim()}>Send to Amina</button>
              </div>
            </div>
          </div>
        )}

        {/* Prescription Helper Modal */}
        {showRxHelper && (
          <div className="rx-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) { setShowRxHelper(false); } }}>
            <div className="rx-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="rx-modal-header">
                <div>
                  <div className="rx-modal-title">Enter Prescription Details</div>
                  <div className="rx-modal-subtitle">Type what your doctor prescribed — Amina will give safe-use guidance.</div>
                </div>
                <button className="rx-modal-close" onClick={() => setShowRxHelper(false)}>✕</button>
              </div>
              <div className="rx-modal-body">
                <label className="rx-field">
                  <span className="rx-field-label">Medication name <span className="rx-req">*</span></span>
                  <input
                    type="text"
                    className="rx-field-input"
                    placeholder="e.g. Metformin"
                    value={rxForm.name}
                    onChange={(e) => setRxForm({ ...rxForm, name: e.target.value })}
                    autoFocus
                  />
                </label>
                <label className="rx-field">
                  <span className="rx-field-label">Dosage</span>
                  <input
                    type="text"
                    className="rx-field-input"
                    placeholder="e.g. 500mg"
                    value={rxForm.dosage}
                    onChange={(e) => setRxForm({ ...rxForm, dosage: e.target.value })}
                  />
                </label>
                <label className="rx-field">
                  <span className="rx-field-label">How often</span>
                  <input
                    type="text"
                    className="rx-field-input"
                    placeholder="e.g. twice daily"
                    value={rxForm.frequency}
                    onChange={(e) => setRxForm({ ...rxForm, frequency: e.target.value })}
                  />
                </label>
                <label className="rx-field">
                  <span className="rx-field-label">Duration</span>
                  <input
                    type="text"
                    className="rx-field-input"
                    placeholder="e.g. 7 days"
                    value={rxForm.duration}
                    onChange={(e) => setRxForm({ ...rxForm, duration: e.target.value })}
                  />
                </label>
                <label className="rx-field">
                  <span className="rx-field-label">Extra notes</span>
                  <input
                    type="text"
                    className="rx-field-input"
                    placeholder="e.g. after food"
                    value={rxForm.notes}
                    onChange={(e) => setRxForm({ ...rxForm, notes: e.target.value })}
                  />
                </label>
              </div>
              <div className="rx-modal-footer">
                <button className="rx-modal-cancel" onClick={() => setShowRxHelper(false)}>Cancel</button>
                <button className="rx-modal-submit" onClick={submitRxForm} disabled={!rxForm.name.trim()}>Get Guidance</button>
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{CSS}</style>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&display=swap');

:root {
  --bg: #050810;
  --card: #0c1128;
  --border: rgba(255,255,255,0.05);
  --text: #e2e8f0;
  --muted: #64748b;
  --subtle: #94a3b8;
  --accent: #818cf8;
  --accent2: #6366f1;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Outfit', sans-serif; background: var(--bg); overflow: hidden; color: var(--text); }
.page { height: 100vh; width: 100vw; position: relative; overflow: hidden; }

.bg-grid {
  position: fixed; inset: 0;
  background-image: linear-gradient(rgba(99,102,241,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.03) 1px, transparent 1px);
  background-size: 60px 60px;
  pointer-events: none;
}

.orb { position: fixed; border-radius: 50%; filter: blur(120px); pointer-events: none; }
.orb1 { width: 600px; height: 600px; top: -20%; left: -10%; background: radial-gradient(circle, rgba(99,102,241,0.1), transparent 70%); animation: float1 18s ease-in-out infinite; }
.orb2 { width: 500px; height: 500px; bottom: -15%; right: -8%; background: radial-gradient(circle, rgba(139,92,246,0.08), transparent 70%); animation: float2 22s ease-in-out infinite; }

.layout { position: relative; z-index: 1; width: 100%; height: 100vh; display: flex; flex-direction: column; }

/* Header */
.header { flex-shrink: 0; border-bottom: 1px solid var(--border); backdrop-filter: blur(12px); background: rgba(5,8,16,0.7); }
.header-inner { max-width: 1600px; margin: 0 auto; width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 10px clamp(12px, 2vw, 32px); gap: 8px; }
.brand { display: flex; align-items: center; gap: 12px; }
.brand-icon { width: 38px; height: 38px; border-radius: 12px; background: linear-gradient(135deg, var(--accent2), #8b5cf6); display: flex; align-items: center; justify-content: center; }
.brand-text { display: flex; flex-direction: column; gap: 1px; }
.brand-name { font-weight: 700; font-size: 15px; }
.brand-status { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--muted); font-weight: 500; }
.status-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; }
.header-actions { display: flex; gap: 8px; }
.header-btn { background: transparent; border: 1px solid var(--border); border-radius: 10px; color: var(--muted); width: 34px; height: 34px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all .2s; font-size: 14px; }
.header-btn:hover { background: rgba(255,255,255,0.06); color: var(--text); }

/* Settings */
.settings-wrap { padding: 0 32px; max-width: 900px; margin: 10px auto 0; width: 100%; }
.settings { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 16px; }
.settings-label { color: var(--muted); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; }
.settings-row { display: flex; gap: 10px; margin-top: 8px; }
.settings-input { flex: 1; padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.07); background: rgba(0,0,0,.2); color: var(--text); font-size: 12px; outline: none; font-family: inherit; }
.settings-select option { background: #1a1a2e; color: var(--text); padding: 10px; }
.settings-select option:hover, .settings-select option:checked { background: #2d2d44; }
.settings-btn { padding: 10px 14px; border-radius: 10px; border: 1px solid rgba(99,102,241,0.2); background: rgba(99,102,241,0.06); color: var(--accent); font-size: 11px; font-weight: 600; cursor: pointer; font-family: inherit; }
.settings-section { margin-top: 16px; }
.select-wrap { position: relative; flex: 1; }
.settings-select { width: 100%; appearance: none; cursor: pointer; padding-right: 40px; }
.select-icon { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); color: var(--muted); pointer-events: none; }
.toggle-row { display: flex; align-items: center; justify-content: space-between; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); font-size: 12px; font-weight: 500; }
.toggle { width: 40px; height: 22px; border-radius: 11px; border: none; cursor: pointer; position: relative; transition: background .25s; padding: 0; }
.toggle-knob { width: 18px; height: 18px; border-radius: 50%; background: #fff; position: absolute; top: 2px; transition: transform .25s cubic-bezier(.34,1.56,.64,1); box-shadow: 0 1px 3px rgba(0,0,0,.3); }

/* Main */
.main { flex: 1; overflow-y: auto; width: 100%; }

/* ═══════════════════════════════════════════════════════════════
   3-COLUMN DASHBOARD LAYOUT — fluid responsive
   ═══════════════════════════════════════════════════════════════ */
.dashboard { display: grid; grid-template-columns: clamp(220px, 22vw, 320px) 1fr clamp(220px, 22vw, 320px); gap: clamp(8px, 1.2vw, 16px); max-width: 1600px; margin: 0 auto; width: 100%; padding: clamp(8px, 1vw, 12px) clamp(8px, 1.2vw, 16px); height: 100%; align-items: stretch; }
.sidebar { display: flex; flex-direction: column; gap: 10px; overflow-y: auto; padding-bottom: 20px; min-width: 0; overscroll-behavior: contain; scrollbar-gutter: stable; scrollbar-width: thin; scrollbar-color: rgba(129,140,248,0.25) transparent; }
.sidebar::-webkit-scrollbar { width: 4px; }
.sidebar::-webkit-scrollbar-track { background: transparent; }
.sidebar::-webkit-scrollbar-thumb { background: rgba(129,140,248,0.2); border-radius: 4px; }
.sidebar::-webkit-scrollbar-thumb:hover { background: rgba(129,140,248,0.4); }
.sidebar-head { display: flex; align-items: center; gap: 6px; padding: 6px 4px 2px; color: var(--muted); font-size: 10px; font-weight: 800; letter-spacing: 0.8px; text-transform: uppercase; }
.sidebar-head > svg { color: var(--accent); }
.center { overflow-y: auto; min-width: 0; }

/* Intermediate: squeeze sidebars as viewport narrows */
@media (max-width: 1400px) {
  .dashboard { grid-template-columns: 300px 1fr 300px; }
}
@media (max-width: 1260px) {
  .dashboard { grid-template-columns: 270px 1fr 270px; gap: 10px; padding: 10px; }
}
@media (max-width: 1100px) {
  .dashboard { grid-template-columns: 240px 1fr 240px; gap: 8px; padding: 8px; }
}
@media (max-width: 980px) {
  /* Drop to 2 cols: community left + center, right sidebar becomes scrollable row below */
  .dashboard { grid-template-columns: 220px 1fr; gap: 8px; padding: 8px; }
  .dashboard > aside:last-of-type { grid-column: 1 / -1; }
  .dashboard > aside:last-of-type.sidebar { flex-direction: row; overflow-x: auto; padding-bottom: 8px; }
  .dashboard > aside:last-of-type.sidebar > * { min-width: 260px; flex-shrink: 0; }
}
@media (max-width: 760px) {
  .dashboard { grid-template-columns: 1fr; gap: 10px; max-width: 600px; }
  .sidebar { flex-direction: row; overflow-x: auto; gap: 10px; padding-bottom: 10px; }
  .sidebar > .ccard { min-width: 260px; flex-shrink: 0; }
  .sidebar-head { position: sticky; left: 0; background: var(--bg); z-index: 1; }
}

/* ═══════════════════════════════════════════════════════════════
   COMMUNITY CARDS (ccard)
   ═══════════════════════════════════════════════════════════════ */
.ccard { width: 100%; text-align: left; padding: 16px 16px 18px; border-radius: 13px; border: 1px solid var(--border); background: linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.008)); color: var(--text); font-family: inherit; cursor: pointer; transition: all .22s ease; display: flex; flex-direction: column; gap: 10px; position: relative; overflow: hidden; flex-shrink: 0; }
.ccard:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(0,0,0,0.3); }
.ccard::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 2px; background: var(--ccolor, var(--accent)); opacity: 0.4; }
.ccard-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.ccard-badge { padding: 2.5px 7px; border-radius: 5px; font-size: 9px; font-weight: 800; letter-spacing: 0.5px; background: rgba(255,255,255,0.06); color: var(--muted); }
.ccard-pill { padding: 2.5px 7px; border-radius: 5px; font-size: 9px; font-weight: 800; letter-spacing: 0.3px; text-transform: uppercase; }
.ccard-pill-good { background: rgba(34,197,94,0.14); color: #86efac; border: 1px solid rgba(34,197,94,0.28); }
.ccard-pill-warn { background: rgba(251,146,60,0.14); color: #fdba74; border: 1px solid rgba(251,146,60,0.28); }
.ccard-pill-bronze { background: rgba(180,83,9,0.16); color: #fdba74; border: 1px solid rgba(180,83,9,0.32); }
.ccard-pill-silver { background: rgba(148,163,184,0.14); color: #cbd5e1; border: 1px solid rgba(148,163,184,0.28); }
.ccard-pill-gold { background: rgba(234,179,8,0.14); color: #fde047; border: 1px solid rgba(234,179,8,0.32); }
.ccard-pill-platinum { background: rgba(129,140,248,0.16); color: var(--accent); border: 1px solid rgba(129,140,248,0.32); }
.ccard-title { font-size: 15px; font-weight: 800; line-height: 1.25; }
.ccard-sub { font-size: 10.5px; color: var(--subtle); line-height: 1.45; }
.ccard-date { font-size: 9.5px; color: var(--muted); font-weight: 600; }
.ccard-highlight { font-size: 11px; color: var(--subtle); font-style: italic; padding-top: 8px; border-top: 1px dashed var(--border); line-height: 1.45; }
.ccard-updated { display: flex; align-items: center; gap: 4px; font-size: 9px; color: var(--muted); font-weight: 600; margin-top: 2px; }
.ccard-updated > svg { opacity: 0.6; }

/* Per-card accent colors */
.ccard-bantaba { --ccolor: #a78bfa; }
.ccard-bantaba::before { background: linear-gradient(90deg, #a78bfa, #6366f1); }
.ccard-badge-bantaba { background: rgba(167,139,250,0.14); color: #c4b5fd; }

.ccard-scout { --ccolor: #f59e0b; }
.ccard-scout::before { background: linear-gradient(90deg, #f59e0b, #d97706); }
.ccard-badge-scout { background: rgba(245,158,11,0.14); color: #fcd34d; }

.ccard-village { --ccolor: #06b6d4; }
.ccard-village::before { background: linear-gradient(90deg, #06b6d4, #0891b2); }
.ccard-badge-village { background: rgba(6,182,212,0.14); color: #67e8f9; }

.ccard-seasonal { --ccolor: #22c55e; }
.ccard-seasonal::before { background: linear-gradient(90deg, #22c55e, #15803d); }
.ccard-badge-seasonal { background: rgba(34,197,94,0.14); color: #86efac; }

.ccard-bridge { --ccolor: #ec4899; }
.ccard-bridge::before { background: linear-gradient(90deg, #ec4899, #be185d); }
.ccard-badge-bridge { background: rgba(236,72,153,0.14); color: #f9a8d4; }

/* Bantaba ring */
.ccard-ring-row { display: flex; align-items: center; gap: 12px; }
.ccard-ring { --pct: 0; width: 60px; height: 60px; border-radius: 50%; background: conic-gradient(#a78bfa calc(var(--pct) * 1%), rgba(255,255,255,0.05) 0); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.ccard-ring-inner { width: 48px; height: 48px; border-radius: 50%; background: var(--card); display: flex; flex-direction: column; align-items: center; justify-content: center; }
.ccard-ring-val { font-size: 15px; font-weight: 800; color: var(--text); line-height: 1; }
.ccard-ring-val > span { font-size: 9px; color: var(--subtle); margin-left: 1px; }
.ccard-ring-label { font-size: 8px; color: var(--muted); font-weight: 700; letter-spacing: 0.3px; text-transform: uppercase; margin-top: 2px; }
.ccard-avatars { display: flex; flex-wrap: wrap; gap: 4px; flex: 1; }
.ccard-avatar { width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 800; color: white; border: 2px solid var(--card); }
.ccard-avatar-more { background: rgba(255,255,255,0.08) !important; color: var(--muted) !important; }

/* Scout mission + progress */
.scout-progress { display: flex; flex-direction: column; gap: 5px; }
.scout-progress-head { display: flex; justify-content: space-between; align-items: center; font-size: 10px; color: var(--subtle); font-weight: 600; }
.scout-progress-head strong { color: #fcd34d; font-weight: 800; }
.scout-bar { height: 6px; border-radius: 4px; background: rgba(255,255,255,0.06); overflow: hidden; }
.scout-bar-fill { height: 100%; background: linear-gradient(90deg, #f59e0b, #fbbf24); border-radius: 4px; transition: width .4s ease; }
.scout-bar-fill-gold { background: linear-gradient(90deg, #eab308, #fde047); }
.scout-mission { padding: 10px 11px; border-radius: 9px; background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.24); display: flex; flex-direction: column; gap: 6px; }
.scout-mission-head { display: flex; align-items: center; gap: 6px; font-size: 9.5px; color: #fcd34d; font-weight: 800; letter-spacing: 0.4px; text-transform: uppercase; }
.scout-mission-count { margin-left: auto; color: var(--text); }
.scout-mission-title { font-size: 12px; color: var(--text); font-weight: 600; line-height: 1.35; }

.ccard-bottom-row { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
.scout-select-mini { flex: 1; padding: 5px 6px; border-radius: 6px; border: 1px solid rgba(245,158,11,0.25); background: rgba(0,0,0,0.2); color: var(--text); font-size: 10px; font-weight: 600; font-family: inherit; cursor: pointer; min-width: 0; }
.scout-select-mini:focus { border-color: rgba(245,158,11,0.50); outline: none; }

.role-badge-scout { background: rgba(245,158,11,0.12); border: 1px solid rgba(245,158,11,0.34); color: #fcd34d; }

.scout-apply-success { padding: 16px; border-radius: 10px; background: rgba(34,197,94,0.12); border: 1px solid rgba(34,197,94,0.30); color: #86efac; font-size: 14px; font-weight: 700; text-align: center; line-height: 1.5; }
.scout-apply-fail { padding: 16px; border-radius: 10px; background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.30); color: #fca5a5; font-size: 14px; font-weight: 700; text-align: center; line-height: 1.5; }
.scout-apply-note { padding: 8px 10px; border-radius: 7px; background: rgba(245,158,11,0.06); border: 1px solid rgba(245,158,11,0.16); color: var(--subtle); font-size: 11px; line-height: 1.45; margin-top: 6px; }

/* Village pillars */
.village-score-row { display: flex; gap: 12px; align-items: flex-start; }
.village-big-score { display: flex; flex-direction: column; align-items: center; padding: 6px 10px; border-radius: 10px; background: rgba(6,182,212,0.12); border: 1px solid rgba(6,182,212,0.28); flex-shrink: 0; }
.village-score-val { font-size: 26px; font-weight: 900; color: #67e8f9; line-height: 1; }
.village-score-max { font-size: 9.5px; color: var(--muted); font-weight: 700; }
.village-pillars { flex: 1; display: flex; flex-direction: column; gap: 4px; }
.village-pillar { display: grid; grid-template-columns: 1fr 50px 30px; gap: 6px; align-items: center; }
.village-pillar-name { font-size: 10px; color: var(--subtle); }
.village-pillar-bar { height: 4px; border-radius: 3px; background: rgba(255,255,255,0.05); overflow: hidden; }
.village-pillar-fill { height: 100%; background: #06b6d4; border-radius: 3px; }
.village-pillar-val { font-size: 9px; color: var(--muted); font-weight: 700; text-align: right; }
.village-leader { font-size: 10px; color: var(--subtle); }
.village-leader strong { color: #67e8f9; font-weight: 700; }

/* Seasonal */
.seasonal-tip { display: flex; align-items: flex-start; gap: 10px; padding: 10px 11px; border-radius: 9px; background: rgba(34,197,94,0.06); border: 1px solid rgba(34,197,94,0.18); }
.seasonal-tip-icon { font-size: 18px; flex-shrink: 0; line-height: 1; }
.seasonal-tip-text { font-size: 12px; color: var(--text); line-height: 1.45; }
.seasonal-ramadan { display: flex; flex-direction: column; gap: 3px; padding: 8px 10px; border-radius: 8px; background: rgba(251,146,60,0.08); border: 1px solid rgba(251,146,60,0.24); }
.seasonal-ramadan-badge { font-size: 9px; font-weight: 800; color: #fdba74; letter-spacing: 0.4px; }
.seasonal-ramadan > span:last-child { font-size: 10px; color: var(--subtle); }
.seasonal-footer { font-size: 10px; color: var(--muted); text-align: center; padding-top: 2px; }

/* Healer Bridge */
.bridge-paths { display: grid; grid-template-columns: 1fr auto 1fr; gap: 6px; align-items: stretch; }
.bridge-path { padding: 8px 9px; border-radius: 8px; background: rgba(255,255,255,0.03); border: 1px solid var(--border); display: flex; flex-direction: column; gap: 2px; }
.bridge-path-traditional { border-left: 2px solid #22c55e; }
.bridge-path-modern { border-left: 2px solid #06b6d4; }
.bridge-path-head { font-size: 9px; color: var(--muted); font-weight: 700; letter-spacing: 0.3px; text-transform: uppercase; }
.bridge-path-name { font-size: 11px; color: var(--text); font-weight: 700; line-height: 1.2; }
.bridge-path-meta { font-size: 9.5px; color: var(--subtle); }
.bridge-plus { display: flex; align-items: center; justify-content: center; font-size: 16px; color: var(--muted); font-weight: 600; padding: 0 2px; }
.bridge-progress { display: flex; align-items: center; gap: 7px; padding: 8px 10px; border-radius: 8px; background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.22); color: #86efac; font-size: 10.5px; line-height: 1.35; }
.bridge-progress > svg { flex-shrink: 0; }
.bridge-progress strong { color: var(--text); font-weight: 800; }
.bridge-supply-warn { padding: 6px 9px; border-radius: 7px; background: rgba(251,146,60,0.10); border: 1px solid rgba(251,146,60,0.26); color: #fdba74; font-size: 10.5px; font-weight: 600; }

/* Detail panel styles */
.panel-stat-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
.panel-stat { padding: 11px 10px; border-radius: 10px; background: rgba(167,139,250,0.08); border: 1px solid rgba(167,139,250,0.22); text-align: center; }
.panel-stat-val { font-size: 20px; font-weight: 900; color: #c4b5fd; line-height: 1; }
.panel-stat-lbl { font-size: 10px; color: var(--subtle); font-weight: 700; letter-spacing: 0.3px; text-transform: uppercase; margin-top: 4px; }
.panel-member-list { display: flex; flex-direction: column; gap: 6px; }
.panel-member { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 9px; background: rgba(0,0,0,0.22); border: 1px solid var(--border); }
.panel-member-avatar { width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; color: white; flex-shrink: 0; }
.panel-member-info { flex: 1; min-width: 0; }
.panel-member-name { font-size: 12px; color: var(--text); font-weight: 700; }
.panel-member-age { color: var(--muted); font-weight: 500; }
.panel-member-cond { font-size: 10px; color: var(--subtle); line-height: 1.3; }
.panel-member-score { padding: 3px 8px; border-radius: 6px; font-size: 10px; font-weight: 800; font-family: inherit; }
.panel-member-score.ok { background: rgba(34,197,94,0.14); color: #86efac; border: 1px solid rgba(34,197,94,0.28); }
.panel-member-score.mid { background: rgba(251,146,60,0.14); color: #fdba74; border: 1px solid rgba(251,146,60,0.28); }
.panel-member-score.low { background: rgba(239,68,68,0.14); color: #fca5a5; border: 1px solid rgba(239,68,68,0.28); }
.panel-flag { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.panel-flag-green { background: #22c55e; box-shadow: 0 0 6px rgba(34,197,94,0.6); }
.panel-flag-yellow { background: #eab308; box-shadow: 0 0 6px rgba(234,179,8,0.6); }
.panel-flag-red { background: #ef4444; box-shadow: 0 0 8px rgba(239,68,68,0.7); }
.village-hero { display: flex; align-items: baseline; gap: 8px; padding: 14px 16px; border-radius: 12px; background: linear-gradient(135deg, rgba(6,182,212,0.14), rgba(6,182,212,0.03)); border: 1px solid rgba(6,182,212,0.28); flex-wrap: wrap; }
.village-hero-score { font-size: 40px; font-weight: 900; color: #67e8f9; line-height: 1; }
.village-hero-max { font-size: 13px; color: var(--subtle); font-weight: 700; }
.village-hero-delta { margin-left: auto; padding: 4px 10px; border-radius: 7px; background: rgba(34,197,94,0.12); color: #86efac; font-size: 11px; font-weight: 800; border: 1px solid rgba(34,197,94,0.26); }
.panel-pillars { display: flex; flex-direction: column; gap: 10px; }
.panel-pillar { display: flex; flex-direction: column; gap: 4px; padding: 9px 11px; border-radius: 9px; background: rgba(0,0,0,0.22); border: 1px solid var(--border); }
.panel-pillar-top { display: flex; justify-content: space-between; align-items: baseline; }
.panel-pillar-name { font-size: 12px; color: var(--text); font-weight: 700; }
.panel-pillar-score { font-size: 14px; color: #67e8f9; font-weight: 800; }
.panel-pillar-score span { font-size: 10px; color: var(--muted); font-weight: 600; }
.panel-pillar-detail { font-size: 10.5px; color: var(--subtle); line-height: 1.4; margin-top: 2px; }
.panel-badges { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.panel-badge { display: flex; align-items: center; gap: 8px; padding: 10px 11px; border-radius: 9px; background: rgba(0,0,0,0.22); border: 1px solid var(--border); opacity: 0.45; }
.panel-badge-on { opacity: 1; background: rgba(245,158,11,0.1); border-color: rgba(245,158,11,0.32); }
.panel-badge-icon { width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; background: rgba(255,255,255,0.06); color: var(--muted); }
.panel-badge-on .panel-badge-icon { background: linear-gradient(135deg, #fbbf24, #f59e0b); color: #1f1405; }
.panel-badge-name { font-size: 11px; color: var(--text); font-weight: 700; }
.panel-tips { display: flex; flex-direction: column; gap: 7px; }
.panel-tip { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border-radius: 9px; background: rgba(0,0,0,0.22); border: 1px solid var(--border); font-size: 12px; line-height: 1.45; color: var(--text); }
.panel-tip-icon { font-size: 16px; line-height: 1; flex-shrink: 0; margin-top: 1px; }
.panel-rowblock { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border-radius: 9px; background: rgba(0,0,0,0.22); border: 1px solid var(--border); font-size: 12px; line-height: 1.5; color: var(--text); }
.panel-rowblock strong { color: var(--subtle); font-weight: 700; }

/* Skeleton */
.ccard-skel { opacity: 0.5; }
.ccard-skel::before { background: var(--border); }
.ccard-badge-skel { background: rgba(255,255,255,0.04); }
.ccard-skel-line { height: 10px; border-radius: 5px; background: rgba(255,255,255,0.04); animation: skel-pulse 1.4s ease infinite; }
@keyframes skel-pulse { 0%,100% { opacity: 0.5; } 50% { opacity: 0.8; } }

/* Welcome */
.welcome { padding: clamp(16px, 3vw, 28px) clamp(14px, 3vw, 32px) 40px; display: flex; flex-direction: column; align-items: center; max-width: 860px; margin: 0 auto; width: 100%; }
.welcome-section { margin-bottom: clamp(12px, 2vw, 20px); display: flex; flex-direction: column; align-items: center; text-align: center; width: 100%; }
.welcome-section:last-child { margin-bottom: 0; }

.avatar-wrapper { position: relative; width: 170px; height: 170px; display: flex; align-items: center; justify-content: center; }

.badge { display: inline-flex; align-items: center; gap: 6px; padding: 5px 14px; border-radius: 99px; background: rgba(99,102,241,0.06); border: 1px solid rgba(99,102,241,0.12); color: var(--accent); font-size: 10px; font-weight: 700; letter-spacing: .8px; text-transform: uppercase; }
.badge-dot { display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: var(--accent); animation: pulse 2s ease-in-out infinite; }

.title { font-size: clamp(26px, 3.5vw, 38px); font-weight: 900; letter-spacing: -1.2px; line-height: 1.2; }
.highlight { background: linear-gradient(135deg, #c7d2fe, var(--accent2)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.wave { font-size: clamp(24px, 3vw, 34px); display: inline-block; animation: wave 1.8s ease-in-out infinite; transform-origin: 70% 70%; -webkit-text-fill-color: initial; }
.description { color: var(--subtle); font-size: clamp(13px, 1.5vw, 16px); line-height: 1.8; max-width: 480px; }

.divider { width: 100%; max-width: 500px; display: flex; align-items: center; gap: 14px; color: var(--muted); font-size: 10px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px; }
.divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: var(--border); }

/* Quick action tiles on welcome screen */
.quick-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; max-width: 560px; width: 100%; align-items: stretch; }
.quick-tile { display: flex; align-items: center; gap: 12px; padding: 14px 14px; border-radius: 14px; border: 1px solid var(--border); background: linear-gradient(135deg, rgba(255,255,255,0.035), rgba(255,255,255,0.01)); text-align: left; cursor: pointer; font-family: inherit; transition: all .22s ease; color: var(--text); min-width: 0; height: 100%; }
.quick-tile:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0,0,0,0.28); }
.quick-tile:disabled { opacity: .55; cursor: wait; }
.quick-tile-plan { border-color: rgba(129,140,248,0.28); }
.quick-tile-plan:hover:not(:disabled) { border-color: rgba(129,140,248,0.52); background: linear-gradient(135deg, rgba(129,140,248,0.10), rgba(129,140,248,0.02)); }
.quick-tile-notif { border-color: rgba(34,197,94,0.26); }
.quick-tile-notif:hover:not(:disabled) { border-color: rgba(34,197,94,0.5); background: linear-gradient(135deg, rgba(34,197,94,0.10), rgba(34,197,94,0.02)); }
.quick-tile-scout-apply { border-color: rgba(245,158,11,0.28); }
.quick-tile-scout-apply:hover:not(:disabled) { border-color: rgba(245,158,11,0.52); background: linear-gradient(135deg, rgba(245,158,11,0.10), rgba(245,158,11,0.02)); }
.quick-tile-has-data { background: linear-gradient(135deg, rgba(129,140,248,0.08), rgba(129,140,248,0.02)); }
.quick-tile-notif.quick-tile-has-data { background: linear-gradient(135deg, rgba(34,197,94,0.08), rgba(34,197,94,0.02)); }
.quick-tile-icon { width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border-radius: 10px; background: rgba(129,140,248,0.14); color: var(--accent); flex-shrink: 0; }
.quick-tile-plan .quick-tile-icon { background: rgba(129,140,248,0.14); color: var(--accent); }
.quick-tile-notif .quick-tile-icon { background: rgba(34,197,94,0.14); color: #86efac; }
.quick-tile-scout-apply .quick-tile-icon { background: rgba(245,158,11,0.14); color: #fcd34d; }
.quick-tile-body { flex: 1; min-width: 0; }
.quick-tile-title { font-size: 13px; font-weight: 800; color: var(--text); margin-bottom: 3px; }
.quick-tile-sub { font-size: 11px; color: var(--subtle); line-height: 1.4; }
.quick-tile-arrow { color: var(--muted); flex-shrink: 0; transition: transform .2s; opacity: 0.6; }
.quick-tile:hover:not(:disabled) .quick-tile-arrow { transform: translateX(3px); color: var(--accent); opacity: 1; }

/* Chat header "Plan" button */
/* Language toggle (English / Mandinka) */
.lang-toggle { display: inline-flex; align-items: center; gap: 2px; padding: 3px; border-radius: 9px; border: 1px solid var(--border); background: rgba(0,0,0,0.25); margin-right: 4px; flex-shrink: 0; }
.lang-btn { padding: 5px 10px; border-radius: 6px; border: none; background: transparent; color: var(--subtle); font-size: 10px; font-weight: 800; font-family: inherit; cursor: pointer; transition: all .15s; letter-spacing: 0.2px; white-space: nowrap; }
.lang-btn:hover:not(:disabled) { color: var(--text); background: rgba(255,255,255,0.05); }
.lang-btn-active { background: rgba(129,140,248,0.20) !important; color: var(--accent) !important; }
.lang-btn:disabled { opacity: .4; cursor: not-allowed; }

/* One-time "Switch to Mandinka?" prompt banner */
.lang-prompt { display: flex; align-items: flex-start; gap: 11px; margin: 8px 0 14px; padding: 12px 14px; border-radius: 12px; background: linear-gradient(135deg, rgba(129,140,248,0.10), rgba(129,140,248,0.03)); border: 1px solid rgba(129,140,248,0.30); animation: rx-fade-in .25s ease; }
.lang-prompt-icon { width: 28px; height: 28px; border-radius: 8px; background: rgba(129,140,248,0.20); display: flex; align-items: center; justify-content: center; color: var(--accent); flex-shrink: 0; }
.lang-prompt-body { flex: 1; min-width: 0; }
.lang-prompt-title { font-size: 13px; font-weight: 800; color: var(--text); margin-bottom: 3px; }
.lang-prompt-sub { font-size: 11px; color: var(--subtle); line-height: 1.4; }
.lang-prompt-actions { display: flex; gap: 6px; flex-shrink: 0; align-items: center; }
.lang-prompt-btn { padding: 7px 12px; border-radius: 8px; border: 1px solid var(--border); background: transparent; color: var(--subtle); font-size: 11px; font-weight: 700; font-family: inherit; cursor: pointer; transition: all .18s; white-space: nowrap; }
.lang-prompt-btn-primary { background: linear-gradient(135deg, var(--accent2), #4f46e5); color: white; border-color: transparent; }
.lang-prompt-btn-primary:hover { filter: brightness(1.12); transform: translateY(-1px); }
.lang-prompt-btn-ghost:hover { background: rgba(255,255,255,0.05); color: var(--text); }
@media (max-width: 680px) {
  .lang-prompt { flex-direction: column; }
  .lang-prompt-actions { width: 100%; }
  .lang-prompt-actions .lang-prompt-btn { flex: 1; }
}

/* Tiny translate button under each assistant bubble */
/* Legacy translate-btn (kept for any stragglers) */
.translate-btn { display: inline-flex; align-items: center; gap: 4px; margin-top: 6px; padding: 3px 8px; border-radius: 6px; border: 1px solid rgba(129,140,248,0.22); background: rgba(129,140,248,0.06); color: var(--subtle); font-size: 10px; font-weight: 700; font-family: inherit; cursor: pointer; transition: all .15s; }

/* Unified professional action bar under assistant messages */
.msg-actions { display: inline-flex; align-items: center; gap: 2px; margin-top: 6px; padding: 3px; border-radius: 8px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); }
.msg-action-btn { display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; border-radius: 5px; border: none; background: transparent; color: var(--muted); font-size: 10px; font-weight: 600; font-family: inherit; cursor: pointer; transition: all .12s ease; letter-spacing: 0.2px; }
.msg-action-btn:hover:not(:disabled) { background: rgba(129,140,248,0.10); color: var(--text); }
.msg-action-btn:disabled { opacity: 0.5; cursor: wait; }
.msg-action-btn > svg { flex-shrink: 0; opacity: 0.85; }
.msg-action-icon { padding: 5px 6px; }  /* icon-only buttons are slightly narrower */
.msg-action-btn-on { background: rgba(129,140,248,0.14); color: var(--accent); }
.msg-action-btn-on:hover { background: rgba(129,140,248,0.22); color: var(--accent); }
.msg-action-btn-good { background: rgba(34,197,94,0.12); color: #86efac; }
.msg-action-btn-good:hover { background: rgba(34,197,94,0.20); color: #86efac; }
.msg-action-btn-bad { background: rgba(239,68,68,0.12); color: #fca5a5; }
.msg-action-btn-bad:hover { background: rgba(239,68,68,0.20); color: #fca5a5; }

/* Downvote reason picker */
.reason-picker { margin-top: 8px; padding: 10px 12px; border-radius: 10px; background: rgba(239,68,68,0.06); border: 1px solid rgba(239,68,68,0.22); animation: rx-fade-in .18s ease; max-width: 420px; }
.reason-picker-title { font-size: 11px; font-weight: 800; color: #fca5a5; letter-spacing: 0.4px; text-transform: uppercase; margin-bottom: 8px; }
.reason-picker-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 6px; }
.reason-pick { padding: 6px 10px; border-radius: 6px; border: 1px solid rgba(239,68,68,0.20); background: rgba(0,0,0,0.18); color: var(--text); font-size: 11px; font-weight: 600; font-family: inherit; cursor: pointer; text-align: left; transition: all .15s; }
.reason-pick:hover { background: rgba(239,68,68,0.14); border-color: rgba(239,68,68,0.42); color: #fca5a5; }
.reason-picker-skip { width: 100%; padding: 4px 8px; border-radius: 6px; border: none; background: transparent; color: var(--muted); font-size: 10px; font-family: inherit; cursor: pointer; text-align: center; }
.reason-picker-skip:hover { color: var(--subtle); }

/* Feedback thanks banner */
.feedback-thanks { margin-top: 6px; padding: 5px 10px; border-radius: 6px; font-size: 10px; font-weight: 700; animation: rx-fade-in .2s ease; display: inline-block; }
.feedback-thanks-good { background: rgba(34,197,94,0.12); color: #86efac; border: 1px solid rgba(34,197,94,0.26); }
.feedback-thanks-bad { background: rgba(129,140,248,0.10); color: var(--accent); border: 1px solid rgba(129,140,248,0.26); }

.chat-plan-btn { display: flex; align-items: center; gap: 5px; padding: 6px 10px; border-radius: 9px; border: 1px solid rgba(129,140,248,0.24); background: rgba(129,140,248,0.08); color: var(--accent); font-size: 11px; font-weight: 700; font-family: inherit; cursor: pointer; transition: all .2s; flex-shrink: 0; }
.chat-plan-btn:hover:not(:disabled) { background: rgba(129,140,248,0.18); border-color: rgba(129,140,248,0.48); transform: translateY(-1px); }
.chat-plan-btn:disabled { opacity: .4; cursor: not-allowed; }

/* Care Plan Modal */
.plan-modal { max-width: 640px; width: 100%; max-height: 90vh; overflow-y: auto; background: var(--card); border: 1px solid var(--border); border-radius: 18px; box-shadow: 0 24px 64px rgba(0,0,0,0.6); animation: rx-slide-in .24s cubic-bezier(.34,1.56,.64,1); }
.plan-modal-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding: 18px 22px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--card); z-index: 2; border-radius: 18px 18px 0 0; }
.plan-title-wrap { display: flex; flex-direction: column; gap: 4px; }
.plan-title-row { display: flex; align-items: center; gap: 8px; color: var(--accent); }
.plan-modal-title { font-size: 17px; font-weight: 800; color: var(--text); }
.plan-generated { font-size: 10px; color: var(--muted); font-weight: 600; }
.plan-modal-actions { display: flex; align-items: center; gap: 8px; }
.plan-regen-btn { display: flex; align-items: center; gap: 5px; padding: 7px 11px; border-radius: 9px; border: 1px solid rgba(129,140,248,0.3); background: rgba(129,140,248,0.1); color: var(--accent); font-size: 11px; font-weight: 700; font-family: inherit; cursor: pointer; transition: all .18s; }
.plan-regen-btn:hover:not(:disabled) { background: rgba(129,140,248,0.2); border-color: rgba(129,140,248,0.5); }
.plan-regen-btn:disabled { opacity: .5; cursor: wait; }

/* Document preview */
.doc-section { margin-bottom: 14px; }
.doc-section-head { font-size: 13px; font-weight: 800; color: var(--accent); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.4px; }
.doc-section-body { font-size: 13px; color: var(--text); line-height: 1.65; white-space: pre-wrap; }
.doc-recs { margin: 0; padding-left: 20px; font-size: 13px; color: var(--text); line-height: 1.65; }
.doc-recs li { margin-bottom: 4px; }
.doc-disclaimer { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border); font-size: 10px; color: var(--muted); font-style: italic; line-height: 1.45; }
.doc-action-btn { display: flex; align-items: center; gap: 4px; padding: 5px 9px; border-radius: 7px; border: 1px solid var(--border); background: rgba(255,255,255,0.03); color: var(--subtle); font-size: 10px; font-weight: 700; font-family: inherit; cursor: pointer; transition: all .15s; }
.doc-action-btn:hover { background: rgba(129,140,248,0.12); color: var(--accent); border-color: rgba(129,140,248,0.4); }
.doc-action-dl { border-color: rgba(34,197,94,0.30); color: #86efac; }
.doc-action-dl:hover { background: rgba(34,197,94,0.16); border-color: rgba(34,197,94,0.5); }
.doc-action-btn:disabled { opacity: 0.5; cursor: not-allowed; pointer-events: none; }
.btn-spinner { display: inline-block; width: 12px; height: 12px; border: 2px solid rgba(134,239,172,0.3); border-top-color: #86efac; border-radius: 50%; animation: spin 0.6s linear infinite; }
.doc-action-good { background: rgba(34,197,94,0.14) !important; color: #86efac !important; }
.doc-action-bad { background: rgba(239,68,68,0.14) !important; color: #fca5a5 !important; }
.plan-modal-body { padding: 18px 22px; display: flex; flex-direction: column; gap: 16px; }
.plan-summary { padding: 12px 14px; border-radius: 11px; background: linear-gradient(135deg, rgba(129,140,248,0.12), rgba(129,140,248,0.03)); border: 1px solid rgba(129,140,248,0.24); color: var(--text); font-size: 13px; line-height: 1.55; }
.plan-block { display: flex; flex-direction: column; gap: 7px; }
.plan-block-head { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px; padding: 3px 8px; border-radius: 6px; align-self: flex-start; }
.plan-head-priority { background: rgba(251,146,60,0.14); color: #fdba74; border: 1px solid rgba(251,146,60,0.3); }
.plan-head-goals { background: rgba(129,140,248,0.14); color: var(--accent); border: 1px solid rgba(129,140,248,0.28); }
.plan-head-monitor { background: rgba(59,130,246,0.14); color: #93c5fd; border: 1px solid rgba(59,130,246,0.28); }
.plan-head-diet { background: rgba(34,197,94,0.14); color: #86efac; border: 1px solid rgba(34,197,94,0.28); }
.plan-head-exercise { background: rgba(168,85,247,0.14); color: #c4b5fd; border: 1px solid rgba(168,85,247,0.28); }
.plan-head-meds { background: rgba(236,72,153,0.14); color: #f9a8d4; border: 1px solid rgba(236,72,153,0.28); }
.plan-head-warn { background: rgba(239,68,68,0.14); color: #fca5a5; border: 1px solid rgba(239,68,68,0.28); }
.plan-block-warn { padding: 12px 14px; border-radius: 11px; background: rgba(239,68,68,0.06); border: 1px solid rgba(239,68,68,0.18); }
.plan-priority-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.plan-priority-list li { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border-radius: 10px; background: rgba(0,0,0,0.25); border: 1px solid var(--border); font-size: 13px; color: var(--text); line-height: 1.45; }
.plan-num { flex-shrink: 0; width: 22px; height: 22px; border-radius: 6px; background: rgba(251,146,60,0.2); color: #fdba74; font-size: 11px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
.plan-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 5px; }
.plan-list li { position: relative; padding: 6px 8px 6px 20px; font-size: 12px; line-height: 1.5; color: var(--text); }
.plan-list li::before { content: "•"; position: absolute; left: 6px; top: 6px; color: var(--accent); font-weight: 800; }
.plan-block-warn .plan-list li::before { color: #ef4444; }
.plan-rows { display: flex; flex-direction: column; gap: 5px; }
.plan-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; padding: 8px 10px; border-radius: 8px; background: rgba(0,0,0,0.22); border: 1px solid var(--border); font-size: 12px; line-height: 1.4; }
.plan-row-task { font-weight: 700; color: var(--text); }
.plan-row-freq { font-size: 11px; color: var(--accent); font-weight: 600; }
.plan-row-note { font-size: 11px; color: var(--subtle); width: 100%; font-style: italic; }
@media (max-width: 480px) {
  .quick-tiles { grid-template-columns: 1fr; }
}

.reminders-strip { max-width: min(520px, 100%); width: 100%; text-align: left; padding: 12px 14px; border-radius: 12px; background: rgba(99,102,241,0.06); border: 1px solid rgba(99,102,241,0.18); }
.reminders-head { display: flex; align-items: center; gap: 7px; margin-bottom: 10px; font-size: 11px; font-weight: 800; color: var(--accent); text-transform: uppercase; letter-spacing: 0.4px; }
.reminders-head > svg { color: var(--accent); }
.reminders-count { margin-left: auto; min-width: 18px; height: 18px; padding: 0 5px; display: inline-flex; align-items: center; justify-content: center; border-radius: 9px; background: var(--accent); color: #0c1128; font-size: 10px; font-weight: 800; }
.reminders-list { display: flex; flex-direction: column; gap: 6px; }
.reminder-row { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 8px; background: rgba(0,0,0,0.22); border: 1px solid var(--border); }
.reminder-when { font-size: 11px; font-weight: 700; color: var(--text); white-space: nowrap; }
.reminder-note { flex: 1; font-size: 11px; color: var(--subtle); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.reminder-remove { width: 18px; height: 18px; border-radius: 5px; border: none; background: rgba(255,255,255,0.04); color: var(--muted); font-size: 10px; cursor: pointer; font-family: inherit; flex-shrink: 0; transition: all .15s; }
.reminder-remove:hover { background: rgba(239,68,68,0.18); color: #fca5a5; }

.nudge-card { max-width: min(520px, 100%); width: 100%; text-align: left; padding: 16px 18px; border-radius: 14px; background: linear-gradient(135deg, rgba(34,197,94,0.08), rgba(34,197,94,0.02)); border: 1px solid rgba(34,197,94,0.22); cursor: pointer; transition: all .22s ease; }
.nudge-card:hover { border-color: rgba(34,197,94,0.42); transform: translateY(-2px); box-shadow: 0 10px 28px rgba(34,197,94,0.12); }
.nudge-badge { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; border-radius: 6px; background: rgba(34,197,94,0.16); color: #86efac; font-size: 10px; font-weight: 800; letter-spacing: 0.5px; margin-bottom: 10px; }
.nudge-title { font-size: 15px; font-weight: 800; color: var(--text); margin-bottom: 6px; }
.nudge-action { font-size: 14px; color: #cbd5e1; line-height: 1.5; margin-bottom: 8px; }
.nudge-why { font-size: 12px; color: var(--subtle); line-height: 1.5; font-style: italic; }
.anon-badge { display: inline-flex; align-items: center; gap: 4px; padding: 4px 9px; border-radius: 8px; background: rgba(251,191,36,0.10); border: 1px solid rgba(251,191,36,0.28); color: #fcd34d; font-size: 10px; font-weight: 800; letter-spacing: 0.3px; text-transform: uppercase; margin-right: 6px; }

.role-badge { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 8px; font-size: 10px; font-weight: 800; letter-spacing: 0.3px; margin-right: 6px; }
.role-badge-alkalo { background: rgba(168,85,247,0.12); border: 1px solid rgba(168,85,247,0.34); color: #c4b5fd; }
.role-badge-clinician { background: rgba(251,146,60,0.12); border: 1px solid rgba(251,146,60,0.34); color: #fdba74; }
.role-badge-vhw { background: rgba(34,197,94,0.12); border: 1px solid rgba(34,197,94,0.34); color: #86efac; }

.ccard-edit-row { display: flex; gap: 5px; margin-top: 8px; }
.ccard-edit-btn { display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; border-radius: 6px; border: 1px solid rgba(251,146,60,0.30); background: rgba(251,146,60,0.10); color: #fdba74; font-size: 10px; font-weight: 700; font-family: inherit; cursor: pointer; transition: all .15s; }
.ccard-edit-btn:hover { background: rgba(251,146,60,0.22); border-color: rgba(251,146,60,0.52); }

.care-edit-section { margin-bottom: 6px; padding: 12px 14px; border-radius: 10px; background: rgba(0,0,0,0.18); border: 1px solid var(--border); }
.care-edit-section-head { font-size: 11px; font-weight: 800; color: var(--accent); letter-spacing: 0.4px; margin-bottom: 10px; }
.role-badge-imam { background: rgba(14,165,233,0.12); border: 1px solid rgba(14,165,233,0.34); color: #7dd3fc; }

.role-picker { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.role-pick-btn { display: flex; align-items: center; justify-content: flex-start; gap: 8px; padding: 8px 12px; border-radius: 9px; border: 1px solid var(--border); background: rgba(0,0,0,0.22); color: var(--subtle); font-size: 12px; font-weight: 700; font-family: inherit; cursor: pointer; transition: all .18s; }
.role-pick-btn:hover { background: rgba(255,255,255,0.04); color: var(--text); }
.role-pick-active { background: rgba(129,140,248,0.18) !important; color: var(--accent) !important; border-color: rgba(129,140,248,0.42) !important; }
.role-pick-icon { font-size: 14px; }

.vhw-banner { background: rgba(34,197,94,0.12); border: 1px solid rgba(34,197,94,0.30); border-radius: 12px 12px 0 0; padding: 7px 13px; display: flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 700; color: #86efac; letter-spacing: 0.3px; }
.journey-banner { border-radius: 12px 12px 0 0; padding: 7px 13px; display: flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 700; letter-spacing: 0.3px; }
.journey-good { background: rgba(34,197,94,0.14); border: 1px solid rgba(34,197,94,0.32); color: #86efac; }
.journey-warn { background: rgba(251,146,60,0.14); border: 1px solid rgba(251,146,60,0.32); color: #fdba74; }
.anniversary-banner { background: rgba(236,72,153,0.12); border: 1px solid rgba(236,72,153,0.30); border-radius: 12px 12px 0 0; padding: 7px 13px; display: flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 700; color: #f9a8d4; letter-spacing: 0.3px; }
.anon-hint { display: flex; align-items: center; gap: 6px; margin-top: 8px; padding: 8px 10px; border-radius: 8px; background: rgba(251,191,36,0.06); border: 1px solid rgba(251,191,36,0.18); color: #fcd34d; font-size: 11px; line-height: 1.4; }
.tags { display: flex; flex-wrap: wrap; gap: clamp(6px, 1vw, 12px); justify-content: center; max-width: 640px; }
.tag { padding: clamp(8px, 1vw, 11px) clamp(14px, 2vw, 26px); border-radius: 99px; background: rgba(129,140,248,0.04); border: 1px solid rgba(129,140,248,0.1); color: var(--accent); font-size: clamp(12px, 1.3vw, 15px); font-weight: 600; cursor: pointer; font-family: inherit; transition: all .2s; }
.tag:hover { background: rgba(129,140,248,0.12); border-color: rgba(129,140,248,0.25); transform: translateY(-3px); box-shadow: 0 8px 24px rgba(99,102,241,0.1); }

.hint { display: inline-flex; align-items: center; gap: 8px; color: var(--muted); font-size: 13px; font-weight: 500; }
.hint kbd { padding: 2px 8px; border-radius: 5px; background: rgba(255,255,255,0.04); border: 1px solid var(--border); font-size: 10px; color: var(--subtle); font-family: inherit; }

/* Chat */
.chat-container { max-width: 720px; margin: 0 auto; width: 100%; height: 100%; padding: 0 clamp(10px, 2.5vw, 32px); }
.chat { display: flex; flex-direction: column; height: 100%; }
.chat-header { display: flex; align-items: center; gap: 10px; padding: 12px 4px; margin-bottom: 6px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.chat-avatar { display: flex; align-items: center; justify-content: center; }
.chat-name { font-weight: 700; font-size: 14px; }
.chat-status { font-size: 11px; font-weight: 500; transition: color .3s; }
.messages { flex: 1; overflow-y: auto; padding: 8px 0; overscroll-behavior: contain; scrollbar-gutter: stable; scrollbar-width: thin; scrollbar-color: rgba(129,140,248,0.25) transparent; }
.messages::-webkit-scrollbar { width: 6px; }
.messages::-webkit-scrollbar-track { background: transparent; }
.messages::-webkit-scrollbar-thumb { background: rgba(129,140,248,0.2); border-radius: 4px; }
.messages::-webkit-scrollbar-thumb:hover { background: rgba(129,140,248,0.4); }

.msg-row { display: flex; animation: msgUp .3s ease both; margin-bottom: 16px; }

/* Compaction marker — rendered in place of the head of the conversation
   after the user hits compact. Visible divider + short summary so the
   user always knows context has been compressed but not lost. */
.msg-summary {
  display: flex; align-items: center; gap: 14px;
  margin: 18px 4px 22px;
  animation: msgUp .3s ease both;
}
.msg-summary-rule {
  flex: 1; height: 1px;
  background: linear-gradient(90deg, transparent, rgba(148, 163, 184, 0.28), transparent);
}
.msg-summary-body {
  flex: 0 1 520px;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(99, 102, 241, 0.06);
  border: 1px solid rgba(99, 102, 241, 0.22);
  color: #c7d2fe;
}
.msg-summary-kicker {
  display: inline-flex; align-items: center; gap: 6px;
  font-family: "JetBrains Mono", ui-monospace, Menlo, monospace;
  font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;
  font-weight: 600;
  color: #a5b4fc;
  margin-bottom: 4px;
}
.msg-summary-kicker svg { color: #a5b4fc; }
.msg-summary-text {
  font-size: 12.5px; line-height: 1.5;
  color: #e0e7ff;
  white-space: pre-wrap;
  word-break: break-word;
}
.msg-sources { margin-top: 8px; padding: 8px 10px; border-radius: 8px; background: rgba(99,102,241,0.04); border: 1px solid rgba(99,102,241,0.12); }
.msg-sources-label { display: flex; align-items: center; gap: 5px; font-size: 9px; font-weight: 800; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
.msg-sources-label > svg { color: var(--accent); opacity: 0.7; }
.msg-sources-list { display: flex; flex-direction: column; gap: 3px; }
.msg-source-link { display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 5px; background: rgba(0,0,0,0.15); text-decoration: none; color: var(--text); font-size: 11px; transition: all .15s; }
.msg-source-link:hover { background: rgba(99,102,241,0.12); color: var(--accent); }
.msg-source-org { padding: 1px 5px; border-radius: 3px; background: rgba(99,102,241,0.18); color: var(--accent); font-size: 9px; font-weight: 800; letter-spacing: 0.3px; flex-shrink: 0; }
.msg-source-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.msg-source-link > svg { flex-shrink: 0; color: var(--muted); opacity: 0.6; }

.msg-meta { display: flex; align-items: center; gap: 7px; margin-top: 5px; padding: 0 2px; }
.avatar-sm { width: 32px; height: 32px; border-radius: 11px; flex-shrink: 0; margin-right: 10px; background: linear-gradient(135deg, var(--accent2), #8b5cf6); display: flex; align-items: center; justify-content: center; margin-top: 2px; }
.avatar-user { width: 32px; height: 32px; border-radius: 11px; flex-shrink: 0; margin-left: 10px; background: rgba(99,102,241,0.08); display: flex; align-items: center; justify-content: center; margin-top: 2px; }
.bubble-user { background: rgba(99,102,241,0.08); border: 1px solid rgba(99,102,241,0.14); border-radius: 18px 18px 4px 18px; padding: 12px 18px; font-size: 15px; line-height: 1.7; white-space: pre-wrap; }
.bubble-ai { background: var(--card); border: 1px solid var(--border); border-radius: 18px 18px 18px 4px; padding: 12px 18px; font-size: 15px; line-height: 1.7; white-space: pre-wrap; }
.bubble-live { background: rgba(99,102,241,0.06); border: 1px dashed rgba(99,102,241,0.16); border-radius: 18px 18px 4px 18px; padding: 12px 18px; font-size: 15px; opacity: .75; white-space: pre-wrap; }
.bubble-listening { background: rgba(99,102,241,0.04); border-radius: 18px 18px 4px 18px; padding: 12px 18px; color: var(--subtle); font-size: 15px; font-style: italic; }
.msg-time { color: #475569; font-size: 10px; font-weight: 500; }
.triage-badge { font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 10px; border: 1px solid; letter-spacing: 0.3px; }
.followup-badge { font-size: 10px; font-weight: 500; padding: 2px 8px; border-radius: 10px; background: rgba(99,102,241,0.1); color: var(--accent); border: 1px solid rgba(99,102,241,0.2); }
.followup-wrap { position: relative; display: inline-block; }
.followup-btn { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 10px; background: rgba(99,102,241,0.1); color: var(--accent); border: 1px solid rgba(99,102,241,0.24); font-size: 10px; font-weight: 700; font-family: inherit; cursor: pointer; transition: all .18s ease; }
.followup-btn:hover { background: rgba(99,102,241,0.2); border-color: rgba(99,102,241,0.5); transform: translateY(-1px); }
.followup-btn-saved { background: rgba(34,197,94,0.12); color: #86efac; border-color: rgba(34,197,94,0.3); }
.followup-btn-saved:hover { background: rgba(34,197,94,0.22); border-color: rgba(34,197,94,0.55); }
.followup-menu { position: absolute; top: calc(100% + 4px); left: 0; z-index: 50; min-width: 170px; background: #0c1128; border: 1px solid var(--border); border-radius: 10px; padding: 4px; box-shadow: 0 8px 24px rgba(0,0,0,0.45); animation: rx-fade-in .14s ease; }
.followup-menu-item { width: 100%; display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 7px; border: none; background: transparent; color: var(--text); font-size: 12px; font-weight: 600; font-family: inherit; cursor: pointer; text-align: left; transition: background .15s; }
.followup-menu-item:hover { background: rgba(129,140,248,0.1); }
.followup-menu-item > svg { flex-shrink: 0; color: var(--accent); }
.emergency-banner { background: #7f1d1d; border: 1px solid #dc2626; border-radius: 12px 12px 0 0; padding: 8px 14px; display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: #fca5a5; animation: pulse 1.5s ease infinite; }
.form-cta-btn { display: inline-flex; align-items: center; gap: 7px; margin-top: 8px; padding: 9px 14px; border-radius: 10px; border: 1px solid rgba(129,140,248,0.35); background: rgba(129,140,248,0.12); color: var(--accent); font-size: 12px; font-weight: 800; font-family: inherit; cursor: pointer; transition: all .2s ease; }
.form-cta-btn:hover { background: rgba(129,140,248,0.22); border-color: rgba(129,140,248,0.55); transform: translateX(2px); }
.form-cta-symptom { border-color: rgba(251,146,60,0.42); background: rgba(251,146,60,0.14); color: #fdba74; }
.form-cta-symptom:hover { background: rgba(251,146,60,0.22); border-color: rgba(251,146,60,0.6); }
.form-cta-rx { border-color: rgba(99,102,241,0.42); background: rgba(99,102,241,0.14); color: var(--accent); }
.form-cta-rx-upload { border-color: rgba(34,197,94,0.38); background: rgba(34,197,94,0.12); color: #86efac; }
.form-cta-rx-upload:hover { background: rgba(34,197,94,0.22); border-color: rgba(34,197,94,0.55); }
.form-cta-row { display: flex; gap: 8px; flex-wrap: wrap; }

.support-banner { background: rgba(14,116,144,0.18); border: 1px solid rgba(34,211,238,0.32); border-radius: 12px 12px 0 0; padding: 7px 13px; display: flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 700; color: #67e8f9; text-transform: uppercase; letter-spacing: 0.4px; }
.nudge-banner { background: rgba(34,197,94,0.12); border: 1px solid rgba(34,197,94,0.30); border-radius: 12px 12px 0 0; padding: 7px 13px; display: flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 700; color: #86efac; text-transform: uppercase; letter-spacing: 0.4px; }
.bubble-emergency { border-radius: 0 0 18px 4px !important; border-top: none !important; border-color: #dc2626 !important; background: #1a0505 !important; }
.cursor { animation: blink .8s infinite; color: var(--accent); margin-left: 2px; }
.typing-dots { display: flex; gap: 5px; padding: 2px 0; }
.typing-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); animation: bounce 1.2s infinite; }

.spk { display: inline-flex; align-items: center; gap: 8px; padding: 8px 18px; border-radius: 12px; border: 1px solid rgba(129,140,248,0.15); background: rgba(129,140,248,0.05); cursor: pointer; color: var(--accent); transition: all .2s; font-family: inherit; font-size: 13px; }
.spk:hover { background: rgba(129,140,248,0.12); border-color: rgba(129,140,248,0.25); }
.spk-on { background: rgba(129,140,248,0.12); border-color: rgba(129,140,248,0.25); }
.spk-label { font-weight: 500; }
.spk-spin { width: 13px; height: 13px; border: 2px solid rgba(99,102,241,0.3); border-top: 2px solid var(--accent2); border-radius: 50%; animation: spin .6s linear infinite; }

/* Error */
.error-wrap { max-width: 720px; margin: 0 auto; padding: 0 32px; }
.error { display: flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 10px; background: rgba(239,68,68,0.05); border: 1px solid rgba(239,68,68,0.1); color: #fca5a5; font-size: 12px; margin-bottom: 4px; }
.error-close { background: none; border: none; color: #fca5a5; cursor: pointer; }

/* Bottom Bar */
.bottom-bar { flex-shrink: 0; border-top: 1px solid var(--border); backdrop-filter: blur(14px); background: rgba(5,8,16,0.72); }
.bottom-inner { max-width: 900px; margin: 0 auto; padding: 14px 32px 18px; }
.silence-bar { margin-bottom: 14px; }
.silence-track { height: 4px; border-radius: 999px; background: rgba(255,255,255,0.05); overflow: hidden; }
.silence-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, #eab308, #f97316, #ef4444); transition: width .12s ease; }

.bottom-row { display: grid; grid-template-columns: minmax(180px,1fr) auto minmax(180px,1fr); align-items: center; gap: 28px; }
.bottom-card { min-height: 88px; border: 1px solid rgba(255,255,255,0.06); background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02)); border-radius: 20px; padding: 16px 18px; display: flex; flex-direction: column; justify-content: center; }
.bottom-left { align-items: flex-start; }
.bottom-right { align-items: flex-end; text-align: right; }
.bottom-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); font-weight: 700; margin-bottom: 8px; }
.bottom-status { display: flex; align-items: center; gap: 8px; }
.bottom-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
.bottom-hint { color: var(--subtle); font-size: 13px; font-weight: 600; line-height: 1.4; }

.symptom-hint { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; padding: 10px 14px; border-radius: 12px; background: rgba(251,146,60,0.10); border: 1px solid rgba(251,146,60,0.28); color: #fed7aa; font-size: 12px; cursor: pointer; transition: all .2s; animation: rx-fade-in .25s ease; }
.symptom-hint:hover { background: rgba(251,146,60,0.16); border-color: rgba(251,146,60,0.44); }
.symptom-hint > svg { flex-shrink: 0; color: #fb923c; }
.symptom-hint > span { flex: 1; line-height: 1.4; }
.symptom-hint-btn { padding: 5px 11px; border-radius: 7px; border: 1px solid rgba(251,146,60,0.44); background: rgba(251,146,60,0.22); color: #fed7aa; font-size: 11px; font-weight: 700; font-family: inherit; cursor: pointer; white-space: nowrap; }
.symptom-hint-btn:hover { background: rgba(251,146,60,0.32); }

.notif-row { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 10px; background: rgba(0,0,0,0.22); border: 1px solid var(--border); }
.notif-label { display: flex; align-items: center; gap: 8px; min-width: 130px; font-size: 12px; font-weight: 700; color: var(--text); }
.notif-input { flex: 1; padding: 7px 10px; border-radius: 7px; border: 1px solid var(--border); background: rgba(0,0,0,0.3); color: var(--text); font-size: 12px; font-family: inherit; outline: none; }
.notif-input:focus { border-color: rgba(99,102,241,0.5); }
.notif-input::placeholder { color: var(--muted); }
.notif-checkbox { width: 17px; height: 17px; accent-color: var(--accent); cursor: pointer; margin-left: auto; }
.notif-row-toggle { cursor: pointer; }

.rx-field-row { display: flex; gap: 10px; }
.rx-severity { width: 100%; accent-color: var(--accent); }
.rx-sev-val { color: var(--accent); font-weight: 800; }
.rx-sev-scale { display: flex; justify-content: space-between; margin-top: 4px; font-size: 10px; color: var(--muted); font-weight: 600; }

.chat-back-btn { display: flex; align-items: center; gap: 5px; padding: 6px 10px; border-radius: 9px; border: 1px solid var(--border); background: rgba(255,255,255,0.03); color: var(--subtle); font-size: 11px; font-weight: 700; font-family: inherit; cursor: pointer; transition: all .2s; margin-right: 4px; }
.chat-back-btn:hover:not(:disabled) { background: rgba(129,140,248,0.10); border-color: rgba(129,140,248,0.3); color: var(--accent); }
.chat-back-btn:disabled { opacity: .4; cursor: not-allowed; }

.nudge-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.nudge-focus-chip { padding: 3px 8px; border-radius: 6px; background: rgba(255,255,255,0.04); border: 1px solid var(--border); color: var(--subtle); font-size: 10px; font-weight: 700; }
.nudge-reason { display: flex; align-items: center; gap: 6px; margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--border); color: var(--muted); font-size: 11px; line-height: 1.4; }
.nudge-reason > svg { flex-shrink: 0; color: var(--accent); }

.chat-input-row { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; padding: 8px; border: 1px solid var(--border); background: rgba(12,17,40,0.6); border-radius: 14px; backdrop-filter: blur(8px); }
.chat-input { flex: 1; padding: 10px 14px; border: none; background: transparent; color: var(--text); font-size: 14px; font-family: inherit; outline: none; }
.chat-input::placeholder { color: var(--muted); }
.chat-input:disabled { opacity: .5; cursor: not-allowed; }
.chat-send-btn { display: flex; align-items: center; justify-content: center; width: 38px; height: 38px; border-radius: 10px; border: none; background: linear-gradient(135deg, var(--accent2), #4f46e5); color: white; cursor: pointer; transition: all .2s ease; }
.chat-send-btn:hover:not(:disabled) { filter: brightness(1.1); transform: scale(1.04); }
.chat-send-btn:disabled { opacity: .35; cursor: not-allowed; background: rgba(100,116,139,0.3); }
.chat-rx-btn { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-radius: 10px; border: 1px solid rgba(99,102,241,0.22); background: rgba(99,102,241,0.08); color: var(--accent); font-size: 12px; font-weight: 700; font-family: inherit; cursor: pointer; transition: all .2s ease; }
.chat-rx-btn:hover:not(:disabled) { background: rgba(99,102,241,0.16); border-color: rgba(99,102,241,0.42); }
.chat-rx-btn:disabled { opacity: .5; cursor: not-allowed; }

.rx-modal-overlay { position: fixed; inset: 0; z-index: 100; background: rgba(5,8,16,0.75); backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center; padding: 20px; animation: rx-fade-in .18s ease; }
.rx-modal { max-width: 520px; width: 100%; max-height: 90vh; overflow-y: auto; background: var(--card); border: 1px solid var(--border); border-radius: 18px; box-shadow: 0 24px 64px rgba(0,0,0,0.6); animation: rx-slide-in .24s cubic-bezier(.34,1.56,.64,1); }
.rx-modal-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding: 20px 22px; border-bottom: 1px solid var(--border); }
.rx-modal-title { font-size: 17px; font-weight: 800; color: var(--text); margin-bottom: 4px; }
.rx-modal-subtitle { font-size: 12px; color: var(--subtle); line-height: 1.5; }
.rx-modal-close { width: 28px; height: 28px; border-radius: 8px; border: none; background: rgba(255,255,255,0.05); color: var(--subtle); font-size: 14px; cursor: pointer; font-family: inherit; transition: all .2s; flex-shrink: 0; }
.rx-modal-close:hover { background: rgba(255,255,255,0.1); color: var(--text); }
.rx-modal-body { padding: 18px 22px; display: flex; flex-direction: column; gap: 14px; }
.rx-field { display: flex; flex-direction: column; gap: 6px; }
.rx-field-label { font-size: 11px; font-weight: 700; color: var(--subtle); text-transform: uppercase; letter-spacing: 0.5px; }
.rx-req { color: #ef4444; }
.rx-field-input { padding: 11px 13px; border-radius: 10px; border: 1px solid var(--border); background: rgba(0,0,0,0.25); color: var(--text); font-size: 14px; font-family: inherit; outline: none; transition: border-color .2s; }
.rx-field-input:focus { border-color: rgba(99,102,241,0.5); }
.rx-field-input::placeholder { color: var(--muted); }
.rx-modal-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 16px 22px; border-top: 1px solid var(--border); }
.rx-modal-cancel { padding: 10px 16px; border-radius: 10px; border: 1px solid var(--border); background: transparent; color: var(--subtle); font-size: 13px; font-weight: 600; font-family: inherit; cursor: pointer; transition: all .2s; }
.rx-modal-cancel:hover { background: rgba(255,255,255,0.05); color: var(--text); }
.rx-modal-submit { padding: 10px 18px; border-radius: 10px; border: none; background: linear-gradient(135deg, var(--accent2), #4f46e5); color: white; font-size: 13px; font-weight: 700; font-family: inherit; cursor: pointer; transition: all .2s; }
.rx-modal-submit:hover:not(:disabled) { filter: brightness(1.1); transform: translateY(-1px); }
.rx-modal-submit:disabled { opacity: .4; cursor: not-allowed; }
@keyframes rx-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes rx-slide-in { from { opacity: 0; transform: translateY(20px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }

.rx-upload-btn { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 10px; border: 1px solid rgba(99,102,241,0.22); background: rgba(99,102,241,0.08); color: var(--accent); font-size: 12px; font-weight: 700; font-family: inherit; cursor: pointer; transition: all .2s ease; }
.rx-upload-btn:hover:not(:disabled) { background: rgba(99,102,241,0.16); border-color: rgba(99,102,241,0.42); transform: translateY(-1px); }
.rx-upload-btn:disabled { opacity: .5; cursor: not-allowed; }
.rx-spin { animation: rx-spin-anim 1s linear infinite; }
@keyframes rx-spin-anim { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

.mic-wrapper { position: relative; width: 124px; height: 124px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.mic-glow { position: absolute; inset: 14px; border-radius: 50%; background: radial-gradient(circle, rgba(99,102,241,0.18), transparent 65%); filter: blur(10px); opacity: .55; transition: all .3s ease; pointer-events: none; }
.mic-glow-active { opacity: 1; transform: scale(1.08); background: radial-gradient(circle, rgba(239,68,68,0.22), transparent 65%); }
.mic-container { position: relative; width: 108px; height: 108px; display: flex; align-items: center; justify-content: center; border-radius: 50%; border: 1px solid rgba(255,255,255,0.06); background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.015)); }
.mic-ring { position: absolute; inset: 10px; }
.mic-btn { position: relative; z-index: 2; width: 58px; height: 58px; border-radius: 50%; border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all .28s cubic-bezier(.34,1.56,.64,1); background: linear-gradient(135deg, var(--accent2), #4f46e5); box-shadow: 0 10px 24px rgba(99,102,241,0.32); }
.mic-btn:hover:not(:disabled) { filter: brightness(1.08); transform: translateY(-1px) scale(1.06); }
.mic-btn:active:not(:disabled) { transform: scale(.97); }
.mic-btn:disabled { opacity: .42; cursor: not-allowed; background: linear-gradient(135deg, #374151, #1f2937); box-shadow: none; }
.mic-btn-rec { background: linear-gradient(135deg, #ef4444, #dc2626) !important; box-shadow: 0 0 0 6px rgba(239,68,68,0.08), 0 12px 28px rgba(239,68,68,0.32) !important; transform: scale(1.04); }

@media (max-width: 760px) {
  .bottom-row { grid-template-columns: 1fr; gap: 16px; }
  .bottom-left, .bottom-right { align-items: center; text-align: center; }
  .mic-wrapper { margin: 0 auto; }
  .header-inner, .settings-wrap, .error-wrap, .bottom-inner { padding-left: 14px; padding-right: 14px; }
  .welcome { padding: 16px 14px 28px; }
  .chat-container { padding: 0 10px; }
  .title { font-size: clamp(22px, 6vw, 30px); }
  .description { font-size: 13px; }
  .nudge-card, .reminders-strip { max-width: 100%; }
  .quick-tiles { max-width: 100%; }
  .tags { gap: 8px; }
  .tag { padding: 8px 16px; font-size: 13px; }
  .bubble-ai, .bubble-user, .bubble-live, .bubble-listening { font-size: 14px; padding: 10px 14px; }
}

@media (max-width: 520px) {
  .welcome { padding: 12px 10px 24px; }
  .quick-tiles { gap: 8px; }
  .quick-tile { padding: 11px 10px; gap: 9px; }
  .quick-tile-icon { width: 32px; height: 32px; border-radius: 9px; }
  .quick-tile-title { font-size: 12px; }
  .quick-tile-sub { font-size: 10.5px; }
}

@keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .6; transform: scale(.9); } }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
@keyframes bounce { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-5px); } }
@keyframes msgUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
@keyframes float1 { 0%, 100% { transform: translate(0,0); } 33% { transform: translate(40px,-30px); } 66% { transform: translate(-20px,20px); } }
@keyframes float2 { 0%, 100% { transform: translate(0,0); } 33% { transform: translate(-30px,25px); } 66% { transform: translate(20px,-15px); } }
@keyframes wave { 0% { transform: rotate(0); } 10% { transform: rotate(14deg); } 20% { transform: rotate(-8deg); } 30% { transform: rotate(14deg); } 40% { transform: rotate(-4deg); } 50%, 100% { transform: rotate(0); } }

::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.04); border-radius: 2px; }

/* ══════════════════════════════════════════════════════════════
   AUTH SCREEN
   ══════════════════════════════════════════════════════════════ */

.auth-page { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: var(--bg); overflow: auto; padding: 20px; font-family: 'Outfit', sans-serif; }
.auth-bg-grid { position: fixed; inset: 0; background-image: radial-gradient(rgba(99,102,241,0.04) 1px, transparent 1px); background-size: 30px 30px; pointer-events: none; }
.auth-orb { position: fixed; border-radius: 50%; filter: blur(100px); pointer-events: none; opacity: 0.3; }
.auth-orb1 { width: 500px; height: 500px; top: -100px; left: -100px; background: radial-gradient(circle, rgba(99,102,241,0.25), transparent); }
.auth-orb2 { width: 400px; height: 400px; bottom: -50px; right: -50px; background: radial-gradient(circle, rgba(168,85,247,0.2), transparent); }

.auth-container { display: flex; width: 100%; max-width: 960px; min-height: 620px; background: rgba(12,17,40,0.7); border: 1px solid var(--border); border-radius: 24px; backdrop-filter: blur(20px); box-shadow: 0 32px 80px rgba(0,0,0,0.5); overflow: hidden; z-index: 1; animation: auth-slide-up 0.4s cubic-bezier(0.34,1.56,0.64,1); }
@keyframes auth-slide-up { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }

.auth-brand-panel { flex: 0 0 380px; background: linear-gradient(135deg, #1a1f3a 0%, #0f1629 50%, #0c1128 100%); padding: 48px 36px; display: flex; flex-direction: column; justify-content: center; border-right: 1px solid var(--border); }
.auth-brand-content { display: flex; flex-direction: column; gap: 20px; }
.auth-logo { width: 72px; height: 72px; border-radius: 20px; background: linear-gradient(135deg, var(--accent2), #4f46e5); display: flex; align-items: center; justify-content: center; margin-bottom: 8px; box-shadow: 0 8px 24px rgba(99,102,241,0.3); }
.auth-brand-title { font-size: 36px; font-weight: 900; letter-spacing: 3px; background: linear-gradient(135deg, #e2e8f0, #818cf8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.auth-brand-subtitle { font-size: 15px; color: var(--subtle); font-weight: 500; margin-top: -8px; }
.auth-brand-divider { width: 50px; height: 3px; border-radius: 2px; background: linear-gradient(90deg, var(--accent), var(--accent2)); }
.auth-brand-desc { font-size: 13px; color: var(--muted); line-height: 1.7; }
.auth-brand-features { display: flex; flex-direction: column; gap: 12px; margin-top: 8px; }
.auth-feature { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--subtle); }
.auth-feature-icon { font-size: 16px; }
.auth-brand-footer { display: flex; gap: 8px; font-size: 10px; color: var(--muted); margin-top: 16px; opacity: 0.7; }

.auth-form-panel { flex: 1; padding: 40px 36px; display: flex; flex-direction: column; justify-content: center; overflow-y: auto; }
.auth-form-content { max-width: 380px; margin: 0 auto; width: 100%; }
.auth-form-title { font-size: 24px; font-weight: 800; color: var(--text); margin-bottom: 6px; }
.auth-form-subtitle { font-size: 13px; color: var(--muted); margin-bottom: 24px; }

.auth-method-tabs { display: flex; gap: 8px; margin-bottom: 20px; }
.auth-method-tab { flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 16px; border-radius: 10px; border: 1px solid var(--border); background: transparent; color: var(--muted); font-size: 13px; font-weight: 600; font-family: inherit; cursor: pointer; transition: all 0.2s; }
.auth-method-tab:hover { border-color: rgba(99,102,241,0.3); color: var(--subtle); }
.auth-method-tab.active { background: rgba(99,102,241,0.1); border-color: rgba(99,102,241,0.4); color: var(--accent); }

.auth-error { display: flex; align-items: center; gap: 8px; padding: 10px 14px; margin-bottom: 16px; border-radius: 10px; background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2); color: #f87171; font-size: 12px; }

.auth-form { display: flex; flex-direction: column; gap: 14px; }
.auth-field { display: flex; flex-direction: column; gap: 6px; }
.auth-field label { font-size: 11px; font-weight: 700; color: var(--subtle); text-transform: uppercase; letter-spacing: 0.5px; }
.auth-field input, .auth-field select { padding: 11px 14px; border-radius: 10px; border: 1px solid var(--border); background: rgba(255,255,255,0.03); color: var(--text); font-size: 14px; font-family: inherit; outline: none; transition: border-color 0.2s; }
.auth-field input:focus, .auth-field select:focus { border-color: rgba(99,102,241,0.5); }
.auth-field input::placeholder { color: var(--muted); }

.auth-input-group { display: flex; align-items: center; border: 1px solid var(--border); border-radius: 10px; background: rgba(255,255,255,0.03); overflow: hidden; transition: border-color 0.2s; }
.auth-input-group:focus-within { border-color: rgba(99,102,241,0.5); }
.auth-input-group input { border: none; background: transparent; flex: 1; padding: 11px 14px; color: var(--text); font-size: 14px; font-family: inherit; outline: none; }
.auth-input-prefix { padding: 11px 12px; background: rgba(255,255,255,0.04); color: var(--subtle); font-size: 13px; font-weight: 600; border-right: 1px solid var(--border); }
.auth-eye-btn { padding: 8px 12px; border: none; background: transparent; color: var(--muted); font-size: 11px; font-weight: 600; cursor: pointer; font-family: inherit; }
.auth-eye-btn:hover { color: var(--accent); }
.auth-pin-input { text-align: center; letter-spacing: 8px; font-size: 20px !important; font-weight: 700; }

.auth-signup-fields { display: flex; flex-direction: column; gap: 14px; padding-top: 4px; border-top: 1px solid var(--border); margin-top: 4px; }
.auth-row { display: flex; gap: 12px; }
.auth-field-half { flex: 1; }

.auth-conditions { display: flex; flex-wrap: wrap; gap: 8px; }
.auth-condition-chip { padding: 6px 14px; border-radius: 20px; border: 1px solid var(--border); background: transparent; color: var(--subtle); font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; transition: all 0.2s; }
.auth-condition-chip:hover { border-color: rgba(99,102,241,0.3); }
.auth-condition-chip.active { background: rgba(99,102,241,0.12); border-color: rgba(99,102,241,0.4); color: var(--accent); }

.auth-submit { width: 100%; padding: 13px; border-radius: 12px; border: none; background: linear-gradient(135deg, var(--accent2), #4f46e5); color: white; font-size: 15px; font-weight: 700; font-family: inherit; cursor: pointer; transition: all 0.2s; margin-top: 6px; }
.auth-submit:hover:not(:disabled) { filter: brightness(1.1); transform: translateY(-1px); box-shadow: 0 8px 20px rgba(99,102,241,0.3); }
.auth-submit:disabled { opacity: 0.6; cursor: not-allowed; }
.auth-spinner { display: inline-block; width: 18px; height: 18px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: auth-spin 0.6s linear infinite; }
@keyframes auth-spin { to { transform: rotate(360deg); } }

.auth-divider { display: flex; align-items: center; gap: 16px; margin: 20px 0; }
.auth-divider::before, .auth-divider::after { content: ''; flex: 1; height: 1px; background: var(--border); }
.auth-divider span { font-size: 11px; color: var(--muted); white-space: nowrap; }

.auth-oauth-row { display: flex; gap: 10px; }
.auth-oauth-btn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 14px; border-radius: 10px; border: 1px solid var(--border); background: rgba(255,255,255,0.03); color: var(--subtle); font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; transition: all 0.2s; }
.auth-oauth-btn:hover { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.12); color: var(--text); }
.auth-oauth-dhis2 { border-color: rgba(13,71,161,0.3); }
.auth-oauth-dhis2:hover { background: rgba(13,71,161,0.08); border-color: rgba(13,71,161,0.5); }

.auth-toggle { text-align: center; margin-top: 20px; font-size: 13px; color: var(--muted); }
.auth-toggle button { background: none; border: none; color: var(--accent); cursor: pointer; font-weight: 700; font-family: inherit; font-size: 13px; }
.auth-toggle button:hover { text-decoration: underline; }

.auth-test-hint { margin-top: 16px; }
.auth-test-hint details { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
.auth-test-hint summary { padding: 8px 14px; font-size: 11px; color: var(--muted); cursor: pointer; user-select: none; }
.auth-test-hint summary:hover { color: var(--subtle); }
.auth-test-accounts { padding: 10px 14px; font-size: 11px; color: var(--muted); line-height: 1.8; }
.auth-test-accounts p { margin: 2px 0; }
.auth-test-accounts strong { color: var(--subtle); }

@media (max-width: 768px) {
  .auth-container { flex-direction: column; min-height: auto; max-width: 500px; }
  .auth-brand-panel { flex: 0 0 auto; padding: 28px 24px; }
  .auth-brand-title { font-size: 28px; }
  .auth-brand-features { display: none; }
  .auth-form-panel { padding: 28px 24px; }
  .auth-oauth-row { flex-direction: column; }
}

/* ══════════════════════════════════════════════════════════════
   PATIENT SIDEBAR
   ══════════════════════════════════════════════════════════════ */

.patient-sidebar { position: fixed; left: 0; top: 0; bottom: 0; width: 280px; background: rgba(12,17,40,0.95); border-right: 1px solid var(--border); backdrop-filter: blur(20px); display: flex; flex-direction: column; z-index: 50; overflow-y: auto; transition: transform 0.3s ease; }
.patient-sidebar.collapsed { transform: translateX(-100%); }
.sidebar-hidden .layout { padding-left: 0 !important; }
.sidebar-hidden { padding-left: 0 !important; }
/* Compact button */
.compact-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border-radius: 50%;
  border: 1px solid rgba(249,115,22,0.35);
  background: rgba(249,115,22,0.08);
  cursor: pointer; padding: 0; flex-shrink: 0;
  transition: background 0.2s, border-color 0.2s, transform 0.15s;
}
.compact-btn:hover { background: rgba(249,115,22,0.18); border-color: rgba(249,115,22,0.6); transform: scale(1.08); }
.compact-btn:disabled { cursor: wait; opacity: 0.6; }
/* Model switch notice */
.model-switch-notice {
  display: flex; align-items: center; gap: 7px;
  margin: 8px auto 4px;
  padding: 6px 14px; border-radius: 20px;
  background: rgba(99,102,241,0.08); border: 1px solid rgba(99,102,241,0.18);
  color: #818cf8; font-size: 11px; font-weight: 600;
  width: fit-content; animation: notice-fade 2.5s ease forwards;
}
@keyframes notice-fade {
  0%   { opacity: 0; transform: translateY(-6px); }
  15%  { opacity: 1; transform: translateY(0); }
  75%  { opacity: 1; }
  100% { opacity: 0; }
}
@keyframes compact-spin {
  0%   { transform: rotate(0deg)   scale(1);    opacity: 1; }
  40%  { transform: rotate(180deg) scale(1.15); opacity: 0.7; }
  70%  { transform: rotate(340deg) scale(0.9);  opacity: 0.5; }
  100% { transform: rotate(360deg) scale(1);    opacity: 1; }
}
.compact-toast {
  display: flex; align-items: center; gap: 10px;
  margin: 12px auto 8px; padding: 12px 20px;
  border-radius: 14px;
  background: rgba(16,185,129,0.08);
  border: 1.5px solid rgba(16,185,129,0.3);
  box-shadow: 0 4px 24px rgba(16,185,129,0.15), 0 0 0 1px rgba(16,185,129,0.05);
  width: fit-content; max-width: 320px;
  animation: compact-toast-anim 4.5s cubic-bezier(.4,0,.2,1) forwards;
}
.compact-toast-text { display: flex; flex-direction: column; gap: 2px; }
.compact-toast-title { font-size: 13px; font-weight: 700; color: #10b981; letter-spacing: -0.2px; }
.compact-toast-detail { font-size: 11px; font-weight: 500; color: #6ee7b7; }
@keyframes compact-toast-anim {
  0%   { opacity: 0; transform: translateY(-12px) scale(0.95); }
  10%  { opacity: 1; transform: translateY(0) scale(1); }
  75%  { opacity: 1; transform: translateY(0) scale(1); }
  100% { opacity: 0; transform: translateY(-8px) scale(0.97); }
}
.advice-card { background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,.09); width: 100%; max-width: 600px; }
.advice-card-header { background: linear-gradient(135deg,#0f172a,#1e293b); padding: 14px 18px; display: flex; justify-content: space-between; align-items: flex-start; }
.advice-card-header-suggest { background: linear-gradient(135deg,#0d9488,#0f766e); }
.advice-card-title { font-size: 13px; font-weight: 800; color: #fff; letter-spacing: -.2px; }
.advice-card-intro { background: #f0fdfa; border-bottom: 1px solid #ccfbf1; padding: 8px 16px; font-size: 12px; color: #134e4a; line-height: 1.6; }
.advice-card-body { padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
.advice-section { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px; }
.advice-section-head { font-size: 11px; font-weight: 800; color: #10b981; letter-spacing: .5px; text-transform: uppercase; margin-bottom: 6px; }
.advice-section-text { font-size: 13px; color: #334155; line-height: 1.6; white-space: pre-wrap; }
.advice-item { display: flex; gap: 10px; align-items: flex-start; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px; }
.advice-item-num { background: #6366f1; color: #fff; border-radius: 50%; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; flex-shrink: 0; }
.advice-card-suggest .advice-item-num { background: #0d9488; }
.advice-item-head { font-size: 12px; font-weight: 700; color: #0f172a; margin-bottom: 2px; }
.advice-item-text { font-size: 12px; color: #334155; line-height: 1.6; }
.advice-dl-btn { background: rgba(255,255,255,.18); border: 1px solid rgba(255,255,255,.35); color: #fff; border-radius: 6px; padding: 4px 10px; font-size: 10px; font-weight: 700; cursor: pointer; transition: background .15s; }
.advice-dl-btn:hover { background: rgba(255,255,255,.3); }
.sidebar-close-btn { position: absolute; top: 12px; right: 12px; width: 28px; height: 28px; border-radius: 7px; border: 1px solid rgba(255,255,255,0.06); background: rgba(255,255,255,0.03); color: #64748b; display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 51; transition: all 0.2s; }
.sidebar-close-btn:hover { background: rgba(255,255,255,0.08); color: #e2e8f0; }
.sidebar-open-btn { position: fixed; top: 12px; left: 12px; z-index: 60; width: 32px; height: 32px; border-radius: 8px; border: 1px solid rgba(99,102,241,0.2); background: rgba(12,17,40,0.95); color: #818cf8; display: flex; align-items: center; justify-content: center; cursor: pointer; backdrop-filter: blur(12px); box-shadow: 0 4px 12px rgba(0,0,0,0.3); transition: all 0.25s; }
.sidebar-open-btn:hover { background: rgba(99,102,241,0.1); border-color: rgba(99,102,241,0.4); transform: scale(1.05); }

.sidebar-profile { padding: 24px 20px; text-align: center; border-bottom: 1px solid var(--border); }
.sidebar-avatar { width: 56px; height: 56px; border-radius: 16px; background: linear-gradient(135deg, var(--accent2), #4f46e5); display: flex; align-items: center; justify-content: center; margin: 0 auto 12px; font-size: 24px; font-weight: 800; color: white; }
.sidebar-name { font-size: 16px; font-weight: 700; color: var(--text); }
.sidebar-meta { font-size: 12px; color: var(--muted); margin-top: 4px; }
.sidebar-conditions { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; margin-top: 10px; }
.sidebar-condition-tag { padding: 3px 10px; border-radius: 12px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.2); color: #f87171; font-size: 10px; font-weight: 700; text-transform: uppercase; }
.sidebar-meds { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; margin-top: 8px; }
.sidebar-med-tag { padding: 3px 10px; border-radius: 12px; background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.15); color: #4ade80; font-size: 10px; font-weight: 600; }

.sidebar-section { padding: 16px 20px; border-bottom: 1px solid var(--border); }
.sidebar-section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--subtle); display: flex; align-items: center; gap: 6px; margin-bottom: 12px; }
.sidebar-facts { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.sidebar-facts li { font-size: 11px; color: var(--muted); line-height: 1.5; padding-left: 12px; position: relative; }
.sidebar-facts li::before { content: ''; position: absolute; left: 0; top: 6px; width: 4px; height: 4px; border-radius: 50%; background: var(--muted); }
.sidebar-facts li.fact-commitment { color: var(--accent); }
.sidebar-facts li.fact-commitment::before { background: var(--accent); }

.sidebar-loading { font-size: 12px; color: var(--muted); text-align: center; padding: 16px 0; }
.sidebar-empty { font-size: 12px; color: var(--muted); text-align: center; padding: 12px 0; }

.sidebar-visits { display: flex; flex-direction: column; gap: 8px; }
.sidebar-visit-card { padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border); background: rgba(255,255,255,0.02); }
.visit-date { font-size: 10px; font-weight: 700; color: var(--subtle); margin-bottom: 4px; }
.visit-summary { font-size: 11px; color: var(--muted); line-height: 1.5; }
.visit-triage { display: inline-block; margin-top: 6px; padding: 2px 8px; border-radius: 6px; font-size: 9px; font-weight: 700; text-transform: uppercase; }
.triage-emergency { background: rgba(239,68,68,0.12); color: #f87171; }
.triage-facility { background: rgba(245,158,11,0.12); color: #fbbf24; }
.triage-chw_visit { background: rgba(59,130,246,0.12); color: #60a5fa; }
.triage-self_care { background: rgba(34,197,94,0.08); color: #4ade80; }

.sidebar-actions { padding: 16px 20px; margin-top: auto; display: flex; flex-direction: column; gap: 8px; }
.sidebar-btn { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px; border-radius: 10px; border: 1px solid var(--border); background: transparent; color: var(--subtle); font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; transition: all 0.2s; }
.sidebar-btn:hover { background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.1); color: var(--text); }
.sidebar-btn-new { border-color: rgba(99,102,241,0.3); color: var(--accent); }
.sidebar-btn-new:hover { background: rgba(99,102,241,0.08); }
.sidebar-btn-logout { border-color: rgba(239,68,68,0.2); color: #f87171; }
.sidebar-btn-logout:hover { background: rgba(239,68,68,0.06); }

/* Layout shift for sidebar */
.page { padding-left: 280px; transition: padding-left 0.3s ease; }

@media (max-width: 900px) {
  .patient-sidebar:not(.collapsed) { width: 260px; }
  .page { padding-left: 0 !important; }
  .patient-sidebar:not(.collapsed) ~ .layout { padding-left: 0; }
}
`;
