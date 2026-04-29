"""
AMINA Agent Platform — Phase 2 (additive): provider-neutral native
function-calling definitions + adapters.

This module is a *pure transformation layer*. It:

  1. Reads the EXISTING `ToolSpec.to_llm_schema()` output (the same
     read-only-only filtered list v1's heuristic + JSON LLM planner
     already use).
  2. Converts it into provider-native tool-call payloads
     (OpenAI tools format, Gemini function declarations).
  3. Parses provider responses back into the v1 `AgenticToolCall`
     dataclass so downstream code (policy gate, executor, tracer)
     is unchanged.

What this module deliberately does NOT do:

  - It does not execute tools.
  - It does not bypass the policy gate (the executor still runs every
    parsed call through `tool_policy.evaluate_plan`).
  - It does not invent new tools — only the registry's read-only set
    is ever exposed.
  - It does not remove `injected: True` fields itself; those are
    already stripped by `ToolSpec.to_llm_schema()` upstream.

Phase-2 flag-default is OFF (`AMINA_AGENTIC_NATIVE_TOOLS=false`). When
the flag is off, this module is imported but never called. The
existing v1 JSON-string planner is unaffected.

Provider support matrix (current):
  - openai:  OpenAI Chat Completions tools API, also covers Groq and
             other OpenAI-compatible endpoints.
  - gemini:  Google Gemini function declarations format.
  - other:   Returns NATIVE_UNSUPPORTED — caller must fall back.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional, Tuple

from src.agent_platform.models import AgenticToolCall

logger = logging.getLogger("agent_platform.native_tools")

# Sentinel used by callers to detect "this provider can't do native tools".
NATIVE_UNSUPPORTED = "native_unsupported"

# Phase-3: machine-readable fallback reason strings. The runtime emits
# the active value into AgentTrace.native_fallback_reason so operators
# can grep traces for misconfiguration vs. provider issues vs. parse
# failures without having to read code.
FALLBACK_REASONS = {
    "FLAG_OFF":              "native_tools_flag_off",
    "UNKNOWN_PROVIDER":      "unsupported_provider_class",
    "BAD_OVERRIDE":          "native_format_override_unrecognised",
    "EMPTY_REGISTRY":        "no_v1_allowed_tools_in_registry",
    "BUILD_PAYLOAD_NONE":    "build_payload_returned_none",
    "CLIENT_EXCEPTION":      "provider_client_raised",
    "PARSE_EMPTY":           "native_response_yielded_zero_calls",
    "PARSE_EXCEPTION":       "native_response_parse_exception",
    "OK":                    "",  # success — no fallback
}


# ── Provider sniffer ──────────────────────────────────────────────────
def detect_format(client: Any, override: Optional[str] = None) -> str:
    """
    Return the provider format string for a given LLM client object,
    honouring an explicit override.

    Phase-3 hardening: the explicit override has STRICT priority over
    the class-name sniffer. Recognised override values are
    "openai"/"gemini" (case-insensitive); "auto"/"" / None falls
    through to sniff. Any OTHER non-empty override value is treated as
    NATIVE_UNSUPPORTED rather than silently sniffing — operators get a
    visible signal that their env var is misspelled instead of a
    confusing auto-detect outcome.
    """
    if override is not None:
        norm = (override or "").strip().lower()
        if norm in ("openai", "gemini"):
            return norm
        if norm not in ("", "auto"):
            # Explicit garbage value — refuse to silently sniff.
            return NATIVE_UNSUPPORTED

    cls_path = ""
    try:
        cls = type(client)
        cls_path = f"{cls.__module__}.{cls.__name__}".lower()
    except Exception:
        return NATIVE_UNSUPPORTED

    if "openai" in cls_path or "groq" in cls_path:
        return "openai"
    if "google" in cls_path or "gemini" in cls_path or "generativeai" in cls_path:
        return "gemini"
    return NATIVE_UNSUPPORTED


# ── Provider-neutral exporter ────────────────────────────────────────
def to_provider_neutral(llm_schemas: List[dict]) -> List[dict]:
    """
    Pass-through normaliser for the input list. Today the registry
    already returns:

        {"name": str, "description": str,
         "parameters": {"type": "object",
                        "properties": {...},
                        "required": [...]}}

    which is itself the provider-neutral shape. We keep this function
    as the canonical entry point so future schema migrations have one
    place to land.

    Phase-3 hardening:
      - Empty / None input returns []. Caller decides whether to skip
        the native call or proceed with a no-tool plan.
      - Duplicate tool names are de-duplicated; first occurrence wins.
        Two tools with the same name on different providers would be
        a programmer error; silently picking the first is the
        least-surprising outcome (matches dict-build semantics).
      - Missing or non-dict `parameters` is replaced with the empty
        object schema rather than raising.
    """
    out: List[dict] = []
    seen: set = set()
    for s in llm_schemas or []:
        if not isinstance(s, dict):
            continue
        name = str(s.get("name") or "").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        params = s.get("parameters")
        if not isinstance(params, dict):
            params = {"type": "object", "properties": {}, "required": []}
        out.append({
            "name":        name,
            "description": str(s.get("description") or "")[:1024],
            "parameters":  params,
        })
    return out


# ── OpenAI / OpenAI-compatible adapter ───────────────────────────────
def to_openai_tools(llm_schemas: List[dict]) -> List[dict]:
    """
    Convert the registry's LLM schemas to the OpenAI Chat Completions
    `tools=[...]` payload. Same shape works for Groq, Together, vLLM
    OpenAI-compatible endpoints, and other OpenAI-compatible services.

    OpenAI tools format:
        [{"type": "function",
          "function": {"name": ..., "description": ..., "parameters": {...}}}]
    """
    neutral = to_provider_neutral(llm_schemas)
    return [
        {
            "type": "function",
            "function": {
                "name":        s["name"],
                "description": s["description"],
                "parameters":  s["parameters"],
            },
        }
        for s in neutral
    ]


def parse_openai_tool_calls(
    response: Any,
    registry_has: Optional[Any] = None,
    max_calls: int = 3,
) -> List[AgenticToolCall]:
    """
    Extract tool calls from an OpenAI-format chat completion response.

    Tolerant of:
      - response.choices[0].message.tool_calls (SDK objects)
      - response["choices"][0]["message"]["tool_calls"] (plain dict)
      - missing fields (returns [])
      - unknown tool names (filtered out via registry_has if provided)
      - malformed JSON in arguments (skipped)

    Returns at most `max_calls` AgenticToolCall objects. Never raises.
    """
    calls: List[AgenticToolCall] = []
    try:
        message = _dig(response, ["choices", 0, "message"])
        tool_calls = _dig(message, ["tool_calls"]) or []
    except Exception:
        return calls

    for raw in tool_calls[:max_calls]:
        try:
            fn = _dig(raw, ["function"])
            name = str(_dig(fn, ["name"]) or "").strip()
            if not name:
                continue
            if registry_has is not None and not registry_has(name):
                logger.debug("[native_tools] unknown tool from LLM: %s", name)
                continue
            args_raw = _dig(fn, ["arguments"])
            args: Dict[str, Any] = {}
            if isinstance(args_raw, str):
                try:
                    args = json.loads(args_raw) if args_raw.strip() else {}
                except Exception:
                    logger.debug("[native_tools] invalid arguments JSON for %s", name)
                    args = {}
            elif isinstance(args_raw, dict):
                args = args_raw

            calls.append(AgenticToolCall(
                tool_name=name,
                arguments=args if isinstance(args, dict) else {},
                reason="native_openai_tool_call",
            ))
        except Exception as e:
            logger.debug("[native_tools] skip malformed tool_call: %s", e.__class__.__name__)
            continue
    return calls


# ── Gemini adapter ───────────────────────────────────────────────────
def to_gemini_tools(llm_schemas: List[dict]) -> List[dict]:
    """
    Convert the registry's LLM schemas to Gemini `tools=[...]` payload.

    Gemini format:
        [{"function_declarations": [
            {"name": ..., "description": ..., "parameters": {...}},
            ...
        ]}]

    The wrapping list-of-one keeps this assignable directly to the
    `tools=` kwarg the Gemini SDK accepts. Parameters object follows
    the same JSON-Schema-ish convention OpenAI uses.
    """
    neutral = to_provider_neutral(llm_schemas)
    declarations = [
        {
            "name":        s["name"],
            "description": s["description"],
            "parameters":  s["parameters"],
        }
        for s in neutral
    ]
    return [{"function_declarations": declarations}]


def parse_gemini_tool_calls(
    response: Any,
    registry_has: Optional[Any] = None,
    max_calls: int = 3,
) -> List[AgenticToolCall]:
    """
    Extract tool calls from a Gemini response.

    Tolerant of multiple shapes the Gemini SDK has used:
      - response.candidates[0].content.parts[*].function_call (SDK objs)
      - response["candidates"][0]["content"]["parts"][*]["function_call"]

    Each function_call has {name, args (dict)}. Returns at most
    `max_calls` AgenticToolCall objects. Never raises.
    """
    calls: List[AgenticToolCall] = []
    try:
        parts = _dig(response, ["candidates", 0, "content", "parts"]) or []
    except Exception:
        return calls

    for raw in parts:
        if len(calls) >= max_calls:
            break
        try:
            fc = _dig(raw, ["function_call"])
            if fc is None:
                continue
            name = str(_dig(fc, ["name"]) or "").strip()
            if not name:
                continue
            if registry_has is not None and not registry_has(name):
                logger.debug("[native_tools] unknown tool from LLM: %s", name)
                continue
            args = _dig(fc, ["args"]) or {}
            if not isinstance(args, dict):
                args = {}
            calls.append(AgenticToolCall(
                tool_name=name,
                arguments=args,
                reason="native_gemini_tool_call",
            ))
        except Exception as e:
            logger.debug("[native_tools] skip malformed function_call: %s", e.__class__.__name__)
            continue
    return calls


# ── Public dispatch ──────────────────────────────────────────────────
def build_native_tools_payload(
    llm_schemas: List[dict], fmt: str,
) -> Tuple[Optional[Any], Optional[str]]:
    """
    Single dispatch entry point used by the planner. Returns
    `(payload, kwarg_name)` where:

      - payload is the value to pass to the SDK's `tools=` (OpenAI)
        or `tools=` (Gemini) kwarg.
      - kwarg_name is always "tools" (both providers happen to use
        the same kwarg name; we still return it explicitly so a
        future provider with a different name doesn't surprise us).

    Returns `(None, None)` if `fmt` is NATIVE_UNSUPPORTED.
    """
    if fmt == "openai":
        return to_openai_tools(llm_schemas), "tools"
    if fmt == "gemini":
        return to_gemini_tools(llm_schemas), "tools"
    return None, None


def parse_native_tool_calls(
    response: Any, fmt: str,
    registry_has: Optional[Any] = None,
    max_calls: int = 3,
) -> List[AgenticToolCall]:
    """Single dispatch entry point for parsing provider responses."""
    if fmt == "openai":
        return parse_openai_tool_calls(response, registry_has, max_calls)
    if fmt == "gemini":
        return parse_gemini_tool_calls(response, registry_has, max_calls)
    return []


# ── Helpers ──────────────────────────────────────────────────────────
def _dig(obj: Any, path: List[Any]) -> Any:
    """
    Forgiving accessor that traverses both attribute and item paths.
    Returns None on any miss instead of raising. Path elements can be
    str (attr-or-key) or int (index).
    """
    cur = obj
    for step in path:
        if cur is None:
            return None
        if isinstance(step, int):
            try:
                cur = cur[step]
            except (TypeError, KeyError, IndexError):
                return None
            continue
        # str step: try item, then attr
        try:
            cur = cur[step]  # type: ignore[index]
            continue
        except (TypeError, KeyError):
            pass
        cur = getattr(cur, step, None)
    return cur


__all__ = [
    "NATIVE_UNSUPPORTED",
    "detect_format",
    "to_provider_neutral",
    "to_openai_tools",
    "to_gemini_tools",
    "parse_openai_tool_calls",
    "parse_gemini_tool_calls",
    "build_native_tools_payload",
    "parse_native_tool_calls",
]
