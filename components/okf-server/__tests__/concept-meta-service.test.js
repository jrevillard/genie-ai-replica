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

  it('UPDATES on re-ingest — same body is idempotent (no duplicate, same hash, created_at preserved)', async () => {
    await conceptMeta.upsertConceptMeta('r1', parsedInput());
    const firstDoc = Object.values(mockDb._stores.okf_concepts_meta)[0];
    const second = await conceptMeta.upsertConceptMeta('r1', parsedInput());
    expect(second.action).toBe('updated');
    const docs = Object.values(mockDb._stores.okf_concepts_meta);
    expect(docs.length).toBe(1); // no duplicate
    expect(docs[0].content_hash).toBe(firstDoc.content_hash); // SAME body → SAME hash (dedup key)
    expect(docs[0].created_at).toBe(firstDoc.created_at); // created_at never rewritten
  });

  it('content_hash CHANGES when the body changes (the 2.9.1/2.9.5 dedup key)', async () => {
    await conceptMeta.upsertConceptMeta('r1', parsedInput());
    const firstDoc = Object.values(mockDb._stores.okf_concepts_meta)[0];
    await conceptMeta.upsertConceptMeta('r1', parsedInput({ body: '# Changed\nNew body' }));
    const doc = Object.values(mockDb._stores.okf_concepts_meta)[0];
    expect(doc.content_hash).not.toBe(firstDoc.content_hash);
    expect(doc.content_hash).toBe(conceptMeta.contentHash('# Changed\nNew body'));
  });

  it('handles the concurrent-create race (unique violation → retry as update)', async () => {
    // Force save() to throw a unique violation once, then fall through to update.
    const col = mockDb.collection('okf_concepts_meta');
    const realSave = col.save;
    try {
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
    } finally {
      col.save = realSave; // restore even on assertion failure (no leak into sibling tests)
    }
  });

  it('persistConformanceIssues now CREATES the doc + writes the issues (G9)', async () => {
    const issues = [{ code: 'MISSING_TYPE', severity: 'warning', message: 'no type', field_path: 'frontmatter.type' }];
    await persistConformanceIssues('r1', 'concepts/health-policy', issues);
    const docs = Object.values(mockDb._stores.okf_concepts_meta);
    expect(docs.length).toBe(1); // CREATED, not a silent no-op
    expect(docs[0].conformance_issues).toEqual(issues);
  });

  it('getRepoMetrics reads okf_concepts_meta via AQL (pass-through contract; the live-Arango non-zero proof is run-smoke.js)', async () => {
    // The unit mock cannot execute AQL — this test pins the CONTRACT honestly:
    // the query targets okf_concepts_meta and the cursor result is mapped
    // through verbatim. The real integration proof (docs written by THIS
    // writer → non-zero concept_count / conformance_issue_count on live
    // Arango) lives in data/okf/smoke-test/run-smoke.js, run against the
    // local build. No mock-echo assertions here.
    const querySpy = mockDb.query;
    querySpy.mockResolvedValue({
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
    expect(querySpy).toHaveBeenCalledTimes(1);
    const arg = querySpy.mock.calls[0][0];
    // The collection handle rides as aql bind param @value0 (the mock
    // stringifies the handle to {}) — assert the query scans it for the repo.
    expect(arg.query).toContain('FOR d IN @value0');
    expect(arg.query).toContain('conformance_issue_count');
    expect(arg.bindVars.value1).toBe('r1');
    expect(m).toEqual({
      concept_count: 2,
      conformance_issue_count: 1,
      stale_concept_count: 1,
      has_reserved_index: false,
      broken_link_count: 0,
      pii_hit_count: 0
    });
  });
});

