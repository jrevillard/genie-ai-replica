#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<USAGE
Usage:
  $(basename "$0") [--skip-crawl] [--dry-run]

Environment overrides:
  DATAPREP_URL   default: http://localhost:5000
  BAMIS_PDF_DIR  default: ../mcp_weather/data/agri_data/raw from this script

Examples:
  $(basename "$0")
  DATAPREP_URL=http://localhost:5000 $(basename "$0") --skip-crawl
  $(basename "$0") --skip-crawl --dry-run
USAGE
  exit 0
fi

SKIP_CRAWL=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --skip-crawl) SKIP_CRAWL=1 ;;
    --dry-run) DRY_RUN=1 ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Use --help for usage." >&2
      exit 2
      ;;
  esac
done

if [[ "$SKIP_CRAWL" -eq 0 ]]; then
  echo "==> Crawling BAMIS PDFs"
  (
    cd "$SCRIPT_DIR"
    python3 crawl_bamis.py
  )
fi

echo "==> Uploading PDFs to dataprep"
if [[ "$DRY_RUN" -eq 1 ]]; then
  python3 "$SCRIPT_DIR/upload_bamis_pdfs_to_dataprep.py" --dry-run
else
  python3 "$SCRIPT_DIR/upload_bamis_pdfs_to_dataprep.py"
fi
