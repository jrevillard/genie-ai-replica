# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The embedding query-instruction contract, ported from the recorded query path.

The recorded contract is MODEL-SPECIFIC: many embedding models are
trained contrastively or with task-specific instructions, so queries and
passages sit on opposite sides of the vector space at inference. The model
card specifies that queries must be prefixed with a specific string while
passages MUST NOT receive it. The prefix applies to the query only — passages
are embedded raw at ingestion, and the BM25 leg tokenizes the bare query.

Resolution order (first match wins):

1. the deployer overrides (``EMBEDDING_QUERY_INSTRUCTIONS``, comma-separated
   ``substring=instruction`` pairs);
2. the built-in table (substring match; most-specific entries declared
   first).

A model with no entry — ``BAAI/bge-m3``, ``sentence-transformers/*``,
``mxbai-embed-large``, ``text-embedding-3-*`` … — gets NO prefix: the query
is embedded raw. The behavior is ported from
``genie-ai-overlay/core/embedding_query_prefix.py``; the table and the
resolution semantics are identical.
"""

import os

# The model id resolved when TEI_EMBED_MODEL is unset — the recorded code
# default.
DEFAULT_EMBED_MODEL = "BAAI/bge-large-en-v1.5"

# Built-in table covers the most common families. Order matters: substring
# match returns the FIRST entry whose substring is found in the model id.
# Most-specific entries go first so e.g. "intfloat/e5-large-v2" wins over a
# generic "intfloat/e5" fallback.
_BUILTIN_QUERY_INSTRUCTIONS: tuple[tuple[str, str], ...] = (
    # BAAI/bge English contrastive
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


def _parse_query_instructions(raw: str) -> tuple[tuple[str, str], ...]:
    """Parse `k=v,k=v` env override into substring→instruction pairs.

    The value preserves trailing spaces — query instructions like
    ``"Represent this sentence for searching relevant passages: "`` end in
    a space that's part of the protocol.

    **Comma-in-value is NOT supported.** Entries are split on a literal
    ``,``; an instruction containing a comma will be silently truncated at
    the first comma. Deployers needing commas in their instruction should
    swap the comma for a different separator and rebuild the corresponding
    model to accept that. None of the built-in instructions contain commas.
    """
    out: list[tuple[str, str]] = []
    for entry in raw.split(","):
        entry = entry.strip()
        if not entry or "=" not in entry:
            continue
        key, value = entry.split("=", 1)
        key = key.strip()
        if key and value:
            out.append((key, value))
    return tuple(out)


def get_query_instruction(model_id: str | None, overrides_raw: str | None = None) -> str | None:
    """Return the query instruction string for a model, or None if no prefix.

    Resolution order (first match wins):

    1. deployer overrides (``EMBEDDING_QUERY_INSTRUCTIONS``) — full priority
       over the built-in table, used to add finetunes or override built-in
       entries;
    2. the built-in table (substring match; most-specific entries first).

    Returns None when no entry matches — the caller must NOT wrap the
    embedding (the query is embedded raw, and the BM25 leg tokenizes the
    bare query).

    ``overrides_raw`` defaults to the ``EMBEDDING_QUERY_INSTRUCTIONS`` env
    var; tests pass it explicitly. **User-substring matches are
    first-match-wins and may be broader than intended** — a deployer who
    writes ``"bge-large=Custom: "`` silently overrides both the English and
    the Chinese ``BGE/bge-large-*`` variants.
    """
    if not model_id:
        return None
    if overrides_raw is None:
        overrides_raw = os.getenv("EMBEDDING_QUERY_INSTRUCTIONS", "").strip()
    user_instructions = _parse_query_instructions(overrides_raw)
    lowered = model_id.lower()
    for substring, instruction in user_instructions:
        if substring.lower() in lowered:
            return instruction
    for substring, instruction in _BUILTIN_QUERY_INSTRUCTIONS:
        if substring.lower() in lowered:
            return instruction
    return None


def resolve_embed_model() -> str:
    """The active embedding model id: ``TEI_EMBED_MODEL`` or the code default."""
    return os.getenv("TEI_EMBED_MODEL", DEFAULT_EMBED_MODEL)
