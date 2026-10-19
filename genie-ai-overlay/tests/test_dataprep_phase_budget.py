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

import ast
import asyncio
import gc
import sys
import time
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
    """Stand-in for the dataprep instance's ingestion-log writer.

    ``yield_for`` makes the write take real wall-clock time, which is what the
    late-drain path depends on: awaiting a coroutine that never awaits anything
    gives the event loop no opportunity to run the batch the heartbeat is meant
    to catch, so a recorder without it silently turns those tests into tests of
    the main drain. Every entry is stamped so a test can assert the ordering
    (batch finished *after* the write started), which is the only evidence that
    the late path ran rather than the main one.
    """

    def __init__(self, yield_for: float = 0.0):
        self.entries: list[tuple] = []
        self.yield_for = yield_for

    async def __call__(self, file_id, level, stage, message):
        self.entries.append((level, stage, message, time.monotonic()))
        if self.yield_for:
            await asyncio.sleep(self.yield_for)


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
                phase_label=dataprep.PHASE_LABEL_LABELING,
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
                [],
                phase="Labeling",
                phase_label=dataprep.PHASE_LABEL_LABELING,
                total=0,
                file_id="f1",
                write_ingestion_log=_noop_log,
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
                phase_label=dataprep.PHASE_LABEL_LABELING,
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
                phase_label=dataprep.PHASE_LABEL_LABELING,
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
                phase_label=dataprep.PHASE_LABEL_LABELING,
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

    def test_an_interval_at_or_above_the_budget_still_reports_on_the_final_tick(self, monkeypatch):
        """Raising the interval to quiet a busy log must not silence the phase.

        The wait runs for min(interval, remaining_phase), so an interval at or
        above the budget means the phase ends on a single tick. A check placed
        after the budget break would skip that tick's report — the operator who
        raised the interval would get no progress line at all for the phase,
        which is the undiagnosable silence this reporting exists to remove.
        """
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 0.3)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)

        async def scenario():
            recorder = _Recorder()

            async def wedged():
                await asyncio.sleep(30)

            results, timed_out = await dataprep._gather_with_phase_budget(
                [wedged(), wedged()],
                phase="Labeling",
                phase_label=dataprep.PHASE_LABEL_LABELING,
                total=2,
                file_id="f1",
                write_ingestion_log=recorder,
            )
            return results, timed_out, recorder.entries

        results, timed_out, entries = _run(scenario())
        assert timed_out is True
        assert any(e[0] == "INFO" and "in progress" in e[2] for e in entries), (
            "an interval above the budget silenced the whole phase — the operator "
            "raised it to reduce noise, not to remove the heartbeat"
        )
        assert any(e[0] == "WARN" for e in entries), "the budget exhaustion itself must still be reported"

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
                phase_label=dataprep.PHASE_LABEL_LABELING,
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
                phase_label=dataprep.PHASE_LABEL_CONTEXTUAL,
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
                phase_label=dataprep.PHASE_LABEL_LABELING,
                total=1,
                file_id="f1",
                write_ingestion_log=broken_log,
            )

        results, timed_out = _run(scenario())
        assert timed_out is True
        assert results == []


class TestFailedTaskCleansUpAfterItself:
    """A raising batch must not strand its siblings.

    The failure this prevents: batch 3 raises while batches 4-20 are still
    waiting on the semaphore or mid-HTTP. Re-raising at the point the exception
    is noticed leaves those running — each holding a semaphore slot and an open
    connection until its own retry ladder finishes — so the fallback that was
    about to run for the failed batch cannot get a slot either. The phase would
    then be exactly as stuck as before the bound was added, with the added
    benefit that the operator was told the phase had a budget.
    """

    def test_siblings_are_cancelled_before_the_error_propagates(self, monkeypatch):
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 5.0)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)

        cancelled = []
        observed = []

        async def scenario():
            async def boom():
                await asyncio.sleep(0.01)
                raise RuntimeError("vLLM rejected the prompt")

            async def sibling():
                try:
                    await asyncio.sleep(30)
                except asyncio.CancelledError:
                    cancelled.append(1)
                    raise

            with pytest.raises(RuntimeError, match="vLLM rejected the prompt"):
                await dataprep._gather_with_phase_budget(
                    [boom(), sibling(), sibling()],
                    phase="Labeling",
                    phase_label=dataprep.PHASE_LABEL_LABELING,
                    total=3,
                    file_id="f1",
                    write_ingestion_log=_noop_log,
                )
            # Sampled INSIDE the loop, immediately after the phase raised.
            # asyncio.run's shutdown cancels whatever is still pending, so an
            # observation taken after it returns would see the stragglers
            # cancelled by the loop and pass with the phase's own cancel loop
            # deleted — which is the mutation this test exists to catch.
            observed.append(len(cancelled))

        _run(scenario())
        assert observed == [2], (
            "the in-flight siblings were left running after the phase raised: "
            f"saw {observed} cancelled inside the loop, expected 2"
        )

    def test_the_phase_deadline_is_reached_despite_a_failed_batch(self, monkeypatch):
        """The raise must not become a new way to hang.

        With the cleanup in place the error still propagates — but only after
        the stragglers are cancelled, so the phase cannot outlive its budget by
        waiting on tasks nobody is going to collect.
        """
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 5.0)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)
        # Pinned so the ceiling below tracks the helper's settle window instead
        # of the production constant, which is the same 5 s the assertion uses.
        monkeypatch.setattr(dataprep, "_PHASE_CANCEL_GRACE_SECONDS", 0.2)

        async def scenario():
            async def boom():
                await asyncio.sleep(0.01)
                raise RuntimeError("boom")

            async def wedged():
                # Swallows the cancellation. With a cancellable sleep the settle
                # window is invisible — asyncio.wait returns the instant the task
                # takes its cancel — so this test could not tell a bounded
                # settle from an unbounded one, which is the only thing it
                # asserts. This shape makes the window load-bearing: unbounded,
                # the phase sits here for 6 s and blows the 5 s ceiling.
                try:
                    await asyncio.sleep(30)
                except asyncio.CancelledError:
                    await asyncio.sleep(6.0)
                    raise

            loop = asyncio.get_running_loop()
            started = loop.time()
            with pytest.raises(RuntimeError):
                await dataprep._gather_with_phase_budget(
                    [boom(), wedged()],
                    phase="Labeling",
                    phase_label=dataprep.PHASE_LABEL_LABELING,
                    total=2,
                    file_id="f1",
                    write_ingestion_log=_noop_log,
                )
            return loop.time() - started

        elapsed = _run(scenario())
        assert elapsed < 5.0, f"the error path waited {elapsed:.1f}s on a cancelled sibling"


