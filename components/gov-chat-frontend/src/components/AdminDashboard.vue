<template>
  <div class="admin-page genie-living-intelligence">
    <div class="admin-dashboard" data-test-id="admin-dashboard">
      <div class="dashboard">
        <div class="main">
          <div class="header">
            <h1 class="page-title">
              {{ translate('admin.systemAdministration', 'System Administration') }}
            </h1>
          </div>

          <div class="quick-stats">
            <div class="stat-card" data-test-id="stat-system-uptime">
              <div class="stat-title">
                {{ translate('admin.systemUptime', 'System Uptime') }}
              </div>
              <div class="stat-value" data-test-id="stat-system-uptime-value">{{ uptimeLabel }}</div>
              <div v-if="trend('uptime', true)" class="stat-trend" :class="trend('uptime', true).className">
                <span>{{ trend('uptime', true).arrow }} {{ trend('uptime', true).value }}</span>
                {{ translate('admin.fromLastMonth', 'from last month') }}
              </div>
            </div>
            <div class="stat-card" data-test-id="stat-avg-response-time">
              <div class="stat-title">
                {{ translate('admin.avgResponseTime', 'Average Response Time') }}
              </div>
              <div class="stat-value" data-test-id="stat-avg-response-time-value">{{ responseTimeLabel }}</div>
              <div
                v-if="trend('responseTime', false)"
                class="stat-trend"
                :class="trend('responseTime', false).className"
              >
                <span>{{ trend('responseTime', false).arrow }} {{ trend('responseTime', false).value }}</span>
                {{ translate('admin.fromLastMonth', 'from last month') }}
              </div>
            </div>
            <div class="stat-card" data-test-id="stat-error-rate">
              <div class="stat-title">
                {{ translate('admin.errorRate', 'Error Rate') }}
              </div>
              <div class="stat-value" data-test-id="stat-error-rate-value">{{ errorRateLabel }}</div>
              <div v-if="trend('errorRate', false)" class="stat-trend" :class="trend('errorRate', false).className">
                <span>{{ trend('errorRate', false).arrow }} {{ trend('errorRate', false).value }}</span>
                {{ translate('admin.fromLastMonth', 'from last month') }}
              </div>
            </div>
            <div class="stat-card" data-test-id="stat-monthly-active-users">
              <div class="stat-title">
                {{ translate('admin.monthlyActiveUsers', 'Monthly Active Users (MAU)') }}
              </div>
              <div class="stat-value" data-test-id="stat-monthly-active-users-value">
                {{ mauLabel }}
              </div>
              <div v-if="trend('activeUsers', true)" class="stat-trend" :class="trend('activeUsers', true).className">
                <span>{{ trend('activeUsers', true).arrow }} {{ trend('activeUsers', true).value }}</span>
                {{ translate('admin.fromLastMonth', 'from last month') }}
              </div>
            </div>
          </div>

          <div class="tabs-card">
            <!-- UX-1 (#1512): the sidebar nav rail is gone — its icons live on
                 the rack buttons now, one row of tabs carrying the whole
                 navigation. The rack is the ONLY nav surface; the per-tab
                 layouts stay responsive to the freed width. -->
            <DsTabs :tabs="adminTabs" :model-value="activeTab" @update:model-value="setActiveTab">
              <template #tab="{ tab }">
                <span class="admin-tab" :data-test-id="tab.testid || null">
                  <span class="admin-tab__icon" aria-hidden="true">{{ tab.icon }}</span>
                  <span class="admin-tab__label">{{ tab.label }}</span>
                </span>
              </template>
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

                  <!-- REVIEW H1: tri-state. The fabricated six-status list is
                       gone — a failed fetch renders an explicit error with a
                       retry, an in-flight first load renders Measuring…, and
                       only a real measurement renders the service list.
                       REVIEW T2: the state leaves collapsed into the shared
                       AdminStatePanel (one copy of the error+retry shell). -->
                  <AdminStatePanel
                    v-if="healthLoadError"
                    type="error"
                    :message="translate('admin.health.unavailable', 'System health is unavailable right now.')"
                    data-test-id="health-error"
                    retryable
                    retry-test-id="health-retry"
                    @retry="loadSystemHealth"
                  />
                  <div v-else-if="healthServices" class="health-status">
                    <div
                      v-for="service in healthServices"
                      :key="service.name"
                      :class="['health-item', `status-${service.status}`]"
                      :data-test-id="`health-${service.id}`"
                    >
                      <div :class="['status-badge', `badge-${service.status}`]"></div>
                      <span>{{ translate(`admin.services.${service.id}`, service.name) }}</span>
                    </div>
                  </div>
                  <AdminStatePanel
                    v-else
                    type="loading"
                    :message="translate('admin.measuring', 'Measuring…')"
                    data-test-id="health-measuring"
                  />
                </div>

                <div v-if="activeTab === 'overview'" class="dashboard-card">
                  <div class="card-header">
                    <div class="card-title">
                      {{ translate('admin.resourceUsage', 'Resource Usage') }}
                    </div>
                  </div>

                  <!-- REVIEW H1: same tri-state as the health card — no
                       fabricated CPU/memory/storage/network numbers. -->
                  <AdminStatePanel
                    v-if="healthLoadError"
                    type="error"
                    :message="translate('admin.resources.unavailable', 'Resource usage is unavailable right now.')"
                    data-test-id="usage-error"
                    retryable
                    retry-test-id="usage-retry"
                    @retry="loadSystemHealth"
                  />
                  <div v-else-if="resourceUsage" class="resource-usage">
                    <div
                      v-for="resource in resourceUsage"
                      :key="resource.id"
                      class="usage-item"
                      :data-test-id="`usage-${resource.id}`"
                    >
                      <div class="usage-header">
                        <div class="usage-label">{{ resource.label }}</div>
                        <div class="usage-value" :data-test-id="`usage-${resource.id}-value`">
                          {{ resource.value }}%
                        </div>
                      </div>
                      <div class="usage-bar">
                        <div
                          :class="['usage-fill', `usage-${getUsageLevel(resource.value)}`]"
                          :data-test-id="`usage-${resource.id}-fill`"
                          :style="{ width: `${resource.value}%` }"
                        ></div>
                      </div>
                    </div>
                  </div>
                  <AdminStatePanel
                    v-else
                    type="loading"
                    :message="translate('admin.measuring', 'Measuring…')"
                    data-test-id="usage-measuring"
                  />
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
                          <AdminStatePanel
                            v-if="translationsLoadFailed"
                            type="error"
                            data-test-id="hierarchy-translations-load-failed"
                            :message="
                              translate(
                                'admin.hierarchy.translationsLoadFailedNotice',
                                'Translations could not be loaded. Editing the translations and saving stay disabled until they load.'
                              )
                            "
                            retryable
                            retry-test-id="hierarchy-translations-retry"
                            :retry-label="translate('admin.hierarchy.retryTranslations', 'Retry')"
                            @retry="retryHierarchyTranslations"
                          />
                          <div
                            v-for="(translation, index) in hierarchyForm.translations"
                            :key="index"
                            class="translation-row"
                          >
                            <DsSelect
                              v-model="translation.lang"
                              class="translation-lang-select"
                              :placeholder="translate('admin.hierarchy.selectLang', 'Select Language')"
                              :disabled="translationsLoadFailed"
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
                              :disabled="translationsLoadFailed"
                            />
                            <DsButton
                              variant="danger"
                              :small="true"
                              class="translation-delete-btn"
                              :aria-label="translate('admin.hierarchy.deleteTranslation', 'Delete Translation')"
                              :disabled="translationsLoadFailed"
                              @click="removeTranslationRow(index)"
                            >
                              🗑️
                            </DsButton>
                          </div>
                          <DsButton
                            variant="secondary"
                            :small="true"
                            :disabled="translationsLoadFailed"
                            @click="addTranslationRow"
                          >
                            {{ translate('admin.hierarchy.addTranslation', '+ Add Translation') }}
                          </DsButton>
                        </div>
                      </div>
                      <div class="form-actions">
                        <DsButton
                          variant="primary"
                          :disabled="
                            !hierarchyForm.nameEN ||
                            isSavingHierarchyItem ||
                            isTranslationsLoading ||
                            translationsLoadFailed
                          "
                          @click="saveHierarchyItem"
                        >
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
                      <!-- NOT OKF-gated (round 16, #80117): scheduling a
                        website crawl is a pre-existing main capability —
                        the button rendered unconditionally on main. Only
                        the crawl→OKF CONVERSION the dialog then offers is
                        flag-gated (inside AddFromLinkDialog), so a parked
                        deployment keeps its crawl entry. -->
                      <DsButton variant="secondary" @click="addFromLink">
                        {{ translate('admin.documents.addLink', 'Add from Link') }}
                      </DsButton>
                      <DsButton variant="primary" @click="uploadFiles">
                        {{ translate('admin.documents.uploadFiles', 'Upload Files') }}
                      </DsButton>
                    </div>
                  </div>

                  <!-- W6 / EPIC-6 / CAP-5: the two views over doc-repo's files.
                       The DEFAULT view lists documents; the ARTIFACTS view lists
                       the OKF bundle zips — the per-version ingestion artifacts of
                       the published repositories. They are not documents, and they
                       used to sit in this very list unlabeled, carrying a Delete
                       affordance the server refuses (WS2 → 403 BUNDLE_PROTECTED).
                       The toggle mirrors the OKF Studio's Dashboard|Wizard switch
                       (StudioTab.vue:27-34) — one switch per surface, no new
                       navigation paradigm.
                       The switch is ALWAYS rendered — it is the surface's own
                       control, and a parked deployment (OKF_ENABLED=0) explains
                       itself in the artifacts pane rather than leaving the
                       operator on a switch that leads nowhere. -->
                  <nav
                    class="admin-documents__view-toggle"
                    aria-label="View"
                    data-test-id="admin-documents-view-toggle"
                  >
                    <DsButton
                      :variant="documentView === 'documents' ? 'primary' : 'secondary'"
                      small
                      data-test-id="admin-documents-view-documents"
                      @click="documentView = 'documents'"
                    >
                      {{ translate('admin.documents.viewDocuments', 'Documents') }}
                    </DsButton>
                    <DsButton
                      :variant="documentView === 'artifacts' ? 'primary' : 'secondary'"
                      data-test-id="admin-documents-view-artifacts"
                      small
                      @click="documentView = 'artifacts'"
                    >
                      {{ translate('admin.documents.viewArtifacts', 'Artifacts') }}
                    </DsButton>
                  </nav>

                  <template v-if="documentView === 'documents'">
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
                        data-test-id="admin-status-filter"
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
                        <!-- FilteredDocuments matches the status string exactly, so without
                           this option an "Ingested with Warnings" document shows only
                           under All Statuses — the very documents an operator needs to
                           isolate after raising a budget would be the ones that vanish. -->
                        <option value="ingested with warnings">
                          {{ translate('admin.documents.statusWarning', 'Ingested with Warnings') }}
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
                        <DsButton
                          v-if="okfEnabled"
                          variant="secondary"
                          :disabled="!okfRepoGate.visible"
                          :title="okfGateTitle"
                          @click="onCreateOkfRepoFromSelection"
                        >
                          {{ translate('okf.docs.createRepo', 'Create OKF repository') }}
                        </DsButton>
                      </div>
                      <div v-if="showRetractButton" class="card-actions">
                        <DsButton variant="secondary" @click="handleBatchAction('retract')">
                          {{ translate('admin.documents.retractSelected', 'Retract Selected') }}
                          ({{ selectedDocuments.length }})
                        </DsButton>
                      </div>
                      <div v-if="showDeleteButton" class="card-actions">
                        <!-- #1042 BATCH DELETE, AMENDED 2026-10-10 (live: David
                           selected pending rows to clean up and the whole
                           batch silently refused because ONE row had gone
                           Ingesting — the only signal was a hover tooltip on
                           a disabled button, read as "it failed"): the
                           refusal is now a VISIBLE strip, and a selection
                           with BOTH blocked and deletable rows deletes the
                           deletable subset (the confirm says exactly what
                           will be skipped). Full-disable only when NOTHING
                           is deletable. -->
                        <DsButton
                          variant="danger"
                          :disabled="!!deleteRefuseReason && !deletableSelection.length"
                          :title="deleteRefuseReason"
                          @click="handleBatchAction('delete')"
                        >
                          {{ translate('admin.documents.deleteSelected', 'Delete Selected') }}
                          ({{
                            deleteRefuseReason && deletableSelection.length
                              ? deletableSelection.length
                              : selectedDocuments.length
                          }})
                        </DsButton>
                        <span v-if="deleteRefuseReason" class="delete-refuse-strip">
                          {{
                            deletableSelection.length
                              ? translate(
                                  'admin.documents.deletePartialNotice',
                                  '{blocked} selected file(s) cannot be deleted ({reason}) — only the other {n} will be deleted.'
                                )
                                  .replace('{blocked}', String(blockedSelection.length))
                                  .replace('{reason}', deleteRefuseReason)
                                  .replace('{n}', String(deletableSelection.length))
                              : deleteRefuseReason
                          }}
                        </span>
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
                            <td colspan="6" class="table-message" data-test-id="table-message">
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
                              <input v-model="selectedDocuments" type="checkbox" :value="doc.file_id" />
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
                        « {{ translate('admin.userManagementSection.previous', 'Previous') }}
                      </DsButton>

                      <span class="pagination-info">
                        {{ translate('admin.userManagementSection.showing', 'Showing') }}
                        {{ (documentPagination.page - 1) * documentPagination.limit + 1 }}-{{
                          Math.min(documentPagination.page * documentPagination.limit, documentPagination.total)
                        }}
                        {{ translate('admin.userManagementSection.of', 'of') }}
                        {{ documentPagination.total }}
                      </span>

                      <DsButton
                        variant="ghost"
                        :small="true"
                        class="page-btn"
                        :disabled="documentPagination.page * documentPagination.limit >= documentPagination.total"
                        @click="handleDocumentPagination(documentPagination.page + 1)"
                      >
                        {{ translate('admin.userManagementSection.next', 'Next') }} »
                      </DsButton>
                    </div>
                  </template>

                  <!-- The artifacts view. OKF-gated: the bundle zips only exist
                       when the OKF pillar is on, and the okf store module (the
                       source of the repository names) is only registered then.
                       A parked deployment keeps the documents view only — the
                       toggle is still rendered (the view switch is the surface's
                       own control), but the artifacts pane explains itself
                       rather than showing an empty list. -->
                  <OkfArtifactsView v-else-if="okfEnabled" />
                  <div v-else class="admin-documents__parked">
                    <p class="admin-documents__parked-text">
                      {{
                        translate(
                          'admin.documents.artifactsParked',
                          'OKF artifacts appear when the OKF feature is enabled for this deployment.'
                        )
                      }}
                    </p>
                  </div>
                </div>

                <div v-if="activeTab === 'studio'" class="dashboard-card" style="grid-column: span 2">
                  <OkfStudioTab ref="okfStudioTab" @studio-ready="flushPendingStudioEvents" />
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

                  <!-- REVIEW H3: the hardcoded "42.3 GB / 128 tables" is gone.
                       A failed (or figure-less) stats fetch renders an
                       explicit error with a retry; a first load renders
                       Measuring…; real figures render only when measured.
                       REVIEW T2: leaves collapsed into AdminStatePanel. -->
                  <AdminStatePanel
                    v-if="dbStatsError"
                    type="error"
                    :message="translate('admin.dbStats.unavailable', 'Database statistics are unavailable right now.')"
                    data-test-id="db-stats-error"
                    retryable
                    retry-test-id="db-stats-retry"
                    @retry="loadDatabaseStats"
                  />
                  <div v-else-if="dbStats" class="db-stats">
                    <div>
                      <strong>{{ translate('admin.databaseSize', 'Database Size') }}:</strong>
                      {{ dbStats.databaseSize }}
                    </div>
                    <div>
                      <strong>{{ translate('admin.totalTables', 'Total Tables') }}:</strong>
                      {{ dbStats.totalTables }}
                    </div>
                  </div>
                  <AdminStatePanel
                    v-else
                    type="loading"
                    :message="translate('admin.measuring', 'Measuring…')"
                    data-test-id="db-stats-measuring"
                  />
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
                    </div>
                  </div>

                  <div class="logs-summary" data-test-id="logs-errors-card">
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
                          <tr
                            v-for="(log, index) in errorLogsSummary"
                            :key="'error-' + index"
                            :data-test-id="`log-row-errors-${log.type}-${log.service}`"
                          >
                            <td>
                              {{ translate(`admin.logTypes.${log.type}`, log.type) }}
                            </td>
                            <td>{{ log.service }}</td>
                            <td class="log-count" :data-test-id="`log-count-errors-${log.type}-${log.service}`">
                              {{ log.count }}
                            </td>
                          </tr>
                          <tr v-if="errorLogsSummary.length === 0">
                            <td colspan="3" class="empty-logs" data-test-id="logs-errors-empty">
                              {{ translate('admin.logsSection.noErrorLogs', 'No error logs recorded today.') }}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div class="logs-summary" data-test-id="logs-warnings-card">
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
                          <tr
                            v-for="(log, index) in warningLogsSummary"
                            :key="'warning-' + index"
                            :data-test-id="`log-row-warnings-${log.type}-${log.service}`"
                          >
                            <td>
                              {{ translate(`admin.logTypes.${log.type}`, log.type) }}
                            </td>
                            <td>{{ log.service }}</td>
                            <td class="log-count" :data-test-id="`log-count-warnings-${log.type}-${log.service}`">
                              {{ log.count }}
                            </td>
                          </tr>
                          <tr v-if="warningLogsSummary.length === 0">
                            <td colspan="3" class="empty-logs" data-test-id="logs-warnings-empty">
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
                      {{ translate('admin.logsSection.searchResults', 'Latest Search Results') }}
                      <span class="results-count">
                        ({{ searchResults.length }} {{ translate('admin.logsSection.entriesFound', 'entries found') }})
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
                          {{ translate('admin.logsSection.viewAllResults', 'View All Results') }}
                        </DsButton>
                      </div>
                    </div>
                  </div>

                  <log-search-dialog
                    v-if="showLogSearchDialog"
                    @close="showLogSearchDialog = false"
                    @search-results="handleSearchResults"
                  />
                </div>

                <div v-if="activeTab === 'queryInspector'" class="dashboard-card" style="grid-column: span 2">
                  <div class="card-header">
                    <div class="card-title">
                      {{ translate('admin.queryInspector.title', 'Query Inspector') }}
                    </div>
                  </div>
                  <QueryInspector />
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

                  <!-- REVIEW H2: a failed fetch used to install the all-zero
                       "clean bill" and read as "system appears secure". The
                       loading state renders during a load/retry, the error
                       state after a failure, and the details only from a real
                       response. Also fixed in passing: the tile read
                       `securityMetrics.lastScan` while the loader writes
                       `lastSecurityScan` — the value has been rendering empty. -->
                  <AdminStatePanel
                    v-if="securityLoading"
                    type="loading"
                    :message="translate('admin.security.loadingMetrics', 'Loading security data…')"
                    data-test-id="security-loading"
                  />
                  <AdminStatePanel
                    v-else-if="securityUnavailable"
                    type="error"
                    :message="translate('admin.security.unavailable', 'Security data is unavailable right now.')"
                    data-test-id="security-error"
                    retryable
                    retry-test-id="security-retry"
                    @retry="retrySecurity"
                  />
                  <div v-else-if="!isLoading && securityMetrics" class="security-details">
                    <div>
                      <strong>{{ translate('admin.security.lastSecurityScan', 'Last Security Scan') }}:</strong>
                      {{ formatScanStamp(securityMetrics.lastSecurityScan) }}
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
                    <div v-if="securityDetails && securityDetails.patternMatches.length > 0">
                      <strong>{{ translate('admin.security.logPatternMatches', 'Log Pattern Matches') }}:</strong>
                      {{ securityDetails.patternMatches.length }}
                      <span class="pattern-match-note">
                        {{
                          translate(
                            'admin.security.patternMatchSummaryNote',
                            '(substring found in log text, not a verified attack)'
                          )
                        }}
                      </span>
                    </div>
                  </div>

                  <!-- REVIEW pass-3 (altitude): this section's own v-if
                       re-derived "is security renderable" without the error
                       flags, so a metrics failure left it rendering STALE
                       findings under the fresh error card. The two blocks
                       (counts tile + findings lists) render TOGETHER when
                       healthy, so this stays a sibling — gated by the same
                       securityUnavailable computed as the error card, not a
                       re-derived conjunction. -->
                  <div v-if="!isLoading && !securityUnavailable && securityDetails" class="security-findings-section">
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
                      v-if="securityDetails.patternMatches && securityDetails.patternMatches.length > 0"
                      class="vulnerability-section pattern-match-section"
                    >
                      <h3 class="section-title">
                        <span class="severity-indicator neutral"></span>
                        {{ translate('admin.security.logPatternMatches', 'Log Pattern Matches') }}
                        <span class="pattern-match-note">
                          {{
                            translate(
                              'admin.security.patternMatchNote',
                              'Terms found in log text. The scan reports the substring, not a verified attack — read the line.'
                            )
                          }}
                        </span>
                      </h3>
                      <div class="vulnerability-list">
                        <div
                          v-for="(match, index) in securityDetails.patternMatches"
                          :key="'match-' + index"
                          class="pattern-match-card"
                        >
                          <div class="vuln-detail">
                            <strong>{{ translate('admin.security.matchedTerm', 'Matched Term') }}:</strong>
                            {{ match.pattern }}
                            <span class="pattern-match-count">
                              &mdash; {{ match.occurrences }}
                              {{ translate('admin.security.occurrences', 'occurrences') }}
                            </span>
                          </div>
                          <div v-if="match.service" class="vuln-detail">
                            <strong>{{ translate('admin.security.service', 'Service') }}:</strong>
                            {{ match.service }}
                          </div>
                          <div v-if="match.sampleTimestamp" class="vuln-detail">
                            <strong>{{ translate('admin.security.firstSeen', 'First Seen') }}:</strong>
                            {{ match.sampleTimestamp }}
                          </div>
                          <code v-if="match.sample" class="pattern-match-sample">{{ match.sample }}</code>
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

                    <!-- REVIEW round-4: the conjunction also consults
                         suspiciousDetails — a "clean bill" above a table
                         listing suspicious activity is the false-verdict
                         shape this wave exists to kill. (patternMatches
                         stay informational by the backend's own semantics.) -->
                    <div
                      v-if="
                        !securityDetails.vulnerabilityDetails ||
                        (securityDetails.vulnerabilityDetails.critical.length === 0 &&
                          securityDetails.vulnerabilityDetails.medium.length === 0 &&
                          securityDetails.vulnerabilityDetails.low.length === 0 &&
                          (!securityDetails.failedLoginDetails || securityDetails.failedLoginDetails.length === 0) &&
                          (!securityDetails.suspiciousDetails || securityDetails.suspiciousDetails.length === 0))
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
                        :aria-label="translate('admin.userManagementSection.clearSearch', 'Clear search')"
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
                            {{
                              translate(
                                'admin.userManagementSection.noUsersFound',
                                'No users found matching your search criteria.'
                              )
                            }}
                          </div>
                          <div v-else>
                            {{ translate('admin.userManagementSection.noUsers', 'No users available.') }}
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
                      « {{ translate('admin.userManagementSection.previous', 'Previous') }}
                    </DsButton>

                    <span class="pagination-info">
                      {{ translate('admin.userManagementSection.showing', 'Showing') }}
                      {{ userSearchOffset + 1 }}-{{ Math.min(userSearchOffset + userSearchLimit, userSearchTotal) }}
                      {{ translate('admin.userManagementSection.of', 'of') }} {{ userSearchTotal }}
                    </span>

                    <DsButton
                      variant="ghost"
                      :small="true"
                      class="page-btn"
                      :disabled="userSearchOffset + userSearchLimit >= userSearchTotal"
                      @click="handleUserSearchPagination(userSearchOffset + userSearchLimit)"
                    >
                      {{ translate('admin.userManagementSection.next', 'Next') }} »
                    </DsButton>
                  </div>
                </div>

                <!-- Story 8-7 (David 2026-10-20): the Models tab — the LAST
                     Admin Dashboard tab. Named remote-model configurations are
                     platform-level (tools-admin enforced server-side; the panel
                     renders an honest access note for everyone else). -->
                <div v-if="activeTab === 'models'" class="dashboard-card" style="grid-column: span 2">
                  <div class="card-header">
                    <div class="card-title">
                      {{ translate('admin.tabs.models', 'Models') }}
                    </div>
                  </div>
                  <OkfModelConfigPanel />
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
import analyticsService from '../services/analyticsService';
import { isOkfEnabled } from '../utils/okfFlag';
import OperationResultsModal from './OperationResultsModal.vue';
import LogSearchDialog from './LogSearchDialog.vue';
import UploadFilesDialog from './UploadFilesDialog.vue';
import AddFromLinkDialog from './AddFromLinkDialog.vue';
import FileDetailsDialog from './FileDetailsDialog.vue';
import ConfirmDialog from './ConfirmDialog.vue'; // IMPORT ConfirmDialog
import QueryInspector from './admin/QueryInspector/QueryInspector.vue';
import AdminStatePanel from './admin/AdminStatePanel.vue';
import DsButton from './ds/Button.vue';
import DsInput from './ds/Input.vue';
import DsStatusTag from './ds/StatusTag.vue';
import DsSpinner from './ds/Spinner.vue';
import DsStateDisplay from './ds/StateDisplay.vue';
import DsTabs from './ds/Tabs.vue';
import DsSelect from './ds/Select.vue';
import { defineAsyncComponent } from 'vue';
import { Loader2 } from '@lucide/vue';
import { eventBus } from '../eventBus.js';
import { getAvailableLanguages } from '../config/languageConfig.js';
import oidcConfig from '../config/oidcConfig.js';
import documentFileService from '../services/documentFileService.js';
import { formatFileSize } from '../utils/fileUtils.js';

// The blank metric shapes, declared ONCE: data() and resetHealthSurfaces()
// must never drift (a metric added to one and missed in the other lets a
// stale value survive a failed load — review pass-3, altitude).
const blankMetrics = () => ({
  systemUptime: null,
  avgResponseTime: null,
  errorRate: null,
  monthlyActiveUsers: null
});
const blankTrends = () => ({
  uptime: null,
  responseTime: null,
  errorRate: null,
  activeUsers: null
});
import { statusKey, statusVariant, displayStatus } from '../utils/documentStatus.js';
import { themeManager } from '../utils/ThemeManager';

// OKF HEAVY COMPONENTS — ASYNC (round 17, #80362): StudioTab and
// ModelConfigPanel pull cytoscape, cytoscape-fcose, markdown-it,
// highlight.js and gray-matter. Statically imported, a flag-OFF deployment
// still downloaded and parsed those hundreds of KB at startup. Async
// components load their chunk only on FIRST RENDER — both panes render
// exclusively behind isOkfEnabled(), so the dark build never fetches them.
const OkfStudioTab = defineAsyncComponent(() => import('./okf/StudioTab.vue'));
const OkfModelConfigPanel = defineAsyncComponent(() => import('./okf/editor/ModelConfigPanel.vue'));
// W6 / EPIC-6 / CAP-5: the OKF artifacts view — the labeled home of the
// bundle zips that used to sit unlabeled in the document list.
const OkfArtifactsView = defineAsyncComponent(() => import('./okf/ArtifactsView.vue'));

// Shared empty named-params dict for translate() — a frozen module constant
// so the default argument allocates once, not on every per-render call.
const EMPTY_NAMED = Object.freeze({});

// A missing key's fallback stands in for the translation, so it goes through
// the same interpolation a real message would — otherwise it renders literal
// `{current}`-style placeholders. A null named value renders empty, matching
// vue-i18n; a fully-empty result falls back to the key rather than showing
// the untouched braces. Module-level so the per-call translate() path
// allocates nothing.
function interpolateFallback(key, fallback, named) {
  const interpolated = fallback.replace(/\{(\w+)\}/g, (m, k) => (named[k] != null ? named[k] : ''));
  return interpolated || key;
}

export default {
  name: 'AdminDashboard',
  components: {
    OperationResultsModal,
    LogSearchDialog,
    OkfModelConfigPanel,
    OkfArtifactsView,
    AdminStatePanel,
    ConfirmDialog,
    UploadFilesDialog,
    AddFromLinkDialog,
    FileDetailsDialog,
    QueryInspector,
    DsButton,
    DsInput,
    DsStatusTag,
    DsSpinner,
    DsStateDisplay,
    DsTabs,
    DsSelect,
    OkfStudioTab,
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
      // Generation counter for edit-form translation fetches: two rapid
      // showEditForm calls race, and the SLOWER fetch must not populate,
      // flag or unblock the form the newer fetch already answered.
      hierarchyTranslationsSeq: 0,
      // The current edit form's translation load FAILED. The backend's
      // update path treats `translations: []` as clear-all, so a save from
      // a form whose rows never loaded would silently wipe every existing
      // translation. While this is true, Save is disabled and the save
      // action refuses to run.
      translationsLoadFailed: false,
      // Dedicated to the hierarchy form: the dashboard-wide isLoading is
      // shared by unrelated operations, so gating the Save button on it
      // disabled the form during a log/security scan and let one
      // operation re-enable another operation's button.
      isSavingHierarchyItem: false,

      // Configuration for language dropdowns in translations tables (deployment-scoped)
      availableLanguages: getAvailableLanguages(),

      // Current locale for translations
      currentLocale: this.getCurrentLanguage(),

      securityDetails: null,
      // Theme settings
      currentTheme: document.documentElement.getAttribute('data-theme') || 'light',

      // Tab navigation
      activeTab: 'overview',
      // Studio hand-off dispatches queued while the async StudioTab chunk is
      // still loading — drained on its 'studio-ready' emit (round 18, #80478).
      pendingStudioEvents: [],
      tabs: [
        // UX-1 (#1512): the icons are the sidebar rail's, relocated onto the
        // rack (the rail itself is gone). testid preserves the ONE handle a
        // spec used (admin-logs-link) — the E2E rule adds handles only where
        // a spec needs them.
        { id: 'overview', label: 'System Health', icon: '📊' },
        { id: 'hierarchy', label: 'Knowledge Hierarchy', icon: '🔀' },
        // W6: the documents tab carries a test handle. The tab rack replaced
        // the sidebar (UX-1), and the e2e helper still navigated by the
        // REMOVED sidebar link — a locator for a surface that no longer
        // exists. The handle is the tab's own address, as the logs tab
        // already had.
        { id: 'documents', label: 'Document Management', icon: '📂', testid: 'admin-documents-link' },
        { id: 'studio', label: 'OKF Studio', icon: '🧪' },
        { id: 'database', label: 'Database', icon: '💾' },
        { id: 'logs', label: 'Logs', icon: '📋', testid: 'admin-logs-link' },
        { id: 'queryInspector', label: 'Query Inspector', icon: '🔍' },
        { id: 'security', label: 'Security', icon: '🔒' },
        { id: 'users', label: 'Users', icon: '👥' },
        // Story 8-7 (David 2026-10-20): model configurations — the LAST tab.
        { id: 'models', label: 'Models', icon: '🤖' }
      ],

      // Loading state
      isLoading: false,

      // Operation in progress
      currentOperation: null,

      // Operation results
      operationResults: null,

      // System health services — NULL until a real measurement lands
      // (review H1: the old defaults — six statuses with Storage on warning
      // and External API on error — rendered while loading AND persisted
      // when the fetch failed).
      healthServices: null,

      // Database stats — NULL until the real ArangoDB figures arrive
      // (review H3: the old default was a hardcoded "42.3 GB / 128 tables").
      dbStats: null,

      // Resource usage metrics — NULL until measured
      // (review H1: the old default fabricated 42/78/92/35 and a red
      // 92% storage bar out of nothing).
      resourceUsage: null,

      logs: [],

      // CORRECTED: Hardcoded data removed. Initialized as empty arrays.
      errorLogsSummary: [],
      warningLogsSummary: [],

      showLogSearchDialog: false,

      showOperationResults: false,

      metrics: blankMetrics(),

      // Per-surface error flags (review H1/H2/H3): a failed fetch renders an
      // explicit error state with a retry — never the previous success,
      // never a fabricated default, never a clean bill of health.
      healthLoadError: false,
      dbStatsError: false,
      securityMetricsError: false,
      securityDetailsError: false,
      // REVIEW round-2 F4: the security card had NO loading state of its own
      // (the old loading display is gated on runSecurityScan only), so a tab
      // load or a retry rendered a blank card until the response landed.
      securityLoading: false,

      // Month-over-month deltas, computed server-side against the stored
      // analytics collection. `null` means "not computable" (the previous
      // period has no record, or the metric itself was unavailable) and
      // renders no trend at all rather than a fabricated one.
      trends: blankTrends(),

      // Security metrics — NULL until a real response lands (review H2: the
      // old default FABRICATED 23 failed logins, 5 suspicious activities and
      // 7 vulnerabilities dated "2 days ago" on the security tab).
      securityMetrics: null,

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
      // W6 / EPIC-6 / CAP-5: which view the documents tab shows —
      // 'documents' (the list of documents) or 'artifacts' (the OKF bundle
      // zips, labeled with their repository and version).
      documentView: 'documents',
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
      // Debounce timer for the document search box. Without this, every
      // keystroke fires loadDocuments() in parallel — the response for
      // "c" can arrive after the response for "cucu" and overwrite the
      // results with stale data (see documentSearchTerm watcher).
      searchDebounceTimer: null,
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
    // The backend reports `null` when the error rate could not be
    // computed (VictoriaLogs unreachable, or answering a body the
    // adapter cannot read). Rendering that as `0%` would be a green
    // tile for a day nobody measured, so it gets a dash instead.
    errorRateLabel() {
      return this.metrics.errorRate === null || this.metrics.errorRate === undefined
        ? '\u2014'
        : `${this.metrics.errorRate}%`;
    },
    // One source of truth for "the security surface failed to load" \u2014 the
    // error card, the findings section and the clean bill all key off this
    // computed instead of re-deriving the conjunction (review pass-3,
    // altitude: a mixed state rendered stale findings under a fresh error).
    securityUnavailable() {
      return this.securityMetricsError || this.securityDetailsError;
    },
    // REVIEW H1: same null discipline for the other tiles \u2014 the loader
    // nulls them on boot and on a failed fetch, and a dash is the honest
    // rendering of "not measured", never "null%" or "nullms".
    uptimeLabel() {
      // NOT analyticsService.formatValue('percent'): that renders toFixed(1),
      // which rounds a measured 99.98 into "100.0%" \u2014 the fabricated-looking
      // figure this wave exists to kill. Keep the measured precision.
      return this.metrics.systemUptime == null ? '\u2014' : `${this.metrics.systemUptime}%`;
    },
    // Reuse (review pass-3): analyticsService.formatValue already implements
    // the null\u2192dash + unit contract (UnifiedAnalytics delegates the same
    // way); 'milliseconds' matches the analytics precedent (Math.round).
    responseTimeLabel() {
      return analyticsService.formatValue(this.metrics.avgResponseTime, 'milliseconds', this.currentLocale);
    },
    // REVIEW round-2 F2: the MAU tile rendered `(metrics.monthlyActiveUsers
    // ?? 0)` \u2014 a fabricated 0 for unmeasured data, the exact lie the other
    // three tiles stopped telling. Delegated to formatValue('number') \u2014
    // null \u2192 '\u2014', locale-aware grouping.
    mauLabel() {
      return analyticsService.formatValue(this.metrics.monthlyActiveUsers, 'number', this.currentLocale);
    },
    // OKF feature flag (2026-10-21): window.APP_CONFIG.okfEnabled, written by
    // the frontend entrypoint from OKF_ENABLED — the image default is DARK
    // ('0' since the !622 wave-1 review; compose/ansible write it explicitly).
    // Absent config = enabled, which is dev-server-only (`npm run serve` has
    // no runtime config). Hides the OKF Studio and Models tabs (Query
    // Inspector is platform tooling and stays — David's call 2026-10-21).
    // Shared helper: the store registration and every gated surface read the
    // same value, so the gating model cannot drift.
    okfEnabled() {
      return isOkfEnabled();
    },
    adminTabs() {
      return this.tabs
        .filter((t) => this.okfEnabled || (t.id !== 'studio' && t.id !== 'models'))
        .map((t) => ({
          label: this.translate(`admin.tabs.${t.id}`, t.label),
          value: t.id,
          icon: t.icon,
          testid: t.testid
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
      const selectedStatus = String(this.documentFilters.status).toLowerCase().trim();
      if (!this.documents || this.documents.length === 0) {
        return [];
      }
      if (selectedStatus === 'all') {
        return this.documents; // If 'All' is selected, return the full list
      }
      return this.documents.filter(
        (doc) => doc.dataprep && String(doc.dataprep.status).toLowerCase().trim() === selectedStatus
      );
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

      // 2. Create a Set of selected file_ids for efficient lookup
      const selectedKeys = new Set(this.selectedDocuments);

      // 3. Find all the full document objects that are currently selected
      const selectedDocObjects = this.documents.filter((doc) => selectedKeys.has(doc.file_id));

      // 4. Check if ANY of the selected documents have the status 'ingested'
      //
      // 'ingested with warnings' is deliberately NOT treated as ingested here. A
      // degraded document is indexed and searchable, but part of it never landed
      // — its chunks carry file labels instead of model labels, or raw text
      // instead of a generated context. The useful action on it is to re-ingest
      // after raising DATAPREP_LLM_PHASE_TIMEOUT_SECONDS, so the button must
      // stay available for exactly those. Do not "fix" this by widening the
      // comparison: that would hide the remedy.
      const hasIngestedFile = selectedDocObjects.some(
        (doc) => doc.dataprep && String(doc.dataprep.status).toLowerCase().trim() === 'ingested'
      );

      // 5. Only show the button if there are selected files AND none of them are ingested
      return !hasIngestedFile;
    },

    showRetractButton() {
      // 1. Don't show if no documents are selected
      if (this.selectedDocuments.length === 0) {
        return false;
      }

      // 2. Build a Set of selected file_ids for efficient lookup
      const selectedIds = new Set(this.selectedDocuments);

      // 3. Find the full document objects that are currently selected
      const selectedDocObjects = this.documents.filter((doc) => selectedIds.has(doc.file_id));

      // 4. Hide if ANY selected document is already retracted
      const hasRetractedFile = selectedDocObjects.some(
        (doc) => doc.dataprep && String(doc.dataprep.status).toLowerCase().trim() === 'retracted'
      );

      return !hasRetractedFile;
    },
    // #1042 BATCH DELETE: gate. Visible as soon as the steward picks any
    // file — the disabled+title state carries INGESTED-blocked messages.
    showDeleteButton() {
      return this.selectedDocuments.length > 0;
    },
    // #1042 BATCH DELETE: refuse-reason string for the disabled button's
    // hover title. Null = allowed; non-null = button greyed out, this
    // string explains why in the UI's active locale. Counts the rejected
    // files so the message is actionable.
    deleteRefuseReason() {
      if (this.selectedDocuments.length === 0) return null;
      const blocked = this.blockedSelection.length;
      const bundles = this.bundleSelection.length;
      if (!blocked && !bundles) return null;
      // Named-param interpolation (the post-merge translate() convention):
      // the fallback path interpolates {count} itself, so a .replace chain
      // would see its placeholder consumed first (round 11, merge fallout).
      //
      // W6 / EPIC-6 / CAP-5: an OKF bundle zip in the selection needs its OWN
      // reason — "still ingested, retract it first" is advice that cannot be
      // followed on a bundle (the WS2 guard refuses every delete except the
      // okf-service account's). Telling an operator to retract a bundle
      // would be the same class of lie this wave removes.
      if (bundles && !blocked) {
        return this.translate(
          'admin.documents.deleteRefuseBundle',
          '{count} OKF artifact(s) are managed by the repository lifecycle and cannot be deleted here.',
          { count: bundles }
        );
      }
      if (bundles && blocked) {
        return this.translate(
          'admin.documents.deleteRefuseMixed',
          '{blocked} file(s) are still ingested — retract them first. {bundles} OKF artifact(s) are managed by the repository lifecycle and cannot be deleted here.',
          { blocked, bundles }
        );
      }
      return this.translate(
        'admin.documents.deleteRefuseReason',
        '{count} file(s) are still ingested — retract them first.',
        {
          count: blocked
        }
      );
    },
    /** 2026-10-10 (live): the selected rows that the delete gate BLOCKS
     * (ingested/ingesting — deleting would orphan the served corpus). */
    blockedSelection() {
      if (this.selectedDocuments.length === 0) return [];
      const ids = new Set(this.selectedDocuments);
      return this.documents.filter((doc) => {
        if (!ids.has(doc.file_id)) return false;
        const s = doc.dataprep && String(doc.dataprep.status).toLowerCase().trim();
        // 'ingested with warnings' IS serving (the okfRepoGate serving-count
        // and the row badge both treat it so) — deleting the files doc under
        // a served corpus orphans the reference (review !622 round 10,
        // #78744).
        return s === 'ingested' || s === 'ingesting' || s === 'ingested with warnings';
      });
    },
    /** 2026-10-10: the selected rows that ARE deletable — a mixed
     * selection deletes this subset instead of refusing wholesale. */
    deletableSelection() {
      if (this.selectedDocuments.length === 0) return [];
      const blockedIds = new Set(this.blockedSelection.map((d) => d.file_id));
      const bundleIds = new Set(this.bundleSelection.map((d) => d.file_id));
      // Round 18 (#80486): blockedSelection only sees rows in the LOADED
      // documents list — a blocked row hidden by the active search filter
      // (or a stale selection) was counted deletable, the confirm dialog
      // over-promised "N file(s) will be deleted" including it, and the
      // server then refused it per-file (STILL_SERVING) as a "partial
      // failure" the dialog said could not happen. Only ids the loaded
      // list can vouch for count as deletable.
      const loadedIds = new Set(this.documents.map((d) => d.file_id));
      // W6 / EPIC-6 / CAP-5: a bundle zip is NEVER deletable from document
      // management — the WS2 guard refuses every delete except the
      // okf-service account's, with 403 BUNDLE_PROTECTED. Counting one as
      // deletable is the "deletable in the UI but 403s" lie this wave
      // exists to remove.
      //
      // The PRIMARY guard is the list filter itself (is_bundle: false — the
      // bundles live in the artifacts view), so with that filter in place no
      // bundle reaches `this.documents` and this clause cannot fire. It
      // stays because it states the RULE rather than the filter's current
      // behaviour: should the filter ever regress, or a bundle row arrive by
      // another path, the rule still holds here — and the server-side WS2
      // guard is the backstop either way.
      return this.selectedDocuments.filter((id) => loadedIds.has(id) && !blockedIds.has(id) && !bundleIds.has(id));
    },
    /** W6 / EPIC-6 / CAP-5: the selected rows that are OKF bundle zips.
     * They are owned by the OKF lifecycle (the WS2 guard), never by the
     * document management delete. (With the is_bundle: false list filter in
     * place no bundle reaches the document list — see deletableSelection.) */
    bundleSelection() {
      if (this.selectedDocuments.length === 0) return [];
      const ids = new Set(this.selectedDocuments);
      return this.documents.filter((doc) => ids.has(doc.file_id) && doc.is_bundle === true);
    },

    // Gate for the "Create OKF repository" button. AMENDED (Story 7.7,
    // David 2026-09-14): INGESTED documents are now IMPORTABLE — the old
    // alreadyIngested refusal is dropped. The prevention moved downstream to
    // the OKF lifecycle: the new repo's `ingest` transition is refused
    // (SOURCES_NOT_RETRACTED) while any source doc still serves the
    // free-form corpus. The enabled-with-warning state surfaces that here.
    // Remaining refusals: empty selection; a doc already sourced by ANOTHER
    // OKF repo (okf_repo_id).
    okfRepoGate() {
      if (this.selectedDocuments.length === 0) {
        return { visible: false, reasonKey: 'okf.docs.gate.emptySelection', warnKey: null };
      }
      const selectedKeys = new Set(this.selectedDocuments);
      // selectedDocuments holds file_id's (the checkbox binds :value="doc.file_id")
      // — matching on the Arango _key never matches (review !622 wave 2, #78639).
      const selectedDocObjects = this.documents.filter((doc) => selectedKeys.has(doc.file_id));
      const alreadyOkf = selectedDocObjects.filter((doc) => doc.okf_repo_id);
      if (alreadyOkf.length > 0) {
        return { visible: false, reasonKey: 'okf.docs.gate.alreadyInOkf', warnKey: null };
      }
      const serving = selectedDocObjects.filter((doc) => {
        const s = doc.dataprep && String(doc.dataprep.status).toLowerCase().trim();
        return s === 'ingesting' || s === 'ingested' || s === 'ingested with warnings';
      });
      return {
        visible: true,
        reasonKey: null,
        warnKey: serving.length > 0 ? 'okf.docs.gate.servingWarn' : null,
        servingCount: serving.length
      };
    },
    okfGateTitle() {
      if (this.okfRepoGate.reasonKey) return this.translate(this.okfRepoGate.reasonKey, '');
      if (this.okfRepoGate.warnKey)
        // ROUND 25 CORRECTION (review 83379): round 23's named-param call
        // REGRESSED this tooltip. There are TWO servingWarn keys — the
        // import-dialog one (:2508, plain {n}) and this GATE leaf, stored
        // BRACE-ESCAPED ({'{'}n{'}'}) in all 14 locales and pinned that way
        // by localeConsistency's DYNAMIC_COMPILED_KEYS since round 16. On an
        // escaped leaf the compiled path renders the LITERAL text {n} — so
        // the original .replace form was correct all along, and the named
        // param fills nothing (named interpolation never touches the
        // escaped-literal rendering), leaking "{n}" in every locale. Back to
        // .replace — one regime, the leaf's pinned contract unchanged.
        return this.translate(this.okfRepoGate.warnKey, '').replace('{n}', String(this.okfRepoGate.servingCount));
      return '';
    }
  },
  watch: {
    // Story 7.7 deep links: popup-card source links push ?tab=documents&file=
    // — the watcher opens the SAME FileDetailsDialog the documents list uses.
    '$route.query': {
      handler(q) {
        this.applyRouteQuery(q);
      },
      immediate: true
    },
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
      // 250ms debounce — collapses a typed query ("c","cu","cuc","cucu")
      // into a single loadDocuments() call. The page reset is immediate
      // (UI feedback) but the network call is deferred until the user
      // stops typing. Filters use deep:true so they get their own path
      // without debounce (one change → one fetch is the desired contract
      // for filters; multiple rapid keystrokes is what we collapse here).
      this.documentPagination.page = 1;
      if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = setTimeout(() => {
        this.searchDebounceTimer = null;
        this.loadDocuments();
      }, 250);
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

    // Crawl→OKF wizard hand-off relay (review !622 round 10, #78745): the
    // crawl dialogs dispatch okf:create-from-crawl while the DOCUMENTS area
    // is on screen, but the wizard listener lives in StudioTab — mounted only
    // under the studio tab, so the event fired into the void. Relay it
    // through the same switch-tab → nextTick dance
    // onCreateOkfRepoFromSelection uses.
    window.addEventListener('okf:create-from-crawl', this.relayCreateFromCrawl);
  },
  beforeUnmount() {
    // Clean up event listeners when component is destroyed
    window.removeEventListener('themeChange', this.handleThemeChange);
    window.removeEventListener('okf:create-from-crawl', this.relayCreateFromCrawl);
    // Cancel any in-flight search debounce so a timer firing after the
    // component unmounts doesn't call loadDocuments() on a destroyed
    // Vue instance (Vue 'target is readonly' warn + orphaned backend
    // request racing with the new view's data load).
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }
  },
  methods: {
    /**
     * Month-over-month delta for a tile, or null when the backend could
     * not compute one. `higherIsBetter` decides the colour: a rising error
     * rate is bad news and wears the danger colour, a rising uptime is
     * good news and wears the success one. The template previously
     * hardcoded "↑ 0.01%", "↑ 0.2%", "↓ 12%" and "↑ 15%" on all four
     * tiles, so every operator read a constant regardless of the data.
     */
    trend(key, higherIsBetter) {
      const value = this.trends[key];
      if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
      const delta = Number(value);
      return {
        arrow: delta > 0 ? '\u2191' : delta < 0 ? '\u2193' : '\u2192',
        value: `${Math.abs(delta).toFixed(2)}%`,
        className: delta === 0 || delta > 0 === higherIsBetter ? 'trend-up' : 'trend-down'
      };
    },

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
    translate(key, fallback = '', named = EMPTY_NAMED) {
      if (!this.$i18n) {
        // console.warn(`[AdminDashboard] $i18n not available. Using fallback for: ${key}`);
        return interpolateFallback(key, fallback, named);
      }
      try {
        // vue-i18n's legacy t() takes the locale as a STRING second argument;
        // an object there is parsed as named params and the locale never
        // reaches the translator, so `named` must be the third argument.
        const translation = this.$i18n.t(key, this.currentLocale, named);
        // Return the interpolated fallback if the key is returned (no translation found)
        if (translation === key) {
          // console.warn(`[AdminDashboard] No translation for key: ${key}. Using fallback.`);
          return interpolateFallback(key, fallback, named);
        }
        return translation;
      } catch (e) {
        console.error(`[AdminDashboard] Translation error for key ${key}:`, e);
        return interpolateFallback(key, fallback, named);
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

    // Apply theme
    applyTheme(theme) {
      // PERSIST ALWAYS (round 18, #80483): localStorage 'theme' — the only
      // copy ThemeManager reads at boot — has exactly one writer: this
      // method. The old same-theme early return (an echo-recursion guard)
      // also skipped the MOUNT-time call, so a boot where the DOM indicator
      // was set but storage was empty/cleared never persisted, and the next
      // boot reverted to light even though the user had chosen dark. Echo
      // protection now lives in handleThemeChange (the actual re-entry
      // point); setTheme itself is idempotent.

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
        // ECHO GUARD (stack-overflow fix 2026-09-09, moved here round 18
        // #80483): themeManager.setTheme dispatches 'themeChange', which
        // re-enters here. Dropping the echo — the same theme we just
        // applied — breaks the cycle after exactly one bounce, while
        // applyTheme stays free to persist at mount.
        if (event.detail.theme === this.currentTheme) return;
        this.applyTheme(event.detail.theme);
      }
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
          this.healthLoadError = false;
          // Update metrics
          this.metrics = {
            systemUptime: data.metrics.systemUptime,
            avgResponseTime: data.metrics.avgResponseTime,
            errorRate: data.metrics.errorRate,
            monthlyActiveUsers: data.metrics.monthlyActiveUsers
          };

          this.trends = {
            uptime: data.trends?.uptime ?? null,
            responseTime: data.trends?.responseTime ?? null,
            errorRate: data.trends?.errorRate ?? null,
            activeUsers: data.trends?.activeUsers ?? null
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
          // A response without a metrics object is a failed load too —
          // treat it exactly like a rejection (review H1).
          this.healthLoadError = true;
          this.resetHealthSurfaces();
          this.showNotification(
            this.translate('admin.health.parseFailed', 'Failed to parse system health data'),
            'error'
          );
        }
      } catch (error) {
        console.error('Error loading system health:', error);
        // REVIEW H1: a failed fetch must not leave the previous success — or
        // the fabricated boot defaults — on the board. Null everything: the
        // tiles go to dashes and the cards to their error states with a
        // retry affordance.
        this.healthLoadError = true;
        this.resetHealthSurfaces();
        this.showNotification(this.translate('admin.health.loadFailed', 'Failed to load system health data'), 'error');
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

        // Backend envelope is `{logs: [...], total, limit, offset}` — the
        // previous `response.data.data.logs` path was reading `undefined`
        // and silently emptying the panel. Access the envelope directly.
        if (response && response.data && Array.isArray(response.data.logs)) {
          this.logs = response.data.logs;
        } else {
          this.logs = [];
        }
      } catch (error) {
        console.error('Error loading logs:', error);
        this.showNotification(this.translate('admin.logsLoadFailed', 'Failed to load logs'), 'error');
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
          // The summary covers ERROR and WARN only — INFO is deliberately
          // not queried (see LogsService.getLogsSummary), so "empty" means
          // "no errors or warnings", never "no logs at all". Saying
          // "no logs found" here claimed the whole log pipeline was dead
          // on any day without an error or a warning, which is a normal
          // day, and invited an operator to restart a healthy stack.
          if (this.errorLogsSummary.length === 0 && this.warningLogsSummary.length === 0) {
            this.showNotification(this.translate('admin.noErrorsOrWarnings', 'No errors or warnings today'), 'info');
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
          // Branch on `data.skipped` — VL mode returns `{skipped: true,
          // reason: 'vl_mode_no_file_scan'}` because the file-source
          // pipeline is gone (admin-logs/T8). Without this branch the
          // UI shows a green 'Security scan completed successfully' toast
          // for a scan that never actually ran — silent mis-attribution.
          if (response.data && response.data.skipped) {
            this.showNotification(
              this.translate(
                'admin.operations.runSecurityScan.skipped',
                `Security scan skipped: ${response.data.reason || 'no file source available'} — review via VL LogSQL instead.`
              ),
              'warning'
            );
            return;
          }
          // loadSecurityDetails REPORTS its outcome as a boolean — branch on
          // the return, not by polling the securityDetailsError side-effect
          // flag (review pass-3: the flag is the loader's own contract; a
          // future reset-at-load refactor would silently revive the
          // fabricated clean bill if this method inferred failure from it).
          const refreshed = await this.loadSecurityDetails();
          if (!refreshed) {
            // REVIEW round-2 F1: the scan ran server-side but its results
            // never landed — surface the error state; do NOT stamp a
            // fabricated "Just now" clean bill over the failed refresh.
            this.securityMetricsError = true;
            this.securityMetrics = null;
            this.showNotification(
              this.translate(
                'admin.operations.runSecurityScan.refreshFailed',
                'The scan completed, but refreshing its results failed'
              ),
              'error'
            );
            return;
          }
          // REVIEW H2: the tile update used to write `lastScan` — the loader's
          // key is `lastSecurityScan`, so the write landed on a dead field and
          // the visible value never moved. Rebuild the tile WHOLESALE from the
          // fresh details (a successful loadSecurityDetails guarantees non-null
          // array-normalized buckets): the previous two-path update refreshed
          // only lastSecurityScan + vulnerabilities, leaving the
          // failedLoginAttempts/suspiciousActivities counts stale.
          this.securityMetricsError = false;
          this.securityMetrics = {
            failedLoginAttempts: this.securityDetails.failedLoginDetails.length,
            suspiciousActivities: this.securityDetails.suspiciousDetails.length,
            lastSecurityScan: this.translate('admin.security.lastScanJustNow', 'Just now'),
            vulnerabilities: {
              critical: this.securityDetails.vulnerabilityDetails.critical.length,
              medium: this.securityDetails.vulnerabilityDetails.medium.length,
              low: this.securityDetails.vulnerabilityDetails.low.length
            }
          };
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

      // Load log summaries if they haven't been loaded yet
      if (this.activeTab === 'logs' && !this.errorLogsSummary.length && !this.warningLogsSummary.length) {
        this.loadLogsSummary();
      }
    },

    // Handle search results from the LogSearchDialog component. The second
    // argument is the dialog's searchError — a failed search must not toast
    // "No logs matched" (review H5 round 2: the empty payload used to read
    // as a clean no-hit while the dialog showed its error panel).
    handleSearchResults(results, searchError) {
      // Store the search results
      this.searchResults = results;

      // Notify the user about the results
      if (searchError) {
        this.showNotification(
          `${this.translate('admin.logsSection.logSearch.searchFailed', 'The log search failed')}: ${searchError}`,
          'error'
        );
      } else if (results.length === 0) {
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

    // Load security metrics
    async loadSecurityMetrics() {
      try {
        this.isLoading = true;
        this.securityLoading = true;
        const response = await adminDashboardService.getSecurityMetrics();
        if (response && response.data) {
          this.securityMetricsError = false;
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
        } else {
          // REVIEW pass-3 (altitude): the sibling loaders treat a shape-break
          // as a failure (loadSystemHealth's else, loadDatabaseStats's throw).
          // Here an envelope without data (e.g. the raw {success:false} body)
          // silently no-op'd — a blank card with neither error nor retry.
          this.securityMetricsError = true;
          this.securityMetrics = null;
        }
      } catch (error) {
        console.error('[AdminDashboard] Error loading security metrics:', error);
        // REVIEW H2: the catch used to install the all-zero clean bill —
        // "Never scanned, no vulnerabilities" — so a failed fetch read as a
        // secure system. Null it out and surface the error state instead.
        this.securityMetricsError = true;
        this.securityMetrics = null;
      } finally {
        this.isLoading = false;
        this.securityLoading = false;
      }
    },

    /**
     * Retry the security surfaces after an error state (review H2). The
     * flags are NOT pre-cleared here: the loading state takes over while the
     * fetch runs, and only a success clears the error flags — clearing them
     * up-front would blank the error card before anything better exists.
     * The metrics loader chains the details loader on success, so one call
     * re-populates both.
     */
    async retrySecurity() {
      // Retry the fetch that actually fired (review pass-3, efficiency): a
      // details-only failure must not pay a redundant metrics round-trip;
      // a metrics failure chains the details reload itself. Flags are not
      // pre-cleared — the loaders own them, so a retry that fails again
      // stays in the error state.
      if (this.securityMetricsError) {
        await this.loadSecurityMetrics();
      } else {
        await this.loadSecurityDetails();
      }
    },

    // REVIEW round-4: the /admin/security-metrics route stamps
    // lastSecurityScan as a raw ISO string (new Date().toISOString()) and
    // the tile rendered it verbatim. Human strings ('Never', the post-scan
    // 'Just now', the mock's '1 hour ago') pass through unchanged; a
    // parseable timestamp renders localized.
    formatScanStamp(value) {
      if (typeof value !== 'string' || value === '') return value;
      if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return value;
      const t = Date.parse(value);
      if (Number.isNaN(t)) return value;
      return new Date(t).toLocaleString(this.currentLocale);
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

    // REVIEW round-2 F7: one reset, two failure paths (payload-shape and
    // rejection) — drift between copies is how a stale or fabricated
    // surface survives a failed load.
    resetHealthSurfaces() {
      this.metrics = blankMetrics();
      this.trends = blankTrends();
      this.healthServices = null;
      this.resourceUsage = null;
    },

    // Load database statistics
    async loadDatabaseStats() {
      try {
        const response = await databaseOperationsService.getDatabaseStats();
        const payload = response && response.data;
        // Figure-less payload: this client (databaseOperationsService
        // .getDatabaseStats) rejects when the backend throws — a 200 payload
        // without figures is a contract break, not a state to render.
        if (!payload || payload.databaseSize === undefined) {
          throw new Error('Database stats payload had no figures');
        }
        this.dbStats = payload;
        this.dbStatsError = false;
      } catch (error) {
        console.error('Error loading database stats:', error);
        // REVIEW H3: the failure used to be swallowed with a log line,
        // leaving the hardcoded "42.3 GB / 128 tables" on the board.
        this.dbStatsError = true;
        this.dbStats = null;
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
        this.showNotification(
          this.translate('admin.userManagementSection.userSearch.error', 'Error searching users'),
          'error'
        );
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
     * Parses a single JSON-encoded log line to extract the log level.
     * Uses JSON.parse with try/catch; malformed input, arrays, primitives, and
     * objects missing `level` or `message` fall back to UNKNOWN with the raw payload.
     * @param {string} logString - The raw log line (expected JSON with `level` + `message` keys).
     * @returns {{type: string, message: string}} `type` is the upper-cased `level` (or 'UNKNOWN');
     *   `message` is the original `message` field, or the raw input when no parseable message exists.
     */
    parseLogMessage(logString) {
      if (typeof logString !== 'string') {
        return { type: 'UNKNOWN', message: String(logString) };
      }
      // JSON envelope FIRST — Winston / python-json-logger produce
      // `{"level":"ERROR","message":"…"}` envelopes. Parsing these lets
      // us surface the inner message text rather than the raw envelope
      // shape. The previous implementation tried JSON first too; the
      // regex fallback below handles the non-JSON paths (Winston npm
      // format `[INFO]: …`, console-format `… INFO …`) that would
      // otherwise land on the catch branch as UNKNOWN.
      if (logString.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(logString);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const level =
              typeof parsed.level === 'string' && parsed.level !== '' ? parsed.level.toUpperCase() : 'UNKNOWN';
            const message = typeof parsed.message === 'string' && parsed.message !== '' ? parsed.message : logString;
            return { type: level, message };
          }
        } catch {
          // Malformed JSON envelope — fall through to regex on the raw
          // string. The level keywords `INFO`, `ERROR`, etc. may still
          // appear in the raw bytes.
        }
      }
      // Regex fallback for non-JSON console-format log strings.
      const formatMatch = logString.match(/(?:\[(\w+)\][:\s]*|.*?\b(INFO|WARN|WARNING|ERROR|DEBUG|TRACE|FATAL)\b)/);
      if (formatMatch) {
        const raw = (formatMatch[1] || formatMatch[2] || '').toUpperCase();
        // Map WARNING → WARN to align with the canonical log level
        // used by VL severity_text (mirrors backend `_normalizeLevelFilter`).
        const level = raw === 'WARNING' ? 'WARN' : raw;
        if (level) {
          return { type: level, message: logString };
        }
      }
      return { type: 'UNKNOWN', message: logString };
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

        // REVISED: Define a helper to map and parse log details.
        // Backend (`security-scan-service.js`) emits { timestamp, level, message };
        // prefer `log.level` when present so the structured level reaches the UI table,
        // and fall back to parsing `log.message` for legacy/printf payloads.
        const mapAndParseLogDetail = (log) => {
          if (log && typeof log.level === 'string' && log.level !== '') {
            return {
              timestamp: log.timestamp || '',
              type: log.level.toUpperCase(),
              message: typeof log.message === 'string' ? log.message : ''
            };
          }
          const message = log && typeof log.message === 'string' ? log.message : '';
          const parsed = this.parseLogMessage(message);
          return {
            timestamp: (log && log.timestamp) || '',
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
          patternMatches: Array.isArray(response.patternMatches)
            ? response.patternMatches.map((m) => ({
                type: m.type,
                pattern: m.pattern,
                occurrences: m.occurrences,
                sample: m.sample || '',
                sampleTimestamp: m.sampleTimestamp || '',
                service: m.service,
                lastSeen: m.lastSeen
              }))
            : [],
          failedLoginDetails: Array.isArray(response.failedLoginDetails)
            ? response.failedLoginDetails.map(mapAndParseLogDetail)
            : [],
          suspiciousDetails: Array.isArray(response.suspiciousDetails)
            ? response.suspiciousDetails.map(mapAndParseLogDetail)
            : []
        };
        this.securityDetailsError = false;
        // REVIEW pass-3: report the outcome as the return value — callers
        // (runSecurityScan) branch on it rather than polling the flag.
        return true;
      } catch (error) {
        console.error('[AdminDashboard] Error loading security details:', error);
        // REVIEW H2: the catch used to install the all-empty "clean bill" —
        // the exact shape the template renders as "No Vulnerabilities Found /
        // Your system appears to be secure". A failed fetch is an error
        // state, not a security verdict.
        this.securityDetailsError = true;
        this.securityDetails = null;
        return false;
      } finally {
        this.isLoading = false;
      }
    },

    async loadKnowledgeHierarchy() {
      this.isHierarchyLoading = true;
      try {
        // Using the serviceTreeService to fetch data
        const categories = await serviceTreeService.getAdminCategories('en');
        // Adapt the admin tree onto the editor rows. nameEN comes from the
        // payload — the wire spelling the tree publishes; `translations` is
        // fetched per item when the edit form opens. The fallback to `name`
        // covers a tree that predates the field: the panel is fetched in
        // English, so the payload's `name` IS the English translation
        // there — the same fallback the mobile collector makes for the
        // same deploy window.
        this.knowledgeHierarchy = categories.map((cat) => ({
          _key: cat.catKey,
          nameEN: cat.nameEN ?? cat.name,
          translations: [],
          services: (cat.children || []).map((service) => ({
            _key: service._key,
            nameEN: service.nameEN ?? service.name,
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

    // An in-flight edit-form translation fetch belongs to the form
    // generation that started it. A form opened or closed afterwards must
    // never receive that fetch's rows, its failure flag, or its loading
    // state — invalidate the generation, and drop the flag and spinner
    // this form context owns.
    invalidateTranslationsFetch() {
      this.hierarchyTranslationsSeq++;
      this.isTranslationsLoading = false;
      this.translationsLoadFailed = false;
    },

    showAddCategoryForm() {
      this.invalidateTranslationsFetch();
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
      this.invalidateTranslationsFetch();
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
      this.invalidateTranslationsFetch();
      await this.loadHierarchyTranslations(isCategory, item._key);
    },

    // The edit form's translation fetch, owned by the CURRENT form
    // generation: populates the rows on success, or parks the form in the
    // failed-load state (#1400). A superseded fetch (a newer showEditForm
    // or a close) may neither populate, flag, nor unblock the newer form.
    async loadHierarchyTranslations(isCategory, itemKey) {
      this.isTranslationsLoading = true;
      const loadSeq = this.hierarchyTranslationsSeq;
      try {
        let fetchedTranslations = [];
        if (isCategory) {
          // Call the service method for categories
          fetchedTranslations = await serviceTreeService.getCategoryTranslations(itemKey);
        } else {
          // Call the service method for services
          fetchedTranslations = await serviceTreeService.getServiceTranslations(itemKey);
        }

        // A newer showEditForm superseded this fetch: neither its rows nor
        // its failure belong to the form now open.
        if (loadSeq !== this.hierarchyTranslationsSeq) {
          return;
        }

        // Filter out the English ('en') translation from the results
        const filteredTranslations = fetchedTranslations.filter((t) => t.lang !== 'en');

        // Populate the form with the filtered data. Replace, never append:
        // a Retry re-populates a form that already carries rows (the failed
        // load pushed a placeholder), and an empty successful fetch must
        // yield exactly one placeholder row to start from.
        this.hierarchyForm.translations =
          filteredTranslations.length > 0 ? filteredTranslations : [{ lang: '', text: '' }];

        // Store the initial state for the unsaved changes check
        this.originalHierarchyFormState = JSON.stringify(this.hierarchyForm);
      } catch {
        // The same staleness rule: a superseded fetch must not block the
        // newer edit's save.
        if (loadSeq !== this.hierarchyTranslationsSeq) {
          return;
        }
        // The service layer rethrows failed translation loads (a silent []
        // here would render an editable empty-rows form whose next save
        // wipes every existing translation). The form stays open but the
        // save is blocked until the load succeeds.
        this.translationsLoadFailed = true;
        this.showNotification(
          this.translate('admin.hierarchy.loadTranslationsError', 'Failed to load translations.'),
          'error'
        );
        // Ensure there's at least one empty row on error
        if (this.hierarchyForm.translations.length === 0) {
          this.hierarchyForm.translations.push({ lang: '', text: '' });
        }
        // Snapshot the failed-load state too: the user can still edit the
        // form, and Cancel must warn about those edits like any other.
        this.originalHierarchyFormState = JSON.stringify(this.hierarchyForm);
      } finally {
        // Only the fetch the form currently waits on may clear the
        // loading state.
        if (loadSeq === this.hierarchyTranslationsSeq) {
          this.isTranslationsLoading = false;
        }
      }
    },

    // Retry a failed translation load (#1400) for the form currently open.
    // The reset is the one a fresh showEditForm gets: the failure flag and
    // the spinner state drop, and a new generation owns the new fetch.
    retryHierarchyTranslations() {
      if (!this.hierarchyForm.visible || !this.hierarchyForm._key) {
        return;
      }
      // Positive derivation, the same shape saveHierarchyItem dispatches by.
      const isCategory = this.hierarchyForm.mode === 'editCategory';
      this.invalidateTranslationsFetch();
      this.loadHierarchyTranslations(isCategory, this.hierarchyForm._key);
    },

    addTranslationRow() {
      this.hierarchyForm.translations.push({ lang: '', text: '' });
    },

    removeTranslationRow(index) {
      this.hierarchyForm.translations.splice(index, 1);
    },

    closeHierarchyForm() {
      this.hierarchyForm.visible = false;
      this.invalidateTranslationsFetch();
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
      // --- 0. LOAD GATE ---
      // The update path is delete-then-rebuild on the backend: a payload
      // whose rows came from a FAILED load (effectively []) would be read
      // as a deliberate clear-all. Creating is safe — nothing exists to
      // wipe — but an edit must not save until its translations loaded.
      const isEditMode = this.hierarchyForm.mode === 'editCategory' || this.hierarchyForm.mode === 'editService';
      if (isEditMode && this.translationsLoadFailed) {
        this.showNotification(
          this.translate('admin.hierarchy.translationsNotLoaded', 'Translations not loaded — reload before saving.'),
          'error'
        );
        return;
      }

      // --- 1. VALIDATION ---
      // Normalize rows once: only string lang/text survive (legacy docs can hold
      // nulls or numbers), trimmed, empties dropped. The service layer maps the
      // {lang, text} rows to the write contract.
      const rows = this.hierarchyForm.translations
        .map((t) => ({
          lang: typeof t?.lang === 'string' ? t.lang.trim() : '',
          text: typeof t?.text === 'string' ? t.text.trim() : ''
        }))
        .filter((r) => r.lang && r.text);
      const langCodes = rows.map((r) => r.lang.toLowerCase());

      // Check for duplicate languages (case-insensitive — the backend
      // uppercases the code, so 'fr' and 'FR' would collide on one row)
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
      // A legacy doc can hold a non-string nameEN; the empty string lets the backend answer its 400.
      const payload = {
        nameEN: typeof this.hierarchyForm.nameEN === 'string' ? this.hierarchyForm.nameEN.trim() : '',
        translations: rows
      };

      this.isLoading = true;
      this.isSavingHierarchyItem = true;
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
        } else {
          // An unknown mode must not report success: nothing was saved.
          console.error(`saveHierarchyItem: unknown form mode "${mode}"`);
          this.showNotification(this.translate('admin.hierarchy.saveError', 'Failed to save hierarchy item.'), 'error');
          return;
        }

        this.showNotification(
          // MODIFIED: Use new i18n key
          this.translate('admin.hierarchy.saveSuccess', 'Hierarchy item saved successfully.'),
          'success'
        );
        this.closeHierarchyForm(); // Close form on success

        // --- 4. REFRESH DATA ---
        // loadKnowledgeHierarchy handles its own errors (accurate load-error
        // toast), so a refresh failure never surfaces as a save failure.
        await this.loadKnowledgeHierarchy(); // Refresh the admin dashboard tree
        eventBus.$emit('knowledge-hierarchy-updated'); // Emit global event for other components
      } catch (error) {
        // httpService's interceptor already toasts the backend's rejection
        // reason for non-401 responses; this generic toast marks the failed
        // action in the dashboard context.
        this.showNotification(
          // MODIFIED: Use new i18n key
          this.translate('admin.hierarchy.saveError', 'Failed to save hierarchy item.'),
          'error'
        );
        console.error(error);
      } finally {
        this.isLoading = false;
        this.isSavingHierarchyItem = false;
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

      // The dataprep status → variant mapping is SHARED with the OKF
      // artifacts view (utils/documentStatus.js): two surfaces that disagree
      // about what "Ingested" looks like is the same class of lie this wave
      // exists to remove. The crawl arms above stay here — a different
      // vocabulary, which the artifacts view never has.
      return statusVariant(dataPrepStatus);
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

      // 3. Fallback to dataprep status or 'Unknown'.
      //
      // Translated, unlike the crawl arms above: this MR added a TRANSLATED
      // <option> for "Ingested with Warnings" to the filter a few lines up, so
      // leaving the badge in raw English put two languages on one screen for
      // the same value. The crawl statuses stay as they were — pre-existing,
      // and translating them belongs with their own keys rather than here.
      //
      // The dataprep status → catalogue leaf mapping is SHARED with the OKF
      // artifacts view (utils/documentStatus.js) — the two surfaces must not
      // disagree about what "Ingested" means. The crawl arms above stay
      // here: they are a different vocabulary, and the artifacts view never
      // has a crawl job.
      const status = doc.dataprep && doc.dataprep.status;
      const known = statusKey(status);
      // The English label — the catalogue's own fallback for a known status,
      // the raw status for an unknown one, 'Unknown' when there is no status.
      const label = displayStatus(status);
      return known ? this.translate(`admin.documents.${known}`, label) : label;
    },

    selectAllDocuments(event) {
      if (event.target.checked) {
        // MODIFICATION: Select based on _key, not file_id
        this.selectedDocuments = this.sortedAndFilteredDocuments.map((d) => d.file_id);
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
              // Call the service with the array of selected document keys.
              // Backend returns 207 Multi-Status with per-file results; surface them.
              const res = await documentFileService.ingestMultipleFiles(this.selectedDocuments);
              const successCount = res?.successCount ?? count;
              const failureCount = res?.failureCount ?? 0;
              const failed = (res?.results || []).filter((r) => !r.success);

              if (failureCount === 0) {
                this.showNotification(
                  this.translate(
                    'admin.documents.ingestQueuedSuccess',
                    `${successCount} file(s) have been queued for ingestion.`
                  ).replace('{count}', successCount),
                  'success'
                );
                this.selectedDocuments = [];
              } else if (successCount === 0) {
                const detail = failed.map((r) => r.error || 'unknown error').join('; ');
                this.showNotification(
                  this.translate('admin.documents.ingestAllFailed', `All {count} file(s) failed: {detail}`)
                    .replace('{count}', count)
                    .replace('{detail}', detail),
                  'error'
                );
                // Keep failed selections so the operator can retry
                this.selectedDocuments = failed.map((r) => r.fileId);
              } else {
                const detail = failed.map((r) => r.error || 'unknown error').join('; ');
                this.showNotification(
                  this.translate(
                    'admin.documents.ingestPartialFailure',
                    `{successCount} of {count} ingested. Failed: {detail}`
                  )
                    .replace('{successCount}', successCount)
                    .replace('{count}', count)
                    .replace('{detail}', detail),
                  'warning'
                );
                // Keep failed selections so the operator can retry
                this.selectedDocuments = failed.map((r) => r.fileId);
              }

              // Refresh the document list to show the updated statuses.
              // Isolated from the outer try/catch: a stale-token 401 on reload
              // must not override the success/partial toast we just set.
              try {
                await this.loadDocuments();
              } catch (reloadErr) {
                console.warn('Reload after ingest failed (toast already shown):', reloadErr);
              }
            } catch (error) {
              this.showNotification(
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
      } else if (action === 'retract') {
        const count = this.selectedDocuments.length;
        this.showConfirmDialog({
          title: this.translate('admin.documents.confirmRetractTitle', 'Confirm Batch Retraction'),
          message: this.translate(
            'admin.documents.confirmRetractSelected',
            `Are you sure you want to retract ${count} selected file(s)?`
          ).replace('{count}', count),
          confirmText: this.translate('admin.documents.retract', 'Retract'),
          cancelText: this.translate('common.cancel', 'Cancel'),
          onConfirm: async () => {
            this.isLoading = true;
            try {
              const res = await documentFileService.retractMultipleFiles(this.selectedDocuments);
              const successCount = res?.successCount ?? count;
              const failureCount = res?.failureCount ?? 0;
              const failed = (res?.results || []).filter((r) => !r.success);

              if (failureCount === 0) {
                this.showNotification(
                  this.translate(
                    'admin.documents.retractQueuedSuccess',
                    `${successCount} file(s) have been queued for retraction.`
                  ).replace('{count}', successCount),
                  'success'
                );
                this.selectedDocuments = [];
              } else if (successCount === 0) {
                const detail = failed.map((r) => r.error || 'unknown error').join('; ');
                this.showNotification(
                  this.translate('admin.documents.retractAllFailed', `All {count} file(s) failed: {detail}`)
                    .replace('{count}', count)
                    .replace('{detail}', detail),
                  'error'
                );
                this.selectedDocuments = failed.map((r) => r.fileId);
              } else {
                const detail = failed.map((r) => r.error || 'unknown error').join('; ');
                this.showNotification(
                  this.translate(
                    'admin.documents.retractPartialFailure',
                    `{successCount} of {count} retracted. Failed: {detail}`
                  )
                    .replace('{successCount}', successCount)
                    .replace('{count}', count)
                    .replace('{detail}', detail),
                  'warning'
                );
                this.selectedDocuments = failed.map((r) => r.fileId);
              }
              // Isolate reload from the outer catch (see ingest branch for rationale)
              try {
                await this.loadDocuments();
              } catch (reloadErr) {
                console.warn('Reload after retract failed (toast already shown):', reloadErr);
              }
            } catch (error) {
              this.showNotification(
                this.translate(
                  'admin.documents.retractQueuedError',
                  'An error occurred during the batch retraction process.'
                ),
                'error'
              );
              console.error('Batch retract error:', error);
            } finally {
              this.isLoading = false;
            }
          },
          onCancel: () => {
            // User canceled, do nothing
          }
        });
      } else if (action === 'delete') {
        // #1042 BATCH DELETE, AMENDED 2026-10-10 (live): a selection mixing
        // blocked rows (ingested/ingesting — they must be retracted first)
        // with clean rows now deletes the CLEAN subset and says exactly
        // what was skipped, instead of refusing the whole batch with a
        // tooltip-only signal. All-blocked still refuses outright.
        const blockedIds = new Set(this.blockedSelection.map((d) => d.file_id));
        const deletable = this.deletableSelection;
        if (this.deleteRefuseReason && !deletable.length) {
          // Nothing deletable — refuse clearly (the button is disabled too;
          // this is the belt-and-braces path).
          this.showNotification(this.deleteRefuseReason, 'error');
          return;
        }
        const count = deletable.length;
        this.showConfirmDialog({
          title: this.translate('admin.documents.confirmDeleteTitle', 'Confirm Batch Deletion'),
          message:
            this.translate(
              'admin.documents.confirmDeleteSelected',
              `Are you sure you want to permanently delete {count} file(s)? This cannot be undone.`
            ).replace('{count}', count) +
            (blockedIds.size
              ? ' ' +
                this.translate(
                  'admin.documents.confirmDeleteSkipped',
                  '{count} ingested/ingesting file(s) will be SKIPPED — retract them first to delete them.'
                ).replace('{count}', String(blockedIds.size))
              : ''),
          confirmText: this.translate('common.delete', 'Delete'),
          cancelText: this.translate('common.cancel', 'Cancel'),
          onConfirm: async () => {
            this.isLoading = true;
            try {
              // 2026-10-10: delete the CLEAN subset only — blocked rows stay
              // selected (their refusal reason is visible on the strip).
              const res = await documentFileService.deleteMultipleFiles(deletable);
              const results = (res && res.results) || [];
              const successCount = results.filter((r) => r.success).length;
              const failed = results.filter((r) => !r.success);
              const failureCount = failed.length;

              if (failureCount === 0) {
                this.showNotification(
                  this.translate('admin.documents.deleteQueuedSuccess', '{count} file(s) deleted.').replace(
                    '{count}',
                    String(successCount)
                  ),
                  'success'
                );
                // Keep the blocked rows selected (they were NOT deleted);
                // drop everything else.
                this.selectedDocuments = [...blockedIds];
              } else if (successCount === 0) {
                const detail = failed.map((r) => r.error || 'unknown error').join('; ');
                this.showNotification(
                  this.translate('admin.documents.deleteAllFailed', 'All {count} file(s) failed: {detail}')
                    .replace('{count}', String(count))
                    .replace('{detail}', detail),
                  'error'
                );
                this.selectedDocuments = [...new Set([...failed.map((r) => r.fileId), ...blockedIds])];
              } else {
                const detail = failed.map((r) => r.error || 'unknown error').join('; ');
                this.showNotification(
                  this.translate(
                    'admin.documents.deletePartialFailure',
                    '{successCount} of {count} deleted. Failed: {detail}'
                  )
                    .replace('{successCount}', String(successCount))
                    .replace('{count}', String(count))
                    .replace('{detail}', detail),
                  'warning'
                );
                this.selectedDocuments = [...new Set([...failed.map((r) => r.fileId), ...blockedIds])];
              }
              try {
                await this.loadDocuments();
              } catch (reloadErr) {
                console.warn('Reload after delete failed (toast already shown):', reloadErr);
              }
            } catch (error) {
              // BUNDLE_PROTECTED surfaces server-side as 403 — surface the
              // verbatim backend message so the steward knows the cause.
              // httpService rejects with the PARSED envelope {status,
              // statusText, data, message} — there is no `.response` on it
              // (round 16, #80118: the axios-shape read left this branch
              // dead and the steward got the generic error).
              const code = error && error.data && (error.data.code || error.data.error);
              const msg =
                (error && error.data && (error.data.message || error.data.error)) ||
                (error && error.message) ||
                'unknown error';
              this.showNotification(
                code === 'BUNDLE_PROTECTED'
                  ? msg
                  : this.translate(
                      'admin.documents.deleteQueuedError',
                      'An error occurred during the batch deletion process.'
                    ),
                'error'
              );
              console.error('Batch delete error:', error);
            } finally {
              this.isLoading = false;
            }
          },
          onCancel: () => {
            // User canceled, do nothing
          }
        });
      }
      // You can add 'else if' blocks for other actions like 'delete' here
    },

    /**
     * Story 3-6 entry point, per Amendment A decision #5 (David, 2026-09-27):
     * "Create OKF repository" routes INTO THE WIZARD — the selection is
     * preloaded into okf/selection.documents, the studio tab opens, and
     * StudioTab seeds the wizard draft from the selection (Entry names the
     * repo, Choose shows Documents preselected, Input carries the pick into
     * Produce's conversion). The 7.7 import dialog path is retired here —
     * one documents→repo path, the wizard.
     */
    /** Crawl→OKF hand-off relay (#78745): switch to the studio tab, wait the
     * tick that lets StudioTab mount its wizard listener, then re-dispatch
     * the event flagged so this relay never re-catches its own send.
     * RELAY-MARKED ONLY (round 17, #80354): the AddFromLinkDialog still
     * fires the LEGACY seed event — "pre-fill an already-open wizard,
     * harmless no-op otherwise" per its own comment. Relaying that event
     * teleported the steward out of Document Management into the 10-step
     * wizard on every multi-page crawl, the opposite of harmless. Only
     * events that carry the relay marker (or an explicit __wantsStudio
     * flag) switch tabs; the legacy event stays a no-op. */
    // ── STUDIO HAND-OFF DISPATCH (round 18, #80478) ────────────────────────
    // OkfStudioTab is a defineAsyncComponent, and its pane mounts under
    // v-if — on the FIRST activation of a session the chunk is not cached,
    // so one $nextTick resolves before the component mounts and a dispatch
    // fired there reaches zero listeners (selection lands in the store, the
    // wizard never opens). StudioTab emits 'studio-ready' from mounted()
    // once its listeners are registered; until then dispatches queue here
    // and drain on that signal. A queued event is deferred, never lost.
    dispatchWhenStudioReady(fire) {
      // Ref present = the async component resolved AND mounted = listeners live.
      if (this.$refs.okfStudioTab) fire();
      else this.pendingStudioEvents.push(fire);
    },
    flushPendingStudioEvents() {
      const queued = this.pendingStudioEvents;
      this.pendingStudioEvents = [];
      queued.forEach((fire) => fire());
    },
    async relayCreateFromCrawl(event) {
      if (event && event.__okfRelayed) return;
      // RELAY INTENT ONLY (#80466): a sender that wants the tab switch flags
      // it (__wantsStudio). FileDetailsDialog's
      // hand-off sets it; anything else is the legacy pre-fill
      // event — StudioTab's already-open listener handles it or nobody does.
      if (!event || !event.__wantsStudio) return;
      // Flag guard (round 16, #80125): the relay is registered
      // unconditionally, but with the flag parked the Studio pane's target
      // module is not registered — switching the tab there renders a dead
      // pane. Today every SENDER happens to be gated, but the relay must
      // carry its own guard; the protection must not depend on the callers.
      if (!isOkfEnabled()) return;
      const detail = (event && event.detail) || {};
      this.activeTab = 'studio';
      this.dispatchWhenStudioReady(() => {
        const relayed = new CustomEvent('okf:create-from-crawl', { detail });
        relayed.__okfRelayed = true;
        window.dispatchEvent(relayed);
      });
    },
    async onCreateOkfRepoFromSelection() {
      if (!this.okfRepoGate.visible) return;
      // file_id, not the Arango _key — the selection holds file_id's and the
      // studio's Produce leg routes conversions by file_id (review !622 wave 2,
      // #78640: matching/mapping _key silently emptied the wizard's draft).
      const keys = new Set(this.selectedDocuments);
      const docs = this.documents.filter((doc) => keys.has(doc.file_id));
      this.$store.commit('okf/setSelection', {
        documents: docs.map((d) => ({ file_id: d.file_id, file_name: d.file_name }))
      });
      this.selectedDocuments = [];
      this.activeTab = 'studio';
      // Deferred via the ready handshake — see dispatchWhenStudioReady.
      this.dispatchWhenStudioReady(() => {
        window.dispatchEvent(new CustomEvent('okf:create-from-documents'));
      });
    },
    /** Deep link (Story 7.7 provenance popup cards): ?tab=documents&file=<id>
     * opens the Document Management tab with the FileDetailsDialog — the SAME
     * details view used from the documents list. */
    applyRouteQuery(q) {
      if (!q) return;
      // Deep links may only land on tabs this deployment actually offers —
      // adminTabs is the flag-filtered rack, so a parked OKF flag also blocks
      // ?tab=studio / ?tab=models from reopening the OKF panes (review !622
      // wave 2, #78641: the raw assignment bypassed the flag entirely).
      if (q.tab && this.adminTabs.some((t) => t.value === q.tab)) {
        this.activeTab = q.tab;
      }
      // W6 / EPIC-6 / CAP-5: `?tab=documents&view=artifacts` selects the
      // ARTIFACTS view of the Document Management tab (the repository →
      // artifact direction: the VersionsDialog's "View artifact" link).
      // It is the `view` sibling of the `file` deep link — the same pattern,
      // one more parameter.
      if (q.tab === 'documents' && q.view === 'artifacts') {
        this.documentView = 'artifacts';
      }
      if (q.tab === 'documents' && q.file) {
        this.selectedFileId = q.file;
        this.showDetailsDialog = true;
        // One-shot deep link (David, 2026-09-14): scrub `file` from the URL
        // immediately, so refreshing the app does NOT re-open the dialog —
        // the dialog opening is a click-navigation effect, not URL state.
        if (this.$router) {
          const rest = Object.assign({}, q);
          delete rest.file;
          this.$router.replace({ query: rest }).catch(() => {});
        }
      }
      // W6 / EPIC-6 / CAP-5: the artifact → repository direction.
      // `?tab=studio&repo=<repo_id>` opens the OKF Studio at that repository
      // — the same resume path the repository cards use. It reuses the
      // `?tab=…&file=` deep-link pattern (the sibling param, same handler,
      // same route) rather than inventing a second navigation mechanism.
      // The `repo` param is NOT scrubbed: it names a NAVIGATION TARGET, not
      // a click effect — the same treatment `?tab=studio` gets.
      if (q.tab === 'studio' && q.repo && this.adminTabs.some((t) => t.value === 'studio')) {
        this.activeTab = 'studio';
        // The Studio pane is an async component behind v-if: on the first
        // activation of a session the ref is not there yet, so the resume is
        // deferred through the ready handshake (the same mechanism the
        // crawl→OKF relay uses) and NEVER dropped.
        this.dispatchWhenStudioReady(() => {
          const studio = this.$refs.okfStudioTab;
          if (studio && typeof studio.onResume === 'function') studio.onResume(q.repo);
        });
      }
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
          limit: this.documentPagination.limit,
          // W6 / EPIC-6 / CAP-5: the OKF bundle zips are the per-version
          // INGESTION ARTIFACTS of the published repositories — not documents
          // a steward uploaded. They have their own labeled view (the
          // Artifacts view), and leaving them in this list is what made them
          // look like documents AND put a Delete affordance on a row the
          // server refuses (WS2 → 403 BUNDLE_PROTECTED).
          // The backend's filter is `is_bundle == false OR is_bundle == null`,
          // so every document uploaded before the stamp existed stays.
          is_bundle: false
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

/* 2026-10-10: the batch-delete refusal is a VISIBLE strip, not a tooltip
   on a disabled button (the live "it failed" report). */
.delete-refuse-strip {
  align-self: center;
  max-width: 40rem;
  /* UX-2 (#1513): --text-secondary died with the pre-OKLch theme; the
     strip has been rendering in inherited ink since the migration. */
  color: var(--muted);
  font-size: var(--text-xs);
}

/* Modal backdrop */
.admin-page {
  height: 100%;
  overflow: hidden;
  background: var(--bg);
  display: flex;
}

/* Admin dashboard container.
   UX-2 (#1513): the page sits on --bg like every other page in the app
   (theme-components paints .content-area/--bg), so the --surface cards
   and the tab rack read by fill instead of floating as same-colour
   slabs separated only by their 1px borders — the pre-theme look this
   pass retires. Pure paint; no layout or behaviour change. */
.admin-dashboard {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: var(--bg);
}

/* Close button */
.close-dashboard-btn {
  position: absolute;
  top: 8px; /* Move it higher into the top bar */
  right: 16px; /* Position closer to the right edge */
  z-index: 1100;
  /* Other styles handled by DsButton */
}

/* Main layout grid — UX-1 (#1512): the sidebar column is gone; the rack row
   carries the whole navigation and every tab owns the full width. */
.dashboard {
  display: grid;
  grid-template-columns: 1fr;
  height: calc(100vh - 60px);
  overflow: hidden;
}

/* Rack tab content (UX-1): icon + label inside the DsTabs button slot. */
.admin-tab {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  white-space: nowrap;
}

.admin-tab__icon {
  font-size: var(--text-sm);
  line-height: 1;
}

/* UX-1: ten icon+label tabs must WRAP on narrow windows, not overflow —
   the rack is now the only nav surface. Scoped :deep into this usage of
   the DS primitive only. */
.tabs-card :deep(.ds-tabs__nav) {
  flex-wrap: wrap;
}

/* Main Content */
.main {
  padding: var(--space-lg);
  /* UX-2 (#1513): page ground, not panel ground — the --surface cards
     inside read by fill against it. */
  background-color: var(--bg);
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
  min-width: 1.8rem;
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

/* UX-2 (#1513): the DS selected-state vocabulary is a soft accent fill
   with accent ink (Pill, Table selected rows, Stepper, ModeSwitch) —
   the solid-accent slab is the pre-theme pattern. */
.page-btn.active {
  background-color: var(--accent-muted);
  color: var(--accent);
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

.empty-logs {
  text-align: center;
  color: var(--muted-soft);
  padding: var(--space-md);
}

/* Update search bar for better spacing with button */
.search-bar {
  display: flex;
  flex-wrap: wrap;
  margin-bottom: var(--space-md);
  gap: var(--space-md);
  align-items: center;
}

.search-input-container {
  position: relative;
  flex: 1 1 220px;
  min-width: 0;
}

/* Position the magnifier icon inside the field so it never displaces the input */
.search-icon {
  position: absolute;
  left: var(--space-sm);
  top: 50%;
  transform: translateY(-50%);
  width: 14px;
  height: 14px;
  color: var(--muted);
  pointer-events: none;
}

/* Reserve room for the icon so typed text doesn't run under it */
.search-input-container .search-input {
  padding-left: calc(var(--space-sm) * 2 + 14px);
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
/* Pattern matches carry no severity, so the dot is a neutral marker
   rather than one of the severity colours. Every other section in the
   panel opens with a dot; omitting it read as a rendering fault, and
   colouring it would re-assert the claim the backend just withdrew.
   The palette has no "no-severity" grey, so this is the same neutral
   the low indicator uses — the difference is the class name, which is
   what the template and the tests key on. */
.severity-indicator.neutral {
  background-color: var(--muted-soft);
}

/* Pattern matches are deliberately unstyled by severity: the scan
   cannot tell a config line from an attack, so the card shows the raw
   log line and stays neutral. Colouring it would re-assert the claim
   the backend just stopped making. */
/* `.section-title` is a flex row, so the note needs `flex-basis: 100%`
   to drop onto its own line — `display: block` alone does nothing to a
   flex item. */
.pattern-match-note {
  flex-basis: 100%;
  margin-left: 0;
  margin-top: var(--space-xs);
  font-size: var(--text-xs);
  font-weight: 400;
  color: var(--muted);
}

.pattern-match-card {
  padding: var(--space-md);
  /* UX-2 (#1513): --bg-secondary died with the pre-OKLch theme — the card
     has painted itself transparent (invisible on the panel) since the
     migration. --bg-tertiary is the same role in the current token set,
     and what the sibling .pattern-match-sample already uses. */
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-left: 3px solid var(--muted-soft);
  border-radius: var(--radius-sm);
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  overflow-wrap: anywhere;
}

.pattern-match-count {
  color: var(--muted);
}

.pattern-match-sample {
  display: block;
  margin-top: var(--space-xs);
  padding: var(--space-sm);
  background-color: var(--bg-tertiary);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono, monospace);
  font-size: var(--text-xs);
  color: var(--muted);
  white-space: pre-wrap;
  word-break: break-word;
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
  flex-wrap: wrap;
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
