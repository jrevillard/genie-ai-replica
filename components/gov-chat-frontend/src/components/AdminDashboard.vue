<template>
  <div class="admin-page">
    <div class="admin-dashboard">
      <div class="dashboard">
        <div class="sidebar">
          <div class="nav-section">
            <div class="nav-header">
              {{ translate('admin.dashboard', 'Dashboard') }}
            </div>
            <ul class="nav-items">
              <li class="nav-item">
                <a
                  href="#"
                  :class="['nav-link', { active: activeTab === 'overview' }]"
                  @click.prevent="setActiveTab('overview')"
                >
                  <i>📊</i>
                  <span>{{ translate('admin.overview', 'Overview') }}</span>
                </a>
              </li>
            </ul>
          </div>

          <div class="nav-section">
            <div class="nav-header">
              {{ translate('admin.contentManagement', 'CONTENT MANAGEMENT') }}
            </div>
            <ul class="nav-items">
              <li class="nav-item">
                <a
                  href="#"
                  :class="['nav-link', { active: activeTab === 'hierarchy' }]"
                  @click.prevent="setActiveTab('hierarchy')"
                >
                  <i>🔀</i>
                  <span>{{ translate('admin.knowledgeHierarchy', 'Knowledge Hierarchy') }}</span>
                </a>
              </li>
              <li class="nav-item">
                <a
                  href="#"
                  :class="['nav-link', { active: activeTab === 'documents' }]"
                  @click.prevent="setActiveTab('documents')"
                >
                  <i>📂</i>
                  <span>{{ translate('admin.documentManagement', 'Document Management') }}</span>
                </a>
              </li>
            </ul>
          </div>

          <div class="nav-section">
            <div class="nav-header">
              {{ translate('admin.system', 'System') }}
            </div>
            <ul class="nav-items">
              <li class="nav-item">
                <a
                  href="#"
                  :class="['nav-link', { active: activeTab === 'database' }]"
                  @click.prevent="setActiveTab('database')"
                >
                  <i>💾</i>
                  <span>{{ translate('admin.database', 'Database') }}</span>
                </a>
              </li>
              <li class="nav-item">
                <a
                  href="#"
                  :class="['nav-link', { active: activeTab === 'logs' }]"
                  @click.prevent="setActiveTab('logs')"
                >
                  <i>📋</i>
                  <span>{{ translate('admin.logs', 'Logs') }}</span>
                </a>
              </li>
            </ul>
          </div>

          <div class="nav-section">
            <div class="nav-header">
              {{ translate('admin.settings', 'Settings') }}
            </div>
            <ul class="nav-items">
              <li class="nav-item">
                <a
                  href="#"
                  :class="['nav-link', { active: activeTab === 'users' }]"
                  @click.prevent="setActiveTab('users')"
                >
                  <i>👥</i>
                  <span>{{ translate('admin.userManagement', 'User Management') }}</span>
                </a>
              </li>
              <li class="nav-item">
                <a
                  href="#"
                  :class="['nav-link', { active: activeTab === 'security' }]"
                  @click.prevent="setActiveTab('security')"
                >
                  <i>🔒</i>
                  <span>{{ translate('admin.tabs.security', 'Security') }}</span>
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div class="main">
          <div class="header">
            <h1 class="page-title">
              {{ translate('admin.systemAdministration', 'System Administration') }}
            </h1>
          </div>

          <div class="quick-stats">
            <div class="stat-card">
              <div class="stat-title">
                {{ translate('admin.systemUptime', 'System Uptime') }}
              </div>
              <div class="stat-value">{{ metrics.systemUptime }}%</div>
              <div class="stat-trend trend-up">
                <span>↑ 0.2%</span>
                {{ translate('admin.fromLastMonth', 'from last month') }}
              </div>
            </div>
            <div class="stat-card">
              <div class="stat-title">
                {{ translate('admin.avgResponseTime', 'Average Response Time') }}
              </div>
              <div class="stat-value">{{ metrics.avgResponseTime }}ms</div>
              <div class="stat-trend trend-down">
                <span>↓ 12%</span>
                {{ translate('admin.fromLastMonth', 'from last month') }}
              </div>
            </div>
            <div class="stat-card">
              <div class="stat-title">
                {{ translate('admin.errorRate', 'Error Rate') }}
              </div>
              <div class="stat-value">{{ metrics.errorRate }}%</div>
              <div class="stat-trend trend-up">
                <span>↑ 0.01%</span>
                {{ translate('admin.fromLastMonth', 'from last month') }}
              </div>
            </div>
            <div class="stat-card">
              <div class="stat-title">
                {{ translate('admin.monthlyActiveUsers', 'Monthly Active Users (MAU)') }}
              </div>
              <div class="stat-value">
                {{ (metrics.monthlyActiveUsers ?? 0).toLocaleString() }}
              </div>
              <div class="stat-trend trend-up">
                <span>↑ 15%</span>
                {{ translate('admin.fromLastMonth', 'from last month') }}
              </div>
            </div>
          </div>

          <div class="tabs-card">
            <DsTabs :tabs="adminTabs" :model-value="activeTab" @update:model-value="setActiveTab">
              <div class="dashboard-grid">
                <div v-if="activeTab === 'overview'" class="dashboard-card">
                  <div class="card-header">
                    <div class="card-title">
                      {{ translate('admin.systemHealthStatus', 'System Health Status') }}
                    </div>
                    <div class="card-actions">
                      <DsButton variant="secondary" @click="runDiagnostics">
                        {{ translate('admin.runDiagnostics', 'Run Diagnostics') }}
                      </DsButton>
                    </div>
                  </div>

                  <div class="health-status">
                    <div
                      v-for="service in healthServices"
                      :key="service.name"
                      :class="['health-item', `status-${service.status}`]"
                    >
                      <div :class="['status-badge', `badge-${service.status}`]"></div>
                      <span>{{ translate(`admin.services.${service.id}`, service.name) }}</span>
                    </div>
                  </div>
                </div>

                <div v-if="activeTab === 'overview'" class="dashboard-card">
                  <div class="card-header">
                    <div class="card-title">
                      {{ translate('admin.resourceUsage', 'Resource Usage') }}
                    </div>
                  </div>

                  <div class="resource-usage">
                    <div v-for="resource in resourceUsage" :key="resource.id" class="usage-item">
                      <div class="usage-header">
                        <div class="usage-label">{{ resource.label }}</div>
                        <div class="usage-value">{{ resource.value }}%</div>
                      </div>
                      <div class="usage-bar">
                        <div
                          :class="['usage-fill', `usage-${getUsageLevel(resource.value)}`]"
                          :style="{ width: `${resource.value}%` }"
                        ></div>
                      </div>
                    </div>
                  </div>
                </div>

                <div v-if="activeTab === 'hierarchy'" class="dashboard-card" style="grid-column: span 2">
                  <div class="card-header">
                    <div class="card-title">
                      {{
                        translate(
                          'admin.hierarchy.title',
                          'Knowledge Hierarchy Management (note: always English - add translations)'
                        )
                      }}
                    </div>
                    <div class="card-actions">
                      <DsButton variant="primary" @click="showAddCategoryForm">
                        <span style="display: flex; align-items: center">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            style="margin-right: 4px"
                          >
                            <path d="M5 12h14" />
                            <path d="M12 5v14" />
                          </svg>
                          {{ translate('admin.hierarchy.addCategory', 'Add New Category') }}
                        </span>
                      </DsButton>
                    </div>
                  </div>

                  <div class="hierarchy-container">
                    <div class="hierarchy-tree-panel">
                      <DsStateDisplay v-if="isHierarchyLoading" type="loading">
                        {{ translate('admin.hierarchy.loading', 'Loading Hierarchy...') }}
                      </DsStateDisplay>
                      <ul v-else class="hierarchy-list">
                        <li v-for="category in knowledgeHierarchy" :key="category.id" class="hierarchy-category">
                          <div class="hierarchy-item">
                            <span class="item-name">{{ category.nameEN }}</span>
                            <div class="item-actions">
                              <DsButton
                                variant="ghost"
                                :aria-label="translate('admin.hierarchy.addService', 'Add Service')"
                                @click="showAddServiceForm(category)"
                              >
                                ➕
                              </DsButton>
                              <DsButton
                                variant="ghost"
                                :aria-label="translate('admin.hierarchy.editCategory', 'Edit Category')"
                                @click="showEditForm(category)"
                              >
                                ✏️
                              </DsButton>
                              <DsButton
                                variant="ghost"
                                :aria-label="translate('admin.hierarchy.deleteCategory', 'Delete Category')"
                                @click="deleteHierarchyItem(category)"
                              >
                                🗑️
                              </DsButton>
                            </div>
                          </div>
                          <ul v-if="category.services && category.services.length > 0" class="hierarchy-services-list">
                            <li v-for="service in category.services" :key="service.id">
                              <div class="hierarchy-item service-item">
                                <span class="item-name">{{ service.nameEN }}</span>
                                <div class="item-actions">
                                  <DsButton
                                    variant="ghost"
                                    :aria-label="translate('admin.hierarchy.editService', 'Edit Service')"
                                    @click="showEditForm(service, category)"
                                  >
                                    ✏️
                                  </DsButton>
                                  <DsButton
                                    variant="ghost"
                                    :aria-label="translate('admin.hierarchy.deleteService', 'Delete Service')"
                                    @click="deleteHierarchyItem(service, category)"
                                  >
                                    🗑️
                                  </DsButton>
                                </div>
                              </div>
                            </li>
                          </ul>
                        </li>
                        <li v-if="knowledgeHierarchy.length === 0">
                          <DsStateDisplay type="empty">
                            {{
                              translate(
                                'admin.hierarchy.empty',
                                'No categories found. Click "Add New Category" to start.'
                              )
                            }}
                          </DsStateDisplay>
                        </li>
                      </ul>
                    </div>

                    <div v-if="hierarchyForm.visible" class="hierarchy-form-panel">
                      <h3 class="form-title">{{ hierarchyForm.title }}</h3>
                      <div class="form-group">
                        <label for="hierarchy-name-en">
                          {{ translate('admin.hierarchy.nameEnLabel', 'Name (English)') }}
                        </label>
                        <DsInput id="hierarchy-name-en" v-model="hierarchyForm.nameEN" type="text" />
                      </div>
                      <div class="translations-section">
                        <h4 class="translations-title">
                          {{ translate('admin.hierarchy.translationsTitle', 'Translations for Display') }}
                        </h4>

                        <DsStateDisplay v-if="isTranslationsLoading" type="loading">
                          {{ translate('admin.hierarchy.loadingTranslations', 'Loading translations...') }}
                        </DsStateDisplay>

                        <div v-else>
                          <div
                            v-for="(translation, index) in hierarchyForm.translations"
                            :key="index"
                            class="translation-row"
                          >
                            <DsSelect
                              v-model="translation.lang"
                              class="translation-lang-select"
                              :placeholder="translate('admin.hierarchy.selectLang', 'Select Language')"
                            >
                              <option v-for="lang in availableLanguages" :key="lang.code" :value="lang.code">
                                {{ lang.name }} ({{ lang.code }})
                              </option>
                            </DsSelect>
                            <DsInput
                              v-model="translation.text"
                              type="text"
                              class="translation-text-input"
                              :placeholder="translate('admin.hierarchy.translationPlaceholder', 'Enter translation')"
                            />
                            <DsButton
                              variant="danger"
                              :small="true"
                              class="translation-delete-btn"
                              :aria-label="translate('admin.hierarchy.deleteTranslation', 'Delete Translation')"
                              @click="removeTranslationRow(index)"
                            >
                              🗑️
                            </DsButton>
                          </div>
                          <DsButton variant="secondary" :small="true" @click="addTranslationRow">
                            {{ translate('admin.hierarchy.addTranslation', '+ Add Translation') }}
                          </DsButton>
                        </div>
                      </div>
                      <div class="form-actions">
                        <DsButton variant="primary" :disabled="!hierarchyForm.nameEN" @click="saveHierarchyItem">
                          {{ translate('admin.buttons.save', 'Save') }}
                        </DsButton>
                        <DsButton variant="secondary" @click="cancelHierarchyForm">
                          {{ translate('admin.buttons.cancel', 'Cancel') }}
                        </DsButton>
                      </div>
                    </div>
                  </div>
                </div>
                <div v-if="activeTab === 'documents'" class="dashboard-card" style="grid-column: span 2">
                  <div class="card-header">
                    <div class="card-title">
                      {{ translate('admin.documents.title', 'Document Management') }}
                    </div>
                    <div class="card-actions">
                      <DsButton variant="secondary" @click="addFromLink">
                        {{ translate('admin.documents.addLink', 'Add from Link') }}
                      </DsButton>
                      <DsButton variant="primary" @click="uploadFiles">
                        {{ translate('admin.documents.uploadFiles', 'Upload Files') }}
                      </DsButton>
                    </div>
                  </div>

                  <div class="filter-bar">
                    <div class="search-input-container">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        class="search-icon"
                      >
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                      <DsInput
                        v-model="documentSearchTerm"
                        type="search"
                        class="search-input"
                        :placeholder="translate('admin.documents.searchPlaceholder', 'Search by file name...')"
                      />
                    </div>
                    <DsSelect
                      v-model="documentFilters.status"
                      class="filter-select"
                      :placeholder="translate('admin.documents.allStatuses', 'All Statuses')"
                    >
                      <option value="all">
                        {{ translate('admin.documents.allStatuses', 'All Statuses') }}
                      </option>
                      <option value="pending">
                        {{ translate('admin.documents.statusPending', 'Pending') }}
                      </option>
                      <option value="ingested">
                        {{ translate('admin.documents.statusIngested', 'Ingested') }}
                      </option>
                      <option value="retracted">
                        {{ translate('admin.documents.statusRetracted', 'Retracted') }}
                      </option>
                    </DsSelect>
                    <div v-if="showIngestButton" class="card-actions">
                      <DsButton variant="primary" @click="handleBatchAction('ingest')">
                        {{ translate('admin.documents.ingestSelected', 'Ingest Selected') }}
                        ({{ selectedDocuments.length }})
                      </DsButton>
                    </div>
                  </div>

                  <div class="table-container">
                    <table class="data-table">
                      <thead>
                        <tr>
                          <th class="col-checkbox">
                            <input type="checkbox" @change="selectAllDocuments" />
                          </th>

                          <th class="col-main sortable" @click="sortBy('file_name')">
                            {{ translate('admin.documents.colFileName', 'File Name') }}
                            <span v-if="sortKey === 'file_name'" class="sort-arrow">
                              {{ sortOrders[sortKey] === 'asc' ? '▲' : '▼' }}
                            </span>
                          </th>

                          <th class="col-status sortable" @click="sortBy('dataprep.status')">
                            {{ translate('admin.documents.colStatus', 'Status') }}
                            <span v-if="sortKey === 'dataprep.status'" class="sort-arrow">
                              {{ sortOrders[sortKey] === 'asc' ? '▲' : '▼' }}
                            </span>
                          </th>

                          <th class="col-labels">
                            {{ translate('admin.documents.colLabels', 'Labels') }}
                          </th>

                          <th class="col-date sortable" @click="sortBy('upload_date')">
                            {{ translate('admin.documents.colUploadDate', 'Upload Date') }}
                            <span v-if="sortKey === 'upload_date'" class="sort-arrow">
                              {{ sortOrders[sortKey] === 'asc' ? '▲' : '▼' }}
                            </span>
                          </th>

                          <th class="col-size sortable" @click="sortBy('file_size')">
                            {{ translate('admin.documents.colSize', 'Size') }}
                            <span v-if="sortKey === 'file_size'" class="sort-arrow">
                              {{ sortOrders[sortKey] === 'asc' ? '▲' : '▼' }}
                            </span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-if="isDocumentsLoading">
                          <td colspan="6">
                            <DsStateDisplay type="loading">
                              {{ translate('admin.documents.loading', 'Loading documents...') }}
                            </DsStateDisplay>
                          </td>
                        </tr>

                        <tr v-if="!isDocumentsLoading && sortedAndFilteredDocuments.length === 0">
                          <td colspan="6" class="table-message">
                            {{ translate('admin.documents.empty', 'No documents found.') }}
                          </td>
                        </tr>

                        <tr
                          v-for="doc in sortedAndFilteredDocuments"
                          :key="doc._key"
                          class="document-row"
                          @click="viewDocumentDetails(doc.file_id)"
                        >
                          <td @click.stop>
                            <input v-model="selectedDocuments" type="checkbox" :value="doc._key" />
                          </td>
                          <td class="cell-main">{{ doc.file_name }}</td>
                          <td>
                            <DsStatusTag :variant="getStatusVariant(doc)">
                              {{ getDisplayStatus(doc) }}
                            </DsStatusTag>
                          </td>
                          <td>
                            <span v-for="label in doc.labels.slice(0, 2)" :key="label" class="label-tag">
                              {{ label }}
                            </span>
                            <span v-if="doc.labels.length > 2" class="label-tag-more"
                              >+{{ doc.labels.length - 2 }}</span
                            >
                          </td>
                          <td>
                            {{ new Date(doc.upload_date).toLocaleDateString() }}
                          </td>
                          <td>{{ formatFileSize(doc.file_size) }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div v-if="documentPagination.total > documentPagination.limit" class="pagination">
                    <DsButton
                      variant="ghost"
                      :small="true"
                      class="page-btn"
                      :disabled="documentPagination.page <= 1"
                      @click="handleDocumentPagination(documentPagination.page - 1)"
                    >
                      « {{ translate('admin.previous', 'Previous') }}
                    </DsButton>

                    <span class="pagination-info">
                      {{ translate('admin.showing', 'Showing') }}
                      {{ (documentPagination.page - 1) * documentPagination.limit + 1 }}-{{
                        Math.min(documentPagination.page * documentPagination.limit, documentPagination.total)
                      }}
                      {{ translate('admin.of', 'of') }}
                      {{ documentPagination.total }}
                    </span>

                    <DsButton
                      variant="ghost"
                      :small="true"
                      class="page-btn"
                      :disabled="documentPagination.page * documentPagination.limit >= documentPagination.total"
                      @click="handleDocumentPagination(documentPagination.page + 1)"
                    >
                      {{ translate('admin.next', 'Next') }} »
                    </DsButton>
                  </div>
                </div>

                <div v-if="activeTab === 'database'" class="dashboard-card" style="grid-column: span 2">
                  <div class="card-header">
                    <div class="card-title">
                      {{ translate('admin.databaseManagement', 'Database Management') }}
                    </div>
                    <div class="card-actions"></div>
                  </div>

                  <div class="db-actions">
                    <div class="db-action-card" @click="backupDatabase">
                      <div class="action-icon">💾</div>
                      <div class="action-title">
                        {{ translate('admin.dbActions.backup', 'Backup') }}
                      </div>
                      <div class="action-desc">
                        {{ translate('admin.dbActions.backupDesc', 'Create database backup') }}
                      </div>
                    </div>
                    <div class="db-action-card" @click="optimizeDatabase">
                      <div class="action-icon">📊</div>
                      <div class="action-title">
                        {{ translate('admin.dbActions.optimize', 'Optimize') }}
                      </div>
                      <div class="action-desc">
                        {{ translate('admin.dbActions.optimizeDesc', 'Optimize query performance') }}
                      </div>
                    </div>
                  </div>

                  <div class="db-stats">
                    <div>
                      <strong>{{ translate('admin.databaseSize', 'Database Size') }}:</strong>
                      {{ dbStats.databaseSize }}
                    </div>
                    <div>
                      <strong>{{ translate('admin.totalTables', 'Total Tables') }}:</strong>
                      {{ dbStats.totalTables }}
                    </div>
                  </div>
                </div>

                <div v-if="activeTab === 'logs'" class="dashboard-card" style="grid-column: span 2">
                  <div class="card-header">
                    <div class="card-title">
                      {{ translate('admin.logManagement', 'Log Management') }}
                    </div>
                    <div class="card-actions">
                      <DsButton variant="secondary" @click="searchLogs">
                        <span style="display: flex; align-items: center">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            style="margin-right: 4px"
                          >
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                          </svg>
                          {{ translate('admin.searchLogs', 'Search Logs') }}
                        </span>
                      </DsButton>
                      <DsButton variant="secondary" style="margin-left: 8px" @click="rolloverLogs">
                        <span style="display: flex; align-items: center">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            style="margin-right: 4px"
                          >
                            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1 -.57-8.38" />
                          </svg>
                          {{ translate('admin.rolloverLogs', 'Rollover Logs') }}
                        </span>
                      </DsButton>
                    </div>
                  </div>

                  <div class="logs-summary">
                    <h3 class="summary-title">
                      <span class="status-indicator error"></span>
                      {{ translate('admin.logsSection.errorLogs', 'Error Logs') }} ({{
                        translate('admin.today', 'Today')
                      }})
                    </h3>
                    <div class="log-summary-table">
                      <table>
                        <thead>
                          <tr>
                            <th>{{ translate('admin.logsSection.logType', 'Type') }}</th>
                            <th>
                              {{ translate('admin.logService', 'Service') }}
                            </th>
                            <th>{{ translate('admin.logsSection.logCount', 'Count') }}</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="(log, index) in errorLogsSummary" :key="'error-' + index">
                            <td>
                              {{ log.type }}
                            </td>
                            <td>{{ log.service }}</td>
                            <td class="log-count">{{ log.count }}</td>
                          </tr>
                          <tr v-if="errorLogsSummary.length === 0">
                            <td colspan="3" class="empty-logs">
                              {{ translate('admin.logsSection.noErrorLogs', 'No error logs recorded today.') }}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div class="logs-summary">
                    <h3 class="summary-title">
                      <span class="status-indicator warning"></span>
                      {{ translate('admin.logsSection.warningLogs', 'Warning Logs') }} ({{
                        translate('admin.today', 'Today')
                      }})
                    </h3>
                    <div class="log-summary-table">
                      <table>
                        <thead>
                          <tr>
                            <th>{{ translate('admin.logsSection.logType', 'Type') }}</th>
                            <th>
                              {{ translate('admin.logService', 'Service') }}
                            </th>
                            <th>{{ translate('admin.logsSection.logCount', 'Count') }}</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="(log, index) in warningLogsSummary" :key="'warning-' + index">
                            <td>
                              {{ log.type }}
                            </td>
                            <td>{{ log.service }}</td>
                            <td class="log-count">{{ log.count }}</td>
                          </tr>
                          <tr v-if="warningLogsSummary.length === 0">
                            <td colspan="3" class="empty-logs">
                              {{ translate('admin.logsSection.noWarningLogs', 'No warning logs recorded today.') }}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div v-if="searchResults && searchResults.length > 0" class="logs-summary">
                    <h3 class="summary-title">
                      <span class="status-indicator info"></span>
                      {{ translate('admin.searchResults', 'Latest Search Results') }}
                      <span class="results-count">
                        ({{ searchResults.length }} {{ translate('admin.entriesFound', 'entries found') }})
                      </span>
                    </h3>
                    <div class="log-summary-table">
                      <table>
                        <thead>
                          <tr>
                            <th>{{ translate('admin.logTime', 'Time') }}</th>
                            <th>{{ translate('admin.logLevel', 'Level') }}</th>
                            <th>
                              {{ translate('admin.logService', 'Service') }}
                            </th>
                            <th>
                              {{ translate('admin.logMessage', 'Message') }}
                            </th>
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
                        <DsButton variant="secondary" :small="true" @click="searchLogs">
                          {{ translate('admin.viewAllResults', 'View All Results') }}
                        </DsButton>
                      </div>
                    </div>
                  </div>

                  <log-search-dialog
                    v-if="showLogSearchDialog"
                    @close="showLogSearchDialog = false"
                    @search-results="handleSearchResults"
                  />

                  <div class="logs-info">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="16" x2="12" y2="12" />
                      <line x1="12" y1="8" x2="12.01" y2="8" />
                    </svg>
                    <span>
                      {{
                        translate(
                          'admin.logsSection.infoLogsNote',
                          'Info logs are not shown in the summary. Use the search function to view all log types.'
                        )
                      }}
                    </span>
                  </div>
                </div>

                <div v-if="activeTab === 'security'" class="dashboard-card" style="grid-column: span 2">
                  <div class="card-header">
                    <div class="card-title">
                      {{ translate('admin.security.title', 'Security Monitoring') }}
                    </div>
                    <div class="card-actions">
                      <DsButton
                        variant="primary"
                        :disabled="isLoading && currentOperation === 'runSecurityScan'"
                        @click="runSecurityScan"
                      >
                        <span v-if="isLoading && currentOperation === 'runSecurityScan'">
                          <Loader2 :size="14" class="inline-spinner" />
                          {{ translate('admin.security.runningSecurityScan', 'Running Scan...') }}
                        </span>
                        <span v-else>
                          {{ translate('admin.security.securityScan', 'Security Scan') }}
                        </span>
                      </DsButton>
                    </div>
                  </div>

                  <DsStateDisplay v-if="isLoading && currentOperation === 'runSecurityScan'" type="loading">
                    {{ translate('admin.security.loadingScan', 'Loading scan results...') }}
                  </DsStateDisplay>

                  <div v-if="!isLoading" class="security-details">
                    <div>
                      <strong>{{ translate('admin.security.lastSecurityScan', 'Last Security Scan') }}:</strong>
                      {{ securityMetrics.lastScan }}
                    </div>
                    <div>
                      <strong>{{ translate('admin.security.vulnerabilitiesFound', 'Vulnerabilities Found') }}:</strong>
                      <span :class="securityMetrics.vulnerabilities.critical > 0 ? 'text-danger' : ''">
                        {{ securityMetrics.vulnerabilities.critical }}
                        {{ translate('admin.security.critical', 'critical') }}
                      </span>
                      ,
                      <span :class="securityMetrics.vulnerabilities.medium > 0 ? 'text-warning' : ''">
                        {{ securityMetrics.vulnerabilities.medium }}
                        {{ translate('admin.security.medium', 'medium') }}
                      </span>
                      ,
                      <span :class="securityMetrics.vulnerabilities.low > 0 ? 'text-info' : ''">
                        {{ securityMetrics.vulnerabilities.low }}
                        {{ translate('admin.security.low', 'low') }}
                      </span>
                    </div>
                  </div>

                  <div v-if="!isLoading && securityDetails" class="security-findings-section">
                    <div
                      v-if="
                        securityDetails.vulnerabilityDetails &&
                        securityDetails.vulnerabilityDetails.critical &&
                        securityDetails.vulnerabilityDetails.critical.length > 0
                      "
                      class="vulnerability-section critical-section"
                    >
                      <h3 class="section-title">
                        <span class="severity-indicator critical"></span>
                        {{ translate('admin.security.criticalVulnerabilities', 'Critical Vulnerabilities') }}
                      </h3>
                      <div class="vulnerability-list">
                        <div
                          v-for="(vuln, index) in securityDetails.vulnerabilityDetails.critical"
                          :key="'crit-' + index"
                          class="vulnerability-card"
                        >
                          <div class="vuln-type">{{ vuln.type }}</div>
                          <div class="vuln-description">
                            {{ vuln.description }}
                          </div>
                          <div class="vuln-detail">
                            <strong>{{ translate('admin.security.severity', 'Severity') }}:</strong>
                            {{ vuln.severity }}
                          </div>
                          <div class="vuln-detail">
                            <strong>{{ translate('admin.security.occurrences', 'Occurrences') }}:</strong>
                            {{ vuln.occurrences }}
                          </div>
                          <div v-if="vuln.firstSeen" class="vuln-detail">
                            <strong>{{ translate('admin.security.firstSeen', 'First Seen') }}:</strong>
                            {{ vuln.firstSeen }}
                          </div>
                          <div v-if="vuln.lastSeen" class="vuln-detail">
                            <strong>{{ translate('admin.security.lastSeen', 'Last Seen') }}:</strong>
                            {{ vuln.lastSeen }}
                          </div>
                          <div v-if="vuln.matchedTerm" class="vuln-detail">
                            <strong>{{ translate('admin.security.matchedTerm', 'Matched Term') }}:</strong>
                            {{ vuln.matchedTerm }}
                          </div>
                          <div v-if="vuln.timestamp" class="vuln-detail">
                            <strong>{{ translate('admin.security.timestamp', 'Timestamp') }}:</strong>
                            {{ vuln.timestamp }}
                          </div>
                          <div v-if="vuln.service" class="vuln-detail">
                            <strong>{{ translate('admin.security.service', 'Service') }}:</strong>
                            {{ vuln.service }}
                          </div>
                          <div v-if="vuln.lineNumber" class="vuln-detail">
                            <strong>{{ translate('admin.security.lineNumber', 'Line Number') }}:</strong>
                            {{ vuln.lineNumber }}
                          </div>
                          <div v-if="vuln.url" class="vuln-detail">
                            <strong>{{ translate('admin.security.url', 'URL') }}:</strong>
                            {{ vuln.url }}
                          </div>
                          <div v-if="vuln.lineNumbers" class="vuln-detail">
                            <strong>{{ translate('admin.security.lineNumbers', 'Line Numbers') }}:</strong>
                            {{ vuln.lineNumbers.join(', ') }}
                          </div>
                          <div v-if="vuln.recommendation" class="vuln-recommendation">
                            {{ vuln.recommendation }}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div
                      v-if="
                        securityDetails.vulnerabilityDetails &&
                        securityDetails.vulnerabilityDetails.medium &&
                        securityDetails.vulnerabilityDetails.medium.length > 0
                      "
                      class="vulnerability-section medium-section"
                    >
                      <h3 class="section-title">
                        <span class="severity-indicator warning"></span>
                        {{ translate('admin.security.mediumVulnerabilities', 'Medium Vulnerabilities') }}
                      </h3>
                      <div class="vulnerability-list">
                        <div
                          v-for="(vuln, index) in securityDetails.vulnerabilityDetails.medium"
                          :key="'med-' + index"
                          class="vulnerability-card"
                        >
                          <div class="vuln-type">{{ vuln.type }}</div>
                          <div class="vuln-description">
                            {{ vuln.description }}
                          </div>
                          <div class="vuln-detail">
                            <strong>{{ translate('admin.security.severity', 'Severity') }}:</strong>
                            {{ vuln.severity }}
                          </div>
                          <div class="vuln-detail">
                            <strong>{{ translate('admin.security.occurrences', 'Occurrences') }}:</strong>
                            {{ vuln.occurrences }}
                          </div>
                          <div v-if="vuln.firstSeen" class="vuln-detail">
                            <strong>{{ translate('admin.security.firstSeen', 'First Seen') }}:</strong>
                            {{ vuln.firstSeen }}
                          </div>
                          <div v-if="vuln.lastSeen" class="vuln-detail">
                            <strong>{{ translate('admin.security.lastSeen', 'Last Seen') }}:</strong>
                            {{ vuln.lastSeen }}
                          </div>
                          <div v-if="vuln.matchedTerm" class="vuln-detail">
                            <strong>{{ translate('admin.security.matchedTerm', 'Matched Term') }}:</strong>
                            {{ vuln.matchedTerm }}
                          </div>
                          <div v-if="vuln.timestamp" class="vuln-detail">
                            <strong>{{ translate('admin.security.timestamp', 'Timestamp') }}:</strong>
                            {{ vuln.timestamp }}
                          </div>
                          <div v-if="vuln.service" class="vuln-detail">
                            <strong>{{ translate('admin.security.service', 'Service') }}:</strong>
                            {{ vuln.service }}
                          </div>
                          <div v-if="vuln.lineNumber" class="vuln-detail">
                            <strong>{{ translate('admin.security.lineNumber', 'Line Number') }}:</strong>
                            {{ vuln.lineNumber }}
                          </div>
                          <div v-if="vuln.url" class="vuln-detail">
                            <strong>{{ translate('admin.security.url', 'URL') }}:</strong>
                            {{ vuln.url }}
                          </div>
                          <div v-if="vuln.lineNumbers" class="vuln-detail">
                            <strong>{{ translate('admin.security.lineNumbers', 'Line Numbers') }}:</strong>
                            {{ vuln.lineNumbers.join(', ') }}
                          </div>
                          <div v-if="vuln.recommendation" class="vuln-recommendation">
                            {{ vuln.recommendation }}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div
                      v-if="
                        securityDetails.vulnerabilityDetails &&
                        securityDetails.vulnerabilityDetails.low &&
                        securityDetails.vulnerabilityDetails.low.length > 0
                      "
                      class="vulnerability-section low-section"
                    >
                      <h3 class="section-title">
                        <span class="severity-indicator info"></span>
                        {{ translate('admin.security.lowVulnerabilities', 'Low Vulnerabilities') }}
                      </h3>
                      <div class="vulnerability-list">
                        <div
                          v-for="(vuln, index) in securityDetails.vulnerabilityDetails.low"
                          :key="'low-' + index"
                          class="vulnerability-card"
                        >
                          <div class="vuln-type">{{ vuln.type }}</div>
                          <div class="vuln-description">
                            {{ vuln.description }}
                          </div>
                          <div class="vuln-detail">
                            <strong>{{ translate('admin.security.severity', 'Severity') }}:</strong>
                            {{ vuln.severity }}
                          </div>
                          <div class="vuln-detail">
                            <strong>{{ translate('admin.security.occurrences', 'Occurrences') }}:</strong>
                            {{ vuln.occurrences }}
                          </div>
                          <div v-if="vuln.firstSeen" class="vuln-detail">
                            <strong>{{ translate('admin.security.firstSeen', 'First Seen') }}:</strong>
                            {{ vuln.firstSeen }}
                          </div>
                          <div v-if="vuln.lastSeen" class="vuln-detail">
                            <strong>{{ translate('admin.security.lastSeen', 'Last Seen') }}:</strong>
                            {{ vuln.lastSeen }}
                          </div>
                          <div v-if="vuln.matchedTerm" class="vuln-detail">
                            <strong>{{ translate('admin.security.matchedTerm', 'Matched Term') }}:</strong>
                            {{ vuln.matchedTerm }}
                          </div>
                          <div v-if="vuln.timestamp" class="vuln-detail">
                            <strong>{{ translate('admin.security.timestamp', 'Timestamp') }}:</strong>
                            {{ vuln.timestamp }}
                          </div>
                          <div v-if="vuln.service" class="vuln-detail">
                            <strong>{{ translate('admin.security.service', 'Service') }}:</strong>
                            {{ vuln.service }}
                          </div>
                          <div v-if="vuln.lineNumber" class="vuln-detail">
                            <strong>{{ translate('admin.security.lineNumber', 'Line Number') }}:</strong>
                            {{ vuln.lineNumber }}
                          </div>
                          <div v-if="vuln.url" class="vuln-detail">
                            <strong>{{ translate('admin.security.url', 'URL') }}:</strong>
                            {{ vuln.url }}
                          </div>
                          <div v-if="vuln.lineNumbers" class="vuln-detail">
                            <strong>{{ translate('admin.security.lineNumbers', 'Line Numbers') }}:</strong>
                            {{ vuln.lineNumbers.join(', ') }}
                          </div>
                          <div v-if="vuln.recommendation" class="vuln-recommendation">
                            {{ vuln.recommendation }}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div
                      v-if="
                        securityDetails &&
                        securityDetails.vulnerabilityDetails &&
                        securityDetails.vulnerabilityDetails.medium &&
                        securityDetails.vulnerabilityDetails.medium.length > 0
                      "
                      class="security-recommendations"
                    >
                      <h3 class="section-title">
                        <span class="severity-indicator info"></span>
                        {{ translate('admin.security.securityRecommendations', 'Security Recommendations') }}
                      </h3>
                      <div class="recommendations-list">
                        <div class="recommendation-item severity-medium">
                          <div class="recommendation-header">
                            <span class="severity-indicator medium"></span>
                            <span class="recommendation-title">
                              {{
                                translate('admin.security.securityProbeAttempts', 'Security Probe Attempts Detected')
                              }}
                            </span>
                          </div>
                          <div class="recommendation-description">
                            {{ securityDetails.vulnerabilityDetails.medium.length }}
                            {{
                              translate(
                                'admin.security.sensitiveFileAccess',
                                'attempts to access sensitive files or endpoints detected'
                              )
                            }}
                          </div>
                          <div class="recommendation-action">
                            <strong>{{ translate('admin.security.recommendedAction', 'Recommended Action') }}:</strong>
                            {{
                              translate(
                                'admin.security.rateLimitRecommendation',
                                'Consider implementing rate limiting, IP blocking for persistent offenders, and ensure proper server hardening is in place'
                              )
                            }}
                          </div>
                        </div>
                        <div
                          v-if="
                            securityDetails.vulnerabilityDetails.medium.some(
                              (v) => v.description && v.description.includes('.env')
                            )
                          "
                          class="recommendation-item severity-medium"
                        >
                          <div class="recommendation-header">
                            <span class="severity-indicator medium"></span>
                            <span class="recommendation-title">
                              {{ translate('admin.security.envFileAccess', 'Environment File Access Attempts') }}
                            </span>
                          </div>
                          <div class="recommendation-description">
                            {{
                              securityDetails.vulnerabilityDetails.medium.filter(
                                (v) => v.description && v.description.includes('.env')
                              ).length
                            }}
                            {{
                              translate('admin.security.envFileAccessDesc', 'attempts to access .env files detected')
                            }}
                          </div>
                          <div class="recommendation-action">
                            <strong>{{ translate('admin.security.recommendedAction', 'Recommended Action') }}:</strong>
                            {{
                              translate(
                                'admin.security.envFileRecommendation',
                                'Ensure environment files are not accessible from web directories and server configurations properly block access to sensitive files'
                              )
                            }}
                          </div>
                        </div>
                        <div
                          v-if="
                            securityDetails.vulnerabilityDetails.medium.some(
                              (v) => v.description && v.description.includes('.git')
                            )
                          "
                          class="recommendation-item severity-medium"
                        >
                          <div class="recommendation-header">
                            <span class="severity-indicator medium"></span>
                            <span class="recommendation-title">
                              {{ translate('admin.security.gitRepoAccess', 'Git Repository Access Attempts') }}
                            </span>
                          </div>
                          <div class="recommendation-description">
                            {{
                              securityDetails.vulnerabilityDetails.medium.filter(
                                (v) => v.description && v.description.includes('.git')
                              ).length
                            }}
                            {{
                              translate(
                                'admin.security.gitRepoAccessDesc',
                                'attempts to access Git repository files detected'
                              )
                            }}
                          </div>
                          <div class="recommendation-action">
                            <strong>{{ translate('admin.security.recommendedAction', 'Recommended Action') }}:</strong>
                            {{
                              translate(
                                'admin.security.gitRepoRecommendation',
                                'Make sure .git directories are properly secured and not accessible from the web'
                              )
                            }}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div
                      v-if="securityDetails.failedLoginDetails && securityDetails.failedLoginDetails.length > 0"
                      class="vulnerability-section login-section"
                    >
                      <h3 class="section-title">
                        <span class="severity-indicator warning"></span>
                        {{ translate('admin.security.authenticationIssues', 'Authentication Issues') }}
                      </h3>
                      <div class="detail-table">
                        <table>
                          <thead>
                            <tr>
                              <th style="width: 25%">
                                {{ translate('admin.security.timestamp', 'Timestamp') }}
                              </th>
                              <th style="width: 15%">
                                {{ translate('admin.security.type', 'Type') }}
                              </th>
                              <th>
                                {{ translate('admin.security.message', 'Message') }}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr v-for="(issue, index) in securityDetails.failedLoginDetails" :key="'login-' + index">
                              <td>{{ issue.timestamp }}</td>
                              <td>
                                <span v-if="issue.type" :class="['log-level', `log-${issue.type.toLowerCase()}`]">
                                  {{ issue.type }}
                                </span>
                              </td>
                              <td class="log-message-cell">
                                {{ issue.message }}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div
                      v-if="securityDetails.suspiciousDetails && securityDetails.suspiciousDetails.length > 0"
                      class="vulnerability-section suspicious-section"
                    >
                      <h3 class="section-title">
                        <span class="severity-indicator warning"></span>
                        {{ translate('admin.security.suspiciousActivityLogs', 'Suspicious Activity Logs') }}
                      </h3>
                      <div class="detail-table">
                        <table>
                          <thead>
                            <tr>
                              <th style="width: 25%">
                                {{ translate('admin.security.timestamp', 'Timestamp') }}
                              </th>
                              <th style="width: 15%">
                                {{ translate('admin.security.type', 'Type') }}
                              </th>
                              <th>
                                {{ translate('admin.security.message', 'Message') }}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr
                              v-for="(activity, index) in securityDetails.suspiciousDetails"
                              :key="'suspicious-' + index"
                            >
                              <td>{{ activity.timestamp }}</td>
                              <td>
                                <span v-if="activity.type" :class="['log-level', `log-${activity.type.toLowerCase()}`]">
                                  {{ activity.type }}
                                </span>
                              </td>
                              <td class="log-message-cell">
                                {{ activity.message }}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div
                      v-if="
                        !isLoading &&
                        securityDetails &&
                        (!securityDetails.vulnerabilityDetails ||
                          (securityDetails.vulnerabilityDetails.critical.length === 0 &&
                            securityDetails.vulnerabilityDetails.medium.length === 0 &&
                            securityDetails.vulnerabilityDetails.low.length === 0 &&
                            (!securityDetails.failedLoginDetails || securityDetails.failedLoginDetails.length === 0)))
                      "
                    >
                      <DsStateDisplay type="empty">
                        {{ translate('admin.security.noVulnerabilitiesFound', 'No Vulnerabilities Found') }}
                        <template #action>
                          <p style="color: var(--muted); max-width: 400px; text-align: center">
                            {{
                              translate(
                                'admin.security.systemSecure',
                                'Your system appears to be secure. Continue monitoring regularly.'
                              )
                            }}
                          </p>
                        </template>
                      </DsStateDisplay>
                    </div>
                  </div>
                </div>

                <div v-if="activeTab === 'users'" class="dashboard-card" style="grid-column: span 2">
                  <div class="card-header">
                    <div class="card-title">
                      {{ translate('admin.userManagement', 'User Management') }}
                    </div>
                  </div>

                  <div class="user-stats-summary">
                    <div class="stats-row">
                      <div class="stat-item">
                        <span class="stat-label"
                          >{{ translate('admin.userManagementSection.totalUsers', 'Total Users') }}:</span
                        >
                        <span class="stat-value">{{ userStats.totalUsers }}</span>
                      </div>
                      <div class="stat-item">
                        <span class="stat-label">
                          {{ translate('admin.monthlyActiveUsers', 'Currently Active Users (CAU)') }}:
                        </span>
                        <span class="stat-value">{{ userStats.activeUsers }}</span>
                      </div>
                      <div class="stat-item">
                        <span class="stat-label"
                          >{{ translate('admin.userManagementSection.newUsers', 'New Users (Month)') }}:</span
                        >
                        <span class="stat-value">{{ userStats.newUsers }}</span>
                      </div>
                    </div>
                  </div>

                  <div class="search-bar">
                    <div class="search-input-container">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        class="search-icon"
                      >
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                      <DsInput
                        v-model="userSearchTerm"
                        type="search"
                        class="search-input"
                        :placeholder="translate('admin.userManagementSection.searchUsers', 'Search users...')"
                        @enter="searchUsers"
                      />
                      <DsButton
                        v-if="userSearchTerm"
                        variant="ghost"
                        :small="true"
                        class="search-clear-btn"
                        :aria-label="translate('admin.clearSearch', 'Clear search')"
                        @click="resetUserSearch"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </DsButton>
                    </div>

                    <div class="search-filter">
                      <DsSelect
                        v-model="userSearchField"
                        class="search-field-select"
                        :placeholder="translate('admin.userManagementSection.searchFields.all', 'All Fields')"
                      >
                        <option value="all">
                          {{ translate('admin.userManagementSection.searchFields.all', 'All Fields') }}
                        </option>
                        <option value="name">
                          {{ translate('admin.userManagementSection.searchFields.name', 'Name') }}
                        </option>
                        <option value="email">
                          {{ translate('admin.userManagementSection.searchFields.email', 'Email') }}
                        </option>
                        <option value="role">
                          {{ translate('admin.userManagementSection.searchFields.role', 'Role') }}
                        </option>
                      </DsSelect>
                    </div>

                    <div class="search-button">
                      <DsButton variant="primary" :disabled="isSearchingUsers" @click="searchUsers">
                        {{ translate('admin.userManagementSection.search', 'Search') }}
                      </DsButton>
                    </div>
                  </div>

                  <div v-if="userSearchResults" class="search-results-info">
                    <span>
                      {{ userSearchTotal }}
                      {{ translate('admin.userManagementSection.usersFound', 'users found') }}
                      <DsButton v-if="userSearchResults" variant="secondary" :small="true" @click="resetUserSearch">
                        {{ translate('admin.userManagementSection.showAllUsers', 'Show All Users') }}
                      </DsButton>
                    </span>
                  </div>

                  <DsStateDisplay v-if="isSearchingUsers" type="loading">
                    {{ translate('admin.userManagementSection.searching', 'Searching...') }}
                  </DsStateDisplay>

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
                        <td>{{ (user.roles || []).join(', ') || user.role }}</td>
                        <td>
                          <DsButton
                            variant="secondary"
                            tag="a"
                            small
                            :href="getUserManageUrl(user)"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {{ translate('admin.manage', 'Manage') }} →
                          </DsButton>
                        </td>
                      </tr>
                      <tr v-if="displayedUsers.length === 0">
                        <td colspan="4" style="text-align: center; padding: 2rem">
                          <div v-if="isSearchingUsers">
                            {{ translate('admin.userManagementSection.searchingUsers', 'Searching for users...') }}
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

                  <div v-if="userSearchResults && userSearchTotal > userSearchLimit" class="pagination">
                    <DsButton
                      variant="ghost"
                      :small="true"
                      class="page-btn"
                      :disabled="userSearchOffset === 0"
                      @click="handleUserSearchPagination(Math.max(0, userSearchOffset - userSearchLimit))"
                    >
                      « {{ translate('admin.previous', 'Previous') }}
                    </DsButton>

                    <span class="pagination-info">
                      {{ translate('admin.showing', 'Showing') }}
                      {{ userSearchOffset + 1 }}-{{ Math.min(userSearchOffset + userSearchLimit, userSearchTotal) }}
                      {{ translate('admin.of', 'of') }} {{ userSearchTotal }}
                    </span>

                    <DsButton
                      variant="ghost"
                      :small="true"
                      class="page-btn"
                      :disabled="userSearchOffset + userSearchLimit >= userSearchTotal"
                      @click="handleUserSearchPagination(userSearchOffset + userSearchLimit)"
                    >
                      {{ translate('admin.next', 'Next') }} »
                    </DsButton>
                  </div>
                </div>
              </div>
            </DsTabs>
          </div>
        </div>
      </div>

      <DsSpinner v-if="isLoading" fixed>
        <p>
          {{
            currentOperation
              ? translate(`admin.operations.${currentOperation}.loading`, `Processing ${currentOperation}...`)
              : translate('admin.loading', 'Loading...')
          }}
        </p>
      </DsSpinner>

      <OperationResultsModal
        v-if="showOperationResults && operationResults"
        :operation="currentOperation"
        :results="operationResults"
        @close="closeOperationResults"
      />

      <UploadFilesDialog
        v-if="showUploadDialog"
        @close="showUploadDialog = false"
        @files-uploaded="handleFilesUploaded"
      />

      <AddFromLinkDialog v-if="showLinkDialog" @close="showLinkDialog = false" @link-submitted="handleLinkSubmitted" />

      <FileDetailsDialog
        v-if="showDetailsDialog"
        :file-id="selectedFileId"
        @close="showDetailsDialog = false"
        @file-updated="handleFileUpdated"
        @action-triggered="handleFileAction"
      />

      <ConfirmDialog
        :visible="confirmDialogState.visible"
        :title="confirmDialogState.title"
        :message="confirmDialogState.message"
        :confirm-text="confirmDialogState.confirmText"
        :cancel-text="confirmDialogState.cancelText"
        @confirm="confirmDialogState.onConfirm"
        @cancel="confirmDialogState.onCancel"
      />
    </div>
  </div>
</template>

<script>
import serviceTreeService from '../services/serviceTreeService.js';
import databaseOperationsService from '../services/databaseOperationsService';
import adminDashboardService from '../services/adminDashboardService';
import OperationResultsModal from './OperationResultsModal.vue';
import LogSearchDialog from './LogSearchDialog.vue';
import UploadFilesDialog from './UploadFilesDialog.vue';
import AddFromLinkDialog from './AddFromLinkDialog.vue';
import FileDetailsDialog from './FileDetailsDialog.vue';
import ConfirmDialog from './ConfirmDialog.vue'; // IMPORT ConfirmDialog
import DsButton from './ds/Button.vue';
import DsInput from './ds/Input.vue';
import DsStatusTag from './ds/StatusTag.vue';
import DsSpinner from './ds/Spinner.vue';
import DsStateDisplay from './ds/StateDisplay.vue';
import DsTabs from './ds/Tabs.vue';
import DsSelect from './ds/Select.vue';
import { Loader2 } from 'lucide-vue-next';
import { eventBus } from '../eventBus.js';
import { availableLanguages } from '../config/languageConfig.js';
import oidcConfig from '../config/oidcConfig.js';
import documentFileService from '../services/documentFileService.js';
import { formatFileSize } from '../utils/fileUtils.js';
import { themeManager } from '../utils/ThemeManager';

export default {
  name: 'AdminDashboard',
  components: {
    OperationResultsModal,
    LogSearchDialog,
    UploadFilesDialog,
    AddFromLinkDialog,
    FileDetailsDialog,
    ConfirmDialog, // REGISTER ConfirmDialog
    DsButton,
    DsInput,
    DsStatusTag,
    DsSpinner,
    DsStateDisplay,
    DsTabs,
    DsSelect,
    Loader2
  },
  emits: [],
  data() {
    return {
      // Properties for the Document Management table
      sortKey: 'upload_date', // Default sort column
      sortOrders: {
        file_name: 'asc',
        'dataprep.status': 'asc',
        upload_date: 'desc', // Default to newest first
        file_size: 'asc'
      },

      // Placeholder for form state
      originalHierarchyFormState: null,

      // State for loading translations
      isTranslationsLoading: false,

      // Configuration for language dropdowns in translations tables
      availableLanguages: availableLanguages,

      // Current locale for translations
      currentLocale: this.getCurrentLanguage(),

      securityDetails: null,
      // Theme settings
      currentTheme: document.documentElement.getAttribute('data-theme') || 'light',

      // Tab navigation
      activeTab: 'overview',
      tabs: [
        { id: 'overview', label: 'System Health' },
        { id: 'hierarchy', label: 'Knowledge Hierarchy' },
        { id: 'documents', label: 'Document Management' },
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

      logs: [],

      // CORRECTED: Hardcoded data removed. Initialized as empty arrays.
      errorLogsSummary: [],
      warningLogsSummary: [],

      showLogSearchDialog: false,

      showOperationResults: false,

      metrics: {
        systemUptime: 99.98,
        avgResponseTime: 245,
        errorRate: 0.05,
        monthlyActiveUsers: 0
      },

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

      userStats: {
        totalUsers: 0,
        activeUsers: 0,
        newUsers: 0,
        users: []
      },

      currentUser: {},

      searchResults: [],

      userSearchTerm: '',
      userSearchField: 'all',
      isSearchingUsers: false,
      userSearchResults: null,
      userSearchTotal: 0,
      userSearchLimit: 20,
      userSearchOffset: 0,

      // --- START: NEW DATA FOR HIERARCHY & DOCUMENTS ---
      isHierarchyLoading: false,
      knowledgeHierarchy: [],
      hierarchyForm: {
        visible: false,
        mode: null,
        title: '',
        _key: null,
        nameEN: '',
        translations: [], // Array for translation objects
        parentId: null
      },
      documents: [], // Remove the old hardcoded data and start with an empty array
      isDocumentsLoading: false,
      documentPagination: {
        page: 1,
        limit: 15, // You can adjust the number of items per page
        total: 0
      },
      // The existing properties below are already correct
      documentSearchTerm: '',
      documentFilters: {
        status: 'all'
      },
      selectedDocuments: [],

      // --- END: DOCUMENT and HIERARCHY DATA ---

      showUploadDialog: false,
      showLinkDialog: false,
      showDetailsDialog: false,
      selectedFileId: null,

      // --- ADDED: State for ConfirmDialog ---
      confirmDialogState: {
        visible: false,
        title: '',
        message: '',
        confirmText: 'OK',
        cancelText: 'Cancel',
        onConfirm: () => {},
        onCancel: () => {}
      }
    };
  },
  computed: {
    adminTabs() {
      return this.tabs.map((t) => ({
        label: this.translate(`admin.tabs.${t.id}`, t.label),
        value: t.id
      }));
    },
    keycloakAdminUrl() {
      const keycloakUrl = window.location.origin + '/auth/admin';
      // Extract realm from runtime OIDC config (authority = "https://host/auth/realms/{realm}")
      const realm = (oidcConfig.authority.match(/\/realms\/([^/]+)$/) || [])[1] || 'genie';
      return `${keycloakUrl}/${realm}/console/#/${realm}/users`;
    },

    // Test if there are unsaved changes
    isFormDirty() {
      if (!this.originalHierarchyFormState) {
        return false;
      }
      // Compare the stringified versions of the current and original form states
      return JSON.stringify(this.hierarchyForm) !== this.originalHierarchyFormState;
    },

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
    },

    /**
     * Performs client-side filtering on the documents array based on the selected status.
     */
    filteredDocuments() {
      const selectedStatus = this.documentFilters.status;
      if (!this.documents || this.documents.length === 0) {
        return [];
      }
      if (selectedStatus === 'all') {
        return this.documents; // If 'All' is selected, return the full list
      }
      return this.documents.filter((doc) => doc.dataprep && doc.dataprep.status === selectedStatus);
    },

    sortedAndFilteredDocuments() {
      // Get the currently filtered list
      const filtered = this.filteredDocuments;
      if (!this.sortKey) return filtered;

      // Get the current sort direction
      const order = this.sortOrders[this.sortKey] || 'asc';
      const multiplier = order === 'asc' ? 1 : -1;

      // Make a copy and sort it
      return [...filtered].sort((a, b) => {
        let valA, valB;

        // Handle nested properties like 'dataprep.status'
        if (this.sortKey.includes('.')) {
          const keys = this.sortKey.split('.');
          valA = a[keys[0]][keys[1]];
          valB = b[keys[0]][keys[1]];
        } else {
          valA = a[this.sortKey];
          valB = b[this.sortKey];
        }

        // Comparison logic
        if (valA < valB) return -1 * multiplier;
        if (valA > valB) return 1 * multiplier;
        return 0;
      });
    },

    showIngestButton() {
      // 1. Don't show if no documents are selected
      if (this.selectedDocuments.length === 0) {
        return false;
      }

      // 2. Create a Set of selected keys for efficient lookup
      const selectedKeys = new Set(this.selectedDocuments);

      // 3. Find all the full document objects that are currently selected
      const selectedDocObjects = this.documents.filter((doc) => selectedKeys.has(doc._key));

      // 4. Check if ANY of the selected documents have the status 'ingested'
      const hasIngestedFile = selectedDocObjects.some((doc) => doc.dataprep && doc.dataprep.status === 'ingested');

      // 5. Only show the button if there are selected files AND none of them are ingested
      return !hasIngestedFile;
    }
  },
  watch: {
    '$i18n.locale'(newLocale) {
      this.currentLocale = newLocale;
      this.$forceUpdate();
    },
    activeTab(newTab) {
      if (newTab === 'hierarchy' && this.knowledgeHierarchy.length === 0) {
        this.loadKnowledgeHierarchy();
      }
    },

    documentSearchTerm() {
      // A debounce would be ideal here in a real app, but this works
      this.documentPagination.page = 1; // Reset to first page on new search
      this.loadDocuments();
    },
    documentFilters: {
      handler() {
        this.documentPagination.page = 1; // Reset to first page on filter change
        this.loadDocuments();
      },
      deep: true
    }
  },
  created() {
    // Initialize with the current language settings
    this.currentLocale = this.$i18n ? this.$i18n.locale : 'en';
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
    formatFileSize,
    // --- ADDED: Methods for ConfirmDialog ---
    /**
     * Shows a confirmation dialog.
     * @param {object} options - Dialog options.
     */
    showConfirmDialog({ title, message, confirmText, cancelText, onConfirm, onCancel }) {
      this.confirmDialogState = {
        visible: true,
        title: title || this.translate('admin.confirm.defaultTitle', 'Confirm'),
        message: message || this.translate('admin.confirm.defaultMessage', 'Are you sure?'),
        confirmText: confirmText || this.translate('common.ok', 'OK'),
        cancelText: cancelText || this.translate('common.cancel', 'Cancel'),
        onConfirm: () => {
          if (onConfirm) onConfirm();
          this.resetConfirmDialog();
        },
        onCancel: () => {
          if (onCancel) onCancel();
          this.resetConfirmDialog();
        }
      };
    },

    /**
     * Resets the confirmation dialog state to hide it.
     */
    resetConfirmDialog() {
      this.confirmDialogState = {
        visible: false,
        title: '',
        message: '',
        confirmText: 'OK',
        cancelText: 'Cancel',
        onConfirm: () => {},
        onCancel: () => {}
      };
    },
    // --- END: Methods for ConfirmDialog ---

    /**
     * Handle document list pagination.
     */
    handleDocumentPagination(newPage) {
      if (newPage > 0 && (newPage - 1) * this.documentPagination.limit < this.documentPagination.total) {
        this.documentPagination.page = newPage;
        this.loadDocuments();
      }
    },

    /**
     * Sets the sort key and toggles the sort order.
     */
    sortBy(key) {
      if (this.sortKey === key) {
        // If clicking the same column, reverse the order
        this.sortOrders[key] = this.sortOrders[key] === 'asc' ? 'desc' : 'asc';
      } else {
        // If clicking a new column, set it as the sort key
        this.sortKey = key;
      }
    },

    // Translation method - improved to ensure consistent behavior with SettingsComponent
    translate(key, fallback = '') {
      if (!this.$i18n) {
        // console.warn(`[AdminDashboard] $i18n not available. Using fallback for: ${key}`);
        return fallback;
      }
      try {
        // Force the correct locale
        const translation = this.$i18n.t(key, { locale: this.currentLocale });
        // Return fallback if the key is returned (meaning no translation found)
        if (translation === key) {
          // console.warn(`[AdminDashboard] No translation for key: ${key}. Using fallback.`);
          return fallback || key;
        }
        return translation;
      } catch (e) {
        console.error(`[AdminDashboard] Translation error for key ${key}:`, e);
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
      } catch {
        // Error accessing localStorage - using default language
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
        } catch {
          // Error saving language preference to localStorage
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

      // Delegate DOM manipulation to ThemeManager
      themeManager.setTheme(theme);
    },

    // Handle theme change event from other components
    handleThemeChange(event) {
      if (event.detail && event.detail.theme) {
        this.applyTheme(event.detail.theme);
      }
    },

    // Get current effective theme
    getCurrentTheme() {
      return this.currentTheme;
    },

    // Set active tab
    setActiveTab(tabId) {
      // Step 1: Guard against unsaved changes before doing anything else
      if (this.activeTab === 'hierarchy' && this.isFormDirty) {
        // MODIFIED: Use ConfirmDialog
        this.showConfirmDialog({
          title: this.translate('admin.hierarchy.confirmCancelTitle', 'Unsaved Changes'),
          message: this.translate(
            'admin.hierarchy.confirmCancelEdit',
            'You have unsaved changes that will be lost. Are you sure you want to switch tabs?'
          ),
          confirmText: this.translate('admin.buttons.switch', 'Switch Anyway'),
          cancelText: this.translate('common.cancel', 'Cancel'),
          onConfirm: () => {
            // User confirmed, proceed with tab switch
            this.activeTab = tabId;
            this.originalHierarchyFormState = null; // Reset form state
            this.loadDataForTab(tabId); // Load data for the new tab
          },
          onCancel: () => {
            // User canceled, do nothing
          }
        });
        return; // Stop the original flow
      }

      // Step 2: Proceed with the tab switch
      this.activeTab = tabId;
      this.originalHierarchyFormState = null; // Reset form state when leaving the hierarchy tab

      // Step 3: Load the necessary data for the newly selected tab
      this.loadDataForTab(tabId);
    },

    // --- ADDED: Helper to load data based on tab ID ---
    loadDataForTab(tabId) {
      if (tabId === 'database') {
        this.loadDatabaseStats();
      } else if (tabId === 'logs') {
        this.loadLogsSummary();
        this.loadLogs();
      } else if (tabId === 'security') {
        this.loadSecurityMetrics();
      } else if (tabId === 'users') {
        this.loadUserStats();
      } else if (tabId === 'documents') {
        this.loadDocuments();
      } else if (tabId === 'hierarchy' && this.knowledgeHierarchy.length === 0) {
        this.loadKnowledgeHierarchy();
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
        // Get the data object directly from the service
        const data = await adminDashboardService.getSystemHealth();

        // Check if the data and its 'metrics' property exist
        if (data && data.metrics) {
          // Update metrics
          this.metrics = {
            systemUptime: data.metrics.systemUptime,
            avgResponseTime: data.metrics.avgResponseTime,
            errorRate: data.metrics.errorRate,
            monthlyActiveUsers: data.metrics.monthlyActiveUsers
          };

          // Update health services
          this.healthServices = data.healthServices;

          // Update resource usage
          this.resourceUsage = Object.keys(data.resourceUsage).map((id) => ({
            id,
            label: this.getResourceLabel(id),
            value: data.resourceUsage[id]
          }));
        } else {
          this.showNotification('Failed to parse system health data', 'error');
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
          limit: 20 // Get more logs than we'll display in the summary
        });

        if (response && response.data && response.data.data) {
          this.logs = response.data.data.logs || [];
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
          date: new Date().toISOString().split('T')[0]
        });

        if (response && response.data && Array.isArray(response.data.errors) && Array.isArray(response.data.warnings)) {
          this.errorLogsSummary = response.data.errors || [];
          this.warningLogsSummary = response.data.warnings || [];
          if (this.errorLogsSummary.length === 0 && this.warningLogsSummary.length === 0) {
            this.showNotification(this.translate('admin.noLogsFound', 'No logs found for today'), 'info');
          }
        } else {
          console.error('[AdminDashboard] Invalid logs summary response structure:', response);
          this.showNotification(
            this.translate('admin.invalidLogsResponse', 'Invalid logs summary response structure'),
            'error'
          );
          this.errorLogsSummary = [];
          this.warningLogsSummary = [];
        }
      } catch (error) {
        console.error('[AdminDashboard] Error loading logs summary:', error.message, error.stack);
        this.showNotification(this.translate('admin.logsSummaryError', 'Failed to load logs summary'), 'error');
        this.errorLogsSummary = [];
        this.warningLogsSummary = [];
      } finally {
        this.isLoading = false;
      }
    },

    // Security operations (This is a corrected/combined version)
    async runSecurityScan() {
      if (this.isLoading && this.currentOperation === 'runSecurityScan') return; // Prevent double-click

      this.isLoading = true;
      this.currentOperation = 'runSecurityScan';

      try {
        const response = await adminDashboardService.runSecurityScan();

        if (response.success) {
          await this.loadSecurityDetails(); // This fetches all necessary details
          this.securityMetrics.lastScan = this.translate('admin.security.lastScanJustNow', 'Just now'); // Update last scan time
          // Update vulnerability counts from the detailed response
          if (this.securityDetails && this.securityDetails.vulnerabilityDetails) {
            this.securityMetrics.vulnerabilities = {
              critical: this.securityDetails.vulnerabilityDetails.critical.length,
              medium: this.securityDetails.vulnerabilityDetails.medium.length,
              low: this.securityDetails.vulnerabilityDetails.low.length
            };
          }
          this.$forceUpdate();
          this.showNotification(
            this.translate('admin.operations.runSecurityScan.success', 'Security scan completed successfully'),
            'success'
          );
        } else {
          throw new Error(response.message || 'Security scan failed');
        }
      } catch (error) {
        console.error('[AdminDashboard] Error running security scan:', error);
        this.showNotification(
          this.translate('admin.operations.runSecurityScan.error', 'Failed to run security scan'),
          'error'
        );
      } finally {
        this.isLoading = false;
        this.currentOperation = null;
      }
    },

    // Search logs method - launches the search dialog
    searchLogs() {
      // Make sure the current theme is properly set
      this.currentTheme = document.documentElement.getAttribute('data-theme') || 'light';

      // Show the log search dialog
      this.showLogSearchDialog = true;

      // Load error and warning log summaries if they haven't been loaded yet
      if (this.activeTab === 'logs' && !this.errorLogsSummary.length && !this.warningLogsSummary.length) {
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
          this.translate('admin.logsSection.logSearch.noResultsFound', 'No logs matched your search criteria'),
          'info'
        );
      } else {
        this.showNotification(
          this.translate('admin.logsSection.logSearch.resultsFound', `Found {count} log entries`).replace(
            '{count}',
            results.length
          ), // Added placeholder replacement
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
          await Promise.all([this.loadLogsSummary(), this.loadLogs()]);
        }
        return response.data;
      });
    },

    // Load security metrics
    async loadSecurityMetrics() {
      try {
        this.isLoading = true;
        const response = await adminDashboardService.getSecurityMetrics();
        if (response && response.data) {
          this.securityMetrics = {
            failedLoginAttempts: response.data.failedLoginAttempts || 0,
            suspiciousActivities: response.data.suspiciousActivities || 0,
            lastSecurityScan: response.data.lastSecurityScan || 'Never',
            vulnerabilities: response.data.vulnerabilities || {
              critical: 0,
              medium: 0,
              low: 0
            }
          };
          // Also load the details when metrics are loaded
          await this.loadSecurityDetails();
        }
      } catch (error) {
        console.error('[AdminDashboard] Error loading security metrics:', error);
        this.securityMetrics = {
          failedLoginAttempts: 0,
          suspiciousActivities: 0,
          lastSecurityScan: 'Never',
          vulnerabilities: {
            critical: 0,
            medium: 0,
            low: 0
          }
        };
      } finally {
        this.isLoading = false;
      }
    },

    // Load user stats
    async loadUserStats() {
      // This now acts as a trigger for the initial, full, paginated user list.
      await this.searchUsers();
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
      this.loadSystemHealth();
      this.loadDataForTab(this.activeTab); // Call the helper
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
          // Case 1: Standard success (e.g., { success: true, ... })
          this.showNotification(
            this.translate(`admin.operations.${operation}.success`, `Operation ${operation} completed successfully`),
            'success'
          );
        } else if (result === undefined || result === null) {
          // Case 2: Success with an empty body (e.g., 200 OK from diagnostics)
          this.showNotification(
            this.translate(`admin.operations.${operation}.success`, `Operation ${operation} completed successfully`),
            'success'
          );
        } else {
          // Case 3: A failure response (e.g., { success: false, message: '...' })
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

    // Close the operation results modal
    closeOperationResults() {
      this.showOperationResults = false;
    },

    // Get current user information from Vuex auth store (Keycloak OIDC)
    getCurrentUser() {
      const user = this.$store.getters.currentUser;
      this.currentUser = user || {};
    },

    /**
     * Build the admin console URL for managing a specific user.
     * Keycloak 26+ admin console URL format (hash-based SPA):
     *   {base}/admin/{realm}/console/#/{realm}/users/{userId}/settings
     * Falls back to the generic user list if the Keycloak user ID (sub) is unavailable.
     */
    getUserManageUrl(user) {
      if (user.sub) {
        return `${this.keycloakAdminUrl}/${user.sub}/settings`;
      }
      return this.keycloakAdminUrl;
    },

    /**
     * Search users from the server
     */
    async searchUsers() {
      this.isSearchingUsers = true;
      try {
        // On initial load (no search term, first page), fetch the detailed stats.
        if (this.userSearchOffset === 0 && !this.userSearchTerm) {
          // This call specifically gets the active/new/total user counts
          const statsResponse = await adminDashboardService.getUserStats();
          if (statsResponse) {
            this.userStats.totalUsers = statsResponse.totalUsers;
            this.userStats.activeUsers = statsResponse.activeUsers;
            this.userStats.newUsers = statsResponse.newUsers;
          }
        }

        // This call gets the paginated list of users for the table
        const searchResponse = await adminDashboardService.searchUsers({
          term: this.userSearchTerm,
          field: this.userSearchField,
          limit: this.userSearchLimit,
          offset: this.userSearchOffset
        });

        if (searchResponse && searchResponse.data) {
          this.userSearchResults = [...(searchResponse.data.users || [])];
          this.userSearchTotal = searchResponse.data.total || 0;
        } else {
          this.userSearchResults = [];
          this.userSearchTotal = 0;
        }
      } catch (error) {
        console.error('Error searching users:', error);
        this.showNotification(this.translate('admin.userSearch.error', 'Error searching users'), 'error');
        this.userSearchResults = [];
        this.userSearchTotal = 0;
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
      this.searchUsers(); // Re-run the search to show all users
    },

    /**
     * Handle user search pagination
     * @param {number} offset - New offset for pagination
     */
    handleUserSearchPagination(offset) {
      this.userSearchOffset = offset;
      this.searchUsers();
    },

    // Load security metrics from the service

    /**
     * Parses a log message string to extract the log level.
     * @param {string} logString - The raw log message.
     * @returns {{type: string, message: string}}
     */
    parseLogMessage(logString) {
      if (typeof logString !== 'string') {
        return { type: 'UNKNOWN', message: String(logString) };
      }
      const match = logString.match(/^\[([A-Z]+)\]:?\s*/);
      if (match) {
        return {
          type: match[1], // e.g., "INFO", "ERROR"
          message: logString.substring(match[0].length)
        };
      }
      return { type: 'INFO', message: logString }; // Default if no prefix
    },

    // Load detailed security information
    async loadSecurityDetails() {
      try {
        this.isLoading = true;
        const response = await adminDashboardService.getSecurityDetails();

        // Define a helper to map vulnerability details
        const mapVulnerability = (v) => ({
          type: v.type,
          severity: v.severity,
          description: v.description,
          recommendation: v.recommendation,
          matchedTerm: v.matchedTerm,
          timestamp: v.timestamp,
          service: v.service,
          lineNumber: v.lineNumber,
          url: v.url,
          occurrences: v.instanceCount,
          firstSeen: v.firstSeen,
          lastSeen: v.lastSeen,
          lineNumbers: v.lineNumbers
        });

        // REVISED: Define a helper to map and parse log details
        const mapAndParseLogDetail = (log) => {
          const parsed = this.parseLogMessage(log.message || '');
          return {
            timestamp: log.timestamp,
            type: parsed.type,
            message: parsed.message
          };
        };

        this.securityDetails = {
          lastScan: response.lastScan || 'Never',
          vulnerabilities: response.vulnerabilities || {
            critical: 0,
            medium: 0,
            low: 0,
            details: []
          },
          vulnerabilityDetails: {
            critical: Array.isArray(response.vulnerabilityDetails?.critical)
              ? response.vulnerabilityDetails.critical.map(mapVulnerability)
              : [],
            medium: Array.isArray(response.vulnerabilityDetails?.medium)
              ? response.vulnerabilityDetails.medium.map(mapVulnerability)
              : [],
            low: Array.isArray(response.vulnerabilityDetails?.low)
              ? response.vulnerabilityDetails.low.map(mapVulnerability)
              : []
          },
          failedLoginDetails: Array.isArray(response.failedLoginDetails)
            ? response.failedLoginDetails.map(mapAndParseLogDetail)
            : [],
          suspiciousDetails: Array.isArray(response.suspiciousDetails)
            ? response.suspiciousDetails.map(mapAndParseLogDetail)
            : []
        };
      } catch (error) {
        console.error('[AdminDashboard] Error loading security details:', error);
        this.securityDetails = {
          lastScan: 'Never',
          vulnerabilities: { critical: 0, medium: 0, low: 0, details: [] },
          vulnerabilityDetails: { critical: [], medium: [], low: [] },
          failedLoginDetails: [],
          suspiciousDetails: []
        };
      } finally {
        this.isLoading = false;
      }
    },

    async loadKnowledgeHierarchy() {
      this.isHierarchyLoading = true;
      try {
        // Using the serviceTreeService to fetch data
        const categories = await serviceTreeService.getAdminCategories('en');
        // The API returns a simple structure; adapt it for the UI.
        // A dedicated admin endpoint should return the full object with translations.
        this.knowledgeHierarchy = categories.map((cat) => ({
          _key: cat.catKey, // Use _key from service
          nameEN: cat.name,
          translations: [], // TODO: Your API should eventually return this data
          services: (cat.children || []).map((service) => ({
            // service is now the object {_key, name}
            _key: service._key, // Use the REAL key from the database
            nameEN: service.name, // Use the name property from the service object
            translations: []
          }))
        }));
      } catch (error) {
        this.showNotification(
          this.translate('admin.hierarchy.loadError', 'Failed to load knowledge hierarchy.'),
          'error'
        );
        console.error(error);
      } finally {
        this.isHierarchyLoading = false;
      }
    },

    showAddCategoryForm() {
      // MODIFIED: Use translate method for title
      this.hierarchyForm = {
        visible: true,
        mode: 'createCategory',
        title: this.translate('admin.hierarchy.formTitleCreateCategory', 'Create New Category'),
        _key: null,
        nameEN: '',
        translations: [{ lang: '', text: '' }],
        parentId: null
      };
      // Store the initial state for the unsaved changes check
      this.originalHierarchyFormState = JSON.stringify(this.hierarchyForm);
    },

    showAddServiceForm(category) {
      // MODIFIED: Use translate method for title
      this.hierarchyForm = {
        visible: true,
        mode: 'createService',
        title: this.translate('admin.hierarchy.formTitleAddService', 'Add Service to "{categoryName}"').replace(
          '{categoryName}',
          category.nameEN
        ),
        _key: null,
        nameEN: '',
        translations: [{ lang: '', text: '' }],
        parentId: category._key
      };
      // Store the initial state for the unsaved changes check
      this.originalHierarchyFormState = JSON.stringify(this.hierarchyForm);
    },

    async showEditForm(item, parentCategory = null) {
      const isCategory = !parentCategory;

      // MODIFIED: Use translate method for title
      const titleKey = isCategory ? 'admin.hierarchy.formTitleEditCategory' : 'admin.hierarchy.formTitleEditService';
      const fallbackTitle = `Edit ${isCategory ? 'Category' : 'Service'}: "${item.nameEN}"`;

      // Step 1: Immediately show the form with basic info
      this.hierarchyForm = {
        visible: true,
        mode: isCategory ? 'editCategory' : 'editService',
        title: this.translate(titleKey, fallbackTitle).replace('{itemName}', item.nameEN),
        _key: item._key,
        nameEN: item.nameEN,
        translations: [], // Start with an empty array
        parentId: isCategory ? null : parentCategory._key
      };

      // Step 2: Fetch the translations asynchronously
      this.isTranslationsLoading = true;
      try {
        let fetchedTranslations = [];
        if (isCategory) {
          // Call the service method for categories
          fetchedTranslations = await serviceTreeService.getCategoryTranslations(item._key);
        } else {
          // Call the service method for services
          fetchedTranslations = await serviceTreeService.getServiceTranslations(item._key);
        }

        // Filter out the English ('en') translation from the results
        const filteredTranslations = fetchedTranslations.filter((t) => t.lang !== 'en');

        // Step 3: Populate the form with the filtered data
        if (filteredTranslations.length > 0) {
          this.hierarchyForm.translations = filteredTranslations;
        } else {
          // If no non-English translations exist, provide one empty row for the user to start
          this.hierarchyForm.translations.push({ lang: '', text: '' });
        }

        // Step 4: Store the initial state for the unsaved changes check
        this.originalHierarchyFormState = JSON.stringify(this.hierarchyForm);
      } catch {
        this.showNotification(
          this.translate('admin.hierarchy.loadTranslationsError', 'Failed to load translations.'),
          'error'
        );
        // Ensure there's at least one empty row on error
        if (this.hierarchyForm.translations.length === 0) {
          this.hierarchyForm.translations.push({ lang: '', text: '' });
        }
      } finally {
        this.isTranslationsLoading = false;
      }
    },

    addTranslationRow() {
      this.hierarchyForm.translations.push({ lang: '', text: '' });
    },

    removeTranslationRow(index) {
      this.hierarchyForm.translations.splice(index, 1);
    },

    closeHierarchyForm() {
      this.hierarchyForm.visible = false;
      this.originalHierarchyFormState = null;
    },

    // Modify cancelHierarchyForm
    cancelHierarchyForm() {
      if (this.isFormDirty) {
        // MODIFIED: Use ConfirmDialog
        this.showConfirmDialog({
          title: this.translate('admin.hierarchy.confirmCancelTitle', 'Unsaved Changes'),
          message: this.translate(
            'admin.hierarchy.confirmCancelEdit',
            'You have unsaved changes. Are you sure you want to cancel?'
          ),
          confirmText: this.translate('admin.buttons.discard', 'Discard'),
          cancelText: this.translate('common.cancel', 'Cancel'),
          onConfirm: () => {
            this.closeHierarchyForm(); // User confirmed
          },
          onCancel: () => {
            // User canceled, do nothing
          }
        });
      } else {
        this.closeHierarchyForm();
      }
    },

    async saveHierarchyItem() {
      // --- 1. VALIDATION ---
      const validTranslations = this.hierarchyForm.translations.filter((t) => t.lang && t.text.trim());
      const langCodes = validTranslations.map((t) => t.lang);

      // Check for duplicate languages
      if (new Set(langCodes).size !== langCodes.length) {
        this.showNotification(
          // MODIFIED: Use new i18n key
          this.translate(
            'admin.hierarchy.duplicateLangError',
            'Duplicate languages found in translations. Please remove them.'
          ),
          'error'
        );
        return;
      }

      // --- 2. PREPARE PAYLOAD ---
      const payload = {
        nameEN: this.hierarchyForm.nameEN,
        translations: validTranslations
      };

      this.isLoading = true;
      try {
        const { mode, _key, parentId } = this.hierarchyForm;

        // --- 3. CALL CORRECT SERVICE METHOD (SAVE) ---
        if (mode === 'createCategory') {
          await serviceTreeService.createCategory(payload);
        } else if (mode === 'editCategory') {
          await serviceTreeService.updateCategory(_key, payload);
        } else if (mode === 'createService') {
          await serviceTreeService.createService(parentId, payload);
        } else if (mode === 'editService') {
          await serviceTreeService.updateService(_key, payload);
        }

        this.showNotification(
          // MODIFIED: Use new i18n key
          this.translate('admin.hierarchy.saveSuccess', 'Hierarchy item saved successfully.'),
          'success'
        );
        this.closeHierarchyForm(); // Close form on success

        // --- 4. REFRESH DATA ---
        await this.loadKnowledgeHierarchy(); // Refresh the admin dashboard tree
        eventBus.$emit('knowledge-hierarchy-updated'); // Emit global event for other components
      } catch (error) {
        this.showNotification(
          // MODIFIED: Use new i18n key
          this.translate('admin.hierarchy.saveError', 'Failed to save hierarchy item.'),
          'error'
        );
        console.error(error);
      } finally {
        this.isLoading = false;
      }
    },

    async deleteHierarchyItem(item, parentCategory = null) {
      const isCategory = !parentCategory;
      const type = isCategory ? 'Category' : 'Service';

      // MODIFIED: Use new i18n keys for ConfirmDialog
      const titleKey = isCategory
        ? 'admin.hierarchy.confirmDeleteTitleCategory'
        : 'admin.hierarchy.confirmDeleteTitleService';
      const messageKey = isCategory ? 'admin.hierarchy.confirmDeleteCategory' : 'admin.hierarchy.confirmDeleteService';
      const defaultTitle = `Delete ${type}?`;
      const defaultMessage = `Are you sure you want to delete the ${type} "${item.nameEN}"? This action cannot be undone.`;

      this.showConfirmDialog({
        title: this.translate(titleKey, defaultTitle),
        message: this.translate(messageKey, defaultMessage).replace('{itemName}', item.nameEN),
        confirmText: this.translate('common.delete', 'Delete'),
        cancelText: this.translate('common.cancel', 'Cancel'),
        onConfirm: async () => {
          // User confirmed, proceed with deletion
          this.isLoading = true;
          try {
            // Conditionally call the correct delete method from the service
            if (isCategory) {
              await serviceTreeService.deleteCategory(item._key);
            } else {
              await serviceTreeService.deleteService(item._key);
            }

            // MODIFIED: Use new i18n keys for notification
            const successKey = isCategory
              ? 'admin.hierarchy.deleteSuccessCategory'
              : 'admin.hierarchy.deleteSuccessService';
            this.showNotification(this.translate(successKey, `${type} deleted successfully.`), 'success');

            // Refresh the data in the admin panel and the main application
            await this.loadKnowledgeHierarchy();
            eventBus.$emit('knowledge-hierarchy-updated');
          } catch (error) {
            // MODIFIED: Use new i18n keys for notification
            const errorKey = isCategory ? 'admin.hierarchy.deleteErrorCategory' : 'admin.hierarchy.deleteErrorService';
            this.showNotification(this.translate(errorKey, `Failed to delete ${type}.`), 'error');
            console.error(error);
          } finally {
            this.isLoading = false;
          }
        },
        onCancel: () => {
          // User canceled, do nothing
        }
      });
    },

    // --- START: NEW METHODS FOR DOCUMENTS ---
    // uploadFiles() is now just the action to show the dialog (see below)

    // addFromLink() is now just the action to show the dialog (see below)

    viewDocumentDetails(docId) {
      this.selectedFileId = docId;
      this.showDetailsDialog = true;
    },

    // UPDATED: Determine status class based on crawl status first
    getStatusVariant(doc) {
      let job = doc.crawl_job || doc.crawlJob;
      if (Array.isArray(job)) job = job.length > 0 ? job[0] : null;

      const crawlStatus = job?.status ? String(job.status).toLowerCase().trim() : null;
      const dataPrepStatus = doc.dataprep?.status ? String(doc.dataprep.status).toLowerCase().trim() : '';

      if (crawlStatus === 'crawling') return 'info';
      if (crawlStatus === 'failed' || crawlStatus === 'killed') return 'error';

      if (dataPrepStatus === 'ingested') return 'success';
      if (dataPrepStatus === 'ingesting') return 'info';
      if (dataPrepStatus === 'ingested with warnings') return 'warning';
      if (dataPrepStatus === 'ingestion error') return 'error';
      if (dataPrepStatus === 'pending') return 'pending';
      if (dataPrepStatus === 'retracted') return 'info';

      return 'info';
    },

    getDisplayStatus(doc) {
      // 1. Normalize Access
      let job = doc.crawl_job || doc.crawlJob;
      if (Array.isArray(job)) job = job.length > 0 ? job[0] : null;

      // 2. Priority Logic
      if (job && job.status) {
        const s = String(job.status).toLowerCase().trim();
        if (s === 'crawling') return 'Crawling';
        if (s === 'failed') return 'Crawl Failed';
        if (s === 'killed') return 'Crawl Killed';
        // If 'pending', we distinguish it from the file's ingestion pending status
        if (s === 'pending') return 'Crawl Scheduled';
      }

      // 3. Fallback to dataprep status or 'Unknown'
      return doc.dataprep ? doc.dataprep.status : 'Unknown';
    },

    selectAllDocuments(event) {
      if (event.target.checked) {
        // MODIFICATION: Select based on _key, not file_id
        this.selectedDocuments = this.sortedAndFilteredDocuments.map((d) => d._key);
      } else {
        this.selectedDocuments = [];
      }
    },
    /**
     * Handles batch actions like 'ingest' for multiple selected documents.
     */
    async handleBatchAction(action) {
      if (action === 'ingest') {
        // MODIFIED: Use ConfirmDialog
        const count = this.selectedDocuments.length;
        this.showConfirmDialog({
          title: this.translate('admin.documents.confirmIngestTitle', 'Confirm Batch Ingestion'),
          message: this.translate(
            'admin.documents.confirmIngestSelected',
            `Are you sure you want to ingest ${count} selected file(s)?`
          ).replace('{count}', count),
          confirmText: this.translate('admin.documents.ingest', 'Ingest'),
          cancelText: this.translate('common.cancel', 'Cancel'),
          onConfirm: async () => {
            // User confirmed, proceed with batch ingest
            this.isLoading = true; // Use the main dashboard loading overlay
            try {
              // Call the service with the array of selected document keys
              await documentFileService.ingestMultipleFiles(this.selectedDocuments);

              this.showNotification(
                // MODIFIED: Use new i18n key
                this.translate(
                  'admin.documents.ingestQueuedSuccess',
                  `{count} file(s) have been queued for ingestion.`
                ).replace('{count}', count),
                'success'
              );

              // Clear the selection after the action is successful
              this.selectedDocuments = [];

              // Refresh the document list to show the updated statuses
              await this.loadDocuments();
            } catch (error) {
              this.showNotification(
                // MODIFIED: Use new i18n key
                this.translate(
                  'admin.documents.ingestQueuedError',
                  'An error occurred during the batch ingestion process.'
                ),
                'error'
              );
              console.error('Batch ingest error:', error);
            } finally {
              this.isLoading = false;
            }
          },
          onCancel: () => {
            // User canceled, do nothing
          }
        });
      }
      // You can add 'else if' blocks for other actions like 'retract' or 'delete' here
    },
    // --- END: DOCUMENT METHODS ---

    // This method is triggered by the "+ Upload Files" button
    uploadFiles() {
      this.showUploadDialog = true;
    },

    // This method is triggered by the "+ Add from Link" button
    addFromLink() {
      this.showLinkDialog = true;
    },

    // This method is triggered by clicking a row in the documents table
    // This is a new method to refresh the document list after an action
    refreshDocuments() {
      // In a real application, this would re-fetch the document list from your API
      // this.showNotification("Document list refreshed.", "info"); // Notification is now more specific
      this.loadDocuments();
    },

    // Handler for the @files-uploaded event from the UploadFilesDialog
    handleFilesUploaded(uploadedFiles) {
      // MODIFIED: Use new i18n key
      this.showNotification(
        this.translate('admin.documents.uploadSuccessMultiple', `{count} file(s) uploaded successfully.`).replace(
          '{count}',
          uploadedFiles.length
        ),
        'success'
      );
      this.refreshDocuments();
    },

    // Handler for the @link-submitted event from the AddFromLinkDialog
    handleLinkSubmitted(newFile) {
      // MODIFIED: Use new i18n key
      this.showNotification(
        this.translate('admin.documents.linkSubmitSuccess', `Successfully crawled and saved "{fileName}".`).replace(
          '{fileName}',
          newFile.file_name
        ),
        'success'
      );
      this.refreshDocuments();
    },

    // Handler for events from the FileDetailsDialog
    handleFileAction(payload) {
      // MODIFIED: Use new i18n key
      this.showNotification(
        this.translate('admin.documents.actionSuccess', `Action "{action}" on file {fileId} was successful.`)
          .replace('{action}', payload.action)
          .replace('{fileId}', payload.fileId),
        'success'
      );
      this.refreshDocuments();
    },

    handleFileUpdated(payload) {
      // MODIFIED: Use new i18n key
      this.showNotification(
        this.translate('admin.documents.metadataUpdateSuccess', `Metadata for file {fileId} was updated.`).replace(
          '{fileId}',
          payload.fileId
        ),
        'success'
      );
      this.refreshDocuments();
    },

    async loadDocuments() {
      this.isDocumentsLoading = true;
      try {
        // 1. Prepare Params
        // Note: 'sort' and 'order' removed because the backend returned 400 Bad Request.
        // The list will load in the backend's default order (currently Ascending/Oldest First).
        const params = {
          page: this.documentPagination.page,
          limit: this.documentPagination.limit
        };

        if (this.documentSearchTerm && this.documentSearchTerm.trim() !== '') {
          params.search = this.documentSearchTerm.trim();
        }

        // 2. Call API
        const response = await documentFileService.getFiles(params);

        // 3. Normalize Data
        // Map DB 'uploaded_date' to UI 'upload_date' so the client-side table renders dates correctly
        const rawDocs = response.data || [];
        this.documents = rawDocs.map((doc) => {
          if (!doc.upload_date && doc.uploaded_date) {
            doc.upload_date = doc.uploaded_date;
          }
          return doc;
        });

        // 4. Pagination
        if (response.pagination) {
          this.documentPagination.total = response.pagination.totalFiles || 0;
          this.documentPagination.page = response.pagination.currentPage || 1;
        }
      } catch (error) {
        console.error('Error loading documents:', error);
        this.showNotification(this.translate('admin.documents.loadError', 'Failed to load documents.'), 'error');
        this.documents = [];
      } finally {
        this.isDocumentsLoading = false;
      }
    }
  }
};
</script>

