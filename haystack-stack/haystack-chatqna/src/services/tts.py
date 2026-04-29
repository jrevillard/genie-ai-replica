# src/services/tts.py

"""
TTS language dispatcher.

Single entry point for every surface (chat reply audio, IVR playback,
voice-note attachments) that wants Amina to speak. Dispatches to the
right back-end by language:

    ┌──────────────────────┬───────────────────────────────────────┐
    │ language              │ backend                               │
    ├──────────────────────┼───────────────────────────────────────┤
    │ en (default)          │ Piper via tts_piper.py → voice-tts    │
    │ ma / mnk / mandinka   │ MMS  via tts_mms.py   → voice-tts-mnk │
    └──────────────────────┴───────────────────────────────────────┘

Callers stay language-agnostic:

    from src.services.tts import synthesize
    wav = await synthesize("Hello, how are you feeling today?", lang="en")
    wav = await synthesize("Salaam, i be nyaadi?",              lang="ma")

Legacy callers that still hit tts_piper.synthesize() directly keep
working — this dispatcher is purely additive.
"""

import logging
from typing import Optional

from src.services import tts_piper, tts_mms

log = logging.getLogger("tts")


# Aliases → canonical backend id. Keep this liberal so upstream callers
# (agent, translator, IVR) don't all have to agree on the same code.
_MANDINKA_ALIASES = {
    "ma", "mnk", "mandinka", "mand", "man", "mnk_latn", "mnk-latn",
}
_ENGLISH_ALIASES = {
    "en", "eng", "english", "en_us", "en-us", "en_gb", "en-gb",
}


def _normalise(lang: Optional[str]) -> str:
    """Return 'ma', 'en', or 'unknown' for any input form."""
    raw = (lang or "").strip().lower()
    if not raw:
        return "en"
    if raw in _MANDINKA_ALIASES: return "ma"
    if raw in _ENGLISH_ALIASES:  return "en"
    return "unknown"


async def _ensure_mandinka(text: str, source_lang: str = "en") -> str:
    """Translate incoming text to Mandinka if it isn't already. Uses the
    existing services.translator singleton (Redis-cached) so repeat
    requests skip the LLM round-trip. Falls back to the original text on
    any failure — MMS will still synthesise something reasonable."""
    if _normalise(source_lang) == "ma":
        return text
    try:
        from src.services.translator import get_translator
        tr = get_translator()
        translated = await tr.translate(text, source="en", target="ma")
        return (translated or text).strip() or text
    except Exception as e:
        log.warning("tts_pretranslate_failed — using raw text. err=%s", e)
        return text


async def synthesize(text: str, lang: str = "en", source_lang: str = "en") -> Optional[bytes]:
    """Text → WAV bytes. Returns None if the text is empty or the backend
    errored — callers should treat None as "no audio available, continue
    without it" rather than a hard failure.

    If `lang` is Mandinka and the incoming `text` is English (the common
    case from the chat UI), we route it through the translator first so
    MMS synthesises the Mandinka rendition. Callers that already hold
    Mandinka text can pass `source_lang="ma"` to skip translation."""
    text = (text or "").strip()
    if not text:
        return None

    canonical = _normalise(lang)
    if canonical == "ma":
        ma_text = await _ensure_mandinka(text, source_lang)
        return await tts_mms.synthesize(ma_text)
    if canonical == "en":
        return await tts_piper.synthesize(text)

    log.warning("tts_unsupported_lang lang=%r — falling back to English", lang)
    return await tts_piper.synthesize(text)


async def synthesize_ogg(text: str, lang: str = "en", source_lang: str = "en") -> Optional[bytes]:
    """Text → OGG Opus bytes. For IVR, Telegram and WhatsApp voice notes."""
    text = (text or "").strip()
    if not text:
        return None

    canonical = _normalise(lang)
    if canonical == "ma":
        ma_text = await _ensure_mandinka(text, source_lang)
        return await tts_mms.synthesize_ogg(ma_text)
    if canonical == "en":
        return await tts_piper.synthesize_ogg(text)

    log.warning("tts_ogg_unsupported_lang lang=%r — falling back to English", lang)
    return await tts_piper.synthesize_ogg(text)


async def health() -> dict:
    """Aggregated readiness probe for both back-ends. Useful for the
    admin console + /health endpoints that want to surface which voice
    channels are live."""
    import asyncio

    # Piper doesn't currently expose a health helper; call its URL directly.
    import os, httpx
    piper_url = os.environ.get("TTS_URL", "http://voice-tts:5500").rstrip("/")

    async def _piper_health() -> dict:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(f"{piper_url}/health")
            return r.json() if r.status_code == 200 else {
                "status": "error", "http_status": r.status_code,
            }
        except Exception as e:
            return {"status": "unreachable", "error": str(e)}

    piper, mms = await asyncio.gather(_piper_health(), tts_mms.health())
    return {
        "english":  piper,
        "mandinka": mms,
        "ready":    (piper.get("status") == "ok"
                     and mms.get("status") == "ok"),
    }
