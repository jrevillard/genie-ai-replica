// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
'use strict';

/** TTL-cached vLLM model-id discovery for the OKF Node services — the
 * semantic mirror of genie-ai-overlay/core/model_cache.py (!631 policy).
 *
 * Precedence — the SAME ORDER as the Python twin, with the divergences
 * listed explicitly below (the Node surface resolves per request and
 * points at operator-configured endpoints, which the Python one does not):
 *   1. env pin (deployer override) — `VLLM_LLM_MODEL_ID`, else
 *      `VLLM_MODEL_ID` (the compose `okf-server` service receives both
 *      spellings; the Python side reads `VLLM_MODEL_ID` only);
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
 *   - concurrent callers share ONE in-flight probe — per probe BUDGET
 *     (the window and the in-flight map are keyed by the budget bucket, so
 *     a tight-budget caller never narrows an ample-budget one, and an
 *     endpoint that is down costs one probe per budget class per window);
 *   - cache keys carry the CREDENTIAL as well as the base: gateways can
 *     filter /v1/models per key, so two configs on one base must never
 *     resolve each other's model.
 *
 * Divergences from the Python twin (core/model_cache.py), all deliberate:
 *   - the pin accepts TWO spellings here (the Node services' deployment
 *     has both) and is trimmed; Python reads one spelling, untrimmed;
 *   - the failed-probe window applies to the model id here (it is the
 *     Node request-path field) and lasts 10 s; Python windows
 *     `max_model_len` instead, for 60 s;
 *   - the credential is scoped: a probe never carries the deployment
 *     bearer to an endpoint it was not aimed at; Python has one global
 *     credential;
 *   - the cache key carries the credential and the NORMALIZED probe URL;
 *   - the probe URL follows the shared base-completion rule (llm-url.js): a
 *     base that already carries a version segment is listed at {base}/models,
 *     a bare host at {base}/v1/models. The twin appends /v1 models
 *     unconditionally, so for a base that already ends in /v1 the two worlds
 *     probe different URLs (the twin 404s, this one answers).
 *
 * Knobs (same names and defaults as the Python side, so one .env line tunes
 * both worlds): MODEL_DETECT_TTL (seconds, default 60),
 * MODEL_PROBE_TIMEOUT_SECONDS (default 10). */

const nodeCrypto = require('node:crypto');
const axios = require('axios');
// Deep import: the shared barrel pulls the security middleware (express
// rate limiting, geoip) — heavyweight for a leaf helper (see
// components/CLAUDE.md "When deep imports are unavoidable").
const { logger } = require('../shared-lib/logger');
const { openAiModelsUrl } = require('./llm-url');

const MODEL_TTL_DEFAULT_SECONDS = 60;
const PROBE_TIMEOUT_DEFAULT_MS = 10000;
// How long a FAILED probe is remembered (seconds). Deliberately SHORT: it
// is a cool-down, not a cache — it bounds the probe storm (one probe per
// window instead of one per call) while keeping a transient blip from
// turning into a minute of loud failures.
const NEGATIVE_CACHE_TTL = 10;
// The maps are bounded by COUNT, not by age (see pruneCache): an expired
// entry still holds the last known model id, and that id is what a failing
// probe serves.
const MAX_CACHE_ENTRIES = 64;

/** Raised when a model id is required but nothing answers. Mirrors
 * core.model_cache.ModelDiscoveryError. */
class ModelDiscoveryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ModelDiscoveryError';
    // Structured like the other service errors: the API layer answers 503
    // with a machine-readable code, and the actionable message reaches the
    // caller instead of a bare INTERNAL_ERROR.
    this.status = 503;
    this.code = 'MODEL_DISCOVERY_FAILED';
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
// Pairs already warned about (malformed bases): sameOrigin runs per call —
// twice per LLM call in the curation loops — and a malformed base is a
// CONFIG error, not a per-call event. One line per pair, ever.
const _malformedWarned = new Set();

/** The deployer pin, both spellings. Each spelling is trimmed BEFORE the
 * fallback so a whitespace-only VLLM_LLM_MODEL_ID cannot shadow a valid
 * VLLM_MODEL_ID. */
