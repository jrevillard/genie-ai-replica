# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
#
# OVERRIDE comps.dataprep.integrations.arangodb.llm_transformer | disposition: still-needed | reason: vendored LLM/embedding clients build their own HTTP clients; the graph-transformer's budget reads VLLM_TIMEOUT but cannot be set from the environment (comps takes it verbatim from os.getenv and httpx 0.28 rejects a string timeout), and the orchestrator/TEI wrappers have no budget at all | test: contracts/test_contract_http_budget.py::test_the_vendored_graph_transformer_reads_vllm_timeout  # noqa: E501

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
    The chatqna RAG graph — embed → retrieve → rerank → LLM. ``schedule`` opens
    an ``aiohttp.ClientSession(timeout=ClientTimeout(total=2000))`` from a
    *local variable*, so there is no module constant to reassign and no
    constructor argument to pass: the 2000 s is not configurable from here. The
    POST itself is issued by ``ServiceOrchestrator.execute`` (``MicroService``
    has no ``invoke`` method in v1.5). This is the user-facing request path: a
    wedged GPU turns a chat request into an open socket, not an error.

``comps.dataprep.src.integrations.arangodb.OpeaArangoDataprep._initialize_llm``
    Builds ``self.llm_transformer``, invoked by ``convert_to_graph_documents``
    once per ingested document inside ``asyncio.to_thread``. **Not closed, and
    not closeable from here**: it reads a module-level ``VLLM_TIMEOUT`` (comps
    ``arangodb.py:55``, default 600) for its ``ChatOpenAI``, and the dataprep
    service runs that code in-process, so an env var *looks* like it would bound
    it with no override. It does not. comps takes the value verbatim from
    ``os.getenv``, so it arrives as a string; httpx 0.28 does not coerce a
    string timeout and ``socket.create_connection`` raises ``TypeError``
    instead of timing out. ``_process_batch`` swallows that, so every batch
    would fail extraction while the document still reported "Ingested" with an
    empty knowledge graph — silently, on every deployment.

    So ``docker-compose.yaml`` deliberately does not inject it, and the phase
    keeps comps' own ``int`` 600 s default. That default is also the right
    value: this phase has no degradation path, so a batch cancelled mid-flight
    loses its chunks outright while the document still reports success.
    Binding it differently — or bounding the graph-insertion gather that
    follows, which cannot be bounded from outside for the same reason — needs a
    patch to the vendored source.

    The transformer also emits no span and no progress line, so nothing tells an
    operator how far through the documents it is.

``OpeaArangoDataprep._initialize_embeddings``
    Builds the TEI embedding client used at ingest for label selection, chunk
    and node embedding, and relationship embedding. It goes through
    ``huggingface_hub.AsyncInferenceClient``, whose ``timeout`` comps never
    passes.

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

Adjacent finding — the same hook, a different leak
---------------------------------------------------
``configs/ssl/genie_ssl_patch.py`` injects ``Authorization: Bearer
$VLLM_API_KEY`` into **every** ``aiohttp`` and ``requests`` call in the
process, regardless of destination: the document repository, the backend and
ArangoDB all receive the GPU node's credential. This predates the HTTP-budget
work (both wrappers predate it) and was left unchanged here rather than fixed
inside a timeout MR — it is an auth-scope change on a critical path and wants
its own review.

The fix shape is the URL-scoped variant already proposed below for the timeout
shim: match the endpoint (the GPU host / the TEI and vLLM URLs) and inject only
for that host, rather than for every call the process makes. Worth pairing
with the ``verify=False`` gating in ``configs/ssl/genie_ssl_patch.py``, since
both live in the same wrapper.

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
