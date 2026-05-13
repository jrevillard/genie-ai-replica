<template>
  <div class="modal" :data-theme="theme">
    <div class="overlay" @click="$emit('close')"></div>
    <div class="modal-content">
      <div class="modal-title">
        <h2>{{ title }}</h2>
        <DsButton variant="ghost" class="close-btn" aria-label="Close dialog" @click="$emit('close')">×</DsButton>
      </div>

      <div class="modal-body">
        <!-- Operation success/failure status -->
        <div :class="['result-status', results.success ? 'status-success' : 'status-error']">
          <div class="status-icon">{{ results.success ? '✓' : '✗' }}</div>
          <div class="status-message">{{ results.message }}</div>
        </div>

        <!-- Operation details: Backup results -->
        <div v-if="operation === 'backupDatabase' && results.success" class="result-details">
          <div class="result-section">
            <h3>{{ translate('admin.operations.backupDetails', 'Backup Details') }}</h3>
            <div class="detail-item">
              <div class="detail-label">{{ translate('admin.operations.backupFile', 'Backup File') }}:</div>
              <div class="detail-value">{{ results.backupFile }}</div>
            </div>
            <div class="detail-item">
              <div class="detail-label">{{ translate('admin.operations.backupLocation', 'Location') }}:</div>
              <div class="detail-value">{{ results.backupLocation }}</div>
            </div>
            <div v-if="results.size" class="detail-item">
              <div class="detail-label">{{ translate('admin.operations.backupSize', 'Size') }}:</div>
              <div class="detail-value">{{ results.size }}</div>
            </div>
          </div>
        </div>

        <!-- Operation details: Optimize results -->
        <div v-if="operation === 'optimizeDatabase' && results.success && results.results" class="result-details">
          <div class="result-section">
            <h3>{{ translate('admin.operations.optimizeResults', 'Optimization Results') }}</h3>
            <div class="table-container">
              <table class="results-table">
                <thead>
                  <tr>
                    <th>{{ translate('admin.operations.collection', 'Collection') }}</th>
                    <th>{{ translate('admin.operations.status', 'Status') }}</th>
                    <th>{{ translate('admin.operations.indexSuggestions', 'Index Suggestions') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(item, index) in results.results" :key="index">
                    <td>{{ item.collection }}</td>
                    <td>
                      <DsPill :variant="item.status === 'success' ? 'success' : 'danger'">
                        {{ item.status }}
                      </DsPill>
                    </td>
                    <td>
                      <ul v-if="item.indexSuggestions && item.indexSuggestions.length">
                        <li v-for="(suggestion, i) in item.indexSuggestions" :key="i">
                          {{ suggestion }}
                        </li>
                      </ul>
                      <span v-else>-</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- Generic error details -->
        <div v-if="!results.success && results.error" class="result-details error-details">
          <div class="result-section">
            <h3>{{ translate('admin.operations.errorDetails', 'Error Details') }}</h3>
            <pre class="error-message">{{ results.error }}</pre>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <DsButton variant="primary" @click="$emit('close')">
          {{ translate('admin.operations.close', 'Close') }}
        </DsButton>
      </div>
    </div>
  </div>
</template>

<script>
import DsPill from './ds/Pill.vue';
import DsButton from './ds/Button.vue';

export default {
  name: 'OperationResultsModal',
  components: { DsPill, DsButton },
  props: {
    operation: {
      type: String,
      required: true
    },
    results: {
      type: Object,
      required: true
    }
  },
  emits: ['close'],
  data() {
    return {
      // Current locale for translations
      currentLocale: this.getCurrentLanguage()
    };
  },
  computed: {
    title() {
      const operationTitles = {
        backupDatabase: this.translate('admin.operations.backupTitle', 'Database Backup Results'),
        optimizeDatabase: this.translate('admin.operations.optimizeTitle', 'Database Optimization Results')
      };

      return operationTitles[this.operation] || this.translate('admin.operations.resultsTitle', 'Operation Results');
    },
    theme() {
      // Get theme from document
      return document.documentElement.getAttribute('data-theme') || 'light';
    }
  },
  methods: {
    // Translation method - copied from AdminDashboard for consistency
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

    // Get current language from i18n or localStorage - also copied from AdminDashboard
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
        // Silently fall through to default
      }

      // Default to English if nothing else works
      return 'en';
    }
  }
};
</script>

<style scoped>
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
}

.overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--overlay-bg);
}

.modal-content {
  position: relative;
  width: 90%;
  max-width: 700px;
  max-height: 90vh;
  background-color: var(--bg);
  border-radius: var(--radius-md);
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
}

.modal-footer {
  padding: var(--space-md) var(--space-lg);
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: flex-end;
}

/* Result Status Styles */
.result-status {
  display: flex;
  align-items: center;
  padding: var(--space-md);
  border-radius: var(--radius-md);
  margin-bottom: var(--space-lg);
}

.status-success {
  background-color: var(--success-bg);
}

.status-error {
  background-color: var(--danger-bg);
}

.status-icon {
  font-size: var(--text-xl);
  margin-right: var(--space-md);
}

.status-success .status-icon {
  color: var(--success);
}

.status-error .status-icon {
  color: var(--danger);
}

.status-message {
  font-size: var(--text-md);
  font-weight: 500;
}

.status-success .status-message {
  color: var(--success);
}

.status-error .status-message {
  color: var(--danger);
}

/* Result Details Styles */
.result-details {
  margin-bottom: var(--space-lg);
}

.result-section h3 {
  font-size: var(--text-lg);
  font-weight: 600;
  margin: 0 0 var(--space-md) 0;
  color: var(--fg);
}

.detail-item {
  display: flex;
  margin-bottom: var(--space-sm);
}

.detail-label {
  font-weight: 500;
  width: 120px;
  min-width: 120px;
  color: var(--fg);
}

.detail-value {
  color: var(--fg);
}

/* Table Styles */
.table-container {
  overflow-x: auto;
  max-height: 300px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.results-table {
  width: 100%;
  border-collapse: collapse;
}

.results-table th,
.results-table td {
  padding: var(--space-md);
  border-bottom: 1px solid var(--border);
  text-align: left;
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

/* Error Details */
.error-details {
  background-color: var(--danger-bg);
  border-radius: var(--radius-md);
  padding: var(--space-md);
}

.error-message {
  margin: 0;
  padding: var(--space-md);
  background-color: var(--muted-soft);
  border-radius: var(--radius-sm);
  color: var(--danger);
  font-family: var(--font-mono);
  white-space: pre-wrap;
  overflow-x: auto;
}

/* Dark mode adjustments are now handled by CSS custom properties (design tokens) */
</style>
