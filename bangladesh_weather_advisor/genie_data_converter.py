"""
GENIE.AI data converter for Bangladesh climate/agriculture pipeline.

This module converts pipeline CSV outputs into:
1) Markdown knowledge documents (for GENIE.AI dataprep ingestion)
2) Metadata JSONL (document-level metadata)
3) Arango-ready JSONL document records

Usage::

    python -m production_pipeline.genie_data_converter \
        --input-dir ./data/csv_inputs \
        --output-dir ./genie_outputs
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import pandas as pd


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Label:
    category: str
    service: str


HIERARCHY: Dict[str, Dict[str, str]] = {
    "drought_monitoring": {
        "category": "Drought Monitoring",
        "service": "SPI & SPEI Drought Index",
    },
    "rainfall_daily": {
        "category": "Rainfall & Climate",
        "service": "Daily Rainfall",
    },
    "rainfall_climatology": {
        "category": "Rainfall & Climate",
        "service": "Rainfall Climatology",
    },
    "temperature_evaporation": {
        "category": "Rainfall & Climate",
        "service": "Temperature & Evaporation",
    },
    "temperature_evaporation_climatology": {
        "category": "Rainfall & Climate",
        "service": "Temperature & Evaporation Climatology",
    },
    "agriculture_crops": {
        "category": "Agriculture",
        "service": "Crop Distribution",
    },
    "district_soil": {
        "category": "District Profiles",
        "service": "Soil Properties",
    },
    "district_boundaries": {
        "category": "District Profiles",
        "service": "Administrative Boundaries",
    },
}


def _label(key: str) -> Label:
    cfg = HIERARCHY[key]
    return Label(category=cfg["category"], service=cfg["service"])


def _slugify(value: str) -> str:
    value = (value or "unknown").strip().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-") or "unknown"


def _safe_float(value: Any, digits: int = 2) -> Optional[float]:
    if pd.isna(value):
        return None
    try:
        return round(float(value), digits)
    except Exception:
        return None


def _fmt(value: Any, digits: int = 2, suffix: str = "") -> str:
    fv = _safe_float(value, digits=digits)
    if fv is None:
        return "N/A"
    return f"{fv:.{digits}f}{suffix}"


def _classify_spi_spei(v: Any) -> str:
    f = _safe_float(v, digits=3)
    if f is None:
        return "Unknown"
    if f <= -2.0:
        return "Extreme Drought"
    if f <= -1.5:
        return "Severe Drought"
    if f <= -1.0:
        return "Moderate Drought"
    if f <= -0.5:
        return "Mild Drought"
    if f < 0.5:
        return "Near Normal"
    if f < 1.0:
        return "Slightly Wet"
    if f < 1.5:
        return "Moderately Wet"
    return "Very Wet"


def _rainfall_status(mm: Any) -> str:
    f = _safe_float(mm)
    if f is None:
        return "Unknown"
    if f < 1:
        return "Very Dry"
    if f < 5:
        return "Light Rain"
    if f < 20:
        return "Moderate Rain"
    if f < 50:
        return "Heavy Rain"
    return "Very Heavy Rain"


def _today_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sha_key(text: str, length: int = 16) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:length]


class GenieDataConverter:
    """Convert climate/agriculture CSVs into GENIE-ready markdown + metadata."""

    def __init__(self, input_dir: Path, output_dir: Path):
        self.input_dir = Path(input_dir)
        self.output_dir = Path(output_dir)
        self.docs_root = self.output_dir / "markdown_docs"
        self.meta_root = self.output_dir / "metadata"
        self.docs_root.mkdir(parents=True, exist_ok=True)
        self.meta_root.mkdir(parents=True, exist_ok=True)

        self.metadata_records: List[Dict[str, Any]] = []
        self.arango_documents: List[Dict[str, Any]] = []

    def convert_all(self) -> Dict[str, Any]:
        csv_paths = sorted(self.input_dir.glob("*.csv"))
        if not csv_paths:
            raise FileNotFoundError(f"No CSV files found in {self.input_dir}")

        logger.info("Found %d CSV files in %s", len(csv_paths), self.input_dir)
        generated = 0
        for csv_path in csv_paths:
            try:
                df = pd.read_csv(csv_path, low_memory=False)
            except Exception as exc:
                logger.error("Failed to read CSV %s: %s", csv_path.name, exc)
                continue

            if df.empty:
                logger.warning("Skipping empty CSV: %s", csv_path.name)
                continue

            logger.info(
                "Processing %s — %d rows, %d cols, columns: %s",
                csv_path.name, len(df), len(df.columns), list(df.columns),
            )
            try:
                n = self._dispatch_conversion(csv_path.name, df)
                logger.info("  → generated %d documents from %s", n, csv_path.name)
                generated += n
            except Exception as exc:
                logger.error(
                    "Conversion FAILED for %s: %s — falling back to generic",
                    csv_path.name, exc, exc_info=True,
                )
                try:
                    n = self._convert_generic_reference(df, csv_path.name)
                    logger.info("  → generic fallback produced %d doc(s) for %s", n, csv_path.name)
                    generated += n
                except Exception as exc2:
                    logger.error("Generic fallback also failed for %s: %s", csv_path.name, exc2)

        manifest = self._write_outputs(generated)
        return manifest

    def _dispatch_conversion(self, filename: str, df: pd.DataFrame) -> int:
        lower = filename.lower()
        cols = {c.lower() for c in df.columns}

        # Drought indicators (SPI/SPEI or anomaly products)
        if {"spi-1", "spi-3", "spi-6"}.issubset(cols) or {"spei-1", "spei-3", "spei-6"}.issubset(cols):
            logger.debug("  Matched: drought_indices for %s", filename)
            return self._convert_drought_indices(df, filename)

        # Rainfall daily + climatology
        if {"district_id", "district_name", "date", "rainfall_mm"}.issubset(cols):
            logger.debug("  Matched: rainfall_daily for %s", filename)
            return self._convert_rainfall_daily(df, filename)
        if {"district_id", "day_of_year", "mean_mm", "std_mm"}.issubset(cols):
            logger.debug("  Matched: rainfall_climatology for %s", filename)
            return self._convert_rainfall_climatology(df, filename)

        # Temperature/evaporation
        if {"district_id", "district_name", "date", "temperature_c", "evaporation_mm"}.issubset(cols):
            logger.debug("  Matched: era5_daily for %s", filename)
            return self._convert_era5_daily(df, filename)
        if {"district_id", "day_of_year", "temperature_c_mean", "evaporation_mm_mean"}.issubset(cols):
            logger.debug("  Matched: era5_climatology for %s", filename)
            return self._convert_era5_climatology(df, filename)

        # Static datasets
        if {"district_id", "district_name", "crop", "area_ha", "yield_t_ha"}.issubset(cols):
            logger.debug("  Matched: crop_distribution for %s", filename)
            return self._convert_crop_distribution(df, filename)
        if {"district_id", "district_name", "soil_region", "ph", "soc_g_kg"}.issubset(cols):
            logger.debug("  Matched: soil_properties for %s", filename)
            return self._convert_soil_properties(df, filename)
        if {"district_id", "district_name", "geometry_wkt"}.issubset(cols):
            logger.debug("  Matched: boundaries for %s", filename)
            return self._convert_boundaries(df, filename)

        logger.debug("  No specialized match for %s — using generic", filename)
        return self._convert_generic_reference(df, filename)

    def _build_doc_path(self, label: Label, doc_name: str) -> Path:
        category_slug = _slugify(label.category)
        service_slug = _slugify(label.service)
        target_dir = self.docs_root / category_slug / service_slug
        target_dir.mkdir(parents=True, exist_ok=True)
        return target_dir / f"{doc_name}.md"

    def _register_document(
        self,
        markdown: str,
        doc_path: Path,
        label: Label,
        metadata: Dict[str, Any],
    ) -> None:
        doc_path.write_text(markdown, encoding="utf-8")

        record = {
            "doc_id": metadata["doc_id"],
            "file_path": str(doc_path),
            "source_file": metadata.get("source_file"),
            "category_label": label.category,
            "service_label": label.service,
            "district_id": metadata.get("district_id"),
            "district_name": metadata.get("district_name"),
            "record_date": metadata.get("record_date"),
            "period": metadata.get("period"),
            "data_quality": metadata.get("data_quality", "UNKNOWN"),
            "tags": metadata.get("tags", []),
            "source": metadata.get("source", "unknown"),
            "created_at_utc": _today_utc_iso(),
        }
        self.metadata_records.append(record)

        arango_doc = {
            "_key": metadata["doc_id"],
            "doc_type": "knowledge_document",
            "title": metadata.get("title", doc_path.stem),
            "text": markdown,
            "metadata": record,
        }
        self.arango_documents.append(arango_doc)

    def _convert_drought_indices(self, df: pd.DataFrame, source_file: str) -> int:
        label = _label("drought_monitoring")
        df = df.copy()
        if "date" in df.columns:
            df["date"] = pd.to_datetime(df["date"], errors="coerce")
        date_col = "date" if "date" in df.columns else None

        district_col = "district_name" if "district_name" in df.columns else "district"
        id_col = "district_id" if "district_id" in df.columns else None

        group_cols = [district_col]
        if id_col:
            group_cols.append(id_col)

        count = 0
        for keys, grp in df.groupby(group_cols, dropna=False):
            if not isinstance(keys, tuple):
                keys = (keys,)
            district_name = str(keys[0])
            district_id = str(keys[1]) if len(keys) > 1 and pd.notna(keys[1]) else f"UNK-{_slugify(district_name)}"

            grp = grp.sort_values(date_col) if date_col else grp
            latest = grp.iloc[-1]
            latest_date = latest[date_col].strftime("%Y-%m-%d") if date_col and pd.notna(latest[date_col]) else "N/A"

            spi1 = latest.get("SPI-1", latest.get("spi_1"))
            spi3 = latest.get("SPI-3", latest.get("spi_3"))
            spi6 = latest.get("SPI-6", latest.get("spi_6"))
            spei1 = latest.get("SPEI-1", latest.get("spei_1"))
            spei3 = latest.get("SPEI-3", latest.get("spei_3"))
            spei6 = latest.get("SPEI-6", latest.get("spei_6"))

            drought_class = _classify_spi_spei(spi3 if pd.notna(spi3) else spei3)

            interpretation = (
                f"Based on current indices, {district_name} is experiencing **{drought_class.lower()}** conditions. "
                "Short-term water stress should be monitored and local advisories should be updated."
            )

            markdown = f"""# Drought Status: {district_name} District

