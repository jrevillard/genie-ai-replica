# Agentic iteration 2 — architecture design

- **Status:** Proposed — awaiting operator review
- **Date:** 2026-11-25
- **Scope:** the `agent-service` of the agentic path and its contract with the BFF (`gov-chat-backend`)
- **Basis, read at `6dc1d2cf6` on `feat/agentic-foundations/prd` (MR !938):** the PRD and its architecture spine, ADR-002 (`docs/adr/agentic-002-first-agent-runtime-d03.md`), the `agent-service` and BFF code
- **Other inputs:** the platform architecture proposal v1.0, the Server-Side Tools record (MR !279, closed unmerged), issue #603 (deferred)

External facts were checked on 2026-11-25 against primary sources (PyPI JSON, vendor documentation, repository files at pinned commits). A fact that was not checked from a primary source is marked **unverified**.

---

## 1. Purpose and constraints

Iteration 1 delivers one governed run over two document tools. Iteration 2 generalizes it into a hexagonal service that can consume external tools through MCP, run fixed multi-step pipelines with a human pause, and admit a second runtime without re-architecting, while keeping the current RAG tooling available unchanged.

### 1.1 Functional constraints

| # | Constraint | Source of the constraint |
|---|---|---|
| F1 | Connect external tools through MCP: GovStack building-block APIs as standalone MCP servers (Auth, Payments, Scheduler, Registration), mock first, inside the sovereign deployment; plus web search (SearXNG) from the Server-Side Tools record | issue #603, MR !279 record |
| F2 | Workflows and specialist agents: code-fixed pipelines first, model-decided delegation later | operator decision |
| F3 | Design the seams that let a second runtime be plugged in; do not ship one now | operator decision, NFR-7 |
| F4 | Human approval and resumption for actions in the user's name | operator decision |
| F5 | The current RAG tooling is carried over and stays available | operator decision |
| F6 | First pipeline: extended research (read-only). Second: an errand such as an appointment, with user confirmation (write) | operator decision |

### 1.2 Architectural constraints

| # | Constraint | Source |
|---|---|---|
| A1 | Hexagonal, flexible, clean; implements the current state of the art for agent state | operator decision |
| A2 | Dependency rules enforced by architecture tests written with `pytestarch` | operator decision |
| A3 | The application owns the state; the runtime holds no store | spine AD-12, operator validation |
| A4 | The tool registry is the authorization surface; budgets bound everything; the BFF owns the client SSE contract; runs are versioned | spine AD-4, AD-6, AD-8, AD-11 |
| A5 | Sovereignty: every adopted dependency is audited for its defaults; no adoption for flexibility's sake | NFR-2, NFR-7 |
| A6 | Smallest change that satisfies the constraint; no new machinery without a requirement | project rule (KISS/LEAN) |

### 1.3 Traceability

| Constraint | Where it is satisfied | What proves it |
|---|---|---|
| F1 | §4.3–§4.9 | tool-source contract suite (§10.3), end-to-end run |
| F2 | §5.2, §5.6, §5.7 | pipeline tests (§10.4) |
| F3 | §3 | runtime contract suite and violators (§3.5), spike report (§3.8) |
| F4 | §5.4, §5.5, §6.3, §6.4, §7.2 | pause round-trip tests, BFF contract tests (§10.5), end-to-end |
| F5 | §4.2 | existing capability suites stay green; byte-identical stream gate (§10.2) |
| F6 | §5.6 | slice gates (§11) |
| A1 | §2, §7.6 | §2.5 tests, §7.2 table |
| A2 | §2.5 | architecture tests plus the planted-violation probe |
| A3 | §7 | §7.2, §7.5, rule R1 extended to storage clients |
| A4 | §3.2, §4.5, §6, §8 | existing suites, §3.5, §8 |
| A5 | §9.2, §13.1 | dependency table |
| A6 | §11, §13.1 | slices ordered smallest first; explicit non-goals |

---

## 2. The hexagonal map

### 2.1 Principle

The core knows no HTTP, no MCP, no database driver and no agent framework. It speaks only of runs, registered tools, budgets and events. Governance travels in the objects handed to a runtime, never in the runtime's code.

### 2.2 What exists and is kept

- **Core:** `capabilities/contract.py` (models, `OperationSpec`, `DocumentCapabilityPort`); `agent/` (event envelope and kinds, registry, budget, cancellation, loop, verification, toolset); `noagent/` (configuration B, the fixed single-pass pipeline used by the evaluation); `preparation/`.
- **Adapters:** `capabilities/adapters/` (Arango retrieval, document repository, OKF, TEI embedding and reranking).
- **Host:** `app.py`, the composition root, and `tracing.py`, the telemetry facade.

Apart from the leaks in §2.3, the core imports three things from outside itself: `pydantic` (the models), `langdetect` (language detection, which performs no I/O) and the telemetry facade `tracing` — the root module where the OpenTelemetry SDK and its exporters are wired. Four core modules import it (`agent/loop.py`, `agent/verification.py`, `noagent/pipeline.py`, `preparation/prepare.py`). That last dependency is bounded by a rule: only `tracing` imports the SDK (rule T, §2.5).

### 2.3 Six leaks to close

