#!/usr/bin/env bash
# run-melt-test.sh — P0 exit-0 stub for the MELT (Metrics/Events/Logs/Traces)
# correlation + chaos suite.
#
# This script is intentionally a no-op. It exists to unblock the
# `scheduled:melt-correlation` and `scheduled:melt-chaos` CI jobs
# (`.gitlab-ci.yml:2942-2999`) before the real implementation lands.
#
# The full suite is deferred as `DW-325` (see
# `_bmad-output/implementation-artifacts/deferred-work.md`).
#
# Contract (Story 1.5, AC1/AC2/AC3/AC5):
#   - Invoked with no args             -> exit 0
#   - Invoked with --skip-chaos --skip-playwright         -> exit 0
#   - Invoked with --skip-playwright --correlation-only   -> exit 0
#   - Unknown / future flags           -> tolerated (NOT an error)
#   - Emits `reports/melt-correlation-report.xml` and
#     `reports/melt-grafana-report.xml` as valid JUnit XML
#     with SKIPPED test cases (no fabricated PASSes).
#
# No dependencies beyond bash + coreutils (CI image: `node:20-alpine`
# + `apk add bash curl`). Do NOT add `jq`, `python3`, `node`, etc.

set -euo pipefail

# Parse-and-ignore flags. We accept any flag (known or unknown) without
# erroring so future CI invocations don't break this stub. Values may
# be passed as separate args (`--foo bar`) or joined (`--foo=bar`).
SKIP_CHAOS=0
SKIP_PLAYWRIGHT=0
CORRELATION_ONLY=0
EXTRA_FLAGS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --skip-chaos)
      SKIP_CHAOS=1
      shift
      ;;
    --skip-playwright)
      SKIP_PLAYWRIGHT=1
      shift
      ;;
    --correlation-only)
      CORRELATION_ONLY=1
      shift
      ;;
    --*=*)
      # Future flag with inline value (e.g. `--timeout=30`). Tolerated.
      EXTRA_FLAGS+=("$1")
      shift
      ;;
    --*)
      # Future flag, no value. Tolerated. If followed by a non-flag arg,
      # consume it as the flag's value (defensive — none today use this shape).
      EXTRA_FLAGS+=("$1")
      if [ $# -gt 1 ] && [ "${2#--}" = "$2" ]; then
        EXTRA_FLAGS+=("$2")
        shift 2
      else
        shift
      fi
      ;;
    *)
      # Positional argument — tolerated and ignored (this is a stub).
      EXTRA_FLAGS+=("$1")
      shift
      ;;
  esac
done

# Report resolved flag state for CI logs.
echo "[run-melt-test] stub mode — full MELT correlation + chaos suite deferred (DW-325)"
echo "[run-melt-test] flags: skip-chaos=${SKIP_CHAOS} skip-playwright=${SKIP_PLAYWRIGHT} correlation-only=${CORRELATION_ONLY}"
if [ "${#EXTRA_FLAGS[@]}" -gt 0 ]; then
  echo "[run-melt-test] tolerated extra flags: ${EXTRA_FLAGS[*]}"
fi
echo "[run-melt-test] writing JUnit stubs to reports/ (no real assertions)"

# Ensure the repo-root reports/ directory exists. The CI artifact block
# declares paths under `reports/melt-*.xml` (no `tests/...` prefix),
# so the script must run from the repo root (CI does: `cd tests/melt-correlation`
# then invokes `bash run-melt-test.sh`). We resolve the reports path from
# the repo root regardless of where the script lives.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
REPORTS_DIR="${REPO_ROOT}/reports"
mkdir -p "${REPORTS_DIR}"

# Build the timestamp once so both files share an identical suite timestamp.
RUN_TS="$(date -u +"%Y-%m-%dT%H:%M:%S")"
HOSTNAME_VAL="$(hostname)"
TEST_COUNT=2
SKIPPED_COUNT=2
FAILURE_COUNT=0
TOTAL_TIME="0.000"

write_junit_xml() {
  local out_path="$1"
  local suite_name="$2"
  cat > "${out_path}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="${suite_name}" tests="${TEST_COUNT}" skipped="${SKIPPED_COUNT}" failures="${FAILURE_COUNT}" errors="0" time="${TOTAL_TIME}" timestamp="${RUN_TS}" hostname="${HOSTNAME_VAL}">
    <testcase classname="${suite_name}" name="stub: deferred-suite-runs-here" time="0.000">
      <skipped message="P0 exit-0 stub — full MELT correlation + chaos suite deferred as DW-325. See tests/melt-correlation/README.md and _bmad-output/implementation-artifacts/deferred-work.md."/>
    </testcase>
    <testcase classname="${suite_name}" name="stub: real-implementation-required" time="0.000">
      <skipped message="P0 exit-0 stub — replaced by the real correlation/chaos suite when DW-325 is implemented."/>
    </testcase>
  </testsuite>
</testsuites>
EOF
}

write_junit_xml "${REPORTS_DIR}/melt-correlation-report.xml" "melt-correlation"
write_junit_xml "${REPORTS_DIR}/melt-grafana-report.xml"      "melt-grafana"

# Sanity-check the artifacts on disk so a future refactor that breaks
# the writers surfaces immediately (rather than only in CI). This is
# pure POSIX shell — no `python3`, no `xmllint`, no `xmlstarlet`.
for f in "${REPORTS_DIR}/melt-correlation-report.xml" "${REPORTS_DIR}/melt-grafana-report.xml"; do
  if [ ! -s "${f}" ]; then
    echo "[run-melt-test] ERROR: ${f} is missing or empty" >&2
    exit 1
  fi
  if ! head -n 1 "${f}" | grep -q '^<?xml'; then
    echo "[run-melt-test] ERROR: ${f} is not valid XML (no prolog)" >&2
    exit 1
  fi
  if ! grep -q '<testsuites>' "${f}"; then
    echo "[run-melt-test] ERROR: ${f} is not valid JUnit (missing <testsuites>)" >&2
    exit 1
  fi
done

echo "[run-melt-test] OK — exit 0 (stub)"
exit 0
