"""
AgriProcessor — field boundary delineation via GEE + SAM (segment-geospatial).

Strategy:
  1. Try agribound.delineate(engine='delineate-anything') — the ideal path.
  2. If it fails (missing ftw-tools dev), fall back to a direct pipeline:
       a. Download Sentinel-2 RGB composite from GEE via geemap.
       b. Segment with SamGeo (SAM vit_h checkpoint).
       c. Convert raster mask to GeoJSON polygons.

Authentication: service account JSON at /app/secrets/credentials.json.
"""
import json
import logging
import os
import shutil
import tempfile
from pathlib import Path

import ee

from .utils import create_aoi_file

log = logging.getLogger(__name__)

_SA_CANDIDATES = (
    "/app/secrets/credentials.json",
    "/app/secrets/service-account.json",
)

# Sentinel-2 RGB bands (10 m, surface reflectance)
_S2_BANDS = ["B4", "B3", "B2"]
_S2_SCALE = 10          # metres per pixel
_AOI_BUFFER_DEG = 0.02  # ~2.2 km half-width
_S2_CLOUD_PCT = 20


def _initialize_gee() -> tuple:
    """Authenticate EE with service account JSON. Returns (credentials, project_id)."""
    sa_path = next((p for p in _SA_CANDIDATES if os.path.exists(p)), None)
    if not sa_path:
        raise FileNotFoundError(
            "GEE service account JSON not found. "
            "Mount it at /app/secrets/credentials.json in docker-compose."
        )
    with open(sa_path) as f:
        data = json.load(f)
    client_email = data.get("client_email")
    if not client_email:
        raise RuntimeError(f"Missing client_email in {sa_path}")
    project_id = (os.getenv("GEE_PROJECT_ID") or data.get("project_id", "")).strip()
    credentials = ee.ServiceAccountCredentials(client_email, sa_path)
    ee.Initialize(credentials=credentials, project=project_id or None)
    log.info("GEE authenticated (%s, project=%s)", client_email, project_id or "<default>")
    return credentials, project_id


def _patch_agribound_gee(credentials, project_id: str) -> None:
    def _setup_gee_override(project=None):
        ee.Initialize(credentials=credentials, project=project or project_id or None)

    for module_path in ("agribound.auth", "agribound.composites.gee"):
        try:
            import importlib
            mod = importlib.import_module(module_path)
            mod.setup_gee = _setup_gee_override
        except Exception as exc:
            log.debug("Could not patch %s.setup_gee: %s", module_path, exc)


def _resolve_device() -> str:
    if os.getenv("GPU_INFERENCE", "false").lower() in ("1", "true", "yes"):
        import torch
        return "cuda" if torch.cuda.is_available() else "cpu"
    return "cpu"


def _download_s2_rgb(lat: float, lon: float, out_tif: str) -> None:
    """Download a cloud-free Sentinel-2 RGB GeoTIFF centred on lat/lon."""
    import geemap  # noqa: PLC0415

    region = ee.Geometry.BBox(
        lon - _AOI_BUFFER_DEG, lat - _AOI_BUFFER_DEG,
        lon + _AOI_BUFFER_DEG, lat + _AOI_BUFFER_DEG,
    )
    s2 = (
        ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterDate("2023-01-01", "2025-12-31")
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", _S2_CLOUD_PCT))
        .filterBounds(region)
        .select(_S2_BANDS)
        .median()
        .multiply(0.0001)
        .toFloat()
    )
    geemap.download_ee_image(s2, out_tif, region=region, scale=_S2_SCALE, crs="EPSG:4326")
    if not Path(out_tif).exists() or Path(out_tif).stat().st_size == 0:
        raise RuntimeError("GEE export produced no Sentinel-2 data for this location.")


_SAM_URL = "https://dl.fbaipublicfiles.com/segment_anything/sam_vit_h_4b8939.pth"


def _ensure_sam_checkpoint(path: str) -> None:
    """Download SAM vit_h checkpoint to the persistent model volume if missing."""
    if Path(path).exists():
        return
    log.info("SAM checkpoint not found — downloading to %s (~2.5 GB) …", path)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    import urllib.request  # noqa: PLC0415
    urllib.request.urlretrieve(_SAM_URL, path + ".tmp")
    Path(path + ".tmp").rename(path)
    log.info("SAM checkpoint download complete.")


def _to_uint8_rgb(src_tif: str, dst_tif: str) -> None:
    """
    Convert a float32 multi-band GeoTIFF to uint8 RGB for SAM input.
    Replaces non-finite values and applies a per-band percentile stretch.
    """
    import numpy as np   # noqa: PLC0415
    import rasterio      # noqa: PLC0415

    with rasterio.open(src_tif) as src:
        data = src.read(out_dtype="float32")   # (bands, H, W)
        profile = src.profile.copy()

    data = np.where(np.isfinite(data), data, 0.0)

    # Percentile stretch each band independently for good contrast
    out = np.zeros_like(data)
    for i in range(data.shape[0]):
        band = data[i]
        valid = band[band > 0]
        if valid.size:
            lo, hi = np.percentile(valid, (2, 98))
            if hi > lo:
                out[i] = np.clip((band - lo) / (hi - lo) * 255, 0, 255)
        # else stays 0

    profile.update(dtype="uint8", nodata=None, count=min(3, data.shape[0]))
    with rasterio.open(dst_tif, "w", **profile) as dst:
        dst.write(out[:3].astype("uint8"))


