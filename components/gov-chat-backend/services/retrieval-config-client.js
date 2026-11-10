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
// (ttl_window, endpoint kind, effective_scopes) — scope-equivalence inference is safe because
// the authz-resolver already filters by the caller's authorized_repo_ids; the
// cache is the latency optimization, NOT a separate authz layer. Keys are
// NEVER the raw bearer token (no isolation benefit, unbounded memory).
//
// Failure policy (fail-closed — never escalates to fan-out on a config
// outage): 401 propagates (the request itself is invalid — no silent legacy
// fallback); 403 means the caller holds no okf read scope OR the deployment
// runs OKF_SCOPE_MODE=closed (default-deny) — either way the per-caller
// serving view is empty by construction → legacy default; 5xx/network, or a
// 200 whose body fails the shape/vocabulary gate (a garbled upstream) →
// the locally synthesized fail-closed composition carrying the last-known
// mode (source 'bff-last-known-good'), else the legacy default
// (mode=legacy, engaged=false).
// The resolved value (including the failure-resolved one) is cached for the
// remainder of the TTL window — ONE upstream attempt per scope-equivalent
// caller per window: a cold-window miss publishes its in-flight attempt in
// the cache BEFORE the upstream answers, so concurrent misses await that
// attempt instead of each burning the full timeout budget (the outage case,
// where every attempt costs the request timeout).
// The last-known-good carries only the deployment-global posture (the
// mode), never a per-caller view — the full invariant is stated at the
// write site in getRetrievalConfig's onSuccess. The per-caller graph set
// always comes from the caller's own live authz call and is never served
// from last-known-good. The last-known-good is STALE-BOUNDED: it is trusted
// for LKG_MAX_AGE_MS after the last successful upstream read, then the
// legacy default takes over — a deployment-mode change during a long
// upstream outage must not shadow the real posture for the whole outage.

const axios = require('axios');
const nodeCrypto = require('crypto');
const { logger, parsePositiveInt } = require('../shared-lib');

/**
 * Local positive-int env parse (self-contained — no shared-lib symbol touched
 * at module load). Warn contract: the WARN fires ONLY when a PROVIDED,
 * non-empty value fails to parse or sits below `min` — that is an operator
 * typo and must be visible, never silently swallowed. Two shapes stay silent:
 * a provided value equal to the fallback (a VALID configuration — matching
 * the default is not a misconfiguration) and an empty string (indistinguishable
 * from unset, which is also silent).
 */
