// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Regression tests for the 2026-09-08 wikipedia crawl-import audit fixes:
// title-attribute link resolution, classification passthrough, and the
// curation-once-per-conversion restructure. Evidence in
// data/okf/smoke-test/IMPORT-FINDINGS-2026-09-08.md.

jest.mock('../shared-lib/db-connection-service', () => {
  const { createMockDb } = require('./mocks/arango-mock');
  const mockDb = createMockDb();
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
  buildMegaConcept: jest.fn().mockReturnValue([]),
  runImportCuration: jest
    .fn()
    .mockResolvedValue({ method: 'x', total: 0, curated: 0, labeled: 0, described: 0, typed: 0, fallbacks: 0 })
}));

const { Readable } = require('stream');
const conv = require('../services/crawl-conversion-service');
const dbService = require('../shared-lib/db-connection-service');
const { authedAxios } = require('../services/service-token');
const ingestService = require('../services/ingest-service');
const mockDb = dbService.__mockDb;

function lastPatch() {
  const calls = mockDb.query.mock.calls;
  for (let i = calls.length - 1; i >= 0; i--) {
    const binds = calls[i][1];
    if (binds && binds.patch) return binds.patch;
  }
  return undefined;
}

function allPatches() {
  return mockDb.query.mock.calls.map((c) => c[1] && c[1].patch).filter(Boolean);
}

async function waitForTerminal(timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 8000);
  for (;;) {
    const patch = lastPatch();
    if (patch && (patch.status === 'done' || patch.status === 'failed')) {
      if (patch.status === 'failed')
        throw new Error('conversion failed: ' + (patch.error || '?') + ' code=' + (patch.code || '-'));
      return patch;
    }
    if (Date.now() > deadline) throw new Error('conversion did not reach terminal state');
    await new Promise((r) => setTimeout(r, 5));
  }
}

function queueMetadata() {
  authedAxios.get.mockResolvedValueOnce({
    status: 200,
    data: { file: { file_name: 'crawl.md', size: 96 } }
  });
}

function mockSource(md) {
  queueMetadata();
  const buf = Buffer.from(md, 'utf8');
  authedAxios.get.mockResolvedValueOnce({
    status: 200,
    headers: { 'content-length': String(buf.length) },
    data: Readable.from([buf])
  });
}

function startJob(overrides) {
  return conv.startConversion(
    Object.assign(
      { repo_id: 'r1', file_id: 'f1', split_mode: 'B', requested_name: 'my-crawl', actor: { sub: 's1' } },
      overrides || {}
    )
  );
}

beforeEach(async () => {
  // Drain in-flight background conversions BEFORE resetting the shared mock —
  // a zombie runner from the previous test otherwise writes patches into this
  // test's window (the flaky cross-test bleed).
  await Promise.all(Array.from(conv.live.values(), (p) => p.catch(() => {})));
  mockDb._reset();
  mockDb
    .collection('okf_repositories')
    .save({ _key: 'r1', repo_id: 'r1', name: 'Conversion Repo', domain: 'Indonesia' });
  authedAxios.get.mockReset();
  ingestService.ingestRepoConcepts.mockReset().mockResolvedValue({ accepted: 1, rejected: [] });
  ingestService.runImportCuration
    .mockReset()
    .mockResolvedValue({ method: 'x', total: 0, curated: 0, labeled: 0, described: 0, typed: 0, fallbacks: 0 });
});