<style scoped>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  font-family: var(--font-body);
}

/* Modal backdrop */
.admin-page {
  height: 100%;
  overflow: hidden;
  background: var(--bg);
  display: flex;
}

/* Admin dashboard container */
.admin-dashboard {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: var(--surface);
}

/* Close button */
.close-dashboard-btn {
  position: absolute;
  top: 8px; /* Move it higher into the top bar */
  right: 16px; /* Position closer to the right edge */
  z-index: 1100;
  /* Other styles handled by DsButton */
}

/* Main layout grid */
.dashboard {
  display: grid;
  grid-template-columns: 220px 1fr;
  height: calc(100vh - 60px);
  overflow: hidden;
}

/* Sidebar */
.sidebar {
  background: var(--bg-sidebar);
  color: var(--fg);
  padding: var(--space-lg) var(--space-md);
  height: 100%;
  overflow-y: auto;
}

.nav-section {
  margin-bottom: var(--space-lg);
}

.nav-header {
  text-transform: uppercase;
  font-size: var(--text-sm);
  letter-spacing: 0.05em;
  color: var(--muted-soft);
  margin-bottom: var(--space-sm);
}

.nav-items {
  list-style: none;
}

.nav-item {
  margin-bottom: var(--space-xs);
}

.nav-link {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-sm) var(--space-md);
  text-decoration: none;
  color: var(--fg);
  opacity: 0.7;
  border-radius: var(--radius-md);
  transition: all 0.15s;
  cursor: pointer;
}

