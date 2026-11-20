# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The frozen env-knob surface of the search adapters.

Every knob the V02 record lists (``docs/baselines/v02-opea-query-path-contract.md``
§3, §6) is read here under the SAME name with the SAME code default, so a
deployment that tunes the legacy path tunes this port identically. The values
recorded as deployed are the ones the record measured; the values recorded as
code defaults apply when the env does not set the knob.

Configuration errors crash at adapter construction, exactly as the deployed
retriever crashes at import for the same class of error (V02 §4.4: an invalid
``RETRIEVER_ARANGO_FILTER_STRATEGY`` raises ``ValueError`` at import, the pod
crash-loops, and the client sees 503 — never a request-time 400).

Two knobs are read and deliberately unused, because that is what the record
says about them (§6):

* ``RETRIEVER_ARANGO_DISTANCE_THRESHOLD`` — forwarded on the deployed stack
  but read by nobody;
* ``RETRIEVER_ARANGO_FETCH_K`` — consulted only by the ``mmr`` search mode,
  which the deployed search mode (``vector``) never selects.
"""

import os
from dataclasses import dataclass

# The deployment surfaces the record defines behavior for. A value outside
# them is a configuration error at load, not a request-time fallback: the
# record records no behavior for the others.
SEARCH_MODE = "vector"
SEARCH_START = "chunk"
DISTANCE_STRATEGIES = ("COSINE",)
FILTER_STRATEGIES = ("AND", "OR")


@dataclass(frozen=True)
class ArangoConfig:
    """The ArangoDB connection and retrieval knobs (V02 §3.1)."""

    url: str
    username: str
    password: str | None
    database: str
    graph_name: str
    search_mode: str
    search_start: str
    distance_strategy: str
    use_approx_search: bool
    k: int
    score_threshold: float
    num_centroids: int
    filter_strategy: str

    @classmethod
    def load(cls, env=None) -> "ArangoConfig":
        """Read the knobs from the environment and validate the recorded surface.

        ``env`` defaults to ``os.environ``; tests pass a mapping.
        """
        source = os.environ if env is None else env
        search_mode = str(source.get("RETRIEVER_ARANGO_SEARCH_MODE", SEARCH_MODE))
        if search_mode != SEARCH_MODE:
            raise ValueError(
                f"RETRIEVER_ARANGO_SEARCH_MODE must be {SEARCH_MODE!r} (the mode the record "
                f"defines behavior for), got {search_mode!r}"
            )
        search_start = str(source.get("RETRIEVER_ARANGO_SEARCH_START", SEARCH_START))
        if search_start != SEARCH_START:
            raise ValueError(
                f"RETRIEVER_ARANGO_SEARCH_START must be {SEARCH_START!r} (the mode the record "
                f"defines behavior for), got {search_start!r}"
            )
        distance_strategy = str(source.get("RETRIEVER_ARANGO_DISTANCE_STRATEGY", "COSINE"))
        if distance_strategy not in DISTANCE_STRATEGIES:
            raise ValueError(
                f"RETRIEVER_ARANGO_DISTANCE_STRATEGY must be one of {', '.join(DISTANCE_STRATEGIES)}, "
                f"got {distance_strategy!r}"
            )
        filter_strategy = str(source.get("RETRIEVER_ARANGO_FILTER_STRATEGY", "OR")).strip().upper()
        if filter_strategy not in FILTER_STRATEGIES:
            raise ValueError(
                f"RETRIEVER_ARANGO_FILTER_STRATEGY must be one of {', '.join(FILTER_STRATEGIES)}, "
                f"got {filter_strategy!r}"
            )
        return cls(
            url=str(source.get("ARANGO_URL", "http://localhost:8529")),
            username=str(source.get("ARANGO_USERNAME", "root")),
            password=source.get("ARANGO_PASSWORD"),
            database=str(source.get("ARANGO_DB", "genie-ai")),
            graph_name=str(source.get("ARANGO_GRAPH_NAME", "GRAPH")),
            search_mode=search_mode,
            search_start=search_start,
            distance_strategy=distance_strategy,
            use_approx_search=str(source.get("RETRIEVER_ARANGO_USE_APPROX_SEARCH", "false")).lower() == "true",
            # The record's discrepancy table: the deployed value is 20, the
            # code default 4. The code default is what applies here.
            k=int(source.get("RETRIEVER_ARANGO_K", 4)),
            score_threshold=float(source.get("RETRIEVER_ARANGO_SCORE_THRESHOLD", 0.1)),
            num_centroids=int(source.get("RETRIEVER_ARANGO_NUM_CENTROIDS", 1)),
            filter_strategy=filter_strategy,
        )


@dataclass(frozen=True)
class HybridConfig:
    """The BM25 + RRF lexical channel (V02 §4.2, §4.3)."""

    enabled: bool
    rrf_k: int
    bm25_candidates: int
    dense_weight: float
    lexical_weight: float
    bm25_analyzer: str

    @classmethod
    def load(cls, env=None) -> "HybridConfig":
        source = os.environ if env is None else env
        return cls(
            enabled=str(source.get("RETRIEVER_HYBRID_RETRIEVAL_ENABLED", "true")).lower() == "true",
            rrf_k=int(source.get("RETRIEVER_HYBRID_RRF_K", "60")),
            bm25_candidates=int(source.get("RETRIEVER_HYBRID_BM25_CANDIDATES", "50")),
            dense_weight=float(source.get("RETRIEVER_HYBRID_DENSE_WEIGHT", "1.0")),
            lexical_weight=float(source.get("RETRIEVER_HYBRID_LEXICAL_WEIGHT", "1.0")),
            bm25_analyzer=str(source.get("RETRIEVER_HYBRID_BM25_ANALYZER", "text_en")),
        )


@dataclass(frozen=True)
class RerankingConfig:
    """The reranking and evidence-selection knobs (V02 §4.13).

    An invalid ``RERANKING_STRATEGY`` is NOT a boot error: the deployed
    resolver falls back to ``slice`` with a warning at request time, and this
    port reproduces that (``resolve_strategy``).
    """

    strategy: str
    threshold: float
    top_n: int
    calibration: str
    temperature: float
    rerank_timeout_seconds: float
    connect_timeout_seconds: float

    @classmethod
    def load(cls, env=None) -> "RerankingConfig":
        source = os.environ if env is None else env
        return cls(
            strategy=str(source.get("RERANKING_STRATEGY", "slice")),
            threshold=float(source.get("RERANKING_THRESHOLD", 0.75)),
            top_n=int(source.get("RERANKER_TOP_N", 3)),
            calibration=str(source.get("RERANKER_SCORE_CALIBRATION", "none")).strip().lower(),
            temperature=float(source.get("RERANKER_SCORE_TEMPERATURE", "1.0") or "1.0"),
            # The shared model HTTP policy the deployed reranker reads
            # (core/model_http_policy.py): the rerank budget is 300 s total,
            # the connect timeout 30 s, and there is no retry.
            rerank_timeout_seconds=float(source.get("MODEL_RERANK_TIMEOUT_SECONDS", 300.0)),
            connect_timeout_seconds=float(source.get("MODEL_CONNECT_TIMEOUT_SECONDS", 30.0)),
        )

    def resolve_strategy(self, requested: str | None, log=None) -> str:
        """Return the strategy that will actually run, given the request's value.

        Ported from the deployed ``resolve_reranking_strategy``: an unknown or
        empty name resolves to the deployment default; an invalid default
        falls back to ``slice`` with a warning — what the span (and here the
        log) reports is what the code below it does.
        """
        strategies = ("slice", "threshold", "slice_threshold", "knee_threshold", "adaptive")
        resolved_default = self.strategy or "slice"
        if resolved_default not in strategies:
            if log is not None:
                log.warning(f"RERANKING_STRATEGY={resolved_default!r} is not a known strategy. Falling back to slice.")
            resolved_default = "slice"
        if requested and requested in strategies:
            return requested
        if requested and log is not None:
            log.warning(f"Unknown strategy {requested[:64]!r}. Defaulting to {resolved_default}.")
        return resolved_default


@dataclass(frozen=True)
class ModelEndpointConfig:
    """The model-service endpoints the adapters call directly (V02 §3.3).

    ``TEI_EMBEDDING_ENDPOINT`` is the full embed URL the deployment already
    serves (the recorded value ends in ``/embed``). ``TEI_RERANKING_ENDPOINT``
    is the reranker's TEI base URL — the chart templates it for the deployed
    reranker container, and the port reads the same knob for its ``/rerank``
    call.
    """

    tei_embedding_endpoint: str
    tei_reranking_endpoint: str

    @classmethod
    def load(cls, env=None) -> "ModelEndpointConfig":
        source = os.environ if env is None else env
        return cls(
            tei_embedding_endpoint=str(source.get("TEI_EMBEDDING_ENDPOINT", "")),
            tei_reranking_endpoint=str(source.get("TEI_RERANKING_ENDPOINT", "")),
        )
