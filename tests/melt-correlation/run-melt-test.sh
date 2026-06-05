#!/bin/bash
# =============================================================================
# GENIE.AI MELT Correlation Test Suite — Orchestrator
# =============================================================================
#
# Runs all MELT (Metrics, Events/Logs, Traces) correlation tests against the
# live GENIE.AI observability stack.
#
# Prerequisites:
#   - GENIE.AI stack running with observability enabled (ENABLE_OBSERVABILITY=1)
#   - All Victoria* backends, OTel Collector, and Grafana must be reachable
#   - Tests MUST run from inside the Docker network (container-only services)
#
# Usage:
#   ./run-melt-test.sh                      # Run all tests
#   ./run-melt-test.sh --skip-chaos          # Skip chaos resilience tests
#   ./run-melt-test.sh --skip-playwright      # Skip Playwright E2E tests
#   ./run-melt-test.sh --skip-chaos --skip-playwright  # Fast CI run
#   ./run-melt-test.sh --correlation-only    # Only Task 1 correlation test
#
# Environment variables:
#   VICTORIATRACES_URL    VictoriaTraces URL (default: http://victoriatraces:10428)
#   VICTORIAMETRICS_URL   VictoriaMetrics URL (default: http://victoriametrics:8428)
#   VICTORIALOGS_URL      VictoriaLogs URL (default: http://victorialogs:9428)
#   GRAFANA_URL           Grafana URL (default: http://grafana:3000)
#   GRAFANA_ADMIN_USER    Grafana admin username (default: admin)
#   GRAFANA_ADMIN_PASSWORD Grafana admin password (required for Task 2)
#   KONG_URL              Kong internal URL (default: http://kong:8000)
#   PROPAGATION_DELAY     Seconds to wait for propagation (default: 15)
#   TRACE_ID              Known trace ID for Playwright test
#   OUTAGE_REQUESTS       Requests during chaos outage (default: 3)
#   RESTART_TIMEOUT       Backend restart timeout in seconds (default: 60)
#   SKIP_BACKENDS          Comma-separated backends to skip in chaos tests
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
cd "$SCRIPT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Parse arguments
SKIP_CHAOS=false
SKIP_PLAYWRIGHT=false
CORRELATION_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --skip-chaos)       SKIP_CHAOS=true ;;
    --skip-playwright)  SKIP_PLAYWRIGHT=true ;;
    --correlation-only)  CORRELATION_ONLY=true ;;
    -h|--help)
      echo "Usage: $0 [--skip-chaos] [--skip-playwright] [--correlation-only]"
      echo ""
      echo "Options:"
      echo "  --skip-chaos        Skip chaos resilience tests"
      echo "  --skip-playwright   Skip Playwright E2E tests"
      echo "  --correlation-only  Only run Task 1 correlation test"
      echo "  -h, --help           Show this help"
      exit 0 ;;
    *)
      echo -e "${RED}Unknown argument: $arg${NC}"
      exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

print_header() {
  echo ""
  echo -e "${BLUE}══════════════════════════════════════════════════${NC}"
  echo -e "${BLUE}  $1${NC}"
  echo -e "${BLUE}══════════════════════════════════════════════════${NC}"
}

print_success() { echo -e "${GREEN}[OK]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARN]${NC} $1"; }
print_error()   { echo -e "${RED}[ERROR]${NC} $1"; }

# ---------------------------------------------------------------------------
# Prerequisites check
# ---------------------------------------------------------------------------

check_prerequisites() {
  print_header "Prerequisites Check"

  local failed=0

  # Check Node.js
  if command -v node &>/dev/null; then
    print_success "Node.js $(node --version)"
  else
    print_error "Node.js not found"
    exit 2
  fi

  # Check services (container-only — must be inside Docker network)
  local services=(
    "${VICTORIATRACES_URL:-http://victoriatraces:10428}/select/jaeger/api/services:VictoriaTraces"
    "${VICTORIAMETRICS_URL:-http://victoriametrics:8428}/prometheus/api/v1/health:VictoriaMetrics"
    "${VICTORIALOGS_URL:-http://victorialogs:9428}/health:VictoriaLogs"
    "${OTEL_COLLECTOR_URL:-http://otel-collector:13133}:OTel Collector"
  )

  for svc in "${services[@]}"; do
    local url="${svc%%:*}"
    local name="${svc##*:}"
    if timeout 5 curl -sk -o /dev/null "$url" 2>/dev/null; then
      print_success "$name reachable"
    else
      print_error "$name NOT reachable at $url"
      failed=$((failed + 1))
    fi
  done

  # Optional: Grafana
  local grafana_url="${GRAFANA_URL:-http://grafana:3000}"
  if timeout 5 curl -sk -o /dev/null "$grafana_url" 2>/dev/null; then
    print_success "Grafana reachable"
  else
    print_warning "Grafana NOT reachable (Task 2 will fail)"
  fi

  if [[ $failed -gt 0 ]]; then
    print_error "$failed prerequisite(s) failed. Is the observability stack running?"
    exit 2
  fi
}