| Leak | Why it is a leak | Fix |
|---|---|---|
| `agent/probe.py` hosts the production model client and `build_stateless_adapters`, which imports four adapters, the search capability and, inside a function, `arango` | an adapter and composition code inside the runtime-seam package | move both to adapters; `app.py` composes |
| `agent/v06_harness.py` imports `httpx` | a measurement harness inside the seam | declare it a measurement surface, then move it to a measurement package outside `agent/` |
| `preparation/translation.py` defines `HttpxTransport`, the HTTP client that six construction sites default to (`preparation/translation.py`, `noagent/pipeline.py`, `noagent/generation.py`, `agent/probe.py`, `agent/orchestrator.py`, `agent/v06_harness.py`) | a core module that performs I/O, and a concrete transport chosen inside the core | the transport moves to the adapters; the constructors stop defaulting to it — the composition root supplies it |
| `capabilities/executor.py` imports three adapter classes (`LegacyChunkAdapter`, `DocRepoAdapter`, `OkfAdapter`) for type annotations | an enforcing implementation of the port that names concrete adapters | depend on Protocols declared next to the port |
| `capabilities/search_knowledge.py` builds its own adapters in `create()` and imports the retrieval, embedding and reranking adapters; `noagent/prompt.py` imports one constant from it | composition inside a core module, and a core module importing that module | `create()` moves to the composition root; the shared constant moves to the contract |
| `noagent/lane.py` takes file locks (`fcntl`, inside a function) and runs the slot scan off the event loop with `anyio` | the admission lane is host infrastructure inside a core package: it does I/O | move the lane to the host, next to `app.py`, its only production importer |

### 2.4 Layers, ports, adapters

```
BFF ── owns the state, the SSE contract and the existing shapes (AD-8, AD-12)
 │  POST /v1/runs : question, turns | resume, plan, context, token
 ▼
┌ agent-service ───────────────────────────────────────────────┐
│ HOST         app.py — composition root                        │
│ MEASUREMENT  the v06 harness — assembles its own runtime        │
│ CORE         orchestrator → pipeline → runtime port           │
│  (no I/O)    registry · dispatcher · budget · cancellation    │
│              events {run_id, call_id, seq, kind, payload}     │
│ PORTS        RuntimeDriver · ToolSource · UserCredentials      │
│              ModelClient · EventSink · DocumentCapabilityPort │
│ ADAPTERS     custom loop · MCP · SearXNG · Keycloak            │
│              Arango · document repository · OKF · TEI · vLLM   │
└──────────────────────────────────────────────────────────────┘
```

The map deliberately contains **no storage port**. The application that owns the state is the BFF and its existing collections (§7).

### 2.5 Dependency rules and their tests

| # | Rule | `pytestarch` form |
|---|---|---|
| C | Every module of the service belongs to one layer: host, core, leaf adapters, capability, measurement | the module list of the graph, each name passed through one classification function; the modules left over are asserted to be none |
| R1 | A core module imports no I/O library | `Rule().modules_that().are_named(<core module>).should_not().import_modules_that().are_named([<library>])`, on a graph built with `exclude_external_libraries=False`. The library is named by its PACKAGE, because `pytestarch` names an import after the package it comes from: `from urllib import request` is the import of `urllib` |
| R2 | A core module imports nothing of another layer, the telemetry facade excepted | the same form, with the roots of the other layers in place of the library: the host modules, `capabilities.adapters`, `capabilities.search_knowledge` |
| T | The telemetry SDK is imported by `tracing` and by nothing else | R1's form for `opentelemetry`, over every module of the tree except the facade — the host included |
| L1 | A leaf adapter accesses only the ports it implements | `LayeredArchitecture` plus `LayerRule().layers_that().are_named("leaf adapters").should_only().access_layers_that().are_named(["ports"])` |
| L2 | The search capability accesses only the ports and the leaf adapters | the same layer rule for the `capability` layer, allowed `["ports", "leaf adapters"]` |
| R3 | The modules that import the leaf adapters are a listed set | R1's form over every module that is not itself an adapter, the importers asserted equal to a listed set — the direct form, not the transitive one, which reports the whole import chain. The set is emptied by plan 2 (§2.3) |
| R4 | The event vocabulary never carries a BFF frame name | already enforced at import (`agent/events.py`) |

Properties of `pytestarch` 5.1.1 that the rules rely on. All but the last were checked against the service or on a synthetic package; the last is read from its documentation:

- A node is named after the root folder: `agent-service.agent`, not `agent`.
- External libraries are excluded by default; R1 needs `exclude_external_libraries=False`.
- A rule that names a module absent from the graph raises `ModuleUnknown`: a typo fails the test. A library that no module imports is absent too, so the I/O list declares the libraries the service does not import yet, and a rule checks that the declaration and the tree agree — a name that is neither imported nor declared fails the test.
- An import is named after the PACKAGE it comes from: `from urllib import request` is the import of `urllib`. The rules name packages, or they miss that spelling.
- A module outside every layer still counts: a layer rule raises `AssertionError` when a listed layer accesses it.
- A cache or environment directory (`__pycache__`, `.venv`, `.ruff_cache`) leaves a node in the graph even when its files are excluded; the module list drops those nodes.
- `import_modules_that` and `should_not().be_imported_by_modules_that()` look at direct imports; the `…except…` and `should_only().be_imported_by…()` forms evaluate the transitive importers, and the latter also requires that the named module imports the subject.
- Regex negations are not supported: modules are named explicitly.

R1 and R2 look at direct imports. That is enough only because of C: every module is classified, so a path from the core to an I/O library or to an adapter has a first edge a rule sees — unless it goes through `tracing`, which rule T bounds.

