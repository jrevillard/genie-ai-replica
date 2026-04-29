#!/usr/bin/env python3
"""
AMINA Care — Haystack-Native Knowledge Chunk Ingester
========================================================
Re-implements the exact ingestion pipeline from haystack-dataprep using
Haystack components that are already installed in haystack-chatqna. This
produces chunk counts and splits that match the original dataprep run.

Key differences from the simplified `bulk_ingest_chunks.py`:
  - Uses `PyPDFToDocument` → one Document per PDF page
  - Uses `DocumentCleaner` (remove_empty_lines + extra_whitespaces + repeated_substrings)
  - Uses `DocumentSplitter(split_by="word", split_length=150, split_overlap=20,
    respect_sentence_boundary=True)`  ← same config as haystack-dataprep
  - Uses `SentenceTransformersDocumentEmbedder` with the same model

Writes chunks to ArcadeDB `chunks` vertex type with the schema the RAG
retrievers read from (LIST<DOUBLE> embeddings via SQL params).

Usage (inside haystack-chatqna):
    python3 scripts/bulk_ingest_chunks_haystack.py \
        --docs-dir /app/data/docs \
        --arcadedb http://arcadedb:2480 \
        --db genie
"""

import argparse
import hashlib
import json
import sys
from pathlib import Path

import requests

DEFAULT_DOCS_DIR = "/app/data/docs"
DEFAULT_ARCADEDB = "http://arcadedb:2480"
DEFAULT_DB       = "genie"
DEFAULT_USER     = "root"
DEFAULT_PASSWORD = "genieRoot123"

MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"


# ── ArcadeDB helpers ─────────────────────────────────────────────────────────

def _sql(arcadedb_url: str, db: str, auth: tuple, query: str, params: dict = None) -> dict:
    payload = {"language": "sql", "command": query}
    if params:
        payload["params"] = params
    r = requests.post(
        f"{arcadedb_url.rstrip('/')}/api/v1/command/{db}",
        json=payload, auth=auth, timeout=30,
    )
    if r.status_code != 200:
        raise RuntimeError(f"ArcadeDB {r.status_code}: {r.text[:300]}")
    return r.json()


def ensure_chunks_schema(arcadedb_url: str, db: str, auth: tuple) -> None:
    stmts = [
        "CREATE VERTEX TYPE chunks IF NOT EXISTS",
        "CREATE PROPERTY chunks.chunk_id IF NOT EXISTS STRING",
        "CREATE PROPERTY chunks.text IF NOT EXISTS STRING",
        "CREATE PROPERTY chunks.source IF NOT EXISTS STRING",
        "CREATE PROPERTY chunks.title IF NOT EXISTS STRING",
        "CREATE PROPERTY chunks.doc_id IF NOT EXISTS STRING",
        "CREATE PROPERTY chunks.category_labels IF NOT EXISTS LIST",
        "CREATE PROPERTY chunks.graph_enriched IF NOT EXISTS BOOLEAN",
        "CREATE PROPERTY chunks.embedding IF NOT EXISTS LIST",
    ]
    for s in stmts:
        try:
            _sql(arcadedb_url, db, auth, s)
        except Exception:
            pass


