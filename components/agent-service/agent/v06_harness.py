# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""V06 — the runtime verification harness: live evidence for the D03 decision.

Verification tooling beside ``probe.py``, NOT production loop code: it shares
the seam's primitives (the loop, the cancellation token, the registry shape)
and the recorded payload conventions (``noagent.generation``), and owns only
the pieces V06 needs that nothing else has — the streaming SSE read and the
per-cell judgment.

What it produces, against the DEPLOYED endpoint:

* the **compatibility matrix** — tool-choice mode (``auto`` / ``named`` /
  ``required``) × schema strictness (``strict`` / ``permissive``) × streaming
  (off / on), one completion per cell, judged on observable response
  validity: the tool-call arguments parse as JSON matching the registered
  schema, the call id is present, no malformed tool-call markup leaks into
  the content, and streamed tool-call deltas reassemble into a complete
  call. Version and model are read from the endpoint itself and recorded
  verbatim; the parser is recorded behaviorally (what the server DID), never
  assumed — the parser axis is server-side configuration the client cannot
  set. First-call latency per schema is recorded as the FSM-compile
  observation: it informs the orchestrator's budget sizing (story 2.3), it
  decides nothing here.
* the **cancellation demos** — a streaming completion cancelled mid-flight
  (CancelledError, connection aborted, no completion delivered) and a
  loop-level run cancelled during a model call (CancelledError propagates,
  no terminal event emitted). Runtime-level only: the full request path is
  story 2.3/2.4 territory.
* one JSON evidence record, printed by the live entry::

      python -m agent.v06_harness

Every failing cell, latency observation or transport failure is recorded
honestly in the record — a failure is evidence, never a silent pass.

Boundaries this module keeps: no new runtime dependency (httpx, pydantic and
the standard library only), no production loop changes, no BFF frame names,
no HTTP surface. Runs against the venue are serial and modest in volume:
the matrix is 12 completions; the two demos and the plain control add 3.
"""

import asyncio
import contextlib
import json
import logging
import os
import time
from collections.abc import AsyncIterator, Callable
from dataclasses import asdict, dataclass, field, replace
from datetime import UTC, datetime
from typing import Any, Protocol

import httpx

from noagent.generation import RECORDED_SAMPLING_PARAMS, chat_choice, chat_choice_content
from preparation.translation import HttpxTransport

from .budget import RunBudgetMonitor
from .cancellation import CancellationToken
from .events import EventEmitter, EventKind
from .loop import AgentLoop
from .probe import PROBE_RUN_BUDGET, ProbeConfig, ProbeModelClient
from .registry import ToolDefinition, ToolRegistry

logger = logging.getLogger(__name__)

PRODUCER_ID = "agent.v06_harness"

TOOL_NAME = "search_knowledge"
"""The matrix registers ONE tool under the seam's working name: every cell
observes how the deployed endpoint handles the same definition, so a verdict
difference between cells attributes to the varied axis, never to the tool."""

MATRIX_PROMPT = (
    "Search the knowledge base for the organization's remote-work policy. "
    "You must call the search_knowledge tool with the query; do not answer from memory."
)

CANCEL_DEMO_PROMPT = "Count slowly from one to twenty, one number per line."
"""The streaming cancellation demo's prompt: long enough that the stream is
still mid-flight when the token fires."""

CONTROL_PROMPT = "Reply with the single word: ready."
"""The plain control's prompt: one short completion, no tools, no streaming."""

# The tool-choice modes of the matrix, and the wire value each maps to.
TOOL_CHOICE_MODES: tuple[str, ...] = ("auto", "named", "required")


def tool_choice_value(mode: str) -> Any:
    """The OpenAI-compatible ``tool_choice`` wire value of a matrix mode."""
    if mode == "auto":
        return "auto"
    if mode == "required":
        return "required"
    if mode == "named":
        return {"type": "function", "function": {"name": TOOL_NAME}}
    raise ValueError(f"unknown tool-choice mode: {mode!r}")


SCHEMA_STRICTNESS: tuple[str, ...] = ("strict", "permissive")

TOOL_DESCRIPTION = "Search the authorized knowledge corpus; returns ranked passages with their provenance."

SCHEMAS: dict[str, dict] = {
    # Strict: every field required, nothing additional — the shape a structured
    # output parser compiles an FSM for.
    "strict": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "The English search query."},
            "max_results": {"type": "integer", "description": "Maximum passages to return."},
        },
        "required": ["query", "max_results"],
        "additionalProperties": False,
    },
    # Permissive: one required field, anything else tolerated.
    "permissive": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "The English search query."},
        },
        "required": ["query"],
    },
}

# Markup shapes a parser-less (or misconfigured) server leaks into the content
# instead of raising a structured tool call. The list is deliberately small:
# a marker that never occurs costs nothing, a false positive would lie.
MARKUP_LEAK_MARKERS = ("<tool_call>", "</tool_call>", "<|python_tag|>", "<function=", "[TOOL_CALL]")

CONTENT_PREVIEW_CHARS = 200
# Deliberately wider than loop.py's MESSAGE_TRUNCATION (200): this bounds
# evidence-record error text, and the V06 record cites the 300-char cap.
_ERROR_PREVIEW_CHARS = 300


def _error_preview(failed: BaseException) -> str:
    """One home for the error-shaping expression every failure site pastes."""
    return f"{type(failed).__name__}: {str(failed)[:_ERROR_PREVIEW_CHARS]}"


class VerificationTransientError(RuntimeError):
    """The endpoint failed transiently (transport, status, protocol shape).

    A cell records the error as its evidence instead of being skipped; the
    typed error exists so the record can name the failure shape.
    """


# ---------------------------------------------------------------------------
# The observation types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RawToolCall:
    """One tool call as observed on the wire, parsed as far as it parses.

    ``arguments`` is the parsed JSON object, or ``None`` when the raw
    arguments are not a JSON object; ``issues`` carries what made the call
    malformed (no id, wrong name, unparseable arguments). The judgment reads
    the issues, never guesses past them.
    """

    id: str | None
    name: str | None
    raw_arguments: str | None
    arguments: dict | None
    issues: tuple[str, ...]


@dataclass(frozen=True)
class ToolCallObservation:
    """What one completion carried: content, finish reason, the tool calls.

    ``delta_count`` counts every streamed delta; ``tool_delta_count`` counts
    only the deltas that CARRY a tool call — the streaming judge reads the
    second, so a whole-call blob amid content deltas cannot pass as a
    streamed tool call.
    """

    content: str | None
    finish_reason: str | None
    calls: tuple[RawToolCall, ...]
    delta_count: int = 0
    tool_delta_count: int = 0
    error: str | None = None


