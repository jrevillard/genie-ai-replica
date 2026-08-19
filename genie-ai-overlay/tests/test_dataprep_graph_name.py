# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Story 2.9.6 (G5, pulled forward 2026-08-16): graph_name wiring.

Pins the three load-bearing links that make per-repo graphs real:
  1. the ingest payload accepts ``graphName`` and threads it into the loader
     request (falling back to ARANGO_GRAPH_NAME when absent);
  2. the retract payload accepts ``graphName`` and the fallback default is
     UNIFIED to ``GRAPH`` (was the divergent ``genie_graph`` — retracting from
     a graph nothing was ever ingested into = silent no-op);
  3. the loader lazily creates the 4 per-repo collections on first ingest.

Conventions follow test_dataprep_tracing.py (patch.object on the module's
``loader``; conftest pre-stubs the build-time comps/loader modules).
"""

import asyncio
import base64
import sys
import types
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# fcntl is Unix-only; stub it so the microservice imports on Windows dev boxes
# (in the container the real module is used; the flock path is not under test).
if "fcntl" not in sys.modules:
    try:
        import fcntl  # noqa: F401
    except ModuleNotFoundError:
        _fcntl = types.ModuleType("fcntl")
        _fcntl.flock = lambda *a, **kw: None
        _fcntl.LOCK_EX = 2
        _fcntl.LOCK_NB = 4
        _fcntl.LOCK_UN = 8
        sys.modules["fcntl"] = _fcntl

import dataprep.genieai_dataprep_microservice as micro  # noqa: E402
from dataprep.genieai_dataprep_arangodb import GenieArangoDataprep  # noqa: E402


def _b64(text: str) -> str:
    return base64.b64encode(text.encode()).decode()


@pytest.fixture()
def isolated_env(tmp_path, monkeypatch):
    """Point the microservice's filesystem globals at a temp dir."""
    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir()
    monkeypatch.setattr(micro, "upload_folder", str(upload_dir))
    monkeypatch.setattr(micro, "LOCK_FILE_PATH", str(tmp_path / "test.lock"))
    monkeypatch.delenv("ARANGO_GRAPH_NAME", raising=False)
    micro.active_ingestion_tasks.clear()


def _ingest_call(file_id="f-okf", graph=None, file_name="concept.md"):
    payload = micro.DocRepoIngestPayload(
        fileId=file_id,
        fileName=file_name,
        fileBase64=_b64("# concept"),
        fileType="md",
    )
    if graph is not None:
        payload = micro.DocRepoIngestPayload(
            fileId=file_id, fileName=file_name, fileBase64=_b64("# concept"), fileType="md", graphName=graph
        )
    return payload


