<template>
  <div class="analytics-page" :data-theme="theme">
    <div :key="'analytics-content-' + currentLocale" class="analytics-content">
      <div class="analytics-header">
        <h2>
          {{ $t('analytics.title') }}
        </h2>
      </div>

      <div class="analytics-body">
        <div v-if="useDynamicData" class="period-selector">
          <label for="period-select">{{ translate('analytics.period') }}</label>
          <DsSelect v-model="selectedPeriod" input-id="period-select" @change="loadAnalytics">
            <option value="daily">
              {{ translate('analytics.periods.daily') }}
            </option>
            <option value="weekly">
              {{ translate('analytics.periods.weekly') }}
            </option>
            <option value="monthly">
              {{ translate('analytics.periods.monthly') }}
            </option>
            <option value="all-time">
              {{ translate('analytics.periods.allTime') }}
            </option>
          </DsSelect>

          <div v-if="selectedPeriod !== 'all-time'" class="date-picker">
            <label for="date-select" class="sr-only">{{ translate('analytics.period') }}</label>
            <DsInput
              v-model="selectedDate"
              type="date"
              input-id="date-select"
              :max="todayStr"
              @change="loadAnalytics"
            />
          </div>
        </div>

        <DsSpinner v-if="isLoading" overlay>
          <p>{{ translate('analytics.loading') }}</p>
        </DsSpinner>

        <DsStateDisplay v-else-if="error" type="error" :message="error">
          <template #action>
            <DsButton variant="primary" @click="loadAnalytics">
              {{ translate('analytics.retry') }}
            </DsButton>
          </template>
        </DsStateDisplay>

        <div v-else class="dashboard-content">
          <div class="analytics-section">
            <usage-trend-chart
              ref="usageTrendChart"
              :data="timeSeriesData"
              :external-data="true"
              :show-period-selector="true"
              :show-dual-chart="true"
              @period-change="onPeriodChange"
            />
          </div>

          <div class="metrics-summary">
            <DsCard variant="default" padding="md" radius="lg">
              <h3>{{ translate('analytics.metrics.totalQueries') }}</h3>
              <div class="metric-value">
                {{ formatValue(analytics.totalQueries) }}
              </div>
              <div v-if="comparison.totalQueries" class="trend" :class="getTrendClass(comparison.totalQueries)">
                {{ formatTrend(comparison.totalQueries) }}
              </div>
            </DsCard>

            <DsCard variant="default" padding="md" radius="lg">
              <h3>{{ translate('analytics.metrics.uniqueUsers') }}</h3>
              <div class="metric-value">
                {{ formatValue(analytics.uniqueUsers) }}
              </div>
              <div v-if="comparison.uniqueUsers" class="trend" :class="getTrendClass(comparison.uniqueUsers)">
                {{ formatTrend(comparison.uniqueUsers) }}
              </div>
            </DsCard>

            <DsCard variant="default" padding="md" radius="lg">
              <h3>{{ translate('analytics.metrics.avgResponseTime') }}</h3>
              <div class="metric-value">
                {{ formatValue(analytics.averageResponseTime, 'milliseconds') }}
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
              <h3>{{ translate('analytics.metrics.satisfaction') }}</h3>
              <div class="metric-value">
                {{ formatValue(analytics.satisfactionRate, 'percent') }}
              </div>
              <div v-if="comparison.satisfactionRate" class="trend" :class="getTrendClass(comparison.satisfactionRate)">
                {{ formatTrend(comparison.satisfactionRate) }}
              </div>
            </DsCard>
          </div>

          <div class="satisfaction-charts">
            <h3 class="satisfaction-title">
              {{ translate('analytics.satisfactionAnalysis', 'User Satisfaction Analysis') }}
            </h3>
            <div class="satisfaction-container">
              <div class="analytics-section half-width">
                <satisfaction-gauge
                  :value="analytics.satisfactionGaugeData?.currentValue || 0"
                  :historical-data="analytics.satisfactionGaugeData?.historicalData || []"
                  :change-percentage="analytics.satisfactionGaugeData?.changePercentage || 0"
                  :target="analytics.satisfactionGaugeData?.target || 85"
                  :external-data="true"
                  :render-key="currentLocale"
                />
              </div>

              <div class="analytics-section half-width">
                <satisfaction-heatmap
                  :data="analytics.satisfactionHeatmapData"
                  :external-data="true"
                  :period="selectedPeriod"
                  :selected-date="selectedDate"
                  :render-key="currentLocale"
                />
              </div>
            </div>
          </div>

          <div class="charts-container">
            <div class="analytics-section half-width">
              <h3>{{ translate('analytics.topQueries') }}</h3>
              <top-queries-chart
                v-if="analytics.topQueries && analytics.topQueries.length > 0"
                :data="analytics.topQueries"
                :external-data="true"
              />
              <div v-else class="no-data">
                {{ translate('analytics.status.noData') }}
              </div>
            </div>

            <div class="analytics-section half-width">
              <h3>{{ translate('analytics.serviceUsage') }}</h3>
              <category-distribution-chart
                v-if="analytics.queryDistribution && analytics.queryDistribution.length > 0"
                :data="analytics.queryDistribution"
                :external-data="true"
                :render-key="currentLocale"
              />
              <div v-else class="category-chart-container">
                <div v-if="categoryLoading" class="chart-loading">
                  {{ translate('analytics.loading') }}
                </div>
                <div v-else class="no-data">
                  {{ translate('analytics.status.noData') }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import UsageTrendChart from './charts/UsageTrendChart.vue';
import TopQueriesChart from './charts/TopQueriesChart.vue';
import CategoryDistributionChart from './charts/CategoryDistributionChart.vue';
import SatisfactionGauge from './charts/SatisfactionGauge.vue';
import SatisfactionHeatmap from './charts/SatisfactionHeatmap.vue';
import analyticsService from '../services/analyticsService';
import DsButton from './ds/Button.vue';
import DsCard from './ds/Card.vue';
import DsSpinner from './ds/Spinner.vue';
import DsStateDisplay from './ds/StateDisplay.vue';
import DsInput from './ds/Input.vue';
import DsSelect from './ds/Select.vue';

export default {
  name: 'UnifiedAnalytics',
  components: {
    UsageTrendChart,
    TopQueriesChart,
    CategoryDistributionChart,
    SatisfactionGauge,
    SatisfactionHeatmap,
    DsButton,
    DsCard,
    DsSpinner,
    DsStateDisplay,
    DsInput,
    DsSelect
  },

  emits: [],

  data() {
    return {
      // CONFIGURE HERE: Set to false for static sample data, true for API calls
      useDynamicData: true, // false = static data, true = dynamic data

      isLoading: false,
      categoryLoading: false,
      error: null,
      selectedPeriod: 'monthly',
      selectedDate: new Date().toISOString().split('T')[0], // Today's date in YYYY-MM-DD format
      currentLocale: this.$i18n ? this.$i18n.locale : 'en',

      // Analytics data
      analytics: {
        totalQueries: 0,
        uniqueUsers: 0,
        averageResponseTime: 0,
        satisfactionRate: 0,
        queryDistribution: [],
        topQueries: [],
        satisfactionGaugeData: null,
        satisfactionHeatmapData: []
      },
      comparison: {
        totalQueries: null,
        uniqueUsers: null,
        averageResponseTime: null,
        satisfactionRate: null
      },
      timeSeriesData: [],

      // Translation data
      translatedTopQueries: [],
      translatedCategories: [],

      // Static sample data for non-dynamic mode
      staticData: {
        totalQueries: 12452,
        uniqueUsers: 3847,
        averageResponseTime: 2.3,
        satisfactionRate: 87.5,
        queryDistribution: [
          {
            categoryId: 'cat1',
            name: 'Business & Economy',
            count: 2347,
            value: 24
          },
          {
            categoryId: 'cat2',
            name: 'Transportation',
            count: 1782,
            value: 18
          },
          {
            categoryId: 'cat3',
            name: 'Taxes & Revenue',
            count: 1645,
            value: 16
          },
          {
            categoryId: 'cat4',
            name: 'Immigration & Citizenship',
            count: 1245,
            value: 12
          },
          {
            categoryId: 'cat5',
            name: 'Education & Learning',
            count: 980,
            value: 10
          },
          {
            categoryId: 'cat6',
            name: 'Housing & Properties',
            count: 850,
            value: 8
          },
          {
            categoryId: 'cat7',
            name: 'Health & Healthcare',
            count: 720,
            value: 6
          },
          { categoryId: 'cat8', name: 'Others', count: 650, value: 6 }
        ],
        topQueries: []
      }
    };
  },

  computed: {
    /**
     * Today's date in YYYY-MM-DD format
     */
    todayStr() {
      return new Date().toISOString().split('T')[0];
    }
  },

  created() {
    // Initialize analytics service with i18n instance
    analyticsService.setI18n(this.$i18n);

    // Initialize translations
    this.translateQueries();
    this.translateCategories();

    // Initialize static top queries with translated queries
    this.staticData.topQueries = [...this.translatedTopQueries];

    if (this.useDynamicData) {
      this.loadAnalytics();
    } else {
      this.loadStaticData();
    }
    // Listen for locale changes
    if (this.$i18n) {
      this.currentLocale = this.$i18n.locale;
      this.$watch('$i18n.locale', (newLocale) => {
        this.currentLocale = newLocale;

        // Update i18n in analytics service
        analyticsService.setI18n(this.$i18n);

        // Update translations
        this.translateQueries();
        this.translateCategories();

        // Reload analytics with new locale
        if (this.useDynamicData) {
          this.loadAnalytics();
        }

        // Also tell the usage chart to update
        if (this.$refs.usageTrendChart) {
          this.$refs.usageTrendChart.updateTranslations();
        }
      });
    }
  },

  mounted() {
    window.addEventListener('themeChange', this.handleThemeChange);
    window.addEventListener('resize', this.handleResize);
  },

  beforeUnmount() {
    window.removeEventListener('themeChange', this.handleThemeChange);
    window.removeEventListener('resize', this.handleResize);
  },

  methods: {
    handleThemeChange() {
      this.loadAnalytics();
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

    onPeriodChange(period) {
      this.selectedPeriod = period;
      if (this.useDynamicData) {
        this.loadAnalytics();
      }
    },

    translateQueries() {
      const sampleQueriesPerLanguage = {
        en: [
          {
            text: 'How do I apply for a business license?',
            count: 2347,
            avgTime: 2.3
          },
          { text: 'Where can I find tax forms?', count: 1982, avgTime: 1.8 },
          {
            text: "How to renew my driver's license?",
            count: 1645,
            avgTime: 2.1
          },
          {
            text: 'What documents do I need for passport application?',
            count: 1423,
            avgTime: 3.4
          },
          { text: 'When are property taxes due?', count: 1289, avgTime: 1.5 }
        ],
        fr: [
          {
            text: 'Comment faire une demande de licence commerciale?',
            count: 2347,
            avgTime: 2.3
          },
          {
            text: 'Où puis-je trouver des formulaires fiscaux?',
            count: 1982,
            avgTime: 1.8
          },
          {
            text: 'Comment renouveler mon permis de conduire?',
            count: 1645,
            avgTime: 2.1
          },
          {
            text: 'Quels documents me faut-il pour une demande de passeport?',
            count: 1423,
            avgTime: 3.4
          },
          {
            text: 'Quand les taxes foncières sont-elles dues?',
            count: 1289,
            avgTime: 1.5
          }
        ],
        sw: [
          {
            text: 'Nawezaje kuomba leseni ya biashara?',
            count: 2347,
            avgTime: 2.3
          },
          {
            text: 'Naweza kupata fomu za kodi wapi?',
            count: 1982,
            avgTime: 1.8
          },
          {
            text: 'Jinsi ya kufanya upya leseni yangu ya udereva?',
            count: 1645,
            avgTime: 2.1
          },
          {
            text: 'Ni nyaraka gani ninahitaji kwa maombi ya pasipoti?',
            count: 1423,
            avgTime: 3.4
          },
          { text: 'Kodi za mali hulipwa lini?', count: 1289, avgTime: 1.5 }
        ]
      };

      const locale = this.currentLocale || 'en';
      this.translatedTopQueries = sampleQueriesPerLanguage[locale] || sampleQueriesPerLanguage['en'];
    },

    translateCategories() {
      const categoryDataPerLanguage = {
        en: [
          { category: 'Business & Economy', value: 24 },
          { category: 'Transportation', value: 18 },
          { category: 'Taxes & Revenue', value: 16 },
          { category: 'Immigration & Citizenship', value: 12 },
          { category: 'Education & Learning', value: 10 },
          { category: 'Housing & Properties', value: 8 },
          { category: 'Others', value: 12 }
        ],
        fr: [
          { category: 'Affaires & Économie', value: 24 },
          { category: 'Transport', value: 18 },
          { category: 'Impôts & Recettes', value: 16 },
          { category: 'Immigration & Citoyenneté', value: 12 },
          { category: 'Éducation & Apprentissage', value: 10 },
          { category: 'Logement & Propriétés', value: 8 },
          { category: 'Autres', value: 12 }
        ],
        sw: [
          { category: 'Biashara & Uchumi', value: 24 },
          { category: 'Usafiri', value: 18 },
          { category: 'Kodi & Mapato', value: 16 },
          { category: 'Uhamiaji & Uraia', value: 12 },
          { category: 'Elimu & Mafunzo', value: 10 },
          { category: 'Makazi & Mali', value: 8 },
          { category: 'Nyinginezo', value: 12 }
        ]
      };

      const locale = this.currentLocale || 'en';
      this.translatedCategories = categoryDataPerLanguage[locale] || categoryDataPerLanguage['en'];

      if (this.staticData.queryDistribution) {
        this.translatedCategories.forEach((item, index) => {
          if (index < this.staticData.queryDistribution.length) {
            this.staticData.queryDistribution[index].name = item.category;
          }
        });
      }
    },

    handleResize() {
      // This will trigger resizing in child components as needed
    },

    loadStaticData() {
      this.isLoading = true;

      setTimeout(() => {
        this.analytics = {
          ...this.staticData,
          satisfactionGaugeData: {
            currentValue: 87.5,
            changePercentage: 1.2,
            historicalData: [
              { label: 'Previous Month', value: 86.3 },
              { label: 'Two Months Ago', value: 85.0 }
            ],
            target: 85
          },
          satisfactionHeatmapData: this.staticData.queryDistribution.map((category) => ({
            name: category.name,
            data: [
              { x: '4 Weeks Ago', y: 75 + Math.random() * 10 },
              { x: '3 Weeks Ago', y: 78 + Math.random() * 10 },
              { x: '2 Weeks Ago', y: 80 + Math.random() * 10 },
              { x: 'Last Week', y: 82 + Math.random() * 10 },
              { x: 'Current', y: 85 + Math.random() * 10 }
            ]
          }))
        };

        if (!this.analytics.topQueries || this.analytics.topQueries.length === 0) {
          this.analytics.topQueries = [...this.translatedTopQueries];
        }

        this.timeSeriesData = this.getStaticTimeSeriesData();

        this.comparison = {
          totalQueries: 5.2,
          uniqueUsers: 3.8,
          averageResponseTime: -0.3,
          satisfactionRate: 1.2
        };

        this.isLoading = false;
      }, 500);
    },

    // UnifiedAnalytics.vue
    async loadAnalytics() {
      if (!this.useDynamicData) {
        this.loadStaticData();
        return;
      }

      this.isLoading = true;
      this.error = null;

      try {
        const { startDate, endDate } = this.calculateTimeSeriesParams(); // Use same date range as time series
        const analyticsData = await analyticsService.getDashboardAnalytics(
          this.selectedPeriod,
          this.selectedDate,
          this.currentLocale
        );

        const uniqueUsers = await analyticsService.getUniqueUsersCount(startDate, endDate, this.currentLocale);

        const gaugeData = await analyticsService.getSatisfactionGauge(
          this.selectedPeriod,
          this.selectedDate,
          this.currentLocale
        );

        const heatmapData = await analyticsService.getSatisfactionHeatmap(
          this.selectedPeriod,
          this.selectedDate,
          this.currentLocale
        );

        this.analytics = {
          ...analyticsData,
          uniqueUsers, // Override with direct count
          satisfactionGaugeData: {
            currentValue: gaugeData?.currentValue || 0,
            historicalData: gaugeData?.historicalData || [],
            changePercentage: gaugeData?.changePercentage || 0,
            target: gaugeData?.target || 85
          },
          satisfactionRate: gaugeData?.currentValue || 0,
          satisfactionHeatmapData: heatmapData || []
        };

        await this.loadComparisonData();
        await this.loadTimeSeriesData();
      } catch (error) {
        console.error('Error loading analytics data:', error);
        this.error = this.translate('analytics.errors.loading', `Failed to load analytics data: ${error.message}`);
      } finally {
        this.isLoading = false;
      }
    },

    getStaticTimeSeriesData() {
      const now = new Date();
      const result = [];

      if (this.selectedPeriod === 'daily') {
        for (let hour = 0; hour < 24; hour++) {
          const time = new Date(now);
          time.setHours(hour, 0, 0, 0);

          const baseValue = hour >= 9 && hour <= 17 ? 50 : 20;
          const value = Math.round(baseValue * (0.8 + Math.random() * 0.4));

          result.push({
            timestamp: time.toISOString(),
            dateLabel: time.toLocaleTimeString(this.currentLocale, {
              hour: '2-digit',
              minute: '2-digit'
            }),
            value: value
          });
        }
      } else if (this.selectedPeriod === 'weekly') {
        for (let day = 6; day >= 0; day--) {
          const date = new Date(now);
          date.setDate(date.getDate() - day);
          date.setHours(0, 0, 0, 0);

          const isWeekend = date.getDay() === 0 || date.getDay() === 6;
          const baseValue = isWeekend ? 200 : 350;
          const value = Math.round(baseValue * (0.8 + Math.random() * 0.4));

          result.push({
            timestamp: date.toISOString(),
            dateLabel: date.toLocaleDateString(this.currentLocale, {
              month: 'short',
              day: 'numeric'
            }),
            value: value
          });
        }
      } else {
        for (let day = 29; day >= 0; day--) {
          const date = new Date(now);
          date.setDate(date.getDate() - day);
          date.setHours(0, 0, 0, 0);

          const isWeekend = date.getDay() === 0 || date.getDay() === 6;
          const baseValue = isWeekend ? 200 : 350;

          const value = Math.round(baseValue * (0.8 + Math.random() * 0.4));

          result.push({
            timestamp: date.toISOString(),
            dateLabel: date.toLocaleDateString(this.currentLocale, {
              month: 'short',
              day: 'numeric'
            }),
            value: value
          });
        }
      }

      return result;
    },

    async loadComparisonData() {
      try {
        const { previousPeriod, previousDate } = this.calculatePreviousPeriod();

        const metrics = ['totalQueries', 'uniqueUsers', 'averageResponseTime', 'satisfactionRate'];

        for (const metric of metrics) {
          const comparisonData = await analyticsService.getComparisonData(
            metric,
            this.selectedPeriod,
            this.selectedDate,
            previousPeriod,
            previousDate,
            this.currentLocale
          );

          if (comparisonData.previous !== null && comparisonData.previous !== undefined) {
            this.comparison[metric] = this.calculatePercentChange(comparisonData.current, comparisonData.previous);
          } else {
            this.comparison[metric] = null;
          }
        }
      } catch (error) {
        console.error('Error loading comparison data:', error);
        this.comparison = {
          totalQueries: null,
          uniqueUsers: null,
          averageResponseTime: null,
          satisfactionRate: null
        };
      }
    },

    async loadTimeSeriesData() {
      try {
        const { interval, startDate, endDate } = this.calculateTimeSeriesParams();

        this.timeSeriesData = await analyticsService.getTimeSeriesData(
          'queries',
          interval,
          startDate,
          endDate,
          this.currentLocale
        );
      } catch (error) {
        console.error('Error loading time series data:', error);
        this.timeSeriesData = this.getStaticTimeSeriesData();
      }
    },

    formatValue(value, format = 'number') {
      return analyticsService.formatValue(value, format, this.currentLocale);
    },

    formatTrend(percentChange, isInverse = false) {
      const prefix = percentChange > 0 ? '+' : '';
      const suffix = isInverse
        ? percentChange > 0
          ? ' ' + this.translate('analytics.slower')
          : ' ' + this.translate('analytics.faster')
        : '';

      return `${prefix}${percentChange.toFixed(1)}%${suffix}`;
    },

    getTrendClass(change, isInverse = false) {
      return analyticsService.getTrendColor(change, isInverse);
    },

    calculatePreviousPeriod() {
      const currentDate = new Date(this.selectedDate);
      let previousDate, previousPeriod;

      switch (this.selectedPeriod) {
        case 'daily':
          previousDate = new Date(currentDate);
          previousDate.setDate(currentDate.getDate() - 1);
          previousPeriod = 'daily';
          break;

        case 'weekly':
          previousDate = new Date(currentDate);
          previousDate.setDate(currentDate.getDate() - 7);
          previousPeriod = 'weekly';
          break;

        case 'monthly':
          previousDate = new Date(currentDate);
          previousDate.setMonth(currentDate.getMonth() - 1);
          previousPeriod = 'monthly';
          break;

        case 'all-time':
          previousPeriod = 'all-time';
          previousDate = null;
          break;
      }

      return {
        previousPeriod,
        previousDate: previousDate ? previousDate.toISOString().split('T')[0] : null
      };
    },

    calculateTimeSeriesParams() {
      let interval, startDate;

      const endDate = this.selectedDate || new Date().toISOString().split('T')[0];

      switch (this.selectedPeriod) {
        case 'daily':
          interval = 'hourly';
          startDate = endDate;
          break;

        case 'weekly':
          interval = 'daily';
          startDate = new Date(new Date(endDate).setDate(new Date(endDate).getDate() - 6)).toISOString().split('T')[0];
          break;

        case 'monthly':
          interval = 'daily';
          startDate = new Date(new Date(endDate).setDate(new Date(endDate).getDate() - 29)).toISOString().split('T')[0];
          break;

        case 'all-time':
          interval = 'monthly';
          startDate = '2020-01-01';
          break;
      }

      return { interval, startDate, endDate };
    },

    calculatePercentChange(current, previous) {
      return analyticsService.calculatePercentChange(current, previous);
    }
  }
};
</script>

<style scoped>
/* Theme-specific styles */
.analytics-page {
  background: var(--bg);
}

.analytics-content {
  background: var(--surface);
  color: var(--fg);
  border-radius: var(--radius-lg);
  width: 100%;
  max-width: 1400px;
  margin: 0 auto;
  padding: var(--space-lg);
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-md);
}

.analytics-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--border);
}