def _segment_with_sam(rgb_tif: str, sam_checkpoint: str, device: str, tmpdir: str) -> str:
    """
    Run SAM on an RGB GeoTIFF and return path to a GeoJSON of the segments.
    Uses samgeo.SamGeo (segment-geospatial).
    """
    from samgeo import SamGeo  # noqa: PLC0415

    _ensure_sam_checkpoint(sam_checkpoint)

    # Preprocess: float32 → uint8 with finite values
    uint8_tif  = str(Path(tmpdir) / "s2_uint8.tif")
    mask_tif   = str(Path(tmpdir) / "sam_mask.tif")
    vector_out = str(Path(tmpdir) / "boundaries.geojson")

    log.info("Preprocessing raster to uint8 …")
    _to_uint8_rgb(rgb_tif, uint8_tif)

    log.info("Running SAM auto-segmentation …")
    sam = SamGeo(
        model_type="vit_h",
        checkpoint=sam_checkpoint,
        device=device,
        automatic=True,
    )
    sam.generate(
        uint8_tif,
        output=mask_tif,
        batch=True,
        foreground=True,
        erosion_kernel=(3, 3),
        mask_multiplier=255,
    )
    sam.tiff_to_vector(mask_tif, vector_out)
    return vector_out


class AgriProcessor:
    def __init__(self) -> None:
        self.device = _resolve_device()
        self.sam_path = os.getenv("SAM_CHECKPOINT", "/app/models/sam_vit_h_4b8939.pth")
        self.gee_project = os.getenv("GEE_PROJECT_ID", "").strip()
        log.info("AgriProcessor ready — device=%s", self.device)

    def _init_gee(self) -> tuple:
        credentials, project_id = _initialize_gee()
        _patch_agribound_gee(credentials, project_id or self.gee_project)
        return credentials, project_id or self.gee_project

    def process_field(self, lat: float, lon: float) -> dict:
        """
        Delineate agricultural field boundaries.

        Tries agribound (delineate-anything) first; falls back to a direct
        GEE + SAM pipeline if agribound's engines are unavailable.

        Returns a dict with field_count, fields_geojson, and source.
        Raises RuntimeError on failure.
        """
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise ValueError(f"Invalid coordinates: lat={lat}, lon={lon}")

        credentials, gee_project = self._init_gee()
        aoi_path = create_aoi_file(lat, lon)

        # ── Primary: agribound delineate-anything ────────────────────────────
        try:
            import agribound  # noqa: PLC0415

            bounds_out = "/tmp/field_boundaries.geojson"
            if Path(bounds_out).exists():
                Path(bounds_out).unlink()
            cache = Path("/tmp/.agribound_cache")
            if cache.exists():
                shutil.rmtree(cache)

            log.info("Trying agribound delineate-anything (lat=%.4f, lon=%.4f)", lat, lon)
            agribound.delineate(
                study_area=aoi_path,
                source="sentinel2",
                year=2026,
                engine="delineate-anything",
                engine_params={},
                n_workers=0,
                device=self.device,
                gee_project=gee_project or None,
                output_path=bounds_out,
            )

            if Path(bounds_out).exists() and Path(bounds_out).stat().st_size > 0:
                import geopandas as gpd  # noqa: PLC0415
                gdf = gpd.read_file(bounds_out)
                log.info("agribound: %d field boundaries", len(gdf))
                return {
                    "field_count":    len(gdf),
                    "fields_geojson": json.loads(gdf.to_json()),
                    "source":         "gee+delineate-anything",
                }

        except Exception as exc:
            log.warning("agribound delineate-anything failed (%s) — switching to GEE+SAM fallback", exc)

        # ── Fallback: GEE Sentinel-2 download → SAM segmentation ─────────────
        log.info("GEE+SAM fallback (lat=%.4f, lon=%.4f)", lat, lon)
        with tempfile.TemporaryDirectory(prefix="agri_") as tmpdir:
            rgb_tif = str(Path(tmpdir) / "s2_rgb.tif")

            log.info("Downloading Sentinel-2 composite from GEE …")
            _download_s2_rgb(lat, lon, rgb_tif)

            log.info("Running SAM segmentation …")
            vector_out = _segment_with_sam(rgb_tif, self.sam_path, self.device, tmpdir)

            import geopandas as gpd  # noqa: PLC0415
            gdf = gpd.read_file(vector_out)
            # Filter tiny noise polygons (< 0.1 ha at 10m resolution ≈ 100 pixels)
            gdf = gdf[gdf.geometry.area > 1e-8].reset_index(drop=True)
            log.info("SAM segmentation: %d field polygons after filtering", len(gdf))

            return {
                "field_count":    len(gdf),
                "fields_geojson": json.loads(gdf.to_json()),
                "source":         "gee+sam",
            }
