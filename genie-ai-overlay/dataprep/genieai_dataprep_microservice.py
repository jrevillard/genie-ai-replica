# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""
Custom Genie Dataprep Microservice

Extends the base OPEA Dataprep microservice with additional endpoints for
document repository ingestion and retraction, using ArangoDB as the backend.
"""

import asyncio
import base64
import hashlib
import importlib
import os
import time

import aiohttp

try:
    import fcntl  # POSIX file locking — the service runs in a Linux container
except ModuleNotFoundError:  # Windows dev checkout: locking degrades to a no-op
    fcntl = None  # type: ignore[assignment]

from opentelemetry.trace import Status, StatusCode

from tracing import (
    background_span,
    get_meter,
    get_tracer,
    install_uvicorn_access_logging,
    sanitize_attributes,
    setup_json_logging,
    setup_trace_logging,
    setup_tracing,
)

setup_tracing("genieai-dataprep")

# Custom application metrics
_dataprep_meter = get_meter()
_ingestion_requests = _dataprep_meter.create_counter(
    "rag.ingestion.requests",
    description="Total document ingestion requests",
)
_ingestion_duration = _dataprep_meter.create_histogram(
    "rag.ingestion.duration",
    description="Document ingestion duration",
    unit="s",
)

tracer = get_tracer(__name__)

# Register GenieArangoDataprep with OpeaComponentRegistry before loading the base
# OPEA module (which initializes its own loader at import time and expects the
# component to already be registered).
importlib.import_module("integrations.genieai_dataprep_arangodb")

# ruff: noqa: I001
# Import order matters here: the custom integration must be registered with
# OpeaComponentRegistry before importing the base OPEA module, which initializes
# its own loader at import time and expects the component to already be registered.
import opea_dataprep_microservice as base
from comps import (
    CustomLogger,
    ServiceType,
    register_microservice,
    register_statistics,
    statistics_dict,
)
from comps.cores.proto.genieai_api_protocol import ArangoDBDataprepRequestFromDocRepo
from core.model_http_policy import AIOHTTP_CONNECT_TIMEOUT_SECONDS, CONTROL_PLANE_TIMEOUT_SECONDS
from core.service_endpoints import DOCUMENT_REPOSITORY_URL
from fastapi import HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from genieai_dataprep_loader import GenieDataprepLoader
from keycloak_service_account import get_service_account_token

logger = CustomLogger("genie_dataprep_microservice")
setup_trace_logging("genie_dataprep_microservice")
setup_json_logging("genie_dataprep_microservice")
install_uvicorn_access_logging()
logflag = os.getenv("LOGFLAG", False)
upload_folder = "./uploaded_files/"
LOCK_FILE_PATH = "/tmp/genie_dataprep.lock"
# F-1 (#1021, spec §5.6): filesystems cap a single filename at 255 BYTES.
# Names whose UTF-8 encoding passes this threshold are hashed instead —
# 200 leaves ample margin for the extension and any filesystem overhead.
_UPLOAD_NAME_MAX_BYTES = 200


def _upload_save_name(file_name: str) -> str:
    """Filesystem-safe name for the temporary upload file.

    Long OKF concept ids overflow the 255-byte filename limit and made the
    ingest kick fail with OSError ENAMETOOLONG on every deterministic retry.
    Names over the byte threshold map to sha256(name)<ext> — stable per name
    (re-kicks overwrite the same temp file instead of littering), and the
    original extension is preserved for extension-based behavior. Identity
    fields (file_id, concept_id, file_name) are never derived from this; it
    names ONLY the temporary bytes vehicle, removed after ingest.
    """
    name_bytes = file_name.encode("utf-8")
    if len(name_bytes) <= _UPLOAD_NAME_MAX_BYTES:
        return file_name
    ext = os.path.splitext(file_name)[1] or ".md"
    return hashlib.sha256(name_bytes).hexdigest() + ext


# PARALLEL INGEST (David, 2026-09-03): number of concurrently accepted ingest
# requests. Each slot is its own flock file; a request takes any FREE slot and
# 429s only when ALL are busy. Default 1 = the historical single-flight
# (one lock file, same 429 behavior).
DATAPREP_INGEST_CONCURRENCY = max(1, int(os.getenv("DATAPREP_INGEST_CONCURRENCY", "1")))


def acquire_ingest_slot():
    """Try to claim one of the N ingest slots (non-blocking). Returns the
    open lock file (held by the caller until the ingest's finally-block
    releases it) or None when every slot is busy.

    All slot files derive from LOCK_FILE_PATH (slot 0 keeps the legacy name;
    slot i lives at `LOCK_FILE_PATH.i`) — tests redirect that single base to a
    per-test tmp dir, so slot files inherit the isolation instead of leaking
    across tests/workers through a hardcoded global path."""
    for i in range(DATAPREP_INGEST_CONCURRENCY):
        path = LOCK_FILE_PATH if i == 0 else f"{LOCK_FILE_PATH}.{i}"
        # O_NOFOLLOW + 0600 (main, 2026-10-24): the lock file lives in the
        # shared /tmp, so open it WITHOUT following a pre-planted symlink and
        # keep it private. O_NOFOLLOW is POSIX-only — a Windows dev checkout
        # has no fcntl either, and there the flag is simply absent.
        flags = os.O_WRONLY | os.O_CREAT
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        fd = os.open(path, flags, 0o600)
        lock_file = os.fdopen(fd, "w")  # noqa: SIM115 — held across the request task
        if fcntl is None:  # Windows dev checkout — single-process, no locking
            return lock_file
        try:
            fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return lock_file
        except OSError:
            lock_file.close()
    return None


dataprep_component_name = "GENIE_DATAPREP_ARANGODB"
# Initialize OpeaComponentLoader
loader = GenieDataprepLoader(
    dataprep_component_name,
    description=f"OPEA DATAPREP Component: {dataprep_component_name}",
)

# Global registry for running ingestion tasks to support specific "Kill" functionality
active_ingestion_tasks = {}

# ------------------------------------------------------------------------------
# Stuck-ingest startup recovery (#610)
# ------------------------------------------------------------------------------
# Bounded startup retry: compose/Swarm does not guarantee the doc-repo is
# listening when dataprep boots, so the recovery call is retried on a fixed
# cadence for ~5 minutes before giving up with a loud warning.
_RECOVERY_MAX_ATTEMPTS = 30
_RECOVERY_RETRY_SECONDS = 10


async def recover_stuck_ingest_statuses():
    """Release files the doc-repo still marks 'Ingesting' after a restart.

    ``active_ingestion_tasks`` dies with the process, so a dataprep restart
    orphans every in-flight ingest: the row stays 'Ingesting' forever, the UI
    disables the Ingest button and ``kill_ingest`` 404s. The recovery asks
    the doc-repo to release those rows back to 'Pending' for manual
    re-ingestion.

    What makes the release safe is the BOOT-TIME trigger plus the dead
    in-memory registry — not exclusive writers (doc-repo itself and the
    okf-server also write 'Ingesting'). The retry window can outlive the
    boot, so every attempt carries the ids whose task is STILL alive in
    this process at that moment as ``excludeFileIds``: a kick accepted
    while the recovery was retrying must not be released by a later
    attempt. Residual window: ids registered between an attempt's
    snapshot and the doc-repo's UPDATE — bounded by the ingest 409
    idempotency guard, and the live task writes its terminal status when
    it finishes regardless.

    Exhaustion is a loud warning, never an exception — the service must boot
    regardless. OKF surfaces are NOT covered: bundle-zip docs are excluded
    on the doc-repo side (okf-server owns their transition) and concepts
    have no doc-repo files doc at all — the okf-server worker reclaims
    timed-out concepts through the task_status probe window (spec #1020
    §5.9).

    Returns the list of released file ids ([] when nothing was recovered).
    """
    # Hold a strong reference to THIS task: the event loop only keeps weak
    # references to tasks, so an unreferenced one can be garbage-collected
    # during the 10 s retry sleeps (CPython asyncio docs) with no error
    # anywhere. Self-registering — whichever scheduler ran it (the comps
    # startup hook drops its own reference).
    task = asyncio.current_task()
    if task is not None:
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)
    # Post-request background work: the span keeps the [ recovery ] log lines
    # correlated in the trace store (overlay CLAUDE.md § Public tracing API).
    with background_span("dataprep.recovery"):
        url = f"{DOCUMENT_REPOSITORY_URL}/api/files/ingest/recover-stuck"
        headers = {}
        # One session across every retry attempt: a fresh ClientSession per
        # attempt builds and tears down a connector pool each time for nothing.
        async with aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(
                total=CONTROL_PLANE_TIMEOUT_SECONDS, sock_connect=AIOHTTP_CONNECT_TIMEOUT_SECONDS
            )
        ) as session:
            for attempt in range(1, _RECOVERY_MAX_ATTEMPTS + 1):
                try:
                    headers["Authorization"] = f"Bearer {await get_service_account_token()}"
                    # Snapshot the live set PER ATTEMPT: a task registered
                    # since the previous attempt is alive now, not orphaned.
                    exclude_file_ids = sorted(fid for fid, t in active_ingestion_tasks.items() if not t.done())
                    async with session.post(
                        url, json={"excludeFileIds": exclude_file_ids}, headers=headers
                    ) as response:
                        if response.status == 200:
                            payload = await response.json()
                            recovered = payload.get("recovered") or []
                            if recovered:
                                logger.info(
                                    f"[ recovery ] Released {len(recovered)} stuck ingest(s) back to "
                                    f"Pending: {recovered}"
                                )
                            else:
                                logger.info("[ recovery ] No stuck ingests found at startup.")
                            return recovered
                        logger.error(
                            f"[ recovery ] attempt {attempt}/{_RECOVERY_MAX_ATTEMPTS}: "
                            # Truncated: an nginx/HTML error page dumped 30× per
                            # restart would drown the [ recovery ] signal in
                            # the log stream (same 500-char bound the status
                            # callback uses for its error payloads).
                            f"HTTP {response.status}: {(await response.text())[:500]}"
                        )
                except asyncio.CancelledError:
                    # A cancellation is the event loop shutting down — not a
                    # transient failure. Retrying through it would fight the
                    # loop teardown.
                    raise
                except Exception as e:  # noqa: BLE001 — recovery must never kill the boot
                    logger.error(f"[ recovery ] attempt {attempt}/{_RECOVERY_MAX_ATTEMPTS} failed: {e}")
                if attempt < _RECOVERY_MAX_ATTEMPTS:
                    await asyncio.sleep(_RECOVERY_RETRY_SECONDS)
        logger.warning(
            f"[ recovery ] Giving up after {_RECOVERY_MAX_ATTEMPTS} attempts — files stuck in 'Ingesting' "
            "stay stuck until the next dataprep restart."
        )
        return []


# Strong references to the running recovery task (see the comment inside
# ``recover_stuck_ingest_statuses``).
_background_tasks: set = set()


def schedule_stuck_ingest_recovery(app):
    """Register the stuck-ingest recovery via the comps startup hook.

    ``HTTPService.add_startup_event`` is the framework-native hook — comps
    uses it itself for its dynamic-batch loop. It fires on the uvicorn
    lifespan startup, on the same loop that serves the request handlers.
    comps schedules the passed coroutine with ``asyncio.create_task`` and
    drops the reference; the recovery self-registers into
    ``_background_tasks`` on entry to survive GC (see the comment inside).
    No-op (with a warning) when the method is missing, so an upstream
    comps restructure degrades instead of crashing the boot.
    """
    add_startup_event = getattr(app, "add_startup_event", None)
    if add_startup_event is None:
        logger.warning("[ recovery ] No add_startup_event on the microservice — skipping stuck-ingest recovery.")
        return None
    # comps' add_startup_event hands its argument straight to
    # asyncio.create_task, so pass the INVOKED coroutine.
    add_startup_event(recover_stuck_ingest_statuses())
    return None


# ------------------------------------------------------------------------------
# Configuration Helpers
# ------------------------------------------------------------------------------
def get_chunk_size_for_file(filename: str) -> int:
    """
    Determines the optimal chunk size based on file extension and environment overrides.
    Falls back to the global DATAPREP_CHUNK_SIZE if no specific override is found.
    """
    global_default = int(os.getenv("DATAPREP_CHUNK_SIZE", 500))
    _, ext = os.path.splitext(filename)
    ext = ext.lower()

    # Mapping of extensions to specific environment variable overrides
    # If the specific env var is not set, it defaults to the global_default
    config_map = {
        ".pdf": int(os.getenv("DATAPREP_CHUNK_SIZE_PDF", global_default)),
        ".docx": int(os.getenv("DATAPREP_CHUNK_SIZE_DOCX", global_default)),
        ".xlsx": int(os.getenv("DATAPREP_CHUNK_SIZE_XLSX", global_default)),
        ".pptx": int(os.getenv("DATAPREP_CHUNK_SIZE_PPTX", global_default)),
        ".html": int(os.getenv("DATAPREP_CHUNK_SIZE_HTML", global_default)),
        ".txt": int(os.getenv("DATAPREP_CHUNK_SIZE_TXT", global_default)),
        ".md": int(os.getenv("DATAPREP_CHUNK_SIZE_MD", global_default)),
    }

    size = config_map.get(ext, global_default)
    logger.info(f"[ config ] Resolved chunk size for '{filename}' ({ext}): {size}")
    return size


# ------------------------------------------------------------------------------
# Custom request payload models
# ------------------------------------------------------------------------------
class DocRepoIngestPayload(BaseModel):
    fileId: str
    fileName: str
    fileBase64: str
    fileType: str
    fileLabels: list[str] | None = None
    storagePath: str | None = None
    # Per-request chunk_overlap override; falls back to env var DATAPREP_CHUNK_OVERLAP when None.
    chunkOverlap: int | None = None
    # OKF per-repo graph (Story 2.9.6): OKF_{repo_id}. Absent/None → the env
    # default (ARANGO_GRAPH_NAME) — the legacy single-graph behavior is unchanged.
    graphName: str | None = None
    # OKF minted repo version (Story 2.9.7, ADR-031): stamped onto every chunk
    # doc so citations can pin (repo_id, bundle_version, concept_id).
    # Absent/None → chunks carry no version (legacy behavior unchanged).
    bundleVersion: int | None = None
    # OKF concept id (Story 4.8-amend, 2026-08-19): content-only chunking — when
    # set, chunks are stamped with this citation field AND the completion status
    # callback routes to the OKF Server (no doc-repo files doc exists for a
    # concept). Absent/None → legacy single-file behavior (doc-repo callback).
    conceptId: str | None = None
    # OKF repo id (David, 2026-08-31): the EXPLICIT completion-callback
    # identity. Born-right graph names carry repo NAME+VERSION — a graph name
    # is not an identity field, so it must never be parsed for one. Absent →
    # legacy graph-name-parse fallback.
    repoId: str | None = None


class DocRepoRetractPayload(BaseModel):
    fileId: str
    # Target graph for the retract (OKF_{repo_id}); None → env default. Retract
    # MUST hit the graph the file was ingested into (G5: wrong-graph retract).
    graphName: str | None = None


# ------------------------------------------------------------------------------
# Ingest file from document repository
# ------------------------------------------------------------------------------
@register_microservice(
    name="opea_service@dataprep",
    service_type=ServiceType.DATAPREP,
    endpoint="/v1/dataprep/ingest_file",
    host="0.0.0.0",
    port=5000,
)
@register_statistics(names=["opea_service@dataprep"])
async def ingest_file_from_repo(payload: DocRepoIngestPayload):
    """
    Accepts JSON and starts a tracked background task for ingestion.
    """
    start = time.time()
    logger.info(f"[ ingest ] Request received for file_id: {payload.fileId}")

    with tracer.start_as_current_span("dataprep.ingest") as span:
        span.set_attribute("dataprep.file_type", payload.fileType)
        span.set_attribute("dataprep.file_size_bytes", len(payload.fileBase64))
        span.set_attribute("dataprep.file_id", payload.fileId)

        # --- Request validation, before the lock: a rejection here must not
        # have to release anything.
        if (
            os.path.basename(payload.fileName) != payload.fileName
            or payload.fileName in ("", ".", "..")
            or "\x00" in payload.fileName
        ):
            raise HTTPException(
                status_code=400,
                detail=f"fileName must be a bare file name, got {payload.fileName!r}",
            )
        CHUNK_SIZE = get_chunk_size_for_file(payload.fileName)
        # Per-request chunkOverlap wins over env; env wins over hardcoded default.
        CHUNK_OVERLAP = payload.chunkOverlap
        if CHUNK_OVERLAP is None:
            CHUNK_OVERLAP = int(os.getenv("DATAPREP_CHUNK_OVERLAP", 50))
        # Reject negatives: RecursiveCharacterTextSplitter treats them as >=chunk_size
        # (no splitting happens). Caller-side Joi already constrains the batch path;
        # this is a defense-in-depth guard for the single-ingest endpoint.
        if CHUNK_OVERLAP < 0:
            raise HTTPException(
                status_code=400,
                detail=f"chunkOverlap must be >= 0, got {CHUNK_OVERLAP}",
            )

        # --- Environment-specific Arango config, still pre-lock: a malformed
        # env value (int() on ARANGO_BATCH_SIZE, for one) must fail before
        # there is a lock to release.
        ARANGO_GRAPH_NAME = os.getenv("ARANGO_GRAPH_NAME", "GRAPH")
        ARANGO_INSERT_ASYNC = os.getenv("ARANGO_INSERT_ASYNC", "false").lower() == "true"
        ARANGO_BATCH_SIZE = int(os.getenv("ARANGO_BATCH_SIZE", 1000))
        ALLOWED_NODE_TYPES = os.getenv("ALLOWED_NODE_TYPES", "").split(",") if os.getenv("ALLOWED_NODE_TYPES") else []
        ALLOWED_EDGE_TYPES = os.getenv("ALLOWED_EDGE_TYPES", "").split(",") if os.getenv("ALLOWED_EDGE_TYPES") else []
        NODE_PROPERTIES = os.getenv("NODE_PROPERTIES", "description").split(",")
        EDGE_PROPERTIES = os.getenv("EDGE_PROPERTIES", "description").split(",")
        TEXT_CAPITALIZATION_STRATEGY = os.getenv("TEXT_CAPITALIZATION_STRATEGY", "upper")
        INCLUDE_CHUNKS = os.getenv("INCLUDE_CHUNKS", "true").lower() == "true"

        # --- SYNCHRONOUS SLOT CHECK ---
        # We acquire an ingest slot HERE to return 429 immediately when all
        # slots are busy (PARALLEL INGEST: DATAPREP_INGEST_CONCURRENCY slots,
        # default 1 = the historical single-flight).
        # The slot file is opened O_NOFOLLOW + 0600 (the lock lives in the
        # shared /tmp: do not follow a pre-planted symlink, keep it private).
        lock_file = acquire_ingest_slot()
        if lock_file is None:
            logger.warning(
                f"[ ingest ] Rejected file_id {payload.fileId}: System busy "
                f"({DATAPREP_INGEST_CONCURRENCY} slot(s) all in use)."
            )
            raise HTTPException(
                status_code=429,
                detail=(
                    "System is currently processing other documents. "
                    f"All {DATAPREP_INGEST_CONCURRENCY} ingestion slot(s) are in use."
                ),
            )

        # SLOT-LIFETIME DEFENSE (David, 2026-09-15): the slot FD is passed to
        # the background task which owns it via a `finally:` in
        # `ingest_file_with_guardrail`. Live-captured: 6 of 6 slots stayed
        # flock-held for 7 hours after the worker stopped dispatching,
        # blocking every subsequent ingest with 429 — root cause was tasks
        # created by `asyncio.create_task` that were canceled or never
        # reached their finally blocks. Hold a strong-ref to the FD and
        # assert ownership via a wrapper that explicitly checks the lock is
        # not still held by the time the request returns to the FastAPI
        # event loop. If the task completes BEFORE we return 200, release
        # proactively. This is a release guard, not a replacement for the
        # task-level finally (that still owns the canonical release).
        _slot_owner_task = []  # filled in when create_task runs

        def _release_slot_if_orphan():
            """If the background task hasn't claimed the slot (or finished
            already), release the lock FD synchronously so it doesn't leak.
            Live: a task created by asyncio.create_task may be cancelled
            before it ever reaches its finally block; the slot would then
            stay locked for the lifetime of the Python process."""
            try:
                if lock_file is None:
                    return
                # If the task is still alive and owns the slot, leave it.
                if _slot_owner_task and not _slot_owner_task[0].done():
                    return
                if fcntl is not None:  # Windows dev checkout: no-op
                    fcntl.flock(lock_file, fcntl.LOCK_UN)
                lock_file.close()
                logger.info("[ ingest ] Released slot FD synchronously — task never claimed or already done")
            except Exception as e:  # noqa: BLE001 — last-resort cleanup
                logger.warning(f"[ ingest ] slot-FD synchronous release failed: {e}")

        save_path = None
        task = None
        try:
            # Decode and temporarily save file
            file_bytes = base64.b64decode(payload.fileBase64)
            # F-1 (#1021, spec §5.6): OKF concept ids can exceed the
            # filesystem's 255-byte filename limit — the kick then failed with
            # OSError ENAMETOOLONG on EVERY attempt (live 2026-09-26: 230-char
            # UK consultation concepts dead-lettered after 8 deterministic
            # failures). Map over-long upload names to sha256(name).ext. The
            # path is a temporary vehicle for the bytes only — identity
            # (file_id / concept_id / file_name for logs) is untouched, and
            # the file is removed after ingest.
            save_path = os.path.join(upload_folder, _upload_save_name(payload.fileName))
            # OKF concept file names can carry folder structure (a zip import
            # preserves the bundle's internal directories, e.g.
            # "kenya-okf/concepts/ecitizen-digital-payments.md"). The save path
            # must be guaranteed to exist — open() does NOT create intermediate
            # directories and a missing one crashed the ingest with
            # FileNotFoundError, leaving the concept stuck in the okf-server's
            # 'parsed' queue forever (live-caught 2026-08-30).
            os.makedirs(os.path.dirname(save_path) or upload_folder, exist_ok=True)
            with open(save_path, "wb") as f:
                f.write(file_bytes)
            logger.info(f"[ ingest ] File saved to: {save_path}")

            # Construct Arango-specific dataprep request
            input_req = ArangoDBDataprepRequestFromDocRepo(
                file_id=payload.fileId,
                file_name=payload.fileName,
                file_path=save_path,
                file_type=payload.fileType,
                file_labels=payload.fileLabels,
                # Story 2.9.6 (G5): honor the per-repo graph from the request;
                # fall back to the env default when absent (legacy behavior).
                graph_name=payload.graphName or ARANGO_GRAPH_NAME,
                # Story 2.9.7: the minted version rides through to chunk docs.
                bundle_version=payload.bundleVersion,
                # Story 4.8-amend: the OKF concept id rides through to chunk docs
                # (citation provenance) + routes the completion callback.
                concept_id=payload.conceptId,
                # David (2026-08-31): the EXPLICIT repo id for the completion
                # callback — born-right graph names carry name+version, so
                # identity must not be parsed out of them.
                repo_id=getattr(payload, "repoId", None),
                # Story 4.8-amend follow-up: concept's source filename mirrors
                # into the bundle zip's ingestion log so the bundle's UI
                # Ingestion Log tab can trace each entry to its concept file.
                # (file_name is already in the parent payload — the docs
                # repo's addIngestionLog file_id-keyed POST keys on it.)
                # The ArangoDBDataprepRequest class sets it on the instance
                # via the super().__init__() chain.
                insert_async=ARANGO_INSERT_ASYNC,
                insert_batch_size=ARANGO_BATCH_SIZE,
                embed_nodes=True,
                embed_edges=True,
                embed_chunks=True,
                allowed_node_types=ALLOWED_NODE_TYPES,
                allowed_edge_types=ALLOWED_EDGE_TYPES,
                node_properties=NODE_PROPERTIES,
                edge_properties=EDGE_PROPERTIES,
                text_capitalization_strategy=TEXT_CAPITALIZATION_STRATEGY,
                include_chunks=INCLUDE_CHUNKS,
                # --- FIX: Pass Dynamic Chunking Configuration ---
                chunk_size=CHUNK_SIZE,
                chunk_overlap=CHUNK_OVERLAP,
            )

            # IDEMPOTENCY GUARD (review 2026-10-15): refuse a second ingest while a
            # task for the SAME fileId is still running. Overwriting the registry
            # entry orphaned the first task — untouchable, unkillable, its writes
            # racing the new run and its generic-Exception auto-retract able to
            # delete the NEW run's chunks after it reported Ingested. The worker's
            # liveness probe makes this rare; this makes it harmless (409, the
            # worker's existing backoff handles it).
            _existing = active_ingestion_tasks.get(payload.fileId)
            if _existing is not None and not _existing.done():
                logger.warning(f"Rejecting ingest for {payload.fileId}: a task is already in flight (409)")
                return JSONResponse(
                    status_code=409,
                    content={"detail": f"An ingest task for fileId '{payload.fileId}' is already running"},
                )

            # Metrics first (main, 2026-10-24): once the task exists it owns
            # the lock and the file, so a failure in this tail must not report
            # an ingestion that then starts anyway.
            statistics_dict["opea_service@dataprep"].append_latency(time.time() - start, None)
            _ing_latency = time.time() - start
            _file_type = payload.fileType
            _ing_attrs = sanitize_attributes({"dataprep.file_type": _file_type, "error": "false"})
            _ingestion_requests.add(1, _ing_attrs)
            _ingestion_duration.record(_ing_latency, _ing_attrs)

            # --- Trigger Tracked Background Task ---
            # We use asyncio.create_task to maintain a reference for the "Kill" functionality.
            task = asyncio.create_task(loader.ingest_file_with_guardrail(input_req, lock_file=lock_file))
            _slot_owner_task.append(task)  # register for the synchronous-release guard
            active_ingestion_tasks[payload.fileId] = task

            # Ensure the task is removed from the registry upon completion (success or failure).
            # REVIEW FIX #11 (#1020): pop only if the registry STILL points at THIS
            # task — a re-kick overwrites the entry with a newer task, and the OLD
            # task's completion callback would otherwise delete the NEW task's
            # registration (task_status then reports dead for a live task, and the
            # OKF worker's probe-defer logic retracts running work; kill_ingest
            # would 404 or cancel the wrong task).
            task.add_done_callback(
                lambda t, _fid=payload.fileId, _me=task: (
                    active_ingestion_tasks.pop(_fid) if active_ingestion_tasks.get(_fid) is _me else None
                )
            )

            # SLOT-LIFETIME GUARD: by the time we reach this point, the
            # task has been created. If the asyncio.create_task ran but the
            # task is already done (synchronous error in the task's
            # creation path), release the slot synchronously. The task's
            # own finally will no-op because the FD is already closed.
            _release_slot_if_orphan()

            return {"success": True, "status": 200, "message": "Ingestion started in background."}

        except Exception as e:
            # Record error metric
            _err_latency = time.time() - start
            _err_attrs = sanitize_attributes({"dataprep.file_type": payload.fileType, "error": "true"})
            _ingestion_requests.add(1, _err_attrs)
            _ingestion_duration.record(_err_latency, _err_attrs)
            span.record_exception(e)
            span.set_status(Status(StatusCode.ERROR, str(e)))
            logger.error(f"Error initiating dataprep ingest: {e}")
            raise
        finally:
            # Release the lock and the decoded file only when the background
            # task has not picked them up: once created, the task owns both
            # and unlocks on completion. The finally (not the except) does
            # this, so a cancellation or interpreter exit in the window
            # cannot leave the flock held by this process.
            if task is None:
                # Each step is guarded: a failure here must not mask the
                # original exception, and the temp file must still be
                # reclaimed if the unlock misbehaves.
                try:
                    if fcntl is not None:  # Windows dev checkout: no-op
                        fcntl.flock(lock_file, fcntl.LOCK_UN)
                    lock_file.close()
                except OSError:
                    logger.exception("Failed to release the ingestion lock")
                if save_path and os.path.exists(save_path):
                    try:
                        os.remove(save_path)
                    except OSError:
                        logger.exception("Failed to remove %s", save_path)


# ------------------------------------------------------------------------------
# Kill Ingestion Task
# ------------------------------------------------------------------------------
@register_microservice(
    name="opea_service@dataprep",
    service_type=ServiceType.DATAPREP,
    endpoint="/v1/dataprep/kill_ingest",
    host="0.0.0.0",
    port=5000,
)
async def kill_ingest_task(payload: DocRepoRetractPayload):
    """
    Cancels a specific running ingestion task.
    The task cancellation will trigger the rollback logic in the component.
    """
    file_id = payload.fileId
    logger.info(f"[ kill ] Attempting to kill ingestion task for file_id: {file_id}")

    with tracer.start_as_current_span("dataprep.kill_ingest") as span:
        span.set_attribute("dataprep.file_id", file_id)

        if file_id in active_ingestion_tasks:
            task = active_ingestion_tasks[file_id]
            task.cancel()
            span.set_attribute("dataprep.kill_result", "cancelled")
            return {"success": True, "status": 200, "message": f"Kill signal sent to ingestion task for {file_id}."}

        span.set_attribute("dataprep.kill_result", "not_found")
        logger.warning(f"[ kill ] No active ingestion task found for file_id: {file_id}")
        return {"success": False, "status": 404, "message": "No active ingestion task found for this file."}


# ------------------------------------------------------------------------------
# Ingestion task liveness probe (spec #1020 §5.9 — size-adaptive job windows)
# ------------------------------------------------------------------------------
@register_microservice(
    name="opea_service@dataprep",
    service_type=ServiceType.DATAPREP,
    endpoint="/v1/dataprep/task_status",
    host="0.0.0.0",
    port=5000,
)
async def ingestion_task_status(payload: DocRepoRetractPayload):
    """
    Reports whether an ingestion task is ACTIVELY running for this fileId.
    The OKF worker's window expiry (§5.9) probes this before touching a
    timed-out concept: alive → the worker defers (parks the row, never
    re-kicks) because a re-kick would retract and destroy the in-flight
    work; dead/unknown → the reclaim + retract is safe.
    """
    file_id = payload.fileId
    task = active_ingestion_tasks.get(file_id)
    alive = task is not None and not task.done()
    logger.info(f"[ task_status ] file_id={file_id} alive={alive}")
    return {"success": True, "status": 200, "fileId": file_id, "alive": alive}


# ------------------------------------------------------------------------------
# Retract (delete) a file from graph
# ------------------------------------------------------------------------------
@register_microservice(
    name="opea_service@dataprep",
    service_type=ServiceType.DATAPREP,
    endpoint="/v1/dataprep/retract_file",
    host="0.0.0.0",
    port=5000,
)
@register_statistics(names=["opea_service@dataprep"])
async def retract_file(payload: DocRepoRetractPayload):
    """Deletes a file and its entities/relations from the graph."""
    start = time.time()
    file_id = payload.fileId
    # Unified fallback (G5 fix): the ingest default is GRAPH — retract used a
    # divergent 'genie_graph' default, silently retracting NOTHING for files in
    # the default graph. Payload graphName (the file's actual graph) wins.
    graph_name = payload.graphName or os.getenv("ARANGO_GRAPH_NAME", "GRAPH")

    logger.info(f"[ retract ] Start to delete ingested file {file_id}")

    with tracer.start_as_current_span("dataprep.retract") as span:
        span.set_attribute("dataprep.file_id", file_id)

        try:
            response = await loader.retract_file(file_id=file_id, graph_name=graph_name)

            # Ensure success flag for Node.js controller consistency
            if isinstance(response, dict):
                if response.get("status") == 200:
                    response["success"] = True
                elif "success" not in response:
                    response["success"] = False

            if logflag:
                logger.debug(f"[ retract ] retracted result: {response}")
            statistics_dict["opea_service@dataprep"].append_latency(time.time() - start, None)
            return response

        except Exception as e:
            span.record_exception(e)
            span.set_status(Status(StatusCode.ERROR, str(e)))
            logger.error(f"Error during dataprep retract invocation: {e}")
            raise


# ------------------------------------------------------------------------------
# Launch microservice
# ------------------------------------------------------------------------------
if __name__ == "__main__":
    logger.info("GENIE Dataprep Microservice is starting...")
    base.create_upload_folder(upload_folder)
    app = base.opea_microservices["opea_service@dataprep"]

    # FastAPI auto-instrumentation is handled globally by tracing.py
    # setup_tracing() → FastAPIInstrumentor().instrument() runs before
    # OPEA comps creates the FastAPI app, so traceparent extraction works.

    schedule_stuck_ingest_recovery(app)

    app.start()
