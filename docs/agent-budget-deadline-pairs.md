# Agent budget & deadline pairs (story 2.3 — consumed by V08)

How the two budget owners split one request's lifetime, which knobs carry
the numbers, and the timeout/deadline pair the V08 rollback rehearsal
(Epic 3, story 3.3) validates. Story 2.3 delivers the contract and the
counting surface; the BFF-side timeout configuration itself lands with the
agent-leg HTTP client (story 2.4) under the `AGENT_UPSTREAM_TIMEOUT_MS`
name specified here.

## Two-level budget ownership (AD-6)

One client request has exactly two budget owners:

| Owner | Owns | Communicated by |
|---|---|---|
| **The BFF** | the true END-TO-END request deadline — agent phase + translation + finalization. The only component alive for the whole lifecycle. | computes the agent-phase sub-budget and sends it with the request |
| **The agent orchestrator** | the AGENT-PHASE sub-budget: step cap, wall clock, token budget, model/tool call counts, evidence volume. | enforces it server-side, fail-closed |

The agent-phase wall clock is the deadline the request COMMUNICATES,
capped by the deployment's configured ceiling — never wider than
configured:

```
effective_wall_clock = min(AGENT_RUN_MAX_WALL_CLOCK_SECONDS, deadline_ms / 1000)
```

`deadline_ms` is a REMAINING duration in milliseconds (clock-skew-free —
no absolute timestamps cross the wire). It is required on every run
request; an absent or non-positive value is a `422`, never a default.

The BFF derives `deadline_ms` from its end-to-end deadline minus the
reserves translation and finalization will need — that derivation is what
the pair below formalizes.

## The knob table

All agent-side budget knobs are REQUIRED configuration, read fail-closed
at the run surface: a missing, empty or non-positive knob is answered
`503` naming every knob that failed — no run starts unbounded, and no
numeric default exists anywhere in the enforcement path.

### Agent-side (the run surface, `components/agent-service`)

