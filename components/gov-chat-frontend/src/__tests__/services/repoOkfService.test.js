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
      expect(url).toBe('/okf/repos?lifecycle=all');
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
        { headers: { 'x-actor-sub': 'steward-1' } }
      );
    });

    it('omits the actor header when no actor is given', async () => {
      mockPatch.mockResolvedValue({ data: { ok: true } });
      await repoOkfService.patchConcept('r-1', 'c-1', '# body');
      expect(mockPatch.mock.calls[0][2]).toEqual({ headers: {} });
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