class TestProgressIntervalCannotBeSilenced:
    """The phase tuning knobs are read through the shared positive-float parser.

    A bare ``float(os.getenv(...))`` here would have two failure modes, both
    of which are what the parser is being pinned against:

    - a typo (``30m``) raises ``ValueError`` at import, taking the service down
      at startup over an optional knob;
    - a ``0`` or a negative is *accepted*, and a zero phase budget cancels every
      batch on the first tick — so every ingested document silently degrades to
      file labels with a warning reading "exceeded its -1s budget".

    The parser is exercised directly rather than through ``importlib.reload`` of
    the dataprep module: reloading it rebinds every function object in it, which
    breaks identity assertions in the neighbouring test modules.
    """

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("0", 60.0),
            ("-1", 60.0),
            ("-0.5", 60.0),
            ("30m", 60.0),
            ("", 60.0),
            ("60", 60.0),
            ("15.5", 15.5),
        ],
    )
    def test_parser_rejects_bad_interval_values(self, monkeypatch, raw, expected):
        from core.model_http_policy import positive_float_env

        monkeypatch.setenv("DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", raw)
        assert positive_float_env("DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", default=60.0) == expected

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("-1", 600.0),
            ("0", 600.0),
            ("not-a-number", 600.0),
            ("900", 900.0),
        ],
    )
    def test_parser_rejects_bad_phase_budget_values(self, monkeypatch, raw, expected):
        from core.model_http_policy import positive_float_env

        monkeypatch.setenv("DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", raw)
        assert positive_float_env("DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", default=600.0) == expected

    def test_dataprep_uses_the_shared_parser(self):
        """Each knob routes through it, by call shape rather than by substring.

        ``"positive_float_env" in source`` is satisfied by the import line alone:
        swap every call site for a local helper and the assertion still reads
        green while the validation the parser exists to provide is gone. Parsed
        instead, so a call is only credited to the real parser.
        """
        source = (OVERLAY_ROOT / "dataprep" / "genieai_dataprep_arangodb.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        from_shared = set()
        from_getenv = set()
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            first = node.args[0] if node.args and isinstance(node.args[0], ast.Constant) else None
            env_name = first.value if first is not None and isinstance(first.value, str) else None
            if not env_name or not env_name.startswith("DATAPREP_LLM_"):
                continue
            func = node.func
            called = func.id if isinstance(func, ast.Name) else getattr(func, "attr", "")
            if called == "positive_float_env":
                from_shared.add(env_name)
            elif called in {"float", "int"}:
                from_getenv.add(env_name)

        knobs = {"DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS"}
        assert knobs <= from_shared, (
            "these knobs no longer route through positive_float_env — a local "
            f"float(os.getenv(...)) reintroduces the startup crash and the accepted-zero budget: "
            f"{sorted(knobs - from_shared)}"
        )
        assert not (knobs & from_getenv), f"a knob is parsed straight from the env again: {sorted(knobs & from_getenv)}"


class TestPhaseBudgetIsSizedAgainstOneBatchTask:
    """The phase bound must fire long before one batch task can finish.

    The unit the phase cancels is the batch coroutine, not an HTTP call, and that
    coroutine holds its semaphore slot across the batched call *and* the
    per-chunk fallback it performs itself. The two ladders compose, so sizing
    the budget against either one alone leaves the other unbounded:

        one batched call   (1 + LLM_MAX_RETRIES) x LLM_TIMEOUT_SECONDS
        one per-chunk call 3 x the above
        one batch task     one batched call + LABEL_LLM_BATCH_SIZE x per-chunk

    Both ends matter. Above the batched call, a merely slow batch finishes
    instead of being cut mid-call. Below the composed batch task, the phase
    fires while a straggler is still inside its own ladder — which is the only
    thing that can stop it, since no per-request budget reaches that far.
    """

    @staticmethod
    def _ladder(*, batch_size):
        """The ladder arithmetic, read from the LIVE module constants.

        Nothing here is monkeypatched. An earlier version pinned all three
        inputs and then asserted relationships between the numbers the test
        itself supplied, which passes whatever the production defaults are:
        restoring LLM_TIMEOUT_SECONDS to the openai SDK's 600 leaves the whole
        class green while a single batched call grows to 1800 s and starts
        being cancelled mid-call. Only *batch_size* is injected, because that
        is the one input no module constant carries.
        """
        one_call = (1 + dataprep.LLM_MAX_RETRIES) * dataprep.LLM_TIMEOUT_SECONDS
        per_chunk = 3 * one_call
        return {
            "budget": dataprep.DATAPREP_LLM_PHASE_TIMEOUT_SECONDS,
            "one_call": one_call,
            "per_chunk": per_chunk,
            "batch_task": one_call + batch_size * per_chunk,
        }

    def test_budget_is_above_a_single_batched_call(self):
        """A slow-but-eventually-answering batch is not cut mid-call."""
        ladder = self._ladder(batch_size=dataprep.LABEL_LLM_BATCH_SIZE)
        assert ladder["budget"] > ladder["one_call"], (
            f"phase budget {ladder['budget']:.0f}s does not exceed the "
            f"{ladder['one_call']:.0f}s one batched call can occupy — a call that would have "
            "succeeded is abandoned mid-flight instead of completing"
        )

    def test_budget_is_below_the_per_chunk_ladder(self):
        """The per-chunk ladder must not outlast the phase that stops it."""
        ladder = self._ladder(batch_size=dataprep.LABEL_LLM_BATCH_SIZE)
        assert ladder["budget"] < ladder["per_chunk"], (
            f"phase budget {ladder['budget']:.0f}s is not below the "
            f"{ladder['per_chunk']:.0f}s a per-chunk call can occupy — the phase would wait for "
            "the call's own retry ladder instead of stopping it"
        )

    @pytest.mark.parametrize("batch_size", [1, 2, 4, 8])
    def test_budget_fires_before_a_single_batch_task_could_finish(self, batch_size):
        """The invariant the phase bound actually rests on.

        Sizes the budget against the composed task, not against one call inside
        it. The per-chunk fallback runs in the same coroutine that holds the
        semaphore, so a batch whose batched call fails and then runs every chunk
        individually occupies the batched call plus one per-chunk ladder per
        chunk — and no per-request budget reaches that far, which is the reason
        the phase bound is not redundant with LLM_TIMEOUT_SECONDS.
        """
        ladder = self._ladder(batch_size=batch_size)
        assert ladder["budget"] < ladder["batch_task"], (
            f"phase budget {ladder['budget']:.0f}s is not below the {ladder['batch_task']:.0f}s "
            f"one batch task (batch size {batch_size}) can occupy — nothing else bounds the "
            "fallback the batch coroutine performs internally"
        )

    def test_the_default_budget_is_a_small_fraction_of_one_batch_task(self):
        """The margin has to be large, not merely positive.

        A budget one second under the worst case still leaves the document
        waiting on a straggler for the whole ladder; the point of the bound is
        that it lands while the fallback is still cheap, so the composed task
        must be several times the budget.
        """
        budget = dataprep.DATAPREP_LLM_PHASE_TIMEOUT_SECONDS
        one_call = (1 + dataprep.LLM_MAX_RETRIES) * dataprep.LLM_TIMEOUT_SECONDS
        per_chunk = 3 * one_call
        batch_task = one_call + dataprep.LABEL_LLM_BATCH_SIZE * per_chunk
        assert batch_task >= 5 * budget, (
            f"one batch task ({batch_task:.0f}s) is under 5x the {budget:.0f}s budget — the bound "
            "would land at the very end of the ladder rather than well before it"
        )


class TestPhaseBoundIsAHardWall:
    """The phase bound must bound the phase, including its own cleanup.

    The bound is only real if the caller gets its fallback back on time. Two
    ways it did not: an unbounded gather while settling cancellations (a task in
    a non-cancellable await never finishes, so the settle never returns), and
    result-collection that depended on which set iteration order it got.
    """

    def test_a_task_that_ignores_cancellation_does_not_hold_the_phase(self, monkeypatch):
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 0.3)
        monkeypatch.setattr(dataprep, "_PHASE_CANCEL_GRACE_SECONDS", 0.2)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)

        async def scenario():
            async def stuck():
                # Swallows the cancellation the way a client offloading to a
                # thread or catching broadly around its HTTP call does.
                try:
                    await asyncio.sleep(30)
                except asyncio.CancelledError:
                    await asyncio.sleep(30)
                    return None

            loop = asyncio.get_running_loop()
            started = loop.time()
            results, timed_out = await dataprep._gather_with_phase_budget(
                [stuck(), stuck()],
                phase="Labeling",
                phase_label=dataprep.PHASE_LABEL_LABELING,
                total=2,
                file_id="f1",
                write_ingestion_log=_noop_log,
            )
            return results, timed_out, loop.time() - started

        results, timed_out, elapsed = _run(scenario())
        assert timed_out is True
        assert elapsed < 3.0, (
            f"the phase spent {elapsed:.1f}s waiting on tasks that ignore "
            "cancellation — the bound is only as real as its own cleanup"
        )

    def test_work_that_finishes_during_a_heartbeat_is_kept(self, monkeypatch):
        """A completed batch is a completed batch, whoever noticed it.

        The heartbeat awaits an ingestion-log round trip, which yields the event
        loop. A batch answering during that window holds a full result; dropping
        it would report work as lost that the model actually did, and send the
        operator looking at GPU contention instead of at the budget.
        """
        # The budget expires INSIDE the heartbeat write, so the phase breaks out
        # of the loop the moment the write returns and the main drain never gets
        # another turn. Without that, deleting the late drain still passes: the
        # batch is simply picked up by the main drain one iteration later.
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 0.08)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 0.05)

        async def scenario():
            # The heartbeat's first tick lands at ~0.05 s; the write then holds
            # the loop for 0.15 s, so the batch below completes strictly inside
            # that window and strictly after the write started.
            recorder = _Recorder(yield_for=0.15)
            late = []
            finished_at = {}

            async def answers_during_the_log_write():
                await asyncio.sleep(0.06)
                finished_at["batch"] = time.monotonic()
                return {0: ["label"]}

            async def wedged():
                await asyncio.sleep(30)

            results, timed_out = await dataprep._gather_with_phase_budget(
                [answers_during_the_log_write(), wedged()],
                phase="Labeling",
                phase_label=dataprep.PHASE_LABEL_LABELING,
                total=2,
                file_id="f1",
                write_ingestion_log=recorder,
            )
            late.extend(recorder.entries)
            return results, timed_out, late, finished_at

        results, timed_out, entries, finished_at = _run(scenario())
        assert timed_out is True
        assert [r for partial in results for r in partial], (
            "a batch that completed during the heartbeat was discarded — its chunks "
            "fell to the file-label fallback even though the LLM answered"
        )
        warned = [e for e in entries if e[0] == "WARN"]
        assert warned, "the budget exhaustion must still be reported"
        assert "1/2 batches completed" in warned[0][2], (
            "the WARN must count the batch that finished during the heartbeat write. Reporting "
            "0/2 is the signature of the late drain being gone: the work was done, the phase "
            "had no time left to notice, and the batch fell to the file-label fallback anyway"
        )
        # The evidence that this is the LATE path and not the main drain: the
        # batch finished after a heartbeat write had already started, so the
        # main drain could not have collected it. Without this assertion the
        # test passes even if the late drain is deleted outright.
        progress_writes = [e for e in entries if "in progress" in e[2]]
        assert progress_writes, "no heartbeat was written — the scenario never reached the branch"
        assert finished_at["batch"] > progress_writes[0][3], (
            "the batch finished before the heartbeat write started, so the main drain collected "
            "it and this test is not exercising the late path it is named for"
        )

    def test_the_reported_failure_is_deterministic_across_runs(self, monkeypatch):
        """Which failing batch aborts the ingest must not change run to run.

        asyncio.wait returns a set, so the implementation indexes every task at
        submission and sorts by that index: iterating the returned set would
        make the choice depend on hash ordering, and two batches failing
        differently could abort the document on one run and degrade it on the
        next.
        """
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 5.0)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)

        async def scenario():
            async def aborting():
                raise ValueError("first batch aborts")

            async def transient():
                raise RuntimeError("second batch fails transiently")

            return await dataprep._gather_with_phase_budget(
                [aborting(), transient(), aborting(), transient(), aborting(), transient()],
                phase="Labeling",
                phase_label=dataprep.PHASE_LABEL_LABELING,
                total=6,
                file_id="f1",
                write_ingestion_log=_noop_log,
            )

        seen = set()
        for _ in range(12):
            with pytest.raises(Exception) as exc:
                _run(scenario())
            seen.add(type(exc.value).__name__ + ":" + str(exc.value))
        assert len(seen) == 1, f"the surfaced failure is not deterministic: {seen}"


