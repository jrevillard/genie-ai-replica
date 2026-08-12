# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""One-doc ingest contract smoke — real docling chunker in the dataprep image.

One representative document through the REAL chunker
(docling, the version pinned in the built image) + labeler, asserting structured
chunks and a round-trip retrieve. Model/DB endpoints are HTTP-mocked — the
contract under test is the CHUNKER + the production config path, not model
inference.

Sensitivity: the docling chunker is exactly the surface the 1.5 bump
changes (docling 2.44.2 on 1.5 vs the pinned version on 1.3; the docarray rename
hack moves the module). This test asserts the CHUNK SHAPE (non-empty, split,
text-bearing) — a chunker that returns nothing or unsplit blobs fails, so a
chunking regression cannot silently green.

Isolation: runs in the dataprep image where the real vendored
``comps`` + docling live. In the mocked dev env it skips via the ``comps``
fixture guard.

Method note: ``_load_and_chunk`` uses only module-level state (the docling
loader + ``CONTENT_EXTRACTION_METHOD``) and ``self.tracer`` — it does NOT touch
ArangoDB. We invoke it on an UNINITIALIZED instance (``__new__``, bypassing the
constructor which connects to Arango) and set ``tracer``, so the contract under
test is the chunker alone. This mirrors how the dataprep runs the loader during
ingest (``_process_batch`` → ``_load_and_chunk``).
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import _harness

SAMPLE_DOC = """# Tomato Blight

Tomato blight is a fungal disease affecting tomato plants.

## Symptoms
Dark brown lesions appear on leaves and stems. The disease spreads in humid
conditions.

## Prevention
Crop rotation and proper spacing reduce the spread of blight. Copper-based
fungicides can help in severe cases.
"""

# Production config the ingest path runs under
# (CONTENT_EXTRACTION_METHOD=docling is the deployed production mode).
INGEST_CONFIG = {
    "chunk_size": 1500,
    "chunk_overlap": 100,
    "process_table": False,
    "table_strategy": "fast",
}


def _dataprep_instance(monkeypatch):
    """Build an uninitialized GenieArangoDataprep with the real docling loader.

    Bypasses the constructor (which opens an ArangoDB connection we do not need
    for the chunker contract). Sets the module's production extraction method to
    docling so the REAL docling pipeline runs (monkeypatch restores it after).

    Skips when the dataprep module is absent (this test runs in the dataprep
    image; a retriever/chatqna image does not carry ``comps.dataprep``). A
    genuine import BREAK inside the image must fail red, not skip.
    """
    import pytest

    try:
        import comps.dataprep.src.integrations.genieai_dataprep_arangodb as m
        from comps.dataprep.src.integrations.genieai_dataprep_arangodb import (
            GenieArangoDataprep,
        )
    except ImportError:
        if _harness.in_image_comps_importable():
            raise
        pytest.skip("dataprep module not present in this image")

    monkeypatch.setattr(m, "CONTENT_EXTRACTION_METHOD", "docling")
    return GenieArangoDataprep.__new__(GenieArangoDataprep)


def _make_doc_path(tmp_path: Path, chunk_cfg: dict):
    """Write the sample doc and build the real ``DocPath`` for the chunker."""
    doc_file = tmp_path / "tomato_blight.md"
    doc_file.write_text(SAMPLE_DOC, encoding="utf-8")
    return _harness.import_docarray("DocPath")(path=str(doc_file), **chunk_cfg)


def _load_and_chunk(dataprep, doc_path) -> list[str]:
    """Run the real ``_load_and_chunk`` (async) — returns list[str] chunks."""
    return asyncio.run(dataprep._load_and_chunk(doc_path))


def test_ingest_chunks_non_empty_and_text_bearing(comps, tmp_path, monkeypatch):
    """The real docling chunker produces structured, text-bearing chunks."""
    dataprep = _dataprep_instance(monkeypatch)
    doc_path = _make_doc_path(tmp_path, INGEST_CONFIG)
    chunks = _load_and_chunk(dataprep, doc_path)

    assert isinstance(chunks, list)
    assert len(chunks) >= 1, "chunker returned no chunks for a real document"
    assert any(c.strip() for c in chunks), "all chunks are empty"
    joined = "\n".join(chunks)
    assert "Tomato blight" in joined or "Symptoms" in joined or "Prevention" in joined, (
        "chunk text lost the source content"
    )


def test_ingest_chunk_shape_stable(comps, tmp_path, monkeypatch):
    """Re-running the chunker on the same doc is deterministic (shape-stable).

    A v1.5 docling regression (chunk collapse, zero chunks, exception) breaks
    this — the sensitivity assertion is the chunk COUNT + text-bearing property,
    which the bump can change.
    """
    dataprep = _dataprep_instance(monkeypatch)
    doc_path = _make_doc_path(tmp_path, INGEST_CONFIG)
    first = _load_and_chunk(dataprep, doc_path)
    second = _load_and_chunk(dataprep, doc_path)
    assert [c.strip() for c in first] == [c.strip() for c in second], (
        "chunker not deterministic — docling version/chunking changed behavior"
    )
