/**
 * Unit Tests for FileDetailsDialog Auto-Refresh Lifecycle
 *
 * Tests the ingestion auto-refresh polling behavior:
 * - Polling starts when Ingestion Log tab opens with "Ingesting" status
 * - Polling stops on terminal status
 * - Polling stops on tab change / dialog close
 * - Interval respects minimum of 1 second
 * - Error handling (network error retains display, 401 stops polling)
 *
 * Validates: Requirements 4.1, 4.4, 4.7, 4.8
 */
import { shallowMount, flushPromises } from '@vue/test-utils';
import FileDetailsDialog from '../FileDetailsDialog.vue';
import documentFileService from '../../services/documentFileService.js';

// Mock the documentFileService
jest.mock('../../services/documentFileService.js', () => ({
  getIngestionProgress: jest.fn(),
  getIngestionLogs: jest.fn(),
  getFileMetadata: jest.fn(),
  getFileDetails: jest.fn(),
  getCrawlJob: jest.fn(),
  getCrawlMetrics: jest.fn(),
  getAdminCategories: jest.fn(),
}));

// Mock serviceTreeService
jest.mock('../../services/serviceTreeService.js', () => ({
  getAdminCategories: jest.fn().mockResolvedValue([]),
}));

// Mock eventBus
jest.mock('../../eventBus.js', () => ({
  eventBus: { $emit: jest.fn(), $on: jest.fn(), $off: jest.fn() },
}));

