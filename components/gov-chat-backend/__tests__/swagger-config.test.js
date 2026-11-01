'use strict';

require('./setup-env');

// Mock only the infrastructure dependencies. swagger-jsdoc is NOT mocked —
// the spec-building tests below run it for real; swagger-ui-express is
// untouched because we test the exported config objects directly.

jest.mock(
  '../shared-lib',
  () => ({
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    },
    dbService: {
      getConnection: jest.fn(() =>
        Promise.resolve({
          version: jest.fn(() => Promise.resolve({ version: '3.12', server: 'arango' }))
        })
      )
    },
    securityHeaders: {},
    SecurityMiddleware: {}
  }),
  { virtual: true }
);

jest.mock('../middleware/keycloak-auth-middleware', () => ({
  keycloakAuthMiddleware: (req, res, next) => next()
}));

const createServiceMock = () => ({
  initialize: jest.fn(() => Promise.resolve()),
  getHealth: jest.fn(() => Promise.resolve({ status: 'ok' }))
});

jest.mock('../services/user-profile-service', () => createServiceMock());
jest.mock('../services/admin-dashboard-service', () => createServiceMock());
jest.mock('../services/analytics-service', () => createServiceMock());
jest.mock('../services/query-service', () => createServiceMock());
jest.mock('../services/chat-history-service', () => createServiceMock());
jest.mock('../services/service-category-service', () => createServiceMock());
jest.mock('../services/session-service', () => createServiceMock());
jest.mock('../services/logs-service', () => createServiceMock());
jest.mock('../services/database-operations-service', () => createServiceMock());
jest.mock('../services/weather-service', () => createServiceMock());
jest.mock('../services/security-scan-service', () => createServiceMock());
jest.mock('../services/translation-service', () => createServiceMock());
jest.mock('../services/keycloak-auth-service', () => createServiceMock());
jest.mock('../services/user-provisioning-service', () => createServiceMock());

const mockUse = jest.fn();
const mockGet = jest.fn();
jest.mock('express', () => {
  const app = {
    use: mockUse,
    get: mockGet,
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    patch: jest.fn(),
    disable: jest.fn(),
    listen: jest.fn(),
    set: jest.fn()
  };
  const Router = jest.fn(() => ({
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    patch: jest.fn(),
    use: jest.fn()
  }));
  return Object.assign(
    jest.fn(() => app),
    { Router, json: jest.fn(), static: jest.fn() }
  );
});

jest.mock('helmet', () => jest.fn(() => (req, res, next) => next()));
jest.mock('cors', () => jest.fn(() => (req, res, next) => next()));
jest.mock('morgan', () => jest.fn(() => (req, res, next) => next()));
jest.mock('body-parser', () => ({
  json: () => (req, res, next) => next(),
  urlencoded: () => (req, res, next) => next()
}));

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('fs', () => ({ existsSync: jest.fn(() => false) }));
jest.mock('path', () => ({
  join: jest.fn((...args) => args.join('/')),
  resolve: jest.fn((...args) => args.join('/')),
  sep: '/'
}));

const originalExit = process.exit;
beforeAll(() => {
  process.exit = jest.fn();
});
afterAll(() => {
  process.exit = originalExit;
});

// Access the exported config objects directly — no capture mocking needed.
// The shared envelope is bound at file scope (not required inside the test)
// so the identity assert stays valid across jest.resetModules()
// re-evaluations — the file-scope bindings survive any test reorder.
const sharedDefinition = require('../swagger-definition');
const { swaggerOptions, swaggerUiSetupOptions } = require('../index');