class TestFailureSeenDuringAHeartbeatEndsThePhase:
    """A failure noticed during the log write must end the phase immediately.

    The late drain that recovers work completed during the heartbeat can set
    ``failure``, and it has to break the loop at that point for the same reason
    the main drain does: without the break the siblings would keep their
    semaphore slots for a whole progress interval before the finally cancelled
    them, which is the delay this whole mechanism exists to prevent.
    """

    def test_every_batch_settling_at_once_exits_the_heartbeat_cleanly(self, monkeypatch):
        """The success path must return, not loop into an empty ``asyncio.wait``.

        ``asyncio.wait`` raises ``ValueError: Set of Tasks/Futures is empty``
        rather than returning, so any loop that re-enters its wait with nothing
        pending dies with that instead of a result. The four other tests on this
        helper all end on an exception — a failure or a cancellation — which
        raises out of the loop before the next iteration, so they cannot see it.

        This one drives the phase to a normal completion, where the last
        ``asyncio.wait`` drains every task and the loop condition is all that
        stands between the helper and one more empty wait.
        """
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 5.0)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)

        async def scenario():
            async def batch(i):
                # Same wake-up tick for every task, so the first wait drains all
                # of them in one go rather than one per iteration.
                await asyncio.sleep(0.01)
                return i

            await dataprep._await_with_heartbeat(
                [asyncio.ensure_future(batch(i)) for i in range(3)],
                phase="Graph insertion",
                total=3,
                file_id="f1",
                write_ingestion_log=_noop_log,
            )

        _run(scenario())

    def test_a_lone_failing_batch_surfaces_its_own_error(self, monkeypatch):
        """One failing task, no siblings: the real error must reach the caller.

        A document with fewer chunks than BATCH_SIZE produces exactly one
        graph-insertion task, so the failure path runs with ``pending`` empty.
        The protection is the loop's own ``while pending:`` condition, which
        exits before the empty-set wait; without it the ingest log and the
        document status reported "Set of Tasks/Futures is empty" and the
        ArangoDB error underneath it was never surfaced anywhere.
        """
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 5.0)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)

        async def scenario():
            async def only_batch():
                raise RuntimeError("ArangoDB insert failed")

            # create_task, matching the production call site: the helper reads
            # .done()/.exception(), so it needs Tasks and not bare coroutines.
            await dataprep._await_with_heartbeat(
                [asyncio.ensure_future(only_batch())],
                phase="Graph insertion",
                total=1,
                file_id="f1",
                write_ingestion_log=_noop_log,
            )

        with pytest.raises(RuntimeError, match="ArangoDB insert failed"):
            _run(scenario())

    def test_a_failure_during_the_heartbeat_does_not_wait_out_the_interval(self, monkeypatch):
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 30.0)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 0.05)
        # Pinned so the ceiling below tracks the helper's own settle window
        # instead of the production constant. Left at its real 5 s, the test
        # asserts against a number the code could double without failing, and a
        # future raise to 30 s would turn this into a 30-second test.
        monkeypatch.setattr(dataprep, "_PHASE_CANCEL_GRACE_SECONDS", 0.2)

        async def scenario():
            async def boom():
                # Lands inside the heartbeat's ingestion-log await.
                await asyncio.sleep(0.06)
                raise RuntimeError("vLLM rejected the prompt")

            async def sibling():
                # Swallows the cancellation instead of returning on it. With a
                # plain cancellable sleep the settle window is invisible here —
                # asyncio.wait returns the moment the task takes its cancel —
                # so this test could not tell a bounded settle from an unbounded
                # one, while its assertion and the comment below both claim
                # otherwise. This shape makes the window load-bearing: remove
                # the timeout from _settle_and_retrieve and the phase sits here
                # for 30 s.
                try:
                    await asyncio.sleep(30)
                except asyncio.CancelledError:
                    # Unwinds for LONGER than this test's 2 s ceiling, and
                    # longer than the 0.2 s settle window: bounded, the phase
                    # gives up and returns; unbounded, it sits here and fails.
                    await asyncio.sleep(3.0)
                    raise

            loop = asyncio.get_running_loop()
            started = loop.time()
            with pytest.raises(RuntimeError, match="vLLM rejected the prompt"):
                await dataprep._gather_with_phase_budget(
                    [sibling(), boom(), sibling()],
                    phase="Labeling",
                    phase_label=dataprep.PHASE_LABEL_LABELING,
                    total=3,
                    file_id="f1",
                    write_ingestion_log=_noop_log,
                )
            return loop.time() - started

        elapsed = _run(scenario())
        assert elapsed < 2.0, (
            f"the phase sat {elapsed:.1f}s after a failure seen during the heartbeat — "
            "the siblings kept their slots for a whole progress interval instead of the "
            "0.2s settle this test pins"
        )


