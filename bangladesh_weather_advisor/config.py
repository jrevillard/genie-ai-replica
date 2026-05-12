"""Central configuration for the production data pipeline.

This module is designed to work in both:
1) Google Colab (quick experiments)
2) Production VM/CI runs (environment-variable driven)

Example:
    from production_pipeline.config import CURRENT_DATE, DATA_SOURCES
"""

from __future__ import annotations

import os
from datetime import datetime, timezone

# Detect if running in Colab
IN_COLAB = "COLAB_GPU" in os.environ

# Current date/time (not hardcoded to older years)
CURRENT_DATE = datetime.now()
CURRENT_UTC = datetime.now(timezone.utc)


# ============================================
# GOOGLE EARTH ENGINE CONFIGURATION
# ============================================
def get_gee_project() -> str | None:
    """Get GEE project with smart defaults.

    Priority:
    1. Environment variable GEE_PROJECT
    2. User-configured project
    3. None (caller can trigger explicit setup/auth flow)
    """
    project = os.getenv("GEE_PROJECT", None)

    if project and project != "ee-your-project":
        return project

    # In Colab, user should set project explicitly
    if IN_COLAB:
        return None

    return None


GEE_PROJECT = get_gee_project()
GEE_SERVICE_ACCOUNT = os.getenv("GEE_SERVICE_ACCOUNT", None)
GEE_CREDENTIALS_PATH = os.getenv("GEE_CREDENTIALS_PATH", "")

# BMD/BAMIS/BWDB (web scraping first; API hooks ready)
BMD_BASE_URL = "https://live6.bmd.gov.bd/"
BAMIS_BASE_URL = "https://www.bamis.gov.bd/"
BWDB_BASE_URL = "https://www.ffwc.gov.bd/"
BMD_API_KEY = os.getenv("BMD_API_KEY", None)  # Ready for when you get access

# Storage
BIGQUERY_PROJECT = os.getenv("BQ_PROJECT", "genie-ai-bd")
BIGQUERY_DATASET = os.getenv("BQ_DATASET", "indicators")
ARANGO_HOST = os.getenv("ARANGO_HOST", "localhost")
ARANGO_PORT = os.getenv("ARANGO_PORT", "8529")
ARANGO_DB = os.getenv("ARANGO_DB", "genie_bangladesh")
ARANGO_USERNAME = os.getenv("ARANGO_USERNAME", "root")
ARANGO_PASSWORD = os.getenv("ARANGO_PASSWORD", "changeme")

# Runtime controls
REQUEST_TIMEOUT_SEC = int(os.getenv("REQUEST_TIMEOUT_SEC", "30"))
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "3"))
RETRY_BACKOFF_SEC = float(os.getenv("RETRY_BACKOFF_SEC", "1.5"))
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

# Data sources - NO DUPLICATES
DATA_SOURCES = {
    "spi_drought": "bmd_scraping",  # Will switch to 'bmd_api' when available
    "rainfall": "gee_chirps",
    "soil_moisture": "gee_smap",
    "temperature": "gee_era5",
    "vegetation": "gee_modis_ndvi",
    "crop_calendars": "bamis_scraping",
    "bulletins": "bamis_pdf_extraction",
    "boundaries": "hdx_static",
    "crop_distribution": "mapspam_static",
    "soil_properties": "soilgrids_static",
    "river_levels": "bwdb_scraping",
}

# Canonical metadata fields to append in extractors/processors
PIPELINE_META_COLUMNS = ["source", "extraction_date", "ingested_at_utc"]
