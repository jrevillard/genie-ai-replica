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
# These tests pin the derivation, the NVIDIA-inertness, and the two
# framework contracts the authenticated path depends on:
#
#   * MicroService.endpoint_path() builds {host}{endpoint} for a node that
#     carries an api_key, and {protocol}://{host}:{port}{endpoint} for one
#     that does not — so an authenticated node's host must carry the scheme
#     and the port itself.
#   * the orchestrator reaches that branch through inputs["model"], so the
#     embedding request must carry a model key on the authenticated path.
#
# Both contracts live in the vendored `comps` package (cores/mega/
# micro_service.py and cores/mega/orchestrator.py) — this file is their
# regression pin, because a silent change there breaks the ROCm query
# encoder in a way no local render can show.

import importlib
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest


def _reload(monkeypatch, **env):
    """Reload the chatqna module with `env` applied (module-level reads)."""
    for var in (
        "EMBEDDING_VLLM_ENDPOINT",
        "EMBEDDING_SERVER_HOST_IP",
        "EMBEDDING_SERVER_PORT",
        "EMBEDDING_SERVER_ENDPOINT",
        "EMBEDDING_MODEL_ID",
        "VLLM_EMBEDDING_MODEL_ID",
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

    def test_no_bearer_without_a_gpu_endpoint(self, monkeypatch):
        """Unset endpoint -> no Authorization header, as before.

        The NVIDIA deployment carries VLLM_API_KEY for the GPU node's
        clients (the retriever's, the dataprep's, the RAGAS embedder); the
        framework's own graph nodes never authenticated, and this branch
        does not change that.
        """
        mod = _reload(monkeypatch, VLLM_API_KEY="secret-key")
        assert mod._EMBEDDING_NODE_API_KEY is None

    def test_bearer_with_a_gpu_endpoint(self, monkeypatch):
        """A configured GPU endpoint -> the deployment key rides along."""
        mod = _reload(
            monkeypatch,
            EMBEDDING_VLLM_ENDPOINT="https://gpu.example.org:444",
            VLLM_API_KEY="secret-key",
        )
        assert mod._EMBEDDING_NODE_API_KEY == "secret-key"

    def test_no_bearer_without_a_key(self, monkeypatch):
        """A configured endpoint but no key -> no header (no crash)."""
        mod = _reload(monkeypatch, EMBEDDING_VLLM_ENDPOINT="http://vllm-embedding:8000")
        assert mod._EMBEDDING_NODE_API_KEY is None

    def test_the_llm_endpoint_alone_does_not_arm_a_bearer(self, monkeypatch):
        """The LLM node is unchanged on every path.

        The deployment's GPU-node key authenticates the retriever's and
        dataprep's OWN clients; the framework's LLM node has always called
        the node's /llm route without a bearer. Arming it here would change
        the NVIDIA remote-GPU topology's URL shape — a cross-cutting fix
        that does not belong to this branch.
        """
        mod = _reload(monkeypatch, VLLM_LLM_ENDPOINT="https://gpu.example.org:444/llm", VLLM_API_KEY="k")
        assert mod._EMBEDDING_NODE_API_KEY is None


class TestGraphNodeWiring:
    """The graph's embedding node is built from the derived values."""

    def _embedding_node(self, monkeypatch, **env):
        """Build the graph and return the embedding node's kwargs."""
        _reload(monkeypatch, **env)
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
            return next(k for k in add_kwargs if k.get("name") == "embedding")

    def test_nvidia_node_is_byte_identical(self, monkeypatch):
        """The NVIDIA deployment's node: the microservice, no bearer."""
        node = self._embedding_node(
            monkeypatch,
            EMBEDDING_SERVER_HOST_IP="embedding",
            EMBEDDING_SERVER_PORT="6000",
            EMBEDDING_SERVER_ENDPOINT="/v1/embeddings",
            VLLM_API_KEY="secret-key",
        )
        assert node["host"] == "embedding"
        assert node["port"] == 6000
        assert node["protocol"] == "http"
        assert node["endpoint"] == "/v1/embeddings"
        assert node["api_key"] is None

    def test_gpu_node_carries_the_derived_endpoint(self, monkeypatch):
        """The GPU path: the derived values and the bearer."""
        node = self._embedding_node(
            monkeypatch,
            EMBEDDING_VLLM_ENDPOINT="https://gpu.example.org:444",
            VLLM_API_KEY="k",
        )
        assert node["port"] == 444
        assert node["protocol"] == "https"
        assert node["endpoint"] == "/v1/embeddings"
        assert node["api_key"] == "k"

    def test_the_authenticated_node_hosts_its_own_scheme_and_port(self, monkeypatch):
        """MicroService.endpoint_path drops the protocol and the port.

        With an api_key the framework builds {host}{endpoint}; without one
        it builds {protocol}://{host}:{port}{endpoint}. An authenticated
        node therefore has to carry the scheme and the port in its host —
        otherwise the request goes out as "gpu.example.org/v1/embeddings",
        which is not a URL.
        """
        node = self._embedding_node(
            monkeypatch,
            EMBEDDING_VLLM_ENDPOINT="https://gpu.example.org:444",
            VLLM_API_KEY="k",
        )
        assert node["host"] == "https://gpu.example.org:444"
        # What the framework will actually request.
        assert f"{node['host']}{node['endpoint']}" == "https://gpu.example.org:444/v1/embeddings"

    def test_the_unauthenticated_node_keeps_the_plain_form(self, monkeypatch):
        """The NVIDIA form still composes the same URL it always did."""
        node = self._embedding_node(
            monkeypatch,
            EMBEDDING_SERVER_HOST_IP="embedding",
            EMBEDDING_SERVER_PORT="6000",
            EMBEDDING_SERVER_ENDPOINT="/v1/embeddings",
        )
        composed = f"{node['protocol']}://{node['host']}:{node['port']}{node['endpoint']}"
        assert composed == "http://embedding:6000/v1/embeddings"


class TestEmbeddingRequestCarriesTheModel:
    """The orchestrator reads inputs["model"] on the authenticated path.

    ``endpoint_path(inputs["model"])`` is only reached when the node
    carries an api_key — and the embedding node's inputs have no "model"
    key (align_inputs writes "input"), so the orchestrator would raise a
    KeyError before it called anything. The request carries the model id
    on that path; the NVIDIA request body is untouched.
    """

    def _align(self, mod, inputs):
        """Run align_inputs' EMBEDDING branch against a stub service node."""
        from tests.test_chatqna import FakeServiceType

        fake_self = SimpleNamespace(
            services={"embedding": SimpleNamespace(service_type=FakeServiceType.EMBEDDING)}
        )
        with patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType):
            return mod.align_inputs(fake_self, dict(inputs), "embedding", None, {})

    def test_the_authenticated_request_carries_the_model(self, monkeypatch):
        mod = _reload(
            monkeypatch,
            EMBEDDING_VLLM_ENDPOINT="https://gpu.example.org:444",
            VLLM_API_KEY="k",
            EMBEDDING_MODEL_ID="BAAI/bge-large-en-v1.5",
        )
        out = self._align(mod, {"text": "what is the escalation path?"})
        assert out["model"] == "BAAI/bge-large-en-v1.5"
        # The OpenAI shape's input field still carries the text — with the
        # model's query instruction in front of it (the bge prefix the
        # retriever's leg applies too).
        assert out["input"].endswith("what is the escalation path?")
        assert out["input"].startswith("Represent this sentence for searching relevant passages:")

    def test_the_served_model_name_wins_when_no_override_is_set(self, monkeypatch):
        """The name the instance SERVES is the name the request must send."""
        mod = _reload(
            monkeypatch,
            EMBEDDING_VLLM_ENDPOINT="http://vllm-embedding:8000",
            VLLM_API_KEY="k",
            VLLM_EMBEDDING_MODEL_ID="bge-large-en-v1.5-rocm",
        )
        out = self._align(mod, {"text": "hello"})
        assert out["model"] == "bge-large-en-v1.5-rocm"

    def test_the_nvidia_request_body_is_untouched(self, monkeypatch):
        mod = _reload(
            monkeypatch,
            EMBEDDING_SERVER_HOST_IP="embedding",
            EMBEDDING_SERVER_PORT="6000",
            VLLM_API_KEY="secret-key",
        )
        out = self._align(mod, {"text": "hello"})
        assert "model" not in out
