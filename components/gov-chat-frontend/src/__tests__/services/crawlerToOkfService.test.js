'use strict';

/**
 * Tests for crawlerToOkfService — the thin server-side trigger.
 *
 * Regression intent: the crawl→OKF conversion is a SERVER-SIDE async job
 * (okf-server services/crawl-conversion-service.js). The browser service
 * must ONLY derive the slug and POST /okf/repos/convert-from-crawl (202),
 * returning the created repo whose `conversion` field carries progress.
 * All download/split/sanitize/batch logic lives server-side now — none of
 * it may leak back into this service (it cannot scale to 10 GB in-browser).
 */

const mockPost = jest.fn();

jest.mock('@/services/httpService', () => ({
  get: jest.fn(),
  post: (...args) => mockPost(...args),
  put: jest.fn(),
  delete: jest.fn(),
  patch: jest.fn()
}));

const crawlerToOkfService = require('@/services/crawlerToOkfService').default;
const { slugify, MAX_NAME_ATTEMPTS } = require('@/services/crawlerToOkfService');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('crawlerToOkfService — slug derivation', () => {
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

  it('exposes the name-collision attempt budget fed to the server', () => {
    // The server owns the authoritative retry loop; MAX_NAME_ATTEMPTS only
    // documents the budget. Keep it aligned with the server's own constant.
    expect(MAX_NAME_ATTEMPTS).toBe(10);
  });
});

describe('crawlerToOkfService — convertCrawlToOkf (202 trigger)', () => {
  const REPO = { repo_id: 'repo-1', name: 'my-crawl', conversion: { status: 'queued' } };

  function mockCreated(repo) {
    mockPost.mockResolvedValueOnce({ status: 202, data: repo || REPO });
  }

  it('POSTs to /okf/repos/convert-from-crawl with the snake_case payload', async () => {
    mockCreated();
    await crawlerToOkfService.convertCrawlToOkf({
      fileId: 'f-123',
      url: 'https://www.example.com/crawl',
      crawlJobId: 'job-9',
      filename: 'My Crawl.md'
    });

    expect(mockPost).toHaveBeenCalledTimes(1);
    const [path, body] = mockPost.mock.calls[0];
    expect(path).toBe('/okf/repos/convert-from-crawl');
    expect(body).toEqual({
      file_id: 'f-123',
      url: 'https://www.example.com/crawl',
      crawl_job_id: 'job-9',
      split_mode: 'B',
      name: 'my-crawl',
      domain: 'general'
    });
  });

  it('defaults split_mode to B (per-page concepts)', async () => {
    mockCreated();
    await crawlerToOkfService.convertCrawlToOkf({ fileId: 'f-1' });
    expect(mockPost.mock.calls[0][1].split_mode).toBe('B');
  });

  it('passes split_mode A through for the single mega-concept mode', async () => {
    mockCreated();
    await crawlerToOkfService.convertCrawlToOkf({ fileId: 'f-1', splitMode: 'A' });
    expect(mockPost.mock.calls[0][1].split_mode).toBe('A');
  });

  it('prefers the filename over the URL for the repo name slug', async () => {
    mockCreated();
    await crawlerToOkfService.convertCrawlToOkf({
      fileId: 'f-1',
      url: 'https://en.wikipedia.org/wiki/ML',
      filename: 'ml-notes.md'
    });
    expect(mockPost.mock.calls[0][1].name).toBe('ml-notes');
  });

  it('slugifies the URL when no filename is given', async () => {
    mockCreated();
    await crawlerToOkfService.convertCrawlToOkf({ fileId: 'f-1', url: 'https://www.usa.gov/x' });
    expect(mockPost.mock.calls[0][1].name).toBe('usa-gov-x');
  });

  it('sends null url / crawl_job_id when not supplied', async () => {
    mockCreated();
    await crawlerToOkfService.convertCrawlToOkf({ fileId: 'f-1' });
    const body = mockPost.mock.calls[0][1];
    expect(body.url).toBeNull();
    expect(body.crawl_job_id).toBeNull();
  });

  it('defaults the domain to general unless overridden', async () => {
    mockCreated();
    await crawlerToOkfService.convertCrawlToOkf({ fileId: 'f-1', domain: 'agriculture' });
    expect(mockPost.mock.calls[0][1].domain).toBe('agriculture');
  });

  it('is silent — the dialog owns the user-facing error toast', async () => {
    mockCreated();
    await crawlerToOkfService.convertCrawlToOkf({ fileId: 'f-1' });
    const config = mockPost.mock.calls[0][2];
    expect(config.silent).toBe(true);
  });

  it('sends the x-actor-sub header when the actor has a sub', async () => {
    mockCreated();
    await crawlerToOkfService.convertCrawlToOkf({ fileId: 'f-1', actor: { sub: 'user-abc' } });
    expect(mockPost.mock.calls[0][2].headers).toEqual({ 'x-actor-sub': 'user-abc' });
  });

  it('sends no actor header when the actor has no sub', async () => {
    mockCreated();
    await crawlerToOkfService.convertCrawlToOkf({ fileId: 'f-1', actor: {} });
    expect(mockPost.mock.calls[0][2].headers).toEqual({});
  });

  it('returns the created repo (with its conversion field) as-is', async () => {
    mockCreated();
    const repo = await crawlerToOkfService.convertCrawlToOkf({ fileId: 'f-1' });
    expect(repo).toEqual(REPO);
    expect(repo.repo_id).toBe('repo-1');
  });

  it('rejects when the response is not the axios envelope (no .data)', async () => {
    // The service reads created.data only — a body-direct object carries no
    // repo envelope and must fail loudly rather than return a partial repo.
    mockPost.mockResolvedValueOnce({ repo_id: 'repo-2' });
    await expect(crawlerToOkfService.convertCrawlToOkf({ fileId: 'f-1' })).rejects.toMatchObject({
      code: 'CREATE_FAILED'
    });
  });

  it('rejects with VALIDATION_ERROR when fileId is missing', async () => {
    await expect(crawlerToOkfService.convertCrawlToOkf({})).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('rejects with CREATE_FAILED when the response carries no repo_id', async () => {
    mockPost.mockResolvedValueOnce({ status: 202, data: { name: 'orphan' } });
    await expect(crawlerToOkfService.convertCrawlToOkf({ fileId: 'f-1' })).rejects.toMatchObject({
      code: 'CREATE_FAILED'
    });
  });

  it('rejects with CREATE_FAILED when the response body is empty', async () => {
    mockPost.mockResolvedValueOnce({ status: 202, data: null });
    await expect(crawlerToOkfService.convertCrawlToOkf({ fileId: 'f-1' })).rejects.toMatchObject({
      code: 'CREATE_FAILED'
    });
  });

  it('propagates transport errors untouched (dialog maps the message)', async () => {
    const boom = new Error('Request failed with status code 403');
    boom.code = 'HTTP_403';
    mockPost.mockRejectedValueOnce(boom);
    await expect(crawlerToOkfService.convertCrawlToOkf({ fileId: 'f-1' })).rejects.toBe(boom);
  });
});
