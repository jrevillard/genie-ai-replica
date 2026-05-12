"""
tts_mandinka_fix — robust Mandinka synthesis path (additive overlay).

Purpose
-------
The existing dispatcher in src/services/tts.py has two silent-failure modes
that together look like "Mandinka TTS is broken":

  1. _ensure_mandinka() catches every translator exception and returns the
     *original English* text. MMS-TTS-MNK (facebook/mms-tts-mnk) then
     synthesises English phonemes through a Mandinka voice model and the
     result sounds garbled — users report "it's not translating".

  2. tts_mms.synthesize() uses a 30s HTTP timeout. The VITS model takes
     ~25-60s to load on first hit (CPU, ~150 MB weights). The first
     Mandinka request after container boot therefore times out and the
     user sees a generic 500 with no diagnostic.

This module provides a strict replacement that:
  - Fails LOUD when the translator is unavailable (returns a structured
    error instead of synthesising English as Mandinka).
  - Retries MMS on 503 / connection errors with a progressive back-off so
    the cold-start case self-heals on the 2nd attempt.
  - Logs every hop so ops can see which leg of the pipeline failed.

The fix is wired in by src/main_with_tts_mandinka_fix.py — it monkey-
patches src.services.tts.synthesize so the existing /api/v1/tts route
keeps its public contract unchanged.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
from typing import Optional, Tuple

import httpx

log = logging.getLogger("tts_mandinka_fix")


# ── Tunables (env-overridable, with sane defaults) ───────────────────
# First MMS request after boot loads the VITS model; allow generous time.
MMS_TIMEOUT_SECONDS    = float(os.environ.get("MMS_TTS_TIMEOUT_SECONDS", "90"))
# Two retries covers: (a) cold start, (b) transient network blip.
MMS_MAX_RETRIES        = int(os.environ.get("MMS_TTS_MAX_RETRIES", "2"))
MMS_RETRY_BACKOFF_SECS = float(os.environ.get("MMS_TTS_RETRY_BACKOFF", "3.0"))
# When true, refuse to synthesise English as Mandinka on translator
# failure. Recommended. Set to "false" to restore the legacy "synthesise
# whatever we have" behaviour.
STRICT_TRANSLATION     = (os.environ.get("MMS_TTS_STRICT_TRANSLATION", "true")
                          or "").lower() in ("1", "true", "yes", "on")


class MandinkaTTSError(RuntimeError):
    """Raised when the Mandinka pipeline fails in a way callers should see.

    Carries a ``stage`` so the /tts route can translate it into a useful
    HTTP status + body (translator_failed → 502, mms_failed → 503, etc.)
    instead of a blanket 500.
    """
    def __init__(self, stage: str, detail: str):
        super().__init__(f"{stage}: {detail}")
        self.stage  = stage
        self.detail = detail


# ── Stage 0: content-based Mandinka detection ────────────────────────
# Frontend-side bug workaround. The per-message "translate to Mandinka"
# toggle in App.jsx replaces the displayed bubble text but the Spk
# component still sends msg.content (the original English) + lang=uiLang
# (the UI language, often still "en"). By the time the text hits us,
# lang/source_lang can completely disagree with what the text actually
# is. So before trusting the lang header we sniff the payload — if it
# carries Mandinka-only diacritics (ŋ ñ ɛ ɔ ɲ) we override both.
_MANDINKA_DIACRITICS = frozenset("ŋñɛɔɲŊÑƐƆƝ")

# A small whitelist of Mandinka-only indicator words / phrases. Each entry
# must satisfy two rules:
#   1. Zero overlap with English vocabulary (no false positives on EN text)
#   2. Common enough in health-context Mandinka to be useful (so we catch
#      pure-ASCII Mandinka that happens to omit diacritics in casual typing)
# Word-boundary regex ensures partial-string matches inside English words
# (e.g., "barakaa" will not match "Barbarakaa Foundation" — boundaries
# wouldn't fire, but more importantly it won't match "Bara" in English).
# The list is deliberately tiny; expand only with strong evidence.
_MANDINKA_INDICATOR_WORDS = (
    "nyaadi",     # "how" / "how is..."
    "saama",      # "morning / good morning"
    "kunuŋ",      # "yesterday" (also already triggers on diacritic)
    "barakaa",    # "thank you"
    "wo lon",     # "that day"
    "alikuum",    # "alikum salaam" greeting reply
    "i ka mu ke", # "I do this" — distinctly Mandinka VP
    "ka mu",      # auxiliary, very Mandinka-specific in this form
)
_MANDINKA_WORD_RE = re.compile(
    r"\b(?:" + "|".join(re.escape(w) for w in _MANDINKA_INDICATOR_WORDS) + r")\b",
    re.IGNORECASE,
)


def _text_looks_mandinka(text: str) -> bool:
    """Two-tier conservative detector.

    Tier 1 (high confidence) — any Mandinka-only diacritic (ŋ ñ ɛ ɔ ɲ).
    Tier 2 (high confidence) — any whole-word match in our hand-picked
                               Mandinka indicator list (no English overlap).

    Both tiers are designed to UNDER-trigger rather than over-trigger:
    misrouting English to MMS-Mandinka produces garbled audio that's
    worse UX than the alternative (Mandinka-in-ASCII slipping through to
    Piper-EN). Callers who *know* the language should pass an explicit
    lang= or use the new `force_lang=` escape hatch on the synthesize
    helpers, both of which bypass content sniffing entirely.
    """
    if not text:
        return False
    if any(c in _MANDINKA_DIACRITICS for c in text):
        return True
    if _MANDINKA_WORD_RE.search(text):
        return True
    return False


def _resolve_effective_lang(
    text: str,
    lang: str,
    source_lang: str,
    *,
    force_lang: Optional[str] = None,
) -> Tuple[str, str]:
    """Return (effective_lang, effective_source_lang) after content sniffing.

    Rules:
      - `force_lang` (when provided): SKIP all content sniffing. Honoured
        verbatim. Use this when the caller has high-confidence language
        information from the user (e.g., explicit UI toggle).
      - If text clearly contains Mandinka markers (diacritics or
        unambiguous indicator words), force lang="ma" and source_lang="ma"
        (skip translation, synthesise directly).
      - Otherwise honour whatever the caller sent.

    This unblocks both directions of the "lang header disagrees with
    text" problem: content sniffing for the casual case, force_lang for
    the case where the caller is sure and the sniffer would otherwise
    second-guess them.
    """
    if force_lang:
        forced = force_lang.strip().lower()
        # Default the source to the forced language too (most common
        # case: text and target are the same).
        forced_src = (source_lang or force_lang).strip().lower()
        log.info("tts_fix.force_lang lang=%r src=%r (sniff bypassed)",
                 forced, forced_src)
        return forced, forced_src

    canonical_src = (source_lang or "").strip().lower()
    canonical_lang = (lang or "").strip().lower()

    if _text_looks_mandinka(text):
        if canonical_lang != "ma" or canonical_src != "ma":
            log.info("tts_fix.sniff forced_ma lang_in=%r src_in=%r",
                     lang, source_lang)
        return "ma", "ma"

    return canonical_lang or "en", canonical_src or "en"


# ── Stage 1: EN → MA translation (strict) ────────────────────────────
async def _translate_to_mandinka_strict(text: str, source_lang: str) -> str:
    """Translate text into Mandinka. Raises MandinkaTTSError on failure.

    Unlike the legacy _ensure_mandinka, this does NOT swallow errors —
    synthesising English text through a Mandinka voice model is the exact
    user-visible bug we're fixing, so we refuse to do it silently."""
    src = (source_lang or "en").strip().lower()
    # Accept both "ma" and "mnk" as already-Mandinka hints.
    if src in {"ma", "mnk", "mandinka"}:
        log.info("tts_fix.translate skipped (already_ma) len=%d", len(text))
        return text

    try:
        from src.services.translator import get_translator
        tr = get_translator()
    except Exception as e:
        raise MandinkaTTSError("translator_unavailable",
                               f"could not initialise translator: {e}") from e

    try:
        translated = await tr.translate(text, source="en", target="ma")
    except Exception as e:
        raise MandinkaTTSError("translator_failed",
                               f"translate() raised: {e}") from e

    translated = (translated or "").strip()
    if not translated:
        raise MandinkaTTSError("translator_empty",
                               "translator returned empty string")

    # Translator returns the ORIGINAL text on unsupported-language /
    # source==target. For "en"→"ma" on an identical string this almost
    # certainly means the translator LLM call didn't run. Flag it.
    if translated == text.strip():
        # Heuristic: if text has any Latin-alphabet English tokens and no
        # Mandinka diacritics, assume no translation happened.
        has_ma_diacritics = any(c in translated for c in "ŋñɛɔɲ")
        if not has_ma_diacritics and STRICT_TRANSLATION:
            raise MandinkaTTSError(
                "translator_passthrough",
                "translator returned input unchanged — LLM call likely "
                "failed (check OPENAI_API_KEY / GEMMA_BASE_URL).")

    log.info("tts_fix.translate ok in_len=%d out_len=%d",
             len(text), len(translated))
    return translated