**R1 and R2 are ratchets.** The violations found on the tree are asserted equal to a listed set (`KNOWN_IO_VIOLATIONS`, `KNOWN_INTERNAL_VIOLATIONS` in `tests/test_architecture.py`). A violation is a (module, import) pair, named by the file that causes it: a new leak in a file that already has one is a new pair. Closing a leak removes its pair from the tree, and the test goes red until the list shrinks with it; a new leak adds a pair and the test goes red. The lists change only through a visible edit of the test file.

The rules are pytest tests in the existing pytest job: two session-scoped graphs (with and without external libraries), one test per rule, and one test that plants each violation on a synthetic package and checks that the same helpers report it. `pytestarch` is a test-only dependency (`pytestarch==5.1.1`; its one requirement, `networkx`, is pinned to `3.6.1`, the last line that accepts Python 3.11).

**Planted-violation probe.** One temporary illegal import at module level and one inside a function must each turn the suite red. `pytestarch` extracts imports from an AST, so a dynamic `importlib` call is invisible to it: that blind spot is recorded, and R1 is backed by a code-review item for `importlib` in the core.

---

## 3. Runtime port and contract suite

### 3.1 Why

Today `AgentLoop` does three jobs: the loop itself, governance (budget checks, evidence-ledger feed, injection scan) and product rules (insufficiency decision, verdict, lifecycle events `run_started`, `run_finished`, `run_error`). A second runtime would have to re-implement the last two. The port moves them out of the runtime.

### 3.2 The port

```python
@dataclass(frozen=True)
class RunInputs:
    question: str
    instruction: str                  # the system prompt of this run or step
    tools: tuple[dict, ...]           # the model-facing definitions: registry.definitions()
    model: BoundedModelClient         # the client the core built, its output bound already capped
    dispatcher: ToolDispatcher
    monitor: RunBudgetMonitor
    token: CancellationToken
    emitter: EventEmitter

class RuntimeDriver(Protocol):
    runtime_id: str
    async def run(self, inputs: RunInputs) -> RunResult: ...
```

| A runtime… | A runtime never… |
|---|---|
| calls the model, bounded by the monitor through a core-owned decorator around its model client | emits `run_started`, `run_finished`, `run_paused`, `run_error` or `verdict` |
| dispatches tools only through `dispatcher` | decides the delivered text (the insufficiency rule is a product rule) |
| returns the drafted text and its `RunResult` | verifies, scans, or keeps anything between two runs |
| lets `CancelledError` propagate | knows a BFF frame name |

The inputs are what the current loop takes per run: the question, the system prompt (`instruction`), the definitions of the registered tools (`tools`) and the model client.

Two of them are shaped by the code as it stands, and the port says so. `tools` is `registry.definitions()` — the OpenAI function-tool shape (`tuple[dict, ...]`), which is what the model clients speak; the port does not invent a second shape. `model` is a client whose output bound is ALREADY capped: today the cap rides as an optional `max_output_tokens` argument that each call site passes by hand (`agent/loop.py`, `agent/verification.py`), and a runtime that forgets it runs unbounded. The core therefore wraps the client once — `BoundedModelClient`, capping the argument itself — and hands the wrapper to the runtime. That is where the bound becomes structural rather than a convention every call site must honour.

The client itself is process-wide: `app.py` builds the orchestrator once (`_RUNTIME`) and the model client with it, because the client is stateless and expensive. The per-request object is the authorization executor. The port carries the shared client; the record's model axis (`model_identity()`) and the verification judge read it from there.

`ToolDispatcher` is the body of the current `_dispatch_tool` in `agent/loop.py`, moved: budget and token checks, `tool_call_started`, execution through the registry, declared errors mapped to data, evidence-ledger feed, injection scan, `tool_call_finished`.

### 3.3 Control signals travel through the token

LangChain, the base of Deep Agents, converts a tool's exception into a message for the model by default. An exception raised in the dispatcher would therefore not stop every runtime. Rule: **the dispatcher never steers a run by raising.** It returns a structured result, or it records the reason on the core's state and cancels the run through the token. The orchestrator reads the reason and emits the honest terminal. This is the only stop channel every runtime must honor (contract rule C3).

### 3.4 Orchestrator sequence

The order on the wire is unchanged: `run_started` → tool events → `text_message_started`, `text_message_content`, `text_message_finished` → `verdict` → `run_finished`.

1. Mint `run_id`; build monitor, token, emitter and the execution-version record. The record gains a `runtime` axis, `{"id": runtime_id}`, beside implementation, model, prompt and configuration: today's record (`build_execution_version_record` in `agent/version_record.py`) carries no runtime id. The BFF stores the record as one object, so nothing changes on its side; the test that pins the record's keys does.
2. Emit `run_started`.
3. Call the runtime.
4. On a drafted answer: apply the mechanical insufficiency decision, emit the text events with the delivered text, run the verification pipeline, emit `verdict`, emit `run_finished`.
5. On a stop reason: emit `run_error`, or `run_paused` for a pause (§5.4).
6. Return the usage record built from the monitor.

### 3.5 Contract suite

Parametrized over every `RuntimeDriver` implementation:

| # | Rule |
|---|---|
| C1 | An unregistered tool is invisible to the model and refused at dispatch |
| C2 | Each budget dimension bounds the run; auxiliary calls count |
| C3 | `cancel()` stops the run, with no terminal event and readable counters |
| C4 | Only tool event kinds leave the runtime; each `started` has its `finished` with the same `call_id` |
| C5 | One runtime instance over two runs: nothing of the first leaks into the second |

Under test: the custom loop, a scripted runtime, and **one violator per rule**, which must turn its test red.

### 3.6 Migration path

Two steps, each green before the next:

1. **Pure extraction.** The orchestrator receives a runtime factory. No behavior change.
2. **Governance into the core.** `ToolDispatcher` extracted; lifecycle, text delivery and verdict moved to the orchestrator.

Each step is gated on a byte-identical event stream, recorded from the current orchestrator tests before the change and compared after.

### 3.7 What maps onto the port

| Runtime | Maps? | Reason |
|---|---|---|
| Custom loop | yes | first implementation |
| pydantic-ai | expected, to be measured | in-process library: tools are callables, the model is an object to wrap, the result is an object, cancellation is asyncio |
| Deep Agents | yes, with friction | in-process: one LangChain tool per registered tool calling the dispatcher; the chat model wrapped. Friction: `create_deep_agent` brings filesystem, shell, subagent and todo tools, and « To compose a fully custom harness from scratch, see Configure the harness »; hard dependencies on `langchain-anthropic`, `langchain-google-genai`, `langsmith`; Beta classifier |
| DeepSeek Harness | **no** | out of process: « Registration is a trusted same-process contract » (the dispatcher cannot be injected; over MCP the caller is the runtime process, not the user); no hook before a model call (no per-call budget); « The wire has no per-session close or prompt-cancel method » (cancellation is a process kill) |

The in-process shape is the common one (pydantic-ai and OpenAI Agents SDK share it). DeepSeek Harness would need a second, weaker port for out-of-process runtimes. ADR-002 already prices that path at « Multi-day to weeks »; this design does not reopen D03.

### 3.8 Done when

- The contract suite is green on the custom loop and red on each violator.
- An out-of-tree spike makes a pydantic-ai driver pass the same suite and reports the swap cost in hours, plus the tool-calling matrix result on the venue's vLLM. This is the exit test ADR-002 already names.
- No second runtime ships.

---

## 4. Tools

### 4.1 Principle

A tool becomes callable through one door only: `ToolRegistry.register`. Whether it is native, MCP or web search changes neither authorization, nor budget, nor audit (AD-4).

### 4.2 Document tool source: the RAG tooling, unchanged

`search_knowledge` and `read_source` move into `DocumentToolSource` as they are. The capability and its adapters are untouched. Coverage, read from the branch:

- dense cosine and BM25 (ArangoSearch view), weighted reciprocal-rank fusion, truncation, `file_id` enrichment, identity join;
- label filtering before the limit, and the defense-in-depth post-filter;
- one pass per authorized graph, one reranking stage over the union;
- the model-specific query-instruction prefix;
- TEI reranking with the five selection strategies, score calibration and one behavior per failure mode;
- OKF concept reads through the okf-server route, with the caller's scopes;
- preparation: language detection, query translation, bounds;
- the `source_documents` projection, same envelope as today for the frontend.

Behavior stays frozen on the recorded contract (`docs/baselines/v02-opea-query-path-contract.md`). The tools are available to every run and every pipeline step. Configuration B (`noagent/`) stays for the evaluation.

### 4.3 The port

```python
class ToolSource(Protocol):
    def tools(self, context: CallerContext, bearer: str | None) -> Sequence[tuple[ToolDefinition, ToolExecutor]]: ...
```

The run's registry is the concatenation of the sources declared at deployment, built per request as today, so each executor captures that request's identity.

| Source | Role |
|---|---|
| `DocumentToolSource` | the two document tools |
| `McpToolSource` | the MCP servers of the catalog |
| `WebSearchToolSource` | SearXNG |

### 4.4 Catalog

A static deployment file. One entry per tool: exposed `name`, `source`, `server`, `tool`, `allow`, `risk` (`read` or `write`), `requires_approval`, `egress` (`internal` or `open_web`), required `scopes`, and a budget (`timeout_ms`, `max_results`, `max_result_bytes`), the same fields as `OperationBudget`.

- A tool absent from the catalog is neither listed to the model nor dispatchable.
- A duplicate exposed name is a startup error.
- MCP tools are discovered at startup and filtered by the catalog. A catalogued tool the server does not serve is a startup warning and an absent tool.

### 4.5 Call path

In `ToolDispatcher`, identical for every source:

1. The model sees only the tools registered for this request.
2. Budget and token checks; `tool_call_started`; execution bounded by the operation budget; a structured result. An upstream error becomes an error envelope, never an exception.
3. Evidence ledger and injection scan; `tool_call_finished`.

### 4.6 MCP source

- Transport: Streamable HTTP for the cluster's servers. The Python SDK documents « use stdio or streamable HTTP directly ». `stdio` is not used for separate processes.
- `mcpo` is not used (merged decision: « mcpo is not used — the MCP SDK client replaces it »).
- Client: the official Python SDK, `mcp` 2.3.0 (MIT), which speaks protocol revision 2026-07-28.
- Mapping: the tool's `input_schema` becomes the `ToolDefinition` parameters; `session.call_tool` executes; `is_error` and transport failures map onto the contract's outcome codes.
- MCP server-side tool instructions are never added to the system prompt: retrieved text is data.

