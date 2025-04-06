<template>
  <!-- Add backdrop -->
  <div class="admin-backdrop" @click="$emit('close')"></div>

  <div class="admin-dashboard">
    <!-- Close button -->
    <button class="close-dashboard-btn" @click="$emit('close')"
      :aria-label="translate('admin.close', 'Close dashboard')">
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>

    <div class="dashboard">
      <!-- Sidebar -->
      <div class="sidebar">
        <div class="logo">
          <div class="logo-icon">H</div>
          <span>{{ translate('admin.huduma', 'Huduma AI') }}</span>
        </div>

        <div class="nav-section">
          <div class="nav-header">{{ translate('admin.dashboard', 'Dashboard') }}</div>
          <ul class="nav-items">
            <li class="nav-item">
              <a href="#" class="nav-link active" @click.prevent="setActiveTab('overview')">
                <i>📊</i>
                <span>{{ translate('admin.overview', 'Overview') }}</span>
              </a>
            </li>
          </ul>
        </div>

        <div class="nav-section">
          <div class="nav-header">{{ translate('admin.system', 'System') }}</div>
          <ul class="nav-items">
            <li class="nav-item">
              <a href="#" class="nav-link" @click.prevent="setActiveTab('database')">
                <i>💾</i>
                <span>{{ translate('admin.database', 'Database') }}</span>
              </a>
            </li>
            <li class="nav-item">
              <a href="#" class="nav-link" @click.prevent="setActiveTab('logs')">
                <i>📋</i>
                <span>{{ translate('admin.logs', 'Logs') }}</span>
              </a>
            </li>
          </ul>
        </div>

        <div class="nav-section">
          <div class="nav-header">{{ translate('admin.settings', 'Settings') }}</div>
          <ul class="nav-items">
            <li class="nav-item">
              <a href="#" class="nav-link" @click.prevent="setActiveTab('users')">
                <i>👥</i>
                <span>{{ translate('admin.userManagement', 'User Management') }}</span>
              </a>
            </li>
            <li class="nav-item">
              <a href="#" class="nav-link" @click.prevent="setActiveTab('security')">
                <i>🔒</i>
                <span>{{ translate('admin.security', 'Security') }}</span>
              </a>
            </li>
          </ul>
        </div>
      </div>

      <!-- Main Content -->
      <div class="main">
        <div class="header">
          <h1 class="page-title">{{ translate('admin.systemAdministration', 'System Administration') }}</h1>
        </div>

        <!-- Quick Stats -->
        <div class="quick-stats">
          <div class="stat-card">
            <div class="stat-title">{{ translate('admin.systemUptime', 'System Uptime') }}</div>
            <div class="stat-value">{{ metrics.systemUptime }}%</div>
            <div class="stat-trend trend-up">
              <span>↑ 0.2%</span> {{ translate('admin.fromLastMonth', 'from last month') }}
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-title">{{ translate('admin.avgResponseTime', 'Average Response Time') }}</div>
            <div class="stat-value">{{ metrics.avgResponseTime }}ms</div>
            <div class="stat-trend trend-down">
              <span>↓ 12%</span> {{ translate('admin.fromLastMonth', 'from last month') }}
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-title">{{ translate('admin.errorRate', 'Error Rate') }}</div>
            <div class="stat-value">{{ metrics.errorRate }}%</div>
            <div class="stat-trend trend-up">
              <span>↑ 0.01%</span> {{ translate('admin.fromLastMonth', 'from last month') }}
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-title">{{ translate('admin.activeUsers', 'Active Users') }}</div>
            <div class="stat-value">{{ metrics.activeUsers.toLocaleString() }}</div>
            <div class="stat-trend trend-up">
              <span>↑ 15%</span> {{ translate('admin.fromLastMonth', 'from last month') }}
            </div>
          </div>
        </div>

        <!-- System Tabs -->
        <div class="tabs">
          <div class="tab-header">
            <button v-for="tab in tabs" :key="tab.id" class="tab-btn" :class="{ active: activeTab === tab.id }"
              @click="setActiveTab(tab.id)">
              {{ translate(`admin.tabs.${tab.id}`, tab.label) }}
            </button>
          </div>

          <div class="tab-content">
            <div class="dashboard-grid">
              <!-- System Health Card - Overview Tab Only -->
              <div class="dashboard-card" v-if="activeTab === 'overview'">
                <div class="card-header">
                  <div class="card-title">{{ translate('admin.systemHealthStatus', 'System Health Status') }}</div>
                  <div class="card-actions">
                    <button class="btn btn-outline" @click="runDiagnostics">
                      {{ translate('admin.runDiagnostics', 'Run Diagnostics') }}
                    </button>
                  </div>
                </div>

                <div class="health-status">
                  <div v-for="service in healthServices" :key="service.name"
                    :class="['health-item', `status-${service.status}`]">
                    <div :class="['status-badge', `badge-${service.status}`]"></div>
                    <span>{{ translate(`admin.services.${service.id}`, service.name) }}</span>
                  </div>
                </div>
              </div>

              <!-- Resource Usage - Overview Tab Only -->
              <div class="dashboard-card" v-if="activeTab === 'overview'">
                <div class="card-header">
                  <div class="card-title">{{ translate('admin.resourceUsage', 'Resource Usage') }}</div>
                </div>

                <div class="resource-usage">
                  <div v-for="resource in resourceUsage" :key="resource.id" class="usage-item">
                    <div class="usage-header">
                      <div class="usage-label">{{ resource.label }}</div>
                      <div class="usage-value">{{ resource.value }}%</div>
                    </div>
                    <div class="usage-bar">
                      <div :class="['usage-fill', `usage-${getUsageLevel(resource.value)}`]"
                        :style="{ width: `${resource.value}%` }"></div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Database Management - Database Tab Only -->
              <div class="dashboard-card" v-if="activeTab === 'database'" style="grid-column: span 2;">
                <div class="card-header">
                  <div class="card-title">{{ translate('admin.databaseManagement', 'Database Management') }}</div>
                  <div class="card-actions">
                    <button class="btn btn-primary" @click="reindexDatabase">
                      {{ translate('admin.reindexDatabase', 'Reindex Database') }}
                    </button>
                  </div>
                </div>

                <div class="db-actions">
                  <div class="db-action-card" @click="reindexDatabase">
                    <div class="action-icon">🔄</div>
                    <div class="action-title">{{ translate('admin.dbActions.reindex', 'Reindex') }}</div>
                    <div class="action-desc">{{ translate('admin.dbActions.reindexDesc', 'Rebuild database indexes') }}
                    </div>
                  </div>
                  <div class="db-action-card" @click="backupDatabase">
                    <div class="action-icon">💾</div>
                    <div class="action-title">{{ translate('admin.dbActions.backup', 'Backup') }}</div>
                    <div class="action-desc">{{ translate('admin.dbActions.backupDesc', 'Create database backup') }}
                    </div>
                  </div>
                  <div class="db-action-card" @click="optimizeDatabase">
                    <div class="action-icon">📊</div>
                    <div class="action-title">{{ translate('admin.dbActions.optimize', 'Optimize') }}</div>
                    <div class="action-desc">{{ translate('admin.dbActions.optimizeDesc', 'Optimize query performance')
                      }}</div>
                  </div>
                </div>

                <div class="db-stats">
                  <div><strong>{{ translate('admin.lastReindex', 'Last Reindex') }}:</strong> {{ dbStats.lastReindex }}
                  </div>
                  <div><strong>{{ translate('admin.databaseSize', 'Database Size') }}:</strong> {{ dbStats.databaseSize
                    }}</div>
                  <div><strong>{{ translate('admin.totalTables', 'Total Tables') }}:</strong> {{ dbStats.totalTables }}
                  </div>
                </div>
              </div>

              <!-- Log Management - Logs Tab Only -->
              <div class="dashboard-card" v-if="activeTab === 'logs'" style="grid-column: span 2;">
                <div class="card-header">
                  <div class="card-title">{{ translate('admin.logManagement', 'Log Management') }}</div>
                  <div class="card-actions">
                    <button class="btn btn-outline" @click="searchLogs">
                      <span style="display: flex; align-items: center;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
                          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                          style="margin-right: 4px;">
                          <circle cx="11" cy="11" r="8"></circle>
                          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                        {{ translate('admin.searchLogs', 'Search Logs') }}
                      </span>
                    </button>
                    <button class="btn btn-outline" @click="rolloverLogs" style="margin-left: 8px;">
                      <span style="display: flex; align-items: center;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
                          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                          style="margin-right: 4px;">
                          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38" />
                        </svg>
                        {{ translate('admin.rolloverLogs', 'Rollover Logs') }}
                      </span>
                    </button>
                  </div>
                </div>

                <!-- Error Logs Summary -->
                <div class="logs-summary">
                  <h3 class="summary-title">
                    <span class="status-indicator error"></span>
                    {{ translate('admin.errorLogs', 'Error Logs') }} ({{ translate('admin.today', 'Today') }})
                  </h3>
                  <div class="log-summary-table">
                    <table>
                      <thead>
                        <tr>
                          <th>{{ translate('admin.logType', 'Type') }}</th>
                          <th>{{ translate('admin.logService', 'Service') }}</th>
                          <th>{{ translate('admin.logCount', 'Count') }}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="(log, index) in errorLogsSummary" :key="'error-' + index">
                          <td>{{ translate(`admin.logTypes.${log.typeKey}`, log.type) }}</td>
                          <td>{{ log.service }}</td>
                          <td class="log-count">{{ log.count }}</td>
                        </tr>
                        <tr v-if="errorLogsSummary.length === 0">
                          <td colspan="3" class="empty-logs">{{ translate('admin.noErrorLogs', 'No error logs recorded today.') }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <!-- Warning Logs Summary -->
                <div class="logs-summary">
                  <h3 class="summary-title">
                    <span class="status-indicator warning"></span>
                    {{ translate('admin.warningLogs', 'Warning Logs') }} ({{ translate('admin.today', 'Today') }})
                  </h3>
                  <div class="log-summary-table">
                    <table>
                      <thead>
                        <tr>
                          <th>{{ translate('admin.logType', 'Type') }}</th>
                          <th>{{ translate('admin.logService', 'Service') }}</th>
                          <th>{{ translate('admin.logCount', 'Count') }}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="(log, index) in warningLogsSummary" :key="'warning-' + index">
                          <td>{{ translate(`admin.logTypes.${log.typeKey}`, log.type) }}</td>
                          <td>{{ log.service }}</td>
                          <td class="log-count">{{ log.count }}</td>
                        </tr>
                        <tr v-if="warningLogsSummary.length === 0">
                          <td colspan="3" class="empty-logs">{{ translate('admin.noWarningLogs', 'No warning logs recorded today.') }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <!-- Latest Search Results Section (shown when search results are available) -->
                <div class="logs-summary" v-if="searchResults && searchResults.length > 0">
                  <h3 class="summary-title">
                    <span class="status-indicator info"></span>
                    {{ translate('admin.searchResults', 'Latest Search Results') }}
                    <span class="results-count">({{ searchResults.length }} {{ translate('admin.entriesFound', 'entries found') }})</span>
                  </h3>
                  <div class="log-summary-table">
                    <table>
                      <thead>
                        <tr>
                          <th>{{ translate('admin.logTime', 'Time') }}</th>
                          <th>{{ translate('admin.logLevel', 'Level') }}</th>
                          <th>{{ translate('admin.logService', 'Service') }}</th>
                          <th>{{ translate('admin.logMessage', 'Message') }}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="(log, index) in searchResults.slice(0, 5)" :key="'search-' + index">
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
                    <div v-if="searchResults.length > 5" class="view-more-logs">
                      <button class="btn btn-outline btn-sm" @click="searchLogs">
                        {{ translate('admin.viewAllResults', 'View All Results') }}
                      </button>
                    </div>
                  </div>
                </div>

                <div class="logs-info">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                  </svg>
                  <span>{{ translate('admin.infoLogsNote', 'Info logs are not shown in the summary. Use the search function to view all log types.') }}</span>
                </div>
              </div>

              <!-- Security Monitoring -->
              <div class="dashboard-card" v-if="activeTab === 'security'" style="grid-column: span 2;">
                <div class="card-header">
                  <div class="card-title">{{ translate('admin.securityMonitoring', 'Security Monitoring') }}</div>
                  <div class="card-actions">
                    <button class="btn btn-outline" @click="runSecurityScan">
                      {{ translate('admin.securityScan', 'Security Scan') }}
                    </button>
                  </div>
                </div>

                <div style="margin-bottom: 1rem;">
                  <div class="usage-item">
                    <div class="usage-header">
                      <div class="usage-label">{{ translate('admin.failedLoginAttempts', 'Failed Login Attempts (24h)')
                        }}</div>
                      <div class="usage-value">{{ securityMetrics.failedLoginAttempts }}</div>
                    </div>
                    <div class="usage-bar">
                      <div class="usage-fill usage-low" :style="{ width: `${securityMetrics.failedLoginAttempts}%` }">
                      </div>
                    </div>
                  </div>

                  <div class="usage-item">
                    <div class="usage-header">
                      <div class="usage-label">{{ translate('admin.suspiciousActivities', 'Suspicious Activities (24h)')
                        }}</div>
                      <div class="usage-value">{{ securityMetrics.suspiciousActivities }}</div>
                    </div>
                    <div class="usage-bar">
                      <div class="usage-fill usage-low" :style="{ width: `${securityMetrics.suspiciousActivities}%` }">
                      </div>
                    </div>
                  </div>
                </div>

                <div style="font-size: 0.875rem;">
                  <div><strong>{{ translate('admin.lastSecurityScan', 'Last Security Scan') }}:</strong> {{
                    securityMetrics.lastSecurityScan }}</div>
                  <div><strong>{{ translate('admin.vulnerabilitiesFound', 'Vulnerabilities Found') }}:</strong>
                    {{ securityMetrics.vulnerabilities.critical }} {{ translate('admin.critical', 'critical') }},
                    {{ securityMetrics.vulnerabilities.medium }} {{ translate('admin.medium', 'medium') }},
                    {{ securityMetrics.vulnerabilities.low }} {{ translate('admin.low', 'low') }}
                  </div>
                </div>
              </div>

              <!-- User Management - Users Tab Only -->
              <div class="dashboard-card" v-if="activeTab === 'users'" style="grid-column: span 2;">
                <div class="card-header">
                  <div class="card-title">{{ translate('admin.userManagement', 'User Management') }}</div>
                </div>

                <!-- User Stats Summary -->
                <div class="user-stats-summary">
                  <div class="stats-row">
                    <div class="stat-item">
                      <span class="stat-label">{{ translate('admin.totalUsers', 'Total Users') }}:</span>
                      <span class="stat-value">{{ userStats.totalUsers }}</span>
                    </div>
                    <div class="stat-item">
                      <span class="stat-label">{{ translate('admin.activeUsers', 'Active Users') }}:</span>
                      <span class="stat-value">{{ userStats.activeUsers }}</span>
                    </div>
                    <div class="stat-item">
                      <span class="stat-label">{{ translate('admin.newUsers', 'New Users (Month)') }}:</span>
                      <span class="stat-value">{{ userStats.newUsers }}</span>
                    </div>
                  </div>
                </div>

                <!-- Search Bar -->
                <div class="search-bar">
                  <div class="search-input-container">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                      class="search-icon">
                      <circle cx="11" cy="11" r="8"></circle>
                      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                    <input type="text" class="search-input" v-model="userSearchTerm"
                      :placeholder="translate('admin.searchUsers', 'Search users...')" @keyup.enter="searchUsers" />
                    <button v-if="userSearchTerm" class="search-clear-btn" @click="resetUserSearch"
                      :aria-label="translate('admin.clearSearch', 'Clear search')">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    </button>
                  </div>

                  <div class="search-filter">
                    <select v-model="userSearchField" class="search-field-select">
                      <option value="all">{{ translate('admin.searchFields.all', 'All Fields') }}</option>
                      <option value="name">{{ translate('admin.searchFields.name', 'Name') }}</option>
                      <option value="email">{{ translate('admin.searchFields.email', 'Email') }}</option>
                      <option value="role">{{ translate('admin.searchFields.role', 'Role') }}</option>
                    </select>
                  </div>

                  <div class="search-button">
                    <button class="btn btn-primary" @click="searchUsers" :disabled="isSearchingUsers">
                      {{ translate('admin.search', 'Search') }}
                    </button>
                  </div>
                </div>

                <!-- Search Results Info -->
                <div class="search-results-info" v-if="userSearchResults">
                  <span>
                    {{ userSearchTotal }} {{ translate('admin.usersFound', 'users found') }}
                    <button v-if="userSearchResults" class="btn btn-outline btn-sm" @click="resetUserSearch">
                      {{ translate('admin.showAllUsers', 'Show All Users') }}
                    </button>
                  </span>
                </div>

                <!-- Loading Indicator -->
                <div class="search-loading" v-if="isSearchingUsers">
                  <div class="loading-spinner-small"></div>
                  <span>{{ translate('admin.searching', 'Searching...') }}</span>
                </div>

                <table class="log-table">
                  <thead>
                    <tr>
                      <th>{{ translate('admin.userName', 'Name') }}</th>
                      <th>{{ translate('admin.userEmail', 'Email') }}</th>
                      <th>{{ translate('admin.userRole', 'Role') }}</th>
                      <th>{{ translate('admin.userActions', 'Actions') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="user in displayedUsers" :key="user._key">
                      <td>{{ user.fullName || user.loginName }}</td>
                      <td>{{ user.email }}</td>
                      <td>{{ user.role }}</td>
                      <td>
                        <button class="btn btn-outline" style="padding: 0.25rem 0.5rem;"
                          @click="openUserEditDialog(user._key)">
                          {{ translate('admin.edit', 'Edit') }}
                        </button>
                      </td>
                    </tr>
                    <!-- Empty state when no users are found -->
                    <tr v-if="displayedUsers.length === 0">
                      <td colspan="4" style="text-align: center; padding: 2rem;">
                        <div v-if="isSearchingUsers">
                          {{ translate('admin.searchingUsers', 'Searching for users...') }}
                        </div>
                        <div v-else-if="userSearchResults !== null">
                          {{ translate('admin.noUsersFound', 'No users found matching your search criteria.') }}
                        </div>
                        <div v-else>
                          {{ translate('admin.noUsers', 'No users available.') }}
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>

                <!-- Pagination Controls -->
                <div class="pagination" v-if="userSearchResults && userSearchTotal > userSearchLimit">
                  <button class="page-btn" :disabled="userSearchOffset === 0"
                    @click="handleUserSearchPagination(Math.max(0, userSearchOffset - userSearchLimit))">
                    &laquo; {{ translate('admin.previous', 'Previous') }}
                  </button>

                  <span class="pagination-info">
                    {{ translate('admin.showing', 'Showing') }}
                    {{ userSearchOffset + 1 }}-{{ Math.min(userSearchOffset + userSearchLimit, userSearchTotal) }}
                    {{ translate('admin.of', 'of') }} {{ userSearchTotal }}
                  </span>

                  <button class="page-btn" :disabled="userSearchOffset + userSearchLimit >= userSearchTotal"
                    @click="handleUserSearchPagination(userSearchOffset + userSearchLimit)">
                    {{ translate('admin.next', 'Next') }} &raquo;
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Loading Indicator -->
    <div class="loading-overlay" v-if="isLoading">
      <div class="loading-spinner"></div>
      <p>
        {{ currentOperation
        ? translate(`admin.operations.${currentOperation}.loading`, `Processing ${currentOperation}...`)
        : translate('admin.loading', 'Loading...') }}
      </p>
    </div>

    <!-- Operation Results Modal -->
    <OperationResultsModal v-if="showOperationResults && operationResults" :operation="currentOperation"
      :results="operationResults" @close="closeOperationResults" />

    <UserEditDialog v-if="showUserEditDialog && selectedUserId" :userId="selectedUserId"
      :currentUserId="currentUser.userId || currentUser._key" :theme="currentTheme" @close="showUserEditDialog = false"
      @user-updated="handleUserUpdated" />
  </div>

  <!-- Log Search Dialog -->
  <LogSearchDialog v-if="showLogSearchDialog" @close="showLogSearchDialog = false"
    @search-completed="handleSearchResults" :theme="currentTheme" />
</template>

<script>
import databaseOperationsService from '../services/databaseOperationsService';
import adminDashboardService from '../services/adminDashboardService';
import OperationResultsModal from './OperationResultsModal.vue';
import LogSearchDialog from './LogSearchDialog.vue';
import UserEditDialog from './UserEditDialog.vue';
import { eventBus } from '../eventBus.js';

export default {
  components: {
    OperationResultsModal,
    LogSearchDialog,
    UserEditDialog
  },
  name: 'AdminDashboard',
  emits: ['close'],
  data() {
    return {
      // Current locale for translations
      currentLocale: this.getCurrentLanguage(),

      // Theme settings
      currentTheme: document.documentElement.getAttribute('data-theme') || 'light',

      // Tab navigation
      activeTab: 'overview',
      tabs: [
        { id: 'overview', label: 'System Health' },
        { id: 'database', label: 'Database' },
        { id: 'logs', label: 'Logs' },
        { id: 'security', label: 'Security' },
        { id: 'users', label: 'Users' }
      ],

      // Loading state
      isLoading: false,

      // Operation in progress
      currentOperation: null,

      // Operation results
      operationResults: null,

      // System health services
      healthServices: [
        { id: 'apiServices', name: 'API Services', status: 'good' },
        { id: 'database', name: 'Database', status: 'good' },
        { id: 'cache', name: 'Cache', status: 'good' },
        { id: 'storage', name: 'Storage', status: 'warning' },
        { id: 'messageQueue', name: 'Message Queue', status: 'good' },
        { id: 'externalApi', name: 'External API', status: 'error' }
      ],

      // Database stats
      dbStats: {
        lastReindex: '5 days ago',
        databaseSize: '42.3 GB',
        totalTables: 128
      },

      // Resource usage metrics
      resourceUsage: [
        { id: 'cpu', label: 'CPU Usage', value: 42 },
        { id: 'memory', label: 'Memory Usage', value: 78 },
        { id: 'storage', label: 'Storage Usage', value: 92 },
        { id: 'network', label: 'Network Bandwidth', value: 35 }
      ],

      // Logs data
      logs: [
        {
          time: '10:42:15',
          level: 'ERROR',
          service: 'API Gateway',
          message: 'Connection timeout to external provider',
          messageKey: 'connectionTimeout'
        },
        {
          time: '10:38:22',
          level: 'WARNING',
          service: 'Storage',
          message: 'Disk space below 10% threshold',
          messageKey: 'lowDiskSpace'
        },
        {
          time: '10:35:47',
          level: 'INFO',
          service: 'Auth Service',
          message: 'User role updated for admin@huduma.ai',
          messageKey: 'userRoleUpdated'
        }
      ],

      // Add these to the data object
      errorLogsSummary: [
        { typeKey: 'connectionTimeout', type: 'Connection timeout', service: 'API Gateway', count: 5 },
        { typeKey: 'databaseFailed', type: 'Database query failed', service: 'Data Service', count: 3 },
        { typeKey: 'authFailed', type: 'Authentication failure', service: 'Auth Service', count: 2 }
      ],
      warningLogsSummary: [
        { typeKey: 'lowDiskSpace', type: 'Disk space below threshold', service: 'Storage', count: 1 },
        { typeKey: 'slowQuery', type: 'Slow query performance', service: 'Database', count: 8 },
        { typeKey: 'rateLimit', type: 'Rate limit approaching', service: 'External API', count: 4 }
      ],
      showLogSearchDialog: false,

      // Feature flags
      featureFlags: [
        {
          id: 'enhancedSearch',
          name: 'Enhanced Search',
          description: 'Enable AI-powered search capabilities',
          enabled: true
        },
        {
          id: 'newDashboardUi',
          name: 'New Dashboard UI',
          description: 'Updated user interface for dashboards',
          enabled: false
        },
        {
          id: 'bulkProcessingApi',
          name: 'Bulk Processing API',
          description: 'Enable bulk data processing endpoints',
          enabled: true
        }
      ],

      // Alert configurations
      alertConfigs: [
        {
          id: 'cpuUsage',
          title: 'CPU Usage > 90%',
          channels: 'Email, SMS to System Admin',
          enabled: true
        },
        {
          id: 'errorRate',
          title: 'Error Rate > 1%',
          channels: 'Email to Dev Team, Slack #alerts',
          enabled: true
        },
        {
          id: 'lowStorage',
          title: 'Storage < 10%',
          channels: 'Email, SMS, Automated cleanup',
          enabled: true
        }
      ],

      // Maintenance mode toggle
      maintenanceMode: false,

      // Alert configuration modal
      showAlertsConfig: false,

      // Show operation results modal
      showOperationResults: false,

      // System metrics
      metrics: {
        systemUptime: 99.98,
        avgResponseTime: 245,
        errorRate: 0.05,
        activeUsers: 2453
      },

      // Log filter options
      logFilter: {
        level: '',
        service: ''
      },

      // Total log count
      logsTotal: 1284,

      // Security metrics
      securityMetrics: {
        failedLoginAttempts: 23,
        suspiciousActivities: 5,
        lastSecurityScan: '2 days ago',
        vulnerabilities: {
          critical: 0,
          medium: 2,
          low: 5
        }
      },

      // User statistics
      userStats: {
        totalUsers: 0,
        activeUsers: 0,
        newUsers: 0,
        users: []
      },

      // User edit dialog
      showUserEditDialog: false,
      selectedUserId: null,
      currentUser: {}, // Will hold the current logged-in user's information

      // For search functionality
      searchResults: [],

      // Status indicator styling for info logs
      status: {
        info: {
          color: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)'
        }
      },
      
      // User Search Properties - NEW
      userSearchTerm: '',
      userSearchField: 'all', // Default to search all fields
      isSearchingUsers: false,
      userSearchResults: null,
      userSearchTotal: 0,
      userSearchLimit: 20,
      userSearchOffset: 0
    };
  },
  computed: {
    // User list to display (either search results or all users)
    displayedUsers() {
      // If we have search results, show them
      if (this.userSearchResults) {
        return this.userSearchResults;
      }
      
      // If we're actively searching but have no results yet
      if (this.isSearchingUsers) {
        return [];
      }
      
      // Otherwise, show all users
      return this.userStats.users || [];
    }
  },
  created() {
    // Initialize with the current language settings
    this.currentLocale = this.$i18n ? this.$i18n.locale : 'en';
    
    // Add watchers for language changes
    if (this.$i18n) {
      this.$watch('$i18n.locale', (newLocale) => {
        console.log('Locale changed in AdminDashboard:', newLocale);
        this.currentLocale = newLocale;
        this.$forceUpdate();
      });
    }
  },
  mounted() {
    // Apply current language settings
    if (this.$i18n) {
      this.$i18n.locale = this.currentLocale;
    }

    // Apply theme from localStorage or default
    this.applyTheme(this.currentTheme);

    // Listen for theme changes from other components
    window.addEventListener('themeChange', this.handleThemeChange);

    // Load initial data for the dashboard
    this.loadInitialData();

    // Get current user data
    this.getCurrentUser();
  },
  beforeUnmount() {
    // Clean up event listeners when component is destroyed
    window.removeEventListener('themeChange', this.handleThemeChange);
  },
  methods: {
    // Translation method - improved to ensure consistent behavior with SettingsComponent
    translate(key, fallback = '') {
      if (!this.$i18n) return fallback;
      try {
        // Force the correct locale
        const translation = this.$i18n.t(key, { locale: this.currentLocale });
        // Return fallback if the key is returned (meaning no translation found)
        if (translation === key) {
          return fallback || key;
        }
        return translation;
      } catch (e) {
        console.error('Translation error:', e);
        return fallback || key;
      }
    },

    // Get current language from i18n or localStorage
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

    // Change language
    changeLanguage() {
      if (this.$i18n) {
        // Set the i18n locale
        this.$i18n.locale = this.currentLocale;

        // Save to localStorage
        try {
          localStorage.setItem('userLocale', this.currentLocale);
        } catch (e) {
          console.warn('Error saving language preference:', e);
        }

        // Force update this component
        this.$forceUpdate();
      }
    },

    // Toggle between light and dark theme
    toggleTheme() {
      const newTheme = this.currentTheme === 'light' ? 'dark' : 'light';
      this.applyTheme(newTheme);
    },

    // Apply theme
    applyTheme(theme) {
      // Update local state
      this.currentTheme = theme;

      // Save to localStorage
      localStorage.setItem('theme', theme);

      // Apply to document
      document.documentElement.setAttribute('data-theme', theme);
      document.body.setAttribute('data-theme', theme);

      // Update class names
      if (theme === 'dark') {
        document.documentElement.classList.add('dark-mode');
        document.documentElement.classList.remove('light-mode');
        document.body.classList.remove('light-mode');
        document.body.classList.add('dark-mode');
      } else {
        document.documentElement.classList.remove('dark-mode');
        document.documentElement.classList.add('light-mode');
        document.body.classList.remove('dark-mode');
        document.body.classList.add('light-mode');
      }
    },

    // Handle theme change event from other components
    handleThemeChange(event) {
      if (event.detail && event.detail.theme) {
        this.applyTheme(event.detail.theme);
      }
    },

    // Get current effective theme (useful for components that need the actual theme)
    getCurrentTheme() {
      return this.currentTheme;
    },

    // Set active tab
    setActiveTab(tabId) {
      this.activeTab = tabId;

      // Load tab-specific data based on active tab
      if (tabId === 'database') {
        this.loadDatabaseStats();
      } else if (tabId === 'logs') {
        this.loadLogsSummary();
        this.loadLogs();
      } else if (tabId === 'security') {
        this.loadSecurityMetrics();
      } else if (tabId === 'users') {
        this.loadUserStats();
      }
    },

    // Get usage level based on percentage
    getUsageLevel(value) {
      if (value < 50) return 'low';
      if (value < 80) return 'medium';
      return 'high';
    },

    // Show notification using the event bus
    showNotification(message, type = 'success', duration = 3000) {
      eventBus.$emit('notification:show', {
        message,
        type,
        duration
      });
    },

    // Load system health data
    async loadSystemHealth() {
      try {
        this.isLoading = true;
        const response = await adminDashboardService.getSystemHealth();

        if (response && response.data && response.data.data) {
          const data = response.data.data;

          // Update metrics
          this.metrics = {
            systemUptime: data.metrics.systemUptime,
            avgResponseTime: data.metrics.avgResponseTime,
            errorRate: data.metrics.errorRate,
            activeUsers: data.metrics.activeUsers
          };

          // Update health services
          this.healthServices = data.healthServices;

          // Update resource usage
          this.resourceUsage = Object.keys(data.resourceUsage).map(id => ({
            id,
            label: this.getResourceLabel(id),
            value: data.resourceUsage[id]
          }));
        }
      } catch (error) {
        console.error('Error loading system health:', error);
        this.showNotification('Failed to load system health data', 'error');
      } finally {
        this.isLoading = false;
      }
    },

    // Get resource label
    getResourceLabel(resourceId) {
      const labels = {
        cpu: this.translate('admin.resources.cpu', 'CPU Usage'),
        memory: this.translate('admin.resources.memory', 'Memory Usage'),
        storage: this.translate('admin.resources.storage', 'Storage Usage'),
        network: this.translate('admin.resources.network', 'Network Bandwidth')
      };
      return labels[resourceId] || resourceId;
    },

    // Load logs
    async loadLogs() {
      try {
        this.isLoading = true;
        const response = await adminDashboardService.getLogs({
          limit: 20, // Get more logs than we'll display in the summary
          level: this.logFilter ? this.logFilter.level : '',
          service: this.logFilter ? this.logFilter.service : ''
        });

        if (response && response.data && response.data.data) {
          this.logs = response.data.data.logs || [];
          this.logsTotal = response.data.data.total || 0;
        }
      } catch (error) {
        console.error('Error loading logs:', error);
        this.showNotification('Failed to load logs', 'error');
      } finally {
        this.isLoading = false;
      }
    },

    // Load log summaries from the API
    async loadLogsSummary() {
      try {
        this.isLoading = true;
        const response = await adminDashboardService.getLogsSummary({
          date: new Date().toISOString().split('T')[0] // Today's date in YYYY-MM-DD format
        });

        if (response && response.data && response.data.data) {
          this.errorLogsSummary = response.data.data.errors || [];
          this.warningLogsSummary = response.data.data.warnings || [];
        }
      } catch (error) {
        console.error('Error loading logs summary:', error);
        this.showNotification('Failed to load logs summary', 'error');
      } finally {
        this.isLoading = false;
      }
    },

    // Security operations
    async runSecurityScan() {
      this.executeOperation('runSecurityScan', async () => {
        const response = await adminDashboardService.runSecurityScan();
        // Refresh security metrics after scan
        if (response.data && response.data.success) {
          this.loadSecurityMetrics();
        }
        return response.data;
      });
    },

    // Search logs method - launches the search dialog
    searchLogs() {
      // Make sure the current theme is properly set
      this.currentTheme = document.documentElement.getAttribute('data-theme') || 'light';

      // Show the log search dialog
      this.showLogSearchDialog = true;

      // Load error and warning log summaries if they haven't been loaded yet
      if (this.activeTab === 'logs' && (!this.errorLogsSummary.length && !this.warningLogsSummary.length)) {
        this.loadLogsSummary();
      }
    },

    // Handle search results from the LogSearchDialog component
    handleSearchResults(results) {
      // Store the search results
      this.searchResults = results;

      // Notify the user about the results
      if (results.length === 0) {
        this.showNotification(
          this.translate('admin.logSearch.noResultsFound', 'No logs matched your search criteria'),
          'info'
        );
      } else {
        this.showNotification(
          this.translate('admin.logSearch.resultsFound', `Found ${results.length} log entries`),
          'success'
        );

        // If we're not on the logs tab, switch to it to display the results
        if (this.activeTab !== 'logs') {
          this.setActiveTab('logs');
        }
      }
    },

    // Log operations
    async rolloverLogs() {
      this.executeOperation('rolloverLogs', async () => {
        const response = await adminDashboardService.rolloverLogs();
        // Refresh logs after rollover
        if (response.data && response.data.success) {
          await Promise.all([
            this.loadLogsSummary(),
            this.loadLogs()
          ]);
        }
        return response.data;
      });
    },

    // Load security metrics
    async loadSecurityMetrics() {
      try {
        this.isLoading = true;
        const response = await adminDashboardService.getSecurityMetrics();

        if (response && response.data && response.data.data) {
          this.securityMetrics = response.data.data;
        }
      } catch (error) {
        console.error('Error loading security metrics:', error);
        this.showNotification('Failed to load security metrics', 'error');
      } finally {
        this.isLoading = false;
      }
    },

    // Load user stats
    async loadUserStats() {
      try {
        this.isLoading = true;
        const response = await adminDashboardService.getUserStats();

        if (response && response.data && response.data.data) {
          this.userStats = response.data.data;
        }
      } catch (error) {
        console.error('Error loading user stats:', error);
        this.showNotification('Failed to load user statistics', 'error');
      } finally {
        this.isLoading = false;
      }
    },

    // System diagnostics
    async runDiagnostics() {
      this.executeOperation('runDiagnostics', async () => {
        const response = await adminDashboardService.runDiagnostics();
        return response.data;
      });
    },

    // Load all dashboard data
    async loadInitialData() {
      // Load system health by default
      this.loadSystemHealth();

      // Load tab-specific data based on active tab
      if (this.activeTab === 'database') {
        this.loadDatabaseStats();
      } else if (this.activeTab === 'logs') {
        this.loadLogsSummary();
        this.loadLogs();
      } else if (this.activeTab === 'security') {
        this.loadSecurityMetrics();
      } else if (this.activeTab === 'users') {
        this.loadUserStats();
      }
    },

    // Load database statistics
    async loadDatabaseStats() {
      try {
        // Call the stats endpoint if it exists
        const response = await databaseOperationsService.getDatabaseStats();
        if (response && response.data) {
          this.dbStats = response.data;
        }
      } catch (error) {
        console.error('Error loading database stats:', error);
        // Just log the error, don't show a notification since this is background loading
      }
    },

    // Database operations
    async reindexDatabase() {
      this.executeOperation('reindexDatabase', async () => {
        const response = await databaseOperationsService.reindexDatabase();
        // Update the last reindex time if successful
        if (response.data && response.data.success) {
          this.dbStats.lastReindex = 'Just now';
        }
        return response.data;
      });
    },

    async backupDatabase() {
      this.executeOperation('backupDatabase', async () => {
        const response = await databaseOperationsService.backupDatabase();
        return response.data;
      });
    },

    async optimizeDatabase() {
      this.executeOperation('optimizeDatabase', async () => {
        const response = await databaseOperationsService.optimizeDatabase();
        return response.data;
      });
    },

    // Job operations
    viewAllJobs() {
      this.showOperation('viewAllJobs');
    },

    cancelJob(jobId) {
      this.showOperation('cancelJob', { jobId });
    },

    restartJob(jobId) {
      this.showOperation('restartJob', { jobId });
    },

    // Feature flag operations
    addNewFlag() {
      this.showOperation('addNewFlag');
    },

    updateFeatureFlag(feature) {
      this.showOperation('updateFeatureFlag', {
        id: feature.id,
        enabled: feature.enabled
      });
    },

    // Alert operations
    addNewAlert() {
      this.showOperation('addNewAlert');
    },

    updateAlertConfig(alert) {
      this.showOperation('updateAlertConfig', {
        id: alert.id,
        enabled: alert.enabled
      });
    },

    saveAlertConfigs() {
      this.showOperation('saveAlertConfigs');
      this.showAlertsConfig = false;
    },

    // Deployment operations
    deployVersion() {
      this.showOperation('deployVersion');
    },

    toggleMaintenanceMode() {
      this.showOperation('toggleMaintenanceMode', {
        enabled: this.maintenanceMode
      });
    },

    // Performance operations
    viewDetailedMetrics() {
      this.showOperation('viewDetailedMetrics');
    },

    // Helper to execute database operations with proper loading and error handling
    async executeOperation(operation, apiCall) {
      try {
        // Set loading state and operation name
        this.isLoading = true;
        this.currentOperation = operation;
        this.operationResults = null;

        // Execute the API call
        const result = await apiCall();

        // Set operation results for potential display
        this.operationResults = result;

        // Show success notification
        if (result && result.success) {
          this.showNotification(
            this.translate(`admin.operations.${operation}.success`, `Operation ${operation} completed successfully`),
            'success'
          );
        } else {
          throw new Error(result.message || `Failed to ${operation}`);
        }

        // Return the result
        return result;
      } catch (error) {
        // Set error result
        this.operationResults = {
          success: false,
          message: error.message || this.translate(`admin.operations.${operation}.error`, `Error during ${operation}`),
          error: error.response?.data?.error || error.message
        };

        // Show error notification
        this.showNotification(this.operationResults.message, 'error');

        console.error(`Error during ${operation}:`, error);
        return this.operationResults;
      } finally {
        // Reset loading state
        this.isLoading = false;

        // Optionally show results modal
        if (this.operationResults) {
          this.showOperationResults = true;
        }
      }
    },

    // Legacy method for operations that are not yet implemented with real API calls
    showOperation(operation, data = {}) {
      // In a real app, this would make API calls
      // For now, just show loading and a notification
      this.isLoading = true;
      this.currentOperation = operation;

      setTimeout(() => {
        this.isLoading = false;
        this.currentOperation = null;
        console.log(`Operation ${operation} executed with data:`, data);

        // If using the notification service via event bus:
        this.showNotification(
          this.translate(`admin.operations.${operation}.success`, `Operation ${operation} completed successfully`),
          'info'
        );
      }, 1500);
    },

    // Close the operation results modal
    closeOperationResults() {
      this.showOperationResults = false;
    },

    // Get current user information
    getCurrentUser() {
      // Get current user data from localStorage or other source
      const userData = localStorage.getItem('user');
      if (userData) {
        try {
          this.currentUser = JSON.parse(userData);
        } catch (e) {
          console.error('Error parsing user data:', e);
          this.currentUser = {};
        }
      }
    },

    // Open user edit dialog
    openUserEditDialog(userId) {
      this.selectedUserId = userId;
      this.showUserEditDialog = true;
    },

    // Handle user updated event from dialog
    handleUserUpdated(updatedData) {
      console.log('User updated:', updatedData);

      // Refresh user list if we're on the Users tab
      if (this.activeTab === 'users') {
        this.loadUserStats();
      }

      // Show notification
      this.showNotification(
        this.translate('admin.userEdit.userUpdated', 'User updated successfully'),
        'success'
      );
    },

    // NEW METHODS FOR USER SEARCH
    /**
     * Search users from the server
     */
    async searchUsers() {
      try {
        this.isSearchingUsers = true;
        
        // Only perform search if there's a search term
        if (this.userSearchTerm.trim()) {
          const response = await adminDashboardService.searchUsers({
            term: this.userSearchTerm,
            field: this.userSearchField,
            limit: this.userSearchLimit,
            offset: this.userSearchOffset
          });
          
          if (response && response.data && response.data.data) {
            const data = response.data.data;
            this.userSearchResults = data.users;
            this.userSearchTotal = data.total;
            
            // Show notification about search results
            this.showNotification(
              this.translate('admin.userSearch.resultsFound', `Found ${data.total} users matching "${this.userSearchTerm}"`),
              'info'
            );
          }
        } else {
          // If search term is empty, clear results and reload all users
          this.resetUserSearch();
          this.loadUserStats();
        }
      } catch (error) {
        console.error('Error searching users:', error);
        this.showNotification(
          this.translate('admin.userSearch.error', 'Error searching users'),
          'error'
        );
      } finally {
        this.isSearchingUsers = false;
      }
    },

    /**
     * Reset user search and reload all users
     */
    resetUserSearch() {
      this.userSearchTerm = '';
      this.userSearchField = 'all';
      this.userSearchResults = null;
      this.userSearchTotal = 0;
      this.userSearchOffset = 0;
    },

    /**
     * Handle user search pagination
     * @param {number} offset - New offset for pagination
     */
    handleUserSearchPagination(offset) {
      this.userSearchOffset = offset;
      this.searchUsers();
    }
  }
};
</script>


<style scoped>
/* Base variables */
:root {
  --primary: #3b82f6;
  --primary-dark: #2563eb;
  --secondary: #64748b;
  --success: #10b981;
  --warning: #f59e0b;
  --danger: #ef4444;
  --light: #f8fafc;
  --dark: #1e293b;
  --border: #e2e8f0;
  
  /* Theme variables */
  --bg-dialog: #ffffff;
  --text-primary: #333333;
  --text-secondary: #4d4d4d;
  --text-tertiary: #767676;
  --text-button-primary: #ffffff;
  --text-button-secondary: #4d4d4d;
  --bg-button-primary: #3b82f6;
  --bg-button-secondary: #e9ecef;
  --border-color: #dcdfe4;
  --bg-section: rgba(0, 0, 0, 0.02);
  --bg-danger: #ef4444;
  --bg-danger-hover: #dc2626;
  --bg-input: #ffffff;
  --border-input: #dcdfe4;
  --switch-track-off: #d0d0d0;
  --switch-track-on: #3b82f6;
  --switch-thumb: #ffffff;
  --slider-track: #e9ecef;
  --slider-thumb: #3b82f6;
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.1);
}

/* Dark theme variables */
[data-theme="dark"], .dark-mode {
  --bg-dialog: #1e293b;
  --text-primary: #f1f5f9;
  --text-secondary: #cbd5e1;
  --text-tertiary: #94a3b8;
  --text-button-primary: #ffffff;
  --text-button-secondary: #cbd5e1;
  --bg-button-primary: #3b82f6;
  --bg-button-secondary: #334155;
  --border-color: #334155;
  --bg-section: rgba(255, 255, 255, 0.03);
  --bg-danger: #ef4444;
  --bg-danger-hover: #dc2626;
  --bg-input: #0f172a;
  --border-input: #334155;
  --switch-track-off: #475569;
  --switch-track-on: #3b82f6;
  --switch-thumb: #ffffff;
  --slider-track: #334155;
  --slider-thumb: #3b82f6;
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.3);
}

/* Sidebar Theming */
[data-theme="light"] .sidebar {
  background-color: #334155; /* Dark background for light mode */
  color: #f8fafc; /* Light text for readability */
}

[data-theme="dark"] .sidebar {
  background-color: #1e293b;
  color: #f8fafc;
}

/* Ensure consistent styling for sidebar elements in both themes */
.sidebar .logo {
  color: #f8fafc;
}

.sidebar .nav-header {
  color: rgba(255, 255, 255, 0.7);
}

.sidebar .nav-link {
  color: #e2e8f0;
}

.sidebar .nav-link:hover, 
.sidebar .nav-link.active {
  background-color: rgba(255, 255, 255, 0.1);
  color: white;
}

.sidebar .nav-link.active {
  background-color: var(--primary);
  color: white;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
}

/* Modal backdrop */
.admin-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.4);
  z-index: 999;
}

