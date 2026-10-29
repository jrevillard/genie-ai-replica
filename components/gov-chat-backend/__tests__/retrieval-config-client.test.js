'use strict';

// Story 1.1 — the BFF-side retrieval-config client (cache seam contract).
// Pins: cache hit/miss/expiry, okf-server 5xx → last-known-good, 401
// propagation (never cached), last-known-good default, bearer (scope)
// isolation, no-eviction within a window, 403 → legacy default.

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

/** A syntactically-valid (unverified — cache-key only) JWT bearer header. */
function makeBearer(scopes = [], roles = [], sub = 'user-1') {
  const payload = { sub, okf_scopes: scopes, realm_access: { roles } };
  return `Bearer ${b64url({ alg: 'none' })}.${b64url(payload)}.sig`;
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

  it('okf-server 5xx: serves the last-known-good config (identity-sanitized)', async () => {
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

    // Posture fields survive verbatim from the last-known-good...
    expect(degraded.engaged).toBe(true);
    expect(degraded.config.mode).toBe('hybrid');
    expect(degraded.serving_repo_ids).toEqual(['a', 'b']);
    // ...but the shared LKG copy never carries the governing admin's sub:
    // it is served to ANY caller on upstream failure, so the okf-server's
    // per-caller updated_by redaction must hold on this side too.
    expect(degraded.config.updated_by).toBeNull();
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
      serving_graph_count: 0,
      serving_repo_ids: [],
      serving_graphs: [],
      engaged: false,
      warnings: []
    });
  });

  it('bearer isolation: two callers with different scopes get their own graph sets', async () => {
    const authzFor = (scopes) => ({ ...AUTHZ_A, graph_names: scopes });
    const scopesOf = (authHeader) => {
      const token = String(authHeader || '').replace(/^Bearer\s+/i, '');
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
      return payload.okf_scopes || [];
    };
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
    axios.get.mockReturnValue(okfGetResponse({ unexpected: true }));

    const config = await client.getRetrievalConfig(makeBearer(['okf:t:a:read']));

    expect(config.config.mode).toBe('legacy');
    expect(config.engaged).toBe(false);
  });

  it('scope-equivalence: scope ORDER does not change the cache key', async () => {
    axios.get.mockReturnValue(okfGetResponse(HYBRID_CONFIG));

    await client.getRetrievalConfig(makeBearer(['okf:t:a:read', 'okf:t:b:read']));
    await client.getRetrievalConfig(makeBearer(['okf:t:b:read', 'okf:t:a:read']));

    // Same effective scopes (sorted) → one cache entry, one upstream call.
    expect(axios.get).toHaveBeenCalledTimes(1);
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
  // role-granted caller keys the shared authz cache as `@no-scopes`,
  // colliding with every scope-less caller.
  it('parseOkfScopes: a scope-shaped realm role lands in the parsed set', () => {
    expect(
      client._internals.parseOkfScopes({
        okf_scopes: [],
        realm_access: { roles: ['default-roles-genie', 'offline_access', 'okf:t:c:read'] }
      })
    ).toEqual(['okf:t:c:read']);
  });

  it('role-granted scopes share the claim-scoped cache entry and never the @no-scopes one', async () => {
    axios.get.mockReturnValue(okfGetResponse(HYBRID_CONFIG));

    const byClaim = makeBearer(['okf:t:a:read'], []);
    const byRole = makeBearer([], ['okf:t:a:read']);
    const noScopes = makeBearer([], []);

    await client.getRetrievalConfig(byClaim);
    await client.getRetrievalConfig(byRole); // same effective scopes → cache hit
    await client.getRetrievalConfig(noScopes); // distinct key — no cross-user bleed

    expect(axios.get).toHaveBeenCalledTimes(2);
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
        // parked env (beforeEach already loaded it with the flag unset) and
        // bind the axios mock of the SAME registry generation for the assertion.
        jest.resetModules();
        const parked = require('../services/retrieval-config-client');
        const axiosParked = require('axios');
        const cfg = await parked.getRetrievalConfig(makeBearer());
        expect(cfg).toMatchObject({ config: { mode: 'legacy' }, engaged: false, source: 'bff-fail-closed-default' });
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
