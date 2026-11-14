// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 2.9.2 — okf_concepts_meta UPSERT writer (G9). Red-green: these tests
// FAIL against the current code (no writer exists; persistConformanceIssues is
// a filter-and-UPDATE silent no-op) and PASS after T1+T2.

// axios is mocked at the TOP level, not inside the factory below: a
// jest.mock inside a factory only takes effect when that factory first
// runs, so the service captured the REAL axios whenever the import order
// changed (a real HTTP call to the configured endpoint in the unit suite).
jest.mock('axios');
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
// One manifest fixture for the ensureSummary tests (file scope).
function manifestFixture() {
  return {
    _key: 'r1',
    name: 'Demo bundle',
    domain: 'demo',
    version: 1,
    concepts: [],
    summary_stats: { concept_count: 0 },
    summary_text: null,
    summary_stale: false
  };
}

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
    expect(doc.is_index).toBe(false); // type 'policy' ≠ 'index' (Story 4.8-amend)
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

  it('is_index: true derived for type "index" (the bundle ROOT/discovery entry — Story 4.8-amend)', async () => {
    await conceptMeta.upsertConceptMeta(
      'r1',
      parsedInput({ concept_id: 'index', path: 'index.md', frontmatter: { title: 'KB', type: 'index' } })
    );
    const doc = Object.values(mockDb._stores.okf_concepts_meta)[0];
    expect(doc.concept_id).toBe('index');
    expect(doc.is_index).toBe(true);
  });

  // D-A (#979, David's Stage-1 reject): the bundle root carries the authorial
  // type "BundleRoot" — which imports correctly refuse to clobber — and is
  // STILL the index. Flag by identity (path / reserved concept_id), never let
  // the authorial type block index detection.
  it('D-A: BundleRoot-typed root is flagged is_index (authorial type never blocks)', async () => {
    await conceptMeta.upsertConceptMeta(
      'r1',
      parsedInput({ concept_id: 'index', path: 'index.md', frontmatter: { title: 'KB', type: 'BundleRoot' } })
    );
    const doc = Object.values(mockDb._stores.okf_concepts_meta)[0];
    expect(doc.is_index).toBe(true);
    expect(doc.type).toBe('BundleRoot'); // authorial type preserved intact
  });

  it('D-A: path/concept_id identity flags the index even with a non-index type or none', async () => {
    // NOTE: the unit mock keys docs by repo_id when no _key — distinct repos
    // keep the two docs distinct.
    await conceptMeta.upsertConceptMeta('r1', parsedInput({ concept_id: 'index', path: 'index.md', frontmatter: {} }));
    await conceptMeta.upsertConceptMeta(
      'r2',
      parsedInput({ concept_id: 'concepts/section-index', path: 'concepts/index.md', frontmatter: { type: 'topic' } })
    );
    const docs = Object.values(mockDb._stores.okf_concepts_meta);
    const byId = Object.fromEntries(docs.map((d) => [d.concept_id, d]));
    expect(byId['index'].is_index).toBe(true); // reserved concept_id, empty fm
    // path 'concepts/index.md' is NOT the root (registry fix: exact path match)
    expect(byId['concepts/section-index'].is_index).toBe(false);
  });

  // D-G (#985): the curation provenance attached by the import pipeline rides
  // the parsed doc into the meta row (first-class; null when never curated).
  it('D-G: parsed.curation persists on the meta doc', async () => {
    await conceptMeta.upsertConceptMeta(
      'r1',
      parsedInput({ curation: { method: 'heuristics', resolved_by: 'heuristics', label_source: 'author' } })
    );
    const doc = Object.values(mockDb._stores.okf_concepts_meta)[0];
    expect(doc.curation).toEqual({ method: 'heuristics', resolved_by: 'heuristics', label_source: 'author' });
  });
  it('D-G: curation stays null when no classification ran', async () => {
    await conceptMeta.upsertConceptMeta('r1', parsedInput());
    const doc = Object.values(mockDb._stores.okf_concepts_meta)[0];
    expect(doc.curation).toBeNull();
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
          pii_hit_count: 0
        }
      ]
    });
    await getRepoMetrics('r1');
    expect(querySpy).toHaveBeenCalledTimes(1);
    const arg = querySpy.mock.calls[0][0];
    // The collection handle rides as aql bind param @value0 (the mock
    // stringifies the handle to {}) — assert the query scans it for the repo.
    expect(arg.query).toContain('FOR d IN @value0');
    expect(arg.query).toContain('conformance_issue_count');
    expect(arg.bindVars.value1).toBe('r1');
    // broken_link_count removed (no such concept in the product); pii_hit_count
    // is computed from findings minus resolutions, never a literal zero.
    expect(arg.query).not.toContain('broken_link_count');
    expect(arg.query).toContain('pii_hit_count');
    // The cursor result is mapped through verbatim, so echoing the fixture
    // back would assert nothing — the AQL pins above are the contract.
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

  it('REGRESSION: full re-ingest does NOT downgrade index_status rejected → parsed (Story 4.8-amend)', async () => {
    await conceptMeta.upsertConceptMeta('r1', parsedInput(), {
      patch: { index_status: 'rejected', conformance_issues: [{ code: 'MISSING_TYPE' }] }
    });
    await conceptMeta.upsertConceptMeta('r1', parsedInput()); // FULL re-ingest writes index_status:'parsed'
    const doc = Object.values(mockDb._stores.okf_concepts_meta)[0];
    expect(doc.index_status).toBe('rejected'); // the hard-error rejection survives re-ingest until fixed
  });

  it('a FRONTMATTER conformance fix re-enters validation even when the body is unchanged (live-caught 2026-09-01)', async () => {
    // The rejection was `type` missing; the fix adds type: service — the BODY
    // is byte-identical, so the body-hash escape alone left the concept at
    // 'rejected' forever. Conformance-relevant frontmatter counts as content.
    const rejected = await conceptMeta.upsertConceptMeta('r1', parsedInput(), {
      patch: { index_status: 'rejected', conformance_issues: [{ code: 'MISSING_TYPE' }] }
    });
    expect(rejected.doc.index_status).toBe('rejected');
    const fixed = await conceptMeta.upsertConceptMeta(
      'r1',
      parsedInput({ frontmatter: { title: 'Health Policy', type: 'service' } })
    );
    expect(fixed.doc.index_status).toBe('parsed'); // re-validates (re-drains)
  });

  it('getConceptMeta returns the stored doc / null when absent (the 4e PRE-upsert read)', async () => {
    expect(await conceptMeta.getConceptMeta('r1', 'concepts/health-policy')).toBeNull();
    await conceptMeta.upsertConceptMeta('r1', parsedInput());
    const doc = await conceptMeta.getConceptMeta('r1', 'concepts/health-policy');
    expect(doc).toMatchObject({ repo_id: 'r1', concept_id: 'concepts/health-policy', index_status: 'parsed' });
    // Literal sha256 of the trimmed body — expected-value-equals-helper-under-test
    // can never fail for the right reason, so the algorithm is pinned literally.
    expect(doc.content_hash).toBe('1aec304dd0dbafcf045d641462d3876b5786ed3d681488124aadc4ea96f60385');
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

  it('treats the ArangoDB 3.12 firstExample miss (errorNum 404 + "no match") as absent → creates the doc', async () => {
    // LIVE-REPRODUCED on the local build (Quran Core import, 2026-11-02): the
    // 3.12 server reimplemented the simple-query API and answers its miss with
    // errorNum 404 / errorMessage 'no match' — the 3.11 server answered 1204.
    // The strict classifier refused to trust a bare 404 (a missing collection
    // carries 404 too), so every concept's existence check threw and ALL
    // 6351 imports failed at step 4b. Both halves together ARE absence.
    const col = mockDb.collection('okf_concepts_meta');
    const serverMiss = new Error('no match');
    serverMiss.errorNum = 404;
    serverMiss.code = 404;
    serverMiss.name = 'ArangoError';
    col.firstExample.mockRejectedValueOnce(serverMiss);
    const result = await conceptMeta.upsertConceptMeta('r1', parsedInput());
    expect(result.action).toBe('created');
    expect(Object.values(mockDb._stores.okf_concepts_meta).length).toBe(1);
  });

  it('a bare errorNum 404 WITHOUT the no-match message stays a real fault — does not mask', async () => {
    // The masking guard: 404 alone is what route/collection faults echo. Only
    // the server's own 'no match' errorMessage upgrades it to "absent".
    const col = mockDb.collection('okf_concepts_meta');
    const routeFault = new Error('unknown path');
    routeFault.errorNum = 404;
    routeFault.code = 404;
    routeFault.name = 'ArangoError';
    col.firstExample.mockRejectedValueOnce(routeFault);
    await expect(conceptMeta.upsertConceptMeta('r1', parsedInput())).rejects.toThrow('unknown path');
  });

  it('surfaces a TRANSIENT firstExample error (not a no-match) — does not mask', async () => {
    const col = mockDb.collection('okf_concepts_meta');
    const transient = new Error('connection reset');
    transient.code = 'ECONNRESET';
    col.firstExample.mockRejectedValueOnce(transient);
    await expect(conceptMeta.upsertConceptMeta('r1', parsedInput())).rejects.toThrow('connection reset');
  });
});

