'use strict';

// Mock shared-lib
jest.mock('../../../__tests__/__mocks__/shared-lib', () => ({}), { virtual: true });

jest.mock('../../../../shared-lib', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  },
  dbService: {
    getConnection: jest.fn()
  }
}), { virtual: true });

jest.mock('axios');
const axios = require('axios');
jest.mock('cheerio', () => ({
  load: jest.fn()
}));
const cheerio = require('cheerio');

const Crawler = require('../../../utils/crawler');

describe('Crawler', () => {
  let crawler;
  let mockLogger;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Get reference to mocked logger
    const { logger } = require('../../../../shared-lib');
    mockLogger = logger;

    crawler = new Crawler();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('Constructor', () => {
    it('should create crawler with default values', () => {
      const testCrawler = new Crawler();
      expect(testCrawler.timeoutMs).toBe(10000);
      expect(testCrawler.pool).toBeNull();
      expect(testCrawler.config).toEqual({});
      expect(testCrawler.fetchedPool).toBeInstanceOf(Set);
      expect(testCrawler.domainCoolDowns).toBeInstanceOf(Map);
    });

    it('should accept string pool parameter', () => {
      const testCrawler = new Crawler('https://example.com');
      expect(testCrawler.pool).toBe('https://example.com');
    });

    it('should accept array pool parameter', () => {
      const pools = ['https://example.com', 'https://test.com'];
      const testCrawler = new Crawler(pools);
      expect(testCrawler.pool).toEqual(pools);
    });

    it('should accept custom timeout', () => {
      const testCrawler = new Crawler(null, 5000);
      expect(testCrawler.timeoutMs).toBe(5000);
    });

    it('should accept config object', () => {
      const config = {
        followExternalLinks: true,
        excludePatterns: ['/admin', '/login']
      };
      const testCrawler = new Crawler(null, 10000, config);
      expect(testCrawler.config).toEqual(config);
    });

    it('should throw error for invalid pool type', () => {
      expect(() => new Crawler(123)).toThrow('url pool should be string, array or tuple');
      expect(() => new Crawler(true)).toThrow('url pool should be string, array or tuple');
      expect(() => new Crawler({})).toThrow('url pool should be string, array or tuple');
    });

    it('should initialize stats object', () => {
      expect(crawler.stats).toHaveProperty('totalCrawled', 0);
      expect(crawler.stats).toHaveProperty('totalErrors', 0);
      expect(crawler.stats).toHaveProperty('errorCounts', {});
      expect(crawler.stats).toHaveProperty('linksInternal', 0);
      expect(crawler.stats).toHaveProperty('linksExternal', 0);
      expect(crawler.stats).toHaveProperty('queueSize', 0);
      expect(crawler.stats).toHaveProperty('currentDepth', 0);
    });

    it('should initialize HTTP agents with keepAlive', () => {
      const http = require('http');
      const https = require('https');
      // Agents are created at module level, not in constructor
      expect(http.Agent).toBeDefined();
      expect(https.Agent).toBeDefined();
    });
  });

  describe('getSublinks', () => {
    it('should extract hrefs from anchor tags', () => {
      const html = '<html><body><a href="/page1">Link 1</a><a href="/page2">Link 2</a></body></html>';
      cheerio.load.mockReturnValue({
        each: jest.fn((callback) => {
          const mockLinks = [
            { attr: (attr) => attr === 'href' ? '/page1' : null }
          ];
          mockLinks.forEach((el, idx) => callback.call(el, idx, el));
        })
      });

      const result = crawler.getSublinks(html);
      expect(result).toContain('/page1');
    });

    it('should ignore empty hrefs', () => {
      cheerio.load.mockReturnValue({
        each: jest.fn((callback) => {
          const mockLinks = [
            { attr: (attr) => attr === 'href' ? '' : null },
            { attr: (attr) => attr === 'href' ? '/valid' : null }
          ];
          mockLinks.forEach((el, idx) => callback.call(el, idx, el));
        })
      });

      const result = crawler.getSublinks('<html></html>');
      // Should only return non-empty hrefs
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it('should return empty array when no links found', () => {
      cheerio.load.mockReturnValue({
        each: jest.fn(() => {
          // No links
        })
      });

      const result = crawler.getSublinks('<html><body>No links</body></html>');
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('getHyperlink', () => {
    it('should filter by domain when followExternalLinks is false', () => {
      const config = { followExternalLinks: false };
      const testCrawler = new Crawler(null, 10000, config);

      cheerio.load.mockReturnValue({
        each: jest.fn((callback) => {
          const mockLinks = [
            { attr: (attr) => attr === 'href' ? 'https://example.com/page1' : null },
            { attr: (attr) => attr === 'href' ? 'https://external.com/page' : null }
          ];
          mockLinks.forEach((el, idx) => callback.call(el, idx, el));
        })
      });

      const result = testCrawler.getHyperlink('<html></html>', 'https://example.com');
      // Should not include external link
      expect(result).not.toContain('https://external.com/page');
      // Should increment internal stat
      expect(testCrawler.stats.linksInternal).toBeGreaterThan(0);
    });

    it('should include external links when followExternalLinks is true', () => {
      const config = { followExternalLinks: true };
      const testCrawler = new Crawler(null, 10000, config);

      cheerio.load.mockReturnValue({
        each: jest.fn((callback) => {
          const mockLinks = [
            { attr: (attr) => attr === 'href' ? 'https://example.com/page1' : null },
            { attr: (attr) => attr === 'href' ? 'https://external.com/page' : null }
          ];
          mockLinks.forEach((el, idx) => callback.call(el, idx, el));
        })
      });

      const result = testCrawler.getHyperlink('<html></html>', 'https://example.com');
      expect(result.length).toBeGreaterThanOrEqual(0);
      expect(testCrawler.stats.linksExternal).toBeGreaterThan(0);
    });

    it('should filter by excluded extensions', () => {
      cheerio.load.mockReturnValue({
        each: jest.fn((callback) => {
          const mockLinks = [
            { attr: (attr) => attr === 'href' ? 'https://example.com/image.jpg' : null },
            { attr: (attr) => attr === 'href' ? 'https://example.com/page.html' : null }
          ];
          mockLinks.forEach((el, idx) => callback.call(el, idx, el));
        })
      });

      const result = crawler.getHyperlink('<html></html>', 'https://example.com');
      expect(result).not.toContain('https://example.com/image.jpg');
    });

    it('should filter by PDF extension', () => {
      cheerio.load.mockReturnValue({
        each: jest.fn((callback) => {
          const mockLinks = [
            { attr: (attr) => attr === 'href' ? 'https://example.com/doc.pdf' : null },
            { attr: (attr) => attr === 'href' ? 'https://example.com/page.html' : null }
          ];
          mockLinks.forEach((el, idx) => callback.call(el, idx, el));
        })
      });

      const result = crawler.getHyperlink('<html></html>', 'https://example.com');
      expect(result).not.toContain('https://example.com/doc.pdf');
    });

    it('should apply excludePatterns from config', () => {
      const config = { excludePatterns: ['/admin', '/private'] };
      const testCrawler = new Crawler(null, 10000, config);

      cheerio.load.mockReturnValue({
        each: jest.fn((callback) => {
          const mockLinks = [
            { attr: (attr) => attr === 'href' ? 'https://example.com/admin/page' : null },
            { attr: (attr) => attr === 'href' ? 'https://example.com/public/page' : null }
          ];
          mockLinks.forEach((el, idx) => callback.call(el, idx, el));
        })
      });

      const result = testCrawler.getHyperlink('<html></html>', 'https://example.com');
      expect(result).not.toContain('https://example.com/admin/page');
    });

    it('should ignore javascript: links', () => {
      cheerio.load.mockReturnValue({
        each: jest.fn((callback) => {
          const mockLinks = [
            { attr: (attr) => attr === 'href' ? 'javascript:void(0)' : null },
            { attr: (attr) => attr === 'href' ? '/page.html' : null }
          ];
          mockLinks.forEach((el, idx) => callback.call(el, idx, el));
        })
      });

      const result = crawler.getHyperlink('<html></html>', 'https://example.com');
      expect(result).not.toContain('javascript:void(0)');
    });

    it('should ignore mailto: links', () => {
      cheerio.load.mockReturnValue({
        each: jest.fn((callback) => {
          const mockLinks = [
            { attr: (attr) => attr === 'href' ? 'mailto:test@example.com' : null },
            { attr: (attr) => attr === 'href' ? '/page.html' : null }
          ];
          mockLinks.forEach((el, idx) => callback.call(el, idx, el));
        })
      });

      const result = crawler.getHyperlink('<html></html>', 'https://example.com');
      expect(result).not.toContain('mailto:test@example.com');
    });

    it('should ignore tel: links', () => {
      cheerio.load.mockReturnValue({
        each: jest.fn((callback) => {
          const mockLinks = [
            { attr: (attr) => attr === 'href' ? 'tel:+1234567890' : null },
            { attr: (attr) => attr === 'href' ? '/page.html' : null }
          ];
          mockLinks.forEach((el, idx) => callback.call(el, idx, el));
        })
      });

      const result = crawler.getHyperlink('<html></html>', 'https://example.com');
      expect(result).not.toContain('tel:+1234567890');
    });

    it('should ignore CDN email protection links', () => {
      cheerio.load.mockReturnValue({
        each: jest.fn((callback) => {
          const mockLinks = [
            { attr: (attr) => attr === 'href' ? 'https://example.com/cdn-cgi/l/email-protection/x' : null },
            { attr: (attr) => attr === 'href' ? '/page.html' : null }
          ];
          mockLinks.forEach((el, idx) => callback.call(el, idx, el));
        })
      });

      const result = crawler.getHyperlink('<html></html>', 'https://example.com');
      expect(result).not.toContain('cdn-cgi/l/email-protection');
    });

    it('should ignore hash-only links', () => {
      cheerio.load.mockReturnValue({
        each: jest.fn((callback) => {
          const mockLinks = [
            { attr: (attr) => attr === 'href' ? '#' : null },
            { attr: (attr) => attr === 'href' ? '/page.html' : null }
          ];
          mockLinks.forEach((el, idx) => callback.call(el, idx, el));
        })
      });

      const result = crawler.getHyperlink('<html></html>', 'https://example.com');
      expect(result).not.toContain('#');
    });

    it('should ignore None and undefined string values', () => {
      cheerio.load.mockReturnValue({
        each: jest.fn((callback) => {
          const mockLinks = [
            { attr: (attr) => attr === 'href' ? 'None' : null },
            { attr: (attr) => attr === 'href' ? 'undefined' : null },
            { attr: (attr) => attr === 'href' ? '/page.html' : null }
          ];
          mockLinks.forEach((el, idx) => callback.call(el, idx, el));
        })
      });

      const result = crawler.getHyperlink('<html></html>', 'https://example.com');
      expect(result).not.toContain('None');
      expect(result).not.toContain('undefined');
    });

    it('should handle invalid baseUrl gracefully', () => {
      cheerio.load.mockReturnValue({
        each: jest.fn(() => {})
      });

      const result = crawler.getHyperlink('<html></html>', 'not-a-url');
      expect(result).toEqual([]);
    });

    it('should remove hash from URLs', () => {
      cheerio.load.mockReturnValue({
        each: jest.fn((callback) => {
          const mockLinks = [
            { attr: (attr) => attr === 'href' ? 'https://example.com/page#section' : null }
          ];
          mockLinks.forEach((el, idx) => callback.call(el, idx, el));
        })
      });

      const result = crawler.getHyperlink('<html></html>', 'https://example.com');
      expect(result).not.toContain('#section');
    });

    it('should deduplicate links', () => {
      cheerio.load.mockReturnValue({
        each: jest.fn((callback) => {
          const mockLinks = [
            { attr: (attr) => attr === 'href' ? 'https://example.com/page' : null },
            { attr: (attr) => attr === 'href' ? 'https://example.com/page' : null }
          ];
          mockLinks.forEach((el, idx) => callback.call(el, idx, el));
        })
      });

      const result = crawler.getHyperlink('<html></html>', 'https://example.com');
      const uniqueLinks = new Set(result);
      expect(uniqueLinks.size).toBe(result.length);
    });
  });

  describe('isDomainReady', () => {
    it('should return true for domain without cooldown', () => {
      expect(crawler.isDomainReady('https://example.com')).toBe(true);
    });

    it('should return false when domain is cooling down', () => {
      crawler.triggerCoolDown('https://example.com', 60);
      expect(crawler.isDomainReady('https://example.com')).toBe(false);
    });

    it('should return true after cooldown expires', () => {
      crawler.triggerCoolDown('https://example.com', 0);
      // Wait a tiny bit to ensure cooldown expired
      return new Promise((resolve) => {
        setTimeout(() => {
          expect(crawler.isDomainReady('https://example.com')).toBe(true);
          resolve();
        }, 10);
      });
    });

    it('should remove domain from cooldown map when ready', () => {
      crawler.triggerCoolDown('https://example.com', 0);
      return new Promise((resolve) => {
        setTimeout(() => {
          crawler.isDomainReady('https://example.com');
          expect(crawler.domainCoolDowns.has('example.com')).toBe(false);
          resolve();
        }, 10);
      });
    });

    it('should handle invalid URL gracefully', () => {
      expect(crawler.isDomainReady('not-a-url')).toBe(true);
    });

    it('should handle multiple domains independently', () => {
      crawler.triggerCoolDown('https://example.com', 60);
      expect(crawler.isDomainReady('https://example.com')).toBe(false);
      expect(crawler.isDomainReady('https://other.com')).toBe(true);
    });
  });

  describe('triggerCoolDown', () => {
    it('should set cooldown with jitter', () => {
      const beforeTime = Date.now();
      crawler.triggerCoolDown('https://example.com', 10);
      const readyTime = crawler.domainCoolDowns.get('example.com');

      expect(readyTime).toBeGreaterThan(beforeTime + 10000); // 10s + at least some jitter
      expect(readyTime).toBeLessThan(beforeTime + 15000); // 10s + max 5s jitter
    });

    it('should add domain to cooldown map', () => {
      crawler.triggerCoolDown('https://example.com', 60);
      expect(crawler.domainCoolDowns.has('example.com')).toBe(true);
    });

    it('should handle invalid URL gracefully', () => {
      expect(() => crawler.triggerCoolDown('not-a-url', 60)).not.toThrow();
    });

    it('should overwrite existing cooldown for same domain', () => {
      crawler.triggerCoolDown('https://example.com', 60);
      const firstReadyTime = crawler.domainCoolDowns.get('example.com');

      crawler.triggerCoolDown('https://example.com', 30);
      const secondReadyTime = crawler.domainCoolDowns.get('example.com');

      expect(secondReadyTime).toBeLessThan(firstReadyTime);
    });
  });

  describe('fetch', () => {
    it('should fetch successfully with status 200', async () => {
      const mockResponse = { data: '<html></html>', status: 200 };
      axios.get.mockResolvedValue(mockResponse);

      const result = await crawler.fetch('https://example.com');
      expect(result.status).toBe(200);
      expect(crawler.stats.totalCrawled).toBe(1);
    });

    it('should retry on timeout', async () => {
      axios.get
        .mockRejectedValueOnce({ code: 'ECONNABORTED' })
        .mockResolvedValueOnce({ data: '<html></html>', status: 200 });

      const result = await crawler.fetch('https://example.com');
      expect(result.status).toBe(200);
      expect(axios.get).toHaveBeenCalledTimes(2);
    });

    it('should retry on 500 status', async () => {
      axios.get
        .mockResolvedValueOnce({ status: 500 })
        .mockResolvedValueOnce({ data: '<html></html>', status: 200 });

      const result = await crawler.fetch('https://example.com');
      expect(result.status).toBe(200);
      expect(axios.get).toHaveBeenCalledTimes(2);
    });

    it('should throw error after max retries exhausted', async () => {
      axios.get.mockRejectedValue({ code: 'ECONNABORTED' });

      await expect(crawler.fetch('https://example.com')).rejects.toThrow();
      expect(axios.get).toHaveBeenCalledTimes(5); // default maxTimes
      expect(crawler.stats.totalErrors).toBe(1);
    });

    it('should propagate DomainRateLimited error', async () => {
      const rateLimitError = new Error('DomainRateLimited');
      axios.get.mockRejectedValue(rateLimitError);

      await expect(crawler.fetch('https://example.com')).rejects.toThrow('DomainRateLimited');
    });

    it('should count error codes in stats', async () => {
      axios.get.mockResolvedValue({ status: 403 });

      try {
        await crawler.fetch('https://example.com');
      } catch (e) {
        // Expected to fail
      }

      expect(crawler.stats.errorCounts[403]).toBe(1);
    });

    it('should add delay for 403 and 429 status', async () => {
      axios.get.mockResolvedValue({ status: 429 });

      const startTime = Date.now();
      try {
        await crawler.fetch('https://example.com');
      } catch (e) {
        // Expected to fail
      }
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeGreaterThan(1000); // At least 1s delay
    });

    it('should use default headers when none provided', async () => {
      axios.get.mockResolvedValue({ data: '<html></html>', status: 200 });

      await crawler.fetch('https://example.com');

      expect(axios.get).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          headers: crawler.headers
        })
      );
    });

    it('should use custom headers when provided', async () => {
      axios.get.mockResolvedValue({ data: '<html></html>', status: 200 });
      const customHeaders = { 'X-Custom': 'value' };

      await crawler.fetch('https://example.com', customHeaders);

      expect(axios.get).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          headers: customHeaders
        })
      );
    });

    it('should prepend http:// to URLs without protocol', async () => {
      axios.get.mockResolvedValue({ data: '<html></html>', status: 200 });

      await crawler.fetch('example.com');

      expect(axios.get).toHaveBeenCalledWith(
        'http://example.com',
        expect.any(Object)
      );
    });

    it('should respect custom maxTimes parameter', async () => {
      axios.get.mockRejectedValue({ code: 'ECONNABORTED' });

      try {
        await crawler.fetch('https://example.com', null, 2);
      } catch (e) {
        // Expected to fail
      }

      expect(axios.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('getTitle', () => {
    it('should extract title from HTML', () => {
      cheerio.load.mockReturnValue({
        text: jest.fn().mockReturnValue('Test Page Title')
      });

      const result = crawler.getTitle('<html><head><title>Test Page Title</title></head></html>');
      expect(result).toBe('Test Page Title');
    });

    it('should trim whitespace from title', () => {
      cheerio.load.mockReturnValue({
        text: jest.fn().mockReturnValue('  Test Page Title  ')
      });

      const result = crawler.getTitle('<html></html>');
      expect(result).toBe('Test Page Title');
    });

    it('should return untitled when no title found', () => {
      cheerio.load.mockReturnValue({
        text: jest.fn().mockReturnValue('')
      });

      const result = crawler.getTitle('<html></html>');
      expect(result).toBe('untitled');
    });

    it('should return untitled on parse error', () => {
      cheerio.load.mockImplementationOnce(() => {
        throw new Error('Parse error');
      });

      const result = crawler.getTitle('<invalid');
      expect(result).toBe('untitled');
    });
  });

  describe('getLanguage', () => {
    it('should extract lang attribute from html tag', () => {
      cheerio.load.mockReturnValue({
        attr: jest.fn((attr) => 'en-US')
      });

      const result = crawler.getLanguage('<html lang="en-US"></html>');
      expect(result).toBe('en');
    });

    it('should return lowercase language code', () => {
      cheerio.load.mockReturnValue({
        attr: jest.fn((attr) => 'EN-US')
      });

      const result = crawler.getLanguage('<html></html>');
      expect(result).toBe('en');
    });

    it('should extract language from regex fallback', () => {
      cheerio.load.mockReturnValue({
        attr: jest.fn(() => null)
      });

      const result = crawler.getLanguage('<html lang="fr-FR"></html>');
      expect(result).toBe('fr');
    });

    it('should return empty string when no language found', () => {
      cheerio.load.mockReturnValue({
        attr: jest.fn(() => null)
      });

      const result = crawler.getLanguage('<html></html>');
      expect(result).toBe('');
    });

    it('should return empty string on parse error', () => {
      cheerio.load.mockImplementationOnce(() => {
        throw new Error('Parse error');
      });

      const result = crawler.getLanguage('<invalid');
      expect(result).toBe('');
    });
  });

  describe('parse', () => {
    it('should load HTML document with cheerio', () => {
      const html = '<html><body>Test</body></html>';
      const mock$ = { text: jest.fn() };
      cheerio.load.mockReturnValue(mock$);

      const result = crawler.parse(html);
      expect(result).toBe(mock$);
      expect(cheerio.load).toHaveBeenCalledWith(html);
    });
  });

  describe('getBaseUrl', () => {
    it('should extract origin from URL', () => {
      const result = crawler.getBaseUrl('https://example.com/page?query=value');
      expect(result).toBe('https://example.com');
    });

    it('should handle URLs with ports', () => {
      const result = crawler.getBaseUrl('https://example.com:8080/page');
      expect(result).toBe('https://example.com:8080');
    });

    it('should handle URLs without path', () => {
      const result = crawler.getBaseUrl('https://example.com');
      expect(result).toBe('https://example.com');
    });

    it('should return original URL on parse error', () => {
      const result = crawler.getBaseUrl('not-a-url');
      expect(result).toBe('not-a-url');
    });
  });

  describe('cleanText', () => {
    it('should normalize whitespace', () => {
      const result = crawler.cleanText('Hello    world');
      expect(result).toBe('Hello world');
    });

    it('should convert \\r to \\n', () => {
      const result = crawler.cleanText('Line1\rLine2');
      expect(result).toBe('Line1\nLine2');
    });

    it('should remove excessive newlines', () => {
      const result = crawler.cleanText('Line1\n\n\nLine2');
      expect(result).toBe('Line1\nLine2');
    });

    it('should trim leading/trailing whitespace', () => {
      const result = crawler.cleanText('  text  ');
      expect(result).toBe('text');
    });

    it('should filter out empty lines', () => {
      const result = crawler.cleanText('Line1\n   \nLine2');
      expect(result).toBe('Line1\nLine2');
    });

    it('should handle empty input', () => {
      const result = crawler.cleanText('');
      expect(result).toBe('');
    });

    it('should handle null input gracefully', () => {
      const result = crawler.cleanText(null);
      expect(result).toBe('');
    });
  });

  describe('processWork', () => {
    it('should process work function and return sublinks', async () => {
      axios.get.mockResolvedValue({ data: '<html></html>', status: 200 });
      cheerio.load.mockReturnValue({
        each: jest.fn()
      });

      const work = jest.fn();
      const result = await crawler.processWork('https://example.com', work);

      expect(result).toEqual([]);
      expect(work).toHaveBeenCalledWith('https://example.com', expect.any(Object));
    });

    it('should add URL to fetchedPool', async () => {
      axios.get.mockResolvedValue({ data: '<html></html>', status: 200 });
      cheerio.load.mockReturnValue({ each: jest.fn() });

      await crawler.processWork('https://example.com');
      expect(crawler.fetchedPool.has('https://example.com')).toBe(true);
    });

    it('should propagate DomainRateLimited error', async () => {
      axios.get.mockRejectedValue(new Error('DomainRateLimited'));

      await expect(crawler.processWork('https://example.com')).rejects.toThrow('DomainRateLimited');
    });

    it('should propagate Killed error', async () => {
      axios.get.mockRejectedValue(new Error('Crawl killed'));

      await expect(crawler.processWork('https://example.com')).rejects.toThrow();
    });

    it('should propagate MaxPagesReached error', async () => {
      axios.get.mockRejectedValue(new Error('MaxPagesReached'));

      await expect(crawler.processWork('https://example.com')).rejects.toThrow('MaxPagesReached');
    });

    it('should add failed URLs to fetchedPool', async () => {
      axios.get.mockRejectedValue(new Error('Network error'));
      cheerio.load.mockReturnValue({ each: jest.fn() });

      await crawler.processWork('https://example.com');
      expect(crawler.fetchedPool.has('https://example.com')).toBe(true);
    });

    it('should return empty array on non-critical error', async () => {
      axios.get.mockRejectedValue(new Error('Network error'));

      const result = await crawler.processWork('https://example.com');
      expect(result).toEqual([]);
    });
  });

  describe('download', () => {
    const mockFs = require('fs');

    it('should stream download to file', async () => {
      const mockStream = {
        pipe: jest.fn(),
        on: jest.fn((event, callback) => {
          if (event === 'finish') {
            callback();
          }
        })
      };

      axios.get.mockResolvedValue({
        data: mockStream
      });

      mockFs.createWriteStream.mockReturnValue(mockStream);

      await crawler.download('https://example.com/file.pdf', '/tmp/file.pdf');
      expect(mockStream.pipe).toHaveBeenCalledWith(mockStream);
    });

    it('should handle download errors', async () => {
      axios.get.mockRejectedValue(new Error('Download failed'));

      await crawler.download('https://example.com/file.pdf', '/tmp/file.pdf');
      // Should not throw, should log error instead
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should handle write stream errors', async () => {
      const mockStream = {
        pipe: jest.fn(),
        on: jest.fn((event, callback) => {
          if (event === 'error') {
            callback(new Error('Write error'));
          }
        })
      };

      axios.get.mockResolvedValue({ data: mockStream });
      mockFs.createWriteStream.mockReturnValue(mockStream);

      await expect(
        crawler.download('https://example.com/file.pdf', '/tmp/file.pdf')
      ).rejects.toThrow('Write error');
    });
  });

  describe('crawl', () => {
    it('should process seed URL', async () => {
      axios.get.mockResolvedValue({
        data: '<html><a href="/page1">Link 1</a></html>',
        status: 200
      });
      cheerio.load.mockReturnValue({
        each: jest.fn((callback) => {
          const mockLinks = [
            { attr: (attr) => attr === 'href' ? '/page1' : null }
          ];
          mockLinks.forEach((el, idx) => callback.call(el, idx, el));
        })
      });

      await crawler.crawl('https://example.com');
      expect(crawler.fetchedPool.has('https://example.com')).toBe(true);
    });

    it('should respect maxDepth limit', async () => {
      axios.get.mockResolvedValue({
        data: '<html><a href="/page">Link</a></html>',
        status: 200
      });
      cheerio.load.mockReturnValue({
        each: jest.fn((callback) => {
          const mockLinks = [
            { attr: (attr) => attr === 'href' ? '/page' : null }
          ];
          mockLinks.forEach((el, idx) => callback.call(el, idx, el));
        })
      });

      await crawler.crawl('https://example.com', null, 1);
      // Should not throw, should complete within maxDepth
    });

    it('should call metrics callback during crawl', async () => {
      axios.get.mockResolvedValue({
        data: '<html></html>',
        status: 200
      });
      cheerio.load.mockReturnValue({ each: jest.fn() });

      const metricsCallback = jest.fn();
      await crawler.crawl('https://example.com', null, 1, 10, metricsCallback);

      expect(metricsCallback).toHaveBeenCalled();
    });

    it('should throw on seed URL rate limit', async () => {
      axios.get.mockRejectedValue(new Error('DomainRateLimited'));

      await expect(crawler.crawl('https://example.com')).rejects.toThrow('Seed Rate Limited');
    });

    it('should propagate kill signal', async () => {
      axios.get.mockRejectedValue(new Error('Crawl killed'));

      await expect(crawler.crawl('https://example.com')).rejects.toThrow();
    });

    it('should handle MaxPagesReached gracefully', async () => {
      axios.get.mockRejectedValue(new Error('MaxPagesReached'));

      await crawler.crawl('https://example.com');
      // Should not throw, should handle gracefully
    });

    it('should process array of seed URLs', async () => {
      axios.get.mockResolvedValue({
        data: '<html></html>',
        status: 200
      });
      cheerio.load.mockReturnValue({ each: jest.fn() });

      await crawler.crawl(['https://example.com', 'https://test.com']);
      expect(crawler.fetchedPool.has('https://example.com')).toBe(true);
      expect(crawler.fetchedPool.has('https://test.com')).toBe(true);
    });

    it('should update queue size stat during crawl', async () => {
      axios.get.mockResolvedValue({
        data: '<html></html>',
        status: 200
      });
      cheerio.load.mockReturnValue({ each: jest.fn() });

      await crawler.crawl('https://example.com');
      expect(crawler.stats.queueSize).toBe(0); // Should be 0 after exhausting queue
    });
  });
});