.nav-link:hover {
  color: var(--fg);
  opacity: 1;
  background-color: var(--bg);
}

.nav-link.active {
  color: var(--accent);
  opacity: 1;
  background-color: var(--accent-muted);
  font-weight: 600;
}

/* Main Content */
.main {
  padding: var(--space-lg);
  background-color: var(--surface);
  height: 100%;
  overflow-y: auto;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-lg);
}

.page-title {
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--fg);
}

/* Rest of the existing styles... */
.user-menu {
  display: flex;
  align-items: center;
  gap: var(--space-md);
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
  color: var(--accent-fg);
  height: 18px;
  width: 18px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-sm);
}

.user-avatar {
  height: 2.5rem;
  width: 2.5rem;
  border-radius: 50%;
  background-color: var(--accent);
  color: var(--accent-fg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
}

/* Quick Stats */
.quick-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-md);
  margin-bottom: var(--space-md);
}

.stat-card {
  background-color: var(--surface);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border);
}

.stat-title {
  color: var(--muted);
  font-size: var(--text-base);
  margin-bottom: var(--space-xs);
}

.stat-value {
  font-size: var(--text-xl);
  font-weight: 600;
  margin-bottom: var(--space-xs);
  color: var(--fg);
}

.stat-trend {
  display: flex;
  align-items: center;
  font-size: var(--text-sm);
  color: var(--muted);
}

