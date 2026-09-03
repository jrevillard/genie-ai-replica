/**
 * crawlerToOkfService — trigger a crawl→OKF conversion.
 *
 * ARCHITECTURE (David, 2026-09-02): the conversion is a SERVER-SIDE,
 * streaming, async job in okf-server (services/crawl-conversion-service.js).
 * The browser never downloads, splits or batches the crawled markdown —
 * that capped out far below the 10 GB requirement (browser memory, UI
 * lock-ups, Kong's 60s route timeout killing slow batches). This service
 * just POSTs the trigger and returns the created repo; its `conversion`
 * field carries live progress, polled by the Vuex store.
 *
 * Flow:
 *   1. POST /api/okf/repos/convert-from-crawl
 *      {file_id, url, crawl_job_id, split_mode, name, domain}
 *      → 202 + repo (created server-side with a UNIQUE name — the same
 *        crawl file can become multiple traceable repositories).
 *   2. The caller polls GET /api/okf/repos/:id — repo.conversion.status:
 *      queued → downloading → splitting → adding (batch i/n) → done | failed.
 *
 * Permissions: tools-admin (matches repo create/ingest).
 */

import httpService from './httpService';

/** Max create attempts when the slugified name collides — the server does
 * the authoritative retry; this is only the slug derivation it is fed. */
export const MAX_NAME_ATTEMPTS = 10;

/**
 * Slugify a URL or filename into a valid repo name (mirrors the okf-server
 * slug rules: lowercase, non-alphanumerics → '-', trim, ≤200 chars).
 */
export function slugify(input) {
  if (!input) return 'crawled-repository';
  return (
    String(input)
      .toLowerCase()
      .replace(/^https?:\/\/(www\.)?/, '') // strip scheme + www.
      .replace(/\.(md|html|htm|txt)$/i, '') // strip extension if filename
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 200) || 'crawled-repository'
  );
}

const crawlerToOkfService = {
  /**
   * Trigger the server-side conversion. Returns as soon as the repo exists
   * (202) — progress is polled separately via repoOkfService.get(repoId).
   *
   * @param {Object} input
   * @param {string} input.fileId       doc-repo file_id of the crawled .md
   * @param {string} [input.url]        crawl seed URL (slug + provenance)
   * @param {string} [input.crawlJobId] crawl_job _key (audit provenance)
   * @param {string} [input.filename]   original file_name (repo name slug)
   * @param {string} [input.splitMode]  'B' per-page (default) | 'A' mega-concept
   * @param {Object} [input.actor]      auth hints (sub → x-actor-sub)
   * @param {string} [input.domain]     subject area (defaults to 'general')
   * @returns {Promise<Object>} the created repo (with `conversion` progress)
   */
  async convertCrawlToOkf({ fileId, url, crawlJobId, filename, actor, domain, splitMode } = {}) {
    if (!fileId) {
      const err = new Error('fileId is required to convert a crawl into an OKF repo');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }
    const baseName = slugify(filename || url);
    const repoDomain = domain || 'general';
    const headers = actor && actor.sub ? { 'x-actor-sub': actor.sub } : {};
    // silent: true — the dialog/list owns the user-facing error; a raw
    // failure here would otherwise pop a global toast from the interceptor.
    const created = await httpService.post(
      '/okf/repos/convert-from-crawl',
      {
        file_id: fileId,
        url: url || null,
        crawl_job_id: crawlJobId || null,
        split_mode: splitMode || 'B',
        name: baseName,
        domain: repoDomain
      },
      { headers, silent: true }
    );
    const repo = created && created.data ? created.data : null;
    if (!repo || !repo.repo_id) {
      const err = new Error('OKF conversion trigger returned no repo_id');
      err.code = 'CREATE_FAILED';
      throw err;
    }
    return repo;
  }
};

export default crawlerToOkfService;
