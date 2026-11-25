# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The ArangoDB retrieval adapter: the dense/BM25/fusion/enrichment stages.

Ports the recorded retrieval stages of the query path:

* **Dense retrieval** — brute-force cosine over ``<GRAPH>_SOURCE`` (the
  deployed ``use_approx_search=false`` makes it an exact scan: the vector
  index dataprep builds is not consulted on the query path). The recorded
  call is ``asimilarity_search_with_relevance_scores`` (langchain-arangodb
  1.2.0, COSINE, relevance = identity): the AQL takes the top ``k`` by
  ``COSINE_SIMILARITY`` descending — the label clause applies BEFORE the
  ``LIMIT`` — and the ``score_threshold`` filters the top-``k`` AFTER the
  cut, in Python. Reordering those two steps would change the result set.
* **BM25 leg** — an ArangoSearch view ``<GRAPH>_BM25_VIEW`` over the chunk
  ``text`` (+ ``chunk_labels``), created lazily on first use and cached on
  success only. The view tokenizes the RAW query (never the prefixed one).
  Any leg error is logged and the leg returns ``[]`` — never raised.
* **RRF fusion** — weighted Reciprocal Rank Fusion over the chunk ``_key``,
  per-channel de-duplication keeping the best rank, insertion-order ties
  (favouring the dense channel), fused list truncated to ``k``. A fusion
  error falls back to the dense-only list.
* **Label filter + post-filter** — the same AND/OR strategy applied twice:
  as an AQL clause inside both legs, and again in Python per result row
  (defense in depth; the database-side filter is not trusted on its own).
  NOTE the recorded quirk: the deployed dense results carry NO
  ``chunk_labels`` (langchain-arangodb returns empty metadata for them), so
  the dense-leg post-filter drops EVERY dense result when a label filter is
  active — reproduced faithfully, not fixed.
* **file_id enrichment** — ONE batched AQL for all surviving chunks;
  ``file_ids`` is ``[file_id]`` or ``[]``, never null and never missing.
* **CAP-1 identity join** — ``okf_concepts_meta`` joined on
  ``(graph_name, concept_id = chunk file_id)``; an absent identity document
  leaves the chunk unattributed with no warning; a failing join skips the
  whole enrichment with an ERROR log and never breaks the leg.

