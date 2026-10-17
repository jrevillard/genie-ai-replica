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

EXPOSE 8090

# /ready verifies the app (imports + client construction) so a broken
# dependency surface is caught at startup, not on the first request.
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=30s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8090/ready', timeout=8)"

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8090"]
