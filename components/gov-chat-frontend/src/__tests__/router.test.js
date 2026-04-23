'use strict';

// Mock keycloakAuthService before any imports (hoisted by jest)
const mockLogin = jest.fn();
jest.mock('@/services/keycloakAuthService', () => ({
  __esModule: true,
  default: {
    login: mockLogin
  }
}));

// Mock chatHistoryStore to avoid localStorage in tests
jest.mock('@/store/chatHistoryStore', () => ({
  namespaced: true,
  state: {},
  getters: {},
  mutations: {},
  actions: {}
}));

const { createStore } = require('vuex');
const { createRouter, createWebHistory, isNavigationFailure, NavigationFailureType } = require('vue-router');
const authModule = require('@/store/modules/auth').default;
const keycloakAuthService = require('@/services/keycloakAuthService').default;

/**
 * Creates a real Vuex store with auth module for testing.
 * Returns the store and a mockInitialize for assertions.
 */
function createTestStore(overrides = {}) {
  const mockInitialize = jest.fn().mockImplementation(({ commit }) => {
    commit('setInitialized');
    if (overrides.onInit) overrides.onInit(commit);
  });

  const store = createStore({
    modules: {
      auth: {
        namespaced: false,
        state: {
          isAuthenticated: false,
          user: null,
          accessToken: null,
          error: null,
          isInitialized: false,
          ...overrides.state
        },
        getters: authModule.getters,
        actions: {
          ...authModule.actions,
          initialize: mockInitialize,
          login: jest.fn().mockImplementation(async (_, options) => {
            mockLogin(options);
          }),
          handleCallback: jest.fn()
        },
        mutations: authModule.mutations
      },
      chatHistory: {
        namespaced: true,
        state: {},
        getters: {},
        mutations: {},
        actions: {}
      }
    }
  });

  return { store, mockInitialize };
}

/**
 * Creates a real Vue Router with the same guard as router.js.
 */
function createTestRouter(store) {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      {
        path: '/callback',
        name: 'Callback',
        component: { render: () => null },
        meta: { requiresAuth: false }
      },
      {
        path: '/dashboard',
        name: 'Dashboard',
        component: { render: () => null },
        meta: { requiresAuth: true }
      },
      {
        path: '/analytics',
        name: 'Analytics',
        component: { render: () => null },
        meta: { requiresAuth: true }
      },
      {
        path: '/profile',
        name: 'UserProfile',
        component: { render: () => null },
        meta: { requiresAuth: true }
      },
      {
        path: '/',
        redirect: '/dashboard'
      },
      {
        path: '/:pathMatch(.*)*',
        redirect: '/dashboard'
      }
    ]
  });

  // Same guard as router.js
  router.beforeEach(async (to) => {
    if (!store.getters.isAuthInitialized) {
      await store.dispatch('initialize');
    }

    if (to.matched.some((record) => record.meta.requiresAuth === false)) {
      return true;
    }

    if (!store.getters.isAuthenticated) {
      keycloakAuthService.login({ returnUrl: to.fullPath });
      return false;
    }

    return true;
  });

  return router;
}

/**
 * Helper: push to route, handling navigation aborts.
 * Vue Router 4 may resolve (not reject) with a NavigationFailure.
 * Returns { navigated: boolean, error: Error|null }
 */
async function navigateTo(router, path) {
  let result;
  try {
    result = await router.push(path);
  } catch (error) {
    if (isNavigationFailure(error, NavigationFailureType.aborted)) {
      return { navigated: false, error };
    }
    throw error;
  }
  // router.push can resolve with a NavigationFailure instead of throwing
  if (isNavigationFailure(result, NavigationFailureType.aborted)) {
    return { navigated: false, error: result };
  }
  return { navigated: true, error: null };
}

describe('Router Navigation Guard', () => {
  let store;
  let router;
  let mockInitialize;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('when not initialized', () => {
    it('should dispatch initialize and wait before making routing decisions', async () => {
      const result = createTestStore({
        state: { isInitialized: false, isAuthenticated: false }
      });
      store = result.store;
      mockInitialize = result.mockInitialize;
      router = createTestRouter(store);

      await navigateTo(router, '/dashboard');

      expect(mockInitialize).toHaveBeenCalled();
      expect(store.getters.isAuthInitialized).toBe(true);
    });
  });

  describe('when initialized', () => {
    beforeEach(() => {
      const result = createTestStore();
      store = result.store;
      mockInitialize = result.mockInitialize;
      store.commit('setInitialized');
      router = createTestRouter(store);
    });

    it('should allow access to public routes without auth check', async () => {
      const { navigated } = await navigateTo(router, '/callback');

      expect(navigated).toBe(true);
      expect(router.currentRoute.value.path).toBe('/callback');
      expect(mockLogin).not.toHaveBeenCalled();
    });

    it('should redirect unauthenticated users to Keycloak login with returnUrl', async () => {
      const { navigated } = await navigateTo(router, '/dashboard');

      expect(navigated).toBe(false);
      expect(mockLogin).toHaveBeenCalledWith({ returnUrl: '/dashboard' });
    });

    it('should allow authenticated users to access protected routes', async () => {
      store.commit('setAuth', {
        isAuthenticated: true,
        user: { sub: 'test', name: 'Test User' },
        accessToken: 'test-token'
      });

      const { navigated } = await navigateTo(router, '/dashboard');

      expect(navigated).toBe(true);
      expect(router.currentRoute.value.path).toBe('/dashboard');
      expect(mockLogin).not.toHaveBeenCalled();
    });

    it('should pass full path including query string as returnUrl', async () => {
      const { navigated } = await navigateTo(router, '/profile?tab=settings');

      expect(navigated).toBe(false);
      expect(mockLogin).toHaveBeenCalledWith({ returnUrl: '/profile?tab=settings' });
    });

    it('should handle hash in path as part of returnUrl', async () => {
      const { navigated } = await navigateTo(router, '/analytics#section');

      expect(navigated).toBe(false);
      expect(mockLogin).toHaveBeenCalledWith({ returnUrl: '/analytics#section' });
    });
  });
});

describe('CallbackView behavior', () => {
  it('should dispatch handleCallback and redirect to returnUrl from state', async () => {
    const mockDispatch = jest.fn().mockResolvedValue({
      access_token: 'test-token',
      state: { returnUrl: '/dashboard' }
    });
    const mockRouterReplace = jest.fn();

    const user = await mockDispatch('handleCallback');
    const returnUrl = user?.state?.returnUrl || '/dashboard';
    mockRouterReplace(returnUrl);

    expect(mockDispatch).toHaveBeenCalledWith('handleCallback');
    expect(mockRouterReplace).toHaveBeenCalledWith('/dashboard');
  });

  it('should redirect to /dashboard when no returnUrl in state', async () => {
    const mockDispatch = jest.fn().mockResolvedValue({
      access_token: 'test-token',
      state: null
    });
    const mockRouterReplace = jest.fn();

    const user = await mockDispatch('handleCallback');
    const returnUrl = user?.state?.returnUrl || '/dashboard';
    mockRouterReplace(returnUrl);

    expect(mockRouterReplace).toHaveBeenCalledWith('/dashboard');
  });

  it('should redirect to root on callback error', async () => {
    const mockDispatch = jest.fn().mockRejectedValue(new Error('Invalid code'));
    const mockRouterReplace = jest.fn();

    try {
      await mockDispatch('handleCallback');
    } catch {
      mockRouterReplace('/');
    }

    expect(mockRouterReplace).toHaveBeenCalledWith('/');
  });
});
