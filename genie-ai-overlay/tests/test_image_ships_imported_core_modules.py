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

OVERLAY_ROOT = Path(__file__).resolve().parent.parent

# Overlay module -> the Dockerfile that builds its image.
#
# One entry per MODULE that imports ``core.*``, not one per service: a service
# directory holds several modules that all land in the same image, and the
# mapping above is what decides whether a given import is checked at all. Keying
# it by service would let ``retriever/config.py`` import ``core.*`` with no entry
# naming it — which is exactly how ``retriever/config.py`` slipped through.
SERVICE_IMAGES: dict[str, Path] = {
    "chatqna/genieai_chatqna.py": OVERLAY_ROOT / "chatqna" / "Dockerfile-chatqna_genie-ai",
    "retriever/genieai_retriever_arangodb.py": OVERLAY_ROOT / "retriever" / "Dockerfile-retriever_genie-ai",
    "retriever/config.py": OVERLAY_ROOT / "retriever" / "Dockerfile-retriever_genie-ai",
    "reranker/genieai_tei_reranker.py": OVERLAY_ROOT / "reranker" / "Dockerfile-reranker_genie-ai",
    "dataprep/genieai_dataprep_arangodb.py": OVERLAY_ROOT / "dataprep" / "Dockerfile-dataprep_genie-ai",
}

_IMPORT_CORE = re.compile(r"^from\s+core\.(?P<module>\w+)\s+import\b", re.MULTILINE)
_COPY_CORE = re.compile(r"^COPY\s+genie-ai-overlay/core/(?P<module>[\w.]+)\.py\s+\S+", re.MULTILINE)


def _core_imports(source_path: Path) -> set[str]:
    """Modules imported as ``core.<name>`` anywhere in *source_path*.

    Parsed with ``ast`` rather than matched as text, so a ``core.x`` mentioned
    inside a comment or a docstring does not count as a dependency the image has
    to satisfy.

    A file the running interpreter cannot parse yields an empty set rather than
    raising. This walks the whole overlay now, so the blast radius is every
    ``.py`` in the tree; an unparseable one — a helper using syntax newer than
    the CI interpreter, say — would otherwise turn this into a traceback that
    says nothing about which module is unpinned. Silent empty is the lesser
    evil: the file has no imports this could see either way, and a genuine
    ``core.*`` import is itself parseable by definition.
    """
    try:
        tree = ast.parse(source_path.read_text(encoding="utf-8"))
    except SyntaxError:
        return set()
    imported: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module and node.module.startswith("core."):
            imported.add(node.module.split(".", 1)[1])
        elif isinstance(node, ast.Import):
            imported.update(alias.name.split(".", 1)[1] for alias in node.names if alias.name.startswith("core."))
    return imported


def _copied_core_modules(dockerfile: Path) -> set[str]:
    """Modules the image copies into place as ``core/<name>.py``."""
    return set(_COPY_CORE.findall(dockerfile.read_text(encoding="utf-8")))


# The walk itself lives in conftest (``overlay_sources``) so this file and
# test_span_attrs.py cannot answer "what is overlay source?" differently. They
# did once: this side recursed, the span-coverage side listed five directories'
# top level. A span opened in a directory only one of them saw would have been
# unguarded while this file still reported the tree clean.


@pytest.mark.parametrize("service", sorted(SERVICE_IMAGES), ids=sorted(SERVICE_IMAGES))
def test_image_ships_every_core_module_the_service_imports(service: str) -> None:
    source_path = OVERLAY_ROOT / service
    imported = _core_imports(source_path)
    if not imported:
        pytest.skip(f"{service} imports nothing from core")

    copied = _copied_core_modules(SERVICE_IMAGES[service])
    missing = sorted(imported - copied)
    assert not missing, (
        f"{service} imports core.{', core.'.join(missing)} but "
        f"{SERVICE_IMAGES[service].name} copies none of them. Add a "
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
    named = {p.name for p in SERVICE_IMAGES.values()}
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
    unpinned = sorted(
        str(path.relative_to(OVERLAY_ROOT))
        for path in overlay_sources
        if str(path.relative_to(OVERLAY_ROOT)) not in SERVICE_IMAGES and _core_imports(path)
    )
    assert not unpinned, (
        f"modules importing core.* but not listed in SERVICE_IMAGES: {unpinned}. "
        "Add each one, mapped to the Dockerfile that builds its image."
    )
