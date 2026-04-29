# app/core/config.py

from functools import lru_cache
from typing import List

from pydantic import Field, HttpUrl
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # App Info
    APP_NAME: str = "voice-gateway"
    ENV: str = Field(default="local")  # local | dev | prod
    DEBUG: bool = Field(default=False)
    LOG_LEVEL: str = Field(default="INFO")

    # Downstream Services (Docker defaults)
    WHISPER_URL: HttpUrl = Field(default="http://voice-stt:8080")
    TTS_URL: HttpUrl = Field(default="http://voice-tts:5002")

    # OpenAI (Cloud LLM)
    OPENAI_API_KEY: str = Field(default="", repr=False)
    OPENAI_MODEL: str = Field(default="gpt-4o-mini")
    OPENAI_BASE_URL: HttpUrl = Field(default="https://api.openai.com/v1")

    # Timeouts (seconds)
    STT_TIMEOUT_S: int = Field(default=120, ge=1)
    TTS_TIMEOUT_S: int = Field(default=120, ge=1)
    LLM_TIMEOUT_S: int = Field(default=120, ge=1)

    # Voice Limits
    MAX_AUDIO_MB: int = Field(default=15, ge=1)
    MAX_AUDIO_DURATION_S: int = Field(default=60, ge=1)

    # Audio Processing
    FFMPEG_PATH: str = Field(default="ffmpeg")
    TARGET_SAMPLE_RATE: int = Field(default=16000, ge=8000)
    TARGET_CHANNELS: int = Field(default=1, ge=1)

    # Returned audio format for TTS responses
    TTS_RESPONSE_FORMAT: str = Field(default="wav")  # wav | mp3 (depending on your Coqui setup)

    # CORS
    ALLOWED_ORIGINS: List[str] = Field(default_factory=lambda: ["*"])
    
    # Feature Flags
    ENABLE_STT: bool = Field(default=True)
    ENABLE_TTS: bool = Field(default=True)
    ENABLE_LLM: bool = Field(default=True)  # renamed from ENABLE_CHAT for clarity


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
