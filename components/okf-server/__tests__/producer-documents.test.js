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
const { captureEnv } = require('./fixtures/env');
const { authedAxios } = require('../services/service-token');
const { ingestRepoConcepts, runImportCuration } = require('../services/ingest-service');
const { Readable } = require('stream');
const { logger } = require('../shared-lib/logger');

const producer = require('../services/producer-service');
const docRepoClient = require('../services/doc-repo-client');
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
    if (text && text.includes('POSITION(@hashes')) {
      // DUPLICATE_CONTENT gate: first LIVE other-repo whose source_documents
      // carries one of the candidate content hashes.
      const wanted = (bind && bind.hashes) || [];
      const dup = Object.values(store).find(
        (r) =>
          r &&
          !r.deleted_at &&
          r.repo_id !== bind.rid &&
          (r.source_documents || []).some((s) => s.file_hash && wanted.includes(s.file_hash))
      );
      if (dup) {
        const dupFiles = (dup.source_documents || [])
          .filter((s) => s.file_hash && wanted.includes(s.file_hash))
          .map((s) => ({ file_id: s.file_id, file_name: s.file_name }));
        return { all: async () => [{ repo_id: dup.repo_id, name: dup.name, dupFiles }] };
      }
      return { all: async () => [] };
    }
    if (live && text && text.includes('source_documents')) {
      live.source_documents = bind.docs;
      return { all: async () => [] };
    }
    return { all: async () => [] };
  });
}

beforeEach(async () => {
  // Drain the in-flight conversions BEFORE resetting the shared mocks — a
  // runner left alive by an earlier test deletes the registry entry when it
  // ends, and that would delete the NEXT test's reservation (the registry is
  // load-bearing for the 409 assertions).
  await Promise.all(Array.from(producer.live.values(), (p) => p.catch(() => {})));
  jest.clearAllMocks();
  producer.live.delete(RID);
  // The content claim registry (issue #1744) is cleared for the same reason
  // the conversion registry is: a test that aborts between the claim and its
  // release would otherwise leave the content claimed for the whole process.
  producer.contentClaims.clear();
  programQuery();
});

// A test that closes the LLM opt-in must not close it for the next one.
const restoreEndpoint = captureEnv('VLLM_ENDPOINT');
afterEach(() => {
  restoreEndpoint();
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

  // WHOLE-FILE MARKDOWN IMPORT (issue #1029 — David's slaughterhouse
  // round-trip): a frontmatter'd .md imports WHOLE — one concept, id = the
  // file stem — so exported repos round-trip and their links resolve.
  it('draftWholeMarkdown: a frontmatter-bearing .md imports whole with its own frontmatter and verbatim body', () => {
    const fileMd = [
      '---',
      'title: Abattoir Licensing guidance',
      'type: process',
      'sources:',
      '  - kind: document',
      '    resource: http://document-repository:3001/api/files/orig',
      '    file_id: orig',
      '    file_name: guidance-doc-sec1.md',
      '    locator: "section \\"Abattoir Licensing guidance\\""',
      '---',
      '## Abattoir Licensing guidance',
      '',
      'Licensing requires annual renewal. Related: [Fees recap](./fees-recap.md)',
      ''
    ].join('\n');
    const out = producer.draftWholeMarkdown(fileMd, {
      baseSlug: 'guidance-doc-sec1',
      title: 'fallback',
      meta: { file_id: 'f9', file_name: 'guidance-doc-sec1.md', baseResource: 'http://x/f9' }
    });
    expect(out).not.toBeNull();
    expect(out.length).toBe(1); // WHOLE — never re-split
    expect(out[0].path).toBe('guidance-doc-sec1.md'); // id = file stem
    expect(out[0].frontmatter.title).toBe('Abattoir Licensing guidance');
    expect(out[0].frontmatter.type).toBe('process');
    expect(Array.isArray(out[0].frontmatter.sources)).toBe(true);
    expect(out[0].frontmatter.sources[0].file_id).toBe('orig'); // authorial sources untouched
    expect(out[0].body).toContain('## Abattoir Licensing guidance');
    expect(out[0].body).not.toContain('---');
  });

  it('draftWholeMarkdown: frontmatter without a usable title is rejected; frontmatter-less falls back; authorial-less sources get the stamp', () => {
    expect(producer.draftWholeMarkdown('no frontmatter here\n## Head\nbody', { baseSlug: 'x', meta })).toBeNull();
    expect(
      producer.draftWholeMarkdown('---\ndescription: no title key\n---\nbody', { baseSlug: 'x', meta })
    ).toBeNull();

    const stamped = producer.draftWholeMarkdown('---\ntitle: Fresh concept\n---\n\nBody text.\n', {
      baseSlug: 'fresh',
      meta: { file_id: 'f2', file_name: 'fresh.md', baseResource: 'http://x/f2' }
    });
    expect(stamped.length).toBe(1);
    expect(stamped[0].frontmatter.sources[0]).toEqual({
      kind: 'document',
      resource: 'http://x/f2',
      file_id: 'f2',
      file_name: 'fresh.md',
      locator: 'whole document'
    });
  });

  it('round-trip: whole-file drafts keep their corpus links (the #1029 regression)', () => {
    const mk = (stem, body) =>
      producer.draftWholeMarkdown(`---\ntitle: ${stem}\n---\n${body}`, {
        baseSlug: stem,
        meta: { file_id: stem, file_name: `${stem}.md`, baseResource: `http://x/${stem}` }
      })[0];
    const a = mk('abattoir-licensing', 'See [Fees recap](./fees-recap.md) and [Missing](./ghost.md)');
    const b = mk('fees-recap', 'Back to [Licensing](./abattoir-licensing.md)');
    const links = producer.resolveCrossFileLinks([a, b]);
    expect(links).toBe(2); // the old names ARE the new ids — nothing dangles
    expect(a.frontmatter.links).toEqual([{ to_concept_id: 'fees-recap', label: 'Fees recap' }]);
  });
});

// ── T6-lite: flat text → structured markdown (the PDF blob-concept fix) ─────