class TestThePhaseSpanSurvivesAnInterruptedPhase:
    """The phase span must identify itself on the paths where the phase dies.

    Both the constants and `timed_out` were originally set after the inner call,
    which raises on a failed batch and on an external cancel. A kill is a
    routine path, not an edge case — so on exactly the traces an operator opens
    to find out which phase was interrupted, the span carried nothing but the
    exception. That is the same "the instrumentation is not there" conclusion
    this MR removed for `context_batch`.
    """

    def _recording_span(self, monkeypatch, opened):
        class _Span:
            def __init__(self):
                self.attributes = {}

            def set_attribute(self, key, value):
                self.attributes[key] = value

        class _CM:
            def __init__(self, span):
                self._span = span

            def __enter__(self):
                return self._span

            def __exit__(self, *exc):
                opened.append(self._span.attributes)
                return False

        def _fake(name, attributes=None):
            span = _Span()
            span.attributes.update(attributes or {})
            return _CM(span)

        monkeypatch.setattr(dataprep, "background_span", _fake)

    def test_an_externally_cancelled_phase_still_names_itself(self, monkeypatch):
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 5.0)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)
        opened = []
        self._recording_span(monkeypatch, opened)

        async def scenario():
            async def wedged():
                await asyncio.sleep(30)

            phase = asyncio.ensure_future(
                dataprep._gather_with_phase_budget(
                    [asyncio.ensure_future(wedged())],
                    phase="LLM labeling",
                    phase_label=dataprep.PHASE_LABEL_LABELING,
                    total=1,
                    file_id="f1",
                    write_ingestion_log=_noop_log,
                )
            )
            await asyncio.sleep(0.05)
            phase.cancel()
            with pytest.raises(asyncio.CancelledError):
                await phase

        _run(scenario())

        assert opened, "no phase span was recorded at all"
        attrs = opened[-1]
        assert attrs.get("dataprep.llm.phase") == dataprep.PHASE_LABEL_LABELING, attrs
        assert attrs.get("dataprep.llm.timeout_seconds") == 5.0, attrs
        # Explicit False, not an absence: "did not time out" and "we never found
        # out" must not read the same in a trace query.
        assert attrs.get("dataprep.llm.timed_out") is False, attrs

    def test_a_failed_batch_still_names_the_phase(self, monkeypatch):
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 5.0)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)
        opened = []
        self._recording_span(monkeypatch, opened)

        async def scenario():
            async def boom():
                raise RuntimeError("vLLM rejected the prompt")

            with pytest.raises(RuntimeError, match="vLLM rejected the prompt"):
                await dataprep._gather_with_phase_budget(
                    [asyncio.ensure_future(boom())],
                    phase="LLM labeling",
                    phase_label=dataprep.PHASE_LABEL_LABELING,
                    total=1,
                    file_id="f1",
                    write_ingestion_log=_noop_log,
                )

        _run(scenario())

        assert opened, "no phase span was recorded at all"
        attrs = opened[-1]
        assert attrs.get("dataprep.llm.phase") == dataprep.PHASE_LABEL_LABELING, attrs
        assert attrs.get("dataprep.llm.timeout_seconds") == 5.0, attrs


