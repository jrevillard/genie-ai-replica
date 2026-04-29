"""
AMINA Care — Prescription Upload MIME Patch
=============================================
Broadens the image-MIME whitelist enforced by the
/api/v1/agent/prescription route in src/api/agent_routes.py so it
accepts every reasonable image format the browser might send.

Why
---
The original route in agent_routes.py rejects anything outside a
narrow whitelist (jpeg, png, webp, heic, heif) AND fails closed when
the browser strips or omits the Content-Type header — common with
mobile Safari camera uploads, certain Android pickers, and webp
detected as "application/octet-stream" by some Edge/IE shims. Real
JPGs and PNGs get rejected with "Unsupported file type ''".

The route reads `ALLOWED_IMAGE_MIMES` from module scope at call time,
so reassigning it from a patch module is effective for every worker
without touching the route's body. Genuinely non-image content (e.g.
a PDF mistakenly uploaded with content_type="") will still be
rejected — the downstream OpenAI Vision call will return a clear
"could not parse image" error instead of the pre-validator's silent
400.

Wired by main_with_rag_tuning.py.
"""
from __future__ import annotations

import logging

logger = logging.getLogger("prescription_upload_patch")

# Original (V1):
#   image/jpeg, image/jpg, image/png, image/webp, image/heic, image/heif
# V2 — broader. Common camera + scanner MIME types, plus the empty /
# octet-stream cases mobile browsers emit.
EXPANDED_ALLOWED = {
    "image/jpeg", "image/jpg", "image/pjpeg",
    "image/png",
    "image/webp",
    "image/heic", "image/heif",
    "image/gif",
    "image/bmp", "image/x-bmp", "image/x-ms-bmp",
    "image/tiff", "image/x-tiff",
    "image/avif",
    "image/jp2",  "image/jpx",   # JPEG 2000 (mobile cameras)
    # Browser quirks
    "application/octet-stream",
    "",  # some pickers omit the header entirely
}

_INSTALLED = False


def install() -> None:
    global _INSTALLED
    if _INSTALLED:
        return
    try:
        from src.api import agent_routes
    except ImportError as e:
        logger.warning("prescription_upload_patch: agent_routes not available: %s", e)
        return

    before = getattr(agent_routes, "ALLOWED_IMAGE_MIMES", None)
    agent_routes.ALLOWED_IMAGE_MIMES = EXPANDED_ALLOWED
    _INSTALLED = True
    logger.info(
        "prescription_upload_patch installed: ALLOWED_IMAGE_MIMES expanded "
        "from %d → %d entries",
        len(before) if hasattr(before, "__len__") else 0,
        len(EXPANDED_ALLOWED),
    )


install()
