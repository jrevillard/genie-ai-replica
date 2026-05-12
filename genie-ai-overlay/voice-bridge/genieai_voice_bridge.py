# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""GENIE.AI voice bridge.

A WebSocket service that wires the existing ASR / chatqna LLM / TTS pipeline
into a real-time-ish voice call without WebRTC. Replaces the LiveKit-based
voice-agent for environments where WebRTC NAT traversal is impractical
(e.g. cloud firewalls without UDP reachability).

Wire format
-----------
Client → server messages
    text: {"type":"start","language":"fr|en|es"}     # first message
    text: {"type":"stop"}                             # graceful end
    binary: PCM 16-bit little-endian, 16 kHz mono, in 20 ms frames (640 bytes)

Server → client messages
    text: {"type":"ready"}                            # greeting done, mic on
    text: {"type":"user_speaking"}                    # VAD detected speech
    text: {"type":"transcript","text":"..."}          # final ASR result
    text: {"type":"agent_text","text":"..."}          # LLM sentence
    text: {"type":"tts_start","sample_rate":22050}    # next bytes are audio
    binary: PCM 16-bit little-endian audio at sample_rate
    text: {"type":"tts_end"}                          # done speaking
    text: {"type":"error","message":"..."}            # something failed
"""

import asyncio
import audioop
import datetime
import io
import json
import logging
import os
import re
import wave
from pathlib import Path
from typing import AsyncIterator, List, Optional

import httpx
import jwt as pyjwt
import webrtcvad
from arango import ArangoClient
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("genieai_voice_bridge")

# ---------------------------------------------------------------------------
# Configuration (env-driven)
# ---------------------------------------------------------------------------

ASR_URL = os.getenv("ASR_WHISPER_URL", "http://asr-whisper:9100")
TTS_URL = os.getenv("TTS_PIPER_URL") or os.getenv("TTS_URL") or "http://tts-piper:9200"
# Silence appended at the end of each TTS sentence stream so back-to-back
# sentences don't sound run-together — Piper's natural sentence-end trailing
# silence is too short for streamed playback. ~150 ms feels conversational.
TTS_INTER_SENTENCE_PAUSE_MS = int(os.getenv("VOICE_INTER_SENTENCE_PAUSE_MS", "150"))

# Call recording: per-session audio is accumulated through the call and
# muxed into a single WAV when the WebSocket closes. The file lands in the
# shared backend uploads volume so the backend serves it via /Uploads.
CALL_RECORDING_ENABLED = os.getenv("CALL_RECORDING_ENABLED", "true").lower() in ("1", "true", "yes")
CALL_RECORDING_DIR = Path(os.getenv("CALL_RECORDING_DIR", "/app/Uploads/call-recordings"))
CALL_RECORDING_URL_PREFIX = os.getenv("CALL_RECORDING_URL_PREFIX", "/Uploads/call-recordings")
CALL_RECORDING_SAMPLE_RATE = int(os.getenv("CALL_RECORDING_SAMPLE_RATE", "22050"))
# Short silence inserted between turns so utterances don't run into each other.
CALL_RECORDING_GAP_MS = int(os.getenv("CALL_RECORDING_GAP_MS", "300"))
# Direct vLLM endpoint (OpenAI-compatible). Voice always streams from vLLM —
# we bypass chatqna's megaservice because its full RAG pipeline (with
# reranker + translation hops) costs 5-7s per turn, which kills a live call.
LLM_ENDPOINT = os.getenv("LLM_ENDPOINT", "http://vllm:8000/v1/chat/completions")
LLM_MODEL = os.getenv("LLM_MODEL", os.getenv("VLLM_LLM_MODEL_ID", "meta-llama/Meta-Llama-3.1-8B-Instruct"))
LLM_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "128"))
LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.7"))

# Inline RAG: when VOICE_RAG_ENABLED=true we run a direct AQL k-NN against
# Arango (no graph hop, no reranker, no megaservice round-trip) in parallel
# with the rest of the per-turn work, then inject the top chunks as a system
# message before streaming from vLLM. End-to-end target ~2 s.
VOICE_RAG_ENABLED = os.getenv("VOICE_RAG_ENABLED", "").lower() in ("1", "true", "yes")
TEI_EMBED_URL = os.getenv("TEI_EMBED_URL", "http://tei:80")
# OPEA's dataprep stores chunk embeddings in GRAPH_SOURCE. Override only if
# you've moved them.
VOICE_RAG_COLLECTION = os.getenv("VOICE_RAG_COLLECTION", "GRAPH_SOURCE")
VOICE_RAG_TOP_K = int(os.getenv("VOICE_RAG_TOP_K", "3"))
# Skip retrieval for very short messages ("hi", "thanks") — chitchat doesn't
# need grounding and would just add latency.
VOICE_RAG_MIN_QUERY_LEN = int(os.getenv("VOICE_RAG_MIN_QUERY_LEN", "12"))
# Trim each retrieved chunk so the system prompt stays compact.
VOICE_RAG_CHUNK_CHARS = int(os.getenv("VOICE_RAG_CHUNK_CHARS", "400"))

HOST = os.getenv("VOICE_BRIDGE_HOST", "0.0.0.0")
PORT = int(os.getenv("VOICE_BRIDGE_PORT", "9400"))

# Audio: PCM 16 kHz mono 16-bit, in 20 ms frames (320 samples = 640 bytes)
SAMPLE_RATE = 16000
FRAME_SAMPLES = int(SAMPLE_RATE * 20 / 1000)
FRAME_BYTES = FRAME_SAMPLES * 2

# JWT shared secret with the backend. Used to verify the short-lived voice
# token sent by the frontend in the WS start message. We extract the userId
# from it and write call sessions/messages to ArangoDB on the user's behalf —
# the frontend never gets to write directly.
JWT_SECRET = os.getenv("JWT_SECRET", "")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")

# ArangoDB connection — same database the backend writes user/session data to.
ARANGO_URL = os.getenv("ARANGO_URL", "http://arangodb:8529")
ARANGO_DB = os.getenv("ARANGO_DB", "genie-ai")
ARANGO_USERNAME = os.getenv("ARANGO_USERNAME", "root")
ARANGO_PASSWORD = os.getenv("ARANGO_PASSWORD", "")

CALL_SESSIONS_COLLECTION = "call_sessions"
CALL_MESSAGES_COLLECTION = "call_messages"
TWINS_COLLECTION = "aiTwins"
VOICES_COLLECTION = "voices"

VAD_AGGRESSIVENESS = int(os.getenv("VAD_AGGRESSIVENESS", "2"))
SILENCE_FRAMES_TO_END = int(os.getenv("SILENCE_FRAMES", "25"))     # ~500 ms
SPEECH_FRAMES_TO_START = int(os.getenv("SPEECH_FRAMES_START", "3"))  # ~60 ms
MIN_UTTERANCE_FRAMES = int(os.getenv("MIN_UTTERANCE_FRAMES", "10"))  # 200 ms
# After process_utterance finishes, drop any audio that was buffered up in the
# WebSocket receive queue during processing. Without this, the agent picks up
# its own playback (echo) as a fresh utterance.
POST_PROCESS_DRAIN_S = float(os.getenv("POST_PROCESS_DRAIN_S", "1.5"))

# Best Piper voice IDs per chat-language, split by gender where the catalog
# offers both. Used to pick a voice when the user starts a call in a language
# the assigned twin's voice can't speak. Keep in sync with what's actually on
# disk in the piper-voices volume — anything listed here must exist.
DEFAULT_VOICE_BY_LANGUAGE = {
    "en": {"male": "en_US-ryan-high",     "female": "en_US-lessac-high",     "default": "en_US-ryan-high"},
    "fr": {"male": "fr_FR-tom-medium",    "female": "fr_FR-siwis-medium",    "default": "fr_FR-siwis-medium"},
    "es": {"male": "es_MX-claude-high",   "female": "es_ES-sharvard-medium", "default": "es_MX-claude-high"},
    "de": {"male": "de_DE-thorsten-high", "female": "de_DE-thorsten-high",   "default": "de_DE-thorsten-high"},
    "ar": {"male": "ar_JO-kareem-medium", "female": "ar_JO-kareem-medium",   "default": "ar_JO-kareem-medium"},
    "ru": {"male": "ru_RU-dmitri-medium", "female": "ru_RU-irina-medium",    "default": "ru_RU-irina-medium"},
    # Only huayan loads via the Python piper-tts library — chaowen and xiao_ya
    # declare `phoneme_type: pinyin` which the lib doesn't support. Pick huayan
    # for both genders until we add a pinyin-capable Chinese voice or model.
    "zh": {"male": "zh_CN-huayan-medium", "female": "zh_CN-huayan-medium", "default": "zh_CN-huayan-medium"},
    "pt": {"male": "pt_BR-faber-medium",  "female": "pt_BR-faber-medium",    "default": "pt_BR-faber-medium"},
    "hi": {"male": "hi_IN-pratham-medium", "female": "hi_IN-priyamvada-medium", "default": "hi_IN-priyamvada-medium"},
    "id": {"male": "id_ID-news_tts-medium", "female": "id_ID-news_tts-medium", "default": "id_ID-news_tts-medium"},
    "sw": {"male": "sw_CD-lanfrica-medium", "female": "sw_CD-lanfrica-medium", "default": "sw_CD-lanfrica-medium"},
}


def _voice_language_prefix(voice_id: Optional[str]) -> str:
    """ISO-ish 2-letter portion of a Piper voice id (e.g. 'en' from 'en_US-ryan-high')."""
    if not voice_id:
        return ""
    return voice_id.split("_", 1)[0].lower()


# Display names for the language codes the chat UI exposes — used in the
# language-enforcement directive appended to every call prompt.
# Mirrors backend constants/chat-languages.js.
_CHAT_LANGUAGE_NAMES = {
    "en": "English", "fr": "French", "es": "Spanish", "sw": "Swahili",
    "de": "German",  "ar": "Arabic", "ru": "Russian", "zh": "Chinese",
    "pt": "Portuguese", "hi": "Hindi", "id": "Indonesian",
    "th": "Thai", "ja": "Japanese", "ko": "Korean",
    "st": "Sesotho", "bn": "Bengali", "man": "Mandinka",
}


def _pick_voice_for_language(language: str, gender: str) -> Optional[str]:
    """Pick the best Piper voice id for `language`, honouring `gender` when set."""
    bucket = DEFAULT_VOICE_BY_LANGUAGE.get(language)
    if not bucket:
        return None
    if gender in ("male", "female") and bucket.get(gender):
        return bucket[gender]
    return bucket.get("default")


GREETINGS = {
    "fr": "Bonjour, je suis l'assistant vocal GENIE.AI. En quoi puis-je vous aider ?",
    "en": "Hello, this is the GENIE.AI voice assistant. How can I help you today?",
    "es": "Hola, soy el asistente de voz GENIE.AI. ¿En qué puedo ayudarte?",
    "sw": "Habari, mimi ni msaidizi wa sauti wa GENIE.AI. Nikusaidie nini leo?",
}

# Fallback base prompt used only when no twin is loaded (e.g. legacy client with no twinId).
# Under normal operation the twin's systemPrompt field (stored in ArangoDB and editable
# via PATCH /api/ai-twins/:twinId/prompt) is used instead — see _load_twin_settings_sync.
_VOICE_BASE_FALLBACK = (
    "You are Genie AI, a health companion for The Gambia deployed by the Ministry of Health. "
    "You help users prevent and manage NCDs — hypertension, diabetes, tobacco dependence — "
    "using WHO, BHBM, and Gambian guidelines. You are not a doctor. You do not diagnose, "
    "prescribe, or change treatment. Stay helpful, warm, and conversational."
)

# Voice-specific instructions appended to the twin's base system prompt for every call.
# These are channel constraints only — the health persona and content rules live in the
# per-twin systemPrompt field (see ai-twin-service.js / DEFAULT_SYSTEM_PROMPT).
_VOICE_MODE_INSTRUCTIONS = (
    "\n\nVOICE MODE — HOW YOU MUST SPEAK\n"
    "You are on a phone call with the user. This is spoken conversation, not text.\n"
    "- Keep every reply to 1 or 2 short sentences. Plain spoken language. Like a real phone call.\n"
    "- NO bullet points, NO numbered lists, NO markdown, NO headers, NO bold, NO emoji.\n"
    "- No long disclaimers. No clinical jargon. Use plain everyday words "
    "(say 'high blood pressure', not 'hypertension').\n"
    "- Ask at most ONE short follow-up question per turn. Never interrogate.\n"
    "- Do NOT offer the user a multiple-choice menu in your reply. Never say things like "
    "'reply with good, bad, or okay' or 'say yes or no'. Ask one open question and let them answer naturally.\n"
    "- Tone: warm, patient, non-judgemental — like a kind community health worker on the phone. "
    "Never moralise, lecture, or shame.\n"
)

SENTENCE_BOUNDARY = re.compile(r"(.+?[\.!\?\n])(\s+|$)", re.DOTALL)


app = FastAPI(title="GENIE.AI Voice Bridge")


@app.get("/health")
def health() -> JSONResponse:
    return JSONResponse({"ok": True, "asr": ASR_URL, "tts": TTS_URL, "llm": LLM_ENDPOINT})


# ---------------------------------------------------------------------------
# Audio helpers
# ---------------------------------------------------------------------------

def pcm_to_wav_bytes(pcm: bytes, sample_rate: int = SAMPLE_RATE) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Per-call audio recording
# ---------------------------------------------------------------------------

class CallRecorder:
    """Accumulates user + assistant PCM for one call.

    User audio arrives at 16 kHz (mic). Assistant audio comes from Piper at
    the per-voice native rate (usually 22050 Hz). We resample everything to
    `target_rate` so the final WAV is one consistent file. Turns are
    appended in chronological order with a short silence between them.
    """

    def __init__(self, target_rate: int = CALL_RECORDING_SAMPLE_RATE) -> None:
        self.target_rate = target_rate
        self._parts: list[bytes] = []
        self._user_state = None       # audioop.ratecv per-stream state
        self._assistant_state = None
        gap_samples = int(self.target_rate * CALL_RECORDING_GAP_MS / 1000)
        self._gap_pcm = b"\x00" * (gap_samples * 2)

    @staticmethod
    def _align_even(pcm: bytes) -> bytes:
        """audioop.ratecv requires whole 16-bit frames. Drop a trailing odd
        byte rather than throw — recording is best-effort and one stray byte
        is inaudible."""
        if len(pcm) % 2 != 0:
            return pcm[:-1]
        return pcm

    @staticmethod
    def _resample(pcm: bytes, src_rate: int, dst_rate: int, state):
        if src_rate == dst_rate:
            return pcm, state
        converted, new_state = audioop.ratecv(pcm, 2, 1, src_rate, dst_rate, state)
        return converted, new_state

    def append_user(self, pcm: bytes, source_rate: int = SAMPLE_RATE) -> None:
        if not pcm:
            return
        pcm = self._align_even(pcm)
        if not pcm:
            return
        try:
            converted, self._user_state = self._resample(
                pcm, source_rate, self.target_rate, self._user_state
            )
        except Exception as exc:
            logger.warning("[REC] user resample failed (%d bytes @ %d Hz): %s",
                           len(pcm), source_rate, exc)
            return
        if converted:
            self._parts.append(converted)
            self._parts.append(self._gap_pcm)

    def append_assistant(self, pcm: bytes, source_rate: int) -> None:
        if not pcm:
            return
        pcm = self._align_even(pcm)
        if not pcm:
            return
        try:
            converted, self._assistant_state = self._resample(
                pcm, source_rate, self.target_rate, self._assistant_state
            )
        except Exception as exc:
            logger.warning("[REC] assistant resample failed (%d bytes @ %d Hz): %s",
                           len(pcm), source_rate, exc)
            return
        if converted:
            self._parts.append(converted)
            self._parts.append(self._gap_pcm)

    def total_bytes(self) -> int:
        return sum(len(p) for p in self._parts)

    def build_wav(self) -> bytes:
        return pcm_to_wav_bytes(b"".join(self._parts), self.target_rate)


# session_id → CallRecorder. Set when the call session is created on WS open,
# popped on WS close to finalize. Each WebSocket has its own session_id so
# concurrent calls don't collide.
_recorders: dict[str, CallRecorder] = {}


def _finalize_recording_sync(session_id: str, wav_bytes: bytes) -> Optional[str]:
    """Write the WAV to disk and stamp the URL onto the call_sessions doc.
    Returns the public URL on success, None on failure."""
    if not session_id or not wav_bytes:
        return None
    try:
        CALL_RECORDING_DIR.mkdir(parents=True, exist_ok=True)
    except Exception as exc:
        logger.warning("[REC] could not mkdir %s: %s", CALL_RECORDING_DIR, exc)
        return None

    out_path = CALL_RECORDING_DIR / f"{session_id}.wav"
    try:
        out_path.write_bytes(wav_bytes)
    except Exception as exc:
        logger.warning("[REC] write failed for %s: %s", out_path, exc)
        return None

    recording_url = f"{CALL_RECORDING_URL_PREFIX}/{session_id}.wav"
    db = get_arango_db()
    if db is not None:
        try:
            db.collection(CALL_SESSIONS_COLLECTION).update({
                "_key": session_id,
                "recordingUrl": recording_url,
            })
        except Exception as exc:
            logger.warning("[REC] DB update failed for %s: %s", session_id, exc)
            # File is still on disk; URL just isn't discoverable yet.
    logger.info("[REC] saved %s (%d bytes) for session=%s", out_path, len(wav_bytes), session_id)
    return recording_url


async def finalize_recording(session_id: Optional[str]) -> None:
    """Pop the session's recorder, build the WAV, save + update DB.
    No-op when recording is disabled, no session, or no audio captured."""
    if not CALL_RECORDING_ENABLED or not session_id:
        _recorders.pop(session_id, None) if session_id else None
        return
    rec = _recorders.pop(session_id, None)
    if rec is None or rec.total_bytes() == 0:
        return
    try:
        wav_bytes = rec.build_wav()
    except Exception as exc:
        logger.warning("[REC] build_wav failed for session=%s: %s", session_id, exc)
        return
    await asyncio.to_thread(_finalize_recording_sync, session_id, wav_bytes)


# ---------------------------------------------------------------------------
# ArangoDB — call sessions / messages / twin lookup
# ---------------------------------------------------------------------------

_arango_db_handle = None


def get_arango_db():
    """Lazy-init ArangoDB connection. Returns None if not configured so the
    voice bridge can still serve calls without persistence (degraded mode)."""
    global _arango_db_handle
    if _arango_db_handle is not None:
        return _arango_db_handle
    if not ARANGO_PASSWORD:
        logger.warning("[ARANGO] ARANGO_PASSWORD not set — call sessions will not be persisted")
        return None
    try:
        client = ArangoClient(hosts=ARANGO_URL)
        db = client.db(ARANGO_DB, username=ARANGO_USERNAME, password=ARANGO_PASSWORD)
        # Touch the connection so we fail fast on bad creds.
        db.version()
        _arango_db_handle = db
        logger.info("[ARANGO] connected url=%s db=%s", ARANGO_URL, ARANGO_DB)
        return db
    except Exception as exc:
        logger.exception("[ARANGO] connection failed: %s", exc)
        return None


# ---------------------------------------------------------------------------
# JWT auth
# ---------------------------------------------------------------------------

def verify_voice_token(token: str) -> Optional[dict]:
    """Verify the short-lived voice JWT. Returns a {'user_id', 'twin_id'} dict
    on success or None on failure. twin_id may be None if the token was minted
    without a twin (e.g. legacy clients)."""
    if not token or not JWT_SECRET:
        return None
    try:
        claims = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except Exception as exc:
        logger.warning("[AUTH] voice token rejected: %s", exc)
        return None
    user_id = claims.get("userId") or claims.get("sub")
    if not user_id:
        logger.warning("[AUTH] voice token missing userId/sub")
        return None
    twin_id = claims.get("twinId")
    return {"user_id": str(user_id), "twin_id": str(twin_id) if twin_id else None}


def _build_personality_prompt(personality: Optional[dict]) -> str:
    """Mirror of `buildPersonalityPromptFragment` in
    components/gov-chat-backend/services/ai-twin-service.js. Keep wording in
    sync with that file when changing — both produce the same directive so
    chat / call / WhatsApp behave identically."""
    style = (personality or {}).get("languageStyle")
    length = (personality or {}).get("responseLength")
    if style not in {"slang", "casual", "professional"}:
        style = "slang"
    if length not in {"short", "medium", "long"}:
        length = "medium"
    # Wording mirrors components/gov-chat-backend/services/ai-twin-service.js.
    # Avoid role-play hints like "as a friend" — Llama 3.1 will invent a
    # fictional user partner and hallucinate dialogue.
    style_copy = {
        "slang": "use casual everyday language; contractions and short forms are fine; avoid formal jargon",
        "casual": "use a friendly conversational tone with full sentences; contractions are fine",
        "professional": "use formal precise language; full sentences; no contractions or slang",
    }[style]
    length_copy = {
        "short": "keep replies to 1-2 short sentences; no preamble",
        "medium": "keep replies moderately detailed, roughly 3-6 sentences",
        "long": "give thorough, multi-paragraph explanations with examples when helpful",
    }[length]
    return (
        "Style preferences for your reply (these modify HOW you respond — they do not change your role or what you do):\n"
        f"- Tone: {style_copy}.\n"
        f"- Length: {length_copy}."
    )


def _load_twin_settings_sync(twin_id: Optional[str]) -> Optional[dict]:
    """Resolve a twin to a tuple of overrides for the voice call. Returns:
        { 'name', 'callGreeting', 'modelVoiceId' (Piper id), 'language',
          'personalityPrompt', 'systemPrompt' }
    or None if the twin / its voice is not in the catalog. modelVoiceId may
    be None if the twin has no voice assigned — caller falls back to gender."""
    if not twin_id:
        return None
    db = get_arango_db()
    if db is None:
        return None
    try:
        twin = db.collection(TWINS_COLLECTION).get(twin_id)
        if not twin:
            logger.warning("[TWIN] not found: %s", twin_id)
            return None
        voice_doc = None
        if twin.get("voiceId"):
            voice_doc = db.collection(VOICES_COLLECTION).get(twin["voiceId"])
        return {
            "name": twin.get("name") or "",
            "callGreeting": (twin.get("callGreeting") or "").strip(),
            "modelVoiceId": (voice_doc or {}).get("modelVoiceId") if voice_doc else None,
            "language": (voice_doc or {}).get("language") if voice_doc else None,
            "personalityPrompt": _build_personality_prompt(twin.get("personality")),
            # Per-twin editable system prompt — used as the base for the call prompt.
            "systemPrompt": (twin.get("systemPrompt") or "").strip() or None,
        }
    except Exception as exc:
        logger.warning("[TWIN] load failed for %s: %s", twin_id, exc)
        return None


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def _create_call_session_sync(
    user_id: str,
    language: str,
    gender: str,
    twin_id: Optional[str] = None,
) -> Optional[str]:
    db = get_arango_db()
    if db is None:
        return None
    now = _now_iso()
    doc = {
        "userId": str(user_id),
        "language": language,
        "gender": gender or "female",
        "twinId": twin_id,
        "startAt": now,
        "endAt": None,
        "durationSeconds": None,
        "createdAt": now,
    }
    try:
        meta = db.collection(CALL_SESSIONS_COLLECTION).insert(doc)
        return meta["_key"]
    except Exception as exc:
        logger.exception("[ARANGO] failed to create call session: %s", exc)
        return None


def _log_call_message_sync(session_id: str, content: str, is_assistant: bool) -> None:
    db = get_arango_db()
    if db is None or not session_id:
        return
    text = (content or "").strip()
    if not text:
        return
    try:
        db.collection(CALL_MESSAGES_COLLECTION).insert({
            "sessionId": str(session_id),
            "content": text,
            "isAssistant": bool(is_assistant),
            "createdAt": _now_iso(),
        })
    except Exception as exc:
        logger.warning("[ARANGO] failed to log call message: %s", exc)


def _end_call_session_sync(session_id: str) -> None:
    db = get_arango_db()
    if db is None or not session_id:
        return
    try:
        sessions = db.collection(CALL_SESSIONS_COLLECTION)
        existing = sessions.get(session_id)
        if not existing:
            return
        end_dt = datetime.datetime.now(datetime.timezone.utc)
        try:
            start_dt = datetime.datetime.fromisoformat(existing["startAt"].replace("Z", "+00:00"))
        except Exception:
            start_dt = end_dt
        duration = max(0, int((end_dt - start_dt).total_seconds()))
        sessions.update({
            "_key": session_id,
            "endAt": end_dt.isoformat().replace("+00:00", "Z"),
            "durationSeconds": duration,
        })
        logger.info("[ARANGO] call session ended _key=%s duration=%ds", session_id, duration)
    except Exception as exc:
        logger.warning("[ARANGO] failed to end call session: %s", exc)


async def create_call_session(
    user_id: str,
    language: str,
    gender: str,
    twin_id: Optional[str] = None,
) -> Optional[str]:
    return await asyncio.to_thread(_create_call_session_sync, user_id, language, gender, twin_id)


async def load_twin_settings(twin_id: Optional[str]) -> Optional[dict]:
    return await asyncio.to_thread(_load_twin_settings_sync, twin_id)


async def log_call_message(session_id: Optional[str], content: str, is_assistant: bool) -> None:
    if not session_id:
        return
    await asyncio.to_thread(_log_call_message_sync, session_id, content, is_assistant)


async def end_call_session(session_id: Optional[str]) -> None:
    if not session_id:
        return
    await asyncio.to_thread(_end_call_session_sync, session_id)


# ---------------------------------------------------------------------------
# ASR / LLM / TTS
# ---------------------------------------------------------------------------

async def transcribe(pcm: bytes, language: str) -> str:
    duration_s = len(pcm) / (SAMPLE_RATE * 2)
    logger.info("[ASR] start lang=%s pcm_bytes=%d duration=%.2fs", language, len(pcm), duration_s)
    wav_bytes = pcm_to_wav_bytes(pcm)
    t0 = asyncio.get_event_loop().time()
    async with httpx.AsyncClient(timeout=30) as client:
        files = {"file": ("audio.wav", wav_bytes, "audio/wav")}
        data = {"language": language}
        r = await client.post(f"{ASR_URL}/v1/microservice/asr", files=files, data=data)
        r.raise_for_status()
        text = (r.json().get("text") or "").strip()
    elapsed = asyncio.get_event_loop().time() - t0
    logger.info("[ASR] done elapsed=%.2fs text=%r", elapsed, text)
    return text


def _is_openai_compat(url: str) -> bool:
    """vLLM/OpenAI-compatible endpoints support real SSE streaming. chatqna
    returns a single JSON blob — we treat that as one big chunk."""
    return "chat/completions" in url


async def stream_llm_tokens(messages: list) -> AsyncIterator[str]:
    """Yield content tokens as the LLM produces them (vLLM SSE)."""
    last_user = next((m["content"] for m in reversed(messages) if m.get("role") == "user"), "")
    logger.info("[LLM] stream start endpoint=%s user_msg=%r history_len=%d max_tokens=%d",
                LLM_ENDPOINT, last_user[:80], len(messages), LLM_MAX_TOKENS)
    payload = {
        "model": LLM_MODEL,
        "messages": messages,
        "stream": True,
        "max_tokens": LLM_MAX_TOKENS,
        "temperature": LLM_TEMPERATURE,
    }
    t0 = asyncio.get_event_loop().time()
    first_at = None
    chunks = 0
    async with httpx.AsyncClient(timeout=120) as client:
        async with client.stream("POST", LLM_ENDPOINT, json=payload) as r:
            r.raise_for_status()
            async for line in r.aiter_lines():
                if not line:
                    continue
                if line.startswith("data:"):
                    line = line[5:].strip()
                if line == "[DONE]":
                    break
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                choices = obj.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta", {}).get("content")
                if delta:
                    if first_at is None:
                        first_at = asyncio.get_event_loop().time()
                        logger.info("[LLM] first token after %.2fs", first_at - t0)
                    chunks += 1
                    yield delta
    elapsed = asyncio.get_event_loop().time() - t0
    logger.info("[LLM] stream done elapsed=%.2fs chunks=%d", elapsed, chunks)


async def call_llm(messages: list) -> str:
    """Non-streaming LLM call. Fallback path for chatqna. Supports both
    OpenAI-compatible (`{choices:[{message:{content}}]}`) and chatqna
    (`{response: "..."}`) shapes.
    """
    last_user = next((m["content"] for m in reversed(messages) if m.get("role") == "user"), "")
    logger.info("[LLM] start endpoint=%s user_msg=%r history_len=%d max_tokens=%d",
                LLM_ENDPOINT, last_user[:80], len(messages), LLM_MAX_TOKENS)
    payload = {
        "model": LLM_MODEL,
        "messages": messages,
        "stream": False,
        "max_tokens": LLM_MAX_TOKENS,
        "temperature": LLM_TEMPERATURE,
    }
    t0 = asyncio.get_event_loop().time()
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(LLM_ENDPOINT, json=payload)
        r.raise_for_status()
        data = r.json()
    elapsed = asyncio.get_event_loop().time() - t0
    text = ""
    choices = data.get("choices")
    if isinstance(choices, list) and choices:
        msg = choices[0].get("message") or {}
        text = (msg.get("content") or "").strip()
    if not text:
        text = (data.get("response") or data.get("text") or "").strip()
    logger.info("[LLM] done elapsed=%.2fs reply_len=%d preview=%r", elapsed, len(text), text[:120])
    return text


async def _embed_query(query: str) -> Optional[list]:
    """Call TEI to embed the user's transcript. Returns the vector or None
    on any failure. ~10 ms typical."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.post(f"{TEI_EMBED_URL}/embed", json={"inputs": query})
            r.raise_for_status()
            data = r.json()
        return data[0] if isinstance(data, list) and data else None
    except Exception as exc:
        logger.warning("[RAG] embed failed: %s", exc)
        return None


