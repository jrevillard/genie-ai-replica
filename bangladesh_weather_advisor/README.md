# 🌾 Bangladesh Weather Advisor — STATUS: NOT READY FOR DEPLOYMENT! FULL PROTOTYPE REQUIRES MORE TIME POST-DEADLINE

> **GENIE.AI GenAI-for-Good Challenge 2026**
> *Team Climate-CHP • American University of Beirut (AUB)*

An end-to-end data pipeline that aggregates **11 heterogeneous climate,
agricultural, and meteorological sources** into structured knowledge documents
for Retrieval-Augmented Generation (RAG) on the [GENIE.AI](https://genie.ai)
platform — delivering actionable weather advisories to Bangladeshi farmers.

---

## Project Overview

Bangladesh is one of the world's most climate-vulnerable nations. Smallholder
farmers face droughts, floods, and erratic monsoons with limited access to
timely, localised information. This pipeline powers an AI weather advisor that:

1. **Extracts** real-time and historical data from 11 authoritative sources
2. **Processes** drought indices (SPI/SPEI), anomalies, and vegetation stress
3. **Generates** 1,983 structured Markdown knowledge documents covering all 64
   districts
4. **Ingests** documents into GENIE.AI for natural-language advisory generation

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       DATA EXTRACTION                           │
│                                                                 │
│  Google Earth Engine     Gov. Portals      Static Datasets      │
│  ├─ CHIRPS rainfall      ├─ BMD SPI        ├─ HDX boundaries    │
│  ├─ SMAP soil moisture   ├─ BMD rainfall   ├─ MAPSPAM crops     │
│  ├─ ERA5 temperature     ├─ BMD agromet    └─ SoilGrids soils   │
│  ├─ MODIS NDVI           └─ BAMIS crop                          │
│  └─ Climatology baselines   calendars      NOAA                 │
│                                             └─ ENSO indices     │
├─────────────────────────────────────────────────────────────────┤
│                       PROCESSING                                │
│  ├─ SPI / SPEI drought index computation                        │
│  ├─ Rainfall, temperature & NDVI anomaly detection              │
│  ├─ VCI / TCI / VHI vegetation condition indices                │
│  └─ Multi-source data fusion (static + dynamic)                 │
├─────────────────────────────────────────────────────────────────┤
│                       OUTPUT & STORAGE                          │
│  ├─ Markdown knowledge documents (448 GENIE-ready docs)         │
│  ├─ JSONL metadata & ArangoDB document records                  │
│  ├─ BigQuery indicator tables (optional)                        │
│  └─ ArangoDB advisory store (optional)                          │
├─────────────────────────────────────────────────────────────────┤
│                       GENIE.AI RAG PLATFORM                     │
│  └─ Natural-language weather advisories for 64 districts        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Sources (11 Sources → 1,983 Documents)

| # | Source | Type | Coverage | Module |
|---|--------|------|----------|--------|
| 1 | **CHIRPS** — Daily Rainfall | GEE Satellite | 64 districts, daily | `extractors/gee_extractor.py` |
| 2 | **SMAP** — Soil Moisture | GEE Satellite | 64 districts, daily | `extractors/gee_extractor.py` |
| 3 | **ERA5-Land** — Temperature & Evaporation | GEE Reanalysis | 64 districts, daily | `extractors/gee_extractor.py` |
| 4 | **MODIS Terra** — NDVI Vegetation Index | GEE Satellite | 64 districts, 16-day | `extractors/gee_extractor.py` |
| 5 | **BMD** — SPI Drought Index | Web Scraping | National | `extractors/bmd_extractor.py` |
| 6 | **BMD** — 7-Day Rainfall & Agromet | Web Scraping + PDF | National | `extractors/bmd_extractor.py` |
| 7 | **BAMIS** — Crop Calendars & Bulletins | Web Scraping + PDF | National | `extractors/bamis_extractor.py` |
| 8 | **NOAA** — ENSO Indices (ONI, SOI, MEI) | Web Scraping | Global | `extractors/climate_drivers.py` |
| 9 | **HDX** — Admin Boundaries | Bundled CSV | 64 districts | `extractors/static_extractor.py` |
| 10 | **MAPSPAM** — Crop Distribution | Bundled CSV | 64 districts | `extractors/static_extractor.py` |
| 11 | **SoilGrids** — Soil Properties | Bundled CSV | 64 districts | `extractors/static_extractor.py` |

### Generated Document Categories

| Category | Documents | Description |
|----------|-----------|-------------|
| Daily Rainfall | 64 | CHIRPS daily rainfall per district (latest month) |
| Rainfall Climatology | 64 | 30-year monthly normals per district |
| Temperature & Evaporation | 64 | ERA5 daily data per district (latest month) |
| Temperature Climatology | 64 | 30-year monthly normals per district |
| Crop Distribution | 64 | MAPSPAM crop areas per district |
| Administrative Boundaries | 64 | HDX boundary metadata per district |
| Soil Properties | 64 | SoilGrids soil characteristics per district |
| **Total** | **448** | GENIE-ready Markdown documents |

*Additional 1,535 documents generated via `simple_csv_to_markdown.py` from
supplementary CSV datasets, totalling **1,983 documents**.*

---

## Repository Structure

```
production_pipeline/
├── README.md                         # This file
├── USAGE_GUIDE.md                    # Step-by-step usage instructions
├── requirements.txt                  # Python dependencies
├── config.py                         # Central configuration (env-variable driven)
│
├── extractors/                       # Data extraction modules
│   ├── gee_extractor.py              #   GEE: CHIRPS, SMAP, ERA5, MODIS
│   ├── bmd_extractor.py              #   BMD: SPI, rainfall, agromet
│   ├── bamis_extractor.py            #   BAMIS: crop calendars, bulletins
│   ├── static_extractor.py           #   Bundled: HDX, MAPSPAM, SoilGrids
│   ├── climate_drivers.py            #   NOAA ENSO indices
│   └── historical_extractor.py       #   Multi-decade baselines
│
├── processors/                       # Data processing modules
│   ├── spi_spei_calculator.py        #   SPI/SPEI drought indices
│   ├── anomaly_calculator.py         #   Anomaly detection
│   ├── derived_indicators.py         #   VCI, TCI, VHI indices
│   └── data_merger.py                #   Static–dynamic fusion
│
├── storage/                          # Storage & validation
│   ├── schema_validator.py           #   DataFrame schema validation
│   ├── bigquery_loader.py            #   BigQuery ingestion
│   └── arango_loader.py              #   ArangoDB document store
│
├── genie_data_converter.py           # CSV → Markdown/JSONL converter for GENIE.AI
├── simple_csv_to_markdown.py         # Lightweight CSV → Markdown utility
├── download_historical_baseline.py   # Historical CHIRPS/ERA5 downloader
├── install_static_data.py            # Static data installer/validator
├── setup_colab.py                    # Google Colab GEE setup helper
│
├── data/                             # Data directory
│   ├── static/                       #   Bundled reference CSVs
│   │   ├── hdx_boundaries.csv
│   │   ├── mapspam_crops.csv
│   │   ├── soilgrids_properties.csv
│   │   └── district_mapping.csv
│   └── historical/                   #   Historical baselines (downloaded)
│
├── genie_outputs/                    # Generated GENIE.AI documents
│   ├── markdown_docs/                #   448 structured Markdown files
│   └── metadata/                     #   JSONL metadata & Arango records
│
├── bigquery_schema.sql               # BigQuery table definitions
├── arango_schema.json                # ArangoDB collection schemas
│
├── notebooks/                        # Jupyter/Colab notebooks
│   ├── COLAB_STEP_BY_STEP_TEST.ipynb #   End-to-end pipeline walkthrough
│   ├── MVP_11_Sources_Test.ipynb     #   11-source extraction demo
│   ├── GENIE_INGESTION_COLAB.ipynb   #   Data conversion for GENIE.AI
│   └── Download_Historical_*.ipynb   #   Historical data download helpers
│
├── tests/                            # Test suite
│   ├── test_scrapers.py              #   Web scraper validation
│   ├── test_static_bundled.py        #   Static data integrity
│   ├── test_mvp_extraction.py        #   Full pipeline integration
│   └── test_bmd_scraping.py          #   BMD endpoint diagnostics
│
└── docs/                             # Development documentation
    ├── TESTING_GUIDE.md
    ├── STEP_8_SPI_SPEI_COMPUTATION.md
    └── ...
```

---

## Installation & Setup

### Prerequisites

- Python 3.9+
- Google Earth Engine account (for satellite data extraction)
- Internet access (for web scraping and GEE API calls)

### Quick Start

```bash
# 1. Clone the repository
git clone https://opensource.unicc.org/un/itu/genie-ai.git
cd genie-ai
git checkout Climate-CHP-Team-branch

# 2. Install dependencies
pip install -r production_pipeline/requirements.txt

# 3. (Optional) Install bundled static data from uploaded CSVs
python -m production_pipeline.install_static_data --source /path/to/csv/files

# 4. Set environment variables (optional — defaults are provided)
export GEE_PROJECT="your-gee-project-id"
export LOG_LEVEL="INFO"
```

### Google Colab Setup

For interactive use in Google Colab, use the provided setup helper:

```python
from production_pipeline.setup_colab import setup_gee_for_colab
setup_gee_for_colab("your-gee-project-id")
```

See `notebooks/COLAB_STEP_BY_STEP_TEST.ipynb` for a complete walkthrough.

---

## Usage

### Generate GENIE.AI Knowledge Documents

```bash
# Convert CSV data into Markdown documents for GENIE.AI ingestion
python -m production_pipeline.genie_data_converter \
    --input-dir ./data/csv_inputs \
    --output-dir ./genie_outputs
```

### Run Extraction Pipeline (Python API)

```python
from production_pipeline.extractors.gee_extractor import extract_chirps_daily
from production_pipeline.extractors.bmd_extractor import scrape_bmd_spi_table
from production_pipeline.extractors.static_extractor import load_hdx_boundaries
from production_pipeline.processors.spi_spei_calculator import compute_spi

# Load district boundaries
districts = load_hdx_boundaries()

# Extract satellite rainfall data
rainfall = extract_chirps_daily(districts, start_date="2026-04-01", end_date="2026-04-30")

# Compute drought indices
spi = compute_spi(rainfall, windows=[1, 3, 6])

# Scrape government meteorological data
bmd_spi = scrape_bmd_spi_table()
```

### Run Tests

```bash
# Static data integrity tests (no network required)
python -m production_pipeline.tests.test_static_bundled

# Web scraper tests (requires internet)
python -m production_pipeline.tests.test_scrapers

# Full pipeline integration test (requires GEE + internet)
python -m production_pipeline.tests.test_mvp_extraction
```

---

## Configuration

All configuration is environment-variable driven via `config.py`:

| Variable | Default | Description |
|----------|---------|-------------|
| `GEE_PROJECT` | `None` | Google Earth Engine project ID |
| `GEE_SERVICE_ACCOUNT` | `None` | GEE service account email |
| `BMD_API_KEY` | `None` | BMD API key (when available) |
| `BQ_PROJECT` | `genie-ai-bd` | BigQuery project ID |
| `BQ_DATASET` | `indicators` | BigQuery dataset name |
| `ARANGO_HOST` | `localhost` | ArangoDB host |
| `ARANGO_DB` | `genie_bangladesh` | ArangoDB database name |
| `REQUEST_TIMEOUT_SEC` | `30` | HTTP request timeout |
| `MAX_RETRIES` | `3` | Maximum retry attempts |
| `LOG_LEVEL` | `INFO` | Logging level |

---

## Data Processing Pipeline

```
Raw Data → Extraction → Processing → Document Generation → GENIE.AI Ingestion
```

1. **Extraction** — Modules in `extractors/` pull data from GEE, government
   portals, and bundled CSVs into standardised Pandas DataFrames.
2. **Processing** — Modules in `processors/` compute drought indices (SPI/SPEI),
   detect anomalies, and derive vegetation/heat indicators.
3. **Validation** — `storage/schema_validator.py` ensures DataFrame schemas
   match expected structures before persistence.
4. **Document Generation** — `genie_data_converter.py` transforms processed
   DataFrames into per-district Markdown knowledge documents with metadata.
5. **Storage** — Optional BigQuery and ArangoDB loaders for structured persistence.

---

## Output Formats

### Markdown Knowledge Documents
Each document covers one district for one data category (e.g., daily rainfall
for Dhaka district). Documents follow a consistent structure with frontmatter
metadata for RAG retrieval:

```markdown
# Daily Rainfall — Dhaka District
**district_id:** BD1004
**date_range:** 2026-03-01 to 2026-03-31
**total_rainfall_mm:** 42.3
...
```

### JSONL Metadata
Companion metadata files enable programmatic document management:
```json
{"doc_id": "rainfall_bd1004_2026-03", "category": "daily-rainfall", "district": "Dhaka", ...}
```

---

## License

This project is developed for the ITU GENIE.AI GenAI-for-Good Challenge.
See the competition terms for usage conditions.

---

## Team

**Climate-CHP Team** — American University of Beirut (AUB)

Built with ❤️ for Bangladesh's farming communities.
