# Copyright (C) 2026 ITU
# SPDX-License-Identifier: Apache-2.0
"""PII redaction for the tool request path — Decision 5, the sovereignty guarantee.

**The failure mode is BLOCK.** If redaction cannot be completed, the caller must
refuse to forward the content. Never log-and-continue: NFR6 requires zero PII
leakage, and a redactor that degrades to pass-through on error is worse than no
redactor at all, because it looks like protection while providing none.

Two existing PII vocabularies already live in this repo, both scoped to *telemetry*
attribute scrubbing:

    genie-ai-overlay/tracing.py:39                  ``_PII_KEYS``
    components/gov-chat-backend/tracing-pii.js:4-6  ``SENSITIVE_KEY_PATTERNS``

Architecture Decision 25 forbids inventing a third vocabulary. This module imports
``tracing._PII_KEYS`` for the *key-based* path (redacting tool parameters by name)
and adds patterns only for the *value-based* path (finding PII inside free text),
which the telemetry scrubbers never had to do.

Selection is via ``PII_REDACTOR_IMPL`` (FR13):

    ``regex``      stdlib-only, no dependencies. Best-effort — see class docstring.
    ``presidio``   Microsoft Presidio in library mode. The reference implementation.
    ``http://...`` a remote redactor service; the URL is the value.
"""

from __future__ import annotations

import os
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass

# Reuse the shared telemetry vocabulary for key-based redaction (Decision 25).
# tracing.py lives at the overlay root and is COPY'd to /app alongside this package.
try:
    from tracing import _PII_KEYS as _SHARED_PII_KEYS
except ImportError:  # pragma: no cover - only when tracing.py is absent
    _SHARED_PII_KEYS = frozenset()

REDACTION_PLACEHOLDER = "[REDACTED]"


class PIIRedactionError(Exception):
    """Redaction could not be completed.

    Callers MUST treat this as terminal and refuse to forward the content
    (Decision 5, NFR6). It is deliberately not a subclass of anything the
    governance pipeline catches-and-continues on.
    """


@dataclass(frozen=True)
class PIIEntity:
    """One detected PII span. ``end`` is exclusive, matching ``str`` slicing."""

    entity_type: str
    start: int
    end: int
    score: float = 1.0


class PIIRedactor(ABC):
    """Pluggable redactor interface (Decision 5, FR13).

    Implementations must raise :class:`PIIRedactionError` rather than returning
    partially-redacted text, so the BLOCK contract cannot be satisfied by accident.
    """

    @abstractmethod
    async def redact(self, text: str) -> str:
        """Return *text* with detected PII replaced.

        Raises:
            PIIRedactionError: redaction could not be completed. The caller must
                block, not forward.
        """

    @abstractmethod
    async def detect(self, text: str) -> list[PIIEntity]:
        """Return the PII spans found in *text*, without modifying it."""

    async def redact_params(self, params: dict) -> dict:
        """Redact a tool's parameter dict — key-based *and* value-based.

        Two passes, because a parameter can leak PII either way:

        1. **Key-based:** a parameter named ``email`` or ``session_id`` is redacted
           wholesale, using the shared telemetry vocabulary (Decision 25). Its value
           is PII by virtue of what the parameter *is*.
        2. **Value-based:** every remaining string value is scanned for PII patterns,
           because a free-text ``query`` parameter can carry an email address.

        Nested dicts recurse; lists of strings are scanned element-wise. Non-string
        scalars (int, bool, None) pass through — they carry no text to redact.
        """
        out: dict = {}
        for key, value in params.items():
            if key.lower() in _SHARED_PII_KEYS:
                out[key] = REDACTION_PLACEHOLDER
            elif isinstance(value, str):
                out[key] = await self.redact(value)
            elif isinstance(value, dict):
                out[key] = await self.redact_params(value)
            elif isinstance(value, list):
                out[key] = [await self.redact(v) if isinstance(v, str) else v for v in value]
            else:
                out[key] = value
        return out