def _arango_topk_chunks(vec: list, k: int) -> list[dict]:
    """Top-K cosine-similarity chunks from the OPEA dataprep collection.

    Direct AQL — no megaservice, no reranker, no graph traversal. With ~750
    chunks and 768-dim vectors, this is a ~50-100 ms full scan. Compared to
    the OPEA Arango retriever's ~3 s per call, the trade-off is: we lose the
    knowledge-graph hop (entity expansion, related-document traversal) but
    keep raw vector relevance, which is what voice needs.

    Each row returns `{ text, sim, file_id, chunk_index }` so the caller can
    log what was retrieved and from where (helps diagnose grounding issues)."""
    db = get_arango_db()
    if db is None:
        return []
    try:
        cursor = db.aql.execute(
            """
              FOR c IN @@coll
                FILTER c.embedding != null
                LET sim = COSINE_SIMILARITY(c.embedding, @vec)
                SORT sim DESC
                LIMIT @k
                RETURN { text: c.text, sim: sim, file_id: c.file_id, chunk_index: c.chunk_index }
            """,
            bind_vars={"@coll": VOICE_RAG_COLLECTION, "vec": vec, "k": k},
        )
        return [r for r in list(cursor) if r and r.get("text")]
    except Exception as exc:
        logger.warning("[RAG] AQL k-NN failed: %s", exc)
        return []