**Date:** {latest_date}
**Location:** {district_name} ({district_id})
**Data Quality:** {latest.get('quality_flag', 'OK')}

## Current Drought Indices

### Short-term (1-month)
- **SPI-1:** {_fmt(spi1)} ({_classify_spi_spei(spi1)})
- **SPEI-1:** {_fmt(spei1)} ({_classify_spi_spei(spei1)})

### Medium-term (3-month)
- **SPI-3:** {_fmt(spi3)} ({_classify_spi_spei(spi3)})
- **SPEI-3:** {_fmt(spei3)} ({_classify_spi_spei(spei3)})

### Long-term (6-month)
- **SPI-6:** {_fmt(spi6)} ({_classify_spi_spei(spi6)})
- **SPEI-6:** {_fmt(spei6)} ({_classify_spi_spei(spei6)})

## Interpretation

{interpretation}

## Recommended Actions

- Intensify district-level rainfall and soil moisture monitoring
- Encourage drought-resilient crop and irrigation practices
- Activate local agricultural extension advisories for vulnerable unions

---
*Source: {latest.get('source', source_file)}*
*Last updated: {latest_date}*
"""
            period = latest[date_col].strftime("%Y-%m") if date_col and pd.notna(latest[date_col]) else "unknown"
            doc_name = f"drought_{_slugify(district_id)}_{period}"
            doc_id = _sha_key(doc_name + source_file)
            doc_path = self._build_doc_path(label, doc_name)

            metadata = {
                "doc_id": doc_id,
                "title": f"Drought Status: {district_name}",
                "source_file": source_file,
                "district_id": district_id,
                "district_name": district_name,
                "record_date": latest_date,
                "period": period,
                "data_quality": latest.get("quality_flag", "OK"),
                "source": latest.get("source", source_file),
                "tags": ["drought", "spi", "spei", district_name],
            }
            self._register_document(markdown, doc_path, label, metadata)
            count += 1

        return count

    def _convert_rainfall_daily(self, df: pd.DataFrame, source_file: str) -> int:
        label = _label("rainfall_daily")
        df = df.copy()
        df["date"] = pd.to_datetime(df["date"], errors="coerce")

        count = 0
        for (district_id, district_name), grp in df.groupby(["district_id", "district_name"], dropna=False):
            grp = grp.dropna(subset=["date"]).sort_values("date")
            if grp.empty:
                continue

            latest = grp.iloc[-1]
            latest_date = latest["date"].strftime("%Y-%m-%d")
            tail30 = grp[grp["date"] >= grp["date"].max() - pd.Timedelta(days=29)]

            markdown = f"""# Rainfall Summary: {district_name} District

