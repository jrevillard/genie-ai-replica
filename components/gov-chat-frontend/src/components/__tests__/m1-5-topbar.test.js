/**
 * M1.5 pins (DEC-34/DEC-35) — CAP-1 ITU-blue bar, CAP-2 Dashboard/Analytics
 * hidden for regular users, CAP-3 one Profile button + one tabbed dialog
 * (Account default, Farm pane v-if-lazy so Leaflet never initializes in a
 * hidden container — the M.2 grey-map trap).
 *
 * Seam: same as regular-user-gates.test.js — mount/shallowMount with
 * global.mocks.$store.getters (what mapGetters/local role computeds read).
 */
import { mount, shallowMount, flushPromises } from '@vue/test-utils';
import { reactive } from 'vue';
import fs from 'fs';
import path from 'path';
import NavBarComponent from '../NavBarComponent.vue';
import App from '../../App.vue';
import UserProfileComponent from '../UserProfileComponent.vue';
import FarmerProfileComponent from '../FarmerProfileComponent.vue';

// NavBar (brand-logo test recipe)
jest.mock('@/components/LanguageSelector.vue', () => ({ name: 'LanguageSelector', render: () => null }));
jest.mock('@/services/httpService', () => ({ get: jest.fn(), post: jest.fn() }), { virtual: true });
// App.vue module-load hazards (same set as regular-user-gates.test.js)
jest.mock('../../services/chatHistoryService', () => ({
  getUserFolders: jest.fn().mockResolvedValue({ folders: [] }),
}));
jest.mock('../UnifiedAnalytics.vue', () => ({ name: 'UnifiedAnalytics', render: () => null }));
jest.mock('../FarmerProfileComponent.vue', () => ({ name: 'FarmerProfileComponent', render: () => null }));
jest.mock('../SettingsComponent.vue', () => ({ name: 'SettingsComponent', render: () => null }));
jest.mock('../AdminDashboard.vue', () => ({ name: 'AdminDashboard', render: () => null }));
jest.mock('../../eventBus.js', () => ({
  eventBus: { $emit: jest.fn(), $on: jest.fn(), $off: jest.fn() },
}));

const CONFIG = {
  app: {
    title: 'Agrivisory-Lesotho',
    icon: { type: 'file', value: '/config/agrivisory-logo.webp' },
  },
};

function mountNavBar(roles) {
  return mount(NavBarComponent, {
    global: {
      mocks: {
        $store: { getters: { currentUser: { roles }, isAuthenticated: true } },
        $t: (k, d) => d || k,
        $i18n: { locale: 'en' },
      },
    },
    props: { config: CONFIG },
  });
}

describe('NavBarComponent M1.5 CAP-1/CAP-2/CAP-3', () => {
  it('regular user: zero Analytics and Dashboard buttons (mobile + desktop), one Profile button, no Farmer button', () => {
    const wrapper = mountNavBar([]);

    expect(wrapper.findAll('[aria-label="Analytics"]').length).toBe(0);
    expect(wrapper.findAll('[aria-label="Dashboard"]').length).toBe(0);
    // one merged Profile button per viewport (mobile + desktop sites), farmer pair gone
    expect(wrapper.findAll('[aria-label="User profile"]').length).toBe(2);
    expect(wrapper.findAll('[aria-label="Farmer Profile"]').length).toBe(0); // CAP-3: merged away
    wrapper.unmount();
  });

  it('elevated user: Analytics + Dashboard present and enabled at both sites, badge span intact', () => {
    const wrapper = mountNavBar(['admin']);

    const analytics = wrapper.findAll('[aria-label="Analytics"]');
    const dashboard = wrapper.findAll('[aria-label="Dashboard"]');
    expect(analytics.length).toBe(2); // mobile + desktop
    expect(dashboard.length).toBe(2);
    analytics.concat(dashboard).forEach((btn) => {
      expect(btn.attributes('disabled')).toBeUndefined(); // shown, not greyed
      expect(btn.classes()).not.toContain('disabled-btn');
    });
    dashboard.forEach((btn) => {
      // badge span structure untouched: v-if pendingUsersCount > 0 → absent at 0
      expect(btn.find('.pending-badge').exists()).toBe(false);
    });
    expect(wrapper.findAll('[aria-label="User profile"]').length).toBe(2);
    wrapper.unmount();
  });

  it('emits contract: openProfile stays, openFarmerProfile is gone', () => {
    expect(NavBarComponent.emits).toContain('openProfile');
    expect(NavBarComponent.emits).not.toContain('openFarmerProfile');
  });

  it('CAP-1: bar background is solid ITU blue #001489 — no gradient, no gradient-var consumers left', () => {
    const source = fs.readFileSync(path.join(__dirname, '../NavBarComponent.vue'), 'utf8');
    expect(source).toContain('background: #001489');
    expect(source).not.toContain('--navbar-gradient-start');
    expect(source).not.toContain('--navbar-gradient-end');
  });
});

