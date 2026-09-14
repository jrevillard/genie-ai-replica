"""
AgriProcessor — agricultural field boundary delineation with Fields of The World.

Pipeline (same one the fieldsofthe.world web app runs, via ftw-tools 2.0):
  1. Area of interest: a square of half-width DELINEATION_RADIUS_KM around the
     point (capped at DELINEATION_MAX_RADIUS_KM, 5 km by default).
  2. Scene selection: two Sentinel-2 L2A scenes (planting and harvest windows)
     picked from the global crop-calendar rasters for DELINEATION_YEAR, from
     Microsoft Planetary Computer or Earth Search (no credentials needed).
  3. Inference:
       engine "ftw"                -> FTW PRUE U-Net (field / boundary / background),
                                      then polygonize (default, CC-BY checkpoint).
       engine "delineate-anything" -> DelineateAnything instance segmentation on
                                      the planting-window scene (AGPL-3 weights).
  4. Polygons are re-projected to EPSG:4326 and returned as GeoJSON.

Inference runs in a child process under a process-wide GPU lock: Lightning keeps
the model referenced after inference, so an in-process run pinned GPU memory
that the flood model then could not get. A child returns it on exit.
"""

from __future__ import annotations

import datetime as _dt
import json
import logging
import os
import re
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

from agri_engine.utils import bbox_around

log = logging.getLogger(__name__)

_SA_CANDIDATES = (
    "/app/secrets/credentials.json",
    "/app/secrets/service-account.json",
)


def _initialize_gee() -> tuple:
    """
    Authenticate Earth Engine with the mounted service-account JSON (used by the
    flood pipeline; delineation no longer needs GEE). Returns (credentials, project_id).
    """
    import ee

    sa_path = next((c for c in _SA_CANDIDATES if os.path.exists(c)), None)
    if not sa_path:
        raise FileNotFoundError(
            "GEE service account JSON not found. "
            "Mount it at /app/secrets/credentials.json in docker-compose."
        )
    data = json.loads(Path(sa_path).read_text())
    client_email = data.get("client_email")
    if not client_email:
        raise RuntimeError(f"Missing client_email in {sa_path}")
    project_id = (os.getenv("GEE_PROJECT_ID") or data.get("project_id", "")).strip()
    credentials = ee.ServiceAccountCredentials(client_email, sa_path)
    ee.Initialize(credentials=credentials, project=project_id or None)
    log.info(
        "GEE authenticated (%s, project=%s)", client_email, project_id or "<default>"
    )
    return credentials, project_id


# One GPU job at a time across delineation and flood detection (main.py imports it).
_GPU_LOCK = threading.Lock()

ENGINES = ("ftw", "delineate-anything")
_FTW_DEFAULT_MODEL = "FTW_PRUE_EFNET_B5_CCBY"
_DA_DEFAULT_MODEL = "DelineateAnything"
_DA_MODELS = ("DelineateAnything", "DelineateAnything-S")


def _env_float(name: str, default: float, lo: float, hi: float) -> float:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        log.warning("%s=%r is not a number - using %s", name, raw, default)
        return default
    return min(max(value, lo), hi)


def _env_int(name: str, default: int, lo: int, hi: int) -> int:
    return int(_env_float(name, float(default), float(lo), float(hi)))


