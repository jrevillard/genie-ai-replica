/**
 * studioService — OKF Studio draft persistence + job monitoring.
 *
 * Until the 10.5 server aggregation lands, draft persistence writes to
 * okf_repositories.studio_step (the additive denormalized pointer) via the
 * existing PATCH /api/okf/repos/:id endpoint. The to-be-built
 * okf_studio_drafts collection is not yet served; this client returns
 * NOT_READY when the server collection is missing.
 */

import httpService from './httpService';

const studioService = {
  async getDraft(repoId) {
    try {
      const res = await httpService.get(`/api/okf/repos/${encodeURIComponent(repoId)}/draft`);
      return res && res.data ? res.data : null;
    } catch (err) {
      if (err && (err.status === 404 || err.status === 501)) {
        const err_not_ready = new Error('NOT_READY');
        err_not_ready.code = 'NOT_READY';
        err_not_ready.status = err.status;
        throw err_not_ready;
      }
      throw err;
    }
  },

  async saveDraft(repoId, body) {
    try {
      const res = await httpService.put(
        `/api/okf/studio_drafts/${encodeURIComponent(repoId)}`,
        body
      );
      return res && res.data ? res.data : { ok: true };
    } catch (err) {
      if (err && (err.status === 404 || err.status === 501)) {
        const err_not_ready = new Error('NOT_READY');
        err_not_ready.code = 'NOT_READY';
        err_not_ready.status = err.status;
        throw err_not_ready;
      }
      throw err;
    }
  },

  async clearDraft(repoId) {
    try {
      await httpService.delete(`/api/okf/studio_drafts/${encodeURIComponent(repoId)}`);
      return { ok: true };
    } catch (err) {
      if (err && (err.status === 404 || err.status === 501)) return { ok: true };
      throw err;
    }
  },

  async fetchProducerJob(jobId) {
    const res = await httpService.get(`/api/okf/jobs/${encodeURIComponent(jobId)}`);
    return res && res.data ? res.data : null;
  },

  async killProducerJob(jobId) {
    const res = await httpService.post(`/api/okf/jobs/${encodeURIComponent(jobId)}/kill`);
    return res && res.data ? res.data : { ok: true };
  }
};

export default studioService;
