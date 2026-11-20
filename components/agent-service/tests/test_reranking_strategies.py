# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The TEI reranking and evidence-selection behaviors, asserted against V02 §4.13/§4.14.

Every strategy's cutoff/ordering, the recorded TEI call shape, and one test
per reranker-down failure mode.
"""

import asyncio
import json

import httpx
import pytest

from capabilities.adapters.env_config import RerankingConfig
from capabilities.adapters.tei_reranking import (
    RerankerInputTooLongError,
    TeiRerankingAdapter,
    adaptive_context_selection,
)

# TEI answers score-descending [{index, score}].
TEI_RESPONSE = [
    {"index": 2, "score": 0.9},
    {"index": 0, "score": 0.6},
    {"index": 1, "score": 0.1},
    {"index": 3, "score": -0.2},
]
TEXTS = ["t0", "t1", "t2", "t3"]


def make_adapter(strategy="slice", top_n=3, threshold=0.75, handler=None, calibration="none", temperature=1.0):
    config = RerankingConfig(
        strategy=strategy,
        threshold=threshold,
        top_n=top_n,
        calibration=calibration,
        temperature=temperature,
        rerank_timeout_seconds=300.0,
        connect_timeout_seconds=30.0,
    )
    if handler is None:

        def handler(request: httpx.Request) -> httpx.Response:
            captured["request"] = request
            return httpx.Response(200, json=TEI_RESPONSE)

    captured: dict = {}
    adapter = TeiRerankingAdapter("https://tei.invalid", config, transport=httpx.MockTransport(handler))
    adapter.captured = captured
    return adapter


def rerank(adapter, texts=TEXTS, **kwargs):
    return asyncio.run(adapter.rerank("q", texts, **kwargs))


# ---------------------------------------------------------------------
# The recorded TEI call shape
# ---------------------------------------------------------------------


def test_tei_call_carries_the_recorded_body_and_no_auth_header():
    adapter = make_adapter()
    rerank(adapter)
    request = adapter.captured["request"]
    assert request.url.path == "/rerank"
    body = json.loads(request.read())
    assert body == {"query": "q", "texts": TEXTS, "truncate": False}
    assert "authorization" not in {k.lower() for k in request.headers}


# ---------------------------------------------------------------------
# The five strategies (V02 §4.13 table)
# ---------------------------------------------------------------------


def test_slice_keeps_the_first_top_n_entries_in_tei_order():
    outcome = rerank(make_adapter(strategy="slice", top_n=2))
    assert [(s.text, s.score) for s in outcome.selection] == [("t2", 0.9), ("t0", 0.6)]
    assert [s.position for s in outcome.selection] == [2, 0]


def test_threshold_keeps_every_doc_at_or_above_the_threshold():
    outcome = rerank(make_adapter(strategy="threshold", threshold=0.5))
    assert [(s.text, s.score) for s in outcome.selection] == [("t2", 0.9), ("t0", 0.6)]


def test_threshold_is_not_capped_by_top_n():
    outcome = rerank(make_adapter(strategy="threshold", threshold=0.05, top_n=1))
    assert [(s.text, s.score) for s in outcome.selection] == [("t2", 0.9), ("t0", 0.6), ("t1", 0.1)]


def test_slice_threshold_keeps_above_threshold_capped_at_top_n():
    outcome = rerank(make_adapter(strategy="slice_threshold", threshold=0.05, top_n=2))
    assert [(s.text, s.score) for s in outcome.selection] == [("t2", 0.9), ("t0", 0.6)]


def test_slice_threshold_breaks_at_the_first_below_threshold():
    outcome = rerank(make_adapter(strategy="slice_threshold", threshold=0.3, top_n=5))
    # 0.6 >= 0.3 then 0.1 < 0.3 breaks — the -0.2 tail is never consulted.
    assert [(s.text, s.score) for s in outcome.selection] == [("t2", 0.9), ("t0", 0.6)]


def test_knee_threshold_keeps_the_leading_entries_up_to_the_knee():
    # A convex decreasing curve with a clear knee. The selection must be the
    # first knee+1 entries of the score curve (V02 §4.13: knee_threshold
    # keeps the knee+1 leading entries; RERANKING_THRESHOLD is not consulted).
    from kneed import KneeLocator

    scores_curve = [0.95, 0.9, 0.2, 0.15, 0.1]
    response = [{"index": i, "score": s} for i, s in enumerate(scores_curve)]
    texts = ["a", "b", "c", "d", "e"]

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=response)

    kneedle = KneeLocator(list(range(len(scores_curve))), scores_curve, curve="convex", direction="decreasing")
    expected_cutoff = kneedle.knee + 1

    adapter = make_adapter(strategy="knee_threshold", handler=handler)
    outcome = rerank(adapter, texts=texts)
    assert [s.score for s in outcome.selection] == scores_curve[:expected_cutoff]
    # knee_threshold never consults the threshold (the config's 0.75 would
    # cut 0.2 — its presence in the selection proves the threshold is inert).
    assert 0.2 in [s.score for s in outcome.selection]


def test_adaptive_selects_by_marginal_value_and_hard_fails_without_embeddings():
    query_embedding = [1.0, 0.0]
    chunk_embeddings = [[1.0, 0.0], [0.9, 0.1], [0.0, 1.0], [0.0, 1.0]]
    adapter = make_adapter(strategy="adaptive")
    outcome = rerank(adapter, chunk_embeddings=chunk_embeddings, query_embedding=query_embedding)
    # The top-scored candidate (value > threshold at -1.0 by default may keep
    # several); assert the strongest is selected first and order preserved.
    assert outcome.selection[0].text == "t2"
    assert outcome.selection[0].score == 0.9

    with pytest.raises(RuntimeError, match="ADAPTIVE"):
        rerank(make_adapter(strategy="adaptive"))


def test_unknown_env_strategy_falls_back_to_slice_with_a_warning(caplog):
    config = RerankingConfig(
        strategy="bogus",
        threshold=0.75,
        top_n=3,
        calibration="none",
        temperature=1.0,
        rerank_timeout_seconds=300.0,
        connect_timeout_seconds=30.0,
    )
    adapter = TeiRerankingAdapter("https://tei.invalid", config, transport=httpx.MockTransport(_tei_ok))
    with caplog.at_level("WARNING"):
        outcome = rerank(adapter)
    assert [(s.text, s.score) for s in outcome.selection] == [("t2", 0.9), ("t0", 0.6), ("t1", 0.1)]
    assert any("not a known strategy" in record.message for record in caplog.records)


def _tei_ok(request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, json=TEI_RESPONSE)


# ---------------------------------------------------------------------
# Reranker-down: one behavior per failure mode (V02 §4.14)
# ---------------------------------------------------------------------


def test_http_422_validation_raises_the_typed_too_long_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            422,
            json={"error": "... must have less than 8192 tokens. Given: 19505", "error_type": "Validation"},
        )

    adapter = make_adapter(handler=handler)
    with pytest.raises(RerankerInputTooLongError):
        rerank(adapter)


def test_transport_failure_raises_no_fallback_to_retrieval_order():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    adapter = make_adapter(handler=handler)
    with pytest.raises(httpx.ConnectError):
        rerank(adapter)


def test_other_http_error_raises_runtime_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "overloaded"})

    adapter = make_adapter(handler=handler)
    with pytest.raises(RuntimeError, match="HTTP 500"):
        rerank(adapter)


def test_unexpected_body_raises_runtime_error():
    def handler(request: httpx.Request) -> httpx.Response:
        # HTTP 200 but an error OBJECT, not the scored-list contract.
        return httpx.Response(200, json={"error": "weird"})

    adapter = make_adapter(handler=handler)
    with pytest.raises(RuntimeError, match="unexpected response type"):
        rerank(adapter)


def test_score_count_mismatch_is_not_fatal(caplog):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=TEI_RESPONSE[:2])

    adapter = make_adapter(handler=handler)
    with caplog.at_level("WARNING"):
        outcome = rerank(adapter)
    assert len(outcome.selection) == 2
    assert any("counts differ" in record.message for record in caplog.records)


def test_index_out_of_range_skips_the_document(caplog):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[{"index": 99, "score": 0.9}, {"index": 0, "score": 0.6}])

    adapter = make_adapter(handler=handler)
    with caplog.at_level("ERROR"):
        outcome = rerank(adapter)
    assert [(s.text, s.score) for s in outcome.selection] == [("t0", 0.6)]
    assert any("out of range" in record.message for record in caplog.records)


def test_opaque_error_seen_as_an_empty_result_selects_nothing():
    def handler(request: httpx.Request) -> httpx.Response:
        # The recorded shape: an opaque 5xx that surfaces as an empty scored
        # list — the selection is empty (the caller abstains with
        # reranker_selected_nothing).
        return httpx.Response(200, json=[])

    adapter = make_adapter(handler=handler)
    outcome = rerank(adapter)
    assert outcome.selected_nothing


# ---------------------------------------------------------------------
# Calibration — confidence time only (V02 §4.13)
# ---------------------------------------------------------------------


def test_calibration_none_returns_the_raw_score_and_selection_stays_raw():
    adapter = make_adapter(calibration="none")
    assert adapter.calibrate(0.674801) == 0.674801
    outcome = rerank(adapter)
    assert outcome.selection[0].score == 0.9


def test_calibration_sigmoid_maps_for_confidence_without_touching_selection():
    adapter = make_adapter(calibration="sigmoid", temperature=1.0)
    calibrated = adapter.calibrate(0.0)
    assert calibrated == 0.5
    extreme = adapter.calibrate(-10000.0)
    assert 0.0 <= extreme <= 1.0
    # The selection comparison is unaffected: raw scores flow through.
    outcome = rerank(adapter)
    assert outcome.selection[0].score == 0.9


def test_adaptive_breakdown_records_every_term():
    selected, breakdown = adaptive_context_selection(
        texts=["aaaa", "bb"],
        chunk_embeddings=[[1.0, 0.0], [0.0, 1.0]],
        query_embedding=[1.0, 0.0],
        reranker_scores=[0.9, 0.5],
    )
    assert len(breakdown) == 2
    for record in breakdown:
        assert set(record) == {
            "idx",
            "score",
            "relevance",
            "novelty",
            "novelty_weight",
            "utility",
            "token_count",
            "context_decay_cost",
            "confusion_cost",
            "total_cost",
            "value",
            "selected",
        }
    assert breakdown[0]["selected"] is True