class TestThePhaseCeilingMustOutliveTheRetryLadder:
    """The ceiling is only a bound if it sits above one call's worst case.

    Both knobs the policy docstring tells an operator to turn walk through that:
    ``MODEL_LLM_TIMEOUT_SECONDS=300`` on a slower model needs 900 s, and a third
    retry needs 720 s. Neither is a crash — labelling just degrades to per-chunk
    and then to file labels, which reads as a labelling-quality regression and
    sends the investigation to the prompt rather than to the configuration.
    """

    @pytest.mark.parametrize(
        ("retries", "per_call", "phase", "ceiling_ok"),
        [
            (2, 180.0, 600.0, True),  # the shipped defaults: 540 worst case
            (2, 180.0, 540.0, False),  # exactly equal is not "above"
            (2, 300.0, 600.0, False),  # a slower model under the default ceiling
            (3, 180.0, 600.0, False),  # one more retry than the defaults
            (0, 180.0, 600.0, True),  # retries disabled, plenty of room
            (5, 180.0, 1081.0, True),  # ceiling raised to match
        ],
    )
    def test_the_warning_fires_exactly_when_the_ceiling_is_too_low(self, retries, per_call, phase, ceiling_ok):
        warned = dataprep._warn_if_phase_ceiling_too_low(phase, retries, per_call)
        worst = dataprep._one_batched_call_worst_case(retries, per_call)
        assert (phase > worst) is ceiling_ok, (
            f"the case table disagrees with the code: ceiling {phase}s vs worst case {worst}s"
        )
        assert warned is not ceiling_ok, (
            f"warned={warned} for ceiling {phase}s vs worst case {worst}s "
            f"({retries} retries at {per_call}s), expected warned={not ceiling_ok}"
        )

    def test_the_check_is_applied_to_this_deployment_at_import(self):
        """The function can exist and still never be called.

        The values are fixed at import, so the only case the suite above reaches
        is one the shipped defaults never take — the check has to actually run
        against the module's own constants for it to protect a real deployment.
        """
        source = (OVERLAY_ROOT / "dataprep" / "genieai_dataprep_arangodb.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        calls = [
            n
            for n in ast.walk(tree)
            if isinstance(n, ast.Call)
            and isinstance(n.func, ast.Name)
            and n.func.id == "_warn_if_phase_ceiling_too_low"
        ]
        assert len(calls) == 1, f"expected the phase-ceiling check to be applied once at import, found {len(calls)}"
        # Positional AND keyword: `f(a, b, c)` and `f(a, b, retries=c)` are the
        # same call, and a guard that rejects the second one fails correct code.
        passed = {ast.unparse(a) for a in calls[0].args}
        passed |= {k.arg for k in calls[0].keywords if k.arg}
        assert passed == {
            "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS",
            "LLM_MAX_RETRIES",
            "LLM_TIMEOUT_SECONDS",
        }, f"the import-time check reads {passed}, not this service's own budget knobs"

    def test_the_defaults_are_inside_the_constraint(self):
        assert (
            dataprep._one_batched_call_worst_case(dataprep.LLM_MAX_RETRIES, dataprep.LLM_TIMEOUT_SECONDS)
            < dataprep.DATAPREP_LLM_PHASE_TIMEOUT_SECONDS
        ), (
            "the shipped defaults already violate the phase-ceiling constraint — every batched "
            "labelling call would be cancelled before it could return"
        )


