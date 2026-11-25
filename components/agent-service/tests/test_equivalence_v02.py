# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The behavioral-equivalence suite: the recorded fixtures vs the implementation.

DATA-DRIVEN: every assertion reads its expectation from
``docs/baselines/v02-opea-query-path-contract.fixtures.json`` — the recorded
knobs drive the config loads, the recorded ``expected_output`` statements are
asserted through the established fake seams (``httpx.MockTransport`` for TEI,
the nested fake DB for Arango). A missing, renamed or emptied fixture block
fails loudly in the structure-integrity test; a behavior that silently
appears or drifts fails its own test.

The suite COMPLEMENTS the inline suites (``test_retrieval_semantics``,
``test_reranking_strategies``, ``test_query_instruction``): those pin the
mechanics; this suite ties each recorded expectation to the implementation
through the recorded values, and pins the four behaviors the port
deliberately does NOT implement as recorded deviations — absence assertions
plus the deviation table below. A deviation that silently disappears (the
behavior starts being implemented) or changes breaks this suite. One
further divergence lives INSIDE an implemented behavior and is pinned by
its own test, not the table:
``test_dense_null_score_rows_are_skipped_not_crashed`` (the port skips a
null-score dense row where the deployed wrapper crashes).

No live venue, no network: everything runs against the fake seams.
"""

import asyncio
import json
import logging
from pathlib import Path

import httpx
import pytest
from conftest import PreparationFakeTransport, preparation_model_entry

from capabilities.adapters.arango_retrieval import ArangoRetrievalAdapter, build_aql_filter_clause, rrf_fuse
from capabilities.adapters.env_config import ArangoConfig, HybridConfig, RerankingConfig
from capabilities.adapters.query_instruction import get_query_instruction
from capabilities.adapters.tei_reranking import TeiRerankingAdapter
from capabilities.contract import QueryPreparationStatus
from preparation import PreparationConfig, QueryPreparer
from preparation.registry import LanguageRegistry
from preparation.translation import TranslationClient

FIXTURES = Path(__file__).resolve().parents[3] / "docs" / "baselines" / "v02-opea-query-path-contract.fixtures.json"

FIXTURE_DATA = json.loads(FIXTURES.read_text())
EXPECTATIONS = FIXTURE_DATA["expectations"]
BEHAVIORS = EXPECTATIONS["behaviors"]
PREPARATION = EXPECTATIONS["preparation"]
MEASURED = FIXTURE_DATA["measured"]

# The recorded behavior catalog — the exact 14 blocks the record defines.
RECORDED_BEHAVIORS = (
    "dense_retrieval",
    "bm25_lexical_leg",
    "rrf_fusion",
    "label_filter",
    "defense_in_depth_post_filter",
    "file_id_enrichment",
    "cap1_identity_join",
    "provenance_attach",
    "graph_traversal",
    "fanout",
    "routing",
    "query_instruction",
    "reranking_evidence_selection",
    "reranker_down",
)

# The behaviors the port deliberately does NOT implement, pinned as
# recorded deviations. THE TABLE IS THE CONTRACT: each entry names the
# recorded behavior, the recorded scope line that stands, and what the port
# does instead — so a review reads the deviation from the table alone.
DEVIATIONS = {
    "graph_traversal": (
        "The deployed traversal stage rewrites each surviving chunk's text "
        "with the RELATED INFORMATION neighbourhood. The port implements NO "
        "traversal: the recorded scope line stands, the chunk text "
        "reaches the reranker and the prompt verbatim, and no GRAPH_LINKS_TO "
        "query ever executes."
    ),
    "fanout": (
        "The deployed multi-graph fan-out (the encoded carrier, per-graph "
        "legs with timeouts and candidate caps, second-level cross-graph "
        "RRF) is not implemented. The port iterates the TRUSTED CALLER "
        "CONTEXT's authorized graphs serially and reranks the union once — "
        "the carrier machinery has no authorized-graph semantics and stays "
        "unported."
    ),
    "routing": (
        "The deployed graph-routing gate (head selection, forbidden tags, "
        "chunk competition, degraded fallback to the full carrier) is not "
        "implemented. Graph selection is the caller context's authorized "
        "set; no routing probe runs."
    ),
    "provenance_attach": (
        "Two layers deviate. The deployed ``_attach_provenance`` decorates "
        "each result dict with graph_name/repo_id/concept_id envelope "
        "fields; the port carries identity in the CONTRACT's provenance "
        "types (LegacyFileProvenance without a marker; OkfConceptProvenance "
        "with the okf-concept marker) — the envelope fields are not "
        "replicated, and graph attribution rides the leg's own scope. And "
        "the deployed retriever serves a chunk with no derivable file_id "
        "unattributed while chatqna drops it later, at citation assembly; "
        "the port drops it EARLIER, at the capability's hit minting: the "
        "executor and the no-agent citation mapping both read the same "
        "hits, so an unresolvable identity cannot surface anywhere. The "
        "early drop costs the chunk its TEXT as well as its citation — "
        "the port's answer loses that evidence, where the deployed answer "
        "keeps it — and a selection of unresolvable candidates abstains "
        "with ``no_resolvable_candidates``, where the deployed path answers "
        "over the degraded evidence."
    ),
}


def behavior(name: str) -> dict:
    return BEHAVIORS[name]


def recorded_env(source: str = "retriever") -> dict:
    """The deployed env of one container, as the venue carried it."""
    return dict(MEASURED["deployed_env"][source])


def chatqna_knobs(block: str) -> dict:
    return behavior(block).get("deployed_knobs", {}).get("chatqna", {})


# ---------------------------------------------------------------------
# The fake seams (the established shapes)
# ---------------------------------------------------------------------


class FakeCursor:
    def __init__(self, rows):
        self._rows = rows

    def __iter__(self):
        return iter(self._rows)


def make_adapter(rows_per_query=None, env_overrides=None):
    """An ArangoRetrievalAdapter over a fake DB, driven by the RECORDED env.

    ``rows_per_query`` maps a distinctive AQL marker to the rows that query
    returns; every executed query is captured on ``adapter.executed``.
    """
    executed: list[tuple[str, dict]] = []
    row_map = rows_per_query or {}
    created: list = []

    class FakeAql:
        def execute(self, query, count=False, batch_size=None, ttl=None, bind_vars=None, **_):
            executed.append((query, bind_vars))
            for marker, rows in row_map.items():
                if marker in query:
                    if isinstance(rows, Exception):
                        raise rows
                    return FakeCursor(rows)
            return FakeCursor([])

    class FakeDb:
        aql = FakeAql()

        def views(self):
            return []

        def create_arangosearch_view(self, name, properties):
            created.append(name)

    env = {**recorded_env(), **(env_overrides or {})}
    adapter = ArangoRetrievalAdapter(FakeDb(), ArangoConfig.load(env), HybridConfig.load(env))
    adapter.executed = executed
    return adapter


def make_reranker(strategy="slice", top_n=3, threshold=0.75, handler=None):
    config = RerankingConfig(
        strategy=strategy,
        threshold=threshold,
        top_n=top_n,
        calibration="none",
        temperature=1.0,
        rerank_timeout_seconds=300.0,
        connect_timeout_seconds=30.0,
    )
    captured: dict = {}
    if handler is None:

        def handler(request: httpx.Request) -> httpx.Response:
            captured["request"] = request
            return httpx.Response(
                200,
                json=[
                    {"index": 0, "score": 0.9},
                    {"index": 1, "score": 0.6},
                    {"index": 2, "score": 0.1},
                ],
            )

    adapter = TeiRerankingAdapter("https://tei.invalid", config, transport=httpx.MockTransport(handler))
    adapter.captured = captured
    return adapter


# ---------------------------------------------------------------------
# Fixture structure integrity — a missing/renamed/emptied block fails loudly
# ---------------------------------------------------------------------


def test_every_recorded_behavior_block_is_present_and_populated():
    """The 14 recorded blocks exist under their recorded names, each with a
    title, a non-empty expected_output and code references."""
    assert tuple(sorted(BEHAVIORS.keys())) == tuple(sorted(RECORDED_BEHAVIORS))
    for name in RECORDED_BEHAVIORS:
        block = BEHAVIORS[name]
        assert block.get("title"), name
        expected = block.get("expected_output")
        assert isinstance(expected, dict) and expected, f"{name}: the expected_output block is missing or empty"
        assert block.get("code"), f"{name}: the code references are missing"


def test_preparation_block_is_present_and_populated():
    assert PREPARATION.get("order"), "the preparation order is missing"
    assert set(PREPARATION["status_values"]) == {
        "translated",
        "passthrough_english",
        "passthrough_unknown_language",
        "fallback_timeout",
        "fallback_error",
    }
    assert len(PREPARATION["failure_classes"]) == 3
    assert {c["class"] for c in PREPARATION["failure_classes"]} == {
        "translator_unavailable",
        "oversized_input",
        "translation_returning_blank",
    }
    # The recorded per-class flags: only oversized_input abstains (422), the
    # other two degrade and still answer 200. A fixture edit that flips a
    # flag or a status must redden here, not silently diverge from the
    # behavior test_preparation_prepare.py pins.
    assert {c["class"]: (c["http_status"], c["abstains"]) for c in PREPARATION["failure_classes"]} == {
        "translator_unavailable": (200, False),
        "oversized_input": (422, True),
        "translation_returning_blank": (200, False),
    }
    assert PREPARATION["measured_budget"]["translation_char_budget"] == 11520
    assert PREPARATION["locales_source"] == "measured.preparation.locales"
    assert MEASURED["preparation"]["locales"], "the recorded locale samples are missing"


def test_the_deviation_table_names_recorded_behaviors_only():
    """Every pinned deviation is a REAL recorded behavior, and the ported
    surface is not in the table (a deviation that silently disappears means
    someone implemented the behavior without recording the decision)."""
    assert set(DEVIATIONS) <= set(RECORDED_BEHAVIORS)
    for name, text in DEVIATIONS.items():
        assert len(text) > 40, f"{name}: the deviation entry carries no recorded decision"


def test_the_provenance_deviation_states_what_the_early_drop_costs():
    """The port drops the unresolvable chunk earlier than the deployed
    path. The drop costs the answer the chunk's TEXT, and a selection of
    unresolvable candidates abstains where the deployed path answers. The
    table names both consequences — a reader must not have to infer them
    from the code."""
    text = DEVIATIONS["provenance_attach"]
    assert "TEXT" in text
    assert "no_resolvable_candidates" in text


# ---------------------------------------------------------------------
# Per-behavior assertions — the recorded expectations vs the implementation
# ---------------------------------------------------------------------


def test_dense_retrieval_runs_bruteforce_cosine_over_the_recorded_knobs():
    """expected_output: GRAPH_SOURCE (search_start=chunk), brute-force exact
    scan, k = RETRIEVER_ARANGO_K, descending score, empty leg → the BM25 leg
    may rescue (fusion before the empty check)."""
    assert behavior("dense_retrieval")["expected_output"]["collection"] == "GRAPH_SOURCE (search_start=chunk)"
    config = ArangoConfig.load(recorded_env())
    # The recorded knob VALUES drive the load: use_approx false = exact scan.
    assert config.use_approx_search is False
    assert config.distance_strategy == "COSINE"
    assert config.search_start == "chunk"
    # The recorded k (20) is the LIMIT the dense AQL carries.
    dense_rows = [{"key": "c1", "text": "a", "score": 0.9}]
    adapter = make_adapter({"COSINE_SIMILARITY": dense_rows})
    asyncio.run(adapter.dense_search([0.1] * 4, [], "OR"))
    aql, bind_vars = adapter.executed[0]
    assert "COSINE_SIMILARITY(doc.embedding, @embedding)" in aql
    assert bind_vars["k"] == int(recorded_env()["RETRIEVER_ARANGO_K"]) == 20
    assert bind_vars["@collection"] == f"{config.graph_name}_SOURCE"


def test_dense_null_score_rows_are_skipped_not_crashed(caplog):
    """A deliberate divergence from the recorded dense_retrieval behavior:
    the deployed wrapper raises on a chunk whose embedding is null (a null
    COSINE_SIMILARITY score reaches its float() coercion). The port SKIPS
    the unscoreable row instead — the leg degrades to the remaining scored
    rows, and the skip is safe after the LIMIT because null sorts last
    under SORT score DESC. The skip is visible: one WARNING naming the
    unscoreable count."""

    rows = [
        {"key": "c1", "text": "a", "score": None},
        {"key": "c2", "text": "b", "score": 0.9},
    ]
    adapter = make_adapter({"COSINE_SIMILARITY": rows})
    with caplog.at_level(logging.WARNING):
        results = asyncio.run(adapter.dense_search([0.1] * 4, [], "OR"))
    assert [r["doc"].key for r in results] == ["c2"]
    skipped = [r for r in caplog.records if "unscoreable" in r.getMessage()]
    assert len(skipped) == 1
    assert skipped[0].levelno == logging.WARNING
    assert "1 unscoreable row(s)" in skipped[0].getMessage()


def test_bm25_lexical_leg_searches_the_view_with_the_raw_query():
    """expected_output: GRAPH_BM25_VIEW, TOKENS on the RAW query, native
    BM25, n = max(k, BM25_CANDIDATES), failure → empty leg, never a raise."""
    expected = behavior("bm25_lexical_leg")["expected_output"]
    assert expected["failure"] == "any error is logged (BM25 search failed on view ...) and the leg returns []"
    hybrid = HybridConfig.load(recorded_env())
    assert hybrid.enabled is True
    assert hybrid.bm25_analyzer == "text_en"
    assert hybrid.bm25_candidates == 50
    rows = [{"key": "c9", "text": "x", "chunk_labels": None, "score": 5.0}]
    adapter = make_adapter({"BM25_VIEW": rows})
    asyncio.run(adapter.bm25_search("raw query", "GRAPH", [], "OR"))
    aql, bind_vars = adapter.executed[0]
    assert "`GRAPH_BM25_VIEW`" in aql
    assert "SEARCH ANALYZER(doc.text IN TOKENS(@query, @analyzer), @analyzer)" in aql
    assert "BM25(doc)" in aql
    assert bind_vars["query"] == "raw query"  # never the prefixed text
    assert bind_vars["analyzer"] == hybrid.bm25_analyzer
    # n = max(k, bm25_candidates) = max(20, 50)
    assert bind_vars["n"] == max(ArangoConfig.load(recorded_env()).k, hybrid.bm25_candidates) == 50


def test_rrf_fusion_formula_and_truncation_over_the_recorded_knobs():
    """expected_output: weight/(rrf_k + rank) over newly seen ids, truncated
    to k after fusion, dense-favoured ties."""
    expected = behavior("rrf_fusion")["expected_output"]
    assert "weight / (rrf_k + rank)" in expected["formula"]
    hybrid = HybridConfig.load(recorded_env())
    assert hybrid.rrf_k == 60
    assert hybrid.dense_weight == 1.0 and hybrid.lexical_weight == 1.0

    class Doc:
        def __init__(self, key):
            self.key = key

    dense = [{"doc": Doc("a"), "score": 0.9}]
    bm25 = [{"doc": Doc("b"), "score": 5.0}]
    fused = rrf_fuse(
        dense, bm25, k=hybrid.rrf_k, dense_weight=hybrid.dense_weight, lexical_weight=hybrid.lexical_weight
    )
    scores = {entry["doc"].key: entry["score"] for entry in fused}
    assert scores["a"] == pytest.approx(1.0 / (hybrid.rrf_k + 1))  # dense rank 1
    assert scores["b"] == pytest.approx(1.0 / (hybrid.rrf_k + 1))  # bm25 rank 1, tie → dense first
    assert [entry["doc"].key for entry in fused] == ["a", "b"]  # ties keep insertion order


def test_label_filter_builds_the_recorded_clauses_for_both_strategies():
    expected = behavior("label_filter")["expected_output"]

    # The fixture's prose drops the space after the list commas; the clause
    # is the recorded shape up to that spacing.
    def _recorded(clause):
        return clause.replace(", ", ",")

    assert _recorded(build_aql_filter_clause(["L1", "L2"], "OR")) == _recorded(expected["aql_or"])
    assert _recorded(build_aql_filter_clause(["L1", "L2"], "AND")) == _recorded(expected["aql_and"])
    assert build_aql_filter_clause([], "OR") == ""  # no_labels → no clause at all
    # The recorded strategy is OR on the venue.
    assert ArangoConfig.load(recorded_env()).filter_strategy == "OR"


def test_defense_in_depth_post_filter_drops_unlabelled_chunks():
    expected = behavior("defense_in_depth_post_filter")["expected_output"]
    assert "dropped whenever a label filter is active" in expected["chunk_without_labels"]
    # The BM25 leg's post-filter: rows failing the strategy are skipped.
    rows = [
        {"key": "c1", "text": "x", "chunk_labels": ["L1"], "score": 5.0},
        {"key": "c2", "text": "y", "chunk_labels": None, "score": 4.0},  # no labels → dropped
    ]
    adapter = make_adapter({"BM25_VIEW": rows})
    results = asyncio.run(adapter.bm25_search("q", "GRAPH", ["L1"], "OR"))
    assert [r["doc"].key for r in results] == ["c1"]


def test_file_id_enrichment_is_one_batched_query_with_list_metadata():
    expected = behavior("file_id_enrichment")["expected_output"]
    assert "ONE batched AQL" in expected["aql"]
    assert expected["absent"] == "an absent file_id yields [], never null and never a missing key"
    rows_file_id = [
        {"key": "c1", "file_id": "f1"},
        {"key": "c2", "file_id": None},
    ]
    adapter = make_adapter({"file_id: doc.file_id": rows_file_id, "okf_concepts_meta": []})

    class Chunk:
        def __init__(self, key):
            self.key = key

    results = [{"doc": Chunk("c1"), "score": 0.9}, {"doc": Chunk("c2"), "score": 0.8}]
    asyncio.run(adapter.enrich(results))
    enrichment = [
        aql for aql, _ in adapter.executed if "doc._key IN @chunk_ids" in aql and "okf_concepts_meta" not in aql
    ]
    assert len(enrichment) == 1  # ONE batched query for all chunks
    assert results[0]["doc"].file_ids == ["f1"]
    assert results[1]["doc"].file_ids == []  # absent → [], never null


def test_cap1_identity_join_is_graph_scoped_and_tolerates_absence():
    assert "tolerated absence" in behavior("cap1_identity_join")["title"]
    rows_file_id = [{"key": "c1", "file_id": "f1"}]
    rows_identity = [{"key": "c1", "repo_id": "repo-1", "bundle_version": 3}]
    adapter = make_adapter({"file_id: doc.file_id": rows_file_id, "okf_concepts_meta": rows_identity})

    class Chunk:
        repo_id = None
        bundle_version = None

        def __init__(self, key):
            self.key = key

    results = [{"doc": Chunk("c1"), "score": 0.9}]
    asyncio.run(adapter.enrich(results))
    identity_aql, identity_binds = next((a, b) for a, b in adapter.executed if "okf_concepts_meta" in a)
    # The recorded AQL shape: graph_name AND concept_id == doc.file_id.
    assert "FILTER m.graph_name == @graph_name" in identity_aql
    assert "m.concept_id == doc.file_id" in identity_aql
    assert identity_binds["graph_name"] == "GRAPH"
    # The tolerated-absence branch: an unresolved chunk keeps its identity.
    adapter_absent = make_adapter({"file_id: doc.file_id": rows_file_id, "okf_concepts_meta": []})
    results_absent = [{"doc": Chunk("c1"), "score": 0.9}]
    asyncio.run(adapter_absent.enrich(results_absent))
    assert results_absent[0]["doc"].repo_id is None
    assert results_absent[0]["doc"].bundle_version is None


def test_provenance_attach_ported_layer_carries_the_contract_identity():
    """The PORTED layer: identity rides the contract's provenance types —
    a legacy file_id without a marker, an OKF trio with the okf-concept
    marker. The retriever-envelope fields (the deviation below) are absent
    from the contract result."""
    from capabilities.contract import LegacyFileProvenance, OkfConceptProvenance, SearchHit

    expected = behavior("provenance_attach")["expected_output"]
    assert expected["graph_name"] == "always set to the leg's graph name"
    hit_legacy = SearchHit(provenance=LegacyFileProvenance(file_id="f1"), text="t", score=0.9)
    hit_okf = SearchHit(
        provenance=OkfConceptProvenance(concept_id="f2", repo_id="repo-1", bundle_version=3), text="t", score=0.8
    )
    assert hit_legacy.model_dump() == {"provenance": {"file_id": "f1"}, "text": "t", "score": 0.9}
    assert hit_okf.provenance.source == "okf-concept"
    assert hit_okf.provenance.concept_id == "f2"
    assert hit_okf.provenance.repo_id == "repo-1"
    assert hit_okf.provenance.bundle_version == 3
    # The envelope layer is NOT in the contract surface (the deviation).
    assert "graph_name" not in SearchHit.model_fields
    assert "repo_id" not in SearchHit.model_fields


def test_query_instruction_resolves_the_recorded_instruction_for_the_recorded_model():
    block = behavior("query_instruction")
    expected = block["expected_output"]
    model_id = block["deployed_knobs"]["embedding"]["EMBEDDING_MODEL_ID"]
    assert expected["resolved_instruction"] == get_query_instruction(model_id, overrides_raw="")
    # The recorded absent knobs stay absent: the built-in table applies.
    assert model_id == "BAAI/bge-large-en-v1.5"
    # no-prefix models embed RAW.
    for no_prefix_model in ("BAAI/bge-m3", "sentence-transformers/all-MiniLM-L6-v2"):
        assert get_query_instruction(no_prefix_model, overrides_raw="") is None


def test_the_recorded_locale_embedded_text_carries_the_prefix():
    """measured.preparation.locales: the English string handed to the
    embedder carries the query-instruction prefix — the PREFIXED text goes
    to the embedder, the RAW text to the BM25 leg."""
    instruction = get_query_instruction("BAAI/bge-large-en-v1.5", overrides_raw="")
    for locale in MEASURED["preparation"]["locales"]:
        assert locale["embedded_text"] == instruction + locale["english_query"]
        assert locale["english_query"] in locale["english_history"]


def test_reranking_evidence_selection_runs_the_recorded_strategy_and_order():
    """expected_output: slice keeps the first top_n of the score-descending
    response, the order survives into the result, chatqna sends the params
    explicitly (the container's own defaults are inert)."""
    chatqna = chatqna_knobs("reranking_evidence_selection")
    config = RerankingConfig.load(chatqna)
    assert config.strategy == "slice"
    assert config.top_n == 3
    assert config.threshold == 0.75
    adapter = make_reranker(strategy=config.strategy, top_n=config.top_n, threshold=config.threshold)
    outcome = asyncio.run(adapter.rerank("q", ["t0", "t1", "t2"]))
    # slice: the first top_n entries of TEI's score-descending answer, in
    # TEI's order.
    assert [(s.text, s.score) for s in outcome.selection] == [("t0", 0.9), ("t1", 0.6), ("t2", 0.1)]
    # The recorded invocation: truncate=false, no top_n, no auth header.
    body = json.loads(adapter.captured["request"].read())
    assert body == {"query": "q", "texts": ["t0", "t1", "t2"], "truncate": False}
    assert "authorization" not in {k.lower() for k in adapter.captured["request"].headers}


def test_reranker_down_failure_modes_map_as_recorded():
    """expected_output: 422 input-too-long → the recorded ABSTENTION path;
    other HTTP errors and unexpected bodies → a hard failure (no fallback
    to the retrieval order); an opaque 500 → an empty selection."""
    expected = behavior("reranker_down")["expected_output"]
    assert "There is NO fallback to the retrieval order." in expected["unreachable_or_timeout"]
    texts = ["t0", "t1", "t2"]

    def too_long(request: httpx.Request) -> httpx.Response:
        return httpx.Response(422, json={"error": "Given: 9999; the input is too long", "error_type": "Validation"})

    too_long_adapter = make_reranker(handler=too_long)
    from capabilities.adapters.tei_reranking import RerankerInputTooLongError

    with pytest.raises(RerankerInputTooLongError):
        asyncio.run(too_long_adapter.rerank("q", texts))

    def opaque_500(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[])

    empty_adapter = make_reranker(handler=opaque_500)
    outcome = asyncio.run(empty_adapter.rerank("q", texts))
    assert outcome.selected_nothing is True  # the abstention path

    def server_error(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "boom"})

    failing_adapter = make_reranker(handler=server_error)
    with pytest.raises(RuntimeError):
        asyncio.run(failing_adapter.rerank("q", texts))  # → the caller's transient failure


