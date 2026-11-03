#!/usr/bin/env bash
# Entry point for the e2e provisioning-block harness (#1337).
# Requires python3 + pyyaml (the block is extracted from .gitlab-ci.yml).
set -euo pipefail
cd "$(dirname "$0")"
if ! python3 -c "import yaml" 2>/dev/null; then
  echo "ERROR: pyyaml is required — install it in the active venv (uv pip install pyyaml)" >&2
  exit 2
fi
exec python3 harness.py
