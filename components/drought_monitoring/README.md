# 🌦️ Drought Early-Warning Monitor

A command-line tool for real-time drought monitoring at any geographic coordinate. It fetches satellite data from Google Earth Engine (SMAP soil moisture + MODIS vegetation index), compares them against calibrated thresholds, and produces a structured drought severity report.

---

## Table of Contents

- [Overview](#overview)
- [How It Works](#how-it-works)
- [Drought Scoring](#drought-scoring)
- [Project Structure](#project-structure)
- [Requirements](#requirements)
- [Installation](#installation)
- [Google Earth Engine Setup](#google-earth-engine-setup)
- [Usage](#usage)
- [Output](#output)
- [Docker](#docker)
- [Thresholds Reference](#thresholds-reference)

---

## Overview

Given a latitude/longitude coordinate, this tool:

1. Reverse-geocodes the coordinate to a district name and bounding box via Nominatim
2. Fetches the last N days of SMAP SPL4SMGP/008 and MODIS MOD13A2 data over that bounding box via GEE
3. Spatially and temporally averages each indicator
4. Compares observed values against pre-calibrated thresholds
5. Produces a drought score (0–4) mapped to a severity level: **NORMAL / WATCH / MODERATE / SEVERE**

---

## How It Works

### Data Sources

| Dataset | Product | Bands Used | Native Unit |
|---|---|---|---|
| SMAP | SPL4SMGP/008 | `sm_surface` | m³/m³ |
| SMAP | SPL4SMGP/008 | `overland_runoff_flux` | kg/m²/s → mm/day |
| SMAP | SPL4SMGP/008 | `land_evapotranspiration_flux` | kg/m²/s → mm/day |
| MODIS | MOD13A2 | `NDVI` | scaled integer → float |

SMAP flux bands are multiplied by `86400` to convert from kg/m²/s to mm/day, which is the unit the thresholds are calibrated in. All three SMAP bands are fetched in a single GEE call. MODIS NDVI uses ±16/8 day padding to account for its 16-day composite cycle.

### Pipeline

```
coordinate (lat, lon)
       │
       ▼
Nominatim reverse-geocode → district name + bounding box
       │
       ▼
GEE fetch SMAP (sm_surface, runoff, ET) over bbox × N days
GEE fetch MODIS NDVI over bbox × N days (±padding)
       │
       ▼
Spatial mean → temporal mean per band
       │
       ▼
Compare vs thresholds → per-band flag (0 or 1)
       │
       ▼
Sum flags → drought score 0–4 → severity level
       │
       ▼
Output pdf with information on drought instensity
```

---

## Drought Scoring

Each of the 4 bands votes independently. If the observed value falls below its alert threshold, that band contributes 1 point to the drought score.

| Score | Level | Meaning |
|---|---|---|
| 0 | NORMAL | All indicators within healthy range |
| 1 | NORMAL | Minor stress, within tolerance |
| 2 | WATCH | Two indicators below threshold |
| 3 | MODERATE | Significant drought stress |
| 4 | SEVERE | All indicators in drought range |

Score ≥ 2 triggers WATCH, ≥ 3 MODERATE, ≥ 4 SEVERE.

### Thresholds

| Band | Good Mean | Drought Mean | Alert Threshold |
|---|---|---|---|
| `sm_surface` (m³/m³) | 0.3576 | 0.1479 | 0.3228 |
| `land_evapotranspiration_flux` (mm/day) | 3.9267 | 2.1716 | 3.1883 |
| `overland_runoff_flux` (mm/day) | 2.3873 | 0.1561 | 1.2717 |
| `NDVI` | 0.7008 | 0.5523 | 0.6914 |

---

### Module Responsibilities

**`drought_alert.py`** — Entry point. Parses `--lat`, `--lon`, `--days`, `--project` CLI arguments, calls fetch and classify modules, formats and prints the final report table.

**`fetch_dataset/fetch_data.py`** — All GEE interactions. builds image collections over the bounding box and date range, reduces spatially and temporally, returns per-band mean values.

**`drought_classify/classify_drought.py`** — Pure classification logic. Takes observed band values, compares against `THRESHOLDS`, returns a list of `BandResult` dataclasses and a total drought score.

**`utils/utils.py`** — Shared constants (`THRESHOLDS`, `SMAP_BANDS`, `ALL_BANDS`), dataclasses (`Threshold`, `Thresholds`, `BandResult`), and the Nominatim reverse-geocoder.

**`utils/helper_functions.py`** — Utility functions: unit conversion scale factors, date range generation, MODIS padding calculation.

**`drought_report/generate_report.py`** — Generate pdf report of the drought situation for farmer.

**`drought_report/drought_charts.py`** — Generate gauge chart for the drought alert system.

---

## Requirements

- Python 3.10+
- Google Earth Engine account with a registered cloud project
- Dependencies: `earthengine-api`, `numpy`, `pandas`, `geemap`

---

## Installation

### From source

```bash
git clone https://github.com/your-username/drought-alert.git
cd drought-alert
pip install -e .
```

### Verify install

```bash
drought-alert --help
```

---

## Google Earth Engine Setup

You need a GEE-enabled Google Cloud project. Do this once:

**1. Register for GEE access:**
Go to https://earthengine.google.com and sign up with your Google account.

**2. Create a Cloud project:**
Go to https://console.cloud.google.com, create a project, and enable the Earth Engine API for it.

**3. Authenticate locally:**
```bash
earthengine authenticate --auth_mode=localhost
```
This opens a browser, asks you to log in, and saves credentials to:
- **Windows:** `C:\Users\<you>\.config\earthengine\credentials`

---

## Usage

```bash
drought-alert --lat <latitude> --lon <longitude> --days <N> --project <gee-project-id>
```

### Arguments

| Argument | Required | Default | Description |
|---|---|---|---|
| `--lat` | Yes | — | Latitude of the target coordinate |
| `--lon` | Yes | — | Longitude of the target coordinate |
| `--days` | No | 7 | Number of past days to analyse |
| `--project` | Yes | — | Google Earth Engine cloud project ID |

### Examples

```bash
# Dhaka, Bangladesh — last 7 days
drought-alert --lat 23.8 --lon 90.4 --days 7 --project my-gee-project

```

---

## Sample Output

```
District : Dhaka
Bbox     : (23.51, 90.16, 24.09, 90.64)
Period   : 2024-12-01 → 2024-12-08
Area     : 400.1 km²

BAND                          OBS       GOOD     DRT      ALERT     STATUS
─────────────────────────────────────────────────────────────────────────────
sm_surface                    0.2941    0.3576    0.1479    0.3228    ⚠ BELOW  (91.1%)
land_evapotranspiration_flux  3.4201    3.9267    2.1716    3.1883    ✓ OK     (107.3%)
overland_runoff_flux          0.8832    2.3873    0.1561    1.2717    ⚠ BELOW  (69.4%)
NDVI                          0.6201    0.7008    0.5523    0.6914    ⚠ BELOW  (89.7%)

Drought Score : 3 / 4
Severity      : MODERATE
```

**Column definitions:**

- **OBS** — Observed spatiotemporal mean for the period
- **GOOD** — Historical mean under non-drought conditions
- **DRT** — Historical mean under drought conditions
- **ALERT** — Threshold below which the band is flagged
- **STATUS** — Whether the observation is above/below threshold, and percentage of threshold

---

## Docker

### Prerequisites
- Docker Desktop installed and running
- GEE credentials saved locally (run `ee.Authenticate()` once before containerising)

### Build

```bash
docker compose build
```

### Run

```bash
docker compose run --rm drought-alert --lat 23.8 --lon 90.4 --days 7 --project my-gee-project
```

## Thresholds Reference

Thresholds are defined in `utils/utils.py` as a `Thresholds` dataclass. Each band has three values:

- `good_mean` — average observed value during healthy (non-drought) conditions
- `drought_mean` — average observed value during confirmed drought periods
- `alert_thresh` — midpoint threshold; observations below this flag the band

To recalibrate for a different region, update the `THRESHOLDS` constant in `utils/utils.py`.

```python
THRESHOLDS = Thresholds(
    sm_surface                   = Threshold(0.3576, 0.1479, 0.3228),
    land_evapotranspiration_flux = Threshold(3.9267, 2.1716, 3.1883),
    overland_runoff_flux         = Threshold(2.3873, 0.1561, 1.2717),
    NDVI                         = Threshold(0.7008, 0.5523, 0.6914),
)
```

---
