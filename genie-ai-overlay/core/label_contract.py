# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Filter-label + graph-set encoding for the chatqna → retriever data contract.

The OPEA MicroService framework creates a dynamic ``__main__`` input type from
the HTTP body when parsing requests at the retriever endpoint. This dynamic type
ONLY preserves standard EmbedDoc fields (``text``, ``embedding``, ``search_type``,
``k``, ``search_start``, ``traversal_*, etc.``). Custom fields like ``context``
are silently dropped — verified via probes (POST body has context, retriever's
parsed input does not).

To pass filter labels AND the authorized graph set through this contract
boundary, encode them in ``search_start`` (a standard EmbedDoc string field
that survives parsing). The string carries up to three segments, order
insensitive, separated by the documented markers:

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

``tags`` (Story 1.6 — frontmatter routing, 2026-10-07): a comma-separated list
of repo IDs whose ``okf_repositories_frontmatter_summary`` rows should be
loaded for the frontmatter routing stage. The BFF writes it from the
authorized graph set, parallel to how it emits ``::graphs:``. Tagging +
vectorization runs at publish time regardless of which search style is
active, so an operator can flip ``OKF_SEARCH_STYLE`` without re-ingesting.
The retriever reads six precomputed combination vectors per repo
(topic/entity/keyword/summary/scope/forbidden) and scores the query against
them with weighted cosine + forbidden penalty. Under the default ``hybrid``
style, the k=40 chunk-probe (Story 1.3) runs as the always-on second stage;
the segment is intersected with the authorized graph set (authorization wins)
and never includes the legacy ``GRAPH`` constant.

Graph names are always ``OKF_<slug>_v<N>`` or the legacy ``GRAPH`` constant
(no commas, no segment markers) so the literal-string ``,`` / ``::`` splitting
is unambiguous. The carrier is additive: a retriever that ignores a segment
ignores it cleanly (legacy chat ignores ``graphs``; a graph-aware retriever
ignores absent ``labels``).

Usage:
    # chatqna (encode, in align_inputs for the RETRIEVER node):
    search_start = encode(base_mode, labels=["Onion"], graphs=["GRAPH", "OKF_kenya-gov_v3"])

    # retriever (decode, at the top of invoke, BEFORE any search_start reads):
    base_mode, labels, graphs = decode(search_start)

Story 1.0b (LG-5 launch gate): the boundary probe
(``_bmad-output/implementation-artifacts/1-0b-boundary-probe-graph-names.md``)
proves graph_names survives the deployed mega-service — Story 1.1 fan-out
cannot merge until that probe is GREEN.
"""

# Filter labels segment marker (Story 1.0b — pre-existing, preserved verbatim)
_LABEL_SEPARATOR = "::labels:"
# Graph names segment marker (Story 1.0b — new, parallel to labels)
_GRAPH_SEPARATOR = "::graphs:"
# No-legacy signal segment marker (Story 1.1 — parallel, value is true/false)
_NO_LEGACY_SEPARATOR = "::no_legacy:"
# Sticky graph segment marker (Story 1.3 — conversation-routed continuity set)
_STICKY_SEPARATOR = "::sticky:"
# Frontmatter tags segment marker (Story 1.6 — per-repo frontmatter routing;
# parallel to ::sticky: in shape and decode semantics).
_TAGS_SEPARATOR = "::tags:"

# The markers every decode pass considers, in peel priority (earliest wins).
_SEGMENTS = (_LABEL_SEPARATOR, _GRAPH_SEPARATOR, _NO_LEGACY_SEPARATOR, _STICKY_SEPARATOR, _TAGS_SEPARATOR)


def encode(
    base_mode: str,
    labels: list[str] | None = None,
    graphs: list[str] | None = None,
    no_legacy: bool = False,
    sticky: list[str] | None = None,
    tags: list[str] | None = None,
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
        tags:      Story 1.6 — repo IDs whose ``okf_repositories_frontmatter_summary``
                   rows should be loaded for the frontmatter routing stage.
                   None/empty = omit segment (byte-identical to the pre-1.6
                   contract). The BFF emits it from the authorized graph set,
                   parallel to ``graphs``.

    Returns:
        Encoded string. Returns ``base_mode`` unchanged when all segments are
        empty/False.
    """
    out = base_mode
    clean_labels = [l.strip() for l in (labels or []) if l and l.strip()]
    if clean_labels:
        out = f"{out}{_LABEL_SEPARATOR}{','.join(clean_labels)}"
    clean_graphs = [g.strip() for g in (graphs or []) if g and g.strip()]
    if clean_graphs:
        out = f"{out}{_GRAPH_SEPARATOR}{','.join(clean_graphs)}"
    if no_legacy:
        out = f"{out}{_NO_LEGACY_SEPARATOR}true"
    clean_sticky = [g.strip() for g in (sticky or []) if g and g.strip()]
    if clean_sticky:
        out = f"{out}{_STICKY_SEPARATOR}{','.join(clean_sticky)}"
    clean_tags = [t.strip() for t in (tags or []) if t and t.strip()]
    if clean_tags:
        out = f"{out}{_TAGS_SEPARATOR}{','.join(clean_tags)}"
    return out


