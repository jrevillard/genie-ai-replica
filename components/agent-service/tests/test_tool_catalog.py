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
from tool_catalog import MAX_CATALOG_ENTRIES, CatalogError, load_catalog

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
