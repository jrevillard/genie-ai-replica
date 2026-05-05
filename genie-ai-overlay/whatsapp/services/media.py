# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Meta Graph API media download.

WhatsApp delivers media (voice notes, images, documents) by reference: the
inbound webhook contains a media `id`, not the bytes. To fetch the bytes we:

  1. GET /<media_id> with our access token → receive a signed media URL.
  2. GET that signed URL (also auth'd with our token) → binary blob.

Both calls require the bearer token. The signed URL has a short TTL.
"""

from __future__ import annotations

import logging

import config
import httpx

logger = logging.getLogger(__name__)


async def download_media(media_id: str) -> tuple[bytes, str] | None:
    """Fetch a WhatsApp media object by id. Returns (bytes, mime_type) or None.

    On any failure (auth, 4xx/5xx, network) we log and return None — the caller
    decides how to surface the failure to the user. We never raise, so a bad
    media reference can't crash the webhook handler."""
    if not config.META_ACCESS_TOKEN:
        logger.error("download_media: META_ACCESS_TOKEN not configured")
        return None

    headers = {"Authorization": f"Bearer {config.META_ACCESS_TOKEN}"}
    meta_url = f"{config.META_GRAPH_API_BASE}/{media_id}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            meta_resp = await client.get(meta_url, headers=headers)
        except httpx.HTTPError as exc:
            logger.error("media-meta network error for %s: %s", media_id, exc)
            return None
        if meta_resp.status_code >= 400:
            logger.error("media-meta failed (%s) id=%s body=%s",
                         meta_resp.status_code, media_id, meta_resp.text[:300])
            return None

        info = meta_resp.json()
        signed_url = info.get("url")
        mime_type = info.get("mime_type") or "application/octet-stream"
        if not signed_url:
            logger.error("media-meta returned no url for %s: %s", media_id, info)
            return None

        try:
            blob_resp = await client.get(signed_url, headers=headers)
        except httpx.HTTPError as exc:
            logger.error("media-blob network error for %s: %s", media_id, exc)
            return None
        if blob_resp.status_code >= 400:
            logger.error("media-blob failed (%s) id=%s", blob_resp.status_code, media_id)
            return None

        logger.info("Downloaded WhatsApp media id=%s mime=%s bytes=%d",
                    media_id, mime_type, len(blob_resp.content))
        return blob_resp.content, mime_type
