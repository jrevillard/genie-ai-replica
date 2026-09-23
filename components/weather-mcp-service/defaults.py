"""
Deployment fallback location and crop list shared across GENIE.AI climate services.

Read from DEFAULT_LOCATION / DEFAULT_LAT / DEFAULT_LON (root .env, Section 15).
The same variables are used by the backend, drought-monitoring,
warning_system_engine and geo-inference-worker so every service falls back to
one place. Unset = Dhaka.

EWS_CROPS lists the crops the warning_system_engine assesses. This service only
reads those assessments, so the two must agree: a crop missing here is a crop
whose alerts never reach the chat or the frontend banner.
"""

from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)

_BUILT_IN_LOCATION = "Dhaka"
_BUILT_IN_LAT = 23.8103
_BUILT_IN_LON = 90.4125

# Must match the warning_system_engine default (app/main.py DEFAULT_EWS_CROPS)
_BUILT_IN_CROPS = ("eggplant", "rice_aman", "mango", "turmeric")


def _crop_list() -> list[str]:
    raw = os.getenv("EWS_CROPS", "").strip()
    crops = [crop.strip() for crop in raw.split(",") if crop.strip()]
    if not crops:
        return list(_BUILT_IN_CROPS)
    return crops


EWS_CROPS: list[str] = _crop_list()


def _region_crop_list() -> list[str]:
    """
    Crops grown in the deployment region (REGION_CROPS), in display order.
    Every EWS crop is always included; the extra entries are crops the farmers
    grow but for which no crop profile (thresholds, calendar) exists yet, e.g.
    REGION_CROPS=rice_aman,eggplant,mango,potato with
    EWS_CROPS=eggplant,rice_aman,mango,turmeric.
    """
    raw = os.getenv("REGION_CROPS", "").strip()
    crops = [crop.strip() for crop in raw.split(",") if crop.strip()]
    for crop in EWS_CROPS:
        if crop not in crops:
            crops.append(crop)
    return crops


REGION_CROPS: list[str] = _region_crop_list()
# Region crops without a crop profile: the advisor may only give general
# weather guidance for these and must say the detailed crop data is missing.
UNPROFILED_CROPS: list[str] = [c for c in REGION_CROPS if c not in EWS_CROPS]


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