describe('concept-meta-service — review findings (2026-08-15 code review)', () => {
  beforeEach(() => mockDb._reset());

  it('REGRESSION: a minimal persist does NOT clobber first-class fields on an existing doc', async () => {
    // The G9 write-path order (ADR-021: 4b full upsert → 4c conformance persist)
    // means persistConformanceIssues runs AFTER the full doc exists. It must
    // write ONLY conformance_issues — the review found the update path
    // spreading a full defaults doc over the real one.
    await conceptMeta.upsertConceptMeta('r1', parsedInput());
    const before = { ...Object.values(mockDb._stores.okf_concepts_meta)[0] };

    const issues = [
      { code: 'BAD_ACTOR_PREFIX', severity: 'warning', message: 'bad actor', field_path: 'generated.by' }
    ];
    await persistConformanceIssues('r1', 'concepts/health-policy', issues);

    const doc = Object.values(mockDb._stores.okf_concepts_meta)[0];
    expect(doc.conformance_issues).toEqual(issues); // the point of the persist
    // Everything the full upsert wrote must SURVIVE:
    expect(doc.title).toBe(before.title);
    expect(doc.type).toBe(before.type);
    expect(doc.tags).toEqual(before.tags);
    expect(doc.labels).toEqual(before.labels);
    expect(doc.summary).toBe(before.summary);
    expect(doc.frontmatter).toEqual(before.frontmatter);
    expect(doc.content_hash).toBe(before.content_hash); // NOT sha256('')
    expect(doc.trust_tier).toBe(before.trust_tier);
    expect(doc.sources).toEqual(before.sources);
    expect(doc.stale_after).toBe(before.stale_after);
    expect(doc.verified).toEqual(before.verified);
    expect(doc.bundle_version).toBe(before.bundle_version);
    expect(doc.created_at).toBe(before.created_at);
  });

  it('REGRESSION: full re-ingest does NOT downgrade a scanned pii_state (fail-closed gate)', async () => {
    await conceptMeta.upsertConceptMeta('r1', parsedInput(), {
      patch: { pii_state: 'hit', pii_scanned_at: '2026-08-15T00:00:00Z' }
    });
    await conceptMeta.upsertConceptMeta('r1', parsedInput({ body: '# v2 body' }));
    const doc = Object.values(mockDb._stores.okf_concepts_meta)[0];
    expect(doc.pii_state).toBe('hit'); // stays 'hit' — never reset to 'unknown' without a rescan
  });

  it('REGRESSION: full re-ingest preserves last_good_index_at', async () => {
    await conceptMeta.upsertConceptMeta('r1', parsedInput(), { patch: { last_good_index_at: '2026-08-15T01:00:00Z' } });
    await conceptMeta.upsertConceptMeta('r1', parsedInput({ body: '# v2 body' }));
    const doc = Object.values(mockDb._stores.okf_concepts_meta)[0];
    expect(doc.last_good_index_at).toBe('2026-08-15T01:00:00Z');
  });

  it('REGRESSION: rejects falsy repo_id/concept_id (repo-wide firstExample hazard on real arangojs)', async () => {
    await expect(conceptMeta.upsertConceptMeta('r1', { concept_id: undefined })).rejects.toThrow(/concept_id/);
    await expect(conceptMeta.upsertConceptMeta(undefined, parsedInput())).rejects.toThrow(/repo_id/);
    await expect(conceptMeta.upsertConceptMeta('r1', parsedInput({ concept_id: undefined }))).rejects.toThrow(
      /concept_id/
    );
  });

  it('REGRESSION: TOCTOU — doc deleted between find and update → falls through to create', async () => {
    await conceptMeta.upsertConceptMeta('r1', parsedInput());
    const col = mockDb.collection('okf_concepts_meta');
    const realUpdate = col.update;
    try {
      // The doc exists (find succeeds) but the update hits a 1204 — deleted in
      // between. The writer must retry as a create, not propagate the 404.
      col.update.mockImplementationOnce(async () => {
        const e = new Error('document not found');
        e.errorNum = 1204;
        throw e;
      });
      const result = await conceptMeta.upsertConceptMeta('r1', parsedInput());
      expect(result.action).toBe('created');
    } finally {
      col.update = realUpdate;
    }
  });

  it('REGRESSION: invalid lifecycle status falls back to draft (enum validation)', async () => {
    await conceptMeta.upsertConceptMeta('r1', parsedInput({ status: 'retired' }));
    const doc = Object.values(mockDb._stores.okf_concepts_meta)[0];
    expect(doc.lifecycle_status).toBe('draft');
  });

  it('REGRESSION: null/undefined parsed input does not throw a TypeError (dead guard fixed)', async () => {
    await expect(conceptMeta.upsertConceptMeta('r1', null)).rejects.toThrow(/concept_id/); // guarded rejection, not TypeError
  });

  it('REGRESSION: persistConformanceIssues with undefined issues writes [] and does not crash', async () => {
    await persistConformanceIssues('r1', 'concepts/health-policy', undefined); // must resolve, not crash
    const doc = Object.values(mockDb._stores.okf_concepts_meta)[0];
    expect(doc.conformance_issues).toEqual([]);
  });
});