### 4.7 Web search and outbound PII

A tool with `egress: open_web` passes its query through the existing `pii-service` before it leaves, and the call fails closed if redaction fails. This is the Server-Side Tools rule. It does not apply to building-block tools, whose arguments legitimately carry the user's own data.

Two consequences for deployment: `pii-service` is currently parked behind the `okf` profile in the compose file and must run when web search is enabled; web results are a new citation variant (`source: 'web'`), which the citation components on web and mobile must render.

### 4.8 Identity and visibility

- **Port `UserCredentials`.** For a write tool, the adapter obtains a token bound to the target server. Two implementations: none for the mock servers; standard token exchange for real building blocks. Keycloak's current guide describes standard token exchange V2 as « fully supported… enabled by default », with an `audience` parameter. **Unverified on the project's Keycloak 26.8.2**: confirm there (probe P4). The principle is the one the executor already applies: « the caller's bearer (forwarded only to the services that validate their own callers) ».
- **Visibility per user.** `CallerContext` gains `scopes`, assembled by the BFF from the access token. A tool whose required scopes are not all present is not registered for that request.

### 4.9 Write tools

- `requires_approval` triggers the pause of §5.4. The resumed run executes the approved call through the same dispatcher; there is no direct path.
- Every write call carries an idempotency key riding the MCP request `_meta`; honoring it is part of the mock servers' contract. The key is derived from the TURN and the call, not from the run: `run_id` is a fresh uuid per run (`agent/orchestrator.py`), so a key built on it changes when the user retries the turn, and the retry would land the write twice (§8.4).
- A refused call is not executed; the model is told as data; the pipeline continues or ends honestly.

### 4.10 Out of scope

Dynamic fleet management, MCP Resources and Prompts, the Tasks extension, a second MCP transport.

---

## 5. Pipelines and pause

### 5.1 Principle

A pipeline is core code above the runtime port: ordered, typed steps that pass serializable state. A pause is a run outcome, not state hidden in a runtime.

### 5.2 Steps

| Kind | What it is |
|---|---|
| Agent step | one run on the runtime port, with its instruction and its tool subset |
| Direct step | code without a model (formatting, a fixed tool call), as `noagent/` already does |
| Fan-out step | N parallel runs under one share of budget |
| Pause step | declared by the pipeline: ends the segment with a pause of kind `input` (§5.4) |

A step is `required` or `optional`. On failure a required step ends the run with `run_error`; an optional step is skipped and recorded. No silent fallback.

### 5.3 Where pipelines live

A `pipelines/` package in the core: the step and pipeline types, the runner, one module per pipeline. The orchestrator selects by `plan`; an unknown plan ends with `run_error`.

### 5.4 Pause

```
BFF                                     agent-service
 │ run(plan=errand)                      │ 1. find      (agent step, read tools)
 │◄─ step_started / step_finished ───────│
 │◄─ pause_requested ────────────────────│    pending calls, options, continuation
 │◄─ run_paused ─────────────────────────│
 │ stores the pause on the turn          │
 │ … the user decides …                  │
 │ run(plan=errand, resume)              │ 2. execute   (dispatcher, idempotency key)
 │◄─ tool_call_started / tool_call_finished │
 │◄─ run_finished ───────────────────────│ 3. confirm
```

- Two triggers create a pause. **Approval:** the dispatcher intercepts a write call that requires approval; the pending call is the model's, with its arguments as written. **Input:** a pause step the pipeline declares; the pipeline records the pending call itself — the tool, an argument template with one slot, and the options for that slot — then cancels the run through the token, as the dispatcher does.
- `pause_requested` carries a `pause_id`, a `kind` (`approval` or `input`), the pending calls (tool, argument summary, risk), optional `options`, and the continuation.
- `run_paused` is the terminal event of a paused segment. `run_finished` keeps its meaning: an answer was delivered.
- The resume request carries the continuation and one decision per call: `approve` for an approval, the chosen option for an input.
- On resume, an approved call runs with the model's arguments. For an input, the decision must name one of the options: the pending call's arguments are built from that option, and a value outside the options is refused with an error — it never reaches the tool.

### 5.5 Continuation

- A model of the core, serialized, opaque to the BFF: pipeline id and version, step index, pending calls, the step outputs needed to finish, bounded by the evidence budget.
- Bound to the user and to the originating run; refused on mismatch.
- Lifetime: a deployment knob; proposed default 24 hours.
- Single use, guaranteed by the BFF through the turn's state.

### 5.6 The two pipelines

**Extended research**

| Step | Kind | Tools | Policy |
|---|---|---|---|
| `plan_queries` | agent | none | optional |
| `search` | fan-out, one run per query | `web_search`, `search_knowledge` | optional per branch |
| `synthesize` | agent | none | required |
| verify | existing verification pipeline | — | required |

It is delivered in two increments: first `web_search` as a tool of the simple run (no pipeline code), then the pipeline above.

**Errand: appointment**

| Step | Kind | Tools | Policy |
|---|---|---|---|
| `find` | agent | `scheduler.list_slots` (read), `search_knowledge` | required |
| pause | pause step | `scheduler.book`, its slot filled from the chosen option | — |
| `execute` | resume step | the pending `scheduler.book` — the call the pause recorded | required |
| `confirm` | direct, then agent | `scheduler.get_appointment` (read) | required |

`confirm` reads after writing: if the write's outcome is unknown (§8.4), the read settles it.

