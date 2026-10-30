# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Filter-label + graph-set encoding for the chatqna → retriever data contract.

The OPEA MicroService framework creates a dynamic ``__main__`` input type from
the HTTP body when parsing requests at the retriever endpoint. This dynamic type
ONLY preserves standard EmbedDoc fields (``text``, ``embedding``, ``search_type``,
``k``, ``search_start``, ``traversal_max_depth``, ``traversal_max_returned``, etc.).
Custom fields like ``context`` are silently dropped — verified via probes (POST
body has context, retriever's parsed input does not).

To pass filter labels AND the authorized graph set through this contract
boundary, encode them in ``search_start`` (a standard EmbedDoc string field
that survives parsing). The string carries up to FOUR segments, order
insensitive, separated by the documented markers (labels, graphs, no_legacy,
sticky):

    {base_mode}::labels:{label1},{label2},...::graphs:{g1},{g2},...::no_legacy:{true|false}

Examples:
    chunk::labels:Onion,Vegetables
    chunk::graphs:GRAPH,OKF_kenya-gov_v3
    chunk::labels:Onion,Vegetables::graphs:GRAPH,OKF_kenya-gov_v3
    chunk::graphs:OKF_kenya-gov_v3::no_legacy:true

``no_legacy`` (Story 1.1 — the resolved Open Question, 2026-10-06): when
``true``, the retriever must NEVER fall back to the legacy ``GRAPH`` free-form
corpus — ``okf_only`` means OKF only. The BFF sends it whenever the runtime
mode is ``okf_only`` (engaged or not); the retriever's legacy fallback refuses
to run when the segment is present. The segment never changes the fan-out
ENGAGEMENT decision (that stays driven by the graph list alone — Story 1.0
Decision D); it only governs the legacy fallback.

``sticky`` (Story 1.3 — query-affinity routing continuity): graph names the
BFF persisted for THIS conversation (the routed set that contributed previous
answers). The retriever searches sticky graphs unconditionally — they bypass
the affinity-qualification rule (≥3 chunks in the global top-40) so that a
signal-free follow-up ("why are they missing from the table?") stays locked to
the conversation's subject. The segment is intersected with the authorized
graph set (authorization always wins) and never includes the legacy ``GRAPH``
constant (the legacy leg is outside routing entirely).

Graph names are always ``OKF_<slug>_v<N>`` or the legacy ``GRAPH`` constant
(no commas, no segment markers) so the literal-string ``,`` / ``::`` splitting
is unambiguous. The carrier is additive: a retriever that ignores a segment
ignores it cleanly (legacy chat ignores ``graphs``; a graph-aware retriever
ignores absent ``labels``).

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
``%``: it is the price of making the comma reversible, and that price is paid
only during the window in which a new chatqna meets an old retriever. Update
the retriever before the chatqna.

A label that contains the COMMA is exposed in BOTH orders, and no
deployment order keeps it working during the window: a new chatqna sends it
escaped (``Births%2C Deaths``) and a retriever predating the escaping
filters on that literal, while an old chatqna sends it raw and the new
retriever splits it into two labels. Either way the filter matches no chunk
and the query ABSTAINS — it never answers from outside the scope. The
exposure lasts as long as the rolling upgrade does: once both ends run the
escaping, the label round-trips and matches the corpus again.

Usage:
    # chatqna (encode, in align_inputs for the RETRIEVER node):
    search_start = encode(base_mode, labels=["Onion"], graphs=["GRAPH", "OKF_kenya-gov_v3"])

    # retriever (decode, at the top of invoke, BEFORE any search_start reads):
    base_mode, labels, graphs = decode(search_start)

The SCOPE a context asks for is built by :func:`build_filter_labels`, which
both the chatqna and the retriever use so the two entry points cannot drift
apart.
"""

# Filter labels segment marker (Story 1.0b — pre-existing, preserved verbatim)
_LABEL_SEPARATOR = "::labels:"
# Graph names segment marker (Story 1.0b — new, parallel to labels)
_GRAPH_SEPARATOR = "::graphs:"
# No-legacy signal segment marker (Story 1.1 — parallel, value is true/false)
_NO_LEGACY_SEPARATOR = "::no_legacy:"
# Sticky graph segment marker (Story 1.3 — conversation-routed continuity set)
_STICKY_SEPARATOR = "::sticky:"
_LABEL_SEPARATOR_CHAR = ","
_MARKER_CHAR = ":"
_ESCAPE_CHAR = "%"
_ESCAPED_SEPARATOR = "%2C"
_ESCAPED_MARKER = "%3A"
_ESCAPED_ESCAPE = "%25"


def _encode_label(label: str) -> str:
    """Escape the two characters the wire format gives a meaning to.

    The comma separates two labels, so a label that contains one has to be
    escaped or the decoder reads it as two labels. The escape character itself
    has to be escaped so the decoding is reversible.
    """
    return (
        label.replace(_ESCAPE_CHAR, _ESCAPED_ESCAPE)
        .replace(_MARKER_CHAR, _ESCAPED_MARKER)
        .replace(_LABEL_SEPARATOR_CHAR, _ESCAPED_SEPARATOR)
    )


def _decode_label(label: str) -> str:
    """Reverse :func:`_encode_label`.

    The separator is decoded first: the escaped form of the escape character
    (``%25``) must not be mistaken for an escaped separator.
    """
    return (
        label.replace(_ESCAPED_SEPARATOR, _LABEL_SEPARATOR_CHAR)
        .replace(_ESCAPED_MARKER, _MARKER_CHAR)
        .replace(_ESCAPED_ESCAPE, _ESCAPE_CHAR)
    )


# The markers every decode pass considers, in peel priority (earliest wins).
_SEGMENTS = (_LABEL_SEPARATOR, _GRAPH_SEPARATOR, _NO_LEGACY_SEPARATOR, _STICKY_SEPARATOR)


def encode(
    base_mode: str,
    labels: list[str] | None = None,
    graphs: list[str] | None = None,
    no_legacy: bool = False,
    sticky: list[str] | None = None,
) -> str:
    """Encode filter labels AND/OR the authorized graph set into a search_start string.

    Args:
        base_mode: The original search_start value (e.g. ``"chunk"``, ``"node"``).
        labels:    Filter labels (category + service labels). None/empty = omit segment.
        graphs:    Authorized graph names (e.g. ``["GRAPH", "OKF_kenya-gov_v3"]``).
                   None/empty = omit segment.
        no_legacy: Story 1.1 — emit the ``::no_legacy:true`` segment (the
                   retriever must never fall back to the legacy free-form
                   corpus). Default False = segment omitted (byte-identical
                   to the pre-1.1 contract).
        sticky:    Story 1.3 — conversation-routed graph names the retriever must
                   search unconditionally (affinity-continuity set). None/empty =
                   omit segment (byte-identical to the pre-1.3 contract).

    Returns:
        Encoded string. Returns ``base_mode`` unchanged when all segments are
        empty/False.
    """
    out = base_mode
    if labels:
        # The label travels VERBATIM: the hierarchy's translation - with
        # whatever whitespace it carries - is the very string the dataprep
        # minted the chunk_labels from. Stripping it here would make a padded
        # translation (' Tomato ') match no chunk ever, an abstention the
        # client's drift check cannot see (the tree DOES carry the label).
        # Only a label that is nothing at all (None, '') is dropped - and a
        # whitespace-only one is KEPT, so a scope that is not a label stays a
        # filter (matching nothing) instead of quietly becoming no filter
        # (the whole corpus answering).
        clean_labels = [l for l in labels if l]
        if clean_labels:
            out = f"{out}{_LABEL_SEPARATOR}{','.join(_encode_label(l) for l in clean_labels)}"
    clean_graphs = [g.strip() for g in (graphs or []) if g and g.strip()]
    if clean_graphs:
        out = f"{out}{_GRAPH_SEPARATOR}{','.join(clean_graphs)}"
    if no_legacy:
        out = f"{out}{_NO_LEGACY_SEPARATOR}true"
    clean_sticky = [g.strip() for g in (sticky or []) if g and g.strip()]
    if clean_sticky:
        out = f"{out}{_STICKY_SEPARATOR}{','.join(clean_sticky)}"
    return out


def encode_filter_labels(base_mode: str, labels: list[str]) -> str:
    """Back-compat shim — preserved for the labels-only call sites in chatqna.

    New code should use ``encode`` directly.
    """
    return encode(base_mode, labels=labels)


def _decode_all(search_start: str) -> tuple[str, list[str], list[str], bool, list[str]]:
    """Full parse of a search_start carrier string (all four segments).

    Returns ``(base_mode, labels, graphs, no_legacy, sticky)``. Missing segments
    are empty lists / False.

    The segment markers can appear in ANY order. The format is unambiguous
    because values never contain ``::`` (labels are service names, graph names
    are ``OKF_<slug>_v<N>`` or the legacy ``GRAPH`` constant, the no_legacy
    value is ``true``/``false``), so the parser peels whichever marker appears
    earliest, consumes its value up to the NEXT marker (or end of string), and
    repeats until no marker remains. Everything before the first marker is the
    base mode.
    """
    s = str(search_start) if search_start is not None else ""
    labels: list[str] = []
    graphs: list[str] = []
    no_legacy = False
    sticky: list[str] = []

    first = [p for p in (s.find(marker) for marker in _SEGMENTS) if p >= 0]
    if not first:
        return s, labels, graphs, no_legacy, sticky
    base_mode = s[: min(first)]
    rest = s[min(first) :]
    while rest:
        # Find the earliest marker in the remainder — it starts a segment.
        starts = [(rest.find(marker), marker) for marker in _SEGMENTS]
        starts = [(p, m) for p, m in starts if p >= 0]
        if not starts:
            break
        pos, marker = min(starts)
        if pos > 0:
            # Text before a marker that no segment claims — the encoder never
            # produces this; skip it defensively instead of mis-parsing.
            rest = rest[pos:]
            continue
        rest = rest[len(marker) :]
        # The segment VALUE runs until the next marker (or end of string).
        nexts = [p for p in (rest.find(m) for m in _SEGMENTS) if p >= 0]
        end = min(nexts) if nexts else len(rest)
        value, rest = rest[:end], rest[end:]
        if marker is _LABEL_SEPARATOR:
            # Labels travel verbatim + escaped (see encode): split on the raw
            # comma FIRST (an encoded label carries no raw comma - it is
            # %2C), then unescape each piece. No strip: the decoded label is
            # exactly the string that was encoded.
            labels = [_decode_label(label) for label in value.split(",") if label]
        elif marker is _GRAPH_SEPARATOR:
            # Same escaped-wire treatment; a no-op on the minted graph-name
            # shape (OKF_<slug>_v<N> / GRAPH) and symmetric with encode.
            graphs = [_decode_label(g) for g in value.split(",") if g]
        elif marker is _STICKY_SEPARATOR:
            sticky = [_decode_label(g) for g in value.split(",") if g]
        else:  # _NO_LEGACY_SEPARATOR
            no_legacy = value.strip().lower() in ("true", "1")
    return base_mode, labels, graphs, no_legacy, sticky


def decode(search_start: str) -> tuple[str, list[str], list[str]]:
    """Decode filter labels AND the authorized graph set from a search_start string.

    Args:
        search_start: The raw search_start value (may contain zero, one, or more segments).

    Returns:
        Tuple of ``(base_mode, labels, graphs)``. Missing segments are empty lists.
        The ``::no_legacy:`` segment (Story 1.1) is peeled too — read it with
        ``decode_no_legacy``; it never leaks into labels or graphs.

    All segment markers can appear in either order. The format is unambiguous
    because values never contain ``,``+``::`` (graph names are always
    ``OKF_<slug>_v<N>`` or the legacy ``GRAPH`` constant), so we can split
    naively. The parser is ORDER-INSENSITIVE: whichever marker appears FIRST is
    peeled first, and each value runs to the next marker.
    """
    base_mode, labels, graphs, _no_legacy, _sticky = _decode_all(search_start)
    return base_mode, labels, graphs


def decode_no_legacy(search_start: str) -> bool:
    """Read the ``::no_legacy:`` signal segment from a search_start string.

    Story 1.1 — parallel accessor to the ``decode``/``decode_filter_labels``
    family (``decode`` keeps its 3-tuple signature so every pre-1.1 caller
    unpacks it unchanged). Returns True only when the segment is present with
    a true value (``true``/``1``); any other value or absence returns False
    (the legacy path stays untouched by default).
    """
    return _decode_all(search_start)[3]


def decode_sticky(search_start: str) -> list[str]:
    """Read the ``::sticky:`` conversation-continuity graph set (Story 1.3).

    Parallel accessor to the ``decode``/``decode_no_legacy`` family. Returns
    the sticky graph names (possibly empty). An old caller that never reads
    this accessor ignores the segment cleanly — the additive contract holds.
    """
    return _decode_all(search_start)[4]


def decode_filter_labels(search_start: str) -> tuple[str, list[str]]:
    """Back-compat shim — preserved for the labels-only decode call sites in the retriever.

    New code should use ``decode`` directly.
    """
    base_mode, labels, _graphs = decode(search_start)
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
    # A label that is NOTHING ('' — not a whitespace-only one, which is a
    # KEPT label) is not a scope: a list of them must not take the service
    # branch and eclipse the DECLARED category, or the query would run
    # unfiltered outside the scope the request named.
    # A None entry is no label at all — like the empty string, it must
    # not take the service branch and eclipse the declared category.
    # A whitespace-only label is KEPT (the wire is verbatim).
    service_list = [l for l in _as_label_list(service_labels) if l is not None and l != ""]
    if service_list:
        # The service is the narrower scope — the category must not widen it.
        labels.extend(service_list)
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
