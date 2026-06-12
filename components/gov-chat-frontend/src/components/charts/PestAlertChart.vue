<template>
  <div class="pest-alert-chart">
    <!-- Header -->
    <div class="pest-alert-chart__header">
      <div class="pest-alert-chart__title">
        <h3>{{ $t('charts.pestAlertTitle', 'Pest & Disease Alerts') }}</h3>
        <p class="pest-alert-chart__subtitle">
          {{ $t('charts.pestAlertSubtitle', 'Current agricultural alerts for El Salvador') }}
        </p>
      </div>

      <!-- Severity Filter -->
      <DsSelect v-model="selectedSeverity" :placeholder="$t('charts.filterSeverity', 'Filter by severity')" size="md">
        <option value="all">{{ $t('charts.all', 'All Severities') }}</option>
        <option value="high">{{ $t('charts.high', 'High') }}</option>
        <option value="moderate">{{ $t('charts.moderate', 'Moderate') }}</option>
        <option value="low">{{ $t('charts.low', 'Low') }}</option>
      </DsSelect>
    </div>

    <!-- Loading State -->
    <DsSpinner v-if="loading" size="lg" overlay />

    <!-- Error State -->
    <DsStateDisplay
      v-else-if="error"
      type="error"
      :message="$t('charts.loadDataError', 'Failed to load pest alerts. Please try again.')"
    />

    <!-- Empty State -->
    <DsStateDisplay
      v-else-if="showEmptyState"
      type="empty"
      :message="$t('charts.noPestAlerts', 'No active pest alerts for this region.')"
    />

    <!-- Content -->
    <div v-else class="pest-alert-chart__content">
      <!-- Summary Donut Chart -->
      <div class="pest-alert-chart__summary">
        <apexchart type="donut" height="250" :options="summaryChartOptions" :series="summaryChartSeries" />
        <div class="pest-alert-chart__center-text">
          <div class="pest-alert-chart__total">{{ totalAlerts }}</div>
          <div class="pest-alert-chart__total-label">
            {{ $t('charts.activeAlerts', 'Active Alerts') }}
          </div>
        </div>
      </div>

      <!-- Severity Summary Chips -->
      <div class="pest-alert-chart__chips">
        <div
          v-for="severity in ['high', 'moderate', 'low']"
          :key="severity"
          :class="['pest-alert-chart__chip', `pest-alert-chart__chip--${severity}`]"
          @click="selectedSeverity = severity"
        >
          <DsPill :variant="severity">
            {{ $t(`charts.${severity}`, severity.charAt(0).toUpperCase() + severity.slice(1)) }}
          </DsPill>
          <span class="pest-alert-chart__chip-count">{{ getSeverityCount(severity) }}</span>
        </div>
      </div>

      <!-- Alert Cards -->
      <div class="pest-alert-chart__alerts">
        <transition-group name="alert-fade" tag="div">
          <DsCard
            v-for="alert in filteredAlerts"
            :key="alert.id"
            :variant="getAlertCardVariant(alert.severity)"
            padding="md"
            radius="md"
            hoverable
            class="pest-alert-chart__card"
            :class="`pest-alert-chart__card--${alert.severity}`"
          >
            <!-- Alert Header -->
            <template #header>
              <div class="pest-alert-chart__card-header" @click="toggleAlert(alert.id)">
                <div class="pest-alert-chart__card-title">
                  <h4>{{ alert.pest }}</h4>
                  <p v-if="alert.scientificName" class="pest-alert-chart__scientific">
                    {{ alert.scientificName }}
                  </p>
                </div>

                <div class="pest-alert-chart__card-meta">
                  <DsPill :variant="getSeverityPillVariant(alert.severity)" size="sm">
                    {{
                      $t(`charts.${alert.severity}`, alert.severity.charAt(0).toUpperCase() + alert.severity.slice(1))
                    }}
                  </DsPill>
                  <i :class="['fas', expandedAlert === alert.id ? 'fa-chevron-up' : 'fa-chevron-down']" />
                </div>
              </div>
            </template>

            <!-- Alert Body -->
            <div v-if="expandedAlert === alert.id" class="pest-alert-chart__card-body">
              <!-- Description -->
              <p v-if="alert.description" class="pest-alert-chart__description">
                {{ alert.description }}
              </p>

              <!-- Details Grid -->
              <div class="pest-alert-chart__details">
                <!-- Department -->
                <div v-if="alert.department" class="pest-alert-chart__detail">
                  <span class="pest-alert-chart__detail-label">
                    {{ $t('charts.byDepartment', 'Department') }}
                  </span>
                  <span class="pest-alert-chart__detail-value">{{ alert.department }}</span>
                </div>

                <!-- Affected Crops -->
                <div v-if="alert.affectedCrops && alert.affectedCrops.length" class="pest-alert-chart__detail">
                  <span class="pest-alert-chart__detail-label">
                    {{ $t('charts.affectedCrops', 'Affected Crops') }}
                  </span>
                  <span class="pest-alert-chart__detail-value">
                    {{ alert.affectedCrops.join(', ') }}
                  </span>
                </div>

                <!-- Season -->
                <div v-if="alert.season" class="pest-alert-chart__detail">
                  <span class="pest-alert-chart__detail-label">
                    {{ $t('charts.firstDetected', 'Season') }}
                  </span>
                  <span class="pest-alert-chart__detail-value">{{ alert.season }}</span>
                </div>
              </div>

              <!-- Recommendations -->
              <div
                v-if="alert.recommendations && getRecommendationList(alert.recommendations).length"
                class="pest-alert-chart__recommendations"
              >
                <h5>{{ $t('charts.recommendations', 'Recommendations') }}</h5>
                <ul>
                  <li v-for="(rec, idx) in getRecommendationList(alert.recommendations)" :key="idx">
                    {{ rec }}
                  </li>
                </ul>
              </div>

              <!-- Source -->
              <div v-if="alert.source" class="pest-alert-chart__source">
                <span class="pest-alert-chart__source-label"> {{ $t('charts.source', 'Source') }}: </span>
                <a :href="alert.source" target="_blank" rel="noopener noreferrer">
                  {{ alert.source }}
                </a>
              </div>

              <!-- Actions -->
              <div class="pest-alert-chart__actions">
                <button class="pest-alert-chart__action-btn" @click="viewOnMap(alert)">
                  <i class="fas fa-map-marker-alt" />
                  {{ $t('charts.viewMap', 'View on Map') }}
                </button>
                <button
                  class="pest-alert-chart__action-btn pest-alert-chart__action-btn--primary"
                  @click="submitAssistanceQuery(alert)"
                >
                  <i class="fas fa-comments" />
                  {{ $t('charts.getAssistance', 'Get Assistance') }}
                </button>
              </div>
            </div>
          </DsCard>
        </transition-group>
      </div>

      <!-- Last Updated -->
      <div class="pest-alert-chart__footer">
        <span class="pest-alert-chart__last-updated">
          {{ $t('charts.lastUpdated', 'Last updated') }}:
          {{ formatDate(lastUpdated) }}
        </span>
      </div>
    </div>
  </div>
