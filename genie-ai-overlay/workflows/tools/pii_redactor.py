# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""Pluggable PII redaction interface and implementations.

Decision 5 (SST PRD): PII redaction is a mandatory guardrail. Every tool
invocation's parameters and results pass through PII redaction; failure is
**blocking** — the system refuses to forward unredacted content rather than
logging and continuing.

Configuration:
    PII_REDACTOR_IMPL: "regex" | "presidio" | "http://..." (default: "regex")

The regex implementation provides baseline coverage without external
dependencies. The Presidio implementation provides production-grade NER-based
detection. The HTTP implementation delegates to an external service.
"""

from __future__ import annotations

import os
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field


# ---------------------------------------------------------------------------
# PII entity model
# ---------------------------------------------------------------------------
@dataclass
class PIIEntity:
    """A detected PII entity with location and classification."""

    entity_type: str  # e.g. "EMAIL", "PHONE", "PERSON", "CREDIT_CARD"
    start: int
    end: int
    score: float = 1.0
    text: str | None = None  # original text (only populated in detect, never logged)


# ---------------------------------------------------------------------------
# Redaction result
# ---------------------------------------------------------------------------
@dataclass
class RedactionResult:
    """Result of a redaction operation."""

    redacted_text: str
    entities_found: list[PIIEntity] = field(default_factory=list)
    entity_count: int = 0


# ---------------------------------------------------------------------------
# Abstract base class
# ---------------------------------------------------------------------------
class PIIRedactor(ABC):
    """Abstract PII redactor interface (Decision 5).

    All implementations must:
    - Detect PII entities in text
    - Redact detected entities with placeholders
    - BLOCK on failure (raise PIIRedactionError, never return unredacted text)
    """

    @abstractmethod
    async def redact(self, text: str) -> RedactionResult:
        """Redact PII from text. Returns redacted text with entity metadata.

        Raises:
            PIIRedactionError: If redaction fails for any reason.
                The caller MUST NOT forward the original text.
        """

    @abstractmethod
    async def detect(self, text: str) -> list[PIIEntity]:
        """Detect PII entities without redacting.

        Raises:
            PIIRedactionError: If detection fails.
        """


class PIIRedactionError(Exception):
    """Raised when PII redaction fails. Callers must BLOCK, not log-and-continue."""


# ---------------------------------------------------------------------------
# Regex implementation (baseline — no external dependencies)
# ---------------------------------------------------------------------------

# PII patterns aligned with existing telemetry scrubbing vocabulary from:
#   - components/gov-chat-backend/tracing-pii.js:4-6
#   - genie-ai-overlay/tracing.py:39
# Decision 5 says: extend these rather than define a third vocabulary.
_PII_PATTERNS: dict[str, re.Pattern] = {
    "EMAIL": re.compile(
        r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b",
    ),
    "PHONE": re.compile(
        r"(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b",
    ),
    "CREDIT_CARD": re.compile(
        r"\b(?:\d[ -]*?){13,19}\b",
    ),
    "SSN": re.compile(
        r"\b\d{3}-\d{2}-\d{4}\b",
    ),
    "IP_ADDRESS": re.compile(
        r"\b(?:\d{1,3}\.){3}\d{1,3}\b",
    ),
    "PASSPORT": re.compile(
        r"\b[A-Z]{1,2}\d{6,9}\b",
    ),
}

_REDACTION_PLACEHOLDER = "<{entity_type}>"


class RegexPIIRedactor(PIIRedactor):
    """Regex-based PII redactor — baseline implementation.

    Provides pattern-matching detection for common PII types without
    requiring Presidio or external services. Suitable for development
    and deployments where Presidio is not available.
    """

    def __init__(self, patterns: dict[str, re.Pattern] | None = None):
        self._patterns = patterns or _PII_PATTERNS

    async def detect(self, text: str) -> list[PIIEntity]:
        """Detect PII entities using regex patterns."""
        if not text:
            return []

        try:
            entities: list[PIIEntity] = []
            for entity_type, pattern in self._patterns.items():
                for match in pattern.finditer(text):
                    entities.append(
                        PIIEntity(
                            entity_type=entity_type,
                            start=match.start(),
                            end=match.end(),
                            score=1.0,
                            text=match.group(),
                        )
                    )
            # Sort by position (start), then by longest match first
            entities.sort(key=lambda e: (e.start, -(e.end - e.start)))
            return entities
        except Exception as exc:
            raise PIIRedactionError(f"PII detection failed: {exc}") from exc

    async def redact(self, text: str) -> RedactionResult:
        """Redact PII entities from text using regex patterns.

        Replaces each detected entity with a placeholder like <EMAIL>.
        Handles overlapping matches by preferring the earliest, longest match.
        """
        if not text:
            return RedactionResult(redacted_text="", entities_found=[], entity_count=0)

        try:
            entities = await self.detect(text)
            if not entities:
                return RedactionResult(redacted_text=text, entities_found=[], entity_count=0)

            # Remove overlapping entities (keep earliest/longest)
            filtered: list[PIIEntity] = []
            last_end = -1
            for entity in entities:
                if entity.start >= last_end:
                    filtered.append(entity)
                    last_end = entity.end

            # Build redacted text by replacing from end to start
            redacted = text
            for entity in reversed(filtered):
                placeholder = _REDACTION_PLACEHOLDER.format(entity_type=entity.entity_type)
                redacted = redacted[: entity.start] + placeholder + redacted[entity.end :]

            return RedactionResult(
                redacted_text=redacted,
                entities_found=filtered,
                entity_count=len(filtered),
            )
        except PIIRedactionError:
            raise
        except Exception as exc:
            raise PIIRedactionError(f"PII redaction failed: {exc}") from exc


# ---------------------------------------------------------------------------
# Presidio implementation (production-grade)
# ---------------------------------------------------------------------------
class PresidioPIIRedactor(PIIRedactor):
    """Microsoft Presidio-based PII redactor — production implementation.

    Uses Presidio Analyzer for NER-based detection and Presidio Anonymizer
    for redaction. Requires `presidio-analyzer` and `presidio-anonymizer`
    packages.
    """

    def __init__(self) -> None:
        self._analyzer = None
        self._anonymizer = None

    def _ensure_initialized(self) -> None:
        """Lazy-initialize Presidio engines (heavy import)."""
        if self._analyzer is not None:
            return
        try:
            from presidio_analyzer import AnalyzerEngine
            from presidio_anonymizer import AnonymizerEngine

            self._analyzer = AnalyzerEngine()
            self._anonymizer = AnonymizerEngine()
        except ImportError as exc:
            raise PIIRedactionError(
                "Presidio packages not installed. Install with: pip install presidio-analyzer presidio-anonymizer"
            ) from exc
        except Exception as exc:
            raise PIIRedactionError(f"Presidio initialization failed: {exc}") from exc

    async def detect(self, text: str) -> list[PIIEntity]:
        """Detect PII entities using Presidio NER."""
        if not text:
            return []

        try:
            self._ensure_initialized()
            results = self._analyzer.analyze(text=text, language="en")
            return [
                PIIEntity(
                    entity_type=r.entity_type,
                    start=r.start,
                    end=r.end,
                    score=r.score,
                    text=text[r.start : r.end],
                )
                for r in results
            ]
        except PIIRedactionError:
            raise
        except Exception as exc:
            raise PIIRedactionError(f"Presidio detection failed: {exc}") from exc

    async def redact(self, text: str) -> RedactionResult:
        """Redact PII entities using Presidio Anonymizer."""
        if not text:
            return RedactionResult(redacted_text="", entities_found=[], entity_count=0)

        try:
            self._ensure_initialized()
            analyzer_results = self._analyzer.analyze(text=text, language="en")
            anonymized = self._anonymizer.anonymize(text=text, analyzer_results=analyzer_results)

            entities = [
                PIIEntity(
                    entity_type=r.entity_type,
                    start=r.start,
                    end=r.end,
                    score=r.score,
                    text=text[r.start : r.end],
                )
                for r in analyzer_results
            ]

            return RedactionResult(
                redacted_text=anonymized.text,
                entities_found=entities,
                entity_count=len(entities),
            )
        except PIIRedactionError:
            raise
        except Exception as exc:
            raise PIIRedactionError(f"Presidio redaction failed: {exc}") from exc


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------
def create_pii_redactor(impl: str | None = None) -> PIIRedactor:
    """Create a PIIRedactor instance based on configuration.

    Args:
        impl: Implementation selector. If None, reads from PII_REDACTOR_IMPL
              env var (default: "regex").

    Returns:
        A configured PIIRedactor instance.

    Raises:
        PIIRedactionError: If the implementation is unknown or cannot be created.
    """
    impl = impl or os.getenv("PII_REDACTOR_IMPL", "regex")

    if impl == "regex":
        return RegexPIIRedactor()
    elif impl == "presidio":
        return PresidioPIIRedactor()
    elif impl.startswith("http://") or impl.startswith("https://"):
        # HTTP-delegating implementation (future — stub for now)
        raise PIIRedactionError(
            f"HTTP PII redactor not yet implemented. Configure PII_REDACTOR_IMPL=regex or presidio. Got: {impl}"
        )
    else:
        raise PIIRedactionError(f"Unknown PII_REDACTOR_IMPL: {impl}. Use 'regex', 'presidio', or an HTTP URL.")
