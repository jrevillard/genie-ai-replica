"""CLI for manual validation of the v2 RAG pipeline.

Not a user-facing endpoint. No auth, no rate limiting — operator use
only during development and staging.

Usage
-----
    python -m translation_v2.rag ingest <pdf> [--doc-id ID]
    python -m translation_v2.rag pipeline <pdf> --query "..." [--k 5]

Note: both subcommands operate within a single process, so the index
is not persisted across invocations. Persistent indexing will route
through the production vector store adapter in Step 5.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys


async def _cmd_ingest(args: argparse.Namespace) -> int:
    from translation_v2.rag.chunker import LayoutAwareChunker
    from translation_v2.rag.embedder import TEIEmbedder
    from translation_v2.rag.ingest import IngestPipeline
    from translation_v2.rag.vector_store import InMemoryVectorStore

    embedder = TEIEmbedder()
    try:
        pipe = IngestPipeline(
            embedder=embedder,
            vector_store=InMemoryVectorStore(),
            chunker=LayoutAwareChunker(),
        )
        summary = await pipe.ingest_pdf(args.pdf, doc_id=args.doc_id)
    finally:
        await embedder.aclose()
    print(json.dumps(summary, indent=2))
    return 0


async def _cmd_pipeline(args: argparse.Namespace) -> int:
    from translation_v2.rag.chunker import LayoutAwareChunker
    from translation_v2.rag.embedder import TEIEmbedder
    from translation_v2.rag.ingest import IngestPipeline
    from translation_v2.rag.retrieve import HybridRetriever
    from translation_v2.rag.vector_store import InMemoryVectorStore

    embedder = TEIEmbedder()
    try:
        store = InMemoryVectorStore()
        chunker = LayoutAwareChunker()
        pipe = IngestPipeline(embedder=embedder, vector_store=store, chunker=chunker)
        summary = await pipe.ingest_pdf(args.pdf, doc_id=args.doc_id)
        print(json.dumps({"ingest": summary}, indent=2))

        retriever = HybridRetriever(vector_store=store, embedder=embedder)
        retriever.index_corpus(list(store._chunks))
        results = await retriever.retrieve(args.query, k=args.k)
    finally:
        await embedder.aclose()

    print(json.dumps(
        {
            "query": args.query,
            "k": args.k,
            "results": [
                {
                    "score": round(score, 4),
                    "doc_id": ch.doc_id,
                    "page": ch.page,
                    "text": (ch.text[:300] + "…") if len(ch.text) > 300 else ch.text,
                }
                for (ch, score) in results
            ],
        },
        indent=2,
    ))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="translation_v2.rag")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_ingest = sub.add_parser("ingest", help="Ingest a PDF into an in-memory vector store and print a summary")
    p_ingest.add_argument("pdf", help="Path to the PDF file")
    p_ingest.add_argument("--doc-id", default=None)

    p_pipe = sub.add_parser("pipeline", help="Ingest a PDF, then run a query end-to-end")
    p_pipe.add_argument("pdf", help="Path to the PDF file")
    p_pipe.add_argument("--query", required=True, help="Query string")
    p_pipe.add_argument("--doc-id", default=None)
    p_pipe.add_argument("--k", type=int, default=5)

    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    if args.cmd == "ingest":
        return asyncio.run(_cmd_ingest(args))
    if args.cmd == "pipeline":
        return asyncio.run(_cmd_pipeline(args))
    return 2


if __name__ == "__main__":
    sys.exit(main())
