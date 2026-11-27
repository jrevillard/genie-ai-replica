'use strict';

/**
 * Regression tests for repoOkfService URL paths.
 *
 * Bug fix: the OKF service originally called `httpService.get('/api/okf/...')`.
 * `httpService.baseUrl` already ends with `/api` (injected at container start
 * via `window.APP_CONFIG.apiUrl` or `process.env.VUE_APP_API_URL`), so the
 * final URL became `…/api/api/okf/repos?lifecycle=all` → backend logged 404.
 *
 * The convention used everywhere else in the codebase is for services to call
 * `httpService.get('/admin/...')` etc. (no `/api` prefix); these tests pin
 * that convention for the OKF services so future refactors can't reintroduce
 * the double prefix.
 */

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPut = jest.fn();
const mockDelete = jest.fn();
const mockPatch = jest.fn();

jest.mock('@/services/httpService', () => ({
  get: (...args) => mockGet(...args),
  post: (...args) => mockPost(...args),
  put: (...args) => mockPut(...args),
  delete: (...args) => mockDelete(...args),
  patch: (...args) => mockPatch(...args)
}));

const repoOkfService = require('@/services/repoOkfService').default;

describe('repoOkfService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('calls /okf/repos (NOT /api/okf/repos — baseUrl already provides /api)', async () => {
      mockGet.mockResolvedValue({ data: [] });
      await repoOkfService.list({ stage: 'all' });
      const url = mockGet.mock.calls[0][0];
      expect(url).toBe('/okf/repos?lifecycle=all&limit=100');
      expect(url.startsWith('/api/')).toBe(false);
    });
  });

  describe('get', () => {
    it('uses /okf/repos/:id (no /api prefix)', async () => {
      mockGet.mockResolvedValue({ data: { repo_id: 'r-1' } });
      await repoOkfService.get('r-1');
      const url = mockGet.mock.calls[0][0];
      expect(url).toBe('/okf/repos/r-1');
      expect(url.startsWith('/api/')).toBe(false);
    });
  });

  describe('create', () => {
    it('POSTs to /okf/repos (no /api prefix)', async () => {
      mockPost.mockResolvedValue({ data: { repo_id: 'r-2' } });
      await repoOkfService.create({ name: 'x' });
      const url = mockPost.mock.calls[0][0];
      expect(url).toBe('/okf/repos');
      expect(url.startsWith('/api/')).toBe(false);
    });
  });

  describe('update', () => {
    it('PATCHes /okf/repos/:id (no /api prefix)', async () => {
      mockPatch.mockResolvedValue({ data: { ok: true } });
      await repoOkfService.update('r-3', { name: 'y' });
      const url = mockPatch.mock.calls[0][0];
      expect(url).toBe('/okf/repos/r-3');
      expect(url.startsWith('/api/')).toBe(false);
    });
  });

  describe('getManifest', () => {
    it('GETs /okf/repos/:id/manifest (no /api prefix)', async () => {
      mockGet.mockResolvedValue({ data: {} });
      await repoOkfService.getManifest('r-4');
      const url = mockGet.mock.calls[0][0];
      expect(url).toBe('/okf/repos/r-4/manifest');
      expect(url.startsWith('/api/')).toBe(false);
    });
  });

  describe('getMetrics', () => {
    it('GETs /okf/repos/:id/metrics (no /api prefix)', async () => {
      mockGet.mockResolvedValue({ data: {} });
      await repoOkfService.getMetrics('r-5');
      const url = mockGet.mock.calls[0][0];
      expect(url).toBe('/okf/repos/r-5/metrics');
      expect(url.startsWith('/api/')).toBe(false);
    });
  });

  describe('mintVersion', () => {
    it('POSTs /okf/repos/:id/versions (no /api prefix)', async () => {
      mockPost.mockResolvedValue({ data: { ok: true } });
      await repoOkfService.mintVersion('r-6', { notes: 'hi' }, { sub: 'user-1' });
      const url = mockPost.mock.calls[0][0];
      expect(url).toBe('/okf/repos/r-6/versions');
      expect(url.startsWith('/api/')).toBe(false);
    });
  });

  describe('clone', () => {
    it('POSTs /okf/repos/:id/clone (no /api prefix)', async () => {
      mockPost.mockResolvedValue({ data: { repo_id: 'r-7' } });
      await repoOkfService.clone('r-src', { name: 'fork' });
      const url = mockPost.mock.calls[0][0];
      expect(url).toBe('/okf/repos/r-src/clone');
      expect(url.startsWith('/api/')).toBe(false);
    });
  });

  describe('getRepoValidation (#1650-C — the debt-panel issue viewer)', () => {
    it('GETs /okf/repos/:id/validation (no /api prefix), encoding the id', async () => {
      mockGet.mockResolvedValue({ data: { issues: [], summary: {}, generated_at: 't' } });
      await repoOkfService.getRepoValidation('r/1 x');
      const url = mockGet.mock.calls[0][0];
      expect(url).toBe('/okf/repos/r%2F1%20x/validation');
      expect(url.startsWith('/api/')).toBe(false);
    });

    it('unwraps { issues, summary, generated_at } from the response body', async () => {
      const issues = [
        { type: 'conformance', severity: 'warning', concept_id: 'c-1', code: 'X', message: 'm', remedy: 'r' }
      ];
      mockGet.mockResolvedValue({ data: { issues, summary: { total: 1 }, generated_at: '2026-11-09T00:00:00Z' } });
      const out = await repoOkfService.getRepoValidation('r-1');
      expect(out.issues).toEqual(issues);
      expect(out.summary).toEqual({ total: 1 });
      expect(out.generated_at).toBe('2026-11-09T00:00:00Z');
    });

    it('degrades a malformed body to empty issues / null summary instead of throwing in the caller', async () => {
      mockGet.mockResolvedValue({ data: null });
      const out = await repoOkfService.getRepoValidation('r-1');
      expect(out).toEqual({ issues: [], summary: null, generated_at: null });
      mockGet.mockResolvedValue({ data: { issues: 'not-an-array' } });
      const out2 = await repoOkfService.getRepoValidation('r-1');
      expect(out2.issues).toEqual([]);
    });
  });
});

