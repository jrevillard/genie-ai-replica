'use strict';

/**
 * studioService — draft persistence paths + error mapping.
 *
 * Bug fix: studioService originally called `httpService.get('/api/okf/...')`,
 * producing `…/api/api/okf/...` against the backend. The convention everywhere
 * else in the codebase is no `/api` prefix — httpService.baseUrl already ends
 * with `/api`. These tests pin the convention.
 *
 * Story 10.5: all three draft operations moved onto the repo resource at
 * `/okf/repos/:id/draft`. The retired `/okf/studio_drafts/:id` path was never
 * deployed, so there is deliberately NO compat alias — these tests are what
 * keeps it from creeping back.
 *
 * Error mapping is the other half: httpService rejects a PLAIN OBJECT
 * `{ status, data, message }`, never an Error, so the backend code is read
 * off `err.data.error`. A 404 REPO_NOT_FOUND means "the repo is gone" and
 * resolves to null; any OTHER 404 means "the endpoint does not exist" and
 * stays NOT_READY — collapsing the two would make a deleted repo
 * indistinguishable from an older backend forever.
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

/** The shape httpService's response interceptor rejects with. */
function httpError(status, errorCode) {
  return { status, statusText: 'Not Found', data: { error: errorCode }, message: 'boom' };
}

describe('studioService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getDraft', () => {
    it('GETs /okf/repos/:id/draft silently (absent draft = expected empty state)', async () => {
      mockGet.mockResolvedValue({ data: { repo_id: 'r-1', draft: { step: 3 } } });
      await studioService.getDraft('r-1');
      expect(mockGet).toHaveBeenCalledWith('/okf/repos/r-1/draft', {}, { silent: true });
      expect(mockGet.mock.calls[0][0].startsWith('/api/')).toBe(false);
    });

    it('unwraps the { repo_id, draft } envelope to the FLAT wire draft', async () => {
      const flat = { name: 'Bali', studio_step: 5, source: 'crawl', repo_id: 'r-1' };
      mockGet.mockResolvedValue({ data: { repo_id: 'r-1', draft: flat } });
      await expect(studioService.getDraft('r-1')).resolves.toEqual(flat);
    });

    it('resolves null when the repo has no draft yet (200 draft:null, NOT a 404)', async () => {
      mockGet.mockResolvedValue({ data: { repo_id: 'r-1', draft: null } });
      await expect(studioService.getDraft('r-1')).resolves.toBeNull();
    });

    it('404 REPO_NOT_FOUND resolves null — the repo is gone, not the endpoint', async () => {
      mockGet.mockRejectedValue(httpError(404, 'REPO_NOT_FOUND'));
      await expect(studioService.getDraft('r-1')).resolves.toBeNull();
    });

    it('any OTHER 404 stays NOT_READY (endpoint missing on an older server)', async () => {
      mockGet.mockRejectedValue(httpError(404, 'NOT_FOUND'));
      await expect(studioService.getDraft('r-1')).rejects.toMatchObject({ code: 'NOT_READY' });
    });

    it('a 404 with no backend code at all stays NOT_READY', async () => {
      mockGet.mockRejectedValue({ status: 404, data: '<html>nginx</html>' });
      await expect(studioService.getDraft('r-1')).rejects.toMatchObject({ code: 'NOT_READY' });
    });

    it('501 is NOT_READY', async () => {
      mockGet.mockRejectedValue(httpError(501, 'NOT_IMPLEMENTED'));
      await expect(studioService.getDraft('r-1')).rejects.toMatchObject({ code: 'NOT_READY' });
    });

    it('a 500 propagates unchanged (a real failure, not an absent route)', async () => {
      mockGet.mockRejectedValue(httpError(500, 'INTERNAL_ERROR'));
      await expect(studioService.getDraft('r-1')).rejects.toMatchObject({ status: 500 });
    });
  });

  describe('saveDraft', () => {
    it('PUTs /okf/repos/:id/draft silently (no /api prefix, no legacy path)', async () => {
      mockPut.mockResolvedValue({ data: { repo_id: 'r-1', draft: { studio_step: 4 }, created: true } });
      const res = await studioService.saveDraft('r-1', { studio_step: 4 });
      expect(mockPut).toHaveBeenCalledWith('/okf/repos/r-1/draft', { studio_step: 4 }, { silent: true });
      expect(mockPut.mock.calls[0][0].startsWith('/api/')).toBe(false);
      expect(mockPut.mock.calls[0][0]).not.toContain('/okf/studio_drafts/');
      expect(res.created).toBe(true);
    });

    it('passes the flat wire draft through unchanged (the service strips reserved keys)', async () => {
      mockPut.mockResolvedValue({ data: {} });
      const body = { repo_id: 'r-1', name: 'Bali', studio_step: 6, updated_at: 1791637021770 };
      await studioService.saveDraft('r-1', body);
      expect(mockPut).toHaveBeenCalledWith('/okf/repos/r-1/draft', body, { silent: true });
    });

    it('404 maps to NOT_READY', async () => {
      mockPut.mockRejectedValue(httpError(404, 'REPO_NOT_FOUND'));
      await expect(studioService.saveDraft('r-1', {})).rejects.toMatchObject({ code: 'NOT_READY' });
    });
  });

  describe('clearDraft', () => {
    it('DELETEs /okf/repos/:id/draft silently (no /api prefix, no legacy path)', async () => {
      mockDelete.mockResolvedValue({});
      await studioService.clearDraft('r-1');
      expect(mockDelete).toHaveBeenCalledWith('/okf/repos/r-1/draft', { silent: true });
      expect(mockDelete.mock.calls[0][0].startsWith('/api/')).toBe(false);
      expect(mockDelete.mock.calls[0][0]).not.toContain('/okf/studio_drafts/');
    });

    it('a missing draft is NOT an error (best-effort clear resolves ok)', async () => {
      mockDelete.mockRejectedValue(httpError(404, 'REPO_NOT_FOUND'));
      await expect(studioService.clearDraft('r-1')).resolves.toEqual({ ok: true });
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