// Build the merged spec the way the runtime does. This suite mocks fs and
// path (index.js's uploads-dir probe); the spec build needs the real ones.
// The mocks are put back in a finally so the file's other tests keep
// seeing them.
const buildSpecWithRealFs = (options) => {
  // Resolve swagger-jsdoc through the current module registry: after
  // withApiUrl's resetModules a fresh instance is returned whose internal
  // glob holds the same fresh fs mock patched below; without a reset the
  // cached instance's glob holds the file-level fs mock, which is the one
  // patched. Either way glob reads real fs at call time.
  const fs = require('fs');
  const registrySwaggerJsdoc = require('swagger-jsdoc');
  const path = require('path');
  const mockedFs = { ...fs };
  const mockedPath = { ...path };
  Object.assign(fs, jest.requireActual('fs'));
  Object.assign(path, jest.requireActual('path'));
  try {
    // The runtime object's apis glob is relative to the backend dir;
    // anchor it to this file so the test does not depend on the
    // directory jest was invoked from.
    return registrySwaggerJsdoc({
      ...options,
      apis: [path.join(__dirname, '..', 'routes', '*.js')]
    });
  } finally {
    for (const key of Object.keys(fs)) delete fs[key];
    Object.assign(fs, mockedFs);
    for (const key of Object.keys(path)) delete path[key];
    Object.assign(path, mockedPath);
  }
};

// One spec build shared by every describe that reads the same merged spec
// (the route annotations and the shared schemas do not change between
// tests). The Server URL describe below cannot use it: it re-requires
// index.js after jest.resetModules and builds its own.
const mergedSpec = buildSpecWithRealFs(swaggerOptions);

