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

  // W9 (concept tree browse): the paginated tree index — the walker's
  // pagination contract and the honest-null arm for the 404 anti-enumeration
  // refusal (restricted / retracted / absent repo).
  describe('getConceptTree', () => {
    it('GETs /okf/repos/:id/concept-tree with the limit/offset query (no /api prefix)', async () => {
      const page = { total: 3, offset: 200, limit: 200, concepts: [{ concept_id: 'c3', title: 'C3', links: [] }] };
      mockGet.mockResolvedValue({ data: page });
      const out = await conceptService.getConceptTree('r-1', { limit: 200, offset: 200 });
      expect(mockGet).toHaveBeenCalledWith('/okf/repos/r-1/concept-tree?limit=200&offset=200');
      expect(mockGet.mock.calls[0][0].startsWith('/api/')).toBe(false);
      expect(out).toBe(page);
    });

    it('omits the query string when no paging opts are passed', async () => {
      mockGet.mockResolvedValue({ data: { total: 0, offset: 0, limit: 200, concepts: [] } });
      await conceptService.getConceptTree('r-1');
      expect(mockGet).toHaveBeenCalledWith('/okf/repos/r-1/concept-tree');
    });

    it('maps a 404 (the anti-enumeration refusal) to null', async () => {
      const err = new Error('not found');
      err.status = 404;
      mockGet.mockRejectedValue(err);
      expect(await conceptService.getConceptTree('fenced')).toBeNull();
    });

    it('maps a 501 (older backend, no route) to null', async () => {
      const err = new Error('not implemented');
      err.status = 501;
      mockGet.mockRejectedValue(err);
      expect(await conceptService.getConceptTree('r-1')).toBeNull();
    });

    it('rethrows transport failures (they land in the store error arm, not unavailable)', async () => {
      mockGet.mockRejectedValue(new Error('gateway 502'));
      await expect(conceptService.getConceptTree('r-1')).rejects.toThrow('gateway 502');
    });
  });
});

describe('conceptService.update — labels write-through (frontmatter patch, 2026-09-05)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('PATCHes { frontmatter } directly — NO snapshot GET round-trip', async () => {
    mockPatch.mockResolvedValue({ data: { ok: true, content_hash: 'H2', index_status: 'indexed' } });

    const result = await conceptService.update('r-1', 'c-1', { labels: ['Health'] });

    // The old GET→stringify→PATCH round-trip could clobber a just-written
    // label with a stale frontmatter snapshot — the server merges now.
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockPatch).toHaveBeenCalledWith('/okf/repos/r-1/concepts/c-1', {
      frontmatter: { labels: ['Health'] }
    });
    expect(result.ok).toBe(true);
    expect(result.index_status).toBe('indexed');
  });

  it('sends an explicit empty labels array as-is (clearing stays explicit)', async () => {
    mockPatch.mockResolvedValue({ data: { ok: true } });
    await conceptService.update('r-1', 'c-1', { labels: [] });
    expect(mockPatch).toHaveBeenCalledWith('/okf/repos/r-1/concepts/c-1', { frontmatter: { labels: [] } });
  });
});
