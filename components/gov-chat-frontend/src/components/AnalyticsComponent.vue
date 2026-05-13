<!-- AnalyticsComponent.vue - Updated Version with Translation Support and ApexCharts -->
<template>
  <div class="analytics-modal" @click.self="close">
    <div class="analytics-content">
      <div class="analytics-header">
        <h2>{{ $t('analytics.title') }}</h2>

        <DsButton variant="ghost" class="close-btn" aria-label="Close" @click="close">×</DsButton>
      </div>

      <div class="analytics-body">
        <!-- Usage Trend Chart -->
        <usage-trend-chart ref="usageTrendChart" />

        <!-- Top Queries Section -->
        <div class="analytics-section">
          <h3>{{ $t('analytics.topQueries') }}</h3>
          <div class="top-queries">
            <table>
              <thead>
                <tr>
                  <th>{{ $t('analytics.rank') }}</th>
                  <th>{{ $t('analytics.query') }}</th>
                  <th>{{ $t('analytics.count') }}</th>
                  <th>{{ $t('analytics.avgTime') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(query, index) in topQueries" :key="index">
                  <td>{{ index + 1 }}</td>
                  <td>{{ query.text }}</td>
                  <td>{{ query.count.toLocaleString() }}</td>
                  <td>{{ query.avgTime }}s</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Service Categories Usage -->
        <div class="analytics-section">
          <h3>{{ $t('analytics.serviceUsage') }}</h3>
          <div class="category-chart-container">
            <apexchart
              v-if="chartOptions && !loading"
              type="donut"
              height="320"
              :options="chartOptions"
              :series="chartSeries"
            />
            <div v-if="loading" class="chart-loading">
              {{ $t('analytics.loading') }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import UsageTrendChart from './UsageTrendChart.vue';
import { useChartTheme } from '../../composables/useChartTheme';
import DsButton from './ds/Button.vue';

export default {
  name: 'AnalyticsComponent',
  components: {
    DsButton,
    UsageTrendChart
  },

  emits: ['close'],

  setup() {
    const { theme, getCssVarStrings } = useChartTheme();
    return { theme, getCssVarStrings };
  },

  data() {
    return {
      loading: true,

      // Sample data (will be translated)
      topQueries: [],
      categoryData: [],
      chartOptions: null,
      chartSeries: []
    };
  },

  watch: {
    // Watch for theme changes from the composable
    theme: {
      handler() {
        this.$nextTick(() => {
          this.updateChart();
        });
      }
    }
  },

  created() {
    // Initialize translations
    this.translateQueries();
    this.translateCategories();
  },

  mounted() {
    // Listen for locale changes
    this.$watch(
      () => this.$i18n.locale,
      () => {
        this.translateQueries();
        this.translateCategories();

        // Also tell the usage chart to update
        if (this.$refs.usageTrendChart) {
          this.$refs.usageTrendChart.updateTranslations();
        }
      }
    );

    // Initialize chart after translations
    this.updateChart();
  },

  methods: {
    translateQueries() {
      const sampleQueriesPerLanguage = {
        en: [
          { text: 'How do I apply for a business license?', count: 2347, avgTime: 2.3 },
          { text: 'Where can I find tax forms?', count: 1982, avgTime: 1.8 },
          { text: "How to renew my driver's license?", count: 1645, avgTime: 2.1 },
          { text: 'What documents do I need for passport application?', count: 1423, avgTime: 3.4 },
          { text: 'When are property taxes due?', count: 1289, avgTime: 1.5 }
        ],
        fr: [
          { text: 'Comment faire une demande de licence commerciale?', count: 2347, avgTime: 2.3 },
          { text: 'Où puis-je trouver des formulaires fiscaux?', count: 1982, avgTime: 1.8 },
          { text: 'Comment renouveler mon permis de conduire?', count: 1645, avgTime: 2.1 },
          { text: 'Quels documents me faut-il pour une demande de passeport?', count: 1423, avgTime: 3.4 },
          { text: 'Quand les taxes foncières sont-elles dues?', count: 1289, avgTime: 1.5 }
        ],
        sw: [
          { text: 'Nawezaje kuomba leseni ya biashara?', count: 2347, avgTime: 2.3 },
          { text: 'Naweza kupata fomu za kodi wapi?', count: 1982, avgTime: 1.8 },
          { text: 'Jinsi ya kufanya upya leseni yangu ya udereva?', count: 1645, avgTime: 2.1 },
          { text: 'Ni nyaraka gani ninahitaji kwa maombi ya pasipoti?', count: 1423, avgTime: 3.4 },
          { text: 'Kodi za mali hulipwa lini?', count: 1289, avgTime: 1.5 }
        ]
      };

      // Use current locale or fall back to English
      const locale = this.$i18n.locale || 'en';
      this.topQueries = sampleQueriesPerLanguage[locale] || sampleQueriesPerLanguage['en'];
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

      // Use current locale or fall back to English
      const locale = this.$i18n.locale || 'en';
      this.categoryData = categoryDataPerLanguage[locale] || categoryDataPerLanguage['en'];

      // Update chart when categories change
      this.updateChart();
    },

    updateChart() {
      if (!this.categoryData || this.categoryData.length === 0) {
        return;
      }

      this.loading = true;

      // Use a timeout to ensure UI updates before chart rendering
      setTimeout(() => {
        try {
          const theme = this.getCssVarStrings();

          this.chartSeries = this.categoryData.map((item) => item.value);

          this.chartOptions = {
            chart: {
              type: 'donut',
              fontFamily: 'inherit',
              background: 'var(--surface)',
              foreColor: 'var(--fg)',
              toolbar: { show: false }
            },
            labels: this.categoryData.map((item) => item.category),
            colors: ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452'],
            legend: {
              position: 'right',
              labels: {
                colors: 'var(--fg)'
              }
            },
            plotOptions: {
              pie: {
                donut: {
                  size: '60%',
                  labels: {
                    show: true,
                    name: {
                      show: true,
                      style: { color: 'var(--fg)' }
                    },
                    value: {
                      show: true,
                      style: { color: 'var(--fg)' }
                    }
                  }
                }
              }
            },
            dataLabels: { enabled: false },
            stroke: { width: 0 },
            theme: {
              mode: theme.isDarkMode ? 'dark' : 'light'
            }
          };

          this.loading = false;
        } catch (error) {
          console.error('Error rendering category chart:', error);
          this.loading = false;
        }
      }, 100);
    },

    close() {
      this.$emit('close');
    }
  }
};
</script>

<style scoped>
.analytics-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--overlay-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.analytics-content {
  background: var(--surface);
  border-radius: var(--radius-lg);
  width: 90%;
  max-width: 1200px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg);
}

.analytics-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--border-light);
}

.analytics-header h2 {
  margin: 0;
  font-size: var(--text-xl);
  color: var(--fg);
  font-weight: 600;
}

.analytics-body {
  padding: var(--space-lg);
  overflow-y: auto;
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
  color: var(--fg);
  font-weight: 600;
}

.top-queries {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th {
  text-align: left;
  padding: var(--space-md);
  background: var(--bg);
  color: var(--fg);
  font-weight: 600;
}

td {
  padding: var(--space-md);
  border-top: 1px solid var(--border-light);
  color: var(--fg);
}

.category-chart-container {
  position: relative;
  width: 100%;
  height: 320px;
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
  background: var(--overlay-bg);
  font-size: var(--text-md);
  color: var(--fg);
}

@media (max-width: 768px) {
  .analytics-content {
    width: 95%;
    max-height: 95vh;
  }

  .analytics-header h2 {
    font-size: var(--text-lg);
  }
}
</style>
