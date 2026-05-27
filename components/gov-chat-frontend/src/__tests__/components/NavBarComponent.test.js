'use strict';

/**
 * NavBarComponent tests — AC6 through AC8.
 *
 * Covers: navigation links rendering, logout button reflecting auth status,
 * user dropdown when authenticated, and admin-only button disabled state.
 */
const { mount } = require('@vue/test-utils');
const { createStore } = require('vuex');
const { createAuthenticatedState, createUnauthenticatedState } = require('../fixtures/store-state');

// ---------------------------------------------------------------------------
// Component import
// ---------------------------------------------------------------------------
const NavBarComponent = require('../../components/NavBarComponent.vue').default;

// ---------------------------------------------------------------------------
// Store factories
// ---------------------------------------------------------------------------

function createAdminStore() {
  const state = createAuthenticatedState({
    user: {
      iss_sub: 'http://localhost:8080/realms/genie#admin-1',
      sub: 'admin-1',
      iss: 'http://localhost:8080/realms/genie',
      email: 'admin@example.com',
      name: 'Admin User',
      preferred_username: 'admin',
      roles: ['admin', 'user']
    }
  });
  return createStore({
    state: () => state,
    getters: {
      currentUser: (s) => s.user,
      isAuthenticated: (s) => s.isAuthenticated
    },
    actions: {
      logout: jest.fn().mockResolvedValue(undefined)
    }
  });
}

function createNonAdminStore() {
  const state = createAuthenticatedState();
  return createStore({
    state: () => state,
    getters: {
      currentUser: (s) => s.user,
      isAuthenticated: (s) => s.isAuthenticated
    },
    actions: {
      logout: jest.fn().mockResolvedValue(undefined)
    }
  });
}

function createUnauthenticatedStore() {
  const state = createUnauthenticatedState();
  return createStore({
    state: () => state,
    getters: {
      currentUser: () => null,
      isAuthenticated: () => false
    },
    actions: {
      logout: jest.fn().mockResolvedValue(undefined)
    }
  });
}

// ---------------------------------------------------------------------------
// Mount helper
// ---------------------------------------------------------------------------