describe('repoOkfService — Story #978 editor methods', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('patchConcept', () => {
    it('PATCHes /okf/repos/:rid/concepts/:cid with { markdown } and x-actor-sub header', async () => {
      mockPatch.mockResolvedValue({
        data: { ok: true, concept_id: 'c-1', content_hash: 'h1', index_status: 'parsed' }
      });
      await repoOkfService.patchConcept('r-1', 'c-1', '---\ntype: topic\n---\n# body', { sub: 'steward-1' });
      expect(mockPatch).toHaveBeenCalledWith(
        '/okf/repos/r-1/concepts/c-1',
        { markdown: '---\ntype: topic\n---\n# body' },
        // 2026-09-09 lockup fix: the PATCH re-scans server-side — 180s client timeout
        { headers: { 'x-actor-sub': 'steward-1' }, timeout: 180000 }
      );
    });

    it('omits the actor header when no actor is given', async () => {
      mockPatch.mockResolvedValue({ data: { ok: true } });
      await repoOkfService.patchConcept('r-1', 'c-1', '# body');
      expect(mockPatch.mock.calls[0][2]).toEqual({ headers: {}, timeout: 180000 });
    });
  });

  describe('resplit', () => {
    it('POSTs /okf/repos/:rid/resplit with { mode, file_id }', async () => {
      mockPost.mockResolvedValue({ data: { ok: true, mode: 'B', total: 3 } });
      await repoOkfService.resplit('r-1', 'B', 'file-9', { sub: 'steward-1' });
      expect(mockPost).toHaveBeenCalledWith(
        '/okf/repos/r-1/resplit',
        { mode: 'B', file_id: 'file-9' },
        { headers: { 'x-actor-sub': 'steward-1' } }
      );
    });

    it('omits file_id when not provided', async () => {
      mockPost.mockResolvedValue({ data: { ok: true, mode: 'A' } });
      await repoOkfService.resplit('r-1', 'A');
      expect(mockPost.mock.calls[0][1]).toEqual({ mode: 'A' });
    });
  });

  describe('autocorrect', () => {
    it('POSTs /okf/repos/:rid/autocorrect with dry_run=true by default', async () => {
      mockPost.mockResolvedValue({ data: { ok: true, changes: [], warnings: [] } });
      await repoOkfService.autocorrect('r-1');
      expect(mockPost).toHaveBeenCalledWith('/okf/repos/r-1/autocorrect', { dry_run: true }, { headers: {} });
    });

    it('sends dry_run=false when applying', async () => {
      mockPost.mockResolvedValue({ data: { ok: true, changes: [] } });
      await repoOkfService.autocorrect('r-1', { dryRun: false }, { sub: 's-1' });
      expect(mockPost).toHaveBeenCalledWith(
        '/okf/repos/r-1/autocorrect',
        { dry_run: false },
        { headers: { 'x-actor-sub': 's-1' } }
      );
    });
  });
});

