# Copyright (C) 2025-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""K.3 rag-tuning consumer pins (chatqna + retriever + reranker).

Pins the file-registry contract at the real read sites: the chatqna
per-request resolution (request-explicit > file > coded, the bool parse,
the adaptive-key threading into the retriever request), the retriever's
file-driven knobs (searchMode, filterStrategy, hybrid toggle/weights passed
EXPLICITLY to rrf_fuse, the enable_traversal string-truthiness fix), the
reranker's adaptive params (sigmoid a/b passed explicitly, decay/minValue
steering the selection), the typed-field never-crash guard in all three
modules, and the no-drift law — the committed seed and every module's coded
defaults carry TODAY'S EFFECTIVE values.
"""

import ast
import importlib
import json
import logging
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

import chatqna.genieai_chatqna as chatqna_module
import reranker.genieai_tei_reranker as reranker_module
import retriever.genieai_retriever_arangodb as retriever_module
from chatqna.genieai_chatqna import (
    _RAG_DEFAULTS,
    _resolve_rag_parms,
    _traversal_wire_value,
)
from core import pipeline_settings as ps

REPO_ROOT = Path(__file__).resolve().parents[2]
SEED_PATH = REPO_ROOT / "configs" / "pipeline" / "rag-tuning.seed.json"
ENV_VAR = "RAG_TUNING_CONFIG"

# Every env var the three _RAG_DEFAULTS read at import (the ENV-SEED tier).
# Tests must control them or outer-env leakage breaks the value-identity and
# no-drift pins.
_SEED_ENV_VARS = [
    "RETRIEVER_ARANGO_K",
    "RETRIEVER_ARANGO_FETCH_K",
    "RETRIEVER_ARANGO_SCORE_THRESHOLD",
    "RETRIEVER_ARANGO_LAMBDA_MULT",
    "RETRIEVER_ARANGO_SEARCH_START",
    "RETRIEVER_ARANGO_SEARCH_MODE",
    "RETRIEVER_ARANGO_FILTER_STRATEGY",
    "RETRIEVER_ARANGO_TRAVERSAL_ENABLED",
    "RETRIEVER_ARANGO_TRAVERSAL_MAX_DEPTH",
    "RETRIEVER_ARANGO_TRAVERSAL_MAX_RETURNED",
    "RETRIEVER_ARANGO_TRAVERSAL_SCORE_THRESHOLD",
    "RETRIEVER_ARANGO_TRAVERSAL_CONCURRENT_BATCHES",
    "RETRIEVER_HYBRID_RETRIEVAL_ENABLED",
    "RETRIEVER_HYBRID_RRF_K",
    "RETRIEVER_HYBRID_DENSE_WEIGHT",
    "RETRIEVER_HYBRID_LEXICAL_WEIGHT",
    "RETRIEVER_HYBRID_BM25_CANDIDATES",
    "RERANKING_STRATEGY",
    "RERANKING_THRESHOLD",
    "RERANKER_TOP_N",
    "NOVELTY_SIGMOID_A",
    "NOVELTY_SIGMOID_B",
    "CONTEXT_DECAY_FACTOR",
    "MIN_VALUE_THRESHOLD",
]


@pytest.fixture(autouse=True)
def _isolated_settings(tmp_path, monkeypatch):
    """Each test gets a fresh settings state (no env, cold reader cache,
    reset once-per-state WARN guards in all three consumer modules)."""
    monkeypatch.delenv(ENV_VAR, raising=False)
    for var in _SEED_ENV_VARS:
        monkeypatch.delenv(var, raising=False)
    ps._cache.clear()
    chatqna_module._rag_bad_ref = None
    retriever_module._rag_bad_ref = None
    reranker_module._rag_bad_ref = None
    yield
    ps._cache.clear()


def _write_settings(doc: dict, tmp_path, monkeypatch) -> Path:
    file = tmp_path / "rag-tuning.json"
    file.write_text(json.dumps(doc), encoding="utf-8")
    monkeypatch.setenv(ENV_VAR, str(file))
    return file


def _req(**overrides):
    """Stand-in for ChatCompletionRequest: every retriever/reranker field
    None (unset) unless the test sets it — None falls through to the file."""
    defaults = dict(
        search_type=None,
        k=None,
        fetch_k=None,
        search_start=None,
        enable_traversal=None,
        traversal_max_depth=None,
        traversal_max_returned=None,
        traversal_score_threshold=None,
        distance_threshold=None,
        lambda_mult=None,
        score_threshold=None,
        reranking_strategy=None,
        top_n=None,
        reranking_threshold=None,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


# ---------------------------------------------------------------------------
# No-drift law: the committed seed and ALL THREE module defaults are today's
# effective configuration, and they are value-identical (the K.1 reader cache
# is keyed by path only — divergent defaults would poison each other).
# ---------------------------------------------------------------------------


class TestSeedNoDrift:
    def test_seed_carries_the_effective_compose_values(self):
        seed = json.loads(SEED_PATH.read_text(encoding="utf-8"))
        assert seed["version"] == 1
        assert seed["updatedBy"] == "seed"
        # chatqna-authoritative parms (compose chatqna block, NOT the coded
        # env defaults: k 4, fetch_k 20, score_threshold 0.1, traversal off)
        assert seed["retriever"]["retrievalK"] == 20
        assert seed["retriever"]["fetchK"] == 30
        assert seed["retriever"]["scoreThreshold"] == 0.2
        assert seed["retriever"]["lambdaMult"] == 0.5
        assert seed["retriever"]["searchStart"] == "chunk"
        assert seed["retriever"]["enableTraversal"] is True
        assert seed["retriever"]["traversalMaxDepth"] == 2
        assert seed["retriever"]["traversalMaxReturned"] == 5
        assert seed["retriever"]["traversalScoreThreshold"] == 0.7
        # retriever-owned knobs (its env block; concurrentBatches = the hard
        # cap 4 — compose said 10, which the retriever capped anyway)
        assert seed["retriever"]["searchMode"] == "vector"
        assert seed["retriever"]["filterStrategy"] == "OR"
        assert seed["retriever"]["traversalConcurrentBatches"] == 4
        assert seed["retriever"]["hybridEnabled"] is True
        assert seed["retriever"]["hybridRrfK"] == 60
        assert seed["retriever"]["hybridDenseWeight"] == 1.0
        assert seed["retriever"]["hybridLexicalWeight"] == 1.0
        assert seed["retriever"]["hybridBm25Candidates"] == 50
        # reranker (compose chatqna block: slice/0.75/3 — NOT coded adaptive/0.9)
        assert seed["reranker"]["strategy"] == "slice"
        assert seed["reranker"]["threshold"] == 0.75
        assert seed["reranker"]["topN"] == 3
        # reranker-owned adaptive params (compose reranker block)
        assert seed["reranker"]["noveltySigmoidA"] == 20.0
        assert seed["reranker"]["noveltySigmoidB"] == 0.25
        assert seed["reranker"]["contextDecayFactor"] == 0.0025
        assert seed["reranker"]["minValueThreshold"] == -1.0

    def test_all_module_defaults_are_value_identical(self):
        assert chatqna_module._RAG_DEFAULTS == retriever_module._RAG_DEFAULTS
        assert chatqna_module._RAG_DEFAULTS == reranker_module._RAG_DEFAULTS

    def test_repo_seed_serves_when_env_unset(self):
        # No env var → the K.1 reader resolves the committed seed, so every
        # module's _rag_settings() returns the seeded knob values verbatim
        # (plus the seed's audit envelope, which defaults don't carry).
        for module in (chatqna_module, retriever_module, reranker_module):
            settings = module._rag_settings()
            assert settings["retriever"] == _RAG_DEFAULTS["retriever"]
            assert settings["reranker"] == _RAG_DEFAULTS["reranker"]
            assert settings["version"] == 1

    def test_missing_file_loud_degradation(self, tmp_path, monkeypatch, caplog):
        monkeypatch.setenv(ENV_VAR, str(tmp_path / "never-exists.json"))
        with caplog.at_level(logging.WARNING, logger="core.pipeline_settings"):
            settings = chatqna_module._rag_settings()
        assert settings == _RAG_DEFAULTS  # coded defaults, chat proceeds
        assert "never-exists.json" in caplog.text

    @pytest.mark.parametrize(
        "module", [chatqna_module, retriever_module, reranker_module]
    )
    def test_wrong_typed_fields_degrade_whole_doc_loud(self, module, tmp_path, monkeypatch, caplog):
        # K.1 never-crash law: a PARSEABLE file with a wrong-typed or
        # invalid-enum field must not TypeError at the consumer.
        for bad_doc, needle in [
            ({"retriever": {"retrievalK": "many"}}, "retriever.retrievalK"),
            ({"retriever": {"retrievalK": True}}, "retriever.retrievalK"),  # bool is not an int
            ({"retriever": {"enableTraversal": "true"}}, "retriever.enableTraversal"),
            ({"retriever": {"searchStart": " CHUNK "}}, "retriever.searchStart"),
            ({"reranker": {"strategy": "fuzzy"}}, "reranker.strategy"),
            ({"reranker": {"noveltySigmoidA": "steep"}}, "reranker.noveltySigmoidA"),
            # NaN/Infinity are VALID JSON-number-shaped floats (json.loads
            # accepts the literals) — they must degrade, not silently steer
            # the RRF/sigmoid/adaptive math.
            ({"reranker": {"noveltySigmoidA": float("nan")}}, "reranker.noveltySigmoidA"),
            ({"reranker": {"minValueThreshold": float("inf")}}, "reranker.minValueThreshold"),
            ({"retriever": {"hybridDenseWeight": float("nan")}}, "retriever.hybridDenseWeight"),
            ({"retriever": "all"}, "section 'retriever'"),
        ]:
            caplog.clear()
            _write_settings(bad_doc, tmp_path, monkeypatch)
            with (
                patch.object(module, "logger", logging.getLogger(module.__name__)),
                caplog.at_level(logging.WARNING, logger=module.__name__),
            ):
                settings = module._rag_settings()
            assert settings == _RAG_DEFAULTS, bad_doc
            assert needle in caplog.text


# ---------------------------------------------------------------------------
# chatqna resolution: request-explicit > file > coded, bool parse, and the
# adaptive-key threading into the retriever request.
# ---------------------------------------------------------------------------


class TestChatqnaResolution:
    def test_unset_fields_take_file_values(self, tmp_path, monkeypatch):
        _write_settings(
            {"retriever": {"retrievalK": 5, "fetchK": 8, "scoreThreshold": 0.4}},
            tmp_path,
            monkeypatch,
        )
        retriever_kwargs, reranker_kwargs = _resolve_rag_parms(_req())
        assert retriever_kwargs["k"] == 5
        assert retriever_kwargs["fetch_k"] == 8
        assert retriever_kwargs["score_threshold"] == 0.4
        # keys absent from the partial file fall back to coded defaults
        assert retriever_kwargs["lambda_mult"] == _RAG_DEFAULTS["retriever"]["lambdaMult"]

    def test_request_explicit_beats_file(self, tmp_path, monkeypatch):
        _write_settings({"retriever": {"retrievalK": 5}}, tmp_path, monkeypatch)
        retriever_kwargs, _ = _resolve_rag_parms(_req(k=12))
        assert retriever_kwargs["k"] == 12

    def test_file_edit_visible_without_restart(self, tmp_path, monkeypatch):
        file = _write_settings({"retriever": {"retrievalK": 20}}, tmp_path, monkeypatch)
        assert _resolve_rag_parms(_req())[0]["k"] == 20
        file.write_text(json.dumps({"retriever": {"retrievalK": 5}}), encoding="utf-8")
        assert _resolve_rag_parms(_req())[0]["k"] == 5

    def test_reranker_trio_resolves_from_file(self, tmp_path, monkeypatch):
        _write_settings(
            {"reranker": {"strategy": "knee_threshold", "threshold": 0.6, "topN": 7}},
            tmp_path,
            monkeypatch,
        )
        retriever_kwargs, reranker_kwargs = _resolve_rag_parms(_req())
        assert reranker_kwargs == {
            "reranking_strategy": "knee_threshold",
            "top_n": 7,
            "reranking_threshold": 0.6,
        }

    def test_resolved_reranker_strategy_threads_into_retriever_request(self, tmp_path, monkeypatch):
        # The adaptive gate key: the retriever kwargs carry the SAME resolved
        # strategy as the reranker kwargs (one resolution, both requests).
        _write_settings({"reranker": {"strategy": "adaptive"}}, tmp_path, monkeypatch)
        retriever_kwargs, reranker_kwargs = _resolve_rag_parms(_req())
        assert retriever_kwargs["reranking_strategy"] == "adaptive"
        assert reranker_kwargs["reranking_strategy"] == "adaptive"

        # request-explicit strategy threads too
        retriever_kwargs, reranker_kwargs = _resolve_rag_parms(_req(reranking_strategy="slice"))
        assert retriever_kwargs["reranking_strategy"] == "slice"

    def test_enable_traversal_parsed_as_real_bool_before_stringifying(self, tmp_path, monkeypatch):
        _write_settings({"retriever": {"enableTraversal": False}}, tmp_path, monkeypatch)
        retriever_kwargs, _ = _resolve_rag_parms(_req())
        # wire carries the canonical lowercase string; the retriever parses
        # it back to a REAL bool ("false" is truthy raw)
        assert retriever_kwargs["enable_traversal"] == "false"
        assert retriever_module._parse_wire_bool(retriever_kwargs["enable_traversal"]) is False

        _write_settings({"retriever": {"enableTraversal": True}}, tmp_path, monkeypatch)
        retriever_kwargs, _ = _resolve_rag_parms(_req())
        assert retriever_kwargs["enable_traversal"] == "true"
        assert retriever_module._parse_wire_bool(retriever_kwargs["enable_traversal"]) is True

    def test_request_carried_traversal_string_also_parsed(self):
        # A per-request "false" must not ride the wire raw either.
        retriever_kwargs, _ = _resolve_rag_parms(_req(enable_traversal="false"))
        assert retriever_kwargs["enable_traversal"] == "false"
        retriever_kwargs, _ = _resolve_rag_parms(_req(enable_traversal="true"))
        assert retriever_kwargs["enable_traversal"] == "true"

    def test_distance_threshold_stays_env_fed(self, tmp_path, monkeypatch):
        # Dead knob by spec: chatqna sends it, the retriever never reads it;
        # it must NOT be file-driven (leave the wire alone).
        _write_settings({"retriever": {"scoreThreshold": 0.4}}, tmp_path, monkeypatch)
        retriever_kwargs, _ = _resolve_rag_parms(_req())
        assert retriever_kwargs["distance_threshold"] == chatqna_module.RETRIEVER_DISTANCE_THRESHOLD

    def test_wire_fields_declared_on_the_request_types(self):
        # The adaptive key survives the OPEA endpoint parse only when
        # declared on the request types (custom fields are dropped
        # otherwise). AST pin: the pydantic bases are conftest mocks (no
        # usable __annotations__), and a source string-match is
        # formatting-fragile — parsing the class bodies is neither.
        def annotated_fields(module_path: Path, class_name: str) -> set[str]:
            tree = ast.parse(module_path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if isinstance(node, ast.ClassDef) and node.name == class_name:
                    return {
                        stmt.target.id
                        for stmt in node.body
                        if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name)
                    }
            raise AssertionError(f"class {class_name} not found in {module_path}")

        chatqna_path = Path(chatqna_module.__file__)
        assert "reranking_strategy" in annotated_fields(chatqna_path, "GenieaiRetrieverParms")
        retriever_dir = Path(retriever_module.__file__).parent
        assert "reranking_strategy" in annotated_fields(
            retriever_dir / "genieai_retriever_arangodb.py", "GenieEmbedDoc"
        )
        assert "reranking_strategy" in annotated_fields(
            retriever_dir / "genieai_retriever_microservice.py", "GenieEmbedDoc"
        )

    def test_defaults_env_seed_tier(self, tmp_path, monkeypatch):
        # Precedence leg 2 (ENV-SEED): with NO file at all, the env vars
        # feed the defaults — the dicts read them at IMPORT, so prove it by
        # reloading the (light) reranker module under a set env, then
        # restoring. (With the repo seed present the FILE tier wins — that
        # is leg 1, pinned by test_repo_seed_serves_when_env_unset.)
        monkeypatch.setenv(ENV_VAR, str(tmp_path / "missing.json"))
        monkeypatch.setenv("NOVELTY_SIGMOID_A", "7.5")
        monkeypatch.setenv("RERANKING_STRATEGY", "threshold")
        try:
            reloaded = importlib.reload(reranker_module)
            assert reloaded._RAG_DEFAULTS["reranker"]["noveltySigmoidA"] == 7.5
            assert reloaded._RAG_DEFAULTS["reranker"]["strategy"] == "threshold"
            # env-seed values must still pass the typed guard (file missing)
            assert reranker_module._rag_settings()["reranker"]["noveltySigmoidA"] == 7.5
        finally:
            # Restore BEFORE monkeypatch teardown would: the reload must
            # re-execute with the seed env vars unset (the autouse fixture's
            # delenvs are still in force; only this test's setenvs must go).
            monkeypatch.delenv("NOVELTY_SIGMOID_A", raising=False)
            monkeypatch.delenv("RERANKING_STRATEGY", raising=False)
            importlib.reload(reranker_module)
        assert reranker_module._RAG_DEFAULTS == _RAG_DEFAULTS


class TestTraversalWireValue:
    @pytest.mark.parametrize(
        "value, expected",
        [
            (True, "true"),
            (False, "false"),
            ("true", "true"),
            ("false", "false"),
            ("TRUE", "true"),
            ("False", "false"),
            ("1", "true"),
            ("0", "false"),
            ("banana", "false"),  # garbage parses OFF, not truthy
        ],
    )
    def test_canonical_wire_form(self, value, expected):
        assert _traversal_wire_value(value) == expected

    def test_retriever_side_parse_symmetry(self):
        # the retriever's parser accepts exactly what chatqna stringifies
        for flag in (True, False):
            assert retriever_module._parse_wire_bool(_traversal_wire_value(flag)) is flag


# ---------------------------------------------------------------------------
# Retriever read sites: file-driven knobs + explicit-arg passes.
# ---------------------------------------------------------------------------


def _make_invoke_env(monkeypatch, tmp_path, retriever_overrides):
    """Minimal invoke() environment: happy-path db + vector db mocks (the
    test_retriever.py harness pattern) under a tmp rag-tuning file."""
    from tests.test_retriever import (
        _make_happy_path_db,
        _make_mock_vector_db,
        create_mock_input,
        create_retriever,
    )

    _write_settings({"retriever": retriever_overrides}, tmp_path, monkeypatch)
    db = _make_happy_path_db()
    retriever = create_retriever(db_mock=db)
    embeddings = MagicMock()
    embeddings.embed_query.return_value = [0.1] * 768
    vdb = _make_mock_vector_db(db)
    patches = [
        patch("retriever.genieai_retriever_arangodb.HuggingFaceBgeEmbeddings", return_value=embeddings),
        patch("retriever.genieai_retriever_arangodb.ArangoVector", return_value=vdb),
        patch("retriever.genieai_retriever_arangodb.OPENAI_API_KEY", None),
        patch("retriever.genieai_retriever_arangodb.TEI_EMBEDDING_ENDPOINT", ""),
        patch("retriever.genieai_retriever_arangodb.HF_TOKEN", ""),
    ]
    for p in patches:
        p.start()

    def stop():
        for p in patches:
            p.stop()

    return {"db": db, "retriever": retriever, "vector_db": vdb, "create_input": create_mock_input, "stop": stop}


def _wire_input(env, drop_keys=(), **overrides):
    """create_mock_input always carries search_mode/filter_strategy in its
    model_dump dict (the wire). Dropping those keys simulates the production
    body chatqna actually sends — chatqna does NOT forward them, so the
    file/default resolution is what the retriever consults."""
    input_mock = env["create_input"](**overrides)
    for key in drop_keys:
        input_mock.model_dump.return_value.pop(key, None)
    return input_mock


class TestRetrieverReadSites:
    async def test_searchmode_resolves_from_file(self, tmp_path, monkeypatch):
        env = _make_invoke_env(monkeypatch, tmp_path, {"hybridEnabled": False, "searchMode": "hybrid"})
        try:
            with patch(
                "retriever.genieai_retriever_arangodb.ArangoVector", return_value=env["vector_db"]
            ) as av:
                await env["retriever"].invoke(_wire_input(env, drop_keys=("search_mode",)))
            assert av.call_args.kwargs["search_type"] == "hybrid"
        finally:
            env["stop"]()

    async def test_filter_strategy_resolves_from_file_dead_env_gone(self, tmp_path, monkeypatch):
        # AND vs OR must come from the file (config.py read ARANGO_FILTER_
        # STRATEGY while compose sets RETRIEVER_ARANGO_FILTER_STRATEGY — both
        # dead names; the file read replaces them).
        for strategy, operator in (("AND", "ALL IN"), ("OR", "ANY IN")):
            env = _make_invoke_env(
                monkeypatch, tmp_path, {"hybridEnabled": False, "filterStrategy": strategy}
            )
            try:
                await env["retriever"].invoke(
                    _wire_input(env, drop_keys=("filter_strategy",), search_start="chunk::labels:Health")
                )
                filter_clause = env[
                    "vector_db"
                ].asimilarity_search_with_relevance_scores.call_args.kwargs["filter_clause"]
                assert operator in filter_clause, strategy
            finally:
                env["stop"]()

    async def test_rrf_fuse_receives_hybrid_knobs_explicitly(self, tmp_path, monkeypatch):
        # Signature-bake law: rrf_fuse's def-time default-arg binding makes
        # global rebinds invisible — the invoke site must pass k/weights
        # EXPLICITLY from the file.
        from tests.test_retriever import _FakeDoc

        env = _make_invoke_env(
            monkeypatch,
            tmp_path,
            {
                "hybridEnabled": True,
                "hybridRrfK": 42,
                "hybridDenseWeight": 0.25,
                "hybridLexicalWeight": 3.5,
                "hybridBm25Candidates": 77,
            },
        )
        try:
            bm25_doc = _FakeDoc(id="bm25_only", page_content="keyword match", metadata={})
            with (
                patch.object(env["retriever"], "_bm25_search", return_value=[{"doc": bm25_doc, "score": 1.5}]) as bm25,
                patch(
                    "retriever.genieai_retriever_arangodb.rrf_fuse",
                    wraps=retriever_module.rrf_fuse,
                ) as fuse,
            ):
                result = await env["retriever"].invoke(env["create_input"](search_start="chunk"))
            # the BM25 channel's candidate count = max(k, file bm25Candidates)
            assert bm25.call_args.kwargs["n"] == 77  # max(input.k=4, 77)
            assert fuse.call_count == 1
            kwargs = fuse.call_args.kwargs
            assert kwargs["k"] == 42
            assert kwargs["dense_weight"] == 0.25
            assert kwargs["lexical_weight"] == 3.5
            assert {r["doc"].id for r in result} >= {"doc1", "bm25_only"}  # fusion actually ran
        finally:
            env["stop"]()

    async def test_hybrid_toggle_off_skips_bm25(self, tmp_path, monkeypatch):
        env = _make_invoke_env(monkeypatch, tmp_path, {"hybridEnabled": False})
        try:
            with patch.object(env["retriever"], "_bm25_search") as bm25:
                await env["retriever"].invoke(env["create_input"](search_start="chunk"))
            bm25.assert_not_called()
        finally:
            env["stop"]()

    async def test_enable_traversal_false_string_is_not_truthy(self, tmp_path, monkeypatch):
        # The string-truthiness bug: the wire carries "false" and the
        # retriever must treat it as FALSE (no fetch_neighborhoods call).
        env = _make_invoke_env(monkeypatch, tmp_path, {"hybridEnabled": False})
        try:
            env["retriever"].fetch_neighborhoods = MagicMock(return_value={"doc1": []})
            await env["retriever"].invoke(env["create_input"](search_start="chunk", enable_traversal="false"))
            env["retriever"].fetch_neighborhoods.assert_not_called()

            await env["retriever"].invoke(env["create_input"](search_start="chunk", enable_traversal="true"))
            env["retriever"].fetch_neighborhoods.assert_called()
        finally:
            env["stop"]()

    async def test_adaptive_strategy_from_wire_attaches_embeddings(self, tmp_path, monkeypatch):
        # The threaded key: a request carrying reranking_strategy=adaptive
        # flips the retriever's embedding-attachment gate per request.
        env = _make_invoke_env(monkeypatch, tmp_path, {"hybridEnabled": False})
        try:
            result = await env["retriever"].invoke(
                env["create_input"](search_start="chunk", reranking_strategy="adaptive")
            )
            assert result[0]["doc"].metadata.get("chunk_embedding") == [0.1, 0.2, 0.3]
        finally:
            env["stop"]()


# ---------------------------------------------------------------------------
# Reranker adaptive params: explicit-arg passes + real steering.
# ---------------------------------------------------------------------------


def _adaptive_inputs(n=3):
    texts = [f"chunk text number {i} here" for i in range(n)]
    chunk_embeddings = [[1.0, 0.0], [0.0, 1.0], [1.0, 1.0]][:n]
    query_embedding = [1.0, 0.0]
    scores = [0.9 - 0.25 * i for i in range(n)]  # sorted descending
    return texts, chunk_embeddings, query_embedding, scores


class TestRerankerAdaptiveParams:
    def test_novelty_sigmoid_receives_a_b_explicitly(self, tmp_path, monkeypatch):
        # Signature-bake law: novelty_sigmoid's def-time defaults hide global
        # rebinds — adaptive_context_selection must pass a/b explicitly from
        # the file.
        _write_settings(
            {"reranker": {"noveltySigmoidA": 7.5, "noveltySigmoidB": 0.6}},
            tmp_path,
            monkeypatch,
        )
        texts, chunk_embeddings, query_embedding, scores = _adaptive_inputs()
        with patch(
            "reranker.genieai_tei_reranker.novelty_sigmoid",
            wraps=reranker_module.novelty_sigmoid,
        ) as sigmoid:
            reranker_module.adaptive_context_selection(texts, chunk_embeddings, query_embedding, scores)
        assert sigmoid.call_count >= 1
        assert sigmoid.call_args.kwargs["a"] == 7.5
        assert sigmoid.call_args.kwargs["b"] == 0.6

    def test_context_decay_and_min_value_from_file(self, tmp_path, monkeypatch):
        # An aggressive decay + high minValue must select FEWER chunks than
        # the defaults on the same inputs (the knobs actually steer math).
        texts, chunk_embeddings, query_embedding, scores = _adaptive_inputs()
        defaults_selected = reranker_module.adaptive_context_selection(
            list(texts), [list(v) for v in chunk_embeddings], query_embedding, list(scores)
        )[0]
        assert defaults_selected  # sanity: defaults do select something

        _write_settings(
            {"reranker": {"contextDecayFactor": 50.0, "minValueThreshold": 0.9}},
            tmp_path,
            monkeypatch,
        )
        tuned_selected = reranker_module.adaptive_context_selection(
            texts, chunk_embeddings, query_embedding, scores
        )[0]
        assert len(tuned_selected) < len(defaults_selected)

    def test_breakdown_records_selected_flags_consistently(self):
        texts, chunk_embeddings, query_embedding, scores = _adaptive_inputs(2)
        selected, breakdown = reranker_module.adaptive_context_selection(
            texts, chunk_embeddings, query_embedding, scores
        )
        assert [rec["selected"] for rec in breakdown] == [i in selected for i in range(len(texts))]

    def test_span_attrs_emit_per_request_file_values(self, tmp_path, monkeypatch):
        # Source pin (the emit lines live in the adaptive branch whose TEI
        # plumbing is mock-heavy): the span attrs read the per-request
        # resolved file values, not the boot env constants.
        _write_settings(
            {"reranker": {"contextDecayFactor": 0.75, "minValueThreshold": -0.5}},
            tmp_path,
            monkeypatch,
        )
        rr = reranker_module._rag_settings()["reranker"]
        assert rr["contextDecayFactor"] == 0.75
        assert rr["minValueThreshold"] == -0.5
        src = Path(reranker_module.__file__).read_text(encoding="utf-8")
        assert 'span.set_attribute("rag.adaptive_context_decay_factor", _rr_span["contextDecayFactor"])' in src
        assert 'span.set_attribute("rag.adaptive_min_value_threshold", _rr_span["minValueThreshold"])' in src
        assert 'span.set_attribute("rag.adaptive_context_decay_factor", CONTEXT_DECAY_FACTOR)' not in src
        assert 'span.set_attribute("rag.adaptive_min_value_threshold", MIN_VALUE_THRESHOLD)' not in src


class TestRerankerDefaultsStillDocumented:
    def test_env_constants_kept_as_seed_tier(self):
        # The module constants remain (novelty_sigmoid's def-time defaults +
        # the documented env seed tier) and match the file defaults.
        assert reranker_module.NOVELTY_SIGMOID_A == _RAG_DEFAULTS["reranker"]["noveltySigmoidA"]
        assert reranker_module.NOVELTY_SIGMOID_B == _RAG_DEFAULTS["reranker"]["noveltySigmoidB"]
        assert reranker_module.CONTEXT_DECAY_FACTOR == _RAG_DEFAULTS["reranker"]["contextDecayFactor"]
        assert reranker_module.MIN_VALUE_THRESHOLD == _RAG_DEFAULTS["reranker"]["minValueThreshold"]
