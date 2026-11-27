# Agentic S3, plan 1 of 3 — the tool-source port, the document source and the catalog: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The two document tools become a SOURCE behind a port, and the deployment's CATALOG decides what a run may call: a tool the catalog does not name is neither listed to the model nor dispatchable, and the sources are declared by the HOST, not composed by the core.

**Architecture:** Four tasks, each green before the next. (1) **The move** — the two tools leave `agent/toolset.py` for `agent/sources.py` and become `DocumentToolSource`; the definitions, the executors, the preparation leg and the insufficiency recorder move VERBATIM, and the byte-identical event stream proves the move changed nothing. (2) **The catalog** — a static JSON deployment file (`configs/agent/tool-catalog.json`) plus a loader and a validator in the HOST (`tool_catalog.py`), carrying the startup rules (a duplicate exposed name is an error; a catalogued tool a source does not serve is a warning and an absent tool). (3) **The assembly** — the orchestrator takes the sources from the HOST (a factory over the per-request bundle) instead of composing the document source itself, and the catalog filters the pairs the sources offer. (4) **The deployment** — the knob, the env template, the compose mount, the ansible seeding and the config-validator gates.

**Tech Stack:** Python 3.11, pytest 9.1.1, pytestarch 5.1.1 (the rules of plan 1), ruff 0.16.3. JSON for the catalog file — the agent service's own requirements pin no YAML parser, and NFR-2 prices every new dependency.

**Spec:** `docs/superpowers/specs/2026-11-25-agentic-iteration-2-architecture-design.md` — §4.1 (one door), §4.2 (the document source, unchanged), §4.3 (the port), §4.4 (the catalog), §4.5 (the call path), §2.5 (the dependency rules), §8 (budgets, cancellation, errors), §11 (the slices), §13 (non-goals, decisions needed, risks). ADR: `docs/adr/agentic-005-tool-sources-and-mcp-consumption.md`.

## Global Constraints

- **Where the work lands.** Branch `feat/agentic-foundations/s3-tool-sources`, STACKED on `feat/agentic-foundations/architecture` (merge request !1088, whose target is `feat/agentic-foundations/prd`). The S3 branch's own merge request targets the ARCHITECTURE branch, not the PRD branch: this slice's diff is the stack's diff, and a review that reads `main...HEAD` would read the whole architecture slice with it. Commit on the S3 branch only. Do not push without the operator's word, do not touch `main`, the PRD branch or the architecture branch, never run `git stash`, never run `git reset --hard`.
- **No path is written in this plan.** Every command block starts with the same guard, which moves to the root of the checkout it is run from and refuses anything but that branch.
- **The document tools' behaviour is FROZEN.** The recorded contract is `docs/baselines/v02-opea-query-path-contract.md`, and `components/agent-service/tests/test_equivalence_v02.py` stays green AND untouched (this plan does not edit that file) — but read what that suite actually witnesses: it drives the CAPABILITY and the PREPARATION, not the tools. The witness of the tools' behaviour is `tests/test_agent_toolset.py` — the suite this plan RENAMES. So the freeze is carried by that suite's pins (kept EXACTLY as they are) plus the definitions pin this plan adds, and by the recorded event stream (the fixture does not change). The equivalence suite proves the capability did not move; the renamed suite proves the tools did not change.
- **The event stream is FROZEN.** `components/agent-service/tests/test_event_stream_gate.py` compares the recorded stream byte for byte and its fixture (`tests/fixtures/event_stream/orchestrated_run.json`) does not change. The gate's CONSTRUCTION may change (the orchestrator's constructor changes — that is the assembly's move), its COMPARISON and its FIXTURE may not.
- **The registry stays the authorization surface.** A tool absent from the registry is refused before any resolution (`UnregisteredToolError`); a duplicate exposed name is refused by `ToolRegistry.register`. The catalog decides what is REGISTERED; the registry decides what is CALLABLE. Neither replaces the other.
- **The core composes nothing.** The sources are declared by the HOST (the composition root: `app.py` / `tool_catalog.py`). The core asks the declared sources for the tools they offer and registers the pairs it is handed.
- **Every source's executor captures the request's identity.** The caller's context and the bearer travel with the CALL, never with the construction — the narrowing travels in the context, never in the arguments, so nothing the model contributes can widen the scope.
- **The Iron Law of TDD.** No production code without a failing test first. The test is written, run, and seen RED for the right reason; then the minimal implementation; then the suite GREEN again. Every assertion must be able to redden (a mutation must break it).
- **Lint locally with `--no-cache`.** A stale `.ruff_cache` answers green on a tree the CI rejects (2026-11-26).
- **No new dependency.** The catalog is JSON (the stdlib); a YAML parser would enter the audited tree for a file the deployment reads once (NFR-2, A5).
- **New deployment knobs go into the `env` template and the config validator's coverage.** A knob the code reads and the `env` template does not document is a knob no operator can find.
- **An output that differs from the expected one is a stop.** Report it; do not adjust a test, a catalog or a list to make it pass.

## Where this plan sits

| Plan | Content | State it leaves |
|---|---|---|
| **This one** | the `ToolSource` port; `DocumentToolSource`; the catalog (file, schema, startup validation); the registry's per-request assembly from the declared sources | the two document tools live behind the port; the catalog decides what a run may call; the host declares the sources |
| Plan 2 | `web_search` (SearXNG) and the outbound PII egress | a second source; `egress: open_web` becomes honourable |
| Plan 3 | the web citation variant (`source: 'web'`) on web and mobile | the web result's provenance, rendered |

Beyond this slice: the MCP source and the `mcp` SDK (S6), the pydantic-ai spike (S7), the write tools' approval and idempotency key (ADR agentic-006).

## File map

| File | Responsibility | Task |
|---|---|---|
| `components/agent-service/agent/sources.py` | the port (`ToolSource`), the per-request bundle (`ToolSourceContext`), the document source (`DocumentToolSource`) | 1 |
| `components/agent-service/agent/toolset.py` | **DELETED** — its content moved, unchanged, into `agent/sources.py` | 1 |
| `components/agent-service/agent/registry.py` | the authorization surface, plus `build_registry(pairs)` | 1 |
| `components/agent-service/agent/orchestrator.py` | the per-request assembly: the sources come from the host | 1, 3 |
| `components/agent-service/agent/__init__.py` | the package's exports | 1 |
| `docs/adr/agentic-005-tool-sources-and-mcp-consumption.md` | its Context sentence and its References line name the module this plan deletes | 1 |
| `docs/adr/agentic-009-the-core-knows-nothing-of-the-outside.md` | its "the measurement surface owns its own tool contract" paragraph names the product's declaration home — `agent/toolset.py` — which this plan deletes; it becomes `agent/sources.py` | 1 |
| `components/agent-service/measurement/probe.py` | the probe's registry, built over the source | 1 |
| `components/agent-service/tool_catalog.py` | **the host's** catalog: the model, the loader, the startup validation, the per-request filter | 2, 3 |
| `configs/agent/tool-catalog.json` | the deployment file — the two document entries | 2 |
| `components/agent-service/tests/test_agent_sources.py` | the source's contract + the moved toolset pins (renamed from `test_agent_toolset.py`) | 1 |
| `components/agent-service/tests/test_tool_catalog.py` | the catalog's validation rules and the filter | 2, 3 |
| `components/agent-service/tests/test_event_stream_gate.py` | the recorded stream — the construction line changes (in task 3), the comparison does not | 3 |
| `components/agent-service/tests/test_architecture.py` | the host layout gains the catalog module | 2 |
| `components/agent-service/Dockerfile` | the image carries the catalog module | 2 |
| `env` | the deployment knob, documented | 4 |
| `docker-compose.yaml` | the knob and the read-only mount of the catalog file | 4 |
| `deploy/ansible/templates/env.j2`, `deploy/ansible/group_vars/all.yml`, `deploy/ansible/deploy.yml` | the knob, the group var, the catalog's seeding on the node | 4 |
| `tests/config-validator/__tests__/agent-service.test.js` | the knob's coverage + the shipped catalog's shape | 4 |
| `configs/README.md` | the new config home's index entry | 4 |

## Decisions taken while writing this plan

Each was checked against the code before being written here.

