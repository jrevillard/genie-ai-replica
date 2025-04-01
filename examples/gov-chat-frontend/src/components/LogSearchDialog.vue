<template>
    <div class="modal" :data-theme="theme">
        <div class="overlay" @click="$emit('close')"></div>
        <div class="modal-content">
            <div class="modal-title">
                <h2>{{ translate('admin.logSearch.title', 'Search Logs') }}</h2>
                <button class="close-btn" @click="$emit('close')" aria-label="Close dialog">×</button>
            </div>

            <div class="modal-body">
                <!-- Search form -->
                <div class="search-form">
                    <div class="search-row">
                        <div class="search-field search-term">
                            <label for="searchTerm">{{ translate('admin.logSearch.searchTerm', 'Search Term') }}</label>
                            <input type="text" id="searchTerm" v-model="searchParams.term"
                                :placeholder="translate('admin.logSearch.searchPlaceholder', 'Search log messages...')" />
                        </div>

                        <div class="search-field">
                            <label for="logLevel">{{ translate('admin.logSearch.level', 'Log Level') }}</label>
                            <select id="logLevel" v-model="searchParams.level">
                                <option value="">{{ translate('admin.logSearch.allLevels', 'All Levels') }}</option>
                                <option value="ERROR">{{ translate('admin.logLevels.error', 'ERROR') }}</option>
                                <option value="WARNING">{{ translate('admin.logLevels.warning', 'WARNING') }}</option>
                                <option value="INFO">{{ translate('admin.logLevels.info', 'INFO') }}</option>
                            </select>
                        </div>

                        <div class="search-field">
                            <label for="logService">{{ translate('admin.logSearch.service', 'Service') }}</label>
                            <select id="logService" v-model="searchParams.service">
                                <option value="">{{ translate('admin.logSearch.allServices', 'All Services') }}</option>
                                <option value="API Gateway">{{ translate('admin.services.apiGateway', 'API Gateway') }}
                                </option>
                                <option value="Auth Service">{{ translate('admin.services.authService', 'Auth Service')
                                    }}</option>
                                <option value="Data Service">{{ translate('admin.services.dataService', 'Data Service')
                                    }}</option>
                                <option value="Storage">{{ translate('admin.services.storage', 'Storage') }}</option>
                                <option value="Cache">{{ translate('admin.services.cache', 'Cache') }}</option>
                            </select>
                        </div>
                    </div>

                    <div class="search-row">
                        <div class="search-field date-range">
                            <label for="dateRange">{{ translate('admin.logSearch.dateRange', 'Date Range') }}</label>
                            <select id="dateRange" v-model="searchParams.dateRange">
                                <option value="today">{{ translate('admin.logSearch.today', 'Today') }}</option>
                                <option value="yesterday">{{ translate('admin.logSearch.yesterday', 'Yesterday') }}
                                </option>
                                <option value="week">{{ translate('admin.logSearch.lastWeek', 'Last 7 Days') }}</option>
                                <option value="month">{{ translate('admin.logSearch.lastMonth', 'Last 30 Days') }}
                                </option>
                                <option value="custom">{{ translate('admin.logSearch.customRange', 'Custom Range') }}
                                </option>
                            </select>
                        </div>

                        <div class="search-actions">
                            <button class="btn btn-primary" @click="performSearch">
                                {{ translate('admin.logSearch.search', 'Search') }}
                            </button>
                            <button class="btn btn-outline" @click="resetSearch">
                                {{ translate('admin.logSearch.reset', 'Reset') }}
                            </button>
                        </div>
                    </div>

                    <!-- Custom date range picker (shown when custom range is selected) -->
                    <div class="search-row custom-date-range" v-if="searchParams.dateRange === 'custom'">
                        <div class="search-field">
                            <label for="startDate">{{ translate('admin.logSearch.startDate', 'Start Date') }}</label>
                            <input type="date" id="startDate" v-model="searchParams.startDate" />
                        </div>

                        <div class="search-field">
                            <label for="endDate">{{ translate('admin.logSearch.endDate', 'End Date') }}</label>
                            <input type="date" id="endDate" v-model="searchParams.endDate" />
                        </div>
                    </div>
                </div>

                <!-- Search results -->
                <div class="search-results" v-if="hasSearched">
                    <div class="results-header">
                        <h3>{{ translate('admin.logSearch.results', 'Search Results') }}</h3>
                        <span class="results-count">
                            {{ searchResults.length }} {{ translate('admin.logSearch.entriesFound', 'entries found') }}
                        </span>
                    </div>

                    <div class="table-container">
                        <table class="results-table" v-if="searchResults.length > 0">
                            <thead>
                                <tr>
                                    <th>{{ translate('admin.logTime', 'Time') }}</th>
                                    <th>{{ translate('admin.logLevel', 'Level') }}</th>
                                    <th>{{ translate('admin.logService', 'Service') }}</th>
                                    <th>{{ translate('admin.logMessage', 'Message') }}</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="(log, index) in searchResults" :key="index">
                                    <td>{{ log.time }}</td>
                                    <td>
                                        <span :class="['log-level', `log-${log.level.toLowerCase()}`]">
                                            {{ translate(`admin.logLevels.${log.level.toLowerCase()}`, log.level) }}
                                        </span>
                                    </td>
                                    <td>{{ log.service }}</td>
                                    <td>{{ log.message }}</td>
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
                <button class="btn btn-primary" @click="$emit('close')">
                    {{ translate('admin.operations.close', 'Close') }}
                </button>
            </div>
        </div>
    </div>