Graph traversal, multi-graph fan-out and the routing gate are recorded in
the recorded traversal/fan-out/routing stages are NOT part of this port (the frozen enumeration
stops at the stages above).
"""

import asyncio
import logging
from dataclasses import dataclass, field

from .env_config import ArangoConfig, HybridConfig

logger = logging.getLogger(__name__)

ARANGO_TEXT_FIELD = "text"
ARANGO_EMBEDDING_FIELD = "embedding"
ARANGO_FILE_ID_FIELD = "file_id"
OKF_CONCEPTS_META_COLLECTION = "okf_concepts_meta"


def _materialized_rows(db, aql, bind_vars) -> list:
    """Run one AQL and return its rows as a plain list.

    Runs inside an ``asyncio.to_thread`` worker: python-arango answers with a
    lazy Cursor, so draining it on the event loop would turn every batch past
    the first into a blocking network call on the loop. Every AQL read in
    this module materializes through this helper (the chunks.py ``_run``
    idiom).
    """
    return list(db.aql.execute(aql, bind_vars=bind_vars))


def _escape_aql_string(value) -> str:
    """Escape a value for interpolation into an AQL string literal.

    A label is DATA, but it is interpolated into AQL TEXT: a double quote in a
    label would close the string literal and the rest of the label would be
    read as AQL. The backslash is escaped FIRST because it is AQL's own escape
    character — doubling it before the quote keeps the two escapes
    independent. A raw newline, CR or tab breaks the AQL string literal the
    same way a quote does.
    """
    escaped = str(value).replace("\\", "\\\\").replace('"', '\\"')
    return escaped.replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t")


def build_aql_filter_clause(labels_to_filter, filter_strategy) -> str:
    """Build the AQL ``FILTER`` clause for the given labels + strategy.

    Returns ``""`` when no labels are requested — no clause is emitted at all.
    """
    if not labels_to_filter:
        return ""
    labels_array = "[" + ", ".join(f'"{_escape_aql_string(label)}"' for label in labels_to_filter) + "]"
    if filter_strategy == "AND":
        return f"FILTER (doc.chunk_labels != null) AND ({labels_array} ALL IN doc.chunk_labels)"
    if filter_strategy == "OR":
        return f"FILTER (doc.chunk_labels != null) AND ({labels_array} ANY IN doc.chunk_labels)"
    raise ValueError(f"Invalid filter_strategy: {filter_strategy}. Expected one of AND, OR.")


def chunk_passes_label_filter(chunk_labels, labels_to_filter, filter_strategy) -> bool:
    """Replicate the dense-path AQL label filter in Python (defense in depth).

    A chunk passes when its ``chunk_labels`` satisfies the requested labels
    under the given strategy: ``AND`` = all required labels present, ``OR`` =
    any one. No requested labels (or empty) means "no filter" → always
    passes; a chunk with no labels is dropped whenever a filter is active.
    """
    if not labels_to_filter:
        return True
    if not chunk_labels:
        return False
    if str(filter_strategy).upper() == "AND":
        return all(label in chunk_labels for label in labels_to_filter)
    return any(label in chunk_labels for label in labels_to_filter)


def normalize_chunk_id(chunk_id) -> str | None:
    """Normalize a chunk's identity to its bare ArangoDB ``_key``.

    The dense channel returns bare keys; this defends against the
    ``COLLECTION/_key`` form and a missing id so cross-channel fusion never
    mis-merges or silently drops a document.
    """
    if chunk_id is None:
        return None
    return str(chunk_id).rsplit("/", 1)[-1]


def rrf_fuse(dense, bm25, k=60, dense_weight=1.0, lexical_weight=1.0):
    """Fuse dense + BM25 result lists via weighted Reciprocal Rank Fusion.

    Pure function — no I/O. Each input element is ``{"doc": row-dict,
    "score": float}`` where the row-dict carries at least ``"key"``; the
    chunk identity is the normalized ``key``. A document present in both
    channels receives both rank contributions; a document in only one
    receives that single contribution. Within a channel, duplicate identities
    are de-duplicated (best rank kept). A row whose key cannot be normalized
    is kept standalone (never dropped, never mis-merged).

    Returns a NEW list sorted by fused score descending; ties keep insertion
    order, which favours the dense channel (Python's sort is stable and the
    dense channel is inserted first).
    """
    scores: dict[str, dict] = {}
    none_counter = 0
    for channel, weight in ((dense, dense_weight), (bm25, lexical_weight)):
        seen: set[str] = set()
        rank = 0
        for item in channel:
            chunk_id = normalize_chunk_id(getattr(item["doc"], "key", None))
            if chunk_id is None:
                # Unkeyed doc: keep it standalone so it is neither dropped nor
                # mis-merged with other unkeyed docs.
                chunk_id = f"__unkeyed_{none_counter}"
                none_counter += 1
            if chunk_id in seen:
                continue  # de-dup within a channel (keep best rank)
            seen.add(chunk_id)
            rank += 1
            entry = scores.setdefault(chunk_id, {"doc": item["doc"], "score": 0.0})
            entry["score"] += weight / (k + rank)
    return sorted(scores.values(), key=lambda x: x["score"], reverse=True)


@dataclass
class RetrievedChunk:
    """One retrieval candidate as the adapters pass it around.

    ``chunk_labels`` mirrors what the recorded channels carry: the BM25 leg
    returns the chunk's labels (the view indexes them); the dense leg's
    results carry NO labels (the recorded empty-metadata quirk), which is
    why a label filter drops every dense result — the post-filter sees
    ``None`` where a filter is active.
    """

    key: str
    text: str
    score: float
    chunk_labels: list | None = None
    file_ids: list = field(default_factory=list)
    repo_id: str | None = None
    bundle_version: int | None = None
    graph_name: str | None = None
    # The chunk's stored vector, carried only by the dense leg (the BM25 view
    # does not return it). Feeds the adaptive selection's validity check
    # exactly as the deployed propagation chain does.
    embedding: list | None = None


class ArangoRetrievalAdapter:
    """Runs the recorded retrieval stages against one ArangoDB database.

    ``graph_name`` selects the leg's graph: the ``<graph>_SOURCE`` collection,
    the ``<graph>_BM25_VIEW`` view and the CAP-1 join's ``@graph_name`` bind
    all derive from it — NOT from the env ``ARANGO_GRAPH_NAME``, which is only
    the default for the single-graph deployment. Every blocking driver call
    runs via ``asyncio.to_thread`` so the event loop never blocks on ArangoDB.
    """

    def __init__(
        self,
        db,
        arango_config: ArangoConfig,
        hybrid_config: HybridConfig,
        graph_name: str | None = None,
        ensured_bm25_views: set[str] | None = None,
    ):
        self._db = db
        self._config = arango_config
        self._hybrid = hybrid_config
        self.graph_name = graph_name or arango_config.graph_name
        # Shared across the legs of a capability so the ensured-view cache
        # spans requests (the per-leg adapter instance is rebuilt per leg).
        self._bm25_views_ensured = ensured_bm25_views if ensured_bm25_views is not None else set()
        # The recorded degradations, tracked for the caller's outcome mapping:
        # the BM25 channel failing degrades the leg to dense-only; the CAP-1
        # join failing leaves chunks unattributed. Neither breaks the leg
        # — but the contract reports the partial dependency
        # unavailability as a degraded answer instead of swallowing it.
        self.bm25_degraded = False
        self.cap1_degraded = False

    @property
    def collection_name(self) -> str:
        return f"{self.graph_name}_SOURCE"

    # ------------------------------------------------------------------
    # Dense leg
    # ------------------------------------------------------------------

    async def dense_search(self, embedding: list[float], labels_to_filter: list, filter_strategy: str) -> list:
        """The recorded dense leg: brute-force cosine, threshold AFTER the top-k cut.

        The AQL reproduces the recorded ``asimilarity_search_with_relevance_scores``
        semantics for COSINE + ``use_approx=false``: filter clause before the
        sort, ``COSINE_SIMILARITY`` as the score, descending, ``LIMIT k`` —
        then the ``score_threshold`` drop in Python (the relevance function
        is the identity for COSINE, so the recorded "relevance score" IS the
        cosine similarity). Every returned chunk carries NO ``chunk_labels``
        — the recorded dense-metadata quirk that the post-filter below
        reproduces.
        """
        filter_clause = build_aql_filter_clause(labels_to_filter, filter_strategy)
        aql = f"""
            FOR doc IN @@collection
                {filter_clause}
                LET score = COSINE_SIMILARITY(doc.{ARANGO_EMBEDDING_FIELD}, @embedding)
                SORT score DESC
                LIMIT @k
                RETURN {{
                    "key": doc._key,
                    "text": doc.{ARANGO_TEXT_FIELD},
                    "embedding": doc.{ARANGO_EMBEDDING_FIELD},
                    "score": score
                }}
        """
        bind_vars = {
            "@collection": self.collection_name,
            "embedding": embedding,
            "k": self._config.k,
        }
        try:
            rows = await asyncio.to_thread(_materialized_rows, self._db, aql, bind_vars)
        except Exception as e:
            logger.error(f"Error during similarity search: {e}")
            return []
        # A chunk without an embedding (partially indexed collection) makes
        # COSINE_SIMILARITY return null — the row cannot be scored, so it is
        # not a dense candidate: skip it and let the remaining rows (or the
        # BM25 leg) carry the result. Skipping is safe AFTER the LIMIT
        # because null sorts LAST under SORT score DESC: a null row only
        # enters the top-k when fewer than k scored rows exist, so the skip
        # can never evict a scored candidate.
        results = []
        for row in rows:
            raw_score = row.get("score")
            if raw_score is None:
                continue
            score = float(raw_score)
            results.append(
                {
                    "doc": RetrievedChunk(
                        key=row["key"],
                        text=row.get("text") or "",
                        score=score,
                        embedding=row.get("embedding"),
                    ),
                    "score": score,
                }
            )
        if skipped := len(rows) - len(results):
            logger.warning(
                f"dense_search skipped {skipped} unscoreable row(s) (null embedding) on '{self.collection_name}'"
            )
        # The recorded wrapper applies score_threshold AFTER the top-k cut.
        results = [r for r in results if r["score"] >= self._config.score_threshold]
        # Defense-in-depth label filter on the DENSE results. The recorded
        # dense rows carry no chunk_labels, so with a filter active every
        # dense result is dropped — reproduced, not fixed.
        if labels_to_filter and results:
            results = [
                r
                for r in results
                if chunk_passes_label_filter(r["doc"].chunk_labels, labels_to_filter, filter_strategy)
            ]
        return results

    # ------------------------------------------------------------------
    # BM25 leg
    # ------------------------------------------------------------------

    async def _ensure_bm25_view(self, graph_name: str) -> None:
        """Idempotently create the ArangoSearch BM25 view over ``<graph>_SOURCE.text``.

        Best-effort: never raises. Cached on SUCCESS only, so a transient
        failure is retried on the next request rather than silently disabling
        the BM25 channel forever.
        """
        if graph_name in self._bm25_views_ensured:
            return
        view_name = f"{graph_name}_BM25_VIEW"
        collection = f"{graph_name}_SOURCE"
        try:
            existing_views = {v.get("name") for v in (await asyncio.to_thread(self._db.views) or [])}
            if view_name not in existing_views:
                properties = {
                    "links": {
                        collection: {
                            "analyzers": [self._hybrid.bm25_analyzer],
                            "fields": {
                                ARANGO_TEXT_FIELD: {},
                                "chunk_labels": {},
                            },
                            "includeAllFields": False,
                            "storeValues": "none",
                        }
                    }
                }
                await asyncio.to_thread(self._db.create_arangosearch_view, view_name, properties)
                logger.info(f"Created ArangoSearch BM25 view '{view_name}' on collection '{collection}'.")
            self._bm25_views_ensured.add(graph_name)
        except Exception as e:
            logger.error(f"Failed to ensure BM25 view '{view_name}': {e}")

    async def bm25_search(self, query: str, graph_name: str, labels_to_filter: list, filter_strategy: str) -> list:
        """Run a BM25 lexical search over the chunk view, as the record measures it.

        Tokenizes the RAW query (never the prefixed one). The candidate cap
        is ``max(k, RETRIEVER_HYBRID_BM25_CANDIDATES)``. The label clause is
        injected pre-``LIMIT``, and every returned row is re-checked in
        Python. Never raises — logs and returns ``[]``.
        """
        await self._ensure_bm25_view(graph_name)
        view_name = f"{graph_name}_BM25_VIEW"
        n = max(self._config.k, self._hybrid.bm25_candidates)
        filter_clause = build_aql_filter_clause(labels_to_filter, filter_strategy)
        aql = f"""
            FOR doc IN `{view_name}`
                SEARCH ANALYZER(doc.{ARANGO_TEXT_FIELD} IN TOKENS(@query, @analyzer), @analyzer)
                {filter_clause}
                LET _bm25_score = BM25(doc)
                SORT _bm25_score DESC
                LIMIT @n
                RETURN {{
                    "key": doc._key,
                    "text": doc.{ARANGO_TEXT_FIELD},
                    "chunk_labels": doc.chunk_labels,
                    "score": _bm25_score
                }}
        """
        bind_vars = {"query": query, "analyzer": self._hybrid.bm25_analyzer, "n": n}
        results = []
        try:
            rows = await asyncio.to_thread(_materialized_rows, self._db, aql, bind_vars)
            for row in rows:
                chunk_labels = row.get("chunk_labels")
                if not chunk_passes_label_filter(chunk_labels, labels_to_filter, filter_strategy):
                    continue
                doc = RetrievedChunk(
                    key=row.get("key"),
                    text=row.get("text") or "",
                    score=float(row.get("score") or 0.0),
                    chunk_labels=chunk_labels,
                )
                results.append({"doc": doc, "score": float(row.get("score") or 0.0)})
        except Exception as e:
            logger.error(f"BM25 search failed on view '{view_name}': {e}")
            self.bm25_degraded = True
        return results

    # ------------------------------------------------------------------
    # Fusion
    # ------------------------------------------------------------------

    async def fused_candidates(self, embedding: list[float], raw_query: str, labels_to_filter: list) -> list:
        """The recorded retrieval assembly: dense + BM25 → RRF → truncate to k.

        The fusion runs BEFORE the empty check, so a BM25 hit can rescue a
        dense-empty result. ``RETRIEVER_HYBRID_RETRIEVAL_ENABLED=false`` is a
        true no-op (dense only). A fusion error falls back to the dense-only
        list with the recorded log line.
        """
        filter_strategy = self._config.filter_strategy
        dense_res = await self.dense_search(embedding, labels_to_filter, filter_strategy)
        dense_count = len(dense_res)
        bm25_count = None
        search_res = dense_res
        if self._hybrid.enabled:
            try:
                bm25_res = await self.bm25_search(raw_query, self.graph_name, labels_to_filter, filter_strategy)
                bm25_count = len(bm25_res)
                if bm25_res:
                    fused_all = rrf_fuse(
                        dense_res,
                        bm25_res,
                        k=self._hybrid.rrf_k,
                        dense_weight=self._hybrid.dense_weight,
                        lexical_weight=self._hybrid.lexical_weight,
                    )
                    search_res = fused_all[: self._config.k]
                    logger.info(f"Hybrid RRF fusion: {len(search_res)} documents after fusing dense + BM25.")
            except Exception as e:
                # The dense-only fallback is a real degradation of the hybrid
                # channel, same class as the leg failure above — flagged so the
                # caller maps the answer onto degraded_availability.
                logger.error(f"Hybrid BM25+RRF fusion failed, falling back to dense-only: {e}")
                self.bm25_degraded = True
        logger.info(
            f"Extraction summary — graph={self.graph_name}, dense={dense_count}, "
            f"bm25={bm25_count}, fused={len(search_res)}, labels={labels_to_filter or []}, "
            f"filter_strategy={filter_strategy}"
        )
        if not search_res:
            logger.info("No documents found.")
            return search_res
        # The recorded order: fusion → empty check → file_id + CAP-1 enrichment.
        await self.enrich(search_res)
        return search_res

    # ------------------------------------------------------------------
    # Enrichment
    # ------------------------------------------------------------------

    async def enrich(self, results: list) -> None:
        """file_id enrichment + the CAP-1 identity join, in place, as the record measures them.

        ONE batched AQL resolves every chunk's ``file_id``; ``file_ids``
        becomes ``[file_id]`` or ``[]`` — never null, never a missing
        attribute. The CAP-1 join then resolves ``repo_id`` +
        ``bundle_version`` from ``okf_concepts_meta``; an absent identity
        document leaves the chunk unattributed with no warning, and a failing
        join (collection absent, transient DB error) skips the whole
        enrichment with an ERROR log — the leg is never broken.
        """
        chunk_ids = [r["doc"].key for r in results if r["doc"].key]
        if not chunk_ids:
            return
        try:
            aql = f"""
                FOR doc IN `{self.collection_name}`
                    FILTER doc._key IN @chunk_ids
                    RETURN {{key: doc._key, file_id: doc.{ARANGO_FILE_ID_FIELD}}}
            """
            rows = await asyncio.to_thread(_materialized_rows, self._db, aql, {"chunk_ids": chunk_ids})
            file_id_by_key = {row["key"]: row["file_id"] for row in rows}
            for r in results:
                fid = file_id_by_key.get(r["doc"].key)
                r["doc"].file_ids = [fid] if fid else []
        except Exception as e:
            # The enrichment failing wholesale leaves the chunks unattributed;
            # the recorded behavior logs and continues on the CAP-1 join only —
            # the file_id leg is the chunk's core identity, so its failure is
            # a failed retrieval (the caller maps it onto a transient failure).
            logger.error(f"file_id enrichment failed: {e}")
            raise
        try:
            identity_aql = f"""
                FOR doc IN `{self.collection_name}`
                    FILTER doc._key IN @chunk_ids
                    LET meta = FIRST(
                        FOR m IN {OKF_CONCEPTS_META_COLLECTION}
                            FILTER m.graph_name == @graph_name
                                AND m.concept_id == doc.{ARANGO_FILE_ID_FIELD}
                            RETURN m
                    )
                    RETURN {{key: doc._key, repo_id: meta.repo_id, bundle_version: meta.bundle_version}}
            """
            identity_rows = await asyncio.to_thread(
                _materialized_rows,
                self._db,
                identity_aql,
                {"chunk_ids": chunk_ids, "graph_name": self.graph_name},
            )
            identity_by_key = {row["key"]: row for row in identity_rows}
            for r in results:
                ident = identity_by_key.get(r["doc"].key) or {}
                if ident.get("repo_id"):
                    r["doc"].repo_id = ident["repo_id"]
                if ident.get("bundle_version") is not None:
                    r["doc"].bundle_version = ident["bundle_version"]
        except Exception as e:
            logger.error(f"OKF identity enrichment failed (chunk identity left as-is): {e}")
            self.cap1_degraded = True
