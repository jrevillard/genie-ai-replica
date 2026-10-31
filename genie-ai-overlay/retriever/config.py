# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os

from core.model_http_policy import EMBEDDING_TIMEOUT_SECONDS, LLM_TIMEOUT_SECONDS


#######################################################
#                Common Functions                     #
#######################################################
def get_boolean_env_var(var_name, default_value=False):
    """Retrieve the boolean value of an environment variable.

    Args:
    var_name (str): The name of the environment variable to retrieve.
    default_value (bool): The default value to return if the variable
    is not found.

    Returns:
    bool: The value of the environment variable, interpreted as a boolean.
    """
    true_values = {"true", "1", "t", "y", "yes"}
    false_values = {"false", "0", "f", "n", "no"}

    # Retrieve the environment variable's value
    value = os.getenv(var_name, "").lower()

    # Decide the boolean value based on the content of the string
    if value in true_values:
        return True
    elif value in false_values:
        return False
    else:
        return default_value


# Whether or not to enable langchain debugging
DEBUG = get_boolean_env_var("DEBUG", False)
# Set DEBUG env var to "true" if you wish to enable LC debugging module
if DEBUG:
    import langchain

    langchain.debug = True

# Embedding model
EMBED_MODEL = os.getenv("EMBED_MODEL", "BAAI/bge-large-en-v1.5")
LOCAL_EMBEDDING_MODEL = os.getenv("LOCAL_EMBEDDING_MODEL", "maidalun1020/bce-embedding-base_v1")
TEI_EMBEDDING_ENDPOINT = os.getenv("TEI_EMBEDDING_ENDPOINT", "")
BRIDGE_TOWER_EMBEDDING = os.getenv("BRIDGE_TOWER_EMBEDDING", False)

HF_TOKEN = os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACEHUB_API_TOKEN", "")
ENABLE_SCHEMA = get_boolean_env_var("ENABLE_SCHEMA", False)

# OpenAI
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

# Directory pathss
current_file_path = os.path.abspath(__file__)
parent_dir = os.path.dirname(current_file_path)


#######################################################
#                Elasticsearch                        #
#######################################################
ES_CONNECTION_STRING = os.getenv("ES_CONNECTION_STRING", "http://localhost:9200")
ES_INDEX_NAME = os.getenv("ES_INDEX_NAME", "rag_elasticsearch")


#######################################################
#                    Neo4j                            #
#######################################################
NEO4J_PORT2 = os.getenv("NEO4J_PORT2", "7687")
NEO4J_URL = os.getenv("NEO4J_URI", f"bolt://localhost:{NEO4J_PORT2}")
NEO4J_USERNAME = os.getenv("NEO4J_USERNAME", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "test")
HOST_IP = os.getenv("HOST_IP")
TGI_LLM_ENDPOINT = os.getenv("TGI_LLM_ENDPOINT", f"http://{HOST_IP}:6005")
TGI_LLM_ENDPOINT_KEY = os.getenv("TGI_LLM_ENDPOINT_KEY", "fake")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_EMBEDDING_MODEL = os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
OPENAI_LLM_MODEL = os.getenv("OPENAI_LLM_MODEL", "gpt-4o")
MAX_OUTPUT_TOKENS = os.getenv("MAX_OUTPUT_TOKENS", "1024")


#######################################################
#                    Pathway                          #
#######################################################
PATHWAY_HOST = os.getenv("PATHWAY_HOST", "127.0.0.1")
PATHWAY_PORT = int(os.getenv("PATHWAY_PORT", 8666))


#######################################################
#                     Redis                           #
#######################################################
INDEX_NAME = os.getenv("INDEX_NAME", "rag_redis")
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", 6379))


def format_redis_conn_from_env():
    redis_url = os.getenv("REDIS_URL", None)
    if redis_url:
        return redis_url
    else:
        using_ssl = get_boolean_env_var("REDIS_SSL", False)
        start = "rediss://" if using_ssl else "redis://"

        # if using RBAC
        password = os.getenv("REDIS_PASSWORD", None)
        username = os.getenv("REDIS_USERNAME", "default")
        if password is not None:
            start += f"{username}:{password}@"

        return start + f"{REDIS_HOST}:{REDIS_PORT}"