- **The catalog is JSON, and it lives under the repo's `configs/` home.** `configs/` is the repository's configuration home (`otel/`, `grafana/`, `keycloak/`), and the catalog is a DEPLOYMENT file, not source. The extension is JSON because the AGENT SERVICE's own tree pins no YAML parser (`components/agent-service/requirements.txt` and `requirements-test.txt` name no `yaml` package): a YAML catalog would put a new package in the audited tree for a file the deployment reads once — NFR-2 prices that, and A6 forbids the adoption for flexibility's sake. (The wider repository DOES parse YAML elsewhere — the OPEA overlay pins `pyyaml`, and the frontend imports a YAML grammar for its editor — which is exactly why the claim is scoped to this service's tree.)
- **The catalog is entirely the HOST's.** The core never learns what a catalog is. The host loads it, validates it, and offers the run only the pairs the catalog allows; the core's registry stays the authorization surface, so the model's list and the dispatcher always agree. The alternative (a catalog model in the core) would put a deployment concept inside the core for no gain — the core has no opinion about WHICH tools exist.
- **"Startup" means the ASSEMBLY, not the process boot.** The agent service builds its orchestrator lazily, on the first run request (`app.py`'s `_runtime()`), and the repository's contract says so (the run surface's config is read lazily — `docker-compose.yaml:1543`'s comment, and the mechanism is `app.py`'s `_runtime()`, which builds on the first run request). A catalog defect is therefore a `ValueError` at assembly → the run surface's honest 503 (`run_surface_unconfigured`) naming the file and the defect. No request is ever served by a broken catalog, and the container's boot is not coupled to the file's content.
- **The port is the design's §4.3 protocol, verbatim — ONE method.** The design is NOT silent about the port's shape: it writes the protocol out (`docs/superpowers/specs/2026-11-25-agentic-iteration-2-architecture-design.md:259-260`), and ADR agentic-005 §1 says the same ("A `ToolSource` returns `(ToolDefinition, ToolExecutor)` pairs for a caller context and a bearer"). The port is therefore reproduced exactly, and the deployment's two extra facts — the id the catalog's `source` field names a source by, and the tools it serves — are the HOST's, not the port's: the host holds the catalog (§4.4) and the host discovers a source's tools at startup (§4.4's "MCP tools are discovered at startup"). The core reads neither, so declaring them on the port would put the catalog's vocabulary in the core's contract for nothing. `DocumentToolSource` keeps them as class attributes — the host reads them off the concrete class it declares.
- **The identity arrives with the CALL.** The source is built per request (the operation budget, the preparation leg and the insufficiency recorder are the run's), and `tools(context, bearer)` hands the executor its identity. Derived from the design's "each executor captures that request's identity".
- **The per-request bundle carries the run's wiring.** `ToolSourceContext` holds the caller's context, the bearer, the operation budget, the preparer, the preparation-status sink and the abstention recorder. The core owns the run's monitor, preparer and sinks; the host builds the sources FROM the bundle. That is what keeps the preparation leg where it is (the document source's business) while the core composes nothing.
- **The catalog's per-tool budget may only TIGHTEN the deployment's ceiling.** The `AGENT_TOOL_*` knobs stay the deployment's ceiling on every tool; an entry that declares a budget may lower a dimension, never raise it, and an entry above the ceiling is a startup error naming the entry, the dimension and the two numbers. An entry with no budget uses the ceiling. This tightening is the PLAN's own conservative default, not a rule the spec states: the catalog IS server configuration (AD-6 says exactly that, and §4.4 calls the catalog a static deployment file), so a deployment file *could* widen a bound. The trade-off is named: an operator who needs a per-tool bound above the `AGENT_TOOL_*` ceiling has no way to say so until this is revisited — a bound the environment sets for EVERY tool stays the bound for every tool.
- **`allow` is the per-entry switch.** The design names the field without defining it. The catalog IS the allow-list, so `allow: false` keeps the entry (and its budget, its risk, its scopes) while taking the tool out of the run — neither listed nor dispatchable. It is not an error: switching a tool off is an operation, not a defect.
- **The fields this deployment cannot HONOUR cost the ENTRY, not the service.** A required `scopes` list (the enforcement lands with the identity slice's `CallerContext.scopes`, §4.8), `risk: write` or `requires_approval: true` (no approval path until ADR agentic-006), and `egress: open_web` (no PII egress path until plan 2) are refused: the ENTRY is dropped with a loud startup ERROR naming it, and the rest of the catalog loads. The entry's tool is therefore ABSENT — never listed, never dispatchable — so nothing is ever served unenforced, and one mis-declared entry does not take the whole run surface down. (The ADR agentic-005 §7 rule is PER REQUEST — "a tool whose required scopes are not all present is not registered for that request" — and it needs `CallerContext.scopes`, which lands with the identity slice. Until then this plan's rule is STRICTER: the entry is refused for EVERY caller, at startup. The deviation is stated in "Out of scope" (the file's last section), not in "What it leaves open".)
- **One rule for every refusal: the ENTRY is refused, the catalog still loads.** A DUPLICATE exposed name is the file's own defect (two tools with one name — the model would see an ambiguity), so it fails the whole catalog. Every other refusal — an entry naming a source this deployment does not declare, a server-scoped tool, a required scope, a write, an approval, an open-web egress — costs the ENTRY: a loud startup ERROR names it, the tool is absent (never listed, never dispatchable), and the rest of the deployment's tools keep working. One mis-declared entry must not take the whole run surface down, and the entry that is refused is exactly the one that must not be served. The design's own sentence covers the served-but-not case (a warning, and the tool is absent).
- **`server` and `tool` are carried by the schema and required to be null in this slice.** The design's field list names them (the MCP slice's addressing); no MCP source is deployed, so an entry that names a server names a source that does not exist — refused by the rule above.
- **The two tools' definitions and executors move VERBATIM.** The description strings, the parameter schemas, the `_QUERY_TEXT` validation, the preparation leg, the `_unprepared_envelope`, the `TransientError` on a translation overflow and the abstention recorder move as they are. THREE things change, named: (1) where the caller's identity enters (with the call, not the construction); (2) the per-tool bound lookup (`_budget_for`, equal to the ceiling when no override map is passed); (3) the definitions become MODULE-LEVEL constants instead of per-call literals — and because `ToolDefinition.parameters` is a mutable dict, `build_registry` copies it at registration (a `MappingProxyType` would not serialize to the model call's JSON body), so one request cannot mutate what every request is told.
- **The registry gains a builder, not a second door.** `build_registry(pairs)` loops over `ToolRegistry.register` — the duplicate refusal stays exactly where it was, and the orchestrator and the probe share one assembly.
- **The probe keeps its own wiring shape.** It builds the document source over the port it already holds (a factory that ignores the call and returns that port) — the probe is a measurement surface with its own wiring, not a second production path.
- **The document source's id is `"document".** The catalog's `source` field names it; the shipped catalog declares the two document tools on it.

---

## Environment

The commands use a virtual environment OUTSIDE the repository: the root
`.gitignore` ignores only `genie-ai-overlay/.venv/`, so a venv created inside
`components/agent-service` would show as untracked files. Shell state does not
carry between two commands, so every block repeats what it needs.

The guard every block starts with:

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/s3-tool-sources ] || { echo "not in the checkout that carries feat/agentic-foundations/s3-tool-sources"; exit 1; }
```

- [ ] **Step 0: Create the environment and take the baseline**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/s3-tool-sources ] || { echo "not in the checkout that carries feat/agentic-foundations/s3-tool-sources"; exit 1; }
BASE=$(git rev-parse HEAD) && echo "plan base: $BASE"   # the gates G3/G3b/G4/G7 diff against THIS
command -v uv
cd components/agent-service
uv venv --python 3.11 /tmp/genie-agent-service-venv
uv pip install --python /tmp/genie-agent-service-venv/bin/python -r requirements-test.txt
/tmp/genie-agent-service-venv/bin/python -m pytest tests/ -q
```

`command -v uv` prints a path. The last command prints `1019 passed, 2 warnings
in <a few seconds>` — the baseline this plan starts from (re-measured after the
S1 branch merged into this one; the pre-merge count of 1010 is stale). If the venv already
exists, skip `uv venv` and keep the `uv pip install` line: a venv whose
`site-packages` is empty (a `/tmp` wipe leaves the directory, not the packages)
answers "No module named pytest", which is a wiped environment, not a broken
tree.

Task 4's gate runs the CONFIG-VALIDATOR suite, and that suite drives the
Playwright config's own ESLint — so the E2E tree's dependencies must be
installed too, or the suite answers "tests/e2e deps missing on this checkout"
and the gate's red is the environment's, not the plan's:

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/s3-tool-sources ] || { echo "not in the checkout that carries feat/agentic-foundations/s3-tool-sources"; exit 1; }
cd tests/e2e && npm ci && cd ../config-validator && npm ci && npm test
```

The last command prints `22 passed, 22 total` suites and `734 passed` tests —
the baseline that suite starts from.

---

### Task 1: The move — the document tools behind the port

**Files:**
- Create: `components/agent-service/agent/sources.py`
- Delete: `components/agent-service/agent/toolset.py`
- Modify: `components/agent-service/agent/registry.py` (add `build_registry`)
- Modify: `components/agent-service/agent/orchestrator.py` (the per-request assembly)
- Modify: `components/agent-service/agent/__init__.py` (the exports)
- Modify: `components/agent-service/measurement/probe.py` (the probe's registry)
- Rename: `components/agent-service/tests/test_agent_toolset.py` → `components/agent-service/tests/test_agent_sources.py`
- Modify: `components/agent-service/tests/conftest.py`, `tests/test_agent_loop.py`, `tests/test_agent_probe.py` (the imports)
- Modify: `docs/adr/agentic-009-the-core-knows-nothing-of-the-outside.md`, `docs/adr/agentic-005-tool-sources-and-mcp-consumption.md` (Step 7's two records — committed by THIS task's step 10, not left dangling)

**Interfaces:**
- Consumes: `agent.registry.ToolDefinition`, `ToolExecutor`, `ToolRegistry`; `capabilities.contract.CallerContext`, `DocumentCapabilityPort`, `OperationBudget`, `OperationName`, `OutcomeCode`, `PreparedQuery`, `QueryPreparationStatus`, `ReadSourceInput`, `SearchKnowledgeInput`, `SearchKnowledgeResult`, `SourceRef`, `TransientError`; `preparation.detection.detect_language`; `preparation.translation.TranslationInputTooLongError`; `preparation.prepare.QueryPreparer`.
- Produces:
  - `sources.ToolSource` — the port, the design's §4.3 protocol verbatim: `def tools(self, context: CallerContext, bearer: str | None) -> Sequence[tuple[ToolDefinition, ToolExecutor]]`.
  - `sources.ToolSourceContext` — the per-request bundle: `context`, `bearer`, `operation_budget`, `preparer`, `on_preparation_status`, `abstention_sink`.
  - `sources.DocumentToolSource` — the two document tools, moved unchanged. It keeps two facts as CLASS attributes (`source_id = "document"`, `served_tool_names = frozenset({"search_knowledge", "read_source"})`) — the host reads them off the concrete class when it declares the source; the PORT does not carry them.
  - `registry.build_registry(pairs: Iterable[tuple[ToolDefinition, ToolExecutor]]) -> ToolRegistry`.

- [ ] **Step 1: The failing test — the source's contract**

Rename `tests/test_agent_toolset.py` to `tests/test_agent_sources.py` and re-point it at the source. The pins that were about the BUILDER become pins about the SOURCE; the behaviour pins (the preparation leg, the insufficiency envelope, the abstention recorder) stay EXACTLY as they are — they are the frozen behaviour this move must not touch.

The suite's helper becomes the SHARED one — MOVED NOW, in this step (not left for Step 7): it lives in `tests/conftest.py`, beside `orchestrator_config`, with Step 7's conftest imports (`from agent.sources import DocumentToolSource`, `from agent.registry import build_registry`) applied HERE — otherwise the collection error below names `agent/toolset.py` (which still exists) instead of the missing `agent/sources.py`, and the RED proves nothing. Every suite that builds a document registry calls it — a copy of the wiring in each suite is a copy that drifts:

```python
def document_registry(port, context, budget=None, **wiring):
    """The registry the document source offers, over one port.

    ONE helper for the suites: the source builds its pairs per call and
    the registry is the authorization surface. The budget defaults to the
    orchestrator's own; a suite that runs under another budget passes it.
    """
    budget = budget if budget is not None else orchestrator_config().operation_budget
    source = DocumentToolSource(lambda _context, _bearer: port, budget, **wiring)
    return build_registry(source.tools(context, None))
```

and the pins that called `document_toolset(port, CONTEXT, budget)` call `document_registry(port, CONTEXT, budget)` instead.

The probe pin becomes:

```python
def test_the_probe_reimports_the_moved_source():
    assert measurement.probe.DocumentToolSource is agent.sources.DocumentToolSource
    # The probe module keeps its own prompt; the governed default is the
    # production one (the orchestrator's default, not the harness's).
    assert PROBE_SYSTEM_PROMPT != PRODUCTION_SYSTEM_PROMPT
```

Add the NEW pin — the one the port exists for:

```python
def test_the_executor_carries_the_identity_of_the_call_not_of_the_construction():
    """The narrowing travels in the context, never in the arguments.

    The source is built ONCE; the caller's identity arrives with the
    CALL. Two calls on one source must reach two different ports — the
    one each call's identity bound — and the executor must keep that
    binding for the whole life of the pair it returned.
    """
    served: list[tuple[CallerContext, str | None]] = []
    ports: dict[str, AgentFakePort] = {}

    def port_factory(context, bearer):
        served.append((context, bearer))
        port = AgentFakePort(search_result=canned_search_result())
        ports[bearer] = port
        return port

    source = DocumentToolSource(port_factory, orchestrator_config().operation_budget)
    first = CallerContext(user_id="u-1", authorized_graph_names=("GRAPH",))
    second = CallerContext(user_id="u-2", authorized_graph_names=("GRAPH",))

    build_registry(source.tools(first, "bearer-1"))
    second_registry = build_registry(source.tools(second, "bearer-2"))

    # The identity travelled with the CALL, not with the construction.
    assert served == [(first, "bearer-1"), (second, "bearer-2")]

    # The SECOND registry's executor answers through the SECOND call's
    # port, with the SECOND call's context — the narrowing is the
    # context's, and it never reaches the arguments.
    asyncio.run(second_registry.dispatch("search_knowledge", {"query": "the model query"}))
    assert len(served) == 2, "the executor re-bound the port at dispatch time"
    [call] = ports["bearer-2"].search_calls
    assert call["context"] is second
```

Two MORE pins — the production surface Task 1 creates and nothing here may leave unexercised (the Iron Law: production code does not land without its failing test):

```python
def test_a_tighter_per_tool_budget_reaches_the_executor():
    """The ``budgets=`` override is a real wiring, not decoration: the
    budget the source hands the executor for a NAMED tool is the
    OVERRIDE — the ceiling stays for every tool the map does not name."""
    override = OperationBudget(timeout_ms=1000, max_results=1, max_result_bytes=1024)
    port = AgentFakePort(search_result=canned_search_result())
    source = DocumentToolSource(
        lambda context, bearer: port,
        orchestrator_config().operation_budget,
        budgets={"search_knowledge": override},
    )
    registry = build_registry(source.tools(CallerContext(user_id="u-1", authorized_graph_names=("GRAPH",)), None))
    asyncio.run(registry.dispatch("search_knowledge", {"query": "q"}))
    # The fake records the budget every call carries: the override rode.
    assert port.search_calls[0]["budget"] is override


def test_the_request_bundle_carries_the_call_s_full_identity():
    """``ToolSourceContext`` is the per-request bundle: the context, the
    bearer and the operation budget travel together to the port."""
    context = CallerContext(user_id="u-1", authorized_graph_names=("GRAPH",))
    budget = orchestrator_config().operation_budget  # ONE call: the config is a factory
    bundle = agent.sources.ToolSourceContext(context=context, bearer="tok-1", operation_budget=budget)
    assert bundle.context is context
    assert bundle.bearer == "tok-1"
    assert bundle.operation_budget is budget
```

And the pin the move's own claim needs — the DEFINITIONS, which nothing in the tree pins today:

```python
def test_the_tool_definitions_move_verbatim():
    """The model-facing contract moves byte for byte.

    The definitions are what the model is told: the name, the
    description and the parameter schema. Nothing else in the tree pins
    them (the recorded event stream carries the CALLS, not the
    definitions), so a drifted description or a dropped ``required`` key
    would pass every other gate of this plan. This pin is the witness.
    The names ride the suite's import row (Step 7's table) — no local
    import: a second one reds F811 against it.
    """

    assert SEARCH_KNOWLEDGE_DEFINITION.name == "search_knowledge"
    assert SEARCH_KNOWLEDGE_DEFINITION.description == (
        "Search the authorized knowledge corpus. Returns ranked passages with their provenance, "
        "or an explicit insufficient-evidence outcome."
    )
    assert SEARCH_KNOWLEDGE_DEFINITION.parameters == {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "The English search query."},
        },
        "required": ["query"],
    }
    assert READ_SOURCE_DEFINITION.name == "read_source"
    assert READ_SOURCE_DEFINITION.description == (
        "Read one source the search results pointed at. A legacy document is addressed by its "
        'file_id ("target": {"file_id": ...}); an OKF concept by repo_id and concept_id '
        '("target": {"repo_id": ..., "concept_id": ...}).'
    )
    assert READ_SOURCE_DEFINITION.parameters == {
        "type": "object",
        "properties": {
            "target": {
                "type": "object",
                "description": 'Either {"file_id": ...} or {"repo_id": ..., "concept_id": ...}.',
            },
        },
        "required": ["target"],
    }
```

(The values are the ones `agent/toolset.py` carries today — copied VERBATIM from that file, not retyped. A retype is how a description drifts by a word.)


And the definitions' own prompt cost is COUNTED (spec §13.3: "count them in the budget tests") — in the renamed suite, beside the definitions pins:

```python
def test_the_declared_definitions_stay_within_their_prompt_allowance():
    """The two definitions ride EVERY model call's prompt: their size is
    a budget fact, pinned where the definitions live. When the budget
    slice (S4) wires the prompt accounting it reads THIS number — a
    definition that grows silently moves it."""
    import dataclasses

    payload = json.dumps([dataclasses.asdict(d) for d in (SEARCH_KNOWLEDGE_DEFINITION, READ_SOURCE_DEFINITION)])
    assert len(payload) <= 4096
```

- [ ] **Step 2: Run the suite and watch it fail**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/s3-tool-sources ] || { echo "not in the checkout that carries feat/agentic-foundations/s3-tool-sources"; exit 1; }
cd components/agent-service
/tmp/genie-agent-service-venv/bin/python -m pytest tests/test_agent_sources.py -q
```

Expected: the collection FAILS because the source's module does not exist yet. The import error names whichever of the two new imports the canonical order executes first — with conftest's imports in ruff-canonical order (`agent.registry` before `agent.sources`) that is `agent/registry.py` (`cannot import name 'build_registry'`); after the registry exists, the same red surfaces as `agent/sources.py`. Either name is the right red: the module the suite needs is not there.

- [ ] **Step 3: The port module**

Create `components/agent-service/agent/sources.py`. The definitions, the query adapter and the two executors move VERBATIM from `agent/toolset.py` — same strings, same schemas, same branches, same comments where they state an invariant:

