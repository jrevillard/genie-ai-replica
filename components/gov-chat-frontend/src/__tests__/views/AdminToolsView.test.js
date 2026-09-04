'use strict';

// Story 4-4: Configuration tab — whitelist editor + web-search toggle.
jest.mock('@/services/httpService', () => ({
  get: jest.fn().mockResolvedValue({
    data: { success: true, data: { whitelist: ['who.int'], web_search_enabled: true } }
  }),
  post: jest.fn().mockResolvedValue({ data: { success: true } }),
  put: jest.fn().mockResolvedValue({
    data: { success: true, data: { whitelist: ['who.int'], web_search_enabled: false } }
  }),
  delete: jest.fn().mockResolvedValue({ data: { success: true } })
}));

const mockDispatch = jest.fn().mockImplementation((action) => {
  if (action === 'fetchToolsConfig') {
    return Promise.resolve();
  }
  return Promise.resolve(true);
});

jest.mock('vuex', () => ({
  createStore: () => ({ state: {}, dispatch: mockDispatch }),
  mapState: (ns, keys) =>
    Object.fromEntries(
      keys.map((k) => [
        k,
        function () {
          return this.$store.state.tools[k];
        }
      ])
    ),
  mapActions: (ns, actions) => Object.fromEntries(actions.map((a) => [a, (...args) => mockDispatch(a, ...args)]))
}));

const AdminToolsView = require('@/views/AdminToolsView.vue').default;
const { mount } = require('@vue/test-utils');

function createWrapper(roles) {
  return mount(AdminToolsView, {
    global: {
      mocks: {
        $t: (k) => k,
        $i18n: { locale: 'en' },
        $store: {
          state: {
            auth: { user: { roles: roles || ['tools-admin'] } },
            tools: {
              feeds: [],
              isLoadingFeeds: false,
              error: null,
              toolsConfig: { whitelist: ['who.int'], web_search_enabled: true },
              isLoadingConfig: false
            }
          },
          dispatch: mockDispatch
        }
      },
      stubs: {
        DsButton: {
          template: `<button :disabled="disabled" @click="$emit('click')"><slot /></button>`,
          props: ['disabled', 'variant', 'small']
        },
        DsInput: true,
        DsStateDisplay: true,
        DsStatusTag: true,
        RouterLink: true
      }
    }
  });
}

describe('AdminToolsView Configuration tab (story 4-4)', () => {
  it('renders the Configuration nav item', () => {
    const wrapper = createWrapper();
    expect(wrapper.text()).toContain('Configuration');
  });

  it('loads the config and populates the whitelist editor', async () => {
    const wrapper = createWrapper();
    await wrapper.vm.loadConfig();
    expect(mockDispatch).toHaveBeenCalledWith('fetchToolsConfig');
    expect(wrapper.vm.whitelistText).toBe('who.int');
    expect(wrapper.vm.configForm.web_search_enabled).toBe(true);
  });

  it('flags an invalid domain in the editor', async () => {
    const wrapper = createWrapper();
    await wrapper.vm.loadConfig();
    wrapper.vm.whitelistText = 'not a domain!';
    expect(wrapper.vm.whitelistValidationError).toContain('not a domain!');
  });

  it('accepts a valid whitelist with no validation error', async () => {
    const wrapper = createWrapper();
    await wrapper.vm.loadConfig();
    wrapper.vm.whitelistText = 'who.int\nun.org';
    expect(wrapper.vm.whitelistValidationError).toBe('');
  });

  it('tools-reader cannot edit (read-only)', async () => {
    const wrapper = createWrapper(['tools-reader']);
    expect(wrapper.vm.canEditConfig).toBe(false);
  });


  it('save calls the store with the parsed whitelist', async () => {
    const wrapper = createWrapper();
    await wrapper.vm.loadConfig();
    wrapper.vm.whitelistText = 'who.int\nun.org';
    mockDispatch.mockClear();
    await wrapper.vm.saveConfig();
    expect(mockDispatch).toHaveBeenCalledWith('saveToolsConfig', {
      whitelist: ['who.int', 'un.org'],
      web_search_enabled: true
    });
  });

  it('save is a no-op while the whitelist is invalid', async () => {
    const wrapper = createWrapper();
    await wrapper.vm.loadConfig();
    wrapper.vm.whitelistText = 'not a domain!';
    mockDispatch.mockClear();
    await wrapper.vm.saveConfig();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('plain user with no tools role cannot edit (default-deny)', async () => {
    const wrapper = createWrapper([]);
    expect(wrapper.vm.canEditConfig).toBe(false);
  });

  it('tools-admin can edit', async () => {
    const wrapper = createWrapper(['tools-admin']);
    expect(wrapper.vm.canEditConfig).toBe(true);
  });
});