class DelineationConfig:
    """Env-driven settings, read once per request so .env edits apply on restart."""

    def __init__(self) -> None:
        engine = os.getenv("DELINEATION_ENGINE", "ftw").strip().lower() or "ftw"
        if engine not in ENGINES:
            log.warning("DELINEATION_ENGINE=%r unknown - using 'ftw'", engine)
            engine = "ftw"
        self.engine = engine
        self.model = os.getenv("DELINEATION_MODEL", "").strip() or (
            _DA_DEFAULT_MODEL if engine == "delineate-anything" else _FTW_DEFAULT_MODEL
        )
        # Hard cap on how far from the user we look: keep the map about their farm.
        self.max_radius_km = _env_float("DELINEATION_MAX_RADIUS_KM", 5.0, 0.25, 5.0)
        self.radius_km = _env_float(
            "DELINEATION_RADIUS_KM", 2.5, 0.25, self.max_radius_km
        )
        # FTW PRUE collapses to all-background on very small tiles (a 200 px /
        # 1 km tile predicted no field and no boundary pixels at all), so
        # inference always runs on a tile of at least this half-width; the
        # polygons are then filtered to the radius the caller asked for.
        self.min_tile_km = _env_float("DELINEATION_MIN_TILE_KM", 2.5, 1.0, 5.0)
        # Crop-calendar year. The harvest window must be in the past, so the
        # previous calendar year is the safe default.
        self.year = _env_int(
            "DELINEATION_YEAR", _dt.date.today().year - 1, 2015, _dt.date.today().year
        )
        # Scene mode. "latest": window B is the lowest-cloud Sentinel-2 pass within
        # the last DELINEATION_MAX_AGE_DAYS (so the map is at most weeks old) and
        # window A a pass about DELINEATION_WINDOW_GAP_DAYS earlier for seasonal
        # contrast. "crop-calendar": ftw-tools' planting/harvest pick for DELINEATION_YEAR.
        mode = os.getenv("DELINEATION_SCENE_MODE", "latest").strip().lower() or "latest"
        self.scene_mode = mode if mode in ("latest", "crop-calendar") else "latest"
        self.max_age_days = _env_int("DELINEATION_MAX_AGE_DAYS", 42, 7, 365)
        # If nothing within max_age_days is clear over the tile (monsoon), search
        # back this far and flag the result as stale rather than mapping clouds.
        self.max_age_fallback_days = _env_int(
            "DELINEATION_MAX_AGE_FALLBACK_DAYS", 240, self.max_age_days, 730
        )
        # Cloud + shadow share allowed inside the tile (SCL band), percent. The
        # scene-wide eo:cloud_cover is useless here: a "26 % cloudy" scene was 47 %
        # cloud over the tile and produced a web of bogus boundaries.
        self.tile_cloud_max = _env_float("DELINEATION_TILE_CLOUD_MAX", 15.0, 0.0, 100.0)
        self.window_gap_days = _env_int("DELINEATION_WINDOW_GAP_DAYS", 120, 30, 300)
        host = os.getenv("DELINEATION_STAC_HOST", "mspc").strip().lower() or "mspc"
        self.stac_host = host if host in ("mspc", "earthsearch") else "mspc"
        self.cloud_cover_max = _env_int("DELINEATION_CLOUD_COVER_MAX", 20, 0, 100)
        self.buffer_days = _env_int("DELINEATION_BUFFER_DAYS", 14, 0, 120)
        self.nodata_max = _env_int("DELINEATION_NODATA_MAX", 50, 0, 100)
        # Smallholder plots here are 2-5 Sentinel-2 pixels wide: keep simplification
        # tight, keep small polygons, and thin the boundary class so plots are not
        # swallowed by it (thinning turned 235 fragments into 344 plots on a test tile).
        self.simplify_m = _env_float("DELINEATION_SIMPLIFY_M", 2.0, 0.0, 50.0)
        self.min_field_m2 = _env_float("DELINEATION_MIN_FIELD_M2", 100.0, 0.0, 1e6)
        self.thin_boundaries = os.getenv(
            "DELINEATION_THIN_BOUNDARIES", "true"
        ).lower() in ("1", "true", "yes")
        # Super-resolve both Sentinel-2 windows 10 m -> 2.5 m with ESA OpenSR SEN2SR
        # before FTW inference. On the Sapahar test tile this turned blocky 10 m
        # polygons into smooth plot outlines (1155 -> 1775 plots per km², median
        # 1200 -> 756 m²) for +4 s. The detail is model-inferred, not observed.
        self.super_resolution = os.getenv(
            "DELINEATION_SUPER_RESOLUTION", "true"
        ).lower() in ("1", "true", "yes")
        self.timeout_s = _env_int("DELINEATION_TIMEOUT_S", 600, 60, 3600)
        self.gpu = os.getenv("GPU_INFERENCE", "false").lower() in ("1", "true", "yes")

    def resolve_radius(self, requested: float | None) -> float:
        if requested is None:
            return self.radius_km
        return min(max(float(requested), 0.25), self.max_radius_km)

    def as_dict(self) -> dict:
        return {
            "engine": self.engine,
            "model": self.model,
            "radius_km": self.radius_km,
            "max_radius_km": self.max_radius_km,
            "min_tile_km": self.min_tile_km,
            "year": self.year,
            "scene_mode": self.scene_mode,
            "max_age_days": self.max_age_days,
            "max_age_fallback_days": self.max_age_fallback_days,
            "tile_cloud_max": self.tile_cloud_max,
            "window_gap_days": self.window_gap_days,
            "stac_host": self.stac_host,
            "super_resolution": self.super_resolution,
            "gpu": self.gpu,
        }


