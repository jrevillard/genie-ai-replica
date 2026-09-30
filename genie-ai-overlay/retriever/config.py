# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os


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
LLM_MODEL_ID = os.getenv("LLM_MODEL_ID", "meta-llama/Meta-Llama-3.1-8B-Instruct")
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
ARANGO_FILTER_STRATEGY = os.getenv("ARANGO_FILTER_STRATEGY", "OR")  # for label filtering

# Hybrid BM25 + RRF Retrieval (Contextual Retrieval Part B)
# Opt-in lexical (BM25) channel over <GRAPH>_SOURCE.text, fused with the dense
# results via weighted Reciprocal Rank Fusion. OFF = true no-op (dense-only).
# See _bmad-output/implementation-artifacts/spec-hybrid-retrieval-bm25-rrf.md
HYBRID_RETRIEVAL_ENABLED = os.getenv("RETRIEVER_HYBRID_RETRIEVAL_ENABLED", "true").lower() == "true"
HYBRID_RRF_K = int(os.getenv("RETRIEVER_HYBRID_RRF_K", "60"))
HYBRID_BM25_CANDIDATES = int(os.getenv("RETRIEVER_HYBRID_BM25_CANDIDATES", "50"))
HYBRID_DENSE_WEIGHT = float(os.getenv("RETRIEVER_HYBRID_DENSE_WEIGHT", "1.0"))
HYBRID_LEXICAL_WEIGHT = float(os.getenv("RETRIEVER_HYBRID_LEXICAL_WEIGHT", "1.0"))
HYBRID_BM25_ANALYZER = os.getenv("RETRIEVER_HYBRID_BM25_ANALYZER", "text_en")

# Summarizer Configuration
SUMMARIZER_ENABLED = os.getenv("RETRIEVER_SUMMARIZER_ENABLED", "false").lower() == "true"

# Embedding configuration
TEI_EMBED_MODEL = os.getenv("TEI_EMBED_MODEL", "BAAI/bge-large-en-v1.5")
TEI_EMBEDDING_ENDPOINT = os.getenv("TEI_EMBEDDING_ENDPOINT")
HF_TOKEN = os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACEHUB_API_TOKEN", "")

# Query instruction prefix for embedding models (issue #1035, generalized).
#
# Many embedding models are trained contrastively or with task-specific
# instructions: queries and passages sit on opposite sides of the vector space
# at inference, and the model card specifies that queries must be prefixed
# with a specific string while passages MUST NOT receive it. Applying the
# prefix in the caller (retriever/chatqna) keeps the shared TEI embedding
# service usable by dataprep ingestion — which encodes passages without the
# prefix — without splitting the service.
#
# Built-in table covers the most common families. Order matters: substring
# match returns the FIRST entry whose substring is found in the model id.
# Most-specific entries go first so e.g. "intfloat/e5-large-v2" wins over a
# generic "intfloat/e5" fallback.
_BUILTIN_QUERY_INSTRUCTIONS: tuple[tuple[str, str], ...] = (
    # BAAI/bge English contrastive (the issue #1035 baseline)
    ("BAAI/bge-large-en-v1.5", "Represent this sentence for searching relevant passages: "),
    ("BAAI/bge-base-en-v1.5", "Represent this sentence for searching relevant passages: "),
    ("BAAI/bge-small-en-v1.5", "Represent this sentence for searching relevant passages: "),
    # BAAI/bge Chinese contrastive (different prefix — must not receive English)
    ("BAAI/bge-large-zh-v1.5", "为这个句子生成表示以用于检索相关文章："),
    ("BAAI/bge-base-zh-v1.5", "为这个句子生成表示以用于检索相关文章："),
    # intfloat/e5 — "query: " / "passage: " asymmetry
    ("intfloat/e5-large-v2", "query: "),
    ("intfloat/e5-base-v2", "query: "),
    ("intfloat/multilingual-e5", "query: "),
    # hkunlp/instructor — task-specific (configurable via prompt)
    ("hkunlp/instructor", "Represent the query for retrieving evidence documents: "),
    # nomic-ai/nomic-embed — task prefix
    ("nomic-ai/nomic-embed", "search_query: "),
)

# Deployer overrides / additions. Comma-separated `substring=instruction`
# pairs; substring matched against TEI_EMBED_MODEL (case-insensitive). The
# user table takes priority over the built-in table — same substring
# overridden wins; new substring added on top.
#
# Examples:
#   EMBEDDING_QUERY_INSTRUCTIONS="my-org/bge-finetune=Custom instruction: "
#   EMBEDDING_QUERY_INSTRUCTIONS="hkunlp/instructor=Legal question: ,BAAI/bge-large-zh-v1.5=自定义中文："
_EMBEDDING_QUERY_INSTRUCTIONS_RAW = os.getenv("EMBEDDING_QUERY_INSTRUCTIONS", "").strip()


def _parse_query_instructions(raw: str) -> tuple[tuple[str, str], ...]:
    """Parse `k=v,k=v` env override into substring→instruction pairs.

    The value preserves trailing spaces — query instructions like
    ``"Represent this sentence for searching relevant passages: "`` end in
    a space that's part of the protocol.
    """
    out: list[tuple[str, str], ...] = []
    for entry in raw.split(","):
        entry = entry.strip()
        if not entry or "=" not in entry:
            continue
        k, v = entry.split("=", 1)
        k = k.strip()
        if k and v:
            out.append((k, v))
    return tuple(out)


_USER_QUERY_INSTRUCTIONS: tuple[tuple[str, str], ...] = _parse_query_instructions(_EMBEDDING_QUERY_INSTRUCTIONS_RAW)


def get_query_instruction(model_id: str | None) -> str | None:
    """Return the query instruction string for a model, or None if no prefix.

    Resolution order (first match wins):
      1. Deployer overrides (EMBEDDING_QUERY_INSTRUCTIONS env var) — full
         priority over the built-in table, used to add finetunes or
         override built-in entries.
      2. Built-in table (substring match; most-specific entries declared
         first so e.g. ``intfloat/e5-large-v2`` beats ``intfloat/e5``).

    Returns None when no entry matches — caller must NOT wrap embeddings
    (passages and queries both encode raw, BM25 tokenizes the bare query).

    Models with no built-in or override entry (BAAI/bge-m3, mxbai-embed-large,
    text-embedding-3-*, sentence-transformers/*, …) keep their native
    behavior: dense vectors unchanged, BM25 tokenizes the bare query.
    """
    if not model_id:
        return None
    mid = model_id.lower()
    for substring, instr in _USER_QUERY_INSTRUCTIONS:
        if substring.lower() in mid:
            return instr
    for substring, instr in _BUILTIN_QUERY_INSTRUCTIONS:
        if substring.lower() in mid:
            return instr
    return None


# VLLM configuration
VLLM_API_KEY = os.getenv("VLLM_API_KEY", "EMPTY")
VLLM_ENDPOINT = os.getenv("VLLM_ENDPOINT")
VLLM_MODEL_ID = os.getenv("VLLM_MODEL_ID", "ibm-granite/granite-3.3-2b-instruct")
VLLM_MAX_NEW_TOKENS = os.getenv("VLLM_MAX_NEW_TOKENS", 512)
VLLM_TOP_P = os.getenv("VLLM_TOP_P", 0.9)
VLLM_TEMPERATURE = os.getenv("VLLM_TEMPERATURE", 0.8)
VLLM_TIMEOUT = os.getenv("VLLM_TIMEOUT", 600)

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
