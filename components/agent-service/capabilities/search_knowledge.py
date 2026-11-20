# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The ``search_knowledge`` operation: the OPEA-free port of the recorded query path.

Implements the contract's ``DocumentCapabilityPort.search_knowledge`` on top
of the adapters. The behavior is frozen to the V02 record
(``docs/baselines/v02-opea-query-path-contract.md``); the structure is free
(clean-slate per the architecture spine's AD-10).

The recorded pipeline, as executed here:

1. the caller context is validated (at least one authorized graph — nothing
   authorized means nothing searchable, an authorization failure);
2. the prepared query is embedded through the model-specific instruction
   contract (the PREFIXED text goes to the embedder; the RAW text goes to
   the BM25 leg);
3. per authorized graph (in context order): dense cosine + BM25 → RRF →
   truncate to k → file_id enrichment → CAP-1 identity join;
4. one reranking stage over the union of the graphs' candidates (the
   recorded selection semantics; score-descending order into the result);
5. the outcomes map onto the contract: every recorded empty case
   (``no_documents_retrieved``, ``reranker_selected_nothing``,
   ``reranker_input_too_long``) is an ``insufficient_evidence`` ANSWER with
   its recorded reason kept distinct on the log surface
   (``abstained.reason``), never silently merged; a partial dependency
   degradation (BM25 leg failed, CAP-1 join failed) with hits is a
   ``degraded_availability`` answer; transport and protocol failures raise
   ``TransientError`` — there is no fallback to the retrieval order.

The operation never calls vLLM and never prepares a query: preparation is
the loop's business (story 1.8), and the contract refuses non-prepared
input before this code runs.

