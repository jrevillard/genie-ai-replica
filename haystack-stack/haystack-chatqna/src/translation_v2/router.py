"""v2 translation request router.

Responsibilities, in order of priority per request:

  1. v2 TM lookup (if `USE_V2_TM_CACHE` AND a TM is injected).
  2. Per-request provider override — if the caller passes a provider
     name and that provider is registered, use it.
  3. PII gate — if `USE_V2_PII_LOCAL_ROUTING` is True AND the PII
     scanner reports PII, force the local (NLLB) provider regardless
     of primary/fallback config. Quality may be lower; privacy wins
     for clinical text.
  4. Primary provider.
  5. On primary failure, fallback provider (if distinct from primary).
  6. Shadow mode — for `V2_SHADOW_PERCENT` of requests, fire the
     fallback in the background and log disagreements. The shadow
     result is never returned.
  7. v2 TM write-back on success.

The router does NOT conform to `TranslationProvider` — it's a
higher-level coordinator. Batch translation is not wired in Step 3;
it lands with the RAG work in Step 4/5.
"""
from __future__ import annotations

import asyncio
import logging
import random
from typing import Any

from translation_v2 import flags
from translation_v2.interfaces import TranslationProvider
from translation_v2.observability import log_event, metrics_registry, timed
from translation_v2.pii import PIIDetector

logger = logging.getLogger(__name__)


