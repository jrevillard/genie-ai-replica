'use strict';

// Mock keycloakAuthService before requiring the store module
const mockInitialize = jest.fn();
const mockLogin = jest.fn();
const mockHandleCallback = jest.fn();
const mockLogout = jest.fn();
const mockGetAccessTokenClaims = jest.fn(() => ({ realm_access: { roles: ['user', 'admin'] } }));
const mockOnAccessTokenUpdated = jest.fn();
const mockRemoveAccessTokenUpdatedCallback = jest.fn();

jest.mock('@/services/keycloakAuthService', () => ({
  __esModule: true,
  default: {
    initialize: mockInitialize,
    login: mockLogin,
    handleCallback: mockHandleCallback,
    logout: mockLogout,
    getAccessToken: jest.fn(),
    getAccessTokenClaims: mockGetAccessTokenClaims,
    isAuthenticated: jest.fn(),
    getUser: jest.fn(),
    onAccessTokenUpdated: mockOnAccessTokenUpdated,
    removeAccessTokenUpdatedCallback: mockRemoveAccessTokenUpdatedCallback
  }
}));

const authModule = require('@/store/modules/auth').default;

function createMockOidcUser(overrides = {}) {
  return {
    access_token: 'mock-token',
    refresh_token: 'mock-refresh',
    token_type: 'Bearer',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expired: false,
    profile: {
      sub: 'user-123',
      iss: 'http://localhost:8080/realms/genie',
      email: 'test@example.com',
      name: 'Test User',
      preferred_username: 'testuser',
      realm_access: { roles: ['user', 'admin'] },
      aud: 'genie-app',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000)
    },
    ...overrides
  };
}

function createState() {
  return {
    isAuthenticated: false,
    user: null,
    accessToken: null,
    error: null,
    isInitialized: false
  };
}

function createCommit(state) {
  return (mutation, payload) => {
    if (authModule.mutations[mutation]) {
      authModule.mutations[mutation](state, payload);
    }
  };
}

