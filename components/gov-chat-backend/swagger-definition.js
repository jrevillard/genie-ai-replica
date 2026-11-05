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
      // Default: RELATIVE ('/') — swagger-ui resolves it against the
      // origin the docs page is served from, same-origin in dev and behind
      // the gateway, so Try-it-out works in every topology without config.
      // Deployments do not receive API_URL; its one consumer is the
      // client-generation pin (scripts/generate-api-client.sh sets it
      // under env -i to bake a deterministic base into the committed Dart
      // artifacts). A value that is not an absolute http(s) URL after
      // normalization (trim, trailing-slash strip) is ignored — a
      // scheme-only or scheme-less value would serve a broken server
      // entry. Keep this normalization in sync with
      // components/document-repository/src/config/swaggerConfig.js —
      // a shared helper is not possible here: the generator loads this
      // module with bare node (no Jest mapper), where ./shared-lib does
      // not resolve.
      url: (() => {
        const base = (process.env.API_URL || '').trim().replace(/\/+$/, '');
        return /^https?:\/\/.+/.test(base) ? base : '/';
      })(),
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
