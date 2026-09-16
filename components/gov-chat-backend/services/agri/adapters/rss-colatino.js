/**
 * rss-colatino — Diario CoLatino feed (Salvadoran outlet, Spanish).
 * Verified 2026-09-16: https://www.diariocolatino.com/feed/ live, same-day
 * fresh, with REAL text snippets (the only Salvadoran outlet with a
 * directly-accessible feed — LPG/EDH block direct RSS with 403s).
 */
const { createRssAdapter } = require('./_rss-factory');

module.exports = createRssAdapter({
  id: 'rss-colatino',
  configPrefix: 'RSS_COLATINO',
  url: 'https://www.diariocolatino.com/feed/',
  scope: 'local',
  language: 'es',
  sourceLabel: 'Diario CoLatino'
});