async def retrieve_for_voice(query: str) -> list[str]:
    """Top-K vector matches for the user's question, ready to inject into
    the prompt. Empty list on chitchat, missing collection, or any failure
    — voice continues without grounding rather than blocking the call."""
    if len(query) < VOICE_RAG_MIN_QUERY_LEN:
        return []
    t0 = asyncio.get_event_loop().time()

    vec = await _embed_query(query)
    if not vec:
        return []

    rows = await asyncio.to_thread(_arango_topk_chunks, vec, VOICE_RAG_TOP_K)
    chunks: list[str] = []
    for row in rows:
        text = (row.get("text") or "").strip()[:VOICE_RAG_CHUNK_CHARS]
        if not text:
            continue
        chunks.append(text)
        # Surface each retrieved chunk so the call log shows exactly what got
        # injected into the prompt — invaluable when an answer feels off.
        preview = text.replace("\n", " ")[:160]
        logger.info("[RAG]  - sim=%.3f file=%s chunk=%s preview=%r",
                    row.get("sim") or 0.0,
                    row.get("file_id") or "?",
                    row.get("chunk_index"),
                    preview)

    elapsed = asyncio.get_event_loop().time() - t0
    logger.info("[RAG] retrieved %d chunks in %.2fs for %r",
                len(chunks), elapsed, query[:60])
    return chunks


