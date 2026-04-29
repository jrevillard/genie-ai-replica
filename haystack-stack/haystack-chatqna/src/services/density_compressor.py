"""
Density Compression — Gap 7 Bridge.

Replaces the hard 80-word cap with a post-generation density pass.
Instead of lobotomizing every response to 80 words (preventing emotional
presence when it matters), we measure density and compress only when
the response contains filler.

    A 200-word response that's all substance → passes
    A 60-word response with filler → gets compressed
    Every sentence must earn its place

The density rule: no sign-offs, no filler phrases, no hedging that
adds words without information. Length is allowed when it carries
clinical or emotional substance.

Gate: settings.USE_DENSITY_COMPRESSION (default false).
When false, word limits remain advisory via prompt instruction only.

Architecture:
  1. After response generation, run deterministic filler detection
  2. Strip known filler phrases (fast, zero latency)
  3. Measure density: (content sentences / total sentences)
  4. If density ratio < threshold, compress via small LLM call
  5. Return cleaned response
"""

from __future__ import annotations

import logging
import re
from typing import List, Optional, Tuple

from src.config import settings

logger = logging.getLogger(__name__)

_ENABLED = settings.USE_DENSITY_COMPRESSION


# ── Filler patterns (deterministic stripping) ──────────────────────────
# These are phrases that add words without information. They get stripped
# before density measurement.

_FILLER_PHRASES = [
    # Hedging openers
    r"^I understand (?:your|that|how) (?:concern|worry|situation|feelings?)\.\s*",
    r"^That's a (?:great|good|important|valid) (?:question|concern|point)\.\s*",
    r"^Thank you for (?:sharing|telling me|asking|reaching out)\.\s*",
    r"^I appreciate you (?:sharing|telling me|asking)\.\s*",
    r"^I'm glad you (?:asked|reached out|shared)\.\s*",
    r"^I hear you\.\s*",

    # Filler mid-sentence
    r"\bIt'?s important to (?:note|remember|understand) that\b",
    r"\bAs (?:a|your) (?:community )?health worker,? I\b",
    r"\bPlease (?:do )?(?:not |don'?t )?hesitate to\b",
    r"\bI would (?:like to |want to )?(?:encourage|suggest|recommend) (?:that )?you\b",
    r"\bRemember,? you are not alone\b",

    # Sign-offs (almost always filler in a health response)
    r"\s*(?:Stay well|Take care|Be well|God bless|Stay safe|Stay strong)\s*\.?\s*$",
    r"\s*(?:I'?m here (?:for you|if you need me|whenever you need))\s*\.?\s*$",
    r"\s*(?:Don'?t hesitate to (?:ask|reach out|contact))\s*\.?\s*$",
    r"\s*(?:Wishing you (?:good health|well|the best))\s*\.?\s*$",
    r"\s*(?:May (?:Allah|God) (?:bless|heal|protect|guide) (?:you|her|him))\s*\.?\s*$",
    r"\s*(?:You'?re (?:doing great|doing well|in good hands))\s*\.?\s*$",
    r"\s*(?:Keep up the (?:good|great) work)\s*\.?\s*$",
]

# Compiled patterns for performance
_FILLER_COMPILED = [re.compile(p, re.IGNORECASE | re.MULTILINE) for p in _FILLER_PHRASES]

# Redundant sentence patterns (sentences that repeat what was just said)
_REDUNDANT_PATTERNS = [
    r"(?:As I mentioned|As I said|Like I said|As we discussed)",
    r"(?:Again|Once again|To reiterate|To repeat)",
    r"(?:In other words|What I mean is|To put it another way)",
]
_REDUNDANT_COMPILED = [re.compile(p, re.IGNORECASE) for p in _REDUNDANT_PATTERNS]


# ── Density measurement ───────────────────────────────────────────────

def _split_sentences(text: str) -> List[str]:
    """Split text into sentences. Handles common abbreviations."""
    # Don't split on abbreviations or decimal numbers
    text = re.sub(r"(\d)\.", r"\1<DOT>", text)
    text = re.sub(r"\b(Dr|Mr|Mrs|Ms|vs|etc|e\.g|i\.e)\.", r"\1<DOT>", text, flags=re.IGNORECASE)

    parts = re.split(r"(?<=[.!?])\s+", text)

    result = []
    for p in parts:
        p = p.replace("<DOT>", ".").strip()
        if p:
            result.append(p)
    return result


def _is_filler_sentence(sentence: str) -> bool:
    """Check if a sentence is primarily filler."""
    s = sentence.strip()
    if not s:
        return True

    # Very short sentences that are just pleasantries
    if len(s.split()) <= 3 and any(w in s.lower() for w in [
        "okay", "alright", "sure", "right", "good", "well",
    ]):
        return True

    # Check against redundant patterns
    for pattern in _REDUNDANT_COMPILED:
        if pattern.search(s):
            return True

    return False


def _measure_density(text: str) -> Tuple[float, int, int]:
    """Measure text density: ratio of content sentences to total sentences.

    Returns (density_ratio, content_count, total_count).
    density_ratio of 1.0 = perfectly dense, 0.0 = all filler.
    """
    sentences = _split_sentences(text)
    if not sentences:
        return 1.0, 0, 0

    total = len(sentences)
    filler = sum(1 for s in sentences if _is_filler_sentence(s))
    content = total - filler

    return (content / total) if total > 0 else 1.0, content, total


