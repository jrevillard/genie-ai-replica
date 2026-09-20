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
that survives parsing). The string carries up to two segments, order
insensitive, separated by the documented markers:

    {base_mode}::labels:{label1},{label2},...::graphs:{g1},{g2},...

Examples:
    chunk::labels:Onion,Vegetables
    chunk::graphs:GRAPH,OKF_kenya-gov_v3
    chunk::labels:Onion,Vegetables::graphs:GRAPH,OKF_kenya-gov_v3

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


def encode(base_mode: str, labels: list[str] | None = None, graphs: list[str] | None = None) -> str:
    """Encode filter labels AND/OR the authorized graph set into a search_start string.

    Args:
        base_mode: The original search_start value (e.g. ``"chunk"``, ``"node"``).
        labels:    Filter labels (category + service labels). None/empty = omit segment.
        graphs:    Authorized graph names (e.g. ``["GRAPH", "OKF_kenya-gov_v3"]``).
                   None/empty = omit segment.

    Returns:
        Encoded string. Returns ``base_mode`` unchanged when both segments are empty.
    """
    out = base_mode
    clean_labels = [l.strip() for l in (labels or []) if l and l.strip()]
    if clean_labels:
        out = f"{out}{_LABEL_SEPARATOR}{','.join(clean_labels)}"
    clean_graphs = [g.strip() for g in (graphs or []) if g and g.strip()]
    if clean_graphs:
        out = f"{out}{_GRAPH_SEPARATOR}{','.join(clean_graphs)}"
    return out


def encode_filter_labels(base_mode: str, labels: list[str]) -> str:
    """Back-compat shim — preserved for the labels-only call sites in chatqna.

    New code should use ``encode`` directly.
    """
    return encode(base_mode, labels=labels)


def decode(search_start: str) -> tuple[str, list[str], list[str]]:
    """Decode filter labels AND the authorized graph set from a search_start string.

    Args:
        search_start: The raw search_start value (may contain zero, one, or both segments).

    Returns:
        Tuple of ``(base_mode, labels, graphs)``. Missing segments are empty lists.

    Both segment markers (``::labels:`` and ``::graphs:``) can appear in either
    order. The format is unambiguous because graph names never contain ``,`` or
    ``::`` (always ``OKF_<slug>_v<N>`` or the legacy ``GRAPH`` constant), so we
    can split naively and the other marker cannot appear inside a value list.
    The implementation strips one marker per pass, so both are peeled regardless
    of order.
    """
    s = str(search_start) if search_start is not None else ""
    base_mode = s
    labels: list[str] = []
    graphs: list[str] = []

    # Both markers can appear in either order. The format is unambiguous because
    # graph names never contain `,` or `::`, but the parsing must be ORDER-
    # INSENSITIVE: peel whichever marker appears FIRST in `base_mode` first,
    # then re-check the remainder for the other marker (it may now be in the
    # base mode OR in the segment we just peeled off). At most 2 peels.
    for _ in range(2):
        i_labels = base_mode.find(_LABEL_SEPARATOR)
        i_graphs = base_mode.find(_GRAPH_SEPARATOR)
        # pick the marker that appears earliest; if only one is present, take it
        if i_labels >= 0 and (i_graphs < 0 or i_labels < i_graphs):
            head, _, tail = base_mode.partition(_LABEL_SEPARATOR)
            base_mode = head
            # the tail may contain the OTHER marker (graphs segment) — peel again
            if _GRAPH_SEPARATOR in tail:
                g_head, _, g_tail = tail.partition(_GRAPH_SEPARATOR)
                labels = [label.strip() for label in g_head.split(",") if label.strip()]
                graphs = [g.strip() for g in g_tail.split(",") if g.strip()]
                break  # both segments peeled
            labels = [label.strip() for label in tail.split(",") if label.strip()]
        elif i_graphs >= 0 and (i_labels < 0 or i_graphs < i_labels):
            head, _, tail = base_mode.partition(_GRAPH_SEPARATOR)
            base_mode = head
            if _LABEL_SEPARATOR in tail:
                l_head, _, l_tail = tail.partition(_LABEL_SEPARATOR)
                graphs = [g.strip() for g in l_head.split(",") if g.strip()]
                labels = [label.strip() for label in l_tail.split(",") if label.strip()]
                break
            graphs = [g.strip() for g in tail.split(",") if g.strip()]
        else:
            break
    return base_mode, labels, graphs


def decode_filter_labels(search_start: str) -> tuple[str, list[str]]:
    """Back-compat shim — preserved for the labels-only decode call sites in the retriever.

    New code should use ``decode`` directly.
    """
    base_mode, labels, _graphs = decode(search_start)
    return base_mode, labels
