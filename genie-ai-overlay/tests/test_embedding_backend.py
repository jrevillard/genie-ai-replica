# Copyright (C) 2026 ITU
# SPDX-License-Identifier: Apache-2.0
"""Tests for the config-gated embedding backend selector (core/embedding_backend.py).

Contract under test (Task-14 mirror): tei is the default on every platform
and the NVIDIA path must not move; the vllm branch activates only when
EMBEDDING_BACKEND=vllm AND EMBEDDING_VLLM_ENDPOINT is set; an unknown value
falls back to tei with a warning (resolve_reranking_strategy style).
"""

from unittest.mock import patch

import httpx

import core.embedding_backend as eb
from core.model_http_policy import EMBEDDING_TIMEOUT_SECONDS, http_timeout

_VLLM_ENDPOINT = "http://vllm-embedding:8000"
_BGE = "BAAI/bge-large-en-v1.5"


class TestResolveEmbeddingBackend:
    def test_unset_env_resolves_tei(self, monkeypatch):
        monkeypatch.delenv("EMBEDDING_BACKEND", raising=False)
        assert eb.resolve_embedding_backend() == "tei"

    def test_explicit_tei_resolves_tei(self):
        assert eb.resolve_embedding_backend("tei") == "tei"

    def test_vllm_resolves_vllm(self):
        assert eb.resolve_embedding_backend("vllm") == "vllm"

    def test_value_is_normalized_case_and_whitespace(self):
        assert eb.resolve_embedding_backend("  VLLM  ") == "vllm"

    def test_unknown_value_falls_back_to_tei_with_warning(self, caplog):
        with caplog.at_level("WARNING", logger=eb.__name__):
            assert eb.resolve_embedding_backend("bogus") == "tei"
        assert any("not a known backend" in r.getMessage() for r in caplog.records)

    def test_empty_value_resolves_tei(self):
        # Compose delivers `EMBEDDING_BACKEND=` (empty) for the unset case —
        # an empty string must behave exactly like unset.
        assert eb.resolve_embedding_backend("") == "tei"

    def test_module_snapshot_defaults_to_tei(self, monkeypatch):
        """The import-time snapshot a reader of the process env expects."""
        monkeypatch.delenv("EMBEDDING_BACKEND", raising=False)
        assert eb.EMBEDDING_BACKEND == "tei"


class TestEmbeddingsBackendActive:
    def test_default_is_inactive(self, monkeypatch):
        monkeypatch.delenv("EMBEDDING_BACKEND", raising=False)
        monkeypatch.delenv("EMBEDDING_VLLM_ENDPOINT", raising=False)
        assert eb.embeddings_backend_active() is False

    def test_vllm_without_endpoint_is_inactive_and_warns(self, monkeypatch, caplog):
        """Fail-soft: vllm with no endpoint falls back to tei, naming the remedy."""
        monkeypatch.setenv("EMBEDDING_BACKEND", "vllm")
        monkeypatch.delenv("EMBEDDING_VLLM_ENDPOINT", raising=False)
        with caplog.at_level("WARNING", logger=eb.__name__):
            assert eb.embeddings_backend_active() is False
        assert any("EMBEDDING_VLLM_ENDPOINT" in r.getMessage() for r in caplog.records)

    def test_vllm_with_empty_string_endpoint_is_inactive(self, monkeypatch):
        monkeypatch.setenv("EMBEDDING_BACKEND", "vllm")
        monkeypatch.setenv("EMBEDDING_VLLM_ENDPOINT", "   ")
        assert eb.embeddings_backend_active() is False

    def test_vllm_with_endpoint_is_active(self, monkeypatch):
        monkeypatch.setenv("EMBEDDING_BACKEND", "vllm")
        monkeypatch.setenv("EMBEDDING_VLLM_ENDPOINT", _VLLM_ENDPOINT)
        assert eb.embeddings_backend_active() is True

    def test_tei_with_endpoint_is_inactive(self, monkeypatch):
        """A set endpoint without the backend flip must not activate — the
        endpoint alone is not a switch (the NVIDIA default must not move)."""
        monkeypatch.setenv("EMBEDDING_BACKEND", "tei")
        monkeypatch.setenv("EMBEDDING_VLLM_ENDPOINT", _VLLM_ENDPOINT)
        assert eb.embeddings_backend_active() is False

    def test_trailing_slash_endpoint_is_active(self, monkeypatch):
        monkeypatch.setenv("EMBEDDING_BACKEND", "vllm")
        monkeypatch.setenv("EMBEDDING_VLLM_ENDPOINT", f"{_VLLM_ENDPOINT}/")
        assert eb.embeddings_backend_active() is True


