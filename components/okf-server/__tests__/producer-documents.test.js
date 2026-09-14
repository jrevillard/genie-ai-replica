// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 7.7 — documents→OKF conversion: whole-corpus segmentation/linking,
// xlsx FR-42 semantics, per-file isolation, and the SOURCES-BUSY lifecycle
// gate (ingested sources block ingest until retracted; is_bundle never trips).

jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));
jest.mock('../shared-lib/tracing', () => ({ withSpan: jest.fn(async (n, fn) => fn({ setAttribute: jest.fn() })) }));
jest.mock('../shared-lib/metrics', () => ({
  getMeter: jest.fn(() => ({
    createCounter: jest.fn(() => ({ add: jest.fn() })),
    createHistogram: jest.fn(() => ({ record: jest.fn() }))
  }))
}));
jest.mock('../shared-lib/db-connection-service', () => {
  const mockDb = require('./mocks/arango-mock').createMockDb();
  return { getConnection: jest.fn(() => Promise.resolve(mockDb)), __mockDb: mockDb };
});
jest.mock('../services/service-token', () => ({
  authedAxios: { get: jest.fn(), post: jest.fn(), patch: jest.fn(async () => ({ status: 200 })) }
}));
jest.mock('../services/ingest-service', () => ({
  ingestRepoConcepts: jest.fn(async (repo_id, payload) => ({ ok: true, count: payload.concepts.length })),
  runImportCuration: jest.fn(async () => ({ ok: true })),
  buildMegaConcept: jest.fn(() => [])
}));
jest.mock('../config', () => ({
  documentRepository: { url: 'http://document-repository:3001' },
  dataprep: { url: 'http://dataprep:5000' }
}));

const mockDb = require('../shared-lib/db-connection-service').__mockDb;
const { authedAxios } = require('../services/service-token');
const { ingestRepoConcepts, runImportCuration } = require('../services/ingest-service');
const { Readable } = require('stream');

const producer = require('../services/producer-service');
const lifecycle = require('../services/lifecycle-service');
const { convertXlsx } = require('../services/converters/xlsxSheetConverter');
const XLSX = require('xlsx');

const RID = '77777777-7777-4777-8777-777777777777';

function programQuery() {
  // The conversion-record patches ride raw AQL — the mock applies them to the
  // STORE (document() hands back copies, so mutations must hit the store
  // object) so assertions can read repoDoc.conversion / source_documents.
  mockDb.query.mockImplementation(async (q, bind) => {
    const text = typeof q === 'string' ? q : q && q.query;
    const store = (mockDb._stores && mockDb._stores.okf_repositories) || {};
    const live = store[bind && bind.repo_id];
    if (live && text && text.includes('UPDATE doc WITH { conversion')) {
      live.conversion = Object.assign({}, live.conversion, bind.patch);
      return { all: async () => [] };
    }
    if (live && text && text.includes('source_documents')) {
      live.source_documents = bind.docs;
      return { all: async () => [] };
    }
    return { all: async () => [] };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  producer.live.delete(RID);
  programQuery();
});

// ── segmentation + cross-file linking (pure) ────────────────────────────────

describe('producer-service — segmentation + whole-corpus linking', () => {
  const meta = { file_id: 'f1', file_name: 'report.pdf', baseResource: 'http://document-repository:3001/api/files/f1' };

  it('splits on H1/H2 headings, merges tiny sections, keeps one concept without headings', () => {
    const md = ['# Alpha', 'long alpha body '.repeat(20), '## Beta', 'beta body '.repeat(30), 'tiny'].join('\n');
    const out = producer.segmentMarkdown(md, { baseSlug: 'report', title: 'Report', meta });
    expect(out.length).toBe(2); // Alpha + Beta (the 'tiny' tail merges into Beta)
    expect(out[0].path).toBe('report-sec1.md');
    expect(out[1].frontmatter.title).toBe('Beta');
    expect(out[0].frontmatter.sources[0].locator).toContain('section');

    const flat = producer.segmentMarkdown('just a paragraph, no headings at all here', {
      baseSlug: 'plain',
      title: 'Plain',
      meta
    });
    expect(flat.length).toBe(1);
    expect(flat[0].path).toBe('plain.md');
    expect(flat[0].frontmatter.sources[0].locator).toBe('whole document');
  });

  it('resolves cross-file links only when the target concept exists in the corpus; self/dangling dropped', () => {
    const drafts = [
      { path: 'a.md', frontmatter: {}, body: 'see [the sheet](./b.md) and [self](./a.md) and [gone](./missing.md)' },
      { path: 'b.md', frontmatter: {}, body: 'back to [a](./a.md)' }
    ];
    const links = producer.resolveCrossFileLinks(drafts);
    expect(links).toBe(2);
    expect(drafts[0].frontmatter.links).toEqual([{ to_concept_id: 'b', label: 'the sheet' }]);
    expect(drafts[1].frontmatter.links).toEqual([{ to_concept_id: 'a', label: 'a' }]);
  });
});

// ── xlsx FR-42 semantics ─────────────────────────────────────────────────────

describe('producer-service — xlsx converter (FR-42: dictionary + row-groups)', () => {
  it('builds a dictionary concept + capped row-group concepts with dictionary links', () => {
    const wb = XLSX.utils.book_new();
    const rows = [['Region', 'Amount'], ...Array.from({ length: 25 }, (_, i) => [`R${i}`, i])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sales');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const { concepts, sheets } = convertXlsx(buf, {
      file_id: 'f9',
      file_name: 'market.xlsx',
      baseResource: 'http://document-repository:3001/api/files/f9'
    });
    expect(sheets[0]).toMatchObject({ name: 'Sales', rows: 25 });
    const dict = concepts.find((c) => c.frontmatter.type === 'data-dictionary');
    expect(dict).toBeTruthy();
    expect(dict.path).toBe('market-sales-dictionary.md');
    expect(dict.body).toContain('| Region |');
    const data = concepts.filter((c) => c.frontmatter.type === 'dataset');
    expect(data.length).toBe(1); // 25 rows < 200 → ONE group
    expect(data[0].frontmatter.links[0].to_concept_id).toBe('market-sales-dictionary');
    expect(data[0].body).toContain('| R0 |');
    expect(data[0].frontmatter.sources[0].locator).toContain('sheet "Sales"');
  });

  it('loud-rejects a workbook with no readable sheets', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Empty');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    expect(() => convertXlsx(buf, { file_id: 'f', file_name: 'e.xlsx', baseResource: 'x' })).toThrow(
      /no readable sheets/
    );
  });
});