def inject_rag_chunks(history: list, chunks: list[str]) -> list:
    """Return a copy of `history` with the retrieved chunks prepended as a
    system message (placed right after the existing voice system prompt so
    the assistant sees its role first, then the grounded facts)."""
    if not chunks:
        return history
    rag_msg = {
        "role": "system",
        "content": (
            "Use this verified knowledge from the health knowledge base when "
            "answering. Only cite facts present here:\n"
            + "\n".join(f"- {c}" for c in chunks)
        ),
    }
    out = list(history)
    insert_at = 1 if out and out[0].get("role") == "system" else 0
    out.insert(insert_at, rag_msg)
    return out


async def speak(ws: WebSocket, text: str, language: str, *, voice: Optional[str],
                session_id: Optional[str] = None) -> None:
    """Synthesize `text` via Piper TTS and stream PCM frames to the client."""
    if not text or not text.strip():
        return
    text = text.strip()
    logger.info("[TTS] start lang=%s voice=%s text=%r", language, voice, text[:120])
    await ws.send_text(json.dumps({"type": "agent_text", "text": text}))
    await log_call_message(session_id, text, is_assistant=True)
    t0 = asyncio.get_event_loop().time()
    chunks = 0
    bytes_sent = 0
    payload = {"text": text, "language": language}
    if voice:
        payload["voice"] = voice
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            async with client.stream(
                "POST",
                f"{TTS_URL}/v1/microservice/tts",
                json=payload,
            ) as r:
                r.raise_for_status()
                sample_rate = int(r.headers.get("x-sample-rate", "22050"))
                await ws.send_text(json.dumps({"type": "tts_start", "sample_rate": sample_rate}))
                # Collect the PCM as it streams so we can append the whole
                # turn to the call recording at the end (one resample per
                # turn instead of per chunk).
                collected = bytearray()
                async for chunk in r.aiter_bytes(chunk_size=4096):
                    if chunk:
                        await ws.send_bytes(chunk)
                        collected.extend(chunk)
                        chunks += 1
                        bytes_sent += len(chunk)
                # Trailing silence so streamed sentences don't run together.
                # 16-bit mono PCM: 2 bytes per sample — build silence sample-wise
                # so the buffer is always an even number of bytes. Odd-length
                # PCM breaks audioop.ratecv() when the recorder resamples it.
                if TTS_INTER_SENTENCE_PAUSE_MS > 0:
                    silence_samples = int(sample_rate * TTS_INTER_SENTENCE_PAUSE_MS / 1000)
                    silence = b"\x00\x00" * silence_samples
                    if silence:
                        await ws.send_bytes(silence)
                        bytes_sent += len(silence)
                        collected.extend(silence)
                rec = _recorders.get(session_id) if session_id else None
                if rec is not None and collected:
                    # Never let a recording glitch break the call — the
                    # frontend needs tts_end below to unmute the mic.
                    try:
                        rec.append_assistant(bytes(collected), source_rate=sample_rate)
                    except Exception as exc:
                        logger.warning("[REC] append_assistant raised: %s", exc)
        await ws.send_text(json.dumps({"type": "tts_end"}))
        elapsed = asyncio.get_event_loop().time() - t0
        logger.info("[TTS] done elapsed=%.2fs chunks=%d bytes=%d sample_rate=%d",
                    elapsed, chunks, bytes_sent, sample_rate)
    except Exception as exc:
        logger.exception("[TTS] failed: %s", exc)
        try:
            await ws.send_text(json.dumps({"type": "error", "message": "tts_failed"}))
        except Exception:
            pass


