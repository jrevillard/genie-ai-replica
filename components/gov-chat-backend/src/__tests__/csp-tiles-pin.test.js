/**
 * M.2 pin: the Helmet CSP must allow OpenStreetMap tiles. The backend
 * serves the frontend (express.static('dist')) so this CSP rides every
 * page — dropping the tile origin greys the farmer-profile map with
 * console errors like: img-src 'self' data: blocked the image.
 * Source-pin test (index.js calls server.listen on require, so we read
 * the file rather than import it).
 */
const fs = require('fs');
const path = require('path');

describe('Helmet CSP allows OSM map tiles (M.2)', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../index.js'),
    'utf8'
  );

  it('imgSrc includes the OpenStreetMap tile origin', () => {
    expect(source).toMatch(
      /imgSrc: \["'self'", "data:", "https:\/\/\*\.tile\.openstreetmap\.org"\]/
    );
  });

  // M.2 (continued): the LIVE page CSP comes from the nginx template's
  // frontend locations (proxy_pass $frontend_addr) — the backend Helmet
  // header never reaches the document on the deployed site. Pin both.
  it('nginx template frontend CSP allows the tile origin (both locations)', () => {
    const template = fs.readFileSync(
      path.join(__dirname, '../../../../api-gateway-solution/nginx/conf/default.conf.template'),
      'utf8'
    );
    const cspLines = template
      .split('\n')
      .filter((l) => l.includes('add_header Content-Security-Policy') && l.includes('${CSP_CONNECT_SRC}'));
    expect(cspLines.length).toBe(2);
    for (const line of cspLines) {
      expect(line).toContain("img-src 'self' data: https://*.tile.openstreetmap.org");
    }
  });
});
