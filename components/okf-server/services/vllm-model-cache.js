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
 * Cache behaviour:
 *   - a successful probe is cached (TTL) and served stale when a later
 *     probe fails (stale is better than broken);
 *   - a FAILED probe is remembered for NEGATIVE_CACHE_TTL seconds, so an
 *     unreachable endpoint costs one probe per window instead of one per
 *     CALL — the Node callers resolve per request (curation resolves per
 *     concept), where the Python side resolves per file/job. Python applies
 *     the same mechanism to its own request-path field (max_model_len); the
 *     exact model-id negative-cache semantics stay open in #1127;
 *   - concurrent callers share ONE in-flight probe;
 *   - cache keys carry the CREDENTIAL as well as the base: gateways can
 *     filter /v1/models per key, so two configs on one base must never
 *     resolve each other's model.
 *
 * Knobs (same names and defaults as the Python side, so one .env line tunes
 * both worlds): MODEL_DETECT_TTL (seconds, default 60),
 * MODEL_PROBE_TIMEOUT_SECONDS (default 10). */

const axios = require('axios');
const { logger } = require('../shared-lib/logger');

const MODEL_TTL_DEFAULT_SECONDS = 60;
const PROBE_TIMEOUT_DEFAULT_MS = 10000;
// How long a FAILED probe is remembered (seconds) — one probe per window
// instead of one per call.
const NEGATIVE_CACHE_TTL = 60;

/** Raised when a model id is required but nothing answers. Mirrors
 * core.model_cache.ModelDiscoveryError. */
class ModelDiscoveryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ModelDiscoveryError';
  }
}

// cacheKey (base + credential) -> { id, ts } — ts is the Date.now() of the
// successful probe that filled the entry; absence of an entry means
// "never answered".
const _cache = new Map();
// cacheKey -> { promise } — the in-flight probe shared by concurrent callers.
const _inflight = new Map();
// cacheKey -> { ts } — the negative stub: a recent failure, no id.
const _negative = new Map();

/** The deployer pin, both spellings. Each spelling is trimmed BEFORE the
 * fallback so a whitespace-only VLLM_LLM_MODEL_ID cannot shadow a valid
 * VLLM_MODEL_ID. */
function envPin() {
  return (process.env.VLLM_LLM_MODEL_ID || '').trim() || (process.env.VLLM_MODEL_ID || '').trim() || null;
}

/** The deployment credential, both spellings — the chat path accepts the
 * same pair, so the probe must not be stricter (or looser). */
function deploymentKey() {
  return (process.env.VLLM_API_KEY || '').trim() || (process.env.VLLM_LLM_API_KEY || '').trim() || '';
}

function ttlSeconds() {
  const v = parseInt(process.env.MODEL_DETECT_TTL, 10);
  return Number.isFinite(v) && v >= 0 ? v : MODEL_TTL_DEFAULT_SECONDS;
}

function probeTimeoutMs() {
  const v = parseFloat(process.env.MODEL_PROBE_TIMEOUT_SECONDS);
  return Number.isFinite(v) && v > 0 ? v * 1000 : PROBE_TIMEOUT_DEFAULT_MS;
}

/** Probe once; on success return the first served id, else null.
 *
 * Auth is EXACTLY the apiKey given by the caller — no env fallback here:
 * the deployment key may only be aimed at the deployment endpoint
 * (deploymentServedModelId / resolveVllmModelId add it for that path); a
 * foreign base (named model-config, judge base) must never receive it
 * uninvited. */
async function probe(baseUrl, timeoutMs, apiKey) {
  const url = require('./llm-url').openAiModelsUrl(baseUrl);
  const headers = {};
  const key = (apiKey || '').trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  try {
    // The probe timeout is the ENV ceiling (MODEL_PROBE_TIMEOUT_SECONDS);
    // a caller's own budget may only tighten it.
    const ceiling = probeTimeoutMs();
    const timeout = timeoutMs ? Math.min(timeoutMs, ceiling) : ceiling;
    const r = await axios.get(url, { headers, timeout });
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
  const cacheKey = `${base}|${(apiKey || '').trim()}`;
  const entry = _cache.get(cacheKey);
  if (entry && Date.now() - entry.ts < ttlSeconds() * 1000) return entry.id;

  // A recent failure is remembered: answer without touching the network.
  const failed = _negative.get(cacheKey);
  if (failed && Date.now() - failed.ts < NEGATIVE_CACHE_TTL * 1000) {
    return entry ? entry.id : null; // stale beats broken, null beats a storm
  }

  // Concurrent callers share ONE probe.
  let pending = _inflight.get(cacheKey);
  if (!pending) {
    pending = probe(base, timeoutMs, apiKey).then((id) => {
      if (id) {
        _cache.set(cacheKey, { id, ts: Date.now() });
        _negative.delete(cacheKey);
      } else {
        _negative.set(cacheKey, { ts: Date.now() });
      }
      _inflight.delete(cacheKey);
      return id;
    });
    _inflight.set(cacheKey, pending);
  }
  const id = await pending;
  if (id) return id;
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
 * the caller gives no key, the deployment credential is the default for
 * the deployment endpoint. */
async function resolveVllmModelId(baseUrl, opts = {}) {
  const pin = envPin();
  if (pin) return pin;
  if (!baseUrl) {
    throw new ModelDiscoveryError(
      'no vLLM endpoint configured and no model pinned — set VLLM_ENDPOINT or VLLM_MODEL_ID'
    );
  }
  const apiKey = (opts.apiKey || '').trim() || deploymentKey();
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

/** The deployment endpoint's served model, soft: base AND deployment
 * credential resolved in one place (they must never drift apart — an
 * unauthenticated probe 401s on secured endpoints and silently defeats
 * the label). Null when nothing answers. */
async function deploymentServedModelId() {
  return getServedModelId(deploymentVllmBase(), { apiKey: deploymentKey() });
}

/** The deployment model for a PROVENANCE label: the pin when set, else
 * the served id, else null (soft — never throws). */
async function deploymentDiscoveredModelId() {
  return discoverVllmModelId(deploymentVllmBase(), { apiKey: deploymentKey() });
}

/** Same origin (protocol + host + port) — the deployment credential may
 * only travel to an endpoint that IS the deployment endpoint. */
function sameOrigin(a, b) {
  try {
    const ua = new URL(String(a || ''));
    const ub = new URL(String(b || ''));
    return ua.protocol === ub.protocol && ua.host === ub.host;
  } catch {
    return false;
  }
}

/** Test hook: drop every cached entry. */
function clearModelCache() {
  _cache.clear();
  _negative.clear();
  _inflight.clear();
}

module.exports = {
  ModelDiscoveryError,
  deploymentDiscoveredModelId,
  deploymentServedModelId,
  deploymentVllmBase,
  discoverVllmModelId,
  getServedModelId,
  requireServedModelId,
  resolveVllmModelId,
  sameOrigin,
  clearModelCache
};
