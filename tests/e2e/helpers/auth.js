const https = require('https');
const { chromium } = require('@playwright/test');
const { loginViaUI, TEST_USER } = require('./chatbot');
// The venue's edge comes from the credential-free module: this file needs
// the edge and no credential, and the edge has one definition.
const { BASE_URL } = require('./base-url');
const { venueLaunchArgs } = require('./venue-launch-args');

/**
 * The edge's upstream-reset retry (#1847, operator-sanctioned — the one
 * transport-level exception tests/e2e/CLAUDE.md names): the k8s venue's
 * Envoy answers a keep-alive race about once per suite load — after
 * headers with its LOCAL plain-text 503, before them with a raw
 * ECONNRESET — and the idempotent methods are worth a bounded re-issue.
 * The full contract (the RFC 7231 method set, the stable reply signature,
 * no pause, the verbatim last outcome, product JSON 503s never retried)
 * is owned by this file's spec, auth-request.spec.js, over the real
 * transport.
 */
const EDGE_RESET_SIGNATURE = 'upstream connect error or disconnect/reset before headers';
const EDGE_RESET_MAX_ATTEMPTS = 3;
// The methods this suite actually drives, filtered to RFC 7231 idempotency:
// a re-sent request lands in the same state. POST is excluded — its outcome
// a re-send could not report honestly — and HEAD is excluded on both arms
// (its empty-body wire contract resolves before any body gate could fire,
// and it takes the bare-transport short-circuit below). OPTIONS and TRACE
// are idempotent but have no caller in this tree.
const IDEMPOTENT_METHODS = ['GET', 'DELETE', 'PUT'];

/** The edge's reset reply on the wire: a 503 whose body carries the STABLE
 *  prefix of Envoy's local reply (the volatile "reset reason: ..." clause
 *  is deliberately not matched). Both arms of the gate read the reply
 *  through this ONE predicate, so widening one arm cannot leave the other
 *  behind. */
function isEdgeResetReply(status, bodyText) {
  return (
    status === 503 &&
    typeof bodyText === 'string' &&
    bodyText.includes(EDGE_RESET_SIGNATURE)
  );
}

/** The rejection arm: the non-JSON guard rejected the edge's text reply,
 *  or the race landed before any headers (a raw ECONNRESET — Node does
 *  not distinguish a mid-body reset, which an idempotent re-issue also
 *  survives; the bound and the verbatim rethrow keep either shape
 *  honest). */
function isEdgeResetRetryEligible(method, error) {
  if (!IDEMPOTENT_METHODS.includes(method) || !error) {
    return false;
  }
  if (error.code === 'ECONNRESET') {
    return true;
  }
  return error.nonJsonBody === true && isEdgeResetReply(error.status, error.bodyText);
}

/** The resolution arm: with `options.raw` the body is the WANTED text, so
 *  the edge's reset reply reaches the caller as a RESOLVED 503 whose data
 *  is that text — the rejection arm never fires for that caller. A JSON
 *  content type is the endpoint's OWN verdict (a product envelope can
 *  quote the reset text verbatim) and is never retried. */
function isRawEdgeReset(method, res) {
  return (
    IDEMPOTENT_METHODS.includes(method) &&
    isEdgeResetReply(res.status, res.data) &&
    !/json/i.test(String((res.headers && res.headers['content-type']) || ''))
  );
}

/**
 * Make an HTTPS request ignoring self-signed certificate errors.
 * @param {string} method - HTTP method
 * @param {string} path - URL path
 * @param {object} [options] - Additional options (headers, body)
 * @returns {Promise<{status: number, data: object, headers: object}>}
 */
