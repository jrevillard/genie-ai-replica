# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""Real-time voice agent for GENIE.AI.

Joins a LiveKit room created by the browser, runs a streaming pipeline
of VAD (Silero) -> STT (faster-whisper via OpenAI-compatible HTTP) ->
LLM (chatqna via OpenAI-compatible HTTP) -> TTS (Piper via OpenAI-compatible
HTTP) and pushes synthesized audio back to the room.

Language is locked at room-join time via participant metadata
({"language": "fr"|"en"|"es"}), set by the backend when it mints the JWT.
"""

import asyncio
import json
import logging
import os
import threading
from typing import Optional

import uvicorn
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from livekit import rtc
from livekit.agents import AutoSubscribe, JobContext, WorkerOptions, cli, llm
from livekit.agents.pipeline import VoicePipelineAgent
from livekit.plugins import openai, silero


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("genieai_voice_agent")

LIVEKIT_URL = os.getenv("LIVEKIT_URL", "ws://livekit-server:7880")
ASR_URL = os.getenv("ASR_WHISPER_URL", "http://asr-whisper:9100")
TTS_URL = os.getenv("TTS_PIPER_URL", "http://tts-piper:9200")
LLM_ENDPOINT = os.getenv(
    "LLM_ENDPOINT",
    "http://chatqna-xeon-backend-server:8888/v1/chat/completions",
)
LLM_BASE_URL = LLM_ENDPOINT.rsplit("/chat/completions", 1)[0] if LLM_ENDPOINT.endswith("/chat/completions") else LLM_ENDPOINT
LLM_MODEL = os.getenv("LLM_MODEL", os.getenv("VLLM_LLM_MODEL_ID", "meta-llama/Meta-Llama-3.1-8B-Instruct"))
HEALTH_PORT = int(os.getenv("VOICE_AGENT_HEALTH_PORT", "9300"))

GREETINGS = {
    "fr": "Bonjour, je suis l'assistant vocal GENIE.AI. En quoi puis-je vous aider ?",
    "en": "Hello, this is the GENIE.AI voice assistant. How can I help you today?",
    "es": "Hola, soy el asistente de voz GENIE.AI. ¿En qué puedo ayudarte?",
}

SYSTEM_PROMPTS = {
    "fr": "Tu es un assistant vocal pour les services publics. Réponds en français, "
          "en phrases courtes et naturelles, comme dans une conversation téléphonique.",
    "en": "You are a voice assistant for public services. Reply in English, "
          "in short natural sentences, as in a phone conversation.",
    "es": "Eres un asistente de voz para servicios públicos. Responde en español, "
          "con frases cortas y naturales, como en una conversación telefónica.",
}


def _resolve_language(participant: rtc.RemoteParticipant) -> str:
    metadata = (participant.metadata or "").strip()
    if metadata:
        try:
            data = json.loads(metadata)
            lang = (data.get("language") or "").lower()
            if lang in GREETINGS:
                return lang
        except json.JSONDecodeError:
            logger.warning("Could not parse participant metadata: %r", metadata)
    return "en"


async def entrypoint(ctx: JobContext) -> None:
    logger.info("Agent joining room=%s", ctx.room.name)
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    participant = await ctx.wait_for_participant()
    language = _resolve_language(participant)
    logger.info("Participant=%s identity=%s language=%s", participant.sid, participant.identity, language)

    initial_ctx = llm.ChatContext().append(role="system", text=SYSTEM_PROMPTS[language])

    agent = VoicePipelineAgent(
        vad=silero.VAD.load(),
        stt=openai.STT(
            base_url=f"{ASR_URL}/v1",
            api_key="dummy",
            model="whisper-1",
            language=language,
        ),
        llm=openai.LLM(
            base_url=LLM_BASE_URL,
            api_key="dummy",
            model=LLM_MODEL,
        ),
        tts=openai.TTS(
            base_url=f"{TTS_URL}/v1",
            api_key="dummy",
            model="tts-1",
            voice=language,
        ),
        chat_ctx=initial_ctx,
        allow_interruptions=True,
        interrupt_speech_duration=0.5,
        interrupt_min_words=2,
    )

    agent.start(ctx.room, participant)
    await agent.say(GREETINGS[language], allow_interruptions=True)


# ---- health endpoint (so docker-compose healthcheck has something to poke) ----
health_app = FastAPI()


@health_app.get("/health")
def health() -> JSONResponse:
    return JSONResponse({
        "ok": True,
        "livekit_url": LIVEKIT_URL,
        "asr_url": ASR_URL,
        "tts_url": TTS_URL,
        "llm_endpoint": LLM_ENDPOINT,
        "llm_model": LLM_MODEL,
    })


def _start_health_server() -> None:
    config = uvicorn.Config(health_app, host="0.0.0.0", port=HEALTH_PORT, log_level="warning")
    server = uvicorn.Server(config)
    asyncio.run(server.serve())


if __name__ == "__main__":
    threading.Thread(target=_start_health_server, daemon=True).start()
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
