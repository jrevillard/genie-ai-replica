"""Stage 3 -- Bambara -> Gambian Mandinka lexical adaptation.

NLLB-200 outputs Bambara; this stage converts that Bambara to
Gambian Mandinka. Bambara and Mandinka share ~65% vocabulary, the
same SOV word order, the same noun-class system, and the same tense
markers. Differences are mostly LEXICAL (different words for the
same concept) and PHONOLOGICAL (vowel and consonant rules).

We reuse ``MandingTransferBridge._bambara_to_mandinka`` from
``src/nlp/manding_transfer.py``. That method is "private" by Python
convention but it is the cleanest way to get just the lexical step
without dragging the bridge's local NLLB weights into our process
(we already have the NLLB sidecar for that). If the bridge is not
importable (e.g., transformers not installed in this environment),
we fall back to a small inline lexicon + the same vowel rules.

Stage 3 only runs when Stage 2 picked the NLLB engine for the
sentence. When the phrasebank or LLM engine wins, the output is
already Mandinka and Stage 3 is skipped.
"""
from __future__ import annotations

import logging
import re
import time
from typing import Any, Dict, List, Optional, Tuple

from . import config

logger = logging.getLogger(__name__)


# Inline fallback lexicon (used only when manding_transfer is missing).
# Kept short on purpose -- the real 200+ entry table lives in
# manding_transfer.BAMBARA_TO_MANDINKA. This subset covers the most
# common medical / daily words so the pipeline degrades gracefully
# rather than emitting raw Bambara.
_FALLBACK_LEXICON: Dict[str, str] = {
    "dumuni":       "domoroo",
    "bana":         "kuuraŋo",
    "mɔgɔ":         "moo",
    "sugu":         "bitiki",
    "dɔgɔtɔrɔ":     "dokitaroo",
    "dɔgɔtɔrɔso":   "ospitaali",
    "furakɛli":     "furaŋo",
    "kɔsɔbɛ":       "kojugu",
    "waati":        "waxtoo",
    "tile":         "tileelo",
    "suu":          "suwo",
    "dugu":         "saatee",
    "den":          "diŋo",
    "muso":         "musoo",
    "cɛ":           "kee",
    "so":           "buŋo",
    "kɛnɛ":         "kendeyaa",
    "dɔn":          "loŋ",
    "ji":           "jii",
    "kɔnɔ":         "kono",
}

# Phonological rules applied after lexical substitution. These are
# regular sound correspondences between Bambara and Gambian Mandinka.
_FALLBACK_SOUND_RULES: List[Tuple[str, str]] = [
    ("ɔ", "o"),
    ("ɛ", "e"),
]


class BambaraMandinkaAdapter:
    """Stage 3 entry point. ``adapt(bambara_text)`` returns a result dict."""

    def __init__(self) -> None:
        self._bridge = None             # cached bridge instance or False
        self._temporal = None           # cached MandinkaTemporal or False

    # ── manding_transfer bridge (preferred path) ────────────────────

    def _get_bridge(self):
        if self._bridge is not None:
            return self._bridge if self._bridge is not False else None
        try:
            from src.nlp.manding_transfer import MandingTransferBridge
            self._bridge = MandingTransferBridge()
            logger.info("v4.2.stage3: MandingTransferBridge loaded")
        except Exception as e:
            logger.warning(
                "v4.2.stage3: MandingTransferBridge unavailable (%s) -- using inline fallback",
                e,
            )
            self._bridge = False
            return None
        return self._bridge

    # ── ŋ normalisation (best-effort, never blocks) ─────────────────

    def _get_temporal(self):
        if self._temporal is not None:
            return self._temporal if self._temporal is not False else None
        try:
            from src.nlp.mandinka_temporal import get_temporal
            self._temporal = get_temporal()
        except Exception as e:
            logger.debug("v4.2.stage3: mandinka_temporal not loaded (%s)", e)
            self._temporal = False
            return None
        return self._temporal

    # ── inline fallback ─────────────────────────────────────────────

    def _basic_adaptation(self, bambara_text: str) -> Tuple[str, int]:
        """Returns (mandinka_text, substitutions_applied)."""
        text = bambara_text or ""
        applied = 0
        # Multi-word entries first (none in fallback today, but the
        # sort is harmless and protects future additions).
        for bam in sorted(_FALLBACK_LEXICON.keys(), key=len, reverse=True):
            mand = _FALLBACK_LEXICON[bam]
            pattern = re.compile(re.escape(bam), re.IGNORECASE)
            new_text, n = pattern.subn(mand, text)
            applied += n
            text = new_text
        for old, new in _FALLBACK_SOUND_RULES:
            text = text.replace(old, new)
        return text, applied

    # ── public API ──────────────────────────────────────────────────

    async def adapt(self, bambara_text: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        started = time.perf_counter()
        result: Dict[str, Any] = {
            "mandinka_text":            bambara_text or "",
            "adaptations_applied":      0,
            "method":                   "passthrough",
            "confidence":               0.5,
            "latency_ms":               0,
        }

        if not config.BAMBARA_ADAPTER_ENABLED or not (bambara_text or "").strip():
            result["latency_ms"] = int((time.perf_counter() - started) * 1000)
            return result

        # Path 1: MandingTransferBridge._bambara_to_mandinka (preferred).
        bridge = self._get_bridge()
        if bridge is not None and hasattr(bridge, "_bambara_to_mandinka"):
            try:
                adapted_text, subs = bridge._bambara_to_mandinka(bambara_text)
                result["mandinka_text"]         = adapted_text
                result["adaptations_applied"]   = len(subs or [])
                result["method"]                = "manding_transfer_bridge"
                result["confidence"]            = 0.78
            except Exception as e:
                logger.warning(
                    "v4.2.stage3: bridge._bambara_to_mandinka raised (%s: %s) -- using fallback",
                    type(e).__name__, e,
                )
                bridge = None  # force fallback below
        # Path 2: inline lexicon + sound rules.
        if result["method"] == "passthrough":
            adapted_text, n = self._basic_adaptation(bambara_text)
            result["mandinka_text"]         = adapted_text
            result["adaptations_applied"]   = n
            result["method"]                = "inline_fallback"
            result["confidence"]            = 0.55 if n else 0.45

        # Best-effort ŋ normalisation. Failure here never matters.
        temporal = self._get_temporal()
        if temporal is not None:
            try:
                tr = temporal.process_temporal(result["mandinka_text"])
                if isinstance(tr, dict) and tr.get("processed_text"):
                    result["mandinka_text"] = tr["processed_text"]
            except Exception as e:
                logger.debug("v4.2.stage3: temporal.process_temporal failed: %s", e)

        result["latency_ms"] = int((time.perf_counter() - started) * 1000)
        return result
