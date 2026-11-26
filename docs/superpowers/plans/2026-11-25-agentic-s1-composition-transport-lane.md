# Agentic S1, plan 2 of 4 — the transport and the admission lane leave the core: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two of the six leaks of the design close: the core stops performing I/O. The async HTTP transport becomes an adapter, the flock admission lane becomes host infrastructure, and the composition root supplies both — so the core names only the Protocols.

**Architecture:** The core keeps the *shapes* it exchanges — `TranslationTransport` for the HTTP verbs, a `Lane` port for the admission slot — and the host owns the *implementations* — the `httpx`-backed transport in the adapter package, the `flock` slot pool beside `app.py`. Every constructor that used to pick its own implementation now receives it. The timeout classification stays in the core and recognises a builtin `TimeoutError`, which the adapter raises for a timed-out call; the other transport failures keep travelling unwrapped, because the core reads the vLLM error body off the exception.

**Tech Stack:** Python 3.11, pytest 9.1.1, pytestarch 5.1.1 (the rules of plan 1), ruff 0.16.3.

**Spec:** `docs/superpowers/specs/2026-11-25-agentic-iteration-2-architecture-design.md` — §2.3 (the leaks), §2.5 (the rules), §11 (slice S1). Plan 1: `docs/superpowers/plans/2026-11-25-agentic-s1-architecture-rules.md`.

## Global Constraints

- **Where the work lands.** Branch `feat/agentic-foundations/architecture` (stacked on `feat/agentic-foundations/prd`; merge request !1088). Commit on this branch only. Do not push, do not touch `main` or the PRD branch, never run `git stash`, never run `git reset --hard`.
- **No path is written in this plan.** Every command block starts with the same guard, which moves to the root of the checkout it is run from and refuses anything but that branch.
- **Python floor.** `requires-python = ">=3.11"`; the CI lanes run `python:3.11-slim`.
- **Frozen behavior.** The RAG capability's behavior is frozen (`docs/baselines/v02-opea-query-path-contract.md`). This plan touches the capability's *wiring*, never its answers: `tests/test_equivalence_v02.py` stays green and untouched.
- **The evidence strings are frozen.** The version record's `PRODUCER_ID` and the probe's evidence keep their bytes; a move does not rewrite a recorded string.
- **Ruff.** CI pin `RUFF_VERSION` is `0.16.3`; py311, line length 120, rules `E, W, F, I, UP, B, SIM`.
- **Comments and docstrings.** English, they describe the current code, they carry no issue or merge-request number.
- **An output that differs from the expected one is a stop.** Report it; do not adjust a test or a list to make it pass.

## Environment

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
command -v uv
cd components/agent-service
uv venv --python 3.11 /tmp/genie-agent-service-venv
uv pip install --python /tmp/genie-agent-service-venv/bin/python -r requirements-test.txt
/tmp/genie-agent-service-venv/bin/python -m pytest tests/ -q
```

The last command prints `931 passed, 2 warnings in <a few seconds>` — the state plan 1 leaves. If the venv already exists, skip `uv venv` and keep the `uv pip install` line.

## Where this plan sits

Slice S1 is delivered as four plans. This is the second.

| Plan | Content | State it leaves |
|---|---|---|
| Plan 1 — architecture rules | the rules; leak 4 (the executor) and the constant of leak 5 | four I/O violations and two cross-layer violations listed |
| **This one** | the HTTP transport and the admission lane leave the core | two I/O violations and two cross-layer violations listed |
| Plan 3 — the probe and the harness | the measurement surfaces and the core's factories leave | no listed violation; rule R3's set is the composition root and the capability |
| Plan 4 — the runtime port, step 1 | `RuntimeDriver` extraction behind a byte-identical event stream | stream gate recorded |

The two ratchets of plan 1 (`KNOWN_IO_VIOLATIONS`, `KNOWN_INTERNAL_VIOLATIONS` in `components/agent-service/tests/test_architecture.py`) list, after this plan:

| Rule | Pair left | Closed by |
|---|---|---|
| R1 | `("agent.probe", "arango")` | plan 3 |
| R1 | `("agent.v06_harness", "httpx")` | plan 2 — the harness is declared a measurement surface; its file moves in plan 3 |
| R2 | `("agent.probe", "capabilities.adapters")` | plan 3 |
| R2 | `("agent.probe", "capabilities.search_knowledge")` | plan 3 |

## File map

| File | Responsibility | Task |
|---|---|---|
| `components/agent-service/capabilities/adapters/httpx.py` | the async transport and its timeout type | 1 |
| `components/agent-service/preparation/translation.py` | the transport Protocol and the classifier; no `httpx` | 1 |
| `components/agent-service/noagent/generation.py` | the client receives its transport | 1 |
| `components/agent-service/noagent/pipeline.py` | the translator receives its transport; the lane is a port | 1, 2 |
| `components/agent-service/agent/orchestrator.py` | the preparer factory receives its transport; the lane is a port | 1, 2 |
| `components/agent-service/app.py` | the composition root builds the transport and the lane | 1, 2 |
| `components/agent-service/noagent/lane.py` | the port and the refusal | 2 |
| `components/agent-service/lane.py` | the `flock` slot pool (host) | 2 |
| `components/agent-service/tests/test_adapters_httpx.py` | the adapter's timeout mapping | 1 |
| `components/agent-service/tests/test_architecture.py` | the layout and the ratchet lists | 1, 2 |
| `components/agent-service/Dockerfile` | the new host module rides into the image | 2 |
| `.gitlab-ci.yml` | the lint lane covers the new host module | 2 |

## Decisions taken while writing this plan

Each was checked against the code before being written here.

- **The timeout keeps its class name in the message.** The classifier prints `type(exc).__name__`. The adapter raises `TransportTimeoutError` (a builtin `TimeoutError` subclass) carrying the original exception's text, so the message keeps the original class name inside it.
- **Only timeouts are wrapped.** The core's overflow reader reads the vLLM error body off the exception (`exc.response.text`, `exc.body`); a wrapped exception would lose it, so every other failure travels unwrapped.
- **The lane splits into a port and an implementation.** The core names the port; the host owns the `flock` pool. The core's own `AdmissionLane.from_config` disappears with the implementation.
- **The harness is a measurement surface, not core.** It assembles its own runtime to verify a deployment — it reads the SSE stream with `httpx` and, from this plan, names the transport adapter. The layout declares it a measurement layer, so the core rules stop reading it as core; the file itself moves out of `agent/` in plan 3.
- **The transport lands beside the corpus adapters**, in `capabilities/adapters/`, not in a new package: the probe already reaches that package, so the move adds no cross-layer edge.

---

### Task 1: The HTTP transport becomes an adapter

**Files:**
- Create: `components/agent-service/capabilities/adapters/httpx.py`
- Create: `components/agent-service/tests/test_adapters_httpx.py`
- Modify: `components/agent-service/preparation/translation.py`
- Modify: `components/agent-service/noagent/generation.py`
- Modify: `components/agent-service/noagent/pipeline.py`
- Modify: `components/agent-service/agent/orchestrator.py`
- Modify: `components/agent-service/agent/probe.py`
- Modify: `components/agent-service/app.py`
- Modify: `components/agent-service/tests/test_preparation_translation.py`
- Modify: `components/agent-service/tests/test_preparation_prepare.py`
- Modify: `components/agent-service/tests/test_agent_toolset.py`
- Modify: `components/agent-service/tests/test_architecture.py`

**Interfaces:**
- Consumes: `KNOWN_IO_VIOLATIONS` from plan 1.
- Produces:
  - `capabilities.adapters.httpx.HttpxTransport(verify: bool)` — `async get_json(url, headers, timeout_s) -> tuple[int, Any]` and `async post_json(url, headers, payload, timeout_s) -> tuple[int, Any]`.
  - `capabilities.adapters.httpx.TransportTimeoutError(TimeoutError)`.
  - `preparation.translation.TranslationTransport` — unchanged Protocol.

- [ ] **Step 1: Write the failing test**

Create `components/agent-service/tests/test_adapters_httpx.py`:

```python
# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The httpx-backed transport: the verbs it speaks and the timeout it raises."""

