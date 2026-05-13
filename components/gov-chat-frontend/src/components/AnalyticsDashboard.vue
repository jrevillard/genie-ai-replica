<template>
  <div :key="'dashboard-' + currentLocale" class="analytics-dashboard" :data-theme="theme">
    <div class="dashboard-header">
      <h2>{{ $t('analytics.title') }}</h2>

      <!-- Period selector -->
      <div class="period-selector">
        <label>{{ $t('analytics.period') }}:</label>
        <DsSelect v-model="selectedPeriod" @change="loadAnalytics">
          <option value="daily">{{ $t('analytics.periods.daily') }}</option>
          <option value="weekly">{{ $t('analytics.periods.weekly') }}</option>
          <option value="monthly">{{ $t('analytics.periods.monthly') }}</option>
          <option value="all-time">
            {{ $t('analytics.periods.allTime') }}
          </option>
        </DsSelect>

        <!-- Date picker (hidden for all-time) -->
        <div v-if="selectedPeriod !== 'all-time'" class="date-picker">
          <DsInput
            v-model="selectedDate"
            type="date"
            :max="todayStr"
            :placeholder="$t('analytics.tooltips.selectDate')"
            @change="loadAnalytics"
          />
        </div>
      </div>
    </div>

    <!-- Loading state -->
    <DsSpinner v-if="isLoading" overlay>
      <p>{{ $t('analytics.status.loading') }}</p>
    </DsSpinner>

    <DsStateDisplay v-else-if="error" type="error" :message="error">
      <template #action>
        <DsButton variant="primary" @click="loadAnalytics">
          {{ $t('analytics.retry') }}
        </DsButton>
      </template>
    </DsStateDisplay>

    <!-- Dashboard content -->
    <div v-else class="dashboard-content">
      <!-- Key metrics summary -->
      <div class="metrics-summary">
        <DsCard variant="default" padding="md" radius="lg">
          <h3>
            {{ $t('analytics.metrics.totalQueries') }}
          </h3>
          <div class="metric-value">
            {{ formatValue(analytics.totalQueries) }}
          </div>
          <div v-if="comparison.totalQueries" class="trend" :class="getTrendClass(comparison.totalQueries)">
            {{ formatTrend(comparison.totalQueries) }}
          </div>
        </DsCard>

        <DsCard variant="default" padding="md" radius="lg">
          <h3>{{ $t('analytics.metrics.uniqueUsers') }}</h3>
          <div class="metric-value">
            {{ formatValue(analytics.uniqueUsers) }}
          </div>
          <div v-if="comparison.uniqueUsers" class="trend" :class="getTrendClass(comparison.uniqueUsers)">
            {{ formatTrend(comparison.uniqueUsers) }}
          </div>
        </DsCard>

        <DsCard variant="default" padding="md" radius="lg">
          <h3>{{ $t('analytics.metrics.avgResponseTime') }}</h3>
          <div class="metric-value">
            {{ formatValue(analytics.averageResponseTime, 'time') }}
          </div>
          <div
            v-if="comparison.averageResponseTime"
            class="trend"
            :class="getTrendClass(comparison.averageResponseTime, true)"
          >
            {{ formatTrend(comparison.averageResponseTime, true) }}
          </div>
        </DsCard>

        <DsCard variant="default" padding="md" radius="lg">
          <h3>{{ $t('analytics.metrics.satisfaction') }}</h3>
          <div class="metric-value">
            {{ formatValue(analytics.satisfactionRate, 'percent') }}
          </div>
          <div v-if="comparison.satisfactionRate" class="trend" :class="getTrendClass(comparison.satisfactionRate)">
            {{ formatTrend(comparison.satisfactionRate) }}
          </div>
        </DsCard>
      </div>

      <!-- Category distribution chart -->
      <DsCard
        :key="'cat-container-' + currentLocale"
        variant="default"
        padding="md"
        radius="lg"
        class="chart-wrapper half-width"
      >
        <h3>{{ $t('charts.categoryDistribution') }}</h3>
        <CategoryDistributionChart
          v-if="analytics.queryDistribution && analytics.queryDistribution.length > 0"
          :data="analytics.queryDistribution"
          :external-data="true"
          :render-key="currentLocale"
        />
        <div v-else class="no-data">
          {{ $t('analytics.status.noData') }}
        </div>
      </DsCard>

      <!-- Top queries -->
      <DsCard
        :key="'top-queries-container-' + currentLocale"
        variant="default"
        padding="md"
        radius="lg"
        class="chart-wrapper half-width"
      >
        <h3>{{ $t('charts.topQueries') }}</h3>
        <TopQueriesChart
          v-if="analytics.topQueries && analytics.topQueries.length > 0"
          :data="analytics.topQueries"
          :render-key="currentLocale"
        />
        <div v-else class="no-data">
          {{ $t('analytics.status.noData') }}
        </div>
      </DsCard>

      <!-- Usage trend chart -->
      <DsCard
        :key="'usage-trend-container-' + currentLocale"
        variant="default"
        padding="md"
        radius="lg"
        class="chart-wrapper full-width"
      >
        <h3>{{ $t('charts.usageTrend') }}</h3>
        <UsageTrendChart
          v-if="timeSeriesData && timeSeriesData.length > 0"
          :data="timeSeriesData"
          :external-data="true"
          :render-key="currentLocale"
        />
        <div v-else class="no-data">
          {{ $t('analytics.status.noData') }}
        </div>
      </DsCard>
    </div>
  </div>
