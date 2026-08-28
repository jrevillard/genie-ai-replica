<template>
  <Teleport to="body">
    <div class="dialog-backdrop" data-test-id="dialog-backdrop" @click="$emit('close')"></div>
    <div class="dialog-container">
      <DsSpinner v-if="isLoading || isFetchingData || isDownloading" overlay size="lg">
        <span v-if="!isDownloading">{{ translate('details.loading', 'Loading File Details...') }}</span>

        <template v-else>
          <span>{{ translate('details.downloading', 'Downloading...') }} {{ downloadMessage }}</span>

          <div class="progress-track">
            <div class="progress-fill" :style="{ width: downloadProgress + '%' }"></div>
          </div>
        </template>
      </DsSpinner>

      <template v-if="!isLoading && !isFetchingData && file">
        <div class="dialog-header">
          <h2 class="dialog-title">
            {{ translate('details.title', 'File Details') }}
          </h2>
          <DsButton
            variant="ghost"
            class="dialog-close-btn"
            :aria-label="translate('details.close', 'Close')"
            @click="$emit('close')"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
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

        <DsTabs v-model="activeTab" :tabs="visibleTabs">
          <template #tab="{ tab }">
            <span v-if="tab.value === 'dashboard' && crawlJob?.status === 'Crawling'" class="live-dot"></span>
            {{ tab.label }}
          </template>

          <div v-if="activeTab === 'details'" class="tab-content tab-content-details">
            <div class="form-section">
              <div class="form-group">
                <label for="file-name">{{ translate('details.fileName', 'File Name') }}</label>
                <DsInput
                  id="file-name"
                  v-model="editableFile.file_name"
                  type="text"
                  class="form-input"
                  :disabled="!isMetadataEditable"
                  :class="{
                    'is-invalid': !editableFile.file_name.trim() && isMetadataEditable
                  }"
                />
              </div>
              <div class="form-group">
                <label for="author">{{ translate('details.author', 'Author') }}</label>
                <DsInput
                  id="author"
                  v-model="editableFile.author"
                  type="text"
                  class="form-input"
                  :disabled="!isMetadataEditable"
                  :class="{
                    'is-invalid': !editableFile.author.trim() && isMetadataEditable
                  }"
                />
              </div>
              <div class="form-group">
                <label>{{ translate('details.labels', 'Labels') }}</label>

                <div class="select-all-container">
                  <input
                    id="select-all-labels"
                    v-model="areAllLabelsSelected"
                    type="checkbox"
                    :disabled="!isMetadataEditable"
                  />
                  <label for="select-all-labels">{{ translate('details.selectAll', 'Select All') }}</label>
                </div>

                <div class="labels-container">
                  <div v-if="isHierarchyLoading" class="loading-state-small">
                    {{ translate('details.loadingLabels', 'Loading labels...') }}
                  </div>
                  <div v-for="category in knowledgeHierarchy" :key="category.catKey" class="label-category">
                    <strong>{{ category.name }}</strong>
                    <div v-for="service in category.children" :key="service._key" class="label-item">
                      <input
                        :id="'label-' + service._key"
                        v-model="editableFile.labels"
                        type="checkbox"
                        :value="service.name"
                        :disabled="!isMetadataEditable"
                      />
                      <label :for="'label-' + service._key">{{ service.name }}</label>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="info-section">
              <div class="info-item">
                <span class="info-label">{{ translate('details.status', 'Status') }}</span>
                <DsStatusTag :variant="getStatusVariant(displayStatus)">
                  {{ displayStatus }}
                </DsStatusTag>
              </div>
              <div class="info-item">
                <span class="info-label">{{ translate('details.fileId', 'File ID') }}</span>
                <span>{{ file.file_id }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">{{ translate('details.fileType', 'File Type') }}</span>
                <span>{{ file.file_type }}</span>
              </div>

              <div v-if="file.source_url" class="info-item">
                <span class="info-label">{{ translate('details.sourceUrl', 'Source URL') }}</span>
                <a :href="file.source_url" target="_blank" rel="noopener noreferrer" class="file-view-link">
                  {{ translate('details.visitSource', 'Visit Original Website') }}
                  <span class="external-icon">↗</span>
                </a>
              </div>

              <div v-if="canViewInternalFile" class="info-item">
                <span class="info-label">{{ translate('details.viewFile', 'Stored File') }}</span>
                <a href="#" class="file-view-link" @click.prevent="handleViewInternalFile">
                  {{
                    file.file_size > 20 * 1024 * 1024
                      ? translate('details.downloadFile', 'Download File')
                      : crawlJob
                        ? translate('details.viewCrawled', 'View Generated Markdown')
                        : translate('details.viewFileContent', 'View File')
                  }}
                  <span v-if="file.file_size > 20 * 1024 * 1024" class="external-icon">⭳</span>
                  <span v-else class="external-icon">↗</span>
                </a>
              </div>

              <div class="info-item">
                <span class="info-label">{{ translate('details.fileSize', 'File Size') }}</span>
                <span>{{ formatFileSize(file.file_size) }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">{{ translate('details.uploadDate', 'Upload Date') }}</span>
                <span>{{ new Date(file.upload_date).toLocaleString() }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">{{ translate('details.hash', 'SHA256 Hash') }}</span>
                <span class="info-hash">{{ file.file_hash }}</span>
              </div>
            </div>
          </div>

          <div v-if="activeTab === 'dashboard'" class="tab-content dashboard-tab">
            <div class="dashboard-controls">
              <div class="auto-refresh">
                <div class="toggle-wrapper">
                  <input id="auto-refresh-toggle" v-model="isAutoRefreshEnabled" type="checkbox" />
                  <label for="auto-refresh-toggle">Auto-refresh every</label>
                </div>
                <DsInput
                  v-model.number="dashboardRefreshInterval"
                  type="number"
                  min="1"
                  class="small-input"
                  :disabled="!isAutoRefreshEnabled"
                />
                <span class="text-sm">seconds</span>
              </div>
              <DsButton
                variant="secondary"
                :small="true"
                :disabled="isRefreshingDashboard"
                @click="refreshDashboardData"
              >
                <DsSpinner v-if="isRefreshingDashboard" size="sm" />
                Refresh Now
              </DsButton>
            </div>

            <div class="dashboard-grid">
              <div class="stat-card">
                <div class="stat-label">Crawl Rate</div>
                <div class="stat-value text-primary">
                  {{ crawlStats.crawlRate }}
                  <span class="unit">pgs/sec</span>
                </div>
              </div>

              <div class="stat-card">
                <div class="stat-label">Queue Size</div>
                <div class="stat-value">{{ crawlStats.queueSize }}</div>
              </div>

              <div class="stat-card" :class="{ 'bg-danger-light': crawlStats.errorRate > 5 }">
                <div class="stat-label">Error Rate</div>
                <div class="stat-value" :class="crawlStats.errorRate > 5 ? 'text-danger' : 'text-success'">
                  {{ crawlStats.errorRate }}%
                </div>
                <div class="stat-subtext">
                  <span class="err-badge" title="403 Forbidden">403: {{ crawlStats.errors['403'] || 0 }}</span>
                  <span class="err-badge" title="429 Rate Limit">429: {{ crawlStats.errors['429'] || 0 }}</span>
                </div>
              </div>
            </div>

            <div class="progress-section">
              <div class="progress-header">
                <span class="progress-label">Pages Processed</span>
                <span class="progress-fraction">{{ crawlStats.processed }} / {{ crawlStats.limit }}</span>
              </div>
              <div class="progress-bar-bg">
                <div class="progress-bar-fill" :style="{ width: dashboardProgressPercent + '%' }"></div>
              </div>
            </div>

            <div class="efficiency-grid">
              <div class="eff-item">
                <span class="eff-label">Depth</span>
                <span class="eff-val">{{ crawlStats.currentDepth }} / {{ crawlStats.maxDepth }}</span>
              </div>
              <div class="eff-item">
                <span class="eff-label">Internal Links</span>
                <span class="eff-val">{{ crawlStats.linksInternal }}</span>
              </div>
              <div class="eff-item">
                <span class="eff-label">External Links</span>
                <span class="eff-val">{{ crawlStats.linksExternal }}</span>
              </div>
              <div class="eff-item">
                <span class="eff-label">Total Fetched</span>
                <span class="eff-val">{{ crawlStats.totalCrawled }}</span>
              </div>
            </div>
          </div>

          <div v-if="activeTab === 'crawlLog'" class="tab-content crawl-log-tab">
            <div class="log-actions">
              <DsButton variant="secondary" :disabled="isCrawlLogLoading" @click="fetchCrawlLogs">
                <DsSpinner v-if="isCrawlLogLoading" size="sm" />
                {{
                  isCrawlLogLoading ? translate('common.loading', 'Loading...') : translate('common.refresh', 'Refresh')
                }}
              </DsButton>

              <DsButton v-if="crawlJob && crawlJob.status === 'Crawling'" variant="danger" @click="handleKillCrawl">
                {{ translate('details.log.killCrawl', 'Kill Crawl Task') }}
              </DsButton>
            </div>

            <div class="log-table-container">
              <table class="log-table">
                <thead>
                  <tr>
                    <th>
                      {{ translate('details.log.timestamp', 'Timestamp') }}
                    </th>
                    <th>{{ translate('details.log.level', 'Level') }}</th>
                    <th>{{ translate('details.log.stage', 'Stage') }}</th>
                    <th>{{ translate('details.log.message', 'Message') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="isCrawlLogLoading">
                    <td colspan="4" class="log-state">
                      {{ translate('details.log.loadingLogs', 'Loading logs...') }}
                    </td>
                  </tr>
                  <tr v-if="!isCrawlLogLoading && crawlLogs.length === 0">
                    <td colspan="4" class="log-state">
                      {{ translate('details.log.noLogs', 'No logs found.') }}
                    </td>
                  </tr>
                  <tr v-for="(log, index) in crawlLogs" :key="index">
                    <td data-label="Timestamp">
                      {{ new Date(log.timestamp).toLocaleString() }}
                    </td>
                    <td data-label="Level">
                      <span :class="['log-level', getLogLevelClass(log.level)]">{{ log.level }}</span>
                    </td>
                    <td data-label="Stage">{{ log.stage }}</td>
                    <td data-label="Message">{{ log.message }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div v-if="activeTab === 'ingestionLog'" class="tab-content ingestion-log-tab">
            <div class="log-actions">
              <DsButton variant="secondary" :disabled="isLogLoading" @click="fetchIngestionLogs">
                <DsSpinner v-if="isLogLoading" size="sm" />
                {{ isLogLoading ? translate('common.loading', 'Loading...') : translate('common.refresh', 'Refresh') }}
              </DsButton>
              <div class="kill-actions">
                <span class="kill-label">{{ translate('details.log.killActions', 'Kill Actions:') }}</span>
                <DsButton
                  variant="danger"
                  :disabled="file.dataprep.status?.toLowerCase() !== 'ingesting'"
                  @click="handleKillDocument"
                >
                  {{ translate('details.log.killDocument', 'Kill This Document') }}
                </DsButton>
              </div>
            </div>
            <div class="log-table-container">
              <table class="log-table">
                <thead>
                  <tr>
                    <th>
                      {{ translate('details.log.timestamp', 'Timestamp') }}
                    </th>
                    <th>{{ translate('details.log.level', 'Level') }}</th>
                    <th>{{ translate('details.log.stage', 'Stage') }}</th>
                    <th>{{ translate('details.log.message', 'Message') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="isLogLoading">
                    <td colspan="4" class="log-state">
                      {{ translate('details.log.loadingLogs', 'Loading logs...') }}
                    </td>
                  </tr>
                  <tr v-if="!isLogLoading && ingestionLogs.length === 0">
                    <td colspan="4" class="log-state">
                      {{ translate('details.log.noLogs', 'No logs found.') }}
                    </td>
                  </tr>
                  <tr v-for="(log, index) in ingestionLogs" :key="index">
                    <td data-label="Timestamp">
                      {{ new Date(log.timestamp).toLocaleString() }}
                    </td>
                    <td data-label="Level">
                      <span :class="['log-level', getLogLevelClass(log.level)]">{{ log.level }}</span>
                    </td>
                    <td data-label="Stage">{{ log.stage }}</td>
                    <td data-label="Message">{{ log.message }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </DsTabs>

        <div class="dialog-footer">
          <DsButton
            v-if="activeTab === 'dashboard' && crawlJob && crawlJob.status === 'Succeeded' && !file?.okf_repo_id"
            variant="primary"
            :disabled="!crawlJob"
            @click="onCreateOkfFromCrawl"
          >
            {{ translate('okf.crawl.createOkfFromCrawl', 'Create OKF repository from this crawl') }}
          </DsButton>
          <DsButton variant="danger" :disabled="isFileLocked" @click="handleDelete">
            {{ translate('common.delete', 'Delete') }}
          </DsButton>
          <div class="footer-actions">
            <DsButton variant="secondary" @click="$emit('close')">
              {{
                activeTab === 'dashboard' ? translate('common.close', 'Close') : translate('common.cancel', 'Cancel')
              }}
            </DsButton>
            <DsButton v-if="activeTab === 'details'" variant="primary" :disabled="isSaveDisabled" @click="handleSave">
              {{ translate('details.buttons.saveMetadata', 'Save Metadata') }}
            </DsButton>
            <DsButton
              v-if="activeTab === 'details'"
              :variant="
                mainAction.class === 'btn btn-primary'
                  ? 'primary'
                  : mainAction.class === 'btn btn-success'
                    ? 'primary'
                    : 'secondary'
              "
              :disabled="mainAction.disabled"
              @click="mainAction.handler"
            >
              {{ mainAction.text }}
            </DsButton>
          </div>
        </div>
      </template>

      <ConfirmDialog
        :visible="confirmDialog.visible"
        :title="confirmDialog.title"
        :message="confirmDialog.message"
        :confirm-text="confirmDialog.confirmText"
        :cancel-text="confirmDialog.cancelText"
        :secondary-text="confirmDialog.secondaryText"
        @confirm="confirmDialog.onConfirm"
        @cancel="confirmDialog.onCancel"
        @secondary="confirmDialog.onSecondary"
      />
    </div>
  </Teleport>
</template>

<script>
import documentFileService from '../services/documentFileService.js';
import serviceTreeService from '../services/serviceTreeService.js';
import { eventBus } from '../eventBus.js';
import ConfirmDialog from './ConfirmDialog.vue';
import DsButton from './ds/Button.vue';
import DsStatusTag from './ds/StatusTag.vue';
import DsSpinner from './ds/Spinner.vue';
import DsTabs from './ds/Tabs.vue';
import DsInput from './ds/Input.vue';
import { formatFileSize } from '../utils/fileUtils.js';

export default {
  name: 'FileDetailsDialog',
  components: {
    ConfirmDialog,
    DsButton,
    DsStatusTag,
    DsSpinner,
    DsTabs,
    DsInput
  },
  props: {
    fileId: {
      type: String,
      required: true
    }
  },
  emits: ['close', 'file-updated', 'action-triggered'],
  data() {
    return {
      isDownloading: false,
      downloadProgress: 0,
      downloadMessage: '',
      isLoading: true,
      isFetchingData: true,
      isHierarchyLoading: true,
      file: null,
      // Crawl related state
      crawlJob: null,
      crawlLogs: [],
      isCrawlLogLoading: false,

      // DASHBOARD STATE
      isAutoRefreshEnabled: true,
      dashboardRefreshInterval: 5,
      dashboardTimer: null,
      isRefreshingDashboard: false,

      // REAL METRICS STATE (replaced mockStats)
      crawlStats: {
        crawlRate: 0,
        queueSize: 0,
        errorRate: 0,
        errors: {},
        processed: 0,
        limit: 0,
        currentDepth: 0,
        maxDepth: 0,
        linksInternal: 0,
        linksExternal: 0,
        totalCrawled: 0
      },

      editableFile: {
        file_name: '',
        author: '',
        labels: []
      },
      knowledgeHierarchy: [],
      englishKnowledgeHierarchy: [],
      currentLocale: this.$i18n?.locale || 'en',
      // Removed 'areAllLabelsSelected' from data as it's now computed
      activeTab: 'details',
      ingestionLogs: [],
      isLogLoading: false,
      confirmDialog: {
        visible: false,
        title: '',
        message: '',
        confirmText: 'OK',
        cancelText: 'Cancel',
        secondaryText: '',
        onConfirm: () => {},
        onCancel: () => {},
        onSecondary: () => {}
      }
    };
  },
  computed: {
    visibleTabs() {
      const tabs = [{ value: 'details', label: this.translate('details.tabs.details', 'Details') }];
      if (this.crawlJob) {
        tabs.push({ value: 'dashboard', label: 'Dashboard' });
        tabs.push({ value: 'crawlLog', label: this.translate('details.tabs.crawlLog', 'Crawling Log') });
      }
      if (this.file.dataprep.status?.toLowerCase() !== 'pending') {
        tabs.push({ value: 'ingestionLog', label: this.translate('details.tabs.ingestionLog', 'Ingestion Log') });
      }
      return tabs;
    },
    areAllLabelsSelected: {
      get() {
        // If there are no labels to select, we aren't "all selected"
        if (this.allLabelNames.length === 0) return false;

        // Check if length matches AND every available label is in the selected list
        return (
          this.editableFile.labels.length === this.allLabelNames.length &&
          this.allLabelNames.every((label) => this.editableFile.labels.includes(label))
        );
      },
      set(value) {
        if (this.isMetadataEditable) {
          // Only update the labels if the USER interacts with the select-all box.
          // Because this is a setter, it is only called when v-model writes to it.
          this.editableFile.labels = value ? [...this.allLabelNames] : [];
        }
      }
    },
    // ---------------------------------

    dashboardProgressPercent() {
      if (!this.crawlStats.limit) return 0;
      return (this.crawlStats.processed / this.crawlStats.limit) * 100;
    },
    isSaveDisabled() {
      if (!this.isMetadataEditable) return true;
      if (!this.editableFile.file_name || !this.editableFile.file_name.trim()) return true;
      if (!this.editableFile.author || !this.editableFile.author.trim()) return true;
      if (this.isHierarchyLoading || this.englishKnowledgeHierarchy.length === 0) return true;
      return false;
    },
    isMetadataEditable() {
      return this.file && this.file.dataprep.status?.toLowerCase() !== 'ingested';
    },
    // Determine what status text to show
    displayStatus() {
      if (this.crawlJob) {
        if (this.crawlJob.status === 'Crawling') return 'Crawling';
        if (this.crawlJob.status === 'Failed' || this.crawlJob.status === 'Killed') return 'Crawl Failed';
        // If succeeded, fallback to dataprep status
      }
      return this.file?.dataprep.status || '';
    },
    // Determine if the internal file link should be shown
    canViewInternalFile() {
      if (!this.file) return false;
      // If it's a crawl job, only show if succeeded (or warning)
      if (this.crawlJob) {
        return this.crawlJob.status === 'Succeeded' || this.crawlJob.status === 'Crawl Warning';
      }
      // Regular file: show if not purely external (or if viewUrl logic handles it)
      return true;
    },
    // Helper to get normalized status
    currentStatus() {
      return this.file && this.file.dataprep.status ? this.file.dataprep.status.toLowerCase() : '';
    },
    // FIX: Lock delete/edit actions if file is ingested OR currently ingesting
    isFileLocked() {
      const s = this.currentStatus;
      return s === 'ingested' || s === 'ingested with warnings' || s === 'ingesting';
    },
    mainAction() {
      if (!this.file) return {};
      const status = this.currentStatus;
      const hasLabels = this.editableFile.labels.length > 0;

      // Retract logic (Only if Ingested)
      if (status === 'ingested' || status === 'ingested with warnings') {
        return {
          text: this.translate('details.buttons.retract', 'Retract'),
          class: 'btn btn-warning',
          disabled: false,
          handler: this.handleRetract
        };
      }

      // Ingest logic
      // Spec 4.4: Disable if crawlJob exists AND status is NOT Succeeded
      let isCrawlPending = false;
      if (this.crawlJob && this.crawlJob.status !== 'Succeeded') {
        isCrawlPending = true;
      }

      // FIX: Disable Ingest button if status is 'ingesting'
      const isIngesting = status === 'ingesting';

      return {
        text: this.translate('details.buttons.ingest', 'Ingest'),
        class: 'btn btn-success',
        // Disable if: Save disabled OR No labels OR Crawl not finished OR Ingesting
        disabled: this.isSaveDisabled || !hasLabels || isCrawlPending || isIngesting,
        handler: this.handleIngest
      };
    },
    allLabelNames() {
      if (!this.knowledgeHierarchy) {
        return [];
      }
      return this.knowledgeHierarchy.flatMap((category) =>
        category.children ? category.children.map((service) => service.name) : []
      );
    },
    // URL for the internal file endpoint
    fileViewUrl() {
      if (!this.file) return null;
      if (this.file.file_id) {
        return `/api/files/${this.file.file_id}/viewbrowser`;
      }
      return null;
    }
  },
  watch: {
    activeTab(val) {
      if (val === 'crawlLog' && this.crawlLogs.length === 0) {
        this.fetchCrawlLogs();
      }
      if (val === 'ingestionLog' && this.ingestionLogs.length === 0) {
        this.fetchIngestionLogs();
      }
      if (val === 'dashboard') {
        this.startDashboardTimer();
      } else {
        this.stopDashboardTimer();
      }
    },

    fileId: {
      immediate: true,
      handler(newId) {
        if (newId) {
          this.fetchData(newId);
        }
      }
    },
    isAutoRefreshEnabled(enabled) {
      if (enabled && this.activeTab === 'dashboard') {
        this.startDashboardTimer();
      } else {
        this.stopDashboardTimer();
      }
    },
    dashboardRefreshInterval() {
      // Restart timer if interval changes and it's running
      if (this.isAutoRefreshEnabled && this.activeTab === 'dashboard') {
        this.stopDashboardTimer();
        this.startDashboardTimer();
      }
    },
    '$i18n.locale'(newLocale) {
      if (newLocale && newLocale !== this.currentLocale) {
        this.currentLocale = newLocale;
        this.fetchData(this.fileId);
      }
    }
  },
  beforeUnmount() {
    this.stopDashboardTimer();
  },
  methods: {
    formatFileSize,
    /**
     * Story 3-7 (fixed in #977): create a draft OKF repository from this
     * crawl, ingest the crawled content as a concept, and switch to the
     * Studio tab. The wizard opens at Step 5 (Curate) with the new repo
     * already loaded (mirrors the Clone amendment's UX).
     *
     * Additive: the existing freeform/document path (this dialog's other
     * actions) is untouched.
     */
    async onCreateOkfFromCrawl() {
      if (!this.crawlJob || this.crawlJob.status !== 'Succeeded' || this.file?.okf_repo_id) return;
      const fileId = this.file && (this.file._key || this.file.file_id);
      const filename = this.file && this.file.file_name;
      const url = this.crawlJob && this.crawlJob.config && this.crawlJob.config.url;
      const crawlJobId = this.crawlJob && (this.crawlJob._key || this.crawlJob.crawl_job_id);
      if (!fileId) {
        // No file to ingest from — fall back to the legacy seed behaviour so
        // the steward can at least land in the Studio with the seed URL.
        const seed = filename || url || '';
        await this.$store.dispatch('okf/setSelection', { crawlSeeds: [seed] });
        window.dispatchEvent(
          new CustomEvent('okf:create-from-crawl', {
            detail: { file_id: null, crawl_job_id: crawlJobId, seed }
          })
        );
        this.$emit('close');
        return;
      }
      // Mark the dialog busy while we create the repo (no UI spinner — the
      // dialog closes immediately on success and the Studio tab is the
      // visible feedback).
      this.isDownloading = true;
      this.downloadMessage = this.translate('okf.crawl.creating', 'Creating OKF repository...');
      try {
        const result = await this.$store.dispatch('okf/createFromCrawl', {
          fileId,
          url,
          crawlJobId,
          filename,
          actor: { sub: 'crawler-to-okf' }
        });
        if (!result || !result.ok) {
          this.showNotification(
            this.translate('okf.crawl.createFailed', 'Could not create the OKF repository from this crawl.'),
            'error'
          );
        } else {
          this.showNotification(
            this.translate('okf.crawl.createOk', 'OKF repository created. Opening the Studio to curate.'),
            'success'
          );
        }
      } catch {
        this.showNotification(
          this.translate('okf.crawl.createFailed', 'Could not create the OKF repository from this crawl.'),
          'error'
        );
      } finally {
        this.isDownloading = false;
        this.downloadMessage = '';
        this.$emit('close');
      }
    },
    translate(key, fallback) {
      if (this.$i18n && this.$i18n.t) {
        const translation = this.$i18n.t(key, this.currentLocale);
        if (translation === key) {
          return fallback || key;
        }
        return translation;
      }
      return fallback || key;
    },

    // --- DASHBOARD TIMER METHODS ---
    startDashboardTimer() {
      this.stopDashboardTimer(); // Clear any existing
      if (!this.isAutoRefreshEnabled) return;

      const interval = Math.max(1, this.dashboardRefreshInterval) * 1000;
      this.dashboardTimer = setInterval(() => {
        this.refreshDashboardData();
      }, interval);

      // Trigger immediate refresh
      this.refreshDashboardData();
    },
    stopDashboardTimer() {
      if (this.dashboardTimer) {
        clearInterval(this.dashboardTimer);
        this.dashboardTimer = null;
      }
    },
    async refreshDashboardData() {
      if (this.isRefreshingDashboard) return;
      this.isRefreshingDashboard = true;
      try {
        // 1. Refresh real file metadata
        const crawlJobResponse = await documentFileService.getCrawlJob(this.fileId);
        if (crawlJobResponse && crawlJobResponse.data) {
          this.crawlJob = crawlJobResponse.data;
        }

        // 2. Fetch Live Metrics from Backend (REAL IMPLEMENTATION)
        const metricsResponse = await documentFileService.getCrawlMetrics(this.fileId);
        if (metricsResponse && metricsResponse.data) {
          const m = metricsResponse.data;
          this.crawlStats = {
            crawlRate: m.crawl_rate || 0,
            queueSize: m.queue_size || 0,
            errorRate: m.error_rate || 0,
            errors: m.error_counts || {},
            processed: m.processed || 0,
            limit: m.limit || 0,
            currentDepth: m.current_depth || 0,
            maxDepth: m.max_depth || 0,
            linksInternal: m.links_internal || 0,
            linksExternal: m.links_external || 0,
            totalCrawled: m.total_crawled || 0
          };
        }
      } catch (e) {
        console.error('Dashboard refresh failed', e);
      } finally {
        this.isRefreshingDashboard = false;
      }
    },

    isExternalUrl(url) {
      if (!url) return false;
      const isHttp = url.startsWith('http://') || url.startsWith('https://');
      const isPlaceholder = url.includes('<HOST>') || url.includes('<PORT>');
      return isHttp && !isPlaceholder;
    },
    async fetchData(id) {
      this.isFetchingData = true;
      this.isLoading = true;
      this.isHierarchyLoading = true;
      this.crawlJob = null; // Reset crawl job state

      try {
        // Fetch File Metadata, Hierarchy (current + en), and Crawl Job concurrently
        const [fileResponse, hierarchyResponse, englishHierarchyResponse] = await Promise.all([
          documentFileService.getFileMetadata(id),
          serviceTreeService.getAdminCategories(this.currentLocale),
          serviceTreeService.getAdminCategories('en')
        ]);

        this.file = fileResponse;

        // Fetch crawl-job status only for link/crawl-origin files (source_url set).
        // Regular uploads never have a crawl_job; querying would 404 noisily and
        // surface a misleading error toast via the global httpService interceptor.
        if (fileResponse.source_url) {
          try {
            const crawlResponse = await documentFileService.getCrawlJob(id);
            if (crawlResponse && crawlResponse.data) {
              this.crawlJob = crawlResponse.data;
            }
          } catch {
            // No crawl job (yet), or deleted — not an error.
            this.crawlJob = null;
          }
        } else {
          this.crawlJob = null;
        }

        const initialLabelsInCurrentLocale = this.mapEnglishToLocale(
          fileResponse.labels || [],
          hierarchyResponse,
          englishHierarchyResponse
        );
        this.editableFile = {
          file_name: this.file.file_name,
          author: this.file.author || '',
          labels: initialLabelsInCurrentLocale
        };

        this.knowledgeHierarchy = hierarchyResponse;
        this.englishKnowledgeHierarchy = englishHierarchyResponse;

        // If file status is not pending, fetch ingestion logs
        if (this.file.dataprep.status?.toLowerCase() !== 'pending') {
          this.fetchIngestionLogs();
        }
      } catch (error) {
        console.error('Error fetching data for FileDetailsDialog:', error);
        this.showNotification(
          this.translate('details.notifications.loadError', 'Failed to load file details.'),
          'error'
        );
        this.$emit('close');
      } finally {
        this.isLoading = false;
        this.isHierarchyLoading = false;
        this.isFetchingData = false;
      }
    },
    // ... existing mapEnglishToLocale ...
    mapEnglishToLocale(englishLabels, localeHierarchy, englishHierarchy) {
      if (!englishLabels || englishLabels.length === 0 || !localeHierarchy || !englishHierarchy) {
        return [];
      }
      const localeLabels = [];
      const englishServiceMap = new Map();
      englishHierarchy.forEach((engCategory, catIndex) => {
        if (engCategory.children && localeHierarchy[catIndex] && localeHierarchy[catIndex].children) {
          engCategory.children.forEach((engService, servIndex) => {
            const localeService = localeHierarchy[catIndex].children[servIndex];
            if (localeService) {
              const keyToMatch = engService._key || `idx_${catIndex}_${servIndex}`;
              const localeKey = localeService._key || `idx_${catIndex}_${servIndex}`;
              if (keyToMatch === localeKey) {
                englishServiceMap.set(engService.name, localeService.name);
              }
            }
          });
        }
      });
      englishLabels.forEach((engLabel) => {
        if (englishServiceMap.has(engLabel)) {
          localeLabels.push(englishServiceMap.get(engLabel));
        } else {
          localeLabels.push(engLabel);
        }
      });
      return localeLabels;
    },
    // ... existing getEnglishLabelNames ...
    getEnglishLabelNames(selectedLocaleLabels) {
      if (
        !selectedLocaleLabels ||
        selectedLocaleLabels.length === 0 ||
        this.englishKnowledgeHierarchy.length === 0 ||
        this.knowledgeHierarchy.length === 0
      ) {
        return [];
      }
      const englishLabels = [];
      const localeServiceMap = new Map();
      this.knowledgeHierarchy.forEach((localeCategory) => {
        if (localeCategory.children) {
          localeCategory.children.forEach((localeService) => {
            const englishService = this.findServiceInHierarchy(
              this.englishKnowledgeHierarchy,
              localeService._key,
              localeService.name
            );
            if (englishService) {
              localeServiceMap.set(localeService.name, englishService.name);
            }
          });
        }
      });
      selectedLocaleLabels.forEach((localeLabel) => {
        if (localeServiceMap.has(localeLabel)) {
          englishLabels.push(localeServiceMap.get(localeLabel));
        } else {
          const directMatch = this.findServiceInHierarchy(this.englishKnowledgeHierarchy, null, localeLabel);
          if (directMatch) {
            englishLabels.push(directMatch.name);
          } else {
            englishLabels.push(localeLabel);
          }
        }
      });
      return [...new Set(englishLabels)];
    },
    // ... existing findServiceInHierarchy ...
    findServiceInHierarchy(hierarchy, serviceKey, serviceName) {
      for (const category of hierarchy) {
        if (category.children) {
          for (const service of category.children) {
            if (serviceKey && service._key && service._key === serviceKey) {
              return service;
            }
            if (!serviceKey && service.name === serviceName) {
              return service;
            }
          }
        }
      }
      return null;
    },
    async handleSave() {
      if (this.isSaveDisabled) {
        this.showNotification(
          this.translate(
            'details.notifications.validationError',
            'File Name and Author are required, or labels are still loading.'
          ),
          'error'
        );
        return false;
      }

      const englishLabelsToSave = this.getEnglishLabelNames(this.editableFile.labels);

      const updates = {
        file_name: this.editableFile.file_name.trim(),
        author: this.editableFile.author.trim(),
        labels: englishLabelsToSave
      };
      try {
        await documentFileService.updateFile(this.fileId, updates);
        this.showNotification(
          this.translate('details.notifications.saveSuccess', 'Metadata updated successfully.'),
          'success'
        );
        this.$emit('file-updated', { fileId: this.fileId, ...updates });
        return true;
      } catch {
        this.showNotification(this.translate('details.notifications.saveError', 'Failed to save metadata.'), 'error');
        return false;
      }
    },

    // NEW: Open/Download the internal file (Generic for all types)
    async handleViewInternalFile() {
      const LARGE_FILE_THRESHOLD = 20 * 1024 * 1024; // 20MB
      const isLargeFile = this.file.file_size > LARGE_FILE_THRESHOLD;

      // --- 1. SMART ROUTING ---
      const mime = (this.file.file_type || '').toLowerCase();
      // Explicitly detect Markdown
      const isMarkdown = mime.includes('markdown') || (this.file.file_name || '').endsWith('.md');

      const isViewable =
        mime.startsWith('image/') ||
        mime.startsWith('text/') ||
        mime === 'application/pdf' ||
        mime === 'application/json' ||
        isMarkdown;

      // Only open tab if Small AND Viewable
      const useNewTab = !isLargeFile && isViewable;

      let newWindow = null;

      // --- SCENARIO A: PREPARE TAB ---
      if (useNewTab) {
        newWindow = window.open('', '_blank');
        if (newWindow) {
          newWindow.document.write(`
            <html>
              <head><title>Loading...</title></head>
              <body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;background:#f3f4f6;">
                <div style="text-align:center;">
                  <div style="width:40px;height:40px;border:4px solid #e2e8f0;border-top-color:#3b82f6;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 1rem;"></div>
                  <p style="color:#4b5563;">Loading ${this.file.file_name}...</p>
                </div>
                <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
              </body>
            </html>
          `);
        } else {
          this.showNotification('Popup blocked. Please allow popups for this site.', 'error');
          return;
        }
      }

      // --- SCENARIO B: DOWNLOAD OVERLAY ---
      if (!useNewTab) {
        this.isDownloading = true;
        this.downloadProgress = 0;
        this.downloadMessage = 'Starting...';
      }

      try {
        const token = this.$store.getters.accessToken;

        if (!token) throw new Error('Authentication token not found.');
        if (!this.fileViewUrl) throw new Error('Could not determine file view URL.');

        if (!useNewTab) {
          // --- XHR DOWNLOAD (Progress Bar) ---
          await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', this.fileViewUrl);
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            xhr.responseType = 'blob';

            xhr.onprogress = (event) => {
              const loadedMB = (event.loaded / (1024 * 1024)).toFixed(1);
              const totalSize = event.lengthComputable ? event.total : this.file.file_size;

              if (totalSize > 0) {
                const percent = Math.floor((event.loaded / totalSize) * 100);
                this.downloadProgress = Math.min(percent, 100);
                this.downloadMessage = `${this.downloadProgress}% (${loadedMB} MB)`;
              } else {
                this.downloadProgress = 100;
                this.downloadMessage = `${loadedMB} MB downloaded...`;
              }
            };

            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                const blob = xhr.response;
                const fileType = this.file.file_type || blob.type || 'application/octet-stream';
                const downloadBlob = new Blob([blob], { type: fileType });
                const url = URL.createObjectURL(downloadBlob);

                const link = document.createElement('a');
                link.href = url;
                link.download = this.file.file_name || 'download';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);

                setTimeout(() => URL.revokeObjectURL(url), 100);
                resolve();
              } else {
                reject(new Error(`HTTP ${xhr.status}`));
              }
            };

            xhr.onerror = () => reject(new Error('Network Error'));
            xhr.send();
          });

          this.showNotification('Download complete.', 'success');
        } else {
          // --- FETCH VIEW (Tab Navigation) ---
          const response = await fetch(this.fileViewUrl, {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store'
          });

          if (!response.ok) throw new Error(`Failed to fetch file: ${response.status}`);

          const rawBlob = await response.blob();
          const fileType = this.file.file_type || rawBlob.type || 'application/octet-stream';
          const blob = new Blob([rawBlob], { type: fileType });

          // HASH HACK: We append the filename.
          // 1. Extensions see ".md" and render it.
          // 2. Browsers see "text/markdown" MIME type and render text.
          const fileURL = URL.createObjectURL(blob) + '#' + (this.file.file_name || 'file.md');

          if (newWindow) {
            // This replaces the "Loading..." spinner with the actual file/blob
            newWindow.location.href = fileURL;
          }
        }
      } catch (error) {
        console.error('View/Download error:', error);

        if (newWindow && useNewTab) {
          newWindow.document.body.innerHTML = `
            <div style="text-align:center;color:#ef4444;font-family:sans-serif;padding:2rem;">
              <h3>Error Loading File</h3>
              <p>${error.message}</p>
              <button onclick="window.close()" style="padding:0.5rem 1rem;cursor:pointer;">Close</button>
            </div>
          `;
        }
        this.showNotification('Could not load file. ' + error.message, 'error');
      } finally {
        this.isDownloading = false;
        this.downloadProgress = 0;
        this.downloadMessage = '';
      }
    },

    // --- Crawl Log Methods ---
    switchToCrawlLogTab() {
      this.activeTab = 'crawlLog';
      if (this.crawlLogs.length === 0) {
        this.fetchCrawlLogs();
      }
    },
    async fetchCrawlLogs() {
      this.isCrawlLogLoading = true;
      try {
        const response = await documentFileService.getCrawlLogs(this.fileId);
        // Controller returns { success, data: [], count }
        this.crawlLogs = response.data || [];
      } catch (error) {
        console.error('Error fetching crawl logs:', error);
        this.showNotification(
          this.translate('details.notifications.crawlLogError', 'Failed to fetch crawl logs.'),
          'error'
        );
      } finally {
        this.isCrawlLogLoading = false;
      }
    },
    handleKillCrawl() {
      this.confirmDialog = {
        visible: true,
        title: this.translate('details.confirm.killCrawlTitle', 'Kill Crawl Task'),
        message: this.translate(
          'details.confirm.killCrawl',
          'Are you sure you want to stop this crawling task? Partial data may be saved.'
        ),
        confirmText: this.translate('details.log.killCrawl', 'Kill Task'),
        cancelText: this.translate('common.cancel', 'Cancel'),
        onConfirm: this.confirmKillCrawl,
        onCancel: this.closeConfirm
      };
    },
    async confirmKillCrawl() {
      this.closeConfirm();
      this.isCrawlLogLoading = true;
      try {
        await documentFileService.killCrawl(this.fileId);
        this.showNotification(this.translate('details.notifications.killCrawlSuccess', 'Kill signal sent.'), 'success');
        // Refresh info to see status change
        this.fetchData(this.fileId);
      } catch {
        this.showNotification(
          this.translate('details.notifications.killCrawlError', 'Failed to send kill signal.'),
          'error'
        );
      } finally {
        this.isCrawlLogLoading = false;
      }
    },

    // --- Action Handlers ---
    async handleIngest() {
      if (this.editableFile.labels.length === 0) {
        this.showNotification(
          this.translate(
            'details.notifications.ingestLabelRequired',
            'Please select at least one label before ingesting.'
          ),
          'error'
        );
        return;
      }

      this.showNotification(
        this.translate('details.notifications.ingestSaving', 'Saving metadata before ingestion...'),
        'info'
      );
      const saveSuccess = await this.handleSave();

      if (saveSuccess) {
        this.confirmDialog = {
          visible: true,
          title: this.translate('details.confirm.ingestTitle', 'Confirm Ingestion'),
          message: this.translate(
            'details.confirm.ingest',
            'Are you sure you want to ingest this file? This will start the data processing pipeline.'
          ),
          confirmText: this.translate('common.ingest', 'Ingest'),
          cancelText: this.translate('common.cancel', 'Cancel'),
          onConfirm: this.confirmIngest,
          onCancel: this.closeConfirm
        };
      } else {
        this.showNotification(
          this.translate('details.notifications.ingestSaveFailed', 'Failed to save metadata. Ingestion cancelled.'),
          'error'
        );
      }
    },
    async confirmIngest() {
      this.closeConfirm();
      this.isLoading = true;
      try {
        await documentFileService.ingestFile(this.fileId);
        this.showNotification(
          this.translate('details.notifications.ingestSuccess', 'File has been successfully queued for ingestion.'),
          'success'
        );
        this.$emit('action-triggered', {
          action: 'ingest',
          fileId: this.fileId
        });
        this.$emit('close');
      } catch (error) {
        this.showNotification(
          this.translate('details.notifications.ingestError', 'Failed to start ingestion process.') +
            ` Error: ${error.message}`,
          'error'
        );
      } finally {
        this.isLoading = false;
      }
    },

    handleRetract() {
      this.confirmDialog = {
        visible: true,
        title: this.translate('details.confirm.retractTitle', 'Confirm Retraction'),
        message: this.translate('details.confirm.retract', 'Are you sure you want to retract this file?'),
        confirmText: this.translate('common.retract', 'Retract'),
        cancelText: this.translate('common.cancel', 'Cancel'),
        onConfirm: this.confirmRetract,
        onCancel: this.closeConfirm
      };
    },
    async confirmRetract() {
      this.closeConfirm();
      this.isLoading = true;
      try {
        await documentFileService.retractMultipleFiles([this.file.file_id]);
        this.showNotification(
          this.translate('details.notifications.retractSuccess', 'File has been retracted.'),
          'success'
        );
        this.$emit('action-triggered', {
          action: 'retract',
          fileId: this.file.file_id
        });
        this.$emit('close');
      } catch (error) {
        this.showNotification(
          this.translate('details.notifications.retractError', 'Failed to retract file.') + ` Error: ${error.message}`,
          'error'
        );
      } finally {
        this.isLoading = false;
      }
    },

    handleDelete() {
      this.confirmDialog = {
        visible: true,
        title: this.translate('details.confirm.deleteTitle', 'Confirm Deletion'),
        message: this.translate(
          'details.confirm.delete',
          'Are you sure you want to permanently delete this file? This action cannot be undone.'
        ),
        confirmText: this.translate('common.delete', 'Delete'),
        cancelText: this.translate('common.cancel', 'Cancel'),
        onConfirm: this.confirmDelete,
        onCancel: this.closeConfirm
      };
    },
    async confirmDelete() {
      this.closeConfirm();
      this.isLoading = true;
      try {
        await documentFileService.deleteFile(this.file.file_id);
        this.showNotification(
          this.translate('details.notifications.deleteSuccess', 'File deleted successfully.'),
          'success'
        );
        this.$emit('action-triggered', {
          action: 'delete',
          fileId: this.file.file_id
        });
        this.$emit('close');
      } catch (error) {
        this.showNotification(
          this.translate('details.notifications.deleteError', 'Failed to delete file.') + ` Error: ${error.message}`,
          'error'
        );
      } finally {
        this.isLoading = false;
      }
    },

    // --- Kill Action Handlers (UI Only) ---
    handleKillDocument() {
      this.confirmDialog = {
        visible: true,
        title: this.translate('details.confirm.killDocTitle', 'Kill Document Ingestion'),
        message: this.translate(
          'details.confirm.killDoc',
          'Are you sure you want to kill the ingestion task for THIS document? The process will attempt a graceful rollback.'
        ),
        confirmText: this.translate('details.log.killDocument', 'Kill This Document'),
        cancelText: this.translate('common.cancel', 'Cancel'),
        onConfirm: this.confirmKillDocument,
        onCancel: this.closeConfirm
      };
    },

    async confirmKillDocument() {
      this.closeConfirm();
      this.isLogLoading = true;
      try {
        // Call the new service method
        await documentFileService.killIngestion(this.fileId);

        this.showNotification(
          this.translate('details.notifications.killDocSent', 'Kill request sent. Rolling back changes...'),
          'info'
        );

        // Refresh logs to see the rollback progress
        setTimeout(() => this.fetchIngestionLogs(), 2000);
      } catch (error) {
        this.showNotification('Failed to kill ingestion: ' + error.message, 'error');
      } finally {
        this.isLogLoading = false;
      }
    },

    // --- Log Tab Methods ---
    switchToLogTab() {
      this.activeTab = 'ingestionLog';
      // Fetch logs when switching to the tab for the first time
      if (this.ingestionLogs.length === 0) {
        this.fetchIngestionLogs();
      }
    },

    async fetchIngestionLogs() {
      this.isLogLoading = true;
      try {
        const response = await documentFileService.getIngestionLogs(this.fileId);
        this.ingestionLogs = response.data || [];
      } catch (error) {
        console.error('Error fetching ingestion logs:', error);
        this.showNotification(
          this.translate('details.notifications.logError', 'Failed to fetch ingestion logs.'),
          'error'
        );
        this.ingestionLogs = []; // Clear logs on error
      } finally {
        this.isLogLoading = false;
      }
    },

    closeConfirm() {
      this.confirmDialog.visible = false;
    },

    getLogLevelClass(level) {
      if (level === 'ERROR') return 'log-level-error';
      if (level === 'WARN') return 'log-level-warn';
      return 'log-level-info';
    },

    // --- Util Methods ---
    getStatusVariant(status) {
      const lowerStatus = status ? status.toLowerCase() : '';
      if (lowerStatus === 'ingested') return 'success';
      if (lowerStatus === 'pending') return 'pending';
      if (lowerStatus === 'retracted') return 'info';
      if (lowerStatus === 'ingesting') return 'info';
      if (lowerStatus === 'crawling') return 'info';
      if (lowerStatus === 'ingestion error') return 'error';
      if (lowerStatus === 'ingested with warnings') return 'warning';
      if (lowerStatus === 'crawl failed') return 'error';
      if (lowerStatus === 'killed') return 'error';
      return 'pending';
    },

    showNotification(message, type = 'success') {
      eventBus.$emit('notification:show', { message, type });
    }
  }
};
</script>

<style scoped>
.live-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  background-color: var(--danger);
  border-radius: 50%;
  margin-left: var(--space-xs);
  animation: pulse 1.5s infinite;
}
@keyframes pulse {
  0% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
  100% {
    opacity: 1;
  }
}

.tab-content {
  padding: var(--space-lg);
  overflow-y: auto;
}

.tab-content-details {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: var(--space-xl);
}

/* --- DASHBOARD STYLES --- */
.dashboard-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--bg);
  padding: var(--space-md) var(--space-md);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-light);
  margin-bottom: var(--space-lg);
}
.auto-refresh {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-size: var(--text-base);
  color: var(--muted);
}
.toggle-wrapper {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  cursor: pointer;
}
.small-input {
  width: 60px;
  padding: var(--space-xs) var(--space-sm);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  text-align: center;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: var(--space-md);
  margin-bottom: var(--space-lg);
}
.stat-card {
  background: var(--bg);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  text-align: center;
}
.stat-label {
  font-size: var(--text-sm);
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: var(--space-xs);
}
.stat-value {
  font-size: var(--text-xl);
  font-weight: 700;
  color: var(--fg);
}
.unit {
  font-size: var(--text-base);
  font-weight: 400;
  color: var(--muted-soft);
}
.stat-subtext {
  display: flex;
  justify-content: center;
  gap: var(--space-sm);
  margin-top: var(--space-xs);
}
.err-badge {
  font-size: var(--text-xs);
  background: var(--bg);
  color: var(--danger);
  padding: 1px var(--space-xs);
  border-radius: var(--radius-sm);
}
.bg-danger-light {
  background-color: var(--bg);
  border-color: var(--border-light);
}
.text-danger {
  color: var(--danger);
}
.text-success {
  color: var(--success);
}
.text-primary {
  color: var(--accent);
}

