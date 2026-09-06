import math

import ee
import pandas as pd
import requests

from utils.utils import SMAP_BANDS


def bbox_area_km2(bbox):
    """
    bbox = [W, S, E, N]
    returns approximate km²
    """
    W, S, E, N = bbox

    # Mean latitude
    mean_lat = math.radians((S + N) / 2)

    # km per degree
    km_per_deg_lat = 111.32
    km_per_deg_lon = 111.32 * math.cos(mean_lat)

    width_km = abs(E - W) * km_per_deg_lon
    height_km = abs(N - S) * km_per_deg_lat

    return width_km * height_km


def get_district_info(lat: float, lon: float) -> dict:
    """
    Returns {'district': str, 'division': str, 'country': str, 'bbox': [W,S,E,N]}
    Falls back gracefully if Nominatim is unreachable.
    """
    url = "https://nominatim.openstreetmap.org/reverse"
    params = {
        "lat": lat,
        "lon": lon,
        "format": "jsonv2",
        "zoom": 10,
        "addressdetails": 1,
        "accept-language": "en",
    }
    headers = {"User-Agent": "DroughtMonitor/1.0"}

    try:
        r = requests.get(url, params=params, headers=headers, timeout=10)
        r.raise_for_status()
        data = r.json()

        addr = data.get("address", {})
        district = (
            addr.get("county")
            or addr.get("state_district")
            or addr.get("city")
            or addr.get("town")
            or "Unknown district"
        )
        division = addr.get("state", "Unknown division")
        country = addr.get("country", "Unknown country")

        # Nominatim bbox: [S, N, W, E] → reorder to [W, S, E, N]
        bb = data.get("boundingbox")
        bbox = (
            [float(bb[2]), float(bb[0]), float(bb[3]), float(bb[1])]
            if bb and len(bb) == 4
            else [lon - 0.5, lat - 0.5, lon + 0.5, lat + 0.5]
        )

        return {
            "district": district,
            "division": division,
            "country": country,
            "bbox": bbox,
            "area_km2": bbox_area_km2(bbox),
        }

    except Exception as exc:
        print(f"  [geocoder] Warning: {exc}. Using 0.5° buffer around point.")
        return {
            "district": f"Area around ({lat:.3f}, {lon:.3f})",
            "division": "Unknown",
            "country": "Unknown",
            "bbox": [lon - 0.5, lat - 0.5, lon + 0.5, lat + 0.5],
            "area_km2": bbox_area_km2([lon - 0.5, lat - 0.5, lon + 0.5, lat + 0.5]),
        }


def make_geometry(bbox: list) -> ee.Geometry:
    W, S, E, N = bbox
    return ee.Geometry.Rectangle([W, S, E, N])


def reduce_smap(img: ee.Image, geom: ee.Geometry) -> ee.Feature:
    stats = img.reduceRegion(
        reducer=ee.Reducer.mean(),
        geometry=geom,
        scale=11000,
        maxPixels=1e9,
    )
    out = {"date": img.date().format("YYYY-MM-dd")}
    for b in SMAP_BANDS:
        out[b] = stats.get(b)
    return ee.Feature(None, out)


def reduce_ndvi(img: ee.Image, geom: ee.Geometry) -> ee.Feature:
    stats = img.reduceRegion(
        reducer=ee.Reducer.mean(),
        geometry=geom,
        scale=1000,
        maxPixels=1e9,
    )
    ndvi = ee.Number(stats.get("NDVI")).multiply(0.0001)
    return ee.Feature(
        None,
        {
            "date": img.date().format("YYYY-MM-dd"),
            "NDVI": ndvi,
        },
    )


def features_to_df(features: list) -> pd.DataFrame:
    rows = [f["properties"] for f in features]
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    df["date"] = pd.to_datetime(df["date"])
    numeric_cols = df.columns.difference(["date"])
    df[numeric_cols] = df[numeric_cols].apply(pd.to_numeric, errors="coerce")
    return df.sort_values("date").reset_index(drop=True)
