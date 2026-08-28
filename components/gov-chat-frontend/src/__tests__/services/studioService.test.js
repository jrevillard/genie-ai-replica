'use strict';

/**
 * Regression tests for studioService URL paths.
 *
 * Bug fix: studioService originally called `httpService.get('/api/okf/...')`,
 * producing `…/api/api/okf/...` against the backend. The convention everywhere
 * else in the codebase is no `/api` prefix — httpService.baseUrl already ends
 * with `/api`. These tests pin the convention.
 */

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPut = jest.fn();
const mockDelete = jest.fn();

jest.mock('@/services/httpService', () => ({
  get: (...args) => mockGet(...args),
  post: (...args) => mockPost(...args),
  put: (...args) => mockPut(...args),
  delete: (...args) => mockDelete(...args)
}));

const studioService = require('@/services/studioService').default;

describe('studioService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getDraft', () => {
    it('GETs /okf/repos/:id/draft (no /api prefix)', async () => {
      mockGet.mockResolvedValue({ data: { step: 3 } });
      await studioService.getDraft('r-1');
      expect(mockGet).toHaveBeenCalledWith('/okf/repos/r-1/draft');
      expect(mockGet.mock.calls[0][0].startsWith('/api/')).toBe(false);
    });
  });

  describe('saveDraft', () => {
    it('PUTs /okf/studio_drafts/:id (no /api prefix)', async () => {
      mockPut.mockResolvedValue({ data: { ok: true } });
      await studioService.saveDraft('r-1', { step: 4 });
      expect(mockPut).toHaveBeenCalledWith('/okf/studio_drafts/r-1', { step: 4 });
      expect(mockPut.mock.calls[0][0].startsWith('/api/')).toBe(false);
    });
  });

  describe('clearDraft', () => {
    it('DELETEs /okf/studio_drafts/:id (no /api prefix)', async () => {
      mockDelete.mockResolvedValue({});
      await studioService.clearDraft('r-1');
      expect(mockDelete).toHaveBeenCalledWith('/okf/studio_drafts/r-1');
      expect(mockDelete.mock.calls[0][0].startsWith('/api/')).toBe(false);
    });
  });

  describe('fetchProducerJob', () => {
    it('GETs /okf/jobs/:id (no /api prefix)', async () => {
      mockGet.mockResolvedValue({ data: { status: 'done' } });
      await studioService.fetchProducerJob('job-1');
      expect(mockGet).toHaveBeenCalledWith('/okf/jobs/job-1');
      expect(mockGet.mock.calls[0][0].startsWith('/api/')).toBe(false);
    });
  });

  describe('killProducerJob', () => {
    it('POSTs /okf/jobs/:id/kill (no /api prefix)', async () => {
      mockPost.mockResolvedValue({ data: { ok: true } });
      await studioService.killProducerJob('job-2');
      expect(mockPost).toHaveBeenCalledWith('/okf/jobs/job-2/kill');
      expect(mockPost.mock.calls[0][0].startsWith('/api/')).toBe(false);
    });
  });
});
