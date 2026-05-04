"""Phase G.1 — semantic-abuse-classifier eval.

Tests the embedding-based fallback layer that catches paraphrased
abuse the regex catalog misses.

  G1   Paraphrase positives: messages that are clearly abuse but
       don't trip any regex pattern. The semantic layer MUST flip
       them to ``directed_abuse``.
  G2   Health-context guard: a paraphrased complaint about an illness
       ("this disease is so hopeless") MUST stay clean — semantic
       should NOT flip it.
  G3   Distress paraphrase guard: distress phrasings that trip the
       regex-distress check upstream MUST still classify as
       ``distress`` (semantic must not have a chance to override).
  G4   Latency: average single-message score time <50 ms after
       warm-up.
  G5   Fail-open: with the model deliberately broken, the classifier
       still returns a result (clean) instead of raising.
  G6   Threshold knob: setting AMINA_ABUSE_SEMANTIC_THRESHOLD=0.99
       turns the layer effectively off — paraphrases stop being
       caught (recall trades for false-positive resistance).

Run from haystack-chatqna/:

    python -m src.abuse_defense.eval.phase_g_eval

The model is downloaded from HuggingFace cache on first run. This
takes 10-30 s on a fresh install. Subsequent runs use the local cache.
"""
from __future__ import annotations

import os
import sys
import time
from typing import List, Tuple

# Force in-memory cool-down so this eval doesn't depend on Redis.
os.environ["AMINA_ABUSE_DEFENSE_DISABLE_REDIS"] = "1"

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_SRC_PARENT = os.path.abspath(os.path.join(_THIS_DIR, "..", "..", ".."))
if _SRC_PARENT not in sys.path:
    sys.path.insert(0, _SRC_PARENT)

from src.abuse_defense import classifier as ad_classifier   # noqa: E402
from src.abuse_defense import semantic as ad_semantic       # noqa: E402


# ── helpers ──────────────────────────────────────────────────────────

def _classify(text: str) -> ad_classifier.Classification:
    return ad_classifier.classify(text)


# ── G1: paraphrase positives (semantic layer catches these) ─────────
# These are intentionally chosen to NOT match any regex pattern —
# they don't contain INSULT_WORDS / THREAT_VERBS / DEHUMANISING phrases
# / coercion / hard profanity. So if the semantic layer is OFF, they
# return clean. With it ON, they should flip to directed_abuse.

# NB: every input here MUST be one the regex catalog does NOT catch.
# Confirmed by inspecting `classify(text).matched_patterns` — empty
# regex match means semantic is the only source of the abuse verdict.
# Re-verify if you add a new entry: run `classifier.classify(...)` and
# confirm `matched_patterns == ['semantic_paraphrase']`, not e.g.
# 'insult_at_ai'.
PARAPHRASE_POSITIVES = [
    "go bother someone else",       # dismissal — exemplar-exact
    "leave me alone you machine",   # dismissal — score ~0.69
    "this thing is a disaster",     # contempt — score ~0.69
    "i'm done with you",            # hostility
    "you're not even trying",       # dismissal
    "stop wasting my time",         # dismissal
    "you mean nothing",             # dehumanising paraphrase
    "i'm going to expose you",      # threat paraphrase
]


def g1_paraphrase_positives() -> Tuple[str, bool, str]:
    fails: List[Tuple[str, str]] = []
    for text in PARAPHRASE_POSITIVES:
        c = _classify(text)
        # Acceptable categories: directed_abuse OR coercive_abuse
        # (some phrasings might trip coercion-paraphrase exemplars).
        # NOT clean.
        if c.category == ad_classifier.CAT_CLEAN:
            fails.append((text, "stayed clean"))
        elif not c.is_abuse:
            fails.append((text, f"category={c.category} but is_abuse={c.is_abuse}"))
    ok = not fails
    detail = (
        f"caught {len(PARAPHRASE_POSITIVES) - len(fails)}/{len(PARAPHRASE_POSITIVES)}"
        if ok else
        "FAILS:\n" + "\n".join(f"     - {t!r}: {r}" for t, r in fails)
    )
    return ("G1 paraphrase positives -> directed_abuse", ok, detail)


# ── G2: health-context guard (semantic must NOT flip these) ────────

HEALTH_CONTEXT_NON_ABUSE = [
    "this disease is so hopeless",                   # frustration without profanity
    "i feel like a waste — these readings are awful",   # frustration
    "i hate having to take this medication every day",  # mild hostility, but health
    "this diabetes is making me crazy",
    "my blood pressure makes me feel like a failure",
]


def g2_health_context_guard() -> Tuple[str, bool, str]:
    fails: List[Tuple[str, str]] = []
    for text in HEALTH_CONTEXT_NON_ABUSE:
        c = _classify(text)
        if c.is_abuse:
            fails.append((text, f"flipped to {c.category} ({c.matched_patterns})"))
    ok = not fails
    detail = (
        f"all {len(HEALTH_CONTEXT_NON_ABUSE)} stayed non-abuse"
        if ok else
        "FALSE POSITIVES:\n" + "\n".join(f"     - {t!r}: {r}" for t, r in fails)
    )
    return ("G2 health-context guard prevents false flip", ok, detail)