/* Admin dashboard container */
.admin-dashboard {
  position: fixed;
  top: 60px; /* Position below navbar - adjust based on your navbar height */
  left: 50%;
  transform: translateX(-50%);
  width: 90%;
  max-width: 1200px;
  max-height: calc(100vh - 80px); /* Leave space for navbar and notifications */
  overflow-y: auto;
  background-color: var(--bg-dialog);
  z-index: 1000;
  border-radius: 8px;
  box-shadow: 0 5px 20px rgba(0, 0, 0, 0.3);
}

/* Close button */
.close-dashboard-btn {
  position: absolute;
  top: 8px; /* Move it higher into the top bar */
  right: 16px; /* Position closer to the right edge */
  background: rgba(0, 0, 0, 0.2);
  border: none;
  border-radius: 50%;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--text-primary);
  z-index: 1100;
  transition: all 0.2s ease;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
}

.close-dashboard-btn:hover {
  background: rgba(239, 68, 68, 0.8);
  color: white;
  transform: scale(1.1);
}

/* Main layout grid */
.dashboard {
  display: grid;
  grid-template-columns: 220px 1fr; /* Slightly smaller sidebar */
  min-height: auto;
  max-height: calc(100vh - 80px);
}

/* Sidebar */
.sidebar {
  background-color: var(--dark);
  color: #f8fafc;
  padding: 1.5rem 1rem;
  max-height: calc(100vh - 80px);
  overflow-y: auto;
}

