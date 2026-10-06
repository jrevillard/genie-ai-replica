'use strict';

// Story 1.1 (BFF fan-out wire-up, ADR-okf-039 D2/D3) — BFF-side client for the
// okf-server retrieval posture + per-caller authz graph set.
//
//   GET /api/okf/retrieval-config — the runtime mode + the SERVER-computed
//     `engaged` flag (mode ∈ {okf_only, hybrid} AND ≥1 serving graph FOR THIS
//     CALLER). The engagement gate lives on the okf-server (whitelist + live
//     serving set) — this client NEVER re-computes it from mode + serving
//     count; it exposes `engaged` verbatim as the authoritative signal.
//   GET /api/okf/authz/graphs — the caller's traversable serving-graph set
//     (zero-hit by construction; the resolver is the isolation boundary).
//
// Cache: ≤30s TTL (mirrors the authz-resolver's SERVING_TTL_MS), keyed
// (effective_scopes, ttl_window) — scope-equivalence inference is safe because
// the authz-resolver already filters by the caller's authorized_repo_ids; the
// cache is the latency optimization, NOT a separate authz layer. Keys are
// NEVER the raw bearer token (no isolation benefit, unbounded memory).
//
// Failure policy (fail-closed — never escalates to fan-out on a config
// outage): 401 propagates (the request itself is invalid — no silent legacy
// fallback); 403 means the caller holds no okf read scope, so the per-caller
// serving view is empty by construction → legacy default; 5xx/network →
// last-known-good config, else the legacy default (mode=legacy, engaged=false).
// The resolved value (including the failure-resolved one) is cached for the
// remainder of the TTL window — one upstream attempt per caller per window.
// The last-known-good carries only the deployment-global POSTURE fields
// (mode/serving/engaged/warnings); the per-caller graph set always comes from
// the caller's own live authz call and is never served from last-known-good.

const axios = require('axios');
const nodeCrypto = require('crypto');
const { logger } = require('../shared-lib');

/**
 * Local positive-int env parse (self-contained — no shared-lib symbol touched
 * at module load). A PRESENT-but-invalid or below-min value logs a WARN naming
 * the variable, the offending value and the applied fallback — an operator
 * typo must be visible, never silently swallowed. An UNSET variable falls back
 * silently (the default is the normal configuration, not a misconfiguration).
 */
function envPositiveInt(varName, rawValue, fallback, min) {
  const n = Number.parseInt(rawValue, 10);
  if (Number.isNaN(n) || n < min) {
    if (rawValue !== undefined && rawValue !== null) {
      logger.warn('RetrievalConfigClient.invalid_env_int', {
        variable: varName,
        value: String(rawValue),
        applied_fallback: fallback
      });
    }
    return fallback;
  }
  return n;
}

const OKF_SERVER_URL = (process.env.OKF_SERVER_URL || 'http://okf-server:3002').replace(/\/+$/, '');
// ≤30s — mirrors components/okf-server authz-resolver SERVING_TTL_MS (the
// ADR-039 D3 re-publish skew bound).
const RETRIEVAL_CONFIG_TTL_MS = envPositiveInt(
  'OKF_RETRIEVAL_CONFIG_TTL_MS',
  process.env.OKF_RETRIEVAL_CONFIG_TTL_MS,
  30000,
  1000
);
const REQUEST_TIMEOUT_MS = envPositiveInt(
  'OKF_RETRIEVAL_CONFIG_TIMEOUT_MS',
  process.env.OKF_RETRIEVAL_CONFIG_TIMEOUT_MS,
  3000,
  100
);

/** The fail-closed default: legacy mode, fan-out never engaged. */
function legacyDefaultConfig() {
  return {
    config: { mode: 'legacy' },
    source: 'bff-fail-closed-default',
    serving_graph_count: 0,
    serving_repo_ids: [],
    serving_graphs: [],
    engaged: false,
    warnings: []
  };
}

/** Typed 401 — the bearer is invalid/expired; callers must propagate it. */
class OkfAuthzUnauthorizedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OkfAuthzUnauthorizedError';
    this.statusCode = 401;
    this.code = 'OKF_UNAUTHORIZED';
  }
}

// ─── Cache-key derivation (scopes only — never the raw token) ────────────────

/**
 * Decode a JWT payload WITHOUT verification. The token was already verified by
 * the route's Keycloak middleware; this is for the CACHE KEY only — the actual
 * authz decision always comes from the okf-server's verified response.
 */
