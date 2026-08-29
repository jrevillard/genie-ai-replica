/**
 * repoOkfService — read-mostly OKF repo CRUD client.
 *
 * Backed by the existing /api/okf/repos routes on okf-server. Some methods
 * (manifest, metrics, clone) reference routes already shipped; mintVersion
 * already exists (Story 2.9.7). Update + clone are server-live from 2.9.7
 * and 4.8.
 */

import httpService from './httpService';

function notReady(reason) {
  const err = new Error('NOT_READY');
  err.code = 'NOT_READY';
  err.message = reason;
  return err;
}

const repoOkfService = {
  async list({ stage = 'all' } = {}) {
    const res = await httpService.get(`/okf/repos?lifecycle=${encodeURIComponent(stage)}`);
    return res && res.data ? res.data : [];
  },

  async get(repoId) {
    const res = await httpService.get(`/okf/repos/${encodeURIComponent(repoId)}`);
    return res && res.data ? res.data : null;
  },

  async create(body) {
    const res = await httpService.post('/okf/repos', body);
    return res && res.data ? res.data : null;
  },

  async update(repoId, patch) {
    const res = await httpService.patch(`/okf/repos/${encodeURIComponent(repoId)}`, patch);
    return res && res.data ? res.data : { ok: true };
  },

  async getManifest(repoId) {
    try {
      const res = await httpService.get(`/okf/repos/${encodeURIComponent(repoId)}/manifest`);
      return res && res.data ? res.data : null;
    } catch (err) {
      if (err && (err.status === 404 || err.status === 501)) throw notReady('okf.repos.manifest.notReady');
      throw err;
    }
  },

  async getMetrics(repoId) {
    try {
      const res = await httpService.get(`/okf/repos/${encodeURIComponent(repoId)}/metrics`);
      return res && res.data ? res.data : null;
    } catch (err) {
      if (err && (err.status === 404 || err.status === 501)) return null;
      throw err;
    }
  },

  async mintVersion(repoId, body = {}, actor = {}) {
    const res = await httpService.post(`/okf/repos/${encodeURIComponent(repoId)}/versions`, body, {
      headers: actor && actor.sub ? { 'x-actor-sub': actor.sub } : {}
    });
    return res && res.data ? res.data : { ok: true };
  },

  async clone(sourceId, body = {}) {
    const res = await httpService.post(`/okf/repos/${encodeURIComponent(sourceId)}/clone`, body);
    return res && res.data ? res.data : null;
  },

  /**
   * Story #978 — Editor: PATCH a single concept's markdown (frontmatter +
   * body). Returns { ok, concept_id, content_hash, index_status, updated_at }.
   */
  async patchConcept(repoId, conceptId, markdown, actor = {}) {
    const res = await httpService.patch(
      `/okf/repos/${encodeURIComponent(repoId)}/concepts/${encodeURIComponent(conceptId)}`,
      { markdown },
      { headers: actor && actor.sub ? { 'x-actor-sub': actor.sub } : {} }
    );
    return res && res.data ? res.data : { ok: true };
  },

  /**
   * Story #978 — Editor: re-split the repo from its source file. mode
   * 'A' (mega) | 'B' (per `## Source:` page, default) | 'C' (LLM, 10.6).
   * Returns { ok, mode, total, parsed, created, rejected, enqueued }.
   */
  async resplit(repoId, mode, fileId, actor = {}) {
    const body = { mode };
    if (fileId) body.file_id = fileId;
    const res = await httpService.post(`/okf/repos/${encodeURIComponent(repoId)}/resplit`, body, {
      headers: actor && actor.sub ? { 'x-actor-sub': actor.sub } : {}
    });
    return res && res.data ? res.data : { ok: true };
  },

  /**
   * Story #978 — Editor: frontmatter-only autocorrect. dry_run=true (the
   * server default) returns { changes, warnings } without applying;
   * dry_run=false applies atomically.
   */
  async autocorrect(repoId, { dryRun = true } = {}, actor = {}) {
    const res = await httpService.post(
      `/okf/repos/${encodeURIComponent(repoId)}/autocorrect`,
      { dry_run: !!dryRun },
      { headers: actor && actor.sub ? { 'x-actor-sub': actor.sub } : {} }
    );
    return res && res.data ? res.data : { ok: true };
  }
};

export default repoOkfService;
