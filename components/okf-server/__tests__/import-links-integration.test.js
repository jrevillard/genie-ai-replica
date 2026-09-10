// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// R9 REPRO (coordinator blocker, 2026-09-05): JSON-concepts import via
// POST /import {concepts:[{path,frontmatter,body}]} must resolve author
// links (fm links[], relations, wiki body links) into okf_concepts_meta.
// REAL parser + REAL writer — only db/logger/HTTP are mocked.

jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));
jest.mock('../shared-lib/tracing', () => ({
  withSpan: jest.fn(async (name, fn) => fn({ setAttribute: jest.fn() }))
}));
jest.mock('../shared-lib/metrics', () => ({
  getMeter: () => ({
    createCounter: () => ({ add: jest.fn() }),
    createHistogram: () => ({ record: jest.fn() }) // the real metrics-middleware needs it via index.js
  })
}));
jest.mock('../shared-lib/db-connection-service', () => {
  const mockDb = require('./mocks/arango-mock').createMockDb();
  return { getConnection: jest.fn(() => Promise.resolve(mockDb)), __mockDb: mockDb };
});
jest.mock('../services/pii-service', () => ({
  scanConcept: jest.fn(async () => ({ pii_state: 'clean', pii_hits_summary: {} })),
  discoverRepoFiles: jest.fn(async () => [])
}));
jest.mock('../services/service-token', () => ({
  authedAxios: { get: jest.fn(), post: jest.fn(async () => ({ status: 202, data: { file_id: 'fx' } })) }
}));
jest.mock('../services/audit-service', () => ({ writeAudit: jest.fn().mockResolvedValue(null) }));

const mockDb = require('../shared-lib/db-connection-service').__mockDb;
const ingestService = require('../services/ingest-service');

const REPO = '23a61a7e-d0af-4f1c-b7d2-ed75462e2b5b';

describe('R9 repro: the JSON-concepts import path resolves author links (real parser + writer)', () => {
  beforeEach(() => {
    mockDb._reset();
    mockDb.collection('okf_repositories').save({
      _key: REPO,
      repo_id: REPO,
      name: 'R9 Probe',
      domain: 'smoke',
      version: null,
      okf_tag: null
    });
  });

  test('fm links[] on a JSON-imported concept land in okf_concepts_meta.links', async () => {
    const summary = await ingestService.ingestRepoConcepts(
      REPO,
      {
        concepts: [
          {
            path: 'alpha.md',
            frontmatter: { type: 'topic', title: 'Alpha' },
            body: '# Alpha\n\nBody.'
          },
          {
            path: 'index.md',
            frontmatter: {
              type: 'index',
              title: 'R9 Probe',
              links: [{ target: './alpha.md', label: 'Alpha' }]
            },
            body: '# R9 Probe\n\n## Contents\n\n'
          }
        ]
      },
      { sub: 'steward-1' }
    );
    expect(summary.created).toBe(2);
    // The mock store keys saves by repo — the LAST save (index.md) survives,
    // so the surviving row IS the index concept.
    const index = Object.values(mockDb._stores.okf_concepts_meta).find((m) => m.concept_id === 'index');
    expect(index).toBeTruthy();
    expect(index.links).toEqual([{ to_concept_id: 'alpha', label: 'Alpha' }]);
  });
});

// ROUTE-LEVEL variant (coordinator, 2026-09-05): the service-level test
// structurally cannot catch controller/deployment-layer drops — drive the
// REAL route (supertest on createApp) with real parser + writer. Only auth,
// PII, and the doc-repo HTTP client are mocked.
jest.mock('../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.user = { sub: 'steward-1', name: 'Steward' };
    req.okfScopes = ['okf:*:*:admin'];
    req.okfIsSuperAdmin = true;
    next();
  },
  parseOkfScopes: () => []
}));

describe('R9 at the ROUTE layer: POST /import resolves fm links[] (real chain)', () => {
  test('supertest through createApp: meta.links carries the resolved author link', async () => {
    const request = require('supertest');
    const { createApp } = require('../index');
    const repoId = '31313131-3232-4333-8444-555555555555';
    mockDb.collection('okf_repositories').save({
      _key: repoId,
      repo_id: repoId,
      name: 'R9 Route Probe',
      domain: 'smoke'
    });
    const res = await request(createApp())
      .post('/api/okf/repos/' + repoId + '/import')
      .send({
        concepts: [
          { path: 'alpha.md', frontmatter: { type: 'topic', title: 'Alpha' }, body: '# Alpha' },
          {
            path: 'index.md',
            frontmatter: {
              type: 'index',
              title: 'R9 Route',
              links: [{ target: './alpha.md', label: 'Alpha' }]
            },
            body: '# R9 Route'
          }
        ]
      });
    expect(res.status).toBe(202);
    const index = Object.values(mockDb._stores.okf_concepts_meta).find((m) => m.concept_id === 'index');
    expect(index).toBeTruthy();
    expect(index.links).toEqual([{ to_concept_id: 'alpha', label: 'Alpha' }]);
  });
});
