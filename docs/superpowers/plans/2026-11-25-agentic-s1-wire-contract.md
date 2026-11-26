# Agentic S1, plan 6 of 6 — the wire contract, frozen: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The seam between the BFF and the agent service is written down, pinned by tests on both sides, and carries the runtime axis the design asks for.

**Architecture:** Three steps. (1) The execution-version record gains the `runtime` axis — the ONE deliberate wire change of S1, recorded with the fixture re-recorded on purpose. (2) The wire contract is written as a frozen reference: the request, the envelope, the kinds, the frames, the terminal, the errors, the versioning policy. (3) The vocabulary is pinned on both sides: the agent service's test proves the BFF projects EVERY seam kind, and the BFF's test proves it ignores a kind it does not know.

**Tech Stack:** Python 3.11, pytest 9.1.1, Node 20, jest.

**Spec:** `docs/superpowers/specs/2026-11-25-agentic-iteration-2-architecture-design.md` — §3.4 (the record's runtime axis), §6 (the wire contract), ADR-005 (the vocabulary is closed and seam-owned), ADR-008 (additive and versioned).

## Global Constraints

- **Where the work lands.** Branch `feat/agentic-foundations/architecture` (merge request !1088, whose target is `feat/agentic-foundations/prd`). Commit on this branch only. Do not push without the operator's word, do not touch `main` or the PRD branch, never run `git stash`, never run `git reset --hard`.
- **No path is written in this plan.** Every command block starts with the same guard.
- **The wire changes ONCE, here, deliberately.** The record's runtime axis is the only byte the seam changes in S1. Every other byte is pinned by the event-stream gate, which stays green — the fixture is re-recorded in this plan, and the re-recording is the record of the change.
- **The seam's vocabulary stays closed and seam-owned** (ADR-005). The BFF never renames a kind, and the agent service never speaks a client frame name.
- **Frozen behavior.** The RAG capability's behavior is frozen (`docs/baselines/v02-opea-query-path-contract.md`); `tests/test_equivalence_v02.py` stays green and untouched.
- **Lint locally with `--no-cache`** (a stale `.ruff_cache` answers green on a tree the CI rejects).
- **An output that differs from the expected one is a stop.** Report it; do not adjust a test or a list to make it pass.

## Where this plan sits

| Plan | Content | State it leaves |
|---|---|---|
| Plan 1 — architecture rules | the rules; leak 4 and the constant of leak 5 | the violations listed |
| Plan 2 — transport and lane | the HTTP transport and the admission lane leave the core | the violations listed |
| Plan 3 — the contract and the client | the model call's contract becomes a port; the production client becomes the vLLM adapter | the violations listed |
| Plan 4 — the measurement surfaces and the composition | the probe and the harness move to `measurement/`; the assembly and the capability's factory move to the host | no listed violation |
| Plan 5 — the runtime port | the loop is a runtime behind a port; the governance belongs to the core; the contract suite C1–C5 | the port, the contract suite and the byte-identical gate |
| **This one** | the wire contract: the record's runtime axis, the frozen contract, the vocabulary pinned on both sides | the wire pinned |

## File map

| File | Responsibility | Task |
|---|---|---|
| `components/agent-service/agent/version_record.py` | the record's `runtime` axis | 1 |
| `components/agent-service/agent/orchestrator.py` | the record is built with the runtime's id | 1 |
| `components/agent-service/tests/test_version_record.py` | the record's shape | 1 |
| `components/agent-service/tests/fixtures/event_stream/orchestrated_run.json` | the recorded stream — re-recorded on purpose | 1 |
| `components/agent-service/tests/test_wire_contract.py` | the vocabulary the BFF projects (read from the BFF's source) | 3 |
| `components/gov-chat-backend/__tests__/routes/agent-frame-writer.test.js` | the seam-kind set the BFF projects, and the unknown-kind behaviour | 3 |
| `docs/agentic-wire-contract.md` | the frozen contract | 2 |

## Decisions taken while writing this plan

- **The runtime axis rides the record as `{"id": runtime_id}`** (the design's §3.4): beside `implementation`, `model`, `prompt` and `configuration`. The BFF stores the record as one object, so nothing changes on its side.
- **The degraded record carries the axis too.** A record whose shape varies with its failure mode is a worse contract than one whose shape never varies: the degraded path mints the same five axes.
- **The drift guard lives in the agent-service's lane.** The backend's CI job does not run on the agent service's changes, so a guard that only ran there would miss a vocabulary change. The agent-service's lane reads the BFF's source and proves the BFF projects EVERY kind the seam can emit.
- **The BFF's own test pins its side**: the kinds it projects, and the fact that a kind it does not know is ignored at debug level (the additive forward compatibility the design names).

---

### Task 1: The record's runtime axis

**Files:**
- Modify: `components/agent-service/agent/version_record.py`
- Modify: `components/agent-service/agent/orchestrator.py`
- Modify: `components/agent-service/tests/test_version_record.py`
- Modify: `components/agent-service/tests/fixtures/event_stream/orchestrated_run.json`

**Interfaces:**
- Produces:
  - `build_execution_version_record(..., runtime_id: str)` — the record gains `{"runtime": {"id": runtime_id}}`.
  - `degraded_execution_version_record(note: str, runtime_id: str)` — the same shape, minted without touching the config.

- [ ] **Step 1: The failing test**

In `components/agent-service/tests/test_version_record.py`, the test that pins the record's keys gains the `runtime` axis, and the degraded record's test gains it too. The builder is called with `runtime_id="custom-loop"`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
cd components/agent-service
/tmp/arch-review/venv-svc/bin/python -m pytest tests/test_version_record.py -q
```

Expected: FAIL — the record carries no `runtime` axis.

- [ ] **Step 3: The implementation**

In `components/agent-service/agent/version_record.py`, `build_execution_version_record` takes `runtime_id` and adds the axis; `degraded_execution_version_record` takes it too, so both records carry the same shape.

In `components/agent-service/agent/orchestrator.py`, the record is built with the runtime's id — the orchestrator holds the runtime, so it knows the id (`runtime.runtime_id`).

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
cd components/agent-service
/tmp/arch-review/venv-svc/bin/python -m pytest tests/test_version_record.py -q
```

Expected: PASS.

- [ ] **Step 5: Re-record the stream — on purpose**

The handshake's payload changed, so the gate's fixture must be re-recorded. This is the ONE deliberate wire change of S1; the commit message says so.

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
cd components/agent-service
AGENT_RECORD_EVENT_STREAM=1 /tmp/arch-review/venv-svc/bin/python -m pytest tests/test_event_stream_gate.py -q
/tmp/arch-review/venv-svc/bin/python -m pytest tests/test_event_stream_gate.py -q
```

Expected: the recording writes the fixture; the second run compares and passes.

- [ ] **Step 6: The whole suite, and the commit**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
cd components/agent-service
/tmp/arch-review/venv-svc/bin/python -m pytest tests/ -q
uvx ruff@0.16.3 check --no-cache app.py tracing.py lane.py assembly.py capabilities/ preparation/ noagent/ agent/ measurement/ tests/
uvx ruff@0.16.3 format --no-cache --check app.py tracing.py lane.py assembly.py capabilities/ preparation/ noagent/ agent/ measurement/ tests/
cd ../..
git add components/agent-service
git commit -m "feat(agent-service): the record carries the runtime that served the run"
```

---

### Task 2: The wire contract, written down

**Files:**
- Create: `docs/agentic-wire-contract.md`

- [ ] **Step 1: The document**

Write `docs/agentic-wire-contract.md`: the contract as IMPLEMENTED (not as designed) — the run request, the envelope, the seam kinds with their payloads, the client frames, the terminal usage record, the error frames, the execution-version record (with the runtime axis), the versioning policy (additive, seam-owned, no BFF frame name), and the freeze statement (a change to any of it is an operator decision, recorded in an ADR).

Every claim in the document cites the file that implements it.

- [ ] **Step 2: The commit**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
git add docs/agentic-wire-contract.md
git commit -m "docs(agentic): the wire contract, frozen"
```

---

### Task 3: The vocabulary pinned on both sides

**Files:**
- Create: `components/agent-service/tests/test_wire_contract.py`
- Modify: `components/gov-chat-backend/__tests__/routes/agent-frame-writer.test.js`
- Modify: `.gitlab-ci.yml`

**Interfaces:**
- Consumes: the seam's vocabulary (`agent/events.py`) and the BFF's projection (`services/agent-frame-writer.js`).

- [ ] **Step 1: The agent-service's drift guard**

Create `components/agent-service/tests/test_wire_contract.py`: it reads the BFF's frame writer source, extracts the seam kinds it projects (the `case '<kind>':` labels of the seam-event switch) and asserts that set EQUALS the seam's vocabulary (`EventKind`). A kind the seam can emit and the BFF does not project is a hole; a kind the BFF projects and the seam cannot emit is a stale branch.

- [ ] **Step 2: The BFF's contract test**

In `components/gov-chat-backend/__tests__/routes/agent-frame-writer.test.js`, add the two pins: the seam kinds the writer projects (the list, verbatim), and the unknown-kind behaviour — a kind the writer does not know is ignored at debug level, and the turn still finalizes as an answer.

- [ ] **Step 3: The lane that catches the drift**

In `.gitlab-ci.yml`, the agent-service's test job also runs when the BFF's seam files change (`components/gov-chat-backend/services/agent-frame-writer.js` and `components/gov-chat-backend/services/agent-seam-parser.js`) — the guard lives in that lane, so the lane must run when the consumer changes.

- [ ] **Step 4: Both suites, and the commit**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
cd components/agent-service
/tmp/arch-review/venv-svc/bin/python -m pytest tests/ -q
cd ../gov-chat-backend
npx jest __tests__/routes/agent-frame-writer.test.js
cd ../..
git add components/agent-service/tests/test_wire_contract.py components/gov-chat-backend/__tests__/routes/agent-frame-writer.test.js .gitlab-ci.yml
git commit -m "test(agentic): the seam vocabulary is pinned on both sides"
```

---

## What this plan establishes

| Design item | Where | Evidence |
|---|---|---|
| The record's runtime axis (§3.4) | `agent/version_record.py` | the record carries `{"runtime": {"id": ...}}`; the degraded record carries it too |
| The wire contract (§6) | `docs/agentic-wire-contract.md` | the contract as implemented, with the freeze statement |
| The vocabulary is pinned (§6.2, ADR-005) | `tests/test_wire_contract.py`, the BFF's frame-writer test | the seam's kinds and the BFF's projection are the same set; an unknown kind is ignored |

## What it leaves open

- The pause surface (the design's §5) is NOT built: its UX is an operator decision, and the wire's pause additions (`step_started`, `pause_requested`, `run_paused`) come with it.
- The pipelines (`pipelines/`) are not built — the design's §5, delivered after the operator's decisions.
- The out-of-tree spike (a pydantic-ai driver through the same suite, and the tool-calling matrix on the venue's vLLM) is the operator's probe P3.
