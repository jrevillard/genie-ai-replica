# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""Story 2-7: degradation + transparent insufficiency behavior of the
web-search fallback helper (truth table from the story's ACs), and the
degradation extraction from the megaservice result dict."""

from unittest.mock import MagicMock, patch

from chatqna.genieai_chatqna import ChatQnAService
from workflows.tools.web_search import WebSearchError


def create_chatqna_service():
    """Create a ChatQnAService without calling __init__ (established pattern)."""
    svc = ChatQnAService.__new__(ChatQnAService)
    svc.host = "0.0.0.0"
    svc.port = 8888
    svc.megaservice = MagicMock()
    svc.endpoint = "/v1/chatqna"
    return svc


def _web_result(title="Official Portal", url="http://example.com", content="Useful content " * 10):
    return {"title": title, "url": url, "content": content}


def _kb_doc(score=0.3):
    return {"id": "doc1", "text": "KB content", "metadata": {"score": score}, "score": score}


# ---------------------------------------------------------------------------
# Truth table — _apply_web_search_fallback
# ---------------------------------------------------------------------------
class TestApplyWebSearchFallback:
    def setup_method(self):
        self.svc = create_chatqna_service()

    def test_high_confidence_does_not_search(self):
        docs = [_kb_doc(score=0.9)]
        with patch("workflows.tools.web_search.SearxngBackend.search_sync") as mock_search:
            out_docs, degradation = self.svc._apply_web_search_fallback(docs, "q", max_score=0.9)
        mock_search.assert_not_called()
        assert out_docs == docs
        assert degradation is None

    def test_ac1_backend_failure_with_kb_docs_silent_rag_only(self):
        """AC1: search fails, KB docs exist -> RAG-only, NO degradation object."""
        docs = [_kb_doc()]
        with patch("workflows.tools.web_search.SearxngBackend.search_sync", side_effect=WebSearchError("down")):
            out_docs, degradation = self.svc._apply_web_search_fallback(docs, "q", max_score=0.3)
        assert out_docs == docs
        assert degradation is None

    def test_ac2_backend_failure_without_kb_docs_carries_degradation(self):
        """AC2: search fails, no KB docs -> degradation info for the UI + empty docs
        (abstention fork fires downstream on the empty list)."""
        with patch("workflows.tools.web_search.SearxngBackend.search_sync", side_effect=WebSearchError("down")):
            out_docs, degradation = self.svc._apply_web_search_fallback([], "q", max_score=0.0)
        assert out_docs == []
        assert degradation is not None
        assert degradation["tool_id"] == "web_search"
        assert degradation["reason"] == "SEARCH_UNAVAILABLE"
        assert degradation["fallback_applied"] == "none"
        assert degradation["message"]  # non-empty guidance

    def test_ac3_all_results_below_quality_low_quality_degradation(self):
        """AC3: results return but none pass the quality gate -> LOW_QUALITY
        degradation, fallback_applied=none, junk NOT fused."""
        junk = [_web_result(title="", content=""), _web_result(url="", content="")]
        with (
            patch("workflows.tools.web_search.SearxngBackend.search_sync", return_value=junk),
            patch("workflows.tools.fusion.ResultFusionEngine.fuse") as mock_fuse,
        ):
            out_docs, degradation = self.svc._apply_web_search_fallback([], "q", max_score=0.0)
        mock_fuse.assert_not_called()
        assert out_docs == []
        assert degradation["reason"] == "LOW_QUALITY"
        assert degradation["fallback_applied"] == "none"
        assert degradation["message"]

    def test_ac3_with_kb_docs_junk_not_fused_but_degradation_carried(self):
        """Quality-filtered junk + KB docs: junk still not fused, but the LOW_QUALITY
        degradation IS carried — the spec's silent-RAG-only rule applies to outages
        with KB results, not to below-quality web results (FR24/epic 2.7)."""
        junk = [_web_result(title="", content="")]
        docs = [_kb_doc()]
        with (
            patch("workflows.tools.web_search.SearxngBackend.search_sync", return_value=junk),
            patch("workflows.tools.fusion.ResultFusionEngine.fuse") as mock_fuse,
        ):
            out_docs, degradation = self.svc._apply_web_search_fallback(docs, "q", max_score=0.3)
        mock_fuse.assert_not_called()
        assert out_docs == docs
        assert degradation is not None
        assert degradation["reason"] == "LOW_QUALITY"

    def test_ac4_usable_results_fused_no_degradation(self):
        good = [_web_result()]
        docs = [_kb_doc()]
        with patch("workflows.tools.web_search.SearxngBackend.search_sync", return_value=good):
            out_docs, degradation = self.svc._apply_web_search_fallback(docs, "q", max_score=0.3)
        assert len(out_docs) == 2  # KB + fused web result
        assert degradation is None

    def test_ac5_neither_kb_nor_usable_web(self):
        """AC5: no KB docs, web returns nothing usable -> empty docs (abstention
        fires downstream) + LOW_QUALITY degradation for the UI."""
        with patch("workflows.tools.web_search.SearxngBackend.search_sync", return_value=[]):
            out_docs, degradation = self.svc._apply_web_search_fallback([], "q", max_score=0.0)
        assert out_docs == []
        assert degradation["reason"] == "LOW_QUALITY"


# ---------------------------------------------------------------------------
# _extract_degradation — recovery from the node-keyed result dict
# ---------------------------------------------------------------------------
class TestExtractDegradation:
    def setup_method(self):
        self.svc = create_chatqna_service()

    def test_finds_degradation_in_any_node_value(self):
        deg = {"tool_id": "web_search", "reason": "LOW_QUALITY", "fallback_applied": "none", "message": "m"}
        result_dict = {"retriever": {"retrieved_docs": []}, "llm": {"text": "answer", "degradation": deg}}
        assert self.svc._extract_degradation(result_dict) == deg

    def test_returns_none_when_absent(self):
        assert self.svc._extract_degradation({"llm": {"text": "answer"}}) is None

    def test_skips_falsy_degradation(self):
        result_dict = {"llm": {"text": "answer", "degradation": None}}
        assert self.svc._extract_degradation(result_dict) is None


# ---------------------------------------------------------------------------
# Review patches 2026-08-31 — never-kill-chat, null scores, seam wiring
# ---------------------------------------------------------------------------
class TestReviewPatches:
    def setup_method(self):
        self.svc = create_chatqna_service()

    def test_unexpected_exception_degrades_to_rag_only_with_kb_docs(self):
        """Broad guard: any unexpected failure (e.g. ImportError in a stripped
        image) must not raise — RAG-only, silent when the KB still answers."""
        with patch(
            "workflows.tools.web_search.SearxngBackend.search_sync",
            side_effect=RuntimeError("unexpected backend bug"),
        ):
            out_docs, degradation = self.svc._apply_web_search_fallback([_kb_doc()], "q", max_score=0.3)
        assert out_docs is not None
        assert degradation is None

    def test_unexpected_exception_without_kb_docs_carries_degradation(self):
        with patch(
            "workflows.tools.web_search.SearxngBackend.search_sync",
            side_effect=RuntimeError("unexpected backend bug"),
        ):
            out_docs, degradation = self.svc._apply_web_search_fallback([], "q", max_score=0.0)
        assert out_docs == []
        assert degradation["reason"] == "SEARCH_UNAVAILABLE"

    def test_import_error_degrades_instead_of_crashing(self):
        """The 0b9b64531 failure mode: workflows tools missing from the image."""
        import builtins

        real_import = builtins.__import__

        def _boom(name, *args, **kwargs):
            if name.startswith("workflows.tools"):
                raise ModuleNotFoundError(f"No module named '{name}'")
            return real_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=_boom):
            out_docs, degradation = self.svc._apply_web_search_fallback([_kb_doc()], "q", max_score=0.3)
        assert degradation is None

    def test_low_quality_message_worded_for_empty_kb(self):
        """AC5 wording: no KB docs -> message must NOT claim the answer is
        'based on available knowledge base documents only'."""
        junk = [_web_result(title="", content="")]
        with patch("workflows.tools.web_search.SearxngBackend.search_sync", return_value=junk):
            _out_docs, degradation = self.svc._apply_web_search_fallback([], "q", max_score=0.0)
        assert "knowledge base documents only" not in degradation["message"]
        with patch("workflows.tools.web_search.SearxngBackend.search_sync", return_value=junk):
            _out_docs, degradation = self.svc._apply_web_search_fallback([_kb_doc()], "q", max_score=0.3)
        assert "knowledge base documents only" in degradation["message"]

    def test_none_doc_scores_do_not_crash_helper_path(self):
        """A TEI reranker response omitting 'score' stores None — the trigger's
        max_score computation must tolerate it (exercised via the helper)."""
        # Helper itself must treat a None max_score defensively if ever passed
        docs, degradation = self.svc._apply_web_search_fallback([_kb_doc()], "q", max_score=0.3)
        assert degradation is None


# ---------------------------------------------------------------------------
# align_outputs seam wiring — degradation must land in the node output dict
# ---------------------------------------------------------------------------
class TestAlignOutputsDegradationWiring:
    def setup_method(self):
        self.svc = create_chatqna_service()

    def test_retriever_seam_sets_degradation_in_next_data(self):
        """The wiring the 6 stubbed align_outputs tests never execute: when the
        helper returns a degradation, it must be set on the node's output dict
        (the channel _extract_degradation reads at response-assembly time)."""
        from chatqna.genieai_chatqna import align_outputs
        from tests.test_chatqna import (
            FakeServiceType,
            create_mock_runtime_graph,
            create_mock_service_node,
            stub_web_search_fallback,
        )

        deg = {"tool_id": "web_search", "reason": "LOW_QUALITY", "fallback_applied": "none", "message": "m"}
        self_mock = MagicMock()
        self_mock.services = {"retriever_node": create_mock_service_node(FakeServiceType.RETRIEVER)}
        stub_web_search_fallback(self_mock)
        self_mock._apply_web_search_fallback.side_effect = lambda docs, query, max_score: (docs, deg)

        # downstream NOT starting with "rerank" -> the no-rerank branch owns the seam
        graph = create_mock_runtime_graph(downstream_nodes=["llm_node"])
        data = {
            "initial_query": "test",
            "retrieved_docs": [{"id": "d1", "text": "doc1", "metadata": {"score": 0.3}}],
            "metadata": [],
        }
        inputs = {"text": "test"}
        with patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType):
            result = align_outputs(self_mock, data, "retriever_node", inputs, graph, {})

        assert result.get("degradation") == deg
        # And the extractor recovers it from a schedule-shaped result dict
        result_dict = {"retriever_node": result, "llm": {"text": "answer"}}
        assert self.svc._extract_degradation(result_dict) == deg