class TestIngestGraphName:
    async def test_payload_accepts_graphname_default_none(self):
        payload = micro.DocRepoIngestPayload(fileId="f1", fileName="a.md", fileBase64=_b64("# x"), fileType="md")
        assert payload.graphName is None  # absent → legacy default-graph behavior

    async def test_graphname_threaded_into_loader_request(self, isolated_env):
        captured = {}

        def _capture_request(**kwargs):
            captured.update(kwargs)
            return SimpleNamespace(**kwargs)

        with (
            patch.object(micro, "loader") as mock_loader,
            patch.object(micro, "ArangoDBDataprepRequestFromDocRepo", side_effect=_capture_request),
        ):
            mock_loader.ingest_file_with_guardrail = AsyncMock(return_value={"status": 200, "success": True})
            await micro.ingest_file_from_repo(_ingest_call(graph="OKF_99999999-9999-4999-8999-999999999999"))
        assert captured["graph_name"] == "OKF_99999999-9999-4999-8999-999999999999"
        # the background task got the SAME graph (drain writes the per-repo graph)
        task = micro.active_ingestion_tasks.get("f-okf")
        assert task is not None
        await asyncio.wait_for(task, timeout=5)
        req_arg = mock_loader.ingest_file_with_guardrail.await_args.args[0]
        assert getattr(req_arg, "graph_name", None) == "OKF_99999999-9999-4999-8999-999999999999"

    async def test_absent_graphname_falls_back_to_env_default(self, isolated_env, monkeypatch):
        captured = {}

        def _capture_request(**kwargs):
            captured.update(kwargs)
            return MagicMock()

        monkeypatch.setenv("ARANGO_GRAPH_NAME", "GRAPH")
        with (
            patch.object(micro, "loader") as mock_loader,
            patch.object(micro, "ArangoDBDataprepRequestFromDocRepo", side_effect=_capture_request),
        ):
            mock_loader.ingest_file_with_guardrail = AsyncMock(return_value={"status": 200, "success": True})
            await micro.ingest_file_from_repo(_ingest_call(file_id="f-legacy"))
        assert captured["graph_name"] == "GRAPH"

    async def test_bundleversion_threads_into_the_loader_request(self, isolated_env):
        """Story 2.9.7 (ADR-031): the minted repo version rides the payload →
        request → chunk docs (version-pinned citation)."""
        captured = {}

        def _capture_request(**kwargs):
            captured.update(kwargs)
            return SimpleNamespace(**kwargs)

        with (
            patch.object(micro, "loader") as mock_loader,
            patch.object(micro, "ArangoDBDataprepRequestFromDocRepo", side_effect=_capture_request),
        ):
            mock_loader.ingest_file_with_guardrail = AsyncMock(return_value={"status": 200, "success": True})
            payload = micro.DocRepoIngestPayload(
                fileId="f-v3",
                fileName="concept.md",
                fileBase64=_b64("# concept"),
                fileType="md",
                graphName="OKF_99999999-9999-4999-8999-999999999999",
                bundleVersion=3,
            )
            await micro.ingest_file_from_repo(payload)
        assert captured["bundle_version"] == 3
        assert captured["graph_name"] == "OKF_99999999-9999-4999-8999-999999999999"

    async def test_conceptid_threads_into_the_loader_request(self, isolated_env):
        """Story 4.8-amend: content-only chunking — the concept id rides the
        payload → request → chunk docs (citation) + the completion callback."""
        captured = {}

        def _capture_request(**kwargs):
            captured.update(kwargs)
            return SimpleNamespace(**kwargs)

        with (
            patch.object(micro, "loader") as mock_loader,
            patch.object(micro, "ArangoDBDataprepRequestFromDocRepo", side_effect=_capture_request),
        ):
            mock_loader.ingest_file_with_guardrail = AsyncMock(return_value={"status": 200, "success": True})
            payload = micro.DocRepoIngestPayload(
                fileId="index",
                fileName="index.md",
                fileBase64=_b64("# KB"),
                fileType="text/markdown",
                graphName="OKF_99999999-9999-4999-8999-999999999999",
                conceptId="index",
            )
            await micro.ingest_file_from_repo(payload)
        assert captured["concept_id"] == "index"
        assert captured["graph_name"] == "OKF_99999999-9999-4999-8999-999999999999"

    async def test_bundleversion_defaults_none_legacy(self, isolated_env):
        captured = {}

        def _capture_request(**kwargs):
            captured.update(kwargs)
            return SimpleNamespace(**kwargs)

        with (
            patch.object(micro, "loader") as mock_loader,
            patch.object(micro, "ArangoDBDataprepRequestFromDocRepo", side_effect=_capture_request),
        ):
            mock_loader.ingest_file_with_guardrail = AsyncMock(return_value={"status": 200, "success": True})
            await micro.ingest_file_from_repo(_ingest_call(file_id="f-legacy"))
        assert captured["bundle_version"] is None


class TestRetractGraphName:
    async def test_graphname_from_payload_targets_the_files_graph(self, isolated_env):
        with patch.object(micro, "loader") as mock_loader:
            mock_loader.retract_file = AsyncMock(return_value={"status": 200})
            response = await micro.retract_file(
                micro.DocRepoRetractPayload(fileId="f-okf", graphName="OKF_99999999-9999-4999-8999-999999999999")
            )
        assert response["success"] is True
        mock_loader.retract_file.assert_awaited_once_with(
            file_id="f-okf", graph_name="OKF_99999999-9999-4999-8999-999999999999"
        )

    async def test_unified_fallback_default_is_graph_not_genie_graph(self, isolated_env):
        """G5 divergence fix: retract's fallback used 'genie_graph' while ingest
        used 'GRAPH' — retracts silently hit a graph nothing lived in."""
        with patch.object(micro, "loader") as mock_loader:
            mock_loader.retract_file = AsyncMock(return_value={"status": 200})
            await micro.retract_file(micro.DocRepoRetractPayload(fileId="f-legacy"))
        mock_loader.retract_file.assert_awaited_once_with(file_id="f-legacy", graph_name="GRAPH")

    async def test_env_override_respected_when_payload_silent(self, isolated_env, monkeypatch):
        monkeypatch.setenv("ARANGO_GRAPH_NAME", "CUSTOM_GRAPH")
        with patch.object(micro, "loader") as mock_loader:
            mock_loader.retract_file = AsyncMock(return_value={"status": 200})
            await micro.retract_file(micro.DocRepoRetractPayload(fileId="f-x"))
        mock_loader.retract_file.assert_awaited_once_with(file_id="f-x", graph_name="CUSTOM_GRAPH")


