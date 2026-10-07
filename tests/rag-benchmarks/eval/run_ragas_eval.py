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


# --- FANOUT: simulate n>1 via parallel single-n calls ------------------------
#
# Ragas 0.4.x answer_relevancy requests n=3 generations (strictness signal).
# The local judge chain (ccr router 127.0.0.1:3456 → MiniMax-M3) rejects n>1
# upstream (HTTP 400 "does not support n > 1 (2013)"); langchain-openai then
# silently collapses to a single generation ("Proceeding with 1"). Other
# router models either reject (all MiniMax) or accept-and-ignore n
# (glm-* returns 1 choice). Restore strictness by fanning n>1 out into n
# independent single-n calls and merging the generations.
#
# Cache evidence (empirical, 2026-10-07): 3 parallel identical prompts at
# temperature 0.7 to the same endpoint returned 3 DISTINCT completions — no
# response-cache dedup on this stack. Therefore NO prompt nonce is needed
# (a nonce would alter judged content).
#
# Re-verify recipe after any gateway change: fire 3 identical prompts in
# parallel via this class and assert 3 distinct completion strings.
try:
    from langchain_openai import ChatOpenAI
except ImportError:  # pragma: no cover - only meaningful for runtime, tests fake it
    ChatOpenAI = None  # type: ignore[assignment]


if ChatOpenAI is not None:
    import asyncio
    from concurrent.futures import ThreadPoolExecutor
    from copy import deepcopy

    class _FanoutChatOpenAI(ChatOpenAI):
        """ChatOpenAI subclass that simulates n>1 by fanning out into n
        parallel single-n requests, then merging the generations.

        Why: see the module-level FANOUT comment above. Briefly — the judge
        chain rejects n>1, langchain-openai silently collapses to n=1, and
        ragas's answer_relevancy strictness signal is lost. This subclass
        preserves the signal by fanning n>1 out into n independent single-n
        requests on the parent's request path.

        How the n=1 override is delivered: langchain-openai builds its
        outgoing payload as ``{**self._default_params, **kwargs}`` (kwargs
        win) and ``_default_params`` carries ``"n": self.n``. Therefore
        passing ``n=1`` in the per-call kwargs is enough — no ``self.n``
        mutation, no lock, no restore. Each underlying call is fully
        independent and shares no mutable state with its siblings.

        Concurrency: sync fan-out uses ``ThreadPoolExecutor`` (parallel
        siblings, NOT serialized); async fan-out uses ``asyncio.gather``
        (parallel siblings on the event loop). Both are async-deadlock-
        free — no lock is held across ``await`` or between super calls.

        Exception propagation: if any underlying call raises, the first
        exception is propagated to the caller (``asyncio.gather`` default
        ``return_exceptions=False``; ``ThreadPoolExecutor.map`` raises on
        the first failing iteration). The remaining in-flight calls are
        not cancelled — letting the OS / event loop clean them up is
        cheaper than tracking them per call, and RAGAS retries at its
        own layer anyway.
        """

        @staticmethod
        def _effective_n(kwargs_n, self_n):
            n = kwargs_n if kwargs_n is not None else self_n
            try:
                return max(1, int(n)) if n is not None else 1
            except (TypeError, ValueError):
                return 1

        @staticmethod
        def _merge_results(results):
            """Merge per-call ChatResults into one. All calls share the same
            inputs (we're fanning the SAME prompt), so ``generations`` is
            ``list[list[ChatGeneration]]`` with one nested list per input.
            Flatten the per-call lists into one nested list of N generations
            per input. Preserve the first call's ``llm_output`` (token usage
            etc.) — picking a single one is the only honest answer; RAGAS
            uses the merged generations, not the usage stats."""
            from langchain_core.outputs import ChatResult

            if not results:
                return ChatResult(generations=[])
            n_inputs = len(results[0].generations)
            merged: list = [[] for _ in range(n_inputs)]
            first_info = None
            for r in results:
                for i in range(n_inputs):
                    if i < len(r.generations):
                        merged[i].extend(r.generations[i])
                if first_info is None:
                    info = getattr(r, "llm_output", None)
                    if info:
                        first_info = info
            out = ChatResult(generations=merged)
            if first_info is not None:
                out.llm_output = first_info
            return out

        def _generate(self, messages, stop=None, run_manager=None, **kwargs):
            n = self._effective_n(kwargs.pop("n", None), self.n)
            if n <= 1:
                return super()._generate(
                    messages, stop=stop, run_manager=run_manager, **kwargs
                )
            # Per-call kwargs carry n=1 so the parent's payload picks it
            # over self.n. deepcopy(messages) per call removes the
            # shared-reference foot-gun (some chat models mutate the
            # messages list in place during tool-call bookkeeping).
            per_call = {**kwargs, "n": 1}

            def _one():
                # Explicit super(_FanoutChatOpenAI, self) — bare `super()`
                # would raise "no arguments" from inside a closure that
                # the compiler can't statically bind to this class.
                return super(_FanoutChatOpenAI, self)._generate(
                    deepcopy(messages), stop=stop, run_manager=run_manager, **per_call
                )

            with ThreadPoolExecutor(max_workers=n) as ex:
                results = list(ex.map(lambda _: _one(), range(n)))
            return self._merge_results(results)

        async def _agenerate(self, messages, stop=None, run_manager=None, **kwargs):
            n = self._effective_n(kwargs.pop("n", None), self.n)
            if n <= 1:
                return await super()._agenerate(
                    messages, stop=stop, run_manager=run_manager, **kwargs
                )
            per_call = {**kwargs, "n": 1}

            async def _one():
                # Explicit super form (see _generate for the same reason).
                return await super(_FanoutChatOpenAI, self)._agenerate(
                    deepcopy(messages), stop=stop, run_manager=run_manager, **per_call
                )

            # Default return_exceptions=False → first exception propagates.
            results = await asyncio.gather(*(_one() for _ in range(n)))
            return self._merge_results(results)


def _build_judge():
    if _FanoutChatOpenAI is None:
        sys.exit(
            "langchain_openai is not installed — install it (see requirements.txt) "
            "to use the RAGAS judge."
        )
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
        _FanoutChatOpenAI(
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