def cell_label(mode: str, strictness: str, streaming: bool) -> str:
    """The cell identity format — one home; the record property and the
    failure log both name cells through it (the log fires before any
    record exists, so the property alone cannot serve both)."""
    return f"{mode}/{strictness}/streaming={streaming}"


@dataclass(frozen=True)
class CellRecord:
    """One matrix cell's verdict with the observation it was judged on."""

    tool_choice_mode: str
    schema_strictness: str
    streaming: bool
    valid: bool | None
    reasons: tuple[str, ...]
    latency_ms: float
    finish_reason: str | None
    content_preview: str | None
    tool_calls: tuple[dict, ...]
    delta_count: int
    error: str | None = None

    @property
    def label(self) -> str:
        return cell_label(self.tool_choice_mode, self.schema_strictness, self.streaming)


@dataclass(frozen=True)
class EndpointIdentity:
    """The deployed combination, read from the endpoint itself and recorded verbatim."""

    generation_endpoint: str
    version_raw: str | None
    version_note: str | None
    model_id: str | None
    max_model_len: int | None
    served_at_utc: str
    venue: str


@dataclass(frozen=True)
class StreamingCancelObservation:
    """The mid-flight streaming cancellation demo's record."""

    deltas_received: int
    cancelled_error_raised: bool
    connection_aborted: bool
    completion_delivered: bool
    wait_seconds: float
    error: str | None = None


@dataclass(frozen=True)
class LoopCancelObservation:
    """The loop-level cancellation demo's record.

    ``model_post_dispatched`` is the dispatch proof: the recording transport
    sets it when the demo's POST is entered, so an in-flight cancellation
    that never saw a dispatch cannot pass.
    """

    cancelled_error_propagated: bool
    in_flight_model_call_cancelled: bool
    model_post_dispatched: bool
    terminal_events_emitted: tuple[str, ...]
    steps: int
    model_calls: int
    tool_calls: int
    wall_clock_seconds: float
    error: str | None = None


@dataclass(frozen=True)
class PlainControlObservation:
    """The plain (no-tools) non-streaming control completion's record.

    The control proves the harness can read a normal completion on the same
    connection path the matrix uses — a matrix that fails while the control
    succeeds localizes the failure to the tool-calling surface, not to the
    wire.
    """

    status_ok: bool
    content_present: bool
    detail: str | None = None


@dataclass(frozen=True)
class VerificationEvidence:
    """One V06 run's evidence record — the record the decision cites."""

    producer: str
    venue: str
    captured_at_utc: str
    identity: EndpointIdentity
    cells: tuple[CellRecord, ...]
    first_call_latency_ms: dict[str, float]
    first_call_cell: dict[str, str]
    streaming_cancel: StreamingCancelObservation
    loop_cancel: LoopCancelObservation
    plain_control: PlainControlObservation
    notes: tuple[str, ...] = field(default_factory=tuple)

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class AcceptanceVerdict:
    """The exit-0 semantics of one V06 record, judged mechanically.

    Passed means: the identity resolved, every cell is valid with no error,
    the streaming demo cancelled + aborted + delivered nothing, and the loop
    demo propagated the cancellation onto a PROVEN dispatched call with no
    terminal event. The reasons name every failed shape; the record is the
    evidence either way.
    """

    passed: bool
    reasons: tuple[str, ...]


# ---------------------------------------------------------------------------
# The judgment: observable response validity only
# ---------------------------------------------------------------------------


def validate_arguments(arguments: Any, schema: dict) -> tuple[str, ...]:
    """The JSON-schema subset the matrix registers, checked mechanically.

    ``arguments`` is deliberately ``Any``: the contract explicitly accepts
    and judges non-dict input (a model can put anything there). Object
    properties, ``required``, ``additionalProperties`` and the scalar types
    the schemas use — the registered contract, nothing more. A fuller
    validator would judge a contract the matrix never registered.
    """
    issues: list[str] = []
    if not isinstance(arguments, dict):
        return ("the tool-call arguments are not a JSON object",)
    properties = schema.get("properties") or {}
    for name in schema.get("required") or []:
        if name not in arguments:
            issues.append(f"missing required property {name!r}")
    allowed = set(properties)
    if schema.get("additionalProperties") is False:
        for name in arguments:
            if name not in allowed:
                issues.append(f"additional property {name!r} refused by the schema")
    for name, value in arguments.items():
        expected = (properties.get(name) or {}).get("type")
        if expected and not _json_type_matches(value, expected):
            issues.append(f"property {name!r} is {type(value).__name__}, schema wants {expected}")
    return tuple(issues)


_JSON_TYPE_CHECKS: dict[str, Callable[[Any], bool]] = {
    "string": lambda v: isinstance(v, str),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
    "array": lambda v: isinstance(v, list),
    "object": lambda v: isinstance(v, dict),
    "null": lambda v: v is None,
}


def _json_type_matches(value: Any, expected: str) -> bool:
    check = _JSON_TYPE_CHECKS.get(expected)
    return check(value) if check else True


def markup_leak(content: str | None) -> str | None:
    """The first tool-call markup marker the content leaks, or None."""
    if not content:
        return None
    for marker in MARKUP_LEAK_MARKERS:
        if marker in content:
            return marker
    return None


def parse_nonstreaming_tool_calls(message: dict, expected_name: str) -> ToolCallObservation:
    """The tool calls of a non-streaming response message, parsed leniently.

    Leniently means: a malformed call becomes an issue on its observation —
    the judgment turns it into an invalid cell — never an exception that
    would hide the observation.
    """
    content = chat_choice_content({"message": message})
    raw_calls = message.get("tool_calls")
    calls: list[RawToolCall] = []
    if isinstance(raw_calls, list):
        for entry in raw_calls:
            calls.append(_parse_one_raw_call(entry, expected_name))
    elif raw_calls is not None:
        calls.append(
            RawToolCall(id=None, name=None, raw_arguments=None, arguments=None, issues=("malformed tool_calls field",))
        )
    return ToolCallObservation(content=content, finish_reason=None, calls=tuple(calls))


