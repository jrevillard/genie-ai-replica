# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""GENIE.AI agent service - internal-only HTTP surface.

Story 1.3 (Epic 1): the service exists, is deployable, is switchable and is
observable. It owns no capability yet - the capability tools land in the
following stories. What it exposes today is infrastructure only: liveness,
readiness and the OpenTelemetry wiring.

The service is INTERNAL: no host port, no gateway route, no caller. The
deployment flag (`AGENT_ENABLED`) gates it - with the flag off the stack
schedules zero replicas, so nothing here is reachable.
"""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from tracing import setup_tracing

SERVICE_NAME = "agent-service"

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)

# Traces and metrics go to the collector only when observability is enabled
# (the same single gate the OPEA tier uses).
setup_tracing(SERVICE_NAME)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # The flag is logged, not enforced here: the deployment gate is the
    # Compose `deploy.replicas` value (one flag for the whole stack, as the
    # epic defines it). The service carries no capability surface yet, so
    # there is nothing to refuse while the flag is off.
    logger.info(
        "agent service started (AGENT_ENABLED=%s - no capability surface is served)",
        os.getenv("AGENT_ENABLED", "0"),
    )
    yield


app = FastAPI(
    title="GENIE.AI agent service",
    version="0.1.0",
    lifespan=lifespan,
)


@app.get("/health")
async def health() -> dict:
    """Liveness - the process is up and serving."""
    return {"status": "ok"}


@app.get("/ready")
async def ready() -> dict:
    """Readiness - the service can serve. No dependency to be ready for yet."""
    return {"status": "ready", "agent_enabled": os.getenv("AGENT_ENABLED", "0") == "1"}
