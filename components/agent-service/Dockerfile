# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
# GENIE.AI agent service — internal-only FastAPI service (Epic 1).
# The image carries the service and its pinned dependency tree, nothing else:
# no model, no GPU stack, no build toolchain.

FROM python:3.11-slim AS runtime

# Security: non-root user (NFR-S6)
RUN useradd --create-home --uid 10001 agentsvc

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# The OS packages are refreshed by a separate, bustable layer: the monthly
# rebuild passes --build-arg CACHE_BUST=<timestamp>, and a layer that takes
# that argument is the only one whose cache key changes. Position: BELOW the
# dependency install (the pip install is the expensive layer, and a layer's
# cache key includes its parent — so it stays cached across a monthly bust),
# still root (the USER drop comes after), and above nothing that writes to a
# package-owned path.
ARG CACHE_BUST=0
RUN CACHE_BUST=$CACHE_BUST apt-get update -y -o Acquire::Retries=5 && \
    CACHE_BUST=$CACHE_BUST apt-get upgrade -y --with-new-pkgs --fix-missing -o Acquire::Retries=5 && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# The capability layer (story 1.6): the port implementation and its adapters
# are carried into the image beside the service modules. The preparation
# module (story 1.8) rides beside them: the loop-side query preparation and
# its vendored language registry. The noagent package (story 1.9) rides
# beside both: config B, the fixed single-pass pipeline. The agent package
# (story 2.1) rides beside all of them: the runtime seam and the probe.
COPY app.py tracing.py ./
COPY capabilities/ ./capabilities/
COPY preparation/ ./preparation/
COPY noagent/ ./noagent/
COPY agent/ ./agent/

USER agentsvc
EXPOSE 8010

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8010/ready', timeout=8)"

# One worker: the service is a thin internal surface, and a worker process
# would load its own copy of the tracing SDK.
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port 8010"]