```python
# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The tool-source port — where a run's tools come from.

A source is a set of tools the deployment DECLARES. The core does not
compose them: the host names the sources a deployment runs and how they
are configured, and the core asks each of them for the tools it may
offer to ONE request.

The port's shape is the design's (§4.3), verbatim — the core's contract
with a source is ONE method:

    class ToolSource(Protocol):
        def tools(self, context, bearer) -> Sequence[tuple[ToolDefinition, ToolExecutor]]: ...

The deployment's facts about a source are DECLARED ON THE CORE'S CLASS
(``source_id``, ``served_tool_names`` — below), because this source is
the core's own product and its identity is stable; the PORT (the
protocol below) carries neither — a second source (``web_search``,
S3-plan-2) declares its own facts on its own class, and the port stays
source-agnostic. The HOST reads them off the concrete class when it
fills ``tool_catalog.DeclaredSource`` (§4.4): one WRITER of the facts
(the class that owns them), one READER (the host's record) — not two
homes that can disagree.

The identity travels with the CALL, never with the construction: the
source is built per request (the budget, the preparation leg and the
insufficiency recorder are the run's), and the caller's context and
bearer arrive with ``tools()``. The executor captures them there — the
narrowing travels in the context, never in the arguments, so nothing the
model contributes can widen the scope.
"""

import asyncio
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Annotated, Protocol

from pydantic import StringConstraints, TypeAdapter

from capabilities.contract import (
    CallerContext,
    DocumentCapabilityPort,
    OperationBudget,
    OperationName,
    OutcomeCode,
    PreparedQuery,
    QueryPreparationStatus,
    ReadSourceInput,
    SearchKnowledgeInput,
    SearchKnowledgeResult,
    SourceRef,
    TransientError,
)
from preparation.detection import detect_language
from preparation.prepare import QueryPreparer
from preparation.translation import TranslationInputTooLongError

from .registry import ToolDefinition, ToolExecutor

# The search query argument, validated on BOTH executor paths (probe and
# prepared): a missing, non-string or blank query is an argument the
# contract refuses — the SAME structured ``ValidationError`` the read
# executor's target validation raises, which the loop feeds back as the
# structured tool result instead of killing the run.
_QUERY_TEXT = TypeAdapter(Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)])

SEARCH_KNOWLEDGE_DEFINITION = ToolDefinition(
    name="search_knowledge",
    description=(
        "Search the authorized knowledge corpus. Returns ranked passages with their provenance, "
        "or an explicit insufficient-evidence outcome."
    ),
    parameters={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "The English search query."},
        },
        "required": ["query"],
    },
)

READ_SOURCE_DEFINITION = ToolDefinition(
    name="read_source",
    description=(
        "Read one source the search results pointed at. A legacy document is addressed by its "
        'file_id ("target": {"file_id": ...}); an OKF concept by repo_id and concept_id '
        '("target": {"repo_id": ..., "concept_id": ...}).'
    ),
    parameters={
        "type": "object",
        "properties": {
            "target": {
                "type": "object",
                "description": 'Either {"file_id": ...} or {"repo_id": ..., "concept_id": ...}.',
            },
        },
        "required": ["target"],
    },
)


@dataclass(frozen=True)
class ToolSourceContext:
    """What one request hands the sources it builds.

    The core owns the bundle: the caller's identity, the operation
    budget, the run's preparation entry and the run's two sinks (the
    preparation status and the insufficiency reason) are all the core's.
    The host builds the sources FROM the bundle — the host declares
    WHICH sources and HOW, the core owns WHAT one request carries.
    """

    context: CallerContext
    bearer: str | None
    operation_budget: OperationBudget
    preparer: QueryPreparer | None = None
    on_preparation_status: Callable[[str], None] | None = None
    abstention_sink: list[str] | None = None


class ToolSource(Protocol):
    """One declared source of tools.

    The design's §4.3 protocol, verbatim: ONE method, and the core reads
    only that method. The deployment's facts about a source — the id the
    catalog names it by, the tools it serves — are the HOST's (the host
    holds the catalog, and the host discovers a source's tools at
    startup), so the port does not declare them.
    """

    def tools(self, context: CallerContext, bearer: str | None) -> Sequence[tuple[ToolDefinition, ToolExecutor]]: ...


class DocumentToolSource:
    """The document source: the two document tools, unchanged.

    The two document tools, unchanged — the same definitions, the same
    executors, the same preparation leg and the same insufficiency
    recorder. What changes is WHERE the caller's
    identity enters: it arrives with ``tools()``, so the executor
    captures the context and the bearer of the CALL rather than the ones
    the source happened to be built with.

    ``budgets`` carries per-tool BOUND OVERRIDES — keyed by tool name,
    each one TIGHTENS the ceiling the source was built with (an
    override may never widen a bound); a tool without an override runs
    under ``operation_budget``. The core does not know where the map
    comes from — the host derives it (``tool_catalog``'s
    ``budget_overrides``) and hands it in.
    """

    source_id = "document"
    served_tool_names = frozenset({"search_knowledge", "read_source"})

    def __init__(
        self,
        port_factory: Callable[[CallerContext, str | None], DocumentCapabilityPort],
        operation_budget: OperationBudget,
        *,
        budgets: dict[str, OperationBudget] | None = None,
        preparer: QueryPreparer | None = None,
        on_preparation_status: Callable[[str], None] | None = None,
        abstention_sink: list[str] | None = None,
    ) -> None:
        self._port_factory = port_factory
        self._operation_budget = operation_budget
        self._budgets = budgets or {}
        self._preparer = preparer
        self._on_preparation_status = on_preparation_status
        self._abstention_sink = abstention_sink

    def _budget_for(self, name: str) -> OperationBudget:
        """One tool's bound: the catalog's override when it declares one,
        the deployment's ceiling otherwise."""
        return self._budgets.get(name, self._operation_budget)

    def tools(self, context: CallerContext, bearer: str | None) -> Sequence[tuple[ToolDefinition, ToolExecutor]]:
        """The two document tools, bound to THIS request's identity."""
        port = self._port_factory(context, bearer)
        return (
            (
                SEARCH_KNOWLEDGE_DEFINITION,
                _make_search_executor(
                    port,
                    context,
                    self._budget_for("search_knowledge"),
                    self._preparer,
                    self._on_preparation_status,
                    self._abstention_sink,
                ),
            ),
            (
                READ_SOURCE_DEFINITION,
                _make_read_executor(port, context, self._budget_for("read_source")),
            ),
        )


def _make_search_executor(
    port: DocumentCapabilityPort,
    context: CallerContext,
    budget: OperationBudget,
    preparer=None,
    on_preparation_status=None,
    abstention_sink=None,
):
    def _unprepared_envelope(status: QueryPreparationStatus) -> dict:
        """The contract's insufficiency answer for a query that could not be
        prepared (a fallback status, or the preparation bound timing out) —
        built through SearchKnowledgeResult, whose fields this mirrors field
        for field, so a contract change cannot leave this shape behind.
        model_construct (validation bypassed) is required for one field
        only: the contract narrows ``query_preparation_status`` to the
        PREPARED statuses (a SERVED result always had a prepared query),
        and this result carries the fallback status that says WHY nothing
        was served. The ledger classifies it as citing nothing, and the
        model sees an insufficiency it can react to."""
        if on_preparation_status is not None:
            on_preparation_status(status.value)
        return SearchKnowledgeResult.model_construct(
            outcome=OutcomeCode.INSUFFICIENT_EVIDENCE,
            hits=(),
            truncated=False,
            query_preparation_status=status,
        ).model_dump(mode="json")

    async def execute(arguments: dict) -> dict:
        # BOTH paths validate the argument the same way, BEFORE anything
        # runs: a missing, non-string or blank query raises the structured
        # ``ValidationError`` the loop feeds back as tool data — never a
        # TypeError that would kill the whole run.
        query_text = _QUERY_TEXT.validate_python(arguments.get("query"))
        if preparer is None:
            # No preparation wired (the probe path): the question is English
            # by construction, so no preparation call is needed.
            prepared = PreparedQuery(text=query_text, preparation_status=QueryPreparationStatus.PASSTHROUGH_ENGLISH)
        else:
            # The string IS the retrieval query (the preparation module's
            # single-message shape — every query the model writes is
            # prepared the same way). The QUERY's own language decides, not
            # the conversation's locale: the schema asks the model for an
            # English query, and a foreign-language hint would send that
            # English query through a translation pass that can reword it.
            # A model that echoes the user's language is translated. When
            # the detector cannot classify the query at all, the request's
            # locale (the preparer's own default) speaks for it — the
            # search the caller can still have (an English locale answers
            # passthrough_english: the locale establishes the English);
            # with no locale anywhere, the module's own unknown-language
            # status refuses it — no English is claimed that nothing
            # established, whose raw text would be embedded into the
            # English-only space with a prepared label.
            query_language = detect_language(query_text)
            # The call is BOUNDED at the dispatch's operation budget — its
            # own pieces only know the translation service's generous
            # timeout, and the run's wall clock is checked only BETWEEN
            # dispatches, so an unbounded preparation would stall this
            # dispatch (and the admission lane with it) for minutes on a
            # slow-but-alive endpoint.
            try:
                preparation = await asyncio.wait_for(
                    preparer.prepare(query_text, query_language), timeout=budget.timeout_ms / 1000
                )
            except TimeoutError:
                # Bounded, not dead: the honest tool answer is the fallback
                # insufficiency — the model can react (retry, reword), and
                # the run stays inside its budget.
                return _unprepared_envelope(QueryPreparationStatus.FALLBACK_TIMEOUT)
            except TranslationInputTooLongError as over_budget:
                # Same mistake surface as any other refused argument: a
                # structured CapabilityError the loop feeds back as tool
                # data (transient — retryable with a shorter query), never
                # a run-killing escape past the executor's catch.
                raise TransientError(
                    f"the query exceeds the translation budget ({over_budget})",
                    operation=OperationName.SEARCH_KNOWLEDGE,
                ) from over_budget
            if not preparation.prepared:
                return _unprepared_envelope(preparation.status)
            if on_preparation_status is not None:
                on_preparation_status(preparation.status.value)
            prepared = preparation.query
        # The dispatch records into a FRESH per-call list (the noagent
        # pipeline's exact shape); afterwards the run's list is kept at
        # THIS dispatch's reasons — cleared when the search recorded
        # nothing, so a later successful search after an insufficient hop
        # records no reason and the record never misattributes an earlier
        # hop's insufficiency onto a run that answered from later
        # evidence. The capability fires at most one reason per call.
        sink_reasons: list[str] = []
        result = await port.search_knowledge(
            context,
            SearchKnowledgeInput(query=prepared),
            budget,
            abstention_sink=sink_reasons.append if abstention_sink is not None else None,
        )
        if abstention_sink is not None:
            abstention_sink.clear()
            abstention_sink.extend(sink_reasons)
        return result.model_dump(mode="json")

    return execute


def _make_read_executor(port: DocumentCapabilityPort, context: CallerContext, budget: OperationBudget):
    _source_ref = TypeAdapter(SourceRef)

    async def execute(arguments: dict) -> dict:
        target = _source_ref.validate_python(arguments.get("target"))
        result = await port.read_source(context, ReadSourceInput(target=target), budget)
        return result.model_dump(mode="json")

    return execute
```

- [ ] **Step 4: The registry's builder**

In `components/agent-service/agent/registry.py`, add the builder next to the registry (the imports gain `Iterable` — from `collections.abc`, NOT `typing`: the repo's ruff selects `UP`, and `UP035` refuses `from typing import Iterable`):

```python
from collections.abc import Iterable


def build_registry(pairs: Iterable[tuple[ToolDefinition, ToolExecutor]]) -> ToolRegistry:
    """The registry of one run: the pairs the declared sources offered.

    One door, still: every pair goes through :meth:`ToolRegistry.register`,
    so a duplicate exposed name is refused exactly as it was when the
    orchestrator registered the tools itself. Each definition's
    ``parameters`` dict is COPIED at registration: the definitions are
    module-level constants now (built once, shared by every request), and
    ``ToolDefinition.parameters`` is a mutable dict — a copy at the door
    means one request cannot mutate what every request is told, and the
    wire stays a plain JSON-serializable dict.
    """
    registry = ToolRegistry()
    for definition, executor in pairs:
        copied = ToolDefinition(name=definition.name, description=definition.description, parameters=dict(definition.parameters))
        registry.register(copied, executor)
    return registry
```

- [ ] **Step 5: The orchestrator's assembly**

In `components/agent-service/agent/orchestrator.py`, replace the import and the registry build:

```python
from .registry import build_registry
from .sources import DocumentToolSource
```

```python
            registry = build_registry(
                DocumentToolSource(
                    self._port_factory,
                    self._config.operation_budget,
                    preparer=preparer,
                    on_preparation_status=preparation_statuses.append,
                    abstention_sink=abstention_reasons,
                ).tools(request.context, request.bearer)
            )
```

(The source is built per request because the budget, the preparer and the sinks are the run's. Task 3 replaces this composition with the host's declared sources — until then the core still names the document source, which is the state the branch is in today.)

- [ ] **Step 6: The probe**

In `components/agent-service/measurement/probe.py`, the registry becomes:

```python
    registry = build_registry(DocumentToolSource(lambda _context, _bearer: port, operation_budget).tools(context, None))
```

with the import changed to `from agent.sources import DocumentToolSource` and `from agent.registry import build_registry`.

- [ ] **Step 7: The package's exports, and the old module's end**

In `components/agent-service/agent/__init__.py`, replace `from .toolset import document_toolset` with:

```python
from .sources import DocumentToolSource, ToolSource, ToolSourceContext
```

- the RENAMED suite's own prose is rewritten with the move — its module docstring ("the registered toolset lives in ``agent.toolset`` and the probe RE-IMPORTS it") and the section banner ("The toolset home: the registered toolset left the probe module") both name the module this plan deletes, and the probe no longer re-exports a builder at all. They become:

  ```python
  """The production document source and the preparation leg in the governed run.

  Mutation-sensitive pins: the registered toolset is built over
  ``agent.sources``' source and the suites reach the shared helper in
  ``conftest`` (the probe does NOT re-export a builder);
  ```

  ```python
  # ---------------------------------------------------------------------
  # The document source: the registered toolset left the probe module
  # ---------------------------------------------------------------------
  ```

and in `__all__`, replace `"document_toolset"` with `"DocumentToolSource"`, `"ToolSource"`, `"ToolSourceContext"`. The list is GROUPED (constants → classes → functions), so the three class names take their class places: `DocumentToolSource` after `CancellationToken`; `ToolSource` and `ToolSourceContext` after `ToolRegistry`, before `UnregisteredToolError`.

The module's own docstring names the module it documents: "the registered toolset (:mod:`.toolset`)" becomes "the tool sources (:mod:`.sources`)" — a Sphinx reference to a deleted module dangles, and the package docstring is the first thing a reader sees.

Delete `components/agent-service/agent/toolset.py` — its content moved, unchanged, into `agent/sources.py`.

**The TWO records that name the deleted module.** `docs/adr/agentic-009-the-core-knows-nothing-of-the-outside.md` names it once — in the paragraph "The measurement surface owns its own tool contract", where the product's declarations live at `agent/toolset.py` (the matrix's live with the matrix, `measurement/v06_harness.py`). That path becomes `agent/sources.py`.

