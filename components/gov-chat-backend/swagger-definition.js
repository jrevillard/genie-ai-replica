// Shared OpenAPI envelope — the single source of truth for the definition
// (non-annotation) half of the runtime spec: openapi version, info, servers,
// securitySchemes, global security and tags. Consumed by index.js (the
// runtime swagger spec) and by scripts/generate-api-client.sh (the mobile
// client generation spec), so the envelope can no longer drift between the
// spec the backend serves and the spec the client is generated from —
// #1122 did the same for components.schemas (swagger-schemas.js).
// Side-effect-free by design: no logging, no fs, no network — it only
// reads process.env at require time.
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
      url: process.env.API_URL || `http://localhost:${process.env.PORT || 3000}`,
      description: 'Development server'
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
