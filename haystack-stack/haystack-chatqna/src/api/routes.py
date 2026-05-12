# src/api/routes.py

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from typing import Optional
import json
import re  # <- NEW: added for markdown stripping

from src.api.schemas import (
    ChatRequest, ChatResponse,
    TTSRequest, TextChatRequest, TextChatResponse, VoiceChatResponse,
    Message,
)
from src.pipelines.chat import chat_pipeline

router = APIRouter()


# NEW: Markdown stripper - Amina only speaks words and numbers
def _strip_markdown(text: str) -> str:
    """Remove all markdown formatting so TTS speaks clean text."""
    text = re.sub(r'\*{1,3}(.+?)\*{1,3}', r'\1', text)
    text = re.sub(r'_{1,3}(.+?)_{1,3}', r'\1', text)
    text = re.sub(r'^#{1,6}\s*', '', text, flags=re.MULTILINE)
    text = re.sub(r'^[\s]*[-*\u2022]\s+', '', text, flags=re.MULTILINE)
    text = re.sub(r'^[\s]*\d+\.\s+', '', text, flags=re.MULTILINE)
    text = re.sub(r'^>\s*', '', text, flags=re.MULTILINE)
    text = re.sub(r'`(.+?)`', r'\1', text)
    text = text.replace('*', '').replace('#', '')
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()

# EXISTING: RAG Chat (unchanged)

