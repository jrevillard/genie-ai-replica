/**
 * gdelt — GDELT DOC 2.0 news, four variants (global/local × EN/ES).
 *
 * Verified 2026-09-16: no key, unlimited governmental use license (cite
 * GDELT). Sticky rate limiter — the BMAD gap-check measured throttling well
 * beyond the documented 5 s, so this adapter enforces >=10 s spacing
 * between its own calls and is only ever invoked by the scheduler.
 * Title-only results (no snippet field in artlist mode).
 *
 * The local variants match international coverage OF El Salvador in each
 * language: no English-language Salvadoran outlet feed exists, so English
 * "local" news comes from English-language press writing about El Salvador
 * (user req 2026-09-18: news language must follow the selected UI locale).
 */
const { fetchJson } = require('../http');
const { isRelevantNews } = require('../newsfilter');
const nodeCrypto = require('node:crypto');

const QUERIES = [
  {
    lang: 'en',
    scope: 'global',
    q: '(wheat OR maize OR fertilizer OR "commodity prices") (market OR prices) sourcelang:eng'
  },
  {
    lang: 'es',
    scope: 'global',
    q: '(trigo OR maíz OR fertilizantes OR "precios de alimentos") (mercado OR precios) sourcelang:spa'
  },
  {
    lang: 'en',
    scope: 'local',
    q: '"El Salvador" (maize OR fertilizer OR coffee OR sugar OR harvest OR "commodity prices" OR "food prices") (market OR prices OR exports OR trade OR economy) sourcelang:eng'
  },
  {
    lang: 'es',
    scope: 'local',
    q: '"El Salvador" (maíz OR fertilizantes OR café OR azúcar OR granos OR cosecha OR "precios de alimentos") (mercado OR precios OR exportaciones OR comercio OR economía) sourcelang:spa'
  }
];

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
    return QUERIES.map((variant) => ({
      lang: variant.lang,
      scope: variant.scope,
      url:
        'https://api.gdeltproject.org/api/v2/doc/doc' +
        `?query=${encodeURIComponent(variant.q)}` +
        `&mode=artlist&format=json&sort=datedesc&maxrecords=${cfg.maxRecords}`
    }));
  },

  async fetch(urls) {
    if (Date.now() < backoffUntil) {
      throw new Error(`GDELT rate-limited (429) — backing off until ${new Date(backoffUntil).toISOString()}`);
    }
    const out = [];
    for (const { lang, scope, url } of urls) {
      const wait = lastCallAt + GDELT_MIN_SPACING_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastCallAt = Date.now();
      try {
        out.push({ lang, scope, json: await fetchJson(url, { timeoutMs: 25000, maxRetries: 1 }) });
      } catch (error) {
        if (/429/.test(error.message)) {
          backoffUntil = Date.now() + 2 * 3600 * 1000;
          throw new Error(`GDELT 429 rate-limited — backing off until ${new Date(backoffUntil).toISOString()}`, {
            cause: error
          });
        }
        out.push({ lang, scope, error: error.message });
      }
    }
    return out;
  },

  parse(results) {
    return results;
  },

  normalize(results) {
    const docs = [];
    for (const { lang, scope, json, error } of results) {
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
          scope,
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
