// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Unit tests for the server-side crawl->OKF conversion job (David, 2026-09-02).
// The service streams doc-repo's /api/files/:id/view response, splits pages on
// `## Source:` markers, sanitizes, batches (<=200 concepts / <=4 MiB) and
// ingests in-process. Mocks: dbService.getDb -> arango-mock, authedAxios ->
// fake streams, ingest-service and tracing. runConversion is driven through
// startConversion (background runner); tests await the terminal progress
// patch recorded on db.query.

jest.mock('../shared-lib/db-connection-service', () => {
  const { createMockDb } = require('./mocks/arango-mock');
  const mockDb = createMockDb();
  // The DEPLOYED shared-lib (root shared/lib) exposes getConnection(name),
  // not getDb — mock the real shape so an export drift can't pass tests.
  return { getConnection: jest.fn(async () => mockDb), __mockDb: mockDb };
});
jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));
jest.mock('../shared-lib/tracing', () => ({
  withSpan: jest.fn((_name, fn) => fn({ setAttribute: jest.fn() }))
}));
jest.mock('../services/service-token', () => ({
  authedAxios: { get: jest.fn() }
}));
jest.mock('../services/ingest-service', () => ({
  ingestRepoConcepts: jest.fn().mockResolvedValue({ accepted: 1, rejected: [] }),
  buildMegaConcept: jest.fn().mockReturnValue([])
}));

const { Readable } = require('stream');
const conv = require('../services/crawl-conversion-service');
const dbService = require('../shared-lib/db-connection-service');
const { authedAxios } = require('../services/service-token');
const ingestService = require('../services/ingest-service');

const mockDb = dbService.__mockDb;

// ---- helpers --------------------------------------------------------------

/** The latest progress patch (binds of the MERGE query), or undefined. */
function lastPatch() {
  const calls = mockDb.query.mock.calls;
  for (let i = calls.length - 1; i >= 0; i--) {
    const binds = calls[i][1];
    if (binds && binds.patch) return binds.patch;
  }
  return undefined;
}

/** All progress patches in call order (sweep queries have no .patch binds). */
function allPatches() {
  return mockDb.query.mock.calls.map((c) => c[1] && c[1].patch).filter(Boolean);
}

