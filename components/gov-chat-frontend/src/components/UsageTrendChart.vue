<!-- UsageTrendChart.vue - ApexCharts Version with Translation Support -->
<template>
  <div class="usage-trend-chart">
    <div class="chart-header">
      <h3>{{ $t('analytics.usageTrends') }}</h3>
      <div class="chart-controls">
        <DsSelect v-model="selectedPeriod" class="period-selector">
          <option value="week">{{ $t('analytics.week') }}</option>
          <option value="month">{{ $t('analytics.month') }}</option>
          <option value="quarter">{{ $t('analytics.quarter') }}</option>
          <option value="year">{{ $t('analytics.year') }}</option>
        </DsSelect>
      </div>
    </div>

    <div class="chart-container">
      <apexchart
        v-if="!loading && chartOptions"
        type="line"
        height="320"
        :options="chartOptions"
        :series="chartSeries"
      />
      <div v-if="loading" class="chart-loading">
        {{ $t('analytics.loading') }}
      </div>
    </div>

    <div class="chart-metrics">
      <div class="metric-card">
        <div class="metric-value">{{ totalQueries.toLocaleString() }}</div>
        <div class="metric-label">{{ $t('analytics.totalQueries') }}</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">{{ uniqueUsers.toLocaleString() }}</div>
        <div class="metric-label">{{ $t('analytics.uniqueUsers') }}</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">{{ averageResponseTime.toFixed(1) }}s</div>
        <div class="metric-label">{{ $t('analytics.avgResponseTime') }}</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">{{ (satisfactionRate * 100).toFixed(1) }}%</div>
        <div class="metric-label">{{ $t('analytics.satisfactionRate') }}</div>
      </div>
    </div>
  </div>
</template>

<script>
import VueApexCharts from 'vue3-apexcharts';
import { useChartTheme } from '../../composables/useChartTheme';
import DsSelect from './ds/Select.vue';

