"""Small geodesic helpers for the delineation area of interest."""

from __future__ import annotations

import math

_KM_PER_DEG_LAT = 111.32


def bbox_around(lat: float, lon: float, radius_km: float) -> list[float]:
    """
    Square bounding box [minx, miny, maxx, maxy] (EPSG:4326) whose half-width is
    ``radius_km`` around (lat, lon). Longitude is scaled by cos(lat); longitudes
    are wrapped to [-180, 180] and latitudes clamped to the valid range.
    """
    dlat = radius_km / _KM_PER_DEG_LAT
    cos_lat = max(math.cos(math.radians(lat)), 1e-6)
    dlon = radius_km / (_KM_PER_DEG_LAT * cos_lat)
    miny = max(lat - dlat, -90.0)
    maxy = min(lat + dlat, 90.0)
    minx = ((lon - dlon + 180.0) % 360.0) - 180.0
    maxx = ((lon + dlon + 180.0) % 360.0) - 180.0
    return [round(minx, 6), round(miny, 6), round(maxx, 6), round(maxy, 6)]
