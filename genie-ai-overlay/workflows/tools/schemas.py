# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Declared contracts for SST — the typed citation/degradation/tool schemas.

Architecture Decisions 10 (citation) and 7 (degradation) replace undeclared
inline dict literals with these models so the three consumers (chatqna, Vue 3,
Flutter) render one verified shape (NFR21). Consumers adopt these models in
their own stories; this module is the contract, not the wiring.

Image-safety rule: this module must stay self-contained (pydantic + stdlib
ONLY). It lives in ``workflows/tools/`` which ships in the chatqna image, and
the chatqna Dockerfile copies only selected ``core/`` files — a ``core.*``
import here breaks the deployed service (the same missing-module failure that
silently killed web search on 2026-08-31). The chunk-provenance enum lives in
``core/source_type.py`` (story 3-1, OQ-SST-6); do not duplicate it here.

Contract posture (review-hardened): models are frozen (DTOs — mutation would
bypass the declared shape), unknown fields are FORBIDDEN (a typo'd kwarg must
fail loudly, not silently drop a field two clients render), ``retrieved_at``
is coerced to UTC (a naive datetime would serialize offset-less and JS/Dart
would read it as the viewer's local time), and NaN/inf scores are rejected at
construction (the min/max clamp alone maps NaN to confidence 1.0 — the worst
score would masquerade as the highest trust).

Contracts here:
    CitationSourceType  labels cited results in an answer (document vs web
                        search vs feed) — the strings story 2-8 already emits.
    DegradationReason   the recorded 2-8 contract: LOW_QUALITY and
                        SEARCH_UNAVAILABLE live; CIRCUIT_OPEN and
                        EXECUTION_ERROR reserved for the governance wiring.
    Citation            Decision 10 — rendered identically by Vue 3 and Flutter.
    Degradation         Decision 7 — why a tool did not contribute, and what
                        the user should do instead (FR23, FR39, NFR12).
    ToolResult          the normalized shape every tool backend returns.

Serialization note: use ``to_client_dict()`` or ``model_dump_json()`` — plain
``model_dump()`` emits datetime objects that ``json.dumps`` cannot serialize.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class CitationSourceType(str, Enum):
    """Where a cited result came from, for platform-specific icon rendering.

    Distinct from ``core.source_type.SourceType``: that one labels *stored
    chunks* in the shared ArangoDB collection; this one labels *cited results
    in an answer*. A web-search hit is never a stored chunk.
    """

    DOCUMENT = "document"
    WEB_SEARCH = "web_search"
    FEED = "feed"


class DegradationReason(str, Enum):
    """Why a tool did not contribute to the answer (the recorded 2-8 contract).

    ``LOW_QUALITY``          results returned but none cleared the FR24 quality bar.
    ``SEARCH_UNAVAILABLE``   the search backend failed or was disabled.
    ``CIRCUIT_OPEN``         reserved — the governance circuit breaker was open.
    ``EXECUTION_ERROR``      reserved — the tool raised during execution.
    """

    LOW_QUALITY = "LOW_QUALITY"
    SEARCH_UNAVAILABLE = "SEARCH_UNAVAILABLE"
    CIRCUIT_OPEN = "CIRCUIT_OPEN"
    EXECUTION_ERROR = "EXECUTION_ERROR"


def _utcnow() -> datetime:
    """Timezone-aware UTC now (the default for ``retrieved_at`` fields)."""
    return datetime.now(timezone.utc)


def _coerce_utc(value: datetime) -> datetime:
    """Assume naive datetimes are UTC — an offset-less ISO string on the wire
    would be read as the *viewer's local time* by JS/Dart clients."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


class Citation(BaseModel):
    """One cited source, rendered identically by Vue 3 and Flutter (Decision 10, NFR21).

    Field names are the wire contract — the Vue sidebar and the Flutter parser
    read them verbatim. Renaming any of them is a breaking change on two clients.

    ``source_type`` drives the icon (document vs. web vs. feed) and the provenance
    label ("Uploaded document — Jan 2026" vs. "Web search — retrieved today").
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    url: str = Field(min_length=1)
    title: str
    source_type: CitationSourceType
    retrieved_at: datetime = Field(default_factory=_utcnow)
    confidence: float = Field(ge=0.0, le=1.0, allow_inf_nan=False)

    _coerce_retrieved_at = field_validator("retrieved_at", mode="after")(_coerce_utc)

    def to_client_dict(self) -> dict:
        """Serialize for the SSE metadata payload.

        Delegates to pydantic's JSON mode (enum flattened to its value,
        ``retrieved_at`` as an ISO-8601 UTC string) so a field added to the
        model can never be silently dropped from the payload.
        """
        return self.model_dump(mode="json")


class Degradation(BaseModel):
    """Visible, screen-reader-compatible notice that a tool did not contribute.

    Decision 7. Carried on the response so the client can render a notice instead of
    silently presenting a thinner answer — NFR12 forbids fabricating around a tool
    failure, and FR39 requires the notice be announced to assistive technology.

    ``fallback_applied`` is ``"rag_only"`` when knowledge-base results still answered
    the query, or ``"none"`` when nothing substituted for the failed tool.
    ``guidance`` is omitted from the payload when unset (None); an explicitly
    empty string is emitted as-is.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    tool_id: str = Field(min_length=1)
    reason: DegradationReason
    fallback_applied: Literal["rag_only", "none"]
    message: str = Field(min_length=1)
    guidance: str | None = None

    def to_client_dict(self) -> dict:
        """Serialize for the SSE metadata payload (enum flattened, None dropped)."""
        return self.model_dump(mode="json", exclude_none=True)


class ToolResult(BaseModel):
    """One normalized result from any tool backend.

    Every backend — SearXNG today, an alternate provider tomorrow (FR18) — maps into
    this shape, so fusion and citation rendering never branch on the provider.
    NaN/inf scores are rejected: the ``to_citation`` clamp would map NaN to
    confidence 1.0 (min/max comparisons against NaN are False), laundering the
    worst score as the highest trust.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    content: str
    url: str = Field(min_length=1)
    score: float = Field(default=0.0, allow_inf_nan=False)
    source_type: CitationSourceType = CitationSourceType.WEB_SEARCH
    title: str = ""
    retrieved_at: datetime = Field(default_factory=_utcnow)

    _coerce_retrieved_at = field_validator("retrieved_at", mode="after")(_coerce_utc)

    def to_citation(self) -> Citation:
        """Project this result into the shared citation contract.

        Falls back to the URL as the title when the backend supplied none
        (whitespace-only counts as none), so a citation is never rendered with
        an empty label.
        """
        return Citation(
            url=self.url,
            title=(self.title or "").strip() or self.url,
            source_type=self.source_type,
            retrieved_at=self.retrieved_at,
            confidence=max(0.0, min(1.0, self.score)),
        )