class TestEnsureGraphCollections:
    def _bare_loader(self, existing):
        instance = GenieArangoDataprep.__new__(GenieArangoDataprep)
        db = MagicMock()
        db.collections.return_value = [{"name": name} for name in existing]
        instance.db = db
        return instance, db

    def test_creates_the_four_collections_for_a_new_repo_graph(self):
        instance, db = self._bare_loader(["GRAPH_SOURCE", "GRAPH_ENTITY", "_graphs"])
        instance._ensure_graph_collections("OKF_repo1")
        created = {call.args[0]: call.kwargs for call in db.create_collection.call_args_list}
        assert set(created) == {
            "OKF_repo1_SOURCE",
            "OKF_repo1_ENTITY",
            "OKF_repo1_HAS_SOURCE",
            "OKF_repo1_LINKS_TO",
        }
        assert created["OKF_repo1_HAS_SOURCE"] == {"edge": True}
        assert created["OKF_repo1_LINKS_TO"] == {"edge": True}
        assert created["OKF_repo1_SOURCE"] == {"edge": False}
        assert created["OKF_repo1_ENTITY"] == {"edge": False}

    def test_noop_when_collections_exist(self):
        existing = [
            "GRAPH_SOURCE",
            "OKF_repo1_SOURCE",
            "OKF_repo1_ENTITY",
            "OKF_repo1_HAS_SOURCE",
            "OKF_repo1_LINKS_TO",
        ]
        instance, db = self._bare_loader(existing)
        instance._ensure_graph_collections("OKF_repo1")
        db.create_collection.assert_not_called()

    def test_default_graph_left_untouched(self):
        instance, db = self._bare_loader(["GRAPH_SOURCE", "GRAPH_ENTITY", "GRAPH_HAS_SOURCE", "GRAPH_LINKS_TO"])
        instance._ensure_graph_collections("GRAPH")
        db.create_collection.assert_not_called()

    def test_listing_failure_never_raises(self):
        instance = GenieArangoDataprep.__new__(GenieArangoDataprep)
        instance.db = MagicMock()
        instance.db.collections.side_effect = Exception("arango hiccup")
        instance._ensure_graph_collections("OKF_repo1")  # must not raise

    def test_registers_the_named_graph_for_a_new_repo(self):
        """Story 4.8-amend: the retriever's `has_graph` guard requires a named
        graph; register ENTITY -(_HAS_SOURCE)-> SOURCE + ENTITY -(_LINKS_TO)-> ENTITY."""
        instance, db = self._bare_loader(["GRAPH_SOURCE", "_graphs"])
        db.has_graph.return_value = False
        instance._ensure_graph_collections("OKF_repo1")
        db.create_graph.assert_called_once()
        name = db.create_graph.call_args.args[0]
        kwargs = db.create_graph.call_args.kwargs
        assert name == "OKF_repo1"
        edge_defs = kwargs["edge_definitions"]
        has_source = next(d for d in edge_defs if d["collection"] == "OKF_repo1_HAS_SOURCE")
        assert has_source["from"] == ["OKF_repo1_ENTITY"] and has_source["to"] == ["OKF_repo1_SOURCE"]
        links = next(d for d in edge_defs if d["collection"] == "OKF_repo1_LINKS_TO")
        assert links["from"] == ["OKF_repo1_ENTITY"] and links["to"] == ["OKF_repo1_ENTITY"]

    def test_skips_graph_registration_when_graph_exists(self):
        instance, db = self._bare_loader(
            ["OKF_repo1_SOURCE", "OKF_repo1_ENTITY", "OKF_repo1_HAS_SOURCE", "OKF_repo1_LINKS_TO"]
        )
        db.has_graph.return_value = True
        instance._ensure_graph_collections("OKF_repo1")
        db.create_graph.assert_not_called()