function createNavBarWrapper({ store, props = {} } = {}) {
  const defaultStore = store || createAdminStore();
  return mount(NavBarComponent, {
    props: {
      isSidebarOpen: true,
      config: {
        app: { title: 'GENIE.AI', icon: { type: 'file', value: '/logo.png' } },
        theme: { navbar: {} }
      },
      ...props
    },
    global: {
      plugins: [defaultStore],
      mocks: {
        $t: (key) => key,
        $i18n: { locale: 'en' },
        $router: { push: jest.fn() }
      },
      stubs: {
        DsButton: {
          template: '<button :disabled="disabled" :aria-label="ariaLabel" @click="$emit(\'click\')"><slot /></button>',
          props: ['disabled', 'variant', 'small', 'tag', 'ariaLabel'],
          emits: ['click']
        },
        LanguageSelector: true,
        'router-link': {
          template: '<a><slot /></a>',
          props: ['to']
        }
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NavBarComponent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // AC6 — Navigation links render correctly
  // -----------------------------------------------------------------------
  describe('AC6 — navigation links render correctly', () => {
    it('renders the brand title from config', () => {
      const wrapper = createNavBarWrapper();
      expect(wrapper.text()).toContain('GENIE.AI');
    });

    it('renders analytics, administration, settings, and profile buttons', () => {
      const wrapper = createNavBarWrapper();
      const buttons = wrapper.findAll('button');
      const ariaLabels = buttons.map((b) => b.attributes('aria-label'));
      expect(ariaLabels).toContain('Analytics');
      expect(ariaLabels).toContain('Administration');
      expect(ariaLabels).toContain('Settings');
      expect(ariaLabels).toContain('User profile');
    });

    it('renders the logout button', () => {
      const wrapper = createNavBarWrapper();
      const buttons = wrapper.findAll('button');
      const ariaLabels = buttons.map((b) => b.attributes('aria-label'));
      expect(ariaLabels).toContain('Log out');
    });

    it('renders the sidebar toggle button', () => {
      const wrapper = createNavBarWrapper();
      const toggleBtn = wrapper.findAll('button');
      const ariaLabels = toggleBtn.map((b) => b.attributes('aria-label'));
      expect(ariaLabels).toContain('Toggle sidebar');
    });

    it('renders all buttons when unauthenticated (admin buttons disabled)', () => {
      const wrapper = createNavBarWrapper({ store: createUnauthenticatedStore() });
      const buttons = wrapper.findAll('button');
      const ariaLabels = buttons.map((b) => b.attributes('aria-label'));
      expect(ariaLabels).toContain('Settings');
      expect(ariaLabels).toContain('User profile');
      expect(ariaLabels).toContain('Log out');
      expect(ariaLabels).toContain('Toggle sidebar');
    });
  });

  // -----------------------------------------------------------------------
  // AC7 — Login/Logout button reflects auth status
  // -----------------------------------------------------------------------
  describe('AC7 — logout button reflects auth status', () => {
    it('logout button is always rendered', () => {
      const wrapper = createNavBarWrapper({ store: createAdminStore() });
      const logoutBtn = wrapper.findAll('button').filter((b) => b.attributes('aria-label') === 'Log out');
      expect(logoutBtn.length).toBeGreaterThanOrEqual(1);
    });

    it('logout button is also rendered when unauthenticated', () => {
      const wrapper = createNavBarWrapper({ store: createUnauthenticatedStore() });
      const logoutBtn = wrapper.findAll('button').filter((b) => b.attributes('aria-label') === 'Log out');
      expect(logoutBtn.length).toBeGreaterThanOrEqual(1);
    });

    it('handleLogout emits logout event and dispatches logout action', async () => {
      const store = createAdminStore();
      const dispatchSpy = jest.spyOn(store, 'dispatch');
      const wrapper = createNavBarWrapper({ store });

      await wrapper.vm.handleLogout();

      expect(wrapper.emitted('logout')).toBeTruthy();
      expect(dispatchSpy).toHaveBeenCalledWith('logout');
    });
  });

  // -----------------------------------------------------------------------
  // AC8 — User dropdown appears when authenticated
  // -----------------------------------------------------------------------
  describe('AC8 — user dropdown appears when authenticated', () => {
    it('user profile button is visible when authenticated', () => {
      const wrapper = createNavBarWrapper({ store: createAdminStore() });
      const profileBtns = wrapper.findAll('button').filter((b) => b.attributes('aria-label') === 'User profile');
      expect(profileBtns.length).toBeGreaterThanOrEqual(1);
    });

    it('user profile button is also present for unauthenticated users', () => {
      const wrapper = createNavBarWrapper({ store: createUnauthenticatedStore() });
      const profileBtns = wrapper.findAll('button').filter((b) => b.attributes('aria-label') === 'User profile');
      // The profile button always renders — it's not conditionally hidden
      expect(profileBtns.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // Admin-only buttons disabled for non-admin users
  // -----------------------------------------------------------------------
  describe('admin buttons disabled for non-admin', () => {
    it('admin buttons are enabled for admin users', () => {
      const wrapper = createNavBarWrapper({ store: createAdminStore() });
      const adminBtns = wrapper.findAll('button').filter((b) => b.attributes('aria-label') === 'Administration');
      // Desktop + mobile = 2 buttons
      adminBtns.forEach((btn) => {
        expect(btn.attributes('disabled')).toBeUndefined();
      });
    });

    it('admin buttons are disabled for non-admin users', () => {
      const wrapper = createNavBarWrapper({ store: createNonAdminStore() });
      const adminBtns = wrapper.findAll('button').filter((b) => b.attributes('aria-label') === 'Administration');
      adminBtns.forEach((btn) => {
        expect(btn.attributes('disabled')).toBeDefined();
      });
    });

    it('analytics buttons are disabled for non-admin users', () => {
      const wrapper = createNavBarWrapper({ store: createNonAdminStore() });
      const analyticsBtns = wrapper.findAll('button').filter((b) => b.attributes('aria-label') === 'Analytics');
      analyticsBtns.forEach((btn) => {
        expect(btn.attributes('disabled')).toBeDefined();
      });
    });

    it('non-admin buttons (settings, profile, logout) are never disabled', () => {
      const wrapper = createNavBarWrapper({ store: createNonAdminStore() });
      const neverDisabled = ['Settings', 'User profile', 'Log out'];
      neverDisabled.forEach((label) => {
        const btns = wrapper.findAll('button').filter((b) => b.attributes('aria-label') === label);
        btns.forEach((btn) => {
          expect(btn.attributes('disabled')).toBeUndefined();
        });
      });
    });
  });

  // -----------------------------------------------------------------------
  // Edge case: user with no roles
  // -----------------------------------------------------------------------
  describe('user with missing roles', () => {
    function createNoRolesStore() {
      const state = createAuthenticatedState({
        user: {
          iss_sub: 'http://localhost:8080/realms/genie#user-no-roles',
          sub: 'user-no-roles',
          iss: 'http://localhost:8080/realms/genie',
          email: 'noroles@example.com',
          name: 'No Roles User',
          preferred_username: 'noroles',
          roles: null
        }
      });
      return createStore({
        state: () => state,
        getters: {
          currentUser: (s) => s.user,
          isAuthenticated: (s) => s.isAuthenticated
        },
        actions: {
          logout: jest.fn().mockResolvedValue(undefined)
        }
      });
    }

    it('renders without crashing when user has null roles', () => {
      const wrapper = createNavBarWrapper({ store: createNoRolesStore() });
      expect(wrapper.find('[data-test-id="nav-bar"]').exists()).toBe(true);
    });

    it('admin buttons are disabled when user has null roles', () => {
      const wrapper = createNavBarWrapper({ store: createNoRolesStore() });
      const adminBtns = wrapper.findAll('button').filter((b) => b.attributes('aria-label') === 'Administration');
      adminBtns.forEach((btn) => {
        expect(btn.attributes('disabled')).toBeDefined();
      });
    });
  });

  // -----------------------------------------------------------------------
  // Sidebar toggle
  // -----------------------------------------------------------------------
  describe('sidebar toggle', () => {
    it('emits toggleSidebar when hamburger button is clicked', async () => {
      const wrapper = createNavBarWrapper();
      const toggleBtn = wrapper.findAll('button').find((b) => b.attributes('aria-label') === 'Toggle sidebar');
      await toggleBtn.trigger('click');
      expect(wrapper.emitted('toggleSidebar')).toBeTruthy();
    });
  });
});