# ── G3: distress paraphrase still wins ─────────────────────────────

DISTRESS_PARAPHRASES = [
    "i want to die",
    "i wish i was dead",
    "no point in living anymore",
]


def g3_distress_still_wins() -> Tuple[str, bool, str]:
    fails: List[Tuple[str, str]] = []
    for text in DISTRESS_PARAPHRASES:
        c = _classify(text)
        if not c.is_distress:
            fails.append((text, f"category={c.category}"))
    ok = not fails
    detail = (
        f"all {len(DISTRESS_PARAPHRASES)} -> distress"
        if ok else
        "FAILS:\n" + "\n".join(f"     - {t!r}: {r}" for t, r in fails)
    )
    return ("G3 distress always wins (regex absolute override)", ok, detail)


# ── G4: latency budget ──────────────────────────────────────────────

def g4_latency() -> Tuple[str, bool, str]:
    # Use a paraphrase that ONLY the semantic layer flags (regex would
    # return clean), so we measure the semantic-encode + dot-product
    # cost, not the regex fast-path.
    _ = _classify("warmup")
    samples: List[float] = []
    msg = "go bother someone else"
    for _ in range(20):
        t0 = time.perf_counter()
        _classify(msg)
        samples.append((time.perf_counter() - t0) * 1000)
    avg = sum(samples) / len(samples)
    peak = max(samples)
    # Generous 50 ms budget: CPU-only on a low-end host can take that long.
    ok = avg < 50.0
    return ("G4 latency budget (<50 ms avg, semantic path)", ok,
            f"avg={avg:.1f} ms, peak={peak:.1f} ms over {len(samples)} samples")


# ── G5: fail-open (broken model -> classifier still works) ────────

def g5_fail_open() -> Tuple[str, bool, str]:
    # Use a paraphrase the regex does NOT catch, so the only source of
    # an abuse verdict would be semantic. With semantic broken, this
    # MUST fall through to clean (no exception, no abuse classification).
    ad_semantic.force_failed_for_test()
    try:
        c = _classify("go bother someone else")
        ok = (c.category == ad_classifier.CAT_CLEAN)
        return ("G5 broken semantic falls through to clean (no raise)", ok,
                f"category={c.category}, is_abuse={c.is_abuse}")
    finally:
        # Restore for subsequent tests.
        ad_semantic.reset_for_test()
        ad_semantic._load_sync()


# ── G6: threshold knob ─────────────────────────────────────────────

def g6_threshold_knob() -> Tuple[str, bool, str]:
    # Use a paraphrase the regex does NOT catch AND that doesn't
    # exemplar-exact-match (which would score 1.00 and resist any
    # threshold short of 1.0). "leave me alone you machine" scored
    # ~0.69 in the diagnostic — below threshold 0.99, above 0.62.
    real_threshold = ad_semantic.THRESHOLD
    ad_semantic.THRESHOLD = 0.99
    try:
        c = _classify("leave me alone you machine")
        ok = (c.category == ad_classifier.CAT_CLEAN)
        return ("G6 threshold=0.99 turns layer effectively off", ok,
                f"category={c.category}")
    finally:
        ad_semantic.THRESHOLD = real_threshold


# ── runner ──────────────────────────────────────────────────────────

def main() -> int:
    print("=" * 78)
    print("Abuse-Defense Phase G.1 — semantic-classifier eval")
    print("=" * 78 + "\n")

    # Force load up-front so all subsequent tests share a warm model.
    print("Loading model + exemplars (one-time, ~10-30 s on cold cache)...")
    t0 = time.perf_counter()
    loaded = ad_semantic._load_sync()
    print(f"  loaded={loaded}, took {(time.perf_counter()-t0)*1000:.0f} ms")
    print(f"  status: {ad_semantic.status_snapshot()}")
    print()

    if not loaded:
        print("PHASE G.1 EVAL: FAIL (model could not load — check sentence-transformers + HF cache)")
        return 1

    checks = [
        g1_paraphrase_positives,
        g2_health_context_guard,
        g3_distress_still_wins,
        g4_latency,
        g5_fail_open,
        g6_threshold_knob,
    ]

    rows: List[Tuple[str, bool, str]] = []
    for fn in checks:
        try:
            rows.append(fn())
        except Exception as exc:
            rows.append((fn.__name__, False, f"EXCEPTION: {exc}"))

    print(f"{'TITLE':<55} PASS  detail")
    print("-" * 78)
    for title, ok, detail in rows:
        flag = "OK  " if ok else "FAIL"
        print(f"{title:<55} {flag}  {detail}")

    passed = sum(1 for _, ok, _ in rows if ok)
    total = len(rows)
    print(f"\nResult: {passed}/{total} pass")

    if passed == total:
        print("PHASE G.1 EVAL: PASS")
        return 0
    print("PHASE G.1 EVAL: FAIL")
    return 1


if __name__ == "__main__":
    sys.exit(main())
