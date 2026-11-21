# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The run budget and its monitor.

Mutation-sensitive pins: every threshold is REQUIRED (no default to fall
into — no numeric budget default is final), the check-then-count
discipline refuses the NEXT dispatch at the exact boundary, a refused
dispatch never increments, the wall clock bounds the run, and
``BudgetExhausted`` names the dimension that stopped the run.
"""

import pytest

from agent.budget import BudgetExhausted, RunBudget, RunBudgetMonitor


def _budget(**overrides) -> RunBudget:
    values = {"max_steps": 5, "max_model_calls": 5, "max_tool_calls": 5, "wall_clock_seconds": 30.0}
    return RunBudget(**{**values, **overrides})


# ---------------------------------------------------------------------
# No numeric defaults: the caller states every threshold
# ---------------------------------------------------------------------


@pytest.mark.parametrize("missing", ["max_steps", "max_model_calls", "max_tool_calls", "wall_clock_seconds"])
def test_every_threshold_is_required(missing):
    values = {"max_steps": 1, "max_model_calls": 1, "max_tool_calls": 1, "wall_clock_seconds": 1.0}
    del values[missing]
    with pytest.raises(TypeError):
        RunBudget(**values)


@pytest.mark.parametrize("field", ["max_steps", "max_model_calls", "max_tool_calls"])
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
