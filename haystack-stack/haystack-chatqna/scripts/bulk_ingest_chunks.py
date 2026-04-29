#!/usr/bin/env python3
"""
AMINA Care — Bulk Knowledge Chunk Ingester
=============================================
Standalone ingestion script that reads all .txt and .pdf files from the
knowledge base source directory, splits them into word-bounded chunks,
generates sentence-transformers embeddings, and writes them to ArcadeDB
as Chunk vertices.

This is a lean replacement for the Haystack pipeline in `haystack-dataprep`
that runs directly inside haystack-chatqna without spinning up a second
container. Produces the same `Chunk` schema that the RAG retriever reads.

Usage (inside haystack-chatqna):
    python3 scripts/bulk_ingest_chunks.py

    # With custom paths:
    python3 scripts/bulk_ingest_chunks.py \
        --docs-dir /app/data/docs \
        --arcadedb http://arcadedb:2480 \
        --db genie

Schema (Chunk vertex — matches existing RAG queries):
    chunk_id:  unique id (hash of text)
    text:      chunk body (~150 words, ~600-800 chars)
    source:    relative path to source file
    title:     filename without extension
    embedding: LIST of 384 floats (all-MiniLM-L6-v2)
"""

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

import requests


# ── Config ───────────────────────────────────────────────────────────────────

DEFAULT_DOCS_DIR = "/app/data/docs"
DEFAULT_ARCADEDB = "http://arcadedb:2480"
DEFAULT_DB       = "genie"
DEFAULT_USER     = "root"
DEFAULT_PASSWORD = "genieRoot123"

CHUNK_SIZE_WORDS = 150
CHUNK_OVERLAP_WORDS = 20
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


def ensure_chunk_schema(arcadedb_url: str, db: str, auth: tuple) -> None:
    """Ensure the `chunks` vertex type exists with all properties the RAG
    retrievers expect. Matches the schema used by:
      - src/utils/arcade_vector_retriever.py  (reads FROM chunks)
      - src/utils/arcade_keyword_retriever.py (reads FROM chunks)
      - src/utils/arcade_graph_enricher.py    (traverses chunk_entities)
      - src/api/admin_routes.py               (stats query on chunks)
    """
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
        except Exception as e:
            print(f"  schema step failed (may already exist): {s[:60]}... → {e}", file=sys.stderr)


# ── PDF / text extraction ────────────────────────────────────────────────────

