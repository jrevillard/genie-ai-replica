# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
"""Tests for the defensive vector-index ensure in dataprep (issue #1002)."""

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

import dataprep.genieai_dataprep_arangodb as dp_module
from dataprep.genieai_dataprep_arangodb import ensure_vector_index


def _make_collection(
    *,
    count: int = 100,
    sample_embedding: list | None = None,
    sample_embedding_is_invalid: bool = False,
    existing_indexes: list | None = None,
):
    """Build a MagicMock arango Collection pre-wired for the helper's probes."""
    coll = MagicMock()
    coll.count.return_value = count
    if sample_embedding_is_invalid:
        coll.random.return_value = {"embedding": "not-a-list"}
    elif sample_embedding is not None:
        coll.random.return_value = {"embedding": sample_embedding}
    else:
        coll.random.return_value = {"embedding": [0.1] * 1024}
    coll.indexes.return_value = existing_indexes or []
    coll.add_index = MagicMock()
    coll.delete_index = MagicMock()
    return coll


class TestEnsureVectorIndex:
    """Behaviour of the module-level `ensure_vector_index` helper."""

    @pytest.mark.asyncio
    async def test_missing_index_creates(self):
        coll = _make_collection(sample_embedding=[0.1] * 1024)
        write_log = AsyncMock()

        name = await ensure_vector_index(
            coll,
            metric="cosine",
            n_lists=1,
            graph_name="GRAPH",
            file_id="file-1",
            write_ingestion_log=write_log,
        )

        assert name == "vector_index"
        coll.add_index.assert_called_once()
        kwargs = coll.add_index.call_args.args[0]
        assert kwargs["name"] == "vector_index"
        assert kwargs["type"] == "vector"
        assert kwargs["fields"] == ["embedding"]
        assert kwargs["params"] == {"dimension": 1024, "metric": "cosine", "nLists": 1}
        coll.delete_index.assert_not_called()
        write_log.assert_called_once()
        assert "Created" in write_log.call_args.args[3]

    @pytest.mark.asyncio
    async def test_idempotent_no_op(self):
        existing = [
            {
                "name": "vector_index",
                "type": "vector",
                "fields": ["embedding"],
                "params": {"dimension": 1024, "metric": "cosine", "nLists": 1},
            }
        ]
        coll = _make_collection(sample_embedding=[0.1] * 1024, existing_indexes=existing)
        write_log = AsyncMock()

        name = await ensure_vector_index(
            coll,
            metric="cosine",
            n_lists=1,
            file_id="file-1",
            write_ingestion_log=write_log,
        )

        assert name == "vector_index"
        coll.add_index.assert_not_called()
        coll.delete_index.assert_not_called()
        write_log.assert_not_called()

    @pytest.mark.asyncio
    async def test_dim_staleness_recreates(self):
        existing = [
            {
                "name": "vector_index",
                "type": "vector",
                "fields": ["embedding"],
                "params": {"dimension": 768, "metric": "cosine", "nLists": 1},
            }
        ]
        coll = _make_collection(sample_embedding=[0.1] * 1024, existing_indexes=existing)
        write_log = AsyncMock()

        name = await ensure_vector_index(
            coll,
            metric="cosine",
            n_lists=1,
            file_id="file-1",
            write_ingestion_log=write_log,
        )

        assert name == "vector_index"
        coll.delete_index.assert_called_once_with("vector_index")
        coll.add_index.assert_called_once()
        assert coll.add_index.call_args.args[0]["params"]["dimension"] == 1024
        log_msg = write_log.call_args.args[3]
        assert "Recreated" in log_msg
        assert "768" in log_msg and "1024" in log_msg

    @pytest.mark.asyncio
    async def test_metric_drift_recreates(self):
        existing = [
            {
                "name": "vector_index",
                "type": "vector",
                "fields": ["embedding"],
                "params": {"dimension": 1024, "metric": "l2", "nLists": 1},
            }
        ]
        coll = _make_collection(sample_embedding=[0.1] * 1024, existing_indexes=existing)
        write_log = AsyncMock()

        await ensure_vector_index(
            coll,
            metric="cosine",
            n_lists=1,
            file_id="file-1",
            write_ingestion_log=write_log,
        )

        coll.delete_index.assert_called_once_with("vector_index")
        coll.add_index.assert_called_once()
        assert coll.add_index.call_args.args[0]["params"]["metric"] == "cosine"
        assert "metric/nLists drift" in write_log.call_args.args[3]

    @pytest.mark.asyncio
    async def test_n_lists_drift_recreates(self):
        existing = [
            {
                "name": "vector_index",
                "type": "vector",
                "fields": ["embedding"],
                "params": {"dimension": 1024, "metric": "cosine", "nLists": 1},
            }
        ]
        coll = _make_collection(sample_embedding=[0.1] * 1024, existing_indexes=existing)
        write_log = AsyncMock()

        await ensure_vector_index(
            coll,
            metric="cosine",
            n_lists=8,
            file_id="file-1",
            write_ingestion_log=write_log,
        )

        coll.delete_index.assert_called_once_with("vector_index")
        assert coll.add_index.call_args.args[0]["params"]["nLists"] == 8

    @pytest.mark.asyncio
    async def test_empty_collection_skips(self):
        coll = _make_collection(count=0)
        write_log = AsyncMock()

        result = await ensure_vector_index(
            coll,
            metric="cosine",
            n_lists=1,
            file_id="file-1",
            write_ingestion_log=write_log,
        )

        assert result is None
        coll.add_index.assert_not_called()
        coll.delete_index.assert_not_called()
        write_log.assert_called_once()
        assert "Empty" in write_log.call_args.args[3]

    @pytest.mark.asyncio
    async def test_embedding_not_list_skips(self):
        coll = _make_collection(sample_embedding_is_invalid=True)
        write_log = AsyncMock()

        result = await ensure_vector_index(
            coll,
            metric="cosine",
            n_lists=1,
            file_id="file-1",
            write_ingestion_log=write_log,
        )

        assert result is None
        coll.add_index.assert_not_called()
        write_log.assert_called_once()
        assert "lacks" in write_log.call_args.args[3]

    @pytest.mark.asyncio
    async def test_add_index_raises_silently(self):
        coll = _make_collection(sample_embedding=[0.1] * 1024)
        coll.add_index.side_effect = Exception("arango locked")
        write_log = AsyncMock()

        result = await ensure_vector_index(
            coll,
            metric="cosine",
            n_lists=1,
            file_id="file-1",
            write_ingestion_log=write_log,
        )

        assert result is None
        write_log.assert_called_once()
        msg = write_log.call_args.args[3]
        assert "ensure_vector_index failed" in msg
        assert "arango locked" in msg

    @pytest.mark.asyncio
    async def test_helper_is_module_level(self):
        """Sanity: the helper is importable as a module attribute (not nested)."""
        assert callable(dp_module.ensure_vector_index)
        assert dp_module.ensure_vector_index is ensure_vector_index

    @pytest.mark.asyncio
    async def test_metric_normalized_at_boundary(self):
        """Uppercase metric (e.g. 'COSINE') is normalized to 'cosine' before comparison."""
        coll = _make_collection(
            sample_embedding=[0.1] * 1024,
            existing_indexes=[
                {
                    "name": "vector_index",
                    "type": "vector",
                    "fields": ["embedding"],
                    "params": {"dimension": 1024, "metric": "cosine", "nLists": 1},
                }
            ],
        )
        write_log = AsyncMock()

        # Caller passes uppercase — helper must reconcile and treat as no-op.
        name = await ensure_vector_index(
            coll,
            metric="COSINE",
            n_lists=1,
            file_id="file-1",
            write_ingestion_log=write_log,
        )
        assert name == "vector_index"
        coll.add_index.assert_not_called()
        coll.delete_index.assert_not_called()


