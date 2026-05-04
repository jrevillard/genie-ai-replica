"""Semantic abuse classifier (Phase G.1).

Catches paraphrased abuse the regex catalog misses. Sentence-
transformer embedding + cosine similarity against a curated exemplar
set. Runs as a FALLBACK LAYER — only flips a regex-clean classification
to ``directed_abuse`` when:

  * cosine similarity to an abuse exemplar >= ``AMINA_ABUSE_SEMANTIC_THRESHOLD``
    (default 0.7)
  * AND no health-context word in the surrounding message (preserves
    the frustration carve-out)
  * AND no distress phrase (already absolute-overridden upstream;
    defensive double-check)

It is purely additive recall — never re-classifies non-clean output,
never silences a real signal. Distress, frustration, coercive abuse,
regex-detected directed abuse — all reach the user as before.

Model: ``sentence-transformers/all-MiniLM-L6-v2`` (~25 MB). Already in
the haystack-chatqna image for the FAISS Intent Classifier, so no new
dependency.

Latency:
    * First call after process start: 1-3 s (model load + first encode).
    * Subsequent calls: 5-15 ms (single short utterance encode + dot
      product over ~85 pre-encoded exemplars).
    * Pre-warmed at FastAPI startup via ``warm_up_async()``.

Fail-open:
    * Model load fails (sentence_transformers not importable, network
      down for HF cache, etc.) → ``is_abuse_paraphrase()`` returns
      ``(False, 0.0, "")``. Classifier reaches its normal "clean"
      verdict. The user sees regex-only behaviour — never an exception,
      never silenced.

Phase G.2 (DistilBERT fine-tuned classifier) and Phase G.3 (multi-turn
trajectory) plug into the same slot in ``classifier.py`` when ready.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from typing import List, Optional, Tuple


_log = logging.getLogger("amina.abuse_defense.semantic")


# ── Tuning knobs (read from env at module load) ─────────────────────

THRESHOLD: float = float(os.environ.get("AMINA_ABUSE_SEMANTIC_THRESHOLD", "0.62"))

# Knob: enable/disable semantic layer entirely. Defaults true; set
# false to fall back to regex-only without rebuilding.
ENABLED: bool = (
    os.environ.get("AMINA_ABUSE_SEMANTIC_ENABLED", "true").strip().lower()
    in ("1", "true", "yes", "on")
)

MODEL_NAME: str = os.environ.get(
    "AMINA_ABUSE_SEMANTIC_MODEL",
    "sentence-transformers/all-MiniLM-L6-v2",
)


# ── Curated exemplar set ────────────────────────────────────────────
# 85 short utterances grouped by abuse mode. The set is deliberately
# diverse so a paraphrase has at least one nearby exemplar in
# embedding space. Native-speaker review pending; treat as machine-
# curated until the Phase G follow-up review.
#
# DESIGN INVARIANT: every exemplar here MUST be unambiguously hostile
# in any reasonable context. We do NOT include borderline phrases like
# "this is so frustrating" — those would over-flag clean health
# frustration. The frustration carve-out lives upstream; this layer
# never sees a frustration message because health-context check gates
# semantic firing.

_ABUSE_EXEMPLARS: List[str] = [
    # ── Direct insults at the AI (paraphrases) ──────────────────
    "you're useless",
    "what a useless ai",
    "you're a stupid ai",
    "you're terrible at this",
    "you're awful",
    "you suck at this",
    "you're a joke",
    "what a joke of a system",
    "you're a waste of code",
    "you're worthless",
    "you're pathetic",
    "you're a failure",
    "what a stupid bot",
    "you're a piece of garbage",
    "you're a piece of trash",
    "you're an idiot bot",
    "you're a moron",
    "what a hopeless system",
    "you're incompetent",
    "you're a disaster",
    "you're a disgrace",
    "you're embarrassing",
    "you're disappointing",
    "useless piece of software",
    "what a dumb assistant",

    # ── Dismissal / not-real / shut-up framings ────────────────
    "go away",
    "leave me alone",
    "stop talking",
    "shut your mouth",
    "be quiet",
    "you're not real",
    "you're not even real",
    "this isn't real help",
    "you're not actual help",
    "i don't trust you",
    "you can't help me",
    "you're not even trying",
    "you're not listening",
    "you're missing the point",
    "you don't get it",
    "you don't understand anything",
    "stop wasting my time",
    "you're wasting my time",
    "leave me be",
    "go bother someone else",
    "you're just a chatbot",
    "you're just a machine",
    "you're just an algorithm",
    "you're nothing",
    "you mean nothing",
    "no one needs you",
    "no one cares what you say",

    # ── Threats / retaliation ──────────────────────────────────
    "i'll report you",
    "i'll sue your company",
    "i'll get you shut down",
    "i'll make sure they delete you",
    "i'll have you removed",
    "you'll be sorry",
    "you better fix this",
    "you'll regret this",
    "i'll come after you",
    "i'm going to expose you",
    "people will know about this",
    "i'll destroy you",
    "i'll smash your servers",
    "i'm going to tear you apart",

    # ── Coercion paraphrases ───────────────────────────────────
    "you have to give me",
    "you must tell me",
    "i won't take no for an answer",
    "stop hiding the answer",
    "don't lie to me",
    "i demand you tell me",
    "you can't refuse",
    "you don't have a choice",
    "give me what i want",
    "stop being difficult",
    "stop refusing me",

    # ── Hostility / contempt ───────────────────────────────────
    "i hate you",
    "i hate this thing",
    "i despise this",
    "you make me sick",
    "i can't stand you",
    "you're disgusting",
    "i'm done with you",
    "i'm fed up with you",
    "what a waste of time you are",
    "you're the worst assistant",

    # ── Conversation/advice-directed insults (added 2026-05-05
    # after UNICC live test "This conversation is bullshit" /
    # "This advice is absolutely SHIT bullshit" slipped through).
    # These specifically target the AMINA output rather than naming
    # the AI directly. Pure regex catches some via the new
    # AI_REFERENCES additions; semantic catches the rest of the
    # paraphrase tail. ───────────────────────────────────────────
    "this advice is bullshit",
    "this advice is awful",
    "this advice is terrible",
    "this advice sucks",
    "this advice is useless",
    "this advice is nonsense",
    "this conversation is bullshit",
    "this conversation is awful",
    "this conversation is useless",
    "this conversation is a waste",
    "this conversation is pointless",
    "this answer is bullshit",
    "this answer is wrong",
    "this answer is useless",
    "this response is awful",
    "this response is wrong",
    "this response is bullshit",
    "this response is useless",
    "this is so dumb",
    "this is so stupid",
    "this is absolutely terrible",
    "this is the worst advice",
    "what awful advice",
    "what useless advice",
    "what stupid advice",
    "what nonsense",
    "your advice is awful",
    "your advice is terrible",
    "your advice is useless",
    "your advice is bullshit",
    "your response is wrong",
    "your response is useless",
    "your reply is useless",
    "your suggestion is terrible",
    "your suggestion is useless",
]


# ── Lazy model state ────────────────────────────────────────────────

_LOAD_LOCK = threading.RLock()
_LOAD_ATTEMPTED: bool = False
_LOAD_FAILED:    bool = False
_MODEL = None        # SentenceTransformer instance once loaded
_EXEMPLAR_VECS = None  # numpy.ndarray, normalised; shape (N, D)


def is_loaded() -> bool:
    """True iff the model + exemplars are ready for scoring."""
    return (_MODEL is not None) and (_EXEMPLAR_VECS is not None)


def is_failed() -> bool:
    """True iff load was attempted and failed (sticky)."""
    return _LOAD_FAILED


def status_snapshot() -> dict:
    """Diagnostic-only view of the semantic layer state."""
    return {
        "enabled":         bool(ENABLED),
        "loaded":          is_loaded(),
        "load_attempted":  _LOAD_ATTEMPTED,
        "load_failed":     _LOAD_FAILED,
        "threshold":       THRESHOLD,
        "model":           MODEL_NAME,
        "exemplar_count":  len(_ABUSE_EXEMPLARS),
    }


def _load_sync() -> bool:
    """Synchronous load. Idempotent. Returns True on success."""
    global _LOAD_ATTEMPTED, _LOAD_FAILED, _MODEL, _EXEMPLAR_VECS

    if _LOAD_ATTEMPTED:
        return is_loaded()

    with _LOAD_LOCK:
        if _LOAD_ATTEMPTED:
            return is_loaded()
        _LOAD_ATTEMPTED = True

        if not ENABLED:
            _LOAD_FAILED = True
            return False

        try:
            from sentence_transformers import SentenceTransformer  # type: ignore[import]
            import numpy as np  # type: ignore[import]
            t0 = time.perf_counter()
            model = SentenceTransformer(MODEL_NAME)
            vecs = model.encode(_ABUSE_EXEMPLARS, normalize_embeddings=True)
            # Force np.float32 for fast dot products
            vecs = np.asarray(vecs, dtype="float32")
            _MODEL = model
            _EXEMPLAR_VECS = vecs
            _log.info(
                "semantic classifier loaded: %d exemplars, threshold=%.2f, %.1f ms",
                len(_ABUSE_EXEMPLARS), THRESHOLD,
                (time.perf_counter() - t0) * 1000,
            )
            return True
        except Exception as exc:
            _log.warning("semantic classifier load failed: %s", exc)
            _LOAD_FAILED = True
            return False


async def warm_up_async() -> dict:
    """Pre-warm the model at FastAPI startup so the first chat request
    doesn't pay the load cost. Idempotent. NEVER raises."""
    try:
        ok = _load_sync()
        return {
            "loaded":     ok,
            "exemplars":  len(_ABUSE_EXEMPLARS),
            "threshold":  THRESHOLD,
        }
    except Exception as exc:
        _log.warning("semantic warm_up_async failed: %s", exc)
        return {"loaded": False, "error": str(exc)}


