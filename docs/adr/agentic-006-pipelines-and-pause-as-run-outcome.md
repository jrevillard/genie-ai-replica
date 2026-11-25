# ADR agentic-006: Pipelines as core code, and the pause as a run outcome

- **Status**: Proposed
- **Date**: 2026-11-25
- **Decision owners**: GENIE.AI engineering (operator accepts at merge)
- **Binds**: spine AD-6 (two-level budget ownership), AD-8 (additive, versioned client
  frames), AD-9 (one flag, both paths), AD-12 (no new persistence); the spine's deferred
  item « Workflow layer (static or dynamic) — iteration 2 scope review »
- **Supersedes**: the basis of issue #603, Phase 1A (LangGraph orchestrator), 1D (status
  WebSocket) and 1E (pause and resume through checkpoints)
- **Stories**: none yet — iteration 2 is not broken down; this record is an input of that breakdown
- **Design**: `docs/superpowers/specs/2026-11-25-agentic-iteration-2-architecture-design.md`, §5 and §6

## FR-29 traceability

```
use case (some requests need more than one governed run — several searches, a synthesis,
  a verification — and an action in the user's name must wait for the user's decision,
  possibly given in a later request)
  -> requirement (operator constraints: fixed pipelines first, delegation later;
     approval and resumption for actions in the user's name)
    -> decision (this record: a pipeline is core code above the runtime port, made of typed
       steps; a pause ends a run and hands the application a serialized continuation;
       the resumed run executes the approved call through the same dispatcher)
      -> investigation (pipeline tests; the pause round-trip; the BFF contract tests)
        -> merge request (the iteration-2 architecture MR, stacked on the PRD branch)
          -> validation evidence (end-to-end extended research and errand on the shared
             cluster; approval rendered on web and mobile)
            -> released version (the merge into feat/agentic-foundations/prd)
```

## Context

Issue #603 planned multi-step workflows on LangGraph with typed state, a status WebSocket
and pause/resume through checkpoints persisted to ArangoDB. The architecture spine
deferred the workflow layer to an iteration-2 scope review and made iteration 1 deliver
the seams it plugs into. In the frameworks surveyed on 2026-11-25, a human pause is
everywhere a serialized snapshot that the application keeps (pydantic-ai: « Store the
paused conversation »; OpenAI Agents SDK: « `RunState` is designed to be durable »;
Google ADK: « the decision can arrive in a later `run_async` call, even from another
process »).

### Constraints

- AD-6: the BFF owns the end-to-end deadline; the orchestrator owns the agent-phase budget;
  everything counts.
- AD-8: the five client event types are preserved verbatim; extensions are additive and
  versioned; `done` is always the last frame.
- AD-12 and ADR agentic-003: no new persistence shape; rollback continuity is « a
  data-shape property, never a conversation attribute ».
- NFR-7: no generic workflow engine.
- The framing issue #1729 lists a visual workflow designer and long-running transactional
  workflows as non-goals.

## Decision

**A pipeline is core code above the runtime port. A pause ends a run; the application
keeps the continuation.**

1. **Steps.** An agent step is one run on the runtime port with its instruction and its
   tool subset. A direct step is code without a model. A fan-out step runs N parallel
   runs under one share of budget. A step is `required` or `optional`: on failure a
   required step ends the run with `run_error`; an optional step is skipped and recorded.
   No silent fallback.
2. **Where they live.** A `pipelines/` package in the core: the step and pipeline types,
   the runner, one module per pipeline. The run request names a pipeline by `plan`;
   absent means a simple run. An unknown plan ends with `run_error`.
3. **The pause.** When a write tool requires approval, the dispatcher records the pending
   call, cancels the run through the token (ADR agentic-004), and the orchestrator emits
   `pause_requested` then `run_paused`. `run_paused` is the terminal event of a paused
   segment; `run_finished` keeps its meaning: an answer was delivered.
4. **The continuation** is a model of the core, serialized and opaque to the BFF: pipeline
   id and version, step index, pending calls, the step outputs needed to finish, bounded
   by the evidence budget. It is bound to the user and to the originating run and refused
   on mismatch. Its lifetime is a deployment knob (proposed default: 24 hours). It is
   single use, guaranteed by the BFF through the turn's state.
5. **The resume request** carries the continuation and one decision per pending call. An
   approved call is executed through the same dispatcher, never through a direct path. A
   refused call is not executed; the model is told as data; the pipeline continues or ends
   honestly.
6. **Budgets.** Each segment has one monitor, the source of every counter. A pipeline
   declares a wall-clock share and a model-call cap per step, whose sum fits the segment's
   deadline minus the verification reserve. Segments are linked by a `pipeline_id` on
   their usage records.
7. **Client contract.** `agent_activity` gains an optional `step` field; a new, versioned
   `agent_pause` frame carries the pause for display, without any raw argument that could
   hold a secret; the non-streaming entry answers with `paused: true` and the same
   summary. One BFF endpoint receives the decision and checks ownership, single use and
   lifetime. Frame and endpoint names are fixed by the BFF contract test.
8. **First pipelines.** Extended research — plan the queries (optional), search in a
   fan-out with `web_search` and `search_knowledge`, synthesize, verify — delivered in two
   increments: first `web_search` as a tool of the simple run, then the pipeline. Errand —
   find candidate slots with read tools, pause for the user's choice and the booking's
   approval, execute, then read after writing so an unknown write outcome is settled.
9. **Delegation is reserved, not built.** A fan-out is already « child runs under a share
   of budget ». Delegation is a tool whose executor starts a child run.

## Alternatives considered

| Alternative | Status | Reason |
|---|---|---|
| LangGraph workflows with checkpoints in ArangoDB (issue #603) | Rejected | couples the workflow layer to one runtime and adds a store; the custom loop is the iteration-1 runtime (ADR agentic-002) |
| Harness-native workflows and subagents | Rejected | bound to one harness, outside the governed run: budgets, cancellation and per-request identity do not reach them |
| Declarative workflows (a YAML or JSON definition compiled to a graph) | Deferred | fixed code pipelines satisfy iteration 2 |
| Pausing inside the runtime (framework interrupts) | Rejected | requires a checkpointer inside the runtime and replays code before the interrupt (LangGraph: « The node restarts from the beginning of the node where the `interrupt` was called ») |
| A status WebSocket for pipeline progress | Rejected | the existing SSE stream carries step events additively |

## Consequences

- Positive: pipelines are runtime-agnostic by construction; an approval leaves an audit
  trail on the turn; no runtime or agent-service store.
- Negative: each segment is accounted as its own run, so a cross-segment total is the
  BFF's sum; web and mobile both need the pause surface.
- Neutral: a pending pause does not block a conversation. After a rollback the legacy
  path answers the next turn and the pause is never resumed.

## References

- Design: `docs/superpowers/specs/2026-11-25-agentic-iteration-2-architecture-design.md` (§5, §6, §8)
- Issue #603; framing issue #1729
- `docs/adr/agentic-003-in-flight-treatment-and-rollback-continuity.md`, `docs/adr/agentic-004-runtime-port-governance-by-construction.md`, `docs/adr/agentic-007-persistence-for-iteration-2.md`
- `components/agent-service/agent/events.py`, `components/gov-chat-backend/services/agent-frame-writer.js`