async function mountAuthenticatedApp() {
  const getters = reactive({
    isAuthenticated: true, // session-restored mount — auth already resolved
    currentUser: { _key: 'user-1', roles: [] },
    isRegularUser: true,
    'chatHistory/getAllFolders': [],
    'chatHistory/getChatById': () => null,
  });
  const wrapper = shallowMount(App, {
    global: {
      mocks: {
        $store: { getters, dispatch: jest.fn() },
        $config: CONFIG,
        $t: (k, d) => d || k,
        $i18n: { locale: 'en' },
        $route: { meta: {} },
      },
      stubs: { RouterView: true },
    },
  });
  await flushPromises(); // mounted() completes -> isLoading false -> authed block renders
  return wrapper;
}

describe('App.vue M1.5 CAP-3 merged profile dialog', () => {
  it('Account tab is the default; Farm pane is v-if-lazy (FarmerProfile absent until its tab opens)', async () => {
    const wrapper = await mountAuthenticatedApp();

    wrapper.vm.showProfileDialog = true; // NavBar's openProfile sets this
    await wrapper.vm.$nextTick();

    const tabs = wrapper.findAll('.profile-tab');
    expect(tabs.length).toBe(2);
    expect(tabs[0].text()).toBe('Account');
    expect(tabs[1].text()).toBe('Farm');
    expect(tabs[0].classes()).toContain('active');

    expect(wrapper.findComponent(UserProfileComponent).exists()).toBe(true);
    expect(wrapper.findComponent(FarmerProfileComponent).exists()).toBe(false); // lazy — Leaflet safe

    await tabs[1].trigger('click'); // open Farm
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent(FarmerProfileComponent).exists()).toBe(true);
    expect(wrapper.findComponent(UserProfileComponent).exists()).toBe(false); // v-if swap, fresh mount per tab
    wrapper.unmount();
  });

  it("child dialog close closes the wrapper and resets to Account; reopening works (fresh mount, Account default)", async () => {
    const wrapper = await mountAuthenticatedApp();

    wrapper.vm.showProfileDialog = true;
    await wrapper.vm.$nextTick();
    await wrapper.findAll('.profile-tab')[1].trigger('click'); // Farm tab
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent(FarmerProfileComponent).exists()).toBe(true);

    wrapper.findComponent(FarmerProfileComponent).vm.$emit('close'); // farmer dialog's own close
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.profile-dialog-tabs').exists()).toBe(false);
    expect(wrapper.findComponent(FarmerProfileComponent).exists()).toBe(false);
    expect(wrapper.vm.activeProfileTab).toBe('account'); // reset

    wrapper.vm.showProfileDialog = true; // second open in a row
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent(UserProfileComponent).exists()).toBe(true); // Account default again
    expect(wrapper.findComponent(FarmerProfileComponent).exists()).toBe(false);

    wrapper.findComponent(UserProfileComponent).vm.$emit('cancel'); // user dialog's cancel
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.showProfileDialog).toBe(false);
    wrapper.unmount();
  });
});
