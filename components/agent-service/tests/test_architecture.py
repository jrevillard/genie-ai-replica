# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The dependency rules of the agent service.

Every module of the service belongs to one of four layers:

* HOST — ``app.py`` composes; ``tracing.py`` wires the telemetry SDK.
* CORE — decides: ``agent/``, ``noagent/``, ``preparation/`` and the contract
  modules of ``capabilities/``.
* LEAF ADAPTERS — ``capabilities/adapters/``: reach the corpus.
* CAPABILITY — ``capabilities/search_knowledge.py``: the search capability,
  which builds its own adapters today.

Seven rules keep the layers apart:

* **C** — every module is classified. A module outside the layers would have
  no rule looking at it.
* **R1** — a core module imports no I/O library.
* **R2** — a core module imports no module of another layer, the telemetry
  facade ``tracing`` excepted.
* **R3** — the modules that import the leaf adapters are a listed set.
* **T** — the telemetry SDK is imported by ``tracing`` and by nothing else.
* **L1**, **L2** — a leaf adapter accesses only the ports it implements; the
  capability accesses only the ports and the leaf adapters.

R1 and R2 do not hold on the whole tree yet. They are written as a ratchet:
the violations found on the tree are asserted equal to a listed set
(``KNOWN_IO_VIOLATIONS``, ``KNOWN_INTERNAL_VIOLATIONS``). A violation is a
(module, import) pair, named by the file that causes it. Closing a leak removes
its pair from the tree and the test goes red until the list shrinks with it; a
new leak adds a pair and the test goes red as well. The lists change only
through a visible edit of this file.