REDIS_URL = format_redis_conn_from_env()
REDIS_SCHEMA = os.getenv("REDIS_SCHEMA", "redis_schema_multi.yml")
schema_path = os.path.join(parent_dir, REDIS_SCHEMA)
INDEX_SCHEMA = schema_path


#######################################################
#                     Milvus                          #
#######################################################
MILVUS_HOST = os.getenv("MILVUS_HOST", "localhost")
MILVUS_PORT = int(os.getenv("MILVUS_PORT", 19530))
MILVUS_URI = f"http://{MILVUS_HOST}:{MILVUS_PORT}"
INDEX_PARAMS = {"index_type": "FLAT", "metric_type": "IP", "params": {}}
COLLECTION_NAME = os.getenv("COLLECTION_NAME", "rag_milvus")
# TEI configuration
TEI_EMBEDDING_MODEL = os.getenv("TEI_EMBEDDING_MODEL", "/home/user/bce-embedding-base_v1")
os.environ["OPENAI_API_BASE"] = TEI_EMBEDDING_ENDPOINT
# os.environ["OPENAI_API_KEY"] = "Dummy key"


#######################################################
#                   Opensearch                        #
#######################################################
# OpenSearch Connection Information
OPENSEARCH_HOST = os.getenv("OPENSEARCH_HOST", "localhost")
OPENSEARCH_PORT = int(os.getenv("OPENSEARCH_PORT", 9200))
OPENSEARCH_INITIAL_ADMIN_PASSWORD = os.getenv("OPENSEARCH_INITIAL_ADMIN_PASSWORD", "")


def format_opensearch_conn_from_env():
    opensearch_url = os.getenv("OPENSEARCH_URL", None)
    if opensearch_url:
        return opensearch_url
    else:
        using_ssl = get_boolean_env_var("OPENSEARCH_SSL", False)
        start = "https://" if using_ssl else "http://"

        return start + f"{OPENSEARCH_HOST}:{OPENSEARCH_PORT}"


OPENSEARCH_URL = format_opensearch_conn_from_env()
OPENSEARCH_INDEX_NAME = os.getenv("OPENSEARCH_INDEX_NAME", "rag_opensearch")


#######################################################
#                     Pinecone                        #
#######################################################
# Pinecone configuration
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY", "xxx_xxx")
PINECONE_INDEX_NAME = os.getenv("PINECONE_INDEX_NAME", "rag_pinecone")


#######################################################
#                     PGvector                        #
#######################################################
PG_CONNECTION_STRING = os.getenv("PG_CONNECTION_STRING", "localhost")
PG_INDEX_NAME = os.getenv("PG_INDEX_NAME", "rag_pgvector")


#######################################################
#                        QDrant                       #
#######################################################
QDRANT_HOST = os.getenv("QDRANT_HOST", "localhost")
QDRANT_PORT = int(os.getenv("QDRANT_PORT", 6333))
QDRANT_EMBED_DIMENSION = os.getenv("QDRANT_EMBED_DIMENSION", 1024)
QDRANT_INDEX_NAME = os.getenv("QDRANT_INDEX_NAME", "rag_qdrant")


#######################################################
#                        VDMs                         #
#######################################################
# VDMS Connection Information
VDMS_HOST = os.getenv("VDMS_HOST", "localhost")
VDMS_PORT = int(os.getenv("VDMS_PORT", 55555))
VDMS_INDEX_NAME = os.getenv("VDMS_INDEX_NAME", "rag_vdms")
VDMS_USE_CLIP = int(os.getenv("VDMS_USE_CLIP", 0))
SEARCH_ENGINE = os.getenv("SEARCH_ENGINE", "FaissFlat")
DISTANCE_STRATEGY = os.getenv("DISTANCE_STRATEGY", "IP")

#######################################################
#                     ArangoDB                        #
#######################################################

# ArangoDB Connection configuration
ARANGO_URL = os.getenv("ARANGO_URL", "http://localhost:8529")
ARANGO_USERNAME = os.getenv("ARANGO_USERNAME", "root")
ARANGO_PASSWORD = os.getenv("ARANGO_PASSWORD")
ARANGO_DB = os.getenv("ARANGO_DB", "genie-ai")

