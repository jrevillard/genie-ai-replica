#!/usr/bin/env bash
# Entry point for the e2e provisioning-block harness (#1337).
# Dependency errors surface once, from harness.py's own `import yaml` —
# this wrapper stays a stable CI/local entry, not a second dependency check.
set -euo pipefail
cd "$(dirname "$0")"
exec python3 harness.py
