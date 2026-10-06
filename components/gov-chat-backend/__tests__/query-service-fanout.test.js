'use strict';

// Story 1.1 — the BFF's chatqna payload shape for every I/O Matrix scenario
// (spec: spec-1-1-retriever-multigraph-fanout-rrf.md). Pins the carrier
// construction rules: the server's `engaged` flag gates everything, GRAPH is
// prepended ONLY in hybrid mode, okf_only passes exclude_legacy, and legacy
// mode adds NOTHING (byte-identical payload).

require('./setup-env');

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock(
  '../shared-lib',
  () => ({
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    },
    dbService: { getConnection: jest.fn() },
    // Re-exported by the real shared-lib index; parsePositiveInt is pure.
    parsePositiveInt: require('./mocks/shared-lib').parsePositiveInt
  }),
  { virtual: true }
);

jest.mock('arangojs', () => ({
  aql: (strings, ...values) => ({ _aql: true, strings, values })
}));

jest.mock('worker_threads', () => ({
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    postMessage: jest.fn(),
    terminate: jest.fn()
  }))
}));

jest.mock('../services/retrieval-config-client', () => ({
  getRetrievalConfig: jest.fn(),
  getAuthorizedGraphs: jest.fn(),
  OkfAuthzUnauthorizedError: class OkfAuthzUnauthorizedError extends Error {
    constructor(message) {
      super(message);
      this.statusCode = 401;
      this.code = 'OKF_UNAUTHORIZED';
    }
  }
}));

const retrievalConfigClient = require('../services/retrieval-config-client');
const { logger } = require('../shared-lib');

function okfConfig(overrides = {}) {
  return {
    config: { mode: 'legacy' },
    source: 'database',
    serving_graph_count: 0,
    serving_repo_ids: [],
    serving_graphs: [],
    engaged: false,
    warnings: [],
    ...overrides
  };
}

function makeQueryData(overrides = {}) {
  return {
    userId: 'user-1',
    sessionId: 'session-1',
    messages: [{ role: 'user', content: 'What is the tax rate?' }],
    context: { categoryLabel: null, serviceLabels: [], language: 'EN' },
    ...overrides
  };
}

const BEARER = { authorization: 'Bearer test-token' };

let queryService;

beforeEach(() => {
  jest.clearAllMocks();

  // DB seams used by initStreamQuery (categoryId resolution is skipped — the
  // fixture context carries categoryLabel null).
  const mockDb = {
    collection: jest.fn().mockReturnValue({
      save: jest.fn().mockResolvedValue({ _key: 'query-1' }),
      update: jest.fn().mockResolvedValue({ _key: 'query-1' })
    }),
    query: jest.fn()
  };
  const { dbService } = require('../shared-lib');
  dbService.getConnection.mockResolvedValue(mockDb);

  jest.isolateModules(() => {
    queryService = require('../services/query-service');
  });
  queryService.initialized = true;
  queryService.db = mockDb;
  queryService.queries = mockDb.collection();
  queryService.serviceCategories = mockDb.collection();
  queryService.services = mockDb.collection();
});

afterEach(() => {
  delete process.env.ARANGO_GRAPH_NAME;
});

