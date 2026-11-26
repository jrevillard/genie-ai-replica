# Agentic S1, plan 5 of 6 — the runtime port: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The loop becomes ONE runtime behind a port, so a second runtime can be written without re-implementing the governance, and the byte-identical event stream proves the extraction changed nothing.

**Architecture:** Two steps, each green before the next (the design's §3.6). (1) **Pure extraction**: the orchestrator receives a runtime factory; the loop implements `RuntimeDriver`; the event stream is recorded before the change and compared after, byte for byte. (2) **Governance into the core**: the tool dispatcher's body leaves the runtime for the core's `ToolDispatcher`, and the lifecycle events, the text delivery and the verdict move to the orchestrator — the runtime only calls the model and dispatches tools.

**Tech Stack:** Python 3.11, pytest 9.1.1, pytestarch 5.1.1 (the rules of plan 1), ruff 0.16.3.

**Spec:** `docs/superpowers/specs/2026-11-25-agentic-iteration-2-architecture-design.md` — §3 (the runtime port and the contract suite), §3.2 (the port's shape), §3.4 (the orchestrator's sequence), §3.5 (the contract suite), §3.6 (the migration path). ADR-004 (`docs/adr/agentic-004-runtime-port-governance-by-construction.md`).

## Global Constraints

- **Where the work lands.** Branch `feat/agentic-foundations/architecture` (merge request !1088, whose target is `feat/agentic-foundations/prd`). Commit on this branch only. Do not push without the operator's word, do not touch `main` or the PRD branch, never run `git stash`, never run `git reset --hard`.
- **No path is written in this plan.** Every command block starts with the same guard, which moves to the root of the checkout it is run from and refuses anything but that branch.
- **The wire is frozen.** The order on the wire is unchanged: `run_started` → tool events → `text_message_started`, `text_message_content`, `text_message_finished` → `verdict` → `run_finished`. The gate compares the recorded stream byte for byte; a difference is a stop, not a detail.
- **The BFF frame names stay BFF-owned.** The runtime emits no lifecycle event and knows no frame name (rule C4 of the design's §2.5).
- **Frozen behavior.** The RAG capability's behavior is frozen (`docs/baselines/v02-opea-query-path-contract.md`); `tests/test_equivalence_v02.py` stays green and untouched.
- **The recorded strings keep their bytes.** The execution-version record gains a `runtime` axis — a NEW key beside implementation, model, prompt and configuration; the values it carries do not change.
- **Lint locally with `--no-cache`.** A stale `.ruff_cache` answers green on a tree the CI rejects (2026-11-26).
- **An output that differs from the expected one is a stop.** Report it; do not adjust a test or a list to make it pass.

## Where this plan sits

| Plan | Content | State it leaves |
|---|---|---|
| Plan 1 — architecture rules | the rules; leak 4 (the executor) and the constant of leak 5 | four I/O violations and two cross-layer violations listed |
| Plan 2 — transport and lane | the HTTP transport and the admission lane leave the core | two I/O violations and two cross-layer violations listed |
| Plan 3 — the contract and the client | the model call's contract becomes a port; the production client becomes the vLLM adapter | two I/O violations and two cross-layer violations listed |
| Plan 4 — the measurement surfaces and the composition | the probe and the harness move to `measurement/`; the assembly and the capability's factory move to the host | no listed violation; rule R3's set is the composition root and the capability |
| **This one** | the loop becomes a runtime behind a port; the governance moves to the core | the port, the contract suite and the stream gate recorded |
| Plan 6 — the wire contracts | the BFF's contracts, the pause surface and the record's `runtime` axis, frozen | the wire pinned |

## File map

| File | Responsibility | Task |
|---|---|---|
| `components/agent-service/agent/runtime.py` | the port: `RunInputs`, `RuntimeDriver`, `BoundedModelClient` | 1 |
| `components/agent-service/agent/loop.py` | the custom loop, as a `RuntimeDriver` | 1 |
| `components/agent-service/agent/orchestrator.py` | the lifecycle, the text delivery, the verdict; the runtime factory | 1, 2 |
| `components/agent-service/agent/dispatcher.py` | the tool dispatcher: the governance the runtime no longer owns | 2 |
| `components/agent-service/agent/version_record.py` | the record's `runtime` axis | 1 |
| `components/agent-service/tests/test_runtime_contract.py` | the contract suite (C1–C5) and one violator per rule | 2 |
| `components/agent-service/tests/test_event_stream_gate.py` | the recorded stream, compared byte for byte | 1, 2 |

## Decisions taken while writing this plan

Each was checked against the code before being written here.

- **The gate is recorded BEFORE the change.** The stream is captured from the orchestrator's own tests — the frames the BFF receives today — and stored as a fixture. After each step the same capture is compared with `==`, not with a tolerant matcher: the extraction is a pure move, and any difference is a defect to explain, not a shape to accept.
- **The bound is structural before it is a rule.** Today each call site passes `max_output_tokens` by hand; a runtime that forgets it runs unbounded. The core wraps the client once (`BoundedModelClient`) and hands the wrapper to the runtime, so the cap cannot be forgotten (the design's §3.2).
- **The dispatcher never raises to steer.** LangChain turns a tool's exception into a message for the model; a raised exception would not stop every runtime. The dispatcher returns a structured result or records the reason and cancels through the token (rule C3).
- **The runtime's own events stay tool events.** The runtime emits `tool_call_started` / `tool_call_finished` and nothing else; the orchestrator owns the lifecycle and the text delivery (rule C4).

---

### Task 1: The pure extraction — the loop behind a port

**Files:**
- Create: `components/agent-service/agent/runtime.py`
- Create: `components/agent-service/tests/test_event_stream_gate.py`
- Modify: `components/agent-service/agent/loop.py`
- Modify: `components/agent-service/agent/orchestrator.py`
- Modify: `components/agent-service/agent/version_record.py`
- Modify: `components/agent-service/tests/` (the orchestrator's suites)

**Interfaces:**
- Produces:
  - `runtime.RunInputs` — frozen dataclass: `question`, `instruction`, `tools`, `model`, `dispatcher`, `monitor`, `token`, `emitter`.
  - `runtime.RuntimeDriver` — the protocol: `runtime_id: str` and `async def run(self, inputs: RunInputs) -> RunResult`.
  - `runtime.BoundedModelClient` — the core-owned wrapper that caps the output bound itself.

- [ ] **Step 1: Record the stream BEFORE the change**

Create `components/agent-service/tests/test_event_stream_gate.py`, whose fixture captures the frames the orchestrator emits today and stores them under `tests/fixtures/event_stream/`. The capture goes through the orchestrator's own path (the same one the BFF drives), not a mock.

The test asserts the fixture exists and matches the capture. At this point it records the CURRENT stream — that file is the gate.

- [ ] **Step 2: The port module**

Create `components/agent-service/agent/runtime.py` with the port's shape (the design's §3.2) — `RunInputs`, `RuntimeDriver`, and `BoundedModelClient`:

```python
class BoundedModelClient:
    """The model client with its output bound capped by the core.

    The bound rides as an argument today, and each call site passes it by
    hand; a runtime that forgets it runs unbounded. The core wraps the
    client ONCE and hands the wrapper to the runtime, so the cap cannot
    be forgotten.
    """
```

- [ ] **Step 3: The loop implements the driver**

In `components/agent-service/agent/loop.py`, the class keeps its behaviour and gains the driver's shape: `runtime_id` names it, and `run(inputs)` takes the port's inputs. The loop's own parameters become the inputs' fields.

- [ ] **Step 4: The orchestrator receives a runtime factory**

In `components/agent-service/agent/orchestrator.py`, the orchestrator takes a factory (the default builds the custom loop) and calls the runtime instead of the loop directly. The sequence is unchanged: mint the run id, build the monitor, token and emitter, emit `run_started`, call the runtime, then the existing delivery and verdict.

- [ ] **Step 5: The record gains the runtime axis**

In `components/agent-service/agent/version_record.py`, the record gains `{"id": runtime_id}` beside implementation, model, prompt and configuration. The test that pins the record's keys is updated; the recorded values do not change.

- [ ] **Step 6: The gate compares**

Run:

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
cd components/agent-service
/tmp/genie-agent-service-venv/bin/python -m pytest tests/ -q
```

Expected: the suite is green, and the gate test reports the stream IDENTICAL to the recorded fixture. A difference is a stop.

- [ ] **Step 7: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
git add components/agent-service/agent components/agent-service/tests
git commit -m "refactor(agent-service): the loop is a runtime behind a port"
```

---

### Task 2: The governance into the core

**Files:**
- Create: `components/agent-service/agent/dispatcher.py`
- Create: `components/agent-service/tests/test_runtime_contract.py`
- Modify: `components/agent-service/agent/loop.py`
- Modify: `components/agent-service/agent/orchestrator.py`
- Modify: `components/agent-service/tests/test_event_stream_gate.py`

**Interfaces:**
- Consumes: `runtime.RunInputs`, `runtime.RuntimeDriver` from Task 1.
- Produces:
  - `dispatcher.ToolDispatcher` — the tool dispatch: the budget and token checks, the tool events, the execution through the registry, the declared errors mapped to data, the evidence-ledger feed and the injection scan.
  - `dispatcher.DispatchResult` — the structured outcome: the data, or the reason the run must stop.

- [ ] **Step 1: The dispatcher leaves the runtime**

Create `components/agent-service/agent/dispatcher.py` with the body of today's `_dispatch_tool` (the design's §3.2): the budget and token checks, the `tool_call_started` event, the execution through the registry, the declared errors mapped to data, the evidence-ledger feed, the injection scan and the `tool_call_finished` event.

The dispatcher NEVER raises to steer a run: it returns a `DispatchResult`, or it records the reason on the core's state and cancels the run through the token (rule C3).

- [ ] **Step 2: The runtime calls the dispatcher**

In `components/agent-service/agent/loop.py`, the loop's dispatch becomes a call to the core's dispatcher, and the loop loses the governance it used to own. The loop keeps: calling the model (through the bounded client), dispatching tools (through the dispatcher), and returning the drafted text with its `RunResult`.

- [ ] **Step 3: The lifecycle, the text delivery and the verdict move to the orchestrator**

In `components/agent-service/agent/orchestrator.py`, the orchestrator owns what the runtime no longer does: the lifecycle events (`run_started`, `run_finished`, `run_error`), the delivered text and the mechanical insufficiency decision, and the verification pipeline with its `verdict` event (the design's §3.4).

- [ ] **Step 4: The contract suite**

Create `components/agent-service/tests/test_runtime_contract.py`, parametrized over the `RuntimeDriver` implementations, with the design's §3.5 rules:

| # | Rule |
|---|---|
| C1 | An unregistered tool is invisible to the model and refused at dispatch |
| C2 | Each budget dimension bounds the run; auxiliary calls count |
| C3 | `cancel()` stops the run, with no terminal event and readable counters |
| C4 | Only tool event kinds leave the runtime; each `started` has its `finished` with the same `call_id` |
| C5 | One runtime instance over two runs: nothing of the first leaks into the second |

Under test: the custom loop, a scripted runtime, and ONE VIOLATOR per rule — each violator must turn its own test red.

- [ ] **Step 5: The gate compares again**

Run:

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
cd components/agent-service
/tmp/genie-agent-service-venv/bin/python -m pytest tests/ -q
uvx ruff@0.16.3 check --no-cache app.py tracing.py lane.py assembly.py capabilities/ preparation/ noagent/ agent/ measurement/ tests/
uvx ruff@0.16.3 format --no-cache --check app.py tracing.py lane.py assembly.py capabilities/ preparation/ noagent/ agent/ measurement/ tests/
```

Expected: the suite is green, the contract suite is green on the custom loop and red on each violator, and the stream gate reports the stream IDENTICAL to the recorded fixture.

- [ ] **Step 6: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
git add components/agent-service/agent components/agent-service/tests
git commit -m "refactor(agent-service): the governance belongs to the core, not to the runtime"
```

---

## What this plan establishes

| Design item | Where | Evidence |
|---|---|---|
| The runtime port (§3.2) | `agent/runtime.py`, `agent/loop.py` | the loop is a `RuntimeDriver`; the orchestrator takes a factory |
| The governance is the core's (§3.1, §3.3) | `agent/dispatcher.py` | the dispatcher returns a result; the runtime never steers by raising |
| The wire is unchanged (§3.4) | `tests/test_event_stream_gate.py` | the recorded stream compares byte for byte, before and after |
| The port is a contract (§3.5) | `tests/test_runtime_contract.py` | C1–C5 green on the loop, red on one violator per rule |

## What it leaves open

- No second runtime ships (the design's §3.8): the port is the seam, not a delivery.
- The BFF's contracts, the pause surface and the record's `runtime` axis are frozen in plan 6.
- The out-of-tree spike (a pydantic-ai driver through the same suite, and the tool-calling matrix on the venue's vLLM) is the operator's probe P3.