class AgriProcessor:
    def __init__(self) -> None:
        self.config = DelineationConfig()
        log.info("AgriProcessor ready - %s", self.config.as_dict())

    def process_field(
        self,
        lat: float,
        lon: float,
        radius_km: float | None = None,
        engine: str | None = None,
    ) -> dict:
        """
        Delineate agricultural field boundaries around (lat, lon).

        Returns a dict with field_count, fields_geojson, source, engine, model,
        year, radius_km, bbox and the Sentinel-2 scene ids used.
        Raises ValueError for bad input, LookupError when no usable scene exists,
        RuntimeError on any other failure.
        """
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise ValueError(f"Invalid coordinates: lat={lat}, lon={lon}")
        cfg = self.config
        if engine:
            engine = engine.strip().lower()
            if engine not in ENGINES:
                raise ValueError(
                    f"Unknown engine {engine!r}; expected one of {ENGINES}"
                )
        engine = engine or cfg.engine
        model = cfg.model
        if engine == "delineate-anything" and model not in _DA_MODELS:
            model = _DA_DEFAULT_MODEL
        elif engine == "ftw" and model in _DA_MODELS:
            model = _FTW_DEFAULT_MODEL

        radius = cfg.resolve_radius(radius_km)
        bbox = bbox_around(lat, lon, radius)
        tile_radius = max(radius, cfg.min_tile_km)
        tile_bbox = bbox_around(lat, lon, tile_radius)
        log.info(
            "Delineation: engine=%s model=%s radius=%.2f km (tile %.2f km) bbox=%s year=%d host=%s",
            engine,
            model,
            radius,
            tile_radius,
            bbox,
            cfg.year,
            cfg.stac_host,
        )

        with tempfile.TemporaryDirectory(prefix="ftw_") as tmpdir:
            job = {
                "engine": engine,
                "model": model,
                "bbox": tile_bbox,
                "result_bbox": bbox,
                "radius_km": radius,
                "tile_radius_km": tile_radius,
                "year": cfg.year,
                "scene_mode": cfg.scene_mode,
                "max_age_days": cfg.max_age_days,
                "max_age_fallback_days": cfg.max_age_fallback_days,
                "tile_cloud_max": cfg.tile_cloud_max,
                "window_gap_days": cfg.window_gap_days,
                "thin_boundaries": cfg.thin_boundaries,
                "super_resolution": cfg.super_resolution and engine == "ftw",
                "stac_host": cfg.stac_host,
                "cloud_cover_max": cfg.cloud_cover_max,
                "buffer_days": cfg.buffer_days,
                "nodata_max": cfg.nodata_max,
                "simplify_m": cfg.simplify_m,
                "min_field_m2": cfg.min_field_m2,
                "gpu": cfg.gpu,
                "out_dir": tmpdir,
            }
            job_path = Path(tmpdir) / "job.json"
            job_path.write_text(json.dumps(job))
            result_path = Path(tmpdir) / "result.json"

            with _GPU_LOCK:
                try:
                    proc = subprocess.run(
                        [sys.executable, "-m", "agri_engine.processor", str(job_path)],
                        capture_output=True,
                        text=True,
                        timeout=cfg.timeout_s,
                        # ultralytics saves DelineateAnything weights under ./weights,
                        # so run from the model volume to keep them across restarts.
                        cwd=_child_cwd(),
                    )
                except subprocess.TimeoutExpired as exc:
                    raise RuntimeError(
                        f"Delineation timed out after {cfg.timeout_s} s"
                    ) from exc
            for line in (proc.stdout or "").splitlines():
                line = line.strip()
                if line and "Completed |" not in line and not line.startswith("["):
                    log.info("[FTW] %s", line)
            if proc.returncode != 0:
                tail = (proc.stderr or "").strip().splitlines()[-25:]
                for line in tail:
                    log.error("[FTW] %s", line)
                msg = _classify_failure("\n".join(tail))
                if isinstance(msg, LookupError):
                    raise msg
                raise RuntimeError(msg)
            if not result_path.exists():
                raise RuntimeError("Delineation produced no result file")
            result = json.loads(result_path.read_text())

        log.info(
            "Delineation done: %d fields (engine=%s model=%s scenes=%s)",
            result["field_count"],
            engine,
            model,
            result.get("scenes"),
        )
        return result


