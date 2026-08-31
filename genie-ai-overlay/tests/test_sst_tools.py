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
