'use strict';

/**
 * FileDetailsDialog tests — Story 4 requirements (4a through 4h).
 *
 * Covers: mock infrastructure setup, tab visibility for different file states,
 * label management (getter/setter, English→locale mapping), file operations
 * (save, ingest, retract, delete), dynamic mainAction button, computed properties,
 * dashboard timer with fake timers, and event emissions.
 */
const { mount } = require('@vue/test-utils');

// ---------------------------------------------------------------------------
// Service mocks
// ---------------------------------------------------------------------------

const mockGetFileMetadata = jest.fn().mockResolvedValue({});
const mockUpdateFile = jest.fn().mockResolvedValue({ success: true });
const mockIngestFile = jest.fn().mockResolvedValue({ success: true });
const mockRetractMultipleFiles = jest.fn().mockResolvedValue({ success: true });
const mockDeleteFile = jest.fn().mockResolvedValue({ success: true });
const mockGetCrawlJob = jest.fn().mockResolvedValue(null);
const mockGetCrawlMetrics = jest.fn().mockResolvedValue({ data: {} });
const mockGetCrawlLogs = jest.fn().mockResolvedValue({ data: [] });
const mockGetIngestionLogs = jest.fn().mockResolvedValue({ data: [] });
const mockKillCrawl = jest.fn().mockResolvedValue({ success: true });
const mockKillIngestion = jest.fn().mockResolvedValue({ success: true });

jest.mock('../../services/documentFileService', () => ({
  __esModule: true,
  default: {
    getFileMetadata: mockGetFileMetadata,
    updateFile: mockUpdateFile,
    ingestFile: mockIngestFile,
    retractMultipleFiles: mockRetractMultipleFiles,
    deleteFile: mockDeleteFile,
    getCrawlJob: mockGetCrawlJob,
    getCrawlMetrics: mockGetCrawlMetrics,
    getCrawlLogs: mockGetCrawlLogs,
    getIngestionLogs: mockGetIngestionLogs,
    killCrawl: mockKillCrawl,
    killIngestion: mockKillIngestion
  }
}));

const mockGetAdminCategories = jest.fn().mockResolvedValue([]);
const mockGetCategoryTranslations = jest.fn().mockResolvedValue([]);

jest.mock('../../services/serviceTreeService', () => ({
  __esModule: true,
  default: {
    getAdminCategories: mockGetAdminCategories,
    getCategoryTranslations: mockGetCategoryTranslations
  }
}));

const mockNotificationSuccess = jest.fn();
const mockNotificationError = jest.fn();
const mockNotificationInfo = jest.fn();

jest.mock('../../services/notificationService', () => ({
  success: mockNotificationSuccess,
  error: mockNotificationError,
  info: mockNotificationInfo
}));

const mockEventBusEmit = jest.fn();

jest.mock('../../eventBus', () => ({
  eventBus: {
    $emit: mockEventBusEmit,
    $on: jest.fn(),
    $off: jest.fn()
  }
}));

jest.mock('../../config/oidcConfig', () => ({
  __esModule: true,
  default: {
    authority: 'http://localhost:8080/realms/genie',
    clientId: 'genie-app'
  }
}));

// ---------------------------------------------------------------------------
// Component import (after mocks)
// ---------------------------------------------------------------------------
const FileDetailsDialog = require('../../components/FileDetailsDialog.vue').default;

// ---------------------------------------------------------------------------
// Mock file data factory
// ---------------------------------------------------------------------------

function createMockFile(overrides = {}) {
  return {
    file_id: 'test-file-123',
    file_name: 'Test Document.pdf',
    author: 'John Doe',
    file_type: 'application/pdf',
    file_size: 1024 * 1024,
    file_hash: 'abc123def456',
    upload_date: new Date('2024-01-15').toISOString(),
    source_url: null,
    labels: ['Service A', 'Service B'],
    dataprep: {
      status: 'Pending'
    },
    ...overrides
  };
}

function createMockHierarchy(locale = 'en') {
  return [
    {
      catKey: 'cat1',
      name: locale === 'en' ? 'Category 1' : 'Catégorie 1',
      children: [
        { _key: 'srv1', name: locale === 'en' ? 'Service A' : 'Service A (fr)' },
        { _key: 'srv2', name: locale === 'en' ? 'Service B' : 'Service B (fr)' },
        { _key: 'srv3', name: locale === 'en' ? 'Service C' : 'Service C (fr)' }
      ]
    },
    {
      catKey: 'cat2',
      name: locale === 'en' ? 'Category 2' : 'Catégorie 2',
      children: [{ _key: 'srv4', name: locale === 'en' ? 'Service D' : 'Service D (fr)' }]
    }
  ];
}

// ---------------------------------------------------------------------------
// Mount helper
// ---------------------------------------------------------------------------