**Date:** {latest_date}
**Location:** {district_name} ({district_id})

## Recent Rainfall (30-day window)
- **Latest daily rainfall:** {_fmt(latest.get('rainfall_mm'), suffix=' mm')}
- **30-day mean rainfall:** {_fmt(tail30['rainfall_mm'].mean(), suffix=' mm')}
- **30-day total rainfall:** {_fmt(tail30['rainfall_mm'].sum(), suffix=' mm')}
- **Status:** {_rainfall_status(latest.get('rainfall_mm'))}

## Interpretation
Recent district rainfall suggests **{_rainfall_status(latest.get('rainfall_mm')).lower()}** conditions on the latest observation date.

---
*Source: {latest.get('source', source_file)}*
*Last updated: {latest_date}*
"""
            period = latest["date"].strftime("%Y-%m")
            doc_name = f"rainfall_{_slugify(str(district_id))}_{period}"
            doc_id = _sha_key(doc_name + source_file)
            doc_path = self._build_doc_path(label, doc_name)

            metadata = {
                "doc_id": doc_id,
                "title": f"Rainfall Summary: {district_name}",
                "source_file": source_file,
                "district_id": str(district_id),
                "district_name": str(district_name),
                "record_date": latest_date,
                "period": period,
                "data_quality": latest.get("quality_flag", "OK"),
                "source": latest.get("source", source_file),
                "tags": ["rainfall", "chirps", str(district_name)],
            }
            self._register_document(markdown, doc_path, label, metadata)
            count += 1

        return count

    def _convert_rainfall_climatology(self, df: pd.DataFrame, source_file: str) -> int:
        label = _label("rainfall_climatology")
        count = 0
        for district_id, grp in df.groupby("district_id", dropna=False):
            grp = grp.sort_values("day_of_year")
            p50 = _fmt(grp["p50"].mean(), suffix=" mm") if "p50" in grp.columns else "N/A"
            p90 = _fmt(grp["p90"].mean(), suffix=" mm") if "p90" in grp.columns else "N/A"
            mean_mm = _fmt(grp["mean_mm"].mean(), suffix=" mm")

            markdown = f"""# Rainfall Climatology: District {district_id}