The write happens exactly once. The pause step records the pending call and the arguments it will be given; the `execute` step of the resumed segment IS that call — it dispatches the recorded pending call through the dispatcher, with the slot filled from the chosen option. There is no second write, and no write outside the dispatcher: the `execute` step is a resume step, not a code path that calls the tool by itself.

### 5.7 Delegation, later

Nothing to build. A fan-out is already "child runs under a share of budget". Delegation is a tool whose executor starts a child run.

### 5.8 Out of scope

Declarative workflows (YAML to graph), a visual designer, durable execution, specialist agents chosen by the model.

---

## 6. Wire contract

### 6.1 Run request

`RunRequestBody` keeps `extra="forbid"` and gains three optional fields:

| Field | Content |
|---|---|
| `turns` | prior turns of the conversation (§7.3) |
| `plan` | pipeline id; absent means a simple run, today's behavior |
| `resume` | `{continuation, decisions[]}` |

`context` gains `scopes`.

### 6.2 Seam events

The vocabulary stays closed and seam-owned (AD-5). Additions: `step_started`, `step_finished`, `pause_requested`, `run_paused`. None is a BFF frame name.

### 6.3 Client frames

Additive and versioned (AD-8): the five client event types are preserved verbatim.

- `agent_activity` gains an optional `step` field.
- A new frame, `agent_pause`, carries the pause for display: `pause_id`, `kind`, items (tool, human-readable label, argument summary, risk), options. No raw argument that could hold a secret.
- The non-streaming JSON entry answers with `paused: true` and the same pause summary instead of an answer.
- The BFF contract test pins the seam-kind set: the frame writer ignores a kind it does not know, at debug level (`agent-frame-writer.js`), so a BFF older than the agent service would drop `run_paused` and finalize the turn as an answer. The seam vocabulary is additive by design — the forward compatibility is real — and the pair is deployed together. The test that says so is the BFF's.

Frame and endpoint names are proposals; the BFF contract test fixes them.

### 6.4 Decision endpoint

One BFF endpoint receives the decision for a pause. It is keyed by the turn, not by the conversation: the pause lives on the per-turn `queries` record (§7.2), and a turn joins a conversation only when the user saves it. Proposed shape: `POST /api/chat/queries/:queryId/agent-pause/:pauseId/decision`, where `queryId` is the key the `queries` record is stored under. The BFF checks ownership (`queries.userId`), single use and lifetime, records the decision on the turn, and starts the resume run like a normal turn.

### 6.5 Clients

Web and mobile consume the same BFF API, so both render the pause and collect the decision.

---

## 7. State and persistence

### 7.1 AD-12, re-declared for iteration 2

AD-12 is scoped « iteration 1 is read-only » and prevents two things: « a session/audit store that breaks rollback continuity or adds an migration burden ». Iteration 2 keeps its rule and extends it with one sentence: *the agentic path writes only through the existing shapes; the per-turn `queries` record gains an additive `agent` block that the legacy path never reads.*

### 7.2 Where each piece of state lives

| State | Owner | Where |
|---|---|---|
| Conversation and messages | BFF | existing `conversations`, `messages`, `queryMessages` |
| Execution versions of a run | BFF | `queries`, at `run_started` (AD-11, unchanged) |
| Run-internal state | agent-service | in memory, for the duration of the request |
| Pending pause and continuation | BFF | `queries.metadata.agent_run.pause` |
| Tool-call audit summary | BFF | `queries.metadata.agent_run.tool_calls[]` |
| Approval decision | BFF | `queries.metadata.agent_run.pause.decision` |

The agent block is the one that ships: `queries.metadata.agent_run` already carries the run id, the
execution versions, the usage record and the outcome (`agent-run-contract.js`). The pause, its
continuation and the tool-call audit join THAT block — a second block beside it would split one
run's story across two paths of one document, and the finalize rebuilds the metadata wholesale.

Rollback continuity holds: the legacy path ignores the `agent_run` block. After a rollback, a pending pause is simply never resumed; the conversation continues.

### 7.3 Conversation context

The run receives one `question` today. The deployed chatqna module has three history knobs, and the shipped defaults are worth stating exactly: `MULTI_TURN_MODE` is `blend` and `MULTI_TURN_BLEND_ENABLED` is `false`, so the default configuration takes NO history; the condense mode is opt-in, and its knob (`MULTI_TURN_CONDENSE_HISTORY_TURNS = 8`) counts message segments — eight of them are four exchanges. Iteration 2 carries the context with the request:

- `turns` is a bounded list of prior user and assistant messages, assembled by the BFF from existing records.
- Two deployment knobs bound it: number of messages (proposed default 8 — four exchanges) and characters (proposed default 12 000). The bound is a decision of this design, not a parity claim: the shipped default takes no history at all, and the condense depth is the nearest comparable number. History tokens count against the run's token budget.
- No separate condense step: the model sees the turns and writes standalone search queries itself.
- A free-text reply that answers a paused question is an ordinary turn: the assistant's last message in `turns` carries the options.

### 7.4 Audit

Per tool call: `call_id`, tool, outcome, duration, bytes. For a write: the idempotency key, the receipt reference and the decision (approved or refused, when). Raw arguments and results of read tools are not stored in this block.

### 7.5 Crash

A run is lost if `agent-service` restarts mid-run. The BFF reports the failure; nothing is retried automatically. Accepted while runs are short.

