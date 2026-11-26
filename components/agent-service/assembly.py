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
from capabilities.contract import CallerContext, DocumentCapabilityPort
from capabilities.executor import AuthorizedExecutor
from capabilities.search_knowledge import SearchKnowledgeCapability


@dataclass(frozen=True)
class StatelessAdapters:
    """The stateless half of the port assembly: the read adapters and the
    inner search port, built ONCE per process and shared by every request
    (the executor that binds a caller context to them is per request)."""

    docrepo: DocRepoAdapter
    okf: OkfAdapter
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


def build_stateless_adapters(env=None) -> StatelessAdapters:
    """Assemble the stateless adapters from the environment.

    The search capability is wired here (a missing TEI endpoint is its own
    boot error); doc-repo and okf-server need their base URLs. Shared by
    the probe and the run surface — one port assembly, so a governed run
    reads the same corpus the probe measures.
    """
    source = os.environ if env is None else env
    docrepo_url = str(source.get("AGENT_DOCREPO_URL", ""))
    okf_url = str(source.get("AGENT_OKF_URL", ""))
    if not docrepo_url:
        raise ValueError("AGENT_DOCREPO_URL must be set for the port assembly (doc-repo base URL)")
    if not okf_url:
        raise ValueError("AGENT_OKF_URL must be set for the port assembly (okf-server base URL)")
    arango_config = ArangoConfig.load(env)
    search = build_search_capability(env)

    # The ArangoDB driver stays a call-time import: it is the one heavy
    # dependency only a live assembly needs, and keeping it off the module
    # import path keeps importing the seam (loop/budget/events consumers)
    # free of it.
    import arango

    client = arango.ArangoClient(hosts=arango_config.url)

    def db_factory():
        return client.db(
            arango_config.database,
            username=arango_config.username,
            password=arango_config.password,
        )

    return StatelessAdapters(
        docrepo=DocRepoAdapter(docrepo_url),
        okf=OkfAdapter(okf_url),
        chunks=LegacyChunkAdapter(db_factory),
        search_port=search,
        legacy_graph_name=arango_config.graph_name,
    )


def build_search_capability(env=None):
    """The search capability's wiring: the retrieval driver, the embedding
    and reranking endpoints, and the graph's database.

    Composition, not capability: the capability names WHAT it searches, the
    host names WHAT it searches with.
    """
    # The driver import lives here, not at module import, so the port
    # surface stays import-light for the tests that fake the adapters.
    import arango

    arango_config = ArangoConfig.load(env)
    hybrid_config = HybridConfig.load(env)
    reranking_config = RerankingConfig.load(env)
    embedding_config = EmbeddingConfig.load(env)
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
    return SearchKnowledgeCapability(embedding, reranking, db_factory, arango_config, hybrid_config)