class TestReadIndexParams:
    """`_read_index_params` reads env vars defensively, never crashes ingest."""

    def test_defaults_when_env_unset(self, monkeypatch):
        monkeypatch.delenv("RETRIEVER_ARANGO_DISTANCE_STRATEGY", raising=False)
        monkeypatch.delenv("RETRIEVER_ARANGO_NUM_CENTROIDS", raising=False)
        metric, n_lists = dp_module._read_index_params()
        assert metric == "cosine"
        assert n_lists == 1

    def test_invalid_n_lists_falls_back(self, monkeypatch):
        monkeypatch.setenv("RETRIEVER_ARANGO_NUM_CENTROIDS", "abc")
        monkeypatch.setenv("RETRIEVER_ARANGO_DISTANCE_STRATEGY", "COSINE")
        metric, n_lists = dp_module._read_index_params()
        assert metric == "cosine"
        assert n_lists == 1  # fallback

    def test_valid_overrides(self, monkeypatch):
        monkeypatch.setenv("RETRIEVER_ARANGO_DISTANCE_STRATEGY", "L2")
        monkeypatch.setenv("RETRIEVER_ARANGO_NUM_CENTROIDS", "8")
        metric, n_lists = dp_module._read_index_params()
        assert metric == "l2"
        assert n_lists == 8


