# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Tests for the bounded, observable LLM phase runner used by dataprep.

The failure this exists to prevent is a live one: a 260-chunk ingest issued 65
batched labeling calls against a contended GPU, and after 13 minutes none had
returned, none had failed, and no progress had been reported. A phase built on
``asyncio.gather`` reproduces that exactly — no wall-clock bound, and nothing
written until every task finishes.

These tests exercise the runner against a fake HTTP-shaped workload, so they
cover the three properties the ingest depends on: the phase finishes on time,
it reports while it runs, and it degrades rather than raising.
"""

import asyncio
import sys
from pathlib import Path

import pytest

OVERLAY_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(OVERLAY_ROOT))

# The dataprep module imports comps, which only exists inside the built image.
# tests/conftest.py pre-populates sys.modules with MagicMock stubs for it, and
# pytest.ini collects this directory alongside tests/, so the stubs are already
# in place by the time this module is imported.
import dataprep.genieai_dataprep_arangodb as dataprep  # noqa: E402


async def _noop_log(*_args, **_kwargs):
    return None


class _Recorder:
    """Stand-in for the dataprep instance's ingestion-log writer."""

    def __init__(self):
        self.entries: list[tuple] = []

    async def __call__(self, file_id, level, stage, message):
        self.entries.append((level, stage, message))


def _run(coro):
    return asyncio.run(coro)


class TestPhaseReturnsAllResults:
    def test_all_tasks_that_finish_are_returned(self, monkeypatch):
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 5.0)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)

        async def scenario():
            async def quick(n):
                await asyncio.sleep(0.01)
                return n

            return await dataprep._gather_with_phase_budget(
                [quick(i) for i in range(5)],
                phase="Labeling",
                total=5,
                file_id="f1",
                write_ingestion_log=_noop_log,
            )

        results, timed_out = _run(scenario())
        assert timed_out is False
        assert sorted(results) == [0, 1, 2, 3, 4]

    def test_empty_task_list_is_a_noop(self, monkeypatch):
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 5.0)

        async def scenario():
            return await dataprep._gather_with_phase_budget(
                [], phase="Labeling", total=0, file_id="f1", write_ingestion_log=_noop_log
            )

        assert _run(scenario()) == ([], False)


class TestPhaseIsBounded:
    """A phase that never completes must still return, on time, with partials."""

    def test_wedged_phase_returns_at_the_budget_instead_of_hanging(self, monkeypatch):
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 0.2)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)

        async def scenario():
            async def wedged():
                await asyncio.sleep(30)  # far beyond the budget
                return "never"

            started = asyncio.get_running_loop().time()
            results, timed_out = await dataprep._gather_with_phase_budget(
                [wedged(), wedged(), wedged()],
                phase="Labeling",
                total=3,
                file_id="f1",
                write_ingestion_log=_noop_log,
            )
            return results, timed_out, asyncio.get_running_loop().time() - started

        results, timed_out, elapsed = _run(scenario())
        assert timed_out is True, "a phase that outlived its budget must report the timeout"
        assert results == [], "no task finished, so no partial results"
        assert elapsed < 5.0, f"the phase overran its budget by {elapsed:.1f}s"

    def test_finished_work_survives_an_abandoned_phase(self, monkeypatch):
        """Results collected before the deadline are kept — they are complete.

        Each batch returns a full map for its own chunks, so a batch that
        finished contributes valid data. Discarding it would turn a partially
        recoverable document into a fully fallback one.
        """
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 0.3)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)

        async def scenario():
            async def fast(n):
                await asyncio.sleep(0.01)
                return {n: ["label"]}

            async def wedged():
                await asyncio.sleep(30)
                return None

            return await dataprep._gather_with_phase_budget(
                [fast(0), fast(1), wedged()],
                phase="Labeling",
                total=3,
                file_id="f1",
                write_ingestion_log=_noop_log,
            )

        results, timed_out = _run(scenario())
        assert timed_out is True
        assert sorted(r for partial in results for r in partial) == [0, 1]


