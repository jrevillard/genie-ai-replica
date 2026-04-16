'use strict';

// Mock oidc-client-ts before requiring the service
const mockGetUser = jest.fn();
const mockSigninRedirect = jest.fn();
const mockSigninRedirectCallback = jest.fn();
const mockSignoutRedirect = jest.fn();
const mockRemoveUser = jest.fn();
const mockClearStaleState = jest.fn();
const mockSigninSilent = jest.fn();
const mockAddUserLoaded = jest.fn(() => jest.fn());
const mockAddSilentRenewError = jest.fn(() => jest.fn());
const MockUserManager = jest.fn().mockImplementation(() => ({
  getUser: mockGetUser,
  signinRedirect: mockSigninRedirect,
  signinRedirectCallback: mockSigninRedirectCallback,
  signoutRedirect: mockSignoutRedirect,
  removeUser: mockRemoveUser,
  clearStaleState: mockClearStaleState,
  signinSilent: mockSigninSilent,
  events: {
    addUserLoaded: mockAddUserLoaded,
    addSilentRenewError: mockAddSilentRenewError
  }
}));

jest.mock('oidc-client-ts', () => ({
  UserManager: MockUserManager
}));

// Mock oidcConfig to avoid window.APP_CONFIG dependency
jest.mock('@/config/oidcConfig', () => ({
  authority: 'http://localhost:8080/realms/genie',
  clientId: 'genie-app',
  redirectUri: 'http://localhost/callback',
  postLogoutRedirectUri: 'http://localhost',
  responseType: 'code',
  scope: 'openid profile email',
  automaticSilentRenew: true,
  storeAuthStateInCookie: false
}));

const keycloakAuthService = require('@/services/keycloakAuthService').default;