.trend-up {
  color: var(--success);
}

.trend-down {
  color: var(--danger);
}

/* Tabs card wrapper */
.tabs-card {
  background-color: var(--surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  margin-bottom: var(--space-md);
  border: 1px solid var(--border);
  overflow: hidden;
}

.tabs-card :deep(.ds-tabs__content) {
  padding: var(--space-lg);
}

/* Dashboard Grid */
.dashboard-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-md);
}

.dashboard-card {
  background-color: var(--surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  padding: var(--space-md);
  margin-bottom: var(--space-md);
  border: 1px solid var(--border);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-md);
}

.card-title {
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--fg);
}

.card-actions {
  display: flex;
  gap: var(--space-sm);
}

/* Health Status */
.health-status {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-md);
}

.health-item {
  padding: var(--space-sm);
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-size: var(--text-base);
}

.status-good {
  background-color: var(--success-bg);
  color: var(--success);
}

.status-warning {
  background-color: var(--warning-bg);
  color: var(--warning);
}

.status-error {
  background-color: var(--danger-bg);
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

/* Database Section */
.db-actions {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-md);
  margin-bottom: var(--space-md);
}

.db-action-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  cursor: pointer;
  transition: all 0.2s;
  background-color: var(--surface);
  font-size: var(--text-base);
}

