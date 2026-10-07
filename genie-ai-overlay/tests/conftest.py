# Copyright (c) 2024-2026 International Telecommunication Union (ITU)

import os
import sys

os.makedirs("reports", exist_ok=True)
from unittest.mock import MagicMock

import pytest

# ---------------------------------------------------------------------------
# Pre-populate the vendored ``comps`` module tree so that imports in OPEA
# service modules do not fail at collection time.  The ``comps`` library is
# only available inside the Docker build (vendored + patched) and cannot be
# pip-installed locally.
# ---------------------------------------------------------------------------
_comps_mock = MagicMock()

# Make @OpeaComponentRegistry.register(...) a no-op identity decorator so
# that class definitions are returned unchanged when the module is imported.
_comps_mock.OpeaComponentRegistry.register = lambda *a, **kw: lambda cls: cls
# Make @register_microservice(...) a no-op identity decorator so that
# endpoint functions remain callable in tests (not replaced by MagicMock).
_comps_mock.register_microservice = lambda *a, **kw: lambda f: f
# Make @register_statistics(...) a no-op identity decorator.
_comps_mock.register_statistics = lambda *a, **kw: lambda f: f
# Provide a simple base class for OpeaComponent so __init__ accepts any args.
_comps_mock.OpeaComponent = type("OpeaComponent", (), {"__init__": lambda self, *a, **kw: None})

sys.modules.setdefault("comps", _comps_mock)
sys.modules.setdefault("comps.cores", MagicMock())
sys.modules.setdefault("comps.cores.proto", MagicMock())
sys.modules.setdefault("comps.cores.proto.api_protocol", MagicMock())
sys.modules.setdefault("comps.cores.proto.genieai_api_protocol", MagicMock())
sys.modules.setdefault("comps.cores.proto.docarray", MagicMock())
sys.modules.setdefault("comps.dataprep", MagicMock())
sys.modules.setdefault("comps.dataprep.src", MagicMock())
sys.modules.setdefault("comps.dataprep.src.genieai_dataprep_utils", MagicMock())
sys.modules.setdefault("comps.dataprep.src.integrations", MagicMock())
_arangodb_dp_module = MagicMock()
_arangodb_dp_module.OpeaArangoDataprep = type(
    "OpeaArangoDataprep",
    (),
    {
        "__init__": lambda self, *a, **kw: None,
        "_initialize_llm": lambda self, *a, **kw: None,
    },
)
sys.modules.setdefault("comps.dataprep.src.integrations.arangodb", _arangodb_dp_module)
sys.modules.setdefault("comps.dataprep.src.utils", MagicMock())

# Core import-time dependency — api_protocol is vendored at top level inside Docker.
# Must provide real base classes for models that inherit from them, and types that
# Pydantic can validate.  Using dict for annotation-only types avoids schema errors.
from pydantic import BaseModel as _PydanticBaseModel  # noqa: F401, I001 – needed by OPEA models extending BaseModel at import time

_api_protocol_mock = MagicMock()
_api_protocol_mock.RetrievalRequest = type("RetrievalRequest", (), {"__init__": lambda self, **kw: None})
_api_protocol_mock.RetrievalResponse = type("RetrievalResponse", (), {"__init__": lambda self, **kw: None})
_api_protocol_mock.ArangoDBDataprepRequest = type("ArangoDBDataprepRequest", (), {"__init__": lambda self, **kw: None})
# Types used only in annotations — use dict so Pydantic can handle Union with dict
_api_protocol_mock.ResponseFormat = dict
_api_protocol_mock.StreamOptions = dict
_api_protocol_mock.ChatCompletionToolsParam = dict
_api_protocol_mock.ChatCompletionNamedToolChoiceParam = dict
_api_protocol_mock.RetrievalResponseData = dict
_api_protocol_mock.RerankingResponseData = dict
_api_protocol_mock.EmbeddingResponse = dict
_api_protocol_mock.UploadFile = dict
# Re-export typing names that api_protocol brings in
from typing import Any as _Any, Union as _Union, Literal as _Literal  # noqa: I001 – must come after sys.modules mocks

