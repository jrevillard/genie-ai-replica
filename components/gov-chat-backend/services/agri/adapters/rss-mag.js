/**
 * rss-mag — MAG El Salvador press/bulletin feed (official, Spanish).
 * Verified 2026-09-16: https://www.mag.gob.sv/feed/ live, latest item
 * 2026-09-14. Primary local news source (ToS-clean Google News replacement).
 */
const { createRssAdapter } = require('./_rss-factory');

module.exports = createRssAdapter({
  id: 'rss-mag',
  configPrefix: 'RSS_MAG',
  url: 'https://www.mag.gob.sv/feed/',
  scope: 'local',
  language: 'es',
  sourceLabel: 'MAG El Salvador'
});
