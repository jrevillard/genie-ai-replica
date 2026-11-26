# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The driven ports of the document capability and the adapters that satisfy them."""

import inspect

from capabilities.adapters.chunks import LegacyChunkAdapter
from capabilities.adapters.docrepo import DocRepoAdapter
from capabilities.adapters.okf import OkfAdapter
from capabilities.sources import ChunkReader, ConceptSource, DocumentMetadataSource

PAIRS = (
    (LegacyChunkAdapter, ChunkReader),
    (DocRepoAdapter, DocumentMetadataSource),
    (OkfAdapter, ConceptSource),
)


def test_the_corpus_adapters_satisfy_the_driven_ports() -> None:
    for adapter, port in PAIRS:
        assert issubclass(adapter, port), f"{adapter.__name__} does not satisfy {port.__name__}"


def test_the_driven_ports_pin_the_adapters_signatures() -> None:
    """The member NAMES are not the contract.

    ``runtime_checkable`` checks the names alone: an adapter that drops the
    ``bearer`` parameter — or reorders it, or makes it keyword-only —
    stays a structural match while the executor's positional call breaks
    at the first read. The signatures are the contract, so they are
    compared.
    """

    for adapter, port in PAIRS:
        for name in _members(port):
            # Both sides are unbound functions: the port's method and the
            # adapter's carry the same ``self``, so the signatures compare
            # as they are.
            expected = _signature(getattr(port, name))
            actual = _signature(getattr(adapter, name))
            assert actual == expected, f"{adapter.__name__}.{name} does not match {port.__name__}.{name}"


def _members(port) -> list[str]:
    """The port's public members — the ones the executor calls."""

    return [name for name in dir(port) if not name.startswith("_")]


def _signature(method) -> list[tuple[str, object]]:
    """A method's parameters: the name and the kind, in order."""

    return [(name, parameter.kind) for name, parameter in inspect.signature(method).parameters.items()]
