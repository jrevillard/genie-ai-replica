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
