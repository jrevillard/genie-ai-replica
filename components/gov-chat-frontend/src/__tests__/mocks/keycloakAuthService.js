'use strict';

// Closure-based references for jest.mock hoisting compatibility
const mockInitialize = jest.fn();
const mockLogin = jest.fn();
const mockHandleCallback = jest.fn();
const mockLogout = jest.fn();
const mockGetAccessToken = jest.fn();
const mockGetAccessTokenClaims = jest.fn();
const mockGetUser = jest.fn();
const mockIsAuthenticated = jest.fn().mockReturnValue(false);
const mockSigninSilent = jest.fn();
const mockOnAccessTokenUpdated = jest.fn();
const mockRemoveAccessTokenUpdatedCallback = jest.fn();
const mockGetUserManager = jest.fn();
const mockClearStaleState = jest.fn();

/**
 * Creates the default keycloakAuthService mock object for
 * jest.mock('@/services/keycloakAuthService', ...).
 */
function createDefaultMock() {
  return {
    initialize: mockInitialize,
    login: mockLogin,
    handleCallback: mockHandleCallback,
    logout: mockLogout,
    getAccessToken: mockGetAccessToken,
    getAccessTokenClaims: mockGetAccessTokenClaims,
    getUser: mockGetUser,
    isAuthenticated: mockIsAuthenticated,
    signinSilent: mockSigninSilent,
    onAccessTokenUpdated: mockOnAccessTokenUpdated,
    removeAccessTokenUpdatedCallback: mockRemoveAccessTokenUpdatedCallback,
    getUserManager: mockGetUserManager,
    clearStaleState: mockClearStaleState
  };
}

/**
 * Create a mock OIDC user matching the oidc-client-ts User shape.
 * Fields are consistent with backend __tests__/fixtures/users.js for
 * cross-component fixture consistency.
 *
 * @param {object} overrides - Override any default field
 * @returns {object} Mock OIDC user
 */
function createMockKeycloakUser(overrides = {}) {
  return {
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    token_type: 'Bearer',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expired: false,
    profile: {
      sub: 'user-123',
      iss: 'http://localhost:8080/realms/genie',
      iss_sub: 'http://localhost:8080/realms/genie#user-123',
      email: 'test@example.com',
      name: 'Test User',
      preferred_username: 'testuser',
      realm_access: { roles: ['user'] },
      resource_access: { 'genie-app': { roles: ['user'] } },
      aud: 'genie-app',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000)
    },
    ...overrides
  };
}

/**
 * Create a mock JWT access token string.
 * For tests that need a realistic-looking token without crypto.
 *
 * @param {object} claims - Override default JWT claims
 * @returns {string} Mock JWT token (header.payload.signature format)
 */
function createMockToken(claims = {}) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const defaultPayload = {
    sub: 'user-123',
    iss: 'http://localhost:8080/realms/genie',
    iss_sub: 'http://localhost:8080/realms/genie#user-123',
    name: 'Test User',
    email: 'test@example.com',
    realm_access: { roles: ['user'] },
    resource_access: { 'genie-app': { roles: ['user'] } },
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000)
  };
  const payload = { ...defaultPayload, ...claims };

  // Base64url encode (not real JWT — just for test assertions)
  const base64url = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  return base64url(header) + '.' + base64url(payload) + '.mock-signature';
}

/**
 * Reset all mock state. Call in beforeEach() for test isolation.
 */
function resetKeycloakMock() {
  [
    mockInitialize,
    mockLogin,
    mockHandleCallback,
    mockLogout,
    mockGetAccessToken,
    mockGetAccessTokenClaims,
    mockGetUser,
    mockSigninSilent,
    mockOnAccessTokenUpdated,
    mockRemoveAccessTokenUpdatedCallback,
    mockGetUserManager,
    mockClearStaleState
  ].forEach((fn) => fn.mockReset());

  // Restore default implementations
  mockIsAuthenticated.mockReset();
  mockIsAuthenticated.mockReturnValue(false);
  mockGetAccessToken.mockResolvedValue('mock-access-token');
}

module.exports = {
  mockInitialize,
  mockLogin,
  mockHandleCallback,
  mockLogout,
  mockGetAccessToken,
  mockGetAccessTokenClaims,
  mockGetUser,
  mockIsAuthenticated,
  mockSigninSilent,
  mockOnAccessTokenUpdated,
  mockRemoveAccessTokenUpdatedCallback,
  mockGetUserManager,
  mockClearStaleState,
  createDefaultMock,
  createMockKeycloakUser,
  createMockToken,
  resetKeycloakMock
};
