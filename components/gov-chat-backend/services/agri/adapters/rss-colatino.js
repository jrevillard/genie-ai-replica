/**
 * rss-colatino — Diario CoLatino ECONOMÍA section feed (Salvadoran outlet,
 * Spanish). Switched from the general /feed/ on 2026-09-18: the general
 * feed is a firehose of crime/politics/entertainment that the relevance
 * gate strips down to ~1 usable item per day; the economía category feed
 * is relevant by construction (verified live: 200, same-day items).
 * The general feed's legacy docs age out of the serve window.
 */
const { createRssAdapter } = require('./_rss-factory');

module.exports = createRssAdapter({
  id: 'rss-colatino',
  configPrefix: 'RSS_COLATINO',
  url: 'https://www.diariocolatino.com/category/economia/feed/',
  scope: 'local',
  language: 'es',
  sourceLabel: 'Diario CoLatino (Economía)'
});
