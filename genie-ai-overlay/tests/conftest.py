# Copyright (c) 2024-2026 International Telecommunication Union (ITU)

import os
import sys
from enum import Enum

os.makedirs("reports", exist_ok=True)
from pathlib import Path
from unittest.mock import MagicMock, patch

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


# ---------------------------------------------------------------------------
# align_inputs / align_outputs test harness, shared by the chatqna test
# modules. The real ``ServiceType`` is a comps-mocked attribute, so tests
# patch ``chatqna.genieai_chatqna.ServiceType`` with this real Enum and build
# service nodes whose ``service_type`` is one of its values.
# ---------------------------------------------------------------------------
class FakeServiceType(Enum):
    EMBEDDING = "embedding"
    RETRIEVER = "retriever"
    RERANK = "rerank"
    LLM = "llm"


def create_mock_service_node(service_type_value):
    """Create a mock service node with a real service_type attribute."""
    node = MagicMock()
    node.service_type = service_type_value
    return node


@pytest.fixture
def count_patch():
    """Factory: point ``_count_tokens`` at a mock tokenizer's ``.encode``."""

    def _patch(tokenizer):
        import chatqna.genieai_chatqna as _chatqna_module

        _chatqna_module._count_static_tokens.cache_clear()
        return patch(
            "chatqna.genieai_chatqna._count_tokens",
            side_effect=lambda text: len(tokenizer.encode(text)),
        )

    return _patch


# --- Tracing test support -----------------------------------------------------
# Assertions read FINISHED spans out of an in-memory exporter, never mock span
# objects. A mock assertion passes regardless of what the SDK does, and this
# repo has the counter-example: tests/otel-collector/run-pii-smoke.sh passed
# against a completely broken redactor because it asserted on the wrong surface.
#
# Installed in pytest_configure, NOT on first fixture use: set_tracer_provider is
# once-per-process, and test_dataprep_tracing.py / test_reranker_tracing.py call
# the real tracing.setup_tracing(), which installs a provider of their own. First
# caller wins, so ours has to be first — otherwise a CI shard or a -k filter
# silently yields zero spans.
from opentelemetry import trace as _otel_trace
from opentelemetry.sdk.trace import TracerProvider as _SdkTracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor as _SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter as _InMemorySpanExporter,
)

# ``metrics`` re-exports ``sanitize_attributes`` from ``tracing``; the bare
# MagicMock installed above does not, so the name resolves to a callable that
# RETURNS a MagicMock. The OTel SDK cannot tell that from a scalar value: it
# runs the return through its attribute-value cleaner, which stringifies it,
# then calls ``.items()`` on the string and raises. Reachable only once a real
# TracerProvider is installed — a NonRecordingSpan ignores set_attributes
# entirely — so the mock could lie about its contract for as long as the suite
# had no real provider. Use the real function rather than a hand-written
# stand-in: chatqna tests rely on the PII key filtering actually happening.
import tracing  # noqa: E402  (after the sys.modules mocks, as above)
from core.span_attrs import free_text_violations

sys.modules["metrics"].sanitize_attributes = tracing.sanitize_attributes

_SPAN_EXPORTER = _InMemorySpanExporter()


def pytest_configure(config):
    provider = _SdkTracerProvider()
    provider.add_span_processor(_SimpleSpanProcessor(_SPAN_EXPORTER))
    _otel_trace.set_tracer_provider(provider)
    installed = _otel_trace.get_tracer_provider()
    if installed is not provider:
        raise RuntimeError(
            "Tracing tests cannot run: another TracerProvider was installed "
            f"first ({type(installed).__name__}). The in-memory exporter would "
            "receive no spans and every captured_spans() assertion would fail."
        )


def pytest_unconfigure(config):
    _SPAN_EXPORTER.clear()