# ArangoDB Vector configuration
ARANGO_GRAPH_NAME = os.getenv("ARANGO_GRAPH_NAME", "GRAPH")
ARANGO_DISTANCE_STRATEGY = os.getenv("RETRIEVER_ARANGO_DISTANCE_STRATEGY", "COSINE")
ARANGO_USE_APPROX_SEARCH = os.getenv("RETRIEVER_ARANGO_USE_APPROX_SEARCH", "false").lower() == "true"
ARANGO_NUM_CENTROIDS = int(os.getenv("RETRIEVER_ARANGO_NUM_CENTROIDS", 1))
ARANGO_SEARCH_START = os.getenv("RETRIEVER_ARANGO_SEARCH_START", "node")
ARANGO_SEARCH_MODE = os.getenv("RETRIEVER_ARANGO_SEARCH_MODE", "vector")

# ArangoDB Traversal configuration
ARANGO_TRAVERSAL_ENABLED = os.getenv("RETRIEVER_ARANGO_TRAVERSAL_ENABLED", "false").lower() == "true"
ARANGO_TRAVERSAL_MAX_DEPTH = int(os.getenv("RETRIEVER_ARANGO_TRAVERSAL_MAX_DEPTH", 1))
ARANGO_TRAVERSAL_MAX_RETURNED = int(os.getenv("RETRIEVER_ARANGO_TRAVERSAL_MAX_RETURNED", 3))
ARANGO_TRAVERSAL_SCORE_THRESHOLD = float(os.getenv("RETRIEVER_ARANGO_TRAVERSAL_SCORE_THRESHOLD", 0.5))
ARANGO_TRAVERSAL_QUERY = os.getenv("ARANGO_TRAVERSAL_QUERY")
ARANGO_TRAVERSAL_CONCURRENT_BATCHES = int(os.getenv("RETRIEVER_ARANGO_TRAVERSAL_CONCURRENT_BATCHES", 1))
# The label-filter strategies the retriever supports: AND = every filter
# label must be on a chunk, OR = one of them is enough.
FILTER_STRATEGIES = ("AND", "OR")
ARANGO_FILTER_STRATEGY = os.getenv("RETRIEVER_ARANGO_FILTER_STRATEGY", "OR").strip().upper()  # for label filtering
if ARANGO_FILTER_STRATEGY not in FILTER_STRATEGIES:
    raise ValueError(
        f"RETRIEVER_ARANGO_FILTER_STRATEGY must be one of {', '.join(FILTER_STRATEGIES)},"
        f" got {ARANGO_FILTER_STRATEGY!r}"
    )

# 1-8g-l (2026-10-11, live incident: Indonesia History — 144k chunks, 633k
# entities, 1,046,217 LINKS_TO edges — starved EVERY chat answer 9/9: the
# depth-1 traversal scores a 1024-dim cosine per visited edge, cannot finish
# inside the 8s leg budget, and the abandoned leg discarded its own already-
# fused 20 on-point documents → fused=0 → the LLM abstained ungrounded).
# MAX_LINKS: skip the traversal entirely above this many <GRAPH>_LINKS_TO
# edges — the fused vector results stand alone (0 = legacy unbounded).
# Live calibration: indonesia 1,046,217 (skip), gov-uk 80,535 / ncd 8,546 /
# slaughterhouse 1,623 (keep) — a 300k default separates broken from healthy
# with >3x margin on both sides.
ARANGO_TRAVERSAL_MAX_LINKS = int(os.getenv("RETRIEVER_ARANGO_TRAVERSAL_MAX_LINKS", "300000"))
# Per-seed-entity edge cap interpolated into the traversal AQL — bounds the
# worst-case cosine evaluations when a hub entity carries thousands of
# LINKS_TO edges (0 = legacy unbounded). Generous: healthy graphs never
# approach it; pathological hub nodes no longer dominate the leg budget.
ARANGO_TRAVERSAL_MAX_EDGES_PER_NODE = int(os.getenv("RETRIEVER_ARANGO_TRAVERSAL_MAX_EDGES_PER_NODE", "2000"))

