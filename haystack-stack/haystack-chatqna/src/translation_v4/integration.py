"""Wire v3.5 in next to the v1 path -- without modifying v1.

The existing v1 caller (typically ``translation_v3_integration.py`` or
the agent route) should import ``maybe_translate_v4`` and use the
following pattern:

    v4 = await maybe_translate_v4(english_text, patient_context,
                                  session_id=session_id,
                                  response_type=response_type)
    if v4 is not None:
        # v4 ran. ``v4["assembled_output"]`` is the Mandinka-or-bilingual
        # answer. v4 already executed the corrector as Stage 6 -- do
        # NOT run the v5.1 corrector again on the same text.
        mandinka_text = v4["assembled_output"]
    else:
        # v4 disabled or pipeline returned None. The v1 path runs
        # exactly as it did before. ZERO changes to v1 code.
        mandinka_text = await v1_translator.translate(english_text, "en", "ma")
        mandinka_text = corrector.correct(mandinka_text, english_text, ctx)

The integration is intentionally one-way: v3.5 may DEFER to v1 (by
returning None) but v1 never calls into v3.5. That keeps v1 immune
to bugs in the new pipeline.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from . import config
from .pipeline import get_pipeline

logger = logging.getLogger(__name__)


async def maybe_translate_v4(
    english_text: str,
    patient_context: Optional[Dict[str, Any]] = None,
    *,
    session_id: Optional[str] = None,
    response_type: str = "general",
) -> Optional[Dict[str, Any]]:
    """Returns the v3.5 pipeline result, or None to defer to v1.

    Reasons for None:
      * ``AMINA_TRANSLATION_V4_ENABLED`` is False.
      * Pipeline ran but the router decided SERVE_ENGLISH for the
        whole message -- v1's translator + corrector is the better
        path in that case (no point in serving the all-English output
        we just generated; v1 has cached translations).
      * Pipeline raised. We log and defer; the user is never blocked.

    The return shape on success matches ``pipeline.translate``.
    """
    if not config.AMINA_TRANSLATION_V4_ENABLED:
        return None
    try:
        result = await get_pipeline().translate(
            english_text=english_text,
            patient_context=patient_context,
            session_id=session_id,
            response_type=response_type,
        )
    except Exception as e:
        logger.warning(
            "v4.integration: pipeline raised (%s: %s) -- deferring to v1",
            type(e).__name__, e,
        )
        return None
    if result is None:
        return None
    if result.get("overall_decision") == "SERVE_ENGLISH":
        # v3.5 chose English for everything. Defer to v1 so the caller
        # uses v1's translation cache and existing English fallback
        # behaviour rather than the simplified-English we generated.
        return None
    return result
