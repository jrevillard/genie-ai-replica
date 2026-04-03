#!/bin/bash
# =============================================================================
# GENIE.AI Benchmark Suite — Orchestrator
# =============================================================================
#
# Runs all (or selected) benchmarks against the live GENIE.AI stack.
# Results are saved as pipe-delimited CSV files in the tests/ directory.
#
# Usage:
#   ./run_benchmarks.sh                      # Run all benchmarks (interactive)
#   ./run_benchmarks.sh all                  # Run all benchmarks
#   ./run_benchmarks.sh ingestion            # Ingestion pipeline only
#   ./run_benchmarks.sh query                # Query latency only
#   ./run_benchmarks.sh accuracy             # RAG accuracy only
#   ./run_benchmarks.sh performance          # Load test only
#   ./run_benchmarks.sh --smoke              # Quick smoke test of all
#   ./run_benchmarks.sh --test-id 1A --model-desc "Qwen 2.5 7B"
#
# Environment variables (set before running or export):
#   BENCHMARK_PDF          Path to test PDF for ingestion (required for ingestion)
#   BENCHMARK_LABELS       Comma-separated labels (e.g., "Wildlife,Conservation")
#   BENCHMARK_TEST_ID      Test ID from the test plan (e.g., 1A, 2B, 3A)
#   BENCHMARK_MODEL_DESC   Human-readable model description
#   BENCHMARK_REFERENCES   Path to JSON file with reference answers for accuracy
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default arguments
SMOKE_MODE=false
TEST_ID="${BENCHMARK_TEST_ID:-}"
MODEL_DESC="${BENCHMARK_MODEL_DESC:-}"
PDF_PATH="${BENCHMARK_PDF:-}"
LABELS="${BENCHMARK_LABELS:-}"
REFERENCES="${BENCHMARK_REFERENCES:-}"
PERF_CONCURRENT=4
PERF_DURATION=60

# Parse arguments
BENCHMARKS_TO_RUN=()
while [[ $# -gt 0 ]]; do
    case $1 in
        all|ingestion|query|accuracy|performance)
            BENCHMARKS_TO_RUN+=("$1")
            shift
            ;;
        --smoke)
            SMOKE_MODE=true
            shift
            ;;
        --test-id)
            TEST_ID="$2"
            shift 2
            ;;
        --model-desc)
            MODEL_DESC="$2"
            shift 2
            ;;
        --pdf)
            PDF_PATH="$2"
            shift 2
            ;;
        --labels)
            LABELS="$2"
            shift 2
            ;;
        --references)
            REFERENCES="$2"
            shift 2
            ;;
        --concurrent)
            PERF_CONCURRENT="$2"
            shift 2
            ;;
        --duration)
            PERF_DURATION="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [all|ingestion|query|accuracy|performance] [options]"
            echo ""
            echo "Options:"
            echo "  --smoke              Quick smoke test (1 iteration)"
            echo "  --test-id ID         Test ID (e.g., 1A, 2B, 3A)"
            echo "  --model-desc DESC    Model description string"
            echo "  --pdf PATH           Path to test PDF (required for ingestion)"
            echo "  --labels LABELS      Comma-separated labels for ingestion"
            echo "  --references PATH    JSON file with reference answers"
            echo "  --concurrent N       Concurrent users for load test (default: 4)"
            echo "  --duration N         Duration in seconds for load test (default: 60)"
            echo ""
            echo "Environment variables:"
            echo "  BENCHMARK_PDF        Test PDF path"
            echo "  BENCHMARK_LABELS     Labels for ingestion"
            echo "  BENCHMARK_TEST_ID    Test ID"
            echo "  BENCHMARK_MODEL_DESC Model description"
            echo "  BENCHMARK_REFERENCES Reference answers JSON"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown argument: $1${NC}"
            echo "Run with --help for usage information."
            exit 1
            ;;
    esac
done