.db-action-card:hover {
  border-color: var(--accent);
}

.action-icon {
  margin-bottom: var(--space-sm);
  font-size: var(--text-lg);
  color: var(--accent);
}

.action-title {
  font-weight: 600;
  margin-bottom: var(--space-xs);
  color: var(--fg);
}

.action-desc {
  font-size: var(--text-sm);
  color: var(--muted);
}

.db-stats {
  color: var(--fg);
  font-size: var(--text-base);
}

/* Log Table */
.log-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-base);
}

.log-table th,
.log-table td {
  padding: var(--space-sm) var(--space-md);
  text-align: left;
  border-bottom: 1px solid var(--border);
}

.log-table th {
  font-weight: 600;
  color: var(--muted);
}

.log-level {
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  text-transform: uppercase;
  font-weight: 600;
}

.log-error {
  background-color: var(--danger-bg);
  color: var(--danger);
}

.log-warning {
  background-color: var(--warning-bg);
  color: var(--warning);
}

.log-info {
  background-color: var(--info-bg);
  color: var(--accent);
}

.table-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: var(--space-sm);
  color: var(--muted);
  font-size: var(--text-sm);
}

.pagination {
  display: flex;
  gap: var(--space-xs);
}

.page-btn {
  height: 1.8rem;
  width: 1.8rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: none;
  cursor: pointer;
  color: var(--muted);
  font-size: var(--text-base);
}

