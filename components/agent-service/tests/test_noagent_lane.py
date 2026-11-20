# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The admission lane: the flock slot-pool port (story 1.9).

Mutation-sensitive pins: every claim opens its OWN slot file (slot 0 keeps
the base name, slot i lives at ``<base>.i`` — the dataprep idiom), busy is
a typed refusal BEFORE any stage runs, the slot releases on every exit
path, and a cancellation never becomes a busy error.
"""

import asyncio
import os

import pytest

from noagent.lane import AdmissionLane, LaneBusyError


@pytest.fixture()
def lane_dir(tmp_path):
    """A per-test lock directory: slot files never leak across tests."""
    return str(tmp_path / "lane.lock")


def _slot_files(lane_dir):
    """The slot files the lane created for its base path, sorted."""
    base = os.path.basename(lane_dir)
    parent = os.path.dirname(lane_dir)
    return sorted(name for name in os.listdir(parent) if name.startswith(base))


def test_single_slot_admits_one_run_and_refuses_the_next(lane_dir):
    lane = AdmissionLane(1, lane_dir)

    async def scenario():
        async with lane.acquire():
            with pytest.raises(LaneBusyError):
                async with lane.acquire():
                    pass  # never reached

    asyncio.run(scenario())
    assert _slot_files(lane_dir) == ["lane.lock"]  # slot 0 keeps the base name


def test_two_concurrent_claims_take_distinct_slots(lane_dir):
    """Both claims are inside their blocks AT THE SAME TIME — no slot
    collision, no queueing — and the second slot file is the ``.1`` twin
    the dataprep idiom names."""
    lane = AdmissionLane(2, lane_dir)
    inside = 0
    peak = 0

    async def hold():
        nonlocal inside, peak
        async with lane.acquire():
            inside += 1
            peak = max(peak, inside)
            await asyncio.sleep(0.01)
            inside -= 1

    async def scenario():
        await asyncio.gather(hold(), hold())

    asyncio.run(scenario())
    assert peak == 2
    assert sorted(_slot_files(lane_dir)) == ["lane.lock", "lane.lock.1"]


def test_saturation_refuses_with_the_typed_error_before_any_stage(lane_dir):
    """All three slots held → the fourth claim is refused, not queued. The
    refusal carries the slot count so the operator sees the saturation."""
    lane = AdmissionLane(3, lane_dir)

    async def scenario():
        contexts = [lane.acquire() for _ in range(3)]
        for context in contexts:
            await context.__aenter__()
        with pytest.raises(LaneBusyError, match="all 3 slots"):
            async with lane.acquire():
                pass
        for context in reversed(contexts):
            await context.__aexit__(None, None, None)

    asyncio.run(scenario())


def test_slot_releases_on_exception(lane_dir):
    lane = AdmissionLane(1, lane_dir)

    async def scenario():
        with pytest.raises(RuntimeError, match="stage failed"):
            async with lane.acquire():
                raise RuntimeError("stage failed")
        # The SAME slot admits the next run.
        async with lane.acquire():
            pass

    asyncio.run(scenario())


def test_slot_releases_on_cancellation(lane_dir):
    """A cancelled run releases its slot during unwinding: the next run is
    admitted, and the cancellation was never mapped to a busy error."""
    lane = AdmissionLane(1, lane_dir)
    cancelled = False

    async def victim():
        nonlocal cancelled
        async with lane.acquire():
            try:
                await asyncio.sleep(10)
            except asyncio.CancelledError:
                cancelled = True
                raise

    async def scenario():
        task = asyncio.ensure_future(victim())
        await asyncio.sleep(0.05)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert cancelled is True
        # The released slot admits the successor immediately.
        async with lane.acquire():
            pass

    asyncio.run(scenario())


def test_a_released_handle_is_re_lockable_single_slot(lane_dir):
    """Five sequential single-slot runs all succeed: the close in the
    finally-block is the release — a leaked handle would keep the flock and
    every run after the first would be refused."""
    lane = AdmissionLane(1, lane_dir)

    async def scenario():
        for _ in range(5):
            async with lane.acquire():
                pass

    asyncio.run(scenario())
    assert _slot_files(lane_dir) == ["lane.lock"]


def test_lock_files_are_private(lane_dir):
    """The dataprep hardening, kept: the slot file carries 0600."""
    lane = AdmissionLane(1, lane_dir)

    async def scenario():
        async with lane.acquire():
            assert os.stat(lane_dir).st_mode & 0o777 == 0o600

    asyncio.run(scenario())


def test_a_planted_symlink_at_a_slot_path_is_never_followed(lane_dir):
    """O_NOFOLLOW on open (the dataprep hardening): a symlink pre-planted at
    a slot path is refused by the OS — the scan never follows it, and the
    loud OSError propagates instead of silently locking the target."""
    os.symlink("/etc/passwd", lane_dir + ".2")
    holder = AdmissionLane(2, lane_dir)

    async def fill():
        contexts = [holder.acquire() for _ in range(2)]
        for context in contexts:
            await context.__aenter__()
        lane_three = AdmissionLane(3, lane_dir)
        with pytest.raises(OSError):
            async with lane_three.acquire():
                pass
        for context in reversed(contexts):
            await context.__aexit__(None, None, None)

    asyncio.run(fill())


def test_lane_rejects_a_zero_slot_configuration():
    with pytest.raises(ValueError):
        AdmissionLane(0, "/tmp/whatever")


def test_from_config_wires_the_env_values(lane_dir):
    from noagent.config import NoAgentConfig

    config = NoAgentConfig.load(env={"AGENT_LANE_SLOTS": "4", "AGENT_LANE_LOCK_PATH": lane_dir})
    lane = AdmissionLane.from_config(config)
    assert lane._slots == 4
    assert lane._lock_path == lane_dir
