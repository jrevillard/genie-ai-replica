"""Convert a Prithvi flood mask raster to a GeoJSON FeatureCollection."""
from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import rasterio
from rasterio.features import shapes

log = logging.getLogger(__name__)

_NODATA = 255


def vectorize_flood_mask(mask_tif: Path) -> dict:
    """
    Read the uint8 Prithvi output and return a GeoJSON FeatureCollection
    plus summary statistics.

    Returns a plain dict — JSON-serialisable, no spatial dependencies on caller.
    """
    with rasterio.open(mask_tif) as src:
        data      = src.read(1)
        transform = src.transform

    flood_px = int((data == 1).sum())
    valid_px  = int((data != _NODATA).sum())
    fraction  = float(flood_px / valid_px) if valid_px > 0 else 0.0

    flood_binary = (data == 1).astype(np.uint8)
    features = []
    for geom, value in shapes(flood_binary, transform=transform):
        if value == 1:
            features.append({
                "type": "Feature",
                "geometry": geom,
                "properties": {"class": "flood"},
            })

    log.info(
        "Vectorized flood mask: %d polygons, %d/%d px flooded (%.1f%%)",
        len(features), flood_px, valid_px, fraction * 100,
    )

    return {
        "type": "FeatureCollection",
        "features": features,
        "flood_pixel_count": flood_px,
        "valid_pixel_count": valid_px,
        "flood_fraction": round(fraction, 4),
    }
