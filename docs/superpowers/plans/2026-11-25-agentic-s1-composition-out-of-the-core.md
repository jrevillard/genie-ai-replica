# Agentic S1, plan 3 of 5 — the composition leaves the core: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The probe stops hosting the production model client: the model call's contract becomes a port, and the client becomes an adapter that names only the ports. The core names only the shapes it exchanges; the host builds the implementations.

**Architecture:** Two moves. (1) The model call's contract — `ModelTurn`, `ToolCallRequest`, the `LoopModelClient` protocol, the model's knobs and the model's request vocabulary — leaves the core for a port module (`capabilities/model.py`), because an adapter may not import the core. (2) The production model client becomes the vLLM adapter (`capabilities/adapters/vllm.py`): the config splits (the reading stays in the core, the shape travels with the adapter), the client is renamed after what it talks to, and the probe keeps only the measurement half.

**What this plan does NOT do.** The adapter assembly and the search capability's factory leave the core in plan 5, not here: the probe (still in `agent/`) calls the assembly, and a core module may not import the host. The probe moves to the measurement package in plan 4; once it is there, the measurement may reach the host, and the composition's move becomes clean.

**Tech Stack:** Python 3.11, pytest 9.1.1, pytestarch 5.1.1 (the rules of plan 1), ruff 0.16.3.

**Spec:** `docs/superpowers/specs/2026-11-25-agentic-iteration-2-architecture-design.md` — §2.3 (the leaks), §2.4 (the layers), §2.5 (the rules). Plan 1: `docs/superpowers/plans/2026-11-25-agentic-s1-architecture-rules.md`. Plan 2: `docs/superpowers/plans/2026-11-25-agentic-s1-composition-transport-lane.md`.

## Global Constraints

- **Where the work lands.** Branch `feat/agentic-foundations/architecture` (merge request !1088, whose target is `feat/agentic-foundations/prd`). Commit on this branch only. Do not push without the operator's word, do not touch `main` or the PRD branch, never run `git stash`, never run `git reset --hard`.
- **No path is written in this plan.** Every command block starts with the same guard, which moves to the root of the checkout it is run from and refuses anything but that branch.
- **Python floor.** `requires-python = ">=3.11"`; the CI lanes run `python:3.11-slim`.
- **Frozen behavior.** The RAG capability's behavior is frozen (`docs/baselines/v02-opea-query-path-contract.md`). This plan touches the capability's *wiring*, never its answers: `tests/test_equivalence_v02.py` stays green and untouched.
- **The evidence strings are frozen.** The version record's `PRODUCER_ID`, the probe's evidence and the harness's `PRODUCER_ID` keep their bytes; a move does not rewrite a recorded string. A docstring that NAMES a moved class is corrected; a recorded VALUE is not.
- **Ruff.** CI pin `RUFF_VERSION` is `0.16.3`; py311, line length 120, rules `E, W, F, I, UP, B, SIM`.
- **Lint locally with `--no-cache`.** A stale `.ruff_cache` answers green on a tree the CI rejects (it happened once already: 2026-11-26). Every lint command in this plan passes `--no-cache`.
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

The last command prints `934 passed, 2 warnings in < a few seconds>` — the state plan 2 leaves. If the venv already exists, skip `uv venv` and keep the `uv pip install` line.

## Where this plan sits

Slice S1 is delivered as five plans. This is the third.

| Plan | Content | State it leaves |
|---|---|---|
| Plan 1 — architecture rules | the rules; leak 4 (the executor) and the constant of leak 5 | four I/O violations and two cross-layer violations listed |
| Plan 2 — transport and lane | the HTTP transport and the admission lane leave the core | two I/O violations and two cross-layer violations listed |
| **This one** | the model call's contract, the production client and the assembly leave the core | one I/O violation and one cross-layer violation listed |
| Plan 4 — the measurement surfaces | the probe and the harness move to their own package | no listed violation; rule R3's set is the composition root and the capability |
| Plan 5 — the composition | the adapter assembly and the capability's factory leave the core | the core composes nothing |
| Plan 6 — the runtime port, step 1 | `RuntimeDriver` extraction behind a byte-identical event stream | stream gate recorded |

The ratchets of plan 1 (`KNOWN_IO_VIOLATIONS`, `KNOWN_INTERNAL_VIOLATIONS`, `KNOWN_ADAPTER_IMPORTERS` in `components/agent-service/tests/test_architecture.py`) list, after this plan:

| Rule | Pair left | Closed by |
|---|---|---|
| R1 | `("agent.probe", "arango")` | plan 4 (the probe leaves the core) |
| R2 | `("agent.probe", "capabilities.adapters")` | plan 4 (the probe leaves the core) |
| R2 | `("agent.probe", "capabilities.search_knowledge")` | plan 4 (the probe leaves the core) |

Plan 3 does not move these: the probe still reaches the adapters (the client's module is one of them) and still imports `arango` inside the assembly it hosts.

## File map

| File | Responsibility | Task |
|---|---|---|
| `components/agent-service/capabilities/model.py` | the model call's contract: the two dataclasses and the protocol | 1 |
| `components/agent-service/agent/loop.py` | the loop; the contract leaves it | 1 |
| `components/agent-service/capabilities/adapters/vllm.py` | the vLLM model client and its config | 2 |
| `components/agent-service/agent/probe.py` | the probe; the client and the model's config leave it | 2 |
| `components/agent-service/app.py` | the composition root: it builds the client and the assembly | 2, 3 |
| `components/agent-service/assembly.py` | the adapter assembly (host) | 3 |
| `components/agent-service/capabilities/search_knowledge.py` | the capability; its factory leaves it | 3 |
| `components/agent-service/tests/test_architecture.py` | the layout, the ports and the ratchet lists | 1, 2, 3 |
| `components/agent-service/tests/` | the sites the moves touch | 1, 2, 3 |

## Decisions taken while writing this plan

Each was checked against the code before being written here.

- **The model call's contract becomes a port.** The vLLM client returns a `ModelTurn` and parses `ToolCallRequest`s; those two dataclasses and the `LoopModelClient` protocol live in `agent/loop.py` (the core). An adapter may not import the core — rule L1 binds the leaf adapters to the ports — so the contract moves to `capabilities/model.py` and joins `PORTS`. The core keeps using the same names, from the new home.
- **The client is renamed after what it talks to.** `ProbeModelClient` is the PRODUCTION model client (the run surface reuses it); in the adapters package the name would lie. It becomes `VllmModelClient`, its error `VllmTransientError` and its config `VllmModelConfig`.
- **The config splits, but the reading does not.** `ProbeConfig` carried the model leg (endpoint, model id, bearer, discovery bearer, TLS posture, timeouts, window tiers) and the measurement leg (the port assembly's URLs, the authorized graphs and repos, the caller's bearer). The model leg becomes the PORT's shape (`VllmModelConfig`, a pure dataclass); the deployed knob surface is still read in ONE place — the core's `NoAgentConfig.load` — which builds the port's shape in one method. The measurement leg stays with the probe.
- **The model's vocabulary moves to the port.** The identity sources (`MODEL_SOURCE_*`), the recorded sampling params, the two choice readers, the prompt-size estimate and the numeric coercion are read by the adapter and by the core: they are the model's request and response vocabulary, so they live in the port, and the core imports them from there.
- **The assembly lives in the host, not in the adapters.** `build_stateless_adapters` imports the capability, and rule L1 binds the leaf adapters to the ports — an assembly module in the adapters package would break it. The host owns composition: `assembly.py`, beside `app.py`.
- **The capability's factory leaves the capability.** `SearchKnowledgeCapability.create()` assembles four adapters from the environment: composition, not capability. The host calls the constructor instead.

---

### Task 1: The model call's contract becomes a port

**Files:**
- Create: `components/agent-service/capabilities/model.py`
- Modify: `components/agent-service/agent/loop.py`
- Modify: `components/agent-service/agent/probe.py`
- Modify: `components/agent-service/agent/__init__.py`
- Modify: `components/agent-service/tests/test_architecture.py`
- Modify: `components/agent-service/tests/test_agent_loop.py`
- Modify: `components/agent-service/tests/test_agent_probe.py`
- Modify: `components/agent-service/tests/test_agent_orchestrator.py`
- Modify: `components/agent-service/tests/test_agent_toolset.py`
- Modify: `components/agent-service/tests/test_agent_verification.py`
- Modify: `components/agent-service/tests/test_version_record.py`
- Modify: `components/agent-service/tests/conftest.py`

**Interfaces:**
- Consumes: `PORTS` and `SERVICE_LAYOUT` from plan 1.
- Produces:
  - `capabilities.model.ToolCallRequest` — frozen dataclass: `call_id: str`, `name: str`, `arguments: dict`.
  - `capabilities.model.ModelTurn` — frozen dataclass: `content`, `tool_calls`, `finish_reason`, `prompt_tokens`, `completion_tokens`.
  - `capabilities.model.LoopModelClient` — the protocol the loop drives.

- [ ] **Step 1: Create the port module**

Create `components/agent-service/capabilities/model.py`:

```python
# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The model call's contract: what a model turn IS, and the seam that
produces one.

The two dataclasses and the protocol live here, not in the core's loop:
the client that produces a turn is an adapter, and an adapter may not
import the core (rule L1 binds the leaf adapters to the ports). The core
and the adapters exchange these shapes, so they are a port.
"""

import math
from dataclasses import dataclass
from typing import Protocol

# The model identity's vocabulary: where the served model id came from.
MODEL_SOURCE_OVERRIDE = "override"
MODEL_SOURCE_DISCOVERED = "discovered"
MODEL_SOURCE_UNRESOLVED = "unresolved"

# The recorded request-level sampling params, shared by every
# chat/completions consumer in the component — one home, so a change to the
# deployed convention cannot leave one consumer measuring a different
# request than the others.
RECORDED_SAMPLING_PARAMS = {"temperature": 0.01, "top_p": 0.95, "frequency_penalty": 0.0, "stream": False}

# The prompt-size estimate the per-call output bound is computed against:
# the characters per token, the prompt offset the estimate carries, and the
# safety room the bound keeps for the endpoint's own framing.
MODEL_CHARS_PER_TOKEN_ESTIMATE = 4
MODEL_PROMPT_OFFSET_TOKENS = 20
MODEL_INPUT_SAFETY_TOKENS = 128


def chat_choice(body: dict) -> tuple[dict | None, str | None]:
    """The first choice and its finish reason out of an OpenAI-shaped chat
    response — the ONE shape reader for every chat/completions consumer in
    the no-agent package (the generation client and the answer translator;
    each maps the outcome to its own failure style)."""
    choices = body.get("choices") or []
    choice = choices[0] if choices and isinstance(choices[0], dict) else None
    return choice, (choice or {}).get("finish_reason")


def chat_choice_content(choice: dict):
    """The message content of one choice (None when the shape carries none)."""
    return (choice.get("message") or {}).get("content")


@dataclass(frozen=True)
class ToolCallRequest:
    """One tool call the model asked for: its wire id, name, arguments."""

    call_id: str
    name: str
    arguments: dict


@dataclass(frozen=True)
class ModelTurn:
    """One model call's outcome, in the loop's own shape.

    ``content`` is the final text when the turn answers; ``tool_calls``
    carries the requested dispatches when the turn works. Usage is the
    token accounting as the endpoint served it (``None`` when the endpoint
    discarded it) — the evidence record reports usage as served, never a
    local estimate.
    """

    content: str | None = None
    tool_calls: tuple[ToolCallRequest, ...] = ()
    finish_reason: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


class LoopModelClient(Protocol):
    """The model-call seam the loop drives — one non-streaming completion.

    The concrete OpenAI-compatible client is the runtime's business (the
    probe carries one, shared with the run surface); the loop depends on
    this shape only, which is what keeps the loop runtime-swappable.
    ``max_output_tokens`` is the remaining token allowance the monitor
    hands the call — the token bound riding the request (``None`` when the
    allowance is unknowable and the field must be omitted, the deployed
    only-when-configured rule). The IMPLEMENTER caps the bound to what one
    call can serve — ``min(bound, window room)``, omitting the field when
    there is no room — because a cumulative RUN allowance may exceed the
    endpoint's window, and an unanchored ``max_tokens`` is rejected
    outright.
    """

    async def complete(
        self, messages: list[dict], tool_definitions: tuple[dict, ...], *, max_output_tokens: int | None
    ) -> ModelTurn: ...


def resolve_window_tokens(config, detected: int | None) -> int:
    """The usable context window in tokens, in the deployed three tiers: an
    explicit consumer-side cap (``AGENT_WINDOW_OVERRIDE_TOKENS``), then the
    probed ``max_model_len``, then the configured fallback
    (``MAX_MODEL_LEN_TEXTGEN``). Pure — the caller supplies the probed
    value (the ``ModelEndpointCache`` here, the vLLM client's own single
    discovery) so both consumers share one tier home.
    """
    if config.window_override_tokens > 0:
        return config.window_override_tokens
    if detected:
        return detected
    return config.fallback_window_tokens


def coerce_int(value) -> int | None:
    """Coerce a JSON scalar to ``int``: bools rejected, digit strings accepted.

    Shared stance for every numeric field read out of a model-server payload
    (context windows, tokenize counts): proxies serialize numbers as digit
    strings, and a boolean is never a count.

    A digit string is a plain run of ASCII decimal digits. The ``int()``
    builtin is looser — it also accepts PEP 515 underscore separators
    (``"1_0"`` becomes 10), a leading sign (``"+5"``) and non-ASCII decimal
    digits (``"١٢٣"`` becomes 123) — and a mangled count silently
    miscounts the served tokens.
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        # 12.0 is a serialization of 12; 12.5 is garbage.
        return int(value) if math.isfinite(value) and int(value) == value else None
    if isinstance(value, str):
        text = value.strip()
        return int(text) if text.isascii() and text.isdecimal() else None
    return None


def coerce_sane_int(value) -> int | None:
    """Coerce a JSON scalar to an int inside the sane token bound, or None.

    The one home for the coercion-then-bound predicate every numeric field
    read out of a model-server payload applies (served context windows,
    usage counts): the coercion is :func:`coerce_int`, and a value past
    ``MAX_SANE_TOKENS`` (or not positive) is dropped — an absurd value
    would silently disable the overflow guard it feeds.
    """
    coerced = coerce_int(value)
    if coerced is not None and 0 < coerced <= MAX_SANE_TOKENS:
        return coerced
    return None


MAX_SANE_TOKENS = 10_000_000


@dataclass(frozen=True)
class VllmModelConfig:
    """The model leg's knobs — the endpoint, the model, the postures.

    A pure shape: the deployed knob surface is read by the core's config
    (``NoAgentConfig``), which builds this one — one home for the reading
    rules, one home for the shape the adapter takes.
    """

    generation_endpoint: str
    model_id_override: str
    bearer: str | None
    discovery_bearer: str | None
    tls_verify: bool
    llm_timeout_seconds: float
    discovery_timeout_seconds: float
    window_override_tokens: int
    fallback_window_tokens: int
```

- [ ] **Step 2: The loop names the port**

In `components/agent-service/agent/loop.py`, delete the two dataclasses and the protocol — the whole blocks, from `@dataclass(frozen=True)` before `class ToolCallRequest` to the end of the `LoopModelClient` protocol — and import them from the port instead.

Delete:

```python
@dataclass(frozen=True)
class ToolCallRequest:
    """One tool call the model asked for: its wire id, name, arguments."""

    call_id: str
    name: str
    arguments: dict


@dataclass(frozen=True)
class ModelTurn:
    """One model call's outcome, in the loop's own shape.

    ``content`` is the final text when the turn answers; ``tool_calls``
    carries the requested dispatches when the turn works. Usage is the
    token accounting as the endpoint served it (``None`` when the endpoint
    discarded it) — the evidence record reports usage as served, never a
    local estimate.
    """

    content: str | None = None
    tool_calls: tuple[ToolCallRequest, ...] = ()
    finish_reason: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


class LoopModelClient(Protocol):
    """The model-call seam the loop drives — one non-streaming completion.

    The concrete OpenAI-compatible client is the runtime's business (the
    probe carries one, shared with the run surface); the loop depends on
    this shape only, which is what keeps the loop runtime-swappable.
    ``max_output_tokens`` is the remaining token allowance the monitor
    hands the call — the token bound riding the request (``None`` when the
    allowance is unknowable and the field must be omitted, the deployed
    only-when-configured rule). The IMPLEMENTER caps the bound to what one
    call can serve — ``min(bound, window room)``, omitting the field when
    there is no room — because a cumulative RUN allowance may exceed the
    endpoint's window, and an unanchored ``max_tokens`` is rejected
    outright.
    """
```

and add the import to the module's first-party block:

```python
from capabilities.model import LoopModelClient, ModelTurn, ToolCallRequest
```

The `dataclass` and `Protocol` imports stay if the module still uses them; drop the ones that become unused (the lint rule `F401` says so).

- [ ] **Step 3: The probe names the port**

In `components/agent-service/agent/probe.py`, the client builds a `ModelTurn` and parses `ToolCallRequest`s. Its import of the two names leaves `agent.loop` for the port. Replace the names in the module's first-party block:

```python
from .loop import (
    AgentLoop,
    ModelTurn,
    ToolCallRequest,
)
```

with:

```python
from .loop import AgentLoop
```

and add:

```python
from capabilities.model import ModelTurn, ToolCallRequest
```

- [ ] **Step 4: The package's re-exports follow**

In `components/agent-service/agent/__init__.py`, the names move with the contract. Replace the imports of the three names from `.loop` with imports from the port, and keep the `__all__` entries as they are.

- [ ] **Step 5: The tests follow**

Every test that names the contract names it from its new home. In `components/agent-service/tests/test_agent_loop.py`, `tests/test_agent_probe.py`, `tests/test_agent_orchestrator.py`, `tests/test_agent_toolset.py`, `tests/test_agent_verification.py`, `tests/test_version_record.py` and `tests/conftest.py`, replace every:

```python
from agent.loop import (
    ...
    ModelTurn,
    ...
    ToolCallRequest,
    ...
)
```

with the same names taken from the port:

```python
from capabilities.model import ModelTurn, ToolCallRequest
```

and drop the two names from the `agent.loop` import. The files that import only these two names replace the whole line.

- [ ] **Step 6: The layout and the ports learn the module**

In `components/agent-service/tests/test_architecture.py`, the port module joins the ports and the core's modules. Replace:

```python
PORTS = ("capabilities.contract", "capabilities.identifiers")
```

with:

```python
PORTS = ("capabilities.contract", "capabilities.identifiers", "capabilities.model")
```

and in `SERVICE_LAYOUT`, add the module to `core_modules`:

```python
        "capabilities.identifiers",
        "capabilities.model",
```

The planted-violation probe declares the same port. Replace:

```python
    layers = {"ports": ("contract",), "leaf adapters": ("adapters",), "capability": ("capability",)}
```

with:

```python
    layers = {"ports": ("contract", "model"), "leaf adapters": ("adapters",), "capability": ("capability",)}
```

and the synthetic package gains the port's module:

```python
        "contract.py": "",
```

becomes:

```python
        "contract.py": "",
        "model.py": "",
```

The probe's own layout declares it too:

```python
        core_modules=("contract",),
```

becomes:

```python
        core_modules=("contract", "model"),
```

- [ ] **Step 7: Run the suite and the lint**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
cd components/agent-service
/tmp/genie-agent-service-venv/bin/python -m pytest tests/ -q
uvx ruff@0.16.3 check --no-cache app.py tracing.py lane.py capabilities/ preparation/ noagent/ agent/ tests/
uvx ruff@0.16.3 format --no-cache --check app.py tracing.py lane.py capabilities/ preparation/ noagent/ agent/ tests/
```

Expected: `934 passed, 2 warnings`; `All checks passed!`; `95 files already formatted`.

- [ ] **Step 8: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
git add components/agent-service/capabilities/model.py components/agent-service/agent/ components/agent-service/tests/
git commit -m "refactor(agent-service): the model call's contract is a port"
```

---

### Task 2: The production model client becomes the vLLM adapter

**Files:**
- Create: `components/agent-service/capabilities/adapters/vllm.py`
- Modify: `components/agent-service/agent/probe.py`
- Modify: `components/agent-service/agent/v06_harness.py`
- Modify: `components/agent-service/agent/__init__.py`
- Modify: `components/agent-service/app.py`
- Modify: `components/agent-service/tests/test_agent_probe.py`
- Modify: `components/agent-service/tests/test_agent_toolset.py`
- Modify: `components/agent-service/tests/test_version_record.py`
- Modify: `components/agent-service/tests/conftest.py`

**Interfaces:**
- Consumes: `capabilities.model.ModelTurn` from Task 1.
- Produces:
  - `capabilities.model.VllmModelConfig` — the model leg as a PURE shape: `generation_endpoint`, `model_id_override`, `bearer`, `discovery_bearer`, `tls_verify`, `llm_timeout_seconds`, `discovery_timeout_seconds`, `window_override_tokens`, `fallback_window_tokens`. The reading of the deployed knobs stays in the core's config (`NoAgentConfig.load`), which builds this shape in one method (`NoAgentConfig.model_config()`) — one home for the reading rules, one home for the shape the adapter takes. The port module also carries the model's vocabulary: the identity sources, the recorded sampling params, the choice readers, the prompt-size estimate and the numeric coercion (`coerce_int`, `coerce_sane_int`, `MAX_SANE_TOKENS`) — everything the adapter needs and may not read from the core.
  - `capabilities.adapters.vllm.VllmModelClient(config, transport)` — the OpenAI-compatible client.
  - `capabilities.adapters.vllm.VllmTransientError` — the typed transient failure.

- [ ] **Step 1: Create the adapter**

Create `components/agent-service/capabilities/adapters/vllm.py` with the client that today lives in `agent/probe.py`, renamed:

- `ProbeTransientError` becomes `VllmTransientError`.
- `ProbeModelClient` becomes `VllmModelClient`, and its constructor takes `VllmModelConfig`.
- The class body's names follow: `self._config.probe_bearer` becomes `self._config.discovery_bearer`, and `self._config.probe_timeout_seconds` becomes `self._config.discovery_timeout_seconds`.
- The module's imports: `json`, the dataclasses it uses, `ToolCallRequest` and `ModelTurn` from `capabilities.model`, and `coerce_sane_int` from `preparation.translation`.

The module's header:

```python
# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The vLLM model client — the OpenAI-compatible completion over the injected
transport.

The client mirrors the component's recorded conventions — non-streaming, the
fixed sampling params, model discovery from ``/v1/models`` with the
``VLLM_LLM_MODEL_ID`` override — over the injected transport (the same
seam ``PreparationFakeTransport`` answers in tests). One client per
process; the discovered model id is resolved once.

It is an adapter: the core drives the ``LoopModelClient`` protocol, and the
shapes it returns are the port's.
"""
```

- [ ] **Step 2: The config splits**

In `components/agent-service/agent/probe.py`, `ProbeConfig` keeps the MEASUREMENT half:

```python
@dataclass(frozen=True)
class ProbeConfig:
    """The probe's env knobs — the port assembly's side.

    The model leg travels with the client that reads it
    (``capabilities.adapters.vllm.VllmModelConfig``); what stays here is
    the assembly the probe performs: the corpus endpoints, the authorized
    graphs and repos, and the caller's bearer.
    """

    docrepo_url: str
    okf_url: str
    authorized_graphs: str
    authorized_repos: str
    user_bearer: str | None

    @classmethod
    def load(cls, env=None) -> "ProbeConfig":
        source = os.environ if env is None else env
        return cls(
            docrepo_url=str(source.get("AGENT_DOCREPO_URL", "")),
            okf_url=str(source.get("AGENT_OKF_URL", "")),
            authorized_graphs=str(source.get("AGENT_AUTHORIZED_GRAPHS", "")),
            authorized_repos=str(source.get("AGENT_AUTHORIZED_REPOS", "")),
            user_bearer=source.get("AGENT_PROBE_BEARER"),
        )
```

- [ ] **Step 3: The probe names the adapter**

In `components/agent-service/agent/probe.py`, the client's names leave the module: delete the `ProbeTransientError` and `ProbeModelClient` blocks (they moved verbatim), and import the adapter's names:

```python
from capabilities.adapters.vllm import VllmModelClient, VllmModelConfig, VllmTransientError
```

The probe's own live entry builds the client with the model's config:

```python
    model_config = VllmModelConfig.load(env)
    transport = HttpxTransport(model_config.tls_verify)
    model_client = VllmModelClient(model_config, transport)
```

- [ ] **Step 4: The host builds the client**

In `components/agent-service/app.py`, the client and its config come from the adapter:

```python
from capabilities.adapters.vllm import VllmModelClient, VllmModelConfig
```

and in `_build_orchestrator`:

```python
    model_config = VllmModelConfig.load(env)
    transport = HttpxTransport(model_config.tls_verify)
    model_client = VllmModelClient(model_config, transport)
```

- [ ] **Step 5: The harness and the tests follow the rename**

In `components/agent-service/agent/v06_harness.py`, replace:

```python
from .probe import PROBE_RUN_BUDGET, ProbeConfig, ProbeModelClient
```

with:

```python
from .probe import PROBE_RUN_BUDGET, ProbeConfig
```

and add:

```python
from capabilities.adapters.vllm import VllmModelClient
```

then replace the client's use:

```python
            ProbeModelClient(config, transport=_DispatchRecordingTransport(transport, recorder)), token, recorder
```

with:

```python
            VllmModelClient(config, transport=_DispatchRecordingTransport(transport, recorder)), token, recorder
```

In `components/agent-service/tests/test_agent_probe.py`, `tests/test_agent_toolset.py`, `tests/test_version_record.py` and `tests/conftest.py`, the client's name and its config come from the adapter:

```python
from capabilities.adapters.vllm import VllmModelClient, VllmModelConfig
```

- [ ] **Step 6: Run the suite and the lint**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
cd components/agent-service
/tmp/genie-agent-service-venv/bin/python -m pytest tests/ -q
uvx ruff@0.16.3 check --no-cache app.py tracing.py lane.py capabilities/ preparation/ noagent/ agent/ tests/
uvx ruff@0.16.3 format --no-cache --check app.py tracing.py lane.py capabilities/ preparation/ noagent/ agent/ tests/
```

Expected: `934 passed, 2 warnings`; `All checks passed!`; `96 files already formatted`.

- [ ] **Step 7: The ratchet shrinks**

The probe no longer imports the HTTP library of its own — it names the adapter instead, which it already did. Run:

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
cd components/agent-service
/tmp/genie-agent-service-venv/bin/python -m pytest tests/test_architecture.py -q
```

Expected: `9 passed in < 1s` — the ratchets do not move in this task: the probe still reaches the leaf adapters (the client's module is one of them) and the tree's violations are unchanged.

- [ ] **Step 8: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
git add components/agent-service/capabilities/adapters/vllm.py components/agent-service/agent/ components/agent-service/app.py components/agent-service/tests/
git commit -m "refactor(agent-service): the production model client is the vLLM adapter"
```

---

### Task 3: The composition leaves the core

**Files:**
- Create: `components/agent-service/assembly.py`
- Modify: `components/agent-service/agent/probe.py`
- Modify: `components/agent-service/app.py`
- Modify: `components/agent-service/capabilities/search_knowledge.py`
- Modify: `components/agent-service/tests/test_architecture.py`
- Modify: `components/agent-service/Dockerfile`
- Modify: `.gitlab-ci.yml`

**Interfaces:**
- Consumes: `VllmModelConfig` from Task 2.
- Produces:
  - `assembly.StatelessAdapters` — the shared half of the port assembly.
  - `assembly.build_stateless_adapters(env=None) -> StatelessAdapters` — the assembly.
  - `capabilities.search_knowledge.SearchKnowledgeCapability(...)` — the capability's constructor, called by the host.

- [ ] **Step 1: The host owns the assembly**

Create `components/agent-service/assembly.py` with the content of today's `build_stateless_adapters` and `StatelessAdapters` (from `agent/probe.py`), with the header rewritten:

```python
# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The port assembly: the read adapters and the inner search port.

Host infrastructure: the assembly is composition — it builds the adapters
the requests read through and binds a caller's context to them — and the
composition root owns it (the probe measures the same assembly, and calls
the same function).
"""
```

Its imports: the four adapters it builds, the capability, the executor, and the environment configs.

- [ ] **Step 2: The capability's factory leaves the capability**

In `components/agent-service/capabilities/search_knowledge.py`, delete the `create()` classmethod — the whole block, from `@classmethod` to the `return cls(...)` line — and its now-unused imports.

- [ ] **Step 3: The host builds the capability**

In `components/agent-service/assembly.py`, the assembly builds the search capability directly, in place of the factory the capability used to carry:

```python
    search = _build_search_capability(env)
```

with the helper in the same module:

```python
def _build_search_capability(env=None):
    """The search capability's wiring: the retrieval driver, the embedding
    and reranking endpoints, and the graph's database.

    Composition, not capability: the capability names what it searches, the
    host names what it searches WITH.
    """
    import arango

    arango_config = ArangoConfig.load(env)
    hybrid_config = HybridConfig.load(env)
    reranking_config = RerankingConfig.load(env)
    embedding_config = EmbeddingConfig.load(env)
    endpoints = ModelEndpointConfig.load(env)
    if not endpoints.tei_embedding_endpoint:
        raise ValueError("TEI_EMBEDDING_ENDPOINT must be set: the port has no default embedding endpoint")
    if not endpoints.tei_reranking_endpoint:
        raise ValueError("TEI_RERANKING_ENDPOINT must be set: the port has no default reranker endpoint")
    client = arango.ArangoClient(hosts=arango_config.url)

    def db_factory(_graph_name: str):
        return client.db(
            arango_config.database,
            username=arango_config.username,
            password=arango_config.password,
        )

    embedding = TeiEmbeddingAdapter(
        endpoints.tei_embedding_endpoint,
        connect_timeout_seconds=embedding_config.connect_timeout_seconds,
        total_timeout_seconds=embedding_config.embed_timeout_seconds,
        tls_verify=endpoints.tls_verify,
        bearer=endpoints.bearer,
    )
    reranking = TeiRerankingAdapter(
        endpoints.tei_reranking_endpoint, reranking_config, tls_verify=endpoints.tls_verify, bearer=endpoints.bearer
    )
    return SearchKnowledgeCapability(embedding, reranking, db_factory, arango_config, hybrid_config)
```

- [ ] **Step 4: The composition root calls the assembly**

In `components/agent-service/app.py`, the assembly comes from the host module:

```python
from assembly import build_stateless_adapters
```

and the call loses the config argument — the assembly reads the environment:

```python
    adapters = build_stateless_adapters(env)
```

- [ ] **Step 5: The probe names the assembly**

In `components/agent-service/agent/probe.py`, the assembly is no longer the probe's: it imports it from the host module and deletes its own `StatelessAdapters` and `build_stateless_adapters` blocks (they moved verbatim).

- [ ] **Step 6: The layout learns the host module**

In `components/agent-service/tests/test_architecture.py`, replace:

```python
    host=("app", "tracing", "lane"),
```

with:

```python
    host=("app", "tracing", "lane", "assembly"),
```

The planted-violation probe declares the same host module:

```python
    layout = Layout(
        host=("app", "tracing", "lane"),
```

becomes:

```python
    layout = Layout(
        host=("app", "tracing", "lane", "assembly"),
```

and the synthetic package gains the module:

```python
        "lane.py": '"""The host lane."""\n',
```

becomes:

```python
        "lane.py": '"""The host lane."""\n',
        "assembly.py": '"""The host assembly."""\n',
```

- [ ] **Step 7: The image and the lint lane carry the host module**

In `components/agent-service/Dockerfile`, replace:

```
COPY app.py tracing.py lane.py ./
```

with:

```
COPY app.py tracing.py lane.py assembly.py ./
```

In `.gitlab-ci.yml`, the agent service's lint job. Replace:

```
    - ruff check app.py tracing.py lane.py capabilities/ preparation/ noagent/ agent/ tests/
    - ruff format --check app.py tracing.py lane.py capabilities/ preparation/ noagent/ agent/ tests/
```

with:

```
    - ruff check app.py tracing.py lane.py assembly.py capabilities/ preparation/ noagent/ agent/ tests/
    - ruff format --check app.py tracing.py lane.py assembly.py capabilities/ preparation/ noagent/ agent/ tests/
```

- [ ] **Step 8: Run the suite and the lint**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
cd components/agent-service
/tmp/genie-agent-service-venv/bin/python -m pytest tests/ -q
uvx ruff@0.16.3 check --no-cache app.py tracing.py lane.py assembly.py capabilities/ preparation/ noagent/ agent/ tests/
uvx ruff@0.16.3 format --no-cache --check app.py tracing.py lane.py assembly.py capabilities/ preparation/ noagent/ agent/ tests/
```

Expected: `934 passed, 2 warnings`; `All checks passed!`; `97 files already formatted`.

- [ ] **Step 9: The ratchet shrinks**

The probe no longer imports `arango`: the assembly does, and the assembly is host infrastructure. Run:

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
cd components/agent-service
/tmp/genie-agent-service-venv/bin/python -m pytest tests/test_architecture.py -q
```

Expected: `1 failed, 8 passed` in `test_core_modules_import_no_io_library`, with:

```
E         Extra items in the right set:
E         ('agent.probe', 'arango')
```

The right set is the list; the tree no longer has the violation. Delete this line from `KNOWN_IO_VIOLATIONS` in `components/agent-service/tests/test_architecture.py`:

```python
    ("agent.probe", "arango"),  # agent/probe.py: the adapter assembly still lives in the seam package
```

Run the command again.

Expected: `9 passed in < 1s`.

- [ ] **Step 10: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
git add components/agent-service/assembly.py components/agent-service/agent/probe.py components/agent-service/app.py components/agent-service/capabilities/search_knowledge.py components/agent-service/tests/test_architecture.py components/agent-service/Dockerfile .gitlab-ci.yml
git commit -m "refactor(agent-service): the composition is the host's business"
```

---

## Final verification

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
git log --oneline -4
git status --short
cd components/agent-service
/tmp/genie-agent-service-venv/bin/python -m pytest tests/ -q
uvx ruff@0.16.3 check --no-cache app.py tracing.py lane.py assembly.py capabilities/ preparation/ noagent/ agent/ tests/
uvx ruff@0.16.3 format --no-cache --check app.py tracing.py lane.py assembly.py capabilities/ preparation/ noagent/ agent/ tests/
```

Expected:

- Three commits on top of plan 2's: the model call's contract is a port, the production model client is the vLLM adapter, the composition is the host's business.
- `git status --short` prints nothing.
- `934 passed, 2 warnings`.
- `All checks passed!` and `97 files already formatted`.

### What this plan establishes

| Design item | Where | Evidence |
|---|---|---|
| The model call's contract is a port (§2.4) | `capabilities/model.py` | the adapter names the port, the core names the port; rule L1 holds |
| Leak 1, first half (§2.3) | `capabilities/adapters/vllm.py` | the production client is an adapter; the probe keeps the measurement half |
| Leak 1, second half (§2.3) | `assembly.py` (host) | the core imports no adapter assembly; the ratchet loses the `arango` pair |

### What it leaves open

- Three listed violations, closed by plan 4 (the probe and the harness leave `agent/`).
- The adapter assembly and the capability's factory stay where they are: plan 5 moves them, once the probe is out of the core and may reach the host.

## Landing

The commits stay on `feat/agentic-foundations/architecture` until the operator says otherwise. On their word:

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
git push
```

Then start exactly one CI monitor for the merge request's pipeline, in the background, and read the pipeline id from the push output: `~/.local/bin/ci-monitor.sh gitlab <pipeline_id>`.
