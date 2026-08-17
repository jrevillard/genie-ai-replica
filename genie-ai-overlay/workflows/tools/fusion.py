# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""Result Fusion Engine for Server-Side Tools (FR19, FR20, FR24).

Merges results from the ArangoDB RAG Retriever with Tool results (e.g., Web Search).
Enforces context-window budgets and normalizes citation formats.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)


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