import httpx
import pytest

from capabilities.adapters.httpx import HttpxTransport, TransportTimeoutError


def test_a_timed_out_call_raises_the_transport_timeout() -> None:
    transport = HttpxTransport(verify=True)
    with pytest.raises(TransportTimeoutError) as caught:
        transport._client(httpx.ConnectTimeout("read timed out"))
    assert "ConnectTimeout" in str(caught.value)
    assert isinstance(caught.value, TimeoutError)


def test_any_other_failure_travels_unwrapped() -> None:
    transport = HttpxTransport(verify=True)
    failure = httpx.ConnectError("connection refused")
    with pytest.raises(httpx.ConnectError):
        transport._client(failure)
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
cd components/agent-service
/tmp/genie-agent-service-venv/bin/python -m pytest tests/test_adapters_httpx.py -q
```

Expected: the module fails to import — `ImportError while importing test module`, `E   ModuleNotFoundError: No module named 'capabilities.adapters.httpx'`.

- [ ] **Step 3: Write the adapter**

Create `components/agent-service/capabilities/adapters/httpx.py`:

```python
# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The async HTTP transport: the two verbs the core's clients speak.

The transport is the adapter of an HTTP call. It is built by the composition
root and handed to the client that needs it; the core names the Protocol, not
this class.

