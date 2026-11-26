# Agentic S1, plan 4 of 6 — the measurement surfaces leave the core: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The probe and the harness stop living in the runtime-seam package: they become measurement surfaces, in their own package, and the ratchets empty.

**Architecture:** Two moves. (1) `agent/probe.py` and `agent/v06_harness.py` move to `measurement/` — the layout declares that layer as a package, and the core rules stop reading them. (2) The composition that the probe hosted leaves the core as well: the adapter assembly and the search capability's factory move to the host, beside the composition root that calls them. A core module may not import the host — so this move comes AFTER the probe's: once the probe is a measurement surface, it may reach the host.

**Tech Stack:** Python 3.11, pytest 9.1.1, pytestarch 5.1.1 (the rules of plan 1), ruff 0.16.3.

**Spec:** `docs/superpowers/specs/2026-11-25-agentic-iteration-2-architecture-design.md` — §2.3 (the leaks), §2.4 (the layers), §2.5 (the rules). Plan 1: `docs/superpowers/plans/2026-11-25-agentic-s1-architecture-rules.md`. Plan 2: `docs/superpowers/plans/2026-11-25-agentic-s1-composition-transport-lane.md`. Plan 3: `docs/superpowers/plans/2026-11-25-agentic-s1-composition-out-of-the-core.md`.

## Global Constraints

- **Where the work lands.** Branch `feat/agentic-foundations/architecture` (merge request !1088, whose target is `feat/agentic-foundations/prd`). Commit on this branch only. Do not push without the operator's word, do not touch `main` or the PRD branch, never run `git stash`, never run `git reset --hard`.
- **No path is written in this plan.** Every command block starts with the same guard, which moves to the root of the checkout it is run from and refuses anything but that branch.
- **Frozen behavior.** The RAG capability's behavior is frozen (`docs/baselines/v02-opea-query-path-contract.md`); `tests/test_equivalence_v02.py` stays green and untouched.
- **The recorded strings keep their bytes.** The harness's `PRODUCER_ID` stays `agent.v06_harness` even though the file moves; the paths and the live-entry commands follow the files.
- **Lint locally with `--no-cache`.** A stale `.ruff_cache` answers green on a tree the CI rejects (2026-11-26). Every lint command passes `--no-cache`.
- **An output that differs from the expected one is a stop.** Report it; do not adjust a test or a list to make it pass.

## Where this plan sits

| Plan | Content | State it leaves |
|---|---|---|
| Plan 1 — architecture rules | the rules; leak 4 (the executor) and the constant of leak 5 | four I/O violations and two cross-layer violations listed |
| Plan 2 — transport and lane | the HTTP transport and the admission lane leave the core | two I/O violations and two cross-layer violations listed |
| Plan 3 — the contract and the client | the model call's contract becomes a port; the production client becomes the vLLM adapter | two I/O violations and two cross-layer violations listed |
| **This one** | the probe and the harness become measurement surfaces; the composition leaves the core | no listed violation; rule R3's set is the composition root and the capability |
| Plan 5 — the runtime port, step 1 | `RuntimeDriver` extraction behind a byte-identical event stream | stream gate recorded |

The three ratchets of plan 1 (`KNOWN_IO_VIOLATIONS`, `KNOWN_INTERNAL_VIOLATIONS`, `KNOWN_ADAPTER_IMPORTERS` in `components/agent-service/tests/test_architecture.py`) list, after this plan:

| Rule | Pair left | Closed by |
|---|---|---|
| R1 | `("agent.probe", "arango")` | this plan (the probe leaves the core) |
| R2 | `("agent.probe", "capabilities.adapters")` | this plan (the probe leaves the core) |
| R2 | `("agent.probe", "capabilities.search_knowledge")` | this plan (the probe leaves the core) |

and rule R3's set is `{"app", "capabilities.search_knowledge"}`: the composition root and the capability.

## File map

