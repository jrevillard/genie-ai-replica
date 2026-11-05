/**
 * studioService — OKF Studio draft persistence.
 *
 * Drafts persist server-side in the `okf_studio_drafts` collection. The wire
 * shape is FLAT — `{ name, domain, source, …, repo_id, studio_step,
 * created_at, updated_at }` — NOT a nested `studio_state` object; the
 * nesting is a storage detail the client never sees.
 *
 * All three operations live under the repo resource at
 * `/okf/repos/:id/draft` (GET / PUT / DELETE). The retired client path was
 * the TOP-LEVEL `/okf/studio_drafts/:id` (repo id LAST). No okf-server
 * version ever served it, so no compat alias exists.
 *
 * Error mapping (httpService rejects a PLAIN OBJECT `{ status, data, message }`,
 * never an Error — hence `err.data?.error` for the backend code). The
 * classification lives in ONE place, classifyDraftError:
 *   404 REPO_NOT_FOUND  the repo is gone / soft-deleted / outside the
 *                       caller's scope → getDraft resolves to null (the
 *                       dashboard drops the card); saveDraft throws the typed
 *                       `REPO_NOT_FOUND` code (a deleted repo is not a
 *                       missing endpoint); NEVER a NOT_READY signal,
 *   404 anything else   the endpoint is not available on this server. THIS
 *                       PAGE always calls the current path, so a 404 here
 *                       means the SERVER does not serve it → NOT_READY,
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

/** The typed error the store switches on — same shape as NOT_READY. */
function typedError(code, status) {
  const e = new Error(code);
  e.code = code;
  e.status = status;
  return e;
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
      // A gone repo is a DEFINITIVE answer, not a missing endpoint: resolving
      // null keeps "repo is gone" distinct from NOT_READY.
      const kind = classifyDraftError(err);
      if (kind === 'REPO_NOT_FOUND') return null;
      if (kind === 'NOT_READY') throw typedError('NOT_READY', err.status);
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
      // A gone repo is a DEFINITIVE answer, not a missing endpoint. It must
      // NOT become a NOT_READY — that arms the SESSION-GLOBAL
      // draftsUnavailable latch, which would push every later save of every
      // repo to local-only behind a version-mismatch notice nobody can act
      // on. The typed code lets the store mark THIS repo dead.
      const kind = classifyDraftError(err);
      if (kind === 'REPO_NOT_FOUND') throw typedError('REPO_NOT_FOUND', err.status);
      if (kind === 'NOT_READY') throw typedError('NOT_READY', err.status);
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
