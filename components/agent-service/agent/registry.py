# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The server-side tool registry — the authorization surface.

The registry is the one place a tool becomes callable: a name it does not
carry is dispatched by nobody, and :meth:`ToolRegistry.dispatch` refuses an
unregistered name BEFORE any resolution — the executor never runs, and the
refusal reveals nothing about what the tool would have done. Effective
permissions are the caller's context over the registered toolset; nothing
unregistered is callable, by construction.

The model-facing definitions are registry-owned too: the JSON-schema
parameter contracts the model sees are declared here, beside the executor
that runs the tool. WHAT ENFORCES them is the contract's own typed input
(``capabilities.contract``) — the executor validates the model's arguments
against that model, not against the JSON schema; the schema is the
DECLARATION the model is told, and the typed input is the ENFORCEMENT. The
two are kept in step by the equivalence suite, not by one code path.
"""

from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any, Protocol


class UnregisteredToolError(RuntimeError):
    """Dispatch refused a name the registry does not carry.

    An authorization refusal, raised before any resolution: the executor is
    never consulted, and nothing about the registered set is leaked beyond
    the plain fact that THIS name is not on it.
    """

    def __init__(self, name: str) -> None:
        super().__init__(f"tool {name!r} is not registered; dispatch refused before any resolution")
        self.name = name


@dataclass(frozen=True)
class ToolDefinition:
    """One tool's model-facing contract: name, description, parameters.

    ``parameters`` is the JSON schema the model is told to satisfy; the
    executor behind it validates the arguments it actually receives (a
    model that ignores the schema gets a structured error back, not a
    crash — the loop feeds that error to the model as the tool result).
    """

    name: str
    description: str
    parameters: dict[str, Any]


class ToolExecutor(Protocol):
    """One registered tool's server-side execution."""

    async def __call__(self, arguments: dict) -> dict: ...


@dataclass(frozen=True)
class _RegisteredTool:
    definition: ToolDefinition
    executor: ToolExecutor


@dataclass
class ToolRegistry:
    """The registered toolset of one run.

    Registration happens server-side, before the loop starts (the probe
    registers its two document tools); the loop consumes definitions and
    dispatch, never the raw executor map. A duplicate name is refused —
    two tools behind one name would make the authorization surface
    ambiguous.
    """

    _tools: dict[str, _RegisteredTool] = field(default_factory=dict)

    def register(self, definition: ToolDefinition, executor: ToolExecutor) -> None:
        """Add one tool; a duplicate name is an authorization ambiguity."""
        if not isinstance(definition.name, str) or not definition.name:
            raise ValueError("a tool definition needs a non-empty name")
        if definition.name in self._tools:
            raise ValueError(f"tool {definition.name!r} is already registered")
        self._tools[definition.name] = _RegisteredTool(definition=definition, executor=executor)

    def names(self) -> tuple[str, ...]:
        return tuple(self._tools)

    def definitions(self) -> tuple[dict, ...]:
        """The model-facing definitions, in the OpenAI function-tool shape.

        The shape mirrors the OpenAI-compatible request convention the
        component's model clients already speak (``noagent.generation``):
        the loop hands these to the model call verbatim.
        """
        return tuple(
            {
                "type": "function",
                "function": {
                    "name": tool.definition.name,
                    "description": tool.definition.description,
                    "parameters": tool.definition.parameters,
                },
            }
            for tool in self._tools.values()
        )

    async def dispatch(self, name: str, arguments: dict) -> dict:
        """Run one registered tool's executor; refuse an unregistered name first.

        The refusal precedes EVERY resolution — argument validation, port
        access, anything. ``arguments`` is copied so an executor mutating
        its input cannot reach back into the loop's message list.
        """
        registered = self._tools.get(name)
        if registered is None:
            raise UnregisteredToolError(name)
        result = await registered.executor(dict(arguments))
        return result


def build_registry(pairs: Iterable[tuple[ToolDefinition, ToolExecutor]]) -> ToolRegistry:
    """The registry of one run: the pairs the declared sources offered.

    One door, still: every pair goes through :meth:`ToolRegistry.register`,
    so a duplicate exposed name is refused exactly as it was when the
    orchestrator registered the tools itself. Each definition's
    ``parameters`` dict is COPIED at registration: the definitions are
    module-level constants now (built once, shared by every request), and
    ``ToolDefinition.parameters`` is a mutable dict — a copy at the door
    means one request cannot mutate what every request is told, and the
    wire stays a plain JSON-serializable dict.
    """
    registry = ToolRegistry()
    for definition, executor in pairs:
        copied = ToolDefinition(
            name=definition.name, description=definition.description, parameters=dict(definition.parameters)
        )
        registry.register(copied, executor)
    return registry
