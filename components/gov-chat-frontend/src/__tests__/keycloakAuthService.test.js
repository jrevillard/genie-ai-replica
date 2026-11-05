'use strict';

// Mock oidc-client-ts before requiring the service
const mockGetUser = jest.fn();
const mockSigninRedirect = jest.fn();
const mockSigninRedirectCallback = jest.fn();
const mockSignoutRedirect = jest.fn();
const mockRemoveUser = jest.fn();
const mockClearStaleState = jest.fn();
const mockSigninSilent = jest.fn();
const mockStoreUser = jest.fn();
// The event handlers return an unsubscribe function; one factory, used both
// at declaration and when the isolation hook restores it.
const unsubscribeMock = () => jest.fn();
const mockAddUserLoaded = jest.fn(unsubscribeMock);
const mockAddSilentRenewError = jest.fn(unsubscribeMock);
// The REAL User class, evaluated ONCE: the isolation hook's
// jest.resetModules() re-runs the jest.mock factory before every test, and
// a requireActual inside the factory would re-evaluate the whole
// oidc-client-ts library each time. (The `mock` prefix is what lets a
// jest.mock factory reference a file-scope variable.)
const mockOidcUser = jest.requireActual('oidc-client-ts').User;
// A named factory, so the isolation hook can restore it after
// jest.resetAllMocks() strips every implementation.
const userManagerMock = () => ({
  getUser: mockGetUser,
  signinRedirect: mockSigninRedirect,
  signinRedirectCallback: mockSigninRedirectCallback,
  signoutRedirect: mockSignoutRedirect,
  removeUser: mockRemoveUser,
  clearStaleState: mockClearStaleState,
  signinSilent: mockSigninSilent,
  storeUser: mockStoreUser,
  events: {
    addUserLoaded: mockAddUserLoaded,
    addSilentRenewError: mockAddSilentRenewError
  }
});
const MockUserManager = jest.fn(userManagerMock);

