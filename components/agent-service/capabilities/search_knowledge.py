# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The ``search_knowledge`` operation: the OPEA-free port of the recorded query path.

Implements the contract's ``DocumentCapabilityPort.search_knowledge`` on top
of the adapters. The behavior is frozen to the recorded query-path contract
(``docs/baselines/v02-opea-query-path-contract.md``); the structure is free
(clean-slate).

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
the loop's business, and the contract refuses non-prepared
input before this code runs.

Cancellation propagates unchanged: ``asyncio.CancelledError`` is never
caught in this module (the contract's cancellation declaration — a cancelled
operation is neither a failure nor an insufficiency).
"""

import asyncio
import logging
from collections.abc import Callable

from pydantic import ValidationError

from .adapters.arango_retrieval import ArangoRetrievalAdapter
from .adapters.env_config import ArangoConfig, HybridConfig
from .adapters.tei_embedding import TeiEmbeddingAdapter
from .adapters.tei_reranking import RerankerInputTooLongError, TeiRerankingAdapter
from .contract import (
    RERANKER_INPUT_TOO_LONG_ABSTENTION_TEXT,
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
from .identifiers import validate_graph_name

logger = logging.getLogger(__name__)


class SearchKnowledgeCapability:
    """The port implementation the agent loop talks to.

    The adapters are constructor-injected; ``create()`` assembles the default
    wiring from the environment (the recorded knobs) and a live ArangoDB
    client. The service builds this once at startup — a misconfigured knob
    fails the service at boot, the same crash-loop pattern the deployed
    retriever exhibits at import.
    """

    name = OperationName.SEARCH_KNOWLEDGE

    @property
    def score_calibrator(self):
        """The confidence-time score calibrator the wired reranking adapter
        owns — the narrow public surface the no-agent pipeline reads (the
        adapter itself stays internal: exposing ``rerank`` would invite a
        caller past the capability's authorized-set check). The capability
        itself never calibrates (calibration is a confidence-time
        concern, never a selection one)."""
        return self._reranking.calibrate

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
        # The ensured-BM25-view cache spans the legs of every request: the
        # adapter instance is per leg, the cache is the capability's.
        self._ensured_bm25_views: set[str] = set()

    async def search_knowledge(
        self,
        context: CallerContext,
        request: SearchKnowledgeInput,
        budget: OperationBudget,
        abstention_sink: "Callable[[str], None] | None" = None,
    ) -> SearchKnowledgeResult:
        """Search the authorized corpus and report what was found.

        ``abstention_sink`` is an OPTIONAL per-call hook (default None): when
        the search ends in one of the recorded insufficiencies, the exact
        reason string (``no_documents_retrieved``, ``reranker_input_too_long``,
        ``reranker_selected_nothing``, ``result_budget_exhausted``,
        ``no_resolvable_candidates``) is handed
        to it AFTER the log line, so a caller can surface the reason without
        scraping logs. It is pipeline-orchestration plumbing, not contract
        surface — the reason stays off the result type (the contract is
        accepted at ``1.0``; adding a field there is a major change), and it
        travels WITH the call, never on shared state, so concurrent runs are
        safe. The DECLARED protocol carries the optional kwarg (the executor
        threads it through when a caller supplies one); the executor itself
        never mints a sink of its own.
        """
        if not context.authorized_graph_names:
            raise AuthorizationError(
                "the caller context authorizes no graph: there is nothing to search",
                operation=OperationName.SEARCH_KNOWLEDGE,
            )
        for graph_name in context.authorized_graph_names:
            # The context's graph names are caller-supplied: the charset
            # guard refuses them on the authorization channel, before any
            # resolution — a malformed name and an unauthorized one are
            # indistinguishable from the caller's side.
            validate_graph_name(graph_name, operation=OperationName.SEARCH_KNOWLEDGE)
        try:
            return await asyncio.wait_for(
                self._run(context, request, budget, abstention_sink),
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
        abstention_sink: "Callable[[str], None] | None" = None,
    ) -> SearchKnowledgeResult:
        labels = list(context.requested_labels)
        try:
            embedded = await self._embedding.embed(request.query.text)
        except Exception as e:
            # The recorded chat path fails the turn when the embedding stage
            # fails; it never abstains on an embedding error.
            raise TransientError(f"the embedding stage failed: {e}", operation=OperationName.SEARCH_KNOWLEDGE) from e

        candidates: list[dict] = []
        degraded = False
        for graph_name in context.authorized_graph_names:
            db = self._db_factory(graph_name)
            # The leg's graph drives the whole adapter: collection, BM25 view
            # and the CAP-1 join's bind all derive from the CONTEXT's graph
            # name, never from the env default (the env name is only the
            # single-graph deployment's default).
            adapter = ArangoRetrievalAdapter(
                db,
                self._arango_config,
                self._hybrid_config,
                graph_name=graph_name,
                ensured_bm25_views=self._ensured_bm25_views,
            )
            try:
                leg_results = await adapter.fused_candidates(embedded.embedding, embedded.raw_text, labels)
            except Exception as e:
                # Only the file_id-enrichment leg raises (its AQL runs
                # unguarded, as recorded); the dense and BM25 legs swallow
                # their own errors and return [] — so a full database outage
                # surfaces as an empty retrieval below, matching the recorded
                # behavior. The raise here is the enrichment's.
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
            return self._insufficient(request, "no_documents_retrieved", abstention_sink)

        texts = [item["doc"].text for item in candidates]
        # The adaptive strategy consumes the chunk embeddings the deployed
        # propagation chain delivers; the dense leg carries them, the BM25
        # view does not — a fusion-rescued candidate misaligns the vectors
        # and adaptive hard-fails on it, exactly as recorded.
        chunk_embeddings = [item["doc"].embedding for item in candidates]
        try:
            outcome = await self._reranking.rerank(
                embedded.raw_text,
                texts,
                chunk_embeddings=chunk_embeddings,
                query_embedding=embedded.embedding,
            )
        except RerankerInputTooLongError:
            # The recorded abstention: TEI rejected the input (422 + Validation).
            logger.warning("abstained.reason=reranker_input_too_long")
            logger.info(RERANKER_INPUT_TOO_LONG_ABSTENTION_TEXT)
            return self._insufficient(request, "reranker_input_too_long", abstention_sink)
        except Exception as e:
            # No fallback to the retrieval order: a reranker transport or
            # protocol failure fails the turn.
            raise TransientError(f"the reranking stage failed: {e}", operation=OperationName.SEARCH_KNOWLEDGE) from e
        if outcome.selected_nothing:
            # The recorded abstention, distinct from empty retrieval.
            logger.warning("abstained.reason=reranker_selected_nothing")
            return self._insufficient(request, "reranker_selected_nothing", abstention_sink)

        # Map the selected positions back to their enriched candidates. The
        # selection keeps TEI's score-descending order — the hits carry that
        # order into the result (the selected passages keep the
        # reranker's score-descending order all the way through).
        # A candidate whose enrichment left ``file_ids`` empty is skipped,
        # never cited with an empty identity: the deployed end-to-end path
        # drops the unresolvable source at citation assembly (chatqna warns
        # and skips it), and an empty ``concept_id``/``file_id`` would reach
        # the BFF's ``source_documents`` unresolvable and collapse the
        # no-agent dedup.
        hits = []
        for scored in outcome.selection:
            doc = candidates[scored.position]["doc"]
            if not doc.file_ids:
                logger.warning(f"skipped candidate with no resolvable file_id: key={doc.key!r} graph={doc.graph_name}")
                continue
            try:
                if doc.repo_id:
                    provenance = OkfConceptProvenance(
                        concept_id=doc.file_ids[0],
                        repo_id=doc.repo_id,
                        bundle_version=doc.bundle_version,
                    )
                else:
                    provenance = LegacyFileProvenance(file_id=doc.file_ids[0])
                hit = SearchHit(provenance=provenance, text=doc.text, score=scored.score)
            except ValidationError as error:
                # The hit comes from the corpus, not from the caller: a
                # payload that does not match the contract (an identity or
                # a text field of the wrong type) is a transient defect of
                # the enrichment, never a raw validation error.
                raise TransientError(
                    f"the corpus served a hit that does not match the contract: {error}",
                    operation=OperationName.SEARCH_KNOWLEDGE,
                ) from error
            hits.append(hit)

        if not hits:
            # Every selected candidate was unresolvable: nothing citable
            # survived. Its own reason — the budget cut nothing and the
            # retrieval was not empty.
            logger.warning("abstained.reason=no_resolvable_candidates")
            return self._insufficient(request, "no_resolvable_candidates", abstention_sink)

        truncated = self._apply_result_budget(hits, budget)
        if not hits:
            # A budget tighter than one hit empties the result: an empty
            # SUCCESS is a contract violation, so the answer is an
            # insufficiency (the size breach is the reason, not a retrieval
            # failure).
            logger.warning("abstained.reason=result_budget_exhausted")
            return self._insufficient(request, "result_budget_exhausted", abstention_sink, truncated=True)
        outcome_code = OutcomeCode.DEGRADED_AVAILABILITY if degraded else OutcomeCode.SUCCESS
        return SearchKnowledgeResult(
            outcome=outcome_code,
            hits=tuple(hits),
            truncated=truncated,
            query_preparation_status=request.query.preparation_status,
        )

    def _insufficient(
        self,
        request: SearchKnowledgeInput,
        reason: str,
        abstention_sink: "Callable[[str], None] | None" = None,
        truncated: bool = False,
    ) -> SearchKnowledgeResult:
        """One constructor for every insufficiency answer: empty hits, the
        query's preparation status echoed, the truncation flag only when the
        result budget caused it. The recorded reasons stay on the log surface
        at each call site — never merged here. When the caller passed an
        abstention sink, the exact reason travels to it (after the log line;
        a sink that raises fails the turn — a silently swallowed reason is
        the drift this hook exists to prevent)."""
        if abstention_sink is not None:
            abstention_sink(reason)
        return SearchKnowledgeResult(
            outcome=OutcomeCode.INSUFFICIENT_EVIDENCE,
            hits=(),
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