function decodeJwtPayload(bearerHeader) {
  const token = String(bearerHeader || '')
    .replace(/^\s*bearer\s+/i, '')
    .trim();
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Parse `okf:{tenant}:{repo}:{read|admin}` scopes from a JWT payload — the
 * SAME semantics as components/okf-server middleware/auth.js parseOkfScopes
 * (okf_scopes claim, array or space-joined, then the standard scope claim;
 * okf:-prefixed entries only; duplicates removed).
 */
function parseOkfScopes(payload) {
  const out = [];
  const seen = new Set();
  const push = (entry) => {
    if (typeof entry === 'string' && entry.startsWith('okf:') && !seen.has(entry)) {
      seen.add(entry);
      out.push(entry);
    }
  };
  const p = payload || {};
  if (Array.isArray(p.okf_scopes)) {
    p.okf_scopes.forEach((el) => {
      if (typeof el === 'string') el.split(/\s+/).forEach(push);
      else push(el);
    });
  } else if (typeof p.okf_scopes === 'string') {
    p.okf_scopes.split(/\s+/).forEach(push);
  }
  if (typeof p.scope === 'string') {
    p.scope.split(/\s+/).forEach(push);
  }
  return out;
}

/**
 * The scope-equivalence key: two callers whose tokens carry the same okf
 * scopes (and super-admin posture) get the same authz response, so they share
 * one cache entry. Scope order is normalized (sorted) — the resolver's
 * response is order-insensitive w.r.t. the scope list.
 */
function effectiveScopesKey(bearerHeader) {
  const payload = decodeJwtPayload(bearerHeader);
  if (!payload) {
    // Undecodable token — scope equivalence cannot be inferred; fall back to
    // a token-unique key so two distinct (already-invalid) tokens never share
    // an entry.
    const hash = nodeCrypto
      .createHash('sha256')
      .update(String(bearerHeader || ''))
      .digest('hex')
      .slice(0, 16);
    return `unparsed:${hash}`;
  }
  const isSuperAdmin = !!(
    payload.realm_access &&
    Array.isArray(payload.realm_access.roles) &&
    payload.realm_access.roles.includes('tools-admin')
  );
  const scopes = parseOkfScopes(payload).sort();
  return (isSuperAdmin ? ['@superadmin'] : []).concat(scopes).join('|') || '@no-scopes';
}

// ─── Cache + upstream ─────────────────────────────────────────────────────────

const _cache = new Map(); // "<window>|<kind>|<scopesKey>" → { window, value } | { window, throw }
let _lastGoodConfig = null; // last-known-good retrieval-config response

function currentWindow() {
  return Math.floor(Date.now() / RETRIEVAL_CONFIG_TTL_MS);
}

/** Drop entries from previous windows (bounded memory: callers × kinds per window). */
function pruneCache(window) {
  for (const [key, entry] of _cache) {
    if (entry.window !== window) _cache.delete(key);
  }
}

async function fetchUpstream(path, bearerHeader, correlationId) {
  const started = Date.now();
  const res = await axios.get(`${OKF_SERVER_URL}${path}`, {
    headers: { Authorization: bearerHeader },
    timeout: REQUEST_TIMEOUT_MS
  });
  logger.debug('RetrievalConfigClient.upstream_ok', {
    path,
    correlationId,
    duration_ms: Date.now() - started
  });
  return res.data;
}

/**
 * Resolve one endpoint through the window cache. On a cache miss the upstream
 * runs ONCE per window per (kind, scopes); the RESOLVED value — including a
 * policy-resolved failure — is what gets cached. A 401 is NEVER cached: a
 * refreshed token of the same caller shares the scopes key, and a cached 401
 * would lock them out until the window rolls.
 */
async function resolveCached(kind, bearerHeader, policy, opts = {}) {
  const correlationId = opts.correlationId || nodeCrypto.randomUUID();
  const window = currentWindow();
  const key = `${window}|${kind}|${effectiveScopesKey(bearerHeader)}`;

  const hit = _cache.get(key);
  if (hit && hit.window === window) {
    logger.debug('RetrievalConfigClient.cache_hit', { kind, correlationId });
    return hit.value;
  }

  let entry;
  try {
    const raw = await fetchUpstream(policy.path, bearerHeader, correlationId);
    entry = { window, value: policy.onSuccess(raw, opts) };
  } catch (err) {
    const resolved = policy.onFailure(err, correlationId, window);
    if (resolved.throw) throw resolved.error; // never cached — see docstring
    entry = { window, value: resolved.value };
  }
  _cache.set(key, entry);
  pruneCache(window);
  return entry.value;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * The retrieval posture for this caller: {config, source, serving_graph_count,
 * serving_repo_ids, serving_graphs, engaged, warnings} — the response verbatim
 * from the okf-server (the `engaged` flag is the AUTHORITATIVE engagement
 * signal; this client never re-computes the gate). On a 5xx/network failure:
 * last-known-good, else the legacy default. On 403: the legacy default (the
 * caller holds no okf read scope → empty per-caller serving view by
 * construction). On 401: throws OkfAuthzUnauthorizedError (propagate).
 */
async function getRetrievalConfig(bearerHeader, opts = {}) {
  return resolveCached(
    'retrieval-config',
    bearerHeader,
    {
      path: '/api/okf/retrieval-config',
      onSuccess(raw, callOpts) {
        // Shape gate: the response must carry the fields the BFF consumes
        // (config.mode + engaged at minimum). A garbled body degrades to the
        // legacy default instead of reaching the carrier logic.
        if (
          raw &&
          typeof raw === 'object' &&
          raw.config &&
          typeof raw.config.mode === 'string' &&
          typeof raw.engaged === 'boolean'
        ) {
          _lastGoodConfig = raw;
          return raw;
        }
        logger.warn('RetrievalConfigClient.malformed_config_response', {
          correlationId: callOpts?.correlationId
        });
        return legacyDefaultConfig();
      },
      onFailure(err, cid, window) {
        const status = err?.response?.status;
        if (status === 401 || err instanceof OkfAuthzUnauthorizedError) {
          return { throw: true, error: new OkfAuthzUnauthorizedError(err.message) };
        }
        if (status === 403) {
          // No okf read scope → the per-caller serving view is empty by
          // construction (zero-hit guarantee); legacy path is the correct
          // posture for this caller.
          logger.info('RetrievalConfigClient.caller_without_okf_scope', { correlationId: cid });
          return { value: legacyDefaultConfig() };
        }
        logger.warn('RetrievalConfigClient.retrieval_config_unreachable', {
          correlationId: cid,
          status: status || err?.code || err?.message,
          last_known_good: Boolean(_lastGoodConfig)
        });
        return { window, value: _lastGoodConfig || legacyDefaultConfig() };
      }
    },
    opts
  );
}

/**
 * The caller's traversable serving-graph set: {graph_names[], per_graph_labels,
 * domains, repos, superadmin, generated_at, ttl_seconds}. Only meaningful when
 * the retrieval-config response carried engaged: true. On 403/5xx/network:
 * {graph_names: []} (fail-closed — the caller's okf_only posture is still
 * enforced by the BFF's exclude_legacy signal, independent of this result).
 * On 401: throws OkfAuthzUnauthorizedError (propagate).
 */
async function getAuthorizedGraphs(bearerHeader, opts = {}) {
  return resolveCached(
    'authz-graphs',
    bearerHeader,
    {
      path: '/api/okf/authz/graphs',
      onSuccess(raw, callOpts) {
        if (raw && Array.isArray(raw.graph_names)) return raw;
        logger.warn('RetrievalConfigClient.malformed_authz_response', {
          correlationId: callOpts?.correlationId
        });
        return { graph_names: [] };
      },
      onFailure(err, cid) {
        const status = err?.response?.status;
        if (status === 401 || err instanceof OkfAuthzUnauthorizedError) {
          return { throw: true, error: new OkfAuthzUnauthorizedError(err.message) };
        }
        logger.warn('RetrievalConfigClient.authz_graphs_unavailable', {
          correlationId: cid,
          status: status || err?.code || err?.message
        });
        return { value: { graph_names: [] } };
      }
    },
    opts
  );
}

/** Test hook: drop the window cache + last-known-good (no production caller). */
function _resetCache() {
  _cache.clear();
  _lastGoodConfig = null;
}

module.exports = {
  getRetrievalConfig,
  getAuthorizedGraphs,
  OkfAuthzUnauthorizedError,
  legacyDefaultConfig,
  _resetCache,
  // Exposed for tests/diagnostics only — production code reads nothing here.
  _internals: {
    effectiveScopesKey,
    parseOkfScopes,
    decodeJwtPayload,
    currentWindow,
    OKF_SERVER_URL,
    RETRIEVAL_CONFIG_TTL_MS,
    REQUEST_TIMEOUT_MS
  }
};
