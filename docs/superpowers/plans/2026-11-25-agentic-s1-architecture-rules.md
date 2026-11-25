# Agentic S1, plan 1 of 3 — architecture rules and the two cheap leaks: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the agent service its architecture test — four `pytestarch` rules, with the violations that remain written as a list that can only shrink — and close the two leaks of the design that need no code to move.

**Architecture:** `pytestarch` reads the import graph of `components/agent-service` at test time. Rule R1 (a core module imports no I/O library) and rule R2 (a core module imports no adapter code) are ratchets: the set of violations found on the tree is asserted equal to a listed set in `tests/test_architecture.py`, so closing a leak turns the test red until the list shrinks, and a new leak turns it red as well. Rules L1 and L2 are layer rules that hold on the whole tree today. The executor then stops naming concrete adapters (three Protocols in `capabilities/sources.py`), and the reranker abstention text moves from the capability module to the contract.

**Tech Stack:** Python 3.11, pytest 9.1.1, pytestarch 5.1.1 (its one requirement, networkx, pinned to 3.6.1), ruff 0.16.3.

**Spec:** `docs/superpowers/specs/2026-11-25-agentic-iteration-2-architecture-design.md` — §2 (the hexagonal map, the five leaks of §2.3, the rules of §2.5), §9.2 (the NFR-2 adoption rule), §10.1 (the architecture tests), §10.8 probe P1, §11 (slice S1).

## Global Constraints

- **Where the work lands.** Worktree `/home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/agentic-architecture`, branch `feat/agentic-foundations/architecture` (stacked on `feat/agentic-foundations/prd`; merge request !1088). Every path below is relative to that worktree. Commit on this branch only. Do not push, do not touch `main` or the PRD branch, never run `git stash`, never run `git reset --hard`.
- **Python floor.** `requires-python = ">=3.11"`; the CI lanes run `python:3.11-slim`. `networkx` stays at `3.6.1`: 3.7 requires Python 3.12 or later.
- **Test-only dependency.** `pytestarch` goes into `requirements-test.txt` and the `test` extra of `pyproject.toml`. It never goes into `requirements.txt`: the image installs only that file.
- **NFR-2.** Every pin carries an exact-version licence row and a defaults-audit verdict in `docs/dependencies/agent-service-dependency-evidence.json`. The offline verifier must print `OK`.
- **Frozen behavior.** The RAG capability's behavior is frozen (`docs/baselines/v02-opea-query-path-contract.md`). This plan edits no existing test; `tests/test_equivalence_v02.py` stays green and untouched.
- **Ruff.** CI pin `RUFF_VERSION` is `0.16.3`; py311, line length 120, rules `E, W, F, I, UP, B, SIM`. The lint job runs, from `components/agent-service`: `ruff check app.py tracing.py capabilities/ preparation/ noagent/ agent/ tests/` and `ruff format --check` on the same paths.
- **Comments and docstrings.** English, they describe the current code, they carry no issue or merge-request number.
- **An output that differs from the expected one is a stop.** Report it; do not adjust a test or a list to make it pass.

## Environment

The commands below use a virtual environment outside the repository: `.gitignore` ignores only `genie-ai-overlay/.venv/`, so a venv created inside `components/agent-service` would show as untracked files. Shell state does not carry between two commands, so every block repeats the paths it needs.

```bash
command -v uv
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/agentic-architecture/components/agent-service
uv venv --python 3.11 /tmp/genie-agent-service-venv
uv pip install --python /tmp/genie-agent-service-venv/bin/python -r requirements-test.txt
/tmp/genie-agent-service-venv/bin/python -m pytest tests/ -q
```

`command -v uv` prints a path. The last command prints `922 passed, 2 warnings in <a few seconds>` — the baseline this plan starts from. If the venv already exists, skip `uv venv` and keep the `uv pip install` line.

## Where this plan sits

Slice S1 of the design is delivered as three plans. This is the first.

| Plan | Content | State it leaves |
|---|---|---|
| **This one** | the rules; leak 4 (executor) and the constant of leak 5 | five listed violations remain |
| Plan 2 — composition out of the core | `agent/probe.py` split, `agent/v06_harness.py` moved, `HttpxTransport` moved, `SearchKnowledgeCapability.create()` moved to the composition root | no listed violation; rule R3 switched on |
| Plan 3 — runtime port, step 1 | `RuntimeDriver` extraction behind a byte-identical event stream | stream gate recorded |

After this plan the two ratchets list these violations, all in the three leaks plan 2 closes:

| Rule | Pair left | Caused by |
|---|---|---|
| R1 | `("agent", "arango")`, `("agent", "httpx")` | `agent/probe.py`, `agent/v06_harness.py` |
| R1 | `("preparation", "httpx")` | `preparation/translation.py` |
| R2 | `("agent", "capabilities.adapters")`, `("agent", "capabilities.search_knowledge")` | `agent/probe.py` |

## File map

| File | Responsibility | Task |
|---|---|---|
| `components/agent-service/requirements-test.txt` | the test-only pins | 1 |
| `docs/dependencies/agent-service-dependency-evidence.json` | the licence and defaults evidence, one row per pin | 1 |
| `components/agent-service/pyproject.toml` | the `test` extra, kept equal to the pins | 1 |
| `THIRD_PARTY.md` | the disclosure of the new dependency | 1 |
| `components/agent-service/tests/test_architecture.py` | the four rules, the two lists, the planted-violation test | 2 (edited in 3 and 4) |
| `components/agent-service/capabilities/sources.py` | the three Protocols the executor reads through | 3 |
| `components/agent-service/tests/test_sources.py` | the adapters satisfy the Protocols | 3 |
| `components/agent-service/capabilities/executor.py` | annotations name the Protocols | 3 |
| `components/agent-service/capabilities/contract.py` | home of the shared abstention text | 4 |
| `components/agent-service/capabilities/search_knowledge.py` | imports the text from the contract | 4 |
| `components/agent-service/noagent/prompt.py` | imports the text from the contract | 4 |

