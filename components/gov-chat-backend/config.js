// config.js - Simple configuration with just API endpoints
const config = {
  // API configuration
  api: {
    baseUrl: process.env.API_BASE_URL || 'http://localhost:3000/api',
    healthEndpoint: '/health',
    endpoints: [
      '/api/me',
      '/api/queries',
      '/api/logs',
      '/api/admin/system-health',
      '/api/admin/logs',
      '/api/admin/security-metrics',
      '/api/analytics/dashboard'
    ]
  },

  // Keycloak configuration
  keycloak: {
    url: process.env.KEYCLOAK_URL,
    realm: process.env.KEYCLOAK_REALM,
    additionalRealms: (() => {
      try {
        return JSON.parse(process.env.KEYCLOAK_ADDITIONAL_REALMS || '[]');
      } catch {
        return [];
      }
    })()
  },

  // Security scan configuration
  security: {
    hiddenFiles: ['/.env', '/.git/config', '/.gitignore', '/.npmrc', '/node_modules/.package-lock.json']
  }
};

module.exports = config;