.page-btn.active {
  background-color: var(--accent);
  color: var(--accent-fg);
  border-color: var(--accent);
}

/* Resource Usage */
.resource-usage {
  padding: var(--space-sm) 0;
}

.usage-item {
  margin-bottom: var(--space-md);
}

.usage-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: var(--space-xs);
  font-size: var(--text-base);
}

.usage-label {
  font-weight: 600;
  color: var(--muted);
}

.usage-value {
  color: var(--fg);
}

.usage-bar {
  height: 0.5rem;
  border-radius: var(--radius-sm);
  background-color: var(--border);
  overflow: hidden;
}

.usage-fill {
  height: 100%;
  border-radius: var(--radius-sm);
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
  gap: var(--space-md);
}

.feature-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-md);
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background-color: var(--surface);
  font-size: var(--text-base);
}

.feature-info {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.feature-name {
  font-weight: 600;
  color: var(--fg);
}

.feature-description {
  font-size: var(--text-sm);
  color: var(--muted);
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
  transition: 0.4s;
  border-radius: var(--radius-xl);
}

.slider:before {
  position: absolute;
  content: '';
  height: 0.85rem;
  width: 0.85rem;
  left: 0.2rem;
  bottom: 0.2rem;
  background-color: var(--switch-thumb);
  transition: 0.4s;
  border-radius: 50%;
}

input:checked + .slider {
  background-color: var(--switch-track-on);
}

input:checked + .slider:before {
  transform: translateX(1.25rem);
}

/* Modal */
.modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--overlay-bg);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1200;
}

