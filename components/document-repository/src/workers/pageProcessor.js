/**
 * workers/pageProcessor.js
 * CPU-intensive worker thread.
 * Receives raw HTML, cleans it using Cheerio, executes Turndown,
 * and performs language detection off the main thread.
 */
const { parentPort } = require('worker_threads');
const TurndownService = require('turndown');
const cheerio = require('cheerio');
const langdetect = require('langdetect');
const { URL: UrlParser } = require('url');

// Initialize Turndown once per thread
const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced'
});

parentPort.on('message', (task) => {
  const { html, url, config, requiredLang } = task;

  try {
    // Load HTML into Cheerio (Heavy CPU operation)
    const $ = cheerio.load(html);

    // --- 1. Content Cleaning ---
    $('script').remove();
    $('style').remove();
    $('nav').remove();
    $('footer').remove();
    $('header').remove();
    $('iframe').remove();
    $('noscript').remove();

    $('div[class*="cookie"]').remove();
    $('div[class*="privacy"]').remove();
    $('div[id*="cookie"]').remove();

    $('a:contains("ENQUIRE")').remove();
    $('a:contains("Book")').remove();
    $('button').remove();

    // Heuristic: Remove link-heavy/text-light divs
    $('div').each((i, el) => {
      const linkCount = $(el).find('a').length;
      const textLength = $(el).text().trim().length;
      if (linkCount > 5 && textLength / linkCount < 15) {
        $(el).remove();
      }
    });

    // --- 2. Fix Relative Paths ---
    // Fix Images
    $('img').each((i, el) => {
      const src = $(el).attr('src');
      if (src && !src.startsWith('http') && !src.startsWith('data:')) {
        try {
          const absoluteUrl = new UrlParser(src, url).href;
          $(el).attr('src', absoluteUrl);
        } catch {
          // Ignore invalid URLs
        }
      }
    });

    // Fix Links
    $('a').each((i, el) => {
      const href = $(el).attr('href');
      if (href && !href.startsWith('http') && !href.startsWith('#') && !href.startsWith('mailto:')) {
        try {
          const absoluteUrl = new UrlParser(href, url).href;
          $(el).attr('href', absoluteUrl);
        } catch {
          // Ignore invalid URLs
        }
      }
    });

    // --- 3. Extract Main Content ---
    let contentHtml = null;

    // A. Configured Selector
    if (config && config.contentSelector && config.contentSelector.trim() !== '') {
      try {
        const userHtml = $(config.contentSelector.trim()).html();
        if (userHtml && userHtml.trim()) {
          contentHtml = userHtml;
        }
      } catch {
        // Ignore selector errors
      }
    }

    // B. Fallback Heuristics
    if (!contentHtml || !contentHtml.trim()) {
      contentHtml = $('main').html() || $('article').html() || $('div.content').html() || $('body').html();
    }

    if (!contentHtml || !contentHtml.trim()) {
      parentPort.postMessage({ result: 'empty' });
      return;
    }

    // --- 4. Convert to Markdown (Heavy CPU operation) ---
    const markdown = turndownService.turndown(contentHtml);

    // --- 5. Language Detection ---
    let shouldSkip = false;
    let detectedLang = null;

    if (markdown && markdown.length > 50) {
      // A. Check HTML Tag
      const htmlLang = $('html').attr('lang');
      if (htmlLang) {
        detectedLang = htmlLang.split('-')[0].toLowerCase();
      }

      // B. Double Check Content if needed
      if (!detectedLang || detectedLang === requiredLang) {
        const algoDetect = langdetect.detectOne(markdown);
        if (algoDetect) detectedLang = algoDetect;
      }

      // C. Filter
      if (detectedLang && detectedLang !== requiredLang) {
        shouldSkip = true;
      }
    }

    // Send result back to main thread
    parentPort.postMessage({
      result: 'success',
      markdown,
      shouldSkip,
      detectedLang
    });
  } catch (error) {
    parentPort.postMessage({ result: 'error', message: error.message });
  }
});
