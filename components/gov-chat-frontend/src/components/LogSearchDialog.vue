<template>
  <div class="modal">
    <div class="overlay" @click="$emit('close')"></div>
    <div class="modal-content">
      <div class="modal-title">
        <h2>{{ translate('admin.logSearch.title', 'Search Logs') }}</h2>
        <DsButton variant="ghost" class="close-btn" aria-label="Close dialog" @click="$emit('close')">×</DsButton>
      </div>

      <div class="modal-body">
        <!-- Loading indicator -->
        <DsSpinner v-if="isSearching" overlay>
          <p>
            {{ translate('admin.logSearch.searching', 'Searching logs...') }}
          </p>
        </DsSpinner>

        <!-- Search form -->
        <div class="search-form">
          <div class="search-row">
            <div class="search-field search-term">
              <label for="searchTerm">{{ translate('admin.logSearch.searchTerm', 'Search Term') }}</label>
              <DsInput
                id="searchTerm"
                v-model="searchParams.term"
                type="text"
                :placeholder="translate('admin.logSearch.searchPlaceholder', 'Search log messages...')"
              />
            </div>

            <div class="search-field">
              <label for="logLevel">{{ translate('admin.logSearch.level', 'Log Level') }}</label>
              <DsSelect
                id="logLevel"
                v-model="searchParams.level"
                :placeholder="translate('admin.logSearch.allLevels', 'All Levels')"
              >
                <option value="ERROR">
                  {{ translate('admin.logLevels.error', 'ERROR') }}
                </option>
                <option value="WARN">
                  {{ translate('admin.logLevels.warn', 'WARN') }}
                </option>
                <option value="INFO">
                  {{ translate('admin.logLevels.info', 'INFO') }}
                </option>
                <option value="DEBUG">
                  {{ translate('admin.logLevels.debug', 'DEBUG') }}
                </option>
              </DsSelect>
            </div>

            <div class="search-field">
              <label for="logService">{{ translate('admin.logSearch.service', 'Service') }}</label>
              <DsSelect
                id="logService"
                v-model="searchParams.service"
                :disabled="servicesLoading && availableServices.length === 0"
              >
                <option value="">
                  {{ translate('admin.logSearch.allServices', 'All Services') }}
                </option>
                <option v-for="svc in availableServices" :key="svc.name" :value="svc.name">
                  {{ svc.name }} ({{ svc.count }})
                </option>
              </DsSelect>
              <!-- Service-name dropdown is populated from /api/admin/logs/summary
                   (the `services` array, which queries VL `hits` with
                   `field=service.name` for every distinct service that emitted
                   a log in the requested window). Each option uses the EXACT
                   OTel resource attribute value, so the phrase match
                   `service.name:"<exact>"` on the backend hits. Sorted by
                   log volume (most active first). Refresh on dialog mount;
                   if VL is unreachable the dropdown stays empty and the
                   default "All Services" option remains selected. -->
            </div>
          </div>

          <div class="search-row">
            <div class="search-field date-range">
              <label for="dateRange">{{ translate('admin.logSearch.dateRange', 'Date Range') }}</label>
              <DsSelect id="dateRange" v-model="searchParams.dateRange">
                <option value="today">
                  {{ translate('admin.logSearch.today', 'Today') }}
                </option>
                <option value="yesterday">
                  {{ translate('admin.logSearch.yesterday', 'Yesterday') }}
                </option>
                <option value="week">
                  {{ translate('admin.logSearch.lastWeek', 'Last 7 Days') }}
                </option>
                <option value="month">
                  {{ translate('admin.logSearch.lastMonth', 'Last 30 Days') }}
                </option>
                <option value="custom">
                  {{ translate('admin.logSearch.customRange', 'Custom Range') }}
                </option>
              </DsSelect>
            </div>

            <div class="search-actions">
              <DsButton variant="primary" :disabled="isSearching" @click="performSearch">
                <svg
                  v-if="isSearching"
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="spin-icon"
                >
                  <path d="M21 12a9 9 1 1 1-6.219-8.56"></path>
                </svg>
                <svg
                  v-else
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="white"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                {{ translate('admin.logSearch.search', 'Search') }}
              </DsButton>
              <DsButton variant="secondary" :disabled="isSearching" @click="resetSearch">
                {{ translate('admin.logSearch.reset', 'Reset') }}
              </DsButton>
            </div>
          </div>

          <!-- Custom date range picker -->
          <div
            v-if="searchParams.dateRange === 'custom'"
            class="search-row custom-date-range"
            data-test-id="custom-date-range"
          >
            <div class="search-field">
              <label for="startDate">{{ translate('admin.logSearch.startDate', 'Start Date') }}</label>
              <DsInput id="startDate" v-model="searchParams.startDate" type="date" />
            </div>
            <div class="search-field">
              <label for="endDate">{{ translate('admin.logSearch.endDate', 'End Date') }}</label>
              <DsInput id="endDate" v-model="searchParams.endDate" type="date" />
            </div>
          </div>
        </div>

        <!-- Search results -->
        <div v-if="hasSearched" class="search-results" data-test-id="search-results">
          <div v-if="banner" class="degraded-banner" role="status" data-test-id="degraded-banner">
            {{ banner }}
          </div>
          <div class="results-header">
            <h3>
              {{ translate('admin.logSearch.results', 'Search Results') }}
            </h3>
            <span class="results-count">
              {{ searchResults.length }}
              {{ translate('admin.logSearch.entriesFound', 'entries found') }}
            </span>
          </div>

          <div class="table-container">
            <table v-if="searchResults.length > 0" :key="tableKey" class="results-table">
              <thead>
                <tr>
                  <th>{{ translate('admin.logDate', 'Date') }}</th>
                  <th>{{ translate('admin.logTime', 'Time') }}</th>
                  <th>{{ translate('admin.logLevel', 'Level') }}</th>
                  <th>{{ translate('admin.logService', 'Service') }}</th>
                  <th>{{ translate('admin.logMessage', 'Message') }}</th>
                </tr>
              </thead>
              <tbody>
                <!-- Keyed on row content, not position. `:key="index"` would
                     let Vue reuse a DOM node when a new search returns a
                     different set, carrying per-row state (selection, focus,
                     highlight) onto an unrelated log entry. The trailing
                     index keeps genuinely-duplicate rows distinct.

                     Note this is belt-and-braces today: `performSearch` bumps
                     `tableKey` on the parent `<table>`, so the whole table is
                     already remounted between searches. Keep both — the
                     parent key exists for the dynamic message column
                     (`ensureMessageColumnExists`), which is not a row-level
                     concern, and this one keeps the rows correct
                     independently of it. -->
                <tr
                  v-for="(log, index) in searchResults"
                  :key="`${log.date}-${log.time}-${log.service}-${log.message}-${index}`"
                >
                  <td>{{ log.date || 'N/A' }}</td>
                  <td>{{ log.time }}</td>
                  <td>
                    <span :class="['log-level', `log-${log.level.toLowerCase()}`]">
                      {{ log.level }}
                    </span>
                  </td>
                  <td>{{ log.service }}</td>
                  <td>{{ log.message || '' }}</td>
                </tr>
              </tbody>
            </table>

            <div v-else class="no-results">
              {{ translate('admin.logSearch.noResults', 'No logs matching your search criteria were found.') }}
            </div>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <div style="display: flex; justify-content: space-between; width: 100%">
          <div>
            <DsButton
              v-if="searchResults.length > 0"
              variant="secondary"
              data-test-id="export-csv-btn"
              @click="exportLogs"
            >
              {{ translate('admin.logSearch.export', 'Export CSV') }}
            </DsButton>
          </div>
          <div>
            <DsButton variant="primary" @click="$emit('close')">
              {{ translate('admin.operations.close', 'Close') }}
            </DsButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import adminDashboardService from '../services/adminDashboardService';
