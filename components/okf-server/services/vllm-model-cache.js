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

/** The deployer pin, both spellings. Each spelling is trimmed BEFORE the
 * fallback so a whitespace-only VLLM_LLM_MODEL_ID cannot shadow a valid
 * VLLM_MODEL_ID. */
function envPin() {
  return (process.env.VLLM_LLM_MODEL_ID || '').trim() || (process.env.VLLM_MODEL_ID || '').trim() || null;
}

function ttlSeconds() {
  const v = parseInt(process.env.MODEL_DETECT_TTL, 10);
  return Number.isFinite(v) && v >= 0 ? v : MODEL_TTL_DEFAULT_SECONDS;
}

function probeTimeoutMs() {
  const v = parseFloat(process.env.MODEL_PROBE_TIMEOUT_SECONDS);
  return Number.isFinite(v) && v > 0 ? v * 1000 : PROBE_TIMEOUT_DEFAULT_MS;
}

/** Probe once; on success cache and return the first served id, else null.
 *
 * Auth is EXACTLY the apiKey given by the caller — no env fallback here:
 * the deployment VLLM_API_KEY may only be aimed at the deployment
 * endpoint (resolveVllmModelId adds it for that path); a foreign base
 * (named model-config, judge base) must never receive it uninvited. */
async function probe(baseUrl, timeoutMs, apiKey) {
  const url = require('./llm-url').openAiModelsUrl(baseUrl);
  const headers = {};
  const key = (apiKey || '').trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  try {
    const r = await axios.get(url, { headers, timeout: timeoutMs || probeTimeoutMs() });
    const list = r.data && Array.isArray(r.data.data) ? r.data.data : [];
    const entry = list[0] || null;
    const id = typeof entry === 'string' ? entry : entry && typeof entry.id === 'string' ? entry.id : null;
    if (id) {
      // First entry is the rule (single-model vLLM — Python parity), but a
      // multi-model gateway makes it an arbitrary pick: make the ambiguity
      // visible instead of silently chatting with, say, an embedder.
      if (list.length > 1) {
        logger.warn('vllm_model_cache.multi_model_endpoint', {
          url,
          n: list.length,
          chosen: id,
          note: 'first listed model used — pin the model if that is not the chat model'
        });
      }
      return id;
    }
    logger.warn('vllm_model_cache.no_models', { url });
  } catch (e) {
    logger.warn('vllm_model_cache.probe_failed', { url, error: e.message });
  }
  return null;
}

/** get_model_id twin: served id for baseUrl, TTL-cached, stale-served on
 * probe failure, null when the endpoint never answered. */
async function getServedModelId(baseUrl, { timeoutMs, apiKey } = {}) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!base) return null;
  const entry = _cache.get(base);
  if (entry && Date.now() - entry.ts < ttlSeconds() * 1000) return entry.id;
  const id = await probe(base, timeoutMs, apiKey);
  if (id) {
    _cache.set(base, { id, ts: Date.now() });
    return id;
  }
  return entry ? entry.id : null; // stale is better than broken
}

/** discover_model_id twin: soft precedence read for telemetry/provenance —
 * pin if set, else the served id, else null. Never throws. */
async function discoverVllmModelId(baseUrl, opts) {
  return envPin() || (await getServedModelId(baseUrl, opts));
}

/** The loud no-answer error shared by both resolving variants. */
function discoveryError(baseUrl) {
  return new ModelDiscoveryError(
    `no model id discovered at ${require('./llm-url').openAiModelsUrl(baseUrl)} — the endpoint must answer the model-id probe (or the model must be set where the call is configured)`
  );
}

/** require_model_id twin: the served id, loudly — the pin is deliberately
 * NOT consulted, and the probe uses ONLY the given apiKey (foreign base:
 * the deployment key is never aimed at an endpoint the caller did not
 * name it for). */
async function requireServedModelId(baseUrl, opts = {}) {
  const id = await getServedModelId(baseUrl, { timeoutMs: opts.timeoutMs, apiKey: opts.apiKey });
  if (!id) throw discoveryError(baseUrl);
  return id;
}

/** resolve_model_id twin: the single home of the precedence — pin wins,
 * else discovery, loud on no answer. This is the DEPLOYMENT path: when
 * the caller gives no key, the deployment VLLM_API_KEY is the default
 * credential for the deployment endpoint. */
async function resolveVllmModelId(baseUrl, opts = {}) {
  const pin = envPin();
  if (pin) return pin;
  if (!baseUrl) {
    throw new ModelDiscoveryError(
      'no vLLM endpoint configured and no model pinned — set VLLM_ENDPOINT or VLLM_MODEL_ID'
    );
  }
  const apiKey = (opts.apiKey || '').trim() || (process.env.VLLM_API_KEY || '').trim();
  const id = await getServedModelId(baseUrl, { timeoutMs: opts.timeoutMs, apiKey });
  if (!id) throw discoveryError(baseUrl);
  return id;
}

/** The deployment vLLM base, same rule the chat path uses: the env
 * endpoint, else the compose service name. Single home so the call path
 * (frontmatter's VLLM_LLM_HOST) and the provenance labels can never
 * disagree on which base is "the deployment endpoint". */
function deploymentVllmBase() {
  return process.env.VLLM_ENDPOINT || 'http://vllm:8000';
}

/** Test hook: drop every cached entry. */
function clearModelCache() {
  _cache.clear();
}

module.exports = {
  ModelDiscoveryError,
  deploymentVllmBase,
  getServedModelId,
  discoverVllmModelId,
  requireServedModelId,
  resolveVllmModelId,
  clearModelCache
};
