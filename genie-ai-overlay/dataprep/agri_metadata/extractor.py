# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""LLM-backed taxonomy extraction with retries, fallbacks, and telemetry hooks."""

from __future__ import annotations

import os
import time
from typing import Any, Callable

from openai import AsyncOpenAI
from pydantic import ValidationError

from agri_metadata.fallback_extract import fallback_extract
from agri_metadata.json_utils import extract_json_object
from agri_metadata.normalize import normalize_llm_output
from agri_metadata.prompts import SYSTEM_PROMPT
from agri_metadata.schema import LlmTaxonomyOutput, NormalizedTaxonomyPayload

METADATA_EXTRACTION_VERSION_DEFAULT = "1.0.0"

LogFn = Callable[..., Any] | None


class AgriTaxonomyExtractor:
    def __init__(self, log: LogFn = None):
        self._log = log

    def _emit(self, level: str, stage: str, message: str) -> None:
        if self._log:
            self._log(level, stage, message)

    def build_context_text(self, full_text: str, max_chars: int | None = None) -> str:
        """Prefer head + tail windows to cap tokens for large PDFs."""
        max_chars = max_chars or int(os.getenv("AGRI_TAXONOMY_MAX_INPUT_CHARS", "12000"))
        full_text = full_text.strip()
        if len(full_text) <= max_chars:
            return full_text
        head = int(max_chars * 0.65)
        tail = max_chars - head
        return (
            full_text[:head]
            + "\n\n[... CONTENT TRUNCATED FOR METADATA EXTRACTION ...]\n\n"
            + full_text[-tail:]
        )

    async def extract(
        self,
        full_text: str,
        file_id: str,
        *,
        temperature: float | None = None,
        timeout_s: float | None = None,
    ) -> tuple[NormalizedTaxonomyPayload, dict[str, Any]]:
        """
        Run LLM extraction with retries, then normalize.
        Returns (normalized payload, telemetry dict).
        """
        t0 = time.perf_counter()
        temperature = temperature if temperature is not None else float(os.getenv("AGRI_TAXONOMY_TEMPERATURE", "0.1"))
        timeout_s = timeout_s if timeout_s is not None else float(os.getenv("AGRI_TAXONOMY_TIMEOUT_SEC", "120"))
        max_retries = int(os.getenv("AGRI_TAXONOMY_MAX_RETRIES", "3"))
        model = os.getenv("VLLM_MODEL_ID") or os.getenv("AGRI_TAXONOMY_MODEL_ID", "")
        endpoint = os.getenv("VLLM_ENDPOINT", "")

        ctx = self.build_context_text(full_text)
        telemetry: dict[str, Any] = {
            "file_id": file_id,
            "model": model,
            "temperature": temperature,
            "input_chars": len(ctx),
            "llm_used": False,
            "fallback_used": False,
            "retries": 0,
            "latency_ms": 0.0,
            "error": None,
        }

        if not endpoint or not model:
            self._emit("WARN", "AgriTaxonomy", "VLLM_ENDPOINT or VLLM_MODEL_ID missing — using fallback extract.")
            raw_fb = fallback_extract(full_text)
            norm = normalize_llm_output(raw_fb)
            telemetry["fallback_used"] = True
            telemetry["latency_ms"] = (time.perf_counter() - t0) * 1000
            return norm, telemetry

        client = AsyncOpenAI(
            api_key=os.getenv("VLLM_API_KEY", "EMPTY"),
            base_url=f"{endpoint.rstrip('/')}/v1",
            timeout=timeout_s,
        )

        last_err: str | None = None
        for attempt in range(max_retries):
            telemetry["retries"] = attempt
            try:
                resp = await client.chat.completions.create(
                    model=model,
                    temperature=temperature,
                    top_p=0.9,
                    messages=[
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {
                            "role": "user",
                            "content": (
                                "Analyze the following document text and return JSON only.\n\n"
                                f"<<<\n{ctx}\n>>>"
                            ),
                        },
                    ],
                    response_format={"type": "json_object"},
                )
                content = resp.choices[0].message.content or ""
                data = extract_json_object(content)
                if not data:
                    raise ValueError("Unparseable JSON from LLM")

                raw = LlmTaxonomyOutput.model_validate(data)
                normalized = normalize_llm_output(raw)
                telemetry["llm_used"] = True
                telemetry["latency_ms"] = (time.perf_counter() - t0) * 1000
                return normalized, telemetry

            except (ValidationError, ValueError, TypeError) as e:
                last_err = str(e)
                self._emit("WARN", "AgriTaxonomy", f"attempt {attempt + 1}/{max_retries} failed: {last_err}")
            except Exception as e:  # noqa: BLE001 — retried path
                last_err = str(e)
                self._emit("WARN", "AgriTaxonomy", f"attempt {attempt + 1}/{max_retries} error: {last_err}")

        self._emit("ERROR", "AgriTaxonomy", f"All retries failed ({last_err}). Using regex fallback.")
        raw_fb = fallback_extract(full_text)
        norm = normalize_llm_output(raw_fb)
        telemetry["fallback_used"] = True
        telemetry["error"] = last_err
        telemetry["latency_ms"] = (time.perf_counter() - t0) * 1000
        return norm, telemetry
