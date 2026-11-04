'use strict';

const swaggerOptions = require('../../config/swaggerConfig');

describe('Document Repository swagger config', () => {
  it('serves the server entry as a relative URL (resolved against the page origin)', () => {
    const server = swaggerOptions.definition.servers[0];
    // A hardcoded localhost base points Try-it-out at the browsing user's
    // own machine; a relative base resolves against the origin the docs
    // are served from, in every topology.
    expect(server.url).toBe('/');
  });
});