function envPin() {
  return (process.env.VLLM_LLM_MODEL_ID || '').trim() || (process.env.VLLM_MODEL_ID || '').trim() || null;
}

/** The LLM-spelling pin only — the spelling the model server is started
 * with (`--served-model-name`) and the spelling CHATQNA receives (its
 * compose block fills VLLM_MODEL_ID from the LLM spelling alone; the
 * okf-server block passes both spellings through raw, and envPin() above
 * decides which one wins). */
function envPinLLMSpelling() {
  return (process.env.VLLM_LLM_MODEL_ID || '').trim() || null;
}

/** The deployment credential: VLLM_API_KEY, the one spelling any
 * deployment mechanism (compose, the env template, Ansible) injects into
 * the okf-server container. A second spelling read here would be a parity
 * the runtime can never honor — an operator setting it would stay
 * unauthenticated while the code (and its tests) claimed otherwise. */
function deploymentKey() {
  return (process.env.VLLM_API_KEY || '').trim();
}

/** A short, stable fingerprint of a credential — never the secret itself. */
function credentialHash(apiKey) {
  const key = (apiKey || '').trim();
  if (!key) return '-';
  return nodeCrypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

function ttlSeconds() {
  // The repo's ONE env-int policy (components/shared/lib/validation-utils).
  // Divergence from the Python twin: a NEGATIVE TTL falls back to the
  // default here, while Python would cache-always-expire.
  // The Python twin: int(os.getenv('MODEL_DETECT_TTL', 60)) — a fractional
  // or garbage value RAISES there and falls back to the default. parseInt
  // would truncate '0.5' to 0 and silently disable the cache (a probe per
  // call) where the twin keeps its 60 s window.
  const raw = (process.env.MODEL_DETECT_TTL || '').trim();
  if (!raw) return MODEL_TTL_DEFAULT_SECONDS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) return MODEL_TTL_DEFAULT_SECONDS;
  return value;
}

function probeTimeoutMs() {
  // Strict float (the Python twin's positive_float_env): '10abc' is NOT 10 —
  // it is a malformed value and falls back to the default.
  const raw = process.env.MODEL_PROBE_TIMEOUT_SECONDS;
  const v = raw === undefined || raw === '' ? NaN : Number(raw);
  return Number.isFinite(v) && v > 0 ? v * 1000 : PROBE_TIMEOUT_DEFAULT_MS;
}

// The transient classes the chat path retries (frontmatter-service's
// withUpstreamRetry): a probe that gives up on the first blip would fail
// the whole LLM leg, while the chat call would have recovered.
const RETRIABLE_PROBE_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED', // the endpoint is not up yet — the chat path retries it
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ERR_STREAM_PREMATURE_CLOSE'
]);
const RETRIABLE_PROBE_STATUS = new Set([429, 502, 503, 504]);
const PROBE_RETRY_DELAY_MS = 250;
const PROBE_ATTEMPTS = 3;

function isRetriableProbeError(err) {
  if (!err) return false;
  const status = err.response && err.response.status;
  if (status && RETRIABLE_PROBE_STATUS.has(status)) return true;
  if (err.code && RETRIABLE_PROBE_CODES.has(err.code)) return true;
  const msg = typeof err.message === 'string' ? err.message : '';
  return /stream has been aborted|socket hang up|premature close|ECONNRESET/i.test(msg);
}

/** Probe once (retrying a transient blip); on success the first served id.
 * On failure it THROWS the actionable error (the cause included) — the
 * caller decides whether to serve a stale id or let the failure through.
 *
 * Auth is EXACTLY the apiKey given by the caller — no env fallback here:
 * the deployment key may only be aimed at the deployment endpoint
 * (deploymentServedModelId / resolveVllmModelId add it for that path); a
 * foreign base (named model-config, judge base) must never receive it
 * uninvited. */
