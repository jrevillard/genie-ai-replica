"""Quality estimation for v2 translations.

Two concrete implementations, plus a Composite that averages them:

  - ``ChrFPlusPlusQE`` — **requires a reference**. Computes F-beta over
    character n-grams (n=1..6) and word n-grams (n=1..2). Suitable
    when a glossary / TM hit supplies a known-good translation to
    compare against. A fallback choice because COMET-Kiwi is not
    trained on Mandinka.

  - ``HeuristicQE`` — **reference-free**. Combines:
      * length-ratio sanity (catches truncation / hallucination)
      * preserved-terms check (medication names, places, numbers
        must appear in the output)
      * non-empty, non-identity-to-source check
    Suitable for live production traffic where no reference exists.

  - ``CompositeQE`` — averages the scores of sub-QEs, passes if the
    average clears ``threshold`` (separate from sub-QE thresholds).
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Iterable

from translation_v2.interfaces import QEResult


# ── chrF++ implementation ────────────────────────────────────────────
def _char_ngrams(text: str, n: int) -> list[str]:
    if n <= 0 or len(text) < n:
        return []
    return [text[i : i + n] for i in range(len(text) - n + 1)]


def _word_ngrams(text: str, n: int) -> list[str]:
    words = text.split()
    if n <= 0 or len(words) < n:
        return []
    return [" ".join(words[i : i + n]) for i in range(len(words) - n + 1)]


def _f_beta(pred: Counter, ref: Counter, beta: float) -> float:
    if not pred or not ref:
        return 0.0
    overlap = 0
    for ngram, count in pred.items():
        overlap += min(count, ref.get(ngram, 0))
    total_pred = sum(pred.values())
    total_ref = sum(ref.values())
    if total_pred == 0 or total_ref == 0:
        return 0.0
    precision = overlap / total_pred
    recall = overlap / total_ref
    if precision == 0 and recall == 0:
        return 0.0
    b2 = beta * beta
    return (1 + b2) * precision * recall / (b2 * precision + recall)


class ChrFPlusPlusQE:
    """chrF++ score over char n-grams + word n-grams. Requires reference."""

    name: str = "chrf++"

    def __init__(
        self,
        char_n_max: int = 6,
        word_n_max: int = 2,
        beta: float = 2.0,
        threshold: float = 0.4,
    ) -> None:
        self._char_n = char_n_max
        self._word_n = word_n_max
        self._beta = beta
        self._threshold = threshold

    async def score(
        self,
        reference: str,
        hypothesis: str,
        lang_pair: str = "",
    ) -> QEResult:
        if not reference or not hypothesis:
            return QEResult(
                score=0.0,
                metric=self.name,
                passed=False,
                threshold=self._threshold,
                notes="empty input",
            )
        char_scores: list[float] = []
        for n in range(1, self._char_n + 1):
            pred = Counter(_char_ngrams(hypothesis, n))
            ref = Counter(_char_ngrams(reference, n))
            char_scores.append(_f_beta(pred, ref, self._beta))
        char_avg = sum(char_scores) / len(char_scores) if char_scores else 0.0

        word_scores: list[float] = []
        for n in range(1, self._word_n + 1):
            pred = Counter(_word_ngrams(hypothesis, n))
            ref = Counter(_word_ngrams(reference, n))
            if not pred and not ref:
                continue
            word_scores.append(_f_beta(pred, ref, self._beta))
        word_avg = sum(word_scores) / len(word_scores) if word_scores else None

        combined = (char_avg + word_avg) / 2 if word_avg is not None else char_avg
        return QEResult(
            score=combined,
            metric=self.name,
            passed=combined >= self._threshold,
            threshold=self._threshold,
        )


# ── Heuristic (reference-free) ───────────────────────────────────────
_NUMBER_RE = re.compile(r"\b\d+(?:[.,]\d+)*\b")


@dataclass
class HeuristicConfig:
    min_length_ratio: float = 0.3
    max_length_ratio: float = 3.5
    preserved_terms: list[str] = field(default_factory=list)
    threshold: float = 0.6
    check_numbers: bool = True


class HeuristicQE:
    """Reference-free QE. Combines length-ratio + preserved-terms + number check."""

    name: str = "heuristic"

    def __init__(self, config: HeuristicConfig | None = None) -> None:
        self._cfg = config or HeuristicConfig()

    async def score(
        self,
        source: str,
        target: str,
        lang_pair: str = "",
    ) -> QEResult:
        cfg = self._cfg
        if not source:
            return QEResult(
                score=0.0, metric=self.name, passed=False,
                threshold=cfg.threshold, notes="empty source",
            )
        if not target:
            return QEResult(
                score=0.0, metric=self.name, passed=False,
                threshold=cfg.threshold, notes="empty target",
            )
        if target.strip() == source.strip() and len(source) > 30:
            return QEResult(
                score=0.1, metric=self.name, passed=False,
                threshold=cfg.threshold,
                notes="target equals source (translator passthrough)",
            )

        # Length-ratio signal
        ratio = len(target) / max(len(source), 1)
        if cfg.min_length_ratio <= ratio <= cfg.max_length_ratio:
            length_score = 1.0
        else:
            # Gracefully degrade outside the window
            length_score = max(0.0, 1.0 - abs(ratio - 1.0) / 4.0)

        # Preserved terms signal
        src_lower = source.lower()
        tgt_lower = target.lower()
        hit = 0
        total = 0
        missing: list[str] = []
        for term in cfg.preserved_terms:
            t = term.lower()
            if t in src_lower:
                total += 1
                if t in tgt_lower:
                    hit += 1
                else:
                    missing.append(term)
        preserved_score = (hit / total) if total > 0 else 1.0

        # Number preservation
        if cfg.check_numbers:
            src_numbers = set(_NUMBER_RE.findall(source))
            tgt_numbers = set(_NUMBER_RE.findall(target))
            if src_numbers:
                num_hit = len(src_numbers & tgt_numbers)
                number_score = num_hit / len(src_numbers)
            else:
                number_score = 1.0
        else:
            number_score = 1.0

        components = [length_score, preserved_score, number_score]
        score = sum(components) / len(components)
        notes = (
            f"length_ratio={ratio:.2f} "
            f"preserved={hit}/{total}"
            + (f" missing={missing[:3]}" if missing else "")
            + f" numbers={number_score:.2f}"
        )
        return QEResult(
            score=score,
            metric=self.name,
            passed=score >= cfg.threshold,
            threshold=cfg.threshold,
            notes=notes,
        )


# ── Repetition detection (reference-free) ────────────────────────────
@dataclass
class RepetitionConfig:
    # Below this ratio of unique-tokens-to-total-tokens the output is
    # deemed degenerate. 0.15 catches extreme loops while leaving room
    # for legitimate low-diversity text (very short messages).
    min_diversity_ratio: float = 0.15
    # A trigram that appears this many times signals a loop.
    max_trigram_repeats: int = 4
    # Only apply diversity / trigram checks above this token count.
    min_tokens_for_check: int = 20
    threshold: float = 0.5


class RepetitionHeuristicQE:
    """Detect degenerate repetition in a translation.

    Target-side only — source text is ignored. Built specifically for
    the "N be ne n be ne bo n be jere..." failure mode seen when
    low-resource-language LLM calls run out of fluent tokens and fill
    the remaining budget with high-probability particles.

    Scoring: ``1.0`` when clean, ``0.0`` when degenerate. No middle
    ground — this is a binary smell test.
    """

    name: str = "repetition"

    def __init__(self, config: RepetitionConfig | None = None) -> None:
        self._cfg = config or RepetitionConfig()

    async def score(
        self,
        source: str,
        target: str,
        lang_pair: str = "",
    ) -> QEResult:
        cfg = self._cfg
        if not target or not target.strip():
            return QEResult(
                score=0.0, metric=self.name, passed=False,
                threshold=cfg.threshold, notes="empty target",
            )

        tokens = target.lower().split()
        n = len(tokens)
        if n < cfg.min_tokens_for_check:
            return QEResult(
                score=1.0, metric=self.name, passed=True,
                threshold=cfg.threshold,
                notes=f"below check threshold (n={n})",
            )

        unique = len(set(tokens))
        diversity = unique / n

        # Trigram histogram
        if n >= 3:
            trigrams: dict[tuple[str, str, str], int] = {}
            for i in range(n - 2):
                key = (tokens[i], tokens[i + 1], tokens[i + 2])
                trigrams[key] = trigrams.get(key, 0) + 1
            max_trigram = max(trigrams.values()) if trigrams else 0
        else:
            max_trigram = 0

        diversity_fail = diversity < cfg.min_diversity_ratio
        trigram_fail = max_trigram > cfg.max_trigram_repeats

        if diversity_fail or trigram_fail:
            notes = (
                f"diversity={diversity:.3f} (min {cfg.min_diversity_ratio}), "
                f"max_trigram_repeats={max_trigram} (max {cfg.max_trigram_repeats})"
            )
            return QEResult(
                score=0.0, metric=self.name, passed=False,
                threshold=cfg.threshold, notes=notes,
            )

        return QEResult(
            score=1.0, metric=self.name, passed=True,
            threshold=cfg.threshold,
            notes=f"diversity={diversity:.3f} max_trigram={max_trigram}",
        )


# ── Composite ────────────────────────────────────────────────────────
class CompositeQE:
    """Average of sub-QE scores. Each sub-QE is called with the same inputs."""

    name: str = "composite"

    def __init__(self, estimators: Iterable, threshold: float = 0.5) -> None:
        self._subs = list(estimators)
        if not self._subs:
            raise ValueError("CompositeQE needs at least one sub-estimator")
        self._threshold = threshold

    async def score(
        self,
        source: str,
        target: str,
        lang_pair: str = "",
    ) -> QEResult:
        sub_results = []
        for sub in self._subs:
            try:
                sub_results.append(await sub.score(source, target, lang_pair))
            except Exception as e:  # one bad sub doesn't break the composite
                sub_results.append(
                    QEResult(
                        score=0.0,
                        metric=getattr(sub, "name", "unknown"),
                        passed=False,
                        threshold=0.0,
                        notes=f"sub QE raised: {e}",
                    )
                )
        avg = sum(r.score for r in sub_results) / len(sub_results)
        notes_parts = [f"{r.metric}={r.score:.2f}" for r in sub_results]
        return QEResult(
            score=avg,
            metric=self.name,
            passed=avg >= self._threshold,
            threshold=self._threshold,
            notes=" | ".join(notes_parts),
        )
