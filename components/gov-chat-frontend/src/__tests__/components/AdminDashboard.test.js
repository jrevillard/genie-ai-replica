'use strict';

/**
 * AdminDashboard tests — AC4 through AC6 + tab navigation and loading.
 *
 * Covers: renders without errors, auth state from Vuex, tab navigation,
 * overview tab content, users tab content, and loading state.
 */
const { mount } = require('@vue/test-utils');
const { createStore } = require('vuex');
const { createAuthenticatedState, createUnauthenticatedState } = require('../fixtures/store-state');

// ---------------------------------------------------------------------------
// Service mocks (closure-based refs for per-test control)
// ---------------------------------------------------------------------------

const mockGetSystemHealth = jest.fn().mockResolvedValue({
  metrics: {
    systemUptime: 99.98,
    avgResponseTime: 245,
    errorRate: 0.05,
    monthlyActiveUsers: 42
  },
  healthServices: [{ id: 'apiServices', name: 'API Services', status: 'good' }],
  resourceUsage: { cpu: 42, memory: 78, storage: 92, network: 35 }
});

const mockGetUserStats = jest.fn().mockResolvedValue({
  totalUsers: 150,
  activeUsers: 42,
  newUsers: 12,
  users: [
    {
      _key: 'user-1',
      loginName: 'user1',
      fullName: 'User One',
      email: 'one@test.com',
      roles: []
    },
    {
      _key: 'user-2',
      loginName: 'user2',
      fullName: 'User Two',
      email: 'two@test.com',
      roles: []
    }
  ]
});

const mockGetSecurityMetrics = jest.fn().mockResolvedValue({
  failedLoginAttempts: 5,
  suspiciousActivities: 1,
  lastSecurityScan: '1 hour ago',
  vulnerabilities: { critical: 0, medium: 1, low: 3 }
});

const mockGetLogs = jest.fn().mockResolvedValue([]);
const mockGetLogsSummary = jest.fn().mockResolvedValue({
  errorLogs: [],
  warningLogs: []
});
const mockSearchLogs = jest.fn().mockResolvedValue([]);
const mockSearchUsers = jest.fn().mockResolvedValue({
  data: {
    users: [
      {
        _key: 'user-1',
        loginName: 'user1',
        fullName: 'User One',
        email: 'one@test.com',
        roles: []
      },
      {
        _key: 'user-2',
        loginName: 'user2',
        fullName: 'User Two',
        email: 'two@test.com',
        roles: []
      }
    ],
    total: 2
  }
});
const mockGetSecurityDetails = jest.fn().mockResolvedValue({});
const mockRunDiagnostics = jest.fn().mockResolvedValue({});
const mockRunSecurityScan = jest.fn().mockResolvedValue({});

jest.mock('../../services/adminDashboardService', () => ({
  getSystemHealth: mockGetSystemHealth,
  getUserStats: mockGetUserStats,
  getSecurityMetrics: mockGetSecurityMetrics,
  getLogs: mockGetLogs,
  getLogsSummary: mockGetLogsSummary,
  searchLogs: mockSearchLogs,
  searchUsers: mockSearchUsers,
  getSecurityDetails: mockGetSecurityDetails,
  runDiagnostics: mockRunDiagnostics,
  runSecurityScan: mockRunSecurityScan
}));

jest.mock('../../services/serviceTreeService', () => ({
  getAdminCategories: jest.fn().mockResolvedValue([]),
  getCategoryTranslations: jest.fn().mockResolvedValue([]),
  getServiceTranslations: jest.fn().mockResolvedValue([]),
  createCategory: jest.fn().mockResolvedValue({}),
  updateCategory: jest.fn().mockResolvedValue({}),
  createService: jest.fn().mockResolvedValue({}),
  updateService: jest.fn().mockResolvedValue({}),
  deleteCategory: jest.fn().mockResolvedValue({}),
  deleteService: jest.fn().mockResolvedValue({})
}));

jest.mock('../../services/databaseOperationsService', () => ({
  getDatabaseStats: jest.fn().mockResolvedValue({ data: {} }),
  backupDatabase: jest.fn().mockResolvedValue({ data: {} }),
  optimizeDatabase: jest.fn().mockResolvedValue({ data: {} })
}));

jest.mock('../../services/documentFileService', () => ({
  getFiles: jest.fn().mockResolvedValue([]),
  // Defaults to the all-success 207 shape so existing tests still pass. Individual
  // tests override this to exercise partial-failure and all-failure paths.
  ingestMultipleFiles: jest.fn().mockResolvedValue({
    success: true,
    successCount: 2,
    failureCount: 0,
    results: []
  }),
  retractMultipleFiles: jest.fn().mockResolvedValue({
    success: true,
    successCount: 2,
    failureCount: 0,
    results: []
  }),
  // #1042: batch delete — defaults to the all-success shape so existing
  // tests pass; individual tests override to exercise partial/all-failure.
  deleteMultipleFiles: jest.fn().mockResolvedValue({
    success: true,
    results: []
  })
}));

const mockNotificationSuccess = jest.fn();
const mockNotificationError = jest.fn();
const mockNotificationInfo = jest.fn();

jest.mock('../../services/notificationService', () => ({
  success: mockNotificationSuccess,
  error: mockNotificationError,
  info: mockNotificationInfo
}));

const mockEventBusOn = jest.fn();
const mockEventBusOff = jest.fn();
const mockEventBusEmit = jest.fn();

jest.mock('../../eventBus', () => ({
  eventBus: {
    $on: mockEventBusOn,
    $off: mockEventBusOff,
    $emit: mockEventBusEmit
  }
}));

jest.mock('../../config/oidcConfig', () => ({
  __esModule: true,
  default: {
    authority: 'http://localhost:8080/realms/genie',
    clientId: 'genie-app'
  }
}));

jest.mock('../../config/languageConfig', () => {
  const availableLanguages = [
    { code: 'en', name: 'English' },
    { code: 'fr', name: 'French' }
  ];
  return {
    availableLanguages,
    getAvailableLanguages: () => availableLanguages
  };
});

jest.mock('../../utils/fileUtils', () => ({
  formatFileSize: jest.fn((size) => size + ' B')
}));

jest.mock('../../utils/ThemeManager', () => ({
  themeManager: {
    getCurrentTheme: jest.fn(() => 'light'),
    setTheme: jest.fn()
  }
}));

jest.mock('@lucide/vue', () => ({
  Loader2: { template: '<svg />' }
}));

// ---------------------------------------------------------------------------
// Component import (after mocks)
// ---------------------------------------------------------------------------
const AdminDashboard = require('../../components/AdminDashboard.vue').default;

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

function createAdminStore(stateOverrides = {}) {
  const state = createAuthenticatedState({
    user: {
      iss_sub: 'http://localhost:8080/realms/genie#admin-1',
      sub: 'admin-1',
      iss: 'http://localhost:8080/realms/genie',
      email: 'admin@example.com',
      name: 'Admin User',
      preferred_username: 'admin',
      roles: ['admin', 'user'],
      ...stateOverrides
    }
  });
  return createStore({
    state: () => state,
    getters: {
      currentUser: (s) => s.user,
      isAuthenticated: (s) => s.isAuthenticated,
      isAuthInitialized: (s) => s.isInitialized
    }
  });
}

function createUnauthenticatedStore() {
  const state = createUnauthenticatedState();
  return createStore({
    state: () => state,
    getters: {
      currentUser: () => null,
      isAuthenticated: () => false,
      isAuthInitialized: () => true
    }
  });
}

// ---------------------------------------------------------------------------
// Mount helper
// ---------------------------------------------------------------------------