async function probe(url, timeoutMs, apiKey) {
  const headers = {};
  const key = (apiKey || '').trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  try {
    // The probe timeout is the ENV ceiling (MODEL_PROBE_TIMEOUT_SECONDS)
    // and it bounds the WHOLE probe (a deadline), not one attempt: a
    // caller's own budget may only tighten it.
    const budgetMs = effectiveProbeBudget(timeoutMs);
    const deadline = Date.now() + budgetMs;
    let r;
    for (let attempt = 0; attempt < PROBE_ATTEMPTS; attempt += 1) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error('model probe deadline exceeded');
      try {
        r = await axios.get(url, { headers, timeout: left });
        break;
      } catch (err) {
        const canRetry = attempt < PROBE_ATTEMPTS - 1 && isRetriableProbeError(err) && deadline - Date.now() > 0;
        if (!canRetry) throw err;
        // Jittered backoff (the chat path jitters too): replicas that hit a
        // cold cache together must not retry in lockstep.
        const backoff = PROBE_RETRY_DELAY_MS * 2 ** attempt + Math.floor(Math.random() * PROBE_RETRY_DELAY_MS);
        await new Promise((resolve) => setTimeout(resolve, Math.min(backoff, deadline - Date.now())));
      }
    }
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
    // No inner warn line: the outer probe_failed catch below carries this
    // exact message — one incident must be one line in VL, not two.
    throw new Error('the endpoint listed no model');
  } catch (e) {
    logger.warn('vllm_model_cache.probe_failed', { url, error: e.message });
    throw probeFailure(url, e);
  }
}

/** The probe budget: the ENV ceiling, tightened by the caller's own budget.
 * One rule, so the probe and the in-flight key cannot disagree. */
function effectiveProbeBudget(timeoutMs) {
  const ceiling = probeTimeoutMs();
  return timeoutMs ? Math.min(timeoutMs, ceiling) : ceiling;
}

/** The in-flight key carries the probe budget (in seconds): a caller with a
 * tight budget must not narrow the probe a concurrent caller is waiting on. */
function probeBudgetBucket(timeoutMs) {
  return Math.ceil(effectiveProbeBudget(timeoutMs) / 1000);
}

/** get_model_id twin: served id for baseUrl, TTL-cached, stale-served on
 * probe failure. When nothing ever answered, it THROWS the probe's cause
 * (a null id would hide the reason from the caller). */
async function getServedModelId(baseUrl, { timeoutMs, apiKey } = {}) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!base) return null;
  // Cache key = the NORMALIZED probe URL + a HASH of the credential:
  // gateways can filter /v1/models per key, so two configs on one base
  // must never resolve each other's model — and two spellings of one base
  // (…/vllm vs …/vllm/v1) must not open two independent windows. The
  // credential is hashed, never kept in the key: the map lives for the
  // container's lifetime.
  const modelsUrl = openAiModelsUrl(base);
  const cacheKey = `${modelsUrl}|${credentialHash(apiKey)}`;
  const entry = _cache.get(cacheKey);
  if (entry && Date.now() - entry.ts < ttlSeconds() * 1000) return entry.id;

  // Concurrent callers share ONE probe — per probe BUDGET: the first
  // caller's budget must not narrow a concurrent caller's probe (the
  // best-effort summary leg probes for 1 s while a tagging call may wait 30 s).
  // The failure marker is keyed the same way: a 1 s probe that gave up must
  // not lock out a caller that had 10 s and would have answered.
  const probeKey = `${cacheKey}|${probeBudgetBucket(timeoutMs)}`;

  // A recent failure is remembered: answer without touching the network.
  const failed = _negative.get(probeKey);
  if (failed && Date.now() - failed.ts < NEGATIVE_CACHE_TTL * 1000) {
    const stale = entry ? entry.id : null;
    if (stale) return stale; // stale beats broken
    throw failed.cause || discoveryError(modelsUrl);
  }

  let pending = _inflight.get(probeKey);
  if (!pending) {
    pending = probe(modelsUrl, timeoutMs, apiKey)
      .then((id) => {
        // delete+set: the refreshed entry becomes the newest, so the
        // count-bounded prune drops the OLDEST one first.
        _cache.delete(cacheKey);
        _cache.set(cacheKey, { id, ts: Date.now() });
        _negative.delete(probeKey);
        _inflight.delete(probeKey);
        return id;
      })
      .catch((err) => {
        _negative.set(probeKey, { ts: Date.now(), cause: err });
        _inflight.delete(probeKey);
        throw err;
      })
      // Prune on BOTH settle paths, after the insert: the maps never sit
      // above their bounds — an endpoint that stays down would otherwise
      // leave one negative entry per (base, credential, budget) for the
      // container's lifetime.
      .finally(pruneCache);
    _inflight.set(probeKey, pending);
  }
  try {
    return await pending;
  } catch (err) {
    // The probe failed: serve the last known id when there is one (stale >
    // broken — the Python twin keeps it too), else let the cause through.
    const stale = entry ? entry.id : null;
    if (stale) return stale;
    throw err;
  }
}