.modal-content {
  width: 450px;
  max-width: 90vw;
  background-color: var(--surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.modal-title {
  padding: var(--space-md);
  margin: 0;
  font-size: 1.15rem;
  font-weight: 600;
  border-bottom: 1px solid var(--border);
  color: var(--fg);
}

.modal-body {
  padding: var(--space-lg);
  color: var(--fg);
  font-size: var(--text-base);
}

.modal-footer {
  padding: var(--space-md);
  display: flex;
  justify-content: flex-end;
  gap: var(--space-md);
  border-top: 1px solid var(--border);
}

.btn-close,
.btn-save {
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-weight: 500;
  border: none;
  transition: all 0.2s;
  font-size: var(--text-base);
}

.btn-save {
  background-color: var(--accent);
  color: var(--accent-fg);
}

.btn-close {
  background-color: var(--btn-secondary-bg);
  color: var(--btn-secondary-fg);
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

  .health-status,
  .db-actions {
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

  .health-status,
  .db-actions {
    grid-template-columns: 1fr;
  }

  .header {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-md);
  }

  .page-title {
    font-size: var(--text-lg);
  }

  .user-menu {
    width: 100%;
    justify-content: flex-end;
  }

  .tabs-card :deep(.ds-tabs__nav) {
    flex-wrap: wrap;
  }

  .tabs-card :deep(.ds-tabs__btn) {
    padding: var(--space-sm) var(--space-md);
    font-size: var(--text-base);
  }

  .card-header {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-sm);
  }

  .card-actions {
    align-self: flex-start;
  }
}

/* Log Summary Styles */
.logs-summary {
  margin-bottom: var(--space-lg);
}

.summary-title {
  display: flex;
  align-items: center;
  font-size: var(--text-md);
  font-weight: 600;
  margin-bottom: var(--space-md);
  color: var(--fg);
}

.status-indicator {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  margin-right: var(--space-sm);
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
  font-size: var(--text-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.log-summary-table th,
.log-summary-table td {
  padding: var(--space-sm) var(--space-md);
  text-align: left;
  border-bottom: 1px solid var(--border);
}

.log-summary-table th {
  background-color: var(--bg-tertiary);
  font-weight: 600;
  color: var(--muted);
}

.log-summary-table td.log-count {
  font-weight: 600;
  text-align: center;
}

.logs-info {
  display: flex;
  align-items: center;
  padding: var(--space-md);
  background-color: var(--bg-tertiary);
  border-radius: var(--radius-md);
  font-size: var(--text-base);
  color: var(--muted);
}

.logs-info svg {
  margin-right: var(--space-sm);
  color: var(--accent);
}

.empty-logs {
  text-align: center;
  color: var(--muted-soft);
  padding: var(--space-md);
}

/* Update search bar for better spacing with button */
.search-bar {
  display: flex;
  margin-bottom: var(--space-md);
  gap: var(--space-md);
  align-items: center;
}

.search-input-container {
  position: relative;
  flex: 1;
}

/* Pagination styles */
.pagination {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: var(--space-md);
  padding-top: var(--space-sm);
  border-top: 1px solid var(--border);
}

.pagination-info {
  font-size: var(--text-base);
  color: var(--muted);
}

/* Make search results info more prominent */
.search-results-info {
  display: flex;
  justify-content: space-between;
  margin-bottom: var(--space-md);
  padding: var(--space-sm);
  background-color: var(--bg-tertiary);
  border-radius: var(--radius-sm);
  font-size: var(--text-base);
  color: var(--muted);
}

/* User Stats Summary */
.user-stats-summary {
  margin-bottom: var(--space-md);
}

.stats-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap; /* Allow wrapping on smaller screens */
  gap: var(--space-md); /* Add spacing between items */
}

.stat-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm); /* Space between label and value */
}

