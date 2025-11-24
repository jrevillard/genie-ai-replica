const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');
const { logger } = require('../../shared-lib');

class Crawler {
  constructor(pool = null) {
    logger.debug('Crawler instance created.');
    if (pool && !['string', 'object'].includes(typeof pool)) {
      logger.error('Invalid pool type provided to Crawler constructor.', { poolType: typeof pool });
      throw new Error('url pool should be string, array or tuple');
    }
    this.pool = pool;
    this.headers = {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7', 
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36'
    };
    this.fetchedPool = new Set();
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
      baseDomain = new URL(baseUrl).hostname;
    } catch (e) {
      logger.warn(`Invalid baseUrl: ${baseUrl}`);
      return [];
    }
    
    $('a').each((_, el) => {
      const href = $(el).attr('href');
      
      // Robust check for undefined/empty/junk
      if (!href) return;
      
      let link = String(href).trim();

      if (!link || 
          link.startsWith('#') || 
          link === 'None' || 
          link === 'undefined' ||
          link.toLowerCase().startsWith('javascript:') ||
          link.toLowerCase().startsWith('mailto:') ||
          link.toLowerCase().startsWith('tel:') ||
          link.includes('cdn-cgi/l/email-protection')) {
        // logger.debug(`Filtering link: ${link} (reason: empty/hash/None/js/mail/tel/cloudflare)`);
        return;
      }
      
      const suffix = link.split('/').pop();
      // Updated extension list to support common web page types including PHP, ASP, etc.
      if (suffix.includes('.')) {
        const ext = suffix.split('.').pop().toLowerCase();
        const allowedExtensions = ['html', 'htm', 'php', 'asp', 'aspx', 'jsp', 'cfm', 'cgi', 'pl'];
        // If it has an extension AND it is NOT in the allowed list, check if it looks like a media/binary file to exclude
        if (!allowedExtensions.includes(ext) && !link.endsWith('/')) {
           // Check if it looks like a static asset (img, css, js, pdf, etc)
           const ignoredExtensions = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'css', 'js', 'ico', 'xml', 'json', 'pdf', 'zip', 'rar'];
           if (ignoredExtensions.includes(ext)) {
             // logger.debug(`Filtering link: ${link} (reason: ignored extension .${ext})`);
             return;
           }
           if (!allowedExtensions.includes(ext)) {
              // logger.debug(`Filtering link: ${link} (reason: non-page extension .${ext})`);
              return;
           }
        }
      }

      let linkUrl;
      try {
        linkUrl = new URL(link, baseUrl);
      } catch (error) {
        logger.warn(`Could not parse URL for link: ${link}. Base: ${baseUrl}`);
        return;
      }
      
      if (linkUrl.hostname !== baseDomain) {
        // logger.debug(`Filtering link: ${linkUrl.toString()} (reason: external domain ${linkUrl.hostname})`);
        return;
      }
      if (!linkUrl.pathname) {
        // logger.debug(`Filtering link: ${linkUrl.toString()} (reason: no pathname)`);
        return;
      }
      
      // Remove hash from final URL to avoid duplicates of same page
      linkUrl.hash = '';
      
      sublinks.push(linkUrl.toString());
    });
    // logger.debug(`Extracted ${sublinks.length} valid hyperlinks from page.`);
    return [...new Set(sublinks)]; // Return unique links
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
        
        const response = await axios.get(url, { headers, responseType: 'text', validateStatus: null });
        
        if (response.status !== 200) {
          lastError = new Error(`fail to fetch ${url}, response status code: ${response.status}`);
          logger.warn(`Fetch attempt ${attempt} failed for ${url}: status code ${response.status}`);
        } else {
          logger.info(`Successfully fetched ${url} with status 200.`);
          return response;
        }
      } catch (e) {
        lastError = e;
        logger.warn(`Fetch attempt ${attempt} for ${url} failed with error: ${e.message}`);
      }
      maxTimes -= 1;
    }
    
    logger.error(`Failed to fetch ${url} after ${totalAttempts} attempts. ${lastError ? lastError.message : ''}`);
    throw lastError;
  }

  getTitle(html) {
    try {
      const $ = cheerio.load(html);
      const title = $('title').text().trim() || 'untitled';
      return title;
    } catch (error) {
      return 'untitled';
    }
  }

  getLanguage(html) {
    try {
      const $ = cheerio.load(html, { lowerCaseTags: true, lowerCaseAttributeNames: true });
      let lang = $('html').attr('lang');
      if (lang) {
        return lang.split('-')[0].toLowerCase();
      }
      const match = html.match(/<html[^>]*\slang=["']?([a-zA-Z0-9-]+)["']?/i);
      if (match && match[1]) {
        return match[1].split('-')[0].toLowerCase();
      }
      return '';
    } catch (error) {
      return '';
    }
  }

  async processWork(subUrl, work) {
    try {
      const response = await this.fetch(subUrl);
      if (!response) {
        return [];
      }
      this.fetchedPool.add(subUrl);
      
      const $ = this.parse(response.data);
      const baseUrl = this.getBaseUrl(subUrl);
      const sublinks = this.getHyperlink($, baseUrl);
      
      if (work) {
        await work(subUrl, $);
      }
      return sublinks;
    } catch (error) {
      // --- FIX: Re-throw kill errors to stop the crawl ---
      if (error.message && (error.message.includes('killed') || error.message.includes('Killed'))) {
        throw error; 
      }
      // --------------------------------------------------
      logger.error(`Error during processWork for ${subUrl}: ${error.message}`);
      return []; 
    }
  }

  async crawl(pool, work = null, maxDepth = 10, workers = 10) {
    logger.info(`Starting new crawl. Max depth: ${maxDepth}, Concurrency: ${workers}`);
    try {
      let urlPool = new Set();
      const seeds = Array.isArray(pool) ? pool : [pool];

      for (const url of seeds) {
        logger.info(`Processing seed URL: ${url}`);
        const baseUrl = this.getBaseUrl(url);
        
        // Initial fetch
        try {
            const response = await this.fetch(url);
            if (!response) continue;
            
            const $ = this.parse(response.data);
            const sublinks = this.getHyperlink($, baseUrl);
            
            this.fetchedPool.add(url);
            
            sublinks.forEach(link => urlPool.add(link));
            logger.info(`Seeded urlPool with ${sublinks.length} links from ${url}.`);
            
            // Process seed page work
            if (work) {
                await work(url, $);
            }
        } catch(e) {
            // Check for kill signal on seed
            if (e.message && (e.message.includes('killed') || e.message.includes('Killed'))) {
                throw e;
            }
            logger.error(`Failed to fetch seed URL ${url}: ${e.message}`);
            continue; 
        }

        let depth = 0;
        while (urlPool.size > 0 && depth < maxDepth) {
          logger.info(`Starting crawl depth ${depth}. URL pool size: ${urlPool.size}`);
          
          const currentUrls = Array.from(urlPool);
          urlPool.clear(); // Clear for next depth
          
          const nextDepthLinks = new Set();
          
          // Process in chunks based on concurrency limit
          // THIS IS THE KEY FIX: Processing in batches with Promise.all
          for (let i = 0; i < currentUrls.length; i += workers) {
              const batch = currentUrls.slice(i, i + workers);
              const tasks = batch.map(subUrl => {
                  if (!this.fetchedPool.has(subUrl)) {
                      return this.processWork(subUrl, work);
                  }
                  return Promise.resolve([]);
              });
              
              // --- FIX: Catch kill signals in the batch ---
              try {
                // Wait for this batch to complete before starting the next batch
                // This ensures database connections aren't exhausted and logs are written incrementally
                const results = await Promise.all(tasks);
                
                results.forEach(links => {
                    links.forEach(link => {
                        if (!this.fetchedPool.has(link)) {
                            nextDepthLinks.add(link);
                        }
                    });
                });
              } catch (err) {
                // If any task threw a Kill error, we stop the entire crawl here
                if (err.message && (err.message.includes('killed') || err.message.includes('Killed'))) {
                    throw err;
                }
                // Other errors are logged in processWork, but if Promise.all fails otherwise:
                logger.error(`Batch processing failed: ${err.message}`);
              }
              // --------------------------------------------
          }
          
          nextDepthLinks.forEach(link => urlPool.add(link));
          logger.info(`Depth ${depth} complete. Found ${nextDepthLinks.size} new unique links.`);
          depth += 1;
        }
        logger.info(`Crawl finished. Reached max depth ${maxDepth} or exhausted pool.`);
      }
    } catch (error) {
      logger.error(`Crawl failed: ${error.message}`, error);
      // --- FIX: Re-throw error so the Worker knows it failed/was killed ---
      throw error;
      // -------------------------------------------------------------------
    }
  }

  parse(htmlDoc) {
    return cheerio.load(htmlDoc);
  }

  async download(url, fileName) {
    logger.info(`Downloading ${url} to ${fileName}...`);
    try {
      const response = await axios.get(url, { headers: this.headers, responseType: 'stream' });
      const fs = require('fs');
      const writer = fs.createWriteStream(fileName);
      
      response.data.pipe(writer);
      
      await new Promise((resolve, reject) => {
        writer.on('finish', () => {
          logger.info(`Successfully downloaded and saved ${fileName}.`);
          resolve();
        });
        writer.on('error', (error) => {
          reject(error);
        });
      });
    } catch (e) {
      logger.error(`Failed to download ${url}: ${e.message}`);
    }
  }

  getBaseUrl(url) {
    try {
      const u = new URL(url);
      return `${u.protocol}//${u.hostname}`;
    } catch (error) {
      return url;
    }
  }

  cleanText(text) {
    const cleaned = String(text)
      .replace(/\r/g, '\n')
      .replace(/ +/g, ' ')
      .replace(/\n+/g, '\n')
      .split('\n')
      .filter(line => line && line !== ' ')
      .join('\n')
      .trim();
    return cleaned;
  }
}

module.exports = Crawler;