.logo {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 2rem;
  font-size: 1.25rem;
  font-weight: 600;
  color: #f8fafc;
}

.logo-icon {
  background-color: var(--primary);
  color: white;
  height: 2rem;
  width: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.375rem;
}

.nav-section {
  margin-bottom: 1.5rem;
}

.nav-header {
  text-transform: uppercase;
  font-size: 0.75rem;
  letter-spacing: 0.05em;
  color: rgba(255, 255, 255, 0.7);
  margin-bottom: 0.5rem;
}

.nav-items {
  list-style: none;
}

.nav-item {
  margin-bottom: 0.25rem;
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  text-decoration: none;
  color: #e2e8f0;
  border-radius: 0.375rem;
  transition: all 0.2s;
  cursor: pointer;
}

.nav-link:hover, .nav-link.active {
  background-color: rgba(255, 255, 255, 0.1);
  color: white;
}

.nav-link.active {
  background-color: var(--primary);
  color: white;
}

/* Main Content */
.main {
  padding: 1.5rem;
  background-color: var(--bg-dialog);
  max-height: calc(100vh - 80px);
  overflow-y: auto;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}

.page-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--text-primary);
}

/* Rest of the existing styles... */
.user-menu {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.notification {
  position: relative;
  cursor: pointer;
}

.notification-badge {
  position: absolute;
  top: -5px;
  right: -5px;
  background-color: var(--danger);
  color: white;
  height: 18px;
  width: 18px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
}

.user-avatar {
  height: 2.5rem;
  width: 2.5rem;
  border-radius: 50%;
  background-color: var(--primary);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
}

/* Quick Stats */
.quick-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
  margin-bottom: 1rem;
}