# ── Stage 2: MMS synthesis with cold-start retry ─────────────────────
async def _mms_synthesise_with_retry(
    ma_text: str,
    *,
    fmt: str = "wav",  # "wav" or "ogg"
) -> bytes:
    """POST to voice-tts-mnk with retries. Raises MandinkaTTSError on exhaustion."""
    base = os.environ.get("MMS_TTS_URL", "http://voice-tts-mnk:5500").rstrip("/")
    path = "/v1/tts" if fmt == "wav" else "/v1/tts/ogg"
    url  = f"{base}{path}"

    last_err: Optional[str] = None
    for attempt in range(1, MMS_MAX_RETRIES + 2):  # e.g. 1..3 for 2 retries
        try:
            async with httpx.AsyncClient(timeout=MMS_TIMEOUT_SECONDS) as client:
                resp = await client.post(url, json={"text": ma_text})

            if resp.status_code == 200 and len(resp.content) >= 100:
                log.info("tts_fix.mms ok attempt=%d bytes=%d fmt=%s",
                         attempt, len(resp.content), fmt)
                return resp.content

            # 503 is the documented "model still loading" reply.
            last_err = f"http_{resp.status_code}:{resp.text[:200]}"
            log.warning("tts_fix.mms non-200 attempt=%d status=%s body=%s",
                        attempt, resp.status_code, resp.text[:200])

        except httpx.TimeoutException:
            last_err = "timeout"
            log.warning("tts_fix.mms timeout attempt=%d timeout_s=%.1f",
                        attempt, MMS_TIMEOUT_SECONDS)
        except httpx.HTTPError as e:
            last_err = f"http_error:{type(e).__name__}:{e}"
            log.warning("tts_fix.mms http_error attempt=%d err=%s",
                        attempt, last_err)

        if attempt <= MMS_MAX_RETRIES:
            backoff = MMS_RETRY_BACKOFF_SECS * attempt
            log.info("tts_fix.mms retrying in %.1fs", backoff)
            await asyncio.sleep(backoff)

    raise MandinkaTTSError("mms_failed",
                           f"voice-tts-mnk unreachable after "
                           f"{MMS_MAX_RETRIES + 1} attempts: {last_err}")