describe('FileDetailsDialog Auto-Refresh Lifecycle', () => {
  let wrapper;

  // Default file mock with "Ingesting" status
  const mockIngestingFile = {
    file_id: 'test-file-123',
    file_name: 'test.pdf',
    file_type: 'pdf',
    file_size: 1024,
    file_hash: 'abc123',
    upload_date: '2025-01-01T00:00:00Z',
    author: 'Test Author',
    labels: [],
    source_url: null,
    dataprep: { status: 'Ingesting' },
  };

  const mockTerminalFile = {
    ...mockIngestingFile,
    dataprep: { status: 'Ingested' },
  };

  const mockProgressResponse = {
    file_id: 'test-file-123',
    current_stage: 'Extraction',
    stage_progress_percent: 50,
    stages_completed: 0,
    total_stages: 5,
    status: 'in_progress',
    started_at: '2025-01-01T10:00:00Z',
    updated_at: '2025-01-01T10:01:00Z',
    finished_at: null,
  };

  const mockLogResponse = {
    data: [
      { timestamp: '2025-01-01T10:00:00Z', level: 'INFO', stage: 'Extraction', message: 'Started' },
    ],
  };

  beforeEach(() => {
    jest.useFakeTimers();

    // Default mock implementations
    documentFileService.getIngestionProgress.mockResolvedValue(mockProgressResponse);
    documentFileService.getIngestionLogs.mockResolvedValue(mockLogResponse);
    documentFileService.getFileMetadata.mockResolvedValue(mockIngestingFile);
    documentFileService.getCrawlJob.mockResolvedValue({ data: null });
    documentFileService.getCrawlMetrics.mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
      wrapper = null;
    }
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  /**
   * Helper to create a wrapper with pre-loaded state, bypassing the
   * complex fetchData lifecycle by setting data directly after mount.
   */
  function createWrapper(overrides = {}) {
    const w = shallowMount(FileDetailsDialog, {
      props: { fileId: 'test-file-123' },
      global: {
        stubs: {
          Teleport: true,
          ConfirmDialog: true,
          IngestionProgressIndicator: true,
        },
        mocks: {
          $i18n: { locale: 'en', t: (key) => key },
        },
      },
    });

    // Set data to simulate fetched state (bypasses async fetchData)
    w.setData({
      isLoading: false,
      isFetchingData: false,
      isHierarchyLoading: false,
      file: mockIngestingFile,
      editableFile: { file_name: 'test.pdf', author: 'Test Author', labels: [] },
      knowledgeHierarchy: [],
      englishKnowledgeHierarchy: [],
      ...overrides,
    });

    return w;
  }

  // ============================================================
  // Requirement 4.1: Polling starts when Ingestion Log tab opens
  // with "Ingesting" status
  // ============================================================
  describe('polling starts when Ingestion Log tab opens with Ingesting status', () => {
    it('should enable auto-refresh and start timer when switching to ingestionLog tab with Ingesting file', async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      // Switch to ingestion log tab
      wrapper.vm.activeTab = 'ingestionLog';
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.isIngestionAutoRefreshEnabled).toBe(true);
    });

    it('should call startIngestionRefreshTimer when isIngestionAutoRefreshEnabled becomes true on ingestionLog tab', async () => {
      // Mock to return terminal file so auto-enable doesn't trigger on tab switch
      documentFileService.getFileMetadata.mockResolvedValue(mockTerminalFile);

      wrapper = createWrapper({
        file: mockTerminalFile,
        activeTab: 'details',
        isIngestionAutoRefreshEnabled: false,
      });
      await flushPromises();

      // Ensure file is terminal after fetchData resolves
      wrapper.vm.file = mockTerminalFile;
      await wrapper.vm.$nextTick();

      // Manually switch to ingestionLog tab (won't auto-enable since file is terminal)
      wrapper.vm.activeTab = 'ingestionLog';
      await wrapper.vm.$nextTick();

      const startSpy = jest.spyOn(wrapper.vm, 'startIngestionRefreshTimer');

      // Now manually enable auto-refresh
      wrapper.vm.isIngestionAutoRefreshEnabled = true;
      await wrapper.vm.$nextTick();

      expect(startSpy).toHaveBeenCalled();
    });

    it('should set ingestionRefreshTimer when startIngestionRefreshTimer is called', async () => {
      // Mock to return terminal file so no auto-start
      documentFileService.getFileMetadata.mockResolvedValue(mockTerminalFile);

      wrapper = createWrapper({
        file: mockTerminalFile,
        activeTab: 'details',
        isIngestionAutoRefreshEnabled: false,
      });
      await flushPromises();

      // Ensure file is terminal
      wrapper.vm.file = mockTerminalFile;
      await wrapper.vm.$nextTick();

      // Switch tab without auto-enable (terminal file)
      wrapper.vm.activeTab = 'ingestionLog';
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.ingestionRefreshTimer).toBeNull();

      // Manually enable and start
      wrapper.vm.isIngestionAutoRefreshEnabled = true;
      wrapper.vm.startIngestionRefreshTimer();

      expect(wrapper.vm.ingestionRefreshTimer).not.toBeNull();
    });

    it('should not enable auto-refresh if file status is not Ingesting', async () => {
      // Mock to return terminal file
      documentFileService.getFileMetadata.mockResolvedValue(mockTerminalFile);

      wrapper = createWrapper({
        file: mockTerminalFile,
        activeTab: 'details',
        isIngestionAutoRefreshEnabled: false,
      });
      await flushPromises();

      // Ensure file is terminal
      wrapper.vm.file = mockTerminalFile;
      await wrapper.vm.$nextTick();

      // Switch to ingestionLog tab — should NOT auto-enable since file is terminal
      wrapper.vm.activeTab = 'ingestionLog';
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.isIngestionAutoRefreshEnabled).toBe(false);
    });

    it('should trigger an immediate refresh when timer starts', async () => {
      wrapper = createWrapper({
        activeTab: 'ingestionLog',
        isIngestionAutoRefreshEnabled: true,
      });
      await wrapper.vm.$nextTick();

      documentFileService.getIngestionProgress.mockClear();
      documentFileService.getIngestionLogs.mockClear();

      wrapper.vm.startIngestionRefreshTimer();
      await wrapper.vm.$nextTick();

      // Should have called refreshIngestionData immediately
      expect(documentFileService.getIngestionProgress).toHaveBeenCalledWith('test-file-123');
    });
  });

  // ============================================================
  // Requirement 4.4: Polling stops on terminal status
  // ============================================================
  describe('polling stops on terminal status', () => {
    const terminalStatuses = ['Ingested', 'Ingested with Warnings', 'Ingestion Error', 'Killed'];

    terminalStatuses.forEach((status) => {
      it(`should stop polling when file status changes to "${status}"`, async () => {
        wrapper = createWrapper({
          activeTab: 'ingestionLog',
          isIngestionAutoRefreshEnabled: true,
        });
        await wrapper.vm.$nextTick();

        // Start the timer
        wrapper.vm.startIngestionRefreshTimer();
        expect(wrapper.vm.ingestionRefreshTimer).not.toBeNull();

        // Simulate a refresh that returns terminal status
        documentFileService.getIngestionProgress.mockResolvedValue({
          ...mockProgressResponse,
          status: status === 'Ingestion Error' ? 'error' : 'completed',
        });
        documentFileService.getFileMetadata.mockResolvedValue({
          ...mockIngestingFile,
          dataprep: { status },
        });

        // Trigger refresh
        await wrapper.vm.refreshIngestionData();
        await wrapper.vm.$nextTick();

        expect(wrapper.vm.isIngestionAutoRefreshEnabled).toBe(false);
        expect(wrapper.vm.ingestionRefreshTimer).toBeNull();
      });
    });

    it('should stop polling when progress status indicates "completed"', async () => {
      wrapper = createWrapper({
        activeTab: 'ingestionLog',
        isIngestionAutoRefreshEnabled: true,
      });
      await wrapper.vm.$nextTick();

      wrapper.vm.startIngestionRefreshTimer();

      documentFileService.getIngestionProgress.mockResolvedValue({
        ...mockProgressResponse,
        status: 'completed',
        finished_at: '2025-01-01T10:05:00Z',
      });
      documentFileService.getFileMetadata.mockResolvedValue(mockTerminalFile);

      await wrapper.vm.refreshIngestionData();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.isIngestionAutoRefreshEnabled).toBe(false);
      expect(wrapper.vm.ingestionRefreshTimer).toBeNull();
    });

    it('should stop polling when progress status indicates "error"', async () => {
      wrapper = createWrapper({
        activeTab: 'ingestionLog',
        isIngestionAutoRefreshEnabled: true,
      });
      await wrapper.vm.$nextTick();

      wrapper.vm.startIngestionRefreshTimer();

      documentFileService.getIngestionProgress.mockResolvedValue({
        ...mockProgressResponse,
        status: 'error',
        finished_at: '2025-01-01T10:05:00Z',
      });
      documentFileService.getFileMetadata.mockResolvedValue({
        ...mockIngestingFile,
        dataprep: { status: 'Ingestion Error' },
      });

      await wrapper.vm.refreshIngestionData();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.isIngestionAutoRefreshEnabled).toBe(false);
    });
  });

  // ============================================================
  // Requirement 4.7: Polling stops on tab change / dialog close
  // ============================================================
  describe('polling stops on tab change / dialog close', () => {
    it('should stop polling when switching away from ingestionLog tab', async () => {
      wrapper = createWrapper({
        activeTab: 'ingestionLog',
        isIngestionAutoRefreshEnabled: true,
      });
      await wrapper.vm.$nextTick();

      wrapper.vm.startIngestionRefreshTimer();
      expect(wrapper.vm.ingestionRefreshTimer).not.toBeNull();

      // Switch to details tab
      wrapper.vm.activeTab = 'details';
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.ingestionRefreshTimer).toBeNull();
    });

    it('should stop polling when switching to dashboard tab', async () => {
      wrapper = createWrapper({
        activeTab: 'ingestionLog',
        isIngestionAutoRefreshEnabled: true,
      });
      await wrapper.vm.$nextTick();

      wrapper.vm.startIngestionRefreshTimer();
      expect(wrapper.vm.ingestionRefreshTimer).not.toBeNull();

      wrapper.vm.activeTab = 'dashboard';
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.ingestionRefreshTimer).toBeNull();
    });

    it('should stop polling on component unmount (dialog close)', async () => {
      wrapper = createWrapper({
        activeTab: 'ingestionLog',
        isIngestionAutoRefreshEnabled: true,
      });
      await wrapper.vm.$nextTick();

      wrapper.vm.startIngestionRefreshTimer();
      const timerHandle = wrapper.vm.ingestionRefreshTimer;
      expect(timerHandle).not.toBeNull();

      const stopSpy = jest.spyOn(wrapper.vm, 'stopIngestionRefreshTimer');
      wrapper.unmount();

      expect(stopSpy).toHaveBeenCalled();
      wrapper = null; // Prevent afterEach from trying to unmount again
    });

    it('should clear interval handle when stopIngestionRefreshTimer is called', async () => {
      wrapper = createWrapper({
        activeTab: 'ingestionLog',
        isIngestionAutoRefreshEnabled: true,
      });
      await wrapper.vm.$nextTick();

      wrapper.vm.startIngestionRefreshTimer();
      expect(wrapper.vm.ingestionRefreshTimer).not.toBeNull();

      wrapper.vm.stopIngestionRefreshTimer();

      expect(wrapper.vm.ingestionRefreshTimer).toBeNull();
    });
  });

  // ============================================================
  // Requirement 4.2: Interval respects minimum of 1 second
  // ============================================================
  describe('interval respects minimum of 1 second', () => {
    it('should use Math.max(1, interval) * 1000 for the timer interval', async () => {
      wrapper = createWrapper({
        activeTab: 'ingestionLog',
        isIngestionAutoRefreshEnabled: true,
        ingestionRefreshInterval: 3,
      });
      await wrapper.vm.$nextTick();

      const setIntervalSpy = jest.spyOn(global, 'setInterval');

      wrapper.vm.startIngestionRefreshTimer();

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 3000);
      setIntervalSpy.mockRestore();
    });

    it('should clamp interval to 1 second when value is less than 1', async () => {
      wrapper = createWrapper({
        activeTab: 'ingestionLog',
        isIngestionAutoRefreshEnabled: true,
        ingestionRefreshInterval: 0.5,
      });
      await wrapper.vm.$nextTick();

      const setIntervalSpy = jest.spyOn(global, 'setInterval');

      wrapper.vm.startIngestionRefreshTimer();

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 1000);
      setIntervalSpy.mockRestore();
    });

    it('should clamp interval to 1 second when value is 0', async () => {
      wrapper = createWrapper({
        activeTab: 'ingestionLog',
        isIngestionAutoRefreshEnabled: true,
        ingestionRefreshInterval: 0,
      });
      await wrapper.vm.$nextTick();

      const setIntervalSpy = jest.spyOn(global, 'setInterval');

      wrapper.vm.startIngestionRefreshTimer();

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 1000);
      setIntervalSpy.mockRestore();
    });

    it('should clamp negative interval to 1 second minimum', async () => {
      wrapper = createWrapper({
        activeTab: 'ingestionLog',
        isIngestionAutoRefreshEnabled: true,
        ingestionRefreshInterval: -5,
      });
      await wrapper.vm.$nextTick();

      const setIntervalSpy = jest.spyOn(global, 'setInterval');

      wrapper.vm.startIngestionRefreshTimer();

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 1000);
      setIntervalSpy.mockRestore();
    });

    it('should use 5 second default interval', async () => {
      wrapper = createWrapper({
        activeTab: 'ingestionLog',
        isIngestionAutoRefreshEnabled: true,
        // ingestionRefreshInterval defaults to 5
      });
      await wrapper.vm.$nextTick();

      const setIntervalSpy = jest.spyOn(global, 'setInterval');

      wrapper.vm.startIngestionRefreshTimer();

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
      setIntervalSpy.mockRestore();
    });

    it('should restart timer when interval changes', async () => {
      wrapper = createWrapper({
        activeTab: 'ingestionLog',
        isIngestionAutoRefreshEnabled: true,
        ingestionRefreshInterval: 5,
      });
      await wrapper.vm.$nextTick();

      wrapper.vm.startIngestionRefreshTimer();
      const originalTimer = wrapper.vm.ingestionRefreshTimer;

      // Change the interval
      wrapper.vm.ingestionRefreshInterval = 10;
      await wrapper.vm.$nextTick();

      // Timer should be a new interval handle (restarted)
      expect(wrapper.vm.ingestionRefreshTimer).not.toBeNull();
      expect(wrapper.vm.ingestionRefreshTimer).not.toBe(originalTimer);
    });
  });

  // ============================================================
  // Requirement 4.8: Error handling
  // ============================================================
  describe('error handling', () => {
    it('should retain displayed data on network error and continue polling', async () => {
      wrapper = createWrapper({
        activeTab: 'ingestionLog',
        isIngestionAutoRefreshEnabled: true,
        ingestionLogs: [
          { timestamp: '2025-01-01T10:00:00Z', level: 'INFO', stage: 'Extraction', message: 'Started' },
        ],
        ingestionProgress: mockProgressResponse,
      });
      await wrapper.vm.$nextTick();

      wrapper.vm.startIngestionRefreshTimer();

      // Simulate network error (no response object)
      documentFileService.getIngestionProgress.mockRejectedValue(new Error('Network Error'));

      await wrapper.vm.refreshIngestionData();
      await wrapper.vm.$nextTick();

      // Should retain existing logs and progress
      expect(wrapper.vm.ingestionLogs).toHaveLength(1);
      expect(wrapper.vm.ingestionProgress).toEqual(mockProgressResponse);
      // Polling should still be active
      expect(wrapper.vm.isIngestionAutoRefreshEnabled).toBe(true);
      expect(wrapper.vm.ingestionRefreshTimer).not.toBeNull();
    });

    it('should stop polling on 401 unauthorized error', async () => {
      wrapper = createWrapper({
        activeTab: 'ingestionLog',
        isIngestionAutoRefreshEnabled: true,
      });
      await wrapper.vm.$nextTick();

      wrapper.vm.startIngestionRefreshTimer();
      expect(wrapper.vm.ingestionRefreshTimer).not.toBeNull();

      // Simulate 401 error
      const authError = new Error('Unauthorized');
      authError.response = { status: 401 };
      documentFileService.getIngestionProgress.mockRejectedValue(authError);

      await wrapper.vm.refreshIngestionData();
      await wrapper.vm.$nextTick();

      // Polling should be stopped
      expect(wrapper.vm.isIngestionAutoRefreshEnabled).toBe(false);
      expect(wrapper.vm.ingestionRefreshTimer).toBeNull();
    });

    it('should stop polling on 403 forbidden error', async () => {
      wrapper = createWrapper({
        activeTab: 'ingestionLog',
        isIngestionAutoRefreshEnabled: true,
      });
      await wrapper.vm.$nextTick();

      wrapper.vm.startIngestionRefreshTimer();

      // Simulate 403 error
      const forbiddenError = new Error('Forbidden');
      forbiddenError.response = { status: 403 };
      documentFileService.getIngestionProgress.mockRejectedValue(forbiddenError);

      await wrapper.vm.refreshIngestionData();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.isIngestionAutoRefreshEnabled).toBe(false);
      expect(wrapper.vm.ingestionRefreshTimer).toBeNull();
    });

    it('should hide progress indicator on 404 error but continue polling', async () => {
      wrapper = createWrapper({
        activeTab: 'ingestionLog',
        isIngestionAutoRefreshEnabled: true,
        ingestionProgress: mockProgressResponse,
      });
      await wrapper.vm.$nextTick();

      wrapper.vm.startIngestionRefreshTimer();

      // Simulate 404 error
      const notFoundError = new Error('Not Found');
      notFoundError.response = { status: 404 };
      documentFileService.getIngestionProgress.mockRejectedValue(notFoundError);

      await wrapper.vm.refreshIngestionData();
      await wrapper.vm.$nextTick();

      // Progress should be nulled out
      expect(wrapper.vm.ingestionProgress).toBeNull();
      // Polling should continue (not stopped)
      expect(wrapper.vm.isIngestionAutoRefreshEnabled).toBe(true);
      expect(wrapper.vm.ingestionRefreshTimer).not.toBeNull();
    });

    it('should update lastIngestionRefreshAt on successful refresh', async () => {
      wrapper = createWrapper({
        activeTab: 'ingestionLog',
        isIngestionAutoRefreshEnabled: true,
      });
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.lastIngestionRefreshAt).toBeNull();

      await wrapper.vm.refreshIngestionData();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.lastIngestionRefreshAt).not.toBeNull();
      expect(wrapper.vm.lastIngestionRefreshAt).toBeInstanceOf(Date);
    });

    it('should not update lastIngestionRefreshAt on error', async () => {
      // Use terminal file to prevent auto-start
      wrapper = createWrapper({
        file: mockTerminalFile,
        activeTab: 'details',
        isIngestionAutoRefreshEnabled: false,
        lastIngestionRefreshAt: null,
      });
      await wrapper.vm.$nextTick();

      documentFileService.getIngestionProgress.mockRejectedValue(new Error('Network Error'));

      await wrapper.vm.refreshIngestionData();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.lastIngestionRefreshAt).toBeNull();
    });
  });

  // ============================================================
  // Additional lifecycle tests
  // ============================================================
  describe('timer lifecycle correctness', () => {
    it('should not start timer if isIngestionAutoRefreshEnabled is false', async () => {
      wrapper = createWrapper({
        activeTab: 'ingestionLog',
        isIngestionAutoRefreshEnabled: false,
      });
      await wrapper.vm.$nextTick();

      // Ensure timer is null initially
      wrapper.vm.stopIngestionRefreshTimer();
      expect(wrapper.vm.ingestionRefreshTimer).toBeNull();

      // Calling start while disabled should not create a timer
      wrapper.vm.isIngestionAutoRefreshEnabled = false;
      wrapper.vm.startIngestionRefreshTimer();

      expect(wrapper.vm.ingestionRefreshTimer).toBeNull();
    });

    it('should clear existing timer before starting a new one (no duplicate intervals)', async () => {
      wrapper = createWrapper({
        activeTab: 'ingestionLog',
        isIngestionAutoRefreshEnabled: true,
      });
      await wrapper.vm.$nextTick();

      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

      wrapper.vm.startIngestionRefreshTimer();
      const firstTimer = wrapper.vm.ingestionRefreshTimer;

      // Start again - should clear first
      wrapper.vm.startIngestionRefreshTimer();

      expect(clearIntervalSpy).toHaveBeenCalledWith(firstTimer);
      clearIntervalSpy.mockRestore();
    });

    it('should call refreshIngestionData on each interval tick', async () => {
      wrapper = createWrapper({
        activeTab: 'ingestionLog',
        isIngestionAutoRefreshEnabled: true,
        ingestionRefreshInterval: 5,
      });
      await wrapper.vm.$nextTick();

      const refreshSpy = jest.spyOn(wrapper.vm, 'refreshIngestionData');

      wrapper.vm.startIngestionRefreshTimer();

      // Clear the initial call count
      refreshSpy.mockClear();

      // Advance timer by 5 seconds
      jest.advanceTimersByTime(5000);

      expect(refreshSpy).toHaveBeenCalledTimes(1);

      // Advance another 5 seconds
      jest.advanceTimersByTime(5000);

      expect(refreshSpy).toHaveBeenCalledTimes(2);
    });
  });
});
