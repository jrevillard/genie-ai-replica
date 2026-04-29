# app/config.py

import os


class Settings:
    # Haystack Service (was voice-gateway:8010, now haystack:8000) 
    GATEWAY_URL: str = os.environ.get("GATEWAY_URL", "http://haystack-chatqna:8000")
    GATEWAY_TIMEOUT: int = int(os.environ.get("GATEWAY_TIMEOUT", "45"))

    # Redis (sessions, dedup, rate limiting)
    REDIS_URL: str = os.environ.get("REDIS_URL", "redis://redis:6379/0")
    SESSION_TTL: int = int(os.environ.get("SESSION_TTL", "86400"))  # 24h
    MAX_HISTORY: int = int(os.environ.get("MAX_HISTORY", "20"))

    # Rate Limiting 
    RATE_LIMIT_PER_USER: int = int(os.environ.get("RATE_LIMIT_PER_USER", "30"))
    RATE_LIMIT_WINDOW: int = int(os.environ.get("RATE_LIMIT_WINDOW", "60"))

    # Telegram 
    TELEGRAM_BOT_TOKEN: str = os.environ.get("TELEGRAM_BOT_TOKEN", "")

    # WhatsApp
    WHATSAPP_ACCESS_TOKEN: str = os.environ.get("WHATSAPP_ACCESS_TOKEN", "")
    WHATSAPP_PHONE_NUMBER_ID: str = os.environ.get("WHATSAPP_PHONE_NUMBER_ID", "")
    WHATSAPP_VERIFY_TOKEN: str = os.environ.get("WHATSAPP_VERIFY_TOKEN", "amina_health_2026")
    WHATSAPP_APP_SECRET: str = os.environ.get("WHATSAPP_APP_SECRET", "")

    # Messenger
    MESSENGER_PAGE_ACCESS_TOKEN: str = os.environ.get("MESSENGER_PAGE_ACCESS_TOKEN", "")
    MESSENGER_VERIFY_TOKEN: str = os.environ.get("MESSENGER_VERIFY_TOKEN", "amina_health_2026")
    MESSENGER_APP_SECRET: str = os.environ.get("MESSENGER_APP_SECRET", "")

    # Logging
    LOG_LEVEL: str = os.environ.get("LOG_LEVEL", "INFO")


settings = Settings()