jest.mock('oidc-client-ts', () => ({
  UserManager: MockUserManager,
  // The REAL User class: the adoption path rehydrates the published plain
  // object into a User so storeUser's toStorageString() works (round 23) —
  // mocking it away would hide exactly the bug the fix exists for.
  User: mockOidcUser
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

const { RENEW_LEASE_KEY, RENEW_USER_KEY } = require('@/services/keycloakAuthService');
// A FRESH service module per test — the isolation hook below re-requires it
// and assigns it before every test. `let`, and null until then: a module-
// scope initializer would be a discarded instance.
let keycloakAuthService = null;

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

// Isolation for every test in this file:
//  - a FRESH service module, so the module-scoped renewInFlight,
//    currentUser and accessTokenCallbacks start empty (a test that leaves a
//    renew pending would otherwise pin renewInFlight and hand the next test
//    its stale promise);
//  - the MOCK IMPLEMENTATIONS reset — jest.clearAllMocks() clears call
//    history but NOT implementations, so a test omitting its own mock setup
//    silently inherits the previous test's mockResolvedValue/mockRejectedValue
//    — and the UserManager mocks swallow those inherited rejections (logout
//    catches them), so the test stays GREEN while exercising the error path;
//  - the localStorage state wiped, because the cross-tab renew protocol
//    leaves its state there: the holder PUBLISHES the minted user under
//    RENEW_USER_KEY and the NEXT renew reads that publication FIRST (gate
//    `entry.at >= startedAt`, millisecond resolution), so a surviving
//    publication makes the next test's renew adopt the previous test's user
//    instead of running its own grant (#1518 flake, reproducible locally
//    too). The whole store is cleared, not just the two renew keys, so a
//    coordination key added later cannot leak either.
// jest.resetAllMocks() covers every mock, present and future — but it also
// strips the factory implementations the unsubscribe assertions depend on, so
// those are restored here. jest.restoreAllMocks() undoes a spy a failing test
// leaked: resetAllMocks neuters a leaked spy's call-through, so without it a
// leaked Storage.prototype.setItem spy silently stops PERSISTING the next
// test's writes — the lease a test believes it holds would not exist.
beforeEach(() => {
  jest.resetModules();
  keycloakAuthService = require('@/services/keycloakAuthService').default;
  jest.resetAllMocks();
  jest.restoreAllMocks();
  MockUserManager.mockImplementation(userManagerMock);
  mockAddUserLoaded.mockImplementation(unsubscribeMock);
  mockAddSilentRenewError.mockImplementation(unsubscribeMock);
  // getUser() returns a PROMISE in the real UserManager; a reset mock would
  // return undefined and break `await manager.getUser().catch(...)`. The
  // default is "no stored session" — a test that needs a session sets one.
  // It stays a RESOLVED null rather than a rejection: initialize() catches
  // a rejection and returns null either way, but the exported getUser() has
  // no try/catch, so a rejecting default would make that API reject while
  // production resolves.
  mockGetUser.mockResolvedValue(null);
  window.localStorage.clear();
});

describe('keycloakAuthService', () => {
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

    // Round 17, #80353: the handler must be BOUNDED. The old version retried
    // signinSilent on every silentRenewError with no cap — a persistently
    // failing grant (realm down, refresh_token_max_reuse=0 race) looped one
    // renew every few seconds forever with no login() escalation.
    it('silent renew errors are bounded: escalating only after the failure cap, and a success resets it', async () => {
      mockGetUser.mockResolvedValue(null); // no stored user → escalation calls login()
      mockSigninSilent.mockRejectedValue(new Error('grant refused'));

      await keycloakAuthService.initialize();
      const handler = mockAddSilentRenewError.mock.calls[0][0];

      // failures 1 and 2: back off, NO login redirect yet
      await handler();
      await handler();
      expect(mockSigninRedirect).not.toHaveBeenCalled();
      // failure 3 hits the cap: stored user is gone → login()
      await handler();
      expect(mockSigninRedirect).toHaveBeenCalledTimes(1);

      // a RECOVERED renew resets the counter — the next failure run starts over
      mockSigninSilent.mockResolvedValue(createMockUser());
      await handler();
      mockSigninSilent.mockRejectedValue(new Error('blip'));
      await handler();
      expect(mockSigninRedirect).toHaveBeenCalledTimes(1); // still just the one
    });

    it('a live stored user survives the escalation: cap reached, login NOT called (2026-10-11 rule)', async () => {
      const liveUser = createMockUser();
      mockGetUser.mockResolvedValue(liveUser); // unexpired cached session
      mockSigninSilent.mockRejectedValue(new Error('grant refused'));

      await keycloakAuthService.initialize();
      const handler = mockAddSilentRenewError.mock.calls[0][0];
      await handler();
      await handler();
      await handler(); // cap reached — but the session is alive
      expect(mockSigninRedirect).not.toHaveBeenCalled();
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
      expect(consoleSpy).toHaveBeenCalledWith('[KeycloakAuth] Error during logout redirect:', 'Network error');

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

    // A FAILED SILENT RENEW IS NOT A DEAD SESSION (David's 2026-10-11 logout).
    // The old contract redirected unconditionally, so one rejected refresh in a
    // burst of 280 threw the user to the login page mid-import. These pin the
    // new contract: retry once, and redirect ONLY when the stored session is
    // genuinely gone.
    it('does NOT redirect when the retry recovers the session', async () => {
      mockGetUser.mockResolvedValue(createMockUser());
      mockSigninSilent.mockResolvedValue(createMockUser({ access_token: 'renewed-token' }));
      await keycloakAuthService.initialize();
      mockSigninRedirect.mockResolvedValue(undefined);

      const cb = mockAddSilentRenewError.mock.calls[0][0];
      await cb(new Error('Session not active'));
      await new Promise((r) => setTimeout(r, 0));

      expect(mockSigninSilent).toHaveBeenCalled();
      expect(mockSigninRedirect).not.toHaveBeenCalled();
    });

    it('does NOT redirect when the retry fails but the stored user is still live', async () => {
      mockGetUser.mockResolvedValue(createMockUser()); // live, unexpired
      mockSigninSilent.mockRejectedValue(new Error('Session not active'));
      await keycloakAuthService.initialize();
      mockSigninRedirect.mockResolvedValue(undefined);

      const cb = mockAddSilentRenewError.mock.calls[0][0];
      await cb(new Error('Session not active'));
      await new Promise((r) => setTimeout(r, 0));

      expect(mockSigninRedirect).not.toHaveBeenCalled();
    });

    it('redirects only when the session really is gone (after the failure cap — round 17, #80353)', async () => {
      mockGetUser.mockResolvedValue(createMockUser({ expired: true }));
      mockSigninSilent.mockRejectedValue(new Error('Session not active'));
      await keycloakAuthService.initialize();
      mockSigninRedirect.mockResolvedValue(undefined);

      const cb = mockAddSilentRenewError.mock.calls[0][0];
      // two failures: backed off, no redirect yet
      await cb(new Error('Session not active'));
      await cb(new Error('Session not active'));
      expect(mockSigninRedirect).not.toHaveBeenCalled();
      // third failure reaches the cap — the stored user is expired → redirect
      await cb(new Error('Session not active'));
      await new Promise((r) => setTimeout(r, 0));

      expect(mockSigninRedirect).toHaveBeenCalledWith({ state: undefined });
    });
  });

  describe('onAccessTokenUpdated', () => {
    // The isolation hook hands each test a FRESH service module, so the
    // module-scoped accessTokenCallbacks set starts empty. Without that, a
    // callback registered by an EARLIER test still fires in this one — the
    // cross-test leak the hook exists to close, and one no other assertion
    // in this file would catch. Self-contained on purpose: it re-requires a
    // second instance inside the test, so it does not depend on the order
    // jest runs the tests in.
    it('does not invoke a callback registered by another module instance', async () => {
      mockGetUser.mockResolvedValue(createMockUser());
      await keycloakAuthService.initialize();

      let callsFromTheOtherInstance = 0;
      keycloakAuthService.onAccessTokenUpdated(() => {
        callsFromTheOtherInstance += 1;
      });

      // Simulate the NEXT test: a fresh module, its own manager, its own
      // (empty) callback registry.
      jest.resetModules();
      const nextTestService = require('@/services/keycloakAuthService').default;
      mockGetUser.mockResolvedValue(createMockUser());
      await nextTestService.initialize();
      const addUserLoadedCb = mockAddUserLoaded.mock.calls[mockAddUserLoaded.mock.calls.length - 1][0];
      addUserLoadedCb(createMockUser({ access_token: 'next-test-token' }));

      expect(callsFromTheOtherInstance).toBe(0);
    });

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

// ── CROSS-TAB RENEW LEASE (round 20, #80800) ─────────────────────────────────
// The module-scoped renewInFlight promise serialises renews within ONE tab;
// the localStorage lease extends that across tabs (the measured root cause:
// two tabs, refresh_token_max_reuse=0, 280 token POSTs in 59s → forced
// logout). These tests drive the lease protocol through window.localStorage
// the way a second tab would.
describe('cross-tab renew lease (#80800)', () => {
  // Isolation (mock implementations + the renew keys) is the file-level
  // beforeEach above.

  async function initialized() {
    mockGetUser.mockResolvedValue(createMockUser());
    await keycloakAuthService.initialize();
  }

  // Round 21 (#80879): the round-20 version of this test drove the adopt
  // path with mockGetUser handing back the HOLDER's user — but production
  // getUser() reads THIS tab's per-tab oidc store, so the mock supplied the
  // cross-tab part the code did not actually have. The honest drive is the
  // PUBLICATION the holder writes (#80876): user BEFORE the done marker,
  // and this tab's own getUser keeps returning its STALE user throughout —
  // it must never be the answer.
  it('waits while another tab holds the lease, then adopts the PUBLISHED tokens (#80876)', async () => {
    jest.useFakeTimers();
    try {
      await initialized();
      // This tab's OWN store: still the PRE-renew user (unexpired, but its
      // refresh token was already rotated away by the holder).
      mockGetUser.mockResolvedValue(createMockUser({ access_token: 'this-tab-stale-token' }));
      // Another tab's FRESH lease:
      window.localStorage.setItem(RENEW_LEASE_KEY, JSON.stringify({ tab: 'other-tab', at: Date.now() }));
      // The holder renews during our wait and PUBLISHES its minted user —
      // a done MARKER alone carries no token.
      const published = createMockUser({ access_token: 'holder-published-token' });
      setTimeout(() => {
        window.localStorage.setItem(
          RENEW_USER_KEY,
          JSON.stringify({ at: Date.now(), tab: 'other-tab', user: published })
        );
        window.localStorage.removeItem(RENEW_LEASE_KEY);
      }, 300);
      const p = keycloakAuthService.signinSilent();
      const assertion = expect(p).resolves.toMatchObject({ access_token: 'holder-published-token' });
      await jest.advanceTimersByTimeAsync(600);
      await assertion;
      // The adopted user is the holder's PUBLISHED one, and this tab never
      // issued its own renew.
      expect(mockSigninSilent).not.toHaveBeenCalled();
      expect(keycloakAuthService.getAccessToken()).toBe('holder-published-token');
      // The waiter SEEDED its per-tab oidc store with the fresh tokens.
      expect(mockStoreUser).toHaveBeenCalledWith(expect.objectContaining({ access_token: 'holder-published-token' }));
    } finally {
      jest.useRealTimers();
    }
  });

  it('runs its own renew when the foreign lease is STALE (dead holder)', async () => {
    jest.useFakeTimers();
    try {
      await initialized();
      // A lease from a tab that died 30s ago (older than the 20s TTL):
      window.localStorage.setItem(RENEW_LEASE_KEY, JSON.stringify({ tab: 'dead-tab', at: Date.now() - 30000 }));
      const refreshed = createMockUser({ access_token: 'own-renew-token' });
      mockSigninSilent.mockResolvedValue(refreshed);
      const p = keycloakAuthService.signinSilent();
      const assertion = expect(p).resolves.toMatchObject({ access_token: 'own-renew-token' });
      await jest.advanceTimersByTimeAsync(3000);
      await assertion;
      expect(mockSigninSilent).toHaveBeenCalledTimes(1); // took over, ran once
      // and the lease is released afterwards
      expect(window.localStorage.getItem(RENEW_LEASE_KEY)).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('releases the lease even when the renew rejects', async () => {
    await initialized();
    mockSigninSilent.mockRejectedValue(new Error('renew blew up'));
    await expect(keycloakAuthService.signinSilent()).rejects.toThrow('renew blew up');
    expect(window.localStorage.getItem(RENEW_LEASE_KEY)).toBeNull();
  });

  // ── Round 21 (#80914): the three protocol guards (settle fence, identity
  // check, release ownership) each survive single-tab deletion — the suite
  // proved the SCENARIOS, not the CONTENTION. Two module isolates over ONE
  // shared localStorage ARE two tabs: each copy gets its own RENEW_TAB_ID,
  // and exactly ONE signinSilent may run across both.
  // ── Round 21c (#80941): automaticSilentRenew makes oidc-client-ts's OWN
  // SilentRenewService call userManager.signinSilent() DIRECTLY — the
  // timer-driven renew (the measured 280-POST incident) must ride the lease
  // like every other path. The instance method is wrapped in initialize().
  it('the TIMER-driven path is wrapped: the instance signinSilent rides the lease (#80941)', async () => {
    await initialized();
    const instance = MockUserManager.mock.results[MockUserManager.mock.results.length - 1].value;
    expect(instance.signinSilent).not.toBe(mockSigninSilent); // wrapped on the instance
    expect(typeof instance.__rawSigninSilent).toBe('function'); // the raw grant kept
    mockSigninSilent.mockResolvedValue(createMockUser({ access_token: 'timer-driven-token' }));
    const user = await instance.signinSilent(); // exactly what SilentRenewService calls
    expect(user.access_token).toBe('timer-driven-token');
    // Publication + clean release prove it went through the leased wrapper.
    const entry = JSON.parse(window.localStorage.getItem(RENEW_USER_KEY));
    expect(entry.user.access_token).toBe('timer-driven-token');
    expect(window.localStorage.getItem(RENEW_LEASE_KEY)).toBeNull();
  });

  it('a re-initialize wraps the NEW manager and releases the old subscriptions (#80941, round 23)', async () => {
    await initialized();
    const first = keycloakAuthService.getUserManager();
    expect(first.__signinWrapped).toBe(true);
    mockGetUser.mockResolvedValue(null);
    const registered = mockAddUserLoaded.mock.calls.length;
    await keycloakAuthService.initialize(); // re-initialize: NEW manager
    const second = keycloakAuthService.getUserManager();
    expect(second).not.toBe(first);
    expect(second.__signinWrapped).toBe(true);
    expect(second.signinSilent).not.toBe(mockSigninSilent);
    // The FIRST manager's event subscriptions were released before the new
    // ones registered (round 23: re-init used to orphan them).
    const firstBatchUnsubs = mockAddUserLoaded.mock.results.slice(0, registered).map((r) => r.value);
    expect(firstBatchUnsubs.length).toBeGreaterThan(0);
    firstBatchUnsubs.forEach((unsub) => expect(unsub).toHaveBeenCalled());
  });

  it('getAccessTokenClaims decodes the ACCESS TOKEN — roles come from it, not the profile (#80941, round 23)', async () => {
    // base64url, no padding — the shape every real Keycloak token has
    // (btoa's standard base64 + Latin-1 round-trips wrong, review 81337).
    const makeJwt = (payload) =>
      [
        Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url'),
        Buffer.from(JSON.stringify(payload)).toString('base64url'),
        'sig'
      ].join('.');

    mockGetUser.mockResolvedValue(null);
    await keycloakAuthService.initialize();
    expect(keycloakAuthService.getAccessTokenClaims()).toBeNull(); // no-token arm

    // The token's sub deliberately DIFFERS from the fixture profile's sub
    // ('user-123'): a mutant reading currentUser.profile instead of
    // decoding the token (the pre-ff8492c5d bug class) cannot pass.
    mockGetUser.mockResolvedValue(
      createMockUser({
        access_token: makeJwt({
          sub: 'token-sub-456',
          realm_access: { roles: ['token-role-only'] }
        })
      })
    );
    await keycloakAuthService.initialize();
    const claims = keycloakAuthService.getAccessTokenClaims();
    expect(claims.sub).toBe('token-sub-456'); // decoded, not the profile's
    expect(claims.realm_access.roles).toEqual(['token-role-only']); // the contract (auth store reads this)

    mockGetUser.mockResolvedValue(createMockUser({ access_token: 'not-a-jwt' }));
    await keycloakAuthService.initialize();
    expect(keycloakAuthService.getAccessTokenClaims()).toBeNull(); // decode-throw catch arm
  });

  it('publication retention: the TTL cleanup drops a stale publication at renew entry, keeps a fresh one (round 23)', async () => {
    mockGetUser.mockResolvedValue(null);
    mockSigninSilent.mockResolvedValue(createMockUser({ access_token: 'renewed-ok' }));
    const removeItem = jest.spyOn(Storage.prototype, 'removeItem');
    try {
      // Stale (past the 20s TTL): inadmissible to every reader — dropped at
      // the renew entry, before the renew itself can overwrite it.
      const stale = createMockUser({ access_token: 'stale-pub' });
      window.localStorage.setItem(RENEW_USER_KEY, JSON.stringify({ at: Date.now() - 30000, user: stale }));
      await keycloakAuthService.signinSilent();
      expect(removeItem).toHaveBeenCalledWith(RENEW_USER_KEY);
      // Fresh: the entry-level cleanup must NOT touch it (concurrent waiters
      // may still adopt it). This tab's own renew may overwrite the entry as
      // the holder — the contract under test is only that the CLEANUP did
      // not remove a fresh publication.
      removeItem.mockClear();
      const fresh = createMockUser({ access_token: 'fresh-pub' });
      window.localStorage.setItem(RENEW_USER_KEY, JSON.stringify({ at: Date.now(), user: fresh }));
      mockSigninSilent.mockResolvedValue(createMockUser({ access_token: 'renewed-again' }));
      await keycloakAuthService.signinSilent();
      expect(removeItem).not.toHaveBeenCalledWith(RENEW_USER_KEY);
      expect(window.localStorage.getItem(RENEW_USER_KEY)).not.toBeNull();
    } finally {
      removeItem.mockRestore();
    }
  });

  // ── #1521: the adoption gate gains an owner identity. A publication from
  // ANOTHER tab is adoptable regardless of startedAt (the waiter may start
  // after the holder finished); THIS tab's own stale publication is not —
  // a repeat renew in one tab must run its own grant, not adopt its own
  // previous publication instead of actually refreshing.

  it("does NOT adopt THIS tab's own stale publication — a repeat renew runs its own grant (#1521)", async () => {
    delete navigator.locks;
    mockGetUser.mockResolvedValue(null);
    // First renew: our own grant, published under OUR tab id.
    mockSigninSilent.mockResolvedValueOnce(createMockUser({ access_token: 'grant-one' }));
    await keycloakAuthService.signinSilent();
    // Second renew: the fresh publication on disk is OURS and stamped before
    // this renew started — adopting it would skip the actual refresh.
    mockSigninSilent.mockResolvedValueOnce(createMockUser({ access_token: 'grant-two' }));
    const user = await keycloakAuthService.signinSilent();
    expect(user.access_token).toBe('grant-two'); // its OWN grant, not grant-one
    expect(mockSigninSilent).toHaveBeenCalledTimes(2);
  });

  it('treats an owner-less (old-build) publication as its own: stale stamp → own grant (#1521)', async () => {
    delete navigator.locks;
    // A publication written by an older build carries no tab id — the
    // conservative reading treats it as this tab's own, so a stale stamp is
    // inadmissible and this tab renews itself.
    const orphanUser = createMockUser({ access_token: 'orphan-published-token' });
    window.localStorage.setItem(USER_KEY, JSON.stringify({ at: Date.now() - 10, user: orphanUser }));
    mockGetUser.mockResolvedValue(null);
    mockSigninSilent.mockResolvedValue(createMockUser({ access_token: 'my-own-grant' }));
    const user = await keycloakAuthService.signinSilent();
    expect(user.access_token).toBe('my-own-grant');
    expect(mockSigninSilent).toHaveBeenCalledTimes(1);
  });

  it('LEASE path: a FREE lease with a publication from ANOTHER tab ADOPTS even when stamped BEFORE this renew started (#1521)', async () => {
    // The 81377 ordering fix landed on the Web-Locks path only; the lease
    // fallback acquired the FREE lease first, skipped the publication loop,
    // and burned a fresh grant on the rotated-away token. jsdom has no
    // navigator.locks, so signinSilent takes renewViaLease — exactly the
    // engine class the fallback exists for. Pre-#1521 this test goes red:
    // the startedAt gate rejects a publication stamped before this renew
    // began, the grant runs, and mockSigninSilent IS called.
    delete navigator.locks;
    const holderUser = createMockUser({ access_token: 'lease-holder-token' });
    // The REAL #1521 scenario: the holder finished 10 ms BEFORE this renew
    // started (a real publishRenewedUser stamps Date.now() — never the
    // future stamp the old tests seeded), so the publication's tab id makes
    // it adoptable regardless of startedAt.
    window.localStorage.setItem(
      RENEW_USER_KEY,
      JSON.stringify({ at: Date.now() - 10, tab: 'holder-tab', user: holderUser })
    );
    mockGetUser.mockResolvedValue(null);
    mockSigninSilent.mockResolvedValue(createMockUser({ access_token: 'my-own-fresh-grant' }));
    const user = await keycloakAuthService.signinSilent();
    expect(user.access_token).toBe('lease-holder-token'); // adopted
    expect(mockSigninSilent).not.toHaveBeenCalled(); // no grant burned
    expect(mockStoreUser).toHaveBeenCalled();
  });

  it('logout removes any publication from disk (round 23 retention)', async () => {
    await initialized();
    const fresh = createMockUser({ access_token: 'pub-at-logout' });
    window.localStorage.setItem(RENEW_USER_KEY, JSON.stringify({ at: Date.now(), user: fresh }));
    await keycloakAuthService.logout();
    expect(window.localStorage.getItem(RENEW_USER_KEY)).toBeNull();
  });

  it('getUserManager LAZILY wraps when no initialize ran (round 23, 81347: reachable post-logout)', async () => {
    // The lazy branch fires when userManager is still null — reachable in
    // production when the auth store's initialize SHORT-CIRCUITS on
    // genie_post_logout and a later caller needs the manager anyway.
    jest.isolateModules(() => {
      const fresh = require('@/services/keycloakAuthService').default;
      const manager = fresh.getUserManager(); // NO initialize first
      expect(manager.__signinWrapped).toBe(true);
      expect(manager.signinSilent).not.toBe(mockSigninSilent);
      expect(typeof manager.__rawSigninSilent).toBe('function');
    });
  });

  it('two tabs contending: exactly ONE renew runs, the other adopts (#80914)', async () => {
    jest.useFakeTimers();
    // Each isolate is a fresh service module — its own RENEW_TAB_ID, its own
    // renewInFlight — over the ONE shared jsdom localStorage. (The isolates
    // inherit this file's top-level oidc mock, so the shared backend mocks
    // are mockSigninSilent / mockStoreUser.)
    const loadCopy = () => {
      let svc;
      jest.isolateModules(() => {
        svc = require('@/services/keycloakAuthService').default;
      });
      return svc;
    };
    try {
      const tabA = loadCopy();
      const tabB = loadCopy();
      const fresh = createMockUser({ access_token: 'holder-token-2tab' });
      mockGetUser.mockResolvedValue(createMockUser());
      mockSigninSilent.mockResolvedValue(fresh);
      await tabA.initialize();
      await tabB.initialize();
      // Both tabs' renew timers fire together:
      const pa = tabA.signinSilent();
      const pb = tabB.signinSilent();
      // A wins the lease, settles, renews ONCE, publishes, releases; B waits,
      // reads the publication, adopts — never its own renew.
      await jest.advanceTimersByTimeAsync(1200);
      const [ra, rb] = await Promise.all([pa, pb]);
      expect(mockSigninSilent).toHaveBeenCalledTimes(1); // THE contention contract
      expect(ra && ra.access_token).toBe('holder-token-2tab');
      expect(rb && rb.access_token).toBe('holder-token-2tab'); // adopted the publication
      expect(mockStoreUser).toHaveBeenCalledWith(expect.objectContaining({ access_token: 'holder-token-2tab' }));
    } finally {
      jest.useRealTimers();
    }
  });

  // ── Round 21, #80864: the settle window fences the simultaneous-claim race
  // the round-20 read-back missed (jsdom has no Web Locks → lease path).
  it('settle window: a rival claim DURING the window makes this tab back off', async () => {
    jest.useFakeTimers();
    try {
      await initialized();
      const refreshed = createMockUser({ access_token: 'late-takeover-token' });
      mockSigninSilent.mockResolvedValue(refreshed);
      const p = keycloakAuthService.signinSilent();
      // A rival tab overwrites our claim 10ms into our 80ms settle window —
      // by the time our window closes we see ITS tab id and back off.
      setTimeout(() => {
        window.localStorage.setItem(RENEW_LEASE_KEY, JSON.stringify({ tab: 'rival-tab', at: Date.now() }));
      }, 10);
      await jest.advanceTimersByTimeAsync(50); // inside the settle window
      expect(mockSigninSilent).not.toHaveBeenCalled();
      // The rival never publishes; after the TTL this tab takes over the
      // stale lease and renews exactly once.
      await jest.advanceTimersByTimeAsync(21000);
      await expect(p).resolves.toMatchObject({ access_token: 'late-takeover-token' });
      expect(mockSigninSilent).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  // ── Round 21, #80864: Web Locks are the PRIMARY mechanism — the only
  // genuinely atomic cross-tab claim. jsdom lacks navigator.locks, so these
  // tests install a minimal fake with the semantics the code relies on:
  // ifAvailable:true + a busy lock resolves null WITHOUT invoking the
  // callback (never queues).
  describe('web locks (primary mechanism, #80864)', () => {
    afterEach(() => {
      try {
        delete navigator.locks;
      } catch {
        /* not defined — nothing to clean */
      }
    });

    it('granted lock: renews once and PUBLISHES the minted user', async () => {
      Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: { request: (name, opts, cb) => cb({ name, mode: 'exclusive' }) }
      });
      await initialized();
      const refreshed = createMockUser({ access_token: 'lock-holder-token' });
      mockSigninSilent.mockResolvedValue(refreshed);
      const user = await keycloakAuthService.signinSilent();
      expect(user.access_token).toBe('lock-holder-token');
      expect(mockSigninSilent).toHaveBeenCalledTimes(1);
      // The publication is what waiters adopt — and nothing else is written:
      // the done marker is gone (round 23: it was write-only).
      const entry = JSON.parse(window.localStorage.getItem(RENEW_USER_KEY));
      expect(entry.user.access_token).toBe('lock-holder-token');
    });

    it('busy lock: waits for the holder PUBLICATION — never its own signinSilent', async () => {
      // Busy on every request: resolves null, callback never invoked.
      Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: { request: () => Promise.resolve(null) }
      });
      jest.useFakeTimers();
      try {
        await initialized();
        const published = createMockUser({ access_token: 'locked-holder-token' });
        setTimeout(() => {
          window.localStorage.setItem(
            RENEW_USER_KEY,
            JSON.stringify({ at: Date.now(), tab: 'other-tab', user: published })
          );
        }, 300);
        const p = keycloakAuthService.signinSilent();
        const assertion = expect(p).resolves.toMatchObject({ access_token: 'locked-holder-token' });
        await jest.advanceTimersByTimeAsync(600);
        await assertion;
        expect(mockSigninSilent).not.toHaveBeenCalled();
        expect(mockStoreUser).toHaveBeenCalledWith(expect.objectContaining({ access_token: 'locked-holder-token' }));
      } finally {
        jest.useRealTimers();
      }
    });

    // ROUND 25 (review 83375): this test used to live OUTSIDE the describe
    // — outside the afterEach that deletes navigator.locks — and paid an
    // 8-line try/finally descriptor save/restore whose restore branch could
    // never meaningfully fire (jsdom HAS no navigator.locks to restore).
    // Inside the describe, the cleanup convention is the describe's own.
    it('a FREE lock with a publication from ANOTHER tab ADOPTS it even when stamped BEFORE this renew started (#1521)', async () => {
      Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: { request: (_name, _opts, cb) => Promise.resolve(cb({})) }
      });
      const holderUser = createMockUser({ access_token: 'holder-finished-token' });
      // The REAL #1521 scenario: the holder finished 10 ms BEFORE this renew
      // started (a real publishRenewedUser stamps Date.now() — the old +5s
      // future stamp was unreachable in production and papered over the
      // startedAt gate). The publication carries the holder's tab id, so the
      // gate admits it regardless of startedAt.
      window.localStorage.setItem(
        RENEW_USER_KEY,
        JSON.stringify({ at: Date.now() - 10, tab: 'holder-tab', user: holderUser })
      );
      mockGetUser.mockResolvedValue(null);
      mockSigninSilent.mockResolvedValue(createMockUser({ access_token: 'my-own-fresh-grant' }));
      const user = await keycloakAuthService.signinSilent();
      expect(user.access_token).toBe('holder-finished-token'); // adopted
      expect(mockSigninSilent).not.toHaveBeenCalled(); // no grant burned
      expect(mockStoreUser).toHaveBeenCalled();
      const stored = mockStoreUser.mock.calls[mockStoreUser.mock.calls.length - 1][0];
      expect(typeof stored.toStorageString).toBe('function'); // a REAL User — storeUser cannot throw
    });
  });
});