# If no benchmarks specified, run all
if [[ ${#BENCHMARKS_TO_RUN[@]} -eq 0 ]]; then
    BENCHMARKS_TO_RUN=("all")
fi

# =============================================================================
# Helper Functions
# =============================================================================

print_header() {
    echo ""
    echo -e "${BLUE}============================================================${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}============================================================${NC}"
}

print_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_prerequisites() {
    print_header "Prerequisites Check"

    # Check Python 3
    if command -v python3 &>/dev/null; then
        print_success "Python 3 found: $(python3 --version)"
    else
        print_error "Python 3 not found. Install it first."
        exit 1
    fi

    # Check required Python packages
    for pkg in requests pandas; do
        if python3 -c "import $pkg" 2>/dev/null; then
            print_success "$pkg installed"
        else
            print_error "$pkg not installed. Run: pip install $pkg"
            exit 1
        fi
    done

    # Check Docker
    if command -v docker &>/dev/null; then
        print_success "Docker found: $(docker --version | head -1)"
    else
        print_warning "Docker not found. Ingestion log monitoring will be unavailable."
    fi

    # Check nvidia-smi (optional)
    if command -v nvidia-smi &>/dev/null; then
        print_success "nvidia-smi found: $(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)"
    else
        print_warning "nvidia-smi not found. GPU metrics will not be collected."
    fi

    # Check services
    echo ""
    echo "Checking GENIE.AI services..."

    for svc in "localhost:8888:ChatQnA" "localhost:8529:ArangoDB"; do
        host_port="${svc%%:*}"
        name="${svc##*:}"
        if timeout 3 bash -c "echo > /dev/tcp/$host_port/${svc#*:}" 2>/dev/null; then
            print_success "$name reachable at $host_port"
        else
            print_warning "$name NOT reachable at $host_port (may not be started yet)"
        fi
    done
}

build_args() {
    local args=""
    if [[ -n "$TEST_ID" ]]; then
        args="$args --test-id $TEST_ID"
    fi
    if [[ -n "$MODEL_DESC" ]]; then
        args="$args --model-desc \"$MODEL_DESC\""
    fi
    if [[ "$SMOKE_MODE" == true ]]; then
        args="$args --smoke"
    fi
    echo "$args"
}

# =============================================================================
# Benchmark Runners
# =============================================================================

run_ingestion() {
    print_header "1/4 — Ingestion Pipeline Benchmark"

    if [[ -z "$PDF_PATH" ]]; then
        print_error "No test PDF specified. Use --pdf or set BENCHMARK_PDF."
        print_error "Skipping ingestion benchmark."
        return 1
    fi

    if [[ ! -f "$PDF_PATH" ]]; then
        print_error "PDF file not found: $PDF_PATH"
        return 1
    fi

    if [[ -z "$LABELS" ]]; then
        print_error "No labels specified. Use --labels or set BENCHMARK_LABELS."
        print_error "Skipping ingestion benchmark."
        return 1
    fi

    local args=$(build_args)
    local iterations="1"
    if [[ "$SMOKE_MODE" == true ]]; then
        args="$args --timeout 120"
    else
        args="$args --timeout 600"
    fi

    echo "Running: python3 benchmark_ingestion.py --pdf \"$PDF_PATH\" --labels \"$LABELS\" $args --retract-after"
    echo ""

    eval python3 benchmark_ingestion.py --pdf "$PDF_PATH" --labels "$LABELS" $args --retract-after
}

run_query() {
    print_header "2/4 — Query (Inference) Benchmark"

    local args=$(build_args)
    if [[ "$SMOKE_MODE" != true ]]; then
        args="$args --iterations 3"
    fi

    echo "Running: python3 benchmark_query.py $args"
    echo ""

    eval python3 benchmark_query.py $args
}

run_accuracy() {
    print_header "3/4 — RAG Accuracy Benchmark"

    local args=$(build_args)
    if [[ -n "$REFERENCES" ]]; then
        args="$args --references $REFERENCES"
    fi

    echo "Running: python3 benchmark_rag_accuracy.py $args"
    echo ""

    eval python3 benchmark_rag_accuracy.py $args
}

run_performance() {
    print_header "4/4 — RAG Performance (Load Test) Benchmark"

    local args=$(build_args)
    if [[ "$SMOKE_MODE" == true ]]; then
        args="$args --smoke"
    else
        args="$args --concurrent $PERF_CONCURRENT --duration $PERF_DURATION"
    fi

    echo "Running: python3 benchmark_rag_performance.py $args"
    echo ""

    eval python3 benchmark_rag_performance.py $args
}

# =============================================================================
# Main
# =============================================================================

echo ""
echo "============================================================"
echo "  GENIE.AI Benchmark Suite"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================================"
echo ""

if [[ "$SMOKE_MODE" == true ]]; then
    echo -e "${YELLOW}SMOKE MODE — Quick validation run${NC}"
fi

if [[ -n "$TEST_ID" ]]; then
    echo "  Test ID:    $TEST_ID"
fi
if [[ -n "$MODEL_DESC" ]]; then
    echo "  Model:      $MODEL_DESC"
fi

check_prerequisites

# Determine which benchmarks to run
RUN_INGESTION=false
RUN_QUERY=false
RUN_ACCURACY=false
RUN_PERFORMANCE=false

for bm in "${BENCHMARKS_TO_RUN[@]}"; do
    case $bm in
        all)
            RUN_INGESTION=true
            RUN_QUERY=true
            RUN_ACCURACY=true
            RUN_PERFORMANCE=true
            ;;
        ingestion)
            RUN_INGESTION=true
            ;;
        query)
            RUN_QUERY=true
            ;;
        accuracy)
            RUN_ACCURACY=true
            ;;
        performance)
            RUN_PERFORMANCE=true
            ;;
    esac
done

# Execute benchmarks
ERRORS=0

if [[ "$RUN_INGESTION" == true ]]; then
    run_ingestion || ERRORS=$((ERRORS + 1))
fi

if [[ "$RUN_QUERY" == true ]]; then
    run_query || ERRORS=$((ERRORS + 1))
fi

if [[ "$RUN_ACCURACY" == true ]]; then
    run_accuracy || ERRORS=$((ERRORS + 1))
fi

if [[ "$RUN_PERFORMANCE" == true ]]; then
    run_performance || ERRORS=$((ERRORS + 1))
fi

# Final summary
echo ""
echo "============================================================"
if [[ $ERRORS -eq 0 ]]; then
    echo -e "${GREEN}  All benchmarks completed successfully${NC}"
else
    echo -e "${YELLOW}  Benchmarks completed with $ERRORS error(s)${NC}"
fi
echo "  Results files:"
for f in benchmark_*_results.csv benchmark_*_summary.csv; do
    if [[ -f "$f" ]]; then
        size=$(wc -l < "$f")
        echo "    - $f ($size lines)"
    fi
done
echo "============================================================"
echo ""