# ── Deterministic stripping ───────────────────────────────────────────

def strip_filler(text: str) -> str:
    """Remove known filler phrases from text. Fast, deterministic, zero latency."""
    result = text

    for pattern in _FILLER_COMPILED:
        result = pattern.sub("", result)

    # Clean up whitespace artifacts
    result = re.sub(r"\n{3,}", "\n\n", result)
    result = re.sub(r"  +", " ", result)
    result = result.strip()

    # Capitalize first letter if it got lowercased after stripping opener
    if result and result[0].islower():
        result = result[0].upper() + result[1:]

    return result


# ── LLM compression (for responses that need more than filler stripping) ─

_COMPRESS_PROMPT = """Compress this healthcare response. Remove ALL filler — every sentence must add clinical or emotional substance. Keep the same medical content and tone.

ORIGINAL ({word_count} words):
"{response}"

TARGET: Under {target_words} words. No sign-offs, no hedging, no "I understand your concern." Keep specific medical advice, specific numbers, specific instructions. If emotional presence matters, keep it — but earn every sentence.

COMPRESSED:"""


async def _llm_compress(text: str, target_words: int) -> Optional[str]:
    """Use a small LLM to compress when deterministic stripping isn't enough."""
    from openai import AsyncOpenAI

    word_count = len(text.split())
    prompt = _COMPRESS_PROMPT.format(
        response=text[:2000],
        word_count=word_count,
        target_words=target_words,
    )

    clients = []
    if settings.GOOGLE_API_KEY:
        clients.append((
            AsyncOpenAI(api_key=settings.GOOGLE_API_KEY, base_url=settings.GEMINI_BASE_URL),
            "gemini-2.0-flash-lite",
        ))
    if settings.GROQ_API_KEY:
        clients.append((
            AsyncOpenAI(api_key=settings.GROQ_API_KEY, base_url=settings.GROQ_BASE_URL),
            settings.GROQ_MODEL,
        ))
    if settings.OPENAI_API_KEY:
        clients.append((
            AsyncOpenAI(api_key=settings.OPENAI_API_KEY, base_url=settings.OPENAI_BASE_URL),
            "gpt-4o-mini",
        ))

    for client, model in clients:
        try:
            completion = await client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=300,
            )
            result = (completion.choices[0].message.content or "").strip()
            if result.startswith('"'):
                result = result.strip('"')
            if result:
                return result
        except Exception as e:
            logger.debug(f"density_compressor: LLM compress failed with {model}: {e}")
            continue

    return None


# ── Shape-aware word budgets ──────────────────────────────────────────
# These are soft budgets — substance is allowed to exceed them slightly.
# They replace the hard 80-word cap with shape-aware density targets.

_SHAPE_BUDGETS = {
    "GREETING_FULL": 90,
    "GREETING_BRIEF": 70,
    "ACKNOWLEDGE_ENGAGE": 90,
    "STRAIGHT_TO_CONCERN": 120,
    "EMERGENCY": 140,
    "EMPATHY_FIRST": 180,
    "CLOSING": 90,
}

_DEFAULT_BUDGET = 100
_DENSITY_THRESHOLD = 0.6  # Below this, response needs compression
_OVERAGE_MULTIPLIER = 1.5  # Allow up to 1.5x budget if dense


# ── Public API ─────────────────────────────────────────────────────────

async def compress_if_needed(
    response: str,
    response_shape: Optional[str] = None,
) -> str:
    """Post-generation density pass.

    1. Strip known filler (deterministic, <1ms)
    2. Measure density
    3. If over budget AND low density → LLM compress
    4. If over budget BUT high density → allow (substance earns space)

    When flag is off, returns response unchanged.
    """
    if not _ENABLED:
        return response

    if not response or len(response) < 30:
        return response

    # Step 1: Deterministic filler stripping
    cleaned = strip_filler(response)

    # Step 2: Measure density
    density, content_count, total_count = _measure_density(cleaned)
    word_count = len(cleaned.split())

    budget = _SHAPE_BUDGETS.get(response_shape or "", _DEFAULT_BUDGET)
    hard_cap = int(budget * _OVERAGE_MULTIPLIER)

    logger.debug(
        f"density_compressor: {word_count} words, density={density:.2f}, "
        f"budget={budget}, shape={response_shape}"
    )

    # Under budget → always pass
    if word_count <= budget:
        return cleaned

    # Over budget but highly dense → allow up to hard cap
    if density >= 0.8 and word_count <= hard_cap:
        logger.debug(f"density_compressor: over budget but dense ({density:.2f}), allowing")
        return cleaned

    # Over budget and low density → LLM compress
    if density < _DENSITY_THRESHOLD or word_count > hard_cap:
        compressed = await _llm_compress(cleaned, budget)
        if compressed:
            compressed_words = len(compressed.split())
            logger.info(
                f"density_compressor: compressed {word_count} → {compressed_words} words "
                f"(density was {density:.2f})"
            )
            return compressed

    # Moderate density, moderately over budget — strip and return
    # (deterministic stripping already happened, this is the best we can do
    # without an LLM call)
    return cleaned
