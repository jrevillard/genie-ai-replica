"""Adapters bridge the test runner to a concrete RAG implementation.

Each adapter takes a list of TestCase dicts and returns a list of
SystemResponse dicts containing `{answer, retrieved_context, ...}`.
"""

from dataclasses import dataclass, field


@dataclass
class TestCase:
    id: str
    question: str
    labels: list[str] = field(default_factory=list)
    should_abstain: bool = False
    must_mention_one_of: list[str] = field(default_factory=list)
    must_not_mention: list[str] = field(default_factory=list)
    must_cite: bool = False
    notes: str = ""


@dataclass
class SystemResponse:
    test_id: str
    answer: str
    # The chunks the system actually retrieved, formatted as a single string
    # (e.g. each chunk prefixed with `From "<title>":`). The judge needs to
    # see exactly what the LLM saw to assess grounding.
    retrieved_context: str
    # Any adapter-specific diagnostics worth preserving in the report.
    extra: dict = field(default_factory=dict)
