/**
 * L.2 / DEC-32 pins — guard routing through the branded wrapper:
 * unauthenticated → /login with returnUrl; authenticated users skip the
 * wrapper (sent home if they hit it); public routes stay public.
 */
jest.mock('@/store', () => ({
  getters: { isAuthInitialized: true, isAuthenticated: false },
  dispatch: jest.fn(),
}));

jest.mock('@/services/keycloakAuthService', () => ({ login: jest.fn() }));

// Heavy route components — stubbed so importing the router stays cheap
// (UnifiedAnalytics pulls d3 + chart children).
jest.mock('@/components/UserProfileComponent.vue', () => ({ name: 'UserProfileComponent', render: () => null }));
jest.mock('@/components/UnifiedAnalytics.vue', () => ({ name: 'UnifiedAnalytics', render: () => null }));
jest.mock('@/components/PendingApprovalScreen.vue', () => ({ name: 'PendingApprovalScreen', render: () => null }));
jest.mock('@/components/LoginScreen.vue', () => ({ name: 'LoginScreen', render: () => null }));

const store = require('@/store');
// One shared router instance — the guard reads store getters live, so
// flipping isAuthenticated between tests exercises both branches. (A
// resetModules reload would re-run the store mock factory and drop the
// flip.)
const router = require('@/router').default;

describe('router guard → /login wrapper (L.2)', () => {
  it('sends an unauthenticated visitor to the wrapper with returnUrl (no direct KC bounce)', async () => {
    store.getters.isAuthenticated = false;

    await router.push('/dashboard');
    expect(router.currentRoute.value.name).toBe('Login');
    expect(router.currentRoute.value.query.returnUrl).toBe('/dashboard');
  });

  it('lets an authenticated user through to protected routes', async () => {
    store.getters.isAuthenticated = true;

    await router.push('/dashboard');
    expect(router.currentRoute.value.path).toBe('/dashboard');
  });

  it('bounces an authenticated user off /login to home', async () => {
    store.getters.isAuthenticated = true;

    await router.push('/login');
    // '/' itself redirects to /dashboard — the pin is "not stuck on login"
    expect(router.currentRoute.value.path).not.toBe('/login');
    expect(router.currentRoute.value.path).toBe('/dashboard');
  });

  it('keeps /login public for unauthenticated visitors', async () => {
    store.getters.isAuthenticated = false;

    await router.push('/login?returnUrl=/analytics');
    expect(router.currentRoute.value.name).toBe('Login');
    expect(router.currentRoute.value.query.returnUrl).toBe('/analytics');
  });
});
