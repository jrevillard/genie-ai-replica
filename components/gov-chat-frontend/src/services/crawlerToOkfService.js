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

/**
 * Story #978 — split the combined crawler .md into per-page concepts.
 * Mirrors the OKF ingest server's split: the crawler writes `## Source: <url>`
 * + body sections separated by `---`, so we split on that marker. One
 * concept per page; each carries its own `frontmatter.sources[0].resource`.
 *
 * Falls back to `buildMegaConcept` when no `## Source:` markers are found
 * (single-page crawl output).
 *
 * @param {string} raw  the full .md text from the crawler
 * @returns {Array<{path, frontmatter, body}>}
 */
function splitBySourceMarkers(raw) {
  if (!raw) return [];
  // Split on `## Source:` line boundaries (multiline). The URL is on the
  // marker line; the body is everything until the next marker (or EOF).
  // Simpler than a single lookahead-heavy regex — first split, then parse.
  const lines = raw.split('\n');
  const sections = []; // [{ url, bodyLines: [] }]
  let current = null;
  for (const line of lines) {
    const marker = line.match(/^## Source:\s*(.*?)\s*$/);
    if (marker) {
      if (current) sections.push(current);
      current = { url: marker[1].trim(), bodyLines: [] };
    } else if (current) {
      current.bodyLines.push(line);
    }
  }
  if (current) sections.push(current);

  const out = [];
  for (const s of sections) {
    // Drop the `---` separator the crawler writes between pages; then strip
    // lines that are just `---` (a body that's ONLY the separator is empty).
    const raw = s.bodyLines.join('\n');
    const stripped = raw.replace(/^---\s*\n?/, '');
    // Also drop any line that's ONLY '---' (the page separator) — that means
    // the section had no real content beyond the separator.
    const body = stripped
      .split('\n')
      .filter((line) => line.trim() !== '---')
      .join('\n')
      .trim();
    if (!body) continue;
    const path = urlToConceptPath(s.url);
    const title = deriveTitleFromBody(body) || s.url || path.replace(/\.md$/, '');
    out.push({
      path: path.endsWith('.md') ? path : `${path}.md`,
      frontmatter: {
        type: 'topic',
        title,
        sources: s.url ? [{ kind: 'crawl', resource: s.url }] : []
      },
      body
    });
  }
  if (out.length === 0) return buildMegaConcept(raw);
  return out;
}

function buildMegaConcept(raw) {
  const body = deriveConceptBody(raw);
  if (!body) return [];
  return [
    {
      path: 'crawl-mega.md',
      frontmatter: {
        type: 'topic',
        title: 'Crawled corpus',
        sources: []
      },
      body
    }
  ];
}

function urlToConceptPath(url) {
  if (!url) return 'crawl-concept';
  try {
    const u = new URL(url);
    const slug = (u.hostname + u.pathname)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return slug || 'crawl-concept';
  } catch {
    return 'crawl-concept';
  }
}

function deriveTitleFromBody(body) {
  if (!body) return null;
  const m = body.match(/^#{1,2}\s+(.+?)\s*$/m);
  return m ? m[1].trim() : null;
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
   * @param {string} [input.splitMode]  'A' (mega-concept) | 'B' (split per page, default) | 'C' (LLM, deferred)
   * @returns {Promise<Object>} The created + ingested OKF repo document
   */
  async convertCrawlToOkf({ fileId, url, crawlJobId, filename, actor, domain, splitMode } = {}) {
    if (!fileId) {
      const err = new Error('fileId is required to convert a crawl into an OKF repo');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    // 1. Create the repo. Per createSchema (repository-validator.js:26-32) we
    //    must send name + domain + acl. The HTTP route doesn't expose the
    //    service-layer lifecycle_state opt (no .unknown(true) on createSchema),
    //    so the repo comes back with the default lifecycle_state='register'.
    //    The wizard opens at Step 5 (Curate) and the dashboard's bucket
    //    mapping (store/modules/okf.js:160) treats 'register' as the
    //    'draft' lane — the steward can curate and mint normally.
    //
    //    Do NOT send `source: 'crawl'` — createSchema's sourceSchema is a
    //    structured object (type='git'|'s3'), not a free string. Crawl
    //    provenance is captured on the concept via provenance.sources[].kind.
    //
    //    ACL: only `required_scopes` + `sensitivity` are accepted by
    //    aclSchema. We default required_scopes to a domain-scoped admin
    //    scope (matches the test fixture in repos-routes.test.js:31).
    const repoName = slugify(filename || url);
    const repoDomain = domain || 'general';
    const acl = { required_scopes: [`okf:t:${repoDomain}:admin`] };
    const headers = actor && actor.sub ? { 'x-actor-sub': actor.sub } : {};
    const created = await httpService.post('/okf/repos', { name: repoName, domain: repoDomain, acl }, { headers });
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

    // 3. Build + ingest the concept(s). Story #978 — splitMode:
    //    'A' → one mega-concept (whole body)
    //    'B' → split on `## Source:` markers (one per crawled page, default)
    //    'C' → reserved for Story 10.6 LLM topic extraction (not built)
    // Per concept the ingest shape is
    // { path, frontmatter: { type, title, sources }, body } (matches
    // ingest-service.test.js:90). B2 hard error if frontmatter.type is
    // missing — type='topic' is the most permissive default.
    const mode = splitMode || 'B';
    let concepts;
    if (mode === 'A') {
      concepts = buildMegaConcept(body);
    } else if (mode === 'B') {
      concepts = splitBySourceMarkers(body);
    } else {
      // 'C' — Story 10.6 not built. Fail fast so the steward sees the gap.
      throw Object.assign(new Error('Split mode C (LLM extraction) is not yet shipped'), {
        code: 'MODE_NOT_IMPLEMENTED',
        partial: true,
        repo
      });
    }
    if (concepts.length > 0) {
      try {
        // Inject the crawl metadata (file_id + crawl_job_id) into each concept's
        // sources[] so the manifest + retract paths can trace back. Mode A and B
        // both produce concepts[]; mode B produces N per-page concepts.
        const conceptsWithMeta = concepts.map((c) => ({
          ...c,
          frontmatter: {
            ...c.frontmatter,
            sources: [
              ...(c.frontmatter.sources || []),
              ...(crawlJobId || fileId
                ? [
                    {
                      kind: 'crawl',
                      resource:
                        (c.frontmatter.sources && c.frontmatter.sources[0] && c.frontmatter.sources[0].resource) || url,
                      crawl_job_id: crawlJobId,
                      file_id: fileId
                    }
                  ]
                : [])
            ].filter((s, i, arr) => i === arr.findIndex((x) => x.resource === s.resource && x.kind === s.kind))
          }
        }));
        await httpService.post(
          `/okf/repos/${encodeURIComponent(repoId)}/ingest`,
          { concepts: conceptsWithMeta },
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
export { slugify, deriveConceptTitle, deriveConceptBody, splitBySourceMarkers, buildMegaConcept, urlToConceptPath };