| File | Responsibility | Task |
|---|---|---|
| `components/agent-service/measurement/__init__.py` | the measurement surfaces' package | 1 |
| `components/agent-service/measurement/probe.py` | the probe (moved from `agent/`) | 1 |
| `components/agent-service/measurement/v06_harness.py` | the harness (moved from `agent/`) | 1 |
| `components/agent-service/assembly.py` | the adapter assembly (host) | 2 |
| `components/agent-service/capabilities/search_knowledge.py` | the capability; its factory leaves it | 2 |
| `components/agent-service/app.py` | the composition root; it calls the assembly | 1, 2 |
| `components/agent-service/tests/test_architecture.py` | the layout and the ratchet lists | 1, 2 |
| `components/agent-service/Dockerfile`, `.gitlab-ci.yml` | the new package rides into the image and the lint lane | 1 |

## Decisions taken while writing this plan

- **The measurement layer is a package, not a list of modules.** A module named in the layout is a module of the core's package; the measurement surfaces are a package of their own (`measurement/`), so the layer is declared once and the rule C sees every module in it.
- **The composition moves to the host, and only after the probe's move.** The probe calls the assembly. A core module may not import the host — so the assembly cannot move while the probe is core. Once the probe is a measurement surface, it may reach the host, and the move is clean.
- **The core's package stops re-exporting the measurement's names.** `agent/__init__.py` re-exported the probe's constants and classes; after the move, the core's package would import the measurement package, which rule R2 forbids. The names are imported from their new home.

---

### Task 1: The probe and the harness become measurement surfaces

**Files:**
- Create: `components/agent-service/measurement/__init__.py`
- Move: `components/agent-service/agent/probe.py` → `components/agent-service/measurement/probe.py`
- Move: `components/agent-service/agent/v06_harness.py` → `components/agent-service/measurement/v06_harness.py`
- Modify: `components/agent-service/agent/__init__.py`
- Modify: `components/agent-service/app.py`
- Modify: `components/agent-service/tests/` (the importers)
- Modify: `components/agent-service/tests/test_architecture.py`
- Modify: `components/agent-service/Dockerfile`
- Modify: `.gitlab-ci.yml`
- Modify: `docs/superpowers/specs/2026-11-25-agentic-iteration-2-architecture-design.md`
- Modify: `docs/baselines/`

**Interfaces:**
- Consumes: `SERVICE_LAYOUT` from plan 1.
- Produces: the package `measurement` with `probe` and `v06_harness`.

- [ ] **Step 1: Move the two files**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
mkdir -p components/agent-service/measurement
git mv components/agent-service/agent/probe.py components/agent-service/measurement/probe.py
git mv components/agent-service/agent/v06_harness.py components/agent-service/measurement/v06_harness.py
```

Create `components/agent-service/measurement/__init__.py`:

```python
# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The measurement surfaces: the probe and the harness that verify a deployment.

