# Copyright (c) 2025-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""TTL-cached model auto-detection for remote vLLM endpoints.

Provides ``get_model_id()`` — probes the vLLM ``/v1/models`` endpoint once, then
serves the result from an in-memory cache for ``MODEL_DETECT_TTL`` seconds (default
60s). On cache expiry the endpoint is re-probed; on probe failure the last known
value is returned (stale is better than broken). This lets services pick up model
changes on the GPU node without a restart.

Usage::

    from core.model_cache import get_model_id

    model = get_model_id("https://gpu.example.com/llm")
    if model:
        use(model)
"""

import logging
import os
import time

import httpx

logger = logging.getLogger(__name__)

# Default TTL in seconds. Overridable per-deployment via MODEL_DETECT_TTL env var.
MODEL_TTL_DEFAULT = 60

# endpoint_url -> {"model_id": str|None, "ts": float}
_cache: dict[str, dict] = {}


def _resolve_ttl(ttl_seconds: int | None) -> int:
    """Return the effective TTL: explicit arg > env var > default."""
    if ttl_seconds is not None:
        return ttl_seconds
    try:
        return int(os.getenv("MODEL_DETECT_TTL", MODEL_TTL_DEFAULT))
    except ValueError:
        return MODEL_TTL_DEFAULT


def _probe(endpoint_url: str) -> str | None:
    """Probe the vLLM ``/v1/models`` endpoint. Return first model ID or None."""
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
            return models["data"][0]["id"]
        logger.warning("model_cache: no models returned by %s/v1/models", endpoint_url)
    except Exception as e:  # noqa: BLE001 — broad catch is intentional: any probe failure is non-fatal
        logger.warning("model_cache: probe failed for %s: %s", endpoint_url, e)
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
    if not endpoint_url:
        return None

    now = time.monotonic()
    ttl = _resolve_ttl(ttl_seconds)
    entry = _cache.get(endpoint_url)

    if entry and (now - entry["ts"]) < ttl:
        return entry["model_id"]

    # Cache miss or expired — re-probe.
    model_id = _probe(endpoint_url)
    if model_id is not None:
        _cache[endpoint_url] = {"model_id": model_id, "ts": now}
        return model_id

    # Probe failed. Return stale value if available (stale > broken).
    if entry:
        logger.info("model_cache: probe failed for %s, serving stale cached value", endpoint_url)
        return entry["model_id"]

    return None


def clear_cache() -> None:
    """Clear the entire cache. Primarily for testing."""
    _cache.clear()
