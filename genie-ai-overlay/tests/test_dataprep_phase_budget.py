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
import json
import sys
import time
from pathlib import Path
from unittest.mock import MagicMock

import pytest

OVERLAY_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(OVERLAY_ROOT))

# The dataprep module imports comps, which only exists inside the built image.
# tests/conftest.py pre-populates sys.modules with MagicMock stubs for it, and
# pytest.ini collects this directory alongside tests/, so the stubs are already
# in place by the time this module is imported.
import dataprep.genieai_dataprep_arangodb as dataprep  # noqa: E402


@pytest.fixture(autouse=True)
def _workable_contextual_window(monkeypatch):
    """A window the doc-context derivation can fit inside (merged from
    feat/okf-server 2026-10-21).

    The derivation uses the serving model's window, discovered at runtime from
    VLLM_ENDPOINT (issue #1182; was the VLLM_MAX_MODEL_LEN env) — fail-closed
    to a 2048-token fallback when discovery has no answer, and 2048 cannot fit
    the per-chunk output reservation (512 x batch 4), so every
    real-contextualization test below would be gated out at the derivation
    with DEGRADED_WINDOW_TOO_SMALL before the phase logic it exists to test
    runs. Stub the discovery seam (dataprep's from-import binding) with a
    default-profile window instead.
    """
    monkeypatch.setattr(dataprep, "get_max_model_len", lambda _url, _ttl=None: 65536)
    # The model id comes from the same probe; stubbing it too keeps the suite
    # from making real outbound HTTP calls (a probe that answers, or hangs,
    # would decide what these tests measure).
    monkeypatch.setattr(dataprep, "get_model_id", lambda _url, _ttl=None: "test-model")


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


def _stub_dataprep():
    """A dataprep instance with only what _label_with_llm touches.

    __new__ bypasses __init__, which chains through parents that connect to
    ArangoDB — the same trick tests/test_dataprep.py uses.
    """
    from unittest.mock import AsyncMock, MagicMock

    dp = dataprep.GenieArangoDataprep.__new__(dataprep.GenieArangoDataprep)
    dp._write_ingestion_log = AsyncMock()
    dp.llm_transformer = MagicMock()
    # OKF-branch attrs (merged from feat/okf-server 2026-10-21): the bundle-log
    # mirror caches and the log semaphore live in __init__, which __new__
    # bypasses — ingest_file_with_guardrail invalidates/reads them eagerly.
    dp._bundle_file_id_cache = {}
    dp._concept_file_name_cache = {}
    dp._log_semaphore = asyncio.Semaphore(100)
    dp._current_repo_id = None
    return dp


def _run(coro):
    return asyncio.run(coro)


def _AsyncJson(payload):
    """An async ``create()`` that answers with *payload* as its JSON body."""

    import json
    from unittest.mock import MagicMock

    async def create(**_kwargs):
        return MagicMock(
            choices=[MagicMock(message=MagicMock(content=json.dumps(payload)))],
            usage=None,
        )

    return create


