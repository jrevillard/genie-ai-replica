# ADR agentic-004: The runtime port — governance travels in the given objects

- **Status**: Proposed
- **Date**: 2026-11-25
- **Decision owners**: GENIE.AI engineering (operator accepts at merge)
- **Binds**: spine AD-5 (runtime seam), AD-6 (two-level budget ownership), AD-7 (judged
  grounding), NFR-7 (no adoption for flexibility's sake), ADR agentic-002 (D03, unchanged)
- **Stories**: none yet — iteration 2 is not broken down; this record is an input of that breakdown
- **Design**: `docs/superpowers/specs/2026-11-25-agentic-iteration-2-architecture-design.md`, §3

## FR-29 traceability

```
use case (iteration 2 adds pipelines, external tools and a human pause on top of the agent,
  and a second runtime must be pluggable without re-architecting — while the registry stays
  the authorization surface and the budgets bound everything)
  -> requirement (operator constraint: design the seams for a second runtime, ship none)
    -> decision (this record: a runtime implements RuntimeDriver over RunInputs; governance
       travels in the dispatcher, the monitor and the token; the orchestrator owns the
       lifecycle, the delivered text and the verdict; control signals travel through the token)
      -> investigation (the runtime contract suite and its violators; the byte-identical
         stream gate; the out-of-tree pydantic-ai spike)
        -> merge request (the iteration-2 architecture MR, stacked on the PRD branch)
          -> validation evidence (the contract suite green on the custom loop and red on each
             violator; recorded streams identical before and after each migration step)
            -> released version (the merge into feat/agentic-foundations/prd)
```

## Context

`AgentLoop` (`components/agent-service/agent/loop.py`) does three jobs today: the loop
itself (model call, registry dispatch), governance (budget and token checks before each
call, the evidence-ledger feed, the injection scan) and product rules (the mechanical
insufficiency decision, the citation verdict, the lifecycle events `run_started`,
`run_finished`, `run_error`). The request orchestrator constructs the concrete class.

ADR agentic-002 already scopes a runtime swap as « Replace `AgentLoop` + `LoopModelClient`
[…] adapt its native events to the seam envelope and kind vocabulary ». With governance
and product rules inside the loop, a second runtime would re-implement them, and the
contract suite would have to verify behavior that should hold by construction.

### Constraints

- AD-4: the server-side tool registry is the authorization surface; enforcement lives in
  the port's executor with per-request identity.
- AD-5: the internal envelope is `{run_id, call_id, seq, kind, payload}`; runtimes never
  emit BFF frame names.
- AD-6: everything counts; the cancellation chain is BFF → agent-service → in-flight
  model call.
- The BFF parses the seam stream and pins the event order: `run_started`, tool events,
  text events, `verdict`, `run_finished`.
- NFR-7 and ADR agentic-002: D03 is not reopened by this record.

## Decision

**A runtime drives one run. It owns neither governance nor product rules: those travel in
the objects it is given.**

1. **The port.** A runtime implements `RuntimeDriver`: `runtime_id` and one method,
   `run(inputs) -> RunResult`. `RunInputs` carries the question, the instruction (the system
   prompt of the run), the definitions of the registered tools, the model client, the tool
   dispatcher, the budget monitor, the cancellation token and the event emitter. The
   orchestrator builds the model client per request, bounds it and hands it over; the
   verification judge and the record's model axis use that same client.
2. **What a runtime does and never does.** It calls the model through the client it is
   given, bounded by the monitor through a core-owned decorator around that client; it
   dispatches tools only through the dispatcher; it returns the drafted text and its
   `RunResult`; it lets `CancelledError` propagate. It never emits a lifecycle or verdict
   event, never decides the delivered
   text, never verifies, scans or keeps anything between two runs, and never knows a BFF
   frame name.
3. **`ToolDispatcher`** is the body of the current `_dispatch_tool`, moved, not rewritten:
   budget and token checks, `tool_call_started`, execution through the registry, declared
   errors mapped to data, evidence-ledger feed, injection scan, `tool_call_finished`.
4. **Control signals travel through the token.** The dispatcher never steers a run by
   raising. It returns a structured result, or it records the reason on the core's state
   and cancels the run through the token; the orchestrator reads the reason and emits the
   honest terminal. Reason: frameworks convert a tool's exception into data for the model —
   LangChain's default is « Convert tool exceptions into ToolMessages the model can
   handle. » — so an exception would not stop every runtime.
5. **The orchestrator owns the lifecycle and the product rules.** It emits `run_started`,
   calls the runtime, applies the mechanical insufficiency decision to the drafted text,
   emits the text events, runs the verification pipeline, emits `verdict` and the terminal.
   The order on the wire is unchanged. The execution-version record gains a `runtime`
   axis, `{"id": runtime_id}`: today's record carries implementation, model, prompt and
   configuration, and no runtime.
6. **Migration, two steps, each gated on a byte-identical event stream** recorded from the
   current orchestrator tests: a pure extraction (the orchestrator receives a runtime
   factory), then the move of governance into the core.
7. **The contract suite** is parametrized over every implementation and states five rules:
   an unregistered tool is invisible and refused; each budget dimension bounds the run and
   auxiliary calls count; `cancel()` stops the run with no terminal event; only tool event
   kinds leave the runtime and each `started` has its `finished`; nothing leaks between two
   runs of one runtime instance. One violator per rule must turn its test red.
8. **Replaceability is proven, not shipped.** Done when the suite is green on the custom
   loop and red on each violator, and an out-of-tree spike makes a pydantic-ai driver pass
   the same suite with its swap cost reported in hours and the tool-calling matrix measured
   on the venue's vLLM. No second runtime ships.

## Alternatives considered

| Alternative | Status | Reason |
|---|---|---|
| A thin extraction only: the runtime keeps the lifecycle and the verdict | Rejected | a second runtime re-implements the product rules |
| The harness as the provider of execution, with its native subagents, workflows and sessions (Deep Agents, DeepSeek Harness) | Rejected for iteration 2 | workflows bound to one harness; identity, budgets and cancellation outside the governed run; ADR agentic-002's triggers are unmet |
| DeepSeek Harness on a second, out-of-process port | Not now | « Registration is a trusted same-process contract »; no hook before a model call; « The wire has no per-session close or prompt-cancel method ». ADR agentic-002 prices it « Multi-day to weeks » |
| A new agent loop | Rejected | non-goal of iteration 1 and of this record |

What maps onto the port, read from the frameworks' documentation on 2026-11-25:

| Runtime | Maps | Friction |
|---|---|---|
| Custom loop | yes | first implementation |
| pydantic-ai | expected; to be measured by the spike | in-process: tools are callables, the model is an object to wrap, the result is an object, cancellation is asyncio |
| Deep Agents | yes | `create_deep_agent` brings filesystem, shell, subagent and todo tools (« To compose a fully custom harness from scratch, see Configure the harness »); hard dependencies on `langchain-anthropic`, `langchain-google-genai`, `langsmith`; Beta classifier |
| DeepSeek Harness | no | out of process; the dispatcher cannot be injected, and over MCP the caller is the runtime process, not the user |

## Consequences

- Positive: one runtime contract; governance and product rules written once; the swap
  scope of ADR agentic-002 becomes a measured number instead of an estimate.
- Negative: two refactors of the custom loop; tests that pin the loop's own emissions move
  to the orchestrator level, where the wire contract lives.
- Neutral: D03 and its freshness gate are unchanged. The spike's result either confirms
  the fallback or is reported as a negative result.

## References

- Design: `docs/superpowers/specs/2026-11-25-agentic-iteration-2-architecture-design.md` (§2, §3)
- `docs/adr/agentic-002-first-agent-runtime-d03.md`
- Architecture spine: `_bmad-output/planning-artifacts/architecture/architecture-genie-ai-2026-11-16/ARCHITECTURE-SPINE.md` (AD-4, AD-5, AD-6, AD-7)
- `components/agent-service/agent/loop.py`, `components/agent-service/agent/orchestrator.py`
- LangChain tools documentation, `handle_tool_errors`; Deep Agents customization documentation (commit `2b76e167`); DeepSeek Harness `packages/sdk/server/README.md` (commit `4b399c39`)
