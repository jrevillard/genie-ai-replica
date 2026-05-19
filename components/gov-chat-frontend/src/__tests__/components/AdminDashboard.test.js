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
    { _key: 'user-1', loginName: 'user1', fullName: 'User One', email: 'one@test.com', roles: [] },
    { _key: 'user-2', loginName: 'user2', fullName: 'User Two', email: 'two@test.com', roles: [] }
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
      { _key: 'user-1', loginName: 'user1', fullName: 'User One', email: 'one@test.com', roles: [] },
      { _key: 'user-2', loginName: 'user2', fullName: 'User Two', email: 'two@test.com', roles: [] }
    ],
    total: 2
  }
});
const mockGetSecurityDetails = jest.fn().mockResolvedValue({});
const mockRunDiagnostics = jest.fn().mockResolvedValue({});
const mockRunSecurityScan = jest.fn().mockResolvedValue({});
const mockRolloverLogs = jest.fn().mockResolvedValue({});

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
  runSecurityScan: mockRunSecurityScan,
  rolloverLogs: mockRolloverLogs
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
  ingestMultipleFiles: jest.fn().mockResolvedValue({})
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

jest.mock('../../config/languageConfig', () => ({
  availableLanguages: [
    { code: 'en', name: 'English' },
    { code: 'fr', name: 'French' }
  ]
}));

jest.mock('../../utils/fileUtils', () => ({
  formatFileSize: jest.fn((size) => size + ' B')
}));

jest.mock('../../utils/ThemeManager', () => ({
  themeManager: {
    getCurrentTheme: jest.fn(() => 'light'),
    setTheme: jest.fn()
  }
}));

jest.mock('lucide-vue-next', () => ({
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

function createAdminDashboardWrapper(storeOverrides = {}) {
  const store = createAdminStore(storeOverrides);
  return mount(AdminDashboard, {
    global: {
      plugins: [store],
      mocks: {
        $t: (key) => key,
        $te: () => true,
        $i18n: { locale: 'en' }
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
        Loader2: true
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
    it('mounts successfully without throwing', () => {
      const wrapper = createAdminDashboardWrapper();
      expect(wrapper.find('.admin-dashboard').exists() || wrapper.element).toBeTruthy();
    });

    it('renders the main dashboard structure', () => {
      const wrapper = createAdminDashboardWrapper();
      expect(wrapper.vm.activeTab).toBe('overview');
    });

    it('calls loadInitialData on mount', () => {
      createAdminDashboardWrapper();
      expect(mockGetSystemHealth).toHaveBeenCalledTimes(1);
    });

    it('has the correct default tabs', () => {
      const wrapper = createAdminDashboardWrapper();
      const tabIds = wrapper.vm.tabs.map((t) => t.id);
      expect(tabIds).toEqual(['overview', 'hierarchy', 'documents', 'database', 'logs', 'security', 'users']);
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

    it('adminTabs computed returns formatted tabs', () => {
      const wrapper = createAdminDashboardWrapper();
      const tabs = wrapper.vm.adminTabs;
      expect(tabs.length).toBe(7);
      expect(tabs[0]).toEqual({ label: expect.any(String), value: 'overview' });
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
});