function createAdminDashboardWrapper(storeOverrides = {}, extraMocks = {}, extraStubs = {}) {
  const store = createAdminStore(storeOverrides);
  return mount(AdminDashboard, {
    global: {
      plugins: [store],
      mocks: {
        $t: (key) => key,
        $te: () => true,
        $i18n: { locale: 'en' },
        ...extraMocks
      },
      stubs: {
        DsButton: {
          template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
          props: ['disabled', 'variant', 'small', 'tag']
        },
        DsTabs: {
          template: '<div><slot /></div>',
          props: ['tabs', 'modelValue']
        },
        DsSpinner: true,
        DsStateDisplay: {
          template: '<div><slot /></div>',
          props: ['type', 'message']
        },
        DsInput: {
          template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
          props: ['modelValue', 'type', 'placeholder']
        },
        DsSelect: true,
        DsStatusTag: true,
        OperationResultsModal: true,
        LogSearchDialog: true,
        UploadFilesDialog: true,
        AddFromLinkDialog: true,
        FileDetailsDialog: true,
        ConfirmDialog: true,
        Loader2: true,
        ...extraStubs
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AdminDashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // AC4 — Renders without errors
  // -----------------------------------------------------------------------
  describe('AC4 — renders without errors', () => {
    it('mounts successfully and renders dashboard container', () => {
      const wrapper = createAdminDashboardWrapper();
      expect(wrapper.find('[data-test-id="admin-dashboard"]').exists()).toBe(true);
    });

    it('renders the overview tab by default', () => {
      const wrapper = createAdminDashboardWrapper();
      expect(wrapper.find('[data-test-id="admin-dashboard"]').exists()).toBe(true);
      expect(wrapper.vm.activeTab).toBe('overview');
    });

    it('calls loadInitialData on mount', () => {
      createAdminDashboardWrapper();
      expect(mockGetSystemHealth).toHaveBeenCalledTimes(1);
    });

    it('initializes all ten admin tabs (OKF Studio next to Document Management; Models LAST)', () => {
      const wrapper = createAdminDashboardWrapper();
      const tabIds = wrapper.vm.tabs.map((t) => t.id);
      // Story 3-7 fix (#977): OKF Studio tab moved to sit immediately after
      // Document Management so the crawler→OKF workflow is a one-step click.
      // Story 8-7 (David 2026-10-20): model configurations — the LAST tab.
      expect(tabIds).toEqual([
        'overview',
        'hierarchy',
        'documents',
        'studio',
        'database',
        'logs',
        'queryInspector',
        'security',
        'users',
        'models'
      ]);
    });

    // David 2026-10-21: "the left sidebar menus need to be aligned with the
    // tabs in the tab rack" — the Studio tab had NO sidebar entry (clicking it
    // left the menu with no active item), and Settings listed users before
    // security against the rack's order. The sidebar must navigate to every
    // tab, in rack order.
    // OKF feature flag (2026-10-21): OKF_ENABLED=0 parks the OKF surfaces —
    // the Studio and Models tabs (rack + sidebar) disappear; Query Inspector
    // is platform tooling and STAYS (David's call).
    it('OKF flag off hides Studio and Models from rack and sidebar, keeps Query Inspector', async () => {
      window.APP_CONFIG = { okfEnabled: '0' };
      try {
        const wrapper = createAdminDashboardWrapper(
          {},
          {},
          {
            OkfStudioTab: true,
            OkfModelConfigPanel: true,
            QueryInspector: true
          }
        );
        const tabIds = wrapper.vm.adminTabs.map((t) => t.value);
        expect(tabIds).not.toContain('studio');
        expect(tabIds).not.toContain('models');
        expect(tabIds).toContain('queryInspector'); // platform tooling stays
        expect(tabIds).toHaveLength(8);
        const linkText = wrapper.findAll('.sidebar .nav-link').map((l) => l.text());
        expect(linkText.join(' | ')).not.toContain('OKF Studio');
        expect(linkText.join(' | ')).not.toContain('admin.tabs.models');
        expect(wrapper.findAll('.sidebar .nav-link')).toHaveLength(8);
      } finally {
        delete window.APP_CONFIG;
      }
    });

    it('sidebar nav mirrors the tab rack: every tab reachable, in rack order', async () => {
      // The heavy tab panels (Studio fetches repos on mount, Models fetches
      // configs, Inspector mounts its own store calls) are stubbed — this
      // test is about the NAVIGATION surface, not the panels' payloads.
      const wrapper = createAdminDashboardWrapper(
        {},
        {},
        {
          OkfStudioTab: true,
          OkfModelConfigPanel: true,
          QueryInspector: true
        }
      );
      const links = wrapper.findAll('.sidebar .nav-link');
      expect(links.length).toBe(wrapper.vm.tabs.length);
      for (let i = 0; i < wrapper.vm.tabs.length; i += 1) {
        await links[i].trigger('click');
        expect(wrapper.vm.activeTab).toBe(wrapper.vm.tabs[i].id);
      }
    });
  });

  // -----------------------------------------------------------------------
  // AC5 — Auth state from Vuex store
  // -----------------------------------------------------------------------
  describe('AC5 — accesses auth state from Vuex store', () => {
    it('reads currentUser from store', () => {
      const wrapper = createAdminDashboardWrapper();
      expect(wrapper.vm.currentUser).toBeTruthy();
      expect(wrapper.vm.currentUser.name).toBe('Admin User');
    });

    it('getCurrentUser sets currentUser data from store getters', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.getCurrentUser();
      expect(wrapper.vm.currentUser.email).toBe('admin@example.com');
    });

    it('does not crash when store has no user (unauthenticated)', () => {
      const store = createUnauthenticatedStore();
      const wrapper = mount(AdminDashboard, {
        global: {
          plugins: [store],
          mocks: {
            $t: (key) => key,
            $te: () => true,
            $i18n: { locale: 'en' }
          },
          stubs: {
            DsButton: true,
            DsTabs: true,
            DsSpinner: true,
            DsStateDisplay: true,
            DsInput: true,
            DsSelect: true,
            DsStatusTag: true,
            OperationResultsModal: true,
            LogSearchDialog: true,
            UploadFilesDialog: true,
            AddFromLinkDialog: true,
            FileDetailsDialog: true,
            ConfirmDialog: true,
            Loader2: true
          }
        }
      });
      expect(wrapper.vm.currentUser).toEqual({});
    });
  });

  // -----------------------------------------------------------------------
  // AC6 — Tab navigation switches active tab
  // -----------------------------------------------------------------------
  describe('AC6 — tab navigation', () => {
    it('setActiveTab changes the active tab', async () => {
      const wrapper = createAdminDashboardWrapper();

      wrapper.vm.setActiveTab('users');
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.activeTab).toBe('users');
    });

    it('setActiveTab loads data for the users tab', async () => {
      const wrapper = createAdminDashboardWrapper();
      mockGetUserStats.mockClear();

      wrapper.vm.setActiveTab('users');
      await wrapper.vm.$nextTick();

      expect(mockGetUserStats).toHaveBeenCalled();
    });

    it('setActiveTab loads data for the security tab', async () => {
      const wrapper = createAdminDashboardWrapper();
      mockGetSecurityMetrics.mockClear();

      wrapper.vm.setActiveTab('security');
      await wrapper.vm.$nextTick();

      expect(mockGetSecurityMetrics).toHaveBeenCalled();
    });

    it('adminTabs computed maps each tab to { label, value }', () => {
      const wrapper = createAdminDashboardWrapper();
      const tabs = wrapper.vm.adminTabs;
      expect(tabs.length).toBe(10);
      expect(tabs[0].value).toBe('overview');
      expect(tabs[0].label).toBe('System Health'); // translate() returns the fallback label from tabs data
      expect(tabs.every((t) => typeof t.label === 'string' && typeof t.value === 'string')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Overview tab renders system health content
  // -----------------------------------------------------------------------
  describe('overview tab renders system health content', () => {
    it('loads system health metrics on mount', async () => {
      const wrapper = createAdminDashboardWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.metrics.systemUptime).toBe(99.98);
      expect(wrapper.vm.metrics.avgResponseTime).toBe(245);
    });

    it('populates healthServices from API response', async () => {
      const wrapper = createAdminDashboardWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.healthServices.length).toBeGreaterThan(0);
    });

    it('populates resourceUsage from API response', async () => {
      const wrapper = createAdminDashboardWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.resourceUsage).toEqual([
        { id: 'cpu', label: expect.any(String), value: 42 },
        { id: 'memory', label: expect.any(String), value: 78 },
        { id: 'storage', label: expect.any(String), value: 92 },
        { id: 'network', label: expect.any(String), value: 35 }
      ]);
    });
  });

  // -----------------------------------------------------------------------
  // Users tab renders user management UI
  // -----------------------------------------------------------------------
  describe('users tab renders user management UI', () => {
    it('loads user stats when users tab is activated', async () => {
      const wrapper = createAdminDashboardWrapper();
      mockGetUserStats.mockClear();

      wrapper.vm.setActiveTab('users');
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.userStats.totalUsers).toBe(150);
      expect(wrapper.vm.userStats.activeUsers).toBe(42);
    });

    it('populates userSearchResults from API response', async () => {
      const wrapper = createAdminDashboardWrapper();
      mockGetUserStats.mockClear();

      wrapper.vm.setActiveTab('users');
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.userSearchResults.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Loading state during data fetch
  // -----------------------------------------------------------------------
  describe('loading state', () => {
    it('isLoading is set during system health fetch', () => {
      mockGetSystemHealth.mockReturnValueOnce(new Promise(() => {}));
      const wrapper = createAdminDashboardWrapper();
      // loadSystemHealth was called and is still pending
      expect(wrapper.vm.isLoading).toBe(true);
    });

    it('isLoading is false after system health completes', async () => {
      const wrapper = createAdminDashboardWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.isLoading).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Window event listener cleanup
  // -----------------------------------------------------------------------
  describe('lifecycle cleanup', () => {
    it('removes themeChange listener on unmount', () => {
      const wrapper = createAdminDashboardWrapper();
      const removeSpy = jest.spyOn(window, 'removeEventListener');
      wrapper.unmount();

      expect(removeSpy).toHaveBeenCalledWith('themeChange', expect.any(Function));
      removeSpy.mockRestore();
    });
  });

  // -----------------------------------------------------------------------
  // keycloakAdminUrl computed
  // -----------------------------------------------------------------------
  describe('keycloakAdminUrl computed', () => {
    it('builds admin URL from oidcConfig authority', () => {
      const wrapper = createAdminDashboardWrapper();
      const url = wrapper.vm.keycloakAdminUrl;
      expect(url).toContain('/auth/admin/');
      expect(url).toContain('/genie/');
    });
  });

  // -----------------------------------------------------------------------
  // Task 1a: Tab switching — all tabs
  // -----------------------------------------------------------------------
  describe('setActiveTab — all tab data loading', () => {
    it('loads database stats when database tab is activated', async () => {
      const wrapper = createAdminDashboardWrapper();
      const dbMock = require('../../services/databaseOperationsService').getDatabaseStats;
      dbMock.mockClear();

      wrapper.vm.setActiveTab('database');
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.activeTab).toBe('database');
      expect(dbMock).toHaveBeenCalled();
    });

    it('loads logs summary and logs when logs tab is activated', async () => {
      const wrapper = createAdminDashboardWrapper();
      mockGetLogsSummary.mockClear();
      mockGetLogs.mockClear();

      wrapper.vm.setActiveTab('logs');
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.activeTab).toBe('logs');
      expect(mockGetLogsSummary).toHaveBeenCalled();
      expect(mockGetLogs).toHaveBeenCalled();
    });

    it('loads knowledge hierarchy when hierarchy tab is activated with empty data', async () => {
      const wrapper = createAdminDashboardWrapper();
      const treeMock = require('../../services/serviceTreeService').getAdminCategories;
      treeMock.mockClear();

      wrapper.vm.knowledgeHierarchy = [];
      wrapper.vm.setActiveTab('hierarchy');
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.activeTab).toBe('hierarchy');
      expect(treeMock).toHaveBeenCalled();
    });

    it('loads documents when documents tab is activated', async () => {
      const wrapper = createAdminDashboardWrapper();
      const docMock = require('../../services/documentFileService').getFiles;
      docMock.mockClear();

      wrapper.vm.setActiveTab('documents');
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.activeTab).toBe('documents');
      expect(docMock).toHaveBeenCalled();
    });

    it('does not reload hierarchy if data already exists', async () => {
      const wrapper = createAdminDashboardWrapper();
      const treeMock = require('../../services/serviceTreeService').getAdminCategories;
      treeMock.mockClear();
      wrapper.vm.knowledgeHierarchy = [{ _key: 'cat-1', nameEN: 'Existing' }];

      wrapper.vm.setActiveTab('hierarchy');
      await wrapper.vm.$nextTick();

      expect(treeMock).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // The hierarchy panel reads the wire spelling (nameEN) the admin tree
  // publishes, not the localized name.
  // -----------------------------------------------------------------------
  describe('loadKnowledgeHierarchy — nameEN mapping', () => {
    it('maps the payload nameEN onto the editor rows at both levels', async () => {
      const treeMock = require('../../services/serviceTreeService').getAdminCategories;
      treeMock.mockClear();
      treeMock.mockResolvedValueOnce([
        {
          catKey: 'cat-1',
          catCode: 'taxes',
          name: 'Impuestos',
          nameEN: 'Taxes',
          children: [
            {
              _key: 'svc-1',
              name: 'Declaración de impuestos',
              nameEN: 'Tax Filing'
            }
          ]
        }
      ]);

      const wrapper = createAdminDashboardWrapper();
      await wrapper.vm.loadKnowledgeHierarchy();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.knowledgeHierarchy).toHaveLength(1);
      // Localized and EN values differ on purpose: the rows must carry the
      // EN spelling the filter wire speaks, and a mapping that picked the
      // localized name would read 'Impuestos' here.
      expect(wrapper.vm.knowledgeHierarchy[0]).toMatchObject({
        _key: 'cat-1',
        nameEN: 'Taxes'
      });
      expect(wrapper.vm.knowledgeHierarchy[0].services).toHaveLength(1);
      expect(wrapper.vm.knowledgeHierarchy[0].services[0]).toMatchObject({
        _key: 'svc-1',
        nameEN: 'Tax Filing'
      });
    });

    it('falls back to the payload name when the tree predates the nameEN field', async () => {
      const treeMock = require('../../services/serviceTreeService').getAdminCategories;
      treeMock.mockClear();
      treeMock.mockResolvedValueOnce([
        {
          catKey: 'cat-1',
          catCode: 'taxes',
          name: 'Taxes',
          children: [{ _key: 'svc-1', name: 'Tax Filing' }]
        }
      ]);

      const wrapper = createAdminDashboardWrapper();
      await wrapper.vm.loadKnowledgeHierarchy();
      await wrapper.vm.$nextTick();

      // A tree without the field is a response from a backend older than
      // it: the panel is fetched in English, so the payload's `name` IS
      // the English translation there. Same fallback the mobile collector
      // makes for the same deploy window.
      expect(wrapper.vm.knowledgeHierarchy[0]).toMatchObject({
        _key: 'cat-1',
        nameEN: 'Taxes'
      });
      expect(wrapper.vm.knowledgeHierarchy[0].services[0]).toMatchObject({
        _key: 'svc-1',
        nameEN: 'Tax Filing'
      });
    });
  });

  // -----------------------------------------------------------------------
  // Task 1b: Dirty state protection — isFormDirty computed
  // -----------------------------------------------------------------------
  describe('isFormDirty computed', () => {
    it('returns false when no originalHierarchyFormState', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.originalHierarchyFormState = null;
      expect(wrapper.vm.isFormDirty).toBe(false);
    });

    it('returns false when form matches original state', () => {
      const wrapper = createAdminDashboardWrapper();
      const serialized = JSON.stringify(wrapper.vm.hierarchyForm);
      wrapper.vm.originalHierarchyFormState = serialized;
      expect(wrapper.vm.isFormDirty).toBe(false);
    });

    it('returns true when form differs from original state', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.originalHierarchyFormState = JSON.stringify({ nameEN: 'old' });
      wrapper.vm.hierarchyForm.nameEN = 'changed';
      expect(wrapper.vm.isFormDirty).toBe(true);
    });

    it('setActiveTab shows confirm dialog when hierarchy tab has unsaved changes', async () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.activeTab = 'hierarchy';
      wrapper.vm.originalHierarchyFormState = JSON.stringify({ nameEN: 'old' });
      wrapper.vm.hierarchyForm.nameEN = 'changed';

      wrapper.vm.setActiveTab('users');
      await wrapper.vm.$nextTick();

      // Tab should NOT switch — confirm dialog is shown instead
      expect(wrapper.vm.activeTab).toBe('hierarchy');
      expect(wrapper.vm.confirmDialogState.visible).toBe(true);
    });

    it('confirm dialog onConfirm proceeds with tab switch', async () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.activeTab = 'hierarchy';
      wrapper.vm.originalHierarchyFormState = JSON.stringify({ nameEN: 'old' });
      wrapper.vm.hierarchyForm.nameEN = 'changed';

      wrapper.vm.setActiveTab('users');
      await wrapper.vm.$nextTick();

      // Simulate user confirming the dialog
      await wrapper.vm.confirmDialogState.onConfirm();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.activeTab).toBe('users');
      expect(wrapper.vm.confirmDialogState.visible).toBe(false);
    });

    it('confirm dialog onCancel keeps user on hierarchy tab', async () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.activeTab = 'hierarchy';
      wrapper.vm.originalHierarchyFormState = JSON.stringify({ nameEN: 'old' });
      wrapper.vm.hierarchyForm.nameEN = 'changed';

      wrapper.vm.setActiveTab('users');
      await wrapper.vm.$nextTick();

      await wrapper.vm.confirmDialogState.onCancel();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.activeTab).toBe('hierarchy');
      expect(wrapper.vm.confirmDialogState.visible).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Task 1c: Loading/error states
  // -----------------------------------------------------------------------
  describe('error handling', () => {
    it('loadSystemHealth shows error notification on API failure', async () => {
      mockGetSystemHealth.mockRejectedValueOnce(new Error('Network error'));
      const wrapper = createAdminDashboardWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      expect(mockEventBusEmit).toHaveBeenCalledWith('notification:show', expect.objectContaining({ type: 'error' }));
    });

    it('loadSystemHealth shows error when response lacks metrics', async () => {
      mockGetSystemHealth.mockResolvedValueOnce({ noMetrics: true });
      const wrapper = createAdminDashboardWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      expect(mockEventBusEmit).toHaveBeenCalledWith('notification:show', expect.objectContaining({ type: 'error' }));
    });

    it('loadLogsSummary handles invalid response structure', async () => {
      mockGetLogsSummary.mockResolvedValueOnce({ data: { notAnArray: true } });
      const wrapper = createAdminDashboardWrapper();
      mockEventBusEmit.mockClear();

      await wrapper.vm.loadLogsSummary();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.errorLogsSummary).toEqual([]);
      expect(wrapper.vm.warningLogsSummary).toEqual([]);
      expect(mockEventBusEmit).toHaveBeenCalledWith('notification:show', expect.objectContaining({ type: 'error' }));
    });

    // MR !343 round-2 finding #6b: pin the canonical /admin/logs/summary
    // wire contract — service returns the full axios response (`{ data:
    // { errors, warnings, date } }`); component reads `response.data.errors`.
    // A previous round-1 mismatch (service extracted `response.data` before
    // returning) left the panel silently broken even on the success path.
    it('loadLogsSummary populates error/warning lists via canonical wire', async () => {
      mockGetLogsSummary.mockResolvedValueOnce({
        data: {
          errors: [{ level: 'ERROR', message: 'boom' }],
          warnings: [{ level: 'WARN', message: 'hiss' }],
          date: '2026-05-26'
        }
      });
      const wrapper = createAdminDashboardWrapper();

      await wrapper.vm.loadLogsSummary();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.errorLogsSummary).toEqual([{ level: 'ERROR', message: 'boom' }]);
      expect(wrapper.vm.warningLogsSummary).toEqual([{ level: 'WARN', message: 'hiss' }]);
    });

    it('loadLogsSummary handles API error gracefully', async () => {
      mockGetLogsSummary.mockRejectedValueOnce(new Error('Server error'));
      const wrapper = createAdminDashboardWrapper();

      await wrapper.vm.loadLogsSummary();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.errorLogsSummary).toEqual([]);
      expect(wrapper.vm.warningLogsSummary).toEqual([]);
    });

    it('loadSecurityMetrics resets to defaults on error', async () => {
      mockGetSecurityMetrics.mockRejectedValueOnce(new Error('Security API down'));
      mockGetSecurityDetails.mockResolvedValueOnce({});
      const wrapper = createAdminDashboardWrapper();

      await wrapper.vm.loadSecurityMetrics();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.securityMetrics).toEqual({
        failedLoginAttempts: 0,
        suspiciousActivities: 0,
        lastSecurityScan: 'Never',
        vulnerabilities: { critical: 0, medium: 0, low: 0 }
      });
    });

    it('loadSecurityDetails maps patternMatches out of the severity buckets', async () => {
      // The backend stopped calling a bare substring a vulnerability.
      // The panel must show the term, the count and the real log line —
      // and none of it may reach the critical/medium/low lists.
      mockGetSecurityDetails.mockReset();
      mockGetSecurityDetails.mockResolvedValue({
        lastScan: '2026-09-28T18:00:00Z',
        vulnerabilities: { critical: 0, medium: 1, low: 0 },
        vulnerabilityDetails: { critical: [], medium: [], low: [] },
        patternMatches: [
          {
            type: 'attack_attempt',
            pattern: 'CSRF',
            occurrences: 2,
            sample:
              'logger=settings t=2026-09-25T08:13:01.983348506Z level=info ' +
              'var="GF_SECURITY_CSRF_TRUSTED_ORIGINS=https://localhost:8443"',
            sampleTimestamp: '2026-09-25T08:13:01.983348506Z',
            service: 'grafana',
            lastSeen: '2026-09-25T08:13:01.983348506Z'
          }
        ],
        failedLoginDetails: [],
        suspiciousDetails: []
      });
      const wrapper = createAdminDashboardWrapper();

      await wrapper.vm.loadSecurityDetails();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.securityDetails.vulnerabilityDetails.critical).toEqual([]);
      expect(wrapper.vm.securityDetails.patternMatches).toHaveLength(1);
      expect(wrapper.vm.securityDetails.patternMatches[0]).toEqual({
        type: 'attack_attempt',
        pattern: 'CSRF',
        occurrences: 2,
        sample:
          'logger=settings t=2026-09-25T08:13:01.983348506Z level=info ' +
          'var="GF_SECURITY_CSRF_TRUSTED_ORIGINS=https://localhost:8443"',
        sampleTimestamp: '2026-09-25T08:13:01.983348506Z',
        service: 'grafana',
        lastSeen: '2026-09-25T08:13:01.983348506Z'
      });
    });

    it('marks the pattern-match section with a neutral dot, not a severity colour', async () => {
      // Every other section in the panel opens with a severity dot. This
      // one must still have a dot or it reads as a rendering fault, but it
      // must not borrow a severity colour — the backend withdrew the
      // severity claim.
      mockGetSecurityDetails.mockReset();
      mockGetSecurityDetails.mockResolvedValue({
        lastScan: 'Never',
        patternMatches: [
          {
            type: 'attack_attempt',
            pattern: 'CSRF',
            occurrences: 1,
            sample: 'x',
            service: 'grafana'
          }
        ]
      });
      const wrapper = createAdminDashboardWrapper();

      // The section only renders once the security tab is active.
      wrapper.vm.setActiveTab('security');
      await wrapper.vm.loadSecurityDetails();
      await wrapper.vm.$nextTick();

      const section = wrapper.find('.pattern-match-section');
      expect(section.exists()).toBe(true);
      const dot = section.find('.severity-indicator');
      expect(dot.exists()).toBe(true);
      expect(dot.classes()).toContain('neutral');
      for (const severityClass of ['critical', 'medium', 'low', 'warning', 'info']) {
        expect(dot.classes()).not.toContain(severityClass);
      }
    });

    it('loadSecurityDetails defaults patternMatches to an empty list when absent', async () => {
      // A scan result cached before this field existed must not break
      // the panel.
      mockGetSecurityDetails.mockReset();
      mockGetSecurityDetails.mockResolvedValue({ lastScan: 'Never' });
      const wrapper = createAdminDashboardWrapper();

      await wrapper.vm.loadSecurityDetails();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.securityDetails.patternMatches).toEqual([]);
    });

    it('loadSecurityDetails populates failedLoginDetails with backend log.level (caller-path for parseLogMessage)', async () => {
      // Backend `security-scan-service.js` produces { timestamp, level, message };
      // the AdminDashboard mapper must propagate `level` to the UI table — not
      // collapse every entry to UNKNOWN via parseLogMessage(plainString).
      // Use mockResolvedValue (persistent) rather than Once to bypass any stale
      // once-queues left over from earlier tests in this suite.
      mockGetSecurityDetails.mockReset();
      mockGetSecurityDetails.mockResolvedValue({
        lastScan: '2026-09-08T10:00:00Z',
        vulnerabilities: { critical: 0, medium: 0, low: 0 },
        failedLoginDetails: [
          {
            timestamp: '2026-09-08T10:00:00Z',
            level: 'ERROR',
            message: 'Invalid credentials'
          },
          {
            timestamp: '2026-09-08T10:01:00Z',
            level: 'WARN',
            message: 'Repeated failures'
          }
        ],
        suspiciousDetails: [
          {
            timestamp: '2026-09-08T10:02:00Z',
            level: 'WARNING',
            message: 'Anomalous IP'
          }
        ]
      });
      const wrapper = createAdminDashboardWrapper();

      await wrapper.vm.loadSecurityDetails();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.securityDetails.failedLoginDetails).toEqual([
        {
          timestamp: '2026-09-08T10:00:00Z',
          type: 'ERROR',
          message: 'Invalid credentials'
        },
        {
          timestamp: '2026-09-08T10:01:00Z',
          type: 'WARN',
          message: 'Repeated failures'
        }
      ]);
      expect(wrapper.vm.securityDetails.suspiciousDetails).toEqual([
        {
          timestamp: '2026-09-08T10:02:00Z',
          type: 'WARNING',
          message: 'Anomalous IP'
        }
      ]);
    });

    it('loadSecurityDetails falls back to parseLogMessage when log.level is missing (legacy/printf path)', async () => {
      // Pairs with the previous test: when a backend row lacks `level`, the mapper
      // must feed `log.message` (a JSON-encoded string) through parseLogMessage.
      // Pins the fallback branch of mapAndParseLogDetail.
      mockGetSecurityDetails.mockReset();
      mockGetSecurityDetails.mockResolvedValue({
        lastScan: '2026-09-08T11:00:00Z',
        vulnerabilities: { critical: 0, medium: 0, low: 0 },
        failedLoginDetails: [
          {
            timestamp: '2026-09-08T11:00:00Z',
            message: JSON.stringify({
              level: 'ERROR',
              message: 'Legacy failure'
            })
          }
        ],
        suspiciousDetails: []
      });
      const wrapper = createAdminDashboardWrapper();

      await wrapper.vm.loadSecurityDetails();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.securityDetails.failedLoginDetails).toEqual([
        {
          timestamp: '2026-09-08T11:00:00Z',
          type: 'ERROR',
          message: 'Legacy failure'
        }
      ]);
    });

    it('loadSecurityDetails does not propagate literal "null" timestamp when log row is missing fields', async () => {
      // Regression guard: mapAndParseLogDetail must coalesce a missing timestamp
      // to an empty string rather than propagating JS null through to the UI table.
      mockGetSecurityDetails.mockReset();
      mockGetSecurityDetails.mockResolvedValue({
        lastScan: '2026-09-08T12:00:00Z',
        vulnerabilities: { critical: 0, medium: 0, low: 0 },
        failedLoginDetails: [{ level: 'ERROR', message: 'no timestamp here' }],
        suspiciousDetails: []
      });
      const wrapper = createAdminDashboardWrapper();

      await wrapper.vm.loadSecurityDetails();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.securityDetails.failedLoginDetails[0]).toEqual({
        timestamp: '',
        type: 'ERROR',
        message: 'no timestamp here'
      });
    });
  });

  // -----------------------------------------------------------------------
  // Task 1d: Multi-column sorting
  // -----------------------------------------------------------------------
  describe('sortBy — multi-column sort with toggle', () => {
    it('toggles order when clicking same column', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.sortKey = 'file_name';
      wrapper.vm.sortOrders.file_name = 'asc';

      wrapper.vm.sortBy('file_name');
      expect(wrapper.vm.sortOrders.file_name).toBe('desc');
    });

    it('sets new sort key when clicking different column', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.sortKey = 'file_name';

      wrapper.vm.sortBy('upload_date');
      expect(wrapper.vm.sortKey).toBe('upload_date');
    });

    it('sortedAndFilteredDocuments sorts ascending by default', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.documents = [
        { _key: 'a', file_name: 'beta', dataprep: { status: 'ready' } },
        { _key: 'b', file_name: 'alpha', dataprep: { status: 'ready' } }
      ];
      wrapper.vm.sortKey = 'file_name';
      wrapper.vm.sortOrders.file_name = 'asc';

      const sorted = wrapper.vm.sortedAndFilteredDocuments;
      expect(sorted[0].file_name).toBe('alpha');
      expect(sorted[1].file_name).toBe('beta');
    });

    it('sortedAndFilteredDocuments sorts descending', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.documents = [
        { _key: 'a', file_name: 'alpha', dataprep: { status: 'ready' } },
        { _key: 'b', file_name: 'beta', dataprep: { status: 'ready' } }
      ];
      wrapper.vm.sortKey = 'file_name';
      wrapper.vm.sortOrders.file_name = 'desc';

      const sorted = wrapper.vm.sortedAndFilteredDocuments;
      expect(sorted[0].file_name).toBe('beta');
      expect(sorted[1].file_name).toBe('alpha');
    });

    it('sortedAndFilteredDocuments handles nested sort keys', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.documents = [
        { _key: 'a', file_name: 'a', dataprep: { status: 'ready' } },
        { _key: 'b', file_name: 'b', dataprep: { status: 'ingested' } }
      ];
      wrapper.vm.sortKey = 'dataprep.status';
      wrapper.vm.sortOrders['dataprep.status'] = 'asc';

      const sorted = wrapper.vm.sortedAndFilteredDocuments;
      expect(sorted[0]._key).toBe('b');
      expect(sorted[1]._key).toBe('a');
    });

    it('filteredDocuments returns empty when documents is empty', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.documents = [];
      expect(wrapper.vm.filteredDocuments).toEqual([]);
    });

    it('filteredDocuments filters by status', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.documents = [
        { _key: 'a', dataprep: { status: 'ready' } },
        { _key: 'b', dataprep: { status: 'processing' } }
      ];
      wrapper.vm.documentFilters.status = 'ready';

      expect(wrapper.vm.filteredDocuments).toHaveLength(1);
      expect(wrapper.vm.filteredDocuments[0]._key).toBe('a');
    });

    it('filteredDocuments returns all when status is "all"', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.documents = [
        { _key: 'a', dataprep: { status: 'ready' } },
        { _key: 'b', dataprep: { status: 'processing' } }
      ];
      wrapper.vm.documentFilters.status = 'all';

      expect(wrapper.vm.filteredDocuments).toHaveLength(2);
    });

    it('filteredDocuments matches status case-insensitively (dataprep persists Title Case)', () => {
      // Regression for #832: dataprep persists status capitalized ('Ingested',
      // 'Pending', 'Retracted') but the filter option values are lowercase.
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.documents = [
        { _key: 'a', dataprep: { status: 'Ingested' } },
        { _key: 'b', dataprep: { status: 'Pending' } },
        { _key: 'c', dataprep: { status: 'Retracted' } }
      ];
      wrapper.vm.documentFilters.status = 'ingested';

      const result = wrapper.vm.filteredDocuments;
      expect(result).toHaveLength(1);
      expect(result[0]._key).toBe('a');
    });

    it('filtering by "Ingested" does not hide degraded documents silently', () => {
      // A degraded phase lands the document as "Ingested with Warnings", not
      // "Ingested". That is the whole point: the badge must not lie. But it
      // means the exact-status filter drops those documents, so the dropdown
      // needs its own option or the operator can never isolate them.
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.documents = [
        { _key: 'a', dataprep: { status: 'Ingested' } },
        { _key: 'b', dataprep: { status: 'Ingested with Warnings' } }
      ];

      // DsSelect is stubbed as an auto-stub in this suite, so its <option>
      // children never reach the DOM. Assert the option exists in the component
      // source instead — otherwise the filter below would be reachable only by
      // assignment, which is exactly the silent gap this guards.
      const fs = require('fs');
      const path = require('path');
      const source = fs.readFileSync(path.resolve(__dirname, '../../components/AdminDashboard.vue'), 'utf-8');
      expect(source).toContain('<option value="ingested with warnings">');
      expect(source).toContain("translate('admin.documents.statusWarning'");

      wrapper.vm.documentFilters.status = 'ingested with warnings';
      const degraded = wrapper.vm.filteredDocuments;
      expect(degraded).toHaveLength(1);
      expect(degraded[0]._key).toBe('b');
    });

    it('getStatusVariant renders a degraded document as a warning badge', () => {
      const wrapper = createAdminDashboardWrapper();
      expect(
        wrapper.vm.getStatusVariant({
          dataprep: { status: 'Ingested with Warnings' }
        })
      ).toBe('warning');
      // And a clean one is still the success badge, so the state means something.
      expect(wrapper.vm.getStatusVariant({ dataprep: { status: 'Ingested' } })).toBe('success');
    });

    it('a degraded document can still be re-ingested', () => {
      // The remedy for a degraded document is to raise the budget and ingest
      // again, so the Ingest button must stay available for it. This is the one
      // place where "not exactly 'Ingested'" is the correct behaviour, and it
      // is load-bearing: widening that comparison to include the warning state
      // would hide the remedy.
      const wrapper = createAdminDashboardWrapper();
      // selectedDocuments holds file_ids — showIngestButton resolves them back
      // through `documents`, so a document with only a _key matches nothing and
      // the assertion would pass for the wrong reason.
      wrapper.vm.documents = [{ file_id: 'b', dataprep: { status: 'Ingested with Warnings' } }];
      wrapper.vm.selectedDocuments = ['b'];
      expect(wrapper.vm.showIngestButton).toBe(true);

      wrapper.vm.documents = [{ file_id: 'a', dataprep: { status: 'Ingested' } }];
      wrapper.vm.selectedDocuments = ['a'];
      expect(wrapper.vm.showIngestButton).toBe(false);
    });

    it('filteredDocuments matches Retracted/Pending status case-insensitively', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.documents = [
        { _key: 'a', dataprep: { status: 'Ingested' } },
        { _key: 'b', dataprep: { status: 'Pending' } },
        { _key: 'c', dataprep: { status: 'Retracted' } }
      ];
      wrapper.vm.documentFilters.status = 'retracted';

      const result = wrapper.vm.filteredDocuments;
      expect(result).toHaveLength(1);
      expect(result[0]._key).toBe('c');
    });
  });

  // -----------------------------------------------------------------------
  // Task 1e: showIngestButton computed
  // -----------------------------------------------------------------------
  describe('showIngestButton computed', () => {
    it('returns false when no documents are selected', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.selectedDocuments = [];
      expect(wrapper.vm.showIngestButton).toBe(false);
    });

    it('returns false when selected documents contain ingested status', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.documents = [
        {
          _key: '39933124',
          file_id: '1774623200119_e9887fa8',
          dataprep: { status: 'ingested' }
        }
      ];
      wrapper.vm.selectedDocuments = ['1774623200119_e9887fa8'];

      expect(wrapper.vm.showIngestButton).toBe(false);
    });

    it('returns true when selected documents are not ingested', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.documents = [
        {
          _key: '39933124',
          file_id: '1774623200119_e9887fa8',
          dataprep: { status: 'ready' }
        }
      ];
      wrapper.vm.selectedDocuments = ['1774623200119_e9887fa8'];

      expect(wrapper.vm.showIngestButton).toBe(true);
    });

    it('returns false when any selected document has ingested status', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.documents = [
        {
          _key: '39933124',
          file_id: '1774623200119_e9887fa8',
          dataprep: { status: 'ready' }
        },
        {
          _key: '39933120',
          file_id: '1774620171830_9589f57b',
          dataprep: { status: 'ingested' }
        }
      ];
      wrapper.vm.selectedDocuments = ['1774623200119_e9887fa8', '1774620171830_9589f57b'];

      expect(wrapper.vm.showIngestButton).toBe(false);
    });

    it('returns false when selected document has Title-Case ingested status (#832)', () => {
      // Regression for #832: dataprep.status persisted as 'Ingested' (Title Case).
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.documents = [
        {
          _key: '39933124',
          file_id: '1774623200119_e9887fa8',
          dataprep: { status: 'Ingested' }
        }
      ];
      wrapper.vm.selectedDocuments = ['1774623200119_e9887fa8'];

      expect(wrapper.vm.showIngestButton).toBe(false);
    });

    it('regression: filter must look up by file_id, NOT ArangoDB _key (cross-key shape)', () => {
      // Real-world shape: _key (ArangoDB internal) != file_id (semantic).
      // Pre-fix the filter used doc._key, but selectedDocuments carries file_ids,
      // so the lookup silently fails and the button stays visible for an
      // already-ingested file. This test would have caught that secondary bug.
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.documents = [
        {
          _key: '39933124',
          file_id: '1774623200119_e9887fa8',
          dataprep: { status: 'Ingested' }
        }
      ];
      wrapper.vm.selectedDocuments = ['1774623200119_e9887fa8'];

      expect(wrapper.vm.showIngestButton).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Task 1f: Confirm dialog
  // -----------------------------------------------------------------------
  describe('showConfirmDialog / resetConfirmDialog', () => {
    it('showConfirmDialog sets visible state with custom options', () => {
      const wrapper = createAdminDashboardWrapper();
      const onConfirm = jest.fn();
      const onCancel = jest.fn();

      wrapper.vm.showConfirmDialog({
        title: 'Delete Item?',
        message: 'This cannot be undone.',
        confirmText: 'Delete',
        cancelText: 'Keep',
        onConfirm,
        onCancel
      });

      expect(wrapper.vm.confirmDialogState.visible).toBe(true);
      expect(wrapper.vm.confirmDialogState.title).toBe('Delete Item?');
      expect(wrapper.vm.confirmDialogState.message).toBe('This cannot be undone.');
      expect(wrapper.vm.confirmDialogState.confirmText).toBe('Delete');
      expect(wrapper.vm.confirmDialogState.cancelText).toBe('Keep');
    });

    it('showConfirmDialog uses default text when not provided', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.showConfirmDialog({});

      expect(wrapper.vm.confirmDialogState.visible).toBe(true);
      expect(wrapper.vm.confirmDialogState.title).toBeTruthy();
      expect(wrapper.vm.confirmDialogState.message).toBeTruthy();
    });

    it('resetConfirmDialog resets all state to defaults', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.showConfirmDialog({ title: 'Test', message: 'Test' });
      expect(wrapper.vm.confirmDialogState.visible).toBe(true);

      wrapper.vm.resetConfirmDialog();
      expect(wrapper.vm.confirmDialogState.visible).toBe(false);
      expect(wrapper.vm.confirmDialogState.title).toBe('');
      expect(wrapper.vm.confirmDialogState.message).toBe('');
    });

    it('confirm dialog onConfirm callback is called and dialog resets', async () => {
      const wrapper = createAdminDashboardWrapper();
      const onConfirm = jest.fn();

      wrapper.vm.showConfirmDialog({ title: 'Test', onConfirm });
      await wrapper.vm.confirmDialogState.onConfirm();

      expect(onConfirm).toHaveBeenCalled();
      expect(wrapper.vm.confirmDialogState.visible).toBe(false);
    });

    it('confirm dialog onCancel callback is called and dialog resets', async () => {
      const wrapper = createAdminDashboardWrapper();
      const onCancel = jest.fn();

      wrapper.vm.showConfirmDialog({ title: 'Test', onCancel });
      await wrapper.vm.confirmDialogState.onCancel();

      expect(onCancel).toHaveBeenCalled();
      expect(wrapper.vm.confirmDialogState.visible).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Additional computed and method coverage
  // -----------------------------------------------------------------------
  describe('displayedUsers computed', () => {
    it('returns search results when available', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.userSearchResults = [{ _key: 'user-1', loginName: 'search-result' }];
      expect(wrapper.vm.displayedUsers).toEqual([{ _key: 'user-1', loginName: 'search-result' }]);
    });

    it('returns empty array when searching with no results yet', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.isSearchingUsers = true;
      wrapper.vm.userSearchResults = null;
      expect(wrapper.vm.displayedUsers).toEqual([]);
    });

    it('returns userStats.users when no search active', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.userSearchResults = null;
      wrapper.vm.isSearchingUsers = false;
      wrapper.vm.userStats.users = [{ _key: 'user-1' }];
      expect(wrapper.vm.displayedUsers).toEqual([{ _key: 'user-1' }]);
    });
  });

  describe('getUsageLevel', () => {
    it('returns "low" for values below 50', () => {
      const wrapper = createAdminDashboardWrapper();
      expect(wrapper.vm.getUsageLevel(30)).toBe('low');
    });

    it('returns "medium" for values between 50 and 79', () => {
      const wrapper = createAdminDashboardWrapper();
      expect(wrapper.vm.getUsageLevel(65)).toBe('medium');
    });

    it('returns "high" for values 80 and above', () => {
      const wrapper = createAdminDashboardWrapper();
      expect(wrapper.vm.getUsageLevel(90)).toBe('high');
    });
  });

  describe('getUserManageUrl', () => {
    it('builds URL with user sub when available', () => {
      const wrapper = createAdminDashboardWrapper();
      const url = wrapper.vm.getUserManageUrl({ sub: 'user-456' });
      expect(url).toContain('/user-456/settings');
    });

    it('falls back to base admin URL when no sub', () => {
      const wrapper = createAdminDashboardWrapper();
      const url = wrapper.vm.getUserManageUrl({});
      expect(url).toBe(wrapper.vm.keycloakAdminUrl);
    });
  });

  describe('handleSearchResults', () => {
    it('shows info notification for empty results', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.handleSearchResults([]);
      expect(mockEventBusEmit).toHaveBeenCalledWith('notification:show', expect.objectContaining({ type: 'info' }));
    });

    it('stores search results and shows success notification', () => {
      const wrapper = createAdminDashboardWrapper();
      const results = [
        {
          id: 'log-1',
          message: 'test',
          level: 'INFO',
          time: '12:00',
          service: 'api'
        }
      ];
      wrapper.vm.activeTab = 'logs';
      wrapper.vm.handleSearchResults(results);

      expect(wrapper.vm.searchResults).toEqual(results);
      expect(mockEventBusEmit).toHaveBeenCalledWith('notification:show', expect.objectContaining({ type: 'success' }));
    });

    it('calls setActiveTab("logs") when not already on logs tab', () => {
      const wrapper = createAdminDashboardWrapper();
      const setActiveTabSpy = jest.spyOn(wrapper.vm, 'setActiveTab').mockImplementation(() => {});
      wrapper.vm.activeTab = 'overview';
      wrapper.vm.handleSearchResults([{ id: 'log-1', level: 'INFO' }]);

      expect(setActiveTabSpy).toHaveBeenCalledWith('logs');
      setActiveTabSpy.mockRestore();
    });
  });

  // ---------------------------------------------------------------------------
  // parseLogMessage method
  // ---------------------------------------------------------------------------
  describe('parseLogMessage', () => {
    it('returns UNKNOWN for non-string input (number)', () => {
      const wrapper = createAdminDashboardWrapper();
      const result = wrapper.vm.parseLogMessage(123);
      expect(result).toEqual({ type: 'UNKNOWN', message: '123' });
    });

    it('returns UNKNOWN for null input', () => {
      const wrapper = createAdminDashboardWrapper();
      const result = wrapper.vm.parseLogMessage(null);
      expect(result).toEqual({ type: 'UNKNOWN', message: 'null' });
    });

    it('extracts ERROR type from JSON-encoded log entry', () => {
      const wrapper = createAdminDashboardWrapper();
      const result = wrapper.vm.parseLogMessage(JSON.stringify({ level: 'ERROR', message: 'something went wrong' }));
      expect(result).toEqual({
        type: 'ERROR',
        message: 'something went wrong'
      });
    });

    it('extracts INFO type from JSON-encoded log entry', () => {
      const wrapper = createAdminDashboardWrapper();
      const result = wrapper.vm.parseLogMessage(JSON.stringify({ level: 'INFO', message: 'status update' }));
      expect(result).toEqual({ type: 'INFO', message: 'status update' });
    });

    it('returns UNKNOWN for plain string without JSON parseable shape', () => {
      const wrapper = createAdminDashboardWrapper();
      const result = wrapper.vm.parseLogMessage('plain log message');
      expect(result).toEqual({ type: 'UNKNOWN', message: 'plain log message' });
    });

    it('extracts WARNING type from JSON-encoded log entry', () => {
      const wrapper = createAdminDashboardWrapper();
      // Feed lowercase 'warn' so the assertion exercises parsed.level.toUpperCase() — not just an already-upper value.
      const result = wrapper.vm.parseLogMessage(JSON.stringify({ level: 'warn', message: 'this is a warning' }));
      expect(result).toEqual({ type: 'WARN', message: 'this is a warning' });
    });

    it('parses JSON-encoded log entries that carry extra fields', () => {
      // The actual JSON.parse-discrimination proof is the next test (malformed JSON -> UNKNOWN).
      // This test pins the JSON input shape: { level, message } plus any extra fields are tolerated.
      const wrapper = createAdminDashboardWrapper();
      const json = JSON.stringify({
        level: 'ERROR',
        message: 'parsed',
        trace_id: 'abc123',
        span_id: 'def456'
      });
      const result = wrapper.vm.parseLogMessage(json);
      expect(result.type).toBe('ERROR');
      expect(result.message).toBe('parsed');
    });

    it('falls back to UNKNOWN on malformed JSON input', () => {
      const wrapper = createAdminDashboardWrapper();
      const result = wrapper.vm.parseLogMessage('{not valid json');
      expect(result).toEqual({ type: 'UNKNOWN', message: '{not valid json' });
    });
  });

  // ---------------------------------------------------------------------------
  // getStatusVariant method
  // ---------------------------------------------------------------------------
  describe('getStatusVariant', () => {
    it('returns "info" for crawling status', () => {
      const wrapper = createAdminDashboardWrapper();
      const doc = { crawlJob: { status: 'crawling' } };
      expect(wrapper.vm.getStatusVariant(doc)).toBe('info');
    });

    it('returns "error" for failed crawl status', () => {
      const wrapper = createAdminDashboardWrapper();
      const doc = { crawlJob: { status: 'failed' } };
      expect(wrapper.vm.getStatusVariant(doc)).toBe('error');
    });

    it('returns "error" for killed crawl status', () => {
      const wrapper = createAdminDashboardWrapper();
      const doc = { crawl_job: { status: 'killed' } };
      expect(wrapper.vm.getStatusVariant(doc)).toBe('error');
    });

    it('returns "success" for ingested dataprep', () => {
      const wrapper = createAdminDashboardWrapper();
      const doc = { dataprep: { status: 'ingested' } };
      expect(wrapper.vm.getStatusVariant(doc)).toBe('success');
    });

    it('returns "info" for ingesting dataprep', () => {
      const wrapper = createAdminDashboardWrapper();
      const doc = { dataprep: { status: 'ingesting' } };
      expect(wrapper.vm.getStatusVariant(doc)).toBe('info');
    });

    it('returns "warning" for "ingested with warnings"', () => {
      const wrapper = createAdminDashboardWrapper();
      const doc = { dataprep: { status: 'ingested with warnings' } };
      expect(wrapper.vm.getStatusVariant(doc)).toBe('warning');
    });

    it('returns "error" for "ingestion error"', () => {
      const wrapper = createAdminDashboardWrapper();
      const doc = { dataprep: { status: 'ingestion error' } };
      expect(wrapper.vm.getStatusVariant(doc)).toBe('error');
    });

    it('returns "pending" for pending dataprep', () => {
      const wrapper = createAdminDashboardWrapper();
      const doc = { dataprep: { status: 'pending' } };
      expect(wrapper.vm.getStatusVariant(doc)).toBe('pending');
    });

    it('returns "info" for retracted', () => {
      const wrapper = createAdminDashboardWrapper();
      const doc = { dataprep: { status: 'retracted' } };
      expect(wrapper.vm.getStatusVariant(doc)).toBe('info');
    });

    it('returns "info" as default fallback', () => {
      const wrapper = createAdminDashboardWrapper();
      const doc = { dataprep: { status: 'unknown status' } };
      expect(wrapper.vm.getStatusVariant(doc)).toBe('info');
    });

    it('handles crawl_job as array', () => {
      const wrapper = createAdminDashboardWrapper();
      const doc = { crawl_job: [{ status: 'crawling' }] };
      expect(wrapper.vm.getStatusVariant(doc)).toBe('info');
    });

    it('handles empty crawl_job array', () => {
      const wrapper = createAdminDashboardWrapper();
      const doc = { crawl_job: [], dataprep: { status: 'ingested' } };
      expect(wrapper.vm.getStatusVariant(doc)).toBe('success');
    });
  });

  // ---------------------------------------------------------------------------
  // getDisplayStatus method
  // ---------------------------------------------------------------------------
  describe('getDisplayStatus', () => {
    it('returns "Crawling" for crawling status', () => {
      const wrapper = createAdminDashboardWrapper();
      const doc = { crawlJob: { status: 'crawling' } };
      expect(wrapper.vm.getDisplayStatus(doc)).toBe('Crawling');
    });

    it('returns "Crawl Failed" for failed status', () => {
      const wrapper = createAdminDashboardWrapper();
      const doc = { crawlJob: { status: 'failed' } };
      expect(wrapper.vm.getDisplayStatus(doc)).toBe('Crawl Failed');
    });

    it('returns "Crawl Killed" for killed status', () => {
      const wrapper = createAdminDashboardWrapper();
      const doc = { crawl_job: { status: 'killed' } };
      expect(wrapper.vm.getDisplayStatus(doc)).toBe('Crawl Killed');
    });

    it('returns "Crawl Scheduled" for pending crawl', () => {
      const wrapper = createAdminDashboardWrapper();
      const doc = { crawlJob: { status: 'pending' } };
      expect(wrapper.vm.getDisplayStatus(doc)).toBe('Crawl Scheduled');
    });

    it('translates dataprep.status when no crawl job', () => {
      // Translated, not passed through: the filter on this same screen offers a
      // TRANSLATED option for each of these values, so an English badge put two
      // languages side by side. Only the LABEL is translated — the badge colour
      // comes from getStatusVariant(doc), which reads doc.dataprep.status
      // directly, so this cannot change how a status is styled.
      const wrapper = createAdminDashboardWrapper();
      expect(wrapper.vm.getDisplayStatus({ dataprep: { status: 'ingested' } })).toBe('Ingested');
      expect(wrapper.vm.getDisplayStatus({ dataprep: { status: 'Ingested' } })).toBe('Ingested');
      expect(
        wrapper.vm.getDisplayStatus({
          dataprep: { status: 'Ingested with Warnings' }
        })
      ).toBe('Ingested with Warnings');
      expect(
        wrapper.vm.getDisplayStatus({
          dataprep: { status: 'ingested with warnings' }
        })
      ).toBe('Ingested with Warnings');
    });

    it('resolves each dataprep status through the real en catalogue', () => {
      // The test above proves the badge is TRANSLATED, and this one proves the
      // translation it asks for is the right one. Those are different claims,
      // and only the first was covered: the suite-wide `$t: (key) => key` mock
      // makes `translate()` treat every key as missing and return its fallback,
      // so pointing a status at ANOTHER status's key left all of them green —
      // while a real build resolved that key to the other label and badged a
      // degraded document as a clean one. That is the visibility this MR added,
      // disappearing silently.
      //
      // So: resolve against the catalogue the app ships, the way vue-i18n does,
      // and assert the badge the user would actually see.
      const en = require('../../i18n/locales/en.js').default;
      const lookup = (key) => key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), en);
      const wrapper = createAdminDashboardWrapper(
        {},
        {
          $i18n: {
            locale: 'en',
            t: (key) => {
              const found = lookup(key);
              return found === undefined ? key : found;
            }
          }
        }
      );

      // Every dataprep status getDisplayStatus maps, and the badge a user sees
      // for it once the catalogue — not the fallback — has answered.
      const expected = {
        pending: 'Pending',
        ingesting: 'Ingesting',
        ingested: 'Ingested',
        'ingested with warnings': 'Ingested with Warnings',
        retracted: 'Retracted',
        'ingestion error': 'Ingestion Error'
      };

      for (const [status, label] of Object.entries(expected)) {
        expect(wrapper.vm.getDisplayStatus({ dataprep: { status } })).toBe(label);
        // Case-insensitively too: the stored status is title-cased by dataprep
        // while the filter option is lower-case, and both reach this function.
        expect(
          wrapper.vm.getDisplayStatus({
            dataprep: { status: status.toUpperCase() }
          })
        ).toBe(label);
      }
    });

    it('interpolates the fallback and passes the locale as a string to t()', () => {
      // vue-i18n's legacy t() takes the locale as a STRING second argument —
      // an object there is parsed as named params, so the locale never reaches
      // the translator and `{n}`-style placeholders render empty. And when the
      // key is missing, the fallback stands in for the translation and must go
      // through the same interpolation, not render literal braces.
      const calls = [];
      const wrapper = createAdminDashboardWrapper(
        {},
        {
          $i18n: {
            locale: 'en',
            t: (key, locale, named) => {
              calls.push([key, locale, named]);
              return key;
            }
          }
        }
      );
      expect(
        wrapper.vm.translate('admin.queryInspector.pageInfo', 'Page {current} of {total}', { current: 2, total: 5 })
      ).toBe('Page 2 of 5');
      // The template's own renders also pass through; assert OUR call's shape,
      // not the first one recorded.
      const mine = calls.find(([key]) => key === 'admin.queryInspector.pageInfo');
      expect(mine).toEqual(['admin.queryInspector.pageInfo', 'en', { current: 2, total: 5 }]);
      // No named params: the fallback renders as-is (no interpolation pass).
      expect(wrapper.vm.translate('admin.queryInspector.search', 'Search')).toBe('Search');
    });

    it('resolves and interpolates through a real vue-i18n instance and the shipped en catalogue', () => {
      // The mock above pins the call SHAPE; this one pins the SEMANTICS:
      // translate() against the vue-i18n build the app actually installs,
      // with the en.js catalogue it actually ships, must interpolate named
      // params — not render them empty (the #1130 regression).
      const { createI18n } = require('vue-i18n');
      const en = require('../../i18n/locales/en.js').default;
      const i18n = createI18n({
        legacy: true,
        locale: 'en',
        fallbackLocale: 'en',
        messages: { en }
      });
      const wrapper = createAdminDashboardWrapper(
        {},
        {
          $i18n: {
            locale: 'en',
            t: (...args) => i18n.global.t(...args)
          }
        }
      );
      expect(
        wrapper.vm.translate('admin.queryInspector.pageInfo', 'Page {current} of {total} ({count} total)', {
          current: 2,
          total: 5,
          count: 48
        })
      ).toBe('Page 2 of 5 (48 total)');
      expect(wrapper.vm.translate('admin.queryInspector.search', 'Search')).toBe('Search');
    });

    it('interpolates the fallback on every miss path, including a throwing $i18n', () => {
      // Every branch that misses the catalogue must come back interpolated —
      // a literal `{current}` brace on screen is the regression. A throwing
      // $i18n lands in the catch branch; an empty named dict falls back to
      // the raw string, and an empty fallback falls back to the key.
      const wrapper = createAdminDashboardWrapper(
        {},
        {
          $i18n: {
            locale: 'en',
            t: () => {
              throw new Error('boom');
            }
          }
        }
      );
      expect(wrapper.vm.translate('admin.queryInspector.pageInfo', 'Page {current}', { current: 3 })).toBe('Page 3');
      expect(wrapper.vm.translate('admin.queryInspector.search', 'Search')).toBe('Search');
      expect(wrapper.vm.translate('admin.queryInspector.search', '', { n: 1 })).toBe('admin.queryInspector.search');
    });

    it('passes an unrecognised dataprep status through unchanged', () => {
      // The translation table is not a gate: a status this build has never
      // heard of must still render, because swallowing it would show "Unknown"
      // for a document that is in fact indexed.
      const wrapper = createAdminDashboardWrapper();
      expect(wrapper.vm.getDisplayStatus({ dataprep: { status: 'Quarantined' } })).toBe('Quarantined');
    });

    it('returns "Unknown" when no dataprep and no crawl job', () => {
      const wrapper = createAdminDashboardWrapper();
      const doc = {};
      expect(wrapper.vm.getDisplayStatus(doc)).toBe('Unknown');
    });

    it('handles crawl_job as array', () => {
      const wrapper = createAdminDashboardWrapper();
      const doc = { crawl_job: [{ status: 'crawling' }] };
      expect(wrapper.vm.getDisplayStatus(doc)).toBe('Crawling');
    });

    it('handles empty crawl_job array', () => {
      const wrapper = createAdminDashboardWrapper();
      const doc = { crawl_job: [], dataprep: { status: 'processing' } };
      expect(wrapper.vm.getDisplayStatus(doc)).toBe('processing');
    });
  });

  // ---------------------------------------------------------------------------
  // getResourceLabel method
  // ---------------------------------------------------------------------------
  describe('getResourceLabel', () => {
    it('returns default label for "cpu"', () => {
      const wrapper = createAdminDashboardWrapper();
      const result = wrapper.vm.getResourceLabel('cpu');
      expect(result).toBe('CPU Usage');
    });

    it('returns default label for "memory"', () => {
      const wrapper = createAdminDashboardWrapper();
      const result = wrapper.vm.getResourceLabel('memory');
      expect(result).toBe('Memory Usage');
    });

    it('returns default label for "storage"', () => {
      const wrapper = createAdminDashboardWrapper();
      const result = wrapper.vm.getResourceLabel('storage');
      expect(result).toBe('Storage Usage');
    });

    it('returns default label for "network"', () => {
      const wrapper = createAdminDashboardWrapper();
      const result = wrapper.vm.getResourceLabel('network');
      expect(result).toBe('Network Bandwidth');
    });

    it('returns raw resourceId for unknown resource', () => {
      const wrapper = createAdminDashboardWrapper();
      const result = wrapper.vm.getResourceLabel('unknown');
      expect(result).toBe('unknown');
    });
  });

  // ---------------------------------------------------------------------------
  // viewDocumentDetails, uploadFiles, addFromLink, refreshDocuments methods
  // ---------------------------------------------------------------------------
  describe('viewDocumentDetails', () => {
    it('sets selectedFileId and showDetailsDialog to true', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.viewDocumentDetails('doc-123');
      expect(wrapper.vm.selectedFileId).toBe('doc-123');
      expect(wrapper.vm.showDetailsDialog).toBe(true);
    });
  });

  describe('uploadFiles', () => {
    it('sets showUploadDialog to true', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.uploadFiles();
      expect(wrapper.vm.showUploadDialog).toBe(true);
    });
  });

  describe('addFromLink', () => {
    it('sets showLinkDialog to true', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.addFromLink();
      expect(wrapper.vm.showLinkDialog).toBe(true);
    });
  });

  describe('refreshDocuments', () => {
    it('calls loadDocuments method', () => {
      const wrapper = createAdminDashboardWrapper();
      const loadDocumentsSpy = jest.spyOn(wrapper.vm, 'loadDocuments').mockImplementation(() => {});
      wrapper.vm.refreshDocuments();
      expect(loadDocumentsSpy).toHaveBeenCalled();
      loadDocumentsSpy.mockRestore();
    });
  });

  // -----------------------------------------------------------------------
  // selectAllDocuments
  // -----------------------------------------------------------------------
  describe('selectAllDocuments', () => {
    it('selects all filtered documents when checked', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.documents = [
        { _key: 'doc-1', file_id: 'doc-1', dataprep: { status: 'ready' } },
        { _key: 'doc-2', file_id: 'doc-2', dataprep: { status: 'pending' } }
      ];
      wrapper.vm.selectAllDocuments({ target: { checked: true } });
      expect(wrapper.vm.selectedDocuments).toEqual(['doc-1', 'doc-2']);
    });

    it('clears selection when unchecked', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.selectedDocuments = ['doc-1'];
      wrapper.vm.selectAllDocuments({ target: { checked: false } });
      expect(wrapper.vm.selectedDocuments).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // handleDocumentPagination
  // -----------------------------------------------------------------------
  describe('handleDocumentPagination', () => {
    it('updates page and reloads documents for valid page', async () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.documentPagination.total = 30;
      wrapper.vm.documentPagination.limit = 15;
      const loadSpy = jest.spyOn(wrapper.vm, 'loadDocuments').mockImplementation(() => {});

      wrapper.vm.handleDocumentPagination(2);

      expect(wrapper.vm.documentPagination.page).toBe(2);
      expect(loadSpy).toHaveBeenCalled();
      loadSpy.mockRestore();
    });

    it('rejects page <= 0', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.documentPagination.page = 1;
      wrapper.vm.handleDocumentPagination(0);
      expect(wrapper.vm.documentPagination.page).toBe(1);
    });

    it('rejects page exceeding total pages', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.documentPagination.total = 15;
      wrapper.vm.documentPagination.limit = 15;
      wrapper.vm.documentPagination.page = 1;
      wrapper.vm.handleDocumentPagination(3);
      expect(wrapper.vm.documentPagination.page).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // cancelHierarchyForm
  // -----------------------------------------------------------------------
  describe('cancelHierarchyForm', () => {
    it('closes form immediately when no unsaved changes', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.hierarchyForm.visible = true;
      wrapper.vm.originalHierarchyFormState = null;

      wrapper.vm.cancelHierarchyForm();

      expect(wrapper.vm.hierarchyForm.visible).toBe(false);
    });

    it('shows confirm dialog when there are unsaved changes', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.hierarchyForm.visible = true;
      wrapper.vm.originalHierarchyFormState = JSON.stringify({ nameEN: 'old' });
      wrapper.vm.hierarchyForm.nameEN = 'changed';

      wrapper.vm.cancelHierarchyForm();

      expect(wrapper.vm.confirmDialogState.visible).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Regression: batch ingest/retract must send file_id (not ArangoDB _key)
  // -----------------------------------------------------------------------
  describe('handleBatchAction sends file_id (not _key) to the API', () => {
    const documentFileService = require('../../services/documentFileService');

    it('ingest: passes file_id values to documentFileService.ingestMultipleFiles', async () => {
      const wrapper = createAdminDashboardWrapper();
      // Real-world shape: ArangoDB _key + semantic file_id are different.
      wrapper.vm.documents = [
        {
          _key: '39933124',
          file_id: '1774623200119_e9887fa8',
          dataprep: { status: 'retracted' }
        },
        {
          _key: '39933120',
          file_id: '1774620171830_9589f57b',
          dataprep: { status: 'retracted' }
        }
      ];
      wrapper.vm.selectedDocuments = ['1774623200119_e9887fa8', '1774620171830_9589f57b'];

      await wrapper.vm.handleBatchAction('ingest');

      // Auto-confirm the dialog
      expect(wrapper.vm.confirmDialogState.visible).toBe(true);
      await wrapper.vm.confirmDialogState.onConfirm();
      // Drain microtasks + finally
      await new Promise((r) => setTimeout(r, 0));

      expect(documentFileService.ingestMultipleFiles).toHaveBeenCalledWith([
        '1774623200119_e9887fa8',
        '1774620171830_9589f57b'
      ]);
    });

    it('retract: passes file_id values to documentFileService.retractMultipleFiles', async () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.documents = [
        {
          _key: '39933124',
          file_id: '1774623200119_e9887fa8',
          dataprep: { status: 'Ingested' }
        },
        {
          _key: '39933120',
          file_id: '1774620171830_9589f57b',
          dataprep: { status: 'Ingested' }
        }
      ];
      wrapper.vm.selectedDocuments = ['1774623200119_e9887fa8', '1774620171830_9589f57b'];

      await wrapper.vm.handleBatchAction('retract');

      expect(wrapper.vm.confirmDialogState.visible).toBe(true);
      await wrapper.vm.confirmDialogState.onConfirm();
      await new Promise((r) => setTimeout(r, 0));

      expect(documentFileService.retractMultipleFiles).toHaveBeenCalledWith([
        '1774623200119_e9887fa8',
        '1774620171830_9589f57b'
      ]);
    });

    // #1042 BATCH DELETE — the Delete Selected button (Document Management).
    it('delete: passes file_id values to documentFileService.deleteMultipleFiles', async () => {
      const documentFileService = require('../../services/documentFileService');
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.documents = [
        { _key: 'a', file_id: 'a-1', dataprep: { status: 'pending' } },
        { _key: 'b', file_id: 'b-1', dataprep: { status: 'retracted' } }
      ];
      wrapper.vm.selectedDocuments = ['a-1', 'b-1'];

      await wrapper.vm.handleBatchAction('delete');
      expect(wrapper.vm.confirmDialogState.visible).toBe(true);
      await wrapper.vm.confirmDialogState.onConfirm();
      await new Promise((r) => setTimeout(r, 0));

      expect(documentFileService.deleteMultipleFiles).toHaveBeenCalledWith(['a-1', 'b-1']);
      // All-success default: selection clears, success toast fires.
      const ok = mockEventBusEmit.mock.calls.find((c) => c[0] === 'notification:show' && c[1].type === 'success');
      expect(ok).toBeTruthy();
      expect(ok[1].message).toMatch(/deleted/i);
      expect(wrapper.vm.selectedDocuments).toEqual([]);
    });

    it('delete: disabled with hover title when any selected file is ingested', async () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.documents = [
        { _key: 'a', file_id: 'a-1', dataprep: { status: 'pending' } },
        { _key: 'b', file_id: 'b-1', dataprep: { status: 'ingested' } }
      ];
      wrapper.vm.selectedDocuments = ['a-1', 'b-1'];

      expect(wrapper.vm.showDeleteButton).toBe(true);
      expect(wrapper.vm.deleteRefuseReason).toMatch(/ingested/i);
      expect(wrapper.vm.deleteRefuseReason).toMatch(/1/);

      // Pure PENDING selection — button enabled, no refuse reason.
      wrapper.vm.documents = [{ _key: 'a', file_id: 'a-1', dataprep: { status: 'pending' } }];
      wrapper.vm.selectedDocuments = ['a-1'];
      expect(wrapper.vm.deleteRefuseReason).toBeNull();
    });

    // 2026-10-10 (live: David selected pending rows to clean up, ONE row had
    // gone Ingesting, the whole batch silently refused via a tooltip-only
    // disabled button — read as "it failed"): a MIXED selection deletes the
    // clean subset and reports the skipped rows instead of refusing.
    it('delete: a mixed selection deletes only the deletable rows and keeps the blocked selected', async () => {
      const documentFileService = require('../../services/documentFileService');
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.documents = [
        { _key: 'a', file_id: 'a-1', dataprep: { status: 'pending' } },
        { _key: 'b', file_id: 'b-1', dataprep: { status: 'pending' } },
        { _key: 'c', file_id: 'c-1', dataprep: { status: 'ingesting' } }
      ];
      wrapper.vm.selectedDocuments = ['a-1', 'b-1', 'c-1'];
      expect(wrapper.vm.deletableSelection).toEqual(['a-1', 'b-1']);
      expect(wrapper.vm.blockedSelection.map((d) => d.file_id)).toEqual(['c-1']);
      expect(wrapper.vm.deleteRefuseReason).toMatch(/1/);

      await wrapper.vm.handleBatchAction('delete');
      expect(wrapper.vm.confirmDialogState.visible).toBe(true);
      // The confirm names what will be skipped.
      expect(wrapper.vm.confirmDialogState.message).toMatch(/SKIPPED/i);
      await wrapper.vm.confirmDialogState.onConfirm();
      await new Promise((r) => setTimeout(r, 0));

      expect(documentFileService.deleteMultipleFiles).toHaveBeenCalledWith(['a-1', 'b-1']);
      // Blocked row STAYS selected (it was not deleted); the deleted rows
      // drop out.
      expect(wrapper.vm.selectedDocuments).toEqual(['c-1']);
      const ok = mockEventBusEmit.mock.calls.find((c) => c[0] === 'notification:show' && c[1].type === 'success');
      expect(ok).toBeTruthy();
    });

    it('delete: all-blocked still refuses outright', async () => {
      const documentFileService = require('../../services/documentFileService');
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.documents = [{ _key: 'c', file_id: 'c-1', dataprep: { status: 'ingested' } }];
      wrapper.vm.selectedDocuments = ['c-1'];
      await wrapper.vm.handleBatchAction('delete');
      expect(wrapper.vm.confirmDialogState.visible).toBe(false);
      expect(documentFileService.deleteMultipleFiles).not.toHaveBeenCalled();
      const err = mockEventBusEmit.mock.calls.find((c) => c[0] === 'notification:show' && c[1].type === 'error');
      expect(err).toBeTruthy();
    });

    it('delete: 403 BUNDLE_PROTECTED surfaces the verbatim backend message', async () => {
      const documentFileService = require('../../services/documentFileService');
      // httpService rejects with the PARSED envelope {status, statusText,
      // data, message} — there is no `.response` on it (round 16, #80118).
      // The old mock used the axios shape and so exercised a dead branch.
      documentFileService.deleteMultipleFiles.mockRejectedValueOnce({
        status: 403,
        statusText: 'Forbidden',
        data: {
          success: false,
          code: 'BUNDLE_PROTECTED',
          error: 'Bundle zips are managed by the OKF lifecycle and cannot be deleted from document management',
          message: 'Bundle zip "x-1" is owned by the OKF repository lifecycle.'
        },
        message: 'Bundle zip "x-1" is owned by the OKF repository lifecycle.'
      });
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.documents = [{ _key: 'x', file_id: 'x-1', dataprep: { status: 'pending' } }];
      wrapper.vm.selectedDocuments = ['x-1'];

      await wrapper.vm.handleBatchAction('delete');
      await wrapper.vm.confirmDialogState.onConfirm();
      await new Promise((r) => setTimeout(r, 0));

      const err = mockEventBusEmit.mock.calls.find((c) => c[0] === 'notification:show' && c[1].type === 'error');
      expect(err).toBeTruthy();
      // Verbatim backend message — not the generic deleteQueuedError
      expect(err[1].message).toMatch(/OKF repository lifecycle/);
    });

    it('delete: a non-bundle envelope rejection falls back to the generic error', async () => {
      const documentFileService = require('../../services/documentFileService');
      documentFileService.deleteMultipleFiles.mockRejectedValueOnce({
        status: 500,
        statusText: 'Internal Server Error',
        data: { success: false, code: 'INTERNAL', message: 'boom' },
        message: 'boom'
      });
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.documents = [{ _key: 'y', file_id: 'y-1', dataprep: { status: 'pending' } }];
      wrapper.vm.selectedDocuments = ['y-1'];

      await wrapper.vm.handleBatchAction('delete');
      await wrapper.vm.confirmDialogState.onConfirm();
      await new Promise((r) => setTimeout(r, 0));

      const err = mockEventBusEmit.mock.calls.find((c) => c[0] === 'notification:show' && c[1].type === 'error');
      expect(err).toBeTruthy();
      // code !== BUNDLE_PROTECTED → the generic branch, never the raw 'boom'
      expect(err[1].message).toMatch(/error occurred during the batch deletion/i);
    });

    it('ingest all-failure: keeps failed selections, error toast, real failureCount', async () => {
      const documentFileService = require('../../services/documentFileService');
      documentFileService.ingestMultipleFiles.mockResolvedValueOnce({
        success: false,
        successCount: 0,
        failureCount: 2,
        results: [
          {
            fileId: '1774623200119_e9887fa8',
            success: false,
            error: 'File metadata not found'
          },
          {
            fileId: '1774620171830_9589f57b',
            success: false,
            error: 'File metadata not found'
          }
        ]
      });

      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.documents = [
        {
          _key: '39933124',
          file_id: '1774623200119_e9887fa8',
          dataprep: { status: 'retracted' }
        },
        {
          _key: '39933120',
          file_id: '1774620171830_9589f57b',
          dataprep: { status: 'retracted' }
        }
      ];
      wrapper.vm.selectedDocuments = ['1774623200119_e9887fa8', '1774620171830_9589f57b'];

      await wrapper.vm.handleBatchAction('ingest');
      await wrapper.vm.confirmDialogState.onConfirm();
      await new Promise((r) => setTimeout(r, 0));

      expect(wrapper.vm.selectedDocuments).toEqual(['1774623200119_e9887fa8', '1774620171830_9589f57b']);
      // showNotification emits via eventBus with {message, type, duration}
      const errEvent = mockEventBusEmit.mock.calls.find((c) => c[0] === 'notification:show' && c[1].type === 'error');
      expect(errEvent).toBeTruthy();
      expect(errEvent[1].message).toMatch(/failed/i);
    });

    it('ingest partial-failure: keeps only failed selections, warning toast', async () => {
      const documentFileService = require('../../services/documentFileService');
      documentFileService.ingestMultipleFiles.mockResolvedValueOnce({
        success: true,
        successCount: 1,
        failureCount: 1,
        results: [
          { fileId: '1774623200119_e9887fa8', success: true },
          {
            fileId: '1774620171830_9589f57b',
            success: false,
            error: 'File has already been ingested'
          }
        ]
      });

      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.documents = [
        {
          _key: '39933124',
          file_id: '1774623200119_e9887fa8',
          dataprep: { status: 'retracted' }
        },
        {
          _key: '39933120',
          file_id: '1774620171830_9589f57b',
          dataprep: { status: 'Ingested' }
        }
      ];
      wrapper.vm.selectedDocuments = ['1774623200119_e9887fa8', '1774620171830_9589f57b'];

      await wrapper.vm.handleBatchAction('ingest');
      await wrapper.vm.confirmDialogState.onConfirm();
      await new Promise((r) => setTimeout(r, 0));

      expect(wrapper.vm.selectedDocuments).toEqual(['1774620171830_9589f57b']);
      const warnEvent = mockEventBusEmit.mock.calls.find(
        (c) => c[0] === 'notification:show' && c[1].type === 'warning'
      );
      expect(warnEvent).toBeTruthy();
    });

    it('ingest all-success: clears selection, success toast', async () => {
      const documentFileService = require('../../services/documentFileService');
      documentFileService.ingestMultipleFiles.mockResolvedValueOnce({
        success: true,
        successCount: 2,
        failureCount: 0,
        results: [
          { fileId: '1774623200119_e9887fa8', success: true },
          { fileId: '1774620171830_9589f57b', success: true }
        ]
      });

      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.documents = [
        {
          _key: '39933124',
          file_id: '1774623200119_e9887fa8',
          dataprep: { status: 'retracted' }
        },
        {
          _key: '39933120',
          file_id: '1774620171830_9589f57b',
          dataprep: { status: 'retracted' }
        }
      ];
      wrapper.vm.selectedDocuments = ['1774623200119_e9887fa8', '1774620171830_9589f57b'];

      await wrapper.vm.handleBatchAction('ingest');
      await wrapper.vm.confirmDialogState.onConfirm();
      await new Promise((r) => setTimeout(r, 0));

      expect(wrapper.vm.selectedDocuments).toEqual([]);
      const okEvent = mockEventBusEmit.mock.calls.find((c) => c[0] === 'notification:show' && c[1].type === 'success');
      expect(okEvent).toBeTruthy();
      expect(okEvent[1].message).toMatch(/2/);
    });
  });

  // -----------------------------------------------------------------------
  // Source-level regression: checkbox :value must be file_id, NOT _key
  // Verifies the actual template binding by string-matching the source.
  // A DOM-level test is brittle here because the AdminDashboard multi-tab
  // layout requires activeTab init + loadDocuments() to render the table.
  // -----------------------------------------------------------------------
  describe('checkbox :value binding (source-level)', () => {
    it('checkbox template binds to doc.file_id, not doc._key', () => {
      const fs = require('fs');
      const path = require('path');
      const source = fs.readFileSync(path.resolve(__dirname, '../../components/AdminDashboard.vue'), 'utf8');
      // Find the row-level checkbox v-model + value binding.
      // Asserts the file_id binding is present and the _key binding is gone.
      const checkboxLineRegex = /<input[^>]*v-model="selectedDocuments"[^>]*>/;
      const match = source.match(checkboxLineRegex);
      expect(match).toBeTruthy();
      expect(match[0]).toMatch(/:value="doc\.file_id"/);
      expect(match[0]).not.toMatch(/:value="doc\._key"/);
    });
  });

  describe('selectAllDocuments uses file_id', () => {
    it('populates selectedDocuments with file_id (not _key) on select-all', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.documents = [
        {
          _key: '39933124',
          file_id: '1774623200119_e9887fa8',
          dataprep: { status: 'retracted' }
        },
        {
          _key: '39933120',
          file_id: '1774620171830_9589f57b',
          dataprep: { status: 'Ingested' }
        }
      ];

      wrapper.vm.selectAllDocuments({ target: { checked: true } });

      expect(wrapper.vm.selectedDocuments).toEqual(['1774623200119_e9887fa8', '1774620171830_9589f57b']);
    });
  });

  describe('showRetractButton computed', () => {
    it('returns false when no documents are selected', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.selectedDocuments = [];
      expect(wrapper.vm.showRetractButton).toBe(false);
    });

    it('returns false when selected documents contain retracted status', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.documents = [{ file_id: 'f1', dataprep: { status: 'retracted' } }];
      wrapper.vm.selectedDocuments = ['f1'];
      expect(wrapper.vm.showRetractButton).toBe(false);
    });

    it('returns false when selected documents contain Title-Case Retracted status', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.documents = [{ file_id: 'f1', dataprep: { status: 'Retracted' } }];
      wrapper.vm.selectedDocuments = ['f1'];
      expect(wrapper.vm.showRetractButton).toBe(false);
    });

    it('returns true when selected documents are all ingested', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.documents = [{ file_id: 'f1', dataprep: { status: 'Ingested' } }];
      wrapper.vm.selectedDocuments = ['f1'];
      expect(wrapper.vm.showRetractButton).toBe(true);
    });

    it('returns false when ANY selected document is retracted', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.documents = [
        { file_id: 'f1', dataprep: { status: 'Ingested' } },
        { file_id: 'f2', dataprep: { status: 'retracted' } }
      ];
      wrapper.vm.selectedDocuments = ['f1', 'f2'];
      expect(wrapper.vm.showRetractButton).toBe(false);
    });
  });

  // okfRepoGate — Story 7.7 amendment: documents still serving the free-form
  // corpus are ALLOWED into a new OKF repository (import succeeds; the new
  // repo's own ingest is gated until they are retracted). Only empty
  // selections and documents already sourced by ANOTHER OKF repo refuse.
  // -----------------------------------------------------------------------
  describe('okfRepoGate (Story 7.7 amendment)', () => {
    // Real documents carry a numeric-ish Arango _key DISTINCT from file_id —
    // the selection holds file_id's (checkbox :value), so the gate must match
    // on file_id. The distinct _key is deliberate: it turns a regression back
    // to _key-matching red (review !622 wave 2, #78639).
    const doc = (fileId, status, okf_repo_id = null) => ({
      _key: 'arango-' + fileId,
      file_id: fileId,
      okf_repo_id,
      dataprep: { status }
    });

    async function gateWith(docs, selected) {
      const wrapper = createAdminDashboardWrapper();
      await wrapper.setData({ documents: docs, selectedDocuments: selected });
      return wrapper.vm.okfRepoGate;
    }

    it('refuses an empty selection', async () => {
      const gate = await gateWith([doc('f1', 'Pending')], []);
      expect(gate).toMatchObject({
        visible: false,
        reasonKey: 'okf.docs.gate.emptySelection',
        warnKey: null
      });
    });

    it('refuses documents already sourced by another OKF repository', async () => {
      const gate = await gateWith([doc('f1', 'Pending', 'r-other')], ['f1']);
      expect(gate).toMatchObject({
        visible: false,
        reasonKey: 'okf.docs.gate.alreadyInOkf',
        warnKey: null
      });
    });

    it('ALLOWS ingested documents — visible with servingWarn and the count', async () => {
      const gate = await gateWith(
        [doc('f1', 'Ingested'), doc('f2', 'Ingested with Warnings'), doc('f3', 'Ingesting')],
        ['f1', 'f2', 'f3']
      );
      expect(gate).toMatchObject({
        visible: true,
        reasonKey: null,
        warnKey: 'okf.docs.gate.servingWarn',
        servingCount: 3
      });
    });

    it('clean (not serving) selection → visible without a warning', async () => {
      const gate = await gateWith(
        [doc('f1', 'Pending'), doc('f2', 'Retracted'), doc('f3', 'Ingestion Error')],
        ['f1', 'f2', 'f3']
      );
      expect(gate).toMatchObject({
        visible: true,
        reasonKey: null,
        warnKey: null,
        servingCount: 0
      });
    });

    it('gate title renders the servingWarn text with the count substituted', async () => {
      const wrapper = createAdminDashboardWrapper();
      await wrapper.setData({
        documents: [doc('f1', 'Ingested')],
        selectedDocuments: ['f1']
      });
      // The factory mocks $t as identity; shadow translate so the {n} template
      // survives to the .replace the computed applies.
      wrapper.vm.translate = (key) => (key === 'okf.docs.gate.servingWarn' ? '{n} docs still serve' : key);
      expect(wrapper.vm.okfGateTitle).toBe('1 docs still serve');
    });

    it('onCreateOkfRepoFromSelection maps the pick by file_id, never the Arango _key (#78640)', async () => {
      const wrapper = createAdminDashboardWrapper();
      await wrapper.setData({
        documents: [
          {
            _key: '101',
            file_id: 'f-101',
            file_name: 'a.pdf',
            dataprep: { status: 'Pending' }
          },
          {
            _key: '102',
            file_id: 'f-102',
            file_name: 'b.pdf',
            dataprep: { status: 'Pending' }
          }
        ],
        selectedDocuments: ['f-101']
      });
      // Spy on the REAL store — replacing $store would break the studio tab's
      // mounted() dispatch when the tab flip mounts it. The slim test store
      // has no okf module; register a stub so StudioDashboard's mounted()
      // fetchRepos resolves instead of throwing.
      wrapper.vm.$store.registerModule('okf', {
        namespaced: true,
        actions: { fetchRepos: () => Promise.resolve({ ok: true }) }
      });
      const commit = jest.spyOn(wrapper.vm.$store, 'commit');
      await wrapper.vm.onCreateOkfRepoFromSelection();
      expect(commit).toHaveBeenCalledWith('okf/setSelection', {
        documents: [{ file_id: 'f-101', file_name: 'a.pdf' }]
      });
    });

    it('?tab=studio cannot bypass a parked OKF flag; legitimate tabs still deep-link (#78641)', async () => {
      window.APP_CONFIG = { okfEnabled: '0' };
      try {
        const wrapper = createAdminDashboardWrapper({}, {}, { QueryInspector: true });
        await wrapper.vm.applyRouteQuery({ tab: 'studio' });
        expect(wrapper.vm.activeTab).not.toBe('studio');
        await wrapper.vm.applyRouteQuery({ tab: 'documents' });
        expect(wrapper.vm.activeTab).toBe('documents');
      } finally {
        delete window.APP_CONFIG;
      }
    });
  });

  // -----------------------------------------------------------------------
  // Story 7.7 deep link — one-shot: opens the FileDetailsDialog on click-
  // navigation, then scrubs ?file= so a REFRESH does not re-open it.
  // -----------------------------------------------------------------------
  describe('applyRouteQuery deep link (one-shot)', () => {
    it('opens the dialog and scrubs ?file= from the URL', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.$router = { replace: jest.fn().mockResolvedValue(undefined) };
      wrapper.vm.applyRouteQuery({ tab: 'documents', file: 'f-9', keep: 'x' });
      expect(wrapper.vm.showDetailsDialog).toBe(true);
      expect(wrapper.vm.selectedFileId).toBe('f-9');
      expect(wrapper.vm.$router.replace).toHaveBeenCalledWith({
        query: { tab: 'documents', keep: 'x' }
      });
    });

    it('tolerates a missing router (unit contexts) without crashing', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.applyRouteQuery({ tab: 'documents', file: 'f-9' });
      expect(wrapper.vm.showDetailsDialog).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Stat tile trends
// ---------------------------------------------------------------------------
// All four tiles used to hardcode their trend — "↑ 0.01%", "↑ 0.2%",
// "↓ 12%", "↑ 15%" — so every operator read the same constant whatever the
// data said. They now render `trends.*` from the /admin/system-health
// payload, and disappear entirely when the backend could not compute one.
describe('stat tile trends come from the payload, not from the template', () => {
  const trendFor = (trends, key, higherIsBetter) => {
    const wrapper = createAdminDashboardWrapper();
    wrapper.vm.trends = trends;
    return wrapper.vm.trend(key, higherIsBetter);
  };

  it('returns null when the trend was not computed — no fabricated number', () => {
    expect(trendFor({ uptime: null }, 'uptime', true)).toBeNull();
  });

  it('a rising metric reads as an upward arrow', () => {
    const t = trendFor({ uptime: 2.5 }, 'uptime', true);
    expect(t.arrow).toBe('↑');
    expect(t.value).toBe('2.50%');
  });

  it('a falling metric reads as a downward arrow', () => {
    expect(trendFor({ responseTime: -12 }, 'responseTime', false).arrow).toBe('↓');
  });

  it('a flat metric is neither up nor down', () => {
    const t = trendFor({ uptime: 0 }, 'uptime', true);
    expect(t.arrow).toBe('→');
    expect(t.className).toBe('trend-up');
  });

  it('colours by whether the direction is good news', () => {
    // Uptime up and MAU up: good news.
    expect(trendFor({ uptime: 1 }, 'uptime', true).className).toBe('trend-up');
    expect(trendFor({ activeUsers: 15 }, 'activeUsers', true).className).toBe('trend-up');
    // Error rate up and response time up: bad news.
    expect(trendFor({ errorRate: 1 }, 'errorRate', false).className).toBe('trend-down');
    expect(trendFor({ responseTime: 12 }, 'responseTime', false).className).toBe('trend-down');
  });

  it('colours a falling error rate and response time as good news', () => {
    expect(trendFor({ errorRate: -1 }, 'errorRate', false).className).toBe('trend-up');
    expect(trendFor({ responseTime: -12 }, 'responseTime', false).className).toBe('trend-up');
  });

  it('strips the sign from the displayed value — the arrow carries it', () => {
    expect(trendFor({ errorRate: -3.456 }, 'errorRate', false).value).toBe('3.46%');
  });

  it('treats a non-numeric payload value as not computed', () => {
    expect(trendFor({ uptime: 'n/a' }, 'uptime', true)).toBeNull();
  });
});

// ─── OKF hand-off relay + deep links (coverage: the must-increase rule) ────
// ─── OKF hand-off relay + deep links (coverage: the must-increase rule) ────
describe('AdminDashboard — crawl→OKF relay and route deep links', () => {
  // StudioDashboard's mounted() needs the okf store module; these tests only
  // exercise the dashboard's own tab switch + event relay, so stub it out.
  const STUBS = { OkfStudioTab: true };

  it('a ?tab=documents&file=<id> deep link opens the details dialog and scrubs the URL once', async () => {
    const replace = jest.fn(() => Promise.resolve());
    const wrapper = createAdminDashboardWrapper({}, { $router: { replace } }, STUBS);
    await wrapper.vm.$nextTick();
    wrapper.vm.applyRouteQuery({ tab: 'documents', file: 'f-42' });
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.activeTab).toBe('documents');
    expect(wrapper.vm.showDetailsDialog).toBe(true);
    expect(wrapper.vm.selectedFileId).toBe('f-42');
    // One-shot: the file param leaves the query so a refresh does not reopen
    expect(replace).toHaveBeenCalledWith({ query: { tab: 'documents' } });
    wrapper.unmount();
  });

  it('?tab=studio cannot reopen a flag-parked OKF pane (#78641)', async () => {
    const prevConfig = window.APP_CONFIG;
    window.APP_CONFIG = { okfEnabled: '0' }; // flag parked — the pane must stay closed
    let wrapper;
    try {
      wrapper = createAdminDashboardWrapper({}, {}, STUBS);
      await wrapper.vm.$nextTick();
      const before = wrapper.vm.activeTab;
      wrapper.vm.applyRouteQuery({ tab: 'studio' });
      expect(wrapper.vm.activeTab).toBe(before); // adminTabs has no studio → ignored
      expect(wrapper.vm.showDetailsDialog).toBe(false);
      // falsy q is a full no-op
      wrapper.vm.applyRouteQuery(null);
      expect(wrapper.vm.activeTab).toBe(before);
    } finally {
      wrapper.unmount();
      window.APP_CONFIG = prevConfig;
    }
  });

  it('relayCreateFromCrawl switches to studio and re-dispatches flagged so it never re-catches itself', async () => {
    const wrapper = createAdminDashboardWrapper({}, {}, STUBS);
    await wrapper.vm.$nextTick();
    const dispatch = jest.spyOn(window, 'dispatchEvent').mockImplementation(() => true);
    await wrapper.vm.relayCreateFromCrawl({
      __wantsStudio: true, // explicit hand-off intent (round 17, #80354)
      detail: { repo_id: 'r1', file_id: 'f1' }
    });
    expect(wrapper.vm.activeTab).toBe('studio');
    // Round 18 (#80478): the dispatch is DEFERRED until OkfStudioTab emits
    // studio-ready (the async chunk may still be loading on first
    // activation — a single $nextTick fired with zero listeners). The stub
    // never emits, so drain the queue the way the real component's
    // 'studio-ready' handler would.
    wrapper.vm.flushPendingStudioEvents();
    const relayed = dispatch.mock.calls[0][0];
    expect(relayed.type).toBe('okf:create-from-crawl');
    expect(relayed.__okfRelayed).toBe(true);
    expect(relayed.detail).toEqual({ repo_id: 'r1', file_id: 'f1' });
    // its own relay is ignored outright
    dispatch.mockClear();
    await wrapper.vm.relayCreateFromCrawl({ __okfRelayed: true, detail: {} });
    expect(dispatch).not.toHaveBeenCalled();
    dispatch.mockRestore();
    wrapper.unmount();
  });

  it('the relay IGNORES the legacy unmarked seed event — no tab teleport on a plain crawl (round 17, #80354)', async () => {
    const wrapper = createAdminDashboardWrapper({}, {}, STUBS);
    await wrapper.vm.$nextTick();
    wrapper.vm.activeTab = 'documents';
    const dispatch = jest.spyOn(window, 'dispatchEvent').mockImplementation(() => true);
    // AddFromLinkDialog's seeding event carries detail but NO marker: it
    // exists to pre-fill an ALREADY-OPEN wizard, not to switch tabs.
    await wrapper.vm.relayCreateFromCrawl({ detail: { file_id: 'f9', url: 'https://x' } });
    expect(wrapper.vm.activeTab).toBe('documents'); // stayed put
    expect(dispatch).not.toHaveBeenCalled(); // nothing re-dispatched
    dispatch.mockRestore();
    wrapper.unmount();
  });
});

// ---------------------------------------------------------------------------
// Round 18 — Studio hand-off handshake (#80478), honest delete counts
// (#80486), mount-time theme persistence (#80483)
// ---------------------------------------------------------------------------
describe('round 18 — studio hand-off + selection + theme', () => {
  const STUBS = { OkfStudioTab: true, OkfModelConfigPanel: true, QueryInspector: true };

  afterEach(() => {
    window.APP_CONFIG = { okfEnabled: '0' };
  });

  // #80478: OkfStudioTab is a defineAsyncComponent — on the FIRST activation
  // the chunk is not cached and one $nextTick resolves before it mounts, so
  // the hand-off events fired with zero listeners. Dispatches must QUEUE
  // until the component emits studio-ready, then drain.
  it('hand-off dispatches queue while the async Studio chunk has not mounted, then drain', async () => {
    window.APP_CONFIG = { okfEnabled: '1' };
    const wrapper = createAdminDashboardWrapper({}, {}, STUBS);
    await wrapper.vm.$nextTick();
    const dispatch = jest.spyOn(window, 'dispatchEvent').mockImplementation(() => true);
    await wrapper.vm.relayCreateFromCrawl({ __wantsStudio: true, detail: { file_id: 'f1' } });
    expect(wrapper.vm.activeTab).toBe('studio');
    // The stubbed OkfStudioTab never emits studio-ready → still queued.
    expect(dispatch).not.toHaveBeenCalled();
    expect(wrapper.vm.pendingStudioEvents).toHaveLength(1);
    // The component mounts and signals readiness → the queue drains.
    wrapper.vm.flushPendingStudioEvents();
    expect(dispatch).toHaveBeenCalledTimes(1);
    const evt = dispatch.mock.calls[0][0];
    expect(evt.type).toBe('okf:create-from-crawl');
    expect(evt.__okfRelayed).toBe(true);
    expect(wrapper.vm.pendingStudioEvents).toHaveLength(0);
    dispatch.mockRestore();
    wrapper.unmount();
  });

  it('a dispatch with the Studio tab already mounted fires immediately (no queue)', async () => {
    window.APP_CONFIG = { okfEnabled: '1' };
    // A TEMPLATE stub (not `true`) so the ref binding materialises once the
    // v-if pane renders — $refs itself is not assignable from outside.
    const wrapper = createAdminDashboardWrapper(
      {},
      {},
      { ...STUBS, OkfStudioTab: { template: '<div class="studio-stub" />' } }
    );
    await wrapper.vm.$nextTick();
    wrapper.vm.activeTab = 'studio';
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.$refs.okfStudioTab).toBeTruthy(); // mounted = listeners live
    const fired = [];
    wrapper.vm.dispatchWhenStudioReady(() => fired.push(1));
    expect(fired).toHaveLength(1);
    expect(wrapper.vm.pendingStudioEvents).toHaveLength(0);
    wrapper.unmount();
  });

  // #80486: blockedSelection only sees LOADED rows — a blocked row hidden by
  // the active filter (or a stale id) must not be promised deletable.
  it('deletableSelection counts only ids present in the loaded documents list', async () => {
    const wrapper = createAdminDashboardWrapper({}, {}, STUBS);
    await wrapper.vm.$nextTick();
    wrapper.vm.documents = [
      { file_id: 'ok', file_name: 'a.md', dataprep: { status: 'parsed' } },
      // serving → blocked (present in the list)
      { file_id: 'blocked', file_name: 'b.md', dataprep: { status: 'ingested' } },
      // blocked but NOT in the loaded list (hidden by the search filter)
      { file_id: 'hidden-blocked', file_name: 'c.md', dataprep: { status: 'ingested' } }
    ];
    wrapper.vm.selectedDocuments = ['ok', 'blocked', 'hidden-blocked', 'stale-id'];
    // Hide c.md from the loaded list (the filter case): remove it.
    wrapper.vm.documents = wrapper.vm.documents.filter((d) => d.file_id !== 'hidden-blocked');
    expect(wrapper.vm.blockedSelection.map((d) => d.file_id)).toEqual(['blocked']);
    expect(wrapper.vm.deletableSelection).toEqual(['ok']);
    wrapper.unmount();
  });

  // #80483: localStorage 'theme' has exactly one writer — applyTheme. The old
  // same-theme early return (the echo guard) also skipped the MOUNT-time
  // call, so a boot with the DOM indicator set but storage empty never
  // persisted and the NEXT boot reverted to light.
  it('mount persists the DOM-indicated theme to localStorage', async () => {
    window.APP_CONFIG = { okfEnabled: '0' };
    localStorage.clear();
    document.documentElement.setAttribute('data-theme', 'dark');
    const wrapper = createAdminDashboardWrapper({}, {}, STUBS);
    await wrapper.vm.$nextTick();
    expect(localStorage.getItem('theme')).toBe('dark');
    document.documentElement.removeAttribute('data-theme');
    wrapper.unmount();
  });

  it('the echo of an applied theme is dropped (no setTheme recursion)', async () => {
    window.APP_CONFIG = { okfEnabled: '0' };
    localStorage.clear();
    const wrapper = createAdminDashboardWrapper({}, {}, STUBS);
    await wrapper.vm.$nextTick();
    const before = localStorage.getItem('theme');
    const setItem = jest.spyOn(Storage.prototype, 'setItem');
    // themeManager.setTheme re-dispatches 'themeChange' with the theme it
    // just applied — the echo must be dropped, not re-applied.
    window.dispatchEvent(new CustomEvent('themeChange', { detail: { theme: before } }));
    await wrapper.vm.$nextTick();
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
    wrapper.unmount();
  });
});
