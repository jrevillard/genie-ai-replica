#!/usr/bin/env python3
# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Semantic eval via Ragas, judged by an external OpenAI-compatible LLM.

Consumes eval_tuples.json (produced by ``run_eval.py --mode dump-tuples``) and
scores each entry with Ragas metrics:

    faithfulness       — is the answer grounded in the retrieved contexts?
    context_precision  — are relevant chunks ranked above irrelevant ones?
    context_recall     — does the retrieved context cover the reference answer?
    answer_relevancy   — does the answer address the question? (needs embeddings)

The judge is EXTERNAL and user-configured — point it at any OpenAI-compatible
endpoint (env vars). The deployment stays sovereign; only the eval tuples (which
you choose to export) reach the judge.

Requires (install where you run this — NOT a repo dependency):
    pip install ragas langchain-openai

Run locally, not in the deployment.
"""

from __future__ import annotations

import json
import os
import sys

# --- judge config (OpenAI-compatible, model-agnostic) -----------------------
JUDGE_BASE_URL = os.getenv("EVAL_JUDGE_BASE_URL")  # e.g. https://api.openai.com/v1 or a Zhipu/self-hosted endpoint
JUDGE_API_KEY = os.getenv("EVAL_JUDGE_API_KEY", "")
JUDGE_MODEL = os.getenv("EVAL_JUDGE_MODEL")  # whatever model you picked
JUDGE_TEMPERATURE = float(os.getenv("EVAL_JUDGE_TEMPERATURE", "0"))

# Embeddings (optional — only required for answer_relevancy). Defaults to a
# separate endpoint so the judge LLM and embedder can differ.
EMBED_BASE_URL = os.getenv("EVAL_EMBED_BASE_URL", JUDGE_BASE_URL)
EMBED_API_KEY = os.getenv("EVAL_EMBED_API_KEY", JUDGE_API_KEY)
EMBED_MODEL = os.getenv("EVAL_EMBED_MODEL")


def _build_judge():
    from langchain_openai import ChatOpenAI
    from ragas.llms import LangchainLLMWrapper

    if not (JUDGE_BASE_URL and JUDGE_MODEL):
        sys.exit("Set EVAL_JUDGE_BASE_URL and EVAL_JUDGE_MODEL (OpenAI-compatible).")
    llm = LangchainLLMWrapper(
        ChatOpenAI(
            base_url=JUDGE_BASE_URL,
            api_key=JUDGE_API_KEY,
            model=JUDGE_MODEL,
            temperature=JUDGE_TEMPERATURE,
        )
    )
    return llm


def _build_embeddings():
    from langchain_openai import OpenAIEmbeddings
    from ragas.embeddings import LangchainEmbeddingsWrapper

    if not EMBED_MODEL:
        return None  # answer_relevancy will be skipped
    return LangchainEmbeddingsWrapper(
        OpenAIEmbeddings(base_url=EMBED_BASE_URL, api_key=EMBED_API_KEY, model=EMBED_MODEL)
    )


def _metrics():
    # Canonical Ragas metrics. Import names are stable in ragas 0.2.x; if a
    # future ragas version renames one, the ImportError surfaces clearly here so
    # the user can adjust to their installed version.
    from ragas.metrics import context_precision, context_recall, faithfulness

    wanted = [faithfulness, context_precision, context_recall]
    if EMBED_MODEL:  # answer_relevancy needs embeddings
        try:
            from ragas.metrics import answer_relevancy

            wanted.append(answer_relevancy)
        except ImportError:
            pass
    return wanted


def main(tuples_path: str, out_path: str) -> None:
    from ragas import EvaluationDataset, evaluate

    with open(tuples_path) as fh:
        raw = json.load(fh)

    samples = [
        {
            "user_input": t["question"],
            "retrieved_contexts": t["contexts"],
            "response": t["answer"],
            "reference": t.get("reference_answer", ""),
        }
        for t in raw
    ]
    dataset = EvaluationDataset.from_list(samples)

    results = evaluate(
        dataset=dataset,
        llm=_build_judge(),
        embeddings=_build_embeddings(),
        metrics=_metrics(),
    )

    # results is a Result object; serialize per-row + aggregate.
    df = results.to_pandas() if hasattr(results, "to_pandas") else None
    report = {
        "aggregate": {k: float(v) for k, v in (results.items() if hasattr(results, "items") else [])},
        "per_query": df.to_dict(orient="records") if df is not None else [],
        "model": JUDGE_MODEL,
        "n": len(samples),
    }
    with open(out_path, "w") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2, default=str)
    print(f"Ragas eval (judge={JUDGE_MODEL}, n={len(samples)}) → {out_path}", file=sys.stderr)


if __name__ == "__main__":
    tuples = sys.argv[1] if len(sys.argv) > 1 else "eval_tuples.json"
    out = sys.argv[2] if len(sys.argv) > 2 else "ragas_report.json"
    main(tuples, out)
