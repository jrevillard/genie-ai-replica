/**
 * M.1 (DEC-33) hide-by-role pins — the v-if gates are observable:
 * deleting any gate (right sidebar, services tab row, system-status strip)
 * or the activeTab history default fails here while jest+build otherwise
 * stay green. Elevated users must be completely unchanged. CAP-4 was
 * REVERSED (10-08): weather returns for everyone — the regular-user test
 * pins its presence. CAP-5: sidebar collapsed-by-default, never hidden.
 *
 * Seam: @vue/test-utils mount/shallowMount with global.mocks.$store.getters
 * (what mapGetters reads) — same pattern as NavBarComponent.brand-logo.test.js.
 */
import { mount, shallowMount, flushPromises } from '@vue/test-utils';
import { reactive } from 'vue';
import SideBarComponent from '../SideBarComponent.vue';
import ChatBotComponent from '../ChatBotComponent.vue';
import RightSideBarComponent from '../RightSideBarComponent.vue';
import NavBarComponent from '../NavBarComponent.vue';
import App from '../../App.vue';

// NavBar (brand-logo test recipe)
jest.mock('@/components/LanguageSelector.vue', () => ({ name: 'LanguageSelector', render: () => null }));
jest.mock('@/services/httpService', () => ({ get: jest.fn(), post: jest.fn() }), { virtual: true });
// App.vue's import graph pulls ESM-only d3 through UnifiedAnalytics ->
// UsageTrendChart; stub the module so App.vue is loadable under jest
jest.mock('../UnifiedAnalytics.vue', () => ({ name: 'UnifiedAnalytics', render: () => null }));
// leaflet CSS imports are likewise unloadable under jest (FarmerProfileComponent)
jest.mock('../FarmerProfileComponent.vue', () => ({ name: 'FarmerProfileComponent', render: () => null }));
// SettingsComponent runs ThemeManager (window.matchMedia) at module load — jsdom lacks it
jest.mock('../SettingsComponent.vue', () => ({ name: 'SettingsComponent', render: () => null }));
// AdminDashboard pulls QueryInspector.css (unhandled by jest's transform)
jest.mock('../AdminDashboard.vue', () => ({ name: 'AdminDashboard', render: () => null }));


// ChatBotComponent mount-time service calls (recipe: ChatBotComponent.quickhelp-payload.test.js)
jest.mock('../../services/chatbotService', () => ({ submitQuery: jest.fn(), submitFeedback: jest.fn() }));
jest.mock('../../services/notificationService', () => ({ error: jest.fn(), success: jest.fn() }));
jest.mock('../../services/streamingService', () => ({ streamChatQuery: jest.fn(), abortActiveStream: jest.fn() }));
jest.mock('../../services/serviceTreeService', () => ({ getAllCategories: jest.fn().mockResolvedValue([]) }));
jest.mock('../../services/chatHistoryService', () => ({
  getChats: jest.fn().mockResolvedValue([]),
  getConversation: jest.fn(),
  getUserFolders: jest.fn().mockResolvedValue({ folders: [] }), // App.vue loadFoldersOnAuth
}));
jest.mock('../../services/quickhelpService', () => ({
  getButtons: jest.fn().mockResolvedValue([]),
  getAllButtons: jest.fn().mockResolvedValue([]),
  createButton: jest.fn(),
  updateButton: jest.fn(),
  deleteButton: jest.fn(),
}));
jest.mock('../../services/analyticsService', () => ({ logEvent: jest.fn() }));
jest.mock('../../eventBus.js', () => ({
  eventBus: { $emit: jest.fn(), $on: jest.fn(), $off: jest.fn() },
}));
// loadWeatherLocations() dynamic-imports main.js for config — stub the seam
jest.mock('../../main.js', () => ({ loadConfig: jest.fn().mockResolvedValue({}) }));

function storeMocks(isRegularUser, extraGetters = {}) {
  return {
    $store: {
      getters: {
        isRegularUser,
        currentUser: { _key: 'user-1', roles: [] },
        'chatHistory/getAllFolders': [],
        'chatHistory/getChatById': () => null,
        ...extraGetters,
      },
    },
    $t: (k) => k,
    $i18n: { locale: 'en' },
    $route: { meta: {} },
  };
}

function mountSidebar(isRegularUser) {
  return shallowMount(SideBarComponent, {
    global: { mocks: storeMocks(isRegularUser) },
    props: { isOpen: true },
  });
}

describe('SideBarComponent M.1 gates', () => {
  it('regular user: no tab row, weather present (CAP-4 reversed), history pane is the content (not services)', () => {
    const wrapper = mountSidebar(true);

    expect(wrapper.find('.sidebar-tabs').exists()).toBe(false);
    expect(wrapper.find('.weather-container').exists()).toBe(true); // CAP-4 reversed 10-08 — rides the sidebar for everyone
    expect(wrapper.find('.chat-history').exists()).toBe(true);
    expect(wrapper.find('.services-list').exists()).toBe(false);
  });

  it('elevated user: tab row + weather present, activeTab defaults to services', () => {
    const wrapper = mountSidebar(false);

    expect(wrapper.find('.sidebar-tabs').exists()).toBe(true);
    expect(wrapper.find('.weather-container').exists()).toBe(true);
    expect(wrapper.find('.services-list').exists()).toBe(true);
    expect(wrapper.find('.chat-history').exists()).toBe(false);
  });

  it('demotion mid-session: isRegularUser flipping true moves activeTab off the now-hidden services tab', async () => {
    // Reactive getters so the mapGetters computed + watcher actually fire
    const getters = reactive({ isRegularUser: false, currentUser: { _key: 'u', roles: [] } });
    const wrapper = shallowMount(SideBarComponent, {
      global: {
        mocks: {
          $store: { getters },
          $t: (k) => k,
          $i18n: { locale: 'en' },
          $route: { meta: {} },
        },
      },
      props: { isOpen: true },
    });

    expect(wrapper.find('.services-list').exists()).toBe(true); // elevated start
    getters.isRegularUser = true; // silent renew demotes the user
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.services-list').exists()).toBe(false);
    expect(wrapper.find('.chat-history').exists()).toBe(true);
  });
});