</template>

<script>
import DsCard from '../ds/Card.vue';
import DsPill from '../ds/Pill.vue';
import DsSpinner from '../ds/Spinner.vue';
import DsStateDisplay from '../ds/StateDisplay.vue';
import DsSelect from '../ds/Select.vue';
import { useChartTheme } from '../../composables/useChartTheme.js';
import agriculturalService from '../../services/agriculturalService.js';

export default {
  name: 'PestAlertChart',

  components: {
    DsCard,
    DsPill,
    DsSpinner,
    DsStateDisplay,
    DsSelect
  },

  props: {
    region: {
      type: String,
      default: 'Central America'
    },
    userId: {
      type: String,
      default: ''
    },
    sessionId: {
      type: String,
      default: ''
    },
    autoRefresh: {
      type: Boolean,
      default: false
    },
    refreshInterval: {
      type: Number,
      default: 300000 // 5 minutes
    }
  },

  setup() {
    // ONLY for useChartTheme composable
    const { theme, isDarkMode, getCssVarStrings } = useChartTheme({});
    return { theme, isDarkMode, getCssVarStrings };
  },

  data() {
    return {
      loading: false,
      error: null,
      pestData: null,
      selectedSeverity: 'all',
      expandedAlert: null,
      refreshTimer: null
    };
  },

  computed: {
    filteredAlerts() {
      if (!this.pestData || !this.pestData.alerts) {
        return [];
      }
      if (this.selectedSeverity === 'all') {
        return this.pestData.alerts;
      }
      return this.pestData.alerts.filter((alert) => alert.severity === this.selectedSeverity);
    },

    totalAlerts() {
      return this.pestData?.summary?.total || 0;
    },

    showEmptyState() {
      return this.filteredAlerts.length === 0;
    },

    lastUpdated() {
      return this.pestData?.lastUpdated || new Date().toISOString();
    },

    summaryChartSeries() {
      const summary = this.pestData?.summary || { high: 0, moderate: 0, low: 0 };
      return [summary.high, summary.moderate, summary.low];
    },

    summaryChartOptions() {
      const colors = this.getCssVarStrings();

      return {
        chart: {
          type: 'donut',
          background: 'transparent',
          fontFamily: colors.chartColors[0]
        },
        labels: [this.$t('charts.high', 'High'), this.$t('charts.moderate', 'Moderate'), this.$t('charts.low', 'Low')],
        colors: ['var(--danger)', 'var(--warning)', 'var(--success)'],
        plotOptions: {
          pie: {
            donut: {
              size: '70%',
              labels: {
                show: false
              }
            }
          }
        },
        dataLabels: {
          enabled: false
        },
        legend: {
          show: false
        },
        tooltip: {
          theme: this.isDarkMode ? 'dark' : 'light',
          y: {
            formatter: (val) => val.toString()
          }
        },
        stroke: {
          colors: [colors.backgroundColor],
          width: 2
        },
        grid: {
          padding: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0
          }
        }
      };
    }
  },

  mounted() {
    this.loadPestAlerts();

    if (this.autoRefresh) {
      this.refreshTimer = setInterval(this.loadPestAlerts, this.refreshInterval);
    }
  },

  beforeUnmount() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  },

  methods: {
    async loadPestAlerts() {
      this.loading = true;
      this.error = null;

      try {
        const data = await agriculturalService.getPestAlerts(this.region);
        this.pestData = data;
      } catch (err) {
        console.error('[PestAlertChart] Failed to load pest alerts:', err);
        this.error = err;
      } finally {
        this.loading = false;
      }
    },

    getSeverityCount(severity) {
      return this.pestData?.summary?.[severity] || 0;
    },

    getRecommendationList(recommendations) {
      if (Array.isArray(recommendations)) {
        return recommendations;
      }
      if (typeof recommendations === 'string') {
        return recommendations
          .split(/\.\s*/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .map((s) => (s.endsWith('.') ? s : s + '.'));
      }
      return [];
    },

    toggleAlert(alertId) {
      this.expandedAlert = this.expandedAlert === alertId ? null : alertId;
    },

    formatDate(dateStr) {
      return new Date(dateStr).toLocaleDateString();
    },

    getAlertCardVariant(_severity) {
      return 'elevated'; // Always use elevated for better contrast with severity backgrounds
    },

    getSeverityPillVariant(severity) {
      const variantMap = {
        high: 'danger',
        moderate: 'warning',
        low: 'success'
      };
      return variantMap[severity] || 'info';
    },

    viewOnMap(alert) {
      const department = alert.department || (alert.departments && alert.departments[0]);
      if (!department) return;

      const searchQuery = `${department}, El Salvador ${alert.pest}`;
      const encodedQuery = encodeURIComponent(searchQuery);

      // Open in new tab
      window.open(`https://www.google.com/maps/search/?api=1&query=${encodedQuery}`, '_blank');
    },

    submitAssistanceQuery(alert) {
      const severityLabel = alert.severity.charAt(0).toUpperCase() + alert.severity.slice(1);
      const query = `I have a ${severityLabel.toLowerCase()} severity ${alert.pest} alert in ${alert.department || 'my area'}. ${alert.scientificName ? `Scientific name: ${alert.scientificName}.` : ''} What should I do?`;

      // Emit event for parent component to handle
      // Or navigate to chat with pre-filled query
      console.log('[PestAlertChart] Assistance query:', query);

      // You could emit an event here or navigate to chat
      // For now, just log it
    }
  }
};
</script>

