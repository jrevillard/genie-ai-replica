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

    it('initializes all eight admin tabs', () => {
      const wrapper = createAdminDashboardWrapper();
      const tabIds = wrapper.vm.tabs.map((t) => t.id);
      expect(tabIds).toEqual([
        'overview',
        'hierarchy',
        'documents',
        'database',
        'logs',
        'queryInspector',
        'security',
        'users'
      ]);
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
      expect(tabs.length).toBe(8);
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
      wrapper.vm.documents = [{ _key: 'doc-1', dataprep: { status: 'ingested' } }];
      wrapper.vm.selectedDocuments = ['doc-1'];

      expect(wrapper.vm.showIngestButton).toBe(false);
    });

    it('returns true when selected documents are not ingested', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.documents = [{ _key: 'doc-1', dataprep: { status: 'ready' } }];
      wrapper.vm.selectedDocuments = ['doc-1'];

      expect(wrapper.vm.showIngestButton).toBe(true);
    });

    it('returns false when any selected document has ingested status', () => {
      const wrapper = createAdminDashboardWrapper();
      wrapper.vm.documents = [
        { _key: 'doc-1', dataprep: { status: 'ready' } },
        { _key: 'doc-2', dataprep: { status: 'ingested' } }
      ];
      wrapper.vm.selectedDocuments = ['doc-1', 'doc-2'];

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
      const results = [{ id: 'log-1', message: 'test', level: 'INFO', time: '12:00', service: 'api' }];
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

    it('extracts ERROR type from "[ERROR]: something went wrong"', () => {
      const wrapper = createAdminDashboardWrapper();
      const result = wrapper.vm.parseLogMessage('[ERROR]: something went wrong');
      expect(result).toEqual({ type: 'ERROR', message: 'something went wrong' });
    });

    it('extracts INFO type from "[INFO] status update" (no colon after bracket)', () => {
      const wrapper = createAdminDashboardWrapper();
      const result = wrapper.vm.parseLogMessage('[INFO] status update');
      expect(result).toEqual({ type: 'INFO', message: 'status update' });
    });

    it('defaults to INFO type for plain string without prefix', () => {
      const wrapper = createAdminDashboardWrapper();
      const result = wrapper.vm.parseLogMessage('plain log message');
      expect(result).toEqual({ type: 'INFO', message: 'plain log message' });
    });

    it('handles "[WARNING]:" format correctly', () => {
      const wrapper = createAdminDashboardWrapper();
      const result = wrapper.vm.parseLogMessage('[WARNING]: this is a warning');
      expect(result).toEqual({ type: 'WARNING', message: 'this is a warning' });
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

    it('falls back to dataprep.status when no crawl job', () => {
      const wrapper = createAdminDashboardWrapper();
      const doc = { dataprep: { status: 'ingested' } };
      expect(wrapper.vm.getDisplayStatus(doc)).toBe('ingested');
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
        { _key: 'doc-1', dataprep: { status: 'ready' } },
        { _key: 'doc-2', dataprep: { status: 'pending' } }
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
});
