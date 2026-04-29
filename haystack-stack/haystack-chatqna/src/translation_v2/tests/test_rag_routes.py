"""Integration tests for /api/v2/agent/pdf-* endpoints."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from translation_v2.api.bootstrap import (
    reset_rag_singletons,
    set_hybrid_retriever_for_testing,
    set_ingest_pipeline_for_testing,
    set_pdf_query_pipeline_for_testing,
    set_vector_store_for_testing,
)
from translation_v2.api.rag_routes import router as rag_router


class StubIngestPipeline:
    async def ingest_pdf(self, path, doc_id=None):
        return {
            "doc_id": doc_id or "stub",
            "pages": 2,
            "scanned_pages": 0,
            "chunks": 5,
            "indexed": 5,
        }


class StubPDFQueryPipeline:
    async def answer(self, question, target="ma", k=5, strategy=None, retry_on_qe_fail=True):
        return {
            "answer": "stub answer",
            "strategy": "answer_then_translate",
            "target": target,
            "retried": False,
            "citations": [
                {"doc_id": "D1", "page": 1, "score": 0.9, "excerpt": "ctx"}
            ],
            "qe": {
                "score": 0.8,
                "metric": "test",
                "passed": True,
                "threshold": 0.5,
                "notes": None,
            },
        }


class StubRetriever:
    def index_corpus(self, chunks):
        pass


class StubVectorStore:
    def all_chunks(self):
        return []


@pytest.fixture
def app_with_rag():
    app = FastAPI()
    app.include_router(rag_router, prefix="/api/v2")
    return app


@pytest.fixture
def client(app_with_rag):
    return TestClient(app_with_rag)


@pytest.fixture(autouse=True)
def reset_singletons():
    reset_rag_singletons()
    yield
    reset_rag_singletons()


@pytest.fixture
def wire_stubs(tmp_path):
    set_vector_store_for_testing(StubVectorStore())
    set_hybrid_retriever_for_testing(StubRetriever())
    set_ingest_pipeline_for_testing(StubIngestPipeline())
    set_pdf_query_pipeline_for_testing(StubPDFQueryPipeline())


class TestRAGFlagGate:
    def test_ingest_disabled_returns_503(self, client, monkeypatch, wire_stubs, tmp_path):
        monkeypatch.setattr("translation_v2.flags.USE_V2_RAG", False)
        fake_pdf = tmp_path / "x.pdf"
        fake_pdf.write_bytes(b"%PDF-1.4\n")
        r = client.post(
            "/api/v2/agent/pdf/ingest",
            json={"path": str(fake_pdf)},
        )
        assert r.status_code == 503

    def test_query_disabled_returns_503(self, client, monkeypatch, wire_stubs):
        monkeypatch.setattr("translation_v2.flags.USE_V2_RAG", False)
        r = client.post(
            "/api/v2/agent/pdf-query",
            json={"question": "what?", "target": "ma"},
        )
        assert r.status_code == 503

    def test_header_bypass(self, client, monkeypatch, wire_stubs):
        monkeypatch.setattr("translation_v2.flags.USE_V2_RAG", False)
        r = client.post(
            "/api/v2/agent/pdf-query",
            json={"question": "what?", "target": "ma"},
            headers={"X-Translation-Pipeline": "v2"},
        )
        assert r.status_code == 200


class TestIngest:
    def test_nonexistent_path_returns_404(self, client, monkeypatch, wire_stubs):
        monkeypatch.setattr("translation_v2.flags.USE_V2_RAG", True)
        r = client.post(
            "/api/v2/agent/pdf/ingest",
            json={"path": "/definitely/not/a/real/path.pdf"},
        )
        assert r.status_code == 404

    def test_directory_path_returns_400(self, client, monkeypatch, wire_stubs, tmp_path):
        monkeypatch.setattr("translation_v2.flags.USE_V2_RAG", True)
        r = client.post(
            "/api/v2/agent/pdf/ingest",
            json={"path": str(tmp_path)},  # tmp_path is a directory
        )
        assert r.status_code == 400

    def test_happy_path_returns_summary(self, client, monkeypatch, wire_stubs, tmp_path):
        monkeypatch.setattr("translation_v2.flags.USE_V2_RAG", True)
        fake_pdf = tmp_path / "x.pdf"
        fake_pdf.write_bytes(b"%PDF-1.4\n")
        r = client.post(
            "/api/v2/agent/pdf/ingest",
            json={"path": str(fake_pdf), "doc_id": "my-doc"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["doc_id"] == "my-doc"
        assert body["pages"] == 2


class TestQuery:
    def test_query_returns_answer_and_citations(self, client, monkeypatch, wire_stubs):
        monkeypatch.setattr("translation_v2.flags.USE_V2_RAG", True)
        r = client.post(
            "/api/v2/agent/pdf-query",
            json={"question": "what is metformin for?", "target": "ma", "k": 3},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["answer"] == "stub answer"
        assert body["target"] == "ma"
        assert body["qe"]["passed"] is True
        assert len(body["citations"]) >= 1

    def test_bad_request_422(self, client, monkeypatch, wire_stubs):
        monkeypatch.setattr("translation_v2.flags.USE_V2_RAG", True)
        r = client.post(
            "/api/v2/agent/pdf-query",
            json={"target": "ma"},  # missing question
        )
        assert r.status_code == 422

    def test_pipeline_failure_returns_502(self, client, monkeypatch):
        monkeypatch.setattr("translation_v2.flags.USE_V2_RAG", True)

        class ExplodingPipeline:
            async def answer(self, *a, **kw):
                raise RuntimeError("generator down")

        set_pdf_query_pipeline_for_testing(ExplodingPipeline())
        r = client.post(
            "/api/v2/agent/pdf-query",
            json={"question": "q"},
        )
        assert r.status_code == 502
        assert "pdf-query failed" in r.json()["detail"]