## Climatology Summary
- **Mean daily climatological rainfall:** {mean_mm}
- **Median (P50) rainfall benchmark:** {p50}
- **Upper percentile (P90) benchmark:** {p90}
- **Coverage:** {len(grp)} day-of-year records

## Interpretation
This document provides district climatology baselines used for anomaly and drought computations.

---
*Source: {grp['source'].iloc[0] if 'source' in grp.columns else source_file}*
"""
            doc_name = f"rainfall_climatology_{_slugify(str(district_id))}"
            doc_id = _sha_key(doc_name + source_file)
            doc_path = self._build_doc_path(label, doc_name)

            metadata = {
                "doc_id": doc_id,
                "title": f"Rainfall Climatology: {district_id}",
                "source_file": source_file,
                "district_id": str(district_id),
                "district_name": None,
                "record_date": None,
                "period": "climatology",
                "data_quality": "OK",
                "source": grp["source"].iloc[0] if "source" in grp.columns else source_file,
                "tags": ["rainfall", "climatology", str(district_id)],
            }
            self._register_document(markdown, doc_path, label, metadata)
            count += 1
        return count

    def _convert_era5_daily(self, df: pd.DataFrame, source_file: str) -> int:
        label = _label("temperature_evaporation")
        df = df.copy()
        df["date"] = pd.to_datetime(df["date"], errors="coerce")
        count = 0

        for (district_id, district_name), grp in df.groupby(["district_id", "district_name"], dropna=False):
            grp = grp.dropna(subset=["date"]).sort_values("date")
            if grp.empty:
                continue
            latest = grp.iloc[-1]
            latest_date = latest["date"].strftime("%Y-%m-%d")

            markdown = f"""# Temperature & Evaporation: {district_name} District