`docs/adr/agentic-005-tool-sources-and-mcp-consumption.md` points at it twice — its Context ("the agentic path registers two document tools in `document_toolset` (`components/agent-service/agent/toolset.py`)") and its References line. Both follow the move:

```markdown
The agentic path registers two document tools behind the `ToolSource` port
(`components/agent-service/agent/sources.py`).
```

and in the References, `components/agent-service/agent/toolset.py` becomes `components/agent-service/agent/sources.py`.

**The suites that imported the old builder.** SEVEN files import it today — three in the service (`measurement/probe.py`, `agent/orchestrator.py`, `agent/__init__.py`, covered by Steps 5, 6 and the package's exports) and the four suites in the table below. Deleting the module breaks all seven at once — which is why the change belongs here rather than at the gate, where the breakage would look like a defect:

| file | the import | becomes |
|---|---|---|
| `tests/conftest.py` | `from agent.toolset import document_toolset` | `from agent.sources import DocumentToolSource` + `from agent.registry import build_registry` — it hosts the shared helper |
| `tests/test_agent_loop.py` | `from measurement.probe import PROBE_OPERATION_BUDGET, document_toolset` | `from measurement.probe import PROBE_OPERATION_BUDGET` + `document_registry` ADDED to the EXISTING `from conftest import (…)` block (lowercase group, after `canned_search_result`) — NO second `from conftest` statement |
| `tests/test_agent_probe.py` | `document_toolset` (in the `measurement.probe` import block) | `document_registry` ADDED to the EXISTING `from conftest import (…)` block (lowercase group, after `canned_search_result`) — NO second `from conftest` statement |
| `tests/test_agent_sources.py` (the renamed file) | `from agent.toolset import document_toolset` | `from agent.sources import DocumentToolSource` + `from agent.registry import build_registry` (first-party group: `agent.registry` BEFORE `agent.sources`, both after `agent.runtime`) + `document_registry` ADDED to the EXISTING `from conftest import (…)` block (the lowercase group, after `canned_search_result`) — NO second `from conftest` statement |

The probe's COMMENT is rewritten in the same commit — it names `:mod:`agent.toolset`` and "the builder", and both are gone with the move (the probe imports the SOURCE and the registry builder; the suites reach the shared helper in `tests/conftest.py`):

```python
# The document source is a production surface, not a probe artifact — it
# lives in :mod:`agent.sources`; the probe imports the source and the
# registry builder, and the suites reach the shared helper in
# `tests/conftest.py`.
```

The probe no longer re-exports a builder: `measurement/probe.py` imports `DocumentToolSource` and `build_registry` now, so `measurement.probe.document_toolset` is gone — the suites that reached for it through the probe reach for the shared helper instead.

**The suites' wiring lives in the shared home** (`tests/conftest.py`) — TWO helpers: `document_registry` (the one Step 1 declared) and `document_source_factory` (Task 3, below — the orchestrator now takes a factory, so the suites need its builder too):

```python
def document_registry(port, context, budget=None, **wiring):
    """The registry the document source offers, over one port.

    ONE helper for the suites: the source builds its pairs per call and
    the registry is the authorization surface. Every suite that used the
    old builder calls this — a copy of the wiring in each suite is a copy
    that drifts.
    """
    budget = budget if budget is not None else orchestrator_config().operation_budget
    source = DocumentToolSource(lambda _context, _bearer: port, budget, **wiring)
    return build_registry(source.tools(context, None))
```

and the call sites change shape — the old `document_toolset(port, CONTEXT, budget, preparer=preparer)` becomes `document_registry(port, CONTEXT, budget, preparer=preparer)`:

- `tests/conftest.py` (the `LoopRunner` fixture): `document_registry(port, GOVERNED_CONTEXT, PROBE_OPERATION_BUDGET)`.
- `tests/test_agent_loop.py` (four call sites): each site keeps the shape IT has today — three are `document_registry(_port(), PROBE_CONTEXT, PROBE_OPERATION_BUDGET)`, one carries the today-guard (`port if port is not None else _port()`) and becomes `document_registry(port if port is not None else _port(), PROBE_CONTEXT, PROBE_OPERATION_BUDGET)`, and the one that wires a preparer keeps it: `document_registry(port, PROBE_CONTEXT, PROBE_OPERATION_BUDGET, preparer=preparer)`.
- `tests/test_agent_probe.py` (five call sites): `document_registry(_port(), PROBE_CONTEXT, PROBE_OPERATION_BUDGET)`.
- `tests/test_agent_sources.py`: the plan's own helper is the shared one — the renamed suite imports `document_registry` from `conftest` instead of keeping a local copy.

The renamed suite's `import agent.toolset` (the module pin) becomes `import agent.sources`.

- [ ] **Step 8: The gate compares**

Run:

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/s3-tool-sources ] || { echo "not in the checkout that carries feat/agentic-foundations/s3-tool-sources"; exit 1; }
cd components/agent-service
/tmp/genie-agent-service-venv/bin/python -m pytest tests/ -q
```

Expected: the suite is green, and the gate test reports the stream IDENTICAL to the recorded fixture. The equivalence suite (`tests/test_equivalence_v02.py`) is green and untouched. A difference in the stream is a STOP: the move changed something it was not supposed to change.

- [ ] **Step 9: Lint**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/s3-tool-sources ] || { echo "not in the checkout that carries feat/agentic-foundations/s3-tool-sources"; exit 1; }
cd components/agent-service
uvx ruff@0.16.3 check --no-cache app.py tracing.py lane.py assembly.py capabilities/ preparation/ noagent/ agent/ measurement/ tests/
uvx ruff@0.16.3 format --no-cache --check app.py tracing.py lane.py assembly.py capabilities/ preparation/ noagent/ agent/ measurement/ tests/
```

Expected: both commands are silent (no findings, no reformatting needed).

- [ ] **Step 10: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/s3-tool-sources ] || { echo "not in the checkout that carries feat/agentic-foundations/s3-tool-sources"; exit 1; }
git add components/agent-service/agent components/agent-service/measurement components/agent-service/tests docs/adr/agentic-005-tool-sources-and-mcp-consumption.md docs/adr/agentic-009-the-core-knows-nothing-of-the-outside.md
git commit -m "refactor(agent-service): the document tools become a source behind a port"
```

---

### Task 2: The catalog — the deployment file, the loader and the startup validation

**Files:**
- Create: `components/agent-service/tool_catalog.py` (the HOST module — the service root, beside `assembly.py`)
- Create: `configs/agent/tool-catalog.json` (the deployment file)
- Create: `components/agent-service/tests/test_tool_catalog.py`
- Modify: `components/agent-service/tests/test_architecture.py` (the host layout gains `tool_catalog`)
- Modify: `components/agent-service/Dockerfile` (the image carries the module)

**Interfaces:**
- Consumes: `agent.sources.DocumentToolSource` (its `source_id` and `served_tool_names`); `capabilities.contract.OperationBudget`.
- Produces:
  - `tool_catalog.CatalogError(ValueError)` — the catalog is unusable; the run surface maps it to the honest 503.
  - `tool_catalog.CatalogEntry` — one validated entry (the file's shape).
  - `tool_catalog.ToolCatalog` — the validated catalog: `entries`, `entry(name)`. (There is no `allows(name)`: the factory reads the ENTRY and its `allow` flag, because it also needs that entry's `source` — a second accessor for one field would be a second way to ask the same question.)
  - `tool_catalog.DeclaredSource` — the HOST's record of one source a deployment runs: `source_id`, `served_tool_names`, `build` (the per-request builder). The deployment's facts about a source live here, not on the port.
  - `tool_catalog.budget_overrides(catalog) -> dict[str, OperationBudget]` — the per-tool budgets the catalog declares, for the host's source builders.
  - `tool_catalog.load_catalog(path, *, served_names, ceiling) -> ToolCatalog` — the loader and the startup validation.

- [ ] **Step 1: The failing test — the catalog's startup rules**

Create `components/agent-service/tests/test_tool_catalog.py`. The suite writes its own catalogs into `tmp_path` (the rules are about what the loader accepts, not about one shipped file) and pins the shipped file separately.

```python
# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The tool catalog — the deployment file's rules.

The catalog is the deployment's answer to "what may a run call": a tool
it does not name is neither listed to the model nor dispatchable, a
duplicate exposed name is a startup error, and a catalogued tool a
source does not serve is a startup warning and an absent tool.

These pins are about the LOADER's verdicts, so a mutation that turns a
refusal into a pass — or a warning into silence — turns them red.
"""

import json
import logging
from pathlib import Path

import pytest

from capabilities.contract import CallerContext, OperationBudget
from tool_catalog import CatalogError, load_catalog

CEILING = OperationBudget(timeout_ms=30000, max_results=10, max_result_bytes=262144)
SERVED = {"document": frozenset({"search_knowledge", "read_source"})}
# The caller's context the filter's pins run under — the same shape the
# suites use everywhere else (a public caller over the legacy graph).
CONTEXT = CallerContext(user_id="u-1", authorized_graph_names=("GRAPH",))


def _entry(name="search_knowledge", **overrides):
    entry = {
        "name": name,
        "source": "document",
        "server": None,
        "tool": None,
        "allow": True,
        "risk": "read",
        "requires_approval": False,
        "egress": "internal",
        "scopes": [],
    }
    entry.update(overrides)
    return entry


def _write(tmp_path, tools, version=1):
    path = tmp_path / "tool-catalog.json"
    path.write_text(json.dumps({"version": version, "tools": tools}), encoding="utf-8")
    return path


def test_the_shipped_catalog_carries_the_two_document_tools():
    shipped = json.loads((Path(__file__).resolve().parents[3] / "configs" / "agent" / "tool-catalog.json").read_text())
    assert shipped["version"] == 1
    assert sorted(entry["name"] for entry in shipped["tools"]) == ["read_source", "search_knowledge"]
    for entry in shipped["tools"]:
        assert entry["source"] == "document"
        assert entry["allow"] is True
        assert entry["risk"] == "read"
        assert entry["requires_approval"] is False
        assert entry["egress"] == "internal"
        assert entry["scopes"] == []


def test_a_duplicate_exposed_name_is_a_startup_error(tmp_path):
    path = _write(tmp_path, [_entry(name="search_knowledge"), _entry(name="search_knowledge")])
    with pytest.raises(CatalogError) as refusal:
        load_catalog(path, served_names=SERVED, ceiling=CEILING)
    assert "search_knowledge" in str(refusal.value)
    assert "twice" in str(refusal.value)


def test_an_entry_naming_an_undeclared_source_is_refused_and_the_catalog_still_loads(tmp_path, caplog):
    path = _write(tmp_path, [_entry(name="search_knowledge", source="web"), _entry(name="read_source")])
    with caplog.at_level(logging.ERROR):
        catalog = load_catalog(path, served_names=SERVED, ceiling=CEILING)
    assert "web" in caplog.text
    # The refused entry is ABSENT (the tool can never reach a run), and
    # the rest of the catalog still loads — one mis-declared entry does
    # not take the whole run surface down.
    assert catalog.entry("search_knowledge") is None
    assert catalog.entry("read_source") is not None


def test_a_catalogued_tool_the_source_does_not_serve_is_a_warning(tmp_path, caplog):
    path = _write(tmp_path, [_entry(name="search_knowledge"), _entry(name="other_tool")])
    with caplog.at_level(logging.WARNING):
        catalog = load_catalog(path, served_names=SERVED, ceiling=CEILING)
    assert "other_tool" in caplog.text
    assert "does not serve" in caplog.text
    # The entry is carried (the deployment declared it) but the source
    # never offers it, so it can never reach a run.
    assert catalog.entry("other_tool") is not None
    assert catalog.entry("other_tool").source == "document"


def test_a_catalog_above_the_entry_bound_is_refused_whole(tmp_path):
    """Every declared tool is told to the model on every call: the file
    that declares them is BOUNDED (spec §13.3), and a file above the
    bound is a startup error, not a silently larger prompt."""
    entries = [{"source": "document", "name": f"tool-{i}"} for i in range(MAX_CATALOG_ENTRIES + 1)]
    path = tmp_path / "too-many.json"
    path.write_text(json.dumps({"version": 1, "tools": entries}), encoding="utf-8")
    with pytest.raises(CatalogError):
        load_catalog(
            path,
            served_names={"document": frozenset({"tool-0"})},
            ceiling=CEILING,
        )


def test_a_required_scope_is_refused_until_the_identity_slice_lands(tmp_path, caplog):
    path = _write(tmp_path, [_entry(name="search_knowledge", scopes=["okf:tenant:repo:read"])])
    with caplog.at_level(logging.ERROR):
        catalog = load_catalog(path, served_names=SERVED, ceiling=CEILING)
    assert "scope" in caplog.text.lower()
    assert catalog.entry("search_knowledge") is None


def test_a_write_tool_is_refused_until_the_approval_path_lands(tmp_path, caplog):
    path = _write(tmp_path, [_entry(name="search_knowledge", risk="write", requires_approval=True)])
    with caplog.at_level(logging.ERROR):
        catalog = load_catalog(path, served_names=SERVED, ceiling=CEILING)
    assert "approval" in caplog.text.lower()
    assert catalog.entry("search_knowledge") is None


def test_an_open_web_egress_is_refused_until_the_pii_egress_lands(tmp_path, caplog):
    path = _write(tmp_path, [_entry(name="search_knowledge", egress="open_web")])
    with caplog.at_level(logging.ERROR):
        catalog = load_catalog(path, served_names=SERVED, ceiling=CEILING)
    assert "egress" in caplog.text.lower()
    assert catalog.entry("search_knowledge") is None


def test_a_server_scoped_entry_is_refused_while_no_mcp_source_is_deployed(tmp_path, caplog):
    path = _write(tmp_path, [_entry(name="search_knowledge", server="govstack-auth", tool="list_users")])
    with caplog.at_level(logging.ERROR):
        catalog = load_catalog(path, served_names=SERVED, ceiling=CEILING)
    assert "server" in caplog.text.lower()
    assert catalog.entry("search_knowledge") is None


def test_a_budget_above_the_ceiling_refuses_the_entry(tmp_path, caplog):
    """The Decision's one rule, at the budget dimension: a budget that
    would widen the ceiling refuses the ENTRY (the loud startup ERROR,
    the tool absent), NOT the catalog — the whole-file failure stays the
    duplicate's alone."""
    import logging

    path = _write(
        tmp_path,
        [_entry(name="search_knowledge", budget={"timeout_ms": 60000, "max_results": 10, "max_result_bytes": 262144})],
    )
    with caplog.at_level(logging.ERROR, logger="tool_catalog"):
        catalog = load_catalog(path, served_names=SERVED, ceiling=CEILING)
    assert catalog.entries == ()  # the entry is absent
    assert "timeout_ms" in caplog.text and "never widen" in caplog.text


