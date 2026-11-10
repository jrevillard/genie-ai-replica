'use strict';

// Story 1.1 — the BFF-side retrieval-config client (cache seam contract).
// Pins: cache hit/miss/expiry, okf-server 5xx → the fail-closed composition
// carrying the last-known mode, 401 propagation (never cached), legacy
// default, bearer (scope) isolation, no-eviction within a window, 403 →
// legacy default. DW-428: a realm-role grant of a scope keys the
// claim-scoped cache entry, never the scope-less one.

require('./setup-env');

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock(
  '../shared-lib',
  () => ({
    // The client destructures parsePositiveInt from the barrel — the mock
    // carries the real (pure) function like the shared mock file does.
    ...require('./mocks/shared-lib'),
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    }
  }),
  { virtual: true }
);

jest.mock('axios', () => ({
  get: jest.fn(),
  post: jest.fn()
}));

// Controllable clock — the TTL window derives from Date.now().
let nowMs = 1_000_000;
const REAL_TTL_MS = 30000;

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

/** A syntactically-valid (unverified — cache-key only) JWT bearer header.
 *  `extra` overrides/adds payload fields (e.g. a `scope` claim, or an
 *  `okf_scopes` STRING instead of the default array). */
function makeBearer(scopes = [], roles = [], sub = 'user-1', extra = {}) {
  const payload = { sub, okf_scopes: scopes, realm_access: { roles }, ...extra };
  return `Bearer ${b64url({ alg: 'none' })}.${b64url(payload)}.sig`;
}

/** Decode a bearer header's payload (the fixtures are synthetic — unverified).
 *  Mirrors decodeJwtPayload in services/retrieval-config-client.js — change
 *  them together: an undecodable bearer yields null, not a throw. */
function payloadOf(bearer) {
  const token = String(bearer || '')
    .replace(/^\s*bearer\s+/i, '')
    .trim();
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

const HYBRID_CONFIG = {
  config: { mode: 'hybrid' },
  source: 'database',
  serving_graph_count: 2,
  serving_repo_ids: ['a', 'b'],
  serving_graphs: [
    { repo_id: 'a', graph_name: 'OKF_a_v1', domain: 'agri' },
    { repo_id: 'b', graph_name: 'OKF_b_v1', domain: 'health' }
  ],
  engaged: true,
  warnings: []
};

const AUTHZ_A = {
  graph_names: ['OKF_a_v1'],
  per_graph_labels: {},
  domains: {},
  repos: [{ repo_id: 'a', graph_name: 'OKF_a_v1', domain: 'agri', name: 'Repo A' }],
  superadmin: false,
  generated_at: '2026-10-06T00:00:00Z',
  ttl_seconds: 30
};

function okfGetResponse(data) {
  return Promise.resolve({ status: 200, data });
}

function okfGetError(status, message = 'upstream error') {
  return Promise.reject(Object.assign(new Error(message), { response: { status } }));
}

let client;
let axios;

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  nowMs = 1_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
  // Dark-launch polarity (review 2026-10-29): unset now means PARKED. These
  // suites exercise the ENABLED paths, so state the precondition — the flag
  // is read once at module load, before the require below.
  process.env.OKF_ENABLED = '1';
  // Required AFTER resetModules so the test's axios binding is the same
  // instance the freshly-loaded client module captured.
  client = require('../services/retrieval-config-client');
  axios = require('axios');
  axios.get.mockReset();
});

afterEach(() => {
  Date.now.mockRestore();
});

