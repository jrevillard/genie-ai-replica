"""
GEE authentication helper — service account JSON only.

Place the key file at /app/secrets/credentials.json (or service-account.json).
Mount it read-only in docker-compose:
    volumes:
      - ./secrets:/app/secrets:ro
"""
import json
import logging
import os
from pathlib import Path

log = logging.getLogger(__name__)

_SA_CANDIDATES = (
    "/app/secrets/credentials.json",
    "/app/secrets/service-account.json",
)


def find_service_account_json() -> str | None:
    """Return the path to the service account JSON file, or None if not found."""
    return next((p for p in _SA_CANDIDATES if os.path.exists(p)), None)


def is_gee_configured() -> bool:
    return find_service_account_json() is not None


def initialize_gee(project: str | None = None) -> str:
    """
    Authenticate Earth Engine using the service account JSON and call ee.Initialize().
    Returns the resolved GEE project ID.
    Raises FileNotFoundError if no credentials file is found.
    """
    import ee

    sa_path = find_service_account_json()
    if not sa_path:
        raise FileNotFoundError(
            "GEE service account JSON not found. "
            "Mount it at /app/secrets/credentials.json in docker-compose."
        )

    with open(sa_path) as f:
        data = json.load(f)

    client_email = data.get("client_email")
    if not client_email:
        raise RuntimeError(f"Missing client_email in {sa_path}")

    resolved_project = (project or os.getenv("GEE_PROJECT", "mewa-493916") or data.get("project_id", "")).strip()
    credentials = ee.ServiceAccountCredentials(client_email, sa_path)
    ee.Initialize(credentials=credentials, project=resolved_project or None)
    log.info("GEE initialized via service account %s (project=%s)", client_email, resolved_project or "<default>")
    return resolved_project
