"""
Streaming chat endpoint for Amina Voice Gateway.
ADD this to your existing voice.py (or import it).

New endpoint: POST /v1/stream-chat
- Accepts JSON {text, history}
- Returns SSE stream with events:
  - event: token   data: {"t":"word "}           → real-time text tokens
  - event: sentence data: {"text":"Full sentence.","audio":"base64..."}  → sentence + TTS audio
  - event: done    data: {"full":"Complete response text"}
"""

import asyncio
import base64
import io
import json
import re
import os
import logging
from typing import List, Optional

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

logger = logging.getLogger("stream-chat")

# ══════════════════════════════════════════════════════════
# CONFIG — adjust to match your existing setup
# ══════════════════════════════════════════════════════════
# These should match whatever LLM + TTS you use in voice.py.
# If you use OpenAI-compatible API (Groq, OpenAI, Ollama, etc.):

LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.groq.com/openai/v1")
LLM_API_KEY = os.getenv("LLM_API_KEY", os.getenv("GROQ_API_KEY", ""))
LLM_MODEL = os.getenv("LLM_MODEL", "llama-3.3-70b-versatile")

# TTS — your existing /v1/tts endpoint or direct TTS service
# Option A: Call your own TTS endpoint (reuse existing logic)
# Option B: Direct TTS API call
# We'll use Option A by default — calls localhost TTS
TTS_INTERNAL_URL = os.getenv("TTS_INTERNAL_URL", "")  # leave empty to use in-process TTS

# System prompt for the health assistant
SYSTEM_PROMPT = os.getenv("SYSTEM_PROMPT", """You are Amina, a friendly and knowledgeable AI health assistant. 
You help users understand symptoms, medications, chronic conditions, and wellness advice.
Keep responses conversational, clear, and concise. Use short to medium sentences for natural speech flow.
Always recommend consulting a healthcare professional for serious concerns.""")

# Sentence splitting config
MIN_SENTENCE_LEN = 30  # minimum chars before we split for TTS
SENTENCE_DELIMITERS = re.compile(r'(?<=[.!?;:])\s+|(?<=\n)')


# ══════════════════════════════════════════════════════════
# MODELS
# ══════════════════════════════════════════════════════════

class StreamChatRequest(BaseModel):
    text: str
    history: Optional[List[dict]] = []


# ══════════════════════════════════════════════════════════
# LLM STREAMING (OpenAI-compatible)
# ══════════════════════════════════════════════════════════

