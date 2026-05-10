from dataclasses import dataclass

BAND_LABELS = {
    "sm_surface": "Soil Moisture (m³/m³)",
    "land_evapotranspiration_flux": "Evapotranspiration (mm/day)",
    "overland_runoff_flux": "Runoff (mm/day)",
    "NDVI": "Vegetation Index (NDVI)",
}

SMAP_BANDS: dict[str, float] = {
    "sm_surface": 1,
    "overland_runoff_flux": 86400,
    "land_evapotranspiration_flux": 86400,
}

LEVEL_STYLE = {
    "SEVERE": "SEVERE DROUGHT",
    "MODERATE": "MODERATE DROUGHT",
    "WATCH": "DROUGHT WATCH",
    "NORMAL": "NORMAL CONDITIONS",
}
# ── shared config ─────────────────────────────────────────────

BAND_LABELS = {
    "sm_surface": "Soil Moisture\n(water in soil)",
    "land_evapotranspiration_flux": "Evapotranspiration\n(Water Lost by Plants)",
    "overland_runoff_flux": "Surface Runoff\n(Water Flowing Over Land)",
    "NDVI": "How Green Are the Crops?",
}

BAND_UNITS = {
    "sm_surface": "m³/m³",
    "land_evapotranspiration_flux": "mm/day",
    "overland_runoff_flux": "mm/day",
    "NDVI": "index",
}

BAND_PLAIN_MEANING = {
    "sm_surface": "Higher soil moisture = better water for crops.",
    "land_evapotranspiration_flux": "Low values can mean plant stress.",
    "overland_runoff_flux": "Low runoff can mean low recent rainfall.",
    "NDVI": "Higher NDVI = greener, healthier crops.",
}


@dataclass
class Threshold:
    good_mean: float
    drought_mean: float
    alert_thresh: float


@dataclass
class Thresholds:
    sm_surface: Threshold
    land_evapotranspiration_flux: Threshold
    overland_runoff_flux: Threshold
    NDVI: Threshold

    def get(self, band: str) -> Threshold:
        return getattr(self, band)

    def bands(self) -> list[str]:
        return list(self.__dataclass_fields__.keys())


THRESHOLDS = Thresholds(
    sm_surface=Threshold(
        good_mean=0.3058,
        drought_mean=0.0955,
        alert_thresh=0.2585,
    ),
    land_evapotranspiration_flux=Threshold(
        good_mean=3.9307,
        drought_mean=1.6765,
        alert_thresh=3.1528,
    ),
    overland_runoff_flux=Threshold(
        good_mean=1.6691,
        drought_mean=0.0636,
        alert_thresh=0.8663,
    ),
    NDVI=Threshold(
        good_mean=0.4331,
        drought_mean=0.3691,
        alert_thresh=0.4011,
    ),
)


@dataclass
class BandResult:
    band: str
    value: float | None
    flag: int
    status: str
    pct_of_threshold: float | None


ALL_BANDS = THRESHOLDS.bands()
