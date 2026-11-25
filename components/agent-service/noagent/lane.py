# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The admission lane — the flock slot-pool idiom.

Ported from the dataprep ingest-lane
(``genieai_dataprep_microservice.py:118-147``): N slot files derived from one
base path (slot 0 keeps the base name; slot i lives at ``<base>.i``), each
opened ``O_WRONLY | O_CREAT`` with ``O_NOFOLLOW`` and mode 0600, locked
non-blocking exclusive. A run claims any FREE slot; when every slot is held
the run is REFUSED with the typed :class:`LaneBusyError` BEFORE any stage
runs — refusal, never queueing.

The lock file handle is the slot: it travels with the acquisition and its
close releases the kernel lock on every exit path — return, exception and
cancellation alike (the handle is closed in ``finally``, and a cancellation
delivered while the slot is being claimed releases it too).

The deployment contract runs agent-service at exactly one
replica (flag-gated 0/1), so this intra-container pool IS the global bound;
scaling beyond one replica requires an explicitly shared coordination
mechanism (deferred). ``fcntl`` is POSIX-only: on a checkout
without it (Windows dev) the pool degrades to uncounted slots — the dev
host runs no serving traffic.
"""

import logging
import os
import threading
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import anyio

from .config import NoAgentConfig

logger = logging.getLogger(__name__)


class _SlotClaim:
    """The slot handle a claiming thread hands over to its acquisition.

    The handle is the slot: whoever holds it holds the kernel lock, and the
    lock is released only when the handle is closed. A cancellation can
    arrive while the claiming thread is still working, so the ownership
    moves in one step — the thread registers the handle it claimed, and the
    acquisition closes it. A handle registered after the acquisition gave
    up is closed by the thread itself: a cancelled acquisition never leaves
    a slot locked.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._handle = None
        self._given_up = False

    def register(self, handle) -> bool:
        """Take ownership of a claimed handle; False when the acquisition
        already gave up (the caller closes the handle itself then)."""
        with self._lock:
            if self._given_up:
                return False
            self._handle = handle
            return True

    def release(self) -> None:
        """Close the claimed handle and refuse any later registration."""
        with self._lock:
            self._given_up = True
            handle, self._handle = self._handle, None
        if handle is not None:
            handle.close()


class LaneBusyError(RuntimeError):
    """Every lane slot is held; the run is refused before any stage runs.

    A typed refusal, not an exception-shaped retry hint: the caller answers
    saturation (deployed shape: the 429 the dataprep lane answers), never
    queues. ``asyncio.CancelledError`` never becomes one — it is a
    ``BaseException`` and the acquisition below does not catch it.
    """


class AdmissionLane:
    """The N-slot admission pool every pipeline run passes through.

    The slot files live under the configured ``AGENT_LANE_LOCK_PATH`` base so
    a deployment can move them off the shared ``/tmp``; the tests redirect
    the base to a per-test directory, exactly like the dataprep lane.
    """

    def __init__(self, slots: int, lock_path: str):
        if slots < 1:
            raise ValueError("the lane needs at least one slot")
        self._slots = slots
        self._lock_path = lock_path

    @classmethod
    def from_config(cls, config: NoAgentConfig) -> "AdmissionLane":
        return cls(config.lane_slots, config.lane_lock_path)

    def _slot_path(self, index: int) -> str:
        return self._lock_path if index == 0 else f"{self._lock_path}.{index}"

    def _try_claim(self, index: int):
        """Open and non-blocking-lock one slot file, or None when held.

        ``O_NOFOLLOW`` keeps a pre-planted symlink in the shared lock
        directory from being followed; ``0600`` keeps the file private
        (the dataprep lane's hardening, kept verbatim).
        """
        path = self._slot_path(index)
        flags = os.O_WRONLY | os.O_CREAT
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        fd = os.open(path, flags, 0o600)
        lock_file = os.fdopen(fd, "w")
        try:
            import fcntl

            fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except ImportError:
            # No fcntl on this host (non-POSIX dev checkout): the handle is
            # the slot, single-process — return it uncounted.
            return lock_file
        except OSError:
            lock_file.close()
            return None
        except BaseException:
            # Never leak an open handle past a cancellation or any other
            # BaseException raised by the locking call itself.
            lock_file.close()
            raise
        return lock_file

    @asynccontextmanager
    async def acquire(self) -> AsyncIterator[None]:
        """Claim one slot for the duration of the block.

        Busy slots are skipped without blocking; the scan runs on the
        executor's thread pool (one ``os.open`` + ``flock`` per slot) so the
        event loop never stalls on the filesystem. When every slot is held
        the run raises :class:`LaneBusyError` — before any stage of the run
        has started. ``asyncio.CancelledError`` raised while waiting for the
        thread propagates untouched, and the slot the thread claimed on the
        way out is released with it.
        """
        claim = _SlotClaim()
        try:
            lock_file = await anyio.to_thread.run_sync(self._scan_for_free_slot, claim)
        except BaseException:
            # The acquisition gave up before the scan answered: whatever the
            # thread claimed is released here (or by the thread itself, if
            # it claims after this point) — a cancelled acquisition never
            # leaves a slot locked.
            claim.release()
            raise
        if lock_file is None:
            raise LaneBusyError(
                f"the admission lane is saturated: all {self._slots} slots are held; the run is refused"
            )
        try:
            yield
        finally:
            # The close releases the flock AND removes our fd — on return,
            # exception and cancellation alike.
            claim.release()

    def _scan_for_free_slot(self, claim: _SlotClaim):
        """One non-blocking pass over the slots; the open handle or None."""
        for index in range(self._slots):
            lock_file = self._try_claim(index)
            if lock_file is not None:
                if not claim.register(lock_file):
                    # The acquisition gave up while the scan ran: the slot
                    # must not stay locked.
                    lock_file.close()
                    return None
                return lock_file
        return None