# Spans whose attributes the vocabulary sweep polices.
#
# COVERS every span this project opens with an explicit name, across chatqna,
# retriever, reranker and dataprep. The list is not a judgement about
# importance — it is "everything", and
# ``TestOwnedSpanCoverage::test_every_emitted_span_is_swept`` re-derives it from
# the sources so a span added tomorrow fails CI instead of starting unswept.
#
# ONE SOURCE OF SPANS IS NOT OURS and is excluded:
#   * FastAPI auto-instrumentation (``http.method`` / ``url.full`` /
#     ``http.status_code`` …). Legitimately outside our vocabulary; sweeping them
#     would mean suppressing failures we do not understand.
#
# Nothing else is excluded by name. The derivation reads span openers out of the
# AST, so a name that appears only in a docstring — ``service.operation``, the
# usage example in ``tracing.with_span`` — is not a span and needs no exclusion;
# an earlier text-matching derivation read it as one and needed a hand-written
# exemption list to keep it out. Any further exclusion added here is a claim that
# a real emitted span is safe to leave unguarded, and must be justified on those
# terms.
#
# Dataprep was swept in a follow-up. It is the one service where document content
# is closest to a span: ``dataprep.ingest`` records ``dataprep.file_type`` and
# ``dataprep.file_id`` straight from the upload payload — an externally supplied
# HTTP body, not an internal value — and the ``llm.*`` spans sit one attribute
# away from the chunk text they are labelling.
OWNED_SPAN_NAMES = frozenset(
    {
        "llm.invoke",
        "chatqna.orchestrate",
        "chatqna.count_tokens",
        "chatqna.translation_count_tokens",
        "chatqna.query_condense",
        "chatqna.reranker_selection",
        "chatqna.stream_outcome",
        "retriever.check_health",
        "retriever.hybrid_search",
        "retriever.route",
        "retriever.fanout",
        "retriever.fanout.leg",
        "retriever.initialize_client",
        "retriever.initialize_llm",
        "reranker.rerank",
        "reranker.tei_invoke",
        "dataprep.chunking",
        "dataprep.ensure_vector_index",
        "dataprep.ingest",
        "dataprep.ingest.background",
        "dataprep.initialize_client",
        "dataprep.kill_ingest",
        "dataprep.llm.context_batch",
        "dataprep.llm.context_chunk",
        "dataprep.llm.context_doc",
        "dataprep.llm.label_batch",
        "dataprep.llm.phase",
        "dataprep.llm.label_chunk",
        "dataprep.log_environment_variables",
        "dataprep.recovery",
        "dataprep.retract",
    }
)


def assert_spans_clean(spans, owned_span_names=OWNED_SPAN_NAMES):
    """Raise AssertionError naming every leaking attribute on an owned span.

    Split out from the fixture so a test can prove the sweep bites: an
    autouse-fixture failure cannot be asserted from inside the test it fails.
    """
    leaks = []
    for span in spans:
        if span.name not in owned_span_names:
            continue
        violations = free_text_violations(dict(span.attributes))
        if violations:
            leaks.append(f"{span.name}: {violations}")
    if leaks:
        raise AssertionError(
            f"Span attribute leak on an owned span (no collector-side redaction on the traces pipeline): {leaks}"
        )


@pytest.fixture(autouse=True)
def sweep_owned_spans():
    """Fail any test whose spans carry undeclared attributes or prose values.

    Enforcement has to be automatic: the vocabulary is only as strong as the
    habit of checking it, and ``tracing.with_span`` cannot do that check (it
    sees only the attributes passed at construction, while emission sites call
    ``span.set_attribute()`` afterwards). Sweeping the exported spans is the one
    place that sees the final state of every attribute.
    """
    _SPAN_EXPORTER.clear()
    yield
    try:
        assert_spans_clean(_SPAN_EXPORTER.get_finished_spans())
    finally:
        _SPAN_EXPORTER.clear()


@pytest.fixture
def owned_span_names():
    """Expose OWNED_SPAN_NAMES so a test can assert the mirror has not drifted."""
    return OWNED_SPAN_NAMES


# ---------------------------------------------------------------------------
# One answer to "what is overlay source?", shared by the two guards that need it.
#
# Both the span-coverage derivation (test_span_attrs) and the core-import pin
# (test_image_ships_imported_core_modules) ask the same question and must not
# answer it differently: a span opened in a directory the span derivation skips
# but the import pin walks would be unguarded while the pin still reported
# clean.
#
# Recursive, and pruned in place. ``Path.rglob`` cannot skip a directory it has
# already descended into, and CI creates ``.venv`` at the overlay root and
# caches it — so an unpruned walk visits every site-packages file before a
# filter can throw it away.
OVERLAY_ROOT = Path(__file__).resolve().parent.parent

