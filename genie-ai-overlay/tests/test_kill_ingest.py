"""
I.1 pins — /v1/dataprep/kill_ingest honesty.

An orphaned id (not in the in-process task registry — e.g. after a container
restart) must raise a real HTTP 404 so doc-repo forwards the failure and the UI
shows it. A live task must still be cancelled and acknowledged. The previous
behavior (HTTP 200 with {"success": false}) made the UI toast a lying
"Kill request sent" while nothing happened.
"""

import asyncio

import pytest
from fastapi import HTTPException

import dataprep.genieai_dataprep_microservice as microservice


def test_kill_unknown_task_raises_404():
    """Orphaned file id → HTTPException 404, not a 200-with-false-body."""
    payload = microservice.DocRepoRetractPayload(fileId="no-such-task")

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(microservice.kill_ingest_task(payload))

    assert exc_info.value.status_code == 404
    assert "No active ingestion task" in exc_info.value.detail


def test_kill_live_task_cancels_and_acks():
    """A registered task is cancelled and acknowledged (existing behavior, pinned)."""
    started = asyncio.Event()

    async def slow_ingest():
        started.set()
        try:
            await asyncio.sleep(60)
        except asyncio.CancelledError:
            raise

    async def run():
        task = asyncio.create_task(slow_ingest())
        await started.wait()
        microservice.active_ingestion_tasks["live-task"] = task
        try:
            result = await microservice.kill_ingest_task(microservice.DocRepoRetractPayload(fileId="live-task"))
            with pytest.raises(asyncio.CancelledError):
                await asyncio.wait_for(task, timeout=5)
            return result
        finally:
            microservice.active_ingestion_tasks.pop("live-task", None)

    result = asyncio.run(run())
    assert result["success"] is True
    assert result["status"] == 200