### 7.6 State of the art, and how this design relates

Read from the documentation of six runtimes on 2026-11-25:

| Pattern | Evidence | This design |
|---|---|---|
| Storage belongs to the application, behind an interface | LangGraph: the host supplies the checkpointer; pydantic-ai: « deliberately unopinionated about your database »; Google ADK: pluggable `SessionService`; Strands: pluggable storage | the BFF and its collections are the application's storage; `agent-service` holds none |
| A pause is a serialized snapshot the application keeps | pydantic-ai: « Store the paused conversation »; OpenAI Agents SDK: « `RunState` is designed to be durable »; Google ADK: « the decision can arrive in a later `run_async` call, even from another process » | the continuation, stored on the turn |
| Durable execution is a separate tier with an external engine | OpenAI Agents SDK: « durable orchestration when runs may span long waits, retries, or process restarts »; pydantic-ai: Temporal, DBOS, Prefect, Restate | not adopted (§7.5) |
| In-memory state is lost on restart | LangGraph: « When the process restarts, all checkpoints are lost »; Google ADK: « All conversation data is lost if the application restarts » | same, by choice |

The counter-example is DeepSeek Harness, which keeps its sessions in its own home directory, one live agent per session until the process stops.

### 7.7 Triggers to revisit

- Runs long enough that losing one on restart costs more than a checkpoint: add step-boundary snapshots written through a storage port owned by the BFF's database. The pipeline state is already serializable at step boundaries, so nothing else changes.
- A regulation requiring the full argument of every write call to be retained.

---

## 8. Budgets, cancellation, errors

### 8.1 Ownership (AD-6, unchanged)

The BFF owns the end-to-end deadline and derives `deadline_ms`. The orchestrator owns the agent-phase budget. Budgets are server configuration; none rides the request.

### 8.2 Pipelines

Each segment has one monitor, the source of every counter. A pipeline declares a wall-clock share and a model-call cap per step; their sum must fit the segment's deadline minus the verification reserve. A fan-out step's share is divided across its runs. A step that exceeds its share fails under its own policy (§5.2).

Each segment is accounted as its own run; segments are linked by a `pipeline_id` on their usage records.

### 8.3 Cancellation chain (FR-11)

Client disconnect → the BFF aborts its upstream request → `CancelledError` in `agent-service` → the token is cancelled → the in-flight model call, the in-flight MCP request and the runs of a fan-out are closed. No terminal event; the partial usage is logged, as today.

### 8.4 A write after a cancellation

Closing an HTTP request does not undo a write that was already sent. The dispatcher reports the call's outcome as `unknown`; the audit records it; the pipeline's read-after-write step settles it; the user is told the truth. The idempotency key makes a later retry safe.

### 8.5 Error taxonomy

Tool errors use the contract's existing outcome codes (`AUTHORIZATION_FAILURE`, `TRANSIENT_FAILURE`, `DEGRADED_AVAILABILITY`) plus `invalid_arguments`. MCP `is_error` and transport failures map onto them.

---

## 9. Security and sovereignty

### 9.1 Controls

| Risk | Control |
|---|---|
| A user reaches a tool they may not use | catalog `allow`, required `scopes`, per-request registry (the tool is not even listed) |
| A write in the user's name without consent | `requires_approval`, pause, decision recorded |
| A write replayed | idempotency key |
| Personal data sent to the open web | `egress: open_web` passes through `pii-service`, failing closed |
| Retrieved content used as instructions | injection scan on every tool result, in the dispatcher; server-provided instructions never enter the prompt |
| Tokens leaked in logs or events | credentials stay in the adapter; events carry counters and ids only (existing rule) |
| Egress to an unintended host | MCP egress limited to the catalog's servers (compose network, chart NetworkPolicy) |
| Mock servers as a new attack surface | hardened like `agent-service`: no capabilities, `no-new-privileges`, non-root user, no host port |

### 9.2 Dependencies (NFR-2 adoption rule)

| Package | Version | License | Default network behavior | Status |
|---|---|---|---|---|
| `mcp` | 2.3.0 | MIT | no telemetry exporter among its dependencies; it requires `opentelemetry-api>=1.28.0` where the tree pins `1.27.0`, and brings `httpx2`, `jsonschema`, `mcp-types`, `python-multipart`, `sse-starlette` and `cryptography` (through `pyjwt[crypto]`) | to adopt, client only; its adoption starts with an OpenTelemetry line bump and the audit of those packages (ADR agentic-005) |
| `pytestarch` | 5.1.1 | Apache-2.0 | test only | to adopt, `requirements-test.txt` |
| SearXNG | unmodified image | AGPL-3.0 | separate service, consumed over its HTTP API | decision recorded in ADR 0003 of the Server-Side Tools record; to re-record (§12) |

No agent framework is adopted at runtime. A spike's dependencies stay out of the shipped image.

---

## 10. Testing and proofs

### 10.1 Architecture

The rules of §2.5, plus the planted-violation probe.

### 10.2 Runtime

The contract suite and its violators (§3.5); the byte-identical stream gate for each migration step (§3.6).

### 10.3 Tool sources

One suite per source: an uncatalogued tool is invisible; arguments are validated; timeout and size bounds hold; upstream errors become envelopes; the injection scan applies; identity is forwarded only where declared.

### 10.4 Pipelines

Typed state between steps; required and optional failure; fan-out share; pause then continuation round-trip; a refused call; continuation refused on mismatch or after its lifetime.