/** Drop the entries that no caller can use any more (the maps live for the
 * container's lifetime; a long-lived okf-server must not accumulate one
 * entry per model config it ever saw).
 *
 * Bound by COUNT, never by age: an expired entry still holds the last known
 * model id, and that id is what a failing probe serves (stale > broken —
 * the Python twin keeps it too). Dropping it on age would turn a probe blip
 * into a 503 for every call in the cool-down window. The eviction is the
 * price of the bound: the OLDEST entry goes, so its stale fallback goes
 * with it (that base re-probes on its next call). */
function pruneCache() {
  while (_cache.size > MAX_CACHE_ENTRIES) {
    _cache.delete(_cache.keys().next().value); // the oldest insertion first
  }
  const now = Date.now();
  for (const [key, value] of _negative) {
    if (now - value.ts >= NEGATIVE_CACHE_TTL * 1000) _negative.delete(key);
  }
  // The age sweep above only runs when a probe settles — a credential that
  // probes once and is never used again would otherwise leave its stub for
  // the container's lifetime (each stub carries the full failure, axios
  // cause included). Same count bound as the id cache, same eviction: the
  // oldest stub goes, that key re-probes.
  while (_negative.size > MAX_CACHE_ENTRIES) {
    _negative.delete(_negative.keys().next().value);
  }
}

/** The loud no-answer error shared by both resolving variants. */
function discoveryError(modelsUrl) {
  return new ModelDiscoveryError(
    `no model id discovered at ${modelsUrl} — the endpoint must answer the model-id probe (or the model must be set where the call is configured)`
  );
}

/** The probe's failure, actionable: the CAUSE (401, 404, DNS) reaches the
 * caller instead of a bare "no model id" — the operator must be able to tell
 * "the credential is stale" from "the endpoint has no /v1/models route". */
function probeFailure(modelsUrl, cause) {
  const status = cause && cause.response && cause.response.status;
  const detail = status ? `HTTP ${status}` : (cause && cause.code) || (cause && cause.message) || 'no answer';
  const err = new ModelDiscoveryError(
    `no model id discovered at ${modelsUrl} — the endpoint must answer the model-id probe (${detail})`
  );
  err.cause = cause;
  return err;
}

/** require_model_id twin: the served id, loudly — the pin is deliberately
 * NOT consulted, and the probe uses ONLY the given apiKey (foreign base:
 * the deployment key is never aimed at an endpoint the caller did not
 * name it for). */
async function requireServedModelId(baseUrl, opts = {}) {
  const id = await getServedModelId(baseUrl, { timeoutMs: opts.timeoutMs, apiKey: opts.apiKey });
  if (!id) throw discoveryError(openAiModelsUrl(baseUrl));
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
  // The deployment bearer is the DEPLOYMENT's credential: it may only be
  // aimed at the deployment endpoint. A base the caller did not name it
  // for gets no credential (the probe then runs unauthenticated, which is
  // what a foreign endpoint expects).
  const apiKey = (opts.apiKey || '').trim() || (sameOrigin(baseUrl, deploymentVllmBase()) ? deploymentKey() : '');
  const id = await getServedModelId(baseUrl, { timeoutMs: opts.timeoutMs, apiKey });
  if (!id) throw discoveryError(openAiModelsUrl(baseUrl));
  return id;
}