def _AsyncTuple(value, fell_back):
    """A stand-in for ``_llm_suggest_labels``: one batch's result."""

    async def call(*_args, **_kwargs):
        return value, fell_back

    return call


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

        # The second element is the timed_out flag. It was asserted as `[]` while
        # the function returned `[]` — an empty list where the contract says bool.
        # Every `if timed_out` then read as working by coincidence of falsiness.
        # False is the shape the callers are annotated for and branch on.
        partials, timed_out = _run(scenario())
        assert partials == []
        assert timed_out is False


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
        # Generous on purpose. The budget is 0.2 s, so anything under a minute
        # proves the point — that the phase RETURNS rather than hanging on the
        # 30 s sleep. A tight ratio here measures the CI runner's scheduling
        # lag, not the code: this measured 5.2 s on a loaded runner against the
        # 5.0 s ceiling this assertion used to carry.
        assert elapsed < 60.0, f"the phase overran its budget by {elapsed:.1f}s"

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
        assert elapsed < 60.0, f"the error path waited {elapsed:.1f}s on a cancelled sibling"


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

    def test_a_degraded_document_is_uniformly_labelled(self, monkeypatch):
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")
        """Chunks from abandoned batches must not be stored with no labels.

        A batch that RUNS fills every chunk index — ``_llm_suggest_labels``
        loops over the batch and ``_llm_call_single`` returns the document's
        file labels when its call fails. A batch that is ABANDONED is cancelled
        before that loop, so it contributes nothing at all, and its chunks used
        to be stored with an empty label list: unreachable by taxonomy, and the
        ingestion log reads "Final labels (0): []", which looks like a labelling
        regression rather than the budget exhaustion that caused it.
        """
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 0.4)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)
        monkeypatch.setattr(dataprep, "_PHASE_CANCEL_GRACE_SECONDS", 0.2)

        from unittest.mock import MagicMock, patch

        async def scenario():
            dp = _stub_dataprep()

            async def never_answers(**_kwargs):
                # A real coroutine, not an AsyncMock side_effect: AsyncMock
                # RETURNS whatever the side_effect produces, so a side_effect
                # of sleep(30) hands back an un-awaited coroutine and the call
                # fails immediately — exercising the per-batch failure path
                # instead of the budget path this test is about.
                await asyncio.sleep(30)

            hung = MagicMock()
            hung.chat.completions.create = never_answers
            with patch.object(dataprep, "AsyncOpenAI", return_value=hung):
                return await dp._label_with_llm(
                    ["alpha text", "beta text", "gamma text", "delta text"],
                    ["Tax:IVA", "Topic:Property"],
                    ["Tax:IVA"],
                    "f1",
                )

        results, degraded = _run(scenario())
        assert degraded == [dataprep.DEGRADED_PHASE_BUDGET], (
            f"the phase was abandoned, so it must report the budget as its cause: {degraded!r}"
        )
        assert len(results) == 4, results
        unlabelled = [r["text"] for r in results if not r["labels"]]
        assert not unlabelled, (
            f"chunks were stored with no labels: {unlabelled} — a degraded document must be "
            "uniform, or the unlabelled chunks are invisible to taxonomy search and the symptom "
            "reads as a labelling bug"
        )

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
        assert elapsed < 60.0, (
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
        assert elapsed < 60.0, (
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
            (2, 180.0, 900.0, True),  # the shipped defaults: 4 waves x 180 = 720
            (2, 180.0, 720.0, False),  # exactly the wave cost is not "above" it
            (2, 180.0, 600.0, False),  # the pre-round-11 default degraded a 260-chunk doc
            (2, 180.0, 541.0, False),  # above one ladder, still under four waves
            (2, 300.0, 900.0, False),  # a slower model under the shipped ceiling
            (2, 300.0, 1201.0, True),  # raised to match
            (3, 180.0, 1800.0, True),  # the retry ladder is not what binds here
        ],
    )
    def test_the_warning_fires_exactly_when_the_ceiling_is_too_low(self, retries, per_call, phase, ceiling_ok):
        warned = dataprep._warn_if_phase_ceiling_too_low(phase, retries, per_call)
        waves = dataprep._phase_waves_for_reference_document()
        ladder = dataprep._one_batched_call_worst_case(retries, per_call)
        needed = max(ladder, waves * per_call)
        assert (phase > needed) is ceiling_ok, (
            f"the case table disagrees with the code: ceiling {phase}s vs needed {needed}s "
            f"(waves {waves} x {per_call}s = {waves * per_call}s, ladder {ladder}s)"
        )
        assert warned is not ceiling_ok, (
            f"warned={warned} for ceiling {phase}s needing {needed}s, expected warned={not ceiling_ok}"
        )

    def test_the_wave_count_is_what_binds_at_the_defaults(self):
        """The single-call constraint is necessary and NOT sufficient.

        65 batches at concurrency 20 is four sequential waves sharing one
        ceiling. Checking only the ladder would leave the shipped default
        silently degrading any document whose calls finish inside their own
        budget — exactly the shape of the incident this work exists for.
        """
        waves = dataprep._phase_waves_for_reference_document()
        assert waves == 4, f"the reference document costs {waves} waves, not 4"
        ladder = dataprep._one_batched_call_worst_case(dataprep.LLM_MAX_RETRIES, dataprep.LLM_TIMEOUT_SECONDS)
        assert waves * dataprep.LLM_TIMEOUT_SECONDS > ladder, (
            "the ladder is the binding constraint, so the wave case above is testing nothing"
        )
        assert waves * dataprep.LLM_TIMEOUT_SECONDS < dataprep.DATAPREP_LLM_PHASE_TIMEOUT_SECONDS, (
            "the shipped phase ceiling cannot absorb four waves of fully-timed-out calls — a "
            "healthy-but-slow GPU answering a batch in 180 s would degrade every such document"
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


def _run_degraded_ingest(monkeypatch, *, degraded, contextual_reasons=None):
    from unittest.mock import AsyncMock, MagicMock, patch

    monkeypatch.setenv("VLLM_API_KEY", "test-key")
    monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
    monkeypatch.setenv("VLLM_MODEL_ID", "test-model")
    dp = _stub_dataprep()
    dp.db = MagicMock()
    dp._fetch_all_labels = AsyncMock(return_value=["Tax:IVA"])
    dp._load_and_chunk = AsyncMock(return_value=["chunk one", "chunk two"])
    dp._run_guardrail = AsyncMock(return_value={"success": True})
    dp._update_doc_status = AsyncMock()
    dp._apply_contextualization = AsyncMock(side_effect=lambda c, i, f: (list(c), list(contextual_reasons or [])))
    dp._apply_labels = AsyncMock(
        return_value=([{"text": "a", "labels": ["Tax:IVA"]}, {"text": "b", "labels": ["Tax:IVA"]}], degraded)
    )
    dp._process_batch = AsyncMock()
    dp.ensure_vector_index = AsyncMock(return_value=(None, None))

    from unittest.mock import MagicMock as MM

    inp = MM(file_id="f1", file_path="/tmp/f1.pdf", graph_name="GRAPH", file_labels=[])

    async def scenario():
        with (
            patch.object(dataprep, "ArangoGraph"),
            patch.object(dataprep, "Document", side_effect=lambda **kw: MM(metadata=dict(kw))),
        ):
            return await dp.ingest_file_with_guardrail(inp, lock_file=None)

    return _run(scenario()), dp


class TestADegradedPhaseNeverReportsIngested:
    """ "Ingested" claims the whole document landed. A degraded one must not say so.

    An abandoned phase leaves real work undone — some chunks carry the document's
    file labels instead of model labels, others raw text instead of generated
    context — and the document was still being marked Ingested, which is an
    operator-visible claim that it was not. The symptom then looks like a
    labelling regression instead of the budget exhaustion that caused it.

    "Ingested with Warnings" is not a new state: the API schema's Joi enum, the
    i18n catalogue in every locale, and the admin dashboard's status badge
    (`variant="warning"`) all already carry it. Nothing produced it.
    """

    def test_a_degraded_phase_reports_ingested_with_warnings(self, monkeypatch):
        _result, dp = _run_degraded_ingest(monkeypatch, degraded=[dataprep.DEGRADED_PHASE_BUDGET])
        statuses = [c.args[1] for c in dp._update_doc_status.call_args_list]
        assert "Ingested" not in statuses, (
            f"a document with an abandoned phase was reported as plainly Ingested: {statuses}"
        )
        assert statuses[-1] == "Ingested with Warnings", statuses

    def test_the_contextual_phase_reports_its_own_timeout(self, monkeypatch):
        """The phase must produce the reason, not just pass one through.

        The other test here stubs _apply_contextualization, so it covers the
        ingest's handling of the signal and nothing else. Mutating the real
        _contextualize_per_chunk to report no timeout leaves this file green
        without it — so the signal's origin needs its own test, driven by a
        client that never answers and a phase budget that expires.
        """
        from unittest.mock import MagicMock, patch

        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 0.4)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)
        monkeypatch.setattr(dataprep, "_PHASE_CANCEL_GRACE_SECONDS", 0.2)

        async def never_answers(**_kwargs):
            await asyncio.sleep(30)

        client = MagicMock()
        client.chat.completions.create = never_answers

        async def scenario():
            dp = _stub_dataprep()
            inp = MagicMock(file_name="f1.pdf", file_type="pdf", storage_path="/tmp/f1.pdf")
            with patch.object(dataprep, "_build_vllm_client", return_value=(client, "test-model")):
                return await dp._apply_contextualization(["chunk one", "chunk two"], inp, "f1")

        texts, reasons = _run(scenario())
        assert reasons == [dataprep.DEGRADED_PHASE_BUDGET], (
            f"the contextual phase timed out but reported {reasons!r} — the document would be "
            "reported as plainly Ingested"
        )
        # And the chunks survive, raw, rather than the ingest failing.
        assert len(texts) == 2, texts

    def test_a_client_that_will_not_build_names_itself_as_the_cause(self, monkeypatch):
        """The other way this phase degrades, with its own remedy.

        `_build_vllm_client` raises on a bad endpoint or an undetectable model.
        That is an endpoint problem, not a slow one: raising the phase budget
        cannot fix it, and the message used to say to do exactly that. The reason
        string is what separates them, so the origin needs coverage too.
        """
        from unittest.mock import MagicMock, patch

        dp = _stub_dataprep()
        inp = MagicMock(file_name="f1.pdf", file_type="pdf", storage_path="/tmp/f1.pdf")

        async def scenario():
            with patch.object(dataprep, "_build_vllm_client", side_effect=RuntimeError("model id unset")):
                return await dp._apply_contextualization(["chunk one"], inp, "f1")

        texts, reasons = _run(scenario())
        assert reasons and "could not be built" in reasons[0], (
            f"a client that would not build reported {reasons!r} — the operator is told to raise "
            "a budget, re-ingests, and gets the identical failure"
        )
        assert reasons != [dataprep.DEGRADED_PHASE_BUDGET], (
            "a broken client was reported as a budget exhaustion, which prescribes the wrong fix"
        )
        # The chunks still land, raw.
        assert texts == ["chunk one"], texts

    def test_a_contextual_timeout_alone_still_degrades_the_document(self, monkeypatch):
        """The Contextual Retrieval half needs its own coverage.

        The two tests above drive the LABELLING flag only — the harness stubs
        _apply_contextualization to report no degradation. So the whole contextual
        path could regress to always reporting "Ingested" and the suite would stay
        green: mutating `return result, [DEGRADED_PHASE_BUDGET] if timed_out
        else []` to `return result, []` passes every test in this file. That is
        the incident this rule came from — a count that is not a contract.
        """
        _result, dp = _run_degraded_ingest(
            monkeypatch,
            degraded=[],
            contextual_reasons=[dataprep.DEGRADED_PHASE_BUDGET],
        )
        statuses = [c.args[1] for c in dp._update_doc_status.call_args_list]
        assert statuses[-1] == "Ingested with Warnings", (
            f"the contextual phase ran out of budget and the document still reported {statuses[-1]!r}"
        )

    def test_a_broken_vllm_client_is_named_as_a_degradation_not_a_slow_one(self, monkeypatch):
        """A client that will not build is a different problem from a slow one.

        Both degrade the document, and both were previously reported as "ran out
        of its 900s budget" — sending an operator to raise a budget that could
        not fix a misconfigured endpoint. The ingestion log names which it was.
        """
        _result, dp = _run_degraded_ingest(
            monkeypatch,
            degraded=[],
            contextual_reasons=["the vLLM client could not be built (ConnectionError)"],
        )
        messages = [c.args[3] for c in dp._write_ingestion_log.call_args_list if len(c.args) > 3]
        joined = " ".join(str(m) for m in messages)
        assert "could not be built" in joined, joined
        # The budget remedy must NOT be offered for a cause it cannot fix.
        # This used to be asserted by grepping the log for "Phase budget exhausted"
        # — a string this MR replaced with the DEGRADED_REMEDIES budget sentence,
        # so the filter was always empty and the assertion could never fail. It
        # now checks the rendered text for the budget knob, which is what the
        # remedy actually emits.
        assert "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS" not in joined, (
            f"a broken client was handed the budget remedy: {joined}"
        )

    def test_a_clean_ingest_still_reports_ingested(self, monkeypatch):
        """The new state must not become the default — it means something."""
        _result, dp = _run_degraded_ingest(monkeypatch, degraded=[])
        statuses = [c.args[1] for c in dp._update_doc_status.call_args_list]
        assert statuses[-1] == "Ingested", statuses


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

    def test_the_heartbeat_path_does_not_let_a_cancelled_batch_mask_the_failure(self, monkeypatch):
        """The same hazard on the no-fallback runner, which had no test for it.

        ``_await_with_heartbeat`` drains its own batches, so it needs its own
        ``cancelled()`` check — and had none covered. Deleting that check makes
        the graph-insertion phase report CancelledError for a write that failed
        with a real error, which the kill switch reads as "Killed by an
        administrator": the operator is told someone pressed stop, and the
        ArangoDB failure underneath never reaches the ingestion log.

        Proven by mutation, not assumed: with the check removed this test fails
        with CancelledError instead of RuntimeError.
        """
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)
        monkeypatch.setattr(dataprep, "_PHASE_CANCEL_GRACE_SECONDS", 0.2)

        async def scenario():
            async def boom():
                await asyncio.sleep(0.05)
                raise RuntimeError("the real failure")

            async def self_cancelling():
                await asyncio.sleep(0.05)
                asyncio.current_task().cancel()

            await dataprep._await_with_heartbeat(
                [asyncio.ensure_future(boom()), asyncio.ensure_future(self_cancelling())],
                phase="Graph insertion",
                total=2,
                file_id="f1",
                write_ingestion_log=_noop_log,
            )

        with pytest.raises(RuntimeError, match="the real failure"):
            _run(scenario())

    def test_a_batch_cancelled_during_the_heartbeat_write_does_not_mask_the_failure(self, monkeypatch):
        """The LATE drain is a third drain, and it needed its own check too.

        The batches that settle while the heartbeat awaits its ingestion-log
        write are recovered by a loop of their own, so a cancelled one reaches
        ``Task.exception()`` there without passing the main drain's check.
        Without it the same "Killed instead of failed" outcome arrives by a
        different route. Proven by mutation: removing the check fails this.
        """
        # The budget expires INSIDE the heartbeat write, so the phase leaves the
        # loop as soon as the write returns and the main drain never sees these
        # two again -- the same shape the sibling late-drain test relies on.
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 0.08)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 0.05)

        async def scenario():
            recorder = _Recorder(yield_for=0.15)

            async def fails_during_the_log_write():
                await asyncio.sleep(0.06)
                raise RuntimeError("the real failure")

            async def cancels_during_the_log_write():
                await asyncio.sleep(0.06)
                asyncio.current_task().cancel()

            async def wedged():
                await asyncio.sleep(30)

            await dataprep._gather_with_phase_budget(
                [
                    fails_during_the_log_write(),
                    cancels_during_the_log_write(),
                    wedged(),
                ],
                phase="Labeling",
                phase_label=dataprep.PHASE_LABEL_LABELING,
                total=3,
                file_id="f1",
                write_ingestion_log=recorder,
            )

        with pytest.raises(RuntimeError, match="the real failure"):
            _run(scenario())

    def test_a_failure_seen_in_the_main_drain_does_not_wait_out_another_interval(self, monkeypatch):
        """A batch that has already failed ends the loop; it does not get polled.

        The phase is going to raise, so the remaining batches' results are
        discarded and the ``finally`` cancels them a moment later. Falling
        through instead parks them in ``asyncio.wait`` for a whole progress
        interval first — 60 s at the default — holding their semaphore slots
        while the per-chunk fallback for the batch that just failed waits
        behind them. The ingest is already degrading; this makes it degrade
        later, silently, with no log line to explain the gap.

        Counted rather than timed: a wall-clock assertion here would be a flaky
        test in a suite that already runs on a loaded CI runner. The number of
        ``asyncio.wait`` calls is the mechanism, and it does not drift.
        """
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 5.0)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)

        real_wait = asyncio.wait
        calls = []

        async def counting_wait(*args, **kwargs):
            # Only the LOOP's waits. The finally's grace window calls
            # asyncio.wait too, with a timeout and no return_when, and that one
            # is the bounded settle the whole design rests on — counting it
            # would make the assertion depend on the thing it protects.
            if kwargs.get("return_when") is asyncio.FIRST_COMPLETED:
                calls.append(1)
            return await real_wait(*args, **kwargs)

        monkeypatch.setattr(dataprep.asyncio, "wait", counting_wait)

        async def scenario():
            async def fails_at_once():
                raise RuntimeError("the real failure")

            async def wedged():
                await asyncio.sleep(30)

            await dataprep._gather_with_phase_budget(
                [fails_at_once(), wedged()],
                phase="Labeling",
                phase_label=dataprep.PHASE_LABEL_LABELING,
                total=2,
                file_id="f1",
                write_ingestion_log=_noop_log,
            )

        with pytest.raises(RuntimeError, match="the real failure"):
            _run(scenario())

        # One wait is what it takes to SEE the failure. A second means the loop
        # kept polling after it already had the answer.
        assert len(calls) == 1, (
            f"the phase waited {len(calls)} times after a batch had already failed; "
            "the remaining batches are cancelled in the finally, so every wait past "
            "the first holds their semaphore slots for a whole progress interval"
        )

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


