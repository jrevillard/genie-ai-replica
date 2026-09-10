// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// PII REMEDIATION (David, 2026-09-09): process each flagged issue in place —
// Redact / Replace / Remove per occurrence, Accept per occurrence, and the
// whole-file redaction for PII-dominated documents. Every action is applied
// server-side against the scanner's own offsets, persists a before/after
// resolution (the green processed list + the per-version modification
// ledger), and re-scans via Presidio (feedback loop).

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

const mockSidecarPost = jest.fn();
jest.mock('axios', () => ({
  default: { get: jest.fn() },
  get: jest.fn(),
  post: jest.fn(),
  create: jest.fn(() => ({ post: mockSidecarPost }))
}));

const mockDb = require('../shared-lib/db-connection-service').__mockDb;
const piiService = require('../services/pii-service');
const ACTOR = { sub: 'steward-1', name: 'Steward One' };

// Two-region sidecar response (frontmatter + body). `text` fields make the
// server-computed excerpts exact, like the real sidecar flow.
function regions(fmText, fmHits, bodyText, bodyHits) {
  return {
    data: {
      results: [
        { id: 'frontmatter', text: fmText, hits: fmHits, counts_by_type: {} },
        { id: 'body', text: bodyText, hits: bodyHits, counts_by_type: {} }
      ]
    }
  };
}

async function seedConcept(fm, body, extra = {}) {
  await mockDb.collection('okf_concepts_meta').save({
    repo_id: 'repoA',
    concept_id: 'c1',
    frontmatter: fm,
    body,
    ...extra
  });
}

beforeEach(() => {
  mockDb._reset();
  jest.clearAllMocks();
});