OVERLAY_SKIP_DIRS = frozenset(
    {"tests", "contracts", "reports", ".ruff_cache", "__pycache__", ".git", "build-patches", "site"}
)

# Virtualenvs are pruned by PREFIX, not by exact name: CI creates ``.venv`` at
# the overlay root, and a local checkout may carry a sibling (``.venv-linux``
# for a cross-platform venv, ``.venv-py312`` for a pinned interpreter). An
# exact-name list prunes one of them and walks the other — and site-packages
# holds third-party source the AST sweepers must never parse (numpy ships
# PEP-695 syntax that a 3.11 interpreter cannot even read).
_VENV_DIR_PREFIX = ".venv"


def _is_skipped_dir(name: str) -> bool:
    """True for a directory the overlay walk must not descend into."""
    return name in OVERLAY_SKIP_DIRS or name.startswith(_VENV_DIR_PREFIX)


def overlay_source_files() -> list[Path]:
    """Every Python file under the overlay that is project source, recursively."""
    found: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(OVERLAY_ROOT):
        dirnames[:] = [d for d in dirnames if not _is_skipped_dir(d)]
        for name in sorted(filenames):
            if name.endswith(".py"):
                found.append(Path(dirpath, name))
    return sorted(found)


@pytest.fixture
def overlay_sources():
    """Expose :func:`overlay_source_files` to both guards, so they cannot drift."""
    return overlay_source_files()


@pytest.fixture
def span_sweep():
    """Expose ``assert_spans_clean`` so tests can prove the sweep bites."""
    return assert_spans_clean


@pytest.fixture
def span_exporter():
    """Expose the in-memory exporter to a test that emits a leak ON PURPOSE.

    Requesting this fixture is itself the signal that the test leaks
    deliberately, so it clears the exporter on the way out — unconditionally,
    including when the test failed. Clearing on the success path only, as a
    trailing ``span_exporter.clear()`` in the body does, leaves the leak in place
    exactly when the test broke, and the autouse sweep then reports it a second
    time: two failures where there is one, the second one about a span the
    reader has already been looking at.

    The cleanup is therefore a teardown, not a line the caller has to remember.
    """
    yield _SPAN_EXPORTER
    _SPAN_EXPORTER.clear()


@pytest.fixture
def captured_spans():
    """Return a callable giving finished spans, optionally filtered by name.

    Clears on SETUP only. A teardown clear here would empty the exporter before
    ``sweep_owned_spans`` reads it: autouse fixtures are set up first and torn
    down last, so this fixture's teardown runs FIRST and the sweep would see an
    empty exporter and pass silently on every test that requests this one --
    which is most tests that emit an owned span. The sweep clears at setup and
    in its own ``finally``, so it owns the exporter's boundaries.
    """
    _SPAN_EXPORTER.clear()

    def _get(name=None):
        spans = _SPAN_EXPORTER.get_finished_spans()
        if name is not None:
            spans = [s for s in spans if s.name == name]
        return spans

    return _get


@pytest.fixture(autouse=True)
def discovered_llm_model():
    """CI stands in for the vLLM model-id probe: both chatqna seams answer
    with a stable synthetic id — the loud ``require_model_id`` (payload
    sites) and the soft ``get_model_id`` (telemetry) — mirroring a reachable
    vLLM in production (probe failure there fails the request loudly at the
    payload sites — covered at the core and transport level in
    test_auto_detect_model.py, which overrides this fixture)."""
    with (
        patch("chatqna.genieai_chatqna.resolve_model_id", return_value="ci-discovered/model"),
        # chatqna binds get_model_id via from-import (telemetry seam), so only
        # a chatqna-name patch reaches it; dataprep/retriever reach the CORE
        # global through their own from-imports — both names are live.
        patch("chatqna.genieai_chatqna.get_model_id", return_value="ci-discovered/model"),
        patch("chatqna.genieai_chatqna.discover_model_id", return_value="ci-discovered/model"),
        patch("core.model_cache.get_model_id", return_value="ci-discovered/model"),
    ):
        yield
