# Usage Guide — Bangladesh Weather Advisor Pipeline

Step-by-step instructions for setting up and running the data pipeline.

---

## 1. Environment Setup

### 1.1 Install Python Dependencies

```bash
pip install -r requirements.txt
```

### 1.2 Configure Google Earth Engine (GEE)

GEE authentication is required for satellite data extraction (CHIRPS, SMAP,
ERA5, MODIS).

**Option A — Interactive authentication (Colab / local)**
```python
import ee
ee.Authenticate()
ee.Initialize(project="your-gee-project-id")
```

**Option B — Service account (production)**
```bash
export GEE_PROJECT="your-gee-project-id"
export GEE_SERVICE_ACCOUNT="your-sa@project.iam.gserviceaccount.com"
export GEE_CREDENTIALS_PATH="/path/to/service-account-key.json"
```

### 1.3 Install Static Data (One-Time)

The pipeline bundles reference data in `data/static/`. If you need to
refresh from updated CSVs:

```bash
python -m production_pipeline.install_static_data --source /path/to/csv/files
```

---

## 2. Running the Pipeline

### 2.1 Option A — Google Colab (Recommended for First Run)

1. Open `notebooks/COLAB_STEP_BY_STEP_TEST.ipynb` in Google Colab
2. Follow the 11-step walkthrough:
   - Step 1: Install dependencies
   - Step 2: Configure GEE
   - Step 3: Load static data (HDX, MAPSPAM, SoilGrids)
   - Step 4: Load historical baselines
   - Step 5: Extract live GEE data (CHIRPS, SMAP, ERA5, MODIS)
   - Step 6: Scrape BMD data (SPI, rainfall)
   - Step 7: Scrape BAMIS data (crop calendars)
   - Step 8: Compute SPI/SPEI drought indices
   - Step 9: Compute anomalies
   - Step 10: Merge and validate
   - Step 11: Generate GENIE.AI documents

### 2.2 Option B — Command Line

```bash
# Extract satellite data (requires GEE)
python -c "
from production_pipeline.extractors.gee_extractor import extract_chirps_daily
from production_pipeline.extractors.static_extractor import load_hdx_boundaries
districts = load_hdx_boundaries()
rain = extract_chirps_daily(districts, start_date='2026-04-01', end_date='2026-04-30')
rain.to_csv('chirps_output.csv', index=False)
"

# Scrape government data (no GEE required)
python -c "
from production_pipeline.extractors.bmd_extractor import scrape_bmd_spi_table
spi = scrape_bmd_spi_table()
print(spi.head())
"

# Generate GENIE.AI documents
python -m production_pipeline.genie_data_converter \
    --input-dir ./data/csv_inputs \
    --output-dir ./genie_outputs
```

---

## 3. Generating Knowledge Documents

### 3.1 Using the GENIE Data Converter

The `genie_data_converter.py` module processes CSV files into structured
Markdown documents organised by category and district:

```bash
python -m production_pipeline.genie_data_converter \
    --input-dir /path/to/csvs \
    --output-dir ./genie_outputs
```

**Input:** CSV files with district-level climate/agriculture data
**Output:**
- `genie_outputs/markdown_docs/` — Structured Markdown files (one per
  district per category)
- `genie_outputs/metadata/documents_metadata.jsonl` — Document metadata
- `genie_outputs/metadata/arango_documents.jsonl` — ArangoDB-ready records

### 3.2 Using the Simple CSV Converter

For quick bulk conversion without category-aware structuring:

```bash
python -m production_pipeline.simple_csv_to_markdown /path/to/csvs /output/dir
```

---

## 4. Running Tests

```bash
# Offline — validate bundled static data
python -m production_pipeline.tests.test_static_bundled

# Online — test web scrapers
python -m production_pipeline.tests.test_scrapers

# Full integration (requires GEE + internet)
python -m production_pipeline.tests.test_mvp_extraction
```

---

## 5. Downloading Historical Baselines

Historical CHIRPS and ERA5 data (1981–2024) are needed for computing
30-year climatological normals. Due to the large data volume, dedicated
download scripts are provided:

```bash
# CLI download (with checkpointing)
python -m production_pipeline.download_historical_baseline

# Or use the Colab notebooks for interactive download:
# notebooks/Download_Historical_Baseline.ipynb
# notebooks/DOWNLOAD_HISTORICAL_GUARANTEED.ipynb
```

Historical data is saved to `data/historical/` with per-year checkpointing
to support resumable downloads.

---

## 6. GENIE.AI Platform Integration

Once documents are generated:

1. **Upload** the `genie_outputs/markdown_docs/` directory to the GENIE.AI
   platform via the data preparation interface
2. **Configure** the knowledge hierarchy to match the document categories
3. **Deploy** the AI advisor agent with the uploaded knowledge base

Refer to the GENIE.AI Installation & Configuration Guide for platform-specific
setup instructions.

---

## 7. Troubleshooting

| Issue | Solution |
|-------|----------|
| GEE authentication fails | Run `ee.Authenticate()` interactively or check service account credentials |
| Empty BMD scraping results | BMD website structure may have changed; check `tests/test_bmd_scraping.py` diagnostics |
| Missing static data | Run `python -m production_pipeline.install_static_data` |
| Import errors | Ensure you're running from the project root (parent of `production_pipeline/`) |
| Historical download timeout | Use `notebooks/DOWNLOAD_HISTORICAL_GUARANTEED.ipynb` for one-district-at-a-time export |