They assemble their own runtime — the port, the client, the transport — to
measure what a deployment serves. They are not core: the core may not
import them, and they may reach the adapters and the host.
"""
```

- [ ] **Step 2: The relative imports become absolute**

In `components/agent-service/measurement/probe.py` and `measurement/v06_harness.py`, the relative imports (`from .budget import`, `from .cancellation import`, `from .events import`, `from .loop import`, `from .probe import`, `from .registry import`, `from .toolset import`, `from .version_record import`) name the core's package: they become absolute (`from agent.budget import`, …). The harness's `from .probe import PROBE_RUN_BUDGET` becomes `from measurement.probe import PROBE_RUN_BUDGET`.

- [ ] **Step 3: The importers follow**

In `components/agent-service/app.py`, `tests/conftest.py`, `tests/test_agent_probe.py`, `tests/test_agent_loop.py`, `tests/test_agent_orchestrator.py`, `tests/test_agent_toolset.py` and `tests/test_v06_harness.py`, the names come from the new home: `from agent.probe import` becomes `from measurement.probe import`, `from agent.v06_harness import` becomes `from measurement.v06_harness import`, and `import agent.v06_harness as verification_module` becomes `import measurement.v06_harness as verification_module`.

In `components/agent-service/agent/__init__.py`, the re-exports of the measurement's names go: the core's package does not import the measurement package.

- [ ] **Step 4: The layout learns the package**

In `components/agent-service/tests/test_architecture.py`, replace:

```python
    measurement=("agent.v06_harness",),
```

with:

```python
    measurement=("measurement",),
```

- [ ] **Step 5: The image and the lint lane carry the package**

In `components/agent-service/Dockerfile`, replace:

```
COPY agent/ ./agent/
```

with:

```
COPY agent/ ./agent/
COPY measurement/ ./measurement/
```

In `.gitlab-ci.yml`, the agent service's lint job. Replace:

```
    - ruff check app.py tracing.py lane.py capabilities/ preparation/ noagent/ agent/ tests/
    - ruff format --check app.py tracing.py lane.py capabilities/ preparation/ noagent/ agent/ tests/
```

with:

```
    - ruff check app.py tracing.py lane.py capabilities/ preparation/ noagent/ agent/ measurement/ tests/
    - ruff format --check app.py tracing.py lane.py capabilities/ preparation/ noagent/ agent/ measurement/ tests/
```

- [ ] **Step 6: The commands and the paths follow the files**

The live-entry commands in the moved modules' docstrings (`python -m measurement.probe`, `python -m measurement.v06_harness`), the design's probe row (`python -m measurement.v06_harness`) and the baseline documents' paths name the new home. The recorded producer strings (`agent.v06_harness`) do not change.

- [ ] **Step 7: The ratchets empty**

Run:

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
cd components/agent-service
/tmp/genie-agent-service-venv/bin/python -m pytest tests/test_architecture.py -q
```

Expected: three failures, one per ratchet — the tree no longer has the violations:

```
E         Extra items in the right set:
E         ('agent.probe', 'arango')
```

```
E         Extra items in the right set:
E         ('agent.probe', 'capabilities.adapters')
E         ('agent.probe', 'capabilities.search_knowledge')
```

```
E         Extra items in the left set:
E         'agent.probe'
```

Delete those three pairs and the one importer from the lists. An empty set is written `set()`, not `{}` — `{}` is a dict, and the assertion would compare a set to a dict.

- [ ] **Step 8: Run the suite and the lint**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
cd components/agent-service
/tmp/genie-agent-service-venv/bin/python -m pytest tests/ -q
uvx ruff@0.16.3 check --no-cache app.py tracing.py lane.py capabilities/ preparation/ noagent/ agent/ measurement/ tests/
uvx ruff@0.16.3 format --no-cache --check app.py tracing.py lane.py capabilities/ preparation/ noagent/ agent/ measurement/ tests/
```

Expected: `934 passed, 2 warnings`; `All checks passed!`; `98 files already formatted`.

- [ ] **Step 9: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
git add components/agent-service/measurement components/agent-service/agent components/agent-service/app.py components/agent-service/tests components/agent-service/Dockerfile .gitlab-ci.yml docs/
git commit -m "refactor(agent-service): the probe and the harness are measurement surfaces"
```

---

### Task 2: The composition leaves the core

**Files:**
- Create: `components/agent-service/assembly.py`
- Modify: `components/agent-service/measurement/probe.py`
- Modify: `components/agent-service/app.py`
- Modify: `components/agent-service/capabilities/search_knowledge.py`
- Modify: `components/agent-service/tests/test_architecture.py`
- Modify: `components/agent-service/Dockerfile`
- Modify: `.gitlab-ci.yml`

**Interfaces:**
- Consumes: `VllmModelConfig` from plan 3.
- Produces:
  - `assembly.StatelessAdapters` — the shared half of the port assembly.
  - `assembly.build_stateless_adapters(env=None) -> StatelessAdapters` — the assembly.
  - `capabilities.search_knowledge.SearchKnowledgeCapability(...)` — the capability's constructor, called by the host.

- [ ] **Step 1: The host owns the assembly**

Create `components/agent-service/assembly.py` with the content of today's `StatelessAdapters` and `build_stateless_adapters` (from `measurement/probe.py`), with the header rewritten:

```python
# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The port assembly: the read adapters and the inner search port.

Host infrastructure: the assembly is composition — it builds the adapters
the requests read through and binds a caller's context to them — and the
composition root owns it.
"""
```

Its imports: the four adapters it builds, the capability, the executor, and the environment configs.

- [ ] **Step 2: The capability's factory leaves the capability**

In `components/agent-service/capabilities/search_knowledge.py`, delete the `create()` classmethod — the whole block, from `@classmethod` to the `return cls(...)` line — and its now-unused imports.

- [ ] **Step 3: The host builds the capability**

In `components/agent-service/assembly.py`, the assembly builds the search capability directly, in place of the factory the capability used to carry: the driver's import stays a call-time import, and the helper that reads the endpoints moves with it.

- [ ] **Step 4: The composition root calls the assembly**

In `components/agent-service/app.py`, the assembly comes from the host module:

```python
from assembly import build_stateless_adapters
```

and the call loses the config argument — the assembly reads the environment.

- [ ] **Step 5: The measurement surface names the host**

In `components/agent-service/measurement/probe.py`, the assembly is no longer the probe's: it imports it from the host module and deletes its own `StatelessAdapters` and `build_stateless_adapters` blocks (they moved verbatim). A measurement surface may reach the host; a core module may not.

- [ ] **Step 6: The layout learns the host module**

In `components/agent-service/tests/test_architecture.py`, replace:

```python
    host=("app", "tracing", "lane"),
