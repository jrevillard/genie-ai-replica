"""
Geo Inference Worker — internal HTTP service for geospatial AI inference.

Endpoints
  GET  /health
  POST /delineate        — field boundary delineation (agribound + GEE + SAM/FTW)
  POST /flood-segment    — flood detection (GEE Sentinel-2 + Prithvi-EO-2.0)

Authentication for GEE: service account JSON at /app/secrets/credentials.json
                        (or service-account.json). Mount the file as a read-only
                        Docker volume — do not bake secrets into the image.

Models are downloaded on first use and cached in the HF_HOME / SAM_CHECKPOINT
locations, which should be mounted as a persistent Docker volume so the download
(~4 GB total) only happens once.
"""
import json
import logging
import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s  %(levelname)-7s  %(name)s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger(__name__)

app = FastAPI(title="Geo Inference Worker")


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class DelineateRequest(BaseModel):
    latitude:  float
    longitude: float


class FloodSegmentRequest(BaseModel):
    latitude:     float
    longitude:    float
    lookback_days: int = 30


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "healthy"}


@app.post("/delineate")
def delineate(req: DelineateRequest):
    """
    Delineate agricultural field boundaries at the given coordinates.

    Uses GEE to download a Sentinel-2 composite, then runs agribound
    (delineate-anything → SAM fallback → FTW refinement).

    Returns GeoJSON FeatureCollection in `fields_geojson`.
    Blocks until complete — first call may take 5–15 minutes depending on
    GEE export speed and whether SAM model needs to be downloaded.
    """
    logger.info("[DELINEATE] lat=%.4f  lon=%.4f", req.latitude, req.longitude)
    try:
        from agri_engine.processor import AgriProcessor
        processor = AgriProcessor()
        result = processor.process_field(req.latitude, req.longitude)
        logger.info("[DELINEATE] Done — %d fields found (source=%s)", result["field_count"], result["source"])
        return result
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except RuntimeError as exc:
        logger.error("[DELINEATE] Failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/flood-segment")
def flood_segment(req: FloodSegmentRequest):
    """
    Detect flooded areas at the given coordinates using Prithvi-EO-2.0.

    Pipeline:
      1. Download Sentinel-2 median composite from GEE (last N days)
      2. Run Prithvi-EO-2.0-300M-TL-Sen1Floods11 inference (CPU)
      3. Vectorize flood mask → GeoJSON polygons

    Returns GeoJSON FeatureCollection in `flood_geojson` + statistics.
    Blocks until complete — first call downloads the Prithvi model (~1.3 GB).
    """
    logger.info("[FLOOD] lat=%.4f  lon=%.4f  lookback=%d days", req.latitude, req.longitude, req.lookback_days)

    try:
        _init_gee_for_flood()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        logger.error("[FLOOD] GEE init failed: %s", exc)
        raise HTTPException(status_code=503, detail=f"GEE initialization failed: {exc}")

    with tempfile.TemporaryDirectory(prefix="flood_") as tmpdir:
        s2_tif   = Path(tmpdir) / "s2_input.tif"
        mask_tif = Path(tmpdir) / "flood_mask.tif"

        # Step 1: Sentinel-2 download from GEE
        try:
            from flood_engine.sentinel_gee import download_sentinel2
            download_sentinel2(req.latitude, req.longitude, s2_tif, req.lookback_days)
        except RuntimeError as exc:
            raise HTTPException(status_code=404, detail=str(exc))

        # Step 2: Prithvi-EO-2.0 inference (CPU)
        try:
            from flood_engine.prithvi_inference import run_flood_inference
            run_flood_inference(s2_tif, mask_tif, device="cpu")
        except Exception as exc:
            logger.error("[FLOOD] Prithvi inference failed: %s", exc)
            raise HTTPException(status_code=500, detail=f"Flood inference failed: {exc}")

        # Step 3: Vectorize
        try:
            from flood_engine.vectorize import vectorize_flood_mask
            flood_geojson = vectorize_flood_mask(mask_tif)
        except Exception as exc:
            logger.error("[FLOOD] Vectorization failed: %s", exc)
            raise HTTPException(status_code=500, detail=f"Vectorization failed: {exc}")

    fraction = flood_geojson["flood_fraction"]
    logger.info(
        "[FLOOD] Done — %d polygons, %.1f%% flooded",
        len(flood_geojson["features"]), fraction * 100,
    )
    return {
        "flood_geojson":   flood_geojson,
        "flood_fraction":  fraction,
        "flood_pixel_count": flood_geojson["flood_pixel_count"],
        "valid_pixel_count": flood_geojson["valid_pixel_count"],
    }


# ---------------------------------------------------------------------------
# GEE auth helper for flood pipeline (agri_engine initializes its own)
# ---------------------------------------------------------------------------

def _init_gee_for_flood() -> None:
    """Initialize EE for the flood pipeline using the same priority logic as AgriProcessor."""
    from agri_engine.processor import _initialize_gee
    _initialize_gee()
    logger.debug("[FLOOD] GEE initialized")
