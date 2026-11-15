// shared-lib/client-credentials.js
// ONE client-credentials token minter (#1168, DW-438) — the cache,
// single-flight refresh, endpoint failover and the expiry buffer live HERE,
// so the three components that mint service-account tokens cannot drift:
//
//   - okf-server service-token.js (the reference shape: expiry + 30 s buffer,
//     single-flight, ordered endpoint failover with winner memory)
//   - okf-server keycloak-access-service.js (was expiry-BLIND: cached the
//     token string and let the 401 retry discover expiry on the wire)
//   - gov-chat-backend keycloak-proxy-service.js (same expiry-blind shape)
//
// The raw mint transport is injectable. The default speaks fetch with an
// AbortSignal timeout and honors NODE_TLS_REJECT_UNAUTHORIZED (Node's fetch
// implementation reads it). A consumer whose mint needs more — the TLS
// skip-verify escape hatch (KEYCLOAK_SSL_VERIFY et al) rides an axios agent
// in okf-server — injects `mintAt(endpoint)` and keeps that behavior
// verbatim while the cache/failover core still comes from here.

/**
 * @typedef {Object} MinterOptions
 * @property {string} clientId            OAuth client_id (required)
 * @property {string} clientSecret        OAuth client_secret ('' = unconfigured)
 * @property {string[]} tokenEndpoints    Ordered candidate token URLs; the
 *   first success is remembered and tried FIRST on the next refresh
 *   (failover memory), the rest in order.
 * @property {number} [bufferSeconds=30]  Refresh this many seconds before
 *   the token's own expiry.
 * @property {number} [timeoutMs=10000]   Per-mint abort timeout.
 * @property {(endpoint: string) => Promise<{access_token: string, expires_in?: number}>} [mintAt]
 *   The raw mint transport. Default: fetch POST of the client_credentials
 *   form. Receives ONE endpoint; throws on failure (the factory collects
 *   every candidate's failure into the error it raises).
 * @property {Console|{info:Function, warn:Function, error:Function}} [logger]
 * @property {() => number} [now]         Clock (tests).
 */

function createClientCredentialsMinter(options) {
  const {
    clientId,
    clientSecret,
    tokenEndpoints,
    bufferSeconds = 30,
    timeoutMs = 10000,
    mintAt = null,
    logger = console,
    now = Date.now
  } = options || {};

  if (!clientId || typeof clientId !== 'string') {
    throw new Error('client-credentials minter: clientId is required');
  }
  // Endpoints may legitimately arrive empty: a consumer derives them from
  // env that a test environment has not set. The failure must surface at
  // USE time (getToken), not as a module-load bomb in the consumer.
  const endpoints = Array.isArray(tokenEndpoints) ? tokenEndpoints.filter(Boolean) : [];

  // Lazy default transport: fetch POST of the client_credentials form.
  // Defined per-call-site so a consumer injecting mintAt never pays for it.
  const defaultMintAt = async (endpoint) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
      const text = await response.text();
      const err = new Error(`token endpoint answered ${response.status}: ${text.slice(0, 200)}`);
      err.status = response.status;
      throw err;
    }
    const data = await response.json();
    if (!data || !data.access_token) {
      throw new Error('token endpoint response missing access_token');
    }
    return data;
  };

  const mint = mintAt || defaultMintAt;

  function isConfigured() {
    return Boolean(clientSecret);
  }

  // --- the shared cache/failover core -------------------------------------
  let cachedToken = null;
  let tokenExpiry = 0;
  let mintPromise = null;
  let winnerEndpoint = null; // failover memory: the endpoint that last minted

  /** Mint across the candidates: the last-known-good endpoint FIRST, then
   * the configured order. Every failure is COLLECTED into the thrown
   * message — a bare "token request failed" hides WHICH endpoint was
   * unreachable, and the console formatter strips metadata. */
  async function mintAcrossEndpoints() {
    if (endpoints.length === 0) {
      throw new Error('client-credentials minter: no token endpoint configured (the consumer derived none from env)');
    }
    const candidates = [...new Set([winnerEndpoint, ...endpoints].filter(Boolean))];
    const failures = [];
    for (const endpoint of candidates) {
      try {
        const data = await mint(endpoint);
        cachedToken = data.access_token;
        const expiresIn = Number(data.expires_in) > 0 ? Number(data.expires_in) : 300;
        tokenExpiry = now() + expiresIn * 1000;
        winnerEndpoint = endpoint;
        logger.info('client-credentials token minted', {
          client_id: clientId,
          expires_in: data.expires_in,
          endpoint
        });
        return cachedToken;
      } catch (err) {
        failures.push(`${endpoint} (${err.message})`);
      }
    }
    throw new Error(
      `client-credentials token request failed for ${failures.length} endpoint(s): ${failures.join('; ')}`
    );
  }

  /**
   * A valid access token: cached until `expires_in - bufferSeconds`, with a
   * single-flight refresh (concurrent callers share one mint). Deliberately
   * NOT gated on isConfigured(): minting with whatever credentials the
   * consumer holds is the caller's policy (the historical minters minted
   * unconditionally; a misconfigured mint fails at the token endpoint with
   * that endpoint's own answer).
   * @param {boolean} [forceRefresh=false]
   * @returns {Promise<string>}
   */
  async function getToken(forceRefresh = false) {
    if (cachedToken && !forceRefresh && now() < tokenExpiry - bufferSeconds * 1000) {
      return cachedToken;
    }
    if (!mintPromise) {
      mintPromise = mintAcrossEndpoints().finally(() => {
        mintPromise = null;
      });
    }
    return mintPromise;
  }

  /** Drop the cached token — the 401-retry path (the cached token was
   * rejected downstream; the next getToken mints fresh). */
  function invalidate() {
    cachedToken = null;
    tokenExpiry = 0;
  }

  return {
    getToken,
    invalidate,
    isConfigured,
    _resetForTesting() {
      invalidate();
      mintPromise = null;
      winnerEndpoint = null;
    }
  };
}

module.exports = { createClientCredentialsMinter };