def test_reranking_score_count_mismatch_is_not_fatal():
    """expected_output: a score-count mismatch logs a warning and proceeds;
    an out-of-range index skips its document."""
    logged: list[str] = []

    def mismatched(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[{"index": 0, "score": 0.9}])  # 1 score for 3 docs

    class ListHandler(logging.Handler):
        def emit(self, record):
            logged.append(record.getMessage())

    handler = ListHandler()
    logger = logging.getLogger("capabilities.adapters.tei_reranking")
    logger.addHandler(handler)
    try:
        adapter = make_reranker(handler=mismatched)
        outcome = asyncio.run(adapter.rerank("q", texts=["t0", "t1", "t2"]))
    finally:
        logger.removeHandler(handler)
    assert outcome.selection  # proceeded
    assert any("counts differ" in message for message in logged)


# ---------------------------------------------------------------------
# The preparation block — the recorded order over the recorded knobs
# ---------------------------------------------------------------------


def _preparer():
    """A QueryPreparer wired to the RECORDED translation knobs, over the
    fake transport (window 8192 — the venue's measured translation window)."""
    env = dict(recorded_env("chatqna"))
    env["VLLM_TRANSLATION_ENDPOINT"] = MEASURED["deployed_env"]["chatqna"]["VLLM_TRANSLATION_ENDPOINT"]
    config = PreparationConfig.load(env)
    registry = LanguageRegistry(config.registry_path)
    transport = PreparationFakeTransport(
        {
            f"{config.translation_endpoint}/v1/models": preparation_model_entry(
                max_model_len=MEASURED["preparation"]["translation_window"], model_id=env["VLLM_TRANSLATION_MODEL_ID"]
            ),
            f"{config.translation_endpoint}/tokenize": (200, {"count": 40}),
            f"{config.translation_endpoint}/v1/chat/completions": (
                200,
                {
                    "choices": [
                        {
                            "message": {"content": "USER: How does the city of Geneva manage public transport?"},
                            "finish_reason": "stop",
                        }
                    ]
                },
            ),
        }
    )
    return QueryPreparer(config, registry, TranslationClient(config, registry, transport=transport))


