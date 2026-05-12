# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""
GENIE.AI Benchmark Suite — Shared Configuration

Provides common constants, model profiles, test questions with reference
answers, and helper functions used across all benchmark scripts.

All service URLs are configurable via environment variables with sensible
defaults matching the standard docker compose deployment.
"""

import os
import subprocess
import threading
import time
import math
from collections import Counter
from datetime import datetime
from pathlib import Path

import pandas as pd

# ============================================================================
# Service Endpoints (override via environment variables)
# ============================================================================
CHATQNA_URL = os.getenv("CHATQNA_URL", "http://localhost:8888/v1/chatqna")
DATAPREP_URL = os.getenv("DATAPREP_URL", "http://localhost:5000/v1/dataprep")
RETRACT_URL = os.getenv("RETRACT_URL", "http://localhost:5000/v1/dataprep/retract_file")
KILL_INGEST_URL = os.getenv("KILL_INGEST_URL", "http://localhost:5000/v1/dataprep/kill_ingest")
RETRIEVER_URL = os.getenv("RETRIEVER_URL", "http://localhost:7025/v1/retrieval")
VLLM_MODELS_URL = os.getenv("VLLM_MODELS_URL", "http://localhost:8000/v1/models")
VLLM_TRANSLATION_MODELS_URL = os.getenv("VLLM_TRANSLATION_MODELS_URL", "http://localhost:9031/v1/models")
ARANGO_URL = os.getenv("ARANGO_URL", "http://localhost:8529")
DOCUMENT_REPO_URL = os.getenv("DOCUMENT_REPO_URL", "http://localhost:3001")

# ============================================================================
# Docker Configuration
# ============================================================================
DATAPREP_CONTAINER = os.getenv("DATAPREP_CONTAINER", "dataprep-arango-service")

# ============================================================================
# Default RAG Parameters (same as rag_configs_test.py)
# ============================================================================
DEFAULT_RAG_CONFIG = {
    "k": 10,
    "fetch_k": 20,
    "search_start": "chunk",
    "enable_traversal": "true",
    "traversal_max_depth": 1,
    "traversal_max_returned": 3,
    "traversal_score_threshold": 0.7,
    "reranking_strategy": "threshold",
    "reranker_top_n": 2,
    "reranking_threshold": 0.75,
}

# ============================================================================
# Test Questions with Reference Answers and Key Terms
#
# reference: Fill in the expected answer based on your actual test documents.
#            Used by benchmark_rag_accuracy.py for automated scoring.
#            Leave empty ("") to skip reference-based metrics for that question.
#
# key_terms: Terms that MUST appear in a correct answer.
#            Used by benchmark_rag_accuracy.py for keyword coverage scoring.
# ============================================================================
QUESTIONS = [
    {
        "id": 1,
        "text": "What is the altitude range and average monthly rainfall of the Masai Mara National Reserve?",
        "domain": "Geography",
        "reference": "",
        "key_terms": ["altitude", "rainfall", "Masai Mara"],
    },
    {
        "id": 2,
        "text": (
            "I am a non-resident adult planning a safari for August 2025. "
            "Compare the daily park entry fees (including any applicable concession fees) "
            "for staying inside the Masai Mara National Reserve versus staying inside the Serengeti National Park."
        ),
        "domain": "Financial",
        "reference": "",
        "key_terms": ["fees", "concession", "non-resident", "Masai Mara", "Serengeti"],
    },
    {
        "id": 3,
        "text": (
            "Why is the risk of contracting Malaria considered very low in the Serengeti National Park, "
            "and what specific preventative measures does the document still recommend tourists take?"
        ),
        "domain": "Medical",
        "reference": "",
        "key_terms": ["Malaria", "low risk", "preventative", "Serengeti"],
    },
    {
        "id": 4,
        "text": (
            "What technique is used to prevent the Large Language Model (LLM) from experiencing "
            "'drift' during label assignment, and what is the exact financial cost of running "
            "this LLM per 1,000 queries?"
        ),
        "domain": "Technical",
        "reference": "",
        "key_terms": ["drift", "label", "LLM", "cost", "queries"],
    },
    {
        "id": 5,
        "text": (
            "Based on the documentation, contrast the specific shortcomings of conventional "
            "vector-only RAG pipelines with the corresponding benefits introduced by this "
            "hybrid approach. Be sure to address issues of interpretability, precision, "
            "and domain adaptability."
        ),
        "domain": "Architecture",
        "reference": "",
        "key_terms": ["vector-only", "hybrid", "interpretability", "precision", "domain adaptability"],
    },
]

# ============================================================================
# Model Profiles (from GENIE-AI-Model-Test-Plan.md)
#
# Each profile maps to a hardware target and lists the recommended test
# configurations. Benchmarks use these to label results for comparison.
# ============================================================================
MODEL_PROFILES = {
    "rtx6000_ada": {
        "name": "RTX 6000 Ada (48GB, compute 8.9, bfloat16)",
        "configs": [
            {
                "test_id": "1A",
                "main_model": "Qwen/Qwen2.5-7B-Instruct",
                "labeling": "llm",
                "translation": "Infomaniak-AI/vllm-translategemma-4b-it",
                "dtype": "auto",
            },
            {
                "test_id": "1B",
                "main_model": "Qwen/Qwen2.5-7B-Instruct",
                "labeling": "embedding",
                "translation": "Infomaniak-AI/vllm-translategemma-4b-it",
                "dtype": "auto",
            },
            {
                "test_id": "1C",
                "main_model": "Qwen/Qwen2.5-7B-Instruct",
                "labeling": "llm",
                "translation": "google/gemma-3-4b-it",
                "dtype": "auto",
            },
            {
                "test_id": "1D",
                "main_model": "meta-llama/Meta-Llama-3.1-8B-Instruct",
                "labeling": "llm",
                "translation": "Infomaniak-AI/vllm-translategemma-4b-it",
                "dtype": "auto",
            },
            {
                "test_id": "1F",
                "main_model": "Qwen/Qwen2.5-14B-Instruct",
                "labeling": "llm",
                "translation": "Qwen/Qwen2.5-7B-Instruct",
                "dtype": "auto",
            },
            {
                "test_id": "1G",
                "main_model": "Qwen/Qwen2.5-14B-Instruct",
                "labeling": "llm",
                "translation": "Infomaniak-AI/vllm-translategemma-4b-it",
                "dtype": "auto",
            },
        ],
    },
    "a40": {
        "name": "NVIDIA A40 (48GB, compute 8.6, bfloat16)",
        "configs": [
            {
                "test_id": "2A",
                "main_model": "Qwen/Qwen2.5-7B-Instruct",
                "labeling": "llm",
                "translation": "Infomaniak-AI/vllm-translategemma-4b-it",
                "dtype": "auto",
            },
            {
                "test_id": "2B",
                "main_model": "meta-llama/Meta-Llama-3.1-8B-Instruct",
                "labeling": "llm",
                "translation": "Infomaniak-AI/vllm-translategemma-4b-it",
                "dtype": "auto",
            },
        ],
    },
    "t4": {
        "name": "Tesla T4 (16GB, compute 7.5, NO bfloat16)",
        "configs": [
            {
                "test_id": "3A",
                "main_model": "ibm-granite/granite-3.3-2b-instruct",
                "labeling": "embedding",
                "translation": "google/gemma-3-4b-it",
                "dtype": "half",
            },
            {
                "test_id": "3B",
                "main_model": "ibm-granite/granite-3.3-2b-instruct",
                "labeling": "bm25",
                "translation": "google/gemma-3-4b-it",
                "dtype": "half",
            },
            {
                "test_id": "3C",
                "main_model": "google/gemma-3-4b-it",
                "labeling": "embedding",
                "translation": "google/gemma-3-4b-it",
                "dtype": "half",
            },
        ],
    },
}


# ============================================================================
# Common Helpers
# ============================================================================

csv_lock = threading.Lock()


def print_time_stamp():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def clean_text(text):
    """Normalize whitespace in text for CSV output."""
    return " ".join(str(text).split())


def save_result(data_dict, results_file):
    """Append a result row to a pipe-delimited CSV (thread-safe)."""
    df = pd.DataFrame([data_dict])
    with csv_lock:
        if not Path(results_file).is_file():
            df.to_csv(results_file, sep="|", index=False)
        else:
            df.to_csv(results_file, sep="|", mode="a", header=False, index=False)


def wait_for_service(url, timeout_sec=180, method="GET"):
    """Poll a service until it responds with HTTP 200."""
    import requests

    print(f"[{print_time_stamp()}] Polling service at {url} for readiness...")
    start_t = time.time()
    while time.time() - start_t < timeout_sec:
        try:
            if method == "GET":
                resp = requests.get(url, timeout=5)
            else:
                resp = requests.post(
                    url,
                    json={
                        "messages": [{"role": "user", "content": "ping"}],
                        "stream": False,
                    },
                    timeout=5,
                )
            if resp.status_code == 200:
                print(f"[{print_time_stamp()}] Service at {url} is UP.")
                return True
        except requests.exceptions.RequestException:
            pass
        time.sleep(5)
    raise RuntimeError(f"Service at {url} not ready within {timeout_sec}s.")


def get_gpu_memory_info():
    """Get GPU memory usage via nvidia-smi. Returns list of dicts or None."""
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=memory.used,memory.total,memory.free",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0:
            gpus = []
            for line in result.stdout.strip().split("\n"):
                parts = [x.strip() for x in line.split(",")]
                if len(parts) >= 3:
                    gpus.append(
                        {
                            "used_mb": int(parts[0]),
                            "total_mb": int(parts[1]),
                            "free_mb": int(parts[2]),
                        }
                    )
            return gpus
    except (subprocess.TimeoutExpired, FileNotFoundError, ValueError):
        pass
    return None


def get_active_model_info():
    """Query vLLM for the currently loaded model ID."""
    import requests

    try:
        resp = requests.get(VLLM_MODELS_URL, timeout=5)
        if resp.status_code == 200:
            models = resp.json().get("data", [])
            if models:
                return models[0].get("id", "unknown")
    except requests.exceptions.RequestException:
        pass
    return "unknown"


def get_translation_model_info():
    """Query the translation vLLM instance for the loaded model ID."""
    import requests

    try:
        resp = requests.get(VLLM_TRANSLATION_MODELS_URL, timeout=5)
        if resp.status_code == 200:
            models = resp.json().get("data", [])
            if models:
                return models[0].get("id", "unknown")
    except requests.exceptions.RequestException:
        pass
    return "unknown"


# ============================================================================
# RAG Accuracy Metrics (pure Python, no external dependencies)
# ============================================================================


def compute_bleu(reference, hypothesis):
    """
    Compute a simplified BLEU-4 score.

    Uses standard n-gram precision up to 4-grams with brevity penalty.
    """
    ref_tokens = reference.lower().split()
    hyp_tokens = hypothesis.lower().split()

    if not hyp_tokens:
        return 0.0

    # Brevity penalty
    if len(hyp_tokens) >= len(ref_tokens):
        bp = 1.0
    else:
        bp = math.exp(1 - len(ref_tokens) / len(hyp_tokens))

    # N-gram precisions (1 through 4)
    precisions = []
    for n in range(1, 5):
        ref_ngrams = Counter(
            [tuple(ref_tokens[i : i + n]) for i in range(len(ref_tokens) - n + 1)]
        )
        hyp_ngrams = Counter(
            [tuple(hyp_tokens[i : i + n]) for i in range(len(hyp_tokens) - n + 1)]
        )

        clipped = sum(min(hyp_ngrams[ng], ref_ngrams[ng]) for ng in hyp_ngrams)
        total = sum(hyp_ngrams.values())

        if total == 0:
            precisions.append(0)
        else:
            precisions.append(clipped / total)

    if any(p == 0 for p in precisions):
        return 0.0

    log_avg = sum(math.log(p) for p in precisions) / len(precisions)
    return round(bp * math.exp(log_avg), 4)


def compute_rouge_l(reference, hypothesis):
    """
    Compute ROUGE-L F1 score based on longest common subsequence.
    """
    ref_tokens = reference.lower().split()
    hyp_tokens = hypothesis.lower().split()

    if not ref_tokens or not hyp_tokens:
        return 0.0

    m, n = len(ref_tokens), len(hyp_tokens)
    dp = [[0] * (n + 1) for _ in range(m + 1)]

    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if ref_tokens[i - 1] == hyp_tokens[j - 1]:
                dp[i][j] = dp[i - 1][j - 1] + 1
            else:
                dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])

    lcs = dp[m][n]
    precision = lcs / n
    recall = lcs / m

    if precision + recall == 0:
        return 0.0

    return round(2 * precision * recall / (precision + recall), 4)


def compute_keyword_coverage(answer, key_terms):
    """
    Compute the fraction of key_terms found in the answer (case-insensitive).
    """
    answer_lower = answer.lower()
    if not key_terms:
        return 1.0
    matched = sum(1 for term in key_terms if term.lower() in answer_lower)
    return round(matched / len(key_terms), 4)
