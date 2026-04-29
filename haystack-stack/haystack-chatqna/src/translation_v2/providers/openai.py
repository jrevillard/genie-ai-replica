"""OpenAI gpt-4o-mini provider — v2 implementation.

Uses `AsyncOpenAI` with the same env-var surface the legacy translator
uses (`OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL`). The v2
provider instantiates its OWN client — it does not share the legacy
singleton — so failures here never cascade into the legacy path.
"""
from __future__ import annotations

from typing import Any

from translation_v2.providers._openai_compatible import (
    OpenAICompatibleProvider,
    SystemPromptFn,
)


class OpenAIProvider(OpenAICompatibleProvider):
    name = "openai"

    @classmethod
    def from_env(
        cls,
        system_prompt_fn: SystemPromptFn | None = None,
        client_override: Any | None = None,
    ) -> "OpenAIProvider":
        """Build an instance using the same settings as legacy."""
        if client_override is not None:
            client = client_override
            # Best-effort: prefer configured model if present, else default
            from src.config import settings
            model = getattr(settings, "OPENAI_MODEL", "gpt-4o-mini")
        else:
            from openai import AsyncOpenAI
            from src.config import settings
            client = AsyncOpenAI(
                api_key=getattr(settings, "OPENAI_API_KEY", None),
                base_url=getattr(settings, "OPENAI_BASE_URL", None),
            )
            model = getattr(settings, "OPENAI_MODEL", "gpt-4o-mini")
        return cls(
            client=client,
            model=model,
            system_prompt_fn=system_prompt_fn,
        )
