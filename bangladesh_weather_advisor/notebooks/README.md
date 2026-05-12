# Notebooks

Interactive Jupyter/Colab notebooks for pipeline demonstration and data
download workflows.

## Notebooks

| Notebook | Purpose |
|----------|---------|
| `COLAB_STEP_BY_STEP_TEST.ipynb` | End-to-end 11-step pipeline walkthrough (recommended starting point) |
| `MVP_11_Sources_Test.ipynb` | Quick validation of all 11 data source extractors |
| `GENIE_INGESTION_COLAB.ipynb` | Convert pipeline CSV outputs to GENIE.AI knowledge documents |
| `Download_Historical_Baseline.ipynb` | Download 43 years of CHIRPS/ERA5 historical baselines |
| `DOWNLOAD_HISTORICAL_VIA_DRIVE.ipynb` | Alternative: export historical data via Google Drive |
| `DOWNLOAD_HISTORICAL_GUARANTEED.ipynb` | Robust: one-district-at-a-time historical export |

## Google Colab Setup

All notebooks are designed for Google Colab. To run:

1. Upload the `production_pipeline/` directory to Colab or mount from Drive
2. Set your GEE project in the first cell
3. Run cells sequentially

> **Note:** Notebooks use `/content/` paths (Colab default). Adjust paths
> if running locally.