</template>

<script>
import analyticsService from '../services/analyticsService';
import DsCard from './ds/Card.vue';
import CategoryDistributionChart from './charts/CategoryDistributionChart.vue';
import TopQueriesChart from './charts/TopQueriesChart.vue';
import UsageTrendChart from './charts/UsageTrendChart.vue';
import DsButton from './ds/Button.vue';
import DsSpinner from './ds/Spinner.vue';
import DsStateDisplay from './ds/StateDisplay.vue';
import DsInput from './ds/Input.vue';
import DsSelect from './ds/Select.vue';

export default {
  name: 'AnalyticsDashboard',
  components: {
    DsButton,
    DsSpinner,
    DsCard,
    DsStateDisplay,
    CategoryDistributionChart,
    TopQueriesChart,
    UsageTrendChart,
    DsInput,
    DsSelect
  },
  data() {
    return {
      isLoading: false,
      error: null,
      selectedPeriod: 'daily',
      selectedDate: new Date().toISOString().split('T')[0], // Today's date in YYYY-MM-DD format
      analytics: {
        totalQueries: 0,
        uniqueUsers: 0,
        averageResponseTime: 0,
        satisfactionRate: 0,
        queryDistribution: [],
        topQueries: []
      },
      comparison: {
        totalQueries: null,
        uniqueUsers: null,
        averageResponseTime: null,
        satisfactionRate: null
      },
      timeSeriesData: [],
      theme: null
    };
  },
  computed: {
    /**
     * Current locale - used to trigger reactivity on language change
     */
    currentLocale() {
      return this.$i18n.locale;
    },
    /**
     * Today's date in YYYY-MM-DD format
     */
    todayStr() {
      return new Date().toISOString().split('T')[0];
    }
  },
  watch: {
    // Watch for language changes - force complete refresh
    '$i18n.locale': {
      handler() {
        // Force full reload of data when language changes
        this.loadAnalytics();
      },
      immediate: true
    }
  },
  created() {
    this.loadAnalytics();
    // Initialize theme
    this.theme = localStorage.getItem('theme') || document.documentElement.getAttribute('data-theme') || 'light';
  },
  mounted() {
    // Ensure theme is applied on mount
    this.applyTheme();
  },
  beforeUnmount() {
    // Cleanup handled by Vue reactivity — no intervals to clear
  },
  methods: {
    applyTheme() {
      // Get current theme from ThemeManager
      // Use saved theme preference or data-theme attribute
      let themeMode = localStorage.getItem('theme') || document.documentElement.getAttribute('data-theme') || 'light';
      // Validate themeMode
      if (!['light', 'dark', 'system'].includes(themeMode)) {
        themeMode = 'light';
      }
      this.theme = themeMode;
      // Force re-render of charts
      this.$nextTick(() => {
        this.loadAnalytics();
      });
    },
    /**
     * Load analytics data based on selected period and date
     */
    // AnalyticsDashboard.vue
    async loadAnalytics() {
      this.isLoading = true;
      this.error = null;

      try {
        const { startDate, endDate } = this.calculateTimeSeriesParams();
        const analyticsData = await analyticsService.getDashboardAnalytics(this.selectedPeriod, this.selectedDate);

        const uniqueUsers = await analyticsService.getUniqueUsersCount(startDate, endDate);

        this.analytics = {
          ...analyticsData,
          uniqueUsers
        };

        await this.loadComparisonData();
        await this.loadTimeSeriesData();
      } catch (error) {
        console.error('Error loading analytics data:', error);
        this.analytics = {
          totalQueries: 0,
          uniqueUsers: 0,
          averageResponseTime: 0,
          satisfactionRate: 0,
          queryDistribution: [],
          topQueries: []
        };
        this.timeSeriesData = [];
      } finally {
        this.isLoading = false;
      }
    },

    /**
     * Load comparison data for trend indicators
     */
    async loadComparisonData() {
      try {
        // Calculate the previous period based on current selection
        const { previousPeriod, previousDate } = this.calculatePreviousPeriod();

        // Get comparison data for all key metrics
        const metrics = ['totalQueries', 'uniqueUsers', 'averageResponseTime', 'satisfactionRate'];

        // Process each metric one by one
        for (const metric of metrics) {
          const comparisonData = await analyticsService.getComparisonData(
            metric,
            this.selectedPeriod,
            this.selectedDate,
            previousPeriod,
            previousDate
          );

          // Calculate percentage change
          if (comparisonData.previous !== null && comparisonData.previous !== undefined) {
            this.comparison[metric] = analyticsService.calculatePercentChange(
              comparisonData.current,
              comparisonData.previous
            );
          } else {
            this.comparison[metric] = null;
          }
        }
      } catch (error) {
        console.error('Error loading comparison data:', error);
        // Non-critical error, continue without comparison data
        this.comparison = {
          totalQueries: null,
          uniqueUsers: null,
          averageResponseTime: null,
          satisfactionRate: null
        };
      }
    },

    /**
     * Load time series data for charts
     */
    async loadTimeSeriesData() {
      try {
        this.timeSeriesData = []; // Clear existing data

        // Get time series parameters
        const params = this.calculateTimeSeriesParams();

        // Make API request
        const url = `/api/analytics/timeseries/queries`;

        const response = await fetch(
          `${url}?interval=${params.interval}&startDate=${params.startDate}&endDate=${params.endDate}`
        );

        if (!response.ok) {
          throw new Error(`API request failed with status ${response.status}`);
        }

        const data = await response.json();

        if (Array.isArray(data) && data.length > 0) {
          // Process the data to ensure it has the expected format
          this.timeSeriesData = data.map((item) => ({
            timestamp: item.timestamp || '',
            dateLabel: this.formatDateLabel(item.timestamp, params.interval),
            value: typeof item.value === 'number' ? item.value : 0,
            userCount: typeof item.userCount === 'number' ? item.userCount : 0
          }));
        } else {
          this.timeSeriesData = [];
        }
      } catch (error) {
        console.error('Error loading time series data:', error);
        this.timeSeriesData = [];
      }
    },

    /**
     * Format date for display
     */
    formatDate(dateString) {
      if (!dateString) return '';

      try {
        const date = new Date(dateString);
        return date.toLocaleDateString(this.$i18n.locale);
      } catch {
        return dateString;
      }
    },

    /**
     * Format date label based on interval
     * @param {string} timestamp - ISO date string
     * @param {string} interval - Time interval
     * @returns {string} Formatted date label
     */
    formatDateLabel(timestamp, interval) {
      if (!timestamp) return '';

      const date = new Date(timestamp);
      if (isNaN(date.getTime())) return timestamp;

      switch (interval) {
        case 'hourly':
          return date.toLocaleTimeString(this.$i18n.locale, {
            hour: '2-digit',
            minute: '2-digit'
          });
        case 'daily':
          return date.toLocaleDateString(this.$i18n.locale, {
            month: 'short',
            day: 'numeric'
          });
        case 'weekly':
          return `W${this.getWeekNumber(date)} ${date.toLocaleDateString(this.$i18n.locale, { month: 'short' })}`;
        case 'monthly':
          return date.toLocaleDateString(this.$i18n.locale, {
            month: 'short',
            year: 'numeric'
          });
        default:
          return date.toLocaleDateString(this.$i18n.locale);
      }
    },

    /**
     * Get week number of the year
     * @param {Date} date - Date object
     * @returns {number} Week number
     */
    getWeekNumber(date) {
      const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
    },

    /**
     * Format numeric values for display
     */
    formatValue(value, format = 'number') {
      if (value === null || value === undefined) return '-';

      // Use current locale for number formatting
      switch (format) {
        case 'number':
          return value.toLocaleString(this.$i18n.locale);
        case 'time':
          return `${value.toLocaleString(this.$i18n.locale)}s`;
        case 'percent':
          return `${value.toLocaleString(this.$i18n.locale)}%`;
        default:
          return value.toString();
      }
    },

    /**
     * Format trend percentage for display
     */
    formatTrend(percentChange, isInverse = false) {
      const prefix = percentChange > 0 ? '+' : '';
      const suffix = isInverse
        ? percentChange > 0
          ? ' ' + this.$t('analytics.slower')
          : ' ' + this.$t('analytics.faster')
        : '';

      return `${prefix}${percentChange.toFixed(1)}%${suffix}`;
    },

    /**
     * Get CSS class for trend indicator
     */
    getTrendClass(change, isInverse = false) {
      return analyticsService.getTrendColor(change, isInverse);
    },

    /**
     * Calculate previous period based on current selection
     */
    calculatePreviousPeriod() {
      const currentDate = new Date(this.selectedDate);
      let previousDate, previousPeriod;

      switch (this.selectedPeriod) {
        case 'daily':
          // Previous day
          previousDate = new Date(currentDate);
          previousDate.setDate(currentDate.getDate() - 1);
          previousPeriod = 'daily';
          break;

        case 'weekly':
          // Previous week
          previousDate = new Date(currentDate);
          previousDate.setDate(currentDate.getDate() - 7);
          previousPeriod = 'weekly';
          break;

        case 'monthly':
          // Previous month
          previousDate = new Date(currentDate);
          previousDate.setMonth(currentDate.getMonth() - 1);
          previousPeriod = 'monthly';
          break;

        case 'all-time':
          // Compare with previous equivalent time period
          // For all-time, we'll compare with half the total time
          previousPeriod = 'all-time';
          previousDate = null; // Not needed for all-time
          break;
      }

      return {
        previousPeriod,
        previousDate: previousDate ? previousDate.toISOString().split('T')[0] : null
      };
    },

    /**
     * Calculate time series parameters based on current selection
     */
    calculateTimeSeriesParams() {
      let interval, startDate;

      // End date is always selected date or today
      const endDate = this.selectedDate || new Date().toISOString().split('T')[0];

      switch (this.selectedPeriod) {
        case 'daily':
          // For daily view, show hourly data for the selected day
          interval = 'hourly';
          startDate = endDate;
          break;

        case 'weekly':
          // For weekly view, show daily data for the week
          interval = 'daily';
          startDate = new Date(new Date(endDate).setDate(new Date(endDate).getDate() - 6)).toISOString().split('T')[0];
          break;

        case 'monthly':
          // For monthly view, show daily data for the month
          interval = 'daily';
          startDate = new Date(new Date(endDate).setDate(new Date(endDate).getDate() - 29)).toISOString().split('T')[0];
          break;

        case 'all-time':
          // For all-time view, show monthly data
          interval = 'monthly';
          startDate = '2020-01-01'; // Arbitrary start date in the past
          break;
      }

      return { interval, startDate, endDate };
    }
  }
};
</script>