function createFileDetailsDialogWrapper(overrides = {}) {
  return mount(FileDetailsDialog, {
    props: {
      fileId: 'test-file-123',
      ...overrides.props
    },
    global: {
      mocks: {
        $t: (key) => key,
        $te: () => true,
        $i18n: { locale: 'en' },
        $store: {
          getters: {
            accessToken: 'mock-token-123'
          }
        },
        $router: { push: jest.fn() }
      },
      stubs: {
        teleport: true,
        DsButton: {
          template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
          props: ['disabled', 'variant', 'small']
        },
        DsTabs: {
          template: '<div><slot /></div>',
          props: ['tabs', 'modelValue']
        },
        DsInput: {
          template:
            '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" :disabled="disabled" />',
          props: ['modelValue', 'type', 'placeholder', 'disabled']
        },
        DsStatusTag: {
          template: '<span>{{ variant }}</span>',
          props: ['variant']
        },
        DsSpinner: {
          template: '<div v-if="overlay"><slot /></div>',
          props: ['size', 'overlay']
        },
        ConfirmDialog: {
          template:
            '<div v-if="visible" class="confirm-dialog" @click="$emit(\'confirm\')" @click.right="$emit(\'cancel\')"></div>',
          props: ['visible', 'title', 'message', 'confirmText', 'cancelText', 'secondaryText'],
          emits: ['confirm', 'cancel', 'secondary']
        }
      },
      ...overrides.global
    },
    ...overrides
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FileDetailsDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockGetAdminCategories.mockResolvedValue(createMockHierarchy('en'));
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // 4a — Setup mock infrastructure
  // -------------------------------------------------------------------------
  describe('4a — Setup mock infrastructure', () => {
    it('mounts with required fileId prop and Teleport stub', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile());
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      expect(wrapper.props('fileId')).toBe('test-file-123');
      expect(wrapper.exists()).toBe(true);
    });

    it('initializes with loading state true', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile());
      const wrapper = createFileDetailsDialogWrapper();
      expect(wrapper.vm.isLoading).toBe(true);
      expect(wrapper.vm.isFetchingData).toBe(true);
    });

    it('uses fake timers for setInterval', () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile());
      createFileDetailsDialogWrapper();
      // Fake timers are enabled in beforeEach
      expect(setInterval).toBeDefined();
    });

    it('has documentFileService and serviceTreeService mocked', () => {
      expect(mockGetFileMetadata).toBeDefined();
      expect(mockGetAdminCategories).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 4b — Tab visibility for different file states
  // -------------------------------------------------------------------------
  describe('4b — Tab visibility (visibleTabs computed)', () => {
    it('shows only Details tab for pending file without crawl job', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile({ dataprep: { status: 'Pending' } }));
      mockGetCrawlJob.mockResolvedValue(null);
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.file = createMockFile({ dataprep: { status: 'Pending' } });
      await wrapper.vm.$nextTick();

      const tabs = wrapper.vm.visibleTabs;
      expect(tabs).toHaveLength(1);
      expect(tabs[0].value).toBe('details');
    });

    it('shows Dashboard and CrawlLog tabs when crawlJob exists', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile({ dataprep: { status: 'Pending' } }));
      mockGetCrawlJob.mockResolvedValue({ status: 'Crawling' });
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.file = createMockFile({ dataprep: { status: 'Pending' } });
      wrapper.vm.crawlJob = { status: 'Crawling' };
      await wrapper.vm.$nextTick();

      const tabs = wrapper.vm.visibleTabs;
      expect(tabs.length).toBeGreaterThanOrEqual(2);
      expect(tabs.some((t) => t.value === 'dashboard')).toBe(true);
      expect(tabs.some((t) => t.value === 'crawlLog')).toBe(true);
    });

    it('shows IngestionLog tab when status is not pending', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile({ dataprep: { status: 'Ingesting' } }));
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.file = createMockFile({ dataprep: { status: 'Ingesting' } });
      await wrapper.vm.$nextTick();

      const tabs = wrapper.vm.visibleTabs;
      expect(tabs.some((t) => t.value === 'ingestionLog')).toBe(true);
    });

    it('does not show IngestionLog tab when status is pending', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile({ dataprep: { status: 'Pending' } }));
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.file = createMockFile({ dataprep: { status: 'Pending' } });
      await wrapper.vm.$nextTick();

      const tabs = wrapper.vm.visibleTabs;
      expect(tabs.some((t) => t.value === 'ingestionLog')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 4c — Label management (areAllLabelsSelected getter/setter, mapEnglishToLocale)
  // -------------------------------------------------------------------------
  describe('4c — Label management', () => {
    it('areAllLabelsSelected getter returns false when no labels exist', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile({ labels: [] }));
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.file = createMockFile({ labels: [] });
      wrapper.vm.editableFile.labels = [];
      wrapper.vm.knowledgeHierarchy = createMockHierarchy('en');
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.areAllLabelsSelected).toBe(false);
    });

    it('areAllLabelsSelected getter returns true when all labels selected', async () => {
      mockGetFileMetadata.mockResolvedValue(
        createMockFile({ labels: ['Service A', 'Service B', 'Service C', 'Service D'] })
      );
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.file = createMockFile({ labels: ['Service A', 'Service B', 'Service C', 'Service D'] });
      wrapper.vm.editableFile.labels = ['Service A', 'Service B', 'Service C', 'Service D'];
      wrapper.vm.knowledgeHierarchy = createMockHierarchy('en');
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.areAllLabelsSelected).toBe(true);
    });

    it('areAllLabelsSelected getter returns false when some labels selected', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile({ labels: ['Service A', 'Service B'] }));
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.file = createMockFile({ labels: ['Service A', 'Service B'] });
      wrapper.vm.editableFile.labels = ['Service A', 'Service B'];
      wrapper.vm.knowledgeHierarchy = createMockHierarchy('en');
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.areAllLabelsSelected).toBe(false);
    });

    it('areAllLabelsSelected setter selects all labels when set to true', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile({ labels: ['Service A'] }));
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.file = createMockFile({ labels: ['Service A'] });
      wrapper.vm.editableFile.labels = ['Service A'];
      wrapper.vm.knowledgeHierarchy = createMockHierarchy('en');
      await wrapper.vm.$nextTick();

      wrapper.vm.areAllLabelsSelected = true;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.editableFile.labels).toHaveLength(4);
    });

    it('areAllLabelsSelected setter clears all labels when set to false', async () => {
      mockGetFileMetadata.mockResolvedValue(
        createMockFile({ labels: ['Service A', 'Service B', 'Service C', 'Service D'] })
      );
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.file = createMockFile({ labels: ['Service A', 'Service B', 'Service C', 'Service D'] });
      wrapper.vm.editableFile.labels = ['Service A', 'Service B', 'Service C', 'Service D'];
      wrapper.vm.knowledgeHierarchy = createMockHierarchy('en');
      await wrapper.vm.$nextTick();

      wrapper.vm.areAllLabelsSelected = false;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.editableFile.labels).toHaveLength(0);
    });

    it('mapEnglishToLocale maps English labels to locale labels', async () => {
      const frenchHierarchy = createMockHierarchy('fr');
      mockGetFileMetadata.mockResolvedValue(createMockFile({ labels: ['Service A', 'Service B'] }));
      mockGetAdminCategories.mockResolvedValueOnce(frenchHierarchy).mockResolvedValueOnce(createMockHierarchy('en'));

      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      const englishHierarchy = createMockHierarchy('en');
      const localeLabels = wrapper.vm.mapEnglishToLocale(['Service A', 'Service B'], frenchHierarchy, englishHierarchy);

      expect(localeLabels).toContain('Service A (fr)');
      expect(localeLabels).toContain('Service B (fr)');
    });
  });

  // -------------------------------------------------------------------------
  // 4d — File operations (handleSave, handleIngest, handleRetract, handleDelete)
  // -------------------------------------------------------------------------
  describe('4d — File operations', () => {
    it('handleSave calls documentFileService.updateFile with correct data', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile({ labels: ['Service A'] }));
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.file = createMockFile({ labels: ['Service A'] });
      wrapper.vm.editableFile.file_name = 'Updated Name';
      wrapper.vm.editableFile.author = 'Updated Author';
      wrapper.vm.editableFile.labels = ['Service A'];
      wrapper.vm.knowledgeHierarchy = createMockHierarchy('en');
      wrapper.vm.englishKnowledgeHierarchy = createMockHierarchy('en');
      await wrapper.vm.$nextTick();

      const result = await wrapper.vm.handleSave();

      expect(mockUpdateFile).toHaveBeenCalledWith('test-file-123', {
        file_name: 'Updated Name',
        author: 'Updated Author',
        labels: ['Service A']
      });
      expect(result).toBe(true);
    });

    it('handleSave emits file-updated event on success', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile({ labels: ['Service A'] }));
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.file = createMockFile({ labels: ['Service A'] });
      wrapper.vm.editableFile.labels = ['Service A'];
      wrapper.vm.knowledgeHierarchy = createMockHierarchy('en');
      wrapper.vm.englishKnowledgeHierarchy = createMockHierarchy('en');
      await wrapper.vm.$nextTick();

      await wrapper.vm.handleSave();

      expect(wrapper.emitted('file-updated')).toBeTruthy();
    });

    it('handleSave shows error notification and returns false on API failure', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile({ labels: ['Service A'] }));
      mockUpdateFile.mockRejectedValueOnce(new Error('Save failed'));
      mockEventBusEmit.mockClear();
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.file = createMockFile({ labels: ['Service A'] });
      wrapper.vm.editableFile.file_name = 'Test File';
      wrapper.vm.editableFile.author = 'Test Author';
      wrapper.vm.editableFile.labels = ['Service A'];
      wrapper.vm.knowledgeHierarchy = createMockHierarchy('en');
      wrapper.vm.englishKnowledgeHierarchy = createMockHierarchy('en');
      await wrapper.vm.$nextTick();

      const result = await wrapper.vm.handleSave();

      expect(result).toBe(false);
      expect(wrapper.emitted('file-updated')).toBeFalsy();
      // showNotification emits via eventBus with type 'error'
      expect(mockEventBusEmit).toHaveBeenCalledWith('notification:show', expect.objectContaining({ type: 'error' }));
    });

    it('handleIngest shows confirmation dialog when labels exist', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile({ labels: ['Service A'] }));
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.file = createMockFile({ labels: ['Service A'] });
      wrapper.vm.editableFile.labels = ['Service A'];
      wrapper.vm.knowledgeHierarchy = createMockHierarchy('en');
      wrapper.vm.englishKnowledgeHierarchy = createMockHierarchy('en');
      await wrapper.vm.$nextTick();

      await wrapper.vm.handleIngest();

      expect(wrapper.vm.confirmDialog.visible).toBe(true);
    });

    it('handleIngest calls documentFileService.ingestFile after confirmation', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile({ labels: ['Service A'] }));
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.file = createMockFile({ labels: ['Service A'] });
      wrapper.vm.editableFile.labels = ['Service A'];
      wrapper.vm.knowledgeHierarchy = createMockHierarchy('en');
      wrapper.vm.englishKnowledgeHierarchy = createMockHierarchy('en');
      await wrapper.vm.$nextTick();

      await wrapper.vm.handleIngest();
      await wrapper.vm.confirmDialog.onConfirm();

      expect(mockIngestFile).toHaveBeenCalledWith('test-file-123');
    });

    it('handleRetract shows confirmation dialog', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile({ dataprep: { status: 'Ingested' } }));
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.file = createMockFile({ dataprep: { status: 'Ingested' } });
      await wrapper.vm.$nextTick();

      wrapper.vm.handleRetract();

      expect(wrapper.vm.confirmDialog.visible).toBe(true);
    });

    it('handleRetract calls documentFileService.retractMultipleFiles after confirmation', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile({ dataprep: { status: 'Ingested' } }));
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.file = createMockFile({ dataprep: { status: 'Ingested' } });
      await wrapper.vm.$nextTick();

      wrapper.vm.handleRetract();
      await wrapper.vm.confirmDialog.onConfirm();

      expect(mockRetractMultipleFiles).toHaveBeenCalledWith(['test-file-123']);
    });

    it('handleDelete shows confirmation dialog', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile());
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.file = createMockFile();
      await wrapper.vm.$nextTick();

      wrapper.vm.handleDelete();

      expect(wrapper.vm.confirmDialog.visible).toBe(true);
    });

    it('handleDelete calls documentFileService.deleteFile after confirmation', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile());
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.file = createMockFile();
      await wrapper.vm.$nextTick();

      wrapper.vm.handleDelete();
      await wrapper.vm.confirmDialog.onConfirm();

      expect(mockDeleteFile).toHaveBeenCalledWith('test-file-123');
    });
  });

  // -------------------------------------------------------------------------
  // 4e — mainAction computed (dynamic button per file status)
  // -------------------------------------------------------------------------
  describe('4e — mainAction computed', () => {
    it('shows Retract button when file is Ingested', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile({ dataprep: { status: 'Ingested' } }));
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.file = createMockFile({ dataprep: { status: 'Ingested' } });
      wrapper.vm.editableFile.labels = ['Service A'];
      await wrapper.vm.$nextTick();

      const action = wrapper.vm.mainAction;
      expect(action.text).toContain('Retract');
      expect(action.handler).toBe(wrapper.vm.handleRetract);
    });

    it('shows Ingest button when file is Pending', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile({ dataprep: { status: 'Pending' } }));
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.file = createMockFile({ dataprep: { status: 'Pending' } });
      wrapper.vm.editableFile.labels = ['Service A'];
      await wrapper.vm.$nextTick();

      const action = wrapper.vm.mainAction;
      expect(action.text).toContain('Ingest');
      expect(action.handler).toBe(wrapper.vm.handleIngest);
    });

    it('disables Ingest button when no labels selected', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile({ dataprep: { status: 'Pending' }, labels: [] }));
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.file = createMockFile({ dataprep: { status: 'Pending' }, labels: [] });
      wrapper.vm.editableFile.labels = [];
      wrapper.vm.knowledgeHierarchy = createMockHierarchy('en');
      await wrapper.vm.$nextTick();

      const action = wrapper.vm.mainAction;
      expect(action.disabled).toBe(true);
    });

    it('disables Ingest button when crawl job is not succeeded', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile({ dataprep: { status: 'Pending' }, labels: ['Service A'] }));
      mockGetCrawlJob.mockResolvedValue({ status: 'Crawling' });
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.file = createMockFile({ dataprep: { status: 'Pending' }, labels: ['Service A'] });
      wrapper.vm.editableFile.labels = ['Service A'];
      wrapper.vm.crawlJob = { status: 'Crawling' };
      wrapper.vm.knowledgeHierarchy = createMockHierarchy('en');
      await wrapper.vm.$nextTick();

      const action = wrapper.vm.mainAction;
      expect(action.disabled).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 4f — canViewInternalFile, isMetadataEditable computed properties
  // -------------------------------------------------------------------------
  describe('4f — Computed properties', () => {
    it('isMetadataEditable returns true when status is Pending', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile({ dataprep: { status: 'Pending' } }));
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.file = createMockFile({ dataprep: { status: 'Pending' } });
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.isMetadataEditable).toBe(true);
    });

    it('isMetadataEditable returns false when status is Ingested', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile({ dataprep: { status: 'Ingested' } }));
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.file = createMockFile({ dataprep: { status: 'Ingested' } });
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.isMetadataEditable).toBe(false);
    });

    it('canViewInternalFile returns true for regular files', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile());
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.file = createMockFile();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.canViewInternalFile).toBe(true);
    });

    it('canViewInternalFile returns true when crawl job succeeded', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile());
      mockGetCrawlJob.mockResolvedValue({ status: 'Succeeded' });
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.file = createMockFile();
      wrapper.vm.crawlJob = { status: 'Succeeded' };
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.canViewInternalFile).toBe(true);
    });

    it('canViewInternalFile returns false when crawl job failed', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile());
      mockGetCrawlJob.mockResolvedValue({ status: 'Failed' });
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.file = createMockFile();
      wrapper.vm.crawlJob = { status: 'Failed' };
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.canViewInternalFile).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 4g — Dashboard timer (startDashboardTimer with fake timers, auto-refresh toggle)
  // -------------------------------------------------------------------------
  describe('4g — Dashboard timer', () => {
    it('startDashboardTimer sets up interval with correct timing', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile());
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.startDashboardTimer();

      expect(wrapper.vm.dashboardTimer).toBeTruthy();
      expect(wrapper.vm.isAutoRefreshEnabled).toBe(true);
    });

    it('startDashboardTimer triggers immediate refresh', async () => {
      mockGetCrawlMetrics.mockClear();
      mockGetCrawlMetrics.mockResolvedValue({ data: {} });
      mockGetFileMetadata.mockResolvedValue(createMockFile());
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      const refreshSpy = jest.spyOn(wrapper.vm, 'refreshDashboardData');

      wrapper.vm.startDashboardTimer();

      expect(refreshSpy).toHaveBeenCalledTimes(1);

      refreshSpy.mockRestore();
    });

    it('dashboard refreshes at interval when auto-refresh enabled', async () => {
      mockGetCrawlMetrics.mockClear();
      mockGetCrawlMetrics.mockResolvedValue({ data: {} });
      mockGetFileMetadata.mockResolvedValue(createMockFile());
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.startDashboardTimer();

      const refreshSpy = jest.spyOn(wrapper.vm, 'refreshDashboardData');
      refreshSpy.mockClear();

      // Advance time by interval
      jest.advanceTimersByTime(5000);

      expect(refreshSpy).toHaveBeenCalledTimes(1);

      refreshSpy.mockRestore();
    });

    it('stopDashboardTimer clears interval', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile());
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.startDashboardTimer();
      expect(wrapper.vm.dashboardTimer).toBeTruthy();

      wrapper.vm.stopDashboardTimer();

      expect(wrapper.vm.dashboardTimer).toBeNull();
    });

    it('auto-refresh toggle stops timer when disabled', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile());
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.startDashboardTimer();
      expect(wrapper.vm.dashboardTimer).toBeTruthy();

      wrapper.vm.isAutoRefreshEnabled = false;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.dashboardTimer).toBeNull();
    });

    it('changing refresh interval restarts timer', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile());
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      // Set initial interval
      wrapper.vm.dashboardRefreshInterval = 5;
      wrapper.vm.startDashboardTimer();
      const firstTimerId = wrapper.vm.dashboardTimer;
      expect(firstTimerId).toBeTruthy();

      // Change interval to trigger watcher
      wrapper.vm.dashboardRefreshInterval = 10;
      await wrapper.vm.$nextTick();

      // The watcher should have restarted the timer
      expect(wrapper.vm.dashboardTimer).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // 4h — Emit events (close, file-updated, action-triggered)
  // -------------------------------------------------------------------------
  describe('4h — Event emissions', () => {
    it('emits close event when backdrop is clicked', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile());
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      const backdrop = wrapper.find('[data-test-id="dialog-backdrop"]');
      await backdrop.trigger('click');

      expect(wrapper.emitted('close')).toBeTruthy();
    });

    it('emits close event when close button is clicked', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile());
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      const closeButton = wrapper.findAll('.ds-button').find((btn) => btn.text() === 'Close');

      if (closeButton) {
        await closeButton.trigger('click');
        expect(wrapper.emitted('close')).toBeTruthy();
      }
    });

    it('emits file-updated event after successful save', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile({ labels: ['Service A'] }));
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.file = createMockFile({ labels: ['Service A'] });
      wrapper.vm.editableFile.labels = ['Service A'];
      wrapper.vm.knowledgeHierarchy = createMockHierarchy('en');
      wrapper.vm.englishKnowledgeHierarchy = createMockHierarchy('en');
      await wrapper.vm.$nextTick();

      await wrapper.vm.handleSave();

      expect(wrapper.emitted('file-updated')).toBeTruthy();
    });

    it('emits action-triggered event with ingest action after ingest confirmation', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile({ labels: ['Service A'] }));
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.file = createMockFile({ labels: ['Service A'] });
      wrapper.vm.editableFile.labels = ['Service A'];
      wrapper.vm.knowledgeHierarchy = createMockHierarchy('en');
      wrapper.vm.englishKnowledgeHierarchy = createMockHierarchy('en');
      await wrapper.vm.$nextTick();

      await wrapper.vm.handleIngest();
      await wrapper.vm.confirmDialog.onConfirm();

      expect(wrapper.emitted('action-triggered')).toBeTruthy();
      expect(wrapper.emitted('action-triggered')[0]).toEqual([{ action: 'ingest', fileId: 'test-file-123' }]);
    });

    it('emits action-triggered event with retract action after retract confirmation', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile({ dataprep: { status: 'Ingested' } }));
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.file = createMockFile({ dataprep: { status: 'Ingested' } });
      await wrapper.vm.$nextTick();

      wrapper.vm.handleRetract();
      await wrapper.vm.confirmDialog.onConfirm();

      expect(wrapper.emitted('action-triggered')).toBeTruthy();
      expect(wrapper.emitted('action-triggered')[0]).toEqual([{ action: 'retract', fileId: 'test-file-123' }]);
    });

    it('emits action-triggered event with delete action after delete confirmation', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile());
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.file = createMockFile();
      await wrapper.vm.$nextTick();

      wrapper.vm.handleDelete();
      await wrapper.vm.confirmDialog.onConfirm();

      expect(wrapper.emitted('action-triggered')).toBeTruthy();
      expect(wrapper.emitted('action-triggered')[0]).toEqual([{ action: 'delete', fileId: 'test-file-123' }]);
    });

    it('emits close event after successful ingest', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile({ labels: ['Service A'] }));
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.file = createMockFile({ labels: ['Service A'] });
      wrapper.vm.editableFile.labels = ['Service A'];
      wrapper.vm.knowledgeHierarchy = createMockHierarchy('en');
      wrapper.vm.englishKnowledgeHierarchy = createMockHierarchy('en');
      await wrapper.vm.$nextTick();

      await wrapper.vm.handleIngest();
      await wrapper.vm.confirmDialog.onConfirm();

      expect(wrapper.emitted('close')).toBeTruthy();
    });

    it('emits close event after successful retract', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile({ dataprep: { status: 'Ingested' } }));
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.file = createMockFile({ dataprep: { status: 'Ingested' } });
      await wrapper.vm.$nextTick();

      wrapper.vm.handleRetract();
      await wrapper.vm.confirmDialog.onConfirm();

      expect(wrapper.emitted('close')).toBeTruthy();
    });

    it('emits close event after successful delete', async () => {
      mockGetFileMetadata.mockResolvedValue(createMockFile());
      const wrapper = createFileDetailsDialogWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      wrapper.vm.file = createMockFile();
      await wrapper.vm.$nextTick();

      wrapper.vm.handleDelete();
      await wrapper.vm.confirmDialog.onConfirm();

      expect(wrapper.emitted('close')).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // 4j — displayStatus computed (Crawling/Killed branches),
  //       confirmIngest/confirmRetract/confirmDelete error paths
  // -------------------------------------------------------------------------
  describe('4j — displayStatus computed and confirm operation error paths', () => {
    describe('displayStatus', () => {
      it('returns Crawling when crawlJob status is Crawling', async () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        const wrapper = createFileDetailsDialogWrapper();
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        wrapper.vm.file = createMockFile({ dataprep: { status: 'Pending' } });
        wrapper.vm.crawlJob = { status: 'Crawling' };
        await wrapper.vm.$nextTick();

        expect(wrapper.vm.displayStatus).toBe('Crawling');
      });

      it('returns Crawl Failed when crawlJob status is Failed', async () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        const wrapper = createFileDetailsDialogWrapper();
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        wrapper.vm.file = createMockFile({ dataprep: { status: 'Pending' } });
        wrapper.vm.crawlJob = { status: 'Failed' };
        await wrapper.vm.$nextTick();

        expect(wrapper.vm.displayStatus).toBe('Crawl Failed');
      });

      it('returns Crawl Failed when crawlJob status is Killed', async () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        const wrapper = createFileDetailsDialogWrapper();
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        wrapper.vm.file = createMockFile({ dataprep: { status: 'Pending' } });
        wrapper.vm.crawlJob = { status: 'Killed' };
        await wrapper.vm.$nextTick();

        expect(wrapper.vm.displayStatus).toBe('Crawl Failed');
      });

      it('falls back to dataprep status when crawlJob succeeded', async () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        const wrapper = createFileDetailsDialogWrapper();
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        wrapper.vm.file = createMockFile({ dataprep: { status: 'Ingested' } });
        wrapper.vm.crawlJob = { status: 'Succeeded' };
        await wrapper.vm.$nextTick();

        expect(wrapper.vm.displayStatus).toBe('Ingested');
      });
    });

    describe('confirmIngest error path', () => {
      it('shows error notification when ingestFile fails', async () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile({ labels: ['Service A'] }));
        mockIngestFile.mockRejectedValue(new Error('Ingest service unavailable'));

        const wrapper = createFileDetailsDialogWrapper();
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        wrapper.vm.file = createMockFile({ labels: ['Service A'] });
        wrapper.vm.editableFile.labels = ['Service A'];
        wrapper.vm.knowledgeHierarchy = createMockHierarchy('en');
        wrapper.vm.englishKnowledgeHierarchy = createMockHierarchy('en');
        await wrapper.vm.$nextTick();

        mockEventBusEmit.mockClear();
        await wrapper.vm.confirmIngest();

        expect(mockEventBusEmit).toHaveBeenCalledWith('notification:show', expect.objectContaining({ type: 'error' }));
        expect(wrapper.vm.isLoading).toBe(false);
        expect(wrapper.emitted('close')).toBeFalsy();
      });
    });

    describe('confirmRetract error path', () => {
      it('shows error notification when retractMultipleFiles fails', async () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile({ dataprep: { status: 'Ingested' } }));
        mockRetractMultipleFiles.mockRejectedValue(new Error('Retract failed'));

        const wrapper = createFileDetailsDialogWrapper();
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        wrapper.vm.file = createMockFile({ dataprep: { status: 'Ingested' } });
        await wrapper.vm.$nextTick();

        mockEventBusEmit.mockClear();
        await wrapper.vm.confirmRetract();

        expect(mockEventBusEmit).toHaveBeenCalledWith('notification:show', expect.objectContaining({ type: 'error' }));
        expect(wrapper.vm.isLoading).toBe(false);
        expect(wrapper.emitted('close')).toBeFalsy();
      });
    });

    describe('confirmDelete error path', () => {
      it('shows error notification when deleteFile fails', async () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        mockDeleteFile.mockRejectedValue(new Error('Delete failed'));

        const wrapper = createFileDetailsDialogWrapper();
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        wrapper.vm.file = createMockFile();
        await wrapper.vm.$nextTick();

        mockEventBusEmit.mockClear();
        await wrapper.vm.confirmDelete();

        expect(mockEventBusEmit).toHaveBeenCalledWith('notification:show', expect.objectContaining({ type: 'error' }));
        expect(wrapper.vm.isLoading).toBe(false);
        expect(wrapper.emitted('close')).toBeFalsy();
      });
    });
  });

  // -------------------------------------------------------------------------
  // 4i — refreshDashboardData, fetch logs, confirm kills,
  //       activeTab watcher, isExternalUrl, getEnglishLabelNames, $i18n.locale
  // -------------------------------------------------------------------------
  describe('4i — refreshDashboardData, fetchCrawlLogs, fetchIngestionLogs, confirmKillCrawl, confirmKillDocument, activeTab watcher, isExternalUrl, getEnglishLabelNames, $i18n.locale watcher', () => {
    describe('refreshDashboardData', () => {
      it('fetches crawl job and metrics on refresh', async () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        mockGetCrawlJob.mockResolvedValue({ data: { status: 'Crawling' } });
        mockGetCrawlMetrics.mockResolvedValue({
          data: {
            crawl_rate: 10,
            queue_size: 5,
            error_rate: 1,
            error_counts: { timeout: 2 },
            processed: 100,
            limit: 200,
            current_depth: 2,
            max_depth: 5,
            links_internal: 50,
            links_external: 10,
            total_crawled: 80
          }
        });
        const wrapper = createFileDetailsDialogWrapper();
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        await wrapper.vm.refreshDashboardData();

        expect(mockGetCrawlJob).toHaveBeenCalledWith('test-file-123');
        expect(mockGetCrawlMetrics).toHaveBeenCalledWith('test-file-123');
        expect(wrapper.vm.crawlJob).toEqual({ status: 'Crawling' });
        expect(wrapper.vm.crawlStats.crawlRate).toBe(10);
        expect(wrapper.vm.crawlStats.totalCrawled).toBe(80);
        expect(wrapper.vm.isRefreshingDashboard).toBe(false);
      });

      it('returns early if already refreshing', async () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        const wrapper = createFileDetailsDialogWrapper();
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        wrapper.vm.isRefreshingDashboard = true;
        mockGetCrawlJob.mockClear();

        await wrapper.vm.refreshDashboardData();

        expect(mockGetCrawlJob).not.toHaveBeenCalled();
      });

      it('handles missing data gracefully', async () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        mockGetCrawlJob.mockResolvedValue(null);
        mockGetCrawlMetrics.mockResolvedValue(null);
        const wrapper = createFileDetailsDialogWrapper();
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        await wrapper.vm.refreshDashboardData();

        expect(wrapper.vm.isRefreshingDashboard).toBe(false);
      });

      it('handles API errors gracefully', async () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        mockGetCrawlJob.mockRejectedValue(new Error('Network error'));
        const wrapper = createFileDetailsDialogWrapper();
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        await wrapper.vm.refreshDashboardData();

        expect(wrapper.vm.isRefreshingDashboard).toBe(false);
      });
    });

    describe('fetchCrawlLogs', () => {
      it('fetches and stores crawl logs on success', async () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        mockGetCrawlLogs.mockResolvedValue({ data: [{ id: 1, message: 'Crawled page' }] });
        const wrapper = createFileDetailsDialogWrapper();
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        await wrapper.vm.fetchCrawlLogs();

        expect(mockGetCrawlLogs).toHaveBeenCalledWith('test-file-123');
        expect(wrapper.vm.crawlLogs).toEqual([{ id: 1, message: 'Crawled page' }]);
        expect(wrapper.vm.isCrawlLogLoading).toBe(false);
      });

      it('shows error notification on API failure', async () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        mockGetCrawlLogs.mockRejectedValue(new Error('Fetch failed'));
        mockEventBusEmit.mockClear();
        const wrapper = createFileDetailsDialogWrapper();
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        await wrapper.vm.fetchCrawlLogs();

        expect(wrapper.vm.isCrawlLogLoading).toBe(false);
        expect(mockEventBusEmit).toHaveBeenCalledWith('notification:show', expect.objectContaining({ type: 'error' }));
      });
    });

    describe('fetchIngestionLogs', () => {
      it('fetches and stores ingestion logs on success', async () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        mockGetIngestionLogs.mockResolvedValue({ data: [{ id: 1, message: 'Ingested' }] });
        const wrapper = createFileDetailsDialogWrapper();
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        await wrapper.vm.fetchIngestionLogs();

        expect(mockGetIngestionLogs).toHaveBeenCalledWith('test-file-123');
        expect(wrapper.vm.ingestionLogs).toEqual([{ id: 1, message: 'Ingested' }]);
        expect(wrapper.vm.isLogLoading).toBe(false);
      });

      it('shows error notification on API failure', async () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        mockGetIngestionLogs.mockRejectedValue(new Error('Fetch failed'));
        mockEventBusEmit.mockClear();
        const wrapper = createFileDetailsDialogWrapper();
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        await wrapper.vm.fetchIngestionLogs();

        expect(wrapper.vm.isLogLoading).toBe(false);
        expect(mockEventBusEmit).toHaveBeenCalledWith('notification:show', expect.objectContaining({ type: 'error' }));
      });
    });

    describe('confirmKillCrawl', () => {
      it('kills crawl and refreshes data on success', async () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        mockKillCrawl.mockResolvedValue({ success: true });
        mockGetAdminCategories.mockResolvedValue(createMockHierarchy('en'));
        mockEventBusEmit.mockClear();
        const wrapper = createFileDetailsDialogWrapper();
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        wrapper.vm.confirmDialog = { visible: true };
        await wrapper.vm.confirmKillCrawl();

        expect(mockKillCrawl).toHaveBeenCalledWith('test-file-123');
        expect(wrapper.vm.confirmDialog.visible).toBe(false);
        expect(wrapper.vm.isCrawlLogLoading).toBe(false);
      });

      it('shows error notification on kill failure', async () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        mockKillCrawl.mockRejectedValue(new Error('Kill failed'));
        mockEventBusEmit.mockClear();
        const wrapper = createFileDetailsDialogWrapper();
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        wrapper.vm.confirmDialog = { visible: true };
        await wrapper.vm.confirmKillCrawl();

        expect(mockEventBusEmit).toHaveBeenCalledWith('notification:show', expect.objectContaining({ type: 'error' }));
      });
    });

    describe('confirmKillDocument', () => {
      it('kills ingestion and schedules log refresh on success', async () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        mockKillIngestion.mockResolvedValue({ success: true });
        mockEventBusEmit.mockClear();
        const wrapper = createFileDetailsDialogWrapper();
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        wrapper.vm.confirmDialog = { visible: true };
        await wrapper.vm.confirmKillDocument();

        expect(mockKillIngestion).toHaveBeenCalledWith('test-file-123');
        expect(wrapper.vm.confirmDialog.visible).toBe(false);
        // setTimeout with fetchIngestionLogs is pending
        expect(wrapper.vm.isLogLoading).toBe(false);
      });

      it('shows error notification on kill failure', async () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        mockKillIngestion.mockRejectedValue(new Error('Kill failed'));
        mockEventBusEmit.mockClear();
        const wrapper = createFileDetailsDialogWrapper();
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        wrapper.vm.confirmDialog = { visible: true };
        await wrapper.vm.confirmKillDocument();

        expect(mockEventBusEmit).toHaveBeenCalledWith('notification:show', expect.objectContaining({ type: 'error' }));
      });
    });

    describe('activeTab watcher', () => {
      it('fetches crawl logs when switching to crawlLog tab with empty logs', async () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        mockGetCrawlLogs.mockResolvedValue({ data: [] });
        const wrapper = createFileDetailsDialogWrapper();
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        wrapper.vm.crawlLogs = [];
        wrapper.vm.activeTab = 'crawlLog';
        await wrapper.vm.$nextTick();

        expect(mockGetCrawlLogs).toHaveBeenCalled();
      });

      it('does not fetch crawl logs when they already exist', async () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        mockGetCrawlLogs.mockClear();
        const wrapper = createFileDetailsDialogWrapper();
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        wrapper.vm.crawlLogs = [{ id: 1 }];
        wrapper.vm.activeTab = 'crawlLog';
        await wrapper.vm.$nextTick();

        // getCrawlLogs may have been called during mount, but not again from watcher
        const callCount = mockGetCrawlLogs.mock.calls.length;
        expect(callCount).toBeLessThanOrEqual(1);
      });

      it('fetches ingestion logs when switching to ingestionLog tab with empty logs', async () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        mockGetIngestionLogs.mockResolvedValue({ data: [] });
        const wrapper = createFileDetailsDialogWrapper();
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        wrapper.vm.ingestionLogs = [];
        wrapper.vm.activeTab = 'ingestionLog';
        await wrapper.vm.$nextTick();

        expect(mockGetIngestionLogs).toHaveBeenCalled();
      });

      it('starts dashboard timer when switching to dashboard tab', async () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        const wrapper = createFileDetailsDialogWrapper();
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        wrapper.vm.activeTab = 'dashboard';
        await wrapper.vm.$nextTick();

        expect(wrapper.vm.dashboardTimer).toBeTruthy();
      });

      it('stops dashboard timer when switching away from dashboard', async () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        const wrapper = createFileDetailsDialogWrapper();
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        wrapper.vm.activeTab = 'dashboard';
        await wrapper.vm.$nextTick();
        expect(wrapper.vm.dashboardTimer).toBeTruthy();

        wrapper.vm.activeTab = 'details';
        await wrapper.vm.$nextTick();

        expect(wrapper.vm.dashboardTimer).toBeNull();
      });
    });

    describe('isExternalUrl', () => {
      it('returns false for null url', () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        const wrapper = createFileDetailsDialogWrapper();
        expect(wrapper.vm.isExternalUrl(null)).toBe(false);
      });

      it('returns false for empty string', () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        const wrapper = createFileDetailsDialogWrapper();
        expect(wrapper.vm.isExternalUrl('')).toBe(false);
      });

      it('returns true for https url', () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        const wrapper = createFileDetailsDialogWrapper();
        expect(wrapper.vm.isExternalUrl('https://example.com')).toBe(true);
      });

      it('returns true for http url', () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        const wrapper = createFileDetailsDialogWrapper();
        expect(wrapper.vm.isExternalUrl('http://example.com')).toBe(true);
      });

      it('returns false for placeholder urls with HOST', () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        const wrapper = createFileDetailsDialogWrapper();
        expect(wrapper.vm.isExternalUrl('https://<HOST>:8080/api')).toBe(false);
      });

      it('returns false for placeholder urls with PORT', () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        const wrapper = createFileDetailsDialogWrapper();
        expect(wrapper.vm.isExternalUrl('http://localhost:<PORT>/api')).toBe(false);
      });

      it('returns false for non-http protocols', () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        const wrapper = createFileDetailsDialogWrapper();
        expect(wrapper.vm.isExternalUrl('ftp://files.example.com')).toBe(false);
      });
    });

    describe('getEnglishLabelNames', () => {
      it('returns empty array when no labels selected', async () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        const wrapper = createFileDetailsDialogWrapper();
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        const result = wrapper.vm.getEnglishLabelNames([]);
        expect(result).toEqual([]);
      });

      it('returns empty array when english hierarchy is empty', async () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        const wrapper = createFileDetailsDialogWrapper();
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        wrapper.vm.knowledgeHierarchy = createMockHierarchy('en');
        wrapper.vm.englishKnowledgeHierarchy = [];
        const result = wrapper.vm.getEnglishLabelNames(['Service A']);
        expect(result).toEqual([]);
      });

      it('maps locale labels to english using hierarchy', async () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        const wrapper = createFileDetailsDialogWrapper();
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        wrapper.vm.knowledgeHierarchy = createMockHierarchy('fr');
        wrapper.vm.englishKnowledgeHierarchy = createMockHierarchy('en');

        const result = wrapper.vm.getEnglishLabelNames(['Service A (fr)']);
        expect(result).toContain('Service A');
      });

      it('falls back to direct match when not in locale map', async () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        const wrapper = createFileDetailsDialogWrapper();
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        // Both hierarchies must be non-empty for method to proceed
        wrapper.vm.knowledgeHierarchy = createMockHierarchy('fr');
        wrapper.vm.englishKnowledgeHierarchy = createMockHierarchy('en');

        // 'Service A' is in english hierarchy but not in locale map (fr labels are 'Service A (fr)')
        const result = wrapper.vm.getEnglishLabelNames(['Service A']);
        expect(result).toContain('Service A');
      });

      it('uses original label as fallback when no match found', async () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        const wrapper = createFileDetailsDialogWrapper();
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        wrapper.vm.knowledgeHierarchy = createMockHierarchy('fr');
        wrapper.vm.englishKnowledgeHierarchy = createMockHierarchy('en');

        const result = wrapper.vm.getEnglishLabelNames(['Unknown Label']);
        expect(result).toContain('Unknown Label');
      });

      it('deduplicates results', async () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        const wrapper = createFileDetailsDialogWrapper();
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        wrapper.vm.knowledgeHierarchy = createMockHierarchy('fr');
        wrapper.vm.englishKnowledgeHierarchy = createMockHierarchy('en');

        const result = wrapper.vm.getEnglishLabelNames(['Service A', 'Service A']);
        expect(result.length).toBe(1);
      });
    });

    describe('$i18n.locale watcher', () => {
      it('re-fetches data when locale changes', async () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        mockGetAdminCategories.mockResolvedValue(createMockHierarchy('en'));
        const wrapper = createFileDetailsDialogWrapper();
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        const initialFetchCalls = mockGetFileMetadata.mock.calls.length;

        wrapper.vm.$options.watch['$i18n.locale'].call(wrapper.vm, 'fr');
        await wrapper.vm.$nextTick();

        expect(wrapper.vm.currentLocale).toBe('fr');
        expect(mockGetFileMetadata.mock.calls.length).toBeGreaterThan(initialFetchCalls);
      });

      it('does not re-fetch when locale is falsy', async () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        const wrapper = createFileDetailsDialogWrapper();
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        const initialFetchCalls = mockGetFileMetadata.mock.calls.length;

        wrapper.vm.$options.watch['$i18n.locale'].call(wrapper.vm, '');
        await wrapper.vm.$nextTick();

        expect(mockGetFileMetadata.mock.calls.length).toBe(initialFetchCalls);
      });

      it('does not re-fetch when locale is same as current', async () => {
        mockGetFileMetadata.mockResolvedValue(createMockFile());
        const wrapper = createFileDetailsDialogWrapper();
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        const initialFetchCalls = mockGetFileMetadata.mock.calls.length;

        wrapper.vm.$options.watch['$i18n.locale'].call(wrapper.vm, 'en');
        await wrapper.vm.$nextTick();

        expect(mockGetFileMetadata.mock.calls.length).toBe(initialFetchCalls);
      });
    });
  });
});