describe('TITLE-ATTR LINK RESOLUTION (2026-09-08 audit fix)', () => {
  const MD = [
    '## Source: https://a.example/one',
    '# One',
    'See [Two](https://b.example/two "Two - Wikipedia") and [ext](https://outside.example/x "ext page").',
    '## Source: https://b.example/two',
    '# Two',
    'Back to [One](https://a.example/one "One - Wikipedia").'
  ].join('\n');

  test('a link with a title attribute resolves to the crawled page (was zero-resolution)', async () => {
    mockSource(MD);
    await startJob();
    const terminal = await waitForTerminal();
    expect(terminal.status).toBe('done');
    const pages = ingestService.ingestRepoConcepts.mock.calls[0][1].concepts;
    expect(pages[0].body).toContain('[Two](./b-example-two.md)');
    expect(pages[0].body).not.toContain('https://b.example/two');
    expect(pages[0].body).toContain('[ext](https://outside.example/x "ext page")');
    expect(pages[1].body).toContain('[One](./a-example-one.md)');
  });

  test('frontmatter links[] records the resolved target with empty label (parser body-scan fills it)', async () => {
    mockSource(MD);
    await startJob();
    await waitForTerminal();
    const fm = ingestService.ingestRepoConcepts.mock.calls[0][1].concepts[0].frontmatter.links;
    expect(fm).toEqual([{ target: './b-example-two.md', label: '' }]);
  });
});

describe('classification + curation wiring (2026-09-08 audit fix)', () => {
  const MD = ['## Source: https://a.example/one', '# One', 'body one'].join('\n');

  test('classification rides every flush with skipCuration (types at import, pass once at end)', async () => {
    mockSource(MD);
    await startJob({ classification: 'llm' });
    await waitForTerminal();
    expect(ingestService.ingestRepoConcepts).toHaveBeenCalledTimes(2); // pages + index
    for (const call of ingestService.ingestRepoConcepts.mock.calls) {
      expect(call[1].classification).toBe('llm');
      expect(call[1].skipCuration).toBe(true);
    }
  });

  test('the curation pass runs ONCE at conversion end: after the last flush, before done', async () => {
    mockSource(MD);
    await startJob({ classification: 'llm' });
    await waitForTerminal();
    expect(ingestService.runImportCuration).toHaveBeenCalledTimes(1);
    const ingestOrders = ingestService.ingestRepoConcepts.mock.invocationCallOrder;
    const curOrder = ingestService.runImportCuration.mock.invocationCallOrder[0];
    expect(Math.max(...ingestOrders)).toBeLessThan(curOrder);
    const patches = allPatches().map((p) => p.stage || p.status);
    expect(patches).toContain('curating');
    const doneIdx = allPatches().findIndex((p) => p.status === 'done');
    const curIdx = allPatches().findIndex((p) => p.stage === 'curating');
    expect(doneIdx).toBeGreaterThan(curIdx);
  });

  test('no classification: the pass never runs and no curating stage appears', async () => {
    mockSource(MD);
    await startJob();
    await waitForTerminal();
    expect(ingestService.runImportCuration).not.toHaveBeenCalled();
    expect(allPatches().map((p) => p.stage || p.status)).not.toContain('curating');
  });

  test('the pass receives the live repo doc (domain resolves the Subject Area labels)', async () => {
    mockSource(MD);
    await startJob({ classification: 'heuristics' });
    await waitForTerminal();
    expect(ingestService.runImportCuration).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ repo_id: 'r1', domain: 'Indonesia' }),
      'heuristics'
    );
  });
});

describe('ONE conversion per repo (2026-09-09 test-flake catch)', () => {
  test('a second startConversion for the same repo is refused while one is in flight', async () => {
    const md = ['## Source: https://a.example/one', '# One', 'body'].join('\n');
    mockSource(md);
    const first = conv.startConversion({ repo_id: 'r1', file_id: 'f1', split_mode: 'B' });
    for (let i = 0; i < 200 && !conv.live.has('r1'); i += 1) await new Promise((r) => setTimeout(r, 2));
    await expect(conv.startConversion({ repo_id: 'r1', file_id: 'f1', split_mode: 'B' })).rejects.toMatchObject({
      code: 'CONVERSION_IN_FLIGHT',
      status: 409
    });
    await waitForTerminal();
    await first.catch(() => {});
  });
});