/* Progress Bar */
.progress-section {
  margin-bottom: var(--space-lg);
}
.progress-header {
  display: flex;
  justify-content: space-between;
  font-size: var(--text-base);
  color: var(--muted);
  margin-bottom: var(--space-xs);
}
.progress-bar-bg {
  height: 8px;
  background: var(--border-light);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.progress-bar-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.3s ease;
}

/* Efficiency Grid */
.efficiency-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr;
  gap: var(--space-sm);
  padding-bottom: var(--space-md);
  border-bottom: 1px solid var(--border-light);
  margin-bottom: var(--space-md);
}
.eff-item {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.eff-label {
  font-size: var(--text-xs);
  color: var(--muted-soft);
}
.eff-val {
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--fg);
}

/* Ingestion/Crawl Log Tab Styles */
.ingestion-log-tab,
.crawl-log-tab {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}
.log-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-md);
}
.kill-actions {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  flex-wrap: wrap;
}
.kill-label {
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--muted);
}
.external-icon {
  font-size: 0.9em;
  margin-left: 0.3em;
}

.log-table-container {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow-x: auto;
  max-height: 400px;
  overflow-y: auto;
}
.log-table {
  width: 100%;
  border-collapse: collapse;
}
.log-table th,
.log-table td {
  padding: var(--space-md) var(--space-md);
  text-align: left;
  border-bottom: 1px solid var(--border);
  font-size: var(--text-base);
}
.log-table th {
  background-color: var(--bg-tertiary);
  font-weight: 600;
  color: var(--muted);
}
.log-table td {
  color: var(--fg);
  vertical-align: top;
}
.log-table tr:last-child td {
  border-bottom: none;
}
.log-state {
  text-align: center;
  padding: var(--space-xl);
  color: var(--muted);
  font-style: italic;
}
.log-level {
  font-weight: 600;
  padding: 0.1rem var(--space-sm);
  border-radius: var(--radius-sm);
  font-size: var(--text-base);
  white-space: nowrap;
}
.log-level-info {
  color: var(--accent);
  background-color: var(--info-bg);
}
.log-level-warn {
  color: var(--warning);
  background-color: var(--warning-bg);
}
.log-level-error {
  color: var(--danger);
  background-color: var(--danger-bg);
}

