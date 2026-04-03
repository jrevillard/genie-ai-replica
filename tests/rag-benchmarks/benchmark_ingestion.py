# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""
GENIE.AI Benchmark — Ingestion Pipeline

Tests the full document ingestion pipeline:
  1. File upload via the dataprep API
  2. Chunking, labeling, and graph extraction
  3. Log monitoring for errors, warnings, and timing
  4. Post-ingestion validation via the retriever API

Usage:
    python3 benchmark_ingestion.py --pdf path/to/test.pdf --labels "Wildlife,Conservation"
    python3 benchmark_ingestion.py --pdf path/to/test.pdf --labels "Wildlife,Conservation" --retract-after
    python3 benchmark_ingestion.py --pdf path/to/test.pdf --labels "Wildlife,Conservation" --dry-run

Results are saved to benchmark_ingestion_results.csv (pipe-delimited).

Prerequisites:
  - All GENIE.AI services running and healthy (docker compose ps)
  - A test PDF document to ingest
  - The dataprep service must be accessible at DATAPREP_URL (default: localhost:5000)
  - ArangoDB accessible at ARANGO_URL (default: localhost:8529)
"""

import argparse
import base64
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

import requests

# Allow running from the tests directory without package install
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from benchmark_config import (
    ARANGO_URL,
    DATAPREP_CONTAINER,
    DATAPREP_URL,
    DOCUMENT_REPO_URL,
    KILL_INGEST_URL,
    QUESTIONS,
    RETRACT_URL,
    RETRIEVER_URL,
    DEFAULT_RAG_CONFIG,
    clean_text,
    get_active_model_info,
    get_gpu_memory_info,
    get_translation_model_info,
    print_time_stamp,
    save_result,
    wait_for_service,
)

RESULTS_FILE = "benchmark_ingestion_results.csv"


# ============================================================================
# Log Parsing
# ============================================================================

LOG_PATTERNS = {
    "chunking_start": re.compile(r"\[ chunking \]", re.IGNORECASE),
    "chunking_done": re.compile(r"(chunks? created|chunking complete|finished chunking)", re.IGNORECASE),
    "labeling_start": re.compile(r"\[ labeling \]", re.IGNORECASE),
    "label_selected": re.compile(r"(LLM selected label|label assigned|embedding label|BM25 label)", re.IGNORECASE),
    "label_warning": re.compile(r"(non-string labels|Coercing non-string|labeling.*warn|fallback.*label)", re.IGNORECASE),
    "label_error": re.compile(r"(labeling.*error|failed to assign label)", re.IGNORECASE),
    "graph_start": re.compile(r"\[ graph \]|\[ extraction \]", re.IGNORECASE),
    "graph_insert": re.compile(r"(graph documents? inserted|entities? inserted|edges? created)", re.IGNORECASE),
    "graph_error": re.compile(r"(unhashable type|batch.*skipped|extraction error)", re.IGNORECASE),
    "ingest_complete": re.compile(r"(ingestion complete|successfully ingested|status.*Ingested)", re.IGNORECASE),
    "ingest_error": re.compile(r"(ingestion error|ingestion failed|status.*Error)", re.IGNORECASE),
    "embed_start": re.compile(r"\[ embed \]|\[ embedding \]", re.IGNORECASE),
    "embed_done": re.compile(r"(embedding complete|embeddings generated)", re.IGNORECASE),
}


def parse_timestamp_from_log_line(line):
    """Extract a datetime from a log line if possible."""
    # Common formats: "2025-01-15 10:30:45" or "2025-01-15T10:30:45"
    for pattern in [
        r"(\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2})",
        r"(\d{2}:\d{2}:\d{2})",
    ]:
        match = re.search(pattern, line)
        if match:
            return match.group(1)
    return None


class IngestionLogParser:
    """Parses docker compose logs to extract ingestion stage timing and issues."""

    def __init__(self):
        self.events = []
        self.warnings = []
        self.errors = []
        self.label_assignments = []
        self.graph_inserts = []
        self.stage_times = {}

    def parse_line(self, line):
        ts = parse_timestamp_from_log_line(line)
        entry = {"timestamp": ts, "line": line.strip()}

        for stage_name, pattern in LOG_PATTERNS.items():
            if pattern.search(line):
                entry["stage"] = stage_name
                break

        if "warning" in line.lower() or "warn" in line.lower():
            self.warnings.append(entry)
        if "error" in line.lower() or "exception" in line.lower() or "traceback" in line.lower():
            self.errors.append(entry)

        if LOG_PATTERNS["label_selected"].search(line):
            self.label_assignments.append(line.strip())
        if LOG_PATTERNS["graph_insert"].search(line):
            self.graph_inserts.append(line.strip())
        if LOG_PATTERNS["ingest_complete"].search(line):
            self.events.append(("complete", ts, line.strip()))
        if LOG_PATTERNS["ingest_error"].search(line):
            self.events.append(("error", ts, line.strip()))

        return entry

    def summary(self):
        return {
            "total_warnings": len(self.warnings),
            "total_errors": len(self.errors),
            "label_assignments": len(self.label_assignments),
            "graph_inserts": len(self.graph_inserts),
            "warning_lines": [w["line"] for w in self.warnings],
            "error_lines": [e["line"] for e in self.errors],
        }


# ============================================================================
# Core Benchmark Functions
# ============================================================================


def upload_file(pdf_path, file_id, file_labels, description=""):
    """Upload a PDF file via the dataprep ingestion API."""
    print(f"[{print_time_stamp()}] Reading file: {pdf_path}")

    with open(pdf_path, "rb") as f:
        file_bytes = f.read()

    file_b64 = base64.b64encode(file_bytes).decode("utf-8")
    file_name = Path(pdf_path).name
    file_type = Path(pdf_path).suffix.lstrip(".")
    upload_date = datetime.now().isoformat()

    payload = {
        "fileId": file_id,
        "fileName": file_name,
        "fileBase64": file_b64,
        "fileType": file_type,
        "uploadDate": upload_date,
        "fileLabels": file_labels,
    }

    url = f"{DATAPREP_URL}/ingest_file"
    print(f"[{print_time_stamp()}] Posting ingestion request to {url} ({len(file_b64)} bytes base64)...")

    try:
        resp = requests.post(url, json=payload, timeout=30)
        return resp.status_code, resp.json() if resp.text else {}
    except requests.exceptions.RequestException as e:
        return 0, {"error": str(e)}


def retract_file(file_id):
    """Retract (delete) an ingested file from the graph."""
    print(f"[{print_time_stamp()}] Retracting file {file_id}...")
    try:
        resp = requests.post(RETRACT_URL, json={"fileId": file_id}, timeout=30)
        return resp.status_code, resp.json() if resp.text else {}
    except requests.exceptions.RequestException as e:
        return 0, {"error": str(e)}


def monitor_ingestion_docker_logs(timeout_sec=600):
    """
    Stream docker compose logs for the dataprep container and parse them
    until ingestion completes or times out.
    """
    parser = IngestionLogParser()
    since_time = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")

    print(f"[{print_time_stamp()}] Monitoring ingestion logs (timeout: {timeout_sec}s)...")

    try:
        process = subprocess.Popen(
            [
                "docker", "compose", "logs", "-f",
                "--since", since_time,
                DATAPREP_CONTAINER,
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
    except FileNotFoundError:
        print(f"[{print_time_stamp()}] ERROR: 'docker' command not found. Cannot monitor logs.")
        return parser, False, "docker not found"

    start_t = time.time()
    completed = False
    result_msg = "timeout"

    try:
        for line in process.stdout:
            parser.parse_line(line)

            # Check for completion
            for event_type, ts, msg in parser.events:
                if event_type == "complete":
                    completed = True
                    result_msg = "success"
                    break
                elif event_type == "error":
                    completed = True
                    result_msg = "error"
                    break

            if completed:
                break
            if time.time() - start_t > timeout_sec:
                result_msg = "timeout"
                break

    except KeyboardInterrupt:
        result_msg = "interrupted"
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()

    elapsed = time.time() - start_t
    print(f"[{print_time_stamp()}] Log monitoring ended: {result_msg} ({elapsed:.1f}s)")
    return parser, completed, result_msg


def monitor_ingestion_docrepo(file_id, timeout_sec=600):
    """
    Fallback: poll the document repository for file status changes.
    Use this when docker log streaming is not available.
    """
    print(f"[{print_time_stamp()}] Monitoring ingestion via document repository (timeout: {timeout_sec}s)...")

    start_t = time.time()
    last_status = None

    while time.time() - start_t < timeout_sec:
        try:
            resp = requests.get(
                f"{DOCUMENT_REPO_URL}/api/files/{file_id}",
                timeout=5,
            )
            if resp.status_code == 200:
                data = resp.json()
                status = data.get("status", "")
                if status != last_status:
                    print(f"[{print_time_stamp()}] File status: {status}")
                    last_status = status

                if status == "Ingested":
                    return True, "success", time.time() - start_t
                elif "Error" in status:
                    return True, "error", time.time() - start_t
        except requests.exceptions.RequestException:
            pass

        time.sleep(5)

    return False, "timeout", time.time() - start_t


def validate_via_retriever(questions_to_try=3):
    """
    Send test queries to the retriever to verify that ingested data
    is retrievable. Returns the number of successful retrievals.
    """
    print(f"[{print_time_stamp()}] Validating retrieval from ingested data...")
    success_count = 0

    for q in QUESTIONS[:questions_to_try]:
        try:
            payload = {
                "messages": [{"role": "user", "content": q["text"]}],
                "context": {"categoryLabel": "General", "serviceLabels": []},
                "stream": False,
                **DEFAULT_RAG_CONFIG,
            }
            resp = requests.post(
                "http://localhost:8888/v1/chatqna",
                json=payload,
                timeout=60,
            )
            if resp.status_code == 200:
                answer = resp.json().get("response", "")
                if answer and len(answer) > 20:
                    success_count += 1
                    print(f"[{print_time_stamp()}]   Q{q['id']}: OK ({len(answer)} chars)")
                else:
                    print(f"[{print_time_stamp()}]   Q{q['id']}: Empty answer")
            else:
                print(f"[{print_time_stamp()}]   Q{q['id']}: HTTP {resp.status_code}")
        except requests.exceptions.RequestException as e:
            print(f"[{print_time_stamp()}]   Q{q['id']}: {e}")

    return success_count


def check_arango_collection_counts(graph_name="GRAPH_TEST"):
    """
    Query ArangoDB directly for document/entity/edge counts.
    Returns counts dict or None if connection fails.
    """
    try:
        from requests.auth import HTTPBasicAuth

        auth = HTTPBasicAuth("root", "test")
        headers = {"Content-Type": "application/json"}

        counts = {}

        # Try to get chunk document count
        for collection_type, collection_suffix in [
            ("chunks", "chunks"),
            ("entities", "entities"),
            ("edges", "edges"),
        ]:
            try:
                # List collections and find matching ones
                resp = requests.get(
                    f"{ARANGO_URL}/_api/collection",
                    auth=auth,
                    headers=headers,
                    timeout=5,
                )
                if resp.status_code == 200:
                    collections = [c["name"] for c in resp.json().get("result", [])]
                    matching = [c for c in collections if collection_suffix in c.lower()]
                    for col in matching:
                        count_resp = requests.get(
                            f"{ARANGO_URL}/_api/collection/{col}/count",
                            auth=auth,
                            headers=headers,
                            timeout=5,
                        )
                        if count_resp.status_code == 200:
                            counts[col] = count_resp.json().get("count", 0)
            except requests.exceptions.RequestException:
                pass

        return counts if counts else None

    except ImportError:
        return None


# ============================================================================
# Main Benchmark
# ============================================================================


def run_ingestion_benchmark(pdf_path, file_labels, test_id="", model_desc="",
                            retract_after=False, monitor_mode="docker", timeout=600):
    """
    Run the full ingestion benchmark pipeline.

    Returns a dict of metrics for saving to CSV.
    """
    file_id = f"benchmark_{int(time.time())}"
    print(f"\n{'='*70}")
    print(f"GENIE.AI Ingestion Benchmark")
    print(f"{'='*70}")
    print(f"  File:         {pdf_path}")
    print(f"  File ID:      {file_id}")
    print(f"  Labels:       {file_labels}")
    print(f"  Test ID:      {test_id or 'N/A'}")
    print(f"  Model Desc:   {model_desc or 'auto-detected'}")
    print(f"  Monitor:      {monitor_mode}")
    print(f"{'='*70}\n")

    # Detect active models
    main_model = get_active_model_info()
    translation_model = get_translation_model_info()
    print(f"[{print_time_stamp()}] Main model:        {main_model}")
    print(f"[{print_time_stamp()}] Translation model: {translation_model}")

    # Capture pre-ingestion GPU state
    gpu_before = get_gpu_memory_info()
    if gpu_before:
        for i, gpu in enumerate(gpu_before):
            print(f"[{print_time_stamp()}] GPU {i} before: {gpu['used_mb']}/{gpu['total_mb']} MB")

    # Health check
    try:
        wait_for_service(DATAPREP_URL, timeout_sec=60, method="POST")
    except RuntimeError as e:
        print(f"[{print_time_stamp()}] WARNING: Dataprep service not reachable: {e}")
        print(f"[{print_time_stamp()}] Attempting ingestion anyway...")

    # Step 1: Retract existing file if present (clean slate)
    retract_status, retract_data = retract_file(file_id)
    if retract_status == 200:
        print(f"[{print_time_stamp()}] Pre-existing data retracted: {retract_data.get('message', '')}")

    # Step 2: Upload and trigger ingestion
    upload_start = time.time()
    upload_status, upload_data = upload_file(pdf_path, file_id, file_labels, model_desc)
    upload_elapsed = time.time() - upload_start

    if upload_status == 429:
        print(f"[{print_time_stamp()}] REJECTED: System busy (another ingestion in progress).")
        return _build_result(
            file_id, test_id, main_model, translation_model, model_desc,
            file_labels, upload_status, upload_elapsed, 0,
            "rejected_busy", IngestionLogParser(), gpu_before, None
        )

    if upload_status != 200:
        print(f"[{print_time_stamp()}] UPLOAD FAILED: HTTP {upload_status} - {upload_data}")
        return _build_result(
            file_id, test_id, main_model, translation_model, model_desc,
            file_labels, upload_status, upload_elapsed, 0,
            "upload_failed", IngestionLogParser(), gpu_before, None
        )

    print(f"[{print_time_stamp()}] Upload accepted: {upload_data.get('message', '')}")

    # Step 3: Monitor ingestion
    if monitor_mode == "docker":
        parser, completed, result_msg = monitor_ingestion_docker_logs(timeout_sec=timeout)
        ingestion_elapsed = None  # Extracted from logs
    else:
        parser = IngestionLogParser()
        completed, result_msg, ingestion_elapsed = monitor_ingestion_docrepo(file_id, timeout_sec=timeout)

    if not ingestion_elapsed:
        ingestion_elapsed = time.time() - upload_start

    # Step 4: Capture post-ingestion GPU state
    gpu_after = get_gpu_memory_info()
    if gpu_after:
        for i, gpu in enumerate(gpu_after):
            print(f"[{print_time_stamp()}] GPU {i} after: {gpu['used_mb']}/{gpu['total_mb']} MB")

    # Step 5: Validate via retriever
    retrieval_successes = 0
    if completed and result_msg == "success":
        retrieval_successes = validate_via_retriever()

    # Step 6: Check ArangoDB counts (optional)
    arango_counts = check_arango_collection_counts()

    # Step 7: Print summary
    log_summary = parser.summary()
    print(f"\n[{print_time_stamp()}] === Ingestion Summary ===")
    print(f"  Result:              {result_msg}")
    print(f"  Upload time:         {upload_elapsed:.2f}s")
    print(f"  Total ingestion:     {ingestion_elapsed:.2f}s")
    print(f"  Label assignments:   {log_summary['label_assignments']}")
    print(f"  Graph inserts:       {log_summary['graph_inserts']}")
    print(f"  Warnings:            {log_summary['total_warnings']}")
    print(f"  Errors:              {log_summary['total_errors']}")
    print(f"  Retrieval checks:    {retrieval_successes}/{min(3, len(QUESTIONS))}")

    if log_summary["warning_lines"]:
        print(f"\n  Warning details:")
        for w in log_summary["warning_lines"][:5]:
            print(f"    - {w[:200]}")

    if log_summary["error_lines"]:
        print(f"\n  Error details:")
        for e in log_summary["error_lines"][:5]:
            print(f"    - {e[:200]}")

    if arango_counts:
        print(f"\n  ArangoDB collection counts:")
        for col, count in arango_counts.items():
            print(f"    {col}: {count}")

    # Step 8: Retract if requested
    if retract_after and completed:
        retract_status, retract_data = retract_file(file_id)
        if retract_status == 200:
            print(f"[{print_time_stamp()}] Cleanup: {retract_data.get('message', '')}")

    # Build and save result
    result = _build_result(
        file_id, test_id, main_model, translation_model, model_desc,
        file_labels, upload_status, upload_elapsed, ingestion_elapsed,
        result_msg, parser, gpu_before, gpu_after,
        retrieval_successes=retrieval_successes,
        arango_counts=arango_counts,
    )
    save_result(result, RESULTS_FILE)

    print(f"\n[{print_time_stamp()}] Results saved to {RESULTS_FILE}")
    return result


def _build_result(file_id, test_id, main_model, translation_model, model_desc,
                  file_labels, upload_status, upload_elapsed, ingestion_elapsed,
                  result_msg, parser, gpu_before, gpu_after,
                  retrieval_successes=0, arango_counts=None):
    """Build a result dict for CSV output."""
    log_summary = parser.summary()

    gpu_used_before = gpu_before[0]["used_mb"] if gpu_before else 0
    gpu_total = gpu_before[0]["total_mb"] if gpu_before else 0
    gpu_used_after = gpu_after[0]["used_mb"] if gpu_after else 0

    result = {
        "timestamp": print_time_stamp(),
        "test_id": test_id,
        "model_description": model_desc,
        "main_model": main_model,
        "translation_model": translation_model,
        "file_id": file_id,
        "file_labels": ",".join(file_labels) if isinstance(file_labels, list) else file_labels,
        "upload_status": upload_status,
        "upload_time_sec": round(upload_elapsed, 2),
        "total_ingestion_time_sec": round(ingestion_elapsed, 2) if ingestion_elapsed else 0,
        "result": result_msg,
        "label_assignments": log_summary["label_assignments"],
        "graph_inserts": log_summary["graph_inserts"],
        "total_warnings": log_summary["total_warnings"],
        "total_errors": log_summary["total_errors"],
        "retrieval_checks_passed": retrieval_successes,
        "gpu_used_before_mb": gpu_used_before,
        "gpu_used_after_mb": gpu_used_after,
        "gpu_total_mb": gpu_total,
        "warning_sample": clean_text(log_summary["warning_lines"][0][:200]) if log_summary["warning_lines"] else "",
        "error_sample": clean_text(log_summary["error_lines"][0][:200]) if log_summary["error_lines"] else "",
    }

    if arango_counts:
        for col, count in arango_counts.items():
            result[f"arango_{col}"] = count

    return result


# ============================================================================
# CLI
# ============================================================================


def main():
    parser = argparse.ArgumentParser(
        description="GENIE.AI Ingestion Pipeline Benchmark",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 benchmark_ingestion.py --pdf ../test-docs/wildlife.pdf --labels "Wildlife,Conservation"
  python3 benchmark_ingestion.py --pdf ../test-docs/wildlife.pdf --labels "Wildlife" --test-id 1A --model-desc "Qwen 2.5 7B + LLM labeling"
  python3 benchmark_ingestion.py --pdf ../test-docs/wildlife.pdf --labels "Wildlife" --retract-after --timeout 300
        """,
    )
    parser.add_argument("--pdf", required=True, help="Path to the test PDF file to ingest")
    parser.add_argument(
        "--labels", required=True,
        help="Comma-separated labels to apply (e.g., 'Wildlife,Conservation')",
    )
    parser.add_argument("--test-id", default="", help="Test ID from the test plan (e.g., 1A, 2B)")
    parser.add_argument("--model-desc", default="", help="Human-readable model configuration description")
    parser.add_argument("--retract-after", action="store_true", help="Retract the file after successful ingestion")
    parser.add_argument(
        "--monitor", choices=["docker", "docrepo"], default="docker",
        help="How to monitor ingestion progress (default: docker)",
    )
    parser.add_argument("--timeout", type=int, default=600, help="Ingestion timeout in seconds (default: 600)")
    parser.add_argument("--dry-run", action="store_true", help="Print configuration without running")

    args = parser.parse_args()

    file_labels = [l.strip() for l in args.labels.split(",")]

    if args.dry_run:
        print(f"\nDry run — would ingest:")
        print(f"  PDF:    {args.pdf}")
        print(f"  Labels: {file_labels}")
        print(f"  Test:   {args.test_id}")
        print(f"  Model:  {args.model_desc or 'auto-detected'}")
        print(f"  Retract: {args.retract_after}")
        return

    if not Path(args.pdf).exists():
        print(f"ERROR: File not found: {args.pdf}")
        sys.exit(1)

    run_ingestion_benchmark(
        pdf_path=args.pdf,
        file_labels=file_labels,
        test_id=args.test_id,
        model_desc=args.model_desc,
        retract_after=args.retract_after,
        monitor_mode=args.monitor,
        timeout=args.timeout,
    )


if __name__ == "__main__":
    main()