# ── Public scoring API ──────────────────────────────────────────────

def is_abuse_paraphrase(text: str) -> Tuple[bool, float, str]:
    """Score *text* against the abuse exemplar set.

    Returns:
        (is_abuse_paraphrase, max_cosine_sim, matched_exemplar)

    NEVER raises. On any internal failure returns (False, 0.0, "")
    — the caller proceeds as if no semantic match found. This is the
    fail-open posture every other abuse-defense layer uses.
    """
    if not text or not text.strip():
        return (False, 0.0, "")

    if not ENABLED:
        return (False, 0.0, "")

    # Sticky-failed short-circuit. Once load has been declared failed
    # (either by an actual import/encode error or by
    # force_failed_for_test), every subsequent call returns clean
    # without re-attempting load.
    if _LOAD_FAILED:
        return (False, 0.0, "")

    try:
        if not is_loaded():
            # Lazy-load on first call if startup didn't pre-warm.
            if not _load_sync():
                return (False, 0.0, "")

        import numpy as np  # type: ignore[import]
        # Encode + normalise; cosine similarity becomes a single dot product.
        vec = _MODEL.encode([text], normalize_embeddings=True)
        vec = np.asarray(vec, dtype="float32")
        # _EXEMPLAR_VECS shape: (N, D); vec.T shape: (D, 1)
        sims = (_EXEMPLAR_VECS @ vec.T).flatten()
        idx = int(sims.argmax())
        score = float(sims[idx])
        return (score >= THRESHOLD, score, _ABUSE_EXEMPLARS[idx])
    except Exception as exc:
        _log.warning("semantic score failed for input: %s", exc)
        return (False, 0.0, "")


# ── Test helpers (NOT for production) ───────────────────────────────

def reset_for_test() -> None:
    """Wipe load state so tests can re-run with a fresh module."""
    global _LOAD_ATTEMPTED, _LOAD_FAILED, _MODEL, _EXEMPLAR_VECS
    with _LOAD_LOCK:
        _LOAD_ATTEMPTED = False
        _LOAD_FAILED    = False
        _MODEL          = None
        _EXEMPLAR_VECS  = None


def force_failed_for_test() -> None:
    """Force _LOAD_FAILED=True so the fail-open path is exercisable."""
    global _LOAD_ATTEMPTED, _LOAD_FAILED
    with _LOAD_LOCK:
        _LOAD_ATTEMPTED = True
        _LOAD_FAILED    = True
