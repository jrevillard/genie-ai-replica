# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""
GENIE.AI Benchmark — Query (Inference)

Benchmarks query/inference latency and answer quality across the RAG pipeline.
Designed for comparing model configurations (different LLMs, labeling strategies,
etc.) using the same set of questions and RAG parameters.

Measures per query:
  - End-to-end latency (request to response)
  - HTTP status code
  - Answer length
  - Error classification (timeout, 4xx, 5xx, network)

Aggregates per configuration:
  - Mean, median, min, max, p95 latency
  - Success rate
  - Mean answer length

Usage:
    python3 benchmark_query.py
    python3 benchmark_query.py --iterations 5 --test-id 1A --model-desc "Qwen 2.5 7B"
    python3 benchmark_query.py --smoke --test-id 3A --model-desc "Granite 2B (T4)"

Results are saved to benchmark_query_results.csv (pipe-delimited).
"""

import argparse
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import os

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

RESULTS_FILE = "benchmark_query_results.csv"
SMOKE_TEST_MODE = False


def execute_query(test_id, q_idx, question, iteration, rag_config):
    """Send a single query and return timing/status metrics."""
    start_t = time.time()

    payload = {
        "messages": [{"role": "user", "content": question}],
        "context": {"categoryLabel": "General", "serviceLabels": []},
        "stream": False,
        "user_id": "benchmark",
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
                    .get("content", "ERROR: Empty response")
                )
            return {
                "test_id": test_id,
                "question_id": q_idx,
                "iteration": iteration,
                "status_code": 200,
                "latency_sec": round(latency, 3),
                "answer_length": len(clean_text(answer)),
                "answer": clean_text(answer),
                "error_type": "",
            }
        else:
            return {
                "test_id": test_id,
                "question_id": q_idx,
                "iteration": iteration,
                "status_code": resp.status_code,
                "latency_sec": round(latency, 3),
                "answer_length": 0,
                "answer": clean_text(resp.text[:500]),
                "error_type": f"http_{resp.status_code}",
            }

    except requests.exceptions.Timeout:
        latency = time.time() - start_t
        return {
            "test_id": test_id,
            "question_id": q_idx,
            "iteration": iteration,
            "status_code": 504,
            "latency_sec": round(latency, 3),
            "answer_length": 0,
            "answer": "Timeout Error",
            "error_type": "timeout",
        }

    except requests.exceptions.ConnectionError as e:
        return {
            "test_id": test_id,
            "question_id": q_idx,
            "iteration": iteration,
            "status_code": 0,
            "latency_sec": round(time.time() - start_t, 3),
            "answer_length": 0,
            "answer": str(e)[:200],
            "error_type": "connection_error",
        }

    except requests.exceptions.RequestException as e:
        return {
            "test_id": test_id,
            "question_id": q_idx,
            "iteration": iteration,
            "status_code": 500,
            "latency_sec": round(time.time() - start_t, 3),
            "answer_length": 0,
            "answer": str(e)[:200],
            "error_type": "network_error",
        }


def compute_statistics(latencies):
    """Compute latency statistics from a list of values."""
    if not latencies:
        return {}
    sorted_lat = sorted(latencies)
    n = len(sorted_lat)
    return {
        "mean_latency": round(statistics.mean(sorted_lat), 3),
        "median_latency": round(statistics.median(sorted_lat), 3),
        "min_latency": round(sorted_lat[0], 3),
        "max_latency": round(sorted_lat[-1], 3),
        "p95_latency": round(sorted_lat[int(n * 0.95)] if n > 1 else sorted_lat[0], 3),
        "stdev_latency": round(statistics.stdev(sorted_lat), 3) if n > 1 else 0,
    }


def run_query_benchmark(test_id="", model_desc="", iterations=3,
                        rag_config=None, max_workers=4, smoke_mode=False):
    """Run the query benchmark across all test questions."""
    if rag_config is None:
        rag_config = DEFAULT_RAG_CONFIG

    print(f"\n{'='*70}")
    print(f"GENIE.AI Query Benchmark")
    print(f"{'='*70}")
    print(f"  Test ID:        {test_id or 'N/A'}")
    print(f"  Model Desc:     {model_desc or 'auto-detected'}")
    print(f"  Iterations:     {iterations}")
    print(f"  Questions:      {len(QUESTIONS)}")
    print(f"  Total queries:  {len(QUESTIONS) * iterations}")
    print(f"  Workers:        {max_workers}")
    print(f"{'='*70}\n")

    # Detect active model
    main_model = get_active_model_info()
    translation_model = get_translation_model_info()
    print(f"[{print_time_stamp()}] Main model:        {main_model}")
    print(f"[{print_time_stamp()}] Translation model: {translation_model}")

    # GPU snapshot
    gpu_info = get_gpu_memory_info()
    if gpu_info:
        for i, gpu in enumerate(gpu_info):
            print(f"[{print_time_stamp()}] GPU {i}: {gpu['used_mb']}/{gpu['total_mb']} MB")

    # Health check
    wait_for_service(CHATQNA_URL, timeout_sec=180, method="POST")

    # Build task list
    tasks = []
    for q in QUESTIONS:
        for it in range(1, iterations + 1):
            tasks.append((test_id, q["id"], q["text"], it, rag_config))

    if smoke_mode:
        tasks = tasks[: len(QUESTIONS)]  # One iteration in smoke mode
        print(f"[{print_time_stamp()}] SMOKE MODE: {len(tasks)} queries")

    # Execute
    results = []
    start_t = time.time()

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(execute_query, *t): t for t in tasks}
        for count, future in enumerate(as_completed(futures), 1):
            result = future.result()
            results.append(result)

            status_icon = "OK" if result["status_code"] == 200 else "FAIL"
            print(
                f"[{print_time_stamp()}] [{count}/{len(tasks)}] "
                f"Q{result['question_id']}.{result['iteration']} "
                f"{status_icon} ({result['latency_sec']:.2f}s)"
            )

            save_result(result, RESULTS_FILE)

    total_elapsed = time.time() - start_t

    # Compute aggregates
    successful = [r for r in results if r["status_code"] == 200]
    failed = [r for r in results if r["status_code"] != 200]
    latencies = [r["latency_sec"] for r in successful]
    answer_lengths = [r["answer_length"] for r in successful]
    stats = compute_statistics(latencies)

    # Print summary
    print(f"\n[{print_time_stamp()}] === Query Benchmark Summary ===")
    print(f"  Total queries:      {len(results)}")
    print(f"  Successful:         {len(successful)} ({len(successful)/len(results)*100:.1f}%)")
    print(f"  Failed:             {len(failed)}")
    print(f"  Total wall time:    {total_elapsed:.1f}s")
    if latencies:
        print(f"  Mean latency:       {stats['mean_latency']:.3f}s")
        print(f"  Median latency:     {stats['median_latency']:.3f}s")
        print(f"  P95 latency:        {stats['p95_latency']:.3f}s")
        print(f"  Min latency:        {stats['min_latency']:.3f}s")
        print(f"  Max latency:        {stats['max_latency']:.3f}s")
    if answer_lengths:
        print(f"  Mean answer length: {statistics.mean(answer_lengths):.0f} chars")

    if failed:
        print(f"\n  Failure breakdown:")
        error_counts = {}
        for f in failed:
            key = f["error_type"] or f"http_{f['status_code']}"
            error_counts[key] = error_counts.get(key, 0) + 1
        for err, count in sorted(error_counts.items(), key=lambda x: -x[1]):
            print(f"    {err}: {count}")

    # Save aggregate row
    aggregate = {
        "timestamp": print_time_stamp(),
        "test_id": test_id,
        "model_description": model_desc,
        "main_model": main_model,
        "translation_model": translation_model,
        "iterations": iterations,
        "total_queries": len(results),
        "successful": len(successful),
        "failed": len(failed),
        "success_rate": round(len(successful) / len(results) * 100, 1) if results else 0,
        "total_wall_time_sec": round(total_elapsed, 2),
        **stats,
        "mean_answer_length": round(statistics.mean(answer_lengths), 0) if answer_lengths else 0,
        "gpu_used_mb": gpu_info[0]["used_mb"] if gpu_info else 0,
        "gpu_total_mb": gpu_info[0]["total_mb"] if gpu_info else 0,
    }
    save_result(aggregate, RESULTS_FILE.replace(".csv", "_summary.csv"))

    print(f"\n[{print_time_stamp()}] Results saved to {RESULTS_FILE}")
    return aggregate


def main():
    ap = argparse.ArgumentParser(
        description="GENIE.AI Query (Inference) Benchmark",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 benchmark_query.py
  python3 benchmark_query.py --iterations 5 --test-id 1A --model-desc "Qwen 2.5 7B"
  python3 benchmark_query.py --smoke
        """,
    )
    ap.add_argument("--test-id", default="", help="Test ID from the test plan (e.g., 1A, 2B, 3A)")
    ap.add_argument("--model-desc", default="", help="Human-readable model configuration description")
    ap.add_argument("--iterations", type=int, default=3, help="Number of iterations per question (default: 3)")
    ap.add_argument("--workers", type=int, default=4, help="Concurrent query workers (default: 4)")
    ap.add_argument("--smoke", action="store_true", help="Quick smoke test (1 iteration per question)")
    ap.add_argument("--dry-run", action="store_true", help="Print configuration without running")

    args = ap.parse_args()

    if args.dry_run:
        print(f"\nDry run — would execute:")
        print(f"  Test:       {args.test_id}")
        print(f"  Model:      {args.model_desc or 'auto-detected'}")
        print(f"  Iterations: {args.iterations if not args.smoke else 1}")
        print(f"  Questions:  {len(QUESTIONS)}")
        print(f"  Total:      {len(QUESTIONS) * (args.iterations if not args.smoke else 1)}")
        return

    run_query_benchmark(
        test_id=args.test_id,
        model_desc=args.model_desc,
        iterations=args.iterations,
        max_workers=args.workers,
        smoke_mode=args.smoke,
    )


if __name__ == "__main__":
    main()