class TestTheKillRollbackCannotBeCancelled:
    """A second cancel must not abort the only path that destroys data.

    The kill switch's rollback is a chain of awaits — log, retract, set the
    status, log — living inside an ``except asyncio.CancelledError`` block, and
    an await in a cancellation path is itself cancellable. The endpoint accepts
    a repeated call, so a double-clicked Kill delivers a second
    ``task.cancel()`` straight into the middle of it. Inline, that skipped
    whatever came after the interruption: the document kept the chunks the
    cascade had not reached yet, still served to the retriever, with a status
    that never read "Killed" and therefore no recorded cause.
    """

    def test_a_repeated_cancel_lets_the_rollback_finish(self):
        steps = []

        async def scenario():
            async def rollback():
                await asyncio.sleep(0.05)
                steps.append("retracted")
                await asyncio.sleep(0.05)
                steps.append("status_set")

            task = asyncio.ensure_future(dataprep._run_uninterruptible(rollback(), timeout=2.0, label="rollback"))
            await asyncio.sleep(0.02)
            task.cancel()  # the admin double-clicks Kill
            await asyncio.sleep(0)
            task.cancel()  # the second one lands mid-rollback
            await asyncio.sleep(0.3)

        _run(scenario())
        assert steps == ["retracted", "status_set"], (
            f"the rollback stopped partway: {steps} — chunks the cascade had not reached are "
            "still in the graph, and the document status was never set to Killed"
        )

    def test_a_failed_rollback_is_never_silent(self, monkeypatch):
        """The settle retrieves the rollback's exception — and discards it.

        ``_settle_and_retrieve`` calls ``task.exception()`` under ``suppress``
        to silence asyncio's "never retrieved" warning. Left at that, a
        ``retract_file`` that failed produced no output at all: before the
        round-8 refactor the same exception escaped the handler and was at
        least visible, and nothing downstream reads it either — the microservice
        only pops the task from its registry. The ingest ended reporting a
        clean kill over a half-retracted document.
        """
        # Observed on the module's own logger rather than through caplog: the
        # suite stubs `comps`, so CustomLogger never reaches the root logger.
        recorded = []

        class _Recording:
            def error(self, msg, *a, **k):
                recorded.append(str(msg))

            def warning(self, msg, *a, **k):
                recorded.append(str(msg))

        monkeypatch.setattr(dataprep, "logger", _Recording())

        async def scenario():
            async def failing_rollback():
                raise RuntimeError("AQLQueryExecuteError: collection not found")

            await dataprep._run_uninterruptible(failing_rollback(), timeout=2.0, label="rollback of f1")

        _run(scenario())

        joined = "\n".join(recorded)
        assert "rollback of f1" in joined and "AQLQueryExecuteError" in joined, (
            "a failed rollback logged nothing — the operator is told the document was killed "
            f"cleanly while its chunks are still in the graph. Recorded: {recorded!r}"
        )

    def test_the_status_is_flipped_even_when_the_retract_fails(self):
        """A half-deleted document must still be recorded as killed.

        Inlined, the status write was simply the statement after the retract, so
        a retract that raised skipped it: the document kept whatever status it
        last had while being partially deleted, and nothing on the record said
        an operator had killed it. Combined with the swallowed exception that
        made the whole failure invisible.
        """
        calls = []

        class _Stub:
            async def _write_ingestion_log(self, file_id, level, component, message):
                calls.append(("log", level))

            async def retract_file(self, file_id, graph_name):
                calls.append(("retract", graph_name))
                raise RuntimeError("AQLQueryExecuteError: collection not found")

            async def _update_doc_status(self, file_id, status, **kw):
                calls.append(("status", status))

        # Bound to the stub rather than redefined: the method under test is the
        # real one, only its three collaborators are faked.
        rollback = dataprep.GenieArangoDataprep._rollback_killed_ingest

        async def scenario():
            await rollback(_Stub(), "f1", "GRAPH")

        with pytest.raises(RuntimeError, match="AQLQueryExecuteError"):
            _run(scenario())

        assert ("status", "Killed") in calls, (
            f"the retract failed and the status was never set to Killed: {calls} — the document "
            "is partially deleted with no record that it was killed"
        )

    def test_the_kill_handler_routes_its_rollback_through_it(self):
        """The unit test above is worthless if the handler stops using it.

        Nothing about the handler's shape is forced by the type system: a future
        edit that inlines the rollback again compiles, passes every other test
        here, and restores the half-deleted document. So the call is pinned.
        """
        source = (OVERLAY_ROOT / "dataprep" / "genieai_dataprep_arangodb.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        kill_handlers = []
        for node in ast.walk(tree):
            if not isinstance(node, ast.ExceptHandler):
                continue
            # `except asyncio.CancelledError` parses as an Attribute; the bare
            # `except CancelledError` spelling as a Name. Either is the handler.
            is_cancelled = (isinstance(node.type, ast.Attribute) and node.type.attr == "CancelledError") or (
                isinstance(node.type, ast.Name) and node.type.id == "CancelledError"
            )
            if not is_cancelled:
                continue
            # Both spellings: a bare `f()` is an ast.Name, `self.f()` an
            # ast.Attribute. The rollback is called as a method, so matching
            # only the bare form would never find the handler at all.
            calls = set()
            for c in ast.walk(node):
                if not isinstance(c, ast.Call):
                    continue
                if isinstance(c.func, ast.Name):
                    calls.add(c.func.id)
                elif isinstance(c.func, ast.Attribute):
                    calls.add(c.func.attr)
            # Identify the KILL handler by what it calls, not by its position:
            # this file has several CancelledError handlers, and "some handler
            # shields something" is satisfied by any of them. Inlining the kill
            # rollback while an unrelated handler keeps a _run_uninterruptible
            # call alive passes an any-handler guard and restores the
            # half-retracted document — proven by mutation.
            if "_rollback_killed_ingest" in calls:
                kill_handlers.append(calls)

        assert kill_handlers, (
            "no except-CancelledError block runs _rollback_killed_ingest — the kill handler "
            "has been restructured; re-check this guard rather than deleting it"
        )
        unguarded = [c for c in kill_handlers if "_run_uninterruptible" not in c]
        assert not unguarded, (
            "the kill handler awaits its rollback without _run_uninterruptible — a repeated "
            "cancel aborts the retraction mid-cascade, leaving chunks in the graph and the "
            "document status unset"
        )


class TestUnboundedPhaseSurvivesExternalCancellation:
    """Cancelling the ingest must not leave graph batches running.

    ``asyncio.gather``, which this helper replaced, cancelled its children when
    the awaiting task was cancelled. A bare drain loop does not, and the queued
    batches are parked on ``MAX_CONCURRENT_BATCHES`` — so they acquired the
    semaphore afterwards and wrote the whole document to ArangoDB *after*
    ``retract_file`` had already deleted it. The admin UI showed Killed while
    the retriever served the resurrected chunks.
    """

    def test_cancelling_the_ingest_cancels_every_queued_batch(self, monkeypatch):
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)
        monkeypatch.setattr(dataprep, "_PHASE_CANCEL_GRACE_SECONDS", 0.2)

        async def scenario():
            queued = []
            started = asyncio.Event()

            async def batch():
                started.set()
                # Short enough that an uncancelled sibling actually reaches the
                # write inside the observation window below, rather than merely
                # being caught by the assertion on its cancelled flag.
                await asyncio.sleep(0.05)
                queued.append("wrote")

            tasks = [asyncio.ensure_future(batch()) for _ in range(3)]
            await started.wait()
            phase = asyncio.ensure_future(
                dataprep._await_with_heartbeat(
                    tasks, phase="Graph insertion", total=3, file_id="f1", write_ingestion_log=_noop_log
                )
            )
            await asyncio.sleep(0)
            phase.cancel()
            with pytest.raises(asyncio.CancelledError):
                await phase

            # Everything below runs INSIDE the loop. asyncio.run cancels every
            # remaining task as it shuts down, so an assertion made after
            # _run() returned would see all three cancelled either way and pass
            # against a helper that cancels nothing.
            await asyncio.sleep(0.15)
            assert queued == [], f"a graph batch kept writing after the ingest was cancelled: {queued}"
            assert all(t.cancelled() or t.done() for t in tasks), (
                "batches left pending with no owner; each later raise logs an unretrieved-exception "
                "traceback into the dataprep log, during exactly the incident this change exists to "
                "make diagnosable"
            )
            for task in tasks:
                task.cancel()

        _run(scenario())


