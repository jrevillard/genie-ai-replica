# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""Result Fusion Engine for Server-Side Tools (FR19, FR20, FR24).

Merges results from the ArangoDB RAG Retriever with Tool results (e.g., Web Search).
Enforces context-window budgets and normalizes citation formats.
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)

#: Default minimum characters of content for a web result to be usable (FR24).
#: Env-overridable via WEB_SEARCH_MIN_CONTENT_CHARS; <= 0 disables the gate.
DEFAULT_MIN_CONTENT_CHARS = 80


def filter_usable_results(
    tool_results: list[dict[str, Any]],
    min_content_chars: int | None = None,
) -> list[dict[str, Any]]:
    """FR24 quality gate: drop tool results below the minimum quality bar.

    A web result is usable when it has a non-empty title AND url AND at least
    ``min_content_chars`` characters of non-whitespace content. Applied before
    fusion so unusable results never enter the LLM context. Null field values
    (SearXNG passes JSON ``null`` through verbatim) count as empty.
    """
    if not tool_results:
        return []
    if min_content_chars is None:
        try:
            min_content_chars = int(os.getenv("WEB_SEARCH_MIN_CONTENT_CHARS", DEFAULT_MIN_CONTENT_CHARS))
        except (TypeError, ValueError):
            min_content_chars = DEFAULT_MIN_CONTENT_CHARS
    if min_content_chars <= 0:
        return list(tool_results)

    usable = []
    for res in tool_results:
        title = _stripped(res, "title")
        url = _stripped(res, "url")
        content = _stripped(res, "content")
        if title and url and len(content) >= _effective_min_chars(content, min_content_chars):
            usable.append(res)

    dropped = len(tool_results) - len(usable)
    if dropped:
        logger.info("FR24 quality gate dropped %d of %d web result(s)", dropped, len(tool_results))
    return usable


def _stripped(res: dict[str, Any], key: str) -> str:
    """Field access that treats explicit JSON nulls (and non-strings) as empty."""
    value = res.get(key)
    return value.strip() if isinstance(value, str) else ""


