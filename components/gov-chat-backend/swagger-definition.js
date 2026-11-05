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
      // normalization (trim, control-character rejection, trailing-slash
      // strip, base-usability check below) is ignored — a scheme-only,
      // scheme-less or broken value would serve a broken server entry.
      // No shared helper with document-repository: the generator loads this
      // module with bare node (no Jest mapper), where ./shared-lib does not
      // resolve.
      url: (() => {
        const raw = (process.env.API_URL || '').trim();
        const base = raw.replace(/\/+$/, '');
        // The base-usability check the docstring names: a query or a
        // fragment would swallow the joined path, and a whitespace is not
        // a valid URL (WHATWG parsing only tolerates one by encoding or
        // stripping it).
        if (/[\s?#]/.test(base)) return '/';
        try {
          // WHATWG parsing is the exact validator: it rejects scheme-only
          // and scheme-less values; a valid URL is served verbatim
          // (including its original scheme casing).
          return /^https?:$/.test(new URL(base).protocol) ? base : '/';
        } catch {
          return '/';
        }
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