export default {
  name: 'UsageTrendChart',

  components: {
    apexchart: VueApexCharts,
    DsSelect
  },

  setup() {
    const { theme, isDarkMode, getCssVarStrings } = useChartTheme({
      onThemeChange: () => {
        // Chart will automatically update via theme watcher
      }
    });
    return { theme, isDarkMode, getCssVarStrings };
  },

  data() {
    return {
      selectedPeriod: 'month',
      loading: true,
      totalQueries: 12847,
      uniqueUsers: 3294,
      averageResponseTime: 2.7,
      satisfactionRate: 0.91,
      chartOptions: null,
      chartSeries: [],

      // Sample chart data (will be translated)
      chartData: {
        week: [],
        month: [],
        quarter: [],
        year: []
      },

      // Original data for each language
      chartDataByLanguage: {
        en: {
          week: [
            { date: '2025-03-01', queries: 420, users: 180 },
            { date: '2025-03-02', queries: 380, users: 150 },
            { date: '2025-03-03', queries: 510, users: 210 },
            { date: '2025-03-04', queries: 530, users: 240 },
            { date: '2025-03-05', queries: 590, users: 280 },
            { date: '2025-03-06', queries: 480, users: 220 },
            { date: '2025-03-07', queries: 390, users: 170 }
          ],
          month: [
            { date: '2025-02-07', queries: 1800, users: 820 },
            { date: '2025-02-14', queries: 2100, users: 950 },
            { date: '2025-02-21', queries: 1950, users: 880 },
            { date: '2025-02-28', queries: 2400, users: 1100 },
            { date: '2025-03-07', queries: 2700, users: 1250 }
          ],
          quarter: [
            { date: '2024-12', queries: 8200, users: 3800 },
            { date: '2025-01', queries: 9500, users: 4200 },
            { date: '2025-02', queries: 11200, users: 4700 },
            { date: '2025-03', queries: 12800, users: 5300 }
          ],
          year: [
            { date: '2024-04', queries: 5200, users: 2100 },
            { date: '2024-07', queries: 6500, users: 2800 },
            { date: '2024-10', queries: 7800, users: 3400 },
            { date: '2025-01', queries: 9500, users: 4200 },
            { date: '2025-04', queries: 12800, users: 5300 }
          ]
        },
        fr: {
          week: [
            { date: '01/03/2025', queries: 420, users: 180 },
            { date: '02/03/2025', queries: 380, users: 150 },
            { date: '03/03/2025', queries: 510, users: 210 },
            { date: '04/03/2025', queries: 530, users: 240 },
            { date: '05/03/2025', queries: 590, users: 280 },
            { date: '06/03/2025', queries: 480, users: 220 },
            { date: '07/03/2025', queries: 390, users: 170 }
          ],
          month: [
            { date: '07/02/2025', queries: 1800, users: 820 },
            { date: '14/02/2025', queries: 2100, users: 950 },
            { date: '21/02/2025', queries: 1950, users: 880 },
            { date: '28/02/2025', queries: 2400, users: 1100 },
            { date: '07/03/2025', queries: 2700, users: 1250 }
          ],
          quarter: [
            { date: 'Déc 2024', queries: 8200, users: 3800 },
            { date: 'Jan 2025', queries: 9500, users: 4200 },
            { date: 'Fév 2025', queries: 11200, users: 4700 },
            { date: 'Mar 2025', queries: 12800, users: 5300 }
          ],
          year: [
            { date: 'Avr 2024', queries: 5200, users: 2100 },
            { date: 'Juil 2024', queries: 6500, users: 2800 },
            { date: 'Oct 2024', queries: 7800, users: 3400 },
            { date: 'Jan 2025', queries: 9500, users: 4200 },
            { date: 'Avr 2025', queries: 12800, users: 5300 }
          ]
        },
        sw: {
          week: [
            { date: '01/03/2025', queries: 420, users: 180 },
            { date: '02/03/2025', queries: 380, users: 150 },
            { date: '03/03/2025', queries: 510, users: 210 },
            { date: '04/03/2025', queries: 530, users: 240 },
            { date: '05/03/2025', queries: 590, users: 280 },
            { date: '06/03/2025', queries: 480, users: 220 },
            { date: '07/03/2025', queries: 390, users: 170 }
          ],
          month: [
            { date: '07/02/2025', queries: 1800, users: 820 },
            { date: '14/02/2025', queries: 2100, users: 950 },
            { date: '21/02/2025', queries: 1950, users: 880 },
            { date: '28/02/2025', queries: 2400, users: 1100 },
            { date: '07/03/2025', queries: 2700, users: 1250 }
          ],
          quarter: [
            { date: 'Des 2024', queries: 8200, users: 3800 },
            { date: 'Jan 2025', queries: 9500, users: 4200 },
            { date: 'Feb 2025', queries: 11200, users: 4700 },
            { date: 'Mar 2025', queries: 12800, users: 5300 }
          ],
          year: [
            { date: 'Apr 2024', queries: 5200, users: 2100 },
            { date: 'Jul 2024', queries: 6500, users: 2800 },
            { date: 'Okt 2024', queries: 7800, users: 3400 },
            { date: 'Jan 2025', queries: 9500, users: 4200 },
            { date: 'Apr 2025', queries: 12800, users: 5300 }
          ]
        }
      }
    };
  },

  watch: {
    selectedPeriod() {
      this.updateChart();
    },
    // Watch for theme changes from the composable
    theme() {
      this.$nextTick(() => {
        this.updateChart();
      });
    },
    // Watch for locale changes
    '$i18n.locale': {
      handler() {
        this.$nextTick(() => {
          this.updateTranslations();
          this.updateChart();
        });
      },
      immediate: false
    }
  },

  created() {
    this.updateTranslations();
  },

  mounted() {
    this.updateChart();
  },

  methods: {
    updateTranslations() {
      // Get the current locale or default to English
      const locale = this.$i18n.locale || 'en';

      // Get the data for the current locale or default to English
      const localeData = this.chartDataByLanguage[locale] || this.chartDataByLanguage['en'];

      // Update the chart data
      this.chartData = {
        week: localeData.week,
        month: localeData.month,
        quarter: localeData.quarter,
        year: localeData.year
      };
    },

    updateChart() {
      if (!this.chartData[this.selectedPeriod]) return;

      this.loading = true;

      // Use a timeout to ensure UI updates before chart rendering
      setTimeout(() => {
        try {
          const data = this.chartData[this.selectedPeriod];
          const cssVars = this.getCssVarStrings();

          // Gradient colors based on theme
          const lineGradientFrom = this.isDarkMode ? 'rgba(78, 151, 209, 0.6)' : 'rgba(78, 151, 209, 0.5)';
          const lineGradientTo = this.isDarkMode ? 'rgba(78, 151, 209, 0.1)' : 'rgba(78, 151, 209, 0.05)';

          this.chartOptions = {
            chart: {
              type: 'line',
              background: cssVars.backgroundColor,
              foreColor: cssVars.textColor,
              toolbar: {
                show: false
              },
              animations: {
                enabled: true,
                easing: 'easeinout',
                speed: 800
              }
            },
            theme: {
              mode: this.isDarkMode ? 'dark' : 'light'
            },
            tooltip: {
              theme: this.isDarkMode ? 'dark' : 'light',
              x: {
                show: true
              },
              y: {
                formatter: function (value) {
                  return value.toLocaleString();
                }
              }
            },
            legend: {
              position: 'bottom',
              labels: {
                colors: cssVars.textColor
              }
            },
            grid: {
              borderColor: cssVars.borderColor,
              strokeDashArray: 4,
              padding: {
                top: 0,
                right: 0,
                bottom: 0,
                left: 10
              }
            },
            xaxis: {
              categories: data.map((item) => item.date),
              labels: {
                style: {
                  colors: cssVars.textColor
                },
                rotate: 0,
                rotateAlways: false
              },
              axisBorder: {
                show: false
              },
              axisTicks: {
                show: false
              }
            },
            yaxis: {
              labels: {
                style: {
                  colors: cssVars.mutedColor
                },
                formatter: function (value) {
                  return value.toLocaleString();
                }
              }
            },
            stroke: {
              curve: 'smooth',
              width: [3, 0]
            },
            fill: {
              type: ['gradient', 'solid'],
              gradient: {
                shade: 'light',
                type: 'vertical',
                shadeIntensity: 0.5,
                gradientToColors: undefined,
                inverseColors: true,
                opacityFrom: 0.6,
                opacityTo: 0.1,
                stops: [0, 90, 100],
                colorStops: [
                  { offset: 0, color: lineGradientFrom },
                  { offset: 100, color: lineGradientTo }
                ]
              }
            },
            colors: ['#4e97d1', '#07cdae'],
            dataLabels: {
              enabled: false
            },
            markers: {
              size: 6,
              colors: ['#4e97d1'],
              strokeColors: cssVars.backgroundColor,
              strokeWidth: 2,
              hover: {
                size: 8
              }
            },
            plotOptions: {
              bar: {
                borderRadius: 4,
                columnWidth: '40%',
                dataLabels: {
                  position: 'top'
                }
              }
            }
          };

          this.chartSeries = [
            {
              name: this.$t('analytics.totalQueries'),
              type: 'line',
              data: data.map((item) => item.queries)
            },
            {
              name: this.$t('analytics.uniqueUsers'),
              type: 'column',
              data: data.map((item) => item.users)
            }
          ];

          // Update metrics based on period
          this.totalQueries = data.reduce((sum, item) => sum + item.queries, 0);
          this.uniqueUsers = Math.round(data.reduce((sum, item) => sum + item.users, 0) * 0.85); // Accounting for returning users

          switch (this.selectedPeriod) {
            case 'week':
              this.averageResponseTime = 2.1;
              this.satisfactionRate = 0.94;
              break;
            case 'month':
              this.averageResponseTime = 2.7;
              this.satisfactionRate = 0.91;
              break;
            case 'quarter':
              this.averageResponseTime = 3.2;
              this.satisfactionRate = 0.88;
              break;
            case 'year':
              this.averageResponseTime = 3.5;
              this.satisfactionRate = 0.85;
              break;
          }

          // End loading state
          this.loading = false;
        } catch {
          this.loading = false;
        }
      }, 100);
    }
  }
};
</script>

<style scoped>
.usage-trend-chart {
  background: var(--surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  padding: var(--space-md);
  margin-bottom: var(--space-lg);
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-md);
}

.chart-header h3 {
  margin: 0;
  font-size: var(--text-lg);
  color: var(--fg);
}

.chart-container {
  width: 100%;
  height: 320px;
  position: relative;
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
  background: color-mix(in oklch, var(--surface) 80%, transparent);
  font-size: var(--text-md);
  color: var(--muted);
}

.chart-metrics {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  margin-top: var(--space-md);
}

.metric-card {
  background: var(--bg);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  flex: 1;
  min-width: 120px;
  margin: var(--space-sm);
  text-align: center;
  box-shadow: var(--shadow-sm);
}

.metric-value {
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--accent);
  margin-bottom: var(--space-xs);
}

.metric-label {
  font-size: var(--text-base);
  color: var(--muted);
}

@media (max-width: 768px) {
  .chart-metrics {
    flex-direction: column;
  }

  .metric-card {
    margin: var(--space-xs) 0;
  }
}
</style>
