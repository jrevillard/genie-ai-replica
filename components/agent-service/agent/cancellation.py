# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The cancellation hook — the agent-side end of the cancellation chain.

Two primitives, one discipline:

* :meth:`CancellationToken.raise_if_cancelled` is the pre-dispatch check the
  loop runs before every dispatch — a cancelled run stops dispatching.
* :func:`run_cancellable` is the in-flight guard: it races the work against
  the token, and when the token wins it CANCELS the work — the cancellation
  reaches into the in-flight model call (or tool call), not just the loop's
  dispatch sites.

``asyncio.CancelledError`` is never mapped to a result, a failure or an
insufficiency: it is a ``BaseException`` and a cancelled run's outcome is
"stopped". The one sanctioned swallow is the reap in :func:`cancel_and_join`
— a cancelled task is joined there and its OWN death absorbed, so a caller
that ends on a cancellation path ends only when its in-flight work has truly
stopped; the CALLER's own cancellation propagates untouched. The terminal
event is withheld on the cancelled path too — there is no honest terminal
state to emit for a run whose outcome is "stopped".
"""

import asyncio
from collections.abc import Coroutine
from contextlib import suppress
from typing import Any, TypeVar

T = TypeVar("T")


class CancellationToken:
    """One run's cancellation signal.

    The token is cooperative: whoever owns the run's lifecycle (the request
    orchestrator, the probe harness, a test) holds it and fires
    :meth:`cancel`; the loop checks it before every dispatch and races it
    against every in-flight call through :func:`run_cancellable`.
    """

    def __init__(self) -> None:
        self._event = asyncio.Event()

    def cancel(self) -> None:
        """Fire the token. Idempotent; safe from any task."""
        self._event.set()

    @property
    def cancelled(self) -> bool:
        return self._event.is_set()

    async def wait(self) -> None:
        """Block until the token fires."""
        await self._event.wait()

    def raise_if_cancelled(self) -> None:
        """The pre-dispatch check: raise when the run is already cancelled."""
        if self._event.is_set():
            raise asyncio.CancelledError()


async def cancel_and_join(task: asyncio.Task) -> None:
    """Cancel ``task`` and hold until its unwinding COMPLETES.

    Cancelling only schedules; a caller that ends beside a cancelled task
    that is still unwinding ends beside work that is still in flight. The
    join is what turns "cancelled" into "terminated": this coroutine
    returns only when the task has finished unwinding, and the task's own
    ``CancelledError`` is absorbed there — it is the task's death being
    reaped, never the caller's cancellation being handled. The caller's
    cancellation, when one is already unwinding through the caller's
    frame, keeps propagating after this returns; a cancellation DELIVERED
    while suspended inside the join is absorbed too.
    """
    if task.done():
        return
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


async def run_cancellable(token: CancellationToken, work: Coroutine[Any, Any, T]) -> T:
    """Run ``work`` cancellably: the token racing it cancels the work itself.

    The work runs in its own task so the token can reach it mid-flight;
    when the token wins the race the task is cancelled and its
    ``CancelledError`` propagates untouched — the await is what re-raises
    it, so nothing here converts a cancellation into a result or a failure.
    A work that finishes first wins: its result (or its own exception)
    answers, and the caller's next pre-dispatch check bounds what comes
    after. On every other exit path — including the caller of this
    coroutine itself being cancelled — the in-flight task is cancelled and
    joined (:func:`cancel_and_join`), so no model call outlives the run
    that asked for it.
    """
    if token.cancelled:
        # Refuse BEFORE any resolution — and close the coroutine that will
        # never run, so the caller's task list carries no dangling work.
        work.close()
        token.raise_if_cancelled()
    task: asyncio.Task = asyncio.ensure_future(work)
    fired: asyncio.Task = asyncio.ensure_future(token.wait())
    try:
        done, _ = await asyncio.wait({task, fired}, return_when=asyncio.FIRST_COMPLETED)
        if task in done:
            # The work won the race (or both finished together — a result
            # that already exists is honest to deliver; the loop's next
            # pre-dispatch check honors the token from here on).
            return task.result()
        # The token won: cancel the in-flight call. Awaiting the cancelled
        # task re-raises its CancelledError — untouched.
        task.cancel()
        return await task
    finally:
        fired.cancel()
        # The join covers the in-flight call's whole teardown: this exit
        # path runs while the caller's cancellation is already unwinding,
        # and the CancelledError may propagate only once the cancelled
        # work has truly stopped.
        await cancel_and_join(task)
