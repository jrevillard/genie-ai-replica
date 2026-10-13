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
#
# WHY THERE IS NO `--max-requests` HERE (measured 2026-10-13). Recycling a
# worker on a request schedule was considered and REJECTED on evidence:
#
#   1. It does not exist in the pinned uvicorn. `--max-requests` /
#      `--max-requests-jitter` are absent from 0.30.6 (only the unrelated
#      `--limit-max-requests` concurrency cap is present), so adding the flag
#      would abort the container at startup with "No such option".
#   2. The worker death is NOT driven by request count. 600 sequential 24 KB
#      scans produced ZERO deaths with FLAT worker RSS (~447/453 MB from
#      request 60 to 540) — no leak, no cumulative growth to recycle away.
#   3. It is driven by the length of ONE analyze() call. A single 850 KB scan
#      killed the worker 8/8 times. See app.py: the text is analyzed in
#      regions so no single call starves uvicorn's supervisor, which SIGKILLs
#      a child that fails its 5 s liveness ping (Multiprocess.
#      keep_subprocess_alive -> Process.ping). After the fix: 0 deaths in 10/10
#      850 KB scans.
#
# MALLOC_ARENA_MAX was also tested: it flattens worker memory under concurrent
# load but does NOT prevent a death (6/6 deaths with the cap), so it is not
# set here.
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port 8000 --workers ${PII_WEB_CONCURRENCY:-2}"]
