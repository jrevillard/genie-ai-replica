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
 *   POST /okf/eval-contexts             — create (resolve, freeze, audit)
 *   POST /okf/eval-contexts/:id/refresh — re-resolve (version bump)
 *   GET  /okf/eval-contexts/groups?q=   — the composer's source: the groups
 *   POST /okf/eval-contexts/preview     — the resolution WITHOUT storing it
 *
 * Every call here is SUPERADMIN-gated on the server: a context may name any
 * repository, so it is a deployment-wide fact, not a per-repo one. The
 * error surface is httpService's: a rejection carries the server envelope
 * in err.data ({error, message}).
 *
 * The CATALOGUE is memoised: the Lab renders two pickers and the composer
 * panel, and all three used to fire their own identical read on every
 * dialog open. The cache lives for the panel's lifetime between writes —
 * `invalidateContexts()` is what a create or a refresh calls, because those
 * are the only actions that change the catalogue.
 */

import httpService from './httpService';

function cid(id) {
  return encodeURIComponent(id);
}

let catalogueCache = null;
let catalogueInFlight = null;

const evalContextService = {
  /** The catalogue: every context, newest first (the server's order). */
  async listContexts() {
    if (catalogueCache) return catalogueCache;
    if (catalogueInFlight) return catalogueInFlight;
    catalogueInFlight = httpService.get('/okf/eval-contexts').then((res) => {
      const items = res && res.data && Array.isArray(res.data.items) ? res.data.items : [];
      catalogueCache = Promise.resolve(items);
      catalogueInFlight = null;
      return items;
    });
    try {
      return await catalogueInFlight;
    } finally {
      catalogueInFlight = null;
    }
  },

  /** A create or a refresh changed the catalogue — drop the memo. */
  invalidateContexts() {
    catalogueCache = null;
    catalogueInFlight = null;
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
    evalContextService.invalidateContexts();
    return res && res.data ? res.data : null;
  },

  /**
   * UPDATE a context (David, 2026-11-25): rename it and/or add/remove its
   * group memberships. A membership change re-resolves server-side and
   * bumps the version.
   */
  async updateContext(id, payload) {
    const res = await httpService.post(`/okf/eval-contexts/${cid(id)}/update`, payload);
    evalContextService.invalidateContexts();
    return res && res.data ? res.data : null;
  },

  /**
   * DELETE a context — refused (409, naming the bound suites) while any
   * test suite is minted for it.
   */
  async deleteContext(id) {
    const res = await httpService.delete(`/okf/eval-contexts/${cid(id)}`);
    evalContextService.invalidateContexts();
    return res && res.data ? res.data : null;
  },

  /**
   * The composer's SOURCE: the deployment's groups, each with the grants it
   * carries and how many members it holds.
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
