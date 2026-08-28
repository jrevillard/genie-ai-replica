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

  async update(_repoId, _conceptId, _body) {
    throw notReady('okf.curator.update.notReady');
  },

  async validate(_repoId, _conceptId) {
    throw notReady('okf.validation.run.notReady');
  },

  async validateFormatting(_repoId, _conceptId) {
    throw notReady('okf.validation.formatter.notReady');
  }
};

export default conceptService;
