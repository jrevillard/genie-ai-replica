# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Configuration for the WhatsApp AI Agent microservice."""

import os

META_VERIFY_TOKEN = os.getenv("META_VERIFY_TOKEN", "")
META_ACCESS_TOKEN = os.getenv("META_ACCESS_TOKEN", "")
META_PHONE_NUMBER_ID = os.getenv("META_PHONE_NUMBER_ID", "")
META_GRAPH_API_VERSION = os.getenv("META_GRAPH_API_VERSION", "v21.0")
META_GRAPH_API_BASE = f"https://graph.facebook.com/{META_GRAPH_API_VERSION}"

CHATQNA_URL = os.getenv("CHATQNA_URL", "http://chatqna-xeon-backend-server:8888/v1/chatqna")
CHATQNA_TIMEOUT = int(os.getenv("CHATQNA_TIMEOUT", "120"))
CHATQNA_DEFAULT_LANGUAGE = os.getenv("CHATQNA_DEFAULT_LANGUAGE", "EN")
CHATQNA_DEFAULT_CATEGORY = os.getenv("CHATQNA_DEFAULT_CATEGORY", "General")

REDIS_HOST = os.getenv("WHATSAPP_REDIS_HOST", "redis-cache")
REDIS_PORT = int(os.getenv("WHATSAPP_REDIS_PORT", "6379"))
REDIS_PASSWORD = os.getenv("TRANSLATION_CACHE_PASSWORD", "")
REDIS_CONVERSATION_TTL = int(os.getenv("WHATSAPP_REDIS_TTL", "86400"))
REDIS_CONVERSATION_MAX_MESSAGES = int(os.getenv("WHATSAPP_REDIS_MAX_MESSAGES", "20"))
REDIS_DEDUP_TTL = int(os.getenv("WHATSAPP_REDIS_DEDUP_TTL", "300"))

WHATSAPP_AI_PORT = int(os.getenv("WHATSAPP_AI_PORT", "8000"))
WHATSAPP_MESSAGE_MAX_LENGTH = int(os.getenv("WHATSAPP_MESSAGE_MAX_LENGTH", "4000"))
WHATSAPP_FALLBACK_MESSAGE = os.getenv(
    "WHATSAPP_FALLBACK_MESSAGE",
    "Sorry, the assistant is temporarily unavailable. Please try again shortly.",
)
WHATSAPP_UNSUPPORTED_TYPE_MESSAGE = os.getenv(
    "WHATSAPP_UNSUPPORTED_TYPE_MESSAGE",
    "Sorry, I can only process text messages right now.",
)

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
