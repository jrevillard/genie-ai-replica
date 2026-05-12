# Processors

Data processing modules that transform raw extracted data into derived
climate and agricultural indicators.

## Modules

| Module | Purpose | Key Functions |
|--------|---------|---------------|
| `spi_spei_calculator.py` | Drought index computation | `compute_spi()`, `compute_spei()`, `classify_drought()` |
| `anomaly_calculator.py` | Anomaly detection | `compute_anomaly()` — absolute, percent, and z-score anomalies |
| `derived_indicators.py` | Vegetation / heat indices | `add_vci()`, `add_tci()`, `add_vhi()`, `compute_all()` |
| `data_merger.py` | Data fusion | `merge_static_dynamic()` — joins indicators with district context |

## Drought Classification (WMO Standard)

| SPI / SPEI Value | Category |
|------------------|----------|
| ≥ 2.0 | Extremely Wet |
| 1.5 to 1.99 | Very Wet |
| 1.0 to 1.49 | Moderately Wet |
| −0.99 to 0.99 | Near Normal |
| −1.0 to −1.49 | Moderately Dry |
| −1.5 to −1.99 | Severely Dry |
| ≤ −2.0 | Extremely Dry |