describe('getManifest silence (Story #978 — expected not-settled 404)', () => {
  it('passes { silent: true } in the axios OPTIONS (3rd arg), not params', async () => {
    mockGet.mockRejectedValue({ status: 404 });
    await expect(repoOkfService.getManifest('r-9')).rejects.toMatchObject({ code: 'NOT_READY' });
    expect(mockGet).toHaveBeenCalledWith('/okf/repos/r-9/manifest', {}, { silent: true });
  });
});

describe('repoOkfService.list — {items} unwrap (dashboard regression)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('unwraps the { items, next_cursor } body the list endpoint returns', async () => {
    mockGet.mockResolvedValue({ data: { items: [{ repo_id: 'a' }, { repo_id: 'b' }], next_cursor: null } });
    const repos = await repoOkfService.list({ stage: 'all' });
    expect(repos).toEqual([{ repo_id: 'a' }, { repo_id: 'b' }]);
  });

  it('still accepts a legacy bare-array body', async () => {
    mockGet.mockResolvedValue({ data: [{ repo_id: 'a' }] });
    expect(await repoOkfService.list()).toEqual([{ repo_id: 'a' }]);
  });

  it('returns [] for any other shape instead of a non-iterable', async () => {
    mockGet.mockResolvedValue({ data: { unexpected: true } });
    expect(await repoOkfService.list()).toEqual([]);
  });
});