async function waitForTerminal(timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 8000);
  for (;;) {
    const patch = lastPatch();
    if (patch && (patch.status === 'done' || patch.status === 'failed')) return patch;
    if (Date.now() > deadline) {
      const statuses = JSON.stringify(allPatches().map((p) => p.status));
      throw new Error('conversion did not reach terminal state; statuses=' + statuses);
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** doc-repo metadata response consumed by stampSourceDocument. */
function queueMetadata() {
  authedAxios.get.mockResolvedValueOnce({
    status: 200,
    data: { file: { file_name: 'crawl.md', size: 96, file_type: 'md', uploaded_date: '2026-09-02T10:00:00Z' } }
  });
}

/** Program authedAxios.get: metadata (stampSourceDocument + size authority),
 * then the stream. metaSize overrides the metadata size. */
function mockSource(md, opts) {
  const o = opts || {};
  if (o.metaSize) {
    authedAxios.get.mockResolvedValueOnce({
      status: 200,
      data: { file: { file_name: 'crawl.md', size: o.metaSize } }
    });
  } else {
    queueMetadata();
  }
  const buf = Buffer.from(md, 'utf8');
  authedAxios.get.mockResolvedValueOnce({
    status: 200,
    headers: o.noLength ? {} : { 'content-length': String(o.bigLength || buf.length) },
    data: o.stream || Readable.from([buf])
  });
  return buf.length;
}

function startJob(overrides) {
  return conv.startConversion(
    Object.assign(
      {
        repo_id: 'r1',
        file_id: 'f1',
        url: 'https://crawl.example/seed',
        crawl_job_id: 'cj-1',
        split_mode: 'B',
        requested_name: 'my-crawl',
        actor: { sub: 'steward-1' }
      },
      overrides || {}
    )
  );
}

beforeEach(() => {
  mockDb._reset();
  authedAxios.get.mockReset();
  ingestService.ingestRepoConcepts.mockReset().mockResolvedValue({ accepted: 1, rejected: [] });
  ingestService.buildMegaConcept.mockReset().mockReturnValue([]);
});

// ---- pure helpers ----------------------------------------------------------

describe('sanitizeCrawlBody', () => {
  test('rewrites external images into plain links (editor CSP img-src)', () => {
    expect(conv.sanitizeCrawlBody('see ![diagram](https://x.example/d.png "t") now')).toBe(
      'see [diagram](https://x.example/d.png) now'
    );
  });

  test('uses "image" as link text when alt is empty', () => {
    expect(conv.sanitizeCrawlBody('![](https://x.example/i.png)')).toBe('[image](https://x.example/i.png)');
  });

  test('unwraps multi-line card links to head link + trailing text', () => {
    const out = conv.sanitizeCrawlBody('[\n  # Heading\n  Some text\n](https://x.example/y)');
    expect(out).toBe('[Heading](https://x.example/y)\n\nSome text');
  });

  test('leaves plain bodies (sans images) untouched', () => {
    const body = '# T\n\nnormal [text](https://x.example/a) stays';
    expect(conv.sanitizeCrawlBody(body)).toBe(body);
  });

  test('relative images also become links (no CSP gamble on unknown hosts)', () => {
    expect(conv.sanitizeCrawlBody('![img](/self.png)')).toBe('[img](/self.png)');
  });

  test('passthrough for falsy input', () => {
    expect(conv.sanitizeCrawlBody('')).toBe('');
    expect(conv.sanitizeCrawlBody(null)).toBeNull();
    expect(conv.sanitizeCrawlBody(undefined)).toBeUndefined();
  });
});

describe('maxSourceBytesFromEnv', () => {
  const OLD = process.env.OKF_MAX_CRAWL_SOURCE_MB;
  afterEach(() => {
    if (OLD === undefined) delete process.env.OKF_MAX_CRAWL_SOURCE_MB;
    else process.env.OKF_MAX_CRAWL_SOURCE_MB = OLD;
  });

  test('defaults to 10 GB when unset', () => {
    delete process.env.OKF_MAX_CRAWL_SOURCE_MB;
    expect(conv.maxSourceBytesFromEnv()).toBe(10240 * 1024 * 1024);
  });

  test('honors the MB override', () => {
    process.env.OKF_MAX_CRAWL_SOURCE_MB = '512';
    expect(conv.maxSourceBytesFromEnv()).toBe(512 * 1024 * 1024);
  });

  test('falls back to the default on invalid / non-positive values', () => {
    for (const v of ['', 'abc', '0', '-5']) {
      process.env.OKF_MAX_CRAWL_SOURCE_MB = v;
      expect(conv.maxSourceBytesFromEnv()).toBe(10240 * 1024 * 1024);
    }
  });

  test('exposes the mode-A single-payload guard (45 MB)', () => {
    expect(conv.MODE_A_SOURCE_LIMIT_BYTES).toBe(45 * 1024 * 1024);
  });
});

describe('isTerminal', () => {
  test('done and failed are terminal', () => {
    expect(conv.isTerminal({ status: 'done' })).toBe(true);
    expect(conv.isTerminal({ status: 'failed' })).toBe(true);
  });

  test('active states are not terminal; null-safe', () => {
    for (const s of ['queued', 'downloading', 'splitting', 'adding']) {
      expect(conv.isTerminal({ status: s })).toBe(false);
    }
    expect(conv.isTerminal(null)).toBe(false);
    expect(conv.isTerminal(undefined)).toBe(false);
  });
});

describe('startConversion validation', () => {
  test('requires repo_id and file_id', async () => {
    await expect(conv.startConversion({ file_id: 'f1', split_mode: 'B' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400
    });
  });

  test('rejects split_mode outside A|B', async () => {
    await expect(conv.startConversion({ repo_id: 'r1', file_id: 'f1', split_mode: 'Z' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400
    });
    await expect(conv.startConversion({ repo_id: 'r1', file_id: 'f1', split_mode: undefined })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400
    });
  });
});

describe('openSourceStream endpoint', () => {
  test('streams the RAW file from /api/files/:id/download (not the /view JSON+base64 envelope)', async () => {
    authedAxios.get.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-length': '0' },
      data: Readable.from([])
    });
    await startJob();
    await waitForTerminal();
    const url = authedAxios.get.mock.calls.find((c) => String(c[0]).includes('/download'));
    expect(url).toBeDefined();
    expect(String(url[0])).toContain('/api/files/f1/download');
  });
});

// ---- mode B: per-page streaming conversion ---------------------------------

describe('mode B — per-page streaming conversion', () => {
  const MD = [
    '## Source: https://a.example/one',
    '# One',
    '',
    'Body one with ![diagram](https://img.example/d.png) image.',
    '## Source: https://b.example/two',
    '',
    'No heading; card link:',
    '[\n  # Card\n  Card text\n](https://x.example/y)',
    '## Source: https://c.example/empty'
  ].join('\n');

  test('splits pages, sanitizes, ingests and writes the index LAST', async () => {
    mockSource(MD);
    await startJob();
    const terminal = await waitForTerminal();

    expect(terminal.status).toBe('done');
    expect(terminal.pages_done).toBe(2); // empty page skipped
    expect(terminal.batches_done).toBe(2); // pages batch + index batch

    // 2 page concepts, then the index concept as a separate final ingest.
    expect(ingestService.ingestRepoConcepts).toHaveBeenCalledTimes(2);
    const calls = ingestService.ingestRepoConcepts.mock.calls;
    const pages = calls[0][1].concepts;
    expect(calls[0][0]).toBe('r1');

    // Page 1: title from the # heading, provenance with crawl_job_id.
    expect(pages[0]).toMatchObject({
      path: 'a-example-one.md',
      frontmatter: {
        type: 'topic',
        title: 'One',
        sources: [{ kind: 'crawl', resource: 'https://a.example/one', file_id: 'f1', crawl_job_id: 'cj-1' }]
      }
    });
    expect(pages[0].body).toContain('[diagram](https://img.example/d.png)');
    expect(pages[0].body).not.toContain('![');

    // Page 2: no heading -> URL fallback title; card link unwrapped.
    expect(pages[1]).toMatchObject({
      path: 'b-example-two.md',
      frontmatter: {
        type: 'topic',
        title: 'https://b.example/two',
        sources: [{ kind: 'crawl', resource: 'https://b.example/two', file_id: 'f1', crawl_job_id: 'cj-1' }]
      }
    });
    expect(pages[1].body).toContain('[Card](https://x.example/y)');

    // Index concept: type index, links resolve per-path, ingested LAST.
    const index = calls[1][1].concepts;
    expect(calls[1][0]).toBe('r1');
    expect(index).toHaveLength(1);
    expect(index[0]).toMatchObject({
      path: 'index.md',
      frontmatter: { type: 'index', title: 'my-crawl' }
    });
    expect(index[0].body).toContain('[One](./a-example-one.md)');
    expect(index[0].body).toContain('[https://b.example/two](./b-example-two.md)');
    expect(index[0].frontmatter.sources).toEqual([{ kind: 'crawl', file_id: 'f1', crawl_job_id: 'cj-1' }]);
  });

  test('progress patches follow queued -> downloading -> splitting -> adding -> done', async () => {
    mockSource(MD);
    await startJob();
    const terminal = await waitForTerminal();

    const statuses = allPatches().map((p) => p.status);
    expect(statuses).toEqual(['queued', 'downloading', 'splitting', 'adding', 'done']);
    expect(terminal.finished_at).toEqual(expect.any(String));
    expect(terminal.bytes_done).toBeGreaterThan(0);
  });

  test('empty page (marker without body) is skipped and not linked in the index', async () => {
    const md = ['## Source: https://a.example/one', '# One', 'body', '## Source: https://c.example/empty'].join('\n');
    mockSource(md);
    await startJob();
    const terminal = await waitForTerminal();
    expect(terminal.status).toBe('done');
    expect(terminal.pages_done).toBe(1);
    const indexIngest = ingestService.ingestRepoConcepts.mock.calls[1];
    expect(indexIngest[1].concepts[0].body).toContain('(./a-example-one.md)');
    expect(indexIngest[1].concepts[0].body).not.toContain('c.example/empty');
  });

  test('flushes at the 200-concept cap (205 tiny pages -> 200 + 5 + index)', async () => {
    const lines = [];
    for (let i = 1; i <= 205; i++) {
      lines.push('## Source: https://p.example/' + i, '# Page ' + i, 'body ' + i);
    }
    mockSource(lines.join('\n'));
    await startJob();
    await waitForTerminal();

    const calls = ingestService.ingestRepoConcepts.mock.calls;
    expect(calls).toHaveLength(3); // 200 + 5 + index
    expect(calls[0][1].concepts).toHaveLength(200);
    expect(calls[1][1].concepts).toHaveLength(5);
    expect(calls[2][1].concepts).toHaveLength(1); // index only
    expect(calls[2][1].concepts[0].frontmatter.type).toBe('index');
  });

  test('frontmatter-like --- lines are stripped from page bodies', async () => {
    const md = [
      '## Source: https://a.example/one',
      '# One',
      'body',
      '---',
      '## Source: https://b.example/two',
      '# Two',
      'b2'
    ].join('\n');
    mockSource(md);
    await startJob();
    await waitForTerminal();
    const pages = ingestService.ingestRepoConcepts.mock.calls[0][1].concepts;
    expect(pages[0].body).not.toContain('---');
    expect(pages[0].body).toContain('body');
  });

  test('missing content-length: the metadata size becomes bytes_total', async () => {
    mockSource(MD, { noLength: true });
    await startJob();
    const terminal = await waitForTerminal();
    expect(terminal.status).toBe('done');
    expect(terminal.bytes_total).toBe(96); // queueMetadata size
    // bytes_done is the EXACT byte count written to the temp file.
    expect(terminal.bytes_done).toBe(Buffer.byteLength(MD, 'utf8'));
  });

  test('source over the OKF_MAX_CRAWL_SOURCE_MB cap fails BEFORE ingest', async () => {
    // 11 GB declared -> over the 10 GB default cap. Stream never consumed.
    mockSource('', { metaSize: 11 * 1024 ** 3, stream: Readable.from([]) });
    await startJob();
    const terminal = await waitForTerminal();

    expect(terminal.status).toBe('failed');
    expect(terminal.code).toBe('CRAWL_SOURCE_TOO_LARGE');
    expect(terminal.error).toContain('OKF_MAX_CRAWL_SOURCE_MB');
    expect(ingestService.ingestRepoConcepts).not.toHaveBeenCalled();
  });

  test('ingest failure mid-run marks the conversion failed with the error', async () => {
    mockSource(MD);
    ingestService.ingestRepoConcepts.mockRejectedValueOnce(new Error('dataprep 502'));
    await startJob();
    const terminal = await waitForTerminal();

    expect(terminal.status).toBe('failed');
    expect(terminal.error).toContain('dataprep 502');
    expect(terminal.code).toBe('CONVERSION_FAILED');
  });
});

// ---- mode A: single mega-concept conversion ---------------------------------

describe('mode A — whole-crawl mega concept', () => {
  const MD = '## Source: https://a.example/one\n# One\nbody one\n\n## Source: https://b.example/two\n# Two\nbody two';

  test('buffers the file, ingests the mega concept then the index', async () => {
    mockSource(MD);
    ingestService.buildMegaConcept.mockReturnValueOnce([
      { path: 'crawl-all.md', frontmatter: { type: 'topic', title: 'Mega' }, body: 'mega body' }
    ]);

    await startJob({ split_mode: 'A' });
    const terminal = await waitForTerminal();
    expect(terminal.status).toBe('done');
    expect(ingestService.buildMegaConcept).toHaveBeenCalledWith(MD, 'f1');
    expect(ingestService.ingestRepoConcepts).toHaveBeenCalledTimes(2);

    const calls = ingestService.ingestRepoConcepts.mock.calls;
    expect(calls[0][1].concepts).toHaveLength(1);
    expect(calls[0][1].concepts[0].path).toBe('crawl-all.md');
    // Index links the mega concept by its title (falls back to the path stem).
    expect(calls[1][1].concepts[0].path).toBe('index.md');
    expect(calls[1][1].concepts[0].body).toContain('[Mega](./crawl-all.md)');
  });

  test('empty mega concept -> done with zero ingests (no index either)', async () => {
    mockSource(MD);
    await startJob({ split_mode: 'A' });
    const terminal = await waitForTerminal();

    expect(terminal.status).toBe('done');
    expect(terminal.pages_done).toBe(0);
    expect(ingestService.ingestRepoConcepts).not.toHaveBeenCalled();
  });

  test('source over the mode-A 45 MB body limit fails with MODE_A_TOO_LARGE', async () => {
    mockSource('', { metaSize: 46 * 1024 * 1024, stream: Readable.from([]) });
    await startJob({ split_mode: 'A' });
    const terminal = await waitForTerminal();

    expect(terminal.status).toBe('failed');
    expect(terminal.code).toBe('MODE_A_TOO_LARGE');
    expect(terminal.error).toContain('One concept per page');
    expect(ingestService.ingestRepoConcepts).not.toHaveBeenCalled();
  });
});

// ---- source_document stamping (merged from the Studio-Tab context) ----------

describe('stampSourceDocument via startConversion', () => {
  test('stamps file metadata onto the repo doc', async () => {
    queueMetadata();
    authedAxios.get.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-length': '0' },
      data: Readable.from([])
    });
    await startJob({ url: null, crawl_job_id: null });
    await waitForTerminal();

    const stamp = mockDb.query.mock.calls
      .map((c) => (c[1] && c[1].file_id ? c[1] : null))
      .filter(Boolean)
      .find((b) => b.file_name === 'crawl.md');
    expect(stamp).toMatchObject({
      repo_id: 'r1',
      file_id: 'f1',
      file_name: 'crawl.md',
      size_bytes: 96,
      file_type: 'md',
      uploaded_date: '2026-09-02T10:00:00Z'
    });
  });

  test('metadata fetch failure does not fail the conversion (fail-soft)', async () => {
    // Rejection FIRST: it is consumed by the stamp's metadata fetch, which is
    // fail-soft; the stream get that follows still succeeds.
    authedAxios.get.mockRejectedValueOnce(new Error('doc-repo 500'));
    authedAxios.get.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-length': '0' },
      data: Readable.from([])
    });
    await startJob();
    const terminal = await waitForTerminal();
    expect(terminal.status).toBe('done');
  });
});

