/**
 * rss-fao — FAO newsroom feed (institutional global agriculture news).
 * Verified 2026-09-16: https://www.fao.org/feeds/fao-newsroom-rss live,
 * latest item 2026-09-15.
 */
const { createRssAdapter } = require('./_rss-factory');

module.exports = createRssAdapter({
  id: 'rss-fao',
  configPrefix: 'RSS_FAO',
  url: 'https://www.fao.org/feeds/fao-newsroom-rss',
  scope: 'institutional',
  language: 'en',
  sourceLabel: 'FAO'
});