**Date:** {latest_date}
**Location:** {district_name} ({district_id})

## Current Conditions
- **Air temperature:** {_fmt(latest.get('temperature_c'), suffix=' °C')}
- **Evaporation:** {_fmt(latest.get('evaporation_mm'), suffix=' mm')}

## 30-day Aggregates
- **Mean temperature (30-day):** {_fmt(grp.tail(30)['temperature_c'].mean(), suffix=' °C')}
- **Mean evaporation (30-day):** {_fmt(grp.tail(30)['evaporation_mm'].mean(), suffix=' mm')}

---
*Source: {latest.get('source', source_file)}*
*Last updated: {latest_date}*
"""
            period = latest["date"].strftime("%Y-%m")
            doc_name = f"era5_{_slugify(str(district_id))}_{period}"
            doc_id = _sha_key(doc_name + source_file)
            doc_path = self._build_doc_path(label, doc_name)

            metadata = {
                "doc_id": doc_id,
                "title": f"Temperature & Evaporation: {district_name}",
                "source_file": source_file,
                "district_id": str(district_id),
                "district_name": str(district_name),
                "record_date": latest_date,
                "period": period,
                "data_quality": latest.get("quality_flag", "OK"),
                "source": latest.get("source", source_file),
                "tags": ["era5", "temperature", "evaporation", str(district_name)],
            }
            self._register_document(markdown, doc_path, label, metadata)
            count += 1

        return count

    def _convert_era5_climatology(self, df: pd.DataFrame, source_file: str) -> int:
        label = _label("temperature_evaporation_climatology")
        count = 0
        for district_id, grp in df.groupby("district_id", dropna=False):
            markdown = f"""# ERA5 Climatology: District {district_id}

## Baseline Summary
- **Mean temperature climatology:** {_fmt(grp['temperature_c_mean'].mean(), suffix=' °C')}
- **Mean evaporation climatology:** {_fmt(grp['evaporation_mm_mean'].mean(), suffix=' mm')}
- **Coverage:** {len(grp)} day-of-year baseline records

## Purpose
This baseline supports anomaly detection and drought index calculations.