# ---------------------------------------------------------------------------
# Test runners
# ---------------------------------------------------------------------------

run_correlation_test() {
  print_header "1/4 — MELT Correlation Test (AC#1, AC#2)"
  if node correlation.test.js; then
    print_success "Correlation test passed"
  else
    print_error "Correlation test FAILED"
    return 1
  fi
}

run_grafana_verification() {
  print_header "2/4 — Grafana Datasource Verification (AC#3)"

  if [[ -z "${GRAFANA_ADMIN_PASSWORD:-}" ]]; then
    print_warning "GRAFANA_ADMIN_PASSWORD not set — skipping Grafana tests"
    return 0
  fi

  if node grafana-verify.js; then
    print_success "Grafana verification passed"
  else
    print_error "Grafana verification FAILED"
    return 1
  fi
}

run_chaos_resilience() {
  print_header "3/4 — Chaos Resilience Test (AC#4, AC#5)"
  if node chaos-resilience.test.js; then
    print_success "Chaos resilience test passed"
  else
    print_error "Chaos resilience test FAILED"
    return 1
  fi
}

run_playwright_test() {
  print_header "4/4 — Playwright Log Search (AC#6)"

  if ! command -v npx &>/dev/null; then
    print_warning "npx not found — skipping Playwright test"
    return 0
  fi

  if [[ -z "${TRACE_ID:-}" ]]; then
    print_warning "TRACE_ID not set — skipping Playwright test"
    return 0
  fi

  if npx playwright test "$(dirname "$SCRIPT_DIR")/e2e/observability/log-search-dialog.spec.js"; then
    print_success "Playwright test passed"
  else
    print_error "Playwright test FAILED"
    return 1
  fi
}

run_k6_overhead() {
  print_header "BONUS — k6 OTel Collector Overhead (AC#7)"

  if ! command -v k6 &>/dev/null; then
    print_warning "k6 CLI not found — skipping overhead test"
    return 0
  fi

  local base_url="${BASE_URL:-https://localhost/api/health}"
  local token="${TOKEN:-}"

  if k6 run k6-collector-overhead.js \
    -e "BASE_URL=${base_url}" \
    -e "TOKEN=${token}" \
    --out json=reports/k6-overhead-summary.json; then
    print_success "k6 overhead test passed"
  else
    print_error "k6 overhead test FAILED"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

echo ""
echo "══════════════════════════════════════════════════"
echo "  GENIE.AI MELT Correlation Test Suite"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "══════════════════════════════════════════════════"

check_prerequisites

ERRORS=0

# Task 1: Correlation test (always runs)
if [[ "$CORRELATION_ONLY" == true ]]; then
  print_header "Running correlation test only (--correlation-only)"
  run_correlation_test || ERRORS=$((ERRORS + 1))
else
  run_correlation_test || ERRORS=$((ERRORS + 1))

  # Task 2: Grafana verification
  run_grafana_verification || ERRORS=$((ERRORS + 1))

  # Task 3: Chaos resilience
  if [[ "$SKIP_CHAOS" != true ]]; then
    run_chaos_resilience || ERRORS=$((ERRORS + 1))
  else
    print_warning "Chaos tests skipped (--skip-chaos)"
  fi

  # Task 4: Playwright
  if [[ "$SKIP_PLAYWRIGHT" != true ]]; then
    run_playwright_test || ERRORS=$((ERRORS + 1))
  else
    print_warning "Playwright tests skipped (--skip-playwright)"
  fi

  # Task 5: k6 overhead
  run_k6_overhead || ERRORS=$((ERRORS + 1))
fi

# Summary
echo ""
echo "══════════════════════════════════════════════════"
if [[ $ERRORS -eq 0 ]]; then
  echo -e "${GREEN}  All tests passed${NC}"
else
  echo -e "${YELLOW}  Tests completed with $ERRORS error(s)${NC}"
fi
echo "  Reports:"
for f in ../../reports/melt-*.xml ../../reports/melt-*.png; do
  if [[ -f "$f" ]]; then
    echo "    - $f"
  fi
done
echo "══════════════════════════════════════════════════"
echo ""

exit $ERRORS
