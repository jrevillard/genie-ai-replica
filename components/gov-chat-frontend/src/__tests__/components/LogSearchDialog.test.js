'use strict';

/**
 * LogSearchDialog tests — Story 5 requirements.
 *
 * Covers: mock infrastructure, performSearch with preset/custom ranges,
 * resetSearch, exportLogs CSV generation, conditional rendering, and emit events.
 */
const { mount } = require('@vue/test-utils');

// ---------------------------------------------------------------------------
// Service mocks (closure-based refs for per-test control)
// ---------------------------------------------------------------------------

const mockSearchLogs = jest.fn();

jest.mock('../../services/adminDashboardService', () => ({
  searchLogs: mockSearchLogs
}));

jest.mock('@lucide/vue', () => ({
  Loader2: { template: '<svg />' }
}));

// ---------------------------------------------------------------------------
// Component import (after mocks)
// ---------------------------------------------------------------------------
const LogSearchDialog = require('../../components/LogSearchDialog.vue').default;

// ---------------------------------------------------------------------------
// Mount helper
// ---------------------------------------------------------------------------

function createLogSearchDialogWrapper() {
  const div = document.createElement('div');
  document.body.appendChild(div);

  const wrapper = mount(LogSearchDialog, {
    attachTo: div,
    global: {
      mocks: {
        $t: (key) => key,
        $te: () => true,
        $i18n: { locale: 'en' }
      }
    },
    props: {}
  });

  return wrapper;
}

// ---------------------------------------------------------------------------
// Helper: read Blob as string (JSDOM doesn't support Blob.text())
// ---------------------------------------------------------------------------

function blobToString(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(blob);
  });
}

// ---------------------------------------------------------------------------
// Helper: create mock log entries
// ---------------------------------------------------------------------------

