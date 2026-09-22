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
const { docKey } = require('../keys');

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
    q: '"El Salvador" (maize OR fertilizer OR coffee OR sugar OR harvest OR "commodity prices" OR "food prices" OR "coffee exports") sourcelang:eng'
  },
  {
    lang: 'es',
    scope: 'local',
    q: '"El Salvador" (maíz OR fertilizantes OR café OR azúcar OR granos OR cosecha OR "precios de alimentos" OR "exportaciones de café") sourcelang:spa'
  }
];

const GDELT_MIN_SPACING_MS = 10500; // measured sticky limiter (gap-check §5)
const GDELT_BACKOFF_KEY = 'agri:gdelt:backoff';
const GDELT_BACKOFF_MS = 2 * 3600 * 1000;
// Per-process last-call timestamp (cheap, doesn't need cross-replica sync).
// The 429 backoff state IS shared via Redis below so two swarm replicas
// stop hammering after one of them hits the sticky limiter.
let lastCallAt = 0;
// Lazy Redis client for cross-replica 429 backoff. Null when Redis is
// unavailable — falls back to per-process state (same as before).
let redisClient = null;
async function getRedis() {
  if (redisClient) return redisClient;
  try {
    const { resolveRedisUrl } = require('../http');
    const url = resolveRedisUrl();
    if (!url) return null;
    const Redis = require('ioredis');
    redisClient = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
    await redisClient.connect();
    return redisClient;
  } catch {
    return null;
  }
}

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
    // Cross-replica 429 backoff: read the shared backoff expiry from Redis
    // (one replica's 429 stops the others from hammering).
    const redis = await getRedis();
    if (redis) {
      try {
        const until = await redis.get(GDELT_BACKOFF_KEY);
        if (until && Date.now() < Number(until)) {
          throw new Error(`GDELT rate-limited (429) — backing off until ${new Date(Number(until)).toISOString()}`);
        }
      } catch {
        /* Redis read failure → fall through to per-process check */
      }
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
          // Publish to Redis so other replicas see it (key has its own TTL).
          if (redis) {
            try {
              await redis.set(GDELT_BACKOFF_KEY, String(Date.now() + GDELT_BACKOFF_MS), 'PX', GDELT_BACKOFF_MS);
            } catch {
              /* best-effort */
            }
          }
          throw new Error(
            `GDELT 429 rate-limited — backing off until ${new Date(Date.now() + GDELT_BACKOFF_MS).toISOString()}`,
            {
              cause: error
            }
          );
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
          _key: docKey(logical),
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
