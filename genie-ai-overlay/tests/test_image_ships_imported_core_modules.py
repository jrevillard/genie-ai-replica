# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""Every ``core.*`` module a service imports must be copied into its image.

The overlay services import shared modules by name (``from core.model_cache
import ...``) and each Dockerfile copies them into ``/app/core/`` one explicit
``COPY`` line at a time. Nothing derives those lines from the imports, so adding
an import without a matching ``COPY`` produces an image that fails at import
time — not a degraded run, no service at all.

Local test runs cannot see this: the repository root is on ``sys.path``, so
``core.foo`` resolves in the venv and never in the image. The in-image contract
jobs catch it for the services that have one; the list below is derived from the
sources so the whole set is covered, including the services with no contract
job.
"""

import ast
import re
from pathlib import Path

import pytest

from tests.conftest import OVERLAY_ROOT

# Overlay module -> the Dockerfile that builds its image.
#
# One entry per MODULE that imports ``core.*``, not one per service: a service
# directory holds several modules that all land in the same image, and the
# mapping above is what decides whether a given import is checked at all. Keying
# it by service would let ``retriever/config.py`` import ``core.*`` with no entry
# naming it — which is exactly how ``retriever/config.py`` slipped through.
SERVICE_IMAGES: dict[str, tuple[Path, ...]] = {
    "chatqna/genieai_chatqna.py": (OVERLAY_ROOT / "chatqna" / "Dockerfile-chatqna_genie-ai",),
    "retriever/genieai_retriever_arangodb.py": (OVERLAY_ROOT / "retriever" / "Dockerfile-retriever_genie-ai",),
    "retriever/config.py": (OVERLAY_ROOT / "retriever" / "Dockerfile-retriever_genie-ai",),
    "reranker/genieai_tei_reranker.py": (OVERLAY_ROOT / "reranker" / "Dockerfile-reranker_genie-ai",),
    "dataprep/genieai_dataprep_arangodb.py": (OVERLAY_ROOT / "dataprep" / "Dockerfile-dataprep_genie-ai",),
    "dataprep/genieai_dataprep_microservice.py": (OVERLAY_ROOT / "dataprep" / "Dockerfile-dataprep_genie-ai",),
    "dataprep/keycloak_service_account.py": (OVERLAY_ROOT / "dataprep" / "Dockerfile-dataprep_genie-ai",),
    # core/ is not one image. model_cache ships in all three services that talk
    # to a model endpoint, and it now imports core.model_http_policy, so a
    # single-image mapping would let two of those three build an image whose
    # import fails at startup — the exact failure this pin exists to catch, in
    # the two places a one-to-one key cannot name.
    "core/model_cache.py": (
        OVERLAY_ROOT / "chatqna" / "Dockerfile-chatqna_genie-ai",
        OVERLAY_ROOT / "retriever" / "Dockerfile-retriever_genie-ai",
        OVERLAY_ROOT / "dataprep" / "Dockerfile-dataprep_genie-ai",
    ),
}

_COPY_CORE = re.compile(r"^COPY\s+genie-ai-overlay/core/(?P<module>[\w.]+)\.py\s+\S+", re.MULTILINE)


def _core_imports(source_path: Path) -> set[str]:
    """Modules imported as ``core.<name>`` anywhere in *source_path*.

    Parsed with ``ast`` rather than matched as text, so a ``core.x`` mentioned
    inside a comment or a docstring does not count as a dependency the image has
    to satisfy.

    ``from core import span_attrs`` is recognised alongside the dotted forms.
    ``core/`` is a namespace package (no ``__init__.py``), so that spelling
    loads ``core/span_attrs.py`` — the same image dependency as
    ``from core.span_attrs import X``, written differently. A check matching
    only the dotted forms reports such a file clean.

    ``import core`` alone yields nothing, correctly: a namespace package has no
    ``__init__.py`` to copy, and every module it would give access to has to be
    reached by its own name anyway.

    A file the running interpreter cannot parse fails the walk rather than
    yielding an empty set. The empty set reads as "imports nothing from core",
    which is precisely the verdict that lets an unpinned module ship; a file the
    CI interpreter cannot read is not evidence about imports at all, so the walk
    must say so.
    """
    tree = ast.parse(source_path.read_text(encoding="utf-8"))
    imported: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            if node.module == "core":
                imported.update(alias.name for alias in node.names)
            elif node.module.startswith("core."):
                imported.add(node.module.split(".", 1)[1])
        elif isinstance(node, ast.Import):
            imported.update(alias.name.split(".", 1)[1] for alias in node.names if alias.name.startswith("core."))
    return imported


def _copied_core_modules(dockerfile: Path) -> set[str]:
    """Modules the image copies into place as ``core/<name>.py``."""
    return set(_COPY_CORE.findall(dockerfile.read_text(encoding="utf-8")))


# Both this file and test_span_attrs.py take OVERLAY_ROOT and the walk from
# conftest, so they cannot answer "what is overlay source?" differently. They
# did once: this side recursed, the span-coverage side listed five directories'
# top level. A span opened in a directory only one of them saw would have been
# unguarded while this file still reported the tree clean.


@pytest.mark.parametrize(
    ("service", "dockerfile"),
    [(svc, df) for svc in sorted(SERVICE_IMAGES) for df in SERVICE_IMAGES[svc]],
    ids=[f"{svc}->{df.name}" for svc in sorted(SERVICE_IMAGES) for df in SERVICE_IMAGES[svc]],
)
def test_image_ships_every_core_module_the_service_imports(service: str, dockerfile: Path) -> None:
    source_path = OVERLAY_ROOT / service
    imported = _core_imports(source_path)
    if not imported:
        pytest.skip(f"{service} imports nothing from core")

    copied = _copied_core_modules(dockerfile)
    missing = sorted(imported - copied)
    assert not missing, (
        f"{service} imports core.{', core.'.join(missing)} but "
        f"{dockerfile.name} copies none of them. Add a "
        f"'COPY genie-ai-overlay/core/<module>.py /app/core/<module>.py' line — "
        "the local suite cannot catch this, the image fails at import."
    )


def test_the_pin_covers_every_service_directory_with_a_dockerfile() -> None:
    """A new service must add itself here, or it ships unchecked.

    Deriving the list of services from the Dockerfiles on disk would be the
    alternative; it is not done because the mapping above is also the place a
    service's contract-job coverage is decided, and that is a judgement rather
    than a derivation.
    """
    present = {p.name for p in OVERLAY_ROOT.glob("*/Dockerfile-*")}
    named = {p.name for paths in SERVICE_IMAGES.values() for p in paths}
    assert named <= present, f"pinned Dockerfiles that do not exist: {sorted(named - present)}"

    services_with_core_imports = {service for service in SERVICE_IMAGES if _core_imports(OVERLAY_ROOT / service)}
    assert services_with_core_imports, "no pinned service imports from core — the pin is stale"


def test_no_overlay_module_imports_core_without_being_pinned(overlay_sources) -> None:
    """The gap that let ``retriever/config.py`` import ``core.*`` unchecked.

    ``SERVICE_IMAGES`` is a hand-maintained list, and a hand-maintained list only
    fails if someone remembers to add to it. ``retriever/config.py`` imports
    ``core.embedding_query_prefix`` and shipped for months with no entry naming
    it — the module whose Dockerfile was pinned passed every assertion while the
    import itself was never compared against a ``COPY`` line.

    So: walk the overlay, find every module importing ``core.*``, and require
    each one to appear in the pin. A new module that imports ``core.*`` now
    fails here by name rather than failing to fail at all.
    """
    # ``as_posix()``: the SERVICE_IMAGES keys are spelled with forward slashes
    # (they are image-relative paths, and the Dockerfile COPY lines use them),
    # while ``str(Path.relative_to(...))`` renders the OS separator — a
    # backslash on Windows, so every module would read as unpinned there.
    unpinned = sorted(
        path.relative_to(OVERLAY_ROOT).as_posix()
        for path in overlay_sources
        if path.relative_to(OVERLAY_ROOT).as_posix() not in SERVICE_IMAGES and _core_imports(path)
    )
    assert not unpinned, (
        f"modules importing core.* but not listed in SERVICE_IMAGES: {unpinned}. "
        "Add each one, mapped to the Dockerfile that builds its image."
    )


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("from core.span_attrs import QUERY_ID_KEY\n", {"span_attrs"}),
        ("import core.span_attrs\n", {"span_attrs"}),
        # The bare spelling of the same dependency. `core/` has no __init__.py,
        # so this loads core/span_attrs.py — a check matching only dotted forms
        # silently reports it clean.
        ("from core import span_attrs\n", {"span_attrs"}),
        ("from core import span_attrs, model_cache\n", {"span_attrs", "model_cache"}),
        # A namespace package has no __init__.py to copy; nothing to pin.
        ("import core\n", set()),
        # Mentions that are not imports.
        ('"""docs mention from core.span_attrs import X"""\n', set()),
        ("# from core.span_attrs import X\n", set()),
        ("from core_other import thing\n", set()),
        ("from tracing import with_span\n", set()),
    ],
    ids=lambda p: p.strip().replace("\n", "; ") if isinstance(p, str) else None,
)
def test_every_core_import_spelling_is_recognised(tmp_path: Path, source: str, expected: set[str]) -> None:
    """The extraction has to see every form the language allows.

    A form it misses reads as "this module imports nothing from core", which is
    the one verdict that lets a missing ``COPY`` line through — so each spelling
    is pinned here rather than left to be noticed the next time one is written.
    """
    probe = tmp_path / "probe.py"
    probe.write_text(source, encoding="utf-8")
    assert _core_imports(probe) == expected


def test_an_unparseable_module_is_not_reported_as_importing_nothing(tmp_path: Path) -> None:
    """The walk cannot judge a file it cannot read.

    Yielding an empty set here would report the module as free of ``core.*``
    imports, which is a clean bill of health for the exact case the guard exists
    to catch. Failing the walk keeps the answer visible instead.
    """
    probe = tmp_path / "broken.py"
    probe.write_text("def f(:\n", encoding="utf-8")
    with pytest.raises(SyntaxError):
        _core_imports(probe)
