# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The seam vocabulary, pinned on both sides.

The seam's vocabulary is CLOSED and seam-owned (ADR-005): the agent
service emits the kinds, the BFF projects them onto the client frames.

* A kind the seam can emit and the BFF does not project is a HOLE — the
  client would never see that event.
* A kind a consumer projects and the seam cannot emit is a stale branch —
  a case that can never fire.

BOTH consumers are pinned: the frame writer (the streaming answer) and the
JSON result (the non-streaming answer). Each dispatches on the kind in ONE
switch, and its case labels are the kinds it projects — so the guard reads
them from the source, and a case that is renamed or added on either side
turns the guard red.

The guard lives HERE, in the agent service's lane, because the backend's
CI job does not run on the agent service's changes: a guard that only ran
in the backend's lane would miss a vocabulary change. The lane's rules
list the BFF's seam files too, so the guard also runs when the CONSUMER
changes.

The frozen contract these two sides implement is
``docs/agentic-wire-contract.md``.
"""

import re
from pathlib import Path

from agent.events import EventKind

BFF_SERVICES = Path(__file__).resolve().parents[2] / "gov-chat-backend" / "services"
FRAME_WRITER = BFF_SERVICES / "agent-frame-writer.js"
JSON_RESULT = BFF_SERVICES / "agent-json-result.js"

# The kinds the JSON (non-streaming) answer does not carry: the tool
# activity frames belong to the STREAM's frames; the JSON answer carries
# the text, the verdict and the terminal. It is a documented SUBSET, not a
# hole — the streaming answer is the one that shows the activity.
JSON_RESULT_OMITS = frozenset({"tool_call_started", "tool_call_finished"})


def _projected_kinds(path: Path) -> set[str]:
    """The seam kinds one consumer projects, read from its source.

    The consumer dispatches on the kind in ONE switch (``switch
    (event.kind)``) and its case labels ARE the kinds it projects.
    Reading the source (rather than a hand-copied list) is what makes the
    guard a DRIFT guard: the list cannot go stale behind the consumer's
    back.

    The extraction accepts BOTH quote spellings (a prettier run rewrites
    single quotes to double ones, and a formatting-only change must not
    turn the guard red), and it fails LOUDLY when the switch is not where
    it is expected: a silently empty set would make the guard green for a
    consumer that projects nothing.
    """

    source = path.read_text(encoding="utf-8")
    switch = re.search(r"switch\s*\(\s*event\.kind\s*\)", source)
    assert switch is not None, f"{path.name} has no switch on the seam kind"
    depth = 0
    end = len(source)
    for index in range(switch.end(), len(source)):
        char = source[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                end = index
                break
    labels = re.findall(r"case\s+(['\"])([^'\"]+)\1\s*:", source[switch.end() : end])
    assert labels, f"{path.name} projects no seam kind"
    return {label for _quote, label in labels}


def test_the_bff_projects_every_seam_kind():
    """The two sides carry the same vocabulary."""

    assert _projected_kinds(FRAME_WRITER) == {kind.value for kind in EventKind}


def test_the_json_consumer_projects_no_kind_the_seam_cannot_emit():
    """A case that can never fire is a stale branch."""

    assert _projected_kinds(JSON_RESULT) <= {kind.value for kind in EventKind}


def test_the_json_consumer_carries_the_answer_frames():
    """The JSON answer carries the text, the verdict and the terminal.

    The tool activity frames are the STREAM's frames: the JSON answer does
    not carry them — a documented subset, not a hole.
    """

    assert _projected_kinds(JSON_RESULT) == {kind.value for kind in EventKind} - JSON_RESULT_OMITS