// ---- size authority: metadata size beats missing content-length -------------

describe('size authority (metadata size > missing content-length)', () => {
  test('bytes_total + cap use the doc-repo metadata size when /download sends no length', async () => {
    // Metadata says 96 bytes; stream sends NO content-length.
    queueMetadata();
    authedAxios.get.mockResolvedValueOnce({
      status: 200,
      headers: {},
      data: Readable.from(['## Source: https://a.example/one\n# One\nbody'])
    });
    await startJob();
    const terminal = await waitForTerminal();
    expect(terminal.status).toBe('done');
    expect(terminal.bytes_total).toBe(96);
  });

  test('cap fires from the metadata size even without content-length', async () => {
    // Metadata claims 11 GB; the stream offers no content-length at all.
    authedAxios.get
      .mockResolvedValueOnce({ status: 200, data: { file: { file_name: 'big.md', size: 11 * 1024 ** 3 } } })
      .mockResolvedValueOnce({ status: 200, headers: {}, data: Readable.from([]) });
    await startJob();
    const terminal = await waitForTerminal();
    expect(terminal.status).toBe('failed');
    expect(terminal.code).toBe('CRAWL_SOURCE_TOO_LARGE');
    expect(ingestService.ingestRepoConcepts).not.toHaveBeenCalled();
  });
});

