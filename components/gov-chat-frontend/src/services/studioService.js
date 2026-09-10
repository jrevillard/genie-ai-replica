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
      // silent: an absent draft is an EXPECTED empty state (no draft yet) —
      // the interceptor must not toast/console-noise it; the caller owns the
      // NOT_READY outcome.
      const res = await httpService.get(`/okf/repos/${encodeURIComponent(repoId)}/draft`, {}, { silent: true });
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
      // silent: the drafts collection being absent 404s EVERY save until the
      // 10.5 aggregation lands — expected, handled, never user-facing noise
      // (David's 18× PUT 404 evidence, 2026-09-06).
      const res = await httpService.put(`/okf/studio_drafts/${encodeURIComponent(repoId)}`, body, { silent: true });
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
      await httpService.delete(`/okf/studio_drafts/${encodeURIComponent(repoId)}`, { silent: true });
      return { ok: true };
    } catch (err) {
      if (err && (err.status === 404 || err.status === 501)) return { ok: true };
      throw err;
    }
  },

  async fetchProducerJob(jobId) {
    const res = await httpService.get(`/okf/jobs/${encodeURIComponent(jobId)}`);
    return res && res.data ? res.data : null;
  },

  async killProducerJob(jobId) {
    const res = await httpService.post(`/okf/jobs/${encodeURIComponent(jobId)}/kill`);
    return res && res.data ? res.data : { ok: true };
  }
};

export default studioService;
