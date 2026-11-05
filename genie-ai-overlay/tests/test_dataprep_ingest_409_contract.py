# Copyright (c) 2024-2026 International Telecommunication Union (ITU)

"""The ingest idempotency guard's 409 response is a MACHINE-READABLE contract.

The document repository (and any other consumer of ``/v1/dataprep/ingest_file``)
classifies a 409 by the structured ``code`` field, not by parsing the prose
``detail``. These tests pin the producer side of that contract: a change to the
response shape must fail THIS suite, not the consumer's behaviour in production
(the #1251 failure mode — a reword silently turning the carve-out off and
marking live files ``Ingestion Error``).
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import dataprep.genieai_dataprep_microservice as ms

try:
    import fcntl  # POSIX file locking — the service runs in a Linux container
except ModuleNotFoundError:  # Windows dev checkout: locking degrades to a no-op
    fcntl = None  # type: ignore[assignment]

requires_fcntl = pytest.mark.skipif(fcntl is None, reason="POSIX fcntl is unavailable on this platform")


def _payload(file_id="test-file-123"):
    return ms.DocRepoIngestPayload(
        fileId=file_id,
        fileName="doc.md",
        fileType="text/markdown",
        fileBase64="dGVzdCBjb250ZW50",  # "test content"
    )


@pytest.fixture
def live_task():
    """A NOT-done ingestion task already registered for the payload's fileId."""
    task = MagicMock()
    task.done.return_value = False
    return task


@pytest.mark.asyncio
@requires_fcntl
async def test_409_body_carries_the_machine_readable_code(live_task):
    """The guard's 409 body MUST carry code='ingest_already_running' — consumers match on it."""
    payload = _payload()
    with (
        patch.object(ms, "active_ingestion_tasks", {payload.fileId: live_task}),
        patch.object(ms, "tracer"),
    ):
        response = await ms.ingest_file_from_repo(payload)
    assert response.status_code == 409
    body = json.loads(response.body)
    assert body["code"] == "ingest_already_running"


@pytest.mark.asyncio
@requires_fcntl
async def test_409_detail_names_the_file_and_stays_human_readable(live_task):
    """The prose detail survives (operators read it in logs) and names the exact fileId."""
    payload = _payload("my-file")
    with (
        patch.object(ms, "active_ingestion_tasks", {payload.fileId: live_task}),
        patch.object(ms, "tracer"),
    ):
        response = await ms.ingest_file_from_repo(payload)
    body = json.loads(response.body)
    assert "my-file" in body["detail"]
    assert "already" in body["detail"]


@pytest.mark.asyncio
@requires_fcntl
async def test_done_task_does_not_conflict():
    """A finished task must NOT trigger the guard — the ingest proceeds."""
    payload = _payload()
    done_task = MagicMock()
    done_task.done.return_value = True
    with (
        patch.object(ms, "active_ingestion_tasks", {payload.fileId: done_task}),
        patch.object(ms, "tracer"),
        patch.object(ms, "upload_folder", "/tmp/test-ingest"),
        patch("builtins.open", MagicMock()),
        patch("fcntl.flock"),
        patch.object(ms, "loader") as mock_loader,
    ):
        mock_loader.ingest_file_with_guardrail = AsyncMock()
        result = await ms.ingest_file_from_repo(payload)
    assert getattr(result, "status_code", 200) != 409