def test_preparation_status_vocabulary_is_the_recorded_one():
    """The five recorded statuses are exactly the contract's enum."""
    recorded = set(PREPARATION["status_values"])
    assert recorded == {status.value for status in QueryPreparationStatus}


def test_preparation_order_detects_and_translates_to_english(seeded_langdetect):
    """The recorded order on a recorded locale: the French sample detects FR,
    translates to English, status translated — and the QUERY is the last
    USER segment of the TRANSLATED history. The detector is seeded for
    determinism (the sibling preparation suites' rule; production stays
    unseeded)."""
    locale = next(l for l in MEASURED["preparation"]["locales"] if l["locale"] == "fr")
    pytest.importorskip("langdetect")
    result = asyncio.run(_preparer().prepare([{"role": "user", "content": locale["sample"]}]))
    assert result.status is QueryPreparationStatus.TRANSLATED
    assert result.language == locale["history_language"]
    assert result.query is not None


def test_preparation_derived_char_budget_matches_the_measured_budget():
    """measured_budget.derivation: (window − 512) // 2 × 3 = 11520 on the
    venue's 8192-token window; MAX_TRANSLATION_CHARS unset → the 2000 code
    constant is only the fallback."""
    from preparation.bounds import derived_char_budget

    derivation = PREPARATION["measured_budget"]["derivation"]
    assert "(8192 - 512) // 2 * 3" in derivation
    assert "TRANSLATION_PROMPT_OVERHEAD_TOKENS" in derivation
    assert "TRANSLATION_CHARS_PER_TOKEN" in derivation
    config = PreparationConfig.load(dict(recorded_env("chatqna")))
    assert config.max_translation_chars == 2000  # the fallback
    assert derived_char_budget(8192, config) == 11520


