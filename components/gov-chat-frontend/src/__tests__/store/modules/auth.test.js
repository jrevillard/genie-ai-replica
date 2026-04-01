'use strict';

// Mock keycloakAuthService before requiring the store module
const mockInitialize = jest.fn();
const mockLogin = jest.fn();
const mockHandleCallback = jest.fn();
const mockLogout = jest.fn();

jest.mock('@/services/keycloakAuthService', () => ({
  __esModule: true,
  default: {
    initialize: mockInitialize,
    login: mockLogin,
    handleCallback: mockHandleCallback,
    logout: mockLogout,
    getAccessToken: jest.fn(),
    isAuthenticated: jest.fn(),
    getUser: jest.fn()
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

    it('authError returns state.error', () => {
      const state = createState();
      expect(authModule.getters.authError(state)).toBeNull();
      state.error = 'Error msg';
      expect(authModule.getters.authError(state)).toBe('Error msg');
    });

    it('isAuthInitialized returns state.isInitialized', () => {
      const state = createState();
      expect(authModule.getters.isAuthInitialized(state)).toBe(false);
      state.isInitialized = true;
      expect(authModule.getters.isAuthInitialized(state)).toBe(true);
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

    it('setError sets error message', () => {
      const state = createState();
      authModule.mutations.setError(state, 'Auth failed');
      expect(state.error).toBe('Auth failed');
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

        expect(state.error).toBe('Authentication initialization failed');
        expect(state.isInitialized).toBe(true);
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

        expect(state.error).toBe('Login redirect failed');
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

      it('sets error on callback failure', async () => {
        mockHandleCallback.mockRejectedValue(new Error('Callback failed'));
        const state = createState();
        const commit = createCommit(state);

        await expect(
          authModule.actions.handleCallback({ commit })
        ).rejects.toThrow('Callback failed');

        expect(state.error).toBe('Authentication callback failed');
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
