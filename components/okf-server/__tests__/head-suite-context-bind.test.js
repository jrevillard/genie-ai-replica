// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// #2061 phase 3 (E-7) — the EXPLICIT rebind.
//
// A suite minted before contexts existed carries no binding, and it is never
// bound AUTOMATICALLY. A superadmin may bind it explicitly — and the only
// honest target is the OPEN context, because that is what such a suite was
// actually minted against.

jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));
jest.mock('axios');
jest.mock('../shared-lib/tracing', () => ({
  withSpan: jest.fn(async (name, fn) => fn({ setAttribute: jest.fn() }))
}));
jest.mock('../shared-lib/db-connection-service', () => {
  const mockDb = require('./mocks/arango-mock').createMockDb();
  return { getConnection: jest.fn(() => Promise.resolve(mockDb)), __mockDb: mockDb };
});
jest.mock('../services/frontmatter-service', () => ({
  readFrontmatterFromRepoDoc: jest.fn(),
  vllmChatCompletions: jest.fn(),
  teiEmbed: jest.fn()
}));
jest.mock('../services/repository-service', () => ({
  getById: jest.fn()
}));
jest.mock('../services/head-test-service', () => ({
  routingTest: jest.fn(),
  guardSuggestions: jest.fn(),
  loadSiblings: jest.fn(async () => [])
}));
jest.mock('../services/evaluation-context-service', () => ({
  getContext: jest.fn(),
  bindingFor: jest.fn()
}));

const svc = require('../services/head-suite-service');
const frontmatterService = require('../services/frontmatter-service');
const evaluationContextService = require('../services/evaluation-context-service');
const repositoryService = require('../services/repository-service');
const { __mockDb } = require('../shared-lib/db-connection-service');

const FM = {
  topic: ['cancer-screening'],
  entity: ['breast-cancer'],
  scope: 'healthcare',
  forbidden: ['mental-health'],
  summary: 'Cancer screening guidance.',
  keyword: ['who']
};

function llmResponse(obj) {
  return { data: { choices: [{ message: { content: JSON.stringify(obj) } }] } };
}

const BINDING = {
  context: { id: 'ctx-open', name: 'Open', version: 1, hash: 'openh' },
  carrier: { context: { id: 'ctx-open', name: 'Open', version: 1, hash: 'openh' }, repo_ids: ['me'], repos: [] },
  repos: [{ repo_id: 'me', name: 'NCD Information', graph_name: 'OKF_ncd_v3', head_version: 42 }],
  out_set: [],
  repo_set_hash: 'pool-hash',
  head_version_hash: 'heads-hash'
};

async function seedUnboundSuite() {
  __mockDb.query.mockResolvedValue({ all: async () => [] });
  return svc.generateSuite('me', {}, {});
}

beforeEach(() => {
  jest.clearAllMocks();
  __mockDb._reset();
  repositoryService.getById.mockResolvedValue({
    _key: 'me',
    name: 'NCD Information',
    version: 3,
    head: { version: 42 },
    frontmatter: FM
  });
  frontmatterService.readFrontmatterFromRepoDoc.mockResolvedValue(FM);
  frontmatterService.vllmChatCompletions.mockResolvedValue(
    llmResponse({ positive: [{ query: 'positive query 0', reason: 'r' }], negative: [], keywords: [] })
  );
  // The REAL persisted shape: `resolved` carries the EFFECTIVE scopes and the
  // snapshot — the fields production writes. It does NOT carry a derived
  // `open_context` flag, so a gate that reads one would refuse every context
  // that was ever created.
  evaluationContextService.getContext.mockResolvedValue({
    _key: 'ctx-open',
    name: 'Open',
    version: 1,
    scopes: [],
    principal_refs: [],
    resolved: {
      scopes: [],
      graph_names: ['OKF_ncd_v3'],
      repos: [{ repo_id: 'me', name: 'NCD Information', graph_name: 'OKF_ncd_v3' }],
      scope_mode: 'open',
      resolved_at: '2026-11-23T00:00:00.000Z',
      hash: 'openh'
    }
  });
  evaluationContextService.bindingFor.mockResolvedValue(BINDING);
});

describe('#2061 phase 3 (E-7): the explicit rebind', () => {
  it('binds an unbound suite to the OPEN context and records that it was bound by hand', async () => {
    const suite = await seedUnboundSuite();
    const bound = await svc.bindSuite('me', suite._key, 'ctx-open', {
      actor: { user_id: 'admin-1' },
      okfScopes: [],
      isSuperAdmin: true
    });
    expect(bound.payload.context).toEqual(
      expect.objectContaining({
        id: 'ctx-open',
        name: 'Open',
        version: 1,
        repo_set_hash: 'pool-hash',
        head_version_hash: 'heads-hash'
      })
    );
    // The bind is recorded as LATER and by hand — the suite was not minted
    // for this context.
    expect(bound.payload.bound_by).toBe('admin-1');
    expect(bound.payload.bound_at).toEqual(expect.any(String));
  });

  it('REFUSES to rebind a suite that is already bound', async () => {
    const suite = await seedUnboundSuite();
    await svc.bindSuite('me', suite._key, 'ctx-open', { actor: { user_id: 'admin-1' }, isSuperAdmin: true });
    await expect(
      svc.bindSuite('me', suite._key, 'ctx-open', { actor: { user_id: 'admin-1' }, isSuperAdmin: true })
    ).rejects.toMatchObject({ code: 'SUITE_ALREADY_BOUND', status: 409 });
  });

  it('REFUSES a target that is not the OPEN context', async () => {
    const suite = await seedUnboundSuite();
    // A RESTRICTED context: it names a scope, so it is not the open context.
    evaluationContextService.getContext.mockResolvedValue({
      _key: 'ctx-restricted',
      name: 'Analysts',
      version: 2,
      scopes: ['okf:t:r-other:read'],
      principal_refs: [],
      resolved: {
        scopes: ['okf:t:r-other:read'],
        graph_names: ['OKF_other_v1'],
        repos: [{ repo_id: 'r-other', name: 'Other', graph_name: 'OKF_other_v1' }],
        scope_mode: 'open',
        resolved_at: '2026-11-23T00:00:00.000Z',
        hash: 'restrictedh'
      }
    });
    await expect(
      svc.bindSuite('me', suite._key, 'ctx-restricted', { actor: { user_id: 'admin-1' }, isSuperAdmin: true })
    ).rejects.toMatchObject({ code: 'REBIND_NOT_OPEN_CONTEXT', status: 409 });
  });

  it('REFUSES when the context does not name the repository under test', async () => {
    const suite = await seedUnboundSuite();
    evaluationContextService.bindingFor.mockResolvedValue({
      ...BINDING,
      repos: [{ repo_id: 'r-other', name: 'Other', graph_name: 'OKF_other_v1', head_version: 1 }]
    });
    await expect(
      svc.bindSuite('me', suite._key, 'ctx-open', { actor: { user_id: 'admin-1' }, isSuperAdmin: true })
    ).rejects.toMatchObject({ code: 'UNDER_TEST_OUT_OF_CARRIER', status: 409 });
  });
});
