# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
#
# The query encoder's endpoint (MR !968 review: "only two embedding
# consumers move to vLLM — the query encoder stays on the CPU TEI").
#
# chatqna's RAG graph encodes the query through its `embedding` node. That
# node used to point at the OPEA `embedding` microservice, which fronts the
# CPU TEI container — so on the ROCm venue the GPU embedder served ingestion
# only, and every chat query was encoded by the CPU image the sizing file
# caps at 8 TEI workers.
#
# EMBEDDING_VLLM_ENDPOINT names the BASE URL of an OpenAI-compatible
# embeddings endpoint — the same variable the retriever's and dataprep's
# vLLM branch read, and the same base URL their client turns into
# {base}/v1/embeddings. When it is set, chatqna derives the node's
# host/port/protocol/endpoint from it and posts the same OpenAI-shaped body
# the pooling instance serves. When it is NOT set (the NVIDIA path), the
# node keeps the base compose's microservice, byte-identically.
#
# These tests pin both halves: the derivation, and the NVIDIA-inertness.

import importlib
import sys
from unittest.mock import MagicMock, patch

import pytest


def _reload(monkeypatch, **env):
    """Reload the chatqna module with `env` applied (module-level reads)."""
    for var in (
        "EMBEDDING_VLLM_ENDPOINT",
        "EMBEDDING_SERVER_HOST_IP",
        "EMBEDDING_SERVER_PORT",
        "EMBEDDING_SERVER_ENDPOINT",
        "VLLM_LLM_ENDPOINT",
        "VLLM_TRANSLATION_ENDPOINT",
        "VLLM_API_KEY",
    ):
        monkeypatch.delenv(var, raising=False)
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    return importlib.reload(sys.modules["chatqna.genieai_chatqna"])


@pytest.fixture(autouse=True)
def _restore_module():
    """Never leak a mutated module state into later-collected test files."""
    yield
    importlib.reload(sys.modules["chatqna.genieai_chatqna"])


class TestEmbeddingEndpointDerivation:
    """EMBEDDING_VLLM_ENDPOINT drives the node's host/port/protocol/endpoint."""

    def test_nvidia_path_is_untouched(self, monkeypatch):
        """Unset -> the node keeps the base compose's microservice values.

        This is the NVIDIA deployment: no EMBEDDING_VLLM_ENDPOINT, so the
        derivation must not fire at all (the microservice fronts TEI).
        """
        mod = _reload(
            monkeypatch,
            EMBEDDING_SERVER_HOST_IP="embedding",
            EMBEDDING_SERVER_PORT="6000",
            EMBEDDING_SERVER_ENDPOINT="/v1/embeddings",
        )
        assert mod.EMBEDDING_SERVER_HOST_IP == "embedding"
        assert mod.EMBEDDING_SERVER_PORT == 6000
        assert mod.EMBEDDING_SERVER_PROTOCOL == "http"
        assert mod.EMBEDDING_SERVER_ENDPOINT == "/v1/embeddings"

    def test_in_cluster_gpu_instance(self, monkeypatch):
        """The ROCm single-server venue: the compose-internal instance."""
        mod = _reload(monkeypatch, EMBEDDING_VLLM_ENDPOINT="http://vllm-embedding:8000")
        assert mod.EMBEDDING_SERVER_HOST_IP == "vllm-embedding"
        assert mod.EMBEDDING_SERVER_PORT == 8000
        assert mod.EMBEDDING_SERVER_PROTOCOL == "http"
        # {base}/v1/embeddings — the route the vLLM pooling instance serves,
        # and the same shape the retriever's client posts to.
        assert mod.EMBEDDING_SERVER_ENDPOINT == "/v1/embeddings"

    def test_split_venue_tls_proxy(self, monkeypatch):
        """The split venue: the GPU node's TLS proxy, https and a port."""
        mod = _reload(monkeypatch, EMBEDDING_VLLM_ENDPOINT="https://gpu.example.org:444")
        assert mod.EMBEDDING_SERVER_HOST_IP == "gpu.example.org"
        assert mod.EMBEDDING_SERVER_PORT == 444
        assert mod.EMBEDDING_SERVER_PROTOCOL == "https"
        assert mod.EMBEDDING_SERVER_ENDPOINT == "/v1/embeddings"

    def test_base_url_with_a_path_prefix(self, monkeypatch):
        """A base URL that carries a path keeps it in front of the route.

        The client (the retriever's) appends /v1 to the SAME base URL, so
        the node's endpoint must be the prefix + the route — otherwise the
        two consumers would post to different URLs for the same model.
        """
        mod = _reload(monkeypatch, EMBEDDING_VLLM_ENDPOINT="https://gpu.example.org:444/embeddings")
        assert mod.EMBEDDING_SERVER_ENDPOINT == "/embeddings/v1/embeddings"

    def test_scheme_default_port(self, monkeypatch):
        """No explicit port -> 80 for http, 443 for https."""
        mod = _reload(monkeypatch, EMBEDDING_VLLM_ENDPOINT="http://vllm-embedding")
        assert mod.EMBEDDING_SERVER_PORT == 80
        mod = _reload(monkeypatch, EMBEDDING_VLLM_ENDPOINT="https://gpu.example.org")
        assert mod.EMBEDDING_SERVER_PORT == 443


class TestGpuNodeBearer:
    """The node's proxy rejects a request without a matching bearer."""

    def test_no_bearer_without_a_remote_endpoint(self, monkeypatch):
        """The in-cluster path sends no Authorization header (as before)."""
        mod = _reload(monkeypatch, VLLM_API_KEY="secret-key")
        assert mod._GPU_NODE_API_KEY is None

    def test_bearer_with_a_remote_endpoint(self, monkeypatch):
        """A configured remote endpoint -> the deployment key rides along."""
        mod = _reload(
            monkeypatch,
            EMBEDDING_VLLM_ENDPOINT="https://gpu.example.org:444",
            VLLM_API_KEY="secret-key",
        )
        assert mod._GPU_NODE_API_KEY == "secret-key"

    def test_bearer_from_the_llm_endpoint_alone(self, monkeypatch):
        """The LLM node talks to the same proxy -> the same bearer."""
        mod = _reload(monkeypatch, VLLM_LLM_ENDPOINT="https://gpu.example.org:444/llm", VLLM_API_KEY="k")
        assert mod._GPU_NODE_API_KEY == "k"


class TestGraphNodeWiring:
    """The graph's embedding node is built from the derived values."""

    def test_embedding_node_carries_the_derived_endpoint(self, monkeypatch):
        _reload(monkeypatch, EMBEDDING_VLLM_ENDPOINT="https://gpu.example.org:444", VLLM_API_KEY="k")
        with (
            patch("chatqna.genieai_chatqna.ServiceOrchestrator") as mock_orch,
            patch("chatqna.genieai_chatqna.MicroService") as mock_ms,
        ):
            mock_orch_instance = MagicMock()
            mock_orch_instance.add.return_value = mock_orch_instance
            mock_orch.return_value = mock_orch_instance

            from chatqna.genieai_chatqna import ChatQnAService

            ChatQnAService().add_remote_service()

            add_kwargs = [call[1] for call in mock_ms.call_args_list if call[1]]
            embedding = next(k for k in add_kwargs if k.get("name") == "embedding")
            assert embedding["host"] == "gpu.example.org"
            assert embedding["port"] == 444
            assert embedding["protocol"] == "https"
            assert embedding["endpoint"] == "/v1/embeddings"
            assert embedding["api_key"] == "k"
