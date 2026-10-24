// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Backing-file lifecycle (David, 2026-10-12) — the two defects this closes,
// both reproduced live on Bali-wikipedia-LLM:
//
//   A. RETRACT MARKED EXACTLY ONE BUNDLE. The old code fetched
//      `?is_bundle=true&limit=1` and patched items[0], but supersedeOldBundles
//      was removed by the WS3 directive (bundles live forever — one zip per
//      publish version). A repo with N published versions therefore kept N-1
//      zips badged 'Ingested' after retract. Bali had v17/v18/v19/v20 with
//      ingested_at=null; only v17 was marked. The admin list showed three
//      INGESTED entries for a repository serving nothing.
//
//   B. THE DELETE CASCADE MISSED SOURCE DOCUMENTS. graph-retract-service's
//      files sweep filters `f.repo_id == repo_id`, but source documents are
//      stamped `okf_repo_id` — so deleting a document-built repo orphaned every
//      upload it was built from.
//
// Plus the data-loss guard: a file may legitimately back MORE THAN one live
// repository (the okf_repo_id stamp is fail-soft and was observed failing
// 41/41; the DUPLICATE_CONTENT guard explicitly exempts the target repo), so
// the hard delete must skip a file another live repo still needs — and must
// fail CLOSED when that check itself errors.

jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));
jest.mock('../shared-lib/tracing', () => ({
  withSpan: jest.fn(async (name, fn) => fn({ setAttribute: jest.fn() }))
}));
jest.mock('../shared-lib/db-connection-service', () => {
  const mockDb = require('./mocks/arango-mock').createMockDb();
  return { getConnection: jest.fn(() => Promise.resolve(mockDb)), __mockDb: mockDb };
});
jest.mock('../services/service-token', () => {
  const get = jest.fn().mockResolvedValue({ data: { data: [] } });
  const post = jest.fn().mockResolvedValue({ data: { file_id: 'file-new-1' } });
  const patch = jest.fn().mockResolvedValue({});
  const _delete = jest.fn().mockResolvedValue({});
  return { __esModule: true, authedAxios: { get, post, patch, delete: _delete }, getServiceToken: jest.fn() };
});

const mockDb = require('../shared-lib/db-connection-service').__mockDb;
const { authedAxios } = require('../services/service-token');
const service = require('../services/backing-file-service');

const REPO = 'bali-0000-0000-0000-000000000001';
const OTHER = 'other-0000-0000-0000-000000000002';

/** The rows the AQL router below serves; seeded by seedFile(). */
let files = [];

/** Seed a files doc exactly as its owning service stamps it. */
function seedFile(fields) {
  const doc = { _key: fields.file_id, ...fields };
  files.push(doc); // the arango mock does not feed collection rows into AQL cursors
  return mockDb.collection('files').save(doc);
}

/**
 * The arango mock feeds collection rows only into collection handles, not into
 * AQL cursors, so route db.query by the shape of the statement the service
 * issues. Keyed off the bind-parameter names, which are unique per statement.
 */
