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
    file: a duplicate exposed name (the model would see an ambiguity)
    and a file that is missing, unreadable or not the declared shape.

    EVERY per-entry defect costs the ENTRY, not the catalog: an
    undeclared source, a server-scoped tool, a required scope, a write,
    an approval, an open-web egress, and a budget that would WIDEN the
    ceiling — a loud startup ERROR names each and the tool is absent.
    The catalog still loads, and the deployment's other tools keep
    working.

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
