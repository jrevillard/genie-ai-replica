"""OpenAI-compatible chat-based answer generator for RAG.

Distinct from TranslationProvider — this one does free-form answering
given a system + user prompt. Works with any OpenAI-compatible
endpoint (OpenAI proper, local Gemma vLLM, etc.).

The distinction matters because the TranslationProvider interface
takes (text, source, target), which is the wrong shape for RAG-style
generation.
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class LLMGenerator:
    name: str = "openai-llm"

    def __init__(
        self,
        client: Any,
        model: str,
        temperature: float = 0.2,
        max_tokens: int = 800,
    ) -> None:
        self._client = client
        self._model = model
        self._temperature = temperature
        self._max_tokens = max_tokens

    async def answer(self, system_prompt: str, user_prompt: str) -> str:
        resp = await self._client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=self._temperature,
            max_tokens=self._max_tokens,
        )
        content = resp.choices[0].message.content or ""
        return content.strip()
