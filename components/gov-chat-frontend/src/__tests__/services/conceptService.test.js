'use strict';

/**
 * Regression tests for conceptService URL paths.
 *
 * Bug fix: conceptService originally called `httpService.get('/api/okf/...')`,
 * producing `…/api/api/okf/...` against the backend. The convention everywhere
 * else in the codebase is no `/api` prefix — httpService.baseUrl already ends
 * with `/api`. These tests pin the convention.
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

const conceptService = require('@/services/conceptService').default;

describe('conceptService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('listForRepo', () => {
    it('GETs /okf/repos/:id/concepts (no /api prefix)', async () => {
      mockGet.mockResolvedValue({ data: [] });
      await conceptService.listForRepo('r-1');
      expect(mockGet).toHaveBeenCalledWith('/okf/repos/r-1/concepts');
      expect(mockGet.mock.calls[0][0].startsWith('/api/')).toBe(false);
    });

    it('appends the since query param correctly', async () => {
      mockGet.mockResolvedValue({ data: [] });
      await conceptService.listForRepo('r-1', { since: '2026-08-01' });
      expect(mockGet).toHaveBeenCalledWith('/okf/repos/r-1/concepts?since=2026-08-01');
    });
  });

  describe('get', () => {
    it('GETs /okf/repos/:id/concepts/:conceptId (no /api prefix)', async () => {
      mockGet.mockResolvedValue({ data: { id: 'c-1' } });
      await conceptService.get('r-1', 'c-1');
      expect(mockGet).toHaveBeenCalledWith('/okf/repos/r-1/concepts/c-1');
      expect(mockGet.mock.calls[0][0].startsWith('/api/')).toBe(false);
    });
  });
});
