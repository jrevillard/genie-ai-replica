# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The seam vocabulary, pinned on both sides.

The seam's vocabulary is CLOSED and seam-owned (ADR-005): the agent
service emits the kinds, the BFF projects them onto the client frames.

* A kind the seam can emit and the BFF does not project is a HOLE — the
  client would never see that event.
* A kind the BFF projects and the seam cannot emit is a stale branch — a
  case that can never fire.

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

BFF_FRAME_WRITER = Path(__file__).resolve().parents[2] / "gov-chat-backend" / "services" / "agent-frame-writer.js"


def _bff_projected_kinds() -> set[str]:
    """The seam kinds the BFF's frame writer projects, read from its source.

    The writer dispatches on the kind in ONE switch — the seam-event
    handler — and its case labels are the kinds it projects. Reading the
    source (rather than a hand-copied list) is what makes the guard a
    DRIFT guard: the list cannot go stale behind the writer's back.
    """

    source = BFF_FRAME_WRITER.read_text(encoding="utf-8")
    start = source.index("const onSeamEvent")
    end = source.index("\n  };", start)
    return set(re.findall(r"case '([^']+)':", source[start:end]))


def test_the_bff_projects_every_seam_kind():
    """The two sides carry the same vocabulary."""

    assert _bff_projected_kinds() == {kind.value for kind in EventKind}


def test_the_seam_vocabulary_carries_no_client_frame_name():
    """The seam never speaks the client's dialect: a kind value that
    collides with a client frame name would blur who owns the stream."""

    from agent.events import BFF_FRAME_NAMES

    assert {kind.value for kind in EventKind}.isdisjoint(BFF_FRAME_NAMES)