async def stream_llm_tokens(text: str, history: list):
    """
    Yields tokens from the LLM as they arrive.
    Uses OpenAI-compatible streaming API.
    """
    import httpx

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for h in (history or []):
        messages.append({"role": h.get("role", "user"), "content": h.get("content", "")})
    messages.append({"role": "user", "content": text})

    headers = {"Content-Type": "application/json"}
    if LLM_API_KEY:
        headers["Authorization"] = f"Bearer {LLM_API_KEY}"

    body = {
        "model": LLM_MODEL,
        "messages": messages,
        "stream": True,
        "max_tokens": 1024,
        "temperature": 0.7,
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        async with client.stream(
            "POST",
            f"{LLM_BASE_URL}/chat/completions",
            headers=headers,
            json=body,
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data = line[6:]
                if data.strip() == "[DONE]":
                    return
                try:
                    chunk = json.loads(data)
                    delta = chunk.get("choices", [{}])[0].get("delta", {})
                    token = delta.get("content", "")
                    if token:
                        yield token
                except (json.JSONDecodeError, IndexError, KeyError):
                    continue


# ══════════════════════════════════════════════════════════
# TTS FOR A SINGLE SENTENCE
# ══════════════════════════════════════════════════════════

async def tts_sentence(text: str) -> Optional[str]:
    """
    Convert a sentence to audio, return base64-encoded audio bytes.
    Adjust this to match YOUR TTS implementation.
    """
    text = text.strip()
    if not text or len(text) < 3:
        return None

    try:
        # ─── OPTION A: Call your existing TTS function directly ───
        # If you have a `synthesize_speech(text) -> bytes` function in voice.py,
        # import and call it here. Example:
        #
        # from your_tts_module import synthesize_speech
        # audio_bytes = await synthesize_speech(text)
        # return base64.b64encode(audio_bytes).decode()

        # ─── OPTION B: Call your own /v1/tts endpoint via HTTP ───
        import httpx
        tts_url = TTS_INTERNAL_URL or "http://127.0.0.1:8000/v1/tts"

        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                tts_url,
                json={"text": text},
                headers={"Content-Type": "application/json"},
            )
            if r.status_code == 200:
                return base64.b64encode(r.content).decode()
            else:
                logger.warning(f"TTS failed ({r.status_code}): {r.text[:100]}")
                return None

    except Exception as e:
        logger.error(f"TTS error: {e}")
        return None


# ══════════════════════════════════════════════════════════
# SENTENCE BUFFER — splits streaming tokens into sentences
# ══════════════════════════════════════════════════════════

class SentenceBuffer:
    """Buffers streaming tokens and yields complete sentences."""

    def __init__(self, min_len=MIN_SENTENCE_LEN):
        self.buffer = ""
        self.min_len = min_len

    def add(self, token: str) -> Optional[str]:
        """Add a token. Returns a sentence if one is complete, else None."""
        self.buffer += token

        # Check if buffer contains a sentence boundary
        if len(self.buffer) >= self.min_len:
            # Try to split at sentence boundaries
            parts = SENTENCE_DELIMITERS.split(self.buffer, maxsplit=1)
            if len(parts) > 1 and len(parts[0].strip()) >= self.min_len:
                sentence = parts[0].strip()
                self.buffer = parts[1] if len(parts) > 1 else ""
                return sentence

        return None

    def flush(self) -> Optional[str]:
        """Return any remaining buffered text."""
        remaining = self.buffer.strip()
        self.buffer = ""
        return remaining if remaining else None


# ══════════════════════════════════════════════════════════
# SSE STREAMING ENDPOINT
# ══════════════════════════════════════════════════════════

router = APIRouter()


def sse_event(event: str, data: dict) -> str:
    """Format an SSE event."""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/v1/stream-chat")
async def stream_chat(req: StreamChatRequest, request: Request):
    """
    Stream LLM response with real-time TTS.

    SSE Events:
    - token:    {t: "word "}              — each LLM token for live text display
    - sentence: {text: "...", audio: "base64..."}  — complete sentence + TTS audio
    - done:     {full: "complete text"}    — stream finished
    - error:    {message: "..."}           — error occurred
    """

    async def generate():
        buf = SentenceBuffer()
        full_text = ""
        tts_tasks = []  # track background TTS tasks

        try:
            async for token in stream_llm_tokens(req.text, req.history or []):
                # Check if client disconnected
                if await request.is_disconnected():
                    return

                full_text += token

                # Send token event for real-time text display
                yield sse_event("token", {"t": token})

                # Check if we have a complete sentence
                sentence = buf.add(token)
                if sentence:
                    # Fire TTS for this sentence
                    audio_b64 = await tts_sentence(sentence)
                    yield sse_event("sentence", {
                        "text": sentence,
                        "audio": audio_b64 or "",
                    })

            # Flush remaining buffer
            remaining = buf.flush()
            if remaining:
                audio_b64 = await tts_sentence(remaining)
                yield sse_event("sentence", {
                    "text": remaining,
                    "audio": audio_b64 or "",
                })

            # Done
            yield sse_event("done", {"full": full_text})

        except Exception as e:
            logger.exception("Stream chat error")
            yield sse_event("error", {"message": str(e)})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # disable nginx buffering
            "Access-Control-Allow-Origin": "*",
        },
    )


# ══════════════════════════════════════════════════════════
# INTEGRATION: Add to your existing FastAPI app
# ══════════════════════════════════════════════════════════
#
# In your main voice.py or app.py, add:
#
#   from voice_streaming import router as stream_router
#   app.include_router(stream_router)
#
# That's it! The /v1/stream-chat endpoint is now available.
# ══════════════════════════════════════════════════════════