describe('QueryService fan-out carrier (Story 1.1 — I/O Matrix)', () => {
  it('LEGACY_DEFAULT: engaged false + mode legacy → payload byte-identical to pre-1.1', async () => {
    retrievalConfigClient.getRetrievalConfig.mockResolvedValue(okfConfig({ config: { mode: 'legacy' } }));

    const { opeaPayload } = await queryService.initStreamQuery(makeQueryData(), BEARER);

    expect(opeaPayload.context).toEqual({
      categoryLabel: null,
      serviceLabels: [],
      language: 'EN'
    });
    // No carrier keys at all — the pre-1.1 context, byte for byte.
    expect(Object.keys(opeaPayload.context).sort()).toEqual(['categoryLabel', 'language', 'serviceLabels']);
    expect(retrievalConfigClient.getAuthorizedGraphs).not.toHaveBeenCalled();
  });

  it('HYBRID_WITH_SERVING: engaged true + hybrid → GRAPH prepended first, OKF graphs after', async () => {
    process.env.ARANGO_GRAPH_NAME = 'GRAPH';
    retrievalConfigClient.getRetrievalConfig.mockResolvedValue(
      okfConfig({ config: { mode: 'hybrid' }, engaged: true, serving_graph_count: 2 })
    );
    retrievalConfigClient.getAuthorizedGraphs.mockResolvedValue({
      graph_names: ['OKF_agro_v1', 'OKF_health_v2']
    });

    const { opeaPayload } = await queryService.initStreamQuery(makeQueryData(), BEARER);

    expect(opeaPayload.context.authorized_graph_names).toEqual(['GRAPH', 'OKF_agro_v1', 'OKF_health_v2']);
    expect(opeaPayload.context.mode).toBe('hybrid');
    // hybrid never sets the exclusion flag — the legacy corpus is a leg here.
    expect(opeaPayload.context.exclude_legacy).toBeUndefined();
    expect(retrievalConfigClient.getAuthorizedGraphs).toHaveBeenCalledTimes(1);
  });

  it('OKF_ONLY_WITH_SERVING: engaged true + okf_only → NO GRAPH, exclude_legacy true', async () => {
    retrievalConfigClient.getRetrievalConfig.mockResolvedValue(
      okfConfig({ config: { mode: 'okf_only' }, engaged: true, serving_graph_count: 2 })
    );
    retrievalConfigClient.getAuthorizedGraphs.mockResolvedValue({
      graph_names: ['OKF_agro_v1', 'OKF_health_v2']
    });

    const { opeaPayload } = await queryService.initStreamQuery(makeQueryData(), BEARER);

    // okf_only means OKF only — the legacy free-form corpus is NEVER included.
    expect(opeaPayload.context.authorized_graph_names).toEqual(['OKF_agro_v1', 'OKF_health_v2']);
    expect(opeaPayload.context.mode).toBe('okf_only');
    expect(opeaPayload.context.exclude_legacy).toBe(true);
  });

  it('HYBRID_ZERO_SERVING: engaged false + hybrid → empty carrier, authz never called', async () => {
    process.env.ARANGO_GRAPH_NAME = 'GRAPH';
    retrievalConfigClient.getRetrievalConfig.mockResolvedValue(
      okfConfig({ config: { mode: 'hybrid' }, engaged: false, serving_graph_count: 0 })
    );

    const { opeaPayload } = await queryService.initStreamQuery(makeQueryData(), BEARER);

    expect(opeaPayload.context.authorized_graph_names).toEqual([]);
    expect(opeaPayload.context.mode).toBe('hybrid');
    expect(opeaPayload.context.exclude_legacy).toBeUndefined();
    // The carrier is empty regardless — the authz call is skipped.
    expect(retrievalConfigClient.getAuthorizedGraphs).not.toHaveBeenCalled();
  });

  it('OKF_ONLY_ZERO_SERVING: engaged false + okf_only → empty carrier + exclude_legacy + structured warning', async () => {
    retrievalConfigClient.getRetrievalConfig.mockResolvedValue(
      okfConfig({
        config: { mode: 'okf_only' },
        engaged: false,
        serving_graph_count: 0,
        warnings: ['okf_only with zero serving graphs — OKF contribution is zero (ADR-039 D2)']
      })
    );

    const { opeaPayload } = await queryService.initStreamQuery(makeQueryData(), BEARER);

    expect(opeaPayload.context.authorized_graph_names).toEqual([]);
    expect(opeaPayload.context.mode).toBe('okf_only');
    expect(opeaPayload.context.exclude_legacy).toBe(true);
    // Telemetry for the admin dashboard — NOT surfaced to the user chat.
    expect(logger.warn).toHaveBeenCalledWith(
      'QueryService.fanout_warning',
      expect.objectContaining({
        fanout: { warning: 'okf_only_zero_serving', mode: 'okf_only', engaged: false }
      })
    );
  });

  it('UNAUTHORIZED_REPO: the authz-resolver returns only the authorized graph', async () => {
    process.env.ARANGO_GRAPH_NAME = 'GRAPH';
    retrievalConfigClient.getRetrievalConfig.mockResolvedValue(
      okfConfig({ config: { mode: 'hybrid' }, engaged: true, serving_graph_count: 3 })
    );
    // 3 repos serving; the caller is scoped to 1 — the resolver already
    // filtered (isolation boundary); the BFF only prepends GRAPH (hybrid).
    retrievalConfigClient.getAuthorizedGraphs.mockResolvedValue({ graph_names: ['OKF_authorized_v1'] });

    const { opeaPayload } = await queryService.initStreamQuery(makeQueryData(), BEARER);

    expect(opeaPayload.context.authorized_graph_names).toEqual(['GRAPH', 'OKF_authorized_v1']);
  });

  it('BFF_CANNOT_REACH_OKF_SERVER: last-known-good default (legacy) → byte-identical payload, chat still succeeds', async () => {
    // The client failed closed: legacy default (never-read LKG).
    retrievalConfigClient.getRetrievalConfig.mockResolvedValue(
      okfConfig({ config: { mode: 'legacy' }, source: 'bff-fail-closed-default' })
    );

    const { opeaPayload } = await queryService.initStreamQuery(makeQueryData(), BEARER);

    expect(opeaPayload.context).toEqual({
      categoryLabel: null,
      serviceLabels: [],
      language: 'EN'
    });
    expect(retrievalConfigClient.getAuthorizedGraphs).not.toHaveBeenCalled();
  });

  it('RETRIEVER_FANOUT_ENABLED=false is opaque to the BFF: the payload shape is unchanged', async () => {
    process.env.ARANGO_GRAPH_NAME = 'GRAPH';
    // The BFF never reads the retriever's kill switch — the same hybrid
    // carrier goes out either way; the retriever falls back to legacy itself.
    retrievalConfigClient.getRetrievalConfig.mockResolvedValue(
      okfConfig({ config: { mode: 'hybrid' }, engaged: true, serving_graph_count: 1 })
    );
    retrievalConfigClient.getAuthorizedGraphs.mockResolvedValue({ graph_names: ['OKF_a_v1'] });

    const { opeaPayload } = await queryService.initStreamQuery(makeQueryData(), BEARER);

    expect(opeaPayload.context.authorized_graph_names).toEqual(['GRAPH', 'OKF_a_v1']);
  });

  it('BEARER_TOKEN_EXPIRED: a 401 from the client propagates — no silent legacy fallback', async () => {
    retrievalConfigClient.getRetrievalConfig.mockRejectedValue(
      Object.assign(new Error('token expired'), { statusCode: 401 })
    );

    await expect(queryService.initStreamQuery(makeQueryData(), BEARER)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('unexpected resolver error: fails closed to the legacy payload (chat still succeeds)', async () => {
    retrievalConfigClient.getRetrievalConfig.mockRejectedValue(new Error('boom'));

    const { opeaPayload } = await queryService.initStreamQuery(makeQueryData(), BEARER);

    expect(opeaPayload.context).toEqual({
      categoryLabel: null,
      serviceLabels: [],
      language: 'EN'
    });
  });

  it('no bearer header: the carrier is skipped entirely (legacy payload)', async () => {
    retrievalConfigClient.getRetrievalConfig.mockResolvedValue(
      okfConfig({ config: { mode: 'hybrid' }, engaged: true })
    );

    const { opeaPayload } = await queryService.initStreamQuery(makeQueryData(), {});

    expect(opeaPayload.context).toEqual({
      categoryLabel: null,
      serviceLabels: [],
      language: 'EN'
    });
    expect(retrievalConfigClient.getRetrievalConfig).not.toHaveBeenCalled();
  });

  it('ARANGO_GRAPH_NAME env override: the hybrid prepend uses the configured legacy graph name', async () => {
    process.env.ARANGO_GRAPH_NAME = 'LEGACY_CORPUS';
    retrievalConfigClient.getRetrievalConfig.mockResolvedValue(
      okfConfig({ config: { mode: 'hybrid' }, engaged: true, serving_graph_count: 1 })
    );
    retrievalConfigClient.getAuthorizedGraphs.mockResolvedValue({ graph_names: ['OKF_a_v1'] });

    const { opeaPayload } = await queryService.initStreamQuery(makeQueryData(), BEARER);

    expect(opeaPayload.context.authorized_graph_names).toEqual(['LEGACY_CORPUS', 'OKF_a_v1']);
  });
});

describe('QueryService fan-out carrier — createQuery non-stream path (Story 1.1)', () => {
  // createQuery hands the payload to runOPEAWorker (no return of the payload
  // itself) — pin the shape at the worker boundary.
  beforeEach(() => {
    // createQuery resolves the (non-null) categoryLabel through AQL.
    queryService.db.query.mockResolvedValue({ next: jest.fn().mockResolvedValue(null) });
    queryService.runOPEAWorker = jest.fn().mockResolvedValue({ response: 'ok', metadata: {}, responseTime: 5 });
  });

  it('hybrid engaged: the worker payload carries GRAPH first, OKF graphs after', async () => {
    process.env.ARANGO_GRAPH_NAME = 'GRAPH';
    retrievalConfigClient.getRetrievalConfig.mockResolvedValue(
      okfConfig({ config: { mode: 'hybrid' }, engaged: true, serving_graph_count: 1 })
    );
    retrievalConfigClient.getAuthorizedGraphs.mockResolvedValue({ graph_names: ['OKF_agro_v1'] });

    await queryService.createQuery(makeQueryData(), BEARER);

    expect(queryService.runOPEAWorker).toHaveBeenCalledTimes(1);
    const payload = queryService.runOPEAWorker.mock.calls[0][1];
    expect(payload.context.authorized_graph_names).toEqual(['GRAPH', 'OKF_agro_v1']);
    expect(payload.context.mode).toBe('hybrid');
    expect(payload.context.exclude_legacy).toBeUndefined();
  });

  it('okf_only engaged: the worker payload carries NO legacy graph + exclude_legacy true', async () => {
    retrievalConfigClient.getRetrievalConfig.mockResolvedValue(
      okfConfig({ config: { mode: 'okf_only' }, engaged: true, serving_graph_count: 2 })
    );
    retrievalConfigClient.getAuthorizedGraphs.mockResolvedValue({ graph_names: ['OKF_agro_v1', 'OKF_health_v2'] });

    await queryService.createQuery(makeQueryData(), BEARER);

    const payload = queryService.runOPEAWorker.mock.calls[0][1];
    expect(payload.context.authorized_graph_names).toEqual(['OKF_agro_v1', 'OKF_health_v2']);
    expect(payload.context.mode).toBe('okf_only');
    expect(payload.context.exclude_legacy).toBe(true);
  });
});
