# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The driven ports of the document capability and the adapters that satisfy them."""

from capabilities.adapters.chunks import LegacyChunkAdapter
from capabilities.adapters.docrepo import DocRepoAdapter
from capabilities.adapters.okf import OkfAdapter
from capabilities.sources import ChunkReader, ConceptSource, DocumentMetadataSource


def test_the_corpus_adapters_satisfy_the_driven_ports() -> None:
    for adapter, port in (
        (LegacyChunkAdapter, ChunkReader),
        (DocRepoAdapter, DocumentMetadataSource),
        (OkfAdapter, ConceptSource),
    ):
        assert issubclass(adapter, port), f"{adapter.__name__} does not satisfy {port.__name__}"
