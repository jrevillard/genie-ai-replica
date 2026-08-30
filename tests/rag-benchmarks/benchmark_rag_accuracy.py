# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""
GENIE.AI Benchmark — RAG Accuracy

Evaluates RAG answer quality by comparing model outputs against reference answers
and checking for key term coverage. Metrics computed:

  - BLEU-4: N-gram overlap between answer and reference (0.0 - 1.0)
  - ROUGE-L: Longest common subsequence F1 (0.0 - 1.0)
  - Keyword Coverage: Fraction of expected key terms present in the answer (0.0 - 1.0)
  - Answer Length: Character count of the answer

Setup:
  Before running, edit benchmark_config.py and fill in the 'reference' field for
  each question in the QUESTIONS list. Reference answers should be the ideal
  answer derived from your actual test documents.

  Alternatively, provide a separate reference file via --references.

Usage:
    python3 benchmark_rag_accuracy.py
    python3 benchmark_rag_accuracy.py --iterations 3 --test-id 1A --model-desc "Qwen 2.5 7B"
    python3 benchmark_rag_accuracy.py --references my_references.json

Results are saved to:
  - benchmark_rag_accuracy_results.csv   (per-question detail)
  - benchmark_rag_accuracy_summary.csv   (aggregate scores)
"""

import argparse
import json
import os
import statistics
import sys
import time
from datetime import datetime
from pathlib import Path

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from benchmark_config import (
    CHATQNA_URL,
    DEFAULT_RAG_CONFIG,
    QUESTIONS,
    compute_bleu,
    compute_keyword_coverage,
    compute_rouge_l,
    clean_text,
    get_active_model_info,
    get_gpu_memory_info,
    get_translation_model_info,
    print_time_stamp,
    save_result,
    wait_for_service,
)

RESULTS_FILE = "benchmark_rag_accuracy_results.csv"
SUMMARY_FILE = "benchmark_rag_accuracy_summary.csv"


def load_references(ref_path):
    """
    Load reference answers from a JSON file.

    Expected format:
    {
        "1": "The Masai Mara has an altitude range of 1,500-2,200 meters...",
        "2": "Non-resident adult fees for Masai Mara are $80 per day...",
        ...
    }
    """
    with open(ref_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return {int(k): v for k, v in data.items()}


def evaluate_single_answer(question_id, question_text, answer, reference, key_terms):
    """
    Evaluate a single answer against its reference.

    Returns a dict with all accuracy metrics.
    """
    result = {
        "question_id": question_id,
        "question": clean_text(question_text),
        "answer": clean_text(answer),
        "answer_length": len(clean_text(answer)),
        "reference": clean_text(reference) if reference else "",
        "key_terms": ",".join(key_terms) if key_terms else "",
    }

    # Keyword coverage (always computed)
    result["keyword_coverage"] = compute_keyword_coverage(answer, key_terms)

    # BLEU and ROUGE-L (only if reference is provided)
    if reference:
        result["bleu_4"] = compute_bleu(reference, answer)
        result["rouge_l"] = compute_rouge_l(reference, answer)
    else:
        result["bleu_4"] = None
        result["rouge_l"] = None

    # Composite score: weighted average of available metrics
    scores = []
    if result["bleu_4"] is not None:
        scores.append(result["bleu_4"] * 0.35)
    if result["rouge_l"] is not None:
        scores.append(result["rouge_l"] * 0.35)
    scores.append(result["keyword_coverage"] * 0.30)

    result["composite_score"] = round(sum(scores), 4) if scores else 0.0

    return result


def query_chatqna(question, rag_config=None, timeout=210):
    """Send a query to the ChatQnA endpoint and return the answer text."""
    if rag_config is None:
        rag_config = DEFAULT_RAG_CONFIG

    payload = {
        "messages": [{"role": "user", "content": question}],
        "context": {"categoryLabel": "General", "serviceLabels": []},
        "stream": False,
        "user_id": "benchmark",
        **rag_config,
    }

    resp = requests.post(CHATQNA_URL, json=payload, timeout=timeout)
    if resp.status_code == 200:
        resp_json = resp.json()
        answer = resp_json.get("response", "")
        if not answer:
            answer = (
                resp_json.get("choices", [{}])[0]
                .get("message", {})
                .get("content", "")
            )
        return answer, resp.status_code
    return resp.text[:500], resp.status_code


def run_accuracy_benchmark(test_id="", model_desc="", iterations=1,
                           rag_config=None, references=None):
    """
    Run the RAG accuracy benchmark.

    Args:
        test_id: Test ID from the test plan (e.g., "1A")
        model_desc: Human-readable model description
        iterations: How many times to ask each question (takes best scores)
        rag_config: RAG parameters dict (uses DEFAULT_RAG_CONFIG if None)
        references: Dict of {question_id: reference_answer} (overrides QUESTIONS)
    """
    if rag_config is None:
        rag_config = DEFAULT_RAG_CONFIG

    print(f"\n{'='*70}")
    print(f"GENIE.AI RAG Accuracy Benchmark")
    print(f"{'='*70}")
    print(f"  Test ID:        {test_id or 'N/A'}")
    print(f"  Model Desc:     {model_desc or 'auto-detected'}")
    print(f"  Iterations:     {iterations}")
    print(f"  Questions:      {len(QUESTIONS)}")
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

    # Check which questions have references
    questions_with_refs = 0
    questions_without_refs = 0
    for q in QUESTIONS:
        ref = references.get(q["id"], q.get("reference", "")) if references else q.get("reference", "")
        if ref:
            questions_with_refs += 1
        else:
            questions_without_refs += 1

    print(f"[{print_time_stamp()}] Questions with references:    {questions_with_refs}")
    print(f"[{print_time_stamp()}] Questions without references: {questions_without_refs}")
    if questions_without_refs > 0:
        print(f"[{print_time_stamp()}] WARNING: {questions_without_refs} question(s) lack reference answers.")
        print(f"[{print_time_stamp()}]   BLEU and ROUGE-L will be skipped for those. Edit benchmark_config.py to add references.")

    # Health check
    wait_for_service(CHATQNA_URL, timeout_sec=180, method="POST")

    # Execute queries and evaluate
    all_results = []
    start_t = time.time()

    for q in QUESTIONS:
        q_ref = references.get(q["id"], q.get("reference", "")) if references else q.get("reference", "")
        q_key_terms = q.get("key_terms", [])
        best_result = None

        for it in range(1, iterations + 1):
            print(f"[{print_time_stamp()}] Q{q['id']} iteration {it}/{iterations}...", end=" ", flush=True)
            query_start = time.time()

            try:
                answer, status = query_chatqna(q["text"], rag_config)
                latency = time.time() - query_start

                if status == 200 and answer:
                    eval_result = evaluate_single_answer(
                        q["id"], q["text"], answer, q_ref, q_key_terms
                    )
                    eval_result["iteration"] = it
                    eval_result["status_code"] = status
                    eval_result["latency_sec"] = round(latency, 3)
                    eval_result["test_id"] = test_id

                    # Keep the best result (highest composite score)
                    if best_result is None or eval_result["composite_score"] > best_result["composite_score"]:
                        best_result = eval_result

                    print(
                        f"OK ({latency:.2f}s) "
                        f"BLEU={eval_result['bleu_4'] or 'N/A'} "
                        f"ROUGE-L={eval_result['rouge_l'] or 'N/A'} "
                        f"KW={eval_result['keyword_coverage']:.2f} "
                        f"Composite={eval_result['composite_score']:.3f}"
                    )
                else:
                    print(f"FAIL (HTTP {status})")

            except requests.exceptions.RequestException as e:
                print(f"ERROR: {e}")

        if best_result:
            all_results.append(best_result)
            save_result(best_result, RESULTS_FILE)

    total_elapsed = time.time() - start_t

    # Print summary table
    print(f"\n[{print_time_stamp()}] === RAG Accuracy Summary ===\n")
    print(f"  {'Q#':<4} {'Domain':<12} {'BLEU-4':<8} {'ROUGE-L':<8} {'KW Cov':<8} {'Composite':<10} {'Length':<8}")
    print(f"  {'---':<4} {'-----':<12} {'------':<8} {'-------':<8} {'------':<8} {'--------':<10} {'------':<8}")

    composite_scores = []
    bleu_scores = []
    rouge_scores = []
    kw_scores = []

    for r in all_results:
        bleu_str = f"{r['bleu_4']:.4f}" if r["bleu_4"] is not None else "N/A"
        rouge_str = f"{r['rouge_l']:.4f}" if r["rouge_l"] is not None else "N/A"
        q_info = next((q for q in QUESTIONS if q["id"] == r["question_id"]), {})
        domain = q_info.get("domain", "?")

        print(
            f"  {r['question_id']:<4} {domain:<12} {bleu_str:<8} {rouge_str:<8} "
            f"{r['keyword_coverage']:.4f}   {r['composite_score']:.4f}     {r['answer_length']:<8}"
        )

        composite_scores.append(r["composite_score"])
        if r["bleu_4"] is not None:
            bleu_scores.append(r["bleu_4"])
        if r["rouge_l"] is not None:
            rouge_scores.append(r["rouge_l"])
        kw_scores.append(r["keyword_coverage"])

    print()
    if composite_scores:
        print(f"  Mean composite score: {statistics.mean(composite_scores):.4f}")
    if bleu_scores:
        print(f"  Mean BLEU-4:          {statistics.mean(bleu_scores):.4f}")
    if rouge_scores:
        print(f"  Mean ROUGE-L:         {statistics.mean(rouge_scores):.4f}")
    if kw_scores:
        print(f"  Mean keyword coverage: {statistics.mean(kw_scores):.4f}")
    print(f"  Total wall time:      {total_elapsed:.1f}s")

    # Save aggregate summary
    aggregate = {
        "timestamp": print_time_stamp(),
        "test_id": test_id,
        "model_description": model_desc,
        "main_model": main_model,
        "translation_model": translation_model,
        "iterations": iterations,
        "questions_evaluated": len(all_results),
        "questions_with_references": questions_with_refs,
        "mean_composite_score": round(statistics.mean(composite_scores), 4) if composite_scores else None,
        "mean_bleu_4": round(statistics.mean(bleu_scores), 4) if bleu_scores else None,
        "mean_rouge_l": round(statistics.mean(rouge_scores), 4) if rouge_scores else None,
        "mean_keyword_coverage": round(statistics.mean(kw_scores), 4) if kw_scores else None,
        "total_wall_time_sec": round(total_elapsed, 2),
        "gpu_used_mb": gpu_info[0]["used_mb"] if gpu_info else 0,
        "gpu_total_mb": gpu_info[0]["total_mb"] if gpu_info else 0,
    }
    save_result(aggregate, SUMMARY_FILE)

    print(f"\n[{print_time_stamp()}] Detail results:  {RESULTS_FILE}")
    print(f"[{print_time_stamp()}] Summary results: {SUMMARY_FILE}")
    return aggregate


def main():
    ap = argparse.ArgumentParser(
        description="GENIE.AI RAG Accuracy Benchmark",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Setup:
  Edit benchmark_config.py and fill in the 'reference' field for each question
  in the QUESTIONS list with the ideal answer from your test documents.

  Alternatively, provide a JSON file with --references:
  {
      "1": "The Masai Mara has an altitude range of 1,500-2,200 meters...",
      "2": "Non-resident adult fees for Masai Mara are $80 per day...",
      ...
  }

Examples:
  python3 benchmark_rag_accuracy.py
  python3 benchmark_rag_accuracy.py --iterations 3 --test-id 1A
  python3 benchmark_rag_accuracy.py --references my_references.json
        """,
    )
    ap.add_argument("--test-id", default="", help="Test ID from the test plan (e.g., 1A, 2B)")
    ap.add_argument("--model-desc", default="", help="Human-readable model configuration description")
    ap.add_argument("--iterations", type=int, default=1,
                    help="Iterations per question; best composite score is kept (default: 1)")
    ap.add_argument("--references", default="", help="Path to JSON file with reference answers")
    ap.add_argument("--dry-run", action="store_true", help="Print configuration without running")

    args = ap.parse_args()

    if args.dry_run:
        print(f"\nDry run — would evaluate:")
        print(f"  Test:       {args.test_id}")
        print(f"  Model:      {args.model_desc or 'auto-detected'}")
        print(f"  Iterations: {args.iterations}")
        print(f"  Questions:  {len(QUESTIONS)}")
        refs_file = args.references or "benchmark_config.py QUESTIONS[].reference"
        print(f"  References: {refs_file}")
        return

    references = None
    if args.references:
        if not Path(args.references).exists():
            print(f"ERROR: Reference file not found: {args.references}")
            sys.exit(1)
        references = load_references(args.references)
        print(f"[{print_time_stamp()}] Loaded {len(references)} reference answers from {args.references}")

    run_accuracy_benchmark(
        test_id=args.test_id,
        model_desc=args.model_desc,
        iterations=args.iterations,
        references=references,
    )


if __name__ == "__main__":
    main()