<style scoped>
.pest-alert-chart {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

.pest-alert-chart__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-md);
  flex-wrap: wrap;
}

.pest-alert-chart__title h3 {
  margin: 0 0 var(--space-xs) 0;
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--fg);
}

.pest-alert-chart__subtitle {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--muted);
}

.pest-alert-chart__content {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

/* Summary Section */
.pest-alert-chart__summary {
  position: relative;
  width: 100%;
  max-width: 400px;
  margin: 0 auto;
}

.pest-alert-chart__center-text {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  pointer-events: none;
}

.pest-alert-chart__total {
  font-size: var(--text-3xl);
  font-weight: 700;
  color: var(--fg);
  line-height: 1;
}

.pest-alert-chart__total-label {
  font-size: var(--text-sm);
  color: var(--muted);
  margin-top: var(--space-xs);
}

/* Severity Chips */
.pest-alert-chart__chips {
  display: flex;
  gap: var(--space-md);
  justify-content: center;
  flex-wrap: wrap;
}

.pest-alert-chart__chip {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background-color var(--space-sm);
}

.pest-alert-chart__chip:hover {
  background-color: var(--bg);
}

.pest-alert-chart__chip-count {
  font-weight: 600;
  color: var(--fg);
}

/* Alert Cards */
.pest-alert-chart__alerts {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.pest-alert-chart__card {
  transition:
    transform var(--space-sm),
    box-shadow var(--space-sm);
}

.pest-alert-chart__card--high {
  border-left: 3px solid var(--danger);
}

.pest-alert-chart__card--moderate {
  border-left: 3px solid var(--warning);
}

.pest-alert-chart__card--low {
  border-left: 3px solid var(--success);
}

.pest-alert-chart__card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-md);
  cursor: pointer;
}