/* Base styles from original file */
.dialog-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--overlay-bg);
  z-index: 1050;
}
.dialog-container {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 90%;
  max-width: 800px;
  background-color: var(--surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  z-index: 1051;
  display: flex;
  flex-direction: column;
  max-height: 90vh;
}
.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.dialog-title {
  font-size: var(--text-lg);
  color: var(--fg);
  margin: 0;
}
.dialog-close-btn {
  /* Layout only - styling handled by DsButton */
}

/* Responsive grid for smaller screens */
@media (max-width: 768px) {
  .tab-content-details {
    grid-template-columns: 1fr; /* Stack columns on smaller screens */
    gap: var(--space-lg);
  }
  .log-actions {
    flex-direction: column;
    align-items: stretch;
  }
  .kill-actions {
    flex-direction: column;
    align-items: stretch;
  }
  .kill-actions .btn {
    width: 100%;
  }
}
.dialog-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-md) var(--space-lg);
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
.footer-actions {
  display: flex;
  gap: var(--space-md);
}
.btn {
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  border: none;
  font-size: var(--text-base);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1.2;
  gap: var(--space-sm); /* Gap between icon/spinner and text */
}
.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  background-color: var(--muted);
  border-color: var(--muted);
  color: var(--muted-soft);
}
.btn-success {
  background-color: var(--success);
  color: var(--accent-fg);
}
.btn-success:hover:not(:disabled) {
  background-color: var(--success);
}
.btn-warning {
  background-color: var(--warning);
  color: var(--fg);
}
.btn-warning:hover:not(:disabled) {
  background-color: var(--warning);
}
.btn-danger {
  background-color: var(--danger);
  color: var(--accent-fg);
}
.btn-danger:hover:not(:disabled) {
  background-color: var(--danger);
}
.btn-outline {
  background-color: transparent;
  border: 1px solid var(--border);
  color: var(--muted);
}
.btn-outline:hover:not(:disabled) {
  background-color: var(--bg-tertiary);
  border-color: var(--border-light);
}
.btn-outline:disabled {
  background-color: transparent;
  border-color: var(--muted);
  color: var(--muted-soft);
}
.form-group {
  margin-bottom: var(--space-lg);
}
.form-group label {
  display: block;
  margin-bottom: var(--space-sm);
  font-weight: 500;
  color: var(--muted);
}
.form-input.is-invalid {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-muted);
}
.form-input:disabled {
  background-color: var(--bg);
  color: var(--muted);
  cursor: not-allowed;
  border-color: var(--border-light);
}
.form-input.is-invalid {
  border-color: var(--danger);
  box-shadow: 0 0 0 1px var(--danger);
}
.info-section {
  background-color: var(--bg-tertiary);
  border-radius: var(--radius-md);
  padding: var(--space-lg);
  border: 1px solid var(--border);
}
.info-item {
  display: flex;
  flex-direction: column;
  margin-bottom: var(--space-md);
  font-size: var(--text-base);
}
.info-label {
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--muted);
  margin-bottom: var(--space-xs);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.info-item > span:not(.info-label) {
  color: var(--fg);
}
.info-hash {
  word-break: break-all;
  font-family: var(--font-mono);
  font-size: var(--text-base);
  background-color: var(--bg);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  color: var(--fg);
  border: 1px solid var(--border);
}
.select-all-container {
  display: flex;
  align-items: center;
  margin-bottom: var(--space-md);
  cursor: pointer;
}
.select-all-container input[type='checkbox'] {
  margin-right: var(--space-sm);
  cursor: pointer;
  height: 1rem;
  width: 1rem;
}
.select-all-container label {
  margin-bottom: 0;
  font-weight: 600;
  color: var(--fg);
  cursor: pointer;
  user-select: none;
}
.select-all-container input[type='checkbox']:disabled + label {
  color: var(--muted-soft);
  cursor: not-allowed;
}
.labels-container {
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid var(--border);
  padding: var(--space-md);
  border-radius: var(--radius-sm);
  background-color: var(--surface);
}
.loading-state-small {
  font-style: italic;
  color: var(--muted);
  text-align: center;
  padding: var(--space-md);
}
.label-category {
  margin-bottom: var(--space-md);
}
.label-category strong {
  font-size: var(--text-base);
  color: var(--fg);
  display: block;
  margin-bottom: var(--space-xs);
}
.label-item {
  display: flex;
  align-items: center;
  margin-top: var(--space-sm);
  padding-left: var(--space-sm);
  cursor: pointer;
}
.label-item input[type='checkbox'] {
  margin-right: var(--space-sm);
  cursor: pointer;
  height: 1rem;
  width: 1rem;
}
.label-item label {
  margin-bottom: 0;
  color: var(--muted);
  cursor: pointer;
  user-select: none;
  font-size: var(--text-base);
}
.label-item input[type='checkbox']:disabled + label {
  color: var(--muted-soft);
  cursor: not-allowed;
}
.file-view-link {
  color: var(--accent);
  text-decoration: none;
  font-weight: 500;
  word-break: break-all;
  cursor: pointer;
  transition: color 0.2s;
}
.file-view-link:hover {
  text-decoration: underline;
  color: var(--accent-hover);
}
.progress-track {
  width: 200px;
  height: 8px;
  background-color: var(--border-light);
  border-radius: var(--radius-sm);
  margin-top: var(--space-sm);
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background-color: var(--accent);
  transition: width 0.2s ease;
}
[data-theme='dark'] .progress-track {
  background-color: var(--muted);
}
</style>
