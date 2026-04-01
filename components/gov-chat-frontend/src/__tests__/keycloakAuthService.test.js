'use strict';

// Mock oidc-client-ts before requiring the service
const mockGetUser = jest.fn();
const mockSigninRedirect = jest.fn();
const mockSigninRedirectCallback = jest.fn();
const mockSignoutRedirect = jest.fn();
const MockUserManager = jest.fn().mockImplementation(() => ({
  getUser: mockGetUser,
  signinRedirect: mockSigninRedirect,
  signinRedirectCallback: mockSigninRedirectCallback,
  signoutRedirect: mockSignoutRedirect
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
    it('should call signoutRedirect', async () => {
      mockGetUser.mockResolvedValue(createMockUser());
      await keycloakAuthService.initialize();

      await keycloakAuthService.logout();

      expect(mockSignoutRedirect).toHaveBeenCalled();
    });

    it('should clear user even if signoutRedirect fails', async () => {
      mockGetUser.mockResolvedValue(createMockUser());
      await keycloakAuthService.initialize();
      mockSignoutRedirect.mockRejectedValue(new Error('Network error'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await keycloakAuthService.logout();

      expect(keycloakAuthService.isAuthenticated()).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(
        '[KeycloakAuth] Error during logout redirect:',
        'Network error'
      );

      consoleSpy.mockRestore();
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
});