describe('ChatBotComponent M.1 gate', () => {
  const mountChat = (isRegularUser) =>
    shallowMount(ChatBotComponent, { global: { mocks: storeMocks(isRegularUser) } });

  it('regular user: no right sidebar (related docs + FAQ column), no system-status strip', () => {
    const wrapper = mountChat(true);
    expect(wrapper.findComponent(RightSideBarComponent).exists()).toBe(false);
    expect(wrapper.find('.system-status-panel').exists()).toBe(false); // CAP-6 — removed entirely, error line included
    wrapper.unmount();
  });

  it('elevated user: right sidebar present, system-status strip unchanged', () => {
    const wrapper = mountChat(false);
    expect(wrapper.findComponent(RightSideBarComponent).exists()).toBe(true);
    expect(wrapper.find('.system-status-panel').exists()).toBe(true);
    wrapper.unmount();
  });
});

/**
 * CAP-5 (amended: toggled off by default, NOT hidden) — regular users land
 * with the sidebar collapsed; the hamburger stays for everyone; saved
 * localStorage preferences win over the role default; elevated users are
 * bit-identical to today.
 *
 * App.vue mount note: the role default is applied in the isAuthenticated
 * watcher (NOT data()) because main.js mounts the app before the router
 * guard finishes auth init — the tests below mount pre-auth and flip the
 * reactive getters to mirror the real sequence.
 */
const NAV_CONFIG = {
  app: {
    title: 'Agrivisory-Lesotho',
    icon: { type: 'file', value: '/config/agrivisory-logo.webp' },
  },
};

function mountApp(isRegularUser, { savedSidebarState = null } = {}) {
  if (savedSidebarState === null) localStorage.removeItem('sidebarOpen');
  else localStorage.setItem('sidebarOpen', savedSidebarState);

  const getters = reactive({
    isAuthenticated: false, // pre-auth, like the real initial navigation
    currentUser: null,
    isRegularUser,
    'chatHistory/getAllFolders': [],
    'chatHistory/getChatById': () => null,
  });
  const wrapper = shallowMount(App, {
    global: {
      mocks: {
        $store: { getters, dispatch: jest.fn() },
        $config: NAV_CONFIG,
        $t: (k) => k,
        $i18n: { locale: 'en' },
        $route: { meta: {} },
      },
      stubs: { RouterView: true },
    },
  });
  return {
    wrapper,
    login: async () => {
      getters.isAuthenticated = true; // router guard finishes auth init
      getters.currentUser = { _key: 'user-1', roles: isRegularUser ? [] : ['admin'] };
      await flushPromises();
      await wrapper.vm.$nextTick();
    },
  };
}

describe('NavBarComponent CAP-5 hamburger', () => {
  it('hamburger stays present for regular users — the sidebar is collapsed, not gone', () => {
    const wrapper = mount(NavBarComponent, {
      global: {
        mocks: {
          $store: { getters: { currentUser: { roles: [] }, isAuthenticated: true, isRegularUser: true } },
          $t: (k, d) => d || k,
          $i18n: { locale: 'en' },
        },
      },
      props: { config: NAV_CONFIG },
    });
    expect(wrapper.find('.hamburger-btn').exists()).toBe(true);
    wrapper.unmount();
  });
});

describe('App.vue CAP-5 sidebar default state', () => {
  afterEach(() => localStorage.removeItem('sidebarOpen'));

  it('regular user, no saved state: starts collapsed — chat full-width class, sidebar rendered (closed)', async () => {
    const { wrapper, login } = mountApp(true);
    await login();

    expect(wrapper.vm.isSidebarOpen).toBe(false);
    expect(wrapper.find('#app').classes()).toContain('sidebar-collapsed');
    expect(wrapper.findComponent(SideBarComponent).exists()).toBe(true);
    wrapper.unmount();
  });

  it('elevated user, no saved state: starts open exactly as today', async () => {
    const { wrapper, login } = mountApp(false);
    await login();

    expect(wrapper.vm.isSidebarOpen).toBe(true);
    expect(wrapper.find('#app').classes()).not.toContain('sidebar-collapsed');
    expect(wrapper.findComponent(SideBarComponent).exists()).toBe(true);
    wrapper.unmount();
  });

  it('saved localStorage preference wins over the role default — both roles', async () => {
    const regular = mountApp(true, { savedSidebarState: 'true' }); // regular who opened it
    await regular.login();
    expect(regular.wrapper.vm.isSidebarOpen).toBe(true);
    regular.wrapper.unmount();

    const elevated = mountApp(false, { savedSidebarState: 'false' }); // admin who closed it
    await elevated.login();
    expect(elevated.wrapper.vm.isSidebarOpen).toBe(false);
    elevated.wrapper.unmount();
  });
});