```

with:

```python
    host=("app", "tracing", "lane", "assembly"),
```

The planted-violation probe declares the same host module, and the synthetic package gains it.

- [ ] **Step 7: The image and the lint lane carry the host module**

In `components/agent-service/Dockerfile`, replace:

```
COPY app.py tracing.py lane.py ./
```

with:

```
COPY app.py tracing.py lane.py assembly.py ./
```

In `.gitlab-ci.yml`, the agent service's lint job carries `assembly.py` too.

- [ ] **Step 8: Run the suite and the lint**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
cd components/agent-service
/tmp/genie-agent-service-venv/bin/python -m pytest tests/ -q
uvx ruff@0.16.3 check --no-cache app.py tracing.py lane.py assembly.py capabilities/ preparation/ noagent/ agent/ measurement/ tests/
uvx ruff@0.16.3 format --no-cache --check app.py tracing.py lane.py assembly.py capabilities/ preparation/ noagent/ agent/ measurement/ tests/
```

Expected: `934 passed, 2 warnings`; `All checks passed!`.

- [ ] **Step 9: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && [ "$(git rev-parse --abbrev-ref HEAD)" = feat/agentic-foundations/architecture ] || { echo "not in the checkout that carries feat/agentic-foundations/architecture"; exit 1; }
git add components/agent-service/assembly.py components/agent-service/measurement components/agent-service/app.py components/agent-service/capabilities/search_knowledge.py components/agent-service/tests/test_architecture.py components/agent-service/Dockerfile .gitlab-ci.yml
git commit -m "refactor(agent-service): the composition is the host's business"
```

---

## What this plan establishes

| Design item | Where | Evidence |
|---|---|---|
| The measurement surfaces are not core (§2.4) | `measurement/` | rule C classifies them; the core rules stop reading them |
| Leak 1 closed (§2.3) | `assembly.py` (host), the capability's factory | the core composes nothing; the ratchets empty |
| Leak 2 closed (§2.3) | `measurement/v06_harness.py` | the harness is a measurement surface; the recorded producer string is untouched |

## What it leaves open

- The runtime port (`RuntimeDriver`) — plan 5.
- The BFF's contract for the pause surface — the operator's open items.
