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

    from core.model_cache import get_max_model_len, get_model_id, require_model_id

    model = get_model_id("https://gpu.example.com/llm")
    window = get_max_model_len("https://gpu.example.com/llm")
    model = require_model_id("https://gpu.example.com/llm")  # raises if undiscovered
"""

import logging
import math
import os
import time

import httpx

from core.model_http_policy import PROBE_TIMEOUT_SECONDS, endpoint_auth_headers, endpoint_verify

logger = logging.getLogger(__name__)

# Default TTL in seconds. Overridable per-deployment via MODEL_DETECT_TTL env var.
MODEL_TTL_DEFAULT = 60

# How long a failed probe is remembered (seconds): bounds the retry storm when
# nothing answers the probe to one attempt per window instead of one per request.
NEGATIVE_CACHE_TTL = 60

# Sanity ceiling for a probed window (tokens). The largest real models sit two
# orders of magnitude below this; anything bigger is a broken proxy value that
# would silently disable every truncation guard.
MAX_SANE_MODEL_WINDOW_TOKENS = 10_000_000

# endpoint_url -> {"model_id": str|None, "max_model_len": int|None,
#                  "ts": float|None (None on a failure stub),
#                  "last_fail_ts": float|missing (stamped on failure only)}
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
    headers = endpoint_auth_headers()
    # Explicit verify so the probe is correct regardless of the global
    # genie_ssl_patch.py state (installed via the zz_genie_startup.pth hook).
    verify = endpoint_verify()
    try:
        resp = httpx.get(
            f"{endpoint_url}/v1/models",
            headers=headers,
            timeout=PROBE_TIMEOUT_SECONDS,
            verify=verify,
        )
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


def coerce_int(value) -> int | None:
    """Coerce a JSON scalar to ``int``: bools rejected, digit strings accepted.

    Shared stance for every numeric field read out of a model-server payload
    (context windows, tokenize counts): proxies serialize numbers as digit
    strings, and a boolean is never a count. Returns None for anything else —
    callers decide whether None means fallback (window getters) or a loud
    error (payload-building sites).
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        # 12.0 is a serialization of 12; 12.5 is garbage.
        return int(value) if math.isfinite(value) and int(value) == value else None
    if isinstance(value, str):
        try:
            return int(value.strip())
        except ValueError:
            return None
    return None


def _coerce_max_model_len(value) -> int | None:
    """Coerce a probed ``max_model_len`` to a usable int, or None.

    Some proxies serialize the field as a JSON string (possibly with exotic
    digit characters) or as a JSON float; others report -1 or 0 as an
    "unknown" sentinel. Anything that cannot serve as a context window
    (non-positive, non-finite, non-integral, absurdly large, garbage) is
    dropped so a bad payload never poisons the cache entry — an absurdly
    large window would silently disable the truncation guard.
    """
    coerced = coerce_int(value)
    if coerced is not None and 0 < coerced <= MAX_SANE_MODEL_WINDOW_TOKENS:
        return coerced
    return None


def _cached_field(endpoint_url: str, ttl_seconds: int | None, field: str):
    """Return one field of the endpoint's model entry, cached for the TTL.

    On cache hit (within TTL): return the cached value without probing.
    On cache expiry: re-probe once and refresh every cached field from the
    same payload. On probe failure: serve the stale cached value if one
    exists (stale > broken), else None. For ``max_model_len`` (the field the
    chat request path waits on) a failed probe is additionally remembered for
    NEGATIVE_CACHE_TTL seconds so an unreachable endpoint costs one probe per
    window instead of one per request; ``model_id`` consumers (dataprep and
    retriever labeling) keep retrying on every call.
    """
    if not endpoint_url:
        return None

    now = time.monotonic()
    ttl = _resolve_ttl(ttl_seconds)
    entry = _cache.get(endpoint_url)

    if entry and entry["ts"] is not None and (now - entry["ts"]) < ttl:
        return entry[field]

    # Recently failed probe on the request-path field: within the negative-
    # cache window, answer from the cached entry (stale values when some
    # exist, None otherwise) without re-probing.
    last_fail_ts = entry.get("last_fail_ts") if entry else None
    if field == "max_model_len" and last_fail_ts is not None and (now - last_fail_ts) < NEGATIVE_CACHE_TTL:
        return entry[field]

    # Cache miss or expired — re-probe.
    probed = _probe(endpoint_url)
    if probed is not None and probed.get("id") is not None:
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

    # Invalid (no id) or failed probe. Remember the failure briefly for the
    # request-path field, then serve whatever the entry holds (stale values
    # when some exist, None otherwise).
    if probed is not None:
        logger.warning("model_cache: %s/v1/models returned an entry with no model id", endpoint_url)
    if entry:
        if field == "max_model_len":
            entry["last_fail_ts"] = now
        if probed is None:
            logger.info("model_cache: probe failed for %s, serving stale cached value", endpoint_url)
        return entry[field]

    if field == "max_model_len":
        # ts stays None: a failure stub must never satisfy the success-TTL
        # hit branch (that would let model-id consumers ride the stub for a
        # full TTL instead of retrying), only last_fail_ts governs here.
        _cache[endpoint_url] = {"model_id": None, "max_model_len": None, "ts": None, "last_fail_ts": now}
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


class ModelDiscoveryError(RuntimeError):
    """No model id could be discovered for an endpoint.

    Raised by :func:`require_model_id` for callers whose requests must
    carry the name the endpoint actually serves.
    """


def require_model_id(endpoint_url: str) -> str:
    """Return the model ID served at ``endpoint_url`` or raise ModelDiscoveryError.

    The loud twin of :func:`get_model_id`: vLLM validates the model name on
    ``/tokenize`` and the OpenAI endpoints and answers 404 for unknown names,
    so a payload that must identify the served model (tokenize, direct
    chat/completions) has no usable fallback — a hardcoded name is correct
    only by coincidence with whatever the deployment serves. A stale cached
    id from a previous successful probe still counts as an answer.
    """
    detected = get_model_id(endpoint_url)
    if not detected:
        raise ModelDiscoveryError(
            f"no model id discovered at {endpoint_url}/v1/models — the endpoint "
            "must answer the model-id probe before requests carrying a model "
            "name can be built"
        )
    return detected


def resolve_model_id(endpoint_url: str) -> str:
    """Model id for ``endpoint_url``: the explicit ``VLLM_MODEL_ID`` env wins
    as the deployer override; otherwise the discovered id, loud on no answer.

    The single home of that precedence: payload-building consumers (retriever
    summarizer, dataprep labelling and graph clients) call this instead of
    hand-rolling the env check. Chatqna's generation path has no env knob by
    design — deployers steer it via the endpoint and the served name.
    """
    return os.getenv("VLLM_MODEL_ID", "") or require_model_id(endpoint_url)


def clear_cache() -> None:
    """Clear the entire cache. Primarily for testing."""
    _cache.clear()
