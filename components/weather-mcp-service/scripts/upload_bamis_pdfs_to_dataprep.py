#!/usr/bin/env python3
"""Upload BAMIS crawler PDFs to the Genie dataprep endpoint.

Expected flow:
  1. Run crawl_bamis.py to download PDFs.
  2. Run this script to POST each PDF to /v1/dataprep/ingest_file.

Optional env vars:
  DATAPREP_URL   default: http://localhost:5000
  BAMIS_PDF_DIR  default: ../mcp_weather/data/agri_data/raw from this script
"""

from __future__ import annotations

import base64
import hashlib
import mimetypes
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

SCRIPT_DIR = Path(__file__).resolve().parent
WEATHER_MCP_DIR = SCRIPT_DIR.parent
PDF_DIR = Path(
    os.getenv(
        "BAMIS_PDF_DIR",
        str(WEATHER_MCP_DIR / "mcp_weather" / "data" / "agri_data" / "raw"),
    )
)
DATAPREP_URL = os.getenv("DATAPREP_URL", "http://localhost:5000").rstrip("/")
INGEST_URL = f"{DATAPREP_URL}/v1/dataprep/ingest_file"
DRY_RUN = "--dry-run" in sys.argv
BUSY_SLEEP_SECONDS = 30
MAX_BUSY_RETRIES = 120


def file_id_for(pdf_path: Path) -> str:
    rel = pdf_path.relative_to(PDF_DIR)
    digest = hashlib.sha1(str(rel).encode("utf-8")).hexdigest()[:12]
    stem = "_".join(pdf_path.with_suffix("").parts[-3:])
    stem = "".join(ch if ch.isalnum() or ch in "_-" else "_" for ch in stem)
    return f"bamis_{stem}_{digest}"[:180]


def labels_for(pdf_path: Path) -> list[str]:
    labels = ["bamis", "agriculture", "crop-calendar"]
    rel_parts = pdf_path.relative_to(PDF_DIR).parts

    # crawl_bamis.py writes: raw/<crop>/<region>/<crop>_<region>.pdf
    if len(rel_parts) >= 3:
        labels.extend([rel_parts[-3], rel_parts[-2]])

    seen = set()
    return [label for label in labels if not (label in seen or seen.add(label))]


def payload_for(pdf_path: Path) -> dict:
    return {
        "fileId": file_id_for(pdf_path),
        "fileName": pdf_path.name,
        "fileBase64": base64.b64encode(pdf_path.read_bytes()).decode("ascii"),
        "fileType": mimetypes.guess_type(pdf_path.name)[0] or "application/pdf",
        "uploadDate": datetime.fromtimestamp(pdf_path.stat().st_mtime, timezone.utc).isoformat(),
        "fileLabels": labels_for(pdf_path),
        "storagePath": str(pdf_path.resolve()),
    }


def upload_pdf(session: requests.Session, pdf_path: Path) -> bool:
    payload = payload_for(pdf_path)

    if DRY_RUN:
        print(f"DRY RUN {pdf_path} -> {payload['fileId']}")
        return True

    for attempt in range(1, MAX_BUSY_RETRIES + 1):
        try:
            response = session.post(INGEST_URL, json=payload, timeout=120)
        except requests.RequestException as exc:
            print(f"FAIL {pdf_path}: {exc}")
            return False

        if response.status_code in (200, 201, 202):
            print(f"OK   {pdf_path} -> {payload['fileId']}")
            return True

        if response.status_code == 429:
            print(f"BUSY {pdf_path}: retry {attempt}/{MAX_BUSY_RETRIES} in {BUSY_SLEEP_SECONDS}s")
            time.sleep(BUSY_SLEEP_SECONDS)
            continue

        print(f"FAIL {pdf_path}: HTTP {response.status_code}: {response.text[:300]}")
        return False

    print(f"FAIL {pdf_path}: dataprep stayed busy too long")
    return False


def main() -> int:
    if not PDF_DIR.exists():
        print(f"PDF folder not found: {PDF_DIR}")
        print("Run crawl_bamis.py first, or set BAMIS_PDF_DIR=/path/to/pdfs.")
        return 2

    pdfs = sorted(PDF_DIR.rglob("*.pdf"))
    print(f"PDF folder   : {PDF_DIR}")
    print(f"Dataprep URL : {DATAPREP_URL}")
    print(f"PDF count    : {len(pdfs)}")

    if not pdfs:
        return 0

    session = requests.Session()
    failures = 0
    for pdf_path in pdfs:
        if not upload_pdf(session, pdf_path):
            failures += 1

    print(f"Done. Success: {len(pdfs) - failures}, failed: {failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