def _child_cwd() -> str | None:
    if not Path("/app/agri_engine").exists():
        return None
    d = Path("/app/models/ftw-weights")
    d.mkdir(parents=True, exist_ok=True)
    return str(d)


def _classify_failure(stderr_tail: str):
    """Map a child-process failure to the exception the API should surface."""
    low = stderr_tail.lower()
    if (
        "nosceneerror" in low
        or "no scenes" in low
        or "no items" in low
        or "could not find" in low
        or "no sentinel" in low
    ):
        msg = stderr_tail.strip().splitlines()[-1] if stderr_tail.strip() else ""
        detail = (
            msg.split("NoSceneError:", 1)[1].strip() if "NoSceneError:" in msg else ""
        )
        return LookupError(
            detail
            or "No cloud-free Sentinel-2 scene found for this area; try again in a few days."
        )
    last = (
        stderr_tail.strip().splitlines()[-1] if stderr_tail.strip() else "unknown error"
    )
    return f"Delineation failed: {last}"


# ---------------------------------------------------------------------------
# Child process: runs ftw-tools and writes result.json (never imported by the API
# process, so Lightning/ultralytics stay out of the server's memory).
# ---------------------------------------------------------------------------


def _prefetch_checkpoint(model: str) -> None:
    """Download a registry checkpoint to the torch hub cache with large chunks."""
    import requests
    import torch
    from ftw_tools.inference.model_registry import MODEL_REGISTRY

    spec = MODEL_REGISTRY.get(model)
    if spec is None or spec.instance_segmentation:
        return  # DelineateAnything weights come from Hugging Face (fast path already)
    cache_dir = Path(torch.hub.get_dir()) / "checkpoints"
    cache_dir.mkdir(parents=True, exist_ok=True)
    target = cache_dir / f"{model}.ckpt"
    if target.exists():
        return
    tmp = target.with_suffix(".ckpt.part")
    print(f"prefetching checkpoint {model} from {spec.url}")
    with requests.get(spec.url, stream=True, timeout=(10, 120)) as r:
        r.raise_for_status()
        with open(tmp, "wb") as fh:
            fh.writelines(r.iter_content(chunk_size=1 << 20))
    tmp.replace(target)
    print(f"checkpoint cached at {target} ({target.stat().st_size} bytes)")


_SEN2SR_MLM = (
    "https://huggingface.co/tacofoundation/sen2sr/resolve/main/"
    "SEN2SRLite/NonReference_RGBN_x4/mlm.json"
)
_SEN2SR_DIR = Path(os.getenv("SEN2SR_MODEL_DIR", "/app/models/sen2sr/SEN2SRLite_RGBN"))
_SR_FACTOR = 4


def _super_resolve_pair(data_tif: str, out_tif: str, gpu: bool) -> None:
    """
    10 m -> 2.5 m for the 8-band FTW input (R,G,B,NIR x 2 windows) with SEN2SRLite
    RGBN, whose band order matches ftw-tools' create_input output. Writes an
    8-band uint16 GeoTIFF with the transform scaled by 4.
    """
    import mlstac
    import numpy as np
    import rasterio
    import sen2sr
    import torch

    if not (_SEN2SR_DIR / "mlm.json").exists():
        print("downloading SEN2SR weights")
        mlstac.download(file=_SEN2SR_MLM, output_dir=str(_SEN2SR_DIR))
    device = torch.device("cuda" if gpu and torch.cuda.is_available() else "cpu")
    model = mlstac.load(str(_SEN2SR_DIR)).compiled_model(device=device).to(device)

    with rasterio.open(data_tif) as src:
        bands = src.read().astype("float32") / 10_000.0
        profile = src.profile
        transform = src.transform
    h0, w0 = bands.shape[1:]
    pad_h, pad_w = (-h0) % 128, (-w0) % 128  # the model tiles at 128 px

    def sr(x):
        xp = np.pad(x, ((0, 0), (0, pad_h), (0, pad_w)), mode="reflect")
        with torch.no_grad():
            y = sen2sr.predict_large(
                model=model,
                X=torch.nan_to_num(torch.from_numpy(xp)).to(device),
                overlap=32,
            )
        y = y.squeeze(0) if y.ndim == 4 else y
        return y.cpu().numpy()[:, : h0 * _SR_FACTOR, : w0 * _SR_FACTOR]

    out = np.concatenate([sr(bands[:4]), sr(bands[4:8])])
    profile.update(
        count=8,
        dtype="uint16",
        nodata=0,
        height=out.shape[1],
        width=out.shape[2],
        transform=transform * transform.scale(1 / _SR_FACTOR, 1 / _SR_FACTOR),
    )
    with rasterio.open(out_tif, "w", **profile) as dst:
        dst.write(np.clip(out * 10_000, 0, 65535).astype("uint16"))
    del model
    if device.type == "cuda":
        torch.cuda.empty_cache()


