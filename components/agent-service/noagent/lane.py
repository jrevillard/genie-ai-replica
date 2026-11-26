# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The admission lane's port: the slot the run holds, and the refusal.

The pool itself takes file locks on the host filesystem, so its
implementation is host infrastructure (``lane.py`` at the service root). What
the core needs is the shape it exchanges — one slot for the duration of the
run — and the typed refusal it answers.
"""

from contextlib import AbstractAsyncContextManager
from typing import Protocol


class LaneBusyError(RuntimeError):
    """Every lane slot is held; the run is refused before any stage runs.

    A typed refusal, not an exception-shaped retry hint: the caller answers
    saturation (deployed shape: the 429 the dataprep lane answers), never
    queues. ``asyncio.CancelledError`` never becomes one — it is a
    ``BaseException`` and the acquisition does not catch it.
    """


class Lane(Protocol):
    """One slot for the duration of the block; a refusal when none is free."""

    def acquire(self) -> AbstractAsyncContextManager[None]: ...