# ---------------------------------------------------------------------
# The deviation table — the four non-ported behaviors, pinned as ABSENT
# ---------------------------------------------------------------------


def test_deviation_graph_traversal_no_traversal_query_ever_runs():
    """Absence assertion: no AQL the adapter executes touches the traversal
    machinery (GRAPH_LINKS_TO), and no chunk text is rewritten with the
    RELATED INFORMATION marker."""
    expected = behavior("graph_traversal")["expected_output"]
    assert "RELATED INFORMATION" in expected["text_mutation"]
    dense_rows = [{"key": "c1", "text": "a", "score": 0.9, "chunk_labels": None}]
    adapter = make_adapter({"COSINE_SIMILARITY": dense_rows, "BM25_VIEW": dense_rows})
    results = asyncio.run(adapter.fused_candidates([0.1] * 4, "raw query", []))
    assert all("RELATED INFORMATION" not in r["doc"].text for r in results)
    assert all("LINKS_TO" not in aql for aql, _ in adapter.executed)


def test_deviation_fanout_no_carrier_no_cross_graph_fusion():
    """Absence assertion: the fan-out machinery has no equivalent in the
    adapter — no carrier parsing, no per-graph timeout/cap knobs, no
    second-level RRF keyed on (graph_name, chunk_id)."""
    import capabilities.adapters.arango_retrieval as adapter_module

    for symbol in ("fanout", "_fanout", "carrier", "cross_graph", "fanout_candidates"):
        assert not hasattr(adapter_module, symbol), symbol
    # The recorded env carries the fan-out knobs (deployed); no config load
    # exposes one — the port's multi-graph scope is the CAPABILITY's context
    # legs, not the fan-out: each graph is one leg, the union is reranked once.
    loaded = ArangoConfig.load(recorded_env())
    assert not any("fanout" in field for field in type(loaded).__dataclass_fields__)


