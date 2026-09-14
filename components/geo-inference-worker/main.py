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

import logging
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException
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


def _env_coord(name: str, fallback: float, limit: float) -> float:
    raw = os.getenv(name, "").strip()
    if not raw:
        return fallback
    try:
        value = float(raw)
    except ValueError:
        logger.warning(
            "[DEFAULTS] %s=%r is not a number - using %s", name, raw, fallback
        )
        return fallback
    if abs(value) > limit:
        logger.warning("[DEFAULTS] %s=%r out of range - using %s", name, raw, fallback)
        return fallback
    return value


# Deployment fallback point (DEFAULT_LOCATION / DEFAULT_LAT / DEFAULT_LON, root .env
# Section 15) shared with the backend, weather-mcp-service, drought-monitoring and
# warning_system_engine. Requests that omit latitude/longitude use it. Unset = Dhaka.
DEFAULT_LOCATION: str = os.getenv("DEFAULT_LOCATION", "").strip() or "Dhaka"
DEFAULT_LAT: float = _env_coord("DEFAULT_LAT", 23.8103, 90.0)
DEFAULT_LON: float = _env_coord("DEFAULT_LON", 90.4125, 180.0)


class DelineateRequest(BaseModel):
    latitude: float = DEFAULT_LAT
    longitude: float = DEFAULT_LON
    # Half-width of the square searched around the point, km. None = DELINEATION_RADIUS_KM.
    # Always capped at DELINEATION_MAX_RADIUS_KM (5 km) to keep the map about the user's farm.
    radius_km: float | None = None
    # Optional per-request engine override: "ftw" or "delineate-anything".
    engine: str | None = None


class FloodSegmentRequest(BaseModel):
    latitude: float = DEFAULT_LAT
    longitude: float = DEFAULT_LON
    lookback_days: int = 30


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/health")
def health():
    from agri_engine.processor import DelineationConfig

    return {"status": "healthy", "delineation": DelineationConfig().as_dict()}


@app.post("/delineate")
def delineate(req: DelineateRequest):
    """
    Delineate agricultural field boundaries around the given coordinates.

    Runs the Fields of The World pipeline (ftw-tools): crop-calendar Sentinel-2
    scene selection, download, FTW PRUE inference (or DelineateAnything when
    engine="delineate-anything"), polygonization. The searched square has a
    half-width of `radius_km` (default DELINEATION_RADIUS_KM, capped at 5 km).

    Returns GeoJSON FeatureCollection in `fields_geojson`.
    Blocks until complete: typically 20-90 s on GPU; the first call also
    downloads the model checkpoint and the crop-calendar rasters.
    """
    logger.info(
        "[DELINEATE] lat=%.4f  lon=%.4f  radius_km=%s  engine=%s",
        req.latitude,
        req.longitude,
        req.radius_km,
        req.engine,
    )
    try:
        from agri_engine.processor import AgriProcessor

        processor = AgriProcessor()
        result = processor.process_field(
            req.latitude, req.longitude, radius_km=req.radius_km, engine=req.engine
        )
        logger.info(
            "[DELINEATE] Done — %d fields found (source=%s, radius=%.2f km)",
            result["field_count"],
            result["source"],
            result["radius_km"],
        )
        return result
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
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
    logger.info(
        "[FLOOD] lat=%.4f  lon=%.4f  lookback=%d days",
        req.latitude,
        req.longitude,
        req.lookback_days,
    )

    try:
        _init_gee_for_flood()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        logger.error("[FLOOD] GEE init failed: %s", exc)
        raise HTTPException(status_code=503, detail=f"GEE initialization failed: {exc}")

    with tempfile.TemporaryDirectory(prefix="flood_") as tmpdir:
        s2_tif = Path(tmpdir) / "s2_input.tif"
        mask_tif = Path(tmpdir) / "flood_mask.tif"

        # Step 1: Sentinel-2 download from GEE
        try:
            from flood_engine.sentinel_gee import download_sentinel2

            download_sentinel2(req.latitude, req.longitude, s2_tif, req.lookback_days)
        except RuntimeError as exc:
            raise HTTPException(status_code=404, detail=str(exc))

        # Step 2: Prithvi-EO-2.0 inference (CPU)
        try:
            from agri_engine.processor import _GPU_LOCK

            # Prithvi runs in a child process: terratorch/Lightning keep the model
            # referenced after inference, which pinned ~6 GB of GPU memory in this
            # process and made the next SAM run fail with CUDA out-of-memory. A
            # child process returns every byte to the driver when it exits. One GPU
            # job at a time (shared lock with delineation); GPU when GPU_INFERENCE
            # is set, otherwise CPU.
            gpu_on = os.getenv("GPU_INFERENCE", "false").lower() in ("1", "true", "yes")
            with _GPU_LOCK:
                proc = subprocess.run(
                    [
                        sys.executable,
                        "-c",
                        "import sys; from pathlib import Path; "
                        "from flood_engine.prithvi_inference import run_flood_inference; "
                        "run_flood_inference(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3])",
                        str(s2_tif),
                        str(mask_tif),
                        "auto" if gpu_on else "cpu",
                    ],
                    cwd="/app",
                    capture_output=True,
                    text=True,
                    timeout=1500,
                )
            if proc.returncode != 0:
                tail = (proc.stderr or proc.stdout or "")[-2000:]
                logger.error(
                    "[FLOOD] Prithvi child process failed (rc=%s):\n%s",
                    proc.returncode,
                    tail,
                )
                raise RuntimeError(f"flood inference failed (rc={proc.returncode})")
            if proc.stderr:
                for line in proc.stderr.strip().splitlines()[-6:]:
                    logger.info("[FLOOD] %s", line)
        except Exception as exc:
            logger.error("[FLOOD] Prithvi inference failed: %s", exc)
            raise HTTPException(
                status_code=500, detail=f"Flood inference failed: {exc}"
            )

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
        len(flood_geojson["features"]),
        fraction * 100,
    )
    return {
        "flood_geojson": flood_geojson,
        "flood_fraction": fraction,
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
