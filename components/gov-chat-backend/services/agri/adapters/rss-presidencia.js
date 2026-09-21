/**
 * rss-presidencia — Presidencia de El Salvador feed (official, Spanish).
 * Verified 2026-09-16: https://www.presidencia.gob.sv/feed/ live, latest
 * item 2026-09-07.
 */
const { createRssAdapter } = require('./_rss-factory');

module.exports = createRssAdapter({
  id: 'rss-presidencia',
  configPrefix: 'RSS_PRESIDENCIA',
  url: 'https://www.presidencia.gob.sv/feed/',
  scope: 'local',
  language: 'es',
  sourceLabel: 'Presidencia El Salvador'
});
