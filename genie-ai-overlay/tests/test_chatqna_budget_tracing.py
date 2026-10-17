# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Blend / history / prompt-budget attributes and the context-budget event.

The guard that truncates chat history to fit the LLM window fired silently for
weeks: only a warning log said so, and the numbers an operator needs to explain
a truncated turn were never in one place. One event plus two counts turns "read
the code" into a query.

An OTel EVENT HAS NO PARENT -- it is an attribute-on-a-span, not an entity, so
"the event's parent is the orchestrate span" is not expressible. The invariant is
that the span carrying the event IS the orchestrate span, which only the wiring
test (TestAlignInputsWiring) can observe: it drives the real align_inputs under
a real orchestrate span instead of handing add_event a hand-built one.
"""

import ast
from enum import Enum
from pathlib import Path
from unittest.mock import MagicMock, patch

import chatqna.genieai_chatqna as chatqna_module
from core.span_attrs import ATTRIBUTE_NAMES as A
from core.span_attrs import assert_no_free_text

CHATQNA_SOURCE = Path(chatqna_module.__file__)


class FakeServiceType(Enum):
    """Mirror of the ServiceType members align_inputs compares against."""

    TRANSLATOR = "translator"
    EMBEDDING = "embedding"
    RETRIEVER = "retriever"
    RERANK = "rerank"
    LLM = "llm"


class _MarkerTokenizer:
    """Additive tokenizer: 1000 tokens per SYSTOK, 100 per RAGTOK, 500 per HISTTOK."""

    def encode(self, text):
        return [0] * (1000 * text.count("SYSTOK") + 100 * text.count("RAGTOK") + 500 * text.count("HISTTOK"))


def _service_node():
    node = MagicMock()
    node.service_type = FakeServiceType.LLM
    return node


class TestPromptBudgetAttributes:
    def test_records_all_three(self):
        attrs = chatqna_module._prompt_budget_attributes(32768, 1024, 2100)
        assert attrs[A["rag_prompt_window_tokens"]] == 32768
        assert attrs[A["rag_prompt_answer_budget_tokens"]] == 1024
        assert attrs[A["rag_prompt_tokens_estimate"]] == 2100

    def test_absent_values_are_omitted_not_nulled(self):
        attrs = chatqna_module._prompt_budget_attributes(None, None, 2100)
        assert A["rag_prompt_window_tokens"] not in attrs
        assert A["rag_prompt_answer_budget_tokens"] not in attrs
        assert attrs[A["rag_prompt_tokens_estimate"]] == 2100


class TestResolveAnswerBudgetTokens:
    """The span attribute and the truncation event must never disagree.

    Both sites read the reserve through this helper, so a request that omits
    max_tokens resolves to the fallback in the span attribute too -- rather
    than the attribute being omitted while the event reports the fallback.
    """

    def test_explicit_value_wins(self):
        assert chatqna_module._resolve_answer_budget_tokens(1024) == 1024

    def test_absent_and_zero_both_fall_back_to_the_default(self):
        default = chatqna_module.DEFAULT_MAX_ANSWER_TOKENS
        assert chatqna_module._resolve_answer_budget_tokens(None) == default
        assert chatqna_module._resolve_answer_budget_tokens(0) == default


class TestBlendAttributes:
    def test_records_the_resolved_alpha_not_the_default(self):
        attrs = chatqna_module._blend_attributes(True, 0.42, 2)
        assert attrs[A["rag_blend_enabled"]] is True
        assert attrs[A["rag_blend_alpha"]] == 0.42
        assert attrs[A["rag_blend_history_turns"]] == 2

    def test_disabled_blend_omits_alpha(self):
        attrs = chatqna_module._blend_attributes(False, None, 0)
        assert attrs[A["rag_blend_enabled"]] is False
        assert A["rag_blend_alpha"] not in attrs
        assert attrs[A["rag_blend_history_turns"]] == 0

    def test_enabled_without_fed_history_omits_alpha(self):
        """A first turn feeds the blend nothing: no weight was in play."""
        attrs = chatqna_module._blend_attributes(True, None, 0)
        assert attrs[A["rag_blend_enabled"]] is True
        assert A["rag_blend_alpha"] not in attrs
        assert attrs[A["rag_blend_history_turns"]] == 0


class TestResolvedBlendSettings:
    """Per-request resolution: the configured turn count is an upper bound."""

    def _with_flags(self, monkeypatch, enabled, turns, alpha=0.7):
        monkeypatch.setattr(chatqna_module, "MULTI_TURN_BLEND_ENABLED", enabled)
        monkeypatch.setattr(chatqna_module, "MULTI_TURN_HISTORY_TURNS", turns)
        monkeypatch.setattr(chatqna_module, "MULTI_TURN_BLEND_ALPHA", alpha)

    def test_disabled_configuration_resolves_to_nothing(self, monkeypatch):
        self._with_flags(monkeypatch, False, 3)
        assert chatqna_module._resolved_blend_settings("USER: a |<-MSG->| USER: b") == (False, None, 0)

    def test_zero_turns_resolves_to_disabled(self, monkeypatch):
        self._with_flags(monkeypatch, True, 0)
        assert chatqna_module._resolved_blend_settings("USER: a |<-MSG->| USER: b") == (False, None, 0)

    def test_counts_only_the_segments_this_request_actually_fed(self, monkeypatch):
        self._with_flags(monkeypatch, True, 2, alpha=0.31)
        # 4 segments -> last is the query, 3 prior, only the newest 2 are fed.
        blob = " |<-MSG->| ".join(["USER: t0", "USER: t1", "USER: t2", "USER: query"])
        assert chatqna_module._resolved_blend_settings(blob) == (True, 0.31, 2)

    def test_first_turn_feeds_nothing(self, monkeypatch):
        self._with_flags(monkeypatch, True, 2)
        assert chatqna_module._resolved_blend_settings("USER: only-turn") == (True, None, 0)

    def test_short_history_is_not_padded_to_the_configured_turns(self, monkeypatch):
        self._with_flags(monkeypatch, True, 4)
        blob = "USER: prior |<-MSG->| USER: query"
        assert chatqna_module._resolved_blend_settings(blob) == (True, 0.7, 1)


class TestTruncationEvent:
    def test_event_is_recorded_with_its_numbers(self, captured_spans):
        tracer = chatqna_module.get_tracer("chatqna.orchestrate")
        with tracer.start_as_current_span("chatqna.orchestrate") as span:
            chatqna_module._emit_budget_truncation_event(
                current_span=span,
                dropped_segments=3,
                window_tokens=32768,
                answer_budget_tokens=1024,
                max_history_tokens=800,
            )

        (orchestrate,) = captured_spans("chatqna.orchestrate")
        (event,) = orchestrate.events
        assert event.name == "context_budget.truncated"
        assert event.attributes["dropped_segments"] == 3
        assert event.attributes["window_tokens"] == 32768
        assert event.attributes["answer_budget_tokens"] == 1024
        assert event.attributes["max_history_tokens"] == 800

    def test_no_event_when_nothing_was_dropped(self, captured_spans):
        tracer = chatqna_module.get_tracer("chatqna.orchestrate")
        with tracer.start_as_current_span("chatqna.orchestrate") as span:
            chatqna_module._emit_budget_truncation_event(
                current_span=span,
                dropped_segments=0,
                window_tokens=4096,
                answer_budget_tokens=512,
                max_history_tokens=100,
            )
        assert list(captured_spans("chatqna.orchestrate")[0].events) == []

    def test_non_recording_span_is_a_no_op(self):
        class _NoOp:
            def is_recording(self):
                return False

            def add_event(self, *_a, **_k):
                raise AssertionError("must not add an event to a non-recording span")

        chatqna_module._emit_budget_truncation_event(
            current_span=_NoOp(),
            dropped_segments=3,
            window_tokens=1,
            answer_budget_tokens=1,
            max_history_tokens=1,
        )

    def test_none_span_is_a_no_op(self):
        chatqna_module._emit_budget_truncation_event(
            current_span=None,
            dropped_segments=3,
            window_tokens=1,
            answer_budget_tokens=1,
            max_history_tokens=1,
        )


class TestOrchestrateSpanIsActive:
    """Pins the invariant the whole gap depends on.

    `align_inputs` resolves its span with get_current_span(), so the event and
    the history counts only land on chatqna.orchestrate if that span is ACTIVE.
    Switching the span to start_span would silently drop every attribute while
    leaving every hand-built-span test above green -- so the production line
    itself is asserted here. Parsed with `ast` (not a substring search) so a
    comment mentioning the marker cannot satisfy the guard.
    """

    def test_handle_request_opens_orchestrate_as_the_current_span(self):
        tree = ast.parse(CHATQNA_SOURCE.read_text())
        calls = [
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "start_as_current_span"
            and node.args
            and isinstance(node.args[0], ast.Constant)
            and node.args[0].value == "chatqna.orchestrate"
        ]
        assert len(calls) == 1, (
            "chatqna.orchestrate must be opened exactly once with "
            "start_as_current_span; the context-budget event resolves its span "
            "via get_current_span() and would be dropped otherwise."
        )

    def test_align_inputs_reads_the_current_span(self):
        """align_inputs is the emission site for the counts and the event."""
        tree = ast.parse(CHATQNA_SOURCE.read_text())
        align = next(
            node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef) and node.name == "align_inputs"
        )
        called = {
            node.func.attr
            for node in ast.walk(align)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
        }
        assert "get_current_span" in called, (
            "align_inputs must resolve its span with get_current_span(); a span "
            "passed in from a caller would not be the exported orchestrate span."
        )


def _function_node(name: str) -> ast.AST:
    tree = ast.parse(CHATQNA_SOURCE.read_text())
    return next(
        node
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name
    )


def _calls_to(function_name: str, callee: str) -> list[ast.Call]:
    return [
        node
        for node in ast.walk(_function_node(function_name))
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == callee
    ]


def _render(node: ast.AST) -> str:
    return ast.unparse(node)


class TestOrchestrateEmissionSite:
    """The orchestrate span must resolve values, not echo configuration.

    Both invariants below are invisible from the exported span when the
    pipeline short-circuits, and both are the exact drift this gap exists to
    prevent: a span reporting the module default misreports every overridden
    request, and an answer reserve derived a second time disagrees with the
    truncation event in the default configuration.

    Both assertions are on the ARGUMENTS of the emission call, not merely on
    the callee appearing somewhere in the function. `_resolved_blend_settings`
    stays reachable from the `history_text` guard regardless of what the span
    records, so "the helper is called" is tautological with respect to the
    attribute value; only the argument shape distinguishes the two.
    """

    def test_blend_attributes_are_fed_the_resolved_locals_not_the_constants(self):
        calls = _calls_to("handle_request", "_blend_attributes")
        assert len(calls) == 1, "handle_request must build the blend attributes exactly once"
        rendered = [_render(arg) for arg in calls[0].args]
        assert rendered == ["_blend_enabled", "_blend_alpha", "_blend_turns"], (
            "the orchestrate span must record the per-request resolution "
            f"locals, got {rendered} — echoing MULTI_TURN_* reports the "
            "configuration, not what this request blended."
        )

    def test_answer_budget_resolver_reads_the_same_value_align_inputs_does(self):
        calls = _calls_to("handle_request", "_resolve_answer_budget_tokens")
        assert len(calls) == 1, "handle_request must resolve the answer reserve exactly once"
        rendered = [_render(arg) for arg in calls[0].args]
        assert rendered == ["getattr(parameters, 'max_tokens', None)"], (
            "the orchestrate span must feed the resolver the requested "
            f"max_tokens, got {rendered} — a different source makes the span "
            "attribute disagree with the truncation event whenever max_tokens "
            "is absent."
        )

    def test_align_inputs_resolves_the_answer_reserve_through_the_same_helper(self):
        calls = _calls_to("align_inputs", "_resolve_answer_budget_tokens")
        assert len(calls) == 1, "align_inputs must resolve the answer reserve through the shared helper"
        rendered = [_render(arg) for arg in calls[0].args]
        assert rendered == ["llm_parameters_dict.get('max_tokens')"], (
            f"the guard's own reserve must come from the request too, got {rendered}"
        )

    def test_token_estimate_is_left_to_the_measuring_site(self):
        """A second derivation of the prompt estimate could drift from the one
        align_inputs measures; the orchestrate span passes None instead."""
        budgets = _calls_to("handle_request", "_prompt_budget_attributes")
        assert budgets, "handle_request must feed the prompt-budget attributes"
        for call in budgets:
            estimate = next((kw.value for kw in call.keywords if kw.arg == "estimate"), None)
            assert isinstance(estimate, ast.Constant) and estimate.value is None, (
                "the orchestrate span must not re-derive the prompt token "
                "estimate; align_inputs is the only site that measures it."
            )


class TestAlignInputsWiring:
    """Drives the real truncation path under a real orchestrate span.

    The helpers above prove what the attributes look like; only this proves
    they are actually emitted onto chatqna.orchestrate in production.
    """

    def _run_align_inputs(self, monkeypatch, history):
        monkeypatch.setenv("MAX_MODEL_LEN_TEXTGEN", "4096")
        service = MagicMock()
        service.services = {"llm_node": _service_node()}
        inputs = {"inputs": "RAGTOK" * 5, "stream": False, "frequency_penalty": 0.0, "temperature": 0.7}
        llm_params = {"max_tokens": 1024, "top_p": 0.9}
        with (
            patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
            patch("chatqna.genieai_chatqna.get_tokenizer", return_value=_MarkerTokenizer()),
            patch("chatqna.genieai_chatqna.CHATQNA_SYSTEM_PROMPT", "SYSTOK"),
            patch("chatqna.genieai_chatqna.history_truncation_total"),
        ):
            tracer = chatqna_module.get_tracer("chatqna.orchestrate")
            with tracer.start_as_current_span("chatqna.orchestrate"):
                return chatqna_module.align_inputs(
                    service,
                    inputs,
                    "llm_node",
                    MagicMock(),
                    llm_params,
                    full_chat_history_string=history,
                )

    def test_truncated_turn_reports_fewer_segments_than_it_came_in_with(self, monkeypatch, captured_spans):
        # window 4096 - system 1000 - answer 1024 - skeleton (RAG 500) - 200 = 1372
        # history tokens: the newest (500) and mid (500) fit, the oldest does not.
        history = "USER: HISTTOK-old |<-MSG->| USER: HISTTOK-mid |<-MSG->| USER: HISTTOK-new"
        result = self._run_align_inputs(monkeypatch, history)

        sent = result["messages"][1]["content"]
        assert "HISTTOK-old" not in sent

        (orchestrate,) = captured_spans("chatqna.orchestrate")
        attributes = dict(orchestrate.attributes)
        assert attributes[A["rag_history_segments_in"]] == 3
        assert attributes[A["rag_history_segments_sent"]] == 2
        assert attributes[A["rag_history_segments_sent"]] < attributes[A["rag_history_segments_in"]]

    def test_truncated_turn_emits_the_event_with_the_guards_own_numbers(self, monkeypatch, captured_spans):
        history = "USER: HISTTOK-old |<-MSG->| USER: HISTTOK-mid |<-MSG->| USER: HISTTOK-new"
        self._run_align_inputs(monkeypatch, history)

        (orchestrate,) = captured_spans("chatqna.orchestrate")
        (event,) = [e for e in orchestrate.events if e.name == "context_budget.truncated"]
        assert event.attributes["dropped_segments"] == 1
        assert event.attributes["window_tokens"] == 4096
        # The event and the span attribute must read the SAME reserve.
        assert (
            event.attributes["answer_budget_tokens"]
            == orchestrate.attributes[A["rag_prompt_answer_budget_tokens"]]
            == 1024
        )
        assert event.attributes["max_history_tokens"] == 1372

    def test_prompt_budget_is_recorded_even_without_truncation(self, monkeypatch, captured_spans):
        self._run_align_inputs(monkeypatch, "USER: tiny |<-MSG->| USER: tiny2")

        (orchestrate,) = captured_spans("chatqna.orchestrate")
        attributes = dict(orchestrate.attributes)
        assert attributes[A["rag_prompt_window_tokens"]] == 4096
        assert attributes[A["rag_prompt_answer_budget_tokens"]] == 1024
        assert attributes[A["rag_prompt_tokens_estimate"]] > 0
        # No truncation ran: no history counts and no event.
        assert A["rag_history_segments_in"] not in attributes
        assert [e.name for e in orchestrate.events] == []

    def test_default_answer_budget_is_recorded_when_the_request_omits_max_tokens(self, monkeypatch, captured_spans):
        """A request with no max_tokens still reports a reserve, not an omission."""
        monkeypatch.setenv("MAX_MODEL_LEN_TEXTGEN", "4096")
        service = MagicMock()
        service.services = {"llm_node": _service_node()}
        inputs = {"inputs": "RAGTOK", "stream": False, "frequency_penalty": 0.0, "temperature": 0.7}
        with (
            patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
            patch("chatqna.genieai_chatqna.get_tokenizer", return_value=_MarkerTokenizer()),
            patch("chatqna.genieai_chatqna.CHATQNA_SYSTEM_PROMPT", "SYSTOK"),
            patch("chatqna.genieai_chatqna.history_truncation_total"),
        ):
            tracer = chatqna_module.get_tracer("chatqna.orchestrate")
            with tracer.start_as_current_span("chatqna.orchestrate"):
                chatqna_module.align_inputs(
                    service,
                    inputs,
                    "llm_node",
                    MagicMock(),
                    {"max_tokens": None, "top_p": 0.9},
                    full_chat_history_string="USER: tiny",
                )

        (orchestrate,) = captured_spans("chatqna.orchestrate")
        assert orchestrate.attributes[A["rag_prompt_answer_budget_tokens"]] == (
            chatqna_module.DEFAULT_MAX_ANSWER_TOKENS
        )


class TestPrivacy:
    def test_no_free_text_in_prompt_budget_attributes(self):
        assert_no_free_text(chatqna_module._prompt_budget_attributes(32768, 1024, 2100))

    def test_no_free_text_in_blend_attributes(self):
        assert_no_free_text(chatqna_module._blend_attributes(True, 0.42, 2))