``pytestarch`` reads imports from the syntax tree: a function-local ``import``
is seen, a dynamic ``importlib.import_module`` is not. It names an import after
the PACKAGE it comes from — ``from urllib import request`` is the import of
``urllib`` — so the rules name packages. The last test plants each violation on
a synthetic package and checks that the same helpers report it.
"""

from pathlib import Path
from typing import NamedTuple

import pytest
from pytestarch import EvaluableArchitecture, LayeredArchitecture, LayerRule, Rule, get_evaluable_architecture

SERVICE = Path(__file__).resolve().parents[1]


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


SERVICE_LAYOUT = Layout(
    host=("app", "tracing", "lane", "assembly"),
    core_packages=("agent", "noagent", "preparation"),
    core_modules=(
        "capabilities",
        "capabilities.__init__",
        "capabilities.contract",
        "capabilities.executor",
        "capabilities.citations",
        "capabilities.identifiers",
        "capabilities.model",
        "capabilities.sources",
    ),
    leaf_adapters="capabilities.adapters",
    capability="capabilities.search_knowledge",
    measurement=("measurement",),
)

# The telemetry facade: the one module of the host the core may import, and
# the only one allowed to import the telemetry SDK.
TELEMETRY_FACADE = "tracing"
# What the core and the adapters exchange.
PORTS = ("capabilities.contract", "capabilities.identifiers", "capabilities.model", "capabilities.sources")
# The import names a core module never imports. The list names PACKAGES, so
# ``from urllib import request`` is caught as the import of ``urllib``.
IO_LIBRARIES = (
    "httpx",
    "requests",
    "aiohttp",
    "http",
    "urllib",
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
    "fcntl",
)
# The libraries of the list above that the service does not import yet. A
# library that enters the tree leaves this set; a name of IO_LIBRARIES that is
# neither imported nor declared here is a typo, and the rule that checks the
# list says so.
IO_LIBRARIES_NOT_YET_IMPORTED = (
    "aiohttp",
    "socket",
    "starlette",
    "uvicorn",
    "sqlite3",
    "redis",
    "mcp",
    "openai",
    "subprocess",
)
TELEMETRY_SDK = "opentelemetry"

# The libraries a core module may import, besides the standard library's
# own shape: the modelling, the detection and the async plumbing. The I/O
# list above names the ones it may NOT import; a library in neither list is
# a leak the ratchet would not see — this whitelist is what makes the hole
# visible.
CORE_ALLOWED_LIBRARIES = ("anyio", "fastapi", "langdetect", "pydantic")

# The standard-library modules a core module imports today. The list is
# explicit: the standard library is a closed set for the pinned Python
# (3.11), and naming it is what makes a NEW import (smtplib, ftplib, a
# socket's own module) visible instead of invisible.
CORE_ALLOWED_STDLIB = (
    "asyncio",
    "collections",
    "contextlib",
    "dataclasses",
    "enum",
    "hashlib",
    "json",
    "logging",
    "math",
    "os",
    "pathlib",
    "re",
    "time",
    "typing",
    "uuid",
)

# R1 — (core module, library): the files that still import an I/O library.
KNOWN_IO_VIOLATIONS: set[tuple[str, str]] = set()
# R2 — (core module, module of another layer): the files that still reach another layer.
KNOWN_INTERNAL_VIOLATIONS: set[tuple[str, str]] = set()
# R3 — the modules that import the leaf adapters.
KNOWN_ADAPTER_IMPORTERS = {
    "assembly",  # assembly.py: the host builds the corpus adapters
    "app",  # app.py: the composition root builds the transport adapter
    "capabilities.search_knowledge",  # the capability builds its own adapters
}

LAYERS = {
    "ports": PORTS,
    "leaf adapters": (SERVICE_LAYOUT.leaf_adapters,),
    "capability": (SERVICE_LAYOUT.capability,),
}


def _graph(root: Path, *, with_libraries: bool) -> EvaluableArchitecture:
    """The dependency graph of one package tree; its tests, caches and environments left out."""

    return get_evaluable_architecture(
        root,
        root,
        exclusions=(f"*{root.name}/tests*", "*__pycache__*", "*/.venv/*"),
        exclude_external_libraries=not with_libraries,
    )


def _named(root: str, module: str) -> str:
    return f"{root}.{module}"


def _imports_no_library(root: str, subject: str, library: str) -> Rule:
    """``root.subject`` does not import ``library`` nor any of its submodules."""

    return (
        Rule().modules_that().are_named([_named(root, subject)]).should_not().import_modules_that().are_named([library])
    )


def _imports_no_module(root: str, subject: str, forbidden: str) -> Rule:
    """``root.subject`` does not import ``root.forbidden`` nor any of its submodules."""

    return _imports_no_library(root, subject, _named(root, forbidden))


def _violated(rule: Rule, graph: EvaluableArchitecture) -> bool:
    """True when the rule does not hold on the graph."""

    try:
        rule.assert_applies(graph)
    except AssertionError:
        return True
    return False


def _is_module(name: str, prefix: str) -> bool:
    """True for the node of a source file under ``prefix``.

    ``pytestarch`` keeps a node for a cache or an environment directory even
    when its files are excluded; the nodes of such directories are not modules.
    """

    if not name.startswith(prefix):
        return False
    relative = name[len(prefix) :]
    return bool(relative) and not relative.startswith(".") and ".." not in relative and "__pycache__" not in relative


def _modules(graph: EvaluableArchitecture, root: str) -> list[str]:
    """The modules of the tree, relative to ``root``."""

    return sorted(name[len(root) + 1 :] for name in graph.modules if _is_module(name, root + "."))


def _leaf_modules(modules: list[str]) -> list[str]:
    """The modules that hold imports of their own.

    A package node carries none: the imports of its ``__init__.py`` sit in its
    ``__init__`` node.
    """

    return [module for module in modules if f"{module}.__init__" not in modules]


def _within(module: str, package: str) -> bool:
    return module == package or module.startswith(package + ".")


def _layer_of(module: str, layout: Layout) -> str | None:
    """The layer a module belongs to, or ``None`` when it belongs to none."""

    if module in layout.host:
        return "host"
    if any(_within(module, name) for name in layout.measurement):
        return "measurement"
    if _within(module, layout.leaf_adapters):
        return "leaf adapters"
    if module == layout.capability:
        return "capability"
    if module in layout.core_modules or any(_within(module, package) for package in layout.core_packages):
        return "core"
    return None


def _in_layers(modules: list[str], layers: tuple[str, ...], layout: Layout) -> list[str]:
    """The modules of the given layers."""

    return [module for module in modules if _layer_of(module, layout) in layers]


def _other_layers(layout: Layout) -> list[str]:
    """The roots of what a core module may not import: the host, the adapters,
    the capability — and the MEASUREMENT layer.

    The measurement layer is a measurement surface, not core: it reaches the
    corpus through the adapters and the core's own modules, so a core module
    importing it would make the core depend on an evidence surface (the
    probe ships in the image and reaches the adapters). The direction is
    one-way: the measurement layer may use the core, never the reverse.
    """

    return [module for module in layout.host if module != TELEMETRY_FACADE] + [
        layout.leaf_adapters,
        layout.capability,
        layout.measurement[0],
    ]


def _external_modules(graph: EvaluableArchitecture) -> list[str]:
    """The modules outside the service's own tree — the libraries it imports."""

    return sorted(name for name in graph.modules if name != SERVICE.name and not _is_module(name, SERVICE.name + "."))


