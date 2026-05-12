# Tests

Integration and unit tests for the pipeline.

## Test Files

| Script | Type | Network Required | Description |
|--------|------|:---:|-------------|
| `test_static_bundled.py` | Unit | ✗ | Validates bundled CSV data (64 districts, schema integrity) |
| `test_scrapers.py` | Integration | ✓ | Tests BMD and BAMIS web scrapers with error tolerance |
| `test_mvp_extraction.py` | Integration | ✓ | Full 11-source pipeline extraction test |
| `test_bmd_scraping.py` | Diagnostic | ✓ | Detailed BMD endpoint availability analysis |

## Running Tests

From the project root (one level above `production_pipeline/`):

```bash
# Offline tests only (no internet required)
python -m production_pipeline.tests.test_static_bundled

# Web scraper tests
python -m production_pipeline.tests.test_scrapers

# Full integration test (requires GEE authentication)
python -m production_pipeline.tests.test_mvp_extraction
```