## Decisions taken while writing this plan

Each was checked on a copy of the service before being written here.

- **A node is named after the root folder.** `pytestarch` names the modules `agent-service.agent`, `agent-service.capabilities.adapters`, not `agent`. Every name the test builds carries that prefix.
- **A library nobody imports is absent from the graph**, and a rule that names it raises `ModuleUnknown`. The I/O list is therefore filtered by presence before any rule is built.
- **A deny-list, presence-filtered.** An allow-list of what the core may import was rejected: every new standard-library import would need an edit of the test.
- **Set equality, not one test per pair.** One test per rule prints the complete list of what changed; a fix and a regression are both one visible diff.
- **Direct imports for R1 and R2.** `import_modules_that` looks at direct imports. That is enough here because every module that imports adapter code is itself listed as adapter code (`capabilities.search_knowledge`), so a transitive path from the core to an adapter always starts with a direct import the rule sees.

---

### Task 1: Adopt pytestarch as a test-only dependency

**Files:**
- Modify: `components/agent-service/requirements-test.txt`
- Modify: `docs/dependencies/agent-service-dependency-evidence.json`
- Modify: `components/agent-service/pyproject.toml`
- Modify: `THIRD_PARTY.md`
- Modify: `docs/superpowers/specs/2026-11-25-agentic-iteration-2-architecture-design.md` (one row of §9.2)

**Interfaces:**
- Consumes: nothing from an earlier task.
- Produces: `from pytestarch import EvaluableArchitecture, LayeredArchitecture, LayerRule, Rule, get_evaluable_architecture` resolves in the test environment. Task 2 uses these five names.

- [ ] **Step 1: Pin the two packages**

Write `components/agent-service/requirements-test.txt` with this content:

```
# Test-only dependencies of the agent service. The runtime tree stays in
# requirements.txt (the image installs only that one); this file adds the
# packages the test suite needs.
#
# Every pin is audited like every other dependency: exact-version licence
# verification and the NFR-2 defaults audit, per package, in
# docs/dependencies/agent-service-dependency-evidence.json (the evidence file
# covers this tree and the runtime tree together).
#
# pytest is pinned to the version the repository's CI lanes install
# (PYTEST_VERSION in .gitlab-ci.yml); httpx is the test client the FastAPI
# TestClient drives the app with; pytestarch enforces the dependency rules of
# tests/test_architecture.py. networkx is its one requirement, pinned to the
# last line that accepts Python 3.11 (3.7 requires 3.12).

-r requirements.txt

httpx==0.28.1
networkx==3.6.1
pytest==9.1.1
pytestarch==5.1.1
```

- [ ] **Step 2: Run the licence verifier — it must fail**