def encode_filter_labels(base_mode: str, labels: list[str]) -> str:
    """Back-compat shim — preserved for the labels-only call sites in chatqna.

    New code should use ``encode`` directly.
    """
    return encode(base_mode, labels=labels)


def _decode_all(search_start: str) -> tuple[str, list[str], list[str], bool, list[str], list[str]]:
    """Full parse of a search_start carrier string (all five segments).

    Returns ``(base_mode, labels, graphs, no_legacy, sticky, tags)``. Missing
    segments are empty lists / False.

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
    tags: list[str] = []

    first = [p for p in (s.find(marker) for marker in _SEGMENTS) if p >= 0]
    if not first:
        return s, labels, graphs, no_legacy, sticky, tags
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
            labels = [label.strip() for label in value.split(",") if label.strip()]
        elif marker is _GRAPH_SEPARATOR:
            graphs = [g.strip() for g in value.split(",") if g.strip()]
        elif marker is _STICKY_SEPARATOR:
            sticky = [g.strip() for g in value.split(",") if g.strip()]
        elif marker is _TAGS_SEPARATOR:
            tags = [t.strip() for t in value.split(",") if t.strip()]
        else:  # _NO_LEGACY_SEPARATOR
            no_legacy = value.strip().lower() in ("true", "1")
    return base_mode, labels, graphs, no_legacy, sticky, tags


def decode(search_start: str) -> tuple[str, list[str], list[str]]:
    """Decode filter labels AND the authorized graph set from a search_start string.

    Args:
        search_start: The raw search_start value (may contain zero, one, or more segments).

    Returns:
        Tuple of ``(base_mode, labels, graphs)``. Missing segments are empty lists.
        The ``::no_legacy:`` segment (Story 1.1), ``::sticky:`` (Story 1.3),
        and ``::tags:`` (Story 1.6) are peeled too — read them with the
        dedicated accessors; they never leak into labels or graphs.

    All segment markers can appear in either order. The format is unambiguous
    because values never contain ``,``+``::`` (graph names are always
    ``OKF_<slug>_v<N>`` or the legacy ``GRAPH`` constant), so we can split
    naively. The parser is ORDER-INSENSITIVE: whichever marker appears FIRST is
    peeled first, and each value runs to the next marker.
    """
    base_mode, labels, graphs, _no_legacy, _sticky, _tags = _decode_all(search_start)
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


def decode_tags(search_start: str) -> list[str]:
    """Read the ``::tags:`` frontmatter-routing repo IDs (Story 1.6).

    Parallel accessor to the ``decode``/``decode_sticky``/``decode_no_legacy``
    family. Returns the repo IDs whose ``okf_repositories_frontmatter_summary``
    rows should be loaded for the frontmatter routing stage (possibly empty).
    An old caller that never reads this accessor ignores the segment cleanly
    — the additive contract holds.
    """
    return _decode_all(search_start)[5]


def decode_filter_labels(search_start: str) -> tuple[str, list[str]]:
    """Back-compat shim — preserved for the labels-only decode call sites in the retriever.

    New code should use ``decode`` directly.
    """
    base_mode, labels, _graphs = decode(search_start)
    return base_mode, labels
