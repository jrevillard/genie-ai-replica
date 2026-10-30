// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
'use strict';

/** TTL-cached vLLM model-id discovery for the OKF Node services — the
 * semantic mirror of genie-ai-overlay/core/model_cache.py (!631 policy).
 *
 * Precedence, identical to the Python side:
 *   1. env pin (deployer override) — `VLLM_LLM_MODEL_ID`, else
 *      `VLLM_MODEL_ID` (the compose `okf-server` service only receives the
 *      fused `VLLM_MODEL_ID`; the other spelling is read for parity with
 *      the rest of the stack and local runs);
 *   2. discovery — `GET {base}/v1/models`, cached for MODEL_DETECT_TTL
 *      seconds (default 60, same env knob as Python);
 *   3. loud ModelDiscoveryError (resolveVllmModelId) — a payload that must
 *      name the served model has no silent fallback: vLLM validates the
 *      name and answers 404 for unknown ones, so a hardcoded name is right
 *      only by coincidence with whatever the deployment serves.
 *
 * Cache behaviour mirrors model_cache.py exactly: on probe failure the last
 * known id is served (stale is better than broken); model-id consumers retry
 * on every call after expiry — no negative cache (the Python negative window
 * covers max_model_len only; the model-id variant is deferred as #1127).
 *
 * Knobs (same names and defaults as the Python side, so one .env line tunes
 * both worlds): MODEL_DETECT_TTL (seconds, default 60),
 * MODEL_PROBE_TIMEOUT_SECONDS (default 10). */

const axios = require('axios');
const { logger } = require('../shared-lib/logger');

const MODEL_TTL_DEFAULT_SECONDS = 60;
const PROBE_TIMEOUT_DEFAULT_MS = 10000;

/** Raised when a model id is required but nothing answers. Mirrors
 * core.model_cache.ModelDiscoveryError. */
class ModelDiscoveryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ModelDiscoveryError';
  }
}

// baseUrl (trailing slashes stripped) -> { id, ts } — ts is the Date.now()
// of the successful probe that filled the entry; absence of an entry means
// "never answered".
const _cache = new Map();

/** The deployer pin, both spellings, whitespace-only treated as unset. */
function envPin() {
  return (process.env.VLLM_LLM_MODEL_ID || process.env.VLLM_MODEL_ID || '').trim() || null;
}

function ttlSeconds() {
  const v = parseInt(process.env.MODEL_DETECT_TTL, 10);
  return Number.isFinite(v) && v >= 0 ? v : MODEL_TTL_DEFAULT_SECONDS;
}

function probeTimeoutMs() {
  const v = parseFloat(process.env.MODEL_PROBE_TIMEOUT_SECONDS);
  return Number.isFinite(v) && v > 0 ? v * 1000 : PROBE_TIMEOUT_DEFAULT_MS;
}

/** The ONE models-URL rule, sibling of llm-url.openAiChatUrl: a versioned
 * base (…/v1) keeps its segment and takes /models; a bare host gets /v1
 * appended. The probe must never disagree with the chat path on the base. */
function openAiModelsUrl(base) {
  const b = String(base || '').replace(/\/+$/, '');
  return /\/v\d+$/.test(b) ? `${b}/models` : `${b}/v1/models`;
}

/** Probe once; on success cache and return the first served id, else null. */
async function probe(baseUrl, timeoutMs) {
  const url = openAiModelsUrl(baseUrl);
  const headers = {};
  const apiKey = (process.env.VLLM_API_KEY || '').trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  try {
    const r = await axios.get(url, { headers, timeout: timeoutMs || probeTimeoutMs() });
    const entry = r.data && Array.isArray(r.data.data) ? r.data.data[0] : null;
    const id = typeof entry === 'string' ? entry : entry && typeof entry.id === 'string' ? entry.id : null;
    if (id) return id;
    logger.warn('vllm_model_cache.no_models', { url });
  } catch (e) {
    logger.warn('vllm_model_cache.probe_failed', { url, error: e.message });
  }
  return null;
}

/** get_model_id twin: served id for baseUrl, TTL-cached, stale-served on
 * probe failure, null when the endpoint never answered. */
async function getServedModelId(baseUrl, { timeoutMs } = {}) {
  const key = String(baseUrl || '').replace(/\/+$/, '');
  if (!key) return null;
  const entry = _cache.get(key);
  if (entry && Date.now() - entry.ts < ttlSeconds() * 1000) return entry.id;
  const id = await probe(key, timeoutMs);
  if (id) {
    _cache.set(key, { id, ts: Date.now() });
    return id;
  }
  return entry ? entry.id : null; // stale is better than broken
}

/** discover_model_id twin: soft precedence read for telemetry/provenance —
 * pin if set, else the served id, else null. Never throws. */
async function discoverVllmModelId(baseUrl, opts) {
  return envPin() || (await getServedModelId(baseUrl, opts));
}

/** require_model_id twin: the served id, loudly — the pin is deliberately
 * NOT consulted (this is for endpoints whose served model is the only
 * authority, e.g. a named model-config base). */
async function requireServedModelId(baseUrl, opts) {
  const id = await getServedModelId(baseUrl, opts);
  if (!id) {
    throw new ModelDiscoveryError(
      `no model id discovered at ${openAiModelsUrl(baseUrl)} — the endpoint must answer the model-id probe, or pin VLLM_MODEL_ID`
    );
  }
  return id;
}

/** resolve_model_id twin: the single home of the precedence — pin wins,
 * else discovery, loud on no answer. */
async function resolveVllmModelId(baseUrl, opts) {
  const pin = envPin();
  if (pin) return pin;
  if (!baseUrl) {
    throw new ModelDiscoveryError(
      'no vLLM endpoint configured and no model pinned — set VLLM_ENDPOINT or VLLM_MODEL_ID'
    );
  }
  return requireServedModelId(baseUrl, opts);
}

/** Test hook: drop every cached entry. */
function clearModelCache() {
  _cache.clear();
}

module.exports = {
  ModelDiscoveryError,
  discoverVllmModelId,
  requireServedModelId,
  resolveVllmModelId,
  clearModelCache
};