</template>

<script>
export default {
    name: 'LogSearchDialog',
    props: {
        theme: {
            type: String,
            default: 'light'
        }
    },
    emits: ['close'],
    data() {
        return {
            // Current locale for translations (copied from AdminDashboard)
            currentLocale: this.getCurrentLanguage(),

            // Search parameters
            searchParams: {
                term: '',
                level: '',
                service: '',
                dateRange: 'today',
                startDate: this.formatDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)), // 7 days ago
                endDate: this.formatDate(new Date())
            },

            // Search state and results
            hasSearched: false,
            searchResults: [],

            // Mock data for demonstration
            mockLogs: [
                {
                    time: '10:42:15',
                    level: 'ERROR',
                    service: 'API Gateway',
                    message: 'Connection timeout to external provider'
                },
                {
                    time: '09:36:22',
                    level: 'ERROR',
                    service: 'API Gateway',
                    message: 'Connection timeout to external provider'
                },
                {
                    time: '08:17:45',
                    level: 'ERROR',
                    service: 'Data Service',
                    message: 'Database query failed: connection refused'
                },
                {
                    time: '10:38:22',
                    level: 'WARNING',
                    service: 'Storage',
                    message: 'Disk space below 10% threshold'
                },
                {
                    time: '11:15:33',
                    level: 'WARNING',
                    service: 'Database',
                    message: 'Slow query detected (2.5s): SELECT * FROM large_table WHERE...'
                },
                {
                    time: '10:05:19',
                    level: 'INFO',
                    service: 'Auth Service',
                    message: 'User role updated for admin@huduma.ai'
                },
                {
                    time: '10:12:44',
                    level: 'INFO',
                    service: 'Data Service',
                    message: 'Automatic backup completed successfully'
                }
            ]
        };
    },
    methods: {
        // Translation method (copied from AdminDashboard for consistency)
        translate(key, fallback = '') {
            if (!this.$i18n) return fallback;
            try {
                // Force the correct locale
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

        // Get current language (copied from AdminDashboard)
        getCurrentLanguage() {
            // First try to get from i18n instance
            if (this.$i18n && this.$i18n.locale) {
                return this.$i18n.locale;
            }

            // Fallback to localStorage
            try {
                const savedLocale = localStorage.getItem('userLocale');
                if (savedLocale) {
                    return savedLocale;
                }
            } catch (e) {
                console.warn('Error accessing localStorage for language:', e);
            }

            // Default to English if nothing else works
            return 'en';
        },

        // Format date for input fields
        formatDate(date) {
            return date.toISOString().split('T')[0];
        },

        // Perform search operation
        performSearch() {
            // This would typically make an API call to your backend
            // For now, we'll filter the mock data client-side

            this.hasSearched = true;

            // Filter mock logs based on search parameters
            this.searchResults = this.mockLogs.filter(log => {
                // Filter by level
                if (this.searchParams.level && log.level !== this.searchParams.level) {
                    return false;
                }

                // Filter by service
                if (this.searchParams.service && log.service !== this.searchParams.service) {
                    return false;
                }

                // Filter by search term (case insensitive)
                if (this.searchParams.term && !log.message.toLowerCase().includes(this.searchParams.term.toLowerCase())) {
                    return false;
                }

                // For demo purposes, we'll assume all mock logs are from today
                // In a real implementation, you would filter by date range here

                return true;
            });
        },

        // Reset search form
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
        }
    }
};
</script>

