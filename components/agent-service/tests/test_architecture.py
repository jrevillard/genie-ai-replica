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
  capability accesses only the ports. The host injects the connectors the
  capability drives (ADR agentic-009, F2), so the code that decides never
  imports the code that reaches.

Three more rules read the code's TEXT rather than its imports: **R4** (the
deciding modules carry no platform vocabulary), **R5** (the identifier guards
accept any safe token) and **R6** (the core states no platform's acceptance
rules). An import rule cannot see a claim the code makes about a platform —
a guard that encodes the database's identifier rules refuses what the database
accepts — so the claims get their own rule (ADR agentic-009).

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

import ast
import re
import tokenize
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
        "capabilities.retrieval",
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
PORTS = (
    "capabilities.contract",
    "capabilities.identifiers",
    "capabilities.model",
    "capabilities.retrieval",
    "capabilities.sources",
)
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
}

# R4 — the platform vocabulary the core's TEXT carries.
#
# R1–R3 and L1/L2 police the IMPORTS: a core module may hold a platform's
# NAME without importing a platform's MODULE, and the import rules stay
# green. This rule reads the core's source instead — the text is where the
# next leak hides (ADR agentic-009).
#
# The scan reads CODE, not prose: a comment or a docstring that NAMES a
# platform (to explain it, to point at it) is documentation, not a
# dependency. Only the code's own literals count.
#
# Each pattern is a platform's own vocabulary. A finding is
# ``(module, pattern)``: the file that carries it, and the literal found.
PLATFORM_VOCABULARY = {
    # ArangoDB's collections (the corpus's own names).
    "arango_collection": ("GRAPH_SOURCE", "GRAPH_ENTITY", "GRAPH_LINKS_TO"),
    # ArangoDB's configuration prefix.
    "arango_env": ("ARANGO_",),
    # The document repository's own HTTP surface and its upload directory.
    "docrepo_surface": ("/api/files", "uploaded_files"),
    # An identifier turned into a display value — the core deriving a name
    # from a token it was handed.
    "id_derived_value": ('replace("_", " ")',),
}

# The leak set the core still carries. A fix removes one finding and shrinks
# this list in the same commit; a NEW leak adds one and turns the test red.
KNOWN_PLATFORM_VOCABULARY: set[tuple[str, str]] = set()
# EMPTY, and that is the point: F5 is closed on BOTH branches. The
# legacy branch resolves the document's own name through the document
# repository's port, and the OKF branch resolves the concept's own name
# through the OKF server's port — each branch asks the platform that
# holds the source, and neither derives a name from a token
# (ADR agentic-009). The rule that found them stays: an id turned into
# a display value is still a leak, and a NEW one turns this test red.

# The modules whose TEXT the rule reads: the core and the capability — the
# modules that DECIDE. The ports (contract, identifiers, model, sources) are
# excluded: a port names the vocabulary it expects from its connector, which
# is the port's job (ADR agentic-009, "the counterparty's vocabulary stays
# in the port").
DECIDING_LAYERS = ("core", "capability")

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


def _docstring_lines(source: str) -> set[int]:
    """The lines the module's, classes' and functions' docstrings occupy.

    A docstring is documentation: it may NAME a platform to explain it. The
    rule reads code, so the docstrings' lines are excluded from the scan.
    """

    lines: set[int] = set()
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return lines
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        body = getattr(node, "body", [])
        if not body:
            continue
        first = body[0]
        if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) and isinstance(first.value.value, str):
            lines.update(range(first.value.lineno, (first.value.end_lineno or first.value.lineno) + 1))
    return lines


def _code_text(path: Path, *, keep_docstrings: bool = False) -> str:
    """The module's CODE — its source, without the comments and the docstrings.

    The scan reads the source itself, not a re-joined token stream: an
    idiom like ``replace("_", " ")`` is spelled with spaces in the file,
    and a token stream would spell it differently. ``tokenize`` finds the
    comments (blanked in place) and the AST finds the docstrings (their
    lines blanked), so the text that remains is the code.

    ``keep_docstrings`` keeps the docstrings in the text — for the rules
    that read a CLAIM the code makes about a platform, which a docstring
    states as often as a message does.
    """

    source = path.read_text(encoding="utf-8")
    lines = source.splitlines(keepends=True)
    docstrings = _docstring_lines(source)
    try:
        tokens = list(tokenize.generate_tokens(iter(lines).__next__))
    except (tokenize.TokenError, IndentationError):
        return source
    for token in tokens:
        if token.type != tokenize.COMMENT:
            continue
        (row, column), (end_row, end_column) = token.start, token.end
        for index in range(row - 1, end_row):
            if index >= len(lines):
                continue
            line = lines[index]
            start = column if index == row - 1 else 0
            stop = end_column if index == end_row - 1 else len(line)
            lines[index] = line[:start] + " " * max(0, stop - start) + line[stop:]
    if not keep_docstrings:
        for number in docstrings:
            if 0 < number <= len(lines):
                lines[number - 1] = "\n"
    return "".join(lines)