describe('concept-meta-service — 2.9.1 review findings (2026-08-16 code review)', () => {
  beforeEach(() => mockDb._reset());

  it('REGRESSION: full re-ingest does NOT downgrade index_status indexed → parsed (2.9.4 owns the transition)', async () => {
    await conceptMeta.upsertConceptMeta('r1', parsedInput(), {
      patch: { index_status: 'indexed', last_good_index_at: '2026-08-16T00:00:00Z' }
    });
    await conceptMeta.upsertConceptMeta('r1', parsedInput()); // FULL re-ingest writes index_status:'parsed'
    const doc = Object.values(mockDb._stores.okf_concepts_meta)[0];
    expect(doc.index_status).toBe('indexed'); // the worker's terminal state survives re-ingest
  });

  it('a non-indexed doc still takes the fresh "parsed" status (protection is not a freeze)', async () => {
    await conceptMeta.upsertConceptMeta('r1', parsedInput());
    const doc = Object.values(mockDb._stores.okf_concepts_meta)[0];
    expect(doc.index_status).toBe('parsed');
    await conceptMeta.upsertConceptMeta('r1', parsedInput());
    expect(Object.values(mockDb._stores.okf_concepts_meta)[0].index_status).toBe('parsed');
  });

  it('getConceptMeta returns the stored doc / null when absent (the 4e PRE-upsert read)', async () => {
    expect(await conceptMeta.getConceptMeta('r1', 'concepts/health-policy')).toBeNull();
    await conceptMeta.upsertConceptMeta('r1', parsedInput());
    const doc = await conceptMeta.getConceptMeta('r1', 'concepts/health-policy');
    expect(doc).toMatchObject({ repo_id: 'r1', concept_id: 'concepts/health-policy', index_status: 'parsed' });
    expect(doc.content_hash).toBe(conceptMeta.contentHash('# Health Policy\nGuidance for the ministry.'));
  });

  it('getConceptMeta guards falsy keys (repo-wide read hazard)', async () => {
    expect(await conceptMeta.getConceptMeta('', 'concepts/x')).toBeNull();
    expect(await conceptMeta.getConceptMeta('r1', undefined)).toBeNull();
  });
});

describe('concept-meta-service — real-arangojs no-match tolerance (smoke-test catch)', () => {
  beforeEach(() => mockDb._reset());

  it('treats a firstExample THROW ("no match") as absent → creates the doc (real arangojs + shared wrapper throw, the mock returns null)', async () => {
    const col = mockDb.collection('okf_concepts_meta');
    // Real arangojs firstExample throws ArangoError 'no match' (errorNum 1204)
    // when no doc exists; the shared db wrapper surfaces it as a thrown error.
    const notFound = new Error('no match');
    notFound.errorNum = 1204;
    col.firstExample.mockRejectedValueOnce(notFound);
    const result = await conceptMeta.upsertConceptMeta('r1', parsedInput());
    expect(result.action).toBe('created');
    expect(Object.values(mockDb._stores.okf_concepts_meta).length).toBe(1);
  });

  it('surfaces a TRANSIENT firstExample error (not a no-match) — does not mask', async () => {
    const col = mockDb.collection('okf_concepts_meta');
    const transient = new Error('connection reset');
    transient.code = 'ECONNRESET';
    col.firstExample.mockRejectedValueOnce(transient);
    await expect(conceptMeta.upsertConceptMeta('r1', parsedInput())).rejects.toThrow('connection reset');
  });
});