A timed-out call raises :class:`TransportTimeoutError` — a builtin
``TimeoutError`` — so the core can classify a timeout without naming an HTTP
library. Every other failure travels unwrapped: the core reads the upstream
error body off the exception, and a wrapper would hide it.
"""

from typing import Any

import httpx


class TransportTimeoutError(TimeoutError):
    """The call timed out; the core classifies it as a timeout."""


class HttpxTransport:
    """The production transport: one ``AsyncClient`` per call.

    The per-call client is the deployed seam's shape (the deployed module
    builds an ``AsyncClient`` per request with the call's timeout and the
    TLS-verify knob); what the per-call shape trades away is connection
    pooling, never credential isolation — the bearer travels per call in the
    headers.
    """

    def __init__(self, verify: bool):
        self._verify = verify

    def _client(self, failure: Exception) -> None:
        """Raise ``failure`` the way the core must read it.

        A timeout becomes the core's timeout type; anything else travels
        unchanged, with its upstream body attached.
        """
        if isinstance(failure, httpx.TimeoutException):
            raise TransportTimeoutError(f"{type(failure).__name__}: {failure}") from failure
        raise failure

    async def get_json(self, url: str, headers: dict, timeout_s: float) -> tuple[int, Any]:
        try:
            async with httpx.AsyncClient(timeout=timeout_s, verify=self._verify) as client:
                response = await client.get(url, headers=headers)
        except httpx.TimeoutException as failure:
            self._client(failure)
        return response.status_code, response.json()

    async def post_json(self, url: str, headers: dict, payload: dict, timeout_s: float) -> tuple[int, Any]:
        try:
            async with httpx.AsyncClient(timeout=timeout_s, verify=self._verify) as client:
                response = await client.post(url, headers=headers, json=payload)
        except httpx.TimeoutException as failure:
            self._client(failure)
        return response.status_code, response.json()
```

- [ ] **Step 4: Run the test to verify it passes**

Run the command of Step 2.

Expected: `2 passed in < 1s`.

- [ ] **Step 5: Check that the test can fail**

In `capabilities/adapters/httpx.py`, replace `raise TransportTimeoutError(f"{type(failure).__name__}: {failure}") from failure` with `raise failure`. Run the command of Step 2.

Expected: `1 failed, 1 passed`, with:

```
E       Failed: DID NOT RAISE <class 'capabilities.adapters.httpx.TransportTimeoutError'>
```

Restore the line and run the command again.

Expected: `2 passed in < 1s`.

- [ ] **Step 6: Empty the core of the transport**

In `components/agent-service/preparation/translation.py`, delete the `HttpxTransport` class — the whole block, both of its methods — and delete the `import httpx` line. The `TranslationTransport` Protocol stays: it is the shape the core exchanges.

Delete this block, from the two blank lines that precede the class to the two blank lines that follow it:

```python
class HttpxTransport:
    """The production transport: one ``AsyncClient`` per call.

    The per-call client is the deployed seam's shape (the deployed module
    builds an ``AsyncClient`` per request with the call's timeout and the
    TLS-verify knob); what the per-call shape trades away is connection
    pooling, never credential isolation — the bearer travels per call in the
    headers.
    """

    def __init__(self, verify: bool):
        self._verify = verify

    async def get_json(self, url: str, headers: dict, timeout_s: float) -> tuple[int, Any]:
        async with httpx.AsyncClient(timeout=timeout_s, verify=self._verify) as client:
            response = await client.get(url, headers=headers)
        return response.status_code, response.json()

    async def post_json(self, url: str, headers: dict, payload: dict, timeout_s: float) -> tuple[int, Any]:
        async with httpx.AsyncClient(timeout=timeout_s, verify=self._verify) as client:
            response = await client.post(url, headers=headers, json=payload)
        return response.status_code, response.json()
```

— the block above the class and the two blank lines that follow it — and the import line:

```python
import httpx
```

Then the classifier stops naming an HTTP library. Replace:

```python
    if isinstance(exc, (httpx.TimeoutException, TimeoutError)):
```

with:

```python
    if isinstance(exc, TimeoutError):
```

The docstring of the Protocol mentions the raw exceptions; it now describes what the adapter raises. Replace:

```python
    Implementations return ``(status, parsed body)`` or raise. Raw transport
    exceptions (``httpx.TimeoutException``, connection errors, test doubles'
    arbitrary exceptions) propagate to the client's classification.
```

with:

```python
    Implementations return ``(status, parsed body)`` or raise. Raw transport
    exceptions (a timeout, connection errors, test doubles' arbitrary
    exceptions) propagate to the client's classification.
```

- [ ] **Step 7: The core's clients receive their transport**

Three constructors stopped choosing their own implementation; they take it.

Two translators defaulted to the HTTP transport, in two files. `TranslationClient` lives in `components/agent-service/preparation/translation.py`, `AnswerTranslator` in `components/agent-service/noagent/pipeline.py`; their constructors carry the same lines, so each file is edited on its own.

In `components/agent-service/preparation/translation.py`, `TranslationClient`'s constructor. Replace:

```python
        transport: TranslationTransport | None = None,
        cache: ModelEndpointCache | None = None,
    ):
        self._config = config
        self._registry = registry
        self._transport = transport or HttpxTransport(config.tls_verify)
```

with:

```python
        transport: TranslationTransport,
        cache: ModelEndpointCache | None = None,
    ):
        self._config = config
        self._registry = registry
        self._transport = transport
```

In `components/agent-service/noagent/pipeline.py`, `AnswerTranslator`'s constructor. Replace:

```python
        transport: TranslationTransport | None = None,
        cache: ModelEndpointCache | None = None,
    ):
        self._config = config
        self._registry = registry
        self._transport = transport or HttpxTransport(config.tls_verify)
```

with:

```python
        transport: TranslationTransport,
        cache: ModelEndpointCache | None = None,
    ):
        self._config = config
        self._registry = registry
        self._transport = transport
```

In `components/agent-service/noagent/generation.py`, the client's factory. Replace:

```python
    @classmethod
    def create(cls, config: NoAgentConfig, transport=None) -> "GenerationClient":
        transport = transport or HttpxTransport(config.tls_verify)
        cache = ModelEndpointCache(
```

with:

```python
    @classmethod
    def create(cls, config: NoAgentConfig, transport) -> "GenerationClient":
        cache = ModelEndpointCache(
```

and delete the `HttpxTransport` name from the module's import of `preparation.translation`. Replace:

```python
from preparation.translation import (
    HttpxTransport,
    ModelEndpointCache,
    is_input_overflow,
    parse_tokenize_count,
)
```

with:

```python
from preparation.translation import (
    ModelEndpointCache,
    is_input_overflow,
    parse_tokenize_count,
)
```

In `components/agent-service/noagent/pipeline.py`, the pipeline's own translator. Replace:

```python
    def __init__(self, config: NoAgentConfig, registry: LanguageRegistry, transport=None, cache=None):
        self._config = config
        self._registry = registry
        self._transport = transport or HttpxTransport(config.tls_verify)
```

with:

```python
    def __init__(self, config: NoAgentConfig, registry: LanguageRegistry, transport, cache=None):
        self._config = config
        self._registry = registry
        self._transport = transport
```

and delete the `HttpxTransport` name from the module's import of `preparation.translation`. Replace:

```python
from preparation.translation import HttpxTransport, ModelEndpointCache
```

with:

```python
from preparation.translation import ModelEndpointCache
```

In `components/agent-service/noagent/pipeline.py`, the pipeline's factory takes the transport. Replace:

```python
    @classmethod
    def create(cls, config: NoAgentConfig, capability, budget: OperationBudget, env=None) -> "NoAgentPipeline":
```

with:

```python
    @classmethod
    def create(
        cls, config: NoAgentConfig, capability, budget: OperationBudget, env=None, transport=None
    ) -> "NoAgentPipeline":
```

and inside it, replace:

```python
        generation = GenerationClient.create(config)
```

with:

```python
        generation = GenerationClient.create(config, transport=transport)
```

and replace:

```python
            translator = AnswerTranslator(config, registry)
```

with:

```python
            translator = AnswerTranslator(config, registry, transport=transport)
```

- [ ] **Step 8: The preparer factory receives the transport**

In `components/agent-service/agent/orchestrator.py`, the budgeted translator takes its transport like the client it extends. Replace:

```python
    def __init__(self, config: PreparationConfig, registry, monitor: RunBudgetMonitor, transport=None, cache=None):
```

with:

```python
    def __init__(self, config: PreparationConfig, registry, monitor: RunBudgetMonitor, transport, cache=None):
```

The factory builds the transport today. Replace:

```python
def build_preparer_factory(env=None):
```

with:

```python
def build_preparer_factory(env=None, transport=None):
```

and replace:

```python
    transport = HttpxTransport(config.tls_verify)
    cache = ModelEndpointCache(
```

with:

```python
    cache = ModelEndpointCache(
```

and delete the `HttpxTransport` name from the module's import of `preparation.translation`. Replace:

```python
from preparation.translation import HttpxTransport, ModelEndpointCache, TranslationClient
```

with:

```python
from preparation.translation import ModelEndpointCache, TranslationClient
```

- [ ] **Step 9: The probe's client receives the transport**

In `components/agent-service/agent/probe.py`, the client's constructor stops choosing one. Replace:

```python
    def __init__(self, config: ProbeConfig, transport=None):
        self._config = config
        self._transport = transport if transport is not None else HttpxTransport(config.tls_verify)
```

with:

```python
    def __init__(self, config: ProbeConfig, transport):
        self._config = config
        self._transport = transport
```

and delete the `HttpxTransport` name from the module's import of `preparation.translation`. Replace:

```python
from preparation.translation import HttpxTransport, coerce_sane_int
```

with:

```python
from preparation.translation import coerce_sane_int
```

The probe's live entry builds its own transport — it is a script that reaches a live endpoint. Replace:

```python
    port, context = build_port(config)
    model_client = ProbeModelClient(config)
```

with:

```python
    port, context = build_port(config)
    transport = HttpxTransport(config.tls_verify)
    model_client = ProbeModelClient(config, transport)
```

and the module names the adapter, in its sorted place. Replace:

```python
from capabilities.adapters.env_config import ArangoConfig
from capabilities.adapters.okf import OkfAdapter
```

with:

```python
from capabilities.adapters.env_config import ArangoConfig
from capabilities.adapters.httpx import HttpxTransport
from capabilities.adapters.okf import OkfAdapter
```

- [ ] **Step 10: The measurement harness names the transport too**

`agent/v06_harness.py` still builds its own transport; the harness moves to the measurement package in plan 3, and until then it names the adapter.

In `components/agent-service/agent/v06_harness.py`, the import block is replaced as a whole, so the new name lands where the lint rule `I` wants it. Replace:

```python
from noagent.generation import RECORDED_SAMPLING_PARAMS, chat_choice, chat_choice_content
from preparation.translation import HttpxTransport, coerce_sane_int
```

with:

```python
from capabilities.adapters.httpx import HttpxTransport
from noagent.generation import RECORDED_SAMPLING_PARAMS, chat_choice, chat_choice_content
from preparation.translation import coerce_sane_int
```

- [ ] **Step 11: The harness is a measurement surface**

The harness assembles its own runtime to verify a deployment: it reads the SSE stream with `httpx`, and from this plan it names the transport adapter too. It is not core. The layout says so — a measurement surface may reach the I/O libraries and the adapters, and the core rules stop reading it. The file itself moves out of `agent/` in plan 3; until then the layer carries the truth.

The layout gains the layer. In `components/agent-service/tests/test_architecture.py`, the `Layout` class. Replace:

```python
class Layout(NamedTuple):
    """What each layer is made of, by module name relative to the service root.

    The host is named module by module: a module that joins the host is
    declared here, so the rules see it.
    """

    host: tuple[str, ...]
    core_packages: tuple[str, ...]
    core_modules: tuple[str, ...]
    leaf_adapters: str
    capability: str
```

with:

```python
class Layout(NamedTuple):
    """What each layer is made of, by module name relative to the service root.

    The host is named module by module: a module that joins the host is
    declared here, so the rules see it. The measurement surfaces are named
    the same way: a script that assembles its own runtime to verify a
    deployment is not core, and the rules read it as such.
    """

    host: tuple[str, ...]
    core_packages: tuple[str, ...]
    core_modules: tuple[str, ...]
    leaf_adapters: str
    capability: str
    measurement: tuple[str, ...]
```

The layout declares the harness. Replace:

```python
    leaf_adapters="capabilities.adapters",
    capability="capabilities.search_knowledge",
)
```

with:

```python
    leaf_adapters="capabilities.adapters",
    capability="capabilities.search_knowledge",
    measurement=("agent.v06_harness",),
)
```

The classification reads the measurement layer before the core packages — the harness still lives in `agent/`, and moves to its own package in plan 3. Replace:

```python
    if module in layout.host:
        return "host"
    if _within(module, layout.leaf_adapters):
        return "leaf adapters"
```

with:

```python
    if module in layout.host:
        return "host"
    if any(_within(module, name) for name in layout.measurement):
        return "measurement"
    if _within(module, layout.leaf_adapters):
        return "leaf adapters"
```

Rule R3 skips the measurement surfaces: assembling their own runtime is what they are for. Replace:

```python
    modules = [
        module
        for module in _leaf_modules(_modules(internal, SERVICE.name))
        if not _within(module, SERVICE_LAYOUT.leaf_adapters)
    ]
```

with:

```python
    modules = [
        module
        for module in _leaf_modules(_modules(internal, SERVICE.name))
        if not _within(module, SERVICE_LAYOUT.leaf_adapters) and _layer_of(module, SERVICE_LAYOUT) != "measurement"
    ]
```

The planted-violation probe carries the new field and a measurement surface of its own. Replace:

```python
    layout = Layout(
        host=("app", "tracing"),
        core_packages=("core",),
        core_modules=("contract",),
        leaf_adapters="adapters",
        capability="capability",
    )
```

with:

```python
    layout = Layout(
        host=("app", "tracing"),
        core_packages=("core",),
        core_modules=("contract",),
        leaf_adapters="adapters",
        capability="capability",
        measurement=("measure",),
    )
```

Replace:

```python
        "capability.py": "import fakepkg.adapters.x\nimport fakepkg.contract\n",
```

with:

```python
        "capability.py": "import fakepkg.adapters.x\nimport fakepkg.contract\n",
        "measure.py": "import fakepkg.adapters.x\n",
```

and the probe's own scope mirrors the rule's, so the measurement surface is excluded from the importers it asserts. Replace:

```python
    def adapter_importers() -> set[str]:
        subjects = [module for module in modules(False) if not _within(module, "adapters")]
```

with:

```python
    def adapter_importers() -> set[str]:
        subjects = [
            module
            for module in modules(False)
            if not _within(module, "adapters") and _layer_of(module, layout) != "measurement"
        ]
```

The asserted set does not change — `measure` is absent from it, and it is the only module that would have added it.

- [ ] **Step 12: The composition root builds the transport**

In `components/agent-service/app.py`, the import block is replaced as a whole, so the new name lands where the lint rule `I` wants it and the lane's import points at its new home. Replace:

```python
from agent.cancellation import cancel_and_join
from agent.events import AgentEvent, EventKind
from agent.orchestrator import (
    AdmissionRefused,
    AgentRunRequest,
    MissingKnobsError,
    OrchestratorConfig,
    RequestOrchestrator,
    build_preparer_factory,
)
from agent.probe import ProbeConfig, ProbeModelClient, build_stateless_adapters
from agent.version_record import IMPLEMENTATION_VERSION
from capabilities.contract import CallerContext
from noagent.config import NoAgentConfig
from noagent.lane import AdmissionLane
from tracing import setup_tracing
```

with:

```python
from agent.cancellation import cancel_and_join
from agent.events import AgentEvent, EventKind
from agent.orchestrator import (
    AdmissionRefused,
    AgentRunRequest,
    MissingKnobsError,
    OrchestratorConfig,
    RequestOrchestrator,
    build_preparer_factory,
)
from agent.probe import ProbeConfig, ProbeModelClient, build_stateless_adapters
from agent.version_record import IMPLEMENTATION_VERSION
from capabilities.adapters.httpx import HttpxTransport
from capabilities.contract import CallerContext
from noagent.config import NoAgentConfig
from noagent.lane import AdmissionLane
from tracing import setup_tracing
```

The lane's import moves from `noagent.lane` to `lane` in Task 2, when the implementation becomes host infrastructure.

Then build the transport in `_build_orchestrator`, before the model client. Replace:

```python
    adapters = build_stateless_adapters(probe_config, env)
    model_client = ProbeModelClient(probe_config)
```

with:

```python
    adapters = build_stateless_adapters(probe_config, env)
    transport = HttpxTransport(probe_config.tls_verify)
    model_client = ProbeModelClient(probe_config, transport)
```

and the preparer factory takes it. Replace:

```python
    preparer_factory = build_preparer_factory(env)
```

with:

```python
    preparer_factory = build_preparer_factory(env, transport=transport)
```

- [ ] **Step 13: The tests that named the HTTP library**

Three tests raise an `httpx` timeout at the classifier. The classifier no longer names the library: a timeout is a builtin `TimeoutError`.

In `components/agent-service/tests/test_preparation_translation.py`, replace:

```python
        typed = classify_transport_error(httpx.TimeoutException("read timed out"))
```

with:

```python
        typed = classify_transport_error(TimeoutError("read timed out"))
```

In `components/agent-service/tests/test_preparation_prepare.py`, replace:

```python
    transport = PreparationFakeTransport(error=httpx.TimeoutException("read timed out"))
```

with:

```python
    transport = PreparationFakeTransport(error=TimeoutError("read timed out"))
```

and the import it made necessary goes with it. Replace:

```python
def test_a_timeout_returns_unprepared_with_the_timeout_status():
    import httpx

    config = _config()
```

with:

```python
def test_a_timeout_returns_unprepared_with_the_timeout_status():
    config = _config()
```

In `components/agent-service/tests/test_preparation_translation.py`, the second site. Replace:

```python
        transport = FakeTransport(error=httpx.TimeoutException("timed out"))
```

with:

```python
        transport = FakeTransport(error=TimeoutError("timed out"))
```

In `components/agent-service/tests/test_agent_toolset.py`, the preparer factory takes the transport. The first site builds no transport of its own; the second already has one.

The first site. Replace:

```python
    factory = build_preparer_factory(
        env={"VLLM_TRANSLATION_ENDPOINT": ENDPOINT, "VLLM_TRANSLATION_MODEL_ID": "test-model"}
    )
    first = factory(RunBudgetMonitor(run_budget()))
```

with:

```python
    factory = build_preparer_factory(
        env={"VLLM_TRANSLATION_ENDPOINT": ENDPOINT, "VLLM_TRANSLATION_MODEL_ID": "test-model"},
        transport=PreparationFakeTransport(),
    )
    first = factory(RunBudgetMonitor(run_budget()))
```

The second site: the factory no longer builds a transport, so the monkeypatch of a name that no longer exists goes. Replace:

```python
    import agent.orchestrator as orchestrator_module

    transport = PreparationFakeTransport(
```

with:

```python
    transport = PreparationFakeTransport(
```

and replace:

```python
    monkeypatch.setattr(orchestrator_module, "HttpxTransport", lambda tls_verify: transport)
    factory = build_preparer_factory(
        env={"VLLM_TRANSLATION_ENDPOINT": ENDPOINT, "VLLM_TRANSLATION_MODEL_ID": "test-model"}
    )
```

with:

```python
    factory = build_preparer_factory(
        env={"VLLM_TRANSLATION_ENDPOINT": ENDPOINT, "VLLM_TRANSLATION_MODEL_ID": "test-model"},
        transport=transport,
    )
```

The test no longer takes the monkeypatch fixture. Replace:

```python
def test_the_real_factory_counts_the_preparation_translation_on_the_usage_record(tmp_path, monkeypatch):
```

with:

```python
def test_the_real_factory_counts_the_preparation_translation_on_the_usage_record(tmp_path):
```

Two more test sites take the transport the core now requires.

In `components/agent-service/tests/test_agent_toolset.py`, the canned translator is a real client whose dispatch is overridden — it still needs a transport for its constructor. Replace:

```python
    def __init__(self, config, registry):
        super().__init__(config, registry)
```

with:

```python
    def __init__(self, config, registry):
        super().__init__(config, registry, transport=PreparationFakeTransport())
```

In `components/agent-service/tests/test_app_runs.py`, the fake preparer factory stands in for the real one, which now takes the transport. Replace:

```python
    def fake_factory(env=None):
        return lambda monitor, language=None: preparer
```

with:

```python
    def fake_factory(env=None, transport=None):
        return lambda monitor, language=None: preparer
```

And the scripted model client stands in for the production one, which now takes the transport too. Replace:

```python
    monkeypatch.setattr(
        app_module,
        "ProbeModelClient",
        lambda config: ScriptedLoopModel(multihop_turns(judge_reply='{"verdict": "grounded"}')),
    )
```

with:

```python
    monkeypatch.setattr(
        app_module,
        "ProbeModelClient",
        lambda config, transport=None: ScriptedLoopModel(multihop_turns(judge_reply='{"verdict": "grounded"}')),
    )
```

- [ ] **Step 14: The ratchets shrink**

The core no longer imports the HTTP library, the harness is a measurement surface, and the composition root builds the transport adapter — so it reaches the leaf adapters. Both ratchets move. Run:

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
cd components/agent-service
/tmp/genie-agent-service-venv/bin/python -m pytest tests/test_architecture.py -q
```

Expected: `2 failed, 7 passed`. The I/O ratchet reports:

```
E         Extra items in the right set:
E         ('preparation.translation', 'httpx')
E         ('agent.v06_harness', 'httpx')
```

— the two lines may come in either order, the set is unordered — and the adapter ratchet reports:

```
E         Extra items in the left set:
E         'app'
```

The right set is the list; the tree no longer has the violations. Delete this line from `KNOWN_IO_VIOLATIONS` in `components/agent-service/tests/test_architecture.py`:

```python
    ("agent.v06_harness", "httpx"),  # agent/v06_harness.py: the measurement harness lives in the seam package
```

and this one:

```python
    ("preparation.translation", "httpx"),  # preparation/translation.py: the HTTP transport lives in the core module
```

And the composition root joins the modules that import the leaf adapters — it builds the transport adapter, and that is the inversion the rules exist for. Replace:

```python
KNOWN_ADAPTER_IMPORTERS = {
    "agent.probe",  # agent/probe.py: the adapter assembly lives in the seam package
    "capabilities.search_knowledge",  # the capability builds its own adapters
}
```

with:

```python
KNOWN_ADAPTER_IMPORTERS = {
    "agent.probe",  # agent/probe.py: the adapter assembly lives in the seam package
    "app",  # app.py: the composition root builds the transport adapter
    "capabilities.search_knowledge",  # the capability builds its own adapters
}
```

Run the command again.

Expected: `9 passed in < 1s`.

- [ ] **Step 15: Run the suite and the lint**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
cd components/agent-service
/tmp/genie-agent-service-venv/bin/python -m pytest tests/ -q
uvx ruff@0.16.3 check app.py tracing.py capabilities/ preparation/ noagent/ agent/ tests/
uvx ruff@0.16.3 format --check app.py tracing.py capabilities/ preparation/ noagent/ agent/ tests/
```

Expected: `934 passed, 2 warnings` (the 932 of the baseline plus the two adapter tests); `All checks passed!`; `94 files already formatted`.

- [ ] **Step 16: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
git add components/agent-service/capabilities/adapters/httpx.py components/agent-service/preparation/translation.py components/agent-service/noagent/generation.py components/agent-service/noagent/pipeline.py components/agent-service/agent/orchestrator.py components/agent-service/agent/probe.py components/agent-service/agent/v06_harness.py components/agent-service/app.py components/agent-service/tests/
git commit -m "refactor(agent-service): the HTTP transport is an adapter the host supplies"
```

---

### Task 2: The admission lane is host infrastructure

**Files:**
- Create: `components/agent-service/lane.py`
- Modify: `components/agent-service/noagent/lane.py`
- Modify: `components/agent-service/noagent/pipeline.py`
- Modify: `components/agent-service/agent/orchestrator.py`
- Modify: `components/agent-service/app.py`
- Modify: `components/agent-service/tests/test_noagent_lane.py`
- Modify: `components/agent-service/tests/test_noagent_pipeline.py`
- Modify: `components/agent-service/tests/test_agent_orchestrator.py`
- Modify: `components/agent-service/tests/test_agent_toolset.py`
- Modify: `components/agent-service/tests/test_version_record.py`
- Modify: `components/agent-service/tests/test_app_runs.py`
- Modify: `components/agent-service/tests/test_architecture.py`
- Modify: `components/agent-service/Dockerfile`
- Modify: `.gitlab-ci.yml`

**Interfaces:**
- Consumes: `KNOWN_IO_VIOLATIONS` and `SERVICE_LAYOUT` from plan 1.
- Produces:
  - `noagent.lane.LaneBusyError` — unchanged.
  - `noagent.lane.Lane` — the port: `def acquire(self) -> AbstractAsyncContextManager[None]`.
  - `lane.AdmissionLane(slots: int, lock_path: str)` — the `flock` implementation, with `from_config(config)` and `acquire()`.

- [ ] **Step 1: Move the implementation to the host**

Create `components/agent-service/lane.py` with the content of today's `noagent/lane.py`, minus the core's imports and with the header rewritten:

```python
# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The admission lane — the flock slot-pool idiom.

Host infrastructure: the pool takes file locks on the host filesystem, so
the implementation lives beside the composition root. The core names the port
(:class:`noagent.lane.Lane`) and the refusal
(:class:`noagent.lane.LaneBusyError`), never this class.

Ported from the dataprep ingest-lane
(``genieai_dataprep_microservice.py:118-147``): N slot files derived from one
base path (slot 0 keeps the base name; slot i lives at ``<base>.i``), each
opened ``O_WRONLY | O_CREAT`` with ``O_NOFOLLOW`` and mode 0600, locked
non-blocking exclusive. A run claims any FREE slot; when every slot is held
the run is REFUSED with the typed :class:`LaneBusyError` BEFORE any stage
runs — refusal, never queueing.

The lock file handle is the slot: it travels with the acquisition and its
close releases the kernel lock on every exit path — return, exception and
cancellation alike (the handle is closed in ``finally``, and a cancellation
delivered while the slot is being claimed releases it too).

The deployment contract runs agent-service at exactly one
replica (flag-gated 0/1), so this intra-container pool IS the global bound;
scaling beyond one replica requires an explicitly shared coordination
mechanism (deferred). ``fcntl`` is POSIX-only: on a checkout
without it (Windows dev) the pool degrades to uncounted slots — the dev
host runs no serving traffic.
"""