# Hybrid BM25 + RRF Retrieval (Contextual Retrieval Part B)
# Opt-in lexical (BM25) channel over <GRAPH>_SOURCE.text, fused with the dense
# results via weighted Reciprocal Rank Fusion. OFF = true no-op (dense-only).
# See _bmad-output/implementation-artifacts/spec-hybrid-retrieval-bm25-rrf.md
HYBRID_RETRIEVAL_ENABLED = os.getenv("RETRIEVER_HYBRID_RETRIEVAL_ENABLED", "true").lower() == "true"
HYBRID_RRF_K = int(os.getenv("RETRIEVER_HYBRID_RRF_K", "60"))
HYBRID_BM25_CANDIDATES = int(os.getenv("RETRIEVER_HYBRID_BM25_CANDIDATES", "50"))
HYBRID_DENSE_WEIGHT = float(os.getenv("RETRIEVER_HYBRID_DENSE_WEIGHT", "1.0"))
HYBRID_LEXICAL_WEIGHT = float(os.getenv("RETRIEVER_HYBRID_LEXICAL_WEIGHT", "1.0"))
# The BM25 analyzer must speak the corpus language. The corpus is English by
# construction — operator preprocessing plus the document-repository ingest
# gate (DOCUMENT_INGESTION_LANGUAGE, default 'en') — so leave text_en alone
# unless the ingest gate moves WITH it. _ensure_bm25_view only creates the
# ArangoSearch view when absent: changing this env var alone never updates an
# existing view (delete the view and let the service recreate it). Rationale
# and probes: site/content/en/docs/architecture/multilingual-ssot.md
HYBRID_BM25_ANALYZER = os.getenv("RETRIEVER_HYBRID_BM25_ANALYZER", "text_en")

# Story 1.1/1.4/1.5 (ADR-039 D4/D5/D8) — multi-graph fan-out governance.
# The retriever reads `_encoded_graph_names` from the search_start carrier
# (Story 1.0b / core/label_contract.py). The carrier carries ≥1 graph
# (`_fanout_should_engage`) and the fan-out engages: per-leg timeout, the
# dedicated extraction pool, fusion. Only the EMPTY carrier keeps the
# original single-graph path (D8: legacy byte-identical against
# ARANGO_GRAPH_NAME) — a single-graph okf_only carrier is deliberately
# fan-out-managed.
# The chat-side resolver sets per-request overrides via kwargs (Story 1.2).
# Defaults preserve legacy behavior — fan-out is opt-in via RETRIEVER_FANOUT_ENABLED.
FANOUT_ENABLED = os.getenv("RETRIEVER_FANOUT_ENABLED", "true").lower() == "true"
FANOUT_MAX_GRAPHS = int(os.getenv("RETRIEVER_FANOUT_MAX_GRAPHS", "5"))
# 8000ms (was 2000): with legs now running on worker threads the timeout is
# actually enforceable — and 2s zeroed every large repo (bali/indonesia/
# www-gov-uk need 5-20s warm). 8s bounds a fan-out at 2 semaphore waves to
# ~16s worst-case while keeping the skip-on-timeout contract (ADR-039 D8).
FANOUT_PER_GRAPH_TIMEOUT_MS = int(os.getenv("RETRIEVER_FANOUT_PER_GRAPH_TIMEOUT_MS", "8000"))
# Story 1.5 (ADR-039 D4): tiered option-(d) fan-out caps — within a graph the
# fused candidate pool is hard-capped per graph and globally before fusion.
FANOUT_CANDIDATE_CAP_PER_GRAPH = int(os.getenv("RETRIEVER_FANOUT_CANDIDATE_CAP_PER_GRAPH", "50"))
FANOUT_CANDIDATE_CAP_GLOBAL = int(os.getenv("RETRIEVER_FANOUT_CANDIDATE_CAP_GLOBAL", "200"))
# Tier-1 curated-spine hops over `source='author'` edges (ADR-039 D4).
FANOUT_SPINE_MAX_HOPS = int(os.getenv("RETRIEVER_FANOUT_SPINE_MAX_HOPS", "2"))
# Tier-2 extracted-relation hop cap (kept low — extracted edges are noisy).
FANOUT_EXTRACTED_HOP_CAP = int(os.getenv("RETRIEVER_FANOUT_EXTRACTED_HOP_CAP", "1"))