class TestBuildVllmEmbeddings:
    """The builder is verified against the kwargs it passes to langchain —
    the contract this repo owns, not the langchain internals."""

    def _build(self, monkeypatch, **env):
        monkeypatch.setenv("EMBEDDING_BACKEND", "vllm")
        monkeypatch.setenv("EMBEDDING_VLLM_ENDPOINT", env.get("endpoint", _VLLM_ENDPOINT))
        if "api_key" in env:
            monkeypatch.setenv("VLLM_API_KEY", env["api_key"])
        else:
            monkeypatch.delenv("VLLM_API_KEY", raising=False)
        if "model" in env:
            monkeypatch.setenv("EMBEDDING_MODEL_ID", env["model"])
        else:
            monkeypatch.delenv("EMBEDDING_MODEL_ID", raising=False)
        with patch("langchain_openai.OpenAIEmbeddings") as mock_cls:
            eb.build_vllm_embeddings(_BGE)
        assert mock_cls.call_count == 1
        return mock_cls.call_args.kwargs

    def test_builds_openai_compatible_client(self, monkeypatch):
        kwargs = self._build(monkeypatch)
        assert kwargs["model"] == _BGE
        assert kwargs["base_url"] == f"{_VLLM_ENDPOINT}/v1"
        # REQUIRED: bge is not tiktoken-tokenizable — the default True path
        # tokenizes with an OpenAI vocabulary and mangles the vectors.
        assert kwargs["check_embedding_ctx_length"] is False

    def test_api_key_env_wins(self, monkeypatch):
        kwargs = self._build(monkeypatch, api_key="sekrit")
        assert kwargs["api_key"] == "sekrit"

    def test_api_key_defaults_to_empty_sentinel(self, monkeypatch):
        kwargs = self._build(monkeypatch)
        assert kwargs["api_key"] == "EMPTY"

    def test_model_id_env_overrides_default(self, monkeypatch):
        kwargs = self._build(monkeypatch, model="BAAI/bge-m3")
        assert kwargs["model"] == "BAAI/bge-m3"

    def test_timeout_is_the_shared_embedding_budget_with_connect_ceiling(self, monkeypatch):
        kwargs = self._build(monkeypatch)
        # http_timeout, not a bare float: a float replaces the whole
        # httpx.Timeout and silently discards the 5 s connect ceiling.
        assert kwargs["timeout"] == http_timeout(EMBEDDING_TIMEOUT_SECONDS)
        assert isinstance(kwargs["timeout"], httpx.Timeout)

    def test_lazy_import_keeps_module_import_light(self):
        """core.embedding_backend must be importable without langchain_openai
        on sys.path — dataprep imports it on every startup, and its image
        does not carry the package on the default (tei) path."""
        import ast
        import pathlib

        tree = ast.parse(pathlib.Path(eb.__file__).read_text(encoding="utf-8"))
        module_level_imports = set()
        for node in tree.body:
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                module = getattr(node, "module", None) or ""
                names = [a.name for a in node.names]
                for name in names:
                    module_level_imports.add(module.split(".")[0] if module else name.split(".")[0])
        assert "langchain_openai" not in module_level_imports

    def test_builder_reads_env_per_call(self, monkeypatch):
        """The gate and the builder must agree within one process: both read
        the endpoint from the live env, not a frozen import-time snapshot."""
        monkeypatch.setenv("EMBEDDING_BACKEND", "vllm")
        monkeypatch.setenv("EMBEDDING_VLLM_ENDPOINT", _VLLM_ENDPOINT)
        monkeypatch.delenv("VLLM_API_KEY", raising=False)
        with patch("langchain_openai.OpenAIEmbeddings") as mock_cls:
            eb.build_vllm_embeddings(_BGE)
        assert mock_cls.call_args.kwargs["base_url"] == f"{_VLLM_ENDPOINT}/v1"
        monkeypatch.setenv("EMBEDDING_VLLM_ENDPOINT", "http://other-host:9000")
        with patch("langchain_openai.OpenAIEmbeddings") as mock_cls:
            eb.build_vllm_embeddings(_BGE)
        assert mock_cls.call_args.kwargs["base_url"] == "http://other-host:9000/v1"


class TestResolvedEmbedModel:
    def test_default_model_without_env(self, monkeypatch):
        monkeypatch.delenv("EMBEDDING_MODEL_ID", raising=False)
        assert eb.resolved_embed_model(_BGE) == _BGE

    def test_env_wins(self, monkeypatch):
        monkeypatch.setenv("EMBEDDING_MODEL_ID", "BAAI/bge-m3")
        assert eb.resolved_embed_model(_BGE) == "BAAI/bge-m3"

    def test_module_default_matches_rocm_venue_model(self):
        assert eb.VLLM_EMBED_DEFAULT_MODEL == _BGE
