# Copyright (C) 2024 Intel Corporation
# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0 Developed by Intel. Adapted by ITU

import os

import aiohttp
from comps import CustomLogger, LLMParamsDoc, OpeaComponentRegistry, SearchedDoc
from comps.cores.proto.api_protocol import (
    ChatCompletionRequest,
    RerankingRequest,
    RerankingResponse,
    RerankingResponseData,
)

# Importing the base class from original OPEA
from integrations.tei import OpeaTEIReranking
from kneed import KneeLocator


# Defining a custom data subclass
class GenieSearchedDoc(SearchedDoc):
    reranking_strategy: str | None = None
    reranking_threshold: float | None = None
    top_n: int | None = None


logger = CustomLogger("genie_tei_reranking")
logflag = os.getenv("LOGFLAG", False)


def _env_number(name, default, cast):
    """
    Read a numeric env var without crashing startup. Blank or unset falls back to the
    default silently. Anything that does not parse falls back to the default with a
    warning, so the substitution leaves a trace in the logs.
    """
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return cast(raw)
    except ValueError:
        logger.warning(f"{name}={raw!r} is not a valid value; using default {default}")
        return default


def _int_from_text(raw):
    """int() that also accepts an integral float ("3.0", which is how Ansible renders a YAML float)."""
    number = float(raw)
    if not number.is_integer():
        raise ValueError(raw)
    return int(number)


def _env_int(name, default):
    return _env_number(name, default, _int_from_text)


def _env_float(name, default):
    return _env_number(name, default, float)


def _slice_count(top_n, available):
    """Clamp a requested top-N to at least one and at most the candidates available."""
    try:
        top_n = int(top_n)
    except (TypeError, ValueError):
        top_n = 1
    return min(max(top_n, 1), available)


RERANKING_STRATEGY = os.getenv("RERANKING_STRATEGY", "slice")  # slice, threshold, knee_threshold
RERANKING_THRESHOLD = _env_float("RERANKING_THRESHOLD", 0.75)
RERANKER_TOP_N = _env_int("RERANKER_TOP_N", 1)
# Floor for the `threshold` strategy (see select_by_threshold). Unlike RERANKING_THRESHOLD,
# chatqna sends no per-request value for this, so the reranker's env is authoritative.
# The value is the smallest floor that reaches the chunk defining the condition in the
# measured typo case (tests/test_reranker_threshold_floor.py); the values tried before it,
# and why they changed, are in this line's git history.
DEFAULT_RERANKING_MIN_N = 3
RERANKING_MIN_N = _env_int("RERANKING_MIN_N", DEFAULT_RERANKING_MIN_N)
# A topped-up candidate must still look like a near miss: at least this fraction of the
# threshold. Keeps a lone survivor from dragging 0.0-score chunks into the prompt behind it.
NEAR_MISS_RATIO = 0.5


def count_above(scored, threshold):
    """How many of TEI's results clear the bar. Shared by the selection and its log line."""
    return sum(1 for r in scored if r["score"] >= threshold)


def select_by_threshold(decoded_response, threshold, min_n):
    """
    `threshold` strategy selection over TEI's scored results, best score first.

    Keeps every candidate scoring at or above ``threshold``, with two edge rules:

    * ``min_n`` is a floor, not a fallback. When at least one candidate clears the
      bar but fewer than ``min_n`` do, the next-best candidates are added up to
      ``min_n`` — each of them a near miss (``>= threshold * NEAR_MISS_RATIO``), so
      a single survivor cannot pull 0.0-score chunks in behind it. A single
      misspelt word can halve every cross-encoder score: the same eight chunks went
      from six above the bar to two — a treatment-target row and a threshold row —
      while the chunk that *defines* the condition ranked third and was dropped. The
      default floor is set to reach it; the measurements are in
      tests/test_reranker_threshold_floor.py. The floor keeps the context stable
      under that kind of perturbation without lowering the bar itself.
      ``min_n <= 0`` disables it.
    * When nothing clears the bar the result is empty. The former top-N fallback
      handed the LLM chunks scoring ~0.0-0.2 as if they were evidence. With no
      documents, chatqna appends its abstention instructions instead — a refusal
      under strict grounding, otherwise a "limited evidence, general guidance
      only" reply. Which of the two is chatqna's decision, not the reranker's.
    """
    ranked = sorted(decoded_response, key=lambda r: r["score"], reverse=True)
    n_above = count_above(ranked, threshold)
    if n_above == 0:
        return []
    near_miss = threshold * NEAR_MISS_RATIO
    top_up = [r for r in ranked[n_above : max(min_n, n_above)] if r["score"] >= near_miss]
    return ranked[:n_above] + top_up


