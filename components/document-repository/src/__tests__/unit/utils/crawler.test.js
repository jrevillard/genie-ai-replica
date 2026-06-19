'use strict';

jest.mock('axios', () => {
  const mockGet = jest.fn();
  return { get: mockGet, default: { get: mockGet } };
});

jest.mock('cheerio', () => {
  const mockLoad = jest.fn();
  return { load: mockLoad, default: { load: mockLoad } };
});

jest.mock('http', () => ({
  Agent: jest.fn().mockReturnValue({})
}));

jest.mock('https', () => ({
  Agent: jest.fn().mockReturnValue({})
}));

jest.mock('fs', () => ({
  createWriteStream: jest.fn(() => ({
    on: jest.fn((event, cb) => {
      if (event === 'finish') setTimeout(cb, 0);
    }),
    pipe: jest.fn()
  }))
}));

jest.mock(
  '../../../../shared-lib',
  () => ({
    logger: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    }
  }),
  { virtual: true }
);

const axios = require('axios');
const cheerio = require('cheerio');
const Crawler = require('../../../utils/crawler');

/**
 * Create a mock cheerio $ function.
 * cheerio.load(html) returns a callable function $ where:
 *   $('selector') → collection with .each(), .text(), .attr(), .find()
 *   $(element)   → wrapper with .attr() returning element.attribs[name]
 */
function makeMock$(elements = [], opts = {}) {
  const each = jest.fn((cb) => {
    elements.forEach((el, i) => cb(i, el));
  });
  const text = jest.fn().mockReturnValue(opts.titleText || '');
  const attr = jest.fn().mockReturnValue(opts.attrValue || null);
  const find = jest.fn();

  const collection = { each, text, attr, find };
  find.mockReturnValue(collection);

  const fn = jest.fn((selectorOrEl) => {
    if (selectorOrEl && typeof selectorOrEl === 'object' && selectorOrEl.attribs) {
      return { attr: jest.fn((name) => selectorOrEl.attribs[name] || null) };
    }
    return collection;
  });
  fn.each = each;
  fn.text = text;
  fn.attr = attr;
  fn.find = find;
  return fn;
}