.stat-card {
  background-color: var(--bg-dialog);
  border-radius: 0.5rem;
  padding: 1rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  border: 1px solid var(--border-color);
}

.stat-title {
  color: var(--text-secondary);
  font-size: 0.875rem;
  margin-bottom: 0.25rem;
}

.stat-value {
  font-size: 1.5rem;
  font-weight: 600;
  margin-bottom: 0.25rem;
  color: var(--text-primary);
}

.stat-trend {
  display: flex;
  align-items: center;
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.trend-up {
  color: var(--success);
}

.trend-down {
  color: var(--danger);
}

/* Tabs */
.tabs {
  background-color: var(--bg-dialog);
  border-radius: 0.5rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  margin-bottom: 1rem;
  border: 1px solid var(--border-color);
  overflow: hidden;
}

.tab-header {
  display: flex;
  border-bottom: 1px solid var(--border-color);
  overflow-x: auto;
  white-space: nowrap;
}

.tab-btn {
  padding: 0.75rem 1.25rem;
  border: none;
  background: none;
  font-size: 0.9rem;
  cursor: pointer;
  border-bottom: 3px solid transparent;
  transition: all 0.2s;
  color: var(--text-secondary);
}

.tab-btn.active {
  border-bottom-color: var(--primary);
  color: var(--primary);
  font-weight: 600;
}

.tab-content {
  padding: 1.25rem;
}

/* Dashboard Grid */
.dashboard-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.dashboard-card {
  background-color: var(--bg-dialog);
  border-radius: 0.5rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  padding: 1rem;
  margin-bottom: 1rem;
  border: 1px solid var(--border-color);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.card-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.card-actions {
  display: flex;
  gap: 0.5rem;
}

.btn {
  padding: 0.5rem 0.75rem;
  border-radius: 0.375rem;
  border: none;
  font-size: 0.75rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  transition: all 0.2s;
}

.btn-primary {
  background-color: var(--bg-button-primary);
  color: var(--text-button-primary);
}

.btn-primary:hover {
  background-color: var(--primary-dark);
}

.btn-outline {
  background-color: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
}

.btn-outline:hover {
  background-color: var(--bg-section);
}

/* Health Status */
.health-status {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem;
}

.health-item {
  padding: 0.5rem;
  border-radius: 0.375rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
}

.status-good {
  background-color: rgba(16, 185, 129, 0.1);
  color: var(--success);
}

.status-warning {
  background-color: rgba(245, 158, 11, 0.1);
  color: var(--warning);
}

.status-error {
  background-color: rgba(239, 68, 68, 0.1);
  color: var(--danger);
}

.status-badge {
  height: 0.75rem;
  width: 0.75rem;
  border-radius: 50%;
}

.badge-good {
  background-color: var(--success);
}

.badge-warning {
  background-color: var(--warning);
}

.badge-error {
  background-color: var(--danger);
}

/* Database Section */
.db-actions {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.db-action-card {
  border: 1px solid var(--border-color);
  border-radius: 0.375rem;
  padding: 0.75rem;
  cursor: pointer;
  transition: all 0.2s;
  background-color: var(--bg-dialog);
  font-size: 0.8rem;
}

.db-action-card:hover {
  border-color: var(--primary);
}

.action-icon {
  margin-bottom: 0.5rem;
  font-size: 1.25rem;
  color: var(--primary);
}

.action-title {
  font-weight: 600;
  margin-bottom: 0.25rem;
  color: var(--text-primary);
}

.action-desc {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.db-stats {
  color: var(--text-primary);
  font-size: 0.8rem;
}

/* Log Table */
.log-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

.log-table th, .log-table td {
  padding: 0.5rem 0.75rem;
  text-align: left;
  border-bottom: 1px solid var(--border-color);
}

.log-table th {
  font-weight: 600;
  color: var(--text-secondary);
}

.log-level {
  padding: 0.2rem 0.4rem;
  border-radius: 0.25rem;
  font-size: 0.7rem;
  text-transform: uppercase;
  font-weight: 600;
}

.log-error {
  background-color: rgba(239, 68, 68, 0.1);
  color: var(--danger);
}

.log-warning {
  background-color: rgba(245, 158, 11, 0.1);
  color: var(--warning);
}

.log-info {
  background-color: rgba(59, 130, 246, 0.1);
  color: var(--primary);
}

.table-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 0.5rem;
  color: var(--text-secondary);
  font-size: 0.75rem;
}

.pagination {
  display: flex;
  gap: 0.25rem;
}

.page-btn {
  height: 1.8rem;
  width: 1.8rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.375rem;
  border: 1px solid var(--border-color);
  background: none;
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 0.8rem;
}

.page-btn.active {
  background-color: var(--primary);
  color: white;
  border-color: var(--primary);
}

/* Resource Usage */
.resource-usage {
  padding: 0.5rem 0;
}

.usage-item {
  margin-bottom: 0.75rem;
}

.usage-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.25rem;
  font-size: 0.8rem;
}

.usage-label {
  font-weight: 600;
  color: var(--text-secondary);
}

.usage-value {
  color: var(--text-primary);
}

.usage-bar {
  height: 0.5rem;
  border-radius: 0.25rem;
  background-color: var(--border);
  overflow: hidden;
}

.usage-fill {
  height: 100%;
  border-radius: 0.25rem;
}

.usage-low {
  background-color: var(--success);
}

.usage-medium {
  background-color: var(--warning);
}

.usage-high {
  background-color: var(--danger);
}

/* Feature Flags */
.feature-list {
  display: grid;
  gap: 0.75rem;
}

.feature-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem;
  border-radius: 0.375rem;
  border: 1px solid var(--border-color);
  background-color: var(--bg-dialog);
  font-size: 0.8rem;
}

.feature-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.feature-name {
  font-weight: 600;
  color: var(--text-primary);
}

.feature-description {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.toggle {
  position: relative;
  display: inline-block;
  width: 2.5rem;
  height: 1.25rem;
}

.toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--switch-track-off);
  transition: .4s;
  border-radius: 1.25rem;
}

