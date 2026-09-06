"""
Geodesic buffer creation around a point using pyproj WGS84 ellipsoid.
"""
import json
import pyproj


def create_buffer(latitude: float, longitude: float, radius_km: float) -> str:
    """
    Create a geodetically accurate circular buffer polygon around the given coordinates.

    Uses pyproj.Geod to project 37 points (every 10 degrees) on the WGS84 ellipsoid
    at the given radius, then returns the ring as a GeoJSON Polygon dict.

    Args:
        latitude:  Centre latitude in decimal degrees.
        longitude: Centre longitude in decimal degrees.
        radius_km: Buffer radius in kilometres.

    Returns:
        JSON string of a GeoJSON Polygon (not wrapped in a Feature).
    """
    geod = pyproj.Geod(ellps="WGS84")
    boundary = []

    for i in range(37):  # 0-360 in steps of 10 degrees, last point closes the ring
        angle = i * 10
        lon_pt, lat_pt, _ = geod.fwd(
            lons=longitude, lats=latitude, az=angle, dist=radius_km * 1000
        )
        boundary.append([lon_pt, lat_pt])

    polygon = {"type": "Polygon", "coordinates": [boundary]}
    return json.dumps(polygon)