class TestASecondCancellationCannotSkipTheSettle:
    """An await inside a cancellation path is itself cancellable.

    The kill endpoint is idempotent-callable, so a double-clicked Kill re-enters
    it and cancels the same task again while the first settle is still running.
    Without a shield, that second cancellation propagates straight out of the
    handler and the settle never happens — the batches are abandoned running,
    which is the exact outcome the grace window exists to prevent, and worse
    than the ``asyncio.gather`` this replaced: gather had no window to lose.
    """

    @pytest.mark.parametrize("helper", ["heartbeat", "gather"])
    def test_a_second_cancel_during_the_settle_still_waits_the_window(self, helper, monkeypatch):
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 5.0)
        monkeypatch.setattr(dataprep, "_PHASE_CANCEL_GRACE_SECONDS", 0.3)

        async def scenario():
            unwound = []
            started = asyncio.Event()

            async def slow():
                started.set()
                try:
                    await asyncio.sleep(5)
                except asyncio.CancelledError:
                    # Takes most of the grace window to unwind, so the second
                    # cancellation lands squarely inside the settle.
                    await asyncio.sleep(0.25)
                    unwound.append(1)
                    raise

            tasks = [asyncio.ensure_future(slow()) for _ in range(3)]
            await started.wait()

            async def run():
                if helper == "heartbeat":
                    return await dataprep._await_with_heartbeat(
                        tasks, phase="Graph insertion", total=3, file_id="f1", write_ingestion_log=_noop_log
                    )
                return await dataprep._gather_with_phase_budget(
                    tasks,
                    phase="Labeling",
                    phase_label=dataprep.PHASE_LABEL_LABELING,
                    total=3,
                    file_id="f1",
                    write_ingestion_log=_noop_log,
                )

            phase = asyncio.ensure_future(run())
            await asyncio.sleep(0)
            phase.cancel()
            await asyncio.sleep(0.05)
            phase.cancel()  # the second click, landing inside the settle

            with pytest.raises(asyncio.CancelledError):
                await phase
            # Inside the loop: asyncio.run cancels stragglers on shutdown.
            assert unwound, (
                "the settle was skipped by the second cancellation — the batches were abandoned "
                "running, so they go on to write after the caller retracts the document"
            )
            for task in tasks:
                task.cancel()

        _run(scenario())


class TestTheSwallowedCancelDoesNotLeaveADanglingCounter:
    """Catching CancelledError for cleanup means uncancel(), since 3.11.

    ``asyncio.timeout`` and ``TaskGroup`` read ``task.cancelling()`` to decide
    whether a cancellation is still live. A task that absorbs the error and
    leaves the counter at 1 while returning normally is how a deadline stops
    firing: the context manager cancels, the task absorbs, ``__aexit__`` sees a
    clean return. Nothing in this overlay wraps an ingest in one today, so this
    pins the pairing rather than a live outage.
    """

    def test_a_cancel_absorbed_by_the_settle_leaves_no_counter(self):
        """The counter has to come back to where it started.

        Without the uncancel() the task that absorbs the cancellation returns
        normally with ``cancelling() == 1`` — precisely the state asyncio.timeout
        and TaskGroup read to decide a cancellation is still live.
        """

        async def driver():
            current = asyncio.current_task()
            before = current.cancelling()

            async def quick():
                await asyncio.sleep(5)

            inner = asyncio.ensure_future(quick())
            current.cancel()
            await dataprep._settle_and_retrieve([inner])
            inner.cancel()
            return before, current.cancelling()

        before, after = _run(driver())
        assert after == before, (
            f"the settle left task.cancelling() at {after} (was {before}); a task that absorbs a "
            "cancellation must decrement the counter, or asyncio.timeout and TaskGroup see a live "
            "cancellation on a task that returned normally"
        )