function createMockUser(overrides = {}) {
  return {
    access_token: 'mock-access-token-123',
    refresh_token: 'mock-refresh-token-456',
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

describe('keycloakAuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('initialize', () => {
    it('should create UserManager and return existing user', async () => {
      const mockUser = createMockUser();
      mockGetUser.mockResolvedValue(mockUser);

      const result = await keycloakAuthService.initialize();

      expect(MockUserManager).toHaveBeenCalledTimes(1);
      expect(MockUserManager).toHaveBeenCalledWith(
        expect.objectContaining({
          authority: 'http://localhost:8080/realms/genie',
          clientId: 'genie-app'
        })
      );
      expect(result).toEqual(mockUser);
    });

    it('should return null when no existing session', async () => {
      mockGetUser.mockResolvedValue(null);

      const result = await keycloakAuthService.initialize();

      expect(result).toBeNull();
    });

    it('should return null and not throw on initialization error', async () => {
      mockGetUser.mockRejectedValue(new Error('Network error'));

      const result = await keycloakAuthService.initialize();

      expect(result).toBeNull();
    });

    it('should register addUserLoaded event listener', async () => {
      mockGetUser.mockResolvedValue(createMockUser());

      await keycloakAuthService.initialize();

      expect(mockAddUserLoaded).toHaveBeenCalledTimes(1);
      expect(typeof mockAddUserLoaded.mock.calls[0][0]).toBe('function');
    });

    it('should register addSilentRenewError event listener', async () => {
      mockGetUser.mockResolvedValue(createMockUser());

      await keycloakAuthService.initialize();

      expect(mockAddSilentRenewError).toHaveBeenCalledTimes(1);
      expect(typeof mockAddSilentRenewError.mock.calls[0][0]).toBe('function');
    });
  });

  describe('login', () => {
    it('should call signinRedirect without options', async () => {
      mockGetUser.mockResolvedValue(null);
      await keycloakAuthService.initialize();

      await keycloakAuthService.login();

      expect(mockSigninRedirect).toHaveBeenCalledWith({ state: undefined });
    });

    it('should pass returnUrl as state when provided', async () => {
      mockGetUser.mockResolvedValue(null);
      await keycloakAuthService.initialize();

      await keycloakAuthService.login({ returnUrl: '/dashboard' });

      expect(mockSigninRedirect).toHaveBeenCalledWith({
        state: { returnUrl: '/dashboard' }
      });
    });
  });

  describe('handleCallback', () => {
    it('should call signinRedirectCallback and return user', async () => {
      const mockUser = createMockUser();
      mockGetUser.mockResolvedValue(null);
      await keycloakAuthService.initialize();
      mockSigninRedirectCallback.mockResolvedValue(mockUser);

      const result = await keycloakAuthService.handleCallback();

      expect(mockSigninRedirectCallback).toHaveBeenCalled();
      expect(result).toEqual(mockUser);
    });

    it('should clear currentUser and rethrow on callback error', async () => {
      mockGetUser.mockResolvedValue(createMockUser());
      await keycloakAuthService.initialize();
      mockSigninRedirectCallback.mockRejectedValue(new Error('Invalid state'));

      await expect(keycloakAuthService.handleCallback()).rejects.toThrow('Invalid state');

      expect(keycloakAuthService.isAuthenticated()).toBe(false);
    });
  });

  describe('logout', () => {
    it('should call removeUser() before signoutRedirect()', async () => {
      mockGetUser.mockResolvedValue(createMockUser());
      mockRemoveUser.mockResolvedValue(undefined);
      mockClearStaleState.mockResolvedValue(undefined);
      mockSignoutRedirect.mockResolvedValue(undefined);
      await keycloakAuthService.initialize();

      await keycloakAuthService.logout();

      expect(mockRemoveUser).toHaveBeenCalledTimes(1);
      expect(mockSignoutRedirect).toHaveBeenCalledTimes(1);
      const removeUserCallTime = mockRemoveUser.mock.invocationCallOrder[0];
      const signoutRedirectCallTime = mockSignoutRedirect.mock.invocationCallOrder[0];
      expect(removeUserCallTime).toBeLessThan(signoutRedirectCallTime);
    });

    it('should call clearStaleState() on logout', async () => {
      mockGetUser.mockResolvedValue(createMockUser());
      mockRemoveUser.mockResolvedValue(undefined);
      mockClearStaleState.mockResolvedValue(undefined);
      mockSignoutRedirect.mockResolvedValue(undefined);
      await keycloakAuthService.initialize();

      await keycloakAuthService.logout();

      expect(mockClearStaleState).toHaveBeenCalledTimes(1);
    });

    it('should clear auth state even if removeUser() fails', async () => {
      mockGetUser.mockResolvedValue(createMockUser());
      mockRemoveUser.mockRejectedValue(new Error('removeUser failed'));
      mockClearStaleState.mockResolvedValue(undefined);
      mockSignoutRedirect.mockResolvedValue(undefined);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await keycloakAuthService.initialize();

      await keycloakAuthService.logout();

      expect(keycloakAuthService.isAuthenticated()).toBe(false);
      // signoutRedirect should still be attempted
      expect(mockSignoutRedirect).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should clear user even if signoutRedirect fails', async () => {
      mockGetUser.mockResolvedValue(createMockUser());
      mockRemoveUser.mockResolvedValue(undefined);
      mockClearStaleState.mockResolvedValue(undefined);
      mockSignoutRedirect.mockRejectedValue(new Error('Network error'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await keycloakAuthService.initialize();

      await keycloakAuthService.logout();

      expect(keycloakAuthService.isAuthenticated()).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(
        '[KeycloakAuth] Error during logout redirect:',
        'Network error'
      );

      consoleSpy.mockRestore();
    });

    it('should pass id_token_hint to signoutRedirect for proper Keycloak session termination (L.3 fix)', async () => {
      mockGetUser.mockResolvedValue(createMockUser({ id_token: 'my-id-token-abc' }));
      mockRemoveUser.mockResolvedValue(undefined);
      mockClearStaleState.mockResolvedValue(undefined);
      mockSignoutRedirect.mockResolvedValue(undefined);
      await keycloakAuthService.initialize();

      await keycloakAuthService.logout();

      expect(mockSignoutRedirect).toHaveBeenCalledWith({ id_token_hint: 'my-id-token-abc' });
    });

    it('should pass undefined id_token_hint when user has no id_token', async () => {
      mockGetUser.mockResolvedValue(createMockUser());
      mockRemoveUser.mockResolvedValue(undefined);
      mockClearStaleState.mockResolvedValue(undefined);
      mockSignoutRedirect.mockResolvedValue(undefined);
      await keycloakAuthService.initialize();

      await keycloakAuthService.logout();

      expect(mockSignoutRedirect).toHaveBeenCalledWith({ id_token_hint: undefined });
    });

    it('should remove event listeners on logout', async () => {
      mockGetUser.mockResolvedValue(createMockUser());
      mockRemoveUser.mockResolvedValue(undefined);
      mockClearStaleState.mockResolvedValue(undefined);
      mockSignoutRedirect.mockResolvedValue(undefined);
      await keycloakAuthService.initialize();

      const unsubUserLoaded = mockAddUserLoaded.mock.results[0].value;
      const unsubSilentRenewError = mockAddSilentRenewError.mock.results[0].value;

      await keycloakAuthService.logout();

      expect(unsubUserLoaded).toHaveBeenCalled();
      expect(unsubSilentRenewError).toHaveBeenCalled();
    });
  });

  describe('getUser', () => {
    it('should return current user from UserManager', async () => {
      const mockUser = createMockUser();
      mockGetUser.mockResolvedValue(mockUser);
      await keycloakAuthService.initialize();

      const result = await keycloakAuthService.getUser();

      expect(result).toEqual(mockUser);
    });
  });

  describe('getAccessToken', () => {
    it('should return access_token from current user', async () => {
      mockGetUser.mockResolvedValue(createMockUser());
      await keycloakAuthService.initialize();

      expect(keycloakAuthService.getAccessToken()).toBe('mock-access-token-123');
    });

    it('should return null when no user', async () => {
      mockGetUser.mockResolvedValue(null);
      await keycloakAuthService.initialize();

      expect(keycloakAuthService.getAccessToken()).toBeNull();
    });
  });

  describe('isAuthenticated', () => {
    it('should return true when user exists and not expired', async () => {
      mockGetUser.mockResolvedValue(createMockUser());
      await keycloakAuthService.initialize();

      expect(keycloakAuthService.isAuthenticated()).toBe(true);
    });

    it('should return false when no user', async () => {
      mockGetUser.mockResolvedValue(null);
      await keycloakAuthService.initialize();

      expect(keycloakAuthService.isAuthenticated()).toBe(false);
    });

    it('should return false when user is expired', async () => {
      mockGetUser.mockResolvedValue(createMockUser({ expired: true }));
      await keycloakAuthService.initialize();

      expect(keycloakAuthService.isAuthenticated()).toBe(false);
    });
  });

  describe('token storage', () => {
    it('should never store tokens in localStorage', async () => {
      const localStorageSpy = jest.spyOn(Storage.prototype, 'setItem');
      const sessionStorageSpy = jest.spyOn(Storage.prototype, 'setItem');

      mockGetUser.mockResolvedValue(createMockUser());
      await keycloakAuthService.initialize();

      // Verify no token was stored in localStorage
      const tokenCalls = localStorageSpy.mock.calls.filter(
        (call) => typeof call[1] === 'string' && call[1].includes('mock-access-token')
      );
      expect(tokenCalls).toHaveLength(0);

      const sessionCalls = sessionStorageSpy.mock.calls.filter(
        (call) => typeof call[1] === 'string' && call[1].includes('mock-access-token')
      );
      expect(sessionCalls).toHaveLength(0);

      localStorageSpy.mockRestore();
      sessionStorageSpy.mockRestore();
    });
  });

  describe('getUserManager', () => {
    it('should return a UserManager instance', async () => {
      mockGetUser.mockResolvedValue(null);
      await keycloakAuthService.initialize();

      const manager = keycloakAuthService.getUserManager();

      expect(manager).toBeDefined();
      expect(manager.getUser).toBeDefined();
    });
  });

  describe('silent renew events', () => {
    it('should update currentUser when addUserLoaded fires', async () => {
      mockGetUser.mockResolvedValue(createMockUser());
      await keycloakAuthService.initialize();

      const refreshedUser = createMockUser({ access_token: 'refreshed-token-789' });
      const addUserLoadedCb = mockAddUserLoaded.mock.calls[0][0];
      addUserLoadedCb(refreshedUser);

      expect(keycloakAuthService.getAccessToken()).toBe('refreshed-token-789');
    });

    it('should redirect to login when addSilentRenewError fires', async () => {
      mockGetUser.mockResolvedValue(createMockUser());
      await keycloakAuthService.initialize();
      mockSigninRedirect.mockResolvedValue(undefined);

      const addSilentRenewErrorCb = mockAddSilentRenewError.mock.calls[0][0];
      addSilentRenewErrorCb(new Error('Refresh token expired'));

      expect(mockSigninRedirect).toHaveBeenCalledWith({ state: undefined });
    });
  });

  describe('onAccessTokenUpdated', () => {
    it('should invoke registered callback when addUserLoaded fires', async () => {
      mockGetUser.mockResolvedValue(createMockUser());
      await keycloakAuthService.initialize();

      const callback = jest.fn();
      keycloakAuthService.onAccessTokenUpdated(callback);

      const refreshedUser = createMockUser({ access_token: 'new-token-999' });
      const addUserLoadedCb = mockAddUserLoaded.mock.calls[0][0];
      addUserLoadedCb(refreshedUser);

      expect(callback).toHaveBeenCalledWith(refreshedUser);
    });

    it('should invoke multiple registered callbacks', async () => {
      mockGetUser.mockResolvedValue(createMockUser());
      await keycloakAuthService.initialize();

      const callback1 = jest.fn();
      const callback2 = jest.fn();
      keycloakAuthService.onAccessTokenUpdated(callback1);
      keycloakAuthService.onAccessTokenUpdated(callback2);

      const refreshedUser = createMockUser({ access_token: 'new-token-999' });
      const addUserLoadedCb = mockAddUserLoaded.mock.calls[0][0];
      addUserLoadedCb(refreshedUser);

      expect(callback1).toHaveBeenCalledWith(refreshedUser);
      expect(callback2).toHaveBeenCalledWith(refreshedUser);
    });

    it('should remove callback via removeAccessTokenUpdatedCallback', async () => {
      mockGetUser.mockResolvedValue(createMockUser());
      await keycloakAuthService.initialize();

      const callback = jest.fn();
      keycloakAuthService.onAccessTokenUpdated(callback);
      keycloakAuthService.removeAccessTokenUpdatedCallback(callback);

      const refreshedUser = createMockUser({ access_token: 'new-token-999' });
      const addUserLoadedCb = mockAddUserLoaded.mock.calls[0][0];
      addUserLoadedCb(refreshedUser);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('signinSilent', () => {
    it('should call UserManager.signinSilent and return refreshed user', async () => {
      mockGetUser.mockResolvedValue(createMockUser());
      await keycloakAuthService.initialize();

      const refreshedUser = createMockUser({ access_token: 'silent-token-456' });
      mockSigninSilent.mockResolvedValue(refreshedUser);

      const result = await keycloakAuthService.signinSilent();

      expect(mockSigninSilent).toHaveBeenCalled();
      expect(result).toEqual(refreshedUser);
      expect(keycloakAuthService.getAccessToken()).toBe('silent-token-456');
    });

    it('should return null when signinSilent fails', async () => {
      mockGetUser.mockResolvedValue(createMockUser());
      await keycloakAuthService.initialize();
      mockSigninSilent.mockResolvedValue(null);

      const result = await keycloakAuthService.signinSilent();

      expect(result).toBeNull();
    });

    it('should throw when signinSilent rejects', async () => {
      mockGetUser.mockResolvedValue(createMockUser());
      await keycloakAuthService.initialize();
      mockSigninSilent.mockRejectedValue(new Error('Silent renew failed'));

      await expect(keycloakAuthService.signinSilent()).rejects.toThrow('Silent renew failed');
    });
  });
});