Cancellation propagates unchanged: ``asyncio.CancelledError`` is never
caught in this module (the contract's cancellation declaration — a cancelled
operation is neither a failure nor an insufficiency).
"""

import asyncio
import logging

from .adapters.arango_retrieval import ArangoRetrievalAdapter, validate_graph_name
from .adapters.env_config import ArangoConfig, HybridConfig, ModelEndpointConfig, RerankingConfig
from .adapters.tei_embedding import TeiEmbeddingAdapter
from .adapters.tei_reranking import RerankerInputTooLongError, TeiRerankingAdapter
from .contract import (
    AuthorizationError,
    CallerContext,
    LegacyFileProvenance,
    OkfConceptProvenance,
    OperationBudget,
    OperationName,
    OutcomeCode,
    SearchHit,
    SearchKnowledgeInput,
    SearchKnowledgeResult,
    TransientError,
)

logger = logging.getLogger(__name__)

# The recorded English abstention text (V02 §4.14) — the too-long case's
# answer text; who translates it stays with the answer layer, as deployed.
_RERANKER_INPUT_TOO_LONG_ABSTENTION_TEXT = (
    "I cannot reliably answer this query because the "
    "retrieved documents exceed the reranker's input "
    "limit. This indicates a data ingestion issue."
)


class SearchKnowledgeCapability:
    """The port implementation the agent loop talks to.

    The adapters are constructor-injected; ``create()`` assembles the default
    wiring from the environment (the recorded knobs) and a live ArangoDB
    client. The service builds this once at startup — a misconfigured knob
    fails the service at boot, the same crash-loop pattern the deployed
    retriever exhibits at import (V02 §4.4).
    """

    name = OperationName.SEARCH_KNOWLEDGE

    def __init__(
        self,
        embedding: TeiEmbeddingAdapter,
        reranking: TeiRerankingAdapter,
        db_factory,
        arango_config: ArangoConfig,
        hybrid_config: HybridConfig,
    ):
        self._embedding = embedding
        self._reranking = reranking
        # ``db_factory(graph_name)`` returns a database handle for one
        # authorized graph (the driver connection is shared; the handle is
        # the same database object — graph names only select collections).
        self._db_factory = db_factory
        self._arango_config = arango_config
        self._hybrid_config = hybrid_config

    @classmethod
    def create(cls, env=None) -> "SearchKnowledgeCapability":
        """Assemble the default wiring from the environment.

        The driver import lives here, not at module import, so the port
        surface stays import-light for the tests that fake the adapters.
        A missing model endpoint is a boot error: the port has no default
        embedding or reranker endpoint to silently point at.
        """
        import arango

        arango_config = ArangoConfig.load(env)
        hybrid_config = HybridConfig.load(env)
        reranking_config = RerankingConfig.load(env)
        endpoints = ModelEndpointConfig.load(env)
        if not endpoints.tei_embedding_endpoint:
            raise ValueError("TEI_EMBEDDING_ENDPOINT must be set: the port has no default embedding endpoint")
        if not endpoints.tei_reranking_endpoint:
            raise ValueError("TEI_RERANKING_ENDPOINT must be set: the port has no default reranker endpoint")
        client = arango.ArangoClient(hosts=arango_config.url)

        def db_factory(_graph_name: str):
            return client.db(
                arango_config.database,
                username=arango_config.username,
                password=arango_config.password,
            )

        embedding = TeiEmbeddingAdapter(
            endpoints.tei_embedding_endpoint,
            connect_timeout_seconds=reranking_config.connect_timeout_seconds,
            total_timeout_seconds=reranking_config.rerank_timeout_seconds,
        )
        reranking = TeiRerankingAdapter(endpoints.tei_reranking_endpoint, reranking_config)
        return cls(embedding, reranking, db_factory, arango_config, hybrid_config)

    async def search_knowledge(
        self,
        context: CallerContext,
        request: SearchKnowledgeInput,
        budget: OperationBudget,
    ) -> SearchKnowledgeResult:
        """Search the authorized corpus and report what was found."""
        if not context.authorized_graph_names:
            raise AuthorizationError(
                "the caller context authorizes no graph: there is nothing to search",
                operation=OperationName.SEARCH_KNOWLEDGE,
            )
        for graph_name in context.authorized_graph_names:
            validate_graph_name(graph_name)
        try:
            return await asyncio.wait_for(
                self._run(context, request, budget),
                timeout=budget.timeout_ms / 1000.0,
            )
        except TimeoutError as e:
            raise TransientError(
                f"search_knowledge exceeded the operation budget ({budget.timeout_ms} ms)",
                operation=OperationName.SEARCH_KNOWLEDGE,
            ) from e

    async def _run(
        self,
        context: CallerContext,
        request: SearchKnowledgeInput,
        budget: OperationBudget,
    ) -> SearchKnowledgeResult:
        labels = list(context.requested_labels)
        try:
            embedded = await self._embedding.embed(request.query.text)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            # The recorded chat path fails the turn when the embedding stage
            # fails; it never abstains on an embedding error (V02 §4.1).
            raise TransientError(f"the embedding stage failed: {e}", operation=OperationName.SEARCH_KNOWLEDGE) from e

        candidates: list[dict] = []
        degraded = False
        for graph_name in context.authorized_graph_names:
            db = self._db_factory(graph_name)
            adapter = ArangoRetrievalAdapter(db, self._arango_config, self._hybrid_config)
            try:
                leg_results = await adapter.fused_candidates(embedded.embedding, embedded.raw_text, labels)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                # A leg whose database access fails is a failed dependency —
                # the recorded retrieval raises out of the leg (the enrichment
                # AQL runs unguarded in the recorded path).
                raise TransientError(
                    f"the retrieval stage failed on graph {graph_name!r}: {e}",
                    operation=OperationName.SEARCH_KNOWLEDGE,
                ) from e
            if adapter.bm25_degraded or adapter.cap1_degraded:
                degraded = True
            for item in leg_results:
                item["doc"].graph_name = graph_name
            candidates.extend(leg_results)

        if not candidates:
            # The recorded distinct abstention: the retriever returned nothing.
            logger.warning("abstained.reason=no_documents_retrieved")
            return SearchKnowledgeResult(
                outcome=OutcomeCode.INSUFFICIENT_EVIDENCE,
                hits=(),
                truncated=False,
                query_preparation_status=request.query.preparation_status,
            )

        texts = [item["doc"].text for item in candidates]
        try:
            outcome = await self._reranking.rerank(embedded.raw_text, texts)
        except RerankerInputTooLongError:
            # The recorded abstention: TEI rejected the input (422 + Validation).
            logger.warning("abstained.reason=reranker_input_too_long")
            logger.info(_RERANKER_INPUT_TOO_LONG_ABSTENTION_TEXT)
            return SearchKnowledgeResult(
                outcome=OutcomeCode.INSUFFICIENT_EVIDENCE,
                hits=(),
                truncated=False,
                query_preparation_status=request.query.preparation_status,
            )
        except asyncio.CancelledError:
            raise
        except Exception as e:
            # No fallback to the retrieval order: a reranker transport or
            # protocol failure fails the turn (V02 §4.14).
            raise TransientError(f"the reranking stage failed: {e}", operation=OperationName.SEARCH_KNOWLEDGE) from e
        if outcome.selected_nothing:
            # The recorded abstention, distinct from empty retrieval.
            logger.warning("abstained.reason=reranker_selected_nothing")
            return SearchKnowledgeResult(
                outcome=OutcomeCode.INSUFFICIENT_EVIDENCE,
                hits=(),
                truncated=False,
                query_preparation_status=request.query.preparation_status,
            )

        # Map the selected positions back to their enriched candidates. The
        # selection keeps TEI's score-descending order — the hits carry that
        # order into the result (V02 §4.13: the selected passages keep the
        # reranker's score-descending order all the way through).
        hits = []
        for scored in outcome.selection:
            doc = candidates[scored.position]["doc"]
            if doc.repo_id:
                provenance = OkfConceptProvenance(
                    concept_id=doc.file_ids[0] if doc.file_ids else "",
                    repo_id=doc.repo_id,
                    bundle_version=doc.bundle_version,
                )
            else:
                provenance = LegacyFileProvenance(file_id=doc.file_ids[0] if doc.file_ids else "")
            hits.append(SearchHit(provenance=provenance, text=doc.text, score=scored.score))

        truncated = self._apply_result_budget(hits, budget)
        outcome_code = OutcomeCode.DEGRADED_AVAILABILITY if degraded else OutcomeCode.SUCCESS
        return SearchKnowledgeResult(
            outcome=outcome_code,
            hits=tuple(hits),
            truncated=truncated,
            query_preparation_status=request.query.preparation_status,
        )

    def _apply_result_budget(self, hits: list[SearchHit], budget: OperationBudget) -> bool:
        """Truncate the hits to the caller's result budget; flag when cut.

        The contract's result_size declaration: a breach truncates and flags,
        it never silently drops.
        """
        truncated = False
        if len(hits) > budget.max_results:
            hits[:] = hits[: budget.max_results]
            truncated = True
        total_bytes = 0
        cut_at = len(hits)
        for index, hit in enumerate(hits):
            total_bytes += len(hit.text.encode("utf-8")) + len(hit.provenance.model_dump_json().encode("utf-8"))
            if total_bytes > budget.max_result_bytes:
                cut_at = index
                break
        if cut_at < len(hits):
            hits[:] = hits[:cut_at]
            truncated = True
        return truncated