import DsButton from './ds/Button.vue';
import DsSpinner from './ds/Spinner.vue';
import DsInput from './ds/Input.vue';
import DsSelect from './ds/Select.vue';

export default {
  name: 'LogSearchDialog',
  components: {
    DsButton,
    DsSpinner,
    DsInput,
    DsSelect
  },
  props: {},
  emits: ['close', 'search-completed'],
  data() {
    return {
      currentLocale: this.getCurrentLanguage(),
      searchParams: {
        term: '',
        level: '',
        service: '',
        dateRange: 'today',
        startDate: this.formatDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
        endDate: this.formatDate(new Date())
      },
      hasSearched: false,
      isSearching: false,
      searchResults: [],
      tableKey: 0,
      searchError: null,
      lastResponseDegraded: false,
      // Populated from /api/admin/logs/summary on mount.
      availableServices: [],
      servicesLoading: false
    };
  },
  computed: {
    banner() {
      if (!this.hasSearched || !this.lastResponseDegraded) return null;
      return this.translate(
        'admin.logSearch.degraded',
        'Showing partial results due to VictoriaLogs outage. Some recent log entries may be missing.'
      );
    }
  },
  mounted() {
    this.loadServices();
  },
  methods: {
    /**
     * Populate the service dropdown with every distinct service.name
     * value that emitted a log in the last 24h. Failure (VL outage,
     * 401 after token expiry, network) leaves the dropdown empty and
     * the placeholder text "All Services" remains selected — searches
     * still work, they just don't get a service filter from the UI.
     */
    async loadServices() {
      this.servicesLoading = true;
      try {
        const today = this.formatDate(new Date());
        // `getLogsSummary` returns the full axios response envelope
        // (`{ data, status, headers, ... }`), not just `.data` — the
        // wire contract for `/admin/*` endpoints (AdminDashboard.vue
        // reads `response.data.errors` etc.). The `services` array
        // lives on `.data.services` after axios unwrapping.
        const summary = await adminDashboardService.getLogsSummary({
          date: today,
          level: ''
        });
        const services = Array.isArray(summary?.data?.services) ? summary.data.services : [];
        this.availableServices = services
          .filter((s) => s && s.name)
          .map((s) => ({ name: s.name, count: s.count || 0 }))
          .sort((a, b) => b.count - a.count);
      } catch (err) {
        // VL outage / 401 / network — fall back to an empty dropdown.
        // Console-only logging: the dropdown stays usable (manual
        // typing still works); operators see the degraded banner from
        // the rest of the page if VL is truly down.
        console.warn('[LogSearchDialog] failed to load service list:', err?.message || err);
        this.availableServices = [];
      } finally {
        this.servicesLoading = false;
      }
    },
    translate(key, fallback = '') {
      if (!this.$i18n) return fallback;
      try {
        const translation = this.$i18n.t(key, { locale: this.currentLocale });
        if (translation === key) {
          return fallback || key;
        }
        return translation;
      } catch (e) {
        console.error('Translation error:', e);
        return fallback || key;
      }
    },
    getCurrentLanguage() {
      if (this.$i18n && this.$i18n.locale) {
        return this.$i18n.locale;
      }
      try {
        const savedLocale = localStorage.getItem('userLocale');
        if (savedLocale) {
          return savedLocale;
        }
        // eslint-disable-next-line no-empty
      } catch {}
      return 'en';
    },
    formatDate(date) {
      return date.toISOString().split('T')[0];
    },
    ensureMessageColumnExists() {
      this.$nextTick(() => {
        const table = document.querySelector('.results-table');
        if (table) {
          const headerRow = table.querySelector('thead tr');
          if (headerRow && headerRow.children.length < 5) {
            const messageHeader = document.createElement('th');
            messageHeader.textContent = this.translate('admin.logMessage', 'Message');
            headerRow.appendChild(messageHeader);
            const dataRows = table.querySelectorAll('tbody tr');
            dataRows.forEach((row, index) => {
              if (row.children.length < 5) {
                const messageCell = document.createElement('td');
                messageCell.textContent = this.searchResults[index].message || '';
                row.appendChild(messageCell);
              }
            });
          }
        }
      });
    },
    async performSearch() {
      try {
        this.hasSearched = true;
        this.isSearching = true;
        this.searchError = null;
        const searchParams = {
          term: this.searchParams.term,
          level: this.searchParams.level,
          service: this.searchParams.service,
          dateRange: this.searchParams.dateRange
        };
        if (this.searchParams.dateRange === 'custom') {
          searchParams.startDate = this.searchParams.startDate;
          searchParams.endDate = this.searchParams.endDate;
        }
        const response = await adminDashboardService.searchLogs(searchParams);
        let logs = [];
        this.lastResponseDegraded = false;
        if (response && response.data) {
          // T8 contract: VL outage surfaces as HTTP 503 + body
          // `{error: 'vl_unreachable', message}` — the legacy
          // `response.data.degraded` boolean envelope is gone. The
          // axios interceptor lets the 503 propagate as a rejected
          // promise (handled by the catch block below), but a soft
          // 503 from a non-default error path can still arrive here
          // — surface the degraded banner in both cases.
          this.lastResponseDegraded = response.status === 503 || response.data?.error === 'vl_unreachable';
          logs = response.data.logs || response.data.data?.logs || [];
          if (this.searchParams.level && logs.length > 0) {
            if (this.searchParams.level === 'WARN') {
              logs = logs.filter((log) => log.level.toUpperCase() === 'WARN' || log.level.toUpperCase() === 'WARNING');
            } else {
              logs = logs.filter((log) => log.level.toUpperCase() === this.searchParams.level.toUpperCase());
            }
          }
          const today = new Date().toISOString().split('T')[0];
          logs = logs.map((log) => ({
            date: log.date || today,
            time: log.time || '00:00:00',
            level: log.level || 'INFO',
            service: log.service || 'System',
            message: log.message || '(No message)'
          }));
          this.searchResults = logs;
          this.tableKey++;
          this.ensureMessageColumnExists();
        } else {
          this.searchResults = [];
        }
        this.$emit('search-completed', this.searchResults);
      } catch (error) {
        console.error('Error searching logs:', error);
        this.searchError = error.message || 'An error occurred while searching logs';
        this.searchResults = [];
        this.lastResponseDegraded = false;
        this.$emit('search-completed', []);
      } finally {
        this.isSearching = false;
      }
    },
    resetSearch() {
      this.searchParams = {
        term: '',
        level: '',
        service: '',
        dateRange: 'today',
        startDate: this.formatDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
        endDate: this.formatDate(new Date())
      };
      this.hasSearched = false;
      this.searchResults = [];
      this.searchError = null;
      this.lastResponseDegraded = false;
    },
    exportLogs() {
      if (!this.searchResults.length) return;
      try {
        const headers = ['Date', 'Time', 'Level', 'Service', 'Message'];
        const csvContent = [
          headers.join(','),
          ...this.searchResults.map((log) =>
            [
              log.date || 'N/A',
              log.time,
              log.level,
              `"${(log.service || '').replace(/"/g, '""')}"`,
              `"${(log.message || '').replace(/"/g, '""')}"`
            ].join(',')
          )
        ].join('\n');
        const blob = new Blob([csvContent], {
          type: 'text/csv;charset=utf-8;'
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `log-export-${new Date().toISOString().slice(0, 10)}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (error) {
        console.error('Error exporting logs:', error);
      }
    }
  }
};
</script>

<style>
/* Modal Base Styles */
.modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--overlay-bg);
}

.overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}

.modal-content {
  position: relative;
  width: 90%;
  max-width: calc(800px + 2in);
  max-height: 90vh;
  background-color: var(--surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  z-index: 1101;
}

.modal-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--border);
}

.modal-title h2 {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--fg);
}

.close-btn {
  width: 28px;
  height: 28px;
  padding: 0;
}

.modal-body {
  padding: var(--space-lg);
  overflow-y: auto;
  flex-grow: 1;
  max-height: calc(90vh - 130px);
  position: relative;
}

.modal-footer {
  padding: var(--space-md) var(--space-lg);
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: flex-end;
}

.spin-icon {
  animation: spin 1s linear infinite;
  margin-right: var(--space-xs);
}

/* Search Form Styles */
.search-form {
  margin-bottom: var(--space-lg);
  padding: var(--space-lg);
  background-color: var(--bg-tertiary);
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
}

.search-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-md);
  margin-bottom: var(--space-md);
}

.search-row:last-child {
  margin-bottom: 0;
}

.search-field {
  flex: 1;
  min-width: 200px;
}

.search-field.search-term {
  flex: 2;
}

.search-field.date-range {
  flex: 2;
}

.search-field label {
  display: block;
  margin-bottom: 0.375rem;
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--fg);
}

.search-actions {
  display: flex;
  align-items: flex-end;
  gap: var(--space-sm);
  justify-content: flex-end;
  min-width: 200px;
}

.custom-date-range {
  border-top: 1px solid var(--border);
  padding-top: var(--space-md);
}

/* Search Results Styles */
.search-results {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.degraded-banner {
  padding: var(--space-sm) var(--space-md);
  background-color: var(--warning-bg);
  color: var(--warning);
  font-size: var(--text-base);
  font-weight: 500;
  border-bottom: 1px solid var(--border);
}

.results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-md) var(--space-md);
  background-color: var(--bg-tertiary);
  border-bottom: 1px solid var(--border);
}

.results-header h3 {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--fg);
}

.results-count {
  font-size: var(--text-base);
  color: var(--fg);
}

.table-container {
  max-height: 300px;
  overflow-y: auto;
  overflow-x: auto;
  white-space: nowrap;
}

.results-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-base);
  table-layout: auto;
}

.results-table th,
.results-table td {
  padding: var(--space-md) var(--space-md);
  text-align: left;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}

.results-table th {
  font-weight: 600;
  background-color: var(--bg);
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 2px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 1;
}

.results-table tr:last-child td {
  border-bottom: none;
}

.results-table th:nth-child(1),
.results-table td:nth-child(1),
.results-table th:nth-child(2),
.results-table td:nth-child(2),
.results-table th:nth-child(3),
.results-table td:nth-child(3),
.results-table th:nth-child(4),
.results-table td:nth-child(4) {
  width: auto;
  white-space: nowrap;
}

.results-table th:nth-child(5),
.results-table td:nth-child(5) {
  min-width: 200px;
  white-space: normal;
  word-wrap: break-word;
}

.log-level {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  font-weight: 600;
  text-transform: uppercase;
}

.log-error {
  background-color: var(--danger-bg);
  color: var(--danger);
}

.log-warn,
.log-warning {
  background-color: var(--warning-bg);
  color: var(--warning);
}

.log-info {
  background-color: var(--info-bg);
  color: var(--accent);
}

.no-results {
  padding: var(--space-xl);
  text-align: center;
  color: var(--muted-soft);
  font-style: italic;
}

/* Responsive adjustments */
@media (max-width: 480px) {
  .search-row {
    flex-direction: column;
    gap: var(--space-md);
  }
  .search-field {
    width: 100%;
  }
  .search-actions {
    justify-content: flex-start;
    width: 100%;
    padding-top: var(--space-sm);
  }
  .table-container {
    overflow-x: auto;
  }
}

/* Force display of message column */
.results-table th:last-child,
.results-table td:last-child {
  white-space: normal;
  word-wrap: break-word;
}

.results-table th:nth-child(5),
.results-table td:nth-child(5) {
  display: table-cell;
}
</style>
