// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 2.9.2 — okf_concepts_meta UPSERT writer (G9). Red-green: these tests
// FAIL against the current code (no writer exists; persistConformanceIssues is
// a filter-and-UPDATE silent no-op) and PASS after T1+T2.

jest.mock('../shared-lib/db-connection-service', () => {
  jest.mock('axios');
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

// ── Review fix #9 (#1020): a content change must be claimable NOW ──
describe('patchConceptMeta — stale park cleared on content change', () => {
  it('a hash change resets to parsed AND clears next_attempt_after + the claim', async () => {
    await mockDb.collection('okf_concepts_meta').save({
      _key: 'r1|concepts/parked',
      repo_id: 'r1',
      concept_id: 'concepts/parked',
      content_hash: 'oldhash',
      index_status: 'parsed',
      next_attempt_after: new Date(Date.now() + 3600000).toISOString(), // parked §5.5/§5.9
      worker_claimed_at: '2026-09-26T00:00:00.000Z'
    });
    await conceptMeta.patchConceptMeta('r1', 'concepts/parked', {
      body: '# changed body',
      frontmatter: { title: 'Parked', type: 'service' }
    });
    const doc = await mockDb.collection('okf_concepts_meta').document('r1|concepts/parked');
    expect(doc.index_status).toBe('parsed'); // re-index path
    expect(doc.next_attempt_after).toBeNull(); // claimable NOW (was parked +1h)
    expect(doc.worker_claimed_at).toBeNull(); // no stale claim toward the reaper
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

// #1181 — runLlmSummary model-id resolution follows the !631 discovery
// policy: pin > /v1/models discovery; never a silent undefined (the dead
// `config?.llm` reads are gone). Best-effort semantics are preserved — a
// resolution failure returns the manifest with summary_text null.
// The model-id policy of the lazy summary (!631, #1181): the pin wins, else
// the model is discovered from the endpoint, and the probe shares the
// best-effort budget with the chat call.
describe('ensureSummary — model-id resolution (!631 policy)', () => {
  const cache = require('../services/vllm-model-cache');
  const axios = require('axios');
  const ENV_KEYS = ['VLLM_MODEL_ID', 'VLLM_LLM_MODEL_ID', 'VLLM_ENDPOINT'];
  let saved = {};

  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    cache.clearModelCache();
    mockDb._reset();
    axios.get.mockReset();
    axios.post.mockReset();
    // The deployment endpoint (the summary resolves against it).
    process.env.VLLM_ENDPOINT = 'http://vllm:8000';
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
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
    delete process.env.VLLM_MODEL_ID;
    delete process.env.VLLM_LLM_MODEL_ID;
    process.env.VLLM_ENDPOINT = 'http://vllm:8000';
    require('../services/vllm-model-cache').clearModelCache();
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
