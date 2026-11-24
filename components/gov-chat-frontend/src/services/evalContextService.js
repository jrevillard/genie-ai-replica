/**
 * evalContextService — the Evaluation Context client (OKF Testing Lab,
 * #2061 phase 4 / E-5: the scoped evaluation's operator surface).
 *
 * An Evaluation Context is a NAMED, VERSIONED, SNAPSHOT-RESOLVED principal:
 * a name plus the group memberships it holds. The composer builds one here;
 * the Lab's suites and benchmarks are then minted FOR it and measured over
 * it.
 *
 *   GET  /okf/eval-contexts             — the catalogue
 *   GET  /okf/eval-contexts/:id         — one context
 *   POST /okf/eval-contexts             — create (resolve, freeze, audit)
 *   POST /okf/eval-contexts/:id/refresh — re-resolve (version bump)
 *   GET  /okf/eval-contexts/groups?q=   — the composer's source: the groups
 *   POST /okf/eval-contexts/preview     — the resolution WITHOUT storing it
 *
 * Every call here is SUPERADMIN-gated on the server: a context may name any
 * repository, so it is a deployment-wide fact, not a per-repo one. The
 * error surface is httpService's: a rejection carries the server envelope in
 * err.data ({error, message}) — callers map that to {ok, code, message}.
 */

import httpService from './httpService';

function cid(id) {
  return encodeURIComponent(id);
}

const evalContextService = {
  /** The catalogue: every context, newest first (the server's order). */
  async listContexts() {
    const res = await httpService.get('/okf/eval-contexts');
    return res && res.data && Array.isArray(res.data.items) ? res.data.items : [];
  },

  /** ONE context, with its frozen resolution. */
  async getContext(id) {
    const res = await httpService.get(`/okf/eval-contexts/${cid(id)}`);
    return res && res.data ? res.data : null;
  },

  /**
   * CREATE a context: {name, principal_refs: [group names]}. The server
   * resolves the union of those memberships through the one authority and
   * freezes it — the response carries the resolution, so the caller can
   * show what was frozen.
   */
  async createContext(payload) {
    const res = await httpService.post('/okf/eval-contexts', payload);
    return res && res.data ? res.data : null;
  },

  /** REFRESH a context: re-resolve the same memberships, bump the version. */
  async refreshContext(id) {
    const res = await httpService.post(`/okf/eval-contexts/${cid(id)}/refresh`);
    return res && res.data ? res.data : null;
  },

  /**
   * The composer's SOURCE: the deployment's groups, each with the grants it
   * carries and the members it holds.
   */
  async listGroups(q = '') {
    const res = await httpService.get(`/okf/eval-contexts/groups?q=${encodeURIComponent(q || '')}`);
    return res && res.data && Array.isArray(res.data.items) ? res.data.items : [];
  },

  /**
   * The resolution a create WOULD freeze, WITHOUT writing anything: a
   * context is immutable and has no delete route, so the composer sees the
   * union before it commits.
   */
  async previewContext(payload) {
    const res = await httpService.post('/okf/eval-contexts/preview', payload);
    return res && res.data ? res.data : null;
  }
};

export default evalContextService;
