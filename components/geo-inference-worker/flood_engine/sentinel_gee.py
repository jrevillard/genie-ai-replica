"""
Download a Sentinel-2 L2A median composite from GEE for Prithvi flood inference.

Output: GeoTIFF with 6 bands in order B2, B3, B4, B8A, B11, B12 (reflectance ×10000).
The Prithvi-EO-2.0 model's config.yaml selects these 6 bands by index.
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
from datetime import date, timedelta
from pathlib import Path

import ee
import numpy as np

log = logging.getLogger(__name__)

# GEE band names in the order Prithvi expects (B2=Blue, B3=Green, B4=Red, B8A=RedEdge, B11=SWIR1, B12=SWIR2)
_S2_BANDS   = ["B2", "B3", "B4", "B8A", "B11", "B12"]
_AOI_BUFFER = 5500   # metres — ~11×11 km patch, fits one 512-px Prithvi tile at 20m


def _cloud_mask(image: ee.Image) -> ee.Image:
    """SCL-based cloud/shadow mask for S2 SR."""
    scl = image.select("SCL")
    bad = (scl.eq(0).Or(scl.eq(1)).Or(scl.eq(2))
              .Or(scl.eq(3)).Or(scl.eq(8)).Or(scl.eq(9))
              .Or(scl.eq(10)).Or(scl.eq(11)))
    return image.updateMask(bad.Not())


def download_sentinel2(
    lat: float,
    lon: float,
    output_path: Path,
    lookback_days: int = 30,
) -> None:
    """
    Fetch a cloud-free S2 median composite from GEE and write it as a GeoTIFF.

    Authenticates via EE credentials already initialized by the caller.
    Raises RuntimeError if no imagery is available.
    """
    aoi  = ee.Geometry.Point([lon, lat]).buffer(_AOI_BUFFER).bounds()
    end  = date.today()
    start = end - timedelta(days=lookback_days)

    collection = (
        ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterBounds(aoi)
        .filterDate(start.isoformat(), end.isoformat())
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 60))
        .map(_cloud_mask)
        .select(_S2_BANDS)
    )

    count = collection.size().getInfo()
    if count == 0:
        raise RuntimeError(
            f"No Sentinel-2 scenes found for ({lat:.4f}, {lon:.4f}) "
            f"in the last {lookback_days} days (cloud < 60%)."
        )
    log.info("S2 collection: %d scenes available, computing median composite", count)

    composite = collection.median()

    import geemap
    geemap.download_ee_image(
        image=composite,
        filename=str(output_path),
        scale=20,
        region=aoi,
        crs="EPSG:4326",
    )

    if not output_path.exists() or output_path.stat().st_size == 0:
        raise RuntimeError(f"GEE download produced no output at {output_path}")

    log.info("S2 composite downloaded to %s (%d bytes)", output_path, output_path.stat().st_size)