import logging
import os
import threading
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import anyio

from noagent.config import NoAgentConfig
from noagent.lane import LaneBusyError

logger = logging.getLogger(__name__)


class _SlotClaim:
    """The slot handle a claiming thread hands over to its acquisition.

    The handle is the slot: whoever holds it holds the kernel lock, and the
    lock is released only when the handle is closed. A cancellation can
    arrive while the claiming thread is still working, so the ownership
    moves in one step — the thread registers the handle it claimed, and the
    acquisition closes it. A handle registered after the acquisition gave
    up is closed by the thread itself: a cancelled acquisition never leaves
    a slot locked.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._handle = None
        self._given_up = False

    def register(self, handle) -> bool:
        """Take ownership of a claimed handle; False when the acquisition
        already gave up (the caller closes the handle itself then)."""
        with self._lock:
            if self._given_up:
                return False
            self._handle = handle
            return True

    def release(self) -> None:
        """Close the claimed handle and refuse any later registration."""
        with self._lock:
            self._given_up = True
            handle, self._handle = self._handle, None
        if handle is not None:
            handle.close()


class AdmissionLane:
    """The N-slot admission pool every pipeline run passes through.

    The slot files live under the configured ``AGENT_LANE_LOCK_PATH`` base so
    a deployment can move them off the shared ``/tmp``; the tests redirect
    the base to a per-test directory, exactly like the dataprep lane.
    """

    def __init__(self, slots: int, lock_path: str):
        if slots < 1:
            raise ValueError("the lane needs at least one slot")
        self._slots = slots
        self._lock_path = lock_path

    @classmethod
    def from_config(cls, config: NoAgentConfig) -> "AdmissionLane":
        return cls(config.lane_slots, config.lane_lock_path)

    def _slot_path(self, index: int) -> str:
        return self._lock_path if index == 0 else f"{self._lock_path}.{index}"

    def _try_claim(self, index: int):
        """Open and non-blocking-lock one slot file, or None when held.

        ``O_NOFOLLOW`` keeps a pre-planted symlink in the shared lock
        directory from being followed; ``0600`` keeps the file private
        (the dataprep lane's hardening, kept verbatim).
        """
        path = self._slot_path(index)
        flags = os.O_WRONLY | os.O_CREAT
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        fd = os.open(path, flags, 0o600)
        lock_file = os.fdopen(fd, "w")
        try:
            import fcntl

            fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except ImportError:
            # No fcntl on this host (non-POSIX dev checkout): the handle is
            # the slot, single-process — return it uncounted.
            return lock_file
        except OSError:
            lock_file.close()
            return None
        except BaseException:
            # Never leak an open handle past a cancellation or any other
            # BaseException raised by the locking call itself.
            lock_file.close()
            raise
        return lock_file

    @asynccontextmanager
    async def acquire(self) -> AsyncIterator[None]:
        """Claim one slot for the duration of the block.

        Busy slots are skipped without blocking; the scan runs on the
        executor's thread pool (one ``os.open`` + ``flock`` per slot) so the
        event loop never stalls on the filesystem. When every slot is held
        the run raises :class:`LaneBusyError` — before any stage of the run
        has started. ``asyncio.CancelledError`` raised while waiting for the
        thread propagates untouched, and the slot the thread claimed on the
        way out is released with it.
        """
        claim = _SlotClaim()
        try:
            lock_file = await anyio.to_thread.run_sync(self._scan_for_free_slot, claim)
        except BaseException:
            # The acquisition gave up before the scan answered: whatever the
            # thread claimed is released here (or by the thread itself, if
            # it claims after this point) — a cancelled acquisition never
            # leaves a slot locked.
            claim.release()
            raise
        if lock_file is None:
            raise LaneBusyError(
                f"the admission lane is saturated: all {self._slots} slots are held; the run is refused"
            )
        try:
            yield
        finally:
            # The close releases the flock AND removes our fd — on return,
            # exception and cancellation alike.
            claim.release()

    def _scan_for_free_slot(self, claim: _SlotClaim):
        """One non-blocking pass over the slots; the open handle or None."""
        for index in range(self._slots):
            lock_file = self._try_claim(index)
            if lock_file is not None:
                if not claim.register(lock_file):
                    # The acquisition gave up while the scan ran: the slot
                    # must not stay locked.
                    lock_file.close()
                    return None
                return lock_file
        return None
```

- [ ] **Step 2: The core keeps the port and the refusal**

Rewrite `components/agent-service/noagent/lane.py` as the port:

```python
# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The admission lane's port: the slot the run holds, and the refusal.

The pool itself takes file locks on the host filesystem, so its
implementation is host infrastructure (``lane.py`` at the service root). What
the core needs is the shape it exchanges — one slot for the duration of the
run — and the typed refusal it answers.
"""

from contextlib import AbstractAsyncContextManager
from typing import Protocol


class LaneBusyError(RuntimeError):
    """Every lane slot is held; the run is refused before any stage runs.

    A typed refusal, not an exception-shaped retry hint: the caller answers
    saturation (deployed shape: the 429 the dataprep lane answers), never
    queues. ``asyncio.CancelledError`` never becomes one — it is a
    ``BaseException`` and the acquisition does not catch it.
    """


class Lane(Protocol):
    """One slot for the duration of the block; a refusal when none is free."""

    def acquire(self) -> AbstractAsyncContextManager[None]: ...
```

- [ ] **Step 3: The core names the port**

In `components/agent-service/noagent/pipeline.py`, replace:

```python
from .lane import AdmissionLane
```

with:

```python
from .lane import Lane
```

and replace:

```python
        lane: AdmissionLane,
```

with:

```python
        lane: Lane,
```

and the factory takes the lane as a parameter instead of building one. Replace:

```python
    @classmethod
    def create(
        cls, config: NoAgentConfig, capability, budget: OperationBudget, env=None, transport=None
    ) -> "NoAgentPipeline":
```

with:

```python
    @classmethod
    def create(
        cls, config: NoAgentConfig, capability, budget: OperationBudget, env=None, transport=None, lane=None
    ) -> "NoAgentPipeline":
```

and replace:

```python
        lane = AdmissionLane.from_config(config)
```

with:

```python
        if lane is None:
            raise ValueError("the pipeline needs an admission lane; the composition root builds it")
```

In `components/agent-service/agent/orchestrator.py`, replace:

```python
from noagent.lane import AdmissionLane, LaneBusyError
```

with:

```python
from noagent.lane import Lane, LaneBusyError
```

and replace:

```python
        lane: AdmissionLane,
```

with:

```python
        lane: Lane,
```

- [ ] **Step 4: The composition root builds the lane**

In `components/agent-service/app.py`, the implementation's import moves to its new home. Replace:

```python
from capabilities.contract import CallerContext
from noagent.config import NoAgentConfig
from noagent.lane import AdmissionLane
from tracing import setup_tracing
```

with:

```python
from capabilities.contract import CallerContext
from lane import AdmissionLane
from noagent.config import NoAgentConfig
from tracing import setup_tracing
```

The lane is built where it is built today.

- [ ] **Step 5: The tests follow the implementation**

The tests import the implementation. It moved; the imports follow.

Every test that names the implementation names it from its new home. The name lands where the lint rule `I` wants it: `lane` sorts before `noagent`.

In `components/agent-service/tests/test_noagent_lane.py`, replace:

```python
from noagent.lane import AdmissionLane, LaneBusyError
```

with:

```python
from lane import AdmissionLane
from noagent.lane import LaneBusyError
```

In `components/agent-service/tests/test_noagent_pipeline.py`, the implementation's import moves ahead of the `noagent` block — `lane` sorts before `noagent`. Replace:

```python
from noagent.config import NoAgentConfig
from noagent.generation import GenerationTransientError
from noagent.lane import AdmissionLane, LaneBusyError
```

with:

```python
from lane import AdmissionLane
from noagent.config import NoAgentConfig
from noagent.generation import GenerationTransientError
from noagent.lane import LaneBusyError
```

In `components/agent-service/tests/test_agent_orchestrator.py`, `tests/test_agent_toolset.py`, `tests/test_version_record.py` and `tests/test_app_runs.py`, the import changes name in place — `lane` sorts right after the `capabilities` block they already carry. Replace every:

```python
from noagent.lane import AdmissionLane
```

with:

```python
from lane import AdmissionLane
```

- [ ] **Step 6: The image and the lint lane carry the host module**

In `components/agent-service/Dockerfile`, replace:

```
COPY app.py tracing.py ./
```

with:

```
COPY app.py tracing.py lane.py ./
```

In `.gitlab-ci.yml`, the agent service's lint job. Replace:

```
    - ruff check app.py tracing.py capabilities/ preparation/ noagent/ agent/ tests/
    - ruff format --check app.py tracing.py capabilities/ preparation/ noagent/ agent/ tests/
```

with:

```
    - ruff check app.py tracing.py lane.py capabilities/ preparation/ noagent/ agent/ tests/
    - ruff format --check app.py tracing.py lane.py capabilities/ preparation/ noagent/ agent/ tests/
```

- [ ] **Step 7: The ratchet shrinks, and the layout learns the host module**

The lane's implementation no longer sits in the core. The host gains a module, so the layout names it.

In `components/agent-service/tests/test_architecture.py`, the layout names the host module. Replace:

```python
SERVICE_LAYOUT = Layout(
    host=("app", "tracing"),
```

with:

```python
SERVICE_LAYOUT = Layout(
    host=("app", "tracing", "lane"),
```

The planted-violation probe names it too — its host gains a module, so the synthetic package gains one. Replace:

```python
    layout = Layout(
        host=("app", "tracing"),
        core_packages=("core",),
        core_modules=("contract",),
        leaf_adapters="adapters",
        capability="capability",
        measurement=("measure",),
    )
```

with:

```python
    layout = Layout(
        host=("app", "tracing", "lane"),
        core_packages=("core",),
        core_modules=("contract",),
        leaf_adapters="adapters",
        capability="capability",
        measurement=("measure",),
    )
```

and the synthetic package gains the host module:

```python
        "app.py": "import fakepkg.adapters.x\nimport requests\n",
```

with:

```python
        "app.py": "import fakepkg.adapters.x\nimport requests\n",
        "lane.py": '"""The host lane."""\n',
```

Then run:

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
cd components/agent-service
/tmp/genie-agent-service-venv/bin/python -m pytest tests/test_architecture.py -q
```

Expected: `1 failed, 8 passed` in `test_core_modules_import_no_io_library`, with:

```
E         Extra items in the right set:
E         ('noagent.lane', 'fcntl')
```

Delete this line from `KNOWN_IO_VIOLATIONS`:

```python
    ("noagent.lane", "fcntl"),  # noagent/lane.py: the admission lane takes file locks from inside a core package
```

Run the command again.

Expected: `9 passed in < 1s`.

- [ ] **Step 8: Run the suite and the lint**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
cd components/agent-service
/tmp/genie-agent-service-venv/bin/python -m pytest tests/ -q
uvx ruff@0.16.3 check app.py tracing.py lane.py capabilities/ preparation/ noagent/ agent/ tests/
uvx ruff@0.16.3 format --check app.py tracing.py lane.py capabilities/ preparation/ noagent/ agent/ tests/
```

Expected: `934 passed, 2 warnings` — the same count as Task 1; `All checks passed!`; `95 files already formatted`.

- [ ] **Step 9: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
git add components/agent-service/lane.py components/agent-service/noagent/lane.py components/agent-service/noagent/pipeline.py components/agent-service/agent/orchestrator.py components/agent-service/app.py components/agent-service/tests/ components/agent-service/Dockerfile .gitlab-ci.yml
git commit -m "refactor(agent-service): the admission lane is host infrastructure"
```

---

## Final verification

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
git log --oneline -3
git status --short
cd components/agent-service
/tmp/genie-agent-service-venv/bin/python -m pytest tests/ -q
uvx ruff@0.16.3 check app.py tracing.py lane.py capabilities/ preparation/ noagent/ agent/ tests/
uvx ruff@0.16.3 format --check app.py tracing.py lane.py capabilities/ preparation/ noagent/ agent/ tests/
```

Expected:

- Two commits on top of plan 1's: `refactor(agent-service): the admission lane is host infrastructure`, then `refactor(agent-service): the HTTP transport is an adapter the host supplies`.
- `git status --short` prints nothing.
- `934 passed, 2 warnings`.
- `All checks passed!` and `95 files already formatted`.

### What this plan establishes

| Design item | Where | Evidence |
|---|---|---|
| Leak 3 closed (§2.3) | `capabilities/adapters/httpx.py`, the constructors | the core names no HTTP library; `test_core_modules_import_no_io_library` loses the pair |
| Leak 6 closed (§2.3) | `lane.py` (host), `noagent/lane.py` (port) | the core takes no file lock; the ratchet loses the pair |
| The harness is not core (§2.4) | the layout's `measurement` layer | the core rules stop reading the harness; the ratchet loses its pair |
| The timeout keeps its meaning | `TransportTimeoutError`, `classify_transport_error` | the adapter's own test, plus the three classifier tests |
| The composition root supplies | `app.py` | the host builds the transport and the lane; the core receives them |

### What it leaves open

- Three listed violations, closed by plan 3 (the probe leaves `agent/`: its `arango` import and its two cross-layer edges).
- The harness's file still lives in `agent/`; plan 3 moves it to the measurement package the layout already names.
- The core's factories still compose (`NoAgentPipeline.create`); plan 3 moves them.
- The HTTP adapter lives in the capability's adapter package, next to the corpus adapters: one adapter package for the service. A separate top-level package would be the alternative; the corpus adapters' frozen paths decide it.

## Landing

The two commits stay on `feat/agentic-foundations/architecture` until the operator says otherwise. On their word:

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
git push
```

Then start exactly one CI monitor for the merge request's pipeline, in the background, and read the pipeline id from the push output: `~/.local/bin/ci-monitor.sh gitlab <pipeline_id>`.
