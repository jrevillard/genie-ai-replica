# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Redis-backed conversation history for WhatsApp users.

Each user's chat history is stored under ``whatsapp:chat:{phone_number}`` as a
JSON-serialised list of ``{"role": ..., "content": ...}`` messages. The list is
trimmed to the most recent ``REDIS_CONVERSATION_MAX_MESSAGES`` and the key is
refreshed with a 24-hour TTL on every write.

Message-id deduplication keys live under ``whatsapp:processed:{message_id}``
with a short TTL to absorb Meta webhook retries.
"""

from __future__ import annotations

import json
import logging

import config
import redis.asyncio as redis_async

logger = logging.getLogger(__name__)

_redis: redis_async.Redis | None = None


async def init_redis() -> redis_async.Redis:
    global _redis
    if _redis is not None:
        return _redis
    _redis = redis_async.Redis(
        host=config.REDIS_HOST,
        port=config.REDIS_PORT,
        password=config.REDIS_PASSWORD or None,
        decode_responses=True,
    )
    await _redis.ping()
    logger.info("Connected to Redis at %s:%s", config.REDIS_HOST, config.REDIS_PORT)
    return _redis


async def close_redis() -> None:
    global _redis
    if _redis is not None:
        await _redis.aclose()
        _redis = None


def _history_key(phone: str) -> str:
    return f"whatsapp:chat:{phone}"


def _dedup_key(message_id: str) -> str:
    return f"whatsapp:processed:{message_id}"


async def get_history(phone: str) -> list[dict]:
    client = await init_redis()
    raw = await client.get(_history_key(phone))
    if not raw:
        return []
    try:
        history = json.loads(raw)
        return history if isinstance(history, list) else []
    except json.JSONDecodeError:
        logger.warning("Corrupted history for %s; resetting", phone)
        return []


async def add_message(phone: str, role: str, content: str) -> list[dict]:
    client = await init_redis()
    history = await get_history(phone)
    history.append({"role": role, "content": content})
    if len(history) > config.REDIS_CONVERSATION_MAX_MESSAGES:
        history = history[-config.REDIS_CONVERSATION_MAX_MESSAGES :]
    await client.set(
        _history_key(phone),
        json.dumps(history),
        ex=config.REDIS_CONVERSATION_TTL,
    )
    return history


async def clear_history(phone: str) -> None:
    client = await init_redis()
    await client.delete(_history_key(phone))


async def is_message_processed(message_id: str) -> bool:
    """Atomically mark a message id as processed; return True if already seen."""
    client = await init_redis()
    # SET NX returns True if the key was set (i.e., not previously seen)
    was_set = await client.set(_dedup_key(message_id), "1", ex=config.REDIS_DEDUP_TTL, nx=True)
    return not bool(was_set)
