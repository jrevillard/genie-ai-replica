FROM python:3.10-slim

# System deps: ffmpeg for OGG Opus conversion, curl for healthcheck,
# build-essential only if transformers pulls a sentencepiece wheel that
# needs compiling (harmless for platforms where a prebuilt wheel exists).
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install CPU-only PyTorch first from the official wheel index — this
# keeps the image ~1 GB smaller than the default CUDA build.
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir \
    --index-url https://download.pytorch.org/whl/cpu \
    "torch>=2.0.0"

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

# Pre-warm model cache inside the image so first request is instant.
# Comment out the pre-warm line if you prefer lazy download at runtime
# (saves ~150 MB of image size, adds ~10 s to the first request).
ARG PREWARM=1
RUN if [ "$PREWARM" = "1" ]; then \
      python -c "from transformers import VitsModel, AutoTokenizer; \
                 AutoTokenizer.from_pretrained('facebook/mms-tts-mnk'); \
                 VitsModel.from_pretrained('facebook/mms-tts-mnk')"; \
    fi

EXPOSE 5500

HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=30s \
  CMD curl -fsS http://127.0.0.1:5500/health || exit 1

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "5500"]