<style scoped>
/* Modal Base Styles - Matching OperationResultsModal for consistency */
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
  background-color: rgba(0, 0, 0, 0.5);
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
  max-width: 800px;
  max-height: 90vh;
  background-color: var(--bg-dialog, #ffffff);
  border-radius: 8px;
  box-shadow: 0 5px 20px rgba(0, 0, 0, 0.2);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  z-index: 1101;
}

.modal-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--border-color, #dcdfe4);
}

.modal-title h2 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary, #333333);
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
  color: var(--text-tertiary, #767676);
  padding: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: all 0.2s;
}

.close-btn:hover {
  background-color: var(--bg-section, rgba(0, 0, 0, 0.05));
  color: var(--text-secondary, #4d4d4d);
}

.modal-body {
  padding: 1.5rem;
  overflow-y: auto;
  flex-grow: 1;
  max-height: calc(90vh - 130px);
}

.modal-footer {
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--border-color, #dcdfe4);
  display: flex;
  justify-content: flex-end;
}

/* Search Form Styles */
.search-form {
  margin-bottom: 1.5rem;
  padding: 1.25rem;
  background-color: var(--bg-section, rgba(0, 0, 0, 0.02));
  border-radius: 6px;
  border: 1px solid var(--border-color, #dcdfe4);
}

.search-row {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin-bottom: 1rem;
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
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-secondary, #4d4d4d);
}

.search-field input,
.search-field select {
  width: 100%;
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  border: 1px solid var(--border-input, #dcdfe4);
  border-radius: 4px;
  background-color: var(--bg-input, #ffffff);
  color: var(--text-primary, #333333);
}

.search-field input:focus,
.search-field select:focus {
  outline: none;
  border-color: var(--primary, #3b82f6);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
}

.search-actions {
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
  justify-content: flex-end;
  min-width: 200px;
}

.custom-date-range {
  border-top: 1px solid var(--border-color, #dcdfe4);
  padding-top: 1rem;
}

/* Search Results Styles */
.search-results {
  border: 1px solid var(--border-color, #dcdfe4);
  border-radius: 6px;
  overflow: hidden;
}

.results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  background-color: var(--bg-section, rgba(0, 0, 0, 0.02));
  border-bottom: 1px solid var(--border-color, #dcdfe4);
}

.results-header h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary, #333333);
}

.results-count {
  font-size: 0.875rem;
  color: var(--text-secondary, #4d4d4d);
}

.table-container {
  max-height: 300px;
  overflow-y: auto;
}

.results-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.results-table th,
.results-table td {
  padding: 0.75rem 1rem;
  text-align: left;
  border-bottom: 1px solid var(--border-color, #dcdfe4);
}

.results-table th {
  font-weight: 600;
  position: sticky;
  top: 0;
  background-color: var(--bg-dialog, #ffffff);
  z-index: 1;
  box-shadow: 0 1px 0 var(--border-color, #dcdfe4);
  color: var(--text-secondary, #4d4d4d);
}

.results-table tr:last-child td {
  border-bottom: none;
}

.log-level {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.25rem 0.5rem;
  border-radius: 3px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
}

.log-error {
  background-color: rgba(239, 68, 68, 0.1);
  color: var(--danger, #ef4444);
}

.log-warning {
  background-color: rgba(245, 158, 11, 0.1);
  color: var(--warning, #f59e0b);
}

.log-info {
  background-color: rgba(59, 130, 246, 0.1);
  color: var(--primary, #3b82f6);
}

.no-results {
  padding: 2rem;
  text-align: center;
  color: var(--text-tertiary, #767676);
  font-style: italic;
}

/* Button Styles (matching AdminDashboard) */
.btn {
  padding: 0.5rem 0.75rem;
  border-radius: 0.375rem;
  border: none;
  font-size: 0.875rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  transition: all 0.2s;
}

.btn-primary {
  background-color: var(--bg-button-primary, #3b82f6);
  color: var(--text-button-primary, #ffffff);
}

.btn-primary:hover {
  background-color: var(--primary-dark, #2563eb);
}

.btn-outline {
  background-color: transparent;
  border: 1px solid var(--border-color, #dcdfe4);
  color: var(--text-secondary, #4d4d4d);
}

.btn-outline:hover {
  background-color: var(--bg-section, rgba(0, 0, 0, 0.02));
}

/* Dark mode adjustments - Matching the provided screenshot's gray shade */
[data-theme="dark"] .modal-content {
  background-color: #2b2b2b !important;
}

[data-theme="dark"] .modal-body {
  background-color: #2b2b2b !important;
}

[data-theme="dark"] .modal-title {
  background-color: #2b2b2b !important;
  border-color: #3d3d3d !important;
}

[data-theme="dark"] .modal-title h2 {
  color: #f8fafc !important;
}

[data-theme="dark"] .modal-footer {
  background-color: #2b2b2b !important;
  border-color: #3d3d3d !important;
}

[data-theme="dark"] .search-form {
  background-color: #333333 !important;
  border-color: #3d3d3d !important;
}

[data-theme="dark"] .search-field label {
  color: #bbbbbb !important;
}

[data-theme="dark"] .search-field input,
[data-theme="dark"] .search-field select {
  background-color: #252525 !important;
  color: #e0e0e0 !important;
  border-color: #3d3d3d !important;
}

[data-theme="dark"] .results-header {
  background-color: #333333 !important;
  border-color: #3d3d3d !important;
}

[data-theme="dark"] .results-header h3 {
  color: #f8fafc !important;
}

[data-theme="dark"] .search-results {
  background-color: #2b2b2b !important;
  border-color: #3d3d3d !important;
}

[data-theme="dark"] .custom-date-range {
  border-color: #3d3d3d !important;
}

[data-theme="dark"] .results-table th {
  background-color: #333333 !important;
  color: #bbbbbb !important;
  box-shadow: 0 1px 0 #3d3d3d !important;
}

[data-theme="dark"] .results-table td {
  border-color: #3d3d3d !important;
}

[data-theme="dark"] .no-results {
  color: #888888 !important;
}

[data-theme="dark"] .btn-outline {
  border-color: #3d3d3d !important;
  color: #bbbbbb !important;
}

[data-theme="dark"] .btn-outline:hover {
  background-color: #3a3a3a !important;
}

/* Force all background elements to use the correct gray in dark mode */
[data-theme="dark"] .table-container {
  background-color: #2b2b2b !important;
}

[data-theme="dark"] .results-table {
  background-color: #2b2b2b !important;
}

[data-theme="dark"] .results-table tr {
  background-color: #2b2b2b !important;
}

/* Responsive adjustments */
@media (max-width: 640px) {
  .search-row {
    flex-direction: column;
    gap: 0.75rem;
  }
  
  .search-field {
    width: 100%;
  }
  
  .search-actions {
    justify-content: flex-start;
    width: 100%;
    padding-top: 0.5rem;
  }
}
</style>