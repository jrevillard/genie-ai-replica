/**
 * studioService — OKF Studio draft persistence + job monitoring.
 *
 * Story 10.5: drafts persist server-side in the `okf_studio_drafts`
 * collection. The wire shape is FLAT — `{ name, domain, source, …, repo_id,
 * studio_step, created_at, updated_at }` — NOT a nested `studio_state`
 * object; the nesting is a storage detail the client never sees.
 *
 * All three operations live under the repo resource at
 * `/okf/repos/:id/draft` (GET / PUT / DELETE). The retired
 * `/okf/studio_drafts/:id` path was never deployed, so no compat alias is
 * registered for it here either.
 *
 * Error mapping (httpService rejects a PLAIN OBJECT `{ status, data, message }`,
 * never an Error — hence `err.data?.error` for the backend code):
 *   404 REPO_NOT_FOUND  the repo is gone / soft-deleted / foreign → getDraft
 *                       resolves to null (the dashboard drops the card);
 *                       NOT a NOT_READY signal,
 *   404 anything else   the endpoint genuinely does not exist (an older
 *                       server) → NOT_READY,
 *   200 draft: null     the repo exists and has no draft yet (normal first
 *                       open) — never a 404.
 */

import httpService from './httpService';

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/**
 * Backend error code for a request that failed with `status`. Returns '' when
 * the body carries no recognizable `error` code (an nginx/Kong HTML error
 * page, a network-layer failure).
 */
function backendErrorCode(err) {
  const body = err && err.data;
  if (body && typeof body.error === 'string' && body.error.length > 0) return body.error;
  return '';
}

const studioService = {
  /**
   * Read the persisted draft for a repo.
   *
   * @returns {Promise<Object|null>} the FLAT wire draft, or null when the
   *   repo has no draft yet / no longer exists.
   * @throws  NOT_READY (code) when the endpoint is missing on the server.
   */
  async getDraft(repoId) {
    try {
      // silent: an absent draft is an EXPECTED empty state (no draft yet) —
      // the interceptor must not toast/console-noise it; the caller owns the
      // NOT_READY outcome.
      const res = await httpService.get(`/okf/repos/${encodeURIComponent(repoId)}/draft`, {}, { silent: true });
      const body = res && res.data ? res.data : null;
      if (!body || typeof body !== 'object') return null;
      // The envelope is `{ repo_id, draft }`. Tolerate a bare flat draft so a
      // proxy that unwraps the envelope cannot turn a real draft into null.
      return hasOwn(body, 'draft') ? body.draft : body;
    } catch (err) {
      // REPO_NOT_FOUND is a DEFINITIVE answer, not a missing endpoint: the
      // repo is gone (deleted / soft-deleted / outside the caller's scope).
      // Resolving null keeps "repo is gone" distinct from NOT_READY.
      if (err && err.status === 404 && backendErrorCode(err) === 'REPO_NOT_FOUND') {
        return null;
      }
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
      // silent: the wizard saves on every step change AND every step
      // @update, so a per-write toast would be a flood. The store owns the
      // outcome and returns it to the caller.
      const res = await httpService.put(`/okf/repos/${encodeURIComponent(repoId)}/draft`, body, { silent: true });
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
      await httpService.delete(`/okf/repos/${encodeURIComponent(repoId)}/draft`, { silent: true });
      return { ok: true };
    } catch (err) {
      // A missing draft is NOT an error (the server answers 200 deleted:false);
      // an absent endpoint is equally harmless — clearing is best-effort.
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
