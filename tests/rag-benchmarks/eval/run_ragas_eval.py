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
    pip install -r requirements.txt

Run locally, not in the deployment.
"""

from __future__ import annotations

import json
import os
import sys

# ragas (<0.5) eagerly imports langchain_community.chat_models.vertexai, removed
# in langchain-community 0.4.x. Stub it when absent so the import chain survives.
try:  # pragma: no cover - depends on installed versions
    from langchain_community.chat_models import vertexai  # noqa: F401
except ImportError:
    import sys as _sys
    import types as _types

    _vertexai = _types.ModuleType("langchain_community.chat_models.vertexai")

    class _ChatVertexAI:  # noqa: D401 - stub for ragas.llms.base
        pass

    _vertexai.ChatVertexAI = _ChatVertexAI
    _sys.modules["langchain_community.chat_models.vertexai"] = _vertexai

# --- judge config (OpenAI-compatible, model-agnostic) -----------------------
JUDGE_BASE_URL = os.getenv("EVAL_JUDGE_BASE_URL")  # e.g. https://api.openai.com/v1 or a Zhipu/self-hosted endpoint
JUDGE_API_KEY = os.getenv("EVAL_JUDGE_API_KEY", "")
JUDGE_MODEL = os.getenv("EVAL_JUDGE_MODEL")  # whatever model you picked
JUDGE_TEMPERATURE = float(os.getenv("EVAL_JUDGE_TEMPERATURE", "0"))
JUDGE_MAX_TOKENS = int(os.getenv("EVAL_JUDGE_MAX_TOKENS", "0"))

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
    # Sovereign vLLM fronts nginx with a self-signed cert — bypass SSL verify
    # on BOTH sync and async OpenAI clients (RAGAS uses the async path
    # internally; without verify=False on http_async_client, calls fail with
    # httpx2.ConnectError: CERTIFICATE_VERIFY_FAILED → OpenAIConnectionError).
    import httpx
    sync_client = httpx.Client(verify=False)
    async_client = httpx.AsyncClient(verify=False)
    llm = LangchainLLMWrapper(
        ChatOpenAI(
            base_url=JUDGE_BASE_URL,
            api_key=JUDGE_API_KEY,
            model=JUDGE_MODEL,
            temperature=JUDGE_TEMPERATURE,
            http_client=sync_client,
            http_async_client=async_client,
            **({"max_tokens": JUDGE_MAX_TOKENS} if JUDGE_MAX_TOKENS else {}),
        )
    )
    return llm


def _build_embeddings():
    from langchain_openai import OpenAIEmbeddings
    from ragas.embeddings import LangchainEmbeddingsWrapper

    if not EMBED_MODEL:
        print("WARNING: EVAL_EMBED_MODEL unset — answer_relevancy will be dropped", file=sys.stderr)
        return None  # answer_relevancy will be skipped
    import httpx
    sync_client = httpx.Client(verify=False)
    async_client = httpx.AsyncClient(verify=False)
    return LangchainEmbeddingsWrapper(
        OpenAIEmbeddings(
            base_url=EMBED_BASE_URL,
            api_key=EMBED_API_KEY,
            model=EMBED_MODEL,
            http_client=sync_client,
            http_async_client=async_client,
        )
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


def _load_tuples(tuples_path: str) -> list:
    """Load and validate the eval_tuples.json input.

    Hard-fails (exit 2) on:
      - the file cannot be read / is 0 bytes (json.JSONDecodeError)
      - the top-level value is not a JSON list (ragas expects a list of
        question/context tuples; a dict-shaped payload would have crashed
        deep inside the ragas call instead of surfacing the operator error)

    The exit 2 here is the right code per the F5 ruling — the prior guard
    only covered the empty-list case and let 0-byte / dict payloads reach
    ragas, where they crashed with a confusing traceback instead of a clear
    operator-visible "your input is malformed" message.
    """
    try:
        with open(tuples_path, encoding="utf-8") as fh:
            raw = json.load(fh)
    except json.JSONDecodeError as e:
        print(
            f"EXIT 2: could not parse {tuples_path!r} as JSON: {e}. "
            "Is the file 0 bytes or truncated? Re-run run_eval.py to regenerate.",
            file=sys.stderr,
        )
        sys.exit(2)
    if not isinstance(raw, list):
        print(
            f"EXIT 2: {tuples_path!r} must hold a JSON list of tuples "
            f"(got {type(raw).__name__}). Re-run run_eval.py to regenerate.",
            file=sys.stderr,
        )
        sys.exit(2)
    if not raw:
        print(
            "EXIT 2: empty eval_tuples.json — refusing to judge (Phase 3 produced nothing)",
            file=sys.stderr,
        )
        sys.exit(2)
    return raw


def main(tuples_path: str, out_path: str) -> None:
    # F8 (MR !505 review): single defaulting site. The __main__ block is
    # the only place that reads sys.argv — main() trusts whatever it was
    # handed. An explicit non-empty string opts in; an empty string is the
    # documented sentinel for "use the default" and is resolved here.
    if not tuples_path:
        tuples_path = "eval_tuples.json"
    if not out_path:
        out_path = "ragas_report.json"

    raw = _load_tuples(tuples_path)

    from ragas import EvaluationDataset, evaluate

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
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2, default=str)
    print(f"Ragas eval (judge={JUDGE_MODEL}, n={len(samples)}) → {out_path}", file=sys.stderr)


if __name__ == "__main__":
    tuples = sys.argv[1] if len(sys.argv) > 1 else "eval_tuples.json"
    out = sys.argv[2] if len(sys.argv) > 2 else "ragas_report.json"
    main(tuples, out)