# Story 1.3 (ADR-039 routing tier) — query-affinity graph selection. Before the
# fan-out spawns legs, a global chunk-level competition decides which carrier
# graphs to search: k=40 approximate-NN probes per OKF graph (parallel), merged
# into one global top-K ranking; a graph qualifies iff it contributes >=
# ROUTE_MIN_CHUNKS chunks. Sticky conversation graphs (carrier ::sticky:)
# bypass qualification. Legacy GRAPH is never routed. Never all-graphs EXCEPT
# the degraded path (probes failed after ROUTE_RETRY attempts — logged loudly).
ROUTE_ENABLED = os.getenv("RETRIEVER_ROUTE_ENABLED", "true").lower() == "true"
ROUTE_TOP_K = int(os.getenv("RETRIEVER_ROUTE_TOP_K", "40"))
ROUTE_MIN_CHUNKS = int(os.getenv("RETRIEVER_ROUTE_MIN_CHUNKS", "3"))
ROUTE_PROBE_TIMEOUT_MS = int(os.getenv("RETRIEVER_ROUTE_PROBE_TIMEOUT_MS", "2000"))
ROUTE_RETRY = int(os.getenv("RETRIEVER_ROUTE_RETRY", "1"))

# Story 1-8 MR-D (David 2026-10-08: "it only needs to look at the head …
# it is just signalling") — vectorized-head affinity joins the global chunk
# competition: each carrier graph's okf_repositories.head contributes ONE
# pseudo-row (RETRIEVER_ROUTE_HEAD_WEIGHT × cosine(query, head)) to the
# top-K pool. The head row adds +1 to its graph's qualification count and
# can crowd a competitor's chunks out of the top-K. Guards: head.dim must
# equal the query embedding dim; a recorded head model must be consistent
# with this service's embedding model when both are known. Head fetch is
# BEST-EFFORT — its failure never degrades routing (the probe results
# alone remain valid). 0.0 disables the signal entirely (rollback knob).
ROUTE_HEAD_WEIGHT = float(os.getenv("RETRIEVER_ROUTE_HEAD_WEIGHT", "1.0"))
# Story 1-8a — the forbidden/noise GATE (David: "under no circumstances
# should 'fun in Indonesia' be routed to the NCD repo"). A head's pseudo-row
# is emitted only when cosine(q, head.vector) − cosine(q, forbidden centroid)
# exceeds this margin; otherwise the head contributes NO vote. Calibrated on
# NCD 2026-10-08: suppressed queries span [−0.062, −0.008], selected ≥ +0.024
# ("genetic risk factors for cancer" — borderline IN, per David). Heads
# without a forbidden centroid claim freely (gate degrades open).
ROUTE_HEAD_MARGIN = float(os.getenv("RETRIEVER_ROUTE_HEAD_MARGIN", "0.01"))
# Story 1-8b (David 2026-10-09: "forbidden is forbidden — a hard contract,
# it should immediately score zero") — the head pseudo-row is emitted only
# when ALL of: FLOOR (score ≥ this — unrelated queries score 0.32-0.48 on
# any head and the margin rule is blind to them; "capital of France"
# claimed at +0.012 under margin-only. Calibrated: unrelated ≤ 0.484,
# legit claims ≥ 0.614 → 0.55 mid-gap), VETO (no single forbidden tag
# matches the query at/above this — mixed-subject queries like
# genetics+cancer slip the averaged centroid but not their dominant tag;
# failing queries ≥ 0.567 vs their tag, legit claims ≤ 0.529), and the
# 1-8a MARGIN. Heads without per-tag vectors (pre-1-8b rebuild) skip the
# veto; heads without a forbidden centroid skip margin (1-8a semantics).
ROUTE_HEAD_FLOOR = float(os.getenv("RETRIEVER_ROUTE_HEAD_FLOOR", "0.55"))
ROUTE_FORBIDDEN_TAG_MAX = float(os.getenv("RETRIEVER_ROUTE_FORBIDDEN_TAG_MAX", "0.55"))
# Story 1-8f3 (David 2026-10-10: "CLEARLY IT SHOULD HAVE HIT THE NCD
# Information graph (only)") — heads SUPERSEDE chunk competition. When ≥1
# gate-passing head claims the query, ONLY claimed graphs route and the
# chunk-level probe is SKIPPED entirely: headless corpora (bulk-ingested,
# untagged, no head to gate) must not pollute the pool, and probing them
# was the latency (live: a 4-graph probe across ~100k-chunk graphs cost
# 78s of a 122s answer). The legacy GRAPH leg is ALSO excluded under an
# active claim (D8 superseded for the claimed case — live: 20 unrelated
# Kenya legacy chunks were the only content reranked for an NCD-routed
# asthma query when the NCD leg returned 0 documents). With NO claims the
# legacy chunk competition runs unchanged (un-headed deployments keep
# Story 1.3 behavior; degraded all-graph fallback untouched). false
# restores the 1-8 MR-D pool semantics (head rows as one vote among
# chunks, GRAPH always searched).
ROUTE_HEADS_SUPERSEDE = os.getenv("RETRIEVER_ROUTE_HEADS_SUPERSEDE", "true").lower() == "true"

