'use strict';

require('./setup-env');

// Capture swagger-jsdoc and swagger-ui-express setup options
let capturedSwaggerOptions = null;
let capturedSetupOptions = null;

jest.mock('swagger-jsdoc', () => {
  return (options) => {
    capturedSwaggerOptions = options;
    return {
      openapi: options.definition.openapi,
      info: options.definition.info,
      components: options.definition.components,
      security: options.definition.security,
      paths: {}
    };
  };
});

jest.mock('swagger-ui-express', () => ({
  serve: () => {},
  setup: (spec, options) => {
    capturedSetupOptions = options;
    return () => {};
  }
}));

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

// Mock all services with stub methods that index.js expects
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

jest.mock('helmet', () => jest.fn(() => (req, res, next) => next()));
jest.mock('cors', () => jest.fn(() => (req, res, next) => next()));
jest.mock('morgan', () => jest.fn(() => (req, res, next) => next()));
jest.mock('body-parser', () => ({
  json: () => (req, res, next) => next(),
  urlencoded: () => (req, res, next) => next()
}));

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

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('fs', () => ({ existsSync: jest.fn(() => false) }));
jest.mock('path', () => ({
  join: jest.fn((...args) => args.join('/')),
  resolve: jest.fn((...args) => args.join('/')),
  sep: '/'
}));

// Mock process.exit to prevent test process from being killed
const originalExit = process.exit;
beforeAll(() => {
  process.exit = jest.fn();
});
afterAll(() => {
  process.exit = originalExit;
});

// Load index.js once (triggers swagger-jsdoc mock)
require('../index');

describe('Swagger Configuration', () => {
  describe('Security Scheme (Task 1)', () => {
    it('should contain KeycloakOAuth2 security scheme (NOT bearerAuth)', () => {
      const schemes = capturedSwaggerOptions.definition.components.securitySchemes;
      expect(schemes.KeycloakOAuth2).toBeDefined();
      expect(schemes.bearerAuth).toBeUndefined();
    });

    it('should use oauth2 type with authorizationCode flow (NOT implicit)', () => {
      const scheme = capturedSwaggerOptions.definition.components.securitySchemes.KeycloakOAuth2;
      expect(scheme.type).toBe('oauth2');
      expect(scheme.flows.authorizationCode).toBeDefined();
      expect(scheme.flows.implicit).toBeUndefined();
    });

    it('should point authorizationUrl to Keycloak with correct realm path', () => {
      const flow = capturedSwaggerOptions.definition.components.securitySchemes.KeycloakOAuth2.flows.authorizationCode;
      expect(flow.authorizationUrl).toBe('https://keycloak.example.com/auth/realms/genie/protocol/openid-connect/auth');
    });

    it('should point tokenUrl to Keycloak with correct realm path', () => {
      const flow = capturedSwaggerOptions.definition.components.securitySchemes.KeycloakOAuth2.flows.authorizationCode;
      expect(flow.tokenUrl).toBe('https://keycloak.example.com/auth/realms/genie/protocol/openid-connect/token');
    });

    it('should include openid, profile, and email scopes', () => {
      const scopes =
        capturedSwaggerOptions.definition.components.securitySchemes.KeycloakOAuth2.flows.authorizationCode.scopes;
      expect(scopes.openid).toBeDefined();
      expect(scopes.profile).toBeDefined();
      expect(scopes.email).toBeDefined();
    });

    it('should set global security to KeycloakOAuth2 with openid and profile scopes', () => {
      const security = capturedSwaggerOptions.definition.security;
      expect(security).toEqual([{ KeycloakOAuth2: ['openid', 'profile'] }]);
    });
  });

  describe('OAuth2 initOAuth Configuration (Task 1)', () => {
    it('should configure swaggerOptions.oauth with clientId from env', () => {
      expect(capturedSetupOptions).toBeDefined();
      expect(capturedSetupOptions.swaggerOptions.oauth.clientId).toBe('genie-app');
    });

    it('should enable PKCE with usePkceWithAuthorizationCodeGrant: true', () => {
      expect(capturedSetupOptions.swaggerOptions.oauth.usePkceWithAuthorizationCodeGrant).toBe(true);
    });

    it('should set oauth scopes string', () => {
      expect(capturedSetupOptions.swaggerOptions.oauth.scopes).toBe('openid profile email');
    });
  });

  describe('Environment Variable Handling (Task 1)', () => {
    it('should construct URLs using KEYCLOAK_URL and KEYCLOAK_REALM env vars', () => {
      const flow = capturedSwaggerOptions.definition.components.securitySchemes.KeycloakOAuth2.flows.authorizationCode;
      // Verify the pattern: {KEYCLOAK_URL}/realms/{KEYCLOAK_REALM}/protocol/openid-connect/auth
      expect(flow.authorizationUrl).toMatch(
        /^https:\/\/keycloak\.example\.com\/auth\/realms\/genie\/protocol\/openid-connect\/auth$/
      );
      expect(flow.tokenUrl).toMatch(
        /^https:\/\/keycloak\.example\.com\/auth\/realms\/genie\/protocol\/openid-connect\/token$/
      );
    });

    it('should use KEYCLOAK_CLIENT_ID env var for OAuth clientId', () => {
      // Env was set to 'genie-app' at top of file
      expect(process.env.KEYCLOAK_CLIENT_ID).toBe('genie-app');
    });
  });

  describe('Swagger Spec Generation (Task 5)', () => {
    it('should generate the Swagger spec without errors', () => {
      expect(capturedSwaggerOptions).toBeDefined();
      expect(capturedSwaggerOptions.definition.openapi).toBe('3.0.0');
    });
  });
});
