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
    // A hardcoded localhost base points Try-it-out at the browsing user's
    // own machine; a relative base resolves against the origin the docs
    // are served from, in every topology.
    expect(server.url).toBe('/');
  });

  it('pins an absolute base when API_URL is set', () => {
    const server = loadConfig('https://gov.example.com').definition.servers[0];
    expect(server.url).toBe('https://gov.example.com');
  });
});
