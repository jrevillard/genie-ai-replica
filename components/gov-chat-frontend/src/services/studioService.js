/**
 * studioService — OKF Studio draft persistence + job monitoring.
 *
 * Story 10.5: drafts persist server-side in the `okf_studio_drafts`
 * collection. The wire shape is FLAT — `{ name, domain, source, …, repo_id,
 * studio_step, created_at, updated_at }` — NOT a nested `studio_state`
 * object; the nesting is a storage detail the client never sees.
 *
 * All three operations live under the repo resource at
 * `/okf/repos/:id/draft` (GET / PUT / DELETE). The retired client path was
 * the TOP-LEVEL `/okf/studio_drafts/:id` (repo id LAST — the pre-3f1c733ba
 * bundle PUT/DELETE'd there; its GET already used `/:repo_id/draft`). No
 * okf-server version ever served it, so no compat alias exists.
 *
 * Error mapping (httpService rejects a PLAIN OBJECT `{ status, data, message }`,
 * never an Error — hence `err.data?.error` for the backend code):
 *   404 REPO_NOT_FOUND  the repo is gone / soft-deleted / foreign → getDraft
 *                       resolves to null (the dashboard drops the card);
 *                       saveDraft RETHROWS it as-is (a deleted repo is not a
 *                       missing endpoint); NOT a NOT_READY signal,
 *   404 anything else   the endpoint is not reachable from this session.
 *                       THIS PAGE always calls the current path, so for a
 *                       bundle built after #1056 a 404 here means the SERVER
 *                       does not serve it; only a bundle built BEFORE the
 *                       contract change can be the stale party — and it runs
 *                       the old mapping above, which this code cannot fix.
 *                       Either way → NOT_READY,
 *   200 draft: null     the repo exists and has no draft yet (normal first
 *                       open) — never a 404.
 */

import httpService from './httpService';

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/**
 * Classify a failed draft request — ONE place, so the three verbs cannot
 * drift on what a 404 means:
 *   'REPO_NOT_FOUND' the repo is gone (deleted / soft-deleted): a definitive
 *                   answer, NEVER a NOT_READY (the store turns NOT_READY into
 *                   the session-global draftsUnavailable latch),
 *   'NOT_READY'     the endpoint is not available on this server,
 *   null            anything else — the caller propagates the error.
 */
function classifyDraftError(err) {
  if (!err) return null;
  if (err.status === 404 && backendErrorCode(err) === 'REPO_NOT_FOUND') return 'REPO_NOT_FOUND';
  if (err.status === 404 || err.status === 501) return 'NOT_READY';
  return null;
}

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
   * @throws  NOT_READY (code) when the endpoint is not available on this server.
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
      const kind = classifyDraftError(err);
      if (kind === 'REPO_NOT_FOUND') return null;
      if (kind === 'NOT_READY') {
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
      // REPO_NOT_FOUND is a DEFINITIVE answer, not a missing endpoint: the
      // repo was deleted (or soft-deleted) under the curator. It must NOT
      // become a NOT_READY — that arms the SESSION-GLOBAL draftsUnavailable
      // latch, which would push every later save of every repo to local-only
      // and blame a version mismatch the operator cannot act on (#1056).
      const kind = classifyDraftError(err);
      if (kind === 'REPO_NOT_FOUND') throw err;
      if (kind === 'NOT_READY') {
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
      if (classifyDraftError(err)) return { ok: true };
      throw err;
    }
  }
};

export default studioService;