.analytics-header h2 {
  margin: 0;
  font-size: var(--text-xl);
}

.close-btn {
  /* Layout only - styling handled by DsButton ghost */
}

.analytics-body {
  position: relative;
  padding: var(--space-lg);
  flex: 1;
}

.period-selector {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: var(--space-lg);
  padding-bottom: var(--space-md);
  border-bottom: 1px solid var(--border);
}

.period-selector label {
  font-weight: 600;
}

.dashboard-content {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

.analytics-section {
  margin-bottom: var(--space-lg);
  background: var(--surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  padding: var(--space-md);
}

.analytics-section h3 {
  margin-top: 0;
  margin-bottom: var(--space-md);
  font-size: var(--text-lg);
  font-weight: 600;
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
  text-shadow: 0 0 1px var(--fg, rgba(51, 51, 51, 0.2)); /* keep rgba for shadow */
}

.trend {
  font-size: var(--text-sm);
}

.trend.positive {
  color: var(--success);
}

.trend.negative {
  color: var(--danger);
}

.trend.neutral {
  color: var(--muted);
}

.charts-container {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-lg);
}

.half-width {
  flex: 1;
  min-width: calc(50% - 10px);
}

.category-chart-container {
  position: relative;
  width: 100%;
  height: 320px;
}

.category-usage {
  width: 100%;
  height: 100%;
}

.chart-loading {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--surface, rgba(255, 255, 255, 0.8)); /* keep rgba for overlay */
  opacity: 0.8;
  font-size: var(--text-md);
  color: var(--fg);
}

.no-data {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--muted-soft);
  font-style: italic;
}

.satisfaction-charts {
  margin-bottom: var(--space-lg);
}

.satisfaction-title {
  margin-top: 0;
  margin-bottom: var(--space-md);
  font-size: var(--text-lg);
  font-weight: 600;
}

.satisfaction-container {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-lg);
  margin-bottom: var(--space-sm);
}

@media (max-width: 768px) {
  .analytics-content {
    width: 95%;
    max-height: 95vh;
  }

  .analytics-header h2 {
    font-size: var(--text-lg);
  }

  .charts-container {
    flex-direction: column;
  }

  .half-width {
    width: 100%;
  }

  .metrics-summary {
    flex-wrap: wrap;
  }

  .metrics-summary .ds-card {
    min-width: calc(50% - 10px);
  }

  .satisfaction-container {
    flex-direction: column;
  }
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}
</style>