def test_deviation_routing_no_routing_gate_in_the_port():
    """Absence assertion: no routing machinery exists — no _route_graphs
    symbol, and no RETRIEVER_ROUTE_* knob read by any config load (the
    symbol scan plus the config-surface scan prove absence of the
    MECHANISM; source-text greps would false-positive on a comment)."""
    import capabilities.adapters.arango_retrieval as adapter_module

    assert not hasattr(adapter_module, "_route_graphs")
    # The recorded env CARRIES the routing knobs (deployed); the port must
    # accept them without effect — no config load exposes a routing field.
    config_env = recorded_env()
    assert any(key.startswith("RETRIEVER_ROUTE") for key in config_env)
    loaded = ArangoConfig.load(config_env)
    assert not any("route" in field for field in type(loaded).__dataclass_fields__)


def test_deviation_provenance_envelope_absent_from_the_contract_surface():
    """Absence assertion: the retriever's result-dict envelope (graph_name /
    repo_id / concept_id decoration) is not replicated — the contract result
    carries provenance TYPES, and extra=forbid refuses the envelope fields."""
    from capabilities.contract import SearchHit

    assert "graph_name" not in SearchHit.model_fields
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        SearchHit.model_validate({"provenance": {"file_id": "f1"}, "text": "t", "score": 0.9, "graph_name": "GRAPH"})


def test_the_recorded_absent_knobs_are_inert_in_the_port():
    """The record's discrepancies and absent knobs: the inert knobs are
    ACCEPTED (a deployment carrying them still boots) and without effect."""
    discrepancies = {d["knob"] for d in EXPECTATIONS["discrepancies"]}
    assert "RETRIEVER_ARANGO_DISTANCE_THRESHOLD" in discrepancies
    assert "RETRIEVER_ARANGO_FETCH_K" in discrepancies
    env = recorded_env()
    env["RETRIEVER_ARANGO_DISTANCE_THRESHOLD"] = "1"  # read by nobody
    env["RETRIEVER_ARANGO_FETCH_K"] = "30"  # mmr-only, never selected
    config = ArangoConfig.load(env)
    assert config.k == 20 and config.score_threshold == 0.2


def test_the_modules_aql_doubles_track_the_real_driver_signature():
    """Every ``execute`` double in this module carrying ``bind_vars`` must
    take it in the real driver's position — a double that takes it second
    would mask a positional bind-dict regression (see conftest helper)."""
    from conftest import assert_module_aql_fakes_faithful

    assert_module_aql_fakes_faithful(Path(__file__))
