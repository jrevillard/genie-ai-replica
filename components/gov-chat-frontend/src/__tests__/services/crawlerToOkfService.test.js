'use strict';

/**
 * Tests for crawlerToOkfService — the Story 3-7 fix (#977).
 *
 * Regression intent: selecting "Create OKF repository" from the crawler must
 * produce a draft OKF repo with the crawled content ingested as a concept,
 * NOT a singleton .md file. The freeform (Document) path is preserved and
 * untouched — this test only exercises the OKF conversion.
 */

const mockPost = jest.fn();
const mockGet = jest.fn();

jest.mock('@/services/httpService', () => ({
  get: (...args) => mockGet(...args),
  post: (...args) => mockPost(...args),
  put: jest.fn(),
  delete: jest.fn(),
  patch: jest.fn()
}));

const mockRepoOkfService = {
  get: jest.fn()
};

jest.mock('@/services/repoOkfService', () => mockRepoOkfService);

const mockDownloadFile = jest.fn();

jest.mock('@/services/documentFileService', () => ({
  downloadFile: (...args) => mockDownloadFile(...args)
}));

const crawlerToOkfService = require('@/services/crawlerToOkfService').default;
const { slugify, deriveConceptTitle, deriveConceptBody } = require('@/services/crawlerToOkfService');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('crawlerToOkfService — slug helpers', () => {
  describe('slugify', () => {
    it('strips http(s) scheme and www. prefix', () => {
      expect(slugify('https://www.example.com/path/to/article')).toBe('example-com-path-to-article');
    });

    it('replaces non-alphanumerics with single dash and trims', () => {
      expect(slugify('Foo  Bar__Baz!!')).toBe('foo-bar-baz');
    });

    it('caps the slug at 200 characters', () => {
      const long = 'a'.repeat(500);
      expect(slugify(long).length).toBeLessThanOrEqual(200);
    });

    it('falls back to a default slug for empty / falsy input', () => {
      expect(slugify('')).toBe('crawled-repository');
      expect(slugify(null)).toBe('crawled-repository');
      expect(slugify(undefined)).toBe('crawled-repository');
    });

    it('strips common markdown / html extensions', () => {
      expect(slugify('My Article.md')).toBe('my-article');
      expect(slugify('My Article.html')).toBe('my-article');
    });
  });

  describe('deriveConceptTitle', () => {
    it('prefers the filename basename over the URL', () => {
      expect(deriveConceptTitle('wikipedia-ml.md', 'https://en.wikipedia.org/wiki/Machine_learning'))
        .toBe('wikipedia-ml');
    });

    it('falls back to a slugified URL when filename is absent', () => {
      expect(deriveConceptTitle(null, 'https://example.com/Some Path/'))
        .toBe('example-com-some-path');
    });

    it('returns "Crawled page" when nothing is supplied', () => {
      expect(deriveConceptTitle(null, null)).toBe('Crawled page');
    });
  });

  describe('deriveConceptBody', () => {
    it('strips the leading "## Source: <url>" header the crawler prepends', () => {
      const raw = '## Source: https://example.com/article\n\n# Heading\n\nBody content.';
      expect(deriveConceptBody(raw)).toBe('# Heading\n\nBody content.');
    });

    it('returns trimmed content for input without the source header', () => {
      expect(deriveConceptBody('  body content  ')).toBe('body content');
    });

    it('returns empty string for empty / nullish input', () => {
      expect(deriveConceptBody('')).toBe('');
      expect(deriveConceptBody(null)).toBe('');
      expect(deriveConceptBody(undefined)).toBe('');
    });
  });
});

