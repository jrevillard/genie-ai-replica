const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');

class Crawler {
  constructor(pool = null) {
    if (pool && !['string', 'object'].includes(typeof pool)) {
      throw new Error('url pool should be string, array or tuple');
    }
    this.pool = pool;
    this.headers = {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7', // The numbers here mean the priority of languages, higher means more preferred
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36'
    };
    this.fetchedPool = new Set();
  }

  getSublinks($) {
    const sublinks = [];
    $('a').each((_, el) => {
      sublinks.push(String($(el).attr('href')));
    });
    return sublinks;
  }

  getHyperlink($, baseUrl) {
    const sublinks = [];
    $('a').each((_, el) => {
      let link = String($(el).attr('href'));
      if (!link || link.startsWith('#') || link === 'None') return;
      const suffix = link.split('/').pop();
      if (suffix.includes('.') && !['html', 'htmld'].includes(suffix.split('.').pop())) return;

      let linkUrl;
      try {
        linkUrl = new URL(link, baseUrl);
      } catch {
        return;
      }
      const baseDomain = new URL(baseUrl).hostname;
      if (linkUrl.hostname !== baseDomain) return;
      if (!linkUrl.pathname) return;
      sublinks.push(linkUrl.toString());
    });
    return sublinks;
  }

  async fetch(url, headers = null, maxTimes = 5) {
    headers = headers || this.headers;
    let lastError;
    while (maxTimes > 0) {
      try {
        if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
        const response = await axios.get(url, { headers, responseType: 'text', validateStatus: null });
        if (response.status !== 200) {
          lastError = new Error(`fail to fetch ${url}, response status code: ${response.status}`);
        } else {
          // Try to detect encoding from headers or meta
          let encoding = 'utf-8';
          const contentType = (response.headers['content-type'] || '').toLowerCase();
          if (contentType.includes('charset=')) {
            encoding = contentType.split('charset=')[1].split(';')[0].trim();
          } else {
            const metaCharset = response.data.match(/<meta\s+charset=["']?([^"'>]+)["']?/i);
            if (metaCharset) encoding = metaCharset[1];
            else {
              const metaHttpEquiv = response.data.match(/<meta\s+http-equiv=["']?content-type["']?\s+content=["']?[^"']*charset=([^"'>]+)["']?/i);
              if (metaHttpEquiv) encoding = metaHttpEquiv[1];
            }
          }
          // axios handles encoding automatically, so just return response
          return response;
        }
      } catch (e) {
        lastError = e;
      }
      maxTimes -= 1;
    }
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
      // Try to get lang attribute from <html>
      let lang = $('html').attr('lang');
      if (lang) return lang.split('-')[0].toLowerCase();
      // Fallback: regex search for lang attribute in <html ...>
      const match = html.match(/<html[^>]*\slang=["']?([a-zA-Z0-9-]+)["']?/i);
      if (match && match[1]) return match[1].split('-')[0].toLowerCase();
      return '';
    } catch {
      return '';
    }
  }

  async processWork(subUrl, work) {
    const response = await this.fetch(subUrl);
    if (!response) return [];
    this.fetchedPool.add(subUrl);
    const $ = this.parse(response.data);
    const baseUrl = this.getBaseUrl(subUrl);
    const sublinks = this.getHyperlink($, baseUrl);
    if (work) await work(subUrl, $);
    return sublinks;
  }

  async crawl(pool, work = null, maxDepth = 10, workers = 10) {
    let urlPool = new Set();
    for (const url of pool) {
      const baseUrl = this.getBaseUrl(url);
      const response = await this.fetch(url);
      const $ = this.parse(response.data);
      const sublinks = this.getHyperlink($, baseUrl);
      this.fetchedPool.add(url);
      sublinks.forEach(link => urlPool.add(link));
      let depth = 0;
      while (urlPool.size > 0 && depth < maxDepth) {
        console.log(`current depth ${depth}...`);
        const tasks = [];
        for (const subUrl of urlPool) {
          if (!this.fetchedPool.has(subUrl)) {
            tasks.push(this.processWork(subUrl, work));
          }
        }
        const results = await Promise.all(tasks);
        urlPool = new Set();
        for (const sublinks of results) {
          sublinks.forEach(link => urlPool.add(link));
        }
        depth += 1;
      }
    }
  }

  parse(htmlDoc) {
    return cheerio.load(htmlDoc);
  }

  async download(url, fileName) {
    console.log(`download ${url} into ${fileName}...`);
    try {
      const response = await axios.get(url, { headers: this.headers, responseType: 'stream' });
      const fs = require('fs');
      const writer = fs.createWriteStream(fileName);
      response.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
    } catch (e) {
      console.log(`fail to download ${url}, caused by ${e}`);
    }
  }

  getBaseUrl(url) {
    try {
      const u = new URL(url);
      return `${u.protocol}//${u.hostname}`;
    } catch {
      return url;
    }
  }

  cleanText(text) {
    return String(text)
      .replace(/\r/g, '\n')
      .replace(/ +/g, ' ')
      .replace(/\n+/g, '\n')
      .split('\n')
      .filter(line => line && line !== ' ')
      .join('\n')
      .trim();
  }
}

module.exports = Crawler;