class TestEveryDegradationIsNamed:
    """A phase that degrades must say WHY, with the remedy that matches.

    Each test here is a mutant that was green before: a degradation the code
    performs, names in a log line, and reports nowhere. The document reads
    "Ingested" while part of it never landed — the exact silent shortfall this
    whole mechanism exists to remove.
    """

    def _ingestion_messages(self, dp):
        return " ".join(str(c.args[3]) for c in dp._write_ingestion_log.call_args_list if len(c.args) > 3)

    def test_a_budget_exhaustion_names_the_budget_and_both_knobs(self, monkeypatch):
        """The POSITIVE half of what was already pinned.

        The existing guard asserts the budget remedy is absent for a non-budget
        cause. Nothing asserted it is present for a budget one, so deleting the
        entire budget sentence — the operator-facing instruction that is the
        point of the degraded status — left the suite green.
        """
        _result, dp = _run_degraded_ingest(monkeypatch, degraded=[dataprep.DEGRADED_PHASE_BUDGET])
        joined = self._ingestion_messages(dp)
        assert "budget" in joined.lower(), joined
        assert "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS" in joined, (
            f"the budget cause never named the knob that fixes it: {joined}"
        )
        assert "MODEL_LLM_TIMEOUT_SECONDS" in joined, (
            f"the budget cause never named the per-call knob that fixes it: {joined}"
        )

    def test_a_client_that_will_not_build_survives_the_labelling_phase(self, monkeypatch):
        """The labelling half of the client-init cause.

        Contextualization runs first and guards `_build_vllm_client`, so an
        unbuildable client was caught, recorded, and the ingest carried on to
        labelling — where the same unguarded call raised, landed in the ingest's
        except handler, and RETRACTED a document that has a working file-label
        fallback. Which phase runs first decided whether the ingest survived a
        misconfigured endpoint.
        """
        from unittest.mock import patch

        dp = _stub_dataprep()

        async def scenario():
            with patch.object(dataprep, "_build_vllm_client", side_effect=RuntimeError("model id unset")):
                return await dp._label_with_llm(["chunk one", "chunk two"], ["Tax:IVA"], ["Tax:IVA"], "f1")

        results, reasons = _run(scenario())
        assert reasons and reasons[0].startswith(dataprep.DEGRADED_CLIENT_UNAVAILABLE), (
            f"labelling did not name the unbuildable client: {reasons!r}"
        )
        assert reasons != [dataprep.DEGRADED_PHASE_BUDGET], (
            "a broken client was reported as a budget exhaustion, which prescribes the wrong fix"
        )
        # The document still gets labels — from the file's own scope.
        assert len(results) == 2, results
        assert all(r["labels"] == ["Tax:IVA"] for r in results), results

    def test_a_phase_that_produced_nothing_names_that(self, monkeypatch):
        """An endpoint that answers but returns nothing usable is a degradation.

        Every chunk falling back to raw text logged a loud ERROR and then
        returned no reason, so the document reported "Ingested". The two are
        different problems with different fixes — this one is not a slow phase.
        """
        from unittest.mock import MagicMock, patch

        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 30.0)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)

        async def answers_empty(**_kwargs):
            return MagicMock(choices=[], usage=None)

        client = MagicMock()
        client.chat.completions.create = answers_empty

        async def scenario():
            dp = _stub_dataprep()
            inp = MagicMock(file_name="f1.pdf", file_type="pdf", storage_path="/tmp/f1.pdf")
            with patch.object(dataprep, "_build_vllm_client", return_value=(client, "test-model")):
                return await dp._apply_contextualization(["chunk one", "chunk two"], inp, "f1")

        texts, reasons = _run(scenario())
        assert reasons and reasons[0].startswith(dataprep.DEGRADED_NO_CONTEXTS), (
            f"a phase that produced no context reported {reasons!r} — the document would be "
            "reported as plainly Ingested"
        )
        assert reasons != [dataprep.DEGRADED_PHASE_BUDGET], (
            "an endpoint that returns nothing was reported as a budget exhaustion"
        )
        assert texts == ["chunk one", "chunk two"], texts

    def test_an_exhausted_budget_does_not_also_blame_the_model(self, monkeypatch):
        """The two contextual causes are mutually exclusive, budget first.

        An exhausted phase produced no contexts BECAUSE its batches were
        abandoned. Naming both told the operator to check their model supports
        guided JSON when the ceiling is what stopped it — the wrong knob, on top
        of the right one.
        """
        from unittest.mock import MagicMock, patch

        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 0.4)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)
        monkeypatch.setattr(dataprep, "_PHASE_CANCEL_GRACE_SECONDS", 0.2)

        async def never_answers(**_kwargs):
            await asyncio.sleep(30)

        client = MagicMock()
        client.chat.completions.create = never_answers

        async def scenario():
            dp = _stub_dataprep()
            inp = MagicMock(file_name="f1.pdf", file_type="pdf", storage_path="/tmp/f1.pdf")
            with patch.object(dataprep, "_build_vllm_client", return_value=(client, "test-model")):
                return await dp._apply_contextualization(["chunk one", "chunk two"], inp, "f1")

        _texts, reasons = _run(scenario())
        assert reasons == [dataprep.DEGRADED_PHASE_BUDGET], (
            f"an exhausted phase blamed something besides the ceiling: {reasons!r}"
        )

    def test_partly_contextualized_chunks_are_not_a_degradation(self, monkeypatch):
        """The all-or-nothing case is a cause; the ordinary one is not.

        Some chunks falling back is what the per-batch fallback is for. Flagging
        the document for it would make "Ingested with Warnings" fire on healthy
        documents and teach operators to ignore it.

        Drives _contextualize_per_chunk with the batch call stubbed, so this is
        about the classification and not about how a response body parses.
        """
        from unittest.mock import AsyncMock, MagicMock

        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 30.0)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)

        async def scenario():
            dp = _stub_dataprep()
            # Two of four chunks get a context; the other two come back empty.
            dp._context_batch_call = AsyncMock(return_value={0: "about the subject", 1: "also about it"})
            chunks = [f"chunk {i}" for i in range(4)]
            return await dp._contextualize_per_chunk(MagicMock(), "m", "sys", chunks, "f1", 4)

        texts, reasons = _run(scenario())
        assert reasons == [], (
            f"a phase that mostly succeeded was reported as degraded: {reasons!r} — the status must "
            "mean something or operators will ignore it"
        )
        assert texts[0].startswith("about the subject"), texts
        assert texts[3] == "chunk 3", texts

    def test_a_labelling_phase_that_produced_nothing_names_that(self, monkeypatch):
        """The labelling twin of the contextual no-contexts cause.

        Every chunk falling back to the document's own labels means the labelling
        phase accomplished nothing — an endpoint that answers but returns nothing
        usable, a model that rejects response_format=json_object, a model id that
        resolves to nothing. Every chunk still lands, so nothing looks broken and
        the document reported a clean Ingested on a phase that never ran.
        """
        from unittest.mock import MagicMock, patch

        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 30.0)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)

        async def rejects_prompt(**_kwargs):
            raise RuntimeError("this model does not support guided JSON")

        client = MagicMock()
        client.chat.completions.create = rejects_prompt

        async def scenario():
            dp = _stub_dataprep()
            with patch.object(dataprep, "_build_vllm_client", return_value=(client, "test-model")):
                return await dp._label_with_llm(["chunk one", "chunk two"], ["Tax:IVA"], ["Tax:IVA"], "f1")

        results, reasons = _run(scenario())
        assert reasons and reasons[0].startswith(dataprep.DEGRADED_NO_LABELS), (
            f"a labelling phase that produced nothing reported {reasons!r} — the document would be "
            "reported as plainly Ingested"
        )
        assert reasons != [dataprep.DEGRADED_PHASE_BUDGET], (
            "an endpoint that returns nothing was reported as a budget exhaustion"
        )
        # And the chunks still carry the document's labels rather than nothing,
        # so they stay reachable through a taxonomy search.
        assert all(r["labels"] == ["Tax:IVA"] for r in results), results

    def test_a_labelling_phase_that_answered_nothing_is_not_a_degradation(self, monkeypatch):
        """A model that says "no label matches" has answered, and that is fine.

        It arrives in the suggestion map as an empty list, indistinguishable from
        a failure unless the failure is counted separately. Flagging the document
        would make the status fire on documents whose taxonomy simply does not
        cover them.
        """
        from unittest.mock import MagicMock, patch

        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 30.0)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)

        client = MagicMock()
        # Indexed keys PRESENT and empty — that is what "nothing matched the
        # taxonomy" looks like on the wire. An envelope keyed by "labels" is a
        # different thing: a model that did not honour response_format, which
        # the parser now treats as a batch failure rather than an answer.
        client.chat.completions.create = _AsyncJson({"0": [], "1": []})

        async def scenario():
            dp = _stub_dataprep()
            with patch.object(dataprep, "_build_vllm_client", return_value=(client, "test-model")):
                return await dp._label_with_llm(["chunk one", "chunk two"], ["Tax:IVA"], ["Tax:IVA"], "f1")

        _results, reasons = _run(scenario())
        assert reasons == [], (
            f"a model that answered with no matching labels was reported as degraded: {reasons!r} — "
            "that is a correct answer, not a failure"
        )

    def test_a_misshaped_batch_falls_back_to_per_chunk_and_recovers(self, monkeypatch):
        """The batch parser's recovery path, which nothing else exercised.

        The parser fills every requested index with [] for indices the response
        does not mention, so a response it cannot map — an envelope keyed by
        "labels", a bare array — produced the whole batch as unlabelled and
        called it answered. It is now a batch failure, so the per-chunk path
        runs. Here the model copes with the simpler per-chunk prompt, so the
        document is fully labelled and there is nothing to report.
        """
        from unittest.mock import MagicMock, patch

        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 30.0)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)

        # No index keys, so the batch parser recognises nothing — but it IS the
        # shape the per-chunk prompt asks for, so the recovery succeeds.
        client = MagicMock()
        client.chat.completions.create = _AsyncJson({"labels": ["Tax:IVA"]})

        async def scenario():
            dp = _stub_dataprep()
            with patch.object(dataprep, "_build_vllm_client", return_value=(client, "test-model")):
                return await dp._label_with_llm(["chunk one", "chunk two"], ["Tax:IVA"], ["Tax:IVA"], "f1")

        results, reasons = _run(scenario())
        assert reasons == [], f"a recovered batch was reported as degraded: {reasons!r}"
        assert all(r["labels"] == ["Tax:IVA"] for r in results), results

    def test_a_shape_no_level_can_map_is_named(self, monkeypatch):
        """The failure the new cause exists for, at both levels.

        A model that ignores response_format=json_object answers in a shape
        neither the batch nor the per-chunk parser can read. Every chunk then
        falls back to the document's own labels and the phase accomplished
        nothing — which must be named, not stored as a clean ingest.
        """
        from unittest.mock import MagicMock, patch

        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 30.0)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)

        for payload in (
            {"results": [{"index": 0, "labels": ["Tax:IVA"]}]},
            {"nope": "Tax:IVA"},
            ["Tax:IVA"],
        ):
            client = MagicMock()
            client.chat.completions.create = _AsyncJson(payload)

            async def scenario(c=client):
                dp = _stub_dataprep()
                with patch.object(dataprep, "_build_vllm_client", return_value=(c, "test-model")):
                    return await dp._label_with_llm(["chunk one", "chunk two"], ["Tax:IVA"], ["Tax:IVA"], "f1")

            results, reasons = _run(scenario())
            assert reasons, (
                f"the model answered {payload!r} — a shape no level can map — and the document was "
                "stored with no labels from the model and reported as a clean ingest"
            )
            assert reasons[0].startswith(dataprep.DEGRADED_NO_LABELS), (
                f"{payload!r} reported {reasons!r}, not the cause it is"
            )
            # And the chunks still carry the document's labels, so they stay
            # reachable by a taxonomy search rather than stored unlabelled.
            assert all(r["labels"] == ["Tax:IVA"] for r in results), results

    def test_a_body_without_a_labels_key_says_so(self, monkeypatch):
        """The shape check names the problem instead of letting it raise.

        The end state is reachable either way — `parsed["labels"]` raises KeyError
        on a missing key and the existing handler retries — so mutating the guard
        away left the whole suite green. What it changes is what the operator
        reads: an explicit "returned a body without 'labels'" against a generic
        "call attempt failed: 'labels'", the second of which points at the call
        rather than at the model's answer.
        """
        from unittest.mock import MagicMock, patch

        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 30.0)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)

        recorded = []

        async def _record(*args, **_kwargs):
            # str() on a plain str is the message itself; repr of the args tuple
            # would backslash-escape the apostrophes the assertion looks for.
            recorded.append(" ".join(str(a) for a in args))

        client = MagicMock()
        client.chat.completions.create = _AsyncJson({"results": []})

        async def scenario():
            dp = _stub_dataprep()
            dp._write_ingestion_log = _record
            with patch.object(dataprep, "_build_vllm_client", return_value=(client, "test-model")):
                return await dp._label_with_llm(["chunk one"], ["Tax:IVA"], ["Tax:IVA"], "f1")

        _results, _reasons = _run(scenario())
        joined = " ".join(recorded)
        assert "without 'labels'" in joined, (
            f"a body with no labels key was not named as such; the operator gets: {joined}"
        )

    def test_a_body_without_a_context_key_says_so(self, monkeypatch):
        """Same conflation, closed on the contextual side — and pinned.

        Both contextual parsers read `parsed.get("context", "")`, so a body in a
        shape we never asked for was indistinguishable from the model saying
        "this chunk needs no context", and the log then said "empty context",
        which is a false statement about the model. Removing the guard entirely
        left the whole suite green — the end state is the same either way
        (retry, then raw), so what it changes is what the operator reads, and
        nothing asserted that until this did.
        """
        from unittest.mock import MagicMock, patch

        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 30.0)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)

        recorded = []

        async def _record(*args, **_kwargs):
            # str() on a plain str is the message itself; repr of the args tuple
            # would backslash-escape the apostrophes the assertion looks for.
            recorded.append(" ".join(str(a) for a in args))

        client = MagicMock()
        client.chat.completions.create = _AsyncJson({"labels": ["not a context"]})

        async def scenario():
            dp = _stub_dataprep()
            dp._write_ingestion_log = _record
            with patch.object(dataprep, "_build_vllm_client", return_value=(client, "test-model")):
                return await dp._apply_contextualization(
                    ["chunk one"],
                    MagicMock(file_name="f", file_type="pdf", storage_path="/tmp/f.pdf"),
                    "f1",
                )

        texts, _reasons = _run(scenario())
        joined = " ".join(recorded)
        assert "without 'context'" in joined, (
            f"a body with no context key was not named as such; the operator gets: {joined}"
        )
        assert "empty context" not in joined, (
            f"a misshaped body was logged as an empty context, which is a false claim about the model: {joined}"
        )
        # And the chunk still lands raw — a misshaped answer never blocks ingestion.
        assert texts == ["chunk one"], texts

    def test_an_unmapped_cause_is_reported_verbatim(self, monkeypatch):
        """The one path that must NOT borrow another cause's advice.

        _degraded_cause falls through to the reason itself for a sentinel it does
        not know, and DEGRADED_REMEDIES has no entry for it — so the line reports
        what happened and stops, rather than filing it under a cause that does not
        describe it. That fallback was untested: replacing the append with an
        empty string left the suite green, so an unmapped cause would have
        produced a line naming no cause at all.
        """
        _result, dp = _run_degraded_ingest(monkeypatch, degraded=["a cause nobody has given a remedy"])
        joined = " ".join(str(c.args[3]) for c in dp._write_ingestion_log.call_args_list if len(c.args) > 3)
        assert "a cause nobody has given a remedy" in joined, joined
        # And it borrows no remedy: neither knob is offered for a cause we cannot
        # diagnose, because naming one would be a guess presented as advice.
        assert "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS" not in joined, joined
        assert "Raising a budget will not help" not in joined, joined

    def test_the_labels_value_matrix(self, monkeypatch):
        """What the per-chunk parser accepts as an answer, and what it rejects.

        Nothing pinned any of this, and one line of it is load-bearing for the
        whole ingest: `suggested = [x for x in suggested if isinstance(x, str)]`.
        Delete that filter and a model answering {"labels": ["Tax:IVA", 5]} sends
        an int into _finalize_chunk_labels, which raises
        `AttributeError: 'int' object has no attribute 'lower'` — out of
        _label_with_llm, out of _apply_labels, into the ingest's except handler,
        which RETRACTS the entire document over one unusable value in one answer.
        The full suite stayed green through that.

        So: which shapes are answers (the phase is working), which are parse
        failures (recover, or name the cause if recovery fails).
        """
        from unittest.mock import MagicMock, patch

        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 30.0)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)

        # (body, is_an_answer, why)
        matrix = [
            ({"labels": []}, True, "the model says this chunk matches nothing"),
            ({"labels": None}, True, "lenient: null is an empty answer"),
            ({"labels": "Tax:IVA"}, True, "lenient: a bare string is one label"),
            ({"labels": ["Tax:IVA", 5]}, True, "lenient: unusable entries are DROPPED"),
            ({"labels": ["Tax:IVA", {"a": 1}]}, True, "same, for a non-string object"),
            ({"labels": {"a": 1}}, False, "a dict is not a label list — not answerable"),
            ({"labels": 5}, False, "a number is not a label list — not answerable"),
            ({"other": []}, False, "no labels key at all — the shape we never asked for"),
        ]
        for body, is_answer, why in matrix:
            client = MagicMock()
            client.chat.completions.create = _AsyncJson(body)

            async def scenario(c=client):
                dp = _stub_dataprep()
                with patch.object(dataprep, "_build_vllm_client", return_value=(c, "test-model")):
                    return await dp._label_with_llm(["chunk one"], ["Tax:IVA"], ["Tax:IVA"], "f1")

            results, reasons = _run(scenario())
            if is_answer:
                assert reasons == [], f"{body!r} is an answer ({why}) but reported {reasons!r}"
            else:
                assert reasons, f"{body!r} is not answerable ({why}) and was reported as a clean ingest"
            # Either way the chunk lands, never unlabelled-by-accident and never raising.
            assert len(results) == 1 and isinstance(results[0]["labels"], list), results

    def test_partly_labelled_chunks_are_not_a_total_failure(self, monkeypatch):
        """Some chunks falling back is what the per-batch fallback is for.

        The all-or-nothing invariant is stated in the code's comment at the
        check; this is what pins it. An earlier version of this test stubbed
        fell_back=0, which means "NO chunk fell back" and so said nothing about
        the partial case — mutating `== len(chunks)` to `> 0`, which flags every
        partially-fallen-back document, left the whole suite green.
        """
        from unittest.mock import MagicMock, patch

        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", 30.0)
        monkeypatch.setattr(dataprep, "DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", 60.0)

        # THREE chunks, so a partial count and "all but one" are two distinct
        # cases. With two chunks len-1 == 1 and there is only one partial value,
        # which is why the first version of this test could not pin anything.
        # fell_back == 3 is the total case, and it IS named — see
        # test_a_labelling_phase_that_produced_nothing_names_that.
        # _llm_suggest_labels is stubbed, so no client is ever called: this pins
        # the COUNT arithmetic in _label_with_llm, not the batch parser. Building
        # a client here read as coverage of the parser and was none.
        for fell_back in (1, 2):
            client = MagicMock()

            async def scenario(fb=fell_back, c=client):
                dp = _stub_dataprep()
                dp._llm_suggest_labels = _AsyncTuple({"0": ["Tax:IVA"]}, fb)
                with patch.object(dataprep, "_build_vllm_client", return_value=(c, "test-model")):
                    return await dp._label_with_llm(
                        ["chunk one", "chunk two", "chunk three"], ["Tax:IVA"], ["Tax:IVA"], "f1"
                    )

            _results, reasons = _run(scenario())
            assert reasons == [], (
                f"{fell_back} of 3 chunks fell back and that was reported as a total failure: "
                f"{reasons!r} — the status must mean something or operators will ignore it"
            )

    def test_doc_level_that_produced_nothing_names_that(self, monkeypatch):
        """doc_level is a supported strategy with the same hole.

        One call for the whole document means no batch wave to exceed a budget
        over — which is not the same as "cannot degrade". A single call returning
        nothing usable left every chunk raw and the document "Ingested".
        """
        from unittest.mock import MagicMock, patch

        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
        monkeypatch.setenv("VLLM_MODEL_ID", "test-model")
        monkeypatch.setattr(dataprep, "CONTEXTUAL_STRATEGY", "doc_level")

        async def answers_empty(**_kwargs):
            return MagicMock(choices=[], usage=None)

        client = MagicMock()
        client.chat.completions.create = answers_empty

        async def scenario():
            dp = _stub_dataprep()
            inp = MagicMock(file_name="f1.pdf", file_type="pdf", storage_path="/tmp/f1.pdf")
            with patch.object(dataprep, "_build_vllm_client", return_value=(client, "test-model")):
                return await dp._apply_contextualization(["chunk one", "chunk two"], inp, "f1")

        texts, reasons = _run(scenario())
        assert reasons and reasons[0].startswith(dataprep.DEGRADED_NO_CONTEXTS), (
            f"doc_level produced no context and reported {reasons!r} — a doc_level deployment "
            "would report every fully-uncontextualized document as a clean ingest"
        )
        assert texts == ["chunk one", "chunk two"], texts


