// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// #2061 phase 3 (E-7) — the suite is minted FOR a context.
//
// A suite minted against the DEPLOYMENT measures the deployment. A suite
// minted for a CONTEXT measures that context: the rivals the confusables
// cite are the carrier's repositories, and the abstention probes are minted
// from what the context EXCLUDES.
//
// Every row carries `intended_carrier` — 'in' when it was minted from the
// carrier's pool, 'out' when it was minted from the excluded pool. It is
// PROVENANCE, not a subject label: one rule, no per-class table.

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
  loadSiblings: jest.fn(async () => []),
  embedQueryBatch: jest.fn(async (queries) => ({
    vectors: queries.map(() => [0.1, 0.2, 0.3]),
    prefixed: true,
    model: 'test-model'
  })),
  embedQuery: jest.fn(async () => ({ vector: [0.1, 0.2, 0.3], prefixed: true, model: 'test-model' }))
}));

const svc = require('../services/head-suite-service');
const frontmatterService = require('../services/frontmatter-service');
const repositoryService = require('../services/repository-service');
const { __mockDb } = require('../shared-lib/db-connection-service');

const FM = {
  topic: ['cancer-screening', 'cardiovascular-disease'],
  entity: ['breast-cancer'],
  scope: 'healthcare',
  forbidden: ['mental-health', 'nutrition', 'exercise'],
  summary: 'Cancer screening and CVD guidance.',
  keyword: ['who']
};

function llmResponse(obj) {
  return { data: { choices: [{ message: { content: JSON.stringify(obj) } }] } };
}

