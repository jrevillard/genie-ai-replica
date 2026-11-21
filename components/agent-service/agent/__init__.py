# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The agent runtime seam — envelope, vocabulary, registry, hooks, and the loop.

``agent/`` owns the runtime seam: the internal event envelope
``{run_id, call_id, seq, kind, payload}`` and its AG-UI-shaped kind
vocabulary (:mod:`.events`), the server-side tool registry that is the
authorization surface (:mod:`.registry`), the run budget and its monitor
(:mod:`.budget`), the cancellation hook (:mod:`.cancellation`), the
provisional custom minimal loop (:mod:`.loop`) and the bounded smoke probe
(:mod:`.probe`). A runtime swap adapts its native events to this seam's
vocabulary — it never renames it; nothing here ever speaks the BFF's client
frame names.
"""

from .budget import BudgetExhausted, RunBudget, RunBudgetMonitor
from .cancellation import CancellationToken, run_cancellable
from .events import BFF_FRAME_NAMES, AgentEvent, EventEmitter, EventKind, EventSink
from .loop import (
    OUTCOME_ANSWERED,
    OUTCOME_BUDGET_EXHAUSTED,
    OUTCOME_CANCELLED,
    OUTCOME_ERROR,
    AgentLoop,
    LoopModelClient,
    ModelTurn,
    RunResult,
    ToolCallRequest,
)
from .probe import (
    PROBE_QUESTION,
    QUESTION_ID,
    RUNTIME_ID,
    TOOLSET,
    ProbeConfig,
    ProbeEvidence,
    ProbeModelClient,
    ProbeTransientError,
    document_toolset,
    run_probe,
)
from .registry import ToolDefinition, ToolExecutor, ToolRegistry, UnregisteredToolError

__all__ = [
    "BFF_FRAME_NAMES",
    "OUTCOME_ANSWERED",
    "OUTCOME_BUDGET_EXHAUSTED",
    "OUTCOME_CANCELLED",
    "OUTCOME_ERROR",
    "PROBE_QUESTION",
    "QUESTION_ID",
    "RUNTIME_ID",
    "TOOLSET",
    "AgentEvent",
    "AgentLoop",
    "BudgetExhausted",
    "CancellationToken",
    "EventEmitter",
    "EventKind",
    "EventSink",
    "LoopModelClient",
    "ModelTurn",
    "ProbeConfig",
    "ProbeEvidence",
    "ProbeModelClient",
    "ProbeTransientError",
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
    "run_probe",
]