describe('concept-meta-service — Story 2.9.3 links persistence (4b additive)', () => {
  beforeEach(() => mockDb._reset());

  it('persists the parser links on the meta doc (the edge writer reads them post-index)', async () => {
    await conceptMeta.upsertConceptMeta(
      'r1',
      parsedInput({
        links: [
          { to_concept_id: 'concepts/funding', label: 'Funding' },
          { to_concept_id: 'concepts/governance', label: 'Governance' }
        ]
      })
    );
    const doc = Object.values(mockDb._stores.okf_concepts_meta)[0];
    expect(doc.links).toEqual([
      { to_concept_id: 'concepts/funding', label: 'Funding' },
      { to_concept_id: 'concepts/governance', label: 'Governance' }
    ]);
  });

  it('defaults links to [] when the parsed input has none (additive, never undefined-crash)', async () => {
    await conceptMeta.upsertConceptMeta('r1', parsedInput({ links: undefined }));
    const doc = Object.values(mockDb._stores.okf_concepts_meta)[0];
    expect(doc.links).toEqual([]);
  });
});

describe('concept-meta-service.patchConceptFields (labels write-through, 2026-09-05)', () => {
  beforeEach(() => mockDb._reset());

  function seedPatchRepo(extra = {}) {
    mockDb.collection('okf_repositories').save({
      _key: 'r1',
      repo_id: 'r1',
      name: 'Water Repo',
      domain: 'water',
      okf_tag: 'okf:v2',
      ...extra
    });
  }

  it('LABELS REACH RAG: a label edit recomputes ingest_labels via the composer (ACL first, tag last)', async () => {
    seedPatchRepo();
    await conceptMeta.upsertConceptMeta('r1', parsedInput());
    const updated = await conceptMeta.patchConceptFields('r1', 'concepts/health-policy', {
      frontmatterPatch: { labels: ['Water Supply', 'Rivers'] }
    });
    // The WORKER posts ingest_labels to dataprep — the edit must be in it.
    expect(updated.ingest_labels).toEqual(['t:water', 'r:r1', 'd:water', 'Water Supply', 'Rivers', 'okf:v2']);
    expect(updated.labels).toEqual(['Water Supply', 'Rivers']); // display field aligned
    expect(updated.content_hash).toBe((await conceptMeta.getConceptMeta('r1', 'concepts/health-policy')).content_hash);
  });

  it('ACL-prefixed caller labels are stripped on patch too (sole-injector invariant)', async () => {
    seedPatchRepo();
    await conceptMeta.upsertConceptMeta('r1', parsedInput());
    const updated = await conceptMeta.patchConceptFields('r1', 'concepts/health-policy', {
      frontmatterPatch: { labels: ['t:evil', 'Water Supply'] }
    });
    expect(updated.ingest_labels).toEqual(['t:water', 'r:r1', 'd:water', 'Water Supply', 'okf:v2']);
  });

  it('identical-fm patch keeps labels stable (noop recomputes to the same set)', async () => {
    seedPatchRepo();
    await conceptMeta.upsertConceptMeta('r1', parsedInput());
    const first = await conceptMeta.patchConceptFields('r1', 'concepts/health-policy', {
      frontmatterPatch: { labels: ['Water Supply'] }
    });
    const second = await conceptMeta.patchConceptFields('r1', 'concepts/health-policy', {
      frontmatterPatch: { labels: ['Water Supply'] }
    });
    expect(second.ingest_labels).toEqual(first.ingest_labels);
  });

  it('a missing repo doc fails SOFT — labels untouched, patch still applies', async () => {
    await conceptMeta.upsertConceptMeta('r1', parsedInput());
    const updated = await conceptMeta.patchConceptFields('r1', 'concepts/health-policy', {
      frontmatterPatch: { labels: ['Orphan'] }
    });
    expect(updated.frontmatter.labels).toEqual(['Orphan']);
    expect(updated.ingest_labels).toEqual([]); // unchanged from the stored row
  });

  it('frontmatter merge: provided keys replace, unmentioned keys survive, hash + index_status stable', async () => {
    await conceptMeta.upsertConceptMeta('r1', parsedInput());
    const before = Object.values(mockDb._stores.okf_concepts_meta)[0];
    const updated = await conceptMeta.patchConceptFields('r1', 'concepts/health-policy', {
      frontmatterPatch: { labels: ['Water Supply'] }
    });
    expect(updated).not.toBeNull();
    expect(updated.frontmatter.labels).toEqual(['Water Supply']); // provided key replaced
    expect(updated.frontmatter.title).toBe('Health Policy'); // unmentioned key survives
    expect(updated.frontmatter.tags).toEqual(['health', 'public']);
    expect(updated.body.trim()).toBe(before.body.trim()); // body untouched
    expect(updated.content_hash).toBe(before.content_hash); // labels never re-embed
    expect(updated.index_status).toBe(before.index_status);
  });

  it('explicit empty array clears ONLY that key (labels clear must not nuke the fm)', async () => {
    await conceptMeta.upsertConceptMeta('r1', parsedInput());
    const updated = await conceptMeta.patchConceptFields('r1', 'concepts/health-policy', {
      frontmatterPatch: { labels: [] }
    });
    expect(updated.frontmatter.labels).toEqual([]);
    expect(updated.frontmatter.title).toBe('Health Policy');
    expect(updated.frontmatter.description).toBe('Summary text');
  });

  // ── RFC 7386 JSON-Merge-Patch (D-F #984 — David: ALL frontmatter editable,
  //    including removal; verified no caller sends stored-nulls) ──
  it('D-F null-deletes: an explicit null REMOVES the key from frontmatter', async () => {
    await conceptMeta.upsertConceptMeta('r1', parsedInput());
    const updated = await conceptMeta.patchConceptFields('r1', 'concepts/health-policy', {
      frontmatterPatch: { description: null }
    });
    expect(updated.frontmatter).not.toHaveProperty('description');
    expect(updated.frontmatter.title).toBe('Health Policy'); // siblings untouched
  });

  it('D-F null-deletes: keys absent from the patch are untouched; non-null overwrites', async () => {
    await conceptMeta.upsertConceptMeta('r1', parsedInput());
    const updated = await conceptMeta.patchConceptFields('r1', 'concepts/health-policy', {
      frontmatterPatch: { title: 'Renamed', license: 'CC-BY-4.0' }
    });
    expect(updated.frontmatter.title).toBe('Renamed'); // non-null overwrite
    expect(updated.frontmatter.description).toBe('Summary text'); // absent = untouched
    expect(updated.frontmatter.license).toBe('CC-BY-4.0'); // new key added
    expect(updated.frontmatter.type).toBe('policy'); // absent = untouched
  });

  it('D-F null-deletes: a null INSIDE a nested object deletes that nested key (recursive merge)', async () => {
    await conceptMeta.upsertConceptMeta(
      'r1',
      parsedInput({ frontmatter: { title: 'T', parameters: { model: 'granite-4.1', temp: 0.7 } } })
    );
    const updated = await conceptMeta.patchConceptFields('r1', 'concepts/health-policy', {
      frontmatterPatch: { parameters: { temp: null } }
    });
    expect(updated.frontmatter.parameters).toEqual({ model: 'granite-4.1' }); // nested key deleted
    expect(updated.frontmatter.title).toBe('T');
  });

  it('D-F null-deletes: an array replaces whole (a null INSIDE an array is data, not deletion)', async () => {
    await conceptMeta.upsertConceptMeta('r1', parsedInput());
    const updated = await conceptMeta.patchConceptFields('r1', 'concepts/health-policy', {
      frontmatterPatch: { tags: ['one', null, 'three'] }
    });
    expect(updated.frontmatter.tags).toEqual(['one', null, 'three']); // per RFC 7386
  });

  it('body replace: hash changes, index_status resets to parsed, fm untouched', async () => {
    await conceptMeta.upsertConceptMeta('r1', parsedInput());
    const doc = Object.values(mockDb._stores.okf_concepts_meta)[0];
    doc.index_status = 'indexed'; // simulate the worker having indexed it
    const beforeHash = doc.content_hash;
    const updated = await conceptMeta.patchConceptFields('r1', 'concepts/health-policy', {
      body: '# Brand new body'
    });
    expect(updated.body.trim()).toBe('# Brand new body');
    expect(updated.content_hash).not.toBe(beforeHash);
    expect(updated.index_status).toBe('parsed'); // re-index queued
    expect(updated.frontmatter.title).toBe('Health Policy'); // fm NOT touched
  });

  it('body replace with an IDENTICAL body keeps index_status (no pointless re-index)', async () => {
    await conceptMeta.upsertConceptMeta('r1', parsedInput());
    const doc = Object.values(mockDb._stores.okf_concepts_meta)[0];
    doc.index_status = 'indexed';
    const updated = await conceptMeta.patchConceptFields('r1', 'concepts/health-policy', {
      body: doc.body
    });
    expect(updated.index_status).toBe('indexed');
  });

  it('returns null when the concept is absent (404 at the controller layer)', async () => {
    const updated = await conceptMeta.patchConceptFields('r1', 'concepts/nope', {
      frontmatterPatch: { labels: [] }
    });
    expect(updated).toBeNull();
  });

  it('VALIDATION_ERROR when neither or both of frontmatterPatch/body are given', async () => {
    await expect(conceptMeta.patchConceptFields('r1', 'concepts/health-policy', {})).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
    await expect(
      conceptMeta.patchConceptFields('r1', 'concepts/health-policy', { frontmatterPatch: {}, body: 'x' })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

// ── P0 hot-fix (David's re-test 2026-09-08): requeue for re-drain ──
describe('concept-meta-service.requeueRepoForRedrain (P0 empty-graph fix)', () => {
  beforeEach(() => mockDb._reset());

  it('requeues every repo row: index_status=parsed + claim/reaper stamps cleared (mock-echo contract)', async () => {
    await conceptMeta.upsertConceptMeta('r1', parsedInput());
    const querySpy = mockDb.query;
    querySpy.mockResolvedValueOnce({ all: async () => ['parsed'] });
    const n = await conceptMeta.requeueRepoForRedrain('r1');
    expect(n).toBe(1);
    // db.query receives the AQL as a raw string here (binds ride arg 2).
    const aqlText = String(querySpy.mock.calls[0][0]);
    expect(aqlText).toContain("'parsed'");
    expect(aqlText).toContain('worker_claimed_at: null');
    expect(aqlText).toContain('reindex_retry: 0');
    expect(aqlText).toContain('last_good_index_at: null');
    expect(aqlText).toContain('m.repo_id == @rid');
  });

  it('returns 0 for a missing repo (falsy guard)', async () => {
    expect(await conceptMeta.requeueRepoForRedrain('')).toBe(0);
  });
});

// ── #1817 (saved-conversation OKF restore): the resolver's candidate list —
// every repo_id whose meta rows hold the concept, deduped (COLLECT) so the
// controller applies its per-candidate gates without double-visiting a twin.
describe('concept-meta-service.listReposForConcept (#1817 resolver candidates)', () => {
  beforeEach(() => mockDb._reset());

  it('queries okf_concepts_meta by concept_id and returns the deduped repo list', async () => {
    const querySpy = mockDb.query;
    querySpy.mockResolvedValueOnce({ all: async () => ['ra', 'rb'] });
    const repos = await conceptMeta.listReposForConcept('concept_1');
    expect(repos).toEqual(['ra', 'rb']);
    const aqlText = String(querySpy.mock.calls.at(-1)[0]);
    expect(aqlText).toContain('okf_concepts_meta');
    expect(aqlText).toContain('m.concept_id == @cid');
    expect(aqlText).toContain('COLLECT repo_id = m.repo_id');
  });

  it('a falsy concept_id never touches the DB', async () => {
    const querySpy = mockDb.query;
    const before = querySpy.mock.calls.length;
    expect(await conceptMeta.listReposForConcept('')).toEqual([]);
    expect(querySpy.mock.calls.length).toBe(before);
  });

  it('an empty result set degrades to []', async () => {
    mockDb.query.mockResolvedValueOnce({ all: async () => [] });
    expect(await conceptMeta.listReposForConcept('concept_2')).toEqual([]);
  });
});

// ── CAP-1 (chat-source resolution): the ingest-arm stamp binds every row to
// the drained version — the retrieval enrichment join reads bundle_version
// from the meta row as FIRST-CLASS data (no graph-name parsing downstream).
describe('concept-meta-service.stampRepoGraphName (CAP-1 version stamp)', () => {
  beforeEach(() => mockDb._reset());

  it('stamps graph_name AND bundle_version; the filter re-stamps rows whose version lags', async () => {
    const querySpy = mockDb.query;
    querySpy.mockResolvedValueOnce({ all: async () => ['OKF_r1_v2'] });
    const n = await conceptMeta.stampRepoGraphName('r1', 'OKF_r1_v2', 2);
    expect(n).toBe(1);
    const aqlText = String(querySpy.mock.calls[0][0]);
    expect(aqlText).toContain('bundle_version: @bv');
    expect(aqlText).toContain('m.graph_name != @gn OR m.bundle_version != @bv');
    expect(querySpy.mock.calls[0][1]).toEqual({ rid: 'r1', gn: 'OKF_r1_v2', bv: 2 });
  });

  it('defaults the version bind to null when the caller omits it', async () => {
    const querySpy = mockDb.query;
    querySpy.mockResolvedValueOnce({ all: async () => [] });
    await conceptMeta.stampRepoGraphName('r1', 'OKF_r1_v1');
    expect(querySpy.mock.calls[0][1]).toEqual({ rid: 'r1', gn: 'OKF_r1_v1', bv: null });
  });

  it('returns 0 for falsy guards', async () => {
    expect(await conceptMeta.stampRepoGraphName('', 'OKF_r1_v1')).toBe(0);
    expect(await conceptMeta.stampRepoGraphName('r1', '')).toBe(0);
  });
});

// ── RE-INGEST FAILED CONCEPTS (David, 2026-10-14) ──
describe('concept-meta-service.requeueFailedForReingest', () => {
  beforeEach(() => mockDb._reset());

  it('requeues ONLY failed rows and zeroes the reaper stamp', async () => {
    const querySpy = mockDb.query;
    querySpy.mockResolvedValueOnce({ all: async () => [{ concept_id: 'c1' }, { concept_id: 'c2' }] });
    const res = await conceptMeta.requeueFailedForReingest('r1');
    expect(res.requeued).toBe(2);
    expect(res.conceptIds).toEqual(['c1', 'c2']);
    const aqlText = String(querySpy.mock.calls[0][0]);
    // FAILED ONLY — an indexed row must never churn.
    expect(aqlText).toContain("m.index_status == 'failed'");
    // The field requeueRepoForRedrain also clears, because the reaper would
    // otherwise kill the row again on its next hourly sweep.
    expect(aqlText).toContain('worker_claimed_at: null');
    expect(aqlText).toContain('ingest_attempts: 0');
    expect(aqlText).toContain('reindex_retry: 0');
    expect(aqlText).toContain('last_error: null');
    expect(aqlText).toContain('m.repo_id == @rid');
  });

  it('does NOT clear graph_name (blanking it lets dataprep resurrect a dropped graph)', async () => {
    mockDb.query.mockResolvedValueOnce({ all: async () => [{ concept_id: 'c1' }] });
    await conceptMeta.requeueFailedForReingest('r1');
    const aqlText = String(mockDb.query.mock.calls[0][0]);
    expect(aqlText).not.toContain('graph_name');
  });

  it('scopes to ONE concept when conceptId is given', async () => {
    mockDb.query.mockResolvedValueOnce({ all: async () => [{ concept_id: 'c9' }] });
    const res = await conceptMeta.requeueFailedForReingest('r1', { conceptId: 'c9' });
    expect(res.requeued).toBe(1);
    const aqlText = String(mockDb.query.mock.calls[0][0]);
    expect(aqlText).toContain('m.concept_id == @cid');
    expect(mockDb.query.mock.calls[0][1]).toEqual({ rid: 'r1', cid: 'c9' });
  });

  // FALSIFIER — and the half the first version of this suite MISSED.
  //
  // Asserting only the AQL string is not enough. ArangoDB rejects any bind
  // value the query does not reference, so a query that correctly omits
  // "@cid" still 500s if the code passes `cid: null` alongside it. That is
  // exactly what shipped: the string assertion passed, and the repo-wide call
  // failed live with "bind parameter 'cid' was not declared in the query".
  // Both halves of the call are now asserted.
  it('repo-wide call omits BOTH the concept filter AND the cid bind', async () => {
    mockDb.query.mockResolvedValueOnce({ all: async () => [] });
    await conceptMeta.requeueFailedForReingest('r1');
    const [aqlText, binds] = mockDb.query.mock.calls[0];
    expect(String(aqlText)).not.toContain('@cid');
    expect(String(aqlText)).not.toContain('concept_id ==');
    expect(Object.keys(binds)).toEqual(['rid']);
    expect(binds).not.toHaveProperty('cid');
  });

  // The inverse: every bind the query DOES reference must be supplied, or the
  // query fails the other way round ("no value passed for bind parameter").
  it('every @param in the query has a matching bind value', async () => {
    mockDb.query.mockResolvedValueOnce({ all: async () => [] });
    for (const opts of [{}, { conceptId: 'c7' }]) {
      mockDb.query.mockReset();
      mockDb.query.mockResolvedValueOnce({ all: async () => [] });
      await conceptMeta.requeueFailedForReingest('r1', opts);
      const [aqlText, binds] = mockDb.query.mock.calls[0];
      const referenced = [...String(aqlText).matchAll(/@([a-zA-Z_][a-zA-Z0-9_]*)/g)].map((m) => m[1]);
      expect(new Set(referenced).size).toBeGreaterThan(0);
      referenced.forEach((name) => expect(binds).toHaveProperty(name));
      // …and no bind is left dangling.
      Object.keys(binds).forEach((name) => expect(referenced).toContain(name));
    }
  });

  it('returns an empty result for a falsy repo without touching the db', async () => {
    mockDb._reset();
    const res = await conceptMeta.requeueFailedForReingest('');
    expect(res).toEqual({ requeued: 0, conceptIds: [] });
  });

  it('reports 0 when the cursor came back empty (nothing failed)', async () => {
    mockDb.query.mockResolvedValueOnce({ all: async () => [] });
    const res = await conceptMeta.requeueFailedForReingest('r1');
    expect(res.requeued).toBe(0);
  });
});

// ── THE CONCEPT-DOCUMENT CEILING — the publish gate's corpus read ──
describe("concept-meta-service.listOverCeiling (the publish gate's backstop)", () => {
  beforeEach(() => mockDb._reset());

  // The query's SHAPE is the contract, so it is asserted, not just the value.
  it('counts with COLLECT WITH COUNT, and reads the count as a SCALAR', async () => {
    // MEASURED against the live ArangoDB (the local build, 2026-11-06):
    //   FOR m IN okf_concepts_meta FILTER ... COLLECT WITH COUNT INTO n RETURN n
    // returns a single row whose VALUE is the count — 9520 on the corpus,
    // NOT the document {n: 9520}. `RETURN n` projects the collected VARIABLE,
    // so `rows[0]` is the number itself.
    mockDb.query.mockResolvedValueOnce({ all: async () => [3] });
    mockDb.query.mockResolvedValueOnce({
      all: async () => [
        { concept_id: 'c1', chars: 300000 },
        { concept_id: 'c2', chars: 260000 }
      ]
    });
    const res = await conceptMeta.listOverCeiling('r1', 250000, 10);
    expect(res.count).toBe(3);
    expect(res.offenders).toHaveLength(2);

    const [countAql, countBinds] = mockDb.query.mock.calls[0];
    const aql = String(countAql);
    expect(aql).toContain('m.repo_id == @rid');
    expect(aql).toContain('LENGTH(m.body) > @ceiling');
    // A row with no body has LENGTH(null), which compares as null rather
    // than as a number — the filter must exclude those explicitly.
    expect(aql).toContain('m.body != null');
    expect(aql).toContain('COLLECT WITH COUNT INTO n RETURN n');
    expect(countBinds).toEqual({ rid: 'r1', ceiling: 250000 });
  });

  // THE trap, pinned with the live measurement rather than an assumption.
  //
  // On an EMPTY corpus both AQL idioms return ONE row containing the scalar
  // 0 — measured live on the local build, both
  // `COLLECT WITH COUNT INTO n RETURN n` and
  // `COLLECT AGGREGATE n = LENGTH(m) RETURN n` answered `[0]`.
  //
  // So the count is 0, which is FALSY, and the gate passes. The failure mode
  // this guards against is a DOCUMENT-shaped row ({n: 0}), which is TRUTHY
  // and would refuse EVERY publish in EVERY deployment: the corpus has no
  // offenders, yet the gate would report one.
  it('an empty corpus yields the scalar 0 — falsy, so the gate PASSES', async () => {
    mockDb.query.mockResolvedValueOnce({ all: async () => [0] });
    const res = await conceptMeta.listOverCeiling('r1', 250000, 10);
    // The critical assertion: the NUMBER 0, not a truthy {n: 0}.
    expect(res.count).toBe(0);
    expect(res.count).toBeFalsy();
    expect(res.offenders).toEqual([]);
    // Only ONE query ran — the offender listing is skipped when the count is 0.
    expect(mockDb.query).toHaveBeenCalledTimes(1);
  });

  // The other shape the driver can hand back: no row at all. `rows[0] || 0`
  // must still read as 0 rather than as undefined.
  it('a cursor with NO rows reads as 0, not undefined', async () => {
    mockDb.query.mockResolvedValueOnce({ all: async () => [] });
    const res = await conceptMeta.listOverCeiling('r1', 250000, 10);
    expect(res.count).toBe(0);
    expect(res.offenders).toEqual([]);
  });

  it('names the offenders with their sizes, and honours the limit', async () => {
    mockDb.query.mockResolvedValueOnce({ all: async () => [42] });
    mockDb.query.mockResolvedValueOnce({ all: async () => [{ concept_id: 'c1', chars: 900000 }] });
    const res = await conceptMeta.listOverCeiling('r1', 250000, 5);
    expect(res.count).toBe(42);
    expect(res.offenders[0]).toEqual({ concept_id: 'c1', chars: 900000 });
    const [offenderAql, offenderBinds] = mockDb.query.mock.calls[1];
    expect(String(offenderAql)).toContain('LIMIT @limit');
    expect(offenderBinds).toEqual({ rid: 'r1', ceiling: 250000, limit: 5 });
  });

  it('a falsy repo or an unusable ceiling answers 0 without touching the db', async () => {
    for (const args of [
      ['', 250000],
      ['r1', 0],
      ['r1', -1],
      ['r1', NaN],
      [null, 250000]
    ]) {
      mockDb._reset();
      const res = await conceptMeta.listOverCeiling(...args);
      expect(res).toEqual({ count: 0, offenders: [] });
      expect(mockDb.query).not.toHaveBeenCalled();
    }
  });
});

// ── AUTHOR-GRAPH LINK DEDUPE (2026-09-08 crawl audit) ──
describe('dedupeLinksForStorage (2026-09-08 crawl audit)', () => {
  const { dedupeLinksForStorage } = require('../services/concept-meta-service');

  test('one entry per target; the labeled copy wins over the empty-label duplicate', () => {
    expect(
      dedupeLinksForStorage([
        { to_concept_id: 'x', label: 'Real label' },
        { to_concept_id: 'x', label: '' },
        { to_concept_id: 'y', label: '' }
      ])
    ).toEqual([
      { to_concept_id: 'x', label: 'Real label' },
      { to_concept_id: 'y', label: '' }
    ]);
  });

  test('keeps the FIRST copy when several carry labels', () => {
    expect(
      dedupeLinksForStorage([
        { to_concept_id: 'x', label: 'First' },
        { to_concept_id: 'x', label: 'Second' }
      ])
    ).toEqual([{ to_concept_id: 'x', label: 'First' }]);
  });

  test('drops entries without to_concept_id and tolerates non-array input', () => {
    expect(dedupeLinksForStorage([{ label: 'no target' }, null]).length).toBe(0);
    expect(dedupeLinksForStorage(undefined)).toEqual([]);
  });
});

// 2026-09-12 live 500 — listConceptsMeta chained .all() onto the PROMISE
// ("db.query(...).all is not a function"); every test mock at the time never
// executed this body, so 600+ green tests shipped it. These run the REAL
// function against the REAL arangojs v7 shape: db.query is ASYNC and resolves
// to a cursor — .all() must be called on the awaited cursor, never the promise.
describe('listConceptsMeta pagination (live-500 regression 2026-09-12)', () => {
  beforeEach(() => mockDb._reset());
  afterEach(() => {
    mockDb.query.mockImplementation(async () => ({ all: async () => [] }));
  });

  test('paginated branch awaits the cursor before .all() and returns {total, offset, limit, concepts}', async () => {
    const rows = [{ title: 'Alpha' }, { title: 'Beta' }];
    mockDb.query.mockImplementation(async (q, b) => {
      if (q.includes('COLLECT WITH COUNT')) return { all: async () => [rows.length] };
      expect(b).toEqual({ rid: 'r1', offset: 0, limit: 200 });
      return { all: async () => rows };
    });
    await expect(conceptMeta.listConceptsMeta('r1', { limit: '200', offset: '0' })).resolves.toEqual({
      total: 2,
      offset: 0,
      limit: 200,
      concepts: rows
    });
  });

  test('legacy branch (no limit/offset) awaits the cursor before .all() and returns the full array', async () => {
    const rows = [{ title: 'Alpha' }];
    mockDb.query.mockImplementation(async () => ({ all: async () => rows }));
    await expect(conceptMeta.listConceptsMeta('r1')).resolves.toEqual(rows);
  });
});

// ── Review fix #9 (#1020), widened to the canonical five-field reset
// (2026-11-14): a hash-changing edit must leave NOTHING of the old drain
// cycle — park, claim, spent attempts, retry counter, last error. The reaper
// keys on ingest_attempts >= 8, so a spent budget surviving a content change
// would dead-letter content that was never tried in its new form.
describe('patchConceptMeta — stale park cleared on content change', () => {
  it('a hash change resets to parsed AND clears the full claim set (DRAIN_CLAIM_RESET)', async () => {
    await mockDb.collection('okf_concepts_meta').save({
      _key: 'r1|concepts/parked',
      repo_id: 'r1',
      concept_id: 'concepts/parked',
      content_hash: 'oldhash',
      index_status: 'parsed',
      next_attempt_after: new Date(Date.now() + 3600000).toISOString(), // parked §5.5/§5.9
      worker_claimed_at: '2026-09-26T00:00:00.000Z',
      ingest_attempts: 7, // one away from the reaper cap (8)
      reindex_retry: 3,
      last_error: 'dataprep 500'
    });
    await conceptMeta.patchConceptMeta('r1', 'concepts/parked', {
      body: '# changed body',
      frontmatter: { title: 'Parked', type: 'service' }
    });
    const doc = await mockDb.collection('okf_concepts_meta').document('r1|concepts/parked');
    expect(doc.index_status).toBe('parsed'); // re-index path
    expect(doc.next_attempt_after).toBeNull(); // claimable NOW (was parked +1h)
    expect(doc.worker_claimed_at).toBeNull(); // no stale claim toward the reaper
    expect(doc.ingest_attempts).toBe(0); // a full budget for the NEW content
    expect(doc.reindex_retry).toBe(0);
    expect(doc.last_error).toBeNull();
  });

  it('an UNCHANGED body (frontmatter-only edit) leaves the park untouched', async () => {
    const parked = new Date(Date.now() + 3600000).toISOString();
    await mockDb.collection('okf_concepts_meta').save({
      _key: 'r1|concepts/untouched',
      repo_id: 'r1',
      concept_id: 'concepts/untouched',
      content_hash: conceptMeta.contentHash('# unchanged'),
      index_status: 'parsed',
      next_attempt_after: parked
    });
    await conceptMeta.patchConceptMeta('r1', 'concepts/untouched', {
      body: '# unchanged',
      frontmatter: { title: 'Unchanged', type: 'service' }
    });
    const doc = await mockDb.collection('okf_concepts_meta').document('r1|concepts/untouched');
    expect(doc.next_attempt_after).toBe(parked); // park still governs
  });
});

// The claim-stamp reset lives in the ONE update path that computes
// contentChanged (applyUpdate) — every hash-changing FULL upsert (re-import,
// split, any future write path) inherits the #1020 contract; before
// 2026-11-14 the import path reset NOTHING on a re-imported modified concept.
describe('upsertConceptMeta — the claim reset on ANY hash-changing update', () => {
  it('a full upsert of MODIFIED content resets the full claim set on the updated row', async () => {
    await mockDb.collection('okf_concepts_meta').save({
      _key: 'r1|concepts/reimported',
      repo_id: 'r1',
      concept_id: 'concepts/reimported',
      content_hash: 'oldhash',
      index_status: 'failed',
      next_attempt_after: new Date(Date.now() + 21600000).toISOString(), // §5.9 defer up to 6 h
      worker_claimed_at: '2026-11-14T00:00:00.000Z',
      ingest_attempts: 8, // AT the reaper cap
      reindex_retry: 2,
      last_error: 'embed timeout'
    });
    await conceptMeta.upsertConceptMeta('r1', {
      concept_id: 'concepts/reimported',
      path: 'concepts/reimported.md',
      frontmatter: { type: 'topic', title: 'Reimported', sources: [] },
      body: '# changed content\n\nA different body than the parked row held.'
    });
    const doc = await mockDb.collection('okf_concepts_meta').document('r1|concepts/reimported');
    expect(doc.index_status).toBe('parsed'); // contentChanged → re-index path
    expect(doc.next_attempt_after).toBeNull();
    expect(doc.worker_claimed_at).toBeNull();
    expect(doc.ingest_attempts).toBe(0);
    expect(doc.reindex_retry).toBe(0);
    expect(doc.last_error).toBeNull();
  });

  it('an upsert of IDENTICAL content (dedup case) does NOT touch the claim stamps', async () => {
    const body = '# same content';
    const fm = { type: 'topic', title: 'Samey' }; // same conformance frontmatter too
    const hash = conceptMeta.contentHash(body);
    await mockDb.collection('okf_concepts_meta').save({
      _key: 'r1|concepts/samey',
      repo_id: 'r1',
      concept_id: 'concepts/samey',
      content_hash: hash,
      frontmatter: fm,
      index_status: 'indexed',
      next_attempt_after: 'unchanged-park',
      ingest_attempts: 5
    });
    await conceptMeta.upsertConceptMeta('r1', {
      concept_id: 'concepts/samey',
      path: 'concepts/samey.md',
      frontmatter: { ...fm, sources: [] },
      body
    });
    const doc = await mockDb.collection('okf_concepts_meta').document('r1|concepts/samey');
    expect(doc.index_status).toBe('indexed'); // unchanged content keeps its state
    expect(doc.next_attempt_after).toBe('unchanged-park');
    expect(doc.ingest_attempts).toBe(5);
  });
});

// The split's collision pre-check: ONE batched existence query instead of
// one FULL-document fetch per part id (the W9 batched-join precedent).
// Pinned AQL-shape style (the requeue tests' pattern): capture the query
// text + binds, assert the single roundtrip and the bound filter.
describe('conceptIdsExist — batched existence', () => {
  it('queries repo+ids existence in ONE roundtrip and returns the surviving ids', async () => {
    const calls = [];
    mockDb.query.mockImplementation(async (q, b) => {
      calls.push({ q: String(q), b });
      return { all: async () => (b.ids || []).filter((id) => id === 'a') };
    });
    await expect(conceptMeta.conceptIdsExist('r1', ['a', 'b', 'c'])).resolves.toEqual(['a']);
    expect(calls.length).toBe(1); // ONE roundtrip, not one per id
    expect(calls[0].q).toContain('okf_concepts_meta');
    expect(calls[0].q).toContain('m.repo_id == @rid');
    expect(calls[0].q).toContain('m.concept_id IN @ids');
    expect(calls[0].b).toEqual({ rid: 'r1', ids: ['a', 'b', 'c'] });
  });

  it('answers [] for an empty/absent id list or repo without querying', async () => {
    mockDb.query.mockImplementation(async () => {
      throw new Error('must not query');
    });
    await expect(conceptMeta.conceptIdsExist('r1', [])).resolves.toEqual([]);
    await expect(conceptMeta.conceptIdsExist(null, ['a'])).resolves.toEqual([]);
  });
});

// #1181 — the lazy summary's model-id policy (!631): the pin wins, else
// the model is discovered from the endpoint, and the probe shares the
// best-effort budget with the chat call. Best-effort semantics are
// preserved — a resolution failure returns the manifest, summary null.
describe('ensureSummary — model-id resolution (!631 policy)', () => {
  const cache = require('../services/vllm-model-cache');
  const axios = require('axios');
  const { isolateVllmEnv } = require('./vllm-env-helper');
  const ENV_KEYS = ['VLLM_MODEL_ID', 'VLLM_LLM_MODEL_ID', 'VLLM_ENDPOINT'];

  isolateVllmEnv(ENV_KEYS);

  beforeEach(() => {
    cache.clearModelCache();
    mockDb._reset();
    axios.get.mockReset();
    axios.post.mockReset();
    // The deployment endpoint (the summary resolves against it).
    process.env.VLLM_ENDPOINT = 'http://vllm:8000';
  });

  afterEach(() => {
    cache.clearModelCache();
  });

  it('no pin: the summary call names the model discovered from the endpoint', async () => {
    // Seed the store so the summary WRITE (collection update) lands.
    await mockDb.collection('okf_bundle_manifest').save(manifestFixture());
    mockDb.query.mockResolvedValueOnce({ all: async () => [manifestFixture()] });
    axios.get.mockResolvedValue({ data: { data: [{ id: 'served/summarizer-8b' }] } });
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: 'A demo bundle about demos.' } }] } });
    await conceptMeta.ensureSummary('r1');
    expect(axios.get).toHaveBeenCalledWith('http://vllm:8000/v1/models', expect.anything());
    expect(axios.post).toHaveBeenCalledWith(
      'http://vllm:8000/v1/chat/completions',
      expect.objectContaining({ model: 'served/summarizer-8b' }),
      expect.anything()
    );
  });

  it('nothing discoverable: the manifest comes back summary-less, no call sent', async () => {
    const m = manifestFixture();
    mockDb.query.mockResolvedValueOnce({ all: async () => [m] });
    axios.get.mockRejectedValue(new Error('ECONNREFUSED'));
    const out = await conceptMeta.ensureSummary('r1');
    expect(out.summary_text).toBeNull();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('a VLLM_MODEL_ID pin skips the probe and names the pinned model', async () => {
    process.env.VLLM_MODEL_ID = 'pinned/summarizer';
    await mockDb.collection('okf_bundle_manifest').save(manifestFixture());
    mockDb.query.mockResolvedValueOnce({ all: async () => [manifestFixture()] });
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: 'Sum.' } }] } });
    await conceptMeta.ensureSummary('r1');
    expect(axios.get).not.toHaveBeenCalled();
    expect(axios.post.mock.calls[0][1].model).toBe('pinned/summarizer');
  });

  it('r4: the chat call gets the budget left after the discovery probe', async () => {
    await mockDb.collection('okf_bundle_manifest').save(manifestFixture());
    mockDb.query.mockResolvedValueOnce({ all: async () => [manifestFixture()] });
    // The probe burns part of the 5 s budget; the chat call must not be
    // granted a fresh one (the caller's contract is one budget).
    const axios = require('axios');
    axios.get.mockImplementation(
      () =>
        new Promise((resolve) => setTimeout(() => resolve({ data: { data: [{ id: 'served/summarizer-8b' }] } }), 60))
    );
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: 'Sum.' } }] } });
    await conceptMeta.ensureSummary('r1');
    // The LAST call — mock.calls accumulates across this file's tests.
    const postTimeout = axios.post.mock.calls[axios.post.mock.calls.length - 1][2].timeout;
    // The chat call stays inside the 5 s budget and never below the usable
    // floor (a 1 ms timeout would fail non-retriably on a healthy endpoint).
    expect(postTimeout).toBeLessThanOrEqual(5000);
    expect(postTimeout).toBeGreaterThanOrEqual(1000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Live-caught on the Quran Core import (2026-11-02): the apply loop silently
// skipped 785 consecutive concepts when the row lookup answered not-found
// mid-run (the very next request applied 784 of the same rows — zero code
// change between), and rule 4 proposed fm.status='draft' for 6,350 concepts
// whose lifecycle_status is 'stable' (the import model never writes the
// legacy top-level status). The plan mirrors the lifecycle; the run retries
// a transient miss once and REPORTS what still failed.
// ─────────────────────────────────────────────────────────────────────────────
describe('autocorrectRepo — rule 4 mirrors the lifecycle, failures are reported (Quran 2026-11-02)', () => {
  const { planAutocorrectForConcept } = conceptMeta;
  beforeEach(() => mockDb._reset());

  // The mock's col.save auto-keys by doc._key || repo_id — three concepts
  // seeded through the service would all land under one 'r1' key and
  // overwrite each other (the planner then plans nothing). Seed raw rows with
  // distinct keys and hand the planner its snapshot via the query mock.
  function seedRows() {
    mockDb._stores.okf_concepts_meta = {};
    const mk = (cid) => {
      const doc = {
        _key: 'k-' + cid,
        repo_id: 'r1',
        concept_id: cid,
        path: cid + '.md',
        frontmatter: { title: cid.toUpperCase() },
        body: '# ' + cid,
        lifecycle_status: 'draft',
        content_hash: 'h-' + cid,
        index_status: 'parsed',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z'
      };
      mockDb._stores.okf_concepts_meta[doc._key] = doc;
      return doc;
    };
    const docs = [mk('a'), mk('b'), mk('c')];
    mockDb.query.mockResolvedValueOnce({ all: async () => docs.map((d) => ({ ...d })) });
    return docs;
  }

  it('a row whose state is already recorded (lifecycle) gets NO status proposal', () => {
    // buildMetaDoc writes lifecycle_status and never top-level status; the
    // drain wipes fm.status on every re-upsert. Proposing fm.status whenever
    // it is absent re-listed the whole corpus (Quran: 6,351 rows) forever —
    // a row with a lifecycle has its state recorded; leave it alone.
    const plan = planAutocorrectForConcept({ frontmatter: { title: 'T', type: 'topic' }, lifecycle_status: 'stable' });
    expect(plan.changes.find((c) => c.field === 'status')).toBeUndefined();
    expect(plan.warnings.find((w) => w.rule === 'INVALID_STATUS')).toBeUndefined();
  });

  it('proposes draft only when the row has NO status anywhere', () => {
    const plan = planAutocorrectForConcept({ frontmatter: { title: 'T', type: 'topic' } });
    const status = plan.changes.find((c) => c.field === 'status');
    expect(status).toBeDefined();
    expect(status.after).toBe('draft');
  });

  it('a legacy top-level status also satisfies the rule (no proposal)', () => {
    const plan = planAutocorrectForConcept({ frontmatter: { title: 'T', type: 'topic' }, status: 'draft' });
    expect(plan.changes.find((c) => c.field === 'status')).toBeUndefined();
    expect(plan.warnings.find((w) => w.rule === 'INVALID_STATUS')).toBeUndefined();
  });

  it('never clobbers a frontmatter status that is already present', () => {
    const plan = planAutocorrectForConcept({
      frontmatter: { title: 'T', type: 'topic', status: 'stable' },
      lifecycle_status: 'draft'
    });
    expect(plan.changes.find((c) => c.field === 'status')).toBeUndefined();
    expect(plan.warnings.find((w) => w.rule === 'INVALID_STATUS')).toBeUndefined();
  });

  it('an invalid lifecycle mirror is a WARNING, not a proposal (retired stays retired)', () => {
    const plan = planAutocorrectForConcept({
      frontmatter: { title: 'T', type: 'topic' },
      lifecycle_status: 'retired'
    });
    expect(plan.changes.find((c) => c.field === 'status')).toBeUndefined();
    expect(plan.warnings.find((w) => w.rule === 'INVALID_STATUS')).toBeDefined();
  });

  it('one concept failing does NOT abort the apply — it is counted and named', async () => {
    const docs = seedRows();
    const col = mockDb.collection('okf_concepts_meta');
    // Capture the IMPLEMENTATION, not the jest.fn: calling the captured fn
    // object from inside a new mockImplementation recurses into itself
    // (Maximum call stack size exceeded on every concept).
    const origImpl = col.update.getMockImplementation();
    const bKey = docs.find((d) => d.concept_id === 'b')._key;
    try {
      col.update.mockImplementation(async (key, patch) => {
        if (key === bKey) throw new Error('write storm: transient fault');
        return origImpl(key, patch);
      });
      const result = await conceptMeta.autocorrectRepo('r1', false);
      expect(result.applied).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.failures).toEqual([{ concept_id: 'b', error: expect.stringContaining('transient fault') }]);
      // The survivors really landed:
      const store = mockDb._stores.okf_concepts_meta;
      expect(store['k-a'].frontmatter.type).toBe('topic');
      expect(store['k-c'].frontmatter.type).toBe('topic');
    } finally {
      col.update.mockImplementation(origImpl);
    }
  });

  it('a transient lookup miss retries once and lands (the 785-skip class)', async () => {
    seedRows();
    const col = mockDb.collection('okf_concepts_meta');
    const realFirstExample = col.firstExample;
    try {
      // First attempt: the exact 3.12 shape a simple-query miss answers —
      // classified expected-absence, patchConceptFields returns null, and the
      // OLD code recorded nothing. The retry must recover it.
      col.firstExample.mockImplementationOnce(async () => {
        const e = new Error('no match');
        e.errorNum = 404;
        e.code = 404;
        throw e;
      });
      const result = await conceptMeta.autocorrectRepo('r1', false);
      expect(result.failed).toBe(0);
      expect(result.applied).toBe(3);
      expect(result.failures).toEqual([]);
    } finally {
      col.firstExample = realFirstExample;
    }
  });

  it('an absent row is reported, not silently skipped', async () => {
    const docs = seedRows();
    // Remove one row so its patch lookup genuinely misses twice.
    delete mockDb._stores.okf_concepts_meta[docs.find((d) => d.concept_id === 'b')._key];
    const result = await conceptMeta.autocorrectRepo('r1', false);
    expect(result.failed).toBe(1);
    expect(result.failures[0].concept_id).toBe('b');
    expect(result.failures[0].error).toMatch(/not found/);
  });
});