/** The credential a call to `baseUrl` may use: the endpoint's own key
 * when it has one, else the deployment credential ONLY when the base IS
 * the deployment endpoint (a third-party base gets none — the GPU bearer
 * must never leave the deployment endpoint). */
function credentialForBase(baseUrl, ownKey) {
  const own = (ownKey || '').trim();
  if (own) return own;
  return sameOrigin(baseUrl, deploymentVllmBase()) ? deploymentKey() : '';
}

/** Resolve the model id for a DEPLOYMENT call and report what is left of
 * the call budget: the discovery round trip is part of the budget, and the
 * chat call must never be handed a useless remainder (a 1 ms timeout fails
 * non-retriably on a healthy endpoint). The 1 s floor can exceed a budget
 * smaller than itself — a small-budget caller then gets the budget, not a
 * remainder — so the total wall time can pass the declared budget (the
 * floor is the point: a doomed call is worse than a slightly late one). */
async function resolveDeploymentModel({ baseUrl, apiKey, budgetMs, probeBudgetMs }) {
  const startedAt = Date.now();
  const budget = callBudget(budgetMs);
  const model = await resolveVllmModelId(baseUrl, {
    apiKey,
    timeoutMs: probeBudgetFor(budget, probeBudgetMs)
  });
  return { model, remainingMs: Math.max(1000, budget - (Date.now() - startedAt)) };
}

/** Same, for a FOREIGN endpoint (named model-config, judge base): the pin
 * never applies there — the served model is the only authority. */
async function resolveForeignModel({ baseUrl, apiKey, budgetMs, probeBudgetMs }) {
  const startedAt = Date.now();
  const budget = callBudget(budgetMs);
  const model = await requireServedModelId(baseUrl, {
    apiKey,
    timeoutMs: probeBudgetFor(budget, probeBudgetMs)
  });
  return { model, remainingMs: Math.max(1000, budget - (Date.now() - startedAt)) };
}

/** The call budget of a resolving call. A missing or non-numeric budget
 * would become NaN downstream — and axios DROPS a NaN timeout (no timer is
 * armed), so the request would hang instead of failing on its budget. */
const DEFAULT_CALL_BUDGET_MS = 60000;
function callBudget(budgetMs) {
  return Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : DEFAULT_CALL_BUDGET_MS;
}

/** The probe's share of the call budget: the caller's own cap when it gave
 * one, else half of it (the discovery round trip is part of the budget). */
function probeBudgetFor(budgetMs, probeBudgetMs) {
  if (Number.isFinite(probeBudgetMs) && probeBudgetMs > 0) return probeBudgetMs;
  return Math.max(1, Math.floor(budgetMs / 2));
}

/** The deployment vLLM base, same rule the chat path uses: the env
 * endpoint, else the compose service name. Single home so the call path
 * (frontmatter's VLLM_LLM_HOST) and the provenance labels can never
 * disagree on which base is "the deployment endpoint".
 *
 * TWO bases, two rules — stated here because they decide different
 * behaviour (sameOrigin / credentialForBase compare against THIS one):
 *   - deploymentVllmBase(): the endpoint the deployment's CHAT legs call.
 *     It falls back to the local vLLM service, because the TAGGING leg
 *     (the product's core) has always addressed it. In a deployment with
 *     no local vLLM, the tagging leg fails — loudly, since the discovery
 *     policy has no silent fallback any more.
 *   - optedInVllmBase(): the endpoint a deployment OPTED IN for the
 *     auxiliary legs (curation / topic-link / manifest summary). Null when
 *     VLLM_ENDPOINT is unset, and those legs stay off.
 */
function deploymentVllmBase() {
  return process.env.VLLM_ENDPOINT || 'http://vllm:8000';
}

