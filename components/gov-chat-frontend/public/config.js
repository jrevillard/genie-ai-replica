/* Runtime file is overwritten in Docker by docker-entrypoint.sh.
 * This copy is bundled into dist so /config.js is real JS (correct MIME) when
 * the bundle is served without the entrypoint (e.g. misconfigured deploy). */
window.APP_CONFIG = window.APP_CONFIG || {
  apiUrl: '/api',
  /* Optional: document-repository base (must include /api). Example: "http://localhost:3001/api" when the main API has no /files routes. */
  filesApiUrl: '',
  proxyHost: typeof location !== 'undefined' ? location.hostname : 'localhost',
  cspConnectSrc: "'self'",
  keycloak: {
    url: '',
    client_id: 'genie-app'
  }
};