// ── #1647 metrics ride-along: the repo_id read is index-served ──
// countByIndexStatus backs the wizard/dashboard metrics read, which measured
// 0.43-4.3 s on a 1112-concept repo without the persistent index.
//
// The ensure cache (treeIndexReady) is PER PROCESS and this file WARMS it —
// the embedded getRepoMetrics test above now routes through
// conformance-service, whose metrics read performs the same ensure. So the
// cold-cache path is observed on a FRESH MODULE REGISTRY: jest.resetModules()
// re-instantiates concept-meta-service (fresh Set) and re-runs the
// db-connection-service mock factory (fresh mockDb). This describe is the
// LAST in the file, so no other test observes the reset.
describe('#1647: countByIndexStatus ensures the repo_id read index', () => {
  let coldDb;
  let coldMeta;

  beforeEach(() => {
    jest.resetModules();
    coldDb = require('../shared-lib/db-connection-service').__mockDb;
    coldMeta = require('../services/concept-meta-service');
    coldDb._reset();
  });

  test('the count read ensures the persistent index once, then the cache holds', async () => {
    const col = coldDb.collection('okf_concepts_meta');
    const n = await coldMeta.countByIndexStatus('r-1647', 'parsed');
    expect(n).toBe(0); // empty store → count 0, no crash
    expect(col.ensureIndex).toHaveBeenCalledWith({ type: 'persistent', fields: ['repo_id'] });
    // A second count is a cache hit — the ensure verdict is per process.
    await coldMeta.countByIndexStatus('r-1647', 'published');
    expect(col.ensureIndex).toHaveBeenCalledTimes(1);
  });
});
