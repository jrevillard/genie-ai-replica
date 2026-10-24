// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// AUTOCORRECT for conformance findings (David, 2026-09-12): a sources[] entry
// with an empty "resource" is filled determinately (concept provenance first,
// sibling resource second), and the APPLY path re-parses the concept so
// conformance_issues are recomputed — the finding actually clears.

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

const ISSUE = {
  code: 'SOURCE_MISSING_RESOURCE',
  severity: 'warning',
  message: 'Source entry 0 is missing a non-empty "resource" field',
  field_path: 'frontmatter.sources[0].resource'
};

async function seedIndexConcept() {
  await mockDb.collection('okf_concepts_meta').save({
    _key: 'index',
    repo_id: 'repoA',
    concept_id: 'index',
    path: 'index.md',
    title: 'Index',
    frontmatter: { title: 'Index', type: 'index', sources: [{ author: 'govuk-crawler' }] },
    body: '# Index\n\nContents list.',
    sources: [{ resource: 'https://www.gov.uk', author: 'govuk-crawler' }], // provenance
    conformance_issues: [ISSUE],
    index_status: 'parsed',
    pii_state: 'clean'
  });
}

beforeEach(() => {
  mockDb._reset();
  jest.clearAllMocks();
});

describe('autocorrect SOURCE_MISSING_RESOURCE', () => {
  // autocorrectRepo reads via db.query — program the mock cursor with the
  // seeded docs (the store objects themselves).
  function programQuery() {
    mockDb.query.mockResolvedValueOnce({
      all: async () => Object.values(mockDb._stores.okf_concepts_meta || {})
    });
  }

  test('plan: fills the empty resource from the concept provenance', async () => {
    await seedIndexConcept();
    programQuery();
    const out = await conceptMeta.autocorrectRepo('repoA', true);
    const entry = out.changes.find((c) => c.concept_id === 'index');
    expect(entry).toBeDefined();
    const change = entry.changes.find((c) => c.reason === 'SOURCE_MISSING_RESOURCE');
    expect(change).toBeDefined();
    expect(change.after[0].resource).toBe('https://www.gov.uk');
    expect(change.after[0].author).toBe('govuk-crawler'); // the rest of the entry survives
  });

  test('plan: falls back to a sibling resource entry when no provenance exists', async () => {
    await mockDb.collection('okf_concepts_meta').save({
      _key: 'index',
      repo_id: 'repoA',
      concept_id: 'index',
      frontmatter: {
        title: 'Index',
        type: 'index',
        sources: [{ author: 'x' }, { resource: 'https://sibling.example' }]
      },
      body: '# Index\n',
      conformance_issues: [ISSUE]
    });
    programQuery();
    const out = await conceptMeta.autocorrectRepo('repoA', true);
    const change = out.changes[0].changes.find((c) => c.reason === 'SOURCE_MISSING_RESOURCE');
    expect(change.after[0].resource).toBe('https://sibling.example');
    expect(change.after[1].resource).toBe('https://sibling.example'); // untouched
  });

  test('apply: the fix lands AND the conformance issue is recomputed away', async () => {
    await seedIndexConcept();
    programQuery();
    const out = await conceptMeta.autocorrectRepo('repoA', false);
    expect(out.applied).toBe(1);
    const doc = mockDb._stores.okf_concepts_meta.index;
    expect(doc.frontmatter.sources[0].resource).toBe('https://www.gov.uk');
    // THE ACTUAL POINT: the stale SOURCE_MISSING_RESOURCE must be gone from
    // the meta row (the old raw-update path left it sitting there, so the
    // publish gate kept blocking on a fixed problem).
    const codes = (doc.conformance_issues || []).map((i) => i.code);
    expect(codes).not.toContain('SOURCE_MISSING_RESOURCE');
  });

  test('apply: nothing to fix → applied 0', async () => {
    await mockDb.collection('okf_concepts_meta').save({
      _key: 'clean',
      repo_id: 'repoA',
      concept_id: 'clean',
      frontmatter: { title: 'C', type: 'topic', sources: [{ resource: 'https://ok.example', author: 'a' }] },
      body: '# C\n',
      conformance_issues: []
    });
    const out = await conceptMeta.autocorrectRepo('repoA', false);
    expect(out.applied).toBe(0);
    expect(out.changes).toHaveLength(0);
  });
});

// #1037: stale_after normalization. Import-time parsing tolerates Date
// objects / full ISO timestamps (toDateOnly normalizes at parse), but
// patch-time conformance re-validates the RAW frontmatter string and flags
// UNPARSEABLE_STALE_AFTER — the one finding autocorrect could not plan a fix
// for. FORMAT-level rule: parseable → YYYY-MM-DD, unparseable → cleared.
describe('autocorrect stale_after (#1037)', () => {
  function programQuery() {
    mockDb.query.mockResolvedValueOnce({
      all: async () => Object.values(mockDb._stores.okf_concepts_meta || {})
    });
  }

  async function seed(fm) {
    await mockDb.collection('okf_concepts_meta').save({
      _key: 'p1',
      repo_id: 'repoA',
      concept_id: 'p1',
      frontmatter: { title: 'P1', type: 'topic', ...fm },
      body: '# P1\n',
      conformance_issues: []
    });
  }

  test('plan: full ISO timestamp normalizes to the YYYY-MM-DD spec form', async () => {
    await seed({ stale_after: '2026-09-30T10:00:00.000Z' });
    programQuery();
    const out = await conceptMeta.autocorrectRepo('repoA', true);
    const change = out.changes[0].changes.find((c) => c.reason === 'STALE_AFTER_FORMAT');
    expect(change).toBeDefined();
    expect(change.after).toBe('2026-09-30');
  });

  test('plan: a non-date string is cleared with a visible warning', async () => {
    await seed({ stale_after: 'September 2026' });
    programQuery();
    const out = await conceptMeta.autocorrectRepo('repoA', true);
    const change = out.changes[0].changes.find((c) => c.reason === 'STALE_AFTER_UNPARSEABLE');
    expect(change).toBeDefined();
    expect(change.after).toBeNull();
    const warning = (out.warnings || []).find((w) => (w.warnings || []).some((x) => x.rule === 'STALE_AFTER_CLEARED'));
    expect(warning).toBeDefined();
  });

  test('plan: already spec-form → no stale_after change planned', async () => {
    await seed({ stale_after: '2026-09-30' });
    programQuery();
    const out = await conceptMeta.autocorrectRepo('repoA', true);
    const change = (out.changes[0] && out.changes[0].changes.find((c) => c.field === 'stale_after')) || null;
    expect(change).toBeNull();
  });

  test('plan: missing stale_after → no stale_after change planned', async () => {
    await mockDb.collection('okf_concepts_meta').save({
      _key: 'p1',
      repo_id: 'repoA',
      concept_id: 'p1',
      status: 'draft', // top-level row field — planAutocorrectForConcept reads meta.status
      frontmatter: { title: 'P1', type: 'topic', sources: [{ resource: 'https://ok.example', author: 'a' }] },
      body: '# P1\n',
      conformance_issues: []
    });
    programQuery();
    const out = await conceptMeta.autocorrectRepo('repoA', true);
    expect(out.changes).toHaveLength(0);
  });

  test('apply: the normalized value lands on the frontmatter', async () => {
    await seed({ stale_after: '2026-09-30T10:00:00.000Z' });
    programQuery();
    const out = await conceptMeta.autocorrectRepo('repoA', false);
    expect(out.applied).toBe(1);
    expect(mockDb._stores.okf_concepts_meta.p1.frontmatter.stale_after).toBe('2026-09-30');
  });
});
