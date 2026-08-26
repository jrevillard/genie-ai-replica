/**
 * crawlerToOkfService — convert a crawled document into a draft OKF repository.
 *
 * Fixes the Story 3-7 design gap: selecting "Create OKF repository" from the
 * crawler should produce an OKF repo with at least one concept (the crawled
 * content), NOT just a singleton .md file in the document repository.
 *
 * Flow (single-page crawl — the current production behaviour):
 *   1. POST /api/okf/repos            → create a draft repo (slug from URL/filename)
 *   2. GET  /api/files/:fileId/download → fetch the crawled markdown body
 *   3. POST /api/okf/repos/:id/ingest  → ingest a single concept derived from
 *                                       the body (title from filename/URL, body
 *                                       = the raw markdown)
 *   4. Return the upserted repo so the caller can switch the Studio tab into
 *      the wizard at Step 5 (Curate) with the concept ready.
 *
 * Multi-page (full-site async) crawls return ONE file_id whose markdown
 * contains all pages (the current crawler writes a single combined .md). The
 * v1 treats the combined file as ONE concept — a future iteration can split
 * on `## Source:` headers (the uploadLink controller's turndown output
 * prefixes each crawled page with that marker) to produce one concept per page.
 *
 * Permissions: matches Story 4.8/2.9.x — creating a repo requires tools-admin,
 * ingesting requires admin scope on the new repo. The actor passed in MUST
 * hold tools-admin (the only actor the crawler dialog currently allows).
 */

import repoOkfService from './repoOkfService';
import documentFileService from './documentFileService';
import httpService from './httpService';

/**
 * Slugify a URL or filename into a valid repo name. Mirrors the slug rules
 * used elsewhere (lowercase, replace non-alphanumerics with '-', collapse
 * repeats, trim leading/trailing '-', cap at 200 chars).
 *
 * @param {string} input
 * @returns {string}
 */
function slugify(input) {
  if (!input) return 'crawled-repository';
  return String(input)
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, '') // strip scheme + www.
    .replace(/\.(md|html|htm|txt)$/i, '') // strip extension if filename
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200) || 'crawled-repository';
}

/**
 * Pick a sensible title for the concept: prefer filename basename; fall back
 * to a slugified URL; final fallback "Crawled page".
 *
 * @param {string|null} filename
 * @param {string|null} url
 * @returns {string}
 */
function deriveConceptTitle(filename, url) {
  if (filename) {
    const base = String(filename).replace(/\.(md|html|htm|txt)$/i, '');
    return base.trim() || slugify(url);
  }
  if (url) return slugify(url);
  return 'Crawled page';
}

/**
 * Build the concept body. Strips the leading `## Source: <url>` line the
 * crawler prepends (turndown output — uploadLink in fileController.js) so the
 * concept's body starts at the actual content. Trim trailing whitespace.
 *
 * @param {string} rawMarkdown
 * @returns {string}
 */
function deriveConceptBody(rawMarkdown) {
  if (!rawMarkdown) return '';
  const withoutHeader = rawMarkdown.replace(/^## Source:.*\n+/i, '');
  return withoutHeader.trim();
}

const crawlerToOkfService = {
  /**
   * Create an OKF repo from a crawled document. See file header for the flow.
   *
   * @param {Object} input
   * @param {string} input.fileId       The doc-repo file_id of the crawled .md
   * @param {string} [input.url]        The crawled URL (used for slug + title)
   * @param {string} [input.crawlJobId] The crawl_job _key (audit + future use)
   * @param {string} [input.filename]   The original file_name (preferred for title)
   * @param {Object} [input.actor]      Auth hints (sub → x-actor-sub header)
   * @param {string} [input.domain]     Subject area (defaults to 'general')
   * @returns {Promise<Object>} The created + ingested OKF repo document
   */
  async convertCrawlToOkf({ fileId, url, crawlJobId, filename, actor, domain } = {}) {
    if (!fileId) {
      const err = new Error('fileId is required to convert a crawl into an OKF repo');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    // 1. Create the draft repo. lifecycle_state: 'draft' is the D-V5/4.8 default
    //    for fresh clones (and now crawls). name + domain + acl are required
    //    by createSchema (repository-validator.js:26-32).
    const repoName = slugify(filename || url);
    const repoDomain = domain || 'general';
    const acl = { tools_admin_scope: 'rw', user_scopes: { 'self': 'rw' } };
    const headers = actor && actor.sub ? { 'x-actor-sub': actor.sub } : {};
    const created = await httpService.post(
      '/okf/repos',
      { name: repoName, domain: repoDomain, acl, source: 'crawl' },
      { headers }
    );
    const repo = created && created.data ? created.data : null;
    if (!repo || !repo.repo_id) {
      const err = new Error('OKF repo creation returned no repo_id');
      err.code = 'CREATE_FAILED';
      throw err;
    }
    const repoId = repo.repo_id;

    // 2. Fetch the crawled markdown. If the download fails (e.g. the file was
    //    deleted between crawl completion and now) we still keep the empty
    //    repo — the steward can manually upload concepts in the Wizard.
    let body = '';
    try {
      body = await documentFileService.downloadFile(fileId);
    } catch (downloadErr) {
      console.warn('[crawlerToOkfService] downloadFile failed; returning repo without concepts', downloadErr);
    }

    // 3. Build + ingest the concept (single-page = 1 concept for v1).
    const conceptTitle = deriveConceptTitle(filename, url);
    const conceptBody = deriveConceptBody(body);
    if (conceptBody) {
      try {
        await httpService.post(
          `/okf/repos/${encodeURIComponent(repoId)}/ingest`,
          {
            concepts: [{
              concept_id: slugify(conceptTitle),
              title: conceptTitle,
              body: conceptBody,
              provenance: { sources: [{ kind: 'crawl', url, crawl_job_id: crawlJobId, file_id: fileId }] }
            }]
          },
          { headers }
        );
      } catch (ingestErr) {
        console.warn('[crawlerToOkfService] ingest failed; repo created without concepts', ingestErr);
        // Surface as a partial-success so the caller can still show the repo.
        const partialErr = new Error('OKF repo created but ingest failed');
        partialErr.code = 'INGEST_FAILED';
        partialErr.repo = repo;
        throw partialErr;
      }
    }

    // 4. Refresh the repo (ingest updated concept_count + status) so the
    //    Studio dashboard sees accurate counts immediately.
    try {
      const refreshed = await repoOkfService.get(repoId);
      if (refreshed) return refreshed;
    } catch {
      /* best-effort */
    }
    return repo;
  }
};

export default crawlerToOkfService;
export { slugify, deriveConceptTitle, deriveConceptBody };