def _class_histogram(classes_tif: str) -> dict:
    """Pixel counts per predicted class (0 background, 1 field, 2 boundary)."""
    import numpy as np
    import rasterio

    with rasterio.open(classes_tif) as src:
        arr = src.read(1)
    vals, counts = np.unique(arr, return_counts=True)
    return {int(v): int(c) for v, c in zip(vals, counts)}


class NoSceneError(LookupError):
    """No usable Sentinel-2 scene for the requested window (surfaced as HTTP 404)."""


_S2_DATE_RE = re.compile(r"S2[A-D]_MSIL2A_(\d{4})(\d{2})(\d{2})T")


def _scene_date(scene_id: str) -> str | None:
    m = _S2_DATE_RE.search(scene_id or "")
    return f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else None


# SCL classes that make a pixel unusable: nodata, saturated, cloud shadow, cloud
# medium/high probability, thin cirrus, snow.
_SCL_BAD = (0, 1, 3, 8, 9, 10, 11)


def _tile_cloud_pct(item, bbox) -> float:
    """Share of unusable pixels inside bbox, from the scene's SCL band (percent)."""
    import numpy as np
    import rasterio
    from rasterio.warp import transform_bounds
    from rasterio.windows import from_bounds

    with rasterio.open(item.assets["SCL"].href) as src:
        vb = transform_bounds("EPSG:4326", src.crs, *bbox)
        scl = src.read(1, window=from_bounds(*vb, src.transform))
    if scl.size == 0:
        return 100.0
    return float(np.isin(scl, _SCL_BAD).mean() * 100.0)


def _mspc_items(bbox, start, end):
    """Sentinel-2 L2A items over bbox in [start, end], newest first, signed."""
    import planetary_computer as pc
    import pystac_client
    from ftw_tools.settings import MSPC_URL

    catalog = pystac_client.Client.open(MSPC_URL, modifier=pc.sign_inplace)
    search = catalog.search(
        collections=["sentinel-2-l2a"],
        bbox=bbox,
        datetime=f"{start}/{end}",
        query={"eo:cloud_cover": {"lt": 95}},
    )
    items = list(search.items())
    items.sort(key=lambda i: i.datetime, reverse=True)
    return items


def _item_url(item) -> str:
    from ftw_tools.settings import MSPC_URL

    return f"{MSPC_URL}/collections/sentinel-2-l2a/items/{item.id}"


def _pick_scene(bbox, start, end, tile_cloud_max, label, newest=True):
    """
    Newest (or clearest) scene in [start, end] whose in-tile cloud share is within
    tile_cloud_max. Returns (item, tile_cloud_pct) or (None, best_pct_seen).
    """
    items = _mspc_items(bbox, start, end)
    best = None
    best_pct = 100.0
    for it in items:
        try:
            pct = _tile_cloud_pct(it, bbox)
        except Exception as exc:  # unreadable SCL: skip the scene
            print(f"{label}: {it.datetime.date()} SCL unreadable ({exc}); skipped")
            continue
        print(
            f"{label}: {it.datetime.date()} tile cloud {pct:.0f}% (scene {it.properties.get('eo:cloud_cover', -1):.0f}%)"
        )
        if pct <= tile_cloud_max:
            if newest:
                return it, pct
            if best is None or pct < best_pct:
                best, best_pct = it, pct
        elif best is None and pct < best_pct:
            best_pct = pct
    if best is not None and best_pct <= tile_cloud_max:
        return best, best_pct
    return None, best_pct


