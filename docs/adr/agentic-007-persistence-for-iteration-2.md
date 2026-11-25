# ADR agentic-007: Persistence for iteration 2 — existing shapes, one additive block

- **Status**: Proposed
- **Date**: 2026-11-25
- **Decision owners**: GENIE.AI engineering (operator accepts at merge)
- **Binds**: spine AD-12 (re-declared here for iteration 2), AD-11 (versioned execution
  records), ADR agentic-003 (rollback continuity), NFR-2
- **Stories**: none yet — iteration 2 is not broken down; this record is an input of that breakdown
- **Design**: `docs/superpowers/specs/2026-11-25-agentic-iteration-2-architecture-design.md`, §7

## FR-29 traceability

```
use case (pipelines pause for a user's decision, tools leave an audit trail and a
  conversation carries context from one turn to the next — and none of this may break the
  legacy path's ability to continue a conversation after a rollback)
  -> requirement (operator constraint: the application owns the state, the runtime holds no
     store, following the current state of the art)
    -> decision (this record: the BFF and its existing collections remain the only store;
       the per-turn queries record gains an additive agent block; conversation context
       travels with the run request)
      -> investigation (BFF contract tests; the rollback-continuity test with a pending pause)
        -> merge request (the iteration-2 architecture MR, stacked on the PRD branch)
          -> validation evidence (the legacy path continues a conversation that carries a
             pending pause; no storage client in agent-service)
            -> released version (the merge into feat/agentic-foundations/prd)
```

## Context

AD-12 reads: « The agentic path writes only through the existing shapes: `queries`
collection per turn (BFF, unchanged), `conversations`/`messages`/`conversationFiles`/
`queryMessages` on user-initiated save (unchanged). Agent-internal session state stays
in-request (iteration 1 is read-only) ». It prevents « a session/audit store that breaks
rollback continuity or adds an migration burden ». Its scope is iteration 1.

Iteration 2 adds state the record does not cover: a pending pause with its continuation,
a tool-call audit trail, and conversation context — the run receives one `question`
today, while the legacy path condenses up to eight prior message
segments — four exchanges (`MULTI_TURN_CONDENSE_HISTORY_TURNS = 8`).

Read from the documentation of six runtimes on 2026-11-25, the prevailing pattern is that
storage belongs to the application behind an interface, and that a pause is a serialized
snapshot the application keeps. LangGraph: the host supplies the checkpointer, and « When
the process restarts, all checkpoints are lost » in memory. pydantic-ai: « deliberately
unopinionated about your database ». Google ADK: a pluggable `SessionService`. Strands:
pluggable storage. Durable execution is a separate tier with an external engine
(Temporal, DBOS, Prefect, Restate, Durable Task Scheduler). The counter-example is
DeepSeek Harness, which keeps its sessions in its own home directory.

### Constraints

- AD-12, AD-11, ADR agentic-003.
- The BFF is the trusted caller: it assembles the caller context and persists the
  execution-version record at `run_started`.
- No new store in `agent-service`; the core imports no storage client.

## Decision

**The BFF and its existing collections remain the only store. The per-turn `queries`
record gains an additive `agent` block that the legacy path never reads.**

1. **AD-12, re-declared for iteration 2.** The rule is kept and completed: the agentic
   path writes only through the existing shapes; the `queries` record gains an additive
   `agent` block.
2. **Where each piece of state lives.**

   | State | Owner | Where |
   |---|---|---|
   | Conversation and messages | BFF | existing `conversations`, `messages`, `queryMessages` |
   | Execution versions of a run | BFF | `queries`, at `run_started` (unchanged) |
   | Run-internal state | agent-service | in memory, for the duration of the request |
   | Pending pause and continuation | BFF | `queries.agent.pause` |
   | Tool-call audit summary | BFF | `queries.agent.tool_calls[]` |
   | Approval decision | BFF | `queries.agent.pause.decision` |

3. **Conversation context travels with the request.** The run request gains `turns`: a
   bounded list of prior user and assistant messages that the BFF assembles from existing
   records. Two deployment knobs bound it (proposed defaults: 8 messages — four exchanges,
   the depth the legacy path condenses — and 12 000 characters);
   history tokens count against the run's token budget. There is no separate condense
   step: the model sees the turns and writes standalone search queries itself.
4. **Audit summary.** Per tool call: `call_id`, tool, outcome, duration, bytes. For a
   write: the idempotency key, the receipt reference and the decision. Raw arguments and
   results of read tools are not stored in this block.
5. **Crash.** A run is lost if `agent-service` restarts mid-run. The BFF reports the
   failure; nothing is retried automatically. Accepted while runs are short.
6. **Rollback continuity.** The legacy path ignores the `agent` block. A pending pause is
   never resumed after a rollback; the conversation continues.

## Alternatives considered

| Alternative | Status | Reason |
|---|---|---|
| Sessions owned by the runtime (DeepSeek Harness model) | Rejected | one live agent per session until the process stops; a second owner of the conversation history; breaks rollback continuity |
| A checkpointer interface inside `agent-service`, with an ArangoDB adapter | Not adopted | no requirement: runs are bounded, and it would add a store and a write path to the service |
| A durable execution engine | Not adopted | a stateful cluster component for a need iteration 2 does not have |
| A new audit collection | Deferred | the additive block on the existing per-turn record satisfies iteration 2; a regulation requiring full argument retention would reopen this |

## Consequences

- Positive: no migration of existing shapes beyond additive fields; `agent-service` stays
  stateless, so it can scale out independently of the single-replica lane decision; the
  legacy path is untouched.
- Negative: a run interrupted by a restart is lost; a continuation expires.
- Neutral: revisit trigger — runs long enough that losing one on restart costs more than
  a checkpoint. The pipeline state is already serializable at step boundaries, so that
  step adds a storage port and nothing else.

## References

- Design: `docs/superpowers/specs/2026-11-25-agentic-iteration-2-architecture-design.md` (§7)
- Architecture spine: `_bmad-output/planning-artifacts/architecture/architecture-genie-ai-2026-11-16/ARCHITECTURE-SPINE.md` (AD-11, AD-12)
- `docs/adr/agentic-003-in-flight-treatment-and-rollback-continuity.md`
- `docs/baselines/v02-opea-query-path-contract.md`
- `components/gov-chat-backend/services/agent-run-contract.js`
