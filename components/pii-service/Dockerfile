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

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