def _select_scenes(job):
    """(win_a, win_b, meta) per DELINEATION_SCENE_MODE."""
    import datetime as dt

    from ftw_tools.download.download_img import scene_selection

    bbox = job["bbox"]
    if job["scene_mode"] == "crop-calendar" or job["stac_host"] != "mspc":
        # SCL screening needs Planetary Computer assets; other hosts keep ftw's picker.
        win_a, win_b = scene_selection(
            bbox=bbox,
            year=job["year"],
            stac_host=job["stac_host"],
            cloud_cover_max=job["cloud_cover_max"],
            buffer_days=job["buffer_days"],
            s2_collection="c1",
            nodata_max=job["nodata_max"],
            verbose=False,
        )
        return win_a, win_b, {"stale": False, "tile_cloud_pct": None}

    today = dt.date.today()
    limit = job["tile_cloud_max"]
    # Window B: newest clear pass within max_age_days ...
    item_b, pct_b = _pick_scene(
        bbox, today - dt.timedelta(days=job["max_age_days"]), today, limit, "latest"
    )
    stale = False
    if item_b is None:
        # ... else the newest clear pass further back, flagged as stale.
        print(
            f"latest: nothing clear in the last {job['max_age_days']} days (best {pct_b:.0f}% cloud); searching further back"
        )
        item_b, pct_b = _pick_scene(
            bbox,
            today - dt.timedelta(days=job["max_age_fallback_days"]),
            today - dt.timedelta(days=job["max_age_days"]),
            limit,
            "fallback",
        )
        stale = True
    if item_b is None:
        raise NoSceneError(
            f"No cloud-free Sentinel-2 image over this area in the last "
            f"{job['max_age_fallback_days']} days (best pass still {pct_b:.0f}% cloud); "
            "try again after a few clear days."
        )
    b_date = item_b.datetime.date()
    # Window A: clearest pass about window_gap_days before B (widened once).
    item_a = None
    for half in (30, 60):
        centre = b_date - dt.timedelta(days=job["window_gap_days"])
        item_a, pct_a = _pick_scene(
            bbox,
            centre - dt.timedelta(days=half),
            centre + dt.timedelta(days=half),
            limit,
            "earlier",
            newest=False,
        )
        if item_a is not None:
            break
    if item_a is None:
        raise NoSceneError(
            f"No cloud-free Sentinel-2 image for the earlier window around "
            f"{(b_date - dt.timedelta(days=job['window_gap_days']))}; try again later."
        )
    return (
        _item_url(item_a),
        _item_url(item_b),
        {
            "stale": stale,
            "tile_cloud_pct": round(pct_b, 1),
            "age_days": (today - b_date).days,
        },
    )