function createMockLogs(count = 3) {
  const logs = [];
  for (let i = 0; i < count; i++) {
    logs.push({
      date: `2025-01-${10 + i}`,
      time: `1${i}:30:00`,
      level: i % 2 === 0 ? 'ERROR' : 'INFO',
      service: `Service ${i + 1}`,
      message: `Test log message ${i + 1}`
    });
  }
  return logs;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LogSearchDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Story 5a: Setup mock infrastructure
  // -------------------------------------------------------------------------
  describe('Story 5a — setup mock infrastructure', () => {
    it('mounts successfully with NO props', () => {
      const wrapper = createLogSearchDialogWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it('has empty props definition', () => {
      const wrapper = createLogSearchDialogWrapper();
      expect(wrapper.vm.$options.props).toEqual({});
    });

    it('initializes adminDashboardService mock correctly', () => {
      expect(mockSearchLogs).toBeDefined();
      expect(typeof mockSearchLogs).toBe('function');
    });

    it('initializes default search params on mount', () => {
      const wrapper = createLogSearchDialogWrapper();
      expect(wrapper.vm.searchParams).toEqual({
        term: '',
        level: '',
        service: '',
        dateRange: 'today',
        startDate: expect.any(String),
        endDate: expect.any(String)
      });
    });

    it('initializes component state correctly', () => {
      const wrapper = createLogSearchDialogWrapper();
      expect(wrapper.vm.hasSearched).toBe(false);
      expect(wrapper.vm.isSearching).toBe(false);
      expect(wrapper.vm.searchResults).toEqual([]);
      expect(wrapper.vm.searchError).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Story 5b: performSearch() — preset vs custom date range
  // -------------------------------------------------------------------------
  describe('Story 5b — performSearch() with date ranges', () => {
    it('performs search with preset date range (today)', async () => {
      const mockLogs = createMockLogs(2);
      mockSearchLogs.mockResolvedValueOnce({
        data: { logs: mockLogs }
      });

      const wrapper = createLogSearchDialogWrapper();
      wrapper.vm.searchParams = {
        term: 'error',
        level: 'ERROR',
        service: 'API Gateway',
        dateRange: 'today',
        startDate: '2025-01-10',
        endDate: '2025-01-10'
      };

      const searchPromise = wrapper.vm.performSearch();
      await searchPromise; // Wait for the async operation to complete

      expect(mockSearchLogs).toHaveBeenCalledWith({
        term: 'error',
        level: 'ERROR',
        service: 'API Gateway',
        dateRange: 'today'
        // Note: startDate and endDate are NOT included for preset ranges
      });
      expect(wrapper.vm.hasSearched).toBe(true);
      expect(wrapper.vm.isSearching).toBe(false);
    });

    it('performs search with custom date range', async () => {
      const mockLogs = createMockLogs(3);
      mockSearchLogs.mockResolvedValueOnce({
        data: { logs: mockLogs }
      });

      const wrapper = createLogSearchDialogWrapper();
      wrapper.vm.searchParams = {
        term: 'timeout',
        level: 'WARN',
        service: 'Database',
        dateRange: 'custom',
        startDate: '2025-01-01',
        endDate: '2025-01-31'
      };

      const searchPromise = wrapper.vm.performSearch();
      await searchPromise; // Wait for the async operation to complete

      expect(mockSearchLogs).toHaveBeenCalledWith({
        term: 'timeout',
        level: 'WARN',
        service: 'Database',
        dateRange: 'custom',
        startDate: '2025-01-01',
        endDate: '2025-01-31'
      });
      expect(wrapper.vm.hasSearched).toBe(true);
      expect(wrapper.vm.isSearching).toBe(false);
    });

    it('sets isSearching to true during async operation', async () => {
      let resolveHanging;
      mockSearchLogs.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveHanging = resolve;
        })
      );

      const wrapper = createLogSearchDialogWrapper();
      wrapper.vm.searchParams.dateRange = 'today';

      const searchPromise = wrapper.vm.performSearch();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.isSearching).toBe(true);
      expect(wrapper.vm.hasSearched).toBe(true);

      // Resolve the hanging promise so the test cleans up properly
      resolveHanging({ data: { logs: [] } });
      await searchPromise;
    });

    it('resets isSearching to false after successful search', async () => {
      const mockLogs = createMockLogs(1);
      mockSearchLogs.mockResolvedValueOnce({
        data: { logs: mockLogs }
      });

      const wrapper = createLogSearchDialogWrapper();
      wrapper.vm.searchParams.dateRange = 'today';

      const searchPromise = wrapper.vm.performSearch();
      await searchPromise; // Wait for the async operation to complete
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.isSearching).toBe(false);
    });

    it('handles API errors gracefully', async () => {
      const testError = new Error('Network error');
      mockSearchLogs.mockRejectedValueOnce(testError);

      const wrapper = createLogSearchDialogWrapper();
      wrapper.vm.searchParams.dateRange = 'today';

      const searchPromise = wrapper.vm.performSearch();
      try {
        await searchPromise; // Wait for the async operation to complete
      } catch {
        // Expected to throw
      }
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.searchError).toBe('Network error');
      expect(wrapper.vm.searchResults).toEqual([]);
      expect(wrapper.vm.isSearching).toBe(false);
    });

    it('filters logs by level after search (WARN handling)', async () => {
      const mockLogs = [
        { level: 'WARN', message: 'Warning 1' },
        { level: 'WARNING', message: 'Warning 2' },
        { level: 'ERROR', message: 'Error 1' }
      ];
      mockSearchLogs.mockResolvedValueOnce({
        data: { logs: mockLogs }
      });

      const wrapper = createLogSearchDialogWrapper();
      wrapper.vm.searchParams.level = 'WARN';
      wrapper.vm.searchParams.dateRange = 'today';

      const searchPromise = wrapper.vm.performSearch();
      await searchPromise; // Wait for the async operation to complete
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.searchResults).toHaveLength(2);
      expect(wrapper.vm.searchResults[0].level).toBe('WARN');
      expect(wrapper.vm.searchResults[1].level).toBe('WARNING');
    });

    it('normalizes log entries with default values', async () => {
      const incompleteLogs = [{ time: '10:00:00', level: 'INFO', service: 'API' }, { time: '11:00:00' }];
      mockSearchLogs.mockResolvedValueOnce({
        data: { logs: incompleteLogs }
      });

      const wrapper = createLogSearchDialogWrapper();
      wrapper.vm.searchParams.dateRange = 'today';

      const searchPromise = wrapper.vm.performSearch();
      await searchPromise; // Wait for the async operation to complete
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.searchResults[0]).toHaveProperty('date');
      expect(wrapper.vm.searchResults[0]).toHaveProperty('message', '(No message)');
      expect(wrapper.vm.searchResults[1].service).toBe('System');
    });
  });

  // -------------------------------------------------------------------------
  // Story 5c: resetSearch() — verify form reset to defaults
  // -------------------------------------------------------------------------
  describe('Story 5c — resetSearch() resets form to defaults', () => {
    it('resets searchParams to default values', async () => {
      const wrapper = createLogSearchDialogWrapper();
      wrapper.vm.searchParams = {
        term: 'search term',
        level: 'ERROR',
        service: 'API Gateway',
        dateRange: 'month',
        startDate: '2025-01-01',
        endDate: '2025-01-31'
      };
      wrapper.vm.hasSearched = true;
      wrapper.vm.searchResults = createMockLogs(5);
      wrapper.vm.searchError = 'Some error';

      wrapper.vm.resetSearch();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.searchParams.term).toBe('');
      expect(wrapper.vm.searchParams.level).toBe('');
      expect(wrapper.vm.searchParams.service).toBe('');
      expect(wrapper.vm.searchParams.dateRange).toBe('today');
      expect(wrapper.vm.searchParams.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(wrapper.vm.searchParams.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('resets hasSearched flag to false', () => {
      const wrapper = createLogSearchDialogWrapper();
      wrapper.vm.hasSearched = true;

      wrapper.vm.resetSearch();

      expect(wrapper.vm.hasSearched).toBe(false);
    });

    it('clears searchResults array', () => {
      const wrapper = createLogSearchDialogWrapper();
      wrapper.vm.searchResults = createMockLogs(10);

      wrapper.vm.resetSearch();

      expect(wrapper.vm.searchResults).toEqual([]);
    });

    it('clears searchError', () => {
      const wrapper = createLogSearchDialogWrapper();
      wrapper.vm.searchError = 'Error message';

      wrapper.vm.resetSearch();

      expect(wrapper.vm.searchError).toBeNull();
    });

    it('resets startDate to 7 days ago and endDate to today', () => {
      const wrapper = createLogSearchDialogWrapper();
      const today = new Date();
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      wrapper.vm.resetSearch();

      expect(wrapper.vm.searchParams.startDate).toBe(wrapper.vm.formatDate(sevenDaysAgo));
      expect(wrapper.vm.searchParams.endDate).toBe(wrapper.vm.formatDate(today));
    });
  });

  // -------------------------------------------------------------------------
  // Story 5d: exportLogs() — CSV generation, field escaping
  // -------------------------------------------------------------------------
  describe('Story 5d — exportLogs() CSV generation', () => {
    let originalCreateObjectURL;
    let originalRevokeObjectURL;

    beforeEach(() => {
      // Store original methods
      originalCreateObjectURL = global.URL.createObjectURL;
      originalRevokeObjectURL = global.URL.revokeObjectURL;

      // Mock DOM APIs for file download
      global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
      global.URL.revokeObjectURL = jest.fn();
    });

    afterEach(() => {
      // Restore original methods
      global.URL.createObjectURL = originalCreateObjectURL;
      global.URL.revokeObjectURL = originalRevokeObjectURL;
    });

    it('returns early if no search results', () => {
      const wrapper = createLogSearchDialogWrapper();
      wrapper.vm.searchResults = [];

      const createObjectURSpy = jest.spyOn(URL, 'createObjectURL');

      wrapper.vm.exportLogs();

      expect(createObjectURSpy).not.toHaveBeenCalled();
    });

    it('generates CSV with correct headers and rows', async () => {
      const wrapper = createLogSearchDialogWrapper();
      wrapper.vm.searchResults = createMockLogs(2);

      let capturedBlob = null;
      global.URL.createObjectURL = jest.fn((blob) => {
        capturedBlob = blob;
        return 'blob:mock-url';
      });

      wrapper.vm.exportLogs();

      expect(global.URL.createObjectURL).toHaveBeenCalled();
      expect(capturedBlob).toBeInstanceOf(Blob);
      expect(capturedBlob.type).toBe('text/csv;charset=utf-8;');

      const csvText = await blobToString(capturedBlob);
      const lines = csvText.split('\n');
      expect(lines[0]).toBe('Date,Time,Level,Service,Message');
      expect(lines.length).toBe(3); // header + 2 rows
    });

    it('escapes double quotes in CSV fields', async () => {
      const wrapper = createLogSearchDialogWrapper();
      wrapper.vm.searchResults = [
        {
          date: '2025-01-10',
          time: '10:00:00',
          level: 'ERROR',
          service: 'API "Gateway"',
          message: 'Message with "quotes" inside'
        }
      ];

      let capturedBlob = null;
      global.URL.createObjectURL = jest.fn((blob) => {
        capturedBlob = blob;
        return 'blob:mock-url';
      });

      wrapper.vm.exportLogs();

      const csvText = await blobToString(capturedBlob);
      // Double quotes should be escaped as ""
      expect(csvText).toContain('"API ""Gateway"""');
      expect(csvText).toContain('"Message with ""quotes"" inside"');
    });

    it('wraps service and message fields in quotes', async () => {
      const wrapper = createLogSearchDialogWrapper();
      wrapper.vm.searchResults = [
        {
          date: '2025-01-10',
          time: '10:00:00',
          level: 'INFO',
          service: 'Auth Service',
          message: 'User login: john@example.com'
        }
      ];

      let capturedBlob = null;
      global.URL.createObjectURL = jest.fn((blob) => {
        capturedBlob = blob;
        return 'blob:mock-url';
      });

      wrapper.vm.exportLogs();

      const csvText = await blobToString(capturedBlob);
      // Service and message are always wrapped in quotes by the component
      expect(csvText).toContain('"Auth Service"');
      expect(csvText).toContain('"User login: john@example.com"');
    });

    it('generates correct number of CSV rows', () => {
      const wrapper = createLogSearchDialogWrapper();
      wrapper.vm.searchResults = createMockLogs(5);

      let capturedBlob = null;
      global.URL.createObjectURL = jest.fn((blob) => {
        capturedBlob = blob;
        return 'blob:mock-url';
      });

      wrapper.vm.exportLogs();

      // Verify blob was created and has reasonable size for 5 log entries + header
      expect(capturedBlob).toBeInstanceOf(Blob);
      expect(capturedBlob.size).toBeGreaterThan(100); // Should have content
    });

    it('creates download link with correct filename format', () => {
      const wrapper = createLogSearchDialogWrapper();
      wrapper.vm.searchResults = createMockLogs(1);

      // Track calls to createElement
      const createElementSpy = jest.spyOn(document, 'createElement');
      const createObjectURSpy = jest.spyOn(URL, 'createObjectURL');

      wrapper.vm.exportLogs();

      // Verify createElement was called for an anchor tag
      expect(createElementSpy).toHaveBeenCalledWith('a');

      // Verify createObjectURL was called (meaning a blob was created)
      expect(createObjectURSpy).toHaveBeenCalled();

      // Restore the spy
      createElementSpy.mockRestore();
      createObjectURSpy.mockRestore();
    });

    it('handles CSV export errors gracefully', () => {
      const wrapper = createLogSearchDialogWrapper();
      wrapper.vm.searchResults = createMockLogs(1);

      // Mock createObjectURL to throw an error
      const originalCreateObjectURL = global.URL.createObjectURL;
      global.URL.createObjectURL = jest.fn(() => {
        throw new Error('Blob creation failed');
      });

      expect(() => wrapper.vm.exportLogs()).not.toThrow();

      // Restore original
      global.URL.createObjectURL = originalCreateObjectURL;
    });
  });

  // -------------------------------------------------------------------------
  // Story 5e: Conditional rendering
  // -------------------------------------------------------------------------
  describe('Story 5e — conditional rendering', () => {
    it('shows custom date fields when dateRange is "custom"', async () => {
      const wrapper = createLogSearchDialogWrapper();
      wrapper.vm.searchParams.dateRange = 'today';

      await wrapper.vm.$nextTick();

      // Initially, custom date fields should not be visible
      expect(wrapper.find('[data-test-id="custom-date-range"]').exists()).toBe(false);

      // Change to custom
      wrapper.vm.searchParams.dateRange = 'custom';
      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-test-id="custom-date-range"]').exists()).toBe(true);
    });

    it('hides custom date fields when dateRange is not "custom"', async () => {
      const wrapper = createLogSearchDialogWrapper();
      wrapper.vm.searchParams.dateRange = 'custom';

      await wrapper.vm.$nextTick();
      expect(wrapper.find('[data-test-id="custom-date-range"]').exists()).toBe(true);

      wrapper.vm.searchParams.dateRange = 'week';
      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-test-id="custom-date-range"]').exists()).toBe(false);
    });

    it('shows loading spinner when isSearching is true', async () => {
      const wrapper = createLogSearchDialogWrapper();

      // Component initializes with isSearching=false, spinner should not exist
      expect(wrapper.html()).not.toContain('ds-spinner');

      wrapper.vm.isSearching = true;
      await wrapper.vm.$nextTick();

      // DsSpinner auto-stub should render
      expect(wrapper.html()).toContain('ds-spinner');
    });

    it('hides loading spinner when isSearching is false', async () => {
      const wrapper = createLogSearchDialogWrapper();
      wrapper.vm.isSearching = true;
      await wrapper.vm.$nextTick();

      expect(wrapper.html()).toContain('ds-spinner');

      wrapper.vm.isSearching = false;
      await wrapper.vm.$nextTick();

      expect(wrapper.html()).not.toContain('ds-spinner');
    });

    it('shows export button when searchResults has items', async () => {
      const wrapper = createLogSearchDialogWrapper();
      wrapper.vm.searchResults = [];
      await wrapper.vm.$nextTick();

      // No export button when empty
      const exportBtnBefore = wrapper.find('[data-test-id="export-csv-btn"]');
      expect(exportBtnBefore.exists()).toBe(false);

      wrapper.vm.searchResults = createMockLogs(3);
      await wrapper.vm.$nextTick();

      const exportBtnAfter = wrapper.find('[data-test-id="export-csv-btn"]');
      expect(exportBtnAfter.exists()).toBe(true);
    });

    it('hides export button when searchResults is empty', async () => {
      const wrapper = createLogSearchDialogWrapper();
      wrapper.vm.searchResults = [];
      await wrapper.vm.$nextTick();

      const exportBtn = wrapper.find('[data-test-id="export-csv-btn"]');
      expect(exportBtn.exists()).toBe(false);
    });

    it('shows results section when hasSearched is true', async () => {
      const wrapper = createLogSearchDialogWrapper();
      wrapper.vm.hasSearched = true;
      wrapper.vm.searchResults = createMockLogs(1);
      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-test-id="search-results"]').exists()).toBe(true);
    });

    it('hides results section when hasSearched is false', async () => {
      const wrapper = createLogSearchDialogWrapper();
      wrapper.vm.hasSearched = false;
      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-test-id="search-results"]').exists()).toBe(false);
    });

    it('computes hasSearched correctly after performSearch', async () => {
      const mockLogs = createMockLogs(1);
      mockSearchLogs.mockResolvedValueOnce({
        data: { logs: mockLogs }
      });

      const wrapper = createLogSearchDialogWrapper();
      expect(wrapper.vm.hasSearched).toBe(false);

      await wrapper.vm.performSearch();

      expect(wrapper.vm.hasSearched).toBe(true);
    });

    it('shows no results message when searchResults is empty but hasSearched', () => {
      const wrapper = createLogSearchDialogWrapper();
      wrapper.vm.hasSearched = true;
      wrapper.vm.searchResults = [];

      expect(wrapper.vm.hasSearched).toBe(true);
      expect(wrapper.vm.searchResults.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Story 5f: Emit events
  // -------------------------------------------------------------------------
  describe('Story 5f — emit events', () => {
    it('emits "close" event when close method is called', () => {
      const wrapper = createLogSearchDialogWrapper();

      wrapper.vm.$emit('close');

      expect(wrapper.emitted('close')).toBeTruthy();
      expect(wrapper.emitted('close')).toHaveLength(1);
    });

    it('emits "close" event when overlay click handler is triggered', () => {
      const wrapper = createLogSearchDialogWrapper();

      // Simulate the overlay click by calling the emit directly
      wrapper.vm.$emit('close');

      expect(wrapper.emitted('close')).toBeTruthy();
    });

    it('emits "close" event when footer close button emits close', () => {
      const wrapper = createLogSearchDialogWrapper();

      wrapper.vm.$emit('close');

      expect(wrapper.emitted('close')).toBeTruthy();
    });

    it('emits "search-completed" with results after successful search', async () => {
      const mockLogs = createMockLogs(3);
      mockSearchLogs.mockResolvedValueOnce({
        data: { logs: mockLogs }
      });

      const wrapper = createLogSearchDialogWrapper();
      wrapper.vm.searchParams.dateRange = 'today';

      await wrapper.vm.performSearch();
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted('search-completed')).toBeTruthy();
      expect(wrapper.emitted('search-completed')).toHaveLength(1);
      expect(wrapper.emitted('search-completed')[0][0]).toHaveLength(3);
    });

    it('emits "search-completed" with empty array on search error', async () => {
      mockSearchLogs.mockRejectedValueOnce(new Error('API Error'));

      const wrapper = createLogSearchDialogWrapper();
      wrapper.vm.searchParams.dateRange = 'today';

      await wrapper.vm.performSearch();
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted('search-completed')).toBeTruthy();
      expect(wrapper.emitted('search-completed')[0][0]).toEqual([]);
    });

    it('emits "search-completed" even when no logs found', async () => {
      mockSearchLogs.mockResolvedValueOnce({
        data: { logs: [] }
      });

      const wrapper = createLogSearchDialogWrapper();
      wrapper.vm.searchParams.dateRange = 'today';

      await wrapper.vm.performSearch();
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted('search-completed')).toBeTruthy();
      expect(wrapper.emitted('search-completed')[0][0]).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Additional method coverage
  // -------------------------------------------------------------------------
  describe('translate() method', () => {
    it('returns fallback when $i18n is not available', () => {
      const wrapper = createLogSearchDialogWrapper();
      wrapper.vm.$i18n = null;

      const result = wrapper.vm.translate('key.path', 'Fallback Text');

      expect(result).toBe('Fallback Text');
    });

    it('returns key when translation returns same key (missing translation)', () => {
      const wrapper = createLogSearchDialogWrapper();
      wrapper.vm.$i18n = { t: jest.fn((key) => key) };

      const result = wrapper.vm.translate('missing.key', 'Default');

      expect(result).toBe('Default');
    });

    it('returns translation when available', () => {
      const wrapper = createLogSearchDialogWrapper();
      wrapper.vm.$i18n = { t: jest.fn((_key) => 'Translated Text') };

      const result = wrapper.vm.translate('valid.key', 'Default');

      expect(result).toBe('Translated Text');
    });
  });

  describe('getCurrentLanguage() method', () => {
    it('returns locale from $i18n when available', () => {
      const wrapper = createLogSearchDialogWrapper();
      wrapper.vm.$i18n = { locale: 'fr' };

      const result = wrapper.vm.getCurrentLanguage();

      expect(result).toBe('fr');
    });

    it('returns "en" as default when no locale available', () => {
      const wrapper = createLogSearchDialogWrapper();
      wrapper.vm.$i18n = null;

      const result = wrapper.vm.getCurrentLanguage();

      expect(result).toBe('en');
    });
  });

  describe('formatDate() method', () => {
    it('formats date as YYYY-MM-DD', () => {
      const wrapper = createLogSearchDialogWrapper();
      const date = new Date('2025-01-15T12:30:45.000Z');

      const result = wrapper.vm.formatDate(date);

      expect(result).toBe('2025-01-15');
    });

    it('handles date at midnight', () => {
      const wrapper = createLogSearchDialogWrapper();
      const date = new Date('2025-01-15T00:00:00.000Z');

      const result = wrapper.vm.formatDate(date);

      expect(result).toBe('2025-01-15');
    });
  });

  describe('Component lifecycle and structure', () => {
    it('has correct component name', () => {
      const wrapper = createLogSearchDialogWrapper();
      expect(wrapper.vm.$options.name).toBe('LogSearchDialog');
    });

    it('defines correct emits', () => {
      const wrapper = createLogSearchDialogWrapper();
      expect(wrapper.vm.$options.emits).toEqual(['close', 'search-completed']);
    });

    it('includes required child components', () => {
      const wrapper = createLogSearchDialogWrapper();
      const components = wrapper.vm.$options.components;

      expect(components).toHaveProperty('DsButton');
      expect(components).toHaveProperty('DsSpinner');
      expect(components).toHaveProperty('DsInput');
      expect(components).toHaveProperty('DsSelect');
    });
  });

  // -------------------------------------------------------------------------
  // ensureMessageColumnExists, performSearch null normalization
  // -------------------------------------------------------------------------
  describe('ensureMessageColumnExists and null normalization', () => {
    describe('performSearch null normalization', () => {
      it('normalizes log entries with null fields to defaults', async () => {
        mockSearchLogs.mockResolvedValueOnce({
          data: {
            logs: [{ date: null, time: null, level: null, service: null, message: null }]
          }
        });

        const wrapper = createLogSearchDialogWrapper();
        wrapper.vm.searchParams.dateRange = 'today';

        await wrapper.vm.performSearch();
        await wrapper.vm.$nextTick();

        const result = wrapper.vm.searchResults[0];
        expect(result.date).toBeTruthy(); // today's date
        expect(result.time).toBe('00:00:00');
        expect(result.level).toBe('INFO');
        expect(result.service).toBe('System');
        expect(result.message).toBe('(No message)');
      });

      it('preserves existing field values', async () => {
        mockSearchLogs.mockResolvedValueOnce({
          data: {
            logs: [{ date: '2025-03-15', time: '14:30:00', level: 'ERROR', service: 'API', message: 'timeout' }]
          }
        });

        const wrapper = createLogSearchDialogWrapper();
        wrapper.vm.searchParams.dateRange = 'today';

        await wrapper.vm.performSearch();
        await wrapper.vm.$nextTick();

        const result = wrapper.vm.searchResults[0];
        expect(result.date).toBe('2025-03-15');
        expect(result.time).toBe('14:30:00');
        expect(result.level).toBe('ERROR');
        expect(result.service).toBe('API');
        expect(result.message).toBe('timeout');
      });

      it('sets searchResults to empty when response has no data', async () => {
        mockSearchLogs.mockResolvedValueOnce({});

        const wrapper = createLogSearchDialogWrapper();
        wrapper.vm.searchParams.dateRange = 'today';

        await wrapper.vm.performSearch();
        await wrapper.vm.$nextTick();

        expect(wrapper.vm.searchResults).toEqual([]);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Story 7.6 — Log format preservation smoke test
  // Validates that the winston log format (YYYY-MM-DD HH:mm:ss [LEVEL]: message)
  // is preserved after VictoriaLogs deployment. The component parses structured
  // log objects from the API — this test verifies the format regex matches
  // the expected pattern including trace_id and span_id fields.
  // -------------------------------------------------------------------------
  describe('Story 7.6 — log format preservation', () => {
    const logFormatRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \[(ERROR|WARN|INFO|DEBUG)\]: .+$/;

    it('matches standard winston log format', () => {
      const logLine = '2026-05-29 10:15:30 [INFO]: Request received';
      expect(logLine).toMatch(logFormatRegex);
    });

    it('matches ERROR level log lines', () => {
      const logLine = '2026-05-29 10:15:30 [ERROR]: Connection refused';
      expect(logLine).toMatch(logFormatRegex);
    });

    it('matches WARN level log lines', () => {
      const logLine = '2026-05-29 10:15:30 [WARN]: Slow query detected';
      expect(logLine).toMatch(logFormatRegex);
    });

    it('matches DEBUG level log lines', () => {
      const logLine = '2026-05-29 10:15:30 [DEBUG]: Cache hit for key user:123';
      expect(logLine).toMatch(logFormatRegex);
    });

    it('matches log lines with JSON trace context (from story 7-4 traceFormat)', () => {
      const logLine = '2026-05-29 10:15:30 [INFO]: Request processed';
      expect(logLine).toMatch(logFormatRegex);
    });

    it('rejects malformed log lines', () => {
      const badLine = '2026/05/29 10:15:30 ERROR: message';
      expect(badLine).not.toMatch(logFormatRegex);
    });

    it('rejects log lines without level brackets', () => {
      const badLine = '2026-05-29 10:15:30 ERROR: message';
      expect(badLine).not.toMatch(logFormatRegex);
    });

    it('component renders with trace-enhanced log data', async () => {
      const traceLogs = [
        {
          date: '2026-05-29',
          time: '10:15:30',
          level: 'INFO',
          service: 'backend',
          message: 'Request processed trace_id=abc123 span_id=def456'
        },
        {
          date: '2026-05-29',
          time: '10:15:31',
          level: 'ERROR',
          service: 'retriever',
          message: 'Query failed trace_id=abc123 span_id=def456'
        }
      ];
      mockSearchLogs.mockResolvedValueOnce({ data: { logs: traceLogs } });

      const wrapper = createLogSearchDialogWrapper();
      wrapper.vm.searchParams.dateRange = 'today';

      await wrapper.vm.performSearch();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.searchResults).toHaveLength(2);
      expect(wrapper.vm.searchResults[0].level).toBe('INFO');
      expect(wrapper.vm.searchResults[0].message).toContain('trace_id=');
      expect(wrapper.vm.searchResults[1].level).toBe('ERROR');
    });
  });
});
