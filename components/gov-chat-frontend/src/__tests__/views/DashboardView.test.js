'use strict';

/**
 * DashboardView tests — AgroGenio hero banner (always visible on dashboard).
 */
jest.mock('jspdf', () => ({ default: function () {} }), { virtual: true });

const { mount } = require('@vue/test-utils');

const DashboardView = require('../../views/DashboardView.vue').default;

function createDashboardWrapper() {
  const configMock = {
    app: {
      banner: { url: '/assets/agrogenio/banner.png' },
      leaves: { url: '/assets/agrogenio/leaves-large.png' },
      mascot: { url: '/assets/agrogenio/mascot-avatar.png', alt: 'AgroGenio mascot' },
      sidebarLeaf: { url: '/assets/agrogenio/leaf-particles.png' }
    }
  };
  return mount(DashboardView, {
    global: {
      provide: { config: configMock },
      mocks: {
        config: configMock,
        $t: (key) => key,
        $store: { getters: { accessToken: null } }
      },
      stubs: {
        ChatBotComponent: {
          name: 'ChatBotComponent',
          template: '<div class="chatbot-stub" />'
        }
      }
    }
  });
}

describe('DashboardView', () => {
  describe('AgroGenio hero banner', () => {
    it('renders .dashboard-banner with banner.png URL as background', () => {
      const wrapper = createDashboardWrapper();
      const banner = wrapper.find('.dashboard-banner');
      expect(banner.exists()).toBe(true);
      expect(banner.attributes('style')).toContain('/assets/agrogenio/banner.png');
    });

    it('renders leaves decoration inside banner', () => {
      const wrapper = createDashboardWrapper();
      const leaves = wrapper.find('.dashboard-banner-leaves');
      expect(leaves.exists()).toBe(true);
      expect(leaves.attributes('src')).toBe('/assets/agrogenio/leaves-large.png');
      expect(leaves.attributes('aria-hidden')).toBe('true');
    });

    it('renders ChatBotComponent below the banner', () => {
      const wrapper = createDashboardWrapper();
      expect(wrapper.find('.chatbot-stub').exists()).toBe(true);
      expect(wrapper.find('.dashboard-content').exists()).toBe(true);
    });

    it('hides banner when config.app.banner.url is missing', () => {
      const wrapper = mount(DashboardView, {
        global: {
          provide: { config: { app: {} } },
          mocks: { $t: (k) => k, $store: { getters: {} } },
          stubs: { ChatBotComponent: { template: '<div />' } }
        }
      });
      expect(wrapper.find('.dashboard-banner').exists()).toBe(false);
    });
  });
});
