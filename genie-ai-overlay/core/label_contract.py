# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Filter-label encoding for the chatqna → retriever data contract.

The OPEA MicroService framework creates a dynamic ``__main__`` input type from
the HTTP body when parsing requests at the retriever endpoint. This dynamic type
ONLY preserves standard EmbedDoc fields (``text``, ``embedding``, ``search_type``,
``k``, ``search_start``, ``traversal_*``, etc.). Custom fields like ``context``
are silently dropped — verified via probes (POST body has context, retriever's
parsed input does not).

To pass filter labels through this contract boundary, encode them in
``search_start`` (a standard EmbedDoc string field that survives parsing).

Format: ``{base_mode}::labels:{label1},{label2},...``
Example: ``chunk::labels:Onion,Vegetables``

Usage:
    # chatqna (encode, in align_inputs for the RETRIEVER node):
    search_start = encode_filter_labels(base_mode, ["Onion", "Vegetables"])

    # retriever (decode, at the top of invoke, BEFORE any search_start reads):
    base_mode, labels = decode_filter_labels(search_start)
"""

_LABEL_SEPARATOR = "::labels:"


def encode_filter_labels(base_mode: str, labels: list[str]) -> str:
    """Encode filter labels into a search_start string.

    Args:
        base_mode: The original search_start value (e.g. ``"chunk"``, ``"node"``).
        labels: Filter labels (category + service labels).

    Returns:
        Encoded string like ``"chunk::labels:Onion,Vegetables"``.
        If labels is empty, returns base_mode unchanged.
    """
    if not labels:
        return base_mode
    clean = [l.strip() for l in labels if l and l.strip()]
    if not clean:
        return base_mode
    return f"{base_mode}{_LABEL_SEPARATOR}{','.join(clean)}"


def decode_filter_labels(search_start: str) -> tuple[str, list[str]]:
    """Decode filter labels from a search_start string.

    Args:
        search_start: The raw search_start value (may contain encoded labels).

    Returns:
        Tuple of (base_mode, labels). If no labels are encoded, returns
        (search_start, []).
    """
    if _LABEL_SEPARATOR not in str(search_start):
        return str(search_start), []
    parts = str(search_start).split(_LABEL_SEPARATOR, 1)
    base_mode = parts[0]
    labels = [label.strip() for label in parts[1].split(",") if label.strip()]
    return base_mode, labels
