"""Gemma vLLM provider — v2 implementation.

Reaches a local vLLM (or Cloudflare-tunnel) container speaking the
OpenAI-compatible HTTP API. Configuration matches the legacy env
surface: `GEMMA_BASE_URL`, `GEMMA_MODEL`, `GEMMA_API_KEY`.

Kept **wired-not-default** until tech lead confirms the Gambia
deployment GPU can run the target Gemma model end-to-end (inventory
open question Q6). Flip on via `V2_PRIMARY_PROVIDER=gemma`.
"""
from __future__ import annotations

import os
from typing import Any

from translation_v2.providers._openai_compatible import (
    OpenAICompatibleProvider,
    SystemPromptFn,
)


class GemmaProvider(OpenAICompatibleProvider):
    name = "gemma"

    @classmethod
    def from_env(
        cls,
        system_prompt_fn: SystemPromptFn | None = None,
        client_override: Any | None = None,
    ) -> "GemmaProvider":
        base_url = os.getenv(
            "GEMMA_BASE_URL", "http://vllm-translation-guardrail:9031/v1"
        )
        model = os.getenv("GEMMA_MODEL", "google/gemma-3-4b-it")
        api_key = os.getenv("GEMMA_API_KEY", "not-needed")

        if client_override is not None:
            client = client_override
        else:
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=api_key, base_url=base_url)

        return cls(
            client=client,
            model=model,
            system_prompt_fn=system_prompt_fn,
        )