.pest-alert-chart__card-title h4 {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--fg);
}

.pest-alert-chart__scientific {
  margin: var(--space-xs) 0 0 0;
  font-size: var(--text-sm);
  color: var(--muted);
  font-style: italic;
}

.pest-alert-chart__card-meta {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.pest-alert-chart__card-body {
  padding: var(--space-md);
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.pest-alert-chart__description {
  margin: 0;
  font-size: var(--text-base);
  color: var(--fg);
  line-height: 1.6;
}

/* Details Grid */
.pest-alert-chart__details {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--space-md);
}

.pest-alert-chart__detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.pest-alert-chart__detail-label {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--muted);
}

.pest-alert-chart__detail-value {
  font-size: var(--text-base);
  color: var(--fg);
}

/* Recommendations */
.pest-alert-chart__recommendations h5 {
  margin: 0 0 var(--space-sm) 0;
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--fg);
}

.pest-alert-chart__recommendations ul {
  margin: 0;
  padding-left: var(--space-lg);
}

.pest-alert-chart__recommendations li {
  margin-bottom: var(--space-xs);
  font-size: var(--text-base);
  color: var(--fg);
}

/* Source */
.pest-alert-chart__source {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: var(--text-sm);
  flex-wrap: wrap;
}

.pest-alert-chart__source-label {
  color: var(--muted);
}

.pest-alert-chart__source a {
  color: var(--accent);
  text-decoration: none;
}

.pest-alert-chart__source a:hover {
  text-decoration: underline;
}

/* Actions */
.pest-alert-chart__actions {
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
}

.pest-alert-chart__action-btn {
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--fg);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: all var(--space-sm);
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.pest-alert-chart__action-btn:hover {
  background: var(--bg);
  border-color: var(--border-light);
}

.pest-alert-chart__action-btn--primary {
  background: var(--accent);
  color: var(--accent-fg);
  border-color: var(--accent);
}

.pest-alert-chart__action-btn--primary:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}

/* Footer */
.pest-alert-chart__footer {
  margin-top: var(--space-md);
  text-align: center;
}

.pest-alert-chart__last-updated {
  font-size: var(--text-sm);
  color: var(--muted);
}

/* Transitions */
.alert-fade-enter-active,
.alert-fade-leave-active {
  transition: all 0.3s ease;
}

.alert-fade-enter-from {
  opacity: 0;
  transform: translateY(-10px);
}

.alert-fade-leave-to {
  opacity: 0;
  transform: translateX(10px);
}

/* Responsive */
@media (max-width: 768px) {
  .pest-alert-chart__header {
    flex-direction: column;
  }

  .pest-alert-chart__details {
    grid-template-columns: 1fr;
  }

  .pest-alert-chart__actions {
    flex-direction: column;
  }

  .pest-alert-chart__action-btn {
    width: 100%;
    justify-content: center;
  }
}
</style>