def test_a_budget_below_the_ceiling_is_carried(tmp_path):
    path = _write(
        tmp_path,
        [_entry(name="search_knowledge", budget={"timeout_ms": 1000, "max_results": 3, "max_result_bytes": 1024})],
    )
    catalog = load_catalog(path, served_names=SERVED, ceiling=CEILING)
    assert catalog.entry("search_knowledge").budget.timeout_ms == 1000


def test_a_missing_file_is_a_startup_error(tmp_path):
    with pytest.raises(CatalogError) as refusal:
        load_catalog(tmp_path / "absent.json", served_names=SERVED, ceiling=CEILING)
    assert "missing" in str(refusal.value)


def test_a_broken_file_is_a_startup_error(tmp_path):
    path = tmp_path / "tool-catalog.json"
    path.write_text("{not json", encoding="utf-8")
    with pytest.raises(CatalogError) as refusal:
        load_catalog(path, served_names=SERVED, ceiling=CEILING)
    assert "JSON" in str(refusal.value)
```

(The suite's `Path` import is `from pathlib import Path`; the shipped file's path is three levels up from `tests/` — `components/agent-service/tests/` → the repository root is `parents[3]`.)

- [ ] **Step 2: Run the suite and watch it fail**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/s3-tool-sources ] || { echo "not in the checkout that carries feat/agentic-foundations/s3-tool-sources"; exit 1; }
cd components/agent-service
/tmp/genie-agent-service-venv/bin/python -m pytest tests/test_tool_catalog.py -q
```

Expected: the collection FAILS — `tool_catalog` does not exist yet.

- [ ] **Step 3: The host's catalog module**

Create `components/agent-service/tool_catalog.py`:

```python
# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The tool catalog — the deployment file that decides what a run may call.

The catalog is STATIC and DEPLOYMENT-OWNED: a JSON file under the
repository's ``configs/`` home, read by the HOST at assembly. The core
never learns what a catalog is — the host loads it, validates it, and
offers the run only the pairs the catalog allows.

The rules (the design's §4.4):

* a tool absent from the catalog is neither listed to the model nor
  dispatchable — the host does not offer the pair, so the registry never
  carries it;
* a duplicate exposed name is a startup error;
* a catalogued tool a source does not serve is a startup warning and an
  absent tool.

Everything the catalog declares that this deployment cannot HONOUR is
refused at startup rather than ignored: a required scope (the
enforcement lands with the identity slice), a write risk or an approval
(no approval path yet), an open-web egress (no PII egress path yet). A
catalog that declared one of those and was silently unenforced would be
a lie the deployment believes.
"""

import json
import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from agent.sources import ToolSource, ToolSourceContext
from capabilities.contract import OperationBudget

logger = logging.getLogger(__name__)

RISK_READ = "read"
RISK_WRITE = "write"
EGRESS_INTERNAL = "internal"
EGRESS_OPEN_WEB = "open_web"


class CatalogError(ValueError):
    """The catalog is unusable — the deployment cannot serve a run.

    A ``ValueError`` on purpose: the run surface maps an assembly
    ``ValueError`` to the honest 503 (``run_surface_unconfigured``) that
    names what is missing, so a broken catalog is refused with the same
    shape as a missing knob — never a registry that quietly serves the
    wrong tools.
    """


# One budget model, not two: the entry's ``budget`` field is
# ``OperationBudget`` itself — the contract's own type, already imported
# here — so the same three fields carry the same validation in one home,
# and ``budget_overrides`` hands the value through without a conversion
# that could drift. A second model with identical fields would be the
# "a copy that drifts" pattern this plan warns about elsewhere.


MAX_CATALOG_ENTRIES = 16
"""The catalog's entry bound (spec §13.3). Sixteen is generous for the
tools a run surface declares today (two); the point is the CEILING's
existence, not the number — a slice that adds tools raises it in the
same commit that measures the budget impact."""


class CatalogEntry(BaseModel):
    """One entry: the shape the deployment file carries."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    source: str = Field(min_length=1)
    server: str | None = None
    tool: str | None = None
    allow: bool = True
    risk: Literal["read", "write"] = RISK_READ
    requires_approval: bool = False
    egress: Literal["internal", "open_web"] = EGRESS_INTERNAL
    scopes: tuple[str, ...] = ()
    budget: OperationBudget | None = None


class CatalogDocument(BaseModel):
    """The file's shape: a version and the entries.

    BOUNDED (spec §13.3: "count them in the budget tests; bound the
    catalog"): an entry is one tool the model is TOLD about, and every
    told tool costs prompt space on every model call. A file declaring
    more than :data:`MAX_CATALOG_ENTRIES` is refused whole — an
    unbounded catalog is a deployment file that can silently grow the
    prompt budget past what the run budget reserved.
    """

    tools: tuple[CatalogEntry, ...] = Field(max_length=MAX_CATALOG_ENTRIES)

    model_config = ConfigDict(extra="forbid", frozen=True)

    version: Literal[1] = 1
    tools: tuple[CatalogEntry, ...]


@dataclass(frozen=True)
class DeclaredSource:
    """One source a deployment runs, as the HOST declares it.

    The port (``agent.sources.ToolSource``) carries ONE method — the
    design's §4.3 protocol — and the deployment's facts about a source
    live HERE: the id the catalog's ``source`` field names it by, and the
    tools it serves. A DECLARED set (the document source's two tools) and
    a DISCOVERED one (the MCP source's startup discovery — §4.4) reach
    the catalog the same way.

    ``build`` is the per-request builder: the source is built per request
    because the budget, the preparation leg and the sinks are the run's.
    """

    source_id: str
    served_tool_names: frozenset[str]
    build: Callable[[ToolSourceContext], ToolSource]


class ToolCatalog:
    """The validated catalog: what a run may call."""

    def __init__(self, entries: tuple[CatalogEntry, ...]) -> None:
        self._entries = entries
        self._by_name = {entry.name: entry for entry in entries}

    @property
    def entries(self) -> tuple[CatalogEntry, ...]:
        return self._entries

    def entry(self, name: str) -> CatalogEntry | None:
        """The entry the catalog carries for ``name``, or ``None``."""
        return self._by_name.get(name)


def load_catalog(
    path: str | Path,
    *,
    served_names: Mapping[str, frozenset[str]],
    ceiling: OperationBudget,
) -> ToolCatalog:
    """The catalog at ``path``, validated against the declared sources.

    ``served_names`` maps every declared source's id to the names it
    serves — the host's declaration. ``ceiling`` is the deployment's
    budget ceiling: an entry's budget may TIGHTEN it, never widen it.

    Raises :class:`CatalogError` for the defects that fail the whole
    file: a duplicate exposed name (the model would see an ambiguity), a
    budget above the ceiling, a file that is missing, unreadable or not
    the declared shape.

    An entry THIS DEPLOYMENT cannot serve — an undeclared source, a
    server-scoped tool, a required scope, a write, an approval, an
    open-web egress — costs the ENTRY, not the catalog: a loud startup
    ERROR names it and the tool is absent. The catalog still loads, and
    the deployment's other tools keep working.

    A catalogued tool a declared source does not serve is a WARNING and
    an absent tool.
    """
    location = Path(path)
    try:
        raw = json.loads(location.read_text(encoding="utf-8"))
    except FileNotFoundError as missing:
        raise CatalogError(
            f"the tool catalog {location} is missing: the run surface declares no tool without it"
        ) from missing
    except (OSError, json.JSONDecodeError) as broken:
        raise CatalogError(f"the tool catalog {location} is not readable JSON: {broken}") from broken
    try:
        document = CatalogDocument.model_validate(raw)
    except ValidationError as invalid:
        raise CatalogError(f"the tool catalog {location} does not carry the declared shape: {invalid}") from invalid

    seen: set[str] = set()
    usable: list[CatalogEntry] = []
    for entry in document.tools:
        if entry.name in seen:
            raise CatalogError(
                f"the tool catalog {location} declares {entry.name!r} twice: "
                "a duplicate exposed name is a startup error"
            )
        seen.add(entry.name)
        refusal = _refusal(entry, served_names)
        if refusal is None and entry.budget is not None:
            refusal = _check_budget(entry, ceiling)
        if refusal is not None:
            # The ENTRY is refused, not the catalog: the tool is absent
            # (never listed, never dispatchable), and the rest of the
            # deployment's tools keep working. One mis-declared entry does
            # not take the whole run surface down — a budget that would
            # widen the ceiling included (the Decision's one rule; the
            # whole-file failure stays the DUPLICATE's alone).
            logger.error(
                "the tool catalog %s declares %r: %s — the entry is refused and the tool is absent",
                location,
                entry.name,
                refusal,
            )
            continue
        usable.append(entry)
        if entry.name not in served_names[entry.source]:
            logger.warning(
                "the tool catalog %s declares %r, which the source %r does not serve: the tool is absent",
                location,
                entry.name,
                entry.source,
            )
    return ToolCatalog(tuple(usable))


def _refusal(entry: CatalogEntry, served_names: Mapping[str, frozenset[str]]) -> str | None:
    """Why this entry cannot be served HERE, or ``None`` when it can.

    Every reason is a fact about THIS deployment's capabilities, not about
    the file's shape: an entry that names a source this deployment does
    not declare, a server-scoped tool (no MCP source yet), a required
    scope (the enforcement lands with the identity slice), a write or an
    approval (no approval path yet), an open-web egress (no PII egress
    path yet). The tool is ABSENT rather than served unenforced.
    """
    if entry.source not in served_names:
        return (
            f"it names the source {entry.source!r}, which this deployment does not declare "
            f"(declared: {', '.join(sorted(served_names))})"
        )
    if entry.server is not None or entry.tool is not None:
        return "it is a server-scoped tool: no MCP source is deployed yet"
    if entry.scopes:
        return (
            f"it requires scopes ({', '.join(entry.scopes)}): the identity slice that enforces them "
            "has not landed, and a scope that reads as enforced would be a lie"
        )
    if entry.risk == RISK_WRITE or entry.requires_approval:
        return "it is a write or an approval tool: no approval path is deployed yet"
    if entry.egress == EGRESS_OPEN_WEB:
        return "it has an open-web egress: no PII egress path is deployed yet"
    return None


def _check_budget(entry: CatalogEntry, ceiling: OperationBudget) -> str | None:
    """The catalog may TIGHTEN the deployment's budget, never widen it.

    The refusal is the ENTRY's (the Decision's one rule): a tool whose
    budget would widen the ceiling is a tool this deployment must not
    serve — it is refused with the loud startup ERROR and stays absent,
    like every other per-entry refusal. The whole-file failure stays the
    DUPLICATE's alone: two tools behind one name is the file's own
    defect; a too-wide budget names one entry.
    """
    declared = entry.budget
    for dimension, value, limit in (
        ("timeout_ms", declared.timeout_ms, ceiling.timeout_ms),
        ("max_results", declared.max_results, ceiling.max_results),
        ("max_result_bytes", declared.max_result_bytes, ceiling.max_result_bytes),
    ):
        if value > limit:
            return (
                f"its budget declares {dimension}={value}, above the deployment's ceiling "
                f"{limit}: the catalog may tighten a budget, never widen it"
            )
    return None


def budget_overrides(catalog: ToolCatalog) -> dict[str, OperationBudget]:
    """The per-tool budgets the catalog declares — each one already
    validated against the deployment's ceiling.

    PUBLIC: the host declares the sources, and a declared source's
    builder needs the budgets the catalog declares for it. One reader, so
    the host cannot read them differently. The entry's ``budget`` IS an
    ``OperationBudget`` (one model, no conversion), so the value hands
    through untouched.
    """
    return {entry.name: entry.budget for entry in catalog.entries if entry.budget is not None}
```