# Value-based patterns. Ordered longest-match-first where patterns can overlap
# (IBAN before generic digit runs) so a broad pattern cannot pre-empt a specific one.
#
# ponytail: regex PII detection is best-effort and locale-blind — it will miss
# name entities, addresses, and most non-Latin-script identifiers. It exists so an
# air-gapped or minimal deployment is never *unprotected*, and so tests can run
# without the Presidio model download. Use PII_REDACTOR_IMPL=presidio in production.
_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("EMAIL", re.compile(r"\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b")),
    ("IBAN", re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b")),
    # 13-19 digits with optional separators — covers the major card networks.
    ("CREDIT_CARD", re.compile(r"\b(?:\d[ -]?){13,19}\b")),
    # E.164 and common national formats. Requires a separator or + to avoid
    # matching plain integers like years or quantities.
    ("PHONE", re.compile(r"(?:\+\d{1,3}[ -]?)?(?:\(\d{1,4}\)[ -]?)?\d{2,4}[ -]\d{2,4}(?:[ -]\d{2,4})+")),
    ("IP_ADDRESS", re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")),
    ("BEARER_TOKEN", re.compile(r"\bBearer\s+[A-Za-z0-9._~+/-]+=*", re.IGNORECASE)),
)


class RegexRedactor(PIIRedactor):
    """Stdlib-only redactor. The zero-dependency fallback.

    Detects email, IBAN, credit card, phone, IP address, and bearer tokens. It does
    **not** detect names, physical addresses, or most national identifiers — see the
    ``ponytail`` note on ``_PATTERNS``. Chosen as the default only because it cannot
    fail to load; ``presidio`` is the reference implementation (Decision 5).
    """

    async def detect(self, text: str) -> list[PIIEntity]:
        if not text:
            return []
        found: list[PIIEntity] = []
        for entity_type, pattern in _PATTERNS:
            for match in pattern.finditer(text):
                found.append(PIIEntity(entity_type, match.start(), match.end()))
        return found

    async def redact(self, text: str) -> str:
        if not text:
            return text
        entities = await self.detect(text)
        if not entities:
            return text
        # Replace right-to-left so earlier offsets stay valid, and drop spans that
        # overlap an already-replaced region (a card number inside an IBAN match).
        entities.sort(key=lambda e: (e.start, -e.end))
        merged: list[PIIEntity] = []
        for entity in entities:
            if merged and entity.start < merged[-1].end:
                continue
            merged.append(entity)
        result = text
        for entity in reversed(merged):
            result = result[: entity.start] + REDACTION_PLACEHOLDER + result[entity.end :]
        return result


class PresidioRedactor(PIIRedactor):
    """Microsoft Presidio in library mode — the reference implementation (Decision 5).

    Presidio is imported lazily inside ``__init__`` so that importing this module
    never requires the package or its spaCy model. A missing or broken install
    raises :class:`PIIRedactionError` at construction time, which surfaces the
    misconfiguration at startup instead of silently degrading on the first request.
    """

    def __init__(self, language: str = "en") -> None:
        try:
            from presidio_analyzer import AnalyzerEngine
            from presidio_anonymizer import AnonymizerEngine
        except ImportError as exc:
            raise PIIRedactionError(
                "PII_REDACTOR_IMPL=presidio but presidio-analyzer/presidio-anonymizer "
                "are not installed. Install them or select another implementation."
            ) from exc
        self._language = language
        self._analyzer = AnalyzerEngine()
        self._anonymizer = AnonymizerEngine()

    async def detect(self, text: str) -> list[PIIEntity]:
        if not text:
            return []
        try:
            results = self._analyzer.analyze(text=text, language=self._language)
        except Exception as exc:
            raise PIIRedactionError(f"Presidio analysis failed: {exc}") from exc
        return [PIIEntity(r.entity_type, r.start, r.end, r.score) for r in results]

    async def redact(self, text: str) -> str:
        if not text:
            return text
        try:
            results = self._analyzer.analyze(text=text, language=self._language)
            return self._anonymizer.anonymize(text=text, analyzer_results=results).text
        except Exception as exc:
            raise PIIRedactionError(f"Presidio redaction failed: {exc}") from exc


class HttpRedactor(PIIRedactor):
    """Remote redactor service, for deployments running Presidio as a sidecar.

    Any transport error, non-2xx status, or unparseable body raises
    :class:`PIIRedactionError` — an unreachable redactor must block, never pass through.
    """

    def __init__(self, endpoint: str, timeout_seconds: float = 5.0) -> None:
        self._endpoint = endpoint.rstrip("/")
        self._timeout = timeout_seconds

    async def _post(self, path: str, payload: dict) -> dict:
        import httpx

        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.post(f"{self._endpoint}{path}", json=payload)
                response.raise_for_status()
                return response.json()
        except Exception as exc:
            raise PIIRedactionError(f"Remote redactor {self._endpoint}{path} failed: {exc}") from exc

    async def redact(self, text: str) -> str:
        if not text:
            return text
        body = await self._post("/redact", {"text": text})
        if "text" not in body:
            raise PIIRedactionError("Remote redactor response missing 'text' field")
        return body["text"]

    async def detect(self, text: str) -> list[PIIEntity]:
        if not text:
            return []
        body = await self._post("/detect", {"text": text})
        return [
            PIIEntity(
                e.get("entity_type", "UNKNOWN"),
                int(e["start"]),
                int(e["end"]),
                float(e.get("score", 1.0)),
            )
            for e in body.get("entities", [])
        ]


def build_redactor(impl: str | None = None) -> PIIRedactor:
    """Construct the configured redactor (FR13).

    Args:
        impl: Override for ``PII_REDACTOR_IMPL``. ``regex`` (default), ``presidio``,
            or an ``http://``/``https://`` endpoint URL.

    Raises:
        PIIRedactionError: the value is unrecognized, or the selected implementation
            cannot be constructed. Failing here is deliberate — a deployment that
            asked for Presidio must not silently fall back to regex, because the
            operator would believe they had stronger protection than they do.
    """
    value = (impl if impl is not None else os.getenv("PII_REDACTOR_IMPL", "regex")).strip()
    if value.startswith(("http://", "https://")):
        return HttpRedactor(value)
    if value == "regex":
        return RegexRedactor()
    if value == "presidio":
        return PresidioRedactor()
    raise PIIRedactionError(
        f"Unrecognized PII_REDACTOR_IMPL={value!r}. Expected 'regex', 'presidio', or an http(s):// URL."
    )
