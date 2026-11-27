# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The taint discipline's detection half: retrieved content is data,
never instructions.

One explicit, mechanical scan over a dispatched tool result's TEXT fields —
the retrieved-content channel (a search hit's passage text, a read source's
content) — matching a curated list of instruction-pattern markers. A match
is an ATTEMPTED injection, and an attempt is a recorded finding: the loop
feeds it into the verification ledger, the verdict payload carries it, and
the run's usage record counts it. The scan NEVER changes how the content is
handled — no rejection, no stripping, no behavior change from content: the
content still passes to the model as data (the production prompt states the
discipline; this module makes the attempt visible).

False positives are the safe direction: a legitimate document that merely
contains an instruction-looking sentence gains one recorded finding and
loses nothing. The markers are therefore specific instruction patterns, not
single words — "ignore" alone would fire on ordinary prose.

Error envelopes are not scanned: their text is the adapters' own
infrastructure messaging, not retrieved content.
"""

import re

from capabilities.citations import provenance_identity

from .verification import retrieved_texts

# (marker name, pattern) — the curated instruction-pattern list. Case-
# insensitive; whitespace runs are collapsed by the patterns themselves.
INSTRUCTION_MARKERS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "ignore_previous_instructions",
        re.compile(r"ignore\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier)\s+instructions", re.IGNORECASE),
    ),
    (
        "disregard_instructions",
        re.compile(
            r"disregard\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier)\s+(instructions|rules|directions)",
            re.IGNORECASE,
        ),
    ),
    (
        "forget_instructions",
        re.compile(r"forget\s+(all\s+|everything\s+)?(your\s+)?(instructions|training|rules)", re.IGNORECASE),
    ),
    (
        "do_not_follow_instructions",
        re.compile(r"do\s+not\s+follow\s+(your|the|any|these)\s+(instructions|rules)", re.IGNORECASE),
    ),
    (
        "override_instructions",
        re.compile(
            r"(instructions|rules)\s+override|override\s+(your|the|these)\s+(instructions|rules)", re.IGNORECASE
        ),
    ),
    ("role_reassignment", re.compile(r"you\s+are\s+now\s+(a|an|the)\b", re.IGNORECASE)),
    ("new_instructions_header", re.compile(r"new\s+instructions?\s*:", re.IGNORECASE)),
    ("system_prompt_reveal", re.compile(r"system\s+(prompt|message)\s*:", re.IGNORECASE)),
    ("fake_role_tag", re.compile(r"<\s*/?\s*(system|assistant|developer)\s*>", re.IGNORECASE)),
)

# The label a finding is attributed to, by the tool that served the text:
# the corpus search's hit, the web search's result, the read path's
# content. One map, built once — a map rebuilt per finding is a map that
# can differ from itself between two findings.
_SOURCE_BY_TOOL = {
    "search_knowledge": "search_hit",
    "web_search": "web_result",
}


def scan_text(text: str) -> tuple[str, ...]:
    """The marker names one text matches, in the declared order."""
    if not isinstance(text, str):
        return ()
    return tuple(name for name, pattern in INSTRUCTION_MARKERS if pattern.search(text))


def scan_tool_result(name: str, payload: dict) -> tuple[dict, ...]:
    """Scan one dispatched tool result's retrieved-text fields; return the
    structured findings (empty when the result is clean or cites no text).

    The retrieved texts come from the ledger's shared extraction
    (:func:`agent.verification.retrieved_texts` — one definition of the
    channel, two readers). Each finding names the tool, the matched
    markers, the field the text came from and the source's stable identity
    (``[repo_id, concept_id]`` for an OKF concept, ``[None, file_id]`` for
    a legacy file) — attribution to the document that carried the attempt,
    never a copy of its content.
    """
    findings: list[dict] = []
    for text, provenance, _score in retrieved_texts(name, payload):
        markers = scan_text(text)
        if markers:
            findings.append(
                {
                    "tool": name,
                    "markers": list(markers),
                    "source": _SOURCE_BY_TOOL.get(name, "read_content"),
                    "identity": list(provenance_identity(provenance)),
                }
            )
    return tuple(findings)
