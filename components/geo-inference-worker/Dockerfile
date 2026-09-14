FROM python:3.12-slim-bookworm

# System: GDAL, GEOS, PROJ (rasterio/geopandas), build tools, git (ftw-tools from git)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gdal-bin libgdal-dev libgeos-dev libproj-dev \
    gcc g++ git wget curl \
    && rm -rf /var/lib/apt/lists/*

ENV CPLUS_INCLUDE_PATH=/usr/include/gdal
ENV C_INCLUDE_PATH=/usr/include/gdal

WORKDIR /app

# uv resolves the ML stack far faster than pip and supports dependency overrides
RUN pip install --no-cache-dir "uv>=0.5"
ENV UV_HTTP_TIMEOUT=1200

# Layer 1: PyTorch CUDA wheels (large; cached unless the pins change)
ARG TORCH_INDEX_URL=https://download.pytorch.org/whl/cu121
COPY requirements-torch.txt .
RUN uv pip install --system --no-cache --index-url ${TORCH_INDEX_URL} -r requirements-torch.txt

# Layer 2: Geospatial stack (earthengine, geemap, geopandas, rasterio)
COPY requirements-geo.txt .
RUN uv pip install --system --no-cache -r requirements-geo.txt

# Layer 3: Fields of The World (ftw-tools + DelineateAnything) and the Prithvi
# flood stack (terratorch), resolved together so torchgeo/lightning agree.
COPY requirements-ftw.txt requirements-inference.txt overrides.txt ./
RUN uv pip install --system --no-cache --override overrides.txt \
        -r requirements-ftw.txt -r requirements-inference.txt \
    # ultralytics pulls the GUI OpenCV build; the server only needs headless.
    # Uninstall first: both wheels own the same cv2/ directory, so removing
    # opencv-python after installing headless deletes the module.
    && (uv pip uninstall --system opencv-python opencv-python-headless || true) \
    && uv pip install --system --no-cache opencv-python-headless

# Layer 4: App dependencies
COPY requirements.txt .
RUN uv pip install --system --no-cache -r requirements.txt

# Application code
COPY agri_engine/ ./agri_engine/
COPY flood_engine/ ./flood_engine/
COPY main.py .

# Models and secrets are mounted as volumes at runtime, not baked in.
# First requests download the FTW checkpoint (~0.3-0.5 GB), the crop calendar
# rasters, and the Prithvi-EO model (~1.3 GB) into the mounted model volume.
RUN mkdir -p /app/secrets /app/models

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app
ENV LOG_LEVEL=INFO
# ftw-tools caches checkpoints under TORCH_HOME and crop calendars under FTW_CACHE_DIR
ENV TORCH_HOME=/app/models/torch
ENV FTW_CACHE_DIR=/app/models/ftw-tools
ENV HF_HOME=/app/models/huggingface
ENV HF_HUB_CACHE=/app/models/huggingface/hub
ENV PRITHVI2_MODEL_REPO=ibm-nasa-geospatial/Prithvi-EO-2.0-300M-TL-Sen1Floods11

EXPOSE 8001
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
