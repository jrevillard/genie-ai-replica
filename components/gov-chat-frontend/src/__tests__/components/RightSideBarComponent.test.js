'use strict';

/**
 * RightSideBarComponent tests — AgroGenio brand integration.
 */
const { mount } = require('@vue/test-utils');

const RightSideBarComponent = require('../../components/RightSideBarComponent.vue').default;

// ---------------------------------------------------------------------------
// Mount helper
// ---------------------------------------------------------------------------

function createRightSideBarWrapper(propsOverrides = {}) {
  // RightSideBarComponent fetches /FAQ.md on mount — provide a minimal stub
  // so the fetch resolves cleanly without touching the network.
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    text: () => Promise.resolve('# FAQ\n\n## Q1\nA1\n')
  });

  return mount(RightSideBarComponent, {
    props: {
      currentLocale: 'en',
      relatedDocuments: [],
      ...propsOverrides
    },
    global: {
      mocks: {
        $t: (key) => key,
        $i18n: { locale: 'en' }
      },
      stubs: {
        DsButton: {
          template: '<button :disabled="disabled" :aria-label="ariaLabel" @click="$emit(\'click\')"><slot /></button>',
          props: ['disabled', 'variant', 'small', 'tag', 'ariaLabel'],
          emits: ['click']
        },
        FileText: true,
        ChevronRight: true,
        ChevronLeft: true
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RightSideBarComponent', () => {
  describe('AgroGenio leaf decoration', () => {
    it('renders sidebar-header-leaves when sidebar is expanded', () => {
      const wrapper = createRightSideBarWrapper();
      const leaves = wrapper.find('.sidebar-header-leaves');
      expect(leaves.exists()).toBe(true);
      expect(leaves.attributes('src')).toBe('/assets/agrogenio/leaf-particles.png');
      expect(leaves.attributes('aria-hidden')).toBe('true');
    });

    it('hides sidebar-header-leaves when sidebar is collapsed', async () => {
      const wrapper = createRightSideBarWrapper();
      await wrapper.setData({ sidebarCollapsed: true });
      expect(wrapper.find('.sidebar-header-leaves').exists()).toBe(false);
    });
  });

  describe('basic rendering', () => {
    it('renders the sidebar container', () => {
      const wrapper = createRightSideBarWrapper();
      expect(wrapper.find('.sidebar').exists()).toBe(true);
    });

    it('renders the sidebar header with title and toggle', () => {
      const wrapper = createRightSideBarWrapper();
      expect(wrapper.find('.sidebar-header').exists()).toBe(true);
      expect(wrapper.find('.sidebar-toggle').exists()).toBe(true);
    });
  });
});
