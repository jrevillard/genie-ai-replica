'use strict';

// Mock keycloakAuthService — define mocks inside the factory to avoid hoisting issues
jest.mock('@/services/keycloakAuthService', () => ({
  __esModule: true,
  default: {
    initialize: jest.fn(),
    logout: jest.fn(),
    getAccessTokenClaims: jest.fn(() => ({ realm_access: { roles: ['user'] } })),
    onAccessTokenUpdated: jest.fn(),
    removeAccessTokenUpdatedCallback: jest.fn()
  }
}));

const authStore = require('@/store/modules/auth').default;
const keycloakAuthServiceMock = require('@/services/keycloakAuthService').default;

function createAuthenticatedState() {
  return {
    isAuthenticated: true,
    user: {
      iss_sub: 'http://localhost:8080/realms/genie#user-123',
      sub: 'user-123',
      iss: 'http://localhost:8080/realms/genie',
      email: 'test@example.com',
      name: 'Test User',
      preferred_username: 'testuser',
      roles: ['user']
    },
    accessToken: 'access-token-abc',
    error: null,
    isInitialized: true
  };
}

describe('Vuex auth module', () => {
  let state;
  let commit;

  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.removeItem('genie_post_logout');
    state = createAuthenticatedState();
    commit = jest.fn();
  });

  describe('logout action', () => {
    /**
     * Helper: run initialize() to register the silentRenewCallback.
     * After this, the module-level silentRenewCallback variable is set.
     */
    async function initWithActiveSession() {
      keycloakAuthServiceMock.initialize.mockResolvedValue({
        expired: false,
        access_token: 'token',
        profile: {
          sub: 'user-123',
          iss: 'http://localhost:8080/realms/genie',
          email: 'test@example.com',
          name: 'Test User',
          preferred_username: 'testuser',
          realm_access: { roles: ['user'] }
        }
      });
      await authStore.actions.initialize({ commit, state });
      // Reset call counts but keep the silentRenewCallback registered
      jest.clearAllMocks();
    }

    it('should dispatch keycloakAuthService.logout() and commit clearAuth', async () => {
      keycloakAuthServiceMock.logout.mockResolvedValue(undefined);

      await authStore.actions.logout({ commit, state });

      expect(keycloakAuthServiceMock.logout).toHaveBeenCalledTimes(1);
      expect(commit).toHaveBeenCalledWith('clearError');
      expect(commit).toHaveBeenCalledWith('clearAuth');
    });

    it('should clear auth state even when service throws', async () => {
      keycloakAuthServiceMock.logout.mockRejectedValue(new Error('Network failure'));

      await authStore.actions.logout({ commit, state });

      const clearAuthCalls = commit.mock.calls.filter((call) => call[0] === 'clearAuth');
      expect(clearAuthCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('should remove silent renew callback in finally block', async () => {
      await initWithActiveSession();
      keycloakAuthServiceMock.logout.mockResolvedValue(undefined);

      await authStore.actions.logout({ commit, state });

      expect(keycloakAuthServiceMock.removeAccessTokenUpdatedCallback).toHaveBeenCalledTimes(1);
      expect(typeof keycloakAuthServiceMock.removeAccessTokenUpdatedCallback.mock.calls[0][0]).toBe('function');
    });

    it('should remove silent renew callback even when logout throws', async () => {
      await initWithActiveSession();
      keycloakAuthServiceMock.logout.mockRejectedValue(new Error('Fail'));

      await authStore.actions.logout({ commit, state });

      expect(keycloakAuthServiceMock.removeAccessTokenUpdatedCallback).toHaveBeenCalledTimes(1);
    });

    it('should clear legacy localStorage user and auth_token', async () => {
      localStorage.setItem('user', JSON.stringify({ name: 'old' }));
      localStorage.setItem('auth_token', 'old-token');
      keycloakAuthServiceMock.logout.mockResolvedValue(undefined);

      await authStore.actions.logout({ commit, state });

      expect(localStorage.getItem('user')).toBeNull();
      expect(localStorage.getItem('auth_token')).toBeNull();
    });

    it('should clear legacy localStorage even when logout throws', async () => {
      localStorage.setItem('user', JSON.stringify({ name: 'old' }));
      localStorage.setItem('auth_token', 'old-token');
      keycloakAuthServiceMock.logout.mockRejectedValue(new Error('Fail'));

      await authStore.actions.logout({ commit, state });

      expect(localStorage.getItem('user')).toBeNull();
      expect(localStorage.getItem('auth_token')).toBeNull();
    });

    it('should NOT clear preference items', async () => {
      localStorage.setItem('sidebarOpen', 'true');
      localStorage.setItem('theme', 'dark');
      localStorage.setItem('userLocale', 'fr');
      localStorage.setItem('fontSize', '16');
      keycloakAuthServiceMock.logout.mockResolvedValue(undefined);

      await authStore.actions.logout({ commit, state });

      expect(localStorage.getItem('sidebarOpen')).toBe('true');
      expect(localStorage.getItem('theme')).toBe('dark');
      expect(localStorage.getItem('userLocale')).toBe('fr');
      expect(localStorage.getItem('fontSize')).toBe('16');
    });
  });

  describe('clearAuth mutation', () => {
    it('should reset all auth state fields', () => {
      const authState = createAuthenticatedState();
      authState.error = { code: 'TEST', message: 'test error' };

      authStore.mutations.clearAuth(authState);

      expect(authState.isAuthenticated).toBe(false);
      expect(authState.user).toBeNull();
      expect(authState.accessToken).toBeNull();
      expect(authState.error).toBeNull();
    });
  });
});