/** The endpoint the deployment OPTED IN for the OKF LLM legs: the env
 * endpoint, or null when it is unset. Compose ships VLLM_ENDPOINT empty
 * on purpose ("a deployment opts IN by setting VLLM_ENDPOINT +
 * VLLM_API_KEY"), so the curation / topic-link / summary legs stay off
 * until it is set — unlike the tagging leg, which has always addressed
 * the local vLLM service. Named here so the gate is not re-implemented
 * as a raw env read in three services. */
function optedInVllmBase() {
  return process.env.VLLM_ENDPOINT || null;
}

/** The deployment endpoint's served model, soft: base AND deployment
 * credential resolved in one place (they must never drift apart — an
 * unauthenticated probe 401s on secured endpoints and silently defeats
 * the label). Null when nothing answers. */
async function deploymentServedModelId({ timeoutMs } = {}) {
  return servedModelId(deploymentVllmBase(), { apiKey: deploymentKey(), timeoutMs });
}

/** The served model of ANY base, soft: null when nothing answers. The
 * provenance callers record what answered — they must not fail on it. */
async function servedModelId(baseUrl, { apiKey, timeoutMs } = {}) {
  try {
    return await getServedModelId(baseUrl, { timeoutMs, apiKey });
  } catch {
    return null;
  }
}

/** Same ENDPOINT (protocol + host + port + compatible path) — the
 * deployment credential may only travel to an endpoint that IS the
 * deployment endpoint. The path matters: a sovereign deployment serves
 * the model server behind a path prefix (…/llm), and two tenants on one
 * host (…/tenant-a vs …/tenant-b) are NOT the same endpoint. A path
 * qualifies as the same when it equals the other or is a prefix of it at
 * a '/' boundary; a base without a path ('/') covers the whole host. */
function sameOrigin(a, b) {
  let ua;
  let ub;
  try {
    ua = new URL(String(a || ''));
    ub = new URL(String(b || ''));
  } catch {
    // A malformed base is a CONFIG error, not a silent "different origin":
    // say so, because the consequence (no deployment credential) is a 401.
    // Once per pair — the call sites sit in per-concept loops.
    const pair = `${a}|${b}`;
    if (!_malformedWarned.has(pair)) {
      _malformedWarned.add(pair);
      logger.warn('vllm_model_cache.malformed_base', { a: String(a || ''), b: String(b || '') });
    }
    return false;
  }
  try {
    if (ua.protocol !== ub.protocol || ua.host !== ub.host) return false;
    const pa = ua.pathname.replace(/\/+$/, '');
    const pb = ub.pathname.replace(/\/+$/, '');
    if (pa === pb) return true;
    const [short, long] = pa.length <= pb.length ? [pa, pb] : [pb, pa];
    // A base WITHOUT a path names the whole host — but only the
    // version-style prefix of that host is the same endpoint (…/v1 is the
    // OpenAI-compatible prefix of the same server); an arbitrary path
    // (…/tenant-b) is a DIFFERENT endpoint and must not receive the
    // deployment credential.
    if (short === '') return /^\/v\d+$/.test(long);
    if (!long.startsWith(`${short}/`)) return false;
    // The child must be the OpenAI-compatible VERSION segment (/v1) — the
    // same server under its versioned prefix. Any other child path
    // (…/llm/tenant-b) is a DIFFERENT endpoint: it must never receive the
    // deployment credential or the deployment's model name.
    return /^\/v\d+$/.test(long.slice(short.length));
  } catch {
    return false;
  }
}

/** Test hook: drop every cached entry. */
function clearModelCache() {
  _cache.clear();
  _negative.clear();
  _malformedWarned.clear();
  _inflight.clear();
}

module.exports = {
  ModelDiscoveryError,
  credentialForBase,
  deploymentKey,
  envPin,
  envPinLLMSpelling,
  deploymentServedModelId,
  servedModelId,
  deploymentVllmBase,
  getServedModelId,
  optedInVllmBase,
  requireServedModelId,
  resolveDeploymentModel,
  resolveForeignModel,
  resolveVllmModelId,
  sameOrigin,
  clearModelCache
};
