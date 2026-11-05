'use strict';

const swaggerOptions = require('../../config/swaggerConfig');

describe('Document Repository swagger config', () => {
  it('serves the server entry as a relative URL (resolved against the page origin)', () => {
    const server = swaggerOptions.definition.servers[0];
    // A relative base resolves against the origin the docs are served
    // from — Try-it-out stays same-origin in every topology.
    expect(server.url).toBe('/');
  });

  it('every annotated path starts with /api (Try-it-out keeps the prefix for any server base)', () => {
    // swagger-ui executes servers[0].url + path, so every annotated path
    // must carry the /api prefix itself — an annotation copied
    // mount-relative would make Try-it-out drop it for that route.
    const swaggerJsdoc = require('swagger-jsdoc');
    const spec = swaggerJsdoc(swaggerOptions);
    expect(Object.keys(spec.paths).length).toBeGreaterThan(0);
    for (const specPath of Object.keys(spec.paths)) {
      expect(specPath).toMatch(/^\/api\//);
    }
  });
});