class TestUnboundedPhaseKeepsItsSiblings:
    """The graph phase cannot abandon work, and that includes on the error path.

    The caller retracts the document the moment this helper raises, so a batch
    still running writes into ArangoDB *after* the retraction and resurrects its
    chunks for a document the admin UI shows as failed. Both error exits
    therefore cancel what is pending and give it a bounded window to unwind.
    """

    def test_a_batch_that_raises_inside_the_settle_is_retrieved(self):
        """The settle drains outcomes; the drain is what stops the traceback.

        ``task.exception()`` is called on every settled task so asyncio does not
        later log "Task exception was never retrieved" with a full traceback —
        noise landing in the dataprep log during exactly the contended-GPU
        incidents this work exists to make diagnosable. Nothing else performs
        that retrieval: the caller is about to raise something else, and the
        microservice's done-callback only pops the task from its registry.

        Asserted through the event loop's exception handler, which is where that
        message is delivered. A sibling test's message PROMISES this property
        but only checks ``task.done()`` — satisfied by a task whose exception
        was never touched.
        """
        seen = []

        async def scenario():
            loop = asyncio.get_running_loop()
            loop.set_exception_handler(lambda _loop, ctx: seen.append(ctx.get("message", "")))

            async def boom():
                await asyncio.sleep(0.05)
                raise RuntimeError("retrievable failure")

            task = asyncio.ensure_future(boom())
            await dataprep._settle_and_retrieve([task])
            del task  # drop the last reference so GC is what triggers the log
            gc.collect()
            await asyncio.sleep(0)

        _run(scenario())
        assert not seen, (
            f"a settled task's exception was never retrieved: {seen} — asyncio logs the full "
            "traceback into the dataprep log at collection time, during the incident this work "
            "exists to make diagnosable"
        )

    def test_an_individually_cancelled_batch_does_not_mask_the_real_failure(self, monkeypatch):
        """One cancelled batch must not turn a failure into a "Killed".

        ``task.exception()`` raises ``CancelledError`` on a cancelled task, so a
        batch cancelled on its own — its own timeout, say — would propagate out
        of the drain and replace the failure the phase actually had. The kill
        switch reads a CancelledError as "an administrator killed this", so the
        document would report Killed instead of the real error.
        """
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 5.0)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)
        monkeypatch.setattr(dataprep, "_PHASE_CANCEL_GRACE_SECONDS", 0.2)

        async def scenario():
            async def boom():
                # Same wake-up tick as the cancelled sibling, so both land in
                # one asyncio.wait and the drain sees them together.
                await asyncio.sleep(0.05)
                raise RuntimeError("the real failure")

            async def self_cancelling():
                await asyncio.sleep(0.05)
                asyncio.current_task().cancel()

            await dataprep._gather_with_phase_budget(
                [asyncio.ensure_future(boom()), asyncio.ensure_future(self_cancelling())],
                phase="LLM labeling",
                phase_label=dataprep.PHASE_LABEL_LABELING,
                total=2,
                file_id="f1",
                write_ingestion_log=_noop_log,
            )

        with pytest.raises(RuntimeError, match="the real failure"):
            _run(scenario())

    def test_a_sibling_is_cancelled_rather_than_left_writing(self, monkeypatch):
        """The failure path takes its in-flight batches with it.

        An earlier version asserted the opposite — that a slow sibling was left
        to finish — on the reasoning that the grace window was there to let it.
        That is the behaviour that lets it write after the retraction, and a
        batch already inside ``asyncio.to_thread`` runs to completion either way,
        so "not cancelling" bought nothing while "cancelling" stops every batch
        still queued on the semaphore.
        """
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)
        monkeypatch.setattr(dataprep, "_PHASE_CANCEL_GRACE_SECONDS", 0.2)

        async def scenario():
            wrote = []
            started = asyncio.Event()

            async def boom():
                await started.wait()
                raise RuntimeError("ArangoDB insert failed")

            async def slow_sibling():
                started.set()
                # Lands inside the observation window below, so an uncancelled
                # sibling actually performs the write rather than merely
                # failing a flag check.
                await asyncio.sleep(0.15)
                wrote.append("chunk")

            tasks = [asyncio.ensure_future(slow_sibling()), asyncio.ensure_future(boom())]
            with pytest.raises(RuntimeError, match="ArangoDB insert failed"):
                await dataprep._await_with_heartbeat(
                    tasks,
                    phase="Graph insertion",
                    total=2,
                    file_id="f1",
                    write_ingestion_log=_noop_log,
                )
            # Inside the loop: asyncio.run cancels stragglers on shutdown, so an
            # assertion after _run() returned would pass either way.
            await asyncio.sleep(0.3)
            assert wrote == [], f"a graph batch kept writing after the phase failed: {wrote}"
            # This checks ownership only. Whether a settled task's exception is
            # RETRIEVED is a separate property, and asserting it in the message
            # without measuring it is what made this look guarded when it was
            # not — see test_a_batch_that_raises_inside_the_settle_is_retrieved,
            # which observes the loop's exception handler directly.
            assert all(t.cancelled() or t.done() for t in tasks), (
                "batches left pending with no owner; a pending batch is not cancelled by the "
                "phase, so it goes on to write after the caller retracts the document"
            )

        _run(scenario())

    def test_a_batch_that_already_finished_keeps_its_outcome(self, monkeypatch):
        """A batch's result survives the phase that abandoned its siblings.

        Asserted on the value the phase RETURNS, which is the only place an
        outcome can survive: ``_await_with_heartbeat`` returns ``None`` by
        design, so pinning anything there proves nothing about keeping work. The
        budget helper is the one that hands completed batches back to the caller
        for a degraded document, and a completed batch it silently drops becomes
        a chunk that was labelled in time and then thrown away.
        """
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 0.4)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)
        monkeypatch.setattr(dataprep, "_PHASE_CANCEL_GRACE_SECONDS", 0.2)

        async def scenario():
            async def quick():
                await asyncio.sleep(0.01)
                return {"labels": ["Healthcare"]}

            async def wedged():
                await asyncio.sleep(30)

            results, timed_out = await dataprep._gather_with_phase_budget(
                [asyncio.ensure_future(quick()), asyncio.ensure_future(wedged())],
                phase="LLM labeling",
                phase_label=dataprep.PHASE_LABEL_LABELING,
                total=2,
                file_id="f1",
                write_ingestion_log=_noop_log,
            )
            return results, timed_out

        results, timed_out = _run(scenario())
        assert timed_out is True, "the wedged batch should have exhausted the phase budget"
        assert results == [{"labels": ["Healthcare"]}], (
            "the batch that completed before the budget expired was dropped from the phase's "
            f"results, so its labels are lost for no reason: {results!r}"
        )


class TestTimeoutClassifier:
    """A timeout is the failure the budget produces on purpose, so it is labelled.

    The deck is tuned by reading these off the traces: a timeout points at GPU
    contention and at a budget that may need raising, while a 500 or a parse
    failure means something else. Conflating them makes a contended GPU read as
    a broken prompt, so the classifier is pinned per exception class rather
    than left to be noticed when one of these arrives in production.
    """

    @pytest.mark.parametrize(
        ("exc_name", "expected"),
        [
            # What the model-endpoint clients actually raise.
            ("APITimeoutError", True),
            ("ReadTimeout", True),
            ("ConnectTimeout", True),
            ("PoolTimeout", True),
            ("ServerTimeoutError", True),
            ("TimeoutError", True),
            # The failures it must NOT claim.
            ("InternalServerError", False),
            ("APIConnectionError", False),
            ("JSONDecodeError", False),
            ("ValueError", False),
            ("RateLimitError", False),
        ],
    )
    def test_classification_by_exception_name(self, exc_name, expected):
        exc = type(exc_name, (Exception,), {})()
        assert dataprep._is_timeout(exc) is expected

    def test_a_wrapped_timeout_is_still_recognised(self):
        """Clients wrap the original error; the classifier must walk the chain.

        openai and httpx both re-raise from the transport error, so the timeout
        the budget set arrives wrapped. Matching only the outermost class would
        miss exactly the case this exists to label.
        """
        inner = type("APITimeoutError", (Exception,), {})()
        outer = RuntimeError("chat.completions.create failed")
        outer.__cause__ = inner
        assert dataprep._is_timeout(outer) is True

    def test_a_self_referential_chain_terminates(self):
        """A cyclic __cause__ chain must not hang the error path."""
        exc = ValueError("boom")
        exc.__cause__ = exc
        assert dataprep._is_timeout(exc) is False


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
                phase_label=dataprep.PHASE_LABEL_LABELING,
                total=2,
                file_id="f1",
                write_ingestion_log=_noop_log,
            )

        with pytest.raises(RuntimeError, match="vLLM rejected the prompt"):
            _run(scenario())
