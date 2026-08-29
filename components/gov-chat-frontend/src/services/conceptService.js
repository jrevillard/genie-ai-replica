/**
 * conceptService — concept tree + inline update (Story 3-8 curator + validation).
 *
 * update / validate / validateFormatting are NOT_READY until Stories 4.2 and
 * 4.2b ship. listForRepo + get work against the existing meta-row API.
 */

import httpService from './httpService';
import matter from 'gray-matter';

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
   * Story #978 — inline concept update, now wired to the live PATCH endpoint.
   * The endpoint takes full markdown, so a partial patch (e.g. { labels })
   * fetches the current row, splices frontmatter, and round-trips the
   * markdown. Returns { ok, content_hash, index_status }.
   */
  async update(repoId, conceptId, patch = {}) {
    const row = await this.get(repoId, conceptId);
    if (!row) {
      const err = new Error(`Concept '${conceptId}' not found in repo '${repoId}'`);
      err.code = 'CONCEPT_NOT_FOUND';
      err.status = 404;
      throw err;
    }
    const frontmatter = { ...(row.frontmatter || {}), ...patch };
    const markdown = matter.stringify(row.body || '', frontmatter);
    const res = await httpService.patch(
      `/okf/repos/${encodeURIComponent(repoId)}/concepts/${encodeURIComponent(conceptId)}`,
      { markdown }
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