class Router:
    def __init__(
        self,
        primary: TranslationProvider,
        fallback: TranslationProvider | None = None,
        local: TranslationProvider | None = None,
        tm: Any | None = None,
        pii_detector: PIIDetector | None = None,
        glossary: Any | None = None,
    ) -> None:
        self.primary = primary
        self.fallback = fallback
        self.local = local  # typically NLLB; used for PII-local routing
        self.tm = tm
        self.pii = pii_detector or PIIDetector()
        self.glossary = glossary
        self._shadow_tasks: set[asyncio.Task] = set()

    def is_v2_active(self) -> bool:
        return flags.USE_V2_TRANSLATION_PIPELINE

    def _providers_by_name(self) -> dict[str, TranslationProvider]:
        out: dict[str, TranslationProvider] = {self.primary.name: self.primary}
        if self.fallback is not None:
            out.setdefault(self.fallback.name, self.fallback)
        if self.local is not None:
            out.setdefault(self.local.name, self.local)
        return out

    def available_providers(self) -> list[str]:
        return list(self._providers_by_name())

    def _pick_provider(
        self, text: str, override: str | None
    ) -> tuple[TranslationProvider, str]:
        providers = self._providers_by_name()
        if override and override in providers:
            return providers[override], "header_override"
        if flags.USE_V2_PII_LOCAL_ROUTING and self.local is not None:
            report = self.pii.scan(text)
            if report.has_pii:
                log_event(
                    "v2_pii_local_route",
                    provider=self.local.name,
                    **report.summary(),
                )
                metrics_registry().counter_inc(
                    "v2_pii_local_routed_total", provider=self.local.name
                )
                return self.local, "pii_local_routing"
        return self.primary, "primary"

    async def translate(
        self,
        text: str,
        source: str,
        target: str,
        provider_override: str | None = None,
    ) -> str:
        translatable = bool(text and text.strip()) and source != target

        # 1. TM lookup
        if self.tm is not None and flags.USE_V2_TM_CACHE and translatable:
            cached = await self.tm.get(text, source, target, provider="router_v2")
            if cached is not None:
                log_event("v2_tm_hit", source=source, target=target)
                return cached

        # 2-4. Pick provider
        chosen, reason = self._pick_provider(text, provider_override)
        fallback_candidate: TranslationProvider | None = None
        if (
            self.fallback is not None
            and self.fallback.name != chosen.name
            and reason != "pii_local_routing"  # honor PII gate — don't fall back to cloud
        ):
            fallback_candidate = self.fallback

        log_event(
            "v2_route_decision",
            provider=chosen.name,
            reason=reason,
            source=source,
            target=target,
        )

        result: str = text
        used_provider = chosen.name
        try:
            with timed(
                "v2_translate",
                provider=chosen.name,
                source=source,
                target=target,
            ):
                result = await chosen.translate(text, source, target)
        except Exception as primary_err:
            logger.warning(
                "Primary provider %s failed: %s", chosen.name, primary_err
            )
            if fallback_candidate is None:
                log_event(
                    "v2_translate_all_failed",
                    provider=chosen.name,
                    error=str(primary_err),
                )
                raise
            used_provider = fallback_candidate.name
            with timed(
                "v2_translate_fallback",
                provider=fallback_candidate.name,
                source=source,
                target=target,
            ):
                result = await fallback_candidate.translate(text, source, target)

        # 5b. Bridge polish (Stage 8) — glossary-driven post-translation
        # substitution of English medical terms the LLM left in the
        # output. Runs only for EN -> MA with a loaded glossary; silent
        # no-op otherwise. Applied BEFORE TM write-back so cached
        # entries are the polished version.
        if (
            flags.USE_V2_BRIDGE_POLISH
            and self.glossary is not None
            and result
            and translatable
        ):
            try:
                from translation_v2 import bridge_polish
                if bridge_polish.should_polish(source, target):
                    before_len = len(result)
                    result = bridge_polish.polish_mandinka(result, self.glossary)
                    if len(result) != before_len:
                        log_event(
                            "v2_bridge_polish_applied",
                            provider=used_provider,
                            delta=len(result) - before_len,
                        )
                        metrics_registry().counter_inc(
                            "v2_bridge_polish_applied_total",
                            provider=used_provider,
                        )
            except Exception as polish_err:
                # Polish must never break a successful translation.
                logger.warning("Bridge polish failed (non-fatal): %s", polish_err)

        # 5c. Repetition guard — catch and truncate LLM loops that slip
        # through frequency/presence penalties. Runs on ALL translated
        # output regardless of language pair or provider.
        if result and translatable and result != text:
            try:
                from src.services.repetition_guard import guard_translation
                result = guard_translation(result)
            except Exception as guard_err:
                logger.warning("Repetition guard failed (non-fatal): %s", guard_err)

        # 6. Shadow mode
        if (
            flags.V2_SHADOW_PERCENT > 0
            and fallback_candidate is not None
            and used_provider == chosen.name
        ):
            if random.randint(1, 100) <= flags.V2_SHADOW_PERCENT:
                task = asyncio.create_task(
                    self._shadow_compare(
                        fallback_candidate, text, source, target, result
                    )
                )
                # Track task to avoid lost-task warnings; discard when done.
                self._shadow_tasks.add(task)
                task.add_done_callback(self._shadow_tasks.discard)

        # 7. TM write-back
        if (
            self.tm is not None
            and flags.USE_V2_TM_CACHE
            and translatable
            and result
            and result != text
        ):
            await self.tm.put(text, result, source, target, provider="router_v2")

        log_event(
            "v2_translate_done",
            provider=used_provider,
            source=source,
            target=target,
            length=len(result),
        )
        metrics_registry().counter_inc(
            "v2_translate_total",
            provider=used_provider,
            source=source,
            target=target,
            reason=reason,
        )
        return result

    async def _shadow_compare(
        self,
        other: TranslationProvider,
        text: str,
        source: str,
        target: str,
        primary_result: str,
    ) -> None:
        try:
            shadow_result = await other.translate(text, source, target)
        except Exception as e:
            log_event("v2_shadow_failed", provider=other.name, error=str(e))
            return
        if shadow_result != primary_result:
            log_event(
                "v2_shadow_mismatch",
                provider=other.name,
                source=source,
                target=target,
                primary_len=len(primary_result),
                shadow_len=len(shadow_result),
            )
            metrics_registry().counter_inc(
                "v2_shadow_mismatch_total", provider=other.name
            )
