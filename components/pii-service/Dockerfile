# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
# OKF PII sidecar — FastAPI + Presidio + spaCy model BAKED IN (ADR-okf-004 rev).
# The model downloads at BUILD time only → runtime is air-gap sovereign (NFR-S1).

FROM python:3.11-slim AS runtime

# Security: non-root user (NFR-S6)
RUN useradd --create-home --uid 10001 piiuser

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    # Bake the NER model into the image (build-time egress only; runtime
    # offline). The model wheel resolves its own compatible spaCy — do NOT
    # pin spaCy separately (a second pin conflicts with the model wheel).
    && python -m spacy download en_core_web_md

COPY app.py .

USER piiuser
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/ready', timeout=8)"

# PII_WEB_CONCURRENCY: uvicorn WORKER PROCESSES (live-fixed 2026-09-03). The
# scan endpoint is sync + presidio/spaCy NER is GIL-bound, so a single worker
# serializes EVERY scan — one 90 KB crawl page saturates the process (client
# 10 s timeouts, even /ready starves → docker marks the service unhealthy).
# Processes parallelize where threads cannot; each loads its own model copy.
# Size for the node: 2 = default sane floor; raise on many-core deployments.
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port 8000 --workers ${PII_WEB_CONCURRENCY:-2}"]
