# Copyright (c) 2025-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""TTL-cached model auto-detection for remote vLLM endpoints.

Provides ``get_model_id()`` and ``get_max_model_len()`` — the vLLM
``/v1/models`` endpoint is probed once and both values (model id and
``max_model_len``) are served from the same in-memory cache entry for
``MODEL_DETECT_TTL`` seconds (default 60s). On cache expiry the endpoint
is re-probed; on probe failure the last known values are returned (stale
is better than broken). This lets services pick up model changes on the
GPU node without a restart.

``max_model_len`` is a vLLM extension to the OpenAI payload — strict
OpenAI-compatible providers may omit it, in which case
``get_max_model_len()`` returns None (and a warning is logged) so callers
can fall back to their configured window.

Usage::

    from core.model_cache import get_max_model_len, get_model_id

    model = get_model_id("https://gpu.example.com/llm")
    window = get_max_model_len("https://gpu.example.com/llm")
"""

import logging
import os
import time

import httpx

logger = logging.getLogger(__name__)

# Default TTL in seconds. Overridable per-deployment via MODEL_DETECT_TTL env var.
MODEL_TTL_DEFAULT = 60

# How long a failed probe is remembered (seconds): bounds the retry storm when
# nothing answers the probe to one attempt per window instead of one per request.
NEGATIVE_CACHE_TTL = 60

# endpoint_url -> {"model_id": str|None, "max_model_len": int|None, "ts": float}
_cache: dict[str, dict] = {}


def _resolve_ttl(ttl_seconds: int | None) -> int:
    """Return the effective TTL: explicit arg > env var > default."""
    if ttl_seconds is not None:
        return ttl_seconds
    try:
        return int(os.getenv("MODEL_DETECT_TTL", MODEL_TTL_DEFAULT))
    except ValueError:
        return MODEL_TTL_DEFAULT


def _probe(endpoint_url: str) -> dict | None:
    """Probe the vLLM ``/v1/models`` endpoint. Return the first model entry or None.

    The entry carries every field the endpoint exposes (``id``, and for vLLM
    servers ``max_model_len``) so a single HTTP call feeds all accessors.
    """
    headers = {}
    api_key = os.getenv("VLLM_API_KEY", "")
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    # Align with the project's OPEA_SSL_SKIP_VERIFY mechanism (self-signed GPU
    # certs). The global genie_ssl_patch.py (installed via the zz_genie_startup.pth
    # site-init hook) also handles this, but we set verify explicitly so the probe
    # is correct regardless of patch state.
    verify = os.getenv("OPEA_SSL_SKIP_VERIFY", "") != "1"
    try:
        resp = httpx.get(f"{endpoint_url}/v1/models", headers=headers, timeout=10, verify=verify)
        resp.raise_for_status()
        models = resp.json()
        if models.get("data"):
            entry = models["data"][0]
            if isinstance(entry, dict):
                return entry
            return {"id": entry}
        logger.warning("model_cache: no models returned by %s/v1/models", endpoint_url)
    except Exception as e:  # noqa: BLE001 — broad catch is intentional: any probe failure is non-fatal
        logger.warning("model_cache: probe failed for %s: %s", endpoint_url, e)
    return None


def _coerce_max_model_len(value) -> int | None:
    """Coerce a probed ``max_model_len`` to a usable int, or None.

    Some proxies serialize the field as a JSON string, others report -1 or 0
    as an "unknown" sentinel; anything that cannot serve as a context window
    (non-positive, bool, float, dict, garbage) is dropped so a bad payload
    never poisons the cache entry.
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value > 0:
        return value
    if isinstance(value, str) and value.strip().isdigit() and int(value) > 0:
        return int(value)
    return None


def _cached_field(endpoint_url: str, ttl_seconds: int | None, field: str):
    """Return one field of the endpoint's model entry, cached for the TTL.

    On cache hit (within TTL): return the cached value without probing.
    On cache expiry: re-probe once and refresh every cached field from the
    same payload. On probe failure: serve the stale cached value if one
    exists (stale > broken), else None. A failed probe is remembered for
    NEGATIVE_CACHE_TTL seconds so an unreachable endpoint costs one probe per
    window instead of one per request.
    """
    if not endpoint_url:
        return None

    now = time.monotonic()
    ttl = _resolve_ttl(ttl_seconds)
    entry = _cache.get(endpoint_url)

    if entry and (now - entry["ts"]) < ttl:
        return entry[field]

    # Recently failed probe: within the negative-cache window, answer from the
    # cached entry (stale values when some exist, None otherwise) without
    # re-probing.
    if entry and (now - entry.get("last_fail_ts", 0)) < NEGATIVE_CACHE_TTL:
        return entry[field]

    # Cache miss or expired — re-probe.
    probed = _probe(endpoint_url)
    if probed is not None:
        _cache[endpoint_url] = {
            "model_id": probed.get("id"),
            "max_model_len": _coerce_max_model_len(probed.get("max_model_len")),
            "ts": now,
        }
        value = _cache[endpoint_url][field]
        if field == "max_model_len" and value is None:
            # The caller will fall back to its configured window — make the
            # discovery gap visible instead of silently keeping a stale guess.
            logger.warning(
                "model_cache: %s/v1/models does not expose max_model_len "
                "(strict OpenAI-compatible provider?); callers must fall back "
                "to their configured context window",
                endpoint_url,
            )
        return value

    # Probe failed. Remember the failure briefly, then serve whatever the
    # entry holds (stale values when some exist, None otherwise).
    if entry:
        entry["last_fail_ts"] = now
        logger.info("model_cache: probe failed for %s, serving stale cached value", endpoint_url)
        return entry[field]

    _cache[endpoint_url] = {"model_id": None, "max_model_len": None, "ts": 0, "last_fail_ts": now}
    return None


def get_model_id(endpoint_url: str, ttl_seconds: int | None = None) -> str | None:
    """Return the model ID served at ``endpoint_url``, cached for the TTL.

    On cache hit (within TTL): return cached value without probing.
    On cache expiry: re-probe. If probe succeeds, update cache and return.
    On probe failure: return the stale cached value if one exists, else None.

    Args:
        endpoint_url: Base URL of the vLLM server (e.g. ``https://host:port/llm``).
        ttl_seconds: Optional explicit TTL override. Defaults to env
            ``MODEL_DETECT_TTL`` or 60s.

    Returns:
        Model ID string, or None if never successfully detected.
    """
    return _cached_field(endpoint_url, ttl_seconds, "model_id")


def get_max_model_len(endpoint_url: str, ttl_seconds: int | None = None) -> int | None:
    """Return the served context window (``max_model_len``), cached like ``get_model_id``.

    ``max_model_len`` is a vLLM extension to the OpenAI ``/v1/models`` payload —
    strict OpenAI-compatible providers may omit it, in which case this returns
    None (callers fall back to their configured value).

    Shares the probe and cache entry with ``get_model_id``: one HTTP call
    serves both values.

    Returns:
        Context window in tokens, or None when the endpoint does not expose
        the field or was never successfully probed.
    """
    return _cached_field(endpoint_url, ttl_seconds, "max_model_len")


def clear_cache() -> None:
    """Clear the entire cache. Primarily for testing."""
    _cache.clear()
