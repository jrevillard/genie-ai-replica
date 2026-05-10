import json
from pathlib import Path


def create_aoi_file(lat: float, lon: float, output_path: str = "/tmp/aoi.geojson", buffer: float = 0.02) -> str:
    """Write a GeoJSON bounding box around (lat, lon) as required by agribound.delineate()."""
    bbox = {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [lon - buffer, lat - buffer],
                    [lon + buffer, lat - buffer],
                    [lon + buffer, lat + buffer],
                    [lon - buffer, lat + buffer],
                    [lon - buffer, lat - buffer],
                ]],
            },
            "properties": {"name": "AOI"},
        }],
    }
    Path(output_path).write_text(json.dumps(bbox))
    return output_path