function envPositiveInt(varName, rawValue, fallback, min) {
  // Wraps shared-lib's parsePositiveInt (one env-int policy in the repo —
  // review 2026-10-29); the warn-on-misconfiguration behaviour stays local.
  const n = parsePositiveInt(rawValue, fallback, { min });
  const provided = rawValue !== undefined && rawValue !== null && rawValue !== '';
  const parsed = Number.parseInt(rawValue, 10);
  if (provided && (Number.isNaN(parsed) || parsed < min)) {
    logger.warn('RetrievalConfigClient.invalid_env_int', {
      variable: varName,
      value: String(rawValue),
      applied_fallback: fallback
    });
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
// How long the last-known-good posture stays TRUSTED after the last successful
// upstream read (issue #1683). The copy is a short-lived cache, not a durable
// mirror of the deployment config: past this horizon the BFF degrades to the
// legacy default, so a deployment-mode change (a flip to/from okf_only) is
// picked up within minutes instead of being shadowed for the whole outage.
// A FIXED horizon, deliberately NOT derived from the cache TTL: that knob tunes
// how fresh the CACHE is, and an operator raising it to cut upstream load must
// not silently widen the window in which an unverified posture is trusted.
const LKG_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * OKF feature flag (2026-10-21, merge prep): OKF_ENABLED=0 parks the OKF
 * stack (containers, Kong route, UI). The fail-safe paths below already
 * degrade to the legacy default on connection failure — but with the
 * okf-server parked every caller would burn one 3s connection attempt per
 * TTL window and log a warn about it. This short-circuit resolves the same
 * legacy answer with no attempt and no noise. Read once at module load,
 * like the other constants.
 */
// Dark-launch polarity (review 2026-10-29): DISABLED when unset. The
// dark-launch guarantee previously lived only in docker-compose's
// `${OKF_ENABLED:-0}` — any non-compose run (local `npm start`, a container
// whose env entry was dropped) silently flipped to enabled and burned a 3s
// connection attempt per TTL window against a parked okf-server. The flag is
// now stated once in compose and defaults to parked everywhere.
const OKF_ENABLED = (process.env.OKF_ENABLED ?? '0').trim() === '1';

/**
 * The fail-closed default: legacy mode, fan-out never engaged. `reason`
 * records WHY this client synthesized it — the payload carries it so a
 * consumer can tell a by-design default (OKF parked, a caller without okf
 * scopes) from a posture the client could not read (an unreachable upstream,
 * a garbled body).
 * @param {string} reason — 'parked' | 'caller_without_scope' |
 *   'malformed_response' | 'upstream_unreachable'. The default is the
 *   fail-safe direction: a reason-less composition still reads as a posture
 *   the client could NOT read (so it is warned about), never as a known one.
 */
function legacyDefaultConfig(reason = 'upstream_unreachable') {
  return {
    config: { mode: 'legacy' },
    source: 'bff-fail-closed-default',
    synthesis_reason: reason,
    serving_graph_count: 0,
    serving_repo_ids: [],
    serving_graphs: [],
    engaged: false,
    warnings: []
  };
}

/**
 * Was this composition synthesized because the deployment's posture could NOT
 * be read (an unreachable upstream, a garbled body)? The by-design defaults
 * (OKF parked, a caller without okf scopes) are NOT included: their legacy
 * answer is the correct posture, not an unknown one — a consumer that warns
 * on an unreadable posture must not fire per query in a parked deployment.
 * `synthesis_reason` is the single discriminant: every composition this
 * client synthesizes carries one, every upstream-read composition carries
 * none.
 * @param {object|null} config — a retrieval-config composition
 * @returns {boolean}
 */
function isPostureUnknown(config) {
  return config?.synthesis_reason === 'malformed_response' || config?.synthesis_reason === 'upstream_unreachable';
}

/**
 * Is `mode` a member of the vocabulary the RESPONSE ITSELF declares? The
 * okf-server publishes its mode enum next to the read-model (`modes`), so the
 * BFF checks membership against THAT — no second copy of the vocabulary in
 * the BFF (the cross-component duplication #1158 exists to remove). The mode
 * is checked EXACTLY as it arrived: the server's sanitizer treats a padded
 * value as garbled (safe default), and the BFF must agree rather than trim
 * it into an engaged fan-out. A response that declares no vocabulary (an
 * okf-server older than the enum's publication) is accepted as-is: the
 * upstream owns membership, this is the boundary check (issue #1690).
 * Against the SHIPPED okf-server this can never reject — the server's own
 * sanitizer maps every non-member mode (a padded one included) to 'legacy'
 * before publishing, so `config.mode` is always a member of the modes it
 * publishes. The check exists for VERSION SKEW: an old okf-server that
 * predates the enum's publication, or one whose sanitizer regressed, and a
 * BFF newer than both — the pair this MR ships cannot exercise it.
 * @param {object} raw — the upstream read-model
 * @param {string} mode — the mode the response carried, untrimmed
 */
function modeIsDeclared(raw, mode) {
  const declared = Array.isArray(raw.modes) ? raw.modes : null;
  return !declared || declared.includes(mode);
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
 * (okf_scopes claim, array or space-joined, then the standard scope claim,
 * then realm ROLE NAMES that ARE scope strings — Story 6-1c group grants;
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
  // Source 3 (Story 6-1c, DW-428, review 2026-10-29 round 3): realm ROLE
  // NAMES that ARE scope strings. The okf-server copy folds
  // `realm_access.roles` in — a user granted a scope-shaped role directly or
  // through a GROUP carries it there — so this copy must see the same set.
  // Missing it keyed a role-granted caller as scope-less (`[]`), colliding
  // with every scope-less caller on the shared authz cache entry.
  if (p.realm_access && Array.isArray(p.realm_access.roles)) {
    p.realm_access.roles.forEach(push);
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
  // JSON serialization keeps the key INJECTIVE over scope lists: a bare
  // delimiter join would collide the single literal scope "a|b" with the
  // two-scope set {a, b} — the scope grammar is not delimiter-free, so a
  // collided pair would share one cache entry and one per-caller payload.
  // The admin flag is a named field, never a member of the scope list —
  // the encoding must not depend on what a scope string can be.
  return JSON.stringify({ admin: isSuperAdmin, scopes });
}

// ─── Cache + upstream ─────────────────────────────────────────────────────────

const _cache = new Map(); // "<window>|<kind>|<scopesKey>" → { window, promise }
let _lastGoodConfig = null; // { config: { mode }, captured_at } — deployment-global posture from the last good retrieval-config

function currentWindow() {
  return Math.floor(Date.now() / RETRIEVAL_CONFIG_TTL_MS);
}

/**
 * Drop entries from OLDER windows (bounded memory: callers × kinds per
 * window). Only STRICTLY older entries go: an entry a concurrent caller
 * wrote in the CURRENT window must survive — dropping it would force that
 * caller to fetch again, so the cache would buy nothing exactly when the
 * upstream is slow.
 */
function pruneCache(window) {
  for (const [key, entry] of _cache) {
    if (entry.window < window) _cache.delete(key);
  }
}

/**
 * The last-known-good posture, if it is still TRUSTED. A copy captured more
 * than LKG_MAX_AGE_MS ago is dropped (#1683): past that horizon the
 * deployment's posture cannot be confirmed, and a mode change (a flip to or
 * from okf_only) must not be shadowed for the whole outage.
 * @returns {object|null}
 */
function freshLastGoodConfig() {
  if (!_lastGoodConfig) return null;
  return Date.now() - _lastGoodConfig.captured_at > LKG_MAX_AGE_MS ? null : _lastGoodConfig;
}

async function fetchUpstream(path, bearerHeader, correlationId) {
  // Egress guard (review 2026-10-29): `path` is a hard-coded constant at
  // every call site today — reject anything that could turn the fixed-base
  // concatenation into an arbitrary URL, so a future caller cannot.
  if (typeof path !== 'string' || path.includes('://')) {
    throw new Error(`retrieval-config-client: rejected non-relative path: ${String(path).slice(0, 80)}`);
  }
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
 * One upstream attempt: fetch + policy resolution. Never touches the cache —
 * the published path wraps this, and so does a joiner's own-attempt fallback
 * (a retry that published would re-create exactly the cross-caller
 * inheritance the fallback exists to prevent).
 */
async function attemptUpstream(policy, bearerHeader, opts, correlationId) {
  try {
    const raw = await fetchUpstream(policy.path, bearerHeader, correlationId);
    // The generated id reaches the policy callbacks even when the caller
    // omitted one — the malformed-response warns would otherwise log a
    // correlationId the upstream_ok debug line cannot be matched with.
    return policy.onSuccess(raw, { ...opts, correlationId });
  } catch (err) {
    const resolved = policy.onFailure(err, correlationId);
    if (resolved.throw) throw resolved.error; // never cached — see docstring
    return resolved.value;
  }
}

/**
 * Resolve one endpoint through the window cache. On a cache miss the upstream
 * runs ONCE per window per (kind, scopes): the attempt is published in the
 * cache BEFORE it settles, so concurrent cold-window misses await THAT
 * attempt instead of starting one each (each attempt costs the full request
 * timeout when the upstream is down). The attempt's RESULT — including a
 * policy-resolved failure — is what the cache serves for the window.
 *
 * Two guarantees survive the sharing:
 * - A 401 is NEVER served from a shared attempt to a caller whose own token
 *   was never tested: the attempt ran with the INITIATOR's bearer, so a
 *   joiner that sees its 401 runs its OWN attempt — outside the cache, where
 *   it can neither join another caller's attempt nor be joined by one.
 * - A composition that stamps a `_bff_expires_at` on itself (the
 *   last-known-good posture) is re-validated at SERVE time, so a window
 *   longer than the horizon cannot keep serving it. The marker is namespaced:
 *   it belongs to the BFF's own composition, never to the upstream's
 *   read-model, so a future upstream field of the same name cannot be read
 *   as a composition expiry.
 */
async function resolveCached(kind, bearerHeader, policy, opts = {}) {
  const correlationId = opts.correlationId || nodeCrypto.randomUUID();
  const window = currentWindow();
  // Injective composite: window (digits) and kind (a hard-coded literal)
  // never contain '|', and the scopes segment is a self-delimiting JSON
  // document — the separator cannot shift a boundary between segments.
  const key = `${window}|${kind}|${effectiveScopesKey(bearerHeader)}`;

  const hit = _cache.get(key);
  if (hit) {
    // The entry holds the ATTEMPT (settled or still in flight), not just its
    // result — awaiting it is what shares one upstream call. The debug label
    // says which: a join of an IN-FLIGHT attempt must not read as a hit in
    // an incident timeline (during an outage nothing has answered yet).
    logger.debug(hit.settled ? 'RetrievalConfigClient.cache_hit' : 'RetrievalConfigClient.cache_join', {
      kind,
      correlationId
    });
    let value;
    try {
      value = await hit.promise;
    } catch (err) {
      // The shared attempt ran with the INITIATOR's bearer: its 401 says
      // nothing about OUR token (a refreshed token of the same caller shares
      // the scopes key — the invariant the docstring above protects). Run
      // our OWN attempt, outside the cache. This catch sees only the SHARED
      // attempt: the expiry re-resolution below happens after it, so a 401
      // from the caller's own re-resolution propagates directly.
      if (err instanceof OkfAuthzUnauthorizedError) {
        return attemptUpstream(policy, bearerHeader, opts, correlationId);
      }
      throw err;
    }
    if (value?._bff_expires_at && Date.now() > value._bff_expires_at) {
      // The composition carried an expiry that passed while the entry sat
      // cached (a window longer than the horizon): drop the entry and
      // resolve again — the fresh attempt finds no trusted posture and
      // takes the fail-closed default.
      if (_cache.get(key) === hit) _cache.delete(key);
      return resolveCached(kind, bearerHeader, policy, opts);
    }
    return value;
  }

  const entry = { window, promise: null, settled: false };
  entry.promise = attemptUpstream(policy, bearerHeader, opts, correlationId);
  _cache.set(key, entry);
  entry.promise.catch(() => {
    // A 401 is never retained: the entry goes, so the next caller attempts
    // again with its own (possibly refreshed) token.
    if (_cache.get(key) === entry) _cache.delete(key);
  });
  const value = await entry.promise;
  entry.settled = true;
  pruneCache(currentWindow());
  return value;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * The retrieval posture for this caller: {config, source, serving_graph_count,
 * serving_repo_ids, serving_graphs, engaged, warnings} — the response verbatim
 * from the okf-server (the `engaged` flag is the AUTHORITATIVE engagement
 * signal; this client never re-computes the gate). On a 5xx/network failure,
 * or a 200 whose body fails the shape/vocabulary gate (a garbled upstream):
 * the fail-closed composition carrying the last-known mode (source
 * 'bff-last-known-good'), else the legacy default. On 403: the legacy
 * default (the caller holds no okf read scope → empty per-caller serving
 * view by construction). On 401: throws OkfAuthzUnauthorizedError (propagate).
 */
async function getRetrievalConfig(bearerHeader, opts = {}) {
  if (!OKF_ENABLED) return legacyDefaultConfig('parked');
  return resolveCached(
    'retrieval-config',
    bearerHeader,
    {
      path: '/api/okf/retrieval-config',
      onSuccess(raw, callOpts) {
        // Shape gate: the response must carry the fields the BFF consumes
        // (config.mode + engaged at minimum). A garbled body degrades to the
        // fail-closed composition instead of reaching the carrier logic —
        // the same stale-bounded last-known-good consultation an unreachable
        // upstream gets (both are transport-adjacent failures; nothing the
        // garbled payload SAID feeds the carrier, only the posture captured
        // from an earlier healthy read). The reason carried on the
        // composition stays 'malformed_response', so the telemetry still
        // tells a garbled body from a transport outage. The mode is
        // checked AS IT ARRIVED — never trimmed into a valid one: the
        // okf-server's own sanitizer treats a padded value as garbled (safe
        // default), and this client must not promote it into an engaged
        // fan-out the server would have refused. When the response declares
        // no vocabulary at all (an okf-server older than the enum's
        // publication) the mode is accepted as-is and stays untrimmed: a
        // value the downstream cannot match exactly can only ever take the
        // legacy branch (fail-safe), and the degraded branch now says so.
        const mode = typeof raw?.config?.mode === 'string' ? raw.config.mode : '';
        const shapeOk = !!(
          raw &&
          typeof raw === 'object' &&
          raw.config &&
          mode.trim() &&
          typeof raw.engaged === 'boolean'
        );
        if (shapeOk && modeIsDeclared(raw, mode)) {
          // The last-known-good copy is served to ANY caller on upstream
          // failure, so it carries only what the BFF consumes of the
          // deployment-global posture: the mode. Everything scope-derived
          // in the response (engaged, serving_graph_count, serving_repo_ids,
          // serving_graphs, warnings) is computed BY the okf-server FROM
          // this caller's scopes — carrying it in the shared copy would
          // hand one caller's serving view to another on an outage. Other
          // global fields (revision, tuning caps, updated_by) are simply
          // unconsumed here and stay out of the copy until a consumer needs
          // them — a field carried here must survive being served to every
          // caller, so it joins the copy together with its consumer.
          // The capture time bounds how long this copy stays trusted (#1683).
          _lastGoodConfig = { config: { mode }, captured_at: Date.now() };
          return raw;
        }
        const lkg = freshLastGoodConfig();
        logger.warn('RetrievalConfigClient.malformed_config_response', {
          correlationId: callOpts?.correlationId,
          reason: shapeOk ? 'mode_not_declared' : 'shape',
          last_known_good: Boolean(lkg),
          last_known_good_age_ms: _lastGoodConfig ? Date.now() - _lastGoodConfig.captured_at : null
        });
        // A garbled body is a transport-adjacent failure exactly like an
        // unreachable upstream: the same last-known-good consultation
        // applies. Without it, an okf_only deployment whose upstream answers
        // an unreadable body silently serves the legacy corpus the deployment
        // excluded — the one failure shape that downgraded the governance
        // posture instead of failing closed. The reason stays
        // 'malformed_response': the warn log and the warning payload must
        // still tell a garbled body from a transport outage.
        if (!lkg) return legacyDefaultConfig('malformed_response');
        return {
          ...legacyDefaultConfig('malformed_response'),
          config: { mode: lkg.config.mode },
          source: 'bff-last-known-good',
          _bff_expires_at: lkg.captured_at + LKG_MAX_AGE_MS
        };
      },
      onFailure(err, cid) {
        const status = err?.response?.status;
        if (status === 401 || err instanceof OkfAuthzUnauthorizedError) {
          return { throw: true, error: new OkfAuthzUnauthorizedError(err.message) };
        }
        if (status === 403) {
          // No okf read scope → the per-caller serving view is empty by
          // construction (zero-hit guarantee); legacy path is the correct
          // posture for this caller.
          logger.info('RetrievalConfigClient.caller_without_okf_scope', { correlationId: cid });
          return { value: legacyDefaultConfig('caller_without_scope') };
        }
        const lkg = freshLastGoodConfig();
        logger.warn('RetrievalConfigClient.retrieval_config_unreachable', {
          correlationId: cid,
          status: status || err?.code || err?.message,
          last_known_good: Boolean(lkg),
          last_known_good_age_ms: _lastGoodConfig ? Date.now() - _lastGoodConfig.captured_at : null
        });
        if (!lkg) return { value: legacyDefaultConfig('upstream_unreachable') };
        // The deployment-global posture survives the outage; everything
        // else is locally synthesized (fail-closed) and says so: the
        // source label marks the payload as the BFF's own last-known-good
        // composition, not the upstream's. `_bff_expires_at` is when the
        // POSTURE it carries stops being trusted — the cache re-validates it
        // at serve time, so a window longer than the horizon cannot keep
        // serving it (#1683).
        return {
          value: {
            ...legacyDefaultConfig('upstream_unreachable'),
            config: { mode: lkg.config.mode },
            source: 'bff-last-known-good',
            _bff_expires_at: lkg.captured_at + LKG_MAX_AGE_MS
          }
        };
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
  if (!OKF_ENABLED) return { graph_names: [] };
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

module.exports = {
  getRetrievalConfig,
  getAuthorizedGraphs,
  OkfAuthzUnauthorizedError,
  isPostureUnknown,
  // Exposed for the tests that pin them — production code reads nothing here.
  _internals: {
    effectiveScopesKey,
    parseOkfScopes,
    fetchUpstream, // exposed so the egress guard (wave 2) can be pinned by a test
    REQUEST_TIMEOUT_MS,
    LKG_MAX_AGE_MS
  }
};