def _platform_vocabulary_findings() -> set[tuple[str, str]]:
    """The (module, pattern) pairs the deciding modules carry."""

    findings: set[tuple[str, str]] = set()
    deciding = _in_layers(
        _leaf_modules(_modules(_graph(SERVICE, with_libraries=False), SERVICE.name)), DECIDING_LAYERS, SERVICE_LAYOUT
    )
    deciding = [module for module in deciding if module not in PORTS]
    for module in deciding:
        path = SERVICE / Path(*module.split(".")).with_suffix(".py")
        if not path.exists():
            continue
        code = _code_text(path)
        for name, patterns in PLATFORM_VOCABULARY.items():
            for pattern in patterns:
                if pattern in code:
                    findings.add((module, name))
    return findings


def test_the_core_carries_no_platform_vocabulary() -> None:
    """R4 — the core's TEXT names no platform (ADR agentic-009).

    The import rules (R1–R3, L1, L2) police the direction of the
    dependencies; this rule polices their CONTENT. A core module may hold
    a platform's name without importing a platform's module, and the
    import rules stay green — which is how the document-id form, the
    Arango collection names and the id-derived display name reached the
    core in the first place.
    """

    assert _platform_vocabulary_findings() == KNOWN_PLATFORM_VOCABULARY


# R6 — the core states no FOREIGN system's acceptance rules.
#
# R4 reads the deciding modules' code for a platform's NAMES, from an
# explicit list: a leak is named and a new one joins the list. R6 asks the
# generic question instead — does the core state what a system it does not
# implement ACCEPTS?
#
# A claim has a SHAPE: a subject and an acceptance verb ("ArangoDB accepts",
# "the corpus database allows", "Redis-safe"), and the subject of a claim
# about the outside is a proper noun. The rule reads every acceptance
# statement in the core's text and asks whether its subject is one of the
# core's OWN concepts. The allow-list below holds the core's vocabulary and
# NEVER a platform's name: a platform joins nothing, and a platform nobody
# has used yet (Redis, S3, the database of tomorrow) is caught by the shape
# alone.
#
# A claim is not documentation: the code's behaviour changes when the
# system's rules change, so the claim is a dependency no import rule can
# see, and it is the shape of the F1 defect — a guard that encodes a
# system's rules refuses what that system accepts.
#
# The scan KEEPS the docstrings: a claim's usual hiding place is the
# docstring of the very guard that enforces it, and the next module written
# from that docstring inherits the rule.
#
# The leaf adapters are the connectors: stating the platform's rules is
# their job, so they are out of scope.
CORE_VOCABULARY = frozenset(
    {
        "Agent",
        "Answer",
        "Capability",
        "Chunk",
        "Concept",
        "Connector",
        "Context",
        "Contract",
        "Corpus",
        "Database",
        "Deployment",
        "Document",
        "Error",
        "Graph",
        "Guard",
        "Identifier",
        "Label",
        "Leg",
        "Model",
        "Operation",
        "Operator",
        "Platform",
        "Port",
        "Prompt",
        "Query",
        "Refusal",
        "Request",
        "Response",
        "Result",
        "Run",
        "Search",
        "Service",
        "Source",
        "Token",
        "Value",
    }
)

# The shape of a claim about what a system accepts: a subject and an
# acceptance verb, or a "<name>-safe" compound.
ACCEPTANCE_CLAIM = re.compile(
    r"(?<![\w'])([A-Za-z][A-Za-z0-9'\-]*(?: [A-Za-z][A-Za-z0-9'\-]*){0,2})[ ]+"
    r"(?:accepts?|allows?|permits?|supports?|requires?|rejects?)\b"
    r"|(?<![\w])([A-Za-z][A-Za-z0-9'\-]*)-safe\b"
)


def _is_a_name(word: str) -> bool:
    """Is this word a NAME rather than an ordinary word?

    A name is capitalised (``Redis``), all-caps (``TEI``), carries an
    internal capital (``vLLM``) or is a hyphenated compound
    (``okf-server``). An ordinary English word is none of those — which is
    what keeps "the datastore accepts" out of the findings: a datastore is
    a word, a system is a name.
    """

    return (
        word[:1].isupper()
        or word.isupper()
        or any(character.isupper() for character in word[1:])
        or "-" in word
        or "." in word
    )


