FROM python:3.11-slim-bookworm

# System: GDAL, GEOS, PROJ (rasterio/geopandas), build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    gdal-bin libgdal-dev libgeos-dev libproj-dev \
    gcc g++ git wget curl \
    && rm -rf /var/lib/apt/lists/*

ENV CPLUS_INCLUDE_PATH=/usr/include/gdal
ENV C_INCLUDE_PATH=/usr/include/gdal

WORKDIR /app

# Layer 1: PyTorch CPU wheels (large — cached unless torch version changes)
ARG TORCH_INDEX_URL=https://download.pytorch.org/whl/cu121
COPY requirements-torch.txt .
RUN pip install --no-cache-dir --prefer-binary --timeout 1200 --retries 5 \
    --index-url ${TORCH_INDEX_URL} \
    -r requirements-torch.txt

# Layer 2: Geospatial stack (earthengine, geemap, agribound, segment-geospatial)
COPY requirements-geo.txt .
RUN pip install --no-cache-dir --prefer-binary --timeout 1200 --retries 5 -r requirements-geo.txt
# Force headless OpenCV — segment-geospatial pulls in opencv-python (GUI)
RUN pip install --no-cache-dir --force-reinstall opencv-python-headless

# Layer 3: Prithvi-EO-2.0 inference stack
# mmcv 1.7.2 requires --no-build-isolation due to non-standard setup.py
COPY requirements-inference.txt .
RUN pip install --no-cache-dir --timeout 1200 --retries 5 \
        "setuptools<70" wheel addict packaging yapf Pillow \
    && pip install --no-cache-dir --timeout 1200 --retries 5 --no-build-isolation \
        mmcv==1.7.2 mmsegmentation==0.30.0 \
    && pip install --no-cache-dir --prefer-binary --timeout 1200 --retries 5 \
        -r requirements-inference.txt

# Layer 4: App dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --timeout 1200 -r requirements.txt

# Application code
COPY agri_engine/ ./agri_engine/
COPY flood_engine/ ./flood_engine/
COPY main.py .

# Models and secrets are mounted as volumes at runtime — not baked in.
# First inference will download SAM (~2.5 GB) and Prithvi-EO (~1.3 GB)
# to the mounted model volume and cache them there for subsequent runs.
RUN mkdir -p /app/secrets /app/models

ENV PYTHONUNBUFFERED=1
ENV LOG_LEVEL=INFO
ENV SAM_CHECKPOINT=/app/models/sam_vit_h_4b8939.pth
ENV HF_HOME=/app/models/huggingface
ENV HF_HUB_CACHE=/app/models/huggingface/hub
ENV PRITHVI2_MODEL_REPO=ibm-nasa-geospatial/Prithvi-EO-2.0-300M-TL-Sen1Floods11

EXPOSE 8001
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