def split_sentences(buf: str) -> tuple[List[str], str]:
    """Pull out completed sentences from a streaming buffer.

    Returns (list_of_sentences, leftover_buffer)."""
    sentences: List[str] = []
    last = 0
    for m in SENTENCE_BOUNDARY.finditer(buf):
        sentence = m.group(1).strip()
        if sentence:
            sentences.append(sentence)
        last = m.end()
    return sentences, buf[last:]


# ---------------------------------------------------------------------------
# Per-utterance orchestration
# ---------------------------------------------------------------------------

async def process_utterance(ws: WebSocket, pcm: bytes, language: str, history: list,
                             *, voice: Optional[str],
                             session_id: Optional[str] = None) -> None:
    """Run ASR -> LLM -> TTS for one utterance.

    Wrapped in `asyncio.create_task` by the WS loop, so a `barge_in` message
    triggers `task.cancel()` and we exit cleanly between steps. Each `await`
    is a cancellation point.
    """
    logger.info("[PROCESS] start voice=%s lang=%s pcm_bytes=%d",
                voice, language, len(pcm))
    full_parts: List[str] = []
    sentence_buf = ""
    try:
        try:
            text = await transcribe(pcm, language)
        except Exception as exc:
            logger.exception("[ASR] failed: %s", exc)
            await ws.send_text(json.dumps({"type": "error", "message": "asr_failed"}))
            return

        if not text or len(text) < 2:
            logger.info("[PROCESS] skipping — empty or near-empty transcript: %r", text)
            return

        # Add the user's utterance to the call recording (only if ASR was
        # confident enough to keep it — silent/garbage utterances are skipped
        # by the guard above). Never let a recording glitch break the turn.
        rec = _recorders.get(session_id) if session_id else None
        if rec is not None:
            try:
                rec.append_user(pcm, source_rate=SAMPLE_RATE)
            except Exception as exc:
                logger.warning("[REC] append_user raised: %s", exc)

        # Kick off retrieval immediately if RAG is on. It runs in parallel
        # with the WS send + Arango logging below so its latency is hidden.
        retrieval_task = (
            asyncio.create_task(retrieve_for_voice(text)) if VOICE_RAG_ENABLED else None
        )

        await ws.send_text(json.dumps({"type": "transcript", "text": text}))
        await log_call_message(session_id, text, is_assistant=False)
        history.append({"role": "user", "content": text})

        # If RAG was started, await it now and inject any chunks before the
        # LLM call. On failure or empty result we just skip injection.
        history_for_call = history
        if retrieval_task is not None:
            chunks = await retrieval_task
            if chunks:
                history_for_call = inject_rag_chunks(history, chunks)

        try:
            if _is_openai_compat(LLM_ENDPOINT):
                async for delta in stream_llm_tokens(history_for_call):
                    sentence_buf += delta
                    full_parts.append(delta)
                    sentences, sentence_buf = split_sentences(sentence_buf)
                    for sent in sentences:
                        await speak(ws, sent, language, voice=voice, session_id=session_id)
            else:
                full_reply = await call_llm(history_for_call)
                if full_reply:
                    full_parts.append(full_reply)
                    sentences, sentence_buf = split_sentences(full_reply + " ")
                    for sent in sentences:
                        await speak(ws, sent, language, voice=voice, session_id=session_id)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("[LLM] failed: %s", exc)
            await ws.send_text(json.dumps({"type": "error", "message": "llm_failed"}))
            return

        if sentence_buf.strip():
            await speak(ws, sentence_buf.strip(), language, voice=voice, session_id=session_id)

        full_reply = "".join(full_parts).strip()
        if not full_reply:
            logger.info("[PROCESS] LLM returned empty reply")
            return

        history.append({"role": "assistant", "content": full_reply})
        logger.info("[PROCESS] complete, history now has %d turns", len(history))
    except asyncio.CancelledError:
        partial = "".join(full_parts).strip()
        if partial:
            history.append({"role": "assistant", "content": partial + " [interrupted]"})
        logger.info("[BARGE-IN] processing cancelled mid-flight; partial reply len=%d",
                    len(partial))
        raise
    except Exception as exc:
        logger.exception("[PROCESS] failed: %s", exc)


