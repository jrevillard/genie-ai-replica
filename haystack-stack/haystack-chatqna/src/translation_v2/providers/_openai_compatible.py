"""Shared implementation for any OpenAI-compatible chat backend.

Both OpenAI proper and local Gemma vLLM speak this protocol. The
concrete subclasses (`OpenAIProvider`, `GemmaProvider`) differ only in
their default config — both funnel through this class.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Callable, Protocol

from translation_v2.prompts import build_batch_user_prompt, build_system_prompt

logger = logging.getLogger(__name__)


class _ChatClient(Protocol):
    """The slice of AsyncOpenAI we actually use."""
    chat: Any


SystemPromptFn = Callable[[str, str], str]


def _default_system_prompt_fn(source: str, target: str) -> str:
    return build_system_prompt(source, target, "")


class OpenAICompatibleProvider:
    """Baseline for OpenAI-compatible chat completions providers.

    Subclasses set `name` and typically offer a `from_env()` classmethod
    that builds a real `AsyncOpenAI` client. Tests pass a pre-built
    client directly.
    """

    name: str = "openai-compatible"

    def __init__(
        self,
        client: _ChatClient,
        model: str,
        system_prompt_fn: SystemPromptFn | None = None,
        max_tokens_single: int = 1500,
        max_tokens_batch: int = 2500,
        temperature: float = 0.2,
        frequency_penalty: float = 0.5,
        presence_penalty: float = 0.3,
    ) -> None:
        self._client = client
        self._model = model
        self._system_prompt_fn = system_prompt_fn or _default_system_prompt_fn
        self._max_single = max_tokens_single
        self._max_batch = max_tokens_batch
        self._temperature = temperature
        # Anti-repetition defaults.
        # Low-resource targets (e.g., Mandinka) cause small models to
        # degenerate into particle-repetition loops ("N be ne n be ne bo n
        # be jere...") when the token budget is tight and there's no
        # frequency penalty. Both knobs address that; defaults are
        # conservative — translation quality tolerates moderate penalties.
        self._frequency_penalty = frequency_penalty
        self._presence_penalty = presence_penalty

    def _should_skip(self, text: str, source: str, target: str) -> bool:
        if not text or not text.strip():
            return True
        if source == target:
            return True
        return False

    @staticmethod
    def _strip_quoting(text: str) -> str:
        return text.strip().strip('"').strip("'").strip()

    async def translate(self, text: str, source: str, target: str) -> str:
        if self._should_skip(text, source, target):
            return text
        system_prompt = self._system_prompt_fn(source, target)
        try:
            resp = await self._client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": text},
                ],
                temperature=self._temperature,
                max_tokens=self._max_single,
                frequency_penalty=self._frequency_penalty,
                presence_penalty=self._presence_penalty,
            )
        except Exception:
            logger.exception("%s.translate: chat.completions.create failed", self.name)
            raise
        content = resp.choices[0].message.content or ""
        return self._strip_quoting(content)

    async def translate_batch(
        self, texts: list[str], source: str, target: str
    ) -> list[str]:
        if not texts:
            return []
        if source == target:
            return list(texts)
        system_prompt = self._system_prompt_fn(source, target)
        user_msg = build_batch_user_prompt(list(texts))
        try:
            resp = await self._client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_msg},
                ],
                temperature=self._temperature,
                max_tokens=self._max_batch,
                frequency_penalty=self._frequency_penalty,
                presence_penalty=self._presence_penalty,
            )
        except Exception:
            logger.exception(
                "%s.translate_batch: chat.completions.create failed", self.name
            )
            raise
        raw = (resp.choices[0].message.content or "").strip()
        # Fallback to originals; overwrite what the model numbered.
        out = list(texts)
        for line in raw.split("\n"):
            m = re.match(r"^\s*\[(\d+)\]\s*(.+)$", line)
            if m:
                idx = int(m.group(1)) - 1
                if 0 <= idx < len(out):
                    out[idx] = self._strip_quoting(m.group(2))
        return out
