# Copyright (C) 2026 ITU
# SPDX-License-Identifier: Apache-2.0
"""Embedding query-instruction prefix shared by chatqna and retriever (issue #1035).

Many embedding models are trained contrastively or with task-specific
instructions: queries and passages sit on opposite sides of the vector space
at inference, and the model card specifies that queries must be prefixed
with a specific string while passages MUST NOT receive it. Applying the
prefix in the caller (retriever or chatqna) keeps the shared TEI embedding
service usable by dataprep ingestion — which encodes passages without the
prefix — without splitting the service.

The query-instruction logic was originally defined in
``genie-ai-overlay/retriever/config.py`` and imported from chatqna via
``from retriever.config import ...``. That import coupled chatqna's runtime
image to the retriever source tree (the retriever module wasn't installed
in the chatqna image and the retriever image's runtime deps
``langchain_arangodb``, ``langchain_huggingface``, etc. are not part of
chatqna's image). The shared logic now lives here so chatqna and retriever
both depend on a small, dependency-free module that ships in both images.
"""

import os

# Default model id resolved when TEI_EMBED_MODEL env var is unset. Both
# chatqna (query prefix selection) and retriever (TEI endpoint request body)
# need to agree on the active model id.
TEI_EMBED_MODEL = os.getenv("TEI_EMBED_MODEL", "BAAI/bge-large-en-v1.5")

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

    **Comma-in-value is NOT supported.** Entries are split on a literal
    ``,``; an instruction containing a comma will be silently truncated at
    the first comma. Deployers needing commas in their instruction should
    swap the comma for a different separator (semicolon, pipe) and rebuild
    the corresponding model to accept that — or hardcode the override in
    this module. None of the built-in instructions contain commas.
    """
    out: list[tuple[str, str]] = []
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

    **User-substring matches are first-match-wins and may be broader than
    intended.** Use the most specific substring available (e.g.
    ``BAAI/bge-large-en-v1.5`` rather than ``bge-large``) to avoid
    cross-language / cross-family overrides — a deployer who writes
    ``EMBEDDING_QUERY_INSTRUCTIONS="bge-large=Custom: "`` will silently
    override both the English and Chinese ``BGE/bge-large-*`` variants.
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