// ---- cross-linking: intra-crawl links become concept-relative links ---------

describe('cross-linking (intra-crawl links -> concept-relative)', () => {
  test('links to other crawled pages become ./path.md; out-of-crawl stay absolute', async () => {
    const md = [
      '## Source: https://a.example/one',
      '# One',
      'See [Two](https://b.example/two) and [ext](https://outside.example/x).',
      '## Source: https://b.example/two',
      '# Two',
      'Back to [One](https://a.example/one).'
    ].join('\n');
    mockSource(md);
    await startJob();
    const terminal = await waitForTerminal();

    expect(terminal.status).toBe('done');
    const pages = ingestService.ingestRepoConcepts.mock.calls[0][1].concepts;
    // Forward link (page 1 -> page 2) resolved from the complete map.
    expect(pages[0].body).toContain('[Two](./b-example-two.md)');
    expect(pages[0].body).not.toContain('https://b.example/two');
    // Out-of-crawl links stay absolute.
    expect(pages[0].body).toContain('[ext](https://outside.example/x)');
    // Back link (page 2 -> page 1) resolved the same way.
    expect(pages[1].body).toContain('[One](./a-example-one.md)');
  });

  test('url normalization: www./fragment/trailing-slash variants still resolve', async () => {
    const md = [
      '## Source: https://a.example/one',
      '# One',
      'Link with noise: [Two](https://www.b.example/two/#section).',
      '## Source: https://b.example/two',
      '# Two',
      'body'
    ].join('\n');
    mockSource(md);
    await startJob();
    const terminal = await waitForTerminal();
    expect(terminal.status).toBe('done');
    const pages = ingestService.ingestRepoConcepts.mock.calls[0][1].concepts;
    expect(pages[0].body).toContain('[Two](./b-example-two.md)');
  });

  test('image link to a crawled page: cross-link wins over the image rewrite', async () => {
    const md = [
      '## Source: https://a.example/one',
      '# One',
      '![Two](https://b.example/two)',
      '## Source: https://b.example/two',
      '# Two',
      'body'
    ].join('\n');
    mockSource(md);
    await startJob();
    await waitForTerminal();
    const pages = ingestService.ingestRepoConcepts.mock.calls[0][1].concepts;
    // rewriteCrossLinks runs first (in-crawl target wins), then
    // sanitizeCrawlBody converts the image into a plain page link.
    expect(pages[0].body).toContain('[Two](./b-example-two.md)');
  });
});
