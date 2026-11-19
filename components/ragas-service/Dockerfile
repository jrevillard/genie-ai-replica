# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
#
# OKF RAGAS sidecar (Story 8-6, ADR-okf-043). Stateless Python service:
# ragas testset generation + metric evaluation + xlsx serialization.
# The Node okf-server calls it container-to-container on genieai_network
# (like pii-service) — INTERNAL only, never publicly routed. No runtime
# egress except the configured judge/embedder endpoints (deployment-local
# vLLM/TEI by default). CPU-only; the LLM work happens at the endpoints.

FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8090

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py ragas_engine.py xlsx_io.py ./

# Run as an unprivileged user (kics Missing User Instruction — the sibling
# okf-server/pii-service images do the same; stateless CPU sidecar).
RUN useradd --system --create-home --uid 10001 okf && chown -R okf:okf /app

# The OS packages are refreshed by a separate, bustable layer: the monthly
# rebuild passes --build-arg CACHE_BUST=<timestamp>, and a layer that takes
# that argument is the only one whose cache key changes. This image installs
# no OS package, but the BASE carries them (zlib1g — CVE-2026-85091, whose
# fix lives in the trixie security pocket: 1:1.3.dfsg+really1.3.1-1+deb13u1),
# and the base tag only moves when upstream rebuilds it. This layer is what
# pulls that fix on the monthly cycle.
#
# Position: BELOW the dependency install (the pip install is the expensive
# layer, and a layer's cache key includes its parent — so it stays cached
# across a monthly bust), still root (the USER drop comes after), and above
# nothing that writes to a package-owned path.
ARG CACHE_BUST=0
RUN CACHE_BUST=$CACHE_BUST apt-get update -y -o Acquire::Retries=5 && \
    CACHE_BUST=$CACHE_BUST apt-get upgrade -y --with-new-pkgs --fix-missing -o Acquire::Retries=5 && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

USER okf

EXPOSE 8090

# /ready verifies the app (imports + client construction) so a broken
# dependency surface is caught at startup, not on the first request.
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=30s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8090/ready', timeout=8)"

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8090"]
