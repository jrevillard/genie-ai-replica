# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Tests for the stuck-ingest startup recovery (#610).

A dataprep restart wipes the in-memory ``active_ingestion_tasks`` registry,
so every file the doc-repo still marks ``Ingesting`` is orphaned: the UI
disables the Ingest button and ``kill_ingest`` 404s. The recovery asks the
document repository to release those rows back to ``Pending`` once, on the
serving event loop, right after boot.
"""

import asyncio
import contextlib
from unittest.mock import AsyncMock, MagicMock, patch

import dataprep.genieai_dataprep_microservice as ms


def _mock_response(status=200, payload=None):
    """An aiohttp response mock shaped like the real async context chain."""
    mock_resp = MagicMock()
    mock_resp.status = status
    mock_resp.json = AsyncMock(return_value=payload if payload is not None else {})
    mock_resp.text = AsyncMock(return_value="body")
    mock_resp.__aenter__ = AsyncMock(return_value=mock_resp)
    mock_resp.__aexit__ = AsyncMock(return_value=False)
    return mock_resp


def _mock_session(status=200, payload=None):
    """A ClientSession mock whose post always answers the same response."""
    mock_session = MagicMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)
    mock_session.post.return_value = _mock_response(status, payload)
    return mock_session


def _recover_patches(session, **constants):
    """Patch the token + HTTP layer; ``constants`` override the retry knobs.

    ``_RECOVERY_RETRY_SECONDS`` defaults to 0 so a failing-path test does not
    sleep through the real 10 s backoff."""
    constants.setdefault("_RECOVERY_RETRY_SECONDS", 0)
    patches = {
        "token": patch.object(ms, "get_service_account_token", new_callable=AsyncMock, return_value="token"),
        "session": patch.object(ms.aiohttp, "ClientSession", return_value=session),
    }
    for name, value in constants.items():
        patches[name] = patch.object(ms, name, value)
    return patches


async def _recover_with_session(session, **constants):
    with contextlib.ExitStack() as stack:
        for p in _recover_patches(session, **constants).values():
            stack.enter_context(p)
        return await ms.recover_stuck_ingest_statuses()


class _StubApp:
    """Captures what the schedule hook registers; nothing ever runs."""

    def __init__(self):
        self.registered = []

    def add_startup_event(self, coro):
        self.registered.append(coro)
        return None


class TestRecoverStuckIngestStatuses:
    async def test_success_posts_to_doc_repo_and_returns_recovered_ids(self):
        session = _mock_session(200, {"success": True, "recovered": ["f-1", "f-2"], "count": 2})
        result = await _recover_with_session(session)

        assert result == ["f-1", "f-2"]
        url = session.post.call_args[0][0]
        assert url.endswith("/api/files/ingest/recover-stuck")
        headers = session.post.call_args[1]["headers"]
        assert headers["Authorization"] == "Bearer token"
        assert session.post.call_args[1]["json"] == {"excludeFileIds": []}

    async def test_no_stuck_files_returns_empty_list(self):
        session = _mock_session(200, {"success": True, "recovered": [], "count": 0})
        assert await _recover_with_session(session) == []

    async def test_live_tasks_are_excluded_from_the_release(self):
        """A kick accepted while the recovery was retrying is not an orphan:
        its id rides the request as excludeFileIds so a later attempt cannot
        flip an ingest that is actually running."""
        live = MagicMock(done=MagicMock(return_value=False))
        finished = MagicMock(done=MagicMock(return_value=True))
        ms.active_ingestion_tasks["live-1"] = live
        ms.active_ingestion_tasks["done-2"] = finished
        try:
            session = _mock_session(200, {"success": True, "recovered": [], "count": 0})
            await _recover_with_session(session)
        finally:
            ms.active_ingestion_tasks.clear()

        assert session.post.call_args[1]["json"] == {"excludeFileIds": ["live-1"]}

    async def test_server_error_is_retried_then_succeeds(self):
        session = MagicMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)
        session.post.side_effect = [
            _mock_response(503),
            _mock_response(200, {"success": True, "recovered": ["f-9"], "count": 1}),
        ]
        result = await _recover_with_session(session)

        assert result == ["f-9"]
        assert session.post.call_count == 2

    async def test_persistent_failure_gives_up_without_raising(self):
        session = _mock_session(500, {})
        with contextlib.ExitStack() as stack:
            for p in _recover_patches(session, _RECOVERY_MAX_ATTEMPTS=3).values():
                stack.enter_context(p)
            result = await ms.recover_stuck_ingest_statuses()
            # One session across the whole retry loop, not one per attempt.
            assert ms.aiohttp.ClientSession.call_count == 1

        assert result == []
        assert session.post.call_count == 3

    async def test_connection_error_is_retried_without_raising(self):
        session = _mock_session(500, {})
        session.post.side_effect = OSError("connection refused")
        result = await _recover_with_session(session, _RECOVERY_MAX_ATTEMPTS=2)

        assert result == []

    async def test_permanent_rejection_fails_fast(self):
        """A 4xx (rotated secret, lost role) can never succeed: retrying it
        30 times just delays the same misconfig being reported."""
        session = _mock_session(403, {})
        result = await _recover_with_session(session)

        assert result == []
        assert session.post.call_count == 1

    async def test_token_failure_gives_up_without_raising(self):
        session = _mock_session(200, {"success": True, "recovered": [], "count": 0})
        with (
            patch.object(ms, "get_service_account_token", new_callable=AsyncMock, side_effect=RuntimeError("kc down")),
            patch.object(ms.aiohttp, "ClientSession", return_value=session),
            patch.object(ms, "_RECOVERY_MAX_ATTEMPTS", 2),
            patch.object(ms, "_RECOVERY_RETRY_SECONDS", 0),
        ):
            result = await ms.recover_stuck_ingest_statuses()

        assert result == []
        session.post.assert_not_called()

    async def test_task_cancellation_is_not_swallowed(self):
        """The recovery runs as a task on the serving loop: a cancellation is
        the loop shutting down and must propagate, not be retried through."""
        session = _mock_session(200, {"success": True, "recovered": [], "count": 0})
        session.post.side_effect = asyncio.CancelledError()
        raised = False
        try:
            await _recover_with_session(session, _RECOVERY_MAX_ATTEMPTS=3)
        except asyncio.CancelledError:
            raised = True

        assert raised is True
        assert session.post.call_count == 1

    async def test_registers_itself_as_a_strong_referenced_task(self):
        """The recovery self-registers into _background_tasks (the scheduler
        — comps' startup hook — drops its own reference) and discards the
        entry when it completes. Runs as its OWN task here so current_task()
        inside is the recovery task, like production."""
        seen = {}

        async def _probe():
            seen["registered"] = asyncio.current_task() in ms._background_tasks
            # Drive the REAL success path: an AsyncMock side_effect returning
            # None would crash payload parsing and silently exercise the
            # give-up path instead.
            return {"success": True, "recovered": [], "count": 0}

        session = MagicMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)
        response = _mock_response(200, {"success": True, "recovered": [], "count": 0})
        response.json.side_effect = _probe
        session.post.return_value = response

        with contextlib.ExitStack() as stack:
            for p in _recover_patches(session).values():
                stack.enter_context(p)
            await asyncio.create_task(ms.recover_stuck_ingest_statuses())
        # done_callbacks run on the next loop tick after the task finishes.
        await asyncio.sleep(0)

        assert seen["registered"] is True
        assert ms._background_tasks == set()


class TestScheduleStuckIngestRecovery:
    async def test_registers_the_recovery_via_the_comps_startup_hook(self):
        app = _StubApp()
        with patch.object(ms, "recover_stuck_ingest_statuses", new_callable=AsyncMock) as mock_recover:
            result = ms.schedule_stuck_ingest_recovery(app)

        assert result is None
        assert len(app.registered) == 1
        mock_recover.assert_called_once()
        app.registered[0].close()  # avoid 'never awaited' warnings

    async def test_missing_startup_hook_is_a_warning_not_a_crash(self):
        with patch.object(ms, "recover_stuck_ingest_statuses", new_callable=AsyncMock):
            result = ms.schedule_stuck_ingest_recovery(object())

        assert result is None
