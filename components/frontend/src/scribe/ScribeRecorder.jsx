/**
 * ScribeRecorder — records the home-visit conversation.
 *
 * - MediaRecorder (browser) captures webm/opus, uploads every 2s as a chunk
 *   so a dropped connection only costs the last ~2s of audio.
 * - Live timer + waveform hint.
 * - Stop -> calls /finish which runs STT + SOAP draft on the server.
 * - Clean teardown on unmount: stops tracks, closes stream.
 *
 * Props:
 *   open:       boolean
 *   patientId:  string
 *   language:   "en" | "ma"
 *   onDraft:    (session, sessionId) => void     (advances to ScribeReview)
 *   onClose:    () => void
 */

import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./scribeApi.js";

const CHUNK_INTERVAL_MS = 2000;

export default function ScribeRecorder({ open, patientId, language = "en", onDraft, onClose }) {
  const [status, setStatus]         = useState("idle");   // idle | starting | recording | stopping | transcribing | error
  const [error, setError]           = useState("");
  const [elapsed, setElapsed]       = useState(0);
  const [uploadedBytes, setBytes]   = useState(0);
  const [sessionId, setSessionId]   = useState("");

  const streamRef    = useRef(null);
  const recorderRef  = useRef(null);
  const timerRef     = useRef(null);
  const sidRef       = useRef("");          // stable ref for async callbacks

  const teardown = useCallback(() => {
    try { recorderRef.current?.stop(); } catch { /* ignore */ }
    try { streamRef.current?.getTracks().forEach(t => t.stop()); } catch { /* ignore */ }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    recorderRef.current = null;
    streamRef.current   = null;
  }, []);

  useEffect(() => {
    if (!open) teardown();
    return () => teardown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Close on Escape only when not recording (avoid accidental discard).
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape" && status !== "recording") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, status, onClose]);

  const begin = useCallback(async () => {
    if (!patientId) { setError("no patient context"); setStatus("error"); return; }
    setError(""); setStatus("starting"); setElapsed(0); setBytes(0);

    // 1. Create the server-side session.
    const r = await api.startSession({
      patientId,
      language,
      titleHint: "Home visit",
    });
    if (r._error || !r.ok) {
      setError(r._error || r.detail || "failed to start session");
      setStatus("error");
      return;
    }
    const sid = r.session?.session_id;
    if (!sid) { setError("no session id returned"); setStatus("error"); return; }
    sidRef.current = sid;
    setSessionId(sid);

    // 2. Ask for mic + start recording.
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (e) {
      setError(`microphone access denied (${e.name})`);
      setStatus("error");
      return;
    }
    streamRef.current = stream;

    // Browser-preferred opus/webm for size+quality; whisper.cpp handles this via ffmpeg.
    const mimeCandidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
    ];
    const mime = mimeCandidates.find(m => MediaRecorder.isTypeSupported(m)) || "";
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
    recorderRef.current = rec;

    rec.ondataavailable = async (e) => {
      if (!e.data || e.data.size === 0) return;
      // Fire-and-forget upload — if one chunk fails, we keep going and
      // surface the aggregate state via status.
      const up = await api.uploadChunk(sidRef.current, e.data);
      if (up._error) {
        setError(`upload: ${up._error}`);
      } else {
        setBytes(up.session?.audio_bytes || 0);
      }
    };
    rec.onerror = (e) => {
      setError(`recorder error: ${e.error?.name || "unknown"}`);
      setStatus("error");
    };

    rec.start(CHUNK_INTERVAL_MS);
    setStatus("recording");
    const startedAt = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);
  }, [patientId, language]);

  const stop = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec || rec.state === "inactive") return;
    setStatus("stopping");

    // Drain: request a final chunk + wait for ondataavailable to flush it.
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };
      rec.onstop = finish;
      try { rec.stop(); } catch { finish(); }
      // Safety timeout
      setTimeout(finish, 800);
    });

    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

    // Call /finish to trigger STT + SOAP draft.
    setStatus("transcribing");
    const fin = await api.finishSession(sidRef.current);
    if (fin._error || !fin.ok) {
      setError(fin._error || fin.detail || "transcription failed");
      setStatus("error");
      return;
    }
    onDraft?.(fin.session, sidRef.current);
  }, [onDraft]);

  const cancel = useCallback(() => {
    teardown();
    setStatus("idle");
    setElapsed(0);
    setBytes(0);
    setSessionId("");
    sidRef.current = "";
    onClose?.();
  }, [teardown, onClose]);

  if (!open) return null;

  const fmtTime = (s) => {
    const m = Math.floor(s / 60);
    const ss = s % 60;
    return `${m}:${ss.toString().padStart(2, "0")}`;
  };
  const fmtKB = (b) => b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} KB`;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && status !== "recording") cancel(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 9290,
        background: "rgba(15, 23, 42, 0.65)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "16px",
        animation: "amina-scribe-fade 180ms ease",
      }}
    >
      <div
        role="dialog"
        aria-label="Record visit"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(420px, 100%)",
          background: "#fff",
          borderRadius: 16,
          boxShadow: "0 24px 60px rgba(15,23,42,0.45)",
          overflow: "hidden",
          animation: "amina-scribe-zoom 220ms cubic-bezier(0.22,1,0.36,1)",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <header style={{
          padding: "18px 20px",
          background: "linear-gradient(135deg, #0f766e, #0891b2)",
          color: "#fff",
        }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Record home visit</div>
          <div style={{ fontSize: 11.5, opacity: 0.85, marginTop: 2 }}>
            Audio stays private. The clinician signs the SOAP draft before it reaches the patient.
          </div>
        </header>

        <div style={{ padding: "22px 24px", display: "grid", gap: 18 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{
              margin: "0 auto",
              width: 88, height: 88,
              borderRadius: "50%",
              background: status === "recording"
                ? "radial-gradient(circle, #fecaca 0%, #ef4444 70%)"
                : "radial-gradient(circle, #e2e8f0 0%, #94a3b8 80%)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff",
              fontSize: 28,
              boxShadow: status === "recording"
                ? "0 0 0 8px rgba(239,68,68,0.18), 0 0 0 16px rgba(239,68,68,0.08)"
                : "0 2px 8px rgba(15,23,42,0.08)",
              transition: "box-shadow 220ms ease, background 220ms ease",
              animation: status === "recording" ? "amina-scribe-pulse 1.2s ease-in-out infinite" : "none",
            }}>
              {status === "recording" ? "●" : "🎙️"}
            </div>
            <div style={{
              marginTop: 12,
              fontVariantNumeric: "tabular-nums",
              fontSize: 22, fontWeight: 600, color: "#0f172a",
            }}>{fmtTime(elapsed)}</div>
            <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 2 }}>
              {status === "idle" && "Ready to record"}
              {status === "starting" && "Starting…"}
              {status === "recording" && `Recording · uploaded ${fmtKB(uploadedBytes)}`}
              {status === "stopping" && "Stopping…"}
              {status === "transcribing" && "Transcribing + drafting SOAP…"}
              {status === "error" && (error || "Error")}
            </div>
          </div>

          {error ? (
            <div style={{
              background: "#fef2f2", color: "#991b1b",
              borderRadius: 6, padding: "8px 10px", fontSize: 12,
            }}>⚠ {error}</div>
          ) : null}

          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            {status === "idle" || status === "error" ? (
              <>
                <button type="button" onClick={cancel} style={btnSecondary}>Cancel</button>
                <button type="button" onClick={begin} style={btnPrimary}>Start</button>
              </>
            ) : null}
            {status === "starting" || status === "transcribing" || status === "stopping" ? (
              <button type="button" disabled style={btnSecondary}>Please wait…</button>
            ) : null}
            {status === "recording" ? (
              <>
                <button type="button" onClick={cancel} style={btnSecondary}>Discard</button>
                <button type="button" onClick={stop} style={btnDanger}>Stop & Draft</button>
              </>
            ) : null}
          </div>

          {sessionId ? (
            <div style={{ fontSize: 10.5, color: "#94a3b8", textAlign: "center" }}>
              Session <code>{sessionId.slice(0, 10)}…</code>
            </div>
          ) : null}
        </div>

        <style>{`
          @keyframes amina-scribe-fade { from { opacity: 0 } to { opacity: 1 } }
          @keyframes amina-scribe-zoom {
            from { opacity: 0; transform: scale(0.96) translateY(10px); }
            to   { opacity: 1; transform: scale(1) translateY(0); }
          }
          @keyframes amina-scribe-pulse {
            0%, 100% { transform: scale(1); }
            50%      { transform: scale(1.04); }
          }
          @media (prefers-reduced-motion: reduce) {
            @keyframes amina-scribe-pulse { from, to { transform: none } }
          }
        `}</style>
      </div>
    </div>
  );
}

const btnBase = {
  padding: "10px 18px",
  borderRadius: 8,
  fontWeight: 600,
  fontSize: 13,
  border: "none",
  cursor: "pointer",
};
const btnPrimary = {
  ...btnBase,
  background: "linear-gradient(135deg, #0f766e, #14b8a6)",
  color: "#fff",
  boxShadow: "0 2px 6px rgba(20,184,166,0.35)",
};
const btnDanger = {
  ...btnBase,
  background: "linear-gradient(135deg, #b91c1c, #ef4444)",
  color: "#fff",
  boxShadow: "0 2px 6px rgba(239,68,68,0.35)",
};
const btnSecondary = {
  ...btnBase,
  background: "#f1f5f9",
  color: "#475569",
  border: "1px solid #cbd5e1",
};