_api_protocol_mock.Any = _Any
_api_protocol_mock.Union = _Union
_api_protocol_mock.Literal = _Literal
# Make `from api_protocol import *` work by exposing all public names
_api_protocol_mock.__all__ = [
    "RetrievalRequest",
    "RetrievalResponse",
    "ArangoDBDataprepRequest",
    "ResponseFormat",
    "StreamOptions",
    "ChatCompletionToolsParam",
    "ChatCompletionNamedToolChoiceParam",
    "RetrievalResponseData",
    "RerankingResponseData",
    "EmbeddingResponse",
    "UploadFile",
    "Any",
    "Union",
    "Literal",
]
sys.modules.setdefault("api_protocol", _api_protocol_mock)

# Retriever import-time dependencies (langchain, openai, arango)
sys.modules.setdefault("arango", MagicMock())
sys.modules.setdefault("arango.database", MagicMock())
sys.modules.setdefault("langchain_arangodb", MagicMock())
sys.modules.setdefault("langchain_community", MagicMock())
sys.modules.setdefault("langchain_community.embeddings", MagicMock())
sys.modules.setdefault("langchain_huggingface", MagicMock())
sys.modules.setdefault("langchain_openai", MagicMock())
sys.modules.setdefault("openai", MagicMock())

# ChatQnA import-time dependencies
sys.modules.setdefault("genie_ssl_patch", MagicMock())
sys.modules.setdefault("transformers", MagicMock())
sys.modules.setdefault("langdetect", MagicMock())
sys.modules.setdefault("keycloak_token_validator", MagicMock())
sys.modules.setdefault("metrics", MagicMock())

# aiohttp — already mocked above for dataprep; ensure ClientTimeout is available
_aiohttp_mock = sys.modules.get("aiohttp", MagicMock())
_aiohttp_mock.ClientTimeout = MagicMock(return_value=MagicMock())
sys.modules["aiohttp"] = _aiohttp_mock

# Dataprep import-time dependencies
sys.modules.setdefault("aiohttp", _aiohttp_mock)
sys.modules.setdefault("arango.exceptions", MagicMock())
sys.modules.setdefault("langchain_core", MagicMock())
sys.modules.setdefault("langchain_core.documents", MagicMock())
sys.modules.setdefault("langchain_text_splitters", MagicMock())
# numpy is a real (declared) test dependency — used directly by the adaptive
# reranker's cosine_similarity. Do NOT mock it, or real math is untestable.
sys.modules.setdefault("rank_bm25", MagicMock())
sys.modules.setdefault("keycloak_service_account", MagicMock())

# Reranker import-time dependencies
_kneed_mock = MagicMock()
_kneed_mock.KneeLocator = MagicMock()
sys.modules.setdefault("kneed", _kneed_mock)

# OpenTelemetry — only mock exporter and instrumentation packages.
# Core packages (opentelemetry-api, opentelemetry-sdk) are in pyproject.toml test deps.
# The exporter and instrumentation packages are Dockerfile-only.
sys.modules.setdefault("opentelemetry.exporter", MagicMock())
sys.modules.setdefault("opentelemetry.exporter.otlp", MagicMock())
sys.modules.setdefault("opentelemetry.exporter.otlp.proto", MagicMock())
sys.modules.setdefault("opentelemetry.exporter.otlp.proto.http", MagicMock())
sys.modules.setdefault("opentelemetry.exporter.otlp.proto.http.trace_exporter", MagicMock())
sys.modules.setdefault("opentelemetry.exporter.otlp.proto.http.metric_exporter", MagicMock())
sys.modules.setdefault("opentelemetry.instrumentation", MagicMock())
sys.modules.setdefault("opentelemetry.instrumentation.aiohttp_client", MagicMock())
sys.modules.setdefault("opentelemetry.instrumentation.fastapi", MagicMock())
sys.modules.setdefault("opentelemetry.instrumentation.httpx", MagicMock())