class TestSafeLog:
    """`_safe_log` must swallow exceptions so the post-ingest hook never crashes."""

    @pytest.mark.asyncio
    async def test_swallows_log_call_exception(self):
        """A backend HTTP timeout on `_write_ingestion_log` MUST NOT propagate."""
        from dataprep.genieai_dataprep_arangodb import _safe_log

        async def boom(*a, **kw):
            raise RuntimeError("backend timeout")

        # Must not raise even though the log call would.
        await _safe_log(boom, "file-1", "ERROR", "VectorIndex", "test message")

    @pytest.mark.asyncio
    async def test_returns_early_when_log_or_file_missing(self):
        from dataprep.genieai_dataprep_arangodb import _safe_log

        called = []

        async def tracker(*a, **kw):
            called.append(a)

        # No log callable — early return, no call.
        await _safe_log(None, "file-1", "ERROR", "X", "msg")
        assert called == []

        # No file_id — early return.
        await _safe_log(tracker, None, "ERROR", "X", "msg")
        assert called == []


class TestEnsureVectorIndexHook:
    """The post-ingest hook fires after gather, before _update_doc_status('Ingested')."""

    @pytest.mark.asyncio
    async def test_hook_fires_between_gather_and_status_update(self, monkeypatch):
        """The ensure_vector_index hook runs after gather and before Ingested."""
        dp = dp_module.GenieArangoDataprep.__new__(dp_module.GenieArangoDataprep)
        dp.db = MagicMock()
        dp._log_semaphore = asyncio.Semaphore(1)

        call_order = []

        async def fake_process_batch(self, *a, **kw):
            call_order.append("process_batch")
            return []

        async def fake_ensure_vector_index(*a, **kw):
            call_order.append("ensure_vector_index")

        async def fake_update_doc_status(self, file_id, status, **kw):
            call_order.append(f"update_doc_status_{status}")

        async def fake_load_and_chunk(self, *a, **kw):
            return [{"text": "hi"}]

        async def fake_run_guardrail(self, chunks):
            return {"success": True, "message": "ok"}

        async def fake_apply_contextualization(self, chunks, *a, **kw):
            return chunks

        async def fake_apply_labels(self, chunks, *a, **kw):
            return [{"text": c.get("text", ""), "labels": []} for c in chunks]

        async def fake_fetch_all_labels(self):
            return []

        async def fake_write_ingestion_log(self, *a, **kw):
            pass

        # Patch on the class so MRO resolution finds the recorder.
        monkeypatch.setattr(dp_module.GenieArangoDataprep, "_process_batch", fake_process_batch)
        monkeypatch.setattr(dp_module.GenieArangoDataprep, "_update_doc_status", fake_update_doc_status)
        monkeypatch.setattr(dp_module.GenieArangoDataprep, "_write_ingestion_log", fake_write_ingestion_log)
        monkeypatch.setattr(dp_module.GenieArangoDataprep, "_fetch_all_labels", fake_fetch_all_labels)
        monkeypatch.setattr(dp_module.GenieArangoDataprep, "_load_and_chunk", fake_load_and_chunk)
        monkeypatch.setattr(dp_module.GenieArangoDataprep, "_run_guardrail", fake_run_guardrail)
        monkeypatch.setattr(dp_module.GenieArangoDataprep, "_apply_contextualization", fake_apply_contextualization)
        monkeypatch.setattr(dp_module.GenieArangoDataprep, "_apply_labels", fake_apply_labels)
        # Module-level helper: patch on the module so the inline await routes here.
        monkeypatch.setattr(dp_module, "ensure_vector_index", fake_ensure_vector_index)

        from dataclasses import dataclass

        @dataclass
        class _Input:
            file_id: str = "file-hook-1"
            file_path: str = "/tmp/x.txt"
            storage_path: str = "/tmp/x.txt"
            chunk_size: int = 512
            chunk_overlap: int = 0
            process_table: bool = False
            table_strategy: str = "fast"
            graph_name: str = "GRAPH"
            allowed_node_types: list = None
            allowed_edge_types: list = None
            node_properties: list = None
            edge_properties: list = None
            file_labels: list = None

            def __post_init__(self):
                self.allowed_node_types = []
                self.allowed_edge_types = []
                self.node_properties = ["description"]
                self.edge_properties = ["description"]
                self.file_labels = []

        await dp.ingest_file_with_guardrail(_Input())

        assert "ensure_vector_index" in call_order, "ensure_vector_index must run"
        # Order is load-bearing: gather awaits all _process_batch before
        # ensure_vector_index; ensure_vector_index must complete before Ingested.
        assert call_order.index("ensure_vector_index") > call_order.index("process_batch")
        assert call_order.index("ensure_vector_index") < call_order.index("update_doc_status_Ingested")