def chunk_id_for(text: str, source: str, idx: int) -> str:
    h = hashlib.sha256((source + "::" + str(idx) + "::" + text[:200]).encode("utf-8")).hexdigest()
    return f"CHK_{h[:16].upper()}"


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--docs-dir",  default=DEFAULT_DOCS_DIR)
    ap.add_argument("--arcadedb",  default=DEFAULT_ARCADEDB)
    ap.add_argument("--db",        default=DEFAULT_DB)
    ap.add_argument("--user",      default=DEFAULT_USER)
    ap.add_argument("--password",  default=DEFAULT_PASSWORD)
    ap.add_argument("--clear-first", action="store_true",
                    help="DELETE all chunks from ArcadeDB before ingesting")
    args = ap.parse_args()

    auth = (args.user, args.password)

    print(f"Ensuring chunks schema in {args.arcadedb}/{args.db}...")
    ensure_chunks_schema(args.arcadedb, args.db, auth)

    if args.clear_first:
        print("Clearing existing chunks...")
        r = _sql(args.arcadedb, args.db, auth, "DELETE FROM chunks")
        if r.get("result"):
            print(f"  Deleted {r['result'][0].get('count', 0)} existing chunks")

    # Load Haystack components (already installed in haystack-chatqna)
    print("Loading Haystack components...")
    from haystack import Pipeline
    from haystack.components.routers import FileTypeRouter
    from haystack.components.converters import TextFileToDocument, PyPDFToDocument
    from haystack.components.joiners import DocumentJoiner
    from haystack.components.preprocessors import DocumentSplitter, DocumentCleaner
    from haystack.components.embedders import SentenceTransformersDocumentEmbedder
    from haystack.utils import ComponentDevice

    docs_dir = Path(args.docs_dir)
    if not docs_dir.is_dir():
        print(f"ERROR: docs dir not found: {docs_dir}", file=sys.stderr)
        sys.exit(2)

    file_paths = sorted([
        str(p) for p in docs_dir.rglob("*")
        if p.is_file() and p.suffix.lower() in (".txt", ".md", ".pdf")
    ])
    if not file_paths:
        print(f"No source files in {docs_dir}")
        sys.exit(0)

    print(f"Found {len(file_paths)} source files")

    # Build the exact haystack-dataprep ingestion pipeline
    print("Building pipeline...")
    file_type_router  = FileTypeRouter(mime_types=["text/plain", "application/pdf"])
    text_converter    = TextFileToDocument()
    pdf_converter     = PyPDFToDocument()
    document_joiner   = DocumentJoiner()
    document_cleaner  = DocumentCleaner(
        remove_empty_lines=True,
        remove_extra_whitespaces=True,
        remove_repeated_substrings=True,
    )
    document_splitter = DocumentSplitter(
        split_by="word",
        split_length=150,
        split_overlap=20,
        respect_sentence_boundary=True,
    )
    document_embedder = SentenceTransformersDocumentEmbedder(
        model=MODEL_NAME,
        device=ComponentDevice.from_str("cpu"),
    )
    document_embedder.warm_up()

    pipe = Pipeline()
    pipe.add_component("file_type_router",  file_type_router)
    pipe.add_component("text_converter",    text_converter)
    pipe.add_component("pdf_converter",     pdf_converter)
    pipe.add_component("document_joiner",   document_joiner)
    pipe.add_component("document_cleaner",  document_cleaner)
    pipe.add_component("document_splitter", document_splitter)
    pipe.add_component("document_embedder", document_embedder)

    pipe.connect("file_type_router.text/plain",      "text_converter.sources")
    pipe.connect("file_type_router.application/pdf", "pdf_converter.sources")
    pipe.connect("text_converter",    "document_joiner")
    pipe.connect("pdf_converter",     "document_joiner")
    pipe.connect("document_joiner",   "document_cleaner")
    pipe.connect("document_cleaner",  "document_splitter")
    pipe.connect("document_splitter", "document_embedder")

    print(f"Running pipeline on {len(file_paths)} files...")
    result = pipe.run({"file_type_router": {"sources": file_paths}})

    documents = result.get("document_embedder", {}).get("documents", [])
    print(f"Pipeline produced {len(documents)} chunks")

    # Write each chunk to ArcadeDB
    total_written = 0
    total_failed  = 0

    for idx, doc in enumerate(documents):
        content  = (doc.content or "").strip()
        if not content:
            continue

        meta = doc.meta or {}
        # Haystack's PyPDFToDocument sets meta["file_path"] and meta["page_number"]
        file_path_raw = meta.get("file_path") or ""
        page_num      = meta.get("page_number", "")
        try:
            src = Path(file_path_raw).name if file_path_raw else "unknown"
        except Exception:
            src = "unknown"
        title = Path(src).stem if src != "unknown" else "unknown"

        cid = chunk_id_for(content, src, idx)
        embedding = doc.embedding or []

        try:
            _sql(
                args.arcadedb, args.db, auth,
                "INSERT INTO chunks SET "
                "chunk_id = :cid, text = :txt, source = :src, title = :ttl, "
                "doc_id = :doc, category_labels = :cat, graph_enriched = false, "
                "embedding = :emb",
                {
                    "cid": cid,
                    "txt": content,
                    "src": src,
                    "ttl": title,
                    "doc": src,
                    "cat": [],
                    "emb": [float(x) for x in embedding],
                },
            )
            total_written += 1
            if total_written % 50 == 0:
                print(f"  ... {total_written} chunks written")
        except Exception as e:
            total_failed += 1
            msg = str(e)[:200]
            print(f"  ! failed: {msg}", file=sys.stderr)

    print(f"\n{'='*60}")
    print(f"Ingestion complete.")
    print(f"  Source files:     {len(file_paths)}")
    print(f"  Chunks produced:  {len(documents)}")
    print(f"  Chunks written:   {total_written}")
    print(f"  Chunks failed:    {total_failed}")

    try:
        r = _sql(args.arcadedb, args.db, auth, "SELECT count(*) as cnt FROM chunks")
        if r.get("result"):
            print(f"  Total chunks rows in DB: {r['result'][0].get('cnt')}")
    except Exception:
        pass


if __name__ == "__main__":
    main()