.slider:before {
  position: absolute;
  content: "";
  height: 0.85rem;
  width: 0.85rem;
  left: 0.2rem;
  bottom: 0.2rem;
  background-color: var(--switch-thumb);
  transition: .4s;
  border-radius: 50%;
}

input:checked + .slider {
  background-color: var(--switch-track-on);
}

input:checked + .slider:before {
  transform: translateX(1.25rem);
}

/* Loading Overlay */
.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 1100;
  color: white;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  border-top-color: var(--primary);
  animation: spin 1s linear infinite;
  margin-bottom: 1rem;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Modal */
.modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1200;
}

.modal-content {
  width: 450px;
  max-width: 90vw;
  background-color: var(--bg-dialog);
  border-radius: 0.5rem;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.modal-title {
  padding: 1rem;
  margin: 0;
  font-size: 1.15rem;
  font-weight: 600;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-primary);
}

.modal-body {
  padding: 1.25rem;
  color: var(--text-primary);
  font-size: 0.9rem;
}

.modal-footer {
  padding: 1rem;
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  border-top: 1px solid var(--border-color);
}

.btn-close, .btn-save {
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 500;
  border: none;
  transition: all 0.2s;
  font-size: 0.9rem;
}

.btn-save {
  background-color: var(--bg-button-primary);
  color: var(--text-button-primary);
}

.btn-close {
  background-color: var(--bg-button-secondary);
  color: var(--text-button-secondary);
}

/* Responsive Adjustments */
@media (max-width: 1024px) {
  .admin-dashboard {
    width: 95%;
  }
  
  .dashboard-grid {
    grid-template-columns: 1fr;
  }
  
  .quick-stats {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 768px) {
  .admin-dashboard {
    width: 95%;
    top: 50px;
    max-height: calc(100vh - 60px);
  }
  
  .close-dashboard-btn {
    top: 60px;
  }
  
  .dashboard {
    grid-template-columns: 1fr;
  }
  
  .sidebar {
    display: none;
  }
  
  .health-status, .db-actions {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 480px) {
  .admin-dashboard {
    width: 98%;
    top: 45px;
  }
  
  .close-dashboard-btn {
    top: 55px;
    right: 10px;
  }
  
  .quick-stats {
    grid-template-columns: 1fr;
  }
  
  .health-status, .db-actions {
    grid-template-columns: 1fr;
  }
  
  .header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
  }
  
  .page-title {
    font-size: 1.25rem;
  }
  
  .user-menu {
    width: 100%;
    justify-content: flex-end;
  }
  
  .tab-header {
    flex-wrap: wrap;
  }
  
  .tab-btn {
    padding: 0.5rem 0.75rem;
    font-size: 0.8rem;
  }
  
  .card-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }
  
  .card-actions {
    align-self: flex-start;
  }
}

/* Ensure text colors in dark mode */
[data-theme="dark"] .page-title {
  color: #f8fafc !important; /* Bright white for high contrast */
}

[data-theme="dark"] .header {
  color: #f8fafc;
}

[data-theme="dark"] .card-title {
  color: #f8fafc !important;
}

[data-theme="dark"] .stat-title {
  color: #cbd5e1 !important; /* Slightly softer white for secondary titles */
}

[data-theme="dark"] .stat-value {
  color: #f8fafc !important;
}

[data-theme="dark"] .dashboard-card {
  color: #f8fafc;
}

/* Log Summary Styles */
.logs-summary {
  margin-bottom: 1.5rem;
}

.summary-title {
  display: flex;
  align-items: center;
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 0.75rem;
  color: var(--text-primary);
}

.status-indicator {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  margin-right: 0.5rem;
}

.status-indicator.error {
  background-color: var(--danger);
}

.status-indicator.warning {
  background-color: var(--warning);
}

.log-summary-table table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  overflow: hidden;
}

.log-summary-table th, 
.log-summary-table td {
  padding: 0.625rem 0.75rem;
  text-align: left;
  border-bottom: 1px solid var(--border-color);
}

.log-summary-table th {
  background-color: var(--bg-section);
  font-weight: 600;
  color: var(--text-secondary);
}