def read_text_file(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return path.read_text(encoding="latin-1")


def read_pdf_file(path: Path) -> str:
    try:
        from pypdf import PdfReader
    except ImportError:
        try:
            from PyPDF2 import PdfReader
        except ImportError:
            print(f"  ! pypdf/PyPDF2 not installed — skipping PDF: {path.name}", file=sys.stderr)
            return ""
    try:
        reader = PdfReader(str(path))
        return "\n\n".join(page.extract_text() or "" for page in reader.pages)
    except Exception as e:
        print(f"  ! PDF extraction failed for {path.name}: {e}", file=sys.stderr)
        return ""


# ── Chunking ─────────────────────────────────────────────────────────────────

def split_into_chunks(text: str, chunk_size: int = CHUNK_SIZE_WORDS, overlap: int = CHUNK_OVERLAP_WORDS) -> list[str]:
    """Word-bounded splitter with overlap. Respects sentence boundaries when
    possible by merging into the current chunk until the target size is hit."""
    # Light cleaning
    text = " ".join(text.split())
    if not text:
        return []

    words = text.split(" ")
    if len(words) <= chunk_size:
        return [text]

    chunks = []
    start = 0
    while start < len(words):
        end = start + chunk_size
        chunk_words = words[start:end]
        chunk_text = " ".join(chunk_words).strip()
        if chunk_text:
            chunks.append(chunk_text)
        if end >= len(words):
            break
        start = end - overlap  # step forward with overlap

    return chunks


def chunk_id_for(text: str, source: str) -> str:
    h = hashlib.sha256((source + "::" + text[:200]).encode("utf-8")).hexdigest()
    return f"CHK_{h[:16].upper()}"


# ── Main ingestion ───────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--docs-dir",  default=DEFAULT_DOCS_DIR)
    ap.add_argument("--arcadedb",  default=DEFAULT_ARCADEDB)
    ap.add_argument("--db",        default=DEFAULT_DB)
    ap.add_argument("--user",      default=DEFAULT_USER)
    ap.add_argument("--password",  default=DEFAULT_PASSWORD)
    ap.add_argument("--skip-existing", action="store_true",
                    help="Skip chunks whose chunk_id already exists")
    args = ap.parse_args()

    auth = (args.user, args.password)

    # 1. Ensure schema
    print(f"Ensuring Chunk schema in {args.arcadedb}/{args.db}...")
    ensure_chunk_schema(args.arcadedb, args.db, auth)

    # 2. Collect source files
    docs_dir = Path(args.docs_dir)
    if not docs_dir.is_dir():
        print(f"ERROR: docs dir not found: {docs_dir}", file=sys.stderr)
        sys.exit(2)

    source_files = sorted([
        p for p in docs_dir.rglob("*")
        if p.is_file() and p.suffix.lower() in (".txt", ".md", ".pdf")
    ])
    if not source_files:
        print(f"No .txt / .pdf / .md files found in {docs_dir}")
        sys.exit(0)
    print(f"Found {len(source_files)} source files")

    # 3. Load embedder (sentence-transformers — already in haystack-chatqna)
    print(f"Loading embedder: {MODEL_NAME}...")
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        print("ERROR: sentence_transformers not installed", file=sys.stderr)
        sys.exit(3)
    model = SentenceTransformer(MODEL_NAME, device="cpu")
    print(f"  embedding dim: {model.get_sentence_embedding_dimension()}")

    # 4. Read + split + embed + write
    total_chunks = 0
    total_written = 0
    total_skipped = 0
    total_failed = 0

    for src_path in source_files:
        ext = src_path.suffix.lower()
        rel = src_path.relative_to(docs_dir).as_posix()
        title = src_path.stem
        print(f"\n→ {rel}")

        if ext in (".txt", ".md"):
            raw = read_text_file(src_path)
        elif ext == ".pdf":
            raw = read_pdf_file(src_path)
        else:
            continue

        if not raw.strip():
            print(f"  (empty after extraction, skipping)")
            continue

        chunks = split_into_chunks(raw)
        print(f"  {len(chunks)} chunks")
        total_chunks += len(chunks)

        # Embed in batches
        batch_size = 32
        for i in range(0, len(chunks), batch_size):
            batch = chunks[i:i + batch_size]
            try:
                embeddings = model.encode(batch, convert_to_numpy=True, show_progress_bar=False)
            except Exception as e:
                print(f"  ! embed batch failed at {i}: {e}", file=sys.stderr)
                total_failed += len(batch)
                continue

            for j, chunk_text in enumerate(batch):
                cid = chunk_id_for(chunk_text, rel)

                if args.skip_existing:
                    try:
                        existing = _sql(
                            args.arcadedb, args.db, auth,
                            "SELECT chunk_id FROM chunks WHERE chunk_id = :cid LIMIT 1",
                            {"cid": cid},
                        )
                        if existing.get("result"):
                            total_skipped += 1
                            continue
                    except Exception:
                        pass

                # Build params-based INSERT — CONTENT {} serializes floats
                # to JSON which ArcadeDB type-infers as FLOAT, but the `chunks`
                # schema declares embedding as LIST<DOUBLE>. Params preserve
                # the double type through the JDBC boundary.
                try:
                    _sql(
                        args.arcadedb, args.db, auth,
                        "INSERT INTO chunks SET "
                        "chunk_id = :cid, text = :txt, source = :src, title = :ttl, "
                        "doc_id = :doc, category_labels = :cat, graph_enriched = false, "
                        "embedding = :emb",
                        {
                            "cid": cid,
                            "txt": chunk_text,
                            "src": rel,
                            "ttl": title,
                            "doc": rel,
                            "cat": [],
                            "emb": [float(x) for x in embeddings[j].tolist()],
                        },
                    )
                    total_written += 1
                except Exception as e:
                    msg = str(e)
                    if len(msg) > 200:
                        msg = msg[:200] + "..."
                    print(f"  ! insert failed for {cid}: {msg}", file=sys.stderr)
                    total_failed += 1

        print(f"  ... written so far: {total_written}")

    # 5. Verify
    print(f"\n{'=' * 60}")
    print(f"Ingestion complete.")
    print(f"  Source files:       {len(source_files)}")
    print(f"  Total chunks seen:  {total_chunks}")
    print(f"  Chunks written:     {total_written}")
    print(f"  Chunks skipped:     {total_skipped}")
    print(f"  Chunks failed:      {total_failed}")

    try:
        r = _sql(args.arcadedb, args.db, auth, "SELECT count(*) as cnt FROM chunks")
        if r.get("result"):
            print(f"  Total chunks rows in DB: {r['result'][0].get('cnt')}")
    except Exception as e:
        print(f"  (verify query failed: {e})")


if __name__ == "__main__":
    main()
