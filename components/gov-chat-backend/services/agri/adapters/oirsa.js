/**
 * oirsa — OIRSA regional plant-health news (WordPress REST).
 *
 * Verified 2026-09-16: https://web.oirsa.org/wp-json/wp/v2/posts?categories=121903
 * (Noticias category, Spanish). Items pass through a pest-keyword lexicon;
 * hits become regional alert items (severity defaults to "info" — OIRSA
 * publishes no severity fields).
 */
const { fetchJson } = require('../http');
const { docKey } = require('../keys');

const PEST_LEXICON = [
  'langosta',
  'roya',
  'fusarium',
  'gusano',
  'mosca',
  'hlb',
  'broca',
  'plaga',
  'plagas',
  'cogollero',
  'tizón',
  'tizón tardío',
  'mosca blanca',
  'enfermedad',
  'fitosanitari',
  'cuarentenari'
];

module.exports = {
  id: 'oirsa',
  configPrefix: 'OIRSA',
  cadence: '24h',
  defaults: {
    baseUrl: 'https://web.oirsa.org/wp-json/wp/v2/posts',
    categoryId: 121903, // Noticias
    perPage: 20
  },
  endpoints: ['pest-alerts'],

  async resolve(cfg) {
    return `${cfg.baseUrl}?categories=${cfg.categoryId}&per_page=${cfg.perPage}&orderby=date&order=desc`;
  },

  async fetch(url) {
    return fetchJson(url, { timeoutMs: 20000 });
  },

  parse(json) {
    return Array.isArray(json) ? json : [];
  },

  normalize(posts) {
    const docs = [];
    for (const post of posts) {
      const title = (post.title && post.title.rendered) || '';
      const text = title.toLowerCase();
      const matched = PEST_LEXICON.filter((k) => text.includes(k));
      if (matched.length === 0) continue;

      const logical = `oirsa:${post.id}`;
      docs.push({
        _key: docKey(logical),
        kind: 'regional-news',
        title: title.replace(/&#\d+;/g, '').trim(),
        publishedAt: post.date || null,
        link: post.link || null,
        matchedKeywords: matched,
        severity: 'info', // OIRSA carries no severity data — honest default
        source: 'OIRSA',
        language: 'es'
      });
    }
    return { collection: 'agri_alerts', docs };
  }
};
