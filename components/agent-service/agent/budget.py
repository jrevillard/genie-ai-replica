# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The run budget — bounded execution before every dispatch (AD-6, story 2.1).

The budget declares the dimensions a run is bounded on: steps, model calls,
tool calls and wall clock. The monitor is its live half — the per-run
counts and the clock, with the check-then-count discipline: every check
precedes the dispatch it bounds, so an exhausted dimension refuses the NEXT
dispatch instead of interrupting one mid-flight, and a refused dispatch
never increments anything.

The numbers are NOT owned here. Every field is required — there is no
default to fall into — because no numeric budget default is final: the
probe's values are smoke bounds, and the real thresholds are post-baseline
(PRD §8), owned by the request orchestrator (story 2.3). A run that hits a
budget ends honestly — the loop reports ``budget_exhausted`` and never
fabricates an answer to fill the hole.
"""

import time
from dataclasses import dataclass


@dataclass(frozen=True)
class RunBudget:
    """The declared bounds of one run. Every threshold is stated by the caller.

    ``max_steps`` bounds loop iterations (one iteration = one model call
    plus its tool dispatches); the call counts bound the model and the
    tools independently, so a tool-heavy step cannot hide behind a large
    step cap; ``wall_clock_seconds`` bounds the run's wall clock.
    """

    max_steps: int
    max_model_calls: int
    max_tool_calls: int
    wall_clock_seconds: float

    def __post_init__(self) -> None:
        if self.max_steps < 1:
            raise ValueError(f"max_steps must be at least 1, got {self.max_steps}")
        if self.max_model_calls < 1:
            raise ValueError(f"max_model_calls must be at least 1, got {self.max_model_calls}")
        if self.max_tool_calls < 1:
            raise ValueError(f"max_tool_calls must be at least 1, got {self.max_tool_calls}")
        if self.wall_clock_seconds <= 0:
            raise ValueError(f"wall_clock_seconds must be positive, got {self.wall_clock_seconds}")


class BudgetExhausted(RuntimeError):
    """A budget dimension is exhausted; the next dispatch is refused.

    ``dimension`` names the bound that stopped the run (``steps``,
    ``model_calls``, ``tool_calls``, ``wall_clock``) — the evidence record
    keeps it, so an exhausted run is attributable to its dimension.
    """

    def __init__(self, dimension: str, message: str) -> None:
        super().__init__(message)
        self.dimension = dimension


class RunBudgetMonitor:
    """The live counts and clock of one run, checked before every dispatch.

    The monitor is created per run and carries the counts the evidence
    record reports — including a cancelled run's partial counts, which is
    why the probe creates it and hands it to the loop rather than letting
    the loop bury it in a result that a cancellation never produces.
    """

    def __init__(self, budget: RunBudget) -> None:
        self._budget = budget
        self._started = time.monotonic()
        self._steps = 0
        self._model_calls = 0
        self._tool_calls = 0

    @property
    def budget(self) -> RunBudget:
        return self._budget

    @property
    def steps(self) -> int:
        return self._steps

    @property
    def model_calls(self) -> int:
        return self._model_calls

    @property
    def tool_calls(self) -> int:
        return self._tool_calls

    @property
    def elapsed_seconds(self) -> float:
        return time.monotonic() - self._started

    def check_wall_clock(self) -> None:
        """Refuse everything when the run's wall clock is spent."""
        elapsed = self.elapsed_seconds
        if elapsed >= self._budget.wall_clock_seconds:
            raise BudgetExhausted(
                "wall_clock",
                f"the run's wall clock budget is exhausted after {elapsed:.3f}s "
                f"(budget {self._budget.wall_clock_seconds:.3f}s)",
            )

    def begin_step(self) -> None:
        """Open one loop iteration: wall clock first, then the step cap."""
        self.check_wall_clock()
        if self._steps >= self._budget.max_steps:
            raise BudgetExhausted(
                "steps",
                f"the run's step budget is exhausted ({self._budget.max_steps} steps used)",
            )
        self._steps += 1

    def take_model_call(self) -> None:
        """Claim one model dispatch; refused when the model-call budget is spent."""
        if self._model_calls >= self._budget.max_model_calls:
            raise BudgetExhausted(
                "model_calls",
                f"the run's model-call budget is exhausted ({self._budget.max_model_calls} model calls used)",
            )
        self._model_calls += 1

    def take_tool_call(self) -> None:
        """Claim one tool dispatch; refused when the tool-call budget is spent."""
        if self._tool_calls >= self._budget.max_tool_calls:
            raise BudgetExhausted(
                "tool_calls",
                f"the run's tool-call budget is exhausted ({self._budget.max_tool_calls} tool calls used)",
            )
        self._tool_calls += 1
