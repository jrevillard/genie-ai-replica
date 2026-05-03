# Agricultural Early Warning System Pipeline — Design & Implementation Guide

> **Version:** 1.0  
> **Scope:** End-to-end agent-based early warning system for crop and food security, integrating Google Earth Engine, WeatherNext 2, MetNet-3 NowCast, and UN/IPC risk frameworks.  
> **Target context:** Bangladesh (extensible to any geography).

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Foundational Frameworks & Risk Classification](#2-foundational-frameworks--risk-classification)
3. [System Architecture Overview](#3-system-architecture-overview)
4. [Data Sources & APIs](#4-data-sources--apis)
5. [Case 1 — Short-Term Early Warning Pipeline](#5-case-1--short-term-early-warning-pipeline)
6. [Case 2 — Long-Term Early Warning Pipeline](#6-case-2--long-term-early-warning-pipeline)
7. [Case 3 — User-Initiated Queries](#7-case-3--user-initiated-queries)
8. [Detection & Classification Engine](#8-detection--classification-engine)
9. [Notification & Dissemination System](#9-notification--dissemination-system)
10. [Scheduling, Orchestration & Infrastructure](#10-scheduling-orchestration--infrastructure)
11. [Data Model & Storage](#11-data-model--storage)
12. [End-to-End Worked Example — Bangladesh](#12-end-to-end-worked-example--bangladesh)
13. [Security, Ethics & Governance](#13-security-ethics--governance)
14. [Testing & Validation Strategy](#14-testing--validation-strategy)
15. [Critique Log & Design Iterations](#15-critique-log--design-iterations)

---

## 1. Executive Summary

This guide describes how to build an **agent-based agricultural early warning system (AgEWS)** that protects smallholder farmers and vulnerable communities by fusing satellite-derived crop baselines with AI-powered weather forecasts. The system operates across three complementary modes:

**Case 1 (Short-term):** Daily forecasts from Google WeatherNext 2 / Maps Platform Weather API are cross-referenced against a weekly crop baseline built from Google Earth Engine. If weather conditions constitute an extreme event under the system's risk classification framework, the agent sends a push notification to the user.

**Case 2 (Long-term):** Extended forecasts (up to 15 days from WeatherNext 2, plus seasonal climate projections from sources such as ECMWF C3S, IRI, and NMME) are evaluated against the same crop baseline to flag emerging threats like prolonged drought, monsoon anomalies, or cumulative heat stress.

**Case 3 (On-demand):** A conversational agent interface lets users query current conditions (via MetNet-3 / NowCast), ask for crop-specific best practices, or request advisory information at any time.

The risk classification follows the **UN Early Warnings for All (EW4All) initiative's four-pillar model** and adapts the **IPC Acute Food Insecurity scale** and **WMO impact-based forecasting severity levels** into a unified risk tier system.

---

## 2. Foundational Frameworks & Risk Classification

### 2.1 UN Early Warnings for All (EW4All) — Four Pillars

The EW4All initiative, spearheaded by WMO and UNDRR, defines the canonical structure for any multi-hazard early warning system. Our pipeline maps directly onto these four pillars:

| Pillar | Lead Agency | Pipeline Component |
|--------|-------------|-------------------|
| **Pillar 1:** Disaster risk knowledge | UNDRR | Crop baseline + vulnerability profiles |
| **Pillar 2:** Detection, observation, monitoring, analysis, forecasting | WMO | Earth Engine analysis + WeatherNext + MetNet |
| **Pillar 3:** Warning dissemination and communication | ITU | Notification system (SMS, push, voice) |
| **Pillar 4:** Preparedness and response capabilities | IFRC | Advisory content, best practices, action plans |

### 2.2 IPC Acute Food Insecurity Classification (5-Phase Scale)

The IPC provides the internationally accepted severity scale for food security. Our system uses it as the upper framework for consequence assessment:

| Phase | Name | Area Classification | Description |
|-------|------|-------------------|-------------|
| 1 | Minimal / None | Minimal | Households meet essential food and non-food needs without atypical coping strategies. |
| 2 | Stressed | Stressed | Minimally adequate food consumption, but unable to afford some essential non-food expenditures without stress coping. |
| 3 | Crisis | Crisis | Food consumption gaps with acute malnutrition above normal; OR marginally able to meet minimum food needs only with accelerated depletion of livelihood assets. |
| 4 | Emergency | Emergency | Large food consumption gaps; very high acute malnutrition and excess mortality; OR extreme livelihood asset depletion. |
| 5 | Catastrophe | Famine | Complete collapse of livelihood and food access; starvation, death, and destitution evident. |

The IPC also defines three levels of **Risk of Worsening Phase**: **Watch**, **Moderate Risk**, and **High Risk**. Our weather-triggered risk tiers map into these.

### 2.3 WMO Impact-Based Forecast and Warning Severity Levels

The WMO Guidelines on Multi-Hazard Impact-Based Forecast and Warning Services (WMO-No. 1150) define a colour-coded severity matrix combining likelihood and impact:

| Level | Colour | Meaning |
|-------|--------|---------|
| 1 | Green | No significant impact expected. |
| 2 | Yellow | Be aware. Localised disruption possible. Minor agricultural impact. |
| 3 | Orange | Be prepared. Moderate disruption expected. Significant crop damage possible. |
| 4 | Red | Take action. Severe disruption expected. Widespread crop failure and threat to life. |

### 2.4 Unified Risk Tier Mapping for This Pipeline

We fuse the WMO severity, the IPC worsening-risk, and agricultural impact thresholds into a single 5-tier classification:

| Risk Tier | WMO Equivalent | IPC Worsening Equivalent | Trigger Conditions (examples for Bangladesh) | Agent Action |
|-----------|---------------|--------------------------|-----------------------------------------------|-------------|
| **Tier 0 — Normal** | Green | — | Forecast within seasonal norms | No alert. Log only. |
| **Tier 1 — Advisory** | Yellow | Watch | Heavy rain >50mm/24h; temp >38°C; moderate wind | Log + optional user digest |
| **Tier 2 — Warning** | Orange | Moderate Risk | Heavy rain >100mm/24h; heatwave >40°C ≥3 days; drought (SPI < −1.0) | **Push notification** + advisory text |
| **Tier 3 — Severe** | Red | High Risk | Extreme rain >150mm/24h OR cyclone landfall; flood inundation; drought SPI < −1.5 | **Urgent push** + SMS + action plan |
| **Tier 4 — Emergency** | Red (extreme) | High Risk (imminent famine) | Catastrophic cyclone; >200mm/24h; dam break; sustained drought SPI < −2.0 with IPC ≥ Phase 3 | **Multi-channel blast** (push + SMS + voice + community alert) |

> **Note:** Thresholds above are illustrative for Bangladesh's climate. They must be calibrated per agro-ecological zone using historical climate data, local crop vulnerability research, and national meteorological service guidance.

---

## 3. System Architecture Overview

### 3.1 High-Level Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                        AGENT ORCHESTRATOR                          │
│                   (Temporal.io / Prefect / Airflow)                 │
│                                                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │  WEEKLY JOB  │  │  DAILY JOB   │  │  ON-DEMAND (API / Chat)  │  │
│  │  Crop        │  │  Weather     │  │  User queries            │  │
│  │  Baseline    │  │  Forecast    │  │  NowCast                 │  │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬─────────────┘  │
│         │                 │                        │               │
│         ▼                 ▼                        ▼               │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              DETECTION & CLASSIFICATION ENGINE               │   │
│  │   Crop-Weather Cross-Reference + Risk Tier Assignment       │   │
│  └──────────────────────────┬──────────────────────────────────┘   │
│                             │                                      │
│                             ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              NOTIFICATION & ADVISORY SERVICE                 │   │
│  │   Push / SMS / Voice / Community Radio / Chatbot response   │   │
│  └─────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘

DATA LAYER:
┌─────────────┐ ┌───────────────────┐ ┌─────────────┐ ┌────────────┐
│ Google Earth │ │ WeatherNext 2     │ │ MetNet-3    │ │ External   │
│ Engine       │ │ (EE / BigQuery /  │ │ NowCast     │ │ Documents  │
│ (Sentinel-2, │ │  Weather API)     │ │ (Weather    │ │ (FAO, DAE, │
│  MODIS, ESA) │ │                   │ │  API)       │ │  BARI etc) │
└─────────────┘ └───────────────────┘ └─────────────┘ └────────────┘
```

### 3.2 Component Responsibilities

**Crop Baseline Agent:** Runs weekly. Uses Google Earth Engine (Sentinel-2, MODIS NDVI, ESA WorldCover) to classify crops in a target area. Enriches with official agricultural extension documents. Outputs a structured markdown report and a machine-readable JSON.

**Weather Forecast Agent:** Runs daily (short-term) or on configurable cadence (long-term). Pulls data from WeatherNext 2 via Earth Engine / BigQuery for raw model outputs, or Google Maps Platform Weather API for processed forecasts. Outputs a structured forecast payload.

**Detection & Classification Engine:** A stateless function that takes (crop_baseline, weather_forecast) as input and returns a risk tier assignment with reasoning.

**Notification & Advisory Service:** Routes alerts to users based on risk tier. Generates human-readable advisory content (in Bangla and English) with crop-specific protective actions.

**User Query Interface:** REST API + chatbot (WhatsApp / Telegram / SMS-based). Accepts natural-language questions, routes to appropriate data source, and returns advisory responses.

---

## 4. Data Sources & APIs

### 4.1 Google Earth Engine — Crop Baselining

Google Earth Engine provides petabytes of satellite imagery for planetary-scale analysis. Key datasets for crop identification in Bangladesh:

| Dataset | Use | Resolution | Revisit |
|---------|-----|------------|---------|
| Sentinel-2 (Level 2A) | Spectral indices (NDVI, EVI, NDWI) for crop classification | 10m | 5 days |
| MODIS (MOD13Q1) | Vegetation index time series for phenology tracking | 250m | 16-day composite |
| ESA WorldCover | Pre-classified land cover (cropland class) | 10m | Annual |
| USDA GFSAD30 | Global cropland extent | 30m | One-time baseline |
| Copernicus Dynamic Land Cover | Crop type identification | 100m | Annual |

**Authentication and Setup:**

```python
# Install dependencies
# pip install earthengine-api geemap

import ee

# Authenticate (one-time)
ee.Authenticate()

# Initialize with your GCP project
ee.Initialize(project='your-gcp-project-id')
```

**Crop Classification Using NDVI Thresholding + Random Forest:**

```python
import ee
import geemap
import json

def generate_crop_baseline(aoi_geojson: dict, date_start: str, date_end: str) -> dict:
    """
    Generate a crop baseline for a given area of interest (AOI).
    
    Args:
        aoi_geojson: GeoJSON dict defining the area of interest
        date_start: Start date string (YYYY-MM-DD)
        date_end: End date string (YYYY-MM-DD)
    
    Returns:
        dict with crop classification results
    """
    aoi = ee.Geometry(aoi_geojson)

    # Load Sentinel-2 Surface Reflectance, filter clouds
    s2 = (ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
          .filterBounds(aoi)
          .filterDate(date_start, date_end)
          .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20)))

    # Compute median composite
    composite = s2.median().clip(aoi)

    # Calculate vegetation indices
    ndvi = composite.normalizedDifference(['B8', 'B4']).rename('NDVI')
    evi = composite.expression(
        '2.5 * ((NIR - RED) / (NIR + 6 * RED - 7.5 * BLUE + 1))',
        {'NIR': composite.select('B8'),
         'RED': composite.select('B4'),
         'BLUE': composite.select('B2')}
    ).rename('EVI')
    ndwi = composite.normalizedDifference(['B3', 'B8']).rename('NDWI')

    # Stack bands for classification
    stack = composite.select(['B2','B3','B4','B5','B6','B7','B8','B8A','B11','B12'])\
                     .addBands([ndvi, evi, ndwi])

    # Use ESA WorldCover as a reference for cropland mask
    worldcover = ee.Image('ESA/WorldCover/v200/2021')
    cropland_mask = worldcover.eq(40)  # Class 40 = Cropland

    # Apply cropland mask
    crop_areas = stack.updateMask(cropland_mask)

    # --- Random Forest Classification (if training data available) ---
    # training_points = ee.FeatureCollection('users/your_username/bangladesh_crop_samples')
    # training = crop_areas.sampleRegions(
    #     collection=training_points,
    #     properties=['crop_type'],
    #     scale=10
    # )
    # classifier = ee.Classifier.smileRandomForest(100).train(
    #     features=training,
    #     classProperty='crop_type',
    #     inputProperties=stack.bandNames()
    # )
    # classified = crop_areas.classify(classifier)

    # --- Simplified: NDVI-based crop presence detection ---
    crop_presence = ndvi.gt(0.3).And(cropland_mask)
    rice_paddy = ndwi.gt(0.0).And(ndvi.gt(0.2)).And(cropland_mask)
    
    # Compute area statistics
    crop_area = crop_presence.multiply(ee.Image.pixelArea()).reduceRegion(
        reducer=ee.Reducer.sum(),
        geometry=aoi,
        scale=10,
        maxPixels=1e9
    )
    
    rice_area = rice_paddy.multiply(ee.Image.pixelArea()).reduceRegion(
        reducer=ee.Reducer.sum(),
        geometry=aoi,
        scale=10,
        maxPixels=1e9
    )

    return {
        'aoi': aoi_geojson,
        'date_range': {'start': date_start, 'end': date_end},
        'total_crop_area_sqm': crop_area.getInfo(),
        'rice_paddy_area_sqm': rice_area.getInfo(),
        'ndvi_stats': ndvi.reduceRegion(
            reducer=ee.Reducer.mean().combine(ee.Reducer.stdDev(), sharedInputs=True),
            geometry=aoi,
            scale=10,
            maxPixels=1e9
        ).getInfo(),
        'satellite': 'Sentinel-2 SR Harmonized',
        'classification_method': 'NDVI/NDWI thresholding + ESA WorldCover mask'
    }
```

**Supplementary Document-Based Baseline:**

For regions where satellite classification is insufficient, the agent also ingests official documents:

```python
import requests
from pathlib import Path

DOCUMENT_SOURCES = [
    {
        'name': 'Bangladesh Bureau of Statistics - Agricultural Census',
        'type': 'official_government',
        'url': 'https://bbs.gov.bd/site/page/...',  # Actual URL varies
        'format': 'pdf'
    },
    {
        'name': 'DAE Crop Reporting (Department of Agricultural Extension)',
        'type': 'official_government',
        'notes': 'District-wise crop sowing and harvest reports'
    },
    {
        'name': 'BARI (Bangladesh Agricultural Research Institute) Bulletins',
        'type': 'research',
        'notes': 'Crop variety recommendations per agro-ecological zone'
    },
    {
        'name': 'FAO GIEWS Bangladesh Country Brief',
        'type': 'international_organisation',
        'url': 'https://www.fao.org/giews/countrybrief/country.jsp?code=BGD'
    }
]

def enrich_baseline_with_documents(satellite_baseline: dict, district: str) -> dict:
    """
    Enrich the satellite-derived baseline with document-sourced 
    crop information for a specific district.
    
    In production, this would use an LLM agent to:
    1. Retrieve relevant documents from a vector store
    2. Extract crop type, area, and phenology information
    3. Cross-reference with satellite data
    4. Produce a merged, higher-confidence baseline
    """
    # Placeholder: in production, integrate with RAG pipeline
    enriched = satellite_baseline.copy()
    enriched['document_sources'] = DOCUMENT_SOURCES
    enriched['enrichment_method'] = 'RAG over agricultural extension documents'
    return enriched
```

**Crop Baseline Output — Markdown Report Format:**

```python
def generate_baseline_markdown(baseline: dict, district: str) -> str:
    """Generate a standardised markdown report from the crop baseline."""
    
    ndvi_mean = baseline.get('ndvi_stats', {}).get('NDVI_mean', 'N/A')
    
    md = f"""# Crop Baseline Report — {district}, Bangladesh

**Generated:** {{date}}  
**Satellite:** {baseline.get('satellite', 'N/A')}  
**Analysis Period:** {baseline['date_range']['start']} to {baseline['date_range']['end']}  
**Method:** {baseline.get('classification_method', 'N/A')}

## Area Summary

| Metric | Value |
|--------|-------|
| Total cropland detected | {baseline.get('total_crop_area_sqm', 'N/A')} m² |
| Rice paddy area detected | {baseline.get('rice_paddy_area_sqm', 'N/A')} m² |
| Mean NDVI | {ndvi_mean} |

## Identified Crop Types

Based on spectral analysis and ESA WorldCover land classification:

- **Rice (Aman/Boro/Aus):** Dominant crop, detected via NDWI+NDVI combination
- **Jute:** Seasonal detection (March-August), high NDVI signature
- **Wheat:** Rabi season (November-March), moderate NDVI
- **Vegetables:** Mixed spectral signatures in peri-urban areas

## Crop Calendar Context (Bangladesh)

| Season | Crop | Sowing | Harvest | Vulnerability Window |
|--------|------|--------|---------|---------------------|
| Kharif-1 | Aus rice | Mar-Apr | Jul-Aug | Cyclone + early monsoon flooding |
| Kharif-2 | Aman rice | Jun-Aug | Nov-Dec | Monsoon flooding, late-season cyclones |
| Rabi | Boro rice | Dec-Jan | Apr-May | Winter cold spells, pre-monsoon storms |
| Rabi | Wheat | Nov-Dec | Mar-Apr | Terminal heat stress |
| Kharif-1 | Jute | Mar-Apr | Jul-Aug | Waterlogging |

## Vulnerability Profile

Crops currently in field are most vulnerable to:
- **Flooding:** Rice at tillering/flowering stage
- **Heat stress:** Wheat at grain filling (>35°C critical)
- **Cyclone winds:** All standing crops, especially tall crops (jute, sugarcane)
- **Drought:** Boro rice under irrigation stress

## Document Sources

{chr(10).join(f"- {s['name']} ({s['type']})" for s in baseline.get('document_sources', []))}
"""
    return md
```

### 4.2 Google WeatherNext 2 — Medium-Range Forecasts (0–15 days)

WeatherNext 2 is Google DeepMind's state-of-the-art ensemble weather forecasting model. It generates up to 64 ensemble members with 6-hour resolution, forecasting out to 15 days. Data is available through Earth Engine, BigQuery, and Google Cloud Storage (Zarr format).

**Access Methods:**

| Method | Best For | Latency | Format |
|--------|----------|---------|--------|
| Earth Engine | Geospatial analysis, integration with crop baseline | Moderate | ee.Image |
| BigQuery | SQL-based queries, joining with business data | Low | Tabular |
| Google Cloud Storage (Zarr) | Bulk access, custom pipelines, HPC | Low | N-dimensional arrays |
| Google Maps Platform Weather API | Processed forecasts, app integration | Very low | JSON |

**Earth Engine Access (Raw Model Output):**

```python
import ee

ee.Initialize(project='your-gcp-project-id')

def get_weathernext_forecast(latitude: float, longitude: float, 
                              init_date: str) -> dict:
    """
    Pull WeatherNext 2 ensemble forecast for a point location.
    
    Args:
        latitude, longitude: Target location
        init_date: Forecast initialisation date (YYYY-MM-DD)
    
    Returns:
        dict of forecast variables with ensemble statistics
    """
    # WeatherNext 2 dataset in Earth Engine
    wn2 = ee.ImageCollection(
        'projects/gcp-public-data-weathernext/assets/weathernext_2_0_0'
    )

    point = ee.Geometry.Point([longitude, latitude])

    # Filter to most recent init time
    forecast = (wn2
        .filterDate(init_date)
        .filterBounds(point))

    # Extract key variables for agricultural early warning
    # Variables: 2m_temperature, total_precipitation,
    # 10m_u_component_of_wind, 10m_v_component_of_wind,
    # 2m_dewpoint_temperature, mean_sea_level_pressure
    
    # Get ensemble mean and spread for the first image
    first = forecast.first()
    
    values = first.reduceRegion(
        reducer=ee.Reducer.mean(),
        geometry=point.buffer(25000),  # ~25km radius
        scale=25000  # ~0.25 degree
    )
    
    return values.getInfo()
```

**BigQuery Access (SQL):**

```sql
-- Pull 5-day temperature forecast for Dhaka
SELECT
  init_time,
  lead_time,
  AVG(temperature_2m) AS temp_2m_mean,
  MIN(temperature_2m) AS temp_2m_min,
  MAX(temperature_2m) AS temp_2m_max,
  AVG(total_precipitation) AS precip_mean,
  MAX(total_precipitation) AS precip_max
FROM
  `gcp-public-data-weathernext.weathernext_2_0_0.forecast`
WHERE
  -- Nearest grid point to Dhaka (23.8103°N, 90.4125°E)
  latitude BETWEEN 23.5 AND 24.0
  AND longitude BETWEEN 90.0 AND 90.5
  AND init_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 12 HOUR)
  AND lead_time <= 120  -- hours (5 days)
GROUP BY
  init_time, lead_time
ORDER BY
  init_time DESC, lead_time ASC;
```

**Google Maps Platform Weather API (Processed Forecasts):**

```python
import requests

WEATHER_API_KEY = "YOUR_GOOGLE_MAPS_PLATFORM_API_KEY"

def get_daily_forecast(lat: float, lng: float, days: int = 10) -> dict:
    """
    Get processed daily weather forecast via Google Maps Platform Weather API.
    
    Returns up to 10 days of daily forecast data including temperature,
    precipitation probability, wind, humidity, and weather conditions.
    """
    url = "https://weather.googleapis.com/v1/forecast/days"
    params = {
        "key": WEATHER_API_KEY,
        "location.latitude": lat,
        "location.longitude": lng,
        "days": days,  # Max 10
        "languageCode": "en"
    }
    
    response = requests.get(url, params=params)
    response.raise_for_status()
    return response.json()


def get_hourly_forecast(lat: float, lng: float, hours: int = 240) -> dict:
    """
    Get hourly forecast, up to 240 hours (10 days) ahead.
    Enhanced by WeatherNext AI models.
    """
    url = "https://weather.googleapis.com/v1/forecast/hours"
    params = {
        "key": WEATHER_API_KEY,
        "location.latitude": lat,
        "location.longitude": lng,
        "hours": hours,  # Max 240
        "languageCode": "en"
    }
    
    response = requests.get(url, params=params)
    response.raise_for_status()
    return response.json()


def get_current_conditions(lat: float, lng: float) -> dict:
    """Get current weather conditions (refreshed every 15-30 min)."""
    url = "https://weather.googleapis.com/v1/currentConditions"
    params = {
        "key": WEATHER_API_KEY,
        "location.latitude": lat,
        "location.longitude": lng,
        "languageCode": "en"
    }
    
    response = requests.get(url, params=params)
    response.raise_for_status()
    return response.json()
```

### 4.3 MetNet-3 / NowCast — Short-Range Precipitation (0–12 hours)

MetNet-3 powers Google's NowCast feature, providing high-resolution precipitation predictions at 1km resolution, updated every 15 minutes, for up to 12 hours ahead. As of 2025, NowCast is available in Africa, the US, and parts of Europe via Google Search. Programmatic access is through the Google Maps Platform Weather API.

The Weather API does not expose a separate "NowCast" endpoint, but the hourly forecast endpoint incorporates MetNet-3 predictions for the first 12 hours, and current conditions are refreshed every 15–30 minutes.

```python
def get_nowcast_precipitation(lat: float, lng: float) -> dict:
    """
    Get near-term precipitation forecast (effectively NowCast).
    Uses the hourly forecast endpoint — the first 12 hours are 
    enhanced by MetNet-3's high-resolution precipitation model.
    """
    hourly = get_hourly_forecast(lat, lng, hours=12)
    
    # Extract precipitation-relevant fields
    precipitation_timeline = []
    for hour_data in hourly.get('forecastHours', []):
        precipitation_timeline.append({
            'time': hour_data.get('interval', {}).get('startTime'),
            'precipitation_probability': hour_data.get('precipitation', {})
                                              .get('probability', {})
                                              .get('percent'),
            'precipitation_amount_mm': hour_data.get('precipitation', {})
                                              .get('qpf', {})
                                              .get('quantity'),
            'weather_condition': hour_data.get('weatherCondition'),
            'temperature_c': hour_data.get('temperature', {})
                                    .get('degrees'),
        })
    
    return {
        'location': {'lat': lat, 'lng': lng},
        'model': 'MetNet-3 enhanced (first 12h)',
        'timeline': precipitation_timeline
    }
```

### 4.4 Long-Range Climate Projections (Beyond 15 Days)

For Case 2 (long-term warnings), WeatherNext 2's 15-day limit must be supplemented with seasonal and sub-seasonal forecasts. Reliable sources include:

| Source | Horizon | Access | Notes |
|--------|---------|--------|-------|
| **ECMWF C3S (Copernicus Climate Data Store)** | Seasonal (up to 7 months) | CDS API (free registration) | Multi-model ensemble. Gold standard. |
| **IRI Multi-Model Probability Forecast** | Seasonal (3 months) | IRI Data Library | Tercile probability maps for precipitation and temperature |
| **NMME (North American Multi-Model Ensemble)** | Sub-seasonal to seasonal | NOAA CPC | Monthly updated forecasts |
| **WeatherNext 2 (extended)** | 15 days | Earth Engine / BigQuery | Still the most accurate for the medium-range window |

```python
import cdsapi

def get_seasonal_forecast(lat: float, lng: float, year: int, month: int) -> dict:
    """
    Pull seasonal forecast from ECMWF C3S.
    Requires free registration at https://cds.climate.copernicus.eu
    """
    c = cdsapi.Client()
    
    c.retrieve(
        'seasonal-monthly-single-levels',
        {
            'originating_centre': 'ecmwf',
            'system': '51',
            'variable': [
                '2m_temperature', 'total_precipitation',
            ],
            'year': str(year),
            'month': str(month).zfill(2),
            'leadtime_month': ['1', '2', '3', '4', '5', '6'],
            'area': [lat + 1, lng - 1, lat - 1, lng + 1],  # N, W, S, E
            'format': 'netcdf',
        },
        'seasonal_forecast.nc'
    )
    
    # Process with xarray
    import xarray as xr
    ds = xr.open_dataset('seasonal_forecast.nc')
    return ds
```

### 4.5 Open-Meteo (Fallback / Free Alternative)

If Google APIs are unavailable or for cost reduction during development:

```python
def get_open_meteo_forecast(lat: float, lng: float) -> dict:
    """Free, open-source weather API — no API key needed."""
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": lat,
        "longitude": lng,
        "daily": [
            "temperature_2m_max", "temperature_2m_min",
            "precipitation_sum", "precipitation_probability_max",
            "wind_speed_10m_max", "wind_gusts_10m_max",
            "et0_fao_evapotranspiration"
        ],
        "timezone": "Asia/Dhaka",
        "forecast_days": 16
    }
    response = requests.get(url, params=params)
    response.raise_for_status()
    return response.json()
```

---

## 5. Case 1 — Short-Term Early Warning Pipeline

### 5.1 Pipeline Flow

```
WEEKLY (Crop Baseline):
  Earth Engine Sentinel-2 → NDVI/NDWI classification → 
  Merge with document sources → Crop Baseline JSON + MD report →
  Store in database

DAILY (Weather Forecast):
  WeatherNext 2 / Weather API → Extract variables for AOI →
  Weather Forecast JSON → Store in database
                         ↓
  Load latest Crop Baseline + Weather Forecast →
  Detection Engine (cross-reference) →
  Risk Tier Classification →
    Tier 0-1: Log only (or optional digest)
    Tier 2+:  NOTIFICATION → Push/SMS to user
                           → Generate advisory content
```

### 5.2 Weekly Crop Baseline Job

```python
# crop_baseline_job.py
# Scheduled: Every Monday at 02:00 UTC

import ee
import json
from datetime import datetime, timedelta
from pathlib import Path

def run_weekly_crop_baseline():
    """Main entry point for the weekly crop baseline job."""
    
    ee.Initialize(project='your-gcp-project-id')
    
    # Define areas of interest — one per registered user/district
    users = load_registered_users()  # From database
    
    for user in users:
        aoi = user['aoi_geojson']
        district = user['district']
        
        # Analyse last 30 days of satellite imagery
        end_date = datetime.utcnow().strftime('%Y-%m-%d')
        start_date = (datetime.utcnow() - timedelta(days=30)).strftime('%Y-%m-%d')
        
        # Generate satellite baseline
        baseline = generate_crop_baseline(aoi, start_date, end_date)
        
        # Enrich with document sources
        enriched = enrich_baseline_with_documents(baseline, district)
        
        # Generate markdown report
        md_report = generate_baseline_markdown(enriched, district)
        
        # Store in database
        store_crop_baseline(
            user_id=user['id'],
            baseline_json=json.dumps(enriched),
            baseline_md=md_report,
            generated_at=datetime.utcnow()
        )
        
        print(f"[OK] Crop baseline generated for {district} "
              f"(user: {user['id']})")
```

### 5.3 Daily Weather Forecast Job

```python
# weather_forecast_job.py
# Scheduled: Every day at 06:00, 12:00, 18:00 UTC

from datetime import datetime

def run_daily_weather_forecast():
    """Main entry point for the daily weather forecast job."""
    
    users = load_registered_users()
    
    for user in users:
        lat = user['latitude']
        lng = user['longitude']
        
        # Pull 10-day forecast from Weather API
        forecast = get_daily_forecast(lat, lng, days=10)
        
        # Also pull hourly for next 48h (higher granularity)
        hourly = get_hourly_forecast(lat, lng, hours=48)
        
        # Extract critical variables
        parsed = parse_forecast_for_ews(forecast, hourly)
        
        # Store
        store_weather_forecast(
            user_id=user['id'],
            forecast_json=json.dumps(parsed),
            fetched_at=datetime.utcnow()
        )
        
        # --- TRIGGER DETECTION ENGINE ---
        latest_baseline = load_latest_crop_baseline(user['id'])
        
        if latest_baseline:
            risk_result = classify_risk(
                crop_baseline=latest_baseline,
                weather_forecast=parsed,
                user_profile=user
            )
            
            if risk_result['tier'] >= 2:
                send_early_warning(
                    user=user,
                    risk_result=risk_result,
                    forecast=parsed,
                    baseline=latest_baseline
                )


def parse_forecast_for_ews(daily_forecast: dict, hourly_forecast: dict) -> dict:
    """
    Extract and structure the weather variables most relevant 
    to agricultural early warning.
    """
    days = []
    for day in daily_forecast.get('forecastDays', []):
        days.append({
            'date': day.get('interval', {}).get('startTime'),
            'temp_max_c': day.get('daytimeForecast', {})
                            .get('temperature', {}).get('degrees'),
            'temp_min_c': day.get('overnightForecast', {})
                            .get('temperature', {}).get('degrees'),
            'precip_probability_pct': day.get('daytimeForecast', {})
                                        .get('precipitation', {})
                                        .get('probability', {}).get('percent'),
            'precip_amount_mm': day.get('daytimeForecast', {})
                                   .get('precipitation', {})
                                   .get('qpf', {}).get('quantity'),
            'wind_speed_kmh': day.get('daytimeForecast', {})
                                 .get('wind', {})
                                 .get('speed', {}).get('value'),
            'wind_gust_kmh': day.get('daytimeForecast', {})
                                .get('wind', {})
                                .get('gust', {}).get('value'),
            'humidity_pct': day.get('daytimeForecast', {})
                              .get('relativeHumidity'),
            'weather_condition': day.get('daytimeForecast', {})
                                    .get('weatherCondition'),
        })
    
    # Compute derived indicators
    max_precip_24h = max((d['precip_amount_mm'] or 0) for d in days) if days else 0
    max_temp = max((d['temp_max_c'] or 0) for d in days) if days else 0
    consecutive_hot_days = count_consecutive(days, 
        lambda d: (d['temp_max_c'] or 0) > 38)
    consecutive_dry_days = count_consecutive(days, 
        lambda d: (d['precip_amount_mm'] or 0) < 1)
    max_wind_gust = max((d['wind_gust_kmh'] or 0) for d in days) if days else 0
    
    return {
        'daily': days,
        'derived': {
            'max_precip_24h_mm': max_precip_24h,
            'max_temp_c': max_temp,
            'consecutive_hot_days_above_38': consecutive_hot_days,
            'consecutive_dry_days': consecutive_dry_days,
            'max_wind_gust_kmh': max_wind_gust,
        }
    }


def count_consecutive(days: list, predicate) -> int:
    """Count max consecutive days matching a predicate."""
    max_count = 0
    current = 0
    for d in days:
        if predicate(d):
            current += 1
            max_count = max(max_count, current)
        else:
            current = 0
    return max_count
```

---

## 6. Case 2 — Long-Term Early Warning Pipeline

### 6.1 Design Differences from Case 1

| Aspect | Case 1 (Short-term) | Case 2 (Long-term) |
|--------|---------------------|---------------------|
| Forecast horizon | 1–10 days | 15 days – 6 months |
| Primary data source | WeatherNext 2 / Weather API | WeatherNext 2 (15d) + ECMWF C3S seasonal |
| Update frequency | Daily (3x/day) | WeatherNext: daily; Seasonal: monthly |
| Risk focus | Acute events (floods, cyclones, heat spikes) | Slow-onset crises (drought, monsoon failure, cumulative heat) |
| Thresholds | Absolute (>100mm/24h) | Anomaly-based (deviation from climatology) |
| Action type | Immediate protective action | Strategic planning (crop switching, water storage, insurance) |

### 6.2 Long-Term Forecast Pipeline

```python
# long_term_forecast_job.py
# Scheduled: 
#   - WeatherNext 15-day: Daily at 08:00 UTC
#   - Seasonal (C3S): 1st of each month at 04:00 UTC

def run_long_term_forecast():
    """Combine medium-range and seasonal forecasts."""
    
    users = load_registered_users()
    
    for user in users:
        lat, lng = user['latitude'], user['longitude']
        
        # --- WeatherNext 2: 15-day ensemble forecast ---
        wn2_forecast = get_weathernext_15day_ensemble(lat, lng)
        
        # --- Seasonal forecast (monthly) ---
        seasonal = load_latest_seasonal_forecast(user['id'])
        
        # --- Compute anomalies against 30-year climatology ---
        climatology = load_climatology(lat, lng)  # Pre-computed
        
        anomalies = compute_anomalies(
            wn2_forecast=wn2_forecast,
            seasonal_forecast=seasonal,
            climatology=climatology
        )
        
        # --- Drought indicator (SPI approximation) ---
        spi = compute_approximate_spi(
            forecast_precip=anomalies['precip_anomaly_pct'],
            historical_mean=climatology['precip_mean_mm'],
            historical_std=climatology['precip_std_mm']
        )
        
        # --- Long-term risk classification ---
        lt_risk = classify_long_term_risk(
            anomalies=anomalies,
            spi=spi,
            crop_baseline=load_latest_crop_baseline(user['id']),
            user_profile=user
        )
        
        store_long_term_forecast(user['id'], {
            'wn2_15day': wn2_forecast,
            'seasonal': seasonal,
            'anomalies': anomalies,
            'spi': spi,
            'risk': lt_risk
        })
        
        if lt_risk['tier'] >= 2:
            send_long_term_advisory(user, lt_risk)


def compute_approximate_spi(forecast_precip: float, 
                             historical_mean: float, 
                             historical_std: float) -> float:
    """
    Standardised Precipitation Index (simplified).
    SPI = (P - mean) / std
    
    SPI interpretation:
      > 2.0 : Extremely wet
      1.5 to 2.0 : Very wet  
      1.0 to 1.5 : Moderately wet
     -1.0 to 1.0 : Near normal
     -1.5 to -1.0: Moderately dry
     -2.0 to -1.5: Severely dry
      < -2.0 : Extremely dry
    """
    if historical_std == 0:
        return 0.0
    return (forecast_precip - historical_mean) / historical_std


def classify_long_term_risk(anomalies: dict, spi: float,
                             crop_baseline: dict, 
                             user_profile: dict) -> dict:
    """
    Classify long-term risk based on cumulative anomalies.
    """
    tier = 0
    reasons = []
    
    # Drought assessment
    if spi < -2.0:
        tier = max(tier, 4)
        reasons.append(f"Extreme drought signal (SPI={spi:.1f})")
    elif spi < -1.5:
        tier = max(tier, 3)
        reasons.append(f"Severe drought signal (SPI={spi:.1f})")
    elif spi < -1.0:
        tier = max(tier, 2)
        reasons.append(f"Moderate drought signal (SPI={spi:.1f})")
    
    # Excess rainfall / flood risk
    if anomalies.get('precip_anomaly_pct', 0) > 50:
        tier = max(tier, 3)
        reasons.append("Precipitation >50% above normal — flood risk")
    elif anomalies.get('precip_anomaly_pct', 0) > 30:
        tier = max(tier, 2)
        reasons.append("Precipitation >30% above normal — waterlogging risk")
    
    # Temperature anomaly
    temp_anomaly = anomalies.get('temp_anomaly_c', 0)
    if temp_anomaly > 3.0:
        tier = max(tier, 3)
        reasons.append(f"Temperature {temp_anomaly:.1f}°C above normal — "
                       "heat stress risk for crops")
    elif temp_anomaly > 2.0:
        tier = max(tier, 2)
        reasons.append(f"Temperature {temp_anomaly:.1f}°C above normal")
    
    # Cross-reference with crop vulnerability
    if crop_baseline:
        vulnerable_crops = identify_vulnerable_crops(crop_baseline, anomalies)
        if vulnerable_crops:
            reasons.append(f"Crops at risk: {', '.join(vulnerable_crops)}")
    
    return {
        'tier': tier,
        'tier_label': ['Normal','Advisory','Warning','Severe','Emergency'][tier],
        'spi': spi,
        'anomalies': anomalies,
        'reasons': reasons,
        'horizon': 'long_term',
        'recommended_actions': get_long_term_actions(tier, reasons)
    }
```

---

## 7. Case 3 — User-Initiated Queries

### 7.1 Query Interface Architecture

Users interact through a conversational agent accessible via WhatsApp, Telegram, SMS, or a web/mobile app. The agent understands natural-language queries in Bangla and English.

```
User Query → NLU Classification → Route to Handler:
  ├── "What's the weather now?"     → NowCast Handler (MetNet-3 / Current Conditions)
  ├── "Will it rain tomorrow?"      → Short-term Forecast Handler  
  ├── "What should I do with my     → Crop Advisory Handler
  │    rice crop?"                     (baseline + forecast + knowledge base)
  ├── "Is there a flood warning?"   → Alert Status Handler (latest risk tier)
  ├── "Best practices for Aman      → Knowledge Base Handler (RAG)
  │    rice in [district]"
  └── "When should I harvest?"      → Phenology + Forecast Handler
```

### 7.2 Query Handler Implementation

```python
# query_agent.py

from enum import Enum
from typing import Optional

class QueryIntent(Enum):
    CURRENT_WEATHER = "current_weather"
    SHORT_FORECAST = "short_forecast"
    LONG_FORECAST = "long_forecast"
    CROP_ADVISORY = "crop_advisory"
    ALERT_STATUS = "alert_status"
    BEST_PRACTICES = "best_practices"
    HARVEST_TIMING = "harvest_timing"
    GENERAL = "general"


def classify_intent(user_message: str) -> QueryIntent:
    """
    Classify user intent. In production, use an LLM or fine-tuned
    classifier. Simplified rule-based version shown here.
    """
    msg = user_message.lower()
    
    if any(kw in msg for kw in ['now', 'current', 'right now', 'এখন']):
        return QueryIntent.CURRENT_WEATHER
    elif any(kw in msg for kw in ['tomorrow', 'next week', 'আগামীকাল']):
        return QueryIntent.SHORT_FORECAST
    elif any(kw in msg for kw in ['season', 'monsoon', 'next month', 'মৌসুম']):
        return QueryIntent.LONG_FORECAST
    elif any(kw in msg for kw in ['what should i do', 'protect', 'advice', 'পরামর্শ']):
        return QueryIntent.CROP_ADVISORY
    elif any(kw in msg for kw in ['warning', 'alert', 'flood', 'cyclone', 'সতর্কতা']):
        return QueryIntent.ALERT_STATUS
    elif any(kw in msg for kw in ['best practice', 'how to grow', 'চাষ পদ্ধতি']):
        return QueryIntent.BEST_PRACTICES
    elif any(kw in msg for kw in ['harvest', 'when to cut', 'ফসল কাটা']):
        return QueryIntent.HARVEST_TIMING
    else:
        return QueryIntent.GENERAL


async def handle_query(user_id: str, message: str) -> str:
    """Route and handle a user query."""
    
    user = load_user(user_id)
    intent = classify_intent(message)
    
    if intent == QueryIntent.CURRENT_WEATHER:
        conditions = get_current_conditions(user['latitude'], user['longitude'])
        nowcast = get_nowcast_precipitation(user['latitude'], user['longitude'])
        return format_current_weather_response(conditions, nowcast, user)
    
    elif intent == QueryIntent.CROP_ADVISORY:
        baseline = load_latest_crop_baseline(user_id)
        forecast = load_latest_weather_forecast(user_id)
        risk = classify_risk(baseline, forecast, user)
        return generate_crop_advisory(risk, baseline, forecast, user)
    
    elif intent == QueryIntent.ALERT_STATUS:
        latest_risk = load_latest_risk_classification(user_id)
        return format_alert_status(latest_risk, user)
    
    elif intent == QueryIntent.BEST_PRACTICES:
        # RAG over agricultural knowledge base
        return await query_knowledge_base(message, user)
    
    elif intent == QueryIntent.HARVEST_TIMING:
        baseline = load_latest_crop_baseline(user_id)
        forecast = get_daily_forecast(user['latitude'], user['longitude'], 10)
        return generate_harvest_advisory(baseline, forecast, user)
    
    else:
        # Fall through to general LLM response with agricultural context
        return await generate_general_response(message, user)


def format_current_weather_response(conditions: dict, 
                                     nowcast: dict, 
                                     user: dict) -> str:
    """Format current conditions into a user-friendly response."""
    
    temp = conditions.get('temperature', {}).get('degrees', 'N/A')
    humidity = conditions.get('relativeHumidity', 'N/A')
    condition = conditions.get('weatherCondition', 'N/A')
    
    # Check precipitation in next few hours
    upcoming_rain = [
        h for h in nowcast.get('timeline', [])[:6]
        if (h.get('precipitation_probability') or 0) > 40
    ]
    
    response = (
        f"🌤 Current weather at your location:\n"
        f"  Temperature: {temp}°C\n"
        f"  Humidity: {humidity}%\n"
        f"  Conditions: {condition}\n"
    )
    
    if upcoming_rain:
        response += (
            f"\n🌧 Rain expected in the next few hours "
            f"(probability: {upcoming_rain[0]['precipitation_probability']}%)\n"
            f"  Expected amount: {upcoming_rain[0]['precipitation_amount_mm']}mm"
        )
    else:
        response += "\n✅ No significant rain expected in the next 6 hours."
    
    return response
```

---

## 8. Detection & Classification Engine

This is the core intelligence of the system — the function that takes a crop baseline and a weather forecast and determines what risk, if any, exists.

### 8.1 Classification Logic

```python
# detection_engine.py

from dataclasses import dataclass, field
from typing import List, Optional

@dataclass
class RiskAssessment:
    tier: int                    # 0-4
    tier_label: str              # Normal, Advisory, Warning, Severe, Emergency
    wmo_colour: str              # green, yellow, orange, red
    ipc_worsening: str           # none, watch, moderate_risk, high_risk
    hazards: List[str]           # List of identified hazards
    affected_crops: List[str]    # Crops at risk
    reasons: List[str]           # Human-readable explanations
    recommended_actions: List[str]  # What the user should do
    confidence: float            # 0-1
    horizon: str                 # short_term or long_term


# Thresholds for Bangladesh (calibrate per agro-ecological zone)
THRESHOLDS_BANGLADESH = {
    'heavy_rain_t2': 50,       # mm/24h → Tier 2
    'heavy_rain_t3': 100,      # mm/24h → Tier 3
    'extreme_rain_t4': 150,    # mm/24h → Tier 4
    'heat_wave_temp': 40,      # °C → Tier 2 if sustained
    'heat_extreme_temp': 43,   # °C → Tier 3
    'heat_wave_days': 3,       # consecutive days above heat_wave_temp → Tier 2
    'wind_t2': 62,             # km/h (tropical storm)
    'wind_t3': 88,             # km/h (severe tropical storm)
    'wind_t4': 118,            # km/h (cyclone)
    'cold_wave_temp': 10,      # °C — below this damages Boro rice
    'drought_spi_t2': -1.0,    # SPI threshold
    'drought_spi_t3': -1.5,
    'drought_spi_t4': -2.0,
}


# Crop vulnerability matrix — which hazards affect which crops at which stages
CROP_VULNERABILITY = {
    'rice_aman': {
        'flood': {'tillering': 'high', 'flowering': 'critical', 'maturity': 'moderate'},
        'drought': {'tillering': 'moderate', 'flowering': 'high', 'maturity': 'low'},
        'cyclone': {'all': 'high'},
        'heat': {'flowering': 'high', 'grain_filling': 'critical'},
    },
    'rice_boro': {
        'cold_wave': {'seedling': 'critical', 'tillering': 'high'},
        'heat': {'grain_filling': 'critical'},
        'drought': {'all': 'high'},  # Irrigation-dependent
    },
    'wheat': {
        'heat': {'grain_filling': 'critical'},  # Terminal heat stress
        'excess_rain': {'maturity': 'high'},  # Grain quality loss
    },
    'jute': {
        'flood': {'vegetative': 'moderate', 'maturity': 'high'},
        'waterlogging': {'all': 'high'},
    },
}


def classify_risk(crop_baseline: dict, weather_forecast: dict,
                   user_profile: dict) -> RiskAssessment:
    """
    Main risk classification function.
    
    Cross-references weather forecast against crop baseline
    to determine risk tier and generate advisory.
    """
    thresholds = THRESHOLDS_BANGLADESH
    derived = weather_forecast.get('derived', {})
    
    tier = 0
    hazards = []
    reasons = []
    affected_crops = []
    
    # --- PRECIPITATION / FLOOD ASSESSMENT ---
    max_precip = derived.get('max_precip_24h_mm', 0)
    
    if max_precip >= thresholds['extreme_rain_t4']:
        tier = max(tier, 4)
        hazards.append('extreme_rainfall')
        reasons.append(
            f"Extreme rainfall forecast: {max_precip}mm in 24h "
            f"(threshold: {thresholds['extreme_rain_t4']}mm)"
        )
    elif max_precip >= thresholds['heavy_rain_t3']:
        tier = max(tier, 3)
        hazards.append('heavy_rainfall')
        reasons.append(
            f"Heavy rainfall forecast: {max_precip}mm in 24h "
            f"(threshold: {thresholds['heavy_rain_t3']}mm)"
        )
    elif max_precip >= thresholds['heavy_rain_t2']:
        tier = max(tier, 2)
        hazards.append('moderate_rainfall')
        reasons.append(
            f"Significant rainfall forecast: {max_precip}mm in 24h"
        )
    
    # --- WIND / CYCLONE ASSESSMENT ---
    max_wind = derived.get('max_wind_gust_kmh', 0)
    
    if max_wind >= thresholds['wind_t4']:
        tier = max(tier, 4)
        hazards.append('cyclone')
        reasons.append(
            f"Cyclone-force winds forecast: {max_wind}km/h"
        )
    elif max_wind >= thresholds['wind_t3']:
        tier = max(tier, 3)
        hazards.append('severe_storm')
        reasons.append(
            f"Severe storm winds forecast: {max_wind}km/h"
        )
    elif max_wind >= thresholds['wind_t2']:
        tier = max(tier, 2)
        hazards.append('tropical_storm')
        reasons.append(
            f"Tropical storm winds forecast: {max_wind}km/h"
        )
    
    # --- HEAT ASSESSMENT ---
    max_temp = derived.get('max_temp_c', 0)
    consecutive_hot = derived.get('consecutive_hot_days_above_38', 0)
    
    if max_temp >= thresholds['heat_extreme_temp']:
        tier = max(tier, 3)
        hazards.append('extreme_heat')
        reasons.append(f"Extreme temperature forecast: {max_temp}°C")
    elif max_temp >= thresholds['heat_wave_temp'] and \
         consecutive_hot >= thresholds['heat_wave_days']:
        tier = max(tier, 2)
        hazards.append('heat_wave')
        reasons.append(
            f"Heat wave: {consecutive_hot} consecutive days above "
            f"{thresholds['heat_wave_temp']}°C"
        )
    
    # --- COLD WAVE (Rabi season) ---
    min_temp = min(
        (d.get('temp_min_c') or 99) 
        for d in weather_forecast.get('daily', [])
    ) if weather_forecast.get('daily') else 99
    
    if min_temp <= thresholds['cold_wave_temp']:
        tier = max(tier, 2)
        hazards.append('cold_wave')
        reasons.append(
            f"Cold wave: minimum temperature {min_temp}°C "
            f"(threshold: {thresholds['cold_wave_temp']}°C)"
        )
    
    # --- DROUGHT (multi-day dry spell) ---
    consecutive_dry = derived.get('consecutive_dry_days', 0)
    if consecutive_dry >= 10:
        tier = max(tier, 2)
        hazards.append('dry_spell')
        reasons.append(f"Extended dry spell: {consecutive_dry} consecutive dry days")
    
    # --- CROP CROSS-REFERENCE ---
    if crop_baseline and hazards:
        affected_crops = cross_reference_crops(
            crop_baseline, hazards, user_profile
        )
        if affected_crops:
            reasons.append(
                f"Crops in field at risk: {', '.join(affected_crops)}"
            )
    
    # --- BUILD RESULT ---
    tier_labels = ['Normal', 'Advisory', 'Warning', 'Severe', 'Emergency']
    wmo_colours = ['green', 'yellow', 'orange', 'red', 'red']
    ipc_levels = ['none', 'none', 'watch', 'moderate_risk', 'high_risk']
    
    return RiskAssessment(
        tier=tier,
        tier_label=tier_labels[tier],
        wmo_colour=wmo_colours[tier],
        ipc_worsening=ipc_levels[tier],
        hazards=hazards,
        affected_crops=affected_crops,
        reasons=reasons,
        recommended_actions=get_recommended_actions(tier, hazards, affected_crops),
        confidence=compute_confidence(weather_forecast),
        horizon='short_term'
    )


def cross_reference_crops(baseline: dict, hazards: list, 
                           user_profile: dict) -> list:
    """Determine which crops in the baseline are vulnerable to the detected hazards."""
    affected = []
    
    # Determine current growing season based on date
    from datetime import datetime
    month = datetime.utcnow().month
    
    # Simplified season detection for Bangladesh
    if month in [6, 7, 8, 9, 10, 11]:  # Kharif-2
        active_crops = ['rice_aman', 'jute']
    elif month in [3, 4, 5]:  # Kharif-1 / late Rabi
        active_crops = ['rice_boro', 'rice_aus', 'wheat', 'jute']
    else:  # Rabi
        active_crops = ['rice_boro', 'wheat']
    
    for crop in active_crops:
        vuln = CROP_VULNERABILITY.get(crop, {})
        for hazard in hazards:
            hazard_type = hazard.split('_')[0] if '_' in hazard else hazard
            if hazard_type in ['heavy', 'extreme', 'moderate']:
                hazard_type = 'flood'
            if hazard_type in vuln:
                affected.append(crop.replace('_', ' ').title())
                break
    
    return list(set(affected))


def get_recommended_actions(tier: int, hazards: list, 
                             affected_crops: list) -> list:
    """Generate actionable recommendations based on risk tier and hazards."""
    
    actions = []
    
    if tier >= 4:
        actions.append("🚨 EVACUATE to higher ground if in flood-prone area")
        actions.append("Secure all livestock and critical farm equipment immediately")
        actions.append("Do NOT attempt to harvest or work in fields")
        actions.append("Contact local disaster management authority")
    
    if tier >= 3:
        actions.append("Prepare emergency supplies (water, food, documents)")
        actions.append("Reinforce temporary structures and storage facilities")
    
    if 'flood' in str(hazards) or 'rainfall' in str(hazards):
        actions.append("Open drainage channels to prevent waterlogging")
        actions.append("If possible, harvest mature crops before rains arrive")
        actions.append("Move stored grain to elevated, waterproof location")
    
    if 'heat' in str(hazards):
        actions.append("Irrigate crops during cooler hours (early morning/evening)")
        actions.append("Apply mulch to retain soil moisture")
        actions.append("Avoid midday farm work — risk of heat exhaustion")
    
    if 'cyclone' in str(hazards):
        actions.append("Stake tall crops (jute, sugarcane) to reduce wind damage")
        actions.append("Move to cyclone shelter when authorities advise")
        actions.append("Secure fishing boats and coastal assets")
    
    if 'cold_wave' in str(hazards):
        actions.append("Cover seedbeds with polythene or straw at night")
        actions.append("Irrigate fields — standing water reduces frost damage")
    
    if 'dry_spell' in str(hazards):
        actions.append("Prioritise irrigation for crops at flowering/grain-filling stage")
        actions.append("Consider supplementary irrigation scheduling")
    
    if tier >= 2:
        actions.append("Monitor updates from this system and local meteorological service")
    
    return actions


def compute_confidence(forecast: dict) -> float:
    """
    Estimate forecast confidence based on lead time and 
    ensemble spread (if available).
    """
    # Simplified: higher confidence for shorter lead times
    days = forecast.get('daily', [])
    if not days:
        return 0.5
    
    # First 3 days: high confidence; degrades linearly
    n_days = len(days)
    if n_days <= 3:
        return 0.85
    elif n_days <= 7:
        return 0.70
    else:
        return 0.55
```

---

## 9. Notification & Dissemination System

### 9.1 Multi-Channel Notification Strategy

Following the EW4All Pillar 3 (Warning Dissemination) principle, warnings must reach users through multiple channels appropriate to their context:

| Risk Tier | Channels | Timing |
|-----------|----------|--------|
| Tier 0 | None (log only) | — |
| Tier 1 | Optional daily digest email/app | Next scheduled digest |
| Tier 2 | Push notification + SMS | Within 30 minutes of detection |
| Tier 3 | Push + SMS + Voice call (IVR) | Within 15 minutes |
| Tier 4 | Push + SMS + Voice + Community alert relay | Immediate (<5 minutes) |

### 9.2 Notification Implementation

```python
# notification_service.py

import asyncio
from dataclasses import dataclass
from typing import List

@dataclass
class NotificationPayload:
    user_id: str
    tier: int
    title: str
    body: str
    actions: List[str]
    language: str  # 'bn' or 'en'
    channels: List[str]  # ['push', 'sms', 'voice', 'community']


async def send_early_warning(user: dict, risk_result, 
                              forecast: dict, baseline: dict):
    """Dispatch early warning through appropriate channels."""
    
    tier = risk_result.tier if hasattr(risk_result, 'tier') else risk_result['tier']
    
    # Determine channels based on tier
    channels = []
    if tier >= 2:
        channels.extend(['push', 'sms'])
    if tier >= 3:
        channels.append('voice')
    if tier >= 4:
        channels.append('community')
    
    # Generate message in user's preferred language
    lang = user.get('language', 'bn')
    title, body = generate_alert_message(risk_result, lang)
    
    payload = NotificationPayload(
        user_id=user['id'],
        tier=tier,
        title=title,
        body=body,
        actions=risk_result.recommended_actions if hasattr(risk_result, 'recommended_actions') else risk_result.get('recommended_actions', []),
        language=lang,
        channels=channels
    )
    
    # Dispatch in parallel
    tasks = []
    if 'push' in channels:
        tasks.append(send_push_notification(payload))
    if 'sms' in channels:
        tasks.append(send_sms(payload, user['phone_number']))
    if 'voice' in channels:
        tasks.append(send_voice_call(payload, user['phone_number']))
    if 'community' in channels:
        tasks.append(relay_to_community_leaders(payload, user['district']))
    
    await asyncio.gather(*tasks)
    
    # Log notification
    log_notification(payload)


def generate_alert_message(risk_result, language: str) -> tuple:
    """Generate localised alert title and body."""
    
    tier = risk_result.tier if hasattr(risk_result, 'tier') else risk_result['tier']
    tier_label = risk_result.tier_label if hasattr(risk_result, 'tier_label') else risk_result.get('tier_label', '')
    reasons = risk_result.reasons if hasattr(risk_result, 'reasons') else risk_result.get('reasons', [])
    actions = risk_result.recommended_actions if hasattr(risk_result, 'recommended_actions') else risk_result.get('recommended_actions', [])
    
    if language == 'bn':
        tier_names = {
            2: '⚠️ সতর্কবার্তা',
            3: '🔴 গুরুতর সতর্কতা',
            4: '🚨 জরুরি সতর্কতা'
        }
        title = tier_names.get(tier, 'সতর্কবার্তা')
        body = f"{title}\n\n"
        body += "কারণ:\n" + "\n".join(f"- {r}" for r in reasons[:3])
        body += "\n\nকরণীয়:\n" + "\n".join(f"- {a}" for a in actions[:4])
    else:
        tier_names = {
            2: '⚠️ WARNING',
            3: '🔴 SEVERE WARNING',
            4: '🚨 EMERGENCY ALERT'
        }
        title = tier_names.get(tier, 'ALERT')
        body = f"{title}\n\n"
        body += "Reasons:\n" + "\n".join(f"- {r}" for r in reasons[:3])
        body += "\n\nActions:\n" + "\n".join(f"- {a}" for a in actions[:4])
    
    return title, body


async def send_push_notification(payload: NotificationPayload):
    """Send via Firebase Cloud Messaging or similar."""
    # Integration with FCM, OneSignal, etc.
    print(f"[PUSH] Tier {payload.tier} alert sent to {payload.user_id}")


async def send_sms(payload: NotificationPayload, phone: str):
    """Send via Twilio, Vonage, or local SMS gateway."""
    # Truncate to 160 chars for SMS
    sms_body = f"{payload.title}\n{payload.body[:120]}..."
    print(f"[SMS] Tier {payload.tier} alert sent to {phone}")


async def send_voice_call(payload: NotificationPayload, phone: str):
    """Initiate IVR call with text-to-speech advisory."""
    # Integration with Twilio Voice, Vonage, or local telco
    print(f"[VOICE] Tier {payload.tier} IVR call to {phone}")


async def relay_to_community_leaders(payload: NotificationPayload, 
                                      district: str):
    """Relay to local community leaders and disaster response teams."""
    # Push to community WhatsApp groups, local radio integration, etc.
    print(f"[COMMUNITY] Tier {payload.tier} relay to {district}")
```

---

## 10. Scheduling, Orchestration & Infrastructure

### 10.1 Recommended Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Orchestrator** | Temporal.io (preferred) or Prefect | Durable workflows, retry logic, visibility. Superior to cron for complex pipelines with dependencies. |
| **Task Queue** | Redis + Celery (if simple) or Temporal's built-in | Async notification dispatch |
| **API** | FastAPI (Python) | Async, OpenAPI docs, excellent for the query interface |
| **Database** | PostgreSQL + PostGIS | Geospatial queries, JSONB for baselines and forecasts |
| **Cache** | Redis | Forecast caching, rate limiting |
| **Message Broker** | RabbitMQ or Redis Streams | Notification dispatch queue |
| **Monitoring** | Prometheus + Grafana | Pipeline health, latency, alert delivery rates |
| **Deployment** | Kubernetes (GKE) or Cloud Run | Scaling, reliability |

### 10.2 Temporal.io Workflow Definition

```python
# workflows.py — Temporal.io workflow definitions

from datetime import timedelta
from temporalio import workflow
from temporalio.common import RetryPolicy

@workflow.defn
class ShortTermEWSWorkflow:
    """
    Daily short-term early warning workflow.
    Runs 3x/day for each registered user.
    """
    
    @workflow.run
    async def run(self, user_id: str):
        retry = RetryPolicy(
            maximum_attempts=3,
            initial_interval=timedelta(seconds=30),
        )
        
        # Step 1: Fetch latest crop baseline
        baseline = await workflow.execute_activity(
            fetch_latest_crop_baseline,
            user_id,
            start_to_close_timeout=timedelta(minutes=2),
            retry_policy=retry,
        )
        
        # Step 2: Fetch weather forecast
        forecast = await workflow.execute_activity(
            fetch_weather_forecast,
            user_id,
            start_to_close_timeout=timedelta(minutes=5),
            retry_policy=retry,
        )
        
        # Step 3: Run detection engine
        risk_result = await workflow.execute_activity(
            run_risk_classification,
            (baseline, forecast, user_id),
            start_to_close_timeout=timedelta(minutes=1),
        )
        
        # Step 4: Send notification if warranted
        if risk_result['tier'] >= 2:
            await workflow.execute_activity(
                dispatch_notification,
                (user_id, risk_result, forecast, baseline),
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=retry,
            )
        
        # Step 5: Store results
        await workflow.execute_activity(
            store_run_results,
            (user_id, risk_result, forecast),
            start_to_close_timeout=timedelta(minutes=1),
        )


@workflow.defn
class WeeklyCropBaselineWorkflow:
    """Weekly crop baseline generation for all users."""
    
    @workflow.run
    async def run(self):
        users = await workflow.execute_activity(
            fetch_all_active_users,
            start_to_close_timeout=timedelta(minutes=1),
        )
        
        # Fan-out: generate baselines in parallel (with concurrency limit)
        for user_id in users:
            await workflow.execute_child_workflow(
                CropBaselineForUser,
                user_id,
            )
```

### 10.3 Alternative: Cron + Celery (Simpler Deployment)

For teams that prefer a lighter-weight orchestration:

```python
# celery_config.py

from celery import Celery
from celery.schedules import crontab

app = Celery('agews', broker='redis://localhost:6379/0')

app.conf.beat_schedule = {
    # Weekly crop baseline — every Monday at 02:00 UTC
    'weekly-crop-baseline': {
        'task': 'tasks.run_weekly_crop_baseline',
        'schedule': crontab(hour=2, minute=0, day_of_week=1),
    },
    # Daily weather forecast + detection — 3x/day
    'daily-weather-0600': {
        'task': 'tasks.run_daily_weather_forecast',
        'schedule': crontab(hour=6, minute=0),
    },
    'daily-weather-1200': {
        'task': 'tasks.run_daily_weather_forecast',
        'schedule': crontab(hour=12, minute=0),
    },
    'daily-weather-1800': {
        'task': 'tasks.run_daily_weather_forecast',
        'schedule': crontab(hour=18, minute=0),
    },
    # Long-term forecast — daily at 08:00 UTC
    'long-term-forecast': {
        'task': 'tasks.run_long_term_forecast',
        'schedule': crontab(hour=8, minute=0),
    },
    # Seasonal forecast update — 1st of each month
    'seasonal-forecast': {
        'task': 'tasks.update_seasonal_forecast',
        'schedule': crontab(hour=4, minute=0, day_of_month=1),
    },
}
```

### 10.4 FastAPI — User Query Endpoint

```python
# api.py

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Agricultural Early Warning System API")

class QueryRequest(BaseModel):
    user_id: str
    message: str
    language: str = "en"

class QueryResponse(BaseModel):
    response: str
    risk_tier: int | None = None
    sources: list[str] = []

@app.post("/query", response_model=QueryResponse)
async def handle_user_query(req: QueryRequest):
    """Handle a user-initiated query (Case 3)."""
    try:
        response_text = await handle_query(req.user_id, req.message)
        latest_risk = load_latest_risk_classification(req.user_id)
        return QueryResponse(
            response=response_text,
            risk_tier=latest_risk.get('tier') if latest_risk else None,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/status/{user_id}")
async def get_user_status(user_id: str):
    """Get the current risk status for a user."""
    baseline = load_latest_crop_baseline(user_id)
    forecast = load_latest_weather_forecast(user_id)
    risk = load_latest_risk_classification(user_id)
    return {
        "baseline_updated": baseline.get('generated_at') if baseline else None,
        "forecast_updated": forecast.get('fetched_at') if forecast else None,
        "current_risk": risk,
    }


@app.post("/register")
async def register_user(user: dict):
    """Register a new user with their location and AOI."""
    # Validate, geocode, store
    pass
```

---

## 11. Data Model & Storage

### 11.1 PostgreSQL Schema

```sql
-- Core user registration
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(255),
    district VARCHAR(100) NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    aoi_geojson JSONB,              -- Area of interest polygon
    language VARCHAR(5) DEFAULT 'bn', -- 'bn' or 'en'
    notification_prefs JSONB DEFAULT '{"push": true, "sms": true, "voice": false}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    active BOOLEAN DEFAULT TRUE
);

-- Weekly crop baselines
CREATE TABLE crop_baselines (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    baseline_json JSONB NOT NULL,     -- Machine-readable baseline
    baseline_md TEXT,                  -- Markdown report
    satellite_source VARCHAR(100),
    analysis_period_start DATE,
    analysis_period_end DATE,
    generated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_baselines_user_date ON crop_baselines(user_id, generated_at DESC);

-- Weather forecasts
CREATE TABLE weather_forecasts (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    forecast_type VARCHAR(20) NOT NULL, -- 'short_term', 'long_term', 'seasonal'
    forecast_json JSONB NOT NULL,
    source VARCHAR(100),               -- 'weathernext2', 'weather_api', 'c3s'
    fetched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_forecasts_user_date ON weather_forecasts(user_id, fetched_at DESC);

-- Risk assessments
CREATE TABLE risk_assessments (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    tier INTEGER NOT NULL CHECK (tier BETWEEN 0 AND 4),
    tier_label VARCHAR(20),
    wmo_colour VARCHAR(10),
    hazards JSONB,
    affected_crops JSONB,
    reasons JSONB,
    recommended_actions JSONB,
    confidence DOUBLE PRECISION,
    horizon VARCHAR(20),             -- 'short_term' or 'long_term'
    baseline_id INTEGER REFERENCES crop_baselines(id),
    forecast_id INTEGER REFERENCES weather_forecasts(id),
    assessed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_risk_user_date ON risk_assessments(user_id, assessed_at DESC);
CREATE INDEX idx_risk_tier ON risk_assessments(tier) WHERE tier >= 2;

-- Notification log
CREATE TABLE notifications (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    risk_assessment_id INTEGER REFERENCES risk_assessments(id),
    channels JSONB,                   -- ["push", "sms", "voice"]
    title TEXT,
    body TEXT,
    language VARCHAR(5),
    delivered_at TIMESTAMPTZ,
    delivery_status JSONB,            -- Per-channel status
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User queries (Case 3)
CREATE TABLE user_queries (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    message TEXT NOT NULL,
    intent VARCHAR(50),
    response TEXT,
    queried_at TIMESTAMPTZ DEFAULT NOW()
);

-- Climatology reference (pre-loaded)
CREATE TABLE climatology (
    id SERIAL PRIMARY KEY,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    month INTEGER,
    precip_mean_mm DOUBLE PRECISION,
    precip_std_mm DOUBLE PRECISION,
    temp_mean_c DOUBLE PRECISION,
    temp_std_c DOUBLE PRECISION,
    UNIQUE(latitude, longitude, month)
);
```

---

## 12. End-to-End Worked Example — Bangladesh

### Scenario

A rice farmer named Rahim is registered in **Sunamganj district** (Sylhet Division), one of Bangladesh's most flood-prone areas. It is **August** (Kharif-2 season), and Aman rice is at the **tillering stage**.

### Step 1: Weekly Crop Baseline (Monday)

The agent runs the Earth Engine analysis for Rahim's AOI (a 10km radius around his village). Sentinel-2 imagery from the past 30 days shows NDVI of 0.55 (healthy vegetation), NDWI of 0.12 (some standing water — normal for lowland rice). The ESA WorldCover confirms 78% of the AOI is cropland. The agent also references the DAE's district crop report confirming Aman rice transplanting was completed in July. Output: a crop baseline JSON and markdown report stored in the database.

### Step 2: Daily Weather Forecast (Tuesday 06:00 UTC)

The agent pulls the Google Maps Platform Weather API forecast. The results show:

- **Wednesday:** 85mm rainfall, 98% probability. Wind gusts 45 km/h.
- **Thursday:** 120mm rainfall, 95% probability. Wind gusts 65 km/h.
- **Friday:** 60mm rainfall, 80% probability.
- **Cumulative 3-day:** 265mm.

### Step 3: Detection Engine Runs

The engine evaluates:

- Thursday's 120mm exceeds the Tier 3 threshold (100mm/24h) → **Tier 3 triggered**
- Thursday's wind gusts of 65 km/h exceed Tier 2 threshold (62 km/h) → Tier 2 confirmed
- Cumulative 3-day rainfall of 265mm signals major flood risk
- Cross-reference: Aman rice at tillering stage has **HIGH** vulnerability to flooding

**Result:** Risk Tier 3 — SEVERE WARNING

### Step 4: Notification Dispatched

Within 15 minutes, Rahim receives:

**Push notification (Bangla):**
> 🔴 গুরুতর সতর্কতা — সুনামগঞ্জ
> বৃহস্পতিবার ভারী বৃষ্টিপাত প্রত্যাশিত (১২০মিমি)। বন্যার ঝুঁকি বেশি।
> আপনার আমন ধান (কুশি পর্যায়) ক্ষতিগ্রস্ত হতে পারে।
> করণীয়: নিষ্কাশন নালা খুলুন। পরিপক্ব ফসল থাকলে তাড়াতাড়ি কাটুন।

**SMS (shortened):**
> ⚠ SEVERE: Heavy rain 120mm Thu. Flood risk HIGH. Open drainage. Move grain to safety. -AgEWS

**Voice call (IVR in Bangla):**
> Automated call with text-to-speech advisory, repeated twice.

### Step 5: Rahim Asks a Follow-Up (Case 3)

Later that evening, Rahim sends a WhatsApp message: "আমার ধানের জন্য কী করা উচিত?" ("What should I do for my rice?")

The agent classifies this as `CROP_ADVISORY`, loads his baseline (Aman rice, tillering), the latest forecast (heavy rain), and the risk assessment (Tier 3). It responds with specific, actionable advice in Bangla about drainage, field management during floods, and post-flood recovery steps.

---

## 13. Security, Ethics & Governance

### 13.1 Data Privacy

- User location data is sensitive. Encrypt at rest (AES-256) and in transit (TLS 1.3).
- Minimize data collection: store only what is needed for the AOI analysis.
- Comply with Bangladesh's Digital Security Act and any applicable data protection regulations.
- Allow users to delete their data and deregister at any time.

### 13.2 Alert Accuracy & Liability

- The system explicitly states it is an advisory tool, not a replacement for official government warnings from the Bangladesh Meteorological Department (BMD).
- All notifications include a disclaimer referencing official sources.
- False alarm rates must be monitored and minimized through threshold tuning.

### 13.3 Equity & Access

- SMS and voice channels ensure reach to users without smartphones.
- Bangla language support is mandatory (not optional).
- Community relay ensures collective action, not just individual response.
- The system should not create dependency — it should complement, not replace, indigenous knowledge.

### 13.4 API Cost Management

- Google Maps Platform Weather API and Earth Engine have usage costs. Budget for per-user API calls.
- Cache forecasts aggressively: weather data for a district can serve all users in that district.
- Use Open-Meteo as a zero-cost fallback for development and low-resource deployments.

---

## 14. Testing & Validation Strategy

### 14.1 Backtesting Against Historical Events

Validate the detection engine against known historical disasters in Bangladesh:

| Event | Date | Expected Tier | Variables to Reproduce |
|-------|------|---------------|----------------------|
| Cyclone Amphan | May 2020 | Tier 4 | Wind 185 km/h, rain 200mm+, storm surge |
| Sylhet Floods | June 2022 | Tier 4 | 300mm+ rain over 3 days |
| 2024 Heat Wave | April 2024 | Tier 3 | 43°C+ for 5 consecutive days |
| Normal Monsoon Week | Any July | Tier 0-1 | 30-50mm/day, within seasonal norms |

### 14.2 Testing Layers

- **Unit tests:** Each function in the detection engine, threshold comparisons.
- **Integration tests:** End-to-end pipeline with mock API responses.
- **Backtests:** Historical weather data → expected risk tier.
- **Notification tests:** Verify delivery across SMS, push, voice channels.
- **User acceptance testing:** Field testing with farmers in target districts.
- **Stress tests:** Simulate 100,000 users × 3 daily runs.

---

## 15. Critique Log & Design Iterations

### Iteration 1 — Initial Design Critique

**Critique:**
1. **Single-point-of-failure in Weather API:** If the Google Maps Platform Weather API is down, no forecasts are produced. There is no fallback.
2. **Static thresholds are dangerous:** The same 100mm threshold for Tier 3 makes no sense in Sylhet (where 100mm in monsoon is unremarkable) vs. Rajshahi (where it would be catastrophic). Thresholds must be **regionally calibrated**.
3. **No ensemble spread consideration:** WeatherNext 2 produces 64 ensemble members, but the current design only uses the mean. A 120mm ensemble mean where 50 members show 50mm and 14 members show 500mm is very different from a tight cluster around 120mm. Ignoring spread is a major flaw.
4. **Crop baseline is too coarse:** NDVI thresholding alone cannot distinguish Aman from Boro rice, or rice from jute. This needs supervised classification with ground-truth training data.
5. **Notification fatigue:** Sending Tier 2 alerts during every monsoon week will train users to ignore all alerts. There must be a fatigue management mechanism.
6. **No feedback loop:** The system never learns whether its alerts were useful or accurate. There is no mechanism for users to report what actually happened.

**Fixes applied:**
- Added Open-Meteo as fallback weather source.
- Noted regional calibration requirement throughout the document (thresholds are illustrative).
- Added confidence scoring based on ensemble spread (to be fully implemented).
- Acknowledged classification limitations and pointed to Random Forest with training data.
- Added Tier 1 "digest" mode instead of real-time alert to reduce fatigue.
- Recommended post-event feedback surveys in the query interface.

### Iteration 2 — Architecture Critique

**Critique:**
1. **Temporal.io adds operational complexity.** For a team deploying in a developing-country context, this is a heavy dependency. Celery + cron is more widely understood and easier to maintain.
2. **The detection engine is purely rule-based.** While rule-based systems are transparent and explainable (important for trust), they cannot capture non-linear interactions between weather variables and crop vulnerability. A hybrid approach (rules + ML) would be stronger.
3. **No consideration of compound events.** The engine checks each hazard independently. A scenario of moderate rain (70mm) + high wind (55 km/h) + already-saturated soil might be worse than 100mm of gentle rain. Compound event detection is missing.
4. **Document-based baseline enrichment is hand-waved.** The `enrich_baseline_with_documents` function is a placeholder. In reality, building a RAG pipeline over FAO/DAE/BARI documents is a significant engineering effort.
5. **No offline mode.** Farmers in remote areas may lose connectivity during exactly the events they need warnings for. Pre-caching warnings is not addressed.

**Fixes applied:**
- Provided both Temporal.io and Celery/cron implementations; recommended Celery for initial deployment.
- Noted opportunity for ML-based risk scoring as a future enhancement alongside the rule engine.
- Added note about compound event detection as an important extension.
- Acknowledged RAG complexity and framed the document enrichment as a "next phase" component.
- Recommended that SMS and voice channels serve as offline-resilient delivery mechanisms (SMS is store-and-forward; IVR calls retry).

### Iteration 3 — Operational & Humanitarian Critique

**Critique:**
1. **Who maintains this system?** The guide assumes a technical team will operate it indefinitely. In humanitarian contexts, projects lose funding. The architecture should be designed for minimal operational cost and potential handoff to government agencies.
2. **The IPC integration is aspirational, not real.** The system maps risk tiers to IPC worsening levels, but does not actually consume IPC data or produce IPC-compatible outputs. For real interoperability with the UN humanitarian system, the output format should align with the IPC Analytical Framework.
3. **WeatherNext 2 access requires a form submission.** It is not a self-service API. The guide should be upfront about the access process and timeline.
4. **Cultural and gender considerations are absent.** Women in Bangladesh are often the primary agricultural labourers but may not own phones. The community relay mechanism needs to explicitly address this.
5. **The system does not account for non-weather shocks** — pest outbreaks, market price crashes, conflict-driven displacement — which are equally important drivers of food insecurity. The IPC framework incorporates all of these, but our detection engine only handles weather.
6. **Bangladesh already has an early warning system** (Bangladesh Meteorological Department + Flood Forecasting and Warning Centre). This system should position itself as a complement, not a competitor, and ideally integrate with BMD's existing alert hierarchy.

**Fixes applied:**
- Added section on cost management and sustainability, favouring open-source/free alternatives where possible.
- Explicitly noted that WeatherNext 2 requires application via the Data Request form.
- Expanded notification system to include community relay with explicit mention of gender-responsive design.
- Positioned the system as complementary to BMD in the ethics section.
- Acknowledged non-weather drivers as out of scope for this pipeline but recommended integration points.

---

## Appendix A: API Access Summary

| API / Service | Access Method | Cost | Registration |
|--------------|---------------|------|-------------|
| Google Earth Engine | `earthengine-api` Python package | Free for research; commercial terms for production | [Sign up](https://earthengine.google.com/) |
| WeatherNext 2 (Earth Engine / BigQuery) | EE / BQ after form approval | Subject to GCP costs | [WeatherNext Data Request form](https://developers.google.com/weathernext/guides/access-forecast) |
| WeatherNext 2 (Vertex AI) | Early access program | GCP Vertex AI pricing | Via form above |
| Google Maps Platform Weather API | REST API with API key | Pay-per-use (Maps Platform pricing) | [Maps Platform Console](https://console.cloud.google.com/) |
| ECMWF C3S (Copernicus) | `cdsapi` Python package | Free | [CDS Registration](https://cds.climate.copernicus.eu/) |
| Open-Meteo | REST API, no key | Free | None |
| IRI Seasonal Forecasts | Web download / Data Library | Free | None |

## Appendix B: Bangladesh Agro-Ecological Zones Reference

Bangladesh is divided into 30 Agro-Ecological Zones (AEZs). Threshold calibration should reference the zone-specific climate normals published by the Bangladesh Meteorological Department and CEGIS (Centre for Environmental and Geographic Information Services). Key zones for flood vulnerability include AEZ 19 (Old Meghna Estuarine Floodplain), AEZ 21 (Sylhet Basin), and AEZ 13 (Ganges Tidal Floodplain).

## Appendix C: Glossary

| Term | Definition |
|------|-----------|
| AOI | Area of Interest — the geographic region being monitored |
| EW4All | Early Warnings for All — UN Secretary-General's initiative |
| IPC | Integrated Food Security Phase Classification |
| NDVI | Normalised Difference Vegetation Index |
| NDWI | Normalised Difference Water Index |
| NowCast | Very short-term forecast (0–12 hours) |
| SPI | Standardised Precipitation Index |
| WMO | World Meteorological Organization |
| IBFWS | Impact-Based Forecast and Warning Services |
| MHEWS | Multi-Hazard Early Warning Systems |
| BMD | Bangladesh Meteorological Department |
| DAE | Department of Agricultural Extension (Bangladesh) |
| BARI | Bangladesh Agricultural Research Institute |

---

*This document is a technical blueprint. Implementation requires domain expertise in agricultural science, local meteorological knowledge, and community engagement. All thresholds and crop vulnerability profiles should be validated with agronomists and national meteorological services before deployment.*
