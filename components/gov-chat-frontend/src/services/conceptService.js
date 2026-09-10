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
    const qs = opts.since ? `?since=${encodeURIComponent(opts.since)}` : '';
    try {
      const res = await httpService.get(`/okf/repos/${encodeURIComponent(repoId)}/concepts${qs}`);
      return res && res.data ? res.data : [];
    } catch (err) {
      if (err && (err.status === 404 || err.status === 501)) return [];
      throw err;
    }
  },

  async get(repoId, conceptId) {
    try {
      const res = await httpService.get(
        `/okf/repos/${encodeURIComponent(repoId)}/concepts/${encodeURIComponent(conceptId)}`
      );
      return res && res.data ? res.data : null;
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

  async validate(_repoId, _conceptId) {
    throw notReady('okf.validation.run.notReady');
  },

  async validateFormatting(_repoId, _conceptId) {
    throw notReady('okf.validation.formatter.notReady');
  }
};

export default conceptService;
