# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The model call's contract: what a model turn IS, and the seam that
produces one.

The two dataclasses and the protocol live here, not in the core's loop:
the client that produces a turn is an adapter, and an adapter may not
import the core (rule L1 binds the leaf adapters to the ports). The core
and the adapters exchange these shapes, so they are a port.
"""

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class ToolCallRequest:
    """One tool call the model asked for: its wire id, name, arguments."""

    call_id: str
    name: str
    arguments: dict


@dataclass(frozen=True)
class ModelTurn:
    """One model call's outcome, in the loop's own shape.

    ``content`` is the final text when the turn answers; ``tool_calls``
    carries the requested dispatches when the turn works. Usage is the
    token accounting as the endpoint served it (``None`` when the endpoint
    discarded it) — the evidence record reports usage as served, never a
    local estimate.
    """

    content: str | None = None
    tool_calls: tuple[ToolCallRequest, ...] = ()
    finish_reason: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


class LoopModelClient(Protocol):
    """The model-call seam the loop drives — one non-streaming completion.

    The concrete OpenAI-compatible client is the runtime's business (the
    probe carries one, shared with the run surface); the loop depends on
    this shape only, which is what keeps the loop runtime-swappable.
    ``max_output_tokens`` is the remaining token allowance the monitor
    hands the call — the token bound riding the request (``None`` when the
    allowance is unknowable and the field must be omitted, the deployed
    only-when-configured rule). The IMPLEMENTER caps the bound to what one
    call can serve — ``min(bound, window room)``, omitting the field when
    there is no room — because a cumulative RUN allowance may exceed the
    endpoint's window, and an unanchored ``max_tokens`` is rejected
    outright.
    """

    async def complete(
        self, messages: list[dict], tool_definitions: tuple[dict, ...], *, max_output_tokens: int | None
    ) -> ModelTurn: ...