Run:

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/agentic-architecture
python3 scripts/dependencies/verify-dependency-licenses.py --verify components/agent-service/requirements.txt components/agent-service/requirements-test.txt --evidence docs/dependencies/agent-service-dependency-evidence.json
```

Expected (exit code 1):

```
FAIL networkx==3.6.1: no evidence row - the pin was added without an audit
FAIL pytestarch==5.1.1: no evidence row - the pin was added without an audit
2 problem(s): the pre-adoption checklist is NOT satisfied.
```

This is the red step of the task: a pin without an audit is refused.

- [ ] **Step 3: Add the two evidence rows**

Both rows were resolved with the repository's own script (`resolve(name, version)` of `verify-dependency-licenses.py`) on 2026-11-25: `networkx` 3.6.1 is `BSD-3-Clause`, `pytestarch` 5.1.1 is `Apache-2.0`, each declared as a license expression on PyPI. The defaults verdicts rest on a static scan of the two installed packages: neither imports `socket`, `ssl`, `urllib`, `http`, `requests`, `httpx`, `subprocess`, `smtplib`, `xmlrpc`, nor any telemetry library. `pytestarch` imports `networkx` and the standard library (`ast`, `pathlib`, `collections`, …); its single `matplotlib` import sits in the optional graph-visualisation method of `eval_structure/networkxgraph.py`. `networkx` has no required dependency.

In `docs/dependencies/agent-service-dependency-evidence.json`, the rows are sorted by name. Insert the `networkx` row between the `numpy` row and the `opentelemetry-api` row. Replace:

```
    {
      "name": "opentelemetry-api",
```

with:

```
    {
      "name": "networkx",
      "version": "3.6.1",
      "license": "BSD-3-Clause",
      "license_source": "pypi:license_expression (https://pypi.org/pypi/networkx/3.6.1/json)",
      "verified": true,
      "status": "stable",
      "risk_acceptance": null,
      "defaults": {
        "telemetry": "none - the package performs no telemetry of its own",
        "cloud_export": "none - the package contacts no external service"
      }
    },
    {
      "name": "opentelemetry-api",
```

Then insert the `pytestarch` row between the `pytest` row and the `python-arango` row. Replace:

```
    {
      "name": "python-arango",
```

with:

```
    {
      "name": "pytestarch",
      "version": "5.1.1",
      "license": "Apache-2.0",
      "license_source": "pypi:license_expression (https://pypi.org/pypi/pytestarch/5.1.1/json)",
      "verified": true,
      "status": "stable",
      "risk_acceptance": null,
      "defaults": {
        "telemetry": "none - the package performs no telemetry of its own",
        "cloud_export": "none - the package contacts no external service"
      }
    },
    {
      "name": "python-arango",
```

- [ ] **Step 4: Run the licence verifier — it must pass**

Run the command of Step 2 again.

Expected (exit code 0):

```
OK 51 pinned package(s): licence verified, defaults audit recorded.
```

- [ ] **Step 5: Keep the `test` extra equal to the pins**

In `components/agent-service/pyproject.toml`, replace:

```toml
test = [
    "pytest==9.1.1",
    "httpx==0.28.1",
]
```

with:

```toml
test = [
    "pytest==9.1.1",
    "httpx==0.28.1",
    "pytestarch==5.1.1",
    "networkx==3.6.1",
]
```

- [ ] **Step 6: Disclose the dependency**

In `THIRD_PARTY.md`, under `## Python Libraries`, the new entry goes after the `pytest` entry. Replace:

```markdown
---

### langdetect
```

with:

```markdown
---

### pytestarch
**Component Type:** Architecture Test Framework
**Version:** 5.1.1
**Repository:** https://github.com/zyskarch/pytestarch
**License:** Apache 2.0
**License URL:** `docs/dependencies/agent-service-dependency-evidence.json`

**Usage:** Enforces the dependency rules of the agent service
(`components/agent-service/tests/test_architecture.py`): a core module
imports no I/O library and no adapter. A test-only dependency of the agent
service - it never reaches a runtime image. Its one requirement, `networkx`
(3.6.1, BSD-3-Clause), is pinned to the last line that accepts Python 3.11.

---

### langdetect
```

- [ ] **Step 7: Update the design's dependency table**

In `docs/superpowers/specs/2026-11-25-agentic-iteration-2-architecture-design.md`, §9.2, replace:

```
| `pytestarch` | 5.1.1 | Apache-2.0 | test only | to adopt, `requirements-test.txt` |
```

with:

```
| `pytestarch` | 5.1.1 | Apache-2.0 | test only | adopted, `requirements-test.txt`; its one requirement `networkx` is pinned to `3.6.1` (BSD-3-Clause) |
```

- [ ] **Step 8: Install the audited tree and confirm the suite did not move**

Run:

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/agentic-architecture/components/agent-service
uv pip install --python /tmp/genie-agent-service-venv/bin/python -r requirements-test.txt
/tmp/genie-agent-service-venv/bin/python -c "import importlib.metadata as m; print(m.version('pytestarch'), m.version('networkx'))"
/tmp/genie-agent-service-venv/bin/python -m pytest tests/ -q
```

Expected: `5.1.1 3.6.1`, then `922 passed, 2 warnings in <a few seconds>`. No test uses the new package yet.

- [ ] **Step 9: Run the repository gate over the evidence**

The config-validator suite asserts the same invariants as the verifier, over the same files.

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/agentic-architecture/tests/config-validator
npm ci --no-audit --no-fund
npx jest __tests__/agent-service.test.js
```

Expected, in the summary:

```
Test Suites: 1 passed, 1 total
Tests:       23 passed, 23 total
```

- [ ] **Step 10: Commit**

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/agentic-architecture
git add components/agent-service/requirements-test.txt components/agent-service/pyproject.toml docs/dependencies/agent-service-dependency-evidence.json THIRD_PARTY.md docs/superpowers/specs/2026-11-25-agentic-iteration-2-architecture-design.md
git commit -m "build(agent-service): pin pytestarch and networkx for the architecture tests"
```

---

### Task 2: The architecture rules

The module written here is the guard for everything that follows. It has no red-first step of its own: it passes as soon as it lands, with the current violations listed. What must be proven is that it can fail. Steps 4 to 6 plant one violation at a time in a real core module and check the exact pair the test reports. They answer probe P1 of the design (§10.8).

**Files:**
- Create: `components/agent-service/tests/test_architecture.py`

**Interfaces:**
- Consumes: the five `pytestarch` names of Task 1.
- Produces (read by Tasks 3 and 4):
  - `KNOWN_IO_VIOLATIONS: set[tuple[str, str]]` — pairs `(core module, library)`.
  - `KNOWN_ADAPTER_VIOLATIONS: set[tuple[str, str]]` — pairs `(core module, adapter code)`, where adapter code is `LEAF_ADAPTERS` (`"capabilities.adapters"`) or `CAPABILITY` (`"capabilities.search_knowledge"`).
  - the test names `test_core_modules_import_no_io_library` and `test_core_modules_import_no_adapter_code`.

- [ ] **Step 1: Write the module**

Create `components/agent-service/tests/test_architecture.py` with exactly this content:

```python
# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The dependency rules of the agent service.

The service is layered top to bottom: the host (``app.py``) composes, the core
decides, the ports declare what the core needs from the outside, the adapters
reach the outside. Four rules keep the layers apart:

* **R1** — a core module imports no I/O library.
* **R2** — a core module imports no adapter code.
* **L1** — a leaf adapter accesses only the ports it implements.
* **L2** — the search capability accesses only the ports and the leaf adapters.

R1 and R2 do not hold on the whole tree yet. They are written as a ratchet:
the violations found on the tree are asserted equal to a listed set
(``KNOWN_IO_VIOLATIONS``, ``KNOWN_ADAPTER_VIOLATIONS``). Closing a leak removes
its pair from the tree and the test goes red until the list shrinks with it; a
new leak grows the set and the test goes red as well. The lists change only
through a visible edit of this file.

``pytestarch`` reads imports from the syntax tree: a function-local ``import``
is seen, a dynamic ``importlib.import_module`` is not. The last test plants
each violation on a synthetic package and checks that the same helpers report
it.
"""

from pathlib import Path

import pytest
from pytestarch import EvaluableArchitecture, LayeredArchitecture, LayerRule, Rule, get_evaluable_architecture

SERVICE = Path(__file__).resolve().parents[1]

# The modules that decide. None of them reaches the outside by itself.
CORE = (
    "agent",
    "noagent",
    "preparation",
    "capabilities.contract",
    "capabilities.executor",
    "capabilities.citations",
    "capabilities.identifiers",
)
# The code that reaches the corpus on behalf of the document capability.
LEAF_ADAPTERS = "capabilities.adapters"
# The search capability builds its own adapters today, so it is adapter code.
CAPABILITY = "capabilities.search_knowledge"
ADAPTER_CODE = (LEAF_ADAPTERS, CAPABILITY)
# What the core and the adapters exchange.
PORTS = ("capabilities.contract", "capabilities.identifiers")
# The import names a core module never imports. The list names, it does not
# match: a new I/O library is added here when the service adopts it.
IO_LIBRARIES = (
    "httpx",
    "requests",
    "aiohttp",
    "http.client",
    "urllib.request",
    "socket",
    "fastapi",
    "starlette",
    "uvicorn",
    "arango",
    "sqlite3",
    "redis",
    "mcp",
    "openai",
    "subprocess",
)

# R1 — (core module, library): the modules that still import an I/O library.
KNOWN_IO_VIOLATIONS = {
    ("agent", "arango"),  # agent/probe.py: the adapter assembly still lives in the seam package
    ("agent", "httpx"),  # agent/v06_harness.py: the measurement harness still lives in the seam package
    ("preparation", "httpx"),  # preparation/translation.py: the HTTP transport still lives in the core module
}
# R2 — (core module, adapter code): the modules that still import adapter code.
KNOWN_ADAPTER_VIOLATIONS = {
    ("agent", LEAF_ADAPTERS),  # agent/probe.py: the adapter assembly still lives in the seam package
    ("agent", CAPABILITY),  # agent/probe.py: the adapter assembly still lives in the seam package
    ("capabilities.executor", LEAF_ADAPTERS),  # the executor names three concrete adapters
    ("noagent", CAPABILITY),  # noagent/prompt.py imports the reranker abstention text from the capability
}

LAYERS = {"ports": PORTS, "leaf adapters": (LEAF_ADAPTERS,), "capability": (CAPABILITY,)}


def _graph(root: Path, *, with_libraries: bool) -> EvaluableArchitecture:
    """The dependency graph of one package tree; ``tests`` and ``.venv`` left out."""

    return get_evaluable_architecture(
        root,
        root,
        exclusions=(f"*{root.name}/tests*", "*/.venv/*"),
        exclude_external_libraries=not with_libraries,
    )


def _named(root: str, module: str) -> str:
    return f"{root}.{module}"


def _imports_no_library(root: str, subject: str, library: str) -> Rule:
    """``root.subject`` and its submodules do not import ``library`` or its submodules."""

    return (
        Rule().modules_that().are_named([_named(root, subject)]).should_not().import_modules_that().are_named([library])
    )


def _imports_no_module(root: str, subject: str, forbidden: str) -> Rule:
    """``root.subject`` and its submodules do not import ``root.forbidden`` or its submodules."""

    return _imports_no_library(root, subject, _named(root, forbidden))


def _violated(rule: Rule, graph: EvaluableArchitecture) -> bool:
    """True when the rule does not hold on the graph."""

    try:
        rule.assert_applies(graph)
    except AssertionError:
        return True
    return False


def _io_violations(root: str, core: tuple[str, ...], graph: EvaluableArchitecture) -> set[tuple[str, str]]:
    """The (core module, library) pairs of ``core`` that break R1 on ``graph``."""

    modules = graph.modules
    violations = set()
    for module in core:
        for library in IO_LIBRARIES:
            if not any(name == library or name.startswith(library + ".") for name in modules):
                continue  # nothing imports this library: the rule has nothing to check
            if _violated(_imports_no_library(root, module, library), graph):
                violations.add((module, library))
    return violations


def _adapter_violations(
    root: str, core: tuple[str, ...], adapter_code: tuple[str, ...], graph: EvaluableArchitecture
) -> set[tuple[str, str]]:
    """The (core module, adapter code) pairs of ``core`` that break R2 on ``graph``."""

    return {
        (module, adapter)
        for module in core
        for adapter in adapter_code
        if _violated(_imports_no_module(root, module, adapter), graph)
    }


def _accesses_only(root: str, subject: str, allowed: list[str], layers: dict[str, tuple[str, ...]]) -> LayerRule:
    """A layer rule: ``subject`` accesses none but the ``allowed`` layers of ``layers``."""

    architecture = LayeredArchitecture()
    for name, modules in layers.items():
        architecture.layer(name).containing_modules([_named(root, module) for module in modules])
    return (
        LayerRule()
        .based_on(architecture)
        .layers_that()
        .are_named(subject)
        .should_only()
        .access_layers_that()
        .are_named(allowed)
    )


@pytest.fixture(scope="session")
def with_libraries() -> EvaluableArchitecture:
    return _graph(SERVICE, with_libraries=True)


@pytest.fixture(scope="session")
def internal() -> EvaluableArchitecture:
    return _graph(SERVICE, with_libraries=False)


def test_the_rules_name_the_real_tree(with_libraries: EvaluableArchitecture) -> None:
    """A rule that names a module absent from the graph raises; this pins the names."""

    root = SERVICE.name
    assert _named(root, "agent") in with_libraries.modules
    assert _named(root, LEAF_ADAPTERS) in with_libraries.modules
    assert not [name for name in with_libraries.modules if f"{root}.tests" in name]


def test_core_modules_import_no_io_library(with_libraries: EvaluableArchitecture) -> None:
    assert _io_violations(SERVICE.name, CORE, with_libraries) == KNOWN_IO_VIOLATIONS


def test_core_modules_import_no_adapter_code(internal: EvaluableArchitecture) -> None:
    assert _adapter_violations(SERVICE.name, CORE, ADAPTER_CODE, internal) == KNOWN_ADAPTER_VIOLATIONS


def test_leaf_adapters_access_only_the_ports(internal: EvaluableArchitecture) -> None:
    _accesses_only(SERVICE.name, "leaf adapters", ["ports"], LAYERS).assert_applies(internal)


def test_the_capability_accesses_only_ports_and_leaf_adapters(internal: EvaluableArchitecture) -> None:
    _accesses_only(SERVICE.name, "capability", ["ports", "leaf adapters"], LAYERS).assert_applies(internal)


def _plant(package: Path, relative: str, source: str) -> None:
    path = package / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(source, encoding="utf-8")


def test_the_rules_go_red_on_a_planted_violation(tmp_path: Path) -> None:
    """Each rule is checked on a synthetic package that breaks it, then repaired."""

    package = tmp_path / "fakepkg"
    layers = {"ports": ("contract",), "leaf adapters": ("adapters",)}
    _plant(package, "__init__.py", "")
    _plant(package, "app.py", "import fakepkg.adapters.x\nimport requests\n")
    _plant(package, "contract.py", "")
    _plant(package, "core/__init__.py", "")
    _plant(package, "core/clean.py", "import fakepkg.contract\n")
    _plant(package, "core/leaky.py", "import fakepkg.adapters.x\nimport httpx\n")
    _plant(package, "adapters/__init__.py", "")
    _plant(package, "adapters/x.py", "import fakepkg.contract\n")
    _plant(package, ".venv/lib/python3.11/site-packages/hidden.py", "import socket\n")

    # R1: the planted import is reported; the host's library and the virtual environment are not.
    graph = _graph(package, with_libraries=True)
    assert "socket" not in graph.modules
    assert _io_violations("fakepkg", ("core",), graph) == {("core", "httpx")}

    # R2: the planted import is reported, the clean module is not.
    assert _adapter_violations("fakepkg", ("core",), ("adapters",), graph) == {("core", "adapters")}

    # L1: it holds, then an adapter reaching the core breaks it - a module outside every layer counts.
    _accesses_only("fakepkg", "leaf adapters", ["ports"], layers).assert_applies(_graph(package, with_libraries=False))
    _plant(package, "adapters/x.py", "import fakepkg.contract\nimport fakepkg.core.clean\n")
    with pytest.raises(AssertionError):
        _accesses_only("fakepkg", "leaf adapters", ["ports"], layers).assert_applies(
            _graph(package, with_libraries=False)
        )

    # The ratchet releases: a repaired tree reports no violation at all.
    _plant(package, "core/leaky.py", "import fakepkg.contract\n")
    graph = _graph(package, with_libraries=True)
    assert _io_violations("fakepkg", ("core",), graph) == set()
    assert _adapter_violations("fakepkg", ("core",), ("adapters",), graph) == set()
```

How to read it:

- `CORE` names the seven modules that decide. `LEAF_ADAPTERS` and `CAPABILITY` name the adapter code: the search capability is counted as adapter code because it builds its own adapters today (leak 5 of the design).
- `IO_LIBRARIES` names fifteen import names. Four are imported somewhere in the service today (`httpx`, `requests`, `fastapi`, `arango`); the other eleven wait for the day the service adopts them. A name is checked by its exact import name: `urllib.parse` is imported today and is not on the list, `urllib.request` is on the list and is not imported.
- The two `KNOWN_*` sets are the ratchet. Do not edit them in this task.

- [ ] **Step 2: Run the module**

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/agentic-architecture/components/agent-service
/tmp/genie-agent-service-venv/bin/python -m pytest tests/test_architecture.py -v
```

Expected: six lines ending in `PASSED`, then `6 passed in < 1s`:

```
tests/test_architecture.py::test_the_rules_name_the_real_tree PASSED
tests/test_architecture.py::test_core_modules_import_no_io_library PASSED
tests/test_architecture.py::test_core_modules_import_no_adapter_code PASSED
tests/test_architecture.py::test_leaf_adapters_access_only_the_ports PASSED
tests/test_architecture.py::test_the_capability_accesses_only_ports_and_leaf_adapters PASSED
tests/test_architecture.py::test_the_rules_go_red_on_a_planted_violation PASSED
```

- [ ] **Step 3: Confirm the module is lint-clean at the CI pin**

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/agentic-architecture/components/agent-service
uvx ruff@0.16.3 check tests/test_architecture.py
uvx ruff@0.16.3 format --check tests/test_architecture.py
```

Expected: `All checks passed!` and `1 file already formatted`.

- [ ] **Step 4: Probe P1, first half — an illegal import at module level**

Plant, look, run, restore:

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/agentic-architecture/components/agent-service
sed -i '1i import socket' noagent/config.py
git diff --stat noagent/config.py
/tmp/genie-agent-service-venv/bin/python -m pytest tests/test_architecture.py -q
git restore noagent/config.py
git status --short noagent/config.py
```

Expected, in order: ` 1 file changed, 1 insertion(+)`; then `1 failed, 5 passed` with these lines in the failure of `test_core_modules_import_no_io_library`:

```
E         Extra items in the left set:
E         ('noagent', 'socket')
```

then nothing: the file is back to the committed content.

- [ ] **Step 5: Probe P1, second half — an illegal import inside a function**

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/agentic-architecture/components/agent-service
printf '\n\ndef _planted_probe() -> None:\n    import sqlite3\n' >> noagent/config.py
git diff --stat noagent/config.py
/tmp/genie-agent-service-venv/bin/python -m pytest tests/test_architecture.py -q
git restore noagent/config.py
git status --short noagent/config.py
```

Expected: ` 1 file changed, 4 insertions(+)` (two blank lines, the `def` line, the `import` line); then `1 failed, 5 passed` with:

```
E         Extra items in the left set:
E         ('noagent', 'sqlite3')
```

then nothing.

- [ ] **Step 6: Probe — a core module that imports an adapter**

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/agentic-architecture/components/agent-service
sed -i '1i from capabilities.adapters.http import RequestsTransport' noagent/config.py
git diff --stat noagent/config.py
/tmp/genie-agent-service-venv/bin/python -m pytest tests/test_architecture.py -q
git restore noagent/config.py
git status --short noagent/config.py
```

Expected: ` 1 file changed, 1 insertion(+)`; then `1 failed, 5 passed`, this time in `test_core_modules_import_no_adapter_code`, with:

```
E         Extra items in the left set:
E         ('noagent', 'capabilities.adapters')
```

then nothing.

- [ ] **Step 7: Run the whole suite and the lint job's checks**

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/agentic-architecture/components/agent-service
/tmp/genie-agent-service-venv/bin/python -m pytest tests/ -q
uvx ruff@0.16.3 check app.py tracing.py capabilities/ preparation/ noagent/ agent/ tests/
uvx ruff@0.16.3 format --check app.py tracing.py capabilities/ preparation/ noagent/ agent/ tests/
```

Expected: `928 passed, 2 warnings` (the 922 of the baseline plus six); `All checks passed!`; `90 files already formatted`.

- [ ] **Step 8: Commit**

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/agentic-architecture
git add components/agent-service/tests/test_architecture.py
git commit -m "test(agent-service): the dependency rules of the hexagonal map, as a ratchet"
```

---

### Task 3: The executor depends on Protocols, not on adapters

`capabilities/executor.py` enforces the document capability's contract. It imports three concrete adapters (`LegacyChunkAdapter`, `DocRepoAdapter`, `OkfAdapter`) for type annotations only. The annotations become three Protocols; nothing else changes, and no existing test is edited. The test that goes red is the ratchet of Task 2.

**Files:**
- Create: `components/agent-service/capabilities/sources.py`
- Create: `components/agent-service/tests/test_sources.py`
- Modify: `components/agent-service/capabilities/executor.py` (imports, lines 40–42 and 59–64; annotations, lines 85–87)
- Modify: `components/agent-service/tests/test_architecture.py` (`KNOWN_ADAPTER_VIOLATIONS`)

**Interfaces:**
- Consumes: `KNOWN_ADAPTER_VIOLATIONS` and `LEAF_ADAPTERS` from Task 2.
- Produces (used by the composition root today and by plan 2 tomorrow): `capabilities/sources.py` exports three `@runtime_checkable` Protocols —
  - `DocumentMetadataSource.fetch_metadata(self, file_id: str, bearer: str | None) -> dict[str, Any] | None`
  - `ConceptSource.fetch_concept(self, repo_id: str, concept_id: str, bearer: str | None) -> dict[str, Any] | None`
  - `ChunkReader.read_chunks(self, graph_name: str, file_id: str, max_chunks: int) -> tuple[str, bool]`

- [ ] **Step 1: Write the failing test**

Create `components/agent-service/tests/test_sources.py`:

```python
# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The driven ports of the document capability and the adapters that satisfy them."""

from capabilities.adapters.chunks import LegacyChunkAdapter
from capabilities.adapters.docrepo import DocRepoAdapter
from capabilities.adapters.okf import OkfAdapter
from capabilities.sources import ChunkReader, ConceptSource, DocumentMetadataSource


def test_the_corpus_adapters_satisfy_the_driven_ports() -> None:
    for adapter, port in (
        (LegacyChunkAdapter, ChunkReader),
        (DocRepoAdapter, DocumentMetadataSource),
        (OkfAdapter, ConceptSource),
    ):
        assert issubclass(adapter, port), f"{adapter.__name__} does not satisfy {port.__name__}"
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/agentic-architecture/components/agent-service
/tmp/genie-agent-service-venv/bin/python -m pytest tests/test_sources.py -q
```

Expected: the module fails to import — `ImportError while importing test module`, `E   ModuleNotFoundError: No module named 'capabilities.sources'`.

- [ ] **Step 3: Write the Protocols**

Create `components/agent-service/capabilities/sources.py`:

```python
# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The corpus sources the document capability reads through.

Driven ports of the hexagonal design: the three reads the executor needs from
the corpus, declared as Protocols and satisfied structurally by the adapters
in ``capabilities.adapters``. The executor names these and no adapter, so the
contract and its enforcement point import no adapter.
"""

from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class DocumentMetadataSource(Protocol):
    """Resolves a legacy file id to its metadata record, or ``None``."""

    async def fetch_metadata(self, file_id: str, bearer: str | None) -> dict[str, Any] | None: ...


@runtime_checkable
class ConceptSource(Protocol):
    """Reads one concept card, or ``None`` when it does not resolve."""

    async def fetch_concept(self, repo_id: str, concept_id: str, bearer: str | None) -> dict[str, Any] | None: ...


@runtime_checkable
class ChunkReader(Protocol):
    """Reads one legacy file's chunks out of its graph's source collection."""

    async def read_chunks(self, graph_name: str, file_id: str, max_chunks: int) -> tuple[str, bool]: ...
```

- [ ] **Step 4: Run the test to verify it passes**

Run the command of Step 2.

Expected: `1 passed in < 1s`.

- [ ] **Step 5: Check that the test can fail**

In `capabilities/sources.py`, rename the method of `ChunkReader`: replace `async def read_chunks(self, graph_name: str` with `async def read_chunk_rows(self, graph_name: str`. Run the command of Step 2.

Expected: `1 failed`, with:

```
E           AssertionError: LegacyChunkAdapter does not satisfy ChunkReader
```

Rename it back (`read_chunk_rows` to `read_chunks`) and run the command again.

Expected: `1 passed in < 1s`.

- [ ] **Step 6: Point the executor at the Protocols**

Three edits in `components/agent-service/capabilities/executor.py`.

First, remove the adapter imports. Replace:

```python
from capabilities.adapters.chunks import LegacyChunkAdapter
from capabilities.adapters.docrepo import DocRepoAdapter
from capabilities.adapters.okf import OkfAdapter
from capabilities.contract import (
```

with:

```python
from capabilities.contract import (
```

Second, import the Protocols. Replace:

```python
from capabilities.identifiers import (
    ensure_graph_name_config,
    validate_concept_id,
    validate_file_id,
    validate_repo_id,
)
```

with:

```python
from capabilities.identifiers import (
    ensure_graph_name_config,
    validate_concept_id,
    validate_file_id,
    validate_repo_id,
)
from capabilities.sources import ChunkReader, ConceptSource, DocumentMetadataSource
```

Third, the annotations of `__init__`. Replace:

```python
        docrepo: DocRepoAdapter,
        okf: OkfAdapter,
        chunks: LegacyChunkAdapter,
```

with:

```python
        docrepo: DocumentMetadataSource,
        okf: ConceptSource,
        chunks: ChunkReader,
```

- [ ] **Step 7: Run the architecture test — the ratchet must go red**

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/agentic-architecture/components/agent-service
/tmp/genie-agent-service-venv/bin/python -m pytest tests/test_architecture.py -q
```

Expected: `1 failed, 5 passed` in `test_core_modules_import_no_adapter_code`, with:

```
E         Extra items in the right set:
E         ('capabilities.executor', 'capabilities.adapters')
```

The right set is the list. The tree no longer has the violation, so the list is now too long.

- [ ] **Step 8: Shrink the list**

In `components/agent-service/tests/test_architecture.py`, delete this line from `KNOWN_ADAPTER_VIOLATIONS`:

```python
    ("capabilities.executor", LEAF_ADAPTERS),  # the executor names three concrete adapters
```

Run the command of Step 7 again.

Expected: `6 passed in < 1s`.

- [ ] **Step 9: Run the whole suite and the lint job's checks**

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/agentic-architecture/components/agent-service
/tmp/genie-agent-service-venv/bin/python -m pytest tests/ -q
uvx ruff@0.16.3 check app.py tracing.py capabilities/ preparation/ noagent/ agent/ tests/
uvx ruff@0.16.3 format --check app.py tracing.py capabilities/ preparation/ noagent/ agent/ tests/
```

Expected: `929 passed, 2 warnings` (one more than Task 2: the test of Step 1); `All checks passed!`; `92 files already formatted`.

- [ ] **Step 10: Commit**

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/agentic-architecture
git add components/agent-service/capabilities/sources.py components/agent-service/capabilities/executor.py components/agent-service/tests/test_sources.py components/agent-service/tests/test_architecture.py
git commit -m "refactor(agent-service): the executor depends on Protocols, not on adapters"
```

---

### Task 4: The reranker abstention text lives in the contract

`RERANKER_INPUT_TOO_LONG_ABSTENTION_TEXT` is defined in `capabilities/search_knowledge.py`. The search capability logs it when it abstains; `noagent/prompt.py` imports it from there and re-exports it, and the no-agent pipeline answers with it. That import makes a core module depend on adapter code. The text moves to `capabilities/contract.py`, the module both sides already import. The text itself does not change, and no existing test is edited: the three assertions of `tests/test_noagent_pipeline.py` read the name through `noagent.prompt`, which keeps exporting it.

**Files:**
- Modify: `components/agent-service/capabilities/contract.py` (one constant, above `class SearchKnowledgeResult`)
- Modify: `components/agent-service/capabilities/search_knowledge.py` (the definition goes; the contract import grows)
- Modify: `components/agent-service/noagent/prompt.py` (the import source)
- Modify: `components/agent-service/tests/test_architecture.py` (`KNOWN_ADAPTER_VIOLATIONS`)

**Interfaces:**
- Consumes: `KNOWN_ADAPTER_VIOLATIONS` and `CAPABILITY` from Task 2.
- Produces: `capabilities.contract.RERANKER_INPUT_TOO_LONG_ABSTENTION_TEXT` (a `str`), re-exported as `noagent.prompt.RERANKER_INPUT_TOO_LONG_ABSTENTION_TEXT`.

- [ ] **Step 1: Define the text in the contract**

In `components/agent-service/capabilities/contract.py`, replace:

```python
class SearchKnowledgeResult(BaseModel):
    """The `search_knowledge` result.
```

with:

```python
# The recorded English abstention text — the too-long case's answer text; who
# translates it stays with the answer layer, as deployed. The search capability
# logs it when it abstains; the no-agent pipeline answers with it.
RERANKER_INPUT_TOO_LONG_ABSTENTION_TEXT = (
    "I cannot reliably answer this query because the "
    "retrieved documents exceed the reranker's input "
    "limit. This indicates a data ingestion issue."
)


class SearchKnowledgeResult(BaseModel):
    """The `search_knowledge` result.
```

- [ ] **Step 2: Import it in the search capability, and drop the definition**

In `components/agent-service/capabilities/search_knowledge.py`, add the name at the head of the contract import block. Replace:

```python
from .contract import (
    AuthorizationError,
```

with:

```python
from .contract import (
    RERANKER_INPUT_TOO_LONG_ABSTENTION_TEXT,
    AuthorizationError,
```

The name comes first because the lint rule `I` sorts constants before classes. Then remove the definition. Replace:

```python
logger = logging.getLogger(__name__)

# The recorded English abstention text — the too-long case's
# answer text; who translates it stays with the answer layer, as deployed.
# PUBLIC single owner: the no-agent pipeline answers with the same constant
# it imports from here — one edit point moves the log surface and the answer.
RERANKER_INPUT_TOO_LONG_ABSTENTION_TEXT = (
    "I cannot reliably answer this query because the "
    "retrieved documents exceed the reranker's input "
    "limit. This indicates a data ingestion issue."
)


class SearchKnowledgeCapability:
```

with:

```python
logger = logging.getLogger(__name__)


class SearchKnowledgeCapability:
```

- [ ] **Step 3: Import it from the contract in the prompt module**

In `components/agent-service/noagent/prompt.py`, replace:

```python
from capabilities.search_knowledge import (
    RERANKER_INPUT_TOO_LONG_ABSTENTION_TEXT as RERANKER_INPUT_TOO_LONG_ABSTENTION_TEXT,
)
```

with:

```python
from capabilities.contract import (
    RERANKER_INPUT_TOO_LONG_ABSTENTION_TEXT as RERANKER_INPUT_TOO_LONG_ABSTENTION_TEXT,
)
```

The `as` form keeps the re-export explicit, which is this file's convention for a name it does not use itself.

- [ ] **Step 4: Run the architecture test — the ratchet must go red**

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/agentic-architecture/components/agent-service
/tmp/genie-agent-service-venv/bin/python -m pytest tests/test_architecture.py -q
```

Expected: `1 failed, 5 passed` in `test_core_modules_import_no_adapter_code`, with:

```
E         Extra items in the right set:
E         ('noagent', 'capabilities.search_knowledge')
```

- [ ] **Step 5: Shrink the list**

In `components/agent-service/tests/test_architecture.py`, delete this line from `KNOWN_ADAPTER_VIOLATIONS`:

```python
    ("noagent", CAPABILITY),  # noagent/prompt.py imports the reranker abstention text from the capability
```

Run the command of Step 4 again.

Expected: `6 passed in < 1s`.

- [ ] **Step 6: Run the whole suite and the lint job's checks**

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/agentic-architecture/components/agent-service
/tmp/genie-agent-service-venv/bin/python -m pytest tests/ -q
uvx ruff@0.16.3 check app.py tracing.py capabilities/ preparation/ noagent/ agent/ tests/
uvx ruff@0.16.3 format --check app.py tracing.py capabilities/ preparation/ noagent/ agent/ tests/
```

Expected: `929 passed, 2 warnings` — the same count as Task 3, because no test was added or removed; `All checks passed!`; `92 files already formatted`.

- [ ] **Step 7: Commit**

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/agentic-architecture
git add components/agent-service/capabilities/contract.py components/agent-service/capabilities/search_knowledge.py components/agent-service/noagent/prompt.py components/agent-service/tests/test_architecture.py
git commit -m "refactor(agent-service): the reranker abstention text lives in the contract"
```

---

## Final verification

Run from the worktree; every line is one the plan already produced on a copy of the service.

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/agentic-architecture
python3 scripts/dependencies/verify-dependency-licenses.py --verify components/agent-service/requirements.txt components/agent-service/requirements-test.txt --evidence docs/dependencies/agent-service-dependency-evidence.json
git log --oneline -4
git status --short
cd components/agent-service
/tmp/genie-agent-service-venv/bin/python -m pytest tests/ -q
uvx ruff@0.16.3 check app.py tracing.py capabilities/ preparation/ noagent/ agent/ tests/
uvx ruff@0.16.3 format --check app.py tracing.py capabilities/ preparation/ noagent/ agent/ tests/
```

Expected:

- `OK 51 pinned package(s): licence verified, defaults audit recorded.`
- four commits on top of `4890f2eb4`: `build(agent-service): pin pytestarch…`, `test(agent-service): the dependency rules…`, `refactor(agent-service): the executor depends on Protocols…`, `refactor(agent-service): the reranker abstention text…`.
- `git status --short` prints nothing. If it prints a line, it names a file this plan does not touch: stop and report it.
- `929 passed, 2 warnings`.
- `All checks passed!` and `92 files already formatted`.

### What this plan establishes

| Design item | Where | Evidence |
|---|---|---|
| R1, R2 as ratchets (§2.5) | `test_core_modules_import_no_io_library`, `test_core_modules_import_no_adapter_code` | Steps 4 to 6 of Task 2: three planted imports, three reported pairs |
| L1, L2 (§2.5) | `test_leaf_adapters_access_only_the_ports`, `test_the_capability_accesses_only_ports_and_leaf_adapters` | green on the tree; red on a planted cross-layer import (Task 2, Step 1, last test) |
| Probe P1 (§10.8) | Task 2, Steps 4 and 5 | an illegal import at module level and one inside a function each turn the suite red |
| Leak 4 closed (§2.3) | `capabilities/sources.py`, `capabilities/executor.py` | the pair leaves the ratchet; `test_the_corpus_adapters_satisfy_the_driven_ports` |
| Leak 5, constant half (§2.3) | `capabilities/contract.py` | the pair leaves the ratchet; `test_equivalence_v02.py` untouched and green |

### What it leaves open

- Five listed violations, closed by plan 2 (composition out of the core). Until then the docstring of the test module is right to say that R1 and R2 "do not hold on the whole tree yet"; plan 2 rewrites that sentence when the lists become empty.
- Rule R3 (only the composition root imports the adapters) is not switched on: it would fail on every module that reaches an adapter through `agent/probe.py` or the capability today.
- `pytestarch` reads the syntax tree. A dynamic `importlib.import_module` in a core module is invisible to it. The design keeps that as a code-review item.
- Probe P1's third form — the synthetic-package test — covers the `.venv` exclusion as well; the two other probes ran on `noagent/config.py` only.

## Landing

The four commits stay on `feat/agentic-foundations/architecture` until the operator says otherwise. On their word:

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/agentic-architecture
git push
```

Then start exactly one CI monitor for the merge request's pipeline, in the background, and read the pipeline id from the push output: `~/.local/bin/ci-monitor.sh gitlab <pipeline_id>`. The merge request that receives the push is !1088, which targets `feat/agentic-foundations/prd` and must merge there before !938 enters the merge train.