- [ ] **Step 4: The shipped catalog**

Create `configs/agent/tool-catalog.json` — the deployment's answer for the tools this stack serves:

```json
{
  "version": 1,
  "tools": [
    {
      "name": "search_knowledge",
      "source": "document",
      "server": null,
      "tool": null,
      "allow": true,
      "risk": "read",
      "requires_approval": false,
      "egress": "internal",
      "scopes": []
    },
    {
      "name": "read_source",
      "source": "document",
      "server": null,
      "tool": null,
      "allow": true,
      "risk": "read",
      "requires_approval": false,
      "egress": "internal",
      "scopes": []
    }
  ]
}
```

No entry carries a `budget`: the deployment's `AGENT_TOOL_*` knobs are the ceiling, and an entry inherits it until it tightens one.

- [ ] **Step 5: The layer and the image**

The catalog module is a HOST module (it reads the filesystem and composes the deployment's sources), so it joins the host in the architecture rules — in `components/agent-service/tests/test_architecture.py`, the SERVICE layout's host tuple (the one at the top of the file, `SERVICE_LAYOUT = Layout(...)`) changes from:

```python
    host=("app", "tracing", "lane", "assembly"),
```

to:

```python
    host=("app", "tracing", "lane", "assembly", "tool_catalog"),
```

**That tuple appears TWICE in the file, and only the first one changes.** The second occurrence is the SYNTHETIC layout inside `test_the_rules_go_red_on_a_planted_violation` — the planted package the rule checks itself against, which has no `tool_catalog` module. Changing that one too makes the rule look for a module the fake package does not carry, and the architecture test fails with `ModuleUnknown: 'fakepkg.tool_catalog' was not found in the dependency graph`. (Found by replaying the plan's own code blocks against a scratch tree.)

and the image must carry it — `components/agent-service/Dockerfile`:

```dockerfile
COPY app.py tracing.py lane.py assembly.py tool_catalog.py ./
```

- [ ] **Step 6: Run the suites — they are green**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/s3-tool-sources ] || { echo "not in the checkout that carries feat/agentic-foundations/s3-tool-sources"; exit 1; }
cd components/agent-service
/tmp/genie-agent-service-venv/bin/python -m pytest tests/ -q
```

Expected: the suite is green — including the new catalog rules and the architecture rules (the new module belongs to a layer). The event-stream gate is untouched by this task and stays byte-identical.

- [ ] **Step 7: Lint**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/s3-tool-sources ] || { echo "not in the checkout that carries feat/agentic-foundations/s3-tool-sources"; exit 1; }
cd components/agent-service
uvx ruff@0.16.3 check --no-cache app.py tracing.py lane.py assembly.py tool_catalog.py capabilities/ preparation/ noagent/ agent/ measurement/ tests/
uvx ruff@0.16.3 format --no-cache --check app.py tracing.py lane.py assembly.py tool_catalog.py capabilities/ preparation/ noagent/ agent/ measurement/ tests/
```

Expected: both commands are silent.

- [ ] **Step 8: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/s3-tool-sources ] || { echo "not in the checkout that carries feat/agentic-foundations/s3-tool-sources"; exit 1; }
git add components/agent-service configs/agent
git commit -m "feat(agent-service): the tool catalog — the deployment file that decides what a run may call"
```

---

### Task 3: The assembly — the run's registry comes from the declared sources

**Files:**
- Modify: `components/agent-service/tool_catalog.py` (the per-request filter and the host's factory)
- Modify: `components/agent-service/agent/orchestrator.py` (the factory parameter; the bundle)
- Modify: `components/agent-service/app.py` (the knob, the catalog, the factory)
- Modify: `components/agent-service/tests/test_tool_catalog.py` (the filter's pins)
- Modify: `components/agent-service/tests/conftest.py` (the suite's declaration of the document source)
- Modify: `components/agent-service/tests/test_event_stream_gate.py` (the CONSTRUCTION line only)
- Modify: `components/agent-service/tests/test_agent_orchestrator.py`, `tests/test_app_runs.py`, `tests/test_version_record.py`, `tests/test_agent_sources.py` (the orchestrator's construction)

**Interfaces:**
- Consumes: `sources.ToolSourceContext`, `sources.DocumentToolSource` (Task 1); `tool_catalog.load_catalog`, `ToolCatalog`, `DeclaredSource`, `budget_overrides` (Task 2).
- Produces:
  - `tool_catalog.build_tool_source_factory(*, catalog, declared_sources) -> Callable[[ToolSourceContext], tuple[tuple[ToolDefinition, ToolExecutor], ...]]` — the HOST's per-request factory: the declared sources, filtered by the catalog.
  - `orchestrator.RequestOrchestrator(..., tool_source_factory=..., ...)` — the orchestrator takes the sources from the host instead of composing them.

- [ ] **Step 1: The failing test — the catalog gates what a run may call**

Add to `components/agent-service/tests/test_tool_catalog.py` the pins of the FILTER (the loader's verdicts are Task 2's; these are the RUN's):

```python
def _bundle(context=CONTEXT):
    return ToolSourceContext(
        context=context,
        bearer=None,
        operation_budget=CEILING,
    )


def _declared(catalog, port):
    """The suite's declaration of the document source — the host's shape."""
    return (
        DeclaredSource(
            source_id=DocumentToolSource.source_id,
            served_tool_names=DocumentToolSource.served_tool_names,
            build=lambda bundle: DocumentToolSource(
                lambda _context, _bearer: port,
                bundle.operation_budget,
                budgets=budget_overrides(catalog),
                preparer=bundle.preparer,
                on_preparation_status=bundle.on_preparation_status,
                abstention_sink=bundle.abstention_sink,
            ),
        ),
    )


def _registry(catalog, port):
    factory = build_tool_source_factory(catalog=catalog, declared_sources=_declared(catalog, port))
    return build_registry(factory(_bundle()))


def test_a_tool_the_catalog_does_not_name_is_neither_listed_nor_dispatchable(tmp_path):
    catalog = load_catalog(_write(tmp_path, [_entry(name="read_source")]), served_names=SERVED, ceiling=CEILING)
    port = AgentFakePort(search_result=canned_search_result())
    registry = _registry(catalog, port)

    assert registry.names() == ("read_source",)
    assert [definition["function"]["name"] for definition in registry.definitions()] == ["read_source"]
    with pytest.raises(UnregisteredToolError):
        asyncio.run(registry.dispatch("search_knowledge", {"query": "the model query"}))


def test_a_tool_the_catalog_switches_off_is_neither_listed_nor_dispatchable(tmp_path):
    catalog = load_catalog(
        _write(tmp_path, [_entry(name="search_knowledge", allow=False), _entry(name="read_source")]),
        served_names=SERVED,
        ceiling=CEILING,
    )
    registry = _registry(catalog, AgentFakePort(search_result=canned_search_result()))

    assert registry.names() == ("read_source",)
    with pytest.raises(UnregisteredToolError):
        asyncio.run(registry.dispatch("search_knowledge", {"query": "the model query"}))


def test_a_tool_the_catalog_names_on_another_source_is_not_offered(tmp_path):
    # The catalog names ``read_source`` on the OTHER declared source, so
    # the document source's pair is not the catalogued one and must not be
    # offered (the source that serves it is not deployed yet).
    catalog = load_catalog(
        _write(
            tmp_path,
            [_entry(name="search_knowledge", source="document"), _entry(name="read_source", source="web")],
        ),
        served_names={"document": SERVED["document"], "web": frozenset()},
        ceiling=CEILING,
    )
    registry = _registry(catalog, AgentFakePort(search_result=canned_search_result()))

    assert registry.names() == ("search_knowledge",)


def test_a_catalogued_budget_is_the_one_the_executor_runs_under(tmp_path):
    catalog = load_catalog(
        _write(
            tmp_path,
            [_entry(name="search_knowledge", budget={"timeout_ms": 1000, "max_results": 3, "max_result_bytes": 1024})],
        ),
        served_names=SERVED,
        ceiling=CEILING,
    )
    port = AgentFakePort(search_result=canned_search_result())
    registry = _registry(catalog, port)

    asyncio.run(registry.dispatch("search_knowledge", {"query": "the model query"}))
    [call] = port.search_calls
    assert call["budget"].timeout_ms == 1000
```

(The suite's imports are a DELTA on Task 2's file, applied as anchors — no statement is duplicated, and a duplicated statement reds the lint gate with `F811`+`I001` (measured):
- ADD `import asyncio` to the stdlib group (the file has none today).
- The EXISTING `from capabilities.contract import CallerContext, OperationBudget` statement stays AS IS (it is already exact).
- The EXISTING `from tool_catalog import CatalogError, load_catalog` statement GROWS: `from tool_catalog import CatalogError, DeclaredSource, budget_overrides, build_tool_source_factory, load_catalog`.
- ADD `from agent.registry import UnregisteredToolError, build_registry` and `from agent.sources import DocumentToolSource, ToolSourceContext` to the FIRST-PARTY group, alphabetically.
- ADD `from conftest import AgentFakePort, canned_search_result` to the THIRD-PARTY group, next to `import pytest` — ruff files `conftest` as third-party (it does not resolve as a package from the repo root); putting it in the first-party group reds `I001`.)

- [ ] **Step 2: Run the suite and watch it fail**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/s3-tool-sources ] || { echo "not in the checkout that carries feat/agentic-foundations/s3-tool-sources"; exit 1; }
cd components/agent-service
/tmp/genie-agent-service-venv/bin/python -m pytest tests/test_tool_catalog.py -q
```

Expected: the collection FAILS — `build_tool_source_factory` does not exist yet.

- [ ] **Step 3: The host's factory**

In `components/agent-service/tool_catalog.py`, add the factory (the module's imports gain `Sequence` — for the declared sources and the pairs — and the core's `ToolDefinition`, `ToolExecutor` — for the pairs' types):

```python
# the module's import block GAINS (three additions, the rest of the block from the Step-3 module stays byte-identical):
from collections.abc import Callable, Mapping, Sequence

from agent.registry import ToolDefinition, ToolExecutor
from agent.sources import ToolSource, ToolSourceContext
```

```python
def build_tool_source_factory(
    *,
    catalog: ToolCatalog,
    declared_sources: Sequence[DeclaredSource],
) -> Callable[[ToolSourceContext], tuple[tuple[ToolDefinition, ToolExecutor], ...]]:
    """The host's per-request factory: the declared sources, filtered by the catalog.

    The DECLARATION lives with the host — it names the sources a
    deployment runs, and how each is built. The core asks this factory,
    per request, for the pairs to register.

    The catalog filters what the sources offer: a tool the catalog does
    not name, does not allow, or names on another source is not offered
    at all — so the registry never carries it, the model never sees it,
    and the dispatcher refuses it by name.
    """

    def factory(bundle: ToolSourceContext) -> tuple[tuple[ToolDefinition, ToolExecutor], ...]:
        offered: list[tuple[ToolDefinition, ToolExecutor]] = []
        for declared in declared_sources:
            source = declared.build(bundle)
            for definition, executor in source.tools(bundle.context, bundle.bearer):
                entry = catalog.entry(definition.name)
                if entry is None or not entry.allow:
                    continue
                if entry.source != declared.source_id:
                    continue
                offered.append((definition, executor))
        return tuple(offered)

    return factory
```

- [ ] **Step 4: The orchestrator takes the sources from the host**

In `components/agent-service/agent/orchestrator.py`:

- the constructor's `port_factory` parameter becomes `tool_source_factory` (same position), and the assignment `self._port_factory = port_factory` is DELETED — the old line names a parameter that no longer exists, so a literal application of the block below would raise `NameError` at construction:

```python
    def __init__(
        self,
        config: OrchestratorConfig,
        lane: Lane,
        model_client: LoopModelClient,
        tool_source_factory,
        metadata_source,
        concept_source,
        preparer_factory=None,
        runtime_factory=None,
    ) -> None:
        ...
        # The SOURCES: the deployment's declared tool sources, built per
        # request (the core composes nothing — the host declares which
        # sources a deployment runs and how). The factory receives the
        # request's bundle — the caller's identity, the operation budget
        # and the run's own sinks — and answers the pairs to register.
        self._tool_source_factory = tool_source_factory
```

- the assembly becomes:

```python
            bundle = ToolSourceContext(
                context=request.context,
                bearer=request.bearer,
                operation_budget=self._config.operation_budget,
                preparer=preparer,
                on_preparation_status=preparation_statuses.append,
                abstention_sink=abstention_reasons,
            )
            registry = build_registry(self._tool_source_factory(bundle))
```

- the imports change: `from .registry import build_registry` and `from .sources import ToolSourceContext` (the `DocumentToolSource` import goes away — the core no longer names a source). **Both go in their alphabetical place** among the relative imports — `.registry` between `.prompt` and `.runtime`, `.sources` between `.runtime` and `.verification` — or the module's own lint gate reds with `I001` (the import block is un-sorted).

- the module's docstring paragraph about the port factory is updated: the orchestrator holds a SOURCE FACTORY (the deployment's declared sources), not a port factory.

- [ ] **Step 5: The host wires the catalog and the declared sources**

In `components/agent-service/app.py`, `_build_orchestrator` gains the catalog and the factory. **The catalog read goes AFTER `build_stateless_adapters(env)`** — the port assembly's own knob refusals stay FIRST, so a deployment missing BOTH names the port's knob (the honest-503 contract `tests/test_app_runs.py::test_an_unassembled_port_answers_503_naming_the_knob` guards; measured: read placed before the assembly reds that pin — the catalog's `ValueError` would pre-empt the port's). The read uses `env` and `orchestrator_config`, so it lands after `OrchestratorConfig.load(env)`; the two anchors together fix its position uniquely:

```python
    # The tool catalog: the deployment file that decides what a run may
    # call. Read at assembly, fail-closed: a missing file, an unreadable
    # file or a duplicate exposed name is a ValueError, and the run
    # surface answers the honest 503 naming it. An ENTRY this deployment
    # cannot serve costs the ENTRY, not the service — the tool is absent,
    # and the catalog's other tools keep working. The knob is a PATH (the
    # deployment's file lives wherever the deployment mounts it).
    catalog_path = str(env.get("AGENT_TOOL_CATALOG_PATH", "")).strip()
    if not catalog_path:
        raise ValueError("AGENT_TOOL_CATALOG_PATH is not set: the run surface declares no tool without a catalog")
    catalog = load_catalog(
        catalog_path,
        served_names={DocumentToolSource.source_id: DocumentToolSource.served_tool_names},
        ceiling=orchestrator_config.operation_budget,
    )
```

and the host DECLARES its sources — the deployment's facts about a source (the id the catalog names it by, the tools it serves) live here, and the port carries neither:

```python
    # The declared sources: what this deployment runs, and how each is
    # built. The core composes nothing — it asks this factory per
    # request for the pairs to register.
    declared_sources = (
        DeclaredSource(
            source_id=DocumentToolSource.source_id,
            served_tool_names=DocumentToolSource.served_tool_names,
            build=lambda bundle: DocumentToolSource(
                port_factory,
                bundle.operation_budget,
                budgets=budget_overrides(catalog),
                preparer=bundle.preparer,
                on_preparation_status=bundle.on_preparation_status,
                abstention_sink=bundle.abstention_sink,
            ),
        ),
    )
    tool_source_factory = build_tool_source_factory(catalog=catalog, declared_sources=declared_sources)

    return RequestOrchestrator(
        config=orchestrator_config,
        lane=lane,
        model_client=model_client,
        tool_source_factory=tool_source_factory,
        preparer_factory=preparer_factory,
        metadata_source=adapters.docrepo,
        concept_source=adapters.okf,
    )
```

with the imports: `from agent.sources import DocumentToolSource` (between `from agent.orchestrator import (...)` and `from agent.version_record import ...`) and `from tool_catalog import DeclaredSource, budget_overrides, build_tool_source_factory, load_catalog` (after `from noagent.config import ...`, before `from tracing import setup_tracing`). The alphabetical place matters: ruff's `I001` fires on an unsorted import block, and the lint gate is one of the plan's own gates.

The knob is read from the environment mapping — and the mapping is normalized ONCE, at the top of `_build_orchestrator`, so the read is not a second name for what the parameter already carries:

```python
def _build_orchestrator(env=None) -> RequestOrchestrator:
    # The environment mapping, normalized once: every read below (the
    # budget knobs, the port assembly, the catalog's path) reads THIS.
    env = os.environ if env is None else env
```

INSERTED AFTER the function's docstring, not right after the `def` — a line between the signature and the docstring would demote the docstring to a bare expression (`__doc__` becomes `None`).

`os` is already imported in `app.py`. Every existing call (`OrchestratorConfig.load(env)`, `build_stateless_adapters(env)`, `build_preparer_factory(transport, env=env)`) then reads the same mapping it read before — `load(None)` already meant `os.environ`, so the normalization changes nothing but the knob's read.

- [ ] **Step 6: The suites' declarations**

In `components/agent-service/tests/conftest.py`, add the suite's declaration of the document source (the same shape the host's factory has):

```python
def document_source_factory(port_factory):
    """The per-request factory that offers the document source.

    The core asks the declared sources for their tools per request; this
    is the suite's declaration. It is the host's factory's SHAPE, not its
    wiring: the host's `DeclaredSource.build` forwards the catalog's
    per-tool budgets, and this helper forwards none — a suite-built
    orchestrator therefore runs under the ceiling. The catalog's per-tool
    budget is exercised by the catalog's own pins, which build their own
    `DeclaredSource`.
    """

    def factory(bundle):
        source = DocumentToolSource(
            port_factory,
            bundle.operation_budget,
            preparer=bundle.preparer,
            on_preparation_status=bundle.on_preparation_status,
            abstention_sink=bundle.abstention_sink,
        )
        return source.tools(bundle.context, bundle.bearer)

    return factory
```

It sits BESIDE `document_registry` (Task 1's helper), not instead of it: the two take different things. `document_registry(port, context, budget, **wiring)` answers "give me the registry over THIS port and context" — the suites that drive a loop or a probe need that. `document_source_factory(port_factory)` answers "give me the factory the ORCHESTRATOR asks per request" — the suites that build an orchestrator need that. Neither is the other's shape.

Every suite that uses it imports it from `conftest` — and the name goes in the import block's ALPHABETICAL place (`document_source_factory` after `canned_search_result`, before `fake_port`), or the module's own lint gate reds with `I001`.

Then every suite that built the orchestrator with `port_factory=` builds it with `tool_source_factory=` instead:

- `tests/test_event_stream_gate.py`: the construction AND its imports change; the comparison and the fixture do not. The new construction calls `load_catalog`, `DeclaredSource` and `build_tool_source_factory` (module `tool_catalog`) and `DocumentToolSource` (module `agent.sources`) — none of which the file imports today, so a faithful "the CONSTRUCTION line only" edit raises `NameError` before the comparison runs. The import block therefore gains:

  ```python
  from agent.sources import DocumentToolSource
  from tool_catalog import DeclaredSource, build_tool_source_factory, load_catalog
  ```

  (`agent.sources` joins the first-party group, after `agent.orchestrator`; `tool_catalog` is a top-level module of the service, so it stands alone after the `lane` import.) **The gate builds its registry THROUGH THE CATALOG — a catalog the TEST WRITES**, not the shipped file: the fixture is the frozen wire contract and must not move when an operator edits a deployment file (an operator turning a tool off would otherwise break a CODE freeze gate whose only remedy — re-recording — G4 forbids). The gate writes its own catalog with the same two tools:

  ```python
      catalog_path = lane_dir / "tool-catalog.json"
      catalog_path.parent.mkdir(parents=True, exist_ok=True)  # the lane creates its dir later
      catalog_document = {
          "tools": [
              {"source": "document", "name": "search_knowledge"},
              {"source": "document", "name": "read_source"},
          ]
      }
      catalog_path.write_text(json.dumps(catalog_document), encoding="utf-8")
      catalog = load_catalog(
          catalog_path,
          served_names={"document": frozenset({"search_knowledge", "read_source"})},
          ceiling=orchestrator_config().operation_budget,
      )
      orchestrator = RequestOrchestrator(
          config=orchestrator_config(),
          lane=AdmissionLane(1, str(lane_dir)),
          model_client=model,
          tool_source_factory=build_tool_source_factory(
              catalog=catalog,
              declared_sources=(
                  DeclaredSource(
                      source_id=DocumentToolSource.source_id,
                      served_tool_names=DocumentToolSource.served_tool_names,
                      build=lambda bundle: DocumentToolSource(
                          lambda context, bearer: fake_port(),
                          bundle.operation_budget,
                          preparer=bundle.preparer,
                          on_preparation_status=bundle.on_preparation_status,
                          abstention_sink=bundle.abstention_sink,
                      ),
                  ),
              ),
          ),
          metadata_source=FakeMetadataSource(),
          concept_source=FakeConceptSource(),
      )
  ```

  (the gate's catalog lives in the test's `lane_dir`, which the test owns. The SHIPPED file is pinned SEPARATELY, at its own boundary: `tests/test_tool_catalog.py` (Task 2) gains a pin that loads `configs/agent/tool-catalog.json` (`Path(__file__).resolve().parents[3]` — `parents[0]` is `tests`, `parents[1]` is `agent-service`, `parents[2]` is `components`, `parents[3]` is the repository root) and asserts the two document tools survive it — so the DEPLOYED wiring has its witness without coupling the frozen wire to a file an operator may edit. The gate's own `FIXTURE` constant resolves a DIFFERENT path — `Path(__file__).parent / "fixtures" / ...` — so it is no guide here.) Without the catalog in the gate's path, the frozen stream would prove the MOVE and not the WIRING — and a catalog that dropped a tool would never show up in it.
- `tests/test_app_runs.py` (two constructions): each `RequestOrchestrator(...)` call gains `tool_source_factory=` — the same shape the gate block above shows: `tool_source_factory=build_tool_source_factory(catalog=catalog, declared_sources=(DeclaredSource(...),))` over the knob-declared catalog (both tests already set the knob env or gain it per the knob block above). `port_factory=` is DELETED from the call — the keyword no longer exists, and leaving it makes the orchestrator raise `TypeError` at construction.
- `tests/test_version_record.py` (two constructions): same substitution as `test_app_runs.py`. AND the file's OWN `broken_factory` (it defines one — `def broken_factory(context, bearer)` wired as `port_factory=broken_factory` at the second construction) takes the BUNDLE now, or the pin silently degrades: a two-arg factory raises `TypeError` (caught by the orchestrator's `except Exception` → `run_error`), so the pin passes while witnessing a signature error instead of the refusal it names:
  `def broken_factory(bundle): raise ValueError("AGENT_DOCREPO_URL must be set for the port assembly (doc-repo base URL)")`
- `tests/test_agent_orchestrator.py` (the helper's construction and the four direct ones): the helper (below) and the four direct constructions pass `tool_source_factory=document_source_factory(port_factory)` — the file's own factory, one line each.
- `tests/test_agent_sources.py` (one): `tool_source_factory=document_source_factory(port_factory)`.

**The assembly-level test needs the knob.** `tests/test_app_runs.py::test_the_app_assembly_wires_preparation_into_the_run_surface` builds the REAL assembly (`app._build_orchestrator`) and asserts a 200 — so after this task the assembly reads `AGENT_TOOL_CATALOG_PATH`, and without it the answer is the honest 503 and the test reds on a change the plan never mentioned. **The sibling pin `test_an_unassembled_port_answers_503_naming_the_knob` stays GREEN UNTOUCHED** — the catalog read sits AFTER the port assembly, so that test's missing-`AGENT_DOCREPO_URL` 503 keeps its message; its position is re-verified at the gate, not assumed. The assembly test therefore declares the catalog the way a deployment does:

```python
    monkeypatch.setenv(
        "AGENT_TOOL_CATALOG_PATH",
        str(Path(__file__).resolve().parents[3] / "configs" / "agent" / "tool-catalog.json"),
    )
```

(the shipped file — the assembly's own contract), placed with the other `monkeypatch.setenv` calls of that test. `tests/test_app_runs.py` does NOT import `pathlib` today, so the import is added: `from pathlib import Path`, at the END of the stdlib from-group — directly after `from dataclasses import replace` (ruff's isort: straight imports first, then from-imports, each alphabetical; placing it directly above `import pytest` would split the third-party group and red `I001`).

`tests/test_agent_orchestrator.py`'s helper keeps its pin — the per-request port build is still recorded, and the factory now lives inside the source factory:

```python
    def tool_source_factory(bundle):
        return document_source_factory(port_factory)(bundle)
```

and the "a port factory failure answers the honest terminal" pin keeps its meaning with the failure moved into the source factory:

```python
    def broken_factory(bundle):
        raise ValueError("AGENT_DOCREPO_URL must be set for the port assembly (doc-repo base URL)")
```

- [ ] **Step 7: Run the suites and watch the gate**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/s3-tool-sources ] || { echo "not in the checkout that carries feat/agentic-foundations/s3-tool-sources"; exit 1; }
cd components/agent-service
/tmp/genie-agent-service-venv/bin/python -m pytest tests/ -q
```

Expected: the suite is green, the new filter's pins are green, and the gate test reports the stream IDENTICAL to the recorded fixture — the registry still carries the two document tools, in the same order, with the same definitions, so the model sees the same tool list and the run produces the same events. A difference in the stream is a STOP.

- [ ] **Step 8: Lint**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/s3-tool-sources ] || { echo "not in the checkout that carries feat/agentic-foundations/s3-tool-sources"; exit 1; }
cd components/agent-service
uvx ruff@0.16.3 check --no-cache app.py tracing.py lane.py assembly.py tool_catalog.py capabilities/ preparation/ noagent/ agent/ measurement/ tests/
uvx ruff@0.16.3 format --no-cache --check app.py tracing.py lane.py assembly.py tool_catalog.py capabilities/ preparation/ noagent/ agent/ measurement/ tests/
```

Expected: both commands are silent.

- [ ] **Step 9: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/s3-tool-sources ] || { echo "not in the checkout that carries feat/agentic-foundations/s3-tool-sources"; exit 1; }
git add components/agent-service
git commit -m "refactor(agent-service): the run's registry is assembled from the declared sources"
```

---

### Task 4: The deployment — the knob, the mount, the seeding and the config gates

**Files:**
- Modify: `env` (the knob, documented)
- Modify: `docker-compose.yaml` (the knob and the read-only mount)
- Modify: `deploy/ansible/templates/env.j2` (the knob)
- Modify: `deploy/ansible/group_vars/all.yml` (the group var)
- Modify: `deploy/ansible/deploy.yml` (the catalog's seeding on the node)
- Modify: `tests/config-validator/__tests__/agent-service.test.js` (the knob's coverage)
- Modify: `configs/README.md` (the new config home's index entry)

**Interfaces:**
- Consumes: `AGENT_TOOL_CATALOG_PATH` (the new knob), `configs/agent/tool-catalog.json` (Task 2's file).
- Produces: the deployment knob, wired on every surface the agent service is deployed on (compose and ansible), and the config-validator gates that keep them wired.

- [ ] **Step 1: The failing test — the deployment gates**

Add to `tests/config-validator/__tests__/agent-service.test.js` (the file's existing helpers — `parseEnvTemplate`, `parseComposeServiceBlock`, `ENV_PATH`, `ENV_J2_PATH`, `GROUP_VARS_PATH`, `ROOT`, **and `COMPOSE_PATH`** — are reused as they are: NONE of them is redeclared; redeclaring `COMPOSE_PATH` as a `const` is a `SyntaxError` that un-parses the whole suite):

```js
describe('the agent tool catalog is declared, mounted and seeded', () => {
  test('the env template documents the catalog path', () => {
    const env = parseEnvTemplate(ENV_PATH);
    const documented = env.documented.find((entry) => entry.name === 'AGENT_TOOL_CATALOG_PATH');

    expect(documented).toBeDefined();
    expect(documented.value).toBe('/app/config/tool-catalog.json');
  });

  test('the compose block forwards the knob and mounts the catalog read-only', () => {
    const composeText = fs.readFileSync(COMPOSE_PATH, 'utf-8');
    const block = parseComposeServiceBlock(composeText, 'agent-service');

    expect(block).toMatch(/AGENT_TOOL_CATALOG_PATH=\$\{AGENT_TOOL_CATALOG_PATH:-\/app\/config\/tool-catalog\.json\}/);
    // Read-only: the service reads the catalog, it never writes it.
    expect(block).toMatch(/\.\/configs\/agent\/tool-catalog\.json:\/app\/config\/tool-catalog\.json:ro/);
  });

  test('the ansible deployment renders the knob and seeds the file', () => {
    const envJ2 = fs.readFileSync(ENV_J2_PATH, 'utf-8');
    expect(envJ2).toMatch(
      /AGENT_TOOL_CATALOG_PATH=\{\{ agent_tool_catalog_path \| default\('\/app\/config\/tool-catalog\.json'\) \}\}/
    );

    const groupVars = fs.readFileSync(GROUP_VARS_PATH, 'utf-8');
    expect(groupVars).toMatch(/^agent_tool_catalog_path: "\/app\/config\/tool-catalog\.json"$/m);

    // The node must carry the file: the bind mount's source has to exist
    // there (swarmkit silently creates a missing bind source ROOT-owned).
    const deploy = fs.readFileSync(path.join(ROOT, 'deploy/ansible/deploy.yml'), 'utf-8');
    expect(deploy).toMatch(/configs\/agent\/tool-catalog\.json/);
  });

  test('the shipped catalog carries the two document tools', () => {
    const catalog = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'configs/agent/tool-catalog.json'), 'utf-8')
    );

    expect(catalog.version).toBe(1);
    expect(catalog.tools.map((entry) => entry.name).sort()).toEqual(['read_source', 'search_knowledge']);
  });
});
```

- [ ] **Step 2: Run the config-validator suite and watch it fail**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/s3-tool-sources ] || { echo "not in the checkout that carries feat/agentic-foundations/s3-tool-sources"; exit 1; }
cd tests/config-validator
npm test
```

