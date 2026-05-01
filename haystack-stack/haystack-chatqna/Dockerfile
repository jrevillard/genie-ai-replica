FROM python:3.10-slim
 
WORKDIR /app
 
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        ffmpeg \
        curl \
        fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
 
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Pre-download spaCy English model so runtime doesn't need network
RUN python -m spacy download en_core_web_sm
 
COPY src/ ./src/
COPY data/ ./data/

# BUG-025 fix: drop root before launching the app. An LLM-injection or
# PDF-parse RCE that escalated would otherwise own the container as
# root. Container does NOT bind low ports (8000 is fine) and writable
# runtime paths are explicitly chowned so uvicorn workers can fork,
# write logs, and create the spaCy / huggingface caches.
#
# IMPORTANT: this directive only takes effect after a rebuild:
#   docker compose -f docker-compose.yml -f docker-compose.override.yml \
#                  build --no-cache haystack-chatqna
#   docker compose -f ... up -d --force-recreate haystack-chatqna
# The team rebuilds on their schedule -- do not auto-trigger here.
RUN groupadd --system amina \
 && useradd  --system --gid amina --home-dir /app --shell /sbin/nologin amina \
 && mkdir -p /app/logs /app/tmp \
 && chown -R amina:amina /app
USER amina

EXPOSE 8000

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4", "--limit-concurrency", "200"]