### 10.5 BFF

Frames additive and positioned (AD-8); the decision endpoint's ownership, single-use and lifetime checks; persistence of the `agent` block; the legacy path continues a conversation that has a pending pause.

### 10.6 End to end

Approval on web and mobile; the two pipelines on the shared cluster.

### 10.7 Evaluation

E01 and E02 continue unchanged. One added comparison: the simple run with `web_search` against the extended-research pipeline, on an assessment subset, reusing `tests/rag-benchmarks`. The simple run's existing results must not move.

### 10.8 Probes

| # | Probe | Answers |
|---|---|---|
| P1 | A planted illegal import, top-level and function-local | does the architecture suite turn red |
| P2 | `pip download deepseek-harness-sdk==0.2.2rc2 --no-deps`; read `METADATA` | the runtime wheel's license (ADR-002 revisit trigger) |
| P3 | `python -m agent.v06_harness` per runtime against the venue's vLLM | the tool-calling matrix with several tools registered |
| P4 | On the venue's Keycloak 26.8.2: exchange a user token for an audience-bound one | standard token exchange V2 is available |
| P5 | An MCP tool called twice with the same `_meta` key | the mock server honors idempotency |

### 10.9 Manual gates

`tests/compose-non-root/check-runtime.sh` after every compose change (new services, `pii-service` profile). The chart follows the chart version bump workflow.

---

## 11. Delivery slices

Smallest first. Each slice is one implementation plan with its own gate.

| Slice | Content | Gate |
|---|---|---|
| S0 | The records of §12 | records accepted |
| S1 | Architecture tests; the six leaks closed; migration step 1 | architecture suite green; stream identical |
| S2 | Migration step 2: dispatcher, orchestrator-owned lifecycle | contract suite green, violators red; stream identical |
| S3 | `ToolSource`; `DocumentToolSource`; catalog; `web_search` in the simple run; PII egress; web citation variant on web and mobile | tool-source suites; runtime gate; end to end |
| S4 | `turns` in the request; BFF assembly | budget and bounds tests |
| S5 | Pipeline core; extended research | pipeline tests; evaluation comparison |
| S6 | Scheduler mock MCP server; `McpToolSource`; `UserCredentials`; write path with pause; client frame; decision endpoint; approval on web and mobile | pause round-trip; BFF contract tests; end to end |
| S7 | pydantic-ai spike, out of tree | spike report |

S1 is delivered as three plans, each landing on its own: the architecture tests and the two leaks that need no code to move; composition out of the core, which closes the rest; migration step 1.

New deployment knobs go into the `env` template and the config validator's coverage.

---

## 12. Records

Proposed in this change, in the existing convention (`docs/adr/agentic-00N-<slug>.md`), each with the status `Proposed`:

| Record | Content |
|---|---|
| `agentic-004` runtime port | the port and governance-by-construction; amends the wiring of AD-5; D03 unchanged; the spike protocol |
| `agentic-005` tools and MCP | tool sources, static catalog, MCP consumption; supersedes the basis of #603 Phase 1B and 1C (`mcpo` rejected; mock servers first) |
| `agentic-006` pipelines and pause | pipelines as core code; pause as a run outcome; supersedes #603 Phase 1A, 1D and 1E (no LangGraph, no workflow checkpoints in ArangoDB, no status WebSocket) |
| `agentic-007` persistence, iteration 2 | re-declares AD-12: the additive `agent` block, conversation context, audit, crash-loss acceptance |
| `agentic-008` Server-Side Tools disposition | kept: the three governance phases, roles, outbound PII, honest degradation, the SearXNG license decision; re-based: web search as a tool source; dropped: pipeline fusion as the execution model |

The architecture spine (AD-3, AD-12, the deferred list), issue #603 and the framing issue #1729 are updated to point at these records, so that one canonical home exists per decision (FR-29). That update is a follow-up, not part of this change: this merge request carries the records alone, and until the follow-up lands the spine's deferred list still names the workflow layer, #603 still carries the LangGraph plan, and #1729 still frames the problem the old way.

---

## 13. Non-goals, decisions needed, risks

### 13.1 Non-goals for iteration 2

A shipped second runtime; durable execution; dynamic tool management; declarative workflows; a visual designer; model-decided delegation; A2A; DeepSeek Harness as a runtime.

### 13.2 Decisions needed, with a proposed default

| Decision | Proposed default |
|---|---|
| First mock building block | Scheduler: one read tool, two write tools, one read-after-write |
| Client frame and endpoint names | `agent_pause`; `POST /api/chat/queries/:queryId/agent-pause/:pauseId/decision` |
| Continuation lifetime | 24 hours |
| Context bounds | 8 messages (four exchanges), 12 000 characters |
| What `scopes` maps to | realm roles, as the Server-Side Tools record's `tools-reader` and `tools-admin` were |

### 13.3 Risks

| Risk | Response |
|---|---|
| More registered tools degrade tool-calling on the venue's vLLM | probe P3 before slice S3; per-step tool subsets keep each model call small |
| Tool definitions consume the prompt budget | count them in the budget tests; bound the catalog |
| The spike fails the tool-calling matrix on vLLM | reported as a result; D03 stays closed |
| `pytestarch` misses a dynamic import | recorded; review item for `importlib` in the core |
| Single-replica lane limits concurrency | unchanged from iteration 1; measured before any change |
