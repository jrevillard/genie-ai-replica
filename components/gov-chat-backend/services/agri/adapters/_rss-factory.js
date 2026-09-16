/**
 * RSS adapter factory (WordPress-generated feeds).
 *
 * Minimal dependency-free RSS 2.0 extraction: <item> blocks with
 * title/link/pubDate/description. Hardened per BMAD verification: no
 * entity expansion beyond the standard five, tags stripped from
 * descriptions, size capped upstream by http.js.
 */
const { fetchUrl } = require('../http');
const nodeCrypto = require('node:crypto');

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" };
const decodeEntities = (s) => String(s || '').replace(/&(amp|lt|gt|quot|#39|apos);/g, (m) => ENTITIES[m]);
const stripTags = (s) => decodeEntities(String(s || '').replace(/<[^>]*>/g, '')).trim();
const fromCdata = (s) => {
  const str = String(s || '');
  const m = str.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return m ? m[1] : str;
};

/** Extract the first <tag>…</tag> content of a chunk (CDATA-aware). */
function tag(chunk, name) {
  const m = chunk.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? fromCdata(m[1]) : null;
}

function parseRss(xml) {
  const items = [];
  const blocks = String(xml || '').match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const block of blocks) {
    const title = stripTags(tag(block, 'title'));
    if (!title) continue;
    items.push({
      title,
      link: stripTags(tag(block, 'link')) || null,
      pubDate: stripTags(tag(block, 'pubDate')) || null,
      description: stripTags(tag(block, 'description')).slice(0, 300) || null,
      sourceName: stripTags(tag(block, 'source')) || null
    });
  }
  return items;
}

/**
 * @param {Object} opts
 * @param {string} opts.id
 * @param {string} opts.configPrefix
 * @param {string} opts.url - feed URL
 * @param {string} opts.scope - 'local' | 'institutional'
 * @param {string} opts.language - 'es' | 'en'
 * @param {string} opts.sourceLabel - display/source name
 */
function createRssAdapter(opts) {
  return {
    id: opts.id,
    configPrefix: opts.configPrefix,
    cadence: '1h',
    defaults: { url: opts.url },
    endpoints: ['news'],

    async resolve(cfg) {
      return cfg.url;
    },

    async fetch(url) {
      const res = await fetchUrl(url, { timeoutMs: 20000 });
      return res.bodyText;
    },

    parse: parseRss,

    normalize(items) {
      const docs = [];
      for (const item of items) {
        const url = item.link || '';
        const logical = `${opts.id}:${url || item.title}`;
        docs.push({
          _key: nodeCrypto.createHash('sha1').update(logical).digest('base64url'),
          kind: 'news',
          scope: opts.scope,
          language: opts.language,
          title: item.title,
          source: opts.sourceLabel,
          url: url || null,
          publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : null,
          snippet: item.description,
          sourceSystem: opts.id
        });
      }
      return { collection: 'agri_news', docs };
    }
  };
}

module.exports = { createRssAdapter, parseRss };
