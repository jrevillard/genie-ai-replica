# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The TEI reranking and evidence-selection adapter (V02 §4.13, §4.14).

Ports the recorded reranking stage: the TEI ``/rerank`` call (recorded shape,
timeouts, no Authorization header, no retry), the five selection strategies
(``slice`` deployed; ``threshold``, ``slice_threshold``, ``knee_threshold``,
``adaptive``), the failure-mode mapping (one behavior per failure mode), and
the confidence-time score calibration. The selected passages keep the
reranker's score-descending order — there is no explicit tie-break: equal
scores keep TEI's relative order.

The recorded TEI call: ``POST {base_url}/rerank`` with
``{"query", "texts", "truncate": false}`` — ``truncate=False`` forces TEI's
strict input check, so an over-cap input surfaces as HTTP 422 instead of a
silently saturated score. No ``top_n`` is sent to TEI. A 300 s total and a
30 s connect timeout bound the call; there is no retry.
"""

import json
import logging
import math
import re
import statistics
from dataclasses import dataclass

import httpx
import numpy as np
from kneed import KneeLocator

from .env_config import AdaptiveConfig, RerankingConfig

logger = logging.getLogger(__name__)


class RerankerInputTooLongError(Exception):
    """TEI rejected the input as too long (HTTP 422 + Validation error_type).

    The recorded outcome is an ABSTENTION (``reranker_input_too_long``), not
    a failure: the caller maps this type onto an insufficiency answer.
    """


@dataclass(frozen=True)
class ScoredCandidate:
    """One candidate text with its reranker score, in selection order.

    ``position`` is the candidate's index in the text list the adapter was
    called with — TEI reports indices into that list, and the selection keeps
    them so the caller can address its own candidate list positionally.
    """

    text: str
    score: float
    position: int


@dataclass(frozen=True)
class RerankOutcome:
    """The selection result, with the recorded empty-selection outcomes kept distinct.

    ``selection`` carries the selected candidates in TEI's score-descending
    order, each with its POSITION in the input text list
    (``ScoredCandidate.position``) so the caller maps selections back to
    enriched candidates even when several candidates share a text.
    ``selected_nothing`` distinguishes a reranker that selected nothing from
    a non-selection outcome (an input-too-long abstention raises
    ``RerankerInputTooLongError`` instead; transport and protocol failures
    raise, and the caller turns them into a transient failure).
    """

    selection: tuple[ScoredCandidate, ...]

    @property
    def selected_nothing(self) -> bool:
        return not self.selection


def _safe_get_text(texts: list[str], tei_index: int) -> str | None:
    """Return ``texts[tei_index]`` if in bounds, else log and return None.

    A buggy TEI response can carry an out-of-range index. Skipping preserves
    partial results instead of crashing with IndexError (recorded: not
    fatal, the document is skipped).
    """
    if tei_index < 0 or tei_index >= len(texts):
        logger.error(f"TEI index {tei_index} out of range for {len(texts)} docs")
        return None
    return texts[tei_index]


def adaptive_context_selection(texts, chunk_embeddings, query_embedding, reranker_scores, config: AdaptiveConfig):
    """Utility-cost context selection, ported behavior-identically from the record.

    Picks candidates whose marginal value (utility minus cost) exceeds
    ``MIN_VALUE_THRESHOLD``. Utility = relevance × novelty-weight; cost =
    token cost + confusion cost. Candidates are processed in descending score
    order: the strongest match seeds the selected set, then each subsequent
    candidate is scored for marginal value against what is already selected.

    Callers MUST pass ``texts``, ``chunk_embeddings`` and ``reranker_scores``
    aligned to the same candidate order, with ``reranker_scores`` sorted
    descending (so ``reranker_scores[0]`` is the maximum).

    Returns ``(selected_positions, breakdown)`` where ``breakdown`` is a
    per-candidate record of every term in the utility-cost calculation.
    """
    n = len(texts)
    breakdown: list[dict] = []
    if n == 0:
        return [], breakdown

    avg_score = statistics.mean(reranker_scores)
    median_score = statistics.median(reranker_scores)
    skew = (avg_score - median_score) / avg_score if avg_score != 0 else 0.0
    max_score = reranker_scores[0]  # caller passes scores sorted descending

    selected_indices = []

    def cosine_similarity(vec_a, vec_b):
        vec_a = np.array(vec_a, dtype=float)
        vec_b = np.array(vec_b, dtype=float)
        norm_a = np.linalg.norm(vec_a)
        norm_b = np.linalg.norm(vec_b)
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return float(np.dot(vec_a, vec_b) / (norm_a * norm_b))

    def novelty_sigmoid(novelty):
        return 1.0 / (1.0 + math.exp(-config.novelty_sigmoid_a * (novelty - config.novelty_sigmoid_b)))

    for i in range(n):
        score = reranker_scores[i]

        # Relevance — boosts candidates whose score exceeds the (skew-adjusted) mean
        relevance = score + (score - avg_score * (1 + np.tanh(skew)))

        # Novelty — penalises redundancy with already-selected candidates
        if not selected_indices:
            novelty = 1.0
        else:
            best_similarity = -1.0
            best_selected_index = selected_indices[0]
            for j in selected_indices:
                similarity = cosine_similarity(chunk_embeddings[i], chunk_embeddings[j])
                if similarity > best_similarity:
                    best_similarity = similarity
                    best_selected_index = j
            sim_i_q = cosine_similarity(chunk_embeddings[i], query_embedding)
            sim_j_q = cosine_similarity(chunk_embeddings[best_selected_index], query_embedding)
            delta_q = abs(sim_i_q - sim_j_q)
            novelty = 1 - best_similarity * (1 - delta_q)
            novelty = max(0.0, min(1.0, novelty))

        utility = relevance * novelty_sigmoid(novelty)

        # Token cost — each candidate consumes context-window budget (~4 chars/token)
        token_count = max(1, len(texts[i]) / 4.0)
        context_decay_cost = config.context_decay_factor * token_count

        # Confusion cost — low-confidence candidates risk degrading the answer
        denominator = max_score - avg_score
        if abs(denominator) < 1e-6:
            denominator = 1e-6
        confusion_cost = (1 - score) + ((max_score - score) / denominator)
        total_cost = context_decay_cost + confusion_cost

        value = utility - total_cost
        is_selected = value > config.min_value_threshold
        logger.info(
            f"[ADAPTIVE] idx={i} score={score:.4f} R={relevance:.4f} "
            f"N={novelty:.4f} U={utility:.4f} C={total_cost:.4f} V={value:.4f}"
        )
        breakdown.append(
            {
                "idx": i,
                "score": round(score, 6),
                "relevance": round(float(relevance), 6),
                "novelty": round(novelty, 6),
                "novelty_weight": round(float(novelty_sigmoid(novelty)), 6),
                "utility": round(float(utility), 6),
                "token_count": int(token_count),
                "context_decay_cost": round(float(context_decay_cost), 6),
                "confusion_cost": round(float(confusion_cost), 6),
                "total_cost": round(float(total_cost), 6),
                "value": round(float(value), 6),
                "selected": bool(is_selected),
            }
        )
        if is_selected:
            selected_indices.append(i)

    return selected_indices, breakdown


class TeiRerankingAdapter:
    """Calls TEI ``/rerank`` and applies the recorded selection strategies."""

    def __init__(
        self,
        endpoint: str,
        config: RerankingConfig,
        transport: httpx.AsyncBaseTransport | None = None,
        adaptive_config: AdaptiveConfig | None = None,
        tls_verify: bool = True,
    ):
        self._endpoint = endpoint.rstrip("/")
        self._config = config
        self._adaptive = adaptive_config if adaptive_config is not None else AdaptiveConfig.load()
        # Injectable for the tests (httpx.MockTransport); production uses
        # the default connection pool.
        self._transport = transport
        # The venue TLS knob (OPEA_SSL_SKIP_VERIFY=1) — the same deployment
        # convention every other client of the self-signed GPU gateway
        # honors; a verifying default stays the default.
        self._tls_verify = tls_verify

    async def rerank(self, query: str, texts: list[str], chunk_embeddings=None, query_embedding=None) -> RerankOutcome:
        """Score the candidates with TEI and select per the configured strategy.

        ``chunk_embeddings`` and ``query_embedding`` feed only the ``adaptive``
        strategy; the other strategies ignore them (the deployed adaptive path
        hard-fails without them, and this port reproduces that).
        """
        scores = await self._tei_scores(query, texts)
        strategy = self._config.resolve_strategy(None, log=logger)
        selection = self._select(scores, texts, strategy, chunk_embeddings, query_embedding)
        return RerankOutcome(selection=tuple(selection))

    async def _tei_scores(self, query: str, texts: list[str]) -> list[dict]:
        """Call TEI and return its decoded ``[{"index", "score"}]`` list.

        Raises per the recorded failure modes: HTTP 422 + ``Validation`` →
        ``RerankerInputTooLongError``; any other non-200, a non-list body, or
        a transport error → ``RuntimeError`` (the caller maps it onto a
        transient failure — there is NO fallback to the retrieval order).
        """
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(self._config.rerank_timeout_seconds, connect=self._config.connect_timeout_seconds),
            transport=self._transport,
            verify=self._tls_verify,
        ) as client:
            response = await client.post(
                f"{self._endpoint}/rerank",
                json={"query": query, "texts": texts, "truncate": False},
            )
        decoded = response.json()
        if response.status_code == 422 and isinstance(decoded, dict) and decoded.get("error_type") == "Validation":
            error_message = decoded.get("error", "unknown")
            given_tokens = None
            if error_message:
                match = re.search(r"Given:\s*(\d+)", error_message)
                if match:
                    given_tokens = int(match.group(1))
            logger.warning(
                f"Reranker input too long: {len(texts)} docs, "
                f"actual={given_tokens if given_tokens is not None else 'unknown'} tokens"
            )
            raise RerankerInputTooLongError(f"TEI rejected input: {error_message}")
        if response.status_code != 200:
            raise RuntimeError(
                f"TEI reranker call failed: HTTP {response.status_code} from "
                f"{self._endpoint}/rerank (ndocs={len(texts)}). Response: {json.dumps(decoded)[:500]}"
            )
        if not isinstance(decoded, list):
            raise RuntimeError(
                f"TEI reranker returned an unexpected response type "
                f"{type(decoded).__name__} (expected list of {{index, score}} dicts). "
                f"HTTP was 200 but body is not the scored-list contract. Response: {json.dumps(decoded)[:300]}"
            )
        if len(decoded) != len(texts):
            logger.warning(
                f"TEI reranker returned {len(decoded)} scores for {len(texts)} input docs — counts differ. "
                f"Scores may not align with the candidates."
            )
        return decoded

    def _select(
        self,
        decoded: list[dict],
        texts: list[str],
        strategy: str,
        chunk_embeddings=None,
        query_embedding=None,
    ) -> list[ScoredCandidate]:
        """Apply one selection strategy to TEI's score-descending response.

        Every branch keeps the recorded semantics: the selected passages stay
        in TEI's score-descending order, an out-of-range index skips its
        document (not fatal), and no branch reorders or re-scores.
        """
        top_n = self._config.top_n
        threshold = self._config.threshold
        results: list[ScoredCandidate] = []

        if strategy == "slice":
            for entry in decoded[: top_n if top_n else 1]:
                text = _safe_get_text(texts, entry["index"])
                if text is None:
                    continue
                results.append(ScoredCandidate(text=text, score=entry["score"], position=entry["index"]))
        elif strategy == "threshold":
            for entry in decoded:
                if entry["score"] >= threshold:
                    text = _safe_get_text(texts, entry["index"])
                    if text is None:
                        continue
                    results.append(ScoredCandidate(text=text, score=entry["score"], position=entry["index"]))
        elif strategy == "knee_threshold":
            document_scores = [r["score"] for r in decoded]
            indices = list(range(len(document_scores)))
            kneedle = KneeLocator(indices, document_scores, curve="convex", direction="decreasing")
            # If a knee is found, slice up to the knee + 1. Otherwise, keep all.
            cutoff = kneedle.knee + 1 if kneedle.knee is not None else len(document_scores)
            for i in range(cutoff):
                entry = decoded[i]
                text = _safe_get_text(texts, entry["index"])
                if text is None:
                    continue
                results.append(ScoredCandidate(text=text, score=entry["score"], position=entry["index"]))
        elif strategy == "slice_threshold":
            # Top-N, but only candidates scoring at/above the threshold.
            # decoded is pre-sorted descending by TEI, so break as soon as a
            # score drops below the threshold.
            for entry in decoded:
                if entry["score"] >= threshold:
                    text = _safe_get_text(texts, entry["index"])
                    if text is None:
                        continue
                    results.append(ScoredCandidate(text=text, score=entry["score"], position=entry["index"]))
                    if len(results) >= (top_n if top_n else 1):
                        break
                else:
                    break
        elif strategy == "adaptive":
            query_vector = query_embedding if isinstance(query_embedding, list) else []
            chunk_vectors = chunk_embeddings if chunk_embeddings is not None else []
            embeddings_valid = (
                bool(query_vector)
                and len(chunk_vectors) == len(texts)
                and all(isinstance(ce, list) and len(ce) > 0 for ce in chunk_vectors)
            )
            if not embeddings_valid:
                # Hard-fail: adaptive has no legitimate graceful-degradation
                # case (recorded: RuntimeError — the turn fails).
                raise RuntimeError(
                    "[ADAPTIVE] Cannot run adaptive reranking — embeddings missing "
                    f"or misaligned (query_embedding={'present' if query_vector else 'missing'}, "
                    f"chunk_embeddings={len(chunk_vectors)} vs docs={len(texts)}). "
                    "Fix the embedding propagation chain before using adaptive."
                )
            ranked_texts = []
            ranked_chunk_embeddings = []
            ranked_scores = []
            ranked_positions = []
            for entry in decoded:
                text = _safe_get_text(texts, entry["index"])
                if text is None:
                    continue
                ranked_texts.append(text)
                ranked_chunk_embeddings.append(chunk_vectors[entry["index"]])
                ranked_scores.append(entry["score"])
                ranked_positions.append(entry["index"])
            selected_positions, _breakdown = adaptive_context_selection(
                texts=ranked_texts,
                chunk_embeddings=ranked_chunk_embeddings,
                query_embedding=query_vector,
                reranker_scores=ranked_scores,
                config=self._adaptive,
            )
            for position in selected_positions:
                results.append(
                    ScoredCandidate(
                        text=ranked_texts[position],
                        score=ranked_scores[position],
                        position=ranked_positions[position],
                    )
                )
        return results

    def calibrate(self, score: float) -> float:
        """Map a raw reranker score for CONFIDENCE use only (V02 §4.13).

        ``none`` (deployed) returns the raw score; ``sigmoid`` returns
        ``1/(1+exp(-score/temperature))`` with overflow saturation. The
        calibration is never applied to selection comparisons or ordering —
        only to a confidence number derived from the selected scores.
        """
        try:
            score = float(score)
        except (TypeError, ValueError):
            return 0.0
        if self._config.calibration != "sigmoid":
            return score
        temperature = self._config.temperature or 1.0
        try:
            return 1.0 / (1.0 + math.exp(-score / temperature))
        except OverflowError:
            return 0.0 if score < 0 else 1.0