def _foreign_claim_subjects(text: str) -> set[str]:
    """The foreign subjects the text claims an acceptance rule about.

    A word is a foreign subject when it is a NAME and is not one of the
    core's own concepts. The FIRST word of a multi-word subject is exempt:
    a sentence capitalises it for the sentence, not because it names a
    system ("The guard accepts ...").
    """

    subjects: set[str] = set()
    for match in ACCEPTANCE_CLAIM.finditer(text):
        subject = match.group(1) or match.group(2) or ""
        words = subject.split()
        if len(words) > 1:
            words = words[1:]
        for word in words:
            if word not in CORE_VOCABULARY and _is_a_name(word):
                subjects.add(word)
    return subjects


# The foreign subjects the core still claims about. A fix removes one
# finding and shrinks this list in the same commit; a NEW claim adds one and
# turns the test red.
KNOWN_FOREIGN_CLAIMS: set[tuple[str, str]] = set()


def _foreign_claim_findings() -> set[tuple[str, str]]:
    """The (module, subject) pairs that state a foreign system's rules."""

    findings: set[tuple[str, str]] = set()
    modules = _leaf_modules(_modules(_graph(SERVICE, with_libraries=False), SERVICE.name))
    for module in _in_layers(modules, DECIDING_LAYERS, SERVICE_LAYOUT):
        path = SERVICE / Path(*module.split(".")).with_suffix(".py")
        if not path.exists():
            continue
        text = _code_text(path, keep_docstrings=True)
        for subject in _foreign_claim_subjects(text):
            findings.add((module, subject))
    return findings


def test_the_core_states_no_foreign_acceptance_rule() -> None:
    """R6 — the core states no foreign system's acceptance rules (ADR agentic-009).

    The core's guard is a guard on a TOKEN: a safe shape and a length. What
    the corpus database accepts is the database's own rule, and the core
    that encodes it refuses the deployment's corpus leg by a rule the
    deployment never wrote — the same defect as the document-id guard (F1),
    one layer up: a refusal the operator cannot act on, on the channel that
    says the caller is not allowed.
    """

    assert _foreign_claim_findings() == KNOWN_FOREIGN_CLAIMS


def test_no_identifier_guard_encodes_a_platform_form() -> None:
    """R5 — a guard encodes no platform's FORM (ADR agentic-009).

    A guard's charset is the core's only knowledge of the shape an
    identifier has where it was minted. The document repository mints
    ``<timestamp>_<uuid-prefix>``; the ArangoDB ``_key`` is bare digits; a
    guard that requires either refuses every identifier of the other, and
    the refusal is an authorization failure — indistinguishable from a
    permission refusal, on every document, silently.

    The core's guard therefore accepts the GENERAL token shape and refuses
    the unsafe characters. What an identifier looks like where it was
    minted belongs to the platform that resolves it: it refuses what it
    does not know.

    The rule SWEEPS the guards the port declares: a guard added tomorrow
    with a platform's charset is caught here without anyone remembering to
    name it — the document-id leak was never one named guard's fault; it
    was a charset chosen once.
    """

    from capabilities import identifiers
    from capabilities.contract import OperationName

    guards = sorted(name for name in dir(identifiers) if name.startswith("validate_"))
    assert guards, "the identifiers port declares no guard: the sweep would prove nothing"

    general_tokens = ("a", "a-b_c", "1795706154681_2f1d1fc5", "12345", "X" * 60)
    for name in guards:
        guard = getattr(identifiers, name)
        for token in general_tokens:
            assert guard(token, operation=OperationName.READ_SOURCE) == token, (
                f"{name} refused a safe token: a guard that encodes a platform's form "
                "refuses the corpus the day the platform changes it"
            )


def test_leaf_adapters_access_only_the_ports(internal: EvaluableArchitecture) -> None:
    _accesses_only(SERVICE.name, "leaf adapters", ["ports"], LAYERS).assert_applies(internal)


def test_the_capability_accesses_only_ports(internal: EvaluableArchitecture) -> None:
    """L2 — the capability reaches the corpus through the ports only.

    The capability USED to build its own connectors: it imported the Arango
    retrieval adapter, the config that carries the knobs and the two TEI
    adapters, and assembled a connector per leg. The host injects the
    connector the capability drives now (ADR agentic-009, F2), so the rule
    tightens with the fix: the capability that DECIDES never imports the
    connector that REACHES.
    """

    _accesses_only(SERVICE.name, "capability", ["ports"], LAYERS).assert_applies(internal)


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