| Knob | Meaning |
|---|---|
| `AGENT_RUN_MAX_STEPS` | loop iterations (one iteration = one model call plus its tool dispatches) |
| `AGENT_RUN_MAX_MODEL_CALLS` | model dispatches — the FLEET budget: loop calls and auxiliary calls (judge, classification, preparation translation) spend the same budget, aux tallied separately |
| `AGENT_RUN_MAX_TOOL_CALLS` | tool dispatches (bounded independently, so a tool-heavy step cannot hide behind the step cap) |
| `AGENT_RUN_MAX_TOTAL_TOKENS` | served token usage (prompt + completion as the endpoint reports; never a local estimate) |
| `AGENT_RUN_MAX_EVIDENCE_BYTES` | executed tool-result bytes (each result already truncated by `AGENT_TOOL_MAX_RESULT_BYTES`) |
| `AGENT_RUN_MAX_WALL_CLOCK_SECONDS` | the deployment ceiling on every run's wall clock (the `min()` above) |
| `AGENT_TOOL_TIMEOUT_MS` | per-tool-operation deadline (the port's `OperationBudget.timeout_ms`) |
| `AGENT_TOOL_MAX_RESULTS` | per-operation result count (the port's `OperationBudget.max_results`) |
| `AGENT_TOOL_MAX_RESULT_BYTES` | per-operation result size, truncate-and-flag (the port's `OperationBudget.max_result_bytes`) |
| `AGENT_RUN_SYSTEM_PROMPT` | optional two-tier prompt override; empty = the governed default |
| `AGENT_LANE_SLOTS`, `AGENT_LANE_LOCK_PATH` | the admission lane (already deployed; shared by every request mode) |

Everything counts on the enforcing side: retries, tool calls and
auxiliary model calls all claim the same monitor, and a refused dispatch
increments nothing. Enforcement is check-then-count: the NEXT dispatch is
refused at the boundary, the call itself rides `max_tokens` = the
remaining token allowance (omitted when the endpoint discards usage —
logged once, never guessed), and a run that hits a budget ends honestly
(`run_error` with `budget_exhausted`, no fabricated answer) with its
partial usage record intact.

### BFF-side (specified here for story 2.4)

| Knob (name reserved for 2.4) | Meaning |
|---|---|
| `AGENT_UPSTREAM_TIMEOUT_MS` | the BFF's upstream timeout on the agent leg. **Pair rule: `AGENT_UPSTREAM_TIMEOUT_MS >= deadline_ms + translation reserve + finalization reserve` (see the derivation).** |
| `AGENT_VERDICT_JUDGE_TIMEOUT_MS` (story 2.6) | the grounding judge's hard bound — the one finalize-time call that can extend the agent phase past its wall clock, by at most its own timeout |
| translation-leg allowances (names at 2.10) | `{ maxTokens, maxCalls }` the translation plans against after the run's usage record |

**Landed (story 2.4).** `AGENT_UPSTREAM_TIMEOUT_MS` ships with a `3600000`
default (1 h; the legacy chatqna stream timeout `CHATQNA_STREAM_TIMEOUT`
templates at `300000` — 5 min — the two are independent knobs), passed
through to the backend in `docker-compose.yaml` and documented in the `env`
template. The BFF derives the run's deadline as

```
deadline_ms = AGENT_UPSTREAM_TIMEOUT_MS − TRANSLATION_RESERVE_MS − FINALIZATION_MARGIN_MS   (floor 1000 ms)
```

with the reserves as named module constants beside the derivation in
`components/gov-chat-backend/services/agent-frame-writer.js`:
`TRANSLATION_RESERVE_MS = 30000` (the GPU translator's own hard timeout in
`gpu-translate-backend.js`) and `FINALIZATION_MARGIN_MS = 5000` (metadata
persistence, frame write, SSE teardown). The pair rule holds whenever the
timeout exceeds the reserves; a configured timeout at or below the reserves
plus the floor (≤ 36000 ms on the shipped numbers) cannot — the resolution
absorbs it (one warning names `AGENT_UPSTREAM_TIMEOUT_MS`, the 3600000
default applies to EVERY consumer of the pair: the deadline derivation, the
wire-level timeout of the leg, and the stream's wall-clock bound) instead of
shipping a deadline one thing paces against and another aborts ahead of —
the BFF-attributed abort. The judge-overrun ceiling
(`AGENT_VERDICT_JUDGE_TIMEOUT_MS`) is NOT part of the derivation yet: the
run surface bounds its own wall clock and answers honestly, so a long run
surfaces as the agent's own `budget_exhausted`/`run_error`, never as a BFF
timeout. Story 2.10 revisits the reserves when the translation-leg
allowances land.

## The timeout/deadline pair — the V08 derivation

```
BFF end-to-end budget = deadline_ms            (agent phase)
                      + translation reserve    (the residual the translator plans within)
                      + finalization margin    (metadata persistence, frame write, SSE teardown)
                      + judge overrun ceiling  (story 2.6: the grounding judge is wall-clock-checked
                                                BEFORE it starts, but the call itself is bounded by
                                                AGENT_VERDICT_JUDGE_TIMEOUT_MS — the agent phase can
                                                overrun deadline_ms by at most that timeout)

AGENT_UPSTREAM_TIMEOUT_MS >= deadline_ms + translation reserve + finalization margin
                              + AGENT_VERDICT_JUDGE_TIMEOUT_MS
```

Why the `>=` matters: the agent service enforces its own wall clock and
ends the run honestly when it trips, so a timeout that fires BEFORE the
agent-phase deadline turns a bounded run into a BFF-attributed abort —
the misattribution CM-3 forbids and V08 (Epic 3, story 3.3) validates.
The BFF computes `deadline_ms` as its end-to-end budget minus the two
reserves, so the pair holds by construction when the timeout is set from
the same numbers. A long agent run must surface as the agent's own honest
`budget_exhausted`/`run_error`, never as a BFF timeout.

## One replica, one pool, the 429

Iteration-1 deployment contract (compose `deploy.replicas` gated by
`AGENT_ENABLED`, 0 or 1): agent-service runs at EXACTLY ONE replica, so
the flock slot pool (`AGENT_LANE_SLOTS` slot files under
`AGENT_LANE_LOCK_PATH`) is the global admission bound. The pool is the
slot FILES — the run surface's lane and the no-agent pipeline's lane are
separate instances over the same files, one pool. Every request mode
passes through the same lane.

Saturation behavior: when every slot is held, `POST /v1/runs` answers
**`429`** (JSON `{"error": "admission_refused", ...}`, `Retry-After: 1`)
BEFORE any stream byte or stage runs. Refusal, never queueing — the
slots turn over with the runs they bound, and the honest signal is "busy
now". A caller retries on the `Retry-After` hint.

Scaling beyond one replica requires an explicitly shared coordination
mechanism with failure/lease semantics (deferred per AD-6) — a second
replica today would silently double the pool.

## The usage record — the shared counters

The run surface's terminal stream frame carries the run's shared
counters, the state translation budgets against:

```json
{
  "usage_record": {
    "run_id": "...", "outcome": "answered | error | budget_exhausted",
    "steps": 3, "model_calls": 3, "aux_model_calls": 0, "tool_calls": 2,
    "evidence_bytes": 1234, "prompt_tokens": 90, "completion_tokens": 30,
    "wall_clock_seconds": 4.2, "error": null
  }
}
```

`error` is null on a normally-terminated run and carries the truncated
failure message on an errored one (including `budget_exhausted`, where it
names the dimension that stopped the run).

A cancelled run emits NO terminal event and NO usage record — the partial
counts ride the service's evidence log line instead (cancellation is the
loop's existing contract). The BFF's residual contract
(`components/gov-chat-backend/services/agent-residual-budget.js`) plans
`translate` within the remaining token/call allowance when the record is
available, and `skip` with the recorded status when it is not — the
English answer stays, the allowance is never exceeded. Story 2.10 wires
the consumption; story 2.4 the stream.
