const axios = require('axios');
const cheerio = require('cheerio');
const { URL: UrlParser } = require('url');
const http = require('http');
const https = require('https');
const { logger } = require('../../shared-lib');

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

class Crawler {
  // [MODIFIED] Added 'metricsUpdateFn' to constructor (optional)
  constructor(pool = null, timeoutMs = 10000, config = {}) {
    logger.debug('Crawler instance created.');
    this.timeoutMs = timeoutMs;
    if (pool && !['string', 'object'].includes(typeof pool)) {
      logger.error('Invalid pool type provided to Crawler constructor.', { poolType: typeof pool });
      throw new Error('url pool should be string, array or tuple');
    }
    this.pool = pool;
    this.config = config || {};

    this.headers = {
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36'
    };
    this.fetchedPool = new Set();
    this.domainCoolDowns = new Map();

    // --- METRICS TRACKING STATE ---
    this.startTime = Date.now();
    this.stats = {
      totalCrawled: 0,
      totalErrors: 0,
      errorCounts: {},
      linksInternal: 0,
      linksExternal: 0,
      queueSize: 0,
      currentDepth: 0
    };

    logger.debug('Crawler initialized', { pool: this.pool });
  }

  getSublinks($) {
    logger.debug('Entering getSublinks...');
    const sublinks = [];
    $('a').each((_, el) => {
      const href = $(el).attr('href');
      if (href) sublinks.push(String(href));
    });
    logger.debug(`Found ${sublinks.length} raw sublinks.`);
    return sublinks;
  }

