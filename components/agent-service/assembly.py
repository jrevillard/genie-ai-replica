# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The port assembly: the read adapters and the inner search port.

Host infrastructure: the assembly is composition — it builds the adapters
the requests read through and binds a caller's context to them — and the
composition root owns it. The measurement surface calls it too: a
governed run and the probe read the same corpus.
"""

import os
from dataclasses import dataclass

from capabilities.adapters.arango_retrieval import ArangoRetrievalAdapter
from capabilities.adapters.chunks import LegacyChunkAdapter
from capabilities.adapters.docrepo import DocRepoAdapter
from capabilities.adapters.env_config import (
    ArangoConfig,
    EmbeddingConfig,
    HybridConfig,
    ModelEndpointConfig,
    RerankingConfig,
)
from capabilities.adapters.okf import OkfAdapter
from capabilities.adapters.tei_embedding import TeiEmbeddingAdapter
from capabilities.adapters.tei_reranking import TeiRerankingAdapter
from capabilities.contract import CallerContext, DocumentCapabilityPort, OperationName, TransientError
from capabilities.executor import AuthorizedExecutor
from capabilities.search_knowledge import SearchKnowledgeCapability
from capabilities.sources import ConceptSource


@dataclass(frozen=True)
class StatelessAdapters:
    """The stateless half of the port assembly: the read adapters and the
    inner search port, built ONCE per process and shared by every request
    (the executor that binds a caller context to them is per request)."""

    docrepo: DocRepoAdapter
    okf: ConceptSource
    chunks: LegacyChunkAdapter
    search_port: DocumentCapabilityPort
    legacy_graph_name: str

    def bind_executor(self, context: CallerContext, bearer: str | None) -> AuthorizedExecutor:
        """The per-request executor: one trusted context bound to the five
        shared fields — the ONE place the binding lives (the probe's live
        entry and the run surface's port factory both call it)."""
        return AuthorizedExecutor(
            context,
            bearer=bearer,
            legacy_graph_name=self.legacy_graph_name,
            docrepo=self.docrepo,
            okf=self.okf,
            chunks=self.chunks,
            search_port=self.search_port,
        )


class _LegRetrieverFactory:
    """The host's retriever factory: it hands the capability the connector
    that serves one corpus leg.

    The leg label is opaque to the capability and resolved here — the host
    is the side that knows the corpus platform's collections, views and
    identifiers (ADR agentic-009, F3).

    The factory is PUBLIC and its wiring is public: the suite that drives
    the capability over a fake corpus drives THIS factory (not a replay of
    it), so the wiring the capability is tested against is the wiring that
    ships.
    """

    def __init__(self, db_factory, arango_config: ArangoConfig, hybrid_config: HybridConfig):
        self.db_factory = db_factory
        self.arango_config = arango_config
        self.hybrid_config = hybrid_config
        # The ensured-BM25-view cache spans the legs and the requests: the
        # retriever instance is per leg, the cache is the factory's.
        self.ensured_bm25_views: set[str] = set()

    def for_leg(self, leg: str) -> ArangoRetrievalAdapter:
        return ArangoRetrievalAdapter(
            self.db_factory(leg),
            self.arango_config,
            self.hybrid_config,
            graph_name=leg,
            ensured_bm25_views=self.ensured_bm25_views,
        )


def build_leg_retriever_factory(
    db_factory, arango_config: ArangoConfig, hybrid_config: HybridConfig
) -> _LegRetrieverFactory:
    """The factory the host injects into the search capability."""
    return _LegRetrieverFactory(db_factory, arango_config, hybrid_config)


class _PillarNotDeployed:
    """The OKF concept read on a deployment that does not run the pillar.

    The pillar's control plane is absent, so no concept can resolve: the
    read refuses with the honest reason instead of dialling a base URL that
    was never configured.
    """

    async def fetch_concept(self, repo_id: str, concept_id: str, bearer: str | None) -> dict | None:
        raise TransientError(
            "the OKF pillar is not deployed (OKF_ENABLED=0): no concept can resolve",
            operation=OperationName.READ_SOURCE,
        )


def build_stateless_adapters(env=None) -> StatelessAdapters:
    """Assemble the stateless adapters from the environment.

    The search capability is wired here (a missing TEI endpoint is its own
    boot error); doc-repo and okf-server need their base URLs. Shared by
    the probe and the run surface — one port assembly, so a governed run
    reads the same corpus the probe measures.

    The OKF pillar's posture is the deployment's own ``OKF_ENABLED`` — the
    same variable the backend, the frontend and the OKF tier read. When the
    pillar is NOT deployed, the okf-server base URL is not required — the
    assembly runs in the legacy posture, the concept read refuses with the
    honest reason, and the retrieval does not attempt the OKF identity join.
    """
    source = os.environ if env is None else env
    docrepo_url = str(source.get("AGENT_DOCREPO_URL", ""))
    okf_url = str(source.get("AGENT_OKF_URL", ""))
    if not docrepo_url:
        raise ValueError("AGENT_DOCREPO_URL must be set for the port assembly (doc-repo base URL)")

    # The posture is read ONCE, from the config that also carries the
    # retrieval knobs — the assembly and the retrieval must not read the
    # flag twice and disagree about it.
    arango_config = ArangoConfig.load(env)
    okf_enabled = arango_config.okf_identity_enabled
    if okf_enabled and not okf_url:
        raise ValueError("AGENT_OKF_URL must be set for the port assembly (okf-server base URL)")

    # The ArangoDB driver stays a call-time import: it is the one heavy
    # dependency only a live assembly needs, and keeping it off the module
    # import path keeps importing the seam (loop/budget/events consumers)
    # free of it.
    import arango

    client = arango.ArangoClient(hosts=arango_config.url)

    def db_factory(_graph_name: str = ""):
        # One factory for the whole assembly: the search capability names
        # the graph it searches, the chunk adapter does not — the handle is
        # the same database either way.
        return client.db(
            arango_config.database,
            username=arango_config.username,
            password=arango_config.password,
        )

    search = build_search_capability(env, db_factory=db_factory, arango_config=arango_config)

    return StatelessAdapters(
        docrepo=DocRepoAdapter(docrepo_url),
        okf=OkfAdapter(okf_url) if okf_enabled else _PillarNotDeployed(),
        chunks=LegacyChunkAdapter(db_factory),
        search_port=search,
        legacy_graph_name=arango_config.graph_name,
    )


def build_search_capability(env=None, db_factory=None, arango_config=None):
    """The search capability's wiring: the retrieval driver, the embedding
    and reranking endpoints, and the graph's database.

    Composition, not capability: the capability names WHAT it searches, the
    host names WHAT it searches with.

    ``db_factory`` and ``arango_config`` are the assembly's, when it has
    them: one client and one config for the whole port. Standalone (the
    tests wire the capability on its own) they are built here.
    """
    hybrid_config = HybridConfig.load(env)
    reranking_config = RerankingConfig.load(env)
    embedding_config = EmbeddingConfig.load(env)
    endpoints = ModelEndpointConfig.load(env)
    if not endpoints.tei_embedding_endpoint:
        raise ValueError("TEI_EMBEDDING_ENDPOINT must be set: the port has no default embedding endpoint")
    if not endpoints.tei_reranking_endpoint:
        raise ValueError("TEI_RERANKING_ENDPOINT must be set: the port has no default reranker endpoint")
    if db_factory is None or arango_config is None:
        # The driver import lives here, not at module import, so the port
        # surface stays import-light for the tests that fake the adapters.
        import arango

        arango_config = ArangoConfig.load(env)
        client = arango.ArangoClient(hosts=arango_config.url)

        def db_factory(_graph_name: str):
            return client.db(
                arango_config.database,
                username=arango_config.username,
                password=arango_config.password,
            )

    # The embedding call carries ITS OWN budget, under the knob names the
    # deployed embed clients read — not the reranker's.
    embedding = TeiEmbeddingAdapter(
        endpoints.tei_embedding_endpoint,
        connect_timeout_seconds=embedding_config.connect_timeout_seconds,
        total_timeout_seconds=embedding_config.embed_timeout_seconds,
        tls_verify=endpoints.tls_verify,
        bearer=endpoints.bearer,
    )
    reranking = TeiRerankingAdapter(
        endpoints.tei_reranking_endpoint, reranking_config, tls_verify=endpoints.tls_verify, bearer=endpoints.bearer
    )

    # The retriever factory is the HOST's: it is the side that knows which
    # connector serves which corpus leg. The capability asks it per leg and
    # drives what it gets back — the code that decides never builds the
    # connector that reaches (ADR agentic-009, F2).
    factory = build_leg_retriever_factory(db_factory, arango_config, hybrid_config)
    return SearchKnowledgeCapability(embedding, reranking, factory)
