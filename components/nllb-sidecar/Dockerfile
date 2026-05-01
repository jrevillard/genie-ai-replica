# Fallback NLLB-200 sidecar image.
#
# Use this only if the prebuilt ghcr.io/winstxnhdw/nllb-api:main image
# is unreachable from your network. To activate, change the
# `image:` line in haystack-stack/docker-compose.nllb.yml to
#   build:
#     context: ../components/nllb-sidecar
#
# CTranslate2 int8 quantisation gets us ~1.5 GB on disk vs ~2.5 GB for
# the raw transformers checkpoint, with a small (<2 BLEU) quality cost
# that the back-translation gate compensates for.

FROM python:3.11-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
        ctranslate2==4.4.0 \
        transformers==4.44.0 \
        sentencepiece==0.2.0 \
        fastapi==0.115.0 \
        uvicorn==0.30.6

WORKDIR /app
COPY server.py /app/server.py

# Pre-convert the model at build time so the container starts fast.
# Quantisation drops the model to ~1.5 GB while keeping eng->bam quality
# above the threshold the back-translation gate uses.
RUN python -c "from ctranslate2.converters import TransformersConverter; \
TransformersConverter('facebook/nllb-200-distilled-600M').convert('/app/model', quantization='int8')"

EXPOSE 7860
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "7860"]
