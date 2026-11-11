const https = require('https');
const { chromium } = require('@playwright/test');
const { loginViaUI, TEST_USER, BASE_URL } = require('./chatbot');
const { venueLaunchArgs } = require('./venue-launch-args');

/**
 * Make an HTTPS request ignoring self-signed certificate errors.
 * @param {string} method - HTTP method
 * @param {string} path - URL path
 * @param {object} [options] - Additional options (headers, body)
 * @returns {Promise<{status: number, data: object, headers: object}>}
 */
function request(method, path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const reqOptions = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method,
      rejectUnauthorized: false,
      timeout: 30000,
      headers: options.headers || {},
      // One socket per request. The global agent keeps sockets alive
      // (Node >= 19), and an endpoint that does not consume the request
      // body — Keycloak's DELETE on the role-mappings collection — leaves
      // that body in the socket: the NEXT request on the same connection
      // is then read as a malformed one and answers 400 Bad Request.
      agent: false,
    };

    const req = https.request(reqOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        // A non-JSON body is a broken endpoint, not a usable value: resolve
        // with the raw text and the caller's status guard would report a
        // misleading failure. Fail here with the observed body instead. An
        // empty body resolves as null data — a 204-style success with no
        // payload is not malformed.
        if (body === '') {
          resolve({ status: res.statusCode, data: null, headers: res.headers });
          return;
        }
        // A raw read: the caller wants the body AS TEXT (the runtime
        // config is JavaScript, not JSON). The JSON parser below must not
        // reject it.
        if (options.raw) {
          resolve({ status: res.statusCode, data: body, headers: res.headers });
          return;
        }
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body), headers: res.headers });
        } catch {
          const error = new Error(
            `${method} ${path} returned a non-JSON body (HTTP ${res.statusCode}): ${body.slice(0, 200)}`
          );
          // The endpoint answered — it just did not answer with JSON. The
          // status travels with the error: the retry verdict follows the
          // server's state (a 5xx is an outage a retry may survive), not
          // the content type. A rejection without a status is a transport
          // failure.
          error.nonJsonBody = true;
          error.status = res.statusCode;
          reject(error);
        }
      });
    });

    req.on('error', reject);

    // https.request's timeout option only starts the clock — without a
    // handler the stalled socket is never destroyed and the promise
    // hangs past the 30s budget.
    req.on('timeout', () => {
      req.destroy(new Error(`Request timed out after ${reqOptions.timeout}ms: ${method} ${path}`));
    });

    if (options.body) {
      const bodyStr = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      req.setHeader('Content-Type', options.contentType || 'application/json');
      req.write(bodyStr);
    }
    req.end();
  });
}

/**
 * Get a Keycloak admin token from the master realm.
 * Uses admin-cli client with password grant.
 * @param {string} [adminPassword] - Keycloak admin password (defaults to
 *   env KEYCLOAK_ADMIN_PASSWORD; the env ADMIN_TOKEN wins over the
 *   environment's password, an explicit argument wins over both)
 * @returns {Promise<string>} Access token string
 */
