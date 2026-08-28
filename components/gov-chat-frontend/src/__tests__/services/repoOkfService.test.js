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