describe('retrieval-config-client (Story 1.1)', () => {
  // One accessor for the key derivation — closes over the `client` let, so
  // every call reads the module generation the current beforeEach loaded.
  const keyOf = (bearer) => client._internals.effectiveScopesKey(bearer);

  it('cache hit: the same caller within the TTL window hits upstream once', async () => {
    axios.get.mockReturnValue(okfGetResponse(HYBRID_CONFIG));

    const first = await client.getRetrievalConfig(makeBearer(['okf:t:a:read']));
    const second = await client.getRetrievalConfig(makeBearer(['okf:t:a:read']));

    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(second).toBe(first); // the exact cached object
    expect(second.engaged).toBe(true);
    expect(second.config.mode).toBe('hybrid');
  });

  it('cache miss: a different scope set is a different cache key', async () => {
    axios.get.mockReturnValue(okfGetResponse(HYBRID_CONFIG));

    await client.getRetrievalConfig(makeBearer(['okf:t:a:read']));
    await client.getRetrievalConfig(makeBearer(['okf:t:a:read', 'okf:t:b:read']));

    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  it('expiry: advancing past the TTL window re-fetches', async () => {
    axios.get.mockReturnValue(okfGetResponse(HYBRID_CONFIG));
    const bearer = makeBearer(['okf:t:a:read']);

    await client.getRetrievalConfig(bearer);
    nowMs += REAL_TTL_MS + 1; // roll the window
    await client.getRetrievalConfig(bearer);

    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  it('okf-server 5xx: the degraded caller keeps the global posture and the fail-closed per-caller view', async () => {
    axios.get
      .mockReturnValueOnce(
        okfGetResponse({ ...HYBRID_CONFIG, config: { ...HYBRID_CONFIG.config, updated_by: 'steward-9' } })
      )
      .mockImplementationOnce(() => okfGetError(503)); // rejection created at CALL time
    const bearer = makeBearer(['okf:t:a:read']);

    const good = await client.getRetrievalConfig(bearer);
    expect(good.config.updated_by).toBe('steward-9'); // the caller's own response is verbatim
    nowMs += REAL_TTL_MS + 1;
    const degraded = await client.getRetrievalConfig(bearer);

    // The deployment-global posture survives the outage: the mode the
    // deployment was last known to run. The source label names the LOCAL
    // composition (the synthesized fail-closed fields are the BFF's own,
    // not the upstream's response — an admin debugging the outage must
    // not read source:'database' as the database declaring an empty view).
    expect(degraded.config).toEqual({ mode: 'hybrid' });
    expect(degraded.source).toBe('bff-last-known-good');
    // Everything else on the shared last-known-good copy is PER-CALLER
    // state (it is computed by the okf-server FROM the caller's scopes) —
    // the degraded caller falls back to the fail-closed defaults instead
    // of being handed a serving view computed for a caller it may not be.
    expect(degraded.engaged).toBe(false);
    expect(degraded.serving_graph_count).toBe(0);
    expect(degraded.serving_repo_ids).toEqual([]);
    expect(degraded.serving_graphs).toEqual([]);
    expect(degraded.warnings).toEqual([]);

    // The failure-resolved value is cached for the window remainder — the
    // degraded caller does not re-burn an upstream attempt on every call.
    const again = await client.getRetrievalConfig(bearer);
    expect(again).toBe(degraded);
    expect(axios.get).toHaveBeenCalledTimes(2); // the success + the one failure attempt
  });

  it("okf-server 5xx cross-caller: a failing caller is never served another caller's serving view", async () => {
    axios.get.mockImplementation((path, config) => {
      const sub = payloadOf(config?.headers?.Authorization)?.sub;
      if (sub === 'caller-b') return okfGetError(503);
      return okfGetResponse({
        ...HYBRID_CONFIG,
        serving_repo_ids: [`repo-of-${sub}`],
        serving_graphs: [{ repo_id: `repo-of-${sub}`, graph_name: `graph-of-${sub}`, domain: 'agri' }]
      });
    });

    await client.getRetrievalConfig(makeBearer(['okf:t:a:read'], [], 'caller-a'));
    const degraded = await client.getRetrievalConfig(makeBearer([], [], 'caller-b'));

    // The mode is deployment-global (shared posture is legitimate) — but
    // caller-b's serving view is its own fail-closed one, never caller-a's,
    // and the source label names the local composition, not the upstream.
    expect(degraded.config.mode).toBe('hybrid');
    expect(degraded.source).toBe('bff-last-known-good');
    expect(degraded.engaged).toBe(false);
    expect(degraded.serving_repo_ids).toEqual([]);
    expect(degraded.serving_graphs).toEqual([]);
    expect(degraded.warnings).toEqual([]);
  });

  it('concurrent cold-window misses share ONE upstream attempt', async () => {
    // Each attempt costs the full request timeout when the upstream is down —
    // a burst of concurrent callers must not pay it N times. The attempt is
    // published in the cache BEFORE it settles, so the misses await it.
    let resolveUpstream;
    const pending = new Promise((resolve) => {
      resolveUpstream = resolve;
    });
    axios.get.mockImplementation(() => pending);
    const bearer = makeBearer(['okf:t:a:read']);

    const calls = [
      client.getRetrievalConfig(bearer),
      client.getRetrievalConfig(bearer),
      client.getRetrievalConfig(bearer)
    ];
    resolveUpstream({ status: 200, data: HYBRID_CONFIG });
    const results = await Promise.all(calls);

    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(results[1]).toBe(results[0]); // the SAME composition object
    expect(results[2]).toBe(results[0]);
    expect(results[0].config.mode).toBe('hybrid');
  });

  it('a last-known-good WITHIN the trust horizon still serves the deployment posture', async () => {
    axios.get.mockReturnValueOnce(okfGetResponse(HYBRID_CONFIG)).mockImplementationOnce(() => okfGetError(503));
    const bearer = makeBearer(['okf:t:a:read']);

    await client.getRetrievalConfig(bearer); // the posture is confirmed
    nowMs += client._internals.LKG_MAX_AGE_MS - 1; // still inside the horizon
    const degraded = await client.getRetrievalConfig(bearer);

    expect(degraded.config.mode).toBe('hybrid');
    expect(degraded.source).toBe('bff-last-known-good');
  });

  it('a last-known-good BEYOND the trust horizon degrades to the legacy default', async () => {
    // The copy is a short-lived cache, not a durable mirror of the deployment
    // config: past the horizon the posture is unverifiable, and a deployment
    // mode change (a flip to/from okf_only) must not be shadowed for the
    // whole outage.
    axios.get.mockReturnValueOnce(okfGetResponse(HYBRID_CONFIG)).mockImplementationOnce(() => okfGetError(503));
    const bearer = makeBearer(['okf:t:a:read']);

    await client.getRetrievalConfig(bearer); // the posture is confirmed
    nowMs += client._internals.LKG_MAX_AGE_MS + 1; // ... then it goes stale
    const degraded = await client.getRetrievalConfig(bearer);

    expect(degraded.config.mode).toBe('legacy');
    expect(degraded.source).toBe('bff-fail-closed-default');
    expect(degraded.engaged).toBe(false);
  });

  it('a mode outside the vocabulary the response declares degrades to the legacy default', async () => {
    // The okf-server owns the mode vocabulary (it publishes it next to the
    // read-model); the BFF checks membership against THAT — no second copy of
    // the enum here. A mode the response does not declare never reaches the
    // carrier, and never lands in the last-known-good copy.
    axios.get.mockReturnValueOnce(
      okfGetResponse({
        ...HYBRID_CONFIG,
        config: { mode: 'hibrind' },
        modes: ['legacy', 'okf_only', 'hybrid']
      })
    );

    const config = await client.getRetrievalConfig(makeBearer(['okf:t:a:read']));
    expect(config.config.mode).toBe('legacy');
    expect(config.engaged).toBe(false);

    // The warn names WHY the response was rejected — a shape problem and an
    // out-of-vocabulary mode are different operator problems.
    const { logger } = require('../shared-lib');
    const malformedWarn = logger.warn.mock.calls.find(
      ([msg]) => msg === 'RetrievalConfigClient.malformed_config_response'
    );
    expect(malformedWarn).toBeDefined();
    expect(malformedWarn[1].reason).toBe('mode_not_declared');

    nowMs += REAL_TTL_MS + 1;
    axios.get.mockImplementationOnce(() => okfGetError(503));
    const afterOutage = await client.getRetrievalConfig(makeBearer(['okf:t:c:read']));
    expect(afterOutage.config.mode).toBe('legacy');
    expect(afterOutage.source).toBe('bff-fail-closed-default');
  });

  it('a padded mode is garbled: rejected at the boundary, exactly like the server sanitizer', async () => {
    // The okf-server's own sanitizer treats ' hybrid ' as garbled (safe
    // default) — the BFF must agree rather than trim it into an engaged
    // fan-out the server would have refused. The garbled mode also never
    // reaches the last-known-good copy.
    axios.get.mockReturnValueOnce(
      okfGetResponse({
        ...HYBRID_CONFIG,
        config: { mode: ' hybrid ' },
        modes: ['legacy', 'okf_only', 'hybrid']
      })
    );

    const config = await client.getRetrievalConfig(makeBearer(['okf:t:a:read']));
    expect(config.config.mode).toBe('legacy');
    expect(config.engaged).toBe(false);

    nowMs += REAL_TTL_MS + 1;
    axios.get.mockImplementationOnce(() => okfGetError(503));
    const degraded = await client.getRetrievalConfig(makeBearer(['okf:t:c:read']));
    expect(degraded.config.mode).toBe('legacy');
    expect(degraded.source).toBe('bff-fail-closed-default');
  });

  it("a concurrent joiner is not poisoned by the initiator's 401 — every caller runs its OWN attempt", async () => {
    // The shared attempt runs with the INITIATOR's bearer: its 401 says
    // nothing about a joiner's own token (a refreshed token of the same
    // scopes shares the key). The own-attempt fallback must run OUTSIDE the
    // shared cache: a retry that published its attempt would be JOINED by
    // the next caller, who would inherit a foreign outcome without its own
    // token ever being tested. Four callers, two rejected tokens, two valid:
    // every caller must hit the upstream exactly once, with its OWN bearer.
    const subs = [];
    axios.get.mockImplementation((path, config) => {
      const sub = payloadOf(config?.headers?.Authorization)?.sub;
      subs.push(sub);
      if (sub === 'caller-a' || sub === 'caller-b') return okfGetError(401, 'token expired');
      return okfGetResponse(HYBRID_CONFIG);
    });

    const a = client.getRetrievalConfig(makeBearer(['okf:t:a:read'], [], 'caller-a'));
    const b = client.getRetrievalConfig(makeBearer(['okf:t:a:read'], [], 'caller-b'));
    const c = client.getRetrievalConfig(makeBearer(['okf:t:a:read'], [], 'caller-c'));
    const d = client.getRetrievalConfig(makeBearer(['okf:t:a:read'], [], 'caller-d'));

    await expect(a).rejects.toMatchObject({ name: 'OkfAuthzUnauthorizedError' });
    await expect(b).rejects.toMatchObject({ name: 'OkfAuthzUnauthorizedError' });
    await expect(c).resolves.toMatchObject({ config: { mode: 'hybrid' } });
    await expect(d).resolves.toMatchObject({ config: { mode: 'hybrid' } });
    // Four attempts: the shared one plus each caller's own fallback — no
    // caller inherited another's outcome without its own attempt.
    expect(axios.get).toHaveBeenCalledTimes(4);
    // And each attempt carried the caller's own token, not a neighbour's.
    expect(subs.sort()).toEqual(['caller-a', 'caller-b', 'caller-c', 'caller-d']);
  });

  it('okf-server 401: throws the typed error (propagates, never cached into a stale lockout)', async () => {
    axios.get.mockImplementation(() => okfGetError(401, 'token expired'));
    const bearer = makeBearer(['okf:t:a:read']);

    await expect(client.getRetrievalConfig(bearer)).rejects.toMatchObject({
      name: 'OkfAuthzUnauthorizedError',
      statusCode: 401
    });

    // Not cached: a retry within the same window attempts upstream again
    // (a refreshed token of the same caller shares the scopes key).
    axios.get.mockReturnValue(okfGetResponse({ ...HYBRID_CONFIG, engaged: false }));
    const after = await client.getRetrievalConfig(bearer);
    expect(after.engaged).toBe(false);
  });

  it('last-known-good: a failure with no prior success yields the legacy default (fail-closed)', async () => {
    axios.get.mockImplementation(() => okfGetError(503));

    const config = await client.getRetrievalConfig(makeBearer(['okf:t:a:read']));

    expect(config).toEqual({
      config: { mode: 'legacy' },
      source: 'bff-fail-closed-default',
      synthesis_reason: 'upstream_unreachable',
      serving_graph_count: 0,
      serving_repo_ids: [],
      serving_graphs: [],
      engaged: false,
      warnings: []
    });
  });

  it('every synthesized composition names WHY it was synthesized', async () => {
    // A consumer must be able to tell a by-design default (OKF parked, a
    // caller without okf scopes — their legacy answer IS the correct
    // posture) from a posture the client could not read.
    axios.get
      .mockImplementationOnce(() => okfGetError(403))
      .mockImplementationOnce(() => okfGetResponse({ unexpected: true }))
      .mockImplementationOnce(() => okfGetError(503));

    const forbidden = await client.getRetrievalConfig(makeBearer(['okf:t:a:read'], [], 'u1'));
    const garbled = await client.getRetrievalConfig(makeBearer(['okf:t:b:read'], [], 'u2'));
    const unreachable = await client.getRetrievalConfig(makeBearer(['okf:t:c:read'], [], 'u3'));

    expect(forbidden.synthesis_reason).toBe('caller_without_scope');
    expect(garbled.synthesis_reason).toBe('malformed_response');
    expect(unreachable.synthesis_reason).toBe('upstream_unreachable');
    // Only the unreadable-posture cases are flagged as unknown.
    expect(client.isPostureUnknown(forbidden)).toBe(false);
    expect(client.isPostureUnknown(garbled)).toBe(true);
    expect(client.isPostureUnknown(unreachable)).toBe(true);
  });

  it('the trust horizon is a fixed value, not a multiple of the cache TTL', () => {
    // Pinning the VALUE: deriving it from OKF_RETRIEVAL_CONFIG_TTL_MS would
    // silently widen the unverified-posture window whenever an operator
    // raises the TTL to cut upstream load.
    expect(client._internals.LKG_MAX_AGE_MS).toBe(300000);
  });

  describe('with a cache TTL longer than the trust horizon', () => {
    // #1683's bound must hold at SERVE time: a failure-resolved composition
    // is cached for the window, and a window longer than the horizon would
    // otherwise keep serving an unverified posture past its bound.
    const LONG_TTL_MS = 600000;

    function loadWithLongTtl() {
      process.env.OKF_RETRIEVAL_CONFIG_TTL_MS = String(LONG_TTL_MS);
      jest.resetModules();
      const loaded = require('../services/retrieval-config-client');
      const axiosLong = require('axios');
      axiosLong.get.mockReset();
      return { loaded, axiosLong };
    }

    afterEach(() => {
      delete process.env.OKF_RETRIEVAL_CONFIG_TTL_MS;
    });

    it('a cached degraded posture stops being served once the horizon passes', async () => {
      const { loaded: longClient, axiosLong } = loadWithLongTtl();
      // The posture is confirmed at 599000, just before window 0 ends; the
      // outage hits in window 1 (the failure-resolved composition is cached
      // under window 1's key), and the horizon (5 min from 599000 = 899000)
      // expires while window 1 [600000, 1200000) is STILL current — exactly
      // the case a per-window cache would otherwise serve past the bound.
      nowMs = 599000;
      axiosLong.get.mockReturnValue(okfGetResponse(HYBRID_CONFIG));
      const bearer = makeBearer(['okf:t:a:read']);

      await longClient.getRetrievalConfig(bearer); // the posture is confirmed

      nowMs = 700000; // window 1; the upstream fails; the LKG (age 101 s) is fresh
      axiosLong.get.mockImplementation(() => okfGetError(503));
      const degraded = await longClient.getRetrievalConfig(bearer);
      expect(degraded.config.mode).toBe('hybrid');
      expect(degraded.source).toBe('bff-last-known-good');
      // The composition carries the age of the posture it was built from.
      // The composition carries when the posture it was built from stops
      // being trusted — the cache re-validates it at serve time.
      expect(degraded.expires_at).toBe(599000 + longClient._internals.LKG_MAX_AGE_MS);

      nowMs = 899500; // SAME window, past the horizon (age 300500 > 300000)
      const afterHorizon = await longClient.getRetrievalConfig(bearer);

      // The serve-time re-validation dropped the entry and resolved again:
      // no trusted posture remains, so the fail-closed default takes over
      // even though the window has not rolled.
      expect(afterHorizon.config.mode).toBe('legacy');
      expect(afterHorizon.source).toBe('bff-fail-closed-default');
      // Three attempts: the success, the in-window failure, the re-resolution.
      expect(axiosLong.get).toHaveBeenCalledTimes(3);
    });
  });

  it('bearer isolation: two callers with different scopes get their own graph sets', async () => {
    const authzFor = (scopes) => ({ ...AUTHZ_A, graph_names: scopes });
    const scopesOf = (authHeader) => payloadOf(authHeader)?.okf_scopes || [];
    axios.get.mockImplementation((path, config) => {
      if (path.endsWith('/api/okf/authz/graphs')) {
        const scopes = scopesOf(config?.headers?.Authorization);
        // The stub answers per CALLER — the repo-a scope resolves repo a, the
        // repo-b scope resolves repo b (mirrors the authz-resolver's
        // authorizedRepoIds intersection).
        return okfGetResponse(scopes.includes('okf:t:a:read') ? authzFor(['OKF_a_v1']) : authzFor(['OKF_b_v1']));
      }
      return okfGetResponse(HYBRID_CONFIG);
    });

    const userA = makeBearer(['okf:t:a:read'], [], 'user-a');
    const userB = makeBearer(['okf:t:b:read'], [], 'user-b');

    await client.getRetrievalConfig(userA);
    await client.getRetrievalConfig(userB);
    const graphsA = await client.getAuthorizedGraphs(userA);
    const graphsB = await client.getAuthorizedGraphs(userB);

    // Both hit upstream separately — A's cached graph set never serves B.
    expect(axios.get).toHaveBeenCalledTimes(4);
    expect(graphsA.graph_names).toEqual(['OKF_a_v1']);
    expect(graphsB.graph_names).toEqual(['OKF_b_v1']);
  });

  it('no eviction: many distinct callers within one window all stay cached', async () => {
    axios.get.mockReturnValue(okfGetResponse(HYBRID_CONFIG));

    const bearers = [1, 2, 3, 4, 5].map((i) => makeBearer([`okf:t:repo-${i}:read`]));
    for (const bearer of bearers) {
      await client.getRetrievalConfig(bearer);
    }
    // Second round — every caller still hits its own cache entry (no LRU eviction).
    for (const bearer of bearers) {
      await client.getRetrievalConfig(bearer);
    }

    expect(axios.get).toHaveBeenCalledTimes(bearers.length);
  });

  it('403: a caller without okf scopes gets the legacy default (empty per-caller serving view)', async () => {
    axios.get.mockImplementation(() => okfGetError(403));

    const config = await client.getRetrievalConfig(makeBearer([]));

    expect(config.config.mode).toBe('legacy');
    expect(config.engaged).toBe(false);
  });

  it('malformed success body: degrades to the legacy default instead of throwing', async () => {
    // A vacuous mode (an empty or whitespace-only string passes a typeof
    // check) is as garbled as an unexpected body — the deployment posture
    // must never be an empty label on a response the caller sees.
    axios.get
      .mockReturnValueOnce(okfGetResponse({ unexpected: true }))
      .mockReturnValueOnce(okfGetResponse({ ...HYBRID_CONFIG, config: { mode: '' }, engaged: true }))
      .mockReturnValueOnce(okfGetResponse({ ...HYBRID_CONFIG, config: { mode: '   ' }, engaged: true }));

    const config = await client.getRetrievalConfig(makeBearer(['okf:t:a:read']));
    const vacuousMode = await client.getRetrievalConfig(makeBearer(['okf:t:a:read', 'okf:t:b:read']));
    const whitespaceMode = await client.getRetrievalConfig(makeBearer(['okf:t:d:read']));

    expect(config.config.mode).toBe('legacy');
    expect(config.engaged).toBe(false);
    expect(vacuousMode.config.mode).toBe('legacy');
    expect(vacuousMode.engaged).toBe(false);
    expect(whitespaceMode.config.mode).toBe('legacy');
    expect(whitespaceMode.engaged).toBe(false);

    // The malformed-response warn carries the correlationId the resolution
    // was traced with — the one this caller omitted is generated by the
    // client, not logged as undefined.
    const { logger } = require('../shared-lib');
    const malformedWarn = logger.warn.mock.calls.find(
      ([msg]) => msg === 'RetrievalConfigClient.malformed_config_response'
    );
    expect(malformedWarn).toBeDefined();
    expect(malformedWarn[1].correlationId).toEqual(expect.any(String));

    // A malformed or vacuous response must leave the last-known-good copy
    // untouched: no successful read happened in this window, so a later
    // outage degrades to the plain legacy default — never to a mode a
    // garbled body carried.
    nowMs += REAL_TTL_MS + 1;
    axios.get.mockImplementationOnce(() => okfGetError(503));
    const afterOutage = await client.getRetrievalConfig(makeBearer(['okf:t:c:read']));
    expect(afterOutage.config.mode).toBe('legacy');
    expect(afterOutage.source).toBe('bff-fail-closed-default');
  });

  it('scope-equivalence: scope ORDER does not change the cache key', async () => {
    axios.get.mockReturnValue(okfGetResponse(HYBRID_CONFIG));

    await client.getRetrievalConfig(makeBearer(['okf:t:a:read', 'okf:t:b:read']));
    await client.getRetrievalConfig(makeBearer(['okf:t:b:read', 'okf:t:a:read']));

    // Same effective scopes (sorted) → one cache entry, one upstream call.
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('injective key: a scope set and a single literal scope containing the delimiter key differently', () => {
    // The scope grammar is not constrained to the 4-part shape, so a single
    // scope whose NAME contains the delimiter can exist. The key must be
    // injective over scope LISTS: the set {a, b} and the one-scope list
    // [a|b] must never join to the same bytes (they would share one cache
    // entry and be served the same per-caller payload).
    const setKey = keyOf(makeBearer(['okf:t:a:read', 'okf:t:b:read']));
    const literalKey = keyOf(makeBearer(['okf:t:a:read|okf:t:b:read']));
    expect(literalKey).not.toBe(setKey);
  });

  it('super-admin posture is part of the key: same scopes, different realm roles → separate entries', async () => {
    axios.get.mockReturnValue(okfGetResponse(HYBRID_CONFIG));

    await client.getRetrievalConfig(makeBearer(['okf:t:a:read'], []));
    await client.getRetrievalConfig(makeBearer(['okf:t:a:read'], ['tools-admin']));

    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  it('authz 5xx: fail-closed to an empty graph set (okf_only posture is enforced elsewhere)', async () => {
    axios.get.mockImplementation((path) => {
      if (path.endsWith('/api/okf/authz/graphs')) return okfGetError(500);
      return okfGetResponse(HYBRID_CONFIG);
    });
    const bearer = makeBearer(['okf:t:a:read']);

    await client.getRetrievalConfig(bearer);
    const graphs = await client.getAuthorizedGraphs(bearer);

    expect(graphs).toEqual({ graph_names: [] });
  });

  it('undecodable bearer: the token-hash fallback key works (no crash) and stays unique per token', async () => {
    axios.get.mockReturnValue(okfGetResponse(HYBRID_CONFIG));
    const opaqueA = 'Bearer not-a-jwt-at-all';
    const opaqueB = 'Bearer also-not-a-jwt';

    const first = await client.getRetrievalConfig(opaqueA);
    const second = await client.getRetrievalConfig(opaqueA); // same token → cache hit
    await client.getRetrievalConfig(opaqueB); // different token → different key

    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(second).toBe(first);
    expect(first.engaged).toBe(true);
  });

  // DW-428 (review 2026-10-29 round 3): the okf-server parser folds realm
  // ROLE NAMES that ARE scopes into the scope set (Story 6-1c group grants —
  // a user whose only path to the role is group membership carries it in
  // realm_access.roles). The BFF copy must see the same set, or a
  // role-granted caller keys the shared authz cache as scope-less,
  // colliding with every scope-less caller.
  it('parseOkfScopes: a scope-shaped realm role lands in the parsed set', () => {
    expect(
      client._internals.parseOkfScopes({
        okf_scopes: [],
        realm_access: { roles: ['default-roles-genie', 'offline_access', 'okf:t:c:read'] }
      })
    ).toEqual(['okf:t:c:read']);
  });

  it('parseOkfScopes: the standard scope claim lands in the parsed set — same key as the array grant', () => {
    expect(keyOf(makeBearer([], [], 'u1', { scope: 'okf:t:a:read okf:t:b:read openid offline_access' }))).toBe(
      keyOf(makeBearer(['okf:t:a:read', 'okf:t:b:read']))
    );
    // Literal expectation — not routed through the parser under test.
    expect(client._internals.parseOkfScopes({ scope: 'okf:t:a:read openid offline_access' })).toEqual(['okf:t:a:read']);
  });

  it('parseOkfScopes: a space-joined okf_scopes STRING attribute matches the array grant', () => {
    expect(keyOf(makeBearer([], [], 'u2', { okf_scopes: 'okf:t:a:read okf:t:b:read' }))).toBe(
      keyOf(makeBearer(['okf:t:a:read', 'okf:t:b:read']))
    );
    // Literal expectation — not routed through the parser under test.
    expect(client._internals.parseOkfScopes({ okf_scopes: 'okf:t:a:read default-roles-genie' })).toEqual([
      'okf:t:a:read'
    ]);
  });

  it("role-granted scopes share the claim-scoped cache entry, never the scope-less caller's entry", async () => {
    // The upstream answers PER CALLER, so "who was served what" is
    // observable — one shared payload would hide a cross-caller bleed behind
    // identical bytes.
    axios.get.mockImplementation((path, config) => {
      const sub = payloadOf(config?.headers?.Authorization)?.sub;
      const serving = [{ repo_id: `repo-of-${sub}`, graph_name: `graph-of-${sub}`, domain: 'agri' }];
      if (path.endsWith('/api/okf/authz/graphs')) {
        return okfGetResponse({
          ...AUTHZ_A,
          graph_names: serving.map((g) => g.graph_name),
          repos: serving.map((g) => ({ ...g, name: `Repo of ${sub}` }))
        });
      }
      return okfGetResponse({
        ...HYBRID_CONFIG,
        serving_graph_count: serving.length,
        serving_repo_ids: serving.map((g) => g.repo_id),
        serving_graphs: serving
      });
    });

    const byClaim = makeBearer(['okf:t:a:read'], [], 'claim-user');
    const byRole = makeBearer([], ['okf:t:a:read'], 'role-user');
    const noScopes = makeBearer([], [], 'scope-less-user');

    // The KEY decides the cache entry: the realm-role grant must land in the
    // claim-scoped entry, never in the scope-less one.
    const claimKey = keyOf(byClaim);
    const roleKey = keyOf(byRole);
    const noScopesKey = keyOf(noScopes);
    expect(roleKey).toBe(claimKey);
    expect(roleKey).not.toBe(noScopesKey);

    const claimView = await client.getRetrievalConfig(byClaim);
    const roleView = await client.getRetrievalConfig(byRole);
    const scopeLessView = await client.getRetrievalConfig(noScopes);

    // Scope-equivalent callers share the entry — BOTH are served the same
    // view, whichever of them populated it. An equality between two served
    // views (not a positional list) is what makes this order-independent.
    expect(roleView.serving_repo_ids).toEqual(claimView.serving_repo_ids);
    // The scope-less caller keeps its own view: it is never handed another
    // caller's serving set.
    expect(scopeLessView.serving_repo_ids).toEqual(['repo-of-scope-less-user']);

    // The authorization boundary shares the key — a scope-less caller must
    // not be handed the scoped caller's traversable graph set.
    const graphsByClaim = await client.getAuthorizedGraphs(byClaim);
    const graphsByRole = await client.getAuthorizedGraphs(byRole);
    const graphsScopeLess = await client.getAuthorizedGraphs(noScopes);
    expect(graphsByRole.graph_names).toEqual(graphsByClaim.graph_names);
    expect(graphsScopeLess.graph_names).toEqual(['graph-of-scope-less-user']);

    // Payload-independent tripwire: the role-granted caller never fetched its
    // own entry on either cache kind — two misses per kind (claim caller +
    // scope-less caller), so the count pins the cache-hit behaviour without
    // depending on what the mock serves.
    expect(axios.get).toHaveBeenCalledTimes(4);
  });

  // Egress guard (review 2026-10-29 wave 2): fetchUpstream takes a fixed-base
  // relative path — an absolute URL (the canonical SSRF target: the
  // link-local metadata address) must be rejected before any HTTP attempt.
  it('fetchUpstream rejects a non-relative path before any HTTP attempt', async () => {
    await expect(
      client._internals.fetchUpstream('http://169.254.169.254/latest/meta-data', 'Bearer x')
    ).rejects.toThrow(/rejected non-relative path/);
    expect(axios.get).not.toHaveBeenCalled();
  });

  // OKF feature flag (2026-10-21, merge prep): OKF_ENABLED=0 parks the OKF
  // stack — the client resolves the legacy default DIRECTLY, no connection
  // attempt, no warn noise. With the okf-server parked every caller would
  // otherwise burn one timeout attempt per TTL window.
  describe('OKF_ENABLED=0 short-circuit', () => {
    it('resolves the legacy default with zero HTTP attempts', async () => {
      process.env.OKF_ENABLED = '0';
      try {
        // The flag is read once at module load — reload the client under the
        // parked env (beforeEach loaded it with the flag ENABLED) and
        // bind the axios mock of the SAME registry generation for the assertion.
        jest.resetModules();
        const parked = require('../services/retrieval-config-client');
        const axiosParked = require('axios');
        const cfg = await parked.getRetrievalConfig(makeBearer());
        expect(cfg).toMatchObject({
          config: { mode: 'legacy' },
          engaged: false,
          source: 'bff-fail-closed-default',
          synthesis_reason: 'parked'
        });
        const graphs = await parked.getAuthorizedGraphs(makeBearer());
        expect(graphs).toEqual({ graph_names: [] });
        expect(axiosParked.get).not.toHaveBeenCalled();
      } finally {
        delete process.env.OKF_ENABLED;
      }
    });
  });

  // invalid_env_int warn contract (review 2026-10-29): the warn fires ONLY
  // when a PROVIDED, non-empty value misparses or sits below min. A provided
  // value equal to its fallback is a VALID configuration (never warned) and
  // an empty string is indistinguishable from unset (also silent). The parse
  // runs at module load, so each case reloads the client under its env.
  describe('envPositiveInt invalid_env_int warn contract', () => {
    const VAR = 'OKF_RETRIEVAL_CONFIG_TIMEOUT_MS';

    // The timeout constant derives from this variable at module load
    // (fallback 3000, min 100) — reload per case and read both the resolved
    // value and the freshly-bound mocked logger.
    function loadWith(value) {
      if (value === undefined) delete process.env[VAR];
      else process.env[VAR] = value;
      jest.resetModules();
      const loaded = require('../services/retrieval-config-client');
      const { logger: caseLogger } = require('../shared-lib');
      return { loaded, caseLogger };
    }

    afterEach(() => {
      delete process.env[VAR];
    });

    it('valid value equal to the fallback: NO warn (valid configuration, not a misconfiguration)', () => {
      const { loaded, caseLogger } = loadWith('3000');

      expect(loaded._internals.REQUEST_TIMEOUT_MS).toBe(3000);
      expect(caseLogger.warn).not.toHaveBeenCalledWith('RetrievalConfigClient.invalid_env_int', expect.anything());
    });

    it('empty string: NO warn (indistinguishable from unset)', () => {
      const { loaded, caseLogger } = loadWith('');

      expect(loaded._internals.REQUEST_TIMEOUT_MS).toBe(3000);
      expect(caseLogger.warn).not.toHaveBeenCalledWith('RetrievalConfigClient.invalid_env_int', expect.anything());
    });

    it('unparseable value: warn names the variable, the offending value and the applied fallback', () => {
      const { loaded, caseLogger } = loadWith('abc');

      expect(loaded._internals.REQUEST_TIMEOUT_MS).toBe(3000);
      expect(caseLogger.warn).toHaveBeenCalledWith('RetrievalConfigClient.invalid_env_int', {
        variable: VAR,
        value: 'abc',
        applied_fallback: 3000
      });
    });

    it('value below min: warn (the applied fallback must stay visible to ops)', () => {
      const { loaded, caseLogger } = loadWith('50');

      expect(loaded._internals.REQUEST_TIMEOUT_MS).toBe(3000);
      expect(caseLogger.warn).toHaveBeenCalledWith('RetrievalConfigClient.invalid_env_int', {
        variable: VAR,
        value: '50',
        applied_fallback: 3000
      });
    });
  });
});