async function getAdminToken(adminPassword) {
  // ADMIN_TOKEN is the runner's alternative to the password, and it WINS
  // over the environment's password (an explicit argument still wins over
  // both) - the same precedence the provisioning script uses. One
  // precedence everywhere matters: the fixtures would be provisioned with
  // one credential while the venue-profile probes minted another, and the
  // probes would answer 401.
  const token = process.env.ADMIN_TOKEN;
  if (!adminPassword && token) {
    return token;
  }
  const password = adminPassword || process.env.KEYCLOAK_ADMIN_PASSWORD;
  if (!password) {
    throw new Error('KEYCLOAK_ADMIN_PASSWORD env var is required');
  }

  const body = new URLSearchParams({
    client_id: 'admin-cli',
    grant_type: 'password',
    username: 'admin',
    password,
  }).toString();

  const res = await request('POST', '/auth/realms/master/protocol/openid-connect/token', {
    body,
    contentType: 'application/x-www-form-urlencoded',
  });

  if (res.status !== 200) {
    throw new Error(`Failed to get admin token: ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res.data.access_token;
}

// Remediation hint shared by the two getUserToken guards below.
const ROPC_REALM_HINT =
  'pass { realm: <test-realm> } for a test-only realm provisioned with ' + 'enableDirectAccessGrants';

/**
 * Get a user token via ROPC (Resource Owner Password Credentials).
 *
 * Only works on realms whose client has directAccessGrantsEnabled —
 * i.e. test-only realms like `genie2` whose spec provisions the grant
 * (see enableDirectAccessGrants). The primary `genie` realm refuses
 * ROPC by design; use getSessionTokenViaUI there.
 * @param {string} username - Keycloak username
 * @param {string} password - User password
 * @param {object} [options] - Optional overrides
 * @param {string} options.realm - Keycloak realm (REQUIRED, ROPC-enabled)
 * @param {string} [options.clientId='genie-app'] - Keycloak client ID
 * @returns {Promise<string>} Access token string
 */
async function getUserToken(username, password, options = {}) {
  const realm = options.realm;

  if (!realm) {
    throw new Error(`getUserToken: realm is required — ${ROPC_REALM_HINT}`);
  }
  if (realm === 'genie') {
    throw new Error(
      `getUserToken: realm 'genie' refuses ROPC by design — mint a ` +
        `primary-realm token with getSessionTokenViaUI, or ${ROPC_REALM_HINT}`
    );
  }
  const clientId = options.clientId || 'genie-app';

  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'password',
    username,
    password,
  }).toString();

  const res = await request('POST', `/auth/realms/${encodeURIComponent(realm)}/protocol/openid-connect/token`, {
    body,
    contentType: 'application/x-www-form-urlencoded',
  });

  if (res.status !== 200) {
    throw new Error(`Failed to get user token: ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res.data.access_token;
}

/**
 * Read the access token held by a page's own login session.
 *
 * Direct access grants (ROPC) are disabled on the realm by design, so a
 * spec that already logged in through the browser must reuse that
 * session's token instead of minting a second one with getUserToken.
 * oidc-client-ts persists its user under a `oidc.user:` key in
 * sessionStorage on this app.
 * @param {import('@playwright/test').Page} page - A logged-in page
 * @returns {Promise<string>} Access token string
 * @throws {Error} When the page session carries no token (not logged in)
 */
async function getSessionToken(page) {
  const { token, parseError } = await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find((k) => k.startsWith('oidc.user:'));
    if (!key) return { token: null };
    try {
      const user = JSON.parse(sessionStorage.getItem(key));
      return { token: user?.access_token || null };
    } catch (e) {
      return { token: null, parseError: e.message };
    }
  });

  if (!token) {
    throw new Error(
      'No access token in the page session — the page is not logged in' +
        (parseError ? ` (the oidc.user entry is not valid JSON: ${parseError})` : '')
    );
  }
  return token;
}

// Ceiling for suites that mint session tokens through a browser login:
// on a stalled stack one login cycle costs ≈135s (two attempts of 30s
// navigation + 15s redirect wait + retry budget), and a beforeAll can
// stack admin-API requests (each at the 30s request cap) on top of it.
// Apply with test.describe.configure({ timeout: ... }) for the tests
// and test.setTimeout(...) inside beforeAll — hooks read the project
// timeout, not the suite timeout.
const SESSION_MINT_TIMEOUT_MS = 360000;

/**
 * Ceiling for the delete fan-out of a cleanup sweep.
 *
 * The sweep must fit TWO limits, and they are not the same clock:
 *
 *  - the HOOK's budget (360 s) counts everything, including the login
 *    that mints the token (≈135 s on a stalled stack);
 *  - the TOKEN's life (300 s) starts when that login COMPLETES, so it
 *    covers only the work after the mint.
 *
 * After the mint the sweep lists the population (≤ 2 pages at the 30 s
 * request cap = 60 s) and deletes the suite's own files (50 deletes in
 * waves of 10 = 5 × 30 s = 150 s): 210 s, inside the token's 300 s.
 * With the login counted, 135 + 60 + 150 = 345 s, inside the hook's
 * 360 s.
 *
 * The bound is that arithmetic and nothing else. The deletes hit
 * DISTINCT documents, and ArangoDB takes its write locks per document —
 * a fan-out over distinct documents does not inherently conflict (the
 * write-conflict code is 1200, not 1201). A wider wave would fit more
 * deletes in less time; the width stays at 10 so the sweep remains a
 * modest load on a shared stack.
 */
