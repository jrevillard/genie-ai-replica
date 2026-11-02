// Static development fallback for runtime configuration.
// In production, docker-entrypoint.sh overwrites /app/dist/config.js at
// container start (window.APP_CONFIG). Ported from upstream GenieAI v2.0.1
// (public/config.js). A7: registration/password-reset URL entries removed —
// DEC-3 keeps those flows on Keycloak's own pages, so nothing consumed them.
window.APP_CONFIG = {
  apiUrl: "/api",
  proxyHost: "localhost",
  cspConnectSrc: "'self' http://localhost:3000 http://localhost:8090 http://127.0.0.1:8090 ws://localhost:3000 ws://localhost:8090",
  keycloak: {
    url: "",
    realm: "agrivisory",
    client_id: "itu-agrivisory-client"
  }
};