---
*Source: {grp['source'].iloc[0] if 'source' in grp.columns else source_file}*
"""
            doc_name = f"era5_climatology_{_slugify(str(district_id))}"
            doc_id = _sha_key(doc_name + source_file)
            doc_path = self._build_doc_path(label, doc_name)
            metadata = {
                "doc_id": doc_id,
                "title": f"ERA5 Climatology: {district_id}",
                "source_file": source_file,
                "district_id": str(district_id),
                "district_name": None,
                "record_date": None,
                "period": "climatology",
                "data_quality": "OK",
                "source": grp["source"].iloc[0] if "source" in grp.columns else source_file,
                "tags": ["era5", "climatology", str(district_id)],
            }
            self._register_document(markdown, doc_path, label, metadata)
            count += 1
        return count

    def _convert_crop_distribution(self, df: pd.DataFrame, source_file: str) -> int:
        label = _label("agriculture_crops")
        count = 0
        for (district_id, district_name), grp in df.groupby(["district_id", "district_name"], dropna=False):
            grp = grp.sort_values("area_ha", ascending=False)
            top_rows = grp.head(10)

            table_rows = "\n".join(
                f"| {r.get('crop','N/A')} | {_fmt(r.get('area_ha'))} | {_fmt(r.get('yield_t_ha'))} | {r.get('season','N/A')} |"
                for _, r in top_rows.iterrows()
            )
            markdown = f"""# Crop Distribution: {district_name} District

**Location:** {district_name} ({district_id})

## Major Crops
| Crop | Area (ha) | Yield (t/ha) | Season |
|---|---:|---:|---|
{table_rows}

## Interpretation
Crop distribution in this district indicates the dominant crop portfolio and seasonal priorities for drought advisory context.

---
*Source: {top_rows.iloc[0].get('source', source_file) if not top_rows.empty else source_file}*
"""
            doc_name = f"crops_{_slugify(str(district_id))}"
            doc_id = _sha_key(doc_name + source_file)
            doc_path = self._build_doc_path(label, doc_name)
            metadata = {
                "doc_id": doc_id,
                "title": f"Crop Distribution: {district_name}",
                "source_file": source_file,
                "district_id": str(district_id),
                "district_name": str(district_name),
                "record_date": None,
                "period": "static",
                "data_quality": "OK",
                "source": top_rows.iloc[0].get("source", source_file) if not top_rows.empty else source_file,
                "tags": ["agriculture", "crop", str(district_name)],
            }
            self._register_document(markdown, doc_path, label, metadata)
            count += 1
        return count

    def _convert_soil_properties(self, df: pd.DataFrame, source_file: str) -> int:
        label = _label("district_soil")
        count = 0
        for _, row in df.iterrows():
            district_id = row.get("district_id", "UNKNOWN")
            district_name = row.get("district_name", "Unknown")
            markdown = f"""# Soil Profile: {district_name} District

**Location:** {district_name} ({district_id})

## Soil Characteristics
- **Soil region:** {row.get('soil_region', 'N/A')}
- **Soil pH:** {_fmt(row.get('ph'))}
- **Clay content:** {_fmt(row.get('clay_pct'), suffix='%')}
- **Sand content:** {_fmt(row.get('sand_pct'), suffix='%')}
- **Silt content:** {_fmt(row.get('silt_pct'), suffix='%')}
- **Soil organic carbon:** {_fmt(row.get('soc_g_kg'), suffix=' g/kg')}
- **CEC:** {_fmt(row.get('cec_cmol_kg'), suffix=' cmol/kg')}
- **Nitrogen:** {_fmt(row.get('nitrogen_g_kg'), suffix=' g/kg')}

## Interpretation
These soil properties support crop suitability assessment and district-level drought resilience analysis.

---
*Source: {row.get('source', source_file)}*
"""
            doc_name = f"soil_{_slugify(str(district_id))}"
            doc_id = _sha_key(doc_name + source_file)
            doc_path = self._build_doc_path(label, doc_name)
            metadata = {
                "doc_id": doc_id,
                "title": f"Soil Profile: {district_name}",
                "source_file": source_file,
                "district_id": str(district_id),
                "district_name": str(district_name),
                "record_date": row.get("extraction_date"),
                "period": "static",
                "data_quality": "OK",
                "source": row.get("source", source_file),
                "tags": ["soil", "district_profile", str(district_name)],
            }
            self._register_document(markdown, doc_path, label, metadata)
            count += 1
        return count

    def _convert_boundaries(self, df: pd.DataFrame, source_file: str) -> int:
        label = _label("district_boundaries")
        count = 0
        for _, row in df.iterrows():
            district_id = row.get("district_id", "UNKNOWN")
            district_name = row.get("district_name", "Unknown")
            geometry = str(row.get("geometry_wkt", ""))
            geom_preview = geometry[:400] + ("..." if len(geometry) > 400 else "")

            markdown = f"""# District Boundary Profile: {district_name}