function request(method, path, options = {}) {
  const attempt = () => new Promise((resolve, reject) => {
    // Parsed INSIDE the executor: a path the URL parser refuses must
    // reject the promise — the helper's contract is to always return one
    // — not throw synchronously out of the call frame before a handler
    // could attach.
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
      agent: false
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
          // failure. The FULL body travels beside the message: the gate
          // reads bodyText, so a future rewording of this message's prose
          // cannot break the retry verdict.
          error.nonJsonBody = true;
          error.status = res.statusCode;
          error.bodyText = body;
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

  // A non-idempotent method can never retry: hand it the bare transport —
  // the gate's method set already says no, but the short-circuit makes the
  // POST contract visible in code, not only in two predicates.
  if (!IDEMPOTENT_METHODS.includes(method)) {
    return attempt();
  }
  let attemptsLeft = EDGE_RESET_MAX_ATTEMPTS;
  const run = () =>
    attempt()
      .catch((error) => {
        attemptsLeft -= 1;
        if (attemptsLeft > 0 && isEdgeResetRetryEligible(method, error)) {
          return run();
        }
        throw error;
      })
      .then((res) => {
        if (isRawEdgeReset(method, res)) {
          attemptsLeft -= 1;
          if (attemptsLeft > 0) {
            return run();
          }
        }
        return res;
      });
  return run();
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
    password
  }).toString();

  // The transport is read through the module object at CALL time — the
  // codebase's substitution idiom (keycloak-admin.js, venue-profile.js) —
  // so the no-access_token verdict below is unit-coverable offline
  // (#1842): the same function answers at runtime, a unit spec swaps it.
  const res = await module.exports.request('POST', '/auth/realms/master/protocol/openid-connect/token', {
    body,
    contentType: 'application/x-www-form-urlencoded'
  });

  if (res.status !== 200) {
    throw new Error(`Failed to get admin token: ${res.status} ${JSON.stringify(res.data)}`);
  }
  // A 200 without a token is the same failure class: every later realm
  // call would run without a token (a `Bearer undefined` header). A proxy
  // error page shaped as JSON answers like this.
  if (!res.data || !res.data.access_token) {
    throw new Error(
      `Failed to get admin token: the endpoint answered 200 without an access_token ` +
        `${JSON.stringify(res.data).substring(0, 300)}`
    );
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
    password
  }).toString();

  const res = await request('POST', `/auth/realms/${encodeURIComponent(realm)}/protocol/openid-connect/token`, {
    body,
    contentType: 'application/x-www-form-urlencoded'
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
 *  - the TOKEN's life (the realm's `accessTokenLifespan` — 300 s, the
 *    shipped default: `docker-compose.yaml` pins
 *    `KEYCLOAK_ACCESS_TOKEN_LIFESPAN:-300` and `configs/keycloak/
 *    genie-realm.yaml` feeds it into the realm; `deploy/ansible` leaves
 *    its own variable optional, so a deployment CAN run another value)
 *    starts when the token is ISSUED — during the OIDC code
 *    exchange inside the login redirect, BEFORE the mint returns. The
 *    window the sweep works in is therefore 300 s MINUS the gap between
 *    the issuance and the mint returning.
 *
 * After the mint the sweep lists the population (≤ 2 pages at the 30 s
 * request cap = 60 s) and deletes the suite's own files (50 deletes in
 * waves of 10 = 5 × 30 s = 150 s): 210 s of work, inside the token's
 * 300 s with ~90 s left for that gap. With the login counted, 135 + 60
 * + 150 = 345 s, inside the hook's 360 s.
 *
 * The wave width is bounded by the BUDGET and by what a shared stack
 * can take. The engine says how the contention behaves, and both
 * engines are in the field:
 *
 *  - RocksDB — the DEFAULT since ArangoDB 3.4, and what the venue's
 *    deployment passes explicitly (`--server.storage-engine=rocksdb`) —
 *    takes its locks per DOCUMENT: concurrent deletes of distinct
 *    documents do not conflict, and a conflict surfaces as a
 *    write-write conflict (error 1200; 1201 is "datfile sealed");
 *  - MMFiles — only where a deployment selects it explicitly — takes
 *    the write lock per COLLECTION. The conversation delete opens a
 *    write transaction over six collections (chat-history-service.js),
 *    so a wave of concurrent deletes serialises on that lock and the
 *    waits grow with the wave width until the transaction lock timeout
 *    surfaces.
 *
 * Ten at a time is what the budget above is sized for, and it keeps the
 * fan-out a modest load on a shared stack — on either engine.
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
 * and were not removed" — and the second one is a leftover.
 *
 * Two pages are what the sweep enumerates: 100 files for the doc-repo
 * sweep (its endpoint caps `limit` at 50) and 200 conversations for the
 * chat sweep (its endpoint accepts 100). The delete budget below is a
 * separate cap. Beyond the two pages the sweep says it could not
 * enumerate the whole population.
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
 * The token's expiry, for a failure report that names the cause.
 *
 * Never throws: a token that is not a JWT, or one without an `exp`
 * claim, has no expiry to report — and a diagnostic must not take the
 * cleanup down before a single delete has run. The reason it could not
 * be read travels IN the label, so nothing is swallowed.
 *
 * @param {string} token - the access token the sweep holds
 * @returns {string} the expiry as an ISO timestamp, or why it is unknown
 */
function tokenExpiryLabel(token) {
  try {
    const exp = parseJwtClaims(token).exp;
    return exp ? new Date(exp * 1000).toISOString() : 'unknown (the token carries no exp claim)';
  } catch (e) {
    return `unknown (the token could not be read: ${e.message})`;
  }
}

/**
 * Describe a 401 from an authenticated endpoint.
 *
 * The verdict is the SERVER's, not the sweep's: both endpoints answer
 * `TOKEN_EXPIRED` and `TOKEN_INVALID` with the same status, and a
 * rotated signing key answers the latter. Calling that an expiry sends
 * the operator after the wrong layer.
 *
 * @param {{status: number, data: object}} res - the request helper's response
 * @param {string} token - the access token the sweep holds
 * @returns {string} the description for the failure report
 */
function describeUnauthorized(res, token) {
  const verdict = res.data?.error;
  const expiry = verdict === 'TOKEN_EXPIRED' ? ` — the access token expired at ${tokenExpiryLabel(token)}` : '';
  return `HTTP 401 (the endpoint answered ${verdict ?? 'no error code'}${expiry})`;
}

/**
 * Map `fn` over `items`, at most `limit` calls in flight at a time. The
 * results keep the input order, so a failure report reads the same way
 * whatever order the calls completed in.
 *
 * Safe by construction: a call that THROWS does not end the batch. The
 * rejection is captured, every item is attempted, and the lowest-indexed
 * failure is rethrown once the whole batch has run. Without the
 * capture, the first rejection propagates straight out of
 * `Promise.all`: the caller loses the whole batch's report, while the
 * sibling workers keep going in the background — deleting after the hook
 * has already failed, unobserved. The two sweeps do not rely on the
 * rethrow — they catch inside the mapper so they can name each failure —
 * but the guarantee is the helper's, and the failure that is rethrown
 * must not depend on which call rejected FIRST: the index decides, not
 * the clock.
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
    // The lowest index, not the first to reject: the same input must
    // raise the same error whatever order the calls completed in.
    failures.sort((a, b) => a.index - b.index);
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
  describeUnauthorized,
  SESSION_MINT_TIMEOUT_MS,
  SWEEP_DELETE_CONCURRENCY,
  SWEEP_MAX_LIST_PAGES,
  SWEEP_MAX_DELETES
};