describe('producer-service — structurePlainText (flat text gains heading structure)', () => {
  const { structurePlainText, isHeadingCandidate } = producer;

  it('promotes numbered headings so segmentMarkdown splits a FLAT pdf/docx text into MULTIPLE concepts', () => {
    const body = (seed) =>
      `To complete this step, fill in every required field on the form and submit it to the office for review. ${seed} ` +
      'The processing time is usually five working days, and you will receive a confirmation letter afterwards. ' +
      'Keep a copy of every document you submit for your own records and future reference. '.repeat(2);
    const flat = [
      'MEWA User Guide.',
      'This guide explains the scheme.',
      '1. Registration',
      body('Registration requires a valid identity document.'),
      '2. Contributions',
      body('Contributions are due monthly and payable in advance.'),
      '2.1 Rates',
      body('The applicable rates table follows for each member category.'),
      '3. Claims',
      body('Claims must be filed within ninety days of the incident date.')
    ].join('\n');
    const structured = structurePlainText(flat);
    const drafts = producer.segmentMarkdown(structured, {
      baseSlug: 'guide',
      title: 'Guide',
      meta: { file_id: 'f1', file_name: 'guide.pdf', baseResource: 'x' }
    });
    expect(drafts.length).toBeGreaterThanOrEqual(4); // was ONE blob before T6-lite
    expect(drafts[0].frontmatter.title).toContain('Registration'); // the tiny preamble merges forward into section 1
    expect(structured).toContain('## 1. Registration');
  });

  it('leaves text with REAL markdown headings untouched and prose without headings as one blob', () => {
    const md = '# Real\n\nbody\n\n## Sub\n\nmore';
    expect(structurePlainText(md)).toBe(md);
    const prose = Array.from({ length: 30 }, (_, i) => `This is sentence number ${i} with words that flow.`).join('\n');
    expect(structurePlainText(prose)).not.toMatch(/^## /m);
    expect(isHeadingCandidate('This sentence has many words and ends normally.', 'next')).toBe(false);
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

  it('409s a document stamped by ANOTHER EXISTING OKF repository (server-enforced badge)', async () => {
    mockDocs({ f1: 'alpha.md' });
    await mockDb.collection('okf_repositories').save({ _key: RID, repo_id: RID, name: 'Mine', domain: 'general' });
    await mockDb
      .collection('okf_repositories')
      .save({ _key: 'r-other', repo_id: 'r-other', name: 'Other', domain: 'general' });
    authedAxios.get.mockImplementationOnce((url) => {
      const fid = String(url).split('/api/files/')[1];
      return Promise.resolve({
        data: {
          file: { file_id: fid, file_name: 'alpha.md', okf_repo_id: 'r-other', dataprep: { status: 'Pending' } }
        }
      });
    });
    await expect(
      producer.startDocumentsConversion({ repo_id: RID, file_ids: ['f1'], requested_name: 'x' })
    ).rejects.toMatchObject({ code: 'DOCUMENT_IN_ANOTHER_REPO', status: 409 });
  });

  it('self-heals a STALE stamp (stamped repo deleted) — import proceeds and re-stamps', async () => {
    mockDocs({ f1: 'alpha.md' });
    await mockDb.collection('okf_repositories').save({ _key: RID, repo_id: RID, name: 'Mine', domain: 'general' });
    authedAxios.get.mockImplementationOnce((url) => {
      const fid = String(url).split('/api/files/')[1];
      return Promise.resolve({
        data: {
          file: { file_id: fid, file_name: 'alpha.md', okf_repo_id: 'r-gone', dataprep: { status: 'Pending' } }
        }
      });
    });
    await producer.startDocumentsConversion({
      repo_id: RID,
      file_ids: ['f1'],
      requested_name: 'x',
      classification: 'heuristics',
      actor: { sub: 's' }
    });
    await producer.live.get(RID);
    const repoDoc = await mockDb.collection('okf_repositories').document(RID);
    expect(repoDoc.conversion.status).toBe('done');
    expect(repoDoc.source_documents).toHaveLength(1); // re-stamped to THIS repo
  });

  it('fetches each source file metadata ONCE — the pre-flight read feeds stamp + conversion', async () => {
    // The import pipeline reads a file's metadata at THREE points (pre-flight
    // verification, source stamping, conversion) but doc-repo serves it from
    // ONE GET — the pre-flight response is carried through the later stages.
    mockDocs({ f1: 'alpha.md', f2: 'beta.md' });
    await mockDb.collection('okf_repositories').save({ _key: RID, repo_id: RID, name: 'Mine', domain: 'general' });
    await producer.startDocumentsConversion({
      repo_id: RID,
      file_ids: ['f1', 'f2'],
      requested_name: 'x',
      classification: 'heuristics',
      actor: { sub: 's' }
    });
    await producer.live.get(RID);
    const metaGets = authedAxios.get.mock.calls.filter((c) => !String(c[0]).endsWith('/download'));
    const downloads = authedAxios.get.mock.calls.filter((c) => String(c[0]).endsWith('/download'));
    const stamps = authedAxios.patch.mock.calls.filter((c) => String(c[0]).includes('/api/files/'));
    expect(metaGets).toHaveLength(2); // ONE per file — a re-fetch per stage regresses this to 6
    expect(downloads).toHaveLength(2); // the content transfer itself
    expect(stamps).toHaveLength(2); // okf_repo_id still stamped on every file
  });

  it('refuses a SECOND start for the same repo while the first is still stamping its sources', async () => {
    // ONE conversion per repo. The guard's window: the check and the runner's
    // registration are separated by the queued patch + the per-file source
    // stamping (one doc-repo PATCH per file). A second start that slipped
    // through that window imported the corpus twice (issue #1684). The stamp
    // is HELD here, so the window is open deterministically — no timing, no
    // polling.
    mockDocs({ f1: 'alpha.md' });
    await mockDb.collection('okf_repositories').save({ _key: RID, repo_id: RID, name: 'Mine', domain: 'general' });
    let parked = false;
    let stampStarted;
    const stamping = new Promise((resolve) => {
      stampStarted = resolve;
    });
    let releaseStamp;
    const held = new Promise((resolve) => {
      releaseStamp = resolve;
    });
    authedAxios.patch.mockImplementation(async () => {
      if (!parked) {
        parked = true;
        stampStarted();
        await held;
      }
      return { status: 200 };
    });

    const first = producer.startDocumentsConversion({ repo_id: RID, file_ids: ['f1'], requested_name: 'x' });
    await stamping; // the first import is parked inside its stamping stage
    const second = await producer
      .startDocumentsConversion({ repo_id: RID, file_ids: ['f1'], requested_name: 'x' })
      .catch((err) => err);
    releaseStamp();
    await first;
    await producer.live.get(RID);
    // Restore the module's default stamp mock — clearAllMocks() clears the
    // CALL history but keeps the implementation.
    authedAxios.patch.mockImplementation(async () => ({ status: 200 }));
    expect(second).toMatchObject({ code: 'CONVERSION_IN_FLIGHT', status: 409 });
  });

  it('refuses a racing second start BEFORE the pre-flight — the loser pays no doc-repo round trip (#1775)', async () => {
    // The conversion reservation is claimed BEFORE the import pre-flight, so
    // the loser of a race is refused WITHOUT paying the pre-flight (up to
    // OKF_MAX_IMPORT_FILES doc-repo metadata GETs + the duplicate query).
    // The first import is parked inside its metadata GET — the window is
    // open deterministically, no timing, no polling.
    await mockDb.collection('okf_repositories').save({ _key: RID, repo_id: RID, name: 'Mine', domain: 'general' });
    const metaOf = (fid) => ({
      data: { file: { file_id: fid, file_name: 'alpha.md', size: 100, dataprep: { status: 'Pending' } } }
    });
    let parked = false;
    let metaStarted;
    const metaStart = new Promise((resolve) => {
      metaStarted = resolve;
    });
    let releaseMeta;
    const held = new Promise((resolve) => {
      releaseMeta = resolve;
    });
    authedAxios.get.mockImplementation(async (url) => {
      const s = String(url);
      if (s.endsWith('/download')) {
        const fid = s.split('/api/files/')[1].replace(/\/download$/, '');
        return { data: Readable.from([Buffer.from('# T\n\nbody for ' + fid)]) };
      }
      const fid = s.split('/api/files/')[1];
      if (!parked) {
        parked = true;
        metaStarted();
        await held;
      }
      return metaOf(fid);
    });

    const first = producer.startDocumentsConversion({ repo_id: RID, file_ids: ['f1'], requested_name: 'x' });
    await metaStart; // the first import is parked inside its pre-flight
    const metaGets = () => authedAxios.get.mock.calls.filter((c) => !String(c[0]).endsWith('/download')).length;
    const metaGetsBefore = metaGets();
    const second = await producer
      .startDocumentsConversion({ repo_id: RID, file_ids: ['f1'], requested_name: 'x' })
      .catch((err) => err);
    const metaGetsAfter = metaGets();
    releaseMeta();
    await first;
    await producer.live.get(RID);
    authedAxios.get.mockImplementation((url) => {
      const s = String(url);
      if (s.endsWith('/download')) {
        const fid = s.split('/api/files/')[1].replace(/\/download$/, '');
        return Promise.resolve({ data: Readable.from([Buffer.from('# T\n\nbody for ' + fid)]) });
      }
      return Promise.resolve(metaOf(s.split('/api/files/')[1]));
    });
    expect(second).toMatchObject({ code: 'CONVERSION_IN_FLIGHT', status: 409 });
    expect(metaGetsAfter).toBe(metaGetsBefore); // the loser paid NO pre-flight
  });

  it('a FAILED start writes the terminal record while the reservation is still held, then releases it', async () => {
    // The write-before-release ordering is the point of the failed-start
    // record: the producer's patch REPLACES the conversion object, so a
    // failed write landing after a concurrent start's own 'queued' record
    // would clobber it. The start fails in the STAMP stage here — the queued
    // patch before it succeeds, so the failed record can be written.
    mockDocs({ f1: 'alpha.md' });
    await mockDb.collection('okf_repositories').save({ _key: RID, repo_id: RID, name: 'Mine', domain: 'general' });
    const dbService = require('../shared-lib/db-connection-service');
    let failGetDb = false;
    let reservationHeldAtWrite = null;
    const programQueryImpl = mockDb.query.getMockImplementation();
    mockDb.query.mockImplementation(async (q, bind) => {
      const text = typeof q === 'string' ? q : q && q.query;
      const patch = bind && bind.patch;
      if (text && text.includes('UPDATE doc WITH { conversion') && patch) {
        if (patch.status === 'failed') {
          // The failed record is written while the repo must STILL be reserved.
          reservationHeldAtWrite = producer.live.has(RID);
        }
        if (patch.status === 'queued') {
          // The queued patch is the last stage before the stamping: arm the
          // failure so the stamp's own db connection rejects.
          failGetDb = true;
        }
      }
      return programQueryImpl(q, bind);
    });
    dbService.getConnection.mockImplementation(async () => {
      if (failGetDb) {
        failGetDb = false; // one-shot: only the stamp's connection fails
        throw new Error('db down');
      }
      return mockDb;
    });

    try {
      await expect(
        producer.startDocumentsConversion({ repo_id: RID, file_ids: ['f1'], requested_name: 'x' })
      ).rejects.toThrow(/db down/);

      // The terminal record: status, the counters the UI reads, and the
      // shape its sibling failure records carry.
      const patches = mockDb.query.mock.calls.map((c) => (c[1] && c[1].patch) || null).filter(Boolean);
      const failed = patches[patches.length - 1];
      expect(failed).toMatchObject({
        status: 'failed',
        code: 'CONVERSION_FAILED',
        files_done: 0,
        files_total: 1,
        per_file: []
      });
      expect(typeof failed.started_at).toBe('string');
      // The reservation was still held while that record was written.
      expect(reservationHeldAtWrite).toBe(true);
      // And it is released afterwards — the repo is free again.
      expect(producer.live.has(RID)).toBe(false);
      const fresh = await producer
        .startDocumentsConversion({ repo_id: RID, file_ids: ['f1'], requested_name: 'x' })
        .catch((err) => err);
      // The fresh start got PAST the guard — it fails in the stamp stage
      // again (the failure re-arms at its own queued patch), not with 409.
      expect(fresh && fresh.message).toMatch(/db down/);
    } finally {
      dbService.getConnection.mockImplementation(() => Promise.resolve(mockDb));
    }
  });

  it('a slot-acquire rejection releases the reservation instead of 409-locking the repo', async () => {
    // The slot acquire sits INSIDE the runner's try: a rejection there must
    // still release the reservation, or the repo stays 409-locked forever
    // and `await live.get(repo_id)` never settles. acquireSlot cannot reject
    // today — this pins the guard against a future acquire that can.
    mockDocs({ f1: 'alpha.md' });
    await mockDb.collection('okf_repositories').save({ _key: RID, repo_id: RID, name: 'Mine', domain: 'general' });
    const crawlConversion = require('../services/crawl-conversion-service');
    const releaseSpy = jest.spyOn(crawlConversion, 'releaseSlot');
    const acquireSpy = jest.spyOn(crawlConversion, 'acquireSlot').mockRejectedValueOnce(new Error('slot boom'));
    try {
      await expect(
        producer.startDocumentsConversion({ repo_id: RID, file_ids: ['f1'], requested_name: 'x' })
      ).resolves.toMatchObject({ status: 'queued' });
      const inFlight = producer.live.get(RID);
      if (inFlight) await inFlight.catch(() => {});
      expect(producer.live.has(RID)).toBe(false);
      expect(releaseSpy).not.toHaveBeenCalled(); // no slot was ever taken
    } finally {
      acquireSpy.mockRestore();
      releaseSpy.mockRestore();
    }
  });

  it('a CRAWL conversion in flight refuses a documents conversion for the same repo', async () => {
    // ONE conversion per repo, whichever path started it: the two paths write
    // the SAME repo.conversion record (the crawl merges its patch, the
    // producer replaces it), so running both on one repo leaves a record that
    // describes neither run.
    mockDocs({ f1: 'alpha.md' });
    await mockDb.collection('okf_repositories').save({ _key: RID, repo_id: RID, name: 'Mine', domain: 'general' });
    let parked = false;
    let stampStarted;
    const stamping = new Promise((resolve) => {
      stampStarted = resolve;
    });
    let releaseStamp;
    const held = new Promise((resolve) => {
      releaseStamp = resolve;
    });
    const realGet = authedAxios.get.getMockImplementation();
    authedAxios.get.mockImplementation(async (url, opts) => {
      // The crawl's provenance stamp is the FIRST metadata GET; park it so
      // the crawl conversion stays in flight.
      if (!parked && !String(url).endsWith('/download')) {
        parked = true;
        stampStarted();
        await held;
      }
      return realGet(url, opts);
    });

    const crawl = require('../services/crawl-conversion-service');
    const crawlRun = crawl.startConversion({ repo_id: RID, file_id: 'f1', split_mode: 'B' });
    await stamping; // the crawl conversion is parked inside its provenance stamp
    const crawlInFlight = crawl.live.get(RID); // the conversion's completion promise
    const documents = await producer
      .startDocumentsConversion({ repo_id: RID, file_ids: ['f1'], requested_name: 'x' })
      .catch((err) => err);
    releaseStamp();
    await crawlRun;
    if (crawlInFlight) await crawlInFlight.catch(() => {});
    authedAxios.get.mockImplementation(realGet);
    expect(documents).toMatchObject({ code: 'CONVERSION_IN_FLIGHT', status: 409 });
  });

  it('a CSV whose topics leg degraded is RECORDED and MIRRORED to the file log', async () => {
    // The gate is closed (no VLLM_ENDPOINT): the topics leg degrades. The
    // import still lands, but the operator must SEE it — the conversion
    // report carries the fact and the file's ingestion log carries the
    // reason.
    delete process.env.VLLM_ENDPOINT;
    await mockDb.collection('okf_repositories').save({ _key: RID, repo_id: RID, name: 'Mine', domain: 'general' });
    authedAxios.get.mockImplementation((url) => {
      const s = String(url);
      if (s.endsWith('/download')) {
        return Promise.resolve({ data: Readable.from([Buffer.from('Region,Amount\nNorth,100\nSouth,200\n')]) });
      }
      const fid = s.split('/api/files/')[1];
      return Promise.resolve({
        data: { file: { file_id: fid, file_name: 'market.csv', size: 100, dataprep: { status: 'Pending' } } }
      });
    });

    await producer.startDocumentsConversion({
      repo_id: RID,
      file_ids: ['f1'],
      requested_name: 'x',
      classification: 'heuristics',
      actor: { sub: 's' }
    });
    await producer.live.get(RID);
    const repoDoc = await mockDb.collection('okf_repositories').document(RID);
    expect(repoDoc.conversion.status).toBe('done');

    const perFile = repoDoc.conversion.per_file;
    expect(perFile).toHaveLength(1);
    expect(perFile[0].status).toBe('imported'); // the import still lands
    expect(perFile[0].topics_source).toBe('fallback-no-endpoint');
    expect(perFile[0].warning).toMatch(/no LLM engine is configured/);

    const mirror = authedAxios.post.mock.calls.find((c) => String(c[0]).endsWith('/api/files/f1/ingestion-log'));
    expect(mirror).toBeTruthy();
    expect(mirror[1].level).toBe('WARN');
    expect(mirror[1].message).toMatch(/no LLM engine is configured/);
  });

  it('B1/B5: terminal summary.created counts CONTENT topics only — the index concept is excluded', async () => {
    // The ingest mock returns the REAL summary shape here (the file-level
    // mock above returns {ok,count}, which silently kept the accumulator at
    // zero — the verifier's blind-mock finding). Two single-H1 files → one
    // flush of 2 content concepts (created:2) + ONE index call (created:1)
    // that must NOT fold in.
    ingestRepoConcepts.mockImplementation(async (repo_id, payload) => ({
      ok: true,
      created: payload.concepts.length,
      updated: 0,
      skipped_dedup: 0
    }));
    mockDocs({ f1: 'alpha.md', f2: 'beta.md' });
    await mockDb.collection('okf_repositories').save({ _key: RID, repo_id: RID, name: 'Mine', domain: 'general' });
    await producer.startDocumentsConversion({
      repo_id: RID,
      file_ids: ['f1', 'f2'],
      requested_name: 'x',
      classification: 'heuristics',
      actor: { sub: 's' }
    });
    await producer.live.get(RID);
    const repoDoc = await mockDb.collection('okf_repositories').document(RID);
    expect(repoDoc.conversion.status).toBe('done');
    // 2 content topics — NOT 3 (the folded index once over-counted by 1).
    expect(repoDoc.conversion.summary.created).toBe(2);
    expect(repoDoc.conversion.summary.updated).toBe(0);
    expect(ingestRepoConcepts).toHaveBeenCalledTimes(2); // flush + index
  });

  it('409s the SAME CONTENT (file_hash) already backing a LIVE other repository', async () => {
    await mockDb.collection('okf_repositories').save({
      _key: 'r-other',
      repo_id: 'r-other',
      name: 'Other repo',
      domain: 'general',
      created_at: '2026-09-14T00:00:01Z',
      source_documents: [{ kind: 'document', file_id: 'old-1', file_name: 'alpha.md', file_hash: 'HASH1' }]
    });
    await mockDb.collection('okf_repositories').save({ _key: RID, repo_id: RID, name: 'Mine', domain: 'general' });
    mockDocs({ f1: 'alpha.md' });
    authedAxios.get.mockImplementationOnce((url) => {
      const fid = String(url).split('/api/files/')[1];
      return Promise.resolve({
        data: {
          file: { file_id: fid, file_name: 'alpha.md', file_hash: 'HASH1', dataprep: { status: 'Pending' } }
        }
      });
    });
    await expect(
      producer.startDocumentsConversion({ repo_id: RID, file_ids: ['f1'], requested_name: 'x' })
    ).rejects.toMatchObject({ code: 'DUPLICATE_CONTENT', status: 409 });
  });

  it('refuses a CONCURRENT import of the same content into a DIFFERENT repository (#1744)', async () => {
    // The DUPLICATE_CONTENT gate READS the other repositories' stamped
    // sources, and this run's own stamp lands LATER — so two concurrent runs
    // into two different repositories both read the pre-stamp state, both
    // passed the gate, and the same content landed in two live repositories.
    // The content claim is what closes that window: the first import is
    // parked inside its stamping (its claim is still held), so the second
    // run is refused BEFORE it writes anything.
    const RID2 = '88888888-8888-4888-8888-888888888888';
    await mockDb.collection('okf_repositories').save({ _key: RID, repo_id: RID, name: 'Mine', domain: 'general' });
    await mockDb.collection('okf_repositories').save({ _key: RID2, repo_id: RID2, name: 'Other', domain: 'social' });
    const metaOf = (fid) => ({
      data: {
        file: {
          file_id: fid,
          file_name: 'alpha.md',
          size: 100,
          file_hash: 'HASH-CONCURRENT-1',
          dataprep: { status: 'Pending' }
        }
      }
    });
    authedAxios.get.mockImplementation((url) => {
      const s = String(url);
      if (s.endsWith('/download')) {
        const fid = s.split('/api/files/')[1].replace(/\/download$/, '');
        return Promise.resolve({ data: Readable.from([Buffer.from('# T\n\nbody for ' + fid)]) });
      }
      return Promise.resolve(metaOf(s.split('/api/files/')[1]));
    });
    let parked = false;
    let stampStarted;
    const stamping = new Promise((resolve) => {
      stampStarted = resolve;
    });
    let releaseStamp;
    const held = new Promise((resolve) => {
      releaseStamp = resolve;
    });
    authedAxios.patch.mockImplementation(async () => {
      if (!parked) {
        parked = true;
        stampStarted();
        await held;
      }
      return { status: 200 };
    });

    const first = producer.startDocumentsConversion({ repo_id: RID, file_ids: ['f1'], requested_name: 'x' });
    await stamping; // the first import is parked inside its stamping stage — its claim is held
    const second = await producer
      .startDocumentsConversion({ repo_id: RID2, file_ids: ['f1'], requested_name: 'y' })
      .catch((err) => err);
    releaseStamp();
    await first;
    await producer.live.get(RID);
    authedAxios.patch.mockImplementation(async () => ({ status: 200 }));

    expect(second).toMatchObject({ code: 'DUPLICATE_CONTENT_IN_FLIGHT', status: 409 });
    // The loser wrote NOTHING: no source stamp. Its conversion record is
    // closed as failed — the run was refused, and the record says why.
    const loser = await mockDb.collection('okf_repositories').document(RID2);
    expect(loser.source_documents).toBeUndefined();
    expect(loser.conversion).toMatchObject({ status: 'failed', code: 'DUPLICATE_CONTENT_IN_FLIGHT' });
    // The winner kept its content.
    const winner = await mockDb.collection('okf_repositories').document(RID);
    expect(winner.source_documents).toHaveLength(1);
    expect(winner.source_documents[0].file_hash).toBe('HASH-CONCURRENT-1');
  });

  it('releases the content claim when a start fails — the next import of the same content is not refused', async () => {
    // The claim is the CONCURRENT-window guard: once the run is over it must
    // not keep the content spoken for. Here the run fails in the duplicate
    // query — before any durable record is written — so nothing else holds
    // the content: the next import into another repository must proceed.
    const RID2 = '88888888-8888-4888-8888-888888888888';
    await mockDb.collection('okf_repositories').save({ _key: RID, repo_id: RID, name: 'Mine', domain: 'general' });
    await mockDb.collection('okf_repositories').save({ _key: RID2, repo_id: RID2, name: 'Other', domain: 'social' });
    const metaOf = (fid) => ({
      data: {
        file: {
          file_id: fid,
          file_name: 'alpha.md',
          size: 100,
          file_hash: 'HASH-RELEASE-1',
          dataprep: { status: 'Pending' }
        }
      }
    });
    authedAxios.get.mockImplementation((url) => {
      const s = String(url);
      if (s.endsWith('/download')) {
        const fid = s.split('/api/files/')[1].replace(/\/download$/, '');
        return Promise.resolve({ data: Readable.from([Buffer.from('# T\n\nbody for ' + fid)]) });
      }
      return Promise.resolve(metaOf(s.split('/api/files/')[1]));
    });
    const programImpl = mockDb.query.getMockImplementation();
    let failOnce = true;
    mockDb.query.mockImplementation(async (q, bind) => {
      const text = typeof q === 'string' ? q : q && q.query;
      if (failOnce && text && text.includes('POSITION(@hashes')) {
        failOnce = false;
        throw new Error('db down');
      }
      return programImpl(q, bind);
    });

    await expect(
      producer.startDocumentsConversion({ repo_id: RID, file_ids: ['f1'], requested_name: 'x' })
    ).rejects.toThrow(/db down/);
    // The claim is gone: the same content imports into another repository.
    const second = await producer.startDocumentsConversion({
      repo_id: RID2,
      file_ids: ['f1'],
      requested_name: 'y'
    });
    expect(second).toMatchObject({ status: 'queued' });
    await producer.live.get(RID2);
    const repo2 = await mockDb.collection('okf_repositories').document(RID2);
    expect(repo2.source_documents).toHaveLength(1);
  });

  it('fails the start when the durable source_documents record cannot be written', async () => {
    // The source_documents list IS what the DUPLICATE_CONTENT gate reads: if
    // it cannot be written, the repository does not own its sources as far as
    // every other guard is concerned — so the import must not report success.
    await mockDb.collection('okf_repositories').save({ _key: RID, repo_id: RID, name: 'Mine', domain: 'general' });
    mockDocs({ f1: 'alpha.md' });
    const programImpl = mockDb.query.getMockImplementation();
    let failed = false;
    mockDb.query.mockImplementation(async (q, bind) => {
      const text = typeof q === 'string' ? q : q && q.query;
      if (!failed && text && text.includes('source_documents') && !text.includes('POSITION(@hashes')) {
        failed = true;
        throw new Error('db down');
      }
      return programImpl(q, bind);
    });

    await expect(
      producer.startDocumentsConversion({ repo_id: RID, file_ids: ['f1'], requested_name: 'x' })
    ).rejects.toMatchObject({ code: 'SOURCE_STAMP_FAILED' });
    const repo = await mockDb.collection('okf_repositories').document(RID);
    expect(repo.source_documents).toBeUndefined();
    expect(repo.conversion).toMatchObject({ status: 'failed', code: 'SOURCE_STAMP_FAILED' });
    // Nothing was stamped outside either: the durable record is written
    // FIRST, so a failed write leaves the files owned by nobody — a
    // half-stamped repository would be invisible to the duplicate gate.
    const stamps = authedAxios.patch.mock.calls.filter((c) => String(c[0]).includes('/api/files/'));
    expect(stamps).toHaveLength(0);
  });

  it('a refused start leaves a healthy repository conversion record untouched', async () => {
    // The conversion patch REPLACES the whole record, so a refused import
    // must not overwrite a healthy 'done': the web client renders a failed
    // record as "import failed — delete the repository", which would be a lie
    // about a healthy repository.
    await mockDb.collection('okf_repositories').save({
      _key: RID,
      repo_id: RID,
      name: 'Mine',
      domain: 'general',
      conversion: { status: 'done', stage: 'done', files_done: 1, files_total: 1, summary: { created: 1 } }
    });
    mockDocs({ f1: 'alpha.md' });
    authedAxios.get.mockImplementation((url) => {
      const s = String(url);
      if (s.endsWith('/download')) {
        const fid = s.split('/api/files/')[1].replace(/\/download$/, '');
        return Promise.resolve({ data: Readable.from([Buffer.from('# T\n\nbody for ' + fid)]) });
      }
      return Promise.resolve({
        data: {
          file: {
            file_id: s.split('/api/files/')[1],
            file_name: 'alpha.md',
            file_hash: 'HASH-HEALTHY-1',
            dataprep: { status: 'Pending' }
          }
        }
      });
    });
    const programImpl = mockDb.query.getMockImplementation();
    let failOnce = true;
    mockDb.query.mockImplementation(async (q, bind) => {
      const text = typeof q === 'string' ? q : q && q.query;
      if (failOnce && text && text.includes('POSITION(@hashes')) {
        failOnce = false;
        throw new Error('db down');
      }
      return programImpl(q, bind);
    });

    await expect(
      producer.startDocumentsConversion({ repo_id: RID, file_ids: ['f1'], requested_name: 'x' })
    ).rejects.toThrow(/db down/);
    const repo = await mockDb.collection('okf_repositories').document(RID);
    expect(repo.conversion).toMatchObject({ status: 'done', summary: { created: 1 } });
  });

  it('allows re-importing the same content into the SAME repository (idempotent)', async () => {
    await mockDb.collection('okf_repositories').save({
      _key: RID,
      repo_id: RID,
      name: 'Mine',
      domain: 'general',
      source_documents: [{ kind: 'document', file_id: 'f1', file_name: 'alpha.md', file_hash: 'HASH-SELF' }]
    });
    mockDocs({ f1: 'alpha.md' });
    authedAxios.get.mockImplementation((url) => {
      const s = String(url);
      if (s.endsWith('/download')) {
        const fid = s.split('/api/files/')[1].replace(/\/download$/, '');
        return Promise.resolve({ data: Readable.from([Buffer.from('# T\n\nbody for ' + fid)]) });
      }
      const fid = s.split('/api/files/')[1];
      return Promise.resolve({
        data: {
          file: { file_id: fid, file_name: 'alpha.md', file_hash: 'HASH-SELF', dataprep: { status: 'Pending' } }
        }
      });
    });
    await producer.startDocumentsConversion({
      repo_id: RID,
      file_ids: ['f1'],
      requested_name: 'x',
      classification: 'heuristics',
      actor: { sub: 's' }
    });
    await producer.live.get(RID);
    const repoDoc = await mockDb.collection('okf_repositories').document(RID);
    expect(repoDoc.conversion.status).toBe('done');
  });

  it('imports a .csv as FR-42 dictionary + row-groups (NOT the raw-text fallback)', async () => {
    // The dispatch has THREE csv-relevant seams ~290 lines apart: the
    // convertDocument branch, the hard-coded allowlist that throws
    // DOC_FORMAT_UNSUPPORTED BEFORE dispatch, and the {concepts} result
    // routing. Miss any one and a CSV either loud-rejects or lands as one
    // comma-dense prose blob — both look "handled" in a code read.
    const csv = 'Region,Amount,Note\nNorth,100,"a, b"\nSouth,200,"say ""hi"""\n';
    const buf = Buffer.from(csv, 'utf8');
    authedAxios.get.mockImplementation((url) => {
      const s = String(url);
      if (s.endsWith('/download')) return Promise.resolve({ data: Readable.from([buf]) });
      return Promise.resolve({
        data: { file: { file_id: 'fc', file_name: 'market.csv', file_type: 'text/csv', size: buf.length } }
      });
    });
    await mockDb.collection('okf_repositories').save({ _key: RID, repo_id: RID, name: 'Imported', domain: 'general' });
    await producer.startDocumentsConversion({
      repo_id: RID,
      file_ids: ['fc'],
      requested_name: 'Imported',
      classification: 'heuristics',
      actor: { sub: 'steward' }
    });
    await producer.live.get(RID);

    const allConcepts = ingestRepoConcepts.mock.calls.flatMap((c) => c[1].concepts);
    const dict = allConcepts.find((c) => c.path === 'market-dictionary.md');
    const rows = allConcepts.find((c) => c.path === 'market-rows.md');
    expect(dict).toBeTruthy();
    expect(rows).toBeTruthy();
    expect(dict.frontmatter.type).toBe('data-dictionary');
    expect(rows.frontmatter.links[0].to_concept_id).toBe('market-dictionary');
    // Quoted delimiter survived into the markdown table.
    expect(rows.body).toContain('a, b');
    expect(rows.body).toContain('say "hi"');
    // NOT the fallback: a fallback blob would be ONE concept named market.md.
    expect(allConcepts.some((c) => c.path === 'market.md')).toBe(false);
  });

  it('loud-rejects an unreadable .csv per-file without aborting the batch', async () => {
    // Binary content: SheetJS would otherwise "parse" it into a garbage
    // one-column table and report an empty import.
    const junk = Buffer.from([0, 1, 2, 0, 255, 254, 0, 0]);
    authedAxios.get.mockImplementation((url) => {
      const s = String(url);
      if (s.endsWith('/download')) return Promise.resolve({ data: Readable.from([junk]) });
      return Promise.resolve({
        data: { file: { file_id: 'fc', file_name: 'broken.csv', file_type: 'text/csv', size: junk.length } }
      });
    });
    await mockDb.collection('okf_repositories').save({ _key: RID, repo_id: RID, name: 'Imported', domain: 'general' });
    await producer.startDocumentsConversion({
      repo_id: RID,
      file_ids: ['fc'],
      requested_name: 'Imported',
      classification: 'heuristics',
      actor: { sub: 'steward' }
    });
    await producer.live.get(RID);
    const repoDoc = await mockDb.collection('okf_repositories').document(RID);
    const perFile = repoDoc.conversion.per_file;
    expect(perFile[0]).toMatchObject({ status: 'failed', code: 'CSV_UNREADABLE' });
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
    // #1651: born-right — every index sources entry carries its doc-repo
    // resource URL (resource-less entries were flagged by conformance and
    // unfixable in the autocorrect sheet).
    expect(index.frontmatter.sources).toHaveLength(2);
    expect(index.frontmatter.sources[0]).toMatchObject({
      kind: 'document',
      file_id: 'f1',
      resource: 'http://document-repository:3001/api/files/f1'
    });
    expect(index.frontmatter.sources[1]).toMatchObject({
      kind: 'document',
      file_id: 'f2',
      resource: 'http://document-repository:3001/api/files/f2'
    });
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
      // D4: the restriction snapshot rides the same PATCH (unrestricted here)
      { okf_repo_id: RID, okf_restricted: false },
      expect.anything()
    );
  });

  // Story 1-8g-q (2026-10-11): a stamp failure is per-file and non-fatal, but a
  // 100% failure rate means the "already in an OKF repo" guard is silently
  // DISABLED for the whole repository — which is exactly how a 41/41 stamp
  // failure went unnoticed. One aggregated ERROR, not 41 WARNs.
  it('reports a TOTAL stamp failure as one error (a 100% rate disables the duplicate guard)', async () => {
    logger.error.mockClear();
    logger.warn.mockClear();
    authedAxios.patch.mockRejectedValue(new Error('403 FORBIDDEN'));
    await producer.startDocumentsConversion({ repo_id: RID, file_ids: ['f1', 'f2'], actor: 'tester' });
    await new Promise((r) => setTimeout(r, 50));
    const totals = logger.error.mock.calls.filter((c) => String(c[0]).includes('okf_repo_id stamp:'));
    expect(totals).toHaveLength(1);
    expect(String(totals[0][0])).toContain('2/2');
    expect(totals[0][1]).toMatchObject({ stamp_failures: 2, files: 2 });
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

  // ── W8 gate downgrade (EPIC-8 slice 2): a hand-deleted source is not a
  // permanent block. The steward who deletes the source doc in doc-repo can
  // never satisfy Story 7.7's "retract them first" — there is nothing left to
  // retract. A 404 says the file CANNOT serve anything; only a real outage
  // (non-404) still fails closed, because "doc-repo can't tell us" is not
  // evidence the content is gone.
  it('W8: a hand-DELETED source (404) is skipped — the gate passes with a warn', async () => {
    const notFound = Object.assign(new Error('Request failed with status code 404'), {
      response: { status: 404 }
    });
    authedAxios.get.mockRejectedValueOnce(notFound);
    const blocker = await lifecycle.sourcesBusyBlocker(
      repo([{ kind: 'document', file_id: 'hand-deleted', file_name: 'deleted.pdf' }])
    );
    expect(blocker).toBeNull();
    // The visible log line — a steward must be able to see WHY ingest
    // suddenly works when a source vanished.
    const warnCalls = logger.warn.mock.calls.map((c) => String(c[0]));
    expect(warnCalls.some((m) => m.includes('hand-deleted') && m.includes('no longer exists'))).toBe(true);
  });

  it('W8: a deleted source skips only itself — a live Ingested sibling still blocks', async () => {
    authedAxios.get.mockImplementation((url) => {
      if (String(url).includes('hand-deleted')) {
        return Promise.reject(Object.assign(new Error('404'), { response: { status: 404 } }));
      }
      return Promise.resolve({
        data: { file: { file_name: 'live.pdf', dataprep: { status: 'Ingested' } } }
      });
    });
    const blocker = await lifecycle.sourcesBusyBlocker(
      repo([
        { kind: 'document', file_id: 'hand-deleted', file_name: 'deleted.pdf' },
        { kind: 'document', file_id: 'f-live', file_name: 'live.pdf' }
      ])
    );
    expect(blocker.code).toBe('SOURCES_NOT_RETRACTED');
    expect(blocker.message).toContain('live.pdf');
    expect(blocker.message).not.toContain('deleted.pdf');
  });

  it('W8: a NON-404 re-check error still fails closed (the downgrade is 404-only)', async () => {
    authedAxios.get.mockRejectedValueOnce(Object.assign(new Error('boom'), { response: { status: 500 } }));
    const failClosed = await lifecycle.sourcesBusyBlocker(
      repo([{ kind: 'document', file_id: 'f-500', file_name: 'x.pdf' }])
    );
    expect(failClosed.code).toBe('SOURCES_NOT_RETRACTED');
  });
});

describe('doc-repo-client — fetchDocMeta (the ONE doc-repo metadata fetch + envelope unwrap)', () => {
  // The fetch + the unwrap are shared by the importer, the crawl stamper and
  // the SOURCES-BUSY gate — a diverging copy that handled only {file} | {data}
  // silently degraded the {data: {file}} shape to id-only stamping (review
  // 2026-10-29). Pin all three shipped shapes through the SINGLE
  // implementation (issue #1686).
  const file = { file_id: 'f-1', file_name: 'a.pdf', dataprep: { status: 'Ingested' } };

  test.each([
    ['{file}', { data: { file } }],
    ['{data: {file}}', { data: { data: { file } } }],
    ['{data}', { data: { data: file } }]
  ])('unwraps the %s envelope to the file doc', async (_shape, res) => {
    authedAxios.get.mockResolvedValueOnce(res);
    await expect(docRepoClient.fetchDocMeta('f-1')).resolves.toBe(file);
  });

  test('degrades to {} on an empty response (never throws)', async () => {
    authedAxios.get.mockResolvedValueOnce({});
    await expect(docRepoClient.fetchDocMeta('f-1')).resolves.toEqual({});
  });
});

// ── the import metadata cache (#1685) ───────────────────────────────────────

describe('producer-service — the source metadata cache (stampSources)', () => {
  // Distinct repo id: this file's mock store has no per-test reset, so a
  // shared id would leak acl/source_documents state across tests.
  const R3 = '88888888-8888-4888-8888-888888888803';
  it('a prototype-named file id resolves to NOTHING inherited — the doc-repo GET still fires', async () => {
    // A plain-object cache resolves 'constructor' to Object.prototype.constructor
    // — TRUTHY — so the GET fallback never fired and the file was stamped
    // with NULL metadata (issue #1685). The cache is null-prototype and read
    // with an own-property lookup.
    await mockDb.collection('okf_repositories').save({ repo_id: R3 });
    authedAxios.get.mockResolvedValueOnce({
      data: { file: { file_id: 'constructor', file_name: 'real.md', size: 12 } }
    });
    await producer.stampSources(R3, ['constructor']);
    expect(authedAxios.get).toHaveBeenCalledWith(expect.stringContaining('/api/files/constructor'), expect.anything());
    const repoDoc = await mockDb.collection('okf_repositories').document(R3);
    expect(repoDoc.source_documents[0].file_name).toBe('real.md');
  });
});

// ── D4 restricted-snapshot stamp + Access-toggle propagation (W4 story 2) ───

describe('producer-service — D4 restricted-snapshot stamp (stampSources)', () => {
  // Distinct repo ids: this file's mock store has NO per-test reset, so a
  // shared id would leak acl/source_documents state across tests (and the
  // corpus test above already owns RID's row).
  const R1 = '88888888-8888-4888-8888-888888888801';
  const R2 = '88888888-8888-4888-8888-888888888802';
  it('stamps okf_restricted=true beside okf_repo_id when the repo is restricted', async () => {
    await mockDb.collection('okf_repositories').save({ repo_id: R1, acl: { restricted: true } });
    authedAxios.get.mockResolvedValue({
      data: { file: { file_id: 'f1', file_name: 'a.md', size: 10, file_hash: 'h1' } }
    });
    await producer.stampSources(R1, ['f1']);
    expect(authedAxios.patch).toHaveBeenCalledWith(
      expect.stringContaining('/api/files/f1'),
      { okf_repo_id: R1, okf_restricted: true },
      expect.anything()
    );
  });

  it('stamps okf_restricted=false for an unrestricted repo', async () => {
    await mockDb.collection('okf_repositories').save({ repo_id: R2, acl: { restricted: false } });
    authedAxios.get.mockResolvedValue({ data: { file: { file_id: 'f1', file_name: 'a.md' } } });
    await producer.stampSources(R2, ['f1']);
    expect(authedAxios.patch).toHaveBeenCalledWith(
      expect.anything(),
      { okf_repo_id: R2, okf_restricted: false },
      expect.anything()
    );
  });

  it('an unreadable repo doc stamps unrestricted and does not throw', async () => {
    // no repo doc saved — document() rejects; the stamp must still land
    authedAxios.get.mockResolvedValue({ data: { file: { file_id: 'f1', file_name: 'a.md' } } });
    await expect(producer.stampSources(R2 + '-ghost', ['f1'])).resolves.toBeDefined();
    expect(authedAxios.patch).toHaveBeenCalledWith(
      expect.anything(),
      { okf_repo_id: R2 + '-ghost', okf_restricted: false },
      expect.anything()
    );
  });
});

describe('producer-service — D4 propagateRestrictedToSources (Access-toggle propagation)', () => {
  const P1 = '88888888-8888-4888-8888-888888888811';
  const P2 = '88888888-8888-4888-8888-888888888812';
  it('patches every source file and sorts outcomes into patched/gone/failed', async () => {
    await mockDb.collection('okf_repositories').save({
      repo_id: P1,
      source_documents: [
        { kind: 'document', file_id: 'a' },
        { kind: 'document', file_id: 'b' },
        { kind: 'document', file_id: 'c' }
      ]
    });
    authedAxios.patch.mockImplementation(async (url) => {
      if (!url.endsWith('/api/files/b')) return { status: 200 };
      const e = new Error('not found');
      e.response = { status: 404 }; // repo delete cascade already removed it
      throw e;
    });
    const out = await producer.propagateRestrictedToSources(P1, true);
    expect(out).toMatchObject({ repo_id: P1, restricted: true, patched: ['a', 'c'], gone: ['b'], total: 3 });
    expect(out.failed).toEqual([]);
  });

  it('a non-404 failure lands in failed[] and is logged, never thrown', async () => {
    await mockDb.collection('okf_repositories').save({
      repo_id: P2,
      source_documents: [{ kind: 'document', file_id: 'x' }]
    });
    authedAxios.patch.mockRejectedValue(new Error('doc-repo down'));
    const out = await producer.propagateRestrictedToSources(P2, true);
    expect(out.patched).toEqual([]);
    expect(out.failed).toEqual([{ file_id: 'x', error: 'doc-repo down' }]);
  });

  it('an unreadable repo doc propagates nothing and reports an empty set', async () => {
    const out = await producer.propagateRestrictedToSources(P2 + '-ghost', false);
    expect(out).toMatchObject({ patched: [], failed: [], gone: [], total: 0 });
    expect(authedAxios.patch).not.toHaveBeenCalled();
  });
});
