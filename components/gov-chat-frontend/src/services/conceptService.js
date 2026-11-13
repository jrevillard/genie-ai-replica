/**
 * conceptService — concept tree + inline update (Story 3-8 curator + validation).
 *
 * update / validate / validateFormatting are NOT_READY until Stories 4.2 and
 * 4.2b ship. listForRepo + get work against the existing meta-row API.
 */

import httpService from './httpService';

function notReady(reason) {
  const err = new Error('NOT_READY');
  err.code = 'NOT_READY';
  err.message = reason;
  return err;
}

const conceptService = {
  async listForRepo(repoId, opts = {}) {
    const params = [];
    if (opts.since) params.push(`since=${encodeURIComponent(opts.since)}`);
    // NON-BLOCKING LOAD (David, 2026-09-12): limit/offset page the server —
    // the response is then { total, offset, limit, concepts } instead of the
    // legacy full array. Both shapes pass through untouched.
    if (opts.limit !== undefined) params.push(`limit=${encodeURIComponent(opts.limit)}`);
    if (opts.offset !== undefined) params.push(`offset=${encodeURIComponent(opts.offset)}`);
    const qs = params.length ? `?${params.join('&')}` : '';
    try {
      const res = await httpService.get(`/okf/repos/${encodeURIComponent(repoId)}/concepts${qs}`);
      return res && res.data ? res.data : [];
    } catch (err) {
      if (err && (err.status === 404 || err.status === 501))
        return opts.limit !== undefined ? { concepts: [], total: 0 } : [];
      throw err;
    }
  },

  async get(repoId, conceptId) {
    // silent: true (review r0) — every caller treats a non-success as an
    // expected, handled outcome (fetchOkfConcept maps 403/404/501 to the
    // honest "unavailable" arm; the editor paths catch and render their own
    // states), so the interceptor's global error toast must stay off (the
    // interceptor's own rule: silent for probe-style lookups).
    try {
      const res = await httpService.get(
        `/okf/repos/${encodeURIComponent(repoId)}/concepts/${encodeURIComponent(conceptId)}`,
        { silent: true }
      );
      return res && res.data ? res.data : null;
    } catch (err) {
      if (err && (err.status === 404 || err.status === 501)) return null;
      throw err;
    }
  },

  /**
   * W9 (concept tree browse, 2026-11-08) — one page of the citizen browser's
   * tree index (GET /okf/repos/:id/concept-tree?limit=&offset=). The response
   * is { total, offset, limit, concepts:[{concept_id,title,links}] }; the
   * caller (store okf/browser) assembles progressively, never one payload.
   * A 404 is the anti-enumeration refusal (restricted / retracted / absent
   * repo) — null, so the dialog renders an honest "cannot be browsed"
   * instead of an error.
   */
  async getConceptTree(repoId, opts = {}) {
    const params = [];
    if (opts.limit !== undefined) params.push(`limit=${encodeURIComponent(opts.limit)}`);
    if (opts.offset !== undefined) params.push(`offset=${encodeURIComponent(opts.offset)}`);
    const qs = params.length ? `?${params.join('&')}` : '';
    try {
      // silent: true (review r0) — the 404 anti-enumeration refusal is an
      // expected, handled outcome (the browser renders an honest "cannot be
      // browsed"), never a global error toast.
      const res = await httpService.get(`/okf/repos/${encodeURIComponent(repoId)}/concept-tree${qs}`, {
        silent: true
      });
      return res && res.data ? res.data : { total: 0, offset: 0, limit: 200, concepts: [] };
    } catch (err) {
      if (err && (err.status === 404 || err.status === 501)) return null;
      throw err;
    }
  },

  /**
   * Story #978 — inline concept update, wired to the live PATCH endpoint.
   * Since the labels write-through (2026-09-05) this sends a FRONTMATTER
   * patch — the server merges it onto the CURRENT stored frontmatter
   * (strictly: provided keys replace, unmentioned keys survive). The old
   * GET→stringify→PATCH round-trip is gone: its frontmatter snapshot could
   * clobber a just-written label (the labels-don't-stick bug, reborn as a
   * clobber). A body edit goes through patchConceptBody / { markdown }.
   * Returns { ok, content_hash, index_status }.
   */
  async update(repoId, conceptId, patch = {}) {
    const res = await httpService.patch(
      `/okf/repos/${encodeURIComponent(repoId)}/concepts/${encodeURIComponent(conceptId)}`,
      { frontmatter: patch }
    );
    return res && res.data ? res.data : { ok: true };
  },

  /**
   * #1817 (saved-conversation OKF restore) — resolve a PRE-CAP-1 citation
   * row's lost repo identity: one concept_id in, the caller-visible holding
   * repo out ({ repo_id, bundle_version }). null when no visible repo holds
   * the concept (404 is the anti-enumeration refusal — restricted / draft /
   * absent are indistinguishable), so the caller keeps the honest
   * "unavailable" card instead of an error.
   */
  async resolveRepo(conceptId) {
    if (!conceptId) return null;
    try {
      // silent: true — the 404 refusal is an expected, handled outcome (the
      // restored row renders "unavailable"), never a global error toast.
      const res = await httpService.get('/okf/concepts/resolve-repo', {
        params: { concept_id: conceptId },
        silent: true
      });
      return res && res.data ? res.data : null;
    } catch (err) {
      if (err && (err.status === 404 || err.status === 501)) return null;
      throw err;
    }
  },

  async validate(_repoId, _conceptId) {
    throw notReady('okf.validation.run.notReady');
  },

  async validateFormatting(_repoId, _conceptId) {
    throw notReady('okf.validation.formatter.notReady');
  }
};

export default conceptService;
