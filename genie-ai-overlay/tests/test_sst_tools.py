from unittest.mock import MagicMock, patch

from workflows.tools.fusion import FusionBudget, ResultFusionEngine
from workflows.tools.web_search import SearxngBackend, perform_web_search_sync


def test_fusion_engine_budget():
    engine = ResultFusionEngine(FusionBudget(max_total_docs=4, rag_ratio=0.5))
    rag_docs = [{"id": "r1", "text": "RAG 1", "score": 0.9}] * 3
    tool_docs = [{"title": "Tool 1", "url": "http://test", "content": "Tool 1 text"}] * 3

    fused = engine.fuse(rag_docs, tool_docs, "test_tool")

    assert len(fused) == 4
    assert sum(1 for d in fused if d.get("is_tool_result")) == 2
    assert sum(1 for d in fused if not d.get("is_tool_result")) == 2


def test_fusion_engine_overflow():
    engine = ResultFusionEngine(FusionBudget(max_total_docs=4, rag_ratio=0.5))
    rag_docs = [{"id": "r1", "text": "RAG 1", "score": 0.9}] * 1
    tool_docs = [{"title": "Tool 1", "url": "http://test", "content": "Tool 1 text"}] * 3

    fused = engine.fuse(rag_docs, tool_docs, "test_tool")

    assert len(fused) == 4
    assert sum(1 for d in fused if d.get("is_tool_result")) == 3
    assert sum(1 for d in fused if not d.get("is_tool_result")) == 1


@patch("requests.get")
def test_searxng_backend_sync(mock_get):
    mock_response = MagicMock()
    mock_response.json.return_value = {
        "results": [{"title": "Test Result", "url": "http://example.com", "content": "This is a test snippet."}]
    }
    mock_get.return_value = mock_response

    backend = SearxngBackend("http://test")
    results = backend.search_sync("test query", num_results=1)

    assert len(results) == 1
    assert results[0]["title"] == "Test Result"
    assert results[0]["url"] == "http://example.com"
    assert "This is a test snippet" in results[0]["content"]


@patch("requests.get")
def test_perform_web_search_sync(mock_get):
    mock_response = MagicMock()
    mock_response.json.return_value = {
        "results": [{"title": "Test Result", "url": "http://example.com", "content": "This is a test snippet."}]
    }
    mock_get.return_value = mock_response

    res = perform_web_search_sync({"query": "test query"})
    assert "[Source 1]: Test Result" in res
    assert "http://example.com" in res


# ---------------------------------------------------------------------------
# filter_usable_results — FR24 quality gate (story 2-7)
# ---------------------------------------------------------------------------
from workflows.tools.fusion import filter_usable_results


def _res(title="T", url="http://x.test", content="A" * 100):
    return {"title": title, "url": url, "content": content}


def test_filter_usable_results_keeps_good_result():
    good = _res()
    assert filter_usable_results([good], min_content_chars=80) == [good]


def test_filter_usable_results_drops_empty_title_url_and_short_content():
    results = [
        _res(title=""),  # no title
        _res(url=""),  # no url
        _res(content="too short"),  # below threshold
        _res(),  # good
    ]
    kept = filter_usable_results(results, min_content_chars=80)
    assert len(kept) == 1
    assert kept[0]["url"] == "http://x.test"


def test_filter_usable_results_content_strip_counts():
    # whitespace-only padding must not satisfy the length threshold
    results = [_res(content=" " * 200)]
    assert filter_usable_results(results, min_content_chars=80) == []


def test_filter_usable_results_zero_disables_gate(monkeypatch):
    monkeypatch.setenv("WEB_SEARCH_MIN_CONTENT_CHARS", "0")
    junk = _res(title="", url="", content="")
    assert filter_usable_results([junk]) == [junk]


def test_filter_usable_results_env_default(monkeypatch):
    monkeypatch.setenv("WEB_SEARCH_MIN_CONTENT_CHARS", "40")
    assert filter_usable_results([_res(content="A" * 45)]) != []
    assert filter_usable_results([_res(content="A" * 30)]) == []


# ---------------------------------------------------------------------------
# Review patches 2026-08-31 — null fields, script-aware threshold
# ---------------------------------------------------------------------------
def test_filter_usable_results_null_fields_count_as_empty():
    # SearXNG passes JSON null through verbatim — must not crash the gate
    results = [{"title": None, "url": "http://x.test", "content": "A" * 100}, _res()]
    kept = filter_usable_results(results, min_content_chars=80)
    assert len(kept) == 1


def test_filter_usable_results_non_string_fields_count_as_empty():
    results = [{"title": 123, "url": ["u"], "content": 45}]
    assert filter_usable_results(results, min_content_chars=10) == []


def test_filter_usable_results_none_input_returns_empty():
    assert filter_usable_results(None) == []


def test_filter_usable_results_threshold_halved_for_non_latin_scripts():
    # A 40-char CJK snippet is information-dense; the 80-char Latin bar must
    # not drop it as LOW_QUALITY
    cjk = _res(content="官方门户网站提供最新公告与办理指南" * 3)  # 48 chars
    assert len(filter_usable_results([cjk], min_content_chars=80)) == 1
    # The same length in Latin script stays below the full bar
    latin = _res(content="A" * 48)
    assert filter_usable_results([latin], min_content_chars=80) == []


def test_filter_usable_results_latin_not_halved():
    # Accented Latin (é, ü) must not trigger the non-Latin halving
    latin_ext = _res(content="çéàüöß" * 10)  # 60 chars, Latin Extended
    assert filter_usable_results([latin_ext], min_content_chars=80) == []