# Summarizer Configuration
SUMMARIZER_ENABLED = os.getenv("RETRIEVER_SUMMARIZER_ENABLED", "false").lower() == "true"

# Embedding configuration
TEI_EMBEDDING_ENDPOINT = os.getenv("TEI_EMBEDDING_ENDPOINT")
HF_TOKEN = os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACEHUB_API_TOKEN", "")

# Query-instruction prefix logic (TEI_EMBED_MODEL constant, built-in table,
# EMBEDDING_QUERY_INSTRUCTIONS env parsing, get_query_instruction) lives in
# ``genie-ai-overlay/core/embedding_query_prefix.py`` so chatqna can import
# it without pulling the retriever source tree (the retriever image's runtime
# deps — langchain_arangodb, langchain_huggingface, etc. — are not part of
# chatqna's image, and the retriever source isn't shipped in chatqna's image
# either). Re-exported here for backward compatibility with tests and any
# retriever-internal callers that haven't been migrated.
from core.embedding_query_prefix import (  # noqa: F401  re-exported for backward compat
    _BUILTIN_QUERY_INSTRUCTIONS,
    _USER_QUERY_INSTRUCTIONS,
    TEI_EMBED_MODEL,
    _parse_query_instructions,
    get_query_instruction,
)

# VLLM configuration
VLLM_API_KEY = os.getenv("VLLM_API_KEY", "EMPTY")
VLLM_ENDPOINT = os.getenv("VLLM_ENDPOINT")
VLLM_MAX_NEW_TOKENS = os.getenv("VLLM_MAX_NEW_TOKENS", 512)
VLLM_TOP_P = os.getenv("VLLM_TOP_P", 0.9)
VLLM_TEMPERATURE = os.getenv("VLLM_TEMPERATURE", 0.8)
# Deck-wide budgets, resolved once by core/model_http_policy.py (imported at the
# top of this file). Both aliases keep their historical names because the
# retriever source and its tests reference them; what they carry is now the
# shared budget rather than a retriever-local constant. Only the shared name is
# injected into the container: VLLM_TIMEOUT is that same budget under its
# historical name, so injecting both would leave an operator two names to edit
# and no way to tell that only one of them is ever read.
VLLM_TIMEOUT = LLM_TIMEOUT_SECONDS
EMBEDDING_TIMEOUT = EMBEDDING_TIMEOUT_SECONDS
# The summarizer's budget is deliberately NOT aliased here. It has no degradation
# route, so it keeps the openai default rather than the tightened LLM one, and
# its two call sites import SUMMARIZER_TIMEOUT_SECONDS straight from the policy
# module — an alias nothing in production reads would be a second name for one
# budget, guarded by nothing.


# OpenAI configuration (alternative to VLLM & TEI)
OPENAI_CHAT_MODEL = os.getenv("OPENAI_CHAT_MODEL", "gpt-4o")
OPENAI_CHAT_TEMPERATURE = os.getenv("OPENAI_CHAT_TEMPERATURE", 0)
OPENAI_CHAT_MAX_TOKENS = os.getenv("OPENAI_CHAT_MAX_TOKENS")
OPENAI_EMBED_MODEL = os.getenv("OPENAI_EMBED_MODEL", "text-embedding-3-small")
OPENAI_CHAT_ENABLED = os.getenv("OPENAI_CHAT_ENABLED", "true").lower() == "true"
OPENAI_EMBED_ENABLED = os.getenv("OPENAI_EMBED_ENABLED", "true").lower() == "true"

#######################################################
#                     MariaDB Vector                  #
#######################################################
MARIADB_CONNECTION_URL = os.getenv("MARIADB_CONNECTION_URL", "localhost")
MARIADB_COLLECTION_NAME = os.getenv("MARIADB_COLLECTION_NAME", "rag_mariadbvector")