@OpeaComponentRegistry.register("GENIE_TEI_RERANKING")
class GenieTEIReranking(OpeaTEIReranking):
    """
    GENIE.AI Extension of OpeaTEIReranking
    Adds: Multi-strategy reranking (slice, threshold, knee_threshold)
    """

    async def invoke(
        self, input: GenieSearchedDoc | RerankingRequest | ChatCompletionRequest
    ) -> LLMParamsDoc | RerankingResponse | ChatCompletionRequest:
        """Invokes the reranking service to generate rerankings for the provided input."""

        # Testing optimisation
        # Extract parameters dynamically from request payload to support
        # automated testing sweeps via ChatQnA
        input_dict = (
            input.model_dump(exclude_none=True)
            if hasattr(input, "model_dump")
            else getattr(input, "dict", lambda: {})()
        )
        logger.info(f"[ DEBUG - VERBOSE ] RERANKER INPUT: {input_dict}")

        reranking_results = []
        reranking_strategy = input_dict.get("reranking_strategy", RERANKING_STRATEGY)
        reranking_threshold = input_dict.get("reranking_threshold", RERANKING_THRESHOLD)
        reranker_top_n = input_dict.get("top_n", RERANKER_TOP_N)

        if input.retrieved_docs:
            docs = [doc.text for doc in input.retrieved_docs]
            query = input.initial_query if isinstance(input, SearchedDoc) else input.input

            async with (
                aiohttp.ClientSession() as session,
                session.post(f"{self.base_url}/rerank", json={"query": query, "texts": docs}) as resp,
            ):
                # Surface TEI's own error (e.g. 429 "Model is overloaded") instead of letting
                # its JSON error body fall through to the strategy code as a dict.
                resp.raise_for_status()
                decoded_response = await resp.json()

            # Checking reranking_strategy param value:
            logger.info(f"[ DEBUG ] Selected RERANKING STRATEGY is {reranking_strategy}")

            # Every strategy picks a subset of TEI's results; the result rows are built once below.
            if reranking_strategy == "slice":
                selected = decoded_response[: _slice_count(reranker_top_n, len(decoded_response))]

            elif reranking_strategy == "threshold":
                document_scores = [resp["score"] for resp in decoded_response]
                logger.info(f"[ DEBUG ] Reranked document scores {document_scores}")
                selected = select_by_threshold(decoded_response, reranking_threshold, RERANKING_MIN_N)
                n_above = count_above(decoded_response, reranking_threshold)
                if not selected:
                    logger.warning(
                        f"[ RERANK ] threshold={reranking_threshold} excluded all "
                        f"{len(decoded_response)} candidates; returning no documents"
                    )
                elif len(selected) > n_above:
                    logger.info(
                        f"[ RERANK ] threshold={reranking_threshold} kept {n_above} of "
                        f"{len(decoded_response)}; topped up to {len(selected)} (min_n={RERANKING_MIN_N})"
                    )

            elif reranking_strategy == "knee_threshold":
                document_scores = [resp["score"] for resp in decoded_response]
                logger.info(f"[ DEBUG ] Reranked document scores {document_scores}")
                indices = list(range(len(document_scores)))

                kneedle = KneeLocator(indices, document_scores, curve="convex", direction="decreasing")

                # If a knee is found, slice up to the knee + 1. Otherwise, keep all.
                cutoff = kneedle.knee + 1 if kneedle.knee is not None else len(document_scores)
                selected = decoded_response[:cutoff]
            else:
                logger.warning(f"Unknown strategy {reranking_strategy}. Defaulting to slice.")
                selected = decoded_response[: _slice_count(reranker_top_n, len(decoded_response))]

            reranking_results = [{"text": input.retrieved_docs[r["index"]].text, "score": r["score"]} for r in selected]

        # Checking reranker output composition
        logger.info(f"[ DEBUG ] Total number of documents in reranker output: {len(reranking_results)}")

        reranking_docs = [RerankingResponseData(text=doc["text"], score=doc["score"]) for doc in reranking_results]

        if isinstance(input, SearchedDoc):
            # 2. Return the RerankingResponse (preserves scores) instead of LLMParamsDoc (deletes scores)
            result = RerankingResponse(reranked_docs=reranking_docs)
            if logflag:
                logger.info(result)
            return result

        else:
            if isinstance(input, RerankingRequest):
                result = RerankingResponse(reranked_docs=reranking_docs)
                if logflag:
                    logger.info(result)
                return result

            if isinstance(input, ChatCompletionRequest):
                input.reranked_docs = reranking_docs
                input.documents = [doc["text"] for doc in reranking_results]
                if logflag:
                    logger.info(input)
                return input
