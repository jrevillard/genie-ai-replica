# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The agent runtime seam — envelope, vocabulary, registry, hooks, and the loop.

``agent/`` owns the runtime seam: the internal event envelope
``{run_id, call_id, seq, kind, payload}`` and its AG-UI-shaped kind
vocabulary (:mod:`.events`), the server-side tool registry that is the
authorization surface (:mod:`.registry`), the run budget and its monitor
(:mod:`.budget`), the cancellation hook (:mod:`.cancellation`), the
provisional custom minimal loop (:mod:`.loop`), the governed production
prompt (:mod:`.prompt`), the registered toolset (:mod:`.toolset`), the
taint scan (:mod:`.taint`), the citation verification pipeline
(:mod:`.verification`) and the bounded smoke probe (:mod:`.probe`). A
runtime swap adapts its native events to this seam's vocabulary — it never
renames it; nothing here ever speaks the BFF's client frame names. The
``source_documents`` projection lives across the port boundary
(:mod:`capabilities.citations`) — both lanes import it from there.
"""

from capabilities.model import LoopModelClient, ModelTurn, ToolCallRequest

from .budget import BudgetExhausted, RunBudget, RunBudgetMonitor
from .cancellation import CancellationToken, run_cancellable
from .events import BFF_FRAME_NAMES, AgentEvent, EventEmitter, EventKind, EventSink
from .loop import (
    OUTCOME_ANSWERED,
    OUTCOME_BUDGET_EXHAUSTED,
    OUTCOME_CANCELLED,
    OUTCOME_ERROR,
    AgentLoop,
    RunResult,
)
from .prompt import PRODUCTION_SYSTEM_PROMPT
from .registry import ToolDefinition, ToolExecutor, ToolRegistry, UnregisteredToolError
from .toolset import document_toolset

__all__ = [
    "BFF_FRAME_NAMES",
    "OUTCOME_ANSWERED",
    "OUTCOME_BUDGET_EXHAUSTED",
    "OUTCOME_CANCELLED",
    "OUTCOME_ERROR",
    "PRODUCTION_SYSTEM_PROMPT",
    "AgentEvent",
    "AgentLoop",
    "BudgetExhausted",
    "CancellationToken",
    "EventEmitter",
    "EventKind",
    "EventSink",
    "LoopModelClient",
    "ModelTurn",
    "RunBudget",
    "RunBudgetMonitor",
    "RunResult",
    "ToolCallRequest",
    "ToolDefinition",
    "ToolExecutor",
    "ToolRegistry",
    "UnregisteredToolError",
    "document_toolset",
    "run_cancellable",
]