# ---------------------------------------------------------------------------
# Story 2-4 — trigger engine (FR8/FR9/FR10), ported from c0008225f
# ---------------------------------------------------------------------------
from workflows.tools.fusion import (
    TriggerReason,
    is_time_sensitive,
    should_search,
)


class TestIsTimeSensitive:
    def test_default_patterns_fire(self):
        assert is_time_sensitive("what is the latest deadline?") is True
        assert is_time_sensitive("Is this regulation still valid") is True
        assert is_time_sensitive("current interest rates") is True

    def test_word_boundaries_prevent_substring_fires(self):
        assert is_time_sensitive("contract renewal process") is False  # "new" in "renewal"
        assert is_time_sensitive("as often as needed") is False  # "as of" in "as often"

    def test_plain_query_does_not_fire(self):
        assert is_time_sensitive("how do I register a birth certificate") is False
        assert is_time_sensitive("") is False


class TestShouldSearch:
    def test_none_confidence_fires_low_confidence(self):
        d = should_search(None, "birth certificate")
        assert d.should_search and d.reason == TriggerReason.LOW_CONFIDENCE

    def test_below_threshold_fires(self):
        d = should_search(0.3, "query")
        assert d.should_search and d.reason == TriggerReason.LOW_CONFIDENCE

    def test_time_sensitive_fires_regardless_of_confidence(self):
        d = should_search(0.95, "latest deadlines")
        assert d.should_search and d.reason == TriggerReason.TIME_SENSITIVE

    def test_llm_requested_fires_at_high_confidence(self):
        d = should_search(0.95, "query", llm_requested=True)
        assert d.should_search and d.reason == TriggerReason.LLM_REQUESTED

    def test_time_sensitive_outranks_llm_requested(self):
        d = should_search(0.95, "latest deadlines", llm_requested=True)
        assert d.reason == TriggerReason.TIME_SENSITIVE

    def test_high_confidence_plain_query_not_triggered(self):
        d = should_search(0.9, "birth certificate process")
        assert not d.should_search and d.reason == TriggerReason.NOT_TRIGGERED

    def test_confidence_threshold_env_override(self, monkeypatch):
        monkeypatch.setenv("WEB_SEARCH_CONFIDENCE_THRESHOLD", "0.95")
        d = should_search(0.9, "query")
        assert d.should_search and d.reason == TriggerReason.LOW_CONFIDENCE

    def test_time_patterns_env_override(self, monkeypatch):
        monkeypatch.setenv("WEB_SEARCH_TIME_PATTERNS", "plazo actual, vigente")
        assert is_time_sensitive("cual es el plazo actual") is True
        assert is_time_sensitive("latest deadlines") is False  # defaults replaced


# ---------------------------------------------------------------------------
# Story 2-4 review patches — fail-safe env handling, containment, NaN
# ---------------------------------------------------------------------------
import math

import pytest


@pytest.fixture(autouse=True)
def _clean_web_search_env(monkeypatch):
    """Ambient CI env must not flip default-relying trigger tests."""
    for var in ("WEB_SEARCH_TIME_PATTERNS", "WEB_SEARCH_CONFIDENCE_THRESHOLD", "WEB_SEARCH_ENABLED"):
        monkeypatch.delenv(var, raising=False)


class TestTriggerEnvHardening:
    def test_bad_threshold_falls_back_to_default(self, monkeypatch):
        for bad in ("0,70", "", "abc"):
            monkeypatch.setenv("WEB_SEARCH_CONFIDENCE_THRESHOLD", bad)
            d = should_search(0.5, "plain query")
            assert d.should_search and d.reason == TriggerReason.LOW_CONFIDENCE, bad
            d2 = should_search(0.9, "plain query")
            assert not d2.should_search, bad

    def test_patterns_replace_mode_drops_defaults(self, monkeypatch):
        monkeypatch.setenv("WEB_SEARCH_TIME_PATTERNS", "plazo actual")
        assert is_time_sensitive("cual es el plazo actual") is True
        assert is_time_sensitive("latest deadlines") is False

    def test_patterns_append_mode_keeps_defaults(self, monkeypatch):
        monkeypatch.setenv("WEB_SEARCH_TIME_PATTERNS", "+plazo actual")
        assert is_time_sensitive("cual es el plazo actual") is True
        assert is_time_sensitive("latest deadlines") is True

    def test_comma_only_override_falls_back_to_defaults(self, monkeypatch):
        monkeypatch.setenv("WEB_SEARCH_TIME_PATTERNS", ",,,")
        assert is_time_sensitive("latest deadlines") is True

    def test_non_ascii_pattern_matches_by_containment(self, monkeypatch):
        monkeypatch.setenv("WEB_SEARCH_TIME_PATTERNS", "最新")
        assert is_time_sensitive("政府最新公告") is True

    def test_punctuation_edged_custom_pattern_matches(self, monkeypatch):
        monkeypatch.setenv("WEB_SEARCH_TIME_PATTERNS", "#now")
        assert is_time_sensitive("#now what") is True

    def test_nan_confidence_fires_low_confidence(self):
        d = should_search(math.nan, "plain query")
        assert d.should_search and d.reason == TriggerReason.LOW_CONFIDENCE

    def test_llm_requested_outranks_low_confidence(self):
        d = should_search(0.3, "plain query", llm_requested=True)
        assert d.reason == TriggerReason.LLM_REQUESTED
