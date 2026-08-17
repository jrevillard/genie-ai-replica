# Copyright (C) 2026 ITU
# SPDX-License-Identifier: Apache-2.0
"""Search triggers, result fusion, and context budgeting.

Covers FR8-FR10 (when to search), FR19 (merge/score/dedupe), FR20 (context-window
budget), FR23 (transparent insufficiency), and FR24 (quality threshold).

The design constraint that shapes this module: **web search must never make the answer
worse.** NFR12 forbids fabricating around a tool failure, so every path here either
contributes real cited content or degrades visibly. A result that cannot be cited is
dropped rather than padded into the prompt.
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass
from urllib.parse import urlparse

from tools.schemas import CitationSourceType, ToolResult

logger = logging.getLogger(__name__)

# FR8 — default low-confidence threshold. Below this, retrieval is treated as too weak
# to answer alone and the query is routed to web search.
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


def _time_patterns() -> tuple[str, ...]:
    """Time-sensitive patterns, with the env override applied."""
    override = os.getenv("WEB_SEARCH_TIME_PATTERNS", "").strip()
    if override:
        return tuple(p.strip().lower() for p in override.split(",") if p.strip())
    return _DEFAULT_TIME_PATTERNS


def is_time_sensitive(query: str) -> bool:
    """True when *query* contains a time-sensitive pattern (FR9).

    Matched on word boundaries so "new" does not fire on "renewal" and "as of" does
    not fire inside "as often". Multi-word patterns are matched as phrases.
    """
    if not query:
        return False
    lowered = query.lower()
    return any(re.search(rf"\b{re.escape(pattern)}\b", lowered) for pattern in _time_patterns())


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
        threshold = float(os.getenv("WEB_SEARCH_CONFIDENCE_THRESHOLD", DEFAULT_CONFIDENCE_THRESHOLD))
    if retrieval_confidence is None or retrieval_confidence < threshold:
        return TriggerDecision(True, TriggerReason.LOW_CONFIDENCE)

    return TriggerDecision(False, TriggerReason.NOT_TRIGGERED)


def _normalize_url(url: str) -> str:
    """Canonical form for dedupe: host + path, lowercased, no scheme/query/fragment.

    Drops ``www.`` and a trailing slash so ``https://www.x.gov/a/`` and
    ``http://x.gov/a`` collapse to one citation. Query strings are dropped because
    search engines routinely append tracking parameters to the same document.
    """
    try:
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower().removeprefix("www.")
        path = parsed.path.rstrip("/").lower()
        return f"{host}{path}"
    except Exception:
        return url.lower()


def _shingles(text: str, size: int = 5) -> set[str]:
    """Word shingles for near-duplicate detection."""
    words = re.findall(r"\w+", text.lower())
    if len(words) < size:
        return {" ".join(words)} if words else set()
    return {" ".join(words[i : i + size]) for i in range(len(words) - size + 1)}


def _is_near_duplicate(candidate: str, seen: list[set[str]], threshold: float = 0.8) -> bool:
    """Jaccard near-duplicate check against already-kept content.

    ponytail: O(n·m) shingle comparison, stdlib only, no MinHash and no vector index.
    Result sets here are ~10-20 items, so exact Jaccard is cheaper than building a
    sketch. Revisit only if the tool result cap grows past a few hundred.
    """
    candidate_shingles = _shingles(candidate)
    if not candidate_shingles:
        return False
    for existing in seen:
        if not existing:
            continue
        overlap = len(candidate_shingles & existing)
        union = len(candidate_shingles | existing)
        if union and overlap / union >= threshold:
            return True
    return False


def apply_quality_threshold(results: list[ToolResult], threshold: float | None = None) -> list[ToolResult]:
    """Drop results scoring below the minimum quality bar (FR24).

    This is the gate behind the canonical "Joseph's Missing Permit" journey: SearXNG
    returns results, none clear the bar, and the system degrades visibly rather than
    answering from weak sources.
    """
    if threshold is None:
        threshold = float(os.getenv("WEB_SEARCH_QUALITY_THRESHOLD", DEFAULT_QUALITY_THRESHOLD))
    return [r for r in results if r.score >= threshold]


def dedupe(results: list[ToolResult]) -> list[ToolResult]:
    """Remove exact-URL and near-duplicate-content results (FR19).

    Input order is treated as preference order: the first occurrence wins, so callers
    should pass higher-scoring results first.
    """
    kept: list[ToolResult] = []
    seen_urls: set[str] = set()
    seen_content: list[set[str]] = []
    for result in results:
        key = _normalize_url(result.url)
        if key in seen_urls:
            continue
        if _is_near_duplicate(result.content, seen_content):
            continue
        seen_urls.add(key)
        seen_content.append(_shingles(result.content))
        kept.append(result)
    return kept


def fuse(
    rag_results: list[ToolResult],
    web_results: list[ToolResult],
    *,
    max_context_chars: int,
    tool_ratio: float | None = None,
    quality_threshold: float | None = None,
) -> tuple[list[ToolResult], list[ToolResult]]:
    """Merge RAG and web results under a context-window budget (FR19, FR20, FR24).

    Args:
        rag_results: Knowledge-base results, already ranked by the retriever.
        web_results: Web results from the search backend.
        max_context_chars: Total character budget for both sets combined.
        tool_ratio: Share of the budget reserved for web results (default 0.40, i.e.
            60% RAG / 40% tools). Overridable via ``WEB_SEARCH_CONTEXT_RATIO``.
        quality_threshold: Minimum score for a web result (FR24).

    Returns:
        ``(kept_rag, kept_web)`` — each trimmed to fit its share, lowest-scoring first
        to be dropped.

    **Unused RAG budget is lent to web results, and vice versa.** A fixed split would
    waste budget whenever one side has little to contribute, which is exactly the
    low-confidence case that triggered the search in the first place.
    """
    if tool_ratio is None:
        tool_ratio = float(os.getenv("WEB_SEARCH_CONTEXT_RATIO", DEFAULT_TOOL_CONTEXT_RATIO))
    tool_ratio = max(0.0, min(1.0, tool_ratio))

    web = dedupe(apply_quality_threshold(web_results, quality_threshold))
    web.sort(key=lambda r: r.score, reverse=True)
    rag = sorted(rag_results, key=lambda r: r.score, reverse=True)

    web_budget = int(max_context_chars * tool_ratio)
    rag_budget = max_context_chars - web_budget

    kept_rag, rag_used = _trim_to_budget(rag, rag_budget)
    # Lend the unspent RAG budget to web results before trimming them.
    kept_web, web_used = _trim_to_budget(web, web_budget + (rag_budget - rag_used))
    # Then lend any unspent web budget back, in case RAG had more to give.
    if web_used < web_budget and len(kept_rag) < len(rag):
        kept_rag, _ = _trim_to_budget(rag, rag_budget + (web_budget - web_used))

    return kept_rag, kept_web


def _trim_to_budget(results: list[ToolResult], budget: int) -> tuple[list[ToolResult], int]:
    """Take results in order until *budget* characters are spent.

    Stops at the first result that does not fit rather than skipping ahead to a smaller
    one, so the kept set stays a prefix of the ranked order — a lower-ranked result
    never displaces a higher-ranked one.
    """
    kept: list[ToolResult] = []
    used = 0
    for result in results:
        cost = len(result.content)
        if used + cost > budget:
            break
        kept.append(result)
        used += cost
    return kept, used


def format_web_context(results: list[ToolResult]) -> str:
    """Render web results for the LLM prompt, with provenance inline (FR19).

    Source and retrieval date are included in the prompt text, not only in the citation
    metadata, so the model can reason about recency and attribute claims — FR19 requires
    the prompt itself carry provenance.
    """
    if not results:
        return ""
    lines = []
    for result in results:
        host = urlparse(result.url).hostname or result.url
        retrieved = result.retrieved_at.date().isoformat()
        lines.append(f"\n[Web Result — {host}, retrieved {retrieved}]: {result.content}")
    return "".join(lines)


INSUFFICIENT_INFORMATION_GUIDANCE = (
    "I don't have current information about this topic. "
    "I recommend contacting the responsible government office directly for authoritative guidance."
)


def has_usable_context(rag_results: list[ToolResult], web_results: list[ToolResult]) -> bool:
    """True when either source can support an answer (FR23).

    Callers use this to decide between answering and returning the transparent
    "insufficient information" response. It exists as a named function because the
    equivalent check in ``genieai_chatqna.py:1296`` currently keys off ``not docs``
    alone, which would abstain even when web search found good results (PRD §10, E6).
    """
    return bool(rag_results) or bool(web_results)


def to_citations(results: list[ToolResult]) -> list[dict]:
    """Project results into client-ready citation dicts (FR21, Decision 10).

    ponytail: web results bypass ``_assemble_source_documents``' ``file_id`` lookup in
    chatqna (which hard-``continue``s on any document missing a file id, silently
    dropping every web result — PRD §10, E6). Callers must merge this list into the
    citation payload *after* that function returns, not feed results through it.
    """
    return [r.to_citation().to_client_dict() for r in results if r.source_type is CitationSourceType.WEB_SEARCH]
