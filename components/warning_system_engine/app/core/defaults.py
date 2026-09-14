"""
Deployment fallback location shared across GENIE.AI climate services.

Read from DEFAULT_LOCATION / DEFAULT_LAT / DEFAULT_LON (root .env, Section 15).
The same variables are used by the backend, weather-mcp-service,
drought-monitoring and geo-inference-worker so every service falls back to one
place. The fallback district is always registered in the engine's district
tables so every pipeline (potato, flood, seasonal, drought) assesses it.
Unset = Dhaka.
"""

from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)

_BUILT_IN_LOCATION = "Dhaka"
_BUILT_IN_LAT = 23.8103
_BUILT_IN_LON = 90.4125


def _coord(name: str, fallback: float, limit: float) -> float:
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


DEFAULT_LOCATION: str = os.getenv("DEFAULT_LOCATION", "").strip() or _BUILT_IN_LOCATION
DEFAULT_LAT: float = _coord("DEFAULT_LAT", _BUILT_IN_LAT, 90.0)
DEFAULT_LON: float = _coord("DEFAULT_LON", _BUILT_IN_LON, 180.0)
DEFAULT_COORDS: tuple[float, float] = (DEFAULT_LAT, DEFAULT_LON)


def ensure_default_district(coords: dict[str, tuple[float, float]]) -> None:
    """Register the fallback district in a district->(lat, lon) table if missing."""
    coords.setdefault(DEFAULT_LOCATION, DEFAULT_COORDS)


def ensure_default_in_list(districts: list[str]) -> None:
    """Append the fallback district to a district-name list if missing."""
    if DEFAULT_LOCATION not in districts:
        districts.append(DEFAULT_LOCATION)
