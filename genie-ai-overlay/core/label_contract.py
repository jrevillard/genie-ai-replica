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

Only two characters are escaped: the comma that separates two labels, and the
escape character itself. A label that CONTAINS the comma separator
(``Births, Deaths and Marriages``) therefore survives the roundtrip instead of
being read as two labels.

Nothing else is escaped. The chatqna and the retriever are deployed
independently, so during a rolling upgrade a new chatqna talks to a retriever
that predates the escaping: that retriever splits the label list on the comma
and takes the labels verbatim. A label that contains a space must therefore
reach it as itself — percent-encoding it would make the retriever filter on
``Tax%20Payment`` and match no chunk at all.

The deployment order matters, and it is the retriever that must go first. A
retriever predating the escaping reads a label containing the ESCAPE
CHARACTER (``%``) as its escaped form — ``50% Discount`` travels as
``50%25 Discount`` and matches no chunk — exactly like a space would have
under percent-encoding. So the escaping is not free for labels that contain
``%``: it is the price of making the comma reversible, and the price is paid
only during the window in which a new chatqna meets an old retriever. Update
the retriever before the chatqna; the two escaped characters are the only
labels exposed to that window.

Usage:
    # chatqna (encode, in align_inputs for the RETRIEVER node):
    search_start = encode_filter_labels(base_mode, ["Onion", "Vegetables"])

    # retriever (decode, at the top of invoke, BEFORE any search_start reads):
    base_mode, labels = decode_filter_labels(search_start)

The SCOPE a context asks for is built by :func:`build_filter_labels`, which
both the chatqna and the retriever use so the two entry points cannot drift
apart.
"""

_LABEL_SEPARATOR = "::labels:"
_LABEL_SEPARATOR_CHAR = ","
_ESCAPE_CHAR = "%"
_ESCAPED_SEPARATOR = "%2C"
_ESCAPED_ESCAPE = "%25"


def _encode_label(label: str) -> str:
    """Escape the two characters the wire format gives a meaning to.

    The comma separates two labels, so a label that contains one has to be
    escaped or the decoder reads it as two labels. The escape character itself
    has to be escaped so the decoding is reversible.
    """
    return label.replace(_ESCAPE_CHAR, _ESCAPED_ESCAPE).replace(_LABEL_SEPARATOR_CHAR, _ESCAPED_SEPARATOR)


def _decode_label(label: str) -> str:
    """Reverse :func:`_encode_label`.

    The separator is decoded first: the escaped form of the escape character
    (``%25``) must not be mistaken for an escaped separator.
    """
    return label.replace(_ESCAPED_SEPARATOR, _LABEL_SEPARATOR_CHAR).replace(_ESCAPED_ESCAPE, _ESCAPE_CHAR)


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
    return f"{base_mode}{_LABEL_SEPARATOR}{','.join(_encode_label(label) for label in clean)}"


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
    # A label that was never encoded decodes to itself, so a search_start
    # written before the encoding existed still decodes to the same label.
    labels = [_decode_label(label.strip()) for label in parts[1].split(",") if label.strip()]
    return base_mode, labels


def _as_label_list(value) -> list:
    """Coerce one context label field into a list of labels.

    A scalar becomes a single-element list; a list is taken as-is. An empty
    value contributes nothing. A bare string is a SINGLE label — never a
    sequence of characters.
    """
    if not value:
        return []
    if isinstance(value, list):
        return list(value)
    return [str(value)]


def build_filter_labels(context: dict) -> list[str]:
    """Build the retriever filter-label list from a retrieval context.

    The CATEGORY and the SERVICE are two dimensions of one scope: a service
    lives inside a category. The retriever applies its label filter as a UNION
    of the labels it receives (the ``OR`` filter strategy), and a chunk is
    labelled from the taxonomy — a chunk of a SIBLING service in the same
    category can carry the CATEGORY label. A filter carrying the category AND
    the service therefore matches every chunk of the parent category, and the
    service scope would leak into the whole category. The service labels are
    therefore the filter whenever they exist; the category filters on its own.

    Accepts both ``categoryLabel`` (singular — the contract the frontend and
    the backend send) and ``categoryLabels`` (plural — legacy), plus
    ``serviceLabels``. Singular values are coerced to a single-element list.
    Null/empty values add nothing (no category filter).

    Args:
        context: The ``context`` dict from the chat request.

    Returns:
        A flat list of filter labels (may be empty = no filter).
    """
    if not context:
        return []
    labels: list[str] = []
    service_labels = context.get("serviceLabels")
    if service_labels:
        # The service is the narrower scope — the category must not widen it.
        labels.extend(_as_label_list(service_labels))
    else:
        labels.extend(_as_label_list(context.get("categoryLabel")))
        labels.extend(_as_label_list(context.get("categoryLabels")))
    # Coerce + dedup while preserving order. Non-string non-list entries are
    # stringified (defensive against malformed clients); falsy values dropped.
    seen: set[str] = set()
    deduped: list[str] = []
    for label in labels:
        if not label:
            continue
        normalized = label if isinstance(label, str) else str(label)
        if normalized not in seen:
            seen.add(normalized)
            deduped.append(normalized)
    return deduped