// ── the conversion run (mocked doc-repo + ingest) ───────────────────────────

describe('producer-service — startDocumentsConversion + run', () => {
  function mockDocs(files) {
    // files: { file_id: file_name } — ONE implementation keyed by URL (a
    // second mockDoc() would REPLACE the implementation, clobbering the first).
    authedAxios.get.mockImplementation((url) => {
      const s = String(url);
      if (s.endsWith('/download')) {
        const fid = s.split('/api/files/')[1].replace(/\/download$/, '');
        return Promise.resolve({ data: Readable.from([Buffer.from('# T\n\nbody for ' + fid)]) });
      }
      const fid = s.split('/api/files/')[1];
      const fn = files[fid] || fid + '.md';
      return Promise.resolve({
        data: { file: { file_id: fid, file_name: fn, size: 100, dataprep: { status: 'Pending' } } }
      });
    });
  }

  it('validates: empty / duplicate / too many file_ids', async () => {
    await expect(producer.startDocumentsConversion({ repo_id: RID, file_ids: [] })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
    await expect(producer.startDocumentsConversion({ repo_id: RID, file_ids: ['a', 'a'] })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
    const many = Array.from({ length: 101 }, (_, i) => 'f' + i);
    await expect(producer.startDocumentsConversion({ repo_id: RID, file_ids: many })).rejects.toMatchObject({
      code: 'TOO_MANY_FILES'
    });
  });

  it('imports the corpus: per-file drafts, cross-links, index LAST, one curation pass, done record', async () => {
    mockDocs({ f1: 'alpha.md', f2: 'beta.md' });
    await mockDb.collection('okf_repositories').save({ _key: RID, repo_id: RID, name: 'Imported', domain: 'general' });
    await producer.startDocumentsConversion({
      repo_id: RID,
      file_ids: ['f1', 'f2'],
      requested_name: 'Imported',
      classification: 'heuristics',
      actor: { sub: 'steward' }
    });
    // the runner is awaited via the live registry promise chain
    await producer.live.get(RID);
    expect(ingestRepoConcepts).toHaveBeenCalled();
    const calls = ingestRepoConcepts.mock.calls;
    const allConcepts = calls.flatMap((c) => c[1].concepts);
    expect(allConcepts.some((c) => c.path === 'alpha.md')).toBe(true);
    expect(allConcepts.some((c) => c.path === 'beta.md')).toBe(true);
    const index = allConcepts.find((c) => c.path === 'index.md');
    expect(index).toBeTruthy();
    expect(index.frontmatter.type).toBe('index');
    expect(allConcepts.indexOf(index)).toBeGreaterThan(
      allConcepts.indexOf(allConcepts.find((c) => c.path === 'beta.md'))
    );
    expect(runImportCuration).toHaveBeenCalledTimes(1); // WHOLE-CORPUS pass, once
    const repoDoc = await mockDb.collection('okf_repositories').document(RID);
    expect(repoDoc.conversion.status).toBe('done');
    // summary.concepts = segmented CONTENT drafts (2) — the index.md root is
    // structural, ingested last, and not counted as corpus content.
    expect(repoDoc.conversion.summary).toMatchObject({ files_imported: 2, concepts: 2 });
    expect(repoDoc.source_documents).toHaveLength(2);
    expect(repoDoc.source_documents[0].kind).toBe('document');
    expect(authedAxios.patch).toHaveBeenCalledWith(
      expect.stringContaining('/api/files/f1'),
      { okf_repo_id: RID },
      expect.anything()
    );
  });

  it('per-file isolation: a failing document lands in per_file and never aborts the batch', async () => {
    authedAxios.get.mockImplementation((url) => {
      if (String(url).includes('/f-bad') && String(url).endsWith('/download')) {
        return Promise.reject(new Error('download boom'));
      }
      if (String(url).endsWith('/download')) {
        return Promise.resolve({ data: Readable.from([Buffer.from('plain text doc, no headings')]) });
      }
      return Promise.resolve({
        data: { file: { file_name: String(url).includes('f-bad') ? 'bad.pdf' : 'good.txt', size: 10 } }
      });
    });
    await mockDb.collection('okf_repositories').save({ _key: RID, repo_id: RID, name: 'P' });
    await producer.startDocumentsConversion({ repo_id: RID, file_ids: ['f-bad', 'f-good'] });
    await producer.live.get(RID);
    const repoDoc = await mockDb.collection('okf_repositories').document(RID);
    expect(repoDoc.conversion.status).toBe('done'); // partial SUCCESS, honestly reported
    const bad = repoDoc.conversion.per_file.find((p) => p.file_id === 'f-bad');
    expect(bad.status).toBe('failed');
    expect(bad.error).toContain('download boom');
    expect(repoDoc.conversion.summary.files_imported).toBe(1);
  });
});

// ── SOURCES-BUSY lifecycle gate ──────────────────────────────────────────────

describe('lifecycle sourcesBusyBlocker (Story 7.7 gate)', () => {
  const repo = (sources) => ({ repo_id: RID, source_documents: sources });

  it('blocks while a source doc is Ingested, naming the file (fail-closed on re-check errors)', async () => {
    authedAxios.get.mockResolvedValueOnce({
      data: { file: { file_name: 'live.pdf', dataprep: { status: 'Ingested' } } }
    });
    const blocker = await lifecycle.sourcesBusyBlocker(
      repo([{ kind: 'document', file_id: 'f1', file_name: 'live.pdf' }])
    );
    expect(blocker.code).toBe('SOURCES_NOT_RETRACTED');
    expect(blocker.message).toContain('live.pdf');
    // FAIL-CLOSED: doc-repo unreachable → treated as still serving
    authedAxios.get.mockRejectedValueOnce(new Error('doc-repo down'));
    const failClosed = await lifecycle.sourcesBusyBlocker(
      repo([{ kind: 'document', file_id: 'f2', file_name: 'x.pdf' }])
    );
    expect(failClosed.code).toBe('SOURCES_NOT_RETRACTED');
  });

  it('passes once sources are Retracted / Pending / Errored', async () => {
    authedAxios.get.mockImplementation((url) =>
      Promise.resolve({
        data: {
          file: { file_name: 'r.pdf', dataprep: { status: String(url).includes('f1') ? 'Retracted' : 'Pending' } }
        }
      })
    );
    const blocker = await lifecycle.sourcesBusyBlocker(
      repo([
        { kind: 'document', file_id: 'f1' },
        { kind: 'document', file_id: 'f2' }
      ])
    );
    expect(blocker).toBeNull();
  });

  it('is structurally inert without source_documents and never trips on the repo bundle', async () => {
    expect(await lifecycle.sourcesBusyBlocker({ repo_id: RID })).toBeNull(); // crawl repo
    // The repo's OWN bundle zip reports dataprep 'Ingested' + is_bundle=true
    // (fileService.js:1000) — it must NEVER trip the gate.
    authedAxios.get.mockResolvedValueOnce({
      data: { file: { file_name: 'bundle.zip', is_bundle: true, dataprep: { status: 'Ingested' } } }
    });
    expect(await lifecycle.sourcesBusyBlocker(repo([{ kind: 'document', file_id: 'bundle-1' }]))).toBeNull();
  });
});