class TestCauseClassification:
    """_degraded_cause decides which remedy an operator is handed.

    It matches by prefix because a phase appends its own detail to the sentinel.
    Equality would match only the bare budget case and quietly file the rest as
    unrecognised — the state that produced a remedy naming the wrong knob.
    """

    def test_each_sentinel_classifies_to_itself(self):
        for sentinel in (
            dataprep.DEGRADED_PHASE_BUDGET,
            dataprep.DEGRADED_CLIENT_UNAVAILABLE,
            dataprep.DEGRADED_NO_CONTEXTS,
        ):
            assert dataprep._degraded_cause(sentinel) is sentinel

    def test_appended_detail_still_classifies(self):
        assert (
            dataprep._degraded_cause(f"{dataprep.DEGRADED_CLIENT_UNAVAILABLE} (ConnectionError: refused)")
            is dataprep.DEGRADED_CLIENT_UNAVAILABLE
        )
        assert dataprep._degraded_cause(f"{dataprep.DEGRADED_NO_CONTEXTS} (0/260)") is dataprep.DEGRADED_NO_CONTEXTS

    def test_an_unmapped_cause_falls_through_to_itself(self):
        """Unknown causes are reported verbatim, never filed under another one."""
        assert dataprep._degraded_cause("something nobody has seen before") == ("something nobody has seen before")

    def test_every_cause_the_code_emits_has_a_remedy(self):
        """Adding a cause without a remedy must be a visible gap, not a silent one.

        Derived from the module, NOT written out as a literal: a literal here is
        checked against itself, so adding a fourth sentinel and emitting it with no
        remedy entry left the suite green — verified by mutation. Reading the
        sentinels back off the module is what makes the gap visible.
        """
        sentinels = {
            value
            for name, value in vars(dataprep).items()
            if name.startswith("DEGRADED_") and name != "DEGRADED_REMEDIES" and isinstance(value, str)
        }
        assert sentinels, "no sentinels found — the derivation is broken, not the code"
        missing = sentinels - set(dataprep.DEGRADED_REMEDIES)
        assert not missing, f"causes with no remedy, so an operator would get none: {sorted(missing)}"

    def test_every_sentinel_is_in_the_classifier_roster(self):
        """A sentinel _degraded_cause does not know about gets NO remedy.

        It falls through to reporting the reason verbatim, so an operator is told
        what happened and not what to do. Checked as set EQUALITY against the
        module's roster: asserting that the classifier returns something with a
        remedy cannot catch this, because the fall-through value IS the sentinel,
        and the sentinel has a remedy entry — so the miss reads as a pass. That
        was verified by mutation: dropping a sentinel from the matcher left the
        suite green until this test existed.
        """
        declared = {
            value
            for name, value in vars(dataprep).items()
            if name.startswith("DEGRADED_") and name != "DEGRADED_REMEDIES" and isinstance(value, str)
        }
        rostered = set(dataprep.DEGRADED_CAUSES)
        assert declared == rostered, (
            f"DEGRADED_CAUSES is out of step with the declared sentinels. "
            f"declared but not matched: {sorted(declared - rostered)} "
            f"(these would be reported with no remedy). "
            f"matched but not declared: {sorted(rostered - declared)} (dead entries)."
        )

    def test_the_reported_line_carries_the_reason_verbatim(self, monkeypatch):
        """The reason is greppable, and keeps the counts the remedy drops.

        The runbook tells operators to look for the cause phrase in this line.
        Emitting only the remedy meant the quoted phrase appeared nowhere in the
        log, and the (0/N) counts the phase computed were discarded.
        """
        _result, dp = _run_degraded_ingest(
            monkeypatch, degraded=["the labelling model returned no labels for any chunk (0/260)"]
        )
        joined = " ".join(str(c.args[3]) for c in dp._write_ingestion_log.call_args_list if len(c.args) > 3)
        assert "the labelling model returned no labels for any chunk (0/260)" in joined, joined
        # And the remedy for that cause is still attached, not replaced by it.
        assert "Raising a budget will not help" in joined, joined

    def test_only_the_budget_remedy_tells_the_operator_to_raise_a_budget(self):
        for sentinel, remedy in dataprep.DEGRADED_REMEDIES.items():
            mentions_raising = "Raise DATAPREP_LLM_PHASE_TIMEOUT_SECONDS" in remedy
            assert mentions_raising == (sentinel == dataprep.DEGRADED_PHASE_BUDGET), (
                f"{sentinel!r} prescribes the wrong fix: {remedy}"
            )

    def test_every_non_budget_remedy_says_a_budget_will_not_help(self):
        """The half of the distinction the previous guard could not see.

        That guard checked the budget remedy is not offered for a non-budget
        cause — by looking for the string "Raise DATAPREP_LLM_PHASE_TIMEOUT_SECONDS",
        which is absent from every other remedy by construction, so it passed
        whatever those remedies said. The operator-facing risk is the opposite
        direction: a non-budget cause whose remedy does NOT rule out raising the
        ceiling sends them to a knob that cannot help. Deleting that clause from
        any one remedy left the suite green.
        """
        for sentinel, remedy in dataprep.DEGRADED_REMEDIES.items():
            if sentinel == dataprep.DEGRADED_PHASE_BUDGET:
                continue
            assert "Raising a budget will not help" in remedy, (
                f"{sentinel!r} does not tell the operator that raising a budget cannot fix it: {remedy}"
            )


