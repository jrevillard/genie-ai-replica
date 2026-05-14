# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""
Custom Genie Dataprep Microservice

Extends the base OPEA Dataprep microservice with additional endpoints for
document repository ingestion and retraction, using ArangoDB as the backend.
"""

import asyncio
import base64
import fcntl
import importlib
import os
import time

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
from fastapi import HTTPException
from pydantic import BaseModel

from genieai_dataprep_loader import GenieDataprepLoader

logger = CustomLogger("genie_dataprep_microservice")
logflag = os.getenv("LOGFLAG", False)
upload_folder = "./uploaded_files/"
LOCK_FILE_PATH = "/tmp/genie_dataprep.lock"

dataprep_component_name = "GENIE_DATAPREP_ARANGODB"
# Initialize OpeaComponentLoader
loader = GenieDataprepLoader(
    dataprep_component_name,
    description=f"OPEA DATAPREP Component: {dataprep_component_name}",
)

# Global registry for running ingestion tasks to support specific "Kill" functionality
active_ingestion_tasks = {}


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
    uploadDate: str
    fileLabels: list[str] | None = None
    storagePath: str | None = None


class DocRepoRetractPayload(BaseModel):
    fileId: str


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

    # --- SYNCHRONOUS LOCK CHECK ---
    # We acquire the lock HERE to ensure we can return 429 immediately if busy.
    lock_file = open(LOCK_FILE_PATH, "w")  # noqa: SIM115
    try:
        # LOCK_EX: Exclusive, LOCK_NB: Non-blocking (throws error immediately if busy)
        fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        lock_file.close()
        logger.warning(f"[ ingest ] Rejected file_id {payload.fileId}: System busy.")
        raise HTTPException(
            status_code=429,
            detail="System is currently processing another document. Only one ingestion can run at a time.",
        ) from None

    # --- Environment-specific Arango config ---
    ARANGO_GRAPH_NAME = os.getenv("ARANGO_GRAPH_NAME", "GRAPH")
    ARANGO_INSERT_ASYNC = os.getenv("ARANGO_INSERT_ASYNC", "false").lower() == "true"
    ARANGO_BATCH_SIZE = int(os.getenv("ARANGO_BATCH_SIZE", 1000))
    ALLOWED_NODE_TYPES = os.getenv("ALLOWED_NODE_TYPES", "").split(",") if os.getenv("ALLOWED_NODE_TYPES") else []
    ALLOWED_EDGE_TYPES = os.getenv("ALLOWED_EDGE_TYPES", "").split(",") if os.getenv("ALLOWED_EDGE_TYPES") else []
    NODE_PROPERTIES = os.getenv("NODE_PROPERTIES", "description").split(",")
    EDGE_PROPERTIES = os.getenv("EDGE_PROPERTIES", "description").split(",")
    TEXT_CAPITALIZATION_STRATEGY = os.getenv("TEXT_CAPITALIZATION_STRATEGY", "upper")
    INCLUDE_CHUNKS = os.getenv("INCLUDE_CHUNKS", "true").lower() == "true"

    # --- FIX: Dynamic Chunking Configuration ---
    # Determine chunk size based on file extension
    CHUNK_SIZE = get_chunk_size_for_file(payload.fileName)
    CHUNK_OVERLAP = int(os.getenv("DATAPREP_CHUNK_OVERLAP", 50))

    try:
        # Decode and temporarily save file
        file_bytes = base64.b64decode(payload.fileBase64)
        save_path = os.path.join(upload_folder, payload.fileName)
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
            upload_date=payload.uploadDate,
            graph_name=ARANGO_GRAPH_NAME,
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

        # --- Trigger Tracked Background Task ---
        # We use asyncio.create_task to maintain a reference for the "Kill" functionality.
        task = asyncio.create_task(loader.ingest_file_with_guardrail(input_req, lock_file=lock_file))
        active_ingestion_tasks[payload.fileId] = task

        # Ensure the task is removed from the registry upon completion (success or failure)
        task.add_done_callback(lambda t: active_ingestion_tasks.pop(payload.fileId, None))

        statistics_dict["opea_service@dataprep"].append_latency(time.time() - start, None)

        return {"success": True, "status": 200, "message": "Ingestion started in background."}

    except Exception as e:
        logger.error(f"Error initiating dataprep ingest: {e}")
        # Cleanup lock if we fail before task starts
        fcntl.flock(lock_file, fcntl.LOCK_UN)
        lock_file.close()

        if os.path.exists(save_path):
            os.remove(save_path)
        raise


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

    if file_id in active_ingestion_tasks:
        task = active_ingestion_tasks[file_id]
        task.cancel()
        return {"success": True, "status": 200, "message": f"Kill signal sent to ingestion task for {file_id}."}

    logger.warning(f"[ kill ] No active ingestion task found for file_id: {file_id}")
    return {"success": False, "status": 404, "message": "No active ingestion task found for this file."}


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
    graph_name = os.getenv("ARANGO_GRAPH_NAME", "genie_graph")

    logger.info(f"[ retract ] Start to delete ingested file {file_id}")

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
        logger.error(f"Error during dataprep retract invocation: {e}")
        raise


# ------------------------------------------------------------------------------
# Launch microservice
# ------------------------------------------------------------------------------
if __name__ == "__main__":
    logger.info("GENIE Dataprep Microservice is starting...")
    base.create_upload_folder(upload_folder)
    base.opea_microservices["opea_service@dataprep"].start()
