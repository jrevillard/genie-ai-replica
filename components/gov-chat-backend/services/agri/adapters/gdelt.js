/**
 * gdelt — GDELT DOC 2.0 global news (EN + ES variants).
 *
 * Verified 2026-09-16: no key, unlimited governmental use license (cite
 * GDELT). Sticky rate limiter — the BMAD gap-check measured throttling well
 * beyond the documented 5 s, so this adapter enforces >=10 s spacing
 * between its own calls and is only ever invoked by the scheduler.
 * Title-only results (no snippet field in artlist mode).
 */
const { fetchJson } = require('../http');
const { isRelevantNews } = require('../newsfilter');
const nodeCrypto = require('node:crypto');

const QUERIES = {
  en: '(wheat OR maize OR fertilizer OR "commodity prices") (market OR prices) sourcelang:eng',
  es: '(trigo OR maíz OR fertilizantes OR "precios de alimentos") (mercado OR precios) sourcelang:spa'
};

const GDELT_MIN_SPACING_MS = 10500; // measured sticky limiter (gap-check §5)
let lastCallAt = 0;
// Hard backoff after a 429: the limiter is sticky for hours, and retrying
// into it extends the block. One 429 → quiet for 2 h (found live 2026-09-18:
// every pass failed "0 documents" while the picker went empty).
let backoffUntil = 0;

module.exports = {
  id: 'gdelt',
  configPrefix: 'GDELT',
  cadence: '1h',
  defaults: {
    maxRecords: 25
  },
  endpoints: ['news'],

  async resolve(cfg) {
    return Object.keys(QUERIES).map((lang) => ({
      lang,
      url:
        'https://api.gdeltproject.org/api/v2/doc/doc' +
        `?query=${encodeURIComponent(QUERIES[lang])}` +
        `&mode=artlist&format=json&sort=datedesc&maxrecords=${cfg.maxRecords}`
    }));
  },

  async fetch(urls) {
    if (Date.now() < backoffUntil) {
      throw new Error(`GDELT rate-limited (429) — backing off until ${new Date(backoffUntil).toISOString()}`);
    }
    const out = [];
    for (const { lang, url } of urls) {
      const wait = lastCallAt + GDELT_MIN_SPACING_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastCallAt = Date.now();
      try {
        out.push({ lang, json: await fetchJson(url, { timeoutMs: 25000, maxRetries: 1 }) });
      } catch (error) {
        if (/429/.test(error.message)) {
          backoffUntil = Date.now() + 2 * 3600 * 1000;
          throw new Error(`GDELT 429 rate-limited — backing off until ${new Date(backoffUntil).toISOString()}`, {
            cause: error
          });
        }
        out.push({ lang, error: error.message });
      }
    }
    return out;
  },

  parse(results) {
    return results;
  },

  normalize(results) {
    const docs = [];
    for (const { lang, json, error } of results) {
      if (error) continue;
      for (const article of (json && json.articles) || []) {
        // Relevance gate: economics/agriculture only (user req 2026-09-18)
        if (!isRelevantNews({ title: article.title })) continue;
        const publishedAt = article.seendate
          ? article.seendate.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z')
          : null;
        const logical = `gdelt:${article.url}`;
        docs.push({
          _key: nodeCrypto.createHash('sha1').update(logical).digest('base64url'),
          kind: 'news',
          scope: 'global',
          language: lang,
          title: article.title || '',
          source: article.domain || 'GDELT',
          url: article.url,
          publishedAt,
          sourceSystem: 'gdelt'
        });
      }
    }
    return { collection: 'agri_news', docs };
  }
};