class TestTheDegradedPathIsActuallyGuarded:
    """Four invariants that a behavioural suite cannot see, and that a reviewer
    showed by mutation were unguarded.

    Each of these was mutated in the production module and the 104-test suite
    stayed green:

    * ``if tasks:`` → ``if False:`` — no chunk is ever written, and nothing
      notices, even though "no chunk is written with no labels after the phase
      is declared degraded" is this MR's headline invariant. The suite observes
      ``_label_with_llm``'s RETURN value; the WRITE it feeds is invisible,
      because ``_process_batch`` is stubbed throughout.
    * ``await self.retract_file(...)`` added on the degraded path — which
      deletes every chunk the finished batches produced, reports HTTP 200, and
      shows the operator a warning badge over an empty document.
    * the startup ceiling check wrapped in ``if os.getenv(...)`` — the existing
      guard parses the AST and counts calls, so it still saw one call with
      three arguments while the check stopped running in every deployment.
    * both degradation counters deleted — the module docstring calls the metrics
      one of the three things that make degradation visible.

    These are AST guards for that reason: the behaviour they protect is exactly
    the part the behavioural suite replaces with a stub.
    """

    @staticmethod
    def _module_tree():
        import ast
        import pathlib

        src = pathlib.Path(__file__).resolve().parent.parent / "dataprep" / "genieai_dataprep_arangodb.py"
        return ast.parse(src.read_text(encoding="utf-8")), src

    def test_the_chunk_write_carries_the_labels_the_phase_produced(self):
        """`chunk_labels` must read the document's labels, not an empty list.

        `[]` here is the exact shape of the bug this MR exists to prevent: a
        chunk indexed with no labels, indistinguishable downstream from a chunk
        the model genuinely labelled with nothing.
        """
        tree, _ = self._module_tree()
        offenders = []
        seen = 0
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Dict) and node.keys):
                continue
            for key, value in zip(node.keys, node.values, strict=True):
                if not (isinstance(key, ast.Constant) and key.value == "chunk_labels"):
                    continue
                seen += 1
                if isinstance(value, ast.List) and not value.elts:
                    offenders.append(f"line {node.lineno}: chunk_labels is a literal []")
                elif not (
                    isinstance(value, ast.Subscript)
                    and isinstance(value.slice, ast.Constant)
                    and value.slice.value == "labels"
                ) or isinstance(value, ast.List):
                    offenders.append(f"line {node.lineno}: chunk_labels is {ast.unparse(value)}")
        assert seen, "no chunk_labels dict entry found — this guard is covering nothing"
        assert not offenders, (
            f"a chunk is indexed without the labels its phase produced: {offenders}. Every chunk "
            "written after a degraded phase carries either model labels or the document's file "
            "labels; an empty list is neither"
        )

    def test_the_graph_insertion_is_actually_awaited(self):
        """The batched write is gated on having tasks, and is inside that gate.

        `if tasks:` → `if False:` skips the write entirely and every test stays
        green, so the gate's condition is pinned as well as its presence.
        """
        tree, _ = self._module_tree()
        found = False
        for node in ast.walk(tree):
            if not isinstance(node, ast.If):
                continue
            test_src = ast.unparse(node.test)
            if "tasks" not in test_src:
                continue
            body_src = " ".join(ast.unparse(stmt) for stmt in node.body)
            if "_await_with_heartbeat" not in body_src or "Graph insertion" not in body_src:
                continue
            found = True
            assert test_src.strip() == "tasks", (
                f"the graph-insertion gate is `if {test_src}:` — it must be the task list's own "
                "truthiness, or the write is skipped for a reason nothing states"
            )
        assert found, "no `if tasks:` gate around the graph-insertion write was found"

    def test_the_degraded_success_path_never_retracts(self):
        """A degraded document keeps its chunks.

        Retracting on that path deletes every chunk the batches that DID finish
        produced, then reports success — the document becomes empty while the UI
        shows a warning badge over it. So every `retract_file` call must sit in
        an exception handler or a `finally`, never in the success path.
        """
        tree, _ = self._module_tree()
        function = next(
            n
            for n in ast.walk(tree)
            if isinstance(n, (ast.AsyncFunctionDef, ast.FunctionDef)) and n.name == "ingest_file_with_guardrail"
        )
        # A call is on the ROLLBACK path when an ancestor is an exception
        # handler or a `finally` body; anything else sits on the success path,
        # which is where a retract would be a bug rather than a cleanup.
        parents = {}
        for node in ast.walk(function):
            for child in ast.iter_child_nodes(node):
                parents[child] = node

        def in_rollback(n) -> bool:
            while n in parents:
                n = parents[n]
                if isinstance(n, ast.ExceptHandler):
                    return True
                parent = parents.get(n)
                if isinstance(parent, ast.Try) and n is parent.finalbody:
                    return True
            return False

        # The retract need not be WRITTEN on the success path to be a bug: a
        # helper (`async def _purge_partial(...): await self.retract_file(...)`)
        # called from there does the same damage and defeats a scan of this
        # function alone. Proven by mutation — that exact indirection left the
        # guard green. And it is not exotic: this module already extracts
        # `_rollback_killed_ingest` out of its CancelledError handler, so
        # wrapping is the house style here.
        #
        # So: every retract_file call in the MODULE must be reachable only from
        # a rollback position — in its own body, or through callers that are
        # themselves rollback-only.
        module_parents = {}
        for outer in ast.walk(tree):
            for child in ast.iter_child_nodes(outer):
                module_parents[child] = outer

        def rollback_from(n) -> bool:
            while n in module_parents:
                n = module_parents[n]
                if isinstance(n, ast.ExceptHandler):
                    return True
                owner = module_parents.get(n)
                if isinstance(owner, ast.Try) and n is owner.finalbody:
                    return True
            return False

        def enclosing_function(n):
            while n in module_parents:
                n = module_parents[n]
                if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    return n
            return None

        functions = [n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
        offenders = []
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Call) and ast.unparse(node.func).endswith("retract_file")):
                continue
            if rollback_from(node):
                continue
            owner = enclosing_function(node)
            # Callers reach the retract by CALLING THE FUNCTION THAT HOLDS IT,
            # so match on that function's NAME. `func is node` only ever hits a
            # bare `self.retract_file(...)` written in the same body, and it
            # flagged the legitimate `_rollback_killed_ingest` helper as an
            # offender until this was corrected.
            name = owner.name if owner is not None else None
            callers = [
                call
                for fn in functions
                if fn is not owner
                for stmt in fn.body
                for call in ast.walk(stmt)
                if isinstance(call, ast.Call) and ast.unparse(call.func).endswith(f".{name}")
            ]
            if callers and all(rollback_from(c) for c in callers):
                continue
            where = f" in {owner.name}" if owner is not None else ""
            offenders.append(f"line {node.lineno}{where}: {ast.unparse(node)[:50]}")
        assert not offenders, (
            f"the degraded success path calls retract_file at {offenders}. The batches that finished "
            "are real work; a degraded document is reported as such, not deleted"
        )

    def test_the_startup_ceiling_check_cannot_be_switched_off(self):
        """It must be a bare module-level call, not one behind a condition.

        The previous guard counted calls in the AST, so wrapping the call in
        `if os.getenv("...") == "1":` left it seeing exactly one call with three
        arguments and passed — while the operator never saw the misconfiguration
        warning in any deployment.
        """
        tree, _ = self._module_tree()
        guarded = []
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Call) and ast.unparse(node.func) == "_warn_if_phase_ceiling_too_low"):
                continue
            guarded.append((node.lineno, len(node.args)))
        assert guarded, "the startup ceiling check is gone entirely"
        for lineno, nargs in guarded:
            assert nargs == 3, f"line {lineno}: the ceiling check takes {nargs} args, expected 3"
        module_level = [
            stmt
            for stmt in tree.body
            if isinstance(stmt, ast.Expr)
            and isinstance(stmt.value, ast.Call)
            and ast.unparse(stmt.value.func) == "_warn_if_phase_ceiling_too_low"
        ]
        assert module_level, (
            "the ceiling check is not a bare module-level call. Every form of conditional — an env "
            "flag, a feature switch, a try/except — leaves it parsing the same but not running"
        )

    def test_both_degradation_counters_are_still_wired(self):
        """The metrics are named in the module docstring as the visible channel.

        Deleting either `.add(...)` leaves the suite green, which would leave a
        degraded document visible only to whoever opens its ingestion log.
        """
        tree, _ = self._module_tree()
        counts = {}
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            name = ast.unparse(node.func)
            for counter in ("_dataprep_phase_budget_exhausted_total.add", "_llm_fallback_total.add"):
                if name == counter:
                    counts.setdefault(counter, []).append(node.lineno)
        for counter in ("_dataprep_phase_budget_exhausted_total.add", "_llm_fallback_total.add"):
            assert counts.get(counter), (
                f"{counter} is never called — degradation becomes invisible to the admin metrics, "
                "which this module's docstring names as one of three things that make it visible"
            )
        # And the phase-budget reason must be distinguished from the others, or
        # a dashboard cannot answer "was this the budget or the endpoint?".
        tags = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and ast.unparse(node.func) == "_llm_fallback_total.add":
                for arg in node.args:
                    if isinstance(arg, ast.Dict):
                        for k, v in zip(arg.keys, arg.values, strict=True):
                            if isinstance(k, ast.Constant) and k.value == "reason":
                                # .value, not unparse(): unparse on a string
                                # literal returns it QUOTED, so the tag never
                                # matched and the assertion below passed vacuously.
                                tags.add(v.value if isinstance(v, ast.Constant) else ast.unparse(v))
        # Set membership, deliberately: the question is whether budget
        # exhaustion is distinguished AT ALL, not whether every site tags it.
        # Verified by mutation — removing one of the two tags passes, removing
        # both fails. Tightening it to "every site" would be the wrong guard:
        # the contextual and labelling phases have different fallbacks and may
        # legitimately report the same reason under different `phase` tags.
        assert "phase_budget" in tags, (
            f"no _llm_fallback_total.add call tags reason=phase_budget (found {sorted(tags)}), so a "
            "budget-exhausted phase is indistinguishable from a parse failure or a dead endpoint"
        )