def _present(graph: EvaluableArchitecture, library: str) -> bool:
    """True when the library is in the graph at all."""

    return any(name == library or name.startswith(library + ".") for name in graph.modules)


def _io_violations(
    root: str, subjects: list[str], graph: EvaluableArchitecture, libraries: tuple[str, ...] = IO_LIBRARIES
) -> set[tuple[str, str]]:
    """The (module, library) pairs of ``subjects`` that import a library of ``libraries``."""

    violations = set()
    for module in subjects:
        for library in libraries:
            if not _present(graph, library):
                continue  # nothing imports this library: the rule has nothing to check
            if _violated(_imports_no_library(root, module, library), graph):
                violations.add((module, library))
    return violations


def _internal_violations(
    root: str, subjects: list[str], forbidden: tuple[str, ...], graph: EvaluableArchitecture
) -> set[tuple[str, str]]:
    """The (module, forbidden module) pairs of ``subjects`` that import a module of ``forbidden``."""

    return {
        (module, other)
        for module in subjects
        for other in forbidden
        if _violated(_imports_no_module(root, module, other), graph)
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


def test_every_module_belongs_to_a_layer(internal: EvaluableArchitecture) -> None:
    modules = _modules(internal, SERVICE.name)
    assert "app" in modules
    assert [module for module in modules if _layer_of(module, SERVICE_LAYOUT) is None] == []


def test_the_io_library_list_covers_the_tree(with_libraries: EvaluableArchitecture) -> None:
    """Every name of the list is imported by the service or declared as not yet imported."""

    modules = _leaf_modules(_modules(with_libraries, SERVICE.name))
    imported = {
        library
        for library in IO_LIBRARIES
        if _present(with_libraries, library)
        and any(_violated(_imports_no_library(SERVICE.name, module, library), with_libraries) for module in modules)
    }
    assert imported | set(IO_LIBRARIES_NOT_YET_IMPORTED) == set(IO_LIBRARIES)
    assert not imported & set(IO_LIBRARIES_NOT_YET_IMPORTED)


def test_core_modules_import_no_io_library(with_libraries: EvaluableArchitecture) -> None:
    core = _in_layers(_leaf_modules(_modules(with_libraries, SERVICE.name)), ("core",), SERVICE_LAYOUT)
    assert _io_violations(SERVICE.name, core, with_libraries) == KNOWN_IO_VIOLATIONS


def test_the_core_imports_no_undeclared_library(with_libraries: EvaluableArchitecture) -> None:
    """Every library the core reaches is named.

    Rule R1 watches the libraries IO_LIBRARIES names; a core module that
    starts importing a library nobody listed would slip past it. This test
    closes the hole: the core's external imports are the named standard
    library modules plus the named libraries, so a new one — a third-party
    package or a standard-library module — turns this red.
    """

    core = _in_layers(_leaf_modules(_modules(with_libraries, SERVICE.name)), ("core",), SERVICE_LAYOUT)
    undeclared = set()
    for node in _external_modules(with_libraries):
        library = node.split(".")[0]
        if (
            not library
            or library == SERVICE.name  # the cache directories leave nodes behind
            or library in CORE_ALLOWED_STDLIB
            or library in CORE_ALLOWED_LIBRARIES
        ):
            continue
        undeclared |= {name for _, name in _io_violations(SERVICE.name, core, with_libraries, (library,))}
    assert undeclared == set()


def test_core_modules_import_no_other_layer(internal: EvaluableArchitecture) -> None:
    core = _in_layers(_leaf_modules(_modules(internal, SERVICE.name)), ("core",), SERVICE_LAYOUT)
    violations = _internal_violations(SERVICE.name, core, tuple(_other_layers(SERVICE_LAYOUT)), internal)
    assert violations == KNOWN_INTERNAL_VIOLATIONS


def test_only_the_listed_modules_import_the_leaf_adapters(internal: EvaluableArchitecture) -> None:
    modules = [
        module
        for module in _leaf_modules(_modules(internal, SERVICE.name))
        if not _within(module, SERVICE_LAYOUT.leaf_adapters) and _layer_of(module, SERVICE_LAYOUT) != "measurement"
    ]
    importers = {
        module
        for module in modules
        if _internal_violations(SERVICE.name, [module], (SERVICE_LAYOUT.leaf_adapters,), internal)
    }
    assert importers == KNOWN_ADAPTER_IMPORTERS


def test_the_telemetry_sdk_is_imported_by_the_tracing_module_only(with_libraries: EvaluableArchitecture) -> None:
    modules = [module for module in _modules(with_libraries, SERVICE.name) if module != TELEMETRY_FACADE]
    assert _io_violations(SERVICE.name, modules, with_libraries, (TELEMETRY_SDK,)) == set()


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
    root = package.name
    layout = Layout(
        host=("app", "tracing", "lane", "assembly"),
        core_packages=("core",),
        core_modules=("contract", "model"),
        leaf_adapters="adapters",
        capability="capability",
        measurement=("measure",),
    )
    layers = {"ports": ("contract", "model"), "leaf adapters": ("adapters",), "capability": ("capability",)}
    clean = {
        "app.py": "import fakepkg.adapters.x\nimport requests\n",
        "lane.py": '"""The host lane."""\n',
        "assembly.py": '"""The host assembly."""\n',
        "tracing.py": "import opentelemetry\n",
        "contract.py": "",
        "model.py": "",
        "core/__init__.py": "",
        "core/clean.py": "import fakepkg.contract\n",
        "core/leaky.py": "import fakepkg.adapters.x\nimport httpx\n",
        "adapters/__init__.py": "",
        "adapters/x.py": "import fakepkg.contract\n",
        "capability.py": "import fakepkg.adapters.x\nimport fakepkg.contract\n",
        "measure.py": "import fakepkg.adapters.x\n",
        "wiring.py": "import socket\n",
        ".venv/lib/python3.11/site-packages/hidden.py": "import ssl\n",
    }
    for relative, source in clean.items():
        _plant(package, relative, source)

    def modules(with_libraries: bool) -> list[str]:
        return _leaf_modules(_modules(_graph(package, with_libraries=with_libraries), root))

    def core_modules() -> list[str]:
        return _in_layers(modules(True), ("core",), layout)

    # An environment directory is not part of the architecture.
    assert "ssl" not in _graph(package, with_libraries=True).modules

    # C: the module outside every layer is named, and it is gone once deleted.
    assert [module for module in modules(True) if _layer_of(module, layout) is None] == ["wiring"]
    (package / "wiring.py").unlink()

    # R1: the planted import is reported by its file; the clean module and the host are not.
    assert _io_violations(root, core_modules(), _graph(package, with_libraries=True)) == {("core.leaky", "httpx")}

    # R2: the same for a core module that reaches another layer.
    assert _internal_violations(
        root, core_modules(), tuple(_other_layers(layout)), _graph(package, with_libraries=False)
    ) == {("core.leaky", "adapters")}

    # R3: the direct importers of the adapters are the listed ones.
    def adapter_importers() -> set[str]:
        subjects = [
            module
            for module in modules(False)
            if not _within(module, "adapters") and _layer_of(module, layout) != "measurement"
        ]
        return {
            module
            for module in subjects
            if _internal_violations(root, [module], ("adapters",), _graph(package, with_libraries=False))
        }

    assert adapter_importers() == {"app", "core.leaky", "capability"}

    # T: the SDK sits in the facade; any other module importing it is reported.
    def outside_facade() -> list[str]:
        return [module for module in modules(True) if module != "tracing"]

    assert _io_violations(root, outside_facade(), _graph(package, with_libraries=True), (TELEMETRY_SDK,)) == set()
    _plant(package, "app.py", clean["app.py"] + "import opentelemetry\n")
    assert _io_violations(root, outside_facade(), _graph(package, with_libraries=True), (TELEMETRY_SDK,)) == {
        ("app", "opentelemetry")
    }

    # L1 and L2: they hold, then a cross-layer import breaks each.
    _accesses_only(root, "leaf adapters", ["ports"], layers).assert_applies(_graph(package, with_libraries=False))
    _accesses_only(root, "capability", ["ports", "leaf adapters"], layers).assert_applies(
        _graph(package, with_libraries=False)
    )
    _plant(package, "adapters/x.py", clean["adapters/x.py"] + "import fakepkg.core.clean\n")
    with pytest.raises(AssertionError):
        _accesses_only(root, "leaf adapters", ["ports"], layers).assert_applies(_graph(package, with_libraries=False))
    _plant(package, "capability.py", clean["capability.py"] + "import fakepkg.core.clean\n")
    with pytest.raises(AssertionError):
        _accesses_only(root, "capability", ["ports", "leaf adapters"], layers).assert_applies(
            _graph(package, with_libraries=False)
        )

    # The ratchet releases: a repaired tree reports no violation at all.
    _plant(package, "core/leaky.py", clean["core/clean.py"])
    assert _io_violations(root, core_modules(), _graph(package, with_libraries=True)) == set()
    assert (
        _internal_violations(root, core_modules(), tuple(_other_layers(layout)), _graph(package, with_libraries=False))
        == set()
    )