describe('Swagger Configuration', () => {
  describe('Shared envelope module', () => {
    // The envelope (openapi/info/servers/securitySchemes/security/tags) is
    // shared with scripts/generate-api-client.sh through swagger-definition.js.
    // Inlining a hand-written envelope back into index.js reintroduces the
    // two-sources drift #1218 fixed (the generator would build its spec from
    // a different envelope than the backend serves) — pin the shared object.
    it('exposes the shared swagger-definition module as the runtime envelope', () => {
      expect(swaggerOptions.definition).toBe(sharedDefinition);
    });
  });

  describe('Security Scheme (Task 1)', () => {
    it('should contain KeycloakOAuth2 security scheme (NOT bearerAuth)', () => {
      const schemes = swaggerOptions.definition.components.securitySchemes;
      expect(schemes.KeycloakOAuth2).toBeDefined();
      expect(schemes.bearerAuth).toBeUndefined();
    });

    it('should use oauth2 type with authorizationCode flow (NOT implicit)', () => {
      const scheme = swaggerOptions.definition.components.securitySchemes.KeycloakOAuth2;
      expect(scheme.type).toBe('oauth2');
      expect(scheme.flows.authorizationCode).toBeDefined();
      expect(scheme.flows.implicit).toBeUndefined();
    });

    it('should point authorizationUrl to Keycloak with correct realm path', () => {
      const flow = swaggerOptions.definition.components.securitySchemes.KeycloakOAuth2.flows.authorizationCode;
      expect(flow.authorizationUrl).toBe('https://keycloak.example.com/auth/realms/genie/protocol/openid-connect/auth');
    });

    it('should point tokenUrl to Keycloak with correct realm path', () => {
      const flow = swaggerOptions.definition.components.securitySchemes.KeycloakOAuth2.flows.authorizationCode;
      expect(flow.tokenUrl).toBe('https://keycloak.example.com/auth/realms/genie/protocol/openid-connect/token');
    });

    it('should include openid, profile, and email scopes', () => {
      const scopes = swaggerOptions.definition.components.securitySchemes.KeycloakOAuth2.flows.authorizationCode.scopes;
      expect(scopes.openid).toBeDefined();
      expect(scopes.profile).toBeDefined();
      expect(scopes.email).toBeDefined();
    });

    it('should set global security to KeycloakOAuth2 with openid and profile scopes', () => {
      const security = swaggerOptions.definition.security;
      expect(security).toEqual([{ KeycloakOAuth2: ['openid', 'profile'] }]);
    });
  });

  describe('OAuth2 initOAuth Configuration (Task 1)', () => {
    it('should configure swaggerOptions.oauth with clientId from env', () => {
      expect(swaggerUiSetupOptions).toBeDefined();
      expect(swaggerUiSetupOptions.swaggerOptions.oauth.clientId).toBe('genie-app');
    });

    it('should enable PKCE with usePkceWithAuthorizationCodeGrant: true', () => {
      expect(swaggerUiSetupOptions.swaggerOptions.oauth.usePkceWithAuthorizationCodeGrant).toBe(true);
    });

    it('should set oauth scopes string', () => {
      expect(swaggerUiSetupOptions.swaggerOptions.oauth.scopes).toBe('openid profile email');
    });
  });

  describe('Environment Variable Handling (Task 1)', () => {
    it('should construct URLs using KEYCLOAK_URL and KEYCLOAK_REALM env vars', () => {
      const flow = swaggerOptions.definition.components.securitySchemes.KeycloakOAuth2.flows.authorizationCode;
      expect(flow.authorizationUrl).toMatch(
        /^https:\/\/keycloak\.example\.com\/auth\/realms\/genie\/protocol\/openid-connect\/auth$/
      );
      expect(flow.tokenUrl).toMatch(
        /^https:\/\/keycloak\.example\.com\/auth\/realms\/genie\/protocol\/openid-connect\/token$/
      );
    });

    it('should use KEYCLOAK_CLIENT_ID env var for OAuth clientId', () => {
      expect(process.env.KEYCLOAK_CLIENT_ID).toBe('genie-app');
    });
  });

  describe('Swagger Spec Generation (Task 5)', () => {
    it('should generate the Swagger spec without errors', () => {
      expect(swaggerOptions).toBeDefined();
      expect(swaggerOptions.definition.openapi).toBe('3.0.0');
    });

    it('should resolve every $ref in the route annotations to a defined schema', () => {
      // A $ref to an undefined schema is silent at runtime — swagger-ui
      // loses the model and the client generator drops it. This shipped
      // once: !609 referenced CategoryTree without defining it. Build the
      // merged spec exactly as the runtime does and assert every local
      // schema $ref resolves.
      const spec = mergedSpec;
      const defined = new Set(Object.keys(spec.components?.schemas || {}));
      const refs = new Set();
      const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
          node.forEach(walk);
          return;
        }
        for (const [key, value] of Object.entries(node)) {
          if (key === '$ref' && typeof value === 'string' && value.startsWith('#/components/schemas/')) {
            refs.add(value.replace('#/components/schemas/', ''));
          } else {
            walk(value);
          }
        }
      };
      walk(spec);
      expect(refs.size).toBeGreaterThan(0);
      const dangling = [...refs].filter((name) => !defined.has(name));
      expect(dangling).toEqual([]);
    });
  });

  describe('Event contract split (request wire vs stored document)', () => {
    // The route destructures exactly eventType + eventData from the wire
    // (timestamp is server-set) and the service stores the payload under
    // `data`, so EventRequest documents the request wire and Event stays
    // the stored ArangoDB document shape. A shared schema carrying both
    // spellings made `eventData` vs `data` ambiguous to client authors —
    // sending `data` was silently dropped (stored as {}).
    const spec = mergedSpec;
    const eventsOps = spec.paths['/api/analytics/events'];

    it('annotates the POST request body with EventRequest, not Event', () => {
      expect(eventsOps.post.requestBody.content['application/json'].schema).toEqual({
        $ref: '#/components/schemas/EventRequest'
      });
    });

    it('EventRequest carries the request wire: eventType required, eventData, no stored fields', () => {
      const eventRequest = spec.components.schemas.EventRequest;
      expect(eventRequest.required).toEqual(['eventType']);
      expect(Object.keys(eventRequest.properties).sort()).toEqual(['eventData', 'eventType']);
      // Mirrors the runtime truthiness check: an empty eventType is
      // refused with 400.
      expect(eventRequest.properties.eventType.minLength).toBe(1);
    });

    it('Event carries the stored shape: data, no request-wire eventData', () => {
      const event = spec.components.schemas.Event;
      expect('data' in event.properties).toBe(true);
      expect('eventData' in event.properties).toBe(false);
    });

    it('documents the 201 as the save metadata and the GET list as stored Event documents', () => {
      // trackEvent returns the arangojs save() result ({_id, _key, _rev}) —
      // the full persisted document is never in the 201 body — while GET
      // /events returns the stored documents themselves.
      expect(eventsOps.post.responses['201'].content['application/json'].schema.$ref).toBe(
        '#/components/schemas/EventCreated'
      );
      expect(eventsOps.get.responses['200'].content['application/json'].schema.items.$ref).toBe(
        '#/components/schemas/Event'
      );
      // A successful save always carries all three keys.
      expect(spec.components.schemas.EventCreated.required).toEqual(['_id', '_key', '_rev']);
    });
  });

  describe('Server URL vs annotated paths', () => {
    // The exported swaggerOptions capture process.env.API_URL at module
    // load. These tests re-require index.js with API_URL pinned (unset or
    // custom) so the assertions hold no matter what the invoking shell has
    // exported.
    const withApiUrl = (apiUrl, fn) => {
      const setApiUrl = (value) => {
        if (value === undefined) {
          delete process.env.API_URL;
        } else {
          process.env.API_URL = value;
        }
      };
      const previous = process.env.API_URL;
      const previousHandlers = process.listeners('unhandledRejection');
      setApiUrl(apiUrl);
      try {
        jest.resetModules();
        return fn(require('../index'));
      } finally {
        jest.resetModules();
        // Every index.js evaluation registers another module-level
        // unhandledRejection handler (which calls process.exit) — restore
        // the count the file started with.
        process.removeAllListeners('unhandledRejection');
        previousHandlers.forEach((handler) => process.on('unhandledRejection', handler));
        setApiUrl(previous);
      }
    };

    it('default server URL carries no /api suffix (annotated paths already start with /api)', () => {
      withApiUrl(undefined, ({ swaggerOptions }) => {
        const url = swaggerOptions.definition.servers[0].url;
        expect(url).not.toMatch(/\/api\/?$/);
      });
    });

    it('a custom API_URL is used verbatim as the suffix-free server base', () => {
      withApiUrl('https://gov.example.com/gov', ({ swaggerOptions }) => {
        const url = swaggerOptions.definition.servers[0].url;
        expect(url).toBe('https://gov.example.com/gov');
        // A base carrying its own path joins the annotated paths the same
        // way: one /api, from the path, never doubled.
        const joined = `${url.replace(/\/+$/, '')}/api/queries/{queryId}/responsetime`;
        expect(joined).toMatch(/^https?:\/\//);
        expect(joined).not.toContain('/api/api');
      });
    });

    it('server URL joined with an annotated path resolves to a single /api segment', () => {
      withApiUrl(undefined, ({ swaggerOptions }) => {
        const spec = buildSpecWithRealFs(swaggerOptions);

        // A route the app actually serves, as declared in query-routes.js.
        const annotatedPath = '/api/queries/{queryId}/responsetime';
        expect(spec.paths).toHaveProperty(annotatedPath);
        // The other half of the join invariant below: every annotated path
        // starts with /api. An annotation without the prefix (a natural
        // copy of the router's own mount-relative path) would make
        // Try-it-out drop /api for that route.
        for (const specPath of Object.keys(spec.paths)) {
          expect(specPath).toMatch(/^\/api\//);
        }

        // swagger-ui's Try-it-out executes servers[0].url + path.
        const url = swaggerOptions.definition.servers[0].url;
        const joined = `${url.replace(/\/+$/, '')}${annotatedPath}`;
        expect(joined).toMatch(/^https?:\/\//);
        expect(joined).not.toContain('/api/api');
      });
    });
  });
});