describe('#2061 phase 3 (E-7): the suite is minted FOR a context', () => {
  const BINDING = {
    context: { id: 'ctx-1', name: 'group-a', version: 1, hash: 'ctxhash' },
    carrier: {
      context: { id: 'ctx-1', name: 'group-a', version: 1, hash: 'ctxhash' },
      repo_ids: ['me', 'sib1'],
      graph_names: ['OKF_ncd_v3', 'OKF_kenya_v1'],
      repos: [
        { repo_id: 'me', name: 'NCD Information', domain: 'health', graph_name: 'OKF_ncd_v3' },
        { repo_id: 'sib1', name: 'Kenya Services', domain: 'general', graph_name: 'OKF_kenya_v1' }
      ],
      measured_hash: 'measured-hash'
    },
    repos: [
      { repo_id: 'me', name: 'NCD Information', domain: 'health', graph_name: 'OKF_ncd_v3', head_version: 42 },
      { repo_id: 'sib1', name: 'Kenya Services', domain: 'general', graph_name: 'OKF_kenya_v1', head_version: 7 }
    ],
    out_set: [{ repo_id: 'sib2', name: 'Solar System', domain: 'science', graph_name: 'OKF_solar_v1' }],
    repo_set_hash: 'repo-set-hash',
    head_version_hash: 'head-version-hash'
  };

  /** The sibling scan: the repositories with a head, narrowed by the query's ids. */
  function routeSiblingScan() {
    __mockDb.query.mockImplementation(async (aql, vars) => {
      if (aql.includes('r.head != null')) {
        const all = [
          { repo_id: 'me', name: 'NCD Information', text: 'ncd head text' },
          { repo_id: 'sib1', name: 'Kenya Services', text: 'kenya head text' },
          { repo_id: 'sib2', name: 'Solar System', text: 'solar head text' }
        ];
        // The engine honours the query's own filters — the narrowing is in
        // the AQL, so the mock reads it from there and not from a bind var
        // that happens to be present.
        const scoped = aql.includes('r._key IN @ids');
        const me = vars && vars.me;
        return {
          all: async () =>
            all
              .filter((r) => (scoped ? (vars.ids || []).includes(r.repo_id) : true))
              .filter((r) => (me ? r.repo_id !== me : true))
        };
      }
      return { all: async () => [] };
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    __mockDb._reset();
    routeSiblingScan();
    repositoryService.getById.mockResolvedValue({
      _key: 'me',
      name: 'NCD Information',
      version: 3,
      head: { version: 42 }
    });
    frontmatterService.readFrontmatterFromRepoDoc.mockResolvedValue(FM);
    frontmatterService.vllmChatCompletions.mockResolvedValue(
      llmResponse({
        positive: [{ query: 'breast cancer screening age recommendations', reason: 'topic hit' }],
        negative: [{ query: 'hospital bed capacity statistics', expected_repo: 'Kenya Services', reason: 'sibling' }],
        abstention: [
          { query: 'how far is the moon from earth', reason: 'belongs to the excluded repository' },
          { query: '', reason: 'dropped — empty' }
        ],
        keywords: ['screening']
      })
    );
  });

  it('REFUSES to mint a suite for a repository the carrier does not contain', async () => {
    const binding = {
      ...BINDING,
      carrier: { ...BINDING.carrier, repo_ids: ['sib1'], repos: [BINDING.carrier.repos[1]] },
      repos: [BINDING.repos[1]]
    };
    let error = null;
    try {
      await svc.generateSuite('me', {}, { actor: { user_id: 'u1' }, binding });
    } catch (e) {
      error = e;
    }
    expect(error).toBeTruthy();
    expect(error.code).toBe('UNDER_TEST_OUT_OF_CARRIER');
    expect(error.status).toBe(409);
    // The message names the repositories the carrier DOES hold.
    expect(error.message).toContain('Kenya Services');
  });

  it('the confusable rivals are the carriers repositories, not the deployments', async () => {
    const suite = await svc.generateSuite(
      'me',
      { n_positive: 2, n_negative: 2 },
      { actor: { user_id: 'u1' }, binding: BINDING }
    );
    // The excluded repository is NOT a rival — it is the abstention source.
    expect(suite.payload.sibling_names).toEqual(['Kenya Services']);
  });

  it('the abstention rows are minted from the EXCLUDED set and stamped out', async () => {
    const suite = await svc.generateSuite(
      'me',
      { n_positive: 2, n_negative: 2 },
      { actor: { user_id: 'u1' }, binding: BINDING }
    );
    const abstentions = suite.payload.negative.filter((q) => q.cls === 'abstention');
    expect(abstentions).toHaveLength(1);
    expect(abstentions[0]).toMatchObject({
      kind: 'negative',
      cls: 'abstention',
      intended_carrier: 'out',
      expected_repo: null
    });
    // The prompt named the excluded repository — that is where the probe comes from.
    const prompt = frontmatterService.vllmChatCompletions.mock.calls[0][0][0].content;
    expect(prompt).toContain('Solar System');
  });

  it('every row carries its intended_carrier stamp', async () => {
    const suite = await svc.generateSuite(
      'me',
      { n_positive: 2, n_negative: 2 },
      { actor: { user_id: 'u1' }, binding: BINDING }
    );
    for (const row of suite.payload.positive) expect(row.intended_carrier).toBe('in');
    for (const row of suite.payload.negative) {
      expect(['in', 'out']).toContain(row.intended_carrier);
    }
    // The in-carrier classes are 'in'; only the excluded-pool rows are 'out'.
    const byCls = {};
    for (const row of suite.payload.negative) {
      byCls[row.cls || 'confusable'] = row.intended_carrier;
    }
    expect(byCls.confusable).toBe('in');
    expect(byCls.abstention).toBe('out');
  });

  it('the suite doc stores the context SNAPSHOT and both comparison keys', async () => {
    const suite = await svc.generateSuite(
      'me',
      { n_positive: 2, n_negative: 2 },
      { actor: { user_id: 'u1' }, binding: BINDING }
    );
    expect(suite.payload.context).toEqual(
      expect.objectContaining({
        id: 'ctx-1',
        name: 'group-a',
        version: 1,
        repo_set_hash: 'repo-set-hash',
        head_version_hash: 'head-version-hash'
      })
    );
    // The snapshot, never a reference alone — the suite must be readable
    // without the context doc (and without Keycloak).
    expect(suite.payload.context.repos.map((r) => r.repo_id).sort()).toEqual(['me', 'sib1']);
    expect(suite.payload.context.repos.find((r) => r.repo_id === 'me').head_version).toBe(42);
  });

  it('a suite minted WITHOUT a context is unchanged (the migration path)', async () => {
    const suite = await svc.generateSuite('me', { n_positive: 2, n_negative: 2 }, { actor: { user_id: 'u1' } });
    expect(suite.payload.context).toBeUndefined();
    // Every rival with a head competes — the deployment's universe.
    expect(suite.payload.sibling_names.sort()).toEqual(['Kenya Services', 'Solar System']);
    // …and no row claims a carrier it was not minted for.
    for (const row of suite.payload.positive) expect(row.intended_carrier).toBeUndefined();
  });
});