def _effective_min_chars(content: str, min_chars: int) -> int:
    """Halve the threshold for non-Latin scripts.

    CJK/Arabic/Cyrillic text carries roughly twice the information per code
    point that Latin text does; a fixed character bar calibrated on Latin
    snippets would drop usable results as LOW_QUALITY for those scripts.
    """
    letters = [c for c in content if c.isalpha()]
    if letters and sum(1 for c in letters if ord(c) > 0x24F) > len(letters) // 2:
        return max(1, min_chars // 2)
    return min_chars


# FR8 — default low-confidence threshold. Below this, retrieval is treated as
# too weak to answer alone and web search is triggered.
DEFAULT_CONFIDENCE_THRESHOLD = 0.70

# FR24 — results scoring below this are discarded before entering the LLM context.
DEFAULT_QUALITY_THRESHOLD = 0.30

# FR20 — share of the context window reserved for tool results (the rest is RAG).
DEFAULT_TOOL_CONTEXT_RATIO = 0.40

# FR9 — time-sensitive query patterns.
#
# ponytail: English-only. GENIE serves 14 locales, so a Spanish query asking for the
# *plazo actual* will not fire this trigger and will fall back to the confidence
# trigger alone. Overridable via WEB_SEARCH_TIME_PATTERNS (comma-separated) so a
# deployment can add its locales without a code change. Proper fix is to run the
# trigger after the existing translation step, or to let the LLM-driven path (FR10)
# carry non-English detection — both are larger changes than this trigger warrants.
_DEFAULT_TIME_PATTERNS = (
    "current",
    "latest",
    "today",
    "tomorrow",
    "yesterday",
    "this week",
    "this month",
    "this year",
    "right now",
    "recent",
    "recently",
    "deadline",
    "up to date",
    "as of",
    "new",
    "update",
    "updated",
    "still valid",
)


class TriggerReason(str):
    """Why web search fired — carried into span attributes and the audit record."""

    LOW_CONFIDENCE = "low_confidence"
    TIME_SENSITIVE = "time_sensitive"
    LLM_REQUESTED = "llm_requested"
    NOT_TRIGGERED = "not_triggered"


@dataclass(frozen=True)
class TriggerDecision:
    """The outcome of the should-we-search question."""

    should_search: bool
    reason: str

    def __bool__(self) -> bool:
        return self.should_search


def _isnan(value) -> bool:
    """NaN scores carry no information — treat like None (fire, the unsafe-direction default)."""
    try:
        return value != value  # NaN is the only value != itself; no math import needed
    except Exception:
        return False


def _time_patterns() -> tuple[str, ...]:
    """Time-sensitive patterns, with the env override applied.

    ``WEB_SEARCH_TIME_PATTERNS=a,b,c`` REPLACES the defaults (the removal lever
    for deployments that find a pattern too noisy). Prefixing with ``+``
    (``+a,b,c``) APPENDS to the defaults — the add-my-locales case. A value that
    parses to no patterns at all (e.g. comma-only) falls back to the defaults
    rather than silently disarming the trigger.
    """
    override = os.getenv("WEB_SEARCH_TIME_PATTERNS", "").strip()
    if override:
        append = override.startswith("+")
        custom = tuple(p.strip().lower() for p in override.lstrip("+").split(",") if p.strip())
        if not custom:
            logger.warning("WEB_SEARCH_TIME_PATTERNS=%r parsed to no patterns; using defaults", override)
            return _DEFAULT_TIME_PATTERNS
        if append:
            return _DEFAULT_TIME_PATTERNS + custom
        return custom
    return _DEFAULT_TIME_PATTERNS


def _matches_pattern(query: str, pattern: str) -> bool:
    """Word-boundary match for plain word patterns; containment otherwise.

    ``\b`` boundaries need word/non-word transitions, which do not exist inside
    CJK/Thai contiguous scripts or around punctuation-edged custom patterns
    ("#now") — those use plain containment instead.
    """
    if pattern.isascii() and re.match(r"^\w", pattern) and re.search(r"\w$", pattern):
        return re.search(rf"\b{re.escape(pattern)}\b", query) is not None
    return pattern in query


def is_time_sensitive(query: str) -> bool:
    """True when *query* contains a time-sensitive pattern (FR9).

    Matched on word boundaries so "new" does not fire on "renewal" and "as of" does
    not fire inside "as often". Multi-word patterns are matched as phrases.
    """
    if not query:
        return False
    lowered = query.lower()
    return any(_matches_pattern(lowered, pattern) for pattern in _time_patterns())


def should_search(
    retrieval_confidence: float | None,
    query: str,
    *,
    confidence_threshold: float | None = None,
    llm_requested: bool = False,
) -> TriggerDecision:
    """Decide whether to invoke web search (FR8, FR9, FR10).

    Precedence, highest first:

    1. **Time-sensitive** (FR9) — fires *regardless of retrieval confidence*, because a
       confidently-retrieved but stale document is exactly the failure mode this trigger
       exists to catch. Checked first for that reason.
    2. **LLM-requested** (FR10) — the model judged the knowledge base insufficient.
    3. **Low confidence** (FR8) — retrieval scored below the threshold.

    A missing ``retrieval_confidence`` (``None``) is treated as low confidence: if the
    pipeline could not score its own retrieval, assuming it was good is the unsafe
    direction.

    This function deliberately does **not** consult the tool's enabled/authorized state.
    FR11 requires that a disabled tool cannot fire from either the rule-based or the
    LLM-driven path, and that guarantee is enforced structurally in
    ``governance.GovernancePipeline.guard`` — the single place every call must traverse.
    Duplicating the check here would create a second place for the two to drift apart.
    """
    if is_time_sensitive(query):
        return TriggerDecision(True, TriggerReason.TIME_SENSITIVE)
    if llm_requested:
        return TriggerDecision(True, TriggerReason.LLM_REQUESTED)

    threshold = confidence_threshold
    if threshold is None:
        raw = os.getenv("WEB_SEARCH_CONFIDENCE_THRESHOLD", DEFAULT_CONFIDENCE_THRESHOLD)
        try:
            threshold = float(raw)
        except (TypeError, ValueError):
            # Bad config (typo, locale comma "0,70", empty) must not kill the
            # trigger or masquerade as an engine outage — fall back to default.
            logger.warning(
                "WEB_SEARCH_CONFIDENCE_THRESHOLD=%r is not a float; using default %s",
                raw,
                DEFAULT_CONFIDENCE_THRESHOLD,
            )
            threshold = DEFAULT_CONFIDENCE_THRESHOLD
    if retrieval_confidence is None or _isnan(retrieval_confidence) or retrieval_confidence < threshold:
        return TriggerDecision(True, TriggerReason.LOW_CONFIDENCE)

    return TriggerDecision(False, TriggerReason.NOT_TRIGGERED)


@dataclass
class FusionBudget:
    """Context window budget allocation (FR24)."""

    max_total_docs: int = 5
    rag_ratio: float = 0.6  # 60% RAG, 40% Tools by default


class ResultFusionEngine:
    """Fuses RAG results with Tool results into a unified context window.

    Handles scoring, normalization, and budget constraints.
    """

    def __init__(self, budget: FusionBudget | None = None):
        self._budget = budget or FusionBudget()

    def fuse(
        self,
        rag_docs: list[dict[str, Any]],
        tool_results: list[dict[str, Any]],
        tool_id: str,
    ) -> list[dict[str, Any]]:
        """Merge RAG and Tool results based on the allocated budget.

        Args:
            rag_docs: List of documents from the Retriever/Reranker.
                      Expected format: [{"id": str, "text": str, "score": float, ...}]
            tool_results: List of tool result items.
                          For Web Search: [{"title": str, "url": str, "content": str}]
            tool_id: The ID of the tool that generated the results.

        Returns:
            A fused list of documents formatted for the LLM prompt and citation engine.
        """
        fused = []

        # Calculate budget
        max_rag = int(self._budget.max_total_docs * self._budget.rag_ratio)
        max_tool = self._budget.max_total_docs - max_rag

        # If one source has fewer docs than its budget, give the remainder to the other
        if len(rag_docs) < max_rag:
            max_tool += max_rag - len(rag_docs)
        elif len(tool_results) < max_tool:
            max_rag += max_tool - len(tool_results)

        # 1. Add RAG docs (already ranked by Reranker)
        for doc in rag_docs[:max_rag]:
            # Keep original RAG format so _assemble_source_documents doesn't break
            fused.append(doc)

        # 2. Add Tool docs (normalized to look like RAG docs for the LLM)
        for i, res in enumerate(tool_results[:max_tool]):
            # Create a pseudo-ID so the citation engine can track it
            pseudo_id = f"tool_{tool_id}_{i}"

            # Format text for LLM
            title = res.get("title", "Web Result")
            url = res.get("url", "")
            snippet = res.get("content", "")
            doc_text = f"Title: {title}\nURL: {url}\nContent: {snippet}"

            fused.append(
                {
                    "id": pseudo_id,
                    "text": doc_text,
                    # Give tool results a synthetic high score if we want them to
                    # contribute to confidence, or handle them specially in UI
                    "score": 0.85,
                    "is_tool_result": True,
                    "tool_id": tool_id,
                    "tool_url": url,
                    "tool_title": title,
                }
            )

        return fused
