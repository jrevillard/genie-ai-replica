# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The run budget — bounded execution before every dispatch.

The budget declares the dimensions a run is bounded on: steps, model calls,
tool calls, wall clock, total tokens and evidence volume. The monitor is its
live half — the per-run counts, the usage accounting and the clock, with the
check-then-count discipline: every check precedes the dispatch it bounds, so
an exhausted dimension refuses the NEXT dispatch instead of interrupting one
mid-flight, and a refused dispatch never increments anything.

The numbers are NOT owned here. Every field is required — there is no
default to fall into — because no numeric budget default is final: the
probe's values are smoke bounds, and the real thresholds are a deployment
decision owned by the request orchestrator. A run that hits a
budget ends honestly — the loop reports ``budget_exhausted`` and never
fabricates an answer to fill the hole.
"""

import logging
import time
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RunBudget:
    """The declared bounds of one run. Every threshold is stated by the caller.

    ``max_steps`` bounds loop iterations (one iteration = one model call
    plus its tool dispatches); the call counts bound the model and the
    tools independently, so a tool-heavy step cannot hide behind a large
    step cap; ``wall_clock_seconds`` bounds the run's wall clock;
    ``max_total_tokens`` bounds the served token usage (prompt plus
    completion, as the endpoint reports it); ``max_evidence_bytes`` bounds
    the executed tool-result bytes the run may accumulate.
    """

    max_steps: int
    max_model_calls: int
    max_tool_calls: int
    max_total_tokens: int
    max_evidence_bytes: int
    wall_clock_seconds: float

    def __post_init__(self) -> None:
        if self.max_steps < 1:
            raise ValueError(f"max_steps must be at least 1, got {self.max_steps}")
        if self.max_model_calls < 1:
            raise ValueError(f"max_model_calls must be at least 1, got {self.max_model_calls}")
        if self.max_tool_calls < 1:
            raise ValueError(f"max_tool_calls must be at least 1, got {self.max_tool_calls}")
        if self.max_total_tokens < 1:
            raise ValueError(f"max_total_tokens must be at least 1, got {self.max_total_tokens}")
        if self.max_evidence_bytes < 1:
            raise ValueError(f"max_evidence_bytes must be at least 1, got {self.max_evidence_bytes}")
        if self.wall_clock_seconds <= 0:
            raise ValueError(f"wall_clock_seconds must be positive, got {self.wall_clock_seconds}")


class BudgetExhausted(RuntimeError):
    """A budget dimension is exhausted; the next dispatch is refused.

    ``dimension`` names the bound that stopped the run (``steps``,
    ``model_calls``, ``tool_calls``, ``wall_clock``, ``tokens``,
    ``evidence_volume``) — the evidence record keeps it, so an exhausted run
    is attributable to its dimension.
    """

    def __init__(self, dimension: str, message: str) -> None:
        super().__init__(message)
        self.dimension = dimension


class RunBudgetMonitor:
    """The live counts, usage and clock of one run, checked before every dispatch.

    The monitor is created per run and carries the counts the usage record
    reports — including a cancelled run's partial counts, which is why the
    orchestrator creates it and hands it to the loop rather than letting the
    loop bury it in a result that a cancellation never produces. It is the
    run's SHARED counting surface: the loop counts its model calls and tool
    results here, and the auxiliary callers (the grounding judge,
    classification, the agent-path preparation translation) claim the same
    model-call budget through :meth:`take_aux_model_call`, tallied
    separately so the record shows plumbing vs. work.
    """

    def __init__(self, budget: RunBudget) -> None:
        self._budget = budget
        self._started = time.monotonic()
        self._steps = 0
        self._model_calls = 0
        self._aux_model_calls = 0
        self._tool_calls = 0
        self._evidence_bytes = 0
        self._injection_findings = 0
        self._prompt_tokens: int | None = None
        self._completion_tokens: int | None = None
        # Set the first time a usage record arrives incomplete: from then on
        # the served totals are a lower bound, and token enforcement — the
        # pre-dispatch check and the per-call bound — degrades. Logged once,
        # never guessed.
        self._usage_gap_logged = False

    @property
    def steps(self) -> int:
        return self._steps

    @property
    def model_calls(self) -> int:
        return self._model_calls

    @property
    def aux_model_calls(self) -> int:
        return self._aux_model_calls

    @property
    def tool_calls(self) -> int:
        return self._tool_calls

    @property
    def evidence_bytes(self) -> int:
        return self._evidence_bytes

    @property
    def injection_findings(self) -> int:
        """How many injection attempts the run's taint scan recorded
        (everything counted, findings included)."""
        return self._injection_findings

    @property
    def prompt_tokens(self) -> int | None:
        return self._prompt_tokens

    @property
    def completion_tokens(self) -> int | None:
        return self._completion_tokens

    @property
    def _tokens_used(self) -> int:
        """The served token total so far — a lower bound once a gap was seen."""
        return (self._prompt_tokens or 0) + (self._completion_tokens or 0)

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

    def check_tokens(self) -> None:
        """Refuse the next model dispatch when the served usage has spent the
        token budget.

        Enforcement is honest about what it knows: an endpoint that discards
        usage leaves the served total a lower bound, and a lower bound can
        never prove the budget spent — the check passes and the enforcement
        degrades (logged once by :meth:`record_usage`), never guesses.
        """
        if self._usage_gap_logged:
            return
        if self._tokens_used >= self._budget.max_total_tokens:
            raise BudgetExhausted(
                "tokens",
                f"the run's token budget is exhausted ({self._tokens_used} tokens served, "
                f"budget {self._budget.max_total_tokens})",
            )

    def check_evidence_volume(self) -> None:
        """Refuse the next dispatch when the run's evidence has spent its volume."""
        if self._evidence_bytes >= self._budget.max_evidence_bytes:
            raise BudgetExhausted(
                "evidence_volume",
                f"the run's evidence-volume budget is exhausted ({self._evidence_bytes} bytes of tool results, "
                f"budget {self._budget.max_evidence_bytes})",
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

    def take_aux_model_call(self) -> None:
        """Claim one AUXILIARY model dispatch (judge, classification,
        preparation translation): the same fleet model-call budget
        (one budget for everything that calls the model), tallied separately
        from the loop's own calls."""
        self.take_model_call()
        self._aux_model_calls += 1

    def take_tool_call(self) -> None:
        """Claim one tool dispatch; refused when the tool-call budget is spent."""
        if self._tool_calls >= self._budget.max_tool_calls:
            raise BudgetExhausted(
                "tool_calls",
                f"the run's tool-call budget is exhausted ({self._budget.max_tool_calls} tool calls used)",
            )
        self._tool_calls += 1

    def record_usage(self, prompt_tokens: int | None, completion_tokens: int | None) -> None:
        """Add one call's served usage (prompt + completion as the endpoint
        served it — never a local estimate).

        A record that arrives incomplete (either field ``None``) marks the
        endpoint as a usage discarder: the served totals become a lower
        bound, token enforcement degrades, and the degradation is logged
        ONCE per run — it is a property of the endpoint, not of the call.
        """
        if prompt_tokens is not None:
            self._prompt_tokens = (self._prompt_tokens or 0) + prompt_tokens
        if completion_tokens is not None:
            self._completion_tokens = (self._completion_tokens or 0) + completion_tokens
        if (prompt_tokens is None or completion_tokens is None) and not self._usage_gap_logged:
            self._usage_gap_logged = True
            logger.warning(
                "the endpoint served an incomplete usage record (prompt=%s completion=%s); "
                "the run's token enforcement degrades — the served totals are a lower bound, "
                "never guessed up to the budget",
                prompt_tokens,
                completion_tokens,
            )

    def mark_usage_gap(self) -> None:
        """Mark the served totals as a known lower bound.

        A call whose response never arrived (a timeout) leaves its server-side
        spend unreportable: the usage record the endpoint would have sent is
        the one that carries the count. The run's served totals are then a
        lower bound, token enforcement degrades, and the degradation is
        logged ONCE per run — the same honesty rule an incomplete usage
        record applies.
        """
        if self._usage_gap_logged:
            return
        self._usage_gap_logged = True
        logger.warning(
            "a model call's served usage is unreportable (the response never arrived); "
            "the run's token enforcement degrades — the served totals are a lower bound, "
            "never guessed up to the budget"
        )

    def record_evidence(self, result_bytes: int) -> None:
        """Add one executed tool result's size to the run's evidence volume."""
        self._evidence_bytes += result_bytes

    def record_injection_findings(self, count: int) -> None:
        """Add the taint scan's finding count for one dispatched tool result."""
        self._injection_findings += count

    def remaining_output_tokens(self) -> int | None:
        """The output allowance the next model call may carry as ``max_tokens``.

        ``None`` when the served usage is a known lower bound: a bound
        cannot say how much remains, and guessing one would fabricate the
        very number the budget exists to keep honest. The caller omits the
        ``max_tokens`` field (the deployed only-when-configured rule).
        """
        if self._usage_gap_logged:
            return None
        return self._budget.max_total_tokens - self._tokens_used