_integrations_mock = MagicMock()
_integrations_tei_module = MagicMock()
_integrations_tei_module.OpeaTEIReranking = type("OpeaTEIReranking", (), {"__init__": lambda self, *a, **kw: None})
sys.modules.setdefault("integrations", _integrations_mock)
sys.modules.setdefault("integrations.tei", _integrations_tei_module)

# Reranker microservice telemetry import — opea_telemetry must be a passthrough decorator
sys.modules.setdefault("comps.cores.telemetry", MagicMock())
_opea_telemetry_module = MagicMock()
_opea_telemetry_module.opea_telemetry = lambda f: f
sys.modules.setdefault("comps.cores.telemetry.opea_telemetry", _opea_telemetry_module)

# Reranker microservice component import chain
sys.modules.setdefault("comps.rerankings", MagicMock())
sys.modules.setdefault("comps.rerankings.src", MagicMock())
sys.modules.setdefault("comps.rerankings.src.integrations", MagicMock())
# Register the real reranker integration module under its vendored Docker
# path (the Dockerfile copies reranker/genieai_tei_reranker.py there). The
# microservice imports RerankerInputTooLongError from this path, and a bare
# MagicMock would make `except RerankerInputTooLongError:` a TypeError rather
# than a class match.
import reranker.genieai_tei_reranker as _genieai_tei_reranker  # noqa: E402

sys.modules.setdefault("comps.rerankings.src.integrations.genieai_tei_reranker", _genieai_tei_reranker)

# Dataprep microservice base module import (opea_dataprep_microservice)
_opea_dp_base = MagicMock()
_opea_dp_base.create_upload_folder = MagicMock()
_opea_dp_base.opea_microservices = MagicMock()
sys.modules.setdefault("opea_dataprep_microservice", _opea_dp_base)

# Dataprep loader mock
sys.modules.setdefault("genieai_dataprep_loader", MagicMock())

# Dataprep microservice importlib.import_module("integrations.genieai_dataprep_arangodb")
sys.modules.setdefault("integrations.genieai_dataprep_arangodb", MagicMock())

# genieai_dataprep_utils heavy import-time dependencies (cv2, easyocr, pymupdf, docling)
sys.modules.setdefault("cv2", MagicMock())
sys.modules.setdefault("easyocr", MagicMock())
sys.modules.setdefault("pymupdf", MagicMock())
_docling_mock = MagicMock()
sys.modules.setdefault("docling", _docling_mock)
sys.modules.setdefault("docling.datamodel", MagicMock())
sys.modules.setdefault("docling.datamodel.base_models", MagicMock())
sys.modules.setdefault("docling.datamodel.pipeline_options", MagicMock())
sys.modules.setdefault("docling.document_converter", MagicMock())


# ---------------------------------------------------------------------------
# Autouse fixture — required env vars for every OPEA service
# ---------------------------------------------------------------------------
@pytest.fixture(autouse=True)
def set_env_vars(monkeypatch):
    monkeypatch.setenv("ARANGO_URL", "http://localhost:8529")
    monkeypatch.setenv("ARANGO_DB", "genie")
    monkeypatch.setenv("ARANGO_USER", "root")
    monkeypatch.setenv("ARANGO_PASSWORD", "testpass")
    monkeypatch.setenv("TEI_EMBEDDING_ENDPOINT", "http://localhost:80")
    monkeypatch.setenv("TEI_RERANKING_ENDPOINT", "http://localhost:80")
    monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
    monkeypatch.setenv("LOCAL_EMBEDDING_MODEL", "BAAI/bge-large-en-v1.5")
    monkeypatch.setenv("RETRIEVER_MODEL_ID", "BAAI/bge-large-en-v1.5")
