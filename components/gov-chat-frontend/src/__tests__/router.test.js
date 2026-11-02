'use strict';

// These tests exercise the REAL router export (@/router) — routes, redirects
// and the OIDC guard — not a hand-copied route table. Only the router's
// collaborators are mocked: keycloakAuthService (login redirect) and the
// Vuex store (auth getters + dispatch).

const mockLogin = jest.fn().mockResolvedValue();
const mockStoreGetters = { isAuthInitialized: false, isAuthenticated: false };
const mockDispatch = jest.fn((action) => {
  if (action === 'initialize') mockStoreGetters.isAuthInitialized = true;
  return Promise.resolve();
});

jest.mock('@/services/keycloakAuthService', () => ({
  __esModule: true,
  default: { login: mockLogin }
}));

jest.mock('@/store', () => ({
  __esModule: true,
  default: { getters: mockStoreGetters, dispatch: mockDispatch }
}));

// Route components stay inert — the tests drive the guard, not rendering.
// (CallbackView is NOT mocked: the second describe mounts the real SFC.)
jest.mock('@/views/DashboardView.vue', () => ({}));
jest.mock('@/components/UnifiedAnalytics.vue', () => ({}));
jest.mock('@/components/UserProfileComponent.vue', () => ({}));
jest.mock('@/components/PendingApprovalScreen.vue', () => ({}));

const { NavigationFailureType } = require('vue-router');

describe('router (real export) — OIDC guard and routes', () => {
  let router;

  beforeEach(() => {
    jest.resetModules();
    router = require('@/router').default;
    mockStoreGetters.isAuthInitialized = true;
    mockStoreGetters.isAuthenticated = false;
    mockLogin.mockClear();
    mockDispatch.mockClear();
  });

  it('redirects unauthenticated users to the /login wrapper with returnUrl (DEC-32b — no direct KC bounce)', async () => {
    const failure = await router.push('/dashboard');

    // Guard returns a location (redirect), not an abort — and does NOT call
    // Keycloak itself; the wrapper's Sign-in performs the signinRedirect.
    expect(failure).toBeFalsy();
    expect(mockLogin).not.toHaveBeenCalled();
    expect(router.currentRoute.value.name).toBe('Login');
    expect(router.currentRoute.value.query.returnUrl).toBe('/dashboard');
  });

  it('allows guarded routes for authenticated users', async () => {
    mockStoreGetters.isAuthenticated = true;

    await router.push('/dashboard');

    expect(router.currentRoute.value.path).toBe('/dashboard');
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('dispatches initialize exactly once when auth is not yet initialized', async () => {
    mockStoreGetters.isAuthInitialized = false;

    await router.push('/analytics');

    expect(mockDispatch).toHaveBeenCalledWith('initialize');
    expect(mockDispatch.mock.calls.filter(([a]) => a === 'initialize')).toHaveLength(1);
  });

  it('allows the public /callback route without authentication', async () => {
    await router.push('/callback');

    expect(router.currentRoute.value.path).toBe('/callback');
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('has a /login route again (DEC-32b wrapper) — public, and authenticated users bounce off it', async () => {
    await router.push('/login');
    expect(router.currentRoute.value.name).toBe('Login');
    expect(mockLogin).not.toHaveBeenCalled();

    mockStoreGetters.isAuthenticated = true;
    // vue-router dedupes identical navigations — move away first so the
    // guard actually re-runs for /login with the authenticated state
    await router.push('/callback');
    await router.push('/login');
    expect(router.currentRoute.value.path).toBe('/dashboard');
  });

  it('redirects / to /dashboard (authenticated)', async () => {
    mockStoreGetters.isAuthenticated = true;

    await router.push('/');

    expect(router.currentRoute.value.path).toBe('/dashboard');
  });
});

describe('CallbackView (mounted)', () => {
  const { mount } = require('@vue/test-utils');
  const CallbackView = require('@/views/CallbackView.vue').default;

  function mountCallback({ user, error } = {}) {
    const replace = jest.fn();
    const dispatch = jest.fn(() =>
      error ? Promise.reject(new Error(error)) : Promise.resolve(user)
    );
    const wrapper = mount(CallbackView, {
      global: {
        mocks: {
          $store: {
            dispatch,
            getters: { authError: error ? 'Authentication callback failed (mock)' : null }
          },
          $router: { replace }
        }
      }
    });
    return { wrapper, replace, dispatch };
  }

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('navigates to the returnUrl carried in the OIDC state on success', async () => {
    const { wrapper, replace } = mountCallback({ user: { state: { returnUrl: '/analytics' } } });

    await flush();
    expect(replace).toHaveBeenCalledWith('/analytics');
    expect(wrapper.find('.callback-error').exists()).toBe(false);
  });

  it('falls back to /dashboard when the OIDC state carries no returnUrl', async () => {
    const { replace } = mountCallback({ user: { state: undefined } });

    await flush();
    expect(replace).toHaveBeenCalledWith('/dashboard');
  });

  it('renders a structured error state (no crash, no bounce to /) on callback failure', async () => {
    const { wrapper, replace, dispatch } = mountCallback({ error: 'state mismatch' });

    await flush();
    expect(replace).not.toHaveBeenCalled();
    const errorBox = wrapper.find('.callback-error');
    expect(errorBox.exists()).toBe(true);
    expect(errorBox.text()).toContain('Authentication callback failed (mock)');

    // "Try again" dispatches the login action (Keycloak redirect)
    await errorBox.find('button').trigger('click');
    expect(dispatch).toHaveBeenCalledWith('login');
  });
});
