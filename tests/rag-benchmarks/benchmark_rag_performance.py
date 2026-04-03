# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""
GENIE.AI Benchmark — RAG Performance (Load Test)

Benchmarks RAG pipeline performance under concurrent load:
  - Queries per second (QPS / throughput)
  - Latency distribution (p50, p75, p90, p95, p99)
  - Error rate under load
  - GPU memory utilization during load

Supports two modes:
  1. Fixed count: Send N total queries with C concurrent workers
  2. Timed: Send queries continuously for D seconds with C concurrent workers

Usage:
    python3 benchmark_rag_performance.py --concurrent 4 --duration 60
    python3 benchmark_rag_performance.py --concurrent 8 --total-queries 100
    python3 benchmark_rag_performance.py --concurrent 2 --smoke --test-id 3A

Results are saved to:
  - benchmark_rag_performance_results.csv   (per-query detail)
  - benchmark_rag_performance_summary.csv   (aggregate metrics)
"""

import argparse
import os
import statistics
import sys
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from benchmark_config import (
    CHATQNA_URL,
    DEFAULT_RAG_CONFIG,
    QUESTIONS,
    clean_text,
    get_active_model_info,
    get_gpu_memory_info,
    get_translation_model_info,
    print_time_stamp,
    save_result,
    wait_for_service,
)

RESULTS_FILE = "benchmark_rag_performance_results.csv"
SUMMARY_FILE = "benchmark_rag_performance_summary.csv"


class AtomicCounter:
    """Thread-safe counter for tracking completed queries."""

    def __init__(self, initial=0):
        self._value = initial
        self._lock = threading.Lock()

    def increment(self):
        with self._lock:
            self._value += 1
            return self._value

    @property
    def value(self):
        return self._value


def execute_single_query(query_idx, question, rag_config):
    """Send a single query and return timing metrics."""
    start_t = time.time()

    payload = {
        "messages": [{"role": "user", "content": question}],
        "context": {"categoryLabel": "General", "serviceLabels": []},
        "stream": False,
        "user_id": "benchmark_load",
        **rag_config,
    }

    try:
        resp = requests.post(CHATQNA_URL, json=payload, timeout=210)
        latency = time.time() - start_t

        if resp.status_code == 200:
            resp_json = resp.json()
            answer = resp_json.get("response", "")
            if not answer:
                answer = (
                    resp_json.get("choices", [{}])[0]
                    .get("message", {})
                    .get("content", "")
                )
            return {
                "query_idx": query_idx,
                "status_code": 200,
                "latency_sec": round(latency, 4),
                "answer_length": len(clean_text(answer)),
                "error_type": "",
                "start_epoch": start_t,
            }
        else:
            return {
                "query_idx": query_idx,
                "status_code": resp.status_code,
                "latency_sec": round(latency, 4),
                "answer_length": 0,
                "error_type": f"http_{resp.status_code}",
                "start_epoch": start_t,
            }

    except requests.exceptions.Timeout:
        return {
            "query_idx": query_idx,
            "status_code": 504,
            "latency_sec": round(time.time() - start_t, 4),
            "answer_length": 0,
            "error_type": "timeout",
            "start_epoch": start_t,
        }

    except requests.exceptions.ConnectionError:
        return {
            "query_idx": query_idx,
            "status_code": 0,
            "latency_sec": round(time.time() - start_t, 4),
            "answer_length": 0,
            "error_type": "connection_error",
            "start_epoch": start_t,
        }

    except requests.exceptions.RequestException as e:
        return {
            "query_idx": query_idx,
            "status_code": 500,
            "latency_sec": round(time.time() - start_t, 4),
            "answer_length": 0,
            "error_type": "network_error",
            "start_epoch": start_t,
        }


def compute_percentiles(sorted_data):
    """Compute latency percentiles from a sorted list."""
    n = len(sorted_data)
    if n == 0:
        return {}
    return {
        "p50": round(sorted_data[int(n * 0.50)], 4),
        "p75": round(sorted_data[int(n * 0.75)], 4),
        "p90": round(sorted_data[min(int(n * 0.90), n - 1)], 4),
        "p95": round(sorted_data[min(int(n * 0.95), n - 1)], 4),
        "p99": round(sorted_data[min(int(n * 0.99), n - 1)], 4),
    }


def run_load_test(concurrent, duration=None, total_queries=None, rag_config=None,
                  test_id="", model_desc="", smoke_mode=False):
    """
    Execute a load test against the ChatQnA endpoint.

    Either duration (seconds) or total_queries must be specified.
    """
    if rag_config is None:
        rag_config = DEFAULT_RAG_CONFIG

    is_timed = duration is not None and duration > 0
    is_counted = total_queries is not None and total_queries > 0

    if smoke_mode:
        concurrent = 1
        total_queries = len(QUESTIONS)
        is_timed = False
        is_counted = True
        duration = None

    if not is_timed and not is_counted:
        print("ERROR: Specify --duration or --total-queries")
        sys.exit(1)

    print(f"\n{'='*70}")
    print(f"GENIE.AI RAG Performance Benchmark (Load Test)")
    print(f"{'='*70}")
    print(f"  Test ID:        {test_id or 'N/A'}")
    print(f"  Model Desc:     {model_desc or 'auto-detected'}")
    print(f"  Concurrent:     {concurrent}")
    print(f"  Mode:           {'Timed (' + str(duration) + 's)' if is_timed else 'Counted (' + str(total_queries) + ' queries)'}")
    print(f"{'='*70}\n")

    # Detect active model
    main_model = get_active_model_info()
    translation_model = get_translation_model_info()
    print(f"[{print_time_stamp()}] Main model:        {main_model}")
    print(f"[{print_time_stamp()}] Translation model: {translation_model}")

    # GPU snapshot
    gpu_before = get_gpu_memory_info()
    if gpu_before:
        for i, gpu in enumerate(gpu_before):
            print(f"[{print_time_stamp()}] GPU {i} before: {gpu['used_mb']}/{gpu['total_mb']} MB")

    # Health check
    wait_for_service(CHATQNA_URL, timeout_sec=180, method="POST")

    results = []
    counter = AtomicCounter()
    stop_flag = threading.Event()
    lock = threading.Lock()

    def worker():
        """Worker thread that continuously sends queries until stop_flag is set."""
        while not stop_flag.is_set():
            q = QUESTIONS[counter.increment() % len(QUESTIONS)]
            result = execute_single_query(counter.value, q["text"], rag_config)
            with lock:
                results.append(result)
                save_result(result, RESULTS_FILE)

    def timed_worker():
        """Worker thread that sends queries until duration expires."""
        while not stop_flag.is_set():
            q = QUESTIONS[counter.increment() % len(QUESTIONS)]
            result = execute_single_query(counter.value, q["text"], rag_config)
            with lock:
                results.append(result)
                save_result(result, RESULTS_FILE)

    def counted_worker(query_count):
        """Worker thread that sends exactly query_count queries total."""
        queries_sent = [0]  # mutable counter per pool

        def _send():
            while True:
                with lock:
                    if queries_sent[0] >= query_count:
                        return
                    queries_sent[0] += 1
                    idx = queries_sent[0]

                q = QUESTIONS[idx % len(QUESTIONS)]
                result = execute_single_query(idx, q["text"], rag_config)
                with lock:
                    results.append(result)
                    save_result(result, RESULTS_FILE)

        return _send

    # Run the load test
    print(f"[{print_time_stamp()}] Starting load test...")
    start_t = time.time()

    with ThreadPoolExecutor(max_workers=concurrent) as executor:
        if is_timed:
            # Submit workers that run until duration expires
            futures = [executor.submit(timed_worker) for _ in range(concurrent)]
            # Wait for duration
            time.sleep(duration)
            stop_flag.set()
            # Wait for workers to finish their current query
            for f in futures:
                f.result(timeout=60)

        elif is_counted:
            # Submit queries in a round-robin fashion
            remaining = total_queries
            query_idx = 0

            while remaining > 0:
                batch_size = min(remaining, concurrent)
                futures = []
                for _ in range(batch_size):
                    q = QUESTIONS[query_idx % len(QUESTIONS)]
                    query_idx += 1
                    remaining -= 1
                    futures.append(executor.submit(execute_single_query, query_idx, q["text"], rag_config))

                for f in as_completed(futures):
                    result = f.result()
                    with lock:
                        results.append(result)
                        save_result(result, RESULTS_FILE)

                # Progress indicator
                done = total_queries - remaining
                if done % max(1, concurrent * 5) == 0:
                    print(
                        f"[{print_time_stamp()}] Progress: {done}/{total_queries} "
                        f"({done/total_queries*100:.0f}%)"
                    )

    total_elapsed = time.time() - start_t

    # GPU after
    gpu_after = get_gpu_memory_info()
    if gpu_after:
        for i, gpu in enumerate(gpu_after):
            print(f"[{print_time_stamp()}] GPU {i} after: {gpu['used_mb']}/{gpu['total_mb']} MB")

    # Compute metrics
    successful = [r for r in results if r["status_code"] == 200]
    failed = [r for r in results if r["status_code"] != 200]
    latencies = sorted([r["latency_sec"] for r in successful])
    percentiles = compute_percentiles(latencies)

    qps = len(successful) / total_elapsed if total_elapsed > 0 else 0
    error_rate = len(failed) / len(results) * 100 if results else 0

    # Error breakdown
    error_breakdown = {}
    for f in failed:
        key = f["error_type"] or f"http_{f['status_code']}"
        error_breakdown[key] = error_breakdown.get(key, 0) + 1

    # Print summary
    print(f"\n[{print_time_stamp()}] === RAG Performance Summary ===")
    print(f"  Total queries:      {len(results)}")
    print(f"  Successful:         {len(successful)}")
    print(f"  Failed:             {len(failed)}")
    print(f"  Error rate:         {error_rate:.1f}%")
    print(f"  Duration:           {total_elapsed:.1f}s")
    print(f"  Throughput (QPS):   {qps:.2f}")
    print()
    if latencies:
        print(f"  Latency Distribution:")
        print(f"    Mean:  {statistics.mean(latencies):.4f}s")
        print(f"    Median: {percentiles['p50']:.4f}s")
        print(f"    P75:    {percentiles['p75']:.4f}s")
        print(f"    P90:    {percentiles['p90']:.4f}s")
        print(f"    P95:    {percentiles['p95']:.4f}s")
        print(f"    P99:    {percentiles['p99']:.4f}s")
        print(f"    Min:    {latencies[0]:.4f}s")
        print(f"    Max:    {latencies[-1]:.4f}s")

    if error_breakdown:
        print(f"\n  Error Breakdown:")
        for err, count in sorted(error_breakdown.items(), key=lambda x: -x[1]):
            print(f"    {err}: {count}")

    # Save aggregate
    gpu_used_before = gpu_before[0]["used_mb"] if gpu_before else 0
    gpu_used_after = gpu_after[0]["used_mb"] if gpu_after else 0
    gpu_total = gpu_before[0]["total_mb"] if gpu_before else 0

    aggregate = {
        "timestamp": print_time_stamp(),
        "test_id": test_id,
        "model_description": model_desc,
        "main_model": main_model,
        "translation_model": translation_model,
        "concurrent_users": concurrent,
        "duration_sec": duration if is_timed else round(total_elapsed, 2),
        "total_queries": len(results),
        "successful": len(successful),
        "failed": len(failed),
        "error_rate_pct": round(error_rate, 1),
        "throughput_qps": round(qps, 2),
        "mean_latency": round(statistics.mean(latencies), 4) if latencies else None,
        "median_latency": percentiles.get("p50"),
        "p95_latency": percentiles.get("p95"),
        "p99_latency": percentiles.get("p99"),
        "min_latency": latencies[0] if latencies else None,
        "max_latency": latencies[-1] if latencies else None,
        "gpu_used_before_mb": gpu_used_before,
        "gpu_used_after_mb": gpu_used_after,
        "gpu_total_mb": gpu_total,
    }
    save_result(aggregate, SUMMARY_FILE)

    print(f"\n[{print_time_stamp()}] Detail results:  {RESULTS_FILE}")
    print(f"[{print_time_stamp()}] Summary results: {SUMMARY_FILE}")
    return aggregate


def main():
    ap = argparse.ArgumentParser(
        description="GENIE.AI RAG Performance Benchmark (Load Test)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 benchmark_rag_performance.py --concurrent 4 --duration 60
  python3 benchmark_rag_performance.py --concurrent 8 --total-queries 100
  python3 benchmark_rag_performance.py --concurrent 2 --smoke
        """,
    )
    ap.add_argument("--concurrent", type=int, default=4, help="Concurrent users/workers (default: 4)")
    ap.add_argument("--duration", type=int, default=None,
                    help="Run for N seconds (mutually exclusive with --total-queries)")
    ap.add_argument("--total-queries", type=int, default=None,
                    help="Send exactly N queries (mutually exclusive with --duration)")
    ap.add_argument("--test-id", default="", help="Test ID from the test plan (e.g., 1A, 2B)")
    ap.add_argument("--model-desc", default="", help="Human-readable model configuration description")
    ap.add_argument("--smoke", action="store_true", help="Quick smoke test (1 worker, 1 query per question)")
    ap.add_argument("--dry-run", action="store_true", help="Print configuration without running")

    args = ap.parse_args()

    if args.dry_run:
        mode = "smoke" if args.smoke else ("timed" if args.duration else "counted")
        print(f"\nDry run — would execute:")
        print(f"  Mode:       {mode}")
        print(f"  Concurrent: {args.concurrent if not args.smoke else 1}")
        print(f"  Duration:   {args.duration}s" if args.duration else f"  Queries:    {args.total_queries}")
        print(f"  Test:       {args.test_id}")
        print(f"  Model:      {args.model_desc or 'auto-detected'}")
        return

    if args.duration and args.total_queries:
        print("ERROR: --duration and --total-queries are mutually exclusive")
        sys.exit(1)

    run_load_test(
        concurrent=args.concurrent,
        duration=args.duration,
        total_queries=args.total_queries,
        test_id=args.test_id,
        model_desc=args.model_desc,
        smoke_mode=args.smoke,
    )


if __name__ == "__main__":
    main()
