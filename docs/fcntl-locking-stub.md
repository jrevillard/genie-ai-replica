# `fcntl` ingest slot locking — mechanism, stub, and failure modes

Audience: developers and reviewers touching the dataprep ingest path, the
`typings/fcntl.pyi` stub, or anything that changes ingest concurrency.
Owner: the OKF / dataprep maintainers. Created 2026-10-30 (review of !597/!622).

## What `fcntl` does here

`genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py` and
`genieai_dataprep_microservice.py` import the **Unix-only** `fcntl` stdlib
module to take advisory file locks (`fcntl.flock`) on ingest slot files. This
is the **slot pool** behind `DATAPREP_INGEST_CONCURRENCY`: each concurrent
ingest slot is a lock file; a worker that cannot `flock(LOCK_EX | LOCK_NB)` a
slot backs off and dataprep answers **429** (slot busy) instead of queueing
unboundedly. The whole capacity model documented in
`CLAUDE.md` § *Import capacity* and `.claude/rules/CAPACITY-SIZING.md`
assumes this lock semantics.

## Why `typings/fcntl.pyi` exists

The overlay code **only ever executes inside Linux containers** — but the
repository is checked out and edited on Windows machines too. `fcntl` does not
exist on Windows, so Pylance/Pyright marks every importing file error-level
red, drowning real diagnostics. `typings/fcntl.pyi` is a **type-only stub**:
it declares `LOCK_EX`, `LOCK_NB`, `LOCK_SH`, `LOCK_UN` and the two locking
functions so the language server resolves the import analytically.

- **Zero runtime effect.** Pylance stubs are never executed. Linux resolves
  `import fcntl` to the real stdlib module; the stub is not even packaged
  (nothing in `pyproject.toml` or the Dockerfiles references `typings/`).
- CI does not read it. Ruff/mypy are not configured to consume it today.

**Can it be removed?** Functionally yes; practically no — removal restores the
error-red overlay in every Windows editor for no build or runtime gain. If a
future lint config starts type-checking, extend the stub rather than deleting
it.

## Lock semantics and failure modes (the vulnerability surface)

Advisory `flock` locks are only as strong as the discipline around them. The
known failure modes, in descending severity:

1. **All writers must cooperate.** `flock` is advisory: a process that does
   not attempt the lock ignores it entirely. Any new ingest entry point MUST
   take the slot lock before touching shared ingest state — a bypass path
   silently voids `DATAPREP_INGEST_CONCURRENCY` and can overload the shared
   LLM/embedding services the caps exist to protect.
2. **Locks are per-kernel, not per-cluster.** The slot pool serialises
   processes on ONE host. In a multi-node swarm, dataprep replicas on
   different nodes do NOT exclude each other through `flock` — cross-node
   capacity is governed by `DATAPREP_INGEST_CONCURRENCY` × replica count, and
   the 429 path must stay the cross-node backpressure (see the sizing rules —
   the drain pair is bounded by the model services, not the host).
3. **Stale lock files are safe; stale lock HOLDERS are not.** The lock lives
   on an open file descriptor: a crashed worker releases it at process exit
   (the OS closes the fds), so a leftover slot *file* is harmless. But a
   wedged (alive, stuck) worker keeps holding its slot — the 6-hour lane-stall
   risk documented in the ingest sizing notes. Monitor slot hold times, do
   not just count files.
4. **NFS/network filesystems break `flock`.** The slot files must stay on a
   local filesystem. On NFS without proper lock daemon support, `flock` can
   silently degrade to a no-op — every worker "acquires" the slot and the
   concurrency cap disappears. Keep the slot directory on the container's
   local storage.
5. **Blocking acquisitions can deadlock.** The ingest path uses
   `LOCK_NB` (fail-fast → 429). Any future code taking a *blocking* lock in
   the ingest path turns slot contention into a hang — keep the non-blocking
   contract.

## Review checklist for changes here

- New ingest entry point? It must attempt the slot lock (`LOCK_EX | LOCK_NB`)
  and answer 429 on failure — same as the existing path.
- Changed the slot-file location? Confirm it is local storage, not a share.
- Changed concurrency defaults? Re-read the capacity-sizing rules — the
  defaults are a floor, not a recommendation, and the pairs move together.
- Windows red squiggles returning? Extend `typings/fcntl.pyi`; never replace
  the container-side `import fcntl` with a platform-conditional shim — the
  locking must stay identical in the environment that actually runs it.
