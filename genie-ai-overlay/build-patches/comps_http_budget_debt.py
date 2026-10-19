# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
#
# OVERRIDE comps.dataprep.integrations.arangodb.llm_transformer | disposition: re-graft-to-new-API | reason: vendored LLM/embedding clients build their own HTTP clients with library-default timeouts that this repo cannot configure | test: (none — cannot be asserted outside the built image; see contracts/README.md)

"""Record of the vendored-``comps`` HTTP-budget debt, and what would close it.

Not a patch. Nothing here is imported at runtime.

Why this file exists
--------------------
``core/model_http_policy.py`` bounds every model-endpoint client the overlay
constructs itself. It cannot reach the ones ``comps`` constructs, because
``comps`` is cloned from GenAIComps at image build time and its client
construction happens inside its own module bodies. Four call families are in
that position:

``comps.cores.mega.orchestrator`` (``ServiceOrchestrator.schedule``)
    The chatqna RAG graph — embed → retrieve → rerank → LLM, one POST per hop
    through ``MicroService.invoke``. This is the user-facing request path: a
    wedged GPU turns a chat request into an open socket, not an error.

``comps.dataprep.src.integrations.arangodb.OpeaArangoDataprep._initialize_llm``
    Builds ``self.llm_transformer``, invoked by ``convert_to_graph_documents``
    once per ingested document inside ``asyncio.to_thread``. Uninstrumented:
    no span, no timeout, no progress line, and a catch-all handler that retries
    per document.

``OpeaArangoDataprep._initialize_embeddings``
    Builds the TEI embedding client used at ingest for label selection, chunk
    and node embedding, and relationship embedding.

``opea/embedding:1.5`` and ``opea/llm-textgen:1.5``
    No Python overlay at all — the TEI embedding microservice and the
    streaming textgen path live entirely in the upstream base images.

Why it is not patched here
--------------------------
The only lever that reaches all four is the site-init hook
(``build-patches/install_site_startup.sh``), which already monkey-patches
``aiohttp.ClientSession.post/get`` and ``requests.Session.request`` for auth in
``configs/ssl/genie_ssl_patch.py``. A timeout patch in the same place would be
small, but it would apply to *every* HTTP call in the process, not only model
endpoints — and the same libraries carry the control-plane traffic whose budget
is already set deliberately per call site (Keycloak 30 s, ingestion log 30 s,
docling 120 s). A blanket timeout would either over-run those or truncate them.

No local test suite can validate such a patch either: ``tests/conftest.py``
stubs ``comps`` in ``sys.modules``, so a change to the vendored libraries is
invisible to ``pytest tests/``. Only ``contracts/`` runs against real ``comps``,
and only inside the built image (see ``contracts/README.md``). Shipping a
process-wide patch with no CI able to observe its blast radius is the kind of
change that should be measured, not assumed.

What would close it
-------------------
Two routes, in order of how well they are understood:

1. **In-repo override** (preferred). Copy the affected ``comps`` module into
   the overlay, change its client construction to read
   ``core.model_http_policy``, and ``COPY`` it over the vendored file in each
   Dockerfile — the mechanism ``core/constants.py`` and
   ``core/genieai_api_protocol.py`` already use. Costs a re-graft on every OPEA
   bump, which is what this manifest's ``re-graft-to-new-API`` disposition
   exists to track.

2. **Site-init hook** (fallback). A dedicated ``model_http_shim.py`` installed
   alongside ``genie_ssl_patch.py`` that patches only the model-endpoint
   clients, identified by URL rather than applied to all traffic. Needs the
   contract suite extended first, so the patch is exercised in-image against
   real ``comps``.

Until one of those lands, the deck-wide claim in ``model_http_policy``'s
docstring holds for the overlay's own clients only. The docstring says so
explicitly, and this file is where that limitation is tracked.
"""