@router.post("/chat", response_model=ChatResponse)
async def chat_endpoint(request: ChatRequest):
    try:
        history_dicts = [{"role": msg.role, "content": msg.content} for msg in request.history]

        # Phase B: shadow-mode abuse classifier (no behaviour change).
        from src.abuse_defense import shadow as _abuse_shadow
        _abuse_shadow.log_message(
            request.query,
            route="/api/v1/chat (rag)",
            user_age=request.user_age,
            user_gender=request.user_gender,
        )

        result = chat_pipeline.run(
            data={
                "classifier": {"query": request.query},
                "bypass_router": {"query": request.query},
                "vector_retriever": {"top_k": 10},
                "keyword_retriever": {"top_k": 10},
                "ranker": {"top_k": request.top_k},
                "prompt_builder_assistant": {
                    "history": history_dicts,
                    "user_age": request.user_age,
                    "user_gender": request.user_gender,
                },
                "prompt_builder_triage": {
                    "history": history_dicts,
                    "user_age": request.user_age,
                    "user_gender": request.user_gender,
                },
                "prompt_builder_smalltalk": {
                    "history": history_dicts,
                    "user_age": request.user_age,
                    "user_gender": request.user_gender,
                },
            },
            include_outputs_from={
                "llm", "prompt_builder_assistant",
                "prompt_builder_triage", "prompt_builder_smalltalk",
            },
        )

        if "prompt_builder_triage" in result:
            active_builder = "prompt_builder_triage"
        elif "prompt_builder_smalltalk" in result:
            active_builder = "prompt_builder_smalltalk"
        else:
            active_builder = "prompt_builder_assistant"

        for msg in result[active_builder]["prompt"]:
            print(f"\n[{msg.role.upper()}]:\n{msg.text}")

        raw_reply = result["llm"]["replies"][0]
        answer = raw_reply.text if hasattr(raw_reply, "text") else str(raw_reply)
        answer = _strip_markdown(answer)  # <- NEW: strip markdown

        return ChatResponse(answer=answer)

    except Exception as e:
        print(f"Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Text Chat (simplified - for multichannel/frontend compat)

@router.post("/text-chat", response_model=TextChatResponse)
async def text_chat_endpoint(request: TextChatRequest):
    try:
        history_dicts = [{"role": msg.role, "content": msg.content} for msg in request.history]

        # Phase B: shadow-mode abuse classifier (no behaviour change).
        from src.abuse_defense import shadow as _abuse_shadow
        _abuse_shadow.log_message(
            request.text,
            route="/api/v1/text-chat",
            user_age=request.user_age,
            user_gender=request.user_gender,
        )

        result = chat_pipeline.run(
            data={
                "classifier": {"query": request.text},
                "bypass_router": {"query": request.text},
                "vector_retriever": {"top_k": 10},
                "keyword_retriever": {"top_k": 10},
                "ranker": {"top_k": 3},
                "prompt_builder_assistant": {
                    "history": history_dicts,
                    "user_age": request.user_age,
                    "user_gender": request.user_gender,
                },
                "prompt_builder_triage": {
                    "history": history_dicts,
                    "user_age": request.user_age,
                    "user_gender": request.user_gender,
                },
                "prompt_builder_smalltalk": {
                    "history": history_dicts,
                    "user_age": request.user_age,
                    "user_gender": request.user_gender,
                },
            },
            include_outputs_from={
                "llm", "prompt_builder_assistant",
                "prompt_builder_triage", "prompt_builder_smalltalk",
            },
        )

        raw_reply = result["llm"]["replies"][0]
        answer = raw_reply.text if hasattr(raw_reply, "text") else str(raw_reply)
        answer = _strip_markdown(answer)  # <- NEW: strip markdown

        return TextChatResponse(transcript=request.text, answer=answer)

    except Exception as e:
        print(f"Text-chat error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Speech-to-Text (Whisper.cpp)

@router.post("/stt")
async def stt_endpoint(file: UploadFile = File(...)):
    """Transcribe audio to text via Whisper.cpp."""
    from src.services.stt_whisper import transcribe

    audio_bytes = await file.read()
    if not audio_bytes or len(audio_bytes) < 100:
        raise HTTPException(status_code=400, detail="Audio file too small or empty")

    transcript = await transcribe(audio_bytes, file.filename or "audio.ogg")
    if not transcript:
        raise HTTPException(status_code=422, detail="Could not transcribe audio")

    return {"transcript": transcript}

# Text-to-Speech (Piper TTS container)

@router.post("/tts")
async def tts_endpoint(request: TTSRequest):
    """Convert text to speech. Routes to Piper (English) or MMS (Mandinka)
    via the services.tts dispatcher. Returns WAV audio bytes.

    Body: { text, lang?, source_lang? }. Missing `lang` defaults to English,
    keeping every legacy caller working unchanged. When lang=="ma" the
    dispatcher auto-translates English input to Mandinka before synthesis
    using the Redis-cached translator — callers that already have target-
    language text can pass source_lang="ma" to skip the round-trip."""
    from src.services.tts import synthesize

    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Empty text")

    clean_text = _strip_markdown(request.text)  # strip markdown before TTS
    audio_bytes = await synthesize(
        clean_text,
        lang=(request.lang or "en"),
        source_lang=(request.source_lang or "en"),
    )
    if not audio_bytes:
        raise HTTPException(status_code=500, detail="TTS synthesis failed")

    return Response(content=audio_bytes, media_type="audio/wav")


# Voice Chat (full pipeline: STT -> RAG -> LLM -> TTS)

@router.post("/voice-chat")
async def voice_chat_endpoint(
    file: UploadFile = File(...),
    history: Optional[str] = Form(default="[]"),
    user_age: Optional[int] = Form(default=30),
    user_gender: Optional[str] = Form(default="person"),
    lang: Optional[str] = Form(default="en"),
):
    """
    Full voice pipeline:
    1. Whisper STT -> transcript
    2. Haystack RAG -> LLM answer
    3. TTS dispatcher -> audio response (Piper for English, MMS for Mandinka)
    """
    from src.services.stt_whisper import transcribe
    # Use the dispatcher in services.tts (not tts_piper directly) so Mandinka
    # callers get MMS instead of English Piper mispronouncing the reply.
    from src.services.tts import synthesize

    # Step 1: STT
    audio_bytes = await file.read()
    if not audio_bytes or len(audio_bytes) < 100:
        raise HTTPException(status_code=400, detail="Audio file too small")

    transcript = await transcribe(audio_bytes, file.filename or "audio.ogg")
    if not transcript:
        raise HTTPException(status_code=422, detail="Could not transcribe audio")

    # Phase B: shadow-mode abuse classifier on the transcribed text
    # (post-STT so we see what the user actually said, not the raw audio).
    from src.abuse_defense import shadow as _abuse_shadow
    _abuse_shadow.log_message(
        transcript,
        route="/api/v1/voice-chat (rag)",
        user_age=user_age,
        user_gender=user_gender,
    )

    # Step 2: Parse history
    try:
        history_list = json.loads(history) if history else []
        history_dicts = [
            {"role": h.get("role", "user"), "content": h.get("content", "")}
            for h in history_list if h.get("content", "").strip()
        ]
    except (json.JSONDecodeError, TypeError):
        history_dicts = []

    # Step 3: RAG + LLM
    try:
        result = chat_pipeline.run(
            data={
                "classifier": {"query": transcript},
                "bypass_router": {"query": transcript},
                "vector_retriever": {"top_k": 10},
                "keyword_retriever": {"top_k": 10},
                "ranker": {"top_k": 3},
                "prompt_builder_assistant": {
                    "history": history_dicts,
                    "user_age": user_age,
                    "user_gender": user_gender,
                },
                "prompt_builder_triage": {
                    "history": history_dicts,
                    "user_age": user_age,
                    "user_gender": user_gender,
                },
                "prompt_builder_smalltalk": {
                    "history": history_dicts,
                    "user_age": user_age,
                    "user_gender": user_gender,
                },
            },
            include_outputs_from={
                "llm", "prompt_builder_assistant",
                "prompt_builder_triage", "prompt_builder_smalltalk",
            },
        )

        raw_reply = result["llm"]["replies"][0]
        answer = raw_reply.text if hasattr(raw_reply, "text") else str(raw_reply)
        answer = _strip_markdown(answer)  # <- NEW: strip markdown

    except Exception as e:
        print(f"Voice-chat LLM error: {e}")
        raise HTTPException(status_code=500, detail=f"LLM pipeline error: {str(e)}")

    # Step 4: TTS — route by language so Mandinka users hear MMS, not Piper
    tts_audio = await synthesize(answer, lang=(lang or "en"))

    return {
        "transcript": transcript,
        "answer": answer,
        "has_audio": tts_audio is not None and len(tts_audio) > 100,
    }


@router.post("/voice-chat-audio")
async def voice_chat_audio_endpoint(
    file: UploadFile = File(...),
    history: Optional[str] = Form(default="[]"),
    user_age: Optional[int] = Form(default=30),
    user_gender: Optional[str] = Form(default="person"),
    lang: Optional[str] = Form(default="en"),
):
    """Same as /voice-chat but returns TTS audio directly as WAV.
    Uses the language dispatcher so Mandinka requests synthesise via MMS."""
    from src.services.stt_whisper import transcribe
    from src.services.tts import synthesize

    audio_bytes = await file.read()
    transcript = await transcribe(audio_bytes, file.filename or "audio.ogg")
    if not transcript:
        raise HTTPException(status_code=422, detail="Could not transcribe")

    # Phase B: shadow-mode abuse classifier on the transcribed text.
    from src.abuse_defense import shadow as _abuse_shadow
    _abuse_shadow.log_message(
        transcript,
        route="/api/v1/voice-chat-audio (rag)",
        user_age=user_age,
        user_gender=user_gender,
    )

    try:
        history_list = json.loads(history) if history else []
        history_dicts = [
            {"role": h.get("role", "user"), "content": h.get("content", "")}
            for h in history_list if h.get("content", "").strip()
        ]
    except (json.JSONDecodeError, TypeError):
        history_dicts = []

    result = chat_pipeline.run(
        data={
            "classifier": {"query": transcript},
            "bypass_router": {"query": transcript},
            "vector_retriever": {"top_k": 10},
            "keyword_retriever": {"top_k": 10},
            "ranker": {"top_k": 3},
            "prompt_builder_assistant": {"history": history_dicts, "user_age": user_age, "user_gender": user_gender},
            "prompt_builder_triage": {"history": history_dicts, "user_age": user_age, "user_gender": user_gender},
            "prompt_builder_smalltalk": {"history": history_dicts, "user_age": user_age, "user_gender": user_gender},
        },
        include_outputs_from={"llm", "prompt_builder_assistant", "prompt_builder_triage", "prompt_builder_smalltalk"},
    )

    raw_reply = result["llm"]["replies"][0]
    answer = raw_reply.text if hasattr(raw_reply, "text") else str(raw_reply)
    answer = _strip_markdown(answer)  # <- NEW: strip markdown

    tts_audio = await synthesize(answer, lang=(lang or "en"))
    if not tts_audio:
        raise HTTPException(status_code=500, detail="TTS failed")

    # Bug 2 fix: HTTP headers are latin-1 only. Raw transcripts in Mandinka or
    # any non-ASCII language used to crash Starlette with UnicodeEncodeError;
    # untrusted Whisper output also opened a header-injection path. URL-encode
    # the transcript so any byte (including \r\n) becomes ASCII-safe %XX.
    # Frontends decode with decodeURIComponent. Cap at 1500 chars so the header
    # stays under typical proxy limits.
    from urllib.parse import quote as _url_quote
    safe_transcript = _url_quote(transcript[:1500], safe="")

    return Response(
        content=tts_audio,
        media_type="audio/wav",
        headers={
            "X-Transcript": safe_transcript,
            "X-Transcript-Encoding": "url",
            "X-Answer-Length": str(len(answer)),
        },
    )