def _parse_arguments(raw: str | None, issue_prefix: str) -> tuple[dict | None, tuple[str, ...]]:
    """The lenient arguments read both call shapes share: JSON-parse the raw
    string, accept only an object, and turn every failure into an issue
    carrying the caller's wording — never an exception."""
    try:
        parsed = json.loads(raw) if raw else {}
        if isinstance(parsed, dict):
            return parsed, ()
        return None, (f"{issue_prefix} are not a JSON object",)
    except (TypeError, ValueError) as error:
        return None, (f"{issue_prefix} are not valid JSON: {error}",)


def _parse_one_raw_call(entry: Any, expected_name: str) -> RawToolCall:
    issues: list[str] = []
    if not isinstance(entry, dict) or not isinstance(entry.get("function"), dict):
        return RawToolCall(
            id=None, name=None, raw_arguments=None, arguments=None, issues=("malformed tool call entry",)
        )
    call_id = entry.get("id")
    if not call_id:
        issues.append("the tool call carries no id")
    name = entry["function"].get("name")
    if name != expected_name:
        issues.append(f"the tool call names {name!r}, expected {expected_name!r}")
    raw_arguments = entry["function"].get("arguments")
    arguments, argument_issues = _parse_arguments(raw_arguments, "the tool-call arguments")
    issues.extend(argument_issues)
    return RawToolCall(
        id=str(call_id) if call_id else None,
        name=str(name) if name else None,
        raw_arguments=raw_arguments if isinstance(raw_arguments, str) else None,
        arguments=arguments,
        issues=tuple(issues),
    )


def reassemble_streaming_tool_calls(events: list[dict], expected_name: str) -> ToolCallObservation:
    """The streamed tool-call deltas, reassembled into complete calls.

    vLLM's OpenAI-compatible stream carries ``delta.tool_calls`` entries
    keyed by ``index``: the first delta of a call carries its ``id`` and
    ``function.name``, later deltas append ``function.arguments`` fragments.
    Reassembly is per index; a call is complete when its id, name and the
    concatenated arguments all parse together.
    """
    content_parts: list[str] = []
    finish_reason: str | None = None
    delta_count = 0
    tool_delta_count = 0
    assembled: dict[int, dict] = {}
    order: list[int] = []
    error: str | None = None
    for event in events:
        choices = event.get("choices") if isinstance(event, dict) else None
        if not choices or not isinstance(choices[0], dict):
            continue
        delta = choices[0].get("delta") or {}
        delta_count += 1
        if delta.get("content"):
            content_parts.append(str(delta["content"]))
        if choices[0].get("finish_reason"):
            finish_reason = str(choices[0]["finish_reason"])
        tool_calls_field = delta.get("tool_calls") or []
        if tool_calls_field:
            tool_delta_count += 1
        for raw in tool_calls_field:
            if not isinstance(raw, dict):
                error = error or "a streamed tool-call delta is not an object"
                continue
            index = raw.get("index")
            if index is None:
                # An absent index is its own issue, not slot 0: defaulting
                # would merge a spec-violating delta into a legitimate
                # parallel call (names overwritten, fragments concatenated)
                # and the record would misattribute the defect. The judgment
                # fails the cell with this reason.
                error = error or "a streamed tool-call delta carries no index"
                continue
            slot = assembled.get(index)
            if slot is None:
                slot = {"id": None, "name": None, "parts": []}
                assembled[index] = slot
                order.append(index)
            if raw.get("id"):
                slot["id"] = str(raw["id"])
            function = raw.get("function") or {}
            if function.get("name"):
                slot["name"] = str(function["name"])
            if isinstance(function.get("arguments"), str):
                slot["parts"].append(function["arguments"])
    calls = tuple(_finish_assembled_call(assembled[index], expected_name) for index in order)
    content = "".join(content_parts) or None
    return ToolCallObservation(
        content=content,
        finish_reason=finish_reason,
        calls=calls,
        delta_count=delta_count,
        tool_delta_count=tool_delta_count,
        error=error,
    )


def _finish_assembled_call(slot: dict, expected_name: str) -> RawToolCall:
    issues: list[str] = []
    if not slot["id"]:
        issues.append("no streamed delta carried the call id")
    if slot["name"] != expected_name:
        issues.append(f"the streamed call names {slot['name']!r}, expected {expected_name!r}")
    raw_arguments = "".join(slot["parts"])
    arguments, argument_issues = _parse_arguments(raw_arguments, "the reassembled arguments")
    issues.extend(argument_issues)
    return RawToolCall(
        id=slot["id"],
        name=slot["name"],
        raw_arguments=raw_arguments or None,
        arguments=arguments,
        issues=tuple(issues),
    )


def judge_cell(observation: ToolCallObservation, schema: dict) -> tuple[bool, tuple[str, ...]]:
    """The per-cell verdict, on observable validity only.

    Valid means: the endpoint issued at least one well-formed tool call —
    arguments parse as JSON matching the registered schema, the call id is
    present, the registered name is the one called — and no malformed
    tool-call markup leaked into the content. Everything else records its
    reason; the reasons ARE the evidence.
    """
    reasons: list[str] = []
    marker = markup_leak(observation.content)
    if marker:
        reasons.append(f"malformed tool-call markup leaked into content: {marker!r}")
    if observation.error:
        reasons.append(observation.error)
    if not observation.calls:
        reasons.append(
            f"no tool call was issued (finish_reason={observation.finish_reason!r}); "
            "a direct text answer fails the tool-calling cell"
        )
    for call in observation.calls:
        reasons.extend(call.issues)
        if call.arguments is not None:
            reasons.extend(validate_arguments(call.arguments, schema))
    if reasons:
        return False, tuple(reasons)
    return True, ()


def judge_streaming_reassembly(observation: ToolCallObservation, schema: dict) -> tuple[bool, tuple[str, ...]]:
    """The streaming-specific judgment: the call must stream AS tool-call deltas.

    The generic validity judgment plus one streaming-only requirement: at
    least two tool-call-bearing deltas arrived, so the call was assembled
    through the delta protocol. Judging the TOOL-CALL deltas (not the total
    delta count) is what keeps a whole-call blob amid content deltas from
    passing — content deltas say nothing about how the call itself arrived.
    """
    _, reasons = judge_cell(observation, schema)
    streaming_reasons: list[str] = list(reasons)
    if observation.tool_delta_count < 2:
        streaming_reasons.append(
            f"only {observation.tool_delta_count} tool-call delta(s) arrived; "
            "the call did not stream as tool-call deltas (a single-blob call is not a streamed call)"
        )
    return (not streaming_reasons, tuple(streaming_reasons))