Expected: the new describe block is RED — the knob is documented nowhere and the mount does not exist.

- [ ] **Step 3: The env template**

In `env`, in the AGENT section, right after the `AGENT_TOOL_MAX_RESULT_BYTES` line:

```
# The tool catalog: the deployment file that decides what a run may call
# (the tools the model is told about and the dispatcher may run). The
# agent service reads it at assembly, fail-closed: a missing file or a
# duplicate exposed name is answered 503 naming the defect — never a run
# served with the wrong tools. An entry this deployment cannot serve
# costs the ENTRY (the tool is absent), not the service.
# The value is the file's location INSIDE the container (compose mounts
# it read-only from the repository's configs/agent/ home) — compose
# DEFAULTS it to that mount's own path, so a compose deployment needs no
# .env line; set it here only to mount the catalog somewhere else.
# AGENT_TOOL_CATALOG_PATH=/app/config/tool-catalog.json
```

- [ ] **Step 4: The compose block**

In `docker-compose.yaml`, in the `agent-service` block's `environment:` (after the `AGENT_TOOL_MAX_RESULT_BYTES` line):

```yaml
      # The tool catalog — the deployment file that decides what a run may
      # call. Read at assembly, fail-closed (a missing file or a defect is
      # answered 503 naming it). The path is where the file lands inside
      # the container; the mount below is where it comes from.
      #
      # DEFAULTED, unlike the budget knobs beside it: those are empty by
      # default because an unset budget must stop the run, while this one
      # names the mount's own path — the file the compose block ITSELF
      # mounts. The fail-closed part is the FILE (a missing or broken
      # catalog is a 503 naming it), not the path.
      - AGENT_TOOL_CATALOG_PATH=${AGENT_TOOL_CATALOG_PATH:-/app/config/tool-catalog.json}
```

and a `volumes:` section on the same block (the service has none today; the catalog is its first):

```yaml
    volumes:
      # The tool catalog — read-only: the service reads the deployment's
      # file and never writes it.
      - ./configs/agent/tool-catalog.json:/app/config/tool-catalog.json:ro
```

- [ ] **Step 5: The ansible surfaces**

In `deploy/ansible/templates/env.j2`, after the `AGENT_TOOL_MAX_RESULT_BYTES` line:

```
# The tool catalog: the deployment file that decides what a run may call.
# The path is the file's location inside the container; the deployment
# seeds the file itself (configs/agent/tool-catalog.json) on the node.
AGENT_TOOL_CATALOG_PATH={{ agent_tool_catalog_path | default('/app/config/tool-catalog.json') }}
```

In `deploy/ansible/group_vars/all.yml`, next to the other agent knobs:

```yaml
# The tool catalog's path inside the container. The deployment seeds the
# file itself (configs/agent/tool-catalog.json) on the node — the bind
# mount's source has to exist there.
agent_tool_catalog_path: "/app/config/tool-catalog.json"
```

In `deploy/ansible/deploy.yml`, the `_deploy_files` union gains the agent's file:

```yaml
        _deploy_files: "{{ _deploy_files_default | union(_deploy_files_obs | default([])) | union(_deploy_files_certbot | default([])) | union(_deploy_files_agent | default([])) }}"
```

```yaml
        # The tool catalog — the agent's deployment file. Seeded only when
        # the agent service is enabled: the bind mount's source has to
        # exist on the node (swarmkit silently creates a missing bind
        # source ROOT-owned, and the service then reads a directory).
        _deploy_files_agent: "{{ [{'src': 'configs/agent/tool-catalog.json', 'dest': deploy_dir + '/configs/agent/tool-catalog.json'}] if agent_enabled | default('0') == '1' else [] }}"
```

- [ ] **Step 6: The config home's index**

In `configs/README.md`, the contents list gains:

```
- `agent/` - the agent service's tool catalog (the deployment file that decides what a run may call)
```

- [ ] **Step 7: Run the config-validator suite and watch it pass**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/s3-tool-sources ] || { echo "not in the checkout that carries feat/agentic-foundations/s3-tool-sources"; exit 1; }
cd tests/config-validator
npm test
```

Expected: the suite is green, the new describe block included.

- [ ] **Step 8: The full gate**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/s3-tool-sources ] || { echo "not in the checkout that carries feat/agentic-foundations/s3-tool-sources"; exit 1; }
cd components/agent-service
/tmp/genie-agent-service-venv/bin/python -m pytest tests/ -q
uvx ruff@0.16.3 check --no-cache app.py tracing.py lane.py assembly.py tool_catalog.py capabilities/ preparation/ noagent/ agent/ measurement/ tests/
uvx ruff@0.16.3 format --no-cache --check app.py tracing.py lane.py assembly.py tool_catalog.py capabilities/ preparation/ noagent/ agent/ measurement/ tests/
cd ../..
cd tests/config-validator && npm test
```

Expected: every command is green.

- [ ] **Step 9: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/s3-tool-sources ] || { echo "not in the checkout that carries feat/agentic-foundations/s3-tool-sources"; exit 1; }
git add env docker-compose.yaml deploy/ansible configs tests/config-validator
git commit -m "chore(deploy): the tool catalog — the knob, the mount and the node's seeding"
```

---

## The gate

| # | Gate | Command | Expected |
|---|---|---|---|
| G1 | the agent-service suite | `cd components/agent-service && /tmp/genie-agent-service-venv/bin/python -m pytest tests/ -q` | green |
| G2 | the recorded event stream | the same run (the gate test) | the stream IDENTICAL to `tests/fixtures/event_stream/orchestrated_run.json` — and the gate builds its registry THROUGH the shipped catalog, so the frozen stream witnesses the DEPLOYED path (the filter included), not a path the catalog bypasses |
| G3 | the frozen capability contract | the same run (`tests/test_equivalence_v02.py`) | green — and the file UNTOUCHED: `git diff --exit-code $BASE...HEAD -- components/agent-service/tests/test_equivalence_v02.py` is silent (`$BASE` = the sha this plan starts from, captured at Step 0). A bare `git diff` compares worktree↔index — after a commit both are clean, so it is silent whether the file moved or not: the vacuous form is a gate that cannot fail. This gate witnesses the CAPABILITY and the PREPARATION; the TOOLS' own witness is the renamed suite (G3b) |
| G3b | the tools' own witness | the same run (`tests/test_agent_sources.py`), plus the blob diff of the rename | green — and the diff touches only the import lines, the helper, the docstring, the probe pin's rewrite and the added pins: `git diff $(git rev-parse $BASE:components/agent-service/tests/test_agent_toolset.py) $(git rev-parse HEAD:components/agent-service/tests/test_agent_sources.py)` — BLOB against BLOB, not worktree↔index (a bare `git diff -M` after the rename is committed is empty whatever moved). A behaviour pin that moved is a behaviour that moved |
| G4 | the frozen fixture | `git diff --exit-code $BASE...HEAD -- components/agent-service/tests/fixtures/event_stream/orchestrated_run.json` | silent — the wire did not move (the base..HEAD form, for the same vacuity reason as G3) |
| G5 | lint | `uvx ruff@0.16.3 check --no-cache …` and `uvx ruff@0.16.3 format --no-cache --check …` | silent |
| G6 | the deployment gates | `cd tests/config-validator && npm test` | green |
| G7 | no new dependency | `git diff --exit-code $BASE...HEAD -- components/agent-service/requirements.txt components/agent-service/requirements-test.txt` | silent — the catalog is JSON, and nothing entered the audited tree |
| G8 | the runtime gate (spec §10.9, §11) | `tests/compose-non-root/check-runtime.sh <compose-project>` — AFTER the compose change, on a CONVERGED default-profile stack, as the data-dir owner | exit 0 — the no-root contract holds: the plan adds a `volumes:` mount to the agent-service compose block, one of the three triggers the repo's rule names (`docker-compose.yaml`: a `user:`, a volume, a new service). **This plan OWNS S3's runtime gate** (spec §11, the split is recorded there) |

A difference in G2 is a STOP: the move or the assembly changed something it was not supposed to change.

## Out of scope

- **`web_search` and the outbound PII egress** — plan 2 of this slice (the second source; `egress: open_web` becomes honourable there; the catalog refuses it here).
- **The web citation variant** (`source: 'web'`) on web and mobile — plan 3 of this slice.
- **The MCP source and the `mcp` SDK** — slice S6; the catalog's `server`/`tool` fields are carried and refused here.
- **`CallerContext.scopes` and the scope enforcement** — the design's §4.8 (the identity slice). **The deviation, stated:** ADR agentic-005 §7 filters a scope'd tool PER REQUEST ("a tool whose required scopes are not all present is not registered for that request"), and that rule needs the caller's scopes. This slice has no `CallerContext.scopes` yet, so it refuses the ENTRY at startup instead — for EVERY caller, not just the ones lacking the scope. Narrower, never laxer: absent for EVERY caller, including those the ADR would entitle, and nothing is ever served with an unenforced scope.
- **The write tools, the approval and the idempotency key** — ADR agentic-006; the catalog refuses a write here (the entry is refused; the catalog still loads).
- **The pydantic-ai spike** — slice S7.
- **An admin surface for the catalog** (dynamic tool management) — the ADR defers it; a static file is iteration 2's decision.
- **The Helm chart** — the agent service has no chart deployment (the compose and ansible surfaces are its delivery).
- **Any change to the document capability, its adapters or the recorded contract** — the capability is untouched; this plan moves the tools, it does not change them.

## What this plan establishes

| Design item | Where | Evidence |
|---|---|---|
| The `ToolSource` port (§4.3) | `agent/sources.py` | the document source implements it; the core asks the declared sources per request |
| `DocumentToolSource`, unchanged (§4.2) | `agent/sources.py` | the definitions and the executors moved verbatim — the definitions pin (the model-facing contract, which nothing else in the tree pins) and the renamed suite's behaviour pins, both green and unchanged |
| The catalog's file, schema and startup rules (§4.4) | `configs/agent/tool-catalog.json`, `tool_catalog.py` | the loader's pins: a duplicate is an error, an unserved catalogued tool is a warning and an absent tool |
| The core composes nothing (§2.5) | `agent/orchestrator.py`, `app.py` | the orchestrator takes the sources from the host; the host declares them |
| The registry stays the authorization surface (§4.1) | `agent/registry.py` | a tool the catalog drops is never registered, so it is neither listed nor dispatchable |
| The identity travels with the call (§4.3) | `agent/sources.py` | the executor carries the identity of ITS call, never of the source's construction |
| The call path is unchanged (§4.5) | `agent/dispatcher.py` (untouched) | every source goes through the same dispatcher |

## What it leaves open

- The catalog's `scopes`, `risk: write`, `requires_approval` and `egress: open_web` are REFUSED, not honoured — the identity slice, ADR agentic-006 and plan 2 relax them, one at a time.
- The per-tool budget is honoured as a TIGHTENING of the deployment's ceiling; a catalog that wants a WIDER bound than `AGENT_TOOL_*` is refused. Whether the ceiling itself should be per-tool is the operator's call, not this plan's.
- The operator's open decision (the design's §13.2) — how a scope maps onto a realm role — is untouched here: no scope is honoured yet.
- The MCP source's discovery at startup, and the `mcp` SDK's adoption price (the OpenTelemetry line, six packages), are S6's work.
- The admin surface for the catalog is deferred by the ADR.
- The chart is not a delivery surface for the agent service; if it becomes one, the catalog's mount must be added to the chart in that slice.
