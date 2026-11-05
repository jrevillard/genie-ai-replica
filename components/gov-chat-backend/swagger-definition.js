// Single source of truth for the OpenAPI envelope (openapi, info, servers,
// securitySchemes, global security, tags), required by index.js (the runtime
// swagger spec) and scripts/generate-api-client.sh (the mobile client
// generation spec). Reads process.env at require time; no other side effects.
module.exports = {
  openapi: '3.0.0',
  info: {
    title: 'Government Services API',
    version: '1.0.0',
    description: 'API documentation for Government Services microservices',
    contact: {
      name: 'API Support',
      email: 'support@example.com'
    }
  },
  servers: [
    {
      // Base URL WITHOUT the /api prefix — the annotated paths in the
      // routes already start with /api, and swagger-ui resolves each
      // request as servers[0].url + path. A suffixed URL makes Try-it-out
      // build doubled /api/api/... request URLs.
      // The default is RELATIVE: swagger-ui resolves it against the page
      // origin, so Try-it-out works in dev AND through the gateway — an
      // absolute localhost default targets the browser's own machine in
      // every deployed topology (only nginx 80/443 is exposed) and is
      // blocked twice more on https (mixed content + CSP connect-src).
      // Set API_URL (backend container environment) to pin an absolute
      // base for external tooling.
      url: process.env.API_URL || '/',
      description: 'API server base'
    }
  ],
  components: {
    schemas: require('./swagger-schemas'),
    securitySchemes: {
      KeycloakOAuth2: {
        type: 'oauth2',
        description: 'Keycloak OAuth2 authentication (Authorization Code + PKCE)',
        flows: {
          authorizationCode: {
            authorizationUrl: `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/auth`,
            tokenUrl: `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/token`,
            scopes: {
              openid: 'OpenID Connect scope',
              profile: 'User profile information',
              email: 'User email address'
            }
          }
        }
      }
    }
  },
  security: [{ KeycloakOAuth2: ['openid', 'profile'] }],
  tags: [
    {
      name: 'Chat History',
      description: 'Endpoints for managing chat history and conversations'
    },
    {
      name: 'Weather',
      description: 'Endpoints for fetching weather data'
    },
    {
      name: 'Translation',
      description: 'On-the-fly text translation endpoints'
    }
  ]
};