function programQueries({ otherRepoFor = {} } = {}) {
  mockDb.query.mockImplementation(async (q, bind) => {
    const text = typeof q === 'string' ? q : q && q.query ? String(q.query) : '';
    const all = (rows) => async () => rows; // cursor.all() takes no arguments
    // Stamp-clearing UPDATE must be routed BEFORE the enumeration branches: its
    // FILTER text also contains `f.okf_repo_id == @repo_id`, so without this it
    // would be swallowed by the enumeration handler below and the test would
    // "pass" while the production query never ran.
    if (text.includes('UPDATE f WITH { okf_repo_id: null }')) {
      const hit = files.filter((f) => f.file_id === bind.file_id && f.okf_repo_id === bind.repo_id);
      for (const f of hit) f.okf_repo_id = null;
      return { all: all(hit.map(() => 1)) };
    }
    // Backing-file enumeration — bundle artifacts (stamped repo_id).
    if (text.includes('f.repo_id == @repo_id')) {
      return { all: all(files.filter((f) => f.repo_id === bind.repo_id && f.okf_repo_id == null)) };
    }
    // Backing-file enumeration — source documents (stamped okf_repo_id).
    if (text.includes('f.okf_repo_id == @repo_id')) {
      return { all: all(files.filter((f) => f.okf_repo_id === bind.repo_id)) };
    }
    // Mirror lookup for a source_documents[] entry whose files doc we must confirm.
    if (text.includes('f.file_id == @fid')) {
      return { all: all(files.filter((f) => f.file_id === bind.fid)) };
    }
    // otherLiveRepoUsingFile — does another LIVE repo still back this file?
    if (text.includes('s.file_id == @file_id')) {
      return { all: all(otherRepoFor[bind.file_id] ? [{ repo_id: otherRepoFor[bind.file_id] }] : []) };
    }
    return { all: all([]) };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb._reset();
  files = [];
  programQueries();
});

describe('backing-file-service.markRetracted — defect A (retract marked ONE bundle)', () => {
  test('marks ALL bundles Retracted, not just items[0] of a limit=1 fetch', async () => {
    // Four published versions -> four bundles (WS3: they live forever). This is
    // the exact Bali shape: v17..v20, only the first ever marked Retracted.
    for (const v of [17, 18, 19, 20]) {
      seedFile({
        file_id: `bali-v${v}`,
        file_name: `bali-wikipedia-llm-v${v}.zip`,
        repo_id: REPO,
        is_bundle: true,
        bundle_version: v,
        dataprep: { status: v === 17 ? 'Retracted' : 'Ingested' }
      });
    }
    const result = await service.markRetracted(REPO, { reason: 'repository retracted' });
    // v17 was already Retracted -> skipped, preserving its original retract_date.
    expect(result.total).toBe(4);
    expect(result.marked.sort()).toEqual(['bali-v18', 'bali-v19', 'bali-v20']);
    const patched = authedAxios.patch.mock.calls.map((c) => c[0]);
    expect(patched).toHaveLength(3);
    expect(patched.some((u) => u.includes('bali-v18'))).toBe(true);
    expect(patched.some((u) => u.includes('bali-v20'))).toBe(true);
  });

  test('every patch asserts the Retracted status + a retract_date (the badge must stop lying)', async () => {
    seedFile({ file_id: 'b1', file_name: 'b.zip', repo_id: REPO, is_bundle: true, dataprep: { status: 'Ingested' } });
    await service.markRetracted(REPO);
    const body = authedAxios.patch.mock.calls[0][1];
    expect(body.dataprep.status).toBe('Retracted');
    expect(typeof body.dataprep.retract_date).toBe('string');
    expect(body.dataprep.retract_date).toBeTruthy();
  });

  test('does NOT re-stamp an already-Retracted file (its retract_date is the audit trail)', async () => {
    seedFile({ file_id: 'b1', file_name: 'b.zip', repo_id: REPO, is_bundle: true, dataprep: { status: 'Retracted' } });
    const result = await service.markRetracted(REPO);
    expect(result.marked).toEqual([]);
    expect(authedAxios.patch).not.toHaveBeenCalled();
  });

  test('marks SOURCE documents too (they are badged Ingested just the same)', async () => {
    seedFile({ file_id: 's1', file_name: 'doc.md', okf_repo_id: REPO, dataprep: { status: 'Ingested' } });
    seedFile({ file_id: 'b1', file_name: 'b.zip', repo_id: REPO, is_bundle: true, dataprep: { status: 'Ingested' } });
    const result = await service.markRetracted(REPO);
    expect(result.marked.sort()).toEqual(['b1', 's1']);
  });

  test('a doc-repo failure on one file never aborts the rest (best-effort, non-fatal)', async () => {
    seedFile({ file_id: 'b1', file_name: 'b.zip', repo_id: REPO, is_bundle: true, dataprep: { status: 'Ingested' } });
    seedFile({ file_id: 'b2', file_name: 'b.zip', repo_id: REPO, is_bundle: true, dataprep: { status: 'Ingested' } });
    authedAxios.patch.mockRejectedValueOnce(new Error('doc-repo 503'));
    const result = await service.markRetracted(REPO);
    expect(result.marked).toEqual(['b2']);
    expect(result.failed).toEqual([expect.objectContaining({ file_id: 'b1' })]);
  });

  test('retract NEVER hard-deletes — a retracted repo is the edit state and can come back', async () => {
    seedFile({ file_id: 's1', file_name: 'doc.md', okf_repo_id: REPO, dataprep: { status: 'Ingested' } });
    await service.markRetracted(REPO);
    expect(authedAxios.delete).not.toHaveBeenCalled();
  });
});

describe('backing-file-service.hardDelete — defect B (delete cascade missed source docs)', () => {
  test('deletes BOTH the bundle artifacts and the source documents', async () => {
    seedFile({ file_id: 'b1', file_name: 'b.zip', repo_id: REPO, is_bundle: true, dataprep: { status: 'Ingested' } });
    seedFile({ file_id: 's1', file_name: 'doc.md', okf_repo_id: REPO, dataprep: { status: 'Ingested' } });
    seedFile({ file_id: 's2', file_name: 'doc2.pdf', okf_repo_id: REPO, dataprep: { status: 'Ingested' } });
    const result = await service.hardDelete(REPO);
    expect(result.deleted.sort()).toEqual(['b1', 's1', 's2']);
    const urls = authedAxios.delete.mock.calls.map((c) => c[0]);
    expect(urls).toHaveLength(3);
    // Goes through doc-repo's DELETE route — only that unlinks the bytes on
    // disk and purges the ingestion/crawl log rows.
    urls.forEach((u) => expect(u).toMatch(/\/api\/files\/[a-z0-9]+$/));
  });

  test('finds a source document whose okf_repo_id stamp FAILED via the repo doc mirror', async () => {
    // Story 1-8g-q: the stamp failed 41/41, so files.okf_repo_id was null while
    // the repo doc still listed the upload as a source. Both other filters miss
    // it; only the mirror finds it.
    await mockDb.collection('okf_repositories').save({
      _key: REPO,
      repo_id: REPO,
      name: 'Bali',
      source_documents: [{ file_id: 'unstamped', file_name: 'unstamped.zip' }]
    });
    seedFile({ file_id: 'unstamped', file_name: 'unstamped.zip', is_bundle: true, dataprep: { status: 'Ingested' } });
    const result = await service.hardDelete(REPO);
    expect(result.deleted).toEqual(['unstamped']);
  });

  test('a source_documents[] entry with no files doc is tolerated (upload already gone)', async () => {
    await mockDb.collection('okf_repositories').save({
      _key: REPO,
      repo_id: REPO,
      name: 'Bali',
      source_documents: [{ file_id: 'ghost' }]
    });
    const result = await service.hardDelete(REPO);
    expect(result.deleted).toEqual([]);
    expect(result.failed).toEqual([]);
  });
});

describe('backing-file-service — multi-repo data-loss guard', () => {
  test('SKIPS a file another LIVE repository still backs (never create a data-loss bug)', async () => {
    seedFile({ file_id: 'shared', file_name: 'shared.zip', okf_repo_id: REPO, dataprep: { status: 'Ingested' } });
    seedFile({ file_id: 'solo', file_name: 'solo.zip', okf_repo_id: REPO, dataprep: { status: 'Ingested' } });
    programQueries({ otherRepoFor: { shared: OTHER } });
    const result = await service.hardDelete(REPO);
    expect(result.deleted).toEqual(['solo']);
    expect(result.skipped).toEqual(['shared']);
    const deletedUrls = authedAxios.delete.mock.calls.map((c) => c[0]);
    expect(deletedUrls.some((u) => u.includes('shared'))).toBe(false);
  });

  // David, 2026-10-14: "when a repo is retracted and deleted, the files that
  // were used to create/import it are still flagged as used by a repo". A kept
  // file outlives the repo it was stamped for, so the stamp must be dropped —
  // otherwise every later sweep keyed on okf_repo_id has to special-case it.
  test('clears okf_repo_id on a SKIPPED file so it stops pointing at a deleted repo', async () => {
    seedFile({ file_id: 'shared', file_name: 'shared.zip', okf_repo_id: REPO, dataprep: { status: 'Ingested' } });
    programQueries({ otherRepoFor: { shared: OTHER } });
    const result = await service.hardDelete(REPO);
    expect(result.skipped).toEqual(['shared']);
    expect(files.find((f) => f.file_id === 'shared').okf_repo_id).toBeNull();
  });

  test('clears okf_repo_id when the live-repo CHECK FAILED and the file was kept', async () => {
    seedFile({ file_id: 's1', file_name: 'doc.md', okf_repo_id: REPO, dataprep: { status: 'Ingested' } });
    const real = mockDb.query.getMockImplementation();
    mockDb.query.mockImplementation(async (q, bind) => {
      const text = String(q && q.query ? q.query : q);
      if (text.includes('s.file_id == @file_id')) return { all: async () => [{ repo_id: '__CHECK_FAILED__' }] };
      return real(q, bind);
    });
    const result = await service.hardDelete(REPO);
    expect(result.skipped).toEqual(['s1']);
    expect(files.find((f) => f.file_id === 's1').okf_repo_id).toBeNull();
  });

  test('does NOT clear a stamp that names a DIFFERENT repo (single-scalar field)', async () => {
    seedFile({ file_id: 's1', file_name: 'doc.md', okf_repo_id: OTHER, dataprep: { status: 'Ingested' } });
    programQueries({ otherRepoFor: { s1: OTHER } });
    await service.hardDelete(REPO);
    // The guarded FILTER must leave it alone — okf_repo_id is one scalar, so an
    // unguarded UNSET would drop the surviving repository's claim.
    expect(files.find((f) => f.file_id === 's1').okf_repo_id).toBe(OTHER);
  });

  test('FAILS CLOSED: when the live-repo check errors, the file is kept', async () => {
    seedFile({ file_id: 's1', file_name: 'doc.md', okf_repo_id: REPO, dataprep: { status: 'Ingested' } });
    // Break ONLY the otherLiveRepoUsingFile statement; enumeration must still work.
    const real = mockDb.query.getMockImplementation();
    mockDb.query.mockImplementation(async (q, bind) => {
      const text = String(q && q.query ? q.query : q);
      if (text.includes('s.file_id == @file_id')) throw new Error('arango connection reset');
      return real(q, bind);
    });
    const result = await service.hardDelete(REPO);
    expect(result.deleted).toEqual([]);
    expect(result.skipped).toEqual(['s1']);
    expect(authedAxios.delete).not.toHaveBeenCalled();
  });

  test('a 404 from doc-repo counts as success (double-delete / prior raw REMOVE race)', async () => {
    seedFile({ file_id: 'b1', file_name: 'b.zip', repo_id: REPO, is_bundle: true, dataprep: { status: 'Ingested' } });
    const notFound = Object.assign(new Error('not found'), { response: { status: 404 } });
    authedAxios.delete.mockRejectedValueOnce(notFound);
    const result = await service.hardDelete(REPO);
    expect(result.deleted).toEqual(['b1']);
    expect(result.failed).toEqual([]);
  });

  test('a real delete failure is recorded but never throws (cascade must not fail)', async () => {
    seedFile({ file_id: 'b1', file_name: 'b.zip', repo_id: REPO, is_bundle: true, dataprep: { status: 'Ingested' } });
    authedAxios.delete.mockRejectedValueOnce(
      Object.assign(new Error('permission denied'), { response: { status: 403 } })
    );
    const result = await service.hardDelete(REPO);
    expect(result.deleted).toEqual([]);
    expect(result.failed).toEqual([expect.objectContaining({ file_id: 'b1' })]);
  });

  test('no repo doc at all -> empty set, no throw (idempotent)', async () => {
    const result = await service.hardDelete('does-not-exist');
    expect(result).toMatchObject({ deleted: [], skipped: [], failed: [], total: 0 });
  });
});
