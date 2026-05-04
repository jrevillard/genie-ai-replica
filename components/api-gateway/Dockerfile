# AMINA API Gateway — Phase 0+1
# Lightweight FastAPI service. No GPU, no ML models, just pattern
# matching + httpx proxy. Image is ~150 MB.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install system deps for httpx (curl for healthcheck only).
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

COPY app /app/app

# Healthcheck: gateway must be reachable on its bound port.
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
    CMD curl -fsS http://127.0.0.1:8443/health || exit 1

EXPOSE 8443

# Single worker — gateway is stateless, scale horizontally if needed.
# Workers > 1 would each maintain their own _LAST_HASH chain head,
# breaking the audit chain semantics until we move chain root to
# ArcadeDB seed-on-startup (Phase 2).
CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8443", \
     "--workers", "1", \
     "--log-level", "info"]