# ---------------------------------------------------------------------------
# WebSocket entry point
# ---------------------------------------------------------------------------

@app.websocket("/v1/voice/stream")
async def voice_stream(ws: WebSocket) -> None:
    await ws.accept()
    peer = ws.client.host if ws.client else "?"
    logger.info("voice WS open from %s", peer)

    try:
        first = await asyncio.wait_for(ws.receive_text(), timeout=10)
    except (asyncio.TimeoutError, WebSocketDisconnect):
        await ws.close(code=1002, reason="no start message")
        return

    try:
        cfg = json.loads(first)
    except json.JSONDecodeError:
        await ws.close(code=1002, reason="invalid start")
        return
    if cfg.get("type") != "start":
        await ws.close(code=1002, reason="expected start")
        return

    language = (cfg.get("language") or "en").lower()
    # If the user picks a language we don't have a Piper voice for, the call
    # still proceeds (LLM in English, fallback English greeting) but the call
    # session records the requested language. Only force English if completely
    # unsupported (no voice AND no greeting / prompt).
    if language not in DEFAULT_VOICE_BY_LANGUAGE and language not in GREETINGS:
        logger.info("[VOICE] requested language %r has no voice or greeting; falling back to en", language)
        language = "en"

    # gender = "female" | "male"; passed through to TTS as the `voice` field.
    gender = (cfg.get("gender") or "").strip().lower()
    if gender not in {"female", "male"}:
        gender = ""
    voice = gender or None

    # Verify the short-lived voice token minted by the backend. We require it
    # when JWT_SECRET is configured — otherwise we run unauthenticated (dev).
    voice_token = cfg.get("voiceToken") or cfg.get("voice_token") or ""
    user_id: Optional[str] = None
    twin_id: Optional[str] = None
    if JWT_SECRET:
        claims = verify_voice_token(voice_token)
        if not claims:
            await ws.send_text(json.dumps({"type": "error", "message": "auth_failed"}))
            await ws.close(code=4401, reason="invalid voice token")
            return
        user_id = claims["user_id"]
        twin_id = claims["twin_id"]
    else:
        logger.warning("[AUTH] JWT_SECRET not set — accepting WS without verification")

    # Look up the AI twin (voice + greeting + language). Falls back gracefully
    # when twin_id is missing or the twin can't be resolved.
    twin_settings = await load_twin_settings(twin_id) if twin_id else None
    if twin_settings:
        # The twin's assigned voice is only honored when its language matches
        # the call language — otherwise we'd be asking, say, a US English voice
        # to speak Hindi text, which sounds broken. Pick a per-language default
        # voice instead when there's a mismatch.
        twin_voice_id = twin_settings.get("modelVoiceId")
        twin_voice_lang = _voice_language_prefix(twin_voice_id)
        # The frontend's selected language wins over the twin's stored language
        # for which Piper voice is used. We only fall back to the twin's
        # language when the user didn't pick one.
        if not cfg.get("language") and twin_settings.get("language"):
            language = twin_settings["language"]
        if twin_voice_id and twin_voice_lang == language:
            voice = twin_voice_id
        else:
            picked = _pick_voice_for_language(language, gender)
            if picked:
                voice = picked
                if twin_voice_id and twin_voice_lang != language:
                    logger.info(
                        "[VOICE] twin voice %s is %s but call language is %s; switching to %s",
                        twin_voice_id, twin_voice_lang, language, voice,
                    )
            elif twin_voice_id:
                # No language-default voice available — keep the twin's voice
                # rather than nothing, even if it's a language mismatch.
                voice = twin_voice_id
        logger.info("[TWIN] loaded twin=%s name=%r voice=%s lang=%s",
                    twin_id, twin_settings.get("name"), voice, language)
    else:
        # No twin: derive voice from language + gender directly.
        picked = _pick_voice_for_language(language, gender)
        if picked:
            voice = picked

    session_id: Optional[str] = None
    if user_id:
        session_id = await create_call_session(user_id, language, gender or "female", twin_id)
        logger.info("[SESSION] arango session_id=%s user=%s twin=%s", session_id, user_id, twin_id)
        if session_id and CALL_RECORDING_ENABLED:
            _recorders[session_id] = CallRecorder()
            logger.info("[REC] started recorder for session=%s", session_id)

    logger.info("[SESSION] open lang=%s voice=%s twin=%s peer=%s session=%s user=%s "
                "vad_aggr=%d silence_frames=%d min_utt=%d",
                language, voice or "(default)", twin_id or "-", peer, session_id, user_id,
                VAD_AGGRESSIVENESS, SILENCE_FRAMES_TO_END, MIN_UTTERANCE_FRAMES)

    # Build the system prompt for this call:
    #   1. FIRST system message: pure language directive — isolated from the
    #      health-companion prompt so Llama can't drown it in English context.
    #      Llama-3.1 weights early system turns heavily; putting this first
    #      reliably forces the reply language for low-resource pairs (zh, hi,
    #      ar, ru, etc.) where the base English prompt would otherwise dominate.
    #   2. SECOND system message: base prompt (twin's custom systemPrompt, or
    #      _VOICE_BASE_FALLBACK) + voice-mode constraints.
    base_prompt = (
        (twin_settings and twin_settings.get("systemPrompt"))
        or _VOICE_BASE_FALLBACK
    )
    lang_name = _CHAT_LANGUAGE_NAMES.get(language, language.upper())
    lang_directive = (
        f"CRITICAL LANGUAGE INSTRUCTION (highest priority):\n"
        f"You are on a phone call with a {lang_name}-speaking user. "
        f"Every single word of every reply MUST be in {lang_name}, written in "
        f"its native script. Do NOT mix in English words or phrases. Do NOT "
        f"reply in English even briefly. Do NOT include translations or "
        f"explanations in English. Do NOT acknowledge instructions in English.\n"
        f"If you find yourself starting a reply in English, STOP and restart "
        f"in {lang_name}. The user can only understand {lang_name}."
    )
    history = [
        {"role": "system", "content": lang_directive},
        {"role": "system", "content": base_prompt + _VOICE_MODE_INSTRUCTIONS},
    ]
    # Twin's AI Personality is appended as a second system turn so the LLM
    # follows the configured tone + length. Mirrors the chat path.
    if twin_settings and twin_settings.get("personalityPrompt"):
        history.append({"role": "system", "content": twin_settings["personalityPrompt"]})
    # Twin's callGreeting overrides the default per-language greeting. The
    # default voice prompt is in English; if the twin uses another language,
    # operators are responsible for setting a matching callGreeting.
    if twin_settings and twin_settings.get("callGreeting"):
        greeting = twin_settings["callGreeting"]
    else:
        # GREETINGS only covers en/fr/es/sw. Fall back to English greeting for
        # other languages — the system-prompt instruction will steer the LLM
        # to switch to the user's language on the next turn.
        greeting = GREETINGS.get(language) or GREETINGS["en"]
    history.append({"role": "assistant", "content": greeting})
    logger.info("[GREETING] sending greeting")
    await speak(ws, greeting, language, voice=voice, session_id=session_id)
    await ws.send_text(json.dumps({"type": "ready"}))
    logger.info("[GREETING] done; ready signal sent, listening for mic")

    vad = webrtcvad.Vad(VAD_AGGRESSIVENESS)
    pending = bytearray()             # leftover bytes that don't form a full frame yet
    utterance = bytearray()           # current utterance buffer
    speech_frames = 0
    silence_frames = 0
    in_speech = False
    drain_until = 0.0                 # epoch time before which we drop audio
    total_frames_received = 0
    last_audio_log = 0.0
    # Background processing task, so a barge-in message can cancel it without
    # blocking the WS receive loop.
    processing_task: Optional[asyncio.Task] = None

    def is_processing() -> bool:
        return processing_task is not None and not processing_task.done()

    async def kickoff_processing(pcm: bytes) -> None:
        nonlocal processing_task, drain_until

        async def _runner() -> None:
            nonlocal drain_until
            try:
                await process_utterance(ws, pcm, language, history, voice=voice,
                                        session_id=session_id)
            except asyncio.CancelledError:
                pass
            finally:
                drain_until = asyncio.get_event_loop().time() + POST_PROCESS_DRAIN_S
                logger.info("[SESSION] processing complete; drain window %.2fs to discard echo",
                            POST_PROCESS_DRAIN_S)

        processing_task = asyncio.create_task(_runner())

    async def maybe_process_now() -> None:
        nonlocal utterance, speech_frames, silence_frames, in_speech
        if speech_frames < MIN_UTTERANCE_FRAMES:
            # Routine: caller said something too brief to bother transcribing.
            # Keep at debug — sneezes / "uhh" shouldn't pollute prod logs.
            logger.debug("[VAD] utterance too short (%d frames < min %d), discarding",
                         speech_frames, MIN_UTTERANCE_FRAMES)
            utterance.clear()
            speech_frames = 0
            silence_frames = 0
            in_speech = False
            return
        pcm = bytes(utterance)
        logger.info("[VAD] utterance complete: %d speech frames, %d bytes total (%.2fs)",
                    speech_frames, len(pcm), len(pcm) / (SAMPLE_RATE * 2))
        utterance.clear()
        speech_frames = 0
        silence_frames = 0
        in_speech = False
        await kickoff_processing(pcm)

    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                logger.info("[SESSION] client disconnected")
                break

            if "text" in msg and msg["text"]:
                try:
                    parsed = json.loads(msg["text"])
                except json.JSONDecodeError:
                    continue
                msg_type = parsed.get("type")
                if msg_type == "stop":
                    logger.info("[SESSION] client requested stop")
                    break
                if msg_type == "barge_in":
                    logger.info("[BARGE-IN] received from client")
                    if is_processing():
                        processing_task.cancel()
                    # User is starting to talk — clear any half-built utterance
                    # and shorten the drain window so we listen quickly.
                    pending.clear()
                    utterance.clear()
                    speech_frames = 0
                    silence_frames = 0
                    in_speech = False
                    drain_until = asyncio.get_event_loop().time() + 0.2
                    try:
                        await ws.send_text(json.dumps({"type": "agent_interrupted"}))
                    except Exception:
                        pass
                    continue
                continue

            data = msg.get("bytes")
            if not data:
                continue

            total_frames_received += 1
            now = asyncio.get_event_loop().time()
            # 5-second heartbeat at debug level — useful for diagnosing
            # "WS open but no audio reaches us" but pure noise in prod.
            if now - last_audio_log > 5:
                logger.debug("[MIC] received %d audio messages so far (this one %d bytes), processing=%s in_speech=%s",
                             total_frames_received, len(data), is_processing(), in_speech)
                last_audio_log = now

            # Drop audio while we're processing (we're not listening) AND for a
            # short window after, to discard whatever queued up in the WS read
            # buffer while we were busy talking to ASR/LLM/TTS.
            if is_processing() or now < drain_until:
                pending.clear()
                if in_speech or speech_frames or silence_frames:
                    utterance.clear()
                    speech_frames = 0
                    silence_frames = 0
                    in_speech = False
                continue

            pending.extend(data)
            while len(pending) >= FRAME_BYTES:
                frame = bytes(pending[:FRAME_BYTES])
                del pending[:FRAME_BYTES]

                try:
                    is_speech = vad.is_speech(frame, SAMPLE_RATE)
                except Exception:
                    continue

                if is_speech:
                    utterance.extend(frame)
                    speech_frames += 1
                    silence_frames = 0
                    if not in_speech and speech_frames >= SPEECH_FRAMES_TO_START:
                        in_speech = True
                        logger.info("[VAD] speech detected (start)")
                        try:
                            await ws.send_text(json.dumps({"type": "user_speaking"}))
                        except Exception:
                            pass
                else:
                    if in_speech:
                        utterance.extend(frame)
                        silence_frames += 1
                        if silence_frames >= SILENCE_FRAMES_TO_END:
                            await maybe_process_now()
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.exception("voice WS loop error: %s", exc)
    finally:
        if processing_task is not None and not processing_task.done():
            processing_task.cancel()
            try:
                await processing_task
            except Exception:
                pass
        await end_call_session(session_id)
        # Build + persist the WAV after end_call_session so the recording is
        # available the moment the session's endAt / durationSeconds are set.
        try:
            await finalize_recording(session_id)
        except Exception as exc:
            logger.warning("[REC] finalize_recording crashed: %s", exc)
        logger.info("voice WS closed (peer=%s session=%s)", peer, session_id)


if __name__ == "__main__":
    import uvicorn
    # Bump WS keepalive so a slow chatqna response doesn't kill the socket.
    uvicorn.run(
        app,
        host=HOST,
        port=PORT,
        log_level="info",
        ws_ping_interval=30,
        ws_ping_timeout=120,
    )