  getHyperlink($, baseUrl) {
    logger.debug(`Entering getHyperlink with baseUrl: ${baseUrl}`);
    const sublinks = [];
    let baseDomain;
    try {
      baseDomain = new UrlParser(baseUrl).hostname;
    } catch {
      logger.warn(`Invalid baseUrl: ${baseUrl}`);
      return [];
    }

    $('a').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;

      const link = String(href).trim();

      // Check against static junk list
      if (
        !link ||
        link.startsWith('#') ||
        link === 'None' ||
        link === 'undefined' ||
        link.toLowerCase().startsWith('javascript:') ||
        link.toLowerCase().startsWith('mailto:') ||
        link.toLowerCase().startsWith('tel:') ||
        link.includes('cdn-cgi/l/email-protection')
      ) {
        return;
      }

      const suffix = link.split('/').pop();
      if (suffix.includes('.')) {
        const ext = suffix.split('.').pop().toLowerCase();
        const allowedExtensions = ['html', 'htm', 'php', 'asp', 'aspx', 'jsp', 'cfm', 'cgi', 'pl'];
        if (!allowedExtensions.includes(ext) && !link.endsWith('/')) {
          const ignoredExtensions = [
            'jpg',
            'jpeg',
            'png',
            'gif',
            'svg',
            'css',
            'js',
            'ico',
            'xml',
            'json',
            'pdf',
            'zip',
            'rar'
          ];
          if (ignoredExtensions.includes(ext)) return;
          if (!allowedExtensions.includes(ext)) return;
        }
      }

      let linkUrl;
      try {
        linkUrl = new UrlParser(link, baseUrl);
      } catch {
        logger.warn(`Could not parse URL for link: ${link}. Base: ${baseUrl}`);
        return;
      }

      // --- CONFIGURABLE FILTERS ---

      // 1. Exclude Patterns (from config)
      if (this.config.excludePatterns && this.config.excludePatterns.length > 0) {
        const urlStr = linkUrl.toString();
        // Simple contains check for each pattern
        const isExcluded = this.config.excludePatterns.some((pattern) => urlStr.includes(pattern));
        if (isExcluded) return;
      }

      // 2. External Domain Handling
      if (linkUrl.hostname !== baseDomain) {
        this.stats.linksExternal++; // Increment external stat
        if (!this.config.followExternalLinks) {
          return;
        }
      } else {
        this.stats.linksInternal++; // Increment internal stat
      }

      if (!linkUrl.pathname) return;

      linkUrl.hash = '';
      sublinks.push(linkUrl.toString());
    });

    return [...new Set(sublinks)];
  }

  isDomainReady(url) {
    try {
      const hostname = new UrlParser(url).hostname;
      if (this.domainCoolDowns.has(hostname)) {
        const readyTime = this.domainCoolDowns.get(hostname);
        if (Date.now() < readyTime) {
          return false;
        } else {
          this.domainCoolDowns.delete(hostname);
          return true;
        }
      }
      return true;
    } catch {
      return true;
    }
  }

  triggerCoolDown(url, seconds = 60) {
    try {
      const hostname = new UrlParser(url).hostname;
      const jitter = Math.floor(Math.random() * 5000); // 0-5s jitter
      const readyTime = Date.now() + seconds * 1000 + jitter;
      this.domainCoolDowns.set(hostname, readyTime);
      logger.warn(`[RATE-LIMIT] Cooling down ${hostname} for ${seconds}s`);
    } catch {
      // Ignore errors during rate limiting
    }
  }

  _validateUrl(url) {
    // Block non-HTTP schemes, internal IPs, and DNS rebinding to private networks
    const parsed = new UrlParser(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`Blocked URL scheme: ${parsed.protocol || '(none)'}`);
    }
    const hostname = parsed.hostname || '';
    // Block raw IPv4 private / loopback / link-local
    if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.)/.test(hostname)) {
      throw new Error(`Blocked internal IP: ${hostname}`);
    }
    // Block IPv6 loopback and link-local
    if (hostname === '::1' || hostname === '[::1]' || hostname.startsWith('fe80:')) {
      throw new Error(`Blocked internal IPv6: ${hostname}`);
    }
    return parsed;
  }

  async fetch(url, headers = null, maxTimes = 5) {
    logger.debug(`Attempting to fetch URL: ${url} (max retries: ${maxTimes})`);
    headers = headers || this.headers;
    let lastError;
    const totalAttempts = maxTimes;

    while (maxTimes > 0) {
      const attempt = totalAttempts - maxTimes + 1;
      try {
        if (!/^https?:\/\//i.test(url)) {
          url = 'http://' + url;
        }
        // Validate URL before making the request — prevents SSRF
        this._validateUrl(url);

        const response = await axios.get(url, {
          headers,
          responseType: 'text',
          validateStatus: null,
          timeout: this.timeoutMs,
          httpAgent: httpAgent,
          httpsAgent: httpsAgent
        });

        if (response.status !== 200) {
          lastError = new Error(`fail to fetch ${url}, response status code: ${response.status}`);
          logger.warn(`Fetch attempt ${attempt} failed for ${url}: status code ${response.status}`);

          // Count Error Codes
          this.stats.errorCounts[response.status] = (this.stats.errorCounts[response.status] || 0) + 1;

          if (response.status === 403 || response.status === 429) {
            const delay = Math.floor(Math.random() * 2000) + 1000;
            await new Promise((r) => setTimeout(r, delay));
          }
        } else {
          logger.info(`Successfully fetched ${url} with status 200.`);
          this.stats.totalCrawled++; // Count successful fetch
          return response;
        }
      } catch (e) {
        if (e.code === 'ECONNABORTED') {
          lastError = new Error(`Timeout of ${this.timeoutMs}ms exceeded`);
          logger.warn(`Fetch attempt ${attempt} timed out for ${url}`);
        } else {
          lastError = e;
          logger.warn(`Fetch attempt ${attempt} for ${url} failed with error: ${e.message}`);
        }
      }
      maxTimes -= 1;
    }

    this.stats.totalErrors++; // Count total failure
    logger.error(`Failed to fetch ${url} after ${totalAttempts} attempts. ${lastError ? lastError.message : ''}`);
    throw lastError;
  }

  getTitle(html) {
    try {
      const $ = cheerio.load(html);
      return $('title').text().trim() || 'untitled';
    } catch {
      return 'untitled';
    }
  }

  getLanguage(html) {
    try {
      const $ = cheerio.load(html, { lowerCaseTags: true, lowerCaseAttributeNames: true });
      const lang = $('html').attr('lang');
      if (lang) return lang.split('-')[0].toLowerCase();
      const match = html.match(/<html[^>]*\slang=["']?([a-zA-Z0-9-]+)["']?/i);
      if (match && match[1]) return match[1].split('-')[0].toLowerCase();
      return '';
    } catch {
      return '';
    }
  }

  async processWork(subUrl, work) {
    try {
      const response = await this.fetch(subUrl);
      if (!response) return [];

      this.fetchedPool.add(subUrl);

      const $ = this.parse(response.data);
      const baseUrl = this.getBaseUrl(subUrl);
      const sublinks = this.getHyperlink($, baseUrl);

      if (work) {
        await work(subUrl, $);
      }
      return sublinks;
    } catch (error) {
      // Domain Rate Limited -> Propagate to re-queue
      if (error.message === 'DomainRateLimited') throw error;

      // Critical Control -> Propagate to stop crawl
      if (
        error.message &&
        (error.message.includes('killed') || error.message.includes('Killed') || error.message === 'MaxPagesReached')
      ) {
        throw error;
      }

      logger.error(`Error during processWork for ${subUrl}: ${error.message}`);
      this.fetchedPool.add(subUrl); // Mark failed non-critical fetches as done
      return [];
    }
  }

  // [MODIFIED] Crawl method signature accepts metricsUpdateFn
  async crawl(pool, work = null, maxDepth = 10, workers = 10, metricsUpdateFn = null) {
    logger.info(`Starting new crawl. Max depth: ${maxDepth}, Concurrency: ${workers}`);

    this.startTime = Date.now();
    this.stats.maxDepth = maxDepth;

    // Helper to report stats
    const reportMetrics = async () => {
      if (metricsUpdateFn) {
        const elapsedSeconds = (Date.now() - this.startTime) / 1000;
        const crawlRate = elapsedSeconds > 0 ? (this.stats.totalCrawled / elapsedSeconds).toFixed(2) : 0;
        const totalAttempts = this.stats.totalCrawled + this.stats.totalErrors;
        const errorRate = totalAttempts > 0 ? ((this.stats.totalErrors / totalAttempts) * 100).toFixed(1) : 0;

        const metrics = {
          crawl_rate: parseFloat(crawlRate),
          total_crawled: this.stats.totalCrawled,
          error_rate: parseFloat(errorRate),
          error_counts: this.stats.errorCounts,
          queue_size: this.stats.queueSize,
          current_depth: this.stats.currentDepth,
          links_internal: this.stats.linksInternal,
          links_external: this.stats.linksExternal
        };
        await metricsUpdateFn(metrics);
      }
    };

    try {
      const urlPool = new Set(Array.isArray(pool) ? pool : [pool]);

      // --- SEED PHASE (Sequential) ---
      const initialSeeds = Array.from(urlPool);
      urlPool.clear();

      for (const url of initialSeeds) {
        logger.info(`Processing seed URL: ${url}`);
        const baseUrl = this.getBaseUrl(url);
        try {
          const response = await this.fetch(url);
          const $ = this.parse(response.data);
          const sublinks = this.getHyperlink($, baseUrl);

          this.fetchedPool.add(url);
          sublinks.forEach((link) => urlPool.add(link));
          logger.info(`Seeded urlPool with ${sublinks.length} links from ${url}.`);

          if (work) await work(url, $);
        } catch (e) {
          if (e.message === 'DomainRateLimited') {
            logger.error('Seed URL rate limited immediately. Aborting.');
            throw new Error('Seed Rate Limited', { cause: e });
          }
          if (e.message && (e.message.includes('killed') || e.message === 'MaxPagesReached')) throw e;
          logger.error(`Failed to fetch seed URL ${url}: ${e.message}`);
        }
      }

      let depth = 0;
      while (urlPool.size > 0 && depth < maxDepth) {
        this.stats.currentDepth = depth;
        this.stats.queueSize = urlPool.size;
        await reportMetrics(); // Report at start of depth

        logger.info(`Starting crawl depth ${depth}. Pending URLs: ${urlPool.size}`);

        const nextDepthLinks = new Set();
        const currentDepthUrls = Array.from(urlPool).filter((u) => !this.fetchedPool.has(u));
        urlPool.clear();

        let processedIndex = 0;

        // --- SMART BATCH LOOP ---
        while (processedIndex < currentDepthUrls.length) {
          const batch = [];
          const deferred = []; // URLs skipped due to rate limits in this pass

          // 1. Fill Batch with "Ready" Domains
          while (processedIndex < currentDepthUrls.length && batch.length < workers) {
            const url = currentDepthUrls[processedIndex];
            processedIndex++; // Move pointer

            if (this.isDomainReady(url)) {
              batch.push(url);
            } else {
              deferred.push(url);
            }
          }

          // Update queue size based on what's left in this depth + deferred
          this.stats.queueSize = currentDepthUrls.length - processedIndex + deferred.length + nextDepthLinks.size;

          // 2. If we have deferred items but empty batch
          if (batch.length === 0 && deferred.length > 0) {
            logger.info('All remaining URLs for this depth are rate-limited. Pausing 5s...');
            await new Promise((r) => setTimeout(r, 5000));

            deferred.forEach((u) => nextDepthLinks.add(u));
            continue;
          }

          if (batch.length === 0 && deferred.length === 0) break; // Done with list

          // 3. Execute Batch
          const tasks = batch.map((subUrl) => this.processWork(subUrl, work));

          try {
            const results = await Promise.allSettled(tasks);

            for (let i = 0; i < results.length; i++) {
              const result = results[i];
              const originalUrl = batch[i];

              if (result.status === 'fulfilled') {
                result.value.forEach((link) => {
                  if (!this.fetchedPool.has(link)) nextDepthLinks.add(link);
                });
              } else {
                // Failed
                const err = result.reason;
                if (err.message === 'DomainRateLimited') {
                  nextDepthLinks.add(originalUrl);
                } else if (err.message && (err.message.includes('killed') || err.message === 'MaxPagesReached')) {
                  throw err; // Hard stop
                }
              }
            }
          } catch (err) {
            if (err.message && (err.message.includes('killed') || err.message === 'MaxPagesReached')) throw err;
            logger.error(`Batch processing error: ${err.message}`);
          }

          // 4. Re-queue deferred items
          deferred.forEach((u) => nextDepthLinks.add(u));

          // Report periodically (every batch)
          await reportMetrics();
        }

        // Setup for next depth
        nextDepthLinks.forEach((link) => urlPool.add(link));
        logger.info(`Depth ${depth} complete. Found ${nextDepthLinks.size} unique links for next pass.`);
        depth += 1;
      }
      await reportMetrics(); // Final report
      logger.info(`Crawl finished. Reached max depth ${maxDepth} or exhausted pool.`);
    } catch (error) {
      if (error.message === 'MaxPagesReached') {
        logger.info('Max pages reached. Stopping.');
        return;
      }
      logger.error(`Crawl failed: ${error.message}`, error);
      throw error;
    }
  }

  parse(htmlDoc) {
    return cheerio.load(htmlDoc);
  }

  async download(url, fileName) {
    logger.info(`Downloading ${url} to ${fileName}...`);
    try {
      const response = await axios.get(url, {
        headers: this.headers,
        responseType: 'stream',
        timeout: this.timeoutMs,
        httpAgent: httpAgent,
        httpsAgent: httpsAgent
      });
      const fs = require('fs');
      const writer = fs.createWriteStream(fileName);
      response.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on('finish', () => {
          logger.info(`Successfully downloaded and saved ${fileName}.`);
          resolve();
        });
        writer.on('error', (error) => reject(error));
      });
    } catch (e) {
      logger.error(`Failed to download ${url}: ${e.message}`);
    }
  }

  getBaseUrl(url) {
    try {
      const u = new UrlParser(url);
      return `${u.protocol}//${u.hostname}`;
    } catch {
      return url;
    }
  }

  cleanText(text) {
    const cleaned = String(text)
      .replace(/\r/g, '\n')
      .replace(/ +/g, ' ')
      .replace(/\n+/g, '\n')
      .split('\n')
      .filter((line) => line && line !== ' ')
      .join('\n')
      .trim();
    return cleaned;
  }
}

module.exports = Crawler;