class TestAnIncompleteBatchKeepsWhatItAnswered:
    """A batch response that labelled N-1 of N is not a failed batch call.

    This MR made an omitted index a contract violation rather than a silent
    `[]` — correctly, since the prompt the same call sends says every index must
    be present. But it then returned None, which discarded the N-1 answers the
    model had already produced and made the caller re-ask all N chunks.

    On the contended GPU this exists for, that is the worst possible trade: a
    dropped index makes the batch call slow, which makes it likelier to drop
    another, and each of the N per-chunk re-asks carries its own three-attempt
    ladder while holding the same semaphore slot. A 4-chunk batch went from
    1 call to 5 — and the phase ceiling is sized on BATCH count, so it cannot
    see the expansion and the document degrades for a reason no knob covers.

    So: keep the partial answer, re-ask only the missing indices.
    """

    @staticmethod
    def _batch_response(labels_by_index, omit=()):
        """A batch answer naming `labels_by_index`, silently skipping `omit`."""
        payload = {str(k): v for k, v in labels_by_index.items() if k not in omit}
        message = MagicMock()
        message.content = json.dumps(payload)
        message.tool_calls = None
        choice = MagicMock()
        choice.message = message
        choice.finish_reason = "stop"
        response = MagicMock()
        response.choices = [choice]
        response.usage = None
        return response

    @staticmethod
    def _async_client(responses):
        """A client returning each response in turn, recording every call."""
        calls = []
        pending = list(responses)

        async def create(**kwargs):
            calls.append(kwargs)
            item = pending.pop(0)
            if isinstance(item, Exception):
                raise item
            return item

        client = MagicMock()
        client.chat.completions.create = create
        return client, calls

    def _run_batch(self, client, batch):
        async def scenario():
            dp = _stub_dataprep()
            return await dp._llm_call_batch(client, "test-model", "sys", batch, "f1")

        return _run(scenario())

    def test_a_missing_index_is_reported_not_discarded(self):
        client, calls = self._async_client([self._batch_response({0: ["A"], 2: ["C"]}, omit=(1,))])
        suggestions, missing = self._run_batch(client, [(0, "a"), (1, "b"), (2, "c")])
        assert len(calls) == 1, "the batch call must not be retried to recover one index"
        assert missing == [1], f"expected only index 1 to be reported missing, got {missing}"
        assert set(suggestions) == {0, 2}, f"the two answered indices were discarded: {suggestions}"
        assert suggestions[0] == ["A"] and suggestions[2] == ["C"]

    def test_a_complete_batch_reports_nothing_missing(self):
        client, _ = self._async_client([self._batch_response({0: ["A"], 1: ["B"]})])
        suggestions, missing = self._run_batch(client, [(0, "a"), (1, "b")])
        assert missing == []
        assert set(suggestions) == {0, 1}

    def test_an_unusable_value_is_still_lenient(self):
        """A present-but-unusable value is `[]`, not a re-ask.

        The asymmetry is deliberate: the prompt forbids both `null` and a bare
        string, but an index that is PRESENT means the model answered, and
        re-asking costs a call to get the same `[]` it already gave.
        """
        message = MagicMock()
        message.content = json.dumps({"0": ["A"], "1": None})
        message.tool_calls = None
        choice = MagicMock()
        choice.message = message
        choice.finish_reason = "stop"
        response = MagicMock()
        response.choices = [choice]
        response.usage = None
        client, calls = self._async_client([response])

        suggestions, missing = self._run_batch(client, [(0, "a"), (1, "b")])
        assert len(calls) == 1
        assert missing == [], "a null VALUE is an answer, not an omission"
        assert suggestions[1] == [], f"a null value must become [], got {suggestions[1]!r}"

    def test_only_the_missing_indices_are_re_asked(self):
        """The cost this exists to bound: N-1 re-asks, not N.

        Four chunks, one omitted. The old contract spent five calls; this spends
        two. Asserted by COUNT, because asserting on the answer alone would pass
        under either contract — the labels come out the same either way, which is
        exactly why the regression went unnoticed.
        """
        client, calls = self._async_client(
            [
                self._batch_response({0: ["A"], 1: ["B"], 3: ["D"]}, omit=(2,)),
                # The per-chunk shape, so the re-ask goes through the real
                # _llm_call_single and lands on this client. Stubbing it would
                # hide the very call this test counts.
                self._single_response(["C"]),
            ]
        )

        async def scenario():
            dp = _stub_dataprep()
            return await dp._llm_suggest_labels(
                client, "test-model", "sys", [(0, "a"), (1, "b"), (2, "c"), (3, "d")], "f1", []
            )

        out, fell_back = _run(scenario())

        assert len(calls) == 2, (
            f"expected 1 batch call + 1 re-ask, made {len(calls)}. Re-asking every chunk turns a "
            "4-chunk batch into 5 calls, each with its own retry ladder, holding one semaphore "
            "slot — and the phase ceiling is sized on batch count, so it cannot see that."
        )
        assert set(out) == {0, 1, 2, 3}, f"every chunk must end up answered, got {sorted(out)}"
        assert out[0] == ["A"] and out[2] == ["C"], f"partial answers were lost: {out}"

    @staticmethod
    def _single_response(labels):
        message = MagicMock()
        message.content = json.dumps({"labels": labels})
        message.tool_calls = None
        choice = MagicMock()
        choice.message = message
        choice.finish_reason = "stop"
        response = MagicMock()
        response.choices = [choice]
        response.usage = None
        return response

    @staticmethod
    def _batch_response_text(text):
        message = MagicMock()
        message.content = text
        message.tool_calls = None
        choice = MagicMock()
        choice.message = message
        choice.finish_reason = "stop"
        response = MagicMock()
        response.choices = [choice]
        response.usage = None
        return response
