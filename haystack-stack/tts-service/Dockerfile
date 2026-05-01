FROM python:3.10-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

# BUG-025 fix: drop root. Takes effect on next rebuild.
RUN groupadd --system tts \
 && useradd  --system --gid tts --home-dir /app --shell /sbin/nologin tts \
 && chown -R tts:tts /app
USER tts

EXPOSE 5500

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD curl -fsS http://127.0.0.1:5500/health || exit 1

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "5500"]
