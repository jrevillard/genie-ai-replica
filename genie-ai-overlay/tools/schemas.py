# Copyright (C) 2026 ITU
# SPDX-License-Identifier: Apache-2.0
"""Declared contracts for SST — the repo's first typed citation schema.

Before this module, the citation payload was an inline dict literal built at
``genieai_chatqna.py:1629-1638``: undeclared, untestable, and impossible to verify
against the Vue and Flutter renderers. Architecture Decision 24 replaces it with
declared models so the three consumers (chatqna, Vue 3, Flutter) render one shape.

Contracts here:
    ChunkSourceType   Decision 21 — the shared chunk discriminator. SST writes
                      ``feed``; OKF writes ``okf``; existing file chunks are ``file``.
                      Cross-pillar: see OQ-SST-6 before extending.
    Citation          Decision 10 — the shared citation JSON, rendered identically
                      by Vue 3 and Flutter (NFR21).
    Degradation       Decision 7 — why a tool did not contribute, and what the user
                      should do instead (FR23, FR39, NFR12).
    ToolResult        The normalized shape every tool backend returns.
    GovernanceOutcome The verdict of the governance pipeline (Decision 16).
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, Field


class ChunkSourceType(str, Enum):
    """Provenance discriminator on chunk documents in the shared ArangoDB collection.

    Decision 3 keeps feed-sourced chunks in the *existing* chunks collection rather
    than a parallel corpus. This enum is the discriminator that makes them separable.

    ``FILE`` is the default for every chunk written before SST — the field is additive
    and nullable, so a missing value must be read as ``FILE`` (NFR25).

    OKF writes ``OKF`` into the same field. Neither pillar has shipped it yet, so the
    vocabulary must be agreed once (OQ-SST-6) rather than twice.
    """

    FILE = "file"
    FEED = "feed"
    OKF = "okf"


class CitationSourceType(str, Enum):
    """Where a cited result came from, for platform-specific icon rendering.

    Distinct from :class:`ChunkSourceType`: that one labels *stored chunks*, this one
    labels *cited results in an answer*. A web-search hit is never a stored chunk.
    """

    DOCUMENT = "document"
    WEB_SEARCH = "web_search"
    FEED = "feed"


class DegradationReason(str, Enum):
    """Why a tool failed to contribute to the answer.

    ``CIRCUIT_OPEN``   the breaker was open, so the tool was never called (FR41).
    ``LOW_QUALITY``    results returned but none cleared the quality bar (FR24).
    ``TIMEOUT``        the tool exceeded its ``execution_budget_ms``.
    ``DENIED``         governance blocked the call — PII, authz, or rate limit.
    ``BACKEND_ERROR``  the backend returned an error or unparseable response.
    """

    CIRCUIT_OPEN = "CIRCUIT_OPEN"
    LOW_QUALITY = "LOW_QUALITY"
    TIMEOUT = "TIMEOUT"
    DENIED = "DENIED"
    BACKEND_ERROR = "BACKEND_ERROR"


class GovernanceStatus(str, Enum):
    """Outcome of the governance pipeline for a single tool invocation."""

    ALLOWED = "allowed"
    DENIED = "denied"


def _utcnow() -> datetime:
    """Timezone-aware UTC now. Separate function so tests can monkeypatch it."""
    return datetime.now(timezone.utc)


class Citation(BaseModel):
    """One cited source, rendered identically by Vue 3 and Flutter (Decision 10, NFR21).

    Field names are the contract — they are consumed verbatim by
    ``components/gov-chat-frontend/src/components/RightSideBarComponent.vue`` and
    ``mobile/genie_ai_mobile/lib/components/chat/right_sidebar_component.dart``.
    Renaming any of them is a breaking change on two clients.

    ``source_type`` drives the icon (document vs. web vs. feed) and the provenance
    label ("Uploaded document — Jan 2026" vs. "Web search — retrieved today").
    """

    url: str
    title: str
    source_type: CitationSourceType
    retrieved_at: datetime = Field(default_factory=_utcnow)
    confidence: float = Field(ge=0.0, le=1.0)

    def to_client_dict(self) -> dict:
        """Serialize for the SSE metadata payload.

        ``retrieved_at`` is emitted as an ISO-8601 string and ``source_type`` as its
        plain value, because the Flutter parser reads raw JSON maps and does not
        deserialize enums.
        """
        return {
            "url": self.url,
            "title": self.title,
            "source_type": self.source_type.value,
            "retrieved_at": self.retrieved_at.isoformat(),
            "confidence": self.confidence,
        }


class Degradation(BaseModel):
    """Visible, screen-reader-compatible notice that a tool did not contribute.

    Decision 7. Carried on the response so the client can render a notice instead of
    silently presenting a thinner answer — NFR12 forbids fabricating around a tool
    failure, and FR39 requires the notice be announced to assistive technology.

    ``fallback_applied`` is ``"rag_only"`` when knowledge-base results still answered
    the query, or ``"none"`` when nothing substituted for the failed tool.
    """

    tool_id: str
    reason: DegradationReason
    fallback_applied: str
    message: str
    guidance: str | None = None

    def to_client_dict(self) -> dict:
        """Serialize for the SSE metadata payload (enum flattened to its value)."""
        payload = {
            "tool_id": self.tool_id,
            "reason": self.reason.value,
            "fallback_applied": self.fallback_applied,
            "message": self.message,
        }
        if self.guidance:
            payload["guidance"] = self.guidance
        return payload


class ToolResult(BaseModel):
    """One normalized result from any tool backend.

    Every backend — SearXNG today, an alternate provider tomorrow (FR18) — maps into
    this shape, so fusion and citation rendering never branch on the provider.
    """

    content: str
    url: str
    score: float = 0.0
    source_type: CitationSourceType = CitationSourceType.WEB_SEARCH
    title: str = ""
    retrieved_at: datetime = Field(default_factory=_utcnow)

    def to_citation(self) -> Citation:
        """Project this result into the shared citation contract.

        Falls back to the URL as the title when the backend supplied none, so a
        citation is never rendered with an empty label.
        """
        return Citation(
            url=self.url,
            title=self.title or self.url,
            source_type=self.source_type,
            retrieved_at=self.retrieved_at,
            confidence=max(0.0, min(1.0, self.score)),
        )


class GovernanceOutcome(BaseModel):
    """The governance pipeline's verdict for one tool invocation (Decision 16).

    ``status=DENIED`` is terminal: the caller must not invoke the tool. This is how
    PII-redaction failure blocks rather than logs-and-continues (Decision 5, NFR6).

    ``redacted_params`` is only populated when ``status=ALLOWED`` — a denied call has
    no safe parameters to forward, by construction.
    """

    status: GovernanceStatus
    tool_id: str
    correlation_id: str
    reason: DegradationReason | None = None
    detail: str = ""
    redacted_params: dict | None = None

    @property
    def allowed(self) -> bool:
        """True when the tool may be invoked."""
        return self.status is GovernanceStatus.ALLOWED

    def to_degradation(self, fallback_applied: str = "none") -> Degradation | None:
        """Build the client-facing degradation notice for a denied outcome.

        Returns ``None`` for an allowed outcome — there is nothing to tell the user.
        """
        if self.allowed:
            return None
        return Degradation(
            tool_id=self.tool_id,
            reason=self.reason or DegradationReason.DENIED,
            fallback_applied=fallback_applied,
            message=self.detail or "This tool is temporarily unavailable.",
        )
