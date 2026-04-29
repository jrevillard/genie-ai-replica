# src/api/schemas.py

from pydantic import BaseModel
from typing import List, Optional


# Existing (unchanged) 

class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    query: str
    top_k: Optional[int] = 3
    history: Optional[list[Message]] = []
    user_age: Optional[int] = 30
    user_gender: Optional[str] = "person"


class ChatResponse(BaseModel):
    answer: str
    sources: List[str] = []


#NEW: Voice endpoints

class TTSRequest(BaseModel):
    text: str
    # Target output language — "en" plays English (Piper), "ma" plays
    # Mandinka (MMS). Anything else falls back to English. Callers that
    # already hold target-language text (skip translation) can set
    # source_lang = lang. Back-compat: missing lang == English.
    lang: Optional[str] = "en"
    source_lang: Optional[str] = "en"


class TextChatRequest(BaseModel):
    """Simplified chat for voice-gateway/multichannel compatibility."""
    text: str
    history: Optional[list[Message]] = []
    user_age: Optional[int] = 30
    user_gender: Optional[str] = "person"


class TextChatResponse(BaseModel):
    transcript: str
    answer: str


class VoiceChatResponse(BaseModel):
    transcript: str
    answer: str
    has_audio: bool = False