def _child_main(job_path: str) -> None:
    import geopandas as gpd
    from ftw_tools.download.download_img import create_input

    job = json.loads(Path(job_path).read_text())
    out_dir = Path(job["out_dir"])
    bbox = job["bbox"]
    gpu = 0 if job["gpu"] else -1

    win_a, win_b, scene_meta = _select_scenes(job)
    print(f"scenes: win_a={win_a} win_b={win_b} meta={scene_meta}")

    if job["engine"] == "delineate-anything":
        from ftw_tools.inference.inference import run_instance_segmentation

        data_tif = str(out_dir / "inference_data.tif")
        polygons = str(out_dir / "inference_output.parquet")
        create_input(
            win_a=win_a,
            win_b=None,
            out=data_tif,
            overwrite=True,
            bbox=bbox,
            stac_host=job["stac_host"],
        )
        try:
            run_instance_segmentation(
                input=data_tif,
                model=job["model"],
                out=polygons,
                gpu=0 if job["gpu"] else None,
                overwrite=True,
                simplify=job["simplify_m"],
                min_size=job["min_field_m2"] or None,
            )
        except ValueError as exc:
            # ftw-tools concatenates per-patch detections; with none at all it
            # raises instead of writing an empty file. That is a zero-field result.
            if "No objects to concatenate" not in str(exc):
                raise
            print("instance segmentation: no detections in this tile")
            Path(polygons).unlink(missing_ok=True)
        scenes = {"win_a": win_a}
    else:
        from ftw_tools.inference.inference import run
        from ftw_tools.postprocess.polygonize import polygonize

        data_tif = str(out_dir / "inference_data.tif")
        classes_tif = str(out_dir / "inference_output.tif")
        polygons = str(out_dir / "polygons.parquet")
        create_input(
            win_a=win_a,
            win_b=win_b,
            out=data_tif,
            overwrite=True,
            bbox=bbox,
            stac_host=job["stac_host"],
            s2_collection="c1",
        )
        _prefetch_checkpoint(job["model"])
        resolution_m = 10.0
        if job.get("super_resolution"):
            sr_tif = str(out_dir / "inference_data_sr.tif")
            _super_resolve_pair(data_tif, sr_tif, job["gpu"])
            data_tif, resolution_m = sr_tif, 10.0 / _SR_FACTOR
            print(f"super-resolved input to {resolution_m} m")
        # FTW was trained on 10 m data upsampled x2; the 2.5 m input already carries
        # that x4, so it runs at resize_factor 1 with a larger patch.
        run(
            input=data_tif,
            model=job["model"],
            out=classes_tif,
            resize_factor=1 if job.get("super_resolution") else 2,
            gpu=gpu,
            patch_size=1024 if job.get("super_resolution") else None,
            batch_size=1,
            num_workers=0,
            padding=64 if job.get("super_resolution") else None,
            overwrite=True,
            mps_mode=False,
            save_scores=False,
        )
        print(
            f"class histogram (0 bg / 1 field / 2 boundary): {_class_histogram(classes_tif)}"
        )
        try:
            polygonize(
                input=classes_tif,
                out=polygons,
                simplify=job["simplify_m"],
                min_size=job["min_field_m2"],
                overwrite=True,
                thin_boundaries=job["thin_boundaries"],
            )
        except ValueError as exc:
            # ftw-tools raises "Unknown column geometry" when no field polygon
            # survives the size filter: a legitimate empty result, not a failure.
            if "Unknown column" not in str(exc):
                raise
            print("polygonize: no field polygons in this area")
            Path(polygons).unlink(missing_ok=True)
        scenes = {"win_a": win_a, "win_b": win_b}
        job["_resolution_m"] = resolution_m

    gdf = gpd.read_parquet(polygons) if Path(polygons).exists() else gpd.GeoDataFrame()
    if len(gdf) and gdf.crs is not None and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(4326)
    if len(gdf):
        # Keep the fields whose centre lies inside the radius the caller asked
        # for; the (possibly larger) inference tile only exists for model quality.
        minx, miny, maxx, maxy = job["result_bbox"]
        c = gdf.geometry.centroid
        gdf = gdf[(c.x >= minx) & (c.x <= maxx) & (c.y >= miny) & (c.y <= maxy)]
        gdf = gdf.reset_index(drop=True)
    if len(gdf):
        # Keep only columns the map can use; area is recomputed in m² by ftw already.
        keep = [c for c in ("id", "area", "perimeter") if c in gdf.columns]
        gdf = gdf[keep + ["geometry"]]
    result = {
        "field_count": len(gdf),
        "fields_geojson": json.loads(gdf.to_json())
        if len(gdf)
        else {"type": "FeatureCollection", "features": []},
        "source": f"sentinel2{'-sr2.5m' if job.get('_resolution_m', 10) < 10 else ''}+{job['model']}",
        "resolution_m": job.get("_resolution_m", 10.0),
        "engine": job["engine"],
        "model": job["model"],
        "year": job["year"],
        "bbox": job["result_bbox"],
        "radius_km": job["radius_km"],
        "inference_bbox": bbox,
        "inference_radius_km": job["tile_radius_km"],
        "scenes": scenes,
        "image_dates": {k: _scene_date(v) for k, v in scenes.items()},
        # Date of the newest image the map is based on (window B, else window A).
        "image_date": _scene_date(scenes.get("win_b") or scenes.get("win_a") or ""),
        "image_age_days": scene_meta.get("age_days"),
        "image_stale": scene_meta.get("stale", False),
        "tile_cloud_pct": scene_meta.get("tile_cloud_pct"),
        "scene_mode": job["scene_mode"],
    }
    (out_dir / "result.json").write_text(json.dumps(result))
    print(f"fields: {result['field_count']}")


if __name__ == "__main__":
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper())
    _child_main(sys.argv[1])
