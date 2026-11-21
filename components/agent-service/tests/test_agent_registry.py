# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The server-side tool registry — the authorization surface.

Mutation-sensitive pins: an unregistered name is refused BEFORE any
resolution (the executor never runs — nothing unregistered is callable),
a duplicate registration is refused (one name, one tool), and the
model-facing definitions carry the exact OpenAI function-tool shape.
"""

import asyncio

import pytest

from agent.registry import ToolDefinition, ToolRegistry, UnregisteredToolError


def _definition(name="search_knowledge"):
    return ToolDefinition(
        name=name,
        description="Search the authorized corpus.",
        parameters={"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]},
    )


async def _executor(arguments):
    return {"echo": arguments}


def _registry_with_recording_executor():
    calls = []

    async def recording_executor(arguments):
        calls.append(arguments)
        return {"ok": True}

    registry = ToolRegistry()
    registry.register(_definition(), recording_executor)
    return registry, calls


# ---------------------------------------------------------------------
# The refusal: before any resolution
# ---------------------------------------------------------------------


def test_dispatch_refuses_an_unregistered_name_before_any_resolution():
    registry, calls = _registry_with_recording_executor()
    with pytest.raises(UnregisteredToolError, match="not registered"):
        asyncio.run(registry.dispatch("unregistered_tool", {"query": "x"}))
    assert calls == []  # the executor was never consulted


def test_dispatch_is_name_exact_so_a_casing_variant_is_not_the_tool():
    registry, calls = _registry_with_recording_executor()
    with pytest.raises(UnregisteredToolError):
        asyncio.run(registry.dispatch("Search_Knowledge", {"query": "x"}))
    assert calls == []


def test_an_empty_registry_dispatches_nothing():
    with pytest.raises(UnregisteredToolError):
        asyncio.run(ToolRegistry().dispatch("search_knowledge", {}))


def test_the_refusal_names_the_tool_and_carries_it():
    error = UnregisteredToolError("nope")
    assert error.name == "nope"
    assert "nope" in str(error)


# ---------------------------------------------------------------------
# Registration and dispatch
# ---------------------------------------------------------------------


def test_a_registered_tool_dispatches_to_its_executor_with_copied_arguments():
    registry, calls = _registry_with_recording_executor()
    arguments = {"query": "grievance process"}
    result = asyncio.run(registry.dispatch("search_knowledge", arguments))
    assert result == {"ok": True}
    assert calls == [{"query": "grievance process"}]
    # The executor received its own copy: mutating it cannot reach back
    # into the caller's dict.
    assert arguments == {"query": "grievance process"}


def test_a_duplicate_registration_is_refused():
    registry = ToolRegistry()
    registry.register(_definition(), _executor)
    with pytest.raises(ValueError, match="already registered"):
        registry.register(_definition(), _executor)


def test_a_registration_without_a_name_is_refused():
    with pytest.raises(ValueError, match="non-empty name"):
        ToolRegistry().register(_definition(name=""), _executor)


def test_names_report_the_registered_set():
    registry, _ = _registry_with_recording_executor()
    assert registry.names() == ("search_knowledge",)


# ---------------------------------------------------------------------
# The model-facing definitions
# ---------------------------------------------------------------------


def test_definitions_carry_the_openai_function_tool_shape():
    registry, _ = _registry_with_recording_executor()
    definitions = registry.definitions()
    assert definitions == (
        {
            "type": "function",
            "function": {
                "name": "search_knowledge",
                "description": "Search the authorized corpus.",
                "parameters": {
                    "type": "object",
                    "properties": {"query": {"type": "string"}},
                    "required": ["query"],
                },
            },
        },
    )