describe('pii remediation', () => {
  test('redact replaces the exact span in the body and records the resolution', async () => {
    await seedConcept({ title: 'T' }, 'Contact John Smith now');
    // REDACT IS SCAN-FREE (David): the span is validated against the stored
    // content and the state derives arithmetically — no sidecar call.
    const out = await piiService.remediatePii(
      'repoA',
      'c1',
      { action: 'redact', where: 'body', start: 8, end: 18, type: 'PERSON', hit: 'John Smith' },
      ACTOR
    );
    expect(out.ok).toBe(true);
    expect(out.pii_state).toBe('clean');
    expect(out.body.trim()).toBe('Contact REDACTED now');
    expect(out.resolutions).toHaveLength(1);
    expect(out.resolutions[0]).toMatchObject({
      action: 'redact',
      type: 'PERSON',
      before: 'John Smith',
      after: 'REDACTED'
    });
    const doc = Object.values(mockDb._stores.okf_concepts_meta)[0];
    expect(doc.body.trim()).toBe('Contact REDACTED now');
    expect(doc.pii_resolutions).toHaveLength(1);
    expect(mockSidecarPost).not.toHaveBeenCalled(); // redact is scan-free
  });

  test('replace writes the user text; remove deletes the span', async () => {
    await seedConcept({ title: 'T' }, 'Email ada@lovelace.io now');
    mockSidecarPost.mockResolvedValueOnce(regions('', [], 'Email Jane now', [])); // replace: 1 verify scan
    await expect(mockSidecarPost).toBeDefined();
    const out = await piiService.remediatePii(
      'repoA',
      'c1',
      {
        action: 'replace',
        where: 'body',
        start: 6,
        end: 21,
        type: 'EMAIL_ADDRESS',
        hit: 'ada@lovelace.io',
        replacement: 'Jane'
      },
      ACTOR
    );
    expect(out.body.trim()).toBe('Email Jane now');
    expect(out.resolutions[0]).toMatchObject({ action: 'replace', before: 'ada@lovelace.io', after: 'Jane' });
  });

  test('remove deletes the span', async () => {
    await seedConcept({ title: 'T' }, 'Call 555-0100 today');
    mockSidecarPost.mockClear();
    const out = await piiService.remediatePii(
      'repoA',
      'c1',
      { action: 'remove', where: 'body', start: 5, end: 13, type: 'PHONE_NUMBER', hit: '555-0100' },
      ACTOR
    );
    expect(out.body.trim()).toBe('Call  today');
    expect(out.resolutions[0]).toMatchObject({ action: 'remove', before: '555-0100', after: '' });
    expect(mockSidecarPost).not.toHaveBeenCalled(); // remove is scan-free
  });

  test('accept keeps the text, suppresses the flag — ZERO scanner calls', async () => {
    await seedConcept({ title: 'T' }, 'Visit Jakarta with Guide', {
      pii_state: 'hit',
      pii_hits_summary: { LOCATION: 1 }
    });
    const out = await piiService.acceptPii(
      'repoA',
      'c1',
      { where: 'body', start: 6, end: 13, type: 'LOCATION', hit: 'Jakarta' },
      ACTOR
    );
    expect(out.ok).toBe(true);
    expect(out.pii_state).toBe('clean'); // derived arithmetically, not scanned
    expect(out.counts_by_type).toEqual({});
    expect(out.body).toBe('Visit Jakarta with Guide'); // text unchanged
    expect(out.resolutions[0]).toMatchObject({ action: 'accept', before: 'Jakarta', after: null });
    expect(mockSidecarPost).not.toHaveBeenCalled();
  });

  test('stale offsets → 409 PII_OCCURRENCE_STALE, nothing modified, NO scan', async () => {
    await seedConcept({ title: 'T' }, 'unchanged body');
    await expect(
      piiService.remediatePii('repoA', 'c1', { action: 'redact', where: 'body', start: 0, end: 4 }, ACTOR)
    ).rejects.toMatchObject({ code: 'PII_OCCURRENCE_STALE', status: 409 });
    const doc = Object.values(mockDb._stores.okf_concepts_meta)[0];
    expect(doc.body.trim()).toBe('unchanged body'); // untouched
    expect(doc.pii_resolutions).toBeUndefined();
    expect(mockSidecarPost).not.toHaveBeenCalled(); // single-scan path: no wasted scan
  });

  test('stale hit TEXT falls back to a text match in the same region', async () => {
    await seedConcept({ title: 'T' }, 'prefix shifted. Contact John Smith now');
    // The panel's offsets (8..18) are stale — the identical span text matches.
    const out = await piiService.remediatePii(
      'repoA',
      'c1',
      { action: 'redact', where: 'body', start: 8, end: 18, type: 'PERSON', hit: 'John Smith' },
      ACTOR
    );
    expect(out.body.trim()).toBe('prefix shifted. Contact REDACTED now');
    expect(mockSidecarPost).not.toHaveBeenCalled(); // redact is scan-free
  });

  test('frontmatter occurrence splices the owning value, preserving structure', async () => {
    await seedConcept({ title: 'Ms Ada Lovelace', parent: 'Byron' }, 'body stays');
    const out = await piiService.remediatePii(
      'repoA',
      'c1',
      { action: 'redact', where: 'frontmatter', start: 3, end: 15, type: 'PERSON', hit: 'Ada Lovelace' },
      ACTOR
    );
    expect(out.frontmatter.title).toBe('Ms REDACTED');
    expect(out.frontmatter.parent).toBe('Byron'); // siblings intact
    expect(out.body.trim()).toBe('body stays');
    expect(out.resolutions[0]).toMatchObject({ where: 'frontmatter', before: 'Ada Lovelace' });
  });

  test('redact whole file replaces the body and records the summary', async () => {
    await seedConcept({ title: 'Waymo Profile' }, 'Full of PII: John, Jane, 555-0100');
    mockSidecarPost
      .mockResolvedValueOnce(
        regions('', [], 'Full of PII: John, Jane, 555-0100', [
          { type: 'PERSON', start: 13, end: 17, score: 0.9 },
          { type: 'PHONE_NUMBER', start: 26, end: 34, score: 0.9 }
        ])
      )
      .mockResolvedValueOnce(regions('', [], expect.any(String), []));
    const out = await piiService.redactWholeFile('repoA', 'c1', ACTOR);
    expect(out.ok).toBe(true);
    expect(out.pii_state).toBe('clean');
    expect(out.body).toContain('# REDACTED');
    expect(out.body).not.toContain('555-0100');
    expect(out.resolutions[0]).toMatchObject({ action: 'redact_file' });
    expect(out.resolutions[0].hits_summary).toEqual({ PERSON: 1, PHONE_NUMBER: 1 });
  });

  test('whole-file redact is scan-free; surviving frontmatter hits keep it flagged', async () => {
    await seedConcept({ title: 'T', ceo: 'Arthur D. Levinson' }, 'Full of PII: John, 555-0100');
    const out = await piiService.fileActionPii(
      'repoA',
      'c1',
      {
        action: 'redact',
        occurrences: [
          { where: 'body', type: 'PERSON', hit: 'John' },
          { where: 'body', type: 'PHONE_NUMBER', hit: '555-0100' },
          { where: 'frontmatter', type: 'PERSON', hit: 'Arthur D. Levinson' }
        ]
      },
      ACTOR
    );
    expect(out.ok).toBe(true);
    expect(out.body).toContain('# REDACTED');
    expect(out.pii_state).toBe('hit'); // frontmatter hit survives
    expect(out.counts_by_type).toEqual({ PERSON: 1 });
    expect(out.resolutions[0]).toMatchObject({ action: 'redact_file' });
    expect(mockSidecarPost).not.toHaveBeenCalled();
  });

  test('whole-file remove empties the body, scan-free', async () => {
    await seedConcept({ title: 'T' }, 'All PII: John, Jane');
    const out = await piiService.fileActionPii(
      'repoA',
      'c1',
      {
        action: 'remove',
        occurrences: [
          { where: 'body', type: 'PERSON', hit: 'John' },
          { where: 'body', type: 'PERSON', hit: 'Jane' }
        ]
      },
      ACTOR
    );
    expect(out.ok).toBe(true);
    expect(out.body.trim()).toBe('');
    expect(out.pii_state).toBe('clean');
    expect(out.resolutions[0]).toMatchObject({ action: 'remove_file' });
    expect(mockSidecarPost).not.toHaveBeenCalled();
  });

  test('whole-file accept records per-text acceptances, scan-free', async () => {
    await seedConcept({ title: 'T', incorporation: '2013-09-18' }, 'Visit Jakarta, see Paris', {
      pii_state: 'hit',
      pii_hits_summary: { LOCATION: 2, DATE_TIME: 1 }
    });
    const out = await piiService.fileActionPii(
      'repoA',
      'c1',
      {
        action: 'accept',
        occurrences: [
          { where: 'body', type: 'LOCATION', hit: 'Jakarta' },
          { where: 'body', type: 'LOCATION', hit: 'Paris' },
          { where: 'frontmatter', type: 'DATE_TIME', hit: '2013-09-18' }
        ]
      },
      ACTOR
    );
    expect(out.ok).toBe(true);
    expect(out.pii_state).toBe('clean'); // 3 accepted, nothing remains
    expect(out.counts_by_type).toEqual({});
    expect(out.resolutions.filter((r) => r.action === 'accept')).toHaveLength(3);
    expect(mockSidecarPost).not.toHaveBeenCalled();
  });

  test('whole-file action validation and 404', async () => {
    await expect(piiService.fileActionPii('repoA', 'c1', { action: 'replace' }, ACTOR)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400
    });
    await expect(piiService.fileActionPii('repoA', 'ghost', { action: 'redact' }, ACTOR)).rejects.toMatchObject({
      code: 'CONCEPT_NOT_FOUND',
      status: 404
    });
  });

  test('validation: unknown action and empty replacement are rejected', async () => {
    await expect(piiService.remediatePii('repoA', 'c1', { action: 'nuke' }, ACTOR)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400
    });
    await expect(
      piiService.remediatePii('repoA', 'c1', { action: 'replace', where: 'body', replacement: '  ' }, ACTOR)
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
  });

  test('excerpts slice the SERVER text when the sidecar does not echo it (issues 1+4)', async () => {
    await seedConcept({ title: 'T' }, 'incorporated 2013-09-18 here');
    // NOTE: no `text` field on the results — the live Presidio sidecar does
    // not echo request text back, which emptied every panel excerpt.
    mockSidecarPost.mockResolvedValueOnce({
      data: {
        results: [
          { id: 'frontmatter', hits: [], counts_by_type: {} },
          { id: 'body', hits: [{ type: 'DATE_TIME', start: 13, end: 23, score: 0.9 }], counts_by_type: {} }
        ]
      }
    });
    const insp = await piiService.inspectConcept('repoA', 'c1', { title: 'T' }, 'incorporated 2013-09-18 here');
    expect(insp.occurrences).toHaveLength(1);
    expect(insp.occurrences[0].excerpt.hit).toBe('2013-09-18');
    expect(insp.occurrences[0].excerpt.before).toContain('incorporated');
    expect(insp.occurrences[0].excerpt.after).toContain('here');
  });

  test('unknown concept → 404 CONCEPT_NOT_FOUND (no scan)', async () => {
    await expect(
      piiService.remediatePii('repoA', 'ghost', { action: 'redact', where: 'body', start: 0, end: 1, hit: 'x' }, ACTOR)
    ).rejects.toMatchObject({ code: 'CONCEPT_NOT_FOUND', status: 404 });
    expect(mockSidecarPost).not.toHaveBeenCalled();
  });
});