# ---------------------------------------------------------------------------
# The streaming read — harness-local httpx SSE
# ---------------------------------------------------------------------------


class SseStream(Protocol):
    """One open streaming completion: parsed JSON events until ``[DONE]``.

    The stream owns its teardown: every consumer closes what it consumed
    through :meth:`aclose`, and :attr:`connection_closed` is the observable
    flag the cancel demo reports — a close the caller performed, never an
    inference.
    """

    def events(self) -> AsyncIterator[dict]: ...

    @property
    def connection_closed(self) -> bool: ...

    async def aclose(self) -> None: ...


def parse_sse_payload(data: str) -> dict | None:
    """One SSE ``data:`` payload, parsed; ``None`` for the ``[DONE]`` sentinel.

    A payload that is not JSON raises — the stream is a protocol exchange
    with the deployed endpoint, and a non-JSON payload is an observation the
    cell must record, not noise to skip.
    """
    data = data.strip()
    if data == "[DONE]":
        return None
    return json.loads(data)


class HttpxSseStream:
    """The live SSE read over httpx — the protocol gains no method.

    The stream OWNS its client and response as attributes: ``_open`` builds
    the request, sends it with ``stream=True``, and runs the status and
    content-type checks as ordinary awaited calls — never inside a context
    manager unwinding under ``GeneratorExit``. The event generator only
    iterates ``response.aiter_lines()``; its ``finally`` sets the closed
    flag and performs NO await, so ``agen.aclose()`` (GeneratorExit at the
    yield) unwinds without the ``RuntimeError: generator didn't stop after
    athrow()`` trap. :meth:`aclose` is the teardown: generator first, then
    response and client as ordinary awaited calls. Idempotent.
    """

    def __init__(
        self,
        url: str,
        headers: dict,
        payload: dict,
        *,
        verify: bool,
        timeout_s: float,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self._url = url
        self._headers = headers
        self._payload = payload
        self._verify = verify
        self._timeout_s = timeout_s
        # The injected httpx transport is the test seam (MockTransport): the
        # live entry passes none and gets the real network stack.
        self._transport = transport
        self._client: httpx.AsyncClient | None = None
        self._response: httpx.Response | None = None
        self._agen: AsyncIterator[dict] | None = None
        self._closed = False

    @property
    def connection_closed(self) -> bool:
        """True once the read has torn down (generator unwound, aclose run)."""
        return self._closed

    def events(self) -> AsyncIterator[dict]:
        """The parsed-event iterator; stored so :meth:`aclose` can reach it.

        One stream, one iterator: a second call would overwrite the stored
        generator and orphan the first (its response/client would leak until
        GC) — refused, never silently replaced.
        """
        if self._agen is not None:
            raise RuntimeError("events() was already called on this stream; one stream, one iterator")
        self._agen = self._iter_events()
        return self._agen

    async def aclose(self) -> None:
        """Tear the stream down: generator, then response, then client."""
        if self._agen is not None:
            agen, self._agen = self._agen, None
            await agen.aclose()  # the unwind is await-free; no GeneratorExit trap
        if self._response is not None:
            response, self._response = self._response, None
            await response.aclose()
        if self._client is not None:
            client, self._client = self._client, None
            await client.aclose()
        self._closed = True

    async def _open(self) -> None:
        """Open the client and send the streaming request, checks included.

        The checks raise from HERE — an ordinary awaited call stack — and
        the error paths close what they opened, so a failed open never
        leaks a client.
        """
        if self._response is not None:
            return
        client = httpx.AsyncClient(timeout=self._timeout_s, verify=self._verify, transport=self._transport)
        self._client = client
        try:
            request = client.build_request("POST", self._url, headers=self._headers, json=self._payload)
            response = await client.send(request, stream=True)
        except BaseException:
            await client.aclose()
            self._client = None
            raise
        self._response = response
        try:
            if response.status_code >= 400:
                body = (await response.aread()).decode("utf-8", errors="replace")
                raise VerificationTransientError(
                    f"the streaming endpoint answered {response.status_code}: {body[:_ERROR_PREVIEW_CHARS]}"
                )
            content_type = response.headers.get("content-type", "")
            if "text/event-stream" not in content_type.lower():
                # A 200 JSON error body must not read as an eventless
                # stream (which would judge as "no tool call issued").
                body = (await response.aread()).decode("utf-8", errors="replace")
                raise VerificationTransientError(
                    f"the streaming endpoint answered {response.status_code} with content-type "
                    f"{content_type!r}, not an event stream: {body[:_ERROR_PREVIEW_CHARS]}"
                )
        except BaseException:
            await response.aclose()
            await client.aclose()
            self._response = None
            self._client = None
            self._closed = True
            raise

    async def _iter_events(self) -> AsyncIterator[dict]:
        try:
            await self._open()
            async for line in self._response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                payload = parse_sse_payload(line[len("data:") :])
                if payload is None:
                    return
                yield payload
        finally:
            # No await here ON PURPOSE: this finally also runs under
            # GeneratorExit (agen.aclose throws it at the yield), and an
            # await inside that unwind is the athrow() trap. The closing
            # awaits belong to aclose(), outside any GeneratorExit context.
            self._closed = True


def chat_completion_url(config: ProbeConfig) -> str:
    return f"{config.generation_endpoint}/v1/chat/completions"


def _auth_headers(config: ProbeConfig) -> dict:
    return {"Authorization": f"Bearer {config.bearer}"} if config.bearer else {}


def _discovery_headers(config: ProbeConfig) -> dict:
    """The discovery credential: the probe client's rule (``probe_bearer``),
    so the harness's discovery measures the same auth path the probe's
    ``/v1/models`` probe uses — not the generation bearer."""
    return {"Authorization": f"Bearer {config.probe_bearer}"} if config.probe_bearer else {}


def _matrix_payload(mode: str, strictness: str, *, streaming: bool, model_id: str) -> dict:
    definition = {
        "type": "function",
        "function": {
            "name": TOOL_NAME,
            "description": TOOL_DESCRIPTION,
            "parameters": SCHEMAS[strictness],
        },
    }
    # The recorded sampling params, with ``stream`` overridden on the
    # streaming cells: one payload convention, the axis flips only what it
    # names.
    payload = {
        "model": model_id,
        "messages": [{"role": "user", "content": MATRIX_PROMPT}],
        "tools": [definition],
        "tool_choice": tool_choice_value(mode),
        **RECORDED_SAMPLING_PARAMS,
        "stream": streaming,
    }
    return payload


# ---------------------------------------------------------------------------
# The matrix runner
# ---------------------------------------------------------------------------


def _sse_factory(config: ProbeConfig):
    """The live SSE stream builder: one open stream per streaming cell."""

    def build(payload: dict) -> SseStream:
        return HttpxSseStream(
            chat_completion_url(config),
            _auth_headers(config),
            payload,
            verify=config.tls_verify,
            timeout_s=config.llm_timeout_seconds,
        )

    return build


async def run_cell(
    config: ProbeConfig,
    transport,
    model_id: str,
    mode: str,
    strictness: str,
    *,
    streaming: bool,
    sse_factory=None,
) -> CellRecord:
    """One matrix cell: one completion, judged, recorded. Serial by caller."""
    payload = _matrix_payload(mode, strictness, streaming=streaming, model_id=model_id)
    started = time.perf_counter()
    error: str | None = None
    observation: ToolCallObservation | None = None
    try:
        if streaming:
            observation = await _run_streaming_cell(payload, sse_factory or _sse_factory(config))
        else:
            observation = await _run_nonstreaming_cell(config, transport, payload)
    except Exception as failed:  # noqa: BLE001 — a failed cell is recorded, never skipped
        error = _error_preview(failed)
        logger.warning("matrix cell %s failed: %s", cell_label(mode, strictness, streaming), error)
    latency_ms = (time.perf_counter() - started) * 1000.0
    return _record_cell(mode, strictness, streaming, observation, latency_ms, error)


async def _run_nonstreaming_cell(config: ProbeConfig, transport, payload: dict) -> ToolCallObservation:
    status, body = await transport.post_json(
        chat_completion_url(config), _auth_headers(config), payload, config.llm_timeout_seconds
    )
    if status >= 400:
        raise VerificationTransientError(f"the endpoint answered {status}: {str(body)[:_ERROR_PREVIEW_CHARS]}")
    if not isinstance(body, dict):
        raise VerificationTransientError(f"the endpoint answered a {type(body).__name__}, not an object")
    choice, finish_reason = chat_choice(body)
    if choice is None:
        raise VerificationTransientError("the response carries no choice")
    message = choice.get("message") or {}
    observation = parse_nonstreaming_tool_calls(message, TOOL_NAME)
    return replace(observation, finish_reason=finish_reason)


async def _run_streaming_cell(payload: dict, sse_factory) -> ToolCallObservation:
    stream = sse_factory(payload)
    events: list[dict] = []
    try:
        async for event in stream.events():
            events.append(event)
    finally:
        # Every consumed stream is closed by its consumer — a drained
        # stream's client would otherwise leak until GC.
        await stream.aclose()
    return reassemble_streaming_tool_calls(events, TOOL_NAME)


def _record_cell(
    mode: str,
    strictness: str,
    streaming: bool,
    observation: ToolCallObservation | None,
    latency_ms: float,
    error: str | None,
) -> CellRecord:
    if observation is None:
        return CellRecord(
            tool_choice_mode=mode,
            schema_strictness=strictness,
            streaming=streaming,
            valid=None,
            reasons=(),
            latency_ms=latency_ms,
            finish_reason=None,
            content_preview=None,
            tool_calls=(),
            delta_count=0,
            error=error,
        )
    schema = SCHEMAS[strictness]
    if streaming:
        valid, reasons = judge_streaming_reassembly(observation, schema)
    else:
        valid, reasons = judge_cell(observation, schema)
    return CellRecord(
        tool_choice_mode=mode,
        schema_strictness=strictness,
        streaming=streaming,
        valid=valid,
        reasons=reasons,
        latency_ms=latency_ms,
        finish_reason=observation.finish_reason,
        content_preview=observation.content[:CONTENT_PREVIEW_CHARS] if observation.content else None,
        tool_calls=tuple({"id": call.id, "name": call.name, "arguments": call.arguments} for call in observation.calls),
        delta_count=observation.delta_count,
        error=error,
    )


async def read_endpoint_identity(config: ProbeConfig, transport, venue: str = "") -> EndpointIdentity:
    """The deployed combination, read from the endpoint itself.

    The version endpoint is probed and recorded verbatim — whatever it
    answers, including an answer that carries no version — so the record
    never states a version the endpoint did not serve. The model id is the
    discovery the probe's client uses (override first, then ``/v1/models``).
    The venue label is the caller's (the live entry reads the
    ``AGENT_VERIFICATION_VENUE`` knob); it rides the record verbatim.
    """
    version_raw: str | None = None
    version_note: str | None = None
    url = f"{config.generation_endpoint}/version"
    try:
        status, body = await transport.get_json(url, _discovery_headers(config), config.probe_timeout_seconds)
        if status < 400:
            version_raw = json.dumps(body)[:_ERROR_PREVIEW_CHARS]
        else:
            version_note = f"GET /version answered {status}"
    except Exception as failed:  # noqa: BLE001 — an absent version endpoint is recorded, not fatal
        version_note = f"GET /version failed: {_error_preview(failed)}"
    model_id, max_model_len = await _discover_model(config, transport)
    return EndpointIdentity(
        generation_endpoint=config.generation_endpoint,
        version_raw=version_raw,
        version_note=version_note,
        model_id=model_id,
        max_model_len=max_model_len,
        served_at_utc=datetime.now(UTC).isoformat(timespec="seconds"),
        venue=venue,
    )


async def _discover_model(config: ProbeConfig, transport) -> tuple[str | None, int | None]:
    """The model id and window the endpoint serves (the probe's discovery)."""
    if config.model_id_override:
        return config.model_id_override, None
    url = f"{config.generation_endpoint}/v1/models"
    try:
        status, body = await transport.get_json(url, _discovery_headers(config), config.probe_timeout_seconds)
    except Exception as failed:  # noqa: BLE001
        raise VerificationTransientError(f"the model discovery failed: {_error_preview(failed)}") from failed
    if status >= 400:
        raise VerificationTransientError(f"the model discovery answered {status}: {str(body)[:_ERROR_PREVIEW_CHARS]}")
    data = body.get("data") if isinstance(body, dict) else None
    # A list check before the subscript: a malformed body ({"data": {...}} or
    # {"data": 5}) must become the typed transient naming the shape, not a
    # KeyError/TypeError from an unguarded index.
    entry = data[0] if isinstance(data, list) and data and isinstance(data[0], dict) else None
    if not entry or not entry.get("id"):
        raise VerificationTransientError(
            "the model discovery carried no usable model entry "
            f"(expected a non-empty list of objects under 'data', got {type(data).__name__})"
        )
    window = entry.get("max_model_len")
    # bool is an int in Python; a True window is a malformed answer, not 1.
    return str(entry["id"]), window if isinstance(window, int) and not isinstance(window, bool) else None


async def run_matrix(
    config: ProbeConfig, transport, model_id: str, sse_factory=None
) -> tuple[list[CellRecord], dict[str, float], dict[str, str]]:
    """Every cell of the matrix, serially, in a stable order.

    The first ERROR-FREE call per schema strictness carries the FSM-compile
    latency — recorded per schema, per the V06 design (it informs the
    orchestrator's budget sizing; it decides nothing here). An errored cell
    never feeds the slot (a rejection round-trip is not a compile), and
    ``first_call_cell`` names the cell that fed each slot.
    """
    cells: list[CellRecord] = []
    first_call_latency: dict[str, float] = {}
    first_call_cell: dict[str, str] = {}
    for mode in TOOL_CHOICE_MODES:
        for strictness in SCHEMA_STRICTNESS:
            for streaming in (False, True):
                record = await run_cell(
                    config, transport, model_id, mode, strictness, streaming=streaming, sse_factory=sse_factory
                )
                if record.error is None and strictness not in first_call_latency:
                    first_call_latency[strictness] = record.latency_ms
                    first_call_cell[strictness] = record.label
                cells.append(record)
    return cells, first_call_latency, first_call_cell


# ---------------------------------------------------------------------------
# The cancellation demos — runtime level, against the live endpoint
# ---------------------------------------------------------------------------


@dataclass
class _StreamCancelState:
    """The streaming-cancel demo's live counters, shared with its consumer."""

    events: int = 0
    completion_seen: bool = False
    aborted: bool = False
    error: str | None = None


async def _consume_stream_events(
    stream: SseStream,
    state: _StreamCancelState,
    park: asyncio.Event | None = None,
    park_timeout_seconds: float = 5.0,
    first_delta: asyncio.Event | None = None,
) -> None:
    """Consume the stream into ``state`` until it ends or the task is cancelled.

    The state is the demo's evidence: how many events arrived before the
    cancel, whether a completion arrived first, and whether the demo
    performed the teardown on the cancelled read (the client-side abort is
    what the runtime-level AC names; a server-side close during the park
    window is not client-observable). ``first_delta`` fires when the first
    counted event arrives — the demo's wake-up signal. A ``park`` event
    parks the consumer after its first delta (the demo fires it, then
    cancels) so the cancellation point is the demo's, not a race against
    the model's typing speed.
    """
    try:
        async for event in stream.events():
            if not isinstance(event, dict):
                continue  # a non-dict event is not a delta; it never counts
            state.events += 1
            if first_delta is not None:
                first_delta.set()
            choices = event.get("choices") or []
            choice = choices[0] if choices and isinstance(choices[0], dict) else {}
            # Only the finish chunk counts as a DELIVERED completion: a
            # mid-stream tool-call delta is work in flight, exactly what the
            # demo cancels.
            if choice.get("finish_reason"):
                state.completion_seen = True
            if park is not None and state.events == 1:
                # Park after the first delta: the read stays OPEN (the
                # server keeps generating into a connection nobody is
                # draining — the real shape of a slow downstream consumer),
                # and the demo owns the exact cancellation point. Without
                # the park, a fast model finishes the whole completion
                # before the demo's cancel lands, and the record would say
                # "completion delivered" — about the HARNESS's lateness,
                # not the venue's behavior.
                park.set()
                # A timed sleep, not a wait on a phantom partner: the demo
                # is expected to cancel within this window (the park exists
                # to hand it the cancellation point), so there is nothing
                # to wait FOR — only a bounded pause on an open read. The
                # sleep RETURNING means the window elapsed without the
                # cancel: the diagnostic is recorded and the consumer
                # drains on, exactly the old wait_for-timeout semantics.
                await asyncio.sleep(park_timeout_seconds)
                state.error = "the demo did not cancel within the park window; the consumer drained on"
    except asyncio.CancelledError:
        state.aborted = True
        raise
    except Exception as failed:  # noqa: BLE001 — the demo records the failure shape
        state.error = _error_preview(failed)


async def demo_streaming_cancel(
    config: ProbeConfig,
    model_id: str,
    sse_factory=None,
    *,
    first_event_wait_seconds: float = 30.0,
    park_first_delta: bool = True,
    park_timeout_seconds: float = 5.0,
) -> StreamingCancelObservation:
    """Cancel a streaming completion after its first delta, record what happened.

    The completion is PLAIN — no tools, no ``tool_choice`` — so the demo
    isolates the cancellation variable from the tool-calling matrix: a
    venue whose serving config rejects tool calls still demonstrates (or
    fails to demonstrate) the mid-flight abort honestly. The demo asserts
    nothing: it records — deltas received, whether the CancelledError was
    raised, whether the demo performed the teardown on the cancelled read,
    and whether a completion was delivered anyway. The record is the
    acceptance evidence, judged by the reader.
    """
    state = _StreamCancelState()
    payload = {
        "model": model_id,
        "messages": [{"role": "user", "content": CANCEL_DEMO_PROMPT}],
        **RECORDED_SAMPLING_PARAMS,
        "stream": True,
    }
    stream = (sse_factory or _sse_factory(config))(payload)
    park = asyncio.Event() if park_first_delta else None
    first_delta = asyncio.Event()
    consumer = asyncio.ensure_future(_consume_stream_events(stream, state, park, park_timeout_seconds, first_delta))
    started = time.monotonic()
    first_delta_waiter = asyncio.ensure_future(first_delta.wait())
    await asyncio.wait(
        {first_delta_waiter, consumer}, timeout=first_event_wait_seconds, return_when=asyncio.FIRST_COMPLETED
    )
    wait_seconds = time.monotonic() - started
    first_delta_waiter.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await first_delta_waiter
    error = state.error
    if state.events == 0:
        # No delta ever arrived: the demo could not start. The reason names
        # it — a cancelled read that never saw a byte is not the evidence
        # the AC asks for.
        error = error or f"no streaming delta arrived within {first_event_wait_seconds:.0f}s; the demo could not start"
    consumer.cancel()
    cancelled_error_raised = False
    try:
        await consumer
    except asyncio.CancelledError:
        cancelled_error_raised = True
    except Exception as failed:  # noqa: BLE001 — recorded like any other observation
        error = error or _error_preview(failed)
    # The teardown the record reports is one the DEMO performed: aclose is
    # called explicitly, then the flag is read. A cancel with no teardown
    # never counts as an abort, and a stream that drained to completion
    # never counts as aborted even though its connection closed normally.
    await stream.aclose()
    connection_aborted = cancelled_error_raised and stream.connection_closed
    return StreamingCancelObservation(
        deltas_received=state.events,
        cancelled_error_raised=cancelled_error_raised,
        connection_aborted=connection_aborted,
        completion_delivered=state.completion_seen,
        wait_seconds=wait_seconds,
        error=error,
    )


class _DispatchRecordingTransport:
    """Wraps the demo's live transport and records that the POST was entered.

    The flag is the dispatch proof for ``LoopCancelObservation``: an
    ``in_flight_model_call_cancelled`` without ``model_post_dispatched``
    means the cancel landed on the discovery leg (or before any request) —
    not on the model call the demo exists to cancel.
    """

    def __init__(self, inner, recorder: dict):
        self._inner = inner
        self._recorder = recorder

    async def get_json(self, url: str, headers: dict, timeout_s: float) -> tuple[int, Any]:
        return await self._inner.get_json(url, headers, timeout_s)

    async def post_json(self, url: str, headers: dict, payload: dict, timeout_s: float) -> tuple[int, Any]:
        self._recorder["model_post_dispatched"] = True
        return await self._inner.post_json(url, headers, payload, timeout_s)


class _CancelDuringModelCall:
    """A ``LoopModelClient`` wrapper that fires the token DURING the model call.

    The token fires after the call has started and before the inner client
    awaits the endpoint — with the model id pre-resolved, the inner client's
    first await IS the POST, so the cancel lands on the model call itself,
    not on a discovery probe.
    """

    def __init__(self, inner, token: CancellationToken, recorder: dict):
        self._inner = inner
        self._token = token
        self._recorder = recorder

    async def complete(
        self, messages: list[dict], tool_definitions: tuple[dict, ...], *, max_output_tokens: int | None
    ):
        self._recorder["model_call_started"] = True
        self._token.cancel()
        try:
            return await self._inner.complete(messages, tool_definitions, max_output_tokens=max_output_tokens)
        except asyncio.CancelledError:
            self._recorder["in_flight_cancelled"] = True
            raise


_CLOCK_TOOL = ToolDefinition(
    name="read_clock",
    description="Returns the server's current UTC time. A local fake tool for the cancellation demo.",
    parameters={"type": "object", "properties": {}},
)


async def demo_loop_cancel(config: ProbeConfig, transport, model_id: str | None = None) -> LoopCancelObservation:
    """Cancel an ``AgentLoop`` run during a live model call, record what happened.

    The loop drives the live endpoint through the probe's model client (the
    recorded conventions) over a registry of FAKE tools — nothing touches
    the corpus; the venue sees read-only model calls in modest volume. The
    model id arrives pre-resolved from the run's identity and is pinned as
    the client's override, so the demo's cancel lands on the POST itself
    (``model_post_dispatched`` records that it was entered) instead of on
    the discovery leg. The terminal-event check is the seam's honesty
    contract: a cancelled run emits neither ``run_finished`` nor
    ``run_error``.
    """
    if model_id:
        config = replace(config, model_id_override=model_id)
    recorder: dict = {"model_call_started": False, "in_flight_cancelled": False, "model_post_dispatched": False}
    emitted: list[str] = []
    token = CancellationToken()
    emitter = EventEmitter(run_id="v06-cancel-demo", sink=lambda event: emitted.append(str(event.kind.value)))
    registry = ToolRegistry()
    registry.register(_CLOCK_TOOL, _read_clock_executor)
    loop = AgentLoop(
        model=_CancelDuringModelCall(
            ProbeModelClient(config, transport=_DispatchRecordingTransport(transport, recorder)), token, recorder
        ),
        registry=registry,
        monitor=_demo_monitor(),
        token=token,
        emitter=emitter,
        system_prompt="You answer using the provided tools. Answer in English.",
    )
    cancelled_error_propagated = False
    error: str | None = None
    try:
        await loop.run("What time is it right now?")
    except asyncio.CancelledError:
        cancelled_error_propagated = True
    except Exception as failed:  # noqa: BLE001 — recorded honestly, like any demo observation
        error = _error_preview(failed)
    monitor = loop.monitor
    terminal = tuple(kind for kind in emitted if kind in (EventKind.RUN_FINISHED.value, EventKind.RUN_ERROR.value))
    if not cancelled_error_propagated and error is None:
        error = "the loop run completed instead of propagating the cancellation; the demo is void"
    return LoopCancelObservation(
        cancelled_error_propagated=cancelled_error_propagated,
        in_flight_model_call_cancelled=recorder["in_flight_cancelled"],
        model_post_dispatched=recorder["model_post_dispatched"],
        terminal_events_emitted=terminal,
        steps=monitor.steps,
        model_calls=monitor.model_calls,
        tool_calls=monitor.tool_calls,
        wall_clock_seconds=monitor.elapsed_seconds,
        error=error,
    )


def _demo_monitor() -> RunBudgetMonitor:
    """The demo run's budget monitor: HALF the probe's smoke bounds, one
    run — the halves are the demo's declared bounds, derived from (not
    re-declared beside) the one smoke-bound home."""
    return RunBudgetMonitor(
        replace(
            PROBE_RUN_BUDGET,
            max_steps=4,
            max_model_calls=4,
            max_tool_calls=4,
            max_total_tokens=262144,
            max_evidence_bytes=262144,
            wall_clock_seconds=300.0,
        )
    )


async def _read_clock_executor(arguments: dict) -> dict:
    return {"utc_now": datetime.now(UTC).isoformat(timespec="seconds")}


# ---------------------------------------------------------------------------
# The evidence record and the live entry
# ---------------------------------------------------------------------------


async def run_plain_control(config: ProbeConfig, transport, model_id: str) -> PlainControlObservation:
    """One plain (no tools, non-streaming) completion — the wire control.

    The record proves the harness reads a normal completion on the same
    connection path the matrix uses; it is evidence, not a gate.
    """
    payload = {
        "model": model_id,
        "messages": [{"role": "user", "content": CONTROL_PROMPT}],
        **RECORDED_SAMPLING_PARAMS,
        "stream": False,
    }
    try:
        status, body = await transport.post_json(
            chat_completion_url(config), _auth_headers(config), payload, config.llm_timeout_seconds
        )
    except Exception as failed:  # noqa: BLE001 — the control records its failure like a cell
        return PlainControlObservation(
            status_ok=False,
            content_present=False,
            detail=_error_preview(failed),
        )
    if status >= 400:
        return PlainControlObservation(False, False, detail=f"answered {status}: {str(body)[:_ERROR_PREVIEW_CHARS]}")
    choice, _ = chat_choice(body) if isinstance(body, dict) else (None, None)
    content = chat_choice_content(choice) if choice else None
    return PlainControlObservation(
        status_ok=True,
        content_present=bool(content),
        detail=None if content else "the control completion carried no content",
    )


async def run_verification(
    config: ProbeConfig, transport=None, sse_factory=None, venue: str = ""
) -> VerificationEvidence:
    """One V06 pass: identity, matrix, cancellation demos, control — the full record."""
    transport = transport if transport is not None else HttpxTransport(config.tls_verify)
    identity = await read_endpoint_identity(config, transport, venue)
    if identity.model_id is None:
        raise VerificationTransientError("no model id: the endpoint identity could not be established")
    notes: list[str] = []
    if identity.version_raw is None:
        notes.append(f"the endpoint served no version: {identity.version_note}")
    cells, first_call_latency, first_call_cell = await run_matrix(
        config, transport, identity.model_id, sse_factory=sse_factory
    )
    # A machine-readable posture note when the server itself named the
    # missing parser flags: the tool-calling surface is a serving-config
    # question, and the record should say so without a human reading 12 errors.
    flagged = sum(
        1
        for cell in cells
        if cell.error and ("--tool-call-parser" in cell.error or "--enable-auto-tool-choice" in cell.error)
    )
    if flagged:
        notes.append(
            f"rec6_serving_flags: not pinned ({flagged} of {len(cells)} cells rejected with the parser-flag 400)"
        )
    streaming_cancel = await demo_streaming_cancel(config, identity.model_id, sse_factory=sse_factory)
    loop_cancel = await demo_loop_cancel(config, transport, model_id=identity.model_id)
    plain_control = await run_plain_control(config, transport, identity.model_id)
    return VerificationEvidence(
        producer=PRODUCER_ID,
        venue=venue,
        captured_at_utc=datetime.now(UTC).isoformat(timespec="seconds"),
        identity=identity,
        cells=tuple(cells),
        first_call_latency_ms=first_call_latency,
        first_call_cell=first_call_cell,
        streaming_cancel=streaming_cancel,
        loop_cancel=loop_cancel,
        plain_control=plain_control,
        notes=tuple(notes),
    )


def acceptance_verdict(evidence: VerificationEvidence) -> AcceptanceVerdict:
    """The exit-0 semantics of one V06 record, judged mechanically and purely.

    Passed means: the identity resolved; every cell is valid with no error;
    the streaming demo cancelled + observed the teardown abort + delivered
    nothing; the loop demo propagated the cancellation onto a PROVEN
    dispatched model call with no terminal event. The plain control and the
    notes are evidence, not gates — they localize failures, they do not
    pass them.
    """
    reasons: list[str] = []
    if evidence.identity.model_id is None:
        reasons.append("no model id: the endpoint identity was not resolved")
    for cell in evidence.cells:
        label = cell.label
        if cell.error is not None:
            reasons.append(f"cell {label} errored: {cell.error}")
        elif cell.valid is not True:
            reasons.append(f"cell {label} invalid: {'; '.join(cell.reasons)}")
    streaming = evidence.streaming_cancel
    if streaming.error is not None:
        reasons.append(f"the streaming-cancel demo failed: {streaming.error}")
    if not (streaming.cancelled_error_raised and streaming.connection_aborted and not streaming.completion_delivered):
        reasons.append(
            "the streaming-cancel acceptance shape is not met "
            "(a cancelled read whose demo-performed teardown is observed, and no completion delivered): "
            f"cancelled={streaming.cancelled_error_raised}, aborted={streaming.connection_aborted}, "
            f"delivered={streaming.completion_delivered}"
        )
    loop = evidence.loop_cancel
    if loop.error is not None:
        reasons.append(f"the loop-cancel demo failed: {loop.error}")
    if not (loop.cancelled_error_propagated and loop.in_flight_model_call_cancelled and loop.model_post_dispatched):
        reasons.append(
            "the loop-cancel acceptance shape is not met "
            f"(propagated={loop.cancelled_error_propagated}, "
            f"in_flight_cancelled={loop.in_flight_model_call_cancelled}, "
            f"post_dispatched={loop.model_post_dispatched})"
        )
    if loop.terminal_events_emitted:
        reasons.append(f"a cancelled run emitted terminal events: {loop.terminal_events_emitted}")
    return AcceptanceVerdict(passed=not reasons, reasons=tuple(reasons))


def _failure_record(error: str) -> dict:
    """The citable record of a run that could not produce evidence."""
    return {
        "producer": PRODUCER_ID,
        "status": "failed",
        "captured_at_utc": datetime.now(UTC).isoformat(timespec="seconds"),
        "error": error[:_ERROR_PREVIEW_CHARS],
    }


def _main() -> int:
    """The live entry: one JSON evidence record with per-cell verdicts.

    A failed run prints its JSON error record and exits 1 — a traceback
    leaves nothing citable; a record always does. Exit 0 means the full
    acceptance semantics passed (:func:`acceptance_verdict`).
    """
    logging.basicConfig(level="WARNING", format="%(asctime)s %(levelname)s %(name)s %(message)s")
    config = ProbeConfig.load()
    venue = str(os.environ.get("AGENT_VERIFICATION_VENUE", ""))
    try:
        evidence = asyncio.run(run_verification(config, venue=venue))
    except VerificationTransientError as failed:
        print(json.dumps(_failure_record(str(failed)), indent=2))
        return 1
    except Exception as failed:  # noqa: BLE001 — a failed run still leaves its record
        print(json.dumps(_failure_record(_error_preview(failed)), indent=2))
        return 1
    verdict = acceptance_verdict(evidence)
    record = evidence.as_dict()
    record["acceptance"] = {"passed": verdict.passed, "reasons": list(verdict.reasons)}
    print(json.dumps(record, indent=2))
    return 0 if verdict.passed else 1


if __name__ == "__main__":
    raise SystemExit(_main())