**District ID:** {district_id}

## Administrative Boundary Metadata
- **Geometry type:** {'MULTIPOLYGON' if geometry.startswith('MULTIPOLYGON') else 'POLYGON/OTHER'}
- **Geometry preview (WKT):**

```wkt
{geom_preview}
```

## Usage
Boundary geometry is used for geospatial joins and map overlays across climate and agriculture indicators.

---
*Source: {row.get('source', source_file)}*
"""
            doc_name = f"boundary_{_slugify(str(district_id))}"
            doc_id = _sha_key(doc_name + source_file)
            doc_path = self._build_doc_path(label, doc_name)
            metadata = {
                "doc_id": doc_id,
                "title": f"District Boundary: {district_name}",
                "source_file": source_file,
                "district_id": str(district_id),
                "district_name": str(district_name),
                "record_date": row.get("extraction_date"),
                "period": "static",
                "data_quality": "OK",
                "source": row.get("source", source_file),
                "tags": ["district", "boundary", str(district_name)],
            }
            self._register_document(markdown, doc_path, label, metadata)
            count += 1
        return count

    def _convert_generic_reference(self, df: pd.DataFrame, source_file: str) -> int:
        label = Label(category="District Profiles", service="Reference Data")
        preview = df.head(25).to_markdown(index=False)
        markdown = f"""# Reference Dataset: {source_file}

This dataset did not match a specialized converter template and is ingested as structured reference content.

## Schema
{', '.join(df.columns)}

## Sample Rows (first 25)
{preview}

## Record Count
{len(df)}
"""
        doc_name = f"reference_{_slugify(source_file)}"
        doc_id = _sha_key(doc_name + source_file)
        doc_path = self._build_doc_path(label, doc_name)
        metadata = {
            "doc_id": doc_id,
            "title": f"Reference Dataset: {source_file}",
            "source_file": source_file,
            "district_id": None,
            "district_name": None,
            "record_date": None,
            "period": "reference",
            "data_quality": "UNKNOWN",
            "source": source_file,
            "tags": ["reference", "fallback"],
        }
        self._register_document(markdown, doc_path, label, metadata)
        return 1

    def _write_outputs(self, total_docs: int) -> Dict[str, Any]:
        metadata_path = self.meta_root / "documents_metadata.jsonl"
        arango_path = self.meta_root / "arango_documents.jsonl"

        with metadata_path.open("w", encoding="utf-8") as f:
            for row in self.metadata_records:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")

        with arango_path.open("w", encoding="utf-8") as f:
            for row in self.arango_documents:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")

        summary = {
            "input_dir": str(self.input_dir),
            "output_dir": str(self.output_dir),
            "documents_generated": total_docs,
            "metadata_records": len(self.metadata_records),
            "arango_documents": len(self.arango_documents),
            "generated_at_utc": _today_utc_iso(),
            "metadata_jsonl": str(metadata_path),
            "arango_jsonl": str(arango_path),
        }
        manifest_path = self.output_dir / "conversion_manifest.json"
        manifest_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
        return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert CSVs to GENIE.AI markdown and metadata")
    parser.add_argument("--input-dir", type=Path, required=True, help="Directory containing CSV files")
    parser.add_argument("--output-dir", type=Path, required=True, help="Output directory for docs/metadata")
    parser.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"]) 
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    logging.basicConfig(level=getattr(logging, args.log_level), format="%(asctime)s %(levelname)s %(message)s")

    converter = GenieDataConverter(args.input_dir, args.output_dir)
    result = converter.convert_all()

    logger.info("Conversion complete: %s", json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