// #2200 — the picker (and the store's registry) must see the WHOLE
// catalogue: the endpoint pages (server default 50), so repos past page 1
// silently vanished from the RAGAS picker past 50 repositories. Follow the
// cursor with a hard cap; hitting the cap warns (never silent).
describe('repoOkfService.list — cursor-following (#2200)', () => {
  beforeEach(() => {
    // mockReset (not clearAllMocks): the mockResolvedValueOnce queues of the
    // paging tests must not leak into the sibling describes
    mockGet.mockReset();
    // setup.js installs a FILE-LIFETIME jest.fn for console.warn — spyOn on
    // it leaks call history across tests. Assert on the shared mock and
    // clear its history per test instead.
    console.warn.mockClear();
  });
  afterEach(() => {
    mockGet.mockReset();
  });

  it('follows next_cursor across pages at limit=100 and concatenates the items', async () => {
    mockGet
      .mockResolvedValueOnce({ data: { items: [{ repo_id: 'a' }, { repo_id: 'b' }], next_cursor: 'c2' } })
      .mockResolvedValueOnce({ data: { items: [{ repo_id: 'c' }], next_cursor: null } });
    const repos = await repoOkfService.list({ stage: 'all' });
    expect(repos).toEqual([{ repo_id: 'a' }, { repo_id: 'b' }, { repo_id: 'c' }]);
    expect(mockGet.mock.calls[1][0]).toBe('/okf/repos?lifecycle=all&limit=100&cursor=c2');
  });

  it('stops after one request when there is no cursor (single-page venue)', async () => {
    mockGet.mockResolvedValue({ data: { items: [{ repo_id: 'a' }], next_cursor: null } });
    await repoOkfService.list();
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('caps the loop and warns only when the catalogue truly continues', async () => {
    // LIST_PAGE_CAP + 1 full pages consumed by the loop, then the boundary
    // probe answers WITH items: a real truncation — warned.
    const pages = repoOkfService.LIST_PAGE_CAP + 2;
    for (let p = 0; p < pages; p++) {
      mockGet.mockResolvedValueOnce({ data: { items: [{ repo_id: `r${p}` }], next_cursor: `c${p + 1}` } });
    }
    const repos = await repoOkfService.list();
    expect(mockGet).toHaveBeenCalledTimes(pages);
    expect(repos).toHaveLength(pages);
    expect(console.warn).toHaveBeenCalled();
  });

  it('does not warn at an exact-multiple boundary (next_cursor on a full last page)', async () => {
    // pages 0..CAP come back FULL with a cursor (the server sets one on
    // every full page); the boundary probe (call CAP+2) answers EMPTY —
    // an exact multiple, not a truncation.
    let calls = 0;
    mockGet.mockImplementation(() => {
      calls += 1;
      const isProbe = calls > repoOkfService.LIST_PAGE_CAP + 1;
      return Promise.resolve(
        isProbe
          ? { data: { items: [], next_cursor: null } }
          : { data: { items: [{ repo_id: 'r' }], next_cursor: 'next' } }
      );
    });
    const repos = await repoOkfService.list();
    expect(repos.length).toBeGreaterThan(0);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('a mid-loop failure resolves the pages already in hand (warned, never silent)', async () => {
    mockGet
      .mockResolvedValueOnce({ data: { items: [{ repo_id: 'a' }], next_cursor: 'c2' } })
      .mockRejectedValueOnce(Object.assign(new Error('503'), { status: 503 }));
    const repos = await repoOkfService.list({ stage: 'all' });
    expect(repos).toEqual([{ repo_id: 'a' }]);
    expect(console.warn).toHaveBeenCalled();
  });

  it('a first-page failure throws into the caller’s error path (nothing in hand)', async () => {
    mockGet.mockRejectedValueOnce(Object.assign(new Error('503'), { status: 503 }));
    await expect(repoOkfService.list()).rejects.toMatchObject({ status: 503 });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('a legacy bare-array body terminates the loop in one request', async () => {
    mockGet.mockResolvedValue({ data: [{ repo_id: 'a' }] });
    const repos = await repoOkfService.list();
    expect(repos).toEqual([{ repo_id: 'a' }]);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});

// #1577 story 2 — the split client: preview (never throws, silent) + the
// confirm POST riding the story-1 route.
describe('repoOkfService.splitPreview / splitConcept (#1577 story 2)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('splitPreview GETs the split-preview route (no /api prefix) and resolves the body', async () => {
    mockGet.mockResolvedValue({
      data: {
        ok: true,
        concept_id: 'big',
        parts: [{ concept_id: 'big', path: 'docs/big.md', title: 'Big', chars: 120 }],
        ceiling: 250000,
        body_chars: 210
      }
    });
    const out = await repoOkfService.splitPreview('r-1', 'big');
    expect(mockGet.mock.calls[0][0]).toBe('/okf/repos/r-1/concepts/big/split-preview');
    expect(mockGet.mock.calls[0][2]).toMatchObject({ silent: true }); // the dialog owns refusals
    expect(out).toMatchObject({ ok: true, ceiling: 250000, parts: expect.any(Array) });
  });

  it('splitPreview maps a typed refusal to {ok:false, code, message, serverRefusal} without throwing', async () => {
    mockGet.mockRejectedValue({
      status: 409,
      data: { error: 'PART_ID_CONFLICT', message: 'would overwrite existing concept(s) big-part-2' },
      message: 'would overwrite existing concept(s) big-part-2'
    });
    const out = await repoOkfService.splitPreview('r-1', 'big');
    expect(out).toMatchObject({
      ok: false,
      code: 'PART_ID_CONFLICT',
      message: expect.stringContaining('big-part-2'),
      serverRefusal: true // the dialog renders the message verbatim, whatever the code
    });
  });

  it('splitPreview maps a transport failure to an honest failure shape (NOT a server refusal)', async () => {
    mockGet.mockRejectedValue({ status: 0, message: 'Network error. Please check your connection.' });
    const out = await repoOkfService.splitPreview('r-1', 'big');
    expect(out.ok).toBe(false);
    expect(out.message).toContain('Network error');
    expect(out.serverRefusal).toBeFalsy(); // the dialog's own error line, never "the server said"
  });

  it('splitConcept POSTs the story-1 split route (no /api prefix)', async () => {
    mockPost.mockResolvedValue({ data: { ok: true, concept_id: 'big', created: 1, updated: 1 } });
    const out = await repoOkfService.splitConcept('r-1', 'big', { sub: 'steward-1' });
    expect(mockPost.mock.calls[0][0]).toBe('/okf/repos/r-1/concepts/big/split');
    expect(mockPost.mock.calls[0][1]).toEqual({});
    expect(mockPost.mock.calls[0][2]).toMatchObject({ silent: true });
    expect(out).toMatchObject({ ok: true, created: 1 });
  });
});
