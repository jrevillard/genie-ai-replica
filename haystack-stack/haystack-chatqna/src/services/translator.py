"""
Translation service — English ↔ Mandinka

Backend selection
-----------------
Controlled by the `USE_GEMMA_TRANSLATOR` env var (default: false → OpenAI).

  USE_GEMMA_TRANSLATOR=false  (default)
      Uses OpenAI gpt-4o-mini. Best for Mandinka quality. Requires
      OPENAI_API_KEY. Data leaves the server to the OpenAI API.

  USE_GEMMA_TRANSLATOR=true
      Uses a self-hosted Gemma model over an OpenAI-compatible endpoint
      (vLLM, TGI, or a Cloudflare tunnel fronting either). Required env:

        GEMMA_BASE_URL    OpenAI-compatible base URL (e.g.
                          "https://gemma-tunnel.trycloudflare.com/v1"
                          or "http://vllm-translation-guardrail:9031/v1")
        GEMMA_MODEL       Model ID. Default: "google/gemma-3-4b-it".
                          Teammate's sprint-21-bug-fixes tested:
                          gemma-3-4b-it (hallucinations on low-resource
                          langs), translategemma-12b-it (best quality
                          that fits a 24 GB GPU), translategemma-27b-it
                          (exceeds A40).
        GEMMA_API_KEY     Optional. Defaults to "not-needed" for
                          anonymous local/tunnel endpoints.

Switching backends is just flipping the env var + restarting the
container. The rest of the app (translator.translate, translate_batch,
PDF pipeline, auto-translator, chat-reply translation) is backend-
agnostic because it only calls `translate()` / `translate_batch()`.

Translations are cached in Redis (30-day TTL) regardless of backend —
the cache key namespace includes the backend name so flipping the
flag doesn't return stale cross-backend results.
"""

import os
from typing import Dict, Optional, List, Any
import hashlib
import json
import logging

from openai import AsyncOpenAI

from src.config import settings

logger = logging.getLogger(__name__)


SUPPORTED_LANGUAGES = {
    "en": "English",
    "ma": "Mandinka",
    # Extend later: "wo": "Wolof", "ff": "Fula"
}


# Backend selection at import time (so it's deterministic per process)
def _use_gemma() -> bool:
    return (os.getenv("USE_GEMMA_TRANSLATOR", "false") or "").lower() in ("1", "true", "yes", "on")


def _gemma_config() -> Dict[str, str]:
    return {
        "base_url": os.getenv("GEMMA_BASE_URL", "http://vllm-translation-guardrail:9031/v1"),
        "model":    os.getenv("GEMMA_MODEL",    "google/gemma-3-4b-it"),
        "api_key":  os.getenv("GEMMA_API_KEY",  "not-needed"),
    }


TRANSLATE_PROMPT_TEMPLATE = """You are a translator between English and Mandinka (a West African
language spoken in The Gambia, Senegal, Guinea-Bissau).

Translate the following text from {source_name} to {target_name}.

Rules:
- Keep health/medical terms simple and understandable to a rural Gambian patient.
- Keep numbers, medication names (metformin, amlodipine...), place names (EFSTH, Banjul), and
  phone numbers (199) unchanged.
- Keep Gambian food names unchanged (benachin, domoda, supakanja, bissap, attaya, bouye).
- Do NOT add explanations. Return ONLY the translated text.
- If the text is already in {target_name}, return it unchanged.

TEXT TO TRANSLATE:
{text}

TRANSLATION ({target_name}):"""


