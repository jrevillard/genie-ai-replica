'use strict';

describe('Document Repository swagger config', () => {
  const loadConfig = (apiUrl) => {
    const previous = process.env.API_URL;
    if (apiUrl === undefined) {
      delete process.env.API_URL;
    } else {
      process.env.API_URL = apiUrl;
    }
    jest.resetModules();
    try {
      return require('../../config/swaggerConfig');
    } finally {
      jest.resetModules();
      if (previous === undefined) {
        delete process.env.API_URL;
      } else {
        process.env.API_URL = previous;
      }
    }
  };

  it('serves the server entry as a relative URL (resolved against the page origin)', () => {
    const server = loadConfig(undefined).definition.servers[0];
    // A relative base resolves against the origin the docs are served
    // from — Try-it-out stays same-origin in every topology.
    expect(server.url).toBe('/');
  });

  it('pins an absolute base when API_URL is set, without a trailing slash', () => {
    // A trailing slash would join the annotated paths into //api/... URLs.
    expect(loadConfig('https://gov.example.com/').definition.servers[0].url).toBe('https://gov.example.com');
  });

  it('trims whitespace around API_URL (a padded value would leak into the server URL)', () => {
    expect(loadConfig('  https://gov.example.com  ').definition.servers[0].url).toBe('https://gov.example.com');
    expect(loadConfig(' ').definition.servers[0].url).toBe('/');
  });

  it('treats an empty API_URL as unset (compose always passes the variable, often empty)', () => {
    expect(loadConfig('').definition.servers[0].url).toBe('/');
  });

  it('every annotated path starts with /api (Try-it-out keeps the prefix for any server base)', () => {
    // swagger-ui executes servers[0].url + path, so every annotated path
    // must carry the /api prefix itself — an annotation copied
    // mount-relative would make Try-it-out drop it for that route.
    const swaggerJsdoc = require('swagger-jsdoc');
    const spec = swaggerJsdoc(loadConfig(undefined));
    expect(Object.keys(spec.paths).length).toBeGreaterThan(0);
    for (const specPath of Object.keys(spec.paths)) {
      expect(specPath).toMatch(/^\/api\//);
    }
  });
});