describe('Vuex Auth Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clean up post_logout flag set by logout tests
    sessionStorage.removeItem('genie_post_logout');
    // Clean up legacy localStorage items set by logout tests
    localStorage.removeItem('user');
    localStorage.removeItem('auth_token');
  });

  describe('getters', () => {
    it('isAuthenticated returns state.isAuthenticated', () => {
      const state = createState();
      expect(authModule.getters.isAuthenticated(state)).toBe(false);
      state.isAuthenticated = true;
      expect(authModule.getters.isAuthenticated(state)).toBe(true);
    });

    it('currentUser returns state.user', () => {
      const state = createState();
      expect(authModule.getters.currentUser(state)).toBeNull();
      state.user = { name: 'Test' };
      expect(authModule.getters.currentUser(state)).toEqual({ name: 'Test' });
    });

    it('accessToken returns state.accessToken', () => {
      const state = createState();
      expect(authModule.getters.accessToken(state)).toBeNull();
      state.accessToken = 'my-token';
      expect(authModule.getters.accessToken(state)).toBe('my-token');
    });

    it('authError returns state.error message when error is string', () => {
      const state = createState();
      expect(authModule.getters.authError(state)).toBeNull();
      state.error = 'Error msg';
      expect(authModule.getters.authError(state)).toBe('Error msg');
    });

    it('authError returns message string when error is object { code, message }', () => {
      const state = createState();
      state.error = { code: 'TOKEN_EXPIRED', message: 'Session expired' };
      expect(authModule.getters.authError(state)).toBe('Session expired');
    });

    it('authError handles mixed error state (object and null)', () => {
      const state = createState();
      state.error = { code: 'FORBIDDEN', message: 'Access denied' };
      expect(authModule.getters.authError(state)).toBe('Access denied');
      state.error = null;
      expect(authModule.getters.authError(state)).toBeNull();
    });

    it('isAuthInitialized returns state.isInitialized', () => {
      const state = createState();
      expect(authModule.getters.isAuthInitialized(state)).toBe(false);
      state.isInitialized = true;
      expect(authModule.getters.isAuthInitialized(state)).toBe(true);
    });

    it('lastAuthErrorCode returns error code when error is object', () => {
      const state = createState();
      expect(authModule.getters.lastAuthErrorCode(state)).toBeNull();
      state.error = { code: 'TOKEN_EXPIRED', message: 'Session expired' };
      expect(authModule.getters.lastAuthErrorCode(state)).toBe('TOKEN_EXPIRED');
    });

    it('lastAuthErrorCode returns null when error is string', () => {
      const state = createState();
      state.error = 'String error message';
      expect(authModule.getters.lastAuthErrorCode(state)).toBeNull();
    });

    it('lastAuthErrorCode returns null when error is null', () => {
      const state = createState();
      expect(authModule.getters.lastAuthErrorCode(state)).toBeNull();
    });
  });

  describe('mutations', () => {
    it('setAuth sets all auth fields', () => {
      const state = createState();
      authModule.mutations.setAuth(state, {
        isAuthenticated: true,
        user: { name: 'Test', roles: ['admin'] },
        accessToken: 'token-123'
      });
      expect(state.isAuthenticated).toBe(true);
      expect(state.user).toEqual({ name: 'Test', roles: ['admin'] });
      expect(state.accessToken).toBe('token-123');
      expect(state.error).toBeNull();
    });

    it('clearAuth resets all auth fields', () => {
      const state = createState();
      state.isAuthenticated = true;
      state.user = { name: 'Test' };
      state.accessToken = 'token';
      state.error = 'err';
      authModule.mutations.clearAuth(state);
      expect(state.isAuthenticated).toBe(false);
      expect(state.user).toBeNull();
      expect(state.accessToken).toBeNull();
      expect(state.error).toBeNull();
    });

    it('setError sets error message when string', () => {
      const state = createState();
      authModule.mutations.setError(state, 'Auth failed');
      expect(state.error).toBe('Auth failed');
    });

    it('setError sets structured error when object { code, message }', () => {
      const state = createState();
      authModule.mutations.setError(state, { code: 'TOKEN_EXPIRED', message: 'Session expired' });
      expect(state.error).toEqual({
        code: 'TOKEN_EXPIRED',
        message: 'Session expired'
      });
    });

    it('setError handles object with missing code gracefully', () => {
      const state = createState();
      authModule.mutations.setError(state, { message: 'Error without code' });
      expect(state.error).toEqual({
        code: 'UNKNOWN_ERROR',
        message: 'Error without code'
      });
    });

    it('setError handles object with missing message gracefully', () => {
      const state = createState();
      authModule.mutations.setError(state, { code: 'SOME_ERROR' });
      expect(state.error).toEqual({
        code: 'SOME_ERROR',
        message: 'An error occurred'
      });
    });

    it('setError handles null gracefully', () => {
      const state = createState();
      authModule.mutations.setError(state, null);
      expect(state.error).toBeNull();
    });

    it('clearError sets error to null', () => {
      const state = createState();
      state.error = 'err';
      authModule.mutations.clearError(state);
      expect(state.error).toBeNull();
    });

    it('setInitialized sets isInitialized to true', () => {
      const state = createState();
      authModule.mutations.setInitialized(state);
      expect(state.isInitialized).toBe(true);
    });

    it('updateAccessToken updates only accessToken', () => {
      const state = createState();
      state.isAuthenticated = true;
      state.user = { name: 'Test', iss_sub: 'iss#sub' };
      state.accessToken = 'old-token';
      authModule.mutations.updateAccessToken(state, { accessToken: 'new-token' });
      expect(state.accessToken).toBe('new-token');
      expect(state.isAuthenticated).toBe(true);
      expect(state.user).toEqual({ name: 'Test', iss_sub: 'iss#sub' });
    });
  });

  describe('actions', () => {
    describe('initialize', () => {
      it('sets auth state when existing user found', async () => {
        mockInitialize.mockResolvedValue(createMockOidcUser());
        const state = createState();
        const commit = createCommit(state);

        await authModule.actions.initialize({ commit });

        expect(state.isAuthenticated).toBe(true);
        expect(state.accessToken).toBe('mock-token');
        expect(state.isInitialized).toBe(true);
        expect(state.user.iss_sub).toBe('http://localhost:8080/realms/genie#user-123');
        expect(state.user.roles).toEqual(['user', 'admin']);
      });

      it('clears auth state when no user', async () => {
        mockInitialize.mockResolvedValue(null);
        const state = createState();
        const commit = createCommit(state);

        await authModule.actions.initialize({ commit });

        expect(state.isAuthenticated).toBe(false);
        expect(state.user).toBeNull();
        expect(state.isInitialized).toBe(true);
      });

      it('clears auth state when user is expired', async () => {
        mockInitialize.mockResolvedValue(createMockOidcUser({ expired: true }));
        const state = createState();
        const commit = createCommit(state);

        await authModule.actions.initialize({ commit });

        expect(state.isAuthenticated).toBe(false);
        expect(state.isInitialized).toBe(true);
      });

      it('sets error on initialization failure', async () => {
        mockInitialize.mockRejectedValue(new Error('Network error'));
        const state = createState();
        const commit = createCommit(state);

        await authModule.actions.initialize({ commit });

        expect(state.error).toEqual({
          code: 'INIT_ERROR',
          message: 'Authentication initialization failed'
        });
        expect(state.isInitialized).toBe(true);
      });

      it('registers onAccessTokenUpdated callback when user exists', async () => {
        mockInitialize.mockResolvedValue(createMockOidcUser());
        const state = createState();
        const commit = createCommit(state);

        await authModule.actions.initialize({ commit });

        expect(mockOnAccessTokenUpdated).toHaveBeenCalledTimes(1);
        expect(typeof mockOnAccessTokenUpdated.mock.calls[0][0]).toBe('function');
      });

      it('does NOT register callback when no user', async () => {
        mockInitialize.mockResolvedValue(null);
        const state = createState();
        const commit = createCommit(state);

        await authModule.actions.initialize({ commit });

        expect(mockOnAccessTokenUpdated).not.toHaveBeenCalled();
      });

      it('callback updates accessToken and user on silent renew', async () => {
        mockInitialize.mockResolvedValue(createMockOidcUser());
        const state = createState();
        const commit = createCommit(state);

        await authModule.actions.initialize({ commit });

        // Simulate silent renew callback
        const refreshedUser = createMockOidcUser({
          access_token: 'refreshed-token',
          profile: { ...createMockOidcUser().profile, email: 'updated@example.com' }
        });
        const callback = mockOnAccessTokenUpdated.mock.calls[0][0];
        callback(refreshedUser);

        expect(state.accessToken).toBe('refreshed-token');
        expect(state.user.email).toBe('updated@example.com');
        expect(state.isAuthenticated).toBe(true);
      });

      it('blocks session restore when post_logout flag is set (L.3 fix)', async () => {
        sessionStorage.setItem('genie_post_logout', 'true');
        mockInitialize.mockResolvedValue(createMockOidcUser());
        const state = createState();
        const commit = createCommit(state);

        await authModule.actions.initialize({ commit });

        // initialize() is NOT called — early return when post_logout flag is set
        expect(mockInitialize).not.toHaveBeenCalled();
        // State should remain cleared
        expect(state.isAuthenticated).toBe(false);
        expect(state.user).toBeNull();
        expect(state.isInitialized).toBe(true);
        // Flag should NOT be consumed yet (consumed only on successful login/callback)
        expect(sessionStorage.getItem('genie_post_logout')).toBe('true');
      });

      it('handleCallback consumes post_logout flag on successful login (L.3 fix)', async () => {
        sessionStorage.setItem('genie_post_logout', 'true');
        const mockUser = createMockOidcUser();
        mockHandleCallback.mockResolvedValue(mockUser);
        const state = createState();
        const commit = createCommit(state);

        await authModule.actions.handleCallback({ commit });

        // Should be authenticated (flag consumed by handleCallback)
        expect(state.isAuthenticated).toBe(true);
        expect(state.accessToken).toBe('mock-token');
        // Flag should be consumed
        expect(sessionStorage.getItem('genie_post_logout')).toBeNull();
      });

      it('cleans up existing callback before registering new one on re-initialize', async () => {
        mockInitialize.mockResolvedValue(createMockOidcUser());
        const state = createState();
        const commit = createCommit(state);

        // First initialize
        await authModule.actions.initialize({ commit });
        expect(mockOnAccessTokenUpdated).toHaveBeenCalledTimes(1);
        const firstCallback = mockOnAccessTokenUpdated.mock.calls[0][0];

        // Second initialize (simulates re-login after logout)
        await authModule.actions.initialize({ commit });

        // Should have removed the old callback before adding new one
        expect(mockRemoveAccessTokenUpdatedCallback).toHaveBeenCalledWith(firstCallback);
        expect(mockOnAccessTokenUpdated).toHaveBeenCalledTimes(2);
      });
    });

    describe('login', () => {
      it('calls keycloakAuthService.login with options', async () => {
        mockLogin.mockResolvedValue(undefined);
        const state = createState();
        const commit = createCommit(state);

        await authModule.actions.login({ commit }, { returnUrl: '/dashboard' });

        expect(mockLogin).toHaveBeenCalledWith({ returnUrl: '/dashboard' });
        expect(state.error).toBeNull();
      });

      it('sets error on login failure', async () => {
        mockLogin.mockRejectedValue(new Error('Redirect failed'));
        const state = createState();
        const commit = createCommit(state);

        await expect(
          authModule.actions.login({ commit })
        ).rejects.toThrow('Redirect failed');

        expect(state.error).toEqual({
          code: 'LOGIN_ERROR',
          message: 'Login redirect failed'
        });
      });

      it('clears post_logout flag on explicit login (L.3 fix)', async () => {
        sessionStorage.setItem('genie_post_logout', 'true');
        mockLogin.mockResolvedValue(undefined);
        const state = createState();
        const commit = createCommit(state);

        await authModule.actions.login({ commit });

        expect(sessionStorage.getItem('genie_post_logout')).toBeNull();
      });
    });

    describe('handleCallback', () => {
      it('sets auth state from callback user', async () => {
        const mockUser = createMockOidcUser();
        mockHandleCallback.mockResolvedValue(mockUser);
        const state = createState();
        const commit = createCommit(state);

        const result = await authModule.actions.handleCallback({ commit });

        expect(state.isAuthenticated).toBe(true);
        expect(state.accessToken).toBe('mock-token');
        expect(result).toEqual(mockUser);
      });

      it('registers onAccessTokenUpdated callback after successful callback', async () => {
        const mockUser = createMockOidcUser();
        mockHandleCallback.mockResolvedValue(mockUser);
        const state = createState();
        const commit = createCommit(state);

        await authModule.actions.handleCallback({ commit });

        expect(mockOnAccessTokenUpdated).toHaveBeenCalledTimes(1);
        expect(typeof mockOnAccessTokenUpdated.mock.calls[0][0]).toBe('function');
      });

      it('callback from handleCallback updates accessToken on silent renew', async () => {
        const mockUser = createMockOidcUser();
        mockHandleCallback.mockResolvedValue(mockUser);
        const state = createState();
        const commit = createCommit(state);

        await authModule.actions.handleCallback({ commit });

        const refreshedUser = createMockOidcUser({
          access_token: 'post-callback-refreshed-token',
          profile: { ...createMockOidcUser().profile, name: 'Updated Name' }
        });
        const callback = mockOnAccessTokenUpdated.mock.calls[0][0];
        callback(refreshedUser);

        expect(state.accessToken).toBe('post-callback-refreshed-token');
        expect(state.user.name).toBe('Updated Name');
        expect(state.isAuthenticated).toBe(true);
      });

      it('does NOT register callback when user profile is null', async () => {
        mockHandleCallback.mockResolvedValue({
          access_token: 'token',
          expired: false,
          profile: null
        });
        const state = createState();
        const commit = createCommit(state);

        await authModule.actions.handleCallback({ commit });

        expect(mockOnAccessTokenUpdated).not.toHaveBeenCalled();
      });

      it('sets error on callback failure', async () => {
        mockHandleCallback.mockRejectedValue(new Error('Callback failed'));
        const state = createState();
        const commit = createCommit(state);

        await expect(
          authModule.actions.handleCallback({ commit })
        ).rejects.toThrow('Callback failed');

        expect(state.error).toEqual({
          code: 'CALLBACK_ERROR',
          message: 'Authentication callback failed'
        });
      });
    });

    describe('logout', () => {
      it('clears auth state after logout', async () => {
        mockLogout.mockResolvedValue(undefined);
        const state = createState();
        state.isAuthenticated = true;
        state.user = { name: 'Test' };
        const commit = createCommit(state);

        await authModule.actions.logout({ commit });

        expect(mockLogout).toHaveBeenCalled();
        expect(state.isAuthenticated).toBe(false);
        expect(state.user).toBeNull();
        expect(state.accessToken).toBeNull();
      });

      it('clears auth state even if logout fails', async () => {
        mockLogout.mockRejectedValue(new Error('Logout failed'));
        const state = createState();
        state.isAuthenticated = true;
        const commit = createCommit(state);

        await authModule.actions.logout({ commit });

        expect(state.isAuthenticated).toBe(false);
        expect(state.user).toBeNull();
      });

      it('removes accessTokenUpdatedCallback on logout', async () => {
        mockInitialize.mockResolvedValue(createMockOidcUser());
        mockLogout.mockResolvedValue(undefined);
        const state = createState();
        const commit = createCommit(state);

        // Initialize first (registers callback)
        await authModule.actions.initialize({ commit });

        // Capture the registered callback before logout clears it
        const registeredCallback = mockOnAccessTokenUpdated.mock.calls[0][0];

        await authModule.actions.logout({ commit });

        expect(mockRemoveAccessTokenUpdatedCallback).toHaveBeenCalledWith(registeredCallback);
      });

      it('removes legacy localStorage items BEFORE Keycloak redirect (L.2 fix)', async () => {
        mockLogout.mockResolvedValue(undefined);
        const state = createState();
        state.isAuthenticated = true;
        const commit = createCommit(state);

        // Pre-populate legacy localStorage items
        localStorage.setItem('user', '{"email":"old@test.com"}');
        localStorage.setItem('auth_token', 'old-token');

        await authModule.actions.logout({ commit });

        // localStorage must be cleared BEFORE signoutRedirect navigates away
        expect(localStorage.getItem('user')).toBeNull();
        expect(localStorage.getItem('auth_token')).toBeNull();
      });

      it('sets post_logout flag to prevent auto re-login (L.3 fix)', async () => {
        mockLogout.mockResolvedValue(undefined);
        const state = createState();
        const commit = createCommit(state);

        await authModule.actions.logout({ commit });

        expect(sessionStorage.getItem('genie_post_logout')).toBe('true');
      });
    });

    describe('clearError', () => {
      it('clears error state', async () => {
        const state = createState();
        state.error = 'Some error';
        const commit = createCommit(state);

        await authModule.actions.clearError({ commit });

        expect(state.error).toBeNull();
      });
    });

    describe('handleApiError', () => {
      it('parses TOKEN_INVALID error and stores in state', () => {
        const state = createState();
        const commit = createCommit(state);
        const errorResponse = {
          error: 'TOKEN_INVALID',
          message: 'Invalid token signature',
          details: {}
        };

        const result = authModule.actions.handleApiError({ commit }, errorResponse);

        expect(state.error).toEqual({
          code: 'TOKEN_INVALID',
          message: 'Invalid token signature'
        });
        expect(result).toEqual({
          code: 'TOKEN_INVALID',
          message: 'Invalid token signature'
        });
      });

      it('parses TOKEN_EXPIRED error and stores in state', () => {
        const state = createState();
        const commit = createCommit(state);
        const errorResponse = {
          error: 'TOKEN_EXPIRED',
          message: 'Token has expired',
          details: {}
        };

        const result = authModule.actions.handleApiError({ commit }, errorResponse);

        expect(state.error).toEqual({
          code: 'TOKEN_EXPIRED',
          message: 'Token has expired'
        });
        expect(result.code).toBe('TOKEN_EXPIRED');
      });

      it('parses FORBIDDEN error and stores in state', () => {
        const state = createState();
        const commit = createCommit(state);
        const errorResponse = {
          error: 'FORBIDDEN',
          message: 'Access denied',
          details: {}
        };

        const result = authModule.actions.handleApiError({ commit }, errorResponse);

        expect(state.error).toEqual({
          code: 'FORBIDDEN',
          message: 'Access denied'
        });
        expect(result.code).toBe('FORBIDDEN');
      });

      it('parses INSUFFICIENT_ROLES error and stores in state', () => {
        const state = createState();
        const commit = createCommit(state);
        const errorResponse = {
          error: 'INSUFFICIENT_ROLES',
          message: 'You lack required permissions',
          details: {}
        };

        const result = authModule.actions.handleApiError({ commit }, errorResponse);

        expect(state.error).toEqual({
          code: 'INSUFFICIENT_ROLES',
          message: 'You lack required permissions'
        });
        expect(result.code).toBe('INSUFFICIENT_ROLES');
      });

      it('parses AUTH_SERVICE_UNAVAILABLE error and stores in state', () => {
        const state = createState();
        const commit = createCommit(state);
        const errorResponse = {
          error: 'AUTH_SERVICE_UNAVAILABLE',
          message: 'Auth service temporarily unavailable',
          details: {}
        };

        const result = authModule.actions.handleApiError({ commit }, errorResponse);

        expect(state.error).toEqual({
          code: 'AUTH_SERVICE_UNAVAILABLE',
          message: 'Auth service temporarily unavailable'
        });
        expect(result.code).toBe('AUTH_SERVICE_UNAVAILABLE');
      });

      it('parses PROVISIONING_FAILED error and stores in state', () => {
        const state = createState();
        const commit = createCommit(state);
        const errorResponse = {
          error: 'PROVISIONING_FAILED',
          message: 'User provisioning failed',
          details: {}
        };

        const result = authModule.actions.handleApiError({ commit }, errorResponse);

        expect(state.error).toEqual({
          code: 'PROVISIONING_FAILED',
          message: 'User provisioning failed'
        });
        expect(result.code).toBe('PROVISIONING_FAILED');
      });

      it('handles malformed error response gracefully', () => {
        const state = createState();
        const commit = createCommit(state);
        const errorResponse = {
          foo: 'bar'
        };

        const result = authModule.actions.handleApiError({ commit }, errorResponse);

        expect(state.error).toEqual({
          code: 'UNKNOWN_ERROR',
          message: 'An error occurred'
        });
        expect(result.code).toBe('UNKNOWN_ERROR');
      });

      it('handles null error response gracefully', () => {
        const state = createState();
        const commit = createCommit(state);

        const result = authModule.actions.handleApiError({ commit }, null);

        expect(state.error).toEqual({
          code: 'UNKNOWN_ERROR',
          message: 'An error occurred'
        });
        expect(result.code).toBe('UNKNOWN_ERROR');
      });

      it('NEVER includes details field in stored error', () => {
        const state = createState();
        const commit = createCommit(state);
        const errorResponse = {
          error: 'TOKEN_INVALID',
          message: 'Invalid token',
          details: { sensitive: 'data' }
        };

        authModule.actions.handleApiError({ commit }, errorResponse);

        expect(state.error).not.toHaveProperty('details');
        expect(state.error.details).toBeUndefined();
      });
    });
  });

  describe('user mapping', () => {
    it('derives iss_sub composite key from OIDC profile', async () => {
      mockInitialize.mockResolvedValue(createMockOidcUser());
      const state = createState();
      const commit = createCommit(state);

      await authModule.actions.initialize({ commit });

      expect(state.user.iss_sub).toBe('http://localhost:8080/realms/genie#user-123');
    });

    it('extracts roles from realm_access', async () => {
      mockInitialize.mockResolvedValue(createMockOidcUser());
      const state = createState();
      const commit = createCommit(state);

      await authModule.actions.initialize({ commit });

      expect(state.user.roles).toEqual(['user', 'admin']);
    });

    it('defaults roles to empty array when realm_access missing', async () => {
      mockGetAccessTokenClaims.mockImplementationOnce(() => null);
      mockInitialize.mockResolvedValue(createMockOidcUser({
        profile: {
          sub: 'user-456',
          iss: 'http://localhost:8080/realms/genie',
          email: 'no-roles@example.com',
          name: 'No Roles User'
        }
      }));
      const state = createState();
      const commit = createCommit(state);

      await authModule.actions.initialize({ commit });

      expect(state.user.roles).toEqual([]);
    });

    it('falls back to preferred_username when name is missing', async () => {
      mockInitialize.mockResolvedValue(createMockOidcUser({
        profile: {
          sub: 'user-789',
          iss: 'http://localhost:8080/realms/genie',
          email: 'no-name@example.com',
          preferred_username: 'nonameuser',
          realm_access: { roles: [] }
        }
      }));
      const state = createState();
      const commit = createCommit(state);

      await authModule.actions.initialize({ commit });

      expect(state.user.name).toBe('nonameuser');
    });

    it('handles null user profile gracefully', async () => {
      mockInitialize.mockResolvedValue({
        access_token: 'token',
        expired: false,
        profile: null
      });
      const state = createState();
      const commit = createCommit(state);

      await authModule.actions.initialize({ commit });

      expect(state.isAuthenticated).toBe(false);
    });
  });
});