class Translator:
    def __init__(self):
        if _use_gemma():
            cfg = _gemma_config()
            self.client = AsyncOpenAI(
                api_key=cfg["api_key"],
                base_url=cfg["base_url"],
            )
            self.model   = cfg["model"]
            self.backend = "gemma"
            logger.info(
                f"Translator backend: gemma  base_url={cfg['base_url']} model={cfg['model']}"
            )
        else:
            self.client = AsyncOpenAI(
                api_key=settings.OPENAI_API_KEY,
                base_url=settings.OPENAI_BASE_URL,
            )
            self.model   = settings.OPENAI_MODEL
            self.backend = "openai"
            logger.info(f"Translator backend: openai  model={self.model}")
        self._redis = None  # lazy

    @property
    def redis(self):
        if self._redis is None:
            from src.agent.memory_manager import get_memory_manager
            self._redis = get_memory_manager().redis
        return self._redis

    # BUG-018 fix: cache TTL was 30 days. A bad translation that slipped
    # past the repetition guard would then serve to every user for a
    # month. Cap default TTL at 7 days. The repetition guard already
    # catches loops; a shorter TTL bounds the blast radius for anything
    # else (cultural mistranslation, hallucinated diagnosis word, etc.)
    # that isn't loop-shaped.
    _CACHE_TTL_S = 7 * 86400
    # Short TTL for translations that look low-confidence per the
    # length-ratio heuristic in translate(). 1 hour caps the blast
    # radius if the heuristic missed something.
    _CACHE_TTL_FALLBACK_S = 3600

    def _cache_key(self, text: str, source: str, target: str) -> str:
        # BUG-018 fix: full SHA-256 (no truncation) and explicit lang
        # ordering. SHA-1 truncated to 16 hex chars gave 64-bit collision
        # space -- still huge in practice, but birthday-bound collisions
        # would let a malicious or unlucky text serve the wrong cached
        # translation. Full SHA-256 with explicit lang+backend prefix
        # makes cross-language collision impossible by construction.
        h = hashlib.sha256(f"{source}|{target}|{text}".encode("utf-8")).hexdigest()
        # Namespace the cache by backend so switching flags doesn't return
        # stale cross-backend results.
        return f"translate:{self.backend}:{source}:{target}:{h}"

    async def translate(
        self,
        text: str,
        source: str = "en",
        target: str = "ma",
    ) -> str:
        """Translate a single text. Returns the original text if translation fails."""
        if not text or not text.strip():
            return text
        if source == target:
            return text
        if source not in SUPPORTED_LANGUAGES or target not in SUPPORTED_LANGUAGES:
            return text

        # Check cache — also guard cached results against stale loops
        try:
            cached = self.redis.get(self._cache_key(text, source, target))
            if cached:
                try:
                    from src.services.repetition_guard import has_repetition
                    if has_repetition(cached):
                        self.redis.delete(self._cache_key(text, source, target))
                    else:
                        return cached
                except Exception:
                    return cached
        except Exception as e:
            logger.warning(f"Translation cache read failed: {e}")

        # Call LLM
        prompt = TRANSLATE_PROMPT_TEMPLATE.format(
            source_name=SUPPORTED_LANGUAGES[source],
            target_name=SUPPORTED_LANGUAGES[target],
            text=text.strip(),
        )
        try:
            resp = await self.client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2,
                max_tokens=500,
                frequency_penalty=0.5,
                presence_penalty=0.3,
            )
            translated = (resp.choices[0].message.content or "").strip()
            # Strip any quoting the model might add
            translated = translated.strip('"').strip("'").strip()
        except Exception as e:
            logger.error(f"Translation failed: {e}")
            return text

        # Post-translation repetition guard -- catch and truncate LLM
        # loops that slip through even with frequency/presence penalties.
        repetition_clean = True
        try:
            from src.services.repetition_guard import guard_translation, has_repetition
            translated_guarded = guard_translation(translated)
            # Detect whether the guard had to step in. has_repetition()
            # returns True iff loops are still present after guarding;
            # we use that as our cache-quality signal.
            repetition_clean = not has_repetition(translated_guarded)
            translated = translated_guarded
        except Exception as e:
            logger.warning(f"Repetition guard failed (non-fatal): {e}")

        # BUG-018 fix: pre-cache quality gate.
        # We do not have a numeric quality_score here (the corrector
        # produces one, but the corrector runs on the caller side --
        # not in translate()). To approximate the spec's "only cache
        # high-quality translations", refuse to cache when:
        #  (a) the repetition guard had to truncate / still detected
        #      a loop after guarding, or
        #  (b) the output is suspiciously short relative to the input
        #      (likely a refusal / "I cannot translate this" reply).
        # When in doubt, cache for the short fallback TTL only.
        ttl = self._CACHE_TTL_S
        cache_decision = "ok_full_ttl"
        in_len = len(text.strip()) if text else 0
        out_len = len(translated.strip()) if translated else 0
        length_ratio = (out_len / in_len) if in_len > 0 else 0.0

        if not repetition_clean:
            cache_decision = "skip_repetition"
        elif out_len < 4:
            # An empty / one-word translation is almost certainly a
            # failure -- never cache it.
            cache_decision = "skip_too_short"
        elif in_len >= 30 and length_ratio < 0.30:
            # Long source -> tiny target: probably a refusal blurb.
            ttl = self._CACHE_TTL_FALLBACK_S
            cache_decision = "fallback_ttl_low_ratio"
        elif length_ratio > 5.0:
            # Tiny source -> huge target: probably an LLM rant.
            ttl = self._CACHE_TTL_FALLBACK_S
            cache_decision = "fallback_ttl_high_ratio"

        if cache_decision.startswith("skip_"):
            logger.debug("translator: skipping cache write (%s)", cache_decision)
        else:
            try:
                self.redis.setex(self._cache_key(text, source, target), ttl, translated)
                logger.debug("translator: cached (%s, ttl=%ds)", cache_decision, ttl)
            except Exception as e:
                logger.warning(f"Translation cache write failed: {e}")

        return translated

    async def translate_batch(
        self,
        texts: Dict[str, str],
        source: str = "en",
        target: str = "ma",
    ) -> Dict[str, str]:
        """Translate a dict of {key: text} → {key: translated_text}.

        Splits cache hits from cache misses, batches misses into one LLM call.
        """
        if source == target:
            return dict(texts)
        out: Dict[str, str] = {}
        misses: Dict[str, str] = {}

        # Check cache for each
        for key, text in texts.items():
            if not text or not text.strip():
                out[key] = text
                continue
            try:
                cached = self.redis.get(self._cache_key(text, source, target))
                if cached:
                    out[key] = cached
                else:
                    misses[key] = text
            except Exception:
                misses[key] = text

        # If nothing missed, done
        if not misses:
            return out

        # Batch translate misses in ONE LLM call
        numbered = "\n".join(f"[{i+1}] {v}" for i, v in enumerate(misses.values()))
        prompt = f"""You are a translator between {SUPPORTED_LANGUAGES[source]} and {SUPPORTED_LANGUAGES[target]}.

Translate each numbered line below. Keep health terms simple for rural Gambian patients.
Keep medication names, place names, and numbers unchanged.
Return ONLY the translated lines, numbered identically, one per line, nothing else.

LINES:
{numbered}

TRANSLATIONS:"""

        try:
            resp = await self.client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2,
                max_tokens=1500,
                frequency_penalty=0.5,
                presence_penalty=0.3,
            )
            raw = (resp.choices[0].message.content or "").strip()
        except Exception as e:
            logger.error(f"Batch translation failed: {e}")
            # Return originals for misses
            for key, text in misses.items():
                out[key] = text
            return out

        # Parse numbered lines
        import re
        lines = raw.split("\n")
        parsed: Dict[int, str] = {}
        for line in lines:
            m = re.match(r"^\s*\[(\d+)\]\s*(.+)$", line)
            if m:
                parsed[int(m.group(1))] = m.group(2).strip()

        keys = list(misses.keys())
        for i, key in enumerate(keys):
            translated = parsed.get(i + 1, misses[key])
            out[key] = translated
            # BUG-018 fix: 7-day TTL (was 30). See _CACHE_TTL_S.
            try:
                self.redis.setex(
                    self._cache_key(misses[key], source, target),
                    self._CACHE_TTL_S,
                    translated,
                )
            except Exception:
                pass

        return out

    # ═══════════════════════════════════════════════════════════════════
    # MANDINKA DETECTION — calibrated probability scoring
    # ═══════════════════════════════════════════════════════════════════
    #
    # We combine 4 orthogonal signals and compute a calibrated probability
    # that the user INTENDS to communicate in Mandinka:
    #
    #   1. Diacritics    — special chars ŋ ñ ɛ ɔ ɲ (very strong)
    #   2. Lexical       — Mandinka vocabulary in Latin transliteration
    #   3. English ratio — density of common English words (counter-signal)
    #   4. Length penalty — very short msgs need more evidence
    #
    # Final probability is the logistic of a weighted sum, calibrated so
    # that typical Gambian patient messages land in the right bucket:
    #
    #   p < 0.35  → English, no prompt
    #   p 0.35-0.60 → Unclear, no prompt (avoid false positives)
    #   p > 0.60  → Mandinka, prompt the user ONCE to switch
    #
    # The prompt threshold is INTENTIONALLY high. A false positive means
    # asking an English speaker to switch — annoying. A false negative
    # means we miss an offer — patient can always switch manually.

    # Tier 1: distinctive Mandinka characters (diacritics)
    # Each occurrence adds strong evidence — these don't exist in English.
    _MA_DIACRITICS = {"ŋ", "ñ", "ɛ", "ɔ", "ɲ"}

    # Tier 2: highly-distinctive Mandinka words (rare/absent in English health chat)
    _MA_STRONG_WORDS = {
        # Greetings (extremely distinctive)
        "isama", "itilii", "iwulaara", "abaraka", "ibaarake", "kayira",
        "nyaading", "ñaading",
        # Pronouns + copula (these appear constantly in Mandinka)
        "i mbe", "i be", "nte", "ite", "ate", "ntolu", "itolu", "ŋa", "nga",
        # Health vocabulary
        "saraabu", "kuurango", "kuuraŋo", "kuuraa", "dookuwo", "tuntuŋo",
        "jarabi", "jaatoo",
        # Cultural nouns
        "bantaba", "alkallo", "alkalo", "marabout", "marabu",
        # Family terms (used as forms of address)
        "ñaamaa", "nyaamaa",
        # Question / negation markers
        "fo le", "hani", "mbalu",
    }

    # Tier 3: less-distinctive Mandinka words (can appear in English too — weaker)
    _MA_WEAK_WORDS = {
        "jang", "jaŋ", "mba", "mfa", "suu", "jusu",
        "banko", "banku", "saloo", "tiloo", "suutoo",
        "fanaa", "fanang", "mennu", "baake", "domaŋ", "domandiŋ",
        "tonong", "tondo",
    }

    # High-frequency English words — strong counter-signal
    _EN_COMMON_WORDS = {
        "the", "and", "is", "are", "have", "has", "my", "me", "i", "you",
        "your", "please", "what", "when", "where", "why", "how", "can", "do",
        "does", "don't", "doctor", "nurse", "medicine", "pain", "feel", "feeling",
        "blood", "sugar", "pressure", "take", "taking", "need", "want", "help",
        "tell", "should", "would", "could", "about", "for", "with", "from",
        "this", "that", "not", "but", "one", "two", "day", "days", "week",
    }

    # English bigrams that strongly suggest an English intent
    _EN_STRONG_BIGRAMS = [
        "i have", "my bp", "my blood", "my sugar", "i feel", "i'm feeling",
        "the doctor", "my medicine", "my medication", "i was prescribed",
        "how do i", "what should", "can you", "tell me", "please help",
    ]

    def detect_language(self, text: str) -> str:
        """Quick classifier — used for informational hints. Returns 'ma' | 'en'."""
        if not text or not text.strip():
            return "en"
        p = self._mandinka_probability(text)
        return "ma" if p >= 0.50 else "en"

    def detect_mandinka_intent(self, text: str) -> Dict[str, Any]:
        """Calibrated probability that the user intends to communicate in Mandinka.

        Returns:
          {
            "is_mandinka_intent": bool,    # p >= 0.60 → confident enough to prompt
            "probability": float,          # 0.0–1.0 calibrated confidence
            "confidence": str,             # "low" | "medium" | "high"
            "signals": {
              "diacritics": int,           # count of ŋ ñ ɛ ɔ ɲ
              "strong_ma_words": List[str],
              "weak_ma_words": List[str],
              "en_words": int,
              "en_bigrams": int,
              "word_count": int,
            },
          }
        """
        if not text or not text.strip():
            return self._empty_intent()

        signals = self._extract_signals(text)
        probability = self._mandinka_probability(text, signals=signals)

        if probability >= 0.75:
            confidence = "high"
        elif probability >= 0.50:
            confidence = "medium"
        else:
            confidence = "low"

        return {
            "is_mandinka_intent": probability >= 0.60,
            "probability": round(probability, 3),
            "confidence": confidence,
            "signals": signals,
        }

    # ── internals ────────────────────────────────────────────────────
    def _empty_intent(self) -> Dict[str, Any]:
        return {
            "is_mandinka_intent": False,
            "probability": 0.0,
            "confidence": "low",
            "signals": {
                "diacritics": 0, "strong_ma_words": [], "weak_ma_words": [],
                "en_words": 0, "en_bigrams": 0, "word_count": 0,
            },
        }

    def _extract_signals(self, text: str) -> Dict[str, Any]:
        tl = text.lower()
        # Tokenize on word boundaries (keeps Mandinka diacritics)
        import re
        tokens = re.findall(r"[a-zA-Z\u014b\u00f1\u025b\u0254\u0272'\u2019]+", tl)
        token_set = set(tokens)
        word_count = len(tokens)

        diacritic_count = sum(tl.count(c) for c in self._MA_DIACRITICS)
        strong_hits = sorted(token_set & self._MA_STRONG_WORDS)
        weak_hits = sorted(token_set & self._MA_WEAK_WORDS)
        en_hits = len(token_set & self._EN_COMMON_WORDS)
        en_bigram_hits = sum(1 for b in self._EN_STRONG_BIGRAMS if b in tl)

        # Multi-word strong phrases ("i mbe", "fo le", "i be")
        for phrase in ("i mbe", "i be", "fo le"):
            if phrase in tl:
                strong_hits.append(phrase)

        return {
            "diacritics": diacritic_count,
            "strong_ma_words": strong_hits[:10],
            "weak_ma_words": weak_hits[:10],
            "en_words": en_hits,
            "en_bigrams": en_bigram_hits,
            "word_count": word_count,
        }

    def _mandinka_probability(
        self, text: str, signals: Optional[Dict[str, Any]] = None,
    ) -> float:
        """Calibrated probability the user intends Mandinka.

        Uses a weighted log-odds (logistic) model. Weights were calibrated
        by hand against a few dozen realistic Gambian patient messages.
        """
        if signals is None:
            signals = self._extract_signals(text)

        word_count = signals["word_count"]
        if word_count == 0:
            return 0.0

        # Weighted evidence (log-odds units)
        # POSITIVE (Mandinka):
        #   - diacritic: +3.0 each (very strong)
        #   - strong MA word: +2.0 each
        #   - weak MA word: +0.8 each
        # NEGATIVE (English):
        #   - EN bigram (very specific): -1.5 each
        #   - EN common word: -0.3 per unique hit (capped)
        # Prior (bias): -1.5 (baseline assumption: patient is writing English)

        logit = -1.5
        logit += 3.0 * signals["diacritics"]
        logit += 2.0 * len(signals["strong_ma_words"])
        logit += 0.8 * len(signals["weak_ma_words"])
        logit -= 1.5 * signals["en_bigrams"]
        logit -= 0.3 * min(signals["en_words"], 8)  # cap EN penalty at ~2.4

        # Length adjustment: short messages get a small damping toward 0.5
        # so we need strong evidence to declare intent on 1-3 word messages.
        if word_count <= 2:
            logit *= 0.5
        elif word_count <= 4:
            logit *= 0.75

        # Logistic squash to 0..1
        import math
        try:
            probability = 1.0 / (1.0 + math.exp(-logit))
        except OverflowError:
            probability = 0.0 if logit < 0 else 1.0

        return probability


# Singleton
_translator: Optional[Translator] = None


def get_translator() -> Translator:
    global _translator
    if _translator is None:
        _translator = Translator()
    return _translator