describe('Crawler', () => {
  let crawler;

  beforeEach(() => {
    jest.clearAllMocks();
    crawler = new Crawler();
  });

  // --- constructor ---

  describe('constructor', () => {
    it('should create with default values', () => {
      expect(crawler.timeoutMs).toBe(10000);
      expect(crawler.pool).toBeNull();
      expect(crawler.config).toEqual({});
      expect(crawler.fetchedPool).toBeInstanceOf(Set);
      expect(crawler.domainCoolDowns).toBeInstanceOf(Map);
      expect(crawler.stats).toEqual({
        totalCrawled: 0,
        totalErrors: 0,
        errorCounts: {},
        linksInternal: 0,
        linksExternal: 0,
        queueSize: 0,
        currentDepth: 0
      });
    });

    it('should create with custom pool and timeout', () => {
      const c = new Crawler('http://example.com', 5000, { followExternalLinks: true });
      expect(c.pool).toBe('http://example.com');
      expect(c.timeoutMs).toBe(5000);
      expect(c.config.followExternalLinks).toBe(true);
    });

    it('should throw on invalid pool type (number)', () => {
      expect(() => new Crawler(123)).toThrow('url pool should be string, array or tuple');
    });

    it('should throw on invalid pool type (boolean)', () => {
      expect(() => new Crawler(true)).toThrow('url pool should be string, array or tuple');
    });

    it('should accept array pool', () => {
      const c = new Crawler(['http://a.com', 'http://b.com']);
      expect(c.pool).toEqual(['http://a.com', 'http://b.com']);
    });

    it('should accept object pool', () => {
      const c = new Crawler({ start: 'http://a.com' });
      expect(c.pool).toEqual({ start: 'http://a.com' });
    });

    it('should set config as empty object when null passed', () => {
      const c = new Crawler(null, 5000, null);
      expect(c.config).toEqual({});
    });
  });

  // --- getSublinks ---

  describe('getSublinks', () => {
    it('should extract href attributes from anchors', () => {
      const mock$ = makeMock$([
        { attribs: { href: '/link1' } },
        { attribs: { href: 'http://other.com/page' } },
        { attribs: {} }
      ]);
      const links = crawler.getSublinks(mock$);
      expect(links).toEqual(['/link1', 'http://other.com/page']);
    });

    it('should return empty array when no links', () => {
      const mock$ = makeMock$([]);
      const links = crawler.getSublinks(mock$);
      expect(links).toEqual([]);
    });
  });

  // --- getHyperlink ---

  describe('getHyperlink', () => {
    it('should return empty on invalid baseUrl', () => {
      const mock$ = makeMock$();
      const result = crawler.getHyperlink(mock$, 'not-a-url');
      expect(result).toEqual([]);
    });

    it('should filter out anchor links', () => {
      const mock$ = makeMock$([{ attribs: { href: '#section' } }, { attribs: { href: '#top' } }]);
      const result = crawler.getHyperlink(mock$, 'http://example.com');
      expect(result).toEqual([]);
    });

    it('should filter out javascript:, mailto:, tel: links', () => {
      const mock$ = makeMock$([
        { attribs: { href: 'javascript:void(0)' } },
        { attribs: { href: 'mailto:test@test.com' } },
        { attribs: { href: 'tel:+1234567890' } }
      ]);
      const result = crawler.getHyperlink(mock$, 'http://example.com');
      expect(result).toEqual([]);
    });

    it('should filter out None and undefined strings', () => {
      const mock$ = makeMock$([{ attribs: { href: 'None' } }, { attribs: { href: 'undefined' } }]);
      const result = crawler.getHyperlink(mock$, 'http://example.com');
      expect(result).toEqual([]);
    });

    it('should filter out cdn-cgi email protection links', () => {
      const mock$ = makeMock$([{ attribs: { href: '/cdn-cgi/l/email-protection#abc' } }]);
      const result = crawler.getHyperlink(mock$, 'http://example.com');
      expect(result).toEqual([]);
    });

    it('should filter out image/css/js/pdf/zip extensions', () => {
      const mock$ = makeMock$([
        { attribs: { href: 'http://example.com/img.jpg' } },
        { attribs: { href: '/style.css' } },
        { attribs: { href: '/app.js' } },
        { attribs: { href: '/doc.pdf' } },
        { attribs: { href: '/file.zip' } }
      ]);
      const result = crawler.getHyperlink(mock$, 'http://example.com');
      expect(result).toEqual([]);
    });

    it('should keep allowed extensions (html, htm, php, asp, aspx, jsp, cfm, cgi, pl)', () => {
      const mock$ = makeMock$([
        { attribs: { href: '/page.html' } },
        { attribs: { href: '/index.htm' } },
        { attribs: { href: '/form.php' } },
        { attribs: { href: '/page.asp' } },
        { attribs: { href: '/page.aspx' } },
        { attribs: { href: '/page.jsp' } },
        { attribs: { href: '/page.cfm' } },
        { attribs: { href: '/page.cgi' } },
        { attribs: { href: '/page.pl' } }
      ]);
      const result = crawler.getHyperlink(mock$, 'http://example.com');
      expect(result.length).toBe(9);
    });

    it('should deduplicate links', () => {
      const mock$ = makeMock$([{ attribs: { href: '/same-page' } }, { attribs: { href: '/same-page' } }]);
      const result = crawler.getHyperlink(mock$, 'http://example.com');
      expect(result).toEqual(['http://example.com/same-page']);
    });

    it('should resolve relative links against baseUrl', () => {
      const mock$ = makeMock$([{ attribs: { href: '/about' } }]);
      const result = crawler.getHyperlink(mock$, 'http://example.com');
      expect(result).toEqual(['http://example.com/about']);
    });

    it('should filter links with no pathname', () => {
      const mock$ = makeMock$([{ attribs: { href: 'http://example.com' } }]);
      const result = crawler.getHyperlink(mock$, 'http://example.com');
      expect(result).toEqual([]);
    });

    it('should strip hash from links', () => {
      const mock$ = makeMock$([{ attribs: { href: '/page#section' } }]);
      const result = crawler.getHyperlink(mock$, 'http://example.com');
      expect(result).toEqual(['http://example.com/page']);
    });

    it('should count internal and external links', () => {
      const mock$ = makeMock$([{ attribs: { href: '/internal' } }, { attribs: { href: 'http://other.com/page' } }]);
      crawler.config.followExternalLinks = true;
      crawler.getHyperlink(mock$, 'http://example.com');
      expect(crawler.stats.linksInternal).toBe(1);
      expect(crawler.stats.linksExternal).toBe(1);
    });

    it('should exclude external links when followExternalLinks is false', () => {
      const mock$ = makeMock$([{ attribs: { href: 'http://other.com/page' } }]);
      crawler.config.followExternalLinks = false;
      const result = crawler.getHyperlink(mock$, 'http://example.com');
      expect(result).toEqual([]);
      expect(crawler.stats.linksExternal).toBe(1);
    });

    it('should apply excludePatterns config', () => {
      crawler.config.excludePatterns = ['/private/', '/admin/'];
      const mock$ = makeMock$([
        { attribs: { href: '/private/page' } },
        { attribs: { href: '/admin/panel' } },
        { attribs: { href: '/public/page' } }
      ]);
      const result = crawler.getHyperlink(mock$, 'http://example.com');
      expect(result).toEqual(['http://example.com/public/page']);
    });

    it('should handle empty excludePatterns array', () => {
      crawler.config.excludePatterns = [];
      const mock$ = makeMock$([{ attribs: { href: '/page' } }]);
      const result = crawler.getHyperlink(mock$, 'http://example.com');
      expect(result).toEqual(['http://example.com/page']);
    });

    it('should skip null href (element with no attribs)', () => {
      const mock$ = makeMock$([{ attribs: {} }]);
      const result = crawler.getHyperlink(mock$, 'http://example.com');
      expect(result).toEqual([]);
    });

    it('should handle unparsable link URL gracefully', () => {
      const mock$ = makeMock$([{ attribs: { href: 'http://[invalid-bracket' } }]);
      const result = crawler.getHyperlink(mock$, 'http://example.com');
      expect(result).toEqual([]);
    });
  });

  // --- isDomainReady ---

  describe('isDomainReady', () => {
    it('should return true when no cooldown exists', () => {
      expect(crawler.isDomainReady('http://example.com')).toBe(true);
    });

    it('should return false when cooldown is active', () => {
      crawler.domainCoolDowns.set('example.com', Date.now() + 60000);
      expect(crawler.isDomainReady('http://example.com')).toBe(false);
    });

    it('should return true and delete cooldown when expired', () => {
      crawler.domainCoolDowns.set('example.com', Date.now() - 1000);
      expect(crawler.isDomainReady('http://example.com')).toBe(true);
      expect(crawler.domainCoolDowns.has('example.com')).toBe(false);
    });

    it('should return true on invalid URL', () => {
      expect(crawler.isDomainReady('not-a-url')).toBe(true);
    });
  });

  // --- triggerCoolDown ---

  describe('triggerCoolDown', () => {
    it('should set cooldown for domain', () => {
      crawler.triggerCoolDown('http://example.com', 60);
      expect(crawler.domainCoolDowns.has('example.com')).toBe(true);
      const readyTime = crawler.domainCoolDowns.get('example.com');
      expect(readyTime).toBeGreaterThan(Date.now());
    });

    it('should use default 60 seconds with jitter', () => {
      const before = Date.now();
      crawler.triggerCoolDown('http://example.com');
      const readyTime = crawler.domainCoolDowns.get('example.com');
      expect(readyTime).toBeGreaterThanOrEqual(before + 60000);
      expect(readyTime).toBeLessThanOrEqual(before + 65000);
    });

    it('should silently ignore invalid URLs', () => {
      expect(() => crawler.triggerCoolDown('not-a-url')).not.toThrow();
    });
  });

  // --- fetch ---

  describe('fetch', () => {
    it('should return response on status 200', async () => {
      const mockResponse = { status: 200, data: '<html></html>' };
      axios.get.mockResolvedValue(mockResponse);
      const result = await crawler.fetch('http://example.com');
      expect(result).toBe(mockResponse);
      expect(crawler.stats.totalCrawled).toBe(1);
    });

    it('should retry on non-200 status', async () => {
      axios.get
        .mockResolvedValueOnce({ status: 500, data: '' })
        .mockResolvedValueOnce({ status: 200, data: '<html></html>' });
      const result = await crawler.fetch('http://example.com', null, 3);
      expect(result.status).toBe(200);
      expect(axios.get).toHaveBeenCalledTimes(2);
    });

    it('should throw after max retries', async () => {
      axios.get.mockResolvedValue({ status: 500, data: '' });
      await expect(crawler.fetch('http://example.com', null, 2)).rejects.toThrow('fail to fetch');
      expect(crawler.stats.totalErrors).toBe(1);
    });

    it('should handle timeout errors (ECONNABORTED)', async () => {
      const timeoutError = new Error('timeout');
      timeoutError.code = 'ECONNABORTED';
      axios.get.mockRejectedValue(timeoutError);
      await expect(crawler.fetch('http://example.com', null, 1)).rejects.toThrow('Timeout');
    });

    it('should handle connection errors', async () => {
      axios.get.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(crawler.fetch('http://example.com', null, 1)).rejects.toThrow('ECONNREFUSED');
    });

    it('should prepend http:// if no protocol', async () => {
      axios.get.mockResolvedValue({ status: 200, data: '<html></html>' });
      await crawler.fetch('example.com');
      expect(axios.get).toHaveBeenCalledWith('http://example.com', expect.objectContaining({ timeout: 10000 }));
    });

    it('should track error counts by status code', async () => {
      axios.get.mockResolvedValue({ status: 404, data: '' });
      await expect(crawler.fetch('http://example.com', null, 1)).rejects.toThrow();
      expect(crawler.stats.errorCounts[404]).toBe(1);
    });

    it('should pass custom headers', async () => {
      axios.get.mockResolvedValue({ status: 200, data: '' });
      const customHeaders = { 'X-Custom': 'value' };
      await crawler.fetch('http://example.com', customHeaders, 1);
      expect(axios.get).toHaveBeenCalledWith('http://example.com', expect.objectContaining({ headers: customHeaders }));
    });

    it('should add delay on 403 then retry successfully', async () => {
      jest.useFakeTimers();
      axios.get
        .mockResolvedValueOnce({ status: 403, data: '' })
        .mockResolvedValueOnce({ status: 200, data: '<html></html>' });
      const promise = crawler.fetch('http://example.com', null, 3);
      await jest.advanceTimersByTimeAsync(3500);
      const result = await promise;
      expect(result.status).toBe(200);
      jest.useRealTimers();
    });
  });

  // --- getTitle ---

  describe('getTitle', () => {
    it('should extract title from HTML', () => {
      const mock$ = makeMock$([], { titleText: 'My Page' });
      cheerio.load.mockReturnValue(mock$);
      expect(crawler.getTitle('<html><head><title>My Page</title></head></html>')).toBe('My Page');
    });

    it('should return "untitled" when no title', () => {
      const mock$ = makeMock$([], { titleText: '' });
      cheerio.load.mockReturnValue(mock$);
      expect(crawler.getTitle('<html></html>')).toBe('untitled');
    });

    it('should return "untitled" on parse error', () => {
      cheerio.load.mockImplementation(() => {
        throw new Error('bad html');
      });
      expect(crawler.getTitle('not html')).toBe('untitled');
    });
  });

  // --- getLanguage ---

  describe('getLanguage', () => {
    it('should extract lang attribute', () => {
      const mock$ = makeMock$([], { attrValue: 'en-US' });
      cheerio.load.mockReturnValue(mock$);
      expect(crawler.getLanguage('<html lang="en-US">')).toBe('en');
    });

    it('should return empty string when no lang found', () => {
      const mock$ = makeMock$([], { attrValue: null });
      cheerio.load.mockReturnValue(mock$);
      expect(crawler.getLanguage('<html>')).toBe('');
    });

    it('should return empty string on error', () => {
      cheerio.load.mockImplementation(() => {
        throw new Error('bad');
      });
      expect(crawler.getLanguage('')).toBe('');
    });
  });

  // --- parse ---

  describe('parse', () => {
    it('should call cheerio.load and return result', () => {
      const mock$ = makeMock$();
      cheerio.load.mockReturnValue(mock$);
      expect(crawler.parse('<html></html>')).toBe(mock$);
      expect(cheerio.load).toHaveBeenCalledWith('<html></html>');
    });
  });

  // --- getBaseUrl ---

  describe('getBaseUrl', () => {
    it('should extract protocol and hostname', () => {
      expect(crawler.getBaseUrl('http://example.com/path/page?q=1')).toBe('http://example.com');
    });

    it('should handle https', () => {
      expect(crawler.getBaseUrl('https://secure.example.com/page')).toBe('https://secure.example.com');
    });

    it('should return url as-is on parse error', () => {
      expect(crawler.getBaseUrl('not-a-url')).toBe('not-a-url');
    });
  });

  // --- cleanText ---

  describe('cleanText', () => {
    it('should normalize whitespace and newlines', () => {
      expect(crawler.cleanText('  hello   world  ')).toBe('hello world');
    });

    it('should replace \\r with \\n', () => {
      expect(crawler.cleanText('line1\rline2')).toBe('line1\nline2');
    });

    it('should collapse multiple newlines', () => {
      expect(crawler.cleanText('a\n\n\nb')).toBe('a\nb');
    });

    it('should remove blank lines', () => {
      expect(crawler.cleanText('a\n  \nb')).toBe('a\nb');
    });

    it('should handle empty string', () => {
      expect(crawler.cleanText('')).toBe('');
    });

    it('should convert null to string "null"', () => {
      // Source uses String(null) which produces "null"
      expect(crawler.cleanText(null)).toBe('null');
    });

    it('should convert undefined to empty after trim', () => {
      // String(undefined) = "undefined", but after trim of whitespace...
      // Actually String(undefined) = "undefined" which is truthy
      expect(crawler.cleanText(undefined)).toBe('undefined');
    });
  });

  // --- processWork ---

  describe('processWork', () => {
    it('should fetch, parse, extract links and call work callback', async () => {
      axios.get.mockResolvedValue({ status: 200, data: '<html></html>' });
      const mock$ = makeMock$([{ attribs: { href: '/page' } }]);
      cheerio.load.mockReturnValue(mock$);

      const workCallback = jest.fn();
      const links = await crawler.processWork('http://example.com', workCallback);
      expect(crawler.fetchedPool.has('http://example.com')).toBe(true);
      expect(workCallback).toHaveBeenCalledWith('http://example.com', mock$);
      expect(Array.isArray(links)).toBe(true);
    });

    it('should return empty on fetch failure (non-critical)', async () => {
      axios.get.mockRejectedValue(new Error('Connection refused'));
      const links = await crawler.processWork('http://example.com');
      expect(links).toEqual([]);
      expect(crawler.fetchedPool.has('http://example.com')).toBe(true);
    });

    it('should propagate DomainRateLimited error', async () => {
      axios.get.mockRejectedValue(new Error('DomainRateLimited'));
      await expect(crawler.processWork('http://example.com')).rejects.toThrow('DomainRateLimited');
    });

    it('should propagate kill errors (lowercase)', async () => {
      axios.get.mockRejectedValue(new Error('killed'));
      await expect(crawler.processWork('http://example.com')).rejects.toThrow('killed');
    });

    it('should propagate MaxPagesReached error', async () => {
      axios.get.mockRejectedValue(new Error('MaxPagesReached'));
      await expect(crawler.processWork('http://example.com')).rejects.toThrow('MaxPagesReached');
    });

    it('should propagate Killed (capital K) error', async () => {
      axios.get.mockRejectedValue(new Error('Killed'));
      await expect(crawler.processWork('http://example.com')).rejects.toThrow('Killed');
    });

    it('should return empty when work callback is null', async () => {
      axios.get.mockResolvedValue({ status: 200, data: '<html></html>' });
      const mock$ = makeMock$([{ attribs: { href: '/page' } }]);
      cheerio.load.mockReturnValue(mock$);
      const links = await crawler.processWork('http://example.com', null);
      expect(Array.isArray(links)).toBe(true);
    });
  });

  // --- crawl ---

  describe('crawl', () => {
    it('should process seed URL and stop (maxDepth=0)', async () => {
      axios.get.mockResolvedValue({ status: 200, data: '<html></html>' });
      const mock$ = makeMock$([]); // no sublinks
      cheerio.load.mockReturnValue(mock$);

      await crawler.crawl('http://example.com', null, 0, 1);
      expect(crawler.fetchedPool.has('http://example.com')).toBe(true);
    });

    it('should call work callback for seed URL', async () => {
      axios.get.mockResolvedValue({ status: 200, data: '<html></html>' });
      const mock$ = makeMock$([]);
      cheerio.load.mockReturnValue(mock$);
      const work = jest.fn();

      await crawler.crawl('http://example.com', work, 0, 1);
      expect(work).toHaveBeenCalledWith('http://example.com', mock$);
    });

    it('should call metricsUpdateFn during crawl', async () => {
      axios.get.mockResolvedValue({ status: 200, data: '<html></html>' });
      const mock$ = makeMock$([]);
      cheerio.load.mockReturnValue(mock$);
      const metricsFn = jest.fn().mockResolvedValue(undefined);

      await crawler.crawl('http://example.com', null, 0, 1, metricsFn);
      expect(metricsFn).toHaveBeenCalled();
    });

    it('should accept array pool', async () => {
      axios.get.mockResolvedValue({ status: 200, data: '<html></html>' });
      const mock$ = makeMock$([]);
      cheerio.load.mockReturnValue(mock$);

      await crawler.crawl(['http://a.com', 'http://b.com'], null, 0, 1);
      expect(crawler.fetchedPool.has('http://a.com')).toBe(true);
      expect(crawler.fetchedPool.has('http://b.com')).toBe(true);
    });

    it('should handle seed fetch failure gracefully (resolves)', async () => {
      axios.get.mockRejectedValue(new Error('Connection refused'));
      await crawler.crawl('http://example.com', null, 0, 1);
      expect(crawler.fetchedPool.has('http://example.com')).toBe(false);
    });

    it('should reject on DomainRateLimited seed error', async () => {
      axios.get.mockRejectedValue(new Error('DomainRateLimited'));
      await expect(crawler.crawl('http://example.com', null, 0, 1)).rejects.toThrow('Seed Rate Limited');
    });

    it('should resolve (not throw) on MaxPagesReached from seed', async () => {
      // Outer catch catches MaxPagesReached and returns
      axios.get.mockRejectedValue(new Error('MaxPagesReached'));
      await expect(crawler.crawl('http://example.com', null, 0, 1)).resolves.toBeUndefined();
    });

    it('should re-throw killed from seed (outer catch re-throws)', async () => {
      axios.get.mockRejectedValue(new Error('killed'));
      await expect(crawler.crawl('http://example.com', null, 0, 1)).rejects.toThrow('killed');
    });

    it('should process sublinks at depth 1 when seed returns links', async () => {
      const seed$ = makeMock$([{ attribs: { href: '/page1' } }]);
      const depth$ = makeMock$([]); // depth 1 page has no further links
      cheerio.load
        .mockReturnValueOnce(seed$) // seed parse
        .mockReturnValueOnce(depth$); // depth 1 parse
      axios.get
        .mockResolvedValueOnce({ status: 200, data: '<html>seed</html>' })
        .mockResolvedValueOnce({ status: 200, data: '<html>depth1</html>' });

      await crawler.crawl('http://example.com', null, 1, 1);
      expect(crawler.fetchedPool.has('http://example.com')).toBe(true);
      expect(crawler.fetchedPool.has('http://example.com/page1')).toBe(true);
      expect(axios.get).toHaveBeenCalledTimes(2);
    });

    it('should add failed DomainRateLimited URLs to next depth', async () => {
      const seed$ = makeMock$([{ attribs: { href: '/page1' } }]);
      const depth$ = makeMock$([]);
      cheerio.load.mockReturnValueOnce(seed$).mockReturnValueOnce(depth$);
      axios.get
        .mockResolvedValueOnce({ status: 200, data: '<html>seed</html>' })
        .mockRejectedValueOnce(new Error('DomainRateLimited'))
        .mockResolvedValueOnce({ status: 200, data: '<html>d1</html>' });

      await crawler.crawl('http://example.com', null, 1, 1);
      expect(crawler.fetchedPool.has('http://example.com')).toBe(true);
      expect(crawler.fetchedPool.has('http://example.com/page1')).toBe(true);
    });

    it('should pause and re-queue when all URLs are rate-limited', async () => {
      jest.useFakeTimers();
      const seed$ = makeMock$([{ attribs: { href: '/page1' } }]);
      void makeMock$([]);
      cheerio.load.mockReturnValue(seed$);
      axios.get
        .mockResolvedValueOnce({ status: 200, data: '<html>seed</html>' })
        .mockResolvedValueOnce({ status: 200, data: '<html>d1</html>' });
      crawler.domainCoolDowns.set('example.com', Date.now() + 60000);

      const promise = crawler.crawl('http://example.com', null, 1, 1);
      await jest.advanceTimersByTimeAsync(6000);
      await promise;
      jest.useRealTimers();
      expect(crawler.fetchedPool.has('http://example.com')).toBe(true);
    });

    it('should handle MaxPagesReached in depth batch (outer catch returns)', async () => {
      const seed$ = makeMock$([{ attribs: { href: '/page1' } }]);
      cheerio.load.mockReturnValue(seed$);
      axios.get
        .mockResolvedValueOnce({ status: 200, data: '<html>seed</html>' })
        .mockRejectedValueOnce(new Error('MaxPagesReached'));

      // Should NOT throw — outer catch returns on MaxPagesReached
      await crawler.crawl('http://example.com', null, 2, 1);
      expect(crawler.fetchedPool.has('http://example.com')).toBe(true);
    });

    it('should handle killed in depth batch (outer catch re-throws)', async () => {
      const seed$ = makeMock$([{ attribs: { href: '/page1' } }]);
      cheerio.load.mockReturnValue(seed$);
      axios.get
        .mockResolvedValueOnce({ status: 200, data: '<html>seed</html>' })
        .mockRejectedValueOnce(new Error('killed'));

      // 'killed' includes('killed') so outer catch re-throws
      await expect(crawler.crawl('http://example.com', null, 2, 1)).rejects.toThrow('killed');
    });

    it('should stop when depth reaches maxDepth', async () => {
      const seed$ = makeMock$([{ attribs: { href: '/page1' } }]);
      const depth$ = makeMock$([{ attribs: { href: '/page2' } }]);
      cheerio.load.mockReturnValue(seed$);
      // Only seed succeeds; depth 1 fetch returns sublinks but we stop at maxDepth=1
      axios.get
        .mockResolvedValueOnce({ status: 200, data: '<html>seed</html>' })
        .mockResolvedValueOnce({ status: 200, data: '<html>d1</html>' });

      // maxDepth=1: seed processed, then depth 0 processes page1, finds page2
      // page2 queued for depth 1 but loop exits since depth < maxDepth (1 < 1 = false)
      cheerio.load.mockReturnValueOnce(depth$);
      await crawler.crawl('http://example.com', null, 1, 1);
      // Actually depth loop starts at 0, maxDepth=1, so depth 0 runs
      // After depth 0, page2 added, depth becomes 1, 1 < 1 = false → exit
      expect(axios.get).toHaveBeenCalledTimes(2); // seed + page1
    });

    it('should skip already-fetched URLs in depth processing', async () => {
      const seed$ = makeMock$([{ attribs: { href: '/page1' } }]);
      cheerio.load.mockReturnValue(seed$);
      axios.get
        .mockResolvedValueOnce({ status: 200, data: '<html>seed</html>' })
        .mockResolvedValueOnce({ status: 200, data: '<html>d1</html>' });

      // Pre-add page1 to fetchedPool so depth 0 skips it
      crawler.fetchedPool.add('http://example.com/page1');
      await crawler.crawl('http://example.com', null, 1, 1);
      // Only seed fetched (page1 already in pool)
      expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it('should break when batch and deferred are both empty', async () => {
      // Seed returns no sublinks → depth 0 has 0 URLs → immediate break
      const seed$ = makeMock$([]);
      cheerio.load.mockReturnValue(seed$);
      axios.get.mockResolvedValue({ status: 200, data: '<html></html>' });

      await crawler.crawl('http://example.com', null, 5, 1);
      expect(axios.get).toHaveBeenCalledTimes(1); // only seed
    });
  });

  // --- download ---

  describe('download', () => {
    it('should pipe response to write stream', async () => {
      const mockResponse = {
        data: { pipe: jest.fn() },
        status: 200
      };
      axios.get.mockResolvedValue(mockResponse);

      await crawler.download('http://example.com/file.pdf', '/tmp/file.pdf');
      expect(axios.get).toHaveBeenCalledWith(
        'http://example.com/file.pdf',
        expect.objectContaining({ responseType: 'stream' })
      );
    });

    it('should handle download errors gracefully', async () => {
      axios.get.mockRejectedValue(new Error('Network error'));
      await crawler.download('http://example.com/file.pdf', '/tmp/file.pdf');
    });
  });
});
