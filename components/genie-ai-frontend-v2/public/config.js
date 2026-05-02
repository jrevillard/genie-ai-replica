// Placeholder runtime config for `npm run dev`.
// Local dev uses Vite's /api proxy to avoid browser CORS during auth calls.
// Docker: docker-entrypoint.sh overwrites /app/dist/config.js at container start.
window.APP_CONFIG = {
  apiUrl: '/api',
  proxyHost: 'localhost',
};