describe('crawlerToOkfService.convertCrawlToOkf', () => {
  it('rejects calls without a fileId', async () => {
    await expect(crawlerToOkfService.convertCrawlToOkf({ url: 'x' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('happy path: creates repo, downloads content, ingests one concept', async () => {
    const createdRepo = {
      repo_id: 'r-new-1',
      name: 'wikipedia-ml',
      domain: 'general',
      lifecycle_state: 'draft',
      concept_count: 0
    };
    mockPost
      .mockResolvedValueOnce({ data: createdRepo }) // POST /okf/repos
      .mockResolvedValueOnce({ data: { ok: true } }); // POST /okf/repos/:id/ingest
    mockDownloadFile.mockResolvedValueOnce(
      '## Source: https://en.wikipedia.org/wiki/Machine_learning\n\n# Machine learning\n\nIntro body.'
    );
    mockRepoOkfService.get.mockResolvedValueOnce({
      ...createdRepo,
      concept_count: 1
    });

    const result = await crawlerToOkfService.convertCrawlToOkf({
      fileId: 'file-1',
      url: 'https://en.wikipedia.org/wiki/Machine_learning',
      crawlJobId: 'job-1',
      filename: 'wikipedia-ml.md',
      actor: { sub: 'crawler-to-okf' },
      domain: 'education'
    });

    expect(mockPost).toHaveBeenCalledTimes(2);
    // First call: POST /okf/repos with slugified name + domain + acl
    expect(mockPost.mock.calls[0][0]).toBe('/okf/repos');
    expect(mockPost.mock.calls[0][1]).toMatchObject({
      name: 'wikipedia-ml',
      domain: 'education',
      acl: { required_scopes: ['okf:t:education:admin'] }
      // source is intentionally NOT sent: createSchema's source field is a
      // structured object (type='git'|'s3'), not a free string. Crawl
      // provenance lives on the concept itself via ingest.
      // Also: only `required_scopes` + `sensitivity` are accepted by
      // aclSchema; my v1 sent invented `tools_admin_scope`/`user_scopes` keys
      // that the validator rejected (verified live 2026-08-26).
    });
    // Also assert no source key leaks into the payload
    expect(Object.prototype.hasOwnProperty.call(mockPost.mock.calls[0][1], 'source')).toBe(false);
    // actor.sub → x-actor-sub header
    expect(mockPost.mock.calls[0][2]).toEqual({ headers: { 'x-actor-sub': 'crawler-to-okf' } });
    // Second call: POST /okf/repos/:id/ingest with one concept (header stripped)
    expect(mockPost.mock.calls[1][0]).toBe('/okf/repos/r-new-1/ingest');
    // Ingest payload shape (ingest-service.test.js:90): { frontmatter, body, path }
    // — NOT { title, body, provenance } at the top level. B2 hard error
    // when frontmatter.type is missing.
    expect(mockPost.mock.calls[1][1]).toMatchObject({
      concepts: [{
        path: 'wikipedia-ml.md',
        frontmatter: {
          type: 'topic',
          title: 'wikipedia-ml',
          sources: [{
            kind: 'crawl',
            resource: 'https://en.wikipedia.org/wiki/Machine_learning',
            crawl_job_id: 'job-1',
            file_id: 'file-1'
          }]
        },
        body: '# Machine learning\n\nIntro body.'
      }]
    });
    expect(result).toMatchObject({ repo_id: 'r-new-1', concept_count: 1 });
  });

  it('uses "general" domain when no domain is supplied', async () => {
    mockPost
      .mockResolvedValueOnce({ data: { repo_id: 'r-x', name: 'x', domain: 'general' } })
      .mockResolvedValueOnce({ data: { ok: true } });
    mockDownloadFile.mockResolvedValueOnce('# Body');
    mockRepoOkfService.get.mockResolvedValueOnce({ repo_id: 'r-x' });

    await crawlerToOkfService.convertCrawlToOkf({
      fileId: 'file-x',
      url: 'https://example.com/x',
      filename: 'x.md'
    });
    expect(mockPost.mock.calls[0][1].domain).toBe('general');
  });

  it('skips ingest when the download fails (partial success — repo still returned)', async () => {
    const createdRepo = { repo_id: 'r-partial', name: 'x', domain: 'general' };
    mockPost.mockResolvedValueOnce({ data: createdRepo });
    mockDownloadFile.mockRejectedValueOnce(new Error('file not found'));
    mockRepoOkfService.get.mockResolvedValueOnce(createdRepo);

    const result = await crawlerToOkfService.convertCrawlToOkf({
      fileId: 'file-missing',
      url: 'https://example.com/missing',
      filename: 'missing.md'
    });

    // Only the create POST fires; ingest is skipped (download failed).
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost.mock.calls[0][0]).toBe('/okf/repos');
    expect(result).toMatchObject({ repo_id: 'r-partial' });
  });

  it('surfaces INGEST_FAILED with the created repo when ingest itself throws', async () => {
    const createdRepo = { repo_id: 'r-ingest-fail', name: 'x', domain: 'general' };
    mockPost
      .mockResolvedValueOnce({ data: createdRepo })
      .mockRejectedValueOnce(new Error('dataprep 503'));
    mockDownloadFile.mockResolvedValueOnce('# Body');

    await expect(crawlerToOkfService.convertCrawlToOkf({
      fileId: 'file-ingest-fail',
      url: 'https://example.com/ingest-fail',
      filename: 'ingest-fail.md'
    })).rejects.toMatchObject({
      code: 'INGEST_FAILED',
      repo: { repo_id: 'r-ingest-fail' }
    });
  });

  it('throws CREATE_FAILED when the server returns no repo_id', async () => {
    mockPost.mockResolvedValueOnce({ data: { name: 'x' } });

    await expect(crawlerToOkfService.convertCrawlToOkf({
      fileId: 'file-1',
      url: 'https://example.com',
      filename: 'x.md'
    })).rejects.toMatchObject({ code: 'CREATE_FAILED' });
  });

  it('skips ingest entirely when the downloaded body is empty', async () => {
    mockPost.mockResolvedValueOnce({ data: { repo_id: 'r-empty', name: 'x', domain: 'general' } });
    mockDownloadFile.mockResolvedValueOnce('   '); // whitespace only → empty after trim
    mockRepoOkfService.get.mockResolvedValueOnce({ repo_id: 'r-empty' });

    const result = await crawlerToOkfService.convertCrawlToOkf({
      fileId: 'file-empty',
      url: 'https://example.com/empty',
      filename: 'empty.md'
    });

    expect(mockPost).toHaveBeenCalledTimes(1); // only create; no ingest
    expect(result).toMatchObject({ repo_id: 'r-empty' });
  });
});