.stat-label {
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--muted);
  white-space: nowrap; /* Prevent label from wrapping */
}

.stat-value {
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--fg);
}

/* Responsive Adjustments */
@media (max-width: 768px) {
  .stats-row {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-md);
  }

  .stat-item {
    width: 100%;
    justify-content: space-between;
  }
}

@media (max-width: 480px) {
  .stat-label {
    font-size: var(--text-sm);
  }

  .stat-value {
    font-size: var(--text-base);
  }
}

.security-findings-section {
  margin-top: var(--space-lg);
}

.vulnerability-section {
  margin-bottom: var(--space-lg);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.section-title {
  display: flex;
  align-items: center;
  padding: var(--space-md) var(--space-md);
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
  background-color: var(--bg-tertiary);
  border-bottom: 1px solid var(--border);
}

.severity-indicator {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  margin-right: var(--space-sm);
}

.severity-indicator.critical {
  background-color: var(--danger);
}

.severity-indicator.medium,
.severity-indicator.warning {
  background-color: var(--warning);
}

.severity-indicator.low {
  background-color: var(--muted-soft);
}

.severity-indicator.info {
  background-color: var(--accent);
}

.vulnerability-list {
  padding: var(--space-md);
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: var(--space-md);
}

.vulnerability-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: var(--space-md);
  background-color: var(--surface);
}

.vuln-type {
  font-weight: 600;
  color: var(--fg);
  margin-bottom: var(--space-sm);
}

.vuln-description {
  color: var(--muted);
  margin-bottom: var(--space-md);
  font-size: var(--text-base);
}

.vuln-detail {
  font-size: var(--text-base);
  margin-bottom: var(--space-sm);
  color: var(--muted);
}

.vuln-examples {
  font-size: var(--text-base);
  margin-bottom: var(--space-sm);
  color: var(--muted);
}

.vuln-examples ul {
  margin-top: var(--space-xs);
  padding-left: var(--space-lg);
}

.vuln-examples li {
  margin-bottom: var(--space-xs);
}

.vuln-recommendation {
  margin-top: var(--space-md);
  font-size: var(--text-base);
  padding: var(--space-sm);
  background-color: var(--bg-tertiary);
  border-radius: var(--radius-sm);
  color: var(--fg);
}

.detail-table {
  padding: 0 var(--space-md) var(--space-md);
  overflow-x: auto;
}

.detail-table table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-base);
  table-layout: fixed;
}

.detail-table td,
.detail-table th {
  padding: var(--space-md) var(--space-sm);
  text-align: left;
  border-bottom: 1px solid var(--border);
  vertical-align: top; /* Vertically align all cell content to the top */
}

.detail-table th {
  font-weight: 600;
  color: var(--muted);
}

/* NEW: Style for wrapping text in message cells */
.log-message-cell {
  word-wrap: break-word;
  word-break: break-word;
  white-space: normal;
}

.show-more {
  display: flex;
  justify-content: center;
  margin-top: var(--space-sm);
}

.full-list {
  border-top: 1px dashed var(--border);
  padding-top: var(--space-md);
}

.recommendations-list {
  padding: var(--space-md);
}

.recommendation-item {
  margin-bottom: var(--space-md);
  padding: var(--space-md);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background-color: var(--surface);
}

.recommendation-item.severity-critical {
  border-left: 4px solid var(--danger);
}

.recommendation-item.severity-medium {
  border-left: 4px solid var(--warning);
}

.recommendation-item.severity-low {
  border-left: 4px solid var(--muted-soft);
}

.recommendation-header {
  display: flex;
  align-items: center;
  margin-bottom: var(--space-sm);
}

.recommendation-title {
  font-weight: 600;
  color: var(--fg);
}

.recommendation-description {
  font-size: var(--text-base);
  color: var(--muted);
  margin-bottom: var(--space-md);
}

.recommendation-action {
  font-size: var(--text-base);
  color: var(--fg);
  background-color: var(--bg-tertiary);
  padding: var(--space-sm);
  border-radius: var(--radius-sm);
}

.text-danger {
  color: var(--danger);
  font-weight: 600;
}

.text-warning {
  color: var(--warning);
  font-weight: 600;
}

.text-info {
  color: var(--accent);
  font-weight: 600;
}

.inline-spinner {
  display: inline-block;
  animation: spin 1s linear infinite;
  vertical-align: middle;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.medium-section {
  border-left: 4px solid var(--warning);
}

.severity-indicator.medium,
.severity-indicator.warning {
  background-color: var(--warning);
}

/* --- STYLES FOR KNOWLEDGE HIERARCHY --- */
.hierarchy-container {
  display: flex;
  gap: var(--space-lg);
  min-height: 400px;
}
.hierarchy-tree-panel {
  flex: 1;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  overflow-y: auto;
}
.hierarchy-form-panel {
  flex-basis: 350px;
  padding: var(--space-md);
  background-color: var(--bg-tertiary);
  border-radius: var(--radius-md);
}
.hierarchy-list,
.hierarchy-services-list {
  list-style: none;
  padding-left: 0;
}
.hierarchy-services-list {
  padding-left: var(--space-xl);
  border-left: 2px solid var(--border);
  margin-left: var(--space-sm);
}
.hierarchy-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-sm);
  border-radius: var(--radius-sm);
  margin-bottom: var(--space-xs);
}
.hierarchy-item:hover {
  background-color: var(--bg-tertiary);
}
.hierarchy-item .item-name {
  font-weight: 500;
}
.hierarchy-item.service-item .item-name {
  font-weight: 400;
  color: var(--muted);
}
.hierarchy-item .item-actions {
  display: flex;
  gap: var(--space-sm);
  opacity: 0;
  transition: opacity 0.2s ease-in-out;
}
.hierarchy-item:hover .item-actions {
  opacity: 1;
}
.action-btn {
}
.empty-hierarchy {
  text-align: center;
  color: var(--muted-soft);
  padding: var(--space-xl);
}
.form-title {
  font-size: var(--text-lg);
  font-weight: 600;
  margin-bottom: var(--space-md);
  color: var(--fg);
}
.form-group {
  margin-bottom: var(--space-md);
}
.form-group label {
  display: block;
  margin-bottom: var(--space-sm);
  font-size: var(--text-base);
  color: var(--muted);
}
.form-actions {
  display: flex;
  gap: var(--space-sm);
}

/* --- STYLES FOR DOCUMENT MANAGEMENT --- */
.filter-bar {
  display: flex;
  gap: var(--space-md);
  align-items: center;
  margin-bottom: var(--space-md);
  padding-bottom: var(--space-md);
  border-bottom: 1px solid var(--border);
}
.document-row {
  cursor: pointer;
}
.document-row:hover {
  background-color: var(--bg-tertiary);
}
.label-tag {
  background-color: var(--bg-tertiary);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  margin-right: var(--space-xs);
  color: var(--muted);
}
.label-tag-more {
  font-size: var(--text-sm);
  color: var(--muted-soft);
}
.translations-section {
  margin-top: var(--space-lg);
  padding-top: var(--space-md);
  border-top: 1px solid var(--border);
}
.translations-title {
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--muted);
  margin-bottom: var(--space-md);
}
.translation-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: var(--space-md);
}
.translation-lang-select {
  flex-basis: 150px;
}
.translation-text-input {
  flex-grow: 1;
}
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-base);
}

.data-table th,
.data-table td {
  padding: var(--space-md); /* Increased padding for better spacing */
  text-align: left;
  border-bottom: 1px solid var(--border);
  white-space: nowrap; /* Prevent headers from wrapping */
}

.data-table th {
  font-weight: 600;
  color: var(--muted);
  background-color: var(--bg-tertiary);
}

/* Style for the main text column to allow wrapping if needed */
.data-table .cell-main {
  white-space: normal;
}

/* Make sortable headers interactive */
.sortable {
  cursor: pointer;
  user-select: none;
}
.sortable:hover {
  background-color: var(--border);
}
.sort-arrow {
  margin-left: var(--space-xs);
  color: var(--accent);
}

/* Column width classes (replace inline styles) */
.col-checkbox {
  width: 40px;
}
.col-status {
  width: 120px;
}
.col-labels {
  width: 200px;
} /* Give labels a bit more space */
.col-date {
  width: 150px;
}
.col-size {
  width: 100px;
}
.col-main {
  width: auto;
} /* Let the main column fill remaining space */

/* Style for empty/loading states */
.table-message {
  text-align: center;
  padding: var(--space-xl);
  color: var(--muted-soft);
}
</style>
