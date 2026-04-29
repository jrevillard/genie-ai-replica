"""Tests for LLMGenerator (RAG answer producer)."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from translation_v2.rag.llm_generator import LLMGenerator


def _fake_client(content: str) -> MagicMock:
    msg = MagicMock()
    msg.content = content
    choice = MagicMock()
    choice.message = msg
    resp = MagicMock()
    resp.choices = [choice]
    client = MagicMock()
    client.chat.completions.create = AsyncMock(return_value=resp)
    return client


class TestLLMGenerator:
    @pytest.mark.asyncio
    async def test_returns_content(self):
        gen = LLMGenerator(client=_fake_client("Answer text"), model="gpt-4o-mini")
        out = await gen.answer("sys", "user")
        assert out == "Answer text"

    @pytest.mark.asyncio
    async def test_sends_system_and_user_messages(self):
        client = _fake_client("x")
        gen = LLMGenerator(client=client, model="m")
        await gen.answer("SYS", "USER")
        call = client.chat.completions.create
        messages = call.call_args.kwargs["messages"]
        assert messages[0]["role"] == "system"
        assert messages[0]["content"] == "SYS"
        assert messages[1]["role"] == "user"
        assert messages[1]["content"] == "USER"

    @pytest.mark.asyncio
    async def test_strips_whitespace(self):
        gen = LLMGenerator(client=_fake_client("  answer  \n"), model="m")
        assert await gen.answer("s", "u") == "answer"

    @pytest.mark.asyncio
    async def test_none_content_becomes_empty_string(self):
        client = MagicMock()
        msg = MagicMock()
        msg.content = None
        choice = MagicMock()
        choice.message = msg
        resp = MagicMock()
        resp.choices = [choice]
        client.chat.completions.create = AsyncMock(return_value=resp)

        gen = LLMGenerator(client=client, model="m")
        assert await gen.answer("s", "u") == ""

    @pytest.mark.asyncio
    async def test_model_and_params_passed(self):
        client = _fake_client("x")
        gen = LLMGenerator(client=client, model="test-model", temperature=0.7, max_tokens=42)
        await gen.answer("s", "u")
        kwargs = client.chat.completions.create.call_args.kwargs
        assert kwargs["model"] == "test-model"
        assert kwargs["temperature"] == 0.7
        assert kwargs["max_tokens"] == 42
