"""
AMINA Care — Model Fallback Chain
====================================
Pure logic: given a starting model and the current Redis health snapshot,
produce an ordered list of candidate models to try. The resilience route
iterates this list, invokes /api/v1/agent/chat with each, and records the
first one that returns a valid response.

The chain is intentionally deterministic and observable. We do NOT use
weighted random picks or latency-based selection — the health signal is
already monotonic ("down for N more seconds"), and random choice would
make outages hard to debug during the UNICC demo.

Chain configuration
-------------------
Default: `amina, base, gemini, groq, mistral`

Override via env var `MODEL_FALLBACK_CHAIN`, comma-separated, same vocab as
the agent (`amina`, `base`, `gemini`, `groq`, `mistral`). Unknown tokens are
dropped silently so a typo can't lock out valid models.

If the caller supplies a `preferred` model that IS part of the chain, it is
rotated to the front. This preserves user choice while still falling through
to alternatives when their primary is down.

Tokens / BILLING errors do NOT disable a model here — the health module
already refuses to persist them as circuit trips. We still defend against
someone passing a TOKEN-classed error directly into `pick_next` by filtering
it to "leave the chain unchanged".
"""

from __future__ import annotations

import logging
import os
from typing import List, Optional

from src.services import model_health

logger = logging.getLogger(__name__)

# Valid agent-side identifiers. Matches the if/elif chain in amina_agent.py.
KNOWN_MODELS: List[str] = ["amina", "base", "gemini", "groq", "mistral"]

DEFAULT_CHAIN_ORDER: List[str] = ["amina", "base", "gemini", "groq", "mistral"]


def configured_chain() -> List[str]:
    """Read the env override, filter against KNOWN_MODELS, dedupe."""
    raw = os.getenv("MODEL_FALLBACK_CHAIN", "").strip()
    if not raw:
        return list(DEFAULT_CHAIN_ORDER)
    out: List[str] = []
    seen = set()
    for tok in raw.split(","):
        m = tok.strip().lower()
        if m and m in KNOWN_MODELS and m not in seen:
            out.append(m)
            seen.add(m)
    return out or list(DEFAULT_CHAIN_ORDER)


def chain_for(preferred: Optional[str] = None) -> List[str]:
    """
    Return a deduped ordered chain. If `preferred` is known, it becomes the
    first element (others follow in configured order).
    """
    chain = configured_chain()
    pref  = (preferred or "").strip().lower()
    if pref and pref in chain:
        chain = [pref] + [m for m in chain if m != pref]
    return chain


def live_chain(preferred: Optional[str] = None) -> List[str]:
    """Chain filtered by circuit-breaker health. Models in cooldown are dropped."""
    return [m for m in chain_for(preferred) if model_health.is_model_live(m)]


def fallback_order(preferred: Optional[str] = None) -> dict:
    """Observability helper used by /models/status to debug priorities."""
    full = chain_for(preferred)
    live = [m for m in full if model_health.is_model_live(m)]
    return {
        "preferred":     (preferred or "").strip().lower() or None,
        "chain":         full,
        "live_order":    live,
        "cooldown":      [m for m in full if m not in live],
    }