.log-summary-table td.log-count {
  font-weight: 600;
  text-align: center;
}

.logs-info {
  display: flex;
  align-items: center;
  padding: 0.75rem;
  background-color: var(--bg-section);
  border-radius: 0.375rem;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.logs-info svg {
  margin-right: 0.5rem;
  color: var(--primary);
}

.empty-logs {
  text-align: center;
  color: var(--text-tertiary);
  padding: 1rem;
}

[data-theme="dark"] .logs-summary h3,
[data-theme="dark"] .summary-title {
  color: #f8fafc !important;
}

[data-theme="dark"] h3 {
  color: #f8fafc !important;
}

/* Add these styles to your <style> section in AdminDashboard.vue */

/* Update search bar for better spacing with button */
.search-bar {
  display: flex;
  margin-bottom: 1rem;
  gap: 0.75rem;
  align-items: center;
}

.search-input-container {
  position: relative;
  flex: 1;
}

.search-button .btn {
  height: 100%;
  min-height: 38px;
}

/* Loading indicator for search */
.search-loading {
  display: flex;
  align-items: center;
  margin-bottom: 1rem;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.loading-spinner-small {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(0, 0, 0, 0.1);
  border-radius: 50%;
  border-top-color: var(--primary);
  animation: spin 1s linear infinite;
  margin-right: 0.5rem;
}

/* Pagination styles */
.pagination {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 1rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--border-color);
}

.pagination-info {
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.page-btn {
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--border-color);
  border-radius: 0.25rem;
  background-color: var(--bg-button-secondary);
  color: var(--text-button-secondary);
  font-size: 0.875rem;
  cursor: pointer;
}

.page-btn:hover:not(:disabled) {
  background-color: var(--bg-section);
}

.page-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-sm {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  margin-left: 0.5rem;
}

/* Make search results info more prominent */
.search-results-info {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.75rem;
  padding: 0.5rem;
  background-color: var(--bg-section);
  border-radius: 0.25rem;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

/* Dark mode specific adjustments */
[data-theme="dark"] .loading-spinner-small {
  border-color: rgba(255, 255, 255, 0.1);
  border-top-color: var(--primary);
}

/* User Stats Summary */
.user-stats-summary {
  margin-bottom: 1rem;
}

.stats-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap; /* Allow wrapping on smaller screens */
  gap: 1rem; /* Add spacing between items */
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 0.5rem; /* Space between label and value */
}

.stat-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-secondary);
  white-space: nowrap; /* Prevent label from wrapping */
}

.stat-value {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

/* Responsive Adjustments */
@media (max-width: 768px) {
  .stats-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
  }
  
  .stat-item {
    width: 100%;
    justify-content: space-between;
  }
}

@media (max-width: 480px) {
  .stat-label {
    font-size: 0.75rem;
  }
  
  .stat-value {
    font-size: 0.875rem;
  }
}

</style>