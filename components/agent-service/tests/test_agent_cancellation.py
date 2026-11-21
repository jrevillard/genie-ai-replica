# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The cancellation hook.

Mutation-sensitive pins: the pre-dispatch check raises (never maps to a
result or a typed failure), the in-flight work is CANCELLED — not
abandoned — when the token wins the race, its ``CancelledError`` propagates
untouched, a work that wins the race delivers its result, and no exit path
leaves the in-flight call running.
"""

import asyncio

import pytest

from agent.cancellation import CancellationToken, run_cancellable


def _never_completing(recorder: dict):
    """Work that hangs until cancelled and records that the cancellation reached it."""

    async def work():
        recorder["started"] = True
        try:
            await asyncio.Event().wait()  # forever
        except asyncio.CancelledError:
            recorder["cancelled_in_flight"] = True
            raise

    return work()


def test_the_token_reports_and_raises_once_fired():
    token = CancellationToken()
    assert token.cancelled is False
    token.raise_if_cancelled()  # clean: no raise
    token.cancel()
    assert token.cancelled is True
    with pytest.raises(asyncio.CancelledError):
        token.raise_if_cancelled()


def test_cancel_is_idempotent():
    token = CancellationToken()
    token.cancel()
    token.cancel()
    assert token.cancelled is True


def test_wait_unblocks_when_the_token_fires():
    token = CancellationToken()

    async def scenario():
        async def fire_soon():
            await asyncio.sleep(0)
            token.cancel()

        asyncio.get_running_loop().create_task(fire_soon())
        await asyncio.wait_for(token.wait(), timeout=1)

    asyncio.run(scenario())


def test_run_cancellable_delivers_the_result_when_the_work_wins():
    token = CancellationToken()

    async def work():
        return 42

    assert asyncio.run(run_cancellable(token, work())) == 42


def test_the_token_winning_cancels_the_in_flight_call_and_propagates_untouched():
    recorder: dict = {}
    token = CancellationToken()

    async def scenario():
        async def fire_when_running():
            while "started" not in recorder:
                await asyncio.sleep(0)
            token.cancel()

        asyncio.get_running_loop().create_task(fire_when_running())
        await run_cancellable(token, _never_completing(recorder))

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(scenario())
    # The cancellation REACHED the work: it was cancelled, not abandoned.
    assert recorder == {"started": True, "cancelled_in_flight": True}


def test_a_pre_cancelled_token_refuses_the_dispatch_before_the_work_starts():
    recorder: dict = {}
    token = CancellationToken()
    token.cancel()
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(run_cancellable(token, _never_completing(recorder)))
    assert recorder == {}  # the work never even started


def test_the_works_own_exception_propagates_unchanged():
    token = CancellationToken()

    async def work():
        raise ValueError("the model endpoint failed")

    with pytest.raises(ValueError, match="the model endpoint failed"):
        asyncio.run(run_cancellable(token, work()))


def test_the_caller_being_cancelled_cancels_the_in_flight_call_too():
    recorder: dict = {}
    token = CancellationToken()

    async def scenario():
        await run_cancellable(token, _never_completing(recorder))

    async def outer():
        task = asyncio.get_running_loop().create_task(scenario())
        while "started" not in recorder:
            await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(outer())
    assert recorder["cancelled_in_flight"] is True