class TestPhaseReportsProgress:
    def test_a_slow_phase_writes_progress_lines_while_it_runs(self, monkeypatch):
        """The heartbeat is the fix for "I cannot tell whether it is working".

        Without it a slow phase and a dead one look identical in the ingestion
        log — which is the channel the admin UI actually reads.
        """
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 10.0)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 0.05)

        async def scenario():
            recorder = _Recorder()

            async def slow(n):
                await asyncio.sleep(0.2)
                return n

            results, timed_out = await dataprep._gather_with_phase_budget(
                [slow(0), slow(1)],
                phase="Labeling",
                total=2,
                file_id="f1",
                write_ingestion_log=recorder,
            )
            return results, timed_out, recorder.entries

        results, timed_out, entries = _run(scenario())
        assert timed_out is False
        progress = [e for e in entries if e[0] == "INFO"]
        assert progress, "a phase running longer than the interval wrote no progress line"
        assert any("in progress" in e[2] and "elapsed" in e[2] for e in progress)

    def test_a_fast_phase_writes_no_progress_noise(self, monkeypatch):
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 10.0)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)

        async def scenario():
            recorder = _Recorder()

            async def quick(n):
                return n

            await dataprep._gather_with_phase_budget(
                [quick(i) for i in range(3)],
                phase="Labeling",
                total=3,
                file_id="f1",
                write_ingestion_log=recorder,
            )
            return recorder.entries

        entries = _run(scenario())
        assert [e for e in entries if e[0] == "INFO"] == []


class TestTimeoutIsVisible:
    def test_budget_exhaustion_writes_a_warning_naming_the_phase_and_counts(self, monkeypatch):
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 0.2)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)

        async def scenario():
            recorder = _Recorder()

            async def wedged():
                await asyncio.sleep(30)

            await dataprep._gather_with_phase_budget(
                [wedged(), wedged()],
                phase="Contextual Retrieval",
                total=2,
                file_id="f42",
                write_ingestion_log=recorder,
            )
            return recorder.entries

        entries = _run(scenario())
        warnings = [e for e in entries if e[0] == "WARN"]
        assert warnings, "a phase abandoned on budget wrote no WARN — it would be invisible to the operator"
        message = warnings[0][2]
        assert "Contextual Retrieval" in message, "the WARN must name the phase that was abandoned"
        assert "0/2 batches completed" in message and "2 abandoned" in message, (
            "the WARN must say how many batches were lost, or the operator cannot gauge the loss"
        )

    def test_a_failed_ingestion_log_write_does_not_break_the_phase(self, monkeypatch):
        """Log-visibility loss must never cost the ingest its data.

        Same rule the vector-index helper follows: a logging failure may drop
        the message, never propagate. Here the failure would otherwise abort a
        phase that has already decided which results to keep.
        """
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 0.2)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)

        async def scenario():
            async def broken_log(*_args, **_kwargs):
                raise RuntimeError("doc-repo is down")

            async def wedged():
                await asyncio.sleep(30)

            return await dataprep._gather_with_phase_budget(
                [wedged()],
                phase="Labeling",
                total=1,
                file_id="f1",
                write_ingestion_log=broken_log,
            )

        results, timed_out = _run(scenario())
        assert timed_out is True
        assert results == []


class TestFailedTaskPropagates:
    def test_a_raising_task_is_not_swallowed(self, monkeypatch):
        """One bad batch must surface, exactly as ``gather`` would.

        Swallowing it would turn a visible error into a silently degraded
        document: the caller would see a shorter result list and have no way
        to tell that a batch was lost.
        """
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 5.0)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)

        async def scenario():
            async def boom():
                raise RuntimeError("vLLM rejected the prompt")

            async def fine():
                return 1

            return await dataprep._gather_with_phase_budget(
                [fine(), boom()],
                phase="Labeling",
                total=2,
                file_id="f1",
                write_ingestion_log=_noop_log,
            )

        with pytest.raises(RuntimeError, match="vLLM rejected the prompt"):
            _run(scenario())