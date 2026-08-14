// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 2.9.2 — okf_concepts_meta UPSERT writer (G9). Red-green: these tests
// FAIL against the current code (no writer exists; persistConformanceIssues is
// a filter-and-UPDATE silent no-op) and PASS after T1+T2.

jest.mock('../shared-lib/db-connection-service', () => {
  const mockDb = require('./mocks/arango-mock').createMockDb();
  return { getConnection: jest.fn(() => Promise.resolve(mockDb)), __mockDb: mockDb };
});
jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));
jest.mock('../shared-lib/tracing', () => ({
  withSpan: jest.fn(async (name, fn) => fn({ setAttribute: jest.fn() }))
}));
jest.mock('../shared-lib/metrics', () => ({
  getMeter: () => ({ createCounter: () => ({ add: jest.fn() }) })
}));

const mockDb = require('../shared-lib/db-connection-service').__mockDb;
const conceptMeta = require('../services/concept-meta-service');
const { persistConformanceIssues, getRepoMetrics } = require('../services/conformance-service');

// A parseConcept-shaped input (parser-service.js:182+).
function parsedInput(overrides = {}) {
  return {
    concept_id: 'concepts/health-policy',
    repo_id: 'r1',
    path: 'concepts/health-policy.md',
    bundle_version: 1,
    frontmatter: {
      title: 'Health Policy',
      type: 'policy',
      tags: ['health', 'public'],
      labels: ['t:t1'],
      description: 'Summary text'
    },
    body: '# Health Policy\nGuidance for the ministry.',
    generated: { by: 'agent:okf-producer', at: '2026-08-14T00:00:00Z' },
    verified: null,
    trust_tier: 'unverified',
    status: 'draft',
    stale_after: null,
    sources: [{ resource: 'https://example.org/health', author: 'Ministry' }],
    links: [{ target: 'concepts/funding.md', anchor: 'funding' }],
    ...overrides
  };
}

describe('concept-meta-service.upsertConceptMeta (G9)', () => {
  beforeEach(() => mockDb._reset());

  it('CREATES the meta doc (no-prior-doc assertion — the G9 fix)', async () => {
    const result = await conceptMeta.upsertConceptMeta('r1', parsedInput());
    expect(result.action).toBe('created');
    const docs = Object.values(mockDb._stores.okf_concepts_meta);
    expect(docs.length).toBe(1);
    expect(docs[0].repo_id).toBe('r1');
    expect(docs[0].concept_id).toBe('concepts/health-policy');
  });

  it('writes ALL the first-class fields', async () => {
    await conceptMeta.upsertConceptMeta('r1', parsedInput());
    const doc = Object.values(mockDb._stores.okf_concepts_meta)[0];
    expect(doc.title).toBe('Health Policy');
    expect(doc.type).toBe('policy');
    expect(doc.tags).toEqual(['health', 'public']);
    expect(doc.labels).toEqual(['t:t1']);
    expect(doc.summary).toBe('Summary text');
    expect(doc.content_hash).toMatch(/^[a-f0-9]{64}$/); // sha256 hex
    expect(doc.lifecycle_status).toBe('draft');
    expect(doc.index_status).toBe('parsed');
    expect(doc.trust_tier).toBe('unverified');
    expect(doc.pii_state).toBe('unknown'); // default; superseded on scan (2.8)
    expect(doc.bundle_version).toBe(1);
    expect(doc.graph_name).toBe('OKF_r1');
    expect(doc.frontmatter.title).toBe('Health Policy');
  });

  it('UPDATES on re-ingest (idempotent — no duplicate)', async () => {
    await conceptMeta.upsertConceptMeta('r1', parsedInput());
    const updated = await conceptMeta.upsertConceptMeta('r1', parsedInput({ body: '# Changed\nNew body' }));
    expect(updated.action).toBe('updated');
    const docs = Object.values(mockDb._stores.okf_concepts_meta);
    expect(docs.length).toBe(1); // no duplicate
    expect(docs[0].content_hash).not.toBe(''); // body changed
  });

  it('handles the concurrent-create race (unique violation → retry as update)', async () => {
    // Force save() to throw a unique violation once, then fall through to update.
    const col = mockDb.collection('okf_concepts_meta');
    const realSave = col.save;
    col.save.mockImplementationOnce(async () => {
      const e = new Error('unique constraint violated');
      e.errorNum = 1210;
      throw e;
    });
    // Pre-insert the doc so the retry-update path finds it. Mutate the EXISTING
    // store object (the handle captured `stores[name]` by reference at first
    // collection — replacing `mockDb._stores.okf_concepts_meta` would orphan it).
    mockDb._stores.okf_concepts_meta['c1'] = { repo_id: 'r1', concept_id: 'concepts/health-policy', _key: 'c1' };
    const result = await conceptMeta.upsertConceptMeta('r1', parsedInput());
    expect(result.action).toBe('updated');
    col.save = realSave;
  });

  it('persistConformanceIssues now CREATES the doc + writes the issues (G9)', async () => {
    const issues = [{ code: 'MISSING_TYPE', severity: 'warning', message: 'no type', field_path: 'frontmatter.type' }];
    await persistConformanceIssues('r1', 'concepts/health-policy', issues);
    const docs = Object.values(mockDb._stores.okf_concepts_meta);
    expect(docs.length).toBe(1); // CREATED, not a silent no-op
    expect(docs[0].conformance_issues).toEqual(issues);
  });

  it('getRepoMetrics returns non-zero counts after concepts exist (G9 proof)', async () => {
    mockDb._stores.okf_concepts_meta = {
      a: { repo_id: 'r1', concept_id: 'a', conformance_issues: [{ code: 'MISSING_TYPE' }], stale_after: null },
      b: { repo_id: 'r1', concept_id: 'b', conformance_issues: [], stale_after: '2020-01-01' }
    };
    mockDb.query.mockResolvedValue({ all: async () => [{ state: 'x', n: 1 }] }); // unused; metrics uses query
    // getRepoMetrics uses db.query with an AQL cursor — program it.
    mockDb.query.mockResolvedValue({
      all: async () => [
        {
          concept_count: 2,
          conformance_issue_count: 1,
          stale_concept_count: 1,
          has_reserved_index: false,
          broken_link_count: 0,
          pii_hit_count: 0
        }
      ]
    });
    const m = await getRepoMetrics('r1');
    expect(m.concept_count).toBe(2);
    expect(m.conformance_issue_count).toBe(1);
    expect(m.stale_concept_count).toBe(1);
  });
});