# ── Public: robust synthesize_* (drop-in replacements) ───────────────
_MA_LANG_SET = {"ma", "mnk", "mandinka", "mand", "man", "mnk_latn", "mnk-latn"}


async def synthesize_wav(
    text: str,
    lang: str = "ma",
    source_lang: str = "en",
    *,
    force_lang: Optional[str] = None,
) -> Optional[bytes]:
    """WAV for web players. Mirrors services.tts.synthesize signature.

    Behaviour diverges from the legacy implementation in exactly two places:
      - On translator failure we raise MandinkaTTSError (caller converts to
        HTTP 4xx/5xx with a useful body) instead of returning raw English
        audio disguised as Mandinka.
      - MMS calls tolerate cold start via retry + longer timeout.

    `force_lang` (kwarg-only): when set, SKIPS content sniffing entirely
    and honours the caller's language verbatim. Useful when the frontend
    has an explicit user-language toggle and KNOWS what the text is."""
    text = (text or "").strip()
    if not text:
        return None

    effective_lang, effective_src = _resolve_effective_lang(
        text, lang, source_lang, force_lang=force_lang,
    )
    if effective_lang in _MA_LANG_SET:
        ma_text = await _translate_to_mandinka_strict(text, effective_src)
        return await _mms_synthesise_with_retry(ma_text, fmt="wav")

    # English / everything else falls through to the legacy dispatcher so
    # we don't accidentally narrow non-Mandinka behaviour.
    from src.services import tts_piper
    return await tts_piper.synthesize(text)


async def synthesize_ogg(
    text: str,
    lang: str = "ma",
    source_lang: str = "en",
    *,
    force_lang: Optional[str] = None,
) -> Optional[bytes]:
    """OGG Opus for IVR / Telegram / WhatsApp voice notes.

    `force_lang` (kwarg-only): see synthesize_wav."""
    text = (text or "").strip()
    if not text:
        return None

    effective_lang, effective_src = _resolve_effective_lang(
        text, lang, source_lang, force_lang=force_lang,
    )
    if effective_lang in _MA_LANG_SET:
        ma_text = await _translate_to_mandinka_strict(text, effective_src)
        return await _mms_synthesise_with_retry(ma_text, fmt="ogg")

    from src.services import tts_piper
    return await tts_piper.synthesize_ogg(text)


# ── Introspection helper for the diag endpoint ───────────────────────
async def probe() -> dict:
    """Check every hop and return a structured report. Safe to call from
    a health dashboard — never raises."""
    out: dict = {"strict_translation": STRICT_TRANSLATION,
                 "mms_timeout_seconds": MMS_TIMEOUT_SECONDS,
                 "mms_max_retries": MMS_MAX_RETRIES}

    # Translator
    try:
        from src.services.translator import get_translator
        tr = get_translator()
        out["translator"] = {
            "backend":       getattr(tr, "backend", "unknown"),
            "model":         getattr(tr, "model", "unknown"),
            "openai_api_key_set": bool(os.environ.get("OPENAI_API_KEY")),
            "gemma_base_url":     os.environ.get("GEMMA_BASE_URL"),
            "status":        "ready",
        }
    except Exception as e:
        out["translator"] = {"status": "error", "error": str(e)}

    # MMS container
    base = os.environ.get("MMS_TTS_URL", "http://voice-tts-mnk:5500").rstrip("/")
    out["mms_url"] = base
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{base}/health")
        out["mms"] = r.json() if r.status_code == 200 else {
            "status": "error", "http_status": r.status_code,
        }
    except Exception as e:
        out["mms"] = {"status": "unreachable", "error": str(e)}

    return out