<style scoped>
.analytics-dashboard {
  position: relative;
  padding: var(--space-lg);
  color: var(--fg);
}

.dashboard-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-lg);
}

.dashboard-header h2 {
  color: var(--fg);
  font-weight: 600;
}

.period-selector {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  color: var(--fg);
  font-weight: 500;
}

.period-selector label {
  color: var(--fg);
  font-weight: 500;
}

.dashboard-content {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-lg);
}

.metrics-summary {
  display: flex;
  justify-content: space-between;
  width: 100%;
  gap: var(--space-md);
  margin-bottom: var(--space-lg);
}

.metrics-summary .ds-card {
  flex: 1;
  text-align: center;
}

.metrics-summary .ds-card h3 {
  margin-top: 0;
  margin-bottom: var(--space-sm);
  font-size: var(--text-base);
  font-weight: 600;
}

.metric-value {
  font-size: var(--text-xl);
  font-weight: bold;
  margin-bottom: var(--space-xs);
}

.trend {
  font-size: var(--text-sm);
  font-weight: 500;
}

.trend.positive {
  color: var(--success);
}

.trend.negative {
  color: var(--danger);
}

.trend.neutral {
  color: var(--muted-soft);
}

.chart-wrapper {
  margin-bottom: var(--space-lg);
}

.chart-wrapper h3 {
  margin-top: 0;
  margin-bottom: var(--space-md);
  font-size: var(--text-md);
  font-weight: 600;
}

.half-width {
  width: calc(50% - 10px);
}

.full-width {
  width: 100%;
}

.no-data {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--muted);
  font-style: italic;
  font-weight: 500;
}

@media (max-width: 768px) {
  .dashboard-header {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-sm);
  }

  .metrics-summary {
    flex-wrap: wrap;
  }

  .metric-card {
    min-width: calc(50% - 10px);
  }

  .half-width {
    width: 100%;
  }
}
</style>
