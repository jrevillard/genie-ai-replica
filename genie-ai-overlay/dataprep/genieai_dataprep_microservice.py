# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""
Custom Genie Dataprep Microservice

Extends the base OPEA Dataprep microservice with additional endpoints for
document repository ingestion and retraction, using ArangoDB as the backend.
"""

import base64
import os
import time
import fcntl
from typing import List, Optional, Union

from pydantic import BaseModel
from fastapi import Body, BackgroundTasks, HTTPException

# --- CRITICAL FIX: Import Custom Component FIRST to register it ---
from integrations.genieai_dataprep_arangodb import GenieArangoDataprep

# --- Import the entire base dataprep microservice safely ---
import opea_dataprep_microservice as base
from genieai_dataprep_loader import GenieDataprepLoader

# --- Use same shared OPEA components ---
from comps import (
    CustomLogger,
    ServiceType,
    register_microservice,
    register_statistics,
    statistics_dict,
)

# --- Import custom Pydantic model from our overlay protocol ---
from comps.cores.proto.genieai_api_protocol import ArangoDBDataprepRequestFromDocRepo

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

# ------------------------------------------------------------------------------
# Custom request payload models
# ------------------------------------------------------------------------------
class DocRepoIngestPayload(BaseModel):
    fileId: str
    fileName: str
    fileBase64: str
    fileType: str
    uploadDate: str
    fileLabels: Optional[List[str]] = None
    storagePath: Optional[str] = None


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
async def ingest_file_from_repo(payload: DocRepoIngestPayload, background_tasks: BackgroundTasks):
    """
    Accepts JSON:
    {
        "fileId": "...",
        "fileName": "...",
        "fileBase64": "...",
        "fileType": "...",
        "uploadDate": "...",
        "fileLabels": [...],
        "storagePath": "..."
    }
    """

    start = time.time()
    logger.info(f"[ ingest ] Request received for file_id: {payload.fileId}")

    # --- SYNCHRONOUS LOCK CHECK ---
    # We acquire the lock HERE to ensure we can return 429 immediately if busy.
    lock_file = open(LOCK_FILE_PATH, 'w')
    try:
        # LOCK_EX: Exclusive, LOCK_NB: Non-blocking (throws error immediately if busy)
        fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except IOError:
        lock_file.close()
        logger.warning(f"[ ingest ] Rejected file_id {payload.fileId}: System busy.")
        raise HTTPException(
            status_code=429, 
            detail="System is currently processing another document. Please wait for the current ingestion task to complete."
        )

    # --- Environment-specific Arango config (set via env vars or defaults) ---
    ARANGO_GRAPH_NAME = os.getenv("ARANGO_GRAPH_NAME", "GRAPH_TEST")
    ARANGO_INSERT_ASYNC = os.getenv("ARANGO_INSERT_ASYNC", "false").lower() == "true"
    ARANGO_BATCH_SIZE = int(os.getenv("ARANGO_BATCH_SIZE", 1000))
    ALLOWED_NODE_TYPES = os.getenv("ALLOWED_NODE_TYPES", "").split(",") if os.getenv("ALLOWED_NODE_TYPES") else []
    ALLOWED_EDGE_TYPES = os.getenv("ALLOWED_EDGE_TYPES", "").split(",") if os.getenv("ALLOWED_EDGE_TYPES") else []
    NODE_PROPERTIES = os.getenv("NODE_PROPERTIES", "description").split(",")
    EDGE_PROPERTIES = os.getenv("EDGE_PROPERTIES", "description").split(",")
    TEXT_CAPITALIZATION_STRATEGY = os.getenv("TEXT_CAPITALIZATION_STRATEGY", "upper")
    INCLUDE_CHUNKS = os.getenv("INCLUDE_CHUNKS", "true").lower() == "true"

    try:
        # --- Decode and temporarily save file ---
        # We do this synchronously so the file exists before we return 200
        file_bytes = base64.b64decode(payload.fileBase64)
        save_path = os.path.join(upload_folder, payload.fileName)
        with open(save_path, "wb") as f:
            f.write(file_bytes)
        logger.info(f"[ ingest ] File saved to: {save_path}")

        # --- Construct Arango-specific dataprep request ---
        input_req = ArangoDBDataprepRequestFromDocRepo(
            file_id=payload.fileId,
            file_name=payload.fileName,
            file_path=save_path,
            file_type=payload.fileType,
            file_labels=payload.fileLabels, # Passed through here
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
        )

        # --- Trigger Background Task (Spec 5.1) ---
        # PASS THE LOCKED FILE OBJECT to the background task.
        # The background task is responsible for releasing the lock (closing the file).
        background_tasks.add_task(loader.ingest_file_with_guardrail, input_req, lock_file=lock_file)

        statistics_dict["opea_service@dataprep"].append_latency(time.time() - start, None)

        return {
            "success": True, 
            "status": 200, 
            "message": "Ingestion started in background."
        }

    except Exception as e:
        logger.error(f"Error initiating dataprep ingest: {e}")
        # Cleanup lock if we fail before assigning to background task
        fcntl.flock(lock_file, fcntl.LOCK_UN)
        lock_file.close()
        
        # Cleanup file
        if os.path.exists(save_path):
            os.remove(save_path)
        raise

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
        if dataprep_component_name == "GENIE_DATAPREP_ARANGODB":
            response = await loader.retract_file(file_id=file_id, graph_name=graph_name)
        else:
            logger.error(f"dataprep_component_name is not set or invalid: {dataprep_component_name}")
            raise RuntimeError("Unsupported dataprep_component_name")

        # FIX: Ensure success flag is present for Node.js controller
        if isinstance(response, dict):
            if response.get("status") == 200:
                response["success"] = True
            elif "success" not in response:
                # Fallback if status is missing but it returned a dict (usually success in OPEA)
                response["success"] = False

        if logflag:
            logger.debug(f"[ retract ] retracted result: {response}")
        statistics_dict["opea_service@dataprep"].append_latency(time.time() - start, None)
        return response

    except Exception as e:
        logger.error(f"Error during dataprep retract invocation: {e}")
        raise


# ------------------------------------------------------------------------------
# Launch microservice (inherits base service registry)
# ------------------------------------------------------------------------------
if __name__ == "__main__":
    logger.info("GENIE Dataprep Microservice is starting...")
    base.create_upload_folder(upload_folder)
    base.opea_microservices["opea_service@dataprep"].start()