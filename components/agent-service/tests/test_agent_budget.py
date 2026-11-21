# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The run budget and its monitor.

Mutation-sensitive pins: every threshold is REQUIRED (no default to fall
into — no numeric budget default is final), the check-then-count
discipline refuses the NEXT dispatch at the exact boundary, a refused
dispatch never increments, the wall clock bounds the run, and
``BudgetExhausted`` names the dimension that stopped the run. The token
and evidence dimensions enforce the same way; the aux tally consumes the
model-call budget without hiding behind it; an endpoint that discards
usage degrades token enforcement (logged once) instead of guessing.
"""

import pytest

from agent.budget import BudgetExhausted, RunBudget, RunBudgetMonitor


def _budget(**overrides) -> RunBudget:
    values = {
        "max_steps": 5,
        "max_model_calls": 5,
        "max_tool_calls": 5,
        "max_total_tokens": 1000,
        "max_evidence_bytes": 4096,
        "wall_clock_seconds": 30.0,
    }
    return RunBudget(**{**values, **overrides})


# ---------------------------------------------------------------------
# No numeric defaults: the caller states every threshold
# ---------------------------------------------------------------------


@pytest.mark.parametrize(
    "missing",
    [
        "max_steps",
        "max_model_calls",
        "max_tool_calls",
        "max_total_tokens",
        "max_evidence_bytes",
        "wall_clock_seconds",
    ],
)
def test_every_threshold_is_required(missing):
    values = {
        "max_steps": 1,
        "max_model_calls": 1,
        "max_tool_calls": 1,
        "max_total_tokens": 1,
        "max_evidence_bytes": 1,
        "wall_clock_seconds": 1.0,
    }
    del values[missing]
    with pytest.raises(TypeError):
        RunBudget(**values)


@pytest.mark.parametrize(
    "field", ["max_steps", "max_model_calls", "max_tool_calls", "max_total_tokens", "max_evidence_bytes"]
)
def test_counts_must_be_at_least_one(field):
    with pytest.raises(ValueError, match=field):
        _budget(**{field: 0})


def test_the_wall_clock_must_be_positive():
    with pytest.raises(ValueError, match="wall_clock_seconds"):
        _budget(wall_clock_seconds=0)


# ---------------------------------------------------------------------
# The step cap
# ---------------------------------------------------------------------


def test_begin_step_counts_and_refuses_at_the_exact_boundary():
    monitor = RunBudgetMonitor(_budget(max_steps=2))
    monitor.begin_step()
    monitor.begin_step()
    with pytest.raises(BudgetExhausted) as exhausted:
        monitor.begin_step()
    assert exhausted.value.dimension == "steps"
    assert monitor.steps == 2  # the refused step never incremented


# ---------------------------------------------------------------------
# The call caps: checked before the dispatch they bound
# ---------------------------------------------------------------------


def test_model_call_refusal_at_the_boundary():
    monitor = RunBudgetMonitor(_budget(max_model_calls=1))
    monitor.take_model_call()
    with pytest.raises(BudgetExhausted) as exhausted:
        monitor.take_model_call()
    assert exhausted.value.dimension == "model_calls"
    assert monitor.model_calls == 1


def test_tool_call_refusal_at_the_boundary():
    monitor = RunBudgetMonitor(_budget(max_tool_calls=1))
    monitor.take_tool_call()
    with pytest.raises(BudgetExhausted) as exhausted:
        monitor.take_tool_call()
    assert exhausted.value.dimension == "tool_calls"
    assert monitor.tool_calls == 1


def test_the_dimensions_are_independent():
    # A tool-heavy step cannot hide behind a large step cap: the tool cap
    # binds on its own count.
    monitor = RunBudgetMonitor(_budget(max_steps=9, max_tool_calls=2, max_model_calls=9))
    monitor.begin_step()
    monitor.take_tool_call()
    monitor.take_tool_call()
    with pytest.raises(BudgetExhausted) as exhausted:
        monitor.take_tool_call()
    assert exhausted.value.dimension == "tool_calls"
    assert monitor.steps == 1


# ---------------------------------------------------------------------
# The wall clock
# ---------------------------------------------------------------------


def test_the_wall_clock_refuses_everything_when_spent(monkeypatch):
    clock = {"now": 0.0}
    monkeypatch.setattr("agent.budget.time.monotonic", lambda: clock["now"])
    monitor = RunBudgetMonitor(_budget(wall_clock_seconds=10.0))
    monitor.begin_step()
    clock["now"] = 10.0  # exactly at the bound: spent
    with pytest.raises(BudgetExhausted) as exhausted:
        monitor.begin_step()
    assert exhausted.value.dimension == "wall_clock"
    with pytest.raises(BudgetExhausted):
        monitor.check_wall_clock()


def test_elapsed_seconds_reads_the_same_clock(monkeypatch):
    clock = {"now": 100.0}
    monkeypatch.setattr("agent.budget.time.monotonic", lambda: clock["now"])
    monitor = RunBudgetMonitor(_budget(wall_clock_seconds=10.0))
    clock["now"] = 103.5
    assert monitor.elapsed_seconds == pytest.approx(3.5)


# ---------------------------------------------------------------------
# The token dimension: served usage, checked before the next dispatch
# ---------------------------------------------------------------------


def test_the_token_check_refuses_when_the_served_usage_spends_the_budget():
    monitor = RunBudgetMonitor(_budget(max_total_tokens=100))
    monitor.record_usage(60, 40)  # exactly at the bound: spent
    with pytest.raises(BudgetExhausted) as exhausted:
        monitor.check_tokens()
    assert exhausted.value.dimension == "tokens"
    assert monitor.prompt_tokens == 60 and monitor.completion_tokens == 40


def test_the_token_check_passes_below_the_bound_and_reports_the_remaining_allowance():
    monitor = RunBudgetMonitor(_budget(max_total_tokens=100))
    monitor.record_usage(30, 20)
    monitor.check_tokens()  # must not raise
    assert monitor.remaining_output_tokens() == 50


def test_usage_accumulates_across_records_as_served():
    monitor = RunBudgetMonitor(_budget(max_total_tokens=1000))
    monitor.record_usage(10, 5)
    monitor.record_usage(20, 7)
    assert (monitor.prompt_tokens, monitor.completion_tokens) == (30, 12)
    assert monitor.remaining_output_tokens() == 1000 - 42


def test_usage_stays_none_when_the_endpoint_never_served_any():
    monitor = RunBudgetMonitor(_budget(max_total_tokens=1000))
    assert monitor.prompt_tokens is None and monitor.completion_tokens is None


def test_an_incomplete_usage_record_degrades_enforcement_and_is_logged_once(caplog):
    monitor = RunBudgetMonitor(_budget(max_total_tokens=100))
    with caplog.at_level("WARNING"):
        monitor.record_usage(None, None)
        monitor.record_usage(None, None)  # the second gap is not a second warning
    assert sum("token enforcement degrades" in record.getMessage() for record in caplog.records) == 1
    # The known partials are still reported honestly — a lower bound.
    monitor.record_usage(5, 5)
    assert (monitor.prompt_tokens, monitor.completion_tokens) == (5, 5)
    # A lower bound can never prove the budget spent: the check passes and
    # the allowance is unknowable (None), never guessed.
    monitor.check_tokens()
    assert monitor.remaining_output_tokens() is None


# ---------------------------------------------------------------------
# The evidence-volume dimension: executed tool-result bytes
# ---------------------------------------------------------------------


def test_the_evidence_check_refuses_at_the_exact_boundary():
    monitor = RunBudgetMonitor(_budget(max_evidence_bytes=100))
    monitor.record_evidence(100)
    with pytest.raises(BudgetExhausted) as exhausted:
        monitor.check_evidence_volume()
    assert exhausted.value.dimension == "evidence_volume"


def test_evidence_accumulates_below_the_bound():
    monitor = RunBudgetMonitor(_budget(max_evidence_bytes=300))
    monitor.record_evidence(100)
    monitor.record_evidence(150)
    monitor.check_evidence_volume()  # must not raise
    assert monitor.evidence_bytes == 250


# ---------------------------------------------------------------------
# The aux tally: one fleet model-call budget, plumbing counted apart
# ---------------------------------------------------------------------


def test_an_aux_call_consumes_the_model_call_budget():
    monitor = RunBudgetMonitor(_budget(max_model_calls=2))
    monitor.take_model_call()
    monitor.take_aux_model_call()
    assert (monitor.model_calls, monitor.aux_model_calls) == (2, 1)
    with pytest.raises(BudgetExhausted) as exhausted:
        monitor.take_aux_model_call()  # the fleet budget is spent
    assert exhausted.value.dimension == "model_calls"
    assert monitor.aux_model_calls == 1  # the refused claim never counted


def test_the_aux_tally_is_separate_from_the_loop_calls():
    monitor = RunBudgetMonitor(_budget(max_model_calls=5))
    monitor.take_model_call()
    monitor.take_aux_model_call()
    monitor.take_aux_model_call()
    assert (monitor.model_calls, monitor.aux_model_calls) == (3, 2)
