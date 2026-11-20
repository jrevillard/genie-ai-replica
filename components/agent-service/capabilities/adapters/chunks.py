# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The legacy chunk adapter: the corpus text of one legacy file.

The chunks of a graph live in ``{graph_name}_SOURCE`` and their text rides
the ``text`` field (V02 §4). The adapter reads them with one bind-variable
AQL — the collection name itself is a bind variable, never interpolated —
and joins the texts into the content a read returns, honouring the caller's
result budget and reporting ``truncated``.
"""

import asyncio
from collections.abc import Callable

_CHUNKS_AQL = """
FOR doc IN @@collection
    FILTER doc.file_id == @file_id
    SORT doc._key ASC
    LIMIT @max_chunks
    RETURN {text: doc.text}
"""


class LegacyChunkAdapter:
    """Reads one legacy file's chunks out of its graph's source collection."""

    def __init__(self, db_factory: Callable[[], object]) -> None:
        self._db_factory = db_factory

    async def read_chunks(self, graph_name: str, file_id: str, max_chunks: int, max_bytes: int) -> tuple[str, bool]:
        """The chunk texts joined with blank lines, and whether the budget cut them."""

        def _run() -> list[dict]:
            db = self._db_factory()
            return db.execute(
                _CHUNKS_AQL,
                {
                    "@collection": f"{graph_name}_SOURCE",
                    "file_id": file_id,
                    "max_chunks": max_chunks + 1,
                },
            )

        rows = await asyncio.to_thread(_run)
        # The AQL shape ``{text: doc.text}`` emits the key with None when the
        # field is absent — ``dict.get(key, default)`` would then yield None
        # and crash the join, so coerce explicitly.
        texts = [row.get("text") or "" for row in rows[:max_chunks]]
        truncated = len(rows) > max_chunks
        content = "\n\n".join(texts)
        encoded = content.encode("utf-8")
        if len(encoded) > max_bytes:
            content = encoded[:max_bytes].decode("utf-8", "ignore")
            truncated = True
        return content, truncated
