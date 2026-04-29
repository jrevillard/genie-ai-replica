"""
AMINA Agent Platform v1 — bounded shadow/assist agentic runtime.

Strict-additive package. Default mode is "off" → zero behaviour change.
Other modes (shadow / assist / strict) are gated behind env vars and
fall back to the existing AminaAgent on any error when
AMINA_AGENTIC_FAIL_OPEN=true (default).

See docs/AGENT_PLATFORM_V1.md for the full design.
"""

from src.agent_platform.config import (
    AgentMode,
    AMINA_AGENTIC_MODE,
    AMINA_AGENTIC_MODES_ALLOWED,
    AMINA_AGENTIC_MAX_TOOL_CALLS,
    AMINA_AGENTIC_TRACE_ENABLED,
    AMINA_AGENTIC_FAIL_OPEN,
    AMINA_AGENTIC_NATIVE_TOOLS,
    AMINA_AGENTIC_NATIVE_FORMAT,
    PLANNER_HARD_LIMITS,
)
from src.agent_platform.models import (
    AgenticRequest,
    AgenticPlan,
    AgenticToolCall,
    AgenticPrepassResult,
    AgentTrace,
    PolicyDecision,
    ToolResult,
    ToolRisk,
    ToolSpec,
    V1_ALLOWED_RISKS,
)
from src.agent_platform.runtime import AgentPlatformRuntime, get_runtime

__all__ = [
    "AgentMode",
    "AMINA_AGENTIC_MODE",
    "AMINA_AGENTIC_MODES_ALLOWED",
    "AMINA_AGENTIC_MAX_TOOL_CALLS",
    "AMINA_AGENTIC_TRACE_ENABLED",
    "AMINA_AGENTIC_FAIL_OPEN",
    "AMINA_AGENTIC_NATIVE_TOOLS",
    "AMINA_AGENTIC_NATIVE_FORMAT",
    "PLANNER_HARD_LIMITS",
    "AgenticRequest",
    "AgenticPlan",
    "AgenticToolCall",
    "AgenticPrepassResult",
    "AgentTrace",
    "PolicyDecision",
    "ToolResult",
    "ToolRisk",
    "ToolSpec",
    "V1_ALLOWED_RISKS",
    "AgentPlatformRuntime",
    "get_runtime",
]