const SWEEP_DELETE_CONCURRENCY = 10;

/**
 * How many pages of the population a cleanup sweep enumerates.
 *
 * One page is not enough to know what the sweep owns. Both list
 * endpoints search a SUPERSET of the suite's own files: doc-repo matches
 * CONTAINS(LOWER(file_name)) OR CONTAINS(LOWER(source_url)), and the
 * conversation list matches LIKE over title OR lastMessage OR category.
 * A sweep that stops at the first page therefore cannot tell "the files
 * beyond the page are not mine" from "the files beyond the page are mine
 * and were not removed" — and the second one is a leftover. Two pages
 * cover a population of 100, twice the delete budget below; beyond that
 * the sweep says it could not enumerate the whole population.
 */
const SWEEP_MAX_LIST_PAGES = 2;

/**
 * How many of the suite's own files one sweep deletes.
 *
 * 50 deletes in waves of 10 cost 5 × 30 s = 150 s, which is what the
 * budget above is sized for. A bigger delete set overruns the hook's
 * budget, so the sweep deletes what fits and REPORTS the rest — a
 * leftover is reported, never dropped.
 */
const SWEEP_MAX_DELETES = 50;

/**
 * Map `fn` over `items`, at most `limit` calls in flight at a time. The
 * results keep the input order, so a failure report reads the same way
 * whatever order the calls completed in.
 *
 * Safe by construction: a call that THROWS does not abandon the rest of
 * the items — every item is attempted, and the first failure is
 * rethrown once the whole batch has run. A worker that died on its
 * first item would otherwise leave the remaining items untouched, and
 * the sweep would report a partial deletion as a complete one.
 *
 * @param {Array} items - the items to map
 * @param {number} limit - the maximum number of calls in flight
 * @param {Function} fn - called with (item, index); its result is kept
 * @returns {Promise<Array>} the results, in the input order
 */
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  const failures = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index], index);
      } catch (e) {
        failures.push({ index, error: e });
      }
    }
  });
  await Promise.all(workers);
  if (failures.length > 0) {
    throw failures[0].error;
  }
  return results;
}

/**
 * Log in through the UI in a throwaway session and return that session's
 * access token — the cleanup paths' replacement for minting a token with
 * ROPC, which the realm refuses by design.
 * @param {object} [options]
 * @param {import('@playwright/test').Browser} [options.browser] - Reuse this
 *        browser; launches a throwaway chromium when omitted.
 * @param {{username: string, password: string}} [options.user] - Defaults to
 *        TEST_USER.
 * @returns {Promise<string>} Access token string
 */
async function getSessionTokenViaUI({ browser, user } = {}) {
  let ownBrowser = null;
  let context = null;
  try {
    // The throwaway browser carries the venue mapping (empty unless
    // E2E_VENUE_IP is set): Chromium resolves hostnames with its own stack,
    // so a browser launched without it cannot open a venue whose name the
    // runner cannot resolve.
    ownBrowser = browser ? null : await chromium.launch({ args: venueLaunchArgs() });
    context = await (browser || ownBrowser).newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await loginViaUI(page, user || TEST_USER);
    return await getSessionToken(page);
  } finally {
    if (ownBrowser) await ownBrowser.close();
    else if (context) await context.close();
  }
}

/**
 * Parse JWT claims without verification (decode payload only).
 * @param {string} token - JWT token string
 * @returns {object} Decoded claims object
 */
function parseJwtClaims(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('Invalid JWT: token must be a non-empty string');
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format: expected 3 parts');
  }
  try {
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payload);
  } catch (e) {
    throw new Error(`Invalid JWT payload: ${e.message}`, { cause: e });
  }
}

module.exports = {
  getAdminToken,
  getUserToken,
  getSessionToken,
  getSessionTokenViaUI,
  parseJwtClaims,
  request,
  mapWithConcurrency,
  SESSION_MINT_TIMEOUT_MS,
  SWEEP_DELETE_CONCURRENCY,
  SWEEP_MAX_LIST_PAGES,
  SWEEP_MAX_